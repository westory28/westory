import { onIdTokenChanged, type User } from "firebase/auth";
import { doc, onSnapshot } from "firebase/firestore";
import { auth, db } from "./firebase";
import { getHistoryDictionaryCallable } from "./historyDictionarySession";
import { ensureSensitiveOperation } from "./sensitiveOperation";
import { notifyPointsUpdated, subscribePointsUpdated } from "./appEvents";
import { watchStudentWisStockSession } from "./studentWisStockSession";
import type {
  StudentWisStockHistoryPage,
  StudentWisStockMutation,
  StudentWisStockState,
  WisStockLoad,
  WisStockScope,
} from "./studentWisStockTypes";

type Boundary = {
  owner: User;
  epoch: number;
  key: string;
  scope: WisStockScope;
};
type StateListener = (value: WisStockLoad<StudentWisStockState>) => void;
type StateEntry = {
  boundary: Boundary;
  listeners: Set<StateListener>;
  state: WisStockLoad<StudentWisStockState>;
  commands: number;
  seenRevision: number;
  apply: (state: StudentWisStockState) => void;
  refresh: () => void;
  dispose: () => void;
};
const entries = new Map<string, StateEntry>();
const reads = new Map<string, Promise<StudentWisStockState>>();
const commands = new Map<string, Promise<StudentWisStockMutation>>();
type PendingCommand = { requestId: string; fields: Record<string, unknown> };
const requestIds = new Map<string, PendingCommand>();
const changed = () =>
  new Error("로그인 상태가 바뀌었습니다. 화면을 다시 열어 주세요.");
async function boundary(scope: WisStockScope): Promise<Boundary> {
  const owner = auth.currentUser;
  if (!owner) throw changed();
  const epoch = Number((await owner.getIdTokenResult()).claims.auth_time);
  if (
    auth.currentUser !== owner ||
    !Number.isSafeInteger(epoch) ||
    epoch <= 0 ||
    !/^\d{4}$/.test(scope.year) ||
    !/^[12]$/.test(scope.semester)
  )
    throw changed();
  return {
    owner,
    epoch,
    scope,
    key: `${owner.uid}:${epoch}:${scope.year}:${scope.semester}`,
  };
}
async function check(b: Boundary) {
  if (
    auth.currentUser !== b.owner ||
    Number((await b.owner.getIdTokenResult()).claims.auth_time) !== b.epoch
  )
    throw changed();
}
async function invoke<T>(
  b: Boundary,
  name: string,
  fields: Record<string, unknown> = {},
): Promise<T> {
  await check(b);
  const call = await getHistoryDictionaryCallable<Record<string, unknown>, T>(
    name,
    {
      beforeDispatch: () => {
        if (auth.currentUser !== b.owner) throw changed();
      },
    },
  );
  const result = await call({ ...b.scope, ...fields });
  await check(b);
  return result.data;
}
function accept(value: StudentWisStockState, b: Boundary) {
  if (
    value?.semesterId !== `${b.scope.year}-${b.scope.semester}` ||
    !Number.isSafeInteger(value.account?.revision) ||
    !Number.isSafeInteger(value.account?.stockCash) ||
    !Number.isSafeInteger(value.account?.reservedCash) ||
    !Array.isArray(value.account.positions) ||
    !Array.isArray(value.account.pendingOrders) ||
    !Array.isArray(value.stocks) ||
    !Number.isSafeInteger(value.serverNowMs)
  )
    throw new Error("주식 지갑을 확인하지 못했습니다. 다시 시도해 주세요.");
  if (
    value.accountPath !== null &&
    !new RegExp(
      `^years/${b.scope.year}/semesters/${b.scope.semester}/wis_stock_accounts/wisacct_[a-f0-9]{64}$`,
    ).test(value.accountPath)
  )
    throw changed();
  return { ...value, clientReceivedAtMs: Date.now() };
}
async function readState(b: Boundary) {
  const existing = reads.get(b.key);
  if (existing) return existing;
  const task = invoke<StudentWisStockState>(b, "getStudentWisStockState")
    .then((value) => accept(value, b))
    .finally(() => {
      if (reads.get(b.key) === task) reads.delete(b.key);
    });
  reads.set(b.key, task);
  return task;
}
export function studentWisStockError(error: unknown) {
  const e = error as {
    code?: string;
    message?: string;
    details?: { reason?: string };
  };
  if (e.details?.reason === "WIS_STOCK_MARKET_CLOSED")
    return "위스피의 거래가 중지되었습니다.";
  if (
    e.details?.reason?.includes("SESSION") ||
    e.code?.includes("unauthenticated")
  )
    return "다시 로그인한 뒤 확인해 주세요.";
  if (e.code?.includes("permission-denied"))
    return "지금은 이 작업을 할 수 없습니다. 화면을 다시 열어 주세요.";
  return (
    e.message?.replace(/^Firebase:\s*/, "") ||
    "작업을 완료하지 못했습니다. 다시 시도해 주세요."
  );
}
export const studentWisStockNow = (state: StudentWisStockState) =>
  state.serverNowMs +
  Math.max(0, Date.now() - (state.clientReceivedAtMs ?? Date.now()));

export async function refreshStudentWisStockState(scope: WisStockScope) {
  const b = await boundary(scope);
  const entry = entries.get(b.key);
  if (!entry || entry.boundary.owner !== b.owner) return false;
  entry.refresh();
  return true;
}

/** One own-account listener shared by market and My Page; account revision changes refresh one scoped state request. */
export function watchStudentWisStockState(
  scope: WisStockScope,
  listener: StateListener,
) {
  let cancelled = false,
    detach = () => {};
  listener({ status: "loading", data: null, error: "" });
  void boundary(scope)
    .then((b) => {
      if (cancelled) return;
      let entry = entries.get(b.key);
      if (entry && entry.boundary.owner !== b.owner) {
        entry.dispose();
        entry = undefined;
      }
      if (!entry) {
        let stopped = false,
          generation = 0,
          path: string | null = null,
          stopSnapshot: (() => void) | undefined,
          stopAuth: (() => void) | undefined,
          stopPoints: (() => void) | undefined,
          stopSession: (() => void) | undefined;
        let sessionReady = false;
        let refreshing = false;
        let readGeneration = 0;
        const listeners = new Set<StateListener>();
        const send = (state: WisStockLoad<StudentWisStockState>) => {
          if (stopped) return;
          current.state = state;
          listeners.forEach((next) => next(state));
        };
        const disconnect = () => {
          generation++;
          stopSnapshot?.();
          stopSnapshot = undefined;
          path = null;
        };
        const fail = (error: unknown) => {
          readGeneration++;
          send({
            status: "error",
            data: null,
            error: studentWisStockError(error),
          });
          disconnect();
        };
        const syncListener = (next: StudentWisStockState) => {
          if (
            document.visibilityState === "hidden" ||
            navigator.onLine === false ||
            path === next.accountPath
          )
            return;
          disconnect();
          path = next.accountPath;
          if (!path) return;
          const turn = generation;
          stopSnapshot = onSnapshot(
            doc(db, path),
            { includeMetadataChanges: true },
            (snapshot) => {
              if (
                stopped ||
                turn !== generation ||
                auth.currentUser !== b.owner
              )
                return;
              if (
                snapshot.metadata.fromCache ||
                snapshot.metadata.hasPendingWrites
              )
                return;
              if (!snapshot.exists()) {
                if (
                  current.state.status !== "ready" ||
                  current.state.data.account.revision !== 0
                )
                  fail(new Error("주식 지갑을 다시 확인해 주세요."));
                return;
              }
              const revision = Number(snapshot.data().revision);
              if (!Number.isSafeInteger(revision)) {
                fail(new Error("주식 지갑을 확인하지 못했습니다."));
                return;
              }
              current.seenRevision = Math.max(current.seenRevision, revision);
              if (
                current.commands === 0 &&
                (current.state.status !== "ready" ||
                  revision > current.state.data.account.revision)
              )
                refresh();
            },
            fail,
          );
        };
        const apply = (next: StudentWisStockState) => {
          if (
            stopped ||
            !sessionReady ||
            document.visibilityState === "hidden" ||
            navigator.onLine === false ||
            auth.currentUser !== b.owner
          )
            return;
          if (
            current.state.status === "ready" &&
            next.account.revision < current.state.data.account.revision
          )
            return;
          send({ status: "ready", data: next, error: "" });
          syncListener(next);
        };
        const refresh = () => {
          if (
            stopped ||
            !sessionReady ||
            refreshing ||
            current.commands > 0 ||
            document.visibilityState === "hidden" ||
            navigator.onLine === false
          )
            return;
          refreshing = true;
          const turn = readGeneration;
          let failed = false;
          void readState(b)
            .then((next) => {
              if (turn === readGeneration) apply(next);
            })
            .catch((error) => {
              if (turn === readGeneration && sessionReady) {
                failed = true;
                fail(error);
              }
            })
            .finally(() => {
              refreshing = false;
              if (
                !stopped &&
                !failed &&
                (turn !== readGeneration ||
                  (current.state.status === "ready" &&
                    current.seenRevision > current.state.data.account.revision))
              )
                refresh();
            });
        };
        const reconnect = () => {
          readGeneration++;
          disconnect();
          if (
            document.visibilityState === "hidden" ||
            navigator.onLine === false
          ) {
            send({ status: "loading", data: null, error: "" });
            return;
          }
          refresh();
        };
        const dispose = () => {
          if (stopped) return;
          stopped = true;
          disconnect();
          stopAuth?.();
          stopPoints?.();
          stopSession?.();
          document.removeEventListener("visibilitychange", reconnect);
          window.removeEventListener("online", reconnect);
          window.removeEventListener("offline", reconnect);
          if (entries.get(b.key) === current) entries.delete(b.key);
        };
        const current: StateEntry = {
          boundary: b,
          listeners,
          state: { status: "loading", data: null, error: "" },
          commands: 0,
          seenRevision: 0,
          apply,
          refresh,
          dispose,
        };
        entry = current;
        entries.set(b.key, current);
        stopPoints = subscribePointsUpdated(refresh);
        stopAuth = onIdTokenChanged(auth, (user) => {
          if (stopped) return;
          if (user !== b.owner) {
            fail(changed());
            dispose();
            return;
          }
          void user
            .getIdTokenResult()
            .then((token) => {
              if (!stopped && Number(token.claims.auth_time) !== b.epoch) {
                fail(changed());
                dispose();
              }
            })
            .catch(fail);
        });
        document.addEventListener("visibilitychange", reconnect);
        window.addEventListener("online", reconnect);
        window.addEventListener("offline", reconnect);
        stopSession = watchStudentWisStockSession(b.owner, b.epoch, {
          allowed: () => {
            if (!sessionReady) {
              sessionReady = true;
              refresh();
            }
          },
          denied: (error) => {
            sessionReady = false;
            fail(error);
            dispose();
          },
          paused: () => {
            sessionReady = false;
            readGeneration++;
            disconnect();
            send({ status: "loading", data: null, error: "" });
          },
        });
        if (stopped) stopSession();
      }
      entry.listeners.add(listener);
      listener(entry.state);
      const chosen = entry;
      detach = () => {
        chosen.listeners.delete(listener);
        if (!chosen.listeners.size) chosen.dispose();
      };
    })
    .catch((error) => {
      if (!cancelled)
        listener({
          status: "error",
          data: null,
          error: studentWisStockError(error),
        });
    });
  return () => {
    cancelled = true;
    detach();
  };
}
async function mutate(
  scope: WisStockScope,
  name: string,
  fields: Record<string, unknown>,
  withRequestId = true,
) {
  const b = await boundary(scope);
  // An uncertain order retry must keep its original confirmed quote as well as its receipt id.
  const signature = (value: Record<string, unknown>) =>
    name === "placeStudentWisStockOrder"
      ? { stockId: value.stockId, side: value.side, quantity: value.quantity }
      : value;
  const bytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(JSON.stringify([b.key, name, signature(fields)])),
  );
  const key =
    "westory:student-wispi:" +
    Array.from(new Uint8Array(bytes), (v) =>
      v.toString(16).padStart(2, "0"),
    ).join("");
  const existing = commands.get(key);
  if (existing) return existing;
  const task = (async () => {
    await ensureSensitiveOperation();
    await check(b);
    let pending = requestIds.get(key);
    try {
      const saved = sessionStorage.getItem(key);
      if (!pending && saved && saved.length < 10_000)
        pending = JSON.parse(saved) as PendingCommand;
    } catch {}
    if (
      !pending ||
      !/^[A-Za-z0-9_-]{16,80}$/.test(pending.requestId) ||
      !pending.fields ||
      JSON.stringify(signature(pending.fields)) !==
        JSON.stringify(signature(fields))
    )
      pending = { requestId: crypto.randomUUID(), fields };
    if (withRequestId) {
      requestIds.set(key, pending);
      try {
        sessionStorage.setItem(key, JSON.stringify(pending));
      } catch {}
    }
    const entry = entries.get(b.key);
    if (entry) entry.commands++;
    try {
      const raw = await invoke<StudentWisStockMutation>(b, name, {
        ...(withRequestId ? pending.fields : fields),
        ...(withRequestId ? { requestId: pending.requestId } : {}),
      });
      const result = { ...raw, state: accept(raw.state, b) };
      entries.get(b.key)?.apply(result.state);
      requestIds.delete(key);
      try {
        sessionStorage.removeItem(key);
      } catch {}
      if (name === "transferStudentWisStock" && result.changed)
        notifyPointsUpdated();
      return result;
    } catch (error) {
      const reason =
        (error as { details?: { reason?: string } })?.details?.reason || "";
      // Receipts are checked before these deterministic validation failures on the server.
      if (
        [
          "WIS_STOCK_QUOTE_CHANGED",
          "WIS_STOCK_QUOTE_EXPIRED",
          "WIS_STOCK_INPUT_INVALID",
          "WIS_STOCK_TRADE_INPUT_INVALID",
          "WIS_STOCK_INSUFFICIENT_CASH",
          "WIS_STOCK_INSUFFICIENT_HOLDING",
          "WIS_STOCK_ORDER_LIMIT",
          "WIS_STOCK_DAILY_LIMIT",
          "WIS_STOCK_HOLDING_LIMIT",
          "WIS_STOCK_CONCENTRATION_LIMIT",
          "WIS_STOCK_COOLDOWN",
          "WIS_STOCK_ISSUED_LIMIT",
          "WIS_STOCK_MARKET_CLOSED",
          "WIS_STOCK_MARKET_HALTED",
          "WIS_STOCK_TRADING_CLOSED",
          "WIS_STOCK_INSTRUMENT_HALTED",
          "WIS_STOCK_SELL_ONLY",
          "WIS_STOCK_SLIPPAGE",
          "WIS_STOCK_UNSAFE_TOTAL",
        ].includes(reason)
      ) {
        requestIds.delete(key);
        try {
          sessionStorage.removeItem(key);
        } catch {}
      }
      throw error;
    } finally {
      if (entry) {
        entry.commands--;
        if (
          entry.state.status === "ready" &&
          entry.seenRevision > entry.state.data.account.revision
        )
          entry.refresh();
      }
    }
  })().finally(() => {
    if (commands.get(key) === task) commands.delete(key);
  });
  commands.set(key, task);
  return task;
}
export const transferStudentWisStock = (
  scope: WisStockScope,
  direction: "DEPOSIT" | "WITHDRAW",
  amount: number,
) => mutate(scope, "transferStudentWisStock", { direction, amount });
export const placeStudentWisStockOrder = (
  scope: WisStockScope,
  input: {
    stockId: string;
    side: "BUY" | "SELL";
    quantity: number;
    quote: { price: number; atMs: number; marketRevision: number };
  },
) => mutate(scope, "placeStudentWisStockOrder", input);
export const cancelStudentWisStockOrder = (
  scope: WisStockScope,
  orderId: string,
) => mutate(scope, "cancelStudentWisStockOrder", { orderId }, false);
export async function getStudentWisStockHistory(
  scope: WisStockScope,
  cursor = "",
) {
  const b = await boundary(scope);
  const result = await invoke<StudentWisStockHistoryPage>(
    b,
    "getStudentWisStockHistory",
    { cursor, limit: 20 },
  );
  if (
    result?.semesterId !== `${scope.year}-${scope.semester}` ||
    !Array.isArray(result.entries) ||
    typeof result.nextCursor !== "string" ||
    typeof result.hasMore !== "boolean"
  )
    throw new Error("내역을 확인하지 못했습니다. 다시 시도해 주세요.");
  return result;
}
