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

## Hanbok, official robes and summer uniforms (2026-10-28)

`src/features/avatar/renderer/garments.js` creates original Three.js geometry for
three jeogori colorways, three chima skirts, three baji trousers, navy/red/black
official robes, a samo, a gat, and the white/navy Yongshin summer polo with dark
shorts. Collars, white dongjeong, goreum ribbons, broad sleeves, skirt pleats,
belts, robe silhouettes and hat wings/brims are geometry rather than recolors of
the original jacket. Navy and black robes use an original stylized crane/cloud
badge drawn by code; it is decorative and does not claim a historical rank.
User-provided references informed garment shape/color only. No person, face,
school photograph or third-party image is embedded in the garments or badge.

Garment pieces attach to the existing skeleton in bind space and follow the
six supported poses. Replacement tops hide the authored jacket; replacement
bottoms also hide the authored leg surface to avoid clipping through shorts.
Short sleeves and shorts provide their own skin-colored limb surfaces and
reuse the selected skin palette. Source head, hair, hands and footwear retain
the existing appearance controls. A robe visually covers the selected bottom,
which returns when the user selects another top. Unchosen avatar silhouettes
are unchanged. Each garment is built lazily once per stage and reused when
switching looks; no additional model, texture or server request is made for an
individual garment choice. The generated geometry and badge texture are disposed
with the stage. New catalog IDs use the existing top/bottom/accessory slots and
additive catalog version 1; their initial price is zero, with school pricing
controlled by the administrator.
