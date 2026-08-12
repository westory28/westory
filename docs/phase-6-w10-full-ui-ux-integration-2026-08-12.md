# PHASE 6 — W10 전체 UI·UX 통합 및 시각적 완성

작성일: 2026-08-12

작업 branch: `codex/phase6-w10-full-ui-ux-integration`

기준 W9 SHA: `9f9cf691dc72669384a23bf6a23c5081cf8f09bd`

최종 UI 배포 기준 SHA: `f7d92d6cc2761acb762a68db9bfe313485139062`

## 1. Executive Summary

W2부터 W9까지 나뉘어 구축한 기능을 학생·교사 Shell 안에서 같은 정보 위계와 상태 표현으로 정리했습니다. 학생 canonical route 17개, 교사 canonical route 13개, alias 4개를 포함한 등록 화면 47개의 분류를 확정했고 `UNKNOWN=0`을 달성했습니다. 로그인, Maintenance, 공통 상태, Form, Dialog, Table, Draft, Bulk, 학기·출처 표현을 하나의 디자인 기반에 맞췄습니다.

Dedicated Staging에서 184개 route·viewport 조합과 8개 대표 journey, 9개 공통 상태, 5개 viewport 접근성 증거를 수집했습니다. 화면 가로 넘침, Navigation 겹침, Dialog 화면 이탈, 조회 중 write, 예상하지 못한 console 오류는 모두 0이었습니다. W10 CURRENT-WAVE blocker는 0입니다.

최종 판정은 다음과 같습니다.

`READY FOR W11 SEMESTER CUTOVER PREPARATION STAGING DEVELOPMENT`
이 판정은 Dedicated Staging의 UI·UX 통합 완료를 뜻하며, Production 출시나 2026-2 데이터 전환 완료를 뜻하지 않습니다.

## 2. Baseline

- W9 branch: `codex/phase6-w9-teacher-operations-draft-bulk`
- W9 Full SHA: `9f9cf691dc72669384a23bf6a23c5081cf8f09bd`
- W10 branch: `codex/phase6-w10-full-ui-ux-integration`
- Dedicated Staging Firebase: `westory-staging-177587430482`
- 고정 alias: `https://westory-staging-westoria28-8028-bbbs-projects-44f9da30.vercel.app`
- 최종 Staging deployment: `dpl_EczpyUAh5VmSdEh8NtWcbZ7kvMKR`
- TypeScript 기준선: 기존 63 errors / 13 files, W10 신규 오류 0

사용자 문서, W1 evidence, `tmp/`와 다른 작업의 미추적 파일은 삭제하거나 W10 commit에 포함하지 않았습니다. Production 상태는 조회하거나 변경하지 않았습니다.

## 3. Route / Screen Inventory

`scripts/w10-route-inventory.json`을 최종 기준으로 삼았습니다.

| 분류 | 수 | 처리 |
| --- | ---: | --- |
| COMPLETE | 18 | 현재 canonical 표현 유지 |
| INTEGRATE | 8 | 공통 Shell·상태·레이아웃 연결 |
| REBUILD_PRESENTATION | 10 | Domain 계약을 유지하고 표현만 재구성 |
| REMOVE_LEGACY_UI | 8 | canonical redirect·alias만 남기고 구형 UI mount 제거 |
| RELEASE_DECISION | 3 | 정책 경계를 명시하고 안전한 화면만 유지 |

학생 canonical 17개, 교사 canonical 13개, alias 4개를 포함한 등록 화면은 총 47개입니다. 로그인, Maintenance, 권한 없음, 세션 만료, Not Found, Developer Log도 별도 상태로 검증했습니다. alias는 query와 bookmark를 보존하며 canonical 화면으로 이동합니다.

## 4. Design Foundation

주요 파랑 `#2563EB`, 강조 노랑 `#F59E0B`, Westory wordmark를 기준으로 색상·간격·테두리·radius·focus·motion·breakpoint·safe area를 정리했습니다. 깊이는 과한 그림자보다 border와 옅은 배경 차이로 표현했습니다. 학생 화면은 행동 우선, 교사 화면은 정보 밀도와 빠른 판단을 우선했습니다.

공통 component로 `WestoryBrand`, `FormField`, `ModalSurface`, `PublicServiceLinks`, `StatePanel`, `ResponsiveDataContainer`, `PageHeader`를 정리했습니다. 기존 Domain component는 그대로 활용했고, 모든 책임을 하나의 범용 component에 합치지 않았습니다.

## 5. Login / Auth

로그인 화면은 실제 서버 role을 그대로 사용하며 학생·교사 역할 선택으로 권한이 생기지 않습니다. loading 중 중복 제출을 막고, 이메일·비밀번호에 label과 autocomplete를 적용했습니다. 보호 route에서 익명 사용자는 로그인 화면으로 안전하게 돌아오며 return path를 유지합니다.

모바일·PC 로그인에서 44px touch target, keyboard focus, 정책 Dialog, Escape, main landmark, page heading을 확인했습니다. 세션 만료 화면은 원인과 다시 로그인 행동을 안내합니다. KI-W1-01은 기존 Release blocker로 유지하며 인증 구조를 다시 설계하지 않았습니다.

## 6. Student UI Integration

학생 Today는 학습, 위스, 일정, 출석, 공지를 read-only projection으로 묶었습니다. 학습·평가·성적의 메뉴와 상태 문구를 구분했고, Archive·Legacy는 수정 가능한 Current처럼 보이지 않도록 했습니다. 모바일 Bottom Navigation의 오늘·학습·평가·성적·더보기 명칭과 현재 위치를 맞췄습니다.

학생 canonical route 17개를 다섯 viewport에서 확인했습니다. 오늘, 학습, 평가, 성적·근거, 위스, 일정, 출석, 공지, 역사사전, 지난 학기 화면의 대표 screenshot을 남겼습니다.

## 7. Teacher / Admin UI Integration

교사 IA는 업무 홈, 학생과 학급, 수업 운영, 평가 운영, 성적 운영, 위스 운영, 일정과 소통을 기준으로 정리했습니다. 업무 홈은 미처리 출석, 성적·위스 업무 경로, 공개 예정 학습·공지, Draft·Bulk 상태, readiness를 읽기 전용으로 보여 줍니다.

학생 목록은 responsive data container와 명확한 행 동작을 사용합니다. 학습·일정·출석·공지 운영은 W8 canonical 화면을, Draft·Bulk 상태는 W9 공통 component를 사용합니다. 교사 canonical route 13개를 다섯 viewport에서 확인했습니다.

## 8. Navigation

학생 Bottom Navigation과 교사 Sidebar·mobile drawer는 viewport별로 하나만 mount합니다. Header의 NotificationBell도 한 번만 mount하며 drawer에는 같은 query를 다시 실행하지 않는 숫자 요약만 둡니다. skip link와 `aria-current`를 유지하고, role에 맞지 않는 route는 권한 상태 또는 안전한 기본 화면으로 보냅니다.

## 9. Page Layout / Information Hierarchy

주요 화면은 Page Title, 학기·출처, 상태, 요약, 본문, 관련 이동 순서를 따릅니다. `PageHeader`가 page-level `h1`을 소유하고, standalone 응시 화면만 자체 `h1`을 사용합니다. Primary Action을 제한하고 위험한 작업은 문구·확인 단계·색상을 함께 사용합니다.

## 10. Common UI States

`LOADING`, `CONTENT`, `EMPTY`, `ERROR`, `PERMISSION`, `SESSION_EXPIRED`, `MAINTENANCE`, `ARCHIVED`, `LEGACY`, `STALE`, `OFFLINE`, `SAVING`, `SAVED`, `SAVE_FAILED`, `CONFLICT`, `SUBMITTING`, `PROCESSING`, `PARTIAL_SUCCESS`를 공통 상태 체계에 포함했습니다.

각 상태는 제목, 설명, 다음 행동, 문의 필요 여부와 read-only 의미를 함께 전달합니다. loading과 empty, error를 같은 화면으로 처리하지 않으며, Draft와 공식 저장, Bulk 부분 성공과 전체 성공을 구분합니다.

## 11. Form / Dialog / Table

Form은 항상 보이는 label, required 표시, field 설명, 서버 오류, Draft 상태와 저장 행동을 구분합니다. Dialog는 focus trap, Escape, 배경 scroll 차단, focus restore를 갖추고, Drawer·mobile Sheet는 상세와 간단한 선택에만 사용합니다.

대표 학생·교사 표에는 `ResponsiveDataContainer`를 적용해 keyboard로 overflow 영역에 접근할 수 있게 했습니다. 390px에서는 핵심 열과 동작을 우선하며, 1024px 이상에서는 정보 밀도를 높였습니다.

## 12. Semester / Provenance

모든 W6~W9 화면은 `CURRENT`, `PREPARING`, `ARCHIVE`, `LEGACY`, `EXPLICIT`을 같은 badge와 설명으로 표시합니다. 학년도·학기, 출처, 수정 가능 여부를 색상 외 텍스트로 전달합니다. ACTIVE CURRENT만 수정할 수 있으며, CURRENT가 비었다는 이유로 Legacy를 조용히 표시하지 않습니다.

## 13. Maintenance Page

Maintenance 화면은 새 아이콘을 만들지 않고 Westory wordmark를 크게 사용합니다. 파랑·노랑 브랜드 색상, 이용약관, 개인정보 보호 약관, `westoria28@gmail.com` 문의를 유지했습니다. 재개 시각이 정해지지 않은 경우 임의 시간을 표시하지 않습니다.

Staging에서만 Maintenance를 일시 활성화해 390×844와 1600×900을 확인했습니다. 학생 route가 모두 Maintenance로 귀결되는 것을 확인한 뒤 원래의 Staging 비활성 상태로 즉시 복구했습니다. Production Maintenance는 마지막 확정값 `enabled=true`, revision `3`을 문서 근거로만 유지했으며 조회·변경하지 않았습니다.

## 14. Responsive Integration

정확한 390×844, 768×1024, 1024×768, 1280×800, 1600×900 viewport를 사용했습니다. 학생 17개와 교사 13개 canonical route, alias 4개를 다섯 크기에서 모두 확인했습니다.

총 184개 route·viewport 증거에서 horizontal overflow, Navigation overlap, Dialog viewport escape가 모두 0이었습니다. 1280px 역사사전 workspace의 sidebar 포함 가용 폭 문제와 전역 box sizing 누락을 실제 화면에서 찾아 수정했습니다.

## 15. Accessibility

정적 접근성 gate 22개와 실제 keyboard 흐름을 함께 확인했습니다. login label·autocomplete, skip link, landmark, heading, visible focus, 44px touch target, 저장 상태 live text, 색상 외 상태 표현을 점검했습니다.

Draft 복구 Dialog에서 focus 진입과 Escape 종료를 실제로 수행했고, destructive `임시 저장 폐기`와 `작성 내용 복구`를 명확히 구분했습니다. 다섯 viewport 접근성 결과에서 critical·serious 항목은 0입니다.

## 16. Microcopy

학생 안내는 짧고 행동 중심으로, 교사 안내는 업무 의미가 분명하게 정리했습니다. `임시 저장`, `공식 저장`, `Archive`, `Legacy`, `정정`, `확인`, `서명`, `부분 성공`을 서로 바꾸어 쓰지 않았습니다. 오류는 원인과 다음 행동을 함께 안내합니다.

## 17. Performance / Bundle

전역 Tailwind와 Font Awesome CDN 의존성을 제거하고 local build로 고정했습니다. route-level lazy loading과 Domain chunk 분리는 유지했습니다.

최종 gate 기준 주요 수치는 다음과 같습니다.

- main JavaScript: 168,282 bytes, W9 대비 +827 bytes
- main CSS: 317,064 bytes, gzip 59,114 bytes
- 초기 WOFF2 network: 183,692 bytes / 190,000-byte gate
- 외부 전역 CDN: 0

PDF worker, PDF·Chart·Excel, Settings·Assessment의 큰 chunk는 초기 로그인 bundle에 합치지 않았습니다. tab-level 추가 분할은 W11/W12 성능 개선 후보로 넘깁니다.

## 18. Storage Staging Path

W10 판정은 `EXPLICITLY_UNAVAILABLE`입니다. 지도와 사료 보관함은 owner binding, checksum, TTL, promote, receipt, semester·Archive fence를 모두 갖춘 완결된 staging 경로가 없습니다.

UI는 업로드·수정·삭제를 작동하는 것처럼 표시하지 않고 조회 전용 제한을 안내합니다. Firestore·Storage Rules는 이전 번들의 지도·사료 직접 mutation 54개를 거부하며 기존 immutable read는 유지합니다. Production Storage 접근은 0입니다.

## 19. Release Decisions

8개 항목을 모두 분류했습니다.

- ALREADY_DECIDED: DIC01, DIC02, PATCH01 — 3개
- SAFE_CONFIGURABLE_DEFAULT: EX03, SRC01 — 2개
- USER_DECISION_REQUIRED: EX06, MAP01, MAP02 — 3개

자세한 근거와 재활성화 조건은 `docs/handoff/w10-release-decision-register.md`에 기록했습니다. 결정되지 않은 공개·성적·Storage 정책을 W10이 임의로 정하지 않았습니다.

## 20. Route / Visual Regression

route 결과 184개, viewport 결과 184개, network write 결과 184개가 모두 PASS했습니다. 학생·교사 canonical, alias, 익명 보호 route, 교차 role, 세션 만료, Not Found를 포함합니다. direct URL, 새로고침, role 차단과 canonical redirect를 확인했습니다.

버튼이 보이지만 실행할 수 없는 fake success, Archive 편집 버튼, Legacy의 Current 오표시, hidden NotificationBell 중복 query는 제거했습니다. 실제 screenshot과 JSON 결과는 `docs/evidence/w10-ui-ux/w10-20260812-final-925533f`에 있습니다.

## 21. W2–W9 Regression

`npm run verify:w10-ui-ux`가 W2~W9 command·query·Rules·Functions·emulator 회귀와 W10 UI·Rules·bundle·TypeScript·format을 순서대로 실행합니다. 최종 검증에서 direct-write boundary는 156개 승인 항목, command inventory 28개, `UNKNOWN=0`이었습니다.

W8·W9 query purity와 W10 presentation query purity에서 mount, list, detail, listener, preview, unmount business write가 모두 0이었습니다. Functions와 Rules의 previous-bundle 차단도 유지했습니다.

## 22. Dedicated Staging

최종 UI는 `dpl_EczpyUAh5VmSdEh8NtWcbZ7kvMKR`에 배포하고 고정 Staging alias에 연결했습니다. Firestore Rules, Storage Rules와 필요한 index는 Dedicated Staging에만 반영했습니다. Functions 변경은 없어 배포하지 않았습니다.

합성 학생·교사로 Staging 로그인, 학생 Today, 교사 업무 홈, Draft 저장·동일 UID 재로그인 복구, 세션 만료, Maintenance, 권한 없음, Not Found를 확인했습니다. App Check allowlist나 임시 Preview 허용 domain을 추가하지 않았습니다.

## 23. Fixture / Token Cleanup

합성 Auth 계정 2개, fixture 문서 6개, application session, 합성 Draft, command receipt·audit를 exact owner와 `testRunId`로 정리했습니다. 최종 residual Auth, fixture, session, business document, receipt, audit, token은 모두 0입니다.

임시 비밀번호 파일과 Maintenance 복구 state를 삭제했습니다. App Check debug token, Vercel bypass token, 임시 domain은 생성하지 않았습니다. emulator·Java·Node 잔존 process와 5001·8080·9099·9150·9199 listener도 0입니다.

## 24. Production Safety

Production Firestore, Storage, Auth, Rules, Functions, Vercel, alias, environment variable, Maintenance, 활성 학기, App Check, GitHub Pages 변경은 모두 0입니다. `history-quiz-yongsin` 접근은 safety fence가 차단합니다. main branch에는 push하지 않습니다.

## 25. W11 Handoff

`docs/handoff/w11-semester-cutover-preparation-handoff.md`에 최종 route, 2026-2 master data, selector row, source·read-only 표현, Dashboard projection, 2026-1 Archive 조건, Storage 제한, Release Decision, KI-W1-01, shadow validation과 acceptance criteria를 기록했습니다.

W11은 UI 구조를 다시 설계하지 않고 2026-2 master 생성, selective clone, count·join·hash shadow validation과 cutover readiness에 집중합니다.

## 26. Release Blockers

- `KI-W1-01`: 일부 환경에서 재인증 뒤 `users/{uid}` probe가 permission-denied로 실패합니다. W10 변경으로 기본 세션 회귀가 악화되지는 않았습니다.
- EX06, MAP01, MAP02, SRC01: 운영 출시 범위에 포함하려면 canonical command·Storage 계약이 필요합니다.
- DIC01, DIC02, PATCH01: Production 승격 전 W12 Gateway·receipt migration이 필요합니다.

이 항목들은 W10 UI·UX 통합과 W11 Staging shadow validation 진입을 막지 않습니다.

## 27. Rollback

UI rollback은 W9 Full SHA 또는 W10 이전 Vercel deployment로 고정 alias를 되돌리는 방식입니다. W10의 지도·사료 deny-only Rules를 되돌리면 이전 번들의 직접 mutation 경로가 다시 열리므로 일반 rollback 대상이 아닙니다. UI만 되돌리더라도 안전 fence는 유지합니다.

W10은 canonical Domain data migration을 수행하지 않았으므로 데이터 rollback은 필요하지 않습니다. 합성 fixture는 모두 제거했습니다.

## 28. Final W11 Readiness

- 전체 route inventory와 분류: PASS, `UNKNOWN=0`
- 학생 17개·교사 13개 canonical UI: PASS
- alias·직접 URL·role·session·Not Found: PASS
- 다섯 viewport·접근성·공통 상태: PASS
- Query Purity·direct SDK·previous bundle 차단: PASS
- W2~W9 aggregate 회귀: PASS
- Dedicated Staging·evidence·cleanup: PASS
- Production 변경: 0
- TypeScript: 기존 63 errors / 13 files, W10 신규 0
- W10 CURRENT-WAVE blocker: 0

최종 판정:

`READY FOR W11 SEMESTER CUTOVER PREPARATION STAGING DEVELOPMENT`
