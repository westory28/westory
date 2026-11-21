import { onIdTokenChanged } from "firebase/auth";
import { doc, getDocFromServer } from "firebase/firestore";
import { auth, db } from "./firebase";
import { watchStudentWisStockSession } from "./studentWisStockSession";
import {
  normalizeWisStockInvestmentBoardScope,
  parseWisStockInvestmentBoardSnapshot,
  type WisStockInvestmentBoardState,
} from "../../functions/wisStockInvestmentBoard.mjs";

export type { WisStockInvestmentBoardState } from "../../functions/wisStockInvestmentBoard.mjs";
export type WisStockBoardConnection =
  | "CONNECTING"
  | "CONNECTED"
  | "PAUSED"
  | "OFFLINE";
export type WisStockBoardScope = {
  year: string;
  semester: string;
  grade?: string;
  classNumber?: string;
};

type ReadAccess = { current: () => boolean; fail: (error: unknown) => void };

/** Both teacher views share the exact-own-session guard. Revocation clears the screen. */
export function withWisStockViewer(
  start: (access: ReadAccess) => () => void,
  paused: () => void,
  failed: (error: unknown) => void,
) {
  const owner = auth.currentUser;
  let stopped = false,
    generation = 0,
    epoch: number | undefined;
  let stopReading: (() => void) | undefined;
  let stopSession: (() => void) | undefined;
  let stopAuth: (() => void) | undefined;
  function pause() {
    ++generation;
    stopReading?.();
    stopReading = undefined;
  }
  function dispose() {
    stopped = true;
    pause();
    stopAuth?.();
    stopSession?.();
  }
  function fail(error: unknown) {
    if (stopped) return;
    dispose();
    failed(error);
  }
  stopAuth = onIdTokenChanged(auth, (user) => {
    if (stopped) return;
    if (!user || user !== owner) {
      fail({ code: "unauthenticated" });
      return;
    }
    void user
      .getIdTokenResult()
      .then((token) => {
        if (stopped || auth.currentUser !== owner) return;
        const value = Number(token.claims.auth_time);
        if (
          !Number.isSafeInteger(value) ||
          value <= 0 ||
          (epoch !== undefined && value !== epoch)
        ) {
          fail({ code: "unauthenticated" });
          return;
        }
        if (epoch !== undefined) return;
        epoch = value;
        stopSession = watchStudentWisStockSession(user, epoch, {
          allowed: () => {
            if (stopped || stopReading) return;
            const turn = ++generation;
            const current = () =>
              !stopped &&
              turn === generation &&
              owner === auth.currentUser &&
              !document.hidden &&
              navigator.onLine !== false;
            const stop = start({
              current,
              fail: (error) => {
                if (current()) fail(error);
              },
            });
            if (stopped || turn !== generation) stop();
            else stopReading = stop;
          },
          paused: () => {
            if (!stopped) {
              pause();
              paused();
            }
          },
          denied: () => fail({ code: "unauthenticated" }),
        });
        if (stopped) stopSession();
      })
      .catch(fail);
  });
  return dispose;
}

export function wisStockViewError(error: unknown) {
  const code = String((error as { code?: string })?.code || "");
  return new Error(
    /permission-denied|unauthenticated/.test(code)
      ? "투자 현황 조회 권한이나 로그인 상태를 확인해 주세요."
      : "투자 현황을 확인하지 못했습니다. 연결 상태를 확인하고 다시 시도해 주세요.",
  );
}

/** The ordinary view reads its selected projection once per authorized visit, never listens to it. */
export function watchWisStockInvestmentBoard(
  input: WisStockBoardScope,
  onData: (value: WisStockInvestmentBoardState) => void,
  onConnection: (state: WisStockBoardConnection) => void,
  onError: (error: Error) => void,
  canRead: () => boolean = () => true,
) {
  const scope = normalizeWisStockInvestmentBoardScope(input);
  return withWisStockViewer(
    ({ current, fail }) => {
      if (!canRead()) {
        onConnection("PAUSED");
        return () => {};
      }
      onConnection("CONNECTING");
      const path =
        "years/" +
        scope.year +
        "/semesters/" +
        scope.semester +
        "/wis_stock_investment_boards/" +
        scope.documentId;
      void getDocFromServer(doc(db, path))
        .then((snapshot) => {
          if (!current()) return;
          if (!canRead()) {
            onConnection("PAUSED");
            return;
          }
          const result = parseWisStockInvestmentBoardSnapshot(
            snapshot.data() ?? null,
            scope,
          );
          onData(result);
          onConnection("CONNECTED");
        })
        .catch(fail);
      return () => {};
    },
    () =>
      onConnection(
        navigator.onLine === false
          ? "OFFLINE"
          : document.hidden
            ? "PAUSED"
            : "CONNECTING",
      ),
    (error) => onError(wisStockViewError(error)),
  );
}
