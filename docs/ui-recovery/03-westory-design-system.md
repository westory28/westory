# Westory W10R 디자인 시스템

상태: canonical checkpoint 계약
상위 기준: `DESIGN.md`, `UI_RULES.md`, `education-web-design-system`

## 제품 원칙

Westory는 수업과 학교 업무를 돕는 차분한 교육 도구입니다. 교사에게는 중밀도 업무 화면을, 학생에게는 한 번에 이해되는 학습 흐름을 제공합니다. 가장 중요한 원칙은 통일성이며, 같은 의미·행동·상태는 같은 구조와 표현을 사용합니다.

## 시각 토큰

실제 token 값의 source of truth는 `DESIGN.md`와 `assets/css/style.css`입니다. W10R 이전 영역에서 raw color나 임의 spacing을 새로 만들지 않습니다.

| 범주           | 계약                                                                                             |
| -------------- | ------------------------------------------------------------------------------------------------ |
| 색             | brand/action, text/subtle, surface/canvas, border, success/warning/danger/info의 의미 token 사용 |
| typography     | 본문 16px 기준, 보조문구 14px 이상, 학생 핵심 문구는 16~18px, 제목은 단계별 위계만 사용          |
| spacing        | 4px 기반 단계 사용; page gutter와 section gap은 viewport 계약에 따라 변경                        |
| radius         | control, panel, dialog의 역할별 token 사용; nested card마다 radius를 반복하지 않음               |
| shadow         | overlay·drawer·dialog처럼 계층이 실제로 뜰 때만 사용                                             |
| control height | 기본 44px, 중밀도 compact control 40px                                                           |
| navigation     | 전역 nav 48px, 문맥 sidebar 224px                                                                |
| focus          | `:focus-visible` outline과 충분한 대비; 색 변화만으로 표현하지 않음                              |

## 반응형 계약

| 폭           | 학생                                     | 교사·관리자                 | 본문 원칙                                                          |
| ------------ | ---------------------------------------- | --------------------------- | ------------------------------------------------------------------ |
| `<768px`     | 간결한 header + bottom nav + More drawer | 간결한 header + menu drawer | 1열, 44px touch target, 표는 우선순위 column 또는 명시적 가로 탐색 |
| `768–1023px` | bottom nav 유지, 콘텐츠 폭 확장          | menu drawer 유지            | 1~2열 재배치, action wrap 허용                                     |
| `≥1024px`    | 상단 전역 nav                            | 상단 전역 nav               | 전역 좌측 sidebar 없음, 문맥 panel만 제한적으로 사용               |

검증 viewport는 320×800, 390×844, 768×1024, 1024×768, 1280×800, 1440×900이며 1600×900은 필수 추가 desktop 안정성 검사입니다. canonical screenshot은 DPR 1, `fullPage:false`로 생성하고 1600px 비교 캡처는 별도 provenance로 구분합니다.

## 정보 계층

1. global shell: 브랜드, 전역 메뉴, 세션·알림·계정
2. page header: route title, 한 줄 설명, 학기 문맥, page-level primary action 최대 1개
3. local navigation/filter: 해당 데이터 바로 옆에 compact하게 배치
4. primary content: 표·목록·학습 본문
5. support state/action: 보조 설명, secondary action, 상세 증거

페이지 내부에서 global PageHeader와 같은 제목·학기 문맥을 반복하지 않습니다.

## 상태 언어

| 상태        | 사용자에게 보여줄 것                 | 필수 행동                            |
| ----------- | ------------------------------------ | ------------------------------------ |
| loading     | 무엇을 불러오는지                    | 불필요한 layout shift 없이 진행 상태 |
| empty       | 왜 비었는지, 정상 empty인지          | 가능한 다음 행동 1개                 |
| error       | 실패한 작업과 영향 범위              | 안전한 재시도 또는 돌아가기          |
| permission  | 필요한 권한과 현재 제한              | 담당자 문의 또는 허용된 route로 이동 |
| disabled    | 지금 실행할 수 없는 이유             | 해제 조건                            |
| destructive | 삭제·전환 대상과 되돌릴 수 있는 범위 | 별도 확인 단계, danger hierarchy     |

색만으로 상태를 구분하지 않고 icon, 제목, 설명, 행동을 함께 사용합니다.

## 사용자 언어

- 내부 코드보다 학교 업무의 대상을 먼저 씁니다.
- `Manifest`, `revision`, `PARTIAL_SHELL`, `schema`, `policy`, internal state code를 주 화면에 그대로 노출하지 않습니다.
- 교사 문구는 작업과 결과를 중심으로, 학생 문구는 다음 행동을 중심으로 씁니다.
- 긴 한글은 단어 중간을 임의 분절하지 않고 자연스럽게 wrap합니다.

## 금지 패턴

카드 안의 카드, 여러 primary action, 상시 FAB, 설명 없는 icon-only button, 임의 raw color/spacing/radius/shadow, 브라우저 기본 control 방치, 중복 페이지 제목, 과도한 empty state, 모든 화면의 전역 sidebar를 금지합니다.
