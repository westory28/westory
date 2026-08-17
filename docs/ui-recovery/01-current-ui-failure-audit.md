# W10 현재 UI 실패 감사

상태: 감사 완료
기준: W11 기능 SHA `ef74b571…`, W10 시각 evidence, W4 시각 기준 `c735055…`

## 핵심 결론

W10의 문제는 개별 카드 장식이 아니라 표현 계층입니다. W5부터 도입된 248px 전역 교사 sidebar가 모든 업무 화면의 가로 공간을 잠식했고, route metadata의 전역 PageHeader와 페이지 내부 제목이 겹치며, 카드 안에 카드가 반복되어 정보보다 여백과 경계가 더 강해졌습니다. 학생 모바일은 floating action과 bottom navigation이 같은 화면 우선순위를 경쟁합니다.

## 관찰 근거

| 근거                                                                                |           실제 크기 | 판정                                                     |
| ----------------------------------------------------------------------------------- | ------------------: | -------------------------------------------------------- |
| `docs/evidence/w1r3-access-viewports/admin-settings-1600x900.png`                   |            1600×900 | W10 이전 상단 내비게이션과 본문 폭의 검증된 참고         |
| `docs/evidence/w1r3-access-viewports/admin-settings-390x844.png`                    |             390×844 | W10 이전 모바일 흐름 참고                                |
| `docs/evidence/w10-ui-ux/w10-20260812-final-925533f/teacher-dashboard-1600x900.png` |           1585×1933 | 파일명과 PNG metadata 불일치, viewport evidence로 부적합 |
| `docs/evidence/w10-ui-ux/w10-20260812-final-925533f/teacher-students-1600x900.png`  | 장문 full-page 성격 | 실패 양상 확인용, 동일 viewport 비교용 아님              |
| `docs/evidence/w10-ui-ux/w10-20260812-final-925533f/student-today-390x844.png`      |            375×1712 | 파일명·실제 폭 불일치, full-page 성격                    |
| `docs/evidence/w11-cutover/w11-20260814-7894ab5/teacher-cutover-1600x900.png`       |   기존 W11 evidence | 기능 위치 확인용                                         |

기존 증거의 metadata 한계를 보완하기 위해 Dedicated Staging에서 세 계보를 같은 1600×900 layout viewport, DPR 1로 다시 실행했습니다. `c735055…` 기존 UI는 overflow 0, `925533f…` 실패 W10은 sidebar와 64px 가로 overflow 및 12초 이후 loading 잔류, `7ddfd72…` 복구 UI는 overflow와 loading 잔류 0이었습니다. 비교 JPEG는 scrollbar를 제외한 브라우저 캡처이므로 exact viewport PNG로 재분류하지 않습니다. 파일 해시와 각 임시 배포 provenance는 `docs/evidence/w10r-ui-recovery/w10r-canonical-20260817/comparison/visual-comparison-results.json`에 기록했습니다.

## 실패 패턴

| 영역             | 확인된 문제                                       | 사용 영향                                                      | W10R 결정                                                        |
| ---------------- | ------------------------------------------------- | -------------------------------------------------------------- | ---------------------------------------------------------------- |
| Shell            | 전역 좌측 sidebar가 desktop 모든 route에 고정     | 표·필터·상세가 좁아지고 제품 전체가 관리 콘솔처럼 보임         | 1024px 이상 상단 전역 nav, 좌측은 화면 자체의 문맥 패널에만 허용 |
| Navigation       | route는 존재하지만 child menu가 렌더링되지 않음   | 기존 기능을 주소를 알아야만 접근                               | 역할별 registry + desktop dropdown + mobile drawer로 복구        |
| Page heading     | 공통 PageHeader와 페이지 내부 h1·학기 문맥 중복   | 첫 화면의 실질 정보가 아래로 밀림                              | 공통 PageHeader를 단일 소유자로 지정                             |
| Density          | 카드 안의 카드, 큰 padding, 빈 영역               | 교사 업무 스캔 속도 저하                                       | flat section + 중밀도 표·목록 유지                               |
| Controls         | 버튼·select·tab의 높이와 형태 혼재                | 같은 행동의 예측 가능성 저하                                   | 기본 44px, compact 40px 계약 적용                                |
| Student Today    | floating action과 bottom nav 경쟁                 | 엄지 동선과 주요 행동이 충돌                                   | 주요 행동 1개, bottom nav 안전 영역 확보, 전역 FAB 제거          |
| State            | loading·empty·error·permission의 시각 차이가 약함 | 사용자가 기다릴지, 재시도할지, 권한을 요청할지 판단하기 어려움 | `StatePanel` 의미별 계약 적용                                    |
| Cutover language | 내부 상태 코드와 구현 용어 노출 가능성            | 관리자가 위험도를 이해하기 어려움                              | 사용자 언어로 번역, 원문 코드는 상세/증거 영역에만 제한          |
| Evidence         | viewport 파일명과 실제 PNG 크기 불일치            | 시각 회귀 주장을 재현할 수 없음                                | DPR 1, `fullPage:false`, 실제 PNG metadata validator 도입        |

## 화면별 자체 critique

### 교사 업무 홈

업무 우선순위보다 동일한 무게의 카드가 먼저 보입니다. 일정, 알림, 운영 상태, 자주 쓰는 기능이 서로 경쟁하고 화면 상단의 중복 설명 때문에 핵심 작업이 첫 viewport 아래로 밀립니다. 복구안은 긴급/오늘 해야 할 일 → 오늘 일정 → 핵심 상태 → 자주 쓰는 기능 순으로 읽히게 합니다.

### 학생 명단

필터와 action이 넓은 한 줄을 각각 차지하고 표 컨테이너가 여러 경계 안에 들어가 정보 밀도가 낮습니다. 대량 선택과 행 단위 수정·삭제의 위험도가 비슷하게 보입니다. 복구안은 필터·검색·새로고침을 하나의 compact toolbar로 묶고 표를 중심으로 유지하며 좁은 화면에서는 column priority와 horizontal affordance를 명확히 합니다.

### 문제 은행

다중 필터, 지표, 차트, 상세 목록의 위계보다 각 박스의 외곽선이 강합니다. URL의 `tab=bank`와 선택 상태가 확실히 동기화되어야 직접 주소와 뒤로가기가 작동합니다. 복구안은 compact filter rail, 3~4개 요약 지표, 작은 시각화, 상세 표 순서를 유지합니다.

### 관리자 학기 전환

안전 장치 자체는 보존해야 하지만 `manifest`, `revision`, `PARTIAL_SHELL`, `schema`, `policy` 같은 구현 용어가 주 의사결정 언어가 되면 안 됩니다. 복구안은 현재 학기/준비 학기, 검증 상태, 다음 단계, 위험 작업, 실패 시 복구를 사용자 언어로 먼저 보여주고 기술 증거는 펼침 상세로 둡니다.

### 학생 모바일 Today

모바일 헤더, 본문 action, floating action, bottom navigation이 동시에 주 행동처럼 보입니다. 긴 한글 제목이 작은 카드에서 비정상 분절될 위험도 있습니다. 복구안은 이어서 학습 1개를 먼저, 오늘 일정과 공지, 진행 상태를 차례로 배치하고 하단 nav와 겹치지 않는 안전 여백을 둡니다.

## 복구하지 않는 것

- W4 화면을 픽셀 단위로 복사하지 않습니다.
- W11 기능·권한·데이터 경계를 W4 코드로 되돌리지 않습니다.
- legacy 전체를 한 번에 정리하거나 W10R 승인 전 나머지 route로 디자인을 확산하지 않습니다.
- 기존 실패 evidence의 잘못된 크기를 정상 viewport 증거로 재분류하지 않습니다.
