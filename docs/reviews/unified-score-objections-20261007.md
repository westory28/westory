# 이의제기와 답안지 확인 요청 통합

2026-10-07 요청에 따라 수행평가와 정기시험의 답안지 확인을 이의제기에 포함한다.

## 사용자 흐름과 기록

- 학생은 이의제기에서 대상 평가·문항과 사유를 입력하고, 필요하면 `답안지 확인도 요청`을 선택한다. 독립 답안지 확인 버튼과 신청 창은 제거한다.
- 새 요청은 `performance_score_objections` 문서의 `answerSheetRequested` boolean으로 저장한다. 기존 이의제기 문서에서 필드가 없으면 false로 해석한다.
- 교사는 하나의 이의제기 창에서 답안지 확인 요청 여부를 보고 기존 수용·반려·점수 정정 절차로 처리한다.
- 기존 `performance_score_answer_sheet_requests` 기록은 삭제하거나 자동 전환하지 않는다. 통합 창의 `이전 답안지 확인 요청`에서 기존 대기 건을 확인 완료로 처리할 수 있다. 학생의 기존 대기 표시와 서명 제한도 유지한다.
- 기존 알림 및 `panel=answer-sheet-requests` 주소는 통합 이의제기 창으로 연결한다. 폐쇄된 독립 접수의 알림 설정은 제거하고, 이의제기 알림에서 답안지 확인 요청 여부를 함께 취급한다.

## 서버 계약

- `notifyPerformanceScoreObjectionRequested`만 새 접수를 받는다. `answerSheetRequested`는 boolean만 허용하며, 이미 pending 문서에서 true인 요청은 오래된 클라이언트의 재전송으로 해제되지 않는다.
- 독립 `notifyPerformanceScoreAnswerSheetRequested`는 기존 세션 검증 뒤 `failed-precondition` 및 `ANSWER_SHEET_REQUEST_REQUIRES_OBJECTION`을 반환한다. 오래된 화면도 별도 접수를 생성할 수 없다.
- 동일한 본인 UID, 학기, 활성 학생, 점수 종류, 안내 동의, 서명 상태, 공식 성적 원장 보호 조건을 적용한다. 서명 완료 이후의 별도 답안지 신청 우회 경로는 없어진다.
- 학생의 Firestore 직접 생성은 기존 rules에서 두 컬렉션 모두 거부한다. 교사는 구 요청의 처리만 계속할 수 있다. 이번 변경에서는 rules를 넓히지 않는다.
- 새 이의제기가 대기 중이면 기존 `objectionPending`과 서명 rules가 서명을 막고, 교사의 처리 후 기존 결과 확인·재확인 흐름으로 이어진다.

## 검증 범위

- `scripts/verify-score-objection-client-contracts.mjs`: 세션 어댑터의 통합 요청, 학기·UID 필터, boolean 호환성, 기존 알림 링크.
- `scripts/verify-score-workflow-emulator.mjs`: 실제 서버 핸들러와 Firestore rules를 사용하는 합성 학생·교사 흐름. 독립 API 차단, 통합 요청·알림, 권한·학기·동의·서명 제한, 기존 요청 처리.
- 학생·교사 브라우저 검증은 합성 데이터와 로컬 요청만 사용한다. 실제 운영 학생의 접수·점수·서명을 검증용으로 생성하거나 수정하지 않는다.
- 기존 NEIS 가져오기, 명단 연결, 점수 수정, 서명 유효성, 엑셀 점선(`hair`) 회귀 검사 및 기본 빌드를 함께 수행한다.

검증 결과: 앱 build·format, Functions check, 실제 Auth/Firestore emulator, 클라이언트 계약, 기존 명단·서명 계약이 모두 통과했다. 학생 `verify-student-score-objection-browser.mjs`와 교사 `verify-score-workflow-browser.mjs`는 390/768/1280px에서 통과했고 pageErrors는 0이었다. 동의·서명·처리 완료 제한, 저장 오류 시 입력 보존, 키보드 초점 이동·복귀, 전송 중 닫기 차단, 구 기록 조회 실패 후 복구도 검사했다. 첨부 양식의 점선 `hair`와 실선 경계는 1/31/32/33/40명 출력 회귀 검사로 보존을 확인했다.

## 운영 반영 범위

프론트엔드는 최신 main을 포함한 커밋의 Vercel 배포를 검증·승격한다. Firebase는 변경된 `notifyPerformanceScoreObjectionRequested`, `notifyPerformanceScoreAnswerSheetRequested` 두 함수만 배포한다. 운영 로그인·세션 및 다른 함수는 배포하지 않는다.
