# W10 Release Decision Register

작성일: 2026-08-12

기준: `codex/phase6-w10-full-ui-ux-integration`

W9에서 남긴 Release Decision 8개를 현재 코드와 PHASE 4 사용자 결정에 맞춰 정리했습니다. W10에서는 안전한 읽기·미리보기만 유지하고, 공식 저장 계약이 없는 기능은 작동하는 것처럼 표시하지 않습니다.

| ID | 화면·기능 | 분류 | W10 처리 | 다음 조건 |
| --- | --- | --- | --- | --- |
| EX03 | `/teacher/exam` 성적 XLSX 해석·미리보기 | SAFE_CONFIGURABLE_DEFAULT | 브라우저 안에서만 해석하며 `아직 저장되지 않음`을 표시합니다. 영구 write는 0입니다. | W11 Enrollment identity selector |
| EX06 | 성적 XLSX 공식 저장 | USER_DECISION_REQUIRED | 사용할 수 없음으로 표시합니다. fake success는 없습니다. | 공식 Grade import command·receipt와 ALL_OR_NOTHING/ITEMIZED_PARTIAL 정책 |
| DIC01 | 역사사전 단건 등록·수정 | ALREADY_DECIDED | 교사 callable의 요청·수정·삭제 연결과 회수 원장을 검증하고, 편집 초안과 호출 계정을 보호합니다. W9 Draft·Gateway 기능이라고 표시하지 않습니다. | [요청 연결](../w12-history-dictionary-request-binding.md), [편집 복구](../w12-history-dictionary-editor-recovery.md), [삭제 연결](../w13-history-dictionary-delete-binding.md), [수정 연결](../w14-history-dictionary-update-binding.md), Production 전 Gateway·CAS·receipt·보상 출처·배포/알림 migration |
| DIC02 | 역사사전 XLSX 일괄 등록 | ALREADY_DECIDED | 로컬 해석 뒤 Gateway가 최대 200행을 ALL_OR_NOTHING으로 생성하고 동일 요청의 receipt를 재사용합니다. 이전 직접 callable은 쓰기를 거절합니다. | [DIC02 구현·검증 범위](../w12-history-dictionary-import-gateway.md), 실제 교사 XLSX 수용 및 Production 출시 검증 |
| MAP01 | 지도 파일 저장 | USER_DECISION_REQUIRED | 조회 전용·EXPLICITLY_UNAVAILABLE입니다. 업로드·삭제·순서 변경을 숨겼습니다. | checksum·owner·TTL·promote·receipt·Archive fence |
| MAP02 | 지도 태그·지역 편집 | USER_DECISION_REQUIRED | 조회 전용·EXPLICITLY_UNAVAILABLE입니다. 직접 Firestore mutation을 차단했습니다. | W11 map taxonomy와 revision/CAS/provenance 계약 |
| SRC01 | 사료 보관함 업로드·승격 | SAFE_CONFIGURABLE_DEFAULT | immutable 자료 조회만 남기고 등록·업로드·수정·삭제를 닫았습니다. | owner·TTL·receipt·semester/Archive fence를 갖춘 Storage saga |
| PATCH01 | 교사 Patch Memo | ALREADY_DECIDED | PHASE 4 C08 `KEEP` 결정에 따라 기존 owner-scoped 기능을 유지합니다. Gateway·Draft 기능이라고 표시하지 않습니다. | Production 전 W12 DW-052~055 migration |

## Storage 판정

W10 판정은 `EXPLICITLY_UNAVAILABLE`입니다. 지도와 사료 보관함에는 W9 공통 private asset staging 계약을 충족하는 완결된 업로드 경로가 없습니다. W10 UI는 저장 성공을 가장하지 않으며, Firestore·Storage Rules는 이전 번들의 직접 mutation도 거부합니다. Production Storage를 대체 경로로 사용하지 않았습니다.

## W11 전 필수 결정

EX06, MAP01, MAP02, SRC01을 다시 활성화하려면 W11 master data와 서버 저장 계약이 먼저 필요합니다. 다만 이 네 기능의 비활성 상태는 W11 shadow validation 진입을 막지 않습니다. 실제 운영 출시 범위에 포함한다면 Production 승격 전 Release blocker로 처리합니다.
