# 위스 지갑 성능·원장 점검 (2026-10-27)

## 기준과 운영 원장

- 기준 `main`: `dad020940569f770a562f368a443b5872358ae12`. 작업 시작 시 origin/main 및 운영 Vercel 커밋 일치.
- 기존 미추적 `output/` 자료는 보존하며 커밋에서 제외한다.
- 운영 Firestore 위치 `nam5`, 동시성 `PESSIMISTIC`. 기존 지급·조회 callable은 서울에서 실행된다.
- 읽기 전용 대조: 2026-2 계좌 321개, 원장 832건. 잔액과 전체 delta 합계, balance/ranking projection revision, 최근 내역 캐시 모두 일치. 변경한 학생 잔액은 0개다.
- 원장에는 게임 비용 42건, 도전 보상 2건, 순위 보상 28건이 존재한다. 현재 100건 초과 계좌는 없다. 따라서 현재 신고된 불일치를 100건 제한이나 원장 소실로 단정하지 않는다.
- 배포 전 운영 교사 화면에서 거래 20건만 제공하고 이전 거래로 이동할 수 없음을 확인했다. 학생 조회에서는 게임 activityType이 제거되고, 거래 후 헤더 캐시가 오래된 응답으로 채워질 수 있었다.
- `spentTotal`은 기존 정책상 상점 결제 집계다. 게임 비용은 DEDUCT/adjustedTotal로 보존되므로 UI를 ‘상점 사용’으로 명확히 표시하며 과거 회계값을 재분류하지 않는다.

## 변경

- 지급 전 전체 학교 계좌 조회를 제거하고 학생 UID로 계좌 한 개를 조회한다. 잔액만 필요할 때는 원장을 조회하지 않는다.
- 지급 성공 영수증을 받은 즉시 완료를 표시한다. 후속 조회 실패를 지급 실패로 표시하지 않고 같은 요청의 재시도 영수증을 보존한다.
- 학생·교사 거래 내역은 immutable ledger를 시간/문서 ID 내림차순으로 페이지 조회한다. 최근 100건 배열은 전체 내역의 근거로 쓰지 않는다. 다른 학생·학기의 cursor와 오염 원장은 거부한다.
- 지갑 revision보다 오래된 응답은 지갑과 거래 내역을 덮지 못하게 한다. 윷 보상과 공통 갱신 이벤트가 헤더 캐시도 무효화한다.
- 학생이 보이는 화면으로 돌아오거나 네트워크 연결이 복구되면 현재 계정·학기 범위로 다시 조회한다. 주기적 polling이나 새 Firestore 읽기 권한은 추가하지 않는다. 다른 기기에 계속 열린 화면에 즉시 push하는 구조까지 구현한 것은 아니다.
- `executeWisCommandFast`/`getWisCommandStatusFast`는 미국 us-central1에서 지급·차감·조정·역분개·구매·취소·주문 검토 7종만 처리한다. 서울 경로와 동일한 세션·권한·원자적 transaction·영수증을 사용한다.
- 지급 함수만 256MiB, 최소 1개, 최대 20개, concurrency 80으로 대기한다. 유휴 비용이 발생한다. 조회/상태 확인은 최소 인스턴스를 설정하지 않는다.
- 다른 학생의 거래가 학교 economy revision을 바꿔도 단일 계좌 거래는 허용한다. 실제 경제 상태·학기 pointer·읽기 전용·마이그레이션 차단·계좌/재고/주문 revision 검사는 유지한다.
- 정지 계좌, 잘못된 계좌/학기, 정수 범위를 벗어난 금액은 저장 전에 거부한다.
- 조회는 read-only transaction으로 snapshot 일관성을 보존하면서 지급 계좌의 pessimistic lock을 잡지 않는다.

## 검증

- Functions 전체 검사, 위스 adapter 및 상점 client 회귀, 루트 빌드.
- 명령 단위 검사 9그룹: 구/신 경로 영수증 재사용, 중복 원장, payload 충돌, 계좌 CAS, 권한·학기 차단, 금액 검증, 구매.
- 실제 Firestore 에뮬레이터 명령 통합 7그룹: 동시 학생 지급, 같은 계좌 충돌, 재시도, 구매·취소·재고, 거부 시 무변경, 동시 읽기 snapshot, 명령 제한. 인증 identity는 합성 fixture다.
- 위플레이 canonical 지갑 통합 9그룹, 윷 보상 통합 10그룹. 현재 게임은 한 transaction당 지갑 write 한 번을 수행한다.
- 조회 회귀: 250건 전체 순회, 같은 시각 페이지 경계, 게임 손실, 타인 cursor, 오염 원장, 학생 selector 격리, 경량조회, 과거 학기 읽기 전용.
- 실제 운영 학생에 대한 시험 지급·차감은 하지 않는다. 로컬 합성 검사 시간은 운영 지급 지연 측정으로 보고하지 않는다.
- 390·768·1280px 실제 페이지 브라우저 검사 8그룹: 음수 거래, 키보드 더보기, 조회 실패 후 재시도, 지급 성공 후 후속 조회 지연·실패, revision 역순 응답, 페이지 변경 중 재조회 실패 후 복구, 이전 목록 응답·학기 전환, 화면 복귀 이벤트 중복 제거를 확인했다. 새 디자인 토큰이나 탐색 카드는 추가하지 않았다.
- 같은 크기에서 실제 Header 브라우저 검사 4그룹도 통과했다. 키보드·포커스 복귀, 현재 학생·학기 조회, 숨김·로그아웃·교사 상태의 조회 차단, 복귀 시 한 번만 조회를 검증했다. 재현 명령은 PowerShell에서 `$env:HEADER_WIS_QA_VIEWPORTS='390,768,1280'; node scripts/verify-header-wis-browser.mjs`다. 기존 320px 긴 이름 fixture의 팝오버 좌측 약 4px 넘침은 이번 지갑 로직 변경과 별개인 UI 제약으로 남겨 두었다.
- 최종 제품 파일 변경 이후 루트 `npm run build`와 Functions 전체 검사가 통과했다. 백엔드 배포 후 읽기 전용 운영 대조도 321개 지갑·832개 거래, 불일치 0개로 같았다.

## 운영 및 향후 연동 계약

- `node functions/scripts/audit-wis-wallets.cjs --project history-quiz-yongsin`으로 현재 학기 원장·잔액을 읽기 전용 대조한다. 학생 이름·UID를 출력하지 않으며, 쓰기 옵션을 제공하지 않는다. 불일치 시 종료 코드 2로 중단한다.
- 새 콘텐츠는 클라이언트에서 잔액을 직접 쓰지 않는다. 서버가 가격·보상·소유자·학기를 확인하고, 고정 source/command ID로 잔액·원장·콘텐츠 결과·영수증을 같은 transaction에 반영해야 한다.
- `studentWisWallet.write`는 읽은 snapshot당 한 번만 호출하는 현재 계약을 유지한다. 복수 항목 결제는 검증한 합산 delta 한 번으로 처리하거나 전용 원자적 batch adapter와 회귀 검증을 먼저 구현한다.
- 현재 저장소에는 주식 매매나 아바타 구매의 위스 결제 코드가 없다. 프로필 이모지는 canonical 지갑 등급을 검증한다. 별도 개발 중 콘텐츠의 운영 연동까지 검증했다고 보고하지 않는다.
- 모든 거래가 공유하는 economy 문서 카운터는 보존했다. 이번에는 원장 무결성과 기존 운영 도구 호환성을 우선하며, 향후 실제 부하에서 병목이 확인되면 별도 마이그레이션과 부하 검증으로 분산한다.
- 변경 함수만 배포한다. 기존 서울/미국 callable과 Firestore rules를 삭제하거나 권한을 넓히지 않는다. 원장 페이지 인덱스는 운영에서 이미 READY임을 확인하고 저장소에 명시했다.
- 운영 배포 원본: 2026-10-26 executeCommand의 commandGateway/wisEconomy/wisEconomyQuery/sessionAuthority/productionSource가 변경 전 HEAD와 일치했다. 기존 독립 조회는 2026-10-19 버전이며 순위 추가분은 위 최신 배포 closure에 이미 포함되어 있다.
- 배포 중 발견한 복구 사항: Firebase CLI가 `--only functions:getWisEconomyState`에서도 리전 목록을 대조하여 명시되지 않은 기존 미국 조회를 삭제 대상으로 판단했다. 기존 서울·미국 두 리전을 모두 export하도록 수정하고 미국 조회 함수를 복원했다. export 회귀 검사와 운영 절차에 두 리전 보존을 명시했다. `firebase functions:list`에서 변경 대상의 6개 리전 배포가 모두 ACTIVE임을 확인했다. 학생 원장·잔액은 변경하지 않았다.

위치 선택 근거: [Firebase Functions 위치 안내](https://firebase.google.com/docs/functions/locations), [Firestore transaction 경합 안내](https://firebase.google.com/docs/firestore/transaction-data-contention).
