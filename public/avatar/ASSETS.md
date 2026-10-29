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

## Item previews and rebuilt shapes (2026-10-28 follow-up)

Garments now use continuous skinned surfaces across shoulders, elbows and
waists, with shared weights at each connection. Collars and ribbons follow the
torso surface. Robes and skirts have continuous pleated hems; trousers taper
without detached joint spheres. The existing skeleton, palettes and six poses
remain authoritative. Geometry is reused within a stage and disposed with it.
The fused base's clothing masks protect its collar while replacing hair.
`renderer/native-collar.js` closes the female base jacket's open inner collar
with a small spine-attached lining that shares the source textures and colorway
uniforms. Replacement tops hide that lining; disposing it leaves shared atlas
textures to their original owner.

`v1/models/hair-v3/` contains six original hair models: volume, side-swept
waves, upswept short hair, Toben-inspired short hair, twin tails and half-up
hair. Higgsfield generated front/left/back/right reference renders and converted
those renders to textured GLBs with Tripo H3.1 multiview generation. No student
photo or personal information was supplied. MapleStory's official hair previews
informed silhouette research only; no Nexon image, mesh or texture is shipped.
The original detailed bob/curtain meshes remain the defaults; long waves retain
and reshape the original mesh and UVs in `renderer/hair-source-styles.js`.

The six GLBs total 11,206,408 bytes, reduced from 70,785,460 bytes by resizing
embedded textures while preserving geometry and UVs. Reproduce optimization
with `node scripts/optimize-avatar-hair-assets.mjs <source.glb> --verify-browser`.
Source-to-final geometry, bounds, texture links and browser rendering are checked
by that script. Runtime loading is local to the site, lazy per selected style,
and cached within the stage; it makes no AI-service requests. Selection prepares
the model before applying or saving the look. Aborted selections and disposed
stages release their resources, and loading failures expose an explicit retry.

Final Higgsfield 3D generation jobs:

- `toben`: `deb19c05-1cb0-49d6-be48-a832ba407276`
- `volume`: `b7ef3bd2-de51-4192-b4c0-69289da42f89`
- `wave`: `20c45d06-bb7e-4f62-9c9c-02f16ffedd08`
- `crop`: `3fb9675a-abea-4c69-a920-d9b6e42e27cc`
- `twin-tail`: `d941cc43-99b0-4d7c-b746-dd0293bb67cb`
- `half-up`: `770cf11f-ac2b-4b5f-a707-14b329503224`

`v1/previews-v3/{girl,boy}/*.webp` contains 256 × 256 static captures of every
supported catalog item and character combination. Clothing previews use the
actual dressed model; portrait, lower-body and shoe items use appropriate
camera framing. The picker and pricing manager share these images instead of
creating a WebGL context per card. These assets contain no student records.

Rebuild with `node scripts/render-avatar-item-previews.mjs`; validate with
`npm run verify:avatar-previews`. The manifest records source fingerprints,
item coverage and image hashes. Build validation rejects stale captures and
enforces a 50 KB per-image / 4 MB total budget. Existing saved profile thumbnails
remain unchanged until their owners save their appearance again.

## Original-art 2D replacement (2026-10-29)

The user selected original-art 2D after review of the arm and short-hair defects.
This supersedes the 3D runtime described above. The studio now loads the local
`v2/manifest.json` and transparent WebP artwork into a Canvas 2D compositor.
It makes no WebGL, GLB, AI-service or external artwork request. Rendering occurs
only after a look, viewport or visibility change; there is no animation loop.
Full-body and face framing remain, while the 3D rotation controls are removed.

Six original component sheets, a paired heart-hand sprite and a fitted headphone overlay were generated with the built-in OpenAI
`image_gen` tool. Source sheets, provenance and the prompt specification are
in `assets/avatar-source/v2/`. No real student/teacher photos or records were
inputs, and no third-party game sprites, meshes or textures are shipped.
`scripts/avatar-2d-art-registry.json` explicitly registers crop boundaries,
placements, palettes and pose joints. `scripts/build-avatar-2d-assets.mjs`
compiles the source sheets into `v2/layers/` and a validated manifest.

All 84 catalog IDs, prices, ownership and server save contracts remain unchanged.
Layered arms, sleeves and hands compose the six poses. Skin and hair colors
preserve the artwork's shading; face, outfit accents and eyes are not recolored.
As before, a robe covers the selected bottom until another top is selected.

`v2/previews/{girl,boy}/*.webp` contains 256 × 256 static item captures from the
same renderer, with portrait, clothing, lower-body and footwear framing.
The shared picker and administrator price manager use these images. Build
validation checks original sheet, registry, compiler, layer and preview hashes,
complete catalog coverage, and a 50 KB per-image / 4 MB preview budget. Visual
review of assembled characters separately checks fit, seams and all poses.

Rebuild with `node scripts/build-avatar-2d-assets.mjs --spec scripts/avatar-2d-art-registry.json`
and `node scripts/render-avatar-item-previews.mjs`; check with
`npm run verify:avatar-previews`. New v2 URLs use revalidation rather than the
old immutable v1 cache. Old v1 assets remain for already-open clients. Existing
saved profile thumbnails update only when their owner explicitly saves again;
the studio allows this even when the selected items have not changed.
