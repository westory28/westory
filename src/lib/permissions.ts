import type { UserData } from '../types';

export const ADMIN_EMAIL = 'westoria28@gmail.com';

export const STAFF_PERMISSION_KEYS = [
    'lesson_read',
    'quiz_read',
    'student_list_read',
] as const;

export type StaffPermission = (typeof STAFF_PERMISSION_KEYS)[number];

export const normalizeStaffPermissions = (value: unknown): StaffPermission[] => {
    if (!Array.isArray(value)) return [];
    const allowed = new Set<string>(STAFF_PERMISSION_KEYS);
    return Array.from(new Set(
        value
            .map((item) => String(item || '').trim())
            .filter((item): item is StaffPermission => allowed.has(item)),
    ));
};

export const isAdminUser = (userData?: Partial<UserData> | null, email?: string | null) => {
    const normalizedEmail = String(email || userData?.email || '').trim().toLowerCase();
    return userData?.role === 'teacher' || normalizedEmail === ADMIN_EMAIL;
};

export const hasStaffPermission = (
    userData: Partial<UserData> | null | undefined,
    permission: StaffPermission,
) => normalizeStaffPermissions(userData?.staffPermissions).includes(permission);

export const canAccessTeacherPortal = (userData?: Partial<UserData> | null, email?: string | null) => {
    return isAdminUser(userData, email) || normalizeStaffPermissions(userData?.staffPermissions).length > 0;
};

export const canAccessTeacherDashboard = (userData?: Partial<UserData> | null, email?: string | null) =>
    isAdminUser(userData, email);

export const canManageSettings = (userData?: Partial<UserData> | null, email?: string | null) =>
    isAdminUser(userData, email);

export const canReadLessonManagement = (userData?: Partial<UserData> | null, email?: string | null) =>
    isAdminUser(userData, email) || hasStaffPermission(userData, 'lesson_read');

export const canWriteLessonManagement = (userData?: Partial<UserData> | null, email?: string | null) =>
    isAdminUser(userData, email);

export const canReadQuizManagement = (userData?: Partial<UserData> | null, email?: string | null) =>
    isAdminUser(userData, email) || hasStaffPermission(userData, 'quiz_read');

export const canWriteQuizManagement = (userData?: Partial<UserData> | null, email?: string | null) =>
    isAdminUser(userData, email);

export const canReadStudentList = (userData?: Partial<UserData> | null, email?: string | null) =>
    isAdminUser(userData, email) || hasStaffPermission(userData, 'student_list_read');

export const canEditStudentList = (userData?: Partial<UserData> | null, email?: string | null) =>
    isAdminUser(userData, email);

export const getDefaultTeacherRoute = (userData?: Partial<UserData> | null, email?: string | null) => {
    if (canAccessTeacherDashboard(userData, email)) return '/teacher/dashboard';
    if (canReadLessonManagement(userData, email)) return '/teacher/lesson';
    if (canReadQuizManagement(userData, email)) return '/teacher/quiz?tab=log';
    if (canReadStudentList(userData, email)) return '/teacher/students';
    return '/student/dashboard';
};

export const canAccessTeacherPath = (
    pathname: string,
    userData?: Partial<UserData> | null,
    email?: string | null,
) => {
    if (pathname.startsWith('/teacher/settings')) return canManageSettings(userData, email);
    if (pathname.startsWith('/teacher/dashboard')) return canAccessTeacherDashboard(userData, email);
    if (pathname.startsWith('/teacher/lesson')) return canReadLessonManagement(userData, email);
    if (pathname.startsWith('/teacher/quiz')) return canReadQuizManagement(userData, email);
    if (pathname.startsWith('/teacher/students')) return canReadStudentList(userData, email);
    if (pathname.startsWith('/teacher/exam')) return isAdminUser(userData, email);
    if (pathname.startsWith('/teacher/schedule')) return isAdminUser(userData, email);
    return canAccessTeacherPortal(userData, email);
};
