import React from 'react';
import { POINT_ORDER_STATUS_LABELS, getPointFeedbackToneClass } from '../../../../constants/pointLabels';
import { formatPointDateTime, formatWisAmount } from '../../../../lib/pointFormatters';
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
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1.45fr)_minmax(320px,0.75fr)]">
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
                            <th className="w-[20%] p-4">학생 이름</th>
                            <th className="w-[28%] p-4">상품명</th>
                            <th className="w-[16%] p-4 text-right">차감 위스</th>
                            <th className="w-[24%] p-4 text-right">요청 시각</th>
                            <th className="w-[12%] p-4 text-center">상태</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 bg-white">
                        {orders.length === 0 && (
                            <tr>
                                <td colSpan={5} className="p-10 text-center text-gray-400">선택한 조건에 맞는 요청이 없습니다.</td>
                            </tr>
                        )}
                        {orders.map((order) => (
                            <tr key={order.id} className={`cursor-pointer transition ${selectedOrderId === order.id ? 'bg-blue-50' : 'hover:bg-gray-50'}`} onClick={() => onSelectOrder(order.id)}>
                                <td className="truncate p-4 font-bold text-gray-800">{order.studentName || '(이름 없음)'}</td>
                                <td className="truncate p-4 text-gray-700" title={order.productName}>{order.productName}</td>
                                <td className="p-4 text-right font-bold text-gray-800 whitespace-nowrap">{formatWisAmount(order.priceSnapshot)}</td>
                                <td className="p-4 text-right text-gray-500">{formatPointDateTime(order.requestedAt)}</td>
                                <td className="p-4 text-center">
                                    <span className="inline-flex rounded-full bg-gray-100 px-3 py-1 text-xs font-bold text-gray-700">{POINT_ORDER_STATUS_LABELS[order.status] || order.status}</span>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>

        <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm xl:p-6">
            {!selectedOrder ? (
                <div className="py-16 text-center text-gray-400">왼쪽 목록에서 요청을 선택하면 상세 내용을 볼 수 있습니다.</div>
            ) : (
                <>
                    <h3 className="text-xl font-extrabold text-gray-900">{selectedOrder.productName}</h3>
                    <div className="mt-1 text-sm text-gray-500">{selectedOrder.studentName} · {selectedOrder.uid}</div>
                    <div className="mt-5 grid grid-cols-1 gap-3">
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
