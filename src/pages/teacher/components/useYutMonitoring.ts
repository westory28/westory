import { useCallback, useEffect, useRef, useState } from "react";
import { YUT_WAITING_MS } from "../../../../functions/yutCore.mjs";
import {
  getYutManagement,
  subscribeYutManagement,
  yutErrorMessage,
  type YutManagement,
} from "../../../lib/yut";
import type { WeplayConfig } from "../../../lib/weplay";

type MonitorView = {
  key: string;
  data: YutManagement | null;
  status: "connecting" | "live" | "paused" | "error";
  refreshing: boolean;
  error: string;
  serverOffsetMs: number;
};

export default function useYutMonitoring(
  config: WeplayConfig,
  actorKey: string,
  enabled: boolean,
) {
  const year = config?.year;
  const semester = config?.semester;
  const [attempt, setAttempt] = useState(0);
  const contextKey = JSON.stringify([
    actorKey,
    year,
    semester,
    enabled,
    attempt,
  ]);
  const session = useRef({ contextKey, version: 0 });
  if (session.current.contextKey !== contextKey) {
    session.current = { contextKey, version: session.current.version + 1 };
  }
  const key = `${contextKey}/${session.current.version}`;
  const identity = useRef(key);
  identity.current = key;
  const [view, setView] = useState<MonitorView | null>(null);
  const refresh = useCallback(() => setAttempt((value) => value + 1), []);

  useEffect(() => {
    if (!enabled || !year || !semester || !actorKey) return;
    let active = true;
    let generation = 0;
    let changes = 0;
    let pending = false;
    let reading = false;
    let connected = false;
    let terminal = false;
    let unsubscribe: (() => void) | undefined;
    let debounce: number | undefined;
    let expiry: number | undefined;
    let timeout: number | undefined;
    const valid = (token: number) =>
      active &&
      identity.current === key &&
      generation === token &&
      !document.hidden;
    const publish = (status: MonitorView["status"], error = "") =>
      setView({
        key,
        data: null,
        status,
        refreshing: false,
        error,
        serverOffsetMs: 0,
      });
    const stop = () => {
      generation++;
      unsubscribe?.();
      unsubscribe = undefined;
      window.clearTimeout(debounce);
      window.clearTimeout(expiry);
      window.clearTimeout(timeout);
      debounce = undefined;
      pending = false;
      reading = false;
      connected = false;
    };
    const fail = (error: unknown, token: number) => {
      if (!valid(token)) return;
      stop();
      terminal = true;
      publish("error", yutErrorMessage(error));
    };
    const read = async () => {
      debounce = undefined;
      if (!pending || reading || !connected || !valid(generation)) return;
      const token = generation;
      const version = changes;
      const sentAt = performance.now();
      pending = false;
      reading = true;
      setView((previous) =>
        previous?.key === key ? { ...previous, refreshing: true } : previous,
      );
      try {
        const data = await Promise.race([
          getYutManagement({ year, semester }),
          new Promise<never>((_, reject) => {
            timeout = window.setTimeout(
              () =>
                reject(
                  new Error(
                    "방 현황을 확인하지 못했습니다. 다시 연결해 주세요.",
                  ),
                ),
              15000,
            );
          }),
        ]);
        if (!valid(token) || !connected) return;
        // Only the callable's authorized projection supplies student information.
        // Expiration also happens without a write, so schedule a fresh server read.
        const roomExpiry = (room: YutManagement["rooms"][number]) =>
          room.status === "waiting"
            ? Math.min(room.expiresAtMs, room.createdAtMs + YUT_WAITING_MS)
            : room.expiresAtMs;
        // Include the request duration conservatively: a slow response must not
        // revive expired rooms. Monotonic time tolerates local clock changes.
        const receivedAt = performance.now();
        const serverNowMs = data.serverNowMs + (receivedAt - sentAt);
        const serverNow = () => serverNowMs + (performance.now() - receivedAt);
        let rooms = data.rooms.filter((room) => roomExpiry(room) > serverNow());
        setView({
          key,
          data: { ...data, rooms },
          status: "live",
          refreshing: version !== changes,
          error: "",
          serverOffsetMs: serverNowMs - Date.now(),
        });
        window.clearTimeout(expiry);
        const scheduleExpiry = () => {
          if (!rooms.length) return;
          const delay = Math.min(...rooms.map(roomExpiry)) - serverNow();
          expiry = window.setTimeout(
            () => {
              if (!valid(token) || !connected) return;
              // Hide expired entries before the network response arrives.
              rooms = rooms.filter((room) => roomExpiry(room) > serverNow());
              setView((previous) =>
                previous?.key === key && previous.data
                  ? {
                      ...previous,
                      data: {
                        ...previous.data,
                        rooms,
                      },
                    }
                  : previous,
              );
              changed();
              // Expire the next room independently of a pending server read.
              scheduleExpiry();
            },
            Math.min(Math.max(delay, 1), 2147483647),
          );
        };
        scheduleExpiry();
      } catch (error) {
        fail(error, token);
      } finally {
        if (valid(token)) {
          window.clearTimeout(timeout);
          reading = false;
          if (pending && connected) schedule();
        }
      }
    };
    const schedule = () => {
      if (!reading && debounce === undefined)
        debounce = window.setTimeout(() => void read(), 150);
    };
    const changed = () => {
      changes++;
      pending = true;
      schedule();
    };
    const connect = () => {
      stop();
      if (!active || identity.current !== key || terminal) return;
      if (document.hidden) {
        publish("paused");
        return;
      }
      publish("connecting");
      const token = generation;
      try {
        const off = subscribeYutManagement(
          { year, semester },
          () => {
            if (valid(token)) changed();
          },
          (error) => fail(error, token),
          (isConnected) => {
            if (!valid(token)) return;
            connected = isConnected;
            if (!isConnected) {
              changes++;
              window.clearTimeout(expiry);
              publish("connecting");
            }
          },
        );
        if (valid(token)) unsubscribe = off;
        else off();
      } catch (error) {
        fail(error, token);
      }
    };
    const visibility = () => {
      if (terminal) return;
      if (document.hidden) {
        stop();
        publish("paused");
      } else connect();
    };
    document.addEventListener("visibilitychange", visibility);
    connect();
    return () => {
      active = false;
      stop();
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [key, actorKey, year, semester, enabled]);

  return {
    data: enabled && view?.key === key ? view.data : null,
    status: view?.key === key ? view.status : "connecting",
    error: view?.key === key ? view.error : "",
    refreshing: view?.key === key ? view.refreshing : false,
    serverOffsetMs: view?.key === key ? view.serverOffsetMs : 0,
    refresh,
  };
}
