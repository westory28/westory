# 2026학년도 2학기 Production Cutover Runbook

이 문서는 실제 Production 전환 때 사용할 승인·실행·검증 순서를 정의합니다. W11에서는 이 절차를 Dedicated Staging의 합성 학기로만 리허설합니다. 이 문서 자체는 Production 실행 권한을 부여하지 않습니다.

## 1. 적용 범위와 금지 사항

- source: `2026-1`
- target: `2026-2`
- 기준 시간대: `Asia/Seoul`
- Cutover Manifest: `docs/manifests/2026-2-cutover-manifest.json`
- Production Firebase: `history-quiz-yongsin`
- Production Maintenance: 마지막 문서 확정값 `enabled=true`, revision `3`

W11 명령은 Production 프로젝트에서 fail-closed입니다. W12가 끝난 뒤에도 별도 Production Cutover 승인, Release Mode, R0 백업 검증이 없으면 실행하지 않습니다. Production Maintenance와 active semester pointer는 일반 CLI나 수동 Firestore write로 변경하지 않습니다.

다음 데이터는 target으로 복제하지 않습니다: 평가 Attempt·답안·제출·결과, 공식 성적·정정·서명, 출석, Learning progress, 공지 delivery·acknowledgement, 교사 Draft·Bulk, command receipt·audit, Wis ledger·balance·ranking·order·inventory·usage·initial grant, application session, fixture, test data, Storage object.

## 2. 사전 승인 Gate

아래 항목 중 하나라도 미충족이면 `HOLD`입니다.

1. W12 Release Candidate 전체 QA PASS
2. `KI-W1-01`의 5개 viewport 재인증 acceptance test PASS
3. Production Release Decision 완료
4. 2026-2 시작일·종료일 승인
5. roster 원천·학급별 인원·누락 학생 승인
6. 교사 업무 중단 시각과 실제 전환 시각 승인
7. W10 이후 최신 RC SHA·Vercel deployment 승인
8. B1/R0 백업 ID와 복구 가능성 검증
9. 실제 Production Expected Diff 승인
10. writer quiescence 확인
11. 최신 readiness required check가 모두 PASS이며 stale·policy mismatch가 없음
12. Production용 Cutover Manifest 서명·승인

EX06·MAP01·MAP02가 출시 범위에 포함된다면 공식 저장·Storage 계약이 마련되기 전에는 `HOLD`입니다. 비활성 기능으로 승인되면 UI와 Rules의 차단 상태를 유지합니다.

## 3. R1 백업과 기준점

운영 책임자가 승인한 도구로 다음 항목을 각각 백업하고 ID·시각·hash를 Manifest 승인 기록에 연결합니다. secret 값은 기록하지 않습니다.

- Firestore managed export와 collection별 count/hash
- Storage object inventory와 checksum
- Auth UID inventory와 비식별 hash
- Firestore Rules release ID
- Storage Rules release ID
- Firestore Index 상태
- Functions source SHA·runtime·배포 revision·secret version reference
- Vercel deployment ID·source SHA·environment revision
- Git commit·tag
- `site_settings/semester_active`와 `site_settings/config`의 revision
- 2026-1 Manifest, Archive evidence, 주요 Domain count/join/hash

백업 하나라도 실패하거나 restore 경로가 확인되지 않으면 전환을 시작하지 않습니다.

## 3-1. 미완료 업무 종결

Cutover Manifest의 `incompleteWorkPolicy` 13개 항목을 기준으로 전환 전 현황을 집계합니다. 채점·미확정 성적·정정 요청·미입력 출석·고립된 batch·readiness 문제는 전환 전에 종결합니다. 미제출 평가는 source 학기와 함께 닫고, 진행 중 Attempt와 교사 Draft는 담당자가 개별 검토합니다. 확정 성적의 미확인 상태와 미완료 Learning은 source Archive에서만 read-only로 유지합니다. 미처리 Wis 주문은 감사 가능한 취소로 끝내며 target으로 옮기지 않습니다.

집계 수량과 책임자, 최종 처리 결과가 승인 기록에 없거나 정책 밖 상태가 하나라도 남으면 `HOLD`입니다. 학기가 바뀐다는 이유로 업무를 삭제하거나 target 학기로 자동 이월하지 않습니다.

## 4. Production Expected Diff

승인된 R0 snapshot과 최종 roster를 바탕으로 실행 직전 Expected Diff를 생성합니다. 정확한 수량은 이 시점의 승인 자료에서 파생하며 문서에 임의 숫자를 넣지 않습니다.

반드시 0이어야 하는 항목:

- Auth 계정 변경
- 학생 UID 변경
- 2026-1 문서 삭제
- 과거 성적·출석·Wis 거래 수정
- 금지 활동 데이터 복제
- Storage 변경
- 설명되지 않은 create/update/delete

예상되는 변경은 승인된 2026-1 lifecycle 전환, 2026-2 Manifest·seed, Class·Enrollment, 승인된 master, 새 Wis Economy·0원 Account, readiness·cutover evidence와 해당 command receipt·audit뿐입니다.

## 5. 배포 순서

1. 사용자 최종 승인 기록
2. Production Maintenance 활성 상태를 운영자가 확인
3. 교사·관리자 업무 중단 공지 및 writer quiescence 확인
4. R1 백업과 무결성 확인
5. Expected Diff 재생성·승인
6. 승인된 RC의 Firestore·Storage Rules 배포
7. 승인된 RC의 Functions 배포
8. 승인된 RC의 Vercel deployment 준비
9. 서버·Rules·index smoke 확인
10. frontend 배포와 source SHA 확인

W11의 Staging 도구를 프로젝트 ID만 바꿔 Production에 실행하지 않습니다. W12 이후 별도 승인된 Production wrapper가 project allowlist, release approval ID, Manifest hash, recent authentication을 검증해야 합니다.

## 6. 데이터 전환 순서

1. 2026-1 pending workflow의 승인된 disposition 확인
2. 2026-1 `CLOSING → CLOSED` 전환
3. Archive Manifest, frozen revision, count/join/hash 생성
4. 2026-1 `ARCHIVED` 전환과 write fence 확인
5. 2026-2 Manifest와 required seed 생성
6. approved roster dry-run
7. 2026-2 Class 생성
8. stable UID 기반 Enrollment import
9. 승인된 Assessment Definition 복제
10. Learning Content를 DRAFT로 복제
11. Schedule event를 2학기 날짜 범위로 재생성
12. Notice template를 DRAFT로 재생성
13. Grade master는 지원 정책만 검증하고 공식 성적은 생성하지 않음
14. Wis catalog reference 검증
15. 새 Semester Economy 생성
16. ACTIVE Enrollment마다 0원 Account 생성
17. 활동 데이터 0건, cross-semester leakage 0건 확인
18. 전체 readiness 실행
19. Expected Diff와 실제 diff 대조
20. 사용자 승인 checkpoint
21. W3의 원자 activation command 실행

`semester_initial_grant`는 Cutover에 포함하지 않습니다. 별도 승인된 command로만 실행합니다. 공휴일도 W2A 동기화 command를 별도로 사용하며 화면 조회로 생성하지 않습니다.

## 7. 활성화 직전 GO 조건

- source `2026-1`은 CLOSED 또는 ARCHIVED이며 hash가 R0와 일치
- target `2026-2`는 READY
- target Manifest revision·readiness policy·dependency hash가 최신
- ACTIVE Enrollment 유일성 위반 0
- orphan·duplicate·unsupported schema 0
- 금지 활동 데이터 0
- 모든 Wis Account balance·rank 0, ledger·order·grant 0
- required readiness PASS, PENDING·FAIL·stale 0
- Cutover evidence status VERIFIED
- Expected Diff와 실제 diff 일치
- active pointer CAS expected value 일치
- rollback checkpoint와 담당자 준비

모든 조건이 충족될 때만 GO를 선언합니다.

## 8. 원자 활성화와 R2

W3 `activateSemester` command 하나로 기존 ACTIVE lifecycle, target ACTIVE, canonical pointer, legacy config projection을 같은 transaction에서 변경합니다. 수동 pointer write나 여러 console 수정으로 나누지 않습니다.

성공 직후 R2 snapshot을 남기고 다음을 확인합니다.

- ACTIVE 학기 정확히 1개
- pointer·Manifest·legacy config 일치
- 학생 CURRENT=`2026-2`, `2026-1`은 ARCHIVE read-only
- PREPARING 학기 학생 노출 0
- Class·Enrollment join 100%
- Assessment Attempt·Grade·Attendance·Learning progress 0
- Wis Account 수=ACTIVE Enrollment 수, balance·rank 0
- Notice delivery·acknowledgement 0
- Draft·Bulk 0
- receipt·audit 정합성

## 9. Smoke Test와 학생 접근 재개

Maintenance를 유지한 상태에서 다음 순서로 검증합니다.

1. 관리자 Manifest·readiness·diff 확인
2. 교사 업무 홈과 Class·Enrollment 확인
3. Learning·Assessment·Grade·Wis·Schedule·Attendance·Communication 대표 조회
4. 합성 교사 command exactly-once
5. 합성 학생 로그인·Today·Archive 조회
6. 390×844, 768×1024, 1024×768, 1280×800, 1600×900 핵심 흐름
7. KI-W1-01 재인증 Gate 재확인
8. console error·permission-denied·unhandled rejection 0

학생 Maintenance 해제는 별도 사용자 승인입니다. 승인 전에는 상태나 revision을 변경하지 않습니다.

## 10. HOLD와 즉시 Rollback

다음은 `HOLD`입니다.

- Expected Diff 불일치
- readiness FAIL·PENDING·stale
- orphan·duplicate
- 2026-1 write 또는 금지 활동 복제
- active pointer CAS 충돌
- roster 미승인
- KI-W1-01 미해소
- 필수 Release Decision 미완료
- backup 검증 실패

다음은 즉시 Rollback입니다.

- 학생·교사 데이터 유실
- Auth UID 변경
- Archive 원본 수정
- ACTIVE 학기 0개 또는 2개
- 교사 접근 장애 또는 권한 우회
- Wis 원장 불일치
- 성적·평가 무결성 손상
- 예상하지 못한 Production write

Rollback은 `docs/runbooks/2026-2-production-rollback.md`를 따릅니다.

## 11. 종료와 보존

- R0·R1·R2 snapshot과 승인 기록 보존
- Manifest, Expected Diff, actual diff, readiness, receipt·audit evidence 연결
- 임시 계정·session·token·fixture·preview allowlist 제거
- Production과 Staging의 project·deployment ID 재확인
- post-release monitoring과 담당자 인수인계

W11에서는 이 절차를 Production에 실행하지 않습니다.
