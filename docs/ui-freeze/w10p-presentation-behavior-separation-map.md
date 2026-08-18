# W10P Presentation–Behavior separation map

작성일: 2026-08-18 (KST)

Presentation 기준: `676869fa289d3e7ecef234cbb5cca65c60ec4597`

Behavior 기준: `ef74b571a6964ddbc61eb7877a98d21b3c7c8c85`

## 1. 분류 원칙

- **Presentation Frozen**: 기존 route에서 사용자에게 보이는 DOM 구조, className, 텍스트, 자산, 메뉴명·순서·계층, breakpoint와 CSS cascade를 Production과 같게 유지한다.
- **Behavior Retained**: W11의 인증·권한·세션·학기 범위·query·command·receipt·audit·재인증·중복 효과 방지 계약을 그대로 사용한다.
- **Mixed**: 한 파일에 Presentation과 동작이 결합돼 있다. 파일 전체를 어느 한 commit으로 교체하지 않고, Production render 위에 W11 handler·selector·gateway를 연결한다.
- **New-only**: Production에 존재하지 않았던 기능 화면이다. 기존 route DOM이나 전역 CSS를 바꾸지 않고 별도 route root 아래로 격리한다.

## 2. Presentation Frozen

| 범위 | 기준 파일·자산 | 동결 내용 |
| --- | --- | --- |
| 문서·font·icon 순서 | `index.html`, `src/assets/index.css`, `assets/css/style.css` | Noto Sans KR metrics, Production reset/cascade, 색·간격·글자·breakpoint, Font Awesome 6.4 계보의 icon metrics |
| 전역 shell | `src/components/common/Header.tsx`, `Footer.tsx`, `src/components/layout/MainLayout.tsx` | Header·desktop dropdown·학생 모바일 menu·Footer·본문 폭과 1024px desktop 전환 |
| 로그인·점검 | `src/pages/Login.tsx`, `src/pages/student/Maintenance.tsx`, `public/icons/westory-wordmark.svg` | 정상 사용자 경로의 form, 안내, modal, wordmark와 layout |
| 학생 기존 화면 | `src/pages/student/Dashboard.tsx`, `Calendar.tsx`, `History.tsx`, `MyPage.tsx`, `Points.tsx`, lesson·quiz·score·history-classroom 화면 | Production DOM/className/layout과 기존 문구 |
| 교사 기존 화면 | `src/pages/teacher/Dashboard.tsx`, `StudentList.tsx`, `ManageQuiz.tsx`, `ManageExam.tsx`, `ManagePoints.tsx`, `ManageSchedule.tsx`, lesson 관리 화면, `Settings.tsx`와 기존 setting panels | Production 업무 화면의 정보 구조, control 배치, tab, table, dialog와 기존 문구 |
| 공통 기존 component | `NotificationBell.tsx`, `MapViewer.tsx`, `HistoryClassroomAssignmentView.tsx`, loading/error 표현 | 기존 화면에 렌더되는 마크업과 overlay 위치 |

대표 Production blob fingerprint:

- MainLayout `6a830667…`
- Header `1bcb0941…`
- Footer `65300d06…`
- menus `e96a7f77…`
- `assets/css/style.css` `2ba854fc…`
- `src/assets/index.css` `9af76d82…`
- Login `76c7ff4c…`
- Maintenance page `b08bae70…`
- Student Dashboard `fbcbad6…`
- Teacher Dashboard `c5bf0a5…`
- QuizRunner `f0c337…`
- ManageExam `05e515…`
- Settings `28474d…`
- wordmark SVG `41eb051b…`

## 3. Behavior Retained

다음 영역은 W11이 authoritative하다. UI 복원을 이유로 구형 구현을 되살리지 않는다.

| 범위 | 대표 파일 | 유지 계약 |
| --- | --- | --- |
| Auth·session | `src/contexts/AuthContext.tsx`, `src/lib/firebase.ts`, `src/components/auth/*` | 역할 판별, 세션 재개, reauth, maintenance preflight, protected access |
| Route permission | `src/lib/permissions.ts`, `src/lib/accessControl.ts`, `src/lib/studentMenuAccess.ts` | 서버·role·capability 기반 접근, 안전한 기본 route, menu와 route guard 일치 |
| Semester scope | `src/lib/semesterScope.ts`, `src/lib/semesterReadiness.ts` | `years/{year}/semesters/{semester}` 경로, legacy fallback, readiness |
| Command boundary | `src/lib/commandGateway.ts`, `src/lib/w8Domains.ts`, Functions callable | 직접 Firestore 쓰기 금지, idempotency, receipt·audit, 실패 원자성 |
| Query/read model | W2–W11 query adapters와 projection helpers | 조회 중 자동 쓰기 금지, 최신 schema와 legacy fallback의 명시적 projection |
| 운영 backend | `functions/*`, `firestore.rules`, `storage.rules`, `firebase.json` | W11 배포·rules 계약. W10P에서는 Production에 배포하지 않는다. |

## 4. Mixed 파일과 adapter 경계

| Mixed 지점 | Presentation source | Behavior source | 통합 방식 |
| --- | --- | --- | --- |
| `src/App.tsx` | Production route path와 기존 component mount | W11 auth/permission/maintenance gates와 신규 route | 기존 route component를 복원하고 새 기능 route를 나란히 유지한다. compatibility path를 stricter route로 무조건 redirect하지 않는다. |
| `src/constants/menus.ts` | Production 메뉴명·순서·상하위·설정 반영 | W11 URL normalization, sanitize, role visibility | 기존 배열을 앞부분 그대로 유지하고 신규 항목만 기존 dropdown 끝에 추가한다. |
| Header/MainLayout/Footer | Production DOM/className/breakpoint | W11 session action, permission filter, notification state | render adapter로 연결하며 listener·drawer를 중복 mount하지 않는다. |
| Login | Production form·텍스트·asset | W11 sign-in, role cache, redirect, onboarding, maintenance preflight | 정상 render는 Production, event handlers와 state machine은 W11을 사용한다. |
| Maintenance | Production page/modal | `StudentMaintenanceGate` 최신 상태와 auth session | Production safe modal·sanitization·focus semantics를 유지한다. |
| 기존 학생·교사 page | Production JSX·className | W11 selectors, commands, permission, semester state | query 결과를 Production view model로 투영하고, mutation은 gateway command로 교체한다. |
| NotificationBell | Production bell/panel | 최신 notification query·read command | 한 번만 mount하고 panel의 위치·크기는 Production과 맞춘다. |
| Settings/MyPage | Production 기본 sections | archive/enrollment/cutover 신규 기능 | 신규 기능은 기존 기본 layout을 밀지 않는 action 또는 new-only route로 연결한다. |
| points·schedule·assessment | Production tab/table/form | W7/W8/W9 command와 read model | 기존 control과 tab을 유지하고 handler만 최신 gateway로 연결한다. |

## 5. W10·W10R 전역 UI 영향 추적

W11과 Production 비교에서 다음 전역 변경이 확인됐다. 이들은 기존 route에서 제거하거나 영향이 없도록 격리한다.

1. `AppShell`, `NavigationDrawer`, `NavigationIcon`, `PageHeader`, `routeMetadata`가 추가되어 기존 Header와 메뉴 source를 대체했다.
2. 학생·교사 route 일부가 `W8StudentHub`, `W8TeacherHub`, `WisEconomyStudentView`, `WisEconomyManager`로 교체됐다.
3. `assets/css/style.css`에 shell/sidebar/common component 규칙이 추가되고 body/font/header selector와 breakpoint가 바뀌었다.
4. 학생·교사 Dashboard가 W8 운영 카드 중심 구조로 바뀌었다.
5. Login과 Maintenance가 W5 이후 새 class 체계로 바뀌었다.
6. MyPage 기본 grid 앞에 신규 enrollment panel이 삽입됐고, Settings 기본 navigation에 신규 운영 surface가 결합됐다.
7. local Tailwind·Font Awesome 로딩으로 Production CDN 시기의 reset·font·icon cascade 순서가 달라졌다.

특히 Production Header는 `1024px`부터 desktop navigation을 표시한다. W11 또는 다른 과거 commit의 `1280px` 전환을 사용하면 1024×768 parity가 깨지므로 허용하지 않는다.

## 6. CSS·component 격리 규칙

- 기존 route root에서는 Production class와 CSS selector를 우선한다.
- W5 AppShell은 기존 route에 mount하지 않는다. 관련 CSS가 남더라도 기존 DOM에 match하지 않도록 제거·격리한다.
- `StatePanel`, `ModalSurface`, `FormField` 등 W11 common primitive는 new-only route 또는 명시적 scoped adapter에서만 사용한다.
- 새 CSS는 route root namespace 아래에 두며 `body`, `header`, `main`, `button`, `.container` 같은 전역 selector를 추가하지 않는다.
- Tailwind preflight, font와 icon import 순서는 실제 screenshot 비교로 검증한다.
- 시각 복원 과정에서 direct Firestore write, read-time write, 구 callable, client-only permission을 부활시키지 않는다.

## 7. 검증 책임

| 검증 | 통과 조건 |
| --- | --- |
| Presentation | 같은 role·route·fixture·viewport의 Production/Staging screenshot pixel diff가 허용 범위 안이다. |
| Behavior | W11 access, query purity, command gateway, receipt·audit, session, semester scope 검증이 통과한다. |
| Mixed adapter | DOM/className/layout은 Production과 같고 handler는 W11 경계를 통과한다. |
| New-only | 기존 route screenshot과 전역 CSS diff가 0이며 직접 접근·메뉴·권한이 일치한다. |

## 8. 분리 판정

`W10P PRESENTATION–BEHAVIOR SEPARATION MAP VERIFIED`

이 판정은 파일과 결합 지점의 소유권을 확정한 것이다. 실제 adapter·화면 parity 통과는 후속 checkpoint에서 별도로 판정한다.
