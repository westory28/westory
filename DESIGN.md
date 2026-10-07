# Westory DESIGN.md

## 공개 진입 화면: 우리의 이야기로 (2026-10-01 수정)

그래프·마무리 스크롤 복구(2026-10-01): 성장 그래프 고정 구간은 240svh로 늘리고 전체 진행의 12%까지 첫 기록을 유지한 뒤 90%까지 상승, 마지막 10%는 완성본을 유지한다. 고정되지 않는 작은 화면은 실제 SVG 상단이 화면 높이 80%에서 20%(최소 80px)로 이동하는 구간을 기준으로 진행한다. 성적 확인은 데스크톱 미리보기 폭을 화면 높이에 맞춰 제한해 1366×768에서도 전체 무대를 고정한다. 높이 700px 미만이거나 내용이 화면을 넘으면 제목 다음의 미리보기만 280svh 구간 안에서 상단 80px에 고정하며 같은 34%·68% 전환과 ±2.5% 경계 여유를 유지한다. 작은 화면의 미리보기는 버튼까지 화면 안에 들어오도록 크기를 제한한다. 이 규칙은 앞선 성적 확인의 자동 전환 중단 조건을 대체한다. 모션 OFF는 추가 스크롤 구간 없이 정적 배치와 직접 선택을 유지한다.

수업 자료·성적 확인 슬라이드 속도 보완(2026-10-01): 두 구역만 높이를 280svh로 늘리고, 고정 무대가 머무는 전체 스크롤 거리를 사용한다. 기존 앞 60% 압축을 없애 34%·68%에서 전환하며 경계의 ±2.5%에는 현재 화면을 유지한다. 높이 900px에서는 화면당 약 580–620px 스크롤 여유를 확보하고 마지막 화면도 고정 구간 끝까지 유지한다. 이미지 전환은 opacity 600ms/이동 750ms로 부드럽게 연결한다. 사용자가 버튼으로 선택한 화면은 다음 스크롤 경계를 지날 때까지 유지한다. 고정 무대가 화면에 맞지 않거나 수업 자료 높이 800px 미만·성적 확인 높이 700px 미만·모션 OFF에서는 자동 전환 없이 기존 버튼으로 선택한다. 다른 구역의 등장·브랜드 모션과 스크롤 속도는 유지한다.

개요·마지막 브랜드 모션 재조정(2026-10-01): 개요 배지는 위쪽 48px에서 1200ms 동안 내려와 +6→-6→+2→-1.5→0px로 두 번 가볍게 떠오른 뒤 안착한다. 항목 시차는 220ms이며 각 배지의 실제 화면 진입 후에 시작한다. 마지막 브랜드는 영문 Westory가 1700ms/글자당 55ms 시차로 나타났다가 위로 회전하며 사라지고, 1200ms 뒤 한글 위스토리가 1000ms/글자당 90ms 시차로 아래에서 회전·확대되어 자리 잡는다. 총 연출은 2500ms 이내, 회전은 X축 ±80deg, 이동은 40px 이하, blur 8px 이하, 최종 배율은 1이다. 기존 파랑·주황의 번지는 빛과 네 개의 작은 반짝임을 한 번 사용하며 이동 선과 스크롤 잠금은 추가하지 않는다. 브랜드 영역이 절반 이상 화면에 들어와야 시작한다. 짧은 화면에서 끝으로 바로 이동하면 로그인 영역 진입으로도 시작하여 버튼을 표시한다. 모바일에서 네 글자는 한 줄로 유지하고 OFF에서는 한글 완성본·로그인 버튼만 정적으로 표시한다. 이 계약은 앞선 개요 상승 효과와 마지막 600ms 등장 효과를 대체한다.

공개 홈 빛·모션 보완(2026-10-01): 이동하는 주황선과 흡수 연출을 제거한다. 각 구역의 주요 제목/요소 뒤에 #f59e0b의 최대 16% radial gradient를 두고 진입 시 1200ms 동안 opacity 0→1→0.25, scale .94→1.04로 한 번 부드럽게 밝힌다. 모션 OFF에서는 빛 애니메이션도 숨긴다. '생각을'과 '연결하다'는 독립된 24px 이하 이동과 opacity로 스크롤 초반에 순서대로 드러난다. 스크롤 값은 약 100ms 감쇠로 보간하며 멈추면 프레임 실행을 종료한다. 개요 4배지는 각 항목의 화면 진입을 기준으로 120ms 시차/800ms의 상승·등장 연출을 사용한다. 마지막 구역의 강제 스크롤 고정을 없애 자연 스크롤을 유지한다. 히어로 휴대전화는 9:19.5 화면 비율, 현재 학생 대시보드의 주간 일정·학습 메뉴를 재현한 공개용 가상 화면으로 교체한다. 실제 계정·서버 호출은 없다. 성장 예시 점수는 28→46→72→96점이며 기존 가상 기록 표기를 유지한다. 그래프는 가용 폭을 넓히고 데스크톱 320–420px/모바일 240–320px 높이, 0–100점 축에서 가파른 상승을 보여준다. 이전 모바일 줄바꿈과 36–40px 버튼 크기는 유지한다.

제목은 단어별 850ms/60ms 시차로 등장하며 구역에 따라 24px 이내 하강·상승·좌측 이동, .94→1 확대와 2px 이하 흐림 해제를 조합한다. 첫 줄과 강조 줄의 시차는 100ms이고, 전체 제목의 완성은 진입 후 1.2초 이내다. 생각모아는 최대 1040px, 최소 높이 데스크톱 440px/모바일 360px, 글자 18–80px/16–48px로 확대한다. 단어별 이동 여백을 확보한 뒤 6–9초 주기의 ±3px 수평/±5px 수직 부유를 적용한다. 사용자가 요청한 이 지속 모션은 해당 구역이 보일 때만 재생하며 탭 비활성·모션 OFF에서는 중단한다.

모바일 공개 홈 보완(2026-10-01): 320/360/390/430px에서 브랜드·짧은 탭·버튼 라벨은 한 줄로 유지한다. 마지막 '위스토리'는 네 글자 전체를 하나의 줄로 묶고 48–80px 범위에서 화면 폭에 맞춘다. 헤더는 56px, 로그인 버튼은 헤더 36px/본문 40px, 일반 텍스트 제어는 36–40px와 상하 6–8px 여백으로 줄인다. 이는 사용자가 요청한 공개 홈 모바일 전용 밀도이며 포털 및 데스크톱 제어 크기는 유지한다. 수업 자료의 중복 이전/다음 화살표는 480px 미만에서 숨기고 세 탭에 폭을 배분한다. 마이페이지 탭은 문구 길이에 비례한 열과 12–14px 글자로 구성한다. 본문과 긴 문항은 단어 단위로 자연스럽게 줄바꿈하고, 성적 계산기의 제목·과목과 초기화·설명은 각각 독립된 행에 배치한다.

공개 홈은 사용 이유를 먼저 설명한다. 흰 바탕 `#ffffff`와 연한 중성 배경 `#f6f7f9`가 주 배경이며, `#2563eb`는 제목/조작/선택 강조와 최대 16%의 radial gradient에 사용한다. `#f59e0b` 주황은 학습 여정을 연결하는 가는 선과 작은 지점에 사용한다. 본문 `#111827`, 보조 `#64748b`, 경계 `#e5e7eb`. 학생·교사 포털의 토큰과 동작에는 적용하지 않는다.

최대 폭 1280px, gutter 24/32/48px, 간격 8/16/24/32/48/64/96/128px. Noto Sans KR 유지. 히어로 제목 clamp(44px, 5.2vw, 72px), 태블릿 clamp(38px, 5vw, 48px), 모바일 clamp(38px, 10.8vw, 56px), 1.14 행간/-0.065em 자간. 장면 제목 clamp(36px, 4.5vw, 64px), 1.13 행간/-0.055em 자간, 본문 16–18px/1.75. 기기 목업은 CSS의 검은 베젤/은색 몸체/그림자(0 28px 64px rgba(15,23,42,.16))로 만들고 스크린은 실제 사용자 제작 자료의 최적화 WebP로 채운다. 베젤 radius 16–32px, 카드 24px, 제어 48px. 외부 3D 엔진이나 비디오를 추가하지 않는다.

타이포는 행별 마스크에서 최대 110% Y 이동으로 등장하고 파란 강조 단어가 스크롤에 따라 선명해진다. 큰 장면 사이에는 자연 스크롤 구간과 수업 자료 3장 슬라이드 구간을 섞는다. 슬라이드는 세로 스크롤로 전환되고 이전/다음·탭으로도 직접 선택한다. 이동/opacity 중심이며 연속 루프는 없다. 마지막 장면의 일회 고정 외에는 자연 스크롤을 유지한다. 히어로 150svh, 수업 슬라이드 260svh(모바일 240), 모션 감소/높이 600px 미만은 자연 배치와 수동 슬라이드. 같은 구간 역스크롤은 동일한 전환을 재현한다. 주황선은 섹션 사이와 각 장면 상단을 잇고 점진적으로 그려진다. 지도, 생각모아, 문항, 성적에 각각 실제로 조작 가능한 로컬 체험을 둔다.

자료는 현재 운영 학기의 공개된 실제 학습지/지도/문항을 일회성 읽기로 준비하고, 생각모아는 기존 실제 주제와 익명 집계만 사용한다. 개인 식별 정보·원본 Storage URL 토큰·비공개 문항/답안/성적은 공개 자산에 포함하지 않는다. 홈 방문 시 자료용 Firestore/Storage API 호출을 추가하지 않는다. 이미지는 지연 로딩하고 내용은 로컬 자산으로 제공한다.

성적 체험은 정기시험60%/수행평가40% 예시. 두 개의 0–100 슬라이더가 점수와 누적 막대, A/B/C/D/E 성취도를 갱신한다. 실제 순수 함수 getGradeBand의 정수 반올림 기준을 재사용한다. 일반 교과 90/80/70/60 경계이며 설정 예시와 공식 성적의 구분을 표시한다. 파란 정기/연한 파란 수행 막대와 가는 주황 기준선, 큰 성취도 글자, 다음 기준까지 필요한 점수를 사용한다. 기준 도움말은 제목 옆 i 버튼으로 숨긴다. 성장/마이페이지는 실제 과목별 성취 막대, 목표와 최근 평가 흐름을 소개하고 비활성 '퀴즈 성장 그래프'를 실제 기능이라고 서술하지 않는다. 그래프 예시는 모두 가상 기록이다.

헤더 로그인, 모달 초점/inert 계약과 CTA 48px, 우측 하단 48px 맨 위로 버튼(600px부터 표시)을 유지한다. 마지막 문구는 '이제 우리의 이야기로,' 다음 줄 '위스토리'. 브라우저 검증 폭은 390/768/1280px, 짧은 높이와 모션 감소 대체도 점검한다.

공개 홈 로그인 버튼은 학생을 왼쪽 파란 primary, 관리자를 오른쪽 흰 배경/파란 테두리 secondary로 나란히 배치한다. 본문 버튼 높이 56px, 간격 12px(모바일 8px), 헤더 버튼 48px(모바일 44px)이다. 헤더 Westory 로고는 40px/900, 모바일 32px, 360px 미만 28px로 강조하며 기존 파랑/주황을 유지한다. 푸터 로고는 28px이다. 로그인·역할 판별·온보딩 동작은 바꾸지 않는다.

공개 홈 디테일 수정: 좌측 고정선 대신 각 stage의 중앙에서 시작하고 끝나며 콘텐츠 외곽을 감싸는 연속 주황 붓선을 둔다. 실제 stage 크기로 계산한 SVG 면의 두께는 1–8px(모바일 1–4px), 가는 결 2개를 겹쳐 필압을 표현한다. 필터/영상 대신 벡터와 마스크를 사용하며, 일반 장면의 진입·통과 진행도와 sticky 장면의 스크롤 진행도를 각각 반영해 중간에 멈추지 않는다. 주요 시각 객체의 기울기/깊이도 같은 진행도를 사용한다. 텍스트 및 제어는 선 위에 놓고 클릭을 가로채지 않는다.

히어로 프레임은 키보드 없는 tablet으로 변경한다. 히어로 제목은 처음 진입할 때 양쪽에서 48px 이내 이동하며 1000ms 동안 모이고 이후 흩어지지 않는다. 일반 장면 제목은 맥락 22–32px/500/보조색, 핵심 36–64px/800/파랑(모바일 핵심 30–40px)으로 위계를 분리한다. 수업 자료의 '깊어지는 생각'은 scale .9→1과 blur 4→0px로 깊이를, 지도 '맥락을 더하다'는 단어 결합과 짧은 강조선으로 더함을 표현한다. 개요 4항목은 구역 진입 시 100ms 간격/700ms 이동으로 순서대로 드러난다. 동작 감소 시 모든 텍스트와 제어를 바로 표시한다.

위플레이·성장 기록은 240/220svh, 성적 확인 화면은 240svh의 스크롤 장면으로 연결한다. 높이 700px 이상에서만 80px 아래 stage를 고정하며, 작은 높이는 자연 배치와 진입 진행도를 사용한다. 위플레이는 기존 거북선 접근 이후 실제 게임의 yi-sunsin-cutin.webp/impact-lines.webp로 이순신 눈 클로즈업을 겹친다. CSS 포탄/불꽃/물보라는 사용하지 않는다. 게임명은 한 줄로 유지한다. 성장 예시는 62→74→84→94점의 스크롤 보간과 기록 버튼을 유지한다. 성적 확인은 실제 성적 확인 컴포넌트의 가상 데이터 렌더를 tablet 안에 표시하며 점수/문의/확인 단계는 세로 스크롤과 버튼으로 전환한다. 실제 학생 정보는 사용하지 않는다.

마지막은 별도 긴 sticky 구간 없이 구역 진입 시 단 한 번 1800ms 안에 완결되는 애니메이션이다. '이제 우리의 이야기로,'와 '위스토리'를 보여주며 '위'는 #2563eb, '스토리'는 #f59e0b다. 이전 붓선이 '스토리'에 모여 흡수되는 장면으로 마무리하고 별도 점/물결/동심원은 제거한다. 스크롤을 멈춰도 완결되며 반복 타이머·사운드·서버 요청은 없다. 모션 감소에서는 선명한 배와 완성된 문구/그래프를 정적으로 보여준다.

공개 홈 공간감 보완(2026-10-01): 홈 전용 최대 폭을 1520px로 확장하고 장면별로 중앙 대형 타이포/넓은 시각물, 비대칭 배치, 겹쳐진 패널을 교차한다. 외곽 gutter 24/32/48px, 주요 장면의 세로 여백 96/128/160px. 히어로는 중앙 제목 48–80px와 최대 960px 태블릿을 위아래로 배치하고, 지도는 왼쪽 큰 태블릿과 오른쪽 짧은 문장, 생각모아는 넓은 중앙 무대, 문제풀이는 오른쪽 문장/왼쪽 실제 문항으로 대비한다. 수업 자료는 넓은 중앙 미리보기와 하단 설명을 사용하며, 높이 800px 미만에서는 고정 무대와 자동 전환을 해제하고 자연 배치·수동 슬라이드로 전환한다. 반복되는 좌문우도 2열 구성을 기본값으로 삼지 않는다.

헤더는 중앙 정렬 최대 1040px, 좌우 최소 16px 여백, 상단 16px(모바일 8px), 높이 64px, radius 24px의 플로팅 유리 표면이다. 흰 배경 90%, 16px backdrop blur, 1px 경계, 0 8px 32px rgba(15,23,42,.06) 그림자를 사용한다. 모바일은 좌우 12px 여백/16px radius, 로고 28–32px와 최소 44px 로그인 버튼을 유지한다. 실제 로그인 동작은 바꾸지 않는다.

성장 기록 그래프는 평가 관리 바로 다음에 배치하고 가상 기록임을 유지한다. 마이페이지는 별도 '나를 담고, 내일을 정하다.' 장면에서 큰 이모지 프로필과 과목별 목표 입력을 소개한다. 실제 프로필 이모지 목록에서 가져온 예시 선택과 역사/국어/수학 목표 0–100 입력을 로컬 상태만으로 체험한다. 실제 계정이나 서버 저장 없이 '가상 프로필 체험 · 저장되지 않습니다'로 구분한다. 큰 이모지 120–176px, 선택 버튼 48–56px, 목표 수치 32–40px/입력 16px, 패널 radius 32px, 서로 다른 깊이의 그림자와 최대 24px 스크롤 이동을 쓴다. 등급에 따라 이모지가 열리는 실제 조건은 제목 옆 선택적 도움말에 둔다. 모바일은 한 열로 재배치하며 무한 애니메이션/새 미디어/게임 또는 Firebase 호출을 추가하지 않는다.

공개 홈 붓선·마무리 보완(2026-10-01): 각 장면의 선은 역방향 루프 없이 내려가는 하나의 큰 호와 제목 아래 짧은 획으로 단순화한다. 강조 제목의 실제 위치를 기준으로 8–16px 아래를 지나며, 본문/조작부를 가리지 않는다. 필압은 데스크톱 1–8px, 모바일 1–4px로 절제한다. 모바일·태블릿에서는 선을 시각물 바깥 여백으로 보내며 작은 화면에서 회전/이동 거리를 줄인다.

마지막 장면은 최초 하향 진입 시 상단 80px(모바일 72px)에 정렬하고 2200ms 동안 페이지 스크롤을 고정해 붓선 흡수와 브랜드 등장 애니메이션을 완결한다. 추가 스크롤 입력은 누적하지 않으며 완료 후 원래 위치에서 해제한다. 재진입은 고정하지 않고, Escape·상단 이동·로그인·포커스 이동·화면 회전·탭 비활성화에서는 즉시 해제한다. 모션 감소/높이 600px 미만에서는 고정하지 않고 완성 상태를 보여준다. 모바일에서 body fixed 방식으로 터치 관성을 차단하고 기존 스타일을 복원한다.

성적 확인의 서명 단계는 실제 화면의 빈 서명 칸에 가상의 손글씨 획이 화면 전환 550ms 후 1600ms 동안 순서대로 그려지는 SVG 연출을 겹친다. 단계가 실제로 화면 안에 보일 때 시작하며 재선택으로 다시 볼 수 있다. 실제 학생 이름·서명은 사용하지 않는다. 모션 감소에서는 완성 획을 표시한다. 맨 위로 버튼은 기존 48px 원형 안에 가운데 정렬된 20px 위쪽 꺾쇠(둥근 선 2px)를 사용한다.

공개 홈 연결·생각모아 보완(2026-10-01): 마지막 붓선은 Noto Sans KR의 '리' 글자에서 오른쪽 세로획 윗부분에 닿으며 마지막 접선은 수직으로 내려간다. 글자 크기에 비례하는 기준점을 사용하고 글꼴 로드·화면 크기 변경 후 다시 측정한다. 2200ms 고정 시간은 유지하며 선이 도착할 때 주황 글자가 이미 드러나 자연스럽게 이어진다.

생각모아는 익명 집계 단어들이 구역 진입 시 바깥에서 중앙으로 900ms 동안 모이고 40ms 간격(최대 280ms)의 시차를 두는 한 번의 연출을 사용한다. 최대 680px/최소 높이 320px의 중앙 무대에 큰 단어부터 놓고 8/12px 여백을 두어 작은 단어를 채운다. 단어 빈도에 따른 크기는 16–64px(모바일 14–40px), 이동·크기 갱신은 600ms이며 같은 단어를 더하면 해당 단어가 커지고 새 단어는 무대로 들어온다. 긴 단어와 늘어난 단어가 서로 겹치지 않게 배치한다. 직접 입력(최대 12자)과 기존 빠른 추가 버튼을 제공하며 로컬 체험만 수행한다. 입력은 앞뒤 공백/대소문자를 정규화해 중복을 합치고 최대 30개 단어로 제한한다. 모션 감소 시 모임·이동 없이 결과를 즉시 표시한다. 반복 루프, 미디어 추가, 서버 호출은 없다.

공개 홈 붓선 연속성 보완(2026-10-01): 선을 텍스트 블록 단위로 잘라 내는 검은 마스크와 선 내부의 흰 갈래를 제거한다. 한 면의 불투명 주황 획을 사용하고, 이동 경로의 실제 거리에 따라 필압을 부드럽게 보간한다. 연결 구간은 데스크톱 4px/모바일 3px, 강조 제목 아래는 최대 16px/모바일 10px로 굵어지며 섹션 경계에서 같은 두께와 접선으로 만난다. 문구와 조작부는 여백으로 우회하고 모든 곡선 접점의 방향을 연속으로 유지한다. 일반 장면의 선은 장면 하단이 화면 높이 85%에 닿으면 완성되어 다음 장면과의 접점이 비지 않는다. 첫 획은 태블릿 학습지 화면 안에서 출발해 프레임 바깥으로 나온 후 다음 구역으로 이어진다. 화면 속 시작점은 실제 기기 이동을 따라가며, 화면 밖에서는 추가 프레임 계산을 멈춘다. 마지막 '리' 세로획 흡수 지점은 실제 글꼴의 ㅣ 너비를 측정해 같은 두께·색으로 이어지고 끝 접선은 수직을 유지한다. 모션 감소 동작은 유지한다.

공개 홈 시작·흐름 재조정(2026-10-01): 첫 제목은 '역사를 읽고,'와 파란 '생각을', 주황 '연결하다'로 구성하고 끝 온점을 제거한다. 본문 중복 로그인 버튼과 기본 계정 안내는 감추되 오류·제한 브라우저 안내와 계정 복구 제어는 유지한다. 주황선은 실제 글꼴 '다'의 ㅏ 가로획 오른쪽에서 같은 굵기로 나오며, 마지막 '리'의 ㅣ와 연결되는 기존 흡수를 유지한다. 시작 글자의 등장 움직임은 최대 1400ms 동안만 추적한다. 선은 짧은 직각 모서리 대신 여백에 맞춘 긴 Bézier 호로 감싸고 접점의 방향을 유지한다. 화면과 키보드가 같은 경첩을 공유하는 CSS 3D 노트북을 사용하며, 뚜껑은 스크롤 진행에 따라 -104deg에서 6deg로 열린다. 닫힌 기기는 데스크톱 최대 -320px/모바일 -96px에서 열린 위치로 이동한다. 키보드 바닥은 76deg, 외부 이미지/3D 런타임/서버 요청은 추가하지 않는다. 노트북은 최초 6% 열린 상태에서 화면 높이 62%의 스크롤 거리 동안 완전히 열린다. 일반 장면의 진행률은 화면을 통과하는 거리를 기준으로 하고, 시각물은 데스크톱 최대 80px/모바일 44px 이동한다. 제목은 양옆 72px에서 1200ms 동안 모이고, 보조/강조 줄은 순차로 등장한다. 메뉴 배지는 20px/800(모바일17px), 파랑 8% 바탕/14% 경계, radius999px/8px 16px 여백으로 식별성을 높인다. 모션 감소·높이600px 미만은 완성된 정적 기기를 표시한다.
공개 홈 유성 흡수 연출(2026-10-01): 이전의 섹션 경계 연결선 계약을 대체한다. 각 장면의 주황선은 직선 구간 없는 Bézier 곡선을 따라 짧은 유성처럼 이동하고, 꼬리까지 해당 장면의 주요 타이포 또는 미리보기로 흡수된다. 진입 후 180ms 지연, 이동/흡수 1600ms, 도착 대상의 밝기 1→1.16→1 및 16px/24% 주황 광택 900ms를 사용한다. 선은 장면 경계까지 남지 않으며 머리 반경 4px(모바일3px), 모션을 끄면 선·광택은 숨긴다. 히어로의 '생각을 연결하다'는 첫 96px 스크롤로 opacity 0→1, 24px 아래에서 제자리로 나타나며 선은 96px 이상 스크롤해야 ㅏ 끝에서 출발한다. 첫 문장 위 소개 문구는 삭제한다. 헤더 로고는 y의 하강부를 고려해 기존 광학 정렬값 -0.0625em만 글자에 적용한다.

사용자 요청에 따라 공개 홈은 OS의 동작 감소 설정과 관계없이 매 방문 모션 ON으로 시작하며, 하단 44px 이상의 '모션 끄기/모션 켜기' 버튼으로 제어한다. OFF에서는 스크롤 고정과 타이머/움직임을 해제하고 제목·기기·그래프·조작을 완성 상태로 표시한다. 사이트 밖 OS 설정은 변경하지 않는다.

마이페이지 소개는 큰 이모지 선택/숫자 입력 구성을 대체하여 실제 '나의 기본 정보 / 나의 성적표 / 오답 노트' 메뉴를 단일 미리보기에서 전환한다. 최대 960px, 흰 표면, radius32px, padding24/32/48px, 48px 메뉴, 14/16/24/32px 글자와 8/16/24/32px 간격을 재사용한다. 가상 예시만 쓰며 실제 계정·저장·네트워크 호출은 없다.

공개 홈 연결·완성 시점 보완(2026-10-01): 구역별 독립 유성 대신 페이지 위 단일 SVG에서 이전 흡수점을 다음 출발점으로 공유한다. 아래쪽 S 곡선, 왼쪽/오른쪽 큰 호, 대각선 곡선을 교대로 사용하고 모두 cubic Bézier로 구성한다. 네이티브 스크롤 진행에 따라 짧은 꼬리가 이동하며 도착 후 320ms 동안 흡수, 600ms 밝기 강조를 적용한다. OFF는 SVG 자체를 제거한다. 히어로는 높이 600px 이상에서 80px 아래에 고정하고 뷰포트 안에 제목/기기가 함께 들어오도록 기기 폭을 제한한다. 제목은 첫 48px, 노트북은 첫 96px 안에 완성하고 이후 224px를 완성 화면 유지에 사용한다. 일반 제목은 뷰포트 65% 지점까지 도달하면 완성한다. 긴 장면은 스크롤 전반 60%에 전환을 완료하고 후반 40%는 완성 화면을 유지한다. 자료/성적 확인/성장/위플레이 높이는 각각 200/180/160/175svh이며 무대가 화면보다 큰 경우 고정을 해제한다. 기본 진입 애니메이션은 420–600ms, 항목 시차는 60ms 이내로 줄인다. 마지막 일회 스크롤 고정은 1400ms로 줄이고 로그인·포커스·Escape 등의 즉시 해제 계약은 유지한다.

한눈에 보는 위스토리 4항목은 기존 파랑/흰색/경계와 24px radius, 0 8px 32px rgba(15,23,42,.06) 그림자를 재사용하는 배지형 버튼에 24px 단색 SVG를 둔다. 마지막 학생 로그인은 흰색 Google G를 사용한다. 문제풀이의 선택 정답은 primary, 선택 오답은 danger text/soft와 정오답 문구로 구분한다. 기본 정보 미리보기에는 가상 현재 등급과 등급별 선택/잠금을 보여주는 48px 이모지 버튼을 추가하되 기존 탭과 로컬 체험만 유지한다.

## 1. Atmosphere / Signature

명예의 전당 어좌 개편(2026-10-07): 제공된 태조 어진의 청색 곤룡포·붉은 어좌와 영조 곤룡포의 금색 용보를 참고한 새 래스터 이미지를 기본으로 사용한다. 중앙 1위만 어좌·청색 용보·금색 테두리로 강조한다. 그림은 원본 1586:992 비율을 유지하고 2·1·3위 이모지 중심은 20·50·80%, 시작 높이는 데스크톱 39·27·43%, 모바일 30·18·34%로 둔다. 명시적인 데스크톱 미리보기는 패널 폭과 무관하게 데스크톱 좌표를 유지하고 넓이 조절은 이모지 배율에 반영한다. 구형 기본 이미지의 좌표는 royal_podium_v2로 전환하며 별도 업로드 이미지는 기존 배치를 유지한다. 학생 정보는 그림 아래 같은 열 순서의 배지에 학년·반, 번호, 이름, 점수를 각각 표시한다. 번호가 공개 데이터에 없으면 ‘번호 비공개’로 표시하고 다른 학생의 비공개 프로필을 조회하지 않는다. 1위 배지는 기존 primary-text 바탕과 accent 테두리를 재사용한다. 이름 16px(좁은 패널 14px), 학년·반·번호 12px, 점수 14px(좁은 패널 12px), 44px 최소 조작 영역, 4/8/12/16/24px 간격을 사용한다. 컨테이너 폭 480px 이하에서는 여백을 줄이고 글자 크기를 유지한다. 동점자 정보는 해당 순위 열에 모두 세로로 표시하고 선택·키보드 포커스로 그림 위 대표 이모지를 바꾼다. 좌표 편집은 실제 그림 영역에서 이모지를 이동하며 정보 배지는 고정해 겹침을 막는다.

명예의 전당(2026-10-07): 학생·교사 화면의 기존 ‘화랑의 전당’ 명칭을 ‘명예의 전당’으로 통일한다. 기본 시상대는 조선 궁궐의 단청·구름무늬·석단을 모티프로 한 생성형 래스터 이미지로 교체한다. 왼쪽 은색 2위, 가운데 높은 금색 1위, 오른쪽 동색 3위 구도를 유지하고 상단은 기존 학생 정보 오버레이를 위한 여백으로 둔다. 이는 조선시대 분위기의 창작 일러스트이며 유물 복원도가 아니다. 기존 시상대 위치, 공개 범위, 점수, 동점자 및 팝업 동작은 유지한다.

Westory는 중학교 수업 운영과 학생 학습 경험을 함께 담는 밝고 실용적인 교육용 웹앱이다. 시각 방향은 새로워 보이기보다 즉시 이해되는 관리도구형 정돈감, 학생에게는 단순한 다음 행동, 교사에게는 촘촘하지만 읽히는 운영 흐름이다. 기본 표면은 밝은 회색과 흰색 카드, 명확한 파란 primary, 제한적인 amber 브랜드 포인트를 유지한다.

Design Read: 교육 현장용 React 앱, 학생과 교사가 함께 쓰는 운영 UI, calm school utility 방향.

- `DESIGN_VARIANCE`: 3/10. 기존 화면을 전면 재배치하지 않고 한 화면, 한 섹션, 한 패턴씩 개선한다.
- `MOTION_INTENSITY`: 3/10. 상태 변화와 메뉴 전환은 빠르고 절제한다.
- `VISUAL_DENSITY`: 학생 4/10, 교사 7/10. 학생은 한 열 흐름, 교사는 정보 밀도를 허용하되 구조를 선명하게 한다.

## 2. Color

모든 새 색상은 아래 역할 중 하나로 매핑한다. 새 raw hex를 컴포넌트에 직접 추가하지 않는다.

| Token | CSS variable | Hex | Role |
| --- | --- | --- | --- |
| Page background | `--ws-bg` | `#f9fafb` | 앱 전체 배경 |
| Surface | `--ws-surface` | `#ffffff` | 카드, 모달, 메뉴 표면 |
| Surface subtle | `--ws-surface-subtle` | `#f8fafc` | 모바일 메뉴 상태 영역, 약한 섹션 배경 |
| Text strong | `--ws-text-strong` | `#111827` | 주요 제목, 활성 텍스트 |
| Text | `--ws-text` | `#1f2937` | 본문 기본 |
| Text muted | `--ws-text-muted` | `#6b7280` | 보조 설명 |
| Text soft | `--ws-text-soft` | `#9ca3af` | 비활성 설명, 약한 메타 |
| Border | `--ws-border` | `#e5e7eb` | 기본 구분선 |
| Border soft | `--ws-border-soft` | `#f3f4f6` | 내부 구분선 |
| Border blue | `--ws-border-blue` | `#dbeafe` | 파란 강조 표면 border |
| Primary | `--ws-primary` | `#2563eb` | 대표 행동, 활성 메뉴 |
| Primary hover | `--ws-primary-hover` | `#1d4ed8` | primary hover/active |
| Primary soft | `--ws-primary-soft` | `#eff6ff` | primary 배경 강조 |
| Primary text | `--ws-primary-text` | `#1e3a8a` | primary soft 위 텍스트 |
| Accent | `--ws-accent` | `#f59e0b` | Westory 로고 Story, 보상/브랜드 포인트 |
| Accent text | `--ws-accent-text` | `#92400e` | amber 계열 텍스트 |
| Accent soft | `--ws-accent-soft` | `#fffbeb` | 약한 amber 표면 |
| Danger | `--ws-danger` | `#ef4444` | 삭제, 오류 배지 |
| Danger text | `--ws-danger-text` | `#b91c1c` | 오류 텍스트 |
| Danger soft | `--ws-danger-soft` | `#fef2f2` | 오류 배경 |
| Success | `--ws-success` | `#16a34a` | 성공 행동, 완료 상태 |
| Success hover | `--ws-success-hover` | `#15803d` | 성공 hover/active |
| Success soft | `--ws-success-soft` | `#dcfce7` | 성공 배경 |
| Warning text | `--ws-warning-text` | `#dc2626` | 경고 텍스트 |
| Overlay | `--ws-overlay` | `rgba(15, 23, 42, 0.62)` | 모달 backdrop |
| Focus ring | `--ws-ring` | `#3b82f6` | focus-visible outline/ring |
| Solid label contrast | `--ws-solid-label-text` | `#000000` | 단색 일정 라벨에서 흰색·기본 본문색 모두 대비 4.5:1 미만일 때 사용하는 글자색 |

Contrast notes:

- `--ws-text` on `--ws-bg` and `--ws-surface` is safe for normal text.
- `--ws-primary` with white text is reserved for large or bold controls. For small text on soft blue backgrounds, use `--ws-primary-text`.
- Amber is an accent, not a default CTA color.

## 3. Typography

Calendar editor contract:
- 공휴일 날짜와 이름은 요일보다 우선하여 빨간색으로 표시한다. 토요일과 겹친 공휴일도 빨간색이며, 공휴일이 아닌 토요일만 파란색으로 표시한다.
- Teacher event dialog: maximum width 960px; two columns from 768px, one column below it.
- Existing category palette in `scheduleCategories.ts` also supplies optional per-event label colors; labels use dark text on a 22% tint of the chosen color.
- Calendar label height: 24px; text: existing 12px label size, 4px horizontal padding, single-line ellipsis. FullCalendar owns the date-span width.
- Editor controls: 40px minimum height; dialog gaps/padding use 8px, 12px, 16px, 24px. Memo height: 96px (64px on short landscape screens).
- Category management edits one selected category at a time, without growing the dialog vertically.

Font stack: `Noto Sans KR`, system sans-serif. Korean readability and school-device compatibility are more important than novelty.

| Role | Token | Size | Weight | Line height | Letter spacing |
| --- | --- | --- | --- | --- | --- |
| Logo | `--ws-type-logo` | `1.62rem` | 800 | 1 | `-0.025em` |
| Teacher header logo (desktop) | `--ws-type-teacher-logo` | `2rem` | 800 | 1 | `-0.025em` |
| Teacher header logo (mobile/tablet) | `--ws-type-teacher-logo-compact` | `1.62rem` | 800 | 1 | `-0.025em` |
| Page title | `--ws-type-page-title` | `1.75rem` | 800 | 1.25 | 0 |
| Section title | `--ws-type-section-title` | `1.25rem` | 800 | 1.3 | 0 |
| Card title | `--ws-type-card-title` | `1rem` | 800 | 1.35 | 0 |
| Body | `--ws-type-body` | `1rem` | 400 | 1.6 | 0 |
| Body strong | `--ws-type-body-strong` | `1rem` | 700 | 1.5 | 0 |
| Small | `--ws-type-small` | `0.875rem` | 500 | 1.55 | 0 |
| Label | `--ws-type-label` | `0.75rem` | 800 | 1.2 | 0 |
| Button | `--ws-type-button` | `0.95rem` | 700 | 1.2 | 0 |
| Meta | `--ws-type-meta` | `0.72rem` | 700 | 1.25 | 0 |

Rules:

- 학생 화면 본문은 14px 이하로 장시간 읽게 만들지 않는다.
- 교사 화면의 표, 상태, 보조 정보는 작게 쓸 수 있지만 label과 값의 위계를 유지한다.
- 새 표시 텍스트에는 과한 영문 마케팅 문구를 넣지 않는다.
- 색, 아이콘, 표 헤더, 선택 상태만으로 의미가 충분히 전달되는 곳에는 사용법 설명 문단을 추가하지 않는다. 학생 점수 확인, 교사 운영 모달, OMR·정오표처럼 반복 확인하는 화면은 특히 설명보다 구조와 라벨을 우선한다.

## 4. Spacing

Base unit: 4px. 새 margin, padding, gap은 아래 토큰을 우선 사용한다. 1px border와 0은 예외다.

| Token | Value | Use |
| --- | --- | --- |
| `--space-1` | 4px | 아이콘과 짧은 라벨 사이 |
| `--space-2` | 8px | 작은 버튼 내부, 짧은 리스트 gap |
| `--space-3` | 12px | 일반 control gap |
| `--space-4` | 16px | 모바일 페이지 gutter, 카드 내부 최소 padding |
| `--space-5` | 20px | 카드 header/body gap |
| `--space-6` | 24px | 일반 섹션 padding |
| `--space-8` | 32px | 데스크톱 카드/섹션 gap |
| `--space-10` | 40px | 데스크톱 페이지 gutter |
| `--space-12` | 48px | 큰 섹션 간격 |
| `--space-16` | 64px | sticky header 높이 |
| `--space-20` | 80px | 넓은 랜딩성 영역에만 사용 |

Layout tokens:

- Teacher sidebar: 232px expanded by default on desktop, including direct settings entry; 88px compact only when requested through the menu control. Preserve the current expanded/compact state when entering or leaving settings; compact entries retain an icon and short visible label, with the full existing name available to assistive technology and on hover. Compact menu rows are 60px (52px below 820px viewport height); expanded rows remain 44px (40px below 820px). Icons use 24px outlines with 1.8px rounded strokes and 16px chevrons. The rail starts at the top of the viewport with the original Westory wordmark and tagline; compact mode uses the short We mark; its menu list scrolls independently when needed, with settings accessible at the bottom. Below 1024px, place the hamburger at the far right of the account header and anchor the full-label drawer to the right edge (320px maximum width, 40px minimum backdrop strip); keep its close button at the upper right. Desktop navigation stays on the left.
- Teacher account toolbar: retain the original transparent 48px desktop account area inside the main column, without a full-width white bar or bottom border; the full Westory wordmark and tagline belong in the expanded sidebar. The existing name, notification, remaining session time, extension and logout controls remain together. The dashboard semester badge remains visible; narrow screens may use a second header row. Keep the desktop rail at z-index 30 and header at 40, below existing content modals/panels at 50 or higher; the mobile navigation drawer retains its existing overlay layer.
- Teacher settings workspace: join the 288px flat settings navigation directly to the global rail at desktop widths (1024px and above). Extend this navigation upward across the transparent 48px account area so it begins at viewport top without an empty strip; keep the account controls and settings content in their existing positions. At 768–1023px use a 256px settings navigation; below 768px use a labeled expandable menu above the content. The seven existing setting sections remain separate and keep their full names. Use 44px minimum navigation rows, a 24px heading inset, existing blue active-state tokens and outline icons. The workspace fills the remaining viewport width, with 32px desktop padding (24px below 1280px, 16px below 768px). Keep general-settings content groups within 1280px. When the content area is at least 800px wide, arrange general settings in two equal columns with a 24px gap: semester switching beside readiness, then semester preparation beside student-menu visibility. Student-menu choices occupy one horizontal row on this layout. Smaller content areas stack the sections. Allow action rows to wrap and keep button labels unbroken. The settings navigation sticks at viewport top after the transparent toolbar scrolls away. Do not enlarge the font or change setting behavior to fill the space.
- Teacher settings panels: at a content width of 800px or more, school settings place school level and grades in the left column and classes in the right; interface main settings use two equal columns. Reuse the 24px gap and stack below this width. Sitemap previews for both roles place all top-level menus in one equal-width row at this width, using the existing 12px gap; use two columns from 480px and one below. School-level choices also sit side by side from 480px. Keep the settings footer inside the content column and extend the navigation surface through the footer so scrolling to the page end leaves no bottom gap.
- Teacher weekly dashboard: 1536px maximum width, 16px panel gap, desktop content height `clamp(620px, calc(100dvh - 140px), 880px)`; small screens use natural document scrolling.
- Teacher dashboard weeks run Sunday through Saturday, matching the full calendar. Week navigation, current-week reset and search selection share this boundary; Sunday is red, Saturday is blue, and public-holiday red takes precedence.
- Teacher navigation motion: accordion content unfolds with grid rows 0fr↔1fr and opacity for 200ms on an explicit teacher menu click, including reduced-motion mode as requested; this height transition is a scoped exception to transform-only motion. Initial navigation does not animate. Week changes move only date numerals and event text by 12px for 140ms in the requested direction; the calendar frame, day hit areas, ribbon circles, row dividers and navigation arrows stay fixed. Interrupted transitions cancel cleanly. At the user's explicit request, user-triggered week changes retain this animation in reduced-motion mode; initial rendering does not animate.
- Teacher footer: transparent with 8px top, 16px horizontal and 12px bottom padding; existing policy links and copyright remain centered.
- Teacher semester label: display the configured year/semester beneath the sidebar wordmark and tagline, using 12px bold primary-text on primary-soft, a 16px line height, 0/8px padding and 4px corners. Keep the label in normal flow, with an 8px gap below the tagline and the existing 12px brand-bottom padding plus 8px navigation-top gap (4px in the short-desktop layout) below it. Preserve menu item sizing, inter-item spacing and overflow behavior; the brand area reserves the label height instead of overlapping the first menu. In compact mode the logo tooltip retains the semester and the label is hidden like the tagline. Below 1024px show the same small label under the header logo, within its existing 64px row, and also in the open drawer. The teacher dashboard no longer has a separate semester heading in its account row; the student heading remains unchanged.
- Teacher portal account placement: on every teacher route, add 24px above the existing 48px desktop account row. Give its container the same 1536px maximum width and 24px horizontal padding as the weekly dashboard (16px below 1120px, 12px below 640px), so the right edge of the account controls aligns with the right card. Preserve dashboard panel heights and allow natural document scrolling. Use the same account alignment on dashboard, management, calendar and settings pages. Settings secondary navigation offsets by the full 72px account area to remain flush with the viewport top; its workspace minimum height subtracts that same area. Mobile account layout keeps its existing responsive row arrangement.
- Weekly date ribbons: a date with non-holiday schedules uses the first schedule in the existing chronological list as its representative ribbon. Apply that event's configured color (including custom labelColor), darkened with the existing readable-event-color helper for legible white numerals, to the date circle. Expose the representative event title in the date tooltip and accessible label. Holiday-only dates retain red text. A ribbon on today keeps its event color and gains a blue outer ring; selection keeps its existing indication. Multi-day schedules color every included day.
- Weekly numeral alignment: use a one-em line box, tabular numerals and a -0.05em optical top offset inside the centered date circle; keep the horizontal text transition independent. Event metadata uses a 12px category badge with 20px line height, 0/8px padding, neutral surface, a 1px neutral border and 4px corners, a 12px gray vertical divider, and a 16px outline clock before the unbroken period label. Animate only the inner label text so badges, dividers and icons remain fixed.
- Weekly event dots: keep the shared 4px marker slot and apply a common -2px optical vertical offset on all viewport sizes. Event and holiday dots use the same offset and numeral-to-dot distance regardless of ribbon, today or selection; retain a single horizontal baseline without moving the numerals or weekday labels.
- Weekly calendar readability: desktop title/date numbers 24px, event title 18px, date/period metadata 14–16px; event rows 80px. Mobile event titles remain 16px and section titles 18px. Search/add/filter controls reuse the current calendar's bordered search, blue add, and 44px control sizing.
- Teacher dashboard ranking: reserve at least 328px in the desktop grid so all five ranking rows fit at shorter viewport heights.
- Weekly calendar actions: filter, search and add sit beside the calendar title at the top right, wrapping below the title on narrow screens. Search/add use labeled 44px square icon buttons. Search opens a 160px input to the left of its icon (160ms width/opacity reveal; reduced-motion disables this input transition), retaining the existing title/description search across the supplied semester events. Results replace the event list in place. The labeled 44px full-calendar icon sits between search and add in one non-wrapping action row. The inline search field may shrink on narrow screens to keep all three icons together. Weekly event titles have no ribbon box: they use the event hue (darkened only as needed for 4.5:1 text contrast on the date tint), with holidays in danger text red and no redundant holiday category label. Non-holiday dates use a 4px-radius ribbon badge with the existing event-color border and 22% tint. Dates are written as M월 D일, including both ends of date ranges. The upper action row starts with a 16px bold week-range badge and a 16px current-week button; the badge explicitly names the month (and the year in its accessible label). Remove the separate month column. Previous/next week controls sit at the two edges of the date strip, 44px each; on narrow screens they occupy its top corners above the seven dates. Range badges use 8px/12px padding and primary-soft color.
- Page max width: `--ws-page-max: 1280px`.
- Header height: `--ws-header-height: 64px`.
- Header dropdown min width: `--ws-header-dropdown-min: 11rem`.
- Header dropdown max width: `--ws-header-dropdown-max: min(24rem, calc(100vw - 2rem))`.
- Mobile gutter: `--space-4`.
- Desktop gutter: `--space-10`.
- Student page default: one column first.
- Teacher page default: dense grid allowed only when labels, actions, and overflow remain clear.
- Teacher dashboard width contract (768px and above): maximum `min(96rem, calc(100vw - 2rem))` (1536px cap), horizontal padding `clamp(1.5rem, 2.6vw, 2.5rem)` (24–40px). Keep the existing five-column grid with calendar spanning three columns and the side panels spanning two; gap remains 16px. These values must not depend on Tailwind CDN insertion order. Do not add `max-w-7xl` or `px-4` overrides to this container.

## 5. Components

### Floating actions

- Keep the existing 56px patch memo launcher at the lower right. When it is present, right-aligned page actions use the existing clearance of 104px from the bottom below 640px and 112px above it, plus the bottom safe-area inset. Centered student-selection and OMR bars need this clearance only below 768px. Preserve the ordinary positions when the memo launcher is absent. Use a body-level presence selector so portaled PDF controls follow the same rule.
- Reserve scroll-end space for raised save/selection controls using the same clearance plus 80px. PDF tag sheets reserve room above the active global launcher: teacher memo clearance, or 152px plus the safe-area inset above the student's dictionary. Keep their contents scrollable within the remaining dynamic viewport, with a 64px top allowance.
- Student score save status stays at its existing bottom position; from 1024px, place its right edge 92px plus the safe-area inset from the screen edge (24px edge + 56px dictionary + 12px gap).

### Portal navigation and workspace footers

- Teacher map navigation expands each category's maps directly beneath it, matching student maps with the existing 16px indent, 8px inner spacing and selected-row treatment. Category selection keeps the mobile menu open; choosing a map closes it. Keep category rename/reorder controls, map edit/tag controls and persistence unchanged. Replace the duplicate horizontal map tabs and category badge with the selected map title.
- Move the student's configured My Page destination from the primary menu list to the sidebar bottom, in the same slot as teacher Settings. Preserve its configured label, destination and visibility; a My Page group with custom child links stays in the primary menu so those destinations remain accessible. Use the existing blue soft background, blue border/text, 8px radius and bold label, including in the mobile drawer. In compact desktop navigation use the short label `내 정보` with the full configured title accessible.
- Page-level subnavigation workspaces use the Settings layout: navigation spans both rows, content occupies the upper right cell, and the existing footer occupies the lower right cell. Extend the white navigation surface through the footer to the page end. Below 768px keep navigation, content and footer in normal single-column flow. Preserve independent desktop menu scrolling, mobile disclosure behavior, and existing menu dimensions. Nested score/rank lists keep their existing page footer. Hidden workspaces must not suppress the visible page footer.

### Assessment stacked bars

- Student assessment ratios use one horizontal 0–100% stacked bar per subject. A score view uses the same item order and colors on a 0–100 point axis; unentered scores remain labeled as unentered.
- Segment palette reuses `--ws-primary`, `--ws-accent`, `--ws-success`, `--ws-text-muted`, `--ws-ring`, and `--ws-accent-text` in item order. Each segment has a matching visible item name and value; color is never the only label.
- Use existing 40px bar height, 8px radius, 8/12/16/24px spacing and 12/14/16px type. Long assessment names wrap. Charts remain one column on mobile and update directly from the current data without decorative motion.

### Teacher assessment editor

- Use separate white, bordered editor and list surfaces with 12px radius, 24px padding (16px on mobile), and a 24px gap. The grading page uses the existing 96rem maximum width; at 1280px viewport and above use a 5:7 editor-to-list split. Smaller screens place the editor first. Card actions share the subject heading row at the upper right without wrapping. Below 640px use labeled 40px icon buttons; truncate long subjects with a full title. Assessment details retain the full card width. Keep percentages unbroken, and allow long names to wrap only when they cannot fit. The registered-plan list scrolls internally after min(70dvh, 48rem), with its heading and sort control outside the scrolling area; short lists retain natural height. Reuse 8px gaps, and do not make the editor sticky.
- Inputs are 44px high with 8px radius and 14px text. Grade and subject share a row above 640px. Each assessment has a full-width area name followed by type, maximum score and weight; below 640px the type spans a row and the two numeric fields share a row.
- Use visible labels and units, 40px minimum action targets, and existing primary/surface/border/text tokens. A 8px stacked ratio strip reuses the student chart palette; show the numeric total and remaining/excess ratio in text. Primary save stays blue for both creation and editing.
- Preview dialogs use a 72rem maximum width and equal columns from 1024px. Score inputs stay in an 80px right-hand column at every viewport, matching the student score card, with 44px height. Description text occupies the flexible left column and metadata phrases wrap as whole units. The graph total stays at the right of its heading. Reuse 8/12/16/24px spacing and the existing typography and palette.

### Header

- Mobile account blocks place the bold 16px profile directly above one unbroken row of notification, countdown/extension and logout controls, with 8px row spacing and 40px minimum targets. Countdown text stays centered with equal-width icon/extension columns. Keep desktop placement unchanged. Notification panels anchor 8px below their bell, clamp horizontally to 12px viewport margins, and scroll within the remaining viewport height; never cover the trigger. Reuse the existing 360px popover width.
- Mobile student-list filters and points grade/class/sort selectors share one row using flexible equal columns and existing 4/8px gaps, 40px controls and 12/14px text. Search expands into its own row on request. Student pagination uses one row, the existing 32px minimum number width with 40px height and 4px gaps, with ellipses replacing distant pages (first four plus final two initially; current neighbors and end anchors afterward).

- Teacher header: keep the existing 64px row height and center the logo, navigation labels, and account actions on the same axis.
- Teacher logo optical offset: `--ws-teacher-logo-optical-offset: -0.0625em` (2px upward at 32px). Apply only to the lettering to balance the descending `y`, scale with the compact logo, and preserve the link's hit area.
- Teacher active navigation underline: `--ws-header-nav-indicator: 3px`; position independently of the label so it does not shift vertical alignment.

- Background: `--ws-surface`.
- Border: `1px solid --ws-border`.
- Height: `--ws-header-height`.
- Position: sticky top 0.
- Active nav: `--ws-primary` text and bottom border.
- Mobile menu: fixed below header, full viewport height minus header.

### Buttons

- Teacher student-list data cells use 8px vertical padding. Row management buttons keep 44px touch targets; on fine-pointer, hover-capable screens at least 768px wide, use a compact 32px minimum height. Preserve horizontal padding, text sizes, wrapping and keyboard focus.

Primary button:

- Background: `--ws-primary`, hover `--ws-primary-hover`.
- Text: white.
- Radius: `--radius-full` for login/large CTA, `--radius-md` or `--radius-lg` for admin tools.
- Padding: x `--space-4` to `--space-6`, y `--space-2` to `--space-3`.
- Disabled: opacity 0.6 plus disabled cursor.

Secondary button:

- Background: `--ws-surface`.
- Border: `--ws-border`.
- Text: `--ws-text`.
- Hover: `--ws-surface-subtle`.

Danger button:

- Background or text must use `--ws-danger` or `--ws-danger-text`.
- Destructive copy must state the object being changed or deleted.

Icon-only controls:

- Must have `aria-label`.
- Minimum touch target: 40px by 40px.

### Cards and Sections

- Card background: `--ws-surface`.
- Border: `1px solid --ws-border`.
- Radius: `--radius-lg` by default.
- Shadow: `--shadow-sm` for routine cards, `--shadow-md` for overlays or lifted cards.
- Do not nest cards inside cards unless the inner card is a distinct interactive object.
- Simple counts or one-line metadata should use plain layout before adding a card.
- 학생 점수 화면에서 문항 목록, 피드백, 확인 요청 대상은 카드 안 카드 구조를 피한다. 필요한 경우 같은 표면 안에서 header, list, footer로 나누고 내부 배경은 한 단계만 사용한다.

### Forms

- Labels are required. Placeholder cannot replace label.
- Input border: `--ws-border`, focus ring `--ws-ring`.
- Help text and validation text stay near the field.
- Risk fields such as semester, permission, visibility, delete, and public range need explicit helper copy.

### Tabs and Segmented Controls

- Use when switching views inside the same data context.
- Active state must be visible through both color and weight.
- Keep 2 to 5 items when possible.
- Mobile overflow should scroll horizontally only for the control row, not the whole page.

### Badges and Status

- Color must communicate a real state, not decoration.
- Do not rely on color alone. Pair with text.
- Teacher screens should avoid new emoji badges.
- Add a shared status mapping when the same state appears in two or more places.

### Modals and Panels

- 수업 PDF 목록은 `a5b3c45`의 겹침 패널을 따른다. 폭 20rem, PDF 안쪽 여백 12px, 화면 최대 높이는 `calc(100dvh - 2rem)`이며 내부 목록만 스크롤한다. 작은 PDF에서도 조작할 수 있도록 목록이 열린 편집 영역의 최소 높이는 `min(28rem, 70dvh)`다.

- 알림장 관리 팝업은 기존 `d360227` 레이아웃을 따른다: 최대 80rem, 목록 16rem, 이미지 영역 16rem/최대 높이 180px, 목록 3개씩 표시. 1024px 미만에서는 편집기를 먼저 배치하고 팝업 본문 하나만 스크롤한다. 간격과 색상은 기존 토큰을 사용한다.

- Backdrop: `--ws-overlay`.
- Surface: `--ws-surface`.
- Radius: `--radius-xl`.
- Shadow: `--shadow-xl`.
- One modal at a time.
- Long editing flows should become a section or side panel instead of a deep modal.

### Tables and Lists

- Teacher comparisons and operations can use tables.
- Student flows should prefer lists, steps, or simple cards.
- Sticky table header only for genuinely long lists.
- Row click and row action buttons must not compete.

Component radius tokens:

- `--radius-sm: 4px`.
- `--radius-md: 8px`.
- `--radius-lg: 12px`.
- `--radius-xl: 16px`.
- `--radius-full: 9999px`.

## 6. Motion

### Student portal layout alignment

- Student routes reuse the teacher portal's 232px desktop sidebar (88px collapsed), 1024px drawer breakpoint, transparent account toolbar, outline icons, surface colors, spacing and footer. The shared navigation receives only the existing visible student menus and student routes; teacher settings and management actions remain absent.
- On mobile, show the Westory logo and menu trigger in the header; place the semester, student profile/rank, notifications, session controls and logout inside the right drawer. Preserve focus trapping, Escape/backdrop dismissal, body scroll locking, and focus return. Use the existing 320px drawer width, safe-area padding and 40px action targets.
- Student dashboard: reuse the teacher dashboard's 1536px maximum width, 16px gaps and 24/16/12px responsive gutters. Keep the student's calendar/list/search/attendance interactions. Desktop places the calendar on the left and notice/ranking on the right; below 1120px use natural page scrolling in notice, calendar, ranking order. The semester appears in navigation, without a second dashboard badge.
- Student content uses the same main-column alignment while retaining page-specific reading widths and student controls. No additional palette, font, shadow or motion system is introduced.

Motion supports orientation only. Do not use motion to decorate routine admin surfaces.

| Token | Value | Use |
| --- | --- | --- |
| `--motion-fast` | 160ms | hover, active, small state changes |
| `--motion-base` | 200ms | menu open, toast, simple reveal |
| `--motion-slow` | 300ms | side panel or modal transition |
| `--ease-out` | `ease-out` | default entrance |
| `--ease-standard` | `ease` | routine color/border changes |
| `--press-scale` | `0.985` | press feedback |

Rules:

- Animate only transform, opacity, or filter for new motion.
- Respect `prefers-reduced-motion: reduce`.
- Student reward/recognition motion can be more expressive, but it must not block learning flow.

## 7. Depth

Depth strategy: light surfaces use borders first, then restrained shadows only where hierarchy or overlay behavior needs it.

| Token | Value | Use |
| --- | --- | --- |
| `--shadow-xs` | `0 1px 2px rgba(15, 23, 42, 0.04)` | subtle surface lift |
| `--shadow-sm` | `0 8px 18px rgba(15, 23, 42, 0.04)` | routine cards |
| `--shadow-md` | `0 14px 28px rgba(15, 23, 42, 0.10)` | hover or emphasized panel |
| `--shadow-lg` | `0 18px 40px rgba(15, 23, 42, 0.14)` | drawer, popover |
| `--shadow-xl` | `0 24px 60px rgba(15, 23, 42, 0.22)` | modal |
| `--shadow-danger` | `0 4px 10px rgba(239, 68, 68, 0.22)` | notification or danger badge |
| `--shadow-accent` | `0 10px 24px rgba(146, 64, 14, 0.14)` | amber reward emphasis only |

## Superloopy Frontend Gate

Optional help uses a circular 16px information glyph beside its heading or main label, with a 40px button target. Keep its text hidden until hover, focus, click or tap; dismiss on Escape, outside click or focus exit. Use existing 12px padding, 8px radius, surface/border/text colors and popover shadow, with a maximum width of 320px bounded by its container. Delete redundant introductory or instructional sentences rather than moving them into permanent captions. Preserve essential validation and consent text.

For visible frontend work, use this sequence before editing UI code:

1. Read `AGENTS.md`, `UI_RULES.md`, and this `DESIGN.md`.
2. State the Design Read and confirm whether the surface is student, teacher, or shared.
3. Add or adjust tokens here before writing new values in code.
4. Run the anti-slop pre-flight: no generic purple glow, no unsupported font/palette drift, no hidden raw hex outside approved legacy areas, no unmanaged spacing.
5. Capture real-browser evidence for changed screens at 390px, 768px, and 1280px when UI pixels change.
6. Record evidence under `.superloopy/sessions/<session-id>/evidence/` or the active Superloopy evidence root.

No visible UI work is complete until the design contract and verification evidence agree.

### Teacher notice image sizing

- The dashboard notice viewport fills the space remaining after the heading and controls. Images and the carousel track use the measured slot without intrinsic aspect ratios imposing a minimum height; images use `contain` and never zoom on hover.
- Measure the viewport with `ResizeObserver`. In the image registration/editing dialog only, recommend a 16:9 source at twice its contained image size, rounded to whole 16:9 units and capped at the existing 1200×675 upload maximum. The existing 16:9 center crop/compression contract remains unchanged; other editor entry points keep the 1200×675 fallback recommendation.
- Do not show image size guidance below the dashboard notice image, including the empty state.

- Weekly event rows keep date, title, category/class metadata and period on one line when space allows. Below 768px, use compact M/D dates (M/D–M/D for ranges), 12px dates/categories, 14px titles and existing 4px gaps. Category badges and periods always show their complete text without shrinking; allocate the remaining width to the full event title. Overflowing mobile titles pause at the start for 2400ms, pan left at 24px/s (at least 2000ms), pause at the end for 1200ms, then reset and repeat after the start pause. Measure the actual text/slot width; short titles remain still. Below 360px or with reduced motion on mobile, place metadata on a second full-width row to preserve title space. Reduced-motion users receive wrapped full titles. The heading 이번 주 학사 일정 never wraps. Mobile dashboard order is notice, schedule, ranking; desktop order remains unchanged.
- Below the existing 1024px hamburger breakpoint, the teacher header shows only its logo and menu button. Show the year/semester and profile name only inside the drawer, with notifications, session countdown/extension and logout directly below; reuse the same handlers and session state. Use 12px/8px gaps, 40px controls and existing neutral tokens. Center countdown numerals with a one-line flex box, tabular numerals and symmetric badge padding. Keep desktop account placement unchanged. Notification popovers opened inside the mobile menu stay within the dynamic viewport and scroll internally.
- Mobile teacher header (below 1024px): reserve 24px plus the top safe-area inset above the logo row. Session extension, logout and close controls use at least 40px touch targets. The patch memo panel uses dynamic viewport height with safe-area padding and a scrollable body.
- Lesson materials, think cloud, maps, question registration, Wis policy and rank management reuse the settings submenu pattern through `TeacherSubNavigation`: a flat white 228px navigation (208px at 768–1023px), existing blue active-state tokens, 44px minimum menu rows and the same content padding. Below 768px, show the current selection in an expandable menu above the content; selection closes it and returns keyboard focus to the toggle. Escape also closes it. Preserve nested lesson units, visible management actions, map ordering, classroom filters and unsaved-state indicators. These submenus replace the former mobile content drawers and floating list launchers.
# Teacher navigation labels

Student curriculum headings retain collapse behavior: major titles toggle their contents without a chevron; middle titles toggle leaf units with a 14px downward chevron (rightward when collapsed). Default to expanded. Both heading controls have 44px keyboard-accessible targets. Leaf titles still open lessons and have no document icon or misleading collapse control. This supersedes the earlier always-visible/no-collapse behavior while retaining hierarchy typography and indentation.

Student curriculum uses always-visible published major/middle groups without collapse controls or leaf document icons. Major headings are leftmost, 16px/800; middle headings are indented 12px, 14px/700; leaf buttons sit another 8px inward and retain 44px targets and rounded selection. Wrap major/middle labels to keep their full names visible. Preserve teacher-authored order and published curriculum filtering; the overall mobile menu disclosure stays available.

All student and teacher submenu selections follow the primary sidebar child style: 8px rounded corners, primary-soft background, primary blue text and bold active labels. Remove left-edge active stripes/inset shadows; retain subtle hierarchy guide lines, keyboard focus outlines, widths and interaction behavior. This supersedes earlier flat/stripe selection styling for shared submenus and remaining standalone submenu components.

### History classroom lesson worksheets

- History O/X feedback uses transparent brush-shaped SVG silhouettes with uneven width, tapered ends and fine edge marks; no badge, background, halo, border or shadow. Reveal the blue O along a 600ms circular mask path; reveal the red X in two strokes (260ms then 280ms with 170ms delay). Use a 64px symbol in the existing 72px counter-scaled canvas, hold then fade over the last 200ms of the 1200ms lifetime. Reduced motion shows complete static brush marks. This replaces the earlier white badge, pop, shake and sparks.
- Student classroom entries are one balanced card without a separate status box. Use a 20px title, 12px curriculum path without a repeated leaf title, and a plain three-column key-information row (12px labels, 18px bold values, subtle vertical separators, no nested cards). Show assignment reason directly below the title at 14px with 20px line height, and other metadata on a compact 12px row. Keep vertical card padding at 12px and metric margins at 8px. Place 16px status text with a 20px icon inline below the metadata, without a footer divider. Omit the redundant retry-available status row; preserve pending-submission recovery status. Keep the 44px action on the right, vertically centered beside the content from 640px; below 640px keep it right-aligned at its natural width. Do not increase card height. Cooldown stays inline as `약 N분 후 가능`, without a redundant disabled waiting button. Keep recent score `N/M문제` and use amber/blue/emerald/slate text to distinguish waiting/actionable/passed/closed.
- Student reference words are hidden during solving and opened from the toolbar `힌트` button, up to three times per attempt. A non-modal popup shows only remaining words for five seconds, with a 32px red countdown ring and seconds above the word list. Close on timeout, Escape, outside click or explicit close; preserve the consumed count in the existing attempt draft. Use a 384px maximum popup width, 12px padding and a scrollable word list capped at 40dvh. Teacher read-only reference lists remain available.
- Teacher reset buttons retain a 44px transparent touch target but use a compact 28px-high visible border/background, 8px horizontal inset and existing blue styling.
- Student history results use one compact dialog (32rem maximum width): status title, one `N/M문제` score line (30px correct count, 16px total), a 14px percent/pass-threshold line, and missing or incorrect answers as one comma-separated 16px text block with 28px line height and natural wrapping. Do not show per-question cards, input values, blank IDs or repeated numeric-summary cards. Keep existing 44px close/confirm controls and submission data unchanged.
- History answer feedback uses a 72px screen-space canvas, 60px white badge and approximately 44px bold blue O/red X, counter-scaled against document zoom. Correct answers pop for 420ms with a 480ms expanding ring and eight 550ms sparks; incorrect answers shake for 340ms (4px, 5deg) with a 340ms impact ring. Keep the total feedback lifetime at 1200ms, pointer-events disabled and z-index 15 below the focused input. Reduced motion retains the static symbol and hides rings/sparks. This supersedes the earlier small 160ms feedback entrance.
- Teacher result/preview documents use a definite viewport height derived from the modal scroll container, independent of the scaled image height. Put reference words below the full-width document. Never measure fit against an auto-height container containing that same transformed image. Remove permanent guidance cards; student exit cautions are available only from an `i` button in the toolbar, dismissed by Escape, blur or an outside click. Read-only teacher previews have no student-exit caution.
- Teacher participation summaries use one compact row per student with separate 학년, 반, 번호, 이름 headers, score/status and a short `리셋` action. Selecting a student row expands its submission history beneath it; resetting never toggles the row. Keep narrow screens in the same table with horizontal scrolling when necessary.

- History classroom blank masks use a 2px page-coordinate corner radius and an opaque white surface; retain the outer orange focus indicator without a second input outline. On leaving a nonempty editable blank, show a blue circle for correct or red X for incorrect for 1200ms, with a 160ms opacity/scale entrance and no animation under reduced motion. Never show correctness while typing or composing Korean. The compact top bar always shows `전체 N개 중 M개 작성`, including mobile, and replaces the thin time bar with a 32px red circular remaining-time indicator beside the numeric timer.
- Teacher history classroom management combines participation and results in one student summary list with expandable submission history. Offer a per-student `리셋` action for incomplete attempts, including students without a saved result; preserve passed results and submission history. Reuse the existing retry-reset marker and show save progress, success and recoverable failure in the same area. Student waiting screens refresh that marker without interrupting an active attempt.

- History classroom keeps the existing map source and adds lesson materials grouped in the teacher's curriculum order. Each assignment preserves one selected curriculum item's title, full path, pages and authored blanks.
- Worksheet blanks in teacher editing/presentation, student materials and history classroom preserve their saved page-relative bounds at every zoom level. Do not expand their masks to meet a screen-pixel minimum. Fit answer text inside the blank by measuring its available area and complete text; use a native input of at least 16px internally and scale its visual contents to avoid tablet focus zoom. Keep zoom and page controls at least 44px; small blanks remain part of the zoomable document.
- Reuse existing neutral surfaces, primary controls, font family and 8/12/16px spacing. Keep curriculum paths wrapped and reference words within the available width. No new palette or decorative motion.
- History classroom combines its title, remaining time, answered count, page/zoom controls and submission into one compact two-row sticky bar at viewport top. Keep this bar outside the document transform so scrolling, panning and zooming only resize the worksheet/map. Use full available width and move reference words below the document to maximize solving space. Keep status messages inline and remove floating submission panels on every pointer type. Size the worksheet viewport from the visual viewport height minus its measured toolbar and existing 32px gutter, bounded by 160–1000px, so tablet keyboards leave a scrollable document area. Keep one reference-word list. Use existing 44px controls and a visible text label with time warnings.
- New history classroom assignments default to 10 minutes, a 5-minute retry wait, 90% passing, and grade 3 / class 2. Lesson source selection uses three linked dropdowns (대목차, 중목차, 소목차), preserving curriculum node IDs/order. Assignment reasons use the five requested choices; only 기타 reveals a required text field. Reuse existing form tokens and preserve previously saved free-text reasons.

Teacher menu names and lesson tree labels stay on one line. Long labels use ellipsis with the full title available on hover. Lesson add, rename and delete controls remain on the same row as their item, including narrow screens.

### Weplay naval typing battle

- Compact battle framing caps the brush title at112px, puts the mode row at48px and the enemy health row at68px. Keep these rows separate when a guide or virtual keyboard makes the battlefield short.

- Immediate combat and complete HUD art (2026-10-07): locally valid visible words update the visual ammo/shot state in the same interaction; only server-confirmed answers determine settlement. Reconcile rejects/errors without duplicate shots or sounds. Keep the complete title brush lettering with its lower strokes and replace the clipped cannon/gauge collage with a native segmented ammo control using existing ink/gold/parchment, 8px padding and 12px labels. Compute a normal shot's origin from the rendered turtle-ship mouth, including object-fit, bob/recoil and portrait layout, and its endpoint from the enemy hull; retain the 420ms travel and bounded 64px muzzle flash. Word, cannon and special effects use quiet original layered wood/metal, low cannon body and staggered battle impacts with the existing sound toggle; no extra controls or automatic playback before a gesture.

- Lobby refinement (2026-10-07): mode switching keeps the launch panel and start control in place. Move duration, automatic firing, challenge limits, payouts and exit terms into the game guide; keep the actual start cost and actionable blocking state at launch. Use the existing 4:3 ship art, with a 240ms darker sea treatment and inset gold frame only on the art for challenge. Emphasize the challenge choice with a straight double rectangular gold frame; use no layout animation. Record actions become sea-colored pill badges with 24px icon medallions, distinct from the rectangular guide/music controls. The Wis coin reads `Ws`; music uses an icon-only 44px square with accessible label and tooltip. Guide rules use an accessible disclosure, existing naval colors and 8/12/16/24px spacing. Result screens expose a separate `게임 메인으로` action. All normal and special prompts come exclusively from teacher-authored blank answers, never OCR/body text or invented fallback words.
- Normal cannon visibility: synchronize the local combat clock on accepted server responses, then show a 64px muzzle flash from the existing explosion raster and a 32px cannonball with a 4px gold glow along the existing 420ms path. Keep server-approved hit counts and existing reduced-motion behavior.

- Guided practice and special attack revision (2026-10-07): replace the passive six-step walkthrough with three local, untimed actions in the real arena: enter `거북선`, enter `이순신` to fire the automatic cannon, then enter `천상열차분야지도` to trigger a special. A concise coach card names the current action, strong gold spotlight links the visible word to the actual input/44px submit control, and surrounding battle details dim. Give immediate error/success feedback and a final completion state; preserve account-scoped completion/retry and keep the demo isolated from gameplay RPCs, Wis and records. Use existing ink/sea/gold/parchment palette and 8/12/16/24px spacing. On small screens/virtual keyboard, keep the current word, input and coach visible inside a single dialog scroll area with focus containment.
- Special attack motion: use a 500ms eye cut-in followed by ten crossing, curved cannon trails from the flanks (480–1400ms), five localized enemy-hull impacts and water splashes (1040–2420ms), total 2500ms. Reuse raster hulls/eyes/explosions and existing gold/parchment/enemy/text colors; SVG paths may animate the projectiles only. Keep effects at z-index 4 below HUD/prompts/input and pointer-transparent, with no fullscreen strobing. Display HP/ship sinking only from accepted battle results, align actual impact/sinking to the attack timeline, and keep reduced motion as static tactic/hit feedback. Pause visual motion when hidden/offscreen.
- Game music: provide an original 6/8 historical-drama-inspired instrumental loop using synthesized plucked strings, airy flute, low strings and restrained drums. Start only following user interaction, keep a modest fixed playback volume, and place a labeled 44px sound on/off control at the top right. Remember only the sound preference locally. Pause on hidden document and when the game page unmounts; guide and teacher previews must not start duplicate players. An unavailable/blocked player offers an explicit retry control and never blocks gameplay.
- Special projectile strokes use layered 16px glow, 8px fire, 3px core and 10px head, with a 4px gold head glow; use an enemy-red outer edge, gold flame and bright center so the shots read as burning cannonballs.

- Lobby records revision (2026-10-07): keep the existing turtle-ship launch art and two mode choices. Put the Wis balance in a compact parchment badge with a 24px coin mark, 14px label and 20px tabular amount. Separate 44px `우리 반 랭킹` and `내 기록` actions open native modal dialogs; hide both record sections on initial entry. Dialogs use a maximum 768px width, 16px viewport gutter, 24px padding (16px on mobile), 12px corners, one vertical scroll container and explicit close/focus restoration. Reuse naval ink #171e24, sea #163c4e, gold #d8ae66, parchment #f4e5c5, allied #8ac4b7 and white-ink #fff8e8. Ranking follows the Hall of Fame's 2–1–3 layout with a sea backdrop, anchor pennants and solid stepped podiums of 96/128/80px (72/96/64px mobile); use 24px rank numerals, 16px names/scores (14px mobile), 12–24px gaps and no looping motion. Keep empty places visible without inventing students, wrap long labels, and distinguish the current student by text. Place period/reward values with the ranking; keep tie rules in existing optional-help behavior. The lobby always uses the full configured word pool and offers no student lesson selector. Guide launch uses a 20px outlined SVG information mark with internal spacing instead of a text glyph pressed against a circle.

- Weplay's user-facing game is **내가 충무공이라고?!**; preserve the stable history-rain data/route identifier and existing lesson word management. The reference artwork supplied by the teacher governs the game arena: realistic raster ships and commander, blue coastal sea, ink title and parchment controls. No SVG substitutes for artwork. Lobby and teacher management retain existing educational UI surfaces. Minimum/default play duration is 90 seconds (maximum 180); three equal phases accelerate normal word response and enemy attacks. Difficulties load a cannon after 2/3/4 accepted normal words. New battles have 60 normal prompts per 90 seconds (scaled to configured duration) and two 5-second long-word tactics; normal typing completion is normalized to the existing 20-point reward scale, and special hits add combat score without increasing Wis payout directly. Preserve old session settlement and isolate new ranking periods by battle version.
- Naval arena tokens: ink #171e24, parchment #f4e5c5, gold #d8ae66, wood #5b3927, sea #163c4e, enemy #ba4236, allied #8ac4b7, text #fff8e8. Reuse 4/8/12/16/24px spacing, 8/12px radii, 16px inputs, 44px controls. Show player/enemy HP as labeled numeric bars, ammo 2/3/4 segments, score, remaining seconds and phase in a compact HUD. Word prompts remain readable over raster water columns with remaining time; tactics have their own session-defined timer (5 seconds for new games). Desktop presents opposing ships across a wide scene, mobile keeps input reachable and words readable without outer horizontal scrolling. Use the provided sprite sheet for title/commander/cannon/water and generated WebP sea/ship/explosion layers. Bounded effects: hull bob 3.8/4.5s, cannon travel 420ms, explosion 700ms, sinking 1100ms. Animate transforms/opacity; keep particle/effect count bounded. Reduced motion disables bob/shake/flash/projectiles but retains health/timer/status changes. Combat effects and clocks are local; only validated answer submissions and final settlement call the server.
- Naval special effects use up to three additional raster fleet ships and staggered projectiles/impacts for crane-wing and last-stand tactics; water splash sprites accompany sinking. Keep each effect below 2 seconds and disable motion effects with reduced motion. At visual viewport height below 540px with at least 120px keyboard shrink, use a compact keyboard layout and recover the focused input and active words into the visible viewport; retain 16px mobile word text.
- Naval battlefield revision: place the enemy flagship HP at the upper battlefield edge and allied fleet HP above the lower command area, with explicit labels, numeric values, gold/wood frames, red versus teal segmented fills and distinct crest ornaments. Show a fleet with at least six enemy vessels and three allied vessels in layered perspective; keep the current target visually distinct and decorative reinforcements outside the accessibility tree. Normal words emerge from raster water-column sprites over the central sea, using a short 600ms rise and 800ms splash rather than rectangular cards; keep 16px minimum word text, stable three-lane reading positions, explicit remaining seconds and reduced-motion static alternatives. Desktop command input is about half its previous width (maximum 520px) and centered alongside the ammo gauge. Put the firing rule, motion control and play-mode/financial note inside the battlefield, with 44px controls. Mobile at 600px container width and below uses a portrait composition: enemy HP/fleet above, three readable water-word lanes in the middle, allied fleet/HP and thumb-reachable input below; input fills the narrow available width. Adapt compact keyboard layout to keep the input and active words visible without overlap; retain score, timer, HP, controls and error recovery. Reuse the current raster assets and existing palette; no new rendering engine or combat/server changes.
- Naval combat feedback revision: effects start enabled, with an optional explicit in-game reduced-motion control; this user-requested default overrides OS motion preference only inside the arena. Synchronize word and raster water-column emergence over 800ms. Cannon arrival triggers a 600ms hull recoil and damage label; accumulated damage triggers the existing 1100ms sinking before reinforcement. Enemy arrival also recoils the allied hull and HP frame. Keep all effects local and bounded. At the very top, add a gold rope fuse with three equal labeled phase segments, a moving ember and numeric time; retain a clear selected-difficulty badge. Use existing naval palette, 4/8/12/16/24px spacing and raster art. Results reuse sea backdrop, ink heading, gold frame and parchment inset, with score, battle outcome, cannon/special/sunk totals, missed-word disclosure and the existing mode-specific Wis receipt. Responsive result metrics use two columns below 600px and four above; actions remain at least 44px. No new server requests for visuals.
- Naval launch and exit revision: the student lobby uses two labeled mode choices with an explicit selected mark, practice `위스 변동 없음` versus challenge `위스 획득·차감`, and a matching mode heading/start label. Reuse naval sea/ink/gold/parchment/allied colors with 4/8/12/16/24px spacing; keep other student page surfaces unchanged. Lobby art is a separate original raster illustration informed by Imjin-era records and the Navy Academy's 2022 reconstruction: wooden covered hull, spikes, low straight dragon prow, oars and cannon ports. Avoid iron-plated fantasy roofs and tall dragon necks; document sources and artistic interpretation in ASSETS.md. Keep the whole ship visible in a 4:3 art area, then stack above controls below 768px. Start buttons use a 240ms elevation/glow transition and a subtle 1600ms gold shimmer on enabled hover/keyboard focus; stop motion under prefers-reduced-motion. The shared arena adds a 44px exit action and a focus-contained, Escape-dismissible ink/gold confirmation dialog. The clock continues while deciding; confirm waits for pending answers then settles once at current server time. Show no-refund/current-record terms for challenge and no Wis/record changes for teacher preview. Early-exit results say `전투 종료` rather than victory. Preserve mobile keyboard layout and provide recovery after settlement errors.
- Naval emphasis and first-use guide: the shared student/teacher-preview battlefield uses a restrained ink/sea base with desaturated background and secondary fleet layers. Consolidate score/combo/time into a single quiet HUD strip; simplify gold HP ornamentation while preserving enemy-above/allied-below labels and numbers. Normal words and the input remain the main reading targets. Reserve bright gold, white ink speed lines and strong contrast for accepted cannon impacts and successful specials. Successful special cut-in uses an original raster close-up of Yi Sun-sin's intense eyes plus transparent comic speed lines for at most 1400ms; one overlay at a time, no looping flash, no input interception, no cover during the timed special prompt. Reduced motion keeps static outcome text and disables cut-in/sea travel. Existing sea raster moves only through a compositor transform over 16s at about 1% amplitude; pause while document is hidden. No animation-related server requests or video downloads.
- The Weplay introduction is an account-scoped, once-only guided walkthrough, using the actual arena in a frozen, non-networked demo inside an accessible modal. Six short steps highlight time/difficulty, words, input, charge, special and health using existing 4/8/12/16/24px spacing, 12px radius, gold focus outline, ink surfaces and 16px body text. Desktop guide width is at most 960px; mobile uses a 340–380px compact arena followed by a short step card and 44px previous/next/skip controls, scrolling within the dynamic viewport when needed. No account name or balance is needed in the demo. Auto-open only when the current account profile is resolved and no game/result is active. Completing or skipping records completion via a UID-checked idempotent server write; use existing profile subscription to avoid a new read/poll. Manual help replays without rewriting completion. Saving failure has retry and an explicit close-for-now option. Reopening during a live game is manual and clearly says its clock continues; automatic introduction never consumes a paid session. Keep gameplay/Wis rules unchanged.
- Teacher Weplay policy reuses the existing policy submenu, form rows, numeric controls and save feedback. Each difficulty has separate class rankings and first/second/third rewards. The cost, result payouts and daily attempt limit are shared across difficulties. Financial cost, maximum loss/return and rule effective dates remain visible because they affect participation and saving decisions.

- Teacher game management uses the existing adjoining `teacher-sub-workspace--page` navigation, with one registered game per menu item and the existing `teacher-sub-content` gutters. Keep student availability and lesson-source selection in game management; link to the existing Wis policy for money settings. Consolidate words into one initially collapsed `단어 모음` disclosure with counts in its summary. Inside, use compact source checkboxes, search, deduplicated word inclusion rows and manual word addition/removal; show public/private source metadata without repeating lesson-sized panels. Reuse 8/12/16/24px spacing, neutral borders, 12px section radius, 44px controls and responsive single-column flow. Difficulty settings use a comparison table with three difficulty rows and shared headers for total time, three word response windows and word-length range. Keep the 640px-minimum table in a local horizontal scroll region on narrow screens, with sticky row labels, 44px inputs and per-difficulty errors; retain empty numeric drafts. Align availability and word counts in one wrapping toolbar and preview selection/start in another, avoiding unnecessary full-width rows. Preview uses the unsaved word and difficulty settings, permits private lesson sources only after server permission checks, and has an explicit preview label and exit action. Preview writes no Wis, ranking or student records.
- Wis policy puts its submenu directly alongside the global navigation, like map/settings management. Place the heading, save status/actions and global switches inside its right-hand content column; retain the standard mobile submenu disclosure.

### Student weekly dashboard and shared submenus

- The student dashboard uses the teacher weekly schedule pattern: seven-day strip, previous/next week, current week, selected-day event list, search and full-calendar access. Keep student attendance and class-visible schedule data; omit teacher editing and class-management controls.
- Student lesson contents, think cloud, maps, My Page and score lists use the same settings submenu through `PortalSubNavigation`, including the 228px desktop/208px tablet rail, flat surfaces, 44px rows and mobile disclosure below 768px. Preserve student-only items, selection, public-content filtering and learning actions. The original teacher component remains a compatibility export of the shared component and uses the unchanged shared stylesheet.

- Teacher submenu width: 288px desktop / 256px tablet (768–1023px); lesson curriculum: 360px / 320px. Below 768px retain full-width disclosure. Truncated teacher menu labels expose full names with native title tooltips. Student submenu dimensions stay unchanged.

- Student weekly schedule keeps date, title, category and period on one row at every viewport, including reduced-motion mode. Reduced motion uses static single-line ellipsis instead of title animation or wrapping.

- Teacher submenu lists have 16px horizontal padding inside the navigation panel; lesson rows retain their 8px padding so top-level icons start 24px from the panel edge. Keep the original adjoining global/submenu panels and original content padding. Use 256px desktop / 240px tablet menus and 288px desktop / 256px tablet lesson contents. Preserve mobile disclosure and student dimensions.

- Student submenus now match these teacher dimensions: 256px desktop / 240px tablet, with lesson contents at 288px / 256px. Apply the same 16px horizontal padding inside submenu lists, preserving adjoining panels, student actions and full-width mobile disclosure.
- Student performance scores use the full-page PortalWorkspace: the assessment list adjoins the global sidebar, with the page heading and score details in the right content area. Assessment labels wrap to at most two lines with the full title available on hover, and separate rows retain a subtle bottom border. Reuse student submenu widths and mobile disclosure. The performance-score consent action is centered, full width up to 384px, at least 56px high, and uses bold 18px text; existing primary colors and focus treatment remain unchanged. Written-exam score layout is unchanged.

- Teacher lesson tree titles show an immediate, wrapped full-title tooltip on hover or keyboard focus, dismissed on mouse leave, blur or Escape. Use existing surface, border, small text, 8px padding/radius tokens; do not change row width. Leaf lessons expose only delete; rename remains on parent units and leaf titles are edited in the existing editor.

- Teacher lesson contents width is now 320px desktop / 288px tablet. Only actually ellipsized labels show the full-title tooltip; measure their rendered width and update on resize. On desktop fine-pointer devices, hide row actions and release their width until that row is hovered or contains keyboard focus. On mobile/tablet or touch devices, always show the permitted actions on each row. Leaf rows retain delete only; keep other menus and student dimensions unchanged.

- Student lesson contents now match the 320px desktop / 288px tablet width. Inside the existing 16px list gutter, use 8px row padding and a 6px icon gap, matching teacher tree rows. On student lesson pages with save controls, place the dictionary launcher 12px above the measured save-control box and align their right edges; remeasure when controls resize or the viewport changes. Other pages retain their existing launcher position.

- Student map categories expand their map items directly beneath them in the existing submenu (16px indent, 8px inner spacing). Replace the horizontal map tabs and category badge with a compact selected-map heading (16px padding); reduce the outer viewer gutter to 8px to give maps more space. Category selection keeps the mobile menu open for choosing a map; item selection closes it. Keep existing viewer, zoom, tags and reward behavior.

### Student attendance stamp

- Reuse one transparent red raster stamp reading 출석 for confirmed attendance only. Reserve a 36×24px stamp slot above each weekday in the student weekly strip; retain date buttons and their existing event markers. Full calendar month cells show the same 36×24px stamp beside the day number, fitting within narrow cells without horizontal overflow. Use existing danger-text ink and spacing tokens; no stamp animation or teacher UI changes. Attendance data remains scoped to the signed-in student and semester, with visible read/save errors and retry.

### Student full calendar alignment
- Student full calendar reuses the teacher calendar shell, 1536px page width, 16px/24px gutters, and `max(600px, 100dvh - 176px)` canvas. Keep student actions read-only.
- Reuse the teacher left-aligned numeric date header and 24px event labels. The attendance stamp stays beside the date in one non-wrapping row; mobile stamps scale from 16px to 24px wide to fit seven equal columns.
