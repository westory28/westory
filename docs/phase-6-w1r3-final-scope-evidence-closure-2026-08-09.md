# PHASE 6 — W1-R3: Final Scope & Evidence Closure

- 작성 기준일: 2026-08-10 KST
- 기준 브랜치: `codex/phase6-w1r3-final-closure`
- 기준 SHA: `bd9c5358dffa6965b9a9e3264ec8f97313126b33`
- 검증한 application SHA: `832610e7380724496d13fd94c45081379ae8329d`
- Production 승격: 실행하지 않음
- W2 구현: 시작하지 않음

## 1. 최종 판정

`NOT READY FOR W1 PRODUCTION PROMOTION`

지정된 다섯 viewport의 실제 측정과 Access 상태 캡처는 완결했다. 관리자 설정의 반응형 overflow도 전 크기에서 해결되었다. 그러나 재인증 후 AuthContext의 Firestore 사용자 구독 복구가 5개 viewport 중 4개에서 `permission-denied`로 실패했다. 추가 전체 회귀에서는 session fence가 적용된 현행 Rules가 `teacherPatchNotes` 쓰기에서 Firestore Rules 표현식 1,000회 한도를 초과했다. 이 두 운영 결함이 남아 있으므로 Dedicated Staging 배포가 READY 상태여도 W1을 Production에 승격할 수 없다.

서버 idempotency receipt 미구현은 이번 FAIL 사유가 아니다. 해당 기능은 요청대로 W2의 필수 blocker로 이관했다.

## 2. 재인증 연속성 회귀

정적·단위 계약은 유지되었다.

- 재인증 성공 뒤 고위험 business command client dispatch: 1회
- 잘못된 비밀번호·취소·인증·token·session 실패: 0회
- session/recent-auth 또는 network 오류 뒤 business command 자동 retry: 0회
- 두 탭 Web Lock 경쟁: 1회 실행
- `AUTHENTICATING`, `UNAUTHORIZED`, `SESSION_EXPIRED`, `REAUTHENTICATING`, `SESSION_REFRESHING`에서 보호 배경 미노출 및 주요 action 접근: 다섯 viewport 모두 PASS

실제 Dedicated Staging 복구 결과는 다음과 같다.

| viewport | 재인증 중 | session 갱신 중 | AUTHORIZED 복귀 | console error |
| -------- | --------: | --------------: | --------------: | ------------: |
| 390×844  |      PASS |            PASS |        **FAIL** |             1 |
| 768×1024 |      PASS |            PASS |        **FAIL** |             1 |
| 1024×768 |      PASS |            PASS |            PASS |             0 |
| 1280×800 |      PASS |            PASS |        **FAIL** |             1 |
| 1600×900 |      PASS |            PASS |        **FAIL** |             1 |

네 실패는 모두 재인증 dialog가 닫히지 않고 `새 로그인 세션으로 데이터 연결을 다시 시작하지 못했습니다`를 표시했다. console에는 `Failed to subscribe user data FirebaseError: Missing or insufficient permissions.`가 기록되었다. 실패 화면에서도 dialog는 viewport 안에 있었고 focus와 primary action을 유지했으며 보호 배경은 hidden/inert 상태였다. UI 안전 차단은 동작했지만 정상 업무 복귀 계약은 충족하지 못했다.

최신 원본 증거는 [viewport-evidence.json](./evidence/w1r3-access-viewports/viewport-evidence.json)과 같은 폴더의 상태별 PNG다. 이전 실행의 1024px 실패 진단 2장은 `prior-run/`으로 분리했다.

## 3. 고위험 command 분류와 W2 이관

W1에서 step-up 재인증을 연결한 명령 28개를 전수 분류했다.

| 구분                     | NATURALLY_IDEMPOTENT | NON_IDEMPOTENT | UNKNOWN |   합계 |
| ------------------------ | -------------------: | -------------: | ------: | -----: |
| 직접 Firestore 설정 명령 |                    9 |              3 |       0 |     12 |
| 보호 callable            |                   11 |              5 |       0 |     16 |
| 합계                     |               **20** |          **8** |   **0** | **28** |

W1은 기존 business write의 의미를 바꾸거나 서버 retry를 추가하지 않았다. 모든 28개 명령은 사용자 수동 재시도가 가능하지만, W1이 새 자동 retry·이중 dispatch·중복 write 경로를 만들었다는 증거는 없다. 다만 응답 유실, process crash, 교차 기기 및 동시 중복은 client single-flight로 해결되지 않는다.

필수 W2 handoff는 [w2-high-risk-command-idempotency-handoff.md](./handoff/w2-high-risk-command-idempotency-handoff.md)에 작성했다. 여기에는 실제 route·write path·collection/document·operation·retry 가능성·분류와 함께 command ID, server receipt, business write 원자성, 응답 유실 재조회, 교차 기기 경쟁, 장기 작업 상태, audit, rollback, W2 acceptance test를 고정했다. receipt 구현은 시작하지 않았다.

## 4. 실제 viewport 측정

Playwright Chromium 151.0.7922.76의 독립 BrowserContext를 navigation 전에 생성하고 viewport를 정확히 고정했다.

| viewport | inner    | document client/scroll | 설정 content client/scroll | page overflow | content overflow | sidebar 겹침 | 마지막 action |
| -------- | -------- | ---------------------- | -------------------------- | ------------: | ---------------: | -----------: | ------------: |
| 390×844  | 390×844  | 390 / 390              | 342 / 342                  |             0 |                0 |            0 |     접근 가능 |
| 768×1024 | 768×1024 | 768 / 768              | 720 / 720                  |             0 |                0 |            0 |     접근 가능 |
| 1024×768 | 1024×768 | 1024 / 1024            | 656 / 656                  |             0 |                0 |            0 |     접근 가능 |
| 1280×800 | 1280×800 | 1280 / 1280            | 912 / 912                  |             0 |                0 |            0 |     접근 가능 |
| 1600×900 | 1600×900 | 1600 / 1600            | 912 / 912                  |             0 |                0 |            0 |     접근 가능 |

관리자 설정 캡처는 `admin-settings-{viewport}.png` 이름으로 저장했다. 특히 1024×768에서 page horizontal overflow, sidebar/content overlap, form/action 잘림, 접근 불가 button, nested container overflow, console/page error가 모두 0이었다. 화면을 직접 확인했으며 권한 표의 가로 스크롤은 표 내부에 머물고 문서 폭으로 전파되지 않았다.

## 5. Access UI 반응형 결과

- `AUTHENTICATING`: 다섯 viewport 모두 overflow 0, 보호 heading 미노출.
- `UNAUTHORIZED`: 다섯 viewport 모두 overflow 0, primary action viewport 안, 보호 heading 미노출.
- `SESSION_EXPIRED`: 다섯 viewport 모두 overflow 0, primary action viewport 안, 보호 heading 미노출.
- `REAUTHENTICATING`: 다섯 viewport 모두 dialog clipping 0, focus 이탈 0, 보호 배경 노출 0.
- `SESSION_REFRESHING`: 다섯 viewport 모두 dialog clipping 0, focus 이탈 0, 보호 배경 노출 0.
- `AUTHORIZED` 복귀: 1024×768만 PASS. 나머지 4개는 Firestore 권한 오류로 FAIL.

따라서 Access 화면의 반응형 layout과 차단 상태는 PASS지만, 재인증 성공 뒤 정상 복귀까지 포함한 Access E2E는 FAIL이다.

## 6. 이전 bundle·직접 SDK·Functions와 Rules

`verify:session-authority-w1r2` 통합 에뮬레이터 묶음은 PASS했다.

- 이전 bundle/session proof 없음: 차단
- session revision mismatch와 구 protocol: 차단
- 직접 Firestore 및 Storage SDK: 차단
- 직접 callable 및 raw HTTP Function: 차단
- 만료·누락·닫힌 application session: 차단
- Firestore·Storage·Functions production access: 0

다만 주변 Rules 회귀는 닫히지 않았다.

- `teacherPatchNotes` 정상 교사 create/update: **FAIL** — Firestore Rules 표현식 최대 1,000회 초과.
- `score-warning` Rules suite: 격리 Auth·Firestore emulator에서 5분 안에 완료되지 않아 timeout. PASS 증거를 확보하지 못했다.
- session-authority Rules·Storage·Functions·integration suite: PASS.

즉 session fence 자체의 우회 차단은 통과했지만 기존 정상 write 경로의 Rules 예산 회귀가 존재한다.

## 7. Dedicated Staging과 Production 무변경

- Dedicated Staging Firebase: `westory-staging-177587430482`
- Dedicated Staging Vercel project: `westory-staging` (`prj_XMo7TjPKno80BKCnx0YW3JoGXY8B`)
- 검증 Preview: `dpl_EnQcmTLAdGu3ecr7Yx5hBVys3poM`, READY, source application SHA `832610e7380724496d13fd94c45081379ae8329d`
- Preview host: `westory-staging-inius92vz-bbbs-projects-44f9da30.vercel.app`
- 검증용 App Check debug token: W1-R3 임시 항목 2개 삭제 후 잔여 0
- Vercel automation bypass: 검증 후 revoke, 잔여 0

Production은 읽기 전용으로 재확인했다.

- Vercel: `dpl_7r2BkKz1STPv5j15xstj5GArai5V`, READY, 기존 production 유지
- Firestore Rules: `36de907e-9fbf-41eb-b084-95a1419bf097`, 기존 release 유지
- Storage Rules: `7a52c62c-6075-4b2a-80ec-99f0c8a13a8c`, 기존 release 유지
- Functions: 43개, application-session 신규 함수 0
- Production 데이터·Rules·Functions·Auth·Storage·배포·alias 변경: 0

## 8. 자동 검증과 TypeScript

| 검증                                       | 결과                                     |
| ------------------------------------------ | ---------------------------------------- |
| `npm run verify:access-gate`               | PASS — 학생 17, 교사 13, 차단 상태 5     |
| `npm run verify:session-policy`            | PASS — 30분/15분/5분                     |
| `npm run verify:step-up-reauth`            | PASS — 성공 1, 실패·취소 0, 자동 retry 0 |
| `npm run verify:assessment-attempt-safety` | PASS                                     |
| `npm run verify:session-authority-w1r2`    | PASS                                     |
| `npm run verify:firebase-environment`      | PASS — 15 cases                          |
| `npm run verify:vercel-config`             | PASS — 5 cases                           |
| `npm run security:check-supply-chain`      | PASS                                     |
| `npm run build`                            | PASS — 423 modules                       |
| `npm run format:check`                     | PASS                                     |
| `npm --prefix functions run check`         | PASS                                     |
| `npm run verify:typescript-baseline`       | PASS — 기존 63건/13파일, 신규 0          |
| `verify:teacher-patch-notes-rules`         | **FAIL — Rules expression limit**        |
| `verify:score-warning-rules`               | **FAIL — timeout, PASS 증거 없음**       |
| 실제 5-viewport browser E2E                | **FAIL — AUTHORIZED recovery 4/5 실패**  |

TypeScript fingerprint는 `d12acd9bf8b88cff88da0009e010c42b7b6809ee658e38d8dfaa5351c11afc80`로 기준선과 같다.

GitHub Safety Baseline은 application SHA `832610e7380724496d13fd94c45081379ae8329d`의 run [31382487782](https://github.com/westory28/westory/actions/runs/31382487782)가 PASS했다. 이 workflow에는 이번 실브라우저 E2E와 위 두 레거시 Rules suite가 포함되지 않으므로, GitHub PASS를 W1 최종 READY 근거로 사용하지 않는다.

## 9. 변경 파일과 rollback

- 기준 SHA 대비 application·검증·handoff 변경: 12개 tracked path.
- 최종 보고서와 viewport JSON/PNG evidence를 포함한 기준 SHA 대비 전달 파일: 55개.
- 사용자 기존 `AGENTS.md`, `DESIGN.md`, `UI_RULES.md`, PHASE 1~6 문서와 `tmp/`는 수정·정리하지 않았다.
- rollback 단위: W1-R3 branch/Preview 전체. Production에 배포하지 않았으므로 Production data rollback은 필요하지 않다.
- Dedicated Staging rollback 후보는 W1-R2 검증 Preview이며, 현 W1-R3 Preview는 승격하지 않는다.

## 10. 남은 blocker와 STOP

1. 재인증 후 새 application session 확립 뒤 AuthContext user subscription이 4/5 viewport에서 `permission-denied`로 실패한다.
2. session-aware Firestore Rules가 기존 `teacherPatchNotes` 정상 write에서 표현식 1,000회 한도를 초과한다. `score-warning` Rules suite도 완결하지 못했다.
3. W2는 28개 고위험 명령의 server command ID·receipt·원자성·응답 재생을 blocking acceptance로 구현해야 한다. 이 항목은 W1-R3 FAIL 사유로 사용하지 않았다.

`NEXT WAVE STARTED: NO`

Production promotion과 W2는 시작하지 않고 여기서 중단한다.
