import { useEffect, useRef, useState } from "react";
import { useStudentWisStockAccount } from "../../../../hooks/useStudentWisStocks";
import { OVERSEAS_STOCK_VENUE } from "../../../../lib/studentWisStockVenue";
import type {
  StudentWisStockState,
  WisStockScope,
} from "../../../../lib/studentWisStockTypes";
import { yusToWis } from "../../../../../functions/wisStockFx.mjs";
import StudentWisStockReadStatus from "./StudentWisStockReadStatus";
import StudentWisStockWalletOrders, {
  type WalletOrderTarget,
} from "./StudentWisStockWalletOrders";
import StudentWisStockWalletDetails from "./StudentWisStockWalletDetails";
import { WisStockVenueContext } from "./wisStockVenueContext";

const money = (n: number) => n.toLocaleString("ko-KR");

/** The 유스 account: funded only by exchange, holding overseas stocks. */
export default function StudentWisStockOverseasAccountPanel({
  scope,
  ownerKey,
  tradingEnabled,
  tradingEpoch,
  rate,
  onOpenExchange,
}: {
  scope: WisStockScope;
  ownerKey: string;
  tradingEnabled: boolean;
  tradingEpoch?: number;
  rate: number | null;
  onOpenExchange: () => void;
}) {
  const account = useStudentWisStockAccount(true, OVERSEAS_STOCK_VENUE);
  const [ticket, setTicket] = useState<WalletOrderTarget | null>(null);
  const [focusHolding, setFocusHolding] = useState<string>();
  const [refreshVersion, setRefreshVersion] = useState(0);
  const refreshFrom = useRef<StudentWisStockState | null>(null);
  useEffect(() => {
    setTicket(null);
    setFocusHolding(undefined);
  }, [ownerKey]);
  const mayTrade = tradingEnabled && tradingEpoch !== undefined;
  const state = account.data;
  const available = state
    ? Math.max(0, state.account.stockCash - state.account.reservedCash)
    : 0;
  return (
    <WisStockVenueContext.Provider value={OVERSEAS_STOCK_VENUE}>
      <section className="student-wispi-account" aria-label="유스 계좌">
        <StudentWisStockReadStatus
          loading={account.status === "loading"}
          error={account.error}
          label="유스 계좌"
          retry={account.retry}
        />
        <StudentWisStockWalletOrders
          key={ownerKey}
          scope={scope}
          account={account}
          tradingEnabled={mayTrade}
          tradingEpoch={tradingEpoch}
          target={ticket}
          onClose={() => {
            if (
              ticket &&
              state?.account.positions.some(
                (p) => p.stockId === ticket.stockId && p.quantity > 0,
              )
            )
              setFocusHolding(ticket.stockId);
            setTicket(null);
          }}
        />
        {state && (
          <div className="student-wispi-wallet-layout">
            <section
              className="student-wispi-wallet-funding"
              aria-label="유스 잔액"
            >
              <h2>유스 잔액</h2>
              <dl className="student-wispi-balances">
                <div>
                  <dt>계좌 잔액</dt>
                  <dd>
                    {money(state.account.stockCash)} <small>유스</small>
                    {state.account.reservedCash > 0 && (
                      <small className="student-wispi-balance-note">
                        매수 예약 {money(state.account.reservedCash)} 유스
                      </small>
                    )}
                  </dd>
                </div>
                <div>
                  <dt>매수 가능</dt>
                  <dd>
                    {money(available)} <small>유스</small>
                  </dd>
                </div>
                <div>
                  <dt>위스로 환산</dt>
                  <dd>
                    {rate
                      ? money(yusToWis(state.account.stockCash, rate))
                      : "—"}{" "}
                    <small>위스</small>
                  </dd>
                </div>
              </dl>
              <button
                type="button"
                className="student-wispi-primary"
                onClick={onOpenExchange}
              >
                환전하기
              </button>
            </section>
            <StudentWisStockWalletDetails
              key={ownerKey}
              scope={scope}
              state={state}
              graphAvailable={tradingEnabled}
              onTrade={
                mayTrade
                  ? (stockId) => setTicket({ stockId, entry: "holding" })
                  : undefined
              }
              focusHolding={focusHolding}
              onFocused={() => setFocusHolding(undefined)}
              refreshToken={
                refreshFrom.current === state
                  ? refreshVersion - 1
                  : refreshVersion
              }
              refreshDisabled={refreshFrom.current === state}
              onRefresh={() => {
                refreshFrom.current = state;
                account.retry();
                setRefreshVersion((value) => value + 1);
              }}
            />
          </div>
        )}
      </section>
    </WisStockVenueContext.Provider>
  );
}
