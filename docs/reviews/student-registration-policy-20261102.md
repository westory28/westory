# 학생 신규 가입 기준 (2026-11-02)

기준 소스는 `518b91063dcd50ff18270bac7e136ffd8bfb5b9d`다. 학교 계정이 매년 발급되므로 `263`을 코드 전역에 고정하지 않고 교사가 신규 가입 대상 학년도·학년을 지정한다. 최초 문서가 없을 때의 기준은 2026학년도 3학년(`263NNNN@yongshin-ms.ms.kr`)이며, 2027학년도 2학년을 저장하면 `272NNNN@yongshin-ms.ms.kr`이 된다. N은 ASCII 숫자 네 자리다.

## 정책과 데이터 경계

- 단일 원본은 `site_settings/student_registration_policy`다. 계정의 발급 학년도·학년은 수업 학기와 다른 개념이므로 `years/{year}/semesters/{semester}`에 중복 저장하거나 학기 전환 시 자동 갱신하지 않는다. 기존 canonical 승인·학적·계좌의 현재 학기 검사는 그대로 유지한다.
- 문서는 `schemaVersion`, `admissionYear`, `admissionGrade`, `revision`, `updatedAt`, `updatedBy`만 기록한다. 최초 저장 revision은 1이며, 잘못된 문서는 기본값으로 우회하지 않는다. 문서 미생성 상태만 명시된 초기 기준을 사용한다.
- 학생 자기 프로필 생성은 인증 토큰 이메일과 정책을 Firestore rules에서 검사한다. 클라이언트의 이메일 입력·역할 캐시·오래된 설정으로 우회할 수 없다.
- 신규 및 승인 대기 계정은 세션 시작·복귀·연장·재인증과 교사 승인 3단계에서 현재 기준을 다시 검사한다. 승인 adapter는 정책을 해당 명령의 transaction 안에서 읽는다. 기존 부적격 신청의 거부는 계속 가능하다.
- 이미 승인된 학생과 승인 메타데이터가 없는 기존 학생은 가입 기준이 바뀌어도 이용한다. 교사·staff·관리자 역할과 기존 도메인 제한은 유지한다. 계정·학적·계좌·보상·기록은 일괄 변경하거나 삭제하지 않는다.
- 이미 발급된 대기 계정 세션을 일괄 폐기하지 않는다. 해당 계정의 업무 callable·Firestore/Storage 비공개 자료 접근은 기존 등록 승인 차단을 계속 적용하며, 새 가입·승인·세션 갱신은 새 정책으로 차단한다. 모든 callable을 재배포하지 않는다.

## API와 동시성

`getStudentRegistrationPolicy`는 허용된 학교/관리자 인증 계정이 애플리케이션 세션 생성 전에도 읽을 수 있는 공개 가입 조건만 반환한다. `saveStudentRegistrationPolicy`는 유효한 최근 재인증 세션을 가진 교사·관리자만 사용할 수 있다. staff·학생은 저장할 수 없으며, Firestore 직접 쓰기는 관리자도 거부한다.

저장은 `expectedRevision`으로 충돌을 검사한다. 응답이 유실되었을 때 같은 교사가 같은 값과 직전 revision을 재전송한 경우에만 성공을 재반환한다. 다른 사용자·값·두 단계 이상 지난 revision은 충돌로 처리한다. 정책 변경은 학생 원본을 수정하지 않는다.

로그인 화면은 서버 가입 거부 사유에 포함된 현재 형식으로 안내한다. 유효한 신규 계정의 온보딩 시작 전에 getter를 한 번 더 확인하며, 실제 프로필 생성과 승인은 서버에서 다시 검사한다. 프런트엔드에는 실패 시 허용하는 정책 fallback이 없다.

## 검증

- `node --test functions/scripts/verify-student-registration-policy.cjs functions/productionGateway/scripts/verify-student-registration-review.cjs`: 정확한 이메일 형식, 24/25 계정·길이·위조 거부, 차년도 정책, malformed 정책, 승인·legacy 보존, 교사 권한, 최근 인증, 중복/충돌 저장, 모든 승인 단계의 정책 검사.
- `firebase emulators:exec --only firestore --config firebase.registration-policy-test.json --project demo-westory-session-registration-policy "node functions/scripts/verify-student-registration-policy-integration.cjs"`: 실제 Firestore rules·transaction·세션 callable을 사용한 가입/복귀/연장/재인증/기준 변경/직접 쓰기 차단/로그아웃 검증. 전용 demo 프로젝트만 허용한다.
- `node scripts/verify-registration-recovery.mjs`: 대기·거부·가입 기준 오류를 구분하고 현재 연도·학년 형식을 표시한다.
- `node scripts/verify-auth-startup-session-integration.mjs`: 기존 인증 시작·세션 연동 11건 회귀 검사.
- `node functions/scripts/verify-production-gateway.cjs`: 로그인/명령 경로의 동일 세션 계약과 정책 모듈의 배포 포함 확인.
- 기존 로그인 세션 에뮬레이터 회귀 32개 항목과 `scripts/verify-student-access.mjs` 전체 그룹도 통과했다. 기존 승인/legacy 학생 접근, 승인대기 차단, 교사·유지보수, 수업자료, 게임 지급·차감·중복 정산 계약을 보존한다.
- `functions/productionGateway/scripts/verify-registration-notification-integration.cjs`도 새 규칙과 263 합성 계정으로 통과했다. 실제 가입→개인 실시간 알림→승인 3단계/거부·응답 영수증·알림 삭제 보존을 확인했으며 원장 쓰기는 없다.

운영 대상은 서울 `getStudentRegistrationPolicy`, `saveStudentRegistrationPolicy`, 로그인 세션 함수 4개, `executeCommand`, Firestore rules다. 신규 정책이 기본값과 같은 운영 문서는 임의로 생성하지 않는다. Storage rules는 기존 승인 차단을 유지하므로 이번 정책 변경으로 재배포하지 않는다. 배포 전 각 운영 소스를 대조하고 이후 운영 Vercel 커밋과 도메인 연결 및 화면을 검증한다.

새 개인정보 항목, 외부 서비스, AI 호출·에이전트 실행·외부 AI 전송, 학생 공개 확대는 없다. 기존 학교의 가입 제한을 교사가 통제하는 유지보수이며 기관 보안성 검토의 미확인 상태를 승인·면제로 바꾸지 않는다.
