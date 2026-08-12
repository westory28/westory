# W11 Semester Cutover Preparation Handoff

작성일: 2026-08-12

## 1. W10 최종 route 계약

- 학생 canonical route: 17개
- 교사 canonical route: 13개
- legacy alias: 4개, canonical redirect 유지
- 등록 화면: 47개, `UNKNOWN=0`
- 로그인 `/`, Maintenance `/maintenance`, Developer Log, Not Found를 별도 통합 상태로 관리

정확한 경로·component·분류·대체 경로는 `scripts/w10-route-inventory.json`이 기준입니다. W11은 route를 다시 설계하지 않고 이 계약 위에 shadow 상태를 표시합니다.

## 2. 2026-2 master data

W10 UI가 요구하는 최소 master는 다음과 같습니다.

- semester manifest: 상태, revision, 시작·종료일, Asia/Seoul 운영 기준
- Class와 ACTIVE Enrollment snapshot: enrollmentId, classId, uid, 표시 이름, 학생 번호
- 과목·수업·교시·시간표의 stable ID와 label
- Assessment/Grade item revision, maxScore, import identity
- Learning unit, content type, status, audience
- Communication 대상 role, class, user
- 역사사전 unit·tag·level, 지도 region·tag·provenance, 사료 era·subject·type

현재 `users.grade`, `users.class`를 대상 판정이나 학적 join의 기준으로 사용하지 않습니다.

## 3. Current / Preparing / Archive / Legacy

공통 source는 `CURRENT`, `PREPARING`, `ARCHIVE`, `LEGACY`, `EXPLICIT`입니다. 모든 query 결과는 `semesterId`, `provenance`, `readOnly`, `schemaVersion`, revision을 전달합니다. ACTIVE CURRENT만 수정할 수 있으며, PREPARING·ARCHIVE·LEGACY·EXPLICIT은 화면과 서버 양쪽에서 read-only입니다. CURRENT가 비었다는 이유로 LEGACY를 자동 표시하지 않습니다.

## 4. Dashboard projection

학생 Today는 오늘 시간표, 학습·평가, 공개 성적, 중요 공지, 출석, Wis, 다가오는 일정을 read-only로 조회합니다. 교사 업무 홈은 미처리 출석, Draft·Bulk, 공개 예정 Learning·Notice, Grade·Wis 바로가기와 readiness를 수정 없이 표시합니다. W11은 projection의 count·join·hash를 비교하되 화면 mount에서 repair하지 않습니다.

## 5. W11 fixture와 selector

W11 합성 fixture는 2026-2 manifest, Class, ACTIVE Enrollment, W6~W9 각 Domain의 최소 master를 owner marker와 예약 ID로 만듭니다. 공통 selector row는 다음 필드를 사용합니다.

`{id,label,secondaryLabel,semesterId,classId,enrollmentId,uid,status,provenance,readOnly,revision}`

master revision이 바뀌면 이전 selection을 폐기하고 다시 preview합니다. Loading, Empty, Error, Permission, Stale, Archive, Legacy를 구분합니다.

## 6. 2026-1 Archive 검증

- 모든 Domain read-only
- W4 manifest·Enrollment join 100%
- W6B Grade bundle count·join·hash 불변
- W7 잔액·순위 이월 0
- W8 Learning progress, Schedule, Attendance, Notice·Acknowledgement mutation 0
- W9 Draft가 Archive canonical data를 수정하지 않음
- silent legacy fallback 0

## 7. 미완성 Storage 경로

지도와 사료 등록은 `EXPLICITLY_UNAVAILABLE`입니다. 이전 번들의 Firestore·Storage direct mutation도 deny합니다. 재활성화하려면 owner binding, checksum, MIME·size, TTL, promote, receipt, revision CAS, Archive fence와 잔존 파일 0 cleanup을 한 계약으로 설계해야 합니다.

## 8. Release Decision과 blocker

정확한 8개 항목은 `docs/handoff/w10-release-decision-register.md`를 따릅니다. EX06·MAP01·MAP02·SRC01은 계약 전 재활성화하지 않습니다. DIC01·DIC02·PATCH01은 현재 기능을 유지하지만 Production 전 W12 Gateway migration이 필요합니다.

`KI-W1-01`은 Release blocker로 유지합니다. W11은 정상 Staging 세션과 Emulator에서 shadow 검증을 진행하고, 재인증 구조를 다시 설계하지 않습니다.

## 9. Production Maintenance와 cutover

Production Maintenance는 마지막 확정 상태 `enabled=true`, revision `3`입니다. W11은 이 문서를 근거로만 사용하고 설정을 조회·변경하지 않습니다. 실제 cutover 순서는 Maintenance 활성 확인, shadow validation, readiness 승인, 2026-2 activation이며 Production 승격 권한은 별도로 받아야 합니다.

## 10. W11 shadow validation 화면

관리자 화면은 Production을 수정하지 않고 Staging의 source·target count, orphan, duplicate, hash, stale dependency, blocking issue를 비교합니다. 차이가 있으면 source path와 disposition을 표시하되 자동 repair하지 않습니다. 결과는 registry check ID와 reconciliation evidence에서 파생합니다.

## 11. W11 acceptance criteria

- 2026-2 master exact schema·revision·hash
- Class·Enrollment·Domain join 100%
- 2026-1 Archive count·hash 불변
- CURRENT/PREPARING/ARCHIVE/LEGACY 화면·서버 경계 일치
- selector stale invalidation과 preview write 0
- W2~W10 aggregate 회귀 PASS
- Staging fixture·token·Storage 잔존 0
- Production write·Maintenance 변경 0
- KI-W1-01 악화 없음
