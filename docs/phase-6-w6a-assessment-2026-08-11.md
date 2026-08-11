# PHASE 6 — W6A Assessment Lifecycle, Attempt, Save, Submit & Recovery

## 1. Executive Summary

W6A에서는 퀴즈와 역사교실의 평가 생명주기를 공통 서버 계약으로 옮겼습니다. 평가 화면을 조회하는 일과 실제 응시를 시작하는 일을 분리했고, 답안 저장·제출·복구는 application session과 revision을 검증하는 서버 경로로만 처리합니다. 학생의 학기·학급·Enrollment가 평가 대상과 일치하지 않으면 business write 전에 거부됩니다.

교사 작성·공개 흐름은 W2 Command Gateway를 사용하도록 연결했습니다. 학생의 Attempt, immutable Submission, Result, receipt, audit은 한 트랜잭션에서 확정됩니다. W5 이전 번들을 실제 Dedicated Staging에 연결한 검증에서도 직접 SDK 쓰기가 거부되었고, legacy 및 canonical 데이터 수가 변하지 않았습니다.

최종 판정은 `READY FOR W6B GRADE & EVIDENCE STAGING DEVELOPMENT`입니다. 이 판정은 Staging의 평가 생성·응시·저장·제출·복구 기반이 준비됐다는 뜻이며, 공식 성적 확정이나 Production 출시 준비를 뜻하지는 않습니다.

## 2. Baseline

- 기준 브랜치: `codex/phase6-w5-global-shell-common-ui`
- 기준 SHA: `4a6083857a3acd9c6831b71735aae288c9cbd3d0`
- 작업 브랜치: `codex/phase6-w6a-assessment`
- 시작 당시 `origin/main` 대비: ahead 0, behind 38
- 사용자 문서, W1 evidence, `tmp/**`, `.env.local`, 기존 W1 viewport 실행 파일은 W6A 범위에서 제외했습니다.
- Production 배포·데이터·Rules·Functions·환경변수·별칭은 변경하지 않았습니다.

## 3. Existing Assessment Inventory

평가 경로를 전수 재감사하지 않고 W5 인수인계와 현재 실행 코드를 기준으로 차이만 확인했습니다.

- 퀴즈: 학생 `QuizRunner`, 교사 문제 은행·편집·설정 화면, 학기별 `quiz_questions`, `assessment_config`
- 역사교실: 학생 목록·응시 화면, 교사 운영 화면, 학기별 `history_classrooms`, 지도 빈칸 자료
- 기존 위험 경로: 학생의 직접 `setDoc`/`addDoc`, mount 직후 응시 상태 사용, legacy class/profile 의존, 직접 결과 저장, 오래된 bundle의 직접 SDK 쓰기
- 유지 경로: 기존 학생·교사 canonical route, 유형별 화면과 채점 방식, W5 Shell, W3 semester resolver, W4 Enrollment/Archive adapter

공통 lifecycle만 통합했고, 퀴즈와 역사교실의 화면·문항 표현 차이는 adapter로 남겼습니다.

## 4. Assessment Definition Lifecycle

canonical Definition 경로는 `semester_assessment_definitions/{definitionId}`입니다. 상태는 `DRAFT`, `READY`, `PUBLISHED`, `CLOSED`, `ARCHIVED`를 사용하며, 학생의 실제 시작 가능 여부는 공개 상태·기간·현재 학기·Enrollment를 함께 판단합니다.

Definition에는 `semesterId`, 평가 유형, source reference/hash, 대상 학급·학생, 공개 기간, 제한 시간, 최대 응시 횟수, cooldown, revision, schema/policy version을 기록합니다. 생성·수정·상태 전이는 모두 `executeCommand`를 통하고, CAS revision과 receipt/audit을 남깁니다. ARCHIVED source 및 Definition 수정은 서버에서도 차단합니다.

## 5. Attempt Lifecycle

canonical Attempt 경로는 `semester_assessment_attempts/{attemptId}`입니다. 화면 조회만으로 문서를 만들지 않습니다.

- `STARTED`: 학생이 명시적으로 응시 시작을 눌렀을 때 생성
- `IN_PROGRESS`: revision을 확인한 답안 저장이 성공한 상태
- `RECOVERABLE`: 같은 UID가 새로고침·재로그인 후 이어갈 수 있는 상태
- `SUBMITTED`: immutable Submission/Result와 함께 최종 확정
- `EXPIRED`, `LOCKED`: 정책상 더 진행할 수 없는 상태를 읽는 계약

Attempt에는 Definition revision, source hash, semester, student, Enrollment, class, attempt number, 서버가 선택한 문항, grading snapshot, 서버 deadline, answer revision을 고정합니다. 화면 이탈·visibility change·잘못된 URL로 CANCELLED 문서를 만들지 않습니다.

## 6. Explicit Start

`startAssessmentAttempt`는 W2 Command Gateway 명령입니다. 서버는 ACTIVE semester pointer/manifest, PUBLISHED Definition, 공개 기간, source hash, ACTIVE Enrollment, canonical class, 대상 학급·학생, 최대 응시 횟수, application session을 business write 전에 검증합니다.

같은 학생·Definition에 활성 Attempt가 있으면 새 문서를 만들지 않고 기존 Attempt를 반환합니다. command replay, 동시 시작, commit 후 응답 유실에서도 business effect는 1회입니다. 서버가 문항 ID와 grading snapshot을 선택하므로 client가 임의 문항을 제출할 수 없습니다.

## 7. Invalid Link Safety

`getAssessmentState`는 query-only callable이며 write count는 0입니다. 누락·오류·비대상·종료·Archive 입력은 `INVALID_LINK`, `PERMISSION`, `NOT_OPEN`, `CLOSED`, `ARCHIVED`, `SUBMITTED`로 구분합니다.

Staging 브라우저 검증 중, 동일 React route에서 필수 query를 제거하면 직전 화면 상태가 잠시 남는 문제를 발견했습니다. 필수 query가 없을 때 상태를 즉시 초기화하고 0문항·`응시 불가`·목록 복귀만 표시하도록 수정했습니다. 시작 버튼, Attempt, 답안, audit write는 생기지 않습니다. 역사교실의 누락 ID도 별도 안내로 차단됩니다.

## 8. Answer Save Contract

답안은 `saveAssessmentProgress` 전용 callable로 저장합니다. 입력은 `attemptId`, `answers`, `currentItemId`, `saveId`, `expectedRevision`입니다.

- application session과 Attempt 소유자 확인
- `STARTED`/`IN_PROGRESS`/`RECOVERABLE`만 수정 허용
- 서버 deadline 확인
- 동일 `saveId`+동일 payload replay 허용, 다른 payload 재사용 거부
- 오래된 revision 거부
- 서버 저장 시각과 다음 revision 반환
- debounce 저장, pending 저장 처리, 실패 시 성공 표시 금지

장기 평문 localStorage 답안은 추가하지 않았습니다. 재로그인 후에는 서버 상태를 다시 조회해 같은 Attempt를 복구합니다.

## 9. Submission Contract

`submitAssessmentAttempt`는 명시적 Command Gateway 명령입니다. Attempt 소유자, 상태, 최신 revision, 서버 deadline, application session을 확인한 뒤 다음 항목을 한 트랜잭션에서 처리합니다.

- Attempt를 `SUBMITTED`로 변경
- 최종 answers와 submittedAt 고정
- `semester_assessment_submissions/{attemptId}` immutable snapshot 생성
- `semester_assessment_results/{attemptId}` provisional auto-evaluation 생성
- command receipt와 audit 생성

같은 command 재요청과 응답 유실은 기존 receipt/result를 반환합니다. 다른 탭·기기의 동시 제출도 Submission/Result 각 1개만 생성합니다. 제출 후 일반 answer save는 거부됩니다.

## 10. Session / Network Recovery

학생의 application session은 save·submit 실행 직전 서버에서 확인합니다. 요청이 세션 만료 경계를 지날 때에는 트랜잭션이 정확히 한 번 성공하거나 명확히 거부되며, client는 기존 result/receipt 또는 `getAssessmentState`를 조회해 복구합니다.

동일 UID 재로그인은 새 Attempt를 만들지 않습니다. 새 session으로 기존 Attempt를 조회하고 최신 revision부터 이어갑니다. 다른 UID는 Attempt 조회·저장·제출이 모두 거부됩니다. KI-W1-01의 관리자 고위험 재인증 경로는 범위를 넓혀 재디버깅하지 않았습니다.

## 11. A01–A08 Results

| Case | 결과 | 확인 내용 |
| --- | --- | --- |
| A01 | PASS | 지연 save가 세션 만료 시각을 지나도 정확히 한 번 또는 명시 거부 |
| A02 | PASS | save와 session expiration 경합의 안전한 단일 결과 |
| A03 | PASS | submit과 session expiration 경합에서 부분 제출 0 |
| A04 | PASS | commit 후 응답 유실 시 receipt/status로 복구 |
| A05 | PASS | 동일 UID 재로그인 후 같은 Attempt 복구 |
| A06 | PASS | 같은 submit command 재시도 effect 1회 |
| A07 | PASS | 오래된 answer revision의 덮어쓰기 0 |
| A08 | PASS | 다른 UID의 read/write 0 |

퀴즈와 역사교실 두 유형 모두 같은 matrix를 통과했습니다.

## 12. Multi-Tab / Multi-Device

Attempt는 학생·Definition·attempt number 기준으로 결정되며, active Attempt는 하나만 반환합니다. 저장은 revision CAS를 사용해 두 탭 중 하나만 다음 revision을 얻습니다. 뒤늦게 도착한 탭은 최신 상태를 다시 불러와야 하며 무음 overwrite는 없습니다.

한 탭이 제출한 뒤 다른 탭의 save는 거부되고, 중복 submit은 기존 immutable 결과를 반환합니다. 새로고침과 같은 UID 재로그인은 기존 Attempt를 조회하므로 새 Attempt가 생기지 않습니다.

## 13. Semester / Enrollment Targeting

학생 자격은 W3·W4 canonical 구조만 사용합니다.

- `site_settings/semester_active`와 ACTIVE manifest revision 일치
- `semester_enrollment_slots`의 active Enrollment
- Enrollment의 `studentUid`, `semesterId`, `classId`, `enrollmentStatus=ACTIVE`
- Definition의 assigned class/student 조건

Student profile의 legacy grade/class만으로 응시를 허용하지 않습니다. 현재 날짜로 학기를 추론하거나 Archive 학기에 새 Attempt를 만드는 silent fallback도 없습니다.

## 14. Teacher Assessment Operations

교사 화면의 Definition 생성·수정·공개·종료와 핵심 source 변경을 Command Gateway에 연결했습니다. 적용 대상은 퀴즈 문제 생성·수정·삭제, 퀴즈 설정/Definition, 역사교실 source 생성·수정·삭제, 지도 빈칸 수정입니다.

쓰기에는 capability, 담당 범위, application session, source revision/CAS, Archive fence가 적용됩니다. 권한 없는 교사는 business write 전에 거부됩니다. 전 교사 화면의 공통 draft·bulk 체계는 W9로 남겼습니다.

## 15. Student Assessment UX

W5 학생 Shell 안에서 평가 준비, 명시적 시작, 응시, 자동 저장, 제출 확인, 제출 결과, 복구 상태를 표시합니다. 퀴즈 준비 화면은 제한 시간·문항 수·누적 응시 횟수를 보여 주며, 제출 확인 dialog는 취소와 확정 동작을 분리합니다.

역사교실도 준비 화면 이후 명시적 시작을 거쳐 서버 Attempt를 사용합니다. 저장 성공 여부를 추측하지 않고 server revision을 기준으로 상태를 갱신합니다. 브라우저 E2E에서는 퀴즈 1회와 역사교실 1회를 제출했고 Attempt/Submission/Result가 각각 2건, 포인트 reward source가 유형별 1건만 생성됐음을 정리 전에 확인했습니다. Wis 보상 정책 자체의 개편은 W7 범위입니다.

## 16. Archive / Legacy

ARCHIVED Definition과 source는 새 시작·저장·제출·교사 수정이 모두 차단됩니다. 사용자에게 지난 학기·read-only 출처를 텍스트로 표시합니다.

Legacy 평가는 silent fallback하지 않습니다. 읽을 수 있는 범위만 LEGACY provenance로 노출하고, 깨졌거나 지원하지 않는 데이터는 `assessment_legacy_issues`로 readiness에 반영합니다. legacy 데이터가 없다는 이유로 새 Attempt를 임의 생성하지 않습니다.

## 17. Assessment Readiness

W3 readiness의 Assessment placeholder를 실제 필수 check로 교체했습니다. 전체 required check는 15개, optional advisory를 포함한 check 수는 16개입니다.

Assessment check는 master schema, semester, Class reference, orphan/duplicate, 공개 기간·설정, schema/policy version, blocking legacy issue를 확인합니다. 평가가 선택 정책이면 미존재를 실패로 만들지 않습니다. Preparing semester의 Definition/source dependency가 바뀌면 dependency hash가 달라져 기존 readiness는 STALE이 됩니다.

## 18. Rules / Query Purity

Client는 canonical Definition, Attempt, Submission, Result, legacy result path, receipt, audit을 직접 쓸 수 없습니다. Attempt/Submission/Result의 직접 read도 학생 client에 열지 않고 callable이 소유자와 범위를 검증해 필요한 projection만 반환합니다.

최종 정적 경계 결과는 approved boundary group 163개, query callable factory 7개, fetch GET 2개, command inventory 28개, UNKNOWN 0입니다. 평가 목록·상세·준비·잘못된 링크 query는 persistent write 0입니다.

## 19. Responsive / Accessibility

학생 평가 준비 화면을 정확한 다섯 viewport에서 확인했습니다.

| Viewport | 가로 overflow | Navigation 겹침 | 주요 동작 |
| --- | --- | --- | --- |
| 390 × 844 | 0 | 0 | 44px, 화면 안 |
| 768 × 1024 | 0 | 0 | 48px, 화면 안 |
| 1024 × 768 | 0 | 0 | 48px, 화면 안 |
| 1280 × 800 | 0 | 0 | 48px, 화면 안 |
| 1600 × 900 | 0 | 0 | 48px, 화면 안 |

교사 역사교실 대표 화면도 390, 1024, 1600px에서 overflow 0, 주요 동작 44px, 단일 main/h1을 확인했습니다. 스킵 링크는 route hash를 훼손하지 않고 `main#westory-main-content`로 focus를 이동합니다. 제출 확인 dialog의 제목·동작 label과 초기 focus, 색상 외 상태 문구, 남은 시간의 텍스트 표현을 확인했습니다.

## 20. Regression

최종 `npm run verify:w6a-assessment`가 PASS했습니다.

- assessment attempt safety 16 checks
- direct-write boundary fixture 11 checks
- direct-write boundary 163 groups, UNKNOWN 0
- W4 query purity, W5 shell safety
- Functions maintenance 44 checks
- W2 command gateway, W3 semester, W4 archive/enrollment 회귀
- W6A lifecycle unit 23 cases
- W2~W6A single emulator Rules/Integration
- W6A integration 22 cases, 두 평가 유형 A01~A08 포함
- build, TypeScript baseline, format

Firebase CLI가 남긴 demo Firestore Java 자식은 정확한 `demo-westory-session-w6a` command line을 확인한 뒤 종료했으며 8080, 9099, 5001, 9199, 9150 포트를 비웠습니다.

## 21. Dedicated Staging

- Firebase project: `westory-staging-177587430482`
- Functions와 Firestore Rules: Staging에만 반영
- 최종 immutable Preview: `dpl_FyZYUi7vd7ZcfMvp2J8gib48nrNx`
- Preview URL: `https://westory-staging-owauucx0y-bbbs-projects-44f9da30.vercel.app`
- Vercel target: Preview, Production 아님

합성 학생·교사, class, Enrollment, Definition/source로 브라우저 E2E를 수행했습니다. 정리 스크립트가 평가·세션·receipt·audit·포인트 지갑/거래와 Auth 계정을 삭제했고, 두 번째 cleanup에서 삭제 대상 0을 확인했습니다. 안정 Staging 별칭 `westory-staging-westoria28-8028-bbbs-projects-44f9da30.vercel.app`은 승인된 W6A Preview `dpl_FyZYUi7vd7ZcfMvp2J8gib48nrNx`를 가리킵니다. reCAPTCHA 허용 도메인은 이 안정 도메인 1개만 유지했습니다.

## 22. Production Safety

Production Firestore, Storage, Auth, Rules, Functions, Vercel, alias, 환경변수, active semester, 평가/Attempt, GitHub Pages 변경은 모두 0입니다. 배포 명령에는 `history-quiz-yongsin`을 사용하지 않았습니다.

마지막 읽기 전용 확인에서 Production `site_settings/student_maintenance`는 `enabled=true`, `revision=3`, 9개 canonical field로 유지됐습니다. 설정을 쓰거나 학생 차단 상태를 바꾸지 않았습니다.

## 23. W6B Handoff

W6B는 immutable Submission과 Result를 평가 근거로 사용해야 합니다. Attempt나 Definition 원본을 성적 처리를 위해 수정하지 않습니다. canonical path, snapshot 필드, 공식 성적 이전 상태, 자동·교사 채점 경계, Archive/Legacy 처리와 acceptance test는 `docs/handoff/w6b-grade-evidence-assessment-handoff.md`에 정리했습니다.

## 24. Release Blockers

- `KI-W1-01 — RELEASE BLOCKER`: 관리자 고위험 재인증 뒤 일부 환경에서 `users/{uid}` probe가 permission-denied로 실패하는 문제는 그대로입니다.
- W6A 학생 일반 세션 만료·재로그인·Attempt 복구 matrix는 PASS했으며 KI-W1-01을 악화시키는 회귀는 확인되지 않았습니다.
- W6A CURRENT-WAVE blocker는 0개입니다.

## 25. Rollback

1. 안정 Staging 별칭을 이전 Preview로 되돌리면 클라이언트 배포를 즉시 복구할 수 있습니다. Production alias에는 연결하지 않았습니다.
2. Staging Functions/Rules는 W5 배포 artifact 또는 W5 SHA의 파일로 Staging 프로젝트에만 되돌립니다.
3. W6A canonical 컬렉션은 기존 W5 client가 사용하지 않으며, rollback 시 보존해 forensic evidence로 둘 수 있습니다.
4. W5 이전 번들은 새 Rules에서 직접 평가 쓰기가 거부되므로, Rules만 되돌려 우회를 다시 열어서는 안 됩니다.
5. Production은 변경하지 않았으므로 Production rollback 작업은 없습니다.

## 26. Final W6B Readiness

완료 조건을 모두 충족했습니다.

`READY FOR W6B GRADE & EVIDENCE STAGING DEVELOPMENT`

W6B는 공식 점수 산출·평가 근거·정정·서명만 진행해야 하며, W6A가 고정한 Submission snapshot과 result reference를 변경해서는 안 됩니다.
