import React, { useEffect, useMemo, useState } from "react";
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
} from "firebase/firestore";
import { useAppToast } from "../../../components/common/AppToastProvider";
import { useAuth } from "../../../contexts/AuthContext";
import { db } from "../../../lib/firebase";
import {
  COLOR_EMOJI_OPTIONS,
  DEFAULT_SCHEDULE_CATEGORIES,
  ScheduleCategory,
  createScheduleCategoryKey,
  getColorForEmoji,
  resolveScheduleCategories,
  useScheduleCategories,
} from "../../../lib/scheduleCategories";
import {
  DEFAULT_SCHEDULE_PERIOD,
  SCHEDULE_PERIOD_OPTIONS,
  normalizeSchedulePeriod,
} from "../../../lib/schedulePeriods";
import { CalendarEvent } from "../../../types";

interface EventModalProps {
  isOpen: boolean;
  onClose: () => void;
  eventData?: CalendarEvent;
  onSave: () => void;
  initialDate?: string;
}

type SchoolOption = { value: string; label: string };
type EditableTargetType = "common" | "class";

const DESCRIPTION_LIMIT = 300;

const EventModal: React.FC<EventModalProps> = ({
  isOpen,
  onClose,
  eventData,
  onSave,
  initialDate,
}) => {
  const { config } = useAuth();
  const { categories } = useScheduleCategories();
  const { showToast } = useAppToast();

  const [title, setTitle] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [startPeriod, setStartPeriod] = useState(DEFAULT_SCHEDULE_PERIOD);
  const [endPeriod, setEndPeriod] = useState(DEFAULT_SCHEDULE_PERIOD);
  const [description, setDescription] = useState("");
  const [eventType, setEventType] = useState(
    DEFAULT_SCHEDULE_CATEGORIES[0].key,
  );
  const [targetType, setTargetType] = useState<EditableTargetType>("common");
  const [targetGrade, setTargetGrade] = useState("1");
  const [targetClass, setTargetClass] = useState("1");
  const [gradeOptions, setGradeOptions] = useState<SchoolOption[]>([
    { value: "1", label: "1학년" },
    { value: "2", label: "2학년" },
    { value: "3", label: "3학년" },
  ]);
  const [classOptions, setClassOptions] = useState<SchoolOption[]>(
    Array.from({ length: 12 }, (_, index) => ({
      value: String(index + 1),
      label: `${index + 1}반`,
    })),
  );
  const [loading, setLoading] = useState(false);
  const [savingCategories, setSavingCategories] = useState(false);
  const [categoryDrafts, setCategoryDrafts] = useState<ScheduleCategory[]>(
    DEFAULT_SCHEDULE_CATEGORIES,
  );
  const [newCategoryLabel, setNewCategoryLabel] = useState("");
  const [newCategoryEmoji, setNewCategoryEmoji] = useState(
    DEFAULT_SCHEDULE_CATEGORIES[3]?.emoji || COLOR_EMOJI_OPTIONS[0],
  );
  const [showCategoryManager, setShowCategoryManager] = useState(false);

  const selectedCategory = useMemo(
    () =>
      categoryDrafts.find((category) => category.key === eventType) ||
      categoryDrafts[0] ||
      DEFAULT_SCHEDULE_CATEGORIES[0],
    [categoryDrafts, eventType],
  );

  useEffect(() => {
    const loadSchoolConfig = async () => {
      try {
        const snap = await getDoc(doc(db, "site_settings", "school_config"));
        if (!snap.exists()) return;
        const data = snap.data() as {
          grades?: Array<{ value?: string; label?: string }>;
          classes?: Array<{ value?: string; label?: string }>;
        };
        const nextGrades = (data.grades || [])
          .map((grade) => ({
            value: String(grade?.value ?? "").trim(),
            label: String(grade?.label ?? "").trim(),
          }))
          .filter((grade) => grade.value && grade.label);
        const nextClasses = (data.classes || [])
          .map((classItem) => ({
            value: String(classItem?.value ?? "").trim(),
            label: String(classItem?.label ?? "").trim(),
          }))
          .filter((classItem) => classItem.value && classItem.label);
        if (nextGrades.length > 0) setGradeOptions(nextGrades);
        if (nextClasses.length > 0) setClassOptions(nextClasses);
      } catch (error) {
        console.error("Failed to load school config:", error);
      }
    };
    void loadSchoolConfig();
  }, []);

  useEffect(() => {
    setCategoryDrafts(categories);
  }, [categories]);

  useEffect(() => {
    if (!categoryDrafts.some((item) => item.key === eventType)) {
      setEventType(
        categoryDrafts[0]?.key || DEFAULT_SCHEDULE_CATEGORIES[0].key,
      );
    }
  }, [categoryDrafts, eventType]);

  useEffect(() => {
    if (!isOpen) return;

    setShowCategoryManager(false);
    if (eventData) {
      const nextStartPeriod = normalizeSchedulePeriod(
        eventData.startPeriod ?? eventData.period,
      );
      setTitle(eventData.title || "");
      setStart(eventData.start || "");
      setEnd(eventData.end || eventData.start || "");
      setStartPeriod(nextStartPeriod);
      setEndPeriod(
        normalizeSchedulePeriod(eventData.endPeriod, nextStartPeriod),
      );
      setDescription((eventData.description || "").slice(0, DESCRIPTION_LIMIT));
      setEventType(
        eventData.eventType ||
          categories[0]?.key ||
          DEFAULT_SCHEDULE_CATEGORIES[0].key,
      );
      setTargetType(eventData.targetType === "class" ? "class" : "common");
      const [gradeValue, classValue] = (eventData.targetClass || "1-1").split(
        "-",
      );
      setTargetGrade(gradeValue || "1");
      setTargetClass(classValue || "1");
      return;
    }

    const nextDate = initialDate || new Date().toISOString().split("T")[0];
    setTitle("");
    setStart(nextDate);
    setEnd(nextDate);
    setStartPeriod(DEFAULT_SCHEDULE_PERIOD);
    setEndPeriod(DEFAULT_SCHEDULE_PERIOD);
    setDescription("");
    setEventType(categories[0]?.key || DEFAULT_SCHEDULE_CATEGORIES[0].key);
    setTargetType("common");
    setTargetGrade(gradeOptions[0]?.value || "1");
    setTargetClass(classOptions[0]?.value || "1");
  }, [isOpen, eventData, initialDate, gradeOptions, classOptions, categories]);

  if (!isOpen) return null;

  const handleCategoryDraftChange = (
    key: string,
    patch: Partial<ScheduleCategory>,
  ) => {
    setCategoryDrafts((prev) =>
      prev.map((item) => (item.key === key ? { ...item, ...patch } : item)),
    );
  };

  const handleRemoveCategory = (category: ScheduleCategory) => {
    if (categoryDrafts.length <= 1) {
      showToast({
        tone: "warning",
        title: "분류는 하나 이상 필요합니다.",
      });
      return;
    }

    const nextDrafts = categoryDrafts.filter(
      (item) => item.key !== category.key,
    );
    setCategoryDrafts(nextDrafts);
    if (eventType === category.key) {
      setEventType(nextDrafts[0]?.key || DEFAULT_SCHEDULE_CATEGORIES[0].key);
    }
  };

  const handleAddCategory = () => {
    const label = newCategoryLabel.trim();
    if (!label) {
      showToast({
        tone: "warning",
        title: "분류 이름을 입력해 주세요.",
      });
      return;
    }

    const nextKey = createScheduleCategoryKey(label);
    const nextCategory: ScheduleCategory = {
      key: nextKey,
      label,
      color: getColorForEmoji(newCategoryEmoji, "#0ea5e9"),
      emoji: newCategoryEmoji,
      order: categoryDrafts.length,
    };

    setCategoryDrafts((prev) => [...prev, nextCategory]);
    setEventType(nextKey);
    setNewCategoryLabel("");
    setNewCategoryEmoji(
      DEFAULT_SCHEDULE_CATEGORIES[3]?.emoji || COLOR_EMOJI_OPTIONS[0],
    );
  };

  const persistCategoryDrafts = async () => {
    const visibleItems = categoryDrafts.map((item, index) => ({
      key: item.key,
      label: item.label.trim(),
      color: item.color,
      emoji: item.emoji,
      order: index,
    }));
    const removedDefaultItems = DEFAULT_SCHEDULE_CATEGORIES.filter(
      (defaultCategory) =>
        !categoryDrafts.some((item) => item.key === defaultCategory.key),
    ).map((item) => ({
      key: item.key,
      label: item.label,
      color: item.color,
      emoji: item.emoji,
      order: item.order,
      hidden: true,
    }));
    const items = [...visibleItems, ...removedDefaultItems];

    const resolvedVisibleItems = resolveScheduleCategories(visibleItems).filter(
      (item) =>
        visibleItems.some((visibleItem) => visibleItem.key === item.key),
    );

    if (visibleItems.some((item) => !item.label)) {
      showToast({
        tone: "warning",
        title: "비어 있는 분류 이름을 확인해 주세요.",
      });
      return false;
    }

    setCategoryDrafts(resolvedVisibleItems);

    await setDoc(
      doc(db, "site_settings", "schedule_categories"),
      {
        items,
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    );
    return true;
  };

  const handleSaveCategories = async () => {
    setSavingCategories(true);
    try {
      const saved = await persistCategoryDrafts();
      if (!saved) return;
      showToast({
        tone: "success",
        title: "일정 분류가 저장되었습니다.",
      });
    } catch (error) {
      console.error("Error saving schedule categories:", error);
      showToast({
        tone: "error",
        title: "일정 분류 저장에 실패했습니다.",
        message: "잠시 후 다시 시도해 주세요.",
      });
    } finally {
      setSavingCategories(false);
    }
  };

  const handleSave = async () => {
    if (!config) return;
    if (!title.trim() || !start) {
      showToast({
        tone: "warning",
        title: "제목과 시작 일자를 확인해 주세요.",
      });
      return;
    }
    setLoading(true);

    try {
      if (!categories.some((item) => item.key === eventType)) {
        const saved = await persistCategoryDrafts();
        if (!saved) return;
      }
      const path = `years/${config.year}/semesters/${config.semester}/calendar`;
      const docRef = eventData
        ? doc(db, path, eventData.id)
        : doc(collection(db, path));
      const finalEnd = end || start;
      const finalStartPeriod = normalizeSchedulePeriod(startPeriod);

      const data: Record<string, unknown> = {
        title: title.trim(),
        start,
        end: finalEnd,
        startPeriod: finalStartPeriod,
        endPeriod: normalizeSchedulePeriod(endPeriod, finalStartPeriod),
        description: description.trim(),
        eventType,
        targetType,
        targetClass:
          targetType === "class" ? `${targetGrade}-${targetClass}` : null,
        updatedAt: serverTimestamp(),
      };

      if (!eventData) data.createdAt = serverTimestamp();

      await setDoc(docRef, data, { merge: true });
      onSave();
      showToast({
        tone: "success",
        title: eventData ? "일정을 수정했습니다." : "일정을 저장했습니다.",
        message: "학사 일정에 최신 내용이 반영되었습니다.",
      });
      onClose();
    } catch (error) {
      console.error("Error saving event:", error);
      showToast({
        tone: "error",
        title: "일정 저장에 실패했습니다.",
        message: "잠시 후 다시 시도해 주세요.",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!eventData || !config || !confirm("이 일정을 삭제하시겠습니까?"))
      return;
    setLoading(true);
    try {
      const path = `years/${config.year}/semesters/${config.semester}/calendar`;
      await deleteDoc(doc(db, path, eventData.id));
      onSave();
      showToast({
        tone: "success",
        title: "일정을 삭제했습니다.",
      });
      onClose();
    } catch (error) {
      console.error("Error deleting event:", error);
      showToast({
        tone: "error",
        title: "일정 삭제에 실패했습니다.",
        message: "잠시 후 다시 시도해 주세요.",
      });
    } finally {
      setLoading(false);
    }
  };

  const updateStartDate = (nextStart: string) => {
    setStart(nextStart);
    if (!end || end < nextStart) setEnd(nextStart);
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-slate-950/45 p-4 backdrop-blur-[1px] md:items-center"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="teacher-event-modal-title"
        className="my-auto flex max-h-[calc(100vh-2rem)] w-full max-w-5xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 px-5 pt-5 sm:px-8 sm:pt-7">
          <div className="flex items-center gap-3">
            <span className="inline-flex h-11 w-11 items-center justify-center rounded-lg border border-blue-100 bg-blue-50 text-blue-600">
              <i className="fas fa-edit text-xl"></i>
            </span>
            <h3
              id="teacher-event-modal-title"
              className="text-2xl font-extrabold tracking-tight text-gray-900"
            >
              {eventData ? "일정 수정" : "일정 등록"}
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-10 w-10 items-center justify-center rounded-full text-gray-400 transition hover:bg-gray-50 hover:text-gray-700"
            aria-label="팝업 닫기"
          >
            <i className="fas fa-times text-lg"></i>
          </button>
        </div>

        <div className="custom-scroll min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-8">
          <div className="space-y-5">
            <label className="block">
              <span className="mb-2 block text-sm font-extrabold text-gray-800">
                일정 제목
              </span>
              <input
                type="text"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                className="h-12 w-full rounded-lg border border-slate-300 px-4 text-base font-semibold text-gray-900 outline-none transition placeholder:text-gray-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                placeholder="예: 1차 수행평가"
                autoFocus
              />
            </label>

            <div className="grid gap-5 lg:grid-cols-2">
              <div>
                <span className="mb-2 block text-sm font-extrabold text-gray-800">
                  시작 일자
                </span>
                <div className="grid grid-cols-[minmax(0,1fr)_148px] gap-2">
                  <input
                    type="date"
                    value={start}
                    onChange={(event) => updateStartDate(event.target.value)}
                    className="h-12 min-w-0 rounded-lg border border-slate-300 px-4 text-base font-semibold text-gray-900 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                  />
                  <select
                    value={startPeriod}
                    onChange={(event) =>
                      setStartPeriod(
                        normalizeSchedulePeriod(event.target.value),
                      )
                    }
                    className="h-12 rounded-lg border border-slate-300 bg-white px-3 text-base font-bold text-gray-900 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                    aria-label="시작 교시"
                  >
                    {SCHEDULE_PERIOD_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <span className="mb-2 block text-sm font-extrabold text-gray-800">
                  종료 일자
                </span>
                <div className="grid grid-cols-[minmax(0,1fr)_148px] gap-2">
                  <input
                    type="date"
                    value={end}
                    min={start || undefined}
                    onChange={(event) => setEnd(event.target.value)}
                    className="h-12 min-w-0 rounded-lg border border-slate-300 px-4 text-base font-semibold text-gray-900 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                  />
                  <select
                    value={endPeriod}
                    onChange={(event) =>
                      setEndPeriod(normalizeSchedulePeriod(event.target.value))
                    }
                    className="h-12 rounded-lg border border-slate-300 bg-white px-3 text-base font-bold text-gray-900 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                    aria-label="종료 교시"
                  >
                    {SCHEDULE_PERIOD_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            <div className="border-t border-slate-200 pt-5">
              <div className="grid gap-7 lg:grid-cols-[minmax(0,1fr)_minmax(320px,0.78fr)]">
                <div className="space-y-5">
                  <label className="block">
                    <span className="mb-2 block text-sm font-extrabold text-gray-800">
                      일정 분류
                    </span>
                    <div className="relative">
                      <span
                        className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 rounded-full"
                        style={{ backgroundColor: selectedCategory.color }}
                      ></span>
                      <select
                        value={eventType}
                        onChange={(event) => setEventType(event.target.value)}
                        className="h-12 w-full rounded-lg border border-slate-300 bg-white pl-12 pr-4 text-base font-bold text-gray-900 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                      >
                        {categoryDrafts.map((category) => (
                          <option key={category.key} value={category.key}>
                            {category.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  </label>

                  <div>
                    <span className="mb-3 block text-sm font-extrabold text-gray-800">
                      대상 선택
                    </span>
                    <div className="flex flex-wrap gap-8">
                      <label className="inline-flex cursor-pointer items-center gap-2 text-base font-bold text-gray-800">
                        <input
                          type="radio"
                          name="eventTargetType"
                          value="common"
                          checked={targetType === "common"}
                          onChange={() => setTargetType("common")}
                          className="h-5 w-5 text-blue-600"
                        />
                        전체 공통
                      </label>
                      <label className="inline-flex cursor-pointer items-center gap-2 text-base font-bold text-gray-800">
                        <input
                          type="radio"
                          name="eventTargetType"
                          value="class"
                          checked={targetType === "class"}
                          onChange={() => setTargetType("class")}
                          className="h-5 w-5 text-blue-600"
                        />
                        반별 지정
                      </label>
                    </div>

                    <div className="mt-3 grid grid-cols-2 gap-2">
                      <select
                        value={targetGrade}
                        onChange={(event) => setTargetGrade(event.target.value)}
                        disabled={targetType !== "class"}
                        className="h-11 rounded-lg border border-slate-300 bg-white px-3 text-center font-bold text-gray-800 outline-none transition disabled:bg-slate-50 disabled:text-gray-400"
                      >
                        {gradeOptions.map((gradeOpt) => (
                          <option key={gradeOpt.value} value={gradeOpt.value}>
                            {gradeOpt.label}
                          </option>
                        ))}
                      </select>
                      <select
                        value={targetClass}
                        onChange={(event) => setTargetClass(event.target.value)}
                        disabled={targetType !== "class"}
                        className="h-11 rounded-lg border border-slate-300 bg-white px-3 text-center font-bold text-gray-800 outline-none transition disabled:bg-slate-50 disabled:text-gray-400"
                      >
                        {classOptions.map((classOpt) => (
                          <option key={classOpt.value} value={classOpt.value}>
                            {classOpt.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <label className="block">
                    <span className="mb-2 block text-sm font-extrabold text-gray-800">
                      메모 <span className="text-gray-400">(선택)</span>
                    </span>
                    <textarea
                      value={description}
                      onChange={(event) =>
                        setDescription(
                          event.target.value.slice(0, DESCRIPTION_LIMIT),
                        )
                      }
                      rows={4}
                      maxLength={DESCRIPTION_LIMIT}
                      className="w-full resize-none rounded-lg border border-slate-300 px-4 py-3 text-sm font-medium text-gray-800 outline-none transition placeholder:text-gray-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                      placeholder="메모를 입력하세요."
                    ></textarea>
                    <span className="mt-1 block text-right text-sm font-semibold text-gray-400">
                      {description.length} / {DESCRIPTION_LIMIT}
                    </span>
                  </label>
                </div>

                <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
                  <div className="mb-3">
                    <h4 className="text-base font-extrabold text-gray-900">
                      분류 관리
                    </h4>
                    <p className="mt-1 text-sm font-medium text-gray-500">
                      주요 분류만 표시됩니다. 필요할 때 바로 수정할 수 있습니다.
                    </p>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    {categoryDrafts.map((category) => (
                      <button
                        key={category.key}
                        type="button"
                        onClick={() => setEventType(category.key)}
                        className={`flex min-w-0 items-center gap-2 rounded-md border px-3 py-2 text-left text-sm font-bold transition ${
                          eventType === category.key
                            ? "border-blue-300 bg-blue-50 text-blue-800"
                            : "border-slate-200 bg-white text-gray-700 hover:bg-slate-50"
                        }`}
                      >
                        <span
                          className="h-3.5 w-3.5 shrink-0 rounded-full"
                          style={{ backgroundColor: category.color }}
                        ></span>
                        <span className="truncate">{category.label}</span>
                      </button>
                    ))}
                  </div>

                  {showCategoryManager && (
                    <div className="mt-4 space-y-2 border-t border-slate-100 pt-4">
                      <div className="max-h-44 space-y-2 overflow-y-auto pr-1">
                        {categoryDrafts.map((category) => (
                          <div
                            key={category.key}
                            className="grid grid-cols-[minmax(0,1fr)_78px_34px] gap-2"
                          >
                            <input
                              type="text"
                              value={category.label}
                              onChange={(event) =>
                                handleCategoryDraftChange(category.key, {
                                  label: event.target.value,
                                })
                              }
                              className="h-10 min-w-0 rounded-md border border-slate-300 px-3 text-sm font-semibold outline-none focus:border-blue-500"
                            />
                            <select
                              value={category.emoji}
                              onChange={(event) =>
                                handleCategoryDraftChange(category.key, {
                                  emoji: event.target.value,
                                  color: getColorForEmoji(
                                    event.target.value,
                                    category.color,
                                  ),
                                })
                              }
                              className="h-10 rounded-md border border-slate-300 px-2 text-sm outline-none focus:border-blue-500"
                            >
                              {COLOR_EMOJI_OPTIONS.map((emoji) => (
                                <option key={emoji} value={emoji}>
                                  {emoji}
                                </option>
                              ))}
                            </select>
                            <button
                              type="button"
                              onClick={() => handleRemoveCategory(category)}
                              className="inline-flex h-10 items-center justify-center rounded-md border border-red-100 bg-red-50 text-sm font-black text-red-500 transition hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-40"
                              disabled={categoryDrafts.length <= 1}
                              aria-label={`${category.label} 분류 삭제`}
                              title="분류 삭제"
                            >
                              <i className="fas fa-minus"></i>
                            </button>
                          </div>
                        ))}
                      </div>

                      <div className="grid grid-cols-[minmax(0,1fr)_78px_54px] gap-2">
                        <input
                          type="text"
                          value={newCategoryLabel}
                          onChange={(event) =>
                            setNewCategoryLabel(event.target.value)
                          }
                          placeholder="새 분류"
                          className="h-10 min-w-0 rounded-md border border-slate-300 px-3 text-sm font-semibold outline-none focus:border-blue-500"
                        />
                        <select
                          value={newCategoryEmoji}
                          onChange={(event) =>
                            setNewCategoryEmoji(event.target.value)
                          }
                          className="h-10 rounded-md border border-slate-300 px-2 text-sm outline-none focus:border-blue-500"
                        >
                          {COLOR_EMOJI_OPTIONS.map((emoji) => (
                            <option key={emoji} value={emoji}>
                              {emoji}
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          onClick={handleAddCategory}
                          className="h-10 rounded-md border border-blue-200 bg-blue-50 text-xs font-extrabold text-blue-700 transition hover:bg-blue-100"
                        >
                          추가
                        </button>
                      </div>
                    </div>
                  )}

                  <button
                    type="button"
                    onClick={() => {
                      if (!showCategoryManager) {
                        setShowCategoryManager(true);
                        return;
                      }
                      void handleSaveCategories();
                    }}
                    disabled={savingCategories}
                    className="mt-4 inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg border border-blue-100 bg-blue-50 text-sm font-extrabold text-blue-700 transition hover:bg-blue-100 disabled:opacity-60"
                  >
                    <i className="fas fa-cog"></i>
                    {showCategoryManager
                      ? savingCategories
                        ? "저장 중..."
                        : "분류 저장하기"
                      : "분류 관리하기"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="flex flex-col-reverse gap-3 border-t border-slate-200 px-5 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-8">
          <div>
            {eventData && (
              <button
                type="button"
                onClick={handleDelete}
                disabled={loading}
                className="h-12 rounded-lg border border-red-100 bg-red-50 px-5 text-sm font-extrabold text-red-600 transition hover:bg-red-100 disabled:opacity-60"
              >
                삭제
              </button>
            )}
          </div>

          <div className="flex justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              className="h-12 min-w-[120px] rounded-lg border border-slate-300 bg-white px-6 text-base font-extrabold text-gray-700 transition hover:bg-slate-50"
            >
              취소
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={loading}
              className="h-12 min-w-[132px] rounded-lg bg-blue-600 px-7 text-base font-extrabold text-white shadow-lg shadow-blue-600/20 transition hover:bg-blue-700 disabled:opacity-60"
            >
              {loading ? "저장 중..." : "저장"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default EventModal;
