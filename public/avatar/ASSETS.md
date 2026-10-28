# Avatar assets

The two fully clothed student figures originate from the separate avatar beta.
Their authored geometry, 4K base-color atlas, corrected +Z rig, and validated
skin weights are retained. Normal and material textures were optimized offline.
No student portrait or personal information is embedded in these files.

`v1/models/*-color-mask.png`: garment recoloring channels.
`v1/models/*-appearance-mask.png`: skin and hair recoloring channels.
`v1/models/*-plain-mask.png`: unprinted basic top, bottom, and shoe channels.
Masks are linear data with `flipY=false`; alpha stays opaque.

Plain masks can be rebuilt using
`src/features/avatar/renderer/generate-plain-masks.py` with Pillow and NumPy.
Basic clothing removes printed color and texture details; it retains the source
garment shape, seams and sculpted folds. It is not a separate pajama garment mesh.

The GLBs and renderer load in My Page after a character is chosen. Rankings and
the hall of fame use saved static thumbnails without loading 3D. Fallback
previews use `v1/girl-preview-v2.webp` and `v1/boy-preview-v2.webp`,
captured from the actual renderer with the default plain clothing and relaxed
`idle` pose. The arms rest beside the body with a soft elbow bend; the rigs have
hand bones but no finger joints. Other selectable poses retain their existing
bone transforms. The original preview files remain available for older clients.

The v2 previews are transparent 384 × 640 WebP images, captured through
`createAvatarStage` with `defaultAvatarLook(character)` and pixel ratio 1, then
encoded at quality 90. Versioned filenames avoid stale immutable asset caches.
The unchosen avatar uses `v1/neutral-silhouette-v2.svg` (384 × 640), an
original code-authored outline with a transparent background and a single
neutral fill (`#cbd5e1`). The large round head, short body, relaxed arms and
rounded hands/feet retain the avatar proportions. Torso and limbs have smooth
continuous contours with no waist, muscle or joint emphasis. There are no
facial details, hair, clothing, shading, highlights or pedestal. Feet remain
at the shared 87% preview baseline so podium alignment is preserved. The UI
overlays the question mark; no character or gender is assigned.
The earlier geometric SVG and generated `neutral-base-v1.webp` remain only
for older clients. The v2 silhouette is editable vector source and does not
use image generation.
New saved thumbnails preserve the renderer's alpha so
the character stands naturally against the hall of fame background.
Runtime choices do not request image generation or model generation services.
