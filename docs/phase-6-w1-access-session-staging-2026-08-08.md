# PHASE 6 — WAVE 1 Access & Session / Permission Gate

- W1 DEC-11 후보 커밋: `e4992f5a4d299c5d5e8d25b02bc592917f650004`
- 작업 브랜치: `codex/phase6-w1-access-session`
- 검증 환경: Dedicated Staging Vercel + Firebase `westory-staging-177587430482`
- 최종 검증일: 2026-08-09 KST
- 최종 판정: **NOT READY FOR W1 PRODUCTION PROMOTION**

Production 승격과 W2는 시작하지 않았다.

## 1. DEC-11 확정 정책

DEC-11은 2026-08-09 사용자 결정으로 Option C가 확정되었다.

| 대상 | 유휴 만료 | 경고 |
| --- | ---: | ---: |
| 학생·교사·Staff·관리자 일반 화면 | 30분 | 만료 5분 전 |
| 관리자 `/teacher/settings` 및 하위 경로 | 15분 | 만료 5분 전 |

클릭, 입력, 제출, 사용자가 직접 선택한 이동처럼 의미 있는 활동만 마지막 활동 시각을 갱신한다. timer, polling, subscription 갱신, 자동 redirect와 단순 route render는 활동으로 보지 않는다. 세션 만료 시 보호 화면과 데이터 연결을 즉시 제거하고, 같은 사용자가 재로그인하면 권한을 다시 확인한 뒤 원래 내부 경로와 query로 돌아가는 것을 목표 계약으로 삼는다.

평가 응답과 미저장 교사 편집은 세션 만료 때문에 자동 제출·취소·폐기하지 않는다. 평가의 실제 종료 시각은 session timer가 아니라 server attempt deadline을 따라야 하며, 고위험 command는 필요할 때 재인증해야 한다.

## 2. 이번 후보에 반영한 내용

### 2.1 세션 시간·경고

- `lastActivityAt`을 세션 시간의 기준으로 두고 `expiresAt`은 현재 경로 정책에서 계산한다.
- 일반 화면은 30분, 관리자 설정은 15분으로 계산한다.
- 일반 화면과 관리자 설정 사이의 route 변경은 활동 시각을 새로 만들지 않고 같은 `lastActivityAt`에서 deadline만 다시 계산한다.
- 기존 60분 expiry만 있는 세션은 `legacyExpiry - 60분`으로 마지막 활동 시각을 보수적으로 추론한다. 새 30분 세션을 임의로 부여하지 않는다.
- 만료 정확한 시각에는 활동 이벤트로 세션을 되살리지 않는다.
- 만료 5분 전 warning toast를 deadline별 한 번만 표시한다. toast는 모바일 메뉴를 열지 않아도 보인다.
- click, input, change, submit과 명시적 domain activity만 세션을 연장한다. scroll, mousemove, timer는 listener 대상이 아니다.
- 다른 탭의 local session 갱신은 `storage` event로 반영한다.

### 2.2 만료·재로그인 경계

- `ProtectedAccessGate`가 화면 mount 전에 현재 pathname과 관리자 여부로 세션 정책을 계산한다.
- direct URL, refresh, Back, 일반 화면에서 관리자 설정으로의 programmatic 이동도 gate에서 먼저 만료를 판정한다.
- 만료 시 UID, 내부 pathname, query, 저장 시각만 recovery locator로 남기고 session timing을 제거한다.
- return path는 `/student` 또는 `/teacher` 내부 경로만 허용하고 scheme, 외부 URL, hash 중첩과 과도하게 긴 값을 거부한다.
- return path는 2시간 안에 동일 UID가 로그인한 경우에만 한 번 소비한다. 다른 UID는 복구 정보를 사용할 수 없다.
- 교사 경로는 로그인 후 현재 capability로 다시 확인한다. 권한이 사라진 경로는 기본 허용 화면으로 이동한다.
- 수동 로그아웃, 계정 전환, 허용되지 않은 계정 거부 시 recovery locator와 session timing을 제거한다.

### 2.3 평가 화면의 무활동 우회 제거

- QuizRunner와 HistoryClassroomRunner가 60초마다 `emitSessionActivity`를 자동 실행하던 interval을 제거했다.
- 답안 선택, 페이지 이동, 명시적 평가 작업에서 발생하는 실제 사용자 activity는 유지했다.
- History Classroom은 화면 회전 grace가 아니더라도 동일 UID·assignment의 local saved attempt를 cooldown보다 먼저 확인한다. 저장된 답안·페이지·deadline이 있으면 재로그인 후 local resume 경로를 사용할 수 있다.
- 변경한 QuizRunner에 있던 `matchingAnswerMap` 타입 오류도 함께 제거했다.

## 3. 자동 검증

| 검증 | 결과 |
| --- | --- |
| `npm run verify:session-policy` | PASS — 30분·15분·5분, exact expiry/warning boundary, route clamp, legacy migration, 동일 UID return path |
| `npm run verify:access-gate` | PASS — 학생 17, 교사 13, 차단 상태 5, 차단 child counter 0 |
| `npm run verify:assessment-attempt-safety` | PASS — 자동 session heartbeat 0, History saved-attempt resume contract |
| `npm run build` | PASS — 417 modules, 기존 large chunk warning만 유지 |
| `npm run verify:typescript-baseline` | PASS — **63 errors / 13 files**, 종전 64/14에서 1건·1파일 감소 |
| `npm run format:check` | PASS |
| `npm --prefix functions run check` | PASS |
| GitHub Actions | PASS — run `31312359038`, commit `e4992f5` |

`verify:session-policy`와 `verify:assessment-attempt-safety`를 branch CI에 포함했다. 오류 수를 숨기거나 allowlist를 넓히지 않았고, 실제로 제거된 QuizRunner 오류를 반영해 TypeScript fingerprint를 줄였다.

## 4. Dedicated Staging 브라우저 검증

- Deployment: `dpl_EnCQhuiPcJWbt7wh3Uqw7iXfavJF`
- Immutable URL: `https://westory-staging-9vuq04n7z-bbbs-projects-44f9da30.vercel.app`
- Stable alias: `https://westory-staging-westoria28-8028-bbbs-projects-44f9da30.vercel.app`
- 상태: `READY`, target `preview`
- 검증 브라우저: 방재석 Chrome, synthetic teacher session

| Case | 결과 |
| --- | --- |
| 일반 교사 세션 명시적 연장 | PASS — `30:00`으로 재설정 |
| 만료 5분 전 경고 | PASS — `04:58~04:59`, 경고 toast와 연장 안내 표시 |
| 경고 반응형 | PASS — 390/768/1024/1280/1600px 모두 경고 표시, 가로 overflow 0 |
| 390px 경고 가시성 | PASS — 모바일 메뉴를 닫아도 화면 상단 경고 표시 |
| 강제 만료 후 보호 UI 제거 | PASS — Header 0, Dashboard heading 0, `SESSION_EXPIRED`와 재로그인 링크만 표시 |
| 만료 화면 390px | PASS — 가로 overflow 0 |
| 만료 후 2초 안정화 | PASS — 새 console error 0. 기존 Tailwind CDN 및 auth-domain warning만 확인 |

브라우저 검증은 Staging local/session 상태와 기존 synthetic fixture 범위에서만 수행했다. 세션 경고·만료 control 외에 별도 domain command는 실행하지 않았다. 다만 현재 Teacher Dashboard의 공휴일 동기화는 W2에서 제거할 기존 hidden mutation이므로, 이번 W1 브라우저 결과를 Staging Firestore write 0의 증거로 사용하지 않는다. Production 계정이나 운영 데이터로 로그인하지 않았고, 운영 write probe도 실행하지 않았다.

## 5. P0 Authorization Before Effects 상태

기존 W1 gate 결과는 유지된다.

`Firebase Auth → identity → user profile/role/capability → ProtectedAccessGate → MainLayout → Screen`

`AUTHORIZED` 전에는 `MainLayout`, Header, 공통 보호 controller, lazy screen을 React 트리에 넣지 않는다. `UNKNOWN`, `AUTHENTICATING`, `UNAUTHORIZED`, `SESSION_EXPIRED`, `ERROR` 상태의 sentinel child mount, protected read, subscription, command, write counter는 모두 0이다. 새 DEC-11 pathname별 만료 판정도 같은 gate 앞단에 들어갔다.

## 6. Production 무변경 확인

- Production deployment: `dpl_7r2BkKz1STPv5j15xstj5GArai5V`, `READY`, 기존 기준선과 동일
- Production alias: `www.westory.kr`, 변경 0
- Production Functions: 43/43 `ACTIVE`
- 이번 후보의 Firestore Rules, Storage Rules, Functions, Firebase config 변경: 0
- GitHub Pages API: 404, 비활성 상태 유지
- Production promotion, Maintenance 활성화, W2 시작: 0

새 Vercel 자원은 Dedicated Staging Preview 한 건뿐이다. Production project의 branch Preview 차단 정책과 운영 alias는 변경하지 않았다.

## 7. 남은 blocker

다음 항목은 DEC-11의 확정 문구를 만족한다는 운영 증거가 아직 없다.

1. **교사 미저장 편집 복구 없음**
   - 수업자료, 판서, 수행·정기시험 점수, 퀴즈 문항, 역사교실 제작, 지도·사료, 일정·설정 form의 draft는 대부분 React state에만 있다.
   - 세션 만료 시 안전한 draft 저장소, 동일 UID 복구, 민감 필드 보호와 파일/blob 복구 계약이 없다.

2. **평가 복구가 완전한 server contract가 아님**
   - Quiz는 deterministic `quiz_submissions`와 debounce 저장 자산이 있으나 마지막 입력 flush, in-flight 저장 충돌, 만료 직전 logout 경쟁을 end-to-end로 증명하지 못했다.
   - History Classroom은 이번 후보에서 local saved attempt 재진입을 허용했지만 server attempt ID와 server-authoritative deadline이 없다. `pagehide`·visibility cancel 경로도 별도 W6A 정리가 필요하다.

3. **재로그인 recovery 브라우저 증거 미완료**
   - 동일 UID return path와 capability 재검사는 자동 검증을 통과했다.
   - 실제 브라우저에서 `평가 답안 저장 → 만료 → 재로그인 → 동일 attempt/deadline/답안 hash`와 교사 draft 복구를 통과하지 못했다.

4. **고위험 관리자 재인증 미구현**
   - `/teacher/settings` 15분 정책과 5분 warning은 pure policy 검증을 통과했다.
   - 관리자 synthetic browser의 실제 15분 경고·만료와 민감 command 직전 recent-auth 재인증은 구현·증명되지 않았다.

5. **backend expired-session fence 미완료**
   - 현재 idle policy는 client session 경계다.
   - 이미 발급된 token을 가진 old bundle이나 직접 SDK/Function command를 서버가 같은 idle/re-auth 정책으로 거부하는 계약은 아직 없다.

## 8. 최종 판정과 rollback

시간 정책, 경고, 보호 UI 제거, 동일 UID return path, 자동 assessment heartbeat 제거는 Staging에서 개선되었다. 그러나 DEC-11이 명시한 평가·교사 편집 복구와 고위험 재인증을 운영 수준으로 닫지 못했다.

따라서 최종 판정은 **NOT READY FOR W1 PRODUCTION PROMOTION**이다.

Rollback 단위는 commit `e4992f5`와 Staging deployment `dpl_EnCQhuiPcJWbt7wh3Uqw7iXfavJF`다. 문제가 생기면 Staging stable alias를 직전 READY deployment `dpl_DzpGJSvE6mR9rvyCaVprX7X7J6Ve`로 되돌릴 수 있다. Production에는 승격하지 않았으므로 운영 rollback은 필요하지 않다.

Production 승격과 W2는 시작하지 않았다.

`NEXT WAVE STARTED: NO`
