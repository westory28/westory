# 사전 운영 연결 계약

운영 사전 연결 계약과 확인 기록입니다.

- 운영 사전은 `years/{year}/semesters/{semester}` 아래의 `history_dictionary_terms`, `history_dictionary_requests`, `dictionary_students/{uid}/history_dictionary_words`를 사용합니다. 프런트엔드는 이전 루트/사용자 경로로 fallback하지 않습니다.
- 조회 전에 `openApplicationSession`으로 서버 세션을 확인합니다. callable 요청에는 반환된 `_session` 증명을 첨부합니다. 닫히거나 만료된 세션은 재로그인을 요구하며 클라이언트에서 권한 검사를 우회하지 않습니다.
- 등록·수정·삭제·요청·승인은 `executeCommand`의 사전 명령으로 처리합니다. 읽은 문서 버전과 명령 ID를 전달하며, 응답 유실 뒤 재시도는 원래 명령 ID와 payload를 그대로 사용합니다. 버전 충돌은 새로고침을 안내하고 자동 덮어쓰지 않습니다.
- Excel 일괄 등록은 기존 `saveHistoryDictionaryTermsBulk`를 사용하며 학기와 세션 증명을 전달합니다.
- 운영 Functions는 main의 이전 서버 코드보다 앞서 있으므로 전체 Functions를 재배포하지 않습니다. 2026-09-29 실제 운영 규칙을 조회한 결과 main의 규칙과 일치하며 학기별 사전 조회 규칙이 누락된 상태였습니다. 학기별 본인 단어 조회, 공개 단어 검색, 권한 있는 교사의 조회 규칙을 보완했습니다. 직접 쓰기는 계속 차단하고 운영 executeCommand를 사용합니다. 배포 전에는 실제 운영 규칙과 반드시 다시 비교합니다.

검증 명령:

```text
node scripts/verify-history-dictionary-session.mjs
node scripts/verify-history-dictionary-contract.mjs
node scripts/verify-history-dictionary-navigation.mjs
firebase emulators:exec --only firestore --project demo-westory-dictionary "node scripts/verify-history-dictionary-rules.mjs"
npm run build
```

운영 확인에서는 등록 단어, 학생 단어, 요청 조회와 각 메뉴 이동을 확인합니다. 실제 학생 데이터에 대한 저장·삭제를 검증용으로 실행하지 않습니다.
