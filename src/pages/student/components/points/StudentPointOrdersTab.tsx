import React from 'react';
import { POINT_ORDER_STATUS_LABELS } from '../../../../constants/pointLabels';
import { formatPointDateTime } from '../../../../lib/pointFormatters';
import type { PointOrder, PointOrderStatus } from '../../../../types';

interface StudentPointOrdersTabProps {
    orderFilter: 'all' | PointOrderStatus;
    orders: PointOrder[];
    onOrderFilterChange: (value: 'all' | PointOrderStatus) => void;
}

const StudentPointOrdersTab: React.FC<StudentPointOrdersTabProps> = ({ orderFilter, orders, onOrderFilterChange }) => (
    <div className="space-y-5">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
                <h2 className="text-lg font-bold text-gray-800">구매 내역</h2>
                <p className="mt-1 text-sm text-gray-500">구매 요청 상태와 처리 결과를 확인할 수 있습니다.</p>
            </div>
            <div className="flex flex-wrap gap-2">
                <button
                    type="button"
                    onClick={() => onOrderFilterChange('all')}
                    className={`rounded-full px-4 py-2 text-xs font-bold transition ${
                        orderFilter === 'all' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                    }`}
                >
                    전체
                </button>
                {(Object.keys(POINT_ORDER_STATUS_LABELS) as PointOrderStatus[]).map((status) => (
                    <button
                        key={status}
                        type="button"
                        onClick={() => onOrderFilterChange(status)}
                        className={`rounded-full px-4 py-2 text-xs font-bold transition ${
                            orderFilter === status ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                        }`}
                    >
                        {POINT_ORDER_STATUS_LABELS[status]}
                    </button>
                ))}
            </div>
        </div>

        {orders.length === 0 && (
            <div className="rounded-2xl border border-dashed border-gray-300 bg-gray-50 px-5 py-12 text-center text-gray-500">
                아직 구매 요청 내역이 없습니다.
            </div>
        )}

        {orders.length > 0 && (
            <div className="space-y-4">
                {orders.map((order) => (
                    <article key={order.id} className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
                        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                            <div>
                                <div className="flex flex-wrap items-center gap-2">
                                    <h3 className="text-lg font-bold text-gray-800">{order.productName}</h3>
                                    <span className="inline-flex rounded-full bg-gray-100 px-3 py-1 text-xs font-bold text-gray-700">
                                        {POINT_ORDER_STATUS_LABELS[order.status]}
                                    </span>
                                </div>
                                <div className="mt-2 text-sm text-gray-500">
                                    요청일 {formatPointDateTime(order.requestedAt)}
                                    {order.reviewedAt?.seconds ? ` · 처리일 ${formatPointDateTime(order.reviewedAt)}` : ''}
                                </div>
                            </div>
                            <div className="text-right">
                                <div className="text-xs font-bold text-gray-400">사용 포인트</div>
                                <div className="text-2xl font-black text-blue-700">{order.priceSnapshot}</div>
                            </div>
                        </div>
                        <div className="mt-4 grid grid-cols-1 gap-3 text-sm md:grid-cols-2">
                            <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3">
                                <div className="text-gray-500">현재 상태</div>
                                <div className="mt-1 font-bold text-gray-800">{POINT_ORDER_STATUS_LABELS[order.status]}</div>
                            </div>
                            <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3">
                                <div className="text-gray-500">메모</div>
                                <div className="mt-1 font-bold text-gray-800">{order.memo || '메모가 없습니다.'}</div>
                            </div>
                        </div>
                    </article>
                ))}
            </div>
        )}
    </div>
);

export default StudentPointOrdersTab;
