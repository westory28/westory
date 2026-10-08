import { auth } from "./firebase";
import {
  assertWisOwner,
  queryWisState,
  wisSemesterId,
  wisWallet,
  wisTransaction,
  wisProducts,
  wisOrder,
  wisHallOfFame,
  type WisConfig,
  type WisState,
} from "./wisEconomyClient";

const flights = new Map<string, Promise<WisState>>();
// Read the same own-account ledger used by attendance. Never fall back to the
// retired point_wallets when the authoritative query fails.
export const getStudentWisState = async (
  config: WisConfig,
  projection = "student-core",
  uid = auth.currentUser?.uid || "",
): Promise<WisState> => {
  assertWisOwner(uid);
  const user = auth.currentUser!;
  const epoch = Number((await user.getIdTokenResult()).claims.auth_time);
  if (auth.currentUser !== user || !Number.isFinite(epoch))
    throw new Error("로그인 상태가 바뀌었습니다.");
  const key = `${uid}:${epoch}:${wisSemesterId(config)}:${projection}`;
  const pending = flights.get(key);
  if (pending) return pending;
  const flight = (async () => {
    const data = await queryWisState(config, "student", projection);
    if (
      auth.currentUser !== user ||
      (data.account && data.account.studentUid !== uid)
    )
      throw new Error("로그인 계정이 바뀌었습니다.");
    return data;
  })();
  flights.set(key, flight);
  try {
    return await flight;
  } finally {
    if (flights.get(key) === flight) flights.delete(key);
  }
};
export const getStudentPointWallet = async (config: WisConfig, uid: string) => {
  const { account } = await getStudentWisState(config, "student-core", uid);
  return account ? wisWallet(account) : null;
};
export const listStudentPointTransactions = async (
  config: WisConfig,
  uid: string,
  limitCount = 100,
) =>
  (await getStudentWisState(config, "student-core", uid)).ledger
    .slice(0, limitCount)
    .map((entry) => wisTransaction(entry, uid));
export const listStudentPointProducts = async (
  config: WisConfig,
  _activeOnly = true,
) => wisProducts(await getStudentWisState(config, "catalog"), true);
export const listStudentPointOrders = async (
  config: WisConfig,
  options?: { uid?: string; limitCount?: number },
) => {
  const state = await getStudentWisState(config, "orders", options?.uid);
  return state.orders
    .slice(0, options?.limitCount || 100)
    .map((order) => wisOrder(order, state.account));
};
export const getStudentPointHallOfFame = async (config: WisConfig) =>
  wisHallOfFame(await getStudentWisState(config, "hall-of-fame"));
