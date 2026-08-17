# 전체 route 이전 등록부

상태: canonical 화면 준비 완료, 사용자 시각 승인 전 동결

## 현재 허용 범위

| Wave | Route / 기반 | 상태 | 비고 |
| --- | --- | --- | --- |
| W10R-0 | 기준점·작업 트리·Production fingerprint | 완료 | 읽기 전용 비교, Production 쓰기 0 |
| W10R-1 | 48 route·역할·메뉴 감사 | 완료 | P0 메뉴 소실 확인 |
| W10R-2 | token·component·responsive contract | 완료 | canonical 범위부터 강제 |
| W10R-3 | `/teacher/dashboard` | PASS | 교사 업무 홈 |
| W10R-3 | `/teacher/students` | PASS | 학생 명단 |
| W10R-3 | `/teacher/quiz?tab=bank` | PASS | 문제 은행 |
| W10R-3 | `/teacher/settings/cutover` | PASS | 학기 전환 |
| W10R-3 | `/student/dashboard` | PASS | 학생 Today |
| W10R-4 | AppShell·NavigationDrawer·PageHeader·token | PASS | 다섯 화면에 필요한 공통 기반만 |

## 사용자 승인 뒤에만 시작할 범위

| 묶음 | Route | 현재 상태 |
| --- | --- | --- |
| 학생 학습 | `/student/learning`, `/student/lesson/*` | UI 이전 BLOCKED — 사용자 승인 필요 |
| 학생 평가 | `/student/quiz`, `/student/history-classroom*`, `/student/history` | UI 이전 BLOCKED — 사용자 승인 필요 |
| 학생 성적·개인 | `/student/score*`, `/student/points`, `/student/mypage*` | UI 이전 BLOCKED — 사용자 승인 필요 |
| 학생 일정·소통 | `/student/schedule`, `/student/calendar`, `/student/attendance`, `/student/communication` | UI 이전 BLOCKED — 사용자 승인 필요 |
| 교사 수업 | `/teacher/learning`, `/teacher/lesson*` | UI 이전 BLOCKED — 사용자 승인 필요 |
| 교사 평가·성적 | `/teacher/quiz/history-classroom`, `/teacher/exam` | UI 이전 BLOCKED — 사용자 승인 필요 |
| 교사 운영 | `/teacher/points`, `/teacher/schedule`, `/teacher/attendance`, `/teacher/communication` | UI 이전 BLOCKED — 사용자 승인 필요 |
| 관리자 일반 | `/teacher/settings` | UI 이전 BLOCKED — 사용자 승인 필요 |
| 공통 경계 | 로그인, 유지보수, Not Found, 개발 기록 | UI 이전 BLOCKED — 사용자 승인 필요 |

## Route별 완료 정의

각 route는 navigation 연결, metadata, 권한, loading/empty/error/permission, responsive, keyboard, token enforcement, 기능 회귀, screenshot evidence를 모두 통과해야 이전 완료로 바꿉니다. legacy alias는 UI를 새로 만들지 않고 canonical target redirect 계약을 유지합니다.

사용자 승인 전에는 이 등록부의 BLOCKED 항목을 구현 대상으로 확장하지 않습니다.
