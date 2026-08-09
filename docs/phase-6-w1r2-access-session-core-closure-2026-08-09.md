# PHASE 6 — W1-R2: Access & Session Core Closure

- 작성 기준일: 2026-08-10 KST
- 기준 브랜치: `codex/phase6-w1r2-access-session-closure`
- 구현 기준 SHA: `96163753c972f270e763174caa47f45c3df33ee2`
- 기준선: `2c1b0a249cc49619ce63306deb059a4782722084`
- Production 승격: 실행하지 않음
- W2: 시작하지 않음

## 1. 최종 판정

`NOT READY FOR W1 PRODUCTION PROMOTION`

W1-R2의 접근 차단, 서버 application session, App Check 기반 이전 번들·직접 SDK 차단, 실제 step-up 재인증 연속성은 Staging에서 확인했다. 그러나 아래 두 증거가 완료 조건을 충족하지 못해 Production 승격 준비 완료로 판정하지 않는다.

1. 고위험 명령은 탭 내 single-flight와 Web Lock 경합 테스트는 통과했으나, 서버 idempotency receipt가 없는 직접 Firestore 설정 명령은 응답 유실·교차 기기 재시도까지 포함한 exactly-once를 보장하지 못한다.
2. 지정 Chrome의 viewport capability가 1024px override와 reload 뒤에도 `window.innerWidth=1920`으로 남았다. 코드·정적 레이아웃 계산은 통과했지만 390/768/1024/1280/1600px 실브라우저 증거를 완결하지 못했다.

두 항목은 제품 결함을 PASS로 둔갑시키지 않고 W1 Production promotion blocker로 유지한다.

## 2. 재인증 연속성

### 해결 내용

- 고위험 명령 전에 Firebase 공식 비밀번호·Google 재인증을 수행한다.
- 재인증 직전에 서버가 90초짜리 reauthentication transition을 만든다.
- Firebase 인증 epoch가 바뀌기 전에 Firestore network를 일시 중지하고, 새 application session과 AuthContext가 확정된 뒤 network를 재개한다. 기존 listener가 구 token으로 먼저 재연결되어 terminal `permission-denied`가 되는 경합을 이 순서로 제거했다.
- 새 ID token의 `auth_time`으로 application session을 생성하는 동안 Firestore·Storage Rules가 transition을 검증해 보호 화면의 읽기 연속성을 유지한다.
- session proof는 메모리에만 저장하며, 보호 callable에는 `_session`의 generation·protocol·revision을 중앙 주입한다.
- 같은 UID의 token refresh 때 AuthContext가 기존 사용자 문서 구독 revision을 폐기하고 새 session 확인 후 다시 구독한다.
- Staging은 idle/session authority와 App Check를 `ENFORCE`, Production 후보 설정은 idle `OBSERVE_ONLY` 또는 `DISABLED`와 App Check `OBSERVE_ONLY`를 기본으로 둔다.

### 실제 Staging 결과

- 잘못된 비밀번호: 오류 안내 표시, 설정 문서 `updateTime` 불변, 원래 명령 0회.
- 사용자 취소: modal 종료, 설정 문서 `updateTime` 불변, 원래 명령 0회.
- 올바른 비밀번호: 보호 화면과 return path 유지, modal 종료, 원래 설정 명령 1회 실행.
- 최종 재인증 검증 구간: `2026-08-09T15:27:05.697Z` 이후 브라우저 error/warn 0건.
- 새 `auth_time`: `1786289242`.
- 새 application session: `active`, 생성 시각 `2026-08-09T15:27:22.918391Z`.
- session 계약: schema 2, protocol 2, generation `w1r2-2026-08-09`, server revision 64자, Staging mode `ENFORCE`.
- reauthentication transition: 새 session 확립 뒤 없음.
- 설정 문서 `updateTime`: `2026-08-09T15:18:23.821623Z` → `2026-08-09T15:27:24.741262Z`.

새 session 생성 직후 이전 auth epoch를 즉시 닫는 추가 실험은 기존 Firestore listener가 새 token으로 전환되기 전에 terminal `permission-denied`를 일으켰다. 이 실험 커밋은 즉시 되돌렸고 Staging 함수도 검증된 연속성 구현으로 롤백했다. Firebase 재인증 자체도 기존 ID token을 즉시 철회하는 동작이 아니므로, 이전 epoch는 원래 idle/session fence에 따라 만료된다.

## 3. 이전 번들·직접 우회 검증

서버 차단을 기준으로 다음을 확인했다.

| 경로 | 결과 |
|---|---|
| 이전 bundle 단독 로그인, application session 없음 | 보호 데이터 차단 |
| 현재 session을 공유한 이전 bundle | Firestore `permission-denied`, 보호 화면 미노출 |
| 직접 Firestore SDK, App Check 없음 | HTTP 403 |
| 직접 Storage SDK, App Check 없음 | `storage/unauthorized`, HTTP 403 |
| 직접 callable SDK, App Check 없음 | `functions/unauthenticated`, `APP_CHECK_REQUIRED` |
| 직접 HTTP Function, App Check 없음 | HTTP 401, `APP_CHECK_REQUIRED` |
| 구 protocol 또는 session proof 없음 | Functions·Rules 거부 |

App Check는 유효한 attestation을 얻는 동일 origin 변형 코드를 완전히 식별하는 build-signature 장치가 아니다. 따라서 민감 명령은 session generation·protocol·server revision과 gateway 검증을 함께 사용한다.

## 4. Production idle enforcement와 Production 무변경

- Production idle enforcement: 활성화하지 않음.
- 후보 코드 기본값: Production `OBSERVE_ONLY` 또는 `DISABLED`; Staging `ENFORCE`.
- Production App Check enforcement: 활성화하지 않음. 후보 코드 기본은 `OBSERVE_ONLY`.
- Production Vercel: `dpl_7r2BkKz1STPv5j15xstj5GArai5V`, 기존 상태 유지.
- Production Functions: 43개, application-session 신규 함수 0개.
- Production Firestore Rules: `projects/history-quiz-yongsin/rulesets/36de907e-9fbf-41eb-b084-95a1419bf097`, 업데이트 시각 `2026-07-05T09:17:23.3348Z`, 기존 상태 유지.
- Production 데이터·Rules·Functions·Auth·배포 변경: 0.

## 5. Dedicated Staging

- Firebase: `westory-staging-177587430482`.
- Vercel project: `westory-staging` (`prj_XMo7TjPKno80BKCnx0YW3JoGXY8B`).
- 최종 Preview: `dpl_FybDPNJbsUUfNW5QMjqT2BdgJbtg`, READY.
- Preview URL: `westory-staging-h5gvoj2u2-bbbs-projects-44f9da30.vercel.app`.
- 안정 alias: `westory-staging-westoria28-8028-bbbs-projects-44f9da30.vercel.app`.
- Staging Firestore App Check: `ENFORCED`.
- Staging Firebase Storage App Check: `ENFORCED`.
- 배포 함수: `openApplicationSession`, `beginApplicationSessionReauthentication` 포함 session core는 ACTIVE.

Firebase CLI는 함수와 Rules 배포를 성공시킨 뒤 Artifact Registry cleanup policy 미설정 때문에 종료 코드 1을 반환했다. 실제 함수 ACTIVE와 Rules release를 별도로 확인했으며, cleanup policy는 이번 W1-R2 범위에서 임의 변경하지 않았다.

## 6. Access 회귀와 자동 검증

- `verify:access-gate`: PASS — 학생 17 route, 교사 13 route, 차단 상태 5종.
- `verify:session-policy`: PASS — 일반 30분, 고위험 15분, 5분 전 경고.
- `verify:step-up-reauth`: PASS — 두 탭 Web Lock single-flight, 실패·취소·token/session 오류에서 명령 0.
- `verify:session-authority-w1r2`: PASS — Auth·Firestore·Functions·Storage emulator 통합.
- Firestore Rules: PASS.
- Storage Rules: PASS, 대표 교사 write의 고유 Firestore access 3회로 한도 이내.
- Functions syntax check: PASS.
- `npm run format:check`: PASS.
- `npm run build`: PASS, 423 modules.
- TypeScript baseline: 기존 63건/13파일, fingerprint `d12acd9bf8b88cff88da0009e010c42b7b6809ee658e38d8dfaa5351c11afc80`, 신규 오류 0.
- GitHub Safety Baseline: PASS — run `31320990581`, SHA `96163753c972f270e763174caa47f45c3df33ee2`.

## 7. 1024px overflow와 반응형 검증

원인은 Settings의 오른쪽 flex item이 기본 `min-width:auto`를 유지해, 내부 권한 표의 `min-width:1040px`가 전체 문서 폭으로 전파된 것이었다.

- `Settings.tsx`: 오른쪽 영역을 `min-w-0 flex-1`로 수정.
- `SettingsAccess.tsx`: 표의 `overflow-x-auto`와 `min-w-[1040px]`는 유지해 표 내부에서만 가로 스크롤.
- 정적 레이아웃 계산: 390/768/1024/1280/1600px에서 문서 overflow 0.
- 실제 지정 Chrome: viewport override가 적용되지 않아 1024px 설정 뒤 reload해도 `innerWidth=1920`이었다. Windows Chrome 창 자체를 1040px로 축소하고 viewport 제한을 해제한 뒤 다시 로드해도 `outerWidth=1040`, `innerWidth=1920`으로 분리되었다. 검증 후 창 위치와 최대화 상태는 원래 값으로 복원했다.

따라서 overflow 수정 자체는 최소 범위로 완료했으나 필수 5폭 실브라우저 증거는 미완료다.

## 8. 후속 Wave 이관

- 교사 편집 51개 surface와 공통 Draft Contract: [w6-w9-draft-recovery-handoff.md](./handoff/w6-w9-draft-recovery-handoff.md)
- 평가 P0-01~07 및 A01~A08: [w6a-assessment-session-recovery-handoff.md](./handoff/w6a-assessment-session-recovery-handoff.md)

이 두 묶음은 W1-R2 FAIL 조건으로 사용하지 않았고, 각각 Domain Wave/W9와 W6A의 blocking acceptance로 보존했다. Production idle enforcement는 해당 복구 경계가 닫히기 전까지 활성화하지 않는다.

## 9. 변경 범위와 rollback

- 기준선 대비 코드·Rules·검증·handoff 파일: 27개.
- 이 보고서를 포함한 변경 파일: 28개.
- 사용자 기존 dirty 파일과 PHASE 1~6 문서는 수정·정리하지 않았다.
- W1-R2 구현은 additive session collections·functions와 client gate로 구성했다.
- client rollback: 이전 Staging Preview `dpl_5VX7vM6CrwtmvtBMoLqeHShT9q8P`로 alias 복귀.
- Functions rollback: 기준 source에서 개별 session function 재배포.
- Rules rollback: 기준 ruleset 재배포.
- 조기 이전-session 종료 실험은 독립 커밋 후 실제로 revert·재배포하여 rollback 경로를 확인했다.

## 10. 남은 blocker와 STOP

1. 고위험 명령의 서버 idempotency key·receipt·응답 재생 계약이 없어 네트워크 응답 유실과 교차 기기 재시도의 exactly-once가 미완료다.
2. 지정 Chrome에서 390/768/1024/1280/1600px 실제 viewport evidence를 생성할 수 있어야 한다.

`NEXT WAVE STARTED: NO`

Production promotion과 W2는 시작하지 않고 여기서 중단한다.
