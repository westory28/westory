# 덩기덕 쿵더락 무료 한글 글꼴 검토

- 확인일: 2026-11-15
- 작업 checkout: `C:\westory-rhythm-20261115`
- 시작 HEAD: `16c308bc5b5d4614b38da7ce07ca0d36143fd271`
- 범위: `src/assets/fonts/rhythm/*`와 이 문서. 게임 CSS·로직은 수정하지 않았다.

## 선택

| 역할 | 선택 | 이유 및 크기 권장 |
| --- | --- | --- |
| 판정 “지화자 좋다!”, “얼씨구”, “좋다” | Dokdo Regular | 굵고 불규칙한 붓 획이 타이틀과 어울린다. 실제 브라우저에서 48·64px 표본이 선명했다. 긴 안내문에는 사용하지 않는다. |
| 음악·난이도·점수·버튼 등 게임 UI | Yeon Sung Regular | 손글씨 성격을 유지하면서 짧은 한글 문구와 숫자를 읽기 쉽다. 일반 UI 18px 이상을 권장하며 16px은 짧은 보조 라벨 정도가 적절하다. |

둘 다 normal / 400 단일 굵기다. 굵기 합성보다 원래 획을 유지하는 편이 좋다. 향후 원본에 없는 드문 글자에는 `Batang`, `AppleMyungjo`, `serif` 같은 명조 계열 대체 글꼴을 둘 수 있다.

## 공식 라이선스 확인

- [Google Fonts Dokdo OFL 원문](https://raw.githubusercontent.com/google/fonts/main/ofl/dokdo/OFL.txt): FONTRIX 저작권 표시와 SIL Open Font License 1.1을 확인했다.
- [Google Fonts Yeon Sung OFL 원문](https://raw.githubusercontent.com/google/fonts/main/ofl/yeonsung/OFL.txt): BM YEONSUNG Project Authors 저작권 표시와 SIL Open Font License 1.1을 확인했다.
- [OFL 공식 FAQ](https://openfontlicense.org/ofl-faq/), 2.1: CSS `@font-face` 및 사이트와 같은 서버의 자체 호스팅을 허용한다. 2.2~2.2.1은 원본 폰트 데이터를 보존하는 WOFF/WOFF2 압축 조건을 설명한다.
- 두 원본 OFL의 저작권 줄 아래에는 별도 Reserved Font Name 지정이 없다.
- 글꼴 파일만 별도로 판매하지 않고, 글꼴과 함께 저작권·OFL을 보존하며, 글꼴은 OFL로 유지한다. 이 조건은 앱 코드 전체에 OFL을 적용한다는 뜻이 아니다.

라이선스 원문 두 개를 그대로 보존했다. 배포되는 WOFF2 자체에도 전체 라이선스와 저작권을 WOFF2 XML 메타데이터로 넣어, 원래의 이름·저작권·라이선스 레코드를 유지하면서 전문을 확인할 수 있게 했다.

## 납품 파일과 용량

경로: `src/assets/fonts/rhythm/`

| 파일 | 크기 |
| --- | --- |
| Dokdo-Regular.woff2 | 408,449바이트 |
| YeonSung-Regular.woff2 | 544,348바이트 |
| OFL-Dokdo.txt | 4,357바이트 |
| OFL-YeonSung.txt | 4,350바이트 |
| SOURCE.md | 고정 원본 링크·버전·해시·범위 기록 |

WOFF2 합계는 **952,797바이트**로 1MB(1,000,000바이트) 미만이다. 라이선스 두 파일까지 합치면 961,504바이트다.

공식 Google Fonts 저장소의 `cc39c4c2c304bc368c9b7c311ea2bcc6013299fe` 커밋에서 내려받았다. [고정 Dokdo 원본](https://github.com/google/fonts/blob/cc39c4c2c304bc368c9b7c311ea2bcc6013299fe/ofl/dokdo/Dokdo-Regular.ttf), [고정 Yeon Sung 원본](https://github.com/google/fonts/blob/cc39c4c2c304bc368c9b7c311ea2bcc6013299fe/ofl/yeonsung/YeonSung-Regular.ttf).

## 변환과 글자 검사

- FontTools 4.68.0 / Brotli 1.2.1로 원본 TTF 전체를 WOFF2로 압축했다. 글리프 서브셋이나 윤곽선·폭·이름 수정을 하지 않았다.
- 원본 TTF와 최종 WOFF2의 모든 글리프 그리기 명령, cmap, 가로 메트릭, name 테이블 바이트가 같음을 확인했다.
- 원본 글리프 수: Dokdo 2,600개, Yeon Sung 3,120개.
- 한글 완성형 지원 수: Dokdo 2,350자, Yeon Sung 2,436자. 원본 전체를 담았지만 **한글 완성형 11,172자 전체 지원 글꼴은 아니다**.
- 현재 `rhythm/*.tsx`의 서로 다른 한글 182자 모두 두 글꼴에 있다.
- 별도 표본 “지화자 좋다!”, “얼씨구”, “좋다”, “덩기덕 쿵더락”, “아리랑”, “얼쑤, 달려라”, “풍년 마당”, “우리의 산하”, “난이도”, “쉬움 보통 어려움”, “최고 점수 0123456789”, “정확도 98.5%”, “잠시 멈춤”, “계속하기”, “다시 시작”, “나가기”에 누락 글리프가 없었다.

## 실제 렌더링 검증

Chromium에서 실제 WOFF2를 읽어 1040 × 690 화면으로 렌더링했다. 이미지 생성 도구나 글자 그림 대체를 사용하지 않았다.

- `document.fonts.check`로 두 글꼴 loaded를 확인했다.
- Dokdo 64px·48px 판정, Yeon Sung 26px·20px·16px UI 표본을 육안 확인했다.
- 한글 자모·받침과 숫자·소수점·느낌표가 구별됐고 글자 누락이나 사각 대체 문자가 없었다.
- 표본 렌더링의 외부 HTTP 요청은 0건이었다. 실제 앱에도 외부 Google Fonts CSS/도메인 호출을 추가하지 않는 로컬 파일 방식으로 통합하도록 전달했다.
- 검증 스크린샷: `%TEMP%/westory-rhythm-font-source/rhythm-font-preview.png`. 이 임시 검증본은 실행용 자산이 아니다.
- 최종 앱의 모바일 크기·문구 줄바꿈·대비·CSS 적용은 통합 작업자가 별도로 확인한다.

## 런타임·개인정보

빌드에 포함할 정적 글꼴과 라이선스만 추가했다. Google Fonts 저장소 접근은 개발 시 공개 파일 다운로드에 한정됐고, 학생 데이터·로그인 정보·교과 자료를 외부로 보내지 않았다. AI 런타임 기능·권한·학생 공개 상태는 변경하지 않았다.

