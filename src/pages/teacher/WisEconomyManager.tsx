import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import ProvenanceBadge from "../../components/common/ProvenanceBadge";
import StatePanel from "../../components/common/StatePanel";
import { useAuth } from "../../contexts/AuthContext";
import {
  WisEconomyError,
  adjustWis,
  createSemesterEconomy,
  createWisAccounts,
  deductWis,
  getWisEconomyState,
  grantInitialWis,
  grantWis,
  rebuildWisProjection,
  reverseWisEntry,
  reviewWisOrder,
  transitionWisEconomy,
  upsertWisInventory,
  upsertWisProduct,
  type WisAccount,
  type WisEconomyState,
  type WisOrder,
} from "../../lib/wisEconomy";
import "../wisEconomy.css";

type TeacherTab = "overview" | "accounts" | "shop" | "orders";
const TABS: Array<{ id: TeacherTab; label: string }> = [
  { id: "overview", label: "운영 현황" },
  { id: "accounts", label: "학생 계정" },
  { id: "shop", label: "상품·재고" },
  { id: "orders", label: "주문 처리" },
];
const formatNumber = (value: number) =>
  new Intl.NumberFormat("ko-KR").format(value);

const WisEconomyManager: React.FC = () => {
  const { config, configReady } = useAuth();
  const [params, setParams] = useSearchParams();
  const tab = (
    TABS.some((item) => item.id === params.get("tab"))
      ? params.get("tab")
      : "overview"
  ) as TeacherTab;
  const [state, setState] = useState<WisEconomyState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<WisEconomyError | null>(null);
  const [busy, setBusy] = useState("");
  const [selectedAccountId, setSelectedAccountId] = useState("");
  const [amount, setAmount] = useState("100");
  const [reason, setReason] = useState("수업 참여 보상");
  const [enrollmentIds, setEnrollmentIds] = useState("");
  const [productName, setProductName] = useState("");
  const [productDescription, setProductDescription] = useState("");
  const [productPrice, setProductPrice] = useState("100");
  const [productStock, setProductStock] = useState("10");

  const load = useCallback(async () => {
    if (!configReady) return;
    setLoading(true);
    setError(null);
    try {
      setState(
        await getWisEconomyState({
          config,
          audience: "teacher",
          provenance: "CURRENT",
        }),
      );
    } catch (caught) {
      setError(
        caught instanceof WisEconomyError
          ? caught
          : new WisEconomyError(
              "UNKNOWN",
              "위스 운영 자료를 불러오지 못했습니다.",
            ),
      );
    } finally {
      setLoading(false);
    }
  }, [config, configReady]);

  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    if (!selectedAccountId && state?.accounts[0])
      setSelectedAccountId(state.accounts[0].accountId);
  }, [selectedAccountId, state]);

  const selectedAccount = useMemo(
    () =>
      state?.accounts.find(
        (account) => account.accountId === selectedAccountId,
      ) || null,
    [selectedAccountId, state],
  );
  const reversibleEntry = useMemo(() => {
    const reversedSourceIds = new Set(
      state?.ledger
        .filter(
          (entry) =>
            entry.accountId === selectedAccountId && entry.type === "REVERSAL",
        )
        .map((entry) => entry.sourceId) || [],
    );
    return (
      state?.ledger.find(
        (entry) =>
          entry.accountId === selectedAccountId &&
          entry.type !== "REVERSAL" &&
          !reversedSourceIds.has(entry.ledgerEntryId),
      ) || null
    );
  }, [selectedAccountId, state]);
  const setTab = (next: TeacherTab) => {
    const nextParams = new URLSearchParams(params);
    nextParams.set("tab", next);
    setParams(nextParams);
  };
  const context = () => {
    if (!state?.economy)
      throw new WisEconomyError(
        "VALIDATION",
        "먼저 이번 학기 위스 운영을 시작해 주세요.",
      );
    return {
      semesterId: state.semesterId,
      expectedSemesterRevision: state.manifestRevision,
      expectedEconomyRevision: state.economy.revision,
    };
  };
  const perform = async (key: string, operation: () => Promise<unknown>) => {
    setBusy(key);
    setError(null);
    try {
      await operation();
      await load();
    } catch (caught) {
      setError(caught as WisEconomyError);
    } finally {
      setBusy("");
    }
  };

  const createEconomy = () => {
    const { year, semester } = config || { year: "", semester: "" };
    const semesterId = `${year}-${semester}`;
    return perform("economy", () =>
      createSemesterEconomy({
        semesterId,
        expectedSemesterRevision: state?.manifestRevision || 1,
        displayName: `${year}학년도 ${semester}학기 위스`,
        currencyName: "위스",
        initialGrantAmount: 500,
      }),
    );
  };
  const createAccounts = () => {
    const ids = enrollmentIds
      .split(/[\s,]+/)
      .map((value) => value.trim())
      .filter(Boolean);
    return perform("accounts", () =>
      createWisAccounts({
        ...context(),
        enrollmentIds: ids,
        reason: "W7 학기 계정 생성",
      }),
    );
  };
  const changeBalance = (
    type: "grantWis" | "deductWis" | "grantInitialWis",
  ) => {
    if (!selectedAccount) return;
    const payload = {
      ...context(),
      accountId: selectedAccount.accountId,
      expectedAccountRevision: selectedAccount.revision,
      amount:
        type === "grantInitialWis"
          ? state?.economy?.initialGrantAmount || 0
          : Number(amount),
      sourceId: `${type}:${Date.now()}`,
      reason: reason.trim(),
    };
    return perform(type, () =>
      type === "grantWis"
        ? grantWis(payload)
        : type === "deductWis"
          ? deductWis(payload)
          : grantInitialWis(payload),
    );
  };
  const adjustBalance = () => {
    if (!selectedAccount) return;
    return perform("adjustWis", () =>
      adjustWis({
        ...context(),
        accountId: selectedAccount.accountId,
        expectedAccountRevision: selectedAccount.revision,
        delta: Number(amount),
        sourceId: `adjust:${Date.now()}`,
        reason: reason.trim(),
      }),
    );
  };
  const reverseEntry = () => {
    if (!selectedAccount || !reversibleEntry) return;
    return perform("reverseWisEntry", () =>
      reverseWisEntry({
        ...context(),
        accountId: selectedAccount.accountId,
        expectedAccountRevision: selectedAccount.revision,
        ledgerEntryId: reversibleEntry.ledgerEntryId,
        reason: reason.trim() || "오지급 되돌리기",
      }),
    );
  };
  const saveProduct = async () => {
    if (!state?.economy) return;
    setBusy("product");
    setError(null);
    try {
      const product = await upsertWisProduct({
        semesterId: state.semesterId,
        expectedSemesterRevision: state.manifestRevision,
        expectedEconomyRevision: state.economy.revision,
        expectedProductRevision: null,
        name: productName.trim(),
        description: productDescription.trim(),
        imageUrl: "",
        active: true,
        reason: "상품 등록",
      });
      const productId = String(product.result.productId || "");
      const latest = await getWisEconomyState({
        config,
        audience: "teacher",
        provenance: "CURRENT",
      });
      if (!latest.economy)
        throw new WisEconomyError("VALIDATION", "위스 운영 정보가 없습니다.");
      await upsertWisInventory({
        semesterId: latest.semesterId,
        expectedSemesterRevision: latest.manifestRevision,
        expectedEconomyRevision: latest.economy.revision,
        productId,
        expectedInventoryRevision: null,
        price: Number(productPrice),
        stock: Number(productStock),
        active: true,
        reason: "학기 재고 등록",
      });
      setProductName("");
      setProductDescription("");
      await load();
    } catch (caught) {
      setError(caught as WisEconomyError);
    } finally {
      setBusy("");
    }
  };
  const reviewOrder = (
    order: WisOrder,
    action: "APPROVE" | "REJECT" | "FULFILL",
  ) =>
    perform(`order:${order.orderId}`, () =>
      reviewWisOrder({
        ...context(),
        orderId: order.orderId,
        expectedOrderRevision: order.revision,
        action,
        reason: action === "REJECT" ? "운영 확인 후 반려" : "운영 확인 완료",
      }),
    );

  if (loading) return <StatePanel state="LOADING" />;
  if (error && !state)
    return (
      <StatePanel
        state={error.kind === "PERMISSION" ? "PERMISSION" : "ERROR"}
        description={error.message}
        action={{ label: "다시 불러오기", onClick: () => void load() }}
        retryable
      />
    );

  return (
    <section
      className="wis-page wis-page--teacher"
      aria-labelledby="wis-teacher-title"
    >
      <header className="wis-page__header">
        <div>
          <p className="wis-page__eyebrow">학기별 운영</p>
          <h2 id="wis-teacher-title">위스 운영</h2>
          <p>불변 원장과 학기별 재고를 기준으로 지급·회수·주문을 관리합니다.</p>
        </div>
        {state && (
          <ProvenanceBadge value={state.provenance} readOnly={state.readOnly} />
        )}
      </header>
      {error && (
        <StatePanel
          state="ERROR"
          compact
          description={error.message}
          action={{ label: "최신 상태 불러오기", onClick: () => void load() }}
        />
      )}
      {!state?.economy ? (
        <section
          className="wis-panel wis-empty-action"
          aria-label="이번 학기 위스 운영 시작"
        >
          <StatePanel
            state="EMPTY"
            title="이번 학기 위스 운영을 시작해 주세요."
            description="이전 학기 잔액은 옮기지 않으며, 학생마다 초기 500위스를 지급한 뒤 운영을 시작합니다."
          />
          <button
            type="button"
            disabled={busy === "economy"}
            onClick={() => void createEconomy()}
          >
            {busy === "economy" ? "처리 중" : "운영 만들기"}
          </button>
        </section>
      ) : (
        <>
          <div className="wis-kpi-grid">
            <article>
              <span>운영 상태</span>
              <strong>{state.economy.status}</strong>
            </article>
            <article>
              <span>학생 계정</span>
              <strong>{formatNumber(state.accounts.length)}개</strong>
            </article>
            <article>
              <span>원장 항목</span>
              <strong>{formatNumber(state.ledger.length)}건</strong>
            </article>
            <article>
              <span>처리 대기 주문</span>
              <strong>
                {formatNumber(
                  state.orders.filter((order) => order.status === "REQUESTED")
                    .length,
                )}
                건
              </strong>
            </article>
          </div>
          <nav className="wis-tabs" aria-label="위스 운영 메뉴">
            {TABS.map((item) => (
              <button
                key={item.id}
                type="button"
                className={tab === item.id ? "is-active" : ""}
                aria-current={tab === item.id ? "page" : undefined}
                onClick={() => setTab(item.id)}
              >
                {item.label}
              </button>
            ))}
          </nav>

          {tab === "overview" && (
            <div className="wis-teacher-grid">
              <section className="wis-panel">
                <h2>운영 전환</h2>
                <p>
                  계정 생성과 최초 지급을 마친 뒤 상점을 열 수 있습니다. 종료한
                  학기는 다시 열 수 없습니다.
                </p>
                <div className="wis-actions">
                  {state.economy.status === "ACTIVE_INITIALIZING" && (
                    <button
                      type="button"
                      onClick={() =>
                        void perform("transition", () =>
                          transitionWisEconomy({
                            ...context(),
                            targetStatus: "ACTIVE_OPEN",
                            reason: "학기 위스 운영 시작",
                          }),
                        )
                      }
                    >
                      상점 열기
                    </button>
                  )}
                  {state.economy.status === "ACTIVE_OPEN" && (
                    <button
                      type="button"
                      className="is-danger"
                      onClick={() =>
                        void perform("transition", () =>
                          transitionWisEconomy({
                            ...context(),
                            targetStatus: "CLOSED",
                            reason: "학기 운영 종료",
                          }),
                        )
                      }
                    >
                      운영 종료
                    </button>
                  )}
                  {state.economy.status === "CLOSED" && (
                    <button
                      type="button"
                      onClick={() =>
                        void perform("transition", () =>
                          transitionWisEconomy({
                            ...context(),
                            targetStatus: "ARCHIVED",
                            reason: "학기 기록 보관",
                          }),
                        )
                      }
                    >
                      보관 확정
                    </button>
                  )}
                </div>
              </section>
              <section className="wis-panel">
                <h2>계정 일괄 생성</h2>
                <label>
                  활성 Enrollment ID
                  <textarea
                    value={enrollmentIds}
                    onChange={(event) => setEnrollmentIds(event.target.value)}
                    placeholder="쉼표 또는 줄바꿈으로 구분"
                  />
                </label>
                <button
                  type="button"
                  disabled={!enrollmentIds.trim() || busy === "accounts"}
                  onClick={() => void createAccounts()}
                >
                  계정 만들기
                </button>
              </section>
            </div>
          )}

          {tab === "accounts" && (
            <div className="wis-master-detail">
              <div
                className="wis-account-list"
                role="list"
                aria-label="위스 학생 계정"
              >
                {state.accounts.map((account) => (
                  <button
                    key={account.accountId}
                    type="button"
                    className={
                      selectedAccountId === account.accountId ? "is-active" : ""
                    }
                    onClick={() => setSelectedAccountId(account.accountId)}
                  >
                    <strong>{account.displayName}</strong>
                    <span>
                      {formatNumber(account.balance)}{" "}
                      {state.economy?.currencyName}
                    </span>
                  </button>
                ))}
              </div>
              <AccountPanel
                account={selectedAccount}
                amount={amount}
                reason={reason}
                busy={busy}
                initialAmount={state.economy.initialGrantAmount}
                reversibleEntryLabel={
                  reversibleEntry?.reason || reversibleEntry?.type || ""
                }
                onAmount={setAmount}
                onReason={setReason}
                onGrant={() => void changeBalance("grantWis")}
                onDeduct={() => void changeBalance("deductWis")}
                onAdjust={() => void adjustBalance()}
                onReverse={() => void reverseEntry()}
                onInitial={() => void changeBalance("grantInitialWis")}
                onRebuild={() =>
                  selectedAccount &&
                  void perform("rebuild", () =>
                    rebuildWisProjection({
                      semesterId: state.semesterId,
                      expectedSemesterRevision: state.manifestRevision,
                      expectedEconomyRevision: state.economy!.revision,
                      accountId: selectedAccount.accountId,
                      reason: "원장 기준 projection 재검증",
                    }),
                  )
                }
              />
            </div>
          )}

          {tab === "shop" && (
            <div className="wis-teacher-grid">
              <section className="wis-panel">
                <h2>상품과 학기 재고 등록</h2>
                <label>
                  상품명
                  <input
                    value={productName}
                    onChange={(event) => setProductName(event.target.value)}
                  />
                </label>
                <label>
                  설명
                  <textarea
                    value={productDescription}
                    onChange={(event) =>
                      setProductDescription(event.target.value)
                    }
                  />
                </label>
                <div className="wis-form-row">
                  <label>
                    가격
                    <input
                      inputMode="numeric"
                      value={productPrice}
                      onChange={(event) => setProductPrice(event.target.value)}
                    />
                  </label>
                  <label>
                    재고
                    <input
                      inputMode="numeric"
                      value={productStock}
                      onChange={(event) => setProductStock(event.target.value)}
                    />
                  </label>
                </div>
                <button
                  type="button"
                  disabled={!productName.trim() || busy === "product"}
                  onClick={() => void saveProduct()}
                >
                  상품·재고 등록
                </button>
              </section>
              <section className="wis-panel">
                <h2>이번 학기 재고</h2>
                <ul className="wis-order-list">
                  {state.inventory.map((item) => (
                    <li key={item.inventoryId}>
                      <div>
                        <strong>{item.productName}</strong>
                        <span>{formatNumber(item.price)} 위스</span>
                      </div>
                      <span>
                        판매 가능 {item.available} · 예약 {item.reserved} · 완료{" "}
                        {item.sold}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            </div>
          )}

          {tab === "orders" && (
            <section className="wis-panel">
              <h2>주문 처리</h2>
              {state.orders.length === 0 ? (
                <StatePanel
                  state="EMPTY"
                  compact
                  title="처리할 주문이 없습니다."
                />
              ) : (
                <div
                  className="wis-table-wrap"
                  tabIndex={0}
                  role="region"
                  aria-label="위스 주문 표"
                >
                  <table>
                    <thead>
                      <tr>
                        <th>학생</th>
                        <th>상품</th>
                        <th>금액</th>
                        <th>상태</th>
                        <th>처리</th>
                      </tr>
                    </thead>
                    <tbody>
                      {state.orders.map((order) => (
                        <tr key={order.orderId}>
                          <td>
                            {state.accounts.find(
                              (account) =>
                                account.accountId === order.accountId,
                            )?.displayName || order.studentUid}
                          </td>
                          <td>
                            {order.productName} × {order.quantity}
                          </td>
                          <td>{formatNumber(order.totalPrice)}</td>
                          <td>{order.status}</td>
                          <td>
                            <div className="wis-actions">
                              {order.status === "REQUESTED" && (
                                <>
                                  <button
                                    type="button"
                                    onClick={() =>
                                      void reviewOrder(order, "APPROVE")
                                    }
                                  >
                                    승인
                                  </button>
                                  <button
                                    type="button"
                                    className="is-danger"
                                    onClick={() =>
                                      void reviewOrder(order, "REJECT")
                                    }
                                  >
                                    반려·환불
                                  </button>
                                </>
                              )}
                              {order.status === "APPROVED" && (
                                <button
                                  type="button"
                                  onClick={() =>
                                    void reviewOrder(order, "FULFILL")
                                  }
                                >
                                  수령 완료
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          )}
        </>
      )}
    </section>
  );
};

const AccountPanel: React.FC<{
  account: WisAccount | null;
  amount: string;
  reason: string;
  busy: string;
  initialAmount: number;
  reversibleEntryLabel: string;
  onAmount: (value: string) => void;
  onReason: (value: string) => void;
  onGrant: () => void;
  onDeduct: () => void;
  onAdjust: () => void;
  onReverse: () => void;
  onInitial: () => void;
  onRebuild: () => void;
}> = ({
  account,
  amount,
  reason,
  busy,
  initialAmount,
  reversibleEntryLabel,
  onAmount,
  onReason,
  onGrant,
  onDeduct,
  onAdjust,
  onReverse,
  onInitial,
  onRebuild,
}) => {
  if (!account)
    return (
      <StatePanel state="EMPTY" compact title="학생 계정을 선택해 주세요." />
    );
  return (
    <section className="wis-panel">
      <div className="wis-panel__heading">
        <div>
          <p className="wis-page__eyebrow">선택한 계정</p>
          <h2>{account.displayName}</h2>
        </div>
        <strong>{formatNumber(account.balance)} 위스</strong>
      </div>
      <label>
        수량 또는 정정값
        <input
          inputMode="numeric"
          value={amount}
          onChange={(event) => onAmount(event.target.value)}
        />
      </label>
      <label>
        사유
        <input
          value={reason}
          onChange={(event) => onReason(event.target.value)}
        />
      </label>
      <div className="wis-actions">
        {initialAmount > 0 && !account.initialGrantLedgerEntryId && (
          <button type="button" disabled={busy !== ""} onClick={onInitial}>
            최초 {formatNumber(initialAmount)} 지급
          </button>
        )}
        <button type="button" disabled={busy !== ""} onClick={onGrant}>
          지급
        </button>
        <button
          type="button"
          className="is-danger"
          disabled={busy !== ""}
          onClick={onDeduct}
        >
          회수
        </button>
        <button
          type="button"
          className="is-secondary"
          disabled={busy !== ""}
          onClick={onAdjust}
        >
          증감 정정
        </button>
        {reversibleEntryLabel && (
          <button
            type="button"
            className="is-secondary"
            disabled={busy !== ""}
            onClick={onReverse}
          >
            최근 항목 되돌리기
          </button>
        )}
        <button
          type="button"
          className="is-secondary"
          disabled={busy !== ""}
          onClick={onRebuild}
        >
          원장 대조
        </button>
      </div>
      {reversibleEntryLabel && <p>되돌리기 대상: {reversibleEntryLabel}</p>}
    </section>
  );
};

export default WisEconomyManager;
