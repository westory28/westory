import { useEffect, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../../contexts/AuthContext";
import { canAccessTeacherPath } from "../../lib/permissions";
import {
  teacherShortcutOptions,
  readTeacherShortcuts,
  saveTeacherShortcuts,
} from "../../lib/teacherShortcuts";
import {
  ShortcutEditor,
  StudentShortcutIcon,
} from "./StudentLearningShortcutsEditor";
import { InlineLoading } from "./LoadingState";
import "./studentLearningTools.css";

export default function TeacherShortcuts({
  uid,
  buttonRef,
  onMemo,
  memoCount,
}: {
  uid: string;
  buttonRef: RefObject<HTMLButtonElement>;
  onMemo: () => void;
  memoCount: number;
}) {
  const { userData, currentUser, menuConfig } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [panel, setPanel] = useState<"menu" | "edit" | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const [items, setItems] = useState<string[] | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const lastRead = useRef(0);
  const inFlight = useRef<Promise<void>>();
  const routeKey = location.pathname + location.search;
  useEffect(() => setPanel(null), [routeKey]);
  const labels = new Map(
    menuConfig?.teacher.flatMap((menu) =>
      (menu.children ?? [menu]).map((item) => [item.url, item.name] as const),
    ),
  );
  const options = teacherShortcutOptions
    .filter((item) =>
      canAccessTeacherPath(item.id.split("?")[0], userData, currentUser?.email),
    )
    .map((item) => ({ ...item, label: labels.get(item.id) || item.label }));
  const reload = () => {
    if (inFlight.current) return inFlight.current;
    setLoading(true);
    setError("");
    const pending = readTeacherShortcuts(uid)
      .then((next) => {
        setItems(next);
        lastRead.current = Date.now();
      })
      .catch(() => {
        setItems(null);
        setError("바로가기를 불러오지 못했습니다.");
        lastRead.current = 0;
      })
      .finally(() => {
        setLoading(false);
        inFlight.current = undefined;
      });
    inFlight.current = pending;
    return pending;
  };
  useEffect(() => {
    if (panel === "menu") dialog.current?.showModal();
  }, [panel]);
  const close = () => {
    setPanel(null);
    requestAnimationFrame(() =>
      buttonRef.current?.focus({ preventScroll: true }),
    );
  };
  const action = (
    label: string,
    icon: string,
    run: () => void,
    key = label,
  ) => (
    <button key={key} type="button" onClick={run}>
      <span className="student-learning-tools-label">{label}</span>
      <span className="student-learning-tools-icon">
        <StudentShortcutIcon path={icon} />
      </span>
    </button>
  );
  return createPortal(
    <>
      <button
        ref={buttonRef}
        data-patch-memo-root="true"
        type="button"
        className="student-learning-tools-launcher teacher-shortcut-launcher"
        aria-label="교사 바로가기 열기"
        aria-haspopup="dialog"
        aria-expanded={panel !== null}
        onClick={() => {
          if (!items || Date.now() - lastRead.current >= 60000) void reload();
          setPanel("menu");
        }}
      >
        <span aria-hidden="true">Ws</span>
      </button>
      {panel === "menu" && (
        <dialog
          ref={dialog}
          data-patch-memo-root="true"
          className="student-learning-tools-menu teacher-shortcut-menu"
          aria-label="교사 바로가기"
          onCancel={(event) => {
            event.preventDefault();
            close();
          }}
          onClick={(event) => {
            if (event.target !== event.currentTarget) return;
            const r = event.currentTarget.getBoundingClientRect();
            if (
              event.clientX < r.left ||
              event.clientX > r.right ||
              event.clientY < r.top ||
              event.clientY > r.bottom
            )
              close();
          }}
        >
          {action("바로가기 편집", "M12 5v14M5 12h14", () => setPanel("edit"))}
          {action(
            memoCount ? `패치 메모 (${memoCount})` : "패치 메모",
            "m5 15-1 5 5-1L20 8l-4-4z",
            () => {
              setPanel(null);
              onMemo();
            },
          )}
          {loading ? (
            <InlineLoading message="바로가기를 불러오는 중입니다." />
          ) : error ? (
            <button type="button" onClick={() => void reload()}>
              {error} 다시 시도
            </button>
          ) : (
            items?.map((id) => {
              const item = options.find((option) => option.id === id);
              return (
                item &&
                action(
                  item.label,
                  item.icon,
                  () => {
                    setPanel(null);
                    navigate(item.id);
                  },
                  item.id,
                )
              );
            })
          )}
          {action("닫기", "m6 6 12 12M18 6 6 18", close)}
        </dialog>
      )}
      {panel === "edit" && (
        <ShortcutEditor
          options={options}
          fixedHelp="패치 메모는 기본 메뉴입니다."
          items={items ?? []}
          availableIds={options.map((item) => item.id)}
          loading={loading}
          loaded={items !== null && !loading}
          error={error}
          onReload={reload}
          onSave={async (next) => {
            if (!items) throw new Error("다시 불러와 주세요.");
            await saveTeacherShortcuts(uid, items, next);
            setItems(next);
            lastRead.current = Date.now();
          }}
          onClose={close}
        />
      )}
    </>,
    document.body,
  );
}
