# PHASE 6 — W4 Archive, Legacy Adapter, Student Identity & Enrollment

## 1. Executive Summary

W4는 학생의 영구 identity와 학기별 소속을 분리하고, 학급·학적·명단·아카이브를 W2 Command Gateway와 W3 Semester Core 위에 연결했습니다. `CURRENT / PREPARING / ARCHIVE / LEGACY / EXPLICIT` 출처를 명시하지 않은 레거시 대체 조회는 허용하지 않습니다. W4가 소유하는 모든 canonical 경로의 client 직접 쓰기는 Rules에서 차단했습니다.

Dedicated Staging `westory-staging-177587430482`에는 W4 관련 Functions 5개와 Firestore Rules, 보호된 Vercel Preview를 반영했습니다. 임시 합성 명단 3명은 live shadow dry run 뒤 전부 회수했으며 Production 변경은 0입니다.

최종 판정은 `READY FOR W5 GLOBAL SHELL / COMMON UI STAGING DEVELOPMENT`입니다. 이는 Staging 기반 완료 판정이며 Production migration·출시 승인과는 무관합니다.

## 2. Baseline

| 항목                     | 기준                                                                  |
| ------------------------ | --------------------------------------------------------------------- |
| 시작 SHA                 | `6de8f76a124dd809b64cdaf39562333cc8aefcba`                            |
| W4 branch                | `codex/phase6-w4-archive-enrollment`                                  |
| 시작 origin/main 대비    | ahead 0 / behind 35                                                   |
| 사전 tracked 사용자 변경 | `AGENTS.md`, `DESIGN.md`, `UI_RULES.md`                               |
| 사전 untracked 보존      | Phase 1~5 문서, W1 evidence, `scripts/run-w1r4-viewports.ps1`, `tmp/` |
| 보호 파일                | ignored `.env.local`은 내용 확인·stage 대상에서 제외                  |

W4 커밋은 allowlist로만 구성합니다. 사용자 문서, W1 evidence, 임시 파일을 섞지 않습니다.

## 3. Parallel Maintenance Hotfix Status

`C:\westory-maintenance-hotfix`의 `hotfix/student-maintenance-gate`는 SHA `6120f08c07f92a1b3939d34a416fb36726576d78`, origin/main 대비 ahead 2이며 working tree는 clean입니다. W4는 이 worktree를 수정·checkout·merge하지 않았습니다.

겹칠 수 있는 파일은 `firestore.rules`, `functions/index.js`, `functions/package.json`, root `package.json`입니다. 핫픽스의 `src/App.tsx`, `src/contexts/AuthContext.tsx`, `src/lib/firebase.ts`, 로그인·점검 화면은 W4에서 손대지 않았습니다. 두 브랜치는 W4 이후 별도 통합과 전체 Rules/Functions 회귀가 필요합니다.

## 4. As-Is Student / Class Structure

기존 구조는 `users/{uid}`에 학생 이름과 학년·반·번호가 함께 있어 영구 계정 정보와 현재 소속이 결합돼 있습니다. 교사 학생 목록과 여러 Domain은 `users`의 legacy 학급 필드를 직접 읽습니다. 이 구조에서는 진급·전학 때 현재 필드 수정이 과거 표시값까지 덮을 위험이 있습니다.

W4는 기존 Domain을 일괄 교체하지 않고 다음 경계를 만들었습니다.

- `users`는 명시적 `LEGACY` 조회와 shadow mapping의 source로만 사용합니다.
- 새 학급·학적 쓰기는 canonical 컬렉션과 서버 명령으로 한정합니다.
- 과거 표시값은 Enrollment snapshot에 최소 범위로 남깁니다.
- 후속 Domain은 공통 resolver를 통해 출처를 선택해야 합니다.

## 5. Student Identity

경로는 `student_identities/{studentUid}`입니다. `studentUid`, 최소 표시명, 계정 상태, revision, provenance, schemaVersion, 생성·수정 actor와 시각을 저장합니다. 학년·반·번호는 identity에 저장하지 않습니다.

Roster import는 기존 identity가 없을 때만 생성하며, 학생 UID를 바꾸지 않습니다. client는 이 경로를 직접 생성·수정·삭제할 수 없습니다.

## 6. Semester Class

경로는 `semester_classes/{classId}`입니다. classId는 학기·학년·반을 기준으로 서버가 결정합니다. 문서는 `semesterId`, grade, classNumber, classKey, displayName, status, homeroomTeacherUid, revision, provenance, schemaVersion과 audit metadata를 가집니다.

같은 학기 classKey 중복, 기존 classId의 학기·키·표시명·담임 충돌, 존재하지 않거나 교사 역할이 아닌 담임을 차단합니다. CLOSED/ARCHIVED 학급은 일반 명령으로 바꿀 수 없습니다.

## 7. Enrollment

경로는 `semester_enrollments/{enrollmentId}`이며, `semester_enrollment_slots/{semesterId__studentUid}`가 학생·학기별 ACTIVE pointer를 보유합니다.

Enrollment에는 studentUid, semesterId, classId, 학기별 번호, 상태, source, revision, provenance, effectiveFrom/To와 당시 이름·학년·반·번호 snapshot을 저장합니다. 이동은 기존 Enrollment를 `TRANSFERRED`로 남긴 뒤 새 ACTIVE 문서를 만들고 slot을 원자 교체합니다. 종료는 `WITHDRAWN` 또는 `COMPLETED` 상태와 종료일을 기록하고 slot을 비웁니다.

동일 학생·학기의 ACTIVE Enrollment 2개, 비활성 Enrollment 재사용, 다른 학생·학기의 Enrollment 종료, archived semester 변경은 서버에서 거부합니다.

## 8. Roster Import Contract

`previewEnrollmentRoster`는 query-only dry run입니다. import payload는 학기, rosterId, revision, source label/hash, 효력일, expected student UID, 학급과 학생 행을 포함합니다.

검증 항목은 중복 학급·학생·학급 내 번호·expected UID, 고아 학생·담임·학급, 누락·예상 밖 학생, 기존 학급 충돌입니다. 통과한 validationHash가 같은 동안에만 `importEnrollmentRoster`를 실행할 수 있습니다. 적용 문서에는 승인 상태, sourceHash, expectedStudentUids, validationHash와 0건 오류 summary를 보존합니다.

Production roster 원천은 아직 결정하지 않았습니다. W4 contract는 source-agnostic이며 Production 명단은 가져오지 않았습니다.

## 9. Command Gateway

W4 명령은 다음 8개입니다.

- `createSemesterClass`
- `updateSemesterClass`
- `importEnrollmentRoster`
- `upsertEnrollment`
- `moveEnrollment`
- `closeEnrollment`
- `prepareSemesterArchive`
- `freezeSemesterArchive`

모든 명령은 admin-only, App Check·인증·active application session·recent auth·payload schema·semester 상태·revision을 business logic 전에 확인합니다. W2 receipt/audit와 같은 transaction에서 effect를 commit하고, 동일 command replay·payload conflict·응답 유실 복구를 지원합니다.

조회 callable은 `previewEnrollmentRoster`, `getArchiveEnrollmentState`입니다. 교직원 전체 학생 조회는 admin 또는 `student_list_read` capability에만 허용하고 학생은 자기 CURRENT 학적만 읽습니다.

## 10. Archive Contract

경로는 `semester_archive_manifests/{semesterId}`입니다. 2026-1 데이터는 물리 이동하지 않고 기존 위치에서 동결한다는 원칙을 유지합니다.

Archive Manifest는 상태, frozen revision, `archivedAt/archivedBy`, `frozenAt/frozenBy`, schemaVersion, W4 readiness registry, 주요 count, source paths, integrityHash, unresolved legacy 항목·blocking count, access policy, write fence version을 저장합니다. 접근 정책은 사용자 결정 전까지 `ADMIN_ONLY`입니다.

## 11. Archive Write Fence

`assertManifestWritable`은 CLOSED/ARCHIVED를 `SEMESTER_ARCHIVED_WRITE_FORBIDDEN`으로 차단합니다. ARCHIVED 전환은 같은 revision의 `FROZEN` archive evidence와 write fence version이 있어야 합니다.

Firestore Rules는 다음 경로의 client create/update/delete를 모두 거부합니다.

- `student_identities`
- `semester_classes`
- `semester_enrollments`
- `semester_enrollment_slots`
- `enrollment_roster_imports`
- `semester_archive_manifests`

후속 Domain은 canonical active pointer와 Manifest 상태를 확인하는 server-side semester write guard를 각 command에 연결해야 합니다. 기존 Domain 전체의 write fence 적용은 각 담당 Wave의 책임입니다.

## 12. Current / Archive / Legacy Adapter

`getArchiveEnrollmentState`는 `CURRENT`, `PREPARING`, `ARCHIVE`, `LEGACY`, `EXPLICIT`을 받습니다. 반환값에는 semesterId, provenance, source, readOnly, schemaVersion, legacy, status를 포함합니다.

- CURRENT는 canonical active pointer와 revision이 일치해야 합니다.
- PREPARING·ARCHIVE·EXPLICIT은 admin-only입니다.
- LEGACY는 반드시 semesterId와 callSite를 명시하고 read-only로 반환합니다.
- canonical CURRENT가 없으면 `NO_ACTIVE_SEMESTER`로 실패하며 `users`로 자동 전환하지 않습니다.
- LEGACY 호출은 `LEGACY_ENROLLMENT_READ` 구조 로그를 남깁니다.

silent fallback은 0입니다.

## 13. Readiness Integration

W3 readiness required check는 11개에서 14개로 늘었습니다.

| check                  | 핵심 검증                                                       |
| ---------------------- | --------------------------------------------------------------- |
| `archive_readiness`    | 이전 학기 PREPARED/FROZEN 증거, fence version, blocking issue 0 |
| `class_readiness`      | ACTIVE 학급 존재, schema·키·중복·실제 교사 담임 검증            |
| `enrollment_readiness` | 승인 roster, ACTIVE 유일성, slot 일치, 고아 0, 예상 학생 누락 0 |

학급·학적·slot·roster·identity·담임 계정·archive metadata를 dependencyHash에 포함합니다. 이 의존성이 바뀌면 기존 report는 STALE이 되고 READY/ACTIVE 전환에 사용할 수 없습니다. 종료 후 pointer가 비어도 `previousSemesterId`를 따라 이전 학기 archive를 검증합니다.

PASS와 세 가지 FAIL-closed 경로, dependency 변경 후 STALE을 unit과 emulator에서 확인했습니다.

## 14. Shadow Migration

기본 mapping은 dry-run 전용이며 `--apply`를 거부합니다. 적용은 `previewEnrollmentRoster → importEnrollmentRoster`를 통해 receipt/audit와 함께 수행해야 합니다.

검증 결과는 다음과 같습니다.

| 환경                           | 학생 | 학급 | 학적 | duplicate/orphan/missing |   source write | target write |
| ------------------------------ | ---: | ---: | ---: | -----------------------: | -------------: | -----------: |
| static synthetic               |    3 |    2 |    3 |                        0 |              0 |            0 |
| Dedicated Staging 임시 fixture |    3 |    2 |    3 |                        0 | migration 중 0 |            0 |

Staging 검증기는 예약 UID 5개를 기존 문서가 없을 때만 원자 생성합니다. dry run 뒤 owner marker가 일치하는 5개만 삭제했고 remaining fixture는 0입니다. Production project ID는 credential 초기화 전에 거부합니다.

## 15. Compatibility Adapter

기존 Domain이 아직 canonical Enrollment를 사용하지 못하는 동안 explicit `LEGACY` adapter를 제공합니다. 호출자는 source와 callSite를 명시해야 하며 결과는 항상 read-only·legacy provenance입니다. 누락 canonical 자료를 조용히 보완하거나 migration write를 실행하지 않습니다.

Compatibility 제거 조건과 담당 Wave는 [w5-w9-enrollment-consumer-handoff.md](./handoff/w5-w9-enrollment-consumer-handoff.md)에 기록했습니다.

## 16. Representative Consumers

관리자 설정의 `학급·학적·아카이브` 탭에서 출처별 조회, roster JSON dry run·적용, 이동, archive 준비·동결, provenance/read-only/readiness 표시를 제공합니다. 모든 변경은 명시적 버튼에서만 서버 명령을 호출합니다.

학생 MyPage에는 자기 CURRENT Enrollment 카드가 연결됐습니다. 조회 실패 시 legacy 학생 문서로 바꾸지 않고 관리자에게 명단 상태 확인을 요청합니다.

390×844, 1024×768, 1600×900 동일 소스 렌더링에서 가로 경계 초과 요소 0을 확인했습니다. 1600px는 이동·아카이브 2열, 1024px 이하에서는 단일 열 업무 흐름입니다.

## 17. Rules / Query Purity

W4 Rules emulator는 canonical 경로의 직접 쓰기 차단과 권한별 read 경계를 통과했습니다. 조회 callable은 transaction read만 수행하고 write count를 확인합니다.

Query Purity는 roster preview, archive/enrollment state, explicit legacy log, student CURRENT-only, 관리자 명시 버튼 경계를 검증합니다. client direct-write guard는 163개 승인 경계, query callable 5개, UNKNOWN 0, command inventory 28개를 유지합니다.

## 18. Tests

| 검증                      | 결과                                        |
| ------------------------- | ------------------------------------------- |
| Functions W2/W3 core      | 53/53 PASS                                  |
| W4 unit                   | 18/18 PASS                                  |
| W2 Rules / integration    | 10 / 19 PASS                                |
| W3 Rules / integration    | 7 / 17 PASS                                 |
| W4 Rules / integration    | 6 / 13 PASS                                 |
| client direct-write guard | 163 groups, UNKNOWN 0, PASS                 |
| W4 query purity           | 6 cases PASS                                |
| shadow migration fixtures | 6 cases PASS                                |
| build                     | 428 modules, PASS                           |
| format                    | PASS                                        |
| TypeScript baseline       | 기존 63 errors / 13 files, 신규 W4 오류 0   |
| full aggregate            | `npm run verify:w4-archive-enrollment` PASS |

Rules test에서 보이는 PERMISSION_DENIED 로그는 거부를 기대한 음성 case입니다. Firebase CLI 종료 후 남은 exact demo Firestore Java child만 명령행을 확인해 종료했고 8080·9099·5001·9199·9150 포트가 비었음을 확인했습니다.

## 19. Staging Verification

| 대상                  | 결과                                                                                                                                                           |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Firebase project      | `westory-staging-177587430482`                                                                                                                                 |
| Functions             | `executeCommand`, `getCommandStatus`, `getSemesterCoreState`, `previewEnrollmentRoster`, `getArchiveEnrollmentState`; v2 callable, asia-northeast3, Node.js 22 |
| 인증 없는 요청        | 5개 모두 HTTP 401, business effect 0                                                                                                                           |
| Firestore Rules       | compile·release PASS; Rules API 503 두 번 뒤 공식 재시도로 성공                                                                                                |
| Vercel Preview        | `dpl_CsP16rEoZykzKcgP3Y9mxS63uM5U`, READY, target preview                                                                                                      |
| Preview URL           | `https://westory-staging-o67e2dw9q-bbbs-projects-44f9da30.vercel.app`                                                                                          |
| Preview 보호          | 비인증 HTTP 302 SSO, alias 변경 0                                                                                                                              |
| live synthetic shadow | 3 students / 2 classes / 3 enrollments, blockers 0, cleanup 5/5                                                                                                |

실제 관리자 credential이나 실제 학생 개인정보는 사용하지 않았습니다. authenticated command 의미 검증은 demo emulator E2E에서 수행했습니다.

## 20. Production Safety

Production `history-quiz-yongsin`에는 Firestore data, Storage, Auth, Rules, Functions, Vercel deployment·alias·env, active semester, 2026-1 archive, 2026-2 Class/Enrollment, maintenance 상태 변경을 수행하지 않았습니다. 모든 Firebase 배포 명령에는 exact Dedicated Staging project ID를 명시했고 Vercel은 linked `westory-staging` Preview target만 사용했습니다. Production 접근·변경은 0입니다.

## 21. W5 / Domain Handoff

W5는 공통 Shell·탐색·상태 표현에서 source/provenance/readOnly를 유지해야 합니다. W6~W9 Domain은 legacy `users` 학급 필드 접근을 canonical resolver로 단계 교체하고, 쓰기 command에 semester write guard를 적용해야 합니다.

상세 owner, migration, acceptance test와 compatibility 제거 조건은 [w5-w9-enrollment-consumer-handoff.md](./handoff/w5-w9-enrollment-consumer-handoff.md)를 따릅니다.

## 22. Release Blockers

- `KI-W1-01 — RELEASE BLOCKER`: 재인증 뒤 일부 환경의 `users/{uid}` probe permission-denied가 남아 있습니다. W4에서 재디버깅하지 않았고 악화 증거는 없습니다.
- Production roster 최종 원천은 사용자 결정이 필요합니다.
- Archive historical access policy는 결정 전까지 `ADMIN_ONLY`입니다.
- Maintenance Hotfix와 W4의 Rules/Functions/package 변경은 별도 통합 검증이 필요합니다.

위 항목은 W4 Staging 기반의 CURRENT-WAVE blocker가 아닙니다.

## 23. Rollback

- 코드: W4 commit을 revert하고 W3 SHA를 기준으로 재검증합니다.
- Staging Functions/Rules: W3 source의 callable과 Rules를 exact Staging project에 재배포합니다.
- Preview: W4 deployment는 preview target이며 Production promotion·alias가 없으므로 이전 READY Preview를 사용합니다.
- 데이터: canonical W4 target은 Staging live에서 생성하지 않았습니다. 임시 synthetic source 5개는 실행 내에서 삭제돼 잔존 0입니다.
- 향후 roster 적용 rollback은 source를 수정하지 않고 migration-owned canonical fixture만 활성화 전 제거합니다. 활성화 뒤에는 일반 delete가 아니라 감사 가능한 correction workflow가 필요합니다.

## 24. Final W5 Readiness

W4 CURRENT-WAVE blocker는 0입니다. Student identity/Class/Enrollment 분리, ACTIVE 유일성, roster dry run·멱등 적용, archive metadata·write fence, explicit provenance adapter, readiness 14개, shadow migration, 대표 consumer, Dedicated Staging 배포와 Production 변경 0을 확인했습니다.

`READY FOR W5 GLOBAL SHELL / COMMON UI STAGING DEVELOPMENT`
