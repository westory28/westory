import React, { useEffect, useMemo, useState } from 'react';
import { collection, doc, getDocs, serverTimestamp, setDoc } from 'firebase/firestore';
import { useAppToast } from '../../../components/common/AppToastProvider';
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
    teacherPortalEnabled: boolean;
    staffPermissions: StaffPermission[];
};

const PERMISSION_LABELS: Record<StaffPermission, string> = {
    lesson_read: '학습 자료 관리',
    quiz_read: '평가 관리',
    student_list_read: '학생 명단 관리',
    point_read: '위스 조회',
    point_manage: '위스 관리',
};

const hasGrantedAccess = (user: UserRow) =>
    user.role === 'student'
        ? user.teacherPortalEnabled
        : user.teacherPortalEnabled || user.staffPermissions.length > 0;

const TABLE_COLUMN_COUNT = 3 + STAFF_PERMISSION_KEYS.length;

const SettingsAccess: React.FC = () => {
    const { showToast } = useAppToast();
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
                    teacherPortalEnabled: data.teacherPortalEnabled === true,
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

    const searchQuery = search.trim().toLowerCase();
    const hasSearchQuery = searchQuery.length > 0;

    const filteredUsers = useMemo(() => {
        if (!hasSearchQuery) {
            return users.filter((user) => hasGrantedAccess(user));
        }

        return users.filter((user) =>
            user.name.toLowerCase().includes(searchQuery) || user.email.toLowerCase().includes(searchQuery),
        );
    }, [hasSearchQuery, searchQuery, users]);

    const saveUserAccess = async (user: UserRow, patch: Partial<UserRow>) => {
        const isAdmin = user.email.toLowerCase() === ADMIN_EMAIL;
        if (isAdmin) return;

        const nextUser: UserRow = {
            ...user,
            ...patch,
            staffPermissions: normalizeStaffPermissions(patch.staffPermissions ?? user.staffPermissions),
            teacherPortalEnabled: patch.teacherPortalEnabled ?? user.teacherPortalEnabled,
        };

        setSavingId(user.id);
        try {
            await setDoc(doc(db, 'users', user.id), {
                role: nextUser.staffPermissions.length > 0 ? 'staff' : 'student',
                teacherPortalEnabled: nextUser.teacherPortalEnabled,
                staffPermissions: nextUser.staffPermissions,
                updatedAt: serverTimestamp(),
            }, { merge: true });

            setUsers((prev) => prev.map((item) => (
                item.id === user.id
                    ? {
                        ...item,
                        role: nextUser.staffPermissions.length > 0 ? 'staff' : 'student',
                        teacherPortalEnabled: nextUser.teacherPortalEnabled,
                        staffPermissions: nextUser.staffPermissions,
                    }
                    : item
            )));
            showToast({
                tone: 'success',
                title: '권한 설정이 저장되었습니다.',
                message: `${nextUser.name || nextUser.email} 계정의 접근 권한을 반영했습니다.`,
            });
        } catch (error) {
            console.error('Failed to update staff permissions:', error);
            showToast({
                tone: 'error',
                title: '권한 저장에 실패했습니다.',
                message: '잠시 후 다시 시도해 주세요.',
            });
        } finally {
            setSavingId('');
        }
    };

    const toggleLoginEnabled = async (user: UserRow) => {
        await saveUserAccess(user, {
            teacherPortalEnabled: !user.teacherPortalEnabled,
        });
    };

    const togglePermission = async (user: UserRow, permission: StaffPermission) => {
        const nextPermissions = user.staffPermissions.includes(permission)
            ? user.staffPermissions.filter((item) => item !== permission)
            : [...user.staffPermissions, permission];

        await saveUserAccess(user, {
            staffPermissions: nextPermissions,
        });
    };

    return (
        <div className="space-y-6">
            <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
                <div className="border-b border-gray-100 pb-4">
                    <h3 className="text-lg font-bold text-gray-900">세부 권한 관리</h3>
                    <p className="mt-1 text-sm text-gray-500">
                        로그인 허용 여부와 들어올 수 있는 메뉴를 직접 선택합니다. 등록, 수정, 삭제는 관리자만 가능합니다.
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
                    <table className="w-full min-w-[1040px] text-sm">
                        <thead className="bg-gray-50 text-left text-gray-600">
                            <tr>
                                <th className="px-4 py-3 font-bold">사용자</th>
                                <th className="px-4 py-3 font-bold">역할</th>
                                <th className="px-4 py-3 font-bold">교사 포털 로그인</th>
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
                                    <td colSpan={TABLE_COLUMN_COUNT} className="px-4 py-10 text-center text-gray-400">사용자 목록을 불러오는 중입니다.</td>
                                </tr>
                            ) : filteredUsers.length === 0 ? (
                                <tr>
                                    <td colSpan={TABLE_COLUMN_COUNT} className="px-4 py-10 text-center text-gray-400">
                                        {hasSearchQuery
                                            ? '검색 결과가 없습니다.'
                                            : '현재 세부 권한이 부여된 계정이 없습니다. 검색해서 권한을 부여하세요.'}
                                    </td>
                                </tr>
                            ) : (
                                filteredUsers.map((user) => {
                                    const isAdmin = user.email.toLowerCase() === ADMIN_EMAIL;
                                    const disabled = isAdmin || savingId === user.id;

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
                                            <td className="px-4 py-3">
                                                <label className={`inline-flex items-center gap-2 ${disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}`}>
                                                    <input
                                                        type="checkbox"
                                                        checked={isAdmin || user.teacherPortalEnabled}
                                                        disabled={disabled}
                                                        onChange={() => void toggleLoginEnabled(user)}
                                                        className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                                                    />
                                                    <span className="text-xs font-medium text-gray-600">
                                                        {savingId === user.id ? '저장 중' : '허용'}
                                                    </span>
                                                </label>
                                            </td>
                                            {STAFF_PERMISSION_KEYS.map((permission) => (
                                                <td key={permission} className="px-4 py-3">
                                                    <label className={`inline-flex items-center gap-2 ${
                                                        disabled || !user.teacherPortalEnabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'
                                                    }`}>
                                                        <input
                                                            type="checkbox"
                                                            checked={isAdmin || user.staffPermissions.includes(permission)}
                                                            disabled={disabled || (!isAdmin && !user.teacherPortalEnabled)}
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
