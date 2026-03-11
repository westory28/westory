import * as XLSX from 'xlsx';
import { mockDataset } from '../data/mockDataset';
import type { AdviceBlock, CompetencyScore, DashboardDataset, ParticipantRecord } from '../types';

type GenericRow = Record<string, unknown>;

const PRE_SHEET_CANDIDATES = ['사전 설문', '사전', 'pre'];
const POST_SHEET_CANDIDATES = ['사후 설문', '사후', 'post'];
const ID_HEADER_CANDIDATES = ['고유번호', '고유 번호', '전화번호', 'id'];
const NAME_HEADER_CANDIDATES = ['이름', '성명', 'name'];
const ORG_HEADER_CANDIDATES = ['학교명', '학교', '소속', '기관명'];
const TRACK_HEADER_CANDIDATES = ['연수과정명', '과정명', '과정', 'track'];
const OVERALL_HEADER_CANDIDATES = ['전체 평균', '개인 평균', 'overall', 'overall average', '사전 평균', '사후 평균'];

const normalizeHeader = (value: unknown) => String(value ?? '').replace(/\s+/g, '').toLowerCase();

const findSheetName = (sheetNames: string[], candidates: string[]) =>
    sheetNames.find((name) => candidates.some((candidate) => normalizeHeader(name).includes(normalizeHeader(candidate))));

const findHeaderKey = (row: GenericRow, candidates: string[]) => {
    const keys = Object.keys(row);
    return keys.find((key) =>
        candidates.some((candidate) => {
            const normalizedKey = normalizeHeader(key);
            const normalizedCandidate = normalizeHeader(candidate);
            return normalizedKey === normalizedCandidate || normalizedKey.includes(normalizedCandidate);
        }),
    );
};

const toNumber = (value: unknown): number | null => {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    const parsed = Number(String(value ?? '').replace(/[^0-9.-]/g, ''));
    return Number.isFinite(parsed) ? parsed : null;
};

const round = (value: number) => Math.round(value * 100) / 100;

const normalizeId = (value: unknown): string => {
    const digits = String(value ?? '').replace(/\D/g, '');
    return digits ? digits.slice(-4).padStart(4, '0') : '';
};

const average = (values: number[]) => {
    if (values.length === 0) return 0;
    return round(values.reduce((sum, value) => sum + value, 0) / values.length);
};

const cleanName = (value: unknown, fallbackIndex: number) => {
    const koreanOnly = String(value ?? '').replace(/[^가-힣]/g, '').slice(0, 2);
    return koreanOnly || `연수${String(fallbackIndex + 1).padStart(2, '0')}`;
};

const getCompetencyColumns = (row: GenericRow) =>
    Object.keys(row).filter((key) => {
        const normalized = normalizeHeader(key);
        return normalized.includes(normalizeHeader('평균')) && !OVERALL_HEADER_CANDIDATES.some((candidate) => normalized.includes(normalizeHeader(candidate)));
    });

const cleanCompetencyLabel = (header: string) =>
    header
        .replace(/\s*평균\s*/g, '')
        .replace(/\s+/g, ' ')
        .trim();

const buildMatchKey = (row: GenericRow, index: number) => {
    const idKey = findHeaderKey(row, ID_HEADER_CANDIDATES);
    const nameKey = findHeaderKey(row, NAME_HEADER_CANDIDATES);
    const orgKey = findHeaderKey(row, ORG_HEADER_CANDIDATES);

    const id = normalizeId(idKey ? row[idKey] : '');
    if (id) return `id:${id}`;

    const name = String(nameKey ? row[nameKey] ?? '' : '').trim();
    const organization = String(orgKey ? row[orgKey] ?? '' : '').trim();
    if (name || organization) return `person:${name}|${organization}`;

    return `row:${index}`;
};

const parsePrePostWorkbook = (workbook: XLSX.WorkBook, fileName: string): DashboardDataset => {
    const preSheetName = findSheetName(workbook.SheetNames, PRE_SHEET_CANDIDATES);
    const postSheetName = findSheetName(workbook.SheetNames, POST_SHEET_CANDIDATES);

    if (!preSheetName || !postSheetName) {
        throw new Error('사전 설문과 사후 설문 시트를 찾지 못했습니다.');
    }

    const preRows = XLSX.utils.sheet_to_json<GenericRow>(workbook.Sheets[preSheetName], { defval: '' });
    const postRows = XLSX.utils.sheet_to_json<GenericRow>(workbook.Sheets[postSheetName], { defval: '' });

    if (preRows.length === 0 || postRows.length === 0) {
        throw new Error('사전 또는 사후 시트에 읽을 데이터가 없습니다.');
    }

    const preMap = new Map(preRows.map((row, index) => [buildMatchKey(row, index), row]));
    const postMap = new Map(postRows.map((row, index) => [buildMatchKey(row, index), row]));
    const keys = Array.from(new Set([...preMap.keys(), ...postMap.keys()]));

    const participants: ParticipantRecord[] = keys
        .map((key, index) => {
            const preRow = preMap.get(key);
            const postRow = postMap.get(key);
            if (!preRow || !postRow) return null;

            const preOverallKey = findHeaderKey(preRow, OVERALL_HEADER_CANDIDATES);
            const postOverallKey = findHeaderKey(postRow, OVERALL_HEADER_CANDIDATES);
            const nameKey = findHeaderKey(postRow, NAME_HEADER_CANDIDATES) ?? findHeaderKey(preRow, NAME_HEADER_CANDIDATES);
            const orgKey = findHeaderKey(postRow, ORG_HEADER_CANDIDATES) ?? findHeaderKey(preRow, ORG_HEADER_CANDIDATES);
            const idKey = findHeaderKey(postRow, ID_HEADER_CANDIDATES) ?? findHeaderKey(preRow, ID_HEADER_CANDIDATES);
            const trackKey = findHeaderKey(postRow, TRACK_HEADER_CANDIDATES) ?? findHeaderKey(preRow, TRACK_HEADER_CANDIDATES);

            const preOverall = toNumber(preOverallKey ? preRow[preOverallKey] : '');
            const postOverall = toNumber(postOverallKey ? postRow[postOverallKey] : '') ?? preOverall;

            if (preOverall === null || postOverall === null) return null;

            const competencyHeaders = Array.from(new Set([...getCompetencyColumns(preRow), ...getCompetencyColumns(postRow)]));
            const competencies: CompetencyScore[] = competencyHeaders
                .map((header) => {
                    const pre = toNumber(preRow[header]);
                    const post = toNumber(postRow[header]) ?? pre;
                    if (pre === null || post === null) return null;

                    return {
                        label: cleanCompetencyLabel(header),
                        pre,
                        post,
                        preAverage: 0,
                        postAverage: 0,
                        growth: round(post - pre),
                    };
                })
                .filter((item): item is CompetencyScore => item !== null);

            return {
                traineeId: normalizeId(idKey ? postRow[idKey] ?? preRow[idKey] : '') || String(index + 1).padStart(4, '0'),
                name: cleanName(nameKey ? postRow[nameKey] ?? preRow[nameKey] : '', index),
                organization: String(orgKey ? postRow[orgKey] ?? preRow[orgKey] ?? '' : '').trim() || '소속 미입력',
                trackLabel: String(trackKey ? postRow[trackKey] ?? preRow[trackKey] ?? '' : '').trim() || '연수 과정',
                preOverall,
                postOverall,
                growth: round(postOverall - preOverall),
                cohortGapPost: 0,
                competencies,
            };
        })
        .filter((item): item is ParticipantRecord => item !== null);

    if (participants.length === 0) {
        throw new Error('사전과 사후 데이터를 연결하지 못했습니다. 이름 또는 번호 열을 확인해 주세요.');
    }

    const cohortPostAverage = average(participants.map((participant) => participant.postOverall));
    const competencyLabels = Array.from(new Set(participants.flatMap((participant) => participant.competencies.map((item) => item.label))));
    const competencyAverages = new Map<string, { preAverage: number; postAverage: number }>();

    competencyLabels.forEach((label) => {
        const preValues = participants
            .map((participant) => participant.competencies.find((item) => item.label === label)?.pre ?? null)
            .filter((value): value is number => value !== null);
        const postValues = participants
            .map((participant) => participant.competencies.find((item) => item.label === label)?.post ?? null)
            .filter((value): value is number => value !== null);

        competencyAverages.set(label, {
            preAverage: average(preValues),
            postAverage: average(postValues),
        });
    });

    const normalizedParticipants = participants.map((participant) => ({
        ...participant,
        cohortGapPost: round(participant.postOverall - cohortPostAverage),
        competencies: participant.competencies.map((competency) => ({
            ...competency,
            preAverage: competencyAverages.get(competency.label)?.preAverage ?? 0,
            postAverage: competencyAverages.get(competency.label)?.postAverage ?? 0,
        })),
    }));

    return {
        participants: normalizedParticipants,
        sourceLabel: fileName,
        summary: {
            sourceFileName: fileName,
            sourceLabel: fileName,
            importedAt: new Date().toISOString(),
            participantCount: normalizedParticipants.length,
            preAverage: average(normalizedParticipants.map((participant) => participant.preOverall)),
            postAverage: cohortPostAverage,
            growthAverage: average(normalizedParticipants.map((participant) => participant.growth)),
        },
    };
};

export const loadMockDataset = (): DashboardDataset => mockDataset;

export const loadDatasetFromWorkbook = async (file: File): Promise<DashboardDataset> => {
    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(buffer, { type: 'array' });
    return parsePrePostWorkbook(workbook, file.name);
};

export const getAdviceForParticipant = (participant: ParticipantRecord): AdviceBlock => {
    const { postOverall, growth, cohortGapPost } = participant;

    if (postOverall >= 4.5 && growth >= 0.6) {
        return {
            title: '확장 실천 단계',
            summary: '사후 점수와 성장 폭이 모두 높습니다. 강점을 수업 적용 사례로 연결해 확산하기 좋은 상태입니다.',
            points: [
                '효과가 있었던 연수 활동 1가지를 정리해 동료와 공유해 보세요.',
                '현재 강점 영역을 실제 수업 설계나 학교 운영과 연결하면 성과가 더 선명해집니다.',
                '다음 연수에서는 강점을 유지하면서 약한 영역 1개를 보완하는 방식이 좋습니다.',
            ],
        };
    }

    if (postOverall >= 4 && growth >= 0.3) {
        return {
            title: '안정 성장 단계',
            summary: '사전 대비 향상이 확인되고 있으며, 연수 효과가 비교적 안정적으로 반영된 상태입니다.',
            points: [
                '사후 점수가 오른 이유를 실제 실천 경험과 연결해 짧게 기록해 보세요.',
                '전체 평균과의 간격이 작다면 다음 목표를 더 구체적인 실천 단위로 정하는 것이 좋습니다.',
                '잘 된 요소 하나를 바로 수업 계획에 넣으면 성장 흐름이 이어집니다.',
            ],
        };
    }

    if (growth > 0) {
        return {
            title: '기초 향상 단계',
            summary: '성장은 있었지만 아직 더 끌어올릴 여지가 있습니다. 성공 경험을 반복해 자신감을 쌓는 것이 좋습니다.',
            points: [
                '가장 많이 오른 영역을 먼저 강점으로 보고, 나머지 영역은 한 번에 하나씩 보완해 보세요.',
                '실습이나 적용 경험이 부족했다면 다음 연수에서 직접 실행 과제를 잡는 편이 좋습니다.',
                '전체 평균보다 낮더라도 개선 흐름이 있다는 점을 기준으로 다음 목표를 잡아 보세요.',
            ],
        };
    }

    if (cohortGapPost < 0) {
        return {
            title: '집중 보완 단계',
            summary: '사후 점수가 전체 평균보다 낮아 추가 지원이 필요한 구간입니다. 부담이 적은 실천 계획이 중요합니다.',
            points: [
                '이해가 어려웠던 영역이 있다면 문항 이해, 실습 경험, 시간 부족 중 무엇이 원인인지 먼저 좁혀 보세요.',
                '모든 영역을 한 번에 끌어올리기보다 핵심 역량 1개를 정해 짧은 계획으로 시작하는 편이 효과적입니다.',
                '후속 연수 자료에서는 체크리스트형 안내나 예시 중심 지원이 도움이 됩니다.',
            ],
        };
    }

    return {
        title: '유지 점검 단계',
        summary: '큰 변화는 아니지만 현재 수준을 점검하고 다음 목표를 정리하기에 적절한 상태입니다.',
        points: [
            '점수 변화가 작을 때는 학습량보다 실제 적용 기회를 늘려 보는 것이 좋습니다.',
            '사전과 사후 차이를 만든 활동이 무엇이었는지 짧게 정리해 다음 계획에 반영해 보세요.',
            '현재 결과를 기준선으로 삼아 다음 연수 목표 점수를 정하면 추적 관리가 쉬워집니다.',
        ],
    };
};
