export interface CompetencyScore {
    label: string;
    pre: number;
    post: number;
    preAverage: number;
    postAverage: number;
    growth: number;
}

export interface ParticipantRecord {
    traineeId: string;
    name: string;
    organization: string;
    trackLabel: string;
    preOverall: number;
    postOverall: number;
    growth: number;
    cohortGapPost: number;
    competencies: CompetencyScore[];
}

export interface DatasetSummary {
    sourceFileName: string;
    sourceLabel: string;
    importedAt: string;
    participantCount: number;
    preAverage: number;
    postAverage: number;
    growthAverage: number;
}

export interface DashboardDataset {
    participants: ParticipantRecord[];
    sourceLabel: string;
    summary: DatasetSummary;
}

export interface AdviceBlock {
    title: string;
    summary: string;
    points: string[];
}
