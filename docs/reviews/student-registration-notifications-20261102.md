# 가입 신청 알림과 승인·거부 연동 (2026-11-02)

## 원인과 수정 범위

- 가입 신청은 `users/{uid}.registrationApprovalStatus=PENDING`으로 저장됐지만 개인 알림을 만드는 서버 처리가 없었다. 학생 명단의 기존 canonical 승인은 `APPROVE → PREPARE_ACCOUNT → FINALIZE`뿐이며 거부 명령은 없었다.
- `notifyStudentRegistrationOnUserWrite`는 현재 활성 학기 포인터와 manifest를 transaction에서 확인하고 학교 교사·관리자의 개인 알림함에 신청 알림과 미읽음 수를 함께 기록한다. 학생·staff·전체 학생 공지로 전송하지 않는다. 운영 필수 승인 요청이므로 선택적 공지 알림 설정과 분리한다.
- 현재 신청 원본을 다시 읽으며 중복 이벤트·동시 실행은 결정적 알림 ID와 서버 전용 영수증으로 처리한다. 사용자가 지운 알림은 재생성하지 않는다. 최종 승인·거부 후 해당 알림의 문구와 미읽음 상태를 정리한다. 승인 중 계좌 준비가 남은 상태는 검토 대상으로 유지한다.
- 알림 클릭은 `/teacher/students?registration=<uid>`로 이동해 명단을 새로 읽고 해당 학생의 검토 창을 연다. 처리 완료·삭제된 신청과 읽기 전용 교사를 구분한다. 기존 필터·표·모달 구조와 모바일 동작을 유지한다.
- `approveStudentRegistration`의 `REJECT`는 교사/관리자, 유효한 세션·재인증, 현재 학기와 신청 버전, PENDING 상태를 검사한다. 기존 학적·계좌가 있으면 거부로 덮어쓰지 않는다. 거부 기록과 명령 영수증을 남기며 학적·위스 계좌·잔액·학생 Auth 계정을 삭제하지 않는다. 응답 유실 시 같은 명령 영수증으로 복구한다.
- REJECTED는 기존 가입 승인 접근 차단을 유지한다. 학생 로그인 화면에는 거부 상태를 표시한다. 승인 절차·라우팅 권한·Firestore/Storage rules는 변경하지 않는다.

## 운영 기준 대조

- 작업 시작 HEAD와 origin/main, 운영 Vercel 원본은 `527174ad8fd77f6270d83bb84c0922c01f88573f`로 일치했다. 기존 미추적 `output/`은 커밋 대상에서 제외한다.
- 운영 `executeCommand`의 보관 소스 56개를 기준 HEAD와 비교했다. 승인 adapter·gateway·productionSource를 포함한 55개는 일치했다. 유일한 차이는 후속 아바타 패치의 `wisEconomyQuery.js` 순위 표시이며 이번 명령 실행 경로의 변경이 아니다. 해당 조회 함수는 재배포하지 않는다.
- 별도 운영 `getStudentRegistrationApprovalState`의 승인 adapter와 `manageNotificationInbox`의 inbox·session 소스도 일치했다. 오래된 query 전체 closure를 교체하지 않는다.
- 배포 대상은 `executeCommand`(서울)와 신규 `notifyStudentRegistrationOnUserWrite`(미국) 두 함수다. 기존 다른 함수나 리전, rules를 일괄 배포하지 않는다. 프론트엔드는 검증한 main 배포를 Vercel 운영 도메인에 승격한다.
- 기존 대기 알림 복구는 `backfill-student-registration-notifications.cjs --project=history-quiz-yongsin --semester=2026-2`의 dry-run을 확인한 뒤 `--apply`한다. 활성 학기 일치, 신청 100개·수신 교사 100명 상한을 검사하며 개인정보·자격 증명은 출력하지 않는다. 신청 승인·거부는 이 도구가 수행하지 않는다.
- 운영 집계 확인: PENDING 2건, REJECTED 3건이다. 기존 화면은 거부 건도 대기로 세어 5건을 표시했다. 이번 필터는 두 상태를 분리한다. 알림 복구 dry-run은 대상 2건·누락 알림 2건·쓰지 않음을 확인했다.

## 검증

- 서버 알림 단위 검사: 수신 권한, 개인 알림 경로, 미읽음 수, 학기 변경, 중복·역순 이벤트, 알림 삭제 보존, 최종 처리, 수신 권한 변경을 검사한다.
- canonical 검토 검사: 승인/거부 경합, 변경된 프로필·학기·학적, 학생·staff·자기 승인 차단, 응답 유실과 영수증 재사용, 기존 승인 단계 보존을 검사한다.
- Firestore 통합 검사는 demo 프로젝트와 로컬 emulator만 허용한다. 실제 transaction·실시간 구독으로 신청부터 3단계 승인 또는 거부까지 검증한다.
- 프론트 검사: 닫힌 알림 센터의 즉시 알림, 클릭 경로, 명단 재조회, 신청자 모달, 거부 확인, 재시도, 처리 완료 링크, 읽기 전용 모드, 390/768/1280px 및 기존 320px 명단을 확인한다.
- `npm run build`, `npm --prefix functions run check`, `npm run format:check`, `git diff --check` 통과. 빌드에는 최종 XLSX `hair` 테두리 회귀 검사가 포함된다. 기존 Vite 대용량 chunk 및 정적/동적 import 혼용 경고는 남아 있으며 이번 변경 범위 밖이다.
- 기존 `verify-student-registration.mjs`, 신규 `verify-student-registration-client.mjs`, `verify-registration-recovery.mjs`, `verify-notification-bell-refresh.mjs`, `verify-student-roster-browser.mjs`를 통과했다. 명단의 동시 재조회가 이전 응답을 덮어쓰거나 로딩을 남기지 않도록 검사·보완했다.
- `verify-registration-notification-integration.cjs` 통과: 실제 Firestore rules를 통한 합성 학생 가입과 관리자 client `onSnapshot`, 교사 자기 알림함 읽기, staff/학생의 타인 알림 읽기 및 위조 쓰기 거부, 승인 3단계 후 접근 허용·거부 후 차단까지 확인했다. 테스트는 demo emulator에서 수행했다.

## 영향 판단

기존 학교의 가입 신청·교사 검토 운영을 복구하는 유지보수다. 새 개인정보 항목·외부 서비스·학생 공개 범위 확대·AI 호출·에이전트 실행·외부 AI 전송은 없다. 기존 승인 대기와 서버 역할 검사를 유지한다. 기관 보안성 검토 이력이 미확인이라는 기존 상태를 승인·면제로 바꾸지 않는다. 실제 학생을 시험용으로 승인하거나 거부하지 않는다.

## 후속 수정: 가입 검토의 재인증 대기와 승인 체크

- 기준 커밋 `1332452d` 운영 화면에서 가입 신청 창은 native modal이지만 재인증 확인 창은 일반 div여서 뒤에 가려지고 입력도 차단됐다. 재인증 Promise가 사용자 응답을 기다리면서 가입 신청 화면은 `저장 중…`을 유지했다.
- 운영 로그의 재인증 준비 요청 3건은 모두 HTTP 200(약 0.7~1.4초)이었으며 이후 가입 상태 조회·명령 실행 요청은 없었다. 서버 저장 지연이나 REJECT 계약 불일치가 아니다.
- 공통 `AppDialogProvider`를 native modal로 열어 기존 modal 위에서 확인·재인증을 조작할 수 있게 했다. 기존 카드 크기·색상·여백, 키보드 초점 이동과 취소 동작을 유지한다. 필요한 보안 재인증이므로 가입 검토 위에 확인 창을 올리는 예외를 적용한다. 학생·교사 공통 확인/입력에 영향을 주며 권한·재인증 조건·서버 명령은 변경하지 않는다.
- 가입 승인 버튼은 학급·번호·이름 확인 체크 후에만 활성화된다. 제출 시 재검증과 저장 중 잠금은 유지하며 학생 생성·학적 변경·가입 거부 조건은 변경하지 않는다.
- 이번 후속 수정은 프론트엔드만 배포한다. 새 AI 호출·외부 전송·개인정보 항목·학생 공개·승인 권한 확대는 없다.
- `verify-student-roster-browser.mjs`를 확장해 실제 공통 확인 창·재인증 controller를 연결했다. 390/768/1280px에서 승인 체크 전후, 재인증 창의 실제 클릭 가능 여부, 승인·거부 각각의 취소/팝업 실패 후 잠금 해제·서버 호출 없음, 재시도 성공을 검증했다. 일반 confirm/prompt의 Tab·Shift+Tab·Enter·Escape·필수 입력·초점 복원도 통과했다. 팝업 결과와 학생 자료만 합성 fixture를 사용한다.
- 학생 주문 취소 확인, 교사 점수 prompt/처리 메모와 중첩 학기 확인, 일정 삭제 확인의 실제 공통 provider 경로를 검증했다. 페이지 오류는 없었다. 추가 실행한 전체 점수표 검사는 768px 표 폭 검사에서 실패했으나 수정 전 `1332452d`와 현재 코드가 동일 수치(client 751px/table 815.40625px)로 재현되어 기존 별도 문제로 기록한다. 해당 표는 변경하지 않았다.
- `verify-sensitive-operation.mjs` 18건, 가입 명령 client 영수증·재시도 검사, 로그인 회복 상태 검사, 포맷 검사를 통과했다. 재인증 정책·사용자 직접 클릭에 의한 Google 팝업·서버 역할/학기 검증은 유지된다.
- 후속 수정의 `npm run build`와 `git diff --check`도 통과했다. 기존 chunk 크기 및 정적/동적 import 혼용 경고는 유지된다. 운영 반영은 검증한 main 커밋의 Vercel 배포를 승격한 뒤 실제 도메인과 체크박스 동작을 확인한다.
