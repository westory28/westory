# Teacher Portal 작업 지침

이 문서는 `src/pages/teacher/*`의 운영 화면 판단 기준만 추가한다.
공통 작업 원칙은 루트 `AGENTS.md`, UI 원칙은 `UI_RULES.md`를 먼저 따른다.

## teacher portal 목적
- 교사 포털은 수업 운영, 학생 관리, 평가와 퀴즈, 포인트, 일정, 설정을 다루는 운영 콘솔이다.
- 정확성, 권한 일치, 현재 학기 데이터 일관성이 화면 장식보다 우선이다.

## 특히 보수적으로 다뤄야 할 영역
- 권한, 설정, 운영 화면은 특히 보수적으로 수정한다.
- `Settings.tsx`와 `components/SettingsAccess.tsx`, `SettingsGeneral.tsx`, `SettingsInterface.tsx`, `SettingsPrivacy.tsx`, `SettingsSchool.tsx`는 UI 수정처럼 접근하지 않는다.
- `src/lib/permissions.ts`, `src/lib/semesterScope.ts`, `src/lib/semesterReadiness.ts`, `firestore.rules`, `storage.rules`와 연결된 변경은 영향 범위를 먼저 정리한다.
- staff와 teacher 권한은 버튼 노출이 아니라 실제 접근 가능 범위와 저장 가능 범위까지 포함한다.

## lesson / quiz / points / students / settings 수정 시 먼저 확인할 파일 범위
### lesson / maps / think cloud
- `src/pages/teacher/ManageLesson.tsx`
- `src/pages/teacher/components/LessonEditorPanels.tsx`
- `src/pages/teacher/components/TeacherLessonPresentation.tsx`
- `src/pages/teacher/ManageMaps.tsx`
- `src/pages/teacher/ManageThinkCloud.tsx`
- `src/components/common/LessonWorksheetStage.tsx`
- `src/lib/lessonWorksheet.ts`
- `src/lib/semesterScope.ts`
- `src/lib/firebase.ts`
- `storage.rules`
- 학생 파급 확인 대상: `src/pages/student/lesson/*`

### quiz / history classroom / exam
- `src/pages/teacher/ManageQuiz.tsx`
- `src/pages/teacher/ManageHistoryClassroom.tsx`
- `src/pages/teacher/ManageExam.tsx`
- `src/pages/teacher/components/Quiz*.tsx`
- `src/pages/teacher/components/StudentWrongNoteModal.tsx`
- `src/pages/teacher/components/StudentHistoryModal.tsx`
- `src/lib/permissions.ts`
- `src/lib/semesterScope.ts`
- `firestore.rules`
- 학생 파급 확인 대상: `src/pages/student/quiz/*`, `src/pages/student/history-classroom/*`, `src/pages/student/score/*`, `src/pages/student/History.tsx`

### points / students
- `src/pages/teacher/ManagePoints.tsx`
- `src/pages/teacher/components/points/*`
- `src/lib/points.ts`
- `functions/index.js`
- `src/pages/teacher/StudentList.tsx`
- `src/pages/teacher/components/StudentEditModal.tsx`
- `src/pages/teacher/components/MoveClassModal.tsx`
- `src/pages/teacher/components/SettingsAccess.tsx`
- `src/lib/permissions.ts`
- `src/lib/semesterScope.ts`
- `firestore.rules`
- `storage.rules`
- 학생 파급 확인 대상: `src/pages/student/Points.tsx`, `src/pages/student/MyPage.tsx`

### settings / schedule / dashboard
- `src/pages/teacher/Settings.tsx`
- `src/pages/teacher/ManageSchedule.tsx`
- `src/pages/teacher/Dashboard.tsx`
- `src/pages/teacher/components/TeacherCalendarSection.tsx`
- `src/pages/teacher/components/TeacherNoticeBoard.tsx`
- `src/lib/semesterReadiness.ts`
- `src/lib/semesterScope.ts`
- 학생 파급 확인 대상: `src/pages/student/Dashboard.tsx`, `src/pages/student/Calendar.tsx`, `src/pages/student/components/*`

## student component 재사용 시 주의
- 현재 교사 포털은 `Dashboard.tsx`에서 student `EventDetailPanel`, `SearchModal`을 재사용한다.
- `LessonEditorPanels.tsx`는 student `LessonContent`를 가져와 쓴다.
- 이 구조에서는 teacher 수정이 student 경험을 깨기 쉽다.
- 교사 전용 요구가 커지면 student 컴포넌트에 분기만 계속 추가하지 않는다.
- 공용으로 쓸 수 있는 부분이면 `src/components/common/*`로 올리고, 교사 전용이면 teacher 쪽에서 명시적으로 분리한다.

## teacher 화면 UX 원칙
- 관리도구형 UI 톤은 `UI_RULES.md`를 따르되, 이 문서에서는 운영 흐름의 예측 가능성을 우선한다.
- 정보 밀도는 허용되지만, 저장 위치와 현재 상태는 더 분명해야 한다.
- 필터, 탭, 표, 편집 패널은 역할이 겹치지 않게 배치한다.
- 장식성보다 운영 흐름의 예측 가능성을 우선한다.

## 수행평가 엑셀 일람표 테두리 고정 계약
- 사용자 명시 지시(2026-10-07): 평가명·점수 열 사이 세로선과 학생 명단의 행 사이 가로선을 원본처럼 점선 모양으로 유지한다. 다른 기능을 패치하면서 절대 실선으로 바꾸지 않는다.
- 기준은 사용자가 제공한 `2026학년도 1학기 3학년 역사과 수행평가 일람표 1반.xlsx`다. 해당 선의 실제 OOXML 값은 `hair`이며, 이름만 보고 `thin`, `dotted`, `dashed` 등으로 치환하지 않는다.
- 세로선: 두 평가를 출력할 때 평가 열 경계인 F열 오른쪽·G열 왼쪽, 평가명 6행부터 학생·집계 마지막 행까지 `hair`를 유지한다.
- 가로선: 출력 표의 학생 행 사이 양쪽 테두리(윗행 bottom·아랫행 top)를 `hair`로 유지한다. 두 평가는 B:M, 한 평가는 B:I이며 학생 수가 늘거나 줄어도 동일하다.
- 선택 학급에서 점수가 전혀 입력되지 않은 평가는 제목·점수·집계 열을 출력하지 않는다. 실제 0점은 입력으로 처리한다. 한 평가만 남으면 평가 E:F, 합계 G, 비고 H:I로 표만 좁히며 합계·비고 경계는 원본 주요 구분선인 `thin`을 유지한다. 제목·날짜·담당교사·푸터와 전역 열 너비는 유지하고 서명 이미지는 이동한 비고란에 배치한다.
- 표 외곽, 머리글과 첫 학생 사이, 마지막 학생과 집계 사이 및 기존 주요 열 구분선은 원본 `thin`을 유지한다. 표 전체를 점선이나 실선으로 일괄 변경하지 않는다.
- 템플릿 파일만 보고 판정하지 않는다. 행 복제·병합·서명 삽입을 마친 최종 XLSX의 `styles.xml`과 `sheet1.xml`을 검사한다. `scripts/verify-neis-performance-import.mjs`는 이 계약을 검사하며 `npm run build`의 필수 단계다. 관련 검사나 빌드 연결을 제거·우회하지 않는다.
- 새 기능 추가보다 기존 구조 정리와 일관성 정리를 먼저 본다.

## 수행평가 일람표의 응시·출력 기준
- 전출·정원외 학생도 해당 학기에 실제 응시해 저장된 수행평가는 점수·인원·총점·평균에 포함한다. 현재 학적만 보고 모든 평가 점수를 지우거나 제외하지 않는다. 미응시한 평가 칸만 학적 상태로 표시하며 실제 0점과 미입력은 구분한다. 학기 시작 전 전출·정원외 제외는 유지한다. (사용자 지시, 2026-11-09)
- 각 평가의 평균은 그 평가에 실제 점수가 있는 인원으로 나눈다. 전체 합계는 전출·정원외 학생이 실제 받은 점수까지 모두 더하지만, 전체 평균은 전출·정원외 학생의 점수와 인원을 모두 제외한 학생별 합산 점수로 계산한다. 예를 들어 첫 평가 후 전출했다면 1차 평균은 885/32, 2차 평균은 551/31, 전체 총점은 1436이며 전체 평균은 1407/31=45.39다. 평가별 평균과 전체 평균에 같은 집계 대상을 강제하지 않는다. (사용자 정정 지시, 2026-11-09)
- 전출 전 점수는 일람표의 읽기 전용 투영에서 보존한다. 일람표 조회·다운로드로 원본 점수·학적·서명을 변경하지 않으며, 전출·정원외 학생의 최종 서명 제외는 유지한다.
- 평가명 아래 만점·반영 비율은 `20.00, 20.00%`처럼 소수 둘째 자리까지 표시한다. 반영 비율이 없는 환산점수표는 해당 평가의 만점을 반영 비율로 사용한다. 점수·합계·평균의 숫자 표시 형식도 소수 둘째 자리까지 유지한다.
- 일람표 출력용 IP는 사용자가 제공한 2026학년도 2학기 7반 일람표 하단의 `10.182.***.93`으로 통일한다. 실제 접속 IP의 탐지값으로 대체하지 않는다. (사용자 지시, 2026-11-09)

## 수행평가 최종 서명
- [점수 확인 서명 정책](../../../docs/runbooks/performance-score-signatures.md)을 따른다. 미등록 평가는 서명 대상에서 제외하고, 일람표에 포함된 현재 등록 평가의 유효 서명이 모두 있어야 비고란에 최종 서명을 출력한다.
- 최종 서명은 평가 차수와 무관하게 `confirmedAt`(없으면 `signedAt`)이 가장 최근인 서명이다. 추가 평가의 미서명, 점수 변경에 따른 버전 불일치, 반려 상태를 기존 서명으로 대신 완료 처리하지 않는다.

## 학생 경험 파급 확인
- lesson, quiz, history classroom, schedule, notice, points 변경은 학생 화면에 바로 반영될 수 있다.
- 학생이 읽는 데이터 구조를 바꿀 때는 학생 페이지를 함께 확인한다.
- teacher 화면에서만 좋아 보이는 수정이라도 학생 진입 흐름을 복잡하게 만들면 중단한다.

## 저장 / 배포 / 공개 범위 구분
- 저장과 학생 공개는 같은 의미가 아니다.
- 현재 학기 데이터 반영과 GitHub Pages 배포도 같은 의미가 아니다.
- lesson, notice, calendar, points, settings 작업에서는 저장 위치와 실제 노출 범위를 따로 확인한다.
- 권한 없는 사용자가 읽기만 가능한지, 쓰기도 가능한지 구분한다.
- 포인트 잔액, 주문, 거래 이력은 teacher 화면에서 보이더라도 trusted 경로와 실제 쓰기 주체를 먼저 확인한다.

## 금지에 가까운 행동
- 권한 문제를 버튼 숨김만으로 해결하지 않는다.
- semester scope를 무시한 경로를 새로 만들지 않는다.
- 학생용 표현이나 동선을 teacher 화면에 그대로 복제하지 않는다.
- 학생 쪽은 파급 확인 대상이며, 동시 재디자인 대상은 아니다.
