import React, { useEffect, useMemo, useState } from 'react';
import { doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore';
import { useAuth } from '../../../contexts/AuthContext';
import { db } from '../../../lib/firebase';

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
