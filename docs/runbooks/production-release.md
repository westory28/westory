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

## 현재 백엔드 배포 제한

2026-10-07 동기화한 `7b1107a8`의 `functions/`에는 운영 로그인 함수 `openApplicationSession` 구현이 없다. [10월 3일 로그인 패치 기록](../reviews/login-acquisition-20261003.md)에도 같은 소스 불일치가 기록돼 있다. PC 환경을 맞추기 위한 Functions/rules 일괄 배포는 하지 않는다. 백엔드 패치를 시작할 때는 먼저 해당 운영 함수의 소스를 복원·대조하고, 변경 대상만 검증·배포한다. 인증 조회 성공이나 `functions run check` 통과는 운영 소스 일치를 보장하지 않는다.
