# 2026학년도 2학기 Production Rollback Runbook

이 문서는 2026-2 Cutover 중단·복구 절차를 정의합니다. Rollback은 데이터 손상을 숨기기 위한 삭제가 아니라, source 보존과 target 격리, 감사 가능한 보상 작업을 우선합니다.

## 1. 공통 원칙

- Maintenance와 backend write fence를 유지합니다.
- 2026-1 원본을 rollback 재료로 수정하지 않습니다.
- 성공한 학생 활동이 생긴 뒤 target을 통째로 삭제하거나 pointer를 blind write하지 않습니다.
- code, Rules, Functions, index, schema, data, pointer를 서로 다른 rollback 단위로 봅니다.
- 모든 판단은 R0·R1·R2 snapshot, Cutover Manifest, receipt·audit, actual diff를 기준으로 합니다.
- secret 값은 log·문서·명령 기록에 남기지 않습니다.

## 2. Rollback 선언 조건

즉시 Rollback 조건:

- 데이터 유실 또는 Archive 원본 수정
- Auth UID 변화
- ACTIVE 학기 0개 또는 2개
- 교사 접근 장애 또는 권한 우회
- Wis ledger·balance·rank 불일치
- 공식 성적·평가 결과 무결성 손상
- 승인 목록 밖 Production write

단순 문구·시각 문제는 데이터 Rollback과 분리하고, 가능하면 maintenance-safe frontend만 되돌립니다.

## 3. 첫 10분 조치

1. 학생 Maintenance와 Domain write fence 유지
2. 신규 Cutover·Domain command 중단
3. incident ID와 최초 관측 시각 기록
4. 현재 deployment, Rules, Functions, pointer, Manifest revision 고정 기록
5. R2 또는 실패 시점 snapshot 확보
6. 예상 밖 write 범위 확인
7. source 2026-1 count/hash 불변 확인
8. 복구 책임자와 승인자 지정

이 단계에서 target 문서를 임의 삭제하지 않습니다.

## 4. 코드 문제

1. 승인된 maintenance-safe Known-Good deployment를 선택합니다.
2. backend schema·Rules·Functions 호환성을 확인합니다.
3. 고정 alias를 해당 deployment로 되돌립니다.
4. 로그인, Maintenance, 교사 Shell, Cutover 상태 조회를 smoke test합니다.
5. 데이터 diff가 늘지 않았는지 확인합니다.

W1 Maintenance fence가 없는 오래된 frontend는 rollback target이 아닙니다.

## 5. Rules·Functions 문제

### Rules

- 승인된 이전 Rules release를 복원합니다.
- Archive write fence, direct SDK deny, Maintenance 경계를 약화하지 않습니다.
- 역할별 emulator와 합성 smoke를 다시 실행합니다.

### Functions

- 호환성 manifest가 확인된 함수 revision만 복원합니다.
- discovery 실패 시 함수별 배포를 사용하되 승인된 Production 절차 안에서만 실행합니다.
- application session, recent-auth, idempotency receipt가 유지되는지 확인합니다.

Index는 additive 상태로 두고 먼저 query/client를 되돌립니다. 장애 직후 index를 삭제하지 않습니다.

## 6. Migration 중간 실패

Activation 전이라면 다음 순서로 처리합니다.

1. 실패 item과 receipt 상태를 확인합니다.
2. 성공 item을 재실행하지 않고 FAILED·PENDING item만 `resume`합니다.
3. 동일 child command ID와 payloadHash를 유지합니다.
4. 재시도 불가능한 경우 target을 QUARANTINED로 표시합니다.
5. W11 rollback-plan의 역순 compensation 목록을 검토합니다.
6. owning Domain command로 target-only 보상 작업을 수행합니다.
7. source count/hash 영향 0을 확인합니다.
8. 새로운 plan·Manifest revision으로 처음부터 승인 절차를 다시 밟습니다.

리허설 데이터를 전체 삭제한 뒤 다시 넣는 것만으로 resumable을 주장하지 않습니다.

## 7. 잘못된 Selective Clone

- source를 수정하지 않습니다.
- target master를 owning Domain의 archive·quarantine·delete 계약으로 분리합니다.
- Assessment Attempt, Grade, Attendance, progress, notification state, Wis value movement가 0인지 확인합니다.
- 잘못된 대상이 학생에게 노출되지 않았는지 query evidence를 확인합니다.
- 수정된 Manifest version과 새 operation ID를 발급합니다.
- dry-run과 Expected Diff 승인부터 다시 시작합니다.

## 8. 잘못된 Enrollment

1. target roster revision과 승인 roster를 비교합니다.
2. 신규 업무를 차단합니다.
3. target Enrollment를 이전 승인 revision으로 보상합니다.
4. student identity와 2026-1 Enrollment가 변하지 않았는지 확인합니다.
5. 학생×학기 ACTIVE Enrollment 최대 1개, orphan·duplicate 0을 재검증합니다.
6. selector와 Dashboard projection hash를 다시 계산합니다.

현재 `users.grade/class/number`를 rollback source로 사용하지 않습니다.

## 9. Wis 오류

1. target Economy를 QUARANTINED 또는 접근 불가 상태로 둡니다.
2. 주문·grant·ledger 신규 command를 막습니다.
3. 2026-1 Economy·Ledger count/hash 불변을 확인합니다.
4. target account·balance·ranking·ledger를 서로 대조합니다.
5. value movement가 없다면 target-only 보상 재생성을 검토합니다.
6. value movement가 있다면 삭제하지 않고 reconciliation·compensating command를 사용합니다.

과거 Ledger를 reset하거나 2026-2로 복제하지 않습니다.

## 10. 잘못된 활성화

Activation transaction이 실패했다면 기존 pointer가 유지됐는지 확인합니다. 일부 pointer만 수동으로 고치지 않습니다.

Activation이 성공했고 아직 target 활동 write가 0이라면:

1. Maintenance와 write fence 유지
2. W3 원자 activation의 보상 절차 승인
3. 이전 학기의 허용 lifecycle과 fresh readiness 확인
4. CAS를 사용해 pointer·Manifest·legacy config를 한 transaction으로 복구
5. ACTIVE 정확히 1개 확인

target 활동 write가 이미 있다면 blind pointer rollback과 target 삭제를 금지합니다. 활동을 보존한 채 별도 reconcile 계획을 승인합니다.

## 11. 전체 Restore가 필요한 경우

Firestore full restore는 path·pointer 보상으로 무결성을 회복할 수 없을 때만 사용합니다.

1. 새 Recovery DB에 R0/R1 export 복원
2. 실패 시점 Production과 collection별 count/hash diff
3. 복구 대상 path를 승인된 목록으로 제한
4. 선택 복구 후 referential integrity 검증
5. Auth UID, Rules, Functions, Storage와 호환성 확인
6. 별도 승인 뒤 Production에 적용

Production 전체를 즉시 덮어쓰지 않습니다.

## 12. Rollback 완료 조건

- ACTIVE 학기 정확히 1개
- source 2026-1 count/hash 불변 또는 승인된 보상 evidence 존재
- Archive write 0
- Auth UID 변경 0
- 금지 데이터 cross-semester leakage 0
- Wis·Grade·Attendance 무결성 PASS
- Rules·Functions·frontend 호환성 확인
- 합성 관리자·교사·학생 smoke PASS
- receipt·audit와 incident timeline 보존
- Expected Diff 밖의 잔여 write 0

완료 뒤에도 학생 Maintenance 해제는 별도 승인입니다.
