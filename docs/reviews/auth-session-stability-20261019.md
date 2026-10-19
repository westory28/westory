# 로그인 유지 및 권한 검증 안정화 (2026-10-19)

기준 커밋: `47c4967806fdfaf55c8a93e686fbbd196fc49751`. 작업 전 운영 Vercel 배포 `dpl_5JuJvRyYFVYL762gDtjW9cYXq4ww`가 같은 커밋의 성공 상태인 것을 GitHub commit status와 운영 도메인 조회로 대조했다. 기존 교사 로그인 복원도 운영 브라우저에서 확인했다.

## 확인된 원인과 변경

- Header의 별도 1시간 타이머가 정상 Firebase 로그인까지 종료했다. 계정과 인증 시각별 **마지막 활동 후 30일** 정책으로 바꿨다. 기존 전역 `sessionExpiry`는 한 번 이행하며, 새 정책의 만료값을 재접속만으로 되살리지 않는다. 명시 로그아웃은 기기 기록과 메모리 proof를 지운다.
- 오래 열린 탭이 다른 탭의 활동을 반영하지 않았다. 공유 저장소, `storage`, `pageshow`, `visibilitychange`를 확인하고, 만료 직전 최신 인증 시각과 공유 만료값을 다시 확인한다. 숨겨진 탭은 강제 로그아웃을 실행하지 않는다.
- 텍스트 입력과 판서를 활동으로 인식하며 활동 저장은 30초, 정기 확인은 60초로 제한했다. 1초마다 전체 Header를 갱신하던 동작을 없앴다. 기존 UI에서 남은 기간만 일·시간·분으로 표시한다.
- 모바일 저장소 fallback에서 탭 전용 저장소를 IndexedDB보다 먼저 선택했다. 지속 가능한 두 저장소를 먼저 시도한다. 기본 모바일 localStorage 경로에 대기는 추가하지 않는다. Firebase의 [영속성 계약](https://firebase.google.com/docs/auth/web/auth-state-persistence)에 따라 저장소 차단·시크릿 환경까지 장기 유지를 보장하지는 않는다.
- 문항 저장 `upsertQuizQuestion`이 프런트 일반 작업 목록에서 누락돼 4분 후 재인증을 요구했다. 이미 운영 서버가 사용하는 일반 작업 정책과 맞췄다. 영구 삭제·관리자 작업의 재인증은 유지한다.
- 같은 User의 재인증 시 인증 시각 변경이 전체 편집 화면을 unmount했다. 이전에 서버 확인을 마친 동일 계정의 화면과 설정을 새 검증 동안 유지한다. 새 계정·권한 변경·세션 오류·15초 제한 초과는 접근을 차단하며 이전 비동기 작업의 generation 경계를 유지한다.
- 수업자료·지도·학생 정보·일정·공지 이미지·사전 및 사전을 통해 호출하는 평가/게임 등이 각 작업 전 반복하던 `openApplicationSession`을 공통화했다. 시작 단계의 검증된 proof를 메모리에 공유하고 동시 요청을 합친다. 최초 진입과 명시적 재시도는 서버 확인을 계속 수행한다.
- proof는 정확한 User 객체와 `auth_time`에 묶는다. 로그아웃, 재인증, 오래된 응답 경합을 구분한다. App Check·일반 권한·네트워크 오류를 세션 폐쇄로 취급하지 않는다. 성공한 쓰기의 응답을 새 인증 상태에서 수락할 수 없으면 요청 ID를 보존하며 새 자동 재전송을 추가하지 않는다.

## 유지되는 서버 경계

클라이언트의 30일은 기기의 비활동 정책이다. Firebase 인증 철회, 계정 변경, 명시 로그아웃, 서버 세션 폐쇄, 학교·학급·학기·역할 검증은 별도로 적용된다. 서버는 각 명령에서 실제 세션 status/auth_time/protocol/revision 및 권한을 확인한다. proof 캐시는 권한 승인 캐시가 아니며 브라우저 영속 저장소에 저장하지 않는다.

운영 `sessionAuthority.js`의 idle 설정은 OBSERVE_ONLY/DISABLED이고, 1시간 timestamp는 프런트 강제 로그아웃 근거로 쓰지 않는다. Functions, Firestore/Storage rules, 공개 설정, 학생 승인 상태는 변경하지 않았다.

## 검증

- `verify-application-session-startup.mjs`: 94건. 동일 계정 갱신의 화면·설정 유지, 계정 전환, 권한 철회, 오류/시간 초과, 오래된 결과 차단 포함.
- `verify-application-session-reuse.mjs`: 20건. 실제 6개 어댑터의 시작 proof 공유, 동시 8개 작업의 단일 handshake, 새 epoch 경합, 서버 거부, 쓰기 영수증 보존 포함.
- `verify-device-session.mjs`: 30일 경계, 재접속/복귀, 다른 탭의 활동, 입력/판서, 계정/epoch 변경, 저장소 차단, 늦은 토큰 응답 검증.
- `verify-auth-persistence.mjs`: 지속 저장소 및 차단 시 fallback 6건.
- 로그인 획득 86건, redirect 복구 21건, 민감 작업 18건, 라우트 가드 검증 통과.
- 수업자료 23건, 일정 17건, 학생 정보, 사전, 평가, 순위, 학기 준비도, 실제 Firebase SDK의 로컬 loopback 계약 검증 통과.
- 실제 React 브라우저의 로그인/복구/온보딩 UI 105개 검사 통과. 공개 화면의 지도 로딩 상태와 로그인 로딩 상태를 구분하도록 기존 fixture를 보완했다.
- 실제 Header 학생·교사 320/390/768/1280/1366/1440px 검증 통과. 기존 토큰과 구조 유지, 새 토큰 없음. 모바일 메뉴의 30일 표시와 가로 넘침도 확인했다.
- 변경 TypeScript Prettier 및 `git diff --check` 통과.
- `npm run build` 통과. 타입 검사, 최종 XLSX 점선 테두리 회귀, 학습지·사전·지도 검증을 포함한다. 로컬에 빠진 기존 의존성은 변경하지 않은 package-lock으로 `npm ci --ignore-scripts`하여 맞췄다. package.json/package-lock 변경 없음.

초기 진입의 통제 실험은 `LOGIN_BENCHMARK_BASELINE=47c4967806fdfaf55c8a93e686fbbd196fc49751 node scripts/verify-login-bootstrap-performance.mjs`로 비교했다. 세 시나리오의 첫 경로 준비는 각각 800→800ms, 1200→1200ms, 1000→1000ms이고 서버 세션 호출은 모두 1→1회다. 모의 전송/시간 조건의 회귀 검사이며 실제 모바일 로그인 시간 측정치는 아니다.

브라우저 증거는 작업 공간의 인접 `evidence/auth-startup-browser`와 `%TEMP%/westory-device-session-20261019`에 남겼다. 실제 iOS/Android 기기의 장기 방치와 30일 경과는 시간 제어 테스트로 대신했으며 실기기 관찰을 완료한 것으로 보고하지 않는다.

## 배포 후 확인

기존에 열린 탭은 이전 1시간 타이머를 계속 실행할 수 있으므로 저장할 내용을 저장한 뒤 각 Westory 탭을 한 번 새로고침해야 한다. 운영 배포와 실제 인증 상태의 화면 확인 결과는 최종 작업 보고에 기록한다.
