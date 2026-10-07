# 알림장 이미지 업로드 복구

## 원인과 최종 변경

- 운영 버킷 `history-quiz-yongsin.firebasestorage.app`은 알림장 이미지의 직접 쓰기를 차단하지만, 프런트엔드는 Firebase Storage에 직접 업로드했다. 이미지 자체의 1120×630 크기나 압축 용량 문제는 아니었다.
- 단순 규칙 허용으로는 세션·점검·프로필을 함께 검사할 때 Storage의 평가 한도에 걸린다. 따라서 업로드와 삭제를 전용 callable `uploadNoticeImageContent`, `deleteNoticeImageContent`로 옮겼다.
- callable은 기존 `onCallWithStudentMaintenance`, 가입 승인 검사, `assertActiveApplicationSession`을 사용한다. 프런트엔드는 계정과 인증 시점이 바뀌지 않았는지 확인하고 서버가 발급한 `_session` 증명을 보낸다.
- 관리자 또는 승인된 학교 교사만 현재 운영 학기의 알림장 이미지를 관리한다. canonical 학기 포인터·manifest를 우선하고, 포인터가 없을 때만 기존 config를 사용한다. 보관·읽기 전용·revision 불일치는 거부한다.
- 서버는 700 KiB 미만의 실제 WebP/PNG/JPEG를 완전히 디코딩해 검증한다. 경로·파일명·다운로드 토큰은 서버에서 생성하고 삭제 경로는 해당 학기의 알림장 이미지로 제한한다. 기존 680 KiB 브라우저 압축과 16:9 미리보기는 유지한다.
- `storage.rules`는 작업 시작 때 읽은 운영 원본(`67af9629-5f1f-4eb9-9b6b-6924f053b145`)으로 동기화했다. 최종 규칙은 그 원본과 동일하며 알림장 직접 쓰기도 계속 차단한다. 공유 보안 조건을 완화하지 않는다. Firestore 데이터 구조·규칙은 변경하지 않는다.

## 검증

- `npm run build`, `npm run format:check`, `git diff --check` 통과.
- `npm --prefix functions run check` 통과. 새 서버 검사 59개와 기존 가입 검사 19개, 로그인 export 검사를 포함한다.
- `firebase.notice-storage-test.json`의 demo Firestore/Storage로 직접 쓰기 금지 및 기존 읽기·세션·권한 경계 72개 통과. 테스트는 전용 localhost 포트와 demo 프로젝트가 아니면 실행을 거부한다.
- 현재 Firebase CLI의 Storage stdout 청크 처리 문제가 있어 실행 시에만 줄 버퍼링 preload를 사용했다. 설치된 CLI는 수정하지 않았다. shim과 원본 출력은 `.superloopy/notice-upload/`에 보관한다. 테스트 종료 후 Java runtime의 EOF 경고가 있지만 검사는 종료 코드 0으로 완료됐다.
- 운영의 현재 학기 포인터와 manifest는 `2026-2`, revision 1, ACTIVE로 서버 검증 조건과 일치한다.

```powershell
npm run build
npm run format:check
npm --prefix functions run check
firebase emulators:exec --only "firestore,storage" --config firebase.notice-storage-test.json --project demo-westory-notice-storage "node scripts/verify-notice-storage-rules.mjs"
$env:FUNCTIONS_DISCOVERY_TIMEOUT = '60'
firebase deploy --only "functions:uploadNoticeImageContent,functions:deleteNoticeImageContent,storage" --project history-quiz-yongsin
```

실제 게시 검증에는 사용자가 요청한 환영 이미지를 사용하며, 별도의 테스트용 운영 알림장은 만들지 않는다.
