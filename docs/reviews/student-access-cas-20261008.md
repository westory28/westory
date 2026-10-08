# 학생 접속 설정 동시 수정 검토 — 2026-10-08

- 변경 전 `functions/studentMaintenance.js`와 읽기 전용 운영 소스 보관본의 SHA-256이 `A75449C012D51F5C39C6B13483002AB46DFA6FF96550755092E626F0BB1B2955`로 같음을 확인했다.
- 설정 변경은 필수 `expectedRevision`을 트랜잭션 안에서 비교한다. 같은 이전 상태를 본 두 창이 동시에 변경하면 하나만 반영되며, 다른 요청은 설정과 감사 기록을 쓰지 않고 거부된다. 응답이 끊긴 요청을 이전 revision으로 다시 보내도 중복 변경되지 않는다.
- 학생 접속을 열 때는 `expectedSemesterId`도 필수다. 트랜잭션에서 `site_settings/config`의 year/semester와 `site_settings/semester_active`의 semesterId가 점검한 학기와 모두 같아야 한다. 접속 제한은 학기 불일치 때도 가능하다.
- 관리자 계정, 최근 재인증, 유효한 고위험 세션, App Check 조건과 기존 감사 기록 형식은 유지했다. `functions/index.js`에는 이 callable만 별도로 노출했다. 보관한 canonical command gateway 소스는 변경하지 않았다.
- `functions/scripts/verify-student-maintenance-cas.cjs`에서 동시 요청, 오래된 revision, 학기 변경, 감사 기록 원자성, 최초 설정, 관리자·세션 경계를 합성 트랜잭션 저장소로 검증했다. 운영 데이터 쓰기나 배포는 이 검증에 포함하지 않았다. Functions 기본 `check`에 회귀 검증을 연결했다.
