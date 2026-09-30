# 공개 진입 화면 검토 기록

기준 커밋은 `424415555416fdefc577ba607da50f1190e092b0`, 작업 브랜치는 `codex/public-entry-intro`다. 사용자 제공 설계 원문과 이후의 “로그인은 항상 상단 우측” 요구를 반영했다. 공개 화면 구현·로컬 검증 완료 기록이며 운영 배포 완료 기록은 아니다.

## 구현

- 첫인상 → 오늘의 위스토리 → 학습과 기록 → 위플레이 → 시작하기의 다섯 장면. 기존 파랑·주황 브랜드와 학교 Google 로그인, 관리자 로그인, 약관 경로를 연결했다.
- 80px 고정 헤더의 우측 로그인은 첫 화면부터 끝까지 같은 위치에 있다. 본문에 같은 높이의 여유를 둔다. 처리 중/제한 브라우저의 비활성 상태와 기존 로그인 콜백을 유지한다.
- 처음부터 읽을 수 있는 제목 위의 색 채움과 밑줄, 실제 학생 홈 조각의 짧은 조립, 학습·기록 화면 등장, 한 번만 재생하는 게임 단어 예시를 사용한다. 두 학습 화면은 충분히 읽을 수 있도록 순서대로 표시한다.
- 너비 1024px·높이 600px 이상에서 조립 장면 한 곳만 180svh 고정 연출을 사용한다. 모바일·짧은 창·reduced-motion은 정적인 흐름이다. 화면 밖/백그라운드에서 게임 모션을 정지하고 무한 반복하지 않는다.
- 현재 소스의 실제 게임명인 **내가 충무공이라고?!**를 사용한다. 정적 캡처 위의 소개용 예시이며 게임 엔진·문제·랭킹·보상·저장에 연결하지 않는다.
- 실제 소스 컴포넌트를 가상 학생/학교/성적으로 촬영했다. 최신 사용자 지정 조선 등급 명칭은 캡처용 더미 정책에만 반영했다. 운영의 등급 정책은 변경하지 않았다. 자세한 출처는 `src/assets/public-entry/ASSETS.md`에 있다.
- 모달은 활성 종류별 포커스 관리, 정책 링크를 포함한 Tab 순환, 기존 취소 콜백의 Escape, 배경 스크롤 잠금·복원, IME 조합 중 Escape 보호를 적용했다. 프로필 입력 라벨 연결과 짧은 창의 내부 스크롤을 보완했다.

## 보존 확인

로그인 반환부 전의 인증 코드는 새 UI import와 줄 끝 차이를 제외하면 기준 커밋과 동일하다. `AuthContext`, `App`, `main`, `firebase`, `permissions`, `applicationSession`, `studentMenuAccess`, `MainLayout`, `studentAttendance`, Functions 진입점, Rules, Firebase/Vite/Vercel 설정 및 HTML 진입점도 동일하다. 인증 성능 개선은 별도 패치다.

새 공개 컴포넌트의 import는 React, CSS, WebP 8개뿐이다. 공개 홍보 때문에 추가되는 데이터 조회는 없다. 기존 설정 조회·인증 확인·analytics 등 앱의 기존 동작까지 “요청 0회”로 표현해서는 안 된다. 로컬 실제 Login 렌더에서 기존 `school_config` 읽기 1회 후 모든 장면을 내려도 추가 읽기가 없음을 확인했다.

전교생 오픈·가입·allowlist·유지보수·rankPolicy를 변경하는 코드/설정은 이 패치에 없다. 배포와 학생 서비스 개방은 별개다. 자동 오픈이나 예약은 만들지 않는다.

## 검증 결과

- `npm run build`: 통과. TypeScript와 `verify-semester-archive`의 AST/SDK guard, archive/malformed/normal 검증을 포함한다.
- `npm run format:check`: 전체 통과. 수정한 CSS의 Prettier 검사와 `git diff --check`도 통과했다.
- 저장소에 별도 루트 lint/test 명령은 없다. Functions/Rules는 수정하지 않았다.
- Chromium 임시 컨텍스트의 브라우저 회귀 **14개 그룹 통과**: 여섯 viewport에서 다섯 장면의 고정 로그인 위치/히트 테스트/44px 이상 터치 영역, 반복 조립 스크롤, 리사이즈, 게임 정지·1회 종료, reduced-motion 변경, IO 부재·구형 MediaQueryList fallback, CTA/비활성/계속하기, 실제 정책 링크·포커스·Escape, 연속 모달, 로그인 취소 후 복귀·뒤로가기, 작은 화면 가입 모달, 키보드 포커스·기존 화면, 실제 인앱 제한, 관리자 chooser, IME Escape.
- PC 1440×900, 모바일 390×844, 작은 모바일 320×568, 짧은 PC 1280×400, reduced-motion 1280×800의 5장면·성적·정책 캡처를 생성하고 실제 픽셀을 검토했다. 가로 넘침과 렌더 오류는 0이었다. 추가로 가로 568×320 프로필 스크롤, 포커스 링, 동의 모달, 게임 종료 화면을 검토했다.
- 시각 검토에서 모바일 제목 간격, 게임 입력 예시 위치, 헤더/조립 간격, 짧은 창 모달을 보완했다. 모든 PC 장면의 PNG에서 로그인 버튼·로고 픽셀과 클릭 대상이 유지되는 것도 확인했다.

실제 운영 Chrome 창은 표준 접근성 API로 읽기 확인했다. 주소는 `westory.kr/#/teacher/points?tab=ranks`였고 현재 계정의 교사 역할 표시와 교사 메뉴가 보였다. 브라우저의 이메일 자체와 학생 세션은 확인하지 않았다. 기존 로그인 창이나 설정을 조작하지 않았다. 이 관찰은 새 패치의 실제 OAuth 성공 검증을 대신하지 않는다.

## 용량과 로딩

| 측정 | 결과 |
| --- | ---: |
| WebP 전체 8개 | 444,124 bytes |
| PC에서 사용하는 4개 | 255,432 bytes |
| 모바일에서 사용하는 4개 | 188,692 bytes |
| 공개 컴포넌트 전체 JS + CSS, React 제외 | gzip 약 6.5KB |
| 기존 인증 SDK를 포함한 첫 경로의 정적 JS/CSS 의존성 합 | gzip 약 241KB |

Vite가 이미지 파일명에 내용 해시를 붙인다. 같은 홈 이미지를 히어로·조립·부분 이미지에서 재사용한다. 첫 이미지는 eager/high, 아래 이미지는 native lazy다. Chromium은 지연 로딩 여유 범위에 따라 시작 시 홈·학습·성적 이미지를 미리 읽었고 게임 이미지는 스크롤 후 읽었다. 한 viewport에서는 해당 PC 또는 모바일 이미지 4개만 전송됐고 반대 크기 이미지는 전송되지 않았다.

첫 경로의 정적 의존성에 chart/PDF/Excel/실제 게임 엔진은 없다. 기존 다른 경로의 큰 chunk 경고는 유지된다. 위 용량은 파일·gzip 분석과 로컬 요청 관찰이며 실제 CDN 전송량, Google Fonts/Tailwind/Font Awesome, 기존 API 요청 비용, 실기기 LCP/INP/CLS를 측정한 결과가 아니다. 설계의 첫 화면 700KB·전체 1.5MB·Core Web Vitals 목표 달성은 아직 확정하지 않는다.

## 증거와 재검토

저장소와 나란히 있는 작업공간 `review/`에 다음 자료가 있다.

- `screenshots-final/`: 다섯 viewport의 35개 최종 캡처. `pc-hero.png`, `pc-assembly.png`, `pc-learning.png`, `pc-record.png`, `pc-play.png`, `pc-finish.png` 및 같은 이름의 `mobile-*`가 주요 검토 파일이다.
- `screenshots/`: `header-focus.png`, `small-profile.png`, `landscape-profile.png`, `small-consent.png`, `small-restricted.png`, `game-complete.png`, `classic.png` 등 상태별 증거.
- `verify-ui-results.json`, `capture-qa-results.json`, `delivery-results.json`, `verify-source-results.json`, `entry-size.json`, `operational-ui-read.json`.
- `server.mjs`/`review.tsx`/`mocks/`: 실제 Login·PublicEntry 소스와 무해한 로컬 인증/데이터 경계를 조합한 검토 환경. `node server.mjs` 실행 후 `http://127.0.0.1:4322/`에서 확인한다. 운영 인증에 연결되지 않는다.

캡처용 외부 폰트/유틸리티/아이콘은 로컬 대체를 사용했다. 신규 화면과 실제 소스의 배치·상호작용 검증에는 사용했지만 운영 CDN과 픽셀까지 동일하다고 주장하지 않는다. 검토 환경·스크린샷은 배포 대상에 포함하지 않는다.

## 통합·배포 조건

독립 커밋을 부모 작업에서 인증 패치와 통합하고 재검증한다. 이 사본의 `origin`은 로컬 `C:/westory`이므로 이 사본에서 원격 운영 push를 수행하지 않는다. `docs/runbooks/production-release.md`의 최신 main 비교 → Vercel Source commit/Ready → 필요시 Promote → 운영 확인 순서를 따른다. Functions/Rules 일괄 배포는 하지 않는다.

운영의 학생 오픈/유지보수/예외 목록과 실제 학생·교사 OAuth 회귀 확인은 통합 배포 전 남은 조건이다. `openApplicationSession`의 배포 서버 소스가 이 저장소에 없어 해당 서버 게이트의 실제 값까지 여기서 보존 검증했다고 단정할 수 없다. 이 조건을 확인할 때까지 운영 승격을 차단한다.

`/?entry=classic#/`는 기존 로그인 **표현부**를 확인하는 복귀 경로다. 인증·서버 설정 롤백이 아니다. 전체 배포 롤백이 필요하면 직전 검증된 Vercel 운영 배포를 부모 작업에서 승격하고 Source commit과 운영 도메인을 다시 확인한다.
