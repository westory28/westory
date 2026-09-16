# 일반 저장 인증 변경에 따른 세션 표시 검증

## 변경 범위

- `StepUpReauthProvider.tsx`의 안내와 중요 작업 명칭만 변경했습니다. 현재 로그인 중이며 중요한 작업의 본인 확인 유효 시간 5분은 로그인 유지 시간과 별개임을 설명합니다. 기본 명칭에 `작업`이 두 번 붙던 표현도 제거했습니다.
- 학생 명단 등록·학급 이동, 위스 지급·차감·조정, 일괄 작업 등 보호 대상의 대표 명칭을 추가했습니다.
- `Header.tsx`, 세션 TTL, 인증 실행·취소·UID 경계는 변경하지 않았습니다. 새 타이머를 추가하지 않았습니다.

## 자동 검증

```powershell
node scripts/verify-session-policy.mjs
node scripts/verify-session-display-consistency.mjs
```

두 번째 스크립트는 실제 React, Header, `useShellViewport`, `sessionPolicy`, `safeStorage`, `sessionActivity`, 본인확인 Provider와 coordinator를 번들로 만들어 별도 headless 브라우저에서 실행합니다. 기존 사용자 브라우저나 열려 있는 탭에 연결하지 않습니다. 설치된 `playwright-core`를 사용하며, Windows의 Edge/Chrome 또는 `WESTORY_PLAYWRIGHT_EXECUTABLE` 실행 파일을 사용합니다.

2026-09-16 로컬 검증: 정책 검사와 실제 브라우저 54개 시나리오가 통과했습니다.

- 390px, 768px, 1280px에서 `OBSERVE_ONLY`·`DISABLED`의 desktop/mobile 타이머 DOM이 모두 없습니다. 작은 화면은 실제 모바일 메뉴를 연 상태에서도 검사합니다.
- 교사 수업 자료 → 학생 대시보드 → 관리자 설정 → 교사 수업 자료의 실제 Router 경로 전환 및 학생 계정 fixture를 검사합니다.
- 최초 진입의 구형 60분 저장값은 지워집니다. 이후 다른 탭을 모사한 storage 이벤트가 60분 또는 이미 만료된 값을 기록해도 타이머·경고·자동 로그아웃이 나타나지 않습니다.
- `ENFORCE` 양성 대조에서 실제 타이머 DOM과 일반 30분·관리자 설정 15분 값이 유지됩니다. `ENFORCE`에서 관찰 모드로 바꾸면 타이머와 저장된 기한이 제거됩니다.
- 기본 보호 작업, 공식 성적 공개, 학생 명단 등록, 위스 조정, 접근 권한 변경의 안내 문구와 취소 결과를 세 화면 폭에서 확인합니다. 가로 넘침이 없으며, 실제 스크린샷에서도 안내·입력·취소 버튼이 화면 안에 들어옵니다.
- Firebase SDK가 번들에 들어오면 실패합니다. CSP `connect-src 'none'` 및 외부 요청 차단을 적용하고, 외부 요청·브라우저 런타임 오류·console error가 있으면 실패합니다.
- 정책 단위 검사는 60분 기한을 마지막 활동 시각으로 보수적으로 변환하고, 경로 전환으로 30분·15분을 새로 부여하지 않는지 확인합니다. 서버 기한 동기화와 잘못된 기한 거부도 검사합니다.

## 수동 화면 확인

```powershell
node scripts/verify-session-display-consistency.mjs --serve-only
```

출력된 localhost URL을 별도 탭에서 열면 같은 fixture를 확인할 수 있습니다. `?mode=OBSERVE_ONLY&role=teacher&path=/teacher/settings`처럼 모드·역할·경로를 지정합니다. 본인확인 창은 fixture 콘솔에서 `sessionDisplayFixture.request('publishOfficialGrade')`로 열고 취소할 수 있습니다. 인증 제출은 fixture 범위 밖이므로 의도적으로 차단합니다.

스크린샷은 `WESTORY_SESSION_DISPLAY_SCREENSHOTS`를 별도 출력 폴더로 지정하면 저장됩니다. 검증 아티팩트는 운영 번들에 포함되지 않습니다.

## 한계와 기존 동작

인증·권한 자료, 서버 touch 응답, 알림·순위 자료는 합성 값입니다. 운영 Firebase 정책이나 실제 비밀번호 재인증 성공을 검증한 결과가 아닙니다. 실제 서버의 일반 저장 허용 및 중요 작업 보호는 별도 Functions·gateway 검사와 운영 QA가 필요합니다.

`assets/css/style.css:853`의 기존 `.hidden` 규칙은 실제 진입점 순서로 CSS를 불러올 때 Tailwind의 `.lg:flex`보다 뒤에 와서 데스크톱 `ENFORCE` 타이머를 숨깁니다. 이 검사는 해당 모드의 데스크톱 타이머 DOM·기한을 양성 대조로 삼으며 가시성 통과를 주장하지 않습니다. 모바일 `ENFORCE` 타이머 가시성은 확인했습니다. 운영 관찰 모드의 타이머 미노출과 무관한 기존 CSS는 이번 작업에서 변경하지 않았습니다.

공개 사이트의 신규 번들에는 일반 30분·관리자 설정 15분 및 `ENFORCE` 조건이 들어 있습니다. 이미 열려 있는 구형 탭은 배포만으로 교체되지 않으므로, 배포 확인 시 새 탭의 진입 번들 해시를 대조해야 합니다. 편집 중인 기존 탭의 강제 새로 고침은 수행하지 않습니다.
