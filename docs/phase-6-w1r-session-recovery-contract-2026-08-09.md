# PHASE 6 — W1-R Session & Recovery Contract Closure

- 기준 브랜치: `codex/phase6-w1-access-session`
- 기준 SHA: `380078a92e37fd972c8ef7ee763f29e68b67c13a`
- 작업 브랜치: `codex/phase6-w1r-session-contract`
- 구현 체크포인트: `d35ce29de575e66f3af93d6d674b5583aa4cd1e6`
- 검증일: 2026-08-09 KST
- Dedicated Staging Firebase: `westory-staging-177587430482`
- Dedicated Staging Vercel: `westory-staging` / Preview
- 최종 판정: **NOT READY FOR W1 PRODUCTION PROMOTION**

Production 승격과 W2는 시작하지 않았다.

## 1. Executive Summary

W1-R에서는 클라이언트의 만료 불리언을 신뢰하던 경계를 서버 권위 application session으로 보강했다. Firebase ID token이 여전히 유효해도 `application_sessions/{uid}/sessions/{auth_time}`가 없거나, 닫혔거나, 서버 deadline을 넘기면 Firestore·Storage·보호 callable이 요청을 거부한다. 일반 세션은 30분, 관리자 고위험 세션은 15분이며 실제 활동 touch만 서버 수신 시각으로 두 deadline을 갱신한다.

고위험 callable 16개와 관리자 설정의 직접 write 진입점에는 Firebase 공식 재인증 UI와 서버 recent-auth 5분 검사를 연결했다. 에뮬레이터와 Dedicated Staging에서 active/closed/missing session 차단을 확인했고, Staging Preview에서도 30분 일반 세션, 15분 설정 세션, 만료 직후 보호 UI 제거, 동일 UID return path 복구가 동작했다. 다만 실제 비밀번호 재인증 뒤 새 `auth_time` epoch로 전환되는 과정에서 보호 화면이 `로그인 상태를 확인하지 못했습니다`로 바뀌는 통합 결함이 재현됐다.

그러나 W1-R 완료 조건 네 건을 모두 닫지는 못했다. 교사 편집 surface 51개에는 공통 draft repository가 적용되지 않았고, Quiz·History Classroom은 server-authoritative attempt/revision/exactly-once submit 계약이 없다. 실제 이전 번들 전체 실행, 평가 A01–A08, 모든 고위험 direct write의 command 전환도 미완료다. 실제 재인증 뒤 session epoch 전환 오류와 1024px 관리자 설정 화면의 가로 overflow도 재현됐다. 따라서 Production 승격은 금지한다.

## 2. W1 Remaining Contract Register

| 계약 | 이번 결과 | 판정 |
| --- | --- | --- |
| 서버 권위 application session | Firestore·Storage·보호 callable fence, server deadline, touch throttle 구현 | PASS — 제한 포함 |
| 고위험 step-up 재인증 | 취소 시 command 0, 실제 password 재인증 뒤 새 session epoch 복원 실패, Google 미검증 | FAIL |
| 교사 draft 저장·복구 | canonical route/modal 51개 전수 분류, 공통 저장 계약 미적용 | FAIL |
| 평가 same-attempt·만료 경합 | 현행 위험과 A01–A08 계약 확정, 구현·경합 E2E 미수행 | FAIL |
| 이전 번들·직접 요청 차단 | direct SDK·raw callable·missing/closed session 차단, 실제 old bundle shared-session 실행 미수행 | PARTIAL |
| 기존 W1 회귀 | access/session/build PASS, current Preview 1024px overflow 1건 | PARTIAL |

## 3. Server Session Authority ADR

상세 결정은 [ADR — W1-R 서버 권위 애플리케이션 세션](./adr/w1r-server-session-authority.md)에 남겼다.

선택한 경계는 다음과 같다.

`Firebase Auth epoch(auth_time) → server-managed application session → Rules/Functions enforcement`

- 문서: `application_sessions/{uid}/sessions/{authTime}`
- 같은 로그인 epoch의 탭: session 공유
- 다른 인증 epoch의 기기: 별도 session
- `openApplicationSession`: 최근 실제 인증으로만 새 epoch 생성
- `touchApplicationSession`: 허용된 사용자 활동 뒤에만 호출, 30초 이내 중복 write 억제
- `closeApplicationSession`: 해당 epoch를 닫고 deadline을 0으로 변경
- `assertActiveApplicationSession`: 보호 callable 공통 진입 guard
- 최근 재인증: ID token `auth_time`을 서버에서 5분 이내인지 검사

클라이언트 현재 시각, 클라이언트가 보낸 last activity, `reauthenticated=true` 같은 값은 사용하지 않는다.

## 4. Firestore / Storage / Functions Enforcement

### Firestore

`canUseWestory()`가 현재 UID와 token `auth_time`에 대응하는 session의 `status == active`, 일치하는 `authTime`, `generalExpiresAt > request.time`을 요구한다. session 문서는 client read/create/update/delete를 모두 거부한다. 관리자 `users` write와 `site_settings` write는 active high-risk session과 recent-auth를 추가로 요구한다.

### Storage

보호된 Storage 요청도 같은 session을 검사한다. 기존 role/profile 검사까지 필요한 경로는 session 1개와 profile 1개, 총 2개의 고유 Firestore 문서를 참조한다. Storage의 Firestore 연동 조회 한도를 모두 사용하므로 추가 문서 guard를 같은 operation에 더할 수 없다.

### Functions

`functions/sessionAuthority.js`를 단일 guard 구현으로 사용한다. 모든 기존 사용자 callable이 공통 `assertAllowedWestoryUser`를 통해 session을 먼저 검사하도록 바꾸었다. scheduler와 Storage finalize trigger는 사용자 요청이 아닌 SYSTEM 실행이므로 session을 요구하지 않는다.

Dedicated Staging에는 검증에 필요한 함수만 만들었다.

- `openApplicationSession`
- `touchApplicationSession`
- `closeApplicationSession`
- `getPrintClientInfo`
- `deleteStudentData`

5개 모두 `ACTIVE`, Node.js 22, `asia-northeast3`, source hash `2aa54d9a8517bf48b996ebd0c84aebdf27002019`다. 전체 callable 42개를 Staging에 배포한 것은 아니므로 전체 배포 증거로 해석하지 않는다. Functions 생성 중 Cloud Functions 관련 API가 Staging에서 활성화됐고, artifact cleanup policy 자동 설정 실패로 최초 CLI 종료코드는 1이었다. 함수 5개 생성은 모두 성공했으며 cleanup policy는 별도 설정으로 남겼다.

## 5. Old Bundle & Direct Request Verification

| Case | 결과 | 근거 |
| --- | --- | --- |
| CASE-S01 만료/종료 session Firestore read | PASS | Staging `403`, emulator deny |
| CASE-S02 만료/종료 session Firestore write | PASS in Rules matrix | emulator deny |
| CASE-S03 만료 callable | PASS | Staging `401`, `SESSION_EXPIRED` |
| CASE-S04 raw HTTP callable | PASS | emulator raw endpoint `SESSION_EXPIRED` |
| CASE-S05 이전 bundle 보호 요청 | PARTIAL | clean/missing session은 구조상 거부, 실제 old bundle shared-session 실행은 미수행 |
| CASE-S06 direct SDK | PASS for missing/closed session | Staging Firestore `403`, callable `401` |
| CASE-S07 session 누락·손상 | PASS | missing `SESSION_MISSING`/403, corrupt Rules deny |

Staging 실제 결과:

- `teacher-01`: open 후 protected callable/Firestore `200/200`
- 같은 epoch close 후 protected callable/Firestore `401/403`
- callable reason: `SESSION_EXPIRED`
- `teacher-02`: session 미생성 상태 protected callable/Firestore `401/403`
- callable reason: `SESSION_MISSING`
- Production access: 0

중요한 제한이 있다. 새 번들이 session을 연 뒤 같은 browser persistence와 auth epoch를 이전 번들이 재사용하면 session fence 자체는 통과할 수 있다. 현재 Quiz/History 결과의 direct write Rules와 구 callable payload가 완전히 잠기지 않았으므로 실제 이전 번들 전체 우회는 아직 PASS가 아니다.

## 6. Step-up Reauthentication

클라이언트는 password provider의 `reauthenticateWithCredential`, Google provider의 `reauthenticateWithPopup`을 지원한다. 성공 시 ID token을 강제로 갱신하고 새 `auth_time` epoch의 application session을 연다. 취소·popup 종료·실패는 Promise를 reject하여 business command 전에 중단한다.

서버 recent-auth가 적용된 callable은 16개다.

1. 학생 삭제·정보 변경·학습기록 초기화 3개
2. 평가 초기화·결과 재계산 3개
3. 역사교실 면제 부여·회수·검토 3개
4. 수행평가 이의 검토 1개
5. 위스 설정·대사·조정·주문 검토 5개
6. 사료 원본 삭제 1개

관리자 설정의 권한, 학기 shell/운영 설정, 인터페이스/메뉴, 알림, 약관/개인정보/동의, 학교 구조 write에도 step-up 진입점을 연결했다. Firestore Rules가 admin email, active high-risk session, 최근 5분 token `auth_time`을 다시 검사한다.

에뮬레이터 core test에서 오래된 auth는 `RECENT_AUTH_REQUIRED`로 거부됐다. Dedicated Staging 브라우저에서는 password provider 관리자 로그인과 15분 설정 session을 확인했다. 인증 후 5분이 지난 상태에서 학교 설정의 `전체 저장`을 누르자 재인증 대화상자가 표시됐고, `취소`를 선택했을 때 대화상자는 닫혔으며 저장 성공 표시는 나타나지 않았다. 따라서 취소 경로의 business command 0은 확인했다.

같은 화면에서 다시 `전체 저장`을 누르고 합성 관리자 계정의 비밀번호로 실제 재인증을 완료하자 대화상자는 닫혔다. 그러나 곧바로 보호 화면이 제거되고 `로그인 상태를 확인하지 못했습니다`와 `사용자 권한 정보를 확인하지 못했습니다`가 표시됐다. 새 `auth_time`으로 application session을 다시 연 뒤 AuthContext의 권한 snapshot과 Rules session epoch가 일관되게 이어지지 않는 통합 결함으로 판정한다. 저장 성공은 입증하지 못했으므로 실제 재인증 성공 경로는 FAIL이다. Google provider 경로도 Staging에서 실행하지 않았다.

또한 모든 고위험 direct write가 callable로 전환된 것은 아니며, 수행평가 batch, 콘텐츠 삭제, 위스 정책·상품 직접 write 등 registry 밖 경로가 남아 있다. 따라서 고위험 step-up 재인증 계약 전체를 FAIL로 판정한다.

## 7. Teacher Draft Inventory

교사 canonical route 13개와 모든 modal, 공통 패치 메모를 기준으로 독립적인 편집·저장 surface를 51개로 집계했다.

| 영역 | surface 수 | 대표 편집 |
| --- | ---: | --- |
| Dashboard | 4 | 알림장·일정·공통 패치 메모 진입 |
| 학생 관리 | 2 | 프로필·소속 변경 |
| Quiz | 3 | 문항·설정·은행 |
| History Classroom | 4 | 과제·면제·검토 |
| Exam/Score | 8 | grading plan·OMR·수행·서술형 |
| Settings | 9 | 운영·학교·메뉴·권한·개인정보 |
| Wis | 10 | 정책·상품·지급·주문·순위 |
| Schedule | 1 | 일정 편집 |
| Lesson | 2 | 본문·PDF/worksheet segment |
| Dictionary | 2 | 용어·공식 풀이 |
| Maps | 3 | 지도·태그·탭 |
| Source Archive | 1 | 사료 metadata/파일 |
| Think Cloud | 1 | 질문·공개 설정 |
| 공통 Patch Memo | 1 | 메모 작성·수정 |
| 합계 | **51** |  |

분류상 44개는 standard recovery, 7개는 복구 후 대상을 다시 검토해야 하는 command-review recovery다. command-review 대상은 반 이동, 면제 부여, 학기 shell, 위스 지급, 주문 상태/메모, 거래 조정, 지도 탭 rename이다. 파일/blob/base64/대용량 parsed rows를 포함하는 11개 surface는 일반 Firestore draft만으로 처리할 수 없고 별도 private staging asset 계약이 필요하다.

## 8. Draft Save / Recovery Contract

목표 계약은 `teacher_drafts/{uid}/items/{draftId}`처럼 UID·route·entity·draft ID가 분리된 private repository, server timestamp, revision/CAS, debounce, 상태 표시, 동일 UID 복구, 다른 UID deny, 복구/폐기/새 시작 선택, canonical save 성공 뒤 정리, TTL을 요구한다. command-review draft는 입력만 복구하고 target/capability/source revision을 재검증하며 자동 실행하지 않아야 한다.

이번 W1-R에서는 이 공통 repository·Rules·UI adapter를 51개 surface에 적용하지 않았다.

- 적용 화면: **0 / 51**
- 복구 E2E PASS: **0 / 51**
- 다른 UID 노출 0 증거: 없음
- canonical record 암묵 변경 0 증거: 없음
- 두 탭 revision conflict 증거: 없음
- 11개 file/blob surface private staging 증거: 없음

인벤토리만 끝난 상태를 구현 완료로 계산하지 않는다. 교사 draft 계약은 Production promotion blocker다.

## 9. Assessment Attempt Contract

현행 Quiz는 deterministic submission ID를 사용하지만 시작·autosave·채점·result/submission terminal write가 client에 분산돼 있다. revision/CAS/command receipt가 없고 result add와 terminal update가 분리돼 split-brain 가능성이 있다.

History Classroom은 route load 중 local deadline/cooldown을 만들고, pagehide/visibility에서 cancelled result를 만들 수 있다. callable은 assignment와 채점을 확인하지만 server attempt, deadline, revision, idempotency receipt가 없고 callable 실패 뒤 semester direct write와 root legacy fallback이 남아 있다.

W1-R에서 확정한 목표는 공통 server command 세 개다.

- `startAssessmentAttempt`: 명시적 시작, head transaction, deterministic active attempt
- `saveAssessmentAnswers`: attempt ID, expected revision, operation key, server timestamp, stale write reject
- `submitAssessmentAttempt`: 마지막 answer patch와 terminal/result를 원자 처리, deterministic result ID, retry replay

session expiry는 submit/cancel hook가 아니다. 서버가 expiry 전 수락한 in-flight transaction은 원자 commit할 수 있지만, expiry 뒤 새 command는 0이어야 한다. 재로그인은 canonical attempt를 다시 조회해야 한다.

이 command/schema/Rules 전환은 구현하지 않았다. 현행 assessment direct write를 session fence만으로 안전하다고 보지 않는다.

## 10. Expiration Race E2E

| Case | 요구 결과 | 이번 결과 |
| --- | --- | --- |
| A01 save가 expiry를 가로지름 | 1회 반영 또는 명확한 거부 후 복구 | NOT RUN |
| A02 save와 expiry 동시 | lost update 0 | NOT RUN |
| A03 submit과 expiry 경합 | terminal/result 정확히 1 | NOT RUN |
| A04 server 성공·client 응답 유실 | canonical 조회로 복구 | NOT RUN |
| A05 동일 UID 재로그인 | 동일 attempt/deadline/revision/hash | NOT RUN |
| A06 duplicate submit | result/효과 정확히 1 | NOT RUN |
| A07 stale revision 지연 도착 | 최신 답안 overwrite 0 | NOT RUN |
| A08 다른 UID attempt 접근 | deny/write 0 | NOT RUN |

기존 `verify:assessment-attempt-safety`는 자동 session heartbeat 제거와 일부 local resume 정적 패턴만 확인한다. A01–A08 server atomicity 증거가 아니므로 이번 완료 조건으로 사용하지 않는다.

## 11. Existing W1 Regression

| 검증 | 결과 |
| --- | --- |
| `verify:access-gate` | PASS — 학생 17, 교사 13, 차단 상태 5 |
| `verify:session-policy` | PASS — 30분/15분/5분 |
| `verify:assessment-attempt-safety` | PASS — 기존 정적 계약만 |
| Dedicated Staging 교사 로그인 | PASS — 30분 timer |
| 강제 만료 | PASS — Header와 보호 화면 제거, error 0 |
| 동일 UID 재로그인 | PASS — `#/teacher/dashboard` 복구 |
| 관리자 설정 진입 | PASS — 15분 timer |
| 오래된 인증에서 재인증 취소 | PASS — dialog 제거, 저장 성공 표시 0 |
| 실제 password step-up 뒤 session epoch 복원 | **FAIL — 보호 화면 제거 후 권한 확인 실패 상태** |
| 390/768/1280/1600 settings overflow | PASS |
| 1024 settings overflow | **FAIL — `scrollWidth 1139 > innerWidth 1024`** |
| Production branch Preview | 변경 0, 기존 차단 정책 유지 |

최초 390px viewport 측정은 browser override 적용 전 1280px 값이 한 번 수집돼 폐기했고, 같은 폭을 다시 적용해 `innerWidth 390`, `scrollWidth 375`로 확인했다.

## 12. Rules Cost / Access Budget

- Firestore 일반 보호 요청: session document access 1회 추가
- role/profile이 필요한 요청: session 1 + profile 1
- Storage 보호 요청: session 1 + profile 1 = 2, Storage 연동 한도 전부 사용
- callable: business read 전에 Admin SDK session read 1회 추가
- touch: client throttle와 server transaction에서 30초 이내 write 억제
- 거절된 Rules 요청도 document read 비용이 생길 수 있음

Firestore Rules의 같은 path 반복 `get`은 runtime cache될 수 있으나, budget은 서로 다른 문서 수와 emulator 성공을 기준으로 잡았다. 전체 batch/transaction의 10/20 access-call matrix는 아직 전수 실행하지 않았다. 장기적으로 직접 SDK command를 Functions gateway로 옮기면 Rules 비용과 recent-auth enforcement를 더 명확히 할 수 있다.

## 13. Build / Type / CI

| 항목 | 결과 |
| --- | --- |
| `npm run build` | PASS — 421 modules, 기존 large chunk warning |
| `npm run format:check` | PASS |
| `npm --prefix functions run check` | PASS |
| TypeScript ratchet | PASS — **63 errors / 13 files**, 신규 오류 0 |
| Firestore session Rules | PASS |
| Functions session core | PASS |
| Storage session Rules | PASS — missing doc fail-closed warning 포함 |
| Auth+Firestore+Functions integration | PASS |
| Firebase environment isolation | PASS — 12 cases |
| Vercel config isolation | PASS — 5 cases |

세션 suite 연속 실행 때 Firestore emulator Java process가 8080을 잠시 유지해 다음 suite가 시작되지 못한 실행기 문제가 한 번 있었다. 잔류한 해당 demo emulator process만 종료한 뒤 각 suite를 개별 재실행해 모두 PASS했다.

## 14. Production Safety Verification

- Production deploy/promotion: 0
- Production Vercel alias 변경: 0
- Production Firestore/Storage Rules 배포: 0
- Production Functions 배포: 0
- Production Auth·Firestore·Storage data write: 0
- GitHub Pages 재활성화: 0
- W2 시작: 0

종료 전 읽기 전용 대조에서 Production Vercel은 기존 `dpl_7r2BkKz1STPv5j15xstj5GArai5V`, target `production`, status `READY`를 유지했다. Production Functions도 기존 43개가 모두 `ACTIVE`였고 W1-R session 함수 3개는 Production에 존재하지 않았다.

Vercel 변경은 별도 project `westory-staging`의 Preview 한 건뿐이다.

- deployment: `dpl_3Bj6PUqKT2QgGuqJxq5AWFxD43Wa`
- immutable URL: `https://westory-staging-ejb42nt4f-bbbs-projects-44f9da30.vercel.app`
- stable alias: `https://westory-staging-westoria28-8028-bbbs-projects-44f9da30.vercel.app`
- target/status: Preview / READY
- 비인증 stable/immutable URL: 302/302

로컬 prebuilt 두 번과 첫 원격 시도는 `vercel.mjs` config compile 시 project ID가 없어서 업로드·배포 전에 fail-closed했다. Staging project ID를 process environment에 명시한 원격 Preview만 성공했다. `vercel curl`은 사용하지 않았다.

## 15. Changed Files

구현 체크포인트는 31개 파일을 변경했다. 이 보고서를 포함하면 W1-R 소유 변경은 32개 파일이다.

- Session authority/Functions: 5
- Rules: 2
- client auth/session/reauth: 10
- settings step-up adapters: 6
- tests/package scripts: 8
- ADR/report: 2

사용자 소유의 `AGENTS.md`, `DESIGN.md`, `UI_RULES.md`, PHASE 1–5 미추적 문서와 `tmp/`는 stage·commit하지 않았다.

## 16. Rollback

### Staging frontend

stable alias를 이전 W1 READY deployment `dpl_EnCQhuiPcJWbt7wh3Uqw7iXfavJF`로 되돌릴 수 있다. 현재 W1-R Preview는 삭제하지 않고 감사 근거로 보존한다.

### Staging Rules/Functions

1. Staging frontend를 maintenance-safe/이전 W1 artifact로 전환한다.
2. W0-R에 기록된 직전 Staging Firestore·Storage Rules를 재배포한다.
3. 이번에 새로 만든 5개 함수는 트래픽 차단 뒤 삭제하거나 이전 source로 재배포한다.
4. `application_sessions` 문서는 즉시 광범위 삭제하지 않고 감사·TTL 정책으로 처리한다.

Production에는 반영하지 않았으므로 Production rollback은 필요 없다.

## 17. Final Promotion Readiness

완료 체크:

- [x] 서버 권위 application session 구현
- [x] 유효 token + 닫힘/누락 session Firestore·Function 거부
- [x] direct SDK/raw callable 차단 harness
- [~] 이전 bundle — missing session 경계만 입증, shared active session 미입증
- [ ] 고위험 재인증 — 취소 command 0은 확인, 실제 password 재인증 뒤 session epoch 복원 실패
- [ ] 교사 draft 자동 저장·동일 UID 복구 — 0/51
- [ ] 다른 UID draft 노출 0
- [ ] 평가 A01–A08
- [ ] 동일 attempt/server deadline/revision 복구
- [ ] 중복 attempt·submit 0
- [~] 기존 W1 회귀 — 1024px overflow 1건
- [x] Dedicated Staging Preview READY
- [x] Production 변경 0
- [x] 신규 TypeScript 오류 0
- [x] rollback 단위 정의

남은 Promotion blocker:

1. teacher draft repository/Rules/UI adapter를 51개 surface에 적용하고 11개 대용량 asset staging을 닫아야 한다.
2. Quiz·History Classroom의 server attempt/start/save/submit와 A01–A08 concurrency harness가 필요하다.
3. old bundle이 shared active session을 재사용해도 assessment direct write와 구 callable payload가 거부돼야 한다.
4. 새 `auth_time` application session과 AuthContext 권한 snapshot을 원자적으로 재수립하고, 실제 password·Google 재인증 뒤 같은 보호 화면으로 복귀하는 E2E를 통과해야 한다.
5. 고위험 direct Firestore/Storage write를 registry화하고 recent-auth Rules 또는 callable로 완전히 전환해야 한다.
6. current Preview의 1024px 관리자 설정 overflow를 해결해야 한다.
7. Staging Functions 5개에 artifact cleanup policy를 설정하고, 필요한 전체 callable 배포/검증 범위를 별도 승인해야 한다.

따라서 최종 판정은 **NOT READY FOR W1 PRODUCTION PROMOTION**이다.

`NEXT WAVE STARTED: NO`
