# 윷놀이 모니터링과 하단 배치

교사 관리의 방 목록을 `플레이 모니터링` 팝업으로 옮긴다. 목록 내부 폭 800px 이상에서는 두 열, 작은 화면에서는 한 열을 사용하며 제목·닫기를 고정하고 본문 하나만 스크롤한다. 키보드 포커스·Escape·바깥 클릭·페이지 스크롤 복원을 확인했다. 방 닫기 확인은 해당 방 안에서 경고·확인·취소로 표시하며 기존 쓰기 권한·revision 검사를 유지한다.

`getYutManagement`는 이미 읽은 방 자료에서만 선두·공동 선두와 완주 수를 계산한다. 완주한 말 수를 우선하고 동률이면 실제 공통 코어의 합법 경로로 계산한 남은 최단 이동 거리의 합을 비교한다. 경기 판정이나 승률 예측이 아닌 마지막 조회 시점의 교사용 현황이다. 추가 Firestore 읽기·쓰기와 방 마이그레이션은 없다. 팝업이 닫혔거나 탭이 숨겨졌으면 15초 갱신을 하지 않는다.

2인 경기의 프로필은 좌우 하단을 사용하며 3·4인 배치는 유지한다. 보드의 기존 크기와 조작 영역을 유지한 채 남는 높이를 보드 위로 보내 조작부 가까이 배치한다. 학생과 교사 체험이 공유하는 표시만 변경하며 차례·투척·이동·자동 넘김·보상·공개 설정은 변경하지 않는다. 기존 학생에게 재접속이나 강제 새로고침을 보내지 않는다.

## 검증

- `npm run build` 및 `npm --prefix functions run check`.
- `npm --prefix functions run test:yut-integration`: 전용 demo Firestore 에뮬레이터. 모니터링 전후 방 내용·revision·시계 불변, 기존 공개·권한·세션·재적·재접속·개인정보 회귀.
- `YUT_MANAGEMENT_ONLY=1 node scripts/verify-yut-management-browser.mjs`: 12개 방, 390·768·1280px 팝업과 1366px 관리 화면, 선두·동률·완주, 읽기 전용 권한, 명시적 방 닫기/취소, 조회만 할 때 경기 명령 0회. 가상 시계를 사용해 열린 창의 15초 조회와 닫힌 창의 30초 조회 0회를 확인.
- 학생/교사 × 2/4인 × 390×844·768×1024·1280×800의 12조합에서 던지기·말 선택/이동·물리 클릭 영역과 하단 정렬 확인. `YUT_MOVEMENT_QA_SECTION=mobile-viewport node scripts/verify-yut-movement-browser.mjs`의 기존 모바일 가독성 검사도 통과.
- 변경 TS/TSX Prettier 및 `git diff --check`. 운영 데이터로 경기·보상·설정 변경을 만들지 않음.

운영 `getYutManagement`의 저장 소스를 내려받아 기존 `yut.js`, `yutCore.mjs`, `yutReward.js`, 세션·학생 접근 의존 파일과 HEAD `8ec5a25a`의 LF 정규화 해시 일치를 확인했다. Firebase 배포 대상은 읽기 전용 `getYutManagement` 하나다. `commandYutRoom`, `saveYutSettings`, rules는 배포하지 않는다.

## 교사 관전 조사 — 미구현

현재 rules는 참가자 UID에만 방 읽기를 허용하며 진행 중인 방에는 참가할 수 없다. 추후 교사 권한으로 선택한 방 하나만 읽는 별도 관전 화면은 가능하다. 최초 연결과 해당 방 갱신 때 문서 읽기가 추가되며 보안 규칙의 의존 읽기·재연결 비용은 별도다. 창 닫기·방 전환·숨김·계정 전환 시 구독을 해제하면 전체 방 구독이나 주기적 서버 호출을 피할 수 있다. [Firebase 실시간 구독](https://firebase.google.com/docs/firestore/real-time_queries_at_scale), [조회 과금](https://firebase.google.com/docs/firestore/pricing).

현재 `YutGame`에는 자동 차례 넘김이 있으므로 그대로 관전 화면으로 연결하면 안 된다. 별도 읽기 권한과 보드 표시만 사용하고 참가·자리·준비·heartbeat·감정표현·이동·보상 쓰기를 연결하지 않는 방식이 필요하다. 이번 패치에는 관전 UI나 권한을 추가하지 않았다.
