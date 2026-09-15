# Westory 운영 Firestore 백업·복구 점검 절차

2026-09-15 실제 적용 결과를 기준으로 작성했습니다.

## 운영 기준

| 대상 | 정상 기준 |
|---|---|
| 프로젝트·DB | `history-quiz-yongsin / (default)`, nam5 |
| 삭제 보호 | `DELETE_PROTECTION_ENABLED` |
| PITR | `POINT_IN_TIME_RECOVERY_ENABLED`, `versionRetentionPeriod=604800s` |
| 일일 관리형 백업 | 스케줄 정확히 1개, 보존 30일 이상 |
| 현재 스케줄 | `41f0b770-506b-468a-8f03-05a14cfceeff` |
| 기존 GCS 수동 백업 | `westory-b0-177587430482`의 기존 경로 보존 |

PITR와 일일 백업은 별도 보호 수단입니다. PITR는 활성화 이후 이력이 쌓이며, 관리형 백업은 실행된 시점의 데이터와 인덱스 설정을 보관합니다. 관리형 백업에는 Auth·Storage 파일·Functions secret이나 TTL 정책이 포함되지 않습니다. [PITR 안내](https://firebase.google.com/docs/firestore/use-pitr), [백업 범위](https://firebase.google.com/docs/firestore/backups).

## 읽기 전용 정상 점검

아래 REST GET을 사용합니다. 자격 증명은 런타임에서 읽고 토큰은 파일·로그에 남기지 않습니다.

| 목적 | GET 경로 |
|---|---|
| DB 보호 상태 | `https://firestore.googleapis.com/v1/projects/history-quiz-yongsin/databases/(default)` |
| 백업 스케줄 목록 | `https://firestore.googleapis.com/v1/projects/history-quiz-yongsin/databases/(default)/backupSchedules` |
| 일일 스케줄 상세 | `https://firestore.googleapis.com/v1/projects/history-quiz-yongsin/databases/(default)/backupSchedules/41f0b770-506b-468a-8f03-05a14cfceeff` |
| nam5의 관리형 백업 목록 | `https://firestore.googleapis.com/v1/projects/history-quiz-yongsin/locations/nam5/backups` |

1. 프로젝트·DB 이름과 UID를 먼저 확인합니다.
2. DB 삭제 보호·PITR·보관 기간을 확인하고 `earliestVersionTime`을 기록합니다.
3. 일일 스케줄이 1개이고 보존 기간이 30일 이상인지 확인합니다. 기존 스케줄이 있으면 새로 만들지 않습니다.
4. 백업 목록에서 `database=projects/history-quiz-yongsin/databases/(default)`인 항목의 `state`, `snapshotTime`, `expireTime`을 확인합니다. 목록이 여러 페이지이면 이어서 조회합니다.
5. 첫 일일 백업은 READY 상태를 확인한 뒤 완료로 기록합니다. 2026-09-15 설정 직후에는 첫 백업이 아직 없었습니다.
6. 앱 접속 상태·학기를 바꾸지 않습니다. 오류 응답과 정상적인 빈 백업 목록을 구분해서 기록합니다.

백업 시각은 운영자가 지정할 수 없습니다. 일정은 일일 실행을 뜻하며 특정 시각의 완료를 보장하는 표시로 사용하지 않습니다. 저장 비용과 복원 비용은 별도 과금입니다. [스케줄·비용 안내](https://firebase.google.com/docs/firestore/backups).

## 설정 변경 시

- DB 설정 변경은 fresh `etag`와 필요한 필드만 명시한 `updateMask`를 사용합니다. Operation 완료와 GET 결과를 모두 확인합니다.
- 일일 스케줄은 먼저 조회합니다. 없을 때만 생성하고, 있으면 기존 것을 유지합니다. 30일보다 긴 기존 보존 기간을 임의로 줄이지 않습니다.
- 응답 유실 시 상태·스케줄 목록을 다시 확인합니다. 같은 생성을 무조건 반복하지 않습니다.
- 새 백업 스케줄이 실패해도 이미 켜진 PITR·삭제 보호를 자동으로 끄지 않습니다.

## 사고 발생 시 복원 판단

1. 손상 시각과 범위를 확인하고 읽기 전용 근거를 보존합니다.
2. `earliestVersionTime` 안의 변경은 PITR 조회·복구 가능 범위를 검토합니다. 더 오래된 시점은 READY 관리형 백업 또는 기존 수동 export를 확인합니다.
3. 복원 대상 DB와 검증 기준을 별도 실행안으로 확정합니다. 관리형 백업 복원은 새 DB에 수행하며, 기존 운영 DB에 무조건 덮어쓰지 않습니다.
4. 복원본의 문서·인덱스·앱 연결과 별도로 Auth·Storage·Functions·Rules·secret 범위도 확인합니다. 백업 설정 완료를 전체 서비스 재해복구 성공으로 표시하지 않습니다.
5. 실제 복원 및 서비스 전환은 승인된 실행 범위에서만 수행합니다. [관리형 백업 복원](https://firebase.google.com/docs/firestore/backups#restore_data_from_a_database_backup).

## 중단·되돌리기 주의

PITR를 끄면 기존 PITR 이력에 접근할 수 없으므로 자동 rollback에 포함하지 않습니다. 향후 백업만 중단해야 하면 정확한 스케줄을 삭제할 수 있지만, 기존 백업은 보존합니다. 스케줄 삭제는 이미 만들어진 백업을 삭제하지 않습니다. [PITR 해제 영향](https://firebase.google.com/docs/firestore/use-pitr), [스케줄 삭제](https://firebase.google.com/docs/firestore/backups#delete_a_backup_schedule).
