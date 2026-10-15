# 역사교실 반응형 화면·저장 복구 검증 (2026-10-15)

## 범위와 원인

- 기준 작업 공간은 `codex/history-exemption-reliability`이며 최신 `3c4ae88`의 평가 결과 읽기 수정도 포함한다. 기본 checkout의 진행 중 지도 변경은 수정하지 않았다.
- 좁은 대시보드에서 날짜·검색·필터·정렬과 카드 제목·상태를 한 줄에 유지하던 배치가 한국어 라벨을 글자 단위로 밀어냈다. 실제 내용 폭을 기준으로 배치하고 한국어 `keep-all`을 적용했다.
- 서버에서 일반 교사 세션으로 허용하는 역사교실 저장 명령에 클라이언트가 별도 민감 작업 인증을 요구했다. 실제 SDK의 10분 전 로그인 세션으로 이 차이를 검증했다. 서버의 역할·학기·세션·명령 권한 검증은 유지한다.
- 원본 저장 뒤 공개가 실패하면 다음 클릭의 공개 날짜가 새 작업으로 취급되어 이전 revision과 충돌할 수 있었다. 같은 입력의 재시도는 최초 receipt와 공개 기간을 유지하며, 입력을 바꾼 재시도는 현재 로그인과 본인이 확정 저장한 원본 revision/내용이 일치할 때만 이어간다.
- 운영 콘솔은 일반 실패와 `Object`만 제공해 사용자 클릭 한 건의 정확한 내부 오류는 확인하지 못했다. 위 경로는 별도 SDK·서버 검증에서 확인한 결함이며 실제 운영 학생에게 검증용 과제를 배정하지 않았다.

## 구현

- 내용 폭 900px 이하에서는 동작 버튼을 아이콘으로 표시한다. 접근 가능한 이름·전체 제목과 최소 44px 조작 영역을 유지한다.
- 등록·수정 모두 학생 추가 전에 사유를 선택하고, 명단은 학생 정보·개별 사유·삭제 버튼을 한 행으로 표시한다. 기존 자유 입력 사유도 보존한다.
- 등록·편집·면제권 모달은 대화상자 이름, Tab 순환, Escape와 원래 버튼으로 초점 복귀를 지원한다.
- 중복 저장을 막고 실패 시 입력을 유지하며, revision 충돌은 최신 과제 확인 안내로 표시한다.
- 정의 생성·수정·공개 트랜잭션에서 원본 revision을 검사한다. 과거 요청이 다른 교사의 최신 공개 과제를 중지하거나 서로 다른 설정을 섞어 공개하지 못하도록 보호한다.

## 검증

- Chrome CUA와 외부 요청을 차단한 합성 UI fixture로 320·390·768·1014·1280·1440px 대시보드를 검사했다. 가로 넘침 없이 아이콘 전환과 어절 줄바꿈을 확인했다.
- 등록·편집 명단의 각 행은 54px이며 학생 정보·사유·삭제 버튼의 세로 중심이 일치한다. 390px 등록 모달은 client/scroll 폭 모두 366px, 320px 편집 모달은 모두 288px였다. 응시 결과 표는 내부 가로 스크롤을 유지한다.
- 신규 등록에서 지각/기타 사유의 학생 두 명을 추가하고 첫 저장을 강제 실패시켰다. 입력을 유지한 동일 과제 ID의 두 번째 요청만 성공했으며 알림은 두 명에게 한 번 발생했다.
- 기존 24명 과제에서 한 명의 사유를 바꾸고 사유를 먼저 선택해 25번째 학생을 추가했다. 저장 payload의 학생 목록·사유·기존 공개 기간을 확인했다.
- 편집 모달의 Shift+Tab/Tab 순환, Escape 닫힘과 편집 버튼 초점 복귀를 확인했다.
- `verify-assessment-release.mjs`: 부분 저장 재시도, 입력 변경 재시도, 응답/조회 실패, 계정 전환, 동시 source 변경과 create/update/publish 경계 검사.
- `verify-history-classroom-sdk-contract.mjs`: 실제 Firebase Auth/Functions SDK, Timestamp/serverTimestamp 변환, 28개 빈칸 원본, 일반 세션 저장/공개, 만료 세션 거절을 loopback HTTP로 검사.
- `verify-canonical-assessment-client.mjs`: receipt 복구·계정 격리·재시도 ID·일반 세션 명령 회귀 12그룹 통과.
- Firestore demo emulator에 실제 callable을 연결해 28개 빈칸·학생 2명·10분·재도전 5분·통과 기준 90%·기간 없음 조건의 원본 저장→정의 생성→수정→공개→학생 응시 시작을 검사했다. 기존 면제권·학생 응시 회귀도 포함한다.
- `npm run build`, `npm --prefix functions run check`, 변경 TS/TSX/CSS Prettier와 `git diff --check`를 수행했다. 최종 릴리스 결과는 아래에 기록한다.
- 최종 전체 빌드와 Functions 검사를 통과했다. 별도 읽기 전용 검토에서도 release·canonical client·SDK contract를 독립 실행해 통과했다. 새 revision 필드가 없는 기존 공개 정의의 삭제·재준비 및 동시 편집 회귀를 포함한다.
- SDK의 직렬화/명령 계약, 실제 서버 adapter를 연결한 전체 저장·재시도 chain, demo emulator의 실제 callable 저장·학생 시작은 서로 다른 검증 경계다. 운영 학생에 대한 과제 생성 성공을 주장하지 않는다. 부분 저장 자동 복구는 동일 로그인·화면 메모리 안에서만 이어가며, 새로고침·재로그인 후에는 revision 충돌로 안전하게 멈춘다.
- 합성 화면 증빙은 `.superloopy/sessions/history-classroom-responsive-save/evidence/`에 보관했다.

## 운영 반영

- 배포 전 `executecommand-00011-ziv`의 source generation `1792064037131628`과 HEAD의 gateway 55개 파일을 LF 정규화해 대조했으며 모두 일치했다.
- 이번 백엔드 대상은 서울 `executeCommand` 하나다. 명령 이름·상태 조회 allowlist·rules는 변경하지 않았다.
- 기능 커밋은 `7165482`, 동시 반영된 지도 개선 `cccf8a3`을 보존한 병합 커밋은 `4d0731c`다. 병합 후 전체 빌드를 다시 통과하고 원격 main에 반영했다.
- 서울 `executeCommand` 배포와 functions 목록의 ACTIVE 상태를 확인했다. revision은 `executecommand-00012-fiy`, 갱신 시각은 `2026-10-15T12:06:51.961573607Z`, source generation은 `1792065952797495`다. 배포된 gateway 55개 파일은 검증한 로컬 소스와 모두 일치한다.
- 프론트엔드 `dpl_8LZAhqK7p5hwG4QsUYREfRaEGkeb`의 source commit `4d0731c`와 Ready를 확인하고 Production으로 승격했다. `www.westory.kr` 조회가 동일 배포를 반환했다.
- 로그인된 운영 역사교실에서 새 CSS `ManageHistoryClassroom-BVrUfae3.css`, 어절 줄바꿈, 등록 사유 선선택을 확인했다. 390px에서 모든 모달 동작 라벨은 아이콘으로 전환됐고 모달 client/scroll 폭은 모두 366px였다. 운영 화면 오류 로그는 없었다. 사용자 작성 중 탭은 새로고침하지 않고 별도 읽기 검증 탭을 사용했다.
- 이 기록을 추가하는 후속 커밋은 문서만 변경한다.
