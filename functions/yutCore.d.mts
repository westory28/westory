export type YutRole = 'sa' | 'nong' | 'gong' | 'sang';
export type YutRoute = 'outer' | 'a' | 'b';
export type YutEmoteKind = 'hello' | 'nice' | 'oops' | 'wow' | 'thanks' | 'gg' | 'angry';
export interface YutEmote { id: string; uid: string; kind: YutEmoteKind; atMs: number }
export type YutNode = 'home' | 'finish' | `o${number}` | 'a1' | 'a2' | 'center' | 'a4' | 'a5' | 'b1' | 'b2' | 'b4' | 'b5';
export interface YutPiece { id: string; node: YutNode; lane: YutRoute; stackId?: string }
export interface YutPlayer { uid: string; name: string; role: YutRole; ready: boolean; active: boolean; pieces: YutPiece[]; lastThrow?: { value: number; label: string; atMs: number; power?: number } }
export interface YutRoom {
  id: string; code: string; classId: string; classLabel: string; hostUid: string;
  visibility?: 'public' | 'private'; maxPlayers?: number; rulesVersion?: number; pieceCount?: number; throwSeconds?: number; moveSeconds?: number;
  status: 'waiting' | 'playing' | 'finished' | 'closed'; revision: number;
  finishReason?: 'completion' | 'forfeit';
  winnerRewardPolicy?: { enabled: boolean; amount: number; version: number };
  reward?: { status: 'paid' | 'pending' | 'not-awarded'; uid: string; amount: number; policyVersion: number; reason?: 'disabled' | 'ineligible' | 'account-unavailable'; settledAtMs?: number };
  syncRevision?: number; emotes?: Record<string, YutEmote>; blockedSeats?: number[];
  players: YutPlayer[]; participantUids: string[]; turnUid: string | null;
  phase: 'throw' | 'move'; pendingThrow: { value: number; label: string; sticks: boolean[] } | null;
  extraThrows: number; phaseStartsAtMs?: number; turnDeadlineMs: number; winnerUid: string | null;
  lastEvent: { kind: string; text: string; atMs: number; move?: { uid: string; pieceId: string; route: YutRoute; path: YutNode[]; capturedUids: string[]; movingPieceIds?: string[]; capturedPieces?: { uid: string; pieceId: string }[]; stacked?: boolean } };
  createdAtMs: number; updatedAtMs: number; expiresAtMs: number;
}
export interface YutMove { pieceId: string; route: YutRoute; targetNode: YutNode; stackSize: number; path?: YutNode[]; canStack?: boolean; stack?: boolean }
export function getYutThrowProbabilities(power?: number): number[];
export function sampleYutSticks(power?: number, random?: () => number): boolean[];
export const YUT_TURN_MS: number;
export const YUT_THROW_ANIMATION_MS: number;
export const YUT_MOVE_ANIMATION_MS: number;
export const YUT_STACK_ANIMATION_MS: number;
export const YUT_CAPTURE_ANIMATION_MS: number;
export const YUT_START_ANIMATION_MS: number;
export const YUT_ROOM_MS: number;
export const YUT_ROLES: YutRole[];
export const YUT_EMOTE_KINDS: YutEmoteKind[];
export const YUT_EMOTE_COOLDOWN_MS: number;
export const YUT_EMOTE_VISIBLE_MS: number;
export function addYutEmote(room: YutRoom, uid: string, kind: YutEmoteKind, id: string, nowMs: number): YutRoom;
export function createYutRoom(options: { id: string; code: string; classId: string; classLabel: string; host: { uid: string; name: string }; nowMs: number; visibility?: 'public' | 'private'; maxPlayers?: 2 | 3 | 4; throwSeconds?: number; moveSeconds?: number }): YutRoom;
export function addYutPlayer(room: YutRoom, player: { uid: string; name: string }, nowMs: number): YutRoom;
export function setYutSeat(room: YutRoom, uid: string, seat: number, blocked: boolean, nowMs: number): YutRoom;
export function readyYutPlayer(room: YutRoom, uid: string, ready: boolean, nowMs: number): YutRoom;
export function startYutGame(room: YutRoom, nowMs: number): YutRoom;
export function throwYut(room: YutRoom, uid: string, sticks: boolean[], nowMs: number, power?: number): YutRoom;
export function getLegalYutMoves(room: YutRoom, uid: string): YutMove[];
export function moveYut(room: YutRoom, uid: string, pieceId: string, route: YutRoute, nowMs: number, stack?: boolean): YutRoom;
export function skipYutTurn(room: YutRoom, nowMs: number): YutRoom;
export function leaveYutRoom(room: YutRoom, uid: string, nowMs: number): YutRoom;
export function closeYutRoom(room: YutRoom, nowMs: number): YutRoom;
