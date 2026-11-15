# 기존 미완료 변경과 운영 반영 검토

확인일: 2026-11-15. 원본 작업 폴더 `C:\westory`의 HEAD는 `cdd7db4ea675f1c8a46b3e27e26201bccea7bd89`, 비교한 최신 main은 `555546b00784c20792e919c103f96fdc00bbe289`다. 원본은 main보다 38개 커밋 뒤에 있었으며 기존 변경을 되돌리거나 통째로 덮어쓰지 않았다.

## 변경 대조

미커밋 소스·문서·자산 228개를 원본 HEAD, 현재 파일, 최신 main의 세 버전으로 비교했다. 텍스트는 CRLF/LF 차이를 구분했고 바이너리는 blob 해시로 비교했다.

| 분류 | 파일 수 | 처리 |
| --- | ---: | --- |
| 현재 main과 동일 | 177 | 이미 반영된 변경으로 확인 |
| main 이력의 과거 blob과 동일 | 44 | 후속 개선을 포함한 최신 main 유지 |
| 3-way 병합 결과 main과 동일 | 2 | 기존 변경이 완전히 포함됨을 확인 |
| 여러 변경의 조합으로 남은 사본 | 4 | 수동 검토 후 최신 main의 후속 개선 유지 |
| 줄바꿈 포맷만 다름 | 1 | 동작 변경이 없어 별도 이식 제외 |

기능상 미반영 변경은 없다. 유일한 포맷 차이는 `scripts/verify-lesson-alternative-answers-browser.mjs`의 `waitStatus` 체인 줄바꿈이다. `output/`, `tsconfig*.tsbuildinfo`, 생성된 `vite.config.js`·`vite.config.d.ts`는 배포 소스에서 제외했다.

수동 검토한 네 파일의 판단 근거는 다음과 같다.

- `DESIGN.md`: 아바타·정기시험 화면 계약은 이미 반영됐다. 아바타 관리의 후속 상점/옷장 분리, 수정 팝업, 전체 학생 미리보기 계약을 유지한다.
- `functions/productionGateway/scripts/verify-wis-wallet-commands.cjs`: 기존 수동 지급 알림 검사는 main에 모두 있다. main의 손상 원장 재구축 차단 검사와 transaction query 모사를 보존한다.
- `functions/productionGateway/source-manifest.json`: 알림 모듈과 변경 기록은 포함돼 있다. 후속 원장 검증이 반영된 현재 소스 해시를 유지한다.
- `scripts/verify-student-score-objection-browser.mjs`: 기존 논술 피드백·서명 시나리오는 포함돼 있다. main의 피드백 파서 의존성, 인터페이스 설정 fixture, CSS import 제거 보정과 서명 전후 각각 1회 서버 조회 검사를 보존한다.

원본을 최신 main에 덮어쓰면 확장된 아바타 항목, 위스 원장 검증, 정기시험 파서와 브라우저 검증이 회귀하므로 그렇게 병합하지 않는다.

## 실행 검증

최신 main 기반의 격리 작업 폴더에서 다음 합성 검사를 다시 실행해 통과했다.

- 아바타 메타데이터: 클라이언트/서버 기본값 120개, 성별 분류·가격·소유권 경계.
- 교사 점수 확인 조회: 대상 UID 범위, 중복/동시 조회, 실패·재시도와 무효화 경합.
- 학생 점수 피드백: 4개 소문항, 0점/미입력, 합계, 중복 표시 억제와 원본 보존.
- 논술 점수 엑셀: 1/3/1/5 만점, 문항 피드백, 업로드 대상과 이전 형식 호환.
- 위스 명령: 15개 검사, 동일 영수증 재시도, 계좌 경합, 권한·학기, 손상 원장 차단, 알림 원자성·실패 롤백.

실행 명령은 각각 `node scripts/verify-avatar-catalog-metadata.mjs`, `node scripts/verify-score-confirmation-reads.mjs`, `node scripts/verify-student-score-feedback.mjs`, `node scripts/verify-written-exam-essay-score-workbook.mjs`, `node functions/productionGateway/scripts/verify-wis-wallet-commands.cjs`다.

## 실제 운영 반영 확인

2026-11-15 18:08 KST에 Vercel API의 `www.westory.kr` alias와 해당 배포 메타데이터를 읽었다. 연결된 배포는 `dpl_8UJoYpTN8CTRr3NhQJowDU4d5b4q`, 상태는 `READY`, 대상은 `production`, 소스는 main `555546b00784c20792e919c103f96fdc00bbe289`였다. GitHub Vercel 성공 상태도 같은 배포를 가리킨다. 실제 HTTPS 도메인의 응답은 200이고 진입 자원은 `/assets/main-BMV5lYDF.js`였다. 따라서 이번에 대조한 기존 프론트엔드 변경은 이미 운영 도메인에 연결돼 있다. 로그인 후 화면 조작 검사를 대신하는 결과로 해석하지 않는다.

Firebase에서는 메타데이터와 배포 archive의 해당 모듈을 읽기 전용으로 대조했다.

- 아바타 가격 관리 2개, 조회·구매·저장 6개, 위스 공개 아바타 projection 4개: 총 12개 함수가 `ACTIVE`였다. 각 변경 대상 카탈로그·가격·아바타 모듈은 현재 main과 내용이 같았다. 카탈로그는 120개이며 JSON의 CRLF/LF만 달랐다.
- 서울 `executeCommand`: `executecommand-00049-xoc`. 수동 지급 알림 helper와 `wisEconomy.js`가 현재 main과 바이트 단위로 같았다.
- 미국 `executeWisCommandFast`: `executewiscommandfast-00003-pab`. 알림 helper가 바이트 단위로 같고 수동 지급 연결도 반영돼 있었다. 전체 economy 모듈에는 평가 보상 읽기 병렬화·원장 재구축 검증의 기존 배포 분리 차이가 남는다. 실제 배포본의 fast allowlist는 지급·차감·조정·역분개·주문·취소·검토 7개로, 평가 및 재구축은 허용하지 않는다. 이 차이를 이번 미완료 작업의 배포 누락으로 처리하거나 fast 원본 전체를 덮어쓰지 않는다.

이번 검토 중 운영 설정·학생 점수·서명·지갑·공개 상태를 쓰지 않았으며 배포·승격도 실행하지 않았다. 기존 미완료 작업을 이유로 재배포할 앱/Functions 변경은 없다. 같은 작업에서 새로 제작하는 리듬 게임은 별도 검증·배포 대상이다.

## 근거 보관

파일별 분류, 과거 blob 일치 커밋, 3-way 결과와 운영 메타데이터·소스 해시 요약은 `C:\westory\output\pending-review-20261115\inventory.json`, `review-summary.txt`, `production-vercel.json`, `production-functions.json`에 보관했다. 자격 증명과 학생 자료는 기록하지 않았다. 이 로컬 QA 폴더는 커밋하지 않는다.
