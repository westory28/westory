# 위스피 지원금 계좌 조회 복구

## 기준과 원인

- 회사 PC의 `main`을 `f566cf65`에서 원격 `9b408aab4ebca58cbe7aeb6a93d48eda7ecb5a8f`로 fast-forward했다. 추적 파일의 미커밋 변경은 없었으며 기존 `output/`, `tmp/`는 보존했다.
- Vercel 운영 도메인 `www.westory.kr`의 배포 `dpl_4JXivvLSSJKYi3GSHv6vhLvWuPsm`은 같은 main 커밋의 READY 배포였다.
- 운영 Firestore rules는 수정 전 저장소와 정규화 SHA-256 `ef594eea463e732aeca86d8bde8d88aec6b9ccfd615c787073c5388f19c9202f`로 일치했다. 주식 계좌의 직접 읽기는 `schemaVersion == 1`만 허용했다.
- 운영 `getStudentWisStockState` 소스는 이미 계좌 버전 1·2를 모두 검증했다. callable 조회 후 붙는 본인 계좌 `onSnapshot`이 지원금 제한 계좌의 버전 2를 거부하면서 계좌 상태를 지웠다. `permission-denied`의 사용자 문구와 시장 종목은 보이는 사진의 증상이 일치한다.
- 운영 함수 전체 소스에는 기존 저장소와 차이가 있으므로 이 수정에 Functions 재배포를 포함하지 않는다.

## 변경 경계

주식 계좌 resource의 버전 조건만 `[1, 2]`로 고친다. 일반 위스 지갑의 버전 1, 본인 UID·계좌 ID·현재 학기·활성 세션·재학·학급·점검 조건은 유지한다. 다른 학생·교사·staff의 원본 계좌 읽기, 목록 조회와 클라이언트 쓰기는 계속 거부한다. 시장이 닫혀 있거나 메뉴가 숨겨져 있어도 본인 자산은 기존 계약대로 읽을 수 있다.

실제 조건은 `schemaVersion == 1 || schemaVersion == 2`다. 목록 포함식과 명시 OR 식을 비교하면서 서버 컴파일의 200과 503을 모두 관찰했고, 명시 OR 식도 CLI 재시도에서 503이 재발했으므로 특정 표현이 장애 원인이라고 단정하지 않는다. 최종 OR 식은 공식 API의 전체 규칙 컴파일에 성공했으며 기존과 동일한 26개 경고만 있었다.

기존 본인 조회 복구를 위한 통상 유지보수이며 이용자·개인정보 항목·외부 서비스·공개 범위를 추가하지 않는다. 런타임 AI 호출·에이전트 실행·외부 데이터 전송 변경은 없다. 서버 조회·저장 호출, 구독 수와 폴링은 추가하지 않으며 기존 규칙의 최대 10개 의존 문서 경계를 유지한다. 학생 잔액·주문·서명·점수·이의 처리 상태를 운영 검증 목적으로 변경하지 않는다.

## 검증

- 확장한 실제 Firestore 에뮬레이터 검사에 수정 전 rules를 넣어 버전 1→2 전환 시 기존 구독의 `permission-denied` 실패를 재현했다.
- `npm run test:wispi-access` 8그룹이 통과했다. 버전 1 읽기, 버전 2 전환·신규 구독·실패 후 재구독, 알 수 없는 버전·타인·잘못된 계좌/학기 차단을 확인했다. 나머지 학적·세션·점검·비공개·목록·쓰기 검사도 버전 2 계좌에 적용했다.
- `npm run build`가 기본 회귀 검사와 함께 통과했다. 기존 대형 번들 경고는 남아 있다.
- 최종 OR 식으로 `test:wispi-access` 8그룹을 재검증했다. 기본 `firebase deploy --only firestore:rules --project history-quiz-yongsin`의 predeploy에서도 rhythm-publication 13그룹·score-request-rules·developer-log-likes-rules 158검사가 모두 다시 통과했다.

## 운영 반영

CLI의 서버 컴파일 503이 반복되어, 같은 파일의 해시와 완료된 predeploy 결과를 고정한 뒤 [Firebase 공식 REST 배포 절차](https://firebase.google.com/docs/rules/manage-deploy)를 사용했다. 인증서 검증을 유지한 TLS 1.2 연결로 전체 규칙 컴파일(200) → 규칙 생성(200) → 생성된 전체 소스 대조 → 기존 운영 release 불변 확인 → 해당 규칙으로 release 변경을 수행했다.

release 변경 요청은 503을 반환했지만 재조회한 release는 이미 생성한 `7d7490db-8d28-477f-83fc-2ae4317ed5db`를 가리켰다. 재시도 전 변경 감지가 동작했으며 추가 배포를 실행하지 않았다. 실제 운영 규칙을 다시 내려받아 최종 로컬 파일과 전체 내용이 일치함을 확인했다. 반영 시각은 2026-11-18 09:51:12 KST이며 정규화 SHA-256은 `7d4e6d350e9d2bcfeefae3690502fb4d103d389c0cdd3e91cf724b8ed46070af`다. 운영 앱 문서 조회·쓰기는 0건이다.

운영 원본 규칙과 비교 결과, 빌드·배포 로그는 로컬 `output/wispi-account-access-20261118/` 및 같은 이름의 로그에 보관한다. 실제 학생 자료·자격 증명을 증거 파일에 저장하지 않는다. Windows 컴퓨터 제어가 현재 브라우저 URL을 확인하지 못해 차단되어 도구를 통한 로그인 화면 검증은 중단했으며, 이후 사용자가 실제 화면에서 지갑이 정상 표시됨을 확인했다.
