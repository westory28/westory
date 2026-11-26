# 운영 배포 절차

## 위스피 해외 주식·환전·독립 메뉴 (2026-11-26)

설계·검증·남은 한계는 [출시 기록](../reviews/wispi-overseas-launch-20261126.md)을 따른다. 해외 장은 평일 16:00~23:00(한국 시각)이고 시세는 별도 예약 작업이 갱신한다. 운영 위스피 함수 27개가 11가지 다른 판의 공용 모듈을 싣고 있고 다수는 어떤 커밋과도 일치하지 않으므로, 저장소 전체를 기존 함수에 배포하지 않았다.

11월 26일 반영 결과(기준 커밋 `57777732`):
- Firestore 규칙: `node scripts/release-firestore-rules.mjs release`로 세트 `a819acb9`(이전 `0b8ae18e`, 배포 전 운영 규칙이 `d13c9cd1`과 동일함을 확인). 색인은 `firestore:indexes` 전체 배포 대신 `gcloud firestore indexes composite create`로 `wis_stock_overseas_orders`(컬렉션 그룹, status·dueAtMs)와 `wis_stock_overseas_history`(accountId·sequence desc) 2개만 만들고 READY를 확인했다.
- 새 함수 16개: 저장소에서 `firebase deploy --only functions:<이름들> --non-interactive --force`. `--force`는 새 Firestore 트리거 2개(`onWisStockOverseasOrderCreated`, `onWisStockOverseasMarketTradingWrite`)의 재시도 정책 승인에 필요했다(국내와 같은 코드·같은 멱등 키). `settleWisStockOverseasOrderTask`는 새 빈 큐의 invoker 설정 단계에서 실패해, 국내 큐와 같은 `roles/cloudtasks.enqueuer`(런타임 서비스 계정 하나)를 큐에 붙인 뒤 그 함수만 재배포했다. Cloud Run invoker는 국내와 같이 런타임 계정 하나만이다. 새 Scheduler 3개(`advanceWisStockOverseasPrices` 10분, `recoverWisStockOverseasOrders` 10분, `refreshWisStockFxRate` 매일 07:05)가 ENABLED이고 익명 호출은 HTTP 401이다.
- 국내 시장 관리 7개: `node scripts/prepare-wispi-overseas-release.mjs prepare|preflight|verify`. 7개가 공유하는 운영 ZIP(262파일)에서 `wisStocks.js`·`wisStockCatalogSchedule.js`·`wisStockCatalogTimeline.mjs`만 커밋본으로 바꾸고 `wisStockVenues.js`·`wisStockFx.js`·`wisStockFx.mjs`·`wisStockOverseasCatalog.json`을 더한 266파일. 준비본에서 국내 시장 검사 82개를 통과했다. 배포 뒤 revision: `activatewisstockcatalogexits-00003-tif`, `activatewisstockcatalogplan-00008-dip`, `advancewisstockprices-00016-sit`, `getwisstockmanagement-00013-wep`, `savewisstock-00014-kiw`, `savewisstockmarketrules-00012-leg`, `setwisstockmarkethalted-00012-qom`(파일·자원 대조 일치).
- 전광판: `scripts/prepare-function-release.mjs`로 `wisStockDisplay.js` 블록 1개만 적용, `onwisstockmarkettradingwrite-00011-zef`. 이벤트 필터 순서가 API 응답마다 달라 `preflight`가 오탐하던 비교를 집합 비교로 고쳤다.
- 그 밖의 국내 위스피 함수(주문·체결·내역·지원금·랭킹·보고서·투자 이력)는 다시 배포하지 않았다.
- 프런트엔드: main `7e3bfde4`의 Vercel 배포 `dpl_CGo82nZazZYxPrJhnxXDThjzLV8U`를 승격했다(운영 `main-BT7JinTV.js`). 교사 화면에서 `/teacher/points?tab=stocks` → `/teacher/wispi` 이동, 독립 위스피 메뉴, 저장된 예전 위스피 바로가기 표시, 해외 시장 탭 로드를 확인했다. 학생 화면은 학생 계정이 없어 브라우저로 확인하지 못했고 규칙 에뮬레이터 검사로 대신했다.
- 학생 공개(사용자 확인 뒤, 11월 26일 22시 30분대): `환율 지금 받기`(1,000유스 = 1,345위스, 원/달러 1,345.4원·ECB 11-25 기준, 원본 API와 일치) → `해외 상장 일정 적용`(시작 2026-11-30(월) 16:00) → `해외 시장 열기`. 공개 문서 `overseas_current`(studentOpen true)·`overseas_market`(평일 16:00~23:00, 최소 잔액 0)을 확인했다.
- 교사 해외 시장 탭이 일정 적용·시장 열기/닫기 직후 `환율 미수신`으로 보이던 표시 문제(응답에 환율이 없어 화면 상태를 통째로 바꾼 탓, 환율 문서는 정상)는 `cc012893`에서 고치고 `dpl_F6mTVwoUmhZF518N8SkMjjW3tw6o`를 승격했다. 운영 청크에 수정 코드가 실린 것을 확인했고, 학생 공개 상태를 바꾸지 않기 위해 열기/닫기를 다시 눌러 보지는 않았다.

## 윷놀이 입장 속도·교사 모니터·아바타 말 (2026-11-25)

윷놀이 서버 변경은 `functions/yut.js` 한 파일이다. 운영의 윷놀이 함수들은 서로 다른 시점의 `yut.js`를 싣고 있으므로 함수마다 운영 ZIP에서 준비한다(11월 25일 확인: `commandYutRoomFast`·`commandYutRoom`은 기준 커밋에서 `getYutPublication`만 빠진 판, `getYutManagement`·`cleanupWaitingYutRooms`는 10월 27일 판, `getYutPublication`·`getYutLobby`·`saveYutSettings`는 각각 다른 이전 판).

- `node scripts/prepare-function-release.mjs prepare --name <함수> --region <리전> --file yut.js --baseline <기준 커밋> --out output/<폴더>`가 저장소의 변경 블록을 그 함수의 운영 파일에 적용하고, `preflight`·`verify`로 동시 배포와 배포 결과를 대조한다. 운영 파일이 기준과 달라 블록이 맞지 않으면 `--hunks 1,3,4,5`로 해당 함수에 필요한 블록만 적용하거나, 차이를 확인한 한 가지 운영 판에 한해 `--whole --live-sha <운영 파일 SHA-256 앞 12자리>`로 저장소 파일 전체를 싣는다. 준비 결과의 `addedToLive`·`removedFromLive`를 읽고 배포한다.
- 미국 `commandYutRoomFast`는 `action: 'lobby' | 'publication'`(입장 확인과 공개 확인을 DB 옆에서 응답), `action: 'cast'`(방 참가자의 저장된 아바타 모습), `action: 'piece'`(참가자 본인의 말 모양 선택, 교사 포함)를 받는다. 화면은 이 응답이 없거나 실패하면 기존 서울 callable과 동물 말로 돌아간다. 서울 `getYutManagement`는 읽기 전용 트랜잭션으로 바뀌어 교사 모니터가 진행 중인 판의 문서를 잠그지 않고, 응답에 방장 활동 시각을 싣는다.
- 아바타 보기는 아바타 카탈로그 모듈을 쓰지 않는다. 명령 함수의 운영 패키지에는 이전 세대 카탈로그가 들어 있어, 서버는 저장 기록의 소유자·저장 여부·형태만 확인하고 그릴 수 있는 모습인지는 화면의 그리기 코드가 판단한다.
- 배포한 것: `commandYutRoomFast`(00009 조회 응답, 00010 아바타 보기, 00014 교사 자리의 `teacher_avatars` 보기와 교사의 말 모양 선택), `getYutManagement`(00007). 00014는 준비본이 운영 `yut.js`와 차이 없이 맞았고, 배포 전 준비본 `functions`에서 `npm ci --omit=dev`를 실행했다. 서울 `commandYutRoom`·`getYutPublication`·`getYutLobby`는 동작이 같아 다시 배포하지 않았다. 되돌릴 원본은 각 준비 폴더의 `release/original.zip`이다.
- 검사: `npm --prefix functions run check`, `npm --prefix functions run test:yut-integration`, `test:yut-reward`, `functions/scripts/verify-yut-expiration.cjs`(에뮬레이터), 윷 브라우저 검사와 `scripts/verify-yut-avatar-browser.mjs`. `test:yut-integration`은 PC 부하가 클 때 같은 방에 대한 동시 명령 구간에서 `Transaction is invalid or closed`로 간헐 실패한다(변경 전 코드에서도 재현). `functions/scripts/verify-yut-network.cjs`는 변경 전에도 실패한다.

## Firestore 규칙 반영이 503으로 실패할 때 (2026-11-25)

`firebase deploy --only firestore:rules`가 배포 전 검사를 통과한 뒤 규칙 서비스의 `503 The service is currently unavailable`로 반복 실패하면 `node scripts/release-firestore-rules.mjs release`를 쓴다. `firebase.json`의 배포 전 검사 세 가지를 먼저 실행하고, 커밋된 `firestore.rules`를 컴파일·등록·연결한 뒤 운영 규칙과 커밋본을 대조한다. 503에만 재시도하며 이전 규칙 세트 ID를 출력한다. `check`는 검사와 컴파일만 한다.

## 역사교실 학생용 과제 사본 (2026-11-25)

11월 25일 반영 결과: 규칙 추가(세트 `9e64d65a`) → 서울 `executeCommand` 00052 → 2026-2학기 과제 17건의 사본 17개·배정 문서 37개, 2026-1학기 75건의 사본 75개·배정 문서 113개 생성(남은 쓰기 0) → 프론트엔드 → 과제 원본의 학생 읽기 차단(세트 `0b8ae18e`). 원본은 이제 교사·관리자만 읽는다. 원본을 서버 명령이 아닌 방법(복구 스크립트, 콘솔)으로 고쳤다면 사본 생성 스크립트를 다시 실행한다.

학생 화면은 과제 원본 `history_classrooms/{id}` 대신 서버가 함께 쓰는 두 문서를 읽는다. `history_classroom_student_views/{id}`는 원본에서 대상 학생 명단·사유·재응시 표시·작성자 필드를 뺀 사본이고, `history_classroom_assignees/{id}_{uid}`는 학생 한 명의 배정 사유와 재응시 표시만 담는다. 배정 문서는 공개·삭제 여부와 무관하게 명단에 있는 동안 존재하며, 사본 읽기 규칙은 본인 배정 문서의 존재를 확인한다. 두 문서는 클라이언트에서 쓸 수 없다.

- 서울 `executeCommand`의 과제 저장·삭제가 같은 트랜잭션에서 사본과 배정 문서를 다시 쓰고, 명단에서 빠진 학생의 배정 문서를 지운다. 학급·개별 재응시 초기화는 초기화된 학생의 배정 문서만 다시 쓴다. 배정 문서에는 쓰기 시각을 두지 않아 내용이 같은 재저장은 학생 화면을 다시 불러오게 하지 않는다. 교사 화면과 원본 문서의 내용은 바뀌지 않는다.
- 학생 목록·풀이·결과 화면은 본인 배정 문서가 있으면 사본을 읽고, 없으면 이전 경로를 그대로 쓴다.
- 운영 원본이 저장소와 다르므로 `node scripts/prepare-history-copy-release.mjs prepare`로 운영 ZIP에 `productionGateway/assessmentLifecycle.js`의 변경 블록만 적용한다. 스크립트는 변경 전후의 다른 줄이 그대로인지 비교하고, `preflight`로 동시 배포를 확인하며, 배포 뒤 `verify`로 파일별 해시를 대조한다.
- 순서: Firestore 규칙 → `executeCommand` → 기존 과제 사본 생성 → 프론트엔드. 기존 과제는 `node functions/scripts/sync-history-classroom-student-copies.cjs --semester-id <학기>`로 건수와 지문을 확인한 뒤 `--apply --expect <지문>`으로 만든다. 원본은 읽기만 하며, 적용 뒤 남은 쓰기가 있으면 실패로 끝난다. `rosterIdsWithoutDocument`가 0이 아니면 계정 식별자로 쓸 수 없는 명단 항목이 있다는 뜻이므로 원본 읽기를 닫기 전에 확인한다. 프론트엔드 승격 전후에 미리보기의 남은 쓰기가 0인지 확인한다.
- 검사: `functions/productionGateway/scripts/verify-assessment-lifecycle.cjs`, `npm --prefix functions run test:history-classroom`, `scripts/verify-history-classroom-student-copy-rules.mjs`(에뮬레이터), `functions/scripts/verify-history-classroom-student-copy-sync.cjs`(에뮬레이터), 학생 목록·풀이 브라우저 검사의 `HISTORY_CLASSROOM_STUDENT_COPY=1` 실행.

## 평가 마감 뒤 답안 변경·선지 단서 보호와 생각모아 참여 위스 (2026-11-24)

제한 시간이 지난 뒤의 답안 변경을 화면과 서버에서 막고, 제출 전 응답에서 선지별 혼동 태그를 제외한다. [원인·검증 기록](../reviews/assessment-integrity-20261124.md)을 따른다. 문제 풀이·모의고사의 시간 초과 제출이 마감 5분 이후에 도착하면 마감 전에 저장된 답안으로 채점하고 화면이 학생에게 알린다. 그 이전 도착분, 학생의 직접 제출, 역사교실 제출은 기존과 같다. 마감이 가까우면 자동 저장을 마감 0.8초 전까지 앞당긴다. 제출이 5분 넘게 전달되지 못한 학생은 교사가 기존 응시 초기화로 구제한다.

서울 `executeCommand`, `getAssessmentState` 두 함수만 배포한다. 두 함수의 운영 원본은 저장소와 다른 파일이 있으므로 `scripts/prepare-assessment-integrity-release.mjs prepare`로 각 운영 ZIP에 `productionGateway/assessmentLifecycle.js`의 검토한 치환만 적용하고, 배포본에서 운영 시점 검사와 추가 검사를 실행한다. `preflight` 뒤 함수별로 선택 배포하고 `verify`로 전체 파일 해시·자원 설정·호출 권한을 대조한다. `saveAssessmentProgress`, `getCommandStatus`, 규칙, 색인은 대상이 아니다. 화면 변경은 같은 main의 Vercel 운영 배포로 반영한다.

생각모아 세션은 대상 학급을 `targetClassId`로 저장하는데 참여 위스 확인은 `classId`만 읽어 현재 방식의 세션에서는 지급이 항상 거부되었다. 서울 `claimStudentLearningReward`가 대상 학급 필드를 우선 확인하고 이전 형식도 인정한다. 지급액·횟수·간격·중복 방지와 다른 학급 차단은 그대로다. `scripts/prepare-learning-reward-release.mjs`의 `prepare`, `preflight`, `verify` 순서로 이 함수 하나만 배포한다. 운영 QA로 학생 응답이나 위스를 만들지 않는다.

## 교사 위스피 보유 수익률의 이전 상위권 (2026-11-24)

투자 현황의 전체·선택 학급 그래프에는 해당 시점에 상위 5명에 든 학생의 기록을 남긴다. 순위 밖으로 나가면 선이 끊기고 재진입 시 새 선이 시작된다. 현재 보드에 없는 학생은 응답에서 제외한다. 개인 선택 그래프는 기존 계좌별 거래·시세 이력을 사용한다.

- 미국 `archiveWisStockRankTrace`는 학기별 `wis_stock_investment_boards/{boardId}`의 실제 변경 전후를 비교한다. 상위 5명의 키·평가액·원가가 같으면 추가 읽기·쓰기는 0건이다. 변경 시 해당 보드 아래 `rank_trace/{UTC날짜}_{revision묶음}`에 관측 시각·revision·상위 5명 값만 저장한다. 한 문서에 최대 128개 revision을 담는다. 같은 묶음이면 트랜잭션 1읽기·최대 1쓰기, 경계를 넘으면 최대 2읽기·2쓰기이며 중복 이벤트는 기존 관측을 쓰지 않는다. 학급 문서·전체 문서마다 독립적으로 적용된다.
- 기존 교사 callable `getWisStockInvestmentHistory`의 `rank-trace` 조회는 현재 세션·권한·학기·보드 범위를 확인한다. 최초에는 날짜 접두사로 선택 기간의 묶음을 16문서씩 끝까지 조회한다. 같은 범위를 갱신할 때는 마지막 서버 읽기 시각 이후 바뀐 묶음만 받아 늦게 도착한 이전 revision도 합친다. 매 페이지에서 권한용 7문서와 조회된 이력 묶음을 읽는다. 이 경로의 시세·계좌·개인 원장 조회 및 쓰기는 0건이다. 화면에서 범위를 줄일 때 같은 보드 revision의 이미 받은 기간은 재사용한다.
- 11월 24일에는 Firestore의 시점 복원(PITR)으로 보관 중인 전체 보드에서 장중 10분 간격과 자정 등을 포함한 338개 시점을 조회했다. 11월 17일 22:57:50~24일 17:50:46(한국 시각)에 생성된 서로 다른 167개 원본을 확인했다. 각 원본에서 전체와 학급별 실제 상위권만 산출해 177개 묶음을 기록하고, 전체를 다시 읽어 일치 여부를 확인했다. 이 기간 전체 순위에서 상위권에 관측된 학생은 28명이다. 표본 간 순위와 보존 기간 밖의 순위는 복원하지 않았다.

최초 배포는 기존 조회 함수 revision `getwisstockinvestmenthistory-00005-xik`의 운영 ZIP 260파일에서 시작했다. 조회 모듈·현재 운영 export 진입점에 필요한 변경만 적용하고 `wisStockRankTrace.js`를 추가했다. 이름이 같은 저장소의 다른 export까지 복사하지 않는다. 운영 이력 조회 권한과 세션 경계, 이전 조회 요청 호환, Firestore 에뮬레이터의 순위 이탈·재진입·지연 전달·중복 쓰기·학적 제외 검사를 통과한 준비본을 사용한다.

준비본에서 `firebase deploy --only "functions:getWisStockInvestmentHistory" --project history-quiz-yongsin` 및 `firebase deploy --only "functions:archiveWisStockRankTrace" --project history-quiz-yongsin`으로 선택 배포한다. 신규 Eventarc 트리거는 재시도 시 멱등성을 검증한 후 재시도 정책을 승인한다. 배포 후 `firebase functions:list --project history-quiz-yongsin`에서 두 함수의 `us-central1 ACTIVE`를 확인하고 `gcloud functions describe <함수명> --gen2 --region us-central1 --project history-quiz-yongsin`의 `buildConfig.source.storageSource`로 내려받은 ZIP을 준비본 전체 해시와 대조한다. 기존 조회 함수의 IAM·자원, 신규 트리거의 대상 경로와 익명 조회 거부도 확인한다. 11월 24일 확인한 서버 revision은 `getwisstockinvestmenthistory-00006-foc`, `archivewisstockranktrace-00001-car`이며 운영 ZIP 각 261파일이 일치했고 익명 호출은 HTTP 401이었다.

## 위스피 지갑 주문·교사용 주간 보고서 (2026-11-24)

교사는 위스피의 ‘주식 보고서’에서 주차를 선택해 시세·체결 수급·주주 수 증감·다음 주 운영 예정가를 담은 JSON을 내려받는다. 수급은 한국 시각으로 종료된 날짜까지 집계하며 작은 거래 집단은 업종, 시장 순으로 합산한다. 분석 파일의 집계 범위와 결측 표기를 확인한다. 분석은 교사가 직접 수행하고, 완성된 PDF·Markdown·UTF-8 텍스트 파일(최대 3MiB)을 미리 본 뒤 교사용으로 발행한다. 동일 주차 발행본 교체에는 최신 판본 번호가 필요하다.

운영 반영 대상은 교사 전용 `manageWisStockWeeklyReport`, `exportWisStockWeeklyReportData`, 반일 시세를 보관하는 `archiveWisStockReportPrices`와 체결 내역의 `kind, atMs` 복합 색인이다. 보관 주기는 한국 시각 00:03·12:03이며 시장 가격과 주문 원장은 기존 경로에서 운영한다. 학생의 직접 접근 차단, 파일 분할·재시도·동시 발행, 자료 조회 커서, 채워지지 않은 과거 구간 표시를 점검한다. QA에서 학생의 실제 주문을 접수하거나 실제 주차에 예시 보고서를 발행하지 않는다.

최초 배포 기준은 `getwisstockmanagement-00012-yed`의 운영 ZIP 262개 파일이다. `advancewisstockprices-00015-bep`와 파일별 해시가 일치했다. 이 원본에 보고서 모듈 세 파일, 진입점 등록과 기존 시세 함수의 모듈 내보내기만 적용해 265개 파일을 준비한다. 후속 배포 시에는 해당 보고서 함수의 현재 운영 원본과 변경 목록을 다시 대조한다. `us-central1` 함수 세 개와 단일 색인만 지정하고 운영 ZIP, IAM, 스케줄러 및 색인의 READY 상태를 확인한다.

## 위스피 10분 시세와 6주 기획안 (2026-11-24)

교사 위스피의 ‘주식 차트 관리 → 6주 기획안’에서 특별장 일정을 확인한다. 2026년 12월 16일 ‘검은 화요일’은 전 거래일 종가의 80%로 마감한다. 12월 23일과 24일 ‘크리스마스 랠리’는 매일 직전 종가에서 10% 이상 상승하도록 계산한다. 1위스 단위 시세이므로 하락 목표는 반올림하고 상승 목표는 올림한다. 거래 정지와 졸업 상태는 유지한다. 종목의 ‘운영 예정 시세’에서 현재 운영 설정에 따른 10분별 예상 가격을 확인한다.

한국 시각 10분 경계에 시세 작업을 실행한다. 공개된 시장의 평일 08~18시 설정에서는 하루 예정 회차가 20회에서 60회로 늘어난다. 스케줄러는 장외도 포함해 하루 144회 호출되며, 동일 구간 재시도와 휴장 회차는 시세를 기록하지 않는다. 통상 가격이 바뀌는 회차에는 시장과 학기 확인에 문서 4개를 읽고 비공개 시장과 학생 공개 시세를 각각 한 번 쓴다. 전광판·보유량별 평가 갱신과 공개 시세 구독의 읽기·쓰기는 별도로 발생한다. 교사 예정가 조회는 권한과 학기를 확인한 뒤 현재 시장에서 계산하며, 종목·시각별로 Firestore 문서를 생성하지 않는다.

배포 전 Functions와 앱 기본 검사, 주식 거래·권한 에뮬레이터, 10% 속보 경계, 교사 6주 특별장 세 날짜와 예정가 브라우저 검사를 수행한다. 변경 함수는 각 운영 원본에서 준비하고 Scheduler 시간대·주기와 서비스 설정을 대조한다. 운영 도메인 승격 후 교사 화면에서 일정과 예정가를 확인한다.

11월 24일 운영 스냅샷을 이용한 읽기 전용 모의 실행에서 12월 16일 46개, 23일과 24일 각 55개 거래 대상 종목이 종가 목표를 달성했다. 이 숫자는 해당 시점의 상장·졸업 일정과 시장 설정 기준이다. 스케줄러에 1~17초 지연을 준 77종목 52,824개 예상 가격이 독립 실행 결과와 일치했다. 일반 거래일 종목별 일봉 812개 중 773개에 장중 가격에 따른 꼬리가 생겼다. 운영 구성의 첫 예측은 Node 22 로컬에서 3.3~5.1초였고 같은 기준 시세로 다른 종목을 조회하면 약 5ms였다. 합성 최대 규모(100종목·42일·24시간)의 첫 예측은 약 21초였다. [해외 모의시장 환율·비용 검토](../reviews/wispi-overseas-fx-20261124.md)

## 명예의 전당·수신 알림·소리 복구 (2026-11-24)

학생 명예의 전당 누적 조회의 `hall-index` 검증을 복구하고 교사 수신 토스트 기본 5초/설정 1~60초, 전광판 80%·3초·수동 닫기와 소리, 리듬게임 음소거 분리·시작 중 음량 반영을 제공한다. [검증 기록](../reviews/hall-notification-audio-20261124.md)을 따른다. `prepare-wis-hall-repair-release.mjs prepare/preflight`의 운영 원본 준비본에서 `getWisRankingPreview`만 배포하고 `verify`로 전체 파일·자원·IAM을 대조한다. 앱과 Functions 기본 검사를 통과한 같은 main의 Vercel Ready 배포를 운영 도메인에 승격한다. rules·게임 공개·학생 자산·알림 읽음 상태는 QA로 변경하지 않는다.

## 위스피 기획안·종료 일정·전광판 (2026-11-23 후속)

등록 종목은 6주 보기에서도 운영 이력을 사용하고 미상장 모의 시세만 저장된 규칙으로 로컬 계산한다. 기획안 종료일은 별도 활성화 명령으로 연결하며 지난 5종목은 11월 24일 기존 시각으로 연장한다. 원본 catalogPlan v1을 보존하고 catalogExits를 별도로 저장해 기존 거래·정산 worker 호환을 유지한다. [구현·검증·비용 기록](../reviews/wispi-lifecycle-alerts-20261123.md)을 따른다. `prepare-wispi-lifecycle-release.mjs`로 운영 원본을 보존하고 기존 관리 6함수와 신규 activateWisStockCatalogExits만 선택 배포·대조한다. 동일 main의 Vercel 운영 반영 후 교사 화면에서 대상·시각을 확인해 종료 일정을 적용한다. 운영 QA로 학생 정산을 미리 실행하지 않는다.

전광판 속보는 사건의 30분 구간 안에서 10분 간격으로만 재생한다. 알림음·한국어 음성은 독립 설정이며 학생 정보는 음성 합성기에 보내지 않는다. 추가 서버 폴링·구독·스케줄러를 만들지 않는다.

## 위스피 신규 상장가와 전광판 (2026-11-23)

교사 등록과 예약 상장은 종목당 100~500위스 범위에서 첫 가격을 정한다. 직접 등록에서 최저가·최고가를 좁히면 두 범위가 겹치는 가격만 적용한다. 추첨은 학기의 시장 시드와 종목 ID를 사용하며 첫 시세와 영수증을 기존 트랜잭션에 저장한다. 운영 반영 대상은 `saveWisStock`, `activateWisStockCatalogPlan`, `setWisStockMarketHalted`, `advanceWisStockPrices`다. 네 함수의 운영 소스에 `wisStocks.js`와 `wisStockCatalogSchedule.js` 변경을 적용하고 30분 Scheduler 설정을 대조한다.

교사 전광판 가운데의 속보 팝업은 시세 문서에 담긴 관측 시각·직전 시세·비교 기준가·상장 시각으로 급등락과 신규 상장을 순차 표시한다. `onWisStockMarketTradingWrite`의 운영 소스에서 `wisStockDisplay.js`를 갱신한다. `npm run test:wispi-trading`과 `node scripts/verify-wis-stock-investment-board-browser.mjs`에서 시세 생성, 팝업 전환, 구독 횟수를 확인한다.

## 학생 위스피 거래 인증 (2026-11-23)

학생의 매수·매도·주문 취소·주식 지갑 입출금·지원금 수령은 로그인 시각이 오래됐어도 유효한 일반 세션으로 처리한다. 학생 클라이언트는 App Check와 현재 계정·학기의 세션 증명을 사용한다. 서버는 학생 본인과 세션 유효성, 학적, 시장 공개·거래 조건을 검사한다. 중복 클릭이나 응답 유실 후 재시도의 주문 번호와 원래 견적은 유지한다. `npm run verify:wispi-client`와 `npm run test:wispi-trading`으로 확인하고 학생 화면 변경은 Vercel로 배포한다.

## 위스피 30분 시세 (2026-11-23)

자동 시세는 교사가 설정한 거래 요일과 시간 안에서 한국 시각 정각·30분에 갱신한다. 구형 종목의 `intervalHours`는 기존 거래 함수와 영수증의 호환을 위해 유지한다. 가격 계산에는 모든 자동 종목이 같은 30분 주기를 사용한다. 기존 6주 상장 일정은 종목별 예정 시각을 따른다.

일정 작업은 현재 학기 설정과 시장을 한 번씩 읽고, 실제 변경이 있을 때만 같은 트랜잭션에서 활성 학기 포인터와 명세를 추가 확인한다. 일반 시세 변경은 총 4읽기이며 공개 시장에서는 시장 원본과 학생용 시세에 2쓰기다. 상장 회차에는 감사 영수증이 추가된다. 휴장과 같은 회차 재처리는 2읽기·0쓰기, 이전 회차의 지연 전달은 0읽기·0쓰기다. 기본 평일 09–16시에 모든 회차가 변동되면 일정 작업은 하루 124읽기다. 구독 화면의 수신, 투자 현황 재평가, 오류·경합 재시도는 별도로 집계한다. 투자 현황은 변동 종목 ID를 30개씩 묶어 보유 문서를 조회하며 빈 묶음도 1읽기로 센다.

배포 시 기존 주식 관리 함수 5개와 `advanceWisStockPrices`에 운영 시세 함수의 소스를 기준으로 변경을 적용한다. `onWisStockMarketTradingWrite`는 별도 운영 원본에서 투자 현황 조회 부분만 변경한다. `npm run test:wispi-trading`은 61종목 중 보유 문서가 하나일 때 투자 현황 트리거의 7읽기와 중복 전달 시 4읽기·0쓰기를 검사한다. 배포 후 기존 Scheduler 작업의 `0,30 * * * *`, `Asia/Seoul`, `ENABLED`와 다음 정규 회차를 확인한다.

## 위스피 메뉴·지갑·페이지 랭킹 (2026-11-23)

학생 메뉴 순서와 하단 마이페이지, 사이트맵 순서 편집·포털 배지, 본인 지갑 좌우 배치와 교사/학생 목록 내부 더보기를 제공한다. 랭킹은 전날 기준 전체50/학급 투자자 전원을 10명씩 서버 커서 조회하며 기본5명·선택 개인 그래프만 제공한다. [지갑·랭킹 검증](../reviews/wispi-wallet-ranking-20261123.md)과 [메뉴 검증](../reviews/menu-order-20261123.md)을 따른다. 신규 AI·외부 전송은 없으며 기존 게임 공개 설정은 유지한다.

`prepare-wispi-ranking-pages-release.mjs`로 운영 원본을 보존한 준비본의 `getStudentWisStockRanking,publishWisStockDailyRanking` 두 함수만 배포한다. `operate-wispi-ranking-release.mjs index`로 단일 학급/순위 인덱스 READY를 확인한 뒤 서버를 배포하고, 원본·자원·IAM 대조 후 `refresh`로 기존 집계 작업을 한 번 실행한다. 현재 학기 파생 랭킹만 새 스키마로 갱신하며 계좌/거래를 고치지 않는다. 같은 main 커밋의 Vercel Ready 배포를 운영 도메인에 승격한다. 기존 무필터5명/순위 상세 요청 호환을 유지하므로 먼저 열어 둔 화면도 전환 중 사용할 수 있다.

## 핵심포인트 수령 복구·이순신 입력 (2026-11-23)

전체 진행 조회 실패의 수동 재시도와 지급 확정 상태를 유지하고, 이순신의 키보드 축소 화면·만료 키워드 입력을 고친다. [검증 기록](../reviews/lesson-reward-naval-input-20261123.md)을 따른다. 핵심포인트 최신 자료의 숫자형 수정 시각은 화면 조회와 동일하게 해석한다. `prepare-core-point-reward-release.mjs before`를 통과한 운영 원본 준비본의 `executeLessonCorePointCommand` 하나만 배포하고 `after`로 전체 소스·자원·환경·IAM을 대조한다. 같은 main의 Vercel 배포를 승격하고 지정 Chrome 프로필에서 교사 체험을 확인한다. 보상은 기존 학기당 1회 500위스이며, 소급 확인은 `repair-lesson-core-point-rewards.mjs`의 현재 학기 읽기 전용 계획에서 기존 지급·환수와 미완료를 구분한다. 이 도구는 지급하지 않으며 개인별 계획은 Git 제외 경로에 보관한다. Functions 전체·rules·학생 공개 상태는 변경하지 않는다.

## 위스피 교사 전광판과 학생 투자 랭킹 (2026-11-21)

교사 전광판에는 표시용 시세와 선택 학급의 최근 자발적 체결 최대 20건을 제공한다. `scripts/prepare-wispi-display-release.mjs prepare`가 기존 운영 소스를 보존한 세 함수의 배포 경로를 만든다. 해당 경로에서 대상 함수만 배포한 뒤 `verify`로 소스와 런타임을 대조한다. 전광판 규칙과 `wis_stock_display_trades`의 학급별 시각 내림차순 색인을 반영한다. 첫 설치 때는 `node scripts/bootstrap-wispi-exchange.cjs`로 대상 건수를 확인하고 `--apply`로 시세와 최근 체결을 채운다. 재실행 시 기존 체결을 건너뛴다.

학생 랭킹은 `publishWisStockDailyRanking`이 매일 한국 시각 00:02에 전날 23:59의 Firestore 자료로 집계한다. 첫 배포나 당일 복구 시 같은 Scheduler 작업을 한 번 실행한다. `getStudentWisStockRanking`은 현재 학기와 학적, 시장 공개 상태를 확인한 뒤 전날 상위 5명의 실명·수익률과 선택한 순위의 그래프·보유 종목을 제공한다. 2026-11-21 운영 담당 교사가 이 학교의 로그인 학생에게 해당 범위를 공개할 수 있음을 확인했다. 외부 전송 서비스나 AI 호출은 추가하지 않았다.

## 유휴 함수 비용과 조회 범위 (2026-11-21)

운영 미국 리전의 `commandYutRoomFast`, `executeWisCommandFast`, `getWisRankingPreview`는 최소 인스턴스 0개다. 한동안 사용하지 않은 뒤 첫 요청이 느려질 수 있다. 이전 운영 ZIP을 보존해 배포할 때에도 이 세 함수의 최소 인스턴스 수를 확인한다. 변경 당시 `scripts/prepare-standby-cost-release.mjs`의 `prepare`, `preflight`, `verify` 순서로 최신 운영 원본, 대상 함수의 단일 설정 변경, 배포 후 전체 파일과 런타임을 대조했다.

서울 `getQuizClassAnalysis`는 선택 학급과 계산에 필요한 버전만 확인한다. `getStudentVisibleLessons`의 핵심포인트 목록은 공개 범위를 검증한 뒤 단원과 표시 ID만 돌려준다. 기존 진도 요청과 구형 응답을 계속 처리한다. 새 프론트엔드는 동일 학기의 선택 반 점수, 점수 관리자의 접근 권한, 모의고사 재조회 실패·복구, 게임 목록 재진입과 유료 게임 복원을 검증하고 운영에 반영한다.

## 누적 위스 등급 연동 (2026-11-21)

등급·이모지·아바타 해금은 화면의 현재 학기 canonical `earnedTotal`을 사용한다. 초기 지급을 포함하고 지출·주식 반환 원금은 누적을 늘리지 않으며, 누적에 이미 확정된 출금 수익은 같은 기준에 반영한다. 과거 `rankEarnedTotal` 원장 의미는 보존하고 재집계·계좌 보정은 하지 않는다. [원인과 검증 기록](../reviews/wis-rank-cumulative-20261121.md)을 따른다. `prepare-wis-rank-cumulative-release.mjs`의 운영 원본 준비본과 `verify-wis-rank-cumulative-release.mjs`를 검증하고 대상 12함수만 선택 배포한다. 전체 소스·자원·권한·이벤트 보존 확인 후 같은 main의 Vercel 배포를 승격하고 운영 왕실 배지를 확인한다. 새 공개 `earnedTotal`을 제공하는 서버를 프런트엔드보다 먼저 반영한다.

## 위스피 지원금 직접 받기 (2026-11-18)

누적 500위스 입금 조건과 기존 수령 영수증을 유지하고 학생이 지갑의 `500위스 받기`를 눌렀을 때만 지급한다. 입금 자동 지급과 운영자 backfill은 중단한다. [변경과 검증 기록](../reviews/wispi-bonus-claim-20261118.md)을 따른다. `prepare-wispi-bonus-claim-release.mjs`에서 보존한 운영 원본에 최소 delta를 적용해 기존 `transferStudentWisStock`과 신규 `getStudentWisStockBonus`, `claimStudentWisStockBonus`만 배포한다. 실제 준비본 에뮬레이터·Functions 검사와 앱 빌드 후 소스·자원·인증 차단을 재검증하고 같은 main의 Vercel 배포를 운영 도메인으로 승격한다. 지갑 입출금 행과 학생 플로팅 메뉴의 배경 흐림도 함께 확인한다. 캠페인 기준·설정·rules·학생 잔액을 운영 검증으로 변경하지 않는다.

## 위스피 지원금 계좌 조회 복구 (2026-11-18)

지원금 제한 계좌의 `schemaVersion: 2`도 본인 실시간 조회에 허용한다. 일반 지갑·본인·학기·세션·학적 검사와 목록·쓰기 차단은 유지한다. [원인과 회귀 검사](../reviews/wispi-account-access-20261118.md)를 따른다. 운영 rules 원본을 저장소와 대조하고 `npm run test:wispi-access`, 앱 빌드, 기존 Firestore predeploy 검사를 통과한 뒤 Firestore rules만 배포한다. 배포 후 운영 rules 전체 SHA를 다시 대조한다. Functions·계좌·잔액·거래·공개 상태는 변경하지 않는다.

## 위플레이 주간 보상·리듬 도전·윷 개선 (2026-11-17)

게임별 주간 전체 랭킹 구간 보상, 실명/학번 정렬, 윷 확률·진행 최적화와 전체화면, 리듬 피버와 하루 3회 무료·추가 50위스 도전을 제공한다. [검증과 운영 절차](../reviews/weplay-update-20261117.md)를 따른다. `prepare-weplay-update-release.mjs`의 운영 원본 보존 준비본에서 기존 랭킹 3개·윷 명령 2개와 신규 도전 설정 2개·주간 보상 3개만 선택 배포한다. 실제 준비본 통합 검사와 앱/Functions 기본 검사를 통과하고 `--verify`의 파일·자원 일치를 확인한다. 공개 상태·운영 보상 정책·학생 위스나 점수는 QA로 변경하지 않는다. 같은 main 커밋을 Vercel 운영에 승격한 뒤 지정 Chrome 프로필에서 확인한다.

## 위스피 6주 상장 일정 연결 (2026-11-16)

기존 80개 기획 종목의 상장 시각을 현재 학기의 서버 일정으로 연결한다. 교사의 `상장 일정 적용`은 인증·권한·학기·revision·영수증을 검사하고, 도래분만 시장·학생 공개 가격·감사 기록에 함께 반영한다. 기존 종목과 학생 계좌는 보존하며 합병·퇴장 시나리오는 실행하지 않는다. [상장 일정 검증 기록](../reviews/wis-stock-schedule-20261116.md)을 따른다. `prepare-wis-stock-schedule-release.mjs`가 보존한 운영 원본에서 기존 주식 5함수와 신규 `activateWisStockCatalogPlan`만 배포하고 `verify-wis-stock-schedule-release.mjs --after`로 전체 소스·자원·정각 scheduler를 확인한다. 프론트엔드의 같은 main 커밋을 운영에 승격한 뒤 교사 화면에서 사용자가 승인한 2026-11-16 09:00 KST 시작 일정을 적용한다. 다른 진행 중인 위플레이·아바타 변경을 이 배포에 섞지 않는다.

## 정기시험 원안지 저장 권한 복구 (2026-11-15 후속)

Storage 규칙의 Firestore 두 문서 조회 한도를 넘던 업로드·읽기·실패 정리를 전용 서버 함수로 옮긴다. [복구 기록](../reviews/written-exam-storage-repair-20261115.md)에 권한·분할 전송·cleanup 게시 차단을 구분한다. 운영 보안 helper를 보존한 `prepare-written-exam-assets-release.mjs`의 신규 `manageWrittenExamAsset` 하나만 배포하고, `verify-written-exam-assets-release.mjs`로 전체 소스와 익명 차단을 확인한다. 실제 규칙 검사 후 Firestore cleanup 삭제 경계와 Storage 직접 차단을 반영한다. 같은 main의 Vercel 배포를 승격하고 실제 원안지 등록·문항 이미지 열람까지 확인한다. 학생 성적·서명·이의 상태는 검증 목적으로 변경하지 않는다.

## 정기시험 파일 업로드 복구 (2026-11-15)

실제 학급별 XLSX의 잘못된 사용 범위와 B열 식별자를 읽고, 문항정보표의 인쇄 구조와 원안지의 공통 지문을 지원한다. 업로드 하위 탭·기록 필터·자료 등록의 오류/진행 상태를 함께 고친다. [검증 기록](../reviews/written-exam-upload-repair-20261115.md)에 실제 파일 및 합성 브라우저·Firestore/Storage 에뮬레이터 범위를 구분한다. 기본 빌드·포맷·기존 점수 요청 rules 검사를 통과한 main의 Vercel 배포를 승격한다. Functions와 rules는 바꾸지 않으며 운영 QA에서 기존 학생 성적·서명·이의 상태를 변경하지 않는다.

## 아바타 접수 연결·신문고 북 버튼 (2026-11-15)

현재 학기와 평생 참여 기록의 집계는 0건이며, 운영 서버 소스의 에뮬레이터 검사에서 학생 접수→교사 전체/대기 목록·알림→수동 100위스 지급이 정상 연결됨을 확인했다. 클라이언트 공개 상태 구독 오류에서 사라지던 진입점에 재시도를 제공하고 학생·교사 보내기 버튼을 공통 북면 SVG로 바꾼다. [점검 기록](../reviews/avatar-gongsin-link-20261115.md)을 따른다. Functions 실행 소스와 rules는 변경하지 않으므로 Firebase 재배포는 하지 않는다. 앱 빌드와 합성 접수·보상·반응형 검증 후 같은 main 커밋의 Vercel 배포를 승격하고, 운영에서는 실제 학생 접수·보상을 생성하지 않은 채 버튼과 기존 빈 목록을 확인한다.

## 위스 마을 목차 레이아웃 정정 (2026-11-15)

사이드탭은 유지하되 평가 관리와 같은 공통 전높이 목차 구조로 바꾸고, 교사 아바타 종류의 가로 스크롤을 줄바꿈으로 제거한다. [수정 기록](../reviews/wispi-layout-fix-20261115.md)을 따른다. 앱 빌드·전체 레이아웃과 아바타 회귀 검증 후 Vercel main의 같은 커밋만 운영에 승격한다. 데이터/권한/Functions/rules 변경은 없으므로 Firebase를 재배포하지 않는다.

## 위스 마을 사이드 메뉴·학생 투자 현황 (2026-11-15)

교사 위스 마을만 좁은 사이드 메뉴로 바꾸고 위스피에 학생 투자 현황 탭을 추가한다. 현재 실제 학생 투자 원장이 없으므로 운영에서는 연결 전 상태를 표시한다. 상세 회계·조회·권한 경계와 후속 원장 작성 계약은 [점검 기록](../reviews/wispi-board-20261115.md)을 따른다. 학생 거래나 공개 상태를 바꾸지 않는다.

운영 rules를 기준 소스와 대조한 후 보드 projection의 교사 get 및 본인의 현재 로그인 세션 get만 배포한다. 전광판은 두 문서 구독을 사용하며 미사용 탭·숨긴 화면에서는 해제한다. 실행 Functions 변경은 없으므로 Functions 전체 배포를 하지 않는다. 기본 빌드와 보드 단위/브라우저/실제 rules 검사, 기존 점수 요청 rules 검사를 통과한 main의 Vercel 배포를 승격한다. 운영 학생 원장이나 예시 projection을 만들지 않고 실제 교사 화면에서 연결 전 상태와 메뉴만 검증한다.

## 위스피 6주 기획안·가격 모델 (2026-11-14)

시장 규칙의 조밀한 수치 행, 조선 후기 상인과 상시 가치 종목을 포함한 80개 개별 초안·로고, 실제 이력과 분리한 6주 합성 로드맵을 제공한다. 학생 입출금·매매는 계속 비공개이며 이번 패치로 실매매 API를 추가하지 않는다. 가격 모형·서킷 재개·미래 이력 용량 예산과 검증 한계는 [위스피 시장 점검 기록](../reviews/wispi-market-20261114.md)을 따른다.

`scripts/prepare-wispi-market-release.mjs`로 운영5함수의 원본247파일을 보존하고 `wisStocks.js` 하나를 교체하며 `wisStockPriceModel.js/.mjs`만 추가한다. 준비본 manifest의 정확한5함수 선택배포 후 `node scripts/verify-wispi-market-release.mjs --after`로 전체249파일과 자원을 대조한다. 스케줄러 최대 인스턴스1과 callable10을 구분해 보존한다. 운영 지갑·종목·시장 규칙을 시험 목적으로 수정하지 않는다. 프런트엔드는 같은 main의 Ready 배포를 승격하고 실제 운영 도메인에서 확인한다.

## 위스 마을·위스피 비상 정지 (2026-11-14 후속)

위스 마을의 교사 메뉴는 위스 상점·아바타 상점·위스피(WsPI)로 묶고 기존 상품/구매 요청/아바타/주식 URL과 권한은 유지한다. 학생 위스피 메뉴와 실제 매매는 계속 비공개다. 아바타 관리의 유형 선택과 학생 상점 미리보기 탭은 같은 로컬 초안·카탈로그를 사용하며 전환 시 추가 조회나 구매·저장을 하지 않는다. 주식 차트도 이미 받은 history에서 축·격자·시각/가격 말풍선을 계산한다.

`setWisStockMarketHalted`는 현재 학기·관리 권한·세션을 다시 검사하고 시장의 정지 flag와 revision, 수정 시각 및 명령 영수증만 원자적으로 갱신한다. 정지는 오래된 revision으로도 실행하고, 이미 정지 중이어도 새로운 정지 요청은 revision을 증가시켜 먼저 시작된 재개 요청을 무효화한다. 재개는 확인한 revision과 일치해야 한다. 일반 규칙 저장은 구형 클라이언트가 전달한 halted 값도 무시하고 현재 서버 flag를 유지한다. 실변경과 새 비상 정지 요청은 6읽기/2쓰기, 동일 요청 영수증의 재시도와 이미 재개된 시장의 무변경 재개는 0쓰기이며 지갑·원장을 읽거나 쓰지 않는다. 오래된 응답은 현재 UI revision을 되돌릴 수 없다. 정지는 별도 busy 상태로 다른 저장 중에도 실행 가능하다.

`scripts/prepare-wispi-village-release.mjs`는 현재 운영의 주식 함수 4개 ZIP을 보존하고 검토된 `wisStocks.js`만 이식하며 독립 진입점에 비상 정지 함수 하나만 추가한다. 준비본의 5개 함수만 선택 배포한다. `scripts/verify-wis-release-runtime.mjs --release-dir=output/wispi-village-20261114/release --after` 및 `scripts/verify-wispi-village-release.mjs`로 배포 소스·ACTIVE·기존 자원 설정 보존을 대조한다. 프런트엔드는 같은 변경을 포함한 main의 Ready 배포를 운영 도메인으로 승격한다. 운영 화면 점검을 위해 실제 시장 정지/재개·상품 저장·지갑 변동을 실행하지 않는다.

## 위스 주식 시장 규칙과 교사 미리보기 (2026-11-14)

학생 서비스는 닫힌 상태로 유지한다. 교사 종목 관리·시장 규칙 저장과 시세 계산만 서버에 연결하며, 학생 화면의 주문 미리보기는 합성 현금·보유량을 사용하는 로컬 체험이다. 실제 지갑·보유 주식·거래 원장을 쓰는 학생 매매 API는 추가하지 않는다. 향후 매매에는 서버 가격·규칙·유통 잔여량·지갑·보유 원가·일일 누계·중복 요청 영수증을 같은 트랜잭션에서 검사하는 별도 검증이 필요하다. 매도 원금과 실현 손익을 일반 지급으로 합산하지 않는다.

주문 계약은 교사 시장이 공급·환매하는 방식이다. 접수 시 확인한 가격·수수료·수량을 고정하고, 매수 대금과 시장 공급 수량 또는 매도 보유 수량을 예약한 뒤 5~60초 무작위 대기 후 체결한다. 접수 후 시세·규칙 revision 변경이나 견적 유효 시간 경과로 금액을 바꾸지 않는다. 장마감은 새 주문만 막고 이미 접수한 주문은 처리한다. 시장·종목 거래 정지 등 집행이 금지되면 취소하여 예약만 한 번 해제한다. 실제 서비스의 시각과 난수는 서버가 결정해야 하며, 교사 미리보기의 브라우저 시각·난수·입력을 실제 거래 승인으로 사용하지 않는다. 미리보기의 초 단위 표시는 로컬 타이머이며 서버 폴링을 추가하지 않는다.

주식 전용 계좌는 일반 지갑과 분리한다. 입금은 **입금 직전 일반 지갑의 현재 위스의 50%(정수 내림)**까지이며 주식 계좌 현금·보유 주식 원가·평가손익을 더하지 않는다. 입금 성공 후 24시간은 추가 입금을 막고, 이후 그때의 일반 지갑 잔액을 기준으로 한도를 다시 계산한다. 출금이나 주문 취소로 입금 대기 시간을 초기화하지 않는다. 실패·중복 요청은 대기 시간을 새로 시작하지 않는다. 주식 계좌 내부의 매매·실현 손익은 일반 지갑의 현재·누적 위스와 순위에 반영하지 않고, 출금 시 일반 지갑에 반영한다. 예약 현금은 계좌 현금에 이미 포함되므로 중복 합산하지 않으며 출금은 예약되지 않은 현금만 허용한다. 현재 입출금 체험은 합성 계좌에만 적용하며 운영 학생 계좌를 생성하지 않는다.

출금은 전액을 일반 지갑 현재 위스에 더하고, 아직 회수하지 않은 입금 원금을 먼저 제외한 수익만 누적 위스에 더한다. 입금은 미회수 원금을 늘리고 출금은 반환한 원금만큼 줄인다. 주식 매매 자체는 일반 획득·등급을 올리지 않는다. 손실 후 잔액이 0이 되어도 미회수 원금 이력은 초기화하지 않아 이후 손실 회복을 중복 수익으로 집계하지 않는다. 출금 수익의 등급 적립은 0이며, 누적 위스 순위에는 일반 획득 누계의 실제 증가분으로 반영한다. 실제 서비스에는 이체·예약·체결·취소·출금의 전용 원장과 원자적 영수증 기록이 별도로 필요하다.

신규 시장과 실제 설정 변경에는 서버 전용 시세 seed를 원자적으로 저장하고 응답에서 제외한다. seed 없는 과거 시장의 읽기·무변경 저장에는 마이그레이션 쓰기를 끼워 넣지 않는다. **향후 학생 공개 전에는 모든 시장의 비공개 seed 존재 및 실제 거래 원장 통합 검증을 별도로 통과해야 한다.** 현재의 로컬 견적 검증은 실제 매매 출시 검증을 대신하지 않는다.

`scripts/prepare-wis-stock-market-release.mjs`는 미국 `getWisStockManagement`, `saveWisStock`, `advanceWisStockPrices`의 최신 운영 ZIP을 각각 보존하고 검토한 주식 모듈 및 공유 계산 모듈만 이식한다. 기존 독립 진입점에는 `saveWisStockMarketRules` 하나만 추가한다. 다른 함수·지갑 writer·rules·최소 인스턴스는 변경하지 않는다. 준비본 검증 후 위 네 함수만 선택 배포하고 `scripts/verify-wis-release-runtime.mjs --release-dir=output/wis-stock-market-20261114/release --after`로 기존 세 함수의 소스와 자원 설정을 대조한다. 신규 규칙 저장 함수도 배포 ZIP·ACTIVE·리전·최소 0/최대 10개 인스턴스를 따로 확인한다.

기본 앱/Functions 검사, 주식 단위 검사, `firebase.wis-stocks-test.json` 실제 Firestore 권한·동시성 검사와 주식 브라우저 검증을 사용한다. 동일 main 커밋의 Vercel Ready 배포를 운영 도메인으로 승격하고 `방재석` Chrome 프로필에서 세 탭과 로컬 미리보기를 확인한다. 운영 검증을 위해 종목·시장 규칙·학생 잔액을 임의 생성하거나 수정하지 않는다. 외부 AI 호출·시세 서비스·개인정보 전송을 추가하지 않는다.

## 목차·명단·자동저장 통신 (2026-11-10)

교사 목차는 계정·인증 세대·권한·학기별 메모리 30초 재사용과 저장 후 무효화를 적용한다. 명단과 모의고사 상태/자동저장은 진행 중인 동일 요청만 공유한다. 필요한 필드 projection은 전송량 감소이며 문서 읽기 수 감소로 계산하지 않는다. [통신 점검 기록](../reviews/communication-performance-20261110.md)의 비용 경계와 에뮬레이터 동시 시작 검사 한계를 함께 확인한다.

신규 미국 `getTeacherStudentRoster`만 루트에서 선택 배포한다. 서울 `saveAssessmentProgress`는 운영 archive를 별도 디렉터리에 복원하고 SAVE projection 세 구간만 이식한 배포본을 사용한다. 현재 gateway 전체를 운영 원본에 덮어쓰지 않는다. 배포본 자체의 읽기 예산/30명 동시 자동저장 검사 후 해당 함수만 선택 배포하며 실제 런타임 설정을 전후 대조한다. 앱/Functions/성적 요청 rules 검사를 통과한 프론트엔드는 같은 main 커밋의 Vercel 배포를 Production으로 승격한다. 로그인한 운영 화면 확인과 배포 산출물 확인을 구별해 보고한다.

## HTML·이미지 입력 보안 유지보수 (2026-11-10)

HTML 표시 경계·호환 의존성·브라우저 헤더를 보완하고 SVG가 native 이미지 파서에 들어가기 전에 실제 파일 헤더를 검사한다. 저장된 원문·학생 답안·점수·서명·공개 상태·서버 권한을 변경하지 않는다. [보안 점검 기록](../reviews/security-maintenance-20261110.md)과 [의존성 잔여 경고](../reviews/security-dependencies-20261110.md)를 함께 확인한다.

수업자료 업로드 등 운영 원본과 저장소에 기존 차이가 있으므로 `scripts/prepare-security-image-release.mjs`로 함수별 원본에 최소 패치만 이식한다. 변경 없는 exports·의존성·권한·런타임의 SHA를 확인하고 `node functions/scripts/verify-raster-image-safety.cjs --release`를 통과한 준비본만 대상 함수별 `--only`로 배포한다. 대상은 서울 `uploadMapAssetContent`, `uploadSourceArchiveAsset`, `registerSchoolBanner`, `processSourceArchiveIncomingUpload`, `processLessonAssetUpload`, `uploadLessonAssetContent`다. 전체 Functions·rules를 재배포하지 않는다. 프런트엔드는 최신 main 통합·빌드 후 해당 Vercel 배포를 운영 도메인에 승격한다.

**운영 원본 코드 보존만으로 외부 자원 설정까지 보존되지는 않는다.** 위 배포에서 앞의 세 callable과 `processSourceArchiveIncomingUpload`의 기존 최대 인스턴스 20이 소스에 선언돼 있지 않아 배포 직후 상한이 빠졌다. Cloud Functions v2의 `serviceConfig.maxInstanceCount` 필드만 PATCH하여 20으로 복원했고, 6개 함수 모두 배포 전 메모리·CPU·동시성·시간 제한·최대 인스턴스·서비스 계정·인바운드 설정과 일치함을 다시 확인했다. 향후 원본 기반 선택 배포에도 배포 전 실제 설정 스냅샷과 배포 후 대조를 포함하며, 차이를 코드 원본의 의도라고 추측해 두지 않는다.

## 학생 시험 시작 경합과 재진입 복구 (2026-11-10)

13:35–13:37 KST의 운영 START 오류는 본인 응시 이력 조회에서 발생한 트랜잭션 경합이다. `semester_assessment_attempts`에 `studentUid ASC, definitionId ASC` 복합 색인을 한 개만 추가한다. 기존 쿼리의 운영 Explain이 단일 복합 색인을 선택하는 것을 확인했으므로 Functions 코드·런타임·규칙은 변경하지 않는다. 다른 색인을 삭제하는 전체 동기화는 사용하지 않는다.

프론트엔드는 같은 계정·로그인 시점의 진행 중인 START를 공유하고, 일시적 응답 유실 뒤에도 해당 명령 영수증으로 복구한다. 재시도는 현재 응시를 재조회하며, 만료된 화면에서 늦게 새 시작 요청을 전송하지 않는다. 원답·서버 제한 시간·권한은 유지한다. 검증한 Vercel main 커밋을 운영 도메인에 승격하고 실제 반영을 확인한다. 원인 근거와 에뮬레이터 한계는 [재진입 오류 검토](../reviews/exam-entry-contention-20261110.md)를 따른다.

## 서버 조회·기록량 최적화 (2026-11-10)

현재 화면에 필요한 정보만 읽고 같은 정보를 반복 기록하지 않는다. 윷 공개 확인·생각모아에 전용 읽기를 추가하고, 수업자료/선택 단원 출제/출석 이력의 범위를 줄인다. 역사교실의 이미 확인된 답안 재저장과 분석/이모지 trigger의 중복 작업도 생략한다. 전체 분석·집계, 공개 차단·세션·학기·보상/답안의 복구 경계는 보존한다. 병행 시험 진입·학생 화면 공개 패치를 통합한다.

대상은 서울 `getYutPublication,getThinkCloudState,getStudentVisibleLessons,checkStudentAttendance,getWeplayLobby,startWeplayGame,previewWeplayGame,invalidateQuizClassCanonicalResult,invalidateQuizClassLegacyResult,reconcileStudentProfileEmojiOnAccountWrite`다. 과거학기 차이가 있는 기존 `getW8DomainState`와 다른 함수·rules·최소 인스턴스를 일괄 배포하지 않는다. 앱/Functions 검사, 실제 출석·윷 에뮬레이터, 점수 요청 권한·브라우저 회귀 후 선택 배포하고 같은 커밋의 Vercel main을 운영 도메인으로 승격한다. 검증·비용 기준과 CUD 판단은 [서버 사용량 검토](../reviews/server-usage-20261110.md)를 따른다. 외부 AI·개인정보 항목·공개 범위 확대는 없다.

## 시험 진입 지연과 복습 자료 팝업 (2026-11-10)

기준 `94325681eb71b71298644abeb1e8bc777ba672c0`은 운영 도메인 소스와 일치했다. 중간 응시 화면을 제거하고 직접 링크·새로고침의 복구를 자동화한다. 동일 시험지의 글꼴 재준비를 생략하며 이미지·글꼴 준비 후 서버 타이머 시작은 유지한다. 모의고사 START는 과거 응시의 메타데이터만 읽고 이어 풀 시험지 한 건만 복원한다. 고정 시험지가 아닌 구형 문제은행은 기존 학습 이력 기반 출제 방식을 유지한다.

오답 노트 학습지는 학생의 기존 풀이·저장 화면을 팝업으로 재사용한다. 목차·학습지·본인 진도 조회 캐시와 방문한 화면을 재사용하고 전체 학기 보상 집계는 조회하지 않는다. 계정·학기가 바뀌면 팝업 상태를 폐기한다. 교사 문항 상세는 보관된 해당 버전의 문항과 시험지 renderer를 재사용한다. 학생·교사 권한, 학기, 응시 횟수, 마감, 저장·채점 경계를 변경하지 않는다.

기존 서비스 유지보수이며 외부 AI 호출·외부 전송·개인정보 항목·공개 범위 확대는 없다. 운영 원본 대조 후 서울 `executeCommand` 한 함수와 Vercel main 프론트엔드만 반영한다. rules·다른 함수·런타임 자원 설정은 변경하지 않는다. 검증은 기본 빌드/포맷/Functions check, 실제 Firestore 30학생 동시 시작·영수증 복구, 학생 진입·학습지 팝업·교사 상세 브라우저 회귀를 사용한다. 운영에서는 학생 응시·답안·점수를 시험 목적으로 변경하지 않는다.

## 오답 노트와 평가 목차·문항 줄바꿈 (2026-11-09)

기준 커밋과 운영 도메인 배포의 소스는 `c35fc00ba1325f3637f5f3d87293db27a6f5130e`로 일치했다. 학생 오답 노트는 기존 제출 스냅샷·기존 문항 renderer·기존 노트 저장 경로를 사용한다. 성찰 이유 4개만 서버 허용값에 추가하며 과거 이유 값, 학기·본인 확인, revision 충돌 검사와 idempotency를 보존한다. 시험 답안·점수·위스·응시 횟수는 변경하지 않는다. 기존 학습 복습 기능의 유지보수이며 외부 AI 전송·외부 서비스·수집 필드·공개 범위·인증 권한은 확대하지 않는다.

배포 대상은 프론트엔드와 서울 `saveMyQuizReviewNote` 한 함수다. 운영 함수와 변경 전 소스 및 주요 의존성의 일치를 확인했다. 다른 Functions·Firestore/Storage rules는 변경하거나 재배포하지 않는다. 기본 앱 빌드·Functions check, 성찰 단위검사 및 `verify-quiz-review-notes-browser.mjs`, `verify-student-quiz-review-flow.mjs`, `verify-mock-exam-history-browser.mjs`, `verify-quiz-question-emphasis.mjs`, 교사 목차·목록 브라우저 검사를 사용한다. 운영 검증으로 실제 학생 노트·제출 답안·성적을 쓰지 않는다.

## 세트 수정·일람표 집계·분석 밀도 (2026-11-09)

세트 공통 지문 수정은 같은 회차·세트의 문항에 원자적으로 반영하고 각 문항 버전을 증가시킨다. 세트의 개별 발문 및 이미 제출된 동결 시험지는 보존한다. 전출·정원외 학생의 수행평가 일람표는 실제 응시한 평가의 점수·인원·총점·평균에 포함하되 전체 평균의 분자·분모에서는 제외한다. 출력 숫자는 소수 둘째 자리, 출력 IP는 사용자 제공 원본 하단의 값을 유지한다. 점수·학적·서명 원본을 변경하는 보정 작업은 포함하지 않는다.

분석 표는 본문 가용 폭을 사용하며 숫자 열·선지 표시를 압축한다. S–P는 낮은 정답률부터 정렬하고 회차별 점수·수준 표에 기존 표 경계를 적용한다. 표본 수와 계산 보조 정보는 키보드·마우스·터치 도움말로 제공한다. 학생 UI·공개 상태·인증·rules·AI 호출은 변경하지 않는다.

운영 소스 대조 후 서울 `executeCommand`만 선택 배포하고, 같은 검증 커밋의 Vercel main 배포를 운영 도메인으로 승격한다. 검증·배포 근거는 [보완 기록](../reviews/assessment-maintenance-20261109.md)을 따른다. 운영 점검은 선택 학급의 읽기와 편집창 열기·닫기로 한정한다.

## 제출 완료 모의고사 재응시 버튼 (2026-11-09)

학생 모의고사 목록은 회차 요약의 서버 판정을 사용한다. 제출을 마쳤고 현재 응시 횟수를 모두 사용한 회차의 입장 버튼은 비활성화하고 `재응시 불가`로 표시한다. 첫 응시·다음 회차·허용된 재응시·교사가 초기화한 응시·진행 중 응시 이어하기는 유지한다. 기존 요약 호출에서 완료한 회차의 정의와 본인 응시 메타데이터만 추가 조회하며 원문·답안은 읽지 않는다. 브라우저의 추가 호출·쓰기·권한 변경·교사 화면·AI 호출·외부 전송은 없다.

`verify-student-quiz-entry-browser.mjs`에서 초시·복시·전시의 제한과 390/768/1280/1366px 화면, 비활성 버튼의 이동 차단, 다음 회차·허용된 재응시·초기화·이어하기를 검사한다. 서버의 현재 응시 판정 회귀와 기본 빌드·포맷·Functions check 후 서울 `getAssessmentState`만 배포하고 Vercel main 운영 도메인으로 승격한다.

## 시험 단일 입장과 동시 응시 복구 (2026-11-09)

학생 목록의 `응시`는 서버 상태·자료 확인 후 시험지로 바로 이어진다. 직접 링크의 시작 확인, 기존 응시 복구, 서버 마감 시각과 동일 영수증은 유지한다. 교육과정 라벨 조회 실패는 입장을 막지 않는다.

운영 메모리 초과와 조회/저장 경합에 대응해 서울 `executeCommand`, `getCommandStatus`, `getAssessmentState`, `saveAssessmentProgress` 네 함수만 512 MiB·CPU 1·동시 요청 8·최대 20개·최소 0개로 배포한다. 제한 시간은 60초다. 상태/영수증은 읽기 전용 스냅샷, 시작/저장/제출은 쓰기 트랜잭션을 사용한다. 세션·학기·공개·선행 회차 검사를 완화하지 않고 자동 명령 재실행도 추가하지 않는다.

기본 빌드·포맷·Functions check, 클라이언트 영수증 복구, 단일 입장 브라우저와 인스턴스당 동시성 8로 처리하는 30학생 Firestore 에뮬레이터 통합 검사 후 네 함수와 프론트엔드를 운영 반영한다. [원인·검증 기록](../reviews/exam-entry-recovery-20261109.md)의 에뮬레이터 한계도 함께 확인한다. 운영 점검에서는 학생 응시·답안·점수·공개 상태를 변경하지 않는다.

## 모의고사 공개·입장과 회차별 조회 (2026-11-08)

교사가 회차별 공개 학급과 공개 여부를 저장하면 해당 회차의 설정·정의·학급 배정을 하나의 서버 명령으로 반영한다. 학생의 새로고침은 현재 학기의 공개 설정을 다시 읽으며, 문제 풀이의 `단원별 평가 / 모의고사` 탭 중 모의고사에 진입할 때만 본인의 회차별 제출 상태를 조회한다. 회차 선택은 추가 조회 없이 처리하고 시험 입장은 기존 준비·시작 경로를 사용한다. 2회는 1회 제출, 3회는 1·2회 제출 조건을 서버에서도 유지한다. 공개 버튼을 시험하려고 실제 학생 배정이나 공개 여부를 변경하지 않는다.

출제 자료는 `unitId/category/examRound`가 일치하는 회차만 최대 201문서 조회하여 기존 200문항 상한 검사를 유지한다. 빈 회차는 작성된 회차가 있는지 최대 1문서로 확인한 뒤, 회차 필드가 전혀 없는 구형 은행에만 기존 호환 경로를 적용한다. 문항 수정은 영향받은 이전·새 회차만 갱신한다. 한 회차의 빈 자료 오류가 다른 회차 갱신을 막지 않으며 공개 여부를 임의로 바꾸지 않는다. 학생 목록 화면의 학교·학생 명부 조회도 제거한다.

배포 대상은 서울 `executeCommand`, `getAssessmentState`와 프론트엔드다. 기준 `bd9b96c4`와 운영 원본의 호출 의존 소스를 대조했으며 영수증·자동 저장·rules는 변경하지 않는다. 기본 빌드·포맷·Functions check 외에 공개 설정/회차 이동/빈 회차/구형 키·sourceHash 회귀, 학생 입장 브라우저, 실제 Firestore 에뮬레이터에서 10개 반 동시 시작·중복 영수증 재사용을 검사한다. [공개·배포 점검 기록](../reviews/mock-exam-release-20261108.md)을 참고한다.

## 세트 지문 순서와 단답형 허용 답안 (2026-11-08)

교사 문항 편집기의 세트 공통 지문은 성취기준·목표 성취수준·예상 난이도 아래, 개별 발문 위에 둔다. 단답형(`short`, `word`)의 정답은 `명, 명나라`처럼 쉼표로 구분하며 공백을 제외한 각 답안이 20자 이내여야 한다. 학생의 입력은 분리하지 않고 허용 답안 하나와 일치할 때만 정답으로 인정한다. 객관식·순서·연결형의 쉼표는 기존 답안의 일부로 유지한다.

새 응시는 채점 스냅샷에 문항 유형을 함께 보관한다. 기존 진행 중 응시는 이미 보관된 문항 스냅샷의 유형을 사용하며 유형이 없는 기록은 기존 전체 문자열 비교를 유지한다. 이미 제출된 결과·점수·응시 영수증은 다시 계산하지 않는다. 교사 미리보기, 학생 제출, 오답노트 재풀이가 같은 규칙을 사용한다. 추가 서버 조회·전체 자료 조회·권한 변경·외부 AI 전송은 없다.

배포 대상은 서울 `executeCommand`, `saveMyQuizReviewNote`와 프론트엔드다. 운영 소스 대조 결과 전자는 기준 `6a42819b`와 일치하고 후자의 실제 노트 handler·세션·권한 의존 소스도 일치한다. 조회·자동 저장·명령 영수증 함수의 동작 변경은 없어 재배포하지 않는다. 새 `functions/quizAnswerMatching.js`를 배포 패키지에 포함한다. 기본 빌드·Functions check·포맷과 `verify-quiz-answer-aliases.mjs`, `verify-mock-exam-authoring-browser.mjs`, `verify-teacher-mock-grading-browser.mjs`, `verify-student-quiz-review-flow.mjs`로 검증하며 실제 학생·문항 자료는 시험 목적으로 변경하지 않는다.

## 학생 모의고사 순차 응시와 화면 정렬 (2026-11-08)

학생 모의고사는 1회 제출 후 2회, 1·2회 제출 후 3회에 응시한다. `getAssessmentState`의 `mockExamOverview` 읽기는 모의고사 회차 선택을 펼칠 때만 실행한다. 현재 학기·인증 UID·정확한 회차의 서버 결과를 최대 1건씩 읽으며 원문·답안·전체 기록은 가져오지 않는다. canonical 결과가 없을 때만 해당 학기의 회차가 명시된 기존 결과를 제한 조회한다. 조회 오류에서는 다음 회차를 열지 않는다. 공개 여부·응시 횟수·재응시 대기·학생 배정 조건은 계속 적용한다.

서버는 시작, 자료 사전 준비, 진행 복구, 자동 저장, 제출 및 시작 명령 영수증 재전송에도 선행 회차를 확인한다. 기존 제출 결과 확인과 제출 영수증 재전송은 보존한다. 신규 전체 학생 조회·외부 AI·새 개인정보 저장은 없다. 이 변경의 배포 대상은 서울 `executeCommand`, `getCommandStatus`, `getAssessmentState`, `saveAssessmentProgress` 및 프론트엔드다. 운영 원본을 비교하고 Functions check·lifecycle/receipt 검사 후 대상 함수만 배포한다.

학생 일정과 블러는 공통 교사 기준과 비교하고, 오답노트는 문제·답안 비교·해설로 구분한다. `verify-week-schedule-browser.mjs`, `verify-mobile-top-glass.mjs`, `verify-student-quiz-entry-browser.mjs`, `verify-quiz-review-notes-browser.mjs`, `verify-mock-exam-history-browser.mjs`, `verify-student-quiz-review-flow.mjs` 및 기본 빌드를 사용한다. 합성 계정으로 좁은 화면·모바일 브라우저 엔진·제출과 노트 재조회를 검증하고, 실물 iPhone 홈 화면 앱 검증과 구분한다.

## 제출 답안 복원과 오답노트 (2026-11-08)

모의고사·진단·형성평가의 제출 완료 화면은 서버가 확정한 답안을 사용한다. 이미 다른 탭에서 제출한 응시의 재요청도 원래 답안·점수·동결 머리말을 반환한다. 마이페이지는 보관된 공통 지문·보기와 회차 머리말을 복원하며 현재 문제은행으로 과거 원문을 덮어쓰지 않는다.

오답노트는 `semester_quiz_review_notes`에 학기·인증 UID·원본 결과 key별로 분리한다. 학생 본인의 제출한 오답만 작성하며 연습 답안·이유·자유 노트는 명시적으로 저장한다. 원답·점수·응시 횟수·위스를 바꾸지 않는다. 현재 활성 학기만 수정하고 보관 학기는 읽기만 허용한다. 상세조회에 노트 한 문서를 추가하고, 머리말이 빠진 구형 모의고사만 해당 응시 한 문서를 추가 조회한다. 노트 저장용 내부 callable을 추가하며 외부 AI 호출·외부 데이터 전송·다른 학생의 접근 권한은 추가하지 않는다.

배포 대상은 서울 `executeCommand`, `getMyQuizHistory`, `saveMyQuizReviewNote`, `deleteStudentData`와 프론트엔드다. 삭제는 해당 학생·학기 노트만 기존 삭제 목록에 포함한다. `deleteStudentData`의 운영 소스와 기준 소스 차이는 기존 저장소에 추가된 공통 세션·최근 인증 검사이므로 클라이언트의 기존 삭제 어댑터도 `callStudentDataService`로 맞추고 세션 검사를 보존한다. 이번 패치에서 공통 세션 검사나 권한 조건 자체를 변경하지 않는다. 노트 원본은 Firestore 클라이언트에서 직접 읽거나 쓰지 않는다.

기본 빌드·Functions check와 `verify-student-quiz-review-flow.mjs`, `verify-quiz-review-notes-browser.mjs`, `verify-quiz-history-identity.mjs`, Functions의 `verify-student-quiz-review-notes.cjs` 및 `verify-quiz-release-integration.cjs`를 사용한다. 공통 세션·삭제 호환은 `verify-student-profile-commands.mjs`와 `npm run test:score-request-rules`로 확인한다. 실제 학생의 답안·점수·노트나 계정은 운영 검증용으로 변경하지 않는다.

## 역사교실 면제권 적용 (2026-11-05)

서버는 면제권 적용 시 대상 학생과 과제가 모두 일치하는 제출 결과·진행 중 응시·사용 요청만 조회한다. 학기별 이전 결과와 현재 평가 결과를 함께 검사하고, 면제권 사용·완료 기록·응시 잠금·알림을 같은 트랜잭션에 저장한다.

배포 대상은 서울 `executeCommand`와 프론트엔드다. 운영 함수 원본과 대조하고 `npm --prefix functions run check`, `npm --prefix functions run test:history-classroom`, `node scripts/verify-history-classroom-teacher-browser.mjs --results-only`, `npm run build`로 검증한다. 동시 사용과 응답 유실은 로컬 에뮬레이터의 합성 자료로 검증한다. 운영에서는 함수 리비전과 교사 화면을 확인한다.

## 평가 답안 길이와 복원 (2026-11-03)

퀴즈 단답형(`short`, `word`)과 역사교실 빈칸은 학생 입력·자동 저장·제출 모두 문항당 20자로 제한한다. 서버는 응시 당시 출제한 문항 ID와 유형을 기준으로 확인하며 명시적 `essay` 답안의 상한은 2,000자다. 입력 길이는 브라우저의 `maxlength`와 같은 UTF-16 단위로 센다. 객관식·순서·연결형 답안은 출제된 보기 길이를 기준으로 검사한다. 진행 중인 예전 단답 답안은 앞 20자까지 복원하고 학생에게 알린다. 이미 제출한 결과는 보존한다.

운영 대상은 서울 `executeCommand`, `saveAssessmentProgress`와 Firestore 규칙이다. 루트와 학기별 `quiz_submissions`는 기존 읽기 권한을 유지하며 학생 직접 쓰기를 차단한다. 운영 배포 전 각 함수의 배포 원본과 Firestore 규칙을 비교한다. Functions 검사, 평가 권한 에뮬레이터 및 실제 러너의 한글 입력·붙여넣기·오프라인 복구 회귀를 실행한다.

## 역사교실 입력과 진단·형성평가 문항 순환 (2026-11-03)

학생 역사교실의 `큰 입력칸`에서 현재 페이지의 빈칸 번호를 고르면 문서의 해당 위치가 강조된다. 문서 위 입력과 큰 입력칸은 같은 답안을 사용한다. 재응시·한글 조합·정밀 마스크 안쪽의 터치·페이지 이동 후 제출은 `node scripts/verify-history-classroom-runner-recovery.mjs`로 확인한다.

진단·형성평가는 같은 학생·평가에서 아직 풀지 않은 문항을 우선 출제한다. 남은 문항이 설정 수보다 적으면 그 문항을 모두 포함하고, 부족한 수만큼 이전에 푼 문항에서 뽑아 설정 수를 채운다. 한 응시 안에서는 문항이 중복되지 않으며, 이때 다시 뽑혀 답을 작성한 문항은 다음 주기의 풀이로 계산한다. 미응답 문항은 계속 후보에 남고 교사가 재응시를 열어도 이전 풀이 기록을 유지한다. 단원 정렬은 기존 설정을 따른다. 서버 출제 변경의 배포 대상은 서울 `executeCommand`다.

## 관리자 세션과 보호된 작업 (2026-11-03)

지정 관리자 계정은 현재 로그인으로 가입 승인·기준 변경, 학사 일정 삭제, 위스 운영 등 보호된 작업을 수행한다. 서버는 Firebase 인증 토큰의 관리자 이메일과 각 작업에 필요한 애플리케이션 세션·권한을 검사한다. 최초 세션 개설, 종료된 세션의 복구, 권한을 위임받은 교사·직원의 최근 인증 기준은 기존 정책을 따른다. 위스 이미지 업로드에도 같은 관리자 예외와 기존 세션 만료 검사를 함께 적용한다.

운영 확인에는 학생 자료나 운영 데이터를 변경하지 않는다. 지정 관리자와 일반 교사의 반복 저장 차이는 `node scripts/verify-student-registration-policy-browser.mjs`, 세션 증명과 철회는 `npm run test:login-session`, 위스 이미지 쓰기 권한은 `scripts/verify-notice-storage-rules.mjs`의 전용 로컬 에뮬레이터 검사로 재현한다.

이번 배포 범위는 Storage 규칙, 서울의 `executeCommand`, `getCommandStatus`, `manageAcademicCalendar`, `updateStudentMaintenanceConfig`, `saveStudentRegistrationPolicy`, `createStudentData`, `updateStudentEnrollment`, `updateStudentData`, `reviewPerformanceScoreObjection`과 미국의 `executeWisCommandFast`, `getWisCommandStatusFast`다. 운영 원본에서 `resetLessonCorePointProgress`와 `createManagedNotifications`는 종료된 호출을 거부하고, `deleteStudentData`는 최근 인증 시간을 검사하지 않아 세 함수는 배포 범위에서 제외했다.

## 신규 가입 기준과 게임 안정성 (2026-11-02)

교사 `학생 명단 → 신규 가입 기준`에서 학교 계정 발급 연도와 담당 학년을 저장한다. 단일 원본은 `site_settings/student_registration_policy`이며 현재 수업 학기와 별개다. 문서가 없을 때만 2026년 3학년(`263NNNN@yongshin-ms.ms.kr`)을 사용한다. 2027년 2학년으로 저장하면 `272NNNN`이 된다. 이미 승인된 학생·기존 학생의 계정과 기록은 자동 변경하지 않는다. 자세한 허용·차단 및 충돌·재시도 계약은 [가입 기준 검토](../reviews/student-registration-policy-20261102.md)를 따른다.

운영 소스를 대조한 후 `getStudentRegistrationPolicy`, `saveStudentRegistrationPolicy`, `openApplicationSession`, `beginApplicationSessionReauthentication`, `touchApplicationSession`, `closeApplicationSession`, `executeCommand`와 Firestore rules만 배포한다. 게임 수정은 프론트엔드에 한정하며 Storage rules·게임 Functions·공개 설정은 배포하거나 변경하지 않는다. 정책 API와 rules를 먼저 반영하고 Vercel main 배포를 승격한다. 설정 문서나 학생 계정을 시험 목적으로 운영에서 생성·수정하지 않는다.

필수 검증은 기본 빌드·Functions check·포맷, 가입 정책 전용 Firestore emulator 통합, 기존 로그인·학생 접근 회귀와 `verify-student-registration-policy-browser.mjs`, `verify-weplay-network-loading.mjs`, `verify-weplay-naval-browser.mjs`, `verify-yut-publication-recovery-browser.mjs`다. 브라우저 검사에는 실제 공통 재인증 창, 답안 응답 유실·같은 영수증 재시도, 키보드 viewport·IME·회전, 윷 공개 확인 실패 후 복귀를 포함한다. 모사한 키보드 검사를 실물 iOS/Android 검증으로 표현하지 않는다. [통합 검증 기록](../reviews/registration-game-stability-20261102.md)을 참고한다.

## 원화 기반 2D 아바타 (2026-10-29)

꾸미기는 `public/avatar/v2/`의 원화 레이어·manifest와 Canvas 2D 렌더러를 사용한다. 아래 2026-10-28의 GLB 생성 절차는 구 3D 클라이언트 기록이다. 원본 시트(`assets/avatar-source/v2/`)와 등록표(`scripts/avatar-2d-art-registry.json`)를 수정하면 `node scripts/build-avatar-2d-assets.mjs --spec scripts/avatar-2d-art-registry.json` 뒤 `node scripts/render-avatar-item-previews.mjs`를 실행한다. `npm run verify:avatar-previews`와 기본 빌드는 원본·등록표·생성기·레이어·미리보기의 일치와 전체 품목 대응을 검사한다. 그림의 연결·두상 맞춤은 실제 화면에서 별도로 확인한다.

생성된 v2 자산과 원본·등록표를 함께 커밋하고 `output/`의 실험·QA 캡처는 제외한다. v2는 재검증 가능한 캐시를 사용한다. 기존 저장 썸네일은 사용자의 명시적 저장으로 갱신하며, 이 전환은 카탈로그·Functions·rules를 변경하지 않는다. 상세 제작·검증 근거는 [2D 전환 기록](../reviews/avatar-anatomy-20261029.md)을 따른다.

## 아바타 의상·헤어·미리보기 (2026-10-28)

새 헤어는 `public/avatar/v1/models/hair-v3/`의 정적 GLB를 사용한다. 미리보기는 `node scripts/render-avatar-item-previews.mjs`로 실제 렌더러에서 재생성하며, `npm run build`가 포함한 `verify:avatar-previews`는 모델·렌더러·카탈로그 변경 후 오래된 이미지를 배포하지 못하게 검사한다. 생성된 GLB·WebP·manifest를 소스와 함께 커밋한다. `output/`의 생성 원본·QA 캡처는 일괄 스테이징하지 않는다. 제작·호환성·선택 배포 근거는 [아바타 개편 기록](../reviews/avatar-overhaul-20261028.md)을 따른다.

## 교사 아바타와 관리자 가격표 (2026-10-28)

아바타 가격은 `avatar_catalog_settings/current`의 버전 있는 관리자 설정을 따르며, 학생 구매·저장 시 서버에서 현재 가격을 검증한다. 학생 꾸미기의 초기 조회는 아바타·지갑·가격표를 합친 `getAvatarStudioState`를 사용하고 교사 `getTeacherMyPage`는 지갑·가격표를 조회하지 않는다. 가격표 변경을 전파하려고 폴링·아이템별 쿼리를 추가하지 않는다. [검토 기록](../reviews/teacher-avatar-pricing-20261028.md)에 권한·비용·검증·선택 배포 대상을 기록했다.

카탈로그에 항목을 추가할 때는 저장 함수뿐 아니라 공개 아바타를 검증하는 `getWisRankingPreview`, `getWisEconomyState`, `getWisEconomyStateFast`도 함께 배포한다. 신규 교사 삭제 함수의 실패 재시도 배포에 `--force`가 요구되면 기존 함수 삭제 대상이 없는지와 `getWisEconomyState` 두 리전을 먼저 확인한다. 각 삭제 작업은 동일 이벤트 재시도에 안전해야 한다.

## 위스 지갑과 전체 거래 내역 (2026-10-27)

위스 지급·차감·조정·역분개·구매·취소·주문 검토는 `executeWisCommandFast`, 상태 확인은 `getWisCommandStatusFast`, 일반 지갑 조회는 `getWisEconomyStateFast`를 us-central1에서 호출한다. 기존 서울 함수와 같은 영수증·권한을 사용하며 클라이언트가 실패 시 새 요청 ID나 다른 리전으로 자동 재지급하지 않는다. 지급 함수는 256MiB, 최소 인스턴스 0개, 최대 20개, 동시 요청 80개로 운영한다(2026-11-21 변경).

`semester_wis_ledger`의 accountId ASC / createdAt DESC / __name__ DESC COLLECTION 인덱스가 READY인지 먼저 확인한다. 학생·교사 전체 내역은 원장을 페이지 조회하며 최근 100건 캐시를 전체 원장으로 취급하지 않는다. 거래 조회는 읽기 전용 transaction이다. 지급은 실제 학기·경제 상태·계좌·주문·재고 revision을 확인하고, 다른 학생이 바꾼 학교 aggregate revision만으로 거부하지 않는다.

검증은 `npm --prefix functions run check`, `npm --prefix functions run test:wis-wallet`, 기존 윷 보상 통합, `node scripts/verify-wis-economy-adapter.mjs`, `node scripts/verify-wis-wallet-browser.mjs`, `npm run build`를 사용한다. 운영 원장 대조는 `npm --prefix functions run audit:wis-wallet`이며 학생 이름·UID 출력과 데이터 쓰기는 없다. 불일치가 발견되면 잔액을 추측해 수정하지 말고 원장 근거부터 확인한다.

배포 대상은 `executeCommand,getWisEconomyState,executeWisCommandFast,getWisCommandStatusFast,getWisEconomyStateFast` 5개다. 운영 원본 대조·검증 → 해당 Functions 배포 → 프론트엔드 배포·승격 → 방재석 Chrome 프로필에서 운영 조회 확인 순서로 진행한다. 상세 범위와 연동 계약은 [위스 지갑 검증 기록](../reviews/wis-wallet-20261027.md)을 따른다.

`getWisEconomyState`는 기존 서울과 미국 두 리전을 모두 export해야 한다. Firebase CLI는 `--only`에서도 같은 함수 이름의 리전을 대조하므로 서울만 선언하면 기존 미국 함수를 삭제 대상으로 판단한다. 최소 인스턴스 비용 승인에 `--force`가 필요할 때에도 먼저 이 리전 목록을 확인한다. 이 계약은 아래 과거의 ‘서울만 배포’ 안내보다 우선한다.

## 윷놀이 온라인 명령 (2026-10-27)

새 클라이언트는 `commandYutRoomFast`를 `us-central1`에서 호출한다. Firestore `nam5`와 가까운 곳에서 동일한 세션·학기·학적·공개 설정·방 권한·요청 영수증 검사를 수행한다. 이 함수는 256MiB, 최소 인스턴스 0개, 최대 20개, 동시 요청 80개를 사용한다(2026-11-21 변경). 기존 서울 `commandYutRoom`은 열린 구 클라이언트의 호환 경로로 유지한다. 로그인 함수나 다른 게임의 리전은 변경하지 않는다.

대기방은 마지막 방장 활동(`hostActivityAtMs`, 구 문서는 `createdAtMs`)으로부터 10분 동안 활동이 없으면 만료된다. 방장의 서버 승인 명령과 감정표현은 방·참가 코드의 만료를 함께 갱신한다. 다른 참가자 활동, 단순 조회, 같은 요청 영수증의 재실행은 시간을 연장하지 않는다. 강퇴는 대기 중인 방장이 준비하지 않은 다른 참가자에게만 실행할 수 있으며 실제 쓰기와 실시간 읽기 권한을 함께 제거한다.

배포 순서는 `yut_rooms` COLLECTION_GROUP의 `status ASC, expiresAtMs ASC` 인덱스 추가 및 READY 확인 → Firestore rules → 서울 `getYutLobby`, `getYutManagement`, `commandYutRoom`, `cleanupWaitingYutRooms`와 미국 `commandYutRoomFast` → 프론트엔드다. 기존 인덱스와 서울 callable을 삭제하지 않는다. 대기방 정리 예약 함수는 새 인덱스와 방장 활동을 사용한다. 변경 파일의 함수별 운영 원본을 비교하고 위 함수들만 배포한다.

검증은 `npm run build`, `npm --prefix functions run check`, 윷 core/management·만료·통합·다중 브라우저 Firestore 에뮬레이터 검사, `scripts/verify-yut-online-feedback-browser.mjs`, `scripts/verify-yut-interface-browser.mjs`를 사용한다. 실제 운영에서 두 사용자의 대전을 확인하기 전에는 합성 지연 검사를 실사용 응답 시간 측정으로 보고하지 않는다.

회사와 집 컴퓨터는 같은 Git 원격과 운영 도메인을 사용한다. 로컬 폴더 또는 Vercel 빌드 완료만으로 운영 반영을 판단하지 않는다.

1. 저장소 루트, 브랜치, HEAD, 미커밋 변경을 확인한다. `git fetch origin` 후 최신 `origin/main`과 비교한다. 진행 중 작업이 있으면 별도 작업 공간을 사용하고 기존 파일을 덮어쓰지 않는다.
2. 과거 개발 분기의 패치를 복원할 때는 현재 운영 코드에 필요한 변경만 이식한다. 최신 저장·권한·학기 보호를 과거 파일 전체 교체로 없애지 않는다.
3. 기본 빌드와 변경 기능 검증을 수행한다. 배포 직전에 다시 원격 main을 비교하고 새 커밋이 있으면 병합·재검증한다. 강제 push를 사용하지 않는다.
4. main 반영 후 Vercel 배포의 Source commit이 해당 HEAD인지 확인하고 Ready까지 기다린다.
5. 현재 프로젝트는 Production 빌드도 Staged로 완료될 수 있다. `Assigning Custom Domains: Skipped`이면 운영 반영 완료가 아니다. 해당 배포의 Promote에서 `www.westory.kr` 운영 도메인 연결을 완료한다. 승격 직전에도 더 최신 main 배포가 없는지 확인한다.
6. `https://www.westory.kr`을 새로 열어 변경 화면을 확인한다. 로그인 전 화면만 보고 관리자 기능 반영을 완료했다고 판단하지 않는다. 운영 데이터를 임의로 생성·삭제하지 않는다.
7. 최종 보고에는 반영 커밋, 기능 검증 결과, 실제 운영 확인 결과와 남은 제약을 구분해 적는다.

이 문서는 현재 확인된 Vercel 운영 절차다. GitHub Pages 워크플로 성공만으로 `www.westory.kr` 반영을 대신 확인하지 않는다. Functions 또는 Rules 변경이 있으면 루트 AGENTS.md의 별도 Firebase 배포 절차도 따른다.

## 사전 자료의 학기 유지 (2026-10-18)

기본 역사·지명 사전은 Firestore `history_dictionary_catalog`에 안정된 항목 ID로 저장한다. 앱은 `getHistoryDictionaryContinuity`에서 이 자료를 읽는다. 출처, 이용 조건, 별칭과 분류를 함께 보존하며, 학기 전환 때 초기화하거나 다시 생성하지 않는다.

교사 등록 단어와 학생 단어장은 기존 `years/{year}/semesters/{semester}` 원본 경로를 유지한다. 현재 학기와 종료·보관된 이전 학기를 함께 조회하며, 같은 단어는 현재 학기, 최신 이전 학기 순으로 표시한다. 이전 기록은 읽기 전용이다. 학생은 본인 단어장만 조회하고, 교사가 제공한 이전 풀이를 현재 학기에 명시적으로 저장할 때에는 원본 풀이와 현재 단어의 버전을 각각 검사한다. 자동 복사나 보상 지급은 하지 않는다. 개인정보 삭제 절차는 기존 보관 자료에도 계속 적용된다.

기본 사전 갱신은 `node scripts/sync-history-dictionary-catalog.mjs --project history-quiz-yongsin`으로 변경 계획을 먼저 확인한다. 적용할 때에는 출력된 `sourceHash`, `planHash`를 각각 `--expect-source-sha`, `--expect-plan-sha`에 넣고 `--apply`를 추가한다. 이 도구는 관리 대상 항목만 버전 조건으로 생성·수정하며, 삭제하지 않는다. 적용 후 전체 항목과 출처를 다시 읽어 확인한다. 2026-10-18 최초 저장분은 2,373개(역사 133개·지명 2,240개), 출처 2,994건이다.

같은 날 제공된 역사2 전체본·1학기 자료·역사 부도를 대조해 994개를 추가하고 96개 풀이를 보완했다. 확장본은 3,367개(역사 1,125개·지명 2,242개), 출처 4,863건이다. 교과서 인쇄 쪽수와 PDF 쪽수를 함께 남기며 교과서를 공개 라이선스로 표시하지 않는다. 기존 2,373개 ID·지도 연결·출처는 유지한다. [교과서 대조 기록](../reviews/history-dictionary-textbooks-20261018.json)에 자료 해시, 검토 범위, 보충 출처와 검증을 남겼다. 이 자료 확장은 기존 조회 함수를 사용하므로 Functions나 rules 재배포가 필요하지 않다.

조회·저장 검증은 `npm run verify:history-dictionary`와 `npm --prefix functions run check`에 포함된다. 최초 학기 유지 패치의 Firebase 배포 대상은 서울 `getHistoryDictionaryContinuity`, `executeCommand` 두 함수다. 규칙이나 기존 사전 mutation callable을 일괄 배포하지 않는다.

## Windows 작업 환경 확인

회사 PC에서도 매 작업 시작 시 `git fetch origin --prune` 후 HEAD와 `origin/main`을 비교한다. 미커밋 변경이 없고 뒤처지기만 한 경우 `git merge --ff-only origin/main`으로 동기화한다. 다른 PC의 작업을 강제 push로 덮어쓰지 않는다.

프론트엔드는 Vercel 프로젝트의 Node 24.x와 회사 PC의 기본 Node 24.14.0을 사용한다. Functions 작업 전 PowerShell에서 `. .\scripts\use-westory-node.ps1`을 실행하면 현재 터미널을 `functions/package.json`의 Node 주 버전으로 맞추고 `FUNCTIONS_DISCOVERY_TIMEOUT=60`을 설정한다. Node가 다른 버전이면 `%LOCALAPPDATA%\Westory\tools\node-v22.*-win-x64`의 설치본을 찾는다. 다른 위치는 `-NodeDirectory`로 지정한다. 시스템 Node나 Windows 컴퓨터 이름은 바꾸지 않는다. 새 PC에서는 [공식 Node 배포](https://nodejs.org/dist/latest-v22.x/)의 Windows x64 ZIP과 `SHASUMS256.txt`로 검증한 런타임을 먼저 준비한다.

```powershell
. .\scripts\use-westory-node.ps1
gh auth status
git push --dry-run origin HEAD:main
vercel whoami
vercel inspect www.westory.kr --scope bbbs-projects-44f9da30
firebase login:list
firebase functions:list --project history-quiz-yongsin
```

Vercel 로컬 연결이 없으면 `vercel link --yes --project westory --scope bbbs-projects-44f9da30`을 사용한다. `.vercel/`과 생성된 `.env.local`은 Git에서 제외한다. `.codex-remote-attachments/` 같은 컴퓨터별 첨부물은 `.git/info/exclude`에 등록하고 패치에 섞지 않는다. 커밋은 변경 파일을 명시해 스테이징한다.

2026-10-07 회사 PC 확인: GitHub `westory28`, Vercel `westoria28-8028` / 팀 `bbbs-projects-44f9da30`, Firebase `history-quiz-yongsin` 접근을 확인했다. 동기화 기준 앱 커밋은 `7b1107a83d18ea7ba0fe1e5d21457f9ca1177648`이며 당시 운영 도메인도 같은 커밋이었다. 로컬 Node 22.23.3, Firebase CLI 15.9.1, Vercel CLI 62.5.0을 준비했다. Vercel CLI 62.5.0은 한글 hostname을 HTTP User-Agent에 그대로 넣어 로그인 시 ByteString 오류가 발생했으므로, 로컬 설치본의 해당 hostname만 `encodeURIComponent`로 인코딩했다. CLI 재설치·업데이트 후에는 `vercel whoami`로 다시 확인한다.

커밋·push 후 Git 연동 배포의 Source commit과 Ready를 확인한다. Staged이면 `vercel promote <검증한 deployment ID 또는 URL> --yes --scope bbbs-projects-44f9da30`으로 승격한다. `vercel inspect www.westory.kr`와 실제 HTTPS 화면 확인까지 완료해야 운영 반영으로 보고한다. [공식 승격 명령](https://vercel.com/docs/cli/promote)을 참고하며, 자동 도메인 할당 설정은 바꾸지 않는다.

## 학습지 원본 PDF 브라우저 읽기

OCR 선택은 기존 Firebase Storage의 원본 PDF를 브라우저에서 읽어 글자 위치를 계산한다. AI나 외부 OCR API를 사용하지 않는다. `storage.cors.json`은 운영 도메인 두 곳의 `GET`·`HEAD`만 허용한다. Storage 권한 규칙과 다운로드 토큰은 그대로 적용된다.

```powershell
gcloud storage buckets update gs://history-quiz-yongsin.firebasestorage.app --cors-file=storage.cors.json
```

CORS는 `firebase deploy --only storage`로 반영되지 않는 별도 버킷 설정이다. 적용 전 기존 CORS를 조회하고 다른 설정이 있으면 덮어쓰지 말고 병합한다. 적용 후 운영 원본 PDF 응답의 `Access-Control-Allow-Origin`과 실제 OCR 드래그를 확인한다. 원본 다운로드 URL과 토큰을 검증 기록에 남기지 않는다.

## 위스피 거래 배포 (2026-11-15)

학생 거래는 `wisStockTradingExports`의 10개 함수, 기존 종목 관리/가격 5개 함수, 서울 `executeCommand`의 원장 해석과 연결된다. 함수별 운영 ZIP을 비교하는 `prepare-wispi-access-release.mjs`와 전체 해시/runtime을 확인하는 `verify-wispi-access-release.mjs --after`의 준비 절차를 따른다. 이미 배포된 패치를 다시 준비할 때에는 기준 커밋을 대조하고 기존 원본 보존 기록을 사용한다. 소스가 다른 미국 `executeWisCommandFast`를 함께 배포하지 않는다.

`settleWisStockOrderTask`는 기존 프로젝트 runtime 서비스 계정만 enqueue/invoke할 수 있어야 한다. 함수 `invoker`와 queue의 `roles/cloudtasks.enqueuer`, Cloud Run의 `roles/run.invoker`, 해당 서비스 계정의 자기 자신에 대한 `roles/iam.serviceAccountUser`를 함께 확인한다. 공개 호출 권한을 부여하지 않는다. 신규 빈 queue에서 Firebase CLI가 IAM bindings 오류를 내면 지정 계정의 최소 queue binding을 먼저 적용한 뒤 해당 함수만 재배포한다. 배포 뒤 비로그인 호출 거부와 학생 자료를 변경하지 않는 no-op task 처리를 확인한다.

주문 복구 collection-group 인덱스와 개인 내역 인덱스가 READY여야 한다. 시장 개장은 교사 화면에서 별도로 한다. 배포나 테스트를 위해 학생 공개를 켜거나 학생 계좌에 돈을 넣지 않는다. [검증·회계 계약](../reviews/wispi-student-trading-20261115.md)을 따른다.

## 로그인 함수 소스 동기화

2026-10-07 회사 PC에서 확인한 `7b1107a8`에는 운영 로그인 함수의 소스가 없었다. 이후 `76cb10f`에서 `sessionAuthority.js`, `studentMaintenance.js`, `studentRegistrationAccess.js`가 운영 원본으로 복원됐지만, `index.js`의 배포 export 연결은 빠져 있었다. 로그인 소스 동기화 패치에서 이 연결과 실제 export 검사, 배포 전 검사를 추가했다. [소스 대조 및 검증 기록](../reviews/login-source-sync-20261007.md)을 참고한다.

회사와 집 PC는 아래 절차로 같은 원격 main을 받아 같은 함수를 검증한다. 미커밋 작업이 있거나 브랜치가 갈라졌으면 파일을 덮어쓰거나 reset하지 말고 별도 작업 공간에서 병합한다.

```powershell
git fetch origin --prune
git status --short --branch
git rev-list --left-right --count origin/main...HEAD
# 미커밋 변경이 없고 현재 HEAD가 origin/main의 조상인 경우
git merge --ff-only origin/main
. .\scripts\use-westory-node.ps1
npm ci
npm --prefix functions ci
npm run verify:login-functions
# Java 21 이상 필요. 전용 로컬 demo Firestore에서만 실행한다.
npm run test:login-session
```

`verify:login-functions`는 실제 Firebase 진입점을 읽고 로그인 시작·재인증·연장·종료 함수 4개의 callable export와 리전, 학생 가입 승인 경계를 검사한다. `firebase.json`의 predeploy에도 같은 검사가 연결돼 있으므로 소스가 있어도 배포 목록에서 빠진 상태를 배포 전에 발견한다. 이 검사는 로컬 배포 계약을 확인하며, 운영 소스 전체가 같음을 보장하지는 않는다.

로그인 함수를 수정할 때는 운영 원본과 변경 내용을 대조하고 위 검증 후 아래 4개만 배포한다. 단순히 다른 PC에서 pull했다는 이유로 다시 배포할 필요는 없다.

```powershell
$env:FUNCTIONS_DISCOVERY_TIMEOUT = '60'
firebase deploy --only "functions:openApplicationSession,functions:beginApplicationSessionReauthentication,functions:touchApplicationSession,functions:closeApplicationSession" --project history-quiz-yongsin
firebase functions:list --project history-quiz-yongsin
```

PC에는 코드와 개발 도구가 있고 실제 로그인 처리는 공통 Firebase 프로젝트에서 실행된다. GitHub/Vercel/Firebase CLI 인증 정보는 각 PC에서 별도로 관리하며 Git으로 복사하지 않는다. 운영 함수의 원본이 필요하면 권한 있는 PC에서 `gcloud functions describe <함수명> --gen2 --region asia-northeast3 --project history-quiz-yongsin`의 `buildConfig.source.storageSource`에 나온 bucket/object/generation을 사용해 보관 소스를 대조한다. Windows 줄바꿈 차이는 LF로 정규화해 비교한다.

로그인 함수 4개의 복구가 다른 모든 운영 Functions의 소스 복구를 뜻하지는 않는다. PC 환경을 맞추기 위한 Functions/rules 일괄 배포는 하지 않고, 다른 백엔드 패치는 대상 운영 소스부터 대조한다.

## 역사교실 삭제와 재인증 (2026-10-21)

역사교실 과제 삭제(`deleteHistoryClassroomSource`)도 유효한 일반 교사 세션을 사용한다(2026-10-21). 과제 비공개·삭제 표시만 수행하고 제출 결과를 보존하는 작업이므로 로그인 후 시간이 지났다는 이유로 Google 팝업을 다시 열지 않는다. 프론트 allowlist와 서버 `routineContentWrites.json`을 함께 유지하며 executeCommand와 getCommandStatus에 같은 정책을 배포한다. [삭제·인증 검증 기록](../reviews/history-classroom-delete-auth-20261021.md)을 따른다.

## 학사 일정 저장과 재인증 (2026-10-18)

`manageAcademicCalendar`의 일정 등록·수정(`SAVE_EVENT`), 분류 저장(`SAVE_CATEGORIES`), 공휴일 동기화(`SYNC_HOLIDAYS`)는 유효한 일반 애플리케이션 세션을 사용한다. 영구 삭제(`DELETE_EVENT`)만 고위험 세션과 최근 5분 이내 인증을 요구한다. 관리자 제한, App Check 운영 모드, 세션 상태·epoch·증명·만료, 현재 학기, revision 충돌, 요청 영수증 검사는 유지한다. 일반 저장에 최근 인증 제한을 다시 추가하지 않는다. 기존 gateway의 일정 생성·수정도 일반 세션 정책이다.

이전 클라이언트는 로그인 4분 후 자동 팝업을 열었고 서버는 5분 후 일반 저장도 거부했다. 로그인 시간(`auth_time`)은 시간 연장으로 갱신되지 않으므로 정상 로그인 중에도 반복 인증이 발생했다. 클라이언트는 이제 삭제에만 공통 `ensureSensitiveOperation`을 사용하며, 만료된 일반 세션을 저장 과정에서 자동 재인증·재개하지 않는다. 작업 중 사용자 또는 인증 epoch가 바뀌면 쓰기·응답 수락을 중단한다. 서버 저장 후 응답 수락이 중단된 경우 같은 요청 영수증을 유지해 명시적 재시도의 중복 생성을 막는다.

검증은 `node scripts/verify-academic-calendar-client.mjs`, `node scripts/verify-sensitive-operation.mjs`, `npm --prefix functions run check`, `npm run build`로 수행한다. `scripts/verify-academic-calendar-emulator.cjs`는 로컬 Auth·Firestore·Functions 에뮬레이터에서 실제 adapter·세션 callable·일정 callable·rules를 함께 검증한다. 삭제의 공통 인증 경로에는 Vercel Production의 `VITE_FIREBASE_APPCHECK_SITE_KEY`가 필요하다. 환경 변수 값이나 세션 토큰을 검증 기록에 남기지 않는다.

배포 전 운영 `manageAcademicCalendar` 및 세션 의존 소스를 대조한다. 이 패치의 백엔드 대상은 아래 함수 하나이며 로그인 함수·rules 전체를 다시 배포하지 않는다. 백엔드 배포 후 프론트엔드를 배포·승격하고 실제 운영 일정 저장을 확인한다.

```powershell
. .\scripts\use-westory-node.ps1
firebase deploy --only "functions:manageAcademicCalendar" --project history-quiz-yongsin
firebase functions:list --project history-quiz-yongsin
```

## 역사 사전 조회 비용과 캐시 (2026-10-18)

`history_dictionary_catalog`는 학기와 무관한 영구 원본이다. 기본 사전 조회 함수는 이 컬렉션을 스캔하지 않는다. `history_dictionary_catalog_snapshots/current`의 버전과 같은 컬렉션의 불변 gzip/base64 조각을 읽는다. 현재 3,367개 단어는 조각 1개(압축 399,735바이트)에 들어간다. 사전 데이터 읽기는 서버 최초 조회 2문서, 이후 조회 및 클라이언트 버전 일치 시 1문서다. 세션·사용자·학기 권한 확인용 읽기는 별도이며 그대로 유지한다.

브라우저 IndexedDB에는 기본 사전의 단어·출처와 SHA-256 버전만 저장한다. 방문마다 서버 권한·버전 확인 후 재사용하며 개인 단어장·학생 정보·세션 증명은 저장하지 않는다. 버전 변경 시에만 전체 내용을 받는다. 저장소 차단·손상은 재다운로드로 복구하고, 권한 거부 시에는 캐시를 표시하지 않는다. 검색 함수는 내장 전체 단어 데이터를 가져오지 않는다.

내용을 갱신할 때는 `scripts/sync-history-dictionary-catalog.mjs --project history-quiz-yongsin --apply`를 사용한다. 원본 검증 후 압축 조각을 저장·재검증하고 manifest를 버전 비교로 교체한다. 기존 원본이 이미 일치하고 조회용 묶음만 발행할 때는 `--snapshot-only --apply --expect-source-sha <검증한 sourceHash>`를 사용한다. 이 명령은 원본을 한 번 검증하며 원본을 수정하지 않는다. 직접 원본만 바꿔 manifest 갱신을 빠뜨리지 않는다. 조각·manifest가 없거나 손상되어도 전체 원본 조회로 우회하지 않는다.

배포는 스냅샷 게시 → `npm --prefix functions run check` → `firebase deploy --only "functions:getHistoryDictionaryContinuity" --project history-quiz-yongsin` → 프론트엔드 순서다. 구 클라이언트의 500개 페이지 조회도 압축 묶음에서 처리하므로 먼저 백엔드를 배포해도 호환된다. 기본 사전 화면에서는 학생 요청·교사 등록·학생 등록·알림 기록의 관리용 조회를 시작하지 않고 해당 탭에 들어갈 때 읽는다.

## 학생 개방 및 canonical 명령

2026-10-08 학생 개방 패치는 `functions/productionGateway`에 현재 운영 `executeCommand`
의 의존 소스를 별도로 보존한다. 원본과 변경 해시는 `source-manifest.json`으로 확인하며
다른 PC에서도 `npm --prefix functions run check`를 통과해야 한다. 루트에서 연결한
`executeCommand`, `getCommandStatus`, `executeLessonCorePointCommand`만 이 복구 소스의 명령 배포 대상이다.
디렉터리의 나머지 callable을 일괄 export하거나 모든 Functions를 배포하지 않는다.

2026-10-15 역사교실 안정화에서는 신규 면제권·응시 잠금 명령과 응답 유실 복구를 함께 지원하도록 `executeCommand`, `getCommandStatus` 두 함수를 배포한다. 명령 이름이나 학생 명령 분류를 바꾸면 상태 조회 함수의 동일 allowlist도 확인한다. [검증 기록](../reviews/history-classroom-stabilization-20261015.md)을 참고한다.

2026-10-15 평가 개선에서는 운영 소스를 대조한 `getAssessmentState`, `saveAssessmentProgress` 두 조회·저장 callable도 명시적으로 연결한다. 이 패치의 배포 대상은 서울 `executeCommand`, `getAssessmentState`, `saveAssessmentProgress` 세 함수다. 진단 기록은 기존 답안 저장에 함께 전송하며 채점·보상·응시 권한을 바꾸지 않는다. 다른 callable을 일괄 export하지 않는다. [설계 및 서술형·AI 검토](../reviews/assessment-design-20261015.md)를 참고한다.

학생 개방 전에는 교사 설정의 학생 접속 항목에서 현재 학기 평가 공개 상태를 점검하고,
현재 공개 설정에 해당하는 평가를 준비한다. 가입 승인·세션·학급 권한, 서버 저장/보상,
운영 프론트엔드와 Firebase 반영을 확인한 뒤 접속을 연다. 개방/제한 설정은 관리자
재인증과 서버 revision 비교를 사용한다. [점검 및 배포 기록](../reviews/student-opening-20261008.md)을 참고한다.

이번 패치의 Functions 대상은 아래 16개다. 후속 수정에서는 실제 변경한 함수만 선택한다.
학생 접속 제한을 유지한 채 배포하고, 실패한 대상은 개별 재시도한다.

```powershell
. .\scripts\use-westory-node.ps1
firebase deploy --only "functions:executeCommand,functions:executeLessonCorePointCommand,functions:updateStudentMaintenanceConfig,functions:claimStudentLearningReward,functions:getStudentVisibleLessons,functions:completeWeplayGuide,functions:getWeplayManagement,functions:saveWeplayGameSettings,functions:previewWeplayGame,functions:getWeplayPolicy,functions:saveWeplayPolicy,functions:getWeplayLobby,functions:startWeplayGame,functions:submitWeplayAnswer,functions:finishWeplayGame,functions:settleWeplayOnSchedule" --project history-quiz-yongsin
firebase deploy --only firestore:rules --project history-quiz-yongsin
firebase deploy --only storage --project history-quiz-yongsin
firebase functions:list --project history-quiz-yongsin
```

`applyPointActivityReward`, `createPointPurchaseRequest`, `submitHistoryClassroomResult`는
폐기된 과거 진입점이다. 로컬의 과거 구현을 이 이름으로 다시 배포해 활성화하지 않는다.
접속 설정은 관리자 화면의 명령을 사용하고 Firestore 직접 수정으로 revision·학기·감사
검사를 우회하지 않는다.

## 순위 조회 표시 복구 (2026-10-08)

### 대시보드 Top 5 조회 비용과 지연 (2026-10-20)

대시보드는 미국 `getWisRankingPreview`를 한 번 호출해 순위와 등급 정책을 함께 받는다.
Firestore `nam5`와 가까운 `us-central1`에서 읽기 전용 트랜잭션을 사용한다.
순위 조회 함수는 256MiB, 최소 인스턴스 0개, 최대 3개, 동시 요청 80개로 운영한다(2026-11-21 변경).
오래 사용하지 않은 뒤 첫 요청은 인스턴스 기동을 기다릴 수 있다.
주기적인 호출이나 캐시 갱신 요청으로 서버를 깨우지 않는다.
기존 서울/미국 `getWisEconomyState`와 전체 명예의 전당 조회는 그대로 유지한다.

현재 순위는 서버 전용 `semester_wis_preview_entries`의 학기·학년·점수·공개 ID
복합 인덱스에서 상위 후보 20명만 읽는다. 점수·등록 슬롯·학적·학급 변경 trigger가
현재 원본을 transaction에서 다시 읽어 해당 학생의 조회용 항목만 갱신한다.
계좌·거래·학생 프로필 원본은 수정하지 않는다. 브라우저의 직접 읽기·쓰기는 기존
rules의 기본 거부를 유지한다. 대시보드 조회 시 전교 학적 재집계나 계좌 전수 조회는 없다.
조회와 변경 반영에 타이머·폴링·자동 재시도를 추가하지 않는다.
세션·권한·학기·공개 설정은 매 요청 검사하고,
표시 후보의 현재 계좌·canonical 학적·이름 및 현재 등급 정책의 이모지는 다시 확인한다.
교사의 명시적 보관 조회는 기존의 당시 계좌 학적 기준을 유지하며, 최초 집계 때만
제한된 순위 ID에 대응하는 계좌를 읽어 누락되거나 오래된 순위 학적을 보완한다.
이 보관 조회 입력만 인스턴스 메모리에 30초간 최대 4개 범위까지 공유한다.
브라우저에는 학생 이름이나 순위 캐시를 저장하지 않는다.

검증은 `node scripts/verify-wis-ranking-preview.mjs`,
`npm --prefix functions run check`, 프론트엔드 변경 시 `npm run build`로 수행한다.
복합 인덱스 `semesterId / eligible / grade / rankEarnedTotal DESC / publicId`가
READY인지 먼저 확인한다. 기존 원격 인덱스를 삭제하지 않고 이 인덱스만 추가한다.
갱신 trigger 4개를 먼저 배포하고, 초기 조회용 자료를 검사·생성한 뒤 조회 함수를 배포한다.
기존 서울/미국 `getWisEconomyState`는 수정하거나 삭제하지 않는다.

```powershell
. .\scripts\use-westory-node.ps1
firebase deploy --only "functions:updateWisRankingIndexOnAccountWrite,functions:updateWisRankingIndexOnSlotWrite,functions:updateWisRankingIndexOnEnrollmentWrite,functions:updateWisRankingIndexOnClassWrite" --project history-quiz-yongsin
node functions/scripts/rebuild-wis-ranking-index.cjs --project history-quiz-yongsin
node functions/scripts/rebuild-wis-ranking-index.cjs --project history-quiz-yongsin --apply
firebase deploy --only "functions:getWisRankingPreview" --project history-quiz-yongsin
firebase functions:list --project history-quiz-yongsin
```

복구 도구는 기본 dry-run이며 계좌와 기존 조회용 항목의 합집합을 최대 2,000개까지
재검증한다. 놓친 삭제 이벤트의 고아 항목도 공개 대상에서 제거한다. 원본은 수정하지
않고 동일한 조회용 내용에는 쓰지 않는다. 이벤트 자동 재시도나 예약 재집계는 없다.

프론트엔드는 해당 커밋의 Vercel 배포를 운영 도메인에 승격한다. 운영 대시보드에서
5명과 등급의 표시, 새 callable 성공, 실제 응답 지연을 확인한다. 콜드 스타트와
사용자 네트워크 지연을 포함한 결과를 측정 없이 항상 1초 이내라고 보고하지 않는다.

`getWisEconomyState`의 운영 조회 소스는 `functions/productionGateway/wisEconomyQuery.js`에
별도로 복구했다. 실명·번호와 공개 범위 안의 프로필 이모지를 반환하며 기존 학년·학급,
학기 보관 조회, 로그인 세션 검사를 유지한다. `npm --prefix functions run check`에 조회와
실제 callable export 검사가 포함된다.

이 변경의 Firebase 배포 대상은 서울 `getWisEconomyState` 하나다. 같은 이름의 미국
함수는 그대로 유지한다. CLI 이름 필터는 리전을 구분하지 않으므로 대화형 배포를 사용하고,
미국 함수 삭제 질문에는 **No**를 선택해 서울 업데이트만 계속한다. `--force`를 사용하지 않는다.

```powershell
. .\scripts\use-westory-node.ps1
firebase deploy --only "functions:getWisEconomyState" --project history-quiz-yongsin
firebase functions:list --project history-quiz-yongsin
```

중첩 팝업의 닫힘·경로 이동 후 스크롤 복원은 `npm run verify:page-scroll-lock`으로
검증한다. 화면 검증에는 390·768·1280px의 학생/교사 알림장, 위스 순위와 명예 배지를 포함한다.

## 학생 등급별 프로필 이모지 제한 (2026-10-19)

등급 접근은 `studentProfileEmojiPolicy.js`의 공통 정책과 현재 학기의 canonical
`semester_wis_accounts.rankEarnedTotal`로 판정한다. 이전 `point_wallets`, 잔액,
저장된 상위 이모지, `emojiPolicy.enabled=false`는 해금 권한을 주지 않는다.
현재 등급까지 허용된 이모지만 저장·표시하며 미등록·비활성·ID/그림 불일치는
정책의 기본 이모지로 처리한다. 명예의 전당의 학생·교사·보관 학기 조회도 같은
판정을 사용하고 순위 공개 범위·읽기 전용 계약을 유지한다.

프로필, 현재 계좌, 등급 정책, 활성 학기 변경 trigger 4개는 실행 시점의 최신
포인터·정책·계좌·프로필을 transaction에서 다시 읽어 잘못된 선택만 정리한다.
점수·거래·순위·등록 정보는 수정하지 않는다. 신규 자기 프로필 생성 시에는 이모지
필드를 직접 지정할 수 없으며 승인 후 기존 서버 선택 기능을 사용한다.

기존 데이터 정리는 `node functions/scripts/fix-legacy-student-profile-emojis.cjs
--project=history-quiz-yongsin`으로 먼저 확인하고, 적용할 때 `--apply`와
`--backup=<저장소 밖의 새 JSON 경로>`를 추가한다. 변경 전 기록은 로컬에만 남기며
Git에 포함하지 않는다. 적용 중 선택·학기가 바뀌면 덮어쓰지 않고 재검사한다.
2026-10-19에는 학생 324명 중 등급에 맞지 않는 73명을 기본 이모지로 수정했고,
재검사에서 위반 0명과 정상 선택 보존을 확인했다.

배포 대상은 서울 `getWisEconomyState`, `updateStudentProfileIcon`,
`reconcileStudentProfileEmojiOnUserWrite`, `reconcileStudentProfileEmojiOnAccountWrite`,
`reconcileStudentProfileEmojiOnPolicyWrite`, `reconcileStudentProfileEmojiOnSemesterWrite`와
Firestore rules다. 미국의 기존 순위 함수는 삭제·재배포하지 않는다.
`npm --prefix functions run check`, `npm run build` 및
`firebase emulators:exec --only firestore --config firebase.student-access-test.json
--project demo-westory-session-student-access "node scripts/verify-student-access.mjs"`로
검증하고, 프론트엔드도 해당 커밋을 운영 도메인에 배포·승격한다.
