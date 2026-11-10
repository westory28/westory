# Pose-specific avatar wardrobe

Created 2026-11-10 using the user's connected Higgsfield account, model `gpt_image_2_6` (GPT Image 2.6), high quality, transparent PNG. The first reference was Westory's own public static default avatar preview. Later sheets reference that newly generated jacket atlas. No photographs, student/teacher records, credentials, or other user data were transmitted. This is development-time art generation; the application makes no AI calls.

| File | Job ID | Prompt specification |
| --- | --- | --- |
| jacket-poses.png | 18f8261b-18b9-41dd-94d7-dc99b33b91de | Six equal cells, 3×2: headless varsity jacket with ivory sleeves, clean navy torso, ribbed cuffs, subtle pockets and buttons, no logos. Relaxed, wave, cheer, thoughtful hand at chin, hands forming a heart, repeated relaxed. Connected natural shoulders/elbows/wrists; warm peach hands and short neck; no head, hair, lower body or background. |
| plain-poses.png | 15f1152a-a1fc-4951-9782-7103f3b29d69 | Same pose/registration atlas, light heather gray crewneck sweatshirt, soft folds and ribbed neck/cuffs/hem. |
| jeogori-poses.png | 4cdb239f-7b7f-4708-9410-c9840958d542 | Same pose/registration atlas, dusty rose jeogori, ivory crossed collar, burgundy goreum, curved flowing sleeves with visible wrists. |
| polo-poses.png | 4b26207a-82dd-4f14-8222-ceb95065ab02 | Same pose/registration atlas, ivory summer polo, navy collar/sleeve edges, three-button placket, short sleeves and naturally connected bare forearms. |
| robe-poses.png | 96ffc8e2-81ec-4da4-9e3c-091c2e8557fc | Same poses, full calf-length blue danryeong, ivory inner collar, dark red/gold belt, original crane insignia, continuous skirt and naturally bending wide sleeves. |
| bottoms.png | 7e65373a-5b51-4f15-8eaf-fb75af66ee68 | Six isolated front-view lower garments: charcoal trousers, navy pleated skirt, blue chima, cream baji, navy shorts, gray trousers. Matched waist anchors; no bodies or feet. |
| shoes.png | 9f226e95-d51d-4662-bd1e-15825e96f69e | Six pairs: charcoal slip-ons, dusty rose/ivory/sky blue/lavender sneakers, repeated slip-ons. Small rounded toes, ivory soles, same stance and baseline, no brands. |

Shared prompt: original Korean casual-game 2D illustration, soft tapered dark outlines, restrained cel shading, compact avatar proportions, consistent front view, genuinely transparent background, no text/grid/glow/cast shadows. Each atlas was inspected before registration. Preserve the supplied alpha rather than treating invisible RGB around the artwork as a painted backdrop.

`scripts/register-avatar-outfits.mjs` records source hashes, crop cells, shared fit anchors, palette variants, pose selections, front/rear hair layers and hat masks in `scripts/avatar-2d-art-registry.json`. `scripts/build-avatar-2d-assets.mjs` creates bounded 640px WebP layers and explicit skin masks. The robe uses authored `skinPolygons` around each pose's neck and hands in source-cell coordinates; optional `skinRegions` intersect these outlines. The same original mask drives normalization, skin tint and garment-color exclusion, preserving the collar, crane badge and gold belt. Lossless masks preserve tint boundaries; garment WebP is quality 90 with full-quality alpha. Source PNGs are never loaded at runtime. Head/face/hair/accessory source art remains in `../v2`.

Rebuild in order:

```powershell
node scripts/register-avatar-outfits.mjs
node scripts/build-avatar-2d-assets.mjs --spec scripts/avatar-2d-art-registry.json
node scripts/render-avatar-item-previews.mjs
node scripts/verify-avatar-outfit-fit.mjs
```

Automated loading/alpha/frame checks supplement visual review; matching hashes alone do not establish clothing fit.
