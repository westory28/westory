import {
  collection,
  doc,
  limit,
  onSnapshot,
  orderBy,
  query,
  where,
} from "firebase/firestore";
import { db } from "./firebase";
import {
  withWisStockViewer,
  wisStockViewError,
} from "./wisStockInvestmentBoardClient";
import { normalizeWisStockInvestmentBoardScope } from "../../functions/wisStockInvestmentBoard.mjs";

export type ExchangeQuote = {
  id: string;
  name: string;
  price: number;
  previousClose: number | null;
  listedAtMs?: number;
  listingPrice?: number;
  previousPrice?: number;
  priceAtMs?: number;
};
export type ExchangeMarket = {
  updatedAtMs: number;
  halted: boolean;
  index: { value: number; previousClose: number } | null;
  stocks: ExchangeQuote[];
};
export type ExchangeTrade = {
  id: string;
  atMs: number;
  displayName: string;
  stockName: string;
  side: "BUY" | "SELL";
  quantity: number;
  unitPrice: number;
};
export type ExchangeState =
  | { status: "loading" | "paused" | "offline" }
  | { status: "ready"; market: ExchangeMarket | null; trades: ExchangeTrade[] }
  | { status: "error"; message: string };

const price = (value: number) => Number.isFinite(value) && value > 0;
const positiveInt = (value: number) => Number.isSafeInteger(value) && value > 0;
const date = (at: number) =>
  Number.isSafeInteger(at) && at >= 0 && at <= 8.64e15;
const name = (value: string) =>
  typeof value === "string" && Boolean(value.trim());
function parseMarket(
  raw: ExchangeMarket & { schemaVersion: number; semesterId: string },
  semesterId: string,
) {
  if (
    raw.schemaVersion !== 1 ||
    raw.semesterId !== semesterId ||
    !date(raw.updatedAtMs) ||
    typeof raw.halted !== "boolean" ||
    (raw.index !== null &&
      (!price(raw.index?.value) || !price(raw.index?.previousClose))) ||
    !Array.isArray(raw.stocks) ||
    raw.stocks.length > 100 ||
    raw.stocks.some(
      (stock) =>
        !name(stock?.id) ||
        !name(stock.name) ||
        !positiveInt(stock.price) ||
        (stock.listedAtMs !== undefined && !date(stock.listedAtMs)) ||
        (stock.listingPrice !== undefined &&
          !positiveInt(stock.listingPrice)) ||
        (stock.previousPrice !== undefined &&
          !positiveInt(stock.previousPrice)) ||
        (stock.priceAtMs !== undefined && !date(stock.priceAtMs)) ||
        (stock.previousClose !== null && !positiveInt(stock.previousClose)),
    )
  )
    throw new Error("invalid market");
  return raw;
}

export function watchWisStockExchange(
  year: string,
  semester: string,
  classKey: string,
  next: (state: ExchangeState) => void,
) {
  const [grade, classNumber] = classKey === "all" ? [] : classKey.split(":");
  const scope = normalizeWisStockInvestmentBoardScope({
    year,
    semester,
    grade,
    classNumber,
  });
  const path = "years/" + scope.year + "/semesters/" + scope.semester;
  const selected = scope.grade ? scope.grade + "_" + scope.classNumber : "";
  const pause = () =>
    next({
      status:
        navigator.onLine === false
          ? "offline"
          : document.hidden
            ? "paused"
            : "loading",
    });
  pause();
  return withWisStockViewer(
    ({ current, fail }) => {
      let market: ExchangeMarket | null | undefined;
      let trades: ExchangeTrade[] | undefined;
      let timeout: ReturnType<typeof setTimeout> | undefined;
      const emit = () => {
        if (market !== undefined && trades !== undefined) {
          clearTimeout(timeout);
          timeout = undefined;
          next({ status: "ready", market, trades });
        } else {
          next({ status: "loading" });
          timeout ??= setTimeout(() => fail(new Error("timeout")), 15_000);
        }
      };
      emit();
      const options = { includeMetadataChanges: true };
      const stopMarket = onSnapshot(
        doc(db, path + "/wis_stock_display/market"),
        options,
        (snapshot) => {
          if (!current()) return;
          try {
            if (
              snapshot.metadata.fromCache ||
              snapshot.metadata.hasPendingWrites
            )
              market = undefined;
            else
              market = snapshot.exists()
                ? parseMarket(
                    snapshot.data() as Parameters<typeof parseMarket>[0],
                    scope.semesterId,
                  )
                : null;
            emit();
          } catch (error) {
            fail(error);
          }
        },
        fail,
      );
      const feed = query(
        collection(db, path + "/wis_stock_display_trades"),
        ...(selected ? [where("classKey", "==", selected)] : []),
        orderBy("atMs", "desc"),
        limit(20),
      );
      const stopTrades = onSnapshot(
        feed,
        options,
        (snapshot) => {
          if (!current()) return;
          try {
            if (
              snapshot.metadata.fromCache ||
              snapshot.metadata.hasPendingWrites
            )
              trades = undefined;
            else
              trades = snapshot.docs.map((item) => {
                const data = item.data();
                if (
                  data.semesterId !== scope.semesterId ||
                  (selected && data.classKey !== selected) ||
                  !date(data.atMs) ||
                  !name(data.displayName) ||
                  !name(data.stockName) ||
                  !["BUY", "SELL"].includes(data.side) ||
                  !positiveInt(data.quantity) ||
                  !positiveInt(data.unitPrice)
                )
                  throw new Error("invalid trade");
                return {
                  id: item.id,
                  atMs: data.atMs,
                  displayName: data.displayName,
                  stockName: data.stockName,
                  side: data.side,
                  quantity: data.quantity,
                  unitPrice: data.unitPrice,
                };
              });
            emit();
          } catch (error) {
            fail(error);
          }
        },
        fail,
      );
      return () => {
        clearTimeout(timeout);
        stopMarket();
        stopTrades();
      };
    },
    pause,
    (error) =>
      next({ status: "error", message: wisStockViewError(error).message }),
  );
}
