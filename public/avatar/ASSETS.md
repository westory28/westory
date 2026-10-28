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
The unchosen avatar uses the authored `v1/neutral-silhouette.svg` alpha mask:
the same large-head/short-body proportions, a round hairless head, a straight
featureless torso, and relaxed limbs without clothing or anatomical details.
It retains the pedestal and centered question mark, and assigns no character
or gender to the student. New saved thumbnails preserve the renderer's alpha so
the character stands naturally against the hall of fame background.
Runtime choices do not request image generation or model generation services.
