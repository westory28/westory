# W12 Release Candidate QA 인수인계

작성일: 2026-08-12

## 1. W11 기준

- 기준 branch: `codex/phase6-w11-semester-cutover-preparation`
- Cutover 대상: `2026-1` → `2026-2`
- Dedicated Staging 리허설: `2098-1` → `2098-2`
- Cutover Manifest: `docs/manifests/2026-2-cutover-manifest.json`
- Production Cutover Runbook: `docs/runbooks/2026-2-production-cutover.md`
- Rollback Runbook: `docs/runbooks/2026-2-production-rollback.md`
- Production 접근·변경: 0

W11은 Production 전환 권한을 만들지 않았습니다. W12는 아래 Release Gate를 해결하고 Release Candidate를 전수 검증하되, 실제 Production Cutover와 학생 Maintenance 해제는 별도 사용자 승인 뒤에만 진행합니다.

## 2. Cutover 계약

W11 Command Gateway는 `plan`, `dry-run`, `apply`, `verify`, `resume`, `rollback-plan` 여섯 명령을 제공합니다. source는 read-only이고 target 변경은 Manifest의 operation과 연결된 기존 Domain command만 수행합니다. plan·attempt·item·evidence는 결정적 ID, revision CAS, receipt, audit로 연결됩니다. Production 프로젝트에서는 credential·session 조회 전에 fail-closed합니다.

Selective Clone은 12개 dataset이며, copy denylist는 31개입니다. Attempt, 답안, 공식 성적, 출석, Learning progress, 공지 읽음, Draft·Bulk, Wis ledger·balance·ranking·order, receipt·audit·session·fixture는 target에 복제하지 않습니다.

## 3. Shadow 결과와 Expected Diff

Dedicated Staging에서는 owner와 `testRunId`가 붙은 합성 학기만 사용합니다. canonical `2026-2`와 전역 active pointer·settings는 실행 전후 hash가 같아야 합니다. 같은 Manifest를 두 번 실행할 때 두 번째 실행은 같은 command receipt를 복구하고 business effect를 추가하지 않습니다. 부분 실패는 실패 항목만 같은 child command ID로 resume합니다.

Expected Diff는 새 target Manifest·seed, Class·Enrollment, 승인된 master, 0원 Wis 초기 구조와 control evidence만 허용합니다. Auth·Storage·Maintenance·active pointer, canonical `2026-2`, source Archive, 과거 성적·출석·Wis 거래 변경은 모두 0입니다. 실제 Staging 수치와 hash는 `docs/evidence/w11-cutover/`의 최종 실행 폴더를 기준으로 확인합니다.

## 4. Readiness와 Rollback

W11은 `semester_cutover_readiness`를 required check로 등록했습니다. 일반 PREPARING 학기는 VERIFIED plan·attempt·evidence와 최신 dependency hash가 없으면 READY가 될 수 없습니다. source Archive는 FROZEN, write fence 유효, blocker 0이어야 합니다. stale evidence, revision mismatch, policy mismatch, activity copy가 발견되면 HOLD입니다.

Rollback 리허설은 source를 되돌려 쓰지 않습니다. FAILED·PENDING item resume, target quarantine, target-only 보상 순서, previous pointer의 원자적 복구 계획을 분리했습니다. 실제 pointer 변경과 activation은 W11에서 수행하지 않았습니다.

## 5. W12 필수 Release Gate

### KI-W1-01

다섯 viewport(390×844, 768×1024, 1024×768, 1280×800, 1600×900)에서 다음을 모두 확인해야 합니다.

- 재인증 성공과 새 `auth_time`
- application session ACTIVE
- `users/{uid}` probe 성공
- 보호 listener 재연결
- return path 유지
- 같은 command exactly-once
- permission-denied 0
- Same User Multi-Context
- direct SDK·previous bundle 차단

KI-W1-01은 W11 READY와 별개로 Production 승격 전 반드시 해소해야 합니다.

### Gateway migration

DIC01·DIC02·PATCH01은 현재 기능을 유지하지만 Production 전 W12에서 receipt·idempotency가 있는 Gateway로 이전해야 합니다. 관련 direct-write allowlist 만료와 이전 bundle 차단을 함께 확인합니다.

### Release Decision

- EX06 성적 XLSX 공식 저장: 공식 Grade import command와 ALL_OR_NOTHING 또는 ITEMIZED_PARTIAL 정책 승인 전 비활성
- MAP01 지도 asset: owner·checksum·TTL·promote·receipt·Archive fence 전 비활성
- MAP02 지도 taxonomy: canonical revision·CAS·provenance 계약 전 비활성
- 2026-2 시작·종료일, roster 원천, 실제 전환 시각: `BLOCKING_PRODUCTION_CUTOVER`

## 6. Storage availability

Storage는 `EXPLICITLY_UNAVAILABLE`입니다. 학생 핵심 학습·평가·성적 조회와 Cutover는 Storage mutation 없이 동작하므로 현재 W12 진입은 막지 않습니다. 지도·사료 등록은 `DOMAIN_DISABLED_BUT_SAFE`이며 UI와 Rules에서 계속 닫아 둡니다. 출시 범위에 포함하려면 완결된 private staging·promote·cleanup 계약이 필요합니다.

## 7. W12 전체 QA 범위

W10의 학생 canonical 17개, 교사 canonical 13개, alias 4개와 W11 `/teacher/settings/cutover`를 5개 viewport에서 검증합니다. 직접 URL, 새로고침, history, role 차단, CURRENT·PREPARING·ARCHIVE·LEGACY·EXPLICIT, Maintenance, 세션 만료, Not Found를 포함합니다.

최소 기준:

- horizontal overflow·Navigation overlap·Dialog escape 0
- axe critical·serious 0, keyboard 핵심 흐름 PASS
- mount·query·preview business write 0
- console error·unhandled rejection·permission-denied 0
- W10 bundle gate와 초기 WOFF2 gate 유지
- W2~W11 Functions·Rules·emulator aggregate PASS
- TypeScript 기존 63 errors / 13 files, W12 신규 오류 0

## 8. B1/R1/R2와 Promotion Gate

### B1/R1

- Firestore managed export와 collection count/hash
- Storage inventory/checksum
- Auth UID 비식별 inventory
- Rules·Functions·index·Vercel revision
- Git SHA·tag
- active pointer·config revision
- 2026-1 Archive integrity와 Domain count/join/hash
- 복원 가능성 실증

### Production Promotion Gate

W12 전체 QA, KI-W1-01, Release Decision, 실제 roster, 전환 시각, Expected Diff, backup restore 검증, writer quiescence가 모두 승인돼야 합니다. W11 명령의 project ID만 Production으로 바꿔 실행하지 않습니다. Production 전용 wrapper와 사용자 승인 ID가 별도로 필요합니다.

### 학생 Maintenance 해제 Gate

R2 snapshot, ACTIVE 정확히 1개, 교사·합성 학생 smoke, 5개 viewport, command exactly-once, permission-denied 0을 확인한 뒤 사용자에게 해제 승인을 받아야 합니다. 승인 전에는 `enabled=true`, revision `3` 상태를 변경하지 않습니다.

## 9. 사용자 승인 checkpoint

1. W12 Release Candidate 범위 승인
2. KI-W1-01 해소 결과 승인
3. 실제 roster·학기 경계일·전환 시각 승인
4. Production Expected Diff 승인
5. R1 backup·restore 검증 승인
6. Rules·Functions·frontend 배포 승인
7. 2026-1 Archive와 2026-2 selective clone 승인
8. activation 직전 GO 승인
9. R2 smoke 뒤 학생 Maintenance 해제 승인

어느 단계든 승인 자료가 없거나 diff가 설명되지 않으면 HOLD합니다.
