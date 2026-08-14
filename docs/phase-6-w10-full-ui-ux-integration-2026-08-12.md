# PHASE 6 W10 전체 UI·UX 통합 결과 정정 보고서

최초 작성일: 2026-08-12

정정일: 2026-08-14

작업 branch: `codex/phase6-w10-full-ui-ux-integration`

W10 Full SHA: `216d3076bcf558a6abdf6e1b02b6c9e09d782d00`

W10 UI 배포 기준 SHA: `f7d92d6cc2761acb762a68db9bfe313485139062`

## 1. Executive Summary

W10은 W2부터 W9까지 구축한 기능을 공통 Shell, 상태 표현, 반응형 컨테이너와 디자인 토큰에 연결했습니다. route inventory, Query Purity, direct-write 차단, Rules, Functions, build, TypeScript 기준선과 이전 Wave 회귀는 통과했습니다. 이 기능·안전 기반은 유효합니다.

그러나 UI·UX 통합과 시각적 완성은 통과하지 못했습니다. 2026-08-14 실제 Staging 화면을 확인한 사용자는 다음과 같이 평가했습니다.

> 지금 UI UX가 엉망이야. 진짜 전에 디자인이 훨씬 나을 정도야. 너무 별로야.

이 평가는 취향 차이로 축소할 수 없습니다. W10의 목표 자체가 전체 화면의 UI·UX 통합과 시각적 완성이었으므로 사용자 검수 실패는 완료 조건 실패입니다. 대표 화면을 다시 확인한 결과, 정보 위계가 약하고 빈 공간이 과도하며, 기존 화면과 새 공통 component가 섞여 보이고, 모바일 화면에는 겹침과 잘림이 남아 있습니다.

기존 보고서는 route와 쓰기 안전성 검증을 시각 품질 검증처럼 확대 해석했습니다. screenshot 파일도 32개 중 25개가 파일명에 표시된 viewport 크기와 실제 이미지 크기가 달랐습니다. 따라서 기존의 “5개 viewport PASS”, “W10 CURRENT-WAVE blocker 0”, “READY FOR W11” 판정을 철회합니다.

정정된 최종 판정은 다음과 같습니다.

`NOT READY FOR W11 SEMESTER CUTOVER PREPARATION STAGING DEVELOPMENT`

이 판정은 W11의 서버·데이터 준비 작업을 폐기한다는 뜻이 아닙니다. W10의 시각 완성도를 통과한 것으로 간주할 수 없다는 의미입니다.

## 2. Baseline

- W9 branch: `codex/phase6-w9-teacher-operations-draft-bulk`
- W9 Full SHA: `9f9cf691dc72669384a23bf6a23c5081cf8f09bd`
- W10 branch: `codex/phase6-w10-full-ui-ux-integration`
- W10 Full SHA: `216d3076bcf558a6abdf6e1b02b6c9e09d782d00`
- Dedicated Staging Firebase: `westory-staging-177587430482`
- 고정 alias: `https://westory-staging-westoria28-8028-bbbs-projects-44f9da30.vercel.app`
- W10 최초 Staging deployment: `dpl_EczpyUAh5VmSdEh8NtWcbZ7kvMKR`
- W10 evidence root: `docs/evidence/w10-ui-ux/w10-20260812-final-925533f`
- TypeScript 기준선: 63 errors / 13 files, W10 신규 오류 0

정정 작업은 현재 W11 branch에서 문서만 바로잡습니다. W10 branch의 Git 기록을 다시 쓰지 않습니다. 사용자 문서, W1 evidence와 `tmp/`는 변경하거나 W10 보고서 commit에 포함하지 않습니다.

## 3. Route / Screen Inventory

`scripts/w10-route-inventory.json`에는 등록 화면 47개가 분류되어 있고 `UNKNOWN=0`입니다.

| 분류                 |  수 | 현재 판단                                    |
| -------------------- | --: | -------------------------------------------- |
| COMPLETE             |  18 | 기능 계약은 유지되지만 시각 완료 판정은 철회 |
| INTEGRATE            |   8 | Shell 연결 완료, 사용자 검수 필요            |
| REBUILD_PRESENTATION |  10 | 표현 재구성 품질이 충분하지 않음             |
| REMOVE_LEGACY_UI     |   8 | redirect·alias 보존 여부는 통과              |
| RELEASE_DECISION     |   3 | 정책 경계 유지                               |

학생 canonical route 17개, 교사 canonical route 13개, alias 4개의 존재와 접근 경로는 확인했습니다. 다만 route가 열린다는 사실은 화면이 사용하기 좋거나 시각적으로 완성됐다는 증거가 아닙니다.

## 4. Design Foundation

`DESIGN.md`에는 Westory 파랑 `#2563EB`, 강조 노랑 `#F59E0B`, Noto Sans KR, spacing, radius, border, motion과 breakpoint 기준이 있습니다. 공통 component도 `WestoryBrand`, `FormField`, `ModalSurface`, `StatePanel`, `ResponsiveDataContainer`, `PageHeader` 등으로 정리했습니다.

문제는 토큰의 존재를 디자인 완성으로 오판했다는 점입니다. 실제 화면에서는 다음 결함이 확인됩니다.

- 페이지 제목과 본문 제목이 반복되어 위계가 흐립니다.
- 흰색과 옅은 회색 면이 넓게 이어져 화면이 비어 보입니다.
- 카드, 표, 버튼과 입력 요소의 밀도와 스타일이 화면마다 다릅니다.
- 기능 구획보다 테두리와 박스가 먼저 보여 업무 흐름이 끊깁니다.
- 기존 구형 control과 새 Shell이 한 화면에 함께 남아 통합된 제품처럼 보이지 않습니다.
- 작은 로고, 낮은 대비의 보조 텍스트와 넓은 여백 때문에 큰 화면의 공간을 제대로 쓰지 못합니다.

Design Foundation은 구현 기반으로는 남기되, 실제 화면에 일관되게 적용됐다는 판정은 취소합니다.

## 5. Login / Auth

로그인 화면의 label, autocomplete, loading 중 중복 제출 차단, role 서버 권위와 return path는 유지됩니다. 로그인에서 학생·교사 역할을 선택해 권한을 얻는 경로도 없습니다.

W10 종료 뒤 실제 관리자 로그인을 시도하면서 Dedicated Staging의 Google 공급자가 비활성 상태였음이 드러났습니다. `auth/operation-not-allowed`와 빈 popup이 발생했고, 2026-08-13부터 14일까지 Staging Auth 공급자와 redirect 흐름을 별도로 점검했습니다. Google 공급자는 Dedicated Staging에만 활성화했으며 Production Auth는 변경하지 않았습니다.

이 문제는 W10 로그인 검증이 실제 관리자 경로를 충분히 확인하지 못했다는 뜻입니다. W10 보고서의 “로그인 최종 통합” 표현은 과장됐습니다. KI-W1-01은 기존 Release blocker로 유지합니다.

## 6. Student UI Integration

학생 Today, 학습, 평가, 성적, 위스, 일정, 출석, 공지, Archive route의 기능 연결은 유지됩니다. 화면 진입으로 business write가 발생하지 않는 계약도 유효합니다.

시각 검수는 실패했습니다. `student-today-390x844.png`에는 제목·학기 정보가 반복되고 본문이 좁은 폭에서 어색하게 줄바꿈됩니다. 떠 있는 버튼과 하단 Navigation이 콘텐츠와 경쟁하며, 화면을 한 번에 읽기 어렵습니다. 학생이 지금 해야 할 일을 먼저 이해하도록 만든다는 목표도 충분히 달성되지 않았습니다.

학생 route 17개는 “기능 연결 완료, 시각 통합 미완료”로 정정합니다.

## 7. Teacher / Admin UI Integration

업무 홈, 학생과 학급, 수업·평가·성적·위스·일정 운영 route는 연결되어 있습니다. Draft, Bulk, readiness와 각 Domain 바로가기도 기능적으로 남아 있습니다.

교사 화면은 정보 밀도와 업무 효율을 우선해야 하지만 실제 화면은 반대 문제가 있습니다.

- 업무 홈의 loading 상태는 화면 대부분을 빈 공간으로 남깁니다.
- 업무 우선순위와 다음 행동보다 큰 컨테이너와 약한 구분선이 먼저 보입니다.
- 학생 명단 표는 구형 입력창, 버튼과 새 Shell이 섞여 있습니다.
- 표의 시선 흐름과 행 동작이 촘촘하지 않고, 화면 폭을 효율적으로 쓰지 못합니다.
- Footer와 떠 있는 버튼이 업무 화면의 주의 흐름을 분산합니다.

교사 canonical route 13개 역시 시각 완료로 볼 수 없습니다.

## 8. Navigation

학생 Bottom Navigation, 교사 Sidebar, mobile drawer와 Header의 중복 mount 차단은 기능적으로 통과했습니다. `aria-current`와 route 권한도 유지됩니다.

하지만 메뉴의 크기, 여백, 활성 상태와 본문 사이의 시각 연결이 약합니다. 교사 Sidebar는 넓은 데스크톱에서 지나치게 비어 보이고, 본문은 좌측 Navigation과 별개의 화면처럼 보입니다. Navigation 기능은 유지되지만 W10 시각 통합 완료 항목에서는 제외합니다.

## 9. Page Layout / Information Hierarchy

`PageHeader`와 학기 badge를 도입했지만 실제 화면에서는 페이지 제목, Domain 제목, 학기 제목이 반복됩니다. 같은 정보가 여러 계층에 나타나며, 핵심 행동과 보조 설명의 강조 차이도 부족합니다.

사용자가 현재 위치와 다음 행동을 짧은 시간 안에 파악할 수 있어야 한다는 완료 조건은 통과하지 못했습니다.

## 10. Common UI States

Loading, Empty, Error, Permission, Archived, Legacy, Stale, Saving, Conflict, Processing과 Partial Success 상태 component는 존재합니다. Query Purity도 유지됩니다.

공통 상태가 있다고 해서 상태 화면이 좋은 것은 아닙니다. 실제 Staging 업무 홈의 loading 화면은 작은 안내 카드 하나와 큰 빈 공간으로 구성됩니다. 콘텐츠 구조를 예상하게 하는 skeleton, 섹션별 진행 상태와 다음 행동이 없습니다. 상태 component의 계약은 유지하되 표현은 다시 설계해야 합니다.

## 11. Form / Dialog / Table

label, required 표시, focus, Escape, focus restore와 overflow container는 일부 공통화했습니다. 그러나 대표 교사 표는 여전히 버튼, 입력창, 필터와 페이지 이동 모양이 서로 다른 시각 체계를 사용합니다. 데이터 밀도와 조작 우선순위도 화면별 편차가 큽니다.

Form, Dialog, Table 패턴은 코드 수준 통합에 머물렀습니다. 제품 수준 통합은 미완료입니다.

## 12. Semester / Provenance

`CURRENT`, `PREPARING`, `ARCHIVE`, `LEGACY`, `EXPLICIT`의 서버·UI 경계와 read-only 차단은 유지됩니다. 다만 학기 badge와 현재 학기 표시는 여러 위치에서 반복되어 정보 밀도를 떨어뜨립니다. 상태 의미는 맞지만 표현 방식은 다시 정리해야 합니다.

## 13. Maintenance Page

Westory wordmark, 파랑·노랑 브랜드 색상, 이용약관, 개인정보 보호 약관과 문의 이메일은 유지됩니다. Production Maintenance를 변경하지 않았다는 안전 판정도 유효합니다.

Maintenance 화면은 기능 검증을 통과했으나 전체 사이트의 새 디자인 기준으로 승인받지 못했습니다. W10 시각 완료 근거로 사용하지 않습니다.

## 14. Responsive Integration

기존 보고서의 5개 viewport PASS 판정을 철회합니다.

evidence root의 PNG 32개를 파일명과 실제 이미지 크기로 다시 확인했습니다.

- 일치: 7개
- 불일치: 25개
- `teacher-dashboard-1600x900.png`: 실제 1585×1933
- `student-today-390x844.png`: 실제 375×1712
- `teacher-draft-recovery-dialog-390x844.png`: 실제 375×1876
- `student-history-dictionary-1024x768.png`: 실제 1009×1241

전체 페이지 screenshot과 viewport screenshot이 섞였고 브라우저 scrollbar 폭을 제외한 이미지도 같은 파일명으로 기록됐습니다. 이 상태에서는 정확한 viewport별 레이아웃 판정을 재현할 수 없습니다.

기존 JSON의 horizontal overflow 0도 사용자 화면의 겹침, 잘림과 낮은 공간 활용도를 설명하지 못합니다. Responsive는 미통과입니다.

## 15. Accessibility

정적 접근성 gate 22개, label, landmark, heading과 focus 관련 코드는 유지됩니다. 이 결과는 가치가 있습니다.

다만 실제 화면의 visual focus, 읽기 순서, 반복 heading, 모바일 Navigation과 떠 있는 action의 경쟁은 사용자 경험을 해칩니다. 자동 검사 결과만으로 WCAG 2.2 AA 핵심 흐름을 통과했다고 기록한 것은 부정확했습니다. 수동 keyboard와 screen reader 흐름을 실제 최종 화면에서 다시 검증해야 합니다.

## 16. Microcopy

Draft와 공식 저장, Archive와 삭제, 부분 성공과 전체 성공을 구분한 문구는 유지됩니다. 반면 화면 곳곳의 설명이 비슷한 내용을 반복하고, 제목과 보조 문구가 좁은 화면에서 과도하게 줄바꿈됩니다.

문구 자체만 고칠 문제가 아닙니다. 정보 구조와 함께 다시 편집해야 합니다.

## 17. Performance / Bundle

W10 bundle gate의 수치는 유지합니다.

- main JavaScript: 168,282 bytes, W9 대비 +827 bytes
- main CSS: 317,064 bytes, gzip 59,114 bytes
- 초기 WOFF2 network: 183,692 bytes / 190,000-byte gate
- 외부 전역 CDN: 0

route-level lazy loading과 Domain chunk 분리는 유지됩니다. 성능 수치가 통과했다고 시각 품질까지 통과하는 것은 아닙니다.

## 18. Storage Staging Path

Storage 판정은 `EXPLICITLY_UNAVAILABLE`을 유지합니다. 지도와 사료 보관함은 완결된 owner, checksum, TTL, promote, receipt와 Archive fence가 없으므로 조회 전용입니다. fake success와 Production Storage 대체 경로는 없습니다.

## 19. Release Decisions

8개 Release Decision 분류는 유지합니다.

- ALREADY_DECIDED: DIC01, DIC02, PATCH01, 3개
- SAFE_CONFIGURABLE_DEFAULT: EX03, SRC01, 2개
- USER_DECISION_REQUIRED: EX06, MAP01, MAP02, 3개

세부 근거는 `docs/handoff/w10-release-decision-register.md`를 따릅니다.

## 20. Route / Visual Regression

route 접근, alias, role 차단과 Query Purity는 통과했습니다. Visual Regression은 통과하지 못했습니다.

기존 gate는 버튼 존재, route 이동, overflow 수치와 write 수를 확인했습니다. 다음 항목은 충분히 평가하지 않았습니다.

- 이전 화면보다 실제로 나아졌는가
- 첫 화면에서 업무 우선순위가 보이는가
- 새 component와 legacy control이 하나의 제품처럼 보이는가
- 빈 공간과 정보 밀도가 역할에 맞는가
- 모바일에서 제목, badge, action과 Navigation이 경쟁하지 않는가
- 실제 사용자가 시각 결과를 승인했는가

W10 visual acceptance는 FAIL입니다.

## 21. W2-W9 Regression

`npm run verify:w10-ui-ux`가 확인한 Command Gateway, Rules, Functions, query purity, direct-write boundary와 previous-bundle 차단 결과는 유지합니다. `UNKNOWN=0`, TypeScript 신규 오류 0과 이전 Wave 기능 회귀 통과도 유효합니다.

이 결과는 W10의 기능·안전 기반이 보존됐다는 증거입니다. UI·UX 완료 증거는 아닙니다.

## 22. Dedicated Staging

W10 최초 배포와 고정 alias 연결은 수행했습니다. 이후 실제 관리자 로그인 검증에서 Staging Google 공급자 누락이 발견되어 Dedicated Staging Auth에만 Google 로그인을 활성화했습니다. 이 과정에서 Production Auth, 데이터, Rules, Functions와 Maintenance는 변경하지 않았습니다.

2026-08-14 현재 고정 alias 화면은 기능 검증용으로 접근할 수 있지만, 사용자 시각 승인을 받지 못했습니다. Dedicated Staging UI 판정은 FAIL입니다.

## 23. Fixture / Token Cleanup

W10 당시 합성 Auth, fixture, session, Draft, receipt와 audit cleanup 기록은 유지합니다. W11 로그인 진단 중 access token과 OAuth secret 값은 파일, 보고서와 Git에 저장하지 않았습니다.

Staging Google 공급자 배포에 사용한 임시 `firebase.json` Auth block은 공용 설정에서 제거했습니다. 외부 Staging 공급자는 실제 관리자 검증에 필요한 환경 기능이므로 유지합니다. Production provider는 조회하거나 변경하지 않았습니다.

## 24. Production Safety

W10과 이번 정정에서 Production Firestore, Storage, Auth, Rules, Functions, Vercel, alias, environment variable, Maintenance, 활성 학기와 App Check 변경은 0입니다. main branch에는 push하지 않습니다.

## 25. W11 Handoff

기존 W11 handoff의 master data, Current·Preparing·Archive·Legacy 경계, selector, shadow validation과 Storage 제한은 유효합니다.

다만 “W11은 UI 구조를 다시 설계하지 않는다”는 전제는 철회해야 합니다. W11 데이터 전환 기능을 개발하더라도, 사용자가 보는 전환 화면과 공통 Shell을 완료로 판정할 수 없습니다. 시각 수정 작업은 별도 하위 Wave를 무한히 만드는 대신 현재 UI 부채 목록으로 관리해야 합니다.

## 26. Release Blockers

W10 정정으로 다음 blocker를 추가합니다.

- `UI-W10-01`: 사용자 시각 검수 실패. 이전 디자인보다 나빠졌다는 명시적 평가
- `UI-W10-02`: screenshot 32개 중 25개의 declared viewport와 실제 크기 불일치
- `UI-W10-03`: 학생 모바일 Today의 반복 heading, 잘림, action·Navigation 경쟁
- `UI-W10-04`: 교사 업무 홈과 데이터 화면의 낮은 공간 활용, 약한 정보 위계와 legacy 혼재
- `UI-W10-05`: 자동 gate 중심 판정으로 실제 사용자 승인 절차 누락

기존 Release blocker도 유지합니다.

- `KI-W1-01`: 일부 환경에서 재인증 뒤 `users/{uid}` probe permission-denied
- EX06, MAP01, MAP02, SRC01: 공식 command·Storage 계약 필요
- DIC01, DIC02, PATCH01: Production 전 Gateway·receipt migration 필요

## 27. Rollback

기능과 보안 fence를 함께 되돌리지는 않습니다. UI를 되돌릴 경우 W9 Full SHA와 W10 이전 화면을 실제 사용자와 나란히 비교하고, 더 나은 presentation만 선택적으로 복원해야 합니다.

지도·사료 direct mutation deny, Query Purity와 canonical Domain 계약은 유지합니다. 시각 rollback이 보안 rollback이 되어서는 안 됩니다.

## 28. Final W11 Readiness

| 항목                            | 결과    |
| ------------------------------- | ------- |
| route inventory·UNKNOWN 0       | PASS    |
| Query Purity·direct-write guard | PASS    |
| W2-W9 기능·Rules·Functions 회귀 | PASS    |
| TypeScript 신규 오류 0          | PASS    |
| Design Foundation 코드 기반     | PARTIAL |
| 학생 UI 시각 통합               | FAIL    |
| 교사·관리자 UI 시각 통합        | FAIL    |
| 정확한 5 viewport evidence      | FAIL    |
| 실제 사용자 visual acceptance   | FAIL    |
| W10 CURRENT-WAVE blocker 0      | FAIL    |
| Production 변경 0               | PASS    |

정정된 최종 판정:

`NOT READY FOR W11 SEMESTER CUTOVER PREPARATION STAGING DEVELOPMENT`

W10은 기능·안전 통합 기반을 만들었지만 UI·UX 통합과 시각적 완성에는 실패했습니다. 다음 판정은 정적 검사만으로 내리지 않습니다. 실제 Staging에서 390, 768, 1024, 1280, 1600 viewport를 정확히 캡처하고, 핵심 학생·교사 흐름을 사용자가 직접 승인한 뒤에만 갱신합니다.
