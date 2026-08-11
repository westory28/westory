# W4 Archive / Enrollment Semester Handoff

- 인계 기준일: 2026-08-11 KST
- 선행 Wave: W3 Semester Manifest, Readiness Gate & Atomic Activation
- 대상 Wave: W4 Archive / Legacy Adapter / Enrollment
- Production data migration: W3에서 실행하지 않음

## W3가 제공하는 계약

W4는 다음 W3 서버 권위 경계를 그대로 사용합니다.

- Manifest: `semester_manifests/{semesterId}`
- latest readiness: `semester_readiness_reports/{semesterId}`
- immutable readiness evidence: `semester_readiness_reports/{semesterId}/versions/{reportId}`
- active pointer: `site_settings/semester_active`
- legacy client 호환 pointer: `site_settings/config.year`, `semester`, `activeSemesterId`, `activeSemesterRevision`
- 상태: `DRAFT → PREPARING → VALIDATING → READY → ACTIVE → CLOSING → CLOSED → ARCHIVED`
- 실패·격리 상태: `FAILED`, `QUARANTINED`
- provenance: `CURRENT`, `PREPARING`, `ARCHIVE`, `LEGACY`
- 모든 상태·revision·readiness·pointer 변경은 W2 Command Gateway와 receipt/audit을 통합니다.

W4는 active pointer나 Manifest system field를 client에서 직접 쓰지 않습니다. Archive 전환도 `transitionSemesterStatus`를 통해 `CLOSED → ARCHIVED`로 처리하되, W4의 불변성 검사가 모두 끝난 뒤에만 실행합니다.

Dedicated Staging의 W3 종료 상태는 `2026-2` ACTIVE revision 1, `2027-2` PREPARING partial fixture입니다. 2026-2는 legacy 운영 범위를 보존하려고 bootstrap한 것으로 필수 seed가 실제 3/6뿐입니다. 누락 3개를 자동 생성하지 않았으며 이 bootstrap을 readiness PASS로 해석해서는 안 됩니다. 2027-2 fixture는 seed 1/6이라 W3 서버 검증에서 READY·ACTIVE로 진행할 수 없습니다.

`getSemesterCoreState`는 ACTIVE뿐 아니라 pointer와 revision이 일치하는 CLOSING도 현재 운영 범위로 반환합니다. pointer 누락·고아 pointer·revision 불일치는 conflict로 닫고, readiness는 latest report와 필수 seed의 dependency hash까지 같은 read-only transaction에서 확인합니다. W4 adapter도 이 판정을 우회해 legacy config만 읽지 않습니다.

## W4에서 구현할 범위

### Archive와 Legacy

- `CLOSED` 학기의 collection·Storage inventory와 immutable source set을 만듭니다.
- Archive adapter가 명시적 `semesterId`와 provenance를 받아 read-only query를 수행하게 합니다.
- CURRENT query가 비었을 때 root 또는 과거 scope를 조용히 읽는 silent fallback을 제거합니다.
- 학기를 확정할 수 없는 데이터는 `LEGACY` 또는 `QUARANTINED`로 남기고 현재 학기에 재귀속하지 않습니다.
- Archive direct update/delete를 Rules와 command boundary에서 차단합니다.
- 승인 correction이 필요한 일반 domain은 원본 덮어쓰기 대신 append-only correction/audit 계약을 설계합니다.
- Wis Economy의 `CLOSED`·`ARCHIVED` 데이터에는 가치 이동 append/update/delete를 허용하지 않습니다.

### Student / Class / Enrollment

- 영구 Student identity와 학기별 Class·Enrollment를 분리합니다.
- 2026-1 소속 snapshot을 현재 `users` 프로필에서 분리해 고정합니다.
- 2026-2 enrollment는 승인 roster import와 예외 승인 흐름을 기준으로 생성합니다.
- 과거 record가 현재 grade/class 변경에 따라 다시 분류되지 않도록 enrollment reference 또는 immutable snapshot을 둡니다.
- UID 누락·missing user container·중복 소속·roster 참조 오류를 reconciliation 대상으로 등록합니다.

## W4 Readiness 등록 지점

W3 readiness registry의 다음 후속 check를 W4에서 실제 검사로 승격합니다.

| check | W4 완료 증거 | activation 영향 |
| --- | --- | --- |
| Archive adapter readiness | source scope, count/hash, read-only query, fallback 0 | 필수 PASS |
| Enrollment / Class readiness | student/class/enrollment count, duplicate 0, unresolved mapping 0 | 필수 PASS |
| Historical permission | 학생 자기기록·교사 capability 정책과 Rules matrix | 정책 확정 후 필수 PASS |
| Archive immutability | Firestore/Storage direct mutation 거부, correction audit | 필수 PASS |

등록된 필수 check가 PASS하지 않으면 이후 Production 활성화가 불가능해야 합니다. W4는 W3의 `readinessPolicyVersion`을 임의로 덮어쓰지 않고, 정책 버전 변경이 필요하면 새 registry version과 invalidation 사유를 함께 추가합니다.

## As-Is 위험과 이관 항목

- `site_settings/config`와 `availableSemesters[].shellReady`는 legacy compatibility용일 뿐 readiness source of truth가 아닙니다.
- 기존 `getYearSemester(config)` 사용처는 config pointer를 읽는 legacy adapter입니다. W4 대상 archive/enrollment query부터 명시적 resolver로 교체하고, 다른 domain 호출은 담당 Wave에 남깁니다.
- `years/{year}/semesters/{semester}` 부모 문서가 없거나 하위 collection 일부만 있는 scope를 완전한 학기로 간주하지 않습니다.
- PHASE 2에서 확인한 Production 2027/2 `point_policies/current` 단일 문서는 삭제하거나 수선하지 않습니다. cutover 전 manifest bootstrap에서 `LEGACY` 또는 `QUARANTINED`로 분류하고 readiness를 다시 실행합니다.
- 과거 학기 물리 이동은 기본값이 아닙니다. 2026-1은 원래 경로에서 동결하고, adapter와 provenance로 읽습니다.

확인된 legacy 접근은 다음 소유 Wave에서 제거합니다.

| 파일·경로 | 현재 위험 | 소유 Wave·제거 조건 |
| --- | --- | --- |
| `src/pages/teacher/ManageLesson.tsx` | scoped lesson/curriculum empty 시 root fallback | W4A에서 silent fallback 차단, W8A에서 명시 adapter로 최종 교체 |
| `src/pages/teacher/ManageMaps.tsx` | scoped map empty 시 root read, write 실패 시 반대 scope write | 반대 scope write는 W4A 즉시 제거, W8A 최종 교체 |
| `src/pages/teacher/ManageHistoryClassroom.tsx` | scoped/root map 병합, assignment root fallback | W4A provenance containment, W8A 최종 교체 |
| `src/pages/teacher/ManageQuiz.tsx`, `QuizBankTab.tsx`, `QuizLogTab.tsx`, `QuizUnitTree.tsx` | scoped curriculum empty 시 root fallback | W4A containment, W6A 평가 schema 전환 때 제거 |
| `src/pages/student/history-classroom/HistoryClassroomRunner.tsx` | semester result write 실패 시 legacy result write | W6A command 전환 때 제거 |
| `functions/legacyPointV1CommandAdapter.js` | legacy config pointer만 active 기준으로 사용 | W7A canonical ledger·resolver 전환 때 제거 |
| `functions/index.js` notification cleanup / HOF scheduler | config pointer를 직접 사용 | W8B / W7A에서 server resolver로 교체 |

## 사용자 정책이 필요한 결정

다음은 W4 구현 전에 확정하거나 안전한 기본값을 유지해야 합니다.

1. Wis 외 성적·출석·알림 등의 보존 기간
2. 과거 자료 접근 범위: 학생 자기기록, 담당 교사, 관리자
3. 승인 roster 파일 형식과 UID 매칭 규칙
4. legacy 귀속 불명 자료의 quarantine 해제 승인자
5. 일반 domain archive correction 절차와 감사 보존 기간

정책 미확정 시 삭제·purge·학생 공개를 활성화하지 않습니다. 보존과 관리자 read-only 검증만 진행합니다.

## W4 금지 사항

- active pointer 직접 변경
- `ARCHIVED` 학기 재활성화
- root/scoped silent fallback
- 과거 데이터를 현재 학기로 복사해 빈 화면을 채우는 처리
- 현재 프로필을 과거 enrollment snapshot에 전파
- archive 원본 update/delete
- Wis 과거 잔액·거래·주문을 새 Economy로 이월
- checksum과 reference 검증 없는 Storage 이동·삭제

## W4 Acceptance Gate

- Archive query는 명시적 semester context를 사용하고 current pointer를 바꾸지 않습니다.
- CURRENT·ARCHIVE·LEGACY 자료가 한 목록에서 출처 없이 섞이는 경우가 0건입니다.
- archive route/list/detail/refresh의 persistent write가 0건입니다.
- 2026-1 원본 count·ID·hash·updateTime이 R0 기준과 일치합니다.
- 학생 identity 1개가 학기별 서로 다른 enrollment를 가질 수 있습니다.
- 2학기 소속 변경 뒤 1학기 조회 결과가 변하지 않습니다.
- Rules에서 archive 일반 write와 Wis value movement가 거부됩니다.
- migration dry-run write 0, 동일 run replay net write 0, resume count 일치를 확인합니다.
- W3 Manifest revision·readiness·active pointer invariant가 그대로 PASS합니다.

## Rollback

Archive/Enrollment migration 전에는 active pointer를 유지하고 target을 `PREPARING` 또는 `QUARANTINED`로 둡니다. 부분 write가 생기면 target 전체를 삭제하지 말고 migration runId와 checkpoint로 resume 또는 보상합니다. `ARCHIVED` 전환 뒤 일반 상태 전환으로 ACTIVE를 복원하지 않으며, 승인된 restore 절차와 새 recovery target을 사용합니다.
