# 위스피 해외 주식·일일 환율·환전·독립 메뉴 (2026-11-26)

## 범위와 기준

- 기준은 `main`의 `d13c9cd`(윷놀이 명령 함수 00014 배포 기록)이며 작업 브랜치는 `wispi-overseas-fx`다. 서버 로직과 화면을 별도 커밋으로 나눴다.
- 사용자 지시 7개를 반영한다: 주식 계좌의 위스↔유스 환전(일일 1회 환율), `주식 지갑` → `주식 계좌`, 주식 알림의 상장 폐지, 세계사 흐름의 해외 종목, 해외 가격 단위 `유스`, 해외 시세 10분 갱신, 위스피 독립 상위 메뉴와 학생·교사 화면 개편.
- 환율 비율은 사용자 선택에 따라 `1,000유스 = round(원/달러 기준환율)위스`다. 환율이 1,470원이면 1,000유스는 1,470위스다.

## 서버

- 해외 시장은 국내 시장 문서와 분리한 `overseas_market` 관리 문서·`overseas_current`/`overseas_market` 공개 문서·`wis_stock_overseas_accounts` 계좌·별도 주문/내역/공급/작업 큐를 쓴다. 국내 시장 문서가 종목 상한(100)에 가까워 같은 문서에 넣지 않았다. 가격 엔진·주문 체결·졸업 정산은 같은 코드를 시장(venue) 매개변수로 재사용하며 국내 동작은 바꾸지 않는다.
- 종목은 신항로 개척 9 → 절대 왕정과 중상주의 8 → 산업 혁명 7 → 제국주의 6, 모두 30개다. 해외 시장은 실제처럼 시차를 두어 평일 오후 4시~11시(한국 시각)에 연다(사용자 지시, 2026-11-26). 교사가 시작 월요일을 적용하면 그날 오후 4시부터 주 5일·하루 7회(16~22시 매시) 일정에 따라 상장하고, 종목별 상승·하락 구간과 존속·합병·상장 폐지가 역사 흐름에 맞춰 가격 추세에 더해진다. 일정 적용 시 국내 시장의 거래 요일·수수료·한도를 복사하고 거래 시간은 16:00~23:00, 최소 잔액은 0으로 둔다. 시세는 국내와 같은 10분 주기지만 별도 예약 작업 `advanceWisStockOverseasPrices`가 갱신해, 해외 쪽 실패나 재시도가 국내 `advanceWisStockPrices`를 지연·재실행하지 않는다. 설명의 사실 부분과 `게임 설정:` 문장을 구분했다.
- 환율은 매일 07:05(한국 시각) ECB 기준환율(Frankfurter)을 받고 실패하면 ExchangeRate-API 공개 값으로 대체한다. 하루 한 값만 저장하며 전날보다 15% 넘게 바뀌면 저장하지 않는다. 교사는 `환율 지금 받기`로 같은 작업을 수동 실행할 수 있고 같은 날 다시 받지 않는다.
- 환전은 서버 명령 한 번으로 위스 계좌와 유스 계좌를 같은 트랜잭션에서 바꾼다. 그날 환율로 고정하고 양방향 모두 내림한다. 예약금·이벤트 지원금 원금은 환전 가능 금액에서 제외하고, 요청 ID 영수증으로 중복 실행을 막는다. 랭킹은 보유 수익률 기준이므로 환전이 순위를 바꾸지 않는다. 해외 시장에는 별도 투자 랭킹·학급 보드가 없다.
- 전광판·학생 공개 시세에 상장 시각과 거래 종료(시각·사유: 상장 폐지/합병/거래 종료)를 추가했다.

## 화면

- 위스피는 `위스` 아래에서 분리한 독립 상위 메뉴다. 학생 `국내 주식 / 해외 주식 / 주식 계좌 / 환전 / 투자 랭킹`, 교사 `국내 종목 관리 / 해외 시장 / 시장 규칙 / 주식 차트 관리 / 학생 투자 현황 / 주식 보고서`이며 `?tab=` 주소를 쓴다. 저장된 메뉴 설정은 이전 위스피 항목의 숨김 여부와 교사가 바꾼 이름을 유지한 채 위스 바로 뒤로 옮긴다. `/teacher/points?tab=stocks`는 `/teacher/wispi`로 이동한다. 학생 메뉴는 이전처럼 시장 공개 중에만 보이며, `주식 보고서` 하위 메뉴는 화면과 같이 교사 계정에만 보인다.
- 학생: 제목 옆 오늘 환율, 시장 탭의 `주식 알림`(오늘 신규 상장·상장 폐지·합병), 해외 목록의 `거래 종료` 묶음, 주식 계좌의 총자산·위스/유스 계좌 전환, 환전 탭의 환율 기록·방향 선택·빠른 금액·받을 금액 미리보기.
- 교사: `해외 시장` 탭의 열기/닫기, 일정 적용, 시대별 상장 수, 다가오는 거래 종료, 시세·봉차트·역사 배경. 전광판 속보는 오늘의 상장 폐지·합병·거래 종료를 한 번 알리고 음성으로 읽는다.
- 새 색·글꼴·간격 토큰은 없다. 설계 기록은 `DESIGN.md`의 2026-11-26 항목, 메뉴 규칙은 `UI_RULES.md`에 반영했다.

## 비용

- 새 예약 작업 3개: `refreshWisStockFxRate`(매일 07:05, 오늘 값이 있으면 1읽기·0쓰기, 새 값이면 외부 GET과 트랜잭션 1읽기·1쓰기), `advanceWisStockOverseasPrices`(10분마다, 학기 설정과 해외 시장 문서 약 2읽기, 해외 장중 시세가 바뀌면 관리·공개 문서 쓰기), `recoverWisStockOverseasOrders`(10분마다, 미처리 해외 주문·거래 종료 정산 조회 2회). 해외 시장을 쓰지 않아도 10분 작업 두 개가 하루 약 576읽기를 만든다. Cloud Scheduler 무료 범위(결제 계정당 3개)를 이미 쓰고 있으면 작업당 월 약 0.1달러가 늘어난다.
- 국내 `advanceWisStockPrices`의 읽기·쓰기 횟수는 그대로다. 새 작업 큐 `settleWisStockOverseasOrderTask`는 학생 해외 주문이 있을 때만 실행된다.
- 학생 화면은 해외 탭이나 계좌·환전 탭을 열 때만 해외 공개 문서·유스 계좌·환율 문서를 구독한다.

## 개인정보와 외부 호출

- 외부 호출은 공개 환율 API에 대한 인증 없는 GET뿐이며 학생·교사 정보는 보내지 않는다. 런타임 AI 호출·에이전트 실행은 없다.
- 환율 문서는 학생·계정 정보가 없고 활성 세션 사용자(`canUseWestory()`)가 `current` 한 건만 읽을 수 있다. 유스 계좌는 국내 주식 계좌와 같은 소유 확인 규칙을 그대로 복사했고 쓰기는 서버만 한다.
- 공개 환율 API(Frankfurter, ExchangeRate-API)는 새 외부 서비스다. 날짜·계정 정보 없이 고정 주소를 GET하며 응답은 64KiB를 넘으면 버린다. `docs/runbooks/security-review.md`의 외부 서비스 변경 기준에 따라 담당부서 재검토 필요 여부를 확인할 대상으로 기록한다.

## 검증

- `functions/scripts/verify-wis-stock-overseas.cjs`(인메모리 Firestore) 11개: 상장 일정·역사 추세·상장 폐지/합병 정산, 해외 주문 체결과 단위, 환율 수집·같은 날 재수집 생략·급변 거부, 환전 양방향 내림·잔액 부족·예약금 제외·영수증 중복 차단, 졸업 정산, 로고 매핑.
- 국내 회귀: 기존 위스피 서버·클라이언트 검사 결과가 기준 커밋과 같다(환경상 실행할 수 없는 브라우저/에뮬레이터 항목 제외).
- `scripts/verify-teacher-nav.mjs`·`scripts/verify-student-portal-layout.mjs`를 새 메뉴 구조로 갱신했다(이전 저장 메뉴 이동·숨김·이름 유지, 위스 묶음에서 제거, 탭별 현재 위치, 직원 권한).
- `scripts/verify-student-wispi-client.mjs`에 해외 시장·환전 4항목, `scripts/verify-wis-stock-bulletins.mjs`에 상장 폐지·합병 속보 순서·하루 1회·재연결 중복 방지를 추가했다.
- 모의 자료로 학생 국내/해외/계좌/환전 탭과 교사 해외 시장 탭을 390/1280px에서 확인했다. 가로 넘침은 없다.
- 클라우드 작업 환경에서는 `npm run build`, 에뮬레이터 거래 검사, 배포를 실행하지 못했다. 같은 날 위스토리 PC에서 이어받아 아래를 실행했다.

### 위스토리 PC 검증과 보완 (2026-11-26 밤)

- 실행: `npm run build`, `npm --prefix functions run check`, `npm run test:wispi-trading`·`test:wispi-access`·`test:score-request-rules`(에뮬레이터), `npm run verify:wispi-client`, `verify-teacher-nav`·`verify-student-portal-layout`·`verify-wis-stock-bulletins`, `npm run verify:portal-design`.
- 독립 검토(서버·규칙 / 화면·메뉴) 결과를 반영했다.
  - 로고 대응표 검사 정규식이 정렬 후 들여쓰기(4칸)를 찾지 못해 Functions 검사가 실패하던 것을 고쳤다.
  - 환율 원값의 소수부가 [.495, .5)이면 저장한 두 자리 값과 적용 환율의 반올림이 달라 그날 환율 문서를 읽지 못하던 문제: 적용 환율을 저장 값에서 계산한다.
  - 15% 급변 거부가 오래된 저장 값과 비교해 영구히 막을 수 있던 문제: 최근 7일 안의 저장 값과만 비교한다.
  - 교사 플로팅 바로가기: 저장된 `/teacher/points?tab=stocks`를 `/teacher/wispi`로 읽고, 규칙 허용 목록에 위스피 탭 6개를 추가했다. 이전에는 불러오기 실패, 편집 창 오류 화면, 새 위스피 바로가기 저장 거부가 생겼다.
  - 학생 위스피: 브라우저 탭 전환 등으로 공개 상태가 다시 연결되는 동안 화면을 숨긴 채 유지해 주문 창·검색·입력 금액을 잃지 않는다(이전 화면과 같은 동작).
  - 사이트맵에서 숨긴 위스피 탭은 화면 안 탭에서도 숨기고, 다른 탭이 보이면 공용 상태를 계속 읽는다.
  - `scripts/verify-portal-design.mjs`를 새 메뉴 구조로, 규칙 검사에 해외 계좌·해외 공개 문서·환율 문서·바로가기 경로를 추가했다.
- 해외 장 시간 16:00~23:00과 별도 시세 작업은 위 서버 항목과 같다.
- 남은 한계: 국내 `getStudentWisStockHistory`는 운영 판이 기준 커밋과 달라 다시 배포하지 않았다. 국내 주식 계좌의 환전 내역 줄은 '환전'과 금액만 보이고 방향·환율·상대 금액은 해외 계좌 내역에서 보인다. 교사 투자 현황의 총자산(주식 계좌 현금+보유)은 유스로 바꾼 만큼 줄어든다(수익률 순위는 보유 기준이라 영향 없음).

## 배포 절차

운영 함수는 함수마다 원본(ZIP)이 저장소와 달라, 저장소 전체를 기존 함수에 배포하지 않는다.

1. 위 검사를 모두 통과한 커밋에서 Firestore 규칙을 `node scripts/release-firestore-rules.mjs release`로 반영한다. 색인은 `firestore:indexes` 전체 배포 대신 새 복합 색인 2개만 만들고 READY를 확인한다(운영에만 있는 색인을 지우지 않기 위해).
2. 새 함수 16개는 이름을 지정해 저장소 원본에서 배포한다: `getWisStockOverseasManagement, saveWisStockOverseasMarketRules, setWisStockOverseasMarketHalted, activateWisStockOverseasCatalogPlan, refreshWisStockFxRateNow, refreshWisStockFxRate, advanceWisStockOverseasPrices, exchangeStudentWisStockCurrency, getStudentWisStockOverseasState, getStudentWisStockOverseasHistory, placeStudentWisStockOverseasOrder, cancelStudentWisStockOverseasOrder, onWisStockOverseasOrderCreated, onWisStockOverseasMarketTradingWrite, settleWisStockOverseasOrderTask, recoverWisStockOverseasOrders`. 주문 트리거와 정산 작업 큐는 함께 배포한다.
3. 국내 시장 관리 함수 7개(`advanceWisStockPrices, getWisStockManagement, saveWisStock, saveWisStockMarketRules, setWisStockMarketHalted, activateWisStockCatalogPlan, activateWisStockCatalogExits`)는 같은 운영 원본을 공유한다. `node scripts/prepare-wispi-overseas-release.mjs prepare`가 그 원본에서 시장 모듈 3개만 커밋본으로 바꾸고 새 모듈 4개를 더한 준비본을 만든다(색다른 운영 차이는 `wisStocks.js`의 `advanceScheduledSlot` export 한 줄뿐). `preflight` 뒤 준비본에서 이름을 지정해 배포하고 `verify`로 파일·자원을 대조한다. 국내 학생 공개 시세에 상장 시각과 거래 종료가 실린다.
4. 전광판 `onWisStockMarketTradingWrite`는 `scripts/prepare-function-release.mjs`로 `wisStockDisplay.js`의 변경 블록만 운영 원본에 적용한다. 그 밖의 국내 주문·체결·내역·랭킹·보고서 함수는 다시 배포하지 않는다.
5. 프런트엔드를 Vercel `westory`에 배포하고 승격한다.
6. 교사 `위스피 → 해외 시장`에서 `환율 지금 받기`(첫날), `해외 상장 일정 적용`(월요일 시작), `해외 시장 열기` 순서로 공개한다. 학생 공개이므로 사용자 확인 뒤에만 누른다.
