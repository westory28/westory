# 학급별 평가 분석과 학생 응시 기록 개선

## 범위와 기준

- 기준 checkout: `main`, `854597bba3bbfef08fa1453f06bbb4476e86906d`. 작업 전 `origin/main` 및 Vercel 운영 배포 `dpl_7WaEuRKXes1p7PZJH2DuxqMUmkDS`의 Git SHA와 일치했다.
- 교사는 평가와 학급을 명시적으로 선택한 뒤 최대 4학급의 집계만 조회한다. 학생 명단·답안은 한 학급 상세를 열 때만 반환한다.
- 학생 마이페이지 기본 진입에서는 평가 원본을 읽지 않는다. 응시 기록 탭은 최근 20개 요약, 선택한 응시만 저장된 원문·답안·해설을 조회한다.
- 저장된 문항으로 해설 확인 → 선택적 성찰 → 해설 없이 다시 풀기를 제공한다. 연습은 화면 메모리에서만 처리하며 공식 점수·응시 횟수·보상·교사 통계를 수정하지 않는다.

## 조회와 권한 계약

`getQuizClassAnalysis`는 기존 일반 application session과 교사/quiz_read 권한, 현재 학기의 config·pointer·manifest를 매 호출 검사한다. `catalog`에는 학생 정보가 없고, `summary`는 선택 학급 학생 UID만 조회한다. `detail`은 한 학급으로 제한한다. 결과는 canonical/legacy의 명시적 참조로만 중복 제거한다. 최신 점수와 현재 버전의 문항별 마지막 응답을 구분하며 미보관 점수·답안은 0이나 오답으로 채우지 않는다.

학급 요약은 서버 전용 캐시를 최대 6시간 재사용한다. 결과·문항·명단·학급·평가 정의·목차·프로필 변경 시 revision을 바꾸어 다음 조회에서 재집계한다. 최초 집계도 선택 학급으로 제한하며 페이지 경계와 최대 건수/응답 크기를 넘으면 일부 자료를 정상 통계로 표시하지 않고 명시적으로 실패한다. 새 composite index는 요구하지 않는다. 갱신은 명시적 버튼이며 폴링·전체 학기 실시간 구독은 없다.

`getMyQuizHistory`는 호출자의 인증 UID만 사용하고 임의 UID 입력을 거부한다. 매 요청 세션·사용자·학기를 확인하고 상세 조회 시 결과와 immutable submission의 소유자·학기를 재확인한다. 목록 서버 캐시는 10분 TTL 및 학생별 결과 revision으로 갱신한다. 최초 요청은 본인의 메타데이터만 읽으며 문항 원문·이미지·답안은 목록 전송에서 제외한다. 20개 커서 페이지는 목록 버전에 묶이고 변경 시 새로고침을 요청한다. 브라우저에는 영구 기록 캐시를 만들지 않는다.

새 캐시 컬렉션은 기존 Firestore rules의 기본 거부 범위에 남는다. 클라이언트에 직접 읽기·쓰기 권한을 추가하지 않았다. 기존 로그인, 평가 시작·저장·제출, 공개 설정, rules는 변경하지 않았다. 기존 운영 `getAssessmentState` 소스의 `sessionAuthority.js`와 `scoreWorkflowGuard.js`가 로컬과 같음을 배포 전에 대조했다.

## 확인한 검증

- `npm --prefix functions run check`: 기존 인증·평가 lifecycle·보상 계약과 새 학급 분석 11개/학생 이력 5개 검사 통과.
- Firestore demo emulator의 `functions/scripts/verify-quiz-analysis-integration.cjs`: 실제 exported callable과 실제 세션 검증으로 20분 경과 로그인, 2학급 분리·비교, 캐시, 결과 변경 무효화, 본인 이력/상세, 타인·취소 세션 거부 통과. 운영 학생 자료나 점수를 쓰지 않았다.
- `npm run verify:assessment-attempt-safety`, `npm run verify:assessment-release`, `npm run verify:quiz-analysis` (40개), `scripts/verify-quiz-class-analysis-client.mjs` 통과.
- `scripts/verify-quiz-class-browser.mjs`: 초기 catalog-only, 필터 변경 시 요청 없음, 명시적 비교, 한 학급 상세, 실패·재시도, 늦게 도착한 이전 요청 폐기 검증. 390/768/1280/1366px에서 페이지 가로 넘침 없음 및 캡처 시각 점검.
- 기본 `npm run build`는 인증 복구·학기 보관·학습지와 수행평가 XLSX `hair` 테두리 회귀 검사도 포함한다.
- `npm run build`, `npm run format:check`, 최종 `npm run typecheck` 통과.
- 학생 결과 33개, 재학습 21개, 과거 기록 검증 통과. `scripts/verify-student-mypage-layout.mjs`의 17개 브라우저 시나리오에서 초기 평가 읽기 0회, 목록 20개 → 23개 추가 조회, 선택한 상세 1회, 0점 보존, 성찰·복습, 빈 기록·조회/상세/커서 오류 재시도, 직접/legacy 링크, 키보드 복귀를 확인했다. 320/390/768/1280/1366px에서 페이지 가로 넘침 없이 표시됐다.

화면은 기존 portalPage, InfoHelp, 색상·간격 토큰을 사용한다. 학급 비교 표만 모바일 가로 스크롤을 허용하며 본문 그래프는 한 열로 전환한다. 과거 원문을 보관하지 않은 응시는 그 사실을 표시하고 현재 문제로 대체하지 않는다.

## 배포 순서

Firebase 신규 조회 함수 2개와 비동기 무효화 trigger 8개를 먼저 배포한다. 이 trigger는 제출 transaction 뒤에서 실행되므로 집계 실패가 기존 제출을 실패시키지 않는다. 기존 응시·로그인 함수 전체 재배포는 금지한다.

```powershell
. .\scripts\use-westory-node.ps1
$env:FUNCTIONS_DISCOVERY_TIMEOUT='60'
firebase deploy --only "functions:getQuizClassAnalysis,functions:getMyQuizHistory,functions:invalidateQuizClassCanonicalResult,functions:invalidateQuizClassLegacyResult,functions:invalidateQuizClassQuestion,functions:invalidateQuizClassEnrollment,functions:invalidateQuizClassDefinition,functions:invalidateQuizClassMetadata,functions:invalidateQuizClassCurriculum,functions:invalidateQuizClassProfile" --project history-quiz-yongsin
firebase functions:list --project history-quiz-yongsin
```

이후 검증한 프런트엔드 커밋을 main에 반영하고 Vercel 해당 배포를 운영으로 승격한다. 운영 도메인에서 새 학급 분석 및 기존 문항 목록을 확인하고, 학생 경로는 학생 권한을 유지한 검증 환경과 실제 사용 가능한 운영 화면 범위에서 확인한다. 운영 학생 계정을 임의로 만들거나 실제 응시·점수를 생성하지 않는다.

Firebase 신규 10개 함수의 생성 성공 및 `functions:list`의 `ACTIVE / asia-northeast3 / nodejs22` 상태를 확인했다. 처음 배포는 신규 재시도 정책 확인 단계에서 멈췄으며, 대상이 이 신규 10개뿐임을 확인하고 `--force`로 재실행했다. 기존 `executeCommand`, `getCommandStatus`, `getAssessmentState`, `saveAssessmentProgress`의 배포 메타데이터가 전후 동일함을 확인했다.
