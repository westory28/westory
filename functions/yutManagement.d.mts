import type { YutRoom } from "./yutCore.mjs";

export interface YutManagementStanding {
  uid: string;
  finishedPieces: number;
  totalPieces: number;
  progress: number;
}

export function getYutManagementProgress(room: YutRoom): {
  standings: YutManagementStanding[];
  leadingUids: string[];
};
