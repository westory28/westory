# PHASE 6 — W6B Grade, Evidence, Correction & Signature

## 1. Executive Summary

W6B에서는 W6A의 불변 제출 원본 위에 공식 성적 계약을 구축했습니다. Attempt, Submission, Result를 같은 트랜잭션에서 다시 검증한 뒤 교사 채점 초안, 근거 잠금, 학생 공개, 정정, 확인과 서명을 각각 명시적 명령으로 처리합니다. 기존 제출 답안과 자동 판정 결과는 수정하지 않습니다.

공식 성적은 하나의 mutable head와 불변 version 이력으로 나뉩니다. 정정은 기존 성적을 덮어쓰지 않고 새 version을 만들며, 학생 요청과 확인·서명도 해당 grade revision과 evidence hash에 묶인 append-only 기록으로 남습니다. 현재 학기만 쓸 수 있고 Archive와 Legacy는 조회 전용입니다.

최종 판정은 `READY FOR W7 WIS ECONOMY STAGING DEVELOPMENT`입니다. 이 판정은 Staging의 성적·근거·정정·서명 기반이 준비됐다는 뜻이며, Production 출시나 과거 성적 migration 완료를 뜻하지는 않습니다.

## 2. Baseline

- 기준 브랜치: `codex/phase6-w6a-assessment`
- 기준 SHA: `87013f2ef14625b70ecade756d84314990dafda9`
- 작업 브랜치: `codex/phase6-w6b-grade-evidence`
- 시작 당시 `origin/main` 대비: ahead 0, behind 40
- 사용자 문서, W1 evidence, `tmp/**`, `.env.local`, 기존 W1 viewport 실행 파일은 커밋 범위에서 제외했습니다.
- Production 배포·데이터·Rules·Functions·환경변수·별칭은 변경하지 않았습니다.

## 3. Canonical Grade Model

W6B canonical 경로는 다음 다섯 가지입니다.

| 성격             | 경로                                          | 변경 방식                      |
| ---------------- | --------------------------------------------- | ------------------------------ |
| 성적 head        | `semester_grade_records/{recordId}`           | CAS로만 상태·현재 version 변경 |
| 성적 version     | `semester_grade_versions/{versionId}`         | create-only, immutable         |
| 학생 요청        | `semester_grade_requests/{requestId}`         | 결정적 ID와 제한된 상태 전이   |
| 확인·서명        | `semester_grade_attestations/{attestationId}` | append-only                    |
| legacy 차단 이슈 | `grade_legacy_issues/{issueId}`               | migration/readiness 진단       |

Assessment source record는 `attemptId`로 결정합니다. 같은 Attempt의 official head는 최대 한 개이고, 정정할 때도 head를 새로 만들지 않습니다. version에는 item별 배점·부여 점수·판정 근거, rubric version, source reference, evidence hash, supersedes version을 고정합니다.

## 4. W6A Source Immutability

`createGradeDraft`는 다음 문서를 한 transaction에서 읽습니다.

- `semester_assessment_attempts/{attemptId}`
- `semester_assessment_submissions/{attemptId}`
- `semester_assessment_results/{attemptId}`
- 제출 당시 Enrollment
- 제출 당시 Class

서버는 student, semester, enrollment, class, definition, source hash, Submission/Result reference가 모두 일치하는지 확인합니다. Result만 보고 성적을 만들지 않습니다. Staging 검증 전후 immutable source hash는 `52b6f4f07b9c357160c0331c81bf392854ca7dd9396c8efb5223184875c06a08`로 같았습니다.

## 5. Grade Lifecycle

대표 흐름은 다음과 같습니다.

`AUTO_EVALUATED_UNOFFICIAL` → `REVIEWED` → `EVIDENCE_LOCKED` → `OFFICIAL_PENDING_SIGNATURE` → `OFFICIAL`

교사가 정정하면 이전 official version을 supersede하는 새 `REVIEWED` version이 생깁니다. 새 version도 다시 근거 잠금과 공개를 거쳐야 합니다. 자동 판정은 공식 점수가 아니며, 교사가 검토·잠금·공개를 각각 명시적으로 실행합니다.

## 6. Command Gateway

모든 mutation은 W2 `executeCommand`를 사용합니다.

- `createGradeDraft`
- `reviewGradeDraft`
- `finalizeGradeEvidence`
- `publishOfficialGrade`
- `correctOfficialGrade`
- `requestGradeReview`
- `acknowledgeGradeEvidence`
- `signOfficialGrade`

각 명령은 application session, actor capability, ACTIVE semester, expected semester revision, record revision, grade revision, version ID를 business write 전에 검증합니다. receipt와 audit은 business document와 같은 transaction에서 생성됩니다. replay, 동시 실행, commit 후 응답 유실에서도 effect는 한 번입니다.

## 7. Query Contract

직접 노출되는 callable은 query-only `getGradeEvidenceState` 하나입니다. 용도는 `MY_GRADES`, `GRADE_DETAIL`, `TEACHER_QUEUE`이며 write count는 0입니다.

학생 목록은 actor UID로 서버 query하고, 상세는 결정적 record document를 읽은 뒤 소유자를 검사합니다. 다른 학생 자료는 빈 결과로 돌려보냅니다. 교사도 필요한 student UID나 record ID 범위만 읽습니다. 학기 전체 1,154건을 매 화면에서 scan하지 않습니다.

학생 projection에는 제출한 답과 자동 정오 판정만 포함합니다. answer key, grading snapshot 내부 정답, 서버 source 원문은 내보내지 않습니다.

## 8. Scoring Integrity

서버는 item ID, max score, awarded score, 합계, percent를 결정적으로 계산합니다. 음수 점수, 배점 초과, 빈 item, 지원하지 않는 rubric version, stale revision은 transaction 전에 거부합니다.

두 교사가 같은 revision을 검토하면 한 명만 성공합니다. `finalizeGradeEvidence`와 `publishOfficialGrade`도 expected record/version을 확인하므로 오래된 화면이 최신 성적을 덮어쓸 수 없습니다. 실패한 명령은 record, version, receipt, audit을 일부만 남기지 않습니다.

## 9. Evidence Bundle

성적 상세에서 다음 근거를 추적할 수 있습니다.

- Attempt, Submission, Result reference
- Definition ID/revision과 source hash
- 제출 당시 semester, Enrollment, Class snapshot
- item별 학생 답과 자동 판정
- teacher awarded score와 reason
- rubric version과 총점 계산
- reviewer, finalizer, publisher
- evidence hash와 supersedes version
- 요청, 확인, 서명 이력

Submission 전체를 성적 문서에 무제한 복사하지 않습니다. 필요한 snapshot과 불변 reference를 조합해 조회합니다.

## 10. Correction

학생은 현재 version에 `OBJECTION` 또는 `ANSWER_SHEET` 요청을 만들 수 있습니다. 같은 학생·record·grade revision·request kind의 중복 요청은 결정적 ID로 차단합니다.

교사는 요청을 기각하거나 수용할 수 있습니다. 기각은 요청 상태와 사유만 기록합니다. 수용하면 기존 official version을 보존한 새 grade version을 만들고 요청을 `ACCEPTED`로 바꿉니다. 새 version은 다시 `REVIEWED`부터 공식화 절차를 거칩니다.

## 11. Acknowledgement / Signature

화면 방문만으로 확인이나 서명을 남기지 않습니다. `acknowledgeGradeEvidence`와 `signOfficialGrade`는 서로 다른 명령입니다.

확인·서명은 `recordId`, `versionId`, `gradeRevision`, `evidenceHash`, statement version에 묶입니다. 성적 revision이 바뀌면 이전 확인과 서명은 감사 이력으로 남지만 새 version의 유효한 서명으로 보지 않습니다. 현재 UI는 학생 본인 이름의 typed signature만 저장하며 이미지 원문은 저장하지 않습니다.

## 12. Archive / Legacy

성적 mutation은 ACTIVE semester에서만 허용합니다. CLOSING은 CURRENT provenance로 읽되 read-only이며, CLOSED와 ARCHIVED는 ARCHIVE/read-only입니다. PREPARING 계열은 PREPARING/read-only로 표시합니다.

Legacy는 명시적으로 `LEGACY`를 요청한 query에서만 조회합니다. CURRENT 결과가 비었다고 legacy 성적을 대신 보여 주지 않습니다. legacy를 official canonical record로 올리려면 별도 migration evidence와 관리자 승인이 필요합니다.

## 13. Previous Bundle Retirement

기존 수행평가·정기시험 client write 15개를 fail-closed 경계로 전환했습니다. 기존 roster/score/confirmation/consent/signature/settings write와 오래된 objection callable은 `CLIENT_UPDATE_REQUIRED` 또는 Rules deny로 막힙니다.

W6B canonical collection은 client direct read/write를 모두 허용하지 않습니다. old bundle과 직접 SDK가 official grade, request, attestation을 만들거나 바꿀 수 없습니다.

## 14. Student UI

기존 canonical route를 유지했습니다.

- `/student/score/performance`
- `/student/score/written-exam`

학생은 현재 학기 공식 점수, item별 근거, 이전 요청, 확인·서명 상태를 봅니다. draft와 review 중 성적은 노출되지 않습니다. 현재 version에 pending 요청이 있으면 서명을 막고, 교사가 정정한 새 version은 다시 확인과 서명을 요구합니다. 과거 요청과 서명은 이전 version 이력으로 구분합니다.

## 15. Teacher UI

교사 route는 `/teacher/exam?tab=performance|written-essay`를 사용합니다. 탭을 클릭하면 URL이 바뀌며 새로고침, 뒤로가기, 앞으로가기에도 선택 상태가 복원됩니다.

대표 화면은 채점 대기 source, 학생별 record 목록, item 근거, 점수 입력, 검토·잠금·공개, 요청 수용·기각, 정정 version, 서명 현황을 master-detail 구조로 보여 줍니다. 390px에서는 단일 열, 넓은 화면에서는 목록과 상세를 함께 사용합니다.

Staging E2E 중 동일 version 안의 status·request·attestation 변경 뒤 상세 패널이 이전 projection을 유지하는 문제를 발견했습니다. 상세은 목록의 revision/status와 정확히 일치할 때만 사용하고, 모든 mutation 뒤 detail projection을 명시적으로 다시 조회하도록 수정했습니다.

## 16. Grade Readiness

W3 readiness에 필수 `grade_evidence_readiness`를 연결했습니다. 전체 required check는 16개, optional advisory를 포함한 check 수는 17개입니다.

Grade check는 schema/policy version, Attempt·Submission·Result·Enrollment·Class join, item total, evidence hash, duplicate official head, unsupported rubric, unresolved blocking issue를 검사합니다. 성적이 없다는 이유만으로 실패하지 않습니다. Preparing semester의 grade dependency가 달라지면 readiness dependency hash가 바뀌어 기존 report는 STALE이 됩니다.

## 17. Rules / Query Purity

최종 direct boundary 결과는 approved boundary group 156개, query callable factory 9개, fetch GET 2개, command inventory 28개, UNKNOWN 0입니다. Grade UI의 client mutation, implicit mutation, canonical direct read/write는 모두 0입니다.

Rules 검증은 canonical 다섯 collection과 legacy grade path의 create/update/delete를 차단하고, receipt/audit 직접 read/write도 계속 차단합니다. Archive 성적 mutation과 previous bundle write도 거부됩니다.

## 18. Responsive / Accessibility

학생과 교사 대표 Grade 화면을 모두 정확한 다섯 viewport에서 확인했습니다.

| Viewport   | 학생 overflow | 교사 overflow | 현재 학기·주요 상태 |
| ---------- | ------------- | ------------- | ------------------- |
| 390 × 844  | 0             | 0             | PASS                |
| 768 × 1024 | 0             | 0             | PASS                |
| 1024 × 768 | 0             | 0             | PASS                |
| 1280 × 800 | 0             | 0             | PASS                |
| 1600 × 900 | 0             | 0             | PASS                |

학생 navigation, 교사 tablist, main landmark, status text, label이 유지됐습니다. 점수 상태는 색상뿐 아니라 `검토 완료`, `근거 잠금`, `학생 확인 대기`, `확인 완료` 텍스트로 표시합니다. form control에는 label이 있고, 교사 탭은 tablist/tab/tabpanel semantics를 사용합니다.

## 19. Dedicated Staging

- Firebase project: `westory-staging-177587430482`
- Functions와 Firestore Rules: Staging에만 반영
- 최종 immutable Preview: `dpl_4T2CexuRZ1TmjfbjZeVe6fKSWXqm`
- Preview URL: `https://westory-staging-amxin3b7i-bbbs-projects-44f9da30.vercel.app`
- 안정 alias: `https://westory-staging-westoria28-8028-bbbs-projects-44f9da30.vercel.app`
- Vercel target: Preview

합성 학생·교사와 W6A Attempt/Submission/Result를 만든 뒤 8개 W6B 명령을 브라우저에서 모두 실행했습니다. 정정 전후 version, 요청, 두 version의 확인 기록, 최종 서명을 확인했습니다. Staging fixture verify는 canonical 8문서와 W6A source hash 불변을 통과했습니다.

정리 결과는 Grade 8문서, receipt/audit 22문서, fixture 10문서, session 7문서, Auth 2계정 삭제입니다. residual business document는 0입니다. 임시 App Check debug token, Vercel bypass token, 새 허용 도메인은 만들지 않았습니다.

## 20. Regression

최종 `npm run verify:w6b-grade`가 PASS했습니다.

- command safety와 query purity
- direct boundary 156 groups, UNKNOWN 0
- Grade functions unit 67 cases
- W2~W6B single-emulator Rules/Integration
- W6B integration 21 cases
- concurrent CAS, response loss, manual source, role/capability, 다른 학생 격리
- Archive/Legacy, readiness, previous bundle deny
- build, TypeScript baseline, format

Firebase CLI가 남긴 Java 자식은 정확한 `demo-westory-session-w6b` command line을 확인한 뒤 종료했습니다. 5001, 8080, 9099, 9150, 9199 포트는 모두 비었습니다.

## 21. TypeScript

기존 기준선 63 errors / 13 files를 그대로 유지했습니다. fingerprint는 `f431d08138d4a36bf84a0f3ebadb9a315baf1940461a222ec4e28f20cc196477`이며 W6B 신규 파일 오류는 0입니다.

## 22. Production Safety

Production Firestore, Storage, Auth, Rules, Functions, Vercel, alias, 환경변수, active semester, 평가·성적, GitHub Pages 변경은 모두 0입니다. Production project에는 읽기 전용 문서 GET 1회만 수행했습니다.

마지막 확인에서 `site_settings/student_maintenance`는 `enabled=true`, `revision=3`으로 유지됐습니다. 설정과 학생 차단 상태는 바꾸지 않았습니다.

## 23. Release Blockers

- `KI-W1-01 — RELEASE BLOCKER`: 교사 고위험 재인증 직후 maintenance/profile preflight가 실패하는 기존 현상을 Staging에서 한 번 재현했습니다.
- 장시간 재디버깅하지 않았고 새 로그인 recent-auth 경로로 W6B 검증을 마쳤습니다.
- W6B 일반 session, command, query, student sign 흐름의 회귀는 확인되지 않았습니다.
- W6B CURRENT-WAVE blocker는 0개입니다.

## 24. W7 Handoff

W7은 grade UI나 official version을 포인트 보상을 위해 수정하면 안 됩니다. 보상이 필요하면 `recordId`, `versionId`, `gradeRevision`, `evidenceHash`를 불변 source reference로 삼고 Economy Ledger에 별도 entry를 만드십시오. 같은 grade version의 reward는 결정적 reference와 exactly-once command로 한 번만 반영해야 합니다.

상세 계약은 `docs/handoff/w7-wis-economy-grade-handoff.md`에 정리했습니다.

## 25. Rollback

1. 안정 Staging alias를 이전 W6A Preview로 되돌리면 client를 복구할 수 있습니다.
2. Staging Functions/Rules는 W6A SHA의 artifact로 Staging 프로젝트에만 되돌립니다.
3. canonical Grade 문서는 기존 client가 사용하지 않으므로 rollback 중에도 삭제하지 않고 audit 근거로 보존할 수 있습니다.
4. previous bundle write deny는 유지해야 합니다. Rules만 되돌려 직접 쓰기를 다시 열지 않습니다.
5. Production은 변경하지 않았으므로 Production rollback은 없습니다.

## 26. Final W7 Readiness

완료 조건을 모두 충족했습니다.

`READY FOR W7 WIS ECONOMY STAGING DEVELOPMENT`

W7은 학기별 Economy, Account, immutable Ledger, projection, 상품·재고·주문만 다뤄야 합니다. 공식 성적 version이나 W6A 제출 원본을 Wis 지급 편의를 위해 수정하면 안 됩니다.
