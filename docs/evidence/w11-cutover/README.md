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
- `screenshot-manifest.json`
- `accessibility-results.json`
- `network-write-results.json`
- `cleanup-results.json`

두 차례의 전체 리허설과 plan, dry-run, apply, verify, resume, rollback-plan 결과를 같은 실행 단위로 남깁니다. Production 접근·write, Maintenance 변경, Archive mutation, activity clone, cross-semester leakage, 합성 fixture·receipt·audit·session·token·Storage 잔존 값은 모두 0이어야 합니다.

구조는 `scripts/w11-staging-evidence-schema.json`, 검증 범위는 `scripts/w11-cutover-test-contract.json`이 기준입니다. 비밀번호, token, API key, 실제 학생·교사 개인정보는 저장하지 않습니다.

## 실제 evidence 생성 순서

같은 `testRunId`로 `setup → runner → collect-evidence → verify → browser QA → cleanup`을 실행합니다. runner와 fixture의 JSON 출력은 실행 폴더 밖의 임시 작업 위치에 보관하고, token 값이나 환경 변수는 파일로 저장하지 않습니다. runner가 실패해도 `collect-evidence`와 `cleanup`은 수행하지만 PASS evidence는 생성하지 않습니다.

Browser QA는 `preview-results.json`, `state-results.json`, `viewport-results.json`, `accessibility-results.json`, `network-write-results.json`, `screenshot-manifest.json`과 PNG 다섯 장을 별도 폴더에 실제 측정값으로 준비해야 합니다. viewport는 정확히 `390x844`, `768x1024`, `1024x768`, `1280x800`, `1600x900`을 사용하며 DPR은 1, `fullPage`는 `false`로 고정합니다.

Browser QA 파일의 top-level에는 Firebase `projectId`와 함께 `stableAlias`, 브라우저가 실제로 관찰한 `observedAliasOrigin`, `deploymentUrl`, `immutableDeploymentUrl`, `deploymentId`, `vercelProjectId`, `vercelOrgId`, `aliasTargetDeploymentId`, `inspectedAt`, `commitSha`, `sourceCommitSha`를 기록합니다. `observedAliasOrigin`은 고정 Dedicated Staging alias와 같아야 합니다. `deploymentUrl`은 `immutableDeploymentUrl`과 같고 stable alias와 달라야 합니다. alias를 조회한 시점의 `aliasTargetDeploymentId`가 `deploymentId`와 일치하지 않으면 통과하지 않습니다. 다른 origin에서 수집한 결과, mutable alias만 배포 provenance로 기록한 결과, 빈 배열, 다른 배포에서 수집한 결과, 미리 작성한 PASS는 generator가 거부합니다.

`state-results.json`에는 실제 전환 센터가 동시에 렌더링한 source `ARCHIVE`, target `PREPARING`, verified evidence `EXPLICIT`만 기록합니다. 화면에서 관찰하지 않은 상태를 Browser PASS로 미리 작성하지 않으며, loading·permission·error·stale 분기는 정적 계약과 기능 검증으로 별도 확인합니다.

`screenshot-manifest.json`은 PNG마다 파일명, 실제 관찰 origin, `/teacher/settings/cutover` route, viewport, DPR, `fullPage`, 실제 픽셀 크기, SHA-256, `capturedAt`, 40자 `sourceCommitSha`를 기록합니다. 전용 검증기는 PNG signature, chunk CRC, IHDR·IDAT·IEND를 직접 읽어 파일명·manifest·실제 픽셀 크기와 SHA-256이 일치하는지 확인합니다. manifest에 없는 PNG나 손상된 파일은 PASS evidence에 포함할 수 없습니다.

모든 검증과 cleanup이 끝난 뒤 다음 명령으로 evidence를 한 번만 생성합니다. 아래 deployment URL은 stable alias가 아니라 해당 실행의 immutable URL이어야 합니다.

```powershell
npm run verify:w11-screenshot-manifest -- --manifest=<browser-results-directory>/screenshot-manifest.json --screenshots-root=<browser-results-directory> --test-run-id=<w11-run-id>
npm run generate:w11-staging-evidence -- --test-run-id=<w11-run-id> --runner-evidence=<runner.json> --collected-evidence=<collected.json> --cleanup-evidence=<cleanup.json> --browser-evidence-root=<browser-results-directory> --deployment-url=<immutable-deployment-url> --deployment-id=<dpl-id> --vercel-project-id=<prj-id> --vercel-org-id=<team-id> --alias-target-deployment-id=<dpl-id> --inspected-at=<ISO-8601> --branch=<codex/branch> --source-commit-sha=<40-char-sha>
npm run verify:w11-evidence:actual -- --test-run-id=<w11-run-id>
```

Generator는 기존 실행 폴더를 덮어쓰지 않습니다. 실제 runner receipt·dataset·readiness, fixture baseline·cleanup, Browser QA 결과가 모두 PASS이고 deployment provenance와 PNG 무결성이 서로 맞으며 Production 접근·write와 잔존 항목이 0일 때만 evidence를 만듭니다.
