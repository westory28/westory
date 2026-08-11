# Future Wis Investment Extension Handoff

## 목적

W7의 위스는 학기별 교육 활동과 상품 주문을 위한 내부 포인트 경제입니다. 이자, 예금, 투자, 수익률, 시장 가격, portfolio는 W7 범위에 포함하지 않았습니다. 향후 확장을 검토할 때 W7 Ledger를 훼손하지 않고 교육적 의미와 학생 보호를 먼저 세우기 위한 기준을 이 문서에 남깁니다.

## 기본 원칙

- 실제 돈, 암호화폐, 현금성 자산과 연결하지 않습니다.
- 확률형 보상, loot box, 베팅, 손실 만회 유도, 과도한 경쟁을 만들지 않습니다.
- 학생이 이해할 수 있는 위험·수익·기간·수수료 설명을 제공합니다.
- 성적, 출석, 행동 점수를 투자 손익과 직접 결합하지 않습니다.
- 투자 참여 여부가 수업 기회나 기본 보상에 불이익을 주지 않습니다.
- 교사는 시장을 임의 조작하거나 특정 학생만 유리하게 만들 수 없습니다.
- 보호자·학교 정책, 개인정보 최소화, 연령 적합성을 먼저 검토합니다.

## W7과의 경계

기존 경로의 역할은 바꾸지 않습니다.

- `semester_wis_ledger`: 확정된 WIS 현금성 이동의 불변 원장
- `semester_wis_accounts`: 학기별 Account head
- Balance / Ranking: 확정 Ledger만 반영하는 projection
- Product / Inventory / Order: 상점 domain

투자 평가액을 Account balance에 실시간 합산하지 않습니다. 투자 주문 체결로 WIS가 이동할 때만 W7 Ledger에 `INVESTMENT_DEBIT`, `INVESTMENT_CREDIT`, `FEE`, `REVERSAL` 같은 확정 entry를 남깁니다. 미실현 평가손익은 별도 valuation projection입니다.

## 별도 canonical model 제안

명칭은 구현 Wave에서 확정하되 최소한 다음 성격을 분리합니다.

| 성격                | 제안 경로                                        | 변경 방식                   |
| ------------------- | ------------------------------------------------ | --------------------------- |
| 교육용 상품 정의    | `wis_investment_instruments`                     | 교사 승인, versioned policy |
| 학기 시장 상태      | `semester_wis_markets`                           | OPEN/CLOSED와 가격 정책 CAS |
| 학생 portfolio head | `semester_wis_portfolios`                        | position projection         |
| 주문                | `semester_wis_investment_orders`                 | 결정적 ID와 상태 전이       |
| 체결                | `semester_wis_investment_trades`                 | immutable                   |
| 가격 snapshot       | `semester_wis_price_snapshots`                   | immutable, 시간·source 고정 |
| 평가 projection     | `semester_wis_valuations`                        | 재구축 가능                 |
| 대조 보고서         | `semester_wis_investment_reconciliation_reports` | Ledger·trade·position 대조  |

실제 시장 API를 바로 연결하지 마십시오. 학교 수업에 맞는 정해진 시나리오, 교사 승인 데이터, 명확한 update 주기를 우선합니다.

## Command 계약

모든 mutation은 W2 Command Gateway를 사용합니다. 예시는 다음과 같습니다.

- `createWisInvestmentMarket`
- `upsertWisInvestmentInstrumentVersion`
- `transitionWisInvestmentMarket`
- `placeWisInvestmentOrder`
- `cancelWisInvestmentOrder`
- `settleWisInvestmentOrders`
- `rebuildWisInvestmentProjection`

주문에는 semester, account, instrument version, expected market/account/portfolio revision, quantity, limit rule, policy version을 넣습니다. 체결 ID와 Ledger reference는 결정적으로 생성합니다. 응답 유실, 동시 주문, 재시도에서도 debit·credit과 trade effect는 한 번이어야 합니다.

## 가격과 공정성

- 가격 source, 계산식, 적용 시각을 학생에게 설명합니다.
- 교사가 가격을 바꾸면 새 version과 사유를 남깁니다.
- 이미 접수된 주문에 어느 가격 snapshot을 적용했는지 고정합니다.
- 학생별 다른 가격이나 비공개 우대 조건을 허용하지 않습니다.
- 수익률 순위만으로 학생을 공개 비교하지 않습니다.
- 시장 종료 뒤 가격·체결을 수정하지 않고 correction entry를 추가합니다.

## 위험 안내와 접근성

화면에는 최소한 다음 내용을 text로 제공합니다.

- 원금 손실 가능성
- 실현·미실현 손익의 차이
- 수수료와 거래 제한
- 가격 update 시각
- 교육용 모의 활동이며 실제 금융상품이 아니라는 안내
- 도움말과 교사 문의 경로

색상만으로 수익과 손실을 표시하지 않습니다. 표와 chart는 screen reader용 요약, keyboard 접근, 충분한 대비를 제공해야 합니다. 모바일에서는 복잡한 거래 표를 작은 카드로 억지 변환하지 않고 핵심 조회와 안전한 주문만 제공합니다.

## Semester / Archive / Legacy

- 투자 시장과 portfolio는 semester scope를 갖습니다.
- 새 학기 Account는 0에서 시작하며 과거 position을 자동 복제하지 않습니다.
- CLOSED 이후 신규 주문·취소·체결 0
- ARCHIVE에서는 당시 price snapshot과 valuation을 read-only로 표시
- CURRENT가 비어도 과거 portfolio를 silent fallback하지 않음
- Legacy 승격에는 position·trade·Ledger join 100%와 관리자 승인 필요

## Readiness와 대조

필수 check 후보는 다음과 같습니다.

- trade의 order·instrument version·price snapshot join 100%
- position 수량과 trade 합계 일치
- W7 Ledger debit/credit와 settlement 합계 일치
- 음수 현금·허용하지 않은 short position 0
- unsettled order와 partial settlement 명시
- 중복 trade/reference 0
- price policy/version 지원
- Archive mutation 0
- blocking Legacy issue 0

전체 trade를 매번 W3 transaction에서 읽지 말고 최신 immutable reconciliation report와 captured revision/hash를 dependency root로 사용합니다.

## 개인정보와 운영

- 공개 순위에 학생 실명·학번·상세 portfolio를 노출하지 않습니다.
- 교사는 담당 학급·capability 범위만 조회합니다.
- 관리자 audit에는 actor, policy, source, before/after, reason을 남깁니다.
- query mount에서 settlement나 valuation repair를 실행하지 않습니다.
- notification 실패가 trade settlement를 rollback하지 않도록 outbox를 분리합니다.
- Production 도입 전 학교 정책과 교육적 목표를 별도 승인받습니다.

## 선행 결정

구현 Wave를 열기 전에 다음을 확정해야 합니다.

1. 학습 목표와 대상 학년
2. 실제 시장 연동 여부와 허용 가능한 가격 source
3. 거래 시간, 수수료, 보유 한도, 손실 한도
4. 교사 개입과 correction 권한
5. 순위·보상 정책과 학생 보호 장치
6. 학기 종료 settlement와 Archive 표시
7. 보호자·학교 안내와 데이터 보존 기간

이 결정이 없으면 실제 투자 기능을 시작하지 않습니다. W7 상점과 Ledger만으로도 현재 교육용 위스 운영은 완결됩니다.
