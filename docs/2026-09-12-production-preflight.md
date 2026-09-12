# 운영 읽기 점검과 명부 역할 검증

2026-09-12, checkout `C:/westory-w10p`. 운영 프로젝트 `history-quiz-yongsin`은 읽기 전용으로 확인했습니다. 아래 수량은 조사 시점 값이며 운영 쓰기·백업 생성·배포를 뜻하지 않습니다.

## 확인 결과

- 실제 본사이트는 `westory.kr`에서 `www.westory.kr`로 이동하며 Vercel에서 HTTP 200을 반환합니다. 테스트 사이트는 Firebase Hosting입니다.
- 운영 설정은 2026-1, 학생 점검 모드 enabled=true/revision=3입니다. canonical 학기 포인터·학적·Wis 계좌는 없습니다. 운영 Functions 44개와 Rules는 2026-08-11 배포 상태이며 새 executeCommand는 없습니다.
- 학생 프로필 324개는 모두 학년·반·번호·이름이 있고 번호 중복과 profile 별칭 충돌이 없습니다. 3학년 10개 반입니다. 교사 1개·직원 1개를 학생 명부에 포함하지 않습니다.
- Auth 계정은 732개이며 비활성 계정은 0개입니다. 지갑에 연결되는 users 프로필이 없는 34개는 모두 Auth 계정이 남아 있습니다. 학생 프로필 중 지갑이 없는 3개도 Auth 계정이 있습니다. 자동 삭제·재연결·신규 지급은 하지 않았습니다.
- 같은 Firestore 읽기 전용 transaction으로 지갑 357개·거래 10,228개·주문 83개를 읽었습니다. UID 없는 거래/주문 및 지갑 없는 거래/주문은 0건입니다.
- 기존 `evaluateLegacyWisSource`로 원본을 평가하여 READY 299개/BLOCKED 58개를 확인했습니다. 거래 잔액 연결 불일치 57개, earnedTotal 불일치 1개, 미완료 주문이 있는 지갑 2개이며 서로 겹칩니다. 원본 합계 balance 1,015,580은 거래 재계산 합계와 일치합니다. stored earnedTotal 1,108,480과 computed earnedTotal 1,108,580은 100 차이입니다. 이 결과를 근거로 원본을 자동 수정하지 않습니다.
- 주문 상태는 rejected 34, fulfilled 36, cancelled 11, requested 1, approved 1입니다. 미완료 주문의 업무 판단은 아직 수행하지 않았습니다.
- 실제 Storage 객체는 182개/82,520,348 bytes입니다. 기존 비공개 백업 버킷 `westory-b0-177587430482`는 공개 접근 차단과 30일 retention이 설정되어 있습니다. 최신 백업 객체는 2026-08-07이며 새로운 복원 성공 근거는 아닙니다.
- Firestore는 nam5, PITR 비활성, managed backup 및 schedule 조회 결과는 비어 있습니다. 이미 존재하는 Cloud Storage 수동 백업과 managed backup을 구분합니다.

원본/상세 비식별 hash 기록은 저장소 외 `C:/westory-w10p-provenance-runtime/release-a-*.json`에 있습니다. 개별 학생 이름·UID·거래 원문을 저장소에 커밋하지 않습니다. 이전 `release-a-inventory.json`의 approvalStatuses는 잘못된 nested 필드를 읽었으므로 승인 상태 근거로 사용하지 않습니다. `release-a-financial-audit.json`에서 실제 `registrationApprovalStatus`를 재조회해 기존 326개 모두 해당 필드가 없음을 확인했습니다.

## 이번 코드 수정

명부 `validateRoster`가 teacher만 제외하면서 staff 또는 role이 없는 계정을 학생으로 허용하던 공백을 수정했습니다. `role === "student"`인 실제 프로필만 허용합니다. preview와 실제 import에서 같은 검증을 실행하므로 preview 후 역할이 바뀌어도 저장되지 않습니다.

`functions/scripts/verify-archive-enrollment.cjs`에서 기존 학생 성공, teacher/staff/role 누락의 preview 거부, 유효 preview 후 역할 변경에 대한 실제 Gateway import 거부 및 전체 문서/쓰기 수 불변을 확인했습니다. 해당 검사 22항목 및 `npm --prefix functions run check` 통과. 원격 CI와 Staging 배포의 최종 결과는 같은 runtime 경로의 후속 receipt에 기록합니다.

## 운영 적용 전 남은 실행 조건

1. 프로필이 없는 34개 지갑의 신원 귀속과 3개 빈 지갑 대상, 과거 잔액 연결·100위스 합계 차이·미완료 주문의 처리안을 원본을 보존하면서 확정합니다.
2. 같은 2026-1 학기에서 명부 preview/import로 identity/class/enrollment/slot을 준비할 수 있습니다. 명부는 최대 120명, 계좌는 최대 100명 단위입니다. 미리 초기 지급을 하면 빈 계좌 이전 조건을 깨뜨리므로 지급하지 않습니다.
3. 운영 legacy Wis adapter는 현재 Staging/demo만 허용합니다. 단순히 프로젝트 문자열을 바꿔 실행하지 않습니다. 승인한 대상·원본 hash·revision·금액·재시도·복구 조건을 고정하는 운영 실행 계약을 준비해야 합니다.
4. 경제/계좌 준비와 쓰기 차단 순서를 구분합니다. 일반 Wis 명령도 migration fence가 적용되므로 모든 명령을 막는 시점과 승인된 준비 명령의 허용 경계를 별도로 검증해야 합니다. 점검 모드만으로 교사·trigger·scheduler까지 차단됐다고 보지 않습니다.
5. [운영 전환 준비안](runbooks/2026-09-release-transition.md)의 B 백업과 C 운영 변경 범위를 확정한 뒤 실행합니다. 현재 A 점검은 주요 수량·연결 확인을 마쳤지만, 전체 파일 참조·공개 설정·App Check·최종 복구 조합까지 완료한 것은 아닙니다.

진행률은 기존 79/100 XP를 유지합니다. 수량 조사나 CI 성공을 전체 운영 전환 완료로 계산하지 않습니다.
