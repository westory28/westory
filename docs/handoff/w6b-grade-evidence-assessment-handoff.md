# W6B Grade & Evidence — Assessment Handoff

## 목적

이 문서는 W6A가 만든 평가 제출 근거를 W6B의 공식 성적·근거·정정·서명 흐름에 넘기기 위한 계약입니다. W6B는 평가 원본이나 학생 Attempt를 성적 편의를 위해 다시 쓰지 않고, immutable Submission/Result를 출발점으로 사용합니다.

## Canonical 경로

| 성격 | 경로 | 변경 주체 |
| --- | --- | --- |
| 평가 정의 | `semester_assessment_definitions/{definitionId}` | W2 Command Gateway |
| 학생 응시 | `semester_assessment_attempts/{attemptId}` | start/save/submit 서버 경로 |
| 제출 원본 | `semester_assessment_submissions/{attemptId}` | submit transaction, immutable |
| 자동 판정 결과 | `semester_assessment_results/{attemptId}` | submit transaction, immutable |
| 명령 영수증 | `command_receipts/{receiptId}` | Command Gateway |
| 감사 이벤트 | `command_audit_events/{receiptId}` | Command Gateway |
| legacy 진단 | `assessment_legacy_issues/{issueId}` | 서버 migration/readiness 도구 |

Client의 직접 write는 허용하지 않습니다. 학생이 자기 canonical 문서를 직접 읽는 경로도 열지 않으며, 소유자·학기·권한을 검증하는 query/callable projection을 사용합니다.

## Assessment와 Attempt 식별자

Definition ID는 평가 유형과 semester/source key에서 결정적으로 만듭니다. Attempt ID는 학생 UID, Definition ID, attempt number를 해시한 결정적 ID입니다. 같은 command replay와 동시 시작은 같은 활성 Attempt를 반환합니다.

W6B는 `attemptId`를 제출·자동 결과·공식 성적 근거를 잇는 primary correlation key로 사용하십시오. 학생 이메일·이름·현재 profile class를 join key로 사용하면 안 됩니다.

## Submission snapshot

`semester_assessment_submissions/{attemptId}`에는 다음이 고정됩니다.

- `schemaVersion`, `policyVersion`
- `submissionId`, `attemptId`, `definitionId`
- `semesterId`, `studentUid`
- 최종 `answers`
- `submitReason`
- `attemptRevision`
- `sourceHash`
- `submittedAtIso`
- `receiptId`
- server `createdAt`

이 문서는 제출 답안 원본입니다. W6B가 정정·재채점을 하더라도 원문을 덮어쓰지 마십시오. 정정은 별도 version/evidence 이벤트로 쌓고 원본 reference를 유지해야 합니다.

## Result reference와 현재 의미

`semester_assessment_results/{attemptId}`는 W6A의 provisional auto-evaluation입니다. 주요 필드는 다음과 같습니다.

- `resultId`, `attemptId`, `definitionId`
- `semesterId`, `assessmentKind`, `studentUid`
- `enrollmentId`, `classId`
- `score`, `total`, `percent`, `answerChecks`
- `sourceHash`, `submittedAtIso`
- `submissionRef`, `receiptId`

현재 Result는 공식 성적이 아닙니다. W6B는 이를 `AUTO_EVALUATED_UNOFFICIAL`에 해당하는 입력으로 취급하고, 공식 성적 반영 전 별도 상태·version·승인 근거를 설계해야 합니다.

## 평가 revision과 source provenance

Attempt는 시작할 때 `definitionRevision`, `sourceHash`, `gradingSnapshot`, `questionIds`를 고정합니다. 제출 시 Result도 같은 `sourceHash`를 보존합니다.

W6B 채점은 현재 Definition/source를 다시 읽어 과거 답안을 재해석하면 안 됩니다. Attempt의 grading snapshot과 Submission의 answers/sourceHash를 사용해야 합니다. 공개 뒤 문항 정정이 필요하면 이전 snapshot을 보존한 새 regrade version과 사유·actor·시각을 기록하십시오.

## 학생·학기·Enrollment snapshot

W6A Attempt에는 `studentUid`, `semesterId`, `enrollmentId`, `classId`, `attemptNumber`가 고정됩니다. 이 값은 응시 시작 당시 ACTIVE Enrollment를 서버가 검증한 결과입니다.

W6B는 현재 Student profile의 grade/class를 다시 읽어 공식 성적 대상을 결정하지 마십시오. Enrollment 이동이 있었더라도 제출 당시의 canonical reference를 근거로 삼고, 공식 성적의 반영 scope가 달라진다면 별도 승인 가능한 relocation event가 필요합니다.

## 채점 대상 상태

- `SUBMITTED`: W6B 채점 입력으로 사용할 수 있음
- `STARTED`/`IN_PROGRESS`/`RECOVERABLE`: 공식 채점 대상 아님
- `EXPIRED`/`LOCKED`: 교사 확인 또는 명시적 무효화/재응시 정책 필요
- reset된 Attempt: 원본 보존, 공식 반영 제외 여부를 audit으로 결정
- ARCHIVE: 기존 결과 read-only, 새 제출·수정 금지

W6B는 제출 전 상태를 임의로 SUBMITTED로 올리거나 answers를 채워 넣으면 안 됩니다.

## 자동 채점과 교사 채점

현재 퀴즈 선택형과 역사교실 빈칸은 grading snapshot의 정답과 normalize된 학생 답을 비교해 `answerChecks`를 만듭니다. 이 값은 자동 채점 가능한 영역의 초안입니다.

서술형, 부분 점수, 복수 정답, 교사 판단이 필요한 유형은 W6B에서 별도 rubric/evidence schema를 가져야 합니다. 자동 결과를 수정하는 대신 `grading_version`을 추가하고, item별 awarded score·근거·actor·reason을 기록하십시오.

## 공식 성적 반영 전 상태

권장 흐름은 다음과 같습니다.

`AUTO_EVALUATED_UNOFFICIAL` → `TEACHER_REVIEW_REQUIRED` 또는 `REVIEWED` → `EVIDENCE_LOCKED` → `OFFICIAL_PENDING_SIGNATURE` → `OFFICIAL`

상태 수와 이름은 W6B에서 최종 결정하되, 다음 원칙은 유지해야 합니다.

- 원본 Submission 불변
- 자동 판정과 교사 판정 구분
- 공식 성적 전 preview/validation
- CAS revision과 exactly-once command
- actor, reason, timestamp, evidence reference가 있는 audit
- 공식화 이후 일반 수정 금지

## 근거·정정·서명 요구사항

W6B의 성적 record는 최소 다음 reference를 가져야 합니다.

- `attemptId`, `submissionRef`, `resultRef`
- `definitionId`, `definitionRevision`, `sourceHash`
- `semesterId`, `enrollmentId`, `classId`, `studentUid`
- grading policy/rubric version
- item-level evidence와 total 계산 근거
- teacher reviewer와 reviewedAt
- 정정 이전/이후 값, 정정 사유, 승인자
- 학생·보호자·교사 서명이 필요한 경우 signer, signedAt, signed revision

정정은 기존 official record를 덮어쓰기보다 새 version으로 추가하고 supersedes 관계를 남기는 방식이 안전합니다.

## Archive / Legacy

Archive Submission/Result는 read-only입니다. W6B가 공식 성적 projection을 만들 수는 있지만 원본을 수정하면 안 됩니다.

Legacy 평가는 출처를 `LEGACY`로 표시하고 silent fallback하지 않습니다. canonical Attempt/Submission이 없는 legacy 결과를 공식 성적으로 승격하려면 별도 migration evidence, source provenance, 중복 검사, 관리자 승인이 필요합니다. 손상·중복·unsupported schema는 `assessment_legacy_issues`와 readiness를 통해 fail-closed해야 합니다.

## W6B에서 하지 말아야 할 일

- Submission answers나 submittedAt 덮어쓰기
- 현재 Definition/source로 과거 결과를 무음 재계산
- Student profile class를 canonical Enrollment 대신 사용
- client direct Firestore write 허용
- W6A Result를 즉시 official grade로 간주
- Archive/Legacy 원본 수정
- 응답 유실 재시도에서 두 개의 공식 성적 생성
- W7 Wis 보상이나 W9 공통 draft까지 범위 확장

## W6B Acceptance Test

- 같은 `attemptId`로 공식 성적 record 최대 1개, version 이력 보존
- Submission/Result 원본 hash가 W6B 전후 동일
- 자동 채점과 교사 채점 근거를 구분해 조회 가능
- item별 점수 합과 total의 결정적 재현
- stale grading revision/CAS 거부
- 동시 검토·동시 공식화 effect 1회
- commit 후 응답 유실 시 receipt로 같은 결과 복구
- 권한 없는 교사·다른 학생 접근 거부
- ACTIVE Enrollment snapshot과 현재 Enrollment가 달라도 제출 당시 provenance 보존
- Archive write 0, Legacy silent fallback 0
- 정정 전후 값·사유·actor·승인·서명 추적 가능
- 공식 성적 전환 전 readiness와 blocking evidence 검증
- W2~W6A 회귀, TypeScript 신규 오류 0, Production 변경 0

## W6A 검증 기준

W6A 최종 aggregate는 direct-write boundary 163 groups/UNKNOWN 0, lifecycle unit 23 cases, integration 22 cases, A01~A08 두 평가 유형, W2~W6A emulator 회귀, build, TypeScript 63 errors/13 files baseline, format을 통과했습니다. W6B는 이 suite를 유지한 채 성적·근거 검증을 추가해야 합니다.
