import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../../../../contexts/AuthContext";
import {
  canReadLessonManagement,
  canWriteLessonManagement,
} from "../../../../lib/permissions";
import {
  confirmRhythmPublication,
  saveRhythmPublication,
} from "../../../../lib/rhythmPublication";
import { useAppToast } from "../../AppToastProvider";
import { InlineLoading } from "../../LoadingState";
import useRhythmPublication from "./useRhythmPublication";
import RhythmGame from "./RhythmGame";
import "./rhythm.css";
import "../../portalPage.css";

export default function RhythmGameEntry({
  portal,
}: {
  portal: "student" | "teacher";
}) {
  const { config, currentUser, userData, authGeneration } = useAuth();
  const publication = useRhythmPublication(portal);
  const { showToast } = useAppToast();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [preview, setPreview] = useState(false);
  const teacher = portal === "teacher";
  const scope = `${currentUser?.uid}/${authGeneration}/${config?.year}/${config?.semester}`;
  const scopeRef = useRef(scope);
  scopeRef.current = scope;
  const savingRef = useRef(false);
  const verifiedScope = useRef("");
  if (publication.status === "open") verifiedScope.current = scope;
  if (publication.status === "closed") verifiedScope.current = "";
  const canRead =
    teacher && canReadLessonManagement(userData, currentUser?.email);
  const canWrite =
    teacher && canWriteLessonManagement(userData, currentUser?.email);
  const beforePlay = async () => {
    if (!config || publication.status !== "open") return false;
    const requestScope = scope;
    try {
      const allowed = await confirmRhythmPublication(config);
      if (!allowed) publication.retry();
      return allowed && scopeRef.current === requestScope;
    } catch (failure) {
      publication.retry();
      throw failure;
    }
  };
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
      await saveRhythmPublication(config, desired, publication.revision);
      if (startedScope === scopeRef.current)
        showToast({
          title: desired ? "학생에게 공개했습니다." : "학생 공개를 닫았습니다.",
          tone: "success",
        });
    } catch {
      if (startedScope === scopeRef.current) {
        setError(
          "공개 설정을 저장하지 못했습니다. 현재 상태를 다시 확인한 뒤 시도해 주세요.",
        );
        publication.retry();
      }
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };
  if (teacher && !canRead)
    return <p role="alert">위플레이 관리 화면을 볼 권한이 없습니다.</p>;
  return (
    <div className="ws-page rhythm-entry">
      <Link className="weplay-catalog-back" to={`/${portal}/weplay`}>
        ← 전체 게임
      </Link>
      <div className="ws-page-header rhythm-entry-heading">
        <h1>덩기덕 쿵더Rock</h1>
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
            onClick={() => setPreview(!preview)}
            aria-pressed={preview}
          >
            {preview ? "미리보기 닫기" : "미리보기"}
          </button>
        </div>
      )}
      {error && <p role="alert">{error}</p>}
      {publication.status === "error" && (
        <p role="alert">
          게임을 확인하지 못했습니다.{" "}
          <button
            type="button"
            className="rhythm-entry-retry"
            onClick={publication.retry}
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
        (!teacher && verifiedScope.current === scope)) && (
        <RhythmGame
          key={`${portal}/${scope}`}
          preview={teacher}
          playable={teacher || publication.status === "open"}
          beforePlay={teacher ? undefined : beforePlay}
        />
      )}
      {teacher && !preview && (
        <p>1인 연습 · 4곡 · 위스 및 학생 기록 반영 없음</p>
      )}
    </div>
  );
}
