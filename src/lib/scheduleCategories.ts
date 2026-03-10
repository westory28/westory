import { useEffect, useMemo, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from './firebase';

export interface ScheduleCategory {
    key: string;
    label: string;
    color: string;
    emoji: string;
    order: number;
    locked?: boolean;
}

type RawScheduleCategory = Partial<ScheduleCategory> & { id?: string };

export const COLOR_EMOJI_OPTIONS = ['🔴', '🟠', '🟡', '🟢', '🔵', '🟣', '🟤', '⚫', '⚪'];

export const DEFAULT_SCHEDULE_CATEGORIES: ScheduleCategory[] = [
    { key: 'exam', label: '정기 시험', color: '#ef4444', emoji: '🔴', order: 0, locked: true },
    { key: 'performance', label: '수행평가', color: '#f97316', emoji: '🟠', order: 1, locked: true },
    { key: 'event', label: '행사', color: '#10b981', emoji: '🟢', order: 2, locked: true },
    { key: 'diagnosis', label: '진단평가', color: '#3b82f6', emoji: '🔵', order: 3, locked: true },
    { key: 'formative', label: '형성평가', color: '#6366f1', emoji: '🟣', order: 4, locked: true },
];

const DEFAULT_CATEGORY_MAP = new Map(DEFAULT_SCHEDULE_CATEGORIES.map((item) => [item.key, item]));

const normalizeColor = (value: unknown, fallback: string) => {
    const color = String(value || '').trim();
    return /^#[0-9a-fA-F]{6}$/.test(color) ? color : fallback;
};

const normalizeEmoji = (value: unknown, fallback: string) => {
    const emoji = String(value || '').trim();
    return emoji || fallback;
};

const sanitizeKey = (value: unknown) =>
    String(value || '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9_-]+/g, '-')
        .replace(/^-+|-+$/g, '');

export const createScheduleCategoryKey = (label: string) => {
    const base = sanitizeKey(label) || 'category';
    return `${base}-${Date.now().toString(36)}`;
};

export const resolveScheduleCategories = (items?: RawScheduleCategory[]): ScheduleCategory[] => {
    const normalized = new Map<string, ScheduleCategory>();

    DEFAULT_SCHEDULE_CATEGORIES.forEach((item) => {
        normalized.set(item.key, item);
    });

    (items || []).forEach((item, index) => {
        const key = sanitizeKey(item?.key || item?.id);
        if (!key) return;
        const fallback = DEFAULT_CATEGORY_MAP.get(key);
        normalized.set(key, {
            key,
            label: String(item?.label || fallback?.label || '일정').trim() || fallback?.label || '일정',
            color: normalizeColor(item?.color, fallback?.color || '#6b7280'),
            emoji: normalizeEmoji(item?.emoji, fallback?.emoji || '🔹'),
            order: typeof item?.order === 'number' ? item.order : fallback?.order ?? DEFAULT_SCHEDULE_CATEGORIES.length + index,
            locked: fallback?.locked || false,
        });
    });

    return Array.from(normalized.values()).sort((a, b) => a.order - b.order);
};

export const getScheduleCategoryMeta = (key: unknown, categories?: ScheduleCategory[]) => {
    const categoryKey = String(key || '').trim();
    const source = categories && categories.length > 0 ? categories : DEFAULT_SCHEDULE_CATEGORIES;
    return source.find((item) => item.key === categoryKey)
        || DEFAULT_CATEGORY_MAP.get(categoryKey)
        || {
            key: categoryKey || 'event',
            label: categoryKey || '일정',
            color: '#6b7280',
            emoji: '🔹',
            order: 999,
            locked: false,
        };
};

export const useScheduleCategories = () => {
    const [categories, setCategories] = useState<ScheduleCategory[]>(DEFAULT_SCHEDULE_CATEGORIES);

    useEffect(() => {
        const ref = doc(db, 'site_settings', 'schedule_categories');
        const unsubscribe = onSnapshot(
            ref,
            (snapshot) => {
                const data = snapshot.data() as { items?: RawScheduleCategory[] } | undefined;
                setCategories(resolveScheduleCategories(data?.items));
            },
            (error) => {
                console.error('Failed to load schedule categories:', error);
                setCategories(DEFAULT_SCHEDULE_CATEGORIES);
            }
        );
        return () => unsubscribe();
    }, []);

    const categoryMap = useMemo(() => {
        return categories.reduce<Record<string, ScheduleCategory>>((acc, item) => {
            acc[item.key] = item;
            return acc;
        }, {});
    }, [categories]);

    return { categories, categoryMap };
};
