# Westory application and browser icons

## Upload watermark wordmark (2026-10-25)

`westory-wordmark.png` extends the approved rounded We mark into Westory using the built-in `image_gen` tool. The user requested blue **We**, orange **story**, balanced optical letter spacing and deliberate letter angles. This transparent master is preserved unchanged; `brandWatermark.ts` trims transparent margins in memory and applies it once after each eligible upload's final crop/resize. Worksheet PDF/page/footnote assets and signatures are excluded. This does not replace the portal headers or application icons.

Generation prompt: “Extend the rounded We identity into Westory. We is blue #2563EB; story is orange #F59E0B. Refine optical kerning, consistent negative space and individual letter angles; preserve substantial rounded weight and a modest tilted e. Clean transparent background, no tagline or container.”

## Application and browser icons (2026-10-22)

Approved by the user on 2026-10-22 after the white-background revision.
Created and edited with the built-in `image_gen` tool. No third-party logo or font file is embedded.

- `westory-app-master.png`: original generated 1254 × 1254 opaque RGB artwork; blue W, amber e, white full-bleed background. No pre-rounded tile, frame or border.
- `westory-browser-master.png`: generated 1254 × 1254 RGBA foreground artwork with genuine transparency. Browser exports retain transparency and the open letter counters.
- `generation-prompts.txt`: exact image-generation/edit prompts for the approved revision.

Application PNG exports in `public/icons/` are 180, 192, 512 and 1024 pixels square, downsampled from the application master using Pillow LANCZOS. The 1024-pixel file is also the tablet-management upload asset. Keep the background opaque and preserve the central mark when operating-system masks are applied. Existing 180/192/512 URLs are retained for external consumers.

Browser PNG exports in `public/icons/` are 16, 32 and 48 pixels square. They use the same exports shown in the approval preview: trim the transparent master to the alpha ≥ 32 bounding box, scale within a square with a 1-pixel transparent gutter on each side, then center it. Preserve the generated alpha; do not flatten onto white. `public/favicon.ico` contains those exact 16/32/48 PNG exports as ICO entries.

`index.html` and the manifest icon URLs use the `20261022` revision query to avoid reusing the previous cached icon. The manifest's application ID, start URL, scope, theme, and routes are unchanged. Both portals receive the same document-head icons; no portal UI or user data is changed.
