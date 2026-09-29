export const buildStudentPagination = (
  currentPage: number,
  totalPages: number,
): Array<number | "ellipsis"> => {
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, index) => index + 1);
  }

  const pages = new Set([1, totalPages - 1, totalPages]);
  const start = currentPage <= 4 ? 1 : currentPage - 1;
  const end = currentPage <= 4 ? Math.max(4, currentPage + 1) : currentPage + 1;
  for (let page = start; page <= end; page += 1) {
    if (page >= 1 && page <= totalPages) pages.add(page);
  }

  const sorted = [...pages].sort((left, right) => left - right);
  const items: Array<number | "ellipsis"> = [];
  sorted.forEach((page, index) => {
    if (index > 0 && page - sorted[index - 1] > 1) items.push("ellipsis");
    items.push(page);
  });
  return items;
};
