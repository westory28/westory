# 로그인 함수 소스 동기화 — 2026-10-07

## 원인

회사 PC에서 확인한 `7b1107a8`에는 운영 `openApplicationSession` 소스가 없었다. `76cb10f`에서 성적 권한 검사에 필요한 운영 모듈 3개를 복원했지만, `functions/index.js`에서 로그인 callable을 export하지는 않았다. 따라서 소스 파일 문법 검사만 통과해도 Firebase 배포 진입점에서는 로그인 함수가 발견되지 않았다.

작업 시작 기준은 `6b7f7acb7329124654f0c0e5b5410c27cf659406`이며 운영 Vercel `dpl_4evVKbY4YzvuKx9nRWrs2MUKBECi`도 같은 커밋이었다. 다른 작업과 충돌하지 않도록 별도 worktree에서 진행했고, 배포 전 최신 main `da5fe63`을 반영했다.

## 운영 소스 대조

`history-quiz-yongsin`, `asia-northeast3`의 각 함수에서 `buildConfig.source.storageSource`의 generation까지 고정해 원본 ZIP을 내려받았다. ZIP은 로컬 임시 폴더에만 보관했다.

| 함수 | 기존 배포일(UTC) | 원본 generation |
| --- | --- | --- |
| openApplicationSession | 2026-09-17 14:12:55 | 1789654312441736 |
| touchApplicationSession | 2026-09-17 14:12:58 | 1789654371192054 |
| beginApplicationSessionReauthentication | 2026-09-12 08:45:55 | 1789202730766364 |
| closeApplicationSession | 2026-09-12 08:45:51 | 1789202730658399 |

`open`과 `touch`의 아래 모듈은 현재 Git 소스와 LF 줄바꿈 정규화 후 완전히 일치한다. 구현은 수정하지 않았다.

| 파일 | LF 정규화 SHA-256 |
| --- | --- |
| sessionAuthority.js | dfe91819e12dd9318d13f6b67108f75c55d05c7ddf486ebaa5353ca926df4844 |
| studentMaintenance.js | a688a12e0ab463c5f8422135a1c9dc0af7301564a486b0e3f8c728a150ea4125 |
| studentRegistrationAccess.js | d3ff1e17e1016204cc6d47ffa754aef55abeabbd7876dcec6a7bb889210114ac |

`begin`과 `close`의 이전 원본에는 세션 만료 상수가 일반 30분/고위험 15분이고, 점검 설정 저장 시 `_session`을 제거하지 않는 차이가 있었다. 현재는 이미 운영 `open`/`touch`가 쓰는 60분 상수로 통일돼 있다. `begin`/`close`는 해당 만료 상수와 점검 설정 저장 핸들러를 사용하지 않으므로 두 함수의 동작은 달라지지 않는다.

네 함수 모두 Node 22, 256 MiB, 제한 시간 60초이며 세션 모드/App Check 모드의 별도 환경 변수는 없었다. 프로토콜 2, authority generation `w1r2-2026-08-09`, 세션 revision, 인증 시각, 학교 계정 제한, 점검·등록 경계를 유지한다. 학생·교사 공통 로그인은 `application_sessions/{uid}/sessions/{authTime}`을 사용하며 학기별 데이터나 legacy fallback은 바꾸지 않는다.

## 변경

- `initializeApp()` 뒤에 기존 `sessionAuthority.callableExports`를 연결한다.
- 실제 `index.js`를 로드해 로그인 함수 4개, 동일 구현, callable 유형과 서울 리전을 검증한다. 문법 검사만으로 놓친 export 누락을 탐지한다.
- Firebase Functions predeploy에서 같은 검사를 실행한다.
- 운영 원본의 세션·학생 등록 승인 테스트를 복원한다. 세션 테스트는 실행 전 loopback Firestore와 `demo-westory-session-*` 프로젝트를 강제하고 실제 Firestore 앱을 해당 시험 환경에 고정한다.
- 회사/집 PC의 pull·런타임·의존성·검증·선택 배포 절차를 운영 문서에 기록한다.

로그인 기능 연결만 복구하며 다른 운영 Functions의 전체 소스 복구를 뜻하지 않는다. 전체 Functions/rules 배포는 수행하지 않는다.

## 검증

- `npm run verify:login-functions`: 실제 export 4개 및 학생 등록 승인 경계 19개 통과.
- `npm run test:login-session`: demo Firestore에서 세션 생성·재개·연장·종료·재인증, 학교 계정 제한, 잘못된 proof/프로토콜, App Check/만료 모드, 고위험 권한 등 32개 항목 통과. 운영 DB 접근 없음.
- export 연결을 메모리에서 제거하면 검사 실패 확인. 시험 환경 미설정·외부 호스트·잘못된 포트·운영 프로젝트 등 잘못된 실행 조건 7가지 차단 확인.
- `verify-application-session-startup.mjs`: 78개 회귀 검사 통과.
- `verify-login-acquisition.mjs`: 80개 회귀 검사 통과.
- `verify-auth-route-gates.mjs`: 통과.
- `npm run build`: 통과. 학기 아카이브, NEIS hair 테두리, 수행평가 가져오기 검증 포함. 기존 번들 크기 경고만 존재.
- 별도 읽기 전용 코드 검토: 수정이 필요한 지적 없음.

## 운영 확인

- 2026-10-07 22:01:59~22:02:01 KST에 로그인 함수 4개만 선택 배포 완료. `firebase functions:list`와 Cloud Functions에서 모두 `ACTIVE`, Node 22, 서울 리전 확인. 배포 전후 전체 함수 갱신 시각을 비교해 이 4개만 바뀐 것을 확인했다.
- 배포 후 네 함수의 원본 ZIP을 각각 다시 내려받아 `index.js`, 세션 관련 모듈 3개, `package.json`, `package-lock.json`이 로컬 검증 소스와 모두 같은지 확인했다. 운영 revision은 `openapplicationsession-00004-bog`, `touchapplicationsession-00004-wid`, `beginapplicationsessionreauthentication-00002-hum`, `closeapplicationsession-00002-reh`다.
- 운영 함수 4개에 인증 없는 callable 요청을 보내 모두 HTTP 401 / `UNAUTHENTICATED` / `SESSION_AUTH_REQUIRED` 응답을 확인했다. 업무 데이터 쓰기는 없다.
- `https://www.westory.kr`을 새로 로드해 기존 교사 계정과 학생 시험 계정이 서버 세션 확인 후 각 대시보드에 정상 진입하는 것을 확인했다. 새 Google 계정 선택·최초 가입은 이번 운영 브라우저 확인에 포함하지 않았다.
- 프런트엔드 소스와 Firebase rules는 이번 패치에서 변경하지 않았다. 회사 PC에는 원격 main을 pull하고 운영 절차에 따라 검증하면 같은 로그인 함수 소스와 배포 계약이 반영된다. 이 작업에서 회사 PC를 원격 조작하지는 않았다.
