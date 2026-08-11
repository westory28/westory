# 학생 전용 정기 점검 차단 핫픽스 인수인계

작성 기준: 2026-08-11 KST

## 1. 기준점과 Git 상태

- 실제 Vercel Production Git SHA: `2e5b22926551ee3869c35df6320b996fe0de50cd`
- Production deployment: `dpl_7r2BkKz1STPv5j15xstj5GArai5V`
- Production aliases: `https://www.westory.kr`, `https://westory.kr`
- Firebase Production project: `history-quiz-yongsin`
- 별도 worktree: `C:/westory-maintenance-hotfix`
- 핫픽스 branch: `hotfix/student-maintenance-gate`
- 검증된 구현 SHA: `f0c82d764b7be715c8f852109b01598f27d08e40`
- 메인 개편 worktree `C:/westory`와 W2B/W3 branch에는 checkout, reset, merge, commit을 하지 않았다.

이 문서를 추가한 최종 branch SHA는 인수인계 시점의 `git rev-parse HEAD`로 확인한다. 위 구현 SHA는 실제 앱·Rules·Functions·검증 코드 20개 파일이 포함된 고정 지점이다.

## 2. 변경 파일

구현 커밋은 20개 파일을 변경했다. 이 문서를 포함하면 핫픽스 전체 변경 파일은 21개다.

- 앱과 전역 gate: `src/App.tsx`, `src/contexts/AuthContext.tsx`, `src/pages/Login.tsx`, `src/components/common/StudentMaintenanceGate.tsx`
- 점검 설정과 화면: `src/lib/studentMaintenance.ts`, `src/pages/student/Maintenance.tsx`, `src/assets/index.css`, `assets/css/style.css`, `DESIGN.md`
- Firebase 초기화: `src/lib/firebase.ts`
- 서버 fence: `firestore.rules`, `storage.rules`, `functions/studentMaintenance.js`, `functions/index.js`, `functions/sourceArchiveBeta.js`
- 검증: `scripts/verify-student-maintenance-rules.mjs`, `functions/scripts/verify-student-maintenance.cjs`, `package.json`, `functions/package.json`
- Vercel route/cache: `vercel.json`
- 인수인계: `docs/handoff/student-maintenance-gate-handoff.md`

## 3. 단일 maintenance 설정

설정 문서는 `site_settings/student_maintenance` 하나를 기준으로 한다.

```text
enabled: boolean
blockedRoles: ["student"]
bypassUids: string[]            # 최대 20개, 공백·중복 불가
title: string                   # 1~80자
message: string                 # 1~500자
startedAt: Timestamp | null     # enabled=true이면 Timestamp, false이면 null
updatedAt: Timestamp
updatedBy: string
revision: non-negative integer
```

필드는 위 9개만 허용한다. 클라이언트, Functions, Firestore Rules, Storage Rules가 같은 형식과 학생 전용 `blockedRoles`를 검증한다. 문서가 없으면 점검 비활성화로 처리하지만, 존재하는 문서가 깨졌거나 읽기에 실패하면 fail-closed로 처리한다.

설정 변경은 관리자 전용 callable `updateStudentMaintenanceConfig`만 수행한다. 클라이언트의 직접 쓰기는 관리자 계정도 허용하지 않는다. 변경 전후 값과 작업자, revision은 `site_settings/student_maintenance/audit/*`에 남는다. 관리자는 malformed 설정 상태에서도 해당 callable로 복구할 수 있다.

## 4. 전역 route gate

- 인증·설정 bootstrap: `src/contexts/AuthContext.tsx`
- Router 전역 gate: `src/components/common/StudentMaintenanceGate.tsx`
- Router 연결과 `/maintenance` route: `src/App.tsx`
- 로그인 직후 재확인: `src/pages/Login.tsx`

Auth bootstrap은 본인 사용자 문서와 maintenance 설정만 먼저 읽는다. 허용 판정 전에는 기존 전역 설정, 메뉴, protected child, 주요 listener를 시작하지 않는다. 학생, 프로필 누락, 잘못된 role, 설정 오류는 보호 화면을 먼저 표시하고 `/maintenance`로 보낸다. 교사·관리자·명시된 bypass UID는 기존 진입 경로를 유지한다.

Vercel의 clean `/student/:path*`, `/teacher/:path*`, `/maintenance` 요청은 `/index.html`로 rewrite한다. 앱은 clean 경로를 HashRouter 경로로 동기화한 뒤 같은 렌더에서 gate를 mount한다. 익명 사용자의 protected URL은 로그인 화면으로 이동하며, 로그인 결과가 학생이면 즉시 점검 화면으로 전환된다.

## 5. 서버 측 fence

### Firestore

`firestore.rules`의 기존 접근 판단 앞에 `canUseWestory()`를 결합했다. 점검 중 학생과 role 누락·오염 계정의 주요 read/write를 거부한다. 본인 `users/{uid}` 문서와 maintenance 설정 읽기만 판정에 필요한 최소 예외로 둔다. 설정 및 audit의 클라이언트 쓰기는 항상 거부한다.

### Functions

기존 callable 39개를 공통 `onCall` wrapper로 감쌌다. 서버가 maintenance 설정과 `users/{uid}.role`을 직접 읽어 학생 요청을 거부한다. 새 관리자 설정 callable을 포함하면 callable은 40개다. schedule 2개와 Storage event 2개에는 사용자 호출 경계가 없어 wrapper를 적용하지 않았다.

### Storage

`storage.rules`가 같은 설정과 서버 사용자 role을 기준으로 학생 read/write를 거부한다. 기존 파일 형식·크기·교사 권한 조건은 완화하지 않았다.

오래된 번들이나 직접 Firebase SDK 호출도 위 세 서버 fence를 통과할 수 없다. 현재 Production 소스에는 service worker, Workbox, Cache Storage 등록 코드가 없으며 manifest만 있다. 실제 브라우저에서도 service worker 등록 0개와 Cache Storage key 0개를 확인했다.

## 6. Westory 점검 페이지

- route: `/maintenance`와 `#/maintenance`
- UI: `src/pages/student/Maintenance.tsx`
- asset: repository의 `public/icons/westory-icon-192.png`와 기존 HTML wordmark
- 스타일: `src/assets/index.css`와 기존 Westory token

점검 화면은 반응형 HTML이며 Firebase Storage asset에 의존하지 않는다. 390, 768, 1024, 1280, 1600px에서 확인했고, 390px와 1280px 격리 Preview에서 axe WCAG A/AA 위반 0건을 확인했다. 종료 시각은 표시하지 않는다.

## 7. 환경별 상태와 기본값

| 환경 | Firebase 연결 | maintenance 기본값 | 현재 상태 |
|---|---|---|---|
| 기존 Production | `history-quiz-yongsin` | 설정 문서가 없으면 비활성화 | 기존 배포·Rules·Functions·설정 모두 변경하지 않음 |
| Hotfix Preview | 가짜 `demo-westory-maintenance` build env | 실제 데이터 없음 | 별도 Vercel 프로젝트, SSO 보호 활성화 |
| Local QA | Firebase Emulator `demo-westory-maintenance` | fixture로 활성/비활성/오염 상태 전환 | 합성 계정과 최소 fixture만 사용 |
| W3 Dedicated Staging | 기존 W3 설정 유지 | 변경 없음 | alias, 환경변수, Rules, Functions 모두 건드리지 않음 |

격리 Preview 프로젝트는 `westory-maintenance-hotfix-preview`이고 최종 검증 배포는 다음과 같다.

- deployment: `dpl_CTEdo8gdUw7fnaKrfpjwbjqX7JZT`
- URL: `https://westory-maintenance-hotfix-preview-pvc3d9eyd.vercel.app`
- target/status: `preview` / `READY`
- 운영 Firebase project ID 문자열 포함: 없음
- fake Firebase project ID 문자열 포함: 확인
- SSO 보호: 검증 후 다시 활성화

## 8. 검증 결과

- `npm run build`: 통과
- `npm run format:check`: 통과
- `npm --prefix functions run check`: 통과
- `npm --prefix functions run verify:student-maintenance`: 19개 통과
- `npm run verify:student-maintenance-functions`: 65개 통과
- `git diff --check`: 통과
- Firestore/Storage/Callable: 학생·누락 role·오염 role 거부, 교사·관리자·bypass 허용
- 비활성화와 설정 문서 미존재: 기존 접근 복귀
- malformed/extra-key 설정: Firestore·Storage·Functions 모두 fail-closed
- 관리자 복구와 audit 생성: 통과
- clean 학생·교사·점검 URL: 200과 SPA 진입 확인
- root/index/학생/교사/점검 HTML: `Cache-Control: no-store`
- manifest: `Cache-Control: no-cache, max-age=0, must-revalidate`
- 학생 Auth 계정 비활성화·삭제: 0
- 기존 학생 데이터 변경과 Production migration: 0
- W1/W2/W3 코드 유입과 GitHub Pages 재활성화: 0

## 9. Production 활성화 상태와 적용 순서

현재는 준비만 끝난 상태다. 기존 `westory` Vercel Production, Firebase Rules, Functions, Storage Rules, maintenance 설정을 배포하거나 변경하지 않았다.

사용자의 명시적 승인 뒤에만 다음 순서로 적용한다.

1. 기존 Vercel deployment, Firestore/Storage ruleset, Functions source를 rollback point로 다시 확인한다.
2. 핫픽스 웹, Firestore Rules, Storage Rules, Functions를 Production에 배포한다.
3. maintenance 설정이 없거나 `enabled=false`인 상태에서 학생·교사 회귀 검증을 먼저 한다.
4. 승인받은 title, message, bypass UID로 관리자 callable을 호출해 `enabled=true`로 전환한다.
5. 학생 전체 URL과 직접 SDK·Functions·Storage 거부를 확인한다.
6. 교사·관리자 정상 접근과 audit 기록을 확인한다.

## 10. Rollback

가장 빠른 기능 해제는 관리자 callable로 `enabled=false`를 저장하는 것이다. 이때 `startedAt=null`과 증가한 revision이 audit에 남는다.

코드 rollback이 필요하면 다음 known-good 지점을 사용한다.

- Vercel: `dpl_7r2BkKz1STPv5j15xstj5GArai5V`로 Production alias 복구
- Git: `2e5b22926551ee3869c35df6320b996fe0de50cd`
- Firestore ruleset: `36de907e-9fbf-41eb-b084-95a1419bf097`
- Storage ruleset: `7a52c62c-6075-4b2a-80ec-99f0c8a13a8c`
- Functions source hash: `715a23ee3350c1eb9eb230e742b6836d089bf043`

웹만 되돌리고 서버 fence를 방치하거나, 서버 fence만 제거하고 점검 화면을 남기지 않는다. 설정 해제 후 웹·Rules·Functions·Storage를 같은 rollback 지점으로 맞춘다.

## 11. W3 통합 항목

메인 개편에는 아직 merge하지 않는다. W3가 완료된 뒤 구현 SHA를 기준으로 다음 계약을 새 구조에 이식한다.

- 단일 maintenance schema와 관리자 audit callable
- Auth bootstrap의 최소 선행 read와 전역 gate
- 로그인 직후 fresh maintenance 판정
- 모든 W3 callable에 적용되는 서버 wrapper
- W3 Firestore/Storage Rules의 `canUseWestory` 결합
- clean URL rewrite와 HTML no-store 정책
- Westory 점검 페이지와 접근성 token
- Emulator 65개 시나리오를 W3 경로·함수 목록에 맞게 갱신

충돌 가능성이 높은 파일은 `src/App.tsx`, `src/contexts/AuthContext.tsx`, `src/pages/Login.tsx`, `src/lib/firebase.ts`, `firestore.rules`, `storage.rules`, `functions/index.js`, `functions/sourceArchiveBeta.js`, `src/assets/index.css`, `assets/css/style.css`, `DESIGN.md`, `vercel.json`이다. 새로 만든 gate, maintenance lib/page, Functions helper, 검증 스크립트는 비교적 독립적이다.

## 12. W3 통합 acceptance test

- 활성화 상태에서 student가 로그인 직후와 모든 canonical/legacy URL, 새로고침, 뒤로가기, 앞/뒤 새 탭에서 점검 화면으로 귀결된다.
- protected child, 전역 listener, 주요 query가 허용 판정 전에 mount되지 않는다.
- Firestore read/write, callable/HTTP Functions, Storage read/write가 이전 번들과 직접 SDK에서도 학생을 거부한다.
- teacher, admin, 명시된 bypass UID는 대표 read/write와 기존 portal route를 정상 이용한다.
- 설정 문서 미존재와 `enabled=false`에서 기존 권한 체계가 복원된다.
- role 누락·오염과 설정 읽기 실패·schema 오염은 fail-closed다.
- 관리자 외 설정 변경이 불가능하고 활성/비활성 audit가 남는다.
- 390, 768, 1024, 1280, 1600px와 키보드·스크린리더 기본 접근성을 다시 확인한다.
- Production data migration, 학생 Auth 계정 변경, W3 staging alias/Rules/Functions 변경이 없어야 한다.

최종 판정: `READY FOR PRODUCTION STUDENT MAINTENANCE ACTIVATION`
