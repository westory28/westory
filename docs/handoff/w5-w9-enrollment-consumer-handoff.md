# W5–W9 Enrollment Consumer Handoff

## 공통 계약

후속 화면과 Domain은 `getArchiveEnrollmentState` 또는 그 위의 typed resolver를 사용합니다. source는 `CURRENT / PREPARING / ARCHIVE / LEGACY / EXPLICIT` 중 하나를 명시하고, 반환된 `provenance`, `readOnly`, `schemaVersion`, `legacy`를 화면과 command 경계까지 유지합니다.

금지 사항은 다음과 같습니다.

- canonical 결과가 없을 때 `users`를 자동 조회하는 silent fallback
- mount·refresh·조회 과정의 identity/Class/Enrollment 생성·repair
- client SDK를 통한 canonical Enrollment·Class·Archive 수정
- ARCHIVED 학기에 대한 일반 Domain command
- 현재 학생의 학급 필드로 과거 학기 표시를 덮어쓰기

## Consumer 이관 표

| Consumer                          | 현재 legacy 접근                            | 새 canonical resolver                                    | 담당 Wave                       | 필요한 migration                                   | Acceptance test                                                       | 제거할 compatibility code                                        |
| --------------------------------- | ------------------------------------------- | -------------------------------------------------------- | ------------------------------- | -------------------------------------------------- | --------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Global Shell 학기·출처 표시       | 화면별 year/semester와 config 직접 조합     | W3 Semester Core + W4 provenance                         | W5                              | 없음                                               | CURRENT/PREPARING/ARCHIVE badge와 read-only 상태가 route 이동 뒤 유지 | 화면별 임의 학기 label/fallback                                  |
| 관리자 설정 W4 패널               | 신규 canonical 연결 완료                    | `getArchiveEnrollmentState`, `previewEnrollmentRoster`   | W5 polish / W9 ownership        | 실제 roster source 결정 뒤 adapter                 | 390/1024/1600, explicit action만 write, error·stale 표시              | 합성 JSON 기본값은 Production cutover 전에 운영 import UI로 교체 |
| 학생 MyPage 현재 학급             | 기존 `users` 학년·반·번호                   | CURRENT self resolver                                    | W5 shell / W8A student consumer | 학생별 canonical Enrollment 적용                   | 자기 ACTIVE 1건만 표시, 누락 시 legacy fallback 0                     | 기존 profile 안의 현재 학급 표시 분기                            |
| 교사 학생·학급 목록               | `users`의 grade/class/number 조회·필터      | CURRENT 또는 명시 semester state                         | W9                              | roster import + identity reconciliation            | 학기 전환 뒤 이전 학기 값으로 덮이지 않음, capability read 적용       | `users` 기반 class grouping/search                               |
| 수업·과제 대상 학급               | legacy class/student field로 대상 집합 구성 | ACTIVE Class/Enrollment snapshot                         | W6A                             | 수업 대상 key를 classId/enrollment revision에 연결 | target preview와 commit 대상 hash 일치, archived write 0              | 학년·반 문자열 기반 target query                                 |
| Quiz·평가 배정·응시               | 현재 학생 문서에서 학급 판정                | assessment scope + canonical enrollment resolver         | W6B                             | assignment participant snapshot 발행               | 학급 이동 전후 attempt 소속 보존, PREPARING 학생 미노출               | 학생 current class fallback                                      |
| 점수·성적 roster matching         | 이름·학년·반·번호 혼합 매칭                 | studentUid + semesterId + enrollmentId                   | W7B                             | 기존 score row identity mapping                    | 동명이인·번호 변경 충돌 보고, 과거 snapshot 유지                      | displayName/class 문자열 단독 match                              |
| 위스 wallet·주문 관리자 학생 선택 | `users` 목록과 현재 학급 label              | CURRENT identity/enrollment join                         | W7A                             | wallet UID는 유지, 표시 context만 migration        | wallet UID 불변, archived 학급은 read-only label                      | users current class presentation join                            |
| 알림·이의·답안 요청 대상 표시     | 요청 문서와 현재 `users` 표시값 결합        | immutable request snapshot + explicit enrollment context | W8B                             | 새 요청부터 enrollment snapshot 기록               | 과거 요청이 현재 학급 변경에 영향받지 않음                            | 현재 users 학급으로 과거 요청 재구성                             |
| 출석·일정·Work Queue 학급 필터    | Domain별 year/class 문자열                  | canonical classId + semester provenance                  | W9                              | Domain reference adapter                           | queue source count 일치, ARCHIVE 조회는 command 0                     | Domain별 silent semester/class fallback                          |

## Domain command 공통 guard

후속 command는 business write 전에 다음을 같은 권위 흐름에서 확인합니다.

1. active application session과 capability
2. target semester Manifest 존재와 revision
3. command가 허용되는 semester status
4. canonical active pointer가 필요한 경우 pointer/Manifest 일치
5. `CLOSED / ARCHIVED` 일반 쓰기 거부
6. 대상 studentUid/classId/enrollmentId의 semester 일치
7. receipt·audit와 business effect 원자 commit

읽기에서 찾은 semesterId나 classId를 그대로 신뢰하지 않고 command payload의 revision·target hash를 서버에서 다시 확인합니다.

## Compatibility 제거 기준

`LEGACY` adapter는 다음이 모두 충족된 consumer부터 제거합니다.

- 필요한 학기에 canonical Class/Enrollment가 존재합니다.
- duplicate, orphan, missing이 0인 승인 roster evidence가 있습니다.
- 해당 Domain의 historical snapshot migration이 끝났습니다.
- CURRENT와 ARCHIVE acceptance test가 통과했습니다.
- legacy 호출 로그가 합의한 관찰 기간 동안 0입니다.

Production roster 원천과 archive 접근 policy가 확정되기 전에는 adapter를 삭제하지 않습니다. 다만 fallback을 자동화하거나 쓰기 가능하게 바꾸면 안 됩니다.

## Release 연계

`KI-W1-01`은 별도 Release blocker로 유지합니다. Maintenance Hotfix 통합 시에는 W4의 `firestore.rules`, `functions/index.js`, `functions/package.json`, root `package.json`과 충돌을 해소한 뒤 W2→W4 전체 emulator suite를 다시 실행해야 합니다.
