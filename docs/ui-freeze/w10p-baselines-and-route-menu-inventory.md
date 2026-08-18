# W10P 기능·Presentation 기준 및 route·menu inventory

작성일: 2026-08-18 (KST)

작업 브랜치: `codex/phase6-w10p-presentation-freeze`

## 1. 동결 기준

| 구분 | 확정 기준 | 사용 원칙 |
| --- | --- | --- |
| 기능·보안 기준 | `ef74b571a6964ddbc61eb7877a98d21b3c7c8c85` (W11) | 인증, 권한, 학기 범위, command gateway, 조회 순수성, receipt·audit, 재인증, 중복 효과 방지 계약을 유지한다. |
| Presentation 기준 | `676869fa289d3e7ecef234cbb5cca65c60ec4597` (현재 Production 배포 source) | 기존 route의 DOM, className, 문구, 메뉴명·순서·계층, breakpoint, 자산과 시각 결과를 복원 기준으로 삼는다. |
| 거절 상태 보존 | 브랜치 `codex/phase6-w10r-ui-recovery`, checkpoint `10eebacc7a814e4b20d89d8f14a1d49924ccecb4`, UI source `7ddfd7202ba3e59eb9e9ded5d105dde4d604693b` | W10R 디자인은 참고·재사용하지 않으며 기존 브랜치와 evidence를 변경하지 않는다. |

세 커밋은 모두 로컬 Git object로 확인했다. Production과 W11의 merge-base는 `2e5b22926551ee3869c35df6320b996fe0de50cd`이며, 좌우 커밋 수는 `5 / 58`이다. 따라서 W11 조상인 별도 UI 커밋을 Production Presentation 기준으로 대체하지 않는다.

작업은 원본 checkout `C:\westory`와 분리한 `C:\westory-w10p`에서 수행한다. Production 소스는 잠금 처리한 읽기 전용 비교 worktree `C:\westory-w10p-production-ui-676869f`에서 확인한다. 원본 checkout의 사용자 소유 미커밋 파일은 W10P stage·commit 대상에서 제외한다.

## 2. 시작 Production fingerprint

읽기 전용 조회로 다음 값을 기록했다. 이 단계에서 Production 쓰기, 배포, alias 변경, 데이터·Auth·IAM·Maintenance 변경은 모두 0건이다.

| 항목 | 시작값 |
| --- | --- |
| Vercel project | `prj_cXVfJEtQHVAZrOoJqeHdWetywTmH` |
| Deployment | `dpl_9CYX35wz4S5M7adhPun6hiohEx1F` / `READY` / target `production` |
| Immutable URL | `westory-70z9g2tvv-bbbs-projects-44f9da30.vercel.app` |
| Alias | `westory.kr`, `www.westory.kr` |
| 공개 응답 | apex `307` → `www`, `www` `200` |
| HTML SHA-256 | `352d97afe2f653a57674fdfd91e9ec0afb86410901bd6e5809717cea8fed81ba` |
| main JS SHA-256 | `87bb33fa8cb94b3654a7d6a994efef7678473fc7ec0cbe95ea01e2e4beb7f5a3` |
| main CSS SHA-256 | `fd9beedb09ee59593d2a340dc32bba374b1e40d45488f58f3e31b0e385e6697a` |
| Firebase Functions | 44/44 `ACTIVE`, 공통 source hash `f3a19da8908e23384d49d3295b38839b48a8a3b3` |
| Firestore ruleset | `84165f2f-9e64-4a6e-b6b5-c4cc40c80b42` |
| Storage ruleset | `2185308f-7a13-4804-bb04-88e7a4eb0eb8` |

## 3. route 수 산정 규칙과 시작값

1. 기능 기준 source는 W11 `src/App.tsx`의 실제 `<Route path>` 48개다.
2. `LegacyRouteRedirect`를 렌더하는 path는 접근 호환 별칭으로 유지하되 canonical 화면 수에서 제외한다.
3. 같은 component를 렌더하더라도 redirect가 아닌 서로 다른 path는 각각 canonical route로 센다. 이에 따라 `/student/calendar`와 `/student/schedule`은 각각 보존한다.
4. query/tab은 별도 router pattern이 아니므로 canonical route 수를 늘리지 않는다. 다만 menu target 완전성에서는 query를 포함한 URL을 별도로 검증한다.
5. `/teacher/settings`와 `/teacher/settings/cutover`는 teacher namespace에 있지만 `canManageSettings`로 잠긴 관리자 canonical route로 분리한다.
6. `/maintenance`, `/developer-log`, `/developer-log/:postId`, `/`, `*`는 역할별 화면 수와 섞지 않고 공개·지원·경계 route로 분리한다.

W11 시작 router는 레거시 lesson 네 path까지 W8 화면으로 redirect하여 별칭이 여덟 개였다.

| W11 시작 분류 | Raw pattern | 호환 별칭 | Canonical 화면 |
| --- | ---: | ---: | ---: |
| 학생 | 24 | 4 | **20** |
| 교사(관리자 전용 2개 제외) | 17 | 4 | **13** |
| 관리자 | 2 | 0 | **2** |
| 공개·지원·경계 | 5 | 0 | **5** |
| 합계 | **48** | **8** | **40** |

시작 별칭은 history2 네 패턴 외에 `/student/lesson/note`, `/student/lesson/think-cloud`, `/teacher/lesson`, `/teacher/lesson/think-cloud`이었다. 이 네 path는 Production의 실제 기존 화면이며, W10P에서는 W11 동작을 adapter로 연결한 canonical 화면으로 다시 분류한다. 이에 따른 **W10P 통합 목표 inventory**는 다음과 같다.

| W10P 목표 분류 | Raw pattern | 호환 별칭 | Canonical 화면 |
| --- | ---: | ---: | ---: |
| 학생 | 24 | 2 | **22** |
| 교사(관리자 전용 2개 제외) | 17 | 2 | **15** |
| 관리자 | 2 | 0 | **2** |
| 공개·지원·경계 | 5 | 0 | **5** |
| 합계 | **48** | **4** | **44** |

목표 호환 별칭은 `/student/quiz/history2`, `/student/quiz/history2/*`, `/teacher/quiz/history2`, `/teacher/quiz/history2/*`이며 각각 현재 quiz canonical route로 이동한다.

참고로 실제 Production source의 raw pattern은 39개다. 명시적 history2 별칭을 접으면 학생 17, 교사 12, 관리자 1, 공개·지원·경계 5 화면이다. W10P 목표는 이 Presentation route에 W2–W11 new-only route를 합친 값이다.

## 4. W10P 목표 canonical route inventory

### 학생 22

- `/student/dashboard`
- `/student/lesson/note`
- `/student/lesson/history-dictionary`
- `/student/lesson/maps`
- `/student/lesson/think-cloud`
- `/student/quiz`
- `/student/quiz/run`
- `/student/history-classroom`
- `/student/history-classroom/run`
- `/student/score`
- `/student/score/report`
- `/student/score/performance`
- `/student/score/written-exam`
- `/student/mypage`
- `/student/mypage/archive`
- `/student/history`
- `/student/points`
- `/student/calendar`
- `/student/learning`
- `/student/schedule`
- `/student/attendance`
- `/student/communication`

### 교사 15

- `/teacher/dashboard`
- `/teacher/students`
- `/teacher/quiz`
- `/teacher/quiz/history-classroom`
- `/teacher/exam`
- `/teacher/points`
- `/teacher/schedule`
- `/teacher/lesson`
- `/teacher/lesson/history-dictionary`
- `/teacher/lesson/maps`
- `/teacher/lesson/source-archive`
- `/teacher/lesson/think-cloud`
- `/teacher/learning`
- `/teacher/attendance`
- `/teacher/communication`

### 관리자 2

- `/teacher/settings`
- `/teacher/settings/cutover`

### 공개·지원·경계 5

- `/`
- `/maintenance`
- `/developer-log`
- `/developer-log/:postId`
- `*`

## 5. Production 기존 메뉴 동결값

아래 이름, 상위 순서, 하위 순서와 URL은 Presentation 기준 commit의 `src/constants/menus.ts`에서 확정했다. 기존 항목은 삭제·개명·재분류하지 않는다.

### 학생 메뉴

| 순서 | 상위 메뉴 | URL | 기존 하위 메뉴(정의 순서) |
| ---: | --- | --- | --- |
| 1 | 학습 | `/student/lesson/note` | 수업 자료 → `/student/lesson/note`; 역사 사전 → `/student/lesson/history-dictionary`; 지도 → `/student/lesson/maps`; 싱크 클라우드 → `/student/lesson/think-cloud` |
| 2 | 평가 | `/student/quiz` | 문제 풀이 → `/student/quiz`; 역사교실 → `/student/history-classroom` |
| 3 | 점수 | `/student/score` | 성적 계산기 → `/student/score`; 나의 성적 리포트 → `/student/score/report`; 내 수행평가 점수 → `/student/score/performance`; 내 정기시험 점수 → `/student/score/written-exam`; 정기 시험 답안 → `/student/history` |
| 4 | 위스 | `/student/points` | 내 위스 → `/student/points`; 화랑의 전당 → `/student/points?tab=hall-of-fame`; 위스 상점 → `/student/points?tab=shop`; 구매 내역 → `/student/points?tab=orders` |
| 5 | 마이페이지 | `/student/mypage` | 없음 |

Production 동결값은 상위 5개, 하위 15개, node 20개, unique URL 16개다.

### 교사 메뉴

| 순서 | 상위 메뉴 | URL | 기존 하위 메뉴(정의 순서) |
| ---: | --- | --- | --- |
| 1 | 학습 자료 관리 | `/teacher/lesson` | 수업 자료 → `/teacher/lesson`; 역사 사전 관리 → `/teacher/lesson/history-dictionary`; 지도 → `/teacher/lesson/maps`; 사료 창고 → `/teacher/lesson/source-archive`; 싱크 클라우드 관리 → `/teacher/lesson/think-cloud` |
| 2 | 평가 관리 | `/teacher/quiz` | 문제 등록 → `/teacher/quiz`; 응시 현황 → `/teacher/quiz?tab=log`; 문제 은행 → `/teacher/quiz?tab=bank`; 역사교실 → `/teacher/quiz/history-classroom` |
| 3 | 점수 관리 | `/teacher/exam` | 평가 반영 비율 → `/teacher/exam`; 정기시험 답안 → `/teacher/exam?tab=omr`; 수행평가 점수 관리 → `/teacher/exam?tab=performance`; 정기시험 점수 관리 → `/teacher/exam?tab=written-essay` |
| 4 | 위스 관리 | `/teacher/points` | 위스 현황 → `/teacher/points`; 지급 및 환수 → `/teacher/points?tab=grant`; 운영 정책 → `/teacher/points?tab=policy`; 화랑의 전당 관리 → `/teacher/points?tab=hall-of-fame`; 상품 관리 → `/teacher/points?tab=products`; 구매 요청 관리 → `/teacher/points?tab=requests` |
| 5 | 학생 관리 | `/teacher/students` | 없음 |

Production 동결값은 상위 5개, 하위 19개, node 24개, unique URL 20개다.

## 6. W2–W11 기능 route의 메뉴 합집합 원칙

기존 다섯 상위 메뉴와 기존 하위 항목의 상대 순서는 그대로 둔다. W2–W11에서 추가된 정상 사용자 화면은 의미가 맞는 기존 dropdown의 **마지막**에만 추가한다.

- 학생 `학습` 끝: 학습 현황, 일정, 출석, 공지·소통, 지난 학기
- 교사 `학습 자료 관리` 끝: 학습 운영, 일정, 출석, 공지·소통
- 관리자 학기 전환은 관리자 설정 안의 기존 동선에서 연결한다.
- quiz/history-classroom 실행 route는 부모 화면의 context action으로 접근한다.
- `/student/calendar`처럼 router에는 있으나 기존 메뉴에 없던 호환 화면은 직접 URL만 남기지 않고, 기존 Presentation을 바꾸지 않는 정상 접근 동선 또는 명시적 호환 정책을 통합 단계에서 검증한다.

설정에서 저장한 `menuConfig`의 이름·순서·상하위와 권한 필터도 Production Header 계약으로 유지한다. 모바일과 데스크톱은 같은 설정 source를 사용하며 viewport에 따라 항목이 사라지지 않아야 한다.

## 7. 기준 판정

`W10P FUNCTION AND PRESENTATION BASELINES CONFIRMED`

이 판정은 source·불변 fingerprint·route/menu 기준의 확정을 뜻한다. 화면별 visual parity와 기능 회귀는 이후 checkpoint에서 별도로 판정한다.
