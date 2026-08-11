# PHASE 6 — W2B Command Gateway Rollout & Query Purity Closure

- 기준일: 2026-08-11 KST
- 작업 브랜치: `codex/phase6-w2b-command-rollout`
- 시작 SHA: `f14f64b47aa6d8ba2d8bec935b3b7b4a289b1446`
- 대상 환경: Dedicated Staging `westory-staging-177587430482`
- Production: 읽기 전용 확인 외 변경 없음

## 1. Executive Summary

W2B는 남은 고위험 명령을 실제 책임 Wave로 분류하고, 후속 schema 재구축과 충돌하지 않는 3개 명령을 W2A Command Gateway로 이전했습니다. 조회 과정에서 발견된 암묵적 쓰기 3개를 제거했고, TypeScript AST와 호출 그래프를 이용한 client direct-write 경계 검사를 CI에 연결했습니다.

원본 inventory 28행은 `W2A_DONE 2`, `MIGRATE_NOW 3`, `DOMAIN_WAVE 21`, `TEMPORARY_ALLOWLIST 2`, `REMOVE_IMPLICIT_WRITE 0`, `UNKNOWN 0`입니다. C04/C05가 같은 서버 handler를 가리키므로 canonical 명령은 27개이고, W2A 이후 남은 canonical 명령은 25개입니다. 이 가운데 W2B 이전 3개, Domain Wave 이관 20개, 임시 allowlist 2개로 닫았습니다. W2A의 공휴일 동기화는 고위험 28개 inventory 밖에서 추가로 이전된 명령이라 `W2A_DONE 2` 집계와 모순되지 않습니다.

로컬 build·format·Functions·rules·unit·integration·W1R2 session regression과 Dedicated Staging Functions·Rules·Preview 검증을 통과했습니다. GitHub Safety Baseline run `31455620904`도 전 단계 PASS했습니다. Production 승격과 W3 작업은 수행하지 않습니다.

## 2. Baseline

| 항목 | 기준 |
| --- | --- |
| W1 frozen | `codex/phase6-w1-frozen-checkpoint` / `26142027dfc66335f8f7dc66f8007042a3836391` |
| W2A | `codex/phase6-w2a-command-gateway-foundation` / `f14f64b47aa6d8ba2d8bec935b3b7b4a289b1446` |
| W2B branch | `codex/phase6-w2b-command-rollout` |
| W2B 시작 시 origin/main 대비 | ahead 0 / behind 31 |
| W1 known issue | `KI-W1-01` — `RELEASE BLOCKER — NOT A W2B DEVELOPMENT BLOCKER` |

작업 시작 시 사용자 기존 변경인 `AGENTS.md`, `DESIGN.md`, `UI_RULES.md`, W1 evidence, phase 1~5 문서, `scripts/run-w1r4-viewports.ps1`, `tmp/`를 확인했습니다. 이 파일들은 W2B stage·commit 대상에서 제외합니다. `.env.local`과 credential 파일을 읽거나 stage하지 않았습니다.

## 3. Remaining Command Classification

분류의 기계 판정 기준은 `scripts/w2-high-risk-command-manifest.json`입니다.

| 분류 | 원본 28행 | canonical | 처리 |
| --- | ---: | ---: | --- |
| W2A_DONE | 2 | 2 | D08 이용약관, D10 동의 항목 추가 |
| MIGRATE_NOW | 3 | 3 | D11, D12, C13을 W2B Gateway로 이전 |
| DOMAIN_WAVE | 21 | 20 | C04/C05 동일 canonical handler, 후속 Wave 이관 |
| TEMPORARY_ALLOWLIST | 2 | 2 | D04 W5, C02 W8A 기한 고정 |
| REMOVE_IMPLICIT_WRITE | 0 | 0 | inventory command 중 해당 없음 |
| UNKNOWN | 0 | 0 | 미분류 없음 |

Query Purity 전수 점검에서 inventory 밖의 암묵적 쓰기 3개를 별도로 찾아 제거했습니다. 따라서 `REMOVE_IMPLICIT_WRITE 0`은 “남은 25개 command 분류”의 수치이고, 숨은 쓰기 제거 수치와는 별개입니다.

## 4. Commands Migrated in W2B

### D11 `updateConsentItem`

- 호출: `SettingsPrivacy`의 동의 항목 저장
- 경로: `site_settings/consent/items/{itemId}`, `site_settings/consent`
- 계약: strict payload, `expectedRevision` CAS, actor/session/recent-auth/admin fence
- 원자성: item revision과 consent root `updatedAt`을 receipt·audit와 한 transaction에 기록
- 충돌: stale revision은 business write 전에 `COMMAND_REVISION_CONFLICT`

### D12 `deleteConsentItem`

- 호출: `SettingsPrivacy`의 동의 항목 삭제
- 경로: 원본 item 삭제, `site_settings/consent/deleted_items/{itemId}` tombstone, consent root metadata
- 계약: `expectedRevision` CAS, 동일 command replay, 응답 유실 복구
- 원자성: item delete·tombstone·receipt·audit를 한 transaction에 기록

### C13 `adjustTeacherPoints`

- 호출: `ManagePoints` → `src/lib/points.ts` → Command Gateway
- 경로: 활성 학기 point wallet, ledger transaction, Hall of Fame dirty projection
- 권한: admin 또는 `point_manage`, active semester scope, recent/high-risk application session
- 결과: deterministic ledger ID와 `command:{commandId}` source, receipt·audit·wallet·ledger 원자성
- legacy callable: 인증·권한 검증 뒤 쓰기 없이 `CLIENT_UPDATE_REQUIRED`를 반환하는 retirement shim
- 수명: W7A canonical ledger 전환 전 containment adapter이며 W7A에서 제거

세 명령 모두 typed command registry, payload hash, canonical command ID, server timestamp, result, receipt, audit, status query를 사용합니다. client가 보낸 actor 정보는 신뢰하지 않습니다.

## 5. Commands Deferred by Domain

canonical Domain Wave 20개는 `docs/handoff/w3-w9-domain-command-migration-handoff.md`에 호출 위치, write 경로, 멱등성, 선행 schema, acceptance test, 임시 보호 수단과 함께 이관했습니다.

| Wave | command |
| --- | --- |
| W3 | D01 `createSemesterShell`, D02 `updateOperationalSettings` |
| W4A | C16 `deleteSourceArchiveAsset` |
| W4B | D03 `updateSchoolSettings`, D06 `updateAccessSettings`, C01 `deleteStudentData`, C03 `updateStudentData` |
| W5 | D05 `updateMenuSettings`, D09 `updatePrivacySettings` |
| W6A | C04/C05 `resetAssessmentAttemptsByClass`, C06 `recalculateQuizResultsAfterQuestionCorrection` |
| W6B | C10 `reviewPerformanceScoreObjection` |
| W7A | C12 `rebuildPointWalletRankTotals`, C14 `updateTeacherPointAdjustment`, C15 `reviewTeacherPointOrder` |
| W7B | C11 `saveWisHallOfFameConfig` |
| W8A | C07 `grantHistoryClassroomExemptions`, C08 `revokeHistoryClassroomExemptions`, C09 `reviewHistoryClassroomExemptionRequest` |
| W8B | D07 `updateNotificationSettings` |

Temporary allowlist는 다음 2개뿐입니다.

- D04 `updateInterfaceSettings`: owner `W5 Global Shell`, test owner `W5 settings contract`, expiry W5
- C02 `resetLessonCorePointProgress`: owner `W8A Learning`, test owner `W8A progress migration`, expiry W8A

## 6. Query Purity Findings

Architecture Invariant는 다음과 같이 고정했습니다.

> 페이지 진입, GET, LIST, LISTENER, REFRESH는 persistent mutation을 발생시키지 않는다.

AST/typechecker 기반 감사가 Firestore `setDoc/addDoc/updateDoc/deleteDoc/writeBatch/runTransaction`, Auth mutation, Storage mutation, callable, HTTP mutation을 추적합니다. import alias, transaction/batch method, cross-file wrapper hash, listener/effect/fetch/refresh trigger, 동적 callable을 구분합니다.

최종 실제 소스 결과는 approved boundary group 158, query callable factory 2, GET fetch 2, high-risk inventory 28, `UNKNOWN 0`, forbidden 0입니다. Dashboard와 Schedule mount 공휴일 쓰기는 W2A에서 이미 제거됐고 W2B guard가 다시 고정합니다.

## 7. Removed Implicit Writes

1. `NotificationBell`: 알림 패널을 여는 effect에서 자동으로 읽음 처리하던 쓰기를 제거했습니다. 읽음 처리는 사용자가 누르는 `모두 읽음` command에서만 발생합니다.
2. `DeveloperLog`: 단순 상세 조회 시 `viewCount`를 증가시키던 Firestore write와 localStorage dedupe를 제거했습니다.
3. `PerformanceScoreManager`: mount/load 과정의 누락 학생 점수 문서 자동 생성과 roster link repair transaction을 제거했습니다. 관련 dead persistent-write helper와 ref도 정리했습니다.

인증 session open/touch/close, 사용자가 실제 풀이 중 남기는 debounce autosave처럼 제품 의미상 command/lifecycle인 경로는 소유자·Wave·만료 조건을 가진 경계 항목으로 유지했습니다. 단순 조회 부산물로 실행되는 쓰기는 남기지 않았습니다.

## 8. Client Direct-Write Boundary

- guard: `scripts/verify-client-direct-write-boundary.mjs`
- fixture: `scripts/test-client-direct-write-boundary.mjs`
- allowlist: `scripts/client-direct-write-allowlist.json`
- inventory: `scripts/w2-high-risk-command-manifest.json`

allowlist key는 중복을 허용하지 않고 file/function/root/trigger/call-chain hash를 고정합니다. owner, introducedWave, expiry를 필수로 하며 stale entry, 만료 entry, source hash drift를 실패시킵니다. 동적 callable 또는 분석할 수 없는 write는 자동 허용하지 않고 `UNKNOWN`으로 실패합니다. server-side Functions write와 query callable은 client direct write에서 분리합니다.

fixture 11종이 Auth/Storage root, transaction/batch alias, cross-file wrapper, listener trigger, dynamic/finite callable, query callable, HTTP method, Gateway effect, allowlist duplicate/stale/expiry, 28-command count를 검증합니다.

## 9. CI Guard

새 명령은 다음과 같습니다.

- `npm run verify:w2b-command-safety`
- `npm run verify:w2b-command-gateway`

`Verify Safety Baseline`은 모든 push/PR에서 W2B safety guard를 먼저 실행하고, Functions와 emulator 구간을 Node.js 22에서 다시 실행합니다. `Deploy to GitHub Pages`도 main build 전에 W2B safety를 실행하고, artifact upload 전에 Node.js 22 Functions check와 전체 W2B aggregate를 통과해야 합니다. 따라서 direct main push도 W2B 검사를 우회해 Pages로 배포될 수 없습니다.

로컬 W2B aggregate는 PASS입니다. GitHub Safety Baseline run [`31455620904`](https://github.com/westory28/westory/actions/runs/31455620904)는 2분 21초 동안 앱 검증과 Node.js 22 Functions/emulator aggregate를 모두 실행해 PASS했습니다.

## 10. Command Client Contract

`src/lib/commandGateway.ts`가 6개 command의 typed payload/result registry를 제공합니다.

- command ID는 재인증과 dispatch 전에 cross-tab single-flight 안에서 먼저 생성·보존
- 사용자 요청 1회에는 새로고침·재시도 뒤에도 같은 ID 사용
- 상태: `pending`, `succeeded`, `failed`, `conflict`, `unauthorized`, `session-expired`, `retryable`
- server status: `RECEIVED`, `RUNNING`, `SUCCEEDED`, `FAILED`, `COMPENSATION_REQUIRED`, `NOT_FOUND`
- ambiguous network error는 `getCommandStatus`로 receipt/result를 복구
- localStorage v2 handle은 project, owner, command type/ID, client payload hash, 요청·상태 시각만 저장하고 raw payload는 저장하지 않음
- conflict·권한·세션 오류는 자동 재실행하지 않고 호출 화면에 구분된 오류로 전달

화면별 시간 기반 ID와 제각각인 재시도 로직은 제거했습니다.

## 11. Idempotency / Recovery Results

| suite | 결과 |
| --- | --- |
| Functions core | PASS, 27 cases |
| client boundary fixture | PASS, 11 checks |
| client boundary real source | PASS, 158 approved / UNKNOWN 0 |
| Firestore rules | PASS, 10 cases |
| emulator integration | PASS, 19 cases / Production access 0 |
| W2A query purity | PASS, 4 checks |
| W1R2 session regression | PASS, rules·Functions·Storage·E2E / Production access 0 |

검증 범위에는 동일 ID replay, 대소문자 command ID canonicalization, 다른 payload conflict, `Promise.all`/두 app context 동시 요청, commit 후 응답 유실, CAS stale revision, unauthorized/expired pre-business rejection, receipt·audit 전체 schema, consent tombstone, point wallet·ledger·HOF 정합성, commit failure partial write 0이 포함됩니다.

로컬 Functions emulator가 host Node.js 24를 사용한다는 경고가 있으나 CI와 실제 Staging Functions는 Node.js 22로 검증했습니다. Windows에서 종료 후 남은 Firestore Java child는 demo project ID와 포트를 확인한 뒤 해당 PID만 종료했고 8080/9099/5001/9199/9150/4400/4500 포트가 모두 비었음을 확인했습니다.

## 12. Functions Image Cleanup Policy

대상은 Staging `asia-northeast3`의 `gcf-artifacts` 표준 Docker repository입니다.

- W2B 배포 후 repository 실제 크기: 약 1,061 MB(약 1.04 GiB)
- 조회된 version: 13개, tagged 12개, untagged 1개
- 활성 W2B image: `adjust_teacher_points@sha256:49b2d9b1…`
- W2B current, W2A rollback, pre-W2A rollback, active shared image, open-session rollback, shared rollback에 보존 태그 6개 추가
- 정책: untagged이면서 30일 초과 시 delete, package별 최신 3개 keep
- 적용 상태: `cleanupPolicyDryRun: true`
- 즉시 삭제: 0
- Production repository 정책 변경·이미지 삭제: 0

Google Cloud 공식 가격은 billing account 전체 기준 0.5 GiB-month까지 무료이고 초과분은 약 USD 0.10/GiB-month입니다. 현재 크기만 놓고 보면 무료 구간을 다른 repository가 쓰지 않았을 때 약 USD 0.05/월, 무료 구간을 이미 모두 썼을 때 약 USD 0.10/월입니다. dry-run 결과와 rollback 기간을 관찰한 뒤에만 `--no-dry-run` 전환을 검토해야 합니다.

- 가격: <https://cloud.google.com/artifact-registry/pricing>
- cleanup policy: <https://docs.cloud.google.com/artifact-registry/docs/repositories/cleanup-policy>

## 13. Staging Verification

Dedicated Staging 배포 결과는 다음과 같습니다.

| 대상 | 결과 |
| --- | --- |
| `executeCommand` | Node.js 22, ACTIVE, Cloud Run revision `executecommand-00003-nav` |
| `getCommandStatus` | Node.js 22, ACTIVE, revision `getcommandstatus-00003-goh` |
| `adjustTeacherPoints` retirement shim | Node.js 22, ACTIVE, revision `adjustteacherpoints-00001-fir` |
| Firestore rules | ruleset `7a0717aa-41e2-4900-a7de-7bbf28196787`, 2026-08-11 03:04:53Z |
| Vercel Preview | `dpl_4G5ARfjeHgZRm89EiKL3w3TduVFP`, READY, target preview |
| Preview URL | `https://westory-staging-frd6ksoad-bbbs-projects-44f9da30.vercel.app` |

세 callable에 인증 없는 실제 Staging 요청을 보내 모두 HTTP 401 `UNAUTHENTICATED`로 business logic 전에 거부됨을 확인했습니다. 실제 관리자 비밀번호를 재설정하거나 저장된 credential을 읽지 않았으므로 authenticated live command mutation은 수행하지 않았고, 해당 의미 검증은 격리 emulator 19개 E2E와 Staging 배포 artifact/runtime 검증으로 수행했습니다.

Preview는 Vercel 보호를 유지한 채 자동화 bypass header로 열었습니다. 공개 로그인 셸은 390×844, 1024×768, 1600×900에서 제목·로그인 컨트롤·레이아웃을 확인했습니다. 1024/1600은 가로 overflow 0이며, 390의 `scrollWidth` 1px 차이는 실제 viewport 경계를 넘는 요소가 0개라 브라우저 반올림으로 판정했습니다. 인증 전 설정 read는 rules에 의해 permission-denied가 발생하지만 로그인 화면은 fallback으로 정상 표시됩니다.

검증 중 CLI debug가 기존 자동화 bypass 값을 한 줄 출력한 사건이 있었습니다. 즉시 새 bypass를 발급해 새 항목을 env-var 기본값으로 승격하고 노출된 이전 항목을 revoke했습니다. 현재 Staging Vercel project에는 active automation bypass가 1개만 남았고, 새 값은 출력·파일 저장하지 않았습니다. 새 bypass 적용 뒤 Preview도 다시 배포했습니다.

## 14. Production Safety

Production에는 쓰기 요청을 보내지 않았습니다. 최종 읽기 전용 비교 결과는 다음과 같습니다.

- Firebase project `history-quiz-yongsin`
- Functions 43개 유지, `executeCommand`/`getCommandStatus` 없음
- Firestore ruleset `36de907e-9fbf-41eb-b084-95a1419bf097` 유지
- Vercel Production deployment `dpl_7r2BkKz1STPv5j15xstj5GArai5V` / READY 유지
- Production Firestore data, Storage, Auth, Rules, Functions, Vercel alias·환경변수, GitHub Pages 변경 0
- main push 0

Staging의 Artifact Registry 태그·dry-run policy와 Vercel automation bypass 회전은 Dedicated Staging project에만 적용했습니다.

## 15. Remaining Release Blockers

W2B CURRENT-WAVE blocker는 0개입니다. GitHub Safety Baseline branch run까지 통과했습니다.

`KI-W1-01`은 그대로 `RELEASE BLOCKER — NOT A W2B DEVELOPMENT BLOCKER`입니다. 재인증 probe 재설계, W1-R6, viewport 재인증 반복, Production idle enforcement 활성화는 수행하지 않았습니다. 기존 W1R2 session regression이 PASS하여 W2B로 인한 기본 세션 회귀는 발견되지 않았지만, 이 결과로 `KI-W1-01`을 닫지 않습니다.

의존성 audit의 기존 취약점 표시, Firebase Functions SDK outdated 경고, Vite large chunk 경고, Preview auth-domain 경고는 W2B에서 새로 생긴 command/query 무결성 blocker가 아니며 해당 소유 Wave 또는 release hardening에서 다룹니다.

## 16. Rollback

1. W2B commit을 revert하고 W2A SHA에서 앱·Functions·rules를 함께 재배포합니다.
2. `executeCommand`/`getCommandStatus`는 보존 태그 `w2a-rollback-20260811` image와 W2A source를 기준으로 복구합니다.
3. shared session/current·rollback image에는 별도 보존 태그가 있어 dry-run cleanup 대상이 아닙니다.
4. Firestore rules는 W2A `firestore.rules`를 Dedicated Staging에 재배포합니다.
5. consent tombstone과 command receipt/audit는 삭제하지 않습니다. rollback 후에도 증거로 보존하고 W2B 재적용 때 replay 판단에 사용합니다.
6. point adapter rollback은 client·gateway·retirement shim을 같은 배포 단위로 되돌립니다. legacy callable만 단독 활성화하지 않습니다.
7. cleanup policy는 현재 dry-run이라 rollback 과정에서 자동 image 삭제가 발생하지 않습니다.

## 17. Final W3 Readiness

로컬, emulator, Dedicated Staging, GitHub Safety Baseline 조건을 모두 충족했습니다. `UNKNOWN 0`, W2B Gateway 3개, Domain Wave 20개, temporary allowlist 2개, query-side implicit write 제거 3개, direct-write CI guard PASS, TypeScript 신규 오류 0, Production 변경 0입니다.

최종 판정은 다음과 같습니다.

`READY FOR W3 SEMESTER CORE STAGING DEVELOPMENT`

이는 W2 Query/Command 기반 작업의 종료 판정이며 Production 승격 준비 완료를 뜻하지 않습니다. `KI-W1-01`은 Release Candidate 단계의 별도 blocker로 남습니다.
