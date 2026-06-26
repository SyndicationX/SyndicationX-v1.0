import { access, readFile } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { getSignFlowPublicConfig } from "../../config/signflow.config.js";
import {
  buildSignFlowEditorUrl,
  countSignFlowPdfPages,
  createSignFlowDraftFromPdf,
  ensureSignFlowEmbedRecipients,
  getSignFlowDocument,
  normalizeSignFlowFieldRecipientIds,
  patchSignFlowDocument,
  resolveSignFlowInvestorRecipientId,
} from "../esign/signflow.service.js";
import {
  getInvestorQuestionnaireSignatureSignFlowFields,
  isQuestionnaireSignatureFieldLabel,
} from "./esignPdfMerge.service.js";
import { inferSigningWorkflowFromSignFlowDocument, resolveSigningWorkflowFromTemplateFile } from "./dealEsignSigningWorkflow.service.js";
import {
  ensureEsignTemplatePdfPrepared,
  findEsignTemplateFile,
  getDealEsignTemplatesState,
  isPdfEsignFile,
  type EsignTemplateFileRecord,
  type EsignTemplatesJson,
} from "./dealEsignTemplates.service.js";
import { eq } from "drizzle-orm";
import { db } from "../../database/db.js";
import { addDealForm } from "../../schema/deal.schema/add-deal-form.schema.js";

async function persistEsignTemplatesJson(
  dealId: string,
  state: EsignTemplatesJson,
): Promise<void> {
  await db
    .update(addDealForm)
    .set({ esignTemplatesJson: JSON.stringify(state) })
    .where(eq(addDealForm.id, dealId));
}

async function applyTemplateSigningWorkflowToSignFlowDoc(
  file: EsignTemplateFileRecord,
  documentId: string,
): Promise<void> {
  const { workflowType, signingOrder } =
    resolveSigningWorkflowFromTemplateFile(file);
  const { syncSignflowTemplateSigningWorkflow } = await import(
    "./dealEsignSigningWorkflow.service.js"
  );
  await syncSignflowTemplateSigningWorkflow(
    documentId,
    workflowType,
    signingOrder,
  );
}

async function ensureSignFlowQuestionnaireSignatureFields(
  documentId: string,
  includeQuestionnaire: boolean,
): Promise<void> {
  if (!includeQuestionnaire) return;

  const doc = await getSignFlowDocument(documentId);
  const existing = doc.fields ?? [];
  const hasQuestionnaireFields = existing.some(
    (field) =>
      Math.max(1, Math.floor(Number(field.page) || 1)) === 1 &&
      isQuestionnaireSignatureFieldLabel(String(field.label ?? "")),
  );
  if (hasQuestionnaireFields) return;

  const investorRecipientId = resolveSignFlowInvestorRecipientId(doc);
  const preset = getInvestorQuestionnaireSignatureSignFlowFields(
    investorRecipientId,
    0,
  );
  const otherFields = normalizeSignFlowFieldRecipientIds(
    doc,
    existing.filter(
      (field) =>
        Math.max(1, Math.floor(Number(field.page) || 1)) !== 1 ||
        !isQuestionnaireSignatureFieldLabel(String(field.label ?? "")),
    ),
  );

  await patchSignFlowDocument(documentId, {
    fields: normalizeSignFlowFieldRecipientIds(doc, [...preset, ...otherFields]),
  });
}

export async function startDealEsignSignflowTemplateDraft(params: {
  dealId: string;
  fileId: string;
  title?: string;
}): Promise<{
  file: EsignTemplateFileRecord;
  editUrl: string;
  templateId: string;
  expiresAt: number;
  provider: "signflow";
  embedApiKey: string | null;
  appBaseUrl: string;
  testMode: boolean;
}> {
  const publicCfg = getSignFlowPublicConfig();
  if (!publicCfg.configured || !publicCfg.appBaseUrl) {
    throw new Error(
      "SignFlow is not configured. Set SIGNFLOW_API_BASE_URL and SIGNFLOW_API_KEY in backend/.env",
    );
  }

  const state = await getDealEsignTemplatesState(params.dealId);
  const file = findEsignTemplateFile(state, params.fileId);
  if (!file) throw new Error("eSign template file not found");
  if (!isPdfEsignFile(file)) {
    throw new Error(
      "Only PDF documents can be configured for eSign. Convert Word files to PDF before uploading.",
    );
  }

  const title =
    params.title?.trim() ||
    file.templateName?.trim() ||
    file.signflowTitle?.trim() ||
    file.dropboxSignTitle?.trim() ||
    file.originalName.replace(/\.pdf$/i, "") ||
    "Deal eSign template";

  const existingDocId = file.signflowDocumentId?.trim() ?? "";
  const canResumeExisting =
    existingDocId &&
    (file.signflowStatus === "draft" || file.signflowStatus === "ready");

  if (canResumeExisting) {
    await ensureSignFlowEmbedRecipients(existingDocId);
    await ensureSignFlowQuestionnaireSignatureFields(
      existingDocId,
      Boolean(file.includeQuestionnaire),
    );
    await applyTemplateSigningWorkflowToSignFlowDoc(file, existingDocId);
    return {
      file,
      editUrl: buildSignFlowEditorUrl(existingDocId),
      templateId: existingDocId,
      expiresAt: Math.floor(Date.now() / 1000) + 3600,
      provider: "signflow",
      embedApiKey: publicCfg.embedApiKey,
      appBaseUrl: publicCfg.appBaseUrl,
      testMode: publicCfg.testMode,
    };
  }

  const { absolutePath: absPath } = await ensureEsignTemplatePdfPrepared(
    params.dealId,
    file,
    state,
  );
  try {
    await access(absPath, fsConstants.R_OK);
  } catch {
    throw new Error(
      "Template PDF was not found on the server. Remove this template and upload it again.",
    );
  }

  const fileBuffer = await readFile(absPath);
  const pdfPageCount = await countSignFlowPdfPages(fileBuffer);

  let documentId = existingDocId;
  if (documentId) {
    try {
      const existing = await getSignFlowDocument(documentId);
      if (!existing.fileUrl?.trim()) {
        documentId = "";
        delete file.signflowDocumentId;
        delete file.signflowStatus;
      } else {
        const storedPages = Math.max(1, Number(existing.pages) || 1);
        if (pdfPageCount > storedPages) {
          await patchSignFlowDocument(documentId, { pages: pdfPageCount });
        }
      }
    } catch {
      documentId = "";
      delete file.signflowDocumentId;
      delete file.signflowStatus;
    }
  }

  if (!documentId) {
    const draft = await createSignFlowDraftFromPdf({
      title,
      pdfBuffer: fileBuffer,
      fileName: file.originalName,
      pages: pdfPageCount,
    });
    documentId = draft.documentId;
    file.signflowDocumentId = documentId;
    file.signflowStatus = "draft";
    file.signflowTitle = title;
    file.esignProvider = "signflow";
    await persistEsignTemplatesJson(params.dealId, state);
  }

  await ensureSignFlowEmbedRecipients(documentId);
  await ensureSignFlowQuestionnaireSignatureFields(
    documentId,
    Boolean(file.includeQuestionnaire),
  );
  await applyTemplateSigningWorkflowToSignFlowDoc(file, documentId);

  return {
    file,
    editUrl: buildSignFlowEditorUrl(documentId),
    templateId: documentId,
    expiresAt: Math.floor(Date.now() / 1000) + 3600,
    provider: "signflow",
    embedApiKey: publicCfg.embedApiKey,
    appBaseUrl: publicCfg.appBaseUrl,
    testMode: publicCfg.testMode,
  };
}

export async function completeDealEsignSignflowTemplate(params: {
  dealId: string;
  fileId: string;
  signflowDocumentId: string;
  title?: string;
}): Promise<EsignTemplateFileRecord> {
  const state = await getDealEsignTemplatesState(params.dealId);
  const file = findEsignTemplateFile(state, params.fileId);
  if (!file) throw new Error("eSign template file not found");

  const documentId = params.signflowDocumentId.trim();
  if (!documentId) throw new Error("signflowDocumentId is required");

  const doc = await getSignFlowDocument(documentId);
  const hasFields = (doc.fields?.length ?? 0) > 0;
  if (!hasFields) {
    throw new Error(
      "Add at least one signature field in the SignFlow editor before saving this template.",
    );
  }

  file.signflowDocumentId = documentId;
  file.signflowStatus = "ready";
  file.signflowSavedAt = new Date().toISOString();
  file.esignProvider = "signflow";
  if (params.title?.trim()) file.signflowTitle = params.title.trim();

  const inferred = inferSigningWorkflowFromSignFlowDocument(doc);
  if (inferred.workflowType) {
    file.signflowWorkflowType = inferred.workflowType;
  }
  if (inferred.signingOrder) {
    file.signflowSigningOrder = inferred.signingOrder;
  }

  await persistEsignTemplatesJson(params.dealId, state);
  return file;
}
