# 위스토리 TWA APK 제작 가이드

이 문서는 Vite React 웹앱 `https://westory.kr`을 경기도교육청 스마트단말 관리시스템에 올릴 In House APK로 만드는 절차입니다. Play Store 등록은 하지 않습니다.

## 기본 설정

- 앱 이름: 위스토리
- 앱 표시 이름: 위스토리
- 웹앱 주소: `https://westory.kr`
- 실제 TWA 신뢰 대상 host: `www.westory.kr`
- Web Manifest: `https://westory.kr/manifest.webmanifest`
- 시작 URL: `/`
- 표시 방식: `standalone`
- 임시 Android 패키지명: `kr.westory.app`

현재 `https://westory.kr`는 `https://www.westory.kr`로 리다이렉트됩니다. Android Digital Asset Links 검증은 리다이렉트를 허용하지 않으므로, APK의 TWA host는 `www.westory.kr` 기준으로 빌드합니다. 사용자는 계속 `https://westory.kr`로 접속해도 되지만, APK 재빌드 시 `twa-manifest.json`의 `host`는 `www.westory.kr`로 유지하세요.

패키지명은 나중에 확정 명칭으로 바꿀 수 있습니다. Bubblewrap 프로젝트 생성 후 `twa-manifest.json`의 `packageId` 값을 수정하고 `bubblewrap update`를 실행하면 됩니다.

```jsonc
{
  // TODO: 기관 배포용 최종 패키지명이 확정되면 kr.westory.app을 변경하세요.
  "packageId": "kr.westory.app"
}
```

## 1. 웹앱 먼저 배포하기

TWA는 웹앱을 Android 앱 껍데기 안에서 여는 방식입니다. APK를 만들기 전에 `https://westory.kr/manifest.webmanifest`와 `https://westory.kr/.well-known/assetlinks.json`가 실제 배포 주소에서 열려야 합니다.

현재 저장소에는 다음 파일이 준비되어 있습니다.

- `public/manifest.webmanifest`
- `public/.well-known/assetlinks.json`
- `public/icons/westory-icon-192.png`
- `public/icons/westory-icon-512.png`

웹 기능을 수정한 경우에는 서버에 웹앱만 다시 배포하면 학생과 교사 화면에 반영됩니다. APK를 다시 만들 필요는 없습니다. 앱 이름, 아이콘, 패키지명, 시작 URL, 서명 키처럼 앱 껍데기 자체가 바뀌는 경우에만 APK를 다시 빌드합니다.

## 2. Bubblewrap 설치

PC에 Node.js와 npm이 설치되어 있어야 합니다. 터미널에서 다음 명령을 실행합니다.

```powershell
npm i -g @bubblewrap/cli
bubblewrap doctor
```

처음 실행할 때 Android SDK나 JDK 설치를 묻는다면 Bubblewrap이 안내하는 기본 설치를 따라 진행하세요.

## 3. TWA 프로젝트 생성

APK 작업용 폴더를 저장소 밖에 따로 만드는 것을 권장합니다. keystore와 비밀번호 파일이 실수로 git에 들어가는 일을 줄일 수 있습니다.

```powershell
mkdir C:\westory-twa
cd C:\westory-twa
bubblewrap init --manifest=https://westory.kr/manifest.webmanifest
```

질문이 나오면 다음 값을 기준으로 입력합니다.

- Application ID 또는 packageId: `kr.westory.app`
- Launcher name: `위스토리`
- App name: `위스토리`
- Host: `westory.kr`
- Start URL: `/`
- Display mode: `standalone`
- Icon URL: manifest에서 가져온 `512x512` 아이콘 사용

서명 키를 새로 만들 때 입력한 keystore 비밀번호와 key 비밀번호는 분실하면 안 됩니다. 같은 앱을 업데이트하려면 같은 keystore로 다시 서명해야 합니다.

## 4. APK 빌드

TWA 프로젝트 폴더에서 다음 명령을 실행합니다.

```powershell
bubblewrap build
```

빌드가 끝나면 일반적으로 `app-release-signed.apk`가 생성됩니다. 스마트단말 관리시스템에는 이 APK 파일을 업로드합니다. Play Store용 AAB 파일이 함께 만들어져도 이번 목적에서는 사용하지 않습니다.

현재 로컬 작업에서는 `C:\westory-twa\app-release-signed.apk`가 생성되도록 구성했습니다.

만약 Bubblewrap의 PWA 검증이 서비스 워커나 오프라인 조건 때문에 막힌다면, 인증과 Firebase 데이터 흐름에 영향을 줄 수 있으므로 서비스 워커를 급하게 추가하지 마세요. In House APK 테스트 목적이라면 먼저 아래 명령으로 APK 생성 가능 여부를 확인하고, 별도 작업으로 안전한 캐싱 전략을 검토하는 편이 안정적입니다.

```powershell
bubblewrap build --skipPwaValidation
```

## 5. SHA-256 지문 확인

TWA가 주소창 없이 정상적으로 열리려면 웹사이트의 `assetlinks.json`에 APK 서명 인증서의 SHA-256 지문이 들어가야 합니다.

Bubblewrap 프로젝트 폴더에서 다음 명령 중 하나로 확인합니다.

```powershell
bubblewrap fingerprint list
```

또는 keystore를 직접 확인합니다.

```powershell
keytool -list -v -keystore C:\westory-twa\secrets\westory-release.keystore -alias westory
```

alias가 `westory`가 아니라면 Bubblewrap 생성 과정에서 사용한 alias로 바꿔 실행하세요. 출력의 `SHA256:` 값을 복사합니다.

## 6. assetlinks.json 수정 후 웹 재배포

`public/.well-known/assetlinks.json`에는 현재 생성한 APK 서명 키의 SHA-256 값이 반영되어 있습니다.

```json
"sha256_cert_fingerprints": [
  "F0:B6:CE:01:1E:EA:BE:EE:9B:81:9F:2E:D6:4B:8D:46:18:05:87:E0:B1:DB:98:8B:E2:DF:A2:2D:6D:A6:F9:17"
]
```

나중에 keystore를 새로 만들면 SHA-256이 달라지므로 이 값을 다시 확인해 교체해야 합니다. 같은 패키지명으로 업데이트하려면 가능하면 기존 `C:\westory-twa\secrets\westory-release.keystore`를 계속 사용하세요.

그 다음 웹앱을 다시 배포하고 아래 주소가 브라우저에서 열리는지 확인합니다.

- `https://www.westory.kr/.well-known/assetlinks.json`
- `https://www.westory.kr/manifest.webmanifest`

이 단계가 빠지면 APK가 설치되어도 TWA가 완전한 앱 화면이 아니라 브라우저 UI가 붙은 Custom Tab처럼 보일 수 있습니다.

## 7. 스마트단말 관리시스템 업로드

경기도교육청 스마트단말 관리시스템에서 신규 앱을 추가할 때 다음처럼 등록합니다.

- OS: Android
- 배포 방식: 관리자용 또는 In House
- 공개 설정: 학교 운영 정책에 맞게 선택
- 앱 이름: 위스토리
- 설치 파일: `app-release-signed.apk`

업로드 전 실제 Android 단말에 APK를 설치해 로그인, 교사 화면, 학생 화면, PDF/학습지 등 주요 흐름을 확인하는 것을 권장합니다.

## 8. 다시 APK를 올릴 때 주의할 점

스마트단말 관리시스템에 같은 패키지명으로 새 APK를 다시 올릴 때는 Android `versionCode`가 이전 APK보다 반드시 커야 합니다. Bubblewrap에서는 `twa-manifest.json`의 `appVersionCode`를 올린 뒤 다음 명령을 실행합니다.

```powershell
bubblewrap update
bubblewrap build
```

예를 들어 기존 `appVersionCode`가 `1`이면 다음 배포에서는 `2` 이상으로 올려야 합니다. 앱 표시 버전은 `appVersionName`으로 관리할 수 있습니다.

## 9. git에 넣으면 안 되는 파일

keystore와 비밀번호 파일은 앱 업데이트 권한과 직결되므로 절대 git에 커밋하지 않습니다. 이 저장소의 `.gitignore`에는 TWA 서명 관련 파일 패턴이 추가되어 있습니다.

- `android.keystore`
- `*.jks`
- `*.keystore`
- `*.p12`
- `*.storepass`
- `*.keypass`
- `keystore.properties`
- `signing.properties`
- `twa-keystore-password.txt`
- `twa-key-password.txt`

keystore는 별도 보안 저장소에 백업하고, 담당자가 바뀔 때 인수인계 항목에 포함하세요.
