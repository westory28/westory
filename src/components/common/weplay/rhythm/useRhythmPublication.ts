import { useEffect, useRef, useState } from "react";
import { useAuth } from "../../../../contexts/AuthContext";
import { canReadLessonManagement } from "../../../../lib/permissions";
import { getStudentRouteAccess } from "../../../../lib/studentMenuAccess";
import {
  getRhythmPublication,
  type RhythmPublication,
  type RhythmPublicationSnapshot,
} from "../../../../lib/rhythmPublication";

const checking: RhythmPublicationSnapshot = {
  status: "checking",
  enabled: false,
  revision: 0,
};

/** Admission lasts for this mounted view and its account/semester/permission scope. */
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
    authPhase,
  } = useAuth();
  const allowed =
    authPhase === "ready" &&
    (portal === "teacher"
      ? canReadLessonManagement(userData, currentUser?.email)
      : !!(configReady && menuConfigReady) &&
        getStudentRouteAccess(
          { pathname: "/student/weplay", search: "?game=gungdeok-rock" },
          config,
          menuConfig,
        ).allowed);
  const permissionScope = JSON.stringify([
    userData?.role,
    userData?.teacherPortalEnabled,
    userData?.staffPermissions,
    userData?.registrationApprovalStatus,
    userData?.enrollmentStatus,
  ]);
  const boundary = `${portal}/${currentUser?.uid}/${authGeneration}/${authPhase}/${config?.year}/${config?.semester}/${configReady}/${allowed}/${enabled}/${permissionScope}`;
  const entry = useRef({ boundary, serial: 0 });
  if (entry.current.boundary !== boundary) {
    entry.current = { boundary, serial: entry.current.serial + 1 };
  }
  // A permission revoke/restore must not resurrect a previous admitted state.
  const scope = `${boundary}/${entry.current.serial}`;
  const scopeRef = useRef(scope);
  scopeRef.current = scope;
  const [attempt, setAttempt] = useState(0);
  const requestKey = `${scope}/${attempt}`;
  const request = useRef<{
    key: string;
    promise: Promise<RhythmPublication>;
  } | null>(null);
  const [state, setState] = useState({ key: "", ...checking });

  useEffect(() => {
    if (!enabled || !allowed || !currentUser || !configReady || !config) return;
    let active = true;
    if (request.current?.key !== requestKey) {
      request.current = {
        key: requestKey,
        promise: getRhythmPublication(config),
      };
    }
    // The same pending promise survives React StrictMode's effect replay. A
    // real unmount/remount, explicit retry, or boundary change gets a new read.
    void request.current.promise.then(
      (result) => {
        if (active && scopeRef.current === scope)
          setState({
            key: requestKey,
            ...result,
            status: result.enabled ? "open" : "closed",
          });
      },
      (error) => {
        if (active && scopeRef.current === scope)
          setState({
            key: requestKey,
            ...checking,
            status: error?.code === "permission-denied" ? "closed" : "error",
          });
      },
    );
    return () => {
      active = false;
    };
  }, [requestKey, allowed, configReady]);

  const current =
    !enabled || !allowed || !currentUser
      ? { ...checking, status: "closed" as const }
      : state.key === requestKey
        ? state
        : checking;
  return {
    ...current,
    scope,
    retry: () => setAttempt((value) => value + 1),
    acceptSaved: (result: RhythmPublication) => {
      if (portal === "teacher" && scopeRef.current === scope)
        setState({
          key: requestKey,
          ...result,
          status: result.enabled ? "open" : "closed",
        });
    },
    invalidate: () => {
      if (scopeRef.current === scope)
        setState({ key: requestKey, ...checking, status: "error" });
    },
  };
}
