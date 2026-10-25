# Westory application and browser icons

## Current site identity (2026-10-25)

The user supplied `위스토리 로고_full.png` (2163×727, 627,336 bytes) and `위스토리 로고_we.png` (830×423, 229,663 bytes). These supersede the previous text wordmarks and icons throughout the running site. Preserve their artwork and colors; do not redraw or stretch them.

- `westory-wordmark.webp`: cropped transparent full logo, 1024×237, 45,068 bytes. Shared by portal navigation, classic login, public entry, responsive dashboard illustration, game intro and upload watermarks.
- `westory-mark.webp`: cropped transparent We, 256×127, 11,206 bytes. Used by collapsed navigation and the notification preview.
- `public/icons/westory-icon-{180,192,512,1024}.png`: white square, We at 94% of the canvas width. The 1024px tablet-management export is not requested by the site or manifest.
- `public/icons/westory-icon-maskable-512.png`: separate white adaptive icon with the entire artwork inside the central 80%-diameter safe circle.
- `public/icons/westory-favicon-{16,32,48}.png` and `public/favicon.ico`: matching transparent browser exports.

Reproduce with Pillow using `python scripts/export-brand-assets.py <full.png> <we.png>`. Source PNGs remain outside the deployed bundle. Vite fingerprints both WebP URLs; Vercel gives those hashed assets a one-year immutable cache. Public icon URLs use revision `20261025` with a one-day revalidated cache. Manifest identity, start URL, scope and routing are unchanged. Installed apps may refresh their icons on the device's next manifest update.

The shared loading components deliberately display no wordmark. Existing uploaded images are not reprocessed; new uploads use the shared optimized logo.

## Archived upload watermark master (2026-10-25)

`westory-wordmark.png` is the archived full-resolution master, preserved unchanged and no longer imported at runtime. The previous generation used blue **We**, orange **story**, balanced optical letter spacing and deliberate letter angles. Worksheet PDF/page/footnote assets and signatures remain excluded from upload watermarking.

Generation prompt: “Extend the rounded We identity into Westory. We is blue #2563EB; story is orange #F59E0B. Refine optical kerning, consistent negative space and individual letter angles; preserve substantial rounded weight and a modest tilted e. Clean transparent background, no tagline or container.”

## Archived application and browser icon provenance (2026-10-22)

The previous revision was approved by the user on 2026-10-22 after the white-background revision. The following records its historical exports; the current files follow the 2026-10-25 contract above.
Created and edited with the built-in `image_gen` tool. No third-party logo or font file is embedded.

- `westory-app-master.png`: original generated 1254 × 1254 opaque RGB artwork; blue W, amber e, white full-bleed background. No pre-rounded tile, frame or border.
- `westory-browser-master.png`: generated 1254 × 1254 RGBA foreground artwork with genuine transparency. Browser exports retain transparency and the open letter counters.
- `generation-prompts.txt`: exact image-generation/edit prompts for the approved revision.

Application PNG exports in `public/icons/` are 180, 192, 512 and 1024 pixels square, downsampled from the application master using Pillow LANCZOS. The 1024-pixel file is also the tablet-management upload asset. Keep the background opaque and preserve the central mark when operating-system masks are applied. Existing 180/192/512 URLs are retained for external consumers.

Browser PNG exports in `public/icons/` are 16, 32 and 48 pixels square. They use the same exports shown in the approval preview: trim the transparent master to the alpha ≥ 32 bounding box, scale within a square with a 1-pixel transparent gutter on each side, then center it. Preserve the generated alpha; do not flatten onto white. `public/favicon.ico` contains those exact 16/32/48 PNG exports as ICO entries.

`index.html` and the manifest icon URLs use the `20261022` revision query to avoid reusing the previous cached icon. The manifest's application ID, start URL, scope, theme, and routes are unchanged. Both portals receive the same document-head icons; no portal UI or user data is changed.
