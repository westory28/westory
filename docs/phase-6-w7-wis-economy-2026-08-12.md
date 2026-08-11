# PHASE 6 — W7 Wis Economy

## 1. Executive Summary

W7에서는 위스를 단순한 사용자 문서의 숫자가 아니라 학기별 Economy, 학생 Account, 불변 Ledger, Balance·Ranking projection, 상품·재고·주문으로 나눴습니다. 잔액은 Ledger 합계에서만 나오며, 지급·회수·정정·되돌리기·주문은 모두 W2 Command Gateway를 통과합니다. 화면을 열거나 새로고침하는 동작은 데이터를 바꾸지 않습니다.

2026-2 CURRENT 자료와 2026-1 ARCHIVE 자료를 명시적으로 구분했습니다. 현재 학기만 쓸 수 있고, 지난 학기와 Legacy는 조회 전용입니다. 기존 point writer와 이전 bundle의 직접 쓰기는 client, Functions, Firestore Rules, Storage Rules에서 fail-closed로 막았습니다.

최종 판정은 `READY FOR W8 LEARNING / SCHEDULE / ATTENDANCE / COMMUNICATION STAGING DEVELOPMENT`입니다. 이 판정은 Dedicated Staging에서 W7 기반을 검증했다는 뜻이며, Production 승격이나 실제 투자 기능의 완성을 뜻하지는 않습니다.

## 2. Baseline

- 기준 브랜치: `codex/phase6-w6b-grade-evidence`
- 기준 SHA: `5bb4d4dde9dc6a40b14acf3f05984aa3542ddf26`
- 작업 브랜치: `codex/phase6-w7-wis-economy`
- 시작 당시 `origin/main` 대비: ahead 0, behind 41
- 사용자 문서, W1 evidence, `tmp/**`, `.env.local`, 기존 W1 viewport 실행 파일은 W7 commit 범위에서 제외했습니다.
- Production 데이터, Rules, Functions, Vercel, alias, 환경변수, Maintenance 설정은 변경하지 않았습니다.

## 3. Canonical Economy Model

| 성격            | 경로                                             | 계약                             |
| --------------- | ------------------------------------------------ | -------------------------------- |
| 학기 경제       | `semester_wis_economies/{semesterId}`            | 정책·상태·revision의 학기별 root |
| 학생 계정       | `semester_wis_accounts/{accountId}`              | Enrollment에 결박된 CAS head     |
| 불변 원장       | `semester_wis_ledger/{ledgerEntryId}`            | create-only, 수정·삭제 금지      |
| 잔액 projection | `semester_wis_balances/{accountId}`              | Ledger 합계 재구축 가능          |
| 순위 projection | `semester_wis_rankings/{accountId}`              | 잔액 기반 결정적 순위            |
| 상품 catalog    | `wis_product_catalog/{productId}`                | 상품 정의와 revision             |
| 학기 재고       | `semester_wis_inventory/{inventoryId}`           | 가격·판매 가능·예약·완료 수량    |
| 주문            | `semester_wis_orders/{orderId}`                  | 요청·승인·반려·수령 상태         |
| 대조 보고서     | `semester_wis_reconciliation_reports/{reportId}` | Ledger와 projection 대조 근거    |
| Legacy 이슈     | `wis_legacy_issues/{issueId}`                    | 명시적 migration 판단 기록       |

`accountId`는 semester와 student UID에서 결정합니다. 학생 이름이나 현재 학년·반은 join key가 아닙니다. Account는 W4 Enrollment와 Class를 서버 transaction에서 확인한 뒤 만듭니다.

## 4. Economy Lifecycle

학기 경제의 상태 전이는 다음과 같습니다.

`ACTIVE_INITIALIZING` → `ACTIVE_OPEN` → `CLOSED` → `ARCHIVED`

초기화 단계에서는 Account 생성과 최초 지급을 수행합니다. 최초 지급이 필요한 Account가 하나라도 빠지면 상점을 열 수 없습니다. 학생 주문은 `ACTIVE_OPEN`에서만 허용합니다. `CLOSED` 이후에는 운영 자료를 바꿀 수 없고, `ARCHIVED`에서는 query-only입니다.

W4 Manifest가 ACTIVE가 아니면 모든 W7 business write를 시작하기 전에 차단합니다. 서버 projection은 교사와 학생의 의미를 구분합니다. 교사는 ACTIVE 초기화 단계에서 운영 작업을 계속할 수 있지만, 학생은 상점이 열릴 때까지 구매할 수 없습니다.

## 5. Account & Initial Grant

`createWisAccounts`는 최대 100개의 Enrollment ID를 한 명령에서 검증합니다. 학기, ACTIVE Enrollment, student, class가 모두 맞아야 Account·Balance·Ranking을 원자적으로 생성합니다.

최초 지급은 Account당 한 번만 가능합니다. W7 Staging QA에서 버튼 문구는 500 위스를 가리키지만 입력창의 100이 전달될 수 있는 결함을 발견했습니다. 다음 두 겹으로 고쳤습니다.

- UI는 `initialGrantAmount`만 전송합니다.
- 서버는 요청 금액과 학기 정책 금액이 다르면 `WIS_INITIAL_GRANT_AMOUNT_MISMATCH`로 거부합니다.

잘못된 금액 요청은 Account, Ledger, receipt, audit을 하나도 남기지 않습니다. 같은 command 재시도와 동시 요청도 최초 Ledger entry 하나로 수렴합니다.

## 6. Immutable Ledger

지원하는 대표 Ledger type은 다음과 같습니다.

- `INITIAL_GRANT`
- `GRANT`
- `DEDUCT`
- `ADJUST`
- `REVERSAL`
- `ORDER_DEBIT`
- `ORDER_REFUND`

기존 entry의 delta나 잔액을 수정하지 않습니다. 오지급은 `reverseWisEntry`가 반대 delta의 새 `REVERSAL` entry를 만듭니다. 같은 account·type·source reference는 한 번만 반영됩니다. 음수 잔액, 중복 source, stale account revision은 transaction 전체를 취소합니다.

## 7. Projection & Reconciliation

Balance와 Ranking은 Ledger에서 파생한 projection입니다. `rebuildWisProjection`은 Ledger를 다시 합산하고 Account·Balance·Ranking을 같은 값으로 맞춘 뒤 immutable reconciliation report를 남깁니다.

화면 mount, reload, query에서는 projection repair를 하지 않습니다. 대조는 교사가 누르는 명시적 버튼과 gateway command로만 실행합니다. Dedicated Staging에서는 6개 Ledger entry의 합계 400과 Account balance 400이 일치했고 reconciliation report는 PASS였습니다.

## 8. Product, Inventory & Orders

상품 catalog와 학기 재고를 분리했습니다. 상품 설명은 catalog에, 학기별 가격과 재고는 inventory에 둡니다. inventory는 항상 다음 식을 만족해야 합니다.

`available + reserved + sold = stock`

학생 주문은 주문 문서, `ORDER_DEBIT`, Account balance, inventory reservation을 같은 transaction에서 처리합니다. 교사는 다음 흐름으로 처리합니다.

- `REQUESTED` → `APPROVED` → `FULFILLED`
- `REQUESTED` → `REJECTED`

반려하면 `ORDER_REFUND`와 예약 수량 복구가 같은 transaction에 들어갑니다. 승인과 수령은 서로 다른 명시적 행동이며, 화면 진입만으로 상태가 바뀌지 않습니다.

## 9. Command Gateway

W7 mutation 13개는 모두 `executeCommand`를 사용합니다.

- `createSemesterEconomy`
- `createWisAccounts`
- `grantInitialWis`
- `grantWis`
- `deductWis`
- `adjustWis`
- `reverseWisEntry`
- `rebuildWisProjection`
- `transitionWisEconomy`
- `upsertWisProduct`
- `upsertWisInventory`
- `placeWisOrder`
- `reviewWisOrder`

모든 명령은 application session, actor role/capability, ACTIVE semester, expected semester/economy/account/inventory/order revision을 business write 전에 확인합니다. receipt, audit, business document는 같은 transaction에서 확정됩니다. retry, 동시 실행, 응답 유실에서도 effect는 한 번입니다.

## 10. Query Contract

W7의 공개 query callable은 `getWisEconomyState` 하나입니다. 학생은 자신의 Account·Ledger·Order와 공개 상품·재고·순위만 봅니다. 교사는 `point_manage` capability가 있어야 학기 Account와 주문을 조회할 수 있습니다.

query 응답에는 `provenance`, `readOnly`, `manifestRevision`, Economy와 projection이 들어가며 `writeCount`는 0입니다. CURRENT가 비어도 ARCHIVE나 LEGACY를 대신 읽지 않습니다.

## 11. Semester / Provenance

- ACTIVE Manifest: `CURRENT`
- 준비 상태: `PREPARING`, read-only
- CLOSED·ARCHIVED Manifest: `ARCHIVE`, read-only
- 명시적 과거 호환 자료: `LEGACY`, read-only
- 특정 학기 지정 query: `EXPLICIT` 요청을 서버가 실제 Manifest 상태로 다시 판정

학생 `/student/points?semesterId=2026-1&source=ARCHIVE` 직접 URL을 검증했습니다. 메뉴 가시성 검사가 `semesterId`와 `source`를 알 수 없는 메뉴 tab으로 오인해 Dashboard로 보내던 결함을 고쳤습니다. 두 값은 `/student/points`의 route context로만 허용하며, 숨긴 메뉴와 알 수 없는 tab 차단은 유지합니다.

## 12. Previous Bundle Retirement

기존 wallet, transaction, rank total, product, order, policy writer는 `CLIENT_UPDATE_REQUIRED`로 닫았습니다. 다음 callable도 이전 point 경로를 더 이상 쓰지 않습니다.

- `ensureWisHallOfFame`
- `saveWisHallOfFameConfig`
- `refreshWisHallOfFameOnSchedule`
- `rebuildPointWalletRankTotals`
- `applyPointActivityReward`
- `createPointPurchaseRequest`
- `adjustTeacherPoints`
- `updateTeacherPointAdjustment`
- `reviewTeacherPointOrder`

Firestore Rules와 Storage Rules는 canonical W7 경로와 legacy point 상품·정책·전당 자료의 client write를 막습니다. 이전 bundle이나 직접 SDK로 Ledger, balance, inventory, order를 우회 변경할 수 없습니다.

## 13. Student UI

기존 canonical route `/student/points`를 유지했습니다. 학생은 다음 화면을 하나의 responsive mount로 사용합니다.

- 내 잔액과 최근 Ledger
- 상품과 재고
- 내 주문 상태
- 학기 순위
- CURRENT / ARCHIVE / LEGACY provenance

현재 학기 주문 뒤 잔액이 500에서 400으로 바뀌고, 상품 재고가 10에서 9로 줄어든 것을 확인했습니다. 보관 학기는 777 위스와 원본 Ledger를 읽기 전용으로 표시했고 신청 버튼은 0개였습니다.

## 14. Teacher UI

기존 canonical route `/teacher/points`를 유지했습니다. 교사 화면은 운영 현황, 학생 계정, 상품·재고, 주문 처리로 나뉩니다.

계정 목록과 상세는 master-detail 구조이며, 잔액 지급·회수·증감 정정·최근 entry 되돌리기·원장 대조를 명시적 버튼으로 제공합니다. 주문 표는 키보드로 진입할 수 있는 이름 있는 region이며, 좁은 화면에서는 표 안에서만 가로 스크롤합니다.

## 15. W3 Readiness

필수 `wis_economy_readiness`를 추가했습니다. W7 완료 후 W3 readiness는 required 17개, optional advisory를 포함해 총 18개입니다.

W7 check는 다음을 검사합니다.

- Economy schema/policy와 lifecycle
- Account initial grant 누락 0
- Account·Balance·Ranking 값 일치
- Ledger 합계와 Account balance 일치
- 중복 active source reference 0
- inventory 수량 보존
- order status 유효성
- blocking Legacy issue 0

해당 학기에 WIS 자료가 전혀 없으면 NOT_APPLICABLE 근거와 함께 PASS합니다. 일부만 생성된 상태나 projection 불일치는 FAIL입니다.

## 16. Rules / Query Purity

최종 direct boundary는 approved group 160개, query callable factory 10개, fetch GET 2개, command inventory 28개, UNKNOWN 0입니다. W7 소유 화면의 direct Firestore·Storage read/write, mount/listener/timer 기반 implicit write는 모두 0입니다.

Rules 검증은 canonical 10개 collection, legacy writer, Archive mutation, receipt/audit 직접 접근을 차단합니다. 학생은 Functions projection만 소비하고, 교사도 canonical 문서를 직접 수정하지 않습니다.

## 17. Responsive / Accessibility

학생과 교사 대표 WIS 화면을 정확한 다섯 viewport에서 확인했습니다.

| Viewport   | 학생 page overflow | 교사 page overflow | 주요 action |
| ---------- | -----------------: | -----------------: | ----------- |
| 390 × 844  |                  0 |                  0 | PASS        |
| 768 × 1024 |                  0 |                  0 | PASS        |
| 1024 × 768 |                  0 |                  0 | PASS        |
| 1280 × 800 |                  0 |                  0 | PASS        |
| 1600 × 900 |                  0 |                  0 | PASS        |

학생 탭과 구매 버튼, 교사 탭은 모두 45px 높이였습니다. 학생 구매 버튼은 모든 viewport에서 화면 폭 안에 있었고, 교사 주문 표는 `role=region`, accessible label, `tabIndex=0`을 유지했습니다.

학생·교사 WIS 화면에서 h1 1개, main 1개, skip link 존재, 중복 ID 0, 이름 없는 앱 버튼 0을 확인했습니다. 학생 WIS control의 label 누락은 0이었습니다. 교사 화면에서 잡힌 이름 없는 textarea 하나는 앱이 아니라 reCAPTCHA가 주입한 `g-recaptcha-response`였습니다. 상태와 provenance는 색상뿐 아니라 텍스트로도 표시합니다.

## 18. Dedicated Staging

- Firebase project: `westory-staging-177587430482`
- Firestore Rules·Storage Rules·W7 Functions: Staging에만 반영
- 최종 immutable Preview: `dpl_DmvPv6x1vmnpiHg7CejQjzgCp8qz`
- Preview URL: `https://westory-staging-cujv5a9bv-bbbs-projects-44f9da30.vercel.app`
- 안정 alias: `https://westory-staging-westoria28-8028-bbbs-projects-44f9da30.vercel.app`
- Vercel target: Preview

합성 학생·교사로 13개 command type을 실제 브라우저에서 모두 실행했습니다. 최종 fixture verify는 current balance 400, Ledger 6개, Order 1개, reconciliation 1개, command type 13개, receipt 14개, 2026-1 archive hash 불변을 확인했습니다.

정리 결과는 business 문서 14개, receipt/audit 28개, fixture 문서 12개, session 6개, Auth 2계정 삭제입니다. residual business document는 0입니다. App Check debug token, Vercel bypass token, 새 허용 domain은 만들지 않았습니다.

## 19. Regression

최종 W7 aggregate는 다음 항목을 포함합니다.

- W2~W6B command safety와 emulator regression
- W7 Functions unit 23 cases
- W7 integration 24 cases
- W7 Rules, Storage, query purity
- retry, concurrent duplicate, response loss, stale CAS, role/capability
- initial grant exact amount, negative balance, duplicate source
- order debit·approve·reject/refund·fulfill
- Archive/Legacy, readiness, previous bundle deny
- build, TypeScript baseline, format

통합 실행 1회에서는 Firebase CLI 종료 뒤 W6B Firestore Java 자식이 남았습니다. 정확한 demo project command line을 확인해 해당 프로세스만 정리한 뒤 W6B와 W7 emulator suite를 각각 새 수명으로 재실행했고, 모두 exit 0으로 통과했습니다. 최종 확인에서 5001, 8080, 9099, 9150, 9199 포트는 모두 비어 있었습니다.

## 20. TypeScript

기존 기준선 63 errors / 13 files를 유지했습니다. fingerprint는 `f431d08138d4a36bf84a0f3ebadb9a315baf1940461a222ec4e28f20cc196477`이며 W7 신규 파일 오류는 0입니다.

## 21. Production Safety

Production Firestore, Storage, Auth, Rules, Functions, Vercel, alias, 환경변수, active semester, 위스 자료, GitHub Pages 변경은 모두 0입니다. W7에서는 Production을 다시 조회하지 않았습니다.

마지막으로 승인된 W6B 확인값인 Production Maintenance `enabled=true`, `revision=3`은 그대로이며, 설정이나 학생 차단 상태를 변경하지 않았습니다.

## 22. Release Blockers

- `KI-W1-01 — RELEASE BLOCKER`: 교사 고위험 재인증 직후 maintenance/profile preflight가 실패하는 기존 현상을 Staging에서 한 번 재현했습니다.
- 지시대로 장시간 재디버깅하지 않았고 새 로그인 recent-auth 경로로 W7 검증을 마쳤습니다.
- 일반 login, session, 13개 W7 command, 학생 order, query 흐름의 악화는 확인되지 않았습니다.
- W7 CURRENT-WAVE blocker는 0개입니다.

## 23. W8 Handoff

W8의 학습·출석·일정·알림은 W7 Ledger를 직접 쓰면 안 됩니다. 보상이 필요하면 W8 source의 불변 ID와 policy version을 명시한 새 gateway adapter를 사용하고, 같은 source는 exactly-once로 한 번만 반영해야 합니다. 화면 mount, 출석 목록 조회, 알림 발송 성공 여부를 보상 transaction과 섞지 않습니다.

상세 계약은 `docs/handoff/w8-learning-schedule-communication-handoff.md`에 정리했습니다.

## 24. Future Wis Investment

이자, 투자, 수익률, 시장 가격, portfolio는 W7 범위에 넣지 않았습니다. 실제 돈이나 사행성 보상으로 오해되지 않는 교육용 확장 계약, 별도 Ledger와 valuation, archive 정책이 먼저 필요합니다.

상세 제약은 `docs/handoff/future-wis-investment-extension.md`에 정리했습니다.

## 25. Rollback

1. 안정 Staging alias를 이전 W6B Preview로 돌리면 client를 복구할 수 있습니다.
2. Staging Functions·Rules는 W6B SHA의 artifact로 Staging 프로젝트에만 되돌립니다.
3. canonical W7 Ledger는 rollback 중에도 수정·삭제하지 않고 audit 근거로 보존합니다.
4. previous bundle write deny는 유지합니다. Rules만 되돌려 legacy direct write를 다시 열면 안 됩니다.
5. Production은 변경하지 않았으므로 Production rollback은 없습니다.

## 26. Final W8 Readiness

W7 완료 조건을 충족했습니다.

`READY FOR W8 LEARNING / SCHEDULE / ATTENDANCE / COMMUNICATION STAGING DEVELOPMENT`

W8은 학습, 일정, 출석, 알림과 W7의 명시적 source reference만 연결해야 합니다. W7 Ledger를 화면 편의를 위한 mutable balance 저장소로 되돌리거나 투자 기능까지 함께 시작하면 안 됩니다.
