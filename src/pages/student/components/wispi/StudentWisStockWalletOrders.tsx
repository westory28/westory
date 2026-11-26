import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { acquirePageScrollLock } from "../../../../lib/pageScrollLock";
import InfoHelp from "../../../../components/common/InfoHelp";
import { useAppToast } from "../../../../components/common/AppToastProvider";
import { useStudentWisStockMarket } from "../../../../hooks/useStudentWisStocks";
import {
  cancelStudentWisStockOrder,
  placeStudentWisStockOrder,
  studentWisStockError,
  studentWisStockNow,
} from "../../../../lib/studentWisStockClient";
import type {
  StudentWisStockState,
  WisStockLoad,
  WisStockScope,
} from "../../../../lib/studentWisStockTypes";
import StudentWisStockReadStatus from "./StudentWisStockReadStatus";
import { useWisStockVenue } from "./wisStockVenueContext";

export type WalletOrderTarget = {
  stockId: string;
  entry: "first" | "holding";
  side?: "BUY" | "SELL";
};
const money = (value: number) => value.toLocaleString("ko-KR");
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
export default function StudentWisStockWalletOrders({
  scope,
  account,
  target,
  tradingEnabled,
  tradingEpoch,
  onClose,
}: {
  scope: WisStockScope;
  account: WisStockLoad<StudentWisStockState> & { retry: () => void };
  target: WalletOrderTarget | null;
  tradingEnabled: boolean;
  tradingEpoch?: number;
  onClose: () => void;
}) {
  const { showToast } = useAppToast();
  const venue = useWisStockVenue();
  const unit = venue.unit;
  const position = account.data?.account.positions.find(
    (item) => item.stockId === target?.stockId,
  );
  const owned = (position?.quantity ?? 0) > 0;
  const ownershipMatches = target?.entry === "holding" ? owned : !owned;
  const market = useStudentWisStockMarket(
    tradingEnabled &&
      !!target &&
      (account.status !== "ready" || ownershipMatches),
    venue,
  );
  const selected = market.data?.stocks.find(
    (stock) => stock.id === target?.stockId,
  );
  const dialogRef = useRef<HTMLDialogElement>(null);
  const open = !!target && tradingEnabled;
  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    if (!open || !dialog) return;
    dialog.showModal();
    const release = acquirePageScrollLock();
    return () => {
      dialog.close();
      release();
    };
  }, [open]);
  const ticketTitle = useRef<HTMLHeadingElement>(null);
  const lot = useRef("");
  const operation = useRef(false);
  const currentTarget = useRef(target);
  currentTarget.current = target;
  const [submitting, setSubmitting] = useState("");
  const [side, setSide] = useState<"BUY" | "SELL">("BUY");
  const [quantity, setQuantity] = useState("1");
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const [, setClock] = useState(0);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    setSide(target?.side ?? "BUY");
    setNotice("");
    lot.current = "";
  }, [target]);
  useEffect(() => {
    if (!selected || !target) return;
    const nextLot = selected.id + ":" + selected.settings.lotSize;
    if (lot.current !== nextLot) {
      setQuantity(String(selected.settings.lotSize));
      lot.current = nextLot;
      ticketTitle.current?.focus();
    }
  }, [selected?.id, selected?.settings.lotSize, target]);
  const pending = account.data?.account.pendingOrders || [];
  useEffect(() => {
    if (!pending.length) return;
    const timer = setInterval(() => setClock((value) => value + 1), 1000);
    return () => clearInterval(timer);
  }, [pending.length > 0]);
  useEffect(() => {
    if (!account.data || !selected?.haltedUntilMs) return;
    const remaining = selected.haltedUntilMs - studentWisStockNow(account.data);
    if (remaining <= 0) return;
    const timer = setTimeout(
      () => setClock((value) => value + 1),
      remaining + 1,
    );
    return () => clearTimeout(timer);
  }, [selected?.haltedUntilMs, account.data]);
  const canOrder =
    tradingEnabled &&
    market.status === "ready" &&
    market.data.tradingEpoch === tradingEpoch &&
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
  const availableShares = position
    ? position.quantity - position.reservedSellQuantity
    : 0;
  const instrumentReady =
    !!selected &&
    selected.settings.tradingStatus !== "HALTED" &&
    selected.settings.tradingStatus !== "GRADUATED" &&
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
  const orderProblem = (() => {
    if (busy && busy !== "place") return "주문 취소를 처리하고 있습니다.";
    if (!canOrder) {
      if (!tradingEnabled) return "지금은 주식을 거래할 수 없습니다.";
      if (market.data?.rules.halted) return "시장이 거래 정지 중입니다.";
      if (market.status === "error") return market.error;
      if (market.status !== "ready") return "현재 시세를 확인하고 있습니다.";
      if (market.data.tradingEpoch !== tradingEpoch)
        return "거래 상태가 바뀌어 최신 시세를 확인하고 있습니다.";
      if (account.status === "error") return account.error;
      return "주식 계좌를 확인하고 있습니다.";
    }
    if (!ownershipMatches)
      return "보유 수량이 변경되었습니다. 주문할 종목을 다시 선택해 주세요.";
    if (!selected) return "주문할 종목을 선택해 주세요.";
    if (!instrumentReady) {
      if (selected.settings.tradingStatus === "GRADUATED")
        return "거래가 끝난 종목입니다. 보유 주식은 마지막 가격으로 정산됩니다.";
      if (selected.settings.tradingStatus === "SELL_ONLY" && side === "BUY")
        return "이 종목은 매도만 가능합니다.";
      if (selected.settings.tradingStatus === "HALTED")
        return "이 종목은 거래 정지 중입니다.";
      return "이 종목은 급격한 시세 변동으로 잠시 거래가 정지되었습니다.";
    }
    if (!Number.isSafeInteger(parsed) || parsed <= 0)
      return "수량을 1주 이상 입력해 주세요.";
    if (parsed % selected.settings.lotSize !== 0)
      return `${money(selected.settings.lotSize)}주 단위로 입력해 주세요.`;
    if (parsed > (market.data?.rules.maxOrderQuantity || 0))
      return `한 번에 최대 ${money(market.data?.rules.maxOrderQuantity || 0)}주까지 주문할 수 있습니다.`;
    if (!estimate) return "주문 금액을 확인할 수 없습니다. 수량을 줄여 주세요.";
    if (!balanceReady) {
      if (side === "SELL")
        return position?.reservedSellQuantity
          ? `보유 ${money(position.quantity)}주 중 ${money(position.reservedSellQuantity)}주가 매도 대기 중입니다. 지금 매도 가능한 수량은 ${money(availableShares)}주입니다.`
          : availableShares === 0
            ? "매도할 수 있는 주식이 없습니다."
            : `매도 가능한 수량은 ${money(availableShares)}주입니다.`;
      const reserve = market.data?.rules.minimumCashReserve || 0;
      const reserved = account.data?.account.reservedCash || 0;
      const shortage = Math.max(0, estimate.total + reserve - available);
      return `${reserved ? `계좌 ${money(account.data!.account.stockCash)} ${unit} 중 ${money(reserved)} ${unit}가 대기 주문에 예약되어 있습니다. ` : ""}수수료 포함 결제 ${money(estimate.total)} ${unit}${reserve ? ` 후 최소 잔액 ${money(reserve)} ${unit}를 남겨야 하므로` : "에"} ${money(shortage)} ${unit}가 부족합니다.`;
    }
    return "";
  })();
  const submit = async () => {
    if (
      !selected ||
      !market.data ||
      !account.data ||
      operation.current ||
      orderProblem
    )
      return;
    operation.current = true;
    setBusy("place");
    setSubmitting(
      `${selected.settings.name} · ${side === "BUY" ? "매수" : "매도"} ${money(parsed)}주`,
    );
    setNotice("");
    try {
      const result = await placeStudentWisStockOrder(
        scope,
        {
          stockId: selected.id,
          side,
          quantity: parsed,
          quote: {
            price: selected.price,
            atMs: studentWisStockNow(account.data),
            marketRevision: market.data.revision,
          },
        },
        venue,
      );
      if (mounted.current && result.duplicate)
        showToast({ title: "기존 주문 상태를 확인했습니다.", tone: "info" });
    } catch (error) {
      if (mounted.current && currentTarget.current === target)
        setNotice(studentWisStockError(error));
    } finally {
      operation.current = false;
      if (mounted.current) {
        setBusy("");
        setSubmitting("");
      }
    }
  };
  const cancel = async (orderId: string) => {
    if (operation.current || !tradingEnabled) return;
    operation.current = true;
    setBusy(orderId);
    setNotice("");
    try {
      const result = await cancelStudentWisStockOrder(scope, orderId, venue);
      if (mounted.current)
        showToast({
          tone: "info",
          title:
            result.order?.status === "CANCELLED"
              ? "주문을 취소했습니다."
              : "주문 상태를 확인했습니다.",
        });
    } catch (error) {
      if (mounted.current) setNotice(studentWisStockError(error));
    } finally {
      operation.current = false;
      if (mounted.current) setBusy("");
    }
  };
  const pendingOrders = pending.length > 0 && (
    <section className="student-wispi-pending" aria-label="체결 대기 주문">
      <h2>
        주식 체결 중 <span>{pending.length}건</span>
      </h2>
      <ul className="student-wispi-list">
        {pending.map((order) => {
          const remaining = Math.max(
            0,
            Math.ceil(
              (order.dueAtMs - studentWisStockNow(account.data!)) / 1000,
            ),
          );
          const name =
            account.data?.stocks.find((stock) => stock.id === order.stockId)
              ?.settings.name || "주식";
          return (
            <li key={order.id}>
              <div>
                <strong>{name}</strong>
                <small>
                  {order.side === "BUY" ? "매수" : "매도"}{" "}
                  {money(order.quantity)}주 · {money(order.unitPrice)} {unit}
                </small>
                <span
                  className="student-wispi-countdown"
                  role="timer"
                  aria-label={`${name} 체결 남은 시간`}
                >
                  {remaining > 0 ? (
                    <>
                      남은 시간 <strong>{remaining}초</strong>
                    </>
                  ) : (
                    "체결 확인 중"
                  )}
                </span>
              </div>
              {busy === order.id ? (
                <span role="status">취소 중</span>
              ) : (
                <button
                  type="button"
                  disabled={!tradingEnabled || !!busy}
                  onClick={() => void cancel(order.id)}
                  aria-label={`${name} ${order.side === "BUY" ? "매수" : "매도"} 주문 취소`}
                >
                  취소
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
  const feedback = notice && (
    <p role="alert" className="student-wispi-error">
      {notice}
    </p>
  );
  if (!target || !tradingEnabled)
    return (
      <>
        {feedback}
        {pendingOrders}
      </>
    );
  const recent = account.data?.account.recentOrders.find(
    (order) => order.stockId === target.stockId,
  );
  return (
    <dialog
      ref={dialogRef}
      className="student-wispi-wallet-ticket"
      aria-label="종목 주문"
      onCancel={(event) => {
        event.preventDefault();
        if (!operation.current) onClose();
      }}
    >
      <div className="student-wispi-ticket-heading">
        <h2
          ref={ticketTitle}
          tabIndex={-1}
          className="student-wispi-order-title"
        >
          {selected?.settings.name ||
            account.data?.stocks.find((stock) => stock.id === target.stockId)
              ?.settings.name ||
            "종목"}{" "}
          주문
          {market.data && (
            <InfoHelp label="주식 거래 조건">
              <dl className="student-wispi-rule-help">
                <div>
                  <dt>최소 잔액</dt>
                  <dd>
                    {money(market.data.rules.minimumCashReserve)} {unit}
                  </dd>
                </div>
                <div>
                  <dt>매수 / 매도 수수료</dt>
                  <dd>
                    {market.data.rules.buyFeeBps / 100}% /{" "}
                    {market.data.rules.sellFeeBps / 100}%
                  </dd>
                </div>
                <div>
                  <dt>하루 매수 한도</dt>
                  <dd>
                    {money(market.data.rules.dailyBuyLimit)} {unit} (수수료
                    포함)
                  </dd>
                </div>
                <div>
                  <dt>하루 주문 한도</dt>
                  <dd>{money(market.data.rules.dailyOrderLimit)}회</dd>
                </div>
                <div>
                  <dt>종목별 최대 비중</dt>
                  <dd>{market.data.rules.maxConcentrationBps / 100}%</dd>
                </div>
                <div>
                  <dt>주문 간격</dt>
                  <dd>{market.data.rules.cooldownSeconds}초</dd>
                </div>
              </dl>
            </InfoHelp>
          )}
        </h2>
        <button
          type="button"
          className="student-wispi-close-ticket"
          disabled={!!busy}
          onClick={onClose}
        >
          주문 닫기
        </button>
      </div>
      <StudentWisStockReadStatus
        label="주식 시세"
        loading={market.status === "loading"}
        error={market.error}
        retry={market.retry}
      />
      <StudentWisStockReadStatus
        label="주식 계좌"
        loading={account.status === "loading" && market.status !== "loading"}
        error={account.error}
        retry={account.retry}
      />
      {account.status === "ready" && !ownershipMatches && (
        <p role="status">
          {owned
            ? "보유 수량이 변경되었습니다. 추가 주문은 주문창을 닫고 다시 선택해 주세요."
            : "현재 보유한 수량이 없습니다."}
        </p>
      )}
      {market.status === "ready" &&
        account.status === "ready" &&
        ownershipMatches &&
        (selected ? (
          <form
            className="student-wispi-order"
            onSubmit={(event) => {
              event.preventDefault();
              void submit();
            }}
          >
            <p className="student-wispi-ticket-quote">
              현재가{" "}
              <strong>
                {money(selected.price)} {unit}
              </strong>
              {owned && <> · 보유 {money(position!.quantity)}주</>}
            </p>
            <div className="student-wispi-inline">
              <div className="student-wispi-segments" aria-label="주문 종류">
                {owned ? (
                  (["BUY", "SELL"] as const).map((value) => (
                    <button
                      key={value}
                      type="button"
                      aria-pressed={side === value}
                      onClick={() => {
                        setSide(value);
                        setNotice("");
                      }}
                    >
                      {value === "BUY" ? "매수" : "매도"}
                    </button>
                  ))
                ) : (
                  <strong>첫 매수</strong>
                )}
              </div>
              <span className="student-wispi-muted">
                {side === "BUY"
                  ? `사용 가능 ${money(available)} ${unit}`
                  : `매도 가능 ${money(availableShares)}주`}
              </span>
            </div>
            <div className="student-wispi-order-action">
              <label>
                <span>수량</span>
                <input
                  aria-label="수량"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={quantity}
                  onChange={(event) =>
                    setQuantity(event.target.value.replace(/[^0-9]/g, ""))
                  }
                  aria-describedby={
                    orderProblem ? "student-wispi-order-problem" : undefined
                  }
                />
                <span aria-hidden="true">주</span>
              </label>
              {busy === "place" ? (
                <div
                  className="student-wispi-submitting"
                  role="status"
                  aria-label={`${submitting} 주문 접수 중`}
                >
                  <strong>주문 접수 중</strong>
                </div>
              ) : (
                <button
                  className="student-wispi-primary"
                  type="submit"
                  aria-label={`${side === "BUY" ? "매수" : "매도"} 주문 접수`}
                  disabled={!!orderProblem}
                  aria-describedby={
                    orderProblem ? "student-wispi-order-problem" : undefined
                  }
                  title={orderProblem || undefined}
                >
                  {side === "BUY" ? "매수" : "매도"}
                </button>
              )}
            </div>
            <div className="student-wispi-order-estimate">
              <span>{side === "BUY" ? "예상 결제" : "예상 수령"}</span>
              <strong>
                {estimate ? money(estimate.total) : "—"} {unit}
              </strong>
              {estimate && (
                <small className="student-wispi-muted">
                  (수수료 {money(estimate.fee)} {unit}
                  {side === "BUY" ? " 포함" : " 제외"})
                </small>
              )}
            </div>
            {orderProblem && (
              <p
                id="student-wispi-order-problem"
                className="student-wispi-order-problem"
                role="status"
              >
                {orderProblem}
              </p>
            )}
          </form>
        ) : (
          <p role="status">
            선택한 종목을 더 이상 거래할 수 없습니다. 다른 종목을 선택해 주세요.
          </p>
        ))}
      {feedback}
      {pendingOrders}
      {recent && (
        <p role="status">
          최근 주문 · {recent.side === "BUY" ? "매수" : "매도"}{" "}
          {money(recent.quantity)}주 ·{" "}
          <strong>
            {recent.status === "FILLED"
              ? "체결 완료"
              : recent.status === "CANCELLED"
                ? "취소"
                : "처리 완료"}
          </strong>
        </p>
      )}
    </dialog>
  );
}
