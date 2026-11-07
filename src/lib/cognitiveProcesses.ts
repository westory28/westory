/** New arrays take precedence, including an explicitly cleared selection. */
export function getQuestionCognitiveProcesses(value: {
  cognitiveProcess?: unknown;
  cognitiveProcesses?: unknown;
}): string[] {
  const source = Array.isArray(value.cognitiveProcesses)
    ? value.cognitiveProcesses
    : value.cognitiveProcesses === undefined
      ? [value.cognitiveProcess]
      : [];
  return [
    ...new Set(
      source
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ];
}
