import { nationalDigitsFromStoredPhone } from "@/common/phone/usPhoneNumber"
import type { SavedAddress } from "@/modules/Investing/pages/profiles/address.types"
import type { InvestorProfileListRow } from "@/modules/Investing/pages/profiles/investor-profiles.types"
import { readSessionUser } from "@/modules/myaccount/sessionUser"
import {
  questionsForSection,
  type InvestorQuestionnaireConfig,
} from "@/modules/Syndication/Deals/tabs/esign_templates/investorQuestionnaire.types"
import { formatInvestNowW9AddressLine } from "./investNowW9FormUtils"
import type { InvestNowQuestionnaireAnswers } from "./investNowQuestionnaireValidation"

function readWizardState(
  profile: InvestorProfileListRow,
): Record<string, unknown> | null {
  const raw = profile.profileWizardState
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null
  return raw as Record<string, unknown>
}

function strField(wizard: Record<string, unknown> | null, key: string): string {
  if (!wizard) return ""
  return String(wizard[key] ?? "").trim()
}

function sessionStr(camelKey: string): string {
  const u = readSessionUser()
  if (!u) return ""
  const camel = u[camelKey]
  if (typeof camel === "string" && camel.trim()) return camel.trim()
  const snakeKey = camelKey.replace(/([A-Z])/g, "_$1").toLowerCase()
  const snake = u[snakeKey]
  return typeof snake === "string" ? snake.trim() : ""
}

function formatAddressLine(addr: SavedAddress): string {
  return formatInvestNowW9AddressLine({
    street1: addr.street1,
    street2: addr.street2,
    city: addr.city,
    state: addr.state,
    zip: addr.zip,
  })
}

function resolveTaxAddress(
  wizard: Record<string, unknown> | null,
  addresses: SavedAddress[],
): SavedAddress | undefined {
  const taxId = strField(wizard, "taxAddressId")
  if (taxId) {
    const match = addresses.find((a) => a.id === taxId)
    if (match) return match
  }
  return addresses[0]
}

function resolveTelephone(
  wizard: Record<string, unknown> | null,
): string {
  const fromWizard = strField(wizard, "phone2")
  if (fromWizard) return nationalDigitsFromStoredPhone(fromWizard)
  const fromSession = sessionStr("phone")
  if (fromSession) return nationalDigitsFromStoredPhone(fromSession)
  return ""
}

function personalPrefillValue(
  questionId: string,
  ctx: {
    firstName: string
    lastName: string
    telephone: string
    addressLine: string
  },
): string | undefined {
  switch (questionId) {
    case "first_name":
      return ctx.firstName || undefined
    case "last_name":
      return ctx.lastName || undefined
    case "telephone":
      return ctx.telephone || undefined
    case "address":
      return ctx.addressLine || undefined
    case "social_security_number":
      return undefined
    default:
      return undefined
  }
}

/** Fill empty questionnaire answers from the selected investing profile and session user. */
export function buildInvestNowQuestionnairePrefill({
  profiles,
  addresses,
  savedUserProfileId,
  config,
  sectionId = "personal",
}: {
  profiles: InvestorProfileListRow[]
  addresses: SavedAddress[]
  savedUserProfileId: string
  config?: InvestorQuestionnaireConfig | null
  sectionId?: string
}): InvestNowQuestionnaireAnswers {
  const profile = profiles.find((p) => p.id === savedUserProfileId.trim())
  const wizard = profile ? readWizardState(profile) : null

  const firstName =
    strField(wizard, "firstName") || sessionStr("firstName")
  const lastName =
    strField(wizard, "lastName") || sessionStr("lastName")
  const telephone = resolveTelephone(wizard)
  const taxAddr = resolveTaxAddress(wizard, addresses)
  const addressLine = taxAddr ? formatAddressLine(taxAddr) : ""

  const ctx = { firstName, lastName, telephone, addressLine }

  const questionIds = config
    ? questionsForSection(config.questions, sectionId).map((q) => q.id)
    : [
        "first_name",
        "last_name",
        "telephone",
        "address",
        "state_residency_duration",
        "birth_date",
        "us_tax_resident",
        "social_security_number",
      ]

  const out: InvestNowQuestionnaireAnswers = {}
  for (const id of questionIds) {
    const value = personalPrefillValue(id, ctx)
    if (value) out[id] = value
  }
  return out
}

/** Apply prefill without overwriting answers the investor already entered. */
export function mergeInvestNowQuestionnaireAnswers(
  current: InvestNowQuestionnaireAnswers,
  prefill: InvestNowQuestionnaireAnswers,
): InvestNowQuestionnaireAnswers {
  let changed = false
  const next = { ...current }
  for (const [key, value] of Object.entries(prefill)) {
    if (!value.trim()) continue
    if (!String(next[key] ?? "").trim()) {
      next[key] = value
      changed = true
    }
  }
  return changed ? next : current
}
