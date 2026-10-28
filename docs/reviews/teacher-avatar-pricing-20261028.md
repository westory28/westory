# 교사 아바타·관리자 가격표 검토

## 범위

- 설정 → 마이페이지: 교사 본인의 프로필 이모지와 아바타 저장. 교사는 모든 아이템을 사용할 수 있으며 위스를 차감하지 않는다.
- 설정 → 아바타 가격 관리: 기존 관리자 정책(`teacher` 역할 또는 관리자 이메일)에 따라 아이템별 무료/유료와 1~1,000,000 정수 위스 가격 설정. `teacherPortalEnabled`만으로는 권한을 얻지 않는다.
- 한복 저고리 3종, 치마 3종, 바지 3종, 관복 3종, 사모·갓, 하복 상의 2종·반바지 1종을 추가한다. 새 17개 항목의 초기 가격은 0이며 기존 가격은 보존한다. 카탈로그 version 1과 기존 슬롯 계약을 유지한다.
- 참고 이미지의 의복 특징을 코드로 구현한다. 참고 학생 사진·얼굴의 자산화나 외부 AI 업로드, 런타임 AI 호출은 없다. 기존 미선택 실루엣·순위·시상대 표시 계약을 유지한다.

## 서버와 비용 계약

- 가격표는 `avatar_catalog_settings/current` 한 문서에 기본값과 다른 가격만 저장한다. 클라이언트 직접 쓰기는 기존 default-deny 규칙에 의해 거부된다. 별도 실시간 구독·폴링·아이템별 가격 쿼리를 추가하지 않는다.
- 학생 `getAvatarStudioState` 한 호출이 아바타·현재 가격표·기존 학기 지갑을 반환한다. 지갑 검증에서 읽은 사용자와 학생 신원은 초기 조회 안에서 다시 읽지 않는다.
- 교사 `getTeacherMyPage` 한 호출이 프로필·아바타·이모지 목록을 반환한다. 이모지/아바타 탭 전환과 선택은 이 결과를 재사용하며 교사 화면은 지갑·가격표를 읽지 않는다.
- 관리자 가격 화면은 진입/명시적 새로고침에만 한 번 읽는다. 검색·분류·가격 입력은 로컬 초안이고 저장 버튼으로 변경 가격을 한 번에 보낸다. 저장 응답을 재사용한다.
- 가격 저장은 `expectedRevision` 비교로 다른 관리자의 변경을 덮어쓰지 않는다. 구매는 표시 가격·가격표 revision을 서버 transaction에서 확인하고, 오래된 가격이면 최신 가격을 반환하여 사용자가 다시 확인하게 한다. 자동 구매 재시도는 하지 않는다.
- 기존 구매 영수증의 idempotency와 지갑·원장 transaction을 유지한다. 네트워크 재시도는 동일 requestId를 사용한다. 중복 영수증 응답일 때만 현재 아바타·지갑을 다시 한 번 조회한다.
- 무료 상태에서 저장한 아이템도 보유 목록에 기록한다. 이전 무료 저장 룩은 저장된 썸네일·룩을 근거로 보유 상태를 복원하여 가격 인상 후에도 사용할 수 있다. 저장 중 무료→유료 변경은 새 가격표와 함께 거부하고 화면을 갱신한다.
- 교사 보관함·썸네일은 별도 namespace이며 사용자 삭제 시 정리한다. 아바타 저장은 업로드 전후 권한·revision을 확인한다. 계정 전환 중 캡처/해시 생성 결과는 다른 계정에 저장하지 않는다.
- 새 함수는 최소 인스턴스를 추가하지 않는다. 가격표의 오래된 서버 캐시로 금액을 승인하지 않는다.

## 검증과 배포

- `node scripts/verify-avatar-studio-service.mjs`: 단일 초기 조회, 동시 조회 합치기, 가격/version 전달, 수동 재확인, 중복 영수증 복구, 계정 전환 중 응답·저장 거부.
- Functions 아바타 단위 검사 35개와 전용 demo Firestore 통합 9개 시나리오 통과: 가격 CAS, 권한 변경, 직접 쓰기 거부, 지갑 차감과 영수증, 삭제 정리. 교사에서 다른 역할로 변경한 계정 삭제와 잠금 해제 실패 후 재시도도 검사했다. 운영 학생 위스는 사용하지 않았다.
- 전체 `npm run build`, `npm --prefix functions run check`, 최종 TypeScript 검사 통과. 의상 마감 변경 후 Vite 자산을 다시 빌드한다.
- `node scripts/verify-avatar-garments.mjs`: 실제 GLB의 양 성별·6개 포즈에서 168개 의상 조합, 8개 피부색, 선택 재사용·기존 의상 복원 통과. 관복·치마 아래 다리가 발 본 위치까지 이어지는지 검사한다. 대표 관복·저고리·치마·하복 화면을 직접 검토했다.
- 실제 React 컴포넌트·3D 렌더러를 쓰는 모의 API 화면에서 교사 저장·탭 전환, 학생 가격 변경·구매 재확인, 관리자 가격 입력·동시 수정 충돌을 검증했다. 390/768/1280px에서 페이지 전체 가로 넘침이 없고 390px 가격 표만 내부 스크롤한다. 남녀 모델 왕복 전환도 통과했다.
- 운영 7개 함수의 핵심 소스를 읽기 전용으로 비교했다. 기존 아바타·지갑·공개 projection 본체는 기준 소스와 일치했고 카탈로그의 바이트 차이는 JSON 서식뿐이었다.
- 배포 함수: `getStudentAvatar`, `purchaseStudentAvatarItem`, `saveStudentAvatar`, `getAvatarStudioState`, `getTeacherMyPage`, `saveTeacherAvatar`, `updateTeacherProfileIcon`, `getAvatarCatalogPricing`, `updateAvatarCatalogPricing`, `cleanupStudentAvatarOnUserDelete`, `cleanupTeacherAvatarOnUserDelete`, `getWisRankingPreview`, `getWisEconomyState`, `getWisEconomyStateFast`.
- `getWisEconomyState`는 미국·서울 두 리전, 나머지는 미국 리전이다. Firebase 대상 함수 반영 후 Vercel main 배포를 운영 승격하고 로그인된 운영 설정 화면에서 확인한다. rules 변경은 없다.

로컬 증거 경로: `output/teacher-avatar-20261028/`, `output/avatar-management-20261028/`, `output/avatar-outfits-20261028/` (검증 로그·스크린샷·배포 상태, Git 제외).
