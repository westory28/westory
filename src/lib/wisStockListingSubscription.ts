import { onIdTokenChanged } from "firebase/auth";
import { doc, onSnapshot } from "firebase/firestore";
import { auth, db } from "./firebase";
import { getYearSemester } from "./semesterScope";
import { watchStudentWisStockSession } from "./studentWisStockSession";
import type { WisStockConfig } from "./wisStocksClient";

/** Only the active, visible management view watches this safe public document.
 * Price-only snapshots never trigger a management read. No persistent cache. */
export function watchWisStockListings(
  config: WisStockConfig,
  next: (ids: string[]) => void,
  failed: (error: unknown) => void,
) {
  const owner = auth.currentUser;
  const scope = getYearSemester(config);
  let stopped = false;
  let stopMarket: (() => void) | undefined;
  let stopSession: (() => void) | undefined;
  let stopAuth: (() => void) | undefined;
  let lastIds = "";
  const disconnect = () => {
    stopMarket?.();
    stopMarket = undefined;
  };
  const dispose = () => {
    if (stopped) return;
    stopped = true;
    disconnect();
    stopSession?.();
    stopAuth?.();
  };
  const fail = (error: unknown) => {
    if (stopped) return;
    dispose();
    failed(error);
  };
  void (async () => {
    if (!owner) throw new Error("로그인 상태를 확인해 주세요.");
    const epoch = Number((await owner.getIdTokenResult()).claims.auth_time);
    if (stopped) return;
    if (auth.currentUser !== owner || !Number.isSafeInteger(epoch))
      throw new Error("로그인 상태가 변경되었습니다.");
    stopAuth = onIdTokenChanged(auth, (user) => {
      void (async () => {
        if (stopped) return;
        if (
          user !== owner ||
          Number((await user.getIdTokenResult()).claims.auth_time) !== epoch
        )
          fail(new Error("로그인 상태가 변경되었습니다."));
      })().catch(fail);
    });
    stopSession = watchStudentWisStockSession(owner, epoch, {
      paused: disconnect,
      denied: fail,
      allowed: () => {
        if (stopped || stopMarket) return;
        stopMarket = onSnapshot(
          doc(
            db,
            `years/${scope.year}/semesters/${scope.semester}/wis_stock_public/market`,
          ),
          { includeMetadataChanges: true },
          (snapshot) => {
            if (stopped || auth.currentUser !== owner) return;
            if (
              snapshot.metadata.fromCache ||
              snapshot.metadata.hasPendingWrites
            )
              return;
            const value = snapshot.data();
            if (
              !snapshot.exists() ||
              value?.semesterId !== `${scope.year}-${scope.semester}` ||
              !Array.isArray(value.stocks)
            ) {
              fail(new Error("상장 현황을 확인하지 못했습니다."));
              return;
            }
            const ids = value.stocks
              .map((stock: { id: string } | null) => stock?.id)
              .sort();
            if (
              !ids.every(
                (id: unknown): id is string =>
                  typeof id === "string" && /^stock_[a-f0-9]{24}$/.test(id),
              )
            ) {
              fail(new Error("상장 현황을 확인하지 못했습니다."));
              return;
            }
            const key = JSON.stringify(ids);
            if (lastIds === key) return;
            lastIds = key;
            next(ids);
          },
          fail,
        );
      },
    });
    if (stopped) {
      stopSession?.();
      stopAuth?.();
    }
  })().catch(fail);
  return dispose;
}
