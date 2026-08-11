# W6–W9 Shell / Domain Integration Handoff

작성일: 2026-08-11

기준 branch: `codex/phase6-w5-global-shell-common-ui`

## 공통 원칙

W5 Shell은 역할별 전역 이동, 페이지 구조, 공통 상태, 학기·출처 표시를 담당합니다. W6–W9는 각 Domain의 내부 기능과 업무 흐름을 구현하되 Shell을 다시 만들지 않습니다.

- 페이지는 자체 `<main>`을 만들지 않습니다. `AppShell`이 main landmark를 소유합니다.
- 페이지의 대표 제목은 route metadata와 `PageHeader`가 담당합니다. 내부 section은 h2 이하를 사용합니다.
- 모바일·데스크톱 컴포넌트를 동시에 mount한 뒤 CSS로 하나를 숨기지 않습니다.
- Navigation에서 Firestore query나 Domain listener를 시작하지 않습니다.
- 전역 설정은 AuthContext의 authorized in-memory state를 소비합니다.
- 직접 URL과 새로고침이 가능한 canonical route를 유지하고, alias는 redirect register에서 관리합니다.

## 사용할 공통 구성요소

- `AppShell`: 역할별 Global Navigation과 main content
- `PageHeader`: 페이지 제목·설명·주요 action
- `StatePanel`: loading, empty, error, permission, expired session, maintenance, archive, legacy, stale 등
- `ResponsiveDataContainer`: 넓은 표·목록의 mobile/desktop 경계
- `SemesterContextBar`: 실제 resolver가 제공한 학기 문맥
- `ProvenanceBadge`: CURRENT, PREPARING, ARCHIVE, LEGACY, EXPLICIT

`SemesterContextBar`와 `ProvenanceBadge`에는 URL query를 그대로 전달하지 않습니다. W3 resolver와 W4 adapter가 반환한 provenance, semesterId, readOnly를 사용해야 합니다.

## 역할과 Navigation

학생 전역 IA는 오늘, 학습, 평가, 성적, 더보기입니다. 교사·관리자 전역 IA는 업무 홈, 학생과 학급, 수업 운영, 평가 운영, 성적 운영, 위스 운영, 일정과 소통, 관리자입니다. 메뉴 노출과 route 허용은 같은 role/capability 계약을 사용해야 합니다.

새 Domain route를 추가할 때는 `routeMetadata.ts`, `accessControl.ts`, canonical/alias 검증 manifest를 함께 갱신합니다. 권한 없는 메뉴를 숨기는 것만으로 끝내지 말고 direct URL도 차단해야 합니다.

## 상태 처리

단순 spinner나 포괄적인 오류 문구를 새로 만들지 않습니다. 재시도 가능한 오류, 권한 부족, session 만료, archived read-only, legacy 출처, stale 데이터를 `StatePanel`의 의미에 맞게 구분합니다. async subscription은 route unmount와 responsive 전환에서 정리해야 합니다.

## Wave별 책임

- W6A: 평가 생성·응시·검토 흐름
- W6B: 성적·서명·피드백 흐름
- W7: Wis Economy와 Shop
- W8: 학습·일정·출석·알림
- W9: 교사 bulk 업무와 draft 51개

각 Wave는 대표 화면부터 공통 패턴을 적용하고, Domain 기능 문제 때문에 Shell 구조를 분기하거나 W5 하위 Wave를 새로 만들지 않습니다.

## 유지해야 할 안전 경계

- W2 Query Purity와 Command Gateway
- W3 canonical semester resolver
- W4 Enrollment·Archive adapter와 silent legacy fallback 0
- Maintenance pre-session Gate와 Firestore·Functions·Storage fence
- W1 Access Gate와 KI-W1-01 release register
- Production idle enforcement 비활성

## 후속 기술 항목

다음은 W5 blocker가 아니며 담당 Wave나 release hardening에서 처리합니다.

- `vendor-excel` 대형 chunk와 500kB build warning
- remote Google Font·Font Awesome 의존성 정리
- firebase-functions 및 npm audit 항목 검토
- 고유 Vercel Preview 도메인의 App Check 허용 정책
- 모든 기존 Domain 화면의 세부 시각 완성

## 완료 전 확인

각 Wave는 390×844, 768×1024, 1024×768, 1280×800, 1600×900을 확인하고, overflow 0, primary action 접근 가능, main/h1 중복 0, hidden query 0, listener 누수 0을 검증합니다. 변경한 역할의 canonical route와 direct URL, 새로고침, back/forward도 함께 확인합니다.
