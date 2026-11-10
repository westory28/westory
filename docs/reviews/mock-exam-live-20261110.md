# 모의고사 증분 분석·응시 복구·교정 반영

기준 checkout은 `C:\westory`, 시작 커밋은 `1a904f96fc4aad2f1d17e31dbd200e32eabd62a8`이다. 작업 시작 시 main과 origin/main이 같고, 운영 www.westory.kr의 Vercel 배포도 같은 커밋이었다. 기존 output/와 tmp/는 커밋 대상에서 제외한다.

## 변경 범위

- 교사 분석의 최초 조회는 선택한 현재 학기·학급·평가 범위로 유지한다. 이후에는 학급의 작은 sequence 신호와 문항 변경 신호를 구독하고, 커서 이후 변경 결과만 callable로 읽는다. 동일 원본의 중복/역순 이벤트는 멱등 처리하며, 변경이 없는 요청은 결과/변경로그 쿼리를 하지 않는다. 수신한 결과는 source:id로 교체·삭제하고 전체 조회를 재실행하지 않는다. 요약은 변경 학생이 속한 학급만 다시 계산하고 비교 학년의 가중 평균을 유지한다.
- 최초 조회 전에 커서를 확보하여 조회 도중 제출되거나 늦게 도착한 트리거를 이어 받는다. 제출로 result generation이 바뀌어도 최초 전체 조회를 반복하지 않는다. 명단/학기/권한 변경은 명시적으로 재조회하도록 중단한다. 숨긴 탭과 닫은 분석은 구독을 해제한다.
- 응시 조회·공개 설정 조회의 끝나지 않는 Promise를 다음 진입에서도 재사용하던 경로에 기한을 둔다. 느린 START는 같은 commandId의 성공 영수증과 정확한 attemptId를 확인한 뒤만 복원한다. 원래 서버 시간·답안·응시 횟수와 미확정 명령의 동일 영수증 재시도를 유지한다.
- 정답 별칭·성취 수준·난이도 변경은 동일 발문·선지·자료·배점의 기존 canonical 제출에 별도 교정 투영을 적용한다. 원본 시험지, 학생 답안, 원점수, 보상/원장과 응시 횟수는 덮어쓰지 않는다. 원문이나 버전 근거가 없는 legacy 기록을 추측하여 재채점하지 않는다.
- 학생 결과와 열린 기록 상세는 본인 결과의 작은 교정 신호만 구독해 해당 결과 한 건을 갱신한다. 이전 회차의 점수/성취 메타데이터도 교정값을 사용한다. 교정 중인 오답 노트의 작성 내용·문항 위치·학습지 상태를 유지한다.
- 문제 저장 후 학기 전체 legacy 결과와 보너스를 재계산하던 오래된 클라이언트 호출을 제거한다. 기존 canonical 게이트웨이에서도 이 기능은 retired로 차단되어 있다. 현재 문제 저장은 원본 보존 교정 트리거를 사용한다.

새 AI 호출·외부 전송·학생 공개 확대·보상 변경은 없다. 기존 서비스의 평가 유지보수 범위이며 로그인과 학기 권한을 우회하지 않는다. 신호는 기존 평가 조회 권한으로만 get을 허용하고 list/write는 차단한다.

## 검증

- `npm run build`, Functions check, TypeScript/포맷, 변경 diff 검토.
- 실제 Firestore 에뮬레이터: 제출·교정·삭제, 최초 조회 중 제출, 지연/중복/역순 트리거, 커서 페이지, 교정의 현재/이전 회차 성취 분석 투영, 변경이 없는 조회의 결과 쿼리 0회.
- `verify-quiz-live-client.mjs`: 전체 서버 계산과 증분 클라이언트 수치 일치, 비교 학년 가중 평균, 원본 이미지, 구독 정리, 세션 교체와 권한 오류.
- 실제 ManageQuiz 분석 브라우저: 최초 전체 조회 1회 후 변경분 2회로 제출 인원 0→1, 평균 50→100 반영. 학급 변경 시 구독 해제. 기존 조회·비교·검색·상세/이미지 및 320–1440px 검증.
- 응시 어댑터 및 실제 QuizRunner 브라우저: 무응답 START·늦은 이전 응답·화면 내 복구, 같은 영수증/응시만 사용, 중복 START 없음, 기존 답안/시험 시간 보존.
- 결과 교정·오답 노트 브라우저와 학생 기록/점수 비교 회귀. 실제 학생 답안이나 운영 점수를 시험 목적으로 변경하지 않는다.
- 신호 경로 전용 rules 에뮬레이터 141 assertions와 `npm run test:score-request-rules` 통과. 교사/허용 직원·학생 본인/타인·익명·세션 철회·점검·학기 전환·미존재 신호·고아 신호·목록/쓰기 차단을 포함한다.

운영 로그의 최근 1,000건 표본(뒤 페이지 있음)에서 executeCommand 최대 30.58초, getAssessmentState 최대 8.41초를 확인했다. executeCommand는 여러 명령을 포함하므로 이를 START만의 실측치로 해석하지 않는다. 합성 지연 검증을 배포 후 실제 학생 체감 속도 측정으로 보고하지 않는다.

## 운영 반영

운영 Functions 원본을 다운로드하여 관련 핸들러·세션·런타임 파일을 대조했다. 일부 함수 배포 아카이브에는 이전 날짜의 미사용 모듈이 들어 있으며, 필요한 평가 핸들러를 선택 배포한다. 새 signal rules와 API/트리거를 먼저 배포한 뒤 검증 커밋의 Vercel main 배포를 운영 도메인으로 승격한다.

대상: executeCommand, getAssessmentState, getQuizClassAnalysis, getMyQuizHistory, saveMyQuizReviewNote, invalidateQuizClassCanonicalResult, invalidateQuizClassLegacyResult, invalidateQuizClassQuestion, reconcileQuizQuestionCorrection, reconcileQuizResultCorrection 및 Firestore rules. 런타임 리전·최소 인스턴스·비용 설정과 무관한 Functions는 변경하지 않는다.

최종 배포 ID·검증 결과는 배포 완료 후 기록한다.
