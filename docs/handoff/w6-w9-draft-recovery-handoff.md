# W6–W9 교사 Draft Recovery 인계

## 1. 목적과 판정

이 문서는 W1-R2에서 구현하지 않은 교사 편집 복구를 Domain Wave와 W9에 안전하게 넘기기 위한 작업 계약입니다. 현재 상태는 **0/51 미구현**이며, 인벤토리 작성만으로 완료 처리하지 않습니다. 공통 repository, Rules, UI adapter, 복구 E2E가 모두 통과하기 전에는 Production 승격을 막습니다.

상위 보고서의 51개 집계는 영역별 수만 남아 있고 개별 ID 목록은 없었습니다. 아래 표는 현재 canonical route 13개, 실제 modal/component, 상위 보고서의 영역별 합계에 맞춰 부여한 안정적인 인계 ID입니다. `추가 확인` 항목은 Domain Wave 시작 전에 실제 command 경계와 중복 surface 여부를 다시 확인해야 하며, 확인 전에는 자동 저장 대상이라고 단정하지 않습니다.

분류 원칙은 다음과 같습니다.

- **Domain Wave**: W6A/B, W7A/B, W8A/B가 canonical schema와 command를 먼저 확정하고 해당 draft adapter를 소유합니다.
- **W9**: 공통 repository/UI, Work Queue·Target Context, 학생 관리·설정·공통 메모처럼 특정 Domain Wave에 속하지 않는 adapter를 소유합니다.
- **draft 불필요**: 입력 상태가 없는 단일 command입니다. 명시적 확인, target/source revision 재검증, operation key는 필요하지만 draft를 저장하지 않습니다.
- **command-review**: 입력은 복구할 수 있지만 복구 직후 command를 자동 실행하지 않습니다. 대상·capability·source revision을 다시 읽고 교사가 다시 확인해야 합니다.
- **추가 확인**: 현재 코드가 한 component에서 여러 의미의 저장을 처리하거나, 상위 51개 집계와 실제 handler 경계를 일대일로 대조할 수 없는 경우입니다.

## 2. 51개 surface 분류

### Dashboard — 4

| ID  | 편집·명령 surface        | 이관         | Draft 판정                                     |
| --- | ------------------------ | ------------ | ---------------------------------------------- |
| D01 | 알림장 신규 작성·첨부    | W8B          | standard + private asset staging               |
| D02 | 알림장 수정·첨부 교체    | W8B          | standard + D01 asset adapter 재사용            |
| D03 | 알림장 순서 변경         | draft 불필요 | 명시적 reorder command, expected revision 필요 |
| D04 | Dashboard 일정 작성·수정 | W8B          | standard; Schedule route와 entity key 공유     |

### 학생 관리 — 2

| ID    | 편집·명령 surface | 이관 | Draft 판정                                       |
| ----- | ----------------- | ---- | ------------------------------------------------ |
| STU01 | 학생 프로필 수정  | W9   | standard; enrollment identity version과 분리     |
| STU02 | 반 이동           | W9   | command-review; 복구 뒤 학생·출발/도착 반 재검증 |

### Quiz — 3

| ID  | 편집·명령 surface   | 이관 | Draft 판정                                                 |
| --- | ------------------- | ---- | ---------------------------------------------------------- |
| Q01 | 문제 등록·수정      | W6A  | standard + private asset staging                           |
| Q02 | 평가 상세·응시 설정 | W6A  | standard; publish/active attempt와 base revision 충돌 검사 |
| Q03 | 문제 은행 문항 수정 | W6A  | standard + private asset staging; Q01 schema 공유          |

### History Classroom — 4

| ID   | 편집·명령 surface   | 이관            | Draft 판정                                           |
| ---- | ------------------- | --------------- | ---------------------------------------------------- |
| HC01 | 과제 등록·설정 수정 | W6A             | standard; 배정 대상 preview 필요                     |
| HC02 | 지도·빈칸·정답 편집 | W6A             | standard; map asset는 immutable reference로만 보관   |
| HC03 | 면제 부여·해제      | W6A             | command-review; 자동 실행 금지                       |
| HC04 | 제출 결과 승인·반려 | 추가 확인 → W6A | 사유 입력은 복구 가능하나 상태 전이는 명시적 command |

### Exam / Score — 8

| ID   | 편집·명령 surface                      | 이관            | Draft 판정                                                |
| ---- | -------------------------------------- | --------------- | --------------------------------------------------------- |
| EX01 | 평가 반영 비율·grading plan            | W6B             | standard; 합계·기준 version 검증                          |
| EX02 | 정기시험 OMR 답안 설정                 | W6B             | standard                                                  |
| EX03 | 수행평가 XLSX 업로드·매핑 preview      | W6B             | standard + private asset/parsed-row staging               |
| EX04 | 수행평가 학생별 점수·근거 수정         | W6B             | standard; score roster base revision 필수                 |
| EX05 | 점수 확인 경고 문구                    | W6B             | standard                                                  |
| EX06 | 서답형·논술형 XLSX 업로드·매핑 preview | W6B             | standard + private asset/parsed-row staging               |
| EX07 | 서답형·논술형 학생별 점수·근거 수정    | W6B             | standard; 서명 반려 결과 preview 필요                     |
| EX08 | 점수 이의 수용·반려 사유               | 추가 확인 → W6B | 입력 복구 후 score/result revision 재검증, 자동 처리 금지 |

### Settings — 9

| ID    | 편집·명령 surface         | 이관           | Draft 판정                                              |
| ----- | ------------------------- | -------------- | ------------------------------------------------------- |
| SET01 | 기본 운영 환경 설정       | W9             | standard                                                |
| SET02 | 학교·학년·학급 구조 설정  | W9             | standard; 구조 변경 preview 필요                        |
| SET03 | 학기 shell 생성·활성화    | 추가 확인 → W9 | command-review; high-risk step-up과 readiness gate 필수 |
| SET04 | 인터페이스 테마·표시 설정 | W9             | standard                                                |
| SET05 | 메뉴 노출·순서 설정       | W9             | standard; capability와 별개임을 유지                    |
| SET06 | 세부 권한 변경            | 추가 확인 → W9 | command-review; recent-auth와 대상 권한 재조회 필수     |
| SET07 | 알림 정책·template        | W8B            | standard; preview/publish version 분리                  |
| SET08 | 약관·개인정보 본문        | W9             | standard; draft/publish 분리                            |
| SET09 | 동의 항목 추가·게시       | W9             | command-review; append-only version publish             |

### Wis — 10

| ID    | 편집·명령 surface            | 이관 | Draft 판정                                            |
| ----- | ---------------------------- | ---- | ----------------------------------------------------- |
| WIS01 | 위스 지급·환수               | W7A  | command-review; ledger command 자동 실행 금지         |
| WIS02 | 운영 정책                    | W7A  | standard; Economy lifecycle version과 결합            |
| WIS03 | 등급 tier 편집               | W7A  | standard                                              |
| WIS04 | 등급 theme·emoji 설정        | W7A  | standard                                              |
| WIS05 | 화랑의 전당 배치             | W7A  | standard                                              |
| WIS06 | 화랑의 전당 인정·이미지 설정 | W7A  | standard + private asset staging                      |
| WIS07 | 상품 metadata·가격 설정      | W7B  | standard                                              |
| WIS08 | 상품 이미지·재고·offering    | W7B  | standard + private asset staging                      |
| WIS09 | 주문 상태·메모               | W7B  | command-review; order/inventory 상태 재검증           |
| WIS10 | 거래 조정·취소               | W7A  | command-review; latest transaction·ledger 상태 재검증 |

### Schedule — 1

| ID    | 편집·명령 surface           | 이관            | Draft 판정                                                      |
| ----- | --------------------------- | --------------- | --------------------------------------------------------------- |
| SCH01 | 일정 route의 일정 작성·수정 | 추가 확인 → W8B | D04와 같은 entity adapter를 재사용하고 이중 draft를 만들지 않음 |

### Lesson — 2

| ID    | 편집·명령 surface                         | 이관 | Draft 판정                                       |
| ----- | ----------------------------------------- | ---- | ------------------------------------------------ |
| LES01 | 수업 본문·metadata 편집                   | W8A  | standard                                         |
| LES02 | PDF·worksheet segment·빈칸·판서 기반 편집 | W8A  | standard + private asset staging; mode 경계 보존 |

### Dictionary — 2

| ID    | 편집·명령 surface             | 이관 | Draft 판정                                                       |
| ----- | ----------------------------- | ---- | ---------------------------------------------------------------- |
| DIC01 | 용어·정의 편집                | W8A  | standard                                                         |
| DIC02 | XLSX 일괄 입력·공식 풀이 반영 | W8A  | standard + private asset/parsed-row staging; review command 분리 |

### Maps — 3

| ID    | 편집·명령 surface              | 이관 | Draft 판정                                 |
| ----- | ------------------------------ | ---- | ------------------------------------------ |
| MAP01 | 지도 PDF/image·metadata 업로드 | W8A  | standard + private asset staging           |
| MAP02 | 지도 tag·region 편집           | W8A  | standard                                   |
| MAP03 | 지도 tab 이름·순서 변경        | W8A  | command-review; source tab revision 재검증 |

### Source Archive — 1

| ID    | 편집·명령 surface       | 이관 | Draft 판정                       |
| ----- | ----------------------- | ---- | -------------------------------- |
| SRC01 | 사료 파일·metadata 편집 | W8A  | standard + private asset staging |

### Think Cloud — 1

| ID      | 편집·명령 surface   | 이관 | Draft 판정                    |
| ------- | ------------------- | ---- | ----------------------------- |
| THINK01 | 질문·공개 범위 설정 | W8A  | standard; publish 상태와 분리 |

### 공통 Patch Memo — 1

| ID      | 편집·명령 surface        | 이관 | Draft 판정                                   |
| ------- | ------------------------ | ---- | -------------------------------------------- |
| PATCH01 | 공통 패치 메모 작성·수정 | W9   | standard; route 이동에도 같은 draft key 유지 |

검산: `4+2+3+4+8+9+10+1+2+2+3+1+1+1 = 51`입니다.

## 3. 대용량·파일 staging 경계

상위 보고서의 “11개 file/blob/base64/대용량 parsed rows surface”는 개별 ID 근거가 남아 있지 않습니다. 현재 코드에서 확인되는 11개 adapter 묶음은 `NoticeModal`, `QuizEditor`, `QuizBankTab`, 수행평가 upload, 서답형·논술형 upload, Lesson editor, Dictionary XLSX, Maps upload, Source Archive upload, Hall of Fame image, Product image입니다. create/edit 또는 두 route가 같은 adapter를 재사용하므로 51개 행과 단순 일대일로 세지 않습니다.

이 11개는 Firestore draft payload에 file, data URL, base64, 전체 parsed rows를 직접 넣지 않습니다. private staging은 다음 조건을 모두 만족해야 합니다.

- auth UID와 opaque upload ID로 경로를 분리하고 public URL을 만들지 않습니다.
- MIME, byte size, checksum, source file name, created/expiry timestamp만 draft에 둡니다.
- canonical command가 checksum과 ownership을 다시 검사하고 idempotent promote를 수행합니다.
- discard·TTL cleanup은 canonical asset을 삭제하지 않습니다.
- TTL 기간과 개인정보 보존 기간은 임의로 정하지 않고 W5/운영 승인으로 확정합니다.

## 4. 공통 Draft Contract

```ts
type TeacherDraftKey = {
  routeKey: string;
  surfaceKey: string;
  entityType: string;
  entityId: string | "new";
  clientDraftId: string;
  year?: number;
  semester?: number;
};

type TeacherDraft<TPayload> = {
  schemaVersion: number;
  key: TeacherDraftKey;
  baseEntityRevision: number | null;
  draftRevision: number;
  payload: TPayload;
  payloadHash: string;
  stagedAssets: Array<{ uploadId: string; checksum: string }>;
  status: "active" | "conflict" | "discarded";
  createdAt: unknown; // server timestamp
  updatedAt: unknown; // server timestamp
  expiresAt: unknown; // approved retention policy
};

interface TeacherDraftRepository<TPayload> {
  get(key: TeacherDraftKey): Promise<TeacherDraft<TPayload> | null>;
  listRecoverable(routeKey: string): Promise<Array<TeacherDraft<TPayload>>>;
  save(input: {
    key: TeacherDraftKey;
    expectedDraftRevision: number | null;
    baseEntityRevision: number | null;
    operationId: string;
    payload: TPayload;
  }): Promise<TeacherDraft<TPayload>>;
  discard(input: {
    key: TeacherDraftKey;
    expectedDraftRevision: number;
    operationId: string;
  }): Promise<void>;
}
```

서버는 authenticated UID를 path owner로 강제하며 client payload의 UID를 신뢰하지 않습니다. 저장은 server timestamp, revision CAS, operation receipt를 사용합니다. direct create/update/delete를 허용한다면 Rules가 동일 조건을 완전히 표현해야 하지만, 현재 application session/receipt 계약과 맞추기 위해 callable repository를 기본안으로 둡니다.

UI adapter의 공통 상태는 `clean → dirty → saving → saved`와 `offline`, `conflict`, `error`, `recoverable`을 구분합니다. debounce 중 route 변경·세션 경고가 발생해도 입력을 메모리에 보존하고, pagehide/unmount를 business command 실행 신호로 사용하지 않습니다. 재로그인 뒤 동일 UID만 `복구`, `폐기`, `새로 시작`을 선택할 수 있습니다. 다른 UID draft의 단건 read, query, subscription은 모두 0이어야 합니다.

canonical 저장은 Domain Wave command가 `baseEntityRevision`, `operationId`, draft payload hash를 받아 검증합니다. 성공 receipt를 받은 뒤에만 draft를 정리합니다. 응답 유실 시 operation receipt와 canonical entity를 먼저 조회하며 같은 command를 새 ID로 재실행하지 않습니다. command-review 복구는 target/capability/source revision preview까지만 수행하고 자동 submit하지 않습니다.

## 5. 구현 순서와 소유권

1. W6A/B, W7A/B, W8A/B는 canonical command와 entity revision을 먼저 확정합니다.
2. 공통 draft repository/Rules와 asset staging을 한 번 구현하고, 각 Domain Wave가 자기 adapter를 붙입니다.
3. W9는 남은 STU/SET/PATCH adapter, 공통 recovery center, Work Queue·Target Context를 연결합니다.
4. `추가 확인` 6건(HC04, EX08, SET03, SET06, SCH01 및 11개 asset 일대일 mapping)을 해결하고 51개 manifest를 고정합니다.
5. W10은 5폭·keyboard·permission·archive state 전체 journey만 통합 검증하며, W10에서 누락 adapter를 새로 설계하지 않습니다.

## 6. Blocking 테스트와 증거

| Gate                | PASS 기준                                                                                        |
| ------------------- | ------------------------------------------------------------------------------------------------ |
| Manifest            | 51개 ID가 정확히 한 owner와 adapter에 매핑되고 누락·중복 0                                       |
| Repository CAS      | 두 탭 동일 revision save에서 1개만 성공, stale overwrite 0                                       |
| Idempotency         | 응답 유실·동일 operation retry에서 draft revision 증가와 canonical effect 각각 최대 1            |
| Session recovery    | 30분 일반/15분 고위험/5분 경고 뒤 동일 UID 복구, 다른 UID read/query/subscription 0              |
| Canonical isolation | draft save·restore·discard만으로 canonical domain document mutation 0                            |
| Command review      | 복구 직후 반 이동·면제·학기 shell·위스 지급·주문·거래 조정·지도 tab rename 자동 실행 0           |
| Asset staging       | 11개 adapter에서 private owner-only, checksum 검증, TTL cleanup, canonical asset 오삭제 0        |
| Responsive          | 390/768에서 상태·차단 이유·복구·`PC에서 계속`; 1024/1280/1600에서 저장 완료, document overflow 0 |
| Accessibility       | keyboard focus 복귀, 상태 `aria-live`, dialog label, error와 recovery action 명확                |
| Regression          | 기존 domain static/emulator test, `npm run build`, 관련 Functions check 모두 PASS                |

각 E2E evidence에는 `surfaceId`, role, UID alias, viewport, base/draft revision, operation ID hash, network/clock condition, query/write count, canonical before/after hash를 남깁니다. 실제 계정·token·첨부 원본과 Production 데이터는 evidence에 넣지 않습니다.

## 7. 근거 파일

- 라우트: `src/App.tsx:290-387`, `src/constants/menus.ts:74-124`
- Dashboard modal: `src/pages/teacher/Dashboard.tsx`, `src/pages/teacher/components/NoticeModal.tsx`, `src/pages/teacher/components/EventModal.tsx`
- 평가·성적: `src/pages/teacher/components/QuizEditor.tsx`, `QuizSettingsModal.tsx`, `QuizBankTab.tsx`, `src/pages/teacher/ManageHistoryClassroom.tsx`, `src/pages/teacher/components/PerformanceScoreManager.tsx`
- 설정·위스: `src/pages/teacher/Settings.tsx`, `src/pages/teacher/components/Settings*.tsx`, `src/pages/teacher/ManagePoints.tsx`, `src/pages/teacher/components/points/*.tsx`
- 학습·지식: `src/pages/teacher/ManageLesson.tsx`, `ManageHistoryDictionary.tsx`, `ManageMaps.tsx`, `ManageSourceArchive.tsx`, `ManageThinkCloud.tsx`
- 상위 집계와 미완료 판정: `docs/phase-6-w1r-session-recovery-contract-2026-08-09.md:120-157`
- Wave 소유·게이트: `docs/phase-5-patch-readiness-release-plan-2026-08-07.md:650-661`
