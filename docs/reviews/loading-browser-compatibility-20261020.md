# 공통 로딩 브라우저 호환성

## 범위와 원인

- 기준 커밋은 `e14c687d2be696085d28977081ec8a8fdab99b2e`이며, 작업 전 운영 도메인도 해당 Vercel 배포 `dpl_8uR2iGaX4BQTEvkJDpvLm3CeGkTB`로 확인했다. 집 PC의 기존 검증 스크립트 수정과 `output/` 자료는 별도 작업 공간으로 보존했다.
- 기존 공통 로딩은 동작 감소 설정에서 지구본과 말줄임 점을 정지했다. `matchMedia`, 미디어 쿼리의 `addEventListener`, `IntersectionObserver`, 프레임 API를 지원 여부 확인 없이 호출해 일부 환경에서는 React 로딩 화면 자체가 사라지는 오류도 재현했다.
- 학생·교사의 `PageLoading`, `InlineLoading`, `LoadingOverlay`에만 적용한다. 인증·권한·학기·게임 로직과 Firebase 배포 대상은 바꾸지 않는다.

## 변경

- 사용자 요청에 따라 공통 로딩의 지구 자전·공전 점·말줄임 점은 동작 감소 설정과 관계없이 움직인다. 해당 예외를 `DESIGN.md`의 기존 공통 로딩 계약에 반영했다. 색·글자·크기·간격·문구는 그대로 사용한다.
- 미디어 쿼리 API 의존성을 제거했다. 화면 교차 관찰 API가 있을 때만 HTML 로딩 컨테이너를 관찰하며, 없으면 애니메이션을 계속 실행한다.
- 프레임 요청 또는 취소 API가 없으면 최대 30fps의 타이머로 대체한다. 정수 밀리초 절삭으로 갱신 주기가 절반이 되지 않도록 타이머 간격을 올림한다.
- 숨김 탭·화면 밖·`pagehide`에서는 프레임과 점 애니메이션을 멈추고, 화면 복귀·`pageshow`에서 재개한다. 해제 후 지연된 관찰 콜백이 와도 루프를 다시 시작하지 않는다.

## 검증

- `npm run build` 통과. TypeScript와 최종 XLSX `hair` 구분선, 학습지·PDF·사전·지도 검사를 포함한다. 기존 청크 크기 및 정적/동적 import 경고는 유지된다.
- `npm run verify:portal-design`: 학생·교사 84개 검사, 오류·실패 0건.
- `node scripts/verify-auth-startup-browser.mjs`: 인증 화면 115개 검사·57장 캡처 통과. 합성 인증 응답을 사용하며 운영 로그인이나 쓰기는 하지 않는다.
- 전용 검사 명령: PowerShell에서 `$env:LOADING_BROWSER_ENGINES='msedge,chrome,chromium,firefox,webkit'` 설정 후 `node scripts/verify-loading-state-browser.mjs` 실행. 기존 기본 실행은 시스템 Edge를 유지한다.
- Edge 155.0.4283.62, Chrome 155.0.8059.85, Chromium 151.0.7922.34, Firefox 153.0, WebKit 26.5에서 모두 통과했다. 엔진별 8장, 총 40장 캡처를 남겼다.
- 각 엔진에서 320·390·768·1280px 배치, 인라인·오버레이, 초기 동작 감소 및 설정 전환, 지구·궤도·CSS 점 변화, 18초 궤도 가림·재등장·방향 반전을 확인했다.
- 미디어 쿼리 API 누락·구형 리스너, 화면 교차 관찰 API 누락, 프레임 요청·취소 API 각각의 누락을 검사했다. 숨김·화면 밖 정지/복귀, 반복 `pageshow`의 단일 루프, 해제 후 타이머·관찰자·리스너 정리도 확인했다.
- 변경 TSX·CSS·검증 스크립트의 Prettier와 `git diff --check` 통과. WebKit 터치 390px 및 실제 인증 대기 390px 캡처에서 배치와 잘림을 직접 확인했다.

## 증거와 한계

로컬 증거는 `output/loading-browser-compatibility-20261020/`에 보존한다. 기존 코드 재현은 `original-reproduction.json`, 엔진별 결과는 `loading-checks.json`과 각 엔진 폴더, 공통 포털·인증 결과는 `portal/`, `auth/`에 있다. 운영 반영 후 익명 로그인 모듈의 로드를 잠시 지연하여 실제 배포된 로딩을 검사하고 `production/`에 결과를 남긴다.

브라우저 엔진과 터치·화면 크기 에뮬레이션 검사이며 실제 휴대전화·태블릿 기기 검사는 아니다. WebKit 검사가 모든 Safari 버전이나 앱 내 웹뷰의 동작을 보장하지는 않는다. 숨김·페이지 수명 주기는 합성 이벤트, 화면 밖 이동은 실제 IntersectionObserver로 확인했다.
