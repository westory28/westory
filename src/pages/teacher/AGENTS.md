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
- 새 기능 추가보다 기존 구조 정리와 일관성 정리를 먼저 본다.

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
