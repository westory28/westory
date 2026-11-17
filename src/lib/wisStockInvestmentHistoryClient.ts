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
}
interface HistoryScope {
  year: string;
  semester: string;
  grade: string;
  classNumber: string;
  studentKey: string;
}
const flights = new Map<string, Promise<WisStockInvestmentHistory>>();
const ownerChanged = () =>
  new Error("로그인 상태가 바뀌었습니다. 다시 조회해 주세요.");

/** Only in-flight sharing: no financial history retained across owners or sessions. */
export async function getWisStockInvestmentHistory(scope: HistoryScope) {
  const owner = auth.currentUser;
  if (!owner) throw ownerChanged();
  const epoch = Number((await owner.getIdTokenResult()).claims.auth_time);
  if (auth.currentUser !== owner || !Number.isSafeInteger(epoch) || epoch <= 0)
    throw ownerChanged();
  const key = JSON.stringify([owner.uid, epoch, scope]);
  const existing = flights.get(key);
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
    if (
      !data ||
      data.semesterId !== `${scope.year}-${scope.semester}` ||
      data.studentKey !== scope.studentKey ||
      (scope.grade &&
        (data.grade !== scope.grade ||
          data.classNumber !== scope.classNumber)) ||
      !Number.isSafeInteger(data.asOfMs) ||
      data.asOfMs <= 0 ||
      data.asOfMs > 8_640_000_000_000_000 ||
      !Number.isSafeInteger(data.sourceRevision) ||
      data.sourceRevision < 0 ||
      !Number.isSafeInteger(data.priceRevision) ||
      data.priceRevision < 0 ||
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
    return data;
  })().finally(() => {
    if (flights.get(key) === task) flights.delete(key);
  });
  flights.set(key, task);
  return task;
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
