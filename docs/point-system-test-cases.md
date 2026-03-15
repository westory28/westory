# Point System Test Cases

| ID | 시나리오 | 기대 결과 |
| --- | --- | --- |
| A-1 | 학생이 같은 날 출석 체크를 2번 시도 | 첫 번째만 적립되고 두 번째는 duplicate 처리 |
| B-1 | 학생이 같은 제출 결과로 문제 풀이 적립 재시도 | 거래 원장 1건만 유지 |
| C-1 | 학생이 수업 자료 저장 버튼을 반복 클릭 | 조건 충족 후 1회만 적립 |
| D-1 | 포인트 부족 상태에서 상품 구매 요청 | Functions에서 실패, 주문 미생성 |
| D-2 | 재고 0 상품 구매 요청 | Functions에서 실패, 주문 미생성 |
| D-3 | 정상 상품 구매 요청 | 주문 생성, 재고 감소, purchase_hold 거래 기록 |
| E-1 | 교사가 요청 주문 승인 | 상태 `approved`, confirm 거래 기록 |
| E-2 | 교사가 요청 주문 거절 | 상태 `rejected`, 재고 복구, 잔액 복구, cancel 거래 기록 |
| E-3 | 교사가 승인 주문 지급 완료 | 상태 `fulfilled`, 후속 confirm 거래 기록 |
| F-1 | 교사가 reason 없이 수동 차감 시도 | Functions에서 실패 |
| F-2 | 교사가 정상 수동 지급 | manual_adjust 거래와 지갑 잔액 반영 |

## 실행 상태 기록 예시

- `Executed`: 실제 emulator 또는 운영 전용 프로젝트에서 확인
- `Code-reviewed`: 코드 경로와 트랜잭션 로직만 확인
- `Pending`: 아직 미실행
