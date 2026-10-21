# 개발자 일지 교사 레이아웃 복구

- 원인: `/developer-log` 공통 경로가 교사 레이아웃 적용에서 누락되어 구형 가로 메뉴와 푸터를 표시했다. 본문도 `canLike`를 디자인 분기로 사용하여 교사에게만 구형 제목·안내·필터 카드를 표시했다.
- 수정: 목록·상세에서 교사 포털 접근 권한에 맞는 기존 레이아웃을 사용한다. 제목·분류 탭·본문은 기존 `ws-page--reading`, `ws-page-header`, `ws-page-tabs`를 공유한다. 새 토큰이나 별도 탐색 구조는 추가하지 않았다.
- 권한: 교사 경로 접근 검사, 학생 공개 검사, 개발자 글쓰기 및 학생 좋아요 판정과 Firestore 경로는 변경하지 않았다. 학생의 기존 레이아웃도 유지한다.
- 회귀 방지: 실제 MainLayout/Header/Footer를 검사하는 `verify-student-developer-log-layout.mjs`를 빌드 필수 단계에 연결했다.
- 검증: `npm run build`, `npm run verify:portal-design`, `node scripts/verify-student-developer-log-layout.mjs`, `node scripts/verify-developer-log-browser.mjs`, 변경 TSX의 Prettier 검사와 `git diff --check`.
- 전용 브라우저 검사: 학생·개발자·일반교사·위임 계정의 목록/상세를 390·768·1280px에서 확인한다. 검색 빈 결과와 복구, 글쓰기 버튼 노출, 포털 탐색 및 가로 넘침을 검사한다. 합성 데이터만 사용하며 Firebase SDK와 외부 요청을 차단하고 쓰기 0건을 확인한다. 아이콘 폰트·알림·위스·편집기 네트워크 위젯은 이 검사에서 제외한다.
- 공통 포털 검사: 320·390·768·1280·1366·1440px에서 지도·탭·목차·설정과 키보드 및 메뉴 동작을 확인한다.

운영 확인은 `방재석` Chrome 프로필의 `https://www.westory.kr/#/developer-log`에서 수행한다. 운영 게시글 생성·수정·삭제 없이 목록·상세의 사이드바와 글쓰기 진입을 확인한다.
