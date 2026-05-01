export interface MenuChild {
    name: string;
    url: string;
    hidden?: boolean;
}

export interface MenuItem {
    name: string;
    url: string;
    icon: string;
    children?: MenuChild[];
}

export type PortalType = 'student' | 'teacher';
export type MenuConfig = Record<PortalType, MenuItem[]>;

export const MENUS: MenuConfig = {
    student: [
        {
            name: '학습',
            url: '/student/lesson/note',
            icon: 'M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253',
            children: [
                { name: '수업 자료', url: '/student/lesson/note' },
                { name: '지도', url: '/student/lesson/maps' },
                { name: '싱크 클라우드', url: '/student/lesson/think-cloud' },
            ],
        },
        {
            name: '평가',
            url: '/student/quiz',
            icon: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2',
            children: [
                { name: '문제 풀이', url: '/student/quiz' },
                { name: '역사교실', url: '/student/history-classroom' },
            ],
        },
        {
            name: '성적 계산기',
            url: '/student/score',
            icon: 'M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z',
            children: [
                { name: '성적 계산기', url: '/student/score' },
                { name: '정기 시험 답안', url: '/student/history' },
            ],
        },
        {
            name: '위스',
            url: '/student/points',
            icon: 'M12 8c-2.761 0-5 1.567-5 3.5S9.239 15 12 15s5-1.567 5-3.5S14.761 8 12 8zm0 0V5m0 10v4m-7-7H3m18 0h-2',
            children: [
                { name: '내 위스', url: '/student/points' },
                { name: '화랑의 전당', url: '/student/points?tab=hall-of-fame' },
                { name: '위스 내역', url: '/student/points?tab=history' },
                { name: '위스 상점', url: '/student/points?tab=shop' },
                { name: '구매 내역', url: '/student/points?tab=orders' },
            ],
        },
        {
            name: '마이페이지',
            url: '/student/mypage',
            icon: 'M12 12a5 5 0 100-10 5 5 0 000 10zm0 2c-4.418 0-8 1.79-8 4v1h16v-1c0-2.21-3.582-4-8-4z',
        },
    ],
    teacher: [
        {
            name: '학습 자료 관리',
            url: '/teacher/lesson',
            icon: 'M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253',
            children: [
                { name: '수업 자료', url: '/teacher/lesson' },
                { name: '지도', url: '/teacher/lesson/maps' },
                { name: '사료 창고', url: '/teacher/lesson/source-archive' },
                { name: '싱크 클라우드 관리', url: '/teacher/lesson/think-cloud' },
            ],
        },
        {
            name: '평가 관리',
            url: '/teacher/quiz',
            icon: 'M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z',
            children: [
                { name: '문제 등록', url: '/teacher/quiz' },
                { name: '응시 현황', url: '/teacher/quiz?tab=log' },
                { name: '문제 은행', url: '/teacher/quiz?tab=bank' },
                { name: '역사교실', url: '/teacher/quiz/history-classroom' },
            ],
        },
        {
            name: '점수 관리',
            url: '/teacher/exam',
            icon: 'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z',
            children: [
                { name: '평가 반영 비율', url: '/teacher/exam' },
                { name: '정기시험 답안', url: '/teacher/exam?tab=omr' },
            ],
        },
        {
            name: '위스 관리',
            url: '/teacher/points',
            icon: 'M12 8c-2.761 0-5 1.567-5 3.5S9.239 15 12 15s5-1.567 5-3.5S14.761 8 12 8zm0 0V5m0 10v4m-7-7H3m18 0h-2',
            children: [
                { name: '위스 현황', url: '/teacher/points' },
                { name: '지급 및 환수', url: '/teacher/points?tab=grant' },
                { name: '운영 정책', url: '/teacher/points?tab=policy' },
                { name: '화랑의 전당 관리', url: '/teacher/points?tab=hall-of-fame' },
                { name: '상품 관리', url: '/teacher/points?tab=products' },
                { name: '구매 요청 관리', url: '/teacher/points?tab=requests' },
            ],
        },
        {
            name: '학생 관리',
            url: '/teacher/students',
            icon: 'M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z',
        },
    ],
};

const deepCloneMenus = (menus: MenuConfig): MenuConfig =>
    JSON.parse(JSON.stringify(menus)) as MenuConfig;

const toSafeText = (value: unknown) => (typeof value === 'string' ? value.trim() : '');

const LEGACY_MENU_URL_PREFIXES = [
    '/student/quiz/history2',
    '/teacher/quiz/history2',
];

const getLegacyCanonicalUrl = (pathOnly: string) => {
    if (pathOnly === '/student/quiz/history2' || pathOnly.startsWith('/student/quiz/history2/')) {
        return '/student/quiz';
    }
    if (pathOnly === '/teacher/quiz/history2' || pathOnly.startsWith('/teacher/quiz/history2/')) {
        return '/teacher/quiz';
    }
    return '';
};

const normalizeMenuUrl = (value: unknown) => {
    let raw = toSafeText(value);
    if (!raw) return '';

    const hashIndex = raw.indexOf('#');
    if (hashIndex >= 0) {
        const hashPath = raw.slice(hashIndex + 1).trim();
        raw = hashPath.startsWith('/') ? hashPath : raw.slice(0, hashIndex).trim();
    }

    if (raw.startsWith('#/')) {
        raw = raw.slice(1);
    }

    if (!raw.startsWith('/') && !/^[a-z]+:/i.test(raw)) {
        raw = `/${raw.replace(/^\/+/, '')}`;
    }

    const [pathPart, queryPart = ''] = raw.split('?');
    const normalizedPath = pathPart.replace(/\/{2,}/g, '/').replace(/\/+$/, '') || '/';
    const canonicalPath = getLegacyCanonicalUrl(normalizedPath) || normalizedPath;
    return queryPart && canonicalPath === normalizedPath ? `${canonicalPath}?${queryPart}` : canonicalPath;
};

const isLegacyRemovedUrl = (value: unknown) => {
    const normalized = normalizeMenuUrl(value);
    if (!normalized) return false;
    const [pathOnly] = normalized.split('?');
    return LEGACY_MENU_URL_PREFIXES.some((prefix) => pathOnly === prefix || pathOnly.startsWith(`${prefix}/`));
};

const sanitizeChildren = (children: unknown): MenuChild[] => {
    if (!Array.isArray(children)) return [];
    return children
        .map((child) => ({
            name: toSafeText((child as MenuChild)?.name),
            url: normalizeMenuUrl((child as MenuChild)?.url),
            hidden: (child as MenuChild)?.hidden === true,
        }))
        .filter((child) => child.name && child.url && !isLegacyRemovedUrl(child.url));
};

const mergeFallbackChildren = (items: MenuItem[], fallbackItems: MenuItem[]): MenuItem[] => {
    return items.map((item) => {
        const fallbackItem = fallbackItems.find((fallback) => fallback.url === item.url);
        if (!fallbackItem?.children?.length) return item;

        const currentChildren = item.children || [];
        const mergedChildren = [...currentChildren];
        fallbackItem.children.forEach((fallbackChild) => {
            if (!mergedChildren.some((child) => child.url === fallbackChild.url)) {
                mergedChildren.push(fallbackChild);
            }
        });

        return {
            ...item,
            children: mergedChildren,
        };
    });
};

export const cloneDefaultMenus = (): MenuConfig => deepCloneMenus(MENUS);

export const sanitizeMenuConfig = (raw: unknown): MenuConfig => {
    const fallback = cloneDefaultMenus();
    if (!raw || typeof raw !== 'object') {
        return fallback;
    }

    const parsePortal = (portal: PortalType) => {
        const source = (raw as Record<string, unknown>)[portal];
        if (!Array.isArray(source)) {
            return fallback[portal];
        }

        const sanitized = source
            .map((item) => ({
                name: toSafeText((item as MenuItem)?.name),
                url: normalizeMenuUrl((item as MenuItem)?.url),
                icon: toSafeText((item as MenuItem)?.icon),
                children: sanitizeChildren((item as MenuItem)?.children),
            }))
            .filter((item) => item.name && item.url && !isLegacyRemovedUrl(item.url))
            .map((item) => ({
                ...item,
                icon: item.icon || fallback[portal].find((x) => x.url === item.url)?.icon || '',
            }));

        const withFallbackChildren = mergeFallbackChildren(sanitized, fallback[portal]);
        const missingParents = fallback[portal].filter(
            (fallbackItem) => !withFallbackChildren.some((item) => item.url === fallbackItem.url),
        );

        return [...withFallbackChildren, ...missingParents];
    };

    return {
        student: parsePortal('student'),
        teacher: parsePortal('teacher'),
    };
};
