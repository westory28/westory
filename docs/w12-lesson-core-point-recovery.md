# 핵심포인트 요청과 화면 전환 복구

학생이 핵심포인트를 누르거나 보상을 요청한 뒤 계정·단원·학기가 바뀌면 이전 작업의 결과가 현재 화면을 변경하지 않아야 한다. 이 변경은 교사 제시 화면이나 판서를 복원하지 않으며 기존 찾기 효과·보상·학생 미리보기와 답안 저장 경로를 유지한다.

## 수정한 경계

- 명령을 시작한 UID를 `getHttpsCallable`의 선택적 `expectedUid`에 전달한다. Firebase Functions 준비와 applicationSession 동적 로딩을 마친 뒤, 실제 전송 직전에 UID를 확인한다. 옵션을 사용하지 않는 기존 호출의 동작은 유지한다.
- 핵심포인트 helper는 응답과 로컬 retry handle 정리 후에도 UID를 확인한다. 계정이 바뀐 동안 이전 소유자의 retry handle을 다른 사용자의 명령으로 처리하거나 제거하지 않는다.
- 수업 화면의 기존 답안 문맥 토큰을 핵심포인트에도 사용한다. 이전 문맥의 성공·실패·finally와 overview 결과는 현재 상태·알림을 변경하지 않는다.
- 같은 문맥에서는 overview 요청 순서도 검사한다. 오래된 성공·실패가 최신 진행률과 보상 수령 상태를 덮지 않으며, 현재 단원 찾기 수는 응답 시점의 최신 상태로 계산한다.
- 초기 복원을 기다리는 중 새로 찾은 포인트를 보존한다. 명령 성공을 확인하지 못한 포인트만 해당 화면의 임시 찾기 집합에서 제거한다.
- 찾기 저장 또는 보상 지급이 서버에서 성공한 뒤 후속 overview 조회만 실패하면 확정된 결과를 되돌리거나 지급 실패로 안내하지 않는다. 현재 문맥에서 서버가 확정한 보상 수령은 뒤따른 캐시의 미수령 값으로 되돌리지 않는다.

## 검증

- `node scripts/verify-lesson-core-point-identity.mjs`: 실제 helper와 실제 callable factory의 소스에 통제된 SDK·모듈 로딩을 연결한다. factory 준비, session 모듈 로딩, 응답 대기 중 계정 변경·로그아웃, 소유자별 retry ID 격리와 응답 유실 후 같은 ID 재시도, stream 전송 경계 및 기존 옵션 없는 호출을 검증한다. 제품 Firebase 초기화 전체나 실제 Google 로그인 검증은 아니다.
- `node scripts/verify-lesson-core-point-recovery.mjs`: 실제 LessonContent와 worksheet 컴포넌트에 합성 비동기 I/O를 연결한다. 390/768/1280/1440px에서 늦은 복원, 단원·계정 전환 중 응답, 저장 후 조회 실패, 이전 overview 성공·실패의 역전, 보상 성공 후 조회 실패, 재시도와 미리보기를 확인한다. Firebase와 외부 네트워크는 차단한다.
- `scripts/verify-w10p-lesson-core-point-integration.mjs`: 기존 Auth/Firestore/Functions 에뮬레이터 통합 검증의 최초 보상 청구를 서로 다른 명령 ID 두 개의 동시 요청으로 보강했다. 한 요청의 응답을 커밋 후 잃게 한 뒤 receipt로 복구하고 두 결과 중 지급은 하나, 원장은 한 건, 잔액 증가는 500임을 확인한다.

## 남은 범위

실제 Google 로그인, 전체 제품 Firebase/AppCheck 초기화, 실제 Staging 학생의 보상 지급, 여러 브라우저 context, 학생 답안 저장과 찾기의 실제 동시 트랜잭션 수용은 별도 검증 대상이다. 답안의 초기 읽기 실패 후 복구 및 저장 결과가 불확실한 동안 입력이 바뀌는 경우도 이번 변경에서 완료로 처리하지 않는다. 서버 보상 정책·금액·Rules·Functions는 변경하지 않았다.
