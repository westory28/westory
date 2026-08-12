# W10 UI/UX evidence

이 폴더는 W10 Dedicated Staging 검증 산출물의 위치만 정의합니다. 실제 검증 전에는 PASS 결과를 미리 만들지 않습니다.

실행별 폴더는 `w10-...` 형식의 `testRunId`를 사용하며 다음 파일을 포함합니다.

- `metadata.json`
- `route-results.json`
- `viewport-results.json`
- `journey-results.json`
- `state-results.json`
- `accessibility-results.json`
- `network-write-results.json`
- `cleanup-results.json`

구조와 필수값은 `scripts/w10-evidence-schema.json`, 검증 범위는 `scripts/w10-browser-matrix.json`이 기준입니다. 실제 계정, 이메일, 학생 정보, 비밀번호, API 키, App Check·debug·bypass token은 저장하지 않습니다.

검증기는 학생 canonical route 17개, 교사 canonical route 13개, alias 4개를 포함한 route·viewport 184개 case와 8개 journey를 정확히 대조합니다. 누락·중복·UNKNOWN, mount/listener write, critical·serious 접근성 위반, cleanup 잔존 값이 하나라도 있으면 PASS evidence로 인정하지 않습니다.

실행 순서는 아래와 같습니다. `{testRunId}`는 각 실행에서 새로 만든 `w10-...` 값이어야 합니다.

```powershell
node scripts/verify-w10-staging-fixture.mjs --dry-run --project=westory-staging-177587430482 --test-run-id={testRunId}
node scripts/verify-w10-staging-fixture.mjs --setup --project=westory-staging-177587430482 --test-run-id={testRunId}
node scripts/verify-w10-evidence.mjs --verify --test-run-id={testRunId}
node scripts/verify-w10-staging-fixture.mjs --verify --project=westory-staging-177587430482 --test-run-id={testRunId} --evidence-root=docs/evidence/w10-ui-ux/{testRunId}
node scripts/verify-w10-staging-fixture.mjs --cleanup --project=westory-staging-177587430482 --test-run-id={testRunId} --evidence-root=docs/evidence/w10-ui-ux/{testRunId}
```

`setup`에 필요한 비밀번호는 `WESTORY_W10_STAGING_PASSWORD` 환경 변수로만 전달하고 evidence에 기록하지 않습니다. `cleanup`은 해당 실행의 owner marker, `testRunId`, actor UID, command 생성 시각을 모두 확인한 뒤 합성 데이터만 정리합니다.
