# Phase 6 W2A Command Gateway Foundation 완료 보고

- 작성일: 2026-08-11
- W1 checkpoint branch: `codex/phase6-w1-frozen-checkpoint`
- W1 checkpoint full SHA: `26142027dfc66335f8f7dc66f8007042a3836391`
- W1 상태: `FROZEN — NOT PROMOTED, NOT BLOCKING FURTHER STAGING DEVELOPMENT`
- W2A branch: `codex/phase6-w2a-command-gateway-foundation`
- W2A 구현 checkpoint full SHA: `c96e628ca89a47e684c3176b10c6e6a5f4d3170e`
- GitHub CI 보완 checkpoint full SHA: `59952fb4085987097a9a18c460c8881293120d1e`
- Production 승격: 실행하지 않음
- 최종 판정: `READY FOR W2B STAGING DEVELOPMENT`

## 1. W1 동결 상태

W1의 protected mount 차단, 서버 권위 application session, recent-auth 검증, 직접 SDK 우회 차단 기반은 그대로 유지했습니다. `KI-W1-01 — Post-Reauthentication User Probe Permission Denied`는 해결된 것으로 처리하지 않았으며 Release Candidate 단계의 release blocker로 남겼습니다.

재인증과 application session 회전 뒤 `users/{uid}` probe가 간헐적으로 `permission-denied`가 되는 기존 결함을 W2A에서 다시 장시간 디버깅하지 않았습니다. Production idle enforcement도 계속 비활성입니다. 자세한 상태와 실패 증거는 다음 문서를 기준으로 합니다.

- `docs/phase-6-w1-frozen-handoff-2026-08-11.md`
- `docs/evidence/w1r5-credential-barrier/768-repeat/01/viewport-evidence.json`
- `docs/evidence/w1r5-credential-barrier/session-summary.json`

## 2. Command Gateway 방식

클라이언트는 `executeCommand({ commandId, commandType, payload, _session })`으로 명령을 보내고, 응답이 유실됐을 가능성이 있을 때만 `getCommandStatus({ commandId, commandType, _session })`으로 receipt를 조회합니다. business command를 자동 재실행하지는 않습니다. 결과를 확인할 수 없는 경우에는 같은 논리 명령에 같은 command ID를 보존해, 사용자가 다시 시도해도 서버 receipt가 중복 효과를 막습니다.

서버는 business logic보다 먼저 다음 순서로 검증합니다.

1. App Check, 허용 이메일, 인증 상태를 확인합니다.
2. `assertActiveApplicationSession(request, { recentAuth: true, highRisk: true })`로 application session, auth time, proof revision, 만료 상태를 확인합니다.
3. 관리자 이메일과 인증 UID가 server identity와 같은지 다시 확인합니다.
4. command type별 payload schema와 크기를 검증합니다.
5. UUID는 소문자, ULID는 대문자로 정규화한 뒤 actor UID, command type과 함께 receipt ID를 만듭니다.
6. 기존 receipt가 있으면 payload hash를 비교해 replay 또는 conflict로 처리합니다.
7. 신규 명령이면 business write, receipt, audit을 하나의 Firestore transaction으로 반영합니다.

receipt는 command ID/type, actor UID·이메일·역할·capability, target, SHA-256 payload hash, session metadata의 비밀값 해시, status, result, createdAt/completedAt, retryable, checkpoint를 기록합니다. audit에는 같은 actor·command·target·result를 독립 문서로 남깁니다. 두 collection은 Firestore Rules에서 클라이언트 read/write를 모두 거부합니다.

## 3. 실제 이전한 command

| command | 성격 | business 경로 | W2A 결과 |
| --- | --- | --- | --- |
| `updateTermsSettings` | 자연 멱등 | `site_settings/terms` | revision과 receipt·audit을 원자적으로 기록 |
| `addConsentItem` | 비멱등 | `site_settings/consent/items/{deterministicId}`, `site_settings/consent` | deterministic ID, server order, metadata counter, receipt·audit을 한 transaction으로 기록 |
| `syncKoreanPublicHolidays` | 명시적 동기화 | `years/{year}/semesters/{semester}/calendar/*` | 등록된 학기만 허용하고 기존 holiday만 교체하며 일반 일정은 보존 |

`addConsentItem`은 클라이언트가 `order`를 보낼 수 없고, 서버가 기존 최대 order와 `nextItemOrder`를 함께 읽어 다음 값을 정합니다. 서로 다른 command가 동시에 들어와도 transaction 재시도로 order가 겹치지 않습니다.

공휴일 command는 `site_settings/config`의 현재 학기 또는 `availableSemesters`에 등록되어 있고 `shellReady !== false`인 학기만 허용합니다. 비등록 경로 생성은 business write, receipt, audit 전에 거부합니다. 결정적 공휴일 ID가 일반 일정과 충돌하면 전체 transaction을 실패시킵니다.

## 4. Query Purity와 직접 SDK 차단

Teacher Dashboard와 학사 일정 화면의 mount 시 공휴일 자동 동기화를 제거했습니다. `koreanPublicHolidays.ts`에서는 Firestore와 localStorage 의존을 없애고, 공휴일 계산과 조회 결과 merge만 남겼습니다. 공휴일 쓰기는 학사 일정 화면의 관리자용 `공휴일 동기화` 버튼에서만 command gateway를 호출합니다.

Firestore Rules는 다음 경계를 적용합니다.

- `site_settings/terms` direct create/update/delete 거부
- `site_settings/consent` direct create/update/delete 거부
- consent item direct create 거부
- 아직 이전하지 않은 consent item update/delete 유지
- holiday direct create/update/delete 거부
- 일반 일정과 eventType이 없는 legacy 일정 CRUD 유지
- receipt와 audit의 client create/get/update/delete 거부

Dedicated Staging에서 일정 화면을 단순 방문하고 세 기준 viewport를 확인하는 동안 calendar 23건의 정규화 content hash는 `a585adb3ac2e07cbf187913d05e2a19db5429f804aa90999fb05c339311a7820`로 유지됐습니다. 가장 최근 calendar update time도 `2026-08-10T14:45:12.638883Z`로 변하지 않았습니다.

## 5. 자동 검증

| 검증 | 결과 |
| --- | --- |
| Functions Node 22 syntax·unit | PASS — 19 cases |
| W2A Rules emulator | PASS — 10 cases |
| W2A Auth·Firestore·Functions integration | PASS — 13 cases, Production access 0 |
| 동일 command ID 순차 replay | PASS — 추가 business effect 0 |
| UUID 대소문자 변형 replay | PASS — canonical receipt 1개 |
| 동일 ID·다른 payload conflict | PASS — write 0 |
| 동시 중복·서로 다른 app context | PASS — effect/receipt/audit 각 1회 |
| commit 뒤 응답 유실·재조회 | PASS — 기존 result 복구, 중복 0 |
| unauthorized·expired session | PASS — business 진입 전 write 0 |
| 비등록 공휴일 학기 | PASS — business/receipt/audit write 0 |
| Query Purity 정적 회귀 | PASS — mount write와 우회 callsite 없음 |
| W1 session authority 전체 emulator | PASS — Rules 19, Functions 26, Storage 10, end-to-end 14 cases |
| W1 score warning·teacher patch Rules | PASS |
| Firestore Rules access budget | PASS — teacher headroom 8, admin headroom 9 |
| `npm run build` | PASS — 424 modules |
| `npm run format:check` | PASS |
| TypeScript baseline | PASS — 63 errors / 13 files, 신규 오류 0 |
| Access gate | PASS — student 17, teacher 13, blocked 5 |
| Step-up reauthentication | PASS |
| Assessment attempt safety | PASS |
| Firebase environment isolation | PASS — 15 cases |
| Vercel config isolation | PASS — 5 cases |
| Supply-chain IOC | PASS |
| GitHub Safety Baseline | PASS — run `31451115984` |

GitHub Safety Baseline은 root 검증을 Node 24에서 수행한 뒤 Functions와 emulator 구간을 운영 runtime과 같은 Node 22, Temurin Java 21로 전환합니다. main push도 같은 Safety workflow를 실행하며, GitHub Pages 배포 workflow 안에서도 W2A aggregate를 통과해야 artifact를 업로드하도록 막았습니다.

## 6. Dedicated Staging

### Firebase

- Project: `westory-staging-177587430482`
- `executeCommand`: `ACTIVE`, Node.js 22, `asia-northeast3`
- `getCommandStatus`: `ACTIVE`, Node.js 22, `asia-northeast3`
- Firestore Rules release: `projects/westory-staging-177587430482/rulesets/4c0591c7-33a3-49d0-897c-c11567722158`
- 배포 Rules와 local `firestore.rules` 정규화 hash 일치

### Vercel Preview

- Project: `westory-staging`
- Deployment: `dpl_58R2jqU3sJVhQUEveXq8e4T6BU9W`
- Target: Preview
- Status: `READY`
- URL: `https://westory-staging-i5mf58zfl-bbbs-projects-44f9da30.vercel.app`

### 실제 브라우저·command 확인

- 390×844: 학사 일정·약관·동의 관리 가로 overflow 0
- 1024×768: 학사 일정·약관·동의 관리 가로 overflow 0
- 1600×900: 학사 일정·약관·동의 관리 가로 overflow 0
- 관리자 약관 저장: business/receipt/audit 각 1회
- 관리자 동의 항목 추가: item/metadata/receipt/audit 각 1회
- 공휴일 명시 command: emulator replay·일반 일정 보존 PASS, Staging 화면에서는 버튼 노출과 passive write 0을 확인

브라우저 검증용 임시 약관·동의 item·metadata는 원래의 미존재 상태로 복원했습니다. 검증 receipt와 audit 2건은 서버 감사 이력으로 남겼습니다. 임시 App Check debug token, application session 2건, reauth transition, Vercel automation bypass, 브라우저 세션은 모두 회수했고 잔여 값은 0입니다.

Functions 배포 자체는 성공했지만 Artifact Registry cleanup policy가 아직 없습니다. 자동 `--force`로 정책을 만들 권한까지 이번 Wave에 포함하지 않았으므로 비용 관리 항목으로 후속 등록합니다.

## 7. Production 변경 0

Production에는 deploy, promotion, Rules·Functions·Auth·Firestore·Storage write를 실행하지 않았습니다. 종료 전 읽기 전용 대조 결과는 다음과 같습니다.

- Production Vercel: `dpl_7r2BkKz1STPv5j15xstj5GArai5V`, target `production`, `READY`
- Production aliases: `www.westory.kr`, `westory.kr` 포함 기존 alias 유지
- Production Functions: 43개, 모두 기존 inventory이며 W2A 함수 0개
- Production Firestore Rules: `projects/history-quiz-yongsin/rulesets/36de907e-9fbf-41eb-b084-95a1419bf097`
- Production Rules update time: `2026-07-05T09:17:23.334800Z`
- Production idle enforcement: 비활성 유지

## 8. 범위 분류와 후속 이관

### CURRENT-WAVE BLOCKER

없음.

### SAME-DOMAIN FOLLOW-UP

- `w2-high-risk-command-idempotency-handoff.md`에 남은 고위험 명령을 W2B 이후 vertical slice로 순차 이전
- consent item update/delete와 privacy·school/interface 설정의 command 전환
- receipt 조회·운영 감사 화면은 별도 최소 권한 설계 후 추가
- Artifact Registry Functions image cleanup policy 결정
- `firebase-functions` 패키지와 Firebase CLI deprecation 경고 정리

### LATER-WAVE

- 평가 attempt·revision·exactly-once submit 재구축은 W6A에 유지
- 전체 5개 viewport 전수 검증은 Global UI Wave와 Release Candidate QA에서 수행

### RELEASE BLOCKER

- `KI-W1-01 — Post-Reauthentication User Probe Permission Denied`

## 9. Rollback 기준

Git rollback 기준은 W1 frozen checkpoint `26142027dfc66335f8f7dc66f8007042a3836391`입니다. 문제가 생기면 W2A branch commit을 revert하고, Dedicated Staging에 해당 checkpoint의 `firestore.rules`와 Functions source를 다시 배포합니다. Vercel은 W1-R4 Preview `dpl_7z4PRhHSvpwivVy2sgWk9PyxWzVq`를 기준으로 되돌릴 수 있습니다.

`executeCommand`와 `getCommandStatus` 삭제가 필요한 rollback은 Staging의 외부 자원 삭제이므로 별도 확인 후 수행합니다. Production에는 W2A를 올리지 않았으므로 Production data rollback은 필요하지 않습니다.

## 10. 완료 판정

- [x] W1 checkpoint 안전하게 보존
- [x] KI-W1-01 release blocker 유지
- [x] W1 Production 승격 없음
- [x] Query/Command 공통 경계 구현
- [x] 서버 idempotency receipt·audit 구현
- [x] 동일 command ID 중복 효과 0
- [x] 응답 유실 후 안전한 결과 복구
- [x] 교차 app context 동시 중복 효과 0
- [x] 자연 멱등 command 이전
- [x] 비멱등 command 이전
- [x] Dashboard/Schedule 조회 mutation 0
- [x] 권한·session 검증 뒤 command 실행
- [x] migrated command 직접 SDK 우회 차단
- [x] Dedicated Staging PASS
- [x] GitHub Safety Baseline PASS
- [x] Production 변경 0
- [x] 신규 TypeScript 오류 0
- [x] rollback 기준 확보

최종 상태는 `READY FOR W2B STAGING DEVELOPMENT`입니다. W2B를 자동으로 시작하지 않고 여기서 중단합니다.
