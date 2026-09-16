# 운영 배포 기준

## 현재 경로

- 사용자 도메인: `https://www.westory.kr/`, Vercel 프로젝트 `westory`.
- Firebase 운영: `history-quiz-yongsin`.
- 개발 기준은 현재 검증된 기능 브랜치의 커밋이다. 오래된 main, GitHub Pages 배포, 로컬 dist를 운영 버전으로 추정하지 않는다.
- Google 로그인·HashRouter·Firebase 바인딩을 검증한다. 운영/검증 환경의 빌드를 혼용하지 않는다.

## 자동 배포가 검증 버전을 덮지 않도록 하는 설정

- Vercel 프로젝트의 `autoAssignCustomDomains`를 `false`로 유지한다. Git 빌드가 성공해도 운영 도메인은 검증 후 명시적으로 승격한다.
- 2026-09-16 점검에서 오래된 main의 자동 배포가 전날 검증 배포를 교체한 것을 확인했다. main의 소스를 최신 운영 버전으로 간주하지 않는다.
- 후보 준비 전과 승격 후 프로젝트 설정 및 `www.westory.kr` alias의 실제 deployment ID를 조회한다. 프로젝트의 최근 생성된 production 대상 배포와 사용자 도메인 연결은 별도로 확인한다.
- 설정 변경 시에는 이 필드만 변경하고, 기존 Git 연동·브랜치·환경변수·루트 디렉터리를 함께 변경하지 않는다. 이미 대기 또는 빌드 중인 배포가 있다면 상태를 따로 확인한다.
- 검증된 기능 브랜치와 main의 통합이 완료되기 전에는 main 자동 빌드를 수동으로 승격하지 않는다. 후속 작업에서 수정한 기능은 검증된 기준 소스에 통합한 뒤 배포한다.

## 배포 절차

1. `git status --short --branch`와 HEAD를 확인한다. 검증한 수정만 커밋·푸시하고 해당 커밋의 CI 결과를 확인한다.
2. 해당 **전체 커밋 ID**에서 `git archive`로 별도 후보 폴더를 만든다. 파일을 Git blob과 대조하고 archive SHA-256을 기록한다. 기존 dist를 후보 소스로 복사하지 않는다.
3. 연결된 Vercel 운영 프로젝트에 `deploy --prod --skip-domain`으로 후보를 만든다. 기존 운영 도메인은 유지한다. 운영 Firebase 환경 설정을 사용하고 `westorySourceCommit` 메타데이터에 전체 커밋 ID를 남긴다.
4. 제공자에서 후보 배포 ID·READY 상태·production 대상·소스 메타데이터를 확인한다. 후보의 index와 main 파일을 읽고 Firebase 활성 바인딩이 운영 프로젝트이며 에뮬레이터가 모두 꺼져 있는지 확인한다.
5. 후보 파일로 아래 영수증을 만든다. 변경된 UI가 새 Functions 계약에 의존하면 같은 커밋의 해당 함수부터 배포하고 ACTIVE 상태를 확인한다. 실제 변경 경로의 브라우저·회귀 검증과 해당 커밋의 CI 성공을 확인한 뒤 해당 배포 ID를 `vercel promote`로 승격한다.
6. `node scripts/verify-production-release.mjs --receipt <candidate.json> --output <verified.json>`으로 운영 파일과 후보 파일을 대조한다. 이 검사는 출력 파일을 덮어쓰지 않는다.
7. 배포 기록에 CI·소스 archive·배포 ID·후보 바인딩 검사·공개 파일 검사·학생 접근 상태를 함께 남긴다.

## 후보 영수증 형식

```json
{
  "schemaVersion": 1,
  "sourceCommit": "전체 40자리 Git 커밋",
  "sourceTree": "전체 40자리 Git tree",
  "sourceArchiveSha256": "64자리 SHA-256",
  "deploymentId": "dpl_배포ID",
  "firebaseProjectId": "history-quiz-yongsin",
  "files": [
    { "path": "index.html", "bytes": 100, "sha256": "파일의 64자리 SHA-256" },
    { "path": "assets/main-실제파일명.js", "bytes": 100, "sha256": "파일의 64자리 SHA-256" }
  ]
}
```

파일 목록에는 확인한 추가 JS/CSS도 넣을 수 있다. 파일 대조는 영수증에 기록한 파일만 검증한다. 영수증 자체가 소스에서 만들어졌음을 증명하는 것은 아니므로 Git archive 대조와 제공자 기록을 생략하지 않는다.

## 되돌리기

문제 발생 시 직전 검증 배포 ID를 확인해 `vercel rollback <deployment-id-or-url>`로 복귀하고 동일한 파일 대조를 수행한다. 이미 운영에 사용했던 배포로 복귀할 때는 신규 후보의 `promote` 절차와 구분한다. 프런트 배포를 되돌려도 Firestore 데이터·Rules·Functions는 자동으로 되돌아가지 않는다. 해당 변경이 포함된 배포에서는 서버와 데이터 호환성부터 확인한다. 운영 학생 접근 개방은 별도 운영 결정으로 다룬다.
