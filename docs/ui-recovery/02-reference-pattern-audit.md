# UI Bowl 레퍼런스 패턴 감사

상태: 공개 접근 가능한 사례 조사 완료
판단 기준: `education-web-design-system`

## 조사 범위와 한계

[UI Bowl 웹](https://uibowl.io/website)과 [UI Bowl 홈](https://uibowl.io/)에서 실제로 열리는 공개 결과만 확인했습니다. 공개 화면은 각 filter 조합에서 최신 3개 결과가 보이는 범위였고, 유료 화면이나 열어보지 않은 화면은 추정하지 않았습니다.

| 매체 | 필터 | 실제 확인한 제품·화면 | 사례 수 |
| --- | --- | --- | ---: |
| Web | dashboard + business tool | 당근 비즈니스, 잔디/위더스 계열 dashboard 결과 | 3 |
| Web | filter + business tool | 리스닝마인드 필터-패스파인더, 당근 비즈니스 필터-광고, Dovetail | 3 |
| Web | settings + business tool | 당근 비즈니스 설정·광고계정 관리, Dovetail 설정 | 3 |
| Mobile | main + 교육·도서 | 세모, 틈틈잇, 하이링구얼 | 3 |
| Mobile | learning + 교육·도서 | 틈틈잇 OX 학습의 서로 다른 상태 | 3 |

총 15개의 화면 단위 사례를 확인했습니다. 숫자는 서로 다른 filter 결과에서 실제로 표시된 화면 수이며, 제품 수와 같다는 뜻은 아닙니다.

## 반복해서 확인된 패턴

| 패턴 | Westory 적용 | 적용하지 않는 방식 |
| --- | --- | --- |
| dashboard는 현재 할 일과 상태가 첫 viewport에 모임 | 교사 홈을 우선 업무 → 일정 → 상태 → 자주 쓰는 기능으로 구성 | 큰 환영 문구와 장식 카드로 시작 |
| filter는 데이터와 가까운 compact control 집합 | 학생 명단·문제 은행 toolbar에 적용 | 필터 하나가 화면 한 줄 전체를 차지 |
| 표는 업무용 밀도를 유지 | 학생 명단·문제 상세 목록을 표로 유지 | 모든 row를 큰 카드로 변환 |
| settings는 좁은 문맥 nav와 flat section | 학기 전환의 단계/상태/위험 영역에 적용 | 전역 sidebar를 모든 화면에 강제 |
| mobile main은 핵심 행동 하나와 순차 section | 학생 Today의 이어서 학습을 첫 행동으로 지정 | FAB와 본문 primary와 bottom nav가 경쟁 |
| 학습 상태는 정답/오답/진행 상태가 즉시 구분 | loading·empty·error·permission을 의미별로 구분 | 색 하나 또는 빈 화면만으로 상태 표현 |

## Westory로 번역한 결정

레퍼런스의 브랜드 색, radius, 그림자, 카드 모양을 복사하지 않습니다. 반복 검증된 정보 구조만 가져와 Westory token과 기존 브랜드에 맞게 통합합니다.

- 교사용 화면은 업무용 중밀도, 표와 compact filter 중심입니다.
- 학생 화면은 한 화면 한 목적, 짧은 문장, 명확한 다음 행동을 우선합니다.
- desktop은 상단 전역 nav, mobile은 교사 drawer와 학생 bottom nav를 씁니다.
- 좌측 panel은 목록+상세나 설정 하위 구조처럼 문맥이 필요한 화면에만 둡니다.
- 장식적인 gradient, 과도한 shadow, 여러 primary action, 의미 없는 icon-only control은 채택하지 않습니다.

## 화면별 traceability

| Westory 기준 화면 | 참고한 정보 구조 | 최종 판단 |
| --- | --- | --- |
| 교사 업무 홈 | business dashboard의 우선순위·상태·밀도 | 긴급성과 오늘성을 먼저, KPI는 보조 |
| 학생 명단 | filter + dense table | 검색·학년·반·새로고침을 하나의 toolbar로 통합 |
| 문제 은행 | filter rail + metrics + chart + table | 분석 위계를 유지하되 시각화가 표를 대체하지 않음 |
| 학기 전환 | settings section + contextual progression | 사용자 언어와 위험 단계 분리, 내부 증거는 상세 |
| 학생 Today | education mobile main + learning states | 핵심 행동 1개, 일정·공지·진행을 순차 배치 |
