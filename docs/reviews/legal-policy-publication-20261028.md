# 위스토리 약관·개인정보 처리방침 게시 — 2026-10-28

## 범위와 확정 사실

운영자가 최종 운영 약관 게시와 전체 학생 알림을 명시적으로 요청했다. 방재석 개인이 경기도교육청 소속 교사로서 역사 학습 플랫폼을 운영하며, 학교운영위원회 승인·에듀집 등재 사실은 있으나 학교와 별도 개인정보 처리위탁 계약은 없다. 학생 기록의 목표 보유 상한은 용신중학교의 실제 졸업일이다.

최종 원문은 `src/content/legal/terms.html`, `privacy.html`이다. 교사 설정의 기본값과 운영 Firestore `site_settings/terms`, `site_settings/privacy`를 같은 문서로 맞춘다. 로그인 없이 열 수 있는 `public/legal/2026-10-28.html`과 이전 전문 `public/legal/before-2026-10-28.html`도 제공한다. 이전 전문은 `docs/legal-drafts/20261028/*.previous.html`의 원문이며 기존 해시를 유지한다.

## 법리와 적용 범위

- 현행 개인정보 보호법은 2026-09-11 시행 법률 제21445호다. 계정·본인 구분·수업 참여·학습 이력·평가 결과 제공에 실제 필요한 최소 처리는 제15조제1항제4호로 구분한다. 공교육 에듀테크 개인정보보호 가이드(2026.2.)의 10·12쪽 예시도 확인했다. 개인 운영자를 학교의 법정업무 수행 공공기관이라고 표시하지 않는다.
- 필요한 Google 인증·저장·서버 처리의 국외 처리위탁·보관은 제28조의8제1항제3호가목의 공개 요건에 맞춰 항목·국가·시기·방법·수신자·연락처·목적·보유조건·거부 방법을 적는다. 서비스 이용 자체를 공급자의 광고·모델 학습 등 독자 목적에 대한 동의로 쓰지 않는다.
- 계약 근거를 모든 공개·제3자 제공의 근거로 묶지 않는다. 만 14세 미만 이용자의 동의가 필요한 처리는 법정대리인의 동의와 확인을 요구하며 학생 자기확인·학운위 승인으로 대체하지 않는다.
- 기존 동의 근거 자료의 더 짧은 보유기간은 유지한다. 졸업일까지 연장해야 하는 동의 기반 자료는 해당 대상·목적·기간을 알리고 필요한 동의를 먼저 받는다. 개정문 게시·알림 읽음·계속 이용으로 과거 동의를 소급 변경하지 않는다.
- 모든 약관·방침 개정에 일률적인 재동의·로그인 차단은 필요하지 않다. 이번에는 기존 학생의 `privacyAgreed`를 초기화하지 않는다. 가입 시 개인정보 방침 안내 확인은 별도의 `kind: notice`로 표시하고 법정 개인정보 동의·보호자 동의로 해석하지 않는다.

## 실제 외부 처리 확인

운영 학생의 이름·답안·점수·서명은 조회하지 않았다. 소스와 프로젝트 메타데이터, 공개 공급자 문서 및 정책 설정만 확인했다.

- Google: Authentication 미국, Firestore `nam5`, Storage `US-CENTRAL1`, Functions 서울·미국. Firestore PITR 7일·일일 백업 30일, Storage 복구 보관 7일. Authentication 삭제 처리기한과 운영자의 학생 원본 보유기간을 구분한다.
- Cloud Logging: `global/_Default` 30일, `global/_Required` 400일. 모든 앱 감사기록이 400일인 것은 아니다. `global`을 특정 국가로 바꾸어 적지 않는다. Firestore TTL 메타 조회는 HTTP 400으로 미확인이고, 자동 파기 구현의 증거로 쓰지 않는다.
- Vercel: 현재 Hobby 플랜. 정적 전달뿐 아니라 실제 운영 authDomain에서 `/__/auth/*`의 Firebase 인증 요청·응답을 프록시한다. 학생 DB를 보관하지 않는다고 인증정보 처리도 없다고 적지 않는다. 직접 수집 서비스 정보와 위탁 중계 처리를 구분한다.
- OpenAI/Gemini/Vertex: 검사한 앱·Functions 소스와 의존성에 생성형 AI 직접 연동을 찾지 못했다. 개발에 사용한 소스·문서·작업 대화 처리와 학생 서비스의 런타임 전송을 구분한다. 과거 개발 입력 내역이 전혀 없었다는 보증은 하지 않는다.

## 코드와 가입 문구

`SettingsPrivacy`는 확정 HTML 기본값을 읽으며, UI 저장 시 본문의 SHA-256 `contentHash`를 갱신하고 기존 게시 메타데이터를 보존한다. 동일 개인정보 본문은 같은 알림 중복 키를 사용한다. 생성 0건은 중복 또는 설정으로 미생성일 수 있으므로 한 원인으로 단정하지 않는다.

`Login`은 `kind: notice`의 버튼을 ‘확인했습니다’, 완료를 ‘확인완료’로 표시한다. 기존/미지정 항목은 동의로 처리하여 호환한다. 필수 검사·순서·역할·승인·세션 로직은 변경하지 않는다. 새 가입 문서는 새 버전 ID로 등록하며 이전 항목·본문을 별도 보존한다. 기존 학생 프로필과 동의 ID를 다시 쓰지 않는다.

신규가입자의 실제 읽기 규칙에 맞게 활성 항목(`enabled == true`)만 질의하고 `order`는 로컬에서 정렬한다. 기존 무필터 질의와 규칙의 불일치를 바로잡으며 새 복합인덱스나 rules 변경은 없다. 새 항목의 기본 `enabled`도 true로 저장한다. 항목을 읽지 못했거나 0건이면 기존 상위 가입 중단 분기를 유지한다.

## 운영에서 계속 보완할 사항

게시된 방침은 실제 현황과 앞으로 지킬 처리 기준을 공개하는 것이며 아래 사항의 이행 완료 증빙은 아니다.

1. Vercel Hobby의 인증 중계에 적용할 개인정보 처리위탁 문서·보호조치, 전체 실제 처리국가와 로그 삭제 조건을 보완해야 한다. Pro/Enterprise용 DPA가 Hobby에도 동일 적용된다고 해석하지 않는다. 이번에 유료 플랜으로 바꾸거나 사업자 계약에 대신 동의하지 않았다.
2. 학생 순위·이름·게시물 등의 공개 대상, 학교의 독자 업무에 제공하는 기록, 서명 이미지 및 부가 프로필정보의 필요성과 별도 근거·선택권을 기능별로 검토해야 한다. 이번 고지를 개별 동의 획득이나 모든 공개 기능의 동의 검증 완료로 보지 않는다.
3. 이전 동의에 따른 기간·목적별 자료를 확인하여 필요한 연장 동의와 법정대리인 확인을 진행해야 한다. 이 패치는 기존 보유기간을 연장하거나 과거 동의를 복구하지 않는다.
4. 실제 졸업일·전학·탈퇴 대상 확인, 원본·파일·이전 학기별 파기, 백업 복원 시 삭제 재적용 결과를 운영자가 기록해야 한다. 이번에는 졸업일 자동 파기나 운영 학생 자료 삭제를 실행하지 않는다.
5. 연구회를 통해 전달된 보안성 검토 안내는 정식 공문·관할 절차가 확인되지 않았다. 학운위 승인·에듀집 등재를 국정원 보안성 검토 완료로 쓰지 않는다. 제출 준비는 `docs/runbooks/security-review.md`를 따른다.
6. 교사 설정의 기존 `createManagedNotifications`는 실운영에서 종료된 W8 callable이다. 향후 자동 발송을 복구하려면 현행 공지·수신·읽음 모델과 학생 NotificationBell을 함께 정비해야 한다. 이번 일회 게시를 이 자동 발송 기능의 복구로 보고하지 않는다. 기존 API를 다시 활성화하지 않았다.

## 검증·게시 기록

`npm run build` 및 최종 변경 후 별도 `npm run typecheck`, 두 TSX의 Prettier, `git diff --check`가 통과했다. 빌드에는 인증·세션·학기·수행평가 XLSX hair 테두리 등 기존 prebuild 검증을 포함한다. 기존 큰 번들·정적/동적 import 혼용 경고는 남아 있다.

실제 Login 컴포넌트를 합성 Firebase/Auth 데이터로 실행하여 390/768/1280px에서 notice 구별·필수 순서·스크롤 확인·승인대기 유지·가로 넘침을 검사했다. 최종 합성 9개 검사가 통과했고 브라우저 오류는 없었다. 로드 오류/0건에는 프로필 쓰기·포털 진입이 없고, 기존 APPROVED+privacyAgreed 계정에는 동의 항목 재조회가 없음을 확인했다. 외부 폰트 요청은 테스트에서 차단하며 운영 학생 자료를 사용하지 않았다. 기록은 작업 evidence의 `policy-notice/report.json`에 있다.

기존 전체 로그인 브라우저 검사는 105개 검사 후 변경하지 않은 classic 화면의 ‘Westory’ 제목 대기에서 timeout이 발생했다(`verify-auth-startup-browser.mjs:881`). 전체 브라우저 회귀 통과로 보고하지 않으며, 이번 변경 구간의 위 합성 검사를 별도로 수행했다.

demo rules 검사는 Firebase CLI/에뮬레이터 기동 지연으로 테스트 본문 실행 전에 중단했다. rules 자체 변경은 없으며 해당 검사를 통과했다고 기록하지 않는다.

2026-10-28 15:14 KST에 최종 원문과 신규가입 항목을 운영 Firestore에 게시하고 다시 읽어 일치 여부를 확인했다. 이전 세 가입 항목·원문·수정시각은 접근이 제한된 `legal_policy_releases/2026-10-28`의 이력과 작업 외부 백업에 보관했다. 기존 학생 프로필과 개인정보 동의 기록은 수정하지 않았다.

- 운영 코드: `c53e46fc59646f8de7908a1c8eb10fd95031bf20`.
- Vercel: `dpl_Dg3C1vRV72uLsrUY7oEC4uhGSEVV`, Production 승격 후 `www.westory.kr`에서 본문·이전 문서·실제 로그인 안내 번들을 재조회했다.
- 실제 자산: `/assets/main-Bjq5YLr6.js`, `/assets/Login-D7mbDjGi.js`.
- 공개 약관 SHA-256: `709ff7640a72f161825279ec918c93023bcbf34865f2eb0ce8a3c56040150f0c`.
- 공개 개인정보 방침 SHA-256: `2f07ca752efc4142fb72d622a8418459df30daaf98852ffd7dbc0ff720295651`.
- 신규가입 항목: `terms_20261028`(consent), `privacy_notice_20261028`(notice), 모두 활성·필수. 개인정보 안내 확인은 법정 개인정보 동의와 구분한다.
- 방재석 Chrome 프로필에서 실제 운영 설정과 공개 전문을 확인했다. 390/768/1280px의 문서 가로 넘침이 없고 이전 문서·개정 문서 링크가 표시된다. 외부 페이지로 만든 전문은 포털 탐색이 아닌 독립된 법적 문서이므로 단순 문서 목차를 사용한다.

### 전체 학생 알림

기존 UI의 저장 자체는 성공했지만 알림 callable은 `이전 학습·알림 저장 경로는 종료되었습니다`라는 오류를 반환했다. 알림이 생성되지 않은 사실을 확인한 뒤 같은 호출을 반복하거나 종료된 함수를 재활성화하지 않았다. Canonical W8 공지는 별도 `semester_notices`/delivery 모델이며 100명 상한이 있고 현재 학생 종 알림의 읽기 경로와 연결되어 있지 않다.

사용자가 승인한 이번 일회 안내에 한해 관리자 유지보수 transaction을 사용했다. 같은 거래에서 게시 영수증·약관/방침 해시·ACTIVE 학기와 manifest revision·전체/학생/해당 이벤트 알림 활성 설정·중복 문서를 확인한 후, 현재 학생 화면이 구독하는 공용 알림 한 건만 생성했다. 학생 명단·개별 답안·점수는 조회하지 않았고 사용자별 읽음/동의 기록도 쓰지 않았다. 실제 관리자 IAM 작업으로 남으며 학생 또는 교사의 앱 세션을 가장한 actorUid를 만들지 않았다.

- 생성 시각: **2026-10-28 15:21:22 KST**.
- 대상: 2026학년도 2학기 `all_students`.
- 경로: `years/2026/semesters/2/broadcast_notifications/n_9fb1dddd371c317f20d48c8f7a21c6c2b8766c6d`.
- 제목: **이용약관·개인정보 처리방침 개정 안내**.
- 클릭 동작: 기존 `privacy_policy_updated`의 방침 모달을 열며 첫머리에 개정 이용약관 전문 링크가 있다.
- 중복 키: `privacy_policy_updated:2f07ca752efc4142fb72d622a8418459df30daaf98852ffd7dbc0ff720295651`. 문서 ID는 기존 규약처럼 `broadcast:` 접두사를 포함한 키의 SHA-1이다.
- 만료: 2026-11-27 15:21 KST(기존 30일 알림 보유 규칙).

알림 원문·대상·시각·경로를 다시 읽고 게시 이력에 영수증을 연결했다. **전체 학생용 앱 알림 게시 완료**이며 이메일·SMS·외부 푸시 발송, 모든 학생의 수신·열람·동의를 확인했다는 뜻은 아니다.

## 공식 근거

- [개인정보 보호법](https://www.law.go.kr/LSW/lsInfoP.do?lsiSeq=283839), [개인정보의 안전성 확보조치 기준(2026-07-01)](https://www.law.go.kr/LSW/admRulInfoP.do?admRulSeq=2100000281400).
- [2026 개인정보 처리방침 작성지침](https://pipc.go.kr/np/cop/bbs/selectBoardArticle.do?bbsId=BS217&mCode=D010030000&nttId=12018), [공교육 에듀테크 가이드](https://cdn-object.edzip.kr/moe/main-notice/6a69af2ef2d523101057aa56_dc96bd13-628b-4100-9bd4-a74c430245b5_공교육%20에듀테크%20개인정보보호%20가이드(2026.2.).pdf).
- [교육부 학습지원 소프트웨어 선정기준](https://www.moe.go.kr/boardCnts/viewRenew.do?boardID=294&boardSeq=105007&lev=0&m=020), [교육부 개인정보 보호지침](https://www.law.go.kr/LSW/admRulLsInfoP.do?admRulSeq=2100000236216).
- [Firebase 개인정보](https://firebase.google.com/support/privacy), [Google Cloud DPA](https://cloud.google.com/terms/data-processing-addendum), [Cloud Logging 보유](https://docs.cloud.google.com/logging/docs/store-log-entries), [Firebase 인증 프록시](https://firebase.google.com/docs/auth/web/redirect-best-practices#option-3-proxy-auth-requests-to-firebaseappcom).
- [Vercel DPA](https://vercel.com/legal/dpa), [Vercel 개인정보](https://vercel.com/legal/privacy-notice), [개인정보위 국외이전 설명](https://pipc.go.kr/np/default/page.do?mCode=D060040000).
