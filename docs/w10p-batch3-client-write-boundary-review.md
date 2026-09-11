# Batch3 client direct-write 경계 검토

검토일: 2026-09-11. 범위는 현재 `src/` 호출 구조와 기존 정적 정책입니다. 운영 배포·실사용자 API 호출·브라우저 QA를 수행한 증거는 아닙니다.

## 정책 변경

`scripts/client-direct-write-allowlist.json`의 승인 그룹 수 143을 유지했습니다. 기존 역사 사전 callable 8개(DW-014/015/016/017/018/020/021/022)를 제거하고, 같은 명령명의 명시적 Gateway 호출 8개(DW-236~243)를 등록했습니다. 각 호출은 `src/lib/historyDictionary.ts::sendDictionaryPending#1`에 위치하며 rootCount=1, trigger=USER_EVENT입니다. 재시도는 두 포털의 ‘이전 요청 결과 확인’ 버튼에서 시작합니다.

| 명령 | 기존 ID → 새 ID | 실제 최초 사용자 동작 | client 위험 분류 |
| --- | --- | --- | --- |
| approveHistoryDictionaryTermForRequests | DW-014 → DW-236 | 교사 handleApproveExisting 승인 버튼 | HIGH |
| deleteStudentHistoryDictionaryWord | DW-015 → DW-237 | 학생 handleDelete 확인 후 삭제 | LOW |
| deleteStudentHistoryDictionaryWordByTeacher | DW-016 → DW-238 | 교사 handleDeleteStudentWord / handleRejectRequestWord 확인 후 삭제·거절 | HIGH |
| requestHistoryDictionaryTerm | DW-017 → DW-239 | 학생 handleRequest 안내 동의 후 요청 버튼 | LOW |
| saveHistoryDictionaryTerm | DW-018 → DW-240 | 교사 handleSaveTerm 저장 버튼 | HIGH |
| saveStudentHistoryDictionaryEntry | DW-020 → DW-241 | 학생 handleSave 저장 버튼 | LOW |
| saveStudentHistoryDictionaryWord | DW-021 → DW-242 | 학생 handleSaveTeacherTerm 뜻풀이 저장 버튼 | LOW |
| updateStudentHistoryDictionaryWordByTeacher | DW-022 → DW-243 | 교사 handleSaveStudentWord 저장 버튼 | HIGH |

호출은 각 handler → 기존 명령별 wrapper → runDictionaryMutation → sendDictionaryPending → executeWestoryCommand 순서입니다. 최초 사용자 UID를 명령 준비 전과 전송 직전에 검사하고, 재시도에도 원래 commandType/payload/expectedUid를 전달합니다. 상태 구독은 표시를 갱신하며 자동 재전송을 시작하지 않습니다. 사용자 명시적 재시도 외에 listener·mount·timer·render·unmount에서 이 8개 명령을 시작하는 경로는 정적 분석에서 발견되지 않았습니다.

최초 분석에서는 Map에서 읽은 `pending.commandType`을 해석하지 못해 UNKNOWN이 1건 발생했습니다. Root가 같은 함수 안에서 8개 literal command 분기로 변경했고, 동적 명령을 정책 예외로 허용하지 않았습니다. analyzer는 수정하지 않았습니다.

기존 135개 잔존 그룹 중 DW-007의 호출 그래프 지문만 `d60f24d8e575fe4aaab2c136`에서 `6b9cea2927ed1a9d50081441`로 변경했습니다. 새 명령별 Gateway 호출 edge와 사전 사용자 handler/재시도 경로가 공통 executeCommand 호출의 역방향 그래프에 합류한 결과입니다. DW-007 rootCount=1과 TIMER/USER_EVENT 분류는 유지했습니다. TIMER 예외는 기존 W9 saveTeacherDraft 규칙 그대로이며 새 사전 Gateway 호출에는 적용되지 않습니다. 나머지 134개 그룹의 지문·rootCount·trigger는 그대로입니다.

## 변경하지 않은 정책과 표시 경로

- `scripts/verify-client-direct-write-boundary.mjs`의 UNKNOWN 거절, Gateway 금지 trigger, 파일 전송의 정확한 owner 조건을 유지했습니다.
- `scripts/w2-high-risk-command-manifest.json`은 기존 28개 이관 명령의 고정 inventory입니다. 임의로 신규 사전 명령이나 migrateLegacyWisAccount를 추가하지 않았으며 C16 deleteSourceArchiveAsset의 GATEWAY 분류를 유지했습니다. 실제 신규 명령 위험 분류는 `src/lib/highRiskCommands.ts`에서 확인했습니다.
- 구매 메모는 학생 Points의 기존 구매 버튼 → requestLegacyStudentWisPurchase → placeWisOrder 경로에서 payload로 전달됩니다. 새 write 경계를 추가하지 않습니다.
- LEGACY_RECLAIM의 history_dictionary_reclaim 표시는 기존 원장 조회 projection을 매핑하는 순수 표시 분기입니다. 명령 재전송이나 새로운 write 경계를 추가하지 않습니다.
- callGraphHash는 TypeScript 호출 edge와 event seed의 지문입니다. 서버 implementation hash를 포함하지 않으므로 진행 중인 `functions/index.js` 수정의 최종 해시를 승인한 문서가 아닙니다. 이후 frontend 함수 이동·호출 변경은 gate를 다시 실행해야 합니다.

## 검증

- `node scripts/test-client-direct-write-boundary.mjs`: 기존 17개 fixture 그룹 PASS. 동적 callable UNKNOWN, effect 거절, callback 전달, 사용자 event 뒤 deferred effect 거절, transport owner 제한, stale/expiry/duplicate policy 및 28개 manifest 계약을 포함합니다.
- `node scripts/verify-client-direct-write-boundary.mjs`: PASS. approvedBoundaryGroups=143, queryCallableFactories=14, fetches=3, commandInventory=28, unknown=0.
- `git diff --check` 및 정책 diff 검토: PASS. 정책은 기존 callable 8개 제거, Gateway 8개 등록, DW-007 지문 1개 변경만 포함합니다.
- 모든 Node 검사는 Idle 우선순위·단일 CPU affinity로 실행했습니다. analyzer·앱·서버 파일은 이 작업에서 수정하지 않았습니다.
