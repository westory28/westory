# 지도 관리 저장 복구

기준: `C:/westory-w10p`, source `49812ae7d8960010bc0f12ae95e697e9fc418528`. Staging 통합 대상이며 이 작업에서 배포·커밋·푸시는 하지 않았습니다.

## 복구 범위

- 기존 교사 지도 화면의 제목·분류·설명·지역 바로가기·태그·탭 이름·순서·삭제를 서버 명령으로 연결했습니다.
- 다중 PDF 등록, 순서 변경, 탭 이름 변경은 각 항목의 저장이 모두 성공하거나 모두 취소되는 단일 transaction입니다.
- 기존 PDF/Google 선택 화면에 이미 구현되어 있던 이미지/iframe 편집 폼을 같은 유형 선택에 연결했습니다. 새 레이아웃·색상·분류 정책은 만들지 않았습니다.
- 파일 원본과 PDF 페이지를 지도 전용 `map_asset_uploads` / `map_uploads`로 올립니다. 수업자료의 unitId 티켓을 재사용하지 않습니다.
- PDF 재처리는 선택한 원본 파일과 그 페이지를 함께 저장합니다. 다른 원본 PDF에 새 페이지를 잘못 연결하지 않습니다.
- 실패하면 편집 내용을 유지합니다. 재인증으로 편집기가 다시 마운트되는 경우 계정·학기별 탭 메모리에서 초안과 File을 복구합니다. 저장 결과가 미확정이면 이전 지도 ID·전체 payload·티켓·학기 revision으로 receipt를 재조회/재실행합니다. 민감한 본문·파일·다운로드 token을 브라우저 영구 저장소에 저장하지 않습니다.
- 저장 실패 후 파일을 교체하거나 Google/iframe 지도로 바꿀 때는 최종 문서의 원본 URL·Storage 경로·유형과 실제 페이지 참조에 맞는 업로드 티켓만 전송합니다. 이전 첨부 티켓은 문서에 재연결하지 않고 만료 청소 대상으로 남깁니다. 결과 미확정 payload는 동일 참조와 티켓을 유지합니다.

## 출처와 권한

기존 지도 모델은 학기 `map_resources` 목록이 비었을 때만 전역 `map_resources`를 읽습니다. 전역 지도를 수정하면 동일 전역 자료를 fallback으로 읽는 과거 학기 화면에도 반영됩니다. 이 기존 공유 모델을 유지하며 자동 학기 승격, 전체 목록 병합, 원본 삭제, 출처 추정은 하지 않습니다.

클라이언트는 최초 읽은 origin을 보관합니다. 서버는 현재 활성 학기 포인터/manifest revision, teacher 또는 실제 admin 권한, 원본 존재 여부, contentRevision, **알 수 없는 legacy 필드도 포함한 전체 원본 SHA-256 fingerprint**를 transaction에서 검사합니다. 전역 쓰기는 학기 컬렉션이 여전히 완전히 비었을 때만 가능합니다. revision이 없는 문서도 존재 여부와 원본 fingerprint가 일치해야 하므로 숫자 0만으로 덮어쓰거나 재생성할 수 없습니다. 응답은 실제 originScope를 반환합니다.

빈칸/정답 배열은 metadata payload에서 받지 않고 원본 값을 보존합니다. 기존 `updateMapResourceBlanks`의 책임을 침범하지 않습니다. 클라이언트 Firestore/Storage write 허용을 늘리지 않습니다. 서버 callable만 업로드 티켓을 읽고 본인 결과를 반환합니다.

## 업로드 검증과 수명

- 원본은 20MB 이하 PDF 또는 6MB 이하 PNG/JPEG/WebP입니다. PDF는 최대 150쪽, 한 저장의 첨부 전체는 최대 100MB입니다.
- 티켓은 사용자·지도 ID·origin·전체 source fingerprint·contentRevision·학기 revision·SHA-256·MIME·byteSize·만료시간에 묶입니다.
- transport는 현재 세션/권한/학기를 확인하고 실제 bytes 해시와 크기를 검사합니다. 이미지는 sharp로 실제 형식/치수/최대 픽셀 수를 확인합니다. PDF는 헤더/EOF와 기존 pdfjs 의존성으로 구조와 페이지 수를 확인합니다.
- Storage 생성은 `ifGenerationMatch:0`이며, 재전송 시 기존 객체의 SHA-256을 비교합니다. 최종 검증 전에 실패하거나 학기/원본이 바뀌면 attach되지 않습니다.
- PAGE 티켓에는 원본 PDF uploadId와 page가 필수입니다. 최종 연결에서 동일 원본의 실제 페이지 수, 페이지 번호, 실제 이미지 치수, 본인 소유, VERIFIED 상태와 만료를 다시 검사합니다. 사용하지 않는 티켓도 거절합니다.
- 페이지 이미지는 기존 클라이언트 PDF renderer가 생성합니다. 서버가 PDF를 다시 렌더하여 픽셀 단위 동일성을 비교하지는 않습니다. 검증하는 것은 원본 티켓 연결, 페이지 수/번호, 실제 이미지 형식/치수입니다.
- 신규 download URL은 기존 지도 viewer 계약과 같은 Firebase token URL입니다. token을 별도 로그에 출력하거나 외부 공유하지 않습니다. 첨부된 지도 자료의 기존 읽기 모델을 유지합니다.
- 만료한 미첨부 티켓/객체만 청소합니다. 첨부된 티켓은 expiry를 제거하여 청소 큐를 선점하지 않게 합니다. 과거 ATTACHED 티켓도 청소 pass에서 expiry를 제거합니다. 경로/Storage metadata가 다르면 객체를 삭제하지 않고 CLEANUP_BLOCKED로 격리하여 큐가 진행하도록 합니다.
- transport 최대 120초보다 긴 10분 동안 만료 tombstone을 유지합니다. 이 동안 늦게 생긴 객체는 attach할 수 없고 다음 청소에서 삭제됩니다. 기존 `map-resources` 객체와 첨부 완료 객체는 삭제하지 않습니다.

## 공용 통합 계약

루트 담당자가 `functions/commandGateway.js`, `functions/index.js`, `src/lib/commandGateway.ts`, `src/lib/highRiskCommands.ts`에 명령/인증/타입을 등록합니다.

- `saveMapResources`: MapScope + resources(MapWrite[]), 결과 resources(MapSavedSource[])
- `deleteMapResource`: MapScope + MapSource, 결과 mapId/deleted
- `prepareMapAssetUpload`: MapScope + MapUploadInput, 결과 uploadId/storagePath/expiresAtMs
- `uploadMapAssetContent`: 최근 인증·App Check 적용 callable, 최대 120초
- `cleanupExpiredMapUploads`: `createExpiredMapUploadCleanup({db,bucket})`를 시간별 실행

## 실행한 검증과 남은 통합 검증

- `node --check functions/mapManagement.js`: 통과
- `node functions/scripts/verify-map-management.cjs`: 11개 통과. full fingerprint/CAS, unknown legacy 보존, 원자 batch rollback, legacy 경계, 부재문서 재생성 금지, 학생/비활성학기 거절, 정답 metadata 차단, 타인·미검증·만료 업로드 거절, URL 위조, PDF/PAGE attach, 삭제 보호.
- `node functions/scripts/verify-map-transport.cjs`: 8개 통과. 실제 크기 메타와 immutable replay, owner/role/학기, hash/size/revision, MIME 실패 상태, 만료 청소, ATTACHED 보존/선점 해소, metadata 불일치 격리, tombstone 경합.
- `node scripts/verify-map-retained-assets.mjs`: 9개 통과. 기존 PDF/이미지 교체, Google/iframe 전환, 페이지 삭제, 다른 PDF 페이지 혼입, URL/경로 불일치, 미확정 payload의 티켓 재사용과 보존. 실제 production selector를 검사하며 Firebase/브라우저/네트워크는 초기화하지 않습니다.
- 소유 TypeScript/TSX/JS/CJS 파일 Prettier 적용 및 diff 공백 검사.
- 전체 `tsc --noEmit`은 저장소의 기존 assessmentConfig/mockExamRounds/schedulePeriods/ManageHistoryClassroom 등 오류로 실패했습니다. 루트 통합 검사에서 지도 파일 오류 유무를 별도로 확인해야 합니다.
- Staging 실브라우저 지도 metadata·태그·순서·탭·삭제·이미지·PDF·재처리·재인증·학생 읽기 및 390/768/1280 반응형 확인은 루트의 실행 슬롯에서 수행해야 합니다. 이 문서는 브라우저/배포 완료를 주장하지 않습니다.
