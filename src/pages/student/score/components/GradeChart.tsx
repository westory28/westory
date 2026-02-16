import React from 'react';
import { Bar } from 'react-chartjs-2';
import {
    Chart as ChartJS,
    CategoryScale,
    LinearScale,
    BarElement,
    Title,
    Tooltip,
    Legend,
} from 'chart.js';

ChartJS.register(
    CategoryScale,
    LinearScale,
    BarElement,
    Title,
    Tooltip,
    Legend
);

interface GradeChartProps {
    labels: string[];
    data: number[];
    colors: string[];
}

const GradeChart: React.FC<GradeChartProps> = ({ labels, data, colors }) => {
    const chartData = {
        labels,
        datasets: [
            {
                label: '환산 점수',
                data: data,
                backgroundColor: colors,
                borderRadius: 4,
                barPercentage: 0.6,
            },
        ],
    };

    const options = {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
            legend: {
                display: false,
            },
            title: {
                display: false,
            },
        },
        scales: {
            y: {
                beginAtZero: true,
                max: 100,
            },
            x: {
                ticks: {
                    font: {
                        size: 12,
                    },
                },
            },
        },
    };

    return <Bar data={chartData} options={options} />;
};

export default GradeChart;
