# W9 Teacher Operations / Draft / Bulk Handoff

작성일: 2026-08-12

출발점: W8 Learning, Schedule, Attendance & Communication

## 1. 목적

W8에서 학습·일정·출석·공지의 canonical query와 command 경계를 완성했습니다. W9는 이 계약을 바꾸지 않고 교사 업무의 임시 저장, 반복 입력, 대량 선택, 충돌 복구를 공통 패턴으로 정리합니다.

## 2. 화면별 Draft 필요성

| 화면 | Draft 필요성 | W9 제안 |
| --- | --- | --- |
| Learning 생성·수정 | 높음 | 본문·자료 URL·대상 학급을 로컬 encrypted draft로 보존 |
| Schedule 생성·수정 | 중간 | 시간·대상·sourceReference를 저장 전 검증하고 짧은 draft 보존 |
| Notice 생성·수정 | 높음 | 제목·본문·대상·예약 시간을 함께 복구 |
| Attendance 개별 입력 | 낮음 | canonical record command를 즉시 사용 |
| Attendance bulk | 높음 | session별 작업 묶음과 실패 학생을 재시도 가능하게 보존 |
| Learning 면제·progress reset | 낮음 | 확인 dialog와 명시적 command만 유지 |

Draft는 canonical business document가 아닙니다. 자동 공개·자동 제출하지 않으며, 사용자 확인 없이 서버 상태로 승격하지 않습니다.

## 3. Schedule·Learning·Notice 편집 Draft

- Draft key에는 actorUid, semesterId, domain, targetId, baseRevision을 넣습니다.
- 저장 전에 현재 manifest revision과 target revision을 다시 읽습니다.
- 다른 탭이나 교사가 먼저 저장했다면 덮어쓰지 말고 비교 화면을 제공합니다.
- Archive·Legacy·Explicit source에는 Draft에서 mutation command로 넘어가는 버튼을 제공하지 않습니다.
- 예약 공지의 publishAt·expireAt과 일정의 startAt·endAt은 `Asia/Seoul`로 표시하되 서버 ISO 값과 함께 보존합니다.

## 4. Attendance Bulk Operation

W8 `recordAttendanceBulk`는 한 session 안에서 원자 적용됩니다. W9의 공통 bulk framework가 이 원자성을 쪼개면 안 됩니다.

- 기본 선택은 미입력 학생만 대상으로 합니다.
- `PRESENT` 자동 기록은 사용자가 명시적으로 일괄 선택했을 때만 실행합니다.
- ACTIVE Enrollment와 session Class가 맞지 않는 학생은 저장 전에 별도 오류 목록으로 분리합니다.
- 390px에서는 학생 한 명씩 빠르게 이동하는 카드형 입력을 유지합니다.
- 1024px 이상에서는 표와 keyboard shortcut을 제공할 수 있습니다.

## 5. 대상 학생·학급 Bulk Selection

- 현재 `users/{uid}`의 grade/class/number를 bulk 대상 기준으로 사용하지 않습니다.
- W4 ACTIVE Enrollment와 Class membership만 사용합니다.
- 학급과 개별 학생을 함께 고르면 각 domain 계약에 맞는 교집합 또는 명시적 집합을 UI에서 먼저 보여 줍니다.
- 공지 W8 v1은 최종 recipient 최대 100명입니다. W9가 이 제한을 넘는 fan-out job을 임의로 만들지 않습니다.

## 6. 부분 성공·실패 정책

Domain command가 원자성을 보장하면 UI도 전체 성공 또는 전체 실패로 표시합니다. 큰 작업을 여러 command로 나눌 필요가 생기면 각 chunk에 결정적 ID와 receipt를 사용하고, 성공·실패·미실행 수를 따로 보여 줍니다. 무음 부분 성공은 허용하지 않습니다.

재시도는 기존 commandId의 결과 복구와 새 commandId 재실행을 구분합니다. 사용자가 무엇을 재시도하는지 화면에 표시해야 합니다.

## 7. 재로그인 Draft 복구

- application session 만료와 Firebase auth 만료를 구분합니다.
- 재로그인 전 Draft를 로컬에 보존하되 자격 증명이나 `_session` proof는 저장하지 않습니다.
- 로그인 후 actorUid, 역할, semesterId, baseRevision이 모두 같을 때만 복구 후보를 보여 줍니다.
- 다른 계정이 로그인하면 이전 Draft 내용을 노출하지 않습니다.
- KI-W1-01을 우회하는 별도 profile probe나 session 경로를 만들지 않습니다.

## 8. 다중 탭 Revision 충돌

- 모든 편집기는 baseRevision을 눈에 보이지 않는 내부 상태로만 두지 말고 충돌 안내에 사용합니다.
- stale CAS가 오면 최신 서버 값과 내 Draft의 차이를 표시합니다.
- 사용자가 최신 값 위에 다시 적용할 때는 새 commandId와 최신 expectedRevision을 사용합니다.
- 이미 공개·종료·보관된 대상은 강제 덮어쓰기하지 않습니다.

## 9. 남은 Direct Write Allowlist

W8 canonical route에서 소유한 direct write는 0건입니다. W8 이전 bundle writer는 Rules와 retired callable에서 차단됩니다.

저장소 전체에는 W12 또는 Release 단계로 지정된 legacy history dictionary, ThinkCloud, 보조 운영 화면의 allowlist가 남아 있습니다. W9는 자기 화면에서 호출되는 항목만 다시 분류하고, unreachable code를 근거 없이 활성화하지 않습니다. allowlist를 추가할 때는 파일·함수·owner·도입 wave·expiry·제거 조건을 모두 기록합니다.

## 10. W9에서 제거할 중복 UI·Hook

- 화면마다 따로 만든 `busy/error/saved draft` 상태를 공통 hook으로 모읍니다.
- 학급·학생 comma-separated 입력은 canonical Enrollment selector로 교체합니다.
- W8 route에서 더 이상 mount되지 않는 legacy CalendarSection·TeacherNoticeBoard·출석 helper는 사용처를 다시 확인한 뒤 제거 후보로 정리합니다.
- `ManageHistoryClassroom`, `StudentList`의 retired mutation 안내는 canonical Learning 운영 화면으로 이동시키고 dead handler를 정리합니다.
- NotificationBell은 W8 canonical delivery를 읽는 단일 controller를 유지합니다.

## 11. 기기별 업무 분류

### Mobile 390px

- 출석 빠른 입력, 공지 확인, 작은 일정 수정처럼 짧은 업무를 지원합니다.
- 많은 열을 가진 표나 대량 대상 편집을 억지로 축소하지 않습니다.
- 저장·취소·다음 학생 동작은 44px 이상으로 유지합니다.

### Tablet 768~1024px

- 학급 목록과 편집 pane을 전환하거나 compact master/detail을 사용합니다.
- 키보드가 없는 환경에서도 bulk 선택과 오류 확인이 가능해야 합니다.

### Desktop 1280~1600px

- master/detail, 다중 선택, 충돌 비교, bulk 결과 표를 함께 표시합니다.
- 넓은 화면을 좁은 중앙 column에 가두지 않습니다.

## 12. W9 Acceptance Test

- Draft 저장·복구·삭제와 다른 계정 노출 0
- 세션 만료 뒤 재로그인 복구, KI-W1-01 우회 경로 0
- 두 탭 동시 편집에서 stale CAS 감지와 조용한 overwrite 0
- Attendance bulk 전체 원자성 또는 명시적 chunk 결과
- 실패 학생 재시도와 중복 effect 0
- Enrollment 기반 bulk 대상, current profile class 의존 0
- Schedule·Learning·Notice Draft가 Archive·Legacy에 write 0
- 390·768·1024·1280·1600 업무 패턴
- keyboard, focus, dialog, 오류-field 연결
- W2 Command Gateway, W3 readiness, W4 Enrollment, W5 Shell, W6, W7, W8 회귀
- direct-write boundary UNKNOWN 0
- Dedicated Staging fixture·token·receipt 잔존 0
- Production 변경 0

## 13. W9 범위 밖

Production 승격, KI-W1-01 해결, 평가·성적 구조 변경, Wis Economy 재설계, 게임 플랫폼과 모의 주식은 W9 범위가 아닙니다. W9가 끝나더라도 별도의 Release 판단이 필요합니다.
