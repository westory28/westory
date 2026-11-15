import { useEffect, useRef, useState } from "react";
import { useAuth } from "../../../../contexts/AuthContext";
import { canReadLessonManagement } from "../../../../lib/permissions";
import { getStudentRouteAccess } from "../../../../lib/studentMenuAccess";
import {
  subscribeRhythmPublication,
  type RhythmPublicationSnapshot,
} from "../../../../lib/rhythmPublication";

const checking: RhythmPublicationSnapshot = {
  status: "checking",
  enabled: false,
  revision: 0,
};

export default function useRhythmPublication(
  portal: "student" | "teacher",
  enabled = true,
) {
  const {
    config,
    currentUser,
    userData,
    menuConfig,
    configReady,
    menuConfigReady,
    authGeneration,
  } = useAuth();
  const allowed =
    portal === "teacher"
      ? canReadLessonManagement(userData, currentUser?.email)
      : !!(configReady && menuConfigReady) &&
        getStudentRouteAccess(
          { pathname: "/student/weplay", search: "?game=gungdeok-rock" },
          config,
          menuConfig,
        ).allowed;
  const scope = `${portal}/${currentUser?.uid}/${authGeneration}/${config?.year}/${config?.semester}/${configReady}/${allowed}/${enabled}`;
  const scopeRef = useRef(scope);
  scopeRef.current = scope;
  const [state, setState] = useState({ scope: "", ...checking });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!enabled || !allowed || !currentUser || !configReady || !config) return;
    let active = true;
    let connection = 0;
    let unsubscribe: (() => void) | undefined;
    let deadline: ReturnType<typeof setTimeout> | undefined;
    const publish = (next: RhythmPublicationSnapshot) => {
      if (active && scopeRef.current === scope) setState({ scope, ...next });
    };
    const stop = () => {
      connection++;
      unsubscribe?.();
      unsubscribe = undefined;
      clearTimeout(deadline);
      deadline = undefined;
    };
    const armDeadline = () => {
      if (deadline !== undefined) return;
      deadline = setTimeout(() => {
        stop();
        publish({ ...checking, status: "error" });
      }, 10000);
    };
    const reconnect = () => {
      stop();
      const generation = connection;
      publish(checking);
      if (document.hidden) return;
      if (navigator.onLine === false) {
        publish({ ...checking, status: "error" });
        return;
      }
      armDeadline();
      try {
        unsubscribe = subscribeRhythmPublication(config, (next) => {
          if (connection !== generation) return;
          if (next.status === "checking") armDeadline();
          else {
            clearTimeout(deadline);
            deadline = undefined;
          }
          publish(next);
        });
      } catch {
        stop();
        publish({ ...checking, status: "error" });
      }
    };
    reconnect();
    document.addEventListener("visibilitychange", reconnect);
    window.addEventListener("online", reconnect);
    window.addEventListener("offline", reconnect);
    return () => {
      active = false;
      stop();
      document.removeEventListener("visibilitychange", reconnect);
      window.removeEventListener("online", reconnect);
      window.removeEventListener("offline", reconnect);
    };
  }, [scope, attempt, configReady]);

  const current =
    !enabled || !allowed || !currentUser
      ? { ...checking, status: "closed" as const }
      : state.scope === scope
        ? state
        : checking;
  return { ...current, scope, retry: () => setAttempt((value) => value + 1) };
}
