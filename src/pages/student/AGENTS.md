# Student Portal 작업 지침

이 문서는 `src/pages/student/*`의 학습 화면 판단 기준만 추가한다.
공통 작업 원칙은 루트 `AGENTS.md`, UI 원칙은 `UI_RULES.md`를 먼저 따른다.

## student portal 목적
- 학생 포털은 학습과 확인을 빠르게 이어 주는 화면이다.
- 학생은 지금 무엇을 해야 하는지 바로 이해할 수 있어야 한다.
- 수업자료, 퀴즈, 역사교실, 성적, 포인트, 내 정보, 일정은 모두 내 학습 흐름 관점에서 보여준다.

## 학생 화면 기본 원칙
- 선택지 과다, 시각적 소음, 복잡한 관리 UI 혼입을 금지한다.
- 한 화면에서 학생이 해야 할 대표 행동을 먼저 보이게 한다.
- 학생은 첫 화면 3초 안에 지금 무엇을 해야 하는지 이해할 수 있어야 한다.
- 설명보다 구조로 이해되게 만든다.
- 학생 화면은 teacher 화면보다 더 적은 컨트롤과 더 낮은 정보 밀도를 유지한다.
- 교사용 관리 패턴을 학생 화면에 그대로 끌고 오지 않는다.

## teacher 기능과 운영 용어 노출 금지
- 권한, staff, readiness, 공개 범위, 운영 정책, 설정, 배포 같은 운영 용어를 학생 UI에 직접 노출하지 않는다.
- teacher 전용 버튼, 편집 affordance, 다중 필터, 관리 탭을 학생 화면에 섞지 않는다.
- teacher 화면의 표 중심 UI를 학생 화면에 그대로 복제하지 않는다.

## 학습 흐름 원칙
### lesson / maps / think cloud
- 학생은 읽기, 보기, 참여하기 흐름을 바로 이해할 수 있어야 한다.
- 수업자료와 PDF는 학습 흐름을 방해하지 않게 유지한다.
- 학습지 관련 shared component를 수정할 때는 `student-solve` 흐름을 먼저 지킨다.
- teacher용 편집 도구와 제시 도구를 student 화면에 노출하지 않는다.

### quiz / history classroom
- 시작, 진행, 제출, 결과 확인 흐름을 단순하게 유지한다.
- 시험 설정, 문제 관리, 운영 상태 개념을 학생에게 보여주지 않는다.
- 결과 화면은 다음 행동이 분명해야 한다.

### score / history
- 학생이 자신의 결과를 이해하는 데 필요한 정보만 보여준다.
- 운영용 식별자, 내부 상태, 관리용 설명을 끌고 오지 않는다.

### my page / points / calendar / dashboard
- 내 정보와 내 상태를 빠르게 확인할 수 있게 만든다.
- 다른 학생 데이터, 운영자용 제어, 불필요한 꾸미기를 넣지 않는다.
- 포인트는 내역, 상점, 주문 흐름이 헷갈리지 않게 유지한다.

## 로그인 / 세션 / 개인정보 특별 주의
- `src/pages/Login.tsx` 수정은 학생 UI 수정으로 가볍게 보지 않는다.
- 로그인, 역할 판별, 온보딩, 세션 유지, 개인정보 입력 흐름은 특히 보수적으로 수정한다.
- `src/lib/firebase.ts`, `src/contexts/AuthContext.tsx`, `src/components/layout/MainLayout.tsx`와 함께 영향 범위를 본다.
- 학생의 이름, 학년, 반, 번호, 개인 기록을 다루는 화면에서는 표시 항목을 불필요하게 늘리지 않는다.
- 브라우저 저장소와 임시 저장은 세션 연속성과 학습 지속에 필요한 범위 안에서만 보수적으로 사용한다.

## 함께 확인할 파일 범위
- lesson 계열 수정: `src/pages/student/lesson/*`, `src/components/common/LessonWorksheetStage.tsx`, `src/lib/lessonWorksheet.ts`, `src/lib/semesterScope.ts`, 필요 시 `src/pages/teacher/ManageLesson.tsx`, `src/pages/teacher/components/TeacherLessonPresentation.tsx`
- quiz / history classroom / score 수정: `src/pages/student/quiz/*`, `src/pages/student/history-classroom/*`, `src/pages/student/score/*`, `src/pages/student/History.tsx`, `src/lib/semesterScope.ts`, 필요 시 teacher 관리 페이지
- points / my page / dashboard / calendar 수정: `src/pages/student/Points.tsx`, `src/pages/student/MyPage.tsx`, `src/pages/student/Dashboard.tsx`, `src/pages/student/Calendar.tsx`, 관련 `src/lib/*`
- 로그인 / 세션 수정: `src/pages/Login.tsx`, `src/lib/firebase.ts`, `src/contexts/AuthContext.tsx`, `src/components/layout/MainLayout.tsx`

## 공용화 원칙
- student 화면에서 반복되는 패턴은 먼저 student 내부에서 단순화한다.
- 학생과 교사 양쪽에 필요한 패턴이면 `src/components/common/*`로 올린다.
- teacher 폴더 컴포넌트를 student 화면에서 가져다 쓰지 않는다.
- 공용화는 학생 흐름을 복잡하게 만들지 않는 범위에서만 한다.

## 데이터 / 권한 / 범위 원칙
- 학생 UI는 기본적으로 현재 학기와 자기 UID, 자기 반 기준으로 읽는 화면이어야 한다.
- 학기 범위와 데이터 소스는 내부 구현이다. 학생에게는 `현재 학기`, `내 기록` 같은 의미 단위로만 드러낸다.
- 학생 쓰기 권한은 자기 프로필 일부, 자기 기록, 자기 제출, 자기 임시 데이터 수준이라는 전제를 유지한다.

## 금지에 가까운 행동
- 학생 화면에 teacher용 관리 탭, 테이블, 설정 패널을 넣지 않는다.
- 학생 화면을 정보 과다 대시보드로 만들지 않는다.
- semester scope, 로그인 세션, 개인정보 흐름을 UI 정리 수준으로 가볍게 건드리지 않는다.
- teacher 포털과 시각적으로 맞춘다는 이유로 학생 화면을 더 복잡하게 만들지 않는다.
