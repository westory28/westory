# W6A Assessment Session Recovery 인계

## 1. Blocking 판정

W1-R2는 application session fence를 만들었지만 Quiz·History Classroom의 attempt 자체를 server-authoritative하게 바꾸지 않았습니다. 따라서 아래 W6A acceptance가 모두 통과하기 전까지 평가 영역은 **Production promotion blocker**입니다.

현재 위험은 다음과 같습니다.

- Quiz는 deterministic submission ID를 사용하지만(`src/lib/quizSubmissions.ts:41-68`), client가 autosave·채점·result 생성·submission terminal update를 나눠 수행합니다. result `addDoc` 뒤 submission `setDoc`가 실패할 수 있어 split-brain과 중복 result 가능성이 있습니다(`src/pages/student/quiz/QuizRunner.tsx:803-949`).
- History Classroom은 route load에서 local deadline과 cooldown을 시작하고(`src/pages/student/history-classroom/HistoryClassroomRunner.tsx:519-600`), callable 실패 시 semester direct write와 root legacy fallback을 수행합니다(`:617-747`). hidden/pagehide가 cancelled result를 만들 수 있습니다(`:881-935`, `:1320-1385`).
- `submitHistoryClassroomResult`는 배정과 답을 다시 검사하지만 server attempt/deadline/revision/operation receipt가 없습니다(`functions/index.js:5805-5868`).
- Rules는 root와 semester의 `quiz_results`, `quiz_submissions`, `history_classroom_results`에 학생 direct create/update 길을 남깁니다(`firestore.rules:998-1043`, `:1155-1211`). active application session은 old bundle/direct SDK를 평가 command와 동일한 수준으로 안전하게 만들지 않습니다.
- `verify:assessment-attempt-safety`는 현행 page-exit cancel과 local resume 정적 pattern을 보존하는 regression입니다. A01–A08 atomicity 근거가 아닙니다(`scripts/verify-assessment-attempt-safety.mjs:18-63`).

## 2. 최소 구현 계약

### 2.1 Server command 세 개

1. `startAssessmentAttempt`
   - 입력: assessment/assignment key, scope, target enrollment, `operationId`.
   - transaction에서 배정·공개·응시 가능 시간·application session을 검사합니다.
   - UID+assessment의 active head를 CAS로 만들며 중복 start는 같은 `attemptId`, `startedAt`, `deadlineAt`을 replay합니다.
   - deadline은 server timestamp와 고정된 time limit으로만 정합니다. client clock과 local storage는 권위가 없습니다.

2. `saveAssessmentAnswers`
   - 입력: `attemptId`, `expectedRevision`, answer patch 또는 snapshot, `operationId`, `requestHash`.
   - owner, active session, `IN_PROGRESS`, server deadline을 transaction 안에서 검사합니다.
   - 같은 operation/request hash는 기존 receipt를 replay하고 revision을 다시 올리지 않습니다.
   - stale revision은 `ABORTED/REVISION_CONFLICT`로 거부하며 write 0입니다.

3. `submitAssessmentAttempt`
   - 입력: `attemptId`, `expectedRevision`, optional final answer patch, `operationId`, `requestHash`.
   - 마지막 답, server grading, terminal attempt, deterministic result, RewardEventPort outbox를 한 transaction 또는 동일 원자 경계로 처리합니다.
   - retry와 두 탭 submit은 같은 terminal/result receipt를 반환합니다. 점수·result hash·deadline은 첫 성공 뒤 immutable입니다.

Quiz와 History Classroom은 동일 command envelope와 receipt를 사용하되, 채점 adapter와 assessment definition type만 분리합니다. 현행 `submitHistoryClassroomResult`와 client Quiz result writer는 새 command로 전환한 뒤 legacy compatibility 기간에도 active session만으로 실행되지 않게 명시적으로 거부합니다.

### 2.2 최소 schema

```ts
type AssessmentAttempt = {
  attemptId: string;
  ownerUid: string;
  scope: { year: number; semester: number };
  assessmentType: "quiz" | "history-classroom";
  assessmentId: string;
  targetRevision: number;
  status: "IN_PROGRESS" | "SUBMITTED" | "TIMED_OUT";
  revision: number;
  answers: Record<string, unknown>;
  answersHash: string;
  startedAt: unknown;
  deadlineAt: unknown;
  submittedAt?: unknown;
  resultId?: string;
  resultHash?: string;
};

type CommandReceipt = {
  operationId: string;
  requestHash: string;
  attemptId: string;
  acceptedRevision: number;
  effect: "START" | "SAVE" | "SUBMIT";
  response: unknown;
  createdAt: unknown;
};
```

`ownerUid`, `startedAt`, `deadlineAt`, grade, result ID는 server가 정합니다. active head는 assessment별 재응시 정책을 포함하는 key로 하나만 존재해야 합니다. result ID는 attempt ID에서 결정적으로 도출하고 add/random ID를 사용하지 않습니다.

### 2.3 Rules와 client 경계

- 학생의 root/semester `quiz_results`, `quiz_submissions`, `history_classroom_results`, attempt/receipt direct create/update/delete를 모두 deny합니다.
- 학생 read는 자기 attempt/result 최소 범위만 허용하고, 다른 UID와 blocked session은 단건 read/query/subscription 0이어야 합니다.
- teacher/admin 운영 read·reset도 capability와 별도 audited command로 제한합니다. admin이라는 이유로 학생 attempt를 임의 update하지 않습니다.
- runner 진입은 read-only preflight입니다. explicit `시작` 전에는 attempt, result, cooldown, reward, receipt, domain event가 0입니다.
- session expiry/unmount/hidden/pagehide/back/refresh는 submit/cancel/discard hook가 아닙니다. 저장 완료된 canonical attempt는 그대로 복구합니다.

## 3. P0 진입 mutation — W6A Blocking Acceptance

아래 항목은 W2 containment만으로 완료 처리하지 않고 W6A final acceptance로 그대로 이관합니다.

| Case  | 동작                                                                                   | PASS oracle                                                                 |
| ----- | -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| P0-01 | 유효 사용자가 목록·direct hash URL을 열고 preflight만 수행                             | attempt/result/cooldown/reward/receipt write 0                              |
| P0-02 | 잘못된 assessment ID·배정되지 않은 사용자·닫힌 평가 direct URL                         | protected child/query/subscription 0, domain write 0, 지원 가능한 오류 상태 |
| P0-03 | auth unknown, unauthorized role, expired/closed application session direct URL         | protected child/query/command 0, write 0                                    |
| P0-04 | explicit start 전 hidden, pagehide, beforeunload, unmount, back, refresh, route change | domain write 0; local UI state 외 effect 0                                  |
| P0-05 | explicit start를 두 탭에서 동시 실행                                                   | active head 1, attempt 1, 동일 ID/deadline receipt                          |
| P0-06 | start 응답 유실 후 refresh·재로그인                                                    | 새 attempt 0, 기존 attempt/deadline/revision 복구                           |
| P0-07 | expired lease에서 old bundle, raw callable, direct SDK 실행                            | command 0, root/semester direct write 0                                     |

P0 query 0은 화면에서 데이터가 보이지 않는다는 관찰만으로 판정하지 않습니다. emulator/client instrumentation으로 protected collection의 단건 read, query, listener attach, callable, Firestore/Storage write 횟수를 각각 기록합니다.

## 4. A01–A08 Expiry Race — W6A Blocking Acceptance

W1-R 보고서의 case ID와 의미를 변경하지 않습니다.

| Case | 경합                         | 필수 결과·판정 기준                                                                                                                                      |
| ---- | ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A01  | save가 expiry를 가로지름     | server가 expiry 전 transaction을 수락했다면 정확히 1회 반영, 아니라면 명확한 session-expired 거부와 write 0. client는 canonical revision을 재조회해 복구 |
| A02  | save와 expiry 동시           | lost update 0. receipt/revision이 있거나 전체 거부되어야 하며 부분 answer·revision 불일치 0                                                              |
| A03  | submit과 expiry 경합         | terminal attempt와 deterministic result가 둘 다 1 또는 둘 다 0. split-brain 0, reward event 최대 1                                                       |
| A04  | server 성공·client 응답 유실 | 동일 operation retry가 같은 receipt를 replay. canonical 조회로 같은 attempt/revision/result 복구, 추가 effect 0                                          |
| A05  | 동일 UID 재로그인            | 동일 `attemptId`, `deadlineAt`, `revision`, `answersHash`. client clock과 새 session epoch가 deadline을 연장하지 않음                                    |
| A06  | duplicate submit             | 두 탭·빠른 double click·timeout submit 경합에도 terminal/result/reward event 각각 정확히 1, grade immutable                                              |
| A07  | stale revision 지연 도착     | stale save는 conflict/write 0, 최신 답 overwrite 0. UI는 canonical diff와 재적용 경로 제공                                                               |
| A08  | 다른 UID attempt 접근        | 단건 read/query/subscription/command 모두 deny, write 0. ID 추측과 같은 반 학생도 동일                                                                   |

모든 case는 Quiz와 History Classroom에 각각 실행합니다. server fake clock으로 deadline `-1ms`, `0ms`, `+1ms`와 client clock `-10분`, `+10분`을 포함하고, expiry는 application session clock과 attempt deadline clock을 별도로 조절합니다. browser timer만 조작한 결과는 server-authoritative 증거로 인정하지 않습니다.

## 5. 최소 emulator harness

기존 `scripts/verify-point-system.mjs`와 `@firebase/rules-unit-testing` 패턴을 재사용해 assessment 전용 harness를 추가합니다.

1. Auth/Firestore/Functions emulator에 같은 UID의 Firebase app 두 개와 다른 UID app 하나를 만듭니다.
2. 동일 fixture를 Admin SDK로 seed하고, command transaction에 injectable server clock을 제공합니다.
3. `Promise.allSettled`와 barrier를 사용해 두 탭 start/save/submit을 같은 지점에서 경합시킵니다.
4. response-loss는 server commit 뒤 transport response만 버리고 같은 operation ID로 재호출합니다.
5. 각 case 전후에 attempt head, attempt, receipt, result, reward outbox, legacy/root result, cooldown document 수와 hash를 비교합니다.
6. Rules test는 owner/other student/teacher/staff/admin과 active/missing/closed/expired session matrix에서 root+semester direct SDK를 `assertFails`로 고정합니다.
7. JSON evidence에는 case ID, sanitized actor alias, server clock, expected/actual count, revision, hashes, callable status만 기록합니다. credential/token/실제 학생 데이터는 기록하지 않습니다.

필수 자동 명령은 다음 구조를 권장합니다.

```text
npm run verify:assessment-attempt-safety       # 기존 정적 회귀, 단독 합격 근거 아님
npm run verify:assessment-attempt-rules        # root/semester direct SDK matrix
npm run verify:assessment-attempt-functions    # A01-A08 transaction race
npm run verify:assessment-attempt-integration  # auth/session/functions/firestore E2E
npm run build
npm --prefix functions run check
```

## 6. Staging browser acceptance

emulator atomicity가 먼저 PASS한 뒤 Dedicated Staging의 합성 계정만 사용합니다. Production과 실제 학생·교사 계정은 사용하지 않습니다.

- Quiz와 History Classroom 각각 direct URL preflight, explicit start, valid activity, answer save, route change, back, refresh를 실행합니다.
- 일반 30분, 관리자 15분, 5분 전 경고는 session UI contract를 확인하고, 평가 deadline은 server 값이 유지되는지 확인합니다.
- active attempt 중 session expiry에서 runner가 unmount되어도 cancel/result/cooldown write 0이고, 동일 UID 재로그인 뒤 같은 attempt가 복구되어야 합니다.
- 390/768/1024/1280/1600에서 preflight, 시작, 복구 dialog, conflict, submit 결과를 확인합니다. 작은 폭에서는 상태·차단 이유와 `PC에서 계속` 경로를 제공하고, document horizontal overflow는 0이어야 합니다.
- Console error 0, protected query/listener count와 write count evidence, canonical before/after hash를 한 case 묶음으로 보존합니다.

## 7. Old bundle·direct SDK 회귀

세 가지 서로 다른 조건을 모두 실행합니다.

1. **clean profile old bundle**: application session을 열지 못하는 이전 bundle의 protected read/query/call/write가 0인지 확인합니다.
2. **shared auth persistence**: 새 bundle이 active session을 연 뒤 같은 browser auth persistence를 old bundle이 재사용해도 legacy assessment direct write와 구 callable payload가 거부되는지 확인합니다.
3. **direct SDK가 session을 먼저 연 경우**: 정상 open-session protocol을 재현한 공격 client도 Rules로 막힌 assessment collections에 직접 쓸 수 없어야 합니다.

old bundle은 실제 이전 deployment artifact/hash를 evidence에 남기고, current source를 임의로 흉내 낸 script만으로 대체하지 않습니다. 단, 전체 artifact 실행이 불가능하면 그 사실을 FAIL/NOT RUN으로 남기며 정적 bundle 문자열 검사로 PASS 처리하지 않습니다.

## 8. 최종 보고서 판정 기준

다음 조건을 모두 만족해야 W6A를 PASS로 판정합니다.

- P0-01~07과 A01~A08이 Quiz·History Classroom 모두 PASS
- attempt head 1, active attempt 1, result 최대 1, reward event 최대 1, stale overwrite 0
- server deadline만 권위이며 session 재로그인·client clock으로 연장 0
- root/semester direct write와 legacy callable payload가 모든 역할 matrix에서 deny
- existing W1 access/session verifier와 기존 assessment static verifier 회귀 PASS
- Dedicated Staging browser 5폭, session expiry unmount, relogin recovery PASS
- Production 배포·Rules·Functions·데이터 변경 0을 배포 대시보드/프로젝트 식별자/commit SHA로 확인
- rollback artifact와 command/schema migration 순서가 승인됨

한 항목이라도 `NOT RUN`, 정적 추정만 존재, query/write count가 누락, old bundle shared-session case가 빠진 경우 최종 판정은 **BLOCKED / NOT READY**입니다.
