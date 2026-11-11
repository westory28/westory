# 학생 수업자료 조회 안정화 — 2026-11-11

기준 커밋은 `596cedc5402e8d0cac23f228ddd37f2e0a04de66`입니다. 학생의 목차 → 단원 → 학습지/PDF 페이지 → 재진입과 통신 실패 복구를 실제 컴포넌트와 합성 서비스로 검사했습니다. 운영 학생 자료 조회·쓰기, 부하 시험, 커밋, 배포는 이 작업자가 수행하지 않았습니다.

## 재현한 문제와 수정

- 일반 수업자료는 본문 통신 실패 후 다시 불러오기 버튼이 없었습니다. 기존 복습 팝업의 재시도 버튼을 일반 화면에서도 사용합니다.
- 저장 답안 조회 실패가 일반 화면에서는 표시되지 않아 빈 학습지로 보였습니다. 실패 안내와 재시도 버튼을 표시하고, 복구 전 입력과 저장 도구를 감춥니다. 기존 서버 답안 revision 검사는 유지합니다.
- 본문 실패 후 재시도할 때 DOM이 아직 붙지 않았으면 답안 조회 자체가 생략되었습니다. 답안 조회는 DOM 생성과 분리하고, 복구한 본문 빈칸 값은 DOM commit 뒤 반영합니다. 계정·학기·단원과 입력 revision이 달라진 응답은 새 입력을 덮어쓰지 않습니다. PDF 학습지 값도 기존 상태 경로로 복구합니다.
- 본문 조회 effect가 전체 설정 객체에 의존하여 학기와 무관한 설정 갱신에도 초안을 초기화할 수 있었습니다. 조회 의존성을 학년도·학기로 제한하고 인증 사용자 변경은 별도로 확인합니다.
- 초기 전체 진도 조회가 별도 effect와 개별 답안 복원 완료에서 각각 발생했습니다. 전체 진도 조회 결과에 포함된 현재 단원의 저장 핵심포인트와 현재 화면의 확인된 핵심포인트를 합쳐 계산하므로 추가 조회가 필요하지 않습니다. 단원 전환 중 이전 본문의 진도 조회도 차단했습니다.
- 전체화면처럼 본문을 전달받는 `lessonOverride` 화면은 답안 복원 재시도가 본문 조회를 다시 실행해도 복원 effect로 이어지지 않았습니다. 답안 전용 재시도 상태를 복원 effect에 연결하고, 읽는 동안 재시도 버튼을 비활성화합니다. 전달된 본문의 최초 정규화 결과도 재사용해 중복 복원 조회를 막습니다.

## 실제 요청 수

실제 `Note`, `LessonContent`, `studentLessonReadCache`를 사용했습니다. Firebase·학습 명령은 합성 서비스로 대체했고 외부 네트워크 요청은 모두 차단했습니다.

| 요청 | 수정 전 최초 진입 | 수정 후 최초 진입 | 수정 후 A → B → A 누적 |
| --- | ---: | ---: | ---: |
| 공개 목차 catalogue callable | 1 | 1 | 1 |
| 선택 단원 본문 callable | 1 | 1 | 2 |
| 진도 계산용 catalogue callable | 1 | 1 | 1 |
| 본인 progress root 문서 | 2 | 1 | 3 |
| 본인 progress units 목록 | 2 | 1 | 3 |
| 선택 단원 답안 문서 | 1 | 1 | 3 |

최초 진입에서 본인 단원 진도 문서가 N개일 때 **N+1 문서 읽기**를 제거합니다. 빈 목록의 최소 과금 등 실제 Firestore 청구는 별도입니다. 서버 필드 projection이 줄이는 것은 전송량이며, 반환 문서 수 자체를 줄였다고 계산하지 않았습니다. 목차·진도 목록은 임의 limit로 자르지 않습니다.

학습지/PDF 페이지 1 → 2 → 1 전환과 `visibilitychange`/`pageshow` 이벤트는 추가 업무 조회 0회입니다. 본인 답안은 재진입마다 다시 확인하여 최신 저장 상태와 CAS revision을 확보합니다.

전체화면에서 저장 답안 조회 실패 후 재시도는 답안 문서 1회, 본문 callable 0회입니다. 재시도가 진행되는 동안 버튼을 8회 다시 눌러도 추가 조회는 0회였으며, 복원 완료 후 본문과 학습지 입력값을 확인했습니다.

증거:

- `output/broad-stability-20261111/lessons/baseline-browser.json`: 수정 전 root/units 각 2회 재현
- `output/broad-stability-20261111/lessons/patched-browser.json`: 수정 후 각 1회와 단원 재진입 수
- 같은 폴더의 `progress-error-390.png`, `progress-error-768.png`, `progress-error-1280.png`: 일반 화면 복구 안내, 버튼, 가로 넘침 없음
- 기존 팝업 최종 회귀 증거: `%TEMP%/westory-lesson-popup-Gi4RNY`
- 각주 회귀 증거: `output/lesson-footnotes-browser`

## 검증 결과

- `node scripts/verify-student-lesson-read-flow-browser.mjs`: 정상 진입, 본문 실패·재시도, 답안 실패·재시도, 본문/PDF 빈칸 복구, 전체화면의 답안 전용 재시도와 진행 중 중복 클릭 차단, 계정·학기 변경, 이전 계정의 늦은 본문 응답, 늦은 답안 응답과 새 입력, 무관한 설정 변경 중 초안 보존, 페이지 왕복, 재진입, 이벤트 중복 조회 없음. 390/768/1280px 오류 안내 검증 통과. 운영·외부 요청 0건, 학생 저장 명령 0건.
- `node --test functions/scripts/verify-student-lesson-read-budget.cjs`: 11개 검사 통과. 학생 canonical 학기·슬롯·등록·학급의 15가지 거부 조건은 수업자료 source 조회 전 종료합니다. 501개 추가 단원이 있는 목록도 누락하지 않습니다. 최신 다른 학급용/숨김/삭제 학기 자료가 이전 공개본이나 legacy 자료로 우회되지 않습니다.
- `node scripts/verify-student-lesson-queries.mjs`: 기존 UID/User 객체/auth_time/학기 경계, TTL 만료, 오류 재시도, 오래된 실패의 새 캐시 삭제 방지, catalogue 공유와 상세 단원 조회 통과.
- `node scripts/verify-student-map-resources.mjs`: 기존 9개 지도 자료 병합·계정/학기 격리·TTL·중복·실패 복구 검사 통과.
- `node scripts/verify-quiz-lesson-popup-browser.mjs`: 기존 390/768/1280px 복습 팝업, 숨겨진 방문 자료의 초안 유지, 다섯 번의 제한된 조회, 명시 저장, 계정/학기 초기화, 키보드·포커스 회귀 통과.
- `node scripts/verify-lesson-progress-answers.mjs`: 페이지별 답안 snapshot 회귀 통과.
- `node scripts/verify-lesson-loading.mjs`: 교사 편집·PDF 준비·OCR·각주·오류/재시도·권한 경계 회귀 통과.
- `node scripts/verify-lesson-footnotes-browser.mjs`: 실제 학습지 각주 9개 사례 통과.
- `node scripts/verify-lesson-image-protection-browser.mjs`: 390/768/1280px 학생·전체화면·교사 미리보기 회귀 통과.
- `npm run typecheck`, 변경 TS/브라우저 검사 스크립트의 Prettier 검사, `git diff --check`, 서버 검사 스크립트 구문 검사 통과.
- 통합 앱 빌드와 운영 반영은 root의 합산 배포 절차에서 확인합니다.

## 변경 범위와 유지한 경계

실행 코드 변경은 `src/pages/student/lesson/components/LessonContent.tsx`입니다. 검증 파일은 신규 `scripts/verify-student-lesson-read-flow-browser.mjs`와 기존 `functions/scripts/verify-student-lesson-read-budget.cjs`입니다. 이 문서 외 다른 사람의 로딩·대시보드·학습지 대체정답 작업은 수정하지 않았습니다.

`LessonContent`를 재사용하는 교사 미리보기는 `disablePersistence`와 `lessonOverride` 경계를 유지합니다. 교사 편집/제시 로직, 폐기된 판서, Firebase rules, 공통 로그인, 서버 권한, 학생 점수·포인트 명령, 저장 API는 변경하지 않았습니다. AI 호출·외부 전송·개인정보 항목도 추가하지 않았습니다.

기존 수업자료 캐시는 동일 User 객체/auth_time/UID/학기에서 60초간 재사용하며 오류를 캐시하지 않습니다. 이번 작업은 이 만료 계약을 변경하거나 열린 화면에 새로운 polling/실시간 구독을 추가하지 않습니다. 공개·배정 변경은 서버의 새 조회와 기존 저장 명령에서 검사되며, 이미 받은 본문을 즉시 회수하는 기능을 추가했다고 주장하지 않습니다.

서버 실행 파일 `functions/studentLessonAccess.js`는 수정하지 않았으므로 별도 백엔드 배포가 필요하지 않습니다. 향후 이 함수 변경을 배포할 경우 현재 운영 archive와의 차이를 먼저 확인하고 해당 함수 변경만 이식해야 합니다.
