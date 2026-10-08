# 운영 배포 절차

회사와 집 컴퓨터는 같은 Git 원격과 운영 도메인을 사용한다. 로컬 폴더 또는 Vercel 빌드 완료만으로 운영 반영을 판단하지 않는다.

1. 저장소 루트, 브랜치, HEAD, 미커밋 변경을 확인한다. `git fetch origin` 후 최신 `origin/main`과 비교한다. 진행 중 작업이 있으면 별도 작업 공간을 사용하고 기존 파일을 덮어쓰지 않는다.
2. 과거 개발 분기의 패치를 복원할 때는 현재 운영 코드에 필요한 변경만 이식한다. 최신 저장·권한·학기 보호를 과거 파일 전체 교체로 없애지 않는다.
3. 기본 빌드와 변경 기능 검증을 수행한다. 배포 직전에 다시 원격 main을 비교하고 새 커밋이 있으면 병합·재검증한다. 강제 push를 사용하지 않는다.
4. main 반영 후 Vercel 배포의 Source commit이 해당 HEAD인지 확인하고 Ready까지 기다린다.
5. 현재 프로젝트는 Production 빌드도 Staged로 완료될 수 있다. `Assigning Custom Domains: Skipped`이면 운영 반영 완료가 아니다. 해당 배포의 Promote에서 `www.westory.kr` 운영 도메인 연결을 완료한다. 승격 직전에도 더 최신 main 배포가 없는지 확인한다.
6. `https://www.westory.kr`을 새로 열어 변경 화면을 확인한다. 로그인 전 화면만 보고 관리자 기능 반영을 완료했다고 판단하지 않는다. 운영 데이터를 임의로 생성·삭제하지 않는다.
7. 최종 보고에는 반영 커밋, 기능 검증 결과, 실제 운영 확인 결과와 남은 제약을 구분해 적는다.

이 문서는 현재 확인된 Vercel 운영 절차다. GitHub Pages 워크플로 성공만으로 `www.westory.kr` 반영을 대신 확인하지 않는다. Functions 또는 Rules 변경이 있으면 루트 AGENTS.md의 별도 Firebase 배포 절차도 따른다.

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

## 학생 개방 및 canonical 명령

2026-10-08 학생 개방 패치는 `functions/productionGateway`에 현재 운영 `executeCommand`
의 의존 소스를 별도로 보존한다. 원본과 변경 해시는 `source-manifest.json`으로 확인하며
다른 PC에서도 `npm --prefix functions run check`를 통과해야 한다. 루트에서 연결한
`executeCommand`, `executeLessonCorePointCommand`만 이 복구 소스의 배포 대상이다.
디렉터리의 나머지 callable을 일괄 export하거나 모든 Functions를 배포하지 않는다.

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
