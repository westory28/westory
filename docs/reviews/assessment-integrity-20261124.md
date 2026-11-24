# 평가 마감 뒤 답안 변경·선지 단서 보호와 생각모아 참여 위스

기준: 2026-11-24, `7898713b7e48df81e4d2f816d5bdabf07ff68744`.
`origin/main`, Vercel 운영 배포, 운영 Firestore·Storage 규칙이 이 커밋과 같음을 확인한 뒤 별도 작업 공간에서 수정했다.

## 원인과 변경

- **마감 뒤 답안 변경.** 서버는 제출 사유가 `TIMEOUT`이면 마감 시각을 검사하지 않고 요청의 답안을 그대로 채점했다. 화면도 시간 초과 제출이 실패하면 답안을 계속 고칠 수 있었다.
  - 화면: 제한 시간이 지나면 답안 입력을 잠근다. 제출·재제출 버튼은 그대로 쓸 수 있고 마감 당시의 답안을 보낸다.
  - 서버: 문제 풀이·모의고사(`QUIZ`)의 `TIMEOUT` 제출이 마감 5분 이후에 도착하면 마감 전에 저장된 답안으로 채점한다. 5분 이내 도착분, 학생의 직접 제출, 역사교실 제출은 기존과 같다. 운영 `saveAssessmentProgress`는 마감 뒤 저장을 거부하므로 저장 답안은 항상 마감 전 상태다.
  - 마감 직전의 답안이 저장되지 못하는 일을 줄이려고, 마감이 가까우면 자동 저장을 마감 0.8초 전까지 앞당긴다. 그 밖의 저장 주기(1.5초)는 같다.
  - 서버가 저장 답안으로 채점해 화면의 답안과 달라지면 학생에게 한 번 알린다.
- **선지 단서.** 응시 시작·복원 응답의 `learningSnapshot`에 선지별 혼동 태그(`misconceptionTags`)가 들어 있었다. 오답 선지에만 태그가 있으면 정답을 추정할 수 있다. 제출 전 응답에서는 이 항목을 제외한다. 저장된 응시·결과 문서와 제출 후 조회는 그대로 두어 복습과 교사 분석에 쓴다.
- **생각모아 참여 위스.** 세션 문서는 대상 학급을 `targetClassId`로 저장하는데 지급 확인은 `classId`만 읽어 현재 방식의 세션에서는 항상 거부되었다. 대상 학급 필드를 우선 확인하고 이전 형식도 인정한다. 최근 30일 운영 요청 기록에는 이 함수의 거부 응답이 없었다.

채점 기준, 보상 금액·횟수, 응시 횟수, 문항·결과 문서 형식, 규칙, 공개 범위는 바꾸지 않았다. 새 AI 호출·외부 전송·개인정보 항목은 없다.

## 운영상 달라지는 점

- 마감 뒤 5분이 넘도록 제출이 전달되지 못한 학생은, 그동안 저장되지 못한 답안이 채점에 반영되지 않는다. 화면이 이를 알리며, 필요하면 교사가 기존 응시 초기화로 다시 응시하게 한다. 해당 여부는 제출 문서의 `submitReason`이 `TIMEOUT`이고 `submittedAtIso`가 `deadlineAtIso`보다 5분 넘게 늦은지로 확인한다.
- 단말 시계를 늦춰 얻을 수 있는 추가 시간은 최대 5분이다. 그 사이의 자동 저장은 서버가 거부한다.
- 제출 전에는 화면이 혼동 태그를 받지 않는다. 응시 화면은 이 값을 쓰지 않았다.

## 검증

- `functions/productionGateway/scripts/verify-assessment-lifecycle.cjs`: 마감+5분 이내의 시간 초과 제출은 요청 답안, 초과분은 저장 답안으로 채점하며 역사교실은 기존과 같음을 검사한다.
- `functions/productionGateway/scripts/verify-assessment-learning.cjs`: 시작 응답과 진행 중 조회에는 태그가 없고, 저장 문서·제출 응답·제출 후 조회에는 남아 있음을 검사한다.
- `scripts/verify-quiz-history-identity.mjs`: 실제 입력 처리 함수가 마감 뒤에는 답안을 바꾸지 않음을 검사한다.
- `scripts/verify-mock-exam-runner-browser.mjs`: 최근 화면 변경으로 실행되지 않던 검사 연결을 복구했다. `--deadline-lock-only`는 마감 전 입력 가능, 마감 후 잠금, 앱 밖에서 입력란을 다시 켜도 답이 바뀌지 않음, 실패한 시간 초과 제출의 재제출이 같은 답안을 보내는지 실제 브라우저에서 확인한다. 화면 수정을 빼면 이 검사가 실패한다. 전체 실행도 통과했다.
- `functions/scripts/verify-student-learning-reward.cjs`(전용 demo Firestore): 현재 형식 세션의 지급, 다른 학급·학급 정보 없는 세션의 거부, 이전 형식 인정을 포함해 27개 묶음 통과.
- `npm run build`, `npm --prefix functions run check` 통과.
- 운영 원본에 수정만 적용한 배포본에서 운영 시점의 기존 검사와 위 추가 검사를 통과했다.
- `verify-mock-exam-paper-interaction.mjs`, `verify-quiz-choice-columns.mjs`, `verify-quiz-content-protection.mjs`는 기준 커밋에서도 검사 준비 단계의 같은 오류로 실행되지 않는다. 이번 변경과 무관하며 고치지 않았다.

독립 검토에서 처음 정한 2분 유예가 학급 전체 동시 마감 때의 재시도 시간을 감당하기에 짧다는 지적을 받아 5분으로 늘리고, 마감 직전 저장과 학생 안내를 추가했다. 함께 검토한 권한 설정의 교사 역할 처리는 기존 동작을 유지하기로 하고 변경하지 않았다.

## 배포

- 서울 `executeCommand`, `getAssessmentState`: 두 함수의 운영 원본은 저장소와 다른 파일이 있으므로 `scripts/prepare-assessment-integrity-release.mjs prepare`로 각 운영 ZIP에 `productionGateway/assessmentLifecycle.js`의 검토한 치환만 적용한다. 스크립트는 운영 파일의 나머지 줄이 그대로임을 확인한다. `preflight` 통과 후 함수별로 선택 배포하고 `verify`로 전체 파일 해시·자원 설정·호출 권한을 대조한다.
- 서울 `claimStudentLearningReward`: `scripts/prepare-learning-reward-release.mjs`의 같은 순서로 이 함수 하나만 배포한다.
- `saveAssessmentProgress`, `getCommandStatus`, 규칙, 색인은 배포하지 않는다. 화면 변경은 같은 main의 Vercel 운영 배포로 반영한다.
