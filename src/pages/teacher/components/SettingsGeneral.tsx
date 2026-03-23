import React, { useEffect, useMemo, useState } from 'react';
import { doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore';
import { useAuth } from '../../../contexts/AuthContext';
import { db } from '../../../lib/firebase';
import {
    loadSemesterReadiness,
    type SemesterReadinessResult,
    type SemesterReadinessStatus,
} from '../../../lib/semesterReadiness';

type SettingsConfigState = {
    year: string;
    semester: string;
    showQuiz: boolean;
    showScore: boolean;
    showLesson: boolean;
};

type SemesterRegistryItem = {
    year: string;
    semester: string;
    label: string;
    shellReady?: boolean;
    createdBy?: string;
};

const DEFAULT_YEAR = '2026';
const DEFAULT_SEMESTER = '1';
const DEFAULT_CONFIG: SettingsConfigState = {
    year: DEFAULT_YEAR,
    semester: DEFAULT_SEMESTER,
    showQuiz: true,
    showScore: true,
    showLesson: true,
};
const DEFAULT_POINT_POLICY = {
    attendanceDaily: 5,
    attendanceMonthlyBonus: 20,
    lessonView: 3,
    quizSolve: 10,
    manualAdjustEnabled: false,
    allowNegativeBalance: false,
    updatedBy: '',
};

const normalizeYear = (value: unknown) => {
    const next = String(value || '').trim();
    return /^\d{4}$/.test(next) ? next : DEFAULT_YEAR;
};

const normalizeSemester = (value: unknown) => String(value || '').trim() === '2' ? '2' : DEFAULT_SEMESTER;

const buildSemesterLabel = (year: string, semester: string) => `${year}학년도 ${semester}학기`;

const sortSemesterRegistry = (items: SemesterRegistryItem[]) => (
    [...items].sort((a, b) => {
        const yearDiff = Number.parseInt(b.year, 10) - Number.parseInt(a.year, 10);
        if (yearDiff !== 0) return yearDiff;
        return Number.parseInt(a.semester, 10) - Number.parseInt(b.semester, 10);
    })
);

const buildSemesterRegistry = (
    rawItems: unknown,
    fallbackYear: string,
    fallbackSemester: string,
): SemesterRegistryItem[] => {
    const registry = new Map<string, SemesterRegistryItem>();

    if (Array.isArray(rawItems)) {
        rawItems.forEach((item) => {
            if (!item || typeof item !== 'object') return;
            const candidate = item as Partial<SemesterRegistryItem>;
            const year = normalizeYear(candidate.year);
            const semester = normalizeSemester(candidate.semester);
            const key = `${year}::${semester}`;
            registry.set(key, {
                year,
                semester,
                label: candidate.label?.trim() || buildSemesterLabel(year, semester),
                shellReady: candidate.shellReady !== false,
                createdBy: candidate.createdBy || '',
            });
        });
    }

    const fallbackKey = `${fallbackYear}::${fallbackSemester}`;
    if (!registry.has(fallbackKey)) {
        registry.set(fallbackKey, {
            year: fallbackYear,
            semester: fallbackSemester,
            label: buildSemesterLabel(fallbackYear, fallbackSemester),
            shellReady: true,
            createdBy: '',
        });
    }

    return sortSemesterRegistry(Array.from(registry.values()));
};

const STATUS_META: Record<SemesterReadinessStatus, { label: string; badgeClass: string; warningClass: string }> = {
    ready: {
        label: '\uc900\ube44 \uc644\ub8cc',
        badgeClass: 'border-emerald-200 bg-emerald-50 text-emerald-700',
        warningClass: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    },
    partial: {
        label: '\uc77c\ubd80 \ube44\uc5b4 \uc788\uc74c',
        badgeClass: 'border-amber-200 bg-amber-50 text-amber-800',
        warningClass: 'border-amber-200 bg-amber-50 text-amber-800',
    },
    danger: {
        label: '\uc804\ud658 \ube44\uad8c\uc7a5',
        badgeClass: 'border-red-200 bg-red-50 text-red-700',
        warningClass: 'border-red-200 bg-red-50 text-red-700',
    },
};

const SettingsGeneral: React.FC = () => {
    const { currentUser } = useAuth();
    const [config, setConfig] = useState<SettingsConfigState>(DEFAULT_CONFIG);
    const [availableSemesters, setAvailableSemesters] = useState<SemesterRegistryItem[]>([
        {
            year: DEFAULT_YEAR,
            semester: DEFAULT_SEMESTER,
            label: buildSemesterLabel(DEFAULT_YEAR, DEFAULT_SEMESTER),
            shellReady: true,
            createdBy: '',
        },
    ]);
    const [newSemester, setNewSemester] = useState({ year: DEFAULT_YEAR, semester: DEFAULT_SEMESTER });
    const [feedback, setFeedback] = useState('');
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [creating, setCreating] = useState(false);
    const [readiness, setReadiness] = useState<SemesterReadinessResult | null>(null);
    const [readinessLoading, setReadinessLoading] = useState(false);
    const [readinessError, setReadinessError] = useState('');

    const loadConfig = async () => {
        try {
            const docRef = doc(db, 'site_settings', 'config');
            const docSnap = await getDoc(docRef);
            if (docSnap.exists()) {
                const data = docSnap.data();
                const year = normalizeYear(data.year);
                const semester = normalizeSemester(data.semester);
                setConfig({
                    year,
                    semester,
                    showQuiz: data.showQuiz !== false,
                    showScore: data.showScore !== false,
                    showLesson: data.showLesson !== false,
                });
                setAvailableSemesters(buildSemesterRegistry(data.availableSemesters, year, semester));
                setNewSemester({ year, semester });
            } else {
                setAvailableSemesters(buildSemesterRegistry([], DEFAULT_YEAR, DEFAULT_SEMESTER));
                setNewSemester({ year: DEFAULT_YEAR, semester: DEFAULT_SEMESTER });
            }
        } catch (error) {
            console.error("Failed to load config:", error);
            alert("설정을 불러오는데 실패했습니다.");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        void loadConfig();
    }, []);

    useEffect(() => {
        if (loading) return;

        let isMounted = true;
        const year = normalizeYear(config.year);
        const semester = normalizeSemester(config.semester);

        setReadiness(null);
        setReadinessLoading(true);
        setReadinessError('');

        void loadSemesterReadiness(year, semester)
            .then((result) => {
                if (!isMounted) return;
                setReadiness(result);
            })
            .catch((error) => {
                console.error("Failed to load semester readiness:", error);
                if (!isMounted) return;
                setReadinessError('준비 현황을 불러오지 못했습니다.');
            })
            .finally(() => {
                if (!isMounted) return;
                setReadinessLoading(false);
            });

        return () => {
            isMounted = false;
        };
    }, [loading, config.year, config.semester]);

    const yearOptions = useMemo(() => {
        const years = new Set(availableSemesters.map((item) => item.year));
        years.add(config.year);
        return Array.from(years).sort((a, b) => Number.parseInt(b, 10) - Number.parseInt(a, 10));
    }, [availableSemesters, config.year]);

    const semesterOptions = useMemo(() => {
        const filtered = availableSemesters.filter((item) => item.year === config.year);
        if (filtered.length > 0) return sortSemesterRegistry(filtered);
        return [
            {
                year: config.year,
                semester: config.semester,
                label: buildSemesterLabel(config.year, config.semester),
                shellReady: true,
                createdBy: '',
            },
        ];
    }, [availableSemesters, config.year, config.semester]);

    const requiredReadyCount = readiness?.requiredItems.filter((item) => item.ready).length || 0;
    const advisoryReadyCount = readiness?.advisoryItems.filter((item) => item.ready).length || 0;
    const missingRequiredLabels = readiness?.requiredItems.filter((item) => !item.ready).map((item) => item.label) || [];
    const missingAdvisoryLabels = readiness?.advisoryItems.filter((item) => !item.ready).map((item) => item.label) || [];
    const readinessStatusMeta = readiness ? STATUS_META[readiness.status] : null;
    const readinessStatusClass = readinessStatusMeta?.badgeClass || 'border-gray-200 bg-gray-50 text-gray-700';
    const readinessWarningClass = readinessStatusMeta?.warningClass || 'border-amber-200 bg-amber-50 text-amber-800';

    const ensurePointPolicyShell = async (year: string, semester: string) => {
        const policyRef = doc(db, 'years', year, 'semesters', semester, 'point_policies', 'current');
        const policySnap = await getDoc(policyRef);
        if (policySnap.exists()) return;

        await setDoc(policyRef, {
            ...DEFAULT_POINT_POLICY,
            updatedAt: serverTimestamp(),
            updatedBy: currentUser?.email || currentUser?.uid || '',
        });
    };

    const ensureDocShell = async (path: string, data: Record<string, unknown>) => {
        const targetRef = doc(db, path);
        const targetSnap = await getDoc(targetRef);
        if (targetSnap.exists()) return;
        await setDoc(targetRef, data);
    };

    const ensureSemesterOperationalSeeds = async (year: string, semester: string) => {
        const seededBy = currentUser?.email || currentUser?.uid || '';
        const buildSeedMeta = () => ({
            shellReady: true,
            seededAt: serverTimestamp(),
            seededBy,
        });

        await Promise.all([
            ensureDocShell(
                `years/${year}/semesters/${semester}/assessment_config/settings`,
                buildSeedMeta(),
            ),
            ensureDocShell(
                `years/${year}/semesters/${semester}/exam_config/final_exam`,
                {
                    ...buildSeedMeta(),
                    objective: [],
                    subjective: [],
                },
            ),
            ensureDocShell(
                `years/${year}/semesters/${semester}/grading_plans_meta/current`,
                buildSeedMeta(),
            ),
            ensureDocShell(
                `years/${year}/semesters/${semester}/calendar_meta/current`,
                buildSeedMeta(),
            ),
            ensureDocShell(
                `years/${year}/semesters/${semester}/notices_meta/current`,
                buildSeedMeta(),
            ),
        ]);
    };

    const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
        const { name, value, type } = e.target;
        const checked = (e.target as HTMLInputElement).checked;

        if (type === 'checkbox') {
            const key = name as keyof SettingsConfigState;
            setConfig((prev) => ({
                ...prev,
                [key]: checked,
            } as SettingsConfigState));
            return;
        }

        if (name === 'year') {
            const nextYear = value;
            const nextSemesterOptions = availableSemesters.filter((item) => item.year === nextYear);
            setConfig((prev) => ({
                ...prev,
                year: nextYear,
                semester: nextSemesterOptions.some((item) => item.semester === prev.semester)
                    ? prev.semester
                    : (nextSemesterOptions[0]?.semester || DEFAULT_SEMESTER),
            }));
            return;
        }

        const key = name as keyof SettingsConfigState;
        setConfig((prev) => ({
            ...prev,
            [key]: value,
        } as SettingsConfigState));
    };

    const handleNewSemesterChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
        const { name, value } = e.target;
        setNewSemester((prev) => ({
            ...prev,
            [name]: value,
        }));
    };

    const handleCreateSemester = async () => {
        const year = String(newSemester.year || '').trim();
        const semester = normalizeSemester(newSemester.semester);

        if (!/^\d{4}$/.test(year)) {
            alert('학년도는 4자리 숫자로 입력해주세요.');
            return;
        }

        if (availableSemesters.some((item) => item.year === year && item.semester === semester)) {
            setConfig((prev) => ({ ...prev, year, semester }));
            setFeedback(`${buildSemesterLabel(year, semester)}는 이미 준비되어 있습니다. 위 설정 저장을 누르면 활성 학기로 전환됩니다.`);
            return;
        }

        setCreating(true);
        setFeedback('');
        try {
            await ensurePointPolicyShell(year, semester);
            await ensureSemesterOperationalSeeds(year, semester);

            const nextRegistry = buildSemesterRegistry(
                [
                    ...availableSemesters,
                    {
                        year,
                        semester,
                        label: buildSemesterLabel(year, semester),
                        shellReady: true,
                        createdBy: currentUser?.email || currentUser?.uid || '',
                    },
                ],
                config.year,
                config.semester,
            );

            await setDoc(doc(db, 'site_settings', 'config'), {
                availableSemesters: nextRegistry,
            }, { merge: true });

            setAvailableSemesters(nextRegistry);
            setConfig((prev) => ({
                ...prev,
                year,
                semester,
            }));
            setFeedback(`${buildSemesterLabel(year, semester)}를 준비했습니다. 위 설정 저장을 누르면 활성 학기로 전환됩니다.`);
        } catch (error) {
            console.error("Failed to create semester shell:", error);
            alert(`새 학기 생성 실패: ${error}`);
        } finally {
            setCreating(false);
        }
    };

    const handleSave = async () => {
        setSaving(true);
        try {
            const year = normalizeYear(config.year);
            const semester = normalizeSemester(config.semester);
            const nextRegistry = buildSemesterRegistry(availableSemesters, year, semester);

            await ensurePointPolicyShell(year, semester);
            await setDoc(doc(db, 'site_settings', 'config'), {
                ...config,
                year,
                semester,
                availableSemesters: nextRegistry,
            }, { merge: true });
            alert("기본 설정이 저장되었습니다. 변경 사항을 적용하기 위해 페이지를 새로고침합니다.");
            window.location.reload();
        } catch (error) {
            console.error("Failed to save config:", error);
            alert("설정 저장 실패: " + error);
        } finally {
            setSaving(false);
        }
    };

    if (loading) return <div className="text-center py-10">Loading...</div>;

    return (
        <div className="bg-white rounded-xl border border-gray-200 p-6 lg:p-8 shadow-sm max-w-3xl">
            <div className="border-b border-gray-100 pb-4 mb-6">
                <h3 className="text-lg font-bold text-gray-900">시스템 기본 설정</h3>
                <p className="text-sm text-gray-500 mt-1">학년도와 학기, 메뉴 표시 여부를 제어합니다.</p>
            </div>

            <div className="space-y-6">
                <div className="rounded-xl border border-blue-100 bg-blue-50 p-4">
                    <div className="flex flex-col gap-4">
                        <div>
                            <div className="text-xs font-bold text-blue-700">현재 활성 학기</div>
                            <div className="mt-1 text-lg font-extrabold text-blue-900">
                                {buildSemesterLabel(config.year, config.semester)}
                            </div>
                        </div>
                        <div className="flex flex-wrap gap-2">
                            {availableSemesters.map((item) => (
                                <span
                                    key={`${item.year}-${item.semester}`}
                                    className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-bold ${
                                        item.year === config.year && item.semester === config.semester
                                            ? 'border-blue-600 bg-blue-600 text-white'
                                            : 'border-blue-200 bg-white text-blue-700'
                                    }`}
                                >
                                    {item.label}
                                </span>
                            ))}
                        </div>
                    </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div>
                        <label className="block text-sm font-bold text-gray-700 mb-2">학년도</label>
                        <select
                            name="year"
                            value={config.year}
                            onChange={handleChange}
                            className="w-full border border-gray-300 rounded-lg p-3 bg-gray-50 focus:ring-2 focus:ring-blue-500 font-bold text-gray-800 outline-none"
                        >
                            {yearOptions.map((year) => (
                                <option key={year} value={year}>{year}학년도</option>
                            ))}
                        </select>
                    </div>
                    <div>
                        <label className="block text-sm font-bold text-gray-700 mb-2">학기</label>
                        <select
                            name="semester"
                            value={config.semester}
                            onChange={handleChange}
                            className="w-full border border-gray-300 rounded-lg p-3 bg-gray-50 focus:ring-2 focus:ring-blue-500 font-bold text-gray-800 outline-none"
                        >
                            {semesterOptions.map((item) => (
                                <option key={`${item.year}-${item.semester}`} value={item.semester}>
                                    {item.semester}학기
                                </option>
                            ))}
                        </select>
                    </div>
                </div>

                <div className="bg-amber-50 text-amber-800 text-xs p-3 rounded-lg border border-amber-200 font-bold flex items-start gap-2">
                    <i className="fas fa-exclamation-triangle mt-0.5"></i>
                    <span>학년도와 학기를 변경하면 해당 기간의 데이터베이스로 즉시 전환됩니다. 학생들의 데이터 조회 범위가 변경됩니다.</span>
                </div>

                <div className="rounded-xl border border-gray-200 bg-white p-4">
                    <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                        <div>
                            <div className="text-xs font-bold text-gray-500">선택 학기 준비 현황</div>
                            <div className="mt-2 flex flex-wrap items-center gap-2">
                                <span className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-bold ${readinessStatusClass}`}>
                                    {readinessLoading ? '\ud655\uc778 \uc911...' : (readinessStatusMeta?.label || '\ud655\uc778 \ud544\uc694')}
                                </span>
                                <span className="text-xs font-bold text-gray-500">
                                    {buildSemesterLabel(config.year, config.semester)}
                                </span>
                            </div>
                        </div>
                        {!readinessLoading && readiness && (
                            <div className="grid grid-cols-2 gap-2 text-xs font-bold text-gray-600 md:text-right">
                                <span>필수 {requiredReadyCount}/{readiness.requiredItems.length}</span>
                                <span>참고 {advisoryReadyCount}/{readiness.advisoryItems.length}</span>
                            </div>
                        )}
                    </div>

                    {readinessError && (
                        <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-bold text-red-700">
                            {readinessError}
                        </div>
                    )}

                    {!readinessLoading && readiness && (
                        <div className="mt-3 space-y-2 text-xs">
                            <div className="text-gray-700">
                                <span className="font-bold">필수 항목</span>
                                <span className="ml-2 text-gray-500">
                                    {missingRequiredLabels.length > 0 ? missingRequiredLabels.join(', ') : '모두 준비됨'}
                                </span>
                            </div>
                            <div className="text-gray-600">
                                <span className="font-bold">참고 항목</span>
                                <span className="ml-2 text-gray-500">
                                    {missingAdvisoryLabels.length > 0 ? missingAdvisoryLabels.join(', ') : '모두 준비됨'}
                                </span>
                            </div>
                        </div>
                    )}
                </div>

                <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
                    <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
                        <div>
                            <h4 className="text-sm font-bold text-gray-900">새로운 학기 준비</h4>
                            <p className="text-xs text-gray-500 mt-1">새로운 학년/학기를 만들고 기본 shell만 준비합니다. 콘텐츠 복제나 데이터 이월은 하지 않습니다.</p>
                        </div>
                        {feedback && (
                            <div className="text-xs font-bold text-blue-700">
                                {feedback}
                            </div>
                        )}
                    </div>
                    <div className="mt-4 grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_minmax(0,160px)_auto] gap-3">
                        <input
                            type="text"
                            name="year"
                            value={newSemester.year}
                            onChange={handleNewSemesterChange}
                            inputMode="numeric"
                            placeholder="2027"
                            className="w-full border border-gray-300 rounded-lg p-3 bg-white font-bold text-gray-800 outline-none focus:ring-2 focus:ring-blue-500"
                        />
                        <select
                            name="semester"
                            value={newSemester.semester}
                            onChange={handleNewSemesterChange}
                            className="w-full border border-gray-300 rounded-lg p-3 bg-white font-bold text-gray-800 outline-none focus:ring-2 focus:ring-blue-500"
                        >
                            <option value="1">1학기</option>
                            <option value="2">2학기</option>
                        </select>
                        <button
                            type="button"
                            onClick={handleCreateSemester}
                            disabled={creating}
                            className="bg-white hover:bg-gray-100 disabled:opacity-60 text-gray-800 font-bold py-3 px-5 rounded-xl border border-gray-300 shadow-sm transition"
                        >
                            {creating ? '생성 중...' : '학기 생성'}
                        </button>
                    </div>
                </div>

                <div className="border-t border-gray-100 pt-6">
                    <label className="block text-sm font-bold text-gray-700 mb-4">학생 메뉴 표시 제어</label>
                    <div className="space-y-3">
                        <label className="flex items-center justify-between p-4 bg-gray-50 rounded-lg border border-gray-200 cursor-pointer hover:bg-gray-100 transition">
                            <div className="flex items-center gap-3">
                                <div className="w-10 h-10 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center">
                                    <i className="fas fa-gamepad"></i>
                                </div>
                                <span className="font-bold text-gray-700">평가(Quiz)</span>
                            </div>
                            <input
                                type="checkbox"
                                name="showQuiz"
                                checked={config.showQuiz}
                                onChange={handleChange}
                                className="w-5 h-5 text-blue-600 rounded focus:ring-blue-500"
                            />
                        </label>
                        <label className="flex items-center justify-between p-4 bg-gray-50 rounded-lg border border-gray-200 cursor-pointer hover:bg-gray-100 transition">
                            <div className="flex items-center gap-3">
                                <div className="w-10 h-10 rounded-full bg-green-100 text-green-600 flex items-center justify-center">
                                    <i className="fas fa-chart-bar"></i>
                                </div>
                                <span className="font-bold text-gray-700">점수(Score)</span>
                            </div>
                            <input
                                type="checkbox"
                                name="showScore"
                                checked={config.showScore}
                                onChange={handleChange}
                                className="w-5 h-5 text-blue-600 rounded focus:ring-blue-500"
                            />
                        </label>
                        <label className="flex items-center justify-between p-4 bg-gray-50 rounded-lg border border-gray-200 cursor-pointer hover:bg-gray-100 transition">
                            <div className="flex items-center gap-3">
                                <div className="w-10 h-10 rounded-full bg-purple-100 text-purple-600 flex items-center justify-center">
                                    <i className="fas fa-book-reader"></i>
                                </div>
                                <span className="font-bold text-gray-700">수업자료(Lesson)</span>
                            </div>
                            <input
                                type="checkbox"
                                name="showLesson"
                                checked={config.showLesson}
                                onChange={handleChange}
                                className="w-5 h-5 text-blue-600 rounded focus:ring-blue-500"
                            />
                        </label>
                    </div>
                </div>

                <div className="pt-4 text-right">
                    {!readinessLoading && readiness && readiness.status !== 'ready' && (
                        <div className={`mb-4 rounded-xl border p-4 text-left text-sm font-bold flex items-start gap-3 ${readinessWarningClass}`}>
                            <i className="fas fa-exclamation-triangle mt-0.5"></i>
                            <div>
                                <div>
                                    {readiness.status === 'danger'
                                        ? '\ud575\uc2ec \uc900\ube44 \ud56d\ubaa9\uc774 \ube44\uc5b4 \uc788\uc5b4 \ud604\uc7ac \ud559\uae30\ub85c \uc804\ud658\ud558\ub294 \uac83\uc744 \uad8c\uc7a5\ud558\uc9c0 \uc54a\uc2b5\ub2c8\ub2e4.'
                                        : '\uc77c\ubd80 \ud56d\ubaa9\uc774 \ube44\uc5b4 \uc788\uc2b5\ub2c8\ub2e4. \uc800\uc7a5\uc740 \uac00\ub2a5\ud558\uc9c0\ub9cc \uc804\ud658 \uc804 \ud655\uc778\uc744 \uad8c\uc7a5\ud569\ub2c8\ub2e4.'}
                                </div>
                                <div className="mt-1 text-xs font-semibold">
                                    {missingRequiredLabels.length > 0
                                        ? `\ud544\uc218 \ud655\uc778: ${missingRequiredLabels.join(', ')}`
                                        : '\ud544\uc218 \ud56d\ubaa9\uc740 \uc900\ube44\ub418\uc5c8\uace0 \ucc38\uace0 \ud56d\ubaa9\ub9cc \ucd94\uac00 \ud655\uc778\uc774 \ud544\uc694\ud569\ub2c8\ub2e4.'}
                                </div>
                            </div>
                        </div>
                    )}
                    <button
                        onClick={handleSave}
                        disabled={saving}
                        className="bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white font-bold py-3 px-8 rounded-xl shadow-lg transition transform active:scale-95"
                    >
                        {saving ? '저장 중...' : '설정 저장'}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default SettingsGeneral;
