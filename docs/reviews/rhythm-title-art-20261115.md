# 덩기덕 쿵더락 타이틀·시작 버튼 아트

- 제작일: 2026-11-15
- 작업 checkout: `C:\westory-rhythm-20261115`
- 작업 시작 HEAD: `96366981604f72a71b0ad737fb92525cf9f5f3e8`
- 범위: 독립 타이틀 로고와 시작 버튼 현판, 제작 기록만 추가. 코드·음악·공개 설정 변경 없음.
- 제작 도구: 내장 `image_gen.imagegen`, `imagegen` 스킬. API 키·외부 유료 CLI 사용 없음.
- PNG는 내장 도구가 만든 고해상도 원본을 그대로 복사했다. WebP는 Pillow LANCZOS 크기 조정 및 quality 94/method 6 인코딩만 수행했다. 글자 합성·색 보정·그림 재제작은 코드로 하지 않았다.
- 참고한 기존 파일을 생성 전에 직접 확인했다: `mascot.webp`, `bg-stage.webp`, `button-plaque.webp`. 타이틀은 확인한 그림체·팔레트를 명시한 새 생성, 시작 버튼은 기존 현판과 마스코트를 참조한 편집이다.

## 최종 파일

경로: `public/assets/weplay/rhythm/v2/`

| 파일 | 용도 | 해상도 | 파일 크기 |
| --- | --- | --- | --- |
| title-logo.png | 고해상도 편집용 원본 | 1774 × 887 | 2,222,706바이트 |
| title-logo.webp | 실행용 타이틀 | 960 × 480 | 184,204바이트 |
| start-plaque.png | 고해상도 편집용 원본 | 2172 × 724 | 1,837,260바이트 |
| start-plaque.webp | 실행용 시작 버튼 | 600 × 180 | 23,390바이트 |

실행용 WebP 합계: 207,594바이트. 네 파일 모두 RGBA이며 알파 최소 0, 최대 255를 확인했다.

## 육안 확인

- 생성 원본과 실행용 WebP를 각각 확인했다.
- 로고 첫 줄은 **덩기덕**, 둘째 줄은 **쿵더락**으로 여섯 음절을 확인했다. 영문 Rock이나 다른 문구가 없다.
- 통통한 손그림 붓글씨와 미색 질감, 짙은 초록·주홍·남색·노랑의 오방색을 사용했다. 짧은 구름과 북채 장식이 글자를 가리지 않는다. 완성된 마스코트 캐릭터는 포함하지 않았다.
- 시작 버튼은 미색 일반 버튼과 구분되는 주홍 중앙면, 녹색 테두리, 금색 선 및 양끝 단청 장식이다. 중앙에는 문자가 없어 화면에서 접근 가능한 DOM 텍스트를 올릴 수 있다.
- 시작 버튼 첫 생성본의 큰 투명 여백은 내장 이미지 도구로 다시 편집해 줄였다. 최종 원본의 가로 3:1 캔버스는 실행용 600 × 180으로 크기 조정했다.
- 앱 화면에서의 배치·키보드/터치 접근성·대비·반응형 검증은 통합 작업자가 별도로 수행한다.

## 원본 경로

내장 도구 기본 생성 폴더 아래 원본은 삭제하지 않았다.

- 타이틀: `$CODEX_HOME/generated_images/01a1de6f-dbff-76f1-874d-44eb86f56cf0/exec-2b2546dd-5b4c-45db-8e39-ac29e06355ee.png`
- 시작 현판 첫 생성: `$CODEX_HOME/generated_images/01a1de6f-dbff-76f1-874d-44eb86f56cf0/exec-bce16c44-f7c7-48b0-8e3e-7e0c966fc54c.png`
- 시작 현판 최종 여백 편집: `$CODEX_HOME/generated_images/01a1de6f-dbff-76f1-874d-44eb86f56cf0/exec-6b99d8de-bbe2-48d4-97f7-129f5bab0f6e.png`

## 프롬프트

### 타이틀 신규 생성

transparent_background: true. 별도의 입력 이미지 없이 확인한 기존 그림체와 팔레트를 구체적으로 기술했다.

```text
Use case: logo-brand.
Asset type: standalone illustrated Korean game title logo with a genuinely transparent background, landscape canvas with aspect ratio 2:1.
Primary request: create an original cute minhwa-inspired Korean folk rhythm game title illustration. EXACT KOREAN TEXT, only six syllables, in exactly two centered lines:
First line: "덩기덕"
Second line: "쿵더락"
Proofread the characters very carefully: first line is 덩 + 기 + 덕; second line is 쿵 + 더 + 락. Do not replace, omit, duplicate, or add any syllables. No English.
Typography is the main artwork: very large plump hand-painted Korean brush lettering, playful dancing rhythm in the strokes, warm and child-friendly, a hand-drawn illustrated title rather than any generic Gothic/sans-serif font. Keep Hangul structure clear and perfectly legible. Each line should occupy almost the full width with generous height, forming a compact 2-row title.
Match a charming existing Korean palace-festival game art direction: subtle cream leather and hanji brush textures, deep forest green #164c35, vermilion #c4442d, navy #272966, golden yellow #e5b51e, warm cream, dark brown-black outlines. Cream lettering faces with confident thick colored outline/shadow accents alternating these traditional obangsaek colors; flat hand-painted 2D with restrained dimensional ink edging, never shiny plastic.
Composition/framing: centered title, entire design visible, transparent around the silhouette, minimal outer margin, no rectangular plaque or full background. A few short cream cloud curls and at most two tiny yellow drumstick accents may surround the words without obstructing any syllable. No complete mascot or drum character. No additional text, no watermark, no photo, no UI, no Taiko franchise motifs. Final artwork intended at 960 x 480 pixels, exact 2:1 framing.
```

### 시작 현판 편집

transparent_background: true. 참조 이미지: `public/assets/weplay/rhythm/v2/button-plaque.png`, `public/assets/weplay/rhythm/v2/mascot.png`.

```text
Use case: precise-object-edit.
Asset type: transparent-background START-button plaque for the same cute Korean minhwa-inspired rhythm game.
Input image 1 is the existing general-purpose cream-and-green button plaque to adapt; input image 2 is the existing mascot as palette/brush-style reference only, do not include the mascot.
Create a distinct start-button version of image 1 while preserving its handmade Korean traditional ornamental plaque look, centered long horizontal silhouette, restrained decorative ends, warm painted texture, clean usable broad central area and actual transparent exterior.
Change the CENTRAL FACE to rich DARK VERMILION lacquer (#a63222 to #c4442d), dark enough to receive highly legible warm-cream DOM text later. It must be EMPTY, absolutely NO letters or symbols in the central text area. The center should be broad and flat, visually dominant and uncluttered.
Make the outer edging deep forest green #164c35 with a strong golden-yellow #e5b51e inner trim, subtle navy #272966 and vermilion details in the end ornaments. Cute rounded strong silhouette, energetic and inviting for the primary play action. Dark brown-black ink outline, soft dry-brush texture, 2D illustrated style consistent with the reference. No pale cream central face. No mascot, no drum, no typography, no watermark.
Wide landscape framing approximately 3.53:1, full plaque almost filling canvas with minimal transparent margin, exact intended output 600 x 170 pixels. Preserve full uncut outer silhouette and transparency.
```

### 시작 현판 투명 여백 축소 편집

transparent_background: true. 편집 대상: 첫 시작 현판 생성 원본.

```text
Use case: precise-object-edit. Edit target is this transparent illustrated red start-button plaque. Change ONLY the canvas framing: make a very wide short transparent canvas of 2048 by 576 pixels, 3.56:1 aspect ratio. Preserve exactly the existing plaque artwork, red lacquer EMPTY central face, green and gold border, navy and vermilion floral ends, painterly texture, and the same proportions of all shapes. Bring the top and bottom edges of the canvas right up to the plaque with just a tiny 2% transparent margin, instead of the current large transparent bands above and below. The full artwork must remain uncut and centered. Actual transparent background. Do not redraw text because there is none. No other changes. The plaque must fill the canvas vertically as well as horizontally, wide landscape UI strip.
```

## 외부 전송·런타임 영향

개발 시 내장 이미지 도구로 아트 프롬프트와 기존 생성 자산만 전달했다. 학생 개인정보·교과 자료·자격 증명은 사용하지 않았다. 이 작업은 정적 이미지 파일을 추가하며 앱의 AI 런타임 호출·개인정보 전송·권한·공개 상태를 변경하지 않는다.
