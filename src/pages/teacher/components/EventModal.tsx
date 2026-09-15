import React, { useEffect, useRef, useState } from "react";
import "./eventCalendar.css";
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
  CATEGORY_COLOR_PRESETS,
  SCHEDULE_COLOR_NAMES,
  DEFAULT_SCHEDULE_CATEGORIES,
  ScheduleCategory,
  createScheduleCategoryKey,
  getColorForEmoji,
  resolveScheduleCategories,
  useScheduleCategories,
} from "../../../lib/scheduleCategories";
import {
  SCHEDULE_ALL_DAY_PERIOD_VALUE,
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
  const [labelColor, setLabelColor] = useState("");
  const dialogRef = useRef<HTMLDivElement>(null);
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [isAllDay, setIsAllDay] = useState(false);
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

  useEffect(() => {
    if (!isOpen) return;
    const opener = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialogRef.current?.querySelector<HTMLInputElement>("input")?.focus();
    return () => {
      document.body.style.overflow = previousOverflow;
      opener?.focus();
    };
  }, [isOpen]);

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
    if (!gradeOptions.some((item) => item.value === targetGrade)) {
      setTargetGrade(gradeOptions[0]?.value || "1");
    }
    if (!classOptions.some((item) => item.value === targetClass)) {
      setTargetClass(classOptions[0]?.value || "1");
    }
  }, [gradeOptions, classOptions, targetGrade, targetClass]);

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
      const persistedAllDay =
        Boolean((eventData as CalendarEvent & { allDay?: boolean }).allDay) ||
        eventData.startPeriod === SCHEDULE_ALL_DAY_PERIOD_VALUE ||
        eventData.endPeriod === SCHEDULE_ALL_DAY_PERIOD_VALUE ||
        eventData.period === SCHEDULE_ALL_DAY_PERIOD_VALUE;
      const nextStartPeriod = persistedAllDay
        ? DEFAULT_SCHEDULE_PERIOD
        : normalizeSchedulePeriod(eventData.startPeriod ?? eventData.period);
      const nextStart = eventData.start || "";
      const nextEnd =
        eventData.end && (!nextStart || eventData.end >= nextStart)
          ? eventData.end
          : nextStart;
      setTitle(eventData.title || "");
      setLabelColor(eventData.labelColor || "");
      setStart(nextStart);
      setEnd(nextEnd);
      setIsAllDay(persistedAllDay);
      setStartPeriod(nextStartPeriod);
      setEndPeriod(
        persistedAllDay
          ? DEFAULT_SCHEDULE_PERIOD
          : normalizeSchedulePeriod(eventData.endPeriod, nextStartPeriod),
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
    setLabelColor("");
    setStart(nextDate);
    setEnd(nextDate);
    setIsAllDay(false);
    setStartPeriod(DEFAULT_SCHEDULE_PERIOD);
    setEndPeriod(DEFAULT_SCHEDULE_PERIOD);
    setDescription("");
    setEventType(categories[0]?.key || DEFAULT_SCHEDULE_CATEGORIES[0].key);
    setTargetType("common");
    setTargetGrade(gradeOptions[0]?.value || "1");
    setTargetClass(classOptions[0]?.value || "1");
  }, [isOpen, eventData, initialDate]);

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
      const finalEnd = end && end >= start ? end : start;
      const finalStartPeriod = isAllDay
        ? SCHEDULE_ALL_DAY_PERIOD_VALUE
        : normalizeSchedulePeriod(startPeriod);
      const finalEndPeriod = isAllDay
        ? SCHEDULE_ALL_DAY_PERIOD_VALUE
        : normalizeSchedulePeriod(endPeriod, finalStartPeriod);

      const data: Record<string, unknown> = {
        title: title.trim(),
        start,
        end: finalEnd,
        allDay: isAllDay,
        startPeriod: finalStartPeriod,
        endPeriod: finalEndPeriod,
        period: finalStartPeriod,
        description: description.trim(),
        eventType,
        labelColor,
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
    setEnd(nextStart);
  };

  const updateEndDate = (nextEnd: string) => {
    setEnd(!nextEnd || !start || nextEnd >= start ? nextEnd : start);
  };

  const updateStartPeriod = (nextValue: string) => {
    const nextPeriod = normalizeSchedulePeriod(nextValue);
    setStartPeriod(nextPeriod);
    setEndPeriod(nextPeriod);
  };

  const selectedCategory = categoryDrafts.find(
    (item) => item.key === eventType,
  );
  const previewColor = labelColor || selectedCategory?.color;

  return (
    <div
      className="teacher-event-backdrop"
      onClick={() => !loading && onClose()}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="teacher-event-modal-title"
        className="teacher-event-dialog"
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === "Escape" && !loading) onClose();
          if (event.key !== "Tab") return;
          const controls = Array.from(
            dialogRef.current?.querySelectorAll<HTMLElement>(
              "button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled)",
            ) || [],
          ).filter((element) => element.getClientRects().length > 0);
          const first = controls[0];
          const last = controls[controls.length - 1];
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last?.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first?.focus();
          }
        }}
      >
        <header className="teacher-event-dialog__header">
          <h3 id="teacher-event-modal-title">
            {eventData ? "일정 수정" : "일정 등록"}
          </h3>
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            aria-label="팝업 닫기"
          >
            ×
          </button>
        </header>

        <div className="teacher-event-dialog__body">
          <label className="teacher-event-title">
            <span>일정 제목</span>
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="예: 1차 수행평가"
            />
          </label>

          <div className="teacher-event-dates">
            <label>
              <span>시작 일자</span>
              <input
                type="date"
                value={start}
                onChange={(event) => updateStartDate(event.target.value)}
              />
            </label>
            <label>
              <span>시작 교시</span>
              <select
                aria-label="시작 교시"
                value={startPeriod}
                onChange={(event) => updateStartPeriod(event.target.value)}
                disabled={isAllDay}
              >
                {SCHEDULE_PERIOD_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>종료 일자</span>
              <input
                type="date"
                value={end}
                min={start || undefined}
                onChange={(event) => updateEndDate(event.target.value)}
              />
            </label>
            <label>
              <span>종료 교시</span>
              <select
                aria-label="종료 교시"
                value={endPeriod}
                onChange={(event) =>
                  setEndPeriod(normalizeSchedulePeriod(event.target.value))
                }
                disabled={isAllDay}
              >
                {SCHEDULE_PERIOD_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="teacher-event-check">
              <input
                type="checkbox"
                checked={isAllDay}
                onChange={(event) => setIsAllDay(event.target.checked)}
              />{" "}
              하루종일
            </label>
          </div>

          <div className="teacher-event-columns">
            <div className="teacher-event-column">
              <fieldset>
                <legend>대상 선택</legend>
                <div className="teacher-event-targets">
                  <label className="teacher-event-check">
                    <input
                      type="radio"
                      name="eventTargetType"
                      checked={targetType === "common"}
                      onChange={() => setTargetType("common")}
                    />
                    전체 공통
                  </label>
                  <label className="teacher-event-check">
                    <input
                      type="radio"
                      name="eventTargetType"
                      checked={targetType === "class"}
                      onChange={() => setTargetType("class")}
                    />
                    반별 지정
                  </label>
                </div>
                <div className="teacher-event-target-selects">
                  <select
                    aria-label="대상 학년"
                    value={targetGrade}
                    onChange={(event) => setTargetGrade(event.target.value)}
                    disabled={targetType !== "class"}
                  >
                    {gradeOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                  <select
                    aria-label="대상 반"
                    value={targetClass}
                    onChange={(event) => setTargetClass(event.target.value)}
                    disabled={targetType !== "class"}
                  >
                    {classOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
              </fieldset>
              <label>
                <span>
                  메모 <small>(선택)</small>
                </span>
                <textarea
                  value={description}
                  onChange={(event) =>
                    setDescription(
                      event.target.value.slice(0, DESCRIPTION_LIMIT),
                    )
                  }
                  maxLength={DESCRIPTION_LIMIT}
                  placeholder="메모를 입력하세요."
                />
                <small className="teacher-event-memo-count">
                  {description.length} / {DESCRIPTION_LIMIT}
                </small>
              </label>
            </div>

            <div className="teacher-event-column">
              <div className="teacher-event-category-heading">
                <label htmlFor="teacher-event-category">일정 분류</label>
                <button
                  type="button"
                  className="teacher-event-link"
                  aria-expanded={showCategoryManager}
                  onClick={() => setShowCategoryManager(!showCategoryManager)}
                >
                  {showCategoryManager ? "라벨 선택으로" : "분류 관리"}
                </button>
              </div>
              <select
                id="teacher-event-category"
                value={eventType}
                onChange={(event) => setEventType(event.target.value)}
              >
                {categoryDrafts.map((category) => (
                  <option key={category.key} value={category.key}>
                    {category.label}
                  </option>
                ))}
              </select>

              {showCategoryManager ? (
                <div className="teacher-event-category-editor">
                  {selectedCategory && (
                    <div className="teacher-event-category-row">
                      <label>
                        <span>분류 이름</span>
                        <input
                          value={selectedCategory.label}
                          onChange={(event) =>
                            handleCategoryDraftChange(eventType, {
                              label: event.target.value,
                            })
                          }
                        />
                      </label>
                      <label>
                        <span>색상</span>
                        <select
                          aria-label="분류 색상"
                          value={selectedCategory.emoji}
                          onChange={(event) =>
                            handleCategoryDraftChange(eventType, {
                              emoji: event.target.value,
                              color: getColorForEmoji(
                                event.target.value,
                                selectedCategory.color,
                              ),
                            })
                          }
                        >
                          {COLOR_EMOJI_OPTIONS.map((emoji, index) => (
                            <option key={emoji} value={emoji}>
                              {SCHEDULE_COLOR_NAMES[index]}
                            </option>
                          ))}
                        </select>
                      </label>
                      <button
                        type="button"
                        className="teacher-event-danger"
                        onClick={() => handleRemoveCategory(selectedCategory)}
                        disabled={categoryDrafts.length <= 1}
                      >
                        삭제
                      </button>
                    </div>
                  )}
                  <div className="teacher-event-category-row">
                    <label>
                      <span>새 분류</span>
                      <input
                        value={newCategoryLabel}
                        onChange={(event) =>
                          setNewCategoryLabel(event.target.value)
                        }
                      />
                    </label>
                    <label>
                      <span>색상</span>
                      <select
                        aria-label="새 분류 색상"
                        value={newCategoryEmoji}
                        onChange={(event) =>
                          setNewCategoryEmoji(event.target.value)
                        }
                      >
                        {COLOR_EMOJI_OPTIONS.map((emoji, index) => (
                          <option key={emoji} value={emoji}>
                            {SCHEDULE_COLOR_NAMES[index]}
                          </option>
                        ))}
                      </select>
                    </label>
                    <button type="button" onClick={handleAddCategory}>
                      추가
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={handleSaveCategories}
                    disabled={savingCategories}
                  >
                    {savingCategories ? "저장 중..." : "분류 저장"}
                  </button>
                </div>
              ) : (
                <fieldset className="teacher-event-colors">
                  <legend>라벨 색상</legend>
                  <div className="teacher-event-palette">
                    <button
                      type="button"
                      className="teacher-event-color-default"
                      aria-pressed={!labelColor}
                      onClick={() => setLabelColor("")}
                    >
                      분류 색상
                    </button>
                    {CATEGORY_COLOR_PRESETS.map((preset, index) => (
                      <button
                        type="button"
                        key={preset.color}
                        className="teacher-event-swatch"
                        aria-label={SCHEDULE_COLOR_NAMES[index]}
                        title={SCHEDULE_COLOR_NAMES[index]}
                        aria-pressed={labelColor === preset.color}
                        onClick={() => setLabelColor(preset.color)}
                        style={
                          {
                            "--event-color": preset.color,
                          } as React.CSSProperties
                        }
                      >
                        {labelColor === preset.color ? "✓" : ""}
                      </button>
                    ))}
                  </div>
                  <div
                    className="teacher-event-preview"
                    title={title || "일정 제목"}
                    style={
                      { "--event-color": previewColor } as React.CSSProperties
                    }
                  >
                    <span>{title || "일정 제목"}</span>
                  </div>
                </fieldset>
              )}
            </div>
          </div>
        </div>

        <footer className="teacher-event-dialog__footer">
          {eventData && (
            <button
              type="button"
              className="teacher-event-danger"
              onClick={handleDelete}
              disabled={loading}
            >
              일정 삭제
            </button>
          )}
          <div className="teacher-event-dialog__actions">
            <button type="button" onClick={onClose} disabled={loading}>
              취소
            </button>
            <button
              type="button"
              className="teacher-event-primary"
              onClick={handleSave}
              disabled={loading || savingCategories}
            >
              {loading ? "저장 중..." : "저장"}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
};

export default EventModal;
