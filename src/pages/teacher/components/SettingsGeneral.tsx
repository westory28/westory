import React, { useEffect, useMemo, useState } from 'react';
import { doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore';
import { useAuth } from '../../../contexts/AuthContext';
import { db } from '../../../lib/firebase';
import { DEFAULT_POINT_RANK_POLICY } from '../../../lib/pointRanks';
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

type SemesterSelectionState = Pick<SettingsConfigState, 'year' | 'semester'>;
type ReadinessListItem = SemesterReadinessResult['requiredItems'][number];

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
    rankPolicy: DEFAULT_POINT_RANK_POLICY,
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

const READINESS_ITEM_META: Record<ReadinessListItem['key'], { readyHint: string; missingHint: string; actionHint: string }> = {
    curriculumTree: {
        readyHint: '단원·차시 기준이 있어 수업자료와 평가 연결을 시작할 수 있습니다.',
        missingHint: '교육과정 트리가 비어 있으면 수업자료와 문제은행 기준이 없어 실제 운영 준비가 끝난 상태가 아닙니다.',
        actionHint: '수업자료에서 교육과정 트리부터 채워 주세요.',
    },
    assessmentSettings: {
        readyHint: '평가 기본 설정을 확인할 수 있습니다.',
        missingHint: '평가 설정이 비어 있어 학기 운영 기준이 아직 고정되지 않았습니다.',
        actionHint: '평가 설정의 기본 항목을 먼저 확인해 주세요.',
    },
    finalExam: {
        readyHint: '시험 구성 초안 또는 기본 shell이 있습니다.',
        missingHint: '시험 구성이 비어 있어 평가 운영 준비가 아직 부족합니다.',
        actionHint: '시험 구성에서 객관식 또는 서술형 틀을 먼저 잡아 주세요.',
    },
    gradingPlans: {
        readyHint: '채점 계획 기준을 이어서 설정할 수 있습니다.',
        missingHint: '채점 계획이 없어 점수 운영 기준이 바로 보이지 않습니다.',
        actionHint: '채점 계획을 최소 1개 준비해 주세요.',
    },
    calendar: {
        readyHint: '학사 일정 기준을 이어서 채울 수 있습니다.',
        missingHint: '학사 일정이 비어 있으면 학기 운영 리듬을 공유하기 어렵습니다.',
        actionHint: '학사 일정을 먼저 채워 주세요.',
    },
    notices: {
        readyHint: '공지 기준 문서가 준비되어 있습니다.',
        missingHint: '공지 영역이 비어 있으면 첫 안내 전달 창구가 약합니다.',
        actionHint: '필수 공지를 한 건 이상 준비해 주세요.',
    },
    pointProducts: {
        readyHint: '포인트 활용을 바로 이어갈 수 있습니다.',
        missingHint: '포인트 상품이 없으면 포인트를 지급해도 바로 쓰기 어렵습니다.',
        actionHint: '기본 포인트 상품을 먼저 등록해 주세요.',
    },
    quizQuestions: {
        readyHint: '문제은행을 이어서 운영할 수 있습니다.',
        missingHint: '문제은행이 비어 있어 퀴즈 운영은 추가 준비가 필요합니다.',
        actionHint: '자주 쓰는 문항부터 채워 주세요.',
    },
    historyClassrooms: {
        readyHint: '히스토리 클래스룸 자료가 준비되어 있습니다.',
        missingHint: '히스토리 클래스룸 자료가 없어 해당 활동은 바로 운영하기 어렵습니다.',
        actionHint: '필요한 활동만 우선 등록해 주세요.',
    },
    mapResources: {
        readyHint: '지도 자료를 이어서 활용할 수 있습니다.',
        missingHint: '지도 자료가 비어 있으면 관련 수업 준비가 늦어질 수 있습니다.',
        actionHint: '필요한 지도 자료를 먼저 올려 주세요.',
    },
};

const SettingsGeneral: React.FC = () => {
    const { currentUser } = useAuth();
    const [config, setConfig] = useState<SettingsConfigState>(DEFAULT_CONFIG);
    const [activeSemester, setActiveSemester] = useState<SemesterSelectionState>({
        year: DEFAULT_YEAR,
        semester: DEFAULT_SEMESTER,
    });
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
                setActiveSemester({ year, semester });
                setAvailableSemesters(buildSemesterRegistry(data.availableSemesters, year, semester));
                setNewSemester({ year, semester });
            } else {
                setActiveSemester({ year: DEFAULT_YEAR, semester: DEFAULT_SEMESTER });
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

    const activeSemesterLabel = buildSemesterLabel(activeSemester.year, activeSemester.semester);
    const selectedSemesterLabel = buildSemesterLabel(config.year, config.semester);
    const hasPendingSemesterSwitch = activeSemester.year !== config.year || activeSemester.semester !== config.semester;
    const requiredReadyCount = readiness?.requiredItems.filter((item) => item.ready).length || 0;
    const advisoryReadyCount = readiness?.advisoryItems.filter((item) => item.ready).length || 0;
    const missingRequiredItems = readiness?.requiredItems.filter((item) => !item.ready) || [];
    const missingAdvisoryItems = readiness?.advisoryItems.filter((item) => !item.ready) || [];
    const curriculumTreeMissing = missingRequiredItems.some((item) => item.key === 'curriculumTree');
    const readinessStatusMeta = readiness ? STATUS_META[readiness.status] : null;
    const readinessStatusClass = readinessStatusMeta?.badgeClass || 'border-gray-200 bg-gray-50 text-gray-700';
    const readinessWarningClass = readinessStatusMeta?.warningClass || 'border-amber-200 bg-amber-50 text-amber-800';
    const readinessSummaryTitle = readiness
        ? (readiness.status === 'ready'
            ? '전환 기준 충족'
            : readiness.status === 'danger'
                ? '지금 전환하면 운영 공백 위험이 큽니다'
                : '기본 운영은 가능하지만 확인이 더 필요합니다')
        : '';
    const readinessSummaryDescription = readiness
        ? (readiness.status === 'ready'
            ? (missingAdvisoryItems.length > 0
                ? '핵심 운영 항목은 준비되었습니다. 참고 항목은 필요에 따라 이어서 채우면 됩니다.'
                : '핵심 운영 항목과 참고 항목이 모두 준비되어 있습니다.')
            : readiness.status === 'danger'
                ? '핵심 준비 항목이 비어 있어 현재 학기 전환은 비권장입니다.'
                : (missingRequiredItems.length > 0
                    ? '필수 항목 일부가 비어 있어 저장은 가능하지만 전환 전 확인을 권장합니다.'
                    : '핵심 운영은 가능하지만 참고 항목이 일부 비어 있습니다.'))
        : '';
    const priorityActionItems = [...missingRequiredItems, ...missingAdvisoryItems].slice(0, 3);

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
            setActiveSemester({ year, semester });
            setAvailableSemesters(nextRegistry);
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
                    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                        <div className="rounded-xl border border-blue-200 bg-white/80 p-4">
                            <div className="text-xs font-bold text-blue-700">현재 활성 학기</div>
                            <div className="mt-1 text-lg font-extrabold text-blue-900">{activeSemesterLabel}</div>
                            <p className="mt-2 text-xs font-semibold text-blue-700">
                                학생과 교사 화면에 실제 적용 중인 기준입니다.
                            </p>
                        </div>
                        <div className={`rounded-xl border p-4 ${hasPendingSemesterSwitch ? 'border-amber-200 bg-amber-50' : 'border-emerald-200 bg-emerald-50'}`}>
                            <div className="flex flex-wrap items-center gap-2">
                                <div className={`text-xs font-bold ${hasPendingSemesterSwitch ? 'text-amber-800' : 'text-emerald-700'}`}>
                                    {hasPendingSemesterSwitch ? '저장 시 전환 대상' : '현재 선택된 학기'}
                                </div>
                                <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-bold ${hasPendingSemesterSwitch ? 'border-amber-300 bg-white text-amber-800' : 'border-emerald-300 bg-white text-emerald-700'}`}>
                                    {hasPendingSemesterSwitch ? '변경 예정' : '현재와 동일'}
                                </span>
                            </div>
                            <div className={`mt-1 text-lg font-extrabold ${hasPendingSemesterSwitch ? 'text-amber-900' : 'text-emerald-900'}`}>
                                {selectedSemesterLabel}
                            </div>
                            <p className={`mt-2 text-xs font-semibold ${hasPendingSemesterSwitch ? 'text-amber-800' : 'text-emerald-700'}`}>
                                {hasPendingSemesterSwitch
                                    ? `${activeSemesterLabel}는 저장 전까지 그대로 유지됩니다.`
                                    : '저장해도 현재 운영 학기와 같은 값이 유지됩니다.'}
                            </p>
                        </div>
                    </div>
                    <div className="mt-4 rounded-xl border border-blue-100 bg-white/70 p-3">
                        <div className="text-xs font-bold text-blue-700">준비된 학기 목록</div>
                        <div className="mt-2 flex flex-wrap gap-2">
                            {availableSemesters.map((item) => (
                                (() => {
                                    const isActive = item.year === activeSemester.year && item.semester === activeSemester.semester;
                                    const isSelected = item.year === config.year && item.semester === config.semester;

                                    return (
                                        <span
                                            key={`${item.year}-${item.semester}`}
                                            className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-bold ${
                                                isActive
                                                    ? 'border-blue-600 bg-blue-600 text-white'
                                                    : isSelected
                                                        ? 'border-amber-300 bg-amber-50 text-amber-900'
                                                        : 'border-blue-200 bg-white text-blue-700'
                                            }`}
                                        >
                                            <span>{item.label}</span>
                                            {isActive && (
                                                <span className="rounded-full bg-white/20 px-2 py-0.5 text-[10px] font-extrabold text-white">
                                                    현재
                                                </span>
                                            )}
                                            {isSelected && !isActive && (
                                                <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-extrabold text-amber-700">
                                                    전환 대상
                                                </span>
                                            )}
                                        </span>
                                    );
                                })()
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
                    <span>학년도와 학기를 고르면 전환 대상만 먼저 바뀝니다. 실제 운영 학기는 저장 전까지 유지되며, 저장 후 해당 기간 데이터 기준으로 전환됩니다.</span>
                </div>

                <div className="rounded-xl border border-gray-200 bg-white p-4">
                    <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                        <div>
                            <div className="text-xs font-bold text-gray-500">
                                {hasPendingSemesterSwitch ? '저장 시 전환 대상 준비 현황' : '현재 활성 학기 준비 현황'}
                            </div>
                            <div className="mt-2 flex flex-wrap items-center gap-2">
                                <span className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-bold ${readinessStatusClass}`}>
                                    {readinessLoading ? '\ud655\uc778 \uc911...' : (readinessStatusMeta?.label || '\ud655\uc778 \ud544\uc694')}
                                </span>
                                <span className="text-xs font-bold text-gray-500">
                                    {selectedSemesterLabel}
                                </span>
                            </div>
                            {!readinessLoading && readiness && (
                                <>
                                    <div className="mt-3 text-sm font-bold text-gray-900">{readinessSummaryTitle}</div>
                                    <p className="mt-1 text-xs leading-5 text-gray-600">{readinessSummaryDescription}</p>
                                </>
                            )}
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
                        <>
                            <div className={`mt-4 rounded-xl border p-3 text-xs ${curriculumTreeMissing ? 'border-amber-200 bg-amber-50 text-amber-900' : 'border-slate-200 bg-slate-50 text-slate-700'}`}>
                                <div className="font-bold">
                                    {curriculumTreeMissing ? '교육과정 트리 확인 필요' : 'seed와 실제 운영 준비는 다릅니다'}
                                </div>
                                <div className="mt-1 leading-5">
                                    기본 seed가 있어도 curriculum/tree가 비어 있으면 실제 운영 준비는 완료되지 않습니다. 수업자료와 문제은행 연결 기준은 교육과정 트리가 채워져 있어야 잡힙니다.
                                </div>
                            </div>

                            <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
                                <div className="rounded-xl border border-gray-200 bg-gray-50 p-3">
                                    <div className="flex items-center justify-between">
                                        <div className="text-xs font-bold text-gray-700">필수 운영 항목</div>
                                        <span className="text-xs font-bold text-gray-500">
                                            {requiredReadyCount}/{readiness.requiredItems.length}
                                        </span>
                                    </div>
                                    <div className="mt-3 space-y-2">
                                        {readiness.requiredItems.map((item) => (
                                            <div
                                                key={item.key}
                                                className={`rounded-lg border px-3 py-2 ${
                                                    item.ready ? 'border-emerald-200 bg-white' : 'border-amber-200 bg-amber-50'
                                                }`}
                                            >
                                                <div className="flex items-start justify-between gap-3">
                                                    <div>
                                                        <div className="text-sm font-bold text-gray-800">{item.label}</div>
                                                        <div className={`mt-1 text-xs leading-5 ${item.ready ? 'text-gray-500' : 'text-amber-900'}`}>
                                                            {item.ready ? READINESS_ITEM_META[item.key].readyHint : READINESS_ITEM_META[item.key].missingHint}
                                                        </div>
                                                    </div>
                                                    <span className={`inline-flex shrink-0 items-center rounded-full border px-2 py-1 text-[11px] font-bold ${
                                                        item.ready
                                                            ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                                                            : 'border-amber-200 bg-white text-amber-800'
                                                    }`}>
                                                        {item.ready ? '준비됨' : '확인 필요'}
                                                    </span>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                                <div className="rounded-xl border border-gray-200 bg-gray-50 p-3">
                                    <div className="flex items-center justify-between">
                                        <div className="text-xs font-bold text-gray-700">운영 참고 항목</div>
                                        <span className="text-xs font-bold text-gray-500">
                                            {advisoryReadyCount}/{readiness.advisoryItems.length}
                                        </span>
                                    </div>
                                    <div className="mt-3 space-y-2">
                                        {readiness.advisoryItems.map((item) => (
                                            <div
                                                key={item.key}
                                                className={`rounded-lg border px-3 py-2 ${
                                                    item.ready ? 'border-emerald-200 bg-white' : 'border-slate-200 bg-white'
                                                }`}
                                            >
                                                <div className="flex items-start justify-between gap-3">
                                                    <div>
                                                        <div className="text-sm font-bold text-gray-800">{item.label}</div>
                                                        <div className={`mt-1 text-xs leading-5 ${item.ready ? 'text-gray-500' : 'text-slate-600'}`}>
                                                            {item.ready ? READINESS_ITEM_META[item.key].readyHint : READINESS_ITEM_META[item.key].missingHint}
                                                        </div>
                                                    </div>
                                                    <span className={`inline-flex shrink-0 items-center rounded-full border px-2 py-1 text-[11px] font-bold ${
                                                        item.ready
                                                            ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                                                            : 'border-slate-200 bg-slate-50 text-slate-600'
                                                    }`}>
                                                        {item.ready ? '준비됨' : '추가 준비'}
                                                    </span>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        </>
                    )}
                </div>

                <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
                    <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
                        <div>
                            <h4 className="text-sm font-bold text-gray-900">새로운 학기 준비</h4>
                            <p className="text-xs text-gray-500 mt-1">새로운 학년/학기를 만들고 기본 seed만 준비합니다. 콘텐츠 복제나 데이터 이월은 하지 않으며, 교육과정 트리가 비어 있으면 실제 운영 준비는 아직 끝난 상태가 아닙니다.</p>
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
                            <div className="flex-1">
                                <div>
                                    {readiness.status === 'danger'
                                        ? '왜 전환 비권장인지 먼저 확인해 주세요.'
                                        : '전환 전 먼저 채우면 좋은 항목입니다.'}
                                </div>
                                <div className="mt-1 text-xs font-semibold leading-5">
                                    {missingRequiredItems.length > 0
                                        ? `우선 ${missingRequiredItems.map((item) => item.label).join(', ')}부터 확인해 주세요.`
                                        : '핵심 운영 항목은 준비되었고, 아래 참고 항목을 채우면 운영 여유가 더 생깁니다.'}
                                </div>
                                {priorityActionItems.length > 0 && (
                                    <div className="mt-3 space-y-1.5 text-xs font-semibold">
                                        {priorityActionItems.map((item, index) => (
                                            <div key={item.key}>{`${index + 1}. ${READINESS_ITEM_META[item.key].actionHint}`}</div>
                                        ))}
                                    </div>
                                )}
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
