# PATCH01 개인 패치 메모 저장 경계

2026-09-11. 적용 범위는 `C:\westory-w10p` feature branch와 전용 Staging이다. 운영 환경 접근·배포와 main 병합은 제외한다.

## 변경 계약

- 개인 메모 생성·본문 수정·처리 상태 변경·삭제를 `executeCommand`와 `getCommandStatus`에 등록했다. 별도 관리자 재인증은 요구하지 않으며 기존 일반 세션·App Check·교사/관리자 역할 검사는 유지한다.
- 경로는 서버가 `teacherPatchNotes/{actorUid}/notes/{noteId}`로 결정한다. 클라이언트의 소유자·경로·시각 주입은 거절한다. 문서 변경, receipt, audit은 같은 트랜잭션이다.
- 생성은 receipt ID에서 문서 ID를 계산한다. 수정·상태·삭제는 `expectedNoteRevision`을 검사한다. 이전 문서의 리비전 필드 부재만 0으로 해석하고 잘못된 값은 거절한다. 삭제 후 이전 생성 요청을 재전송해도 메모가 되살아나지 않는다.
- 기본 및 Staging Firestore Rules는 직접 생성·수정·삭제를 모두 차단한다. 본인의 제한된 읽기 쿼리 계약은 유지한다. 운영 Rules 파일도 후속 출시용으로 수정했지만 이 작업의 배포 대상은 Staging Rules뿐이다.
- 화면은 편집 시작 리비전을 고정한다. 다른 창이 수정하면 초안을 남긴 채 충돌을 표시한다. 같은 메모의 상태를 직접 변경한 경우에만 일치하는 편집 기준을 성공 리비전으로 올린다.
- 응답과 receipt 조회가 모두 실패하면 원래 요청을 잠그고 같은 요청으로 재시도한다. 이후 인증 거절은 최초 커밋 여부의 증거가 아니므로 ID를 보존한다. receipt 부재 뒤 서버가 확정한 `PATCH_NOTE_CONFLICT`/`PATCH_NOTE_NOT_FOUND`는 잠금을 풀되 초안을 보존한다.
- 공통 Gateway의 재시도 ID 보존도 강화했다. 내용 본문을 브라우저 저장소에 추가하지 않는다. 기존 ID·해시만 저장하는 계약을 유지한다.

## 검증

패키지·의존성·잠금 파일은 변경하지 않는다. 새 검증을 package.json에 연결하지 않았으므로 아래 명령을 별도로 실행한다.

```powershell
node functions/scripts/verify-teacher-patch-notes.cjs
node scripts/verify-command-retry-recovery.mjs
node scripts/verify-teacher-patch-memo-recovery.mjs
# demo-westory-session-patch-notes의 Auth/Firestore/Functions emulator에서 실행
node scripts/verify-teacher-patch-gateway-integration.mjs
# Firestore emulator에서 각 rules 파일로 실행
$env:WESTORY_FIRESTORE_RULES_PATH='firestore.rules'
node scripts/verify-teacher-patch-notes-rules.mjs
$env:WESTORY_FIRESTORE_RULES_PATH='firestore.staging.rules'
node scripts/verify-teacher-patch-notes-rules.mjs
```

실행 시 Node/npm/브라우저 프로세스는 작업 지침대로 Idle·CPU1로 제한한다.

- 서버 단위 검증: 54개. 동시 수정 단일 성공, replay, rollback, 소유자·역할, legacy 리비전, 잘못된 입력 포함.
- 실제 callable emulator 검증: 28개. 두 함수 등록, 일반/만료 세션, proof, 역할, 직접 SDK 차단, CAS, receipt 조회 포함. emulator는 실제 App Check 검증의 대체 증거가 아니다.
- 실제 클라이언트 Gateway 격리 검증: 15개. 응답 유실→인증 거절→reload→동일 ID, 확정 충돌/삭제의 잠금 해제 포함.
- 실제 메모 컴포넌트 격리 브라우저 검증: 92개. 390·768·1280·1440px, 페이지 오류 0, 가로 넘침 0. 합성 데이터이며 실제 관리자 계정 조작 증거가 아니다.
- 양쪽 Rules의 본인 조회와 역할·세션 거절, 직접 쓰기 거절을 확인했다. 리비전 없는 정상 legacy 문서에 대한 본문·상태·삭제 거절도 별도 검사한다.
- 기존 재인증 검사에서 과거 App Check 초기화 코드에 고정된 정규식을 현재 활성 Firebase binding 계약에 맞췄다. 제품 App Check 코드는 변경하지 않았다.

최종 배포 ID·원격 파일 대조·실제 Staging 합성 검증 결과는 외부 야간 인수인계에 기록한다. 이 문서만으로 배포 완료를 의미하지 않는다.

## 남은 범위

- 메모 목록은 최신 100건이며 그 밖의 오래된 미처리 메모는 아직 조회할 수 없다.
- 초안은 메모리에 보관하므로 새로고침·탭 종료까지 복구하지 않는다. 재시도 ID 보존은 초안 영구 저장과 다르다.
- 실제 Google 관리자 화면의 로그인 및 메모 조작은 사용자가 다시 연결한 세션에서 확인해야 한다.
- PATCH01 전환은 다른 출시 조건, 다중 화면 세션 복구, 학생 답안 및 실제 보상 회귀의 완료를 뜻하지 않는다.
