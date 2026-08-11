# W8 Learning / Schedule / Attendance / Communication Handoff

## 목적

이 문서는 W7 학기 경제를 W8의 학습, 일정, 출석, 알림과 안전하게 연결하기 위한 계약입니다. W8은 각 domain의 원본과 사용자 흐름을 담당하고, 잔액 계산과 원장 무결성은 W7이 계속 소유합니다.

## W7 source of truth

| 성격        | 경로                                             | W8 사용 방식                 |
| ----------- | ------------------------------------------------ | ---------------------------- |
| 학기 경제   | `semester_wis_economies/{semesterId}`            | 학기 정책과 운영 상태 확인   |
| 학생 계정   | `semester_wis_accounts/{accountId}`              | student·Enrollment 결합 확인 |
| 불변 원장   | `semester_wis_ledger/{ledgerEntryId}`            | 보상·회수 결과 reference     |
| 잔액·순위   | Balance / Ranking projection                     | query projection으로만 표시  |
| 대조 보고서 | `semester_wis_reconciliation_reports/{reportId}` | readiness dependency         |

W8 화면은 위 문서를 직접 읽거나 쓰지 않습니다. 학생에게 WIS 요약이 필요하면 `getWisEconomyState`의 학생 projection을 사용합니다.

## 학습 보상

기존 `applyPointActivityReward`를 다시 열지 마십시오. 학습 완료 보상이 필요하면 W8 domain module과 W2 gateway에 명시적 command를 추가합니다. source reference는 최소한 다음을 포함해야 합니다.

- `semesterId`
- `studentUid`
- `enrollmentId`
- 학습 원본의 결정적 ID와 revision/hash
- 보상 policy ID/version
- 활동 완료 시각과 검증자

권장 source 예시는 `LEARNING_COMPLETION:{semesterId}:{activityId}:{attemptId}:{policyVersion}`입니다. 같은 source의 active Ledger effect는 최대 한 개입니다. 새로고침, 여러 기기, 응답 유실, 동시 클릭에서도 중복 지급하면 안 됩니다.

## 출석 보상과 제재

출석 화면의 체크, 목록 조회, 교사 수정은 W8 Attendance 원본에만 기록합니다. 출석 확정과 WIS 보상은 다음 조건을 갖춘 서버 workflow로 분리합니다.

- 출석 record가 최종 상태인지 서버에서 재검증
- student와 현재 Enrollment 일치
- 날짜·교시·정책 source가 결정적
- 교사 정정 시 기존 Ledger를 고치지 않고 reversal/delta entry 추가
- Archive 학기 출석으로 CURRENT WIS를 바꾸지 않음
- 같은 출석을 여러 번 저장해도 보상 effect 1회

결석이나 지각을 이유로 자동 음수 잔액을 만들지 마십시오. 교육 정책과 관리자 승인 없이 벌점·차감 기능을 암묵적으로 연결하면 안 됩니다.

## 일정

일정 등록, 공휴일 동기화, 학기 일정 조회는 WIS mutation을 일으키지 않습니다. 일정에 보상 안내를 표시할 수는 있지만, 일정 mount·알림 예약·달력 이동을 지급 trigger로 사용하지 마십시오.

W3 canonical active pointer와 W4 Archive fence를 따릅니다. 일정의 `semesterId`가 WIS Account의 학기와 다르면 보상 command를 거부합니다.

## 알림

알림은 domain commit 뒤의 communication 결과입니다. WIS transaction 안에서 push·email·알림 문서를 기다리지 않습니다.

- Ledger commit 성공 뒤 outbox/event로 알림 요청
- 알림 실패가 지급을 rollback하지 않음
- 재시도 시 notification dedupe key 사용
- 알림 본문에 전체 receipt, 내부 source hash, 다른 학생 balance를 노출하지 않음
- 학생은 자신의 잔액·주문만 확인

주문 승인·반려·수령 알림도 같은 원칙을 따릅니다. 알림 클릭 URL은 canonical `/student/points?tab=orders`를 사용합니다.

## Query purity

- W8 mount/reload persistent write 0
- 숨은 mobile/desktop component 중복 listener 0
- calendar, attendance, notification controller가 WIS query를 각각 중복 실행하지 않음
- 전역 요약은 authorized data layer에서 한 번만 조회
- query 실패를 EMPTY로 숨기지 않고 ERROR/OFFLINE/PERMISSION으로 구분
- repair와 migration은 query에서 실행하지 않음

## Archive / Legacy

- W8 CURRENT가 비어도 WIS ARCHIVE·LEGACY를 대신 표시하지 않음
- 2026-1 출석·학습 source로 2026-2 Account를 보상하지 않음
- Archive 화면에는 `ARCHIVE`, read-only를 text와 icon으로 표시
- Legacy source는 명시적 adapter와 migration evidence 없이는 Ledger로 승격하지 않음
- 과거 이름·현재 학급이 아니라 Enrollment와 원본 ID로 결합

## Readiness

W8이 WIS 보상 adapter를 추가하면 W7 readiness dependency에 다음 작은 root만 연결합니다.

- W8 reward policy revision
- 마지막 reward reconciliation report
- processed source set의 결정적 hash
- W7 Economy revision과 Ledger dependency hash

학습·출석 원본 전체를 W3 readiness transaction에서 매번 읽지 않습니다. W8 자료가 선택 기능인 학기에는 자료가 없다는 이유만으로 WIS readiness를 실패시키지 않습니다.

## Previous bundle 차단

다음 writer는 계속 fail-closed 상태로 둡니다.

- `applyPointActivityReward`
- `resetLessonCorePointProgress`의 legacy point mutation 경로
- client `claimPointActivityReward`의 직접 point writer
- 이전 wallet/transactions/rank projection write

W8 cutover가 끝나기 전까지 호환 adapter가 필요해도 old writer를 다시 활성화하지 않습니다. 새 W8 command가 준비된 기능만 순서대로 연결합니다.

## W8 acceptance test

- 학습 완료 source reward exactly-once
- 출석 저장 retry와 동시 실행 effect 1회
- 출석 정정 reversal/delta와 원본 Ledger 불변
- 다른 student·Enrollment·semester source 거부
- Archive·Legacy source write 0
- 알림 실패 후 Ledger commit 유지, 알림 재시도 dedupe
- mount/reload/query write 0
- hidden responsive component listener 중복 0
- W7 balance/ranking/reconciliation 일치
- W2~W7 aggregate와 TypeScript 신규 오류 0
- Dedicated Staging fixture owner/testRunId cleanup residual 0

## W8에서 하지 말아야 할 일

- 학습·출석 문서에 WIS balance를 source of truth로 복사
- 화면 mount에서 보상 지급 또는 projection repair
- 알림 성공과 Ledger commit을 하나의 client workflow로 묶기
- 현재 profile 학급으로 과거 기록 재결합
- Archive 자료를 CURRENT 보상 source로 사용
- 이전 point callable이나 Rules write 재개방
- W9 bulk draft나 실제 투자 기능까지 범위 확장
