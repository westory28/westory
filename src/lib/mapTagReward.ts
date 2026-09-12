import { auth } from "./firebase";
import {
  executeWestoryCommand,
  WestoryCommandError,
  type W2CommandPayloads,
  type W2CommandResults,
} from "./commandGateway";
import { getSemesterCollectionPath } from "./semesterScope";
import type { SystemConfig } from "../types";

type Result = W2CommandResults["claimMapTagReward"];
type Operation = {
  ownerUid: string;
  payload: W2CommandPayloads["claimMapTagReward"];
  commandId: string;
  pending: Promise<Result> | null;
};
// An uncertain response keeps the original interaction and Gateway key across a
// remount/retry. The map is tab-local and keyed by both UID and semester.
const operations = new Map<string, Operation>();
const performMapTagReward = async (
  current: Operation,
  key: string,
): Promise<Result> => {
  try {
    const response = await executeWestoryCommand(
      "claimMapTagReward",
      current.payload,
      { expectedUid: current.ownerUid, commandId: current.commandId },
    );
    if (auth.currentUser?.uid !== current.ownerUid)
      throw new Error("로그인 사용자가 바뀌었습니다. 화면을 다시 열어 주세요.");
    operations.delete(key);
    // A recovered receipt confirms the old payment, not a new reward.
    return response.replayed && response.result.awarded
      ? {
          ...response.result,
          status: "DUPLICATE",
          awarded: false,
          duplicate: true,
          amount: 0,
          totalAwarded: 0,
          blockedReason: "duplicate_source",
          blockedMessage: "이번 지도 태그 위스는 이미 반영되었습니다.",
        }
      : response.result;
  } catch (error) {
    if (error instanceof WestoryCommandError && error.outcomeConfirmed)
      operations.delete(key);
    throw error;
  } finally {
    current.pending = null;
  }
};
export const claimMapTagReward = async ({
  config,
  mapId,
  tag,
}: {
  config: Pick<SystemConfig, "year" | "semester"> | null | undefined;
  mapId: string;
  tag: string;
}): Promise<Result> => {
  const ownerUid = auth.currentUser?.uid;
  if (!ownerUid) throw new Error("학생 계정으로 다시 로그인해 주세요.");
  const root = getSemesterCollectionPath(config, "map_resources");
  const scope = root.match(
    /^years\/(\d{4})\/semesters\/([12])\/map_resources$/,
  );
  if (!scope) throw new Error("현재 학기를 확인할 수 없습니다.");
  const semesterId = scope[1] + "-" + scope[2];
  const key = JSON.stringify([ownerUid, semesterId, mapId, tag.trim()]);
  let operation = operations.get(key);
  if (!operation) {
    const commandId = crypto.randomUUID();
    operation = {
      ownerUid,
      commandId,
      payload: { semesterId, mapId, tag: tag.trim(), interactionId: commandId },
      pending: null,
    };
    operations.set(key, operation);
  }
  if (operation.pending) return operation.pending;
  const current = operation;
  current.pending = performMapTagReward(current, key);
  return current.pending;
};
