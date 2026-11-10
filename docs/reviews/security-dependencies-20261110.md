# 의존성 보안 점검 — 2026-11-10

기준 커밋은 `41c393be22d8e3e2f9ebd3d8779ae43195b55b09`다. 원본 작업 폴더의 미커밋 변경을 보존하기 위해 별도 checkout에서 검사했다. npm registry 감사와 공식 upstream 보안 공지를 대조했으며, 아래 숫자는 **취약한 것으로 보고된 패키지 수**다. 독립적인 취약점 수나 실제 공격 가능한 경로 수가 아니다.

## 검사 결과

| 범위 | 시점 | Critical | High | Moderate | Low | 합계 |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| 루트 lock | 변경 전 | 1 | 9 | 8 | 1 | 19 |
| 루트 lock | 변경 후 | 0 | 5 | 2 | 0 | 7 |
| Functions lock | 변경 전·후 | 2 | 7 | 9 | 0 | 18 |

`npm audit --package-lock-only --ignore-scripts --json`으로 검사했다. 루트는 `npm audit fix --package-lock-only --ignore-scripts`로 기존 semver 허용 범위 안에서 갱신하고, XSS 차단 구현에 사용할 DOMPurify를 추가했다. `--force`, Firebase 다운그레이드, React·라우터 메이저 전환은 하지 않았다. Functions lock은 이 단계에서 변경하지 않았다. 원본 JSON은 로컬 `output/security-dependency-audit-20261110.json`에 보존했으며 배포 파일로 포함하지 않는다.

## 적용한 루트 패치

| 패키지 | 이전 | 적용 | 목적 |
| --- | --- | --- | --- |
| vite | 6.4.2 | 6.4.6 | 개발 서버 파일 접근·Windows 에디터 실행 경로 보안 수정 |
| react-router / react-router-dom | 6.30.3 | 6.30.6 | 6.x에 제공된 리다이렉트 보안 수정 |
| @remix-run/router | 1.23.2 | 1.23.4 | 같은 계열 라우터 수정 |
| @xmldom/xmldom | 0.9.10 | 0.9.12 | XML 처리 입력 검증·자원 소모 수정 |
| write-excel-file | 4.0.5 | 4.1.1 | 취약한 archiver-node 의존 경로 제거 |
| brace-expansion | 5.0.6 | 5.0.12 | 과도한 중괄호 확장·재귀·메모리 소모 수정 |
| protobufjs | 7.5.8 | 7.6.6 | 비정상 스키마·JSON 변환·파싱 자원 소모 수정 |
| websocket-driver | 0.7.4 | 0.7.5 | 프로토콜 길이와 압축 한도 처리 수정 |
| @grpc/grpc-js | 1.9.15 | 1.9.16 | 1.9.x에 제공된 비정상 메시지 처리 수정 |
| DOMPurify | 미사용 | 3.4.17, 정확 버전 | HTML 표시 경계의 XSS 차단 |

관련 Babel·PostCSS·브라우저 대상 데이터·nanoid·source-map-js도 기존 허용 범위에서 갱신했다. lock 기준 기존 패키지 38개가 갱신되고, 더 이상 필요하지 않은 36개가 제거됐으며 DOMPurify와 타입 패키지 2개가 추가됐다. Firebase 12.9.0, React 18.3.1, PDF.js 5.4.296은 유지했다. 의존성 수 감소를 실제 브라우저 전송량 감소로 간주하지 않는다.

Vite 공식 [2026-10-06 공지](https://github.com/vitejs/vite/security/advisories/GHSA-9jrq-w75r-8gcw)는 custom middleware 조건의 취약점을 설명하고 6.4.4 이상 수정을 명시한다. 위스토리는 기본 SPA이므로 그 특정 조건에는 해당하지 않지만 같은 릴리스 계열의 다른 개발 환경 보안 수정도 적용했다. DOMPurify는 [공식 릴리스](https://github.com/cure53/DOMPurify/releases/tag/3.4.17)와 [custom-element hook 보안 공지](https://github.com/cure53/DOMPurify/security/advisories/GHSA-c2j3-45gr-mqc4)를 확인했다.

## 루트의 남은 경고와 적용 조건

### gRPC 및 Firebase 전파 경고 — High 5개 패키지

`@grpc/grpc-js`의 서버 인증 컨텍스트 문제가 Firebase·Firestore 관련 패키지에 전파되어 집계된다. [공식 보안 공지](https://github.com/grpc/grpc-node/security/advisories/GHSA-m9gg-hp2v-232j)는 서버가 검증되지 않은 인증서를 `getAuthContext`의 결과로 인증에 사용하는 조건을 설명한다. 수정 계열은 1.13.6 및 1.14.5 이상이다.

현재 Firebase의 Node 의존 범위는 `~1.9.0`이다. 실제 프런트엔드가 사용하는 `@firebase/firestore`의 browser export는 `dist/index.esm.js`이며 Node gRPC 서버 코드와 다르다. 앱 소스에서 gRPC 서버나 `getAuthContext` 사용은 발견되지 않았다. 따라서 이번 프런트엔드 운영 경로의 해당 서버 인증 취약점으로 보지 않는다. npm이 제안하는 Firebase 9.14.0 다운그레이드는 서비스 호환성과 보안을 해칠 수 있어 적용하지 않았다. 추후 Node 서버에서 Firebase 클라이언트 SDK를 사용하거나 gRPC 서버를 추가하면 재평가한다.

### React Router — Moderate 2개 패키지

[SSR hydration 취약점 CVE-2026-53666](https://github.com/remix-run/react-router/security/advisories/GHSA-337j-9hxr-rhxg)는 공식 공지에서 Declarative Mode를 영향 대상에서 제외한다. 위스토리는 React 18의 `HashRouter`와 클라이언트 렌더링을 사용하므로 해당 SSR 조건이 없다.

[외부 경로 리다이렉트 CVE-2026-53669](https://github.com/remix-run/react-router/security/advisories/GHSA-wrjc-x8rr-h8h6)는 신뢰하지 않는 문자열을 navigation에 전달할 때 적용될 수 있다. 6.30.6에도 audit 경고가 남으며 완전한 패키지 수정은 7.18.0 이상이다. 이 점검에서는 메이저 업그레이드를 대신 수행하지 않고 앱의 링크·리다이렉트 입력 경로 검토 대상으로 분리했다. 라우터 패키지 경고가 모두 해소됐다고 보고하지 않는다.

추가로 지정된 두 진입 경로를 좁게 추적했다.

- `Login.tsx`의 `forceRoute(targetPath)`에는 `getDefaultTeacherRoute`가 반환하는 고정 내부 경로나 `/student/dashboard`만 전달된다. URL query·해시·사용자 입력을 로그인 후 이동 주소로 받아들이는 경로는 이 호출부에서 발견되지 않았다.
- `NotificationBell.tsx`의 `navigate(targetUrl)`은 저장된 알림 주소를 일부 정규화한 후 전달한다. `targetUrl` 자체의 URL allowlist는 없다. 다만 알림 문서의 클라이언트 직접 쓰기는 rules에서 금지하고, 서버 `createManagedNotifications`는 관리자·교사·위임 권한을 검사한다. 보통의 학생이 임의 알림 URL을 직접 기록하는 경로는 이 조사에서 확인되지 않았다.
- 현재 앱은 `HashRouter`다. 설치된 `@remix-run/router 1.23.4`의 `createHashHref`는 목적지를 `#` 뒤에 붙인다. 실제 설치 모듈을 합성 window에서 실행해 `//`, 역슬래시, 절대 HTTPS, `javascript:`, 인코딩 경로와 정상 내부 경로 등 8개 입력을 검사했으며 모두 동일 origin을 유지했다. 이 검사는 실제 운영 브라우저 검증이 아닌 로컬 history 구현 검사다.

따라서 조사한 로그인·알림 호출부에서 현재 HashRouter를 통한 외부 사이트 이동은 **확정하지 못했다**. 패키지 전체의 안전을 선언하지 않으며, BrowserRouter·SSR/Data Router로 전환하거나 알림 URL을 `window.location` 또는 일반 `<a>`에 연결하면 이 결론을 재사용하지 않고 내부 경로 허용 검사를 먼저 적용해야 한다.

## 추적 파일의 자격 증명 패턴 검사

`git ls-files`의 2,237개 중 텍스트 1,505개를 읽어 PEM/OpenSSH 개인키 시작 표식, JSON `type: service_account`, 값이 들어 있는 `private_key` 필드 패턴을 검사했다. **일치 0건**, 읽기 실패 0건이었다. NUL 바이트가 있는 바이너리 732개는 제외했다. 원문·키 값은 출력하지 않았으며, 공개 Firebase 클라이언트 `apiKey`를 비밀키로 분류하지 않았다. Git 과거 이력·추적되지 않는 `.env`·운영 환경 변수·바이너리 내부까지 자격 증명이 없다는 의미는 아니다.

## Functions 의존성 판단

전체 Functions 재배포는 운영 원본과 저장소의 기존 소스 차이 때문에 별도 검증이 필요하다. lock 갱신만으로 운영 모든 함수의 취약점이 해결되지는 않는다.

- `sharp 0.34.5`: [2026-09-30 공식 공지](https://github.com/lovell/sharp/security/advisories/GHSA-wq5f-xc86-pv6w)의 SVG librsvg 메모리 취약점 CVE-2026-96889는 `0.35.5`에서 수정된다. Linux 런타임 조건에 따라 원격 코드 실행 가능성이 있으며, `sharp(...).metadata()`도 이미지 파서 진입이다. 아바타·공지 이미지의 파일 헤더 검증과 수업자료·자료실·지도·배너 경로를 구분해 검사한다. MIME 문자열이나 확장자 확인만으로 파서 접근을 차단했다고 보지 않는다.
- `websocket-driver 0.7.4`: [2026-06-04 공식 공지](https://github.com/faye/websocket-driver-node/security/advisories/GHSA-xv26-6w52-cph6)의 Critical 경고는 초안 WebSocket 프로토콜 서버 파서의 길이 처리와 관련된다. 수정 버전은 `0.7.5`다. 저장소에서 외부 클라이언트를 받는 해당 WebSocket 서버를 발견하지 못했으며 패키지 포함과 실제 노출을 구분한다.
- `proxy-addr 2.0.7`: [2026-09-15 공식 공지](https://github.com/jshttp/proxy-addr/security/advisories/GHSA-jqcg-44mw-7w3h)의 Critical 경고는 잘못된 IPv4-mapped IPv6 `trust proxy` 서브넷 설정에서 IP 위조를 허용한다. 수정 버전은 `2.0.8`이다. 해당 trust subnet 설정은 앱 소스에서 발견하지 못했다.
- `body-parser`, `@fastify/busboy`, `form-data`, `node-forge`, `protobufjs`, `qs`, gRPC 등의 경고도 남아 있다. 높은 수치만 보고 Firebase Admin 14로 일괄 변경하지 않으며, 운영 함수별 소스·의존 경로와 회귀 검증을 맞춰 적용해야 한다.

## 최근 주요 이슈 적용성

- [React2Shell CVE-2025-55182](https://react.dev/blog/2025/12/03/critical-security-vulnerability-in-react-server-components): 위스토리는 React 18 SPA이고 두 lock에 Next.js, `react-server-dom-*`, `@vitejs/plugin-rsc`가 없다. 해당 RSC 원격 코드 실행 경로를 사용하지 않는다.
- [PDF.js CVE-2024-4367](https://github.com/mozilla/pdf.js/security/advisories/GHSA-wgrm-67xf-hhpq): 악성 PDF를 통한 JavaScript 실행 문제는 4.2.67에서 수정됐다. 현재 5.4.296은 수정 범위 이상이며 해당 CVE 때문에 PDF 엔진을 전면 교체할 필요가 없다.
- [TanStack 2026-05-11 공급망 사고](https://tanstack.com/blog/npm-supply-chain-compromise-postmortem): 두 lock에 TanStack·Axios·Mastra 관련 패키지가 없다. 기존 `security:check-supply-chain`도 통과했다. 이는 기록된 IOC와 lock의 검사 결과이며 개발 PC 전체의 침해 부재를 증명하지 않는다.
- `QuillEditor.tsx`는 npm lock 밖의 CDN Quill 1.3.6을 로드한다. 위 audit 숫자에는 이 경로가 포함되지 않는다. HTML 정화는 저장 콘텐츠의 실행 위험을 줄이는 조치이며 CDN 파일 자체의 무결성 검증을 대체하지 않는다. CDN 교체·자체 호스팅·SRI 적용은 편집 기능과 로딩 복구를 별도로 검증할 유지보수 항목이다.
- [Node 2026-10-21 보안 릴리스](https://nodejs.org/en/blog/vulnerability/october-2026-security-releases): `22.23.4`, `24.22.1`, `26.12.1`에 Brotli decoder 메모리 손상 CVE-2026-111497, DNS NUL·TLS hostname 검증 등 수정이 포함됐다. 점검 당시 로컬 기본 Node는 `24.13.1`이었다. 시스템 Node를 임의 교체하지 않았다. Functions의 관리형 런타임 패치 정책·실제 리비전, Vercel 빌드 Node 및 별도 로컬 22.x 도구를 구분해 확인해야 한다. 런타임 major 설정만으로 patch 적용 여부를 확정하지 않는다.

## 수행한 검증

- `npm ci --ignore-scripts --no-fund --no-audit`: 성공. 다른 worktree의 `node_modules`를 연결하지 않고 독립 설치했다.
- esbuild `transformSync`로 TypeScript 변환 성공. 별도 설치 스크립트 실행 없이 필요한 네이티브 실행 파일이 동작했다.
- `npm run security:check-supply-chain`: 통과.
- `node scripts/verify-neis-performance-import.mjs`: 1/31/32/33/40명, 서명·행 배치와 최종 XLSX `hair` 점선 테두리 회귀 통과.
- `node scripts/verify-grading-performance-import.mjs`: 일람표 메타데이터·평가 조건·빈 점수/0점·NEIS 호환 검사 통과.
- `git diff --check`: 통과.

앱 통합 빌드·브라우저·서버 회귀와 운영 배포 상태는 전체 보안 패치 검증 기록에서 별도로 확인한다. 의존성 갱신은 외부 AI 호출, 학생 데이터 전송, 공개 범위 또는 권한 확대를 추가하지 않는다.
