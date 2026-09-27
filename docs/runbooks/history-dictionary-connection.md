# 사전 운영 연결 계약

2026-09-27 운영 Functions 소스와 Firestore 규칙을 직접 조회하여 확인한 계약입니다.

- 운영 사전은 `years/{year}/semesters/{semester}` 아래의 `history_dictionary_terms`, `history_dictionary_requests`, `dictionary_students/{uid}/history_dictionary_words`를 사용합니다. 루트/사용자 하위의 이전 사전 경로는 운영 규칙에서 읽기와 쓰기가 차단되어 있습니다. 이전 경로로 fallback하지 않습니다.
- 조회 전에 `openApplicationSession`으로 서버 세션을 확인합니다. callable 요청에는 반환된 `_session` 증명을 첨부합니다. 닫히거나 만료된 세션은 재로그인을 요구하며 클라이언트에서 권한 검사를 우회하지 않습니다.
- 등록·수정·삭제·요청·승인은 `executeCommand`의 사전 명령으로 처리합니다. 읽은 문서 버전과 명령 ID를 전달하며, 응답 유실 뒤 재시도는 원래 명령 ID와 payload를 그대로 사용합니다. 버전 충돌은 새로고침을 안내하고 자동 덮어쓰지 않습니다.
- Excel 일괄 등록은 기존 `saveHistoryDictionaryTermsBulk`를 사용하며 학기와 세션 증명을 전달합니다.
- 운영 규칙과 Functions는 main에 남아 있는 이전 서버 코드보다 앞서 있습니다. 이 프런트엔드 수정에는 서버 배포가 필요하지 않습니다. 사전 오류를 이유로 main의 Functions나 rules 전체를 재배포하지 말고, 해당 운영 버전과 먼저 비교해야 합니다.

검증 명령:

```text
node scripts/verify-history-dictionary-session.mjs
node scripts/verify-history-dictionary-contract.mjs
node scripts/verify-history-dictionary-navigation.mjs
npm run build
```

운영 확인에서는 등록 단어, 학생 단어, 요청 조회와 각 메뉴 이동을 확인합니다. 실제 학생 데이터에 대한 저장·삭제를 검증용으로 실행하지 않습니다.
