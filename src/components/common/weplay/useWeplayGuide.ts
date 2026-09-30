import { useEffect, useRef, useState } from "react";
import {
  completeWeplayGuide,
  getWeplayGuideStatus,
} from "../../../lib/weplayGuide";

export default function useWeplayGuide(
  uid: string | undefined,
  profile: Parameters<typeof getWeplayGuideStatus>[1],
  ready: boolean,
) {
  const status = getWeplayGuideStatus(uid, profile);
  const [shownFor, setShownFor] = useState<string | null>(null);
  const [savedFor, setSavedFor] = useState<string | null>(null);
  const [savingFor, setSavingFor] = useState<string | null>(null);
  const [failure, setFailure] = useState<{
    uid: string;
    message: string;
  } | null>(null);
  const autoShown = useRef(new Set<string>());
  const currentUid = useRef(uid);
  currentUid.current = uid;
  const pending = useRef<string | null>(null);
  const generation = useRef(0);
  useEffect(() => {
    generation.current += 1;
    pending.current = null;
    setShownFor(null);
    setSavingFor(null);
    setFailure(null);
    return () => {
      generation.current += 1;
    };
  }, [uid]);
  useEffect(() => {
    if (
      !uid ||
      !ready ||
      status !== false ||
      savedFor === uid ||
      autoShown.current.has(uid)
    )
      return;
    autoShown.current.add(uid);
    setShownFor(uid);
  }, [uid, ready, status, savedFor]);

  const openGuide = () => {
    if (!uid) return;
    autoShown.current.add(uid);
    setFailure(null);
    setShownFor(uid);
  };
  const closeForNow = () => {
    if (pending.current === uid) return;
    setShownFor(null);
    setFailure(null);
  };
  const finishGuide = async () => {
    if (!uid || pending.current === uid) return;
    if (status === true || savedFor === uid) {
      setShownFor(null);
      return;
    }
    const request = ++generation.current;
    pending.current = uid;
    setSavingFor(uid);
    setFailure(null);
    try {
      await completeWeplayGuide(uid);
      if (currentUid.current !== uid || generation.current !== request) return;
      setSavedFor(uid);
      setShownFor(null);
    } catch {
      if (currentUid.current === uid && generation.current === request)
        setFailure({
          uid,
          message:
            "안내 완료를 저장하지 못했습니다. 다시 저장하거나 이번에는 닫아 주세요.",
        });
    } finally {
      if (currentUid.current === uid && generation.current === request) {
        pending.current = null;
        setSavingFor(null);
      }
    }
  };
  return {
    open: Boolean(uid && shownFor === uid),
    saving: Boolean(uid && savingFor === uid),
    error: failure && failure.uid === uid ? failure.message : "",
    openGuide,
    closeForNow,
    finishGuide,
  };
}
