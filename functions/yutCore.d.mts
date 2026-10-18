export type YutRole = 'sa' | 'nong' | 'gong' | 'sang';
export type YutRoute = 'outer' | 'a' | 'b';
export type YutNode = 'home' | 'finish' | `o${number}` | 'a1' | 'a2' | 'center' | 'a4' | 'a5' | 'b1' | 'b2' | 'b4' | 'b5';
export interface YutPiece { id: string; node: YutNode; lane: YutRoute }
export interface YutPlayer { uid: string; name: string; role: YutRole; ready: boolean; active: boolean; pieces: YutPiece[] }
export interface YutRoom {
  id: string; code: string; classId: string; classLabel: string; hostUid: string;
  status: 'waiting' | 'playing' | 'finished' | 'closed'; revision: number;
  players: YutPlayer[]; participantUids: string[]; turnUid: string | null;
  phase: 'throw' | 'move'; pendingThrow: { value: number; label: string; sticks: boolean[] } | null;
  extraThrows: number; turnDeadlineMs: number; winnerUid: string | null;
  lastEvent: { kind: string; text: string; atMs: number };
  createdAtMs: number; updatedAtMs: number; expiresAtMs: number;
}
export interface YutMove { pieceId: string; route: YutRoute; targetNode: YutNode; stackSize: number }
export const YUT_TURN_MS: number;
export const YUT_ROOM_MS: number;
export const YUT_ROLES: YutRole[];
export function createYutRoom(options: { id: string; code: string; classId: string; classLabel: string; host: { uid: string; name: string }; nowMs: number }): YutRoom;
export function addYutPlayer(room: YutRoom, player: { uid: string; name: string }, nowMs: number): YutRoom;
export function readyYutPlayer(room: YutRoom, uid: string, ready: boolean, nowMs: number): YutRoom;
export function startYutGame(room: YutRoom, nowMs: number): YutRoom;
export function throwYut(room: YutRoom, uid: string, sticks: boolean[], nowMs: number): YutRoom;
export function getLegalYutMoves(room: YutRoom, uid: string): YutMove[];
export function moveYut(room: YutRoom, uid: string, pieceId: string, route: YutRoute, nowMs: number): YutRoom;
export function skipYutTurn(room: YutRoom, nowMs: number): YutRoom;
export function leaveYutRoom(room: YutRoom, uid: string, nowMs: number): YutRoom;
export function closeYutRoom(room: YutRoom, nowMs: number): YutRoom;
