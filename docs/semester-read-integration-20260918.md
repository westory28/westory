# 학기 조회 연동 수정

운영 기능 브랜치 `b7cb77b6818959372091b4539cf1c62053a657e9`를 기준으로 점수·서명 조회 계약을 보완했다. 운영 Firestore rules가 기준 커밋과 일치하고 두 `rosterId` collection-group 인덱스가 없는 것을 읽기 전용 API로 확인했다.

- `performance_scores`, `confirmations` 묶음 조회에는 개별 학생 문서의 read 규칙만으로 권한이 부여되지 않았다. 기존 `canManagePerformanceScores()`를 사용하는 교사·관리자 전용 list 규칙을 운영/staging에 추가했다. 학생·staff·만료 세션 제한과 직접 쓰기 차단은 유지한다.
- 두 컬렉션의 `rosterId` COLLECTION_GROUP 인덱스를 추가하고 기존 COLLECTION ASC/DESC/CONTAINS 설정을 보존한다. 운영에서는 인덱스 READY 확인이 필요하다.
- 수행평가/정기시험 일람표 현황 조회와 다운로드 시 선택 점수표의 점수·서명 캐시를 새로 읽어 이후 서명과 점수 변경을 반영한다.
- 수업·일정·위스·명단·퀴즈·역사교실의 실제 프론트 어댑터와 서버 코어 사이에서 과거학기 전달, 과거 학적 보존, 학생 범위 제한, 조회 중 쓰기 0을 확인했다. 역사사전·학기목록·학교배너 기존 회귀도 통과했다. 미사용 공지 컴포넌트의 오래된 직접 업로드 경로는 현 운영 경로와 구분했다.

검증: 수정 전 permission-denied 재현; 점수/서명 규칙 190개 및 기존 학기 규칙 404개 통과; 점수 조회 4개 시나리오 및 기타 조회 6개 계약 통과. build, TypeScript 오류 0, Functions check, 학기 선택/쓰기 차단 48개 검사, 390/768/1280px 합성 브라우저 검사 통과. 신규 회귀 세 종류를 CI에 연결했다.

운영 사용자 데이터의 변경·학기 전환은 수행하지 않는다. 배포는 `docs/runbooks/production-release.md`에 따라 Firestore rules/indexes와 검증한 프론트 후보를 반영한다.
