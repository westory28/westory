# PHASE 6 — W1 Frozen Handoff

- 동결일: 2026-08-11 KST
- 기준 저장소: `C:/westory`
- 기준 application HEAD: `832610e7380724496d13fd94c45081379ae8329d`
- 체크포인트 브랜치: `codex/phase6-w1-frozen-checkpoint`
- Production 승격: 실행하지 않음
- Production idle enforcement: 비활성

## 최종 상태

`FROZEN — NOT PROMOTED, NOT BLOCKING FURTHER STAGING DEVELOPMENT`

W1의 접근·세션 핵심은 Staging 구현과 자동 검증을 마쳤지만 Production에 올릴 단계는 아닙니다. 재인증 뒤 `users/{uid}`를 다시 확인하는 과정에서 간헐적인 `permission-denied`가 남아 있기 때문입니다. 이 문제는 `KI-W1-01`로 등록해 Release Candidate 통합 단계에서 다시 확인합니다. W1-R6, W1-R7 같은 추가 하위 Wave는 만들지 않습니다.

## 완료된 기능

- 권한 판정 전 protected child mount를 차단했습니다.
- `AUTHORIZED` 전 protected query, listener, command, write를 차단했습니다.
- Firebase Authentication과 application Authorization을 분리했습니다.
- Firestore, Storage, Functions에 서버 권위 application session fence를 적용했습니다.
- 이전 bundle, 직접 SDK, session proof 없는 Functions 호출의 우회를 차단했습니다.
- step-up 재인증 뒤 새 `auth_time`을 확인하고 application session을 회전하도록 구현했습니다.
- 일반 화면 30분, 관리자 설정 15분, 만료 5분 전 경고 정책을 고정했습니다.
- `teacherPatchNotes` Rules의 1,000식 초과를 해소하고 get/list를 분리했습니다.
- `teacherPatchNotes` 목록을 `updatedAt DESC`, `__name__ DESC`, `limit(1..100)`으로 제한했습니다.
- 관리자 설정 화면의 문서 단위 가로 overflow를 390, 768, 1024, 1280, 1600px에서 해소했습니다.
- TypeScript 기준선보다 신규 오류가 늘지 않도록 ratchet을 유지했습니다.

## Production에 승격하지 않는 이유

재인증과 application session 갱신은 성공하지만, 이후 `AuthContext.subscribeUserDocument`가 실행하는 `users/{uid}` 서버 get 또는 listener가 일부 Dedicated Staging 실행에서 `Missing or insufficient permissions`로 실패합니다. 보호 화면은 계속 차단되어 잘못된 command가 실행되지는 않지만, 정상 업무 화면으로 복귀하지 못하므로 Production 승격 조건을 충족하지 않습니다.

`KI-W1-01 — Post-Reauthentication User Probe Permission Denied`

- 분류: `RELEASE BLOCKER`
- 현재 Wave 영향: W2A Staging 개발을 차단하지 않음
- Production 영향: 해결 또는 비재현 증거를 확보하기 전 승격 금지
- business command dispatch: 실패 실행에서 0회

## 정확한 재현 조건

1. Dedicated Staging `westory-staging-177587430482`에서 합성 관리자 계정으로 `/teacher/settings?tab=interface`에 진입합니다.
2. step-up 재인증이 필요한 설정 저장을 시작합니다.
3. 비밀번호 재인증과 Firebase ID token 강제 갱신을 완료합니다.
4. `onIdTokenChanged`에서 새 `auth_time`을 관측합니다.
5. `openApplicationSession`이 HTTP 200을 반환하고 새 session이 `ACTIVE`가 됩니다.
6. schema 2, protocol 2, authority generation, 64자 revision 검증을 통과합니다.
7. `AuthContext.subscribeUserDocument`가 `users/{uid}` 서버 probe와 listener를 다시 엽니다.
8. 일부 실행에서 Firestore가 `permission-denied`를 반환하며 `SESSION_REFRESH_FAILED`로 끝납니다.

확인된 실패 순서는 다음과 같습니다.

`REAUTHENTICATING → ID_TOKEN_REFRESHED → ID_TOKEN_RESULT_VERIFIED → ID_TOKEN_CHANGED_OBSERVED → SESSION_ACTIVE → users/{uid} probe → FAILED`

## 증거

- 원본 로컬 증거: `docs/evidence/w1r5-credential-barrier/768-repeat/01/viewport-evidence.json`
- 원본 로컬 session 요약: `docs/evidence/w1r5-credential-barrier/session-summary.json`
- 체크포인트용 비민감 요약: `docs/evidence/w1r5-credential-barrier/evidence-summary.redacted.json`
- W1-R4 비민감 요약: `docs/evidence/w1r4-cross-viewport/evidence-summary.redacted.json`
- W1-R4 보고서: `docs/phase-6-w1r4-rules-budget-cross-viewport-closure-2026-08-10.md`

원본 JSON에는 폐기된 Staging UID와 전체 session revision 같은 인증 메타데이터가 들어 있어 체크포인트 push 대상에서 제외합니다. 파일은 로컬에서 삭제하지 않았으며, 체크포인트에는 재현 순서와 판정에 필요한 값만 남긴 비민감 요약을 포함합니다.

## 동결 과정에서 제외한 실패 실험

W1-R5 credential barrier 실험은 최종 probe를 통과하지 못했습니다. 안정 기준을 흐리지 않도록 런타임 변경은 기준 application HEAD로 되돌리고, 실패 결과와 분석은 이 문서와 증거에 보존합니다.

- `functions/sessionAuthority.js`: session 응답 schema 보강 실험
- `src/components/auth/StepUpReauthProvider.tsx`: credential barrier 완료·복구 흐름
- `src/contexts/AuthContext.tsx`: ID token 관측, credential epoch, 단일 probe와 listener 준비 barrier
- `src/lib/applicationSession.ts`: schema 2 client 검증 실험
- `src/lib/reauthCredentialBarrier.ts`: 진단 이벤트 모듈
- `scripts/verify-step-up-reauth.mjs`: barrier 계약 검증 실험
- `scripts/verify-w1r3-viewports.cjs`: W1-R5 진단 단계와 반복 실행 계측

실패 실험에서도 재인증 1회, session open 1회, business command 0회가 확인됐습니다. 문제 지점은 application session 생성 전이 아니라 이후 Firestore user probe입니다.

## 후속 Wave에서 지켜야 할 W1 invariant

1. `AUTHORIZED` 전에 protected React child, query, listener, command, write를 시작하지 않습니다.
2. Authentication 성공을 application Authorization 성공으로 간주하지 않습니다.
3. Firestore, Storage, Functions의 session schema, protocol, generation, revision 검증을 우회하지 않습니다.
4. 만료되거나 폐기된 application session은 business logic 진입 전에 거부합니다.
5. 고위험 command는 recent-auth와 high-risk session을 확인한 뒤 실행합니다.
6. old bundle, 직접 SDK, session proof 없는 호출이 새 command를 우회하지 못하게 합니다.
7. Production idle enforcement는 평가·교사 draft 복구와 `KI-W1-01`을 닫기 전까지 활성화하지 않습니다.
8. W2 Command Gateway는 W1의 client single-flight를 서버 exactly-once로 잘못 표현하지 않습니다.

## Release Candidate 재검증 조건

- 같은 사용자로 재인증한 뒤 `users/{uid}` get과 listener가 연속 반복 실행에서 모두 성공해야 합니다.
- 390, 768, 1024, 1280, 1600px와 Same User Multi-Context에서 `AUTHORIZED` 복귀를 확인해야 합니다.
- 새 `auth_time`, application session revision, Firestore listener가 같은 credential epoch를 사용한다는 증거가 필요합니다.
- business command dispatch는 복구가 끝난 뒤 한 번만 일어나야 합니다.
- 만료·폐기 session, 구 protocol, 잘못된 revision, App Check 누락은 계속 거부해야 합니다.
- Production idle enforcement는 W6A 평가 attempt와 교사 draft 복구 조건까지 확인한 뒤 별도로 승인합니다.

후속 구조 변경 뒤 `KI-W1-01`이 재현되지 않으면 반복 증거와 원인 설명을 남기고 issue를 닫습니다. 단일 성공 실행만으로 닫지 않습니다.

## Rollback 기준점

- Production known-good Git: `2e5b22926551ee3869c35df6320b996fe0de50cd`
- W1 application 기준: `832610e7380724496d13fd94c45081379ae8329d`
- W1-R2 검증 기준: `96163753c972f270e763174caa47f45c3df33ee2`
- W1-R4 Rules 변경은 체크포인트 commit 단위로 되돌릴 수 있습니다.
- Production에는 W1을 승격하지 않았으므로 운영 데이터 rollback은 필요하지 않습니다.

## W2A를 안전하게 시작할 수 있는 이유

W2A는 별도 브랜치와 Dedicated Staging에서 Query/Command 경계를 추가하는 작업입니다. W1의 protected mount 차단, 서버 session fence, recent-auth 검증을 그대로 사용하며 Production 설정과 데이터를 건드리지 않습니다. `KI-W1-01` 실패에서도 business command는 실행되지 않았으므로 권한 없는 쓰기가 발생한 상태가 아닙니다. W2A는 command가 business logic에 들어가기 전에 같은 session과 권한을 다시 확인하고, receipt와 business write를 원자화합니다. 따라서 W1의 미해결 복귀 문제를 숨기지 않으면서도 서버 멱등성 기반을 독립적으로 검증할 수 있습니다.

W1의 공식 상태는 다음과 같습니다.

`W1 FROZEN — CORE IMPLEMENTED, PRODUCTION PROMOTION DEFERRED`

`FROZEN — NOT PROMOTED, NOT BLOCKING FURTHER STAGING DEVELOPMENT`
