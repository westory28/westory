# 수업자료 출시 범위 로컬 패치 인수인계

작성일: 2026-09-10. 목표일은 2026-09-16(수)이며 확정 배포일이 아닙니다. 이 보고서는 로컬 패치 결과입니다. Production 및 Staging 접근·배포·push는 실행하지 않았습니다.

## 소스와 범위

- checkout: `C:\westory-w10p`
- branch: `codex/phase6-w10p-presentation-freeze`
- 시작 HEAD: `aed4dd1f232e561a563f990e98cb10a17af2f12d`
- 시작 Tree: `c1dc4d597baa7d8137562be300003c698dd1ef58`
- 검증한 소스 커밋: `563409d6ab759a2744b02c95646094f25d6ec257`
- 검증한 소스 Tree: `59a27b4648a72304e98c8c936c9dbfb1e2d9d119`
- 이 해시를 추가한 뒤의 문서 기록 커밋은 위 소스 커밋과 구분합니다. 소스는 아직 배포하지 않았습니다.
- `package.json`: 21,629 bytes, SHA-256 `b7eb6e9556d34bf21a937982ca2c44db755691dae4cbbe4fbe55594964dcf332`. package/lockfile 및 의존성은 변경하지 않았습니다.
- 원본 `C:\westory` 소스는 수정하지 않았습니다. 허용된 `.git/worktrees/westory-w10p/inspect-w10p-staging-rules.ps1`만 Staging config·Rules·해시 검사에 맞게 수정했으며 실행하지 않았습니다.

## 구현

1. 판서 도구·교사/반별 판서 저장·복원을 제거했습니다. 이전 문서와 파일은 삭제하지 않았고 기존 제시 기록 쓰기는 Rules에서 차단했습니다. 교사 PDF 제시·페이지 이동은 유지합니다.
2. 학생 답안 저장을 `saveLessonAnswers` Gateway 명령으로 연결했습니다. 서버가 학생·등록·학기·수업 접근·정답을 검증하고 답안 revision 충돌을 차단합니다. 화면에 보이지 않는 PDF 페이지 답안도 저장합니다. 기존 핵심포인트·보상 필드는 보존합니다.
3. 학생 저장 실패 시 입력을 유지하며, 저장 중 추가 입력과 단원 전환 뒤의 늦은 응답을 구분합니다. 서버 저장을 성공으로 확인하기 전에는 저장 완료를 표시하지 않습니다.
4. 교사 목차·본문·PDF·각주 저장을 `saveLessonTree`, `saveLessonDocument`, `prepareLessonAssetUpload` 명령으로 연결했습니다. 학기/수업 전환·수정 충돌·오래된 PDF 추출 조회가 새 편집을 덮어쓰지 않도록 가드를 추가했습니다. legacy 수업은 읽기 원본을 보존하고 학기 경로에 저장합니다.
5. PDF/PAGE/FOOTNOTE 파일은 서버 발급 ticket의 create-only 경로에 올린 뒤 크기·MIME·SHA-256·소유자·학기·수업·종류·만료를 검증해 연결합니다. PDF 추출의 중복 이벤트와 새 파일로 교체된 뒤 도착하는 응답을 막습니다. 기존 자산을 삭제하지 않습니다.
6. 새 본문 저장에는 HTML 허용 목록을 적용했습니다. 이미지·글 각주와 일반 HTTPS/HTTP 링크를 함께 사용할 수 있습니다. 빈칸 정답·오답 효과 및 핵심포인트 찾기·보상을 모두 유지합니다.
7. 기본 Firestore Rules의 합성 관리자 예외를 비활성화하고 `firestore.staging.rules` / `firebase.staging.json`으로 분리했습니다. seed/capture/verifier도 Staging Rules를 참조합니다.
8. CI의 build-only 환경값을 현재 Staging 구성 형식에 맞췄습니다. 가짜 API key는 빌드 전용이며 실제 Firebase 연결 검증이 아닙니다. Pages workflow는 재활성화하지 않았습니다.

## 실제 검증

| 검증 | 결과 | 범위와 한계 |
| --- | --- | --- |
| `npm --prefix functions run check` | PASS | 기존 Functions 전체 검사 |
| `verify-lesson-answers.cjs` | PASS 25 | 서버 채점·숨은 페이지·권한·등록·CAS·응답 유실·멱등성·보상 보존, 격리 저장소 |
| `verify-lesson-management.cjs` | PASS 25 | 교사 권한·학기·본문/목차 원자성·legacy 보존·자산 연결·XSS 거절 |
| `verify-lesson-assets.cjs` | PASS 16 | 실제 등록 finalize callback, 무결성·중복·generation·lease·stale 연결·추출 실패; Storage/PDF parser 모의 구현 |
| `verify-lesson-release-rules.mjs` | PASS 68 | Firestore+Storage 로컬 에뮬레이터, 기본/Staging 양쪽 권한 차이·업로드·덮어쓰기/삭제 차단 |
| `npm run build` | PASS | CI와 동일한 build-only 환경, 최종 빌드 17.47초 |
| `npm run format:check` | PASS | 전체 src TypeScript/TSX |
| 타입 기준선 | PASS | 기존 44오류/12파일, 신규 0, 이전 기준 대비 19개 감소 |
| 직접 쓰기 경계 | PASS | 136개 승인 경계, UNKNOWN 0. 신규 Storage transport는 W12 한시 예외 |
| 라우트·정적 화면 계약 | PASS | raw 48/alias 4/canonical 44. 49파일 기준 검사; 판서 카드 제거의 9개 클래스만 명시적 예외 |
| 핵심포인트 보상 안전 계약 | PASS | 기존 서버 보상·멱등성·원장 계약 유지 |
| W11 command safety 하위 검사 | PASS | 초기 Firebase dynamic import 실패를 수정한 뒤 실패 검사 및 남은 하위 검사 통과. 전체 체인을 불필요하게 재실행하지 않음 |
| 독립 코드 검토 | PASS | 마지막 검토에서 해당 패치 범위의 미해결 P0/P1 없음. 실행 검증과 구분 |

Rules 실행은 `demo-westory-session-lesson-rules` 프로젝트와 18080/19199의 격리 포트를 사용했습니다. 테스트 68개 및 script exit 0 이후 에뮬레이터 종료 중 Java NPE 메시지가 있었으며 테스트 실패로 은폐하지 않습니다. 종료 잔여 프로세스는 정확한 프로젝트·Rules 경로로 구분해 정리했습니다.

### 로컬 브라우저 확인

실제 LessonContent / TeacherLessonPresentation 컴포넌트를 사용한 `scripts/lesson-release-preview.mjs` 합성 화면에서 확인했습니다. Firebase SDK 초기화·외부 연결은 차단했고, 저장은 모의 API와 로컬 저장소를 사용했습니다.

- 서로 다른 PDF 페이지와 본문 빈칸 입력, 정답·오답 표시, 저장 팝업, 컴포넌트 재진입 복원.
- 저장 실패 뒤 입력 유지, 느린 저장 중 추가 입력 보존과 재저장 안내, 저장 중 다른 단원으로 전환할 때 이전 답안 덮어쓰기 방지.
- 핵심포인트 찾기와 500 Wis 보상 UI, 이미지·설명·링크 각주.
- 교사 제시에서 판서·반별 저장 도구가 사라지고 PDF 이동/각주 유지.
- 학생 풀이·교사 제시 각각 390×844 / 768×1024 / 1024×768 / 1440×900 / 1600×900에서 DOM 가로 넘침 없음. 모바일/기본 화면 육안 확인. 337 PNG 시각 비교는 실행하지 않음.

교사 편집 화면 전체 클릭 흐름, 실제 파일 파서·Storage 트리거·Gateway의 통합, 실제 재로그인/다른 기기 복원은 Staging에서 추가 검증해야 합니다. 위 모의 검증을 실서비스 end-to-end 성공으로 해석하지 않습니다.

## Staging 재개 순서

1. 실제 최종 source commit/Tree/package hash를 다시 확인합니다. 이전 `aed4dd1` provenance를 새 소스에 재사용하지 않습니다.
2. `westory-staging-177587430482`에만 변경 Functions/기본 Storage 및 Staging Firestore Rules를 반영합니다. 새 `processLessonAssetUpload`와 legacy drain trigger를 확인합니다.
3. 교사 목차 추가/수정/삭제, PDF·각주 업로드 및 실패 재시도, HTML 허용 목록과 기존 편집기 출력 호환성을 실제로 검증합니다. 오래된 판서는 읽거나 복원되지 않아야 합니다.
4. 학생의 다른 페이지 답안·재로그인·동일 계정 다른 브라우저 복원, 충돌/세션 만료/보상 멱등성을 확인합니다. source archive 이미지는 승인 업로드로 복사되므로 학생에게 원본 archive 접근권한을 부여하지 않습니다.
5. 새 소스의 Vercel provenance 및 immutable deployment를 만들고 허용된 alias/capture wrapper를 갱신합니다. 현재 Vercel 인증은 재확인이 필요합니다.
6. 기능 검증이 통과한 소스에서 337 PNG/189비교/44 audit의 전체 시각 계약을 실행합니다. 사용자 요청의 판서 제거 차이만 기록하고 다른 화면 기준을 낮추지 않습니다.

## W12와 운영 미완료 항목

- 재인증·여러 화면 세션 복구(KI-W1-01), DIC01/DIC02/PATCH01 Gateway 이전.
- 지도/사료 자산과 공식 성적 XLSX 운영 정책. 수업자료 ticket 구현으로 다른 도메인이 자동 활성화되지 않습니다.
- 실제 명단·학기 시작/종료일·전환 시각, Expected Diff, 이전 클라이언트 쓰기 차단.
- 백업·복원 실증, 운영 전용 배포/롤백 순서와 사용자 판단.
- 원격 main 대비 대규모 미반영 변경은 여전히 존재합니다. 이번 패치만으로 전체 사이트 Production READY를 선언하지 않습니다.

로컬 단계 다음 작업은 Staging 기능 검증입니다. 현재 본 사이트에는 적용하지 않았습니다.

검증용 `.lesson-ui-runtime/` 및 `.lesson-test-emulators.json`은 자동 승인 검토의 삭제 차단으로 로컬에 남겼습니다. 두 경로는 커밋에서 명시적으로 제외합니다. 검증 브라우저와 preview 서버는 종료했습니다.
