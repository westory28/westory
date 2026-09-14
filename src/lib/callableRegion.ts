const DATABASE_LOCAL_READ_PROJECTS = new Set([
  "history-quiz-yongsin",
  "westory-staging-177587430482",
]);

const DATABASE_LOCAL_READ_CALLABLES = new Set([
  "getWisEconomyState",
  "getArchiveEnrollmentState",
  "getW8DomainState",
  "getSemesterCoreState",
]);

/** Only these deployed read replicas follow the nam5 database location. */
export const resolveCallableRegion = ({
  projectId,
  callableName,
  defaultRegion,
  emulatorEnabled,
}: {
  projectId: string;
  callableName?: string;
  defaultRegion: string;
  emulatorEnabled: boolean;
}): string =>
  !emulatorEnabled &&
  DATABASE_LOCAL_READ_PROJECTS.has(projectId) &&
  DATABASE_LOCAL_READ_CALLABLES.has(callableName || "")
    ? "us-central1"
    : defaultRegion;
