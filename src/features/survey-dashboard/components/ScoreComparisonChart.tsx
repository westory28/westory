import React from 'react';
import {
    BarElement,
    CategoryScale,
    Chart as ChartJS,
    Legend,
    LinearScale,
    Tooltip,
} from 'chart.js';
import { Bar } from 'react-chartjs-2';
import type { ParticipantRecord } from '../types';

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip, Legend);

interface ScoreComparisonChartProps {
    participant: ParticipantRecord;
}

export const ScoreComparisonChart: React.FC<ScoreComparisonChartProps> = ({ participant }) => {
    const labels = ['사전', '사후'];
    const competencyPostAverage = participant.competencies.length
        ? participant.competencies.reduce((sum, competency) => sum + competency.postAverage, 0) / participant.competencies.length
        : participant.postOverall;
    const competencyPreAverage = participant.competencies.length
        ? participant.competencies.reduce((sum, competency) => sum + competency.preAverage, 0) / participant.competencies.length
        : participant.preOverall;

    return (
        <div className="chart-wrap">
            <Bar
                data={{
                    labels,
                    datasets: [
                        {
                            label: '개인 점수',
                            data: [participant.preOverall, participant.postOverall],
                            backgroundColor: ['#bfdbfe', '#3b82f6'],
                            borderColor: ['#93c5fd', '#2563eb'],
                            borderWidth: 1,
                            borderRadius: 18,
                            borderSkipped: false,
                        },
                        {
                            label: '전체 평균',
                            data: [competencyPreAverage, competencyPostAverage],
                            backgroundColor: ['#d1fae5', '#6ee7b7'],
                            borderColor: ['#a7f3d0', '#10b981'],
                            borderWidth: 1,
                            borderRadius: 18,
                            borderSkipped: false,
                        },
                    ],
                }}
                options={{
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: {
                            position: 'top',
                            labels: {
                                usePointStyle: true,
                                boxWidth: 10,
                                color: '#334155',
                            },
                        },
                    },
                    scales: {
                        y: {
                            min: 0,
                            max: 5,
                            ticks: {
                                stepSize: 1,
                                color: '#64748b',
                            },
                            grid: {
                                color: 'rgba(148, 163, 184, 0.18)',
                            },
                        },
                        x: {
                            ticks: {
                                color: '#334155',
                            },
                            grid: {
                                display: false,
                            },
                        },
                    },
                }}
            />
        </div>
    );
};
