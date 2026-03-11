import * as XLSX from 'xlsx';
import type { DatasetSummary, ParticipantRecord } from '../types';

export const downloadParticipantReport = (participant: ParticipantRecord, summary: DatasetSummary) => {
    const workbook = XLSX.utils.book_new();

    const overviewSheet = XLSX.utils.aoa_to_sheet([
        ['항목', '값'],
        ['고유번호', participant.traineeId],
        ['이름', participant.name],
        ['소속', participant.organization],
        ['과정', participant.trackLabel],
        ['사전 평균', participant.preOverall],
        ['사후 평균', participant.postOverall],
        ['향상 폭', participant.growth],
        ['전체 사전 평균', summary.preAverage],
        ['전체 사후 평균', summary.postAverage],
        ['전체 평균 대비', participant.cohortGapPost],
        ['데이터 출처', summary.sourceFileName],
        ['분석 시각', summary.importedAt],
    ]);

    const competencySheet = XLSX.utils.json_to_sheet(
        participant.competencies.map((competency) => ({
            영역: competency.label,
            사전점수: competency.pre,
            사후점수: competency.post,
            향상폭: competency.growth,
            전체사전평균: competency.preAverage,
            전체사후평균: competency.postAverage,
        })),
    );

    XLSX.utils.book_append_sheet(workbook, overviewSheet, '개인 요약');
    XLSX.utils.book_append_sheet(workbook, competencySheet, '역량 상세');
    XLSX.writeFile(workbook, `연수결과_${participant.traineeId}_${participant.name}.xlsx`);
};
