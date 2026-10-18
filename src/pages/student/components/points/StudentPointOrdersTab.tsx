import React from "react";
import { POINT_ORDER_STATUS_LABELS } from "../../../../constants/pointLabels";
import {
  formatPointDateTime,
  formatWisAmount,
} from "../../../../lib/pointFormatters";
import type { PointOrder, PointOrderStatus } from "../../../../types";
import "../../../../components/common/wisShop.css";
interface StudentPointOrdersTabProps {
  orderFilter: "all" | PointOrderStatus;
  orders: PointOrder[];
  onOrderFilterChange: (value: "all" | PointOrderStatus) => void;
  onCancelOrder?: (order: PointOrder) => void;
  cancellingOrderId?: string;
  feedback?: string;
  onOpenShop?: () => void;
  onRefresh?: () => void;
}
const stages: PointOrderStatus[] = [
  "requested",
  "approved",
  "ready",
  "fulfilled",
];
const StudentPointOrdersTab: React.FC<StudentPointOrdersTabProps> = ({
  orderFilter,
  orders,
  onOrderFilterChange,
  onCancelOrder,
  cancellingOrderId = "",
  feedback = "",
  onOpenShop,
  onRefresh,
}) => (
  <section className="wis-shop" aria-label="주문 내역">
    <header className="wis-shop-header">
      <h2>주문 내역</h2>
      {onRefresh && (
        <button
          type="button"
          className="wis-shop-button"
          onClick={onRefresh}
          disabled={Boolean(cancellingOrderId)}
        >
          새로고침
        </button>
      )}
      {onOpenShop && (
        <button type="button" className="wis-shop-button" onClick={onOpenShop}>
          상점 둘러보기
        </button>
      )}
    </header>
    <div className="wis-orders-filters" aria-label="주문 상태 필터">
      <button
        type="button"
        className="wis-shop-button"
        aria-pressed={orderFilter === "all"}
        onClick={() => onOrderFilterChange("all")}
      >
        전체
      </button>
      {(Object.keys(POINT_ORDER_STATUS_LABELS) as PointOrderStatus[]).map(
        (status) => (
          <button
            key={status}
            type="button"
            className="wis-shop-button"
            aria-pressed={orderFilter === status}
            onClick={() => onOrderFilterChange(status)}
          >
            {POINT_ORDER_STATUS_LABELS[status]}
          </button>
        ),
      )}
    </div>
    {feedback && (
      <p className="wis-shop-feedback" role="status">
        {feedback}
      </p>
    )}
    {!orders.length && (
      <div className="wis-shop-empty">
        {orderFilter === "all"
          ? "아직 주문한 상품이 없습니다."
          : "해당 상태의 주문이 없습니다."}
      </div>
    )}
    <div>
      {orders.map((order) => {
        const cancelled =
          order.status === "cancelled" || order.status === "rejected";
        const dates = [
          order.requestedAt,
          order.approvedAt,
          order.readyAt,
          order.fulfilledAt,
        ];
        return (
          <article key={order.id} className="wis-order">
            <div className="wis-order-heading">
              <div>
                <time>{formatPointDateTime(order.requestedAt)}</time>
                <h3>{order.productName}</h3>
              </div>
              <span className="wis-order-status">
                {POINT_ORDER_STATUS_LABELS[order.status]}
              </span>
            </div>
            <div className="wis-order-summary">
              <strong>{formatWisAmount(order.priceSnapshot)}</strong>
              {order.quantity || 1}개{cancelled ? " · 환불 완료" : ""}
            </div>
            {!cancelled && (
              <ol className="wis-order-progress" aria-label="주문 진행 단계">
                {stages.map((stage, index) => (
                  <li
                    key={stage}
                    data-complete={index <= stages.indexOf(order.status)}
                    aria-current={order.status === stage ? "step" : undefined}
                  >
                    {POINT_ORDER_STATUS_LABELS[stage]}
                    {dates[index] && (
                      <time>{formatPointDateTime(dates[index])}</time>
                    )}
                  </li>
                ))}
              </ol>
            )}
            {order.status === "ready" && (
              <p className="wis-shop-feedback">
                상품이 준비되었습니다. 선생님께 수령해 주세요.
              </p>
            )}
            {order.memo && (
              <p className="wis-order-memo">
                <strong>내 요청</strong>
                {order.memo}
              </p>
            )}
            {order.reviewReason && (
              <p className="wis-order-memo">
                <strong>선생님 메모</strong>
                {order.reviewReason}
              </p>
            )}
            {order.status === "requested" &&
              !order.readOnly &&
              onCancelOrder && (
                <button
                  type="button"
                  className="wis-shop-button"
                  style={{ marginTop: 16 }}
                  disabled={Boolean(cancellingOrderId)}
                  onClick={() => onCancelOrder(order)}
                >
                  {cancellingOrderId === order.id
                    ? "취소 처리 중…"
                    : "주문 취소"}
                </button>
              )}
          </article>
        );
      })}
    </div>
  </section>
);
export default StudentPointOrdersTab;
