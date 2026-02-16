import { SystemConfig } from '../types';

type ConfigLike = Pick<SystemConfig, 'year' | 'semester'> | null | undefined;

const DEFAULT_YEAR = '2026';
const DEFAULT_SEMESTER = '1';

export const getYearSemester = (config: ConfigLike) => ({
    year: config?.year || DEFAULT_YEAR,
    semester: config?.semester || DEFAULT_SEMESTER,
});

export const getSemesterCollectionPath = (config: ConfigLike, collectionName: string) => {
    const { year, semester } = getYearSemester(config);
    return `years/${year}/semesters/${semester}/${collectionName}`;
};

export const getSemesterDocPath = (config: ConfigLike, collectionName: string, docId: string) => {
    return `${getSemesterCollectionPath(config, collectionName)}/${docId}`;
};
