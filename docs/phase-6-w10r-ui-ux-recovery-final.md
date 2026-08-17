# Phase 6 W10R UI/UX Recovery

현재 판정: `W10R CANONICAL SCREENS READY — USER VISUAL ACCEPTANCE PENDING`

## 기준과 배포

- 기능 기준점: `ef74b571a6964ddbc61eb7877a98d21b3c7c8c85`
- 시각 기준점: `c735055608cdc06bd2b6324f92662f88149f6966`
- 운영 계보 보조 기준: `2e5b22926551ee3869c35df6320b996fe0de50cd`
- W10R 구현 커밋: `7ddfd7202ba3e59eb9e9ded5d105dde4d604693b`
- 전체 checkpoint SHA: 증거·문서 커밋 후 최종 handoff에서 별도로 보고
- 작업 브랜치: `codex/phase6-w10r-ui-recovery`
- Dedicated Staging 프로젝트: `westory-staging-177587430482`
- 배포 ID: `dpl_DFvjkFTw4knYS3ZR34ixcdHqtTJM`
- 불변 배포 주소: <https://westory-staging-gvy3mj1s3-bbbs-projects-44f9da30.vercel.app>
- 고정 검토 주소: <https://westory-staging-westoria28-8028-bbbs-projects-44f9da30.vercel.app>
- Production 변경 수: `0`

Vercel 배포 metadata에서 source SHA와 branch가 위 값과 일치하고 `gitDirty=0`, `READY`임을 확인했습니다. Production Firebase, Production Vercel 배포·alias, Firestore, Auth, Storage, IAM, Maintenance, `main`은 변경하지 않았습니다.

후속 3-way Staging 비교와 fixture cleanup까지 끝난 뒤인 2026-08-17 16:18:46 KST에 Production 종료 fingerprint를 읽기 전용으로 재확인했습니다. Functions 44/44 `ACTIVE`와 source hash `f3a19da8908e23384d49d3295b38839b48a8a3b3`, Firestore ruleset `84165f2f-9e64-4a6e-b6b5-c4cc40c80b42`, Storage ruleset `2185308f-7a13-4804-bb04-88e7a4eb0eb8`, 공개 HTML 200·1,380 bytes·SHA-256 `352d97afe2f653a57674fdfd91e9ec0afb86410901bd6e5809717cea8fed81ba`가 시작값과 모두 일치합니다. `www.westory.kr`의 exact Production deployment도 기존 `dpl_9CYX35wz4S5M7adhPun6hiohEx1F` (`READY`) 그대로이며 Production 쓰기·배포·alias 변경은 0건입니다.

## 복구 결과

- W5 이후 남아 있던 248px 전역 교사 sidebar를 제거하고, 1024px 이상은 상단 메뉴, 미만은 교사 drawer로 복구했습니다.
- 학생 모바일은 오늘·학습·평가·점수·더보기 bottom nav와 전체 메뉴 drawer를 사용합니다.
- 기존 메뉴 설정의 이름·순서·상하위 관계와 임의 사용자 정의 parent/child를 보존합니다.
- 등록 route 48/48, 복구 메뉴 36/36, 누락·고아·죽은 링크·중복·권한 없는 노출은 모두 0입니다.
- 공통 token, PageHeader, StatePanel, AppDialogProvider, ConfirmDialog, ResponsiveDataContainer 계약을 canonical 화면에 적용했습니다.
- 모든 화면의 floating pencil action을 제거하고 패치 메모를 PageHeader의 명시적 동작으로 옮겼습니다.

## 다섯 canonical 화면

1. 교사 업무 홈: [직접 열기](https://westory-staging-westoria28-8028-bbbs-projects-44f9da30.vercel.app/#/teacher/dashboard) — 오늘 우선 업무 → 일정·공지 → 운영 상태
2. 학생 명단: [직접 열기](https://westory-staging-westoria28-8028-bbbs-projects-44f9da30.vercel.app/#/teacher/students) — compact 필터·검색 → 명단 → 안전한 행/일괄 작업
3. 문제 은행: [직접 열기](https://westory-staging-westoria28-8028-bbbs-projects-44f9da30.vercel.app/#/teacher/quiz?tab=bank) — URL 동기화 탭 → 분석 조건 → 요약 → 문항 목록, 문항/분석 오류 분리
4. 관리자 학기 전환: [직접 열기](https://westory-staging-westoria28-8028-bbbs-projects-44f9da30.vercel.app/#/teacher/settings/cutover) — 조회 전용 합성 리허설 → 준비도 → 자료 비교 → 위험 작업 차단
5. 학생 Today: [직접 열기](https://westory-staging-westoria28-8028-bbbs-projects-44f9da30.vercel.app/#/student/dashboard) — 학생 역할 계정 필요. 계정이 없으면 [모바일 증거](evidence/w10r-ui-recovery/w10r-canonical-20260817/student-today-390x844.png)와 [데스크톱 증거](evidence/w10r-ui-recovery/w10r-canonical-20260817/student-today-1440x900.png)로 판정 — 이어 할 학습 → 일정 → 공지 → 보조 상태

각 직접 주소는 해당 역할 로그인이 필요합니다. 검증용 합성 학생 계정은 안전 종료 계약에 따라 삭제했으며, 교사·관리자 계정으로 학생 route를 우회할 수는 없습니다.

## 최종 검증

- `verify:w10r-canonical-static`: PASS
- `verify:w10r-evidence`: 15개 실제 브라우저 시나리오, 30개 정확한 PNG, 5화면×10 상태 수용성 매트릭스, 3단계 시각 비교, fixture 정리 영수증 PASS
- `verify:w11-semester-cutover`: W2~W11 전체 회귀·에뮬레이터·빌드·포맷 PASS, Production 접근·쓰기 0
- 내비게이션: 활성 상위 1, 반응형 mount 1, click/refresh/back/new-tab/mobile/keyboard PASS
- 접근성: 키보드 navigation·visible focus·heading·label·control 이름·touch target·token 대비·200% 대응 reflow·reduced motion 계약 PASS
- 반응형: 5화면의 320×800부터 1440×900까지 가로 overflow 0, 교사 업무 홈 1600×900 추가 desktop 안정성 검사에서 overflow·잘린 action·fixed 충돌 0
- 디자인 시스템: 원시 색·간격·radius·shadow·native dialog 우회 0
- 직접 쓰기 경계: 승인 그룹 157, command 28, unknown 0
- 빌드: Vite 393 modules PASS
- TypeScript 기준: 기존 63 errors / 13 files 고정, 신규 drift 0
- 포맷과 `git diff --check`: PASS
- 전용 스테이징 fixture: Production 접근 0, 합성 문서 6개와 Auth 사용자 2개 정리, session·receipt·audit·token·App Check debug token·Vercel bypass·Storage fixture·emulator process·점유 port 잔여 0

브라우저 증거, PNG 해시 매니페스트, 기존 UI·실패 W10·복구 UI의 동일 1600×900 비교, 상태·접근성 매트릭스는 `docs/evidence/w10r-ui-recovery/w10r-canonical-20260817/`에 있습니다. 정리 결과는 `docs/evidence/w10-ui-ux/w10-w10r-20260817a/cleanup-results.json`, 화면별 승인 근거는 `docs/ui-recovery/05-canonical-screen-acceptance.md`에 기록했습니다.

## 다음 경계

나머지 route의 UI 이전은 시작하지 않았습니다. 이 다섯 화면에 대한 사용자의 `좋다` 판정 뒤에만 `docs/ui-recovery/06-full-route-migration-register.md`의 BLOCKED 묶음을 순차적으로 진행합니다.

사용자에게 필요한 판정: `좋다` 또는 `나쁘다`

선생님께서는 화면을 직접 확인하신 뒤 “좋다” 또는 “나쁘다”로만 판정해 주세요.
