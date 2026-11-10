# 서버 조회·기록량 최적화와 비용 검토 (2026-11-10)

## 조사 기준

원래 checkout은 `C:\westory`, 시작 HEAD는 `94325681eb71b71298644abeb1e8bc777ba672c0`이며 당시 origin/main과 같았다. 기존 시험 진입/복습 작업의 미커밋 변경을 보존하기 위해 `C:\westory-server-usage` 별도 worktree에서 작업했다. 병행 반영된 main 변경을 통합한 뒤 검증·배포한다.

실제 `history-quiz-yongsin` Cloud Monitoring의 2026-11-01 00:00~11-10 00:00 KST(완료된 9일) 데이터를 조회했다. `run.googleapis.com/request_count`, `container/billable_instance_time`, `firestore.googleapis.com/document/read_count`, `document/write_count`를 하루 단위 SUM, 서비스별 SUM으로 집계했다. 학생 이름·UID·성적·답안은 조사 자료에 수집하지 않았다. 원문 로그나 데이터 전체를 비용 분석용으로 새로 기록하지 않았다.

| 지표 | 9일 합계 |
| --- | ---: |
| Firestore 문서 읽기 | 2,304,255 |
| Firestore 문서 쓰기 | 77,087 |
| Cloud Run HTTP 요청 | 167,138 |
| 답안 자동 저장 `saveAssessmentProgress` 요청 | 39,582 |
| 지갑 조회 `getWisEconomyStateFast` 요청 | 25,060 |
| 수업자료 `getStudentVisibleLessons` 요청 | 16,482 |
| 윷 대기방 정리 요청 | 12,960 |
| 윷 로비 `getYutLobby` 요청 | 10,095 |
| 순위 미리보기 요청 | 8,498 |
| 명령 `executeCommand` 요청 | 7,063 |

요청 수는 성공한 업무 처리 수와 같지 않다. 재시도·오류·HTTP 처리를 포함할 수 있으며 Firestore 읽기 메트릭만으로 함수별 문서 읽기 비용을 정확히 배분할 수는 없다.

답안 저장은 11월 1일 1,894요청에서 9일 16,792요청으로 늘었고, 해당 함수의 billable instance time은 약 2,010초에서 10,747초로 늘었다. 수업자료 조회와 로비 확인도 높은 빈도로 실행된다. 사용자 첨부 청구 화면의 서울 Functions CPU·메모리 증가와 함께 살펴야 하는 실제 부하 경로다. 필요한 답안 저장까지 낭비로 간주하지 않고 코드와 회귀 검사로 중복 작업을 구분했다.

`executeWisCommandFast`, `commandYutRoomFast`, `getWisRankingPreview`는 각각 최소 인스턴스 1개이며 9일 내내 약 777,600초의 인스턴스 시간이 잡힌다. 이 시간에는 대기가 포함되므로 전부 요청 처리 CPU 단가로 계산하면 안 된다. 순위·거래·게임 최초 응답 지연을 줄이려던 기존 설정은 유지했다. 매분 대기방 정리도 만료 계약을 검토했으며 임의로 주기를 늦추지 않았다.

## 반영 범위와 검증 가능한 효과

| 경로 | 변경 | 보존한 계약 |
| --- | --- | --- |
| 윷 공개 확인 | 목록과 반복 확인은 전용 `getYutPublication`. 방·학생 포인터·타 참가자 읽기 및 이름 동기화 쓰기 없음 | 최초 게임 진입은 기존 로비 1회, 공개 차단·세션·현재 학기·수강·학급 확인 유지 |
| 생각모아 | 전용 `getThinkCloudState`. 무관한 학습 4컬렉션 생략, 허용 반 주제와 선택 반 명부만 조회, 명령 사전검증은 주제 1건 | 익명성·담당반·위임 읽기 전용·현재 학기 유지. 기존 W8/과거학기 함수는 재배포하지 않음 |
| 생각모아 최초 진입 | 목록과 처음 선택할 주제 응답을 함께 받아 자동선택에 따른 즉시 호출 2회→1회 | 사용자의 주제 변경·새로고침·10초 갱신·숨김 탭 중단 유지 |
| 수업자료 한 단원 | 학기 자료가 있으면 구형 자료 query 생략 | 비공개·삭제·미배정 학기 자료로 구형 공개본을 덮는 우선순위 유지, 실제 없는 단원만 fallback |
| 수업자료 진도·중요표시 집계 | `progress` 필드 선택으로 PDF·OCR·페이지 이미지·각주 본문 제외 | 전체 단원의 빈칸 원문·정답·중요표시 및 legacy-only 단원은 보존 |
| 역사교실 자동 저장 | 서버에서 이미 확인한 동일 답안·페이지를 시작/재연결/복구 때 다시 저장하지 않음 | 실제 입력 900ms 저장, 지운 답안, 페이지 이동, 원본 영수증 재전송·revision 충돌·오프라인 복구 유지 |
| 평가 결과 trigger | 같은 학기·학생·학급 전후 대상 무효화를 1회만 실행 | 대상이 바뀌면 양쪽 갱신. 통상 수정의 읽기 4→2, 쓰기 4→2 |
| 프로필 이모지 trigger | 정상 revision만 증가하고 등급 조건이 같으면 재검사 생략 | 등급·소유자·학기·상태·revision 유효성 경계 변경 시 재검사. 불필요 읽기 5→0 |
| 최초 출석 | 출석과 관련된 거래 및 이번 지급의 중복 확인만 서버 필터로 조회 | 누락 activityType·옛 필드·임의 문서 ID·현재 학기·중복 지급 방지·조회 상한 실패 유지. 실제 에뮬레이터 이력 읽기 529→29 |
| 선택 단원 위플레이 | 지정 단원만 30개씩 IN 조회하고 scoped 단원이 있으면 legacy 생략 | 전체 모드·교사 관리목록·미리보기·빈 선택·숨김 우선·중복 단어 출처 보존. 1,003문서 fixture에서 선택 단원 1개의 문서 읽기 1건 |

표의 횟수는 회귀 fixture에서 확인한 해당 분기의 감소량이며 운영 전체 절감률이 아니다. 필드 선택은 전송량·직렬화·메모리를 줄이며 동일 문서의 Firestore 읽기 건수는 그대로다. 서버 권한 검사, 필수 감사/영수증, 전체 평가 분석, 전체 단원 모드와 완전한 집계는 비용을 줄이기 위해 누락시키지 않는다.

운영 자료 형태도 필요한 필드만 확인했다. 현재 학기의 수업자료 13개는 모두 정규 문자열 `unitId`이고 전역 legacy 자료는 0개였다. 원문/제목/학생 자료는 출력하지 않았다. 위플레이 정책의 기존 윷 보상 필드는 현재 검증 규격과 호환된다.

## 월 5만원 가정과 CUD

첨부 화면의 실제 표시 값은 11월 1~9일 11,435원, 월 예상 24,501원이다. 월 50,000원은 비교를 위한 가정이다. 다음 금액은 **전체 5만원이 해당 할인 대상이고 매시간 약정을 모두 사용하는 경우**의 단순 예시다.

| 대상 | 1년 | 3년 | 5만원 가정 결과 |
| --- | --- | --- | --- |
| Cloud Run functions / request-based Cloud Run | 17% | 17% | 41,500원, 월 8,500원 절감 |
| Firestore 읽기·쓰기·삭제 | 20% | 40% | 40,000원 / 30,000원 |

전체 비용의 절반만 Functions CUD 대상이면 5만원→45,750원이다. Cloud Run의 28%/46% 할인은 instance-based 서비스 등에 적용되는 별도 조건이며 현재 request-based 함수에 그대로 적용하지 않는다. Firestore 저장·네트워크 등은 읽기·쓰기·삭제 CUD로 일괄 할인되지 않는다. [Cloud Run 공식 CUD](https://docs.cloud.google.com/run/cud), [Firestore 공식 CUD](https://firebase.google.com/docs/firestore/cuds).

CUD는 월평균 사용량이 아니라 매시간 최소 지출 약정이다. 사용량이 줄어도 약정요금을 내며 취소할 수 없다. 학교의 야간·주말·방학과 이번 조회량 감소를 고려하면 현재 5만원을 기준으로 장기 약정할 근거가 부족하다. 최적화 후 일별 비용과 시간대별 최저 사용량을 먼저 비교한다. 약정 구매나 결제 설정 변경은 하지 않았다.

다른 절감 수단은 먼저 불필요한 호출·실행시간·전송을 없애고, 이후 함수별 최소 인스턴스·CPU·메모리·동시성을 실제 부하로 재평가하는 순서다. 작은 메모리만 줄이거나 CPU를 일괄 축소하면 동시성이 사라져 지연과 비용이 커질 수 있다. 배포 이미지 보관 비용은 별도 SKU에서 비중을 확인한 후 다룬다. [Firebase 런타임 설정](https://firebase.google.com/docs/functions/manage-functions), [Cloud Run 과금](https://cloud.google.com/run/pricing), [Firestore 과금](https://firebase.google.com/docs/firestore/pricing).

## 운영 경계

기존 서비스의 조회·저장 효율 유지보수다. 학생 공개·게임 공개·인증 권한·개인정보 항목·외부 AI 호출·전송 대상·보관 위치·성적·보상 규칙을 확대하지 않는다. 운영 검증에서 학생 답안·점수·서명·이의 상태·보상을 시험 목적으로 변경하지 않는다. `AGENTS.md`에 목적별 서버 필터·중복 요청/쓰기 억제·권한 및 캐시 경계·조회량 회귀를 앞으로의 패치 기준으로 추가했다.

## 소스 대조와 검증

병행 작업 `c2149b65`(시험 진입/복습)와 `2d03aa20`(학생 화면 공개 설정)을 통합했다. 배포 전 운영 도메인 소스도 `2d03aa20`으로 일치했다. 윷 hook은 메뉴 차단을 먼저 적용하고 허용 상태에서만 전용 조회를 시작한다. 양쪽 기능을 보존하도록 충돌을 해결했으며 메뉴 비공개 시 호출 0건 회귀를 추가했다.

운영 아카이브와 비교한 결과, 출석 handler는 마지막 빈 줄 외에 기준 소스와 같고 attendanceSession도 같다. 분석 trigger의 실제 invalidateResult/onResult/onUser/onScope·식별자/경로 helper·등록문은 기준과 같으며 다른 분석 query의 차이는 trigger 실행 경로가 아니다. 이모지 reconciliation/policy는 기준과 같고 지갑 module에서 사용하는 accountId/hash도 같다. 수업자료 handler는 기준과 같으며 공통 session의 관리자 최근 인증 예외는 일반 읽기 경로에서 실행되지 않는다. 위플레이 3함수의 아카이브는 동일하며 기존 policy 확장과 병행 반영된 학생 메뉴 차단을 보존한다. 이전 W8는 과거학기 계약 차이가 있어 이번 배포 대상에서 제외했다.

운영에서 신규 출석 4개, 생각모아 2개, 선택 단원 1개 쿼리 형태를 가상 식별자·`limit(1)`·문서 이름만 선택하는 방식으로 실행해 모두 HTTP 200/결과 0건을 확인했다. 새 복합 인덱스나 rules 변경은 필요하지 않다.

- 전체 앱 빌드·Functions check·포맷 검사를 통과했다. Functions check에 수업자료 조회량, 전용 생각모아, 선택 단원 출제, 출석 회귀를 연결했다.
- 역사교실 실제 브라우저 46시나리오, 윷 hook 실제 브라우저, 생각모아 실제 query core/클라이언트 lifecycle, 복습 팝업 390/768/1280px를 통과했다.
- 출석 41단위검사 및 실제 Firestore 동시 요청/ACK/영수증/금액/세션 회귀, 기존 윷 전체 에뮬레이터와 새 공개 전용 조회를 통과했다.
- 점수·서명·이의 권한 에뮬레이터, 학생 접근/수업자료/생각모아 익명성/게임·출석 금융 경계 에뮬레이터, 병행 학생 화면 공개 설정 브라우저 121assertions를 통과했다.

배포 대상은 서울 `getYutPublication`, `getThinkCloudState`, `getStudentVisibleLessons`, `checkStudentAttendance`, `getWeplayLobby`, `startWeplayGame`, `previewWeplayGame`, `invalidateQuizClassCanonicalResult`, `invalidateQuizClassLegacyResult`, `reconcileStudentProfileEmojiOnAccountWrite` 및 Vercel main 프론트엔드다. 다른 함수·rules·최소 인스턴스·학기/공개 설정은 이 패치에서 배포하거나 변경하지 않는다. 배포 후 실제 청구 절감액은 같은 사용 조건의 기간이 지나야 확정할 수 있다.
