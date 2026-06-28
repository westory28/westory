import React from "react";
import {
  POINT_ORDER_STATUS_LABELS,
  getPointFeedbackToneClass,
} from "../../../../constants/pointLabels";
import {
  formatPointDateTime,
  formatPointStudentLabel,
  formatPointTimeOnly,
  formatWisAmount,
} from "../../../../lib/pointFormatters";
import type { PointOrder, PointOrderStatus } from "../../../../types";

interface PointRequestsTabProps {
  orders: PointOrder[];
  orderFilter: "all" | PointOrderStatus;
  selectedOrderId: string;
  selectedOrder: PointOrder | null;
  orderMemo: string;
  orderFeedback: string;
  orderSavingOrderId: string;
  orderSavingStatus: PointOrderStatus | null;
  canManage: boolean;
  onFilterChange: (value: "all" | PointOrderStatus) => void;
  onSelectOrder: (orderId: string) => void;
  onOrderMemoChange: (value: string) => void;
  onSaveOrder: (status: PointOrderStatus) => void;
}

const PURCHASE_FLOW_STEPS = [
  { key: "requested", label: "요청" },
  { key: "approved", label: "승인" },
  { key: "fulfilled", label: "지급" },
] as const;

const ORDER_SAVING_LABELS: Record<PointOrderStatus, string> = {
  requested: "승인 취소 중...",
  approved: "승인 중...",
  rejected: "반려 중...",
  fulfilled: "지급 처리 중...",
  cancelled: "취소 처리 중...",
};

const getOrderStepIndex = (status?: PointOrderStatus | null) => {
  if (status === "fulfilled") return 2;
  if (status === "approved") return 1;
  return 0;
};

const isTerminalOrderStatus = (status?: PointOrderStatus | null) =>
  status === "rejected" || status === "cancelled";

const getOrderStatusToneClass = (status: PointOrderStatus) => {
  if (status === "fulfilled")
    return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (status === "approved") return "border-blue-200 bg-blue-50 text-blue-700";
  if (status === "rejected" || status === "cancelled")
    return "border-rose-200 bg-rose-50 text-rose-700";
  return "border-blue-200 bg-blue-50 text-blue-700";
};

const getOrderStudentName = (order: PointOrder) =>
  order.studentName || "(이름 없음)";

const getOrderStudentLabel = (order: PointOrder | null) =>
  order
    ? formatPointStudentLabel({
        grade: order.grade || "",
        class: order.class || "",
        number: order.number || "",
      })
    : "";

const OrderActionContent: React.FC<{
  isSaving: boolean;
  idleLabel: string;
  savingLabel: string;
}> = ({ isSaving, idleLabel, savingLabel }) => (
  <span className="inline-flex items-center justify-center gap-2">
    {isSaving && (
      <span
        className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent"
        aria-hidden="true"
      />
    )}
    <span>{isSaving ? savingLabel : idleLabel}</span>
  </span>
);

const isSelectedOrderSaving = (
  selectedOrder: PointOrder | null,
  orderSavingOrderId: string,
  orderSavingStatus: PointOrderStatus | null,
) =>
  Boolean(
    selectedOrder &&
    orderSavingOrderId === selectedOrder.id &&
    orderSavingStatus,
  );

const isApprovalToggleSaving = (
  selectedOrder: PointOrder | null,
  orderSavingOrderId: string,
  orderSavingStatus: PointOrderStatus | null,
) =>
  isSelectedOrderSaving(selectedOrder, orderSavingOrderId, orderSavingStatus) &&
  ((selectedOrder?.status === "approved" &&
    orderSavingStatus === "requested") ||
    (selectedOrder?.status !== "approved" && orderSavingStatus === "approved"));

const OrderProcessStepper: React.FC<{
  status?: PointOrderStatus | null;
  compact?: boolean;
}> = ({ status = "requested", compact = false }) => {
  const activeIndex = getOrderStepIndex(status);
  const terminal = isTerminalOrderStatus(status);

  return (
    <div
      className={
        compact
          ? "w-full min-w-[9rem]"
          : "rounded-lg border border-gray-200 bg-white px-5 py-4"
      }
    >
      {!compact && (
        <div className="mb-3 text-sm font-bold text-gray-900">처리 단계</div>
      )}
      <div className="grid grid-cols-[1fr_auto_1fr_auto_1fr] items-start gap-2">
        {PURCHASE_FLOW_STEPS.map((step, index) => {
          const isCurrent = index === activeIndex && !terminal;
          const isComplete = !terminal && index < activeIndex;
          const isHighlighted = isCurrent || isComplete;
          return (
            <React.Fragment key={step.key}>
              <div className="grid justify-items-center gap-1">
                <span
                  className={[
                    "inline-flex items-center justify-center rounded-full border font-bold",
                    compact ? "h-5 w-5 text-[10px]" : "h-8 w-8 text-sm",
                    terminal && index === 0
                      ? "border-rose-200 bg-rose-50 text-rose-700"
                      : isCurrent
                        ? "border-blue-600 bg-blue-600 text-white"
                        : isComplete
                          ? "border-blue-200 bg-blue-50 text-blue-700"
                          : "border-gray-200 bg-gray-100 text-gray-500",
                  ].join(" ")}
                >
                  {index + 1}
                </span>
                <span
                  className={[
                    "font-bold",
                    compact ? "text-[10px]" : "text-sm",
                    terminal && index === 0
                      ? "text-rose-700"
                      : isHighlighted
                        ? "text-blue-700"
                        : "text-gray-600",
                  ].join(" ")}
                >
                  {step.label}
                </span>
              </div>
              {index < PURCHASE_FLOW_STEPS.length - 1 && (
                <span
                  className={[
                    compact ? "mt-2.5 w-6" : "mt-4 w-full min-w-12",
                    "border-t border-dashed",
                    !terminal && index < activeIndex
                      ? "border-blue-300"
                      : "border-gray-300",
                  ].join(" ")}
                  aria-hidden="true"
                ></span>
              )}
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
};

const OrderDetailPanel: React.FC<{
  order: PointOrder;
  orderMemo: string;
  orderFeedback: string;
  orderSavingOrderId: string;
  orderSavingStatus: PointOrderStatus | null;
  canManage: boolean;
  onOrderMemoChange: (value: string) => void;
  onSaveOrder: (status: PointOrderStatus) => void;
}> = ({
  order,
  orderMemo,
  orderFeedback,
  orderSavingOrderId,
  orderSavingStatus,
  canManage,
  onOrderMemoChange,
  onSaveOrder,
}) => {
  const isSavingThisOrder = isSelectedOrderSaving(
    order,
    orderSavingOrderId,
    orderSavingStatus,
  );
  const savingLabel = orderSavingStatus
    ? ORDER_SAVING_LABELS[orderSavingStatus]
    : "처리 중...";

  return (
    <div
      className="relative overflow-hidden rounded-xl border border-blue-100 bg-white shadow-sm"
      aria-busy={isSavingThisOrder}
    >
      {isSavingThisOrder && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-white/80 px-4 backdrop-blur-[1px]">
          <div className="inline-flex items-center gap-3 rounded-full border border-amber-200 bg-amber-50 px-4 py-2 text-sm font-bold text-amber-800 shadow-sm">
            <span
              className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent"
              aria-hidden="true"
            />
            <span>{savingLabel}</span>
          </div>
        </div>
      )}

      <div className="grid gap-5 p-4 lg:grid-cols-[minmax(0,1fr)_minmax(17rem,0.55fr)] lg:p-5">
        <div className="min-w-0">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <div className="text-xs font-bold uppercase text-blue-700">
                요청 상세
              </div>
              <h3 className="mt-1 truncate text-lg font-extrabold text-gray-900">
                {order.productName}
              </h3>
              <div className="mt-1 text-sm font-medium text-gray-500">
                {getOrderStudentName(order)} ·{" "}
                {getOrderStudentLabel(order) || "소속 정보 없음"}
              </div>
            </div>
            <span
              className={`inline-flex shrink-0 rounded-full border px-3 py-1 text-xs font-bold ${
                isSavingThisOrder
                  ? "border-amber-200 bg-amber-50 text-amber-700"
                  : getOrderStatusToneClass(order.status)
              }`}
            >
              {isSavingThisOrder
                ? "처리 중"
                : POINT_ORDER_STATUS_LABELS[order.status] || order.status}
            </span>
          </div>

          <div className="mt-4">
            <OrderProcessStepper status={order.status} />
          </div>

          <dl className="mt-4 grid overflow-hidden rounded-lg border border-gray-200 bg-gray-50 sm:grid-cols-2 xl:grid-cols-4">
            <div className="border-b border-gray-200 p-3 sm:border-r xl:border-b-0">
              <dt className="text-xs font-bold text-gray-500">차감 위스</dt>
              <dd className="mt-1 font-bold text-gray-900 whitespace-nowrap">
                {formatWisAmount(order.priceSnapshot)}
              </dd>
            </div>
            <div className="border-b border-gray-200 p-3 xl:border-r xl:border-b-0">
              <dt className="text-xs font-bold text-gray-500">요청 시각</dt>
              <dd className="mt-1 font-bold text-gray-900">
                {formatPointDateTime(order.requestedAt)}
              </dd>
            </div>
            <div className="border-b border-gray-200 p-3 sm:border-r sm:border-b-0">
              <dt className="text-xs font-bold text-gray-500">최근 처리</dt>
              <dd className="mt-1 font-bold text-gray-900">
                {formatPointDateTime(order.reviewedAt)}
              </dd>
            </div>
            <div className="p-3">
              <dt className="text-xs font-bold text-gray-500">현재 상태</dt>
              <dd className="mt-1 font-bold text-gray-900">
                {POINT_ORDER_STATUS_LABELS[order.status] || order.status}
              </dd>
            </div>
          </dl>

          <label className="mt-4 block text-sm font-bold text-gray-700">
            처리 메모
          </label>
          <textarea
            value={orderMemo}
            onChange={(event) => onOrderMemoChange(event.target.value)}
            rows={3}
            placeholder="학생 화면에 함께 표시할 메모를 입력해 주세요."
            className="mt-2 w-full rounded-lg border border-gray-300 px-4 py-3 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
            disabled={!canManage || Boolean(orderSavingStatus)}
          />
          {!!orderFeedback && (
            <div
              role="status"
              aria-live="polite"
              className={`mt-3 rounded-lg px-4 py-3 text-sm font-bold ${getPointFeedbackToneClass(orderFeedback)}`}
            >
              {orderFeedback}
            </div>
          )}
        </div>

        <div className="flex flex-col justify-between rounded-lg border border-gray-200 bg-gray-50 p-4">
          <div>
            <div className="text-sm font-extrabold text-gray-900">처리</div>
          </div>
          <div className="mt-4 grid gap-2">
            <button
              type="button"
              disabled={
                !canManage ||
                Boolean(orderSavingStatus) ||
                !["requested", "approved"].includes(order.status)
              }
              onClick={() =>
                onSaveOrder(
                  order.status === "approved" ? "requested" : "approved",
                )
              }
              className="min-h-11 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-blue-700 disabled:bg-blue-300"
            >
              <OrderActionContent
                isSaving={isApprovalToggleSaving(
                  order,
                  orderSavingOrderId,
                  orderSavingStatus,
                )}
                idleLabel={order.status === "approved" ? "승인 취소" : "승인"}
                savingLabel={savingLabel}
              />
            </button>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-1">
              <button
                type="button"
                disabled={
                  !canManage ||
                  Boolean(orderSavingStatus) ||
                  order.status !== "requested"
                }
                onClick={() => onSaveOrder("rejected")}
                className="min-h-11 rounded-lg bg-rose-500 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-rose-600 disabled:bg-rose-300"
              >
                <OrderActionContent
                  isSaving={
                    isSavingThisOrder && orderSavingStatus === "rejected"
                  }
                  idleLabel="반려"
                  savingLabel={ORDER_SAVING_LABELS.rejected}
                />
              </button>
              <button
                type="button"
                disabled={
                  !canManage ||
                  Boolean(orderSavingStatus) ||
                  order.status !== "approved"
                }
                onClick={() => onSaveOrder("fulfilled")}
                className="min-h-11 rounded-lg border border-emerald-500 bg-emerald-50 px-4 py-2.5 text-sm font-bold text-emerald-700 transition hover:bg-emerald-100 disabled:border-emerald-200 disabled:text-emerald-300"
              >
                <OrderActionContent
                  isSaving={
                    isSavingThisOrder && orderSavingStatus === "fulfilled"
                  }
                  idleLabel="지급 완료"
                  savingLabel={ORDER_SAVING_LABELS.fulfilled}
                />
              </button>
            </div>
            <button
              type="button"
              disabled={
                !canManage ||
                Boolean(orderSavingStatus) ||
                order.status !== "requested"
              }
              onClick={() => onSaveOrder("cancelled")}
              className="min-h-11 rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm font-bold text-gray-700 transition hover:bg-gray-50 disabled:text-gray-300"
            >
              <OrderActionContent
                isSaving={
                  isSavingThisOrder && orderSavingStatus === "cancelled"
                }
                idleLabel="요청 취소 처리"
                savingLabel={ORDER_SAVING_LABELS.cancelled}
              />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

const PointRequestsTab: React.FC<PointRequestsTabProps> = ({
  orders,
  orderFilter,
  selectedOrderId,
  selectedOrder,
  orderMemo,
  orderFeedback,
  orderSavingOrderId,
  orderSavingStatus,
  canManage,
  onFilterChange,
  onSelectOrder,
  onOrderMemoChange,
  onSaveOrder,
}) => (
  <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
    <div className="flex flex-col gap-3 border-b border-gray-100 bg-gray-50 p-5 md:flex-row md:items-center md:justify-between">
      <div>
        <h2 className="text-lg font-bold text-gray-800">구매 요청 목록</h2>
        <div className="mt-1 text-sm font-medium text-gray-500">
          {orders.length.toLocaleString("ko-KR")}건
        </div>
      </div>
      <select
        value={orderFilter}
        onChange={(event) =>
          onFilterChange(event.target.value as "all" | PointOrderStatus)
        }
        className="rounded-lg border border-gray-300 px-3 py-2 text-sm font-bold text-gray-700"
      >
        <option value="all">전체 상태</option>
        {(Object.keys(POINT_ORDER_STATUS_LABELS) as PointOrderStatus[]).map(
          (status) => (
            <option key={status} value={status}>
              {POINT_ORDER_STATUS_LABELS[status]}
            </option>
          ),
        )}
      </select>
    </div>
    <div className="overflow-x-auto">
      <table className="min-w-[760px] w-full table-fixed text-sm text-left">
        <thead className="bg-gray-100 text-xs font-bold uppercase text-gray-600">
          <tr>
            <th className="w-[17%] p-4">학생 정보</th>
            <th className="w-[25%] p-4">상품명</th>
            <th className="w-[14%] p-4 text-right">차감 위스</th>
            <th className="w-[11%] p-4 text-right">요청 시각</th>
            <th className="w-[22%] p-4 text-center">처리 단계</th>
            <th className="w-[11%] p-4 text-center">상태</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100 bg-white">
          {orders.length === 0 && (
            <tr>
              <td colSpan={6} className="p-10 text-center text-gray-400">
                선택한 조건에 맞는 요청이 없습니다.
              </td>
            </tr>
          )}
          {orders.map((order) => {
            const isSelected = selectedOrderId === order.id;
            const isSavingOrder = orderSavingOrderId === order.id;

            return (
              <React.Fragment key={order.id}>
                <tr
                  className={`cursor-pointer transition ${
                    isSelected
                      ? "bg-blue-50"
                      : isSavingOrder
                        ? "bg-amber-50/60"
                        : "hover:bg-gray-50"
                  }`}
                  onClick={() => onSelectOrder(order.id)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      onSelectOrder(order.id);
                    }
                  }}
                  role="button"
                  tabIndex={0}
                  aria-expanded={isSelected}
                >
                  <td
                    className="p-4"
                    title={[
                      getOrderStudentName(order),
                      getOrderStudentLabel(order),
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  >
                    <div className="min-w-0">
                      <div className="truncate font-bold text-gray-800">
                        {getOrderStudentName(order)}
                      </div>
                      <div className="mt-1 truncate text-xs font-medium text-gray-500">
                        {getOrderStudentLabel(order) || "소속 정보 없음"}
                      </div>
                    </div>
                  </td>
                  <td
                    className="truncate p-4 text-gray-700"
                    title={order.productName}
                  >
                    {order.productName}
                  </td>
                  <td className="p-4 text-right font-bold text-gray-800 whitespace-nowrap">
                    {formatWisAmount(order.priceSnapshot)}
                  </td>
                  <td className="p-4 text-right text-gray-500 whitespace-nowrap">
                    {formatPointTimeOnly(order.requestedAt)}
                  </td>
                  <td className="p-4">
                    <OrderProcessStepper status={order.status} compact />
                  </td>
                  <td className="p-4 text-center">
                    <span
                      className={`inline-flex rounded-full border px-3 py-1 text-xs font-bold ${
                        isSavingOrder
                          ? "border-amber-200 bg-amber-50 text-amber-700"
                          : getOrderStatusToneClass(order.status)
                      }`}
                    >
                      {isSavingOrder
                        ? "처리 중"
                        : POINT_ORDER_STATUS_LABELS[order.status] ||
                          order.status}
                    </span>
                  </td>
                </tr>
                {isSelected && selectedOrder && (
                  <tr className="bg-blue-50/40">
                    <td colSpan={6} className="px-4 pb-5 pt-0">
                      <OrderDetailPanel
                        order={selectedOrder}
                        orderMemo={orderMemo}
                        orderFeedback={orderFeedback}
                        orderSavingOrderId={orderSavingOrderId}
                        orderSavingStatus={orderSavingStatus}
                        canManage={canManage}
                        onOrderMemoChange={onOrderMemoChange}
                        onSaveOrder={onSaveOrder}
                      />
                    </td>
                  </tr>
                )}
              </React.Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  </div>
);

export default PointRequestsTab;
