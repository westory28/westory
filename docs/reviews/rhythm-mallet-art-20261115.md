# 덩기덕 쿵더락 연주자 시점 북채 아트

- 제작일: 2026-11-15
- 작업 checkout: `C:\westory-rhythm-20261115`
- 작업 시작 HEAD: `befc00964dabf672edeb49cd75b450a271b3f6bc`
- 소유 범위: `public/assets/weplay/rhythm/v2/mallet-left.{png,webp}`, `mallet-right.{png,webp}`, 이 문서.
- 기존 타이틀·버튼·기타 아트·코드·음악은 변경하지 않았다.
- 제작 도구: 내장 `image_gen.imagegen`, `imagegen` 스킬. API 키·외부 유료 CLI 사용 없음.
- 사용자 참고 이미지와 기존 `mascot.webp`를 먼저 육안 확인했다. 참고 이미지의 제삼자 시점을 복제하지 않고 사용자 요청의 연주자 시점으로 새로 제작했다.

## 납품 파일

| 파일 | 해상도 | 파일 크기 | 형식 |
| --- | --- | --- | --- |
| mallet-left.png | 320 × 512 | 98,612바이트 | RGBA PNG |
| mallet-left.webp | 320 × 512 | 27,766바이트 | RGBA WebP |
| mallet-right.png | 320 × 512 | 106,752바이트 | RGBA PNG |
| mallet-right.webp | 320 × 512 | 29,406바이트 | RGBA WebP |

실행용 WebP 합계: 57,172바이트. 모든 파일에서 알파 최소 0, 최대 255를 확인했다.

고해상도 생성 원본은 두 파일 모두 992 × 1586이다. Pillow LANCZOS로 320 × 512 크기만 조정했고 PNG 최적화 및 WebP quality 94/method 6 인코딩을 수행했다. 코드로 반전·색칠·배경 제거·그림 합성을 하지 않았다. 좌우를 각각 독립 생성했다.

## 시각 확인 및 통합 참고

- 생성 원본과 최종 WebP를 각각 육안 확인했다.
- 왼손은 아래 왼쪽에서 들어와 북채가 오른쪽 위로 향한다. 오른손은 아래 오른쪽에서 들어와 북채가 왼쪽 위로 향한다.
- 손등·쥔 손가락·엄지가 드러나는 연주자 시점이다. 각각 손 한 개와 북채 한 개만 있고, 북·얼굴·몸통·배경·문자는 없다.
- 미색과 노랑의 둥근 패드, 갈색 나무 자루, 초록 소매, 남색 손목단과 주홍·노랑 장식이 기존 오방색 그림체와 이어진다.
- 최종 320 × 512에서도 패드와 자루·쥔 손을 구별할 수 있다.
- 손목 회전축은 육안 기준 왼쪽 약 (25%, 81%), 오른쪽 약 (72%, 79%)가 자연스럽다. 머리 중심은 왼쪽 약 (72%, 13%), 오른쪽 약 (27%, 14%)다. 이는 그림 배치 참고값이며 입력 판정 좌표가 아니다.
- 실제 드럼 앞 레이어 배치, 회전·내리치기, 작은 화면 가림과 reduced-motion 처리는 통합 작업자가 검증한다.

## 생성 원본

내장 도구 기본 생성 폴더 아래 원본을 보존했다.

- 왼손: `$CODEX_HOME/generated_images/01a1de6f-dbff-76f1-874d-44eb86f56cf0/exec-7c7f4600-4794-4708-b4f7-9eb3540a1ace.png`
- 오른손: `$CODEX_HOME/generated_images/01a1de6f-dbff-76f1-874d-44eb86f56cf0/exec-4c526340-58ee-4c2b-bf6b-1e9edc9582a8.png`

## 전체 프롬프트

두 호출 모두 `transparent_background: true`이며 입력 이미지를 재사용하지 않는 독립 신규 생성이다. 사용자 참고 이미지와 기존 아트를 먼저 확인한 뒤 시점·구도·색감·질감을 아래 프롬프트에 명시했다.

### 왼손

```text
Use case: illustration-story.
Asset type: a transparent 2D game sprite layer, a first-person player's own hand and drum mallet, viewed from slightly above as the player looks down toward a drum.
Style: original cute Korean minhwa-inspired hand-painted gouache, subtle dry-brush/hanji texture, plump clear shapes, dark brown ink outlines, same warm friendly feel as a Korean palace-festival rhythm game. Palette: warm cream skin, cream-and-golden-yellow soft padded spherical mallet head, dark brown wooden shaft, deep forest green #164c35 sleeve, navy #272966 cuff with small vermilion #c4442d and golden-yellow #e5b51e trim.
Subject: exactly ONE human hand gripping exactly ONE wooden mallet, with a short cropped sleeve and forearm. The hand is rounded and cute but the back of the hand, knuckles, curled gripping fingers and thumb are easy to distinguish. This is NOT a palm held open, NOT a hand holding the stick from someone opposite the viewer. The player's own forearm comes from the bottom edge nearest the viewer and the stick points upward away from the viewer, diagonally toward the center of the drum beyond the frame. Use an overhead/first-person angle so the back of the hand is visible. The shaft extends forward above the fist; a short butt may extend below the grip.
The mallet is thick and legible at small sizes, a long simple dark brown wooden shaft and a distinct round soft cream padded head with restrained yellow edging/very subtle fabric rings, not a musical maraca, no face on head.
Composition: tall portrait canvas at 640 x 1024 pixels, final sprite intended at 320 x 512. The full head and all fingers visible, only forearm/sleeve cropped by the bottom edge. Exact genuinely transparent background including around all shapes. No shadow panel, no ground, no drum, no torso, no face, no mascot, no additional hands, no speed lines, no text, no watermark. Do not show an observer's opposite-facing performer or a mascot playing behind a drum.
SIDE AND PLACEMENT: LEFT HAND. The player's LEFT sleeve/wrist enters from the LOWER LEFT, centered around normalized x=0.25,y=0.90. The mallet angles diagonally UP-RIGHT with its round padded tip centered at x=0.70,y=0.12. Left thumb is on the inner RIGHT side of the grip as seen by the player looking down. Keep this specific diagonal direction.
```

### 오른손

```text
Use case: illustration-story.
Asset type: a transparent 2D game sprite layer, a first-person player's own hand and drum mallet, viewed from slightly above as the player looks down toward a drum.
Style: original cute Korean minhwa-inspired hand-painted gouache, subtle dry-brush/hanji texture, plump clear shapes, dark brown ink outlines, same warm friendly feel as a Korean palace-festival rhythm game. Palette: warm cream skin, cream-and-golden-yellow soft padded spherical mallet head, dark brown wooden shaft, deep forest green #164c35 sleeve, navy #272966 cuff with small vermilion #c4442d and golden-yellow #e5b51e trim.
Subject: exactly ONE human hand gripping exactly ONE wooden mallet, with a short cropped sleeve and forearm. The hand is rounded and cute but the back of the hand, knuckles, curled gripping fingers and thumb are easy to distinguish. This is NOT a palm held open, NOT a hand holding the stick from someone opposite the viewer. The player's own forearm comes from the bottom edge nearest the viewer and the stick points upward away from the viewer, diagonally toward the center of the drum beyond the frame. Use an overhead/first-person angle so the back of the hand is visible. The shaft extends forward above the fist; a short butt may extend below the grip.
The mallet is thick and legible at small sizes, a long simple dark brown wooden shaft and a distinct round soft cream padded head with restrained yellow edging/very subtle fabric rings, not a musical maraca, no face on head.
Composition: tall portrait canvas at 640 x 1024 pixels, final sprite intended at 320 x 512. The full head and all fingers visible, only forearm/sleeve cropped by the bottom edge. Exact genuinely transparent background including around all shapes. No shadow panel, no ground, no drum, no torso, no face, no mascot, no additional hands, no speed lines, no text, no watermark. Do not show an observer's opposite-facing performer or a mascot playing behind a drum.
SIDE AND PLACEMENT: RIGHT HAND. The player's RIGHT sleeve/wrist enters from the LOWER RIGHT, centered around normalized x=0.75,y=0.90. The mallet angles diagonally UP-LEFT with its round padded tip centered at x=0.30,y=0.12. Right thumb is on the inner LEFT side of the grip as seen by the player looking down. Keep this specific diagonal direction.
```

## 데이터와 런타임 영향

개발 시 내장 이미지 도구에 위 아트 프롬프트만 전달했다. 학생 개인정보·교과 자료·자격 증명은 포함하지 않았다. 정적 이미지 추가 작업으로 앱의 런타임 AI 호출·외부 전송·권한·공개 설정에 변화가 없다.
