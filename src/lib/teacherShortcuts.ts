import { doc, getDocFromServer, runTransaction } from "firebase/firestore";
import { MENUS } from "../constants/menus";
import { auth, db } from "./firebase";

export const teacherShortcutOptions = [
  { id: "/teacher/dashboard", label: "대시보드", icon: "m3 10 9-7 9 7v10H3z" },
  ...MENUS.teacher.flatMap((menu) =>
    (menu.children ?? [menu]).map((item) => ({
      id: item.url,
      label: item.name,
      icon: menu.icon,
    })),
  ),
  {
    id: "/teacher/points?tab=ranks",
    label: "등급 관리",
    icon: MENUS.teacher.find((menu) => menu.url === "/teacher/points")!.icon,
  },
  {
    id: "/teacher/schedule",
    label: "캘린더",
    icon: "M4 5h16v15H4z M4 10h16M8 3v4m8-4v4",
  },
  {
    id: "/teacher/settings",
    label: "설정",
    icon: "M4 7h16M4 17h16M8 4v6m8 4v6",
  },
];
const defaults = ["/teacher/lesson", "/teacher/quiz", "/teacher/wispi"];
// Saved shortcuts keep working after a menu moves: 위스피 left 위스 on
// 2026-11-26. The stored list is only rewritten when the teacher saves.
const movedShortcuts: Readonly<Record<string, string>> = {
  "/teacher/points?tab=stocks": "/teacher/wispi",
};
function readItems(raw: unknown): string[] {
  if (raw === undefined) return [...defaults];
  if (!Array.isArray(raw))
    throw new Error("바로가기 설정을 확인하지 못했습니다.");
  const items = [
    ...new Set(
      raw.map((id) =>
        typeof id === "string" ? (movedShortcuts[id] ?? id) : id,
      ),
    ),
  ];
  if (
    !items.every((id) => teacherShortcutOptions.some((item) => item.id === id))
  )
    throw new Error("바로가기 설정을 확인하지 못했습니다.");
  return items;
}
function target(uid: string) {
  if (!uid || auth.currentUser?.uid !== uid)
    throw new Error("로그인 상태를 확인해 주세요.");
  return doc(db, "users", uid, "preferences", "teacherShortcuts");
}
export async function readTeacherShortcuts(uid: string) {
  return readItems((await getDocFromServer(target(uid))).data()?.items);
}
export async function saveTeacherShortcuts(
  uid: string,
  previous: string[],
  items: string[],
) {
  if (JSON.stringify(previous) === JSON.stringify(items)) return;
  const ref = target(uid);
  await runTransaction(db, async (transaction) => {
    const current = readItems((await transaction.get(ref)).data()?.items);
    if (JSON.stringify(current) === JSON.stringify(items)) return;
    if (JSON.stringify(current) !== JSON.stringify(previous))
      throw new Error(
        "다른 기기에서 바로가기가 바뀌었습니다. 다시 불러와 주세요.",
      );
    transaction.set(ref, { items });
  });
}
