# 모의고사 분석의 문제지 동일성 — 2026-11-11

## 문제와 변경 범위

기존 분석은 `[문항 ID, sourceRevision]` 조합으로 문제지를 구분했다. 따라서 발문·보기·이미지·배점이 그대로여도 복수 정답이나 성취수준·난이도·개념 메타를 수정하면 다른 문제지로 분리될 수 있었다.

학생에게 제시된 동결 원문의 SHA-256 `paperMaterialHash`를 분석 동일성의 근거로 추가했다. 문항 유형, 발문, 선지와 순서, 선지 이미지, 연결 자료, 지문·보기·공동 자료와 이미지, 회차·문항 순서·배점은 구별한다. 단답 정답 추가·교체와 학습 메타·해설 변경은 동일한 자료의 채점·진단 변경이며 새 문제지를 만들지 않는다. 순서·연결 문항에서 정답 문자열이 실제 제시할 항목을 담는 과거 형식은 해당 항목도 해시에 반영한다.

`sourceRevision`과 기존 교정 투영은 유지한다. 원래 답안, 동결 문항, 원점수, 응시·재응시 조건, 보상 기록은 수정하지 않는다. 현재 은행이나 동일 문항 ID만으로 과거 내용을 추측하지 않으며, 완전한 원문이 없으면 종전 revision 기준을 유지한다. 원본에 저장된 파생 해시 값도 그대로 믿지 않고 원문에서 재계산한다. 해시를 추가해도 원본 snapshot의 provenance 해시는 달라지지 않는다.

학생과 교사에게 같은 결과를 제공하던 `effectiveQuizResult`의 채점 동작은 바꾸지 않았다. 3회 동결본에 대한 추가 정답도 기존 교정 인덱스와 제출 후 교정 경로를 계속 사용한다. 같은 자료를 여러 번 응시한 경우 분석 표본은 해당 학생의 첫 제출만 사용한다.

## 조회·저장과 전환

경량 파생뷰 `quiz_achievement_result_views`의 schema를 1에서 2로 올리고, 기존 동결 문항을 읽을 때 해시를 계산해 작은 응답에 보존한다. 원문의 큰 이미지나 지문을 경량 응답에 다시 넣지 않는다. 기존 원문 interning도 유지한다.

정상 v2 조회는 결과 한 건당 기존 파생뷰 한 건을 읽으며 원본 본문을 추가로 읽지 않는다. 조회 범위를 확인하는 메타데이터 읽기는 그대로 유지한다. 없거나 오래되거나 손상된 파생뷰만 기존 제한 내에서 정확한 원본 한 건으로 복구하고, 조회 경로는 쓰기를 수행하지 않는다. v1을 그대로 두면 매번 원본 fallback이 필요하므로 활성 학기의 기존 1·2회를 한 번 보완한다. 일반 요약 조회에 이미지 포함 원문 조회를 추가하지 않았다. persisted 요약/목록/검색 캐시의 계약은 그대로라 `quizClassAnalysis.SCHEMA = 4`도 유지한다. 상세·성취 조회는 원래 이 요약 캐시를 사용하지 않는다.

2026-11-11 10:42 KST, 활성 학기 `2026-2`를 확인한 뒤 학기·QUIZ·모의고사 category 서버 필터와 5개 범위 메타 필드로 전체 모의고사 결과를 점검했다. `exam_prep` 단위의 1회 288건, 2회 108건, legacy 0건이며 다른 단위 결과는 없었다. 이 인벤토리와 기존 scoped backfill의 결과 수가 일치했다. backfill의 canonical definitionId 호환 조회와 legacy 경로도 유지한다.

| 일회 보완 범위 | 대상 | 원본 처리 bytes | v2 파생뷰 bytes | dry-run 쓰기 |
| --- | ---: | ---: | ---: | ---: |
| 1회 | 288 | 136,208,870 | 6,176,035 | 0 |
| 2회 | 108 | 51,380,815 | 2,299,739 | 0 |
| 합계 | 396 | 187,589,685 | 8,475,774 | 0 |

각 최초 대상은 파생뷰와 해당 원본을 읽고, 적용 직전 트랜잭션에서 원본 updateTime 기반 `sourceVersion`과 범위를 재확인한다. 파생뷰의 `projectionHash`, 출처 경로, 학기, sourceVersion도 검사한다. 원본이 바뀌거나 더 최신 파생뷰가 있으면 오래된 계획을 쓰지 않는다. 같은 v2 파생뷰가 이미 있으면 0쓰기다. sourceVersion이 동일한 v1만 v2로 승격할 수 있으며, 더 최신 삭제 표식을 되살리지 않는다. 적용은 최대 동시 작업 3개이고 원본 결과 컬렉션에는 쓰지 않는다.

## 검증

- 실제 교사 분석 서비스와 프런트 어댑터를 운영 데이터에 읽기 전용으로 실행했다. 3학년 10반, 재학생 317명 범위에서 2회 완료 결과 108건의 2,484개 동결 문항 모두 해시 증거가 있었다. revision 기준 3개 문제지가 자료 기준 1개(108명, 23문항)로 합쳐졌다. 앞선 시험 무결성 조사의 112건은 attempt 수이며 완료 result 수와 구분한다.
- 추가 정답·교체 정답·메타 변경의 동일성, 발문·보기·이미지·자료·배점 변경의 분리, 원문 없는 기록의 보수적 처리, 같은 문제지 재응시의 첫 관측 유지, 원본 provenance 보존을 검증했다.
- 경량 projection 14사례, 성취 분석 24사례, 일반 분석 48사례, 심리측정 16사례를 통과했다. 기존 correction의 이전 응시·진행 중 응시·제출 후 교정·다른 학기·정답 제거·중복 이벤트 검증도 통과했다.
- 실제 callable 배포본 109사례, 두 trigger 배포본 각각 14사례를 통과했다. 300명·8MiB 초과 응답, 32MiB 초과 반복 이미지의 interning과 읽기 상한, 읽기 중 변경·실패·재시도를 포함한다.
- TypeScript와 Functions 전체 check 통과. 독립 에이전트가 해시 증거, compact/live 경계, v1→v2 CAS와 원본 무변경을 재검토했고 blocker가 없었다.
- AI 호출, 외부 학생 자료 전송, 권한, 학생 원본 답안/성적, 공개 설정의 변경은 없다. 로컬 운영 점검 산출물에는 학생 식별자·답안·점수를 출력하지 않았다.

## 운영 선택 배포와 파생뷰 보완

실제 배포와 운영 파생뷰 쓰기는 루트 에이전트가 수행했다. 3개 함수의 선택 배포 성공, ACTIVE 및 기존 runtime 6개 설정의 일치를 확인했다. 아래 명령은 실제 적용 절차를 기록한 것이다.

`output/broad-stability-20261111/analysis/`에 각 함수의 운영 archive, 배포 전 설정, 최소 패치 배포본, config 및 `release-manifest.json`을 준비했다. 변경 모듈의 운영 원본은 모두 검토한 Git 기준과 같았다. 함수별 원본에 해당 모듈만 적용하고 index·package·기존 gateway와 다른 함수 소스는 유지한다.

| 함수 | 메모리 | CPU | 동시성 | 최대 인스턴스 | 제한 시간 |
| --- | ---: | ---: | ---: | ---: | ---: |
| getQuizClassAnalysis | 512 MiB | 1 | 80 | 10 | 120초 |
| invalidateQuizClassCanonicalResult | 256 MiB | 1 | 80 | 10 | 60초 |
| invalidateQuizClassLegacyResult | 256 MiB | 1 | 80 | 10 | 60초 |

모두 nodejs22이며 최소 인스턴스는 0이다. 두 trigger → callable 순서로 선택 배포하고, 실제 ACTIVE와 runtime 설정을 대조한 뒤 즉시 양회 파생뷰를 보완한다. 교정 trigger는 채점 로직이 변경되지 않아 배포 대상이 아니다.

배포본 테스트는 공용 `NODE_PATH`로 통과했으나 Firebase discovery는 `firebase-admin/app`을 배포본 내부에서 해석해야 했다. 따라서 각 원본 package-lock을 그대로 사용해 `npm ci`로 배포본의 의존성을 먼저 준비한다. 운영 소스나 의존성 버전은 변경하지 않는다.

```powershell
$env:FUNCTIONS_DISCOVERY_TIMEOUT = '60'
npm --prefix output/broad-stability-20261111/analysis/invalidateQuizClassCanonicalResult-release ci
npm --prefix output/broad-stability-20261111/analysis/invalidateQuizClassLegacyResult-release ci
npm --prefix output/broad-stability-20261111/analysis/getQuizClassAnalysis-release ci
firebase deploy --config output/broad-stability-20261111/analysis/invalidateQuizClassCanonicalResult-firebase.json --only "functions:invalidateQuizClassCanonicalResult" --project history-quiz-yongsin
firebase deploy --config output/broad-stability-20261111/analysis/invalidateQuizClassLegacyResult-firebase.json --only "functions:invalidateQuizClassLegacyResult" --project history-quiz-yongsin
firebase deploy --config output/broad-stability-20261111/analysis/getQuizClassAnalysis-firebase.json --only "functions:getQuizClassAnalysis" --project history-quiz-yongsin
node functions/scripts/backfill-quiz-achievement-projection.cjs --semester 2026-2 --unit exam_prep --round round_1 --apply
node functions/scripts/backfill-quiz-achievement-projection.cjs --semester 2026-2 --unit exam_prep --round round_2 --apply
```

직후 아래 읽기 전용 검증은 v2 현재 파생뷰에서 `unchanged=288/108`, `converted=0`, `written=0`을 확인한다. 그 사이 새 제출이 생기면 실제 대상 수는 정상 증가할 수 있다. 실제 교사 분석 서비스와 모델을 다시 실행해 문제지 1개와 원본 fallback 감소도 확인한다.

```powershell
node functions/scripts/backfill-quiz-achievement-projection.cjs --semester 2026-2 --unit exam_prep --round round_1
node functions/scripts/backfill-quiz-achievement-projection.cjs --semester 2026-2 --unit exam_prep --round round_2
node output/broad-stability-20261111/analysis/audit-round2.mjs --after-backfill
```

근거: 위 evidence 폴더의 `scope-inventory.json`, `round1-backfill-dryrun.json`, `round2-backfill-dryrun.json`, `round2-readonly.json`, `release-manifest.json`, `*-test.log`, `functions-check.log`. 운영 재검증은 `round2-after-backfill.json`에 별도 기록한다. 원본 점수·답안의 일괄 덮어쓰기는 이 절차에 없다.

## 운영 적용 후 확인 — 2026-11-11 11:00 KST

루트의 적용 결과는 1회 288건, 2회 108건, 합계 396개 파생뷰 쓰기이며 stale은 모두 0이다. 원본 결과 쓰기는 0이다. 적용 후 동일 CLI를 쓰기 없는 dry-run으로 다시 실행해 1회 `unchanged=288`, 2회 `unchanged=108`, 양쪽 모두 `converted=0 / written=0 / stale=0 / originalBytes=0`을 확인했다.

실제 교사 서비스와 프런트 어댑터의 읽기 전용 재검증에서도 3학년 10반, 재학생 317명 범위의 2회 완료 결과 108명·23문항이 동일한 문제지 1개로 유지됐다. 2,484개 문항 모두 자료 해시가 있었고 트랜잭션·원본 쓰기·파생뷰 쓰기는 0이었다.

같은 서비스 요청의 `getAll` 직접 문서 읽기는 v1 fallback 상태의 1,132건에서 정상 v2 상태의 736건으로 396건 줄었다. 이는 보완한 원본 396건의 본문 fallback 제거와 일치한다. 이 수치는 `getAll` 호출의 문서 수이며 범위 쿼리·개별 조회를 합친 총 Firestore 읽기 수로 보고하지 않는다. 범위 조회와 학생·학기·권한 확인은 유지했다.

추가 근거: `round1-after-backfill.log`, `round2-after-backfill.log`, `round2-after-backfill.json`. 최종 프런트 운영 승격과 Chrome 화면 확인은 루트의 전체 안정화 배포 기록에서 이어서 확인한다.
