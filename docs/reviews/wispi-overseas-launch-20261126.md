# 위스피 해외 주식·일일 환율·환전·독립 메뉴 (2026-11-26)

## 범위와 기준

- 기준은 `main`의 `d13c9cd`(윷놀이 명령 함수 00014 배포 기록)이며 작업 브랜치는 `wispi-overseas-fx`다. 서버 로직과 화면을 별도 커밋으로 나눴다.
- 사용자 지시 7개를 반영한다: 주식 계좌의 위스↔유스 환전(일일 1회 환율), `주식 지갑` → `주식 계좌`, 주식 알림의 상장 폐지, 세계사 흐름의 해외 종목, 해외 가격 단위 `유스`, 해외 시세 10분 갱신, 위스피 독립 상위 메뉴와 학생·교사 화면 개편.
- 환율 비율은 사용자 선택에 따라 `1,000유스 = round(원/달러 기준환율)위스`다. 환율이 1,470원이면 1,000유스는 1,470위스다.

## 서버

- 해외 시장은 국내 시장 문서와 분리한 `overseas_market` 관리 문서·`overseas_current`/`overseas_market` 공개 문서·`wis_stock_overseas_accounts` 계좌·별도 주문/내역/공급/작업 큐를 쓴다. 국내 시장 문서가 종목 상한(100)에 가까워 같은 문서에 넣지 않았다. 가격 엔진·주문 체결·졸업 정산은 같은 코드를 시장(venue) 매개변수로 재사용하며 국내 동작은 바꾸지 않는다.
- 종목은 신항로 개척 9 → 절대 왕정과 중상주의 8 → 산업 혁명 7 → 제국주의 6, 모두 30개다. 교사가 시작 월요일을 적용하면 주 5일·하루 7회(09~15시) 일정에 따라 상장하고, 종목별 상승·하락 구간과 존속·합병·상장 폐지가 역사 흐름에 맞춰 가격 추세에 더해진다. 시세는 국내와 같은 10분 스케줄(`advanceWisStockPrices`)에서 함께 갱신한다. 설명의 사실 부분과 `게임 설정:` 문장을 구분했다.
- 환율은 매일 07:05(한국 시각) ECB 기준환율(Frankfurter)을 받고 실패하면 ExchangeRate-API 공개 값으로 대체한다. 하루 한 값만 저장하며 전날보다 15% 넘게 바뀌면 저장하지 않는다. 교사는 `환율 지금 받기`로 같은 작업을 수동 실행할 수 있고 같은 날 다시 받지 않는다.
- 환전은 서버 명령 한 번으로 위스 계좌와 유스 계좌를 같은 트랜잭션에서 바꾼다. 그날 환율로 고정하고 양방향 모두 내림한다. 예약금·이벤트 지원금 원금은 환전 가능 금액에서 제외하고, 요청 ID 영수증으로 중복 실행을 막는다. 랭킹은 보유 수익률 기준이므로 환전이 순위를 바꾸지 않는다. 해외 시장에는 별도 투자 랭킹·학급 보드가 없다.
- 전광판·학생 공개 시세에 상장 시각과 거래 종료(시각·사유: 상장 폐지/합병/거래 종료)를 추가했다.

## 화면

- 위스피는 `위스` 아래에서 분리한 독립 상위 메뉴다. 학생 `국내 주식 / 해외 주식 / 주식 계좌 / 환전 / 투자 랭킹`, 교사 `국내 종목 관리 / 해외 시장 / 시장 규칙 / 주식 차트 관리 / 학생 투자 현황 / 주식 보고서`이며 `?tab=` 주소를 쓴다. 저장된 메뉴 설정은 이전 위스피 항목의 숨김 여부와 교사가 바꾼 이름을 유지한 채 위스 바로 뒤로 옮긴다. `/teacher/points?tab=stocks`는 `/teacher/wispi`로 이동한다. 학생 메뉴는 이전처럼 시장 공개 중에만 보이며, `주식 보고서` 하위 메뉴는 화면과 같이 교사 계정에만 보인다.
- 학생: 제목 옆 오늘 환율, 시장 탭의 `주식 알림`(오늘 신규 상장·상장 폐지·합병), 해외 목록의 `거래 종료` 묶음, 주식 계좌의 총자산·위스/유스 계좌 전환, 환전 탭의 환율 기록·방향 선택·빠른 금액·받을 금액 미리보기.
- 교사: `해외 시장` 탭의 열기/닫기, 일정 적용, 시대별 상장 수, 다가오는 거래 종료, 시세·봉차트·역사 배경. 전광판 속보는 오늘의 상장 폐지·합병·거래 종료를 한 번 알리고 음성으로 읽는다.
- 새 색·글꼴·간격 토큰은 없다. 설계 기록은 `DESIGN.md`의 2026-11-26 항목, 메뉴 규칙은 `UI_RULES.md`에 반영했다.

## 비용

- 새 예약 작업 2개: `refreshWisStockFxRate`(매일 1회, 1읽기·1쓰기)와 `recoverWisStockOverseasOrders`(10분마다, 미처리 주문 조회 1회). Cloud Scheduler 무료 범위(결제 계정당 3개)를 이미 쓰고 있으면 작업당 월 약 0.1달러가 늘어난다.
- `advanceWisStockPrices`는 해외 시장 문서 1개를 추가로 읽고 개장 중이면 관리·공개 문서를 쓴다. 해외 시장을 열지 않으면 추가 쓰기는 없다. 새 작업 큐 `settleWisStockOverseasOrderTask`는 학생 해외 주문이 있을 때만 실행된다.
- 학생 화면은 해외 탭이나 계좌·환전 탭을 열 때만 해외 공개 문서·유스 계좌·환율 문서를 구독한다.

## 개인정보와 외부 호출

- 외부 호출은 공개 환율 API에 대한 인증 없는 GET뿐이며 학생·교사 정보는 보내지 않는다. 런타임 AI 호출·에이전트 실행은 없다.
- 환율 문서는 학생·계정 정보가 없고 로그인 사용자가 `current` 한 건만 읽을 수 있다. 유스 계좌는 국내 주식 계좌와 같은 소유 확인 규칙을 그대로 복사했고 쓰기는 서버만 한다.

## 검증

- `functions/scripts/verify-wis-stock-overseas.cjs`(인메모리 Firestore) 11개: 상장 일정·역사 추세·상장 폐지/합병 정산, 해외 주문 체결과 단위, 환율 수집·같은 날 재수집 생략·급변 거부, 환전 양방향 내림·잔액 부족·예약금 제외·영수증 중복 차단, 졸업 정산, 로고 매핑.
- 국내 회귀: 기존 위스피 서버·클라이언트 검사 결과가 기준 커밋과 같다(환경상 실행할 수 없는 브라우저/에뮬레이터 항목 제외).
- `scripts/verify-teacher-nav.mjs`·`scripts/verify-student-portal-layout.mjs`를 새 메뉴 구조로 갱신했다(이전 저장 메뉴 이동·숨김·이름 유지, 위스 묶음에서 제거, 탭별 현재 위치, 직원 권한).
- `scripts/verify-student-wispi-client.mjs`에 해외 시장·환전 4항목, `scripts/verify-wis-stock-bulletins.mjs`에 상장 폐지·합병 속보 순서·하루 1회·재연결 중복 방지를 추가했다.
- 모의 자료로 학생 국내/해외/계좌/환전 탭과 교사 해외 시장 탭을 390/1280px에서 확인했다. 가로 넘침은 없다.
- 이 작업 환경에는 프로젝트 의존성 설치·Firebase 에뮬레이터·운영 접근이 없어 `npm run build`, 에뮬레이터 거래 검사, 배포는 실행하지 않았다.

## 배포 절차

1. `npm ci && npm run build`, `npm --prefix functions run check`와 기존 위스피 검사(`npm run test:wispi-trading`, `npm run verify:wispi-client`)를 실행한다.
2. `firebase deploy --project history-quiz-yongsin --only firestore:rules,firestore:indexes`로 규칙과 색인을 먼저 배포하고 색인 생성 완료를 확인한다.
3. 위스피 함수 전체를 배포한다: 새 함수 `getWisStockOverseasManagement, saveWisStockOverseasMarketRules, setWisStockOverseasMarketHalted, activateWisStockOverseasCatalogPlan, refreshWisStockFxRateNow, refreshWisStockFxRate, exchangeStudentWisStockCurrency, getStudentWisStockOverseasState, getStudentWisStockOverseasHistory, placeStudentWisStockOverseasOrder, cancelStudentWisStockOverseasOrder, onWisStockOverseasOrderCreated, onWisStockOverseasMarketTradingWrite, settleWisStockOverseasOrderTask, recoverWisStockOverseasOrders`와 공용 코드가 바뀐 기존 위스피 함수(`advanceWisStockPrices`, 주문·체결·졸업·관리·공개 함수).
4. 프런트엔드를 Vercel `westory`에 배포하고 승격한다.
5. 교사 `위스피 → 해외 시장`에서 `환율 지금 받기`(첫날), `해외 상장 일정 적용`(월요일 시작), `해외 시장 열기` 순서로 공개한다.
