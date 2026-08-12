# W10 Full UI/UX Integration Handoff

작성일: 2026-08-12

기준 Wave: PHASE 6 W9 Teacher Operations, Draft Recovery & Bulk Workflow

## 1. W10에서 보존할 W9 계약

- `teacher_drafts`, `teacher_bulk_jobs`는 서버 권위 경계이며 client direct SDK read/write를 열지 않습니다.
- 빈 화면 mount, query, preview, responsive mount에서는 write가 0이어야 합니다.
- 실제 dirty 입력 뒤 `saveTeacherDraft` debounce만 자동 write로 허용합니다.
- 공식 Domain command receipt 성공을 확인하기 전 Draft를 resolve하지 않습니다.
- `CONFLICT` Draft는 일반 save로 `ACTIVE` 복원할 수 없습니다.
- Bulk는 deterministic child command ID를 사용하고 기존 Domain command를 다시 구현하지 않습니다.
- Archive, Legacy, Explicit는 read-only입니다.

## 2. 아직 구형 UI가 남은 route

- `/teacher/exam`: 대형 평가·성적 운영 화면과 표
- `/teacher/students`: 학생 목록, 상세 modal, 기존 bulk 후보
- `/teacher/history-dictionary`: 사전 편집·XLSX
- `/teacher/maps`: 지도 파일·태그 편집
- `/teacher/source-archive`: 사료 파일 편집
- `/teacher/history-classroom`: 일부 이전 과제·면제 UI
- 설정 하위 화면: 서로 다른 form, table, dialog 패턴

이 route들은 W9 데이터 계약을 바꾸지 않고 W10에서 시각·interaction을 통합합니다.

## 3. 새 Shell은 적용됐지만 Domain UI가 불완전한 화면

- 교사 학습·일정·공지: W9 Draft는 적용됐으나 편집 form의 field grouping과 도움말 밀도는 통합 여지가 있습니다.
- 출석: 390px 핵심 입력은 가능하지만 여러 session 비교와 correction history는 큰 화면에서 더 명확하게 정리할 수 있습니다.
- Grade/Wis/roster: W9 업무 홈은 authoritative 화면으로 연결만 하므로 각 화면의 최종 시각 통합이 필요합니다.
- 업무 홈: 데이터가 없는 카드와 Domain 바로가기의 우선순위를 W10 전체 IA에서 다시 맞춥니다.

## 4. Draft·Bulk 공통 component

- `src/lib/teacherOperations.ts`
- `src/lib/useTeacherDraft.ts`
- `src/components/common/TeacherDraftStatus.tsx`
- `src/components/common/TeacherDraftRecoveryDialog.tsx`
- `src/components/common/TeacherBulkWorkflow.tsx`
- `src/components/common/TeacherOperationsQueue.tsx`

W10은 이 component의 semantics와 state machine을 유지하고 token·layout·microcopy만 점진적으로 다듬습니다.

## 5. Domain별 시각·interaction 차이

- Assessment/Grade/Wis는 자체 Draft lifecycle이 있으므로 W9 Draft를 중복 표시하지 않습니다. 공통 상태 어휘와 badge 위계만 통일합니다.
- Learning/Schedule/Communication은 `useTeacherDraft`의 상태를 form header에 표시합니다.
- Attendance Bulk는 선택 → 안내 → 실행 → 결과 → 실패 항목 재시도 순서를 유지합니다.
- roster import와 Wis 계정 생성은 Domain atomic 결과를 공통 queue에 억지로 복제하지 않습니다.

## 6. Viewport별 잔여 작업

- 390px: data-heavy 표의 핵심 column 우선순위, drawer 진입, 긴 ID의 의미 있는 label 치환
- 768px: list-detail 비율과 sticky action bar 간격
- 1024px: sidebar와 table horizontal scroll 경계, modal 최대 높이
- 1280px: 운영 form과 결과 panel의 밀도 정리
- 1600px: 과도한 빈 공간 없이 wide data container 활용

W9 대표 화면은 다섯 viewport에서 horizontal overflow 0이었습니다. W10은 모든 구형 route에 같은 기준을 확장합니다.

## 7. 접근성 잔여 문제

- 구형 교사 화면의 heading hierarchy와 중복 title 정리
- 일부 기존 modal의 dialog semantics, Escape, focus restore 통합
- data table overflow 영역의 accessible name과 keyboard scroll
- icon-only action의 이름과 44px touch target 전수 확인
- field-level 오류와 `aria-describedby` 연결 확대
- 자동 axe 결과와 실제 keyboard 흐름을 함께 기록

W9 Draft 복구 dialog, Draft 상태, 출석 Bulk 선택·결과·재시도 semantics는 회귀 대상입니다.

## 8. Loading / Empty / Error 차이

- `StatePanel`을 쓰지 않는 이전 화면의 spinner-only loading
- error와 empty가 동시에 보이는 기존 화면
- Domain별 다른 retry 문구
- stale, archive, legacy badge 위치 차이
- query timeout과 permission error를 일반 오류로 합치는 화면

W10에서는 오류 종류와 회복 동작을 유지하면서 표현만 통합합니다.

## 9. Legacy component 제거 후보

- 현재 route에 mount되지 않는 `TeacherNoticeBoard` reorder UI
- 이전 `ManagePoints` 계열 화면
- `/teacher/lesson` redirect 뒤 남은 중복 navigation entry
- canonical W8 화면으로 대체된 Calendar/Notice editor helper
- 공식 Gateway가 fail-closed 처리한 이전 callable wrapper와 dead metadata

삭제 전 route, import, direct URL, previous bundle fence를 다시 확인합니다.

## 10. Bundle / Code Splitting

- W9 `teacherOperations` chunk는 약 8.39 kB(gzip 3.11 kB)입니다.
- `W8TeacherHub`는 약 43.21 kB(gzip 11.66 kB)로 route-level lazy chunk를 유지합니다.
- main은 약 167.93 kB(gzip 50.30 kB)입니다.
- PDF worker, PDF vendor, 대형 legacy management 화면은 W10에서 초기 route와 분리 상태를 재확인합니다.
- Firebase vendor 또는 Excel dependency를 공통 Shell에 정적으로 끌어오지 않습니다.

## 11. W10 대표 acceptance screen

- 교사 업무 홈: 미처리·Draft·Bulk·readiness 우선순위
- 학습 Draft 작성 → 저장 상태 → 동일 UID 복구 → 공식 저장
- 일정 Draft 수정 → 충돌 → 사용자 선택
- 출석 390px selection → preview → 실행 → 부분 실패 → retry
- Grade/Wis/roster data-heavy 화면의 1024/1600px
- 학생 Today/Learning/Grade/Wis의 390/1024/1600px 회귀
- Archive/Legacy/Permission/Error/Maintenance 공통 상태

## 12. 임시 compatibility UI 제거 조건

- 쉼표 구분 class/user ID 입력은 canonical selector가 준비되면 제거합니다.
- 파일/XLSX 관련 임시 UI는 private asset staging과 official receipt 계약 뒤 교체합니다.
- Domain 바로가기-only 업무 홈 카드는 bounded pending projection이 마련된 뒤 실제 count로 교체합니다.
- 이전 화면 redirect는 bookmark/return-path matrix가 통과한 뒤 deprecation register에 따라 정리합니다.

## 13. W10 범위 밖 Release Decision

- 점수·사전 XLSX 업로드의 private parsed-row staging과 부분 실패 정책
- 지도·사료 파일의 private asset upload/promote/TTL 계약
- 패치 메모의 official Gateway receipt 계약
- 학생 bulk delete 결과 adapter와 bulk promote의 Enrollment 정합 정책

정책 없이 localStorage, public Storage, client direct Firestore write로 임시 구현하지 않습니다.

## 14. Production 출시 전 Release Blocker

- `KI-W1-01`: 재인증 뒤 일부 환경의 `users/{uid}` probe permission-denied
- Production idle enforcement 활성화 전 Draft 복구·세션 경고 재검증
- Production dependency audit 경고 검토
- Production Maintenance `enabled=true`, revision `3`의 운영 해제 절차 확인

W10은 이 항목을 숨기거나 해제하지 않습니다.

## 15. W10 Acceptance Test

- canonical route·alias·직접 URL·새로고침·뒤로가기
- Student/Teacher/Admin/Anonymous/Permission/Maintenance
- 390×844, 768×1024, 1024×768, 1280×800, 1600×900
- horizontal overflow 0, dialog 화면 이탈 0, touch target 44px
- keyboard focus order, focus trap, Escape, focus restore, screen reader labels
- Draft mount write 0, dirty debounce만 save, 다른 UID 0, conflict no-overwrite
- Bulk preview write 0, deterministic execution, partial failure, failed-only retry
- W2~W9 aggregate, TypeScript baseline, Rules, Functions, Dedicated Staging
- 합성 fixture·token·debug token·bypass token 잔존 0
- Production 변경 0
