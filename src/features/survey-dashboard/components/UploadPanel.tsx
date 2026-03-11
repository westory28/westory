import React, { useRef } from 'react';
import type { DashboardDataset } from '../types';

interface UploadPanelProps {
    dataset: DashboardDataset;
    uploading: boolean;
    onUpload: (file: File) => Promise<void>;
    onResetMock: () => void;
}

export const UploadPanel: React.FC<UploadPanelProps> = ({ dataset, uploading, onUpload, onResetMock }) => {
    const inputRef = useRef<HTMLInputElement | null>(null);

    return (
        <section className="panel-card">
            <div className="card-header">
                <div>
                    <span className="section-kicker">데이터 소스</span>
                    <h2>엑셀 업로드</h2>
                </div>
            </div>

            <p className="panel-copy">
                지금은 더미 데이터로 동작하지만, 엑셀 파일을 올리면 같은 화면 구조로 바로 바꿔 볼 수 있습니다.
                추후 파이어스토어 연동을 위해 데이터 로딩 함수는 비동기 구조로 분리되어 있습니다.
            </p>

            <div className="upload-actions">
                <button type="button" className="secondary-button" onClick={() => inputRef.current?.click()} disabled={uploading}>
                    {uploading ? '파일 분석 중...' : '엑셀 업로드'}
                </button>
                <button type="button" className="ghost-button" onClick={onResetMock} disabled={uploading}>
                    더미 데이터로 되돌리기
                </button>
            </div>

            <input
                ref={inputRef}
                type="file"
                accept=".xlsx,.xls"
                hidden
                onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (!file) return;
                    void onUpload(file);
                    event.target.value = '';
                }}
            />

            <div className="upload-hints">
                <div className="hint-item">`사전 설문` / `사후 설문` 시트명을 우선 탐색합니다.</div>
                <div className="hint-item">`전체 평균`, `학교명`, `이름`, `전화번호` 또는 `고유번호` 열을 읽습니다.</div>
                <div className="hint-item">번호 열이 없으면 순번 기준으로 0001부터 자동 부여합니다.</div>
            </div>

            <div className="dataset-mini-card">
                <strong>{dataset.summary.sourceLabel}</strong>
                <p>
                    평균 {dataset.summary.preAverage.toFixed(2)} → {dataset.summary.postAverage.toFixed(2)}
                </p>
            </div>
        </section>
    );
};
