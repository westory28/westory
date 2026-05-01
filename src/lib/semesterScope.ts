import { SystemConfig } from "../types";

type ConfigLike = Pick<SystemConfig, "year" | "semester"> | null | undefined;

const DEFAULT_YEAR = "2026";
const DEFAULT_SEMESTER = "1";

export const getYearSemester = (config: ConfigLike) => ({
  year: config?.year || DEFAULT_YEAR,
  semester: config?.semester || DEFAULT_SEMESTER,
});

export const getSameYearSemesterCandidates = (config: ConfigLike) => {
  const { year, semester } = getYearSemester(config);
  const semesters = [semester, DEFAULT_SEMESTER, "2"];
  return Array.from(new Set(semesters.filter(Boolean))).map((item) => ({
    year,
    semester: item,
  }));
};

export const getSemesterCollectionPath = (
  config: ConfigLike,
  collectionName: string,
) => {
  const { year, semester } = getYearSemester(config);
  return `years/${year}/semesters/${semester}/${collectionName}`;
};

export const getSemesterDocPath = (
  config: ConfigLike,
  collectionName: string,
  docId: string,
) => {
  return `${getSemesterCollectionPath(config, collectionName)}/${docId}`;
};
