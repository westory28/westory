# 수업 자료 빈칸 중복 답안

- 기준: `d2dbbe13682ec3147552bb45894b4fb16d476121`, 2026-11-07. 기존 작업 보호를 위해 별도 worktree에서 수정했다.
- 작업 중 main에 반영된 `7943bd63`의 퀴즈 메뉴 변경은 충돌 없이 fast-forward로 포함했다. 해당 파일은 이번 패치에서 수정하지 않았다.
- 기존 `answer`는 OCR/첫 입력의 기본 정답으로 유지한다. 교사가 빈칸을 클릭하면 기본 정답과 별도 `alternativeAnswers`를 편집한다. OCR 오인식의 기본 정답 수정 기능도 유지한다. 중복 답안은 한 줄에 하나, 최대 20개, 각 2,000자다. 공백·띄어쓰기만 다른 항목과 기본 정답의 중복은 정리한다.
- 학생의 blur 피드백, 페이지를 넘겨 숨겨진 답안의 제출, 서버 확정 채점에서 기본·중복 정답을 모두 인정한다. 기존 대소문자 구분과 띄어쓰기 무시 기준을 유지한다. 중복 답안을 지우면 이후 채점부터 제외하며 과거 제출 기록을 일괄 수정하지 않는다.
- 저장은 기존 학기별 `executeCommand`의 `saveLessonDocument`를 사용한다. 학생은 기존 `saveLessonAnswers`에 값만 보낸다. 학기·역할·등록 상태·학생 공개·content/answer revision 검증과 기존 조회 경로를 유지한다. 새 legacy fallback은 없다.
- 교사 편집창의 기존 색상·간격·입력 스타일을 재사용했다. 작은 높이에서 창 내부 스크롤을 제공한다. 수업 단원 탐색 목차는 기존 계층 탐색 예외를 유지한다. 학생 화면 개편, 빈칸 크기·마스킹·OCR 처리, 교사 제시 모드와 폐기된 판서 기능 변경은 없다.
- 런타임 AI 호출·에이전트 실행·외부 데이터 전송 변경이 없다. 기존 서비스의 빈칸 입력·채점 유지보수이며 이용자·공개 범위·개인정보·인증/권한·저장 위치 확장은 없다. 기관 보안성 검토의 승인·면제 판단을 새로 주장하지 않는다.

## 검증

- `node scripts/verify-lesson-progress-answers.mjs`: 정규화·저장 형식 왕복, 기존 빈칸 호환, 기본/중복/오답/미응답 판정, 숨겨진 페이지 답안 보존.
- `node scripts/verify-lesson-alternative-answers-browser.mjs`: 실제 교사 편집/학생 풀이 컴포넌트를 합성 데이터로 실행. 390/768/1280px와 390×420px에서 편집·적용·재열기·취소·삭제, 기본 정답 보존, 즉시 채점·다른 페이지 저장, 교사 제시 모드 확인. 서버 어댑터는 로컬 모의 응답이며 실제 운영 자료에 쓰지 않는다.
- `node scripts/verify-lesson-management-client.mjs`: 기존 세션·학기·revision·저장 응답 복구 23개 검사 통과.
- `node scripts/verify-lesson-annotations-retired.mjs`: 각 모드/390·768·1280px의 판서 폐기 및 페이지 이동 회귀 통과.
- `npm --prefix functions run check`: 새 서버 채점·입력 제한·위조 입력·기존 권한 회귀 7개를 포함해 통과.
- `npm run build`: 타입 검사와 필수 전체 회귀 검사 및 Vite 빌드 통과. 변경된 TS/TSX 5개 파일의 Prettier 검사도 통과했다.

## 배포 범위와 사전 대조

- 운영 프론트엔드 `dpl_CxyFZyiXSxbRNF5GKmsqYXhs5HrR`의 Source commit은 기준 `d2dbbe13`과 일치했다.
- 운영 서울 `executeCommand`의 원본을 2026-11-07 17:06 KST에 다시 내려받아 비교했다. 현재 ACTIVE 배포의 updateTime은 `2026-11-07T05:56:36.667575464Z`이며, 추적 중인 비시험 JS/JSON 104개가 LF 정규화 후 기준 커밋과 모두 일치했다. 원본과 상세 대조는 로컬 `tmp/lesson-alternative-source/`에만 보관한다.
- Firebase 배포는 서울 `executeCommand`만 대상이다. 명령 이름·상태 조회 allowlist·rules·Storage 변경이 없어 다른 함수나 규칙을 배포하지 않는다. 프론트엔드는 main의 검증된 Vercel 배포를 운영에 승격하고 `방재석` Chrome 프로필로 실제 빈칸 편집창을 확인한다.
- `firebase deploy --only functions:executeCommand --project history-quiz-yongsin` 성공. Node 22.23.4와 `FUNCTIONS_DISCOVERY_TIMEOUT=60`을 사용했고 배포 전 전체 Functions 검사도 재통과했다.
