import React, { useMemo, useState } from 'react';
import './assets/dashboard.css';
import type { DashboardDataset, ParticipantRecord } from './features/survey-dashboard/types';
import { getAdviceForParticipant, loadDatasetFromWorkbook, loadMockDataset } from './features/survey-dashboard/services/traineeData';
import { downloadParticipantReport } from './features/survey-dashboard/services/reportExport';
import { LoginPanel } from './features/survey-dashboard/components/LoginPanel';
import { UploadPanel } from './features/survey-dashboard/components/UploadPanel';
import { ScoreComparisonChart } from './features/survey-dashboard/components/ScoreComparisonChart';

const App: React.FC = () => {
    const [dataset, setDataset] = useState<DashboardDataset>(loadMockDataset());
    const [inputId, setInputId] = useState('');
    const [loggedInId, setLoggedInId] = useState<string | null>(null);
    const [uploading, setUploading] = useState(false);
    const [errorMessage, setErrorMessage] = useState('');

    const participant = useMemo<ParticipantRecord | null>(() => {
        if (!loggedInId) return null;
        return dataset.participants.find((item) => item.traineeId === loggedInId) ?? null;
    }, [dataset.participants, loggedInId]);

    const advice = participant ? getAdviceForParticipant(participant) : null;

    const resetLogin = () => {
        setLoggedInId(null);
        setInputId('');
        setErrorMessage('');
    };

    const handleLogin = () => {
        const normalized = inputId.replace(/\D/g, '').slice(0, 4);
        if (normalized.length !== 4) {
            setErrorMessage('고유번호 4자리를 입력해 주세요.');
            return;
        }

        const matched = dataset.participants.find((item) => item.traineeId === normalized);
        if (!matched) {
            setErrorMessage('해당 고유번호의 결과를 찾지 못했습니다. 번호를 다시 확인해 주세요.');
            return;
        }

        setLoggedInId(normalized);
        setInputId(normalized);
        setErrorMessage('');
    };

    const handleWorkbookUpload = async (file: File) => {
        setUploading(true);
        setErrorMessage('');

        try {
            const nextDataset = await loadDatasetFromWorkbook(file);
            setDataset(nextDataset);
            resetLogin();
        } catch (error) {
            const message = error instanceof Error ? error.message : '엑셀 파일을 분석하지 못했습니다.';
            setErrorMessage(message);
        } finally {
            setUploading(false);
        }
    };

    const handleDownload = () => {
        if (!participant) return;
        downloadParticipantReport(participant, dataset.summary);
    };

    if (!participant) {
        return (
            <div className="survey-app-shell">
                <div className="survey-background-glow survey-background-glow-left" />
                <div className="survey-background-glow survey-background-glow-right" />

                <main className="survey-page survey-page-login">
                    <section className="hero-card hero-card-login">
                        <div className="hero-copy">
                            <span className="hero-badge">GOE Education Operations</span>
                            <h1>연수 결과 확인</h1>
                            <p>
                                이름이나 이메일 없이 고유번호 4자리만 입력하면 개인 결과를 확인할 수 있습니다.
                                기본 데이터는 더미 예시이며, 필요하면 엑셀 업로드로 바로 교체할 수 있습니다.
                            </p>
                        </div>
                    </section>

                    <section className="login-layout">
                        <LoginPanel
                            inputId={inputId}
                            errorMessage={errorMessage}
                            datasetLabel={dataset.sourceLabel}
                            participantCount={dataset.participants.length}
                            onChangeInput={setInputId}
                            onLogin={handleLogin}
                        />

                        <UploadPanel
                            dataset={dataset}
                            uploading={uploading}
                            onResetMock={() => {
                                setDataset(loadMockDataset());
                                resetLogin();
                            }}
                            onUpload={handleWorkbookUpload}
                        />
                    </section>
                </main>
            </div>
        );
    }

    return (
        <div className="survey-app-shell">
            <div className="survey-background-glow survey-background-glow-left" />
            <div className="survey-background-glow survey-background-glow-right" />

            <main className="survey-page">
                <section className="hero-card">
                    <div className="hero-copy">
                        <span className="hero-badge">분석 대시보드</span>
                        <h1>개인 역량 변화 결과</h1>
                        <p>사전 점수와 사후 점수, 전체 평균 비교를 한 화면에서 확인할 수 있도록 밝은 카드형 대시보드로 구성했습니다.</p>
                    </div>

                    <div className="hero-side">
                        <span className="hero-pill">{participant.traineeId}</span>
                        <span className="hero-pill">{participant.name}</span>
                        <span className="hero-pill">{participant.organization}</span>
                    </div>
                </section>

                <section className="summary-grid">
                    <article className="metric-card">
                        <span className="metric-label">사전 평균</span>
                        <strong>{participant.preOverall.toFixed(2)}</strong>
                        <p>{participant.name} 님의 시작 점수입니다.</p>
                    </article>

                    <article className="metric-card">
                        <span className="metric-label">사후 평균</span>
                        <strong>{participant.postOverall.toFixed(2)}</strong>
                        <p>연수 이후의 최종 점수입니다.</p>
                    </article>

                    <article className="metric-card">
                        <span className="metric-label">향상 폭</span>
                        <strong className={participant.growth >= 0 ? 'metric-positive' : 'metric-negative'}>
                            {participant.growth >= 0 ? '+' : ''}
                            {participant.growth.toFixed(2)}
                        </strong>
                        <p>사전 대비 변화량입니다.</p>
                    </article>

                    <article className="metric-card">
                        <span className="metric-label">전체 평균 대비</span>
                        <strong className={participant.cohortGapPost >= 0 ? 'metric-positive' : 'metric-negative'}>
                            {participant.cohortGapPost >= 0 ? '+' : ''}
                            {participant.cohortGapPost.toFixed(2)}
                        </strong>
                        <p>사후 점수 기준 전체 평균과의 차이입니다.</p>
                    </article>
                </section>

                <section className="chart-card">
                    <div className="card-header">
                        <div>
                            <span className="section-kicker">점수 비교</span>
                            <h2>
                                {participant.organization} · {participant.name} · {participant.traineeId}
                            </h2>
                        </div>
                        <div className="profile-chip-group">
                            <span className="profile-chip">{participant.trackLabel}</span>
                            <span className="profile-chip">전체 {dataset.participants.length}명 비교</span>
                        </div>
                    </div>

                    <ScoreComparisonChart participant={participant} />
                </section>

                <section className="analysis-grid">
                    <article className="detail-card">
                        <div className="card-header">
                            <div>
                                <span className="section-kicker">영역 분석</span>
                                <h2>세부 역량 변화</h2>
                            </div>
                        </div>

                        <div className="competency-list">
                            {participant.competencies.map((competency) => (
                                <div key={competency.label} className="competency-row">
                                    <div>
                                        <strong>{competency.label}</strong>
                                        <p>
                                            사전 {competency.pre.toFixed(2)} / 사후 {competency.post.toFixed(2)}
                                        </p>
                                    </div>
                                    <div className="competency-trend">
                                        <span>전체 평균 {competency.postAverage.toFixed(2)}</span>
                                        <strong className={competency.growth >= 0 ? 'metric-positive' : 'metric-negative'}>
                                            {competency.growth >= 0 ? '+' : ''}
                                            {competency.growth.toFixed(2)}
                                        </strong>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </article>

                    <article className="detail-card advice-card">
                        <div className="card-header">
                            <div>
                                <span className="section-kicker">고정 피드백</span>
                                <h2>{advice?.title}</h2>
                            </div>
                        </div>

                        <p className="advice-lead">{advice?.summary}</p>
                        <div className="advice-points">
                            {advice?.points.map((point) => (
                                <div key={point} className="advice-point">
                                    {point}
                                </div>
                            ))}
                        </div>
                        <div className="advice-note">AI 호출 없이 점수 구간 조건문으로 생성된 안내입니다. 다시 조회하려면 아래 버튼으로 로그인 화면으로 돌아갈 수 있습니다.</div>
                    </article>
                </section>

                <section className="download-card">
                    <div>
                        <span className="section-kicker">결과 다운로드</span>
                        <h2>개인 분석 결과 엑셀 저장</h2>
                        <p>현재 화면의 핵심 지표와 역량별 변화 데이터를 엑셀 파일로 내려받을 수 있습니다.</p>
                    </div>

                    <div className="download-actions">
                        <button type="button" className="ghost-button" onClick={resetLogin}>
                            다른 번호 조회
                        </button>
                        <button type="button" className="primary-button" onClick={handleDownload}>
                            결과지 다운로드
                        </button>
                    </div>
                </section>
            </main>
        </div>
    );
};

export default App;
