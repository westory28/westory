import { onIdTokenChanged } from "firebase/auth";
import { doc, onSnapshot } from "firebase/firestore";
import { auth, db } from "./firebase";
import {
  normalizeWisStockInvestmentBoardScope,
  parseWisStockInvestmentBoardSession,
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

/** One scoped projection and the viewer's own current-session guard. No polling or storage. */
export function watchWisStockInvestmentBoard(
  input: WisStockBoardScope,
  onData: (value: WisStockInvestmentBoardState) => void,
  onConnection: (state: WisStockBoardConnection) => void,
  onError: (error: Error) => void,
) {
  const scope = normalizeWisStockInvestmentBoardScope(input);
  const owner = auth.currentUser;
  let stopped = false,
    sequence = 0,
    stopSnapshot: (() => void) | undefined;
  let stopSession: (() => void) | undefined;
  let deadline: ReturnType<typeof setTimeout> | undefined;
  let expiry: ReturnType<typeof setTimeout> | undefined;
  let authEpoch: number | undefined;
  let stopAuth: (() => void) | undefined;
  let lastRevision = -1;
  const visible = () => document.visibilityState !== "hidden";
  const disconnect = () => {
    sequence++;
    stopSnapshot?.();
    stopSnapshot = undefined;
    stopSession?.();
    stopSession = undefined;
    clearTimeout(deadline);
    deadline = undefined;
    clearTimeout(expiry);
    expiry = undefined;
  };
  const fail = (error: unknown) => {
    if (stopped) return;
    stopped = true;
    disconnect();
    stopAuth?.();
    const code = String((error as { code?: string })?.code || "");
    onError(
      new Error(
        code.includes("permission-denied") || code.includes("unauthenticated")
          ? "투자 현황 조회 권한이나 로그인 상태를 확인해 주세요."
          : "투자 현황을 확인하지 못했습니다. 연결 상태를 확인하고 다시 시도해 주세요.",
      ),
    );
  };
  const connect = () => {
    if (stopped || stopSession || authEpoch === undefined) return;
    if (!visible()) {
      onConnection("PAUSED");
      return;
    }
    if (navigator.onLine === false) {
      onConnection("OFFLINE");
      return;
    }
    if (!owner || auth.currentUser !== owner) {
      fail({ code: "unauthenticated" });
      return;
    }
    const turn = ++sequence;
    let boardEpoch = 0;
    lastRevision = -1;
    onConnection("CONNECTING");
    deadline = setTimeout(() => {
      if (turn === sequence) fail(new Error("timeout"));
    }, 15_000);
    const pending = () => {
      lastRevision = -1;
      onConnection("CONNECTING");
      if (!deadline)
        deadline = setTimeout(() => {
          if (turn === sequence) fail(new Error("timeout"));
        }, 15_000);
    };
    const startBoard = () => {
      if (stopSnapshot || stopped || turn !== sequence) return;
      const boardTurn = ++boardEpoch;
      stopSnapshot = onSnapshot(
        doc(
          db,
          `years/${scope.year}/semesters/${scope.semester}/wis_stock_investment_boards/${scope.documentId}`,
        ),
        { includeMetadataChanges: true },
        (snapshot) => {
          if (
            stopped ||
            turn !== sequence ||
            boardTurn !== boardEpoch ||
            !visible() ||
            auth.currentUser !== owner
          )
            return;
          if (
            snapshot.metadata.fromCache ||
            snapshot.metadata.hasPendingWrites
          ) {
            pending();
            return;
          }
          try {
            const next = parseWisStockInvestmentBoardSnapshot(
              snapshot.exists() ? snapshot.data() : null,
              scope,
            );
            if (next.status === "READY" && next.revision < lastRevision)
              throw new Error("regressed revision");
            clearTimeout(deadline);
            deadline = undefined;
            onConnection("CONNECTED");
            if (next.status === "NOT_READY" || next.revision !== lastRevision)
              onData(next);
            lastRevision = next.status === "READY" ? next.revision : -1;
          } catch (error) {
            fail(error);
          }
        },
        (error) => {
          if (turn === sequence && boardTurn === boardEpoch) fail(error);
        },
      );
    };
    // The board itself may be unchanged when a login is revoked. Observe only
    // this viewer's exact auth_time session, never list other sessions/users.
    stopSession = onSnapshot(
      doc(db, `application_sessions/${owner.uid}/sessions/${authEpoch}`),
      { includeMetadataChanges: true },
      (snapshot) => {
        if (
          stopped ||
          turn !== sequence ||
          !visible() ||
          auth.currentUser !== owner
        )
          return;
        if (snapshot.metadata.fromCache || snapshot.metadata.hasPendingWrites) {
          boardEpoch++;
          stopSnapshot?.();
          stopSnapshot = undefined;
          pending();
          return;
        }
        try {
          const session = parseWisStockInvestmentBoardSession(
            snapshot.exists() ? snapshot.data() : null,
            { uid: owner.uid, authTime: authEpoch! },
            Date.now(),
          );
          clearTimeout(expiry);
          expiry = undefined;
          if (session.deadlineAtMs !== null) {
            const expire = () => {
              if (stopped || turn !== sequence) return;
              const remaining = session.deadlineAtMs! - Date.now();
              if (remaining <= 0) {
                fail({ code: "unauthenticated" });
                return;
              }
              expiry = setTimeout(expire, Math.min(remaining, 2_147_483_647));
            };
            expire();
          }
          startBoard();
        } catch (error) {
          fail(error);
        }
      },
      (error) => {
        if (turn === sequence) fail(error);
      },
    );
  };
  const visibility = () => {
    if (!visible() || navigator.onLine === false) {
      disconnect();
      if (!stopped) onConnection(!visible() ? "PAUSED" : "OFFLINE");
    } else connect();
  };
  document.addEventListener("visibilitychange", visibility);
  window.addEventListener("offline", visibility);
  window.addEventListener("online", visibility);
  if (!owner) fail({ code: "unauthenticated" });
  else
    stopAuth = onIdTokenChanged(auth, (user) => {
      if (stopped) return;
      if (user !== owner) {
        fail({ code: "unauthenticated" });
        return;
      }
      void user.getIdTokenResult().then((token) => {
        if (stopped || auth.currentUser !== owner) return;
        const epoch = Number(token.claims.auth_time);
        if (
          !Number.isSafeInteger(epoch) ||
          epoch <= 0 ||
          (authEpoch !== undefined && epoch !== authEpoch)
        ) {
          fail({ code: "unauthenticated" });
          return;
        }
        authEpoch = epoch;
        connect();
      }, fail);
    });
  return () => {
    stopped = true;
    disconnect();
    stopAuth?.();
    document.removeEventListener("visibilitychange", visibility);
    window.removeEventListener("offline", visibility);
    window.removeEventListener("online", visibility);
  };
}
