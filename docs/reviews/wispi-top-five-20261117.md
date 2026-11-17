# 위스피 상위 5명 시기별 수익률 검증 — 2026-11-17

## 반영 범위
- 교사 `학생 투자 현황`의 막대 그래프와 개인 선택형 `학생별 보유 수익률 변화` 영역을 제거했습니다.
- 현재 학급 범위에서 보유 수익률이 높은 최대 5명의 실제 이력을 한 시간 축의 꺾은선 그래프로 비교합니다. 순위는 기존 보유 원가 대비 평가손익의 정확한 분수 비교를 유지합니다.
- 표·범례·툴팁·네이티브 전체 화면·대체 전광판에서 학생 이름 전체를 표시합니다. `이름 숨김`과 전광판 진입 시 자동 가림은 제거했습니다. 서버 projection에 이미 전체 `displayName`이 있으므로 학생 포털, 서버 이름 저장, 권한 범위는 바꾸지 않았습니다.
- 서버에 저장된 확정 매매와 시세로 구성한 기존 이력 재구성을 재사용합니다. 시세 누락 및 무보유 구간은 선을 끊고, 기록 1건은 점만 표시합니다. 부족한 학생별 기록과 요청 오류를 표시합니다. 현재 값을 과거 날짜로 복제하지 않습니다.
- 화면에 수신된 가격 전용 갱신은 실제 수신 시각의 관측점으로 보관합니다. 학기·학급·권한·연결 경계에서는 폐기하며, 거래 원장 변경이나 상위 5명 변경 시 다시 조회합니다.

## 서버 호출과 권한
- 기존 `getWisStockInvestmentHistory`의 단일 `studentKey` 요청/응답을 유지하면서, 중복 없는 `studentKeys` 1~5명 일괄 요청을 추가했습니다.
- 권한/현재 학기/활성 세션/점검 상태/선택한 보드/시장 검증을 한 읽기 전용 트랜잭션에서 공유합니다. 각 계좌는 `studentKey == key`, 이력은 `accountId == id AND kind == ORDER_FILLED`로 조회하고 필요한 필드만 선택합니다. 분석에 필요한 체결 전체를 읽으며 임의 limit로 거래를 누락하지 않습니다. 계좌 limit 2는 중복 계좌 탐지 목적입니다.
- 브라우저의 정렬과 표 페이지 이동은 추가 이력 조회가 없습니다. 가격 전용 갱신은 추가 원장 조회가 없고, 명시 새로고침/재시도는 한 번의 최대 5명 요청입니다. 동일 계정·로그인 시각·학기·학급·학생 집합의 동시 요청만 공유합니다. 완료 후 캐시는 보관하지 않으며 응답 시 계정과 로그인 시각을 다시 확인합니다.
- 모의 fixture(5명, 각 BUY/SELL 2건)의 callable 트랜잭션: 공통 문서 8 + 계좌 5 + 체결 10 = **23문서**, 대상 한정 쿼리 10, 시장 파싱 1, 쓰기 0. 기존 단일 호출 5회는 같은 fixture에서 55문서입니다. 별도 `assertScoreWorkflowSession` 선행 가드의 읽기는 이 수치에 포함하지 않았습니다. projection은 전송 필드를 줄이며 문서 읽기 자체를 줄인다고 계산하지 않았습니다. 운영 읽기 비용을 측정한 값은 아닙니다.
- 졸업 정산 worker와 `ORDER_FILLED`/`SELL`, `atMs`, `sequence`, `unitPrice`, `stockCashDelta`, `realizedPnl` 호환을 확인했습니다. 보상 이체는 보유 원가와 무관하므로 수익률 계산에 넣지 않습니다.

## 디자인과 반응형
- 단일 디자인 기준: education-web-design-system, 기존 DESIGN.md/UI_RULES.md 지도 계약.
- 기존 `--ws-primary`, `--ws-success`, `--ws-danger`, `--ws-accent-text`, `--ws-text`, `--ws-border`, `--ws-surface`를 사용합니다. 새 색 토큰은 없습니다. 8/12/16/24px 간격, 기존 모서리, 보조 12/14px와 제목 16px을 유지했습니다.
- 다섯 선은 색·서로 다른 실선/점선과 이름/순위가 있는 범례로 구별합니다. 좌우키는 실제 관측 시각, 위아래키는 학생을 바꿉니다. Home/End/Escape 및 포인터 입력을 제공합니다.
- 제목/필터 배경은 투명하고 그림자가 없습니다. 선 그래프는 본문 콘텐츠 영역입니다. 좁은 화면은 범례만 자연스럽게 줄바꿈하고 데이터 표의 기존 내부 가로 스크롤을 유지합니다.
- 브라우저 fixture의 320/390/768/1280px에서 documentWidth가 각각 viewport와 동일했습니다. 차트 너비는 288/358/736/1056px이었습니다. 긴 이름을 잘라내지 않고 줄바꿈했습니다.

## 실행한 검증
- `npm run typecheck`: 통과.
- `node functions/scripts/verify-wis-stock-investment-board.cjs`: 9개 통과.
- `node scripts/verify-wis-stock-investment-board-client.mjs`: 6개 검사 그룹 통과(모의 읽기 24, 쓰기 0).
- `node scripts/verify-wis-stock-investment-returns.mjs`: 12개 그룹 통과.
- `node functions/scripts/verify-wis-stock-investment-history.cjs`: 15개 그룹 통과.
- `node functions/scripts/verify-wis-stock-investment-history-batch.cjs`: 14개 그룹 통과. 5명 제한/중복/입력 오류/학생 역할/비활성 사용자/학기 변경/세션 변경/범위 밖 학생/단일 호출 호환/정확한 계좌별 원장/읽기 전용 검증.
- `node scripts/verify-wis-stock-investment-history-client.mjs`: 22개 그룹 통과. 역순 학생 집합 중복 요청 공유, 5명 제한, 응답 누락·중복·다른 학급·학기·학생 거부, 계정 변경과 재시도, 실제 Firebase factory의 us-central1 라우팅 포함.
- `node scripts/verify-wis-stock-investment-board-browser.mjs`: 4개 종합 그룹 통과. 실제 컴포넌트/CSS와 합성 watcher/history 입력으로 크기 4종, 접근성, 전체 이름, 단절/점/빈 기록/오류/재시도/이전 학급 응답 폐기, 이름 전체 표시 네이티브 및 대체 전광판, 원장 추가 조회 없음 확인. 모든 외부 네트워크는 차단하며 운영 읽기/쓰기 0입니다.
- `node --check functions/wisStockInvestmentHistory.js`: 통과.
- 스크린샷 확인: `output/wispi-top-five-20261117/board/board-390.png`, `board-long-name-1280.png`; 자동 측정/소스 해시는 같은 폴더 `report.json`에 있습니다. 산출 이미지는 실제 학생 데이터가 없는 검증 fixture입니다.

## 운영 반영
- 배포 대상: 기존 `getWisStockInvestmentHistory`(us-central1)와 프론트엔드. rules/index 신규 변경 없음.
- 이 작업자는 운영 데이터 읽기/쓰기, 배포, 커밋, 푸시를 실행하지 않았습니다. 전체 build/Functions check 및 운영 배포·실사이트 검증은 총괄 작업자가 담당합니다.
- 런타임 AI 호출, 외부 AI 전송, 학생/교사 권한 정책, 개인정보 수집 항목에는 변경이 없습니다.

## 추가 요청: 졸업·보상 UI 독립 검증
- 총괄 작업자가 수정한 `src/lib/wisStocksClient.ts`, `src/lib/studentWisStockTypes.ts`, 학생 `WisStocks.tsx`/`StudentWisStockAccountPanel.tsx`, 교사 `TeacherWisStocks.tsx`를 읽고 실제 컴포넌트 fixture로 검증했습니다. 이 파일들은 이 작업자가 수정하지 않았습니다.
- `node scripts/verify-student-wispi-browser.mjs --graduation-only`: 320/390/768/1280px 졸업 매수·매도 비활성/정산 사유/주문0, 이벤트 500 보상 서버 응답 문구/잔액/졸업·보상 내역 라벨 확인. 합성 호출만 실행했습니다.
- `node scripts/verify-student-wispi-browser.mjs`: 신규 사례를 포함해 26개 전체 검사 그룹 통과. 기존 주문 응답 유실·재시도·이중 클릭·시세 변동·취소·재인증·학기/계정 변경·조회 재사용·43건 커서 내역 등 회귀 포함.
- `node scripts/verify-wis-stocks-browser.mjs --graduation-only`: 네 크기에서 교사 졸업 확인창의 마지막 가격/불가역 안내, 취소 시 저장0/승인 시 저장1, 완료 후 설정/저장 비활성, 새 종목 등록 시 졸업 선택 없음 확인. 합성 저장만 실행했습니다.
- `node scripts/verify-student-wispi-client.mjs`, `node scripts/verify-wis-stocks-client.mjs`: 기존 두 클라이언트 검사 통과.
- `node scripts/verify-wis-village-navigation.mjs`: 다섯 종합 검사 그룹 통과(36개 실제 라우트 레이아웃 포함). 교사/village fixture의 보드 이력 stub 이름을 새 배치 export와 맞췄습니다.
- 추가 증거: `output/wispi-top-five-20261117/student-graduation`, `student-full`, `teacher-graduation`; village는 `output/wis-menu-integration-20261117`.
- 독립 검토에서 추가 소스 수정이 필요한 결함은 발견하지 않았습니다. 실제 졸업 처리·운영 거래는 실행하지 않았습니다.
