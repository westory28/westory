# PHASE 6 — W1-R4: Firestore Rules Budget & Cross-Viewport Closure

- 작성 기준일: 2026-08-10 KST
- 기준 브랜치: `codex/phase6-w1r4-rules-budget-closure`
- 기준 HEAD: `832610e7380724496d13fd94c45081379ae8329d`
- Production 승격: 실행하지 않음
- W2 구현: 시작하지 않음

## 1. 최종 판정

`NOT READY FOR W1 PRODUCTION PROMOTION`

로컬 Rules 예산, 에뮬레이터 matrix, 기존 W1 회귀와 Dedicated Staging Rules 반영은 통과했다. 승인된 임시 공유 링크로 새 Dedicated Staging Preview를 검증한 결과 `390×844`은 통과했지만 `768×1024`의 재인증 복귀가 다시 실패했다. 필수 순차 실행은 두 번째 viewport에서 중단되었으므로 나머지 3개 viewport와 Same User Multi-Context는 통과 증거가 없으며 READY로 판정하지 않는다.

실패 직후 임시 공유 링크를 폐기했고, 링크를 담았던 임시 파일도 삭제했다. 합성 application session과 W1-R4 App Check debug token은 모두 0건으로 정리했다. 완료 조건 미충족에 따라 commit·push는 실행하지 않았다.

## 2. permission-denied 최종 원인

W1-R3에서 네 viewport의 재인증 복귀를 막은 요청은 `teacherPatchNotes`가 아니라 `AuthContext`가 다시 연 `users/{uid}` 단일 문서 get/listener였다. `src/contexts/AuthContext.tsx`의 서버 get과 `onSnapshot` 재연결이 실패했고, console에는 `Failed to subscribe user data FirebaseError: Missing or insufficient permissions.`가 남았다.

기존 Rules의 `users/{userId}` get은 바깥 `canUseWestory()`를 평가한 뒤 `isOwnUser()` 안에서 같은 session fence를 다시 평가했다. 재인증 전환 중에는 active session과 transition 분기까지 반복되어 평가 비용과 timing 민감도가 커졌다. W1-R3의 다섯 실행은 동일 UID를 사용하면서 각 실행 전 session 문서와 transition을 명시적으로 정리하지 않아, 새 `auth_time`과 session revision을 만드는 setup·reauth·listener 재연결이 서로 다른 timing으로 진행됐다. 1024×768만 통과한 결과는 responsive data flow 차이가 아니라 이 Rules 비용·테스트 격리 문제의 조합이었다.

별도로 `teacherPatchNotes`의 정상 교사 create는 에뮬레이터가 정확히 `maximum of 1000 expressions to evaluate has been reached`로 거부했다. 따라서 실패를 다음처럼 분류한다.

최종 실브라우저 실행에서도 주 실패 요청은 `teacherPatchNotes`가 아니라 재인증 직후 `AuthContext.subscribeUserDocument`가 다시 연 `users/{uid}` listener였다. `openApplicationSession`은 같은 `auth_time`과 같은 revision으로 3회 모두 HTTP 200을 반환했고 서버 session 문서는 `ACTIVE`, schema/protocol은 모두 2였다. 그런데 Firestore listener는 `permission-denied`를 반환했고 보호 화면 복구와 patch-note listener가 함께 열리지 않았다. App Check 강제 refresh 뒤에도 768px 실행에서 재현되었으므로, 이번 범위 안에서는 재인증 뒤 Firestore credential/listener 재개 경합이 해소되지 않은 기술적 blocker로 남는다.

| 분류                              | 판정        | 근거                                                                                                                  |
| --------------------------------- | ----------- | --------------------------------------------------------------------------------------------------------------------- |
| A. `SESSION_FAILURE`              | 주원인 아님 | 재인증과 새 session open 자체는 성공했으며 실패 지점은 이후 user listener였다.                                        |
| B. `RULE_EXPRESSION_LIMIT`        | **확정**    | baseline `teacherPatchNotes` create가 1,000식 한도에서 실패했고, user get도 session helper를 중복 평가했다.           |
| C. `RULE_ACCESS_CALL_LIMIT`       | 해당 없음   | target 요청은 교사 2회, 관리자 1회로 단일 요청 공식 한도 10회보다 충분히 낮다.                                        |
| D. `QUERY_RULE_MISMATCH`          | 수정 완료   | 목록을 `updatedAt DESC`, `limit(100)`으로 고정하고 제한 없는 목록 요청을 거부한다.                                    |
| E. `TEST_ISOLATION_FAILURE`       | **확정**    | W1-R3는 viewport 사이 session cleanup이 없었다. W1-R4는 각 viewport 전에 session/transition을 정리하고 순차 실행한다. |
| F. `RESPONSIVE_DATA_FLOW_FAILURE` | 해당 없음   | viewport별 component tree·breakpoint listener가 없고 공통 controller 하나가 같은 query를 소비한다.                    |
| G. `OTHER`                        | 별도 기록   | App Check가 없는 브라우저와 Auth emulator 누락 실행은 제품 실패가 아닌 test-environment 오류로 분리했다.              |

## 3. `teacherPatchNotes` Rules before/after

Before:

- `hasActiveApplicationSession()`이 같은 session document를 필드마다 반복 `get()`했다.
- reauth transition은 `exists()`와 반복 `get()`을 함께 사용했다.
- `isTeacherPatchNoteOwner()`가 `isAdmin()`과 `isTeacherRole()`을 통해 session·profile helper를 다시 평가했다.
- `read`가 get/list를 구분하지 않았고 목록의 limit/order 계약이 없었다.
- 정상 create가 1,000식 한도에 도달했다.

After:

- application session과 reauth transition은 각각 `let`으로 한 번 읽고 같은 map을 재사용한다.
- owner 검사는 UID, active session, 관리자 이메일 또는 교사 profile 1회 조회로 단순화했다.
- `users/{uid}` own get은 바깥 session fence를 한 번만 평가한다.
- `get`, `list`, `create`, `update`, `delete`를 분리했다.
- list는 `updatedAt DESC`, 암시적 `__name__ DESC`, `limit(1..100)`만 허용한다.
- role, session schema/protocol/revision, 만료·폐기 차단, owner path, payload 필드, `/teacher` source path 조건은 유지했다.

## 4. Rules 표현식·document access budget

동일한 정상 교사 create의 rule coverage 비교는 다음과 같다.

| 지표                         |                  Before |   After |                    변화 |
| ---------------------------- | ----------------------: | ------: | ----------------------: |
| 결과                         | `RULE_EXPRESSION_LIMIT` | `ALLOW` |          한도 초과 해소 |
| coverage nested value count  |                   2,191 |   1,155 |             47.28% 감소 |
| session-path 반복 지표       |                     756 |      27 |             96.43% 감소 |
| 교사 Rules document access   |               반복 구조 |       2 | 공식 10회 대비 8회 여유 |
| 관리자 Rules document access |               반복 구조 |       1 | 공식 10회 대비 9회 여유 |
| own `users/{uid}` get access |       반복 session 평가 |       1 | 공식 10회 대비 9회 여유 |

coverage nested value count는 플랫폼의 정확한 per-request expression counter가 아니라 before/after 비교 지표다. 정확한 before 실패는 에뮬레이터의 1,000식 오류로, after 여유는 동일 요청 성공·helper 구조 축소·document access 계산·20-case matrix·Dedicated Staging 요청으로 함께 판정한다. Firebase 공식 한도는 단일 get/list 요청 document access 10회, function call depth 20, 요청당 표현식 1,000회다.

원본 evidence:

- `docs/evidence/w1r4-rules-budget/before-create-rule-coverage.json`
- `docs/evidence/w1r4-rules-budget/after-create-rule-coverage.json`
- `docs/evidence/w1r4-rules-budget/after-rule-coverage.json`
- `docs/evidence/w1r4-rules-budget/coverage-summary.json`

## 5. query/listener 중복 여부

- `MainLayout`은 teacher enhancement가 준비됐을 때 `TeacherPatchMemoController`를 한 번만 mount한다.
- controller의 subscription effect는 `uid`, teacher route, permission, toast callback에만 의존하며 viewport·breakpoint에 의존하지 않는다.
- 실제 query는 `teacherPatchNotes/{uid}/notes`, `orderBy(updatedAt, desc)`, `limit(100)` 한 개다.
- 모바일 메뉴와 데스크톱 shell에 controller 복제본이 없고 CSS-hidden 중복 listener도 없다.
- layout resize를 subscription dependency로 쓰지 않는다.

## 6. Rules matrix와 기존 W1 회귀

`teacherPatchNotes` Rules matrix 20건이 통과했다. active teacher/admin/reauthenticated teacher의 정규 query와 정상 create/update/done/delete를 허용하고, 무제한 query, 타 교사 path, anonymous, student, staff, expired/revoked session, 구 schema/protocol, 잘못된 revision, collection-group query, 잘못된 source path와 예기치 않은 payload를 거부했다.

| 검증                                                  | 결과                                              |
| ----------------------------------------------------- | ------------------------------------------------- |
| supply-chain IOC                                      | PASS                                              |
| Firebase environment isolation                        | PASS — 15 cases                                   |
| Vercel config isolation                               | PASS — 5 cases                                    |
| Access gate                                           | PASS — 학생 17, 교사 13, 차단 상태 5              |
| session policy                                        | PASS — 30분/15분/5분                              |
| step-up reauthentication                              | PASS — 성공 dispatch 1, 실패·취소 0, 자동 retry 0 |
| assessment attempt safety                             | PASS                                              |
| teacher navigation                                    | PASS                                              |
| session authority Rules·Storage·Functions·integration | PASS — production access 0                        |
| score-warning Rules                                   | PASS — Auth+Firestore emulator                    |
| `teacherPatchNotes` Rules                             | PASS — 20 cases                                   |
| Rules budget static contract                          | PASS                                              |
| Functions syntax                                      | PASS                                              |
| build                                                 | PASS — 423 modules                                |
| format                                                | PASS                                              |
| TypeScript baseline                                   | PASS — 기존 63건/13파일, 신규 0                   |

`score-warning`의 예기치 않은 필드 거부 case는 보안상 deny로 끝나지만 기존 `users` update 분기의 평가 예산이 1,000식에 닿는 로그가 남는다. 정상 학생 bootstrap/update와 signature·consent 허용 경로는 통과했다. 이 deny-path 최적화는 `teacherPatchNotes`와 Access get/listener만 허용한 W1-R4 범위에는 넣지 않았으며, 이후 Rules 유지보수 항목으로 남긴다.

## 7. Isolated Viewport 결과

**부분 실행 / FAIL gate.**

승인된 임시 공유 링크를 이용해 각 viewport를 순차 실행했다. `390×844`은 관리자 설정, AUTHENTICATING, UNAUTHORIZED, SESSION_EXPIRED, 재인증 복귀, patch-note listener, overflow 검사를 모두 통과했다. `768×1024`는 정적 화면과 접근 상태 검사는 통과했지만 재인증 뒤 `users/{uid}` listener가 `permission-denied`로 실패해 보호 화면과 patch-note listener가 복구되지 않았다. fail-fast 계약에 따라 `1024×768`, `1280×800`, `1600×900`은 실행하지 않았다.

| viewport   | 결과   | 핵심 증거                                                                                                                        |
| ---------- | ------ | -------------------------------------------------------------------------------------------------------------------------------- |
| `390×844`  | PASS   | page/settings overflow 0, protected state PASS, reauth recovery PASS, patch-note listener PASS, console error 0                  |
| `768×1024` | FAIL   | session open HTTP 200·동일 revision이나 `users/{uid}` listener `permission-denied`, authorized recovery·patch-note listener 실패 |
| `1024×768` | 미실행 | 앞 viewport 실패로 중단                                                                                                          |
| `1280×800` | 미실행 | 앞 viewport 실패로 중단                                                                                                          |
| `1600×900` | 미실행 | 앞 viewport 실패로 중단                                                                                                          |

증거는 `docs/evidence/w1r4-cross-viewport/isolated/390x844`와 `docs/evidence/w1r4-cross-viewport/isolated/768x1024`에 남겼다.

## 8. Same User Multi-Context 결과

**미실행 / FAIL gate.**

동일 UID의 독립 BrowserContext 2개에서 1024×768 primary가 재인증하고 390×844 peer가 새로고침한 뒤, 양쪽 보호 화면·return path·patch-note listener·재인증 dispatch 1회를 검사하도록 준비했다. 그러나 필수 Isolated Viewport 실행이 768×1024에서 실패해 선행 gate에 따라 실행하지 않았다.

## 9. 5개 viewport 재인증 결과

실제 새 E2E 결과는 `390×844` PASS, `768×1024` FAIL이다. 768px 실패 실행에서 재인증 identity 요청은 1회였고 session open 3회는 모두 같은 `auth_time=1786370450`, 같은 revision `aa53895f...`, protocol 2, authority mode `ENFORCE`로 성공했다. 이후 `users/{uid}` listener가 반복 거부되어 복구 dialog가 닫히지 않았고 `teacherPatchNotes/{uid}/notes` listener도 사용할 수 없었다. 5종 전부 PASS라는 완료 조건을 충족하지 못했다.

## 10. Dedicated Staging·GitHub·Production 무변경

- Dedicated Staging Firebase: `westory-staging-177587430482`
- Dedicated Staging Firestore ruleset: `06292287-6414-45ba-8da9-f87ea3f4a0a0`
- Dedicated Staging Vercel deployment: `dpl_7z4PRhHSvpwivVy2sgWk9PyxWzVq`, READY, Preview only
- Staging application source: 기준 HEAD `832610e7380724496d13fd94c45081379ae8329d`에 재인증 후 App Check refresh 수정만 적용한 임시 검증 빌드
- GitHub Safety Baseline: application SHA run `31382487782`, PASS
- GitHub Pages deploy workflow: `disabled_manually`
- 임시 공유 링크: 검증 직후 폐기, 로컬 임시 파일 삭제
- 정리 확인: 합성 application session 0, W1-R4 App Check debug token 0

Production은 읽기 전용으로 재확인했다.

- Vercel deployment: `dpl_7r2BkKz1STPv5j15xstj5GArai5V`, READY, 기존 Production 유지
- Firestore ruleset: `36de907e-9fbf-41eb-b084-95a1419bf097`, 기존 release 유지
- Production Rules·Functions·Firestore·Storage·Auth·배포·alias 변경: 0
- Production idle enforcement: 활성화하지 않음

## 11. 변경·rollback·남은 blocker·STOP

- W1-R4 작업 트리 범위: 35개 path — 코드·검증·보고서 10개, Rules evidence 6개, cross-viewport evidence 19개. 사용자 기존 문서와 `tmp/`는 제외했다.
- branch: `codex/phase6-w1r4-rules-budget-closure`
- current/full SHA: `832610e7380724496d13fd94c45081379ae8329d` — 미커밋 상태이므로 W1-R4 결과 commit SHA는 없음.
- rollback 단위: W1-R4 Firestore Rules와 검증 harness. Dedicated Staging은 직전 W1-R3 ruleset으로 되돌릴 수 있다.
- Production에 반영하지 않았으므로 Production data rollback은 필요하지 않다.
- 남은 blocker: 재인증 뒤 새 application session은 정상인데 Firestore `users/{uid}` listener가 간헐적으로 이전 credential 상태로 재개되어 `permission-denied`가 발생한다. 이 때문에 Isolated 5종과 Same User Multi-Context 완료 조건을 충족하지 못했다.
- commit/push: 완료 조건 미충족으로 실행하지 않음.

`NEXT WAVE STARTED: NO`

Production promotion과 W2는 시작하지 않는다.
