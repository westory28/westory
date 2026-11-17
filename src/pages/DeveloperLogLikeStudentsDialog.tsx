import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { User } from "firebase/auth";
import { InlineLoading } from "../components/common/LoadingState";
import { acquirePageScrollLock } from "../lib/pageScrollLock";
import {
  getDeveloperLogLikeStudents,
  type DeveloperLogLikeStudent,
} from "../lib/developerLogLikeStudents";

interface Props {
  user: User;
  postId: string;
  onClose: () => void;
}

const classLabel = (student: DeveloperLogLikeStudent) =>
  [
    student.grade && `${student.grade}학년`,
    student.class && `${student.class}반`,
    student.number && `${student.number}번`,
  ]
    .filter(Boolean)
    .join(" ");

const DeveloperLogLikeStudentsDialog: React.FC<Props> = ({
  user,
  postId,
  onClose,
}) => {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const active = useRef(false);
  const flight = useRef<object | null>(null);
  const [students, setStudents] = useState<DeveloperLogLikeStudent[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const loadPage = async (cursor?: string) => {
    if (flight.current || !active.current) return;
    const request = {};
    flight.current = request;
    setLoading(true);
    setError(false);
    try {
      const page = await getDeveloperLogLikeStudents(user, postId, cursor);
      if (!active.current || flight.current !== request) return;
      setStudents((previous) =>
        cursor
          ? [
              ...new Map(
                [...previous, ...page.students].map((student) => [
                  student.id,
                  student,
                ]),
              ).values(),
            ]
          : page.students,
      );
      setNextCursor(page.nextCursor);
      setHasMore(page.hasMore);
      setLoaded(true);
    } catch (cause) {
      if (active.current && flight.current === request) {
        if (
          ["functions/permission-denied", "functions/unauthenticated"].includes(
            String((cause as { code?: string })?.code || ""),
          )
        ) {
          setStudents([]);
          setNextCursor(null);
          setHasMore(false);
          setLoaded(false);
        }
        setError(true);
      }
    } finally {
      if (active.current && flight.current === request) {
        flight.current = null;
        setLoading(false);
      }
    }
  };

  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const previousFocus =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const releaseScrollLock = acquirePageScrollLock();
    dialog.showModal();
    closeRef.current?.focus({ preventScroll: true });
    return () => {
      if (dialog.open) dialog.close();
      releaseScrollLock();
      queueMicrotask(() => {
        const focus = document.activeElement;
        if (
          previousFocus?.isConnected &&
          (!focus ||
            focus === document.body ||
            focus === dialog ||
            !focus.isConnected)
        ) {
          previousFocus.focus({ preventScroll: true });
        }
      });
    };
  }, []);

  useEffect(() => {
    active.current = true;
    void loadPage();
    return () => {
      active.current = false;
      flight.current = null;
    };
  }, [user, postId]);

  return (
    <dialog
      ref={dialogRef}
      className="developer-log-likers-dialog"
      aria-labelledby="developer-log-likers-title"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      onKeyDown={(event) => {
        if (event.key !== "Tab") return;
        const controls = Array.from(
          event.currentTarget.querySelectorAll<HTMLElement>(
            "button:not([disabled]), [href], [tabindex]:not([tabindex='-1'])",
          ),
        ).filter((element) => element.getClientRects().length > 0);
        const first = controls[0];
        const last = controls.at(-1);
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }}
    >
      <section
        className="developer-log-likers-panel"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-gray-200 px-5 py-3">
          <h2
            id="developer-log-likers-title"
            className="text-lg font-bold text-slate-900"
          >
            좋아요 누른 학생
          </h2>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            className="min-h-11 rounded-lg px-3 text-sm font-semibold text-slate-600 hover:bg-gray-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600"
          >
            닫기
          </button>
        </div>
        <div className="min-h-0 overflow-y-auto px-5 py-4" aria-busy={loading}>
          {students.length > 0 && (
            <ul
              className="divide-y divide-gray-100"
              aria-label="좋아요 누른 학생 명단"
            >
              {students.map((student) => (
                <li
                  key={student.id}
                  className="flex min-h-11 flex-wrap items-center justify-between gap-x-4 gap-y-1 py-3"
                >
                  <span className="min-w-0 break-words text-base font-semibold text-slate-900">
                    {student.name}
                  </span>
                  <span className="whitespace-nowrap text-sm text-slate-500">
                    {classLabel(student)}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {loading && (
            <InlineLoading message="학생 명단을 불러오는 중입니다." />
          )}
          {!loading && !error && loaded && students.length === 0 && (
            <p className="py-4 text-sm text-slate-500">
              좋아요를 누른 학생이 없습니다.
            </p>
          )}
          {error && (
            <div className="py-3">
              <p role="alert" className="text-sm text-red-600">
                학생 명단을 불러오지 못했습니다. 다시 시도해 주세요.
              </p>
              <button
                type="button"
                className="mt-2 min-h-11 rounded-lg border border-gray-200 px-4 text-sm font-semibold text-slate-700 hover:bg-gray-50"
                onClick={() =>
                  void loadPage(loaded ? nextCursor || undefined : undefined)
                }
              >
                다시 시도
              </button>
            </div>
          )}
          {!error && hasMore && (
            <button
              type="button"
              disabled={loading}
              className="mt-3 min-h-11 rounded-lg border border-gray-200 px-4 text-sm font-semibold text-slate-700 hover:bg-gray-50 disabled:opacity-50"
              onClick={() => void loadPage(nextCursor || undefined)}
            >
              더 보기
            </button>
          )}
        </div>
      </section>
    </dialog>
  );
};

export default DeveloperLogLikeStudentsDialog;
