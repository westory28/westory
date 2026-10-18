# 위스 상점 검증 기록 · 2026-10-18

검증 checkout은 `C:\Users\방재석\.codex\worktrees\wis-shop\westory`, 작업 시작 HEAD는 `e1671e0b0bfbee33d91730cf4a426c9de7403316`입니다. 이 문서는 검증 범위와 실제 결과를 구분하며 운영 배포 완료를 뜻하지 않습니다.

## 기준과 범위

- 루트 `AGENTS.md` → `UI_RULES.md` → 학생·교사 `AGENTS.md`, `DESIGN.md`, `education-web-design-system` 및 품질 점검표를 확인했습니다.
- 학생의 핵심 과업: 상품·가격·가용 재고를 확인하고 주문한 뒤 처리 상태를 확인하거나 승인 전 주문을 취소합니다.
- 교사의 핵심 과업: 공개 상품과 총입고·가용·예약·지급 수량을 관리하고 주문의 승인·수령 준비·지급·반려·취소를 처리합니다.
- 서버 권한·금액·재고 트랜잭션은 서버 전용 회귀 검증 대상이며, 이 브라우저 fixture의 메모리 상태로 증명하지 않습니다.

## 자동 검증

`node scripts/verify-wis-shop-client.mjs` — 17개 통과.

실제 `wisEconomyClient`, `pointEconomyAdapter`, `pointShopArchive`, `pointProductImages`를 TypeScript로 변환한 뒤 합성 transport로 실행합니다. Firebase 초기화와 네트워크 호출은 없습니다.

1. 학생 판매 목록의 비공개·미등록 재고 제외와 가용 수량 보존.
2. 교사 총입고·예약·지급 수량 및 비공개 상품 유지.
3. 이전 학기 읽기 전용 상품 표시와 쓰기 revision 차단.
4. 주문 수량·단가·원본 학생 메모·교사 검토 메모·준비 시각 및 구형 주문 기본값.
5. 교사 EXPLICIT 학기 조회 계약.
6. 학생 CURRENT 범위와 다른 학기 응답 거절.
7. 복수 구매 수량·가격·학기/재고/계좌 revision 전달.
8. 잘못된 수량·부족한 재고·가격 변경을 명령 전 거절.
9. 승인 전 취소 시 최신 주문 revision 전달.
10. 승인·준비·지급·취소 및 없는 주문의 학생 취소 차단.
11. 이전 학기의 canonical 재고 snapshot 우선 조회, 선택 학기 `where`, 201개 상품 페이지 처리 및 입고·가용·예약·지급 수량과 이미지 보존.
12. canonical 주문의 당시 학생 정보·수량·단가·총액·메모·진행 시각 보존, 최신순 정렬 및 다른 학기·legacy 자료 혼합 방지.
13. canonical 상품이 비었을 때만 선택 학기의 legacy 상품 201개로 fallback.
14. canonical 주문이 비었을 때만 legacy 주문의 원본 상태·메모·시각 조회.
15. canonical 조회의 권한 오류는 legacy fallback 없이 전파.
16. 일반 창의 직접조회 차단과 읽는 중 로그인 계정 변경 거절.
17. 기존 저해상도 미리보기의 상세 이미지 대체 및 새 640px 미리보기 선택.

`node scripts/verify-wis-economy-adapter.mjs` — 기존 범위·표시·구매·복구 검증 22개 통과. 새 archive import는 일반 창의 `false` mock으로 한정하고, 실제 명예의 전당 변환이 요구하는 이모지 정책과 4개 순위 map을 합성 fixture에 보완했습니다. 기존 timestamp·가려진 식별자 검증을 유지하고 기본 이모지 보존 검증을 추가했습니다.

`node --check scripts/verify-wis-shop-browser.mjs` — 통과.

브라우저 fixture의 esbuild — 통과. Firebase import가 있으면 빌드가 실패하며, 브라우저 CSP는 `connect-src 'none'`으로 외부 연결을 차단합니다.

## 브라우저 재현

`node scripts/verify-wis-shop-browser.mjs`

- 기본 주소: `http://127.0.0.1:4327`
- `view`: `student-shop`, `student-orders`, `teacher-products`, `teacher-orders`, `image-quality`.
- `scenario`: `normal`, `empty`, `error`, `loading`, `readonly`, `archive`.
- `viewport`: `320`, `390`, `768`, `1280`, `1440`. 지정하면 해당 CSS 너비의 iframe에서 실제 컴포넌트를 렌더합니다.
- 예: `/?view=teacher-products&scenario=archive&viewport=390`.
- 상품과 주문은 전부 가상 데이터입니다. 학생/교사 화면을 이동하면 같은 메모리 상태를 사용하며 새로고침하면 초기화합니다.
- 오류 시나리오는 첫 저장만 실패하므로 입력 유지 후 재시도를 확인할 수 있습니다. 로딩 시나리오는 합성 응답을 6초 지연합니다.
- 실제 UI를 조작하며 상품 상세·복수 수량·잔액 계산·주문 목록·승인 전 취소·교사 상태 변경·재고 수정·검색·빈 상태·읽기 전용·모달 키보드 포커스를 확인합니다.

### 실제 브라우저 확인 결과

부모 작업에서 CUA로 실제 컴포넌트 fixture를 조작해 다음 결과를 확인했습니다.

- 학생 390px: 상품 수량 2개 주문 시 240위스가 차감되고, 잔액이 950 → 710위스, 남은 수량이 8 → 6개로 표시되었습니다.
- 교사 768px: 주문 승인 → 수령 준비 → 지급 완료를 순서대로 처리하고 교사 메모와 단계별 시각 표시를 확인했습니다.
- 교사 화면에서 전역 `--ws-*` 색상 토큰이 정의되지 않아 테두리·주 행동 색상이 누락되는 문제를 발견했습니다. `TeacherWisShop.css`의 102개 색상 참조에 `DESIGN.md`의 기존 값을 fallback으로 추가했습니다. fallback을 제거한 문자열이 수정 전 CSS와 정확히 같음을 검사했으며 레이아웃·기능은 바꾸지 않았습니다. 대상 CSS의 Prettier 확인은 통과했습니다. 수정 후 390px 교사 화면의 테두리·주 행동·상태 배경 표시를 다시 확인했습니다.

### 이미지 검증

`/?view=image-quality`의 ‘실제 이미지 최적화 실행’은 브라우저에서 2048×1536 합성 PNG를 만든 다음 실제 `optimizeProductImage`를 실행합니다. 상세 1200px/300KiB 이하, 목록 640px/96KiB 이하, 160×120 작은 원본의 확대 방지와 비이미지 파일 거절을 검사합니다.

부모 작업의 실제 브라우저 실행 결과는 PASS입니다.

| 구분           | 해상도       | 용량            | 형식 |
| -------------- | ------------ | --------------- | ---- |
| 합성 원본      | 2048×1536    | 5,022,703 bytes | PNG  |
| 상세 이미지    | 1200×900     | 235,564 bytes   | WebP |
| 목록 미리보기  | 640×480      | 51,728 bytes    | WebP |
| 작은 원본 처리 | 160×120 유지 | 604 bytes       | WebP |

비이미지 파일은 거절되었습니다. 실제 브라우저의 canvas 인코딩 결과이며, 사진 내용에 따라 최종 용량은 달라집니다.

## 최종 통합 검증

- 최신 origin/main `7461dbd`의 위플레이 변경과 앞선 수행평가 변경을 보존해 통합한 뒤 `npm run build`가 통과했습니다. 수행평가 XLSX hair 테두리 회귀 검사를 포함합니다.
- `npm --prefix functions run check`와 클라이언트 17개·어댑터 22개, 변경 TS/TSX/CSS의 Prettier 및 diff 검사가 통과했습니다.
- 저장소 규칙과 운영 dictionary 변경을 보존한 병합 규칙에서 각각 58개 Firestore emulator 검사가 통과했습니다. 최대 20명 점검 예외, 교사 권한, 현재/미래 학기 거절과 직접 쓰기 거절을 포함합니다.
- 320px 학생 상세의 Tab/Shift+Tab 순환, Escape 닫기, 원래 상품 버튼으로 포커스 복귀를 확인했습니다. 320px 학생·390px 교사·1280px 학생·1440px 과거 교사 화면의 가로 넘침이 없었습니다.
- 학생 승인 전 취소 후 환불 완료 상태, 120위스 반환(950→1,070), 가용 재고 복원(8→9)을 확인했습니다.
- 1440px 과거 교사 화면은 상품 6개와 학생 상점 미리보기를 표시하며 등록·편집 버튼은 없습니다.
- 운영 DB 읽기 조회에서 2026학년도 1학기 기존 상품 8개를 확인했습니다. 전역 archive callable 차단을 유지하면서 선택 학기의 상품·주문 직접 읽기만 허용하도록 복구했습니다.
- 서울 executeCommand/getCommandStatus/getWisEconomyState 및 병합 Firestore rules 배포가 성공했습니다. 기존 미국 getWisEconomyState는 유지했습니다.

운영 주문·입출고 데이터는 생성하거나 변경하지 않았습니다. 주문과 재고의 서버 회귀 검증은 합성 트랜잭션으로 수행했으며, 프론트엔드 운영 반영은 릴리스 후 실제 도메인에서 별도로 확인합니다.
