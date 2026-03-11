import React from 'react';
import {
    Chart as ChartJS,
    Filler,
    Legend,
    LineElement,
    PointElement,
    RadialLinearScale,
    RadarController,
    Tooltip,
} from 'chart.js';
import { Radar } from 'react-chartjs-2';
import type { ParticipantRecord } from '../types';

ChartJS.register(RadarController, RadialLinearScale, PointElement, LineElement, Filler, Tooltip, Legend);

interface ScoreComparisonChartProps {
    participant: ParticipantRecord;
}

export const ScoreComparisonChart: React.FC<ScoreComparisonChartProps> = ({ participant }) => {
    const labels = participant.competencies.map((competency) => competency.label);
    const preAverageSeries = participant.competencies.map((competency) => competency.preAverage);
    const postAverageSeries = participant.competencies.map((competency) => competency.postAverage);
    const myPreSeries = participant.competencies.map((competency) => competency.pre);
    const myPostSeries = participant.competencies.map((competency) => competency.post);

    return (
        <div className="chart-wrap">
            <Radar
                data={{
                    labels,
                    datasets: [
                        {
                            label: '전체 사전',
                            data: preAverageSeries,
                            backgroundColor: 'rgba(99, 102, 241, 0.12)',
                            borderColor: '#6366f1',
                            pointBackgroundColor: '#6366f1',
                            pointBorderColor: '#ffffff',
                            pointRadius: 3,
                            borderWidth: 2,
                            fill: true,
                        },
                        {
                            label: '전체 평균',
                            data: postAverageSeries,
                            backgroundColor: 'rgba(45, 212, 191, 0.12)',
                            borderColor: '#14b8a6',
                            pointBackgroundColor: '#14b8a6',
                            pointBorderColor: '#ffffff',
                            pointRadius: 3,
                            borderWidth: 2,
                            fill: true,
                        },
                        {
                            label: '나의 사전',
                            data: myPreSeries,
                            backgroundColor: 'rgba(245, 158, 11, 0.1)',
                            borderColor: '#f59e0b',
                            pointBackgroundColor: '#f59e0b',
                            pointBorderColor: '#ffffff',
                            pointRadius: 3,
                            borderWidth: 2,
                            fill: true,
                        },
                        {
                            label: '나의 사후',
                            data: myPostSeries,
                            backgroundColor: 'rgba(236, 72, 153, 0.1)',
                            borderColor: '#ec4899',
                            pointBackgroundColor: '#ec4899',
                            pointBorderColor: '#ffffff',
                            pointRadius: 3,
                            borderWidth: 2,
                            fill: true,
                        },
                    ],
                }}
                options={{
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: {
                            position: 'bottom',
                            labels: {
                                usePointStyle: true,
                                boxWidth: 10,
                                color: '#334155',
                            },
                        },
                    },
                    scales: {
                        r: {
                            min: 0,
                            max: 5,
                            ticks: {
                                stepSize: 1,
                                color: '#334155',
                                backdropColor: 'rgba(255, 255, 255, 0.78)',
                            },
                            grid: {
                                color: 'rgba(148, 163, 184, 0.28)',
                            },
                            angleLines: {
                                color: 'rgba(148, 163, 184, 0.22)',
                            },
                            pointLabels: {
                                color: '#64748b',
                                font: {
                                    size: 13,
                                    weight: 600,
                                },
                            },
                        },
                    },
                }}
            />
        </div>
    );
};
