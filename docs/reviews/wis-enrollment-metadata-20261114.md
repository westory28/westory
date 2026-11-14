# 위스 계좌 학적 메타 점검 — 2026-11-14

## 운영 읽기 감사

`output/wis-account-roster-audit.cjs`를 운영 `history-quiz-yongsin`에 읽기 전용 트랜잭션으로 실행했습니다. 현재 학기 `2026-2`의 계좌 324개 모두 ACTIVE이며, 현재 slot → ACTIVE enrollment → ACTIVE class 연결이 정상입니다.

- `enrollmentId`, `classId`, `grade`, `classNumber`, `studentNumber`, `displayName` 불일치: 0개
- 위 필드 문자열 타입 불일치: 0개
- enrollment snapshot와 현재 class 학년·반 불일치: 0개
- 문서 읽기: 983회, 쓰기: 0회
- 이름·UID·문서 경로·개별 금액·자격 증명 출력/파일 저장: 없음
- 계좌 2,000개 안전 한도를 넘으면 결과를 부분 집계하지 않고 실패합니다.

운영 기존 데이터의 보정은 수행하지 않았으며 이번 감사에서 필요하지 않았습니다.

## 확인한 작성 경로와 수정 범위

| 경로 | 동작 | 운영 진입 함수 |
| --- | --- | --- |
| `wisEconomy.js`의 `CREATE_WIS_ACCOUNTS` | 계좌 최초 생성 및 명시적 기존 메타 동기화 | `executeCommand` |
| `studentRegistrationApproval.js`의 `PREPARE_ACCOUNT` | 위 생성 adapter 재사용 | `executeCommand` |
| `studentEnrollmentProfile.js` | 최신 교사 명단 수정·반 이동에서 이미 3투영 메타 동기화 | `executeCommand` |
| `archiveEnrollment.js`의 `MOVE_ENROLLMENT` | 저수준 관리자 이동에서 빠져 있던 메타 동기화 추가 | `executeCommand` |
| 같은 파일의 ACTIVE `UPSERT_ENROLLMENT`, `IMPORT_ENROLLMENT_ROSTER` | 닫힌 slot 재등록으로 새 enrollment를 만드는 경우 기존 계좌 메타 동기화 추가 | `executeCommand` |

`wisEconomyQuery.js`에도 과거 명령 adapter 코드가 복제되어 있지만 현재 명령 closure는 `wisEconomy.js`를 사용합니다. 출석·게임·학습 보상·아바타·교사 지급·기존 자료 이전은 금액과 순위 투영을 쓰며 계좌의 학급 메타 작성 경로는 아닙니다. 미리보기 인덱스와 프로필 이모지 reconciliation도 계좌 학급을 작성하지 않습니다.

저수준 학적 명령은 `commandGateway`에 등록되고 `productionSource`가 adapter를 연결합니다. 기존 관리자 이메일 권한과 고위험 세션 검사를 유지했습니다. 일반 교사 UI는 별도 `updateStudentEnrollmentProfile` 경로를 사용합니다. 빠른 위스 거래 엔드포인트는 학적·계좌생성 명령을 허용하지 않습니다.

신규 공통 helper는 해당 세 경로에서만 사용합니다. 기존 account/balance/ranking이 모두 없으면 학적 작업만 수행합니다. 일부 투영 누락, 계정·학생·학기 불일치, 금액 정수/범위 오류 또는 투영 금액·ledger revision 불일치는 쓰기 전에 전체 작업을 거부합니다. 유효한 세 투영에는 학적 6필드와 수정자/시각만 merge합니다. 변경 없는 메타는 저장하지 않습니다. 금액, 모든 지갑 revision, ledger, economy는 그대로 보존합니다.

ACTIVE가 아닌 UPSERT/IMPORT는 원래 동작과 cutover 영수증 경계를 보존하며 추가 위스 조회·쓰기가 없습니다. `CLOSE_ENROLLMENT`의 계좌 상태·메타·금액은 변경하지 않았습니다. 비활성 학생의 현황 페이지 제외 처리는 별도 조회 패치에서 수행합니다.

## 검증

`node --test functions/scripts/verify-wis-enrollment-metadata.cjs`: 10개 그룹 통과.

- 실제 command parser, adapter, 트랜잭션, 영수증을 이용한 이동 및 재등록
- 이동 전후 실제 순위 및 현황의 서버 학급 필터
- 비메타 필드 전체 보존 및 ledger/economy 불변
- 동일 command 재시도·동시 중복, stale enrollment 거부
- 관리자 권한과 고위험 세션 유지
- 계좌 없는 학생, 일부 투영 누락 및 오염의 원자적 실패
- PREPARING UPSERT/IMPORT에서 위스 추가 읽기·쓰기 0회 및 기존 영수증 경계
- 최대 120명 재등록에서 위스 투영 360문서 읽기를 한 batch로 수행하고 메타 360문서만 기록
- 같은 import를 다른 command ID로 재요청해도 위스 메타 읽기·쓰기 0회

추가 통과: `scripts/verify-student-profile-commands.mjs`, `scripts/verify-semester-archive.mjs`, archive/cutover 서버 모듈 문법 검사, diff 공백 검사. 운영 데이터 쓰기, 커밋·푸시·배포는 하위 에이전트에서 수행하지 않았습니다.

Firestore의 종전 트랜잭션 500회 쓰기 제한은 2023-03-29 제거되었습니다. 기존 120명·750KB 명령 입력 제한을 유지했으며 별도 인원 제한은 추가하지 않았습니다. [공식 변경 기록](https://docs.cloud.google.com/firestore/docs/release-notes)

이 추가 변경의 운영 배포 대상은 `executeCommand` 하나입니다. 부모 에이전트에서 소스 manifest 해시를 갱신하고 전체 회귀/배포를 수행해야 합니다.
