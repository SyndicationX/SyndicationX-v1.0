import "./env.bootstrap.js";
import express from "express";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import cors from "cors";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { db, pool } from "./database/db.js";
import { getUploadsPhysicalRoot } from "./config/uploadPaths.js";
import { postCompanySettingsBranding } from "./controllers/company/companySettingsBranding.controller.js";
import {
  postDeal,
  postDealOfferingGalleryUploads,
  putDeal,
} from "./controllers/deal/add_deal.controller.js";
import {
  uploadDealCreateOrUpdateAssetImages,
  uploadDealOfferingGalleryFile,
} from "./middleware/dealAssetImageUpload.middleware.js";
import { uploadDealEsignTemplateFiles } from "./middleware/dealEsignTemplateUpload.middleware.js";
import { uploadCompanySettingsBranding } from "./middleware/companySettingsBrandingUpload.middleware.js";
import { socHttpAuditMiddleware } from "./middleware/socHttpAudit.middleware.js";
import userRoutes from "./routes/userRoutes.routes.js";
import companyRoutes from "./routes/companyRoutes.routes.js";
import dealFormRoutes from "./routes/dealForm.routes.js";
import contactRoutes from "./routes/contact.routes.js";
import esignTemplateRoutes from "./routes/esignTemplate.routes.js";
import investingProfileBookRoutes from "./routes/investingProfileBook.routes.js";
import platformRoutes from "./routes/platformRoutes.routes.js";
import { postDropboxSignWebhook } from "./controllers/deal/dealDropboxSignWebhook.controller.js";
import { postSignFlowWebhook } from "./controllers/deal/dealSignflowWebhook.controller.js";
import { postDealEsignTemplateUploads } from "./controllers/deal/dealEsignTemplates.controller.js";
import { dropboxSignWebhookUpload } from "./middleware/dropboxSignWebhook.middleware.js";
import investmentSignatureRoutes from "./routes/investmentSignature.routes.js";
import { getSignFlowPublicConfig } from "./config/signflow.config.js";


const PORT = process.env.BACKEND_PORT ?? 5004;
const app = express();

const baseUrl = process.env.BASE_URL?.trim();
const allowedOrigins: string[] = [...(baseUrl ? [baseUrl] : [])];

// CORS first so preflight (OPTIONS) and all responses get correct headers
app.use(
  cors({
    origin: (origin, cb) => {
      // Allow requests with no origin (e.g. Postman, same-origin) or when origin is in the list
      if (!origin) return cb(null, true);
      if (allowedOrigins.includes(origin)) return cb(null, true);
      // In development, allow any localhost origin so CORS never blocks
      if (
        process.env.NODE_ENV !== "production" &&
        /^https?:\/\/(\[::1\]|localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin)
      ) {
        return cb(null, true);
      }
      return cb(null, true);
    },
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    /**
     * Omitted: let `cors` echo `Access-Control-Request-Headers` from the browser. A fixed
     * list (esp. in Edge) can preflight-fail for multipart+Authorization when the browser
     * sends a slightly different set of request-header names.
     */
    credentials: true,
    optionsSuccessStatus: 204,
  }),
);

// Ensure CORS headers are on every response (even 4xx/5xx) so browser can read the body
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (
    origin &&
    (allowedOrigins.includes(origin) ||
      (process.env.NODE_ENV !== "production" &&
        /^https?:\/\/(\[::1\]|localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin)))
  ) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }
  res.setHeader("Access-Control-Allow-Credentials", "true");
  next();
});

/* Multipart uploads must run before any body parser (multer/busboy reads the stream). */
app.post(
  "/api/v1/companies/:companyId/settings/branding/:assetType",
  socHttpAuditMiddleware,
  uploadCompanySettingsBranding,
  postCompanySettingsBranding,
);
app.post(
  "/api/v1/deals",
  socHttpAuditMiddleware,
  uploadDealCreateOrUpdateAssetImages,
  postDeal,
);
app.put(
  "/api/v1/deals/:dealId",
  socHttpAuditMiddleware,
  uploadDealCreateOrUpdateAssetImages,
  putDeal,
);
app.post(
  "/api/v1/deals/:dealId/offering-gallery-uploads",
  socHttpAuditMiddleware,
  uploadDealOfferingGalleryFile,
  postDealOfferingGalleryUploads,
);
app.post(
  "/api/v1/deals/:dealId/esign-template-uploads",
  uploadDealEsignTemplateFiles,
  postDealEsignTemplateUploads,
);

// Allow larger request bodies (default is ~100kb; SyndicationX forms can exceed this)
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ limit: "10mb", extended: true }));

/** Dropbox Sign webhooks (no JWT; multipart `json` field). */
app.post(
  "/webhooks/dropbox-sign",
  dropboxSignWebhookUpload,
  postDropboxSignWebhook,
);
app.post(
  "/api/webhooks/dropbox-sign",
  dropboxSignWebhookUpload,
  postDropboxSignWebhook,
);

/** SignFlow webhooks (no JWT; JSON body). */
app.post("/webhooks/signflow", postSignFlowWebhook);
app.post("/api/webhooks/signflow", postSignFlowWebhook);

app.use("/api/v1", socHttpAuditMiddleware);

// Preflight: respond to OPTIONS for any /api/v1 path with 204 (CORS headers set by cors() above)
app.use("/api/v1", (req, res, next) => {
  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }
  next();
});


const uploadsRoot = getUploadsPhysicalRoot();
app.use("/uploads", express.static(uploadsRoot, {
  fallthrough: true,
  maxAge: "1d",
}));
console.log("Static /uploads →", uploadsRoot);

app.use("/api/v1", [
  userRoutes,
  companyRoutes,
  dealFormRoutes,
  contactRoutes,
  esignTemplateRoutes,
  investingProfileBookRoutes,
  investmentSignatureRoutes,
  platformRoutes,
]);

console.log("Starting server...");

const signFlowCfg = getSignFlowPublicConfig();
if (signFlowCfg.configured) {
  console.log(
    `SignFlow configured (${signFlowCfg.testMode ? "sandbox" : "production"}) → ${signFlowCfg.baseUrl}`,
  );
  const webhookBase = baseUrl?.trim() || `http://localhost:${PORT}`;
  console.log(`SignFlow webhook URL → ${webhookBase}/api/webhooks/signflow`);
} else {
  console.log(
    "SignFlow not configured — set SIGNFLOW_API_BASE_URL and SIGNFLOW_API_KEY (see API_INTEGRATION.md).",
  );
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function ensureInvestorQuestionnaireColumn(): Promise<void> {
  await pool.query(
    `ALTER TABLE add_deal_form ADD COLUMN IF NOT EXISTS investor_questionnaire_json text`,
  );
}

async function ensureDealInvestmentInvestNowColumns(): Promise<void> {
  await pool.query(
    `ALTER TABLE deal_investment ADD COLUMN IF NOT EXISTS funding_method text NOT NULL DEFAULT ''`,
  );
}

async function runMigrations(): Promise<void> {
  const migrationsFolder = path.resolve(__dirname, "..", "migrations");
  await migrate(db, { migrationsFolder });
  await ensureInvestorQuestionnaireColumn();
  await ensureDealInvestmentInvestNowColumns();
  console.log("Database migrations applied.");
}

/** Ensures the pool can open a connection (no SQL executed here). */
async function verifyPoolConnection(): Promise<void> {
  const client = await pool.connect();
  client.release();
  console.log("Database pool ready.");
}

/**
 * If DB init fails *before* listen, nothing binds to the port and the Vite (or nginx) proxy
 * returns 502 with no useful error. We listen first, then connect/migrate, so the process is
 * always reachable; DB issues become 500/503 on routes and clear logs here.
 */
async function initDatabaseAfterListen(): Promise<void> {
  try {
    await verifyPoolConnection();
    if (process.env.SKIP_DB_MIGRATIONS === "1") {
      console.warn("SKIP_DB_MIGRATIONS=1 — migrations were not applied.");
    } else {
      await runMigrations();
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(
      "Database initialization failed. Fix DATABASE_* in backend/.env.local, ensure PostgreSQL is running, then restart.\n",
      message,
    );
    if (process.env.REQUIRE_DB_BEFORE_START === "1") {
      process.exit(1);
    }
  }
}

const listenPort = Number(String(PORT).trim()) || 5004;
app.listen(listenPort, "0.0.0.0", () => {
  console.log(
    `Server listening on http://127.0.0.1:${listenPort} (0.0.0.0:${listenPort})`,
  );
  void initDatabaseAfterListen();
});
