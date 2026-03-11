import React, { useEffect, useMemo, useState } from 'react';
import { collection, doc, getDocs, serverTimestamp, setDoc } from 'firebase/firestore';
import { db } from '../../../lib/firebase';
import {
    ADMIN_EMAIL,
    STAFF_PERMISSION_KEYS,
    normalizeStaffPermissions,
    type StaffPermission,
} from '../../../lib/permissions';

type UserRow = {
    id: string;
    email: string;
    name: string;
    role: string;
    staffPermissions: StaffPermission[];
};

const PERMISSION_LABELS: Record<StaffPermission, string> = {
    lesson_read: '학습 자료 관리 읽기',
    quiz_read: '평가 관리 읽기',
    student_list_read: '학생 명단 읽기',
};

const SettingsAccess: React.FC = () => {
    const [users, setUsers] = useState<UserRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [savingId, setSavingId] = useState('');
    const [search, setSearch] = useState('');

    const loadUsers = async () => {
        setLoading(true);
        try {
            const snap = await getDocs(collection(db, 'users'));
            const loaded: UserRow[] = snap.docs.map((item) => {
                const data = item.data() as Record<string, unknown>;
                return {
                    id: item.id,
                    email: String(data.email || '').trim(),
                    name: String(data.name || '').trim(),
                    role: String(data.role || 'student').trim(),
                    staffPermissions: normalizeStaffPermissions(data.staffPermissions),
                };
            });

            loaded.sort((a, b) => {
                const aAdmin = a.email.toLowerCase() === ADMIN_EMAIL ? 0 : 1;
                const bAdmin = b.email.toLowerCase() === ADMIN_EMAIL ? 0 : 1;
                if (aAdmin !== bAdmin) return aAdmin - bAdmin;
                return (a.name || a.email).localeCompare(b.name || b.email, 'ko');
            });
            setUsers(loaded);
        } catch (error) {
            console.error('Failed to load access settings users:', error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        void loadUsers();
    }, []);

    const filteredUsers = useMemo(() => {
        const q = search.trim().toLowerCase();
        if (!q) return users;
        return users.filter((user) =>
            user.name.toLowerCase().includes(q) || user.email.toLowerCase().includes(q),
        );
    }, [search, users]);

    const togglePermission = async (user: UserRow, permission: StaffPermission) => {
        if (user.email.toLowerCase() === ADMIN_EMAIL) return;

        const nextPermissions = user.staffPermissions.includes(permission)
            ? user.staffPermissions.filter((item) => item !== permission)
            : [...user.staffPermissions, permission];

        const normalized = normalizeStaffPermissions(nextPermissions);
        setSavingId(user.id);
        try {
            await setDoc(doc(db, 'users', user.id), {
                role: normalized.length > 0 ? 'staff' : 'student',
                staffPermissions: normalized,
                updatedAt: serverTimestamp(),
            }, { merge: true });

            setUsers((prev) => prev.map((item) => (
                item.id === user.id
                    ? {
                        ...item,
                        role: normalized.length > 0 ? 'staff' : 'student',
                        staffPermissions: normalized,
                    }
                    : item
            )));
        } catch (error) {
            console.error('Failed to update staff permissions:', error);
            alert('권한 저장에 실패했습니다.');
        } finally {
            setSavingId('');
        }
    };

    return (
        <div className="space-y-6">
            <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
                <div className="border-b border-gray-100 pb-4">
                    <h3 className="text-lg font-bold text-gray-900">세부 권한 관리</h3>
                    <p className="mt-1 text-sm text-gray-500">
                        동교과 선생님 계정에 읽기 전용 권한만 부여합니다. 등록, 수정, 삭제는 관리자만 가능합니다.
                    </p>
                </div>

                <div className="mt-4">
                    <input
                        type="text"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder="이름 또는 이메일 검색"
                        className="w-full rounded-lg border border-gray-300 px-4 py-2 text-sm focus:border-blue-500 focus:outline-none"
                    />
                </div>
            </div>

            <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
                <div className="overflow-x-auto">
                    <table className="w-full min-w-[760px] text-sm">
                        <thead className="bg-gray-50 text-left text-gray-600">
                            <tr>
                                <th className="px-4 py-3 font-bold">사용자</th>
                                <th className="px-4 py-3 font-bold">역할</th>
                                {STAFF_PERMISSION_KEYS.map((permission) => (
                                    <th key={permission} className="px-4 py-3 font-bold">
                                        {PERMISSION_LABELS[permission]}
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                            {loading ? (
                                <tr>
                                    <td colSpan={5} className="px-4 py-10 text-center text-gray-400">사용자 목록을 불러오는 중입니다.</td>
                                </tr>
                            ) : filteredUsers.length === 0 ? (
                                <tr>
                                    <td colSpan={5} className="px-4 py-10 text-center text-gray-400">표시할 사용자가 없습니다.</td>
                                </tr>
                            ) : (
                                filteredUsers.map((user) => {
                                    const isAdmin = user.email.toLowerCase() === ADMIN_EMAIL;
                                    return (
                                        <tr key={user.id}>
                                            <td className="px-4 py-3">
                                                <div className="font-bold text-gray-800">{user.name || '(이름 없음)'}</div>
                                                <div className="text-xs text-gray-500">{user.email}</div>
                                            </td>
                                            <td className="px-4 py-3">
                                                <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-bold ${
                                                    isAdmin
                                                        ? 'bg-blue-100 text-blue-700'
                                                        : user.role === 'staff'
                                                            ? 'bg-amber-100 text-amber-700'
                                                            : 'bg-gray-100 text-gray-600'
                                                }`}>
                                                    {isAdmin ? '관리자' : user.role === 'staff' ? '세부권한' : '학생'}
                                                </span>
                                            </td>
                                            {STAFF_PERMISSION_KEYS.map((permission) => (
                                                <td key={permission} className="px-4 py-3">
                                                    <label className={`inline-flex items-center gap-2 ${isAdmin ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}`}>
                                                        <input
                                                            type="checkbox"
                                                            checked={isAdmin || user.staffPermissions.includes(permission)}
                                                            disabled={isAdmin || savingId === user.id}
                                                            onChange={() => void togglePermission(user, permission)}
                                                            className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                                                        />
                                                        <span className="text-xs font-medium text-gray-600">
                                                            {savingId === user.id ? '저장 중' : '허용'}
                                                        </span>
                                                    </label>
                                                </td>
                                            ))}
                                        </tr>
                                    );
                                })
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
};

export default SettingsAccess;
