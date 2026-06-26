import { MapPin } from "lucide-react"
import {
  isFilledPreviewAssetValue,
  type OfferingPreviewAssetBlock,
} from "../utils/offeringPreviewAssets"
import { DealOfferingGalleryImage } from "./DealOfferingGalleryImage"

const ASSET_METRIC_LABELS: {
  key: keyof Pick<
    OfferingPreviewAssetBlock,
    "assetType" | "yearBuilt" | "numberOfUnits" | "acquisitionPrice"
  >
  label: string
}[] = [
  { key: "assetType", label: "Asset type" },
  { key: "yearBuilt", label: "Year built" },
  { key: "numberOfUnits", label: "Number of units" },
  { key: "acquisitionPrice", label: "Acquisition price" },
]

export interface OfferingPreviewAssetBentoCardProps {
  block: OfferingPreviewAssetBlock
  onViewImages?: () => void
}

export function OfferingPreviewAssetBentoCard({
  block,
  onViewImages,
}: OfferingPreviewAssetBentoCardProps) {
  const blockGalleryCount = block.galleryUrls.length
  const thumbSrc = block.galleryUrls[0]
  const filledMetrics = ASSET_METRIC_LABELS.filter((m) =>
    isFilledPreviewAssetValue(block[m.key]),
  )

  return (
    <article className="deal_offer_pf_bento_asset_card">
      {thumbSrc ? (
        <button
          type="button"
          className="deal_offer_pf_bento_asset_thumb_btn"
          onClick={onViewImages}
          disabled={!onViewImages}
          aria-label={`View images for ${block.name}`}
        >
          <DealOfferingGalleryImage
            src={thumbSrc}
            alt=""
            className="deal_offer_pf_bento_asset_thumb_img"
            loading="lazy"
          />
        </button>
      ) : null}

      <div className="deal_offer_pf_bento_asset_body">
        <div className="deal_offer_pf_bento_asset_head">
          <span className="deal_offer_pf_bento_asset_pin" aria-hidden>
            <MapPin size={15} strokeWidth={2} />
          </span>
          <div className="deal_offer_pf_bento_asset_head_text">
            <h3 className="deal_offer_pf_bento_asset_name">{block.name}</h3>
            {block.address ? (
              <p className="deal_offer_pf_bento_asset_address">{block.address}</p>
            ) : null}
          </div>
        </div>

        {blockGalleryCount > 0 && onViewImages ? (
          <button
            type="button"
            className="deal_offer_pf_assets_view_images deal_offer_pf_bento_asset_view_link"
            onClick={onViewImages}
          >
            View {blockGalleryCount}{" "}
            {blockGalleryCount === 1 ? "image" : "images"}
          </button>
        ) : block.viewImagesCount > 0 ? (
          <p className="deal_offer_pf_assets_image_note" role="status">
            {block.viewImagesCount}{" "}
            {block.viewImagesCount === 1 ? "image" : "images"} on file
          </p>
        ) : (
          <p className="deal_offer_pf_assets_image_note deal_offer_pf_muted">
            No images yet
          </p>
        )}

        {filledMetrics.length > 0 ? (
          <dl className="deal_offer_pf_bento_asset_metrics">
            {filledMetrics.map((m) => (
              <div key={m.key} className="deal_offer_pf_bento_asset_metric">
                <dt>{m.label}</dt>
                <dd>{block[m.key]}</dd>
              </div>
            ))}
          </dl>
        ) : null}
      </div>
    </article>
  )
}
