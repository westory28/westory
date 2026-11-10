# 인터페이스 설정과 학생 메뉴 접근 제어

기준 커밋은 `94325681eb71b71298644abeb1e8bc777ba672c0`이다. 관리자 사이트맵의 숨김 상태를 학생 메뉴·직접 링크·게임 명령과 아바타 편집에 함께 적용한다. 기존 학생 공개 범위를 줄이는 통상 유지보수이며 새 개인정보 항목, 외부 서비스, AI 호출·에이전트 기능이나 외부 데이터 전송을 추가하지 않는다.

## 서버 저장 계약

메뉴 편집은 `site_settings/menu_config`와 `site_settings/config.studentMenuVisibility`를 같은 트랜잭션에서 저장한다. 서버용 map은 상위와 하위 메뉴의 유효 노출 상태를 담으며 `weplay`, `naval`, `yut`, `mypage`, `avatar`, `profile`, `score`, `wrong_note`를 사용한다. map이 없는 이전 설정은 호환하며 명시적 `false` 또는 손상된 map·값은 해당 기능을 열지 않는다.

게임의 학기별 `weplay_games/{gameId}.enabled`는 계속 별도의 필수 공개 조건이다. 메뉴 숨김 해제만으로 비공개 게임을 학생에게 열지 않는다. 교사 게임 미리보기·방 관찰과 교사 아바타는 학생 숨김 설정에 영향받지 않는다.

- 윷놀이: 학생 lobby와 명령, Firestore 방 읽기에 `weplay`와 `yut`를 검사한다. 방 읽기 rules는 기존 config 읽기를 재사용하여 10문서 접근 한도를 유지한다.
- 충무공: lobby, 신규·중복 시작과 답안 입력에 `weplay`와 `naval`을 검사한다. 종료·자동 정산은 그대로 보존하여 이미 지불한 게임의 정산을 막지 않는다. 공개를 닫은 뒤 기존 시작 영수증을 재사용하거나 답안을 계속 보내는 경로도 차단한다.
- 학생 아바타: studio 조회·아이템 구매·저장에 `mypage`와 `avatar`를 검사한다. 이미지 업로드 전후 트랜잭션에서 재검사하며 중간에 닫히면 기존 모습·지갑은 보존하고 미확정 이미지만 정리한다. 기존 아바타 모습 조회는 유지한다.
- 학생 프로필 이모지: 변경 명령에서 `mypage`와 `profile`을 검사한다. 다른 학습·점수 화면이 공유하는 조회 명령은 별도 변경하지 않는다.

## 운영 소스 대조와 배포 범위

2026-11-10 Firebase CLI의 기존 인증을 메모리에서 재사용하여 Cloud Functions v2 metadata와 해당 Storage source ZIP을 읽었다. 자격 증명·전체 운영 소스는 검증 기록에 포함하지 않았다. 비교 시 CRLF만 LF로 정규화했다.

| 지역 | 선택 배포 함수 | 변경 전 운영 소스와 기준 비교 |
| --- | --- | --- |
| asia-northeast3 | `getYutLobby`, `commandYutRoom` | `yut.js` 일치 |
| us-central1 | `commandYutRoomFast` | `yut.js` 일치 |
| asia-northeast3 | `getWeplayLobby`, `startWeplayGame`, `submitWeplayAnswer` | 선택 handler·공유 helper 일치, 아래 비대상 함수 차이 확인 |
| us-central1 | `getAvatarStudioState`, `purchaseStudentAvatarItem`, `saveStudentAvatar` | `studentAvatar.js` 일치 |
| asia-northeast3 | `updateStudentProfileIcon` | `studentProfileEmoji.js` 일치 |

충무공 세 함수의 운영 `weplay.js` 전체는 기준과 다르다. 차이는 `saveWeplayPolicy`의 윷 우승 보상 CAS·학기 검사·기존값 보존 및 그 함수에서만 사용하는 `validateYutWinnerReward` import에 한정된다. 해당 선언과 import만 제외한 파일을 비교하면 나머지 전체 내용이 일치한다. 이 패치에서는 `saveWeplayPolicy`를 배포하지 않으며, 운영 소스로 되돌려 저장소의 기존 보상 안전장치를 제거하지 않는다.

Firestore rules를 함께 배포한다. 기존 지역의 다른 함수는 삭제하거나 일괄 재배포하지 않는다. 특히 `commandYutRoomFast`와 아바타 세 함수는 미국 리전이며, 서울 경로 404를 미배포로 오인하지 않는다.

## 백엔드 검증

- `npm --prefix functions run check` 통과.
- 아바타·가격·메뉴 숨김 단위 검사 총 39개 통과. 프로필 이모지 회귀 17그룹 통과.
- 실제 Firestore Yut 에뮬레이터 전체 통과. 숨김 뒤 학생 lobby·명령·실시간 방 읽기 거부, 교사 관찰 보존, 표시 상태에서 10문서 한도, 기존 공개·학기·세션·참가 자격 회귀를 확인했다.
- 실제 canonical 위스 지갑 에뮬레이터 10그룹 통과. 숨김 중 신규·중복 시작과 입력 차단, 이미 지불한 게임 정산과 잔액·원장 보존을 확인했다.

운영 소스·설정 조회는 읽기 전용이며 실제 학생 게임·성적·지갑·아바타를 검증용으로 변경하지 않았다. 프론트엔드 빌드·브라우저 검증, 점수 요청 rules 회귀, 운영 배포와 도메인 확인은 최종 배포 단계에서 별도로 기록한다.
