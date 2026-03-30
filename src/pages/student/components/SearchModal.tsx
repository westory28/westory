import React, { useEffect, useState } from "react";
import { collection, getDocs } from "firebase/firestore";
import { db } from "../../../lib/firebase";
import { getScheduleCategoryMeta } from "../../../lib/scheduleCategories";
import type { ScheduleCategory } from "../../../lib/scheduleCategories";
import { useAuth } from "../../../contexts/AuthContext";
import { CalendarEvent } from "../../../types";

const LABELS = {
  close: "\uAC80\uC0C9 \uB2EB\uAE30",
  empty:
    "\uAC80\uC0C9\uC5B4\uB97C \uC785\uB825\uD558\uACE0 \uC5D4\uD130\uB97C \uB204\uB974\uAC70\uB098 \uAC80\uC0C9 \uBC84\uD2BC\uC744 \uB20C\uB7EC \uC8FC\uC138\uC694.",
  holiday: "\uACF5\uD734\uC77C",
  noResultPrefix: '"',
  noResultSuffix:
    '"\uC640 \uC77C\uCE58\uD558\uB294 \uC77C\uC815\uC774 \uC5C6\uC2B5\uB2C8\uB2E4.',
  placeholder: "\uC77C\uC815 \uAC80\uC0C9\uC5B4 \uC785\uB825",
  search: "\uAC80\uC0C9",
  searchLoading: "\uAC80\uC0C9 \uC911...",
  title: "\uC77C\uC815 \uAC80\uC0C9",
} as const;

interface SearchModalProps {
  categories: ScheduleCategory[];
  isOpen: boolean;
  onClose: () => void;
  onSelectEvent: (dateStr: string) => void;
}

const SearchModal: React.FC<SearchModalProps> = ({
  categories,
  isOpen,
  onClose,
  onSelectEvent,
}) => {
  const { config, userData } = useAuth();
  const [q, setQ] = useState("");
  const [results, setResults] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);

  useEffect(() => {
    if (!isOpen) return undefined;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleSearch = async () => {
    if (!q.trim() || !config || !userData) return;
    setLoading(true);
    setSearched(true);
    setResults([]);

    try {
      const userClassStr =
        userData.grade && userData.class
          ? `${userData.grade}-${userData.class}`
          : null;
      const path = `years/${config.year}/semesters/${config.semester}/calendar`;
      const snapshot = await getDocs(collection(db, path));
      const matched: CalendarEvent[] = [];
      const qLower = q.toLowerCase();

      snapshot.forEach((item) => {
        const data = item.data() as Omit<CalendarEvent, "id">;
        const isCommon = data.targetType === "common";
        const isHoliday = data.eventType === "holiday";
        const isMyClass =
          data.targetType === "class" && data.targetClass === userClassStr;

        if (!isCommon && !isHoliday && !isMyClass) return;

        const titleMatch = data.title?.toLowerCase().includes(qLower);
        const descMatch = data.description?.toLowerCase().includes(qLower);

        if (titleMatch || descMatch) {
          matched.push({ id: item.id, ...data });
        }
      });

      setResults(matched);
    } catch (error) {
      console.error("Search error", error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[100] bg-black/50 p-4 sm:pt-20"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="student-calendar-search-title"
        className="mx-auto flex max-h-[calc(100vh-2rem)] w-full max-w-xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 border-b border-gray-100 px-5 py-4 sm:px-6">
          <h3
            id="student-calendar-search-title"
            className="text-lg font-extrabold text-gray-900 sm:text-xl"
          >
            <i className="fas fa-search mr-2 text-blue-500"></i>
            {LABELS.title}
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-10 w-10 items-center justify-center rounded-full text-gray-400 transition hover:bg-gray-50 hover:text-gray-600"
            aria-label={LABELS.close}
          >
            <i className="fas fa-times"></i>
          </button>
        </div>

        <div className="border-b border-gray-100 px-5 py-4 sm:px-6">
          <div className="relative">
            <input
              type="text"
              value={q}
              onChange={(event) => setQ(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void handleSearch();
              }}
              className="w-full rounded-2xl border-2 border-blue-100 py-3 pl-11 pr-24 text-base font-bold outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-200 sm:text-lg"
              placeholder={LABELS.placeholder}
              autoFocus
            />
            <i className="fas fa-search absolute left-4 top-1/2 -translate-y-1/2 text-gray-400"></i>
            <button
              type="button"
              onClick={() => void handleSearch()}
              className="absolute right-2 top-2 rounded-xl bg-blue-600 px-4 py-2 text-sm font-bold text-white transition hover:bg-blue-700"
            >
              {LABELS.search}
            </button>
          </div>
        </div>

        <div className="custom-scroll min-h-0 flex-1 space-y-2 overflow-y-auto px-5 py-4 sm:px-6">
          {loading && (
            <div className="py-10 text-center text-gray-400">
              <i className="fas fa-spinner mr-2 fa-spin"></i>
              {LABELS.searchLoading}
            </div>
          )}

          {!loading && !searched && (
            <div className="py-10 text-center text-gray-400">
              {LABELS.empty}
            </div>
          )}

          {!loading && searched && results.length === 0 && (
            <div className="py-10 text-center text-gray-400">
              <i className="far fa-folder-open mb-2 text-2xl"></i>
              <br />
              {LABELS.noResultPrefix}
              {q}
              {LABELS.noResultSuffix}
            </div>
          )}

          {!loading &&
            results.map((result) => {
              const meta = getScheduleCategoryMeta(
                result.eventType,
                categories,
              );
              const bgColor =
                result.eventType === "holiday" ? "#ef4444" : meta.color;
              const typeLabel =
                result.eventType === "holiday"
                  ? LABELS.holiday
                  : `${meta.emoji} ${meta.label}`;

              return (
                <button
                  key={result.id}
                  type="button"
                  onClick={() => {
                    onSelectEvent(result.start);
                    onClose();
                  }}
                  className="w-full rounded-xl border border-gray-100 p-3 text-left transition hover:bg-blue-50"
                >
                  <div className="mb-1 flex items-center gap-2">
                    <span
                      className="rounded px-1.5 py-0.5 text-[10px] font-bold text-white"
                      style={{ backgroundColor: bgColor }}
                    >
                      {typeLabel}
                    </span>
                    <span className="text-sm font-bold text-gray-800">
                      {result.title}
                    </span>
                  </div>
                  <div className="text-xs text-gray-500">
                    {result.start}
                    {result.end && result.start !== result.end
                      ? ` ~ ${result.end}`
                      : ""}
                  </div>
                </button>
              );
            })}
        </div>
      </div>
    </div>
  );
};

export default SearchModal;
