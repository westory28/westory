# Student Maintenance Gate Mainline Integration

작성일: 2026-08-11

기준 branch: `codex/phase6-w5-global-shell-common-ui`

## 통합 방식

Production 기준이 오래된 `hotfix/student-maintenance-gate` branch를 merge하거나 cherry-pick하지 않았습니다. hotfix SHA `6120f08c07f92a1b3939d34a416fb36726576d78`의 기능 계약을 읽고 W4 인증·application session·Command Gateway·Archive·Rules 구조에 수동으로 이식했습니다.

가져오지 않은 항목은 구형 AuthContext, session 없는 Login 흐름, hardcoded Firebase fallback, 단순 onCall alias 교체, 구버전 `vercel.json`, history.replaceState 처리입니다.

## Canonical 설정

경로: `site_settings/student_maintenance`

Exact 9 fields:

- `enabled`
- `blockedRoles`
- `bypassUids`
- `title`
- `message`
- `startedAt`
- `updatedAt`
- `updatedBy`
- `revision`

문서 미존재는 disabled입니다. 필드 누락·추가, 타입 오류, 비정규 문자열, 잘못된 blocked role, 중복·비문자·20개 초과 bypass UID는 malformed이며 학생에 대해 fail-closed합니다. title, message, updatedBy와 bypass UID는 client, Functions, Firestore Rules, Storage Rules에서 같은 trim·길이 계약을 사용합니다.

## Client Gate

Auth bootstrap과 Login은 deduplicated maintenance/profile preflight를 사용합니다. 차단 학생은 다음 작업 전에 `/maintenance`로 이동합니다.

- application session 생성
- config·menu load
- user listener
- protected provider와 page child mount

설정이 실시간으로 활성화되면 이미 로그인한 학생도 보호 화면에서 빠져나옵니다. 비활성화 뒤 token refresh가 오래 걸릴 때는 bounded resolution guard가 error/retry 상태로 전환합니다.

## Server Fence

기존 application session 검사를 제거하지 않고 maintenance 판정을 앞단에 합성했습니다.

- `openApplicationSession` 포함 session callables
- `index.js`의 callable exports
- Command Gateway
- Archive Enrollment
- Source Archive
- Lesson PDF와 Source Archive Storage triggers

Firestore와 Storage의 `canUseWestory`는 session과 maintenance를 모두 통과해야 합니다. pre-session bootstrap 예외는 maintenance config와 본인 `users/{uid}` read에만 적용됩니다. maintenance 설정과 audit의 client direct write는 거부됩니다.

## 관리자 복구

`updateStudentMaintenanceConfig`는 App Check, 관리자 권한, recent auth, high-risk application session, expected revision을 요구합니다. 설정과 audit event는 하나의 transaction에서 기록됩니다. malformed 설정을 복구할 수 있지만 인증·세션 검사는 우회하지 않습니다.

## 검증 결과

- Functions schema·guard unit: 44 PASS
- 실제 callable/session emulator integration: 57 PASS
- Firestore·Storage Rules: 64 PASS
- enabled student: route 차단, application session create 0, server read/write/callable deny
- 기존 active student session: touch 즉시 deny, lastTouch 불변
- teacher/admin/bypass: 정상 Shell과 대표 server 접근
- disabled/absent: 학생 정상 복구
- malformed/extra field: fail-closed
- 20번째 bypass UID까지 타입·길이·공백 검증
- Production access in emulator: 0

## 환경 상태

- Dedicated Staging: 문서 미존재, 기본 disabled, 합성 enabled 시나리오는 emulator에서만 검증
- Production 최종 읽기 전용 확인: enabled, revision 3
- W5 Production mutation: 0

작업 초기에는 Production 문서가 404였고 최종 확인에서는 enabled revision 3이었습니다. 병렬 Maintenance hotfix 운영이 반영된 상태로 보이며, W5에서는 이를 읽기만 했습니다.

## Rollback

W5를 rollback할 때는 W5 commit을 revert하고 Dedicated Staging Rules·Functions를 W4 기준으로 되돌립니다. Staging maintenance는 기본 문서 미존재 상태이므로 별도 데이터 rollback이 없습니다. Production maintenance 설정과 hotfix 배포는 별도 운영 단위이며 W5 rollback에서 변경하지 않습니다.

## 운영 주의

- Production 설정 변경은 recovery callable과 별도 승인 절차만 사용합니다.
- client console, 직접 SDK, Firestore console 수동 편집을 rollback 경로로 사용하지 않습니다.
- bypass UID는 최소한으로 유지하고 revision과 audit을 확인합니다.
- KI-W1-01은 별도 RELEASE BLOCKER이며 Maintenance Gate에서 우회하거나 재정의하지 않습니다.
