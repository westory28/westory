# Google 팝업 로그인 복구

운영 Chrome에서 Google 계정 선택 이후 로그인 대기가 계속된다는 신고가 있었다. 관찰된 팝업은 계정 선택 화면에 남아 있었고, 팝업을 닫자 위스토리는 정상적으로 취소 상태로 돌아왔다. 운영 `/__/auth/handler`, iframe, JavaScript와 기존 Firebase 역방향 프록시는 정상 응답했다. Google 팝업 내부의 정지 원인은 확정하지 않았으며, 서버 세션·권한 문제로 단정하지 않는다.

기존 `signInWithPopup` 취득은 사용자 선택 시간을 제한하지 않지만, 부모 화면이 전면 로딩으로 바뀌어 취소나 다른 인증 방식으로 전환할 수 없었다. 팝업 취득 중 전용 화면에서 취소 및 현재 창 로그인(`signInWithRedirect`)을 제공한다. 현재 창 방식을 명시적으로 선택한 경우만 이 브라우저에 기억한다. 자동 시간 제한이나 임의 인증 성공 처리는 추가하지 않는다.

취소 시 해당 flow/operation을 먼저 폐기한다. 이전 팝업의 늦은 credential은 기존 stale credential 보호를 통과해야 하며 새 시도를 완료하거나 잠금을 해제할 수 없다. 계정·역할 판별, 서버 세션 생성, 프로필 확인, 학생 가입 승인과 경로 보호는 그대로 유지한다. Functions/rules 변경이 없으므로 Firebase 배포 대상도 없다.

검증: 실제 Login 함수 기반 acquisition 86개, redirect 21개, startup 85개 및 route gates 검사 통과. 새 검사는 명시 전환·취소·다음 로그인 선호·늦은 응답·새 팝업·이중 클릭과 버튼 연결을 포함한다. route gates의 기존 누락된 `window.matchMedia` mock만 보강했으며 기존 조건은 제거하지 않았다.

`npm run build`, `npm run format:check`, `git diff --check`를 통과했다. Vercel 운영 승격, 실제 현재 창 Google 인증과 교사 포털 진입은 배포 후 별도 확인한다. UI 복구 경로만으로 Google 내부 정지 원인까지 제거했다고 보고하지 않는다.
