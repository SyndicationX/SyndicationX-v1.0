import type { DropboxSignFormFieldPerDocument } from "../esign/dropboxSign.service.js";
import type { DropboxSignPrefillCustomField } from "../esign/dropboxSign.service.js";
import type { SignFlowField } from "../esign/signflow.service.js";
import { formatEinDisplay, nineDigitsFromEinInput } from "../../common/tax/usEin.js";
import type {
  InvestorQuestionnaireJson,
  InvestorQuestionnaireQuestion,
} from "./dealInvestorQuestionnaire.service.js";
import type { InvestorQuestionnaireAnswersMap } from "./investorQuestionnaireAnswers.service.js";

function normalizeFieldKey(raw: string): string {
  return String(raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, " ");
}

/** Dropbox field labels / api ids that receive a computed full name. */
const COMPUTED_FULL_NAME_FIELD_KEYS = new Set(
  [
    "print name",
    "fullname1",
    "full name",
    "investor name",
    "name",
    "subscriber name",
    "signer name",
  ].map((s) => normalizeFieldKey(s)),
);

const COMPUTED_DATE_FIELD_KEYS = new Set(
  ["date", "datesigned1", "date signed", "signed date"].map((s) =>
    normalizeFieldKey(s),
  ),
);

const COMPUTED_TITLE_FIELD_KEYS = new Set(
  [
    "print title (if applicable)",
    "print title",
    "title1",
    "title",
    "authorized title",
  ].map((s) => normalizeFieldKey(s)),
);

/**
 * Extra aliases for sponsor-placed fields whose label does not match question id.
 * Keys are normalized field keys; values are questionnaire question ids.
 */
const FIELD_KEY_TO_QUESTION_ID: Record<string, string> = {
  [normalizeFieldKey("First Name")]: "first_name",
  [normalizeFieldKey("Last Name")]: "last_name",
  [normalizeFieldKey("Telephone")]: "telephone",
  [normalizeFieldKey("Phone")]: "telephone",
  [normalizeFieldKey("Phone Number")]: "telephone",
  [normalizeFieldKey("Address")]: "address",
  [normalizeFieldKey("Mailing Address")]: "address",
  [normalizeFieldKey("SSN")]: "social_security_number",
  [normalizeFieldKey("TIN")]: "social_security_number",
  [normalizeFieldKey("Social Security Number")]: "social_security_number",
  [normalizeFieldKey("Birth Date")]: "birth_date",
  [normalizeFieldKey("Date of Birth")]: "birth_date",
  [normalizeFieldKey("Entity Legal Name")]: "entity_full_legal_name",
  [normalizeFieldKey("Entity Name")]: "entity_full_legal_name",
  [normalizeFieldKey("Email")]: "email",
  [normalizeFieldKey("Email Address")]: "email",
  [normalizeFieldKey("Investment Amount")]: "investment_amount",
  [normalizeFieldKey("Commitment Amount")]: "investment_amount",
  [normalizeFieldKey("Amount")]: "investment_amount",
};

export type EsignQuestionnairePrefillContext = {
  memberDisplayName?: string;
  memberEmail?: string;
  investmentAmount?: string;
};

function formatAnswerForEsign(
  question: InvestorQuestionnaireQuestion,
  raw: string | undefined,
): string {
  const value = String(raw ?? "").trim();
  if (!value) return "";

  if (question.fieldType === "boolean") {
    if (value === "yes") return "Yes";
    if (value === "no") return "No";
    return value;
  }

  if (question.fieldType === "checkboxes") {
    try {
      const parsed = JSON.parse(value) as unknown;
      if (Array.isArray(parsed)) {
        const items = parsed.filter((v): v is string => typeof v === "string");
        return items.join(", ");
      }
    } catch {
      /* use raw */
    }
    return value;
  }

  if (question.fieldType === "phone") {
    const digits = value.replace(/\D/g, "");
    if (digits.length === 10) {
      return `+1 (${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
    }
    return value;
  }

  if (question.fieldType === "ssn") {
    const digits = value.replace(/\D/g, "").slice(0, 9);
    if (digits.length === 9) {
      return `${digits.slice(0, 3)}-${digits.slice(3, 5)}-${digits.slice(5)}`;
    }
    return value;
  }

  if (
    question.fieldType === "ein" ||
    question.id === "ira_entity_custodian_ein" ||
    question.id === "ira_entity_partner_ein"
  ) {
    const digits = nineDigitsFromEinInput(value);
    if (digits.length === 9) return formatEinDisplay(digits);
    return value;
  }

  return value.replace(/\s+/g, " ").trim();
}

function buildFormattedAnswerMap(
  config: InvestorQuestionnaireJson,
  answers: InvestorQuestionnaireAnswersMap,
): Map<string, string> {
  const out = new Map<string, string>();
  for (const question of config.questions) {
    const id = question.id.trim();
    if (!id) continue;
    const formatted = formatAnswerForEsign(question, answers[id]);
    if (formatted) out.set(id, formatted);
  }
  return out;
}

function resolveFullName(
  formatted: Map<string, string>,
  memberDisplayName?: string,
): string {
  const fromParts = [formatted.get("first_name"), formatted.get("last_name")]
    .filter(Boolean)
    .join(" ")
    .trim();
  if (fromParts) return fromParts;
  return String(memberDisplayName ?? "").trim();
}

function resolvePrintTitle(formatted: Map<string, string>): string {
  return (
    formatted.get("entity_authorized_title") ??
    formatted.get("ira_entity_account_holder_title") ??
    ""
  ).trim();
}

function resolveSigningDate(): string {
  return new Date().toLocaleDateString("en-US");
}

function resolveValueForFieldKey(
  fieldKey: string,
  formatted: Map<string, string>,
  prefillContext?: EsignQuestionnairePrefillContext,
): string {
  if (COMPUTED_FULL_NAME_FIELD_KEYS.has(fieldKey)) {
    return resolveFullName(formatted, prefillContext?.memberDisplayName);
  }

  if (COMPUTED_TITLE_FIELD_KEYS.has(fieldKey)) {
    return resolvePrintTitle(formatted);
  }

  if (COMPUTED_DATE_FIELD_KEYS.has(fieldKey)) {
    return resolveSigningDate();
  }

  const questionId =
    FIELD_KEY_TO_QUESTION_ID[fieldKey] ?? fieldKey.replace(/\s+/g, "_");
  if (formatted.has(questionId)) {
    return formatted.get(questionId) ?? "";
  }

  if (questionId === "email") {
    const email = prefillContext?.memberEmail?.trim();
    if (email) return email;
  }

  if (questionId === "investment_amount") {
    const amt = prefillContext?.investmentAmount?.trim();
    if (amt) return amt;
  }

  for (const [qid, value] of formatted.entries()) {
    if (normalizeFieldKey(qid) === fieldKey) return value;
  }

  return "";
}

function customFieldNameForFormField(
  field: DropboxSignFormFieldPerDocument,
): string {
  const name = String(field.name ?? "").trim();
  if (name) return name;
  return String(field.apiId ?? "").trim();
}

export type QuestionnaireEsignPrefillResult = {
  formFields: DropboxSignFormFieldPerDocument[];
  customFields: DropboxSignPrefillCustomField[];
};

/**
 * Matches Dropbox Sign template / questionnaire signature fields to questionnaire
 * answers and returns merge-field custom_field values for embedded signing.
 */
export function applyQuestionnairePrefillToEsignFormFields({
  formFields,
  config,
  answers,
  memberDisplayName,
  prefillContext,
}: {
  formFields: DropboxSignFormFieldPerDocument[];
  config: InvestorQuestionnaireJson;
  answers: InvestorQuestionnaireAnswersMap;
  memberDisplayName?: string;
  prefillContext?: EsignQuestionnairePrefillContext;
}): QuestionnaireEsignPrefillResult {
  const ctx: EsignQuestionnairePrefillContext = {
    memberDisplayName:
      prefillContext?.memberDisplayName?.trim() || memberDisplayName?.trim(),
    memberEmail: prefillContext?.memberEmail?.trim(),
    investmentAmount: prefillContext?.investmentAmount?.trim(),
  };

  const formatted = buildFormattedAnswerMap(config, answers);
  if (
    !formatted.size &&
    !ctx.memberDisplayName &&
    !ctx.memberEmail &&
    !ctx.investmentAmount
  ) {
    return { formFields, customFields: [] };
  }

  const customFields: DropboxSignPrefillCustomField[] = [];
  const seenNames = new Set<string>();

  const nextFields = formFields.map((field) => {
    if (field.type !== "text" && field.type !== "text-merge") {
      return field;
    }

    const fieldName = customFieldNameForFormField(field);
    if (!fieldName) return field;

    const fieldKey = normalizeFieldKey(fieldName);
    const apiKey = normalizeFieldKey(field.apiId);
    const value =
      resolveValueForFieldKey(fieldKey, formatted, ctx) ||
      resolveValueForFieldKey(apiKey, formatted, ctx);
    if (!value) return field;

    const customName = fieldName;
    if (!seenNames.has(customName.toLowerCase())) {
      seenNames.add(customName.toLowerCase());
      customFields.push({ name: customName, value });
    }

    return { ...field, type: "text-merge" as const };
  });

  return { formFields: nextFields, customFields };
}

function signFlowFieldPrefillType(type: string): boolean {
  const t = String(type ?? "").trim().toLowerCase();
  return t === "text" || t === "date" || t === "date_signed";
}

/**
 * Pre-fills SignFlow text/date fields on the questionnaire signature page (and
 * other investor fields whose labels match questionnaire answers).
 */
export function applyQuestionnairePrefillToSignFlowFields({
  fields,
  config,
  answers,
  memberDisplayName,
  prefillContext,
}: {
  fields: SignFlowField[];
  config: InvestorQuestionnaireJson;
  answers: InvestorQuestionnaireAnswersMap;
  memberDisplayName?: string;
  prefillContext?: EsignQuestionnairePrefillContext;
}): SignFlowField[] {
  const ctx: EsignQuestionnairePrefillContext = {
    memberDisplayName:
      prefillContext?.memberDisplayName?.trim() || memberDisplayName?.trim(),
    memberEmail: prefillContext?.memberEmail?.trim(),
    investmentAmount: prefillContext?.investmentAmount?.trim(),
  };

  const formatted = buildFormattedAnswerMap(config, answers);
  if (
    !formatted.size &&
    !ctx.memberDisplayName &&
    !ctx.memberEmail &&
    !ctx.investmentAmount
  ) {
    return fields;
  }

  return fields.map((field) => {
    if (!signFlowFieldPrefillType(field.type)) return field;

    const fieldKey = normalizeFieldKey(field.label);
    const value = resolveValueForFieldKey(fieldKey, formatted, ctx);
    if (!value) return field;

    return { ...field, value };
  });
}
