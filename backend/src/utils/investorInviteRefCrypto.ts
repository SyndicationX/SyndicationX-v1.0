import {
  createCipheriv,
  createDecipheriv,
  createHash,
  scryptSync,
} from "node:crypto";

const ALGO = "aes-256-gcm";
const IV_LEN = 12;
const KDF_SALT = "investor-invite-ref-v1";
/** Mixed into SHA-256 so IV derivation is distinct from other hashes. */
const IV_DOMAIN = "investor-invite-ref-iv-v1";
const DEAL_IV_DOMAIN = "investor-invite-ref-deal-iv-v1";

export type InvestorInviteRefPayload = {
  sponsorUserId: string;
  dealId: string | null;
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function secretKey(): Buffer {
  const s =
    process.env.INVESTOR_INVITE_SECRET?.trim() ||
    process.env.OFFERING_PREVIEW_SECRET?.trim();
  if (!s) {
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "INVESTOR_INVITE_SECRET (or OFFERING_PREVIEW_SECRET) is required in production.",
      );
    }
    return scryptSync("dev-insecure-investor-invite", KDF_SALT, 32);
  }
  return scryptSync(s, KDF_SALT, 32);
}

/**
 * Stable IV per sponsor id so the same secret + user always yields the same ref
 * (a sponsor's invite link does not change between visits).
 */
function deterministicIvForSponsor(normalizedUserId: string): Buffer {
  return createHash("sha256")
    .update(normalizedUserId, "utf8")
    .update("\0", "utf8")
    .update(IV_DOMAIN, "utf8")
    .digest()
    .subarray(0, IV_LEN);
}

function deterministicIvForSponsorAndDeal(
  normalizedUserId: string,
  normalizedDealId: string,
): Buffer {
  return createHash("sha256")
    .update(normalizedUserId, "utf8")
    .update("\0", "utf8")
    .update(normalizedDealId, "utf8")
    .update("\0", "utf8")
    .update(DEAL_IV_DOMAIN, "utf8")
    .digest()
    .subarray(0, IV_LEN);
}

/**
 * Encrypted sponsor attribution for the investor signup URL (`ref=` query param).
 * Binds the signup to the portal user who shared the link (and optionally a deal),
 * without exposing raw ids. Same sponsor + deal always yields the same token.
 */
export function encryptInvestorInviteRef(
  sponsorUserId: string,
  dealId?: string | null,
): string {
  const id = String(sponsorUserId ?? "").trim();
  if (!UUID_RE.test(id)) {
    throw new Error("Invalid sponsor id for investor invite ref.");
  }
  const normalized = id.toLowerCase();
  const deal = String(dealId ?? "").trim().toLowerCase();
  const hasDeal = Boolean(deal) && UUID_RE.test(deal);
  const payload = hasDeal ? `${normalized}:${deal}` : normalized;
  const key = secretKey();
  const iv = hasDeal
    ? deterministicIvForSponsorAndDeal(normalized, deal)
    : deterministicIvForSponsor(normalized);
  const cipher = createCipheriv(ALGO, key, iv);
  const enc = Buffer.concat([cipher.update(payload, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    iv.toString("base64url"),
    tag.toString("base64url"),
    enc.toString("base64url"),
  ].join(".");
}

export function decryptInvestorInviteRef(
  refToken: string,
): InvestorInviteRefPayload | null {
  const raw = String(refToken ?? "").trim();
  if (!raw || raw.split(".").length !== 3) return null;
  const [ivB64, tagB64, dataB64] = raw.split(".");
  try {
    const key = secretKey();
    const iv = Buffer.from(ivB64, "base64url");
    const tag = Buffer.from(tagB64, "base64url");
    const data = Buffer.from(dataB64, "base64url");
    if (iv.length !== IV_LEN || tag.length !== 16) return null;
    const decipher = createDecipheriv(ALGO, key, iv);
    decipher.setAuthTag(tag);
    const dec = Buffer.concat([decipher.update(data), decipher.final()]);
    const payload = dec.toString("utf8").trim();
    const sep = payload.indexOf(":");
    if (sep < 0) {
      return UUID_RE.test(payload)
        ? { sponsorUserId: payload, dealId: null }
        : null;
    }
    const sponsorUserId = payload.slice(0, sep).trim();
    const dealId = payload.slice(sep + 1).trim();
    if (!UUID_RE.test(sponsorUserId) || !UUID_RE.test(dealId)) return null;
    return { sponsorUserId, dealId };
  } catch {
    return null;
  }
}
