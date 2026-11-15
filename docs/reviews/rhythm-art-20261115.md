# 덩기덕 쿵더Rock 일러스트 제작 기록

- 확인일: 2026-11-15 (Asia/Seoul)
- 작업 기준: `C:\westory-rhythm-20261115`, 아트 작업 시작 HEAD `6e0d1f8a8a938a8b1f52b708b8b00aca460ab000`
- 제작 도구: Codex 내장 `image_gen.imagegen`만 사용했습니다. 별도 API 키·유료 CLI·외부 음원은 사용하지 않았습니다.
- 적용 스킬: `imagegen` (`$CODEX_HOME/skills/.system/imagegen/SKILL.md`). 사용자에게 보이는 디자인 기준은 기존 `education-web-design-system`과 제품 계약을 유지합니다.
- 자산 소유 범위: `public/assets/weplay/rhythm/v2/*`. 이번 아트 작업은 앱 로직·음악·권한·학생 공개 설정을 변경하지 않았습니다.

## 최종 색상과 구성

사용자가 제공한 신문고 사진의 미색 가죽, 짙은 초록 `#164c35`, 남색 `#272966`, 주홍 `#c4442d`, 노랑 `#e5b51e`, 검갈색 윤곽선을 기준으로 맞췄습니다. 최초 파스텔 시안 이후 사용자 정정에 따라 여섯 자산 모두 내장 이미지 편집으로 다시 제작했습니다. 사진은 색과 북 장식만 참고했고, 결과는 귀여운 2D 민화·과슈 그림으로 유지했습니다. 기존 게임의 캐릭터·로고·화면은 입력하거나 복제하지 않았습니다.

배경·캐릭터·터치 북·두 종류 노트·버튼을 독립 파일로 분리했습니다. 버튼 문구와 노트 구음 등 접근 가능한 텍스트는 앱에서 넣을 수 있도록 이미지에 글자를 생성하지 않았습니다. 신문고 사진의 작은 인쇄 문구도 옮기지 않았습니다.

## 제공 파일

모든 자산은 같은 이름의 WebP와 PNG를 함께 제공합니다. WebP는 실행용, PNG는 개별 편집용입니다. 원본 생성 이미지도 내장 도구의 기본 저장소에 보존했습니다.

| 파일명 (`.webp` / `.png`) | 크기 | WebP 바이트 | 배경 | 확인한 내용 |
| --- | --- | ---: | --- | --- |
| `bg-stage` | 1600×900 | 227900 | 배경 | 미색 하늘·짙은 초록 궁궐, 상단 중앙 레인 여백 |
| `mascot` | 512×512 | 79104 | 투명 | 초록 단청 지붕 모자, 주홍 몸통, 남색·노랑 장식 |
| `drum` | 1024×1024 | 223120 | 투명 | 정면 원형 신문고, 오방색 조각띠와 중앙 삼태극 |
| `note-center` | 256×256 | 16770 | 투명 | 주홍 원형 노트 |
| `note-rim` | 256×256 | 14592 | 투명 | 남색 둥근 마름모 노트 |
| `button-plaque` | 512×171 | 18188 | 투명 | 녹색 테두리와 미색 중앙의 빈 현판 |

WebP 여섯 파일 합계는 579,674바이트입니다. PNG에는 손실 없는 축소 결과를 저장했습니다. Pillow는 크기 조정과 PNG/WebP 인코딩에만 사용했으며 색 변환·오브젝트 합성·배경 제거·그림 보정은 하지 않았습니다. 알파가 필요한 다섯 자산은 내장 도구에서 `transparent_background: true`로 생성했고, 최종 PNG/WebP 모두 RGBA 및 알파 범위 0~255를 확인했습니다.

## 시각 확인

- 생성한 여섯 이미지와 최종 크기의 실행용 이미지를 직접 확인했습니다.
- 배경에는 인물·북·UI·문자·워터마크가 없고, 상단 중앙의 미색 공간이 충분합니다.
- 캐릭터의 얼굴·단청 지붕·북채·발이 잘리지 않았습니다.
- 터치 북은 원형 정면이고, 바깥에는 투명 알파가 있습니다. 미색 가죽과 색띠 경계의 시각 반지름은 정사각 캔버스의 약 0.36~0.37입니다. 앱의 실제 입력 경계와 강조 링은 이 비율을 함께 확인해야 합니다.
- 가운데 노트는 주홍 원형, 가장자리 노트는 남색 마름모여서 색과 모양으로 구분됩니다.
- 현판 중앙은 미색 빈 공간이며 짙은 녹색 테두리와 오방색 장식이 외곽에만 있습니다.
- 글자·위스토리 로고·워터마크를 원본에 넣지 않았습니다.
- 앱 통합 후 반응형 배치·레이어 가림·입력 경계·접근성 검증은 이 자산 확인 기록과 별도로 수행합니다.

## AI 및 외부 전송 범위

개발 단계에서 사용자 요청에 따라 그림 프롬프트, 이 작업에서 생성한 일러스트, 사용자가 제공한 북 사진만 내장 이미지 도구에 전달했습니다. 학생 자료·개인정보·계정 정보·교과 자료는 포함하지 않았습니다. 앱 런타임에는 AI 호출·에이전트 실행·외부 이미지 생성 요청을 추가하지 않았습니다.

## 원본 파일 기록

생성 원본은 아래 내장 도구 저장 경로에 남아 있습니다. 사용자 첨부 사진은 작업 참조로만 사용했고 저장소에 복제하지 않았습니다.

- `bg-stage`: 최종 `$CODEX_HOME\generated_images\01a1de6f-dbff-76f1-874d-44eb86f56cf0\exec-40384da0-94e4-4059-b9da-dccd4e7d37a5.png`
  - 최초 시안: `$CODEX_HOME\generated_images\01a1de6f-dbff-76f1-874d-44eb86f56cf0\exec-fca70195-efdf-4511-a0a8-d3ff15451c98.png`
- `mascot`: 최종 `$CODEX_HOME\generated_images\01a1de6f-dbff-76f1-874d-44eb86f56cf0\exec-6e292b0e-06dc-4e4f-85e4-336df8c025cf.png`
  - 최초 시안: `$CODEX_HOME\generated_images\01a1de6f-dbff-76f1-874d-44eb86f56cf0\exec-470c9776-9a5a-4f35-bc50-824a102769b6.png`
- `drum`: 최종 `$CODEX_HOME\generated_images\01a1de6f-dbff-76f1-874d-44eb86f56cf0\exec-1a88255d-5973-4612-b4f9-444abb7f9e76.png`
  - 최초 시안: `$CODEX_HOME\generated_images\01a1de6f-dbff-76f1-874d-44eb86f56cf0\exec-15f2b1d7-dacd-49d4-a567-9922eb860137.png`
- `note-center`: 최종 `$CODEX_HOME\generated_images\01a1de6f-dbff-76f1-874d-44eb86f56cf0\exec-579dd456-c6ec-4460-aab8-e37386b0f92e.png`
  - 최초 시안: `$CODEX_HOME\generated_images\01a1de6f-dbff-76f1-874d-44eb86f56cf0\exec-30091581-4fa1-4850-bb5d-48e1820764a2.png`
- `note-rim`: 최종 `$CODEX_HOME\generated_images\01a1de6f-dbff-76f1-874d-44eb86f56cf0\exec-a72ccf97-d02d-4d2a-bc46-b9a61a143cd7.png`
  - 최초 시안: `$CODEX_HOME\generated_images\01a1de6f-dbff-76f1-874d-44eb86f56cf0\exec-9094e030-f2fb-4932-a839-01ed5191c42a.png`
- `button-plaque`: 최종 `$CODEX_HOME\generated_images\01a1de6f-dbff-76f1-874d-44eb86f56cf0\exec-986e662e-b49e-473c-bf1f-1a65aa1c09a2.png`
  - 최초 시안: `$CODEX_HOME\generated_images\01a1de6f-dbff-76f1-874d-44eb86f56cf0\exec-f8f777a7-1c13-49cd-b048-bb408d4fefa4.png`

## 최종 편집 프롬프트

각 편집은 해당 자산의 최초 PNG를 첫 번째 입력(편집 대상), 사용자 신문고 사진을 두 번째 입력(색상·장식 참고)으로 전달했습니다. 배경은 불투명, 나머지는 투명 배경을 지정했습니다.

### bg-stage

```text
Use case: style-transfer / precise-object-edit. Image 1 is the EDIT TARGET: keep its exact wide 16:9 Korean palace courtyard composition, cute 2D minhwa/gouache picture-book art, open empty upper-center gameplay lane, architecture and trees. Image 2 is a COLOR PALETTE REFERENCE ONLY: the user's real Korean sinmungo drum. Recolor the entire illustrated background to harmonize with this drum's traditional obangsaek palette: cream aged-paper sky and plaster, deep forest green #164c35 roofs and foliage, deep navy #272966, vermilion #c4442d and golden yellow #e5b51e as small architectural/lantern accents, dark brown-black outlines, warm ochre courtyard ground. Remove the pastel peach sky and pale mint/teal color treatment. Still warm, cheerful and cute, not gloomy or heavily saturated; center and upper sky must stay pale cream, calm and legible for moving game notes. Preserve fine painted paper texture. Do not insert the reference drum, any characters, people, text, game UI, music notes, watermarks or logos. Do not become a photograph. Change palette only, preserve spacious layout and all objects.
```

### mascot

```text
Use case: precise-object-edit. Image 1 is the EDIT TARGET: retain this original cute Korean sinmungo drum mascot's pose, happy face, friendly proportions, roof hat, two drumsticks and little feet, full-body isolated on real transparent alpha. Image 2 is a COLOR AND DRUM DECORATION REFERENCE ONLY, not a photorealism reference. Recolor the mascot into the reference's traditional Korean obangsaek palette: warm aged cream leather face; roof hat in deep forest green #164c35; body/frame in vermilion #c4442d with deep navy #272966 and golden yellow #e5b51e dancheong panels; dark brown-black contour. Replace mint/teal and pastel coral colors with these deeper authentic colors while keeping cheerful cute 2D hand-painted minhwa/gouache picture-book texture. Keep the face clear and smiling; do not place a taegeuk over its face. Keep golden yellow drumsticks and small golden details, cream cheeks. No background, no new objects, no text, no letters, no logo, no watermark. Preserve genuine transparency around the entire character.
```

### drum

```text
Use case: precise-object-edit. Image 1 is the EDIT TARGET: preserve its exactly circular orthographic front view, centered square framing, broad annular rim, tiny evenly spaced studs, warm cream leather center and cute 2D gouache/minhwa illustration texture. Image 2 is the user's actual Korean SINMUNGO COLOR AND DECORATION REFERENCE. Adapt target's decoration to the reference: deep green #164c35, deep navy #272966, vermilion #c4442d and golden yellow #e5b51e geometric segmented bands around the broad rim, with black-brown separators and dark outside border; cream leather with subtle aged paper texture. Put a clear authentic THREE-COLOR SAMTAEGEUK in the very center, three interlocking curved lobes in vermilion, yellow, and deep navy, as seen in the photo. Central samtaegeuk should be about 25 percent of the total drum diameter and entirely within the cream skin. Do not copy the tiny text from the photo. No handles, no stands, no ground, no face, no roof, no feet, no letters or numbers, no logos or watermark. Preserve the whole circular silhouette, nearly fill square canvas; genuinely transparent background outside it. This must remain a cute hand-painted illustration, never photorealistic. Remove all pale mint/teal and pastel coral styling.
```

### note-center

```text
Use case: precise-object-edit. Image 1 is the EDIT TARGET: preserve the exact cute round center-hit note character silhouette, happy curved eyes, cheeks, smile, small star and hand-painted gouache texture. Image 2 is COLOR REFERENCE ONLY: the user's Korean sinmungo drum. Change the note's pastel coral body to rich traditional VERMILION #c4442d with warm subtle highlights; keep the star in golden yellow #e5b51e; cheeks warm cream like the drum leather, contour and face in dark brown-black. It must harmonize with deep forest green/navy/vermillion/yellow traditional Korean obangsaek game art. Keep it playful, cute and highly readable at 40px, not photorealistic. Do not add any symbols from the photo, do not add a taegeuk to this note. No lettering, words, logo or watermark. Retain exactly circular silhouette and genuine transparency outside the object; no background or drop shadow.
```

### note-rim

```text
Use case: precise-object-edit. Image 1 is the EDIT TARGET. Preserve its unique rounded-diamond silhouette, cute face, small painted sparkle, flat front view and hand-painted gouache/minhwa grain. Image 2 is the user's Korean sinmungo drum, serving as a COLOR PALETTE REFERENCE ONLY. Recolor the note's teal body into deep traditional NAVY #272966, with slightly lighter navy highlights, keeping warm dark brown-black contour. Its tiny cheeks, eyebrows and bright eye highlights become warm cream like the drum skin; small sparkle stays golden yellow #e5b51e; a small vermilion #c4442d inside the smile. This rim-hit note must clearly be navy and diamond-shaped, harmonizing with deep green/vermillion/navy/yellow Korean game art. No pale mint or teal. Retain cute friendly expression and legibility at 40px; do not copy any photograph texture or turn it into 3D. No additional objects, no text, Korean lettering, logo or watermark, no taegeuk on this sprite. Preserve genuine transparent alpha outside the complete silhouette.
```

### button-plaque

```text
Use case: precise-object-edit. Image 1 is the EDIT TARGET: retain the wide empty Korean wooden/silk UI plaque, its symmetric rounded decorative end caps, floral details at the ends, broad uninterrupted blank cream center, front view and hand-painted gouache texture. Image 2 is the user's sinmungo COLOR REFERENCE ONLY. Recolor the dominant outer frame to DEEP FOREST GREEN #164c35. Keep the large center warm aged-paper CREAM matching drum leather. Use a narrow golden-yellow #e5b51e inner frame line and restrained vermilion #c4442d and navy #272966 accents in the decorative end caps and corner details, with dark brown-black outlines. Remove pale teal/mint and pastel coral from the frame. Cheerful traditional Korean obangsaek palette, cute polished 2D picture-book game art, not a photo or 3D. Keep the entire central cream area empty for text rendered in code later. No characters, no drum, no taegeuk, no actual text, letters, numbers, logo or watermark. Preserve the wide 3:1 canvas and genuine transparent alpha outside the complete plaque.
```

## 최초 생성 프롬프트

아래 시안은 최종 색상 기준이 아닙니다. 사용자 신문고 사진을 받은 뒤 위 편집 프롬프트를 적용했습니다.

### bg-stage

```text
Use case: illustration-story. Asset type: production background for a Korean children's touch rhythm game, landscape 16:9, about 1600 pixels wide. Create one polished, cute hand-painted 2D illustration of an outdoor music festival courtyard beside a Korean Joseon palace. Modern Korean minhwa picture-book style, rounded simple shapes, clean warm charcoal-brown contour, light gouache/paper texture. Palette: soft peach sky, muted jade mountains, warm cream paper, coral-red wooden details and teal/sea-green roof tiles, small golden yellow accents. Low buildings and gently rounded trees at far left and far right; elegant low palace roof silhouettes, lantern bunting only around the perimeter, a broad pale cream courtyard along the bottom. Keep the central upper 60% of the image exceptionally calm and open for the gameplay note lane: mostly pale peach sky with only very subtle distant mountains low in the frame, no high contrast object behind the lane. Cheerful and cozy, flat illustrated lighting, no 3D or photorealism. This is a BACKGROUND ONLY, with no people, no characters, no drums or instruments, no game UI, no buttons, no music note icons, no text or letters, no watermarks, no logos. The image must fill the entire rectangle, no border.
```

### mascot

```text
Use case: illustration-story. Asset type: one isolated original game mascot on a genuinely transparent background, square canvas, production 2D sticker illustration. Design a very cute little Korean sinmungo royal petition drum character for a children's music game. Round warm cream drum-skin face on a chunky coral-red wooden drum body. Its distinctive hat is a small mint/teal Korean palace dancheong tiled roof with gracefully raised roof ends and golden accents, clearly a Korean palace roof. Short little feet, tiny arms each holding a short golden-yellow drumstick. Happy crescent eyes with tiny rosy cheeks and a small joyful mouth. Slight lively three-quarter pose, waving one drumstick, full character visible with feet and roof never cropped. Modern Korean minhwa picture-book/gouache style, softly textured painted surfaces, clean warm charcoal-brown outline, friendly round proportions. Palette warm cream, coral, muted teal, mint and golden yellow. Expressive readable silhouette at small UI size; coherent professional game art, no 3D, not photorealistic. Make a unique original character; do not resemble or copy Taiko no Tatsujin mascots or any franchise character. No background, no shadow rectangle, no border, no text, no lettering, no symbols, no logos, no watermark. Character centered and fills about 88 percent of the square. Real alpha transparency.
```

### drum

```text
Use case: illustration-story. Asset type: isolated front-facing touch drum game control, one object on genuinely transparent background, square canvas. Draw a beautiful cute Korean sinmungo drum seen EXACTLY straight-on, orthographic front view. It must be a geometrically round circle, not an ellipse, not tilted, not three-quarter view, centered precisely. The total circular silhouette should fill 96 percent of the square width and height with only 2 percent transparent margin on each side. For gameplay hit-zone alignment: the warm cream leather center is a flat circle occupying 62 percent of the full drum diameter; surround it with a VERY BROAD coral-red wooden annular rim, evenly dotted with small golden round studs; finish with a narrow muted teal outer edge. The leather has a subtle hand-painted paper grain with a delicate warm radial highlight, no central decoration. Same coherent Korean minhwa picture-book/gouache style as a cute Korean palace festival: clean warm dark-brown contour, soft painted textures, warm cream, muted coral, teal, and gold. 2D illustration, tasteful clean silhouette, readable even small. Transparent outside the circular silhouette. No character face, no eyes, no mouth, no roof, no stand, no handles, no legs, no drumsticks, no bow, no shadow outside the circular silhouette, no text, no letters, no logo, no watermark. Entire circle is visible without any cropping.
```

### note-center

```text
Use case: illustration-story. Asset type: single small gameplay note sprite, centered square on genuinely transparent background. A cute coral-red round rhythm note character, exactly circular outer silhouette occupying 88 percent of the square. Flat 2D hand-painted Korean minhwa picture-book/gouache game style, fine paper grain, clean warm dark-brown outline. Coral/cinnabar filled round body, tiny cream oval cheeks, happy curved eyes and small smiling mouth. One small golden star painted inside the upper right area of the circle as a simple decoration, never protruding beyond the circle. A restrained lighter coral highlight. No limbs, no body outside the circle, no ears, no roof, no instruments, no speech balloon, no background, no drop shadow rectangle. This is the CENTER HIT note for an original Korean music game; unique design, not a Taiko no Tatsujin mascot, no franchise copying. No text, no Korean letters, no words, no logo, no watermark. Keep the face and silhouette perfectly readable at 40px display size.
```

### note-rim

```text
Use case: illustration-story. Asset type: single small gameplay note sprite, centered square on genuinely transparent background. Create a very cute muted-teal rhythm note character whose silhouette is a ROUND-CORNERED DIAMOND, not a circle: symmetric pointed top, right, bottom and left corners softened into broad friendly curves. The diamond fills about 88 percent of the square and is seen front-on, no perspective. Flat 2D hand-painted Korean minhwa picture-book/gouache game style, fine paper grain and clean warm dark-brown outline, matching a warm cream/coral/teal/gold Korean palace festival art set. Teal body with small mint highlight, two bright tiny cream eyebrows, friendly bean-like dark eyes and a tiny delighted smiling mouth, small pale-cream oval cheeks. One tiny gold four-point sparkle painted inside the upper diamond, never outside the silhouette. Simple readable shapes at 40px display size. This is the RIM HIT note, visually distinguished by both teal color and diamond shape. No arms or legs, no ears, no roof, no instrument, no background, no shadow rectangle, no text, no Korean letters, no symbols resembling characters, no logos, no watermark. Original mascot design, no Taiko no Tatsujin or franchise copying. Preserve a genuine alpha background.
```

### button-plaque

```text
Use case: illustration-story. Asset type: one empty game button plaque, wide horizontal 3:1 canvas, genuinely transparent background. Draw a charming Korean palace festival wooden-and-silk sign plaque as a 2D hand-painted UI asset. Its shape is a long horizontal rounded rectangle with very modest curved Korean decorative end-caps, clean symmetric layout. A broad uninterrupted warm cream paper/silk center reserves the central 74 percent of the whole plaque width and most of its height for UI text that will be added later in code. Surround the cream center with a medium coral-red wooden frame and a thin muted teal inset line, tiny restrained golden corner details. Gentle gouache grain and warm dark-brown outline, matching cute Korean minhwa children's picture-book game art. Flat front-on view, soft illustrated texture, cozy polished finish. Keep ornamental details confined to the narrow perimeter, enough cream center space for a single legible text label. The plaque fills about 94 percent of the canvas width and 80 percent of its height, minimal transparent margin. No characters, no drums, no hanging ropes, no roof, no long tassels, no symbols in the center, no lettering or text of any kind, no logo, no watermark, no background, no 3D or photorealism.
```
