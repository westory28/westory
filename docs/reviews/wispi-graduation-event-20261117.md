# 위스피 졸업 정산·500위스 이벤트 (2026-11-17)

사용자가 요청한 범위는 종목 졸업 때 마지막 가격으로 전량 정산하여 학생 주식 지갑에 입금하는 것, 기존 이체까지 포함한 누적 500위스 이상 입금자에게 인당 한 번 500위스를 추가 지급하는 것이다. 사용자 확인에 따라 과거 입금도 포함하며 종료일은 두지 않는다. 실제 종목을 시험 목적으로 졸업시키거나 실제 학생 주문을 생성하지 않는다.

## 회계 계약

- 교사의 기존 종목 저장 명령에서 `GRADUATED`로 변경하면 현재 가격을 고정하고 `wis_stock_graduations/{semesterId}_{stockId}`에 작업을 같은 트랜잭션으로 생성한다. 졸업 이후 설정 수정과 매수·매도, 자동 가격 갱신을 차단한다. 카탈로그의 합성 합병·퇴장 일정은 자동 실행하지 않는다.
- 보유자는 해당 종목의 매수·매도 예약을 취소하고 `수량 × 고정된 마지막 가격` 전액을 주식 현금으로 받는다. 졸업 수수료는 0이다. 보유 원가와 매수 수수료는 실현손익 계산에 유지한다. 미회수 입금 원금은 매도만으로 줄이지 않는다.
- 학생 계좌·공급량·예약 주문·자동 매도 주문·원장·정산 영수증·전체/학급 보드는 학생별 단일 트랜잭션으로 반영한다. 자동 매도는 기존 `ORDER_FILLED / SELL` 이력에 `automaticSettlement: GRADUATION`을 붙이므로 투자 이력 재구성과 호환된다.
- 수량 0인 예약 매수 전용 계좌는 기존 최대 60초 주문 작업이 졸업 상태를 확인해 취소한다. 예약 공급량이 남아 있으면 졸업 작업을 완료 처리하지 않는다. 실패한 작업은 5분 복구 스케줄러가 다시 큐에 넣는다. 작업은 학기 전환 후에도 해당 원래 학기 경로에서 정산한다.
- 캠페인 ID는 `wispi-deposit-500-v1`이다. `wis_stock_campaign_receipts/{campaignId}_{uidHash}` 전역 영수증으로 학기 변경·동시 입금·소급 지급·재시도에도 학생당 한 번만 지급한다. `site_settings/wis_stock_deposit_campaign`의 서버 설정이 활성화돼야 향후 입금 보상이 적용된다.
- 대상 판정은 학생 UID와 `DEPOSIT`으로 서버에서 필터한 전체 학기의 정식 주식 이력만 사용한다. 최소 입금이 정수 1위스이므로 최대 500개만 읽어도 누적 500위스 충족 여부는 완전하게 판정된다. 이는 전체 입금액 합계 보고가 아니다. 출금·보상·다른 학생 이력은 제외한다.
- 보상은 주식 현금과 미회수 원금을 각각 500 늘린다. 일반 위스·일반 획득 누계·등급을 지급 시점에 변경하지 않으며 이후 보상 원금 출금을 투자 수익으로 중복 집계하지 않는다. `EVENT_BONUS` 원장과 캠페인 영수증을 같은 트랜잭션에 남긴다.
- 소급 처리는 현재 학기의 `ACTIVE` 일반 위스 계좌를 커서로 끝까지 확인한다. 과거 이체 조건을 충족했지만 현재 주식 계좌가 없으면 계좌를 생성하여 지급한다. 현재 학생/학적/일반 계좌 권한을 다시 검사하며 비활성 계정은 사유별 건수로 보고한다. 이후 복귀·첫 입금에도 과거 이력을 다시 검사한다.

## 검증

`node scripts/run-wis-stock-graduation-event-tests.mjs`는 전용 로컬 Firestore 데모 프로젝트와 `127.0.0.1:18258`을 요구한다. 운영 연결을 거부하는 가드가 있다. 저장소 코드와 실제 배포 준비본 모두 다음 9개 통합 그룹을 통과했다.

1. 249+251 누적 입금 지급, 중복 요청 0쓰기, 보상 출금 수익 0, 일반 위스 원장·등급 불변.
2. 입금 후 이미 전액 출금한 사람의 소급 지급, dry-run 0쓰기, 커밋 실패 전체 롤백, 별도 인스턴스 동시 지급 한 번.
3. 이전 학기 입금 포함 및 다른 학생 제외.
4. 현재 주식 계좌가 없는 과거 입금자에게 현재 계좌 생성·지급.
5. 실시간 추가 입금과 과거 대상 지급 경합에서 보상 한 번.
6. 매수·매도 예약 동시 취소, 마지막 가격 123위스로 10주 전량 1,230위스 지급, 동시/재시도 중복 방지, 자동 가격 동결.
7. 졸업 정산 커밋 실패 시 현금·보유량·예약·영수증 전체 롤백과 재시도 복구.
8. 예약 매수만 있는 계좌의 예약 해제 및 작업 완료 지연.
9. 페이지 크기 10을 넘는 12명 전원 정산, 후속 커서 및 트리거 누락 복구.

기존 주식 시장·규칙·주문·입출금 단위 검사 69개도 통과했다. 실제 증거는 `output/wispi-graduation-event-20261117/graduation-event-integration.json`과 `prepared-source/graduation-event-integration.json`에 보관한다. 거래별 읽기/쓰기는 재시도 시도와 최종 커밋을 구분한다. 대표적으로 소급 보상은 17읽기/6쓰기, 졸업은 예약 없음 7읽기/8쓰기, 예약 2건 9읽기/12쓰기다. 중복 보상·정산은 0쓰기다. 세션 guard의 별도 읽기, 작업 페이지 조회, fixture 준비/검증 조회는 증거의 transaction 예산에서 제외했음을 명시한다.

## 운영 원본 보존과 선택 배포

기준 저장소 커밋은 `59ccdf304d1e490891a00f191f1603929a5bbe04`이다. `scripts/prepare-wispi-graduation-event-release.mjs`는 미국 리전의 기존 17개 함수별 현재 source ZIP·metadata·전체 파일 SHA를 보존하고 승인된 주식 모듈만 교체한다. 루트 `functions/index.js`, 의존성/lockfile, 다른 기능과 실제 런타임 자원은 운영 원본을 유지한다.

운영 원본의 `wisStocks.js`에는 두 가지 검증된 변형이 있다. `advanceWisStockPrices`만 최신 `dailyPriceLimitBps` 전달 3줄을 포함한다. 다른 함수의 해당 3줄은 기존 상태를 보존하여 이 작업에 관련 없는 가격 모델 변경을 섞지 않는다. 허용한 두 변형 이외의 원본 차이는 준비를 중단한다.

대상은 학생 상태·이력·입출금·주문/취소 5개, 주문 작업/생성 트리거/시장 트리거/학적 트리거/복구 5개, 교사 관리/저장/규칙/거래정지/가격/상장일정 6개, `getWisStockInvestmentHistory` 1개다. 투자 이력 함수에는 상위 5명 배치 조회 패치를 함께 넣는다. 전체 파일 SHA가 동일한 준비본끼리만 그룹으로 묶어 정확한 함수 이름의 `--only` 선택 배포를 할 수 있다. 전체 Functions 배포는 하지 않는다.

```powershell
. ./scripts/use-westory-node.ps1
node scripts/prepare-wispi-graduation-event-release.mjs --snapshot-only
node scripts/prepare-wispi-graduation-event-release.mjs --prepare
# 각 준비본 루트에서 manifest.deploy의 정확한 함수만 선택 배포
node scripts/prepare-wispi-graduation-event-release.mjs --verify
```

`--verify`는 대상 전체의 ACTIVE/nodejs22, 배포 ZIP 전체 파일 SHA, 메모리·CPU·시간 제한·최소/최대 인스턴스·동시성·서비스 계정·인바운드 및 기존 Eventarc 조건을 대조한다. `--only=함수명` 단독 검증을 지원한다. 이미 배포한 투자 이력 폴더를 보존하면서 나머지를 준비할 때는 `--prepare --without-history`를 사용한다.

## 소급 지급 실행

`wis_stock_history` collection-group의 `studentUid ASC, kind ASC` 인덱스가 READY인 것을 확인한다. 운영 지급은 루트 작업자가 사용자 승인 범위 내에서 전체 선택 배포/검증 이후 수행한다. 작업자 서브 에이전트는 운영 지급·배포를 실행하지 않는다.

```powershell
. ./scripts/use-westory-node.ps1
$env:NODE_PATH = (Resolve-Path functions/node_modules).Path
node scripts/backfill-wispi-deposit-event.mjs --dry-run
# 생성된 event-plan.json의 실제 planHash 사용
node scripts/backfill-wispi-deposit-event.mjs --apply --confirm-plan=<planHash>
```

runner는 실제 준비본의 지급 함수를 사용한다. dry-run은 쓰기 없이 대상 수·보상 총액·검토 digest만 저장한다. apply는 1시간 이내 계획과 현재 대상 digest가 같아야 시작하며, 배포 검증 결과가 있어야 캠페인을 활성화한다. 기존 영수증을 확인해 재실행에 안전하다. 이름·UID·자격 증명을 출력하거나 계획 파일에 저장하지 않는다. Firebase CLI의 기존 로그인은 메모리에서만 사용하며 새 서비스 계정 키나 ADC 파일을 만들지 않는다.

새 AI 호출, 학생 정보 외부 전송, 개인정보 항목이나 학생/교사 공개 범위의 확대는 없다. 서버 조회·권한·금액 정산은 결정적인 코드와 기존 학기/학생 권한을 따른다. 이벤트 원본 배너와 게시물 등록은 별도 프런트엔드/운영 작업 범위다.
