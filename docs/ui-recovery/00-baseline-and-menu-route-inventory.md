# W10R 기준점과 메뉴·라우트 인벤토리

상태: 기준점·내비게이션 복구 완료, 사용자 시각 승인 대기
작성일: 2026-08-17 (KST)

## 1. 동결한 기준점

| 구분                  | SHA / 위치                                                                      | 사용 목적                                                   | 변경 여부      |
| --------------------- | ------------------------------------------------------------------------------- | ----------------------------------------------------------- | -------------- |
| 기능·보안·데이터 기준 | `ef74b571a6964ddbc61eb7877a98d21b3c7c8c85`                                      | W11 최종 기능, 권한, 세션, Rules, Functions, 학기 전환 계약 | 보존           |
| 시각 기준             | `c735055608cdc06bd2b6324f92662f88149f6966`                                      | W5 전역 사이드바 도입 직전의 Header·MainLayout·메뉴·CSS     | 읽기 전용 비교 |
| 운영 계보 보조 기준   | `2e5b22926551ee3869c35df6320b996fe0de50cd` (`pre-2026-sem2-rebuild-2026-08-07`) | 실제 Production 사용 계보 확인                              | 읽기 전용      |
| W10R 작업 브랜치      | `codex/phase6-w10r-ui-recovery`                                                 | 다섯 기준 화면과 공통 기반 구현                             | 전용 작업 트리 |

시각 기준은 W1 캡처 source SHA `832610e…`와 `c735055…`의 `MainLayout`, `Header`, `menus`, `assets/css/style.css` blob이 모두 byte-identical임을 확인해 확정했습니다. `c735055…`는 `<Header />`, 상단 desktop navigation, Footer를 유지한 마지막 commit입니다. 바로 다음 W5 commit부터 248px 전역 교사 sidebar가 들어왔으며 해당 AppShell/MainLayout blob은 W9·W10·W11에도 그대로 남아 있습니다. 따라서 W9는 복구용 시각 기준으로 쓰지 않습니다.

작업 경로는 `C:\westory-w10r`, 읽기 전용 비교 경로는 `C:\westory-w10r-legacy-c735055`입니다. 사용자 변경이 있는 원본 `C:\westory`는 수정하지 않습니다.

## 1.1 Production 시작·종료 fingerprint

시작 시각 2026-08-17 13:23 KST와 후속 Staging 비교·fixture cleanup 이후 최종 closeout 시각 2026-08-17 16:18:46 KST에 읽기 전용으로 비교했습니다. Production 쓰기·배포·alias 변경은 전 구간 0건입니다.

| 항목                         | 시작 값                                                            | 종료 값                                                          | 비교            |
| ---------------------------- | ------------------------------------------------------------------ | ---------------------------------------------------------------- | --------------- |
| Firebase Functions           | 44/44 `ACTIVE`, `GEN_2`, `asia-northeast3`                         | 동일                                                             | 일치            |
| Functions source hash        | `f3a19da8908e23384d49d3295b38839b48a8a3b3`                         | 동일, 44개 모두 단일 hash                                        | 일치            |
| Firestore ruleset            | `84165f2f-9e64-4a6e-b6b5-c4cc40c80b42`                             | 동일                                                             | 일치            |
| Storage ruleset              | `2185308f-7a13-4804-bb04-88e7a4eb0eb8`                             | 동일                                                             | 일치            |
| 공개 도메인                  | `westory.kr` 307 → `www.westory.kr` 200, Vercel                    | 동일                                                             | 일치            |
| 공개 HTML SHA-256            | `352d97afe2f653a57674fdfd91e9ec0afb86410901bd6e5809717cea8fed81ba` | 동일                                                             | 일치            |
| Vercel Production deployment | 시작 시 exact mapping 재조회 불가                                  | `dpl_9CYX35wz4S5M7adhPun6hiohEx1F`, `READY`, target `production` | W11 기록과 일치 |

최종 closeout 감사에서는 Functions·Firestore·Storage와 인증된 `vercel inspect www.westory.kr`, 공개 HTML을 모두 다시 조회해 alias의 exact deployment mapping과 200 응답·1,380 bytes까지 직접 확인했습니다. 이 작업의 배포 대상은 별도 Dedicated Staging 프로젝트뿐이며 Production 상태는 시작값에서 바뀌지 않았습니다.

## 2. 메뉴 source of truth 진단

감사 시점의 W11에는 메뉴 정의가 두 군데로 갈라져 있었습니다.

| 소스                             |            학생 |            교사 | 실제 W11 AppShell 반영                                               |
| -------------------------------- | --------------: | --------------: | -------------------------------------------------------------------- |
| `src/constants/menus.ts`         | 상위 5, 하위 15 | 상위 5, 하위 19 | Firebase 설정 보정에는 사용되지만 AppShell 구조에는 직접 쓰이지 않음 |
| `src/constants/routeMetadata.ts` |          상위 5 |          상위 8 | AppShell이 상위 항목만 사용                                          |

P0 결함은 다음과 같습니다.

- 학생 top/bottom navigation은 하위 항목을 그리지 않고, `더보기` drawer의 일부 항목만 예외적으로 노출합니다.
- 교사 sidebar와 drawer는 하위 항목을 전혀 그리지 않습니다.
- `menus.ts`에 남아 있는 지도, 사료 보관함, 역사 사전, 문제 은행·응시 현황 같은 기능이 route로는 존재하지만 정상적인 메뉴 탐색에서 사라졌습니다.
- `lesson_read` 권한 사용자의 기본 `/teacher/lesson` redirect가 `/teacher/learning`으로 향하지만, 도착 route는 `canManageW8Domains` 권한을 요구해 권한 화면으로 끝나는 불일치가 있습니다.
- 학생과 교사 menu 설정의 label·order와 실제 shell이 서로 다른 소스를 사용해 운영 설정이 화면에 일관되게 반영되지 않습니다.

W10R에서는 `routeMetadata.ts`가 역할별 `NAVIGATION_REGISTRY`를 명시적으로 export하고 AppShell이 그 registry를 직접 소비하도록 통합했습니다. 저장된 사용자 정의 메뉴의 이름·순서·상하위 관계를 보존하면서 route metadata, 권한 predicate, active matching, 하위 메뉴를 한 계약으로 검증하고 기존 export도 호환성을 위해 유지합니다.

## 3. 등록 route 48개

`src/App.tsx`의 route pattern은 총 48개이며 exact duplicate는 0개입니다. W10 동결 manifest 47개와 W11 학기 전환 route 1개로 구성됩니다.

|   # | Route                                | 역할   | 메뉴 성격 / W10R 처리                                |
| --: | ------------------------------------ | ------ | ---------------------------------------------------- |
|   1 | `/`                                  | 공개   | 로그인 진입, 메뉴 제외                               |
|   2 | `/maintenance`                       | 학생   | 유지보수 경계, 메뉴 제외                             |
|   3 | `*`                                  | 공통   | Not Found, 메뉴 제외                                 |
|   4 | `/developer-log`                     | 보조   | 개발 기록, 전역 메뉴 제외                            |
|   5 | `/developer-log/:postId`             | 보조   | 개발 기록 상세, 전역 메뉴 제외                       |
|   6 | `/student/dashboard`                 | 학생   | 오늘, 전역 메뉴                                      |
|   7 | `/student/learning`                  | 학생   | 학습 허브, 전역 메뉴                                 |
|   8 | `/student/lesson/note`               | 학생   | 학습 중 문맥 route                                   |
|   9 | `/student/lesson/history-dictionary` | 학생   | 학습 하위 메뉴 복구                                  |
|  10 | `/student/lesson/maps`               | 학생   | 학습 하위 메뉴 복구                                  |
|  11 | `/student/lesson/think-cloud`        | 학생   | 학습 하위 메뉴 복구                                  |
|  12 | `/student/quiz`                      | 학생   | 평가, 전역 메뉴                                      |
|  13 | `/student/quiz/run`                  | 학생   | 평가 진행 중 문맥 route                              |
|  14 | `/student/history-classroom`         | 학생   | 평가 하위 메뉴 복구                                  |
|  15 | `/student/history-classroom/run`     | 학생   | 과제 진행 중 문맥 route                              |
|  16 | `/student/score`                     | 학생   | 성적, 전역 메뉴                                      |
|  17 | `/student/score/report`              | 학생   | 성적 하위 메뉴 복구                                  |
|  18 | `/student/score/performance`         | 학생   | 성적 하위 메뉴 복구                                  |
|  19 | `/student/score/written-exam`        | 학생   | 성적 하위 메뉴 복구                                  |
|  20 | `/student/history`                   | 학생   | 정기시험 답안 하위 메뉴 복구                         |
|  21 | `/student/points`                    | 학생   | 더보기 하위 메뉴                                     |
|  22 | `/student/calendar`                  | 학생   | `/student/schedule` 호환 일정 route                  |
|  23 | `/student/schedule`                  | 학생   | 더보기 하위 메뉴                                     |
|  24 | `/student/attendance`                | 학생   | 더보기 하위 메뉴 복구                                |
|  25 | `/student/communication`             | 학생   | 더보기 하위 메뉴 복구                                |
|  26 | `/student/mypage`                    | 학생   | 더보기 하위 메뉴                                     |
|  27 | `/student/mypage/archive`            | 학생   | 지난 학기 읽기 전용 하위 메뉴                        |
|  28 | `/student/quiz/history2`             | 학생   | legacy alias → `/student/quiz`, 메뉴 제외            |
|  29 | `/student/quiz/history2/*`           | 학생   | legacy wildcard alias → `/student/quiz`, 메뉴 제외   |
|  30 | `/teacher/dashboard`                 | 교사   | 업무 홈, 권한별 전역 메뉴                            |
|  31 | `/teacher/students`                  | 교사   | 학생과 학급, 권한별 전역 메뉴                        |
|  32 | `/teacher/learning`                  | 교사   | 수업 운영 허브, 권한별 전역 메뉴                     |
|  33 | `/teacher/lesson`                    | 교사   | 수업 자료 관리 문맥 route; 권한 redirect 정합성 검증 |
|  34 | `/teacher/lesson/history-dictionary` | 교사   | 수업 운영 하위 메뉴 복구                             |
|  35 | `/teacher/lesson/maps`               | 교사   | 수업 운영 하위 메뉴 복구                             |
|  36 | `/teacher/lesson/source-archive`     | 교사   | 수업 운영 하위 메뉴 복구                             |
|  37 | `/teacher/lesson/think-cloud`        | 교사   | 수업 운영 하위 메뉴 복구                             |
|  38 | `/teacher/quiz`                      | 교사   | 평가 운영, 하위 tab 메뉴 복구                        |
|  39 | `/teacher/quiz/history-classroom`    | 교사   | 평가 운영 하위 메뉴 복구                             |
|  40 | `/teacher/quiz/history2`             | 교사   | legacy alias → `/teacher/quiz`, 메뉴 제외            |
|  41 | `/teacher/quiz/history2/*`           | 교사   | legacy wildcard alias → `/teacher/quiz`, 메뉴 제외   |
|  42 | `/teacher/exam`                      | 교사   | 성적 운영, 하위 tab 메뉴 복구                        |
|  43 | `/teacher/points`                    | 교사   | 위스 운영, 하위 tab 메뉴 복구                        |
|  44 | `/teacher/schedule`                  | 교사   | 일정과 소통, 권한별 전역 메뉴                        |
|  45 | `/teacher/attendance`                | 교사   | 일정과 소통 하위 메뉴 복구                           |
|  46 | `/teacher/communication`             | 교사   | 일정과 소통 하위 메뉴 복구                           |
|  47 | `/teacher/settings`                  | 관리자 | 관리자 설정, `canManageSettings`만 노출              |
|  48 | `/teacher/settings/cutover`          | 관리자 | 학기 전환 준비, `canManageSettings`만 노출           |

## 4. 역할별 노출 계약

| 사용자           | 전역 메뉴 원칙                                              | 금지 사항                                                          |
| ---------------- | ----------------------------------------------------------- | ------------------------------------------------------------------ |
| 학생             | 오늘·학습·평가·성적·더보기, 모바일 bottom nav + More drawer | 교사 route 노출, 진행 중 route를 별도 전역 메뉴로 노출             |
| 일반 교사        | 권한 predicate가 허용한 업무 홈·학생·평가·성적 등           | 관리자 설정·학기 전환 노출                                         |
| 세부 권한 교직원 | `canRead*`, `canManage*`별 최소 메뉴                        | 숨김만으로 route 권한을 대체하거나 접근 불가 route로 기본 redirect |
| 관리자           | 교사 메뉴 + 관리자 설정·학기 전환                           | Production 전환 action, 내부 상태 코드를 일반 사용자 문구로 노출   |

최종 검증 결과 canonical menu 48/48, 복구 대상 36/36, orphan route 0, dead link 0, exact duplicate 0, 권한 없는 노출 0, 기존 메뉴 누락 0입니다. 진행 중 route, alias, 오류·로그인 경계는 의도적으로 전역 메뉴에서 제외하되 부모 metadata로 추적합니다.
