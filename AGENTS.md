# Westory 작업 지침

이 문서는 Westory 저장소 공통 작업 지침이다.
현재 작업 환경에서 확인된 기준 checkout은 `C:\westory`다.
하위 `AGENTS.md`는 이 문서를 전제로 해당 폴더에서 더 엄격하게 적용한다.

## 작업 시작 전 확인
- 반드시 `git rev-parse --show-toplevel`로 기준 저장소가 현재 Westory 루트인지 확인한다.
- 이 작업 환경 기준 경로는 `C:\westory`다.
- 반드시 `git status --short --branch`로 현재 branch와 working tree를 확인한다.
- 반드시 `git rev-parse HEAD`로 현재 HEAD를 확인한다.
- 반드시 `git rev-list --left-right --count origin/main...HEAD` 또는 `git status -sb`로 origin 대비 ahead/behind를 확인한다.
- 기준 상태와 다르면 먼저 이유를 파악한다. 사용자 변경을 임의로 되돌리지 않는다.

## Westory 구조 요약
- 실제 앱 코드는 `src/` 아래에 있다.
- 학생 포털은 `src/pages/student/*`에 있다.
- 교사 포털은 `src/pages/teacher/*`에 있다.
- 공통 컴포넌트는 `src/components/common/*`에 있다.
- 라우팅과 공통 레이아웃은 `src/App.tsx`, `src/main.tsx`, `src/components/layout/MainLayout.tsx`에 있다.
- 인증과 사용자 컨텍스트는 `src/pages/Login.tsx`, `src/contexts/AuthContext.tsx`, `src/lib/firebase.ts`, `src/lib/permissions.ts`에 걸쳐 있다.
- 학기 범위와 준비도 로직은 `src/lib/semesterScope.ts`, `src/lib/semesterReadiness.ts`에 있다.
- 수업자료, PDF, 판서, 학습지는 `src/pages/teacher/ManageLesson.tsx`, `src/pages/teacher/components/TeacherLessonPresentation.tsx`, `src/components/common/LessonWorksheetStage.tsx`, `src/lib/lessonWorksheet.ts`에 걸쳐 있다.
- Firebase Functions는 `functions/*`에 있다.
- 배포와 운영 규칙 핵심 파일은 `vite.config.ts`, `firebase.json`, `firestore.rules`, `storage.rules`, `.github/workflows/deploy-pages.yml`이다.
- 루트 `student/`, `teacher/`, `_legacy_backup/`는 보조 또는 레거시 성격이다. 기본 작업 기준은 `src/`다.

## 수정 원칙
- 반드시 최소 범위만 수정한다. 관련 없는 정리와 리네임을 끼워 넣지 않는다.
- 기능 로직 변경과 UI 개편은 기본적으로 분리한다.
- 로그인, 권한, 학기 전환, 수업자료, PDF, 판서, 학습지, rules 변경은 고위험 작업으로 취급한다.
- `years/{year}/semesters/{semester}` 기반 경로를 기본으로 보고, legacy fallback 존재 여부를 항상 확인한다.
- 학생 포털 작업이면 교사 화면까지 같이 바꾸지 않는다. 교사 포털 작업이면 학생 화면까지 같이 바꾸지 않는다.
- 공통 파일을 바꿔 두 포털에 함께 영향이 가면, 양쪽 영향을 먼저 확인한 뒤 수정한다.
- 기존에 잘 동작하는 기능과 디자인을 전면 교체하지 않는다. 점진 개선을 우선한다.
- 루트 보조 폴더를 최신 실행 코드로 오인하지 않는다.

## 먼저 확인해야 할 핵심 파일과 경로
- 라우팅과 권한: `src/App.tsx`, `src/main.tsx`, `src/components/layout/MainLayout.tsx`, `src/lib/permissions.ts`
- 로그인과 세션: `src/pages/Login.tsx`, `src/lib/firebase.ts`, `src/contexts/AuthContext.tsx`
- 학기 범위: `src/lib/semesterScope.ts`, `src/lib/semesterReadiness.ts`
- 메뉴와 레거시 라우트 정규화: `src/constants/menus.ts`
- 학생 포털: `src/pages/student/*`
- 교사 포털: `src/pages/teacher/*`
- 공통 UI: `src/components/common/*`, `src/assets/index.css`, `assets/css/style.css`
- 수업자료 본문과 학습지 렌더링: `src/pages/student/lesson/components/LessonContent.tsx`, `src/components/common/LessonWorksheetStage.tsx`
- 운영 규칙: `firestore.rules`, `storage.rules`, `firebase.json`, `functions/index.js`
- 배포: `.github/workflows/deploy-pages.yml`, `vite.config.ts`

## 고위험 영역 특별 주의
### 로그인
- `src/pages/Login.tsx`는 로그인 화면만 담당하지 않는다.
- 역할 판별, teacher/student 진입, 온보딩, redirect, role cache가 함께 묶여 있다.
- 문구나 버튼 위치만 바꾸는 작업처럼 접근하지 않는다.

### Firebase와 권한
- `src/lib/firebase.ts`는 auth domain, emulator 연결, functions region, storage 초기화를 함께 다룬다.
- `src/lib/permissions.ts`는 버튼 노출이 아니라 실제 라우팅 가능 범위와 기본 진입 경로를 결정한다.
- 권한 수정 시 메뉴, route guard, 저장 가능 범위를 함께 확인한다.

### Semester scope
- `src/lib/semesterScope.ts`는 기본 year/semester와 path 생성 규칙을 잡는다.
- `src/lib/semesterReadiness.ts`는 운영 준비도 판단에 직접 연결된다.
- 학기 경로를 하드코딩으로 추가하지 않는다.
- legacy route와 fallback read 경로가 남아 있을 수 있으므로, 새 경로만 확인하고 기존 처리 분기를 지우지 않는다.
- semester 전환 이슈를 단순 UI 버그로 취급하지 않는다.

### Lesson worksheet / PDF / 판서
- `src/pages/teacher/ManageLesson.tsx`, `src/pages/teacher/components/TeacherLessonPresentation.tsx`, `src/components/common/LessonWorksheetStage.tsx`, `src/lib/lessonWorksheet.ts`는 한 묶음으로 본다.
- `teacher-edit`, `teacher-present`, `student-solve` 모드 경계를 깨지 않는다.
- PDF, 빈칸, OCR, 판서, 페이지 이동 로직 수정 시 학생 풀이 화면과 교사 제시 화면을 둘 다 확인한다.

### Rules
- `firestore.rules`, `storage.rules` 수정은 UI 수정처럼 다루지 않는다.
- read/write 범위 regression 가능성을 먼저 본다.
- 자동 rules 테스트 스크립트가 없다는 점을 전제로 더 보수적으로 검토한다.

## 빌드와 검증
- 루트 앱 변경 후 기본 검증은 `npm run build`다.
- `src/**/*.ts`, `src/**/*.tsx` 포맷 확인이 필요하면 `npm run format:check`를 사용한다.
- Functions 변경 후 기본 검증은 `npm --prefix functions run check`다.
- 이 저장소에는 루트 `test` 스크립트가 없다.
- rules 전용 자동 검증도 저장소에 준비되어 있지 않다.
- 자동 검증이 없을수록 영향 경로를 더 좁히고 diff를 더 엄격하게 읽는다.

## Firebase / GitHub Pages 운영 주의
- GitHub Actions는 `.github/workflows/deploy-pages.yml`에서 `main` push 시 `npm ci`와 `npm run build`를 실행하고 `dist`를 GitHub Pages에 배포한다.
- 앱은 `HashRouter`를 사용한다.
- `src/main.tsx`, `src/App.tsx`, `vite.config.ts`에는 GitHub Pages 경로와 `#/` 보정 로직이 있다.
- 라우터 종류, `base`, boot redirect를 가볍게 바꾸지 않는다.
- `src/lib/firebase.ts`는 `westory.kr`, localhost, preview 환경을 구분해 auth domain을 잡는다.
- 로그인 QA는 실제 HTTPS 배포, GitHub Pages 경로, localhost 영향을 함께 생각한다.
- `firebase.json`, `firestore.rules`, `storage.rules`, `functions/*`는 운영 계약으로 연결된다. 한쪽만 보고 바꾸지 않는다.

## 포털 분리 원칙
- 포털 작업 시 읽는 순서는 루트 `AGENTS.md` -> `UI_RULES.md` -> 해당 포털 `AGENTS.md`다.
- 학생 경험 변경은 `src/pages/student/AGENTS.md`를 먼저 읽고 진행한다.
- 교사 운영 화면 변경은 `src/pages/teacher/AGENTS.md`를 먼저 읽고 진행한다.
- `src/components/common/*`, `src/lib/*`, `src/pages/Login.tsx`처럼 공통 파일을 수정하면 학생과 교사 양쪽 파급을 함께 확인한다.
- 포털별 운영 용어와 흐름은 상대 포털에 그대로 복제하지 않는다.

## 문서 참조 관계
- 공통 UI 규칙은 `UI_RULES.md`를 따른다.
- 교사 포털 추가 제약은 `src/pages/teacher/AGENTS.md`를 따른다.
- 학생 포털 추가 제약은 `src/pages/student/AGENTS.md`를 따른다.
- 하위 문서는 루트 문서를 대체하지 않는다. 루트 문서 위에 더 엄격한 규칙을 추가한다.
