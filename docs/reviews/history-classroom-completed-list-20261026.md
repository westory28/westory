# 역사교실 완료 항목 흐림 표시

- 범위: 교사 역사교실 일반 목록의 표시만 변경한다. 학생 화면, 결과 저장, 권한, 학기 경로는 변경하지 않는다.
- 배정 학생이 한 명 이상이고 모든 학생에게 통과 결과 또는 성공한 면제 적용 기록이 있으면 완료로 표시한다. 기존 canonical/legacy 결과 병합과 이전 통과 우선 규칙을 재사용한다.
- 접힌 완료 항목은 opacity 0.6, blur 0.35px를 적용한다. Hover, 키보드 focus-within, 상세 펼침 시 선명하게 복원한다. 기존 편집·펼침 버튼을 유지한다.
- 기존 목록 구조를 유지하여 공통 페이지 계약의 새 예외는 없다.
- `node scripts/verify-history-classroom-teacher-results.mjs`: 통과.
- `node scripts/verify-history-classroom-teacher-browser.mjs --results-only`: 통과. 390/768/1280px 실제 컴포넌트에서 전원 통과, 면제 혼합, 전원 면제, 이전 통과 후 실패, 미제출, 미통과, 자동 종료, 배정 없음 및 상호작용 시 선명도 복원을 확인했다. 합성 자료만 사용하며 새 표시 검증은 저장 명령을 호출하지 않는다.
- 390/1280px 스크린샷에서 기존 목록 배치와 흐림 표시를 확인했다. 증거는 로컬 `.superloopy/sessions/history-classroom-followup/evidence/teacher-completed-list-*.png`에 있다.
- 변경 TSX의 Prettier 검사와 `git diff --check`: 통과.
- `npm run build`: 필수 prebuild 회귀 검사와 Vite 빌드 통과. 기존 번들 크기 경고만 남는다.
