# 미니미 아바타 자산

2026-11-11 전면 교체. 이전 v1/v2 3D 모델·원화 레이어·정적 기본 그림은 삭제했다. 기존 선택을 새 아바타에 이식하거나 이미지 실패 시 구형 그림을 표시하지 않는다.

- 작화: `src/features/avatar/minimi/draw.ts`, 80×112 정수 픽셀. 공통 머리·목·어깨·허리·발 좌표를 사용한다.
- 표시: `src/features/avatar/minimi/engine.ts`. WebGL·원화 다운로드·런타임 AI 호출 없이 선택 변경과 크기 변경 때 그린다.
- 품목 미리보기: `minimi-v2/previews/`, 실제 작화 함수로 2배 정수 확대해 만든 투명 256×256 무손실 WebP 79개.
- 미선택: `minimi-v2/neutral.svg`. 이전 캐릭터나 성별을 자동 선택하지 않는다.
- 저장 이미지: 같은 작화 함수를 4배 정수 확대해 투명 384×512 WebP로 저장한다. 서버는 nearest 확대/축소와 무손실 인코딩을 사용한다.
- 카탈로그: `functions/avatarCatalog.json` 버전2. 모든 아이템 ID는 `minimi-`로 시작한다.
- 학교복 참고: `assets/avatar-source/school-20261110/README.md`. 당시 실물 의복 사진과 보존된 생성 도안을 구분한다. 학교 마크·도안은 제작 근거로만 보존하며 런타임에 읽지 않는다.

```powershell
node scripts/render-avatar-item-previews.mjs
npm run verify:avatar-previews
node scripts/verify-minimi-renderer.mjs
```

미리보기 지문 검사는 같은 소스의 사용 여부를 확인한다. 그림의 품질·턱선·머리와 소매 접합은 전체 품목 및 포즈 시트를 별도로 직접 확인한다. 계획과 검증 범위는 `docs/reviews/minimi-rebuild-20261111.md`에 기록한다. 학생 사진·개인정보는 자산에 들어 있지 않다.
