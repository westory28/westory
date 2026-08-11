# W3-W9 Domain Command Migration Handoff

- 기준일: 2026-08-11
- 기준 브랜치: `codex/phase6-w2b-command-rollout`
- 상위 기준: `docs/phase-5-patch-readiness-release-plan-2026-08-07.md`
- W2B 분류: DOMAIN_WAVE 20, TEMPORARY_ALLOWLIST 2, UNKNOWN 0

이 문서는 W2B에서 억지로 Gateway로 옮기지 않은 고위험 명령을 후속 Domain Wave의 완료 조건으로 넘깁니다. 이관은 요구사항 삭제가 아닙니다. 각 Wave는 schema와 상태 전이를 먼저 확정한 뒤 아래 acceptance test까지 통과해야 합니다.

## Domain Wave 명령 20개

| ID / command | 현재 호출 위치 | 현재 write와 데이터 영향 | 멱등성 | 담당 Wave / 선행 변경 | Gateway 이전 요구사항과 acceptance test | 임시 보호 수단 |
| --- | --- | --- | --- | --- | --- | --- |
| D01 `createSemesterShell` | `SettingsGeneral.handleCreateSemester` | `years/{year}/semesters/{semester}` 아래 필수 seed 6종과 `site_settings/config.availableSemesters`를 순차 생성 | 비멱등 | W3 Semester Core. shell manifest·readiness revision 확정 | seed manifest를 operation state에 고정하고 부분 생성 복구. 동일 ID replay·중간 실패 재개·미등록 학기 차단 | 최근 재인증 admin, W2B direct-write allowlist와 owner W3 |
| D02 `updateOperationalSettings` | `SettingsGeneral.handleSave` | `site_settings/config`의 활성 year·semester와 point policy ensure | 자연 멱등 | W3. activation/readiness CAS | expected readiness revision을 검증하고 활성화와 receipt를 원자화. stale activation 충돌·replay 검증 | 최근 재인증 admin, W3 만료 allowlist |
| D03 `updateSchoolSettings` | `SettingsSchool.handleSave` | `site_settings/school_config` overwrite. 이후 학년·학급·등록 구조의 기준 | 자연 멱등 | W4B Identity/Enrollment/Class. school schema 확정 | schema validation, revision CAS, enrollment 참조 영향 사전검사. 동일 payload replay·stale revision 차단 | 최근 재인증 admin, W4B 만료 allowlist |
| D05 `updateMenuSettings` | `SettingsInterface.handleSaveMenus` | `site_settings/menu_config` overwrite와 전역 메뉴 캐시 영향 | 자연 멱등 | W5 Global Shell. route/menu registry revision | menu revision CAS, 유효 route 검증, commit 후 cache invalidation event. replay 시 event 중복 0 | 최근 재인증 admin, W5 만료 allowlist |
| D06 `updateAccessSettings` | `SettingsAccess.handleSave` | `users/{targetUid}` role, `teacherPortalEnabled`, `staffPermissions` merge | 자연 멱등 | W4B. role/capability schema와 identity lifecycle | actor/target/self-lockout 검사, before/after audit, expected profile revision. 권한 실패 business write 0 | 최근 재인증 admin, Rules의 대상 필드 제한, W4B 만료 allowlist |
| D07 `updateNotificationSettings` | `SettingsNotifications.handleSave` | `site_settings/notification_config` overwrite | 자연 멱등 | W8B Schedule/Attendance/Communication. notification delivery contract | config revision CAS와 receipt. listener·예약 발송이 같은 revision을 소비하는지 검증 | 최근 재인증 admin, W8B 만료 allowlist |
| D09 `updatePrivacySettings` + 알림 | `SettingsPrivacy.savePrivacy` | `site_settings/privacy` 저장 후 학생 알림을 별도 callable로 생성. 현재 dedupe key가 시간 기반 | 비멱등 | W5 Global Shell. policy revision과 notification outbox | policy write와 outbox를 한 transaction에 기록하고 command ID를 dedupe key로 사용. 응답 유실 후 알림 중복 0 | 최근 재인증 admin, 변경 버튼에서만 실행, W5 만료 allowlist |
| C01 `deleteStudentData` | `StudentList`, `PerformanceScoreManager` | `users/{uid}`, 학기·legacy 참조, 성적·roster·wallet과 Auth user를 단계 삭제 | 비멱등 saga | W4B. canonical identity/enrollment manifest | preflight delete manifest, 단계 checkpoint, Auth 삭제 결과와 수동 복구 지침. 단계별 실패 재개·이미 삭제된 대상 replay | callable/session/capability fence, W4B test owner |
| C03 `updateStudentData` | `MoveClassModal`, `StudentList`, `StudentDetailModal`, `StudentEditModal` | 사용자·학기·legacy snapshot·성적 roster의 프로필 값을 batch 반영 | 자연 멱등 | W4B. canonical enrollment/profile revision | 과거 snapshot 불변 경계, expected profile revision, 대상 manifest와 부분 실패 재개 | callable/session/capability fence |
| C04/C05 canonical `resetAssessmentAttemptsByClass` | `QuizSettingsModal`; C05는 같은 서버 handler alias | 결과·제출·연결 point transaction 삭제, wallet 재계산, random reset audit 생성 | 비멱등 | W6A Assessment. attempt/result schema | 두 이름을 한 canonical command로 통합, 대상 snapshot hash와 delete/rebuild checkpoint. 동일 ID audit·wallet effect 1회 | 같은 handler alias 유지, recent/high-risk callable |
| C06 `recalculateQuizResultsAfterQuestionCorrection` | `QuizBankTab` | quiz result 정답·점수 보정, point bonus transaction, wallet/HOF dirty | 자연 멱등이지만 파급 write 큼 | W6A. question/result revision | question revision과 affected-result manifest, reward outbox checkpoint. 결과 보정·보상 각각 중복 0 | callable/session/capability fence |
| C07 `grantHistoryClassroomExemptions` | `ManageHistoryClassroom` | 학생별 random exemption 추가와 알림 생성 | 비멱등 | W8A Learning. exemption lifecycle | command ID 기반 exemption ID, recipient snapshot, exemption+notification outbox 원자화. 교차 기기 효과 1회 | callable/session/capability fence |
| C08 `revokeHistoryClassroomExemptions` | `ManageHistoryClassroom` 두 명시 동작 | 지정 exemption을 `revoked`로 batch update | 자연 멱등 | W8A. exemption status revision | expected status/revision, target manifest와 receipt. 이미 revoked replay는 최초 결과 반환 | callable/session/capability fence |
| C09 `reviewHistoryClassroomExemptionRequest` | `ManageHistoryClassroom` | request·exemption·result transaction과 알림 생성 | 자연 멱등이지만 알림 비멱등 | W8A. request state machine | 상태 전이 CAS, receipt, notification outbox 원자화. 승인/거절 충돌과 replay 검증 | callable/session/capability fence |
| C10 `reviewPerformanceScoreObjection` | `PerformanceScoreManager` | objection·score confirmation transaction update와 알림 | 자연 멱등 | W6B Grade/Evidence/Signature. score bundle revision | score bundle CAS, receipt와 outbox 연결. stale score·중복 review·응답 유실 검증 | callable/session/capability fence |
| C11 `saveWisHallOfFameConfig` | `HallOfFameManagementTab` | 학기 HOF/interface config merge | 자연 멱등 | W7B Wis Projection/UI. Economy config revision | active economy scope, config CAS와 receipt. projection refresh는 commit 이후 멱등 event | callable/session/`point_manage` fence |
| C12 `rebuildPointWalletRankTotals` | client adapter만 있고 현재 UI caller 0 | 전체 ledger 재집계 후 wallet/rank projection batch rewrite | 자연 멱등 장기 job | W7A Wis Ledger. canonical ledger·projection schema | dry-run diff, source ledger checksum, progress/checkpoint, 완료 receipt, resume/rollback | callable 비노출 상태 유지, W7A test owner |
| C14 `updateTeacherPointAdjustment` | `ManagePoints` 수정·취소 동작 | 기존 adjustment와 wallet `deltaDiff`를 transaction 반영 | 자연 멱등 | W7A. W2B `legacyPointV1` 제거와 canonical ledger | expected ledger revision, 같은 ID 같은 결과, 다른 payload conflict, cancel/update 상태 전이 검증 | callable/session/`point_manage` fence |
| C15 `reviewTeacherPointOrder` | `ManagePoints` 주문 검토 | order status와 결정적 debit/refund ledger, wallet balance transaction | 자연 멱등 | W7A. order state machine와 canonical ledger | order revision CAS, 상태 전이별 command ID, receipt를 wallet/ledger transaction에 포함 | callable/session/`point_manage` fence |
| C16 `deleteSourceArchiveAsset` | `ManageSourceArchive.handleDelete` | Storage prefix 객체 삭제 후 Firestore asset 문서 삭제 | 자연 멱등이지만 외부 saga | W4A Archive/Legacy. asset generation manifest | Firestore receipt와 Storage delete checkpoint, object generation manifest, 이미 삭제된 객체 replay·부분 실패 복구 | callable/session/capability fence, Storage Rules direct delete 차단 |

## Temporary allowlist 2개

| ID / command | 현재 위치·경로 | 유지 이유와 위험 | 담당 Wave·제거 기한·테스트 책임 |
| --- | --- | --- | --- |
| D04 `updateInterfaceSettings` | `SettingsInterface.handleSaveInterface`, `site_settings/interface_config` | Global Shell 토큰·표현 schema가 W5에서 확정됩니다. 현재 overwrite라 stale UI가 최신 설정을 덮을 수 있습니다. | W5 완료 전에 Gateway CAS로 이전. owner `W5 Global Shell`, test owner `W5 settings contract` |
| C02 `resetLessonCorePointProgress` | `StudentList.handleResetCorePoints`, 학생 lesson progress core-point 필드 batch reset | Learning schema가 W8A에서 재구축됩니다. 대상 snapshot이 변하면 일부 reset만 남을 수 있습니다. | W8A 완료 전에 manifest/receipt command로 이전. owner `W8A Learning`, test owner `W8A progress migration` |

## 공통 acceptance gate

후속 Wave에서 각 명령을 완료로 판정하려면 정상 요청, 같은 ID replay, 같은 ID의 다른 payload 충돌, 두 app context 동시 요청, commit 후 응답 유실 복구, 권한·session 선차단, direct SDK 우회 거부, receipt·audit·business data 정합성, rollback 또는 resume 경로를 검증해야 합니다. 장기 작업은 진행률과 checkpoint를 추가하되 W2B의 짧은 transaction command를 불필요한 queue로 바꾸지 않습니다.
