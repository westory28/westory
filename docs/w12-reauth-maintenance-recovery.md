# 재인증과 점검 상태 확인의 통합 복구

2026-09-11. KI-W1-01의 클라이언트 결함 수정이며 전체 운영 수용 완료는 아닙니다.

## 재현한 문제

실제 AuthContext, applicationSession, studentMaintenance, 두 접근 Gate와
StepUpReauthProvider를 조합하고 I/O만 합성 어댑터로 바꾼 브라우저에서 재현했습니다.
초기 로그인 후 maintenance 캐시 2초가 만료된 상태에서 재인증하면 다음 순서로 실패했습니다.

1. 사용자 listener와 보호 화면을 내린 뒤 Firestore를 일시 중지합니다.
2. 새 인증 토큰 이벤트가 AuthContext의 maintenance 서버 조회를 시작합니다.
3. 연결 중지 중 조회가 실패하고 maintenance 상태가 error가 됩니다.
4. 상위 Gate가 재인증 Provider를 미마운트해 원래 요청은 UNAVAILABLE로 취소됩니다.

별도 실제 maintenance helper 검사에서는 이전 조회의 늦은 실패가 UID 캐시에
남아 새 요청까지 error로 만드는 문제도 재현했습니다.

## 변경과 보안 경계

- 재인증 Provider만 점검 Gate 바깥에서 유지합니다. 업무 콘텐츠는 두 Gate 안에 있습니다.
- 재인증 준비 전에 인증 조회 대기를 획득하고, Firestore 재개 뒤 해제합니다.
  재개 실패도 대기를 해제하여 서버 조회 실패/오류 처리로 끝나게 합니다.
- AuthContext는 토큰 이벤트 순번과 인증 revision으로 오래된 비동기 결과를
  폐기합니다. 로그아웃 이벤트는 대기하지 않습니다. 조회 제한 시간은 대기 종료 후 시작합니다.
- 같은 UID에서도 최종 사용자 서버 조회가 끝날 때까지 인증 확인 상태를 유지합니다.
  사용자 identity와 설정은 유지하며, 보호 화면은 확인 완료 뒤 복구합니다.
- 재인증 시작 시 본인 maintenance 캐시를 무효화합니다. 이전 promise는 새 캐시를 덮어쓰지 못합니다.
- 각 비동기 단계와 완료 대기에서 현재 요청/UID를 확인합니다. 점검 차단 상태의
  새 요청은 거절하며, 진행 중 차단/계정 변경도 원래 작업을 취소합니다.
- disableNetwork가 완료되기 전 미마운트되어도 연결 재개를 예약합니다.
  미마운트 뒤 늦은 응답은 재인증이나 이전 계정 토큰 갱신을 시작하지 않습니다.

초기 Auth/Login의 maintenance-before-session은 유지합니다. StepUp session callable에도
기존 서버 maintenance 검사가 적용됩니다. Rules, Functions, 역할 정책, 의존성은 변경하지 않습니다.
사용자 수업 기능과 사이드 메뉴도 변경하지 않습니다.

## 검증 도구와 한계

- `scripts/verify-reauth-maintenance-integration.mjs`: 실제 컨텍스트/세션·점검 helper/Gate/Provider,
  합성 SDK I/O. 5개 viewport에서 정상·실패 재시도·점검 전환·초기 차단·최종 조회 대기/실패/로그아웃을 검사합니다.
- `scripts/verify-step-up-provider-recovery.mjs`: 실제 Provider와 요청 helper,
  합성 어댑터. 인증/세션/준비 대기 중 UID 변경, begin/pause 중 미마운트 등 90개 시나리오입니다.
- `scripts/verify-authentication-read-barrier.mjs`: 독립 대기 소유권, 중복 해제, 새로운 대기를 검사합니다.
- `scripts/verify-maintenance-bootstrap-recovery.mjs`: 이전 조회 실패와 새 캐시의 분리를 검사합니다.
- 기존 step-up, 현재 W10P shell, 메뉴/route, 조회 순수성, 쓰기 경계, 타입 기준, 포맷, 빌드도 확인합니다.

기존 `verify-w5-shell-safety.mjs`는 현재 package script가 실행하는 검사가 아닙니다.
현재 `npm run verify:w5-shell-safety`는 W10P 검사를 실행합니다. 과거 W5 파일을
직접 실행하면 기존 presentation freeze와 맞지 않는 shell header 계약에서 실패하며,
이번 작업에서 그 과거 계약을 바꾸거나 통과했다고 보고하지 않습니다.

합성 브라우저의 effects=1은 클라이언트 요청 재개 1회입니다. 실제 서버 receipt/업무 효과 1회,
Firebase SDK의 토큰 전달, 실제 Google popup, 동일 사용자 여러 브라우저 컨텍스트의
세션 복구는 이 검사로 입증하지 않습니다. KI-W1-01의 해당 수용 기준은 별도 실제
SDK·Staging 검증으로 남습니다. 정확한 테스트 실행 결과와 배포 소스는 야간 인수인계에 기록합니다.
