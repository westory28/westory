import React, { useMemo, useState } from "react";
import { useAppDialog } from "../../../../components/common/AppDialogProvider";
import InfoHelp from "../../../../components/common/InfoHelp";
import {
  POINT_ORDER_STATUS_LABELS,
  getPointFeedbackToneClass,
} from "../../../../constants/pointLabels";
import {
  formatPointDateTime,
  formatPointStudentLabel,
  formatWisAmount,
} from "../../../../lib/pointFormatters";
import type { PointOrder, PointOrderStatus } from "../../../../types";
import "./TeacherWisShop.css";

interface PointRequestsTabProps {
  orders: PointOrder[];
  allOrders?: PointOrder[];
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
  onRefresh?: () => void;
}

const FLOW_STEPS: {
  key: PointOrderStatus;
  label: string;
  dateKey: "requestedAt" | "approvedAt" | "readyAt" | "fulfilledAt";
}[] = [
  { key: "requested", label: "주문 접수", dateKey: "requestedAt" },
  { key: "approved", label: "승인", dateKey: "approvedAt" },
  { key: "ready", label: "수령 준비", dateKey: "readyAt" },
  { key: "fulfilled", label: "지급 완료", dateKey: "fulfilledAt" },
];
const QUEUE_LABELS: Record<string, string> = {
  requested: "승인 대기",
  approved: "상품 준비",
  ready: "수령 대기",
  fulfilled: "지급 완료",
};
const NEXT_ACTION: Partial<
  Record<PointOrderStatus, { status: PointOrderStatus; label: string }>
> = {
  requested: { status: "approved", label: "주문 승인" },
  approved: { status: "ready", label: "수령 준비 완료" },
  ready: { status: "fulfilled", label: "지급 완료 처리" },
};
const normalizeSearch = (value: string) =>
  value.toLocaleLowerCase("ko-KR").replace(/\s+/g, "");
const getStudentLabel = (order: PointOrder) =>
  formatPointStudentLabel({
    grade: order.grade || "",
    class: order.class || "",
    number: order.number || "",
  });
const getStatusClass = (status: PointOrderStatus) =>
  status === "fulfilled"
    ? "is-complete"
    : status === "cancelled" || status === "rejected"
      ? "is-warning"
      : "is-selling";

const OrderDetail: React.FC<{
  order: PointOrder;
  orderMemo: string;
  orderFeedback: string;
  saving: boolean;
  actionDisabled: boolean;
  canManage: boolean;
  onOrderMemoChange: (value: string) => void;
  onSaveOrder: (status: PointOrderStatus) => void;
}> = ({
  order,
  orderMemo,
  orderFeedback,
  saving,
  actionDisabled,
  canManage,
  onOrderMemoChange,
  onSaveOrder,
}) => {
  const { confirm } = useAppDialog();
  const nextAction = NEXT_ACTION[order.status];
  const currentIndex = FLOW_STEPS.findIndex(
    (step) => step.key === order.status,
  );
  const isClosed = order.status === "cancelled" || order.status === "rejected";
  const [confirming, setConfirming] = useState(false);
  const disabled = actionDisabled || confirming;
  const requestAction = async (nextStatus: PointOrderStatus) => {
    if (disabled || !canManage) return;
    if (
      nextStatus === "fulfilled" ||
      nextStatus === "cancelled" ||
      nextStatus === "rejected"
    ) {
      setConfirming(true);
      try {
        const fulfilled = nextStatus === "fulfilled";
        const accepted = await confirm({
          title: fulfilled
            ? "상품 지급을 완료하시겠습니까?"
            : nextStatus === "rejected"
              ? "주문을 반려하시겠습니까?"
              : "주문을 취소하시겠습니까?",
          message: (
            <>
              <strong>
                {order.studentName || "학생"} · {order.productName}{" "}
                {order.quantity || 1}개
              </strong>
              <br />
              {fulfilled
                ? "학생에게 상품을 전달한 뒤 완료 처리해 주세요."
                : `${formatWisAmount(order.priceSnapshot)}가 환불되고 확보한 재고가 판매 가능 수량으로 돌아갑니다.`}
            </>
          ),
          confirmLabel: fulfilled
            ? "지급 완료"
            : nextStatus === "rejected"
              ? "반려·환불"
              : "취소·환불",
          tone: fulfilled ? "info" : "danger",
        });
        if (!accepted) return;
        onSaveOrder(nextStatus);
      } finally {
        setConfirming(false);
      }
    } else onSaveOrder(nextStatus);
  };

  return (
    <div className="teacher-wis-shop__order-detail" aria-busy={saving}>
      <div className="teacher-wis-shop__detail-body">
        <ol className="teacher-wis-shop__timeline" aria-label="주문 처리 단계">
          {FLOW_STEPS.map((step, index) => (
            <li
              key={step.key}
              className={!isClosed && index <= currentIndex ? "is-reached" : ""}
              aria-current={
                !isClosed && index === currentIndex ? "step" : undefined
              }
            >
              <span className="teacher-wis-shop__step-number">
                {!isClosed && index < currentIndex ? (
                  <i className="fas fa-check" aria-hidden="true" />
                ) : (
                  index + 1
                )}
              </span>
              <strong>{step.label}</strong>
              <time>
                {order[step.dateKey]
                  ? formatPointDateTime(order[step.dateKey])
                  : "—"}
              </time>
            </li>
          ))}
        </ol>
        {isClosed && (
          <p className="teacher-wis-shop__closed-note">
            <strong>{POINT_ORDER_STATUS_LABELS[order.status]}</strong> ·{" "}
            {formatPointDateTime(order.cancelledAt || order.reviewedAt)} ·{" "}
            {formatWisAmount(order.priceSnapshot)} 환불
          </p>
        )}
        <dl className="teacher-wis-shop__order-facts">
          <div>
            <dt>주문 수량</dt>
            <dd>{order.quantity || 1}개</dd>
          </div>
          <div>
            <dt>주문 금액</dt>
            <dd>{formatWisAmount(order.priceSnapshot)}</dd>
          </div>
          {order.unitPrice != null && (
            <div>
              <dt>상품 가격</dt>
              <dd>{formatWisAmount(order.unitPrice)}</dd>
            </div>
          )}
        </dl>
        {order.memo && (
          <div className="teacher-wis-shop__order-note">
            <strong>학생 요청</strong>
            <p>{order.memo}</p>
          </div>
        )}
      </div>
      <div className="teacher-wis-shop__order-processing">
        {canManage && nextAction ? (
          <>
            <label className="teacher-wis-shop__field">
              <span>학생에게 전할 메모</span>
              <textarea
                rows={3}
                value={orderMemo}
                disabled={disabled}
                maxLength={1000}
                onChange={(event) => onOrderMemoChange(event.target.value)}
                placeholder="수령 장소·시간 또는 처리 사유"
              />
            </label>
            <button
              type="button"
              className="teacher-wis-shop__button is-primary"
              disabled={disabled}
              onClick={() => void requestAction(nextAction.status)}
            >
              {saving ? "처리 중…" : nextAction.label}
            </button>
            <div className="teacher-wis-shop__secondary-actions">
              {order.status === "requested" ? (
                <button
                  type="button"
                  className="teacher-wis-shop__button is-danger"
                  disabled={disabled}
                  onClick={() => void requestAction("rejected")}
                >
                  반려·환불
                </button>
              ) : (
                <button
                  type="button"
                  className="teacher-wis-shop__button is-danger"
                  disabled={disabled}
                  onClick={() => void requestAction("cancelled")}
                >
                  취소·환불
                </button>
              )}
            </div>
          </>
        ) : (
          <div className="teacher-wis-shop__order-note">
            <strong>{canManage ? "처리 결과" : "조회 전용"}</strong>
            <p>{order.reviewReason || "등록된 처리 메모가 없습니다."}</p>
          </div>
        )}
        {order.reviewReason && canManage && nextAction && (
          <p className="teacher-wis-shop__previous-memo">
            최근 메모: {order.reviewReason}
          </p>
        )}
        {orderFeedback && (
          <p
            role="status"
            aria-live="polite"
            className={`teacher-wis-shop__feedback ${getPointFeedbackToneClass(orderFeedback)}`}
          >
            {orderFeedback}
          </p>
        )}
      </div>
    </div>
  );
};

const PointRequestsTab: React.FC<PointRequestsTabProps> = ({
  orders,
  allOrders = orders,
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
  onRefresh,
}) => {
  const [searchQuery, setSearchQuery] = useState("");
  const normalizedSearch = normalizeSearch(searchQuery);
  const visibleOrders = useMemo(
    () =>
      orders.filter((order) =>
        normalizeSearch(
          `${order.studentName} ${getStudentLabel(order)} ${order.productName}`,
        ).includes(normalizedSearch),
      ),
    [orders, normalizedSearch],
  );
  const switchFilter = (value: "all" | PointOrderStatus) => {
    onFilterChange(value);
    onSelectOrder("");
  };

  return (
    <section className="teacher-wis-shop" aria-label="상점 주문 관리">
      <header className="teacher-wis-shop__heading">
        <div>
          <span className="teacher-wis-shop__eyebrow">위스 상점</span>
          <h2>
            주문 관리{" "}
            <InfoHelp
              label="주문 처리"
              sections={[
                {
                  rows: [
                    {
                      label: "승인 대기",
                      content: "학생이 주문하면 위스와 재고가 먼저 확보됩니다.",
                    },
                    {
                      label: "상품 준비",
                      content: "승인한 주문의 상품을 준비합니다.",
                    },
                    {
                      label: "수령 대기",
                      content:
                        "수령 장소·시간을 메모하고 수령 준비 완료로 변경합니다.",
                    },
                    {
                      label: "지급 완료",
                      content: "학생에게 상품을 전달한 뒤 완료 처리합니다.",
                    },
                  ],
                },
              ]}
            />
          </h2>
        </div>
        {onRefresh && (
          <button
            type="button"
            className="teacher-wis-shop__button"
            onClick={onRefresh}
            disabled={Boolean(orderSavingStatus)}
          >
            새로고침
          </button>
        )}
        {!canManage && (
          <span className="teacher-wis-shop__badge">조회 전용</span>
        )}
      </header>
      <div
        className="teacher-wis-shop__queues"
        role="group"
        aria-label="주문 처리별 조회"
      >
        {FLOW_STEPS.map((step, index) => (
          <button
            key={step.key}
            type="button"
            aria-pressed={orderFilter === step.key}
            onClick={() => switchFilter(step.key)}
            disabled={Boolean(orderSavingStatus)}
          >
            <span className="teacher-wis-shop__queue-label">
              <span>{index + 1}</span>
              {QUEUE_LABELS[step.key]}
            </span>
            <strong>
              {allOrders.filter((order) => order.status === step.key).length}
              <small>건</small>
            </strong>
          </button>
        ))}
      </div>
      <div className="teacher-wis-shop__toolbar">
        <label className="teacher-wis-shop__search">
          <i className="fas fa-search" aria-hidden="true" />
          <span className="sr-only">학생, 학급 또는 상품 검색</span>
          <input
            type="search"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="학생·학급·상품 검색"
          />
        </label>
        <div className="teacher-wis-shop__actions">
          <span className="teacher-wis-shop__result-count" aria-live="polite">
            {visibleOrders.length}건
          </span>
          <label className="teacher-wis-shop__select">
            <span className="sr-only">주문 상태</span>
            <select
              value={orderFilter}
              onChange={(event) =>
                switchFilter(event.target.value as "all" | PointOrderStatus)
              }
              disabled={Boolean(orderSavingStatus)}
            >
              <option value="all">전체 상태</option>
              {(
                Object.keys(POINT_ORDER_STATUS_LABELS) as PointOrderStatus[]
              ).map((status) => (
                <option key={status} value={status}>
                  {POINT_ORDER_STATUS_LABELS[status]}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      {visibleOrders.length ? (
        <div className="teacher-wis-shop__orders">
          <div className="teacher-wis-shop__order-columns" aria-hidden="true">
            <span>주문 상품 / 주문 시각</span>
            <span>학생</span>
            <span>주문 금액</span>
            <span>진행 상태</span>
          </div>
          {visibleOrders.map((order) => {
            const isSelected = selectedOrderId === order.id;
            const isSaving =
              orderSavingOrderId === order.id && Boolean(orderSavingStatus);
            return (
              <article
                key={order.id}
                className={`teacher-wis-shop__order ${isSelected ? "is-selected" : ""}`}
              >
                <button
                  type="button"
                  className="teacher-wis-shop__order-summary"
                  aria-expanded={isSelected}
                  aria-controls={`wis-order-${order.id}`}
                  disabled={Boolean(orderSavingStatus)}
                  onClick={() => onSelectOrder(isSelected ? "" : order.id)}
                >
                  <span className="teacher-wis-shop__order-product">
                    <strong>
                      {order.productName}
                      <span className="teacher-wis-shop__quantity">
                        {order.quantity || 1}개
                      </span>
                    </strong>
                    <time>{formatPointDateTime(order.requestedAt)}</time>
                  </span>
                  <span className="teacher-wis-shop__order-student">
                    <strong>{order.studentName || "이름 없음"}</strong>
                    <small>{getStudentLabel(order) || "소속 정보 없음"}</small>
                  </span>
                  <strong className="teacher-wis-shop__order-price">
                    {formatWisAmount(order.priceSnapshot)}
                  </strong>
                  <span className="teacher-wis-shop__order-status">
                    <span
                      className={`teacher-wis-shop__badge ${getStatusClass(order.status)}`}
                    >
                      {isSaving
                        ? "처리 중"
                        : POINT_ORDER_STATUS_LABELS[order.status]}
                    </span>
                    <i
                      className={`fas fa-chevron-${isSelected ? "up" : "down"}`}
                      aria-hidden="true"
                    />
                  </span>
                </button>
                {isSelected && (
                  <div id={`wis-order-${order.id}`}>
                    <OrderDetail
                      order={selectedOrder || order}
                      orderMemo={orderMemo}
                      orderFeedback={orderFeedback}
                      saving={isSaving}
                      actionDisabled={Boolean(orderSavingStatus)}
                      canManage={canManage}
                      onOrderMemoChange={onOrderMemoChange}
                      onSaveOrder={onSaveOrder}
                    />
                  </div>
                )}
              </article>
            );
          })}
        </div>
      ) : (
        <div className="teacher-wis-shop__empty">
          <i className="fas fa-shopping-bag" aria-hidden="true" />
          <p>선택한 조건에 맞는 주문이 없습니다.</p>
          <button
            type="button"
            className="teacher-wis-shop__button"
            onClick={() => {
              setSearchQuery("");
              switchFilter("all");
            }}
          >
            전체 주문 보기
          </button>
        </div>
      )}
      {orderFeedback &&
        !visibleOrders.some((order) => order.id === selectedOrderId) && (
          <p
            role="status"
            className={`teacher-wis-shop__feedback ${getPointFeedbackToneClass(orderFeedback)}`}
          >
            {orderFeedback}
          </p>
        )}
    </section>
  );
};

export default PointRequestsTab;
