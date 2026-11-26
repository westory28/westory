import { onIdTokenChanged, type User } from "firebase/auth";
import { doc, onSnapshot } from "firebase/firestore";
import { auth, db } from "./firebase";
import {
  WIS_STOCK_FX_PATH,
  parseWisStockFxRate,
  type WisStockFxRate,
} from "../../functions/wisStockFx.mjs";
import type { WisStockLoad } from "./studentWisStockTypes";

export type { WisStockFxRate } from "../../functions/wisStockFx.mjs";
type Listener = (state: WisStockLoad<WisStockFxRate | null>) => void;

// One live listener per signed-in user for the single public daily-rate
// document. It changes once a day; screens that do not show it never open it.
let shared: {
  owner: User;
  state: WisStockLoad<WisStockFxRate | null>;
  listeners: Set<Listener>;
  stop: () => void;
} | null = null;

function open(owner: User) {
  const listeners = new Set<Listener>();
  const entry = {
    owner,
    state: {
      status: "loading",
      data: null,
      error: "",
    } as WisStockLoad<WisStockFxRate | null>,
    listeners,
    stop: () => {},
  };
  const send = (state: WisStockLoad<WisStockFxRate | null>) => {
    entry.state = state;
    listeners.forEach((listener) => listener(state));
  };
  const stopSnapshot = onSnapshot(
    doc(db, WIS_STOCK_FX_PATH),
    (snapshot) => {
      if (auth.currentUser !== owner) return;
      try {
        send({
          status: "ready",
          data: snapshot.exists()
            ? parseWisStockFxRate(snapshot.data(), Date.now())
            : null,
          error: "",
        });
      } catch {
        send({ status: "ready", data: null, error: "" });
      }
    },
    () =>
      send({
        status: "error",
        data: null,
        error: "오늘의 환율을 불러오지 못했습니다.",
      }),
  );
  const stopAuth = onIdTokenChanged(auth, (user) => {
    if (user !== owner) close();
  });
  const close = () => {
    stopSnapshot();
    stopAuth();
    if (shared === entry) shared = null;
  };
  entry.stop = close;
  return entry;
}

export function watchWisStockFxRate(listener: Listener) {
  const owner = auth.currentUser;
  if (!owner) {
    listener({
      status: "error",
      data: null,
      error: "로그인 상태를 확인해 주세요.",
    });
    return () => {};
  }
  if (!shared || shared.owner !== owner) {
    shared?.stop();
    shared = open(owner);
  }
  const entry = shared;
  entry.listeners.add(listener);
  listener(entry.state);
  return () => {
    entry.listeners.delete(listener);
    if (!entry.listeners.size) entry.stop();
  };
}
