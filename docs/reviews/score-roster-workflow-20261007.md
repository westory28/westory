# 수행평가·학생 명단 UI 및 엑셀 QA — 2026-10-07

이 기록은 학생 명단·수행평가 화면, 나이스 파일 인식·일람표 생성, Auth·Firestore emulator 및 운영 API 계약 검증을 다룹니다. 운영 학생 계정으로 점수·서명 데이터를 쓰는 검사는 수행하지 않았습니다.

## 검증 방식과 개인정보 범위

- 실제 `StudentList`, `StudentRosterModal`, `PerformanceScoreManager` React 컴포넌트를 esbuild로 묶어 Edge headless 브라우저에서 조작했습니다.
- AuthContext, Firestore, Functions callable만 메모리 기반 가상 서비스로 교체했습니다. 번들에 Firebase SDK가 포함되지 않는지 확인하고 localhost 외 브라우저 네트워크 요청은 차단했습니다.
- 명단·점수·서명은 가상 값입니다. 운영 계정, 학생 명단, 점수, 서명, 이의제기 문서를 생성하거나 수정하지 않았습니다.
- 사용자가 제공한 나이스 원본은 별도 브라우저에서 파일 선택·인식까지만 확인했습니다. 원본을 복사하거나 저장하지 않았고 학생 이름이 나오는 화면을 캡처하지 않았습니다. 결과에는 학생 수와 평가 수만 남겼습니다.
- 화면 캡처와 다운로드 결과 파일은 가상 학생만 포함합니다. 글꼴·아이콘 외부 리소스는 차단되어 시스템 대체 글꼴을 사용했습니다.

## 학생 명단 UI

실행 스크립트: `scripts/verify-student-roster-browser.mjs`

320, 390, 768, 1280px 너비에서 아래 항목을 통과했습니다.

- 기본 명단은 재학생만 표시하고 전출·정원외 학적관리 학생 및 직원 계정은 제외합니다.
- 승인 상태 필드 자체가 없는 가상 기존 학생 321명은 재학생으로 유지됩니다. 승인 필드에 `null`, 빈 문자열, `undefined`가 명시된 세 학생은 등록 대기에만 표시되며 서버·rules와 동일하게 처리됩니다.
- 제외 명단에서 학생을 확인하고 재학으로 바꾸면 재학생 명단에 복귀합니다.
- 등록할 학생의 활성 학년·반·번호가 중복되면 쓰기 전에 차단합니다.
- 등록 저장 오류 후 입력 내용이 유지되고 재시도하면 현재 학기 범위로 요청합니다.
- 신규 등록은 등록 대기로 표시하며 재학생 명단에서 제외합니다. 첫 학교 계정 로그인 전에는 승인 오류를 표시하고 입력 확인 상태를 유지합니다. 계정 확인 후 재시도하면 승인 세 단계를 마친 뒤 재학생 명단과 완료 문구를 표시합니다.
- 기타 제외는 사유 입력이 필수이며 저장 후 해당 사유가 제외 명단에 표시됩니다.
- 읽기 전용 화면에는 등록·학적 변경 동작이 없습니다.
- 명단 조회 실패 시 오류와 다시 시도 버튼을 표시합니다.
- 페이지 가로 넘침이 없고 모달이 화면 폭 안에 배치됩니다. 명단 표는 좁은 화면에서 표 내부만 가로 스크롤합니다.
- 새 명단 모달의 Escape 닫기 및 열었던 버튼으로 포커스 복귀를 확인했습니다.
- 브라우저 `pageerror`는 0건입니다.

## 학적·등록 command 호환 검증

`scripts/verify-student-profile-commands.mjs`는 canonical 조회 결과에서만 학적 command를 사용하고 명시적인 LEGACY 결과에서만 기존 수정 함수를 호출함을 확인합니다. 세션 소유자·revision, 이메일 변경 금지, 통신 오류 후 command 영수증 조회, 같은 요청의 UUID 유지 및 중복 클릭을 검사했습니다.

`scripts/verify-student-registration.mjs`는 등록 조회 → `APPROVE` → 재조회 → `PREPARE_ACCOUNT` → 재조회 → `FINALIZE`를 검사합니다. 학교 계정 미확인, 승인 중 Wis 준비 미완료 후 재개, 모든 단계의 응답 유실 복구, 같은 UUID 재시도, 미확인 조회 결과 성공 거부, 확인 화면 이후 등록 정보 변경 거부, 등록 대기 학생의 재학생 판별 제외를 통과했습니다. `STUDENT_APPROVAL_SERVER_SOURCE`에 복원한 운영 `studentRegistrationApproval.js`를 지정한 실행에서는 실제 payload 정규화 함수에도 세 단계 요청을 대조했습니다.

이 검증은 실제 프런트엔드 함수와 운영 source 계약에 대한 로컬 검증입니다. 학교 Google 계정의 최초 로그인이나 운영 승인 command 실행은 하지 않았습니다. 새로 등록한 학생은 첫 학교 계정 로그인과 교사 등록 승인이 끝나야 점수 확인·서명을 사용할 수 있습니다.

## 수행평가 업로드 UI

실행 스크립트: `scripts/verify-score-workflow-browser.mjs`

390, 768, 1280px 너비에서 아래 항목을 통과했습니다.

- 업로드 창에 이전 학기의 고정 수행평가명 선택란·카드가 없습니다.
- 가상 나이스 형식 XLSX를 실제 파일 입력으로 선택하면 서로 다른 평가명 두 개와 만점 15점·35점을 인식합니다.
- 가상 학생 32명을 현재 명단과 연결하고 미리보기에서 총원·연결 인원·입력 인원과 만점을 표시합니다.
- 저장 시 두 평가를 각각 별도 roster로 만들고 학생 점수 문서 64개를 저장합니다. 0점도 입력한 점수로 보존합니다.
- 미리보기 뒤 학생 한 명을 전출 처리한 상황에서는 저장 직전에 명단을 다시 확인하고 전체 업로드를 쓰기 전에 차단합니다.
- 같은 NEIS 파일을 다시 올려도 기존 교사 피드백·평가 근거·항목 피드백과 점수 버전·유효 서명을 유지합니다. Firestore 항목 객체의 키 순서를 뒤집은 경우에도 점수 문서를 다시 쓰지 않음을 확인했습니다.
- 두 번째 평가만 담은 파일을 재업로드해도 기존 평가 순서 2와 항목 키를 유지합니다.
- 2반 파일을 이어 업로드해도 먼저 올린 1반 32명이 유지됩니다. 빈칸은 기존 12점을 보존하고 명시적인 0점은 해당 점수를 0점으로 갱신합니다.
- 일부 학생만 포함한 파일에서 만점을 바꾸면 기존 학생 점수의 기준이 섞이지 않도록 쓰기 전에 차단합니다.
- 실제 제공된 한컴/나이스 파일을 브라우저 `File` 입력과 실제 XLSX reader로 읽어 32명·두 평가를 인식했습니다. 이 실행에는 원본 화면 캡처나 저장 동작을 포함하지 않았습니다.
- 브라우저 `pageerror`는 0건입니다.

## 업로드 모달 키보드 접근성

실제 `AppDialogProvider`와 점수 관리 컴포넌트를 함께 렌더링한 브라우저에서 390, 768, 1280px 모두 확인했습니다.

- 업로드 창과 미리보기는 열릴 때 해당 dialog로 포커스가 들어갑니다. 미리보기는 `role=dialog`, `aria-modal`, 제목 연결을 갖춥니다.
- Tab과 Shift+Tab으로 처음·마지막 조작 요소를 순환하며 배경 화면으로 빠져나가지 않습니다. 파일 선택 영역에는 키보드 포커스 표시가 있습니다.
- Escape로 창을 닫으면 최초 업로드 버튼으로 포커스가 돌아갑니다. 업로드 창에서 파일 선택 후 미리보기로 전환한 경우도 동일합니다.
- 가상 트랜잭션을 일시 정지한 저장 중 상태에서 Escape와 닫기·취소 버튼으로 미리보기를 닫을 수 없음을 확인했습니다.
- 다른 학기 파일 저장 시 실제 공용 확인 dialog가 중첩됩니다. 이때 Escape는 확인창만 닫고 미리보기의 저장 버튼으로 복귀하며 점수 쓰기는 발생하지 않습니다. 이후 Escape를 다시 누르면 미리보기가 닫힙니다.
- 이번 재실행의 브라우저 `pageerror`는 0건이며, 기존 업로드·서명 파일 생성 검사도 다시 통과했습니다.

동일 스크립트의 서비스 계층은 가상 데이터입니다. 키보드 동작은 실제 React 화면과 공용 dialog를 사용했으며, 별도 통계 모달의 접근성은 이번 변경 범위에 포함하지 않았습니다.

## 일람표 다운로드와 서명 파일 검증

실제 다운로드 버튼을 눌러 생성된 가상 XLSX를 ExcelJS로 다시 열어 확인했습니다.

| 검증 대상 | 결과 |
| --- | --- |
| 평가명·만점 | E6, G6에 파일에서 읽은 평가명과 15.00·35.00 만점 반영 |
| 학생 명단 | D7부터 D38까지 가상 학생 32명 반영 |
| 점수 | E열·G열 점수, H열 합계, 마지막 학생의 0점 보존 |
| 유효 서명 | 현재 점수 버전과 일치하는 confirmation 서명 이미지 1개 삽입 |
| 서명 위치 | 첫 학생의 7행 비고 영역(10열 이후)에 이미지 배치 |
| 오래된 서명 | 과거 점수 버전의 confirmation 이미지는 출력에서 제외 |
| 페이지 설정 | A4, 세로 방향 유지 |
| 다운로드 이름 | 현재 학년도·학기·학년·반 반영 |
| 서명 조회 실패 | 기본 조회와 개별 재조회가 모두 실패하면 명시적 오류로 중단하며 다운로드·미서명 확인창을 만들지 않음 |

셀과 이미지 앵커 및 페이지 설정 검증이며 실제 Excel/한셀 인쇄 엔진의 페이지 렌더링 검증은 아닙니다. 서명 입력 자체와 Firebase 보안 규칙, callable 인증, 알림 전송은 이 UI 가상 서비스 검증으로 증명하지 않습니다.

`scripts/verify-score-roster-management.mjs`의 실제 함수 회귀에서는 현재 재학 상태가 예전 점수표의 전출 표시보다 우선함을 확인했습니다. 화면에서만 과거 학적 메타데이터를 제외하며 원본과 이전 학기 조회는 유지합니다. 또 학생 명단에서 반을 옮긴 경우 예전 반의 출력에서는 빠지고 현재 반의 출력에 최신 이름·번호와 기존 점수·유효 서명이 연결되며, 점수·서명 저장본은 변경되지 않음을 검증했습니다.

## 재현 명령

Node.js, 저장소 의존성 및 Playwright와 실행 가능한 브라우저가 필요합니다. Windows 기본 브라우저 채널은 `msedge`입니다. Playwright 경로는 `PLAYWRIGHT_MODULE_PATH`, 다른 브라우저 채널은 `SCORE_QA_BROWSER_CHANNEL`로 지정할 수 있습니다.

```powershell
$env:SCORE_QA_EVIDENCE_DIR = 'C:/evidence/score-roster-workflow'
$env:SCORE_QA_TAILWIND_PATH = "$env:TEMP/westory-qa-tailwind.js"
Invoke-WebRequest -Uri 'https://cdn.tailwindcss.com' -OutFile $env:SCORE_QA_TAILWIND_PATH
node scripts/verify-student-roster-browser.mjs
node scripts/verify-score-workflow-browser.mjs
node scripts/verify-student-profile-commands.mjs
node scripts/verify-student-registration.mjs
```

기본 실행은 가상 파일만 사용합니다. 제공된 32명·두 평가 나이스 파일도 읽어 보려면 `SCORE_QA_REFERENCE_XLSX`에 로컬 원본 경로를 지정해 두 번째 스크립트를 실행합니다. 이 선택 검사에서는 원본 캡처·복사·저장 없이 인식된 수만 검사합니다. 학생 정보가 있는 원본을 저장소나 evidence 폴더로 복사하지 마세요.

## 검증 산출물

이번 실행 evidence root:

`C:/Users/방재석/.codex/visualizations/2026/10/07/01a115ca-c904-7b73-ad25-f618eb3bcd8f/roster-qa`

| 산출물 | 내용 |
| --- | --- |
| `report.json` | 학생 명단 검증 결과와 13장 캡처 목록 |
| `performance-report.json` | 수행평가 검증 결과와 7장 캡처 목록 |
| `create-390.png` | 모바일 학생 등록 모달 |
| `enrollment-768.png` | 태블릿 학적 변경 모달 |
| `roster-1280.png` | 데스크톱 학생 명단 |
| `registration-wait-1280.png` | 학교 계정 첫 로그인 전 등록 승인 대기 |
| `performance-upload-390.png` | 고정 평가명 없는 모바일 업로드 창 |
| `performance-preview-390.png` | 모바일 평가명·만점 자동 인식 |
| `performance-preview-1280.png` | 데스크톱 업로드 미리보기 |
| `performance-sheet-dialog-1280.png` | 점수·서명 조회 후 일람표 창 |
| `synthetic-performance-class-sheet.xlsx` | 가상 학생·가상 서명만 포함한 다운로드 결과 |

## 남은 검증 경계

- 기존 학생 정보 편집은 저장 직전 canonical 조회와 command 사이의 버전 충돌을 보호합니다. 편집창을 연 뒤 저장 직전 조회 전에 다른 교사가 바꾼 정보까지 구분하는 원본 비교는 후속 개선 항목입니다. 점수 저장의 최신 명단 재검증은 별도로 유지합니다.
- 같은 학기·동일 평가의 만점을 변경할 때, 해당 평가에 보존된 전출 학생 점수가 있으면 안전을 위해 업로드가 차단됩니다. 재학 학생 전체 파일만으로는 이 조건을 해소할 수 없으며, 이번 변경에서 기존 제외 학생 점수의 기준을 자동 변경하지 않았습니다.
- canonical 학기 명단 gateway·프로필 연결의 요청·응답·재시도 계약은 복원 운영 source와 대조했습니다. 실제 운영 계정으로 변경하는 검증은 포함하지 않았습니다.
- 이 기록의 UI 검증은 실제 교사·학생 로그인, 운영 읽기/쓰기, 실제 알림 수신을 대신하지 않습니다.
- 업로드·미리보기 및 새 학생 명단 모달의 키보드 동작은 검증했습니다. 통계 등 그 밖의 기존 모달은 이번 접근성 검증 범위에 포함하지 않았습니다.

## 서버·보안 규칙 및 운영 소스 대조

2026-10-07 운영 프로젝트 `history-quiz-yongsin`, 리전 `asia-northeast3`의 함수 메타데이터와 해당 함수별 실제 배포 source archive를 읽기 전용으로 확인했습니다. 로컬 소스만으로 운영 계약이 같다고 판단하지 않았습니다. 운영 학생 문서·점수·서명은 쓰지 않았고, 아래 현황 조회는 이름·UID 없이 집계만 기록했습니다.

| 함수 | 운영 updateTime (UTC) | source generation |
| --- | --- | --- |
| `openApplicationSession` | 2026-09-17T14:12:55.277805381Z | 1789654312441736 |
| `updateStudentData` | 2026-09-12T08:46:54.355329802Z | 1789202801321406 |
| `notifyPerformanceScoreObjectionRequested` | 2026-09-12T08:45:57.324904917Z | 1789202732122445 |
| `notifyPerformanceScoreAnswerSheetRequested` | 2026-09-12T08:45:52.300432676Z | 1789202741268180 |
| `reviewPerformanceScoreObjection` | 2026-09-12T08:45:53.602417070Z | 1789202741312985 |
| `getPrintClientInfo` | 2026-09-12T08:45:55.155881471Z | 1789202732046187 |
| `executeCommand` | 2026-09-16T12:43:18.412665612Z | 1789562589700121 |
| `getStudentRegistrationApprovalState` | 2026-09-12T08:45:41.637884199Z | 1789202730834256 |

각 source 위치는 `gs://gcf-v2-sources-177587430482-asia-northeast3/<함수명>/function-source.zip#<generation>`입니다. 압축파일과 복원 소스는 저장소 밖 로컬 임시 디렉터리 `C:/Users/방재석/AppData/Local/Temp/westory-score-backend-source-audit-20261007`에 있습니다.

운영 점수 callable 3개는 로컬과 달리 이전 command 전환에서 `CLIENT_UPDATE_REQUIRED`로 차단된 상태였습니다. 운영 명단 함수는 canonical 학적이 있으면 기존 명단 직접 수정을 거부했습니다. 반면 운영 Firestore rules는 이번 작업 전 로컬 규칙과 일치했습니다. 확인한 ruleset은 `projects/history-quiz-yongsin/rulesets/07840dbf-8b84-4f41-96ae-6726f45ef6ea`입니다.

읽기 전용 집계 결과 현재 설정은 2026학년도 2학기이며, `semester_enrollments`는 642개(2026-1 321개, 2026-2 321개), `semester_grade_records`와 `semester_assessments`는 각각 0개였습니다. 이 혼재 상태 때문에 기존 점수 저장 경로의 이의제기를 복구하되, 공식 성적 원장이 존재하면 기존 command 전용 보호를 유지했습니다. 기존 학생 프로필 변경은 운영 `getStudentEnrollmentProfileState`와 `executeCommand`로 연결합니다.

운영 `openApplicationSession` source에서 아래 세 모듈을 그대로 복원했습니다. 점수·명단 callable의 세션/점검/최근 인증 보호 의존성으로만 사용하며 로그인 callable을 새로 export하거나 재배포하지 않습니다.

| 파일 | SHA-256 |
| --- | --- |
| `functions/sessionAuthority.js` | `DFE91819E12DD9318D13F6B67108F75C55D05C7DDF486EBAA5353CA926DF4844` |
| `functions/studentMaintenance.js` | `A688A12E0AB463C5F8422135A1C9DC0AF7301564A486B0E3F8C728A150EA4125` |
| `functions/studentRegistrationAccess.js` | `D3FF1E17E1016204CC6D47FFA754AEF55ABEABBD7876DCEC6A7BB889210114AC` |

`getPrintClientInfo`의 실제 배포본 역시 세션·점검 보호가 적용되어 있어 프런트엔드가 동일 세션 helper로 호출하도록 연결합니다. 이 서버 함수의 재배포는 필요하지 않습니다.

신규 학생 승인도 `executeCommand`와 `getStudentRegistrationApprovalState` 각각의 실제 배포 source에서 확인했습니다. `studentRegistrationApproval.js`는 앞서 읽은 source와 동일하며, executeCommand archive의 차이는 줄바꿈 방식뿐입니다. 실제 command gateway에는 Auth의 학교 이메일 인증 상태를 확인하는 승인 adapter가 연결되어 있습니다.

## 서버 변경 계약

- 새 학생은 동일 학교 이메일의 Auth UID와 연결합니다. 학교 이메일을 임의로 인증 완료 처리하지 않습니다. 신규 users 문서는 `registrationApprovalStatus: PENDING`이며, 승인 전에는 점수 명단 및 서명·이의제기 대상에서 제외합니다. 승인 상태가 없는 기존 계정과 신규 계정을 구분합니다.
- 최초 Google 로그인만으로 canonical 등록이 자동 완료되는 경로는 없습니다. 확인된 학교 계정에 대해 기존 `approveStudentRegistration` command의 `APPROVE → PREPARE_ACCOUNT → FINALIZE`가 끝나야 완료입니다. 첫 로그인 전 또는 중간 오류는 등록 대기로 남고 교사가 재개합니다.
- 명단 제외/복구는 users의 분류와 해당 학기 canonical enrollment의 `rosterExclusionStatus/reason`을 같은 transaction으로 저장합니다. canonical `enrollmentStatus: ACTIVE`, enrollment ID, revision 및 Wis 연결은 바꾸지 않습니다. 계정 폐쇄나 실제 학적 lifecycle 종료를 대신 수행하지 않습니다.
- 명단 저장 transaction 안에서도 현재 config 및 존재하는 semester_active 포인터를 검사합니다. 이전 학기 기록은 변경하지 않습니다. 동일 제외 상태·사유의 재요청은 이력 중복 없이 끝납니다.
- legacy 학생 프로필 변경에서도 점수의 `updatedAt`을 유지하고 `profileUpdatedAt`만 별도로 갱신합니다. 이름·반·번호 변경으로 유효 서명이 사라지지 않습니다.
- 서명은 현재 점수의 `scoreUpdatedAt`에 묶습니다. 점수가 바뀌면 과거 서명은 화면·출력에서 제외되고 새 점수에 다시 서명할 수 있습니다. 이의제기 대기 중에는 서명할 수 없습니다. 이의제기 저장·교사 검토는 transaction으로 중복 처리와 동시성 충돌을 보호합니다.

## Auth·Firestore emulator 검증

실행 스크립트 `scripts/verify-score-workflow-emulator.mjs`는 로컬 Auth와 Firestore emulator 주소를 필수로 검사하고 demo 프로젝트에서만 실행합니다. 실제 Firestore rules, 학생/교사 클라이언트, 서버 callable handler를 사용합니다.

```powershell
firebase emulators:exec --only auth,firestore --project demo-westory-session-score-workflow "node scripts/verify-score-workflow-emulator.mjs"
npm --prefix functions run check
```

2026-10-07 재실행에서 통과한 항목:

- 교사 등록, 이메일 UID 연결, 재요청 idempotency, 학년·반·번호 중복 거부, 학생의 관리 API 거부.
- PENDING 유지, Auth emailVerified 우회 없음, 학생 자신의 승인 상태 변경·승인 전 서명·이의제기 차단.
- 교사 점수 저장 → 본인 점수 읽기 → 학생 서명 → 교사 서명 읽기. 다른 학생의 점수 읽기와 학생 점수 수정 차단.
- 과거 점수 버전 서명 차단, 유효 서명 덮어쓰기 차단, 점수 수정 뒤 재서명 허용.
- 이의제기 저장 시 서명 차단, 교사 알림함 생성·조회, 학생의 다른 알림함 조회 차단, 교사 검토와 학생 결과 알림 조회, 처리된 요청의 중복 접수 방지, 서명 후 답안요청 및 교사 알림 생성.
- 제외 시 현재 학기 명단·점수 분류 반영, 이전 학기·기존 서명 보존, 자기 재학 복귀·서명·답안요청 차단, 교사 복구 및 이력 확인.
- canonical 제외 분류는 적용하되 ACTIVE/id/revision 보존. canonical 프로필·성적 원장의 command 전용 보호 유지.
- transaction 도중 현재 학기 변경 시 users 생성 차단, semester_active 불일치 차단, 제외 상태 재요청의 이력 중복 방지, legacy 프로필 수정 후 점수 버전 유지.
- 잘못된 세션 proof와 폐쇄된 교사 세션 차단.

실패를 기대하는 권한 검사에서는 `PERMISSION_DENIED` 로그가 나타납니다. 전체 스크립트 종료 코드는 0입니다. 승인 완료 이후 점수 흐름의 독립 fixture는 emulator 관리 권한으로 APPROVED 상태를 준비합니다. 따라서 이 검증은 운영의 canonical 승인 command 전체 실행이나 실제 Google 로그인 성공을 증명하지 않습니다. 승인 프런트엔드의 query/command 단계·응답 유실 복구는 별도 모의 서비스 계약 검증이며, 운영 계정으로의 실제 등록·점수·서명·알림 전송은 수행하지 않았습니다.

## 변경 서버 배포 범위

최종 빌드·통합 검증 후 아래 함수만 선택 배포합니다.

`createStudentData`, `updateStudentEnrollment`, `updateStudentData`, `notifyPerformanceScoreObjectionRequested`, `notifyPerformanceScoreAnswerSheetRequested`, `reviewPerformanceScoreObjection`

추가로 `firestore:rules`를 배포합니다. `openApplicationSession`, 로그인 세션 lifecycle 함수, `executeCommand`, 승인 query/command, `getPrintClientInfo` 및 다른 Functions는 배포 범위에 포함하지 않습니다. 이 서버 검증 기록 자체는 운영 배포 성공 또는 실제 운영 화면 반영 확인을 대신하지 않습니다.
