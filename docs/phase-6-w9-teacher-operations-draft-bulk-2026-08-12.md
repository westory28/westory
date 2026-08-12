# PHASE 6 — W9 Teacher Operations, Draft Recovery & Bulk Workflow

작성일: 2026-08-12

기준 브랜치: `codex/phase6-w9-teacher-operations-draft-bulk`

기준 SHA: `f478746f41fdccfe417f548bc8a70f0deb2a0b55`

Dedicated Staging: `westory-staging-177587430482`

## 1. Executive Summary

W9에서는 교사 작성 내용을 서버 Draft로 안전하게 보관하고, 공식 저장과 분리해 복구·충돌·폐기·만료를 다룰 수 있는 공통 계약을 구축했습니다. 출석 대표 흐름에는 선택, 실행 전 안내, 명시적 실행, 결과 정합, 실패 항목 재시도를 연결했습니다. 업무 홈은 Draft·Bulk·W8 운영 상태·학기 readiness를 수정 없이 조회합니다.

교사 편집 화면 51개와 Bulk 작업 10개를 모두 분류했고 `UNKNOWN`은 0입니다. W9가 실제로 공통 Draft를 필요로 하는 공지 생성·수정, 학습, 일정의 네 편집 surface에는 동일한 adapter를 적용했습니다. 평가·성적·위스처럼 이미 Domain Draft가 있는 화면에는 중복 저장소를 만들지 않았습니다.

## 2. Baseline

- 시작 SHA: `f478746f41fdccfe417f548bc8a70f0deb2a0b55`
- 시작 브랜치: `codex/phase6-w8-learning-schedule-communication`
- 작업 브랜치: `codex/phase6-w9-teacher-operations-draft-bulk`
- Production 접근·변경: 0
- 사용자 문서 `AGENTS.md`, `DESIGN.md`, `UI_RULES.md`, W1 evidence, `tmp/`: 보존 및 W9 commit 제외
- Production Maintenance: 조회·변경하지 않음. 마지막 확정 상태 `enabled=true`, revision `3`

## 3. Teacher Editing Surface Inventory

`scripts/w9-editor-surface-manifest.json`에 교사 편집 surface 51개를 고정했습니다. 각 행은 파일, 식별 anchor, 분류 근거, 완료 상태, adapter를 가집니다. 현재 route에 mount되지 않는 이전 화면과 canonical redirect도 명시적으로 구분했습니다.

## 4. Draft Classification

| 분류                |  수 |
| ------------------- | --: |
| DRAFT_REQUIRED      |   4 |
| DOMAIN_DRAFT_EXISTS |  10 |
| COMMAND_ONLY        |  20 |
| READ_ONLY           |   1 |
| NOT_APPLICABLE      |   8 |
| RELEASE_DECISION    |   8 |
| UNKNOWN             |   0 |

`DRAFT_REQUIRED`는 공지 생성·수정(D01/D02), 일정(SCH01), 학습(LES01)입니다. 모두 `W8TeacherHub`의 실제 canonical editor에 `useTeacherDraft`로 적용했습니다. 파일·XLSX·패치 메모처럼 공식 Gateway receipt 또는 private asset staging 계약이 없는 항목은 Draft를 억지로 붙이지 않고 Release Decision으로 남겼습니다.

## 5. Draft Data Contract

- canonical collection: `teacher_drafts`
- deterministic key: owner UID + semester + route + surface + entity + client draft ID
- 상태: `ACTIVE`, `CONFLICT`, `SAVED`, `DISCARDED`, `EXPIRED`
- TTL: 마지막 저장 후 30일
- CAS: `draftRevision`과 `baseEntityRevision`
- 저장 metadata: payload schema/version/hash, intended official command type/hash, 만료 시각
- direct SDK read/write: Rules에서 전부 차단
- terminal 상태: payload와 staged asset metadata를 즉시 purge하고 최소 감사 metadata만 보존

## 6. Draft Save / Recovery

빈 화면 mount, focus, query, 새로고침에서는 Draft write가 발생하지 않습니다. 실제 입력으로 dirty가 된 뒤 공통 debounce에서만 `saveTeacherDraft`를 실행합니다. 저장 중·저장 완료·실패·충돌·복구 가능 상태는 화면에 지속해서 표시합니다.

Staging에서 학습 Draft를 작성한 뒤 로그아웃하고 동일 UID로 다시 로그인했습니다. 복구 대화상자에서 route, surface, 대상, revision, 보관 기한을 확인하고 작성 내용을 복원했습니다. 공식 `createLearningContent` receipt 성공 뒤 `resolveTeacherDraft`가 실행되어 Draft payload가 정리됐습니다. 별도 합성 Draft는 `discardTeacherDraft`로 폐기했으며 재인증 없이 완료됐습니다.

## 7. Session / Re-login Recovery

- 동일 UID 재로그인: 복구 PASS
- 다른 UID·교차 UID query: 서버·Emulator에서 0건 PASS
- return route: `/teacher/learning` 유지 PASS
- Draft 없음: 빈 복구 안내 반복 0
- 공식 저장 전 canonical mutation: 0

W9 low-risk 명령인 Draft 저장·폐기·공식 저장 확인은 일반 active session을 사용합니다. 만료 정리와 Bulk 3종만 recent-auth/high-risk를 요구합니다. 실제 Staging에서 발견한 과도한 step-up을 이 정책으로 바로잡았습니다.

## 8. Multi-tab / Multi-device Conflict

같은 Draft revision의 stale save는 CAS로 거부합니다. 동일 canonical entity를 서로 다른 client draft로 편집한 경우, 한 Draft의 공식 저장 receipt를 확인하면 형제 Draft를 `CONFLICT / BASE_ENTITY_REVISION_CHANGED`로 전환합니다. 이후 일반 저장으로 `ACTIVE`를 되살리거나 payload를 덮을 수 없고 `W9_DRAFT_REBASE_REQUIRED`로 차단됩니다. bounded sibling query는 최대 20개이며 초과 시 fail-closed입니다.

## 9. Draft TTL / Cleanup

`cleanupExpiredTeacherDrafts`는 명시적 고위험 관리자 명령입니다. 화면 조회나 Draft 목록 mount에서 cleanup을 실행하지 않습니다. ACTIVE 학기뿐 아니라 CLOSED/ARCHIVED 학기의 만료 metadata도 canonical data를 건드리지 않고 정리할 수 있습니다. payload, staged assets, payload purge 시각을 보존 정책에 맞게 처리하며 canonical mutation count는 0입니다.

## 10. Domain Draft Adapters

- W9 공통 Draft: 공지 생성·수정, 학습, 일정
- W6A Assessment: Domain Definition Draft 유지
- W6B Grade: Grade Draft/version 유지
- W7 Wis: Product Draft lifecycle 유지
- 학적·학기·원장·주문: Draft가 아닌 기존 원자 command 유지
- LEGACY 생각모아: read-only adapter 유지

## 11. Bulk Operation Inventory

| 분류             |  수 |
| ---------------- | --: |
| BULK_FRAMEWORK   |   2 |
| DOMAIN_ATOMIC    |   2 |
| SINGLE_COMMAND   |   1 |
| NOT_APPLICABLE   |   1 |
| RELEASE_DECISION |   4 |
| UNKNOWN          |   0 |

공통 framework 대상은 W8 출석과 W6B 성적 lifecycle입니다. W7 계정 생성과 W4 roster import는 각 Domain의 원자 command를 유지합니다. 공지 대상 지정은 하나의 원자 명령입니다.

## 12. Selection / Preview

대표 출석 Bulk는 현재 canonical Attendance Session과 ACTIVE Enrollment projection에서만 대상을 선택합니다. 학급·session signature가 바뀌면 선택을 다시 계산합니다. 실행 전 대상 수, 영향, 정책과 현재 상태를 표시하고 preview 조회만으로 job이나 attendance record를 만들지 않습니다.

## 13. Batch Command

- canonical collection: `teacher_bulk_jobs`
- 정책: `ALL_OR_NOTHING`, `ITEMIZED_PARTIAL`
- item 상한: 100
- 정규화 payload 상한: 300,000 bytes
- deterministic child command ID와 payload hash
- W2 receipt/audit를 통한 결과 reconciliation
- 응답 유실 시 동일 child command ID로 상태 복구
- direct SDK read/write 및 previous bundle 우회 차단

Bulk job은 기존 Domain command를 대신 실행하지 않습니다. UI가 서버가 발급한 child command ID로 기존 Domain Gateway를 실행하고, W9는 receipt를 검증해 결과를 조정합니다.

## 14. Partial Failure / Retry

Staging에서 첫 출석 Bulk는 1명의 합성 Enrollment를 `PRESENT`로 원자 기록했습니다. 두 번째 흐름에서는 다른 탭이 Attendance Session을 먼저 닫게 해 CAS 실패를 의도적으로 만들었습니다. UI는 실패 작업과 사유를 표시했고, `실패 항목 다시 실행`에서 성공 항목이 아닌 실패 항목에만 새 command ID를 발급했습니다. 닫힌 session은 재시도에서도 안전하게 실패해 무음 부분 성공과 중복 출석 effect가 없었습니다.

## 15. Representative Domain Bulk Workflows

- W8 출석: W9 selection/result/retry UI + `recordAttendanceBulk`
- W6B 성적: 기존 finalize/publish Domain command + W9 lifecycle 상태 계약
- W7 Wis 계정 생성: 기존 Domain 원자 command 유지
- W8 공지 대상: 단일 `createNotice` command 유지
- W4 roster import: 기존 preview/import 원자 계약 유지

## 16. Teacher Work Home

업무 홈은 최근 active/recent terminal Draft·Bulk를 기본 50, 최대 100 범위 안에서 조회합니다. W8 출석 미처리, 공개 예정 학습, 학기 readiness를 read-only로 연결했습니다. Grade, Wis, 공지는 전량 client 조합을 만들지 않고 각각의 authoritative 운영 화면으로 이동시킵니다. mount 시 Draft touch, 업무 완료, retry, canonical repair는 0입니다.

## 17. Responsive Work Patterns

업무 홈, 학습 Draft, 출석 Bulk를 390×844, 768×1024, 1024×768, 1280×800, 1600×900에서 확인했습니다. 다섯 viewport 모두 document horizontal overflow 0, main landmark 1개, navigation 겹침 0이었습니다. 출석 실패 재시도 버튼은 전 viewport에서 179×44px로 접근 가능했습니다.

학생 대표 화면은 W8 Shell과 Domain UI를 변경하지 않았고 W6B~W8 회귀 aggregate에서 390/1024/1600 구조가 유지됨을 확인했습니다.

## 18. Data-heavy UI

390px에서는 출석 입력 form과 대상 상태를 세로로 배치하고 주요 실행 버튼을 전체 폭으로 유지합니다. 768/1024px에서는 list-detail 균형을 사용하고 1280/1600px에서는 출석부 목록과 결과를 나란히 표시합니다. 대규모 성적·roster 표는 기존 Domain 화면과 ResponsiveDataContainer 계약을 유지하며 W10의 시각 통합 대상으로 넘깁니다.

## 19. Accessibility

- Draft 상태: text와 live status로 전달
- 복구 대화상자: dialog semantics, 초기 focus, Escape, focus restore 확인
- 복구·폐기: 서로 다른 명확한 accessible name
- Bulk 선택 수·상태·실패: 색상 외 text 제공
- 출석 상태 select: 학생 이름과 연결된 label
- 주요 실행·재시도: 최소 높이 44px
- main landmark 1개, skip link 유지
- reduced motion 및 기존 W5 focus token 유지

## 20. Query Purity / Direct Write Boundary

`verify:w9-query-purity` 결과 mount/list/query/preview/unmount business command는 모두 0입니다. 허용된 자동 write는 실제 dirty 입력 뒤 `saveTeacherDraft` debounce 한 종류뿐입니다. client direct read/write 0, localStorage/sessionStorage Draft 0, cross-UID client query 0입니다.

Direct-write boundary는 approved 156, query callable factory 12, fetch 2, `UNKNOWN=0`입니다. `teacher_drafts`, `teacher_bulk_jobs` 및 previous bundle direct SDK는 Rules에서 거부합니다.

## 21. Regression

- W9 Functions unit: 34 cases PASS
- W9 commands: 7, readiness: 1
- bounded query reads: 15, read-after-write: 0
- W9 Rules: denied operation 40 PASS
- W6B/W7/W8/W9 Emulator regression: PASS
- build: 381 modules PASS
- TypeScript: 기존 63 errors / 13 files 유지, W9 신규 오류 0
- format, diff-check: PASS
- emulator 잔존 process/port: 0

## 22. Dedicated Staging

- Firebase project: `westory-staging-177587430482`
- Vercel deployment: `dpl_5MU9MjfyV3n2bhRsbTrVa5Er1hpC`
- fixed alias: `https://westory-staging-westoria28-8028-bbbs-projects-44f9da30.vercel.app`
- alias target: `westory-staging-7ki7cpl5r-bbbs-projects-44f9da30.vercel.app`
- App Check 신규 allowlist/debug token/bypass token: 0
- query write: 0, cross-UID read: 0, archive mutation: 0
- Staging command types: save/discard/resolve Draft, create/reconcile/retry Bulk 6종 PASS

## 23. Fixture / Token Cleanup

검증 후 business 문서 8개, receipt/audit 30개, fixture 문서 6개, application session 4개, 합성 Auth 계정 2개를 삭제했습니다. 잔존 Auth, Draft, Bulk job, business 문서, receipt/audit, session, token은 모두 0입니다.

## 24. Production Safety

Production Firestore, Storage, Auth, Rules, Functions, Vercel, alias, 환경 변수, Maintenance, 활성 학기, App Check, GitHub Pages 변경은 0입니다. Production 프로젝트 ID는 Staging fixture가 ADC 초기화 전에 fail-closed로 차단합니다. Production Maintenance는 조회하지 않았으며 마지막 확정 상태 `enabled=true`, revision `3`을 그대로 기록합니다.

## 25. W10 Handoff

구형 data-heavy UI, 파일/XLSX staging, Domain별 상태 문구 차이, mobile table detail, heading 계층과 최종 색상·간격 polish는 `docs/handoff/w10-full-ui-ux-integration-handoff.md`로 넘깁니다. W9 Draft·Bulk 데이터 계약이나 direct-write fence는 W10에서 되돌리지 않습니다.

## 26. Release Blockers

- `KI-W1-01`: 재인증 뒤 일부 환경의 `users/{uid}` probe가 permission-denied로 실패합니다. W9 Staging의 고위험 출석 명령 재인증에서 동일 현상을 한 번 재현했으며, 새 W9 결함으로 확장하지 않고 기존 Release Blocker로 유지합니다.
- Vercel install 단계의 기존 dependency audit 경고(11건)는 W9 기능 변경과 분리해 Release dependency review에서 다룹니다.
- 파일/XLSX/패치 메모의 official receipt 및 private asset staging 정책은 Release Decision입니다.

## 27. Rollback

1. W9 client를 이전 W8 read-only 업무 홈과 Domain 화면으로 되돌립니다.
2. `teacher_drafts`, `teacher_bulk_jobs` direct SDK deny는 유지합니다.
3. W9 callable export를 제거하더라도 canonical collections를 client write로 다시 열지 않습니다.
4. Dedicated Staging Functions, Rules, indexes와 fixed alias를 W8 검증 deployment로 되돌립니다.
5. Draft payload와 Bulk 결과를 삭제하기 전에 owner·semester·receipt evidence를 확인합니다.

## 28. Final W10 Readiness

W9 CURRENT-WAVE blocker는 0입니다. 교사 Draft·복구·충돌·TTL, Bulk 선택·실행·부분 실패·재시도, 업무 홈 projection, Query Purity, direct SDK 차단, Dedicated Staging 및 정리 조건을 충족했습니다.

최종 판정:

`READY FOR W10 FULL UI/UX INTEGRATION STAGING DEVELOPMENT`
