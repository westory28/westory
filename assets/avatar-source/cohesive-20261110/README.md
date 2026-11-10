# 얼굴·헤어 원본 (2026-11-10)

기존 의상 그림체를 기준으로 ImageGen으로 제작한 투명 배경 원본이다. 앱 실행 중 AI 호출은 없다. 기존 의상·색상·보유품 ID는 유지한다.

제작 요구 요약: 기존 재킷 의상의 부드러운 선과 절제된 명암에 맞춘 얼굴과 머리카락, 과도하게 큰 눈·귀와 뾰족한 잔머리 제거, 남성 헤어의 양쪽 눈 노출, 얼굴형별 자연스러운 턱선. 픽셀 아트가 아닌 부드러운 레트로 아바타 일러스트.

- `heads.png`: 3×1. 자연형, 둥근형, 갸름형. 눈·입은 별도 레이어이며 코·귀·얼굴 윤곽을 포함한다.
- `expressions.png`: 3×2. natural, calm, smile / curious, bright, determined. 눈썹·눈과 입을 별도로 추출한다.
- `hair.png`: 3×3. bob, curtain, volume / wave, long, crop / toben, twin-tail, half-up. crop의 아래쪽과 half-up의 위쪽은 개별 추출 범위를 사용한다.

정확한 추출 좌표·배치·단발 끝머리 보정은 `scripts/avatar-2d-proportions.mjs`, 등록·의상 접합은 `scripts/register-avatar-outfits.mjs`가 관리한다. 피부색은 원본별 색 차이를 공통 기준색으로 정규화한 뒤 사용자의 피부색을 적용한다. 원본과 생성 자산의 SHA는 `public/avatar/v2/provenance.json`에 기록된다.

재생성 순서:

```powershell
node scripts/register-avatar-outfits.mjs
node scripts/build-avatar-2d-assets.mjs --spec scripts/avatar-2d-art-registry.json
node scripts/render-avatar-item-previews.mjs
```

컴파일 완료 후 조합·피부 마스크 검사를 실행한다. 자산 생성과 조합 검사를 동시에 실행하지 않는다.
