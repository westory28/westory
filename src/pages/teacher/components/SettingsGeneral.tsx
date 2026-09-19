import React, { useEffect, useMemo, useState } from "react";
import { doc, getDoc, serverTimestamp, setDoc } from "firebase/firestore";
import { useAppToast } from "../../../components/common/AppToastProvider";
import { InlineLoading } from "../../../components/common/LoadingState";
import { useAuth } from "../../../contexts/AuthContext";
import { notifySystemConfigUpdated } from "../../../lib/appEvents";
import { db } from "../../../lib/firebase";
import { getDefaultPointPolicy } from "../../../lib/points";
import { invalidateSiteSettingDocCache } from "../../../lib/siteSettings";
import {
  loadSemesterReadiness,
  type SemesterReadinessResult,
} from "../../../lib/semesterReadiness";

import SettingsSemesterReadiness from "./SettingsSemesterReadiness";

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

type SemesterSelectionState = Pick<SettingsConfigState, "year" | "semester">;

const DEFAULT_YEAR = "2026";
const DEFAULT_SEMESTER = "1";
const DEFAULT_CONFIG: SettingsConfigState = {
  year: DEFAULT_YEAR,
  semester: DEFAULT_SEMESTER,
  showQuiz: true,
  showScore: true,
  showLesson: true,
};
const DEFAULT_POINT_POLICY = getDefaultPointPolicy();

const normalizeYear = (value: unknown) => {
  const next = String(value || "").trim();
  return /^\d{4}$/.test(next) ? next : DEFAULT_YEAR;
};

const normalizeSemester = (value: unknown) =>
  String(value || "").trim() === "2" ? "2" : DEFAULT_SEMESTER;

const buildSemesterLabel = (year: string, semester: string) =>
  `${year}학년도 ${semester}학기`;

const sortSemesterRegistry = (items: SemesterRegistryItem[]) =>
  [...items].sort((a, b) => {
    const yearDiff = Number.parseInt(b.year, 10) - Number.parseInt(a.year, 10);
    if (yearDiff !== 0) return yearDiff;
    return Number.parseInt(a.semester, 10) - Number.parseInt(b.semester, 10);
  });

const buildSemesterRegistry = (
  rawItems: unknown,
  fallbackYear: string,
  fallbackSemester: string,
): SemesterRegistryItem[] => {
  const registry = new Map<string, SemesterRegistryItem>();

  if (Array.isArray(rawItems)) {
    rawItems.forEach((item) => {
      if (!item || typeof item !== "object") return;
      const candidate = item as Partial<SemesterRegistryItem>;
      const year = normalizeYear(candidate.year);
      const semester = normalizeSemester(candidate.semester);
      const key = `${year}::${semester}`;
      registry.set(key, {
        year,
        semester,
        label: candidate.label?.trim() || buildSemesterLabel(year, semester),
        shellReady: candidate.shellReady !== false,
        createdBy: candidate.createdBy || "",
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
      createdBy: "",
    });
  }

  return sortSemesterRegistry(Array.from(registry.values()));
};

const SettingsGeneral: React.FC<{ onOpenArchive: () => void }> = ({
  onOpenArchive,
}) => {
  const { currentUser, refreshConfig } = useAuth();
  const { showToast } = useAppToast();
  const [config, setConfig] = useState<SettingsConfigState>(DEFAULT_CONFIG);
  const [activeSemester, setActiveSemester] = useState<SemesterSelectionState>({
    year: DEFAULT_YEAR,
    semester: DEFAULT_SEMESTER,
  });
  const [availableSemesters, setAvailableSemesters] = useState<
    SemesterRegistryItem[]
  >([
    {
      year: DEFAULT_YEAR,
      semester: DEFAULT_SEMESTER,
      label: buildSemesterLabel(DEFAULT_YEAR, DEFAULT_SEMESTER),
      shellReady: true,
      createdBy: "",
    },
  ]);
  const [newSemester, setNewSemester] = useState({
    year: DEFAULT_YEAR,
    semester: DEFAULT_SEMESTER,
  });
  const [feedback, setFeedback] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [creating, setCreating] = useState(false);
  const [readiness, setReadiness] = useState<SemesterReadinessResult | null>(
    null,
  );
  const [readinessLoading, setReadinessLoading] = useState(false);
  const [readinessError, setReadinessError] = useState("");

  const loadConfig = async () => {
    try {
      const docRef = doc(db, "site_settings", "config");
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
        setAvailableSemesters(
          buildSemesterRegistry(data.availableSemesters, year, semester),
        );
        setNewSemester({ year, semester });
      } else {
        setActiveSemester({ year: DEFAULT_YEAR, semester: DEFAULT_SEMESTER });
        setAvailableSemesters(
          buildSemesterRegistry([], DEFAULT_YEAR, DEFAULT_SEMESTER),
        );
        setNewSemester({ year: DEFAULT_YEAR, semester: DEFAULT_SEMESTER });
      }
    } catch (error) {
      console.error("Failed to load config:", error);
      showToast({
        tone: "error",
        title: "설정을 불러오지 못했습니다.",
        message: "잠시 후 다시 시도해 주세요.",
      });
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
    setReadinessError("");

    void loadSemesterReadiness(year, semester)
      .then((result) => {
        if (!isMounted) return;
        setReadiness(result);
      })
      .catch((error) => {
        console.error("Failed to load semester readiness:", error);
        if (!isMounted) return;
        setReadinessError("준비 현황을 불러오지 못했습니다.");
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
    return Array.from(years).sort(
      (a, b) => Number.parseInt(b, 10) - Number.parseInt(a, 10),
    );
  }, [availableSemesters, config.year]);

  const semesterOptions = useMemo(() => {
    const filtered = availableSemesters.filter(
      (item) => item.year === config.year,
    );
    if (filtered.length > 0) return sortSemesterRegistry(filtered);
    return [
      {
        year: config.year,
        semester: config.semester,
        label: buildSemesterLabel(config.year, config.semester),
        shellReady: true,
        createdBy: "",
      },
    ];
  }, [availableSemesters, config.year, config.semester]);

  const activeSemesterLabel = buildSemesterLabel(
    activeSemester.year,
    activeSemester.semester,
  );
  const selectedSemesterLabel = buildSemesterLabel(
    config.year,
    config.semester,
  );
  const hasPendingSemesterSwitch =
    activeSemester.year !== config.year ||
    activeSemester.semester !== config.semester;
  const ensurePointPolicyShell = async (year: string, semester: string) => {
    const policyRef = doc(
      db,
      "years",
      year,
      "semesters",
      semester,
      "point_policies",
      "current",
    );
    const policySnap = await getDoc(policyRef);
    if (policySnap.exists()) return;

    await setDoc(policyRef, {
      ...DEFAULT_POINT_POLICY,
      updatedAt: serverTimestamp(),
      updatedBy: currentUser?.email || currentUser?.uid || "",
    });
  };

  const ensureDocShell = async (
    path: string,
    data: Record<string, unknown>,
  ) => {
    const targetRef = doc(db, path);
    const targetSnap = await getDoc(targetRef);
    if (targetSnap.exists()) return;
    await setDoc(targetRef, data);
  };

  const ensureSemesterOperationalSeeds = async (
    year: string,
    semester: string,
  ) => {
    const seededBy = currentUser?.email || currentUser?.uid || "";
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

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>,
  ) => {
    const { name, value, type } = e.target;
    const checked = (e.target as HTMLInputElement).checked;

    if (type === "checkbox") {
      const key = name as keyof SettingsConfigState;
      setConfig(
        (prev) =>
          ({
            ...prev,
            [key]: checked,
          }) as SettingsConfigState,
      );
      return;
    }

    if (name === "year") {
      const nextYear = value;
      const nextSemesterOptions = availableSemesters.filter(
        (item) => item.year === nextYear,
      );
      setConfig((prev) => ({
        ...prev,
        year: nextYear,
        semester: nextSemesterOptions.some(
          (item) => item.semester === prev.semester,
        )
          ? prev.semester
          : nextSemesterOptions[0]?.semester || DEFAULT_SEMESTER,
      }));
      return;
    }

    const key = name as keyof SettingsConfigState;
    setConfig(
      (prev) =>
        ({
          ...prev,
          [key]: value,
        }) as SettingsConfigState,
    );
  };

  const handleNewSemesterChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>,
  ) => {
    const { name, value } = e.target;
    setNewSemester((prev) => ({
      ...prev,
      [name]: value,
    }));
  };

  const handleCreateSemester = async () => {
    const year = String(newSemester.year || "").trim();
    const semester = normalizeSemester(newSemester.semester);

    if (!/^\d{4}$/.test(year)) {
      showToast({
        tone: "warning",
        title: "학년도 입력 형식을 확인해 주세요.",
        message: "학년도는 4자리 숫자로 입력해야 합니다.",
      });
      return;
    }

    if (
      availableSemesters.some(
        (item) => item.year === year && item.semester === semester,
      )
    ) {
      setConfig((prev) => ({ ...prev, year, semester }));
      setFeedback(
        `${buildSemesterLabel(year, semester)}는 이미 준비되어 있습니다. 운영 학기 전환을 누르면 학생과 교사에게 적용됩니다.`,
      );
      return;
    }

    setCreating(true);
    setFeedback("");
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
            createdBy: currentUser?.email || currentUser?.uid || "",
          },
        ],
        config.year,
        config.semester,
      );

      await setDoc(
        doc(db, "site_settings", "config"),
        {
          availableSemesters: nextRegistry,
        },
        { merge: true },
      );

      setAvailableSemesters(nextRegistry);
      setConfig((prev) => ({
        ...prev,
        year,
        semester,
      }));
      setFeedback(
        `${buildSemesterLabel(year, semester)}를 준비했습니다. 운영 학기 전환을 누르면 학생과 교사에게 적용됩니다.`,
      );
    } catch (error) {
      console.error("Failed to create semester shell:", error);
      showToast({
        tone: "error",
        title: "새 학기 생성에 실패했습니다.",
        message: String(error),
      });
    } finally {
      setCreating(false);
    }
  };

  const handleSave = async (section: "semester" | "menus") => {
    setSaving(true);
    try {
      const year = normalizeYear(config.year);
      const semester = normalizeSemester(config.semester);
      const nextRegistry = buildSemesterRegistry(
        availableSemesters,
        year,
        semester,
      );

      if (section === "semester") await ensurePointPolicyShell(year, semester);
      await setDoc(
        doc(db, "site_settings", "config"),
        {
          ...(section === "semester"
            ? { year, semester, availableSemesters: nextRegistry }
            : {
                showQuiz: config.showQuiz,
                showScore: config.showScore,
                showLesson: config.showLesson,
              }),
          updatedAt: serverTimestamp(),
          updatedBy: currentUser?.email || currentUser?.uid || "",
        },
        { merge: true },
      );
      if (section === "semester") {
        setActiveSemester({ year, semester });
        setAvailableSemesters(nextRegistry);
      }
      invalidateSiteSettingDocCache("config");
      await refreshConfig();
      notifySystemConfigUpdated();
      showToast({
        tone: "success",
        title:
          section === "semester"
            ? "운영 학기가 전환되었습니다."
            : "학생 메뉴 설정이 저장되었습니다.",
        message:
          section === "semester"
            ? buildSemesterLabel(year, semester) + " 기준으로 적용했습니다."
            : "학생 화면의 메뉴 표시 설정을 반영했습니다.",
      });
    } catch (error) {
      console.error("Failed to save config:", error);
      showToast({
        tone: "error",
        title: "설정 저장에 실패했습니다.",
        message: String(error),
      });
    } finally {
      setSaving(false);
    }
  };

  if (loading)
    return (
      <InlineLoading message="기본 설정을 불러오는 중입니다." showWarning />
    );

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h3 className="text-xl font-extrabold text-gray-900">기본 환경 설정</h3>
        <p className="mt-2 text-sm text-gray-500">
          운영 학기를 전환하고 학생 메뉴의 표시 여부를 설정합니다.
        </p>
      </div>

      <section
        aria-labelledby="semester-switch-title"
        className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm sm:p-6"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h4
            id="semester-switch-title"
            className="text-base font-extrabold text-gray-900"
          >
            운영 학기 전환
          </h4>
          <span className="text-xs text-gray-500">학생·교사 전체 적용</span>
        </div>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-blue-50 p-4">
          <span className="text-sm font-bold text-blue-900">
            현재 운영 학기
          </span>
          <strong className="text-base text-blue-900">
            {activeSemesterLabel}
          </strong>
        </div>
        <fieldset disabled={saving || creating} className="mt-6">
          <legend className="mb-3 text-sm font-bold text-gray-800">
            전환할 학기
          </legend>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label
                htmlFor="switch-year"
                className="mb-2 block text-xs font-bold text-gray-600"
              >
                학년도
              </label>
              <select
                id="switch-year"
                name="year"
                value={config.year}
                onChange={handleChange}
                className="w-full rounded-lg border border-gray-300 bg-white p-3 text-sm font-bold text-gray-800 focus:ring-2 focus:ring-blue-500"
              >
                {yearOptions.map((year) => (
                  <option key={year} value={year}>
                    {year}학년도
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label
                htmlFor="switch-semester"
                className="mb-2 block text-xs font-bold text-gray-600"
              >
                학기
              </label>
              <select
                id="switch-semester"
                name="semester"
                value={config.semester}
                onChange={handleChange}
                className="w-full rounded-lg border border-gray-300 bg-white p-3 text-sm font-bold text-gray-800 focus:ring-2 focus:ring-blue-500"
              >
                {semesterOptions.map((item) => (
                  <option
                    key={item.year + "-" + item.semester}
                    value={item.semester}
                  >
                    {item.semester}학기
                  </option>
                ))}
              </select>
            </div>
          </div>
        </fieldset>
        <p className="mt-3 text-xs leading-5 text-gray-500">
          학기를 선택한 뒤 ‘운영 학기 전환’을 눌러야 적용됩니다.
        </p>
        <div className="mt-4 border-t border-gray-200 pt-4">
          <div className="text-sm font-bold text-gray-800" aria-live="polite">
            {hasPendingSemesterSwitch
              ? selectedSemesterLabel + "로 전환 예정"
              : "현재 운영 학기와 같습니다."}
          </div>
          {hasPendingSemesterSwitch && (
            <p className="mt-2 text-xs leading-5 text-amber-800">
              {readinessLoading
                ? "선택한 학기의 준비 현황을 확인하고 있습니다."
                : readinessError
                  ? "준비 현황을 불러오지 못했습니다. 아래 확인 사항을 점검하세요."
                  : readiness?.status === "danger"
                    ? "필수 항목이 비어 있어 전환을 권장하지 않습니다. 아래 확인 사항을 먼저 점검하세요."
                    : "아래 전환 전 확인 사항을 점검한 뒤 적용하세요."}
            </p>
          )}
          <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <button
              type="button"
              onClick={onOpenArchive}
              className="min-h-10 text-left text-sm font-bold text-blue-700 underline underline-offset-4"
            >
              이전 학기 자료는 조회 탭에서 보기
            </button>
            <button
              type="button"
              onClick={() => void handleSave("semester")}
              disabled={saving || creating || !hasPendingSemesterSwitch}
              className="rounded-lg bg-blue-600 px-6 py-3 text-sm font-bold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {saving ? "저장 중..." : "운영 학기 전환"}
            </button>
          </div>
        </div>
      </section>

      <section
        aria-labelledby="semester-readiness-title"
        className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm"
      >
        <div className="p-4 sm:p-6">
          <h4
            id="semester-readiness-title"
            className="text-base font-extrabold text-gray-900"
          >
            전환 전 확인 사항
          </h4>
          <p className="mt-2 text-sm text-gray-500">
            항목을 펼쳐 확인할 내용과 필요한 조치를 살펴보세요.
          </p>
        </div>
        <SettingsSemesterReadiness
          readiness={readiness}
          loading={readinessLoading}
          error={readinessError}
          semesterLabel={selectedSemesterLabel}
        />
      </section>

      <details className="rounded-xl border border-gray-200 bg-white shadow-sm">
        <summary className="cursor-pointer p-4 text-base font-extrabold text-gray-900 focus-visible:outline-blue-600 sm:p-6">
          <span className="ml-2">새 학기 준비</span>
          <span className="mt-2 block pl-6 text-sm font-normal text-gray-500">
            전환할 학기가 목록에 없을 때 생성합니다.
          </span>
        </summary>
        <div className="px-4 pb-4 sm:px-6 sm:pb-6">
          <p className="text-xs leading-5 text-gray-500">
            기본 설정만 생성하며 콘텐츠 복제나 데이터 이월은 하지 않습니다. 생성
            후에도 운영 학기는 유지됩니다.
          </p>
          <fieldset
            disabled={creating || saving}
            className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2"
          >
            <div>
              <label
                htmlFor="new-year"
                className="mb-2 block text-xs font-bold text-gray-600"
              >
                새 학년도
              </label>
              <input
                id="new-year"
                type="text"
                name="year"
                value={newSemester.year}
                onChange={handleNewSemesterChange}
                inputMode="numeric"
                placeholder="2027"
                className="w-full rounded-lg border border-gray-300 bg-white p-3 text-sm font-bold text-gray-800 focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label
                htmlFor="new-semester"
                className="mb-2 block text-xs font-bold text-gray-600"
              >
                새 학기
              </label>
              <select
                id="new-semester"
                name="semester"
                value={newSemester.semester}
                onChange={handleNewSemesterChange}
                className="w-full rounded-lg border border-gray-300 bg-white p-3 text-sm font-bold text-gray-800 focus:ring-2 focus:ring-blue-500"
              >
                <option value="1">1학기</option>
                <option value="2">2학기</option>
              </select>
            </div>
          </fieldset>
          <div className="mt-4 text-right">
            <button
              type="button"
              onClick={handleCreateSemester}
              disabled={creating || saving}
              className="rounded-lg border border-gray-300 bg-white px-6 py-3 text-sm font-bold text-gray-800 hover:bg-gray-50 disabled:opacity-60"
            >
              {creating ? "생성 중..." : "학기 생성"}
            </button>
          </div>
          {feedback && (
            <p role="status" className="mt-3 text-sm leading-6 text-blue-900">
              {feedback}
            </p>
          )}
        </div>
      </details>

      <section
        aria-labelledby="student-menu-title"
        className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm sm:p-6"
      >
        <h4
          id="student-menu-title"
          className="text-base font-extrabold text-gray-900"
        >
          학생 메뉴 표시
        </h4>
        <p className="mt-2 text-sm text-gray-500">
          학생에게 표시할 메뉴를 선택합니다.
        </p>
        <fieldset
          disabled={saving}
          className="mt-4 divide-y divide-gray-200 border-y border-gray-200"
        >
          {(
            [
              { key: "showQuiz", label: "평가" },
              { key: "showScore", label: "점수" },
              { key: "showLesson", label: "수업자료" },
            ] as const
          ).map((item) => (
            <label
              key={item.key}
              className="flex cursor-pointer items-center justify-between gap-4 py-4 text-sm font-bold text-gray-700"
            >
              <span>{item.label}</span>
              <input
                type="checkbox"
                name={item.key}
                checked={config[item.key]}
                onChange={handleChange}
                className="h-5 w-5 rounded text-blue-600 focus:ring-blue-500"
              />
            </label>
          ))}
        </fieldset>
        <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-gray-500">
            메뉴 저장은 운영 학기를 바꾸지 않습니다.
          </p>
          <button
            type="button"
            onClick={() => void handleSave("menus")}
            disabled={saving || creating}
            className="rounded-lg border border-gray-300 bg-white px-6 py-3 text-sm font-bold text-gray-800 hover:bg-gray-50 disabled:opacity-60"
          >
            {saving ? "저장 중..." : "메뉴 표시 저장"}
          </button>
        </div>
      </section>
    </div>
  );
};

export default SettingsGeneral;
