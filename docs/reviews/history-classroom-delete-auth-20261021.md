# 역사교실 삭제와 인증 전환 (2026-10-21)

- 과제 삭제는 source를 비공개·삭제 표시하는 soft delete이며 제출 원본을 지우지 않는다. 클라이언트만 고치면 서버가 다시 최근 인증을 요구하므로 `deleteHistoryClassroomSource`를 프론트와 서버의 일반 교사 세션 목록에 함께 추가했다.
- 교사 권한, 현재 학기, 세션 증명·epoch·일반 만료·철회 상태, 원본 revision, receipt·audit는 유지한다. 초기화 등 다른 고위험 명령의 재인증 정책은 변경하지 않는다.
- 패치 메모 구독은 같은 UID의 재인증에서도 authGeneration과 User 경계로 다시 연결한다. 구독의 auth_time보다 새 토큰의 auth_time이 증가한 경우에만 이전 구독의 인증 오류를 복구한다. 같은 epoch의 실제 권한·네트워크 오류는 표시하며 작성 중 초안은 유지한다.
- 클라이언트 명령 검사와 실제 삭제 planner·adapter 검사를 사용한다. release 검증의 VM에 실제 historyClassroomSync 의존성을 연결해 현재 서버 모듈도 함께 검사하도록 보완했다.
- 격리된 Firestore 에뮬레이터의 실제 exported executeCommand/getCommandStatus에서 10분 전 교사 인증·유효 일반 세션·만료된 고위험 세션으로 삭제·receipt 조회·재전송을 검사한다. 학생·증명 누락·만료·철회·revision 충돌·학기 보관은 거부하고 기존 응시·답안·결과·조회 자료·보상 계좌가 보존되는지 대조한다.
- 배포 전 서울 executeCommand의 gateway·lifecycle·sessionAuthority·routine JSON·productionSource·teacherPatchNotes 운영 소스가 checkout과 일치함을 확인했다. 10/18 getCommandStatus와 현재 코드의 세션 분류·authorize·getStatus·callable 연결·권한 검사는 AST로 동일함을 확인했다. 나머지 차이는 이미 executeCommand에 반영된 선택적 읽기 최적화·결과 알림 연동 등 status 조회에 사용하지 않는 부분이다.
- Firebase 대상은 서울 executeCommand와 getCommandStatus 두 개이며 rules·로그인 함수는 배포하지 않는다. 운영 자료 삭제 없이 합성 검사와 실제 운영 코드·로그인 화면으로 반영을 확인한다. 상세 증거는 Git에서 제외한 `.superloopy/sessions/history-delete-auth-20261021/evidence/`에 보관한다.
