# PHASE 6 W8 — Learning, Schedule, Attendance & Communication

작성일: 2026-08-12

기준 브랜치: `codex/phase6-w8-learning-schedule-communication`

기준 SHA: `2b8a4123fa52a56631eddc0dba1b49700040f30f`

Dedicated Staging: `westory-staging-177587430482`

## 1. Executive Summary

W8은 학습, 일정, 출석, 공지·알림을 학기·Class·Enrollment 기준의 서버 권위 모델로 옮겼습니다. 학생과 교사 화면은 `getW8DomainState`의 조회 projection만 사용하며, 영구 변경은 23개 typed command를 통해서만 처리합니다. 목록 조회, 화면 방문, listener 부착, 반응형 mount로 생기는 쓰기는 0건입니다.

로컬 전체 회귀와 Dedicated Staging 배포·브라우저 검증을 통과했습니다. 합성 fixture와 세션, receipt, audit, Auth 사용자는 모두 제거했습니다. Production 접근과 변경은 0건입니다.

## 2. Baseline

- 시작 branch: `codex/phase6-w7-wis-economy`
- 시작 SHA: `2b8a4123fa52a56631eddc0dba1b49700040f30f`
- W8 branch: `codex/phase6-w8-learning-schedule-communication`
- 사용자 소유 문서 `AGENTS.md`, `DESIGN.md`, `UI_RULES.md`와 W1 evidence는 W8 staging 대상에서 제외했습니다.
- `tmp/`, `.env.local`, token, debug token은 commit 대상에 넣지 않았습니다.
- KI-W1-01은 기존 Release Blocker로 유지했습니다. W8에서 재디버깅하지 않았습니다.

## 3. Existing Domain Inventory

기존 경로에서 확인한 W8 책임 쓰기는 알림 설정, 학습 progress reset, 학습 면제 승인·철회·검토였습니다. W2B manifest의 다섯 항목은 모두 `W8_DONE`으로 닫았습니다. 학생 Dashboard의 self-attendance, 교사 Dashboard의 달력·공지 listener, 알림 자동 생성·자동 읽음, Schedule 진입 시 공휴일 동기화는 canonical 화면에서 제거했습니다.

사료 보관함과 생각모아의 기존 공개 범위는 넓히지 않았습니다. 작성자 표시 정책도 현재 수준을 유지했습니다.

## 4. W8 Command Migration

Command Gateway에 23개 명령을 등록했습니다.

- Learning: `createLearningContent`, `updateLearningContent`, `transitionLearningContent`, `recordLearningProgress`, `requestLearningExemption`, `resetLearningProgress`, `grantLearningExemptions`, `revokeLearningExemptions`, `reviewLearningExemptionRequest`
- Schedule: `createScheduleEvent`, `updateScheduleEvent`, `deleteScheduleEvent`
- Attendance: `createAttendanceSession`, `recordAttendance`, `recordAttendanceBulk`, `correctAttendanceRecord`, `closeAttendanceSession`
- Communication: `createNotice`, `updateNotice`, `transitionNotice`, `acknowledgeNotice`, `acknowledgeAllNotices`, `updateNotificationSettings`

각 명령은 commandId, payload hash, application session, actor, 학기 revision, 대상 revision, receipt, audit, server timestamp를 사용합니다. 응답이 유실되어도 같은 commandId는 기존 결과를 돌려주며 business effect는 한 번만 발생합니다. 기존 bundle의 직접 SDK 쓰기와 8개 legacy callable은 fail-closed 처리했습니다.

## 5. Learning Model

학습 자료는 `semester_learning_contents`에 저장합니다. 공통 metadata와 본문·자료 URL을 분리해 일반 학습 자료를 W6 Assessment와 섞지 않았습니다. 상태는 `DRAFT → READY → PUBLISHED → CLOSED → ARCHIVED` 흐름을 따릅니다. 학생은 `PUBLISHED`이면서 공개 기간과 대상 학급·Enrollment가 일치하는 자료만 읽습니다.

학습 면제와 요청은 `semester_learning_exemptions`, `semester_learning_exemption_requests`에 분리했습니다. 요청과 승인 시 콘텐츠 revision, ACTIVE Enrollment, Class 대상 여부를 다시 확인합니다.

## 6. Learning Progress

`semester_learning_progress`는 studentUid, semesterId, contentId, enrollmentId에 결박됩니다. 학생이 `START` 또는 `COMPLETE`를 명시적으로 선택할 때만 progress가 바뀝니다. 목록·상세 방문은 쓰기를 만들지 않습니다. 같은 완료 command를 다시 보내도 effect는 1회입니다.

상태는 `NOT_STARTED`, `IN_PROGRESS`, `COMPLETED`를 사용합니다. 과거 학기 progress는 read-only이며 현재 학기로 복제하거나 자동 repair하지 않습니다.

## 7. Student Learning UX

학생 Shell의 `/student/learning`에 나의 학습, 진행 중, 완료, 예정, 보관 자료를 연결했습니다. 카드와 상세에는 학기, 출처, 상태, 공개 기간, 진행 상태를 표시합니다. 명시적 시작·완료와 면제 요청만 command를 보냅니다. 평가·퀴즈는 기존 W6 평가 메뉴에 그대로 남아 일반 학습과 구분됩니다.

## 8. Teacher Learning Operations

`/teacher/learning`은 콘텐츠 목록, 생성·수정, 대상 학급 지정, 공개 준비·공개·종료·보관, progress와 면제 요청 검토를 제공합니다. mutation은 teacher/admin 역할과 teacher portal, `lesson_read`를 함께 확인합니다. 위임된 읽기 권한만 있는 계정은 운영 명령을 실행할 수 없습니다.

W9 공통 Draft framework는 도입하지 않았습니다. W8 화면은 domain revision CAS와 저장 중 상태만 사용합니다.

## 9. Schedule Model

일정의 canonical collection은 `semester_schedule_events`입니다. 일정은 eventType, 시간 범위, 대상 학급·학생, sourceDomain, sourceReference, revision, provenance를 보존합니다. 같은 학기에서 active sourceReference 중복을 차단하고 `startAt ≤ endAt`, 학기 범위, ACTIVE Enrollment와 Class를 검증합니다.

학생 Today, 학생 일정, 교사 Dashboard는 Schedule projection을 읽기만 합니다. Dashboard에서 일정 수정은 제공하지 않습니다.

## 10. Timetable / Recurrence / Holiday

시간표 template와 특정 날짜 event를 구분했습니다. W8 조회 중에는 반복 문서를 만들지 않습니다. 기존 W2A `syncKoreanPublicHolidays`만 공휴일 동기화 경로로 유지했으며 Dashboard·Schedule·Calendar 진입으로 공휴일을 쓰지 않습니다. 공휴일과 사용자 일정은 sourceDomain으로 구분합니다.

날짜 key와 Today 계산은 `Asia/Seoul` 기준입니다. UTC 날짜가 바뀌는 경계도 unit test에 포함했습니다.

## 11. Attendance Model

출석은 `semester_attendance_sessions`, `semester_attendance_records`, `semester_attendance_revisions`로 나눴습니다. Session은 학기, Class, 날짜, 교시, source event, 상태와 revision을 가집니다. Record는 학생 UID와 Enrollment에 묶이며 session·학생 조합당 하나만 존재합니다.

정정은 기존 값을 조용히 덮지 않습니다. record revision을 올리고 변경 전후 상태, 사유, actor, 시각을 immutable revision 문서로 남깁니다.

## 12. Attendance Operations

교사는 session 생성, 개별 입력, bounded bulk 입력, 정정, 종료를 command로 처리합니다. bulk는 transaction 안에서 전체 입력을 검증한 뒤 원자 적용하므로 무음 부분 성공이 없습니다. ACTIVE Enrollment, Class, semester 일치와 session 상태를 매번 확인합니다.

학생 로그인, Dashboard 방문, Schedule 방문은 출석이 아닙니다. 미입력 학생은 UI의 `UNRECORDED` placeholder로만 보여 주며 자동 `PRESENT` 문서를 만들지 않습니다. 학생은 본인 기록만 읽습니다.

## 13. Notice / Notification Model

공지 원본은 `semester_notices`, 전달 projection은 `semester_notice_deliveries`, 명시적 확인은 `semester_notice_acknowledgements`에 저장합니다. 상태는 `DRAFT`, `SCHEDULED`, `PUBLISHED`, `EXPIRED`, `ARCHIVED`를 사용합니다.

W8 v1 공지는 학생 대상입니다. 대상 역할은 `student`로 고정하고 Class와 사용자 조건을 ACTIVE Enrollment로 해석합니다. 전달 대상은 최대 100명이며 0명인 대상은 거부합니다. 예약 공개 시 deterministic delivery를 한 번 만들고 이후 공개 전환에서 중복 생성하지 않습니다.

## 14. Read / Acknowledgement Contract

공지 목록이나 상세를 열어도 읽음으로 처리하지 않습니다. 학생이 `확인`을 누를 때 `acknowledgeNotice`, `모두 확인`을 선택할 때 `acknowledgeAllNotices`가 실행됩니다. 동일 확인 command의 effect는 한 번입니다. 읽음은 서명이나 동의와 다른 상태로 유지합니다.

## 15. Domain Event Integration

W8 화면에서 평가·성적·위스 알림 문서를 직접 만들던 경로는 끊었습니다. 기존 `createManagedNotifications`는 network write 없이 명시적 skip 결과를 돌려줍니다. W8 공지 delivery는 공지 lifecycle transaction에서 deterministic ID로 생성합니다. 별도 event bus는 만들지 않았습니다.

## 16. Current / Archive / Legacy

모든 query 응답은 semesterId, schemaVersion, provenance, source, readOnly를 제공합니다. `CURRENT`는 ACTIVE 학기에서만 쓸 수 있습니다. `ARCHIVE`, `LEGACY`, `EXPLICIT`, `PREPARING`은 read-only입니다. 현재 자료가 없을 때 legacy 자료를 조용히 대신 보여 주지 않습니다.

학생·교사 화면은 `현재 학기`, `준비 학기`, `지난 학기`, `레거시`, `지정 학기`, `읽기 전용`을 색상과 문구로 함께 표시합니다.

## 17. W5 Shell / Dashboard Integration

학생 Shell에는 학습, 일정, 출석, 공지 canonical route를 연결했습니다. 학생 Today는 이어 할 학습, 오늘 일정, 출석 안내, 중요 공지를 조회 projection으로 표시합니다. 교사 업무 홈도 오늘 일정, 출석 미처리, 공개 예정 학습, 중요 공지를 읽기만 합니다.

모바일·데스크톱 navigation은 같은 domain component를 동시에 숨겨서 mount하지 않습니다. W8 route의 global data query는 `getW8DomainState` 한 경계에서 수행합니다.

## 18. Readiness

W3 readiness registry에 다음 네 check를 등록했습니다.

- `learning_domain_readiness`
- `schedule_domain_readiness`
- `attendance_domain_readiness`
- `communication_domain_readiness`

예상 개수는 `W8_READINESS_CHECK_IDS` registry에서 파생합니다. 테스트와 서버 코드에 총수를 따로 중복 하드코딩하지 않았습니다. 각 check는 schema, reference, 중복, 기간, orphan, blocking legacy issue를 검사합니다. W8 dependency가 바뀌면 readiness dependency hash가 달라져 기존 report는 stale이 됩니다.

## 19. Query Purity / Direct Write Boundary

W8 query purity는 mounted route 8개에서 direct read 0, direct write 0, implicit write 0, 이전 bundle writer reachable 0으로 통과했습니다. Notification panel·card·list·detail의 자동 읽음도 0입니다.

client direct-write boundary는 approved group 150, query factory 11, fetch 2, UNKNOWN 0으로 통과했습니다. W8 canonical 12개 collection과 실제 legacy 경로 23개의 direct SDK 작업은 Rules에서 거부하며, Rules matrix는 447개 denied operation을 확인했습니다.

## 20. Responsive / Accessibility

학생은 390×844, 768×1024, 1024×768, 1280×800, 1600×900에서 검증했습니다. 교사는 390×844, 1024×768, 1600×900에서 학습·일정·출석·공지 대표 화면을 확인했습니다. 모든 화면에서 horizontal overflow 0, main 1, h1 1, dialog 이탈 0이었습니다.

표시 중인 핵심 button/link는 44px 이상입니다. accessible name, form label, alt, duplicate id, landmark를 자동 점검했고 누락은 0건이었습니다. 키보드 포커스는 주 동작과 local navigation, 상태 필터 순으로 이동했습니다. 출석 상태와 알림 우선순위, 출처는 색상뿐 아니라 텍스트로 전달합니다.

## 21. Regression

`npm run verify:w8-domains`가 321초에 exit 0으로 통과했습니다. 이 aggregate에는 W2 Command Gateway, W3 Semester/readiness, W4 Enrollment/Archive, W5 Shell/Maintenance, W6B Grade, W7 Wis 회귀와 W8 unit·Rules·integration이 포함됩니다.

- W8 unit: 52 cases
- W8 command: 23
- W8 readiness: 4
- read-after-write 위반: 0
- W8 Rules canonical collections: 12
- previous bundle denied paths: 23
- W8 integration: query 5종, exactly-once, archive write 0, silent legacy 0, query write 0
- build, format, Functions check: PASS

KI-W1-01의 재인증 후 profile probe 문제는 기존 Release Blocker로 남아 있습니다. W8 기본 세션·권한 회귀는 통과했고, W8 때문에 악화된 증거는 없습니다.

## 22. Dedicated Staging

Firebase Rules·Storage Rules·Functions는 `westory-staging-177587430482`에만 배포했습니다. 최종 Vercel Preview는 `dpl_D3kn1CgFzHk9vUMp7eAGNPfgZQKc`이며 고정 alias는 다음 주소를 가리킵니다.

`https://westory-staging-westoria28-8028-bbbs-projects-44f9da30.vercel.app`

브라우저에서는 학생·교사 query-only 화면, 학습 생성·공개, 명시적 progress 시작·완료, 면제 요청을 확인했습니다. 전체 23개 command는 emulator에서 검증했고, admin-only `updateNotificationSettings`는 Staging live config를 바꾸지 않았습니다.

## 23. Fixture / Token Cleanup

fixture owner `w8-domain-staging-browser`, testRunId `w8-20260812-final-001`로 exact cleanup을 수행했습니다.

- business documents: 0
- receipt/audit documents: 0
- fixture documents: 0
- application sessions: 0
- synthetic Auth users: 0
- residual tokens: 0
- notification config mutation: 0

임시 Preview allowlist, App Check debug token, Vercel bypass token은 만들지 않았습니다. emulator 종료 뒤 관련 process와 5001·8080·9099·9150·9199 listener도 0입니다.

## 24. Production Safety

Production Firestore, Storage, Auth, Rules, Functions, Vercel, alias, 환경변수, App Check, 활성 학기, Maintenance 설정을 변경하지 않았습니다. Production access count는 0입니다.

Production Maintenance는 마지막으로 확정된 상태인 `enabled=true`, revision `3`을 그대로 유지합니다. W8에서 다시 조회하거나 설정하지 않았습니다.

## 25. W9 Handoff

W9에는 교사 공통 Draft, 재로그인 복구, 다중 탭 revision 충돌, 공통 bulk 선택, 부분 성공 정책, 반복 업무 효율화를 넘깁니다. W8 domain command와 query 계약은 변경하지 않고 그 위에 workflow를 얹어야 합니다. 자세한 내용은 `docs/handoff/w9-teacher-operations-draft-bulk-handoff.md`에 기록했습니다.

## 26. Release Blockers

- `KI-W1-01 — RELEASE BLOCKER`: 재인증 후 일부 환경에서 `users/{uid}` probe가 permission-denied로 실패합니다. Production 출시 전에 해결해야 하지만 W9 Staging 개발을 막지는 않습니다.
- 기존 Tailwind CDN 경고와 Firebase authDomain 안내는 W8 기능 오류가 아닙니다. 최종 통합·운영 준비 단계에서 정리합니다.

## 27. Rollback

Vercel은 W7 검증 배포로 고정 alias를 되돌릴 수 있습니다. Firebase는 W7 SHA의 Functions·Rules를 Dedicated Staging에 다시 배포합니다. rollback 중에도 Production과 main은 건드리지 않습니다.

데이터 rollback은 합성 fixture cleanup만 수행했습니다. W8에서 Production migration은 없었으므로 Production 데이터 rollback 절차는 필요하지 않습니다.

## 28. Final W9 Readiness

W8 CURRENT-WAVE blocker는 0건입니다.

최종 판정: `READY FOR W9 TEACHER OPERATIONS / DRAFT / BULK STAGING DEVELOPMENT`

이 판정은 학습·일정·출석·공지/알림 영역이 Dedicated Staging에서 W9가 사용할 안정적인 계약을 갖췄다는 뜻입니다. Production 출시 준비가 끝났다는 뜻은 아닙니다.
