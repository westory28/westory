import React from 'react';
import { POINT_ORDER_STATUS_LABELS, getPointFeedbackToneClass } from '../../../../constants/pointLabels';
import { formatPointDateTime, formatPointTimeOnly, formatWisAmount } from '../../../../lib/pointFormatters';
import type { PointOrder, PointOrderStatus } from '../../../../types';

interface PointRequestsTabProps {
    orders: PointOrder[];
    orderFilter: 'all' | PointOrderStatus;
    selectedOrderId: string;
    selectedOrder: PointOrder | null;
    orderMemo: string;
    orderFeedback: string;
    canManage: boolean;
    onFilterChange: (value: 'all' | PointOrderStatus) => void;
    onSelectOrder: (orderId: string) => void;
    onOrderMemoChange: (value: string) => void;
    onSaveOrder: (status: PointOrderStatus) => void;
}

const PURCHASE_FLOW_STEPS = [
    { key: 'requested', label: '요청' },
    { key: 'approved', label: '승인' },
    { key: 'fulfilled', label: '지급' },
] as const;

const getOrderStepIndex = (status?: PointOrderStatus | null) => {
    if (status === 'fulfilled') return 2;
    if (status === 'approved') return 1;
    return 0;
};

const isTerminalOrderStatus = (status?: PointOrderStatus | null) => (
    status === 'rejected' || status === 'cancelled'
);

const getOrderStatusToneClass = (status: PointOrderStatus) => {
    if (status === 'fulfilled') return 'border-emerald-200 bg-emerald-50 text-emerald-700';
    if (status === 'approved') return 'border-blue-200 bg-blue-50 text-blue-700';
    if (status === 'rejected' || status === 'cancelled') return 'border-rose-200 bg-rose-50 text-rose-700';
    return 'border-blue-200 bg-blue-50 text-blue-700';
};

const OrderProcessStepper: React.FC<{
    status?: PointOrderStatus | null;
    compact?: boolean;
}> = ({ status = 'requested', compact = false }) => {
    const activeIndex = getOrderStepIndex(status);
    const terminal = isTerminalOrderStatus(status);

    return (
        <div className={compact ? 'w-full min-w-[9rem]' : 'rounded-lg border border-gray-200 bg-white px-5 py-4'}>
            {!compact && <div className="mb-3 text-sm font-bold text-gray-900">처리 단계</div>}
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
                                        'inline-flex items-center justify-center rounded-full border font-bold',
                                        compact ? 'h-5 w-5 text-[10px]' : 'h-8 w-8 text-sm',
                                        terminal && index === 0
                                            ? 'border-rose-200 bg-rose-50 text-rose-700'
                                            : isCurrent
                                                ? 'border-blue-600 bg-blue-600 text-white'
                                                : isComplete
                                                    ? 'border-blue-200 bg-blue-50 text-blue-700'
                                                    : 'border-gray-200 bg-gray-100 text-gray-500',
                                    ].join(' ')}
                                >
                                    {index + 1}
                                </span>
                                <span
                                    className={[
                                        'font-bold',
                                        compact ? 'text-[10px]' : 'text-sm',
                                        terminal && index === 0
                                            ? 'text-rose-700'
                                            : isHighlighted
                                                ? 'text-blue-700'
                                                : 'text-gray-600',
                                    ].join(' ')}
                                >
                                    {step.label}
                                </span>
                            </div>
                            {index < PURCHASE_FLOW_STEPS.length - 1 && (
                                <span
                                    className={[
                                        compact ? 'mt-2.5 w-6' : 'mt-4 w-full min-w-12',
                                        'border-t border-dashed',
                                        !terminal && index < activeIndex ? 'border-blue-300' : 'border-gray-300',
                                    ].join(' ')}
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

const PointRequestsTab: React.FC<PointRequestsTabProps> = ({
    orders,
    orderFilter,
    selectedOrderId,
    selectedOrder,
    orderMemo,
    orderFeedback,
    canManage,
    onFilterChange,
    onSelectOrder,
    onOrderMemoChange,
    onSaveOrder,
}) => (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1.45fr)_minmax(340px,0.75fr)]">
        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
            <div className="flex flex-col gap-3 border-b border-gray-100 bg-gray-50 p-5 md:flex-row md:items-center md:justify-between">
                <h2 className="text-lg font-bold text-gray-800">구매 요청 목록</h2>
                <select value={orderFilter} onChange={(event) => onFilterChange(event.target.value as 'all' | PointOrderStatus)} className="rounded-lg border border-gray-300 px-3 py-2 text-sm font-bold text-gray-700">
                    <option value="all">전체 상태</option>
                    {(Object.keys(POINT_ORDER_STATUS_LABELS) as PointOrderStatus[]).map((status) => (
                        <option key={status} value={status}>{POINT_ORDER_STATUS_LABELS[status]}</option>
                    ))}
                </select>
            </div>
            <div className="overflow-hidden">
                <table className="w-full table-fixed text-sm text-left">
                    <thead className="bg-gray-100 text-xs font-bold uppercase text-gray-600">
                        <tr>
                            <th className="w-[17%] p-4">학생 이름</th>
                            <th className="w-[23%] p-4">상품명</th>
                            <th className="w-[15%] p-4 text-right">차감 위스</th>
                            <th className="w-[11%] p-4 text-right">요청 시각</th>
                            <th className="w-[22%] p-4 text-center">처리 단계</th>
                            <th className="w-[12%] p-4 text-center">상태</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 bg-white">
                        {orders.length === 0 && (
                            <tr>
                                <td colSpan={6} className="p-10 text-center text-gray-400">선택한 조건에 맞는 요청이 없습니다.</td>
                            </tr>
                        )}
                        {orders.map((order) => (
                            <tr key={order.id} className={`cursor-pointer transition ${selectedOrderId === order.id ? 'bg-blue-50' : 'hover:bg-gray-50'}`} onClick={() => onSelectOrder(order.id)}>
                                <td className="truncate p-4 font-bold text-gray-800">{order.studentName || '(이름 없음)'}</td>
                                <td className="truncate p-4 text-gray-700" title={order.productName}>{order.productName}</td>
                                <td className="p-4 text-right font-bold text-gray-800 whitespace-nowrap">{formatWisAmount(order.priceSnapshot)}</td>
                                <td className="p-4 text-right text-gray-500 whitespace-nowrap">{formatPointTimeOnly(order.requestedAt)}</td>
                                <td className="p-4">
                                    <OrderProcessStepper status={order.status} compact />
                                </td>
                                <td className="p-4 text-center">
                                    <span className={`inline-flex rounded-full border px-3 py-1 text-xs font-bold ${getOrderStatusToneClass(order.status)}`}>{POINT_ORDER_STATUS_LABELS[order.status] || order.status}</span>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>

        <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm xl:p-6">
            <h2 className="mb-4 text-lg font-bold text-gray-800">요청 상세</h2>
            <OrderProcessStepper status={selectedOrder?.status || 'requested'} />
            {!selectedOrder ? (
                <div className="py-16 text-center text-gray-400">왼쪽 목록에서 요청을 선택하면 상세 내용을 볼 수 있습니다.</div>
            ) : (
                <>
                    <h3 className="mt-5 text-xl font-extrabold text-gray-900">{selectedOrder.productName}</h3>
                    <div className="mt-1 text-sm text-gray-500">{selectedOrder.studentName} · {selectedOrder.uid}</div>
                    <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-1">
                        <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3"><div className="text-sm text-gray-500">차감 위스</div><div className="mt-1 font-bold text-gray-900 whitespace-nowrap">{formatWisAmount(selectedOrder.priceSnapshot)}</div></div>
                        <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3"><div className="text-sm text-gray-500">현재 상태</div><div className="mt-1 font-bold text-gray-900">{POINT_ORDER_STATUS_LABELS[selectedOrder.status]}</div></div>
                        <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3"><div className="text-sm text-gray-500">요청 시각</div><div className="mt-1 font-bold text-gray-900">{formatPointDateTime(selectedOrder.requestedAt)}</div></div>
                        <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3"><div className="text-sm text-gray-500">최근 처리 시각</div><div className="mt-1 font-bold text-gray-900">{formatPointDateTime(selectedOrder.reviewedAt)}</div></div>
                    </div>
                    <textarea value={orderMemo} onChange={(event) => onOrderMemoChange(event.target.value)} rows={4} placeholder="처리 메모를 남기면 학생 화면에서도 참고할 수 있습니다." className="mt-5 w-full rounded-lg border border-gray-300 px-4 py-3 text-sm" disabled={!canManage} />
                    {!!orderFeedback && <div className={`mt-4 rounded-lg px-4 py-3 text-sm font-bold ${getPointFeedbackToneClass(orderFeedback)}`}>{orderFeedback}</div>}
                    <div className="mt-4 grid grid-cols-2 gap-3">
                        <button
                            type="button"
                            disabled={!canManage || !['requested', 'approved'].includes(selectedOrder.status)}
                            onClick={() => onSaveOrder(selectedOrder.status === 'approved' ? 'requested' : 'approved')}
                            className="rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-bold text-white disabled:bg-blue-300"
                        >
                            {selectedOrder.status === 'approved' ? '승인 취소' : '승인'}
                        </button>
                        <button type="button" disabled={!canManage || selectedOrder.status !== 'requested'} onClick={() => onSaveOrder('rejected')} className="rounded-lg bg-rose-500 px-4 py-2.5 text-sm font-bold text-white disabled:bg-rose-300">반려</button>
                        <button type="button" disabled={!canManage || selectedOrder.status !== 'approved'} onClick={() => onSaveOrder('fulfilled')} className="rounded-lg border border-emerald-500 bg-emerald-50 px-4 py-2.5 text-sm font-bold text-emerald-700 disabled:border-emerald-200 disabled:text-emerald-300">지급 완료</button>
                        <button type="button" disabled={!canManage || selectedOrder.status !== 'requested'} onClick={() => onSaveOrder('cancelled')} className="rounded-lg border border-gray-300 bg-gray-50 px-4 py-2.5 text-sm font-bold text-gray-700 disabled:text-gray-300">요청 취소 처리</button>
                    </div>
                </>
            )}
        </div>
    </div>
);

export default PointRequestsTab;
