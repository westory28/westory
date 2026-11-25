import {
  canThrowYutBack,
  YUT_BACK_VALUE,
  type YutRoom,
} from "../../../../../functions/yutCore.mjs";

/** "3칸", or the one pad a back-do takes back. */
export const yutStepText = (value: number) =>
  value === YUT_BACK_VALUE ? "뒤로 1칸" : `${value}칸`;

/** Which of the four sticks carries the back-do mark, or -1 for an unmarked set.
 * Only the thrown result decides: the marked stick is the flat one of a back-do
 * and never the flat one of an ordinary do. */
export function markedYutStick(room: YutRoom) {
  const thrown = room.pendingThrow;
  if (!thrown || !room.turnUid || !canThrowYutBack(room, room.turnUid))
    return -1;
  const flat = thrown.sticks.filter(Boolean).length;
  const only = thrown.sticks.indexOf(true);
  return thrown.value === YUT_BACK_VALUE
    ? only
    : flat === 1
      ? (only + 1) % 4
      : 2;
}
