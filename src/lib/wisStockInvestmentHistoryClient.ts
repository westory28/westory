import { auth } from "./firebase";
import { getHistoryDictionaryCallable } from "./historyDictionarySession";
export interface WisStockReturnObservation {
  atMs: number;
  holdingValue: number | null;
  holdingCostBasis: number | null;
}

export interface WisStockInvestmentHistory {
  semesterId: string;
  studentKey: string;
  grade: string;
  classNumber: string;
  asOfMs: number;
  sourceRevision: number;
  priceRevision: number;
  points: WisStockReturnObservation[];
  incompleteBeforeMs: number | null;
  holdings: { stockId: string; name: string; quantity: number }[];
}
interface HistoryScope {
  year: string;
  semester: string;
  grade: string;
  classNumber: string;
  studentKey: string;
}
type HistoryFlights = Map<string, Promise<WisStockInvestmentHistory>>;
type HistoryOwner = NonNullable<typeof auth.currentUser>;
const flights = new WeakMap<HistoryOwner, HistoryFlights>();
const ownerChanged = () =>
  new Error("로그인 상태가 바뀌었습니다. 다시 조회해 주세요.");

/** Only in-flight sharing: no financial history retained across owners or sessions. */
export async function getWisStockInvestmentHistory(scope: HistoryScope) {
  const owner = auth.currentUser;
  if (!owner) throw ownerChanged();
  const epoch = Number((await owner.getIdTokenResult()).claims.auth_time);
  if (auth.currentUser !== owner || !Number.isSafeInteger(epoch) || epoch <= 0)
    throw ownerChanged();
  const ownerFlights: HistoryFlights = flights.get(owner) || new Map();
  flights.set(owner, ownerFlights);
  const key = JSON.stringify([owner.uid, epoch, scope]);
  const existing = ownerFlights.get(key);
  if (existing) return existing;
  const task = (async () => {
    const call = await getHistoryDictionaryCallable<
      HistoryScope,
      WisStockInvestmentHistory
    >("getWisStockInvestmentHistory", {
      beforeDispatch: () => {
        if (auth.currentUser !== owner) throw ownerChanged();
      },
    });
    const { data } = await call(scope);
    if (
      auth.currentUser !== owner ||
      Number((await owner.getIdTokenResult()).claims.auth_time) !== epoch
    )
      throw ownerChanged();
    validateHistory(data, scope);
    return data;
  })().finally(() => {
    if (ownerFlights.get(key) === task) ownerFlights.delete(key);
  });
  ownerFlights.set(key, task);
  return task;
}

function validateHistory(data: WisStockInvestmentHistory, scope: HistoryScope) {
  if (
    !data ||
    data.semesterId !== `${scope.year}-${scope.semester}` ||
    data.studentKey !== scope.studentKey ||
    (scope.grade &&
      (data.grade !== scope.grade || data.classNumber !== scope.classNumber)) ||
    !Number.isSafeInteger(data.asOfMs) ||
    data.asOfMs <= 0 ||
    data.asOfMs > 8_640_000_000_000_000 ||
    !Number.isSafeInteger(data.sourceRevision) ||
    data.sourceRevision < 0 ||
    !Number.isSafeInteger(data.priceRevision) ||
    data.priceRevision < 0 ||
    !Array.isArray(data.holdings) ||
    data.holdings.some(
      (holding) =>
        !holding ||
        !/^stock_[a-f0-9]{24}$/.test(holding.stockId) ||
        typeof holding.name !== "string" ||
        !holding.name.trim() ||
        !Number.isSafeInteger(holding.quantity) ||
        holding.quantity <= 0,
    ) ||
    new Set(data.holdings.map((holding) => holding.stockId)).size !==
      data.holdings.length ||
    (data.incompleteBeforeMs !== null &&
      (!Number.isSafeInteger(data.incompleteBeforeMs) ||
        data.incompleteBeforeMs <= 0 ||
        data.incompleteBeforeMs > data.asOfMs)) ||
    !Array.isArray(data.points) ||
    data.points.some(
      (point) =>
        !Number.isSafeInteger(point.atMs) ||
        point.atMs <= 0 ||
        point.atMs > data.asOfMs ||
        !(
          (point.holdingValue === null && point.holdingCostBasis === null) ||
          (typeof point.holdingValue === "number" &&
            Number.isSafeInteger(point.holdingValue) &&
            point.holdingValue >= 0 &&
            typeof point.holdingCostBasis === "number" &&
            Number.isSafeInteger(point.holdingCostBasis) &&
            point.holdingCostBasis >= 0)
        ),
    )
  )
    throw new Error(
      "수익률 기록의 범위를 확인하지 못했습니다. 다시 조회해 주세요.",
    );
}

interface HistoriesScope extends Omit<HistoryScope, "studentKey"> {
  studentKeys: string[];
}
const studentFlights = new WeakMap<HistoryOwner, HistoryFlights>();
/** Share overlapping pending students in this exact scope, never completed history. */
export async function getWisStockInvestmentHistories(
  scope: HistoriesScope,
  observedVersions: Readonly<Record<string, string>> = {},
) {
  if (
    !Array.isArray(scope.studentKeys) ||
    !scope.studentKeys.length ||
    scope.studentKeys.length > 5 ||
    new Set(scope.studentKeys).size !== scope.studentKeys.length ||
    scope.studentKeys.some((key) => !/^student_[a-f0-9]{24}$/.test(key))
  )
    throw new Error("수익률 조회 대상을 확인해 주세요.");
  const owner = auth.currentUser;
  if (!owner) throw ownerChanged();
  const epoch = Number((await owner.getIdTokenResult()).claims.auth_time);
  if (auth.currentUser !== owner || !Number.isSafeInteger(epoch) || epoch <= 0)
    throw ownerChanged();
  const ownerFlights: HistoryFlights = studentFlights.get(owner) || new Map();
  studentFlights.set(owner, ownerFlights);
  const input = { ...scope, studentKeys: [...scope.studentKeys].sort() };
  const flightKey = (studentKey: string) =>
    JSON.stringify([
      owner.uid,
      epoch,
      input.year,
      input.semester,
      input.grade,
      input.classNumber,
      studentKey,
      observedVersions[studentKey] || "",
    ]);
  const missing = input.studentKeys.filter(
    (studentKey) => !ownerFlights.has(flightKey(studentKey)),
  );
  if (!missing.length)
    return Promise.all(
      input.studentKeys.map(
        (studentKey) => ownerFlights.get(flightKey(studentKey))!,
      ),
    );
  const request = { ...input, studentKeys: missing };
  const task = (async () => {
    const call = await getHistoryDictionaryCallable<
      HistoriesScope,
      {
        semesterId: string;
        histories: WisStockInvestmentHistory[];
      }
    >("getWisStockInvestmentHistory", {
      beforeDispatch: () => {
        if (auth.currentUser !== owner) throw ownerChanged();
      },
    });
    const { data } = await call(request);
    if (
      auth.currentUser !== owner ||
      Number((await owner.getIdTokenResult()).claims.auth_time) !== epoch
    )
      throw ownerChanged();
    if (
      !data ||
      data.semesterId !== `${scope.year}-${scope.semester}` ||
      !Array.isArray(data.histories) ||
      data.histories.length !== request.studentKeys.length ||
      new Set(data.histories.map((item) => item?.studentKey)).size !==
        request.studentKeys.length ||
      data.histories.some(
        (item) => !item || !request.studentKeys.includes(item.studentKey),
      )
    )
      throw new Error(
        "수익률 기록의 범위를 확인하지 못했습니다. 다시 조회해 주세요.",
      );
    data.histories.forEach((item) =>
      validateHistory(item, { ...scope, studentKey: item.studentKey }),
    );
    return data.histories;
  })();
  missing.forEach((studentKey) => {
    const key = flightKey(studentKey);
    const flight = task
      .then(
        (histories) =>
          histories.find((history) => history.studentKey === studentKey)!,
      )
      .finally(() => {
        if (ownerFlights.get(key) === flight) ownerFlights.delete(key);
      });
    ownerFlights.set(key, flight);
  });
  return Promise.all(
    input.studentKeys.map(
      (studentKey) => ownerFlights.get(flightKey(studentKey))!,
    ),
  );
}

export function wisStockInvestmentHistoryError(error: unknown) {
  const failure = error as { code?: string; details?: { reason?: string } };
  if (
    /permission-denied|unauthenticated|SESSION/.test(
      `${failure?.code} ${failure?.details?.reason}`,
    )
  )
    return "수익률 기록 조회 권한이나 로그인 상태를 확인해 주세요.";
  return "수익률 기록을 불러오지 못했습니다. 다시 시도해 주세요.";
}
