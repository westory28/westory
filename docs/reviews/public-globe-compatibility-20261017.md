# 공개 지구본의 환경별 재생 복구

## 원인과 수정

운영 Chrome 계열 브라우저에서 `prefers-reduced-motion: reduce`가 참이고 공개 홈의 모션은 ON인 상태를 재현했다. 지구본만 별도의 동작 감소 검사로 한양 장면에 정지했으며 재생 버튼까지 `모션 OFF`로 비활성화됐다. 사용자가 보고한 Chrome의 버튼 상태와 일치한다.

지구본도 기존 공개 홈 계약에 따라 페이지의 모션 ON/OFF를 사용한다. OS 설정을 변경하지 않으며 지구본의 일시정지·장면 선택, 전역 OFF, 화면 밖·비활성 탭 정지는 유지한다. 학생·교사 포털의 실제 지도나 로그인·저장 경로는 변경하지 않았다.

IntersectionObserver가 없으면 지도를 즉시 읽고 화면 위치와 스크롤·resize 이벤트로 재생 여부를 판단한다. ResizeObserver가 없으면 창 크기 이벤트로 투영을 갱신한다. 크기가 0인 동안은 프레임을 중단하고 크기·페이지 복귀 시 재개한다. 같은 공개 홈의 생각모아·성장 그래프도 ResizeObserver 부재 때문에 전체 페이지를 중단하지 않도록 기존 크기 측정에 대체 경로를 연결했다.

## 검증

- `npm run verify:entry-map-motion`: 실제 TypeScript/TSX와 d3-geo 실행. OS 동작 감소 ON/OFF, 구식·미지원 MediaQueryList, observer 조합, SVG 경로 변화와 단일 RAF, 수동/전역 제어, 화면·탭 복귀, 0 크기/resize/pageshow, 긴 프레임 지연, 로딩 실패·재시도·지연 로딩·unmount 정리를 검사한다. 수정 전 renderer는 동작 감소 환경의 자동 재생 검사에서 실패한다.
- 위 회귀 검사를 `prebuild`에 포함했다. 전체 `npm run build`, `npm run format:check`, `git diff --check`를 통과했다. 기존 수행평가 XLSX hair 테두리 검사도 포함한다.
- 실제 Chromium 브라우저에서 공개 홈 전체를 렌더했다. 390·768·1280px의 동작 감소 환경에서 자동 재생과 실제 지형 경로 변화를 확인했다. 390px에서 일시정지 후 시간이 유지되고 재생하면 다시 증가하는 것을 확인했다.
- IntersectionObserver·ResizeObserver·matchMedia를 모두 제거한 390·1280px 환경에서도 전체 페이지와 지도 회전이 유지됐다. 최초 자산 응답을 503으로 만든 390px 환경에서 오류 표시 후 `다시 불러오기`로 재생을 복구했다. 격리된 로컬 fixture를 사용해 운영 데이터를 변경하지 않았다.

브라우저 검증은 Chromium에서 화면 크기와 API 가용성을 바꿔 수행했다. 모든 실제 기기나 Firefox·Safari 엔진을 직접 실행한 결과는 아니다. 운영 반영은 검증한 main 커밋의 Vercel Ready·Production 승격과 실제 도메인의 동작 감소 환경 재생을 확인한다.
