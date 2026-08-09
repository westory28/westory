# ADR — W1-R 서버 권위 애플리케이션 세션

- 상태: Accepted for Dedicated Staging verification
- 결정일: 2026-08-09
- 적용 범위: PHASE 6 W1-R
- Production 적용: 금지(별도 승격 승인 필요)

## 배경

Firebase Auth의 ID token이 유효하다는 사실은 위스토리의 30분 또는 15분 유휴 세션이 유효하다는 뜻이 아니다. 기존 클라이언트 타이머만으로는 이전 번들, 직접 SDK, 이미 발급된 token을 이용한 Firestore·Storage·Functions 요청을 차단할 수 없다. Firebase Admin SDK를 사용하는 Functions는 Security Rules도 우회한다.

## 검토한 선택지

1. 클라이언트 타이머만 유지: 변경은 작지만 우회 요청을 차단하지 못하므로 기각한다.
2. UID당 단일 session 문서: Rules 구현은 단순하지만 한 기기의 활동·로그아웃이 모든 기기에 영향을 주므로 기각한다.
3. `application_sessions/{uid}/sessions/{auth_time}`: 같은 로그인 epoch의 탭은 공유하고, 다른 로그인 epoch의 기기는 분리할 수 있다. 현재 직접 SDK 구조와 호환되므로 채택한다.
4. HttpOnly session cookie 기반 BFF: 통제력은 높지만 SPA의 직접 Firebase SDK 구조를 전면 변경하므로 장기 대안으로 남긴다.

## 결정

서버가 관리하는 다음 문서를 애플리케이션 세션의 권위값으로 사용한다.

`application_sessions/{uid}/sessions/{authTime}`

문서는 `status`, `authTime`, `lastActivityAt`, `generalExpiresAt`, `highRiskExpiresAt`, `closedAt`, `schemaVersion`을 가진다. 클라이언트는 문서를 직접 읽거나 쓸 수 없다.

- `openApplicationSession`: 최근 5분 이내의 실제 Firebase 인증으로만 새 epoch를 연다. 유효한 같은 epoch는 재사용할 수 있지만, 만료·종료된 epoch는 다시 열지 않는다.
- `touchApplicationSession`: 클릭·입력·제출처럼 허용된 사용자 활동 뒤에만 호출한다. 서버 수신 시각으로 일반 30분과 고위험 15분 deadline을 함께 갱신하고, 30초 이내 중복 write는 억제한다.
- `closeApplicationSession`: 현재 epoch를 `closed`로 만들고 두 deadline을 종료한다.
- `assertActiveApplicationSession`: 모든 사용자 callable이 business logic 전에 공유한다.
- 고위험 callable: active high-risk deadline과 token의 `auth_time`이 5분 이내인지 서버에서 다시 확인한다.

클라이언트가 전달한 현재 시각, `lastActivityAt`, `reauthenticated` 불리언은 신뢰하지 않는다. token refresh는 `auth_time`을 바꾸지 않으므로 활동으로 인정하지 않는다.

## Enforcement 경계

- Firestore Rules: `canUseWestory()`가 해당 auth epoch의 active 일반 deadline을 확인한다.
- Storage Rules: 같은 session 문서와 사용자 profile을 각각 한 번의 고유 문서 접근으로 확인한다.
- callable Functions: 공통 guard가 session을 읽고 만료·누락·손상 상태를 fail closed 처리한다.
- scheduler와 Storage trigger: 사용자 요청이 아닌 SYSTEM 실행이므로 살아 있는 사용자 세션을 요구하지 않는다. 업로드 수락 시점의 actor·operation provenance는 별도 계약으로 검증한다.
- 보호된 별도 HTTP Function은 현재 없다. callable endpoint의 raw HTTP 호출도 같은 onCall guard를 통과한다.

## 비용과 Rules access budget

Firestore의 일반 보호 요청에는 session 문서 read가 1회 추가된다. 역할 검사가 필요한 요청은 user profile read 1회가 더해진다. Storage는 session 1 + profile 1로 Firestore 연동 조회 한도 2회를 모두 사용한다. 같은 경로의 반복 `get`은 Rules 엔진 캐시가 가능하지만, 설계·테스트 판정은 서로 다른 문서 수를 기준으로 한다.

거절된 요청도 Rules 문서 read 비용이 발생할 수 있다. touch write는 클라이언트와 서버에서 30초 단위로 억제한다. 수행평가 확인처럼 기존부터 여러 관련 문서를 읽는 batch는 emulator에서 operation별 10회와 전체 20회 한도를 별도로 확인해야 한다.

## 다중 탭과 다중 기기

- 같은 브라우저의 같은 Firebase 로그인 epoch는 session 문서를 공유한다. 한 탭의 유효 활동은 그 epoch의 탭에 공통으로 반영된다.
- 다른 인증 epoch는 별도 문서를 사용한다. 한 기기의 close가 다른 epoch를 자동 종료하지 않는다.
- step-up 재인증은 새 `auth_time`으로 새 session을 연다. 이전 epoch는 자체 deadline까지 유효할 수 있으므로, 민감 command는 새 token의 recent-auth를 반드시 요구한다.
- 초 단위 `auth_time`이 같은 동시 인증은 같은 경로가 될 수 있다는 제한이 있다.

## Rollback

Dedicated Staging에서만 다음 순서로 되돌린다.

1. 새 클라이언트 alias를 직전 Staging deployment로 되돌린다.
2. 직전 Staging Firestore·Storage Rules artifact를 다시 배포한다.
3. Functions의 session guard 이전 artifact를 Staging에 다시 배포한다.
4. session 문서는 감사 근거로 보존하고 TTL/정리 정책으로 후속 처리한다. 즉시 광범위 삭제하지 않는다.

Production rollback은 이번 ADR의 실행 범위가 아니다.

## 알려진 제한

- 이미 메모리에 읽힌 데이터나 장기 download token URL을 사후 회수하지 못한다. fence는 만료 이후의 새 요청을 차단한다.
- App Check가 없으므로 변조된 client가 touch callable을 자동 호출하는 행위까지 사람 활동으로 완벽히 증명하지는 못한다.
- 고위험 direct Firestore/Storage write는 callable command로 옮기거나 recent-auth Rules를 적용하기 전까지 step-up UI만으로 보호할 수 없다.
- 평가의 same-attempt 원자성 및 교사 draft 복구는 별도 W1-R 계약이며 session authority만으로 해결되지 않는다.
