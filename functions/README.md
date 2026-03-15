# Westory Point Functions

이 디렉터리는 포인트 시스템의 신뢰 쓰기 경로를 담당하는 Firebase Callable Functions를 담습니다.

현재 포함된 함수:
- `applyPointActivityReward`
- `createPointPurchaseRequest`
- `adjustTeacherPoints`
- `reviewTeacherPointOrder`

## 로컬 준비

1. `functions` 디렉터리에서 의존성을 설치합니다.
2. 필요하면 Firebase Emulator Suite를 실행합니다.
3. 프런트엔드는 `VITE_FUNCTIONS_EMULATOR_HOST`, `VITE_FUNCTIONS_EMULATOR_PORT` 환경변수 또는 기본값으로 emulator에 연결됩니다.

## 배포 순서

1. `firestore.rules` 변경 사항을 확인합니다.
2. `years/{year}/semesters/{semester}/point_policies/current` 초기값을 준비합니다.
3. 교사 계정의 `point_manage`, `point_read` 권한 문서를 확인합니다.
4. Functions와 Firestore Rules를 같은 배치로 배포합니다.
5. 배포 후 출석 적립, 문제 풀이 적립, 수업 자료 적립, 학생 구매 요청, 교사 수동 지급/차감, 교사 주문 처리까지 순서대로 점검합니다.

## 운영 주의사항

- 이제 `point_wallets`, `point_transactions`, `point_orders`는 클라이언트에서 직접 쓰지 않습니다.
- 학생 공개 쓰기와 교사 핵심 쓰기 모두 Functions를 통해 처리됩니다.
- `point_products`, `point_policies`는 현재 교사 직접 쓰기를 유지하지만, 학생 잔액을 바꾸지 않는 문서로 범위를 제한했습니다.
- 교사 수동 조정은 `reason` 없이 처리되지 않도록 서버에서 다시 검증합니다.

## 롤백 시 주의

- 프런트엔드만 되돌리고 Rules/Functions를 함께 되돌리지 않으면 포인트 관리 화면에서 쓰기 실패가 날 수 있습니다.
- 롤백 시에는 최소한 프런트엔드, Functions, Firestore Rules를 같은 기준으로 맞춰야 합니다.
