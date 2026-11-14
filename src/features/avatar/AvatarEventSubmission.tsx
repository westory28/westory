import { useEffect, useRef, useState } from "react";
import { useAuth } from "../../contexts/AuthContext";
import { getYearSemester } from "../../lib/semesterScope";
import {
  getGongsinmoongo,
  manageGongsinmoongo,
  newGongsinRequestId,
  useGongsinAvailability,
  type GongsinAvatarEventState,
} from "../../lib/gongsinmoongo";
import type { AvatarState } from "./catalog";
import "./avatarEvent.css";

const errorText = (failure: unknown) =>
  failure instanceof Error
    ? failure.message
    : "처리하지 못했습니다. 다시 시도해 주세요.";

export default function AvatarEventSubmission({
  avatar,
  readyForSubmission,
  refreshAvatar,
}: {
  avatar: AvatarState;
  readyForSubmission: boolean;
  refreshAvatar: () => Promise<AvatarState | undefined>;
}) {
  const { config, user, authGeneration } = useAuth();
  const { year, semester } = getYearSemester(config);
  const semesterId = `${year}-${semester}`;
  const availability = useGongsinAvailability();
  const enabled =
    availability.loaded &&
    !availability.error &&
    availability.enabled &&
    availability.avatarEventEnabled;
  const dialog = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [snapshot, setSnapshot] = useState<AvatarState>(avatar);
  const [state, setState] = useState<GongsinAvatarEventState | null>(null);
  const [description, setDescription] = useState("");
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [needsRefresh, setNeedsRefresh] = useState(false);
  const generation = useRef(0);
  const busyRef = useRef(false);
  const pending = useRef<{ fingerprint: string; id: string } | null>(null);

  useEffect(() => {
    if (open) dialog.current?.showModal();
    else if (dialog.current?.open) dialog.current.close();
  }, [open]);
  useEffect(
    () => () => {
      generation.current++;
    },
    [user?.uid, authGeneration, semesterId],
  );
  const close = () => {
    if (busyRef.current) return;
    generation.current++;
    setOpen(false);
    opener.current?.focus();
  };
  const load = async () => {
    const current = ++generation.current;
    setLoading(true);
    setError("");
    setState(null);
    try {
      const result = await getGongsinmoongo<GongsinAvatarEventState>(
        semesterId,
        "avatar-event",
      );
      if (current === generation.current) setState(result);
    } catch (failure) {
      if (current === generation.current) setError(errorText(failure));
    } finally {
      if (current === generation.current) setLoading(false);
    }
  };
  const submit = async () => {
    if (
      !enabled ||
      !state?.enabled ||
      state.participated ||
      needsRefresh ||
      loading ||
      busyRef.current ||
      !description.trim() ||
      description.length > 300
    )
      return;
    const fingerprint = JSON.stringify([description.trim(), snapshot.revision]);
    if (pending.current?.fingerprint !== fingerprint)
      pending.current = { fingerprint, id: newGongsinRequestId() };
    const current = generation.current;
    busyRef.current = true;
    setBusy(true);
    setError("");
    try {
      const result = await manageGongsinmoongo(
        semesterId,
        "submitAvatar",
        {
          description: description.trim(),
          expectedAvatarRevision: snapshot.revision,
        },
        pending.current.id,
      );
      if (current !== generation.current) return;
      if (!result.avatarEvent?.participated)
        throw new Error("접수 상태를 확인하지 못했습니다. 다시 확인해 주세요.");
      setState(result.avatarEvent);
      pending.current = null;
    } catch (failure) {
      if (current === generation.current) {
        setError(errorText(failure));
        const reason = (failure as { details?: { reason?: string } })?.details
          ?.reason;
        if (
          reason === "GONGSIN_AVATAR_CHANGED" ||
          reason === "GONGSIN_AVATAR_REQUIRED"
        )
          setNeedsRefresh(true);
      }
    } finally {
      if (current === generation.current) {
        busyRef.current = false;
        setBusy(false);
      }
    }
  };
  const reloadAvatar = async () => {
    if (busyRef.current) return;
    const current = generation.current;
    busyRef.current = true;
    setBusy(true);
    setError("");
    try {
      const refreshed = await refreshAvatar();
      if (current !== generation.current) return;
      if (!refreshed?.thumbnailUrl || refreshed.requiresThumbnailRefresh)
        throw new Error("아바타를 저장한 뒤 다시 보내 주세요.");
      setSnapshot(refreshed);
      setNeedsRefresh(false);
      pending.current = null;
    } catch (failure) {
      if (current === generation.current) setError(errorText(failure));
    } finally {
      if (current === generation.current) {
        busyRef.current = false;
        setBusy(false);
      }
    }
  };
  if (!enabled && !open) return null;
  const submitted = state?.participated === true;
  const receipt = state?.submission;
  const image = submitted ? receipt?.thumbnailUrl : snapshot.thumbnailUrl;
  return (
    <div className="avatar-event-entry">
      <button
        ref={opener}
        type="button"
        disabled={!readyForSubmission || submitted}
        onClick={() => {
          setSnapshot(avatar);
          setOpen(true);
          void load();
        }}
      >
        {submitted ? "아바타 접수 완료" : "내 아바타 보내기"}
      </button>
      {!readyForSubmission && !submitted && (
        <p>아바타를 저장한 뒤 보내주세요.</p>
      )}
      <dialog
        ref={dialog}
        className="avatar-event-dialog"
        aria-labelledby="avatar-event-title"
        onCancel={(event) => {
          event.preventDefault();
          close();
        }}
        onClick={(event) => {
          if (event.target === event.currentTarget) close();
        }}
      >
        <div className="avatar-event-dialog-heading">
          <h3 id="avatar-event-title">내 아바타 보내기</h3>
          <button
            type="button"
            disabled={busy}
            onClick={close}
            aria-label="아바타 보내기 닫기"
          >
            닫기
          </button>
        </div>
        <div className="avatar-event-dialog-body">
          {loading ? (
            <p role="status">접수 상태를 확인하는 중입니다.</p>
          ) : (
            <>
              {image && (
                <img
                  className="avatar-event-image"
                  src={image}
                  alt={submitted ? "접수한 아바타" : "보낼 아바타"}
                />
              )}
              {submitted ? (
                <div className="avatar-event-receipt" role="status">
                  <strong>
                    {receipt?.rewardedAt
                      ? `${receipt.rewardWis.toLocaleString("ko-KR")}위스 지급 완료`
                      : "아바타를 접수했습니다"}
                  </strong>
                  {receipt?.description && <p>{receipt.description}</p>}
                  <p>
                    {receipt?.rewardedAt
                      ? "이벤트 참여가 완료되었습니다."
                      : "교사가 확인한 뒤 보상을 지급합니다. 추가 접수는 할 수 없습니다."}
                  </p>
                </div>
              ) : state ? (
                <>
                  <label className="avatar-event-description">
                    내 아바타 소개
                    <textarea
                      value={description}
                      maxLength={300}
                      rows={3}
                      disabled={busy || !enabled || !state.enabled}
                      onChange={(event) => setDescription(event.target.value)}
                      placeholder="아바타의 이름이나 마음에 드는 스타일을 소개해 주세요."
                    />
                  </label>
                  <p className="avatar-event-conditions">
                    1인 1회 · 교사 확인 후{" "}
                    {availability.avatarEventRewardWis.toLocaleString("ko-KR")}
                    위스 지급
                  </p>
                  {(!enabled || !state.enabled) && (
                    <p role="status">지금은 이벤트 접수를 받지 않습니다.</p>
                  )}
                </>
              ) : null}
            </>
          )}
          {error && (
            <p role="alert" className="avatar-studio-error">
              {error}
            </p>
          )}
        </div>
        <div className="avatar-event-dialog-actions">
          {!state && !loading && (
            <button type="button" onClick={() => void load()}>
              다시 불러오기
            </button>
          )}
          {!submitted &&
            state &&
            (needsRefresh ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => void reloadAvatar()}
              >
                {busy ? "불러오는 중…" : "아바타 다시 불러오기"}
              </button>
            ) : (
              <button
                type="button"
                className="avatar-primary"
                disabled={
                  busy ||
                  loading ||
                  !enabled ||
                  !state.enabled ||
                  !description.trim()
                }
                onClick={() => void submit()}
              >
                {busy ? "보내는 중…" : "공부의 神문고로 보내기"}
              </button>
            ))}
          {submitted && (
            <button type="button" onClick={close}>
              확인
            </button>
          )}
        </div>
      </dialog>
    </div>
  );
}
