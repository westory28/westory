# W11 Cutover UI Target Specification

기준 화면은 W10에서 확정한 Westory Shell, `PageHeader`, `StatePanel`, `ProvenanceBadge`, `ResponsiveDataContainer`입니다. W11은 별도의 시각 체계를 만들지 않고 이 Foundation 안에서 학기 전환 준비 상태를 더 촘촘하게 보여 줍니다.

## Visual thesis

파란 primary와 얇은 구분선으로 검증 순서를 읽히게 하고, 실제 운영 활성화처럼 보이는 제어는 노출하지 않는 차분한 Staging 운영 화면을 만듭니다.

## Content plan

1. 화면 상단: `Dedicated Staging · 합성 데이터 전용` 범위와 Production 작업 불가 상태
2. 학기 맥락: Current source, Preparing target, Archive reference의 provenance·revision·read-only
3. 작업 흐름: 계획, 드라이런, 제한된 합성 실행, 검증, 복구, rollback plan
4. 검증 결과: readiness, dataset count·join·hash, orphan·duplicate·stale dependency
5. 근거: attempt·item·report의 상태와 재시도 가능한 실패

## Interaction thesis

- selector 변경과 diff 행 확장은 `--motion-fast` 또는 `--motion-base`의 opacity·transform만 사용합니다.
- preview·query는 상태 문구만 바꾸고 business write를 만들지 않습니다.
- 실행 계열은 사용자가 명시적으로 누른 합성 Staging command만 허용하며, loading·partial·failed 상태를 live text로 전달합니다.
- `prefers-reduced-motion`에서는 전환 효과를 제거합니다.

## 390 × 844

- 한 열 흐름으로 `Staging 범위 → source/target → 다음 안전 행동 → 차단 항목` 순서를 유지합니다.
- dataset 비교 표는 가로 스크롤 가능한 이름 있는 region으로 제공하고, 핵심 상태·count·차이는 첫 열에서 읽힙니다.
- 상태 필터와 행동 버튼은 44px 이상이며 화면 밖으로 밀리지 않습니다.
- Production 활성화, Maintenance 변경, arbitrary data editor는 0개입니다.

## 1024 × 768

- compact teacher rail과 충돌하지 않는 두 영역 layout을 사용합니다.
- 왼쪽은 계획·attempt 목록, 오른쪽은 선택한 diff·readiness·report 세부 정보입니다.
- header, filter, table에 중복 sticky 축을 만들지 않습니다.
- dialog와 result panel은 viewport 안에 머물며 Escape와 focus restore를 지원합니다.

## 1600 × 900

- `--ws-workspace-max`를 사용해 count·join·hash 비교를 넓게 보여 줍니다.
- 상태 수치를 카드 모자이크로 만들지 않고 summary strip, section, table 순서로 구성합니다.
- 큰 화면의 여백을 채우기 위한 장식 panel은 추가하지 않습니다.

## Student representative states

- Current: `현재 학기`와 수정 가능한 현재 맥락을 학생 언어로 표시합니다.
- Preparing: 아직 학생 활동 대상이 아니며 읽기 전용임을 짧게 표시합니다.
- Archive: `지난 학기`, 읽기 전용과 돌아갈 위치를 함께 제공합니다.
- Legacy·Explicit: 출처를 숨기지 않으며 Current처럼 보이게 만들지 않습니다.
- 학생 화면에는 readiness, deployment, operation, policy 같은 운영 용어를 노출하지 않습니다.

## Visual QA evidence

실제 UI가 Staging에 준비된 뒤 다음 파일을 실행별 evidence 폴더에 저장합니다.

- `teacher-cutover-390x844.png`
- `teacher-cutover-1024x768.png`
- `teacher-cutover-1600x900.png`
- `student-current-390x844.png`
- `student-archive-1024x768.png`
- `student-preparing-390x844.png`

각 화면은 horizontal overflow, navigation overlap, focus visibility, 상태의 비색상 표현, activation control 0을 함께 검토합니다. 캡처 전 PASS를 기록하지 않습니다.
