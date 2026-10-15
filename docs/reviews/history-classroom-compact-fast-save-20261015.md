# 역사교실 입력·저장·교사 직접 면제 검증 (2026-10-15)

## 요청과 범위

- 학년·반·번호·이름·배정 사유를 같은 입력 행에 배치하고 전체 이름 검색과 학생 추가를 압축한다.
- 설정창의 응시 현황과 학생 명단에 별도 스크롤을 만들지 않는다. 리셋 아이콘과 문구는 하나의 버튼 안에 둔다.
- 역사교실 원본·평가 정의·공개 상태를 한 서버 명령으로 저장한다.
- 학생 요청이 없는 경우에도 교사가 저장된 배정 학생의 보유 면제권 한 장을 직접 사용한다.

## 작업 기준과 운영 진단

전용 worktree `codex/history-exemption-reliability`를 `49c8a018f15327b8f0d6adc4c8d9b4b67c97812d`로 갱신해 시작했다. 기본 checkout의 다른 작업은 수정하지 않았다. 작업 중 도착한 지도 개선 `9dcecb0`은 최종 통합 검증에 포함한다.

배포 전 서울 `executeCommand`는 `executecommand-00013-vuh` (2026-10-15T12:19:43.242475826Z)였다. 해당 보관 소스 generation `1792066728733294`를 다운로드하고 gateway manifest의 55개 파일을 LF 정규화하여 비교했으며, 시작 HEAD와 모두 일치했다. `getCommandStatus`는 `getcommandstatus-00005-zuf`, generation `1792062025811744`였다. 이후 반영된 평가·지도·면제 관련 변경 및 신규 `assessmentLearning.js`를 제외한 기존 gateway 파일은 시작 HEAD와 일치했다.

운영 요청 로그에서 12:22:09.997867Z, 12:22:15.154378Z, 12:22:17.896262Z에 성공한 POST 세 건의 지연은 각각 3.212860165초, 1.655897877초, 1.696891868초였다. 첫 요청 시작부터 마지막 응답 종료까지 약 9.60초다. 요청 본문을 읽지 않았으므로 세 건이 동일 저장 동작이라고 단정하지 않으며, 브라우저 클릭부터의 직접 측정값으로 취급하지 않는다. 기존 코드의 원본 저장→정의 저장→공개 요청 순서에서 불필요한 왕복과 저장 후 재조회가 확인되었다.

## 검증 및 운영 반영

### 구현과 회귀 검사

- `saveHistoryClassroomAssignment`가 원본 revision 비교, 답안·진행 응시 검증, 평가 정의 갱신, 공개 상태를 같은 트랜잭션으로 처리한다. 이전 3명령 및 브라우저 후속 읽기 4회가 1명령·후속 읽기 0회로 줄었다. 명령 receipt가 최초 저장 날짜와 결과를 보존한다.
- `applyHistoryClassroomExemption`은 교사 권한, 저장된 배정 대상, 활성 재적·학급, 과제 공개·응시 기간, 티켓 소유자·학기·만료·사용 상태, 기존 통과와 대기 요청을 검증한다. 보유권 차감, canonical/legacy 완료 결과, 진행 응시 잠금, `origin: teacher_direct` 감사 기록을 함께 저장하며 보상은 지급하지 않는다.
- demo Firestore의 실제 callable 코드로 같은 28빈칸 과제를 3회씩 비교했다. 기존 3명령은 358/384/382ms, 원자 1명령은 128.4/112.3/113.7ms였다. 중앙값은 382→113.7ms(약 70.2% 감소)다. 별도 최초 실행에서는 약 65.6% 감소했다. 운영 HTTP 왕복이나 브라우저 클릭 시간을 측정한 값은 아니다.
- 실제 SDK 검사에서 저장 1명령, 응답 유실 후 동일 commandId 재사용, 하루 응시 기한의 최초 dueAt 유지, 인증 소유자 전환, source revision 충돌을 확인했다.
- 통합 검사에서 학생의 교사 명령 호출, 다른 학생·학기·만료권, 대기 요청, 부분 실패 rollback, 두 티켓의 같은 과제 경쟁, 같은 티켓의 다른 과제 경쟁, 학생 요청과 교사 직접 사용 경쟁, 재응시 차단, 보상 0을 확인했다. 각 경쟁에서 한 결과만 성립하며 미사용 티켓은 보존된다.
- `npm run build`, `npm --prefix functions run check`, SDK/release/canonical-client 회귀, 변경 TS/TSX/CSS Prettier, `git diff --check`가 통과했다. 독립 검토에서 차단 결함이 발견되지 않았다. 기존 점수 일람표의 테두리 및 지도 회귀 검사도 빌드에서 통과했다.

### 브라우저 검증

운영 Firebase에 연결하지 않는 실제 교사 컴포넌트 fixture를 CUA로 조작했다. 배정 학생 34명, 다른 학급의 긴 이름 미배정 학생, 사용 가능한/없는/사용 완료/타 과제 전용/legacy 사용권을 포함한다.

- 320·390px 신규 등록에서 학년·반·번호·이름·사유의 y 좌표가 같고, 직접 입력 사유에도 별도 textarea가 생기지 않는다. 배정 학생 행은 54px 한 줄이며 가로 넘침이 없다. 1014px에서는 전체 이름 검색과 추가도 같은 행에 놓인다.
- 320·390·768·1440px 응시 현황에서 표 내부 스크롤이 없고, 스크롤 요소는 설정창 본문 하나다. 리셋·면제권 버튼은 한 요소 안의 아이콘/문구이며 좁은 화면에서 아이콘과 접근 가능한 이름을 유지한다.
- 다른 학급 선택과 전체 이름 검색으로 두 학생을 추가하여 사유별 payload, 첫 배정 학생의 학년·반, 1회 저장 명령을 확인했다. 공백 사유는 학생 추가를 막는다.
- 면제권 직접 사용 성공 즉시 해당 학생이 면제 완료가 되고 사용 버튼이 사라진다. 실패 후 재시도 결과는 한 건이다. 처리 중 리셋·면제권 사용·설정 저장 버튼은 비활성화되며 명령은 한 번만 전송된다.
- 설정 저장 실패 후 입력과 재시도 버튼이 유지되며 다음 저장은 한 번 성공한다.
- 학생 포털은 기존 canonical 면제 결과 검증과 legacy 병합 경로를 사용한다. 학생 포털 파일을 바꾸지 않았다. 서버의 고정 면제 결과 조회가 재응시를 거절한다.

### 운영 백엔드

Node 22에서 `executeCommand`, `getCommandStatus`만 배포했다. `firebase functions:list`와 함수 메타데이터에서 모두 ACTIVE를 확인했다.

| 함수 | revision | 운영 소스 generation |
| --- | --- | --- |
| executeCommand | executecommand-00014-big | 1792068280462371 |
| getCommandStatus | getcommandstatus-00006-vuz | 1792068361183387 |

두 운영 보관 소스를 다시 받아 gateway 55파일과 root index/package 2파일을 각각 대조했으며 57파일 모두 최종 로컬 소스와 일치했다. 운영 학생의 배정·점수·면제권을 QA 목적으로 변경하지 않았다. 프론트엔드의 최종 배포 식별자와 운영 도메인 확인은 본 작업의 최종 응답에 남긴다.

상세 로그와 합성 화면은 Git에서 제외되는 `.superloopy/sessions/history-classroom-compact-fast-save/evidence/`에 보관한다. 핵심 파일은 `build.txt`, `functions-check.txt`, `emulator-integration.txt`, `sdk-contract.txt`, `production-source-comparison.json`, `new-mixed-class-save.json`, `edit-save-retry.json`, `direct-exemption-pending.json`, `final-settings-1440.png`이다.
