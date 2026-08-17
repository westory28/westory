# Canonical screen 승인 기록

현재 판정: `W10R CANONICAL SCREENS READY — USER VISUAL ACCEPTANCE PENDING`

검증 기준 커밋은 `7ddfd7202ba3e59eb9e9ded5d105dde4d604693b`이며, Dedicated Staging 배포 `dpl_DFvjkFTw4knYS3ZR34ixcdHqtTJM`이 이 커밋을 dirty 0 상태로 사용합니다.

| 화면              | Route                       | 기능·상태 검증                                                | 접근성                                           | 반응형                                   | 실제 Staging                                                                                                                                                                                                       | 판정 |
| ----------------- | --------------------------- | ------------------------------------------------------------- | ------------------------------------------------ | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---- |
| 교사 업무 홈      | `/teacher/dashboard`        | 브라우저 정상/empty + 상태 분기·회귀 검사                     | 헤더 단일 제목, 직접 링크, 패치 메모 포커스 복귀 | 6개 exact viewport + 1600px, overflow 0  | [열기](https://westory-staging-westoria28-8028-bbbs-projects-44f9da30.vercel.app/#/teacher/dashboard)                                                                                                              | PASS |
| 학생 명단         | `/teacher/students`         | 브라우저 정상 + 필터·검색·행/일괄 작업·상태 분기·회귀 검사    | label·aria·44px 제어·공통 확인 대화상자          | 긴 이메일·학년/반·좁은 표 대응           | [열기](https://westory-staging-westoria28-8028-bbbs-projects-44f9da30.vercel.app/#/teacher/students)                                                                                                               | PASS |
| 문제 은행         | `/teacher/quiz?tab=bank`    | 브라우저 정상 + 탭·문항 수정·문항/분석 상태 분리·회귀 검사    | role=tab, StatePanel, 키보드 수정 동작           | 100vh 잔여 제거, 6개 exact viewport      | [열기](https://westory-staging-westoria28-8028-bbbs-projects-44f9da30.vercel.app/#/teacher/quiz?tab=bank)                                                                                                          | PASS |
| 관리자 학기 전환  | `/teacher/settings/cutover` | 브라우저 정상/disabled + 조회 전용 리허설·상태 분기·회귀 검사 | 사용자 언어, 권한 경계, 내부 코드 비노출         | 6개 exact viewport, overflow 0           | [열기](https://westory-staging-westoria28-8028-bbbs-projects-44f9da30.vercel.app/#/teacher/settings/cutover)                                                                                                       | PASS |
| 학생 모바일 Today | `/student/dashboard`        | 브라우저 정상/empty/disabled + 상태 분기·회귀 검사            | 비허용 action 비링크 처리, 하단 메뉴 단일 mount  | bottom nav 안전 여백, 6개 exact viewport | [학생 계정으로 열기](https://westory-staging-westoria28-8028-bbbs-projects-44f9da30.vercel.app/#/student/dashboard) · [390px 증거](../evidence/w10r-ui-recovery/w10r-canonical-20260817/student-today-390x844.png) | PASS |

여기서 브라우저 검증은 표에 적은 실제 렌더·상호작용 범위를 뜻합니다. loading·empty·error·disabled·permission·긴 한글·위험 확인을 모두 강제로 발생시킨 screenshot이라고 확대 해석하지 않습니다. 나머지 상태는 실제 화면의 `StatePanel`/권한/확인 대화상자 분기와 회귀·정적 gate로 검증했으며, 화면별 방법과 근거는 `canonical-acceptance-results.json`에 분리했습니다. 합성 fixture 정리 뒤에는 destructive browser action을 다시 실행하지 않았습니다.

직접 주소에는 해당 역할 로그인이 필요합니다. 안전 종료 과정에서 합성 학생 계정을 삭제했으므로 교사·관리자 계정으로 학생 화면을 우회하지 않으며, 학생 역할 계정이 없는 검수자는 위 exact PNG와 6개 viewport 증거로 학생 Today를 판정합니다.

## 브라우저·증거 결과

- 고정 주소: <https://westory-staging-westoria28-8028-bbbs-projects-44f9da30.vercel.app>
- 불변 배포 주소: <https://westory-staging-gvy3mj1s3-bbbs-projects-44f9da30.vercel.app>
- 역할별 실제 탐색 15건: 클릭, 새로고침, 뒤로가기, 새 탭, 모바일 drawer/bottom nav, 키보드 포커스 모두 PASS
- 활성 상위 메뉴 1개, 반응형 navigation mount 1개, 가로 overflow 0, 신규 console error 0
- 정확한 viewport 캡처 30장: 5화면 × 320×800, 390×844, 768×1024, 1024×768, 1280×800, 1440×900
- 1600×900 추가 desktop 안정성: 교사 업무 홈 overflow 0, 잘린 action 0, fixed 충돌 0
- 캡처 계약: DPR 1, `fullPage:false`, 실제 PNG 크기·SHA-256·route·role·source SHA 일치
- 증거: `docs/evidence/w10r-ui-recovery/w10r-canonical-20260817/`

## 상태·접근성 근거 범위

- 다섯 화면의 필수 10개 상태 항목은 `canonical-acceptance-results.json`에 50개 행으로 기록했습니다.
- 실제 브라우저 근거와 source/회귀 근거를 `method`로 구분하고, 해당하지 않는 파괴적 작업은 `not-applicable-safe-absence`로 명시했습니다.
- 접근성은 실제 키보드 dropdown/Escape·포커스·모바일 navigation과 함께 heading, label, icon control 이름, 40~44px target, 토큰 대비, equivalent CSS viewport reflow, reduced-motion source 계약을 확인했습니다.
- 200% 확대는 별도 브라우저 확대 screenshot으로 주장하지 않고 768px equivalent CSS viewport와 320/390px reflow 증거로 판정했습니다.
- 스테이징 정리 영수증은 `docs/evidence/w10-ui-ux/w10-w10r-20260817a/cleanup-results.json`에 있으며 합성 사용자·문서·receipt·audit·session·token·debug/bypass·Storage fixture·emulator·port 잔여는 모두 0입니다.

## 동일 viewport 시각 비교

교사 업무 홈을 1600×900, DPR 1의 같은 layout viewport에서 세 계보로 다시 실행했습니다. 기존 UI `c735055…`는 상단 전역 메뉴와 넓은 본문을 유지했고, 실패 W10 `925533f…`는 248px sidebar·64px 가로 overflow·12초 이후 loading 잔류가 확인됐습니다. 복구 UI `7ddfd72…`는 상단 메뉴와 우선 업무 계층을 회복하고 overflow와 loading 잔류가 0입니다. 비교 JPEG는 브라우저 scrollbar 제외 때문에 픽셀 크기가 layout viewport와 다를 수 있어 30개 canonical exact PNG와 혼동하지 않습니다. 파일·해시·배포 provenance는 `comparison/visual-comparison-results.json`에서 검증합니다.

## 자체 UX critique 결론

- 교사 업무 홈은 오늘 우선 업무를 먼저 읽게 하고, 일정·공지·운영 상태를 뒤에 배치했습니다.
- 학생 명단은 필터와 검색을 한 도구 영역으로 묶고 표 중심의 정보 밀도를 회복했습니다.
- 문제 은행은 분석 조건·요약·목록의 순서를 명확히 하고 부분 장애에도 문항 관리를 유지합니다.
- 학기 전환은 내부 구현 코드 대신 준비 학기·검증 상태·다음 단계의 학교 운영 언어를 사용합니다.
- 학생 Today는 이어 할 학습을 첫 행동으로 두고 하단 메뉴와 경쟁하던 floating action을 제거했습니다.

## 승인 경계

다섯 화면은 전용 Staging에서 구현·자동 검사·브라우저 검증·시각 증거를 마쳤습니다. 사용자가 `좋다`고 승인하기 전에는 나머지 route의 UI 이전을 시작하지 않습니다.
