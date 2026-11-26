import { onIdTokenChanged, type User } from "firebase/auth";
import { doc, onSnapshot } from "firebase/firestore";
import { auth, db } from "./firebase";
import { normalizeWisStockMarketRules } from "../../functions/wisStockMarketRules.mjs";
import {
  retryStudentWisStockSession,
  watchStudentWisStockSession,
} from "./studentWisStockSession";
import { isStudentWisStockTransient } from "./studentWisStockReadRetry";
import type {
  StudentWisStockMarket,
  StudentWisStockStatus,
  WisStockLoad,
  WisStockScope,
} from "./studentWisStockTypes";

const empty = <T>(): WisStockLoad<T> => ({
  status: "loading",
  data: null,
  error: "",
});
const invalid = () =>
  new Error("위스피 자료를 확인하지 못했습니다. 다시 시도해 주세요.");
const safe = (value: unknown) =>
  Number.isSafeInteger(value) && Number(value) >= 0;
export function parseStudentWisStockStatus(
  raw: unknown,
  scope: WisStockScope,
): StudentWisStockStatus {
  const semesterId = `${scope.year}-${scope.semester}`;
  if (raw === null)
    return {
      schemaVersion: 1,
      semesterId,
      studentOpen: false,
      halted: true,
      tradingEpoch: 0,
      revision: 0,
      updatedAtMs: 0,
    };
  const value = raw as StudentWisStockStatus;
  if (
    value?.schemaVersion !== 1 ||
    value.semesterId !== semesterId ||
    typeof value.studentOpen !== "boolean" ||
    typeof value.halted !== "boolean" ||
    !safe(value.revision) ||
    !safe(value.tradingEpoch) ||
    !safe(value.updatedAtMs)
  )
    throw invalid();
  return value;
}
export function parseStudentWisStockMarket(
  raw: unknown,
  scope: WisStockScope,
): StudentWisStockMarket {
  const value = raw as StudentWisStockMarket;
  if (
    value?.schemaVersion !== 1 ||
    value.semesterId !== `${scope.year}-${scope.semester}` ||
    value.studentOpen !== true ||
    !safe(value.revision) ||
    !safe(value.tradingEpoch) ||
    !safe(value.updatedAtMs) ||
    !Array.isArray(value.stocks) ||
    value.stocks.length > 100
  )
    throw invalid();
  const ids = new Set<string>();
  for (const stock of value.stocks) {
    if (
      !/^stock_[a-f0-9]{24}$/.test(stock?.id) ||
      ids.has(stock.id) ||
      !safe(stock.price) ||
      stock.price <= 0 ||
      typeof stock.settings?.name !== "string" ||
      !stock.settings.name.trim() ||
      !safe(stock.settings.lotSize) ||
      stock.settings.lotSize < 1 ||
      !Array.isArray(stock.history)
    )
      throw invalid();
    ids.add(stock.id);
  }
  return { ...value, rules: normalizeWisStockMarketRules(value.rules) };
}
type Listener<T> = (state: WisStockLoad<T>) => void;
type Entry<T> = {
  owner: User;
  epoch: number;
  state: WisStockLoad<T>;
  listeners: Set<Listener<T>>;
  retry: () => void;
  dispose: () => void;
};
type PublicKind = "current" | "market" | "overseas_current" | "overseas_market";
const stores = {
  current: new Map<string, Entry<StudentWisStockStatus>>(),
  market: new Map<string, Entry<StudentWisStockMarket>>(),
  overseas_current: new Map<string, Entry<StudentWisStockStatus>>(),
  overseas_market: new Map<string, Entry<StudentWisStockMarket>>(),
};

/** Active subscriptions only: no local-storage cache, polling, or data retained after the last viewer leaves. */
function subscribe<T>(
  kind: PublicKind,
  scope: WisStockScope,
  parse: (raw: unknown, scope: WisStockScope) => T,
  listener: Listener<T>,
  store: Map<string, Entry<T>>,
) {
  const owner = auth.currentUser;
  let cancelled = false;
  let detach = () => {};
  listener(empty());
  void (async () => {
    if (!owner) throw invalid();
    const epoch = Number((await owner.getIdTokenResult()).claims.auth_time);
    if (cancelled) return;
    if (
      auth.currentUser !== owner ||
      !Number.isSafeInteger(epoch) ||
      epoch <= 0
    )
      throw invalid();
    const key = `${owner.uid}:${epoch}:${scope.year}:${scope.semester}`;
    let entry = store.get(key);
    if (entry && entry.owner !== owner) {
      entry.dispose();
      entry = undefined;
    }
    if (!entry) {
      const listeners = new Set<Listener<T>>();
      let stopped = false,
        generation = 0;
      let stopSnapshot: (() => void) | undefined,
        stopAuth: (() => void) | undefined,
        stopSession: (() => void) | undefined;
      let sessionReady = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      let retries = 0;
      const send = (state: WisStockLoad<T>) => {
        if (stopped) return;
        current.state = state;
        listeners.forEach((next) => next(state));
      };
      const disconnect = () => {
        generation++;
        stopSnapshot?.();
        stopSnapshot = undefined;
        clearTimeout(timer);
      };
      const dispose = () => {
        if (stopped) return;
        disconnect();
        stopped = true;
        stopAuth?.();
        stopSession?.();
        document.removeEventListener("visibilitychange", reconnect);
        window.removeEventListener("online", reconnect);
        window.removeEventListener("offline", reconnect);
        if (store.get(key) === current) store.delete(key);
      };
      const fail = (error: unknown) => {
        const code = String((error as { code?: string })?.code || "");
        if (isStudentWisStockTransient(error)) {
          disconnect();
          send(empty());
          if (retries < 2) timer = setTimeout(connect, 750 * 2 ** retries++);
          else delayed();
          return;
        }
        send({
          status: "error",
          data: null,
          error:
            code.includes("permission-denied") ||
            code.includes("unauthenticated")
              ? "위스피를 열 수 없습니다. 다시 로그인한 뒤 확인해 주세요."
              : "위스피 연결을 확인하지 못했습니다. 다시 시도해 주세요.",
        });
        dispose();
      };
      const delayed = () =>
        send({
          status: "error",
          data: null,
          error: "위스피 연결을 다시 확인해 주세요.",
        });
      const connect = () => {
        if (stopped || stopSnapshot || !sessionReady) return;
        if (auth.currentUser !== owner) {
          fail({ code: "unauthenticated" });
          return;
        }
        if (
          document.visibilityState === "hidden" ||
          navigator.onLine === false
        ) {
          send(empty());
          return;
        }
        const turn = ++generation;
        send(empty());
        timer = setTimeout(() => {
          if (turn === generation) delayed();
        }, 15_000);
        stopSnapshot = onSnapshot(
          doc(
            db,
            `years/${scope.year}/semesters/${scope.semester}/wis_stock_public/${kind}`,
          ),
          { includeMetadataChanges: true },
          (snapshot) => {
            if (stopped || turn !== generation || auth.currentUser !== owner)
              return;
            if (
              snapshot.metadata.fromCache ||
              snapshot.metadata.hasPendingWrites
            ) {
              send(empty());
              clearTimeout(timer);
              timer = setTimeout(() => {
                if (turn === generation) delayed();
              }, 15_000);
              return;
            }
            try {
              const data = parse(
                snapshot.exists() ? snapshot.data() : null,
                scope,
              );
              clearTimeout(timer);
              retries = 0;
              send({ status: "ready", data, error: "" });
            } catch (error) {
              fail(error);
            }
          },
          fail,
        );
      };
      const reconnect = () => {
        disconnect();
        retries = 0;
        connect();
      };
      const current: Entry<T> = {
        owner,
        epoch,
        state: empty(),
        listeners,
        retry: () => {
          if (!sessionReady) retryStudentWisStockSession(owner, epoch);
          else reconnect();
        },
        dispose,
      };
      entry = current;
      store.set(key, current);
      stopAuth = onIdTokenChanged(auth, (user) => {
        if (stopped) return;
        if (user !== owner) {
          fail({ code: "unauthenticated" });
          return;
        }
        void user
          .getIdTokenResult()
          .then((result) => {
            if (!stopped && Number(result.claims.auth_time) !== epoch)
              fail({ code: "unauthenticated" });
          })
          .catch(fail);
      });
      document.addEventListener("visibilitychange", reconnect);
      window.addEventListener("online", reconnect);
      window.addEventListener("offline", reconnect);
      stopSession = watchStudentWisStockSession(owner, epoch, {
        allowed: () => {
          sessionReady = true;
          connect();
        },
        denied: fail,
        paused: (error) => {
          sessionReady = false;
          disconnect();
          if (error) delayed();
          else send(empty());
        },
      });
      if (stopped) stopSession();
    }
    if (cancelled) return;
    entry.listeners.add(listener);
    listener(entry.state);
    if (entry.state.status === "error" && !cancelled) entry.retry();
    const chosen = entry;
    detach = () => {
      chosen.listeners.delete(listener);
      if (!chosen.listeners.size) chosen.dispose();
    };
  })().catch(() => {
    if (!cancelled)
      listener({
        status: "error",
        data: null,
        error: "로그인 상태를 확인한 뒤 다시 시도해 주세요.",
      });
  });
  return () => {
    cancelled = true;
    detach();
  };
}
export const watchStudentWisStockStatus = (
  scope: WisStockScope,
  listener: Listener<StudentWisStockStatus>,
) =>
  subscribe(
    "current",
    scope,
    parseStudentWisStockStatus,
    listener,
    stores.current,
  );
export const watchStudentWisStockMarket = (
  scope: WisStockScope,
  listener: Listener<StudentWisStockMarket>,
) =>
  subscribe(
    "market",
    scope,
    parseStudentWisStockMarket,
    listener,
    stores.market,
  );
/** The 유스 venue's two safe public documents, watched only by its own view. */
export const watchStudentWisStockOverseasStatus = (
  scope: WisStockScope,
  listener: Listener<StudentWisStockStatus>,
) =>
  subscribe(
    "overseas_current",
    scope,
    parseStudentWisStockStatus,
    listener,
    stores.overseas_current,
  );
export const watchStudentWisStockOverseasMarket = (
  scope: WisStockScope,
  listener: Listener<StudentWisStockMarket>,
) =>
  subscribe(
    "overseas_market",
    scope,
    parseStudentWisStockMarket,
    listener,
    stores.overseas_market,
  );
