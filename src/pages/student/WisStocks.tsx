import { useEffect, useRef, useState } from "react";
import { useAuth } from "../../contexts/AuthContext";
import {
  useStudentWisStockAccount,
  useStudentWisStockMarket,
  useStudentWisStockStatus,
} from "../../hooks/useStudentWisStocks";
import { getYearSemester } from "../../lib/semesterScope";
import {
  cancelStudentWisStockOrder,
  placeStudentWisStockOrder,
  studentWisStockError,
  studentWisStockNow,
} from "../../lib/studentWisStockClient";
import WisShopNavigation from "../../components/common/WisShopNavigation";
import WisStockPriceChart from "../../components/common/WisStockPriceChart";
import StudentWisStockAccountPanel from "./components/wispi/StudentWisStockAccountPanel";
import "./components/wispi/studentWisStocks.css";

const money = (value: number) => value.toLocaleString("ko-KR");
const periods = [
  { label: "1일", days: 1 },
  { label: "1주", days: 7 },
  { label: "1개월", days: 30 },
  { label: "전체", days: Infinity },
];
function amounts(
  price: number,
  quantity: number,
  feeBps: number,
  side: "BUY" | "SELL",
) {
  if (
    !Number.isSafeInteger(quantity) ||
    quantity <= 0 ||
    !Number.isSafeInteger(price) ||
    price <= 0
  )
    return null;
  const gross = BigInt(price) * BigInt(quantity),
    fee = (gross * BigInt(feeBps) + 9999n) / 10000n,
    total = side === "BUY" ? gross + fee : gross - fee;
  return total >= 0 && total <= BigInt(Number.MAX_SAFE_INTEGER)
    ? { fee: Number(fee), total: Number(total) }
    : null;
}
export default function StudentWisStocks() {
  const { currentUser, config, authGeneration } = useAuth();
  const scope = getYearSemester(config);
  const status = useStudentWisStockStatus();
  const [tab, setTab] = useState<"market" | "account">("market");
  const opened = status.data?.studentOpen === true;
  const market = useStudentWisStockMarket(opened && tab === "market");
  const account = useStudentWisStockAccount(opened);
  const [selectedId, setSelectedId] = useState("");
  const [days, setDays] = useState(7);
  const [side, setSide] = useState<"BUY" | "SELL">("BUY");
  const [quantity, setQuantity] = useState("1");
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState<{
    key: string;
    text: string;
    error: boolean;
  } | null>(null);
  const [, setClock] = useState(0);
  const key = `${currentUser?.uid}:${authGeneration}:${scope.year}:${scope.semester}`;
  const liveKey = useRef(key);
  liveKey.current = key;
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    setTab("market");
    setSelectedId("");
    setSide("BUY");
    setQuantity("1");
    setBusy("");
    setNotice(null);
  }, [key]);
  const pending = account.data?.account.pendingOrders || [];
  useEffect(() => {
    if (!pending.length) return;
    const timer = setInterval(() => setClock((value) => value + 1), 1000);
    return () => clearInterval(timer);
  }, [pending.length > 0, key]);
  const selected =
    market.data?.stocks.find((stock) => stock.id === selectedId) ||
    market.data?.stocks[0];
  const stopped = opened && status.data?.halted === true;
  const tradingEnabled =
    opened && status.status === "ready" && !status.data.halted;
  const canOrder =
    tradingEnabled &&
    market.status === "ready" &&
    market.data.tradingEpoch === status.data?.tradingEpoch &&
    !market.data.rules.halted &&
    account.status === "ready";
  const parsed = /^[0-9]+$/.test(quantity) ? Number(quantity) : 0;
  const estimate =
    selected && market.data
      ? amounts(
          selected.price,
          parsed,
          side === "BUY"
            ? market.data.rules.buyFeeBps
            : market.data.rules.sellFeeBps,
          side,
        )
      : null;
  const available = account.data
    ? account.data.account.stockCash - account.data.account.reservedCash
    : 0;
  const position = account.data?.account.positions.find(
    (item) => item.stockId === selected?.id,
  );
  const availableShares = position
    ? position.quantity - position.reservedSellQuantity
    : 0;
  const quantityValid =
    !!selected &&
    Number.isSafeInteger(parsed) &&
    parsed > 0 &&
    parsed % selected.settings.lotSize === 0 &&
    parsed <= (market.data?.rules.maxOrderQuantity || 0);
  const instrumentReady =
    !!selected &&
    selected.settings.tradingStatus !== "HALTED" &&
    !(side === "BUY" && selected.settings.tradingStatus === "SELL_ONLY") &&
    (!selected.haltedUntilMs ||
      !account.data ||
      selected.haltedUntilMs <= studentWisStockNow(account.data));
  const balanceReady =
    !!estimate &&
    (side === "BUY"
      ? estimate.total + (market.data?.rules.minimumCashReserve || 0) <=
        available
      : parsed <= availableShares);
  const submit = async () => {
    if (
      !selected ||
      !market.data ||
      !account.data ||
      busy ||
      !canOrder ||
      !quantityValid ||
      !instrumentReady ||
      !balanceReady
    )
      return;
    const ownerKey = key;
    setBusy("place");
    setNotice(null);
    try {
      const result = await placeStudentWisStockOrder(scope, {
        stockId: selected.id,
        side,
        quantity: parsed,
        quote: {
          price: selected.price,
          atMs: studentWisStockNow(account.data),
          marketRevision: market.data.revision,
        },
      });
      if (mounted.current && liveKey.current === ownerKey)
        setNotice({
          key: ownerKey,
          error: false,
          text: result.duplicate
            ? "기존 주문 상태를 확인했습니다."
            : "주문을 접수했습니다. 체결을 기다려 주세요.",
        });
    } catch (error) {
      if (mounted.current && liveKey.current === ownerKey)
        setNotice({
          key: ownerKey,
          error: true,
          text: studentWisStockError(error),
        });
    } finally {
      if (mounted.current && liveKey.current === ownerKey) setBusy("");
    }
  };
  const cancel = async (orderId: string) => {
    if (busy || !tradingEnabled) return;
    const ownerKey = key;
    setBusy(orderId);
    setNotice(null);
    try {
      const result = await cancelStudentWisStockOrder(scope, orderId);
      if (mounted.current && liveKey.current === ownerKey)
        setNotice({
          key: ownerKey,
          error: false,
          text:
            result.order?.status === "CANCELLED"
              ? "주문을 취소했습니다."
              : "주문 상태를 확인했습니다.",
        });
    } catch (error) {
      if (mounted.current && liveKey.current === ownerKey)
        setNotice({
          key: ownerKey,
          error: true,
          text: studentWisStockError(error),
        });
    } finally {
      if (mounted.current && liveKey.current === ownerKey) setBusy("");
    }
  };
  const change =
    selected && selected.history.length > 1
      ? selected.price - selected.history[selected.history.length - 2].price
      : 0;
  return (
    <main className="ws-page student-wispi">
      <header className="ws-page-header">
        <h1>위스피(WsPI)</h1>
      </header>
      <WisShopNavigation portal="student" active="stocks" />
      {status.status === "loading" && (
        <p role="status">위스피를 불러오는 중입니다.</p>
      )}
      {status.status === "error" && (
        <div role="alert" className="student-wispi-error">
          <p>{status.error}</p>
          <button type="button" onClick={status.retry}>
            다시 불러오기
          </button>
        </div>
      )}
      {status.status === "ready" && !opened && (
        <p>아직 위스피가 열리지 않았습니다.</p>
      )}
      {opened && (
        <div className="student-wispi-stage">
          <div
            className={
              stopped
                ? "student-wispi-content is-stopped"
                : "student-wispi-content"
            }
            aria-hidden={stopped || undefined}
            ref={(node) => {
              if (node) node.inert = stopped;
            }}
          >
            <nav className="ws-page-tabs" aria-label="위스피 보기">
              <button
                type="button"
                aria-pressed={tab === "market"}
                onClick={() => setTab("market")}
              >
                주식 시장
              </button>
              <button
                type="button"
                aria-pressed={tab === "account"}
                onClick={() => setTab("account")}
              >
                주식 지갑
              </button>
            </nav>
            {tab === "account" ? (
              <StudentWisStockAccountPanel tradingEnabled={tradingEnabled} />
            ) : (
              <>
                {market.status === "loading" && (
                  <p role="status">시세를 불러오는 중입니다.</p>
                )}
                {market.status === "error" && (
                  <div role="alert" className="student-wispi-error">
                    <p>{market.error}</p>
                    <button type="button" onClick={market.retry}>
                      다시 불러오기
                    </button>
                  </div>
                )}
                {account.status === "error" && (
                  <div role="alert" className="student-wispi-error">
                    <p>{account.error}</p>
                    <button type="button" onClick={account.retry}>
                      주식 지갑 다시 불러오기
                    </button>
                  </div>
                )}
                {market.data && (
                  <div className="student-wispi-market">
                    <section
                      className="student-wispi-instruments"
                      aria-label="위스피 종목"
                    >
                      <h2>종목</h2>
                      {market.data.stocks.length === 0 ? (
                        <p className="student-wispi-muted">
                          등록된 종목이 없습니다.
                        </p>
                      ) : (
                        <ul>
                          {market.data.stocks.map((stock) => (
                            <li key={stock.id}>
                              <button
                                type="button"
                                aria-pressed={selected?.id === stock.id}
                                disabled={!!busy}
                                onClick={() => {
                                  setSelectedId(stock.id);
                                  setQuantity(String(stock.settings.lotSize));
                                  setNotice(null);
                                }}
                              >
                                <span>
                                  <strong>{stock.settings.name}</strong>
                                  <small>{stock.settings.period}</small>
                                </span>
                                <strong>
                                  {money(stock.price)} <small>위스</small>
                                </strong>
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </section>
                    {selected && (
                      <section
                        className="student-wispi-detail"
                        aria-label={`${selected.settings.name} 주식`}
                      >
                        <div className="student-wispi-price">
                          <div>
                            <h2>{selected.settings.name}</h2>
                            <p
                              className={
                                change > 0
                                  ? "is-up"
                                  : change < 0
                                    ? "is-down"
                                    : ""
                              }
                            >
                              {money(selected.price)} <small>위스</small>
                            </p>
                          </div>
                          <span
                            className={
                              change > 0 ? "is-up" : change < 0 ? "is-down" : ""
                            }
                          >
                            {change > 0 ? "+" : ""}
                            {money(change)} 위스
                          </span>
                        </div>
                        <div
                          className={
                            change > 0 ? "is-up" : change < 0 ? "is-down" : ""
                          }
                        >
                          <WisStockPriceChart stock={selected} days={days} />
                        </div>
                        <div
                          className="student-wispi-periods"
                          aria-label="가격 기록 기간"
                        >
                          {periods.map((period) => (
                            <button
                              key={period.label}
                              type="button"
                              aria-pressed={days === period.days}
                              onClick={() => setDays(period.days)}
                            >
                              {period.label}
                            </button>
                          ))}
                        </div>
                        {selected.settings.description && (
                          <p className="student-wispi-description">
                            {selected.settings.description}
                          </p>
                        )}
                        <form
                          className="student-wispi-order"
                          onSubmit={(event) => {
                            event.preventDefault();
                            void submit();
                          }}
                        >
                          <div className="student-wispi-inline">
                            <div
                              className="student-wispi-segments"
                              aria-label="주문 종류"
                            >
                              {(["BUY", "SELL"] as const).map((value) => (
                                <button
                                  key={value}
                                  type="button"
                                  aria-pressed={side === value}
                                  disabled={!!busy}
                                  onClick={() => {
                                    setSide(value);
                                    setNotice(null);
                                  }}
                                >
                                  {value === "BUY" ? "매수" : "매도"}
                                </button>
                              ))}
                            </div>
                            <span className="student-wispi-muted">
                              {side === "BUY"
                                ? `사용 가능 ${money(available)} 위스`
                                : `매도 가능 ${money(availableShares)}주`}
                            </span>
                          </div>
                          <label>
                            <span>수량</span>
                            <input
                              inputMode="numeric"
                              pattern="[0-9]*"
                              value={quantity}
                              onChange={(event) =>
                                setQuantity(
                                  event.target.value.replace(/[^0-9]/g, ""),
                                )
                              }
                              disabled={!!busy || !canOrder}
                            />
                          </label>
                          <div className="student-wispi-inline">
                            <span>
                              {side === "BUY" ? "예상 결제" : "예상 수령"}
                            </span>
                            <strong>
                              {estimate ? money(estimate.total) : "—"} 위스
                            </strong>
                          </div>
                          {estimate && (
                            <small className="student-wispi-muted">
                              수수료 {money(estimate.fee)} 위스
                              {side === "BUY" ? " 포함" : " 제외"}
                            </small>
                          )}
                          <button
                            className="student-wispi-primary"
                            type="submit"
                            disabled={
                              !!busy ||
                              !canOrder ||
                              !quantityValid ||
                              !instrumentReady ||
                              !balanceReady
                            }
                          >
                            {busy === "place"
                              ? "접수 중"
                              : `${side === "BUY" ? "매수" : "매도"} 주문 접수`}
                          </button>
                          {!instrumentReady && (
                            <p className="student-wispi-muted">
                              현재 이 종목은 {side === "BUY" ? "매수" : "매도"}
                              할 수 없습니다.
                            </p>
                          )}
                          <p className="student-wispi-muted">
                            접수한 가격으로 5~60초 뒤에 체결됩니다.
                          </p>
                        </form>
                      </section>
                    )}
                  </div>
                )}
                {notice?.key === key && (
                  <p
                    role={notice.error ? "alert" : "status"}
                    className={notice.error ? "student-wispi-error" : ""}
                  >
                    {notice.text}
                  </p>
                )}
                {pending.length > 0 && (
                  <section
                    className="student-wispi-section"
                    aria-label="체결 대기 주문"
                  >
                    <h2>체결 대기</h2>
                    <ul className="student-wispi-list">
                      {pending.map((order) => (
                        <li key={order.id}>
                          <div>
                            <strong>
                              {account.data?.stocks.find(
                                (stock) => stock.id === order.stockId,
                              )?.settings.name || "주식"}{" "}
                              · {order.side === "BUY" ? "매수" : "매도"}{" "}
                              {money(order.quantity)}주
                            </strong>
                            <small>
                              접수 가격 {money(order.unitPrice)} 위스 · 수수료{" "}
                              {money(order.fee)} 위스
                            </small>
                            <span>
                              {account.data &&
                              order.dueAtMs > studentWisStockNow(account.data)
                                ? `${Math.ceil((order.dueAtMs - studentWisStockNow(account.data)) / 1000)}초 뒤 체결 예정`
                                : "체결 확인 중"}
                            </span>
                          </div>
                          <button
                            type="button"
                            disabled={!!busy || !tradingEnabled}
                            onClick={() => void cancel(order.id)}
                            aria-label={`${account.data?.stocks.find((stock) => stock.id === order.stockId)?.settings.name || "주식"} ${order.side === "BUY" ? "매수" : "매도"} 주문 취소`}
                          >
                            취소
                          </button>
                        </li>
                      ))}
                    </ul>
                  </section>
                )}
                {!!account.data?.account.recentOrders.length && (
                  <section
                    className="student-wispi-section"
                    aria-label="최근 주문 결과"
                  >
                    <h2>최근 주문</h2>
                    <ul className="student-wispi-list">
                      {account.data.account.recentOrders.map((order) => (
                        <li key={order.id}>
                          <div>
                            <strong>
                              {account.data?.stocks.find(
                                (stock) => stock.id === order.stockId,
                              )?.settings.name || "주식"}{" "}
                              · {order.side === "BUY" ? "매수" : "매도"}{" "}
                              {money(order.quantity)}주
                            </strong>
                            <small>
                              접수 가격 {money(order.unitPrice)} 위스
                            </small>
                          </div>
                          <strong>
                            {order.status === "FILLED"
                              ? "체결 완료"
                              : order.status === "CANCELLED"
                                ? "취소"
                                : "처리 완료"}
                          </strong>
                        </li>
                      ))}
                    </ul>
                  </section>
                )}
              </>
            )}
          </div>
          {stopped && (
            <div className="student-wispi-stopped" role="alert">
              <strong>위스피의 거래가 중지되었습니다.</strong>
            </div>
          )}
        </div>
      )}
    </main>
  );
}
