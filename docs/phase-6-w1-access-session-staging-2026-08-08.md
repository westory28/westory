# PHASE 6 — WAVE 1 Access & Session / Permission Gate

- 기준 커밋: `9fb83a891287cfc94f098bc5d1b4cac22bbaffbe`
- 작업 브랜치: `codex/phase6-w1-access-session`
- 검증 환경: Dedicated Staging Vercel + Firebase `westory-staging-177587430482`
- 작성·최종 검증일: 2026-08-09 KST
- 최종 판정: **NOT READY — DEC-11 사용자 결정 필요**

## 1. 구현 결과

공통 보호 경로를 다음 순서로 정리했다.

`Firebase Auth → identity 확인 → user profile/role/capability 확인 → ProtectedAccessGate → MainLayout → Screen`

`ProtectedAccessGate`는 `UNKNOWN`, `AUTHENTICATING`, `AUTHORIZED`, `UNAUTHORIZED`, `SESSION_EXPIRED`, `ERROR` 상태를 구분한다. `AUTHORIZED`가 확정되기 전에는 `MainLayout`, Header, 공통 보호 controller, lazy screen을 React 트리에 넣지 않는다. 기존 `MainLayout`의 사후 `useEffect` redirect 권한 검사는 제거했다.

Authentication은 Firebase identity와 token 상태를, Authorization은 identity에 대응하는 `users/{uid}` profile, role, staff capability, route를 판단하도록 분리했다. 계정 전환이나 token 갱신 때 이전 사용자의 profile/config/menu state를 즉시 비우고, 새 UID의 profile snapshot이 확인되기 전에는 접근 상태를 다시 `AUTHENTICATING`으로 닫는다. user profile UID와 Auth UID가 다르면 권한을 인정하지 않는다.

권한 정책은 `src/lib/permissions.ts`에 모았다. 관리자 계정, 학교 이메일, teacher/staff capability, 교사 경로별 read 경계를 공통 함수로 사용한다. 학생·교사 canonical route와 기존 legacy alias는 유지했으며 IA와 메뉴 구조는 변경하지 않았다.

접근 상태 UI는 인증 확인 중, 접근 권한 없음, 세션 만료, 오류 화면만 최소 범위로 추가했다. Staging에서만 합성 email/password 로그인과 세션 만료 재현 control을 노출하며 Production에서는 렌더하지 않는다.

## 2. P0 #4 증명

`scripts/verify-access-gate.mjs`가 17개 학생 route, 13개 교사 route, 5개 차단 상태를 검사한다. 차단 상태의 sentinel child가 mount될 경우 실행하도록 만든 read, subscription, command, write counter는 모두 0이었다. `AUTHORIZED`일 때만 각 counter가 정확히 1이었다.

| Case | 결과 | 근거 |
| --- | --- | --- |
| Auth UNKNOWN child mount 0 | PASS | UNKNOWN/AUTHENTICATING sentinel mount·read·subscription·command·write 0 |
| Unauthorized protected query 0 | PASS | 교사 합성 계정의 `/teacher/settings` 직접 접근에서 Settings lazy chunk와 screen 미로드 |
| Unauthorized protected write 0 | PASS | 같은 차단 시나리오의 sentinel write 0, Settings child 미마운트 |
| Session 만료 후 UI/data 잔존 0 | PASS | Staging session-expiry control 실행 후 Header·Dashboard 제거, `SESSION_EXPIRED` 화면만 표시 |
| 직접 URL 우회 불가 | PASS | Anonymous·Student·Teacher의 금지 route 직접 hash 진입 차단 |
| 새로고침·뒤로 가기 우회 불가 | PASS | 교사 설정 거부 상태에서 refresh와 dashboard→back 재진입 모두 거부 유지 |

Auth 복원, 허용 이메일 확인, 자기 user profile snapshot은 권한 판정에 필요한 control-plane 요청으로 분류했다. 권한이 없는 route의 screen component와 그 component의 Firestore/Functions/Storage effect는 실행되지 않았다. 전체 Query/Command 분리는 W2 범위로 남겼다.

## 3. Staging 계정과 브라우저 QA

저장소 밖 DPAPI 암호화 파일의 합성 계정 10개를 사용했다. Auth 사용자 10/10이 활성 상태였고, Firestore profile 10/10의 UID·email·role이 Auth inventory와 일치했다. 실제 운영 계정은 사용하지 않았다.

| 주체 | 검증 | 결과 |
| --- | --- | --- |
| Anonymous | `/teacher/settings` 직접 진입 | 로그인으로 차단, 보호 chunk 미로드 |
| Student | Dashboard, Calendar, Quiz, History Classroom, Score, Wis | 허용 경로 6/6 진입 PASS |
| Student | `/teacher/dashboard` 직접 진입 | 접근 거부, 교사 UI 0 |
| Teacher | Dashboard, Student List, Quiz, Exam, Wis | 대표 경로 5/5 진입 PASS |
| Teacher | `/teacher/settings` 직접·refresh·back | 접근 거부, Settings screen 0 |
| Teacher | `point_read` 실시간 회수 | 열려 있던 Wis screen 즉시 제거·접근 거부 PASS, 이후 fixture 복원 |
| Admin | `/teacher/settings` | 관리자 설정 정상 진입 PASS |
| Permission Negative | 보호 경로 직접 진입 | 보호 UI 0, 만료/거부 상태로 fail-closed |
| Expired Session | teacher dashboard에서 강제 만료 | 보호 UI/data 제거, 재진입 전 재로그인 요구 |

합성 학생 fixture는 W0-R 생성 당시 `customNameConfirmed`, `privacyAgreed`가 없어 기존 온보딩에서 중단됐다. Production에는 손대지 않고 Staging 학생 profile 5건에 한해 확정 profile과 동의 상태를 보완했다. Staging permission revocation 검증은 teacher profile 1건을 임시 변경한 뒤 원래 값으로 복원했다.

브라우저 도구의 내부 출력에 Staging 교사 합성 비밀번호가 한 차례 노출될 가능성이 있어 해당 Auth 비밀번호 1건을 즉시 교체했다. 저장소 밖 DPAPI 파일을 같은 값으로 다시 암호화했고 새 비밀번호 재로그인까지 통과했다. 비밀번호 값은 보고서·Git·일반 로그에 기록하지 않았다.

## 4. 반응형 접근 상태

접근 거부 상태를 Chrome에서 390, 768, 1024, 1280, 1600px로 확인했다. 5개 폭 모두 제목·안내·안전한 이동 링크가 표시됐고 `documentElement.scrollWidth === innerWidth`로 가로 넘침 0을 확인했다.

## 5. 자동 검증

| 검증 | 결과 |
| --- | --- |
| `npm run verify:access-gate` | PASS — 학생 17, 교사 13, 차단 상태 5 |
| `npm run build` | PASS — 417 modules, 기존 large chunk warning만 유지 |
| `npm run verify:typescript-baseline` | PASS — 기존 14 files / 64 errors 그대로, 신규 오류 0 |
| `npm run format:check` | PASS |
| `npm --prefix functions run check` | PASS |
| `npm run security:check-supply-chain` | PASS |
| `npm run verify:firebase-environment` | PASS — 12 cases |
| `npm run verify:vercel-config` | PASS — 5 cases |
| `npm run verify:assessment-attempt-safety` | PASS |
| `npm run verify:teacher-nav` | PASS |
| score-warning / teacher-patch-notes Rules emulator | PASS |

Vercel remote build의 `npm audit`에는 기존 dependency 취약점 11건(critical 1, high 6, moderate 3, low 1)이 남아 있다. W1 변경으로 새로 생긴 항목은 아니며 공급망 IOC 검사는 통과했다. 의존성 정리는 별도 승인 범위가 필요하다.

## 6. 배포·운영 안전성

- Dedicated Staging deployment: `dpl_DzpGJSvE6mR9rvyCaVprX7X7J6Ve`
- Dedicated Staging immutable URL: `https://westory-staging-7u9rzuha9-bbbs-projects-44f9da30.vercel.app`
- Stable Staging alias: `https://westory-staging-westoria28-8028-bbbs-projects-44f9da30.vercel.app`
- Staging 상태: **READY**
- Production deployment: `dpl_7r2BkKz1STPv5j15xstj5GArai5V`, **READY**, 기준선과 동일
- Production 작업 브랜치 Preview: push 후 **Canceled가 EXPECTED/PASS**이며 차단 정책을 변경하지 않는다.
- GitHub Pages: 비활성 상태를 유지한다.
- Production Firestore, Storage, Auth, Functions mutation: **0**
- Production deployment·alias 변경: **0**

Staging side effect는 합성 학생 profile 보완 5건, 교사 합성 Auth 비밀번호 교체 1건, 권한 회수·복원 profile write 2건이다. W1 앱 검증과 관계없는 Production 데이터에는 접근하거나 쓰지 않았다.

## 7. 변경 범위와 rollback

보고서를 포함해 변경 파일은 15개다. 핵심 앱 변경 commit은 다음 세 개다.

- `86d7e76` — `fix: gate protected routes before effects`
- `58e8e5c` — `test: enable isolated staging account sign-in`
- `f3088eb` — `test: add staging session expiry control`

Rollback 단위는 W1 branch 전체다. Production 승격 전이므로 운영 rollback은 필요하지 않다. Staging에서는 stable alias를 직전 W0-R READY deployment로 되돌릴 수 있으며, W1 code commit을 제거해도 Production deployment·Rules·Functions·데이터는 변하지 않는다. 합성 profile과 교체된 합성 비밀번호는 테스트 안전 자산이므로 rollback 시 삭제하거나 이전 비밀번호로 복원하지 않는다.

## 8. 남은 blocker와 판정

P0 #4의 구조적 원인은 해결됐고 Dedicated Staging 검증도 통과했다. 다만 DEC-11은 PHASE 4 결정 문서상 아직 `USER DECISION REQUIRED`다. 기존 60분 단일 client timer는 이번 Wave에서 임의로 바꾸지 않았다. W1을 닫고 Production 승격 준비 상태로 판정하려면 다음 선택을 확정해야 한다.

- A: 모든 역할 30분 무활동
- B: 모든 역할 60분 무활동
- C(권고): 일반 학생·교사 30분, 고위험 관리자 설정 15분, 5분 전 경고, 평가·미저장 편집 복구 계약

따라서 현재 판정은 **NOT READY — DEC-11 사용자 결정 필요**다.

Production 승격, Maintenance 활성화, W2는 시작하지 않았다.

`NEXT WAVE STARTED: NO`
