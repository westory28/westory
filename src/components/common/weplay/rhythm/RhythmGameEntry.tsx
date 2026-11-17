import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../../../../contexts/AuthContext";
import {
  canReadLessonManagement,
  canWriteLessonManagement,
} from "../../../../lib/permissions";
import { saveRhythmPublication } from "../../../../lib/rhythmPublication";
import { useAppToast } from "../../AppToastProvider";
import { InlineLoading } from "../../LoadingState";
import { prepareWeplayIntroAudio } from "../weplayIntroAudio";
import useRhythmPublication from "./useRhythmPublication";
import RhythmOpening from "./RhythmOpening";
import RhythmChallengeSettings from "../RhythmChallengeSettings";
import WeplayWeeklyRewards from "../WeplayWeeklyRewards";
import "./rhythm.css";
import "../../portalPage.css";

export default function RhythmGameEntry({
  portal,
}: {
  portal: "student" | "teacher";
}) {
  const { config, currentUser, userData, authPhase } = useAuth();
  const publication = useRhythmPublication(portal);
  const { showToast } = useAppToast();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [preview, setPreview] = useState(false);
  const teacher = portal === "teacher";
  const scope = publication.scope;
  const scopeRef = useRef(scope);
  scopeRef.current = scope;
  const savingRef = useRef(false);
  const canRead =
    teacher &&
    authPhase === "ready" &&
    canReadLessonManagement(userData, currentUser?.email);
  const canWrite =
    teacher &&
    authPhase === "ready" &&
    canWriteLessonManagement(userData, currentUser?.email);
  const publish = async () => {
    if (
      !canWrite ||
      !config ||
      savingRef.current ||
      !["open", "closed"].includes(publication.status)
    )
      return;
    const startedScope = scope;
    const desired = publication.status !== "open";
    savingRef.current = true;
    setSaving(true);
    setError("");
    try {
      const saved = await saveRhythmPublication(
        config,
        desired,
        publication.revision,
      );
      if (startedScope === scopeRef.current) {
        publication.acceptSaved(saved);
        showToast({
          title: desired ? "학생에게 공개했습니다." : "학생 공개를 닫았습니다.",
          tone: "success",
        });
      }
    } catch {
      if (startedScope === scopeRef.current) {
        setError(
          "공개 설정을 저장하지 못했습니다. 현재 상태를 다시 확인한 뒤 시도해 주세요.",
        );
        publication.invalidate();
      }
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };
  if (teacher && !canRead)
    return <p role="alert">위플레이 관리 화면을 볼 권한이 없습니다.</p>;
  return (
    <div className="ws-page rhythm-entry" tabIndex={-1}>
      <Link className="weplay-catalog-back" to={`/${portal}/weplay`}>
        ← 전체 게임
      </Link>
      <div className="ws-page-header rhythm-entry-heading">
        <h1 tabIndex={-1}>덩기덕 쿵더Rock</h1>
      </div>
      {teacher && (
        <div className="rhythm-publication">
          <strong>
            {publication.status === "open"
              ? "학생 공개 중"
              : publication.status === "closed"
                ? "학생 비공개"
                : publication.status === "error"
                  ? "공개 상태 확인 실패"
                  : "공개 상태 확인 중"}
          </strong>
          {canWrite && (
            <button
              type="button"
              disabled={
                saving || !["open", "closed"].includes(publication.status)
              }
              onClick={() => void publish()}
            >
              {saving
                ? "저장 중…"
                : publication.status === "open"
                  ? "학생 공개 닫기"
                  : "학생에게 공개"}
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              if (!preview) prepareWeplayIntroAudio();
              setPreview(!preview);
            }}
            aria-pressed={preview}
          >
            {preview ? "미리보기 닫기" : "미리보기"}
          </button>
        </div>
      )}
      {publication.status === "error" && (
        <p role="alert">
          {error || "게임을 확인하지 못했습니다."}{" "}
          <button
            type="button"
            className="rhythm-entry-retry"
            onClick={() => {
              setError("");
              publication.retry();
            }}
          >
            다시 확인
          </button>
        </p>
      )}
      {!teacher && publication.status === "checking" && <InlineLoading />}
      {!teacher && publication.status === "closed" && (
        <p role="status">지금은 이용할 수 없는 게임입니다.</p>
      )}
      {((teacher && preview) ||
        (!teacher && publication.status === "open")) && (
        <RhythmOpening
          key={`${portal}/${scope}`}
          preview={teacher}
          playable={teacher || publication.status === "open"}
        />
      )}
      {teacher && !preview && (
        <>
          <RhythmChallengeSettings />
          <WeplayWeeklyRewards gameId="gungdeok-rock" />
        </>
      )}
    </div>
  );
}
