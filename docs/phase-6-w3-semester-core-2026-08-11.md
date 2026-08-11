# PHASE 6 — W3 Semester Manifest, Readiness Gate & Atomic Activation

- 기준일: 2026-08-11 KST
- 작업 브랜치: `codex/phase6-w3-semester-core`
- 시작 SHA: `240ac56beeef95a2bbada9eb7811fcf40bea46b5`
- 대상 환경: Dedicated Staging `westory-staging-177587430482`
- Production 변경: 0

## 1. Executive Summary

W3는 `availableSemesters[].shellReady`와 `site_settings/config.year/semester`에 과도하게 의존하던 학기 전환을 서버 권위 Semester Manifest, versioned readiness report, 상태 기계와 원자 활성화 command로 교체합니다. 학기 생성·Manifest 수정·검증·상태 전환·활성화는 W2 Command Gateway의 application session, capability, idempotency receipt와 audit 경계를 사용합니다. 관리자 화면의 단순 조회·새로고침·listener는 persistent write를 만들지 않으며 client 직접 pointer/status/readiness 변경은 Rules에서 거부합니다.

## 2. Baseline

| 항목 | 기준 |
| --- | --- |
| W2B branch / SHA | `codex/phase6-w2b-command-rollout` / `240ac56beeef95a2bbada9eb7811fcf40bea46b5` |
| W3 branch | `codex/phase6-w3-semester-core` |
| 시작 origin/main 대비 | ahead 0 / behind 33 |
| TypeScript baseline | 63 errors / 13 files |
| Dedicated Staging | `westory-staging-177587430482` |
| Production Firebase | `history-quiz-yongsin` — read-only baseline 확인만 허용 |
| known issue | `KI-W1-01` — `RELEASE BLOCKER — NOT A W3 DEVELOPMENT BLOCKER` |

시작 시 사용자 기존 변경인 `AGENTS.md`, `DESIGN.md`, `UI_RULES.md`, W1 evidence, phase 1~5 문서, `scripts/run-w1r4-viewports.ps1`, `tmp/`를 확인했습니다. W3 stage·commit 대상에서 제외하며 `.env.local`과 credential 파일을 읽지 않습니다.

## 3. As-Is Semester Structure

기존 권위 값은 `site_settings/config.year`, `semester`와 `availableSemesters[]`입니다. `years/{year}/semesters/{semester}` 부모 문서는 없거나 일부 환경에서만 별도 `state`를 가지며, client의 `loadSemesterReadiness`는 하위 collection과 `shellReady` seed를 조합해 advisory 상태만 계산합니다. SettingsGeneral은 registry item이 있으면 seed completeness를 확인하지 않고 조기 반환했고, readiness가 danger여도 config pointer 저장을 막지 않았습니다.

Dedicated Staging 조사 시 config는 2026/2를 가리켰지만 canonical manifest, readiness report, active pointer는 모두 0건이었습니다. 2026/2 scope는 일부 collection만 있어 기존 client 계산상 danger였습니다. PHASE 2 Production 조사에서 확인된 2027/2는 registry `shellReady:true`와 `point_policies/current` 1개만 있는 partial shell입니다. 이 구조가 준비 완료로 오인된 원인은 registry flag, readiness 비원자성, pointer 저장과 hard gate 부재입니다.

## 4. Semester Manifest

권위 경로는 `semester_manifests/{semesterId}`이며 ID는 서버가 `${schoolYear}-${term}`으로 결정합니다.

| 필드 | 계약 |
| --- | --- |
| identity | `semesterId`, `schoolYear`, `term`, `displayName` |
| lifecycle | `status`, `provenance` |
| boundary | 저장 필드 `startAt`, `endAt`; command payload `startDate`, `endDate` |
| version | `schemaVersion:1`, 양의 정수 `revision`, `readinessPolicyVersion:'w3-v1'` |
| audit | created/updated/activated/closed actor와 server timestamp |

동일 schoolYear+term 중복, 잘못된 날짜, 지원하지 않는 schema/policy를 transaction 전에 거부합니다. 정상 create는 Manifest와 필수 seed 6개를 같은 transaction에서 생성하며 개인정보나 학생 roster를 포함하지 않습니다.

## 5. State Machine

주 흐름은 `DRAFT → PREPARING → VALIDATING → READY → ACTIVE → CLOSING → CLOSED → ARCHIVED`입니다. 검증 실패와 출처 불명은 `FAILED`, `QUARANTINED`로 분리합니다. `VALIDATING → PREPARING`, `READY → PREPARING|VALIDATING`, `FAILED → PREPARING|QUARANTINED`, `CLOSING → ACTIVE`의 제한된 되돌림만 허용합니다.

`DRAFT|PREPARING|VALIDATING|CLOSED|ARCHIVED → ACTIVE` 직접 전환, ACTIVE의 준비 상태 복귀, ARCHIVED 재활성화, client 직접 status 변경은 거부합니다. transition table은 서버 한 곳에서 관리하며 모든 전환은 reason, expected revision, actor, receipt와 audit을 가집니다.

## 6. Readiness Policy / Registry

정책 `w3-v1`은 필수 check 11개와 비차단 WARNING 1개를 실행합니다.

1. Manifest schema
2. schoolYear/term identity unique
3. start/end date range
4. required semester settings
5. valid status transition
6. supported schema version
7. supported readiness policy version
8. active semester conflict
9. manifest/readiness revision freshness
10. unresolved blocking issues
11. trusted shell completeness

학기 duration advisory는 WARNING이어도 활성화를 막지 않습니다. 후속 Archive/Enrollment, Assessment, Grade, Wis, Schedule/Attendance check는 registry 확장 지점과 owner Wave만 고정하고 W3에서 가짜 PASS를 만들지 않습니다.

latest report는 `semester_readiness_reports/{semesterId}`, immutable evidence는 `/versions/{reportId}`에 기록합니다. report에는 policy/revision, required pass count, warning count, check detail, 평가 actor와 server timestamp를 둡니다.

## 7. Stale Readiness Protection

`updateSemesterManifest`는 expected revision CAS로 display name과 날짜를 바꾸고 revision을 1 증가시킵니다. 기존 latest report는 stale로 표시되고 `READY`, `VALIDATING`, `FAILED` candidate는 `PREPARING`으로 내려갑니다. `transitionSemesterStatus`와 `activateSemester`는 report의 `stale`, evaluated revision, policy version을 현재 Manifest와 다시 비교합니다. 따라서 과거 PASS를 재사용할 수 없고 변경 후 validation을 다시 실행해야 합니다.

## 8. Atomic Activation

`activateSemester` payload는 command ID/hash 외에 target semesterId, expected revision, `w3-v1`, expected active semesterId를 포함합니다. transaction은 target READY, latest report PASS·freshness, required 11/11, provenance, current pointer와 기존 ACTIVE 상태를 확인합니다.

기존 ACTIVE는 같은 transaction에서 CLOSED로 전환하고, target은 ACTIVE와 CURRENT provenance로 바꾸며, `site_settings/semester_active`와 legacy config의 year/semester/active ID/revision을 함께 갱신합니다. receipt와 audit도 같은 commit에 포함합니다. 실패하면 기존 ACTIVE와 pointer는 유지됩니다. 같은 ID replay, response loss, 서로 다른 target 동시 활성화는 W2 receipt와 Firestore transaction retry가 effect 1회와 ACTIVE 정확히 1개를 보장합니다.

## 9. Active Semester Resolver

client resolver는 ACTIVE·CLOSING, PREPARING, 명시적 semesterId를 구분하고 `SEMESTER_NOT_FOUND`, `NO_ACTIVE_SEMESTER`, `CONFLICTING_ACTIVE_SEMESTER`를 결과로 반환합니다. CLOSING 학기는 pointer와 revision이 일치하는 동안 현재 운영 범위로 해석합니다. pointer 누락·고아 pointer·revision 불일치는 모두 conflict로 닫습니다. server query callable `getSemesterCoreState`는 같은 canonical path와 latest report·필수 seed를 한 read-only transaction에서 읽고 policy, revision, stale, dependency hash까지 다시 확인합니다.

기존 `getYearSemester(config)` 사용처는 한 번에 바꾸지 않습니다. activation이 legacy config pointer를 원자적으로 맞춰 호환성을 유지하고, 각 domain은 담당 Wave에서 명시적 resolver로 교체합니다.

## 10. Provenance Model

- `CURRENT`: ACTIVE와 canonical pointer가 일치하는 학기
- `PREPARING`: DRAFT/PREPARING/VALIDATING/READY/FAILED
- `ARCHIVE`: CLOSED/ARCHIVED
- `LEGACY`: 새 Manifest 이전 또는 귀속 불명·격리 데이터

관리자 화면은 semesterId, provenance, status, revision을 함께 표시합니다. Archive adapter, 과거 데이터 이동과 불변 Rules 전면 적용은 W4 책임입니다.

## 11. Partial Shell Verification

Dedicated Staging/demo에서만 허용되는 `PARTIAL_SHELL` fixture는 일부 seed를 의도적으로 누락합니다. Production project에서는 fixture payload를 business write 전에 거부합니다. Dedicated Staging의 `2027-2` fixture는 PREPARING, seed 1/6으로 만들었고 나머지 5개 seed가 없음을 read-only 재검증했습니다. emulator의 실제 command에서는 required settings와 trusted shell check가 FAIL하고 VALIDATING→READY 및 activate 요청이 모두 거부됐습니다. Production의 실제 2027/2 데이터는 읽기 외 변경하지 않았습니다.

## 12. Rules / Direct Write Boundary

client는 다음 경로를 직접 create/update/delete할 수 없습니다.

- `site_settings/config`
- `site_settings/semester_active`
- `semester_manifests/*`
- `semester_readiness_reports/*`
- `semester_readiness_reports/*/versions/*`

SettingsGeneral의 seed·registry·pointer direct writes와 W12 임시 allowlist를 제거하고 D01/D02를 W3 Gateway 완료로 변경합니다. 관리자 화면 mount, refresh, readiness 목록과 active resolver는 read/callable query만 실행합니다.

## 13. Admin UI

기존 설정 화면을 전체 재디자인하지 않고 Semester Core panel을 추가했습니다. active/preparing 학기, semesterId, provenance, state, revision, policy, required check 결과와 마지막 검증 시각을 표시합니다. 생성, 준비 시작, readiness 검증, READY 전환, 활성화와 실패 보완 동작만 노출합니다. 종료·archive UI는 W4의 전체 write fence가 마련되기 전까지 제공하지 않습니다. 버튼 비활성화는 보조 UX이며 서버가 최종 차단과 구체적 오류 사유를 담당합니다. 로컬 보고서만으로 활성화 가능 상태를 단정하지 않고, `getSemesterCoreState`가 dependency hash까지 현재라고 판정한 경우에만 READY·활성화 버튼을 켭니다.

대표 viewport는 390, 1024, 1600px에서 가로 overflow, 상태·오류 가시성과 control 접근성을 확인합니다.

## 14. Tests

최종 검증 결과는 다음과 같습니다.

| 검증 | 결과 |
| --- | --- |
| Functions unit | 53/53 PASS |
| W2 Rules / integration 회귀 | 10 / 19 PASS |
| W3 Rules / integration | 7 / 17 PASS |
| W3 readiness | 정상 11/11 PASS, WARNING 비차단, FAIL·PENDING·stale·policy mismatch 차단 |
| Command Gateway | replay, payload conflict, response loss, 동시 요청 effect 1회, commit failure 원상 보존 PASS |
| Resolver | CLOSING, pointer conflict, revision conflict, dependency hash freshness, query write 0 PASS |
| 직접 쓰기 경계 | 명령 inventory 28, allowlist 159, `UNKNOWN=0` |
| Query purity | W3 문서 28건의 화면 진입·새로고침 전후 updateTime hash 동일 |
| TypeScript ratchet | 63 errors / 13 files, 신규 오류 0 |
| build / format | 425 modules build PASS, Prettier PASS |
| W1R2 session regression | PASS, `productionAccess=0` |
| GitHub Safety Baseline | run `31459691592` PASS, 구현 SHA `333031043da23d051ba61f762a948ecb851ac6b6` |

전체 emulator 회귀는 W2와 W3 harness를 한 emulator 수명 안에서 실행해 연속 기동 포트 충돌을 제거했습니다. 종료 뒤 남은 Firestore Java child는 exact demo project 명령행을 확인하고 종료했으며 관련 포트가 모두 비었음을 확인했습니다. `KI-W1-01` 재디버깅은 수행하지 않았습니다.

## 15. Staging Verification

Dedicated Staging `westory-staging-177587430482`의 적용 결과는 다음과 같습니다.

| 대상 | 결과 |
| --- | --- |
| canonical bootstrap | `2026-2` ACTIVE, revision 1, Manifest=pointer=config 일치 |
| legacy seed evidence | 실제 3/6, 누락 3개 기록, 자동 수선 0 |
| partial fixture | `2027-2` PREPARING, seed 1/6, forbidden seed 5개 부재 |
| Functions | `executecommand-00004-jib`, `getcommandstatus-00004-juj`, `getsemestercorestate-00001-qiv`; Node.js 22, ACTIVE |
| 인증 없는 live 요청 | 세 callable 모두 HTTP 401, business write 0 |
| Firestore Rules | `f165a26e-f1cc-4174-9424-f66266c1d5d4`, local 정규화 hash 일치 |
| Vercel Preview | `dpl_EtNkpgLKTYziDGNt8Tnhsg1bqTmH`, READY, target preview |
| Preview URL | `https://westory-staging-86kq0l7ag-bbbs-projects-44f9da30.vercel.app` |

Preview 보호는 유지했습니다. 보호를 인식하는 Vercel CLI 요청은 HTTP 200이었습니다. 관리자 화면은 같은 배포 소스와 최신 Functions·Rules를 demo emulator에 연결한 합성 관리자 세션으로 390×844, 1024×768, 1600×900에서 확인했습니다. 세 viewport 모두 가로 overflow 0, Semester Core 표시, 서버 기준 11/11 표시가 PASS했습니다. 실제 관리자 credential을 읽거나 변경하지 않았으므로 authenticated live command mutation은 실행하지 않았고, 그 의미 검증은 격리 emulator E2E와 project-fenced Staging bootstrap으로 수행했습니다.

## 16. Production Safety

Production Firestore data, Storage, Auth, Rules, Functions, Vercel deployment·alias·env, GitHub Pages, active pointer와 2026-2 생성 변경은 모두 0입니다. 종료 전 읽기 전용 대조에서 Firebase Functions 43개와 W3 함수 0개, Rules `36de907e-9fbf-41eb-b084-95a1419bf097`, Vercel Production `dpl_7r2BkKz1STPv5j15xstj5GArai5V` READY, `westory.kr`·`www.westory.kr` alias 유지를 확인했습니다. main에는 push하지 않았습니다.

## 17. W4 Handoff

Archive/Legacy adapter, historical permission, immutable Rules, 2026-1 enrollment snapshot과 2026-2 Class/Enrollment 생성은 W4로 이관합니다. 상세 계약과 acceptance gate는 `docs/handoff/w4-archive-enrollment-semester-handoff.md`에 고정합니다.

## 18. Release Blockers

- `KI-W1-01 — Post-Reauthentication User Probe Permission Denied`: `RELEASE BLOCKER — NOT A W3 DEVELOPMENT BLOCKER`
- Production idle enforcement: 계속 비활성
- W3 CURRENT-WAVE blocker: 0

## 19. Rollback

1. W3 frontend, Functions, Rules를 W2B SHA 호환 세트로 되돌립니다.
2. 신규 Manifest, readiness, receipt와 audit은 삭제하지 않고 증거로 보존합니다.
3. activation 전 rollback은 candidate를 PREPARING/QUARANTINED로 두고 기존 pointer를 유지합니다.
4. activation commit이 성공했다면 blind pointer write를 하지 않고 감사 가능한 보상 activation 절차를 사용합니다.
5. Dedicated Staging Preview는 이전 W2B deployment로 되돌릴 수 있으며 Production alias에는 영향이 없습니다.

## 20. Final W4 Readiness

로컬·emulator·Dedicated Staging·GitHub Safety Baseline·Production 불변 대조를 모두 통과했습니다. W3 CURRENT-WAVE blocker는 0입니다. 다음 판정을 확정합니다.

`READY FOR W4 ARCHIVE / ENROLLMENT STAGING DEVELOPMENT`

이 판정은 W3 Semester Core의 Staging 개발 완료를 뜻합니다. Production 승격 준비 완료 판정은 아닙니다.
