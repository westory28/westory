# 역사사전 요청과 풀이의 연결 검증

사전의 단건 저장 DIC01은 전역 단어 저장, 학생 요청·단어장 처리, 알림을 나누어 실행합니다. 이 전체 경로의 Gateway·revision/CAS 이전에 앞서, 잘못된 요청을 다른 단어·학생·학기의 풀이와 연결하는 문제를 서버에서 차단합니다.

## 이번 변경

- 명시한 요청의 정규화된 단어·학기와 승인 대상이 일치해야 처리하며, 학생 UID는 유효한 단일 경로 ID여야 합니다. fallback에 지정한 학생 UID도 요청의 UID와 같아야 합니다. 경로 구분자가 섞인 ID와 불완전한 fallback ID/UID 쌍은 거절합니다.
- 기존 fallback 요청도 transaction에서 먼저 읽습니다. 다른 학생·단어·학기의 요청을 덮어쓰지 않으며, 승인할 때 이름·학년·반·번호·메모·생성 시각은 보존합니다. 이미 거절되거나 닫힌 요청을 다시 승인 상태로 바꾸지 않습니다.
- 기존 학생 단어장에 UID·단어 ID·정규화된 단어·학기·요청 ID가 기록돼 있으면 승인 대상과 모두 일치해야 합니다. 더 최신 학기나 다른 요청으로 바뀐 단어장을 이전 요청으로 덮어쓰지 않습니다. 해당 필드가 없는 legacy 단어장은 기존 경로와 요청의 결합을 사용합니다.
- 같은 대상으로 처리 완료된 요청의 재시도는 쓰기 없이 끝납니다. 처리 완료된 fallback으로 단건 저장을 재시도해도 이후 수정된 전역 단어·학생 단어장·알림을 다시 쓰지 않습니다. fallback 없는 일반 단건 저장 전체가 멱등적으로 바뀐 것은 아닙니다.
- 요청 문서가 없으면 요청 ID가 학기·학생·단어로 만든 기존 canonical SHA1 ID여야 합니다. 같은 transaction에서 학생 프로필과 해당 학생 단어장을 읽어 현재 `requested` 상태이며 요청 ID·단어·학기가 모두 일치하는지 확인합니다. 학생 단어장의 UID 필드가 있으면 경로의 UID와도 일치해야 합니다.
- 오래된 알림이나 클라이언트가 제시한 ID만으로 새 요청을 만들지 않습니다. 학생 단어장이 없거나 이미 저장된 상태이면 복구를 거절합니다. 이미 존재하는 요청의 ID에는 canonical 형식을 새로 강제하지 않아 필드가 일치하는 legacy 문서를 유지합니다.
- 잘못된 fallback 입력으로 전역 단어를 먼저 변경하지 않도록 단건 저장의 첫 transaction에서 검증하고, 실제 요청 처리 transaction에서 다시 확인합니다. 모든 필요한 읽기는 쓰기 전에 합니다.

## 오류와 검증

서버는 요청 연결 불일치를 `HISTORY_DICTIONARY_REQUEST_MISMATCH`, 처리할 수 없는 닫힌 요청을 `HISTORY_DICTIONARY_REQUEST_NOT_PENDING`, 미존재 요청의 복구 증거 부족을 `HISTORY_DICTIONARY_FALLBACK_UNVERIFIED`로 구분합니다. 기존 교사·관리자 권한과 애플리케이션 세션·AppCheck 검사는 유지합니다.

기존 `functions/scripts/verify-history-dictionary-request-scope.cjs`를 확장하고, 실제 Auth/Firestore/Functions 에뮬레이터 검증은 `scripts/verify-history-dictionary-request-binding-integration.mjs`로 수행합니다. 잘못된 연결의 전체 쓰기 0, 정상 승인, 기존 메타데이터 보존, 미처리 학생 단어를 통한 복구, 완료된 fallback 재시도, 동시 승인, 학생·직원 거절을 확인합니다. 정확한 실행 결과와 Staging 배포·실제 서버 검증 기록은 외부 인수인계에 남깁니다.

## 남아 있는 경계

이 변경은 DIC01의 Gateway 이전을 완료하지 않습니다. 전역 단어 저장과 요청 처리 사이의 transaction 경계, 알림 발송 실패·원래 요청 receipt, 동시 단건 수정 CAS, 자동 재조회 시 편집 중인 초안 보존은 별도 작업입니다. 첫 검증 뒤 상태가 바뀌어 두 번째 검증에서 거절되면 전역 단어 저장은 이미 완료됐을 수 있습니다. 이 한계를 전체 원자성 보장으로 보고하지 않습니다.

DIC02 Excel 등록의 Gateway·ALL_OR_NOTHING·create-only 계약, 학생의 일반 단어장 저장·수정·삭제와 보상 흐름, Firestore/Storage Rules, 화면 구조는 이번 범위에서 변경하지 않습니다. 운영 Firebase가 아닌 전용 Staging에만 반영합니다.
