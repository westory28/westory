# 생각모아 리디자인과 실시간 갱신 검증

## 범위

- 학생·교사 생각모아 목록, 주제 등록, 입력, 응답 보드와 발표 화면을 재구성했다. `education-web-design-system`, `DESIGN.md`, `UI_RULES.md`를 따른다.
- 생각모아에 자체 호스팅 SUIT Variable을 적용하고 파랑·앰버·슬레이트 색상, 얇은 선과 최소 그림자를 사용한다. 회전 SVG 배치를 제거하고 가로 흐름으로 모든 단어를 표시한다. 중복 횟수는 실제 글자 크기와 300ms 성장 효과에 반영한다.
- 사용자 명시 요청에 따라 OS 동작 줄이기에서도 효과를 제공하며, 화면 안의 효과 끄기로 중단할 수 있다. 변경 없는 결과에는 애니메이션을 재생하지 않는다. Bklit, Anime.js, Motion 패키지나 외부 AI 호출을 추가하지 않았다.

## 실시간 계약

- 기존 10초 전체 조회를 제거한다. 서버가 허용한 학급의 `think_cloud_state` 변경 신호만 구독하며, 신호에는 응답 내용·이름·UID를 넣지 않는다.
- 응답과 변경 신호는 같은 명령 트랜잭션에 기록한다. 별도 `responseRevision`을 쓰므로 주제 운영의 revision과 충돌하지 않는다. 기존 명령 영수증·보상 경로를 유지한다.
- 서버 전용 `think_cloud_sessions/{id}/private/index`의 응답 수·UID/단어 SHA-256 인덱스로 매 제출의 전체 응답 조회를 제거한다. 학생·교사·관리자의 직접 읽기/쓰기는 모두 차단된다. 새 주제는 빈 인덱스를 만들고, 기존 주제 재개 시 원본 전체로 준비하며, 삭제 시 함께 지운다. 응답당 인덱스·신호 쓰기 2건이 추가되지만 반복 전체 응답 읽기를 제거한다. 필드 선택만으로 읽기 건수가 줄었다고 계산하지 않는다.
- 같은 주제의 제출은 인스턴스 안에서만 순서를 조절한다. 키 64개, 전체 대기 512개, 주제별 대기 64개, 시작 전 대기 15초로 제한하고 슬롯을 정리한다. 분산 정합성은 여전히 Firestore 트랜잭션과 영수증이 보장한다. 실행 시 등록 승인·학생 점검·세션·학기·학급을 다시 검사하며, 대기 기한은 dispatch 직전에도 확인한다. 등록 승인·점검 재확인에 필요한 읽기 2건은 유지하며 다른 명령에는 추가하지 않는다.
- `executeThinkCloudResponseFast`, `getThinkCloudStateFast`는 기존 nam5 저장소와 가까운 `us-central1`에서 같은 권한·명령 코어를 사용한다. 제출 전용 endpoint는 정확히 생각모아 제출 명령만 허용한다. 기존 서울 endpoint는 호환성을 유지한다. 예약 대기 인스턴스는 0이며 다른 기능의 라우팅을 바꾸지 않는다.
- 신호를 180ms 동안 합치고 `think-cloud-delta` 조회로 선택한 주제의 `sequence > afterResponseSequence`만 읽는다. 새 응답은 ID로 병합하며 주제 목록과 교사 명부를 다시 읽지 않는다. 기존 응답은 처음 조회할 때 누락 없이 복원한다.
- 모든 데이터 조회는 기존 세션·현재 학기·canonical 재적·담임/위임 권한·익명 처리 검사를 통과한다. Firestore 직접 응답 읽기로 우회하지 않으며 rules는 변경하지 않는다.
- 숨김 탭은 구독을 해제한다. 복귀·주제 선택·주제 운영 변경 때 전체 상태를 복구한다. 계정/학기 변경 뒤의 늦은 응답은 폐기한다. 권한·연결 오류는 자동 폴링 대신 기존 오류·수동 재시도 UI로 연결한다.

## 검증 근거

- `node scripts/verify-think-cloud-browser.mjs`: 실제 학생/교사 컴포넌트, CSS 및 lifecycle을 합성 transport와 연결한다. 전체 MainLayout 대신 폭이 같은 최소 사이드 레일을 사용하며 운영 학생 자료를 쓰지 않는다.
- 320·390·768·1280px에서 목록·상세의 가로 넘침, 투명 제목 배경, 동작 줄이기, 글꼴, 단어 성장·166개 단어·100자 문장, IME, 중복 전송, 저장 실패·재시도, 읽기 전용, 익명 표시, 발표 초점·삭제 후 스크롤 복원을 확인했다.
- 실제 페이지의 합성 응답 20개 신호가 delta 1회로 묶였다. 30초 동안 변경이 없을 때 추가 callable은 0회였다. 합성 commit→화면 측정은 로컬 전달 경로를 검증하며 운영 네트워크 지연 보장이 아니다.
- 학생 본인 응답도 서버 성공 직후 해당 ID만 추가하며 전체 재조회를 하지 않는다. 먼저 도착한 정식 delta를 중복 추가하지 않고, 응답 커서를 임의로 앞당기지 않는다. 중복 100→101회에서도 실제 글자 크기가 계속 증가한다.
- `npm run verify:think-cloud-lifecycle`: 실제 W8 adapter/query와 연결해 초기 조회 1회, 응답 25개 delta 1회, 조회 중 추가 신호, 숨김·복귀, 선택·계정·학기 전환, 주제 변경·삭제와 delta 경합, 권한 회수 후 차단을 검사한다.
- `node --test functions/scripts/verify-think-cloud-live.cjs`, 실제 Firestore 에뮬레이터의 `verify-think-cloud-live-integration.cjs`로 명령·커서·실제 동시 저장을 검사한다. 응답 문서 수와 Firestore 청구 읽기 건수는 구별한다. 신호 문서 구독과 서버 권한 확인에도 읽기 비용이 있다.
- 원본과 중간 구현의 30명 동시 제출 잠금 실패를 확인하고 실험 기록을 보존했다. 최종 구성은 실제 점검 guard를 포함한 독립 처리기/큐 3개에 각 10개를 보내 같은 Firestore에서 경합시켰다. 재개한 주제와 인덱스 없는 기존 주제 모두 30/30 저장, 최초 실패 0, 추가 수동 재시도 0이었다. 각각 35/37 transaction attempts, 로컬 시간 6.756/9.792초로 운영 지연 보장은 아니다. [Firebase 문서](https://firebase.google.com/docs/emulator-suite/connect_firestore#how_the_cloud_firestore_emulator_differs_from_production)도 에뮬레이터의 transaction·잠금 차이를 명시한다.
- 199개 상태의 30명 동시 제출에서는 정확히 1건만 저장되고 29건은 200개 상한으로 차단됐다. 200개 응답·비공개 인덱스 삭제와 영수증 재시도 추가 쓰기 0건도 확인했다. 최종 단위검사는 코어 9개·큐 9개, 브라우저 검사는 20개 시나리오이며 앱 빌드·Functions 전체 검사를 통과했다.
- 재현 환경은 `firebase.think-cloud-test.json`, 프로젝트 `demo-westory-session-think-cloud`다. 실제 rules 검사는 `functions/scripts/verify-think-cloud-private-rules.cjs`의 31개 허용/차단 사례를 통과했다. 큐의 점검 전환·등록 승인 차단·event loop 지연·만료 후 미실행 검사는 `verify-think-cloud-submit-queue.cjs`로 확인한다.
- 상세 실행 결과와 화면은 로컬 `output/think-cloud-20261114/`에 보관하며 Git에는 합성 검사 코드만 포함한다.

## 기존 작업 보존과 배포

- 원래 `C:\westory`의 미커밋 파일을 건드리지 않고 별도 worktree에서 구현했다. 회사/다른 작업에서 `origin/main`에 반영된 `9bacfce5`, `442a9936` 점수 수정·모바일 화면을 병합했다.
- 운영 `executeCommand`의 실제 의존 소스와 로컬에는 이번 패치 밖의 차이가 있다. 따라서 각 함수의 운영 보관 소스를 따로 복원하고, 검증한 `w8Domains.js`, `thinkCloudSubmitQueue.js`, `productionSource.js`의 연결부, `thinkCloudQuery.js`, root의 Fast export만 겹쳐서 4개 함수를 선택 배포한다. 다른 함수·rules·GitHub Pages 설정은 배포 대상이 아니다.
- 배포 전 운영 도메인은 Vercel `dpl_5ZGAEKsfu6phg74yZKqvi2vW3uzr`, `main`의 `442a993648e36c5cb3922c98f2c131d5a346891c`에 연결되어 있었고 작업 branch에 포함되어 있다.
- 최종 동시 제출 결과, 배포 ID 및 운영 확인은 배포 완료 후 아래에 기록한다.
