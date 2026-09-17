# 교사 학기 조회와 운영 학기 전환 분리

- 기준 소스: 운영 Vercel 배포 `dpl_DoJF7vjZMRTFm56i23NVi6AMocSk`의 `5ea5e6c0c84fe575b3a2efd2936899b94f82e66b`.
- 개발 중인 화면 개편 브랜치나 오래된 main 대신 실제 운영 소스에서 분리했다. 기존 Westory 메뉴·스타일·조작을 유지하는 기준을 AGENTS.md, UI_RULES.md, DESIGN.md에 명시했다.
- 관리자 설정 → 기본 환경 설정 → 교사 자료 조회에서 기존 학기를 선택한다. 자료가 있는 부모 문서 없는 학기와 보관된 학기도 목록에 포함하며, 조회 과정에서 학기 생성·seed·운영 설정 저장을 하지 않는다.
- 조회 선택은 계정별 sessionStorage에 학년도·학기만 보관한다. 교사 경로의 config/userConfig만 선택 학기로 바뀌고 학생 경로는 운영 config를 사용한다. 메뉴 전환·새로고침 시 유지하고 계정 변경 시 이전 선택을 지운다.
- 이전 학기 조회는 읽기 전용이다. 명령 Gateway, callable 생성·실행·stream, 남아 있는 Firestore/Storage 직접 쓰기 앞에서 차단한다. 운영 전환은 별도 확인창과 기존 서버의 준비도·권한 검증을 거친다. 학생 메뉴 설정 저장은 학기를 바꾸지 않는다.
- 학생 명단·평가·역사교실은 과거 학적 snapshot을 사용하며 현재 users로 덮지 않는다. 반 이동 이력은 학생별 최종 학적으로 정규화해 중복을 피한다. 전역 학교·계정·인터페이스 설정과 사료 보관함은 학기 공통 자료임을 표시한다.
- 서버는 full teacher/admin의 명시 학기 읽기만 확장한다. 학생·위임 staff의 학기 경계와 모든 Firestore 쓰기 규칙은 유지한다. Storage 규칙은 변경하지 않는다.

## 검증

- `npm run build`, TypeScript 0 errors, `npm run format:check` 통과.
- `node scripts/verify-teacher-semester-view.mjs`: 계정·학생 범위 분리, 쓰기 차단, 학적 중복 제거.
- `node scripts/verify-routine-content-auth.mjs`: 실제 Gateway/callable wrapper 48검사, 조회 중 재인증·쓰기 전송·pending command 생성 0.
- `node scripts/verify-teacher-semester-view-browser.mjs`: 실제 context·설정·배너를 사용하는 합성 브라우저 검증. 390/768/1280px, 메뉴 이동·새로고침·학생 경로·계정 교체·키보드 복귀·일반 저장과 운영 전환 분리, overflow/pageerror/외부 요청 0.
- Functions check, 학기 조회/학적/성적/위스/W8 회귀 검사, Firestore emulator 404검사 통과.
- 기존 학기/수업자료 격리·초기 로딩·학생 명단 로딩·쿼리 캐시·명령 경계·UI shell 검사 통과. 직접 쓰기 경계는 153개 그대로이며 unknown 0; 운영 전환 버튼 분리로 달라진 호출 관계 4개를 검토해 fingerprint만 갱신했다.
- 운영 자료는 존재 여부만 읽어 2026-1 수업자료·평가·지도·canonical 학적·학급·위스 계정이 존재함을 확인했다. 운영 config/pointer는 2026-2이며 자료나 학생 상태는 바꾸지 않았다.

운영 배포는 `docs/runbooks/production-release.md`에 따라 이 변경 커밋의 별도 archive 후보를 만들고 CI·Firebase·운영 도메인 반영을 확인한다.
