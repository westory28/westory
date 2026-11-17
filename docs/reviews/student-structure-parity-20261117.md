# 학생 포털 구조 정렬 (2026-11-17)

## 범위와 기준

사용자 요청은 학생 `위스 관리` 중첩을 없애 `내 위스`로 직접 연결하고, 현행 교사 화면에 대응하지만 이전 패치가 누락된 학생 구조를 찾아 맞추는 것이다. 기준은 `education-web-design-system`, 기존 `DESIGN.md` 지도 화면 계약과 `UI_RULES.md`다. 별도 디자인 체계나 교사 관리 기능을 학생에게 추가하지 않는다.

시작 checkout은 `C:\westory`, 깨끗한 `267745a5`였다. 독립 worktree `C:\westory-student-parity-20261117`, 브랜치 `codex/student-structure-parity-20261117`을 만들고 진행 중 원격의 검증 스크립트 정리 `78eb4888`을 fast-forward로 포함했다. 변경 전 운영 도메인도 `78eb48885dcafd3b12248b082b4fa35efd90e0d3`, Vercel `dpl_FjBGC3ixeyBi4Lw6DxPiYiusweFG` READY였다.

## 대응 화면 감사

| 학생 영역 | 교사 또는 공통 대응 | 확인 및 처리 |
| --- | --- | --- |
| 위스·상점·아바타·위스피 | ManagePoints 및 주 메뉴 | 학생에게만 남은 `위스 관리` 중첩, 전체 위스/마을 이중 탭 제거. 목적지 제목과 상점의 상품/구매 내역 전환을 유지. |
| 캘린더 | ManageSchedule·Dashboard | 학생 단독 달력의 옛 상세 창을 공통 ScheduleEventDetailModal로 교체. 사용자 정의 일정 분류·색상 전달, 분류 구독 한 번, 학생 편집 버튼 없음. |
| 공부의 神문고 | GongsinmoongoWorkspace | 교사에게만 적용됐던 투명 제목·대화 헤더 및 제목 아래 탭 배치를 학생에게 적용. |
| 수업 자료 | ManageLesson·PortalWorkspace | 이미 같은 단원 탐색/본문 틀. 학생 목차의 대단원 화살표 누락과 선택 단원의 접힌 조상 복원만 보완. 수동 접기는 유지. |
| 문제 풀이·모의고사 | ManageQuiz·QuizWorkspace | 탭·회차가 local state에만 남던 학생 진입 화면을 URL과 연결. 기존 round 단독 링크·오답 노트 왕복·뒤로/앞으로·새로고침 복원. |
| 평가 풀이·결과 | 공통 페이지 제목 계약 | 전역 header의 sticky·64px 최소 높이·흰 배경이 유입되던 학생 헤더 초기화. 실제 풀이 도구 영역의 경계는 유지. |
| 정기시험 답안 | ExamOmrConfig·공통 페이지 | 이전 `54107833`에서 놓친 빈 상태의 흰 제목 카드 제거. 320px 객관식 행의 가로 넘침과 중복 사용법 안내 정리. |
| 대시보드·알림장 | Dashboard·NoticeBoard | 최근 공통 구조 적용 상태. 학생 열람과 교사 편집의 차이 유지. |
| 마이페이지·프로필·옷장 | SettingsMyPage·AvatarStudio | 공통 탭·평면 구역 적용 상태. 학생 학습 이력/자기 정보와 교사 설정 목차 차이 유지. |
| 지도·지구본 | 공통 HistoryMaps | 동일 공통 구현. 별도 수정 불필요. |
| 생각모아 | ManageThinkCloud | 11/14 양 포털 구조 정렬 적용 상태. |
| 역사교실 | 교사 역사교실·공통 풀이 | 최신 진입/워크스페이스 유지. 배정 관리와 학생 과제 풀이 차이 보존. |
| 수행평가·정기시험 점수 | PerformanceScoreView·교사 점수 관리 | 최신 공통 탭/워크스페이스 적용 상태. 본인 점수 동의·서명·이의·확인 절차 보존. |
| 성적 계산·리포트 | 교사 반영 비율·평가 분석 | 공통 페이지/투명 제목 적용 상태. 학생 개인 계산과 교사 운영·집계 차이 유지. |
| 위플레이 | WeplayGameCatalog·공통 게임 | 최근 공통 목록/게임 구현 적용 상태. 교사 운영·미리보기와 학생 플레이·기록 차이 유지. |
| 명예의 전당 | WisHallOfFameStudentPreview | 공통 미리보기 재사용 중. |
| 역사 사전 | 공통 catalog/초성 필터 | 공통 탐색·상단 탭 적용 상태. 학생 사전 찾기/내 단어장과 교사 등록/관리 차이 유지. |

실행 경로가 없는 `MapResources.tsx`는 화면 패치 대상으로 오인하지 않았다. 학생 주 메뉴의 학습·평가·개인 정보 그룹은 학생 경험에 맞는 기존 분류다. 교사 전용 설정·관리 목차를 추가하지 않았고, 학생 신문고의 launcher-only 진입도 유지한다.

## 동작과 안전 경계

- 학생 본인 조회, 교사 권한, 메뉴 숨김, 게임·아바타·위스피 공개 조건과 URL 목적지는 보존한다.
- 응시 시작·답안 저장·성적·위스 거래·서명·동의·이의 처리·학기 경로는 변경하지 않는다. 탐색 상태만 URL로 복원한다.
- 일정 분류는 기존 공개 구독 하나를 부모에서 읽어 캘린더와 상세 창에 함께 전달한다. 상세 창 열고 닫기에 새 조회가 없다.
- 공통 일정 모달은 닫기·ESC·배경·부모 해제 시 이전 버튼으로 포커스를 복구한다. 교사 편집 모달로 옮겨진 포커스를 되돌려 빼앗지 않는다.
- Functions·rules·인증·세션·런타임 AI·외부 서비스·개인정보 항목·공개 범위 변경은 없다. 기존 서비스의 일반 UI 유지보수다. 합성 검증에서 운영 학생 데이터를 조회하거나 변경하지 않는다.

## 검증

아래 검증은 모두 통과했다. 초기 실패 캡처가 같은 output에 남아 있을 수 있으며 최종 report의 상태와 실행 결과를 기준으로 한다.

- 학생/교사 공통 메뉴: `verify-student-portal-layout.mjs`, `verify:portal-design` (320/390/768/1280/1366/1440).
- 실제 위스·상점: `verify-wis-wallet-browser.mjs` (320~1440), 키보드/뒤로·앞으로, 지갑/구매내역 읽기 경계, 오류 복구.
- 실제 학습 화면: `verify-student-learning-navigation-browser.mjs`, 기존 `verify-student-quiz-entry-browser.mjs`, `verify-student-lesson-read-flow-browser.mjs`.
- 실제 평가 풀이→결과 헤더: `verify-student-quiz-review-flow.mjs --navigation-headers-only` (390/768/1280), 합성 제출만 사용.
- 일정: `verify-student-calendar-parity-browser.mjs` (390/768/1280), 분류 단일 구독·학기/학급 범위·상세 추가 읽기 0·쓰기 0·빈/오류 재시도·양 역할 포커스.
- 신문고: `verify-gongsinmoongo-browser.mjs` (양 역할 320~1920), 실제 computed style·공개 차단·실시간·조회/오류 회귀.
- 정기시험 답안: `verify-student-exam-answer-layout.mjs` (320/390/768/1280), 정상/빈·키보드·점수 계산·학기 조회 1회.
- 아바타/위스피: `verify-avatar-routes.mjs`, `verify-avatar-settings-browser.mjs`, `verify-student-wispi-browser.mjs`.
- 기본 앱 검증: `npm run build` 및 변경 TSX 포맷·`git diff --check`.

독립 코드 리뷰에서 범위 외 관리 기능 추가, 권한·공개·학기·응시·저장 경계 변경이나 추가 회귀를 발견하지 못했다. 브라우저 증거는 worktree의 `output/student-structure-parity/`, `output/student-calendar-parity/`, `output/student-parity-gongsinmoongo/`, `output/student-exam-answer-layout/` 및 학습 검증 output에 보관한다.

아바타 18개 경로 시나리오, 위스피 26개 시나리오가 통과했다. 옛 메뉴를 전제로 하던 검사 기대값을 현재 구조에 맞췄으며, 위스피 합성 검사의 거래 단위 변경 효과를 기다리지 않던 입력 경합도 검사 코드에서 바로잡았다. 앱의 거래 계산과 명령에는 변경이 없다. 학습 탐색의 최종 증거는 `%TEMP%/westory-learning-navigation-4vYYLg`, 실제 풀이·결과는 `%TEMP%/westory-review-flow-4oB4bm`이다.

## 운영 반영 절차

원격 main과 운영 도메인의 최신 SHA를 다시 비교하고 검증한 커밋을 fast-forward로 푸시한다. 해당 Vercel main 배포의 READY 확인 후 Production으로 승격하고 `www.westory.kr` 연결 SHA·실제 배포 자산과 지정 `방재석` Chrome 프로필 화면을 확인한다. 학생 전체 조작 검증은 합성 계정으로 수행했으며 운영 학생의 응시·구매·성적·위스 원장은 검증용으로 변경하지 않는다. 배포 ID·도메인 확인 결과는 `output/student-structure-parity/release.json`에 남긴다. Firebase 변경이 없으므로 Functions·rules는 재배포하지 않는다.
