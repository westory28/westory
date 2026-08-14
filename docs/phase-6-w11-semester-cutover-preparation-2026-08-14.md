# PHASE 6 W11 학기 전환 준비 결과 보고서

작성일: 2026-08-14

작업 branch: `codex/phase6-w11-semester-cutover-preparation`

W10 정정 기준 commit: `3c4b4bbb52abdfcf604e0351722476fd822aa2eb`

W11 Staging 배포 기준 commit: `d0043ea3679bcf85c639d333e0a2f512077973f0`

W11 evidence run: `w11-20260814-7894ab5`

## 1. 최종 판정

`W11 STAGING IMPLEMENTATION VERIFIED — USER VISUAL ACCEPTANCE PENDING — UPSTREAM W10 GATE BLOCKED`

W11 학기 전환 준비 기능은 Dedicated Staging에서 구현·검증했습니다. 서버 계약, 관리자 조회 화면, 합성 리허설, 12개 데이터 작업, 부분 실패 복구, 검증, rollback 계획, fixture 정리와 Production 무변경 확인이 모두 통과했습니다.

다만 이 결과가 W10의 정정 판정을 바꾸지는 않습니다. 상위 gate는 여전히 다음과 같습니다.

`NOT READY FOR W11 SEMESTER CUTOVER PREPARATION STAGING DEVELOPMENT`

이번 작업은 이미 진행된 W11 구현을 폐기하지 않고 안전성과 재현성을 검증한 것입니다. 사용자의 최종 시각 승인은 아직 받지 않았으며, W11 완료나 W12 진행 가능 상태로 해석해서는 안 됩니다.

## 2. 기준과 작업 범위

- Dedicated Staging Firebase: `westory-staging-177587430482`
- 고정 Staging alias: `https://westory-staging-westoria28-8028-bbbs-projects-44f9da30.vercel.app`
- 검증 deployment: `dpl_GR6oaj6VvQAbXeyvrApCzS2FXmcD`
- immutable deployment: `westory-staging-hkyxmtk59-bbbs-projects-44f9da30.vercel.app`
- 합성 source: `2098-1`
- 합성 target: `2098-2`
- canonical baseline: `2026-2`

작업 범위는 학기 전환 계획, dry-run, 합성 적용 근거 정합화, 검증, 재개, rollback 계획과 관리자 조회 화면으로 한정했습니다. Production 활성 학기 전환, Maintenance 변경, 실제 학교 데이터 복제, Production 배포는 포함하지 않았습니다.

## 3. 구현 결과

### 서버와 권한

- W11 명령은 관리자 권한, App Check, 공식 session·authority summary, receipt·audit 일치를 함께 확인합니다.
- plan·attempt revision CAS와 최신 target marker fence를 적용했습니다.
- BLOCKED dry-run 재시도는 같은 결정론적 attempt를 사용하고 revision을 확인합니다.
- APPLY는 전체 attempt item의 존재와 범위를 먼저 확인한 뒤에만 상태를 승격합니다.
- VERIFY와 rollback은 최신 plan·attempt, target revision, 성공 영수증과 실제 target 문서를 다시 대조합니다.
- rollback은 성공한 작업만 역순으로 기록하며, Production을 바꾸는 실행 기능은 제공하지 않습니다.

### 관리자 화면

- route는 `/teacher/settings/cutover`입니다.
- source `ARCHIVE`, target `PREPARING`, 검증 근거 `EXPLICIT`을 한 화면에서 구분합니다.
- W11 화면에서는 Production 활성화와 Maintenance 제어를 제공하지 않습니다.
- stale revision, 진행 중 action, 허용되지 않은 단계에서는 고위험 버튼을 비활성화합니다.
- 모바일에서는 준비도와 차단 사유를 데이터 표보다 먼저 읽을 수 있게 배치하고, 긴 evidence ID가 페이지 폭을 넓히지 않도록 보정했습니다.
- 화면 mount와 query는 쓰기 없이 상태만 조회합니다.

## 4. Dedicated Staging 리허설

실제 Staging runner는 공식 관리자 권한과 run-scoped App Check debug token을 사용했습니다. token 값은 메모리에만 두고 실행 직후 삭제했으며 파일과 Git 증거에는 저장하지 않았습니다.

| 항목                    | 결과               |
| ----------------------- | ------------------ |
| rehearsal               | 2회 PASS           |
| phase 결과              | 12행 PASS          |
| attempt 결과            | 2행 PASS           |
| 데이터 작업             | 12종 PASS          |
| readiness               | fresh PASS         |
| 부분 실패 주입          | 1회 확인           |
| response loss 복구      | PASS               |
| resume 재처리 부작용    | 0                  |
| replay business effect  | 0                  |
| 최종 상태               | `ROLLBACK_PLANNED` |
| Production access/write | 0 / 0              |

리허설은 실제 학기를 활성화하거나 target을 Current로 바꾸지 않습니다. rollback도 보상 실행이 아니라 검토 가능한 계획과 근거를 기록하는 단계까지만 수행합니다.

## 5. 실제 관리자 브라우저 검증

고정 Staging alias에서 공식 Google 로그인으로 관리자 화면에 진입했습니다. 브라우저 인증에 custom token을 사용하지 않았습니다. query string, OAuth 값, credential과 token 값은 evidence와 보고서에 기록하지 않았습니다.

실제 화면에서 다음 항목을 확인했습니다.

- source `2098-1` / `ARCHIVE` / 읽기 전용
- target `2098-2` / `PREPARING`
- 검증 근거 `2098-2` / `EXPLICIT` / `PASS`
- plan·attempt `ROLLBACK_PLANNED`
- 12개 데이터 결과와 fresh readiness
- 활성화 control 0, Maintenance control 0
- mount·query·preview write 0, Production request 0

## 6. 반응형 PNG 증거

다음 다섯 화면을 DPR 1, `fullPage=false`로 캡처했습니다.

| viewport | PNG 실제 크기 | 가로 넘침 | Navigation 겹침 | Dialog 이탈 |
| -------- | ------------- | --------: | --------------: | ----------: |
| 390×844  | 390×844       |         0 |               0 |           0 |
| 768×1024 | 768×1024      |         0 |               0 |           0 |
| 1024×768 | 1024×768      |         0 |               0 |           0 |
| 1280×800 | 1280×800      |         0 |               0 |           0 |
| 1600×900 | 1600×900      |         0 |               0 |           0 |

각 파일은 PNG signature, IHDR, CRC, IDAT, IEND, 실제 픽셀 크기와 SHA-256을 독립 verifier로 확인했습니다. in-app browser가 raw image에서 제외한 scrollbar gutter는 화면 배경색으로만 채웠고, UI content pixel은 확대하거나 변형하지 않았습니다. 이 처리 내용과 raw content 크기는 screenshot manifest에 함께 기록했습니다.

접근성 증거는 보이는 interactive element의 이름, label, alt, 중복 ID, 문서 언어·제목과 keyboard focus-visible을 다섯 viewport에서 확인했습니다. evidence의 `axeCritical`·`axeSerious` 필드명은 공통 schema를 따르지만, 이번 값의 측정 근거는 in-app browser visible-DOM 검사입니다. 최종 수동 시각·접근성 승인은 사용자 확인 전까지 대기 상태입니다.

## 7. Evidence

증거 root는 `docs/evidence/w11-cutover/w11-20260814-7894ab5`입니다.

- metadata와 phase·attempt·dataset·readiness 결과
- preview·state·viewport·accessibility·network-write 결과
- screenshot manifest와 PNG 5개
- cleanup 결과

독립 verifier 결과:

- phase 12행
- attempt 2행
- dataset 12행
- readiness 1행
- browser state 3행
- viewport 5행
- screenshot 5행
- accessibility 5행
- residual 0
- Production access/write 0/0

## 8. Fixture·Token·임시 권한 정리

리허설 뒤 합성 Auth 사용자, fixture·business 문서, plan, attempt, item, evidence, receipt, audit, session, persisted token record와 Storage object를 모두 삭제했습니다.

| 항목                        | 결과 |
| --------------------------- | ---- |
| 잔여 Auth 사용자            | 0    |
| 잔여 fixture·business 문서  | 0    |
| 잔여 plan·attempt·item      | 0    |
| 잔여 receipt·audit·session  | 0    |
| 잔여 persisted token        | 0    |
| 잔여 Storage object         | 0    |
| canonical baseline mutation | 0    |
| Maintenance mutation        | 0    |

임시 `serviceAccountTokenCreator` 사용자 바인딩과 App Check minter 역할 바인딩은 0으로 확인했습니다. 임시 custom role은 삭제 상태이며, run-scoped App Check debug token도 0입니다. Vercel Authentication 보호 설정은 작업 전 값인 `prod_deployment_urls_and_all_previews`로 복구했습니다.

## 9. Production 무변경 확인

작업 시작과 종료 시점에 같은 Production 지문을 읽기 전용으로 비교했습니다.

| 항목              | 시작                                                          | 종료 | 변경 |
| ----------------- | ------------------------------------------------------------- | ---- | ---- |
| Functions         | 44/44 ACTIVE, hash `f3a19da8908e23384d49d3295b38839b48a8a3b3` | 동일 | 0    |
| Firestore ruleset | `84165f2f-9e64-4a6e-b6b5-c4cc40c80b42`                        | 동일 | 0    |
| Storage ruleset   | `2185308f-7a13-4804-bb04-88e7a4eb0eb8`                        | 동일 | 0    |
| Vercel Production | `dpl_9CYX35wz4S5M7adhPun6hiohEx1F`, READY                     | 동일 | 0    |

Production Auth 사용자는 PII 열거 없이 안전하게 집계할 수 있는 명령이 없어 수치로 조회하지 않았습니다. Production Auth를 변경하거나 사용자 목록을 출력하지 않았습니다.

## 10. 자동 검증

다음 검증이 통과했습니다.

- `npm run verify:w11-semester-cutover`
- `npm run verify:w11-emulator-suite`
- `npm --prefix functions run check`
- W11 domain unit 35 cases
- server·cutover·query-purity·staging-runner 계약
- W11 screenshot manifest와 actual evidence verifier
- `npm run build`
- TypeScript 기준선 63 errors / 13 files, W11 신규 오류 0
- W10 previous-wave bundle gate

정리 단계에서는 attempt item의 `receiptId`가 부모가 아닌 reconciled child command receipt를 가리키는 실제 서버 계약을 확인했습니다. cleanup verifier가 해당 child command ID를 결정론적으로 대조하도록 보정한 뒤, 실제 Staging cleanup과 잔여 0 검증을 통과했습니다.

## 11. 남은 조건

- 사용자가 다섯 viewport 화면을 직접 확인하고 시각적으로 승인해야 합니다.
- W10의 UI·UX 정정 gate는 해제되지 않았습니다.
- W10의 기존 release blocker와 사용자 결정 항목은 그대로 유지됩니다.
- W11을 완료로 선언하거나 W12 준비 완료로 승격하지 않습니다.

따라서 최종 판정은 다음 한 줄로 유지합니다.

`W11 STAGING IMPLEMENTATION VERIFIED — USER VISUAL ACCEPTANCE PENDING — UPSTREAM W10 GATE BLOCKED`
