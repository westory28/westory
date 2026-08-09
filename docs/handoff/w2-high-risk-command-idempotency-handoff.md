# W2 High-Risk Command Idempotency Handoff

- 작성 기준: PHASE 6 W1-R3
- 기준 브랜치: `codex/phase6-w1r3-final-closure`
- 범위: W1에서 step-up 재인증을 연결한 직접 Firestore 명령 12개와 보호 callable 16개
- 구현 책임: W2 Query / Command Gateway
- 현재 상태: **필수 blocker**. 선택 사항으로 낮추거나 W1 통과 근거로 대체하지 않는다.

## 1. W1에서 고정한 경계

W1은 `src/lib/stepUpReauth.ts`의 탭 내 Promise single-flight와 동일 origin Web Lock으로 재인증 창의 중복 실행을 줄인다. `src/lib/firebase.ts`의 보호 callable wrapper는 재인증 성공 뒤 business callable을 정확히 한 번 호출하며, 서버의 session/recent-auth 오류나 네트워크 오류를 이유로 자동 재시도하지 않는다. 직접 Firestore 설정 명령도 재인증 뒤 기존 write 흐름을 한 번만 시작한다.

이 경계가 보장하는 것은 **한 번의 UI 동작 안에서 client dispatch 1회**뿐이다. 다음은 보장하지 않는다.

- 서버 반영 뒤 응답 유실
- 브라우저 재시작 또는 process crash 뒤 재시도
- 서로 다른 탭·기기·관리자가 같은 작업을 다시 제출
- 여러 문서·Auth·Storage에 걸친 부분 성공
- 장기 실행 작업의 중간 상태 재조회

따라서 W2에서 command ID, receipt, business write를 서버 원자 경계로 묶어야 한다.

## 2. 분류 기준과 집계

- `NATURALLY_IDEMPOTENT`: 같은 대상과 같은 payload를 반복 적용했을 때 최종 business state가 같음. timestamp·오류 응답·감사 이벤트는 달라질 수 있으므로 receipt가 불필요하다는 뜻은 아니다.
- `NON_IDEMPOTENT`: 반복 시 누적 지급·차감·추가 문서·중복 알림·중복 감사 또는 파괴적 부분 성공이 생길 수 있음.
- `UNKNOWN`: 코드만으로 효과를 확정하지 못해 추가 조사가 필요함.

| 분류                 | 개수 |
| -------------------- | ---: |
| NATURALLY_IDEMPOTENT |   20 |
| NON_IDEMPOTENT       |    8 |
| UNKNOWN              |    0 |
| 합계                 |   28 |

모든 항목의 W1 client 자동 retry는 0이다. 사용자가 오류 뒤 버튼을 다시 누르거나 다른 기기에서 같은 작업을 재현하는 수동 재시도 가능성은 28개 모두 존재한다.

## 3. 직접 Firestore 명령 12개

아래 명령은 `/teacher/settings`의 각 탭에서 `requestStepUpReauthentication()` 뒤 기존 SDK write를 실행한다. W1 변경은 재인증 선행과 실패·취소 시 write 0뿐이며 write 의미를 바꾸지 않았다.

| ID                                 | 화면·route                                   | 실제 경로와 operation                                                                                                                                                                                                                                                       | 분류                 | W2 조치                                                                                                                                             |
| ---------------------------------- | -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| D01 `createSemesterShell`          | 관리자 설정 > 기본 환경, `/teacher/settings` | `years/{year}/semesters/{semester}/point_policies/current`, `assessment_config/settings`, `exam_config/final_exam`, `grading_plans_meta/current`, `calendar_meta/current`, `notices_meta/current`를 없을 때 `set`; 마지막에 `site_settings/config.availableSemesters` merge | **NON_IDEMPOTENT**   | 여러 seed와 registry를 단일 command로 이전. manifest revision과 required seed 전체를 transaction/operation state로 묶고 부분 seed를 명시적으로 복구 |
| D02 `updateOperationalSettings`    | 관리자 설정 > 기본 환경                      | `years/.../point_policies/current` ensure 후 `site_settings/config` overwrite/merge; 활성 year·semester 포함                                                                                                                                                                | NATURALLY_IDEMPOTENT | readiness revision을 받는 CAS activation command로 이전. 같은 command ID 재요청은 동일 activation 결과 반환                                         |
| D03 `updateSchoolSettings`         | 관리자 설정 > 학교/학년/학기                 | `site_settings/school_config` overwrite                                                                                                                                                                                                                                     | NATURALLY_IDEMPOTENT | server validation + receipt. 장래 enrollment migration과 별도 command로 분리                                                                        |
| D04 `updateInterfaceSettings`      | 관리자 설정 > 인터페이스                     | `site_settings/interface_config` overwrite                                                                                                                                                                                                                                  | NATURALLY_IDEMPOTENT | command gateway에서 schema validation, revision/CAS, receipt                                                                                        |
| D05 `updateMenuSettings`           | 관리자 설정 > 인터페이스                     | `site_settings/menu_config` overwrite                                                                                                                                                                                                                                       | NATURALLY_IDEMPOTENT | menu revision/CAS와 receipt; cache invalidate는 commit 이후 event                                                                                   |
| D06 `updateAccessSettings`         | 관리자 설정 > 세부 권한                      | `users/{targetUid}` role·teacherPortalEnabled·staffPermissions merge                                                                                                                                                                                                        | NATURALLY_IDEMPOTENT | capability 변경 전후 값을 감사하는 server command. actor/target/self-lockout 검증과 receipt                                                         |
| D07 `updateNotificationSettings`   | 관리자 설정 > 알림                           | `site_settings/notification_config` overwrite                                                                                                                                                                                                                               | NATURALLY_IDEMPOTENT | config revision/CAS와 receipt                                                                                                                       |
| D08 `updateTermsSettings`          | 관리자 설정 > 개인정보                       | `site_settings/terms` overwrite                                                                                                                                                                                                                                             | NATURALLY_IDEMPOTENT | content hash/revision과 receipt                                                                                                                     |
| D09 `updatePrivacySettings` + 알림 | 관리자 설정 > 개인정보                       | `site_settings/privacy` overwrite 후 `createManagedNotifications`; dedupe key가 `Date.now()` 기반                                                                                                                                                                           | **NON_IDEMPOTENT**   | privacy write와 outbox를 한 transaction에 기록. stable command ID를 notification dedupe key로 사용하고 응답 유실 뒤 같은 결과 재생                  |
| D10 `updateConsentSettings:add`    | 관리자 설정 > 개인정보                       | `site_settings/consent/items/{randomId}` `addDoc`, 이어서 `site_settings/consent` timestamp merge                                                                                                                                                                           | **NON_IDEMPOTENT**   | command ID에서 결정한 item ID 또는 receipt unique constraint. 두 write를 원자화                                                                     |
| D11 `updateConsentSettings:save`   | 관리자 설정 > 개인정보                       | `site_settings/consent/items/{itemId}` update                                                                                                                                                                                                                               | NATURALLY_IDEMPOTENT | expected revision/content hash + receipt                                                                                                            |
| D12 `updateConsentSettings:delete` | 관리자 설정 > 개인정보                       | `site_settings/consent/items/{itemId}` delete                                                                                                                                                                                                                               | NATURALLY_IDEMPOTENT | tombstone/receipt로 재요청 결과 재생. 삭제 전 대상 revision 검증                                                                                    |

## 4. 보호 callable 16개

이 항목은 `src/lib/highRiskCommands.ts`에 등록되어 있고 중앙 callable wrapper를 통과한다. W1-R3는 session/recent-auth 실패 뒤 callable을 자동으로 다시 호출하지 않는다.

| ID                                                  | 화면·route                                                                   | 서버 write 범위·operation                                                                                                       | 분류                 | W2 조치                                                                                                                         |
| --------------------------------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| C01 `deleteStudentData`                             | 학생 관리 `/teacher/students`, 수행평가 관리 `/teacher/exam?tab=performance` | `users/{uid}`와 하위 기록, 학기·legacy 학생 참조, 수행평가 roster/score, wallet 등을 batch delete하고 Firebase Auth user도 삭제 | **NON_IDEMPOTENT**   | destructive saga. preflight manifest, command state, 단계별 checkpoint, Auth 삭제 결과, compensation/수동 복구를 receipt에 고정 |
| C02 `resetLessonCorePointProgress`                  | 학생 관리 `/teacher/students`                                                | 대상 학생 lesson progress의 core-point 필드를 batch update/reset                                                                | NATURALLY_IDEMPOTENT | 대상 snapshot hash와 reset manifest를 receipt에 저장. batch 부분 실패 재개                                                      |
| C03 `updateStudentData`                             | 학생 관리와 학생 상세 `/teacher/students`                                    | `users/{uid}`와 학기·legacy snapshot, 수행평가 score/roster의 프로필 값을 batch set                                             | NATURALLY_IDEMPOTENT | W2 command gateway로 이전하되 과거 snapshot 변경 금지 경계를 먼저 적용. revision/CAS와 부분 실패 재개                           |
| C04 `resetAssessmentAttemptsByClass`                | 퀴즈 설정 `/teacher/quiz`                                                    | 학기 `quiz_results`, `quiz_submissions`, 연결 point transaction 삭제, wallet 재계산, random `quiz_reset_audits` 생성            | **NON_IDEMPOTENT**   | stable command ID의 reset job/감사 문서, 대상 목록 snapshot, delete·wallet rebuild checkpoint                                   |
| C05 `resetQuizAttemptsForClass`                     | legacy/호환 퀴즈 초기화 `/teacher/quiz`                                      | C04와 같은 handler·경로                                                                                                         | **NON_IDEMPOTENT**   | C04와 하나의 canonical command로 합치고 alias는 같은 command ID로 라우팅                                                        |
| C06 `recalculateQuizResultsAfterQuestionCorrection` | 퀴즈 문항 관리 `/teacher/quiz`                                               | `quiz_results` 정답·점수 보정, 결정적 point bonus transaction, wallet/HOF dirty                                                 | NATURALLY_IDEMPOTENT | question revision + affected result manifest + job receipt. 결과 보정과 reward outbox의 완료 상태 구분                          |
| C07 `grantHistoryClassroomExemptions`               | 역사교실 관리 `/teacher/quiz/history-classroom`                              | 학생별 random `history_classroom_exemptions` add와 알림 생성                                                                    | **NON_IDEMPOTENT**   | command ID 기반 exemption ID, recipient snapshot, exemption+notification outbox 원자화                                          |
| C08 `revokeHistoryClassroomExemptions`              | 역사교실 관리                                                                | 지정 exemption 상태를 `revoked`로 batch update                                                                                  | NATURALLY_IDEMPOTENT | expected status/revision + receipt. 이미 완료된 재요청은 이전 성공 결과 반환                                                    |
| C09 `reviewHistoryClassroomExemptionRequest`        | 역사교실 관리                                                                | request·exemption·결과를 transaction으로 승인/거절하고 알림 생성                                                                | NATURALLY_IDEMPOTENT | 기존 duplicate 판정을 command ID receipt로 승격하고 notification outbox까지 원자 연결                                           |
| C10 `reviewPerformanceScoreObjection`               | 수행평가 관리 `/teacher/exam?tab=performance`                                | objection/score confirmation 관련 문서를 transaction update하고 알림 생성                                                       | NATURALLY_IDEMPOTENT | score bundle revision과 receipt, 알림 outbox를 같은 operation에 귀속                                                            |
| C11 `saveWisHallOfFameConfig`                       | 위스 관리 `/teacher/points`                                                  | 학기 HOF/interface config merge                                                                                                 | NATURALLY_IDEMPOTENT | Economy scope·config revision 검증과 receipt                                                                                    |
| C12 `rebuildPointWalletRankTotals`                  | 위스 관리 `/teacher/points`                                                  | 학기 transaction을 다시 집계해 wallet/rank projection을 batch rewrite                                                           | NATURALLY_IDEMPOTENT | 장기 job 상태/진행률/checkpoint, source ledger checksum, dry-run diff, 완료 receipt                                             |
| C13 `adjustTeacherPoints`                           | 위스 관리 `/teacher/points`                                                  | random transaction ID와 기본 `manual_${Date.now()}` source로 ledger row 추가, wallet delta 누적                                 | **NON_IDEMPOTENT**   | W2 최우선. client command ID를 ledger operation ID로 사용하고 wallet projection과 transaction/receipt를 한 transaction에 commit |
| C14 `updateTeacherPointAdjustment`                  | 위스 관리 `/teacher/points`                                                  | 기존 adjustment 수정·취소와 wallet `deltaDiff` 반영을 transaction 처리                                                          | NATURALLY_IDEMPOTENT | expected transaction revision + receipt. 같은 payload 재요청은 원래 결과 재생, 다른 payload는 command ID conflict               |
| C15 `reviewTeacherPointOrder`                       | 위스 관리 `/teacher/points`                                                  | order 상태와 결정적 debit/refund transaction, wallet balance를 transaction 처리                                                 | NATURALLY_IDEMPOTENT | Economy/order revision과 command receipt를 동일 transaction에 포함. 상태 전이별 command ID 분리                                 |
| C16 `deleteSourceArchiveAsset`                      | 사료 보관함 `/teacher/lesson/source-archive`                                 | Storage prefix의 객체 전체 삭제 후 Firestore asset 문서 삭제                                                                    | NATURALLY_IDEMPOTENT | Firestore receipt와 Storage deletion saga/checkpoint. object generation manifest로 응답 유실 뒤 상태 재조회                     |

## 5. W2 Command Gateway 필수 계약

### 5.1 Command ID

- client가 UUIDv7 또는 동등한 충돌 저항 ID를 사용자 의도 1건마다 한 번 생성한다.
- payload에는 `commandId`, `commandName`, `actorUid`, `targetScope`, `expectedRevision`, `requestedAtClient`를 포함한다.
- 서버는 인증된 UID를 actor로 사용하며 client actor 값을 신뢰하지 않는다.
- `(actorUid, commandName, commandId)`를 unique key로 사용한다.
- 같은 key와 같은 canonical payload hash는 이전 결과를 재생한다. 같은 key와 다른 hash는 `COMMAND_ID_CONFLICT`로 write 0이다.

### 5.2 Receipt와 원자성

- receipt 최소 필드: status(`RECEIVED/RUNNING/SUCCEEDED/FAILED/COMPENSATION_REQUIRED`), payloadHash, target refs, actor, timestamps, result summary/ref, error class, retryable, checkpoint.
- Firestore transaction으로 끝나는 명령은 **receipt SUCCEEDED와 business write를 같은 transaction**에 commit한다.
- Storage/Auth/대량 batch처럼 단일 transaction이 불가능하면 durable operation 문서와 단계별 checkpoint를 먼저 기록하는 saga로 실행한다. 완료되지 않은 단계를 재개하며 이미 성공한 단계를 반복하지 않는다.
- audit log는 receipt와 별도 append-only event로 남기되 동일 operation/command ID를 공유한다.

### 5.3 응답 유실·교차 기기·동시 중복

- 서버 반영 후 응답이 유실되면 같은 command ID 재요청 또는 `getCommandStatus(commandId)`로 최종 결과를 읽는다.
- 다른 기기·탭에서 같은 command ID를 제출해도 business effect는 1회다.
- 같은 command ID 동시 요청은 한 요청만 실행권을 얻고 나머지는 RUNNING 또는 완료 결과를 받는다.
- 장기 작업은 polling 가능한 status/progress/checkpoint와 취소 가능 여부를 명시한다.
- 실패와 부분 성공을 구분한다. client에 generic success/empty fallback을 반환하지 않는다.

### 5.4 Rollback

- receipt와 audit는 삭제하지 않는다.
- 단순 overwrite는 이전 revision을 보존한 새 correction command로 되돌린다.
- Wis/경제 명령은 transaction 삭제나 과거 ledger 수정 대신 ACTIVE Economy의 reversal command를 사용한다.
- delete/Auth/Storage saga는 실행 전 manifest와 복구 가능 여부를 검증하고, 불완전 시 `COMPENSATION_REQUIRED`로 잠근다.
- archive/CLOSED scope 명령은 gateway와 Rules/Functions 모두에서 거부한다.

## 6. W2 Acceptance Test

다음은 모두 blocking이다.

1. 동일 command ID를 순차 2회 요청해 business effect 1회, receipt 1개, 동일 result hash를 확인한다.
2. 서로 다른 기기/브라우저 컨텍스트에서 같은 command ID를 동시에 보내 effect 1회를 확인한다.
3. business commit 뒤 응답을 강제로 유실하고 같은 ID로 재요청해 새 write 없이 결과를 복구한다.
4. receipt와 business write 사이 failure injection에서 둘 다 commit되거나 둘 다 commit되지 않음을 확인한다.
5. 같은 command ID와 다른 payload는 conflict, write 0이다.
6. 장기 reset/rebuild/delete job은 process restart 뒤 checkpoint에서 재개하고 완료 상태를 조회할 수 있다.
7. 실패·부분 성공·compensation-required가 서로 다른 상태와 운영 안내로 노출된다.
8. NATURALLY_IDEMPOTENT 20개와 NON_IDEMPOTENT 8개 전부에 emulator concurrency case를 둔다.
9. old bundle·직접 SDK·receipt 없는 구 payload는 command gateway를 우회해 write할 수 없다.
10. audit event에 actor, scope, command ID, before/after revision, result ref가 남는다.

W2 완료 전에는 W1의 client single-flight를 서버 exactly-once로 표현하지 않는다.
