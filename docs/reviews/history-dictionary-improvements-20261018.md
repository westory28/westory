# 역사 사전 개선 검증 기록

## 작업 기준

- 시작 checkout: `C:\westory`, `main`, `e1671e0b0bfbee33d91730cf4a426c9de7403316`.
- 수행평가 작업과 분리하기 위해 `codex/dictionary-improvements` worktree에서 수정했다.
- 운영 Vercel 도메인 `www.westory.kr`의 시작 배포 `dpl_BhWLZE1W1TKXTndc2bV6SgyvTrmV`는 같은 `e1671e0` 커밋이었다.
- 작업 중 원격에 추가된 `860626f` 수행평가 패치와 `7461dbd` 위플레이 패치를 fast-forward로 포함했다. 사전과 위플레이의 `DESIGN.md` 계약을 모두 유지했다.

## 재현 및 수정 근거

- 실제 운영 교사 계정으로 사전 페이지를 열었을 때 terms/requests listener 모두 `Missing or insufficient permissions` 오류가 발생했다.
- 정상 세션·가입 승인·유지보수 예외 목록 20개를 넣은 로컬 Firestore Emulator에서 rules의 1,000 expression 한도 초과로 재현했다.
- 사전 역할 판정에서 세션·유지보수·가입 승인 검사를 중복 실행하지 않게 했다. 동일한 `canUseWestory()` 검사는 한 번 유지한다.
- 재귀적인 학생 단어 match가 명시적 학기/사용자 경로와 겹쳐 첫 등록 전 없는 문서 조회도 실패했다. 클라이언트는 명시적 경로를, 교사 전체 조회는 기존 서버 callable을 사용하도록 중복 match를 제거했다.
- 관리자/교사/학습자료 조회 staff, 학생 본인 단어·요청, 공개 뜻풀이를 허용하고 타인 단어·초안·만료 세션·미승인 계정·클라이언트 직접 쓰기는 계속 차단하는 검사를 통과했다.

## 프린트 확인 범위

운영 수업 자료의 PDF 빈칸 목록을 읽기 전용으로 확인했다. PDF 편집·저장·학생 기록 생성은 하지 않았다. 조선 건국, 통치 체제, 사림과 붕당, 조선 전기 문화, 임진왜란, 광해군, 정묘·병자호란의 주요 용어를 자료 보강 근거로 전달했다. 수업 자료에 포함된 모든 PDF 전체를 재수집한 것은 아니다.

## 화면 기준

`education-web-design-system`, `UI_RULES.md`, `DESIGN.md`의 기존 색상·서체·간격을 사용한다. 학생은 기본 사전 탐색과 직접 쓰는 단어장을 구분하며, 교사는 기본 사전과 교사 등록 자료를 구분한다. 출처와 이용 조건은 각 뜻풀이에서 확인할 수 있다. 오류를 빈 목록으로 표시하지 않고 다시 불러오기를 제공한다.

## 검증

- 사전 Firestore rules 회귀 검사 통과(로컬 demo emulator).
- 기존 사전 navigation, session, contract 검사 통과.
- `npm run build` 통과: TypeScript, 수행평가 XLSX 원본 hair 테두리 검사, 학기·학습지·지도 회귀 검사 포함.
- `npm --prefix functions run check` 통과. 교사 조회 605건/4페이지, 범위·권한·커서·복구 원본 해시 검사 포함.
- 카탈로그 검사 통과: 역사 용어 133개, 지명 2,240개, 지도 표시 지명 344개 포함, 출처·라이선스·동음이의·검색·중복 검사.
- 변경한 TypeScript/TSX 파일의 Prettier 검사와 `git diff --check` 통과.
- 실제 컴포넌트를 사용하는 로컬 fixture를 Chrome에서 검증했다. Firebase와 연결하지 않고 학생 저장·보상 응답, 요청, 조회·저장 실패를 재현했다.
- 320px 빈 단어장, 390px 학생/교사 화면, 768px 오류 복구, 1280px 검색·출처·직접 입력·교사 편집에서 가로 넘침이 없었다.
- 단어 등록, 새 단어 초기화, 저장 실패 후 초안 보존과 재시도, 선생님 풀이 확인 실패 후 재시도, 교사 풀이 저장, 요청 동의·메모 전송을 확인했다.
- 긴 직접 풀이와 요청 메모를 함께 입력해도 요청에는 메모만 전달하여 서버의 240자 제한을 지킨다.
- 교사 편집 도중 목록 갱신·재시도가 발생해도 같은 항목의 작성 중 풀이를 덮어쓰지 않는다.
- 수업 중 사전의 모달·초기 포커스·Escape 닫기·버튼으로 포커스 복귀·스크롤 잠금 해제를 확인했다. 검색 input의 Escape는 브라우저 기본 검색어 지우기 동작을 먼저 수행한다.

## Firebase 운영 반영

- `firebase deploy --only firestore:rules --project history-quiz-yongsin` 성공. 기존 규칙의 중복 평가만 줄이며 접근 허용 범위를 확장하지 않았다.
- `firebase deploy --only functions:listStudentHistoryDictionaryWordsForTeacher --project history-quiz-yongsin` 성공. 다른 Functions는 배포하지 않았다.
- `firebase functions:list` 및 `gcloud functions describe`에서 서울 리전 Node 22 함수가 ACTIVE임을 확인했다. 업데이트 시각은 `2026-10-18T07:00:02.138324587Z`, revision은 `liststudenthistorydictionarywordsforteacher-00011-vak`다.
- 운영 교사 사전을 새로 열었을 때 기존 terms/requests 권한 오류가 더 발생하지 않았다. 실제 학기/legacy 컬렉션이 비어 있는 것과 조회 실패를 구분했다.

## 확인 범위와 유지보수

학생의 실제 운영 단어를 새로 만들거나 지우지 않았다. 학생 등록은 실제 UI의 로컬 동작, 기존 canonical 저장 계약 및 Firestore 권한 회귀 검사로 확인했다. 기본 사전은 정적 콘텐츠이며 프린트 신규 업로드를 자동 수집하지 않는다. [수록 범위와 재생성 방법](history-dictionary-content-provenance-20261018.md)을 참고한다. 프론트엔드의 최종 커밋·운영 도메인 연결 결과는 배포 후 최종 작업 보고에 기록한다.
