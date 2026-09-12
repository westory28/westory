export const shouldHandoffLegacyLessonManagementMutation = () => true;

export const buildLegacyLessonManagementHandoffMessage = (
  actionLabel: string,
) => {
  const action = String(actionLabel || "이 변경").trim() || "이 변경";
  return `${action}은 현재 화면에서 안전하게 저장할 수 없습니다. 입력 내용은 저장되지 않았습니다.`;
};
