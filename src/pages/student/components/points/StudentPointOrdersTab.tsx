import React from 'react';
import { POINT_ORDER_STATUS_LABELS } from '../../../../constants/pointLabels';
import { formatPointDateTime, formatWisAmount } from '../../../../lib/pointFormatters';
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
                <h2 className="text-lg font-bold text-gray-800">{'\uAD6C\uB9E4 \uB0B4\uC5ED'}</h2>
                <p className="mt-1 text-sm text-gray-500">{'\uAD6C\uB9E4 \uC694\uCCAD \uC0C1\uD0DC\uC640 \uCC98\uB9AC \uACB0\uACFC\uB97C \uD655\uC778\uD560 \uC218 \uC788\uC2B5\uB2C8\uB2E4.'}</p>
            </div>
            <div className="flex flex-wrap gap-2">
                <button
                    type="button"
                    onClick={() => onOrderFilterChange('all')}
                    className={`rounded-full px-4 py-2 text-xs font-bold transition ${
                        orderFilter === 'all' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                    }`}
                >
                    {'\uC804\uCCB4'}
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
                {'\uC544\uC9C1 \uAD6C\uB9E4 \uC694\uCCAD \uB0B4\uC5ED\uC774 \uC5C6\uC2B5\uB2C8\uB2E4.'}
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
                                    {`\uC694\uCCAD\uC77C ${formatPointDateTime(order.requestedAt)}`}
                                    {order.reviewedAt?.seconds ? ` · \uCC98\uB9AC\uC77C ${formatPointDateTime(order.reviewedAt)}` : ''}
                                </div>
                            </div>
                            <div className="text-right">
                                <div className="text-xs font-bold text-gray-400">사용 위스</div>
                                <div className="text-2xl font-black text-blue-700 whitespace-nowrap">{formatWisAmount(order.priceSnapshot)}</div>
                            </div>
                        </div>
                        <div className="mt-4 grid grid-cols-1 gap-3 text-sm md:grid-cols-2">
                            <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3">
                                <div className="text-gray-500">{'\uD604\uC7AC \uC0C1\uD0DC'}</div>
                                <div className="mt-1 font-bold text-gray-800">{POINT_ORDER_STATUS_LABELS[order.status]}</div>
                            </div>
                            <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3">
                                <div className="text-gray-500">{'\uBA54\uBAA8'}</div>
                                <div className="mt-1 font-bold text-gray-800">{order.memo || '\uBA54\uBAA8\uAC00 \uC5C6\uC2B5\uB2C8\uB2E4.'}</div>
                            </div>
                        </div>
                    </article>
                ))}
            </div>
        )}
    </div>
);

export default StudentPointOrdersTab;
