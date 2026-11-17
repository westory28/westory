# 개발자 일지 좋아요·상세 화면 검증 (2026-11-17)

기준 저장소는 `C:\westory`, 시작 HEAD는 `59ccdf304d1e490891a00f191f1603929a5bbe04`, 작업 브랜치는 `codex/wispi-event-log-20261117`이다. 사용자 요청 5·6과 추가 요청한 이벤트 하단 위스피 이동 버튼을 다룬다. 기존 교육 디자인 기준과 학생/교사 포털을 유지한다.

## 변경 범위

- `src/pages/DeveloperLog.tsx`: 좋아요 즉시 표시, 요청 중 해당 버튼만 잠금, 실패 복구, 계정/게시물 전환 시 이전 응답 무시, 상세에서 목록 구독 중단, 게시물/본인 좋아요 병렬 읽기, 상세 메타데이터 정렬, 위스피 CTA/편집 옵션.
- `src/lib/developerLogLikes.ts`: 본인 좋아요 문서와 게시물 증감을 한 atomic batch로 저장. 거절·응답 유실 시에만 서버 상태를 읽어 의도 달성 여부 확인.
- `src/lib/developerLogs.ts`: 선택 필드 `action: "wispi" | ""` 정규화. 기존 게시물에는 버튼이 생기지 않는다.
- `src/pages/developerLog.css`: 반응형 메타데이터, 44px 좋아요 터치 영역, 모바일 본문 좌우 20px 여백. 이벤트 이미지는 기존 원비율/너비를 유지한다.
- `scripts/verify-developer-log-browser.mjs`, `scripts/verify-developer-log-likes-rules.mjs`: 아래 회귀검사 확장.
- `scripts/verify-developer-event-article-browser.mjs`, `scripts/verify-notice-image-article-browser.mjs`: 실제 상세 함수를 추출하는 기존 fixture에 새 로컬 상태/CSS를 연결.

Functions, Firestore/Storage rules, 공통 인증/세션/권한, 운영 게시물은 수정하지 않았다. 동일 working tree에 있는 다른 작업의 위플레이·포인트·헤더·디자인 변경도 수정하거나 되돌리지 않았다. 런타임 AI 호출/외부 데이터 전송은 추가하지 않았다.

## 좋아요 통신 및 안전성

기존 클릭은 게시물+본인 좋아요를 읽는 클라이언트 트랜잭션(최소 2문서 읽기, 2문서 쓰기)이었다. 새 클릭의 정상 경로는 **사전/사후 클라이언트 읽기 0회, atomic batch 요청 1회, 문서 쓰기 2회**다. 서버의 `increment`가 동시 학생 요청을 합산하므로 다른 학생의 클릭으로 클라이언트 트랜잭션을 반복하지 않는다.

기존 rules는 본인 좋아요 문서의 생성/삭제와 정확한 +1/-1 증감을 한 원자적 작업으로 묶어 검사한다. 학생 역할, 소유권, application session, 등록, 점검 차단 검사를 그대로 사용한다. 같은 추가/취소 요청의 재전송은 거절되어 중복 증감되지 않는다. rules 내부 조회 비용은 남아 있으며 위 숫자는 앱이 명시적으로 요청하는 문서 읽기/쓰기 수다.

명시적 커밋 실패 시 서버의 해당 게시물과 본인 좋아요만 병렬로 재조회한다(2문서). 원하는 상태가 이미 반영되었으면 응답 유실/다른 탭의 동일 의도로 판단하고 성공 상태를 표시한다. 반영되지 않았으면 서버 상태로 되돌리고 재시도 안내를 표시한다. 재조회도 실패하면 클릭 직전 표시로 복구한다. 이전 계정/다른 게시물의 늦은 응답은 현재 화면을 바꾸지 않는다. 실제 오프라인에서 Firestore가 쓰기를 대기시키는 동안에는 낙관 표시와 해당 버튼 잠금이 유지되며 다른 화면 조작은 가능하다.

상세 화면은 더 이상 최대 60개 목록을 구독하지 않는다. 학생 상세 진입은 게시물+본인 좋아요 2문서를 병렬로 읽고, 교사 상세는 게시물 1문서를 읽는다. 목록으로 돌아올 때 구독을 다시 연다. 별도 폴링/전역 캐시는 추가하지 않았다.

## 화면·CTA

제목과 메타데이터를 분리하고 작성자·날짜·조회수·좋아요를 한 행에 배치했다. 모바일은 중복 텍스트 라벨을 아이콘으로 줄이고 날짜를 `nowrap`으로 유지한다. 작성자 이름을 축약하지 않는다. 아주 긴 이름/카운터는 항목 단위 줄바꿈이 가능하며 날짜 자체는 쪼개지지 않는다.

이벤트 원본 이미지의 너비와 종횡비는 유지하면서 이미지 아래 일반 본문에 좌우 여백을 준다. 하단 `action: "wispi"` 버튼은 학생에게 `#/student/wispi`, 교사에게 `#/teacher/points?tab=stocks`를 연결한다. 임의 외부 URL은 저장/실행하지 않는다. 글쓰기/수정의 ‘위스피 이동 버튼’ 체크박스와 미리보기, 재시도, 편집 후 표시를 지원한다.

## 검증

- `npm run typecheck`: 통과.
- `node scripts/verify-student-developer-log-layout.mjs`: 학생/개발자/교사/학생 보조교사 목록·상세 포털 분리 통과. 서버 호출 없음.
- `node scripts/verify-notice-image-article-browser.mjs`: 390/768/1280 이미지 지연 조회, 키보드 펼치기/접기, 게시물·본문·미리보기 전환, 원본 링크, 일반 글 회귀검사 통과.
- `node --check scripts/verify-developer-event-article-browser.mjs`: 기존 수동 본문 fixture 문법 검사 통과.
- `node scripts/verify-developer-log-browser.mjs`: 실제 MainLayout/Header/DeveloperLog와 CSS로 320/390/768/1280 폭, 학생/개발자/교사/학생 보조교사 46개 시나리오. Firebase를 번들에서 제외하고 외부 네트워크를 차단한 로컬 합성 fixture 사용.
  - 즉시 좋아요/개수 표시, 응답 대기 중 전체 overlay 없음, 중복 클릭 차단.
  - 성공 0읽기, 실패 2읽기, 재시도 0추가읽기. 응답 유실 복구, 커밋+재조회 오류 복구, 계정 전환 뒤 이전 응답 무시.
  - 작성자/날짜/조회/좋아요 한 행, 날짜 nowrap, 버튼 높이 44px 이상, 본문 좌우 여백 20px 이상, 가로 overflow 없음.
  - 이미지 원비율, 확대/닫기 추가 읽기·쓰기 없음, 기존 게시물 CTA 없음, 역할별 목적지, CTA 저장/편집 유지, 업로드/게시 실패 재시도 및 기존 카운터 보존.
- `node scripts/run-developer-log-likes-rules.mjs`: **158검사 통과**, demo 프로젝트와 127.0.0.1:18220 에뮬레이터만 사용.
  - canonical `site_settings/developer_logs/items` 및 legacy `developer_logs` 경로.
  - 기존 트랜잭션 호환, 새 batch 동시 추가/취소 및 재전송 차단.
  - ENFORCE/OBSERVE_ONLY, 점검 예외 0/1/20명, 미등록/만료/해지/다른 계정/교사/익명 차단.
  - 다른 게시물의 좋아요와 카운터 결합, 단독 카운터 수정, 일부 쓰기만 반영되는 상황 차단.
- `git diff --check` (담당 파일): 통과.

스크린샷과 브라우저 검사 JSON은 로컬 `output/developer-log-layout/`에 생성했다. `student-event-320.png`, `student-event-390.png`, `teacher-event-1280.png`를 시각 확인했다. 포스터는 QA 전용 합성 이미지이며 실제 홍보 이미지를 대체하지 않는다. 프로덕션 좋아요/학생 자료 변경이나 운영 성능 측정은 하지 않았다. 루트 작업자가 통합 빌드·커밋·배포와 운영 화면 확인을 완료해야 한다.
