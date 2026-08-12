# W11 학기 전환 리허설 evidence

이 폴더는 Dedicated Staging에서 실행한 W11 학기 전환 리허설의 검증 기록 위치만 정의합니다. 실제 검증 전에는 PASS 결과를 미리 만들지 않습니다.

Emulator와 Production runbook의 canonical 학기 쌍은 `2026-1`에서 `2026-2`입니다. Dedicated Staging 리허설은 기존 canonical `2026-2` 데이터를 덮지 않도록 owner/testRunId가 붙은 예약 쌍 `2098-1`에서 `2098-2`만 사용합니다. Staging `2026-2`는 실행 전후 read-only snapshot hash가 같은지 확인하는 용도로만 조회합니다.

실행별 폴더는 `w11-...` 형식의 `testRunId`를 사용하며 아래 파일을 포함합니다.

- `metadata.json`
- `phase-results.json`
- `attempt-results.json`
- `dataset-results.json`
- `readiness-results.json`
- `preview-results.json`
- `state-results.json`
- `viewport-results.json`
- `accessibility-results.json`
- `network-write-results.json`
- `cleanup-results.json`

두 차례의 전체 리허설과 plan, dry-run, apply, verify, resume, rollback-plan 결과를 같은 실행 단위로 남깁니다. Production 접근·write, Maintenance 변경, Archive mutation, activity clone, cross-semester leakage, 합성 fixture·receipt·audit·session·token·Storage 잔존 값은 모두 0이어야 합니다.

구조는 `scripts/w11-staging-evidence-schema.json`, 검증 범위는 `scripts/w11-cutover-test-contract.json`이 기준입니다. 비밀번호, token, API key, 실제 학생·교사 개인정보는 저장하지 않습니다.

## 실제 evidence 생성 순서

같은 `testRunId`로 `setup → runner → collect-evidence → verify → browser QA → cleanup`을 실행합니다. runner와 fixture의 JSON 출력은 실행 폴더 밖의 임시 작업 위치에 보관하고, token 값이나 환경 변수는 파일로 저장하지 않습니다. runner가 실패해도 `collect-evidence`와 `cleanup`은 수행하지만 PASS evidence는 생성하지 않습니다.

Browser QA는 `preview-results.json`, `state-results.json`, `viewport-results.json`, `accessibility-results.json`, `network-write-results.json`을 별도 폴더에 실제 측정값으로 준비해야 합니다. 각 파일의 top-level `projectId`, `deploymentUrl`, `commitSha`는 검증 대상 Dedicated Staging 배포와 정확히 같아야 합니다. 빈 배열, 다른 배포에서 수집한 결과, 미리 작성한 PASS는 generator가 거부합니다.

모든 검증과 cleanup이 끝난 뒤 다음 명령으로 11개 파일을 한 번만 생성합니다.

```powershell
npm run generate:w11-staging-evidence -- --test-run-id=<w11-run-id> --runner-evidence=<runner.json> --collected-evidence=<collected.json> --cleanup-evidence=<cleanup.json> --browser-evidence-root=<browser-results-directory> --deployment-url=https://westory-staging-westoria28-8028-bbbs-projects-44f9da30.vercel.app --branch=<codex/branch> --commit-sha=<40-char-sha>
npm run verify:w11-evidence:actual -- --test-run-id=<w11-run-id>
```

Generator는 기존 실행 폴더를 덮어쓰지 않으며, 실제 runner receipt·dataset·readiness, fixture baseline·cleanup, Browser QA 결과가 모두 PASS이고 Production 접근·write와 잔존 항목이 0일 때만 evidence를 만듭니다.
