import { useMemo } from "react";

import { normalizeDealGallerySrc } from "../../../common/utils/apiBaseUrl";
import {
  cloudinaryImgReferrerPolicy,
  getCloudinaryInstance,
  normalizeCloudinaryDeliveryUrl,
} from "../../../common/utils/cloudinaryImage";

function resolveBrandedImageSrc(
  publicId: string | null,
  url: string | null,
): string | null {

  const u = url != null && String(url).trim() ? String(url).trim() : "";

  if (u) {

    const normalized = normalizeDealGallerySrc(u);

    return normalizeCloudinaryDeliveryUrl(normalized) || normalized || u;

  }

  const id = publicId != null && String(publicId).trim() ? String(publicId).trim() : "";

  if (!id) return null;

  return getCloudinaryInstance().image(id).toURL();

}



export type SettingsBrandedImageProps = {

  /** Stored Cloudinary public id (e.g. `investor_portal/companies/.../logo-123`); if set, used with `url-gen` when `url` is empty. */

  publicId: string | null;

  /**

   * Fallback URL: `/uploads/...`, `https` delivery URL, or a `blob:` preview.

   * Used when `publicId` is not available (e.g. local files or pre–public-id data).

   */

  url: string | null;

  alt: string;

  className?: string;

  onError: () => void;

  /**

   * Stable key for React. Prefer the public id when using Cloudinary, or the `url` for `<img>`.

   */

  reactKey: string;

};



/**

 * Logo / background / tab icon: delivery via plain `<img>` and `url` or `url-gen` `toURL()`.

 * Avoids `@cloudinary/react` so strict browser tracking prevention (e.g. Edge) does not

 * report blocked third-party storage for Cloudinary script-driven features.

 *

 * Always `loading="eager"` and `fetchPriority="high"`: in-viewport branding is not a lazy-load

 * candidate; Edge/Chrome can otherwise “Intervention: images loaded lazily…” and defer work.

 * For `https?://` delivery URLs that are not same-origin, `referrerPolicy="no-referrer"` can reduce

 * Edge “Tracking Prevention blocked access to storage” noise for third-party image hosts.

 */

/**
 * Local file preview (`data:` from materialized bytes) — plain `<img>` without Cloudinary/url-gen.
 */
export function BrandingLocalPreviewImg({
  src,
  alt,
  className,
}: {
  src: string;
  alt: string;
  className?: string;
}) {
  return (
    <img
      src={src}
      alt={alt}
      className={className}
      loading="eager"
      decoding="async"
    />
  );
}

export function SettingsBrandedImage({

  publicId,

  url,

  alt,

  className,

  onError,

  reactKey,

}: SettingsBrandedImageProps) {

  const src = useMemo(

    () => resolveBrandedImageSrc(publicId, url),

    [publicId, url],

  );



  if (!src) return null;

  return (

    <img

      key={reactKey}

      src={src}

      alt={alt}

      className={className}

      loading="eager"

      fetchPriority="high"

      decoding="async"

      referrerPolicy={cloudinaryImgReferrerPolicy(src)}

      onError={onError}

    />

  );

}

