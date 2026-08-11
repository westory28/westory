# W7 Wis Economy — Grade & Evidence Handoff

## 목적

이 문서는 W6B의 공식 성적 근거를 W7 위스 경제와 안전하게 연결하기 위한 계약입니다. Grade와 Economy는 서로 다른 domain입니다. W7은 성적 문서를 잔액처럼 사용하거나 보상 완료 표시를 위해 수정하지 않습니다.

## W6B source of truth

| 성격         | 경로                                          | W7 사용 방식                        |
| ------------ | --------------------------------------------- | ----------------------------------- |
| 성적 head    | `semester_grade_records/{recordId}`           | 현재 version/status 확인            |
| 성적 version | `semester_grade_versions/{versionId}`         | 불변 보상 근거                      |
| 요청         | `semester_grade_requests/{requestId}`         | 보상 source로 사용하지 않음         |
| 확인·서명    | `semester_grade_attestations/{attestationId}` | 정책상 필요할 때만 eligibility 확인 |
| W6A 제출     | Attempt/Submission/Result                     | Grade version을 거쳐 간접 참조      |

Economy Ledger entry가 Grade 보상에서 보존해야 할 최소 source는 다음과 같습니다.

- `recordId`
- `versionId`
- `gradeRevision`
- `evidenceHash`
- `semesterId`
- `studentUid`
- `enrollmentId`
- 보상 policy/version
- source command/receipt

학생 이름, 현재 학년·반, 화면에 보이는 점수 문자열을 join key로 쓰지 마십시오.

## 보상 eligibility

W7에서 성적 연계 보상을 구현한다면 다음 조건을 서버에서 다시 확인해야 합니다.

- Grade와 Economy의 `semesterId` 일치
- Grade source Enrollment와 Economy Account의 student 일치
- Grade status가 정책이 허용하는 official 상태
- source version/evidence hash가 head의 현재 official pointer와 일치
- Archive grade와 Archive Economy는 write 금지
- Legacy grade는 승인된 migration evidence 없이 자동 보상 금지
- correction 뒤 새 version을 자동 중복 보상하지 않도록 정책을 명시

현재 W6B의 signed final status는 `OFFICIAL`입니다. `OFFICIAL_PENDING_SIGNATURE`를 보상 대상으로 볼지는 W7 정책으로 정하되, 기본값은 서명 완료 뒤 지급입니다.

## Exactly-once reward

성적 보상 Ledger reference는 결정적으로 만드십시오. 예시는 다음과 같습니다.

`GRADE_REWARD:{semesterId}:{recordId}:{versionId}:{policyVersion}`

같은 reference의 active Ledger entry는 최대 한 개여야 합니다. command retry, 응답 유실, 여러 기기 동시 요청에서도 receipt replay로 같은 entry를 반환해야 합니다. Grade record에 `rewarded=true` 같은 필드를 추가하면 안 됩니다.

정정 version 정책은 둘 중 하나를 명시적으로 선택해야 합니다.

- 기존 보상을 유지하고 새 version은 차액 correction/reversal entry만 생성
- 기존 보상을 reversal한 뒤 새 version 기준으로 다시 지급

어느 정책이든 과거 Ledger entry의 amount를 직접 바꾸지 않습니다.

## 학기 경계

Grade와 Wis는 모두 semester scope를 사용하지만 데이터는 복사하지 않습니다.

- 2026-1 Grade는 2026-1 Economy의 read-only source일 뿐입니다.
- 2026-1 reward entry를 2026-2 Ledger로 복제하지 않습니다.
- 2026-2 Account는 0에서 시작합니다.
- initial grant는 Grade와 무관한 별도 `semester_initial_grant` source입니다.
- CURRENT가 비었다고 ARCHIVE나 LEGACY Grade를 silent fallback하지 않습니다.

## Readiness 연결

W7 readiness는 Grade collection 전체를 매번 scan하지 마십시오. 성적 보상 dependency가 필요하면 다음 작은 root를 사용하십시오.

- Grade reconciliation/control revision
- Economy policy revision
- 마지막 reward reconciliation report
- captured grade version/evidence hash 집합의 결정적 hash

Grade dependency가 달라지면 Economy reconciliation 또는 readiness가 STALE이 되어야 합니다. Grade가 선택 기능인 학기에는 성적이 없다는 이유만으로 Economy readiness를 실패시키지 않습니다.

## Client 경계

- 학생 Grade 화면에서 Wis Ledger를 직접 쓰지 않습니다.
- 교사 Grade 확정 버튼에 숨은 reward write를 넣지 않습니다.
- 보상은 명시적 W7 command 또는 문서화된 server workflow로 실행합니다.
- Balance와 ranking은 Grade 점수를 직접 합산하지 않고 Ledger projection만 사용합니다.
- Grade query projection에 Economy 내부 receipt나 balance를 섞지 않습니다.

## W7 acceptance test

- 같은 Grade version 보상 effect 1회
- response loss 뒤 같은 Ledger entry/receipt 복구
- correction version의 차액/reversal 정책 재현
- 다른 semester·student·Enrollment source 거부
- `OFFICIAL_PENDING_SIGNATURE` 정책 경계 검증
- Archive·Legacy source write 0
- Grade record/version/attestation hash 불변
- 2026-1 reward의 2026-2 복제 0
- old bundle·direct SDK 보상 write 거부
- W6A·W6B aggregate 회귀와 TypeScript 신규 오류 0

## W7에서 하지 말아야 할 일

- Grade head나 version에 잔액·지급 완료 필드 추가
- 성적 점수를 Account balance로 직접 사용
- 정정 때 기존 Ledger amount 수정
- 화면 mount·reload에서 자동 지급 또는 projection repair
- current profile 학급으로 과거 Grade와 Account 재결합
- W8 일정·알림, W9 bulk draft, 실제 투자 기능까지 범위 확장
