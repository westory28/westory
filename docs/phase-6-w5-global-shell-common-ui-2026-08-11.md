# PHASE 6 — W5 Global Shell, Navigation & Common UI

작성일: 2026-08-11

기준 브랜치: `codex/phase6-w5-global-shell-common-ui`

기준 SHA: `c735055608cdc06bd2b6324f92662f88149f6966`

## 1. Executive Summary

W5에서는 기존 학생·교사 기능과 URL을 유지하면서 역할별 공통 Shell, 반응형 Navigation, 공통 상태 UI, 학기·출처 표시, 학생 전역 Maintenance Gate를 구축했습니다. 학생은 오늘·학습·평가·성적·더보기 구조를 사용하고, 교사와 관리자는 업무 중심 8개 영역을 권한에 맞게 사용합니다.

학생 점검 차단은 오래된 hotfix branch를 병합하지 않고 현재 W4 인증·세션·Rules·Functions 구조에 맞춰 선택적으로 이식했습니다. 점검 대상 학생은 application session과 보호 화면이 만들어지기 전에 차단되며, 이미 열린 세션과 이전 bundle의 직접 SDK 접근도 서버에서 거부됩니다.

최종 판정은 `READY FOR W6A ASSESSMENT STAGING DEVELOPMENT`입니다. W5 CURRENT-WAVE blocker는 0건입니다.

## 2. Baseline

- W4 완료 SHA: `c735055608cdc06bd2b6324f92662f88149f6966`
- W5 branch: `codex/phase6-w5-global-shell-common-ui`
- 시작 시 사용자 문서 `AGENTS.md`, `DESIGN.md`, `UI_RULES.md`와 W1 evidence, `tmp/**`를 별도 변경으로 분류했습니다.
- W5 commit에는 W5 구현·검증·보고서만 선택적으로 포함하고, 사용자 문서의 기존 변경과 W1 evidence, 임시 파일, 합성 계정 정보는 제외합니다.
- Maintenance hotfix는 `6120f08c07f92a1b3939d34a416fb36726576d78`의 기능 계약만 검토했으며 branch merge와 무조건 cherry-pick을 하지 않았습니다.
- Production 배포·데이터 변경·환경변수 변경·alias 변경·main push는 수행하지 않았습니다.

## 3. Design Foundation

실제 Westory 앱 아이콘과 `We`/`story` wordmark를 유지하고, 기존 파랑 `#2563eb`과 amber accent를 중심으로 실용적인 Foundation을 추가했습니다.

- semantic color, typography, spacing, radius, border, elevation
- focus ring, motion, reduced motion
- navigation 높이·너비, safe area, content width
- 390/768/1024/1280/1600 대응 breakpoint
- 미세한 투명도와 blur만 사용하는 절제된 glass surface

기존 페이지의 개별 스타일을 일괄 교체하지 않고 새 Shell과 공통 컴포넌트부터 점진적으로 적용했습니다.

## 4. Student Shell / IA

학생 Shell은 다음 전역 IA를 제공합니다.

- 오늘
- 학습
- 평가
- 성적
- 더보기: 위스, 일정, 역사사전·사료, 지난 학기, 마이페이지 등

390px에서는 하단 Navigation과 더보기 Drawer를 사용합니다. 768px에서는 compact 패턴, 1024px 이상에서는 상단 전역 Navigation을 사용합니다. 메뉴는 정적 표시가 아니라 이미 로드된 `menuConfig`와 `showLesson`, `showQuiz`, `showScore` 설정으로 필터링됩니다. Navigation 자체의 Firestore query는 0입니다.

## 5. Teacher / Admin Shell / IA

교사·관리자 Shell은 업무 홈, 학생과 학급, 수업 운영, 평가 운영, 성적 운영, 위스 운영, 일정과 소통, 관리자 영역을 제공합니다. 역할과 capability가 허용한 항목만 표시하며, route guard도 같은 권한 계약을 사용합니다.

390px에서는 App Bar와 Drawer, 768px에서는 compact Navigation, 1024px 이상에서는 고정 Sidebar를 사용합니다. 1280px과 1600px에서는 데이터 중심 화면이 지나치게 좁은 중앙 열에 갇히지 않도록 넓은 content 영역을 확보했습니다.

## 6. Navigation Architecture

- Global Navigation: 역할별 제품 Domain 이동
- Local Navigation: 기존 Domain 내부 tab과 section 유지
- Contextual Navigation: 학생·학기·자료 등 현재 대상의 맥락 표시

반응형 Navigation은 보이지 않는 모바일·데스크톱 버전을 동시에 mount하지 않습니다. 알림 Bell도 화면 크기별 중복 mount를 제거해 inbox와 broadcast listener가 하나씩만 유지됩니다. Drawer는 열릴 때 focus를 내부로 옮기고 Escape로 닫은 뒤 원래 trigger에 focus를 돌려줍니다.

## 7. Route Compatibility

- 학생 canonical route 17개 유지
- 교사 canonical route 13개 유지
- `history2` 계열 alias 4개 유지
- 과거 bookmark, 직접 URL, 새로고침, 뒤로가기·앞으로가기 확인
- 로그인 return path와 role 간 잘못된 direct URL 차단 유지
- GitHub Pages clean path 보정 책임을 `main.tsx` 한 곳으로 통합
- Not Found 복귀는 history replace를 사용해 404 반복을 방지

## 8. Common UI States

`StatePanel`은 다음 13개 상태를 공통 계약으로 제공합니다.

`LOADING`, `CONTENT`, `EMPTY`, `ERROR`, `PERMISSION`, `SESSION_EXPIRED`, `MAINTENANCE`, `ARCHIVED`, `LEGACY`, `STALE`, `OFFLINE`, `PARTIAL`, `DISABLED`

각 상태는 제목, 설명, 복구 행동, 재시도 여부, 돌아갈 위치, 문의 필요 여부, read-only 여부를 구분합니다. `PageHeader`, `ResponsiveDataContainer`, 기존 Error Boundary와 Access Boundary도 같은 시각·접근성 규칙을 사용합니다.

## 9. Semester / Provenance UI

`SemesterContextBar`와 `ProvenanceBadge`는 `CURRENT`, `PREPARING`, `ARCHIVE`, `LEGACY`, `EXPLICIT`을 텍스트와 아이콘으로 표시합니다. URL query를 출처의 source of truth로 사용하지 않으며 canonical resolver나 실제 화면 데이터가 전달한 scope만 표시합니다. 지난 학기 화면은 읽기 전용임을 제목과 설명으로 함께 알립니다.

## 10. Responsive Patterns

| Viewport | 대표 화면 | 결과 |
| --- | --- | --- |
| 390×844 | 학생 오늘, 학생 점검, 관리자 Drawer | overflow 0, touch target·safe area PASS |
| 768×1024 | 학생 지난 학기 | overflow 0, compact layout PASS |
| 1024×768 | 학생 오늘 | Navigation/content 충돌 0 |
| 1280×800 | 교사 업무 홈 | 248px Sidebar, 업무 영역 PASS |
| 1600×900 | 관리자 학기 관리 | content 1337px, 과도한 빈 공간 0 |

모든 대표 화면에서 page horizontal overflow 0, main landmark 1개, 가시 h1 1개를 확인했습니다.

## 11. Maintenance Gate Integration

Canonical 설정은 `site_settings/student_maintenance`의 exact 9-field schema를 사용합니다. 문서가 없으면 비활성, malformed이거나 읽기에 실패하면 학생에 대해 fail-closed합니다.

- Auth bootstrap과 Login이 하나의 deduplicated preflight를 사용
- 학생은 application session 생성과 config/menu load 전에 차단
- `StudentMaintenanceGate`가 보호 provider와 child mount 전에 차단
- 교사·staff·관리자·최대 20개 bypass UID는 정상 통과
- Firestore·Storage는 기존 session fence와 maintenance fence를 AND 결합
- 모든 callable factory는 business logic 전에 maintenance guard 적용
- 이미 열린 학생 session의 touch와 직접 SDK 우회도 즉시 거부
- 관리자 recovery callable은 App Check, recent auth, high-risk session, revision, atomic audit 요구
- Staging 기본 상태는 문서 미존재, 즉 비활성

Production 최종 읽기 전용 확인 결과는 `enabled`, revision 3입니다. 작업 초기의 문서 미존재 확인 뒤 병렬 hotfix 활성화가 반영된 것으로 보입니다. W5 branch가 수행한 Production mutation은 0건입니다.

## 12. Representative Screens

학생 오늘 Dashboard, MyPage의 현재 학적 카드, 학생 지난 학기 read-only 화면, Maintenance 화면에 새 Shell 패턴을 적용했습니다. 교사 업무 Dashboard, 학생·학급 대표 화면, 관리자 학기·archive 관리 화면은 기존 Domain 기능을 유지한 채 Shell, Page Header, 상태·출처 패턴을 적용했습니다.

## 13. Accessibility

- skip link와 semantic landmark
- 화면당 main 1개, 대표 화면 h1 1개
- 현재 Navigation의 `aria-current`
- icon-only action의 accessible name
- Drawer/dialog focus 이동, trap, Escape, focus restore
- 최소 44×44px Shell touch target
- 명확한 focus-visible ring
- reduced motion 대응
- 상태를 색상뿐 아니라 텍스트·아이콘으로 전달

자동 DOM 점검에서 이름 없는 interactive element, 중복 id, alt 없는 image, label 없는 navigation, 44px 미만 Shell action은 모두 0건이었습니다. 학생·교사 메뉴와 dialog를 keyboard로 수동 확인했습니다.

## 14. Performance

기존 route-level lazy loading을 유지했습니다. 반응형 UI를 CSS로 숨긴 채 중복 mount하지 않으며, Navigation은 이미 메모리에 있는 인증·설정 상태만 소비합니다. 새 Shell 때문에 전 Domain을 초기 bundle로 합치지 않았습니다.

기존 `vendor-excel` 1MB대 chunk, 500kB 경고, remote font/icon 의존성, firebase-functions 노후화와 npm audit 항목은 W5 blocker가 아니며 후속 성능·운영 정리 대상으로 이관합니다.

## 15. Regression

`npm run verify:w5-global-shell` 최종 PASS:

- W5 Shell safety: 학생 17, 교사 13, alias 4, Navigation query 0, responsive duplicate mount 0
- direct SDK boundary: 163 groups, query factory 5, UNKNOWN 0
- Maintenance: Functions unit 44, callable integration 57, Firestore·Storage Rules 64
- W2 Command Gateway와 Query Purity PASS
- W3 Semester Core와 resolver PASS
- W4 Enrollment·Archive adapter와 write fence PASS
- W1 Access Gate 기본 회귀 PASS, KI-W1-01 악화 없음
- emulator suites의 Production access 0
- build와 format PASS

TypeScript 기준선은 기존과 동일한 63 errors / 13 files이며 fingerprint는 `0b005d69dafcae57ac6f8e0c9f82fffea610d709fe9686fba92e405a08d0a36c`입니다. W5 신규 오류는 0건입니다.

## 16. Dedicated Staging

- Firebase project: `westory-staging-177587430482`
- Firestore Rules, Storage Rules, W5 관련 Functions 반영 완료
- Functions runtime: Node.js 22, region `asia-northeast3`
- Storage trigger 2개가 staging bucket을 사용하도록 공식 `storageBucket` parameter로 수정 후 확인
- Maintenance 설정: 문서 미존재, 기본 비활성, mutation 0
- Vercel Preview: `https://westory-staging-feibwnq5w-bbbs-projects-44f9da30.vercel.app`
- Preview 상태 READY, Production alias 승격 0
- 390×844 Preview 로그인 화면 overflow 0, h1 1개, form 정상

고유 Preview 도메인의 App Check 허용 도메인 차이로 public 설정 read 경고가 보일 수 있습니다. 로그인 화면과 fallback은 정상이며, 인증된 역할·Maintenance matrix는 동일 staging 구성의 emulator에서 검증했습니다. 안정 alias나 Production 설정은 변경하지 않았습니다.

## 17. Production Safety

- Firestore data write 0
- Storage write 0
- Auth write 0
- Rules·Functions 배포 0
- Vercel Production deploy·alias 0
- 환경변수 변경 0
- Maintenance 설정 변경 0
- 활성 학기 변경 0
- GitHub Pages 배포 0
- main push 0

Production maintenance 상태 확인은 OAuth access token을 메모리에서만 사용한 Firestore REST GET 1회로 수행했습니다. token, UID, updatedBy 값은 출력하거나 저장하지 않았습니다.

## 18. Domain Handoff

- W6A/W6B: 평가·성적 내부 화면을 Shell 상태·header·responsive data pattern에 연결
- W7: Wis Economy·Shop
- W8: 학습·일정·출석·알림
- W9: 교사 bulk 업무와 draft
- 각 Wave는 페이지 내부 Domain 기능을 담당하며 Shell과 Navigation 계약을 중복 구현하지 않습니다.
- archive/legacy 화면은 실제 W4 adapter의 provenance와 read-only 값을 전달해야 합니다.

## 19. Release Blockers

`KI-W1-01 — RELEASE BLOCKER`는 그대로입니다. 재인증 뒤 일부 환경에서 `users/{uid}` probe가 permission-denied로 실패하는 문제이며, W5에서는 재디버깅하지 않았고 상태 악화도 없습니다.

W5 CURRENT-WAVE blocker는 0건입니다.

## 20. Rollback

1. W5 commit을 revert합니다.
2. Dedicated Staging Rules·Functions를 W4 SHA 기준으로 재배포합니다.
3. Vercel Preview는 immutable이며 Production alias가 없으므로 폐기만 하면 됩니다.
4. Staging maintenance 문서는 기본적으로 존재하지 않으므로 학생 QA가 즉시 복구됩니다.
5. Production maintenance는 별도 hotfix 운영 계약으로 유지되며 W5 rollback 대상이 아닙니다.

## 21. Final W6A Readiness

`READY FOR W6A ASSESSMENT STAGING DEVELOPMENT`

이 판정은 Global Shell, Navigation, 공통 상태, provenance, Maintenance Gate가 Staging 개발 기준을 충족했다는 뜻입니다. 모든 Domain 화면의 재구축이나 Production 출시 준비 완료를 뜻하지 않습니다.
