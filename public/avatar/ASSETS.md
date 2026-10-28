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

The GLBs and renderer are loaded only after explicit 3D activation. Static
dashboard previews use `v1/girl-preview.webp` and `v1/boy-preview.webp`, captured
from the actual renderer with the default plain clothing. Runtime choices do not request
image generation or model generation services.
