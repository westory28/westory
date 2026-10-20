# 학생 화면·멀티플레이·조회 비용 개선

## 범위

2026-10-20 요청의 점수 계산기, 위플레이 멀티플레이, 게임 카드, 문제 풀이·학습지 로딩, 마이페이지, 학생 개발자 일지를 수정한다. 추가 지시대로 폐기된 판서 기능을 복구하지 않고 잔존 연결을 제거한다. 각주·빈칸·시험 중요 부분 표시와 수행평가 확인 서명은 유지한다.

작업 시작 HEAD는 `a7af6ff829f7da58bcd4d5005b4d3801a94e8c24`이며 당시 운영 Vercel 배포도 같은 커밋이었다. 진행 중 별도 순위 작업 `9d1a0ff4166fb7cdbf3d684502a4895ab9c09e41`, `927f179fe5f5887aafffd8d19e2ae2e17bcb4377`이 main에 반영되어 격리 검증 작업 공간의 기준도 갱신했다. 기존 `scripts/verify-portal-design.mjs` 변경과 `output/`은 이 패치의 커밋 대상에서 제외한다.

## 변경 계약

- 점수 입력 슬라이더·숫자 입력·환산 점수·과목 합계를 같은 영역에 표시한다. 입력 전/0점/일부 입력을 구분하며 계산은 항목별 선반올림 없이 합산 후 반올림한다. 명칭은 점수 계산기로 통일한다. 저장 버튼은 제목 옆과 목록 끝에 있으며 저장 중 추가 입력·실패 재시도·학기별 임시값 복구를 보존한다.
- 윷놀이의 정상 방 생성 후 실시간 읽기 거부를 에뮬레이터에서 재현한다. 세션·가입 승인·학교·학기·학급·공개 여부·참가자 검사를 유지하고 규칙의 반복 평가 비용을 줄인다. 미시작 방은 10분 만료 후 입장/시작을 거부하고 서버가 정리한다. 시작된 방은 정리하지 않는다.
- 학생 게임 선택은 파란 18px 버튼으로 강조하며 카드 hover/focus/누름 모션을 유지한다. 사용자 명시 요청대로 이 카드에 한해 동작 감소 설정에서도 모션을 제공한다.
- 목차 조회는 `view: catalog`의 경량 필드만 읽고 본문은 `unitId`로 선택 조회한다. 구 클라이언트의 전체 조회와 진행도 요약은 유지한다. 숨김·삭제된 최신 학기 자료가 과거 공개 자료를 되살리지 않으며 학기 보관 조회는 기존 읽기 경로를 유지한다.
- 평가 목록의 교육과정·공개 설정·학급 정보, 평가 진입의 서버 상태·교육과정은 독립 조회를 병렬 실행한다.
- 마이페이지는 읽기 폭 1152px와 기존 공통 탭을 사용한다. 대·중·소단원 드롭다운은 한 행을 유지한다. 수행평가 전체 기록은 성적표 첫 진입에 읽는다.
- 학생 개발자 일지는 기존 공통 주소를 유지하면서 학생 사이드바·계정 행과 읽기 폭·공통 탭을 적용한다. 교사 편집 권한은 그대로 유지한다.

## 읽기 비용 확인

운영 현재 학기 수업 자료 13문서를 읽기 전용 Firestore REST 조회로 비교했다. 전체 문서 응답은 UTF-8 2,057,094바이트, 목차 필드 projection 응답은 9,035바이트였다. 이는 해당 REST 응답의 전송량 비교이며 사용자 네트워크·콜드 스타트가 포함된 화면 로딩 시간 측정은 아니다. 학생 기록이나 원본 내용은 검증 기록에 저장하지 않았다.

`getStudentVisibleLessons`의 운영 소스를 내려받아 변경 전 `studentLessonAccess.js`, `scoreWorkflowGuard.js`, `sessionAuthority.js`, `studentMaintenance.js`, `studentRegistrationAccess.js`가 로컬 기준과 동일함을 LF 정규화 비교로 확인했다. 배포 대상은 실제 변경된 조회 함수와 게임 함수·규칙·인덱스로 한정한다.

## 검증

- `npm run typecheck`
- `scripts/verify-score-subject-order.mjs`
- `scripts/verify-score-calculator.mjs`: 실제 Edge, 320/390/768/1280/1366px; 슬라이더·키보드·수동 저장·저장 중 수정·실패 재시도·학기 분리·임시값 복구·빈 화면·오류
- `scripts/verify-student-mypage-layout.mjs`: 실제 Edge, 320/390/768/1280/1366px; 대·중·소 한 행·44px 조작·하위 초기화·키보드·빈 목록·재시도·탭별 조회 횟수. 개발자 일지 390/768/1280px
- `scripts/verify-student-lesson-queries.mjs`: 목차/최근 단원 동시 요청 공유, 본문 단원 제한, 빈칸 보존, 전체 요약 호환, 학기/계정 격리
- `scripts/verify-student-access.mjs`: 독립 Firestore 에뮬레이터 18220, 새 목차/단원 조회·학급·숨김·삭제·legacy·세션·가입·점검 회귀
- `scripts/verify-canonical-assessment-client.mjs`, `scripts/verify-assessment-attempt-safety.mjs`
- `scripts/verify-lesson-loading.mjs`, `scripts/verify-student-map-resources.mjs`
- `scripts/verify-portal-design.mjs --kind=tabs`: 학생/교사 320/390/768/1280/1366/1440px 공통 탭 회귀
- `scripts/verify-student-developer-log-layout.mjs`: 개발자 일지 목록·상세의 실제 MainLayout/Header/Footer 학생 분기와 교사 분기
- `scripts/verify-lesson-annotations-retired.mjs`: 실제 학습지 3개 모드와 교사 제시 화면, 잔존 판서 상태·사용 가능 옵션을 주입해도 판서 도구·저장·복원 호출 없음. 각주·빈칸·페이지 이동 유지
- `functions/scripts/verify-yut-network.cjs`: 실제 SDK 4개 클라이언트의 생성·입장·준비·시작·연결 복구·단일 skip·응답 순서 역전·화면 이탈
- `functions/scripts/verify-yut-expiration.cjs`: 미시작 10분 만료, 시작과 정리 경합, 코드 재사용 경합, 진행 중 방 보존, 교사 로컬 미리보기 유지
- `scripts/verify-yut-management-browser.mjs` 학생 범위: 390/768/1280px 카드 CTA·hover/focus·동작 감소 설정, 실제 게임 진입의 초기 로비 응답 재사용

판서는 `TeacherLessonPresentation`, 실행기, 저장 경로 유틸의 잔존 코드를 제거하고 공통 학습지에서 판서 상태를 초기화·복원·저장하지 않도록 했다. 해당 교사 제시 컴포넌트는 변경 전에도 다른 실행 화면에서 import되지 않는 잔존 코드였다. Firestore의 기존 `lesson_presentations` 하위 경로는 교사·관리자를 포함하여 읽기·쓰기 모두 차단한다. 과거 원본 문서를 일괄 삭제하지 않았으며 각주·빈칸·출제용 중요 표시와 PDF 글자 마스킹·수행평가 서명은 유지한다.

브라우저 검증은 합성 계정·격리된 읽기 응답을 사용한다. 실제 운영 학생의 점수·답안·학적을 수정하지 않는다. 현재 브라우저의 운영 세션은 교사이므로 학생 기능의 실제 데이터 변경 검증을 대신하지 않는다.

## 최종 회귀 결과

일반 점검 설정 검증에 윷놀이용 최적화를 함께 적용했던 중간 패치에서 학생 프로필 저장의 규칙 평가 한도 초과를 발견했다. 일반 `hasValidMaintenanceBypassUids`·점검 설정·프로필 변경 검증은 기준 원문 그대로 유지하고 최적화는 윷놀이 전용으로 분리했다. 별도 검토자가 함수 본문 일치와 Yut의 학교·세션·학기·학급·공개 여부·참가자 조건을 확인했다.

- 최종 일반 학생 접근 전체 8개 그룹 PASS: 정상 프로필·동의 저장, 권한 변조, 점검 차단·명시 우회, 세션·가입, 학습지 필터, ThinkCloud, Weplay, 정산. 격리 포트 18226, `%TEMP%\westory-yut-student-access-final.log`.
- 최종 Yut 통합 PASS: 정상 우회 UID 20개, 명시 우회, 다른 학생 차단, 현재 UID와 잘못된 값의 혼합 및 20번째 공백 차단, 교사·관리자의 판서 읽기·수정·삭제 거부. 격리 포트 18225, `%TEMP%\westory-yut-integration-final.log`.
- 최신 운영 `commandYutRoom` 소스(2026-10-19 갱신)의 `yut.js`, `yutCore.mjs`, `yutReward.js`, `scoreWorkflowGuard.js`, `studentMaintenance.js`, `sessionAuthority.js`가 변경 전 기준과 일치했다.
- `yut_rooms`의 collection-group `status ASC / createdAtMs ASC` 복합 인덱스는 운영에서 READY를 확인했다.
- 최신 main 기준 `npm run build`와 `npm --prefix functions run check` PASS. 기존 대형 청크 경고는 남아 있다.

## 배포 범위

검증된 패치만 별도 `student-experience` 작업 공간에서 배포한다. Firebase 대상은 `getStudentVisibleLessons`, `getYutLobby`, `commandYutRoom`, `getYutManagement`, `cleanupWaitingYutRooms` 및 Firestore rules다. 학습지 조회 함수는 운영 업데이트 성공을 확인했다. 게임 함수·규칙 배포 후 함수 상태, 매분 정리 스케줄, 운영 규칙 소스 일치를 확인한다. 프론트엔드는 이 패치가 포함된 main의 Vercel 배포를 Ready 이후 운영에 승격하고 `www.westory.kr`의 연결 커밋과 변경 자산을 확인한다.
