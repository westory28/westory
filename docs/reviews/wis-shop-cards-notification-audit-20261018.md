# 위스 상점 카드 UI 및 알림 연동 점검

## 요청과 변경 범위

- 교사 사이드바 `상점`을 `위스 상점`으로 변경했다.
- 학생·교사 상점/주문 제목에 공통 `ws-page-header`를 적용해 상단 흰 배경을 제거했다.
- 상품마다 흰 배경·테두리·12px 모서리·16px 내부 여백을 적용했다. 교사 상품은 가로 행에서 반응형 카드 그리드로 변경하고 카드 사이에 24px(작은 화면 16px) 간격을 뒀다.
- 커진 교사 사진에도 기존 `getProductCardImage`를 적용해 과거의 작은 preview 대신 저장된 상세 사진, 신규 상품은 최적화된 640px preview를 사용한다.
- 구매·지급 알림은 요청대로 점검했다. 이번 패치에서는 Functions, Rules, 주문·재고·알림 데이터를 변경하지 않았다.

## 알림 점검 결과: 미연동

### 1. 현재 주문 명령에 알림 생성이 없다

`src/lib/pointEconomyAdapter.ts`는 `placeWisOrder`, `reviewWisOrder`, `cancelWisOrder`를 사용한다. `functions/productionGateway/wisEconomy.js`의 해당 명령은 주문·재고·위스와 상태를 처리하지만 notification inbox/items 또는 전달용 outbox를 기록하지 않는다. `commandGateway.js`의 receipt/audit 기록에도 알림 연결이 없다.

운영 `executeCommand`의 보관 소스 generation `1792306913535979`를 내려받아 `wisEconomy.js`, `commandGateway.js`, `productionSource.js`를 LF 정규화 후 비교했다. 점검 기준 `fdb917c`의 세 파일과 일치했다. 운영 함수 목록에도 canonical 주문/receipt를 감시하는 별도 알림 trigger가 없었다.

기존 `verify-wis-shop.cjs` 메모리 트랜잭션을 파일 변경 없이 런타임 계측했다. 기존 3개 suite 및 176회 assertion 호출이 통과했고, 명령 모듈과 조회 모듈별로 각각 15회(구매 7, 승인 2, 준비 1, 교사 취소 1, 지급 1, 학생 취소 2, 반려 1), 총 30회 성공한 상태 변경에서 알림/outbox/notice-delivery 문서는 모두 0개였다. 운영 구매나 학생 알림은 만들지 않았다.

기존 `createPointPurchaseRequest`, `reviewTeacherPointOrder` 소스에는 알림 생성 구현이 남아 있으나 실제 배포본은 `CLIENT_UPDATE_REQUIRED`로 즉시 종료되므로 해당 구현에 도달하지 않는다. 각 운영 보관 소스 generation은 `1789202748666043`, `1789202749306134`다.

### 2. 알림 읽음·삭제 호출도 운영 계약과 다르다

`src/lib/notifications.ts`와 `NotificationBell.tsx`는 `markNotificationsRead`, `clearNotifications` callable을 호출한다. 하지만 두 함수의 운영 보관 소스 최종 export는 `retiredW8LegacyCallable`이며 `failed-precondition / CLIENT_UPDATE_REQUIRED`를 반환하도록 되어 있다. 읽음 실패는 Bell에서 콘솔에 기록한다.

- markNotificationsRead: generation `1789202731964398`, update `2026-09-12T08:45:56.996732323Z`
- clearNotifications: generation `1789202732270100`, update `2026-09-12T08:45:43.969344986Z`
- 두 ZIP의 `index.js` LF 정규화 SHA256: `e310c516cbf234a899f270d046f1e9bf8d7ba295f98c6a31021637fa60526449`

운영 소스만 읽었으며 읽음·삭제 callable을 실행하지 않았다.

### 3. 화면 표시·탭 이동은 있으나 최신 주문 선택까지 연결되지 않는다

`NotificationBell.tsx`는 `point_order_requested`를 교사 `/teacher/points?tab=requests`, `point_order_reviewed`를 학생 `/student/points?tab=orders`로 연결한다. 서버의 제목·본문을 그대로 표시하므로 준비·지급 등 상태별 문구도 표시할 수 있다.

다만 알림 entityId로 해당 주문을 선택하거나 펼치지 않으며, 이미 같은 탭에 있으면 알림 클릭만으로 주문을 재조회하지 않는다. inbox의 미확인 수는 실시간 구독하지만 목록은 최근 10개를 일회 조회하고 열린 목록 갱신은 읽음 처리의 `lastBroadcastReadAt` 변경에 간접 의존한다.

`SettingsNotifications.tsx`의 상점 알림 두 항목은 `connected`로 고정 표시되지만 현재 운영 상태와 맞지 않는다. 학생 안내도 승인·반려만 설명한다.

## 후속 복구 시 필요한 범위

1. 현재 inbox/items의 사용자·학기·세션 경계를 보존하는 읽음·삭제 명령 연결.
2. 주문 상태 변경과 함께 중복 방지 outbox를 기록하고 실패 시 재시도 가능한 전달 연결.
3. 구매 요청은 담당 교사, 승인·준비·지급·반려·취소는 해당 학생에게만 전달하도록 검증.
4. 알림에서 해당 주문 선택·새로고침, 열린 알림 목록 갱신, 설정의 실제 연결 상태 반영.
5. 중복 명령·재전달·수신자 권한·이전 학기·broadcast 읽음 수 회귀 검증 후 변경된 함수만 배포.

## UI 검증

- 실제 컴포넌트 합성 fixture에서 교사 320/768/1440px, 학생 390px 카드와 투명 제목 확인.
- 상품 검색, 상품·재고 수정 열기/닫기와 포커스 복귀, 학생 상품 선택/상세 닫기 확인. 운영 데이터 쓰기 없음.
- 상점 클라이언트 회귀 검사 17개 통과, 교사 내비게이션 검사 통과.
- 수정 TSX Prettier 검사 및 `git diff --check` 통과.
- `npm run build` 전체 사전 검사와 production bundle 생성 통과. 최초 실행의 누락된 최신 의존성은 작업 전용 `node_modules`에 `npm ci`로 설치한 뒤 재검증했다. 원래 checkout의 의존성은 변경하지 않았다.
- 배포 커밋·운영 도메인 반영 확인은 최종 작업 보고에 남긴다.
