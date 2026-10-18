import { useEffect, useRef, useState } from "react";
import { useAuth } from "../../../contexts/AuthContext";
import { getYutLobby, type YutSettings } from "../../../lib/yut";

type Status = "checking" | "open" | "closed" | "error";

/** Missing settings and failed checks never unlock student games, including local play. */
export default function useYutPublication(portal: "student" | "teacher") {
  const { config, currentUser } = useAuth();
  const scope = `${currentUser?.uid}/${config?.year}/${config?.semester}`;
  const scopeRef = useRef(scope);
  scopeRef.current = scope;
  const [access, setAccess] = useState<{
    scope: string;
    status: Status;
    settings?: YutSettings;
  }>({
    scope: "",
    status: "checking",
  });
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (portal === "teacher") return;
    let active = true;
    let pending = false;
    let requestTimeout: number | undefined;
    setAccess({ scope, status: "checking" });
    const check = async () => {
      if (!active || pending || document.hidden) return;
      if (!currentUser || !config?.year || !config?.semester) {
        setAccess({ scope, status: "closed" });
        return;
      }
      pending = true;
      try {
        const lobby = await Promise.race([
          getYutLobby(config),
          new Promise<never>((_resolve, reject) => {
            requestTimeout = window.setTimeout(
              () => reject(new Error("게임 확인 시간이 초과되었습니다.")),
              10000,
            );
          }),
        ]);
        if (active && scopeRef.current === scope)
          setAccess({
            scope,
            status: lobby.enabled === true ? "open" : "closed",
            settings: lobby.enabled === true ? lobby.settings : undefined,
          });
      } catch (error) {
        if (active && scopeRef.current === scope) {
          const denied = String(
            (error as { code?: string })?.code || "",
          ).includes("permission-denied");
          setAccess({ scope, status: denied ? "closed" : "error" });
        }
      } finally {
        window.clearTimeout(requestTimeout);
        requestTimeout = undefined;
        pending = false;
      }
    };
    void check();
    const timer = window.setInterval(() => void check(), 15000);
    const onVisible = () => {
      if (!document.hidden) void check();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      active = false;
      window.clearTimeout(requestTimeout);
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [portal, scope, revision]);
  const status: Status =
    portal === "teacher"
      ? "open"
      : access.scope === scope
        ? access.status
        : "checking";
  return {
    status,
    scope,
    settings:
      access.scope === scope && status === "open" ? access.settings : undefined,
    retry: () => setRevision((value) => value + 1),
  };
}
