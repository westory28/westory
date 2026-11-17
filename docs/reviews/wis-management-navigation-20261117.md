# 위스 관리 목차와 게임별 위스 설정 (2026-11-17)

## 변경 범위

- 기준 커밋은 `59ccdf304d1e490891a00f191f1603929a5bbe04`다. 배포 전 운영 도메인의 Vercel URL과 GitHub deployment 상태가 이 커밋으로 일치했다.
- 교사 주 사이드바의 `위스 > 위스 관리`는 단일 링크다. 위스 현황·지급 및 환수·운영 정책·등급 관리는 진입 화면 왼쪽의 기존 `PortalWorkspace`와 `PortalSubNavigation`을 재사용한다. 모바일은 공통 접이식 목차를 사용한다. 사용자 명시 요청에 따른 세로 목차 예외이며 새 디자인 토큰은 없다.
- 학생 메뉴, 명예의 전당·상점·아바타·위스피 목적지, 기존 URL과 권한 검사를 유지한다. 관리 화면 상태를 보유하는 `ManagePoints`를 목차 이동 때문에 다시 마운트하지 않는다.
- 위스 운영 정책에서 위플레이 탭을 제거했다. 충무공 게임 관리에는 기존 도전 비용·횟수·결과 보상·학급 순위 보상, 윷놀이 게임 관리에는 온라인 우승 보상을 배치했다. 리듬 도전 설정과 각 게임의 주간 전체 랭킹 설정은 기존 위치를 유지한다.
- 기존 학급 랭킹 보상은 `functions/weplay.js`의 기간 정산과 예약 실행에서 실제 사용 중이므로 해당 게임 안에서 계속 관리한다. 주간 전체 랭킹 보상과 구분하며 지급 로직이나 저장된 수치는 변경하지 않는다.
- 일반 위스 정책과 위플레이 정책은 각각 `point_policies/current`, `weplay_policies/current` 경로다. 게임별 저장은 조회한 version을 유지하며 다른 게임의 필드를 보존한다. 계정·인증 세대·학기·권한·게임 경계에서 이전 응답을 버린다.
- 접힌 게임 설정·미사용 패널·권한 없는 사용자의 정책 조회는 0회다. 처음 열 때 정책 조회 callable 1회, 변경 저장 callable 1회 호출이며 실패 재시도는 사용자가 요청할 때만 수행한다. Firestore 문서 읽기 건수와 구분하며 기존 서버 권한 및 version 충돌 검사를 유지한다.
- AI 호출·에이전트 런타임·외부 전송·개인정보 항목·공개 범위·Functions·rules 변경은 없다. 기존 승인 범위의 화면 탐색 및 설정 위치 유지보수다. 운영 QA는 설정·보상·점수·학생 기록을 저장하지 않는다.

## 검증

- `npm run build`: 타입 검사와 필수 기존 회귀 검사, XLSX hair 테두리 검사를 포함해 통과했다. 최종 파일의 `npm run typecheck`도 통과했다.
- `node scripts/verify-teacher-nav.mjs`, `node scripts/verify-student-developer-log-layout.mjs`: 교사 단일 링크, 학생 기존 구조와 역할별 메뉴를 확인한다.
- `node scripts/verify-portal-design.mjs --kind=wis-management --portal=teacher`, `--kind=tabs --portal=student`: 320·390·768·1280·1366·1440px에서 직접 진입, 뒤로/앞으로, 현재 항목 표시, 모바일 접기, 키보드 초점, 44px 조작 영역, 투명 제목, 가로 넘침을 검사했다. 실제 레이아웃/CSS와 합성 본문이며 외부 요청을 차단한다. 실제 위스 목록 데이터 검증과 구분한다.
- `node scripts/verify-yut-policy-browser.mjs`: 실제 패널과 adapter, 합성 callable로 조회/저장 실패와 재시도, version 충돌, 빈값/범위 검사, 중복 저장 방지, 권한·학기 전환, 다른 게임 값 보존을 확인했다. 윷 390·768·1280·1366px와 해전 390·768·1280px에서 넘침과 투명 제목의 computed style을 확인했다.
- `npm run verify:portal-design` 전체 검사도 통과했다. 교사·학생 지도/탭/목차와 설정/학습 본문, 양 포털 주 메뉴를 검사했다. 증거는 `%TEMP%/westory-portal-design-zMCnqL`이다.
- 변경 TSX의 Prettier 검사 및 `git diff --check`가 통과했다.

로컬 브라우저 증거: `%TEMP%/westory-portal-design-O7UC4X`, `%TEMP%/westory-portal-design-u5umIG`, `C:/westory/output/weplay-policy-20261117`. 개인정보 없는 합성 자료만 사용했다. 운영 반영은 검증한 커밋의 Vercel 성공·승격 및 `www.westory.kr`의 지정 Chrome 프로필 확인을 완료 기준으로 한다.
