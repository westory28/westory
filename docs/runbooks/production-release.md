# 운영 배포 절차

## 교사 아바타와 관리자 가격표 (2026-10-28)

아바타 가격은 `avatar_catalog_settings/current`의 버전 있는 관리자 설정을 따르며, 학생 구매·저장 시 서버에서 현재 가격을 검증한다. 학생 꾸미기의 초기 조회는 아바타·지갑·가격표를 합친 `getAvatarStudioState`를 사용하고 교사 `getTeacherMyPage`는 지갑·가격표를 조회하지 않는다. 가격표 변경을 전파하려고 폴링·아이템별 쿼리를 추가하지 않는다. [검토 기록](../reviews/teacher-avatar-pricing-20261028.md)에 권한·비용·검증·선택 배포 대상을 기록했다.

카탈로그에 항목을 추가할 때는 저장 함수뿐 아니라 공개 아바타를 검증하는 `getWisRankingPreview`, `getWisEconomyState`, `getWisEconomyStateFast`도 함께 배포한다. 신규 교사 삭제 함수의 실패 재시도 배포에 `--force`가 요구되면 기존 함수 삭제 대상이 없는지와 `getWisEconomyState` 두 리전을 먼저 확인한다. 각 삭제 작업은 동일 이벤트 재시도에 안전해야 한다.

## 위스 지갑과 전체 거래 내역 (2026-10-27)

위스 지급·차감·조정·역분개·구매·취소·주문 검토는 `executeWisCommandFast`, 상태 확인은 `getWisCommandStatusFast`, 일반 지갑 조회는 `getWisEconomyStateFast`를 us-central1에서 호출한다. 기존 서울 함수와 같은 영수증·권한을 사용하며 클라이언트가 실패 시 새 요청 ID나 다른 리전으로 자동 재지급하지 않는다. 지급 함수만 256MiB 최소 인스턴스 1개(유휴 비용 발생), 최대 20개, concurrency 80이다.

`semester_wis_ledger`의 accountId ASC / createdAt DESC / __name__ DESC COLLECTION 인덱스가 READY인지 먼저 확인한다. 학생·교사 전체 내역은 원장을 페이지 조회하며 최근 100건 캐시를 전체 원장으로 취급하지 않는다. 거래 조회는 읽기 전용 transaction이다. 지급은 실제 학기·경제 상태·계좌·주문·재고 revision을 확인하고, 다른 학생이 바꾼 학교 aggregate revision만으로 거부하지 않는다.

검증은 `npm --prefix functions run check`, `npm --prefix functions run test:wis-wallet`, 기존 윷 보상 통합, `node scripts/verify-wis-economy-adapter.mjs`, `node scripts/verify-wis-wallet-browser.mjs`, `npm run build`를 사용한다. 운영 원장 대조는 `npm --prefix functions run audit:wis-wallet`이며 학생 이름·UID 출력과 데이터 쓰기는 없다. 불일치가 발견되면 잔액을 추측해 수정하지 말고 원장 근거부터 확인한다.

배포 대상은 `executeCommand,getWisEconomyState,executeWisCommandFast,getWisCommandStatusFast,getWisEconomyStateFast` 5개다. 운영 원본 대조·검증 → 해당 Functions 배포 → 프론트엔드 배포·승격 → 방재석 Chrome 프로필에서 운영 조회 확인 순서로 진행한다. 상세 범위와 연동 계약은 [위스 지갑 검증 기록](../reviews/wis-wallet-20261027.md)을 따른다.

`getWisEconomyState`는 기존 서울과 미국 두 리전을 모두 export해야 한다. Firebase CLI는 `--only`에서도 같은 함수 이름의 리전을 대조하므로 서울만 선언하면 기존 미국 함수를 삭제 대상으로 판단한다. 최소 인스턴스 비용 승인에 `--force`가 필요할 때에도 먼저 이 리전 목록을 확인한다. 이 계약은 아래 과거의 ‘서울만 배포’ 안내보다 우선한다.

## 윷놀이 온라인 명령 (2026-10-27)

새 클라이언트는 `commandYutRoomFast`를 `us-central1`에서 호출한다. Firestore `nam5`와 가까운 곳에서 동일한 세션·학기·학적·공개 설정·방 권한·요청 영수증 검사를 수행한다. 최초 기동 지연을 줄이기 위해 이 함수만 256MiB 최소 인스턴스 1개(유휴 비용 발생), 최대 20개, 동시 요청 80개를 사용한다. 기존 서울 `commandYutRoom`은 열린 구 클라이언트의 호환 경로로 유지한다. 로그인 함수나 다른 게임의 리전은 변경하지 않는다.

대기방은 마지막 방장 활동(`hostActivityAtMs`, 구 문서는 `createdAtMs`)으로부터 10분 동안 활동이 없으면 만료된다. 방장의 서버 승인 명령과 감정표현은 방·참가 코드의 만료를 함께 갱신한다. 다른 참가자 활동, 단순 조회, 같은 요청 영수증의 재실행은 시간을 연장하지 않는다. 강퇴는 대기 중인 방장이 준비하지 않은 다른 참가자에게만 실행할 수 있으며 실제 쓰기와 실시간 읽기 권한을 함께 제거한다.

배포 순서는 `yut_rooms` COLLECTION_GROUP의 `status ASC, expiresAtMs ASC` 인덱스 추가 및 READY 확인 → Firestore rules → 서울 `getYutLobby`, `getYutManagement`, `commandYutRoom`, `cleanupWaitingYutRooms`와 미국 `commandYutRoomFast` → 프론트엔드다. 기존 인덱스와 서울 callable을 삭제하지 않는다. 대기방 정리 예약 함수는 새 인덱스와 방장 활동을 사용한다. 변경 파일의 함수별 운영 원본을 비교하고 위 함수들만 배포한다.

검증은 `npm run build`, `npm --prefix functions run check`, 윷 core/management·만료·통합·다중 브라우저 Firestore 에뮬레이터 검사, `scripts/verify-yut-online-feedback-browser.mjs`, `scripts/verify-yut-interface-browser.mjs`를 사용한다. 실제 운영에서 두 사용자의 대전을 확인하기 전에는 합성 지연 검사를 실사용 응답 시간 측정으로 보고하지 않는다.

회사와 집 컴퓨터는 같은 Git 원격과 운영 도메인을 사용한다. 로컬 폴더 또는 Vercel 빌드 완료만으로 운영 반영을 판단하지 않는다.

1. 저장소 루트, 브랜치, HEAD, 미커밋 변경을 확인한다. `git fetch origin` 후 최신 `origin/main`과 비교한다. 진행 중 작업이 있으면 별도 작업 공간을 사용하고 기존 파일을 덮어쓰지 않는다.
2. 과거 개발 분기의 패치를 복원할 때는 현재 운영 코드에 필요한 변경만 이식한다. 최신 저장·권한·학기 보호를 과거 파일 전체 교체로 없애지 않는다.
3. 기본 빌드와 변경 기능 검증을 수행한다. 배포 직전에 다시 원격 main을 비교하고 새 커밋이 있으면 병합·재검증한다. 강제 push를 사용하지 않는다.
4. main 반영 후 Vercel 배포의 Source commit이 해당 HEAD인지 확인하고 Ready까지 기다린다.
5. 현재 프로젝트는 Production 빌드도 Staged로 완료될 수 있다. `Assigning Custom Domains: Skipped`이면 운영 반영 완료가 아니다. 해당 배포의 Promote에서 `www.westory.kr` 운영 도메인 연결을 완료한다. 승격 직전에도 더 최신 main 배포가 없는지 확인한다.
6. `https://www.westory.kr`을 새로 열어 변경 화면을 확인한다. 로그인 전 화면만 보고 관리자 기능 반영을 완료했다고 판단하지 않는다. 운영 데이터를 임의로 생성·삭제하지 않는다.
7. 최종 보고에는 반영 커밋, 기능 검증 결과, 실제 운영 확인 결과와 남은 제약을 구분해 적는다.

이 문서는 현재 확인된 Vercel 운영 절차다. GitHub Pages 워크플로 성공만으로 `www.westory.kr` 반영을 대신 확인하지 않는다. Functions 또는 Rules 변경이 있으면 루트 AGENTS.md의 별도 Firebase 배포 절차도 따른다.

## 사전 자료의 학기 유지 (2026-10-18)

기본 역사·지명 사전은 Firestore `history_dictionary_catalog`에 안정된 항목 ID로 저장한다. 앱은 `getHistoryDictionaryContinuity`에서 이 자료를 읽는다. 출처, 이용 조건, 별칭과 분류를 함께 보존하며, 학기 전환 때 초기화하거나 다시 생성하지 않는다.

교사 등록 단어와 학생 단어장은 기존 `years/{year}/semesters/{semester}` 원본 경로를 유지한다. 현재 학기와 종료·보관된 이전 학기를 함께 조회하며, 같은 단어는 현재 학기, 최신 이전 학기 순으로 표시한다. 이전 기록은 읽기 전용이다. 학생은 본인 단어장만 조회하고, 교사가 제공한 이전 풀이를 현재 학기에 명시적으로 저장할 때에는 원본 풀이와 현재 단어의 버전을 각각 검사한다. 자동 복사나 보상 지급은 하지 않는다. 개인정보 삭제 절차는 기존 보관 자료에도 계속 적용된다.

기본 사전 갱신은 `node scripts/sync-history-dictionary-catalog.mjs --project history-quiz-yongsin`으로 변경 계획을 먼저 확인한다. 적용할 때에는 출력된 `sourceHash`, `planHash`를 각각 `--expect-source-sha`, `--expect-plan-sha`에 넣고 `--apply`를 추가한다. 이 도구는 관리 대상 항목만 버전 조건으로 생성·수정하며, 삭제하지 않는다. 적용 후 전체 항목과 출처를 다시 읽어 확인한다. 2026-10-18 최초 저장분은 2,373개(역사 133개·지명 2,240개), 출처 2,994건이다.

같은 날 제공된 역사2 전체본·1학기 자료·역사 부도를 대조해 994개를 추가하고 96개 풀이를 보완했다. 확장본은 3,367개(역사 1,125개·지명 2,242개), 출처 4,863건이다. 교과서 인쇄 쪽수와 PDF 쪽수를 함께 남기며 교과서를 공개 라이선스로 표시하지 않는다. 기존 2,373개 ID·지도 연결·출처는 유지한다. [교과서 대조 기록](../reviews/history-dictionary-textbooks-20261018.json)에 자료 해시, 검토 범위, 보충 출처와 검증을 남겼다. 이 자료 확장은 기존 조회 함수를 사용하므로 Functions나 rules 재배포가 필요하지 않다.

조회·저장 검증은 `npm run verify:history-dictionary`와 `npm --prefix functions run check`에 포함된다. 최초 학기 유지 패치의 Firebase 배포 대상은 서울 `getHistoryDictionaryContinuity`, `executeCommand` 두 함수다. 규칙이나 기존 사전 mutation callable을 일괄 배포하지 않는다.

## Windows 작업 환경 확인

회사 PC에서도 매 작업 시작 시 `git fetch origin --prune` 후 HEAD와 `origin/main`을 비교한다. 미커밋 변경이 없고 뒤처지기만 한 경우 `git merge --ff-only origin/main`으로 동기화한다. 다른 PC의 작업을 강제 push로 덮어쓰지 않는다.

프론트엔드는 Vercel 프로젝트의 Node 24.x와 회사 PC의 기본 Node 24.14.0을 사용한다. Functions 작업 전 PowerShell에서 `. .\scripts\use-westory-node.ps1`을 실행하면 현재 터미널을 `functions/package.json`의 Node 주 버전으로 맞추고 `FUNCTIONS_DISCOVERY_TIMEOUT=60`을 설정한다. Node가 다른 버전이면 `%LOCALAPPDATA%\Westory\tools\node-v22.*-win-x64`의 설치본을 찾는다. 다른 위치는 `-NodeDirectory`로 지정한다. 시스템 Node나 Windows 컴퓨터 이름은 바꾸지 않는다. 새 PC에서는 [공식 Node 배포](https://nodejs.org/dist/latest-v22.x/)의 Windows x64 ZIP과 `SHASUMS256.txt`로 검증한 런타임을 먼저 준비한다.

```powershell
. .\scripts\use-westory-node.ps1
gh auth status
git push --dry-run origin HEAD:main
vercel whoami
vercel inspect www.westory.kr --scope bbbs-projects-44f9da30
firebase login:list
firebase functions:list --project history-quiz-yongsin
```

Vercel 로컬 연결이 없으면 `vercel link --yes --project westory --scope bbbs-projects-44f9da30`을 사용한다. `.vercel/`과 생성된 `.env.local`은 Git에서 제외한다. `.codex-remote-attachments/` 같은 컴퓨터별 첨부물은 `.git/info/exclude`에 등록하고 패치에 섞지 않는다. 커밋은 변경 파일을 명시해 스테이징한다.

2026-10-07 회사 PC 확인: GitHub `westory28`, Vercel `westoria28-8028` / 팀 `bbbs-projects-44f9da30`, Firebase `history-quiz-yongsin` 접근을 확인했다. 동기화 기준 앱 커밋은 `7b1107a83d18ea7ba0fe1e5d21457f9ca1177648`이며 당시 운영 도메인도 같은 커밋이었다. 로컬 Node 22.23.3, Firebase CLI 15.9.1, Vercel CLI 62.5.0을 준비했다. Vercel CLI 62.5.0은 한글 hostname을 HTTP User-Agent에 그대로 넣어 로그인 시 ByteString 오류가 발생했으므로, 로컬 설치본의 해당 hostname만 `encodeURIComponent`로 인코딩했다. CLI 재설치·업데이트 후에는 `vercel whoami`로 다시 확인한다.

커밋·push 후 Git 연동 배포의 Source commit과 Ready를 확인한다. Staged이면 `vercel promote <검증한 deployment ID 또는 URL> --yes --scope bbbs-projects-44f9da30`으로 승격한다. `vercel inspect www.westory.kr`와 실제 HTTPS 화면 확인까지 완료해야 운영 반영으로 보고한다. [공식 승격 명령](https://vercel.com/docs/cli/promote)을 참고하며, 자동 도메인 할당 설정은 바꾸지 않는다.

## 학습지 원본 PDF 브라우저 읽기

OCR 선택은 기존 Firebase Storage의 원본 PDF를 브라우저에서 읽어 글자 위치를 계산한다. AI나 외부 OCR API를 사용하지 않는다. `storage.cors.json`은 운영 도메인 두 곳의 `GET`·`HEAD`만 허용한다. Storage 권한 규칙과 다운로드 토큰은 그대로 적용된다.

```powershell
gcloud storage buckets update gs://history-quiz-yongsin.firebasestorage.app --cors-file=storage.cors.json
```

CORS는 `firebase deploy --only storage`로 반영되지 않는 별도 버킷 설정이다. 적용 전 기존 CORS를 조회하고 다른 설정이 있으면 덮어쓰지 말고 병합한다. 적용 후 운영 원본 PDF 응답의 `Access-Control-Allow-Origin`과 실제 OCR 드래그를 확인한다. 원본 다운로드 URL과 토큰을 검증 기록에 남기지 않는다.

## 로그인 함수 소스 동기화

2026-10-07 회사 PC에서 확인한 `7b1107a8`에는 운영 로그인 함수의 소스가 없었다. 이후 `76cb10f`에서 `sessionAuthority.js`, `studentMaintenance.js`, `studentRegistrationAccess.js`가 운영 원본으로 복원됐지만, `index.js`의 배포 export 연결은 빠져 있었다. 로그인 소스 동기화 패치에서 이 연결과 실제 export 검사, 배포 전 검사를 추가했다. [소스 대조 및 검증 기록](../reviews/login-source-sync-20261007.md)을 참고한다.

회사와 집 PC는 아래 절차로 같은 원격 main을 받아 같은 함수를 검증한다. 미커밋 작업이 있거나 브랜치가 갈라졌으면 파일을 덮어쓰거나 reset하지 말고 별도 작업 공간에서 병합한다.

```powershell
git fetch origin --prune
git status --short --branch
git rev-list --left-right --count origin/main...HEAD
# 미커밋 변경이 없고 현재 HEAD가 origin/main의 조상인 경우
git merge --ff-only origin/main
. .\scripts\use-westory-node.ps1
npm ci
npm --prefix functions ci
npm run verify:login-functions
# Java 21 이상 필요. 전용 로컬 demo Firestore에서만 실행한다.
npm run test:login-session
```

`verify:login-functions`는 실제 Firebase 진입점을 읽고 로그인 시작·재인증·연장·종료 함수 4개의 callable export와 리전, 학생 가입 승인 경계를 검사한다. `firebase.json`의 predeploy에도 같은 검사가 연결돼 있으므로 소스가 있어도 배포 목록에서 빠진 상태를 배포 전에 발견한다. 이 검사는 로컬 배포 계약을 확인하며, 운영 소스 전체가 같음을 보장하지는 않는다.

로그인 함수를 수정할 때는 운영 원본과 변경 내용을 대조하고 위 검증 후 아래 4개만 배포한다. 단순히 다른 PC에서 pull했다는 이유로 다시 배포할 필요는 없다.

```powershell
$env:FUNCTIONS_DISCOVERY_TIMEOUT = '60'
firebase deploy --only "functions:openApplicationSession,functions:beginApplicationSessionReauthentication,functions:touchApplicationSession,functions:closeApplicationSession" --project history-quiz-yongsin
firebase functions:list --project history-quiz-yongsin
```

PC에는 코드와 개발 도구가 있고 실제 로그인 처리는 공통 Firebase 프로젝트에서 실행된다. GitHub/Vercel/Firebase CLI 인증 정보는 각 PC에서 별도로 관리하며 Git으로 복사하지 않는다. 운영 함수의 원본이 필요하면 권한 있는 PC에서 `gcloud functions describe <함수명> --gen2 --region asia-northeast3 --project history-quiz-yongsin`의 `buildConfig.source.storageSource`에 나온 bucket/object/generation을 사용해 보관 소스를 대조한다. Windows 줄바꿈 차이는 LF로 정규화해 비교한다.

로그인 함수 4개의 복구가 다른 모든 운영 Functions의 소스 복구를 뜻하지는 않는다. PC 환경을 맞추기 위한 Functions/rules 일괄 배포는 하지 않고, 다른 백엔드 패치는 대상 운영 소스부터 대조한다.

## 역사교실 삭제와 재인증 (2026-10-21)

역사교실 과제 삭제(`deleteHistoryClassroomSource`)도 유효한 일반 교사 세션을 사용한다(2026-10-21). 과제 비공개·삭제 표시만 수행하고 제출 결과를 보존하는 작업이므로 로그인 후 시간이 지났다는 이유로 Google 팝업을 다시 열지 않는다. 프론트 allowlist와 서버 `routineContentWrites.json`을 함께 유지하며 executeCommand와 getCommandStatus에 같은 정책을 배포한다. [삭제·인증 검증 기록](../reviews/history-classroom-delete-auth-20261021.md)을 따른다.

## 학사 일정 저장과 재인증 (2026-10-18)

`manageAcademicCalendar`의 일정 등록·수정(`SAVE_EVENT`), 분류 저장(`SAVE_CATEGORIES`), 공휴일 동기화(`SYNC_HOLIDAYS`)는 유효한 일반 애플리케이션 세션을 사용한다. 영구 삭제(`DELETE_EVENT`)만 고위험 세션과 최근 5분 이내 인증을 요구한다. 관리자 제한, App Check 운영 모드, 세션 상태·epoch·증명·만료, 현재 학기, revision 충돌, 요청 영수증 검사는 유지한다. 일반 저장에 최근 인증 제한을 다시 추가하지 않는다. 기존 gateway의 일정 생성·수정도 일반 세션 정책이다.

이전 클라이언트는 로그인 4분 후 자동 팝업을 열었고 서버는 5분 후 일반 저장도 거부했다. 로그인 시간(`auth_time`)은 시간 연장으로 갱신되지 않으므로 정상 로그인 중에도 반복 인증이 발생했다. 클라이언트는 이제 삭제에만 공통 `ensureSensitiveOperation`을 사용하며, 만료된 일반 세션을 저장 과정에서 자동 재인증·재개하지 않는다. 작업 중 사용자 또는 인증 epoch가 바뀌면 쓰기·응답 수락을 중단한다. 서버 저장 후 응답 수락이 중단된 경우 같은 요청 영수증을 유지해 명시적 재시도의 중복 생성을 막는다.

검증은 `node scripts/verify-academic-calendar-client.mjs`, `node scripts/verify-sensitive-operation.mjs`, `npm --prefix functions run check`, `npm run build`로 수행한다. `scripts/verify-academic-calendar-emulator.cjs`는 로컬 Auth·Firestore·Functions 에뮬레이터에서 실제 adapter·세션 callable·일정 callable·rules를 함께 검증한다. 삭제의 공통 인증 경로에는 Vercel Production의 `VITE_FIREBASE_APPCHECK_SITE_KEY`가 필요하다. 환경 변수 값이나 세션 토큰을 검증 기록에 남기지 않는다.

배포 전 운영 `manageAcademicCalendar` 및 세션 의존 소스를 대조한다. 이 패치의 백엔드 대상은 아래 함수 하나이며 로그인 함수·rules 전체를 다시 배포하지 않는다. 백엔드 배포 후 프론트엔드를 배포·승격하고 실제 운영 일정 저장을 확인한다.

```powershell
. .\scripts\use-westory-node.ps1
firebase deploy --only "functions:manageAcademicCalendar" --project history-quiz-yongsin
firebase functions:list --project history-quiz-yongsin
```

## 역사 사전 조회 비용과 캐시 (2026-10-18)

`history_dictionary_catalog`는 학기와 무관한 영구 원본이다. 기본 사전 조회 함수는 이 컬렉션을 스캔하지 않는다. `history_dictionary_catalog_snapshots/current`의 버전과 같은 컬렉션의 불변 gzip/base64 조각을 읽는다. 현재 3,367개 단어는 조각 1개(압축 399,735바이트)에 들어간다. 사전 데이터 읽기는 서버 최초 조회 2문서, 이후 조회 및 클라이언트 버전 일치 시 1문서다. 세션·사용자·학기 권한 확인용 읽기는 별도이며 그대로 유지한다.

브라우저 IndexedDB에는 기본 사전의 단어·출처와 SHA-256 버전만 저장한다. 방문마다 서버 권한·버전 확인 후 재사용하며 개인 단어장·학생 정보·세션 증명은 저장하지 않는다. 버전 변경 시에만 전체 내용을 받는다. 저장소 차단·손상은 재다운로드로 복구하고, 권한 거부 시에는 캐시를 표시하지 않는다. 검색 함수는 내장 전체 단어 데이터를 가져오지 않는다.

내용을 갱신할 때는 `scripts/sync-history-dictionary-catalog.mjs --project history-quiz-yongsin --apply`를 사용한다. 원본 검증 후 압축 조각을 저장·재검증하고 manifest를 버전 비교로 교체한다. 기존 원본이 이미 일치하고 조회용 묶음만 발행할 때는 `--snapshot-only --apply --expect-source-sha <검증한 sourceHash>`를 사용한다. 이 명령은 원본을 한 번 검증하며 원본을 수정하지 않는다. 직접 원본만 바꿔 manifest 갱신을 빠뜨리지 않는다. 조각·manifest가 없거나 손상되어도 전체 원본 조회로 우회하지 않는다.

배포는 스냅샷 게시 → `npm --prefix functions run check` → `firebase deploy --only "functions:getHistoryDictionaryContinuity" --project history-quiz-yongsin` → 프론트엔드 순서다. 구 클라이언트의 500개 페이지 조회도 압축 묶음에서 처리하므로 먼저 백엔드를 배포해도 호환된다. 기본 사전 화면에서는 학생 요청·교사 등록·학생 등록·알림 기록의 관리용 조회를 시작하지 않고 해당 탭에 들어갈 때 읽는다.

## 학생 개방 및 canonical 명령

2026-10-08 학생 개방 패치는 `functions/productionGateway`에 현재 운영 `executeCommand`
의 의존 소스를 별도로 보존한다. 원본과 변경 해시는 `source-manifest.json`으로 확인하며
다른 PC에서도 `npm --prefix functions run check`를 통과해야 한다. 루트에서 연결한
`executeCommand`, `getCommandStatus`, `executeLessonCorePointCommand`만 이 복구 소스의 명령 배포 대상이다.
디렉터리의 나머지 callable을 일괄 export하거나 모든 Functions를 배포하지 않는다.

2026-10-15 역사교실 안정화에서는 신규 면제권·응시 잠금 명령과 응답 유실 복구를 함께 지원하도록 `executeCommand`, `getCommandStatus` 두 함수를 배포한다. 명령 이름이나 학생 명령 분류를 바꾸면 상태 조회 함수의 동일 allowlist도 확인한다. [검증 기록](../reviews/history-classroom-stabilization-20261015.md)을 참고한다.

2026-10-15 평가 개선에서는 운영 소스를 대조한 `getAssessmentState`, `saveAssessmentProgress` 두 조회·저장 callable도 명시적으로 연결한다. 이 패치의 배포 대상은 서울 `executeCommand`, `getAssessmentState`, `saveAssessmentProgress` 세 함수다. 진단 기록은 기존 답안 저장에 함께 전송하며 채점·보상·응시 권한을 바꾸지 않는다. 다른 callable을 일괄 export하지 않는다. [설계 및 서술형·AI 검토](../reviews/assessment-design-20261015.md)를 참고한다.

학생 개방 전에는 교사 설정의 학생 접속 항목에서 현재 학기 평가 공개 상태를 점검하고,
현재 공개 설정에 해당하는 평가를 준비한다. 가입 승인·세션·학급 권한, 서버 저장/보상,
운영 프론트엔드와 Firebase 반영을 확인한 뒤 접속을 연다. 개방/제한 설정은 관리자
재인증과 서버 revision 비교를 사용한다. [점검 및 배포 기록](../reviews/student-opening-20261008.md)을 참고한다.

이번 패치의 Functions 대상은 아래 16개다. 후속 수정에서는 실제 변경한 함수만 선택한다.
학생 접속 제한을 유지한 채 배포하고, 실패한 대상은 개별 재시도한다.

```powershell
. .\scripts\use-westory-node.ps1
firebase deploy --only "functions:executeCommand,functions:executeLessonCorePointCommand,functions:updateStudentMaintenanceConfig,functions:claimStudentLearningReward,functions:getStudentVisibleLessons,functions:completeWeplayGuide,functions:getWeplayManagement,functions:saveWeplayGameSettings,functions:previewWeplayGame,functions:getWeplayPolicy,functions:saveWeplayPolicy,functions:getWeplayLobby,functions:startWeplayGame,functions:submitWeplayAnswer,functions:finishWeplayGame,functions:settleWeplayOnSchedule" --project history-quiz-yongsin
firebase deploy --only firestore:rules --project history-quiz-yongsin
firebase deploy --only storage --project history-quiz-yongsin
firebase functions:list --project history-quiz-yongsin
```

`applyPointActivityReward`, `createPointPurchaseRequest`, `submitHistoryClassroomResult`는
폐기된 과거 진입점이다. 로컬의 과거 구현을 이 이름으로 다시 배포해 활성화하지 않는다.
접속 설정은 관리자 화면의 명령을 사용하고 Firestore 직접 수정으로 revision·학기·감사
검사를 우회하지 않는다.

## 순위 조회 표시 복구 (2026-10-08)

### 대시보드 Top 5 조회 비용과 지연 (2026-10-20)

대시보드는 미국 `getWisRankingPreview`를 한 번 호출해 순위와 등급 정책을 함께 받는다.
Firestore `nam5`와 가까운 `us-central1`에서 읽기 전용 트랜잭션을 사용한다.
순위 조회 함수만 256MiB 대기 인스턴스 1개, 최대 3개, 동시 요청 80개로 제한한다.
서버 최초 기동 지연을 줄이기 위한 설정으로 대기 인스턴스 비용이 발생한다.
주기적인 호출이나 캐시 갱신 요청으로 서버를 깨우지 않는다.
기존 서울/미국 `getWisEconomyState`와 전체 명예의 전당 조회는 그대로 유지한다.

현재 순위는 서버 전용 `semester_wis_preview_entries`의 학기·학년·점수·공개 ID
복합 인덱스에서 상위 후보 20명만 읽는다. 점수·등록 슬롯·학적·학급 변경 trigger가
현재 원본을 transaction에서 다시 읽어 해당 학생의 조회용 항목만 갱신한다.
계좌·거래·학생 프로필 원본은 수정하지 않는다. 브라우저의 직접 읽기·쓰기는 기존
rules의 기본 거부를 유지한다. 대시보드 조회 시 전교 학적 재집계나 계좌 전수 조회는 없다.
조회와 변경 반영에 타이머·폴링·자동 재시도를 추가하지 않는다.
세션·권한·학기·공개 설정은 매 요청 검사하고,
표시 후보의 현재 계좌·canonical 학적·이름 및 현재 등급 정책의 이모지는 다시 확인한다.
교사의 명시적 보관 조회는 기존의 당시 계좌 학적 기준을 유지하며, 최초 집계 때만
제한된 순위 ID에 대응하는 계좌를 읽어 누락되거나 오래된 순위 학적을 보완한다.
이 보관 조회 입력만 인스턴스 메모리에 30초간 최대 4개 범위까지 공유한다.
브라우저에는 학생 이름이나 순위 캐시를 저장하지 않는다.

검증은 `node scripts/verify-wis-ranking-preview.mjs`,
`npm --prefix functions run check`, 프론트엔드 변경 시 `npm run build`로 수행한다.
복합 인덱스 `semesterId / eligible / grade / rankEarnedTotal DESC / publicId`가
READY인지 먼저 확인한다. 기존 원격 인덱스를 삭제하지 않고 이 인덱스만 추가한다.
갱신 trigger 4개를 먼저 배포하고, 초기 조회용 자료를 검사·생성한 뒤 조회 함수를 배포한다.
기존 서울/미국 `getWisEconomyState`는 수정하거나 삭제하지 않는다.

```powershell
. .\scripts\use-westory-node.ps1
firebase deploy --only "functions:updateWisRankingIndexOnAccountWrite,functions:updateWisRankingIndexOnSlotWrite,functions:updateWisRankingIndexOnEnrollmentWrite,functions:updateWisRankingIndexOnClassWrite" --project history-quiz-yongsin
node functions/scripts/rebuild-wis-ranking-index.cjs --project history-quiz-yongsin
node functions/scripts/rebuild-wis-ranking-index.cjs --project history-quiz-yongsin --apply
firebase deploy --only "functions:getWisRankingPreview" --project history-quiz-yongsin
firebase functions:list --project history-quiz-yongsin
```

복구 도구는 기본 dry-run이며 계좌와 기존 조회용 항목의 합집합을 최대 2,000개까지
재검증한다. 놓친 삭제 이벤트의 고아 항목도 공개 대상에서 제거한다. 원본은 수정하지
않고 동일한 조회용 내용에는 쓰지 않는다. 이벤트 자동 재시도나 예약 재집계는 없다.

프론트엔드는 해당 커밋의 Vercel 배포를 운영 도메인에 승격한다. 운영 대시보드에서
5명과 등급의 표시, 새 callable 성공, 실제 응답 지연을 확인한다. 콜드 스타트와
사용자 네트워크 지연을 포함한 결과를 측정 없이 항상 1초 이내라고 보고하지 않는다.

`getWisEconomyState`의 운영 조회 소스는 `functions/productionGateway/wisEconomyQuery.js`에
별도로 복구했다. 실명·번호와 공개 범위 안의 프로필 이모지를 반환하며 기존 학년·학급,
학기 보관 조회, 로그인 세션 검사를 유지한다. `npm --prefix functions run check`에 조회와
실제 callable export 검사가 포함된다.

이 변경의 Firebase 배포 대상은 서울 `getWisEconomyState` 하나다. 같은 이름의 미국
함수는 그대로 유지한다. CLI 이름 필터는 리전을 구분하지 않으므로 대화형 배포를 사용하고,
미국 함수 삭제 질문에는 **No**를 선택해 서울 업데이트만 계속한다. `--force`를 사용하지 않는다.

```powershell
. .\scripts\use-westory-node.ps1
firebase deploy --only "functions:getWisEconomyState" --project history-quiz-yongsin
firebase functions:list --project history-quiz-yongsin
```

중첩 팝업의 닫힘·경로 이동 후 스크롤 복원은 `npm run verify:page-scroll-lock`으로
검증한다. 화면 검증에는 390·768·1280px의 학생/교사 알림장, 위스 순위와 명예 배지를 포함한다.

## 학생 등급별 프로필 이모지 제한 (2026-10-19)

등급 접근은 `studentProfileEmojiPolicy.js`의 공통 정책과 현재 학기의 canonical
`semester_wis_accounts.rankEarnedTotal`로 판정한다. 이전 `point_wallets`, 잔액,
저장된 상위 이모지, `emojiPolicy.enabled=false`는 해금 권한을 주지 않는다.
현재 등급까지 허용된 이모지만 저장·표시하며 미등록·비활성·ID/그림 불일치는
정책의 기본 이모지로 처리한다. 명예의 전당의 학생·교사·보관 학기 조회도 같은
판정을 사용하고 순위 공개 범위·읽기 전용 계약을 유지한다.

프로필, 현재 계좌, 등급 정책, 활성 학기 변경 trigger 4개는 실행 시점의 최신
포인터·정책·계좌·프로필을 transaction에서 다시 읽어 잘못된 선택만 정리한다.
점수·거래·순위·등록 정보는 수정하지 않는다. 신규 자기 프로필 생성 시에는 이모지
필드를 직접 지정할 수 없으며 승인 후 기존 서버 선택 기능을 사용한다.

기존 데이터 정리는 `node functions/scripts/fix-legacy-student-profile-emojis.cjs
--project=history-quiz-yongsin`으로 먼저 확인하고, 적용할 때 `--apply`와
`--backup=<저장소 밖의 새 JSON 경로>`를 추가한다. 변경 전 기록은 로컬에만 남기며
Git에 포함하지 않는다. 적용 중 선택·학기가 바뀌면 덮어쓰지 않고 재검사한다.
2026-10-19에는 학생 324명 중 등급에 맞지 않는 73명을 기본 이모지로 수정했고,
재검사에서 위반 0명과 정상 선택 보존을 확인했다.

배포 대상은 서울 `getWisEconomyState`, `updateStudentProfileIcon`,
`reconcileStudentProfileEmojiOnUserWrite`, `reconcileStudentProfileEmojiOnAccountWrite`,
`reconcileStudentProfileEmojiOnPolicyWrite`, `reconcileStudentProfileEmojiOnSemesterWrite`와
Firestore rules다. 미국의 기존 순위 함수는 삭제·재배포하지 않는다.
`npm --prefix functions run check`, `npm run build` 및
`firebase emulators:exec --only firestore --config firebase.student-access-test.json
--project demo-westory-session-student-access "node scripts/verify-student-access.mjs"`로
검증하고, 프론트엔드도 해당 커밋을 운영 도메인에 배포·승격한다.
