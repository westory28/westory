export const getDefaultSemesterDates = (schoolYear: string, term: string) => {
  if (!/^\d{4}$/.test(schoolYear) || !["1", "2"].includes(term)) {
    return { startAt: "", endAt: "" };
  }
  const year = Number(schoolYear);
  if (term === "1") {
    return { startAt: `${schoolYear}-03-01`, endAt: `${schoolYear}-08-31` };
  }
  const nextYear = year + 1;
  const leap =
    nextYear % 4 === 0 && (nextYear % 100 !== 0 || nextYear % 400 === 0);
  return {
    startAt: `${schoolYear}-09-01`,
    endAt: `${nextYear}-02-${leap ? "29" : "28"}`,
  };
};
