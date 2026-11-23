import { onIdTokenChanged, type User } from "firebase/auth";
import { doc, onSnapshot } from "firebase/firestore";
import { auth, db } from "./firebase";
import { getHistoryDictionaryCallable } from "./historyDictionarySession";
import { ensureWestoryAppCheck } from "./appCheck";
import { notifyPointsUpdated, subscribePointsUpdated } from "./appEvents";
import {
  retryStudentWisStockSession,
  watchStudentWisStockSession,
} from "./studentWisStockSession";
import { withStudentWisStockReadRetry } from "./studentWisStockReadRetry";
import type {
  StudentWisStockBonus,
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
  historyReads: Map<string, Promise<StudentWisStockHistoryPage>>;
  apply: (state: StudentWisStockState) => void;
  refresh: () => void;
  dispose: () => void;
};
const entries = new Map<string, StateEntry>();
const reads = new WeakMap<User, Map<string, Promise<StudentWisStockState>>>();
const bonusReads = new WeakMap<
  User,
  Map<string, Promise<StudentWisStockBonus>>
>();
function invalidateDetails(entry: StateEntry) {
  entry.historyReads.clear();
  bonusReads.get(entry.boundary.owner)?.delete(entry.boundary.key);
}
type CommandEntry = {
  flight?: Promise<StudentWisStockMutation>;
  pendingKey?: string;
};
const commands = new WeakMap<User, Map<string, CommandEntry>>();
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
  const token = await b.owner.getIdTokenResult();
  if (
    auth.currentUser !== b.owner ||
    Number(token.claims.auth_time) !== b.epoch
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
  const ownerReads =
    reads.get(b.owner) || new Map<string, Promise<StudentWisStockState>>();
  reads.set(b.owner, ownerReads);
  const existing = ownerReads.get(b.key);
  if (existing) return existing;
  const task = withStudentWisStockReadRetry(
    () => invoke<StudentWisStockState>(b, "getStudentWisStockState"),
    undefined,
    () =>
      auth.currentUser === b.owner &&
      entries.has(b.key) &&
      document.visibilityState !== "hidden",
  )
    .then((value) => accept(value, b))
    .finally(() => {
      if (ownerReads.get(b.key) === task) ownerReads.delete(b.key);
    });
  ownerReads.set(b.key, task);
  return task;
}
export function studentWisStockError(error: unknown) {
  const e = error as {
    code?: string;
    message?: string;
    details?: { reason?: string };
  };
  const code = typeof e.code === "string" ? e.code : "";
  if (e.details?.reason === "WIS_STOCK_MARKET_CLOSED")
    return "위스피의 거래가 중지되었습니다.";
  if (e.details?.reason === "WIS_STOCK_CAMPAIGN_INELIGIBLE")
    return "주식 지갑에 누적 500위스를 입금한 뒤 받아 주세요.";
  if (e.details?.reason === "WIS_STOCK_CAMPAIGN_DISABLED")
    return "현재 이벤트 지원금을 받을 수 없습니다.";
  if (e.details?.reason === "WIS_STOCK_BONUS_RESTRICTION_PENDING")
    return "이벤트 지원금 내역을 확인하고 있습니다. 잠시 후 잔액을 새로고침해 주세요.";
  if (e.details?.reason === "WIS_STOCK_WITHDRAWAL_LIMIT")
    return "출금 가능한 금액을 확인해 주세요. 예약된 위스와 이벤트 지원금 원금은 출금할 수 없습니다.";
  if (
    e.details?.reason?.includes("SESSION") ||
    code.includes("unauthenticated")
  )
    return "다시 로그인한 뒤 확인해 주세요.";
  if (code.includes("permission-denied"))
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
          invalidateDetails(current);
          stopSnapshot?.();
          stopSnapshot = undefined;
          path = null;
        };
        const fail = (error: unknown) => {
          if (stopped) return;
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
                current.state.status !== "ready" ||
                revision > current.state.data.account.revision
              )
                invalidateDetails(current);
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
          if (
            current.state.status !== "ready" ||
            next.account.revision !== current.state.data.account.revision
          )
            invalidateDetails(current);
          send({ status: "ready", data: next, error: "" });
          syncListener(next);
        };
        const refresh = () => {
          if (!stopped && !sessionReady && current.state.status === "error") {
            retryStudentWisStockSession(b.owner, b.epoch);
            return;
          }
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
          if (current.state.status !== "ready")
            send({ status: "loading", data: null, error: "" });
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
          historyReads: new Map(),
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
          paused: (error) => {
            sessionReady = false;
            readGeneration++;
            disconnect();
            send(
              error
                ? { status: "error", data: null, error: error.message }
                : { status: "loading", data: null, error: "" },
            );
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
const commandSignature = (name: string, value: Record<string, unknown>) =>
  name === "placeStudentWisStockOrder"
    ? { stockId: value.stockId, side: value.side, quantity: value.quantity }
    : value;
async function mutate(
  scope: WisStockScope,
  name: string,
  fields: Record<string, unknown>,
  withRequestId = true,
) {
  const owner = auth.currentUser;
  if (!owner) throw changed();
  const flightKey = JSON.stringify([
    scope.year,
    scope.semester,
    name,
    commandSignature(name, fields),
  ]);
  const ownerCommands = commands.get(owner) || new Map<string, CommandEntry>();
  commands.set(owner, ownerCommands);
  const command = ownerCommands.get(flightKey) || {};
  if (command.flight) return command.flight;
  ownerCommands.set(flightKey, command);
  // Acquire before the first await: a renewed session must not overtake an
  // identical order while its receipt is being prepared or the call is pending.
  const task = prepareMutation(
    scope,
    name,
    fields,
    withRequestId,
    owner,
    command,
  ).finally(() => {
    if (command.flight !== task) return;
    command.flight = undefined;
    if (!command.pendingKey) ownerCommands.delete(flightKey);
  });
  command.flight = task;
  return task;
}
async function prepareMutation(
  scope: WisStockScope,
  name: string,
  fields: Record<string, unknown>,
  withRequestId: boolean,
  owner: User,
  command: CommandEntry,
) {
  const b = await boundary(scope);
  if (b.owner !== owner) throw changed();
  // Student trades use the existing application session proof and App Check.
  await ensureWestoryAppCheck();
  // An uncertain order retry must keep its original confirmed quote as well as its receipt id.
  const signature = (value: Record<string, unknown>) =>
    commandSignature(name, value);
  const bytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(JSON.stringify([b.key, name, signature(fields)])),
  );
  const key =
    "westory:student-wispi:" +
    Array.from(new Uint8Array(bytes), (v) =>
      v.toString(16).padStart(2, "0"),
    ).join("");
  const task = (async () => {
    await check(b);
    const readPending = (pendingKey: string) => {
      let value = requestIds.get(pendingKey);
      try {
        const saved = sessionStorage.getItem(pendingKey);
        if (!value && saved && saved.length < 10_000)
          value = JSON.parse(saved) as PendingCommand;
      } catch {}
      return value;
    };
    let pending = readPending(key);
    const rememberedKey = command.pendingKey;
    if (!pending && rememberedKey && rememberedKey !== key)
      pending = readPending(rememberedKey);
    // A receipt belongs to this logical command, including a response lost
    // during same-user renewal. New SDK users retain separate session keys.
    if (
      !pending ||
      !/^[A-Za-z0-9_-]{16,80}$/.test(pending.requestId) ||
      !pending.fields ||
      JSON.stringify(signature(pending.fields)) !==
        JSON.stringify(signature(fields))
    )
      pending = { requestId: crypto.randomUUID(), fields };
    if (withRequestId) {
      command.pendingKey = key;
      requestIds.set(key, pending);
      try {
        sessionStorage.setItem(key, JSON.stringify(pending));
      } catch {}
      if (rememberedKey && rememberedKey !== key) {
        requestIds.delete(rememberedKey);
        try {
          sessionStorage.removeItem(rememberedKey);
        } catch {}
      }
    }
    const entry = entries.get(b.key);
    if (entry) {
      entry.commands++;
      invalidateDetails(entry);
    }
    try {
      const raw = await invoke<StudentWisStockMutation>(b, name, {
        ...(withRequestId ? pending.fields : fields),
        ...(withRequestId ? { requestId: pending.requestId } : {}),
      });
      const result = {
        ...raw,
        state: accept(raw.state, b),
        ...(name === "claimStudentWisStockBonus"
          ? { depositBonus: acceptBonus(raw.depositBonus) }
          : {}),
      };
      entries.get(b.key)?.apply(result.state);
      command.pendingKey = undefined;
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
          "WIS_STOCK_FIRM_QUOTE_CHANGED",
          "WIS_STOCK_QUOTE_EXPIRED",
          "WIS_STOCK_INPUT_INVALID",
          "WIS_STOCK_TRADE_INPUT_INVALID",
          "WIS_STOCK_INSUFFICIENT_CASH",
          "WIS_STOCK_INSUFFICIENT_HOLDING",
          "WIS_STOCK_ACCOUNT_REQUIRED",
          "WIS_STOCK_PENDING_LIMIT",
          "WIS_STOCK_NOT_FOUND",
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
          "WIS_STOCK_CAMPAIGN_DISABLED",
          "WIS_STOCK_CAMPAIGN_INELIGIBLE",
        ].includes(reason)
      ) {
        command.pendingKey = undefined;
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
  })();
  return task;
}
export const transferStudentWisStock = (
  scope: WisStockScope,
  direction: "DEPOSIT" | "WITHDRAW",
  amount: number,
) => mutate(scope, "transferStudentWisStock", { direction, amount });
export const claimStudentWisStockBonus = (scope: WisStockScope) =>
  mutate(scope, "claimStudentWisStockBonus", {});

function acceptBonus(value: StudentWisStockBonus | undefined) {
  if (
    !value ||
    typeof value.campaignId !== "string" ||
    !value.campaignId ||
    !["DISABLED", "INELIGIBLE", "ELIGIBLE", "CLAIMED"].includes(value.status) ||
    !Number.isSafeInteger(value.threshold) ||
    value.threshold <= 0 ||
    !Number.isSafeInteger(value.amount) ||
    value.amount <= 0 ||
    !Number.isSafeInteger(value.qualifyingDepositAmount) ||
    value.qualifyingDepositAmount < 0 ||
    value.qualifyingDepositAmount > value.threshold
  )
    throw new Error("지원금을 확인하지 못했습니다. 다시 시도해 주세요.");
  return value;
}

/** Only an open wallet requests this. Share overlapping reads, never settled data. */
export async function getStudentWisStockBonus(scope: WisStockScope) {
  const b = await boundary(scope);
  const ownerReads = bonusReads.get(b.owner) || new Map();
  bonusReads.set(b.owner, ownerReads);
  const existing = ownerReads.get(b.key);
  if (existing) return existing;
  const task = invoke<StudentWisStockBonus>(b, "getStudentWisStockBonus")
    .then(acceptBonus)
    .finally(() => {
      if (ownerReads.get(b.key) === task) ownerReads.delete(b.key);
    });
  ownerReads.set(b.key, task);
  return task;
}
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
  const entry = entries.get(b.key);
  // Share only overlapping reads under the same live account/session revision.
  // Completed pages are never cached; pause, revision changes and commands
  // invalidate pending sharing so a new view cannot reuse an older request.
  const pending =
    entry?.boundary.owner === b.owner &&
    entry.state.status === "ready" &&
    entry.commands === 0 &&
    entry.seenRevision <= entry.state.data.account.revision &&
    document.visibilityState !== "hidden" &&
    navigator.onLine !== false
      ? entry.historyReads
      : undefined;
  const existing = pending?.get(cursor);
  if (existing) return existing;
  const task = invoke<StudentWisStockHistoryPage>(
    b,
    "getStudentWisStockHistory",
    { cursor, limit: 20 },
  )
    .then((result) => {
      if (
        result?.semesterId !== `${scope.year}-${scope.semester}` ||
        !Array.isArray(result.entries) ||
        typeof result.nextCursor !== "string" ||
        typeof result.hasMore !== "boolean"
      )
        throw new Error("내역을 확인하지 못했습니다. 다시 시도해 주세요.");
      return result;
    })
    .finally(() => {
      if (pending?.get(cursor) === task) pending.delete(cursor);
    });
  pending?.set(cursor, task);
  return task;
}
