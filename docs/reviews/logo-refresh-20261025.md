# 위스토리 로고 전체 적용 검증

## 적용 범위

- 학생·교사 공통 Header와 펼침/접힘/모바일 사이드바, 기본 로그인, 알림 설정 예시.
- 공개 소개 화면 헤더·푸터, 반응형 휴대전화 대시보드, 노트북 후면, 마지막 브랜드 장면.
- 게임 인트로 Westory → Weplay 전환. 게임 시작·음향·건너뛰기 시점은 유지.
- 새 이미지 업로드 워터마크, favicon, Apple/일반 PWA 아이콘, 별도 Android maskable 아이콘, 1024px 관리용 아이콘.
- PageLoading/InlineLoading/LoadingOverlay의 텍스트 로고와 전용 여백 제거. 지구본·처리 상태 및 접근성 상태 유지.

실제 대시보드는 공통 Header/TeacherSidebar를 사용한다. InterfaceConfig에 로고 URL override는 없다. 사용하지 않는 과거 dashboard 이미지와 보관 PNG는 실행 코드에서 가져오지 않는다. 기존 저장 이미지에 합성된 로고는 재처리하지 않는다.

## 최적화

- full 원본 627,336 → WebP 45,068 bytes(약 92.8% 감소), 1024×237.
- We 원본 229,663 → WebP 11,206 bytes(약 95.1% 감소), 256×127.
- 일반 512px 앱 아이콘 145,370 → 73,909 bytes. We는 캔버스 가로 94%를 사용하며 비율 유지.
- Vite 해시 URL을 모든 화면에서 공유하고 Vercel에서 1년 immutable 캐시. 공개 아이콘은 버전 URL과 1일 재검증 캐시.
- 원본 PNG는 앱 번들에 포함하지 않는다. 로고를 위한 Firebase 읽기·함수 호출은 추가하지 않는다.
- 재생성 절차와 자산 출처: `src/assets/brand/ASSETS.md`, `scripts/export-brand-assets.py`.

## 검증

- `npm run build` 통과: 타입, 인증/세션, 학기, 수행평가 XLSX hair 테두리, 학습지 및 지도·사전 검증 포함. 기존 큰 JS chunk 경고는 유지.
- 변경 TS/TSX Prettier 검사와 `git diff --check` 통과.
- `npm run verify:portal-design` 통과: 학생·교사, 320/390/768/1280/1366/1440px, 메뉴·지도·탭·계층 탐색·설정의 기존 동작.
- `verify-weplay-opening-layout.mjs --intro-only` 통과: 390/768/1280/1366px × 일반/동작 감소 8조건. 로고 decode·비율·위치·전환·건너뛰기, 오류/외부 요청 없음. 전체 게임 운영 테스트를 의미하지 않음.
- `verify-loading-state-browser.mjs` 통과: Edge, 320/390/768/1280px, 로고 없는 상태·가운데 배치·지구본 동작·API fallback·정리.
- 실제 Chrome(방재석)에서 로컬 소개 화면 390/768/1440px 로고·대시보드 시연·가로 넘침과 데스크톱 피날레 확인.
- `verify-brand-watermark-browser.mjs`의 합성 이미지 검사 15/15 통과: 실패 후 재시도, 공지·개발일지·상품·자료실·퀴즈·지도, 투명도 및 재저장 보존.

로컬 스크린샷과 상세 결과는 Git에 포함하지 않는 `output/logo-refresh-20261025/`에 있다. 물리 iOS/Android의 설치 아이콘 갱신 시점은 기기와 브라우저 정책에 따르며 이 검증에서는 직접 확인하지 않았다. 운영 배포는 이 패치의 커밋을 main으로 올린 뒤 Vercel Ready·운영 도메인 연결·실제 로고 응답을 별도로 확인한다.
