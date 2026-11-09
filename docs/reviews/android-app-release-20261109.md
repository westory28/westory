# 위스토리 In House APK 재설치 배포

2026-11-09 요청은 스마트단말 관리시스템의 Android / 관리자용(In House) 등록 화면에 첨부할 APK다. 기존 앱을 삭제한 뒤 재설치하며, 현재 적용된 사용자 제공 We 로고를 사용한다.

## 산출물과 빌드

- 파일: `C:\westory-twa\release\westory-2026.11.09.apk`, 1,521,428 bytes.
- SHA-256: `b27665a48137fbbcd148e1efbb1ad930ff4ae5a70140ffee547269630d65b923`.
- 이름 `위스토리`, 패키지 `kr.westory.app`, 버전 `2026.11.09`, versionCode `20261109`.
- 최소 Android 7.0(API 24), target/compile SDK 36. 최신 Android Browser Helper 2.7.4의 최소 SDK 요구사항을 적용했다.
- Bubblewrap 1.27.0, Temurin JDK 17, Gradle 8.11.1, Android Gradle Plugin 8.9.1, Android Build Tools 36.1.0.
- 시작 URL `https://www.westory.kr/`, standalone, 세로·가로 회전 허용. 기존 `HashRouter` 진입을 그대로 사용한다.
- 일반·adaptive 아이콘은 운영 manifest의 `20261025` PNG를 사용한다. 기존 완성 로고를 다시 그리지 않는다.

프로젝트와 키는 저장소 밖 `C:\westory-twa`에 보관한다. 이번 PC에는 이전 키가 없으므로 새 키를 생성했으며 이전 APK 위에 업데이트할 수 없다. `secrets` 폴더의 키와 비밀번호는 현재 사용자·SYSTEM만 읽도록 제한하고 배포 파일·Git·로그에 포함하지 않는다. 이후 업데이트에는 이번 키를 보존한다.

## 검증

- `gradlew.bat --no-daemon assembleRelease` 성공.
- `apksigner verify --verbose --print-certs`의 APK 서명 v2·v3와 `zipalign -c -p 4` 통과.
- `aapt dump badging`으로 한글 앱 이름, 패키지, versionCode, 표시 버전, 최소/대상 SDK, 실행 activity를 확인했다.
- APK 내 시작 URL과 앱→웹 Digital Asset Links가 모두 `https://www.westory.kr` 기준임을 확인했다.
- ZIP 무결성 및 APK에 압축된 일반·maskable PNG를 생성 원본과 픽셀 단위로 비교해 일치를 확인했다. 두 아이콘을 직접 열어 We 로고를 확인했다.
- native 권한은 라이브러리 내부의 signature 수준 `DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION`뿐이다. 카메라·위치·연락처·파일 저장 권한과 알림 위임을 새로 요청하지 않는다.
- `npm run build` 통과: 타입·인증/세션·학기·점수 요청·XLSX hair 테두리·학습지·지도·사전·아바타·성취도 검사와 Vite 빌드 포함. 기존 큰 chunk 경고는 유지된다. 빌드된 Digital Asset Links와 원본 JSON도 일치한다.
- 연결된 Android 실기기는 없으므로 설치·TWA 주소창 숨김·로그인·PDF 실제 사용은 미검증이다. Chrome 확인은 컴퓨터 사용 도구가 현재 URL을 판별하지 못해 중단했으며 다른 UI 경로로 우회하지 않는다.

## 운영 반영 범위

웹 변경은 `public/.well-known/assetlinks.json`의 기존 패키지에 새 인증서 지문 하나를 추가하는 것이다. 기존 지문은 보존한다.

- 기존: `F0:B6:CE:01:1E:EA:BE:EE:9B:81:9F:2E:D6:4B:8D:46:18:05:87:E0:B1:DB:98:8B:E2:DF:A2:2D:6D:A6:F9:17`.
- 신규: `A4:FF:B3:A8:CB:F4:E5:5F:63:77:65:57:73:54:4E:5E:A1:B6:61:47:70:8F:0E:CF:E7:31:DE:00:5C:74:20:1D`.

기존 앱의 패키지·운영 도메인·사용자 역할·공개 범위와 데이터 저장 위치를 유지하는 앱 외형 재배포다. 서버 권한, 학기 경로, 로그인 세션, Firebase Functions/rules, AI 호출·에이전트 실행·외부 데이터 전송은 변경하지 않는다. 서비스 워커나 웹앱 오프라인 캐시를 추가하지 않는다.

웹 기본 검증은 `npm run build`다. 검증한 커밋을 Vercel main 배포로 올리고 Ready / 운영 도메인 연결을 확인한다. 배포 후 `https://www.westory.kr/.well-known/assetlinks.json`의 직접 HTTP 200(JSON, 리다이렉트 없음), 이전·신규 지문, Google Digital Asset Links 검증 결과를 확인한다. 최종 운영 결과는 저장소 밖 `C:\westory-twa\release\release-info.json`에 기록한다.
