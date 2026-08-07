# PHASE 6 — W0-R Safety Baseline Remediation

> 수행일: 2026-08-07~08 (Asia/Seoul)
> 저장소: `C:/westory`
> 작업 브랜치: `codex/phase6-w0r-safety-remediation`
> 기준 HEAD: `2e5b22926551ee3869c35df6320b996fe0de50cd`
> 운영 Firebase: `history-quiz-yongsin`
> 작업 경계: W0-R만 수행. W1, Maintenance 활성화, 운영 데이터 migration, 운영 Rules/Functions 배포는 수행하지 않음.

## 1. Executive Summary

W0에서 `FAIL` 또는 `PENDING`이었던 운영 데이터 B0, 격리 복구, 비용 최소화 staging, GitHub Pages 우회 경로, Vercel bypass 예외, Firebase 환경 분리를 실제로 보완했습니다. 최종 판정은 **`GO FOR W1`**입니다.

이 판정은 W1 코드를 **현재 안전 브랜치와 격리 staging에서 시작할 수 있다**는 뜻입니다. 운영 배포, Maintenance 활성화, M0, R0 확정 또는 다음 Wave 시작을 승인하는 판정은 아닙니다.

| 항목              | W0      | W0-R                                                              |
| ----------------- | ------- | ----------------------------------------------------------------- |
| Firestore B0      | FAIL    | PASS — 36,163문서 export 및 격리 restore/re-export                |
| Storage B0        | FAIL    | PASS — 182개/82,520,348B, path·size·CRC32C·MD5·metadata 대사      |
| Auth B0           | FAIL    | PASS — 730계정 encrypted export, 격리 identity mapping            |
| Recovery          | FAIL    | PASS — 별도 project에서 Firestore/Storage/Auth/Rules/Indexes 검증 |
| Firebase staging  | FAIL    | PASS — 별도 project, synthetic fixture, 운영 데이터 복제 0        |
| Vercel staging    | FAIL    | PASS — 별도 project, READY Preview, 비인증 302                    |
| 환경 격리         | FAIL    | PASS — build/runtime fail-closed, 4개 emulator 연결               |
| GitHub Pages      | FAIL    | PASS — workflow 비활성화, Pages 제거, public URL 404              |
| automation bypass | FAIL    | PASS — 단일 예외 token revoke, 현재 0개                           |
| Known-Good        | PENDING | PASS — 현재 Production deployment와 B0 연결                       |

운영 `www.westory.kr`의 현재 deployment, Firebase 데이터, Rules, Functions는 변경하지 않았습니다. W0-R의 운영 제어면 변경은 승인된 backup/recovery/staging 자원 생성, GitHub Pages 중단, Vercel bypass 폐기, 향후 Vercel Production build용 환경 키 등록뿐입니다.

## 2. W0 Failure Register

| W0 항목                     | 원인                                        | W0-R 조치                                                        | 상태                |
| --------------------------- | ------------------------------------------- | ---------------------------------------------------------------- | ------------------- |
| Firestore backup 0          | export·schedule 없음                        | 별도 B0 bucket으로 managed export, recovery import/re-export     | PASS                |
| Storage immutable copy 없음 | source object read/IAM·destination 없음     | 전용 B0 prefix, object manifest v3, 30일 retention               | PASS                |
| Auth export 없음            | 민감정보 보관 경로 없음                     | EFS+DPAPI 암호화, cloud encrypted object, identity-only recovery | PASS                |
| Restore 미검증              | recovery project 없음                       | `westory-recovery-177587430482`에서 실제 복원                    | PASS                |
| Staging 없음                | 운영 project hardcode                       | 별도 Firebase/Vercel projects와 synthetic fixture                | PASS                |
| Auth/Storage emulator 누락  | client connector 없음                       | Auth/Firestore/Functions/Storage 전체 연결                       | PASS                |
| nonprod→prod 방어 없음      | 환경·project assertion 없음                 | build/runtime boundary와 12-case verifier                        | PASS                |
| 공개 GitHub Pages           | main push가 Production Firebase bundle 공개 | workflow `disabled_manually`, Pages config 제거                  | PASS                |
| Vercel bypass token         | `vercel curl`의 예상 밖 생성                | metadata 확인 후 승인된 단일 token revoke                        | PASS                |
| Known-Good 미지정           | deployment와 data baseline 분리             | current deployment/source/Firebase/B0 manifest 연결              | PASS                |
| TypeScript baseline         | 14파일/64건                                 | 동일 14파일/64건, 변경 파일 0건으로 재확인                       | PASS for W0 ratchet |

PITR, scheduled backup, Storage versioning은 B0의 대체물이 아니므로 이번 판정의 필수 조건으로 두지 않았습니다. 향후 보호 강화 항목으로 남깁니다.

## 3. Authorization Handovers

사용자가 직접 로그인·인증하고 세 가지 외부 변경을 모두 승인했습니다. 비밀번호, OTP, 복구코드, OAuth token, service-account private key 또는 API secret은 요청하거나 문서에 기록하지 않았습니다.

| 서비스                  | 확보 주체/권한                        | 사용한 범위                                                    | 결과 |
| ----------------------- | ------------------------------------- | -------------------------------------------------------------- | ---- |
| Google Cloud / Firebase | `westoria28@gmail.com`, project owner | export, project/bucket 생성, restore, Auth/Rules/Index 검증    | PASS |
| Vercel                  | Team `Westory` OWNER                  | bypass revoke, 별도 staging project/env/deploy/protection 확인 | PASS |
| GitHub                  | repository admin                      | workflow disable, Pages unpublish 상태 확인                    | PASS |

Google Cloud ADC browser flow는 반환 scope가 요구 범위를 충족하지 않아 파일을 생성하지 않고 중단했습니다. 이후 기존 gcloud 사용자 자격을 메모리에서만 사용했고 access token을 출력·저장하지 않았습니다.

## 4. B0 Completion

### 4.1 B0 식별자와 보관소

- run ID: `b0-20260807T145021Z`
- bucket: `gs://westory-b0-177587430482`
- location/class: `US-CENTRAL1` / Standard
- 접근: UBLA, Public Access Prevention enforced
- 보존: 30일 retention policy, 7일 soft delete
- strict retention lock: 적용하지 않음. 불가역 변경은 별도 승인 대상

### 4.2 Firestore

- export prefix: `gs://westory-b0-177587430482/westory/b0-20260807T145021Z/firestore`
- source export: 36,163 documents, 76,315,801 bytes
- operation: 완료
- recovery import 후 재-export: 36,163 documents, 76,641,291 bytes
- 의미: document count와 import/re-export 가능성을 확인했습니다. byte 수 차이는 export encoding/metadata 차이이므로 document identity 검증을 대체하지 않습니다.

B0는 live 운영 중 생성한 pre-patch 복구점입니다. W1 배포와 M0 뒤 writer quiescence 상태에서 만드는 최종 R0는 아닙니다.

### 4.3 Storage

- canonical prefix: `gs://westory-b0-177587430482/westory/b0-20260807T145021Z/storage-v2/`
- source/copy: 182 objects / 82,520,348 bytes
- 검증: path, size, CRC32C, MD5, contentType 및 필요한 metadata 일치
- manifest: `gs://westory-b0-177587430482/westory/b0-20260807T145021Z/evidence/storage-manifest-v3.json`
- manifest SHA-256: `40703eb69401d924d48ee6cd4002db007da5ffe4266921863a9c15ed9f8c8813`

초기 평탄화 copy와 verifier v2는 경로 계약이 틀려 `QUARANTINED`로 보존했습니다. retention 때문에 숨기거나 삭제하지 않고 canonical v3와 명확히 구분했습니다.

### 4.4 Authentication

- source users: 730
- duplicate UID/email/phone: 0/0/0
- password hash/salt 포함 source export: 각 1계정
- plaintext source SHA-256: `b0ff7c77cfbfe44578cb79623163e294b22510e3b690c9995d6193942e7e377c`
- cloud object: `gs://westory-b0-177587430482/westory/b0-20260807T145021Z/auth/auth-export.json.dpapi`
- encrypted object SHA-256: `369ab4a39dbfa5e8ad2fe6c333bace80739cbc7f79c16ee71e92ec11e6543939`

Auth export는 Windows EFS와 DPAPI로 보호했고, 사용자가 EFS 복구 인증서/PFX를 별도로 내보냈습니다. 비밀번호 hash를 recovery Auth에 주입하지 않고 identity mapping만 검증했습니다.

### 4.5 Release contract

- Git bundle: `.../evidence/git/westory-head-2e5b229.bundle`
- SHA-256: `a57cdfd6e6eef5e3dda850808106117a4a6c061346683ea9c4049031ccc174e0`
- `git bundle verify`: PASS, exact HEAD 포함
- Firestore Rules deployed/raw SHA: `9637f8cc312ad9ed202f8b663ae2592e950fdea50d5e1a1679c175fd5316adf6`
- Storage Rules normalized SHA: `75717ed581dc76a262b8f340272bbfd34c024471fa1fa2b053f2aecc9b5b3ef3`
- Functions: 43개 모두 ACTIVE, nodejs22, asia-northeast3, latest ready/created revision 일치

## 5. Recovery Verification

Recovery project는 `westory-recovery-177587430482`이며 public app, custom domain, scheduler, outbound integration을 연결하지 않았습니다. 검증 완료 후 billing을 해제했고 delete protection은 유지했습니다.

| 검증                    | 결과                                                                                  |
| ----------------------- | ------------------------------------------------------------------------------------- |
| Firestore import        | PASS — 36,163 documents                                                               |
| Firestore re-export     | PASS — 36,163 documents                                                               |
| 대표 document/namespace | PASS — import/re-export와 metadata 확인                                               |
| Storage PDF             | PASS — 1,712,365B, header/decode 및 hash 일치                                         |
| Storage PNG             | PASS — 915,562B, 2592×1458 decode 및 hash 일치                                        |
| generation mapping      | PASS — sourceGeneration과 restoredGeneration을 별도 기록, 숫자 동일성은 요구하지 않음 |
| Auth identity           | PASS — 730/730, missing 0, extra 0, core fields 일치                                  |
| Auth 로그인 차단        | PASS — password hash 미주입, email/anonymous provider disabled                        |
| Firestore Rules         | PASS — Production Rules 복원·hash 확인 후 recovery deny-all로 재잠금                  |
| Storage Rules           | PASS — compile 검증. recovery bucket은 Firebase app bucket으로 공개하지 않음          |
| Indexes                 | PASS — composite 3 + field override 1 복원                                            |

임시로 부여한 Firestore service agent의 bucket `storage.admin`/`objectViewer` 권한은 검증 후 B0·recovery bucket에서 제거했습니다. 복구 project를 다시 사용할 때는 billing과 최소 IAM을 재승인해야 합니다.

## 6. Cost-Optimized Staging

Staging은 Production export를 상시 복제하지 않았습니다.

- Firebase project: `westory-staging-177587430482`
- Firestore: `(default)`, `nam5`, delete protection enabled
- Auth: synthetic users only
- Storage: `westory-staging-177587430482.firebasestorage.app`
- Functions: 0개, scheduler/trigger/outbound 0
- fixture: 47 Firestore documents, Storage smoke object 1개
- 운영 학생 PII, 서명, 답안, Wis 거래 원문 복제: 0
- billing: enabled. Recovery project와 달리 W1 staging 검증을 위해 유지

대표 fixture는 Current/Archive semester, class/site settings, assessment, grading, schedule, attendance, Wis, shop, notification, archive/legacy 상태를 포함합니다.

## 7. Firebase Environment Isolation

다음 파일에 W0-R 환경 안전장치를 추가했습니다.

- `.env.example`
- `firebase.json`
- `package.json`
- `src/lib/firebase.ts`
- `src/lib/firebaseEnvironment.ts`
- `src/vite-env.d.ts`
- `vite.config.ts`
- `scripts/verify-firebase-environment-isolation.mjs`
- `scripts/verify-typescript-baseline.mjs`
- `.github/workflows/verify-safety-baseline.yml`

핵심 계약:

1. managed build는 명시적 `VITE_APP_ENV`가 없으면 실패합니다.
2. 실제 Vercel Production project는 `production` 환경만 허용합니다.
3. 별도 Vercel staging project는 명시적 `VITE_VERCEL_PROJECT_ROLE=staging`과 `VITE_APP_ENV=staging` 조합만 허용합니다.
4. non-production은 Production Firebase project/authDomain/bucket fingerprint를 거부합니다.
5. Production은 승인된 Production project ID가 아니면 거부합니다.
6. local/test는 `demo-*` project와 Auth/Firestore/Functions/Storage emulator 네 개를 모두 요구합니다.
7. staging/recovery는 emulator와 Production hostname을 거부합니다.
8. 운영 API key/appId/measurementId 하드코딩을 runtime source에서 제거했습니다. 향후 Production build는 Vercel 환경값을 사용합니다.
9. Vercel Firebase Auth helper rewrite는 승인된 `VITE_FIREBASE_PROJECT_ID`로 생성합니다. Production은 Production Auth helper, staging은 staging Auth helper만 가리키며 다른 project ID는 build 전에 거부합니다.

검증:

- environment matrix: PASS, 12 cases
- Vercel Auth rewrite isolation: PASS, 5 cases
- staging build: PASS, 413 modules
- staging bundle에서 이전 Production API key/appId/measurement fingerprint: 0
- staging project fingerprint: 존재
- 잘못된 staging-as-production 배포: 실제 build FAIL 확인
- Auth/Firestore emulator Rules suites: PASS
- Storage emulator config/connector: 추가됨

## 8. Vercel Staging

- team: `Westory` / `team_M4QjuJFt5l0Lc34XpUxFjEW3`
- project: `westory-staging` / `prj_XMo7TjPKno80BKCnx0YW3JoGXY8B`
- git link/custom domain: 없음
- environment values: staging project의 Preview와 project-internal Production target에만 등록
- current approved deployment: `dpl_FviVMwzviQfWq57sd1PQE6EAtPhc`
- URL: `https://westory-staging-p69iixy94-bbbs-projects-44f9da30.vercel.app`
- target/status: Preview / READY
- unauthenticated response: 302 Vercel Authentication
- Firebase Auth authorized domain: 현재 approved Preview hostname과 stable Preview alias 등록

Hobby 요금제에서 project Production alias는 보호 범위 밖이었습니다. 첫 성공 배포가 만든 `westory-staging.vercel.app`이 비인증 200을 반환하는 것을 확인하고 즉시 alias를 제거했습니다. 현재 해당 주소는 404이며, 승인된 Preview와 자동 Preview alias는 모두 비인증 302입니다.

Production Vercel project가 이 W0-R 브랜치를 별도 Preview로 자동 빌드하면서 `VITE_APP_ENV` 부재로 `dpl_84LLEGmfzLE6k4NaUbENQgBgLHit`가 실패했습니다. 이는 Production project Preview에 staging 자격증명을 주입하지 않은 fail-closed 결과였지만, 별도 staging project를 두는 운영 계약과 중복되는 배포 시도였습니다. Production project의 Ignored Build Step을 `VERCEL_ENV=production`일 때만 build를 계속하도록 설정했습니다. 이후 feature branch Preview는 Production project에서 건너뛰고, 검증 배포는 `westory-staging` project에서만 수행합니다. 실패한 기존 deployment는 감사 증거로 유지하며 재배포하거나 Production 환경값을 Preview에 복제하지 않았습니다.

초기 staging deployment의 정적 `vercel.json`에는 Production Firebase Auth helper rewrite가 남아 있었습니다. 이를 `VITE_FIREBASE_PROJECT_ID` 기반 `vercel.mjs`로 교체하고 production/staging 두 승인 project만 허용했습니다. 재배포된 staging route는 `westory-staging-177587430482.firebaseapp.com`을 가리키며 Production Auth helper 참조는 0건입니다.

`vercel curl`은 protection bypass를 자동 생성할 수 있으므로 사용하지 않았습니다. 보호 검증은 일반 비인증 HTTP와 read-only `vercel inspect`로 수행했습니다.

## 9. Test Account Matrix

Staging Auth에 10개 synthetic 계정을 만들었습니다. credential은 repository 밖 EFS+DPAPI 파일에만 보관하고 출력하지 않았습니다.

| 역할                |  수 | 목적                                       |
| ------------------- | --: | ------------------------------------------ |
| Student             |   5 | current/archive/permission/data-state 조합 |
| Teacher             |   2 | 교사 query·command와 class 분리            |
| Admin               |   1 | 설정/control-plane 후보                    |
| Maintenance Bypass  |   1 | W1 이후 VERIFYING allowlist 검증용         |
| Permission Negative |   1 | deny/fail-closed 검증                      |

실제 ID-token Rules smoke 결과는 Student 200, Teacher 200, Admin 200, Maintenance fixture 200, Permission Negative 403으로 기대값과 일치했습니다. 이 검증은 현재 Rules의 역할 동작만 확인합니다. `maintenance_bypass` capability 자체는 W1에서 구현할 기능이므로 W0-R에서 구현·승인한 것으로 간주하지 않습니다.

## 10. GitHub Pages Resolution

사용자 승인에 따라 권고안 A를 적용했습니다.

- workflow `.github/workflows/deploy-pages.yml`: `disabled_manually`
- Pages configuration API: 404, site unpublish 확인
- public URL `https://westory28.github.io/westory/`: 404
- latest evidence run: `29143900317`, source `2e5b229...`
- Vercel Production: 영향 없음

복구는 reversible합니다. 다만 재활성화 전에는 Pages build를 별도 staging Firebase와 fail-closed 환경에 연결해야 하며, Production Firebase로 다시 공개해서는 안 됩니다.

## 11. Vercel Bypass Token Exception

W0에서 `vercel curl`이 만든 예외는 다음과 같이 확정했습니다.

- scope: `automation-bypass`
- createdAt: `2026-08-07T14:21:20.548Z`
- creator: 현재 Vercel Owner
- name: 없음
- expiry: 없음
- token 값: 조회·기록하지 않음

사용자 승인 후 이 단일 token만 revoke했습니다. 현재 `westory` project의 `protectionBypass` count는 0입니다. Production alias, deployment, environment, Vercel Authentication 설정은 변경하지 않았습니다.

동일 사고 방지를 위해 read-only 검증에서 `vercel curl`을 금지합니다.

## 12. Known-Good Production

현재 정상 운영 deployment를 `CURRENT KNOWN-GOOD FOR W1 ROLLBACK REFERENCE`로 지정합니다.

| 계층            | 기준                                                                    |
| --------------- | ----------------------------------------------------------------------- |
| Git             | `westory28/westory`, `main`, `2e5b22926551ee3869c35df6320b996fe0de50cd` |
| Git tag         | `pre-2026-sem2-rebuild-2026-08-07` → exact HEAD                         |
| Vercel          | `dpl_7r2BkKz1STPv5j15xstj5GArai5V`, READY, Production                   |
| Web             | `www.westory.kr`, HTTP 200                                              |
| Firebase        | `history-quiz-yongsin`                                                  |
| Firestore Rules | deployed hash `9637f8...`                                               |
| Storage Rules   | normalized hash `75717e...`                                             |
| Indexes         | composite 3 + override 1, READY                                         |
| Functions       | 43 ACTIVE, common source hash `715a23ee...`                             |
| Data backup     | B0 `b0-20260807T145021Z`                                                |

직전 READY deployment `dpl_dWWVGpsh9uymfMASDnD9hVNbjbYA`는 보조 rollback 후보일 뿐 known-good로 승격하지 않습니다. W1 이후 Maintenance 상태에서는 pre-W1 UI로 단독 rollback하지 않고 maintenance-safe artifact와 backend fence를 함께 사용해야 합니다.

## 13. Production Write Fence

W0-R에서 W1 기능을 구현하지 않고 환경 경계만 보강했습니다.

- 모든 client Firestore/Auth/Storage/Functions target은 한 개의 검증된 Firebase app config에서 파생됩니다.
- staging/local/test에서 Production project/authDomain/bucket을 넣으면 Firebase 초기화 전에 실패합니다.
- managed build에서 환경 선언이 없거나 Vercel target과 역할이 충돌하면 build가 실패합니다.
- local/test는 네 emulator 중 하나라도 빠지면 실패합니다.
- staging Firebase에는 운영 credentials·운영 데이터·운영 Functions가 없습니다.
- 실제 잘못된 Vercel staging build가 fail-closed한 뒤, 명시적 staging role을 넣은 Preview만 READY가 되었습니다.
- Production Vercel에는 향후 build용 전체 Firebase 환경 key를 등록했지만 현재 Production deployment는 재배포하지 않았습니다.

W1부터 추가할 protected-route mount/query/write detector와 Maintenance client/Rules/Functions fence는 아직 구현하지 않았습니다. 이는 W1의 승인된 본 작업이며 W0-R 환경 격리와 구분합니다.

최종 검증:

| 검사                                  | 결과                                             |
| ------------------------------------- | ------------------------------------------------ |
| `npm run build`                       | PASS, 413 modules                                |
| `npm run format:check`                | PASS                                             |
| `npm run verify:firebase-environment` | PASS, 12 cases                                   |
| supply-chain IOC                      | PASS                                             |
| assessment static safety              | PASS                                             |
| teacher nav static safety             | PASS                                             |
| Auth+Firestore emulator Rules         | PASS                                             |
| `npm --prefix functions run check`    | PASS                                             |
| TypeScript                            | 기존 14파일/64건, 변경 파일 오류 0               |
| TypeScript CI ratchet                 | PASS — OS-independent sorted header SHA-256 고정 |

## 14. Remaining User Actions

다음은 W1 시작을 막지 않는 보안·운영 후속 항목입니다.

1. 로컬 EFS 경로의 일회성 평문 작업 파일을 수동 삭제합니다. 자동 삭제는 실행 정책이 차단했습니다.
   - `C:/Users/방재석/AppData/Local/WestorySecureEvidence/b0-20260807T145021Z/auth/auth-export.json`
   - 같은 폴더의 `auth-recovery-identity-only.json`, `auth-recovery-verify.json`
   - `.../recovery-objects/representative.pdf`, `representative.png`
   - `C:/Users/방재석/AppData/Local/WestorySecureEvidence/gcloud-auth/`의 일회성 로그인 log
2. `auth-export.json.dpapi`, staging credential DPAPI 파일, EFS 복구 인증서/PFX는 승인된 암호화 보관 위치에 유지합니다.
3. B0 bucket의 30일 retention을 strict lock으로 전환할지는 별도 불가역 승인으로 결정합니다.
4. PITR, scheduled Firestore backup, Storage versioning은 비용과 보존정책을 정한 뒤 별도 승인합니다.
5. recovery project를 다시 사용할 때만 billing/IAM을 재활성화하고 검증 뒤 다시 축소합니다.

운영 비밀번호, 학생 계정, Auth 상태, Production bypass 계정은 변경하지 않았습니다.

## 15. Updated W1 Gate

| Gate                    | 상태          | 근거                                                  |
| ----------------------- | ------------- | ----------------------------------------------------- |
| Production Git baseline | PASS          | HEAD/origin/Vercel source 일치, tag·bundle            |
| Vercel Known-Good       | PASS          | current READY deployment와 runtime 200                |
| Firestore B0            | PASS          | export 36,163 + recovery 36,163                       |
| Storage B0              | PASS          | 182/182, bytes/hash/metadata 대사                     |
| Auth 보호/복구          | PASS          | 730 encrypted export + 730 identity mapping           |
| Rules B0                | PASS          | deployed hash, Git artifact, recovery deploy          |
| Indexes B0              | PASS          | Production 3+1, recovery/staging 3+1 READY            |
| Functions baseline      | PASS          | Production 43 ACTIVE; staging/recovery 0              |
| Environment baseline    | PASS          | key scopes, env-only runtime config, 12-case verifier |
| Restore verification    | PASS          | Firestore/Auth/Storage/Rules/Indexes                  |
| Staging Firebase        | PASS          | 별도 project, synthetic data only                     |
| Staging Vercel          | PASS          | 별도 protected Preview, unauth 302                    |
| Production/Staging 격리 | PASS          | project/bucket/auth/functions/env 물리 분리           |
| Production write fence  | PASS for W0-R | build/runtime target fence; W1 domain fence는 W1 소유 |
| Test accounts           | PASS          | 10 synthetic accounts + Rules smoke                   |
| GitHub Pages            | PASS          | workflow disabled, site 404                           |
| automation-bypass       | PASS          | revoked, current 0                                    |
| Rollback 기준점         | PASS          | known-good + B0 + Git tag/bundle                      |
| TypeScript ratchet      | PASS for W0   | 기존 64, 변경 파일 신규 0                             |

W1 시작 조건:

1. 현재 W0-R 안전 변경을 기준으로 별도 W1 실행 요청을 받습니다.
2. W1은 local/emulator와 `westory-staging` Preview에서 먼저 수행합니다.
3. Production DB write, Auth mutation, Rules/Functions/frontend Production deploy는 기본 `NO`입니다.
4. W1 완료·STOP 뒤 사용자 별도 승인으로 Production 호환 배포를 검토합니다.
5. M0 Maintenance 활성화와 writer quiescence, 최종 R0는 W1 배포 검증 뒤 별도 승인입니다.

## 16. Final GO / CONDITIONAL GO / NO-GO

### GO FOR W1

W0-R의 필수 실패 항목을 실제 backup, restore, staging, 접근 보호, environment fail-closed, test fixture, Pages 차단, bypass revoke로 해소했습니다. 따라서 W1 Access & Permission 작업을 **별도 요청 후** 시작할 수 있습니다.

이 GO는 다음을 허용하지 않습니다.

- W1 자동 시작
- Production deploy 또는 schema/data migration
- Maintenance 활성화
- M0/R0/cutover
- W2 이상 선행 작업

`NEXT WAVE STARTED: NO`

**PHASE 6 W0-R STOP.**
