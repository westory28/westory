# 공통 지구본 로딩과 공개 화면 깜박임

## 범위와 디자인 확인

- 기준: `180c6b3105b344f76b2c6f84e29f0a043083e3a3`. 작업 시작 당시 운영 `www.westory.kr`도 같은 커밋이었다.
- 기존 지도 작업을 보존하기 위해 별도 `codex/globe-loading` 작업 공간에서 진행했다.
- 루트/양 포털 AGENTS, UI_RULES, DESIGN의 공통 화면·색상·글자·간격·모션 계약을 확인했다. 학생·교사 공용 `PageLoading`, `InlineLoading`, `LoadingOverlay`와 라우트 대기만 변경한다.
- 일반 로딩의 카드·그림자·경고·상황별 하단 문구를 제거하고 지구본, Westory 로고, `처리 중...`만 표시한다. 오류/복구 화면, 입력·동의 창, 게임 전용 로딩, 버튼·표 셀의 국소 상태는 유지한다.
- 기존 primary/primary-soft/amber, 8/16/40px 간격과 Noto Sans KR을 재사용한다. 로딩의 SVG 경로 갱신은 DESIGN에 기록한 제한적 모션 예외다. 신규 장식 카드·색상·폰트·글로우·사이드바는 없다.

## 구현

- 공개 인터랙티브 지구본과 같은 `land-globe.json`의 Natural Earth 육지(공개 도메인)를 약 16KB의 로컬 윤곽으로 단순화했다. `node scripts/generate-loading-globe.mjs`로 재생성한다. 로딩에 별도 네트워크 요청을 추가하지 않는다.
- 정사영 SVG를 갱신해 대륙이 실제 구면 위에서 자전한다. 노란 점은 깊이에 따라 지구 앞/뒤 SVG 레이어로 옮겨 가려짐을 표현하고, 궤도 기울기와 진행 방향을 부드럽게 바꾼다. 최대 30fps, 숨김·화면 밖 정지, 동작 감소 정지, 해제 시 프레임/관찰자 정리를 적용했다.
- 인증 Context의 `loading`은 서버 프로필 검증 후 먼저 해제된다. Login의 자동 복귀 effect·추가 검증·navigate가 끝나기 전 공개 화면이 렌더되던 틈을 로딩으로 막았다. redirect 복구와 인증 작업 중에도 유지한다. 가입/동의 모달은 기존 공개 화면의 포커스 트랩을 그대로 사용한다.
- 로그아웃 후 동일 `#/`로 replace할 때 재로드되지 않아도 완료된 busy 상태를 해제한다. 권한·학기·Firebase 서버 검증 로직은 변경하지 않는다.

## 검증과 증거

- `node scripts/verify-loading-state-browser.mjs`: 실제 Edge에서 390/768/1280px 페이지, 인라인·오버레이, 기존 문구 제거, 가로 넘침, 접근성 상태를 확인했다. 18초 모션에서 자전·뒤편 완전 가림·재등장·진행 방향 반전을 확인하고 동작 감소·화면 밖 정지·해제도 검사한다.
- 로컬 시각 증거: `.superloopy/sessions/globe-loading/evidence/`의 `page-390.png`, `page-768.png`, `page-1280.png`, `inline-1280.png`, `overlay-1280.png`, `loading-checks.json`.
- 인증 검증은 합성 계정과 서버 응답을 사용하며 운영 계정 로그인이나 데이터 쓰기를 하지 않는다. MutationObserver로 인증 준비부터 이동 완료까지 공개 화면이 잠깐이라도 mount되는지 확인한다.
- `node scripts/verify-auth-startup-browser.mjs`: 115개 검사·57개 화면 캡처 통과, 브라우저 오류 0. 390/768/1280px 인증·가입·동의·팝업 취소와 320px 포함 정상 공개 화면을 확인했다. 결과는 `.superloopy/sessions/globe-loading/evidence/auth-loading-report.json`에 보관한다.
- `verify-auth-route-gates.mjs`, `verify-login-acquisition.mjs`(86건), `verify-login-redirect-recovery.mjs`(21건), 변경 TS/TSX 포맷 및 `git diff --check` 통과.
- `npm run verify:portal-design`: 학생·교사 지도/탭/트리 및 교사 설정의 320/390/768/1280/1366/1440px, 84개 검사 통과. 실패·브라우저 오류 0. 결과는 같은 evidence의 `portal/result.json`에 보관한다.
- `npm run build` 통과. TypeScript, 최종 XLSX `hair` 구분선, 수업/PDF, 사전, 지도 필수 검사를 포함한다. 기존 대형 청크 및 pointRanks 정적/동적 import 경고는 남는다.
