import type { DashboardDataset } from '../types';

export const mockDataset: DashboardDataset = {
    sourceLabel: '기본 더미 데이터',
    participants: [
        {
            traineeId: '0001',
            name: '김수',
            organization: '용신중',
            trackLabel: 'AI·디지털 기본 과정',
            preOverall: 3.2,
            postOverall: 4.3,
            growth: 1.1,
            cohortGapPost: 0.35,
            competencies: [
                { label: '에듀테크 활용', pre: 3.1, post: 4.4, preAverage: 3.25, postAverage: 3.96, growth: 1.3 },
                { label: '데이터 이해', pre: 3.3, post: 4.2, preAverage: 3.18, postAverage: 3.88, growth: 0.9 },
                { label: 'AI 활용', pre: 3.0, post: 4.1, preAverage: 3.06, postAverage: 3.79, growth: 1.1 },
                { label: '컴퓨팅 사고력', pre: 3.4, post: 4.5, preAverage: 3.22, postAverage: 4.01, growth: 1.1 },
            ],
        },
        {
            traineeId: '0002',
            name: '박연',
            organization: '송현초',
            trackLabel: 'AI·디지털 심화 과정',
            preOverall: 3.7,
            postOverall: 4.1,
            growth: 0.4,
            cohortGapPost: 0.15,
            competencies: [
                { label: '에듀테크 활용', pre: 3.9, post: 4.2, preAverage: 3.25, postAverage: 3.96, growth: 0.3 },
                { label: '데이터 이해', pre: 3.5, post: 4.0, preAverage: 3.18, postAverage: 3.88, growth: 0.5 },
                { label: 'AI 활용', pre: 3.6, post: 4.1, preAverage: 3.06, postAverage: 3.79, growth: 0.5 },
                { label: '컴퓨팅 사고력', pre: 3.8, post: 4.2, preAverage: 3.22, postAverage: 4.01, growth: 0.4 },
            ],
        },
        {
            traineeId: '0003',
            name: '최아',
            organization: '하늘고',
            trackLabel: 'AI·디지털 기본 과정',
            preOverall: 2.9,
            postOverall: 3.5,
            growth: 0.6,
            cohortGapPost: -0.45,
            competencies: [
                { label: '에듀테크 활용', pre: 2.8, post: 3.6, preAverage: 3.25, postAverage: 3.96, growth: 0.8 },
                { label: '데이터 이해', pre: 3.0, post: 3.4, preAverage: 3.18, postAverage: 3.88, growth: 0.4 },
                { label: 'AI 활용', pre: 2.7, post: 3.5, preAverage: 3.06, postAverage: 3.79, growth: 0.8 },
                { label: '컴퓨팅 사고력', pre: 3.1, post: 3.6, preAverage: 3.22, postAverage: 4.01, growth: 0.5 },
            ],
        },
    ],
    summary: {
        sourceFileName: 'mock-dataset.xlsx',
        sourceLabel: '기본 더미 데이터',
        importedAt: '2026-03-11T00:00:00.000Z',
        participantCount: 3,
        preAverage: 3.27,
        postAverage: 3.97,
        growthAverage: 0.7,
    },
};
