# 재인증 도중 계정 변경 시 데이터 연결 복구

2026-09-11. KI-W1-01 전체 종료가 아닌 부분 수정입니다.

## 확인한 결함과 변경

비밀번호/Google 재인증은 Firestore 연결을 일시 중지합니다. 인증 또는 세션 동기화 도중 UID가 바뀌면 `IDENTITY_CHANGED`를 거절하면서 연결 재개를 건너뛰었습니다. 같은 Provider가 유지되는 경우 다음 계정의 조회도 오프라인으로 남을 수 있었습니다.

두 오류 처리 경로 모두 기존 복구 함수를 먼저 실행하도록 순서를 바꿨습니다. UID가 달라지면 이전 사용자 토큰은 갱신하지 않으며, 원래 작업은 계속 거절합니다. Rules, 서버 세션 정책, 라우트, 화면 디자인, 의존성은 바꾸지 않았습니다.

## 재현과 검증

`node scripts/verify-step-up-provider-recovery.mjs`는 실제 React Provider 및 재인증 요청 helper를 실행합니다. 인증 SDK, AuthContext, 세션, Firestore transport는 실패를 주입하는 합성 어댑터입니다. 외부 연결은 CSP로 차단합니다. Firebase SDK가 bundle에 포함되지 않았음을 검사합니다.

- 수정 전 390/password/switch-reauth에서 `offline=true`로 실패했습니다.
- 수정 후 390×844, 768×1024, 1024×768, 1280×800, 1600×900에서 두 인증 방식과 여섯 상황, 총 60개가 통과했습니다.
- 정상 복구, 인증/세션 도중 계정 변경, 프로필 확인 대기, 비밀번호 오류/Google 창 취소, 세션 오류 후 취소를 확인합니다.
- 성공 전 프로필 준비 대기, 요청 결과 1회, 계정 변경 시 거절·이전 토큰 갱신 없음·연결 재개, 원래 주소 유지, 가로 넘침 없음, pageerror 없음도 확인합니다.
- 이 검사는 실제 Google 로그인, 새 auth_time, 서버 ACTIVE, Rules, 실제 다중 브라우저 컨텍스트 또는 업무 명령의 서버 반영 횟수를 입증하지 않습니다.

## 다음 최우선 확인: KI-W1-01 미해소

읽기 전용 통합 조사에서 다음 기존 위험을 발견했습니다. 이번 수정의 완료 범위에 포함하지 않습니다.

1. App의 StudentMaintenanceGate가 Provider 바깥에 있습니다. AuthContext의 토큰 갱신은 maintenance 상태를 checking으로 만들고, Gate는 children을 미마운트합니다. 진행 중 재인증 요청이 UNAVAILABLE로 취소될 수 있습니다. 또한 bootstrap은 server read이므로 Firestore pause와 충돌할 수 있습니다. 실제 AuthContext+Gate+Provider 조합 및 캐시 만료 후 재인증으로 재현해야 합니다. 기존 W5/W10의 maintenance-before-session, protected-provider 경계 계약을 함께 검토하며 단순 Rules 완화나 캐시 우회로 덮지 않습니다.
2. 준비 완료 대기 중 UID 변경/Provider 미마운트 뒤 늦은 비동기 완료를 별도로 검증해야 합니다. 업무 Gateway와 callable은 UID를 재검사하지만 Provider 요청 자체의 수명도 확인해야 합니다.
3. 오류 후 같은 요청 재시도, 실제 Google 재인증과 동일 사용자 다중 컨텍스트, 보호 listener 복구, users 서버 probe, 동일 command 반영 1회, 이전 bundle/직접 SDK 차단은 남은 수용 기준입니다.

운영 적용 판단에는 위 한계를 그대로 반영합니다. 테스트 배포 결과는 외부 야간 인수인계 기록에 정확한 commit과 함께 남깁니다. Production 접근이나 배포는 하지 않습니다.
