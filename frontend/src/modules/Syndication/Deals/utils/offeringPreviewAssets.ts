import { dealDisplayFieldText, type DealDetailApi } from "../api/dealsApi"
import {
  assetTypeFromAttributes,
  computeDealAssetRowsFromClientStorage,
  formatAddressFromAssetDraft,
  formatAttributeValue,
  getDealAssetPersisted,
  type AssetAttributeRow,
  type DealAssetRow,
} from "../types/deal-asset.types"
import { normalizeDealGallerySrc } from "../../../../common/utils/apiBaseUrl"
import { formatMoneyFieldDisplay } from "./offeringMoneyFormat"

export type OfferingPreviewAssetBlock = {
  id: string
  name: string
  address: string
  assetType: string
  yearBuilt: string
  numberOfUnits: string
  acquisitionPrice: string
  viewImagesCount: number
  galleryUrls: string[]
}

function dedupeNormalizedUrls(urls: readonly string[] | undefined): string[] {
  if (!urls?.length) return []
  const out: string[] = []
  const seen = new Set<string>()
  for (const raw of urls) {
    const u = normalizeDealGallerySrc(raw).trim()
    if (!u) continue
    const key = u.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(u)
  }
  return out
}

function attrDisplay(
  rows: AssetAttributeRow[] | undefined,
  attrId: string,
): string {
  if (!rows?.length) return ""
  const r = rows.find((x) => x.id === attrId)
  if (!r) return ""
  const s = formatAttributeValue(r)
  return s.trim()
}

/** True when a preview asset metric should render (not blank / em dash). */
export function isFilledPreviewAssetValue(value: string | undefined): boolean {
  const t = String(value ?? "").trim()
  return Boolean(t) && t !== "—"
}

function filledPreviewText(raw: string | undefined): string {
  const t = dealDisplayFieldText(raw)
  if (!t || t === "—") return ""
  return t
}

function acquisitionPriceDisplay(
  rows: AssetAttributeRow[] | undefined,
): string {
  const raw = attrDisplay(rows, "attr-acq-price")
  if (!raw) return ""
  const formatted = formatMoneyFieldDisplay(raw)
  return formatted !== "—" ? formatted : raw
}

/** Full deal address for offering preview “Location” section. */
export function formatOfferingPreviewDealAddress(detail: DealDetailApi): string {
  const street = [detail.addressLine1, detail.addressLine2]
    .map((x) => dealDisplayFieldText(x))
    .filter(Boolean)
    .join(", ")
  const locality = [detail.city, detail.state, detail.zipCode]
    .map((x) => dealDisplayFieldText(x))
    .filter(Boolean)
    .join(", ")
  const country = dealDisplayFieldText(detail.country)
  const parts = [street, locality, country].filter(Boolean)
  if (parts.length) return parts.join(", ")
  const cityCountry = [dealDisplayFieldText(detail.city), country]
    .filter(Boolean)
    .join(", ")
  return cityCountry || "—"
}

function orderedPreviewAssetRows(detail: DealDetailApi): DealAssetRow[] {
  const rows = computeDealAssetRowsFromClientStorage(detail).filter(
    (r) => !r.archived,
  )
  const ids = detail.offeringOverviewAssetIds?.filter(Boolean) ?? []
  const ordered: DealAssetRow[] = []
  if (ids.length > 0) {
    for (const id of ids) {
      const row = rows.find((r) => r.id === id)
      if (row) ordered.push(row)
    }
  }
  if (ordered.length === 0 && rows.length > 0) ordered.push(rows[0]!)
  return ordered
}

/**
 * Data for the offering preview “Assets” block (browser localStorage + deal fields).
 * LPs on a shared link only see persisted offering gallery + deal fields unless they
 * have the same origin storage as the sponsor.
 */
export function buildOfferingPreviewAssetBlocks(
  detail: DealDetailApi,
  galleryUrls: readonly string[],
): OfferingPreviewAssetBlock[] {
  const ordered = orderedPreviewAssetRows(detail)
  const galleryUrlCount = galleryUrls.length
  const singleAssetDeal = ordered.length <= 1
  if (ordered.length === 0) {
    const fallbackAddress = filledPreviewText(
      formatOfferingPreviewDealAddress(detail),
    )
    return [
      {
        id: `fallback-${detail.id}`,
        name: filledPreviewText(detail.propertyName) || "Offering asset",
        address: fallbackAddress,
        assetType: "",
        yearBuilt: "",
        numberOfUnits: "",
        acquisitionPrice: "",
        viewImagesCount: Math.max(0, galleryUrlCount),
        galleryUrls: dedupeNormalizedUrls(galleryUrls),
      },
    ]
  }

  return ordered.map((row, index) => {
    const persisted = getDealAssetPersisted(detail.id, row.id)
    const attrs = persisted?.attrRows
    const address =
      persisted?.draft != null
        ? formatAddressFromAssetDraft(persisted.draft).trim() ||
          row.address?.trim() ||
          formatOfferingPreviewDealAddress(detail)
        : row.address?.trim() || formatOfferingPreviewDealAddress(detail)

    const assetTypeRaw =
      row.assetType && row.assetType !== "—"
        ? row.assetType.trim()
        : attrs
          ? assetTypeFromAttributes(attrs)
          : ""
    const assetType = filledPreviewText(assetTypeRaw)

    const yearBuilt = filledPreviewText(attrDisplay(attrs, "attr-year-built"))
    const numberOfUnits = filledPreviewText(attrDisplay(attrs, "attr-num-units"))

    const dealGalleryFallback = dedupeNormalizedUrls(galleryUrls)
    const rowGalleryUrls = dedupeNormalizedUrls(persisted?.imagePreviewDataUrls)
    const effectiveGalleryUrls =
      rowGalleryUrls.length > 0
        ? rowGalleryUrls
        : singleAssetDeal || (index === 0 && dealGalleryFallback.length > 0)
          ? dealGalleryFallback
          : []

    let viewImagesCount = Math.max(row.imageCount ?? 0, effectiveGalleryUrls.length)
    if (viewImagesCount === 0 && singleAssetDeal) viewImagesCount = galleryUrlCount

    return {
      id: row.id,
      name:
        filledPreviewText(row.name) ||
        filledPreviewText(detail.propertyName) ||
        "Offering asset",
      address: filledPreviewText(address),
      assetType,
      yearBuilt,
      numberOfUnits,
      acquisitionPrice: acquisitionPriceDisplay(attrs),
      viewImagesCount,
      galleryUrls: effectiveGalleryUrls,
    }
  })
}
