# W10R 공통 컴포넌트 계약

상태: canonical checkpoint 계약

## Registry

| 컴포넌트 | 책임 | 필수 계약 | 금지 |
| --- | --- | --- | --- |
| `AppShell` | 역할별 전역 구조, 콘텐츠 offset | `NAVIGATION_REGISTRY` 직접 사용, desktop top nav, mobile role pattern | route별 별도 shell, desktop 전역 sidebar |
| `Header` | 브랜드, 세션, 알림, 계정 action | keyboard 접근, 44px target, action label | 페이지 title·업무 filter 소유 |
| `NavigationDrawer` | 좁은 화면 전체 menu | parent/child 모두 렌더, 현재 위치, Escape·focus restore | 학생 More만 child 렌더하는 분기 |
| `PageHeader` | route title·설명·학기 문맥 | 한 페이지에 한 번, metadata 기반 | 페이지 내부 중복 h1·학기 bar |
| `SemesterContextBar` | 현재/준비/지난 학기 구분 | provenance와 read-only를 텍스트로 표현 | 색만으로 상태 표시 |
| `StatePanel` | loading·empty·error·permission·disabled | 제목, 설명, 선택적 action | 거대한 장식 empty, 상태 간 동일 문구 |
| `ResponsiveDataContainer` | 표의 좁은 화면 적응 | overflow affordance, caption/label, keyboard reachability | 무조건 카드 목록으로 전환 |
| `FormField` | label·help·error 연결 | `htmlFor`, `aria-describedby`, error semantics | placeholder를 label로 사용 |
| `ModalSurface` / `AppDialogProvider` | 확인·위험 작업 | dialog/alertdialog, focus trap·restore, Escape, 명시적 취소 | browser `alert/confirm`, backdrop만으로 닫기 강제 |

## Action hierarchy

| 수준 | 용도 | 규칙 |
| --- | --- | --- |
| Primary | 현재 화면의 핵심 완료 행동 | viewport당 시각적 primary 최대 1개 |
| Secondary | 보조 작업·탐색 | primary와 같은 강조 금지 |
| Tertiary | 낮은 빈도·상세 보기 | 필요할 때만 노출 |
| Danger | 삭제·학기 전환 같은 손실 가능 작업 | 일반 저장과 분리, 확인 단계 필수 |

같은 action은 같은 component variant와 높이를 사용합니다. icon-only가 꼭 필요하면 고유한 accessible name과 tooltip을 제공합니다.

## 화면 유형 계약

### 교사 dashboard

`PriorityQueue → TodaySchedule → CoreStatus → FrequentActions` 순서입니다. 핵심 업무가 없는 경우에도 빈 카드 묶음 대신 업무가 없다는 상태와 다음 탐색을 명확히 보여줍니다.

### 데이터 목록

`CompactFilterToolbar → SelectionSummary/BulkActions → ResponsiveDataContainer → Pagination` 순서입니다. 검색·필터는 데이터와 가까이 두며, 선택 전에는 destructive bulk action을 disabled 이유와 함께 표시합니다.

### 분석

`Filter → SummaryMetrics → Visualization → DetailTable` 순서입니다. chart는 수치·텍스트 대체 설명을 제공하며 low/empty/high data 상태를 각각 처리합니다.

### 설정·학기 전환

`CurrentContext → PreparingContext → Validation → StepProgress → RiskZone → Recovery` 순서입니다. 문맥 sidebar가 필요하면 224px 이내로 해당 화면에만 둡니다. 위험 action은 Production에서 제공하지 않습니다.

### 학생 Today

`ContinueLearning → TodaySchedule → Notices → Progress → Wis/Attendance` 순서입니다. mobile bottom nav 안전 영역을 확보하고 본문 주 action과 전역 navigation을 겹치지 않습니다.

## 접근성 계약

- landmark와 heading 순서를 유지합니다.
- menu trigger는 expanded/controls state를 노출합니다.
- tab은 `tablist/tab/tabpanel` 및 keyboard 이동을 지원합니다.
- table은 caption 또는 accessible label, column header scope를 가집니다.
- chart는 대체 요약을 제공합니다.
- live update는 필요한 경우에만 적절한 `aria-live`를 사용합니다.
- 200% zoom과 320px 폭에서 내용과 핵심 action이 손실되지 않아야 합니다.
