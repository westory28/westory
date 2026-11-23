import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useAuth } from "../../../contexts/AuthContext";
import {
  canReadLessonManagement,
  canWriteLessonManagement,
} from "../../../lib/permissions";
import { saveRhythmPublication } from "../../../lib/rhythmPublication";
import PortalWorkspace from "../../../components/common/PortalWorkspace";
import { useAppToast } from "../../../components/common/AppToastProvider";
import { InlineLoading } from "../../../components/common/LoadingState";
import useRhythmPublication from "../../../components/common/weplay/rhythm/useRhythmPublication";
import RhythmOpening from "../../../components/common/weplay/rhythm/RhythmOpening";
import { RhythmCover } from "../../../components/common/weplay/rhythm/RhythmArt";
import RhythmChallengeSettings from "../../../components/common/weplay/RhythmChallengeSettings";
import WeplayWeeklyRewards from "../../../components/common/weplay/WeplayWeeklyRewards";
import { prepareWeplayIntroAudio } from "../../../components/common/weplay/weplayIntroAudio";
import useWeplayMusic from "../../../components/common/weplay/useWeplayMusic";
import WeplayMusicButton from "../../../components/common/weplay/WeplayMusicButton";
import "./YutManagement.css";
import "../../../components/common/weplay/rhythm/rhythm.css";
import "./points/WeplayPolicyPanel.css";

export default function RhythmManagement() {
  const { config, currentUser, userData, authPhase } = useAuth();
  const publication = useRhythmPublication("teacher");
  const { showToast } = useAppToast();
  const [params, setParams] = useSearchParams();
  const preview = params.get("view") === "preview";
  const music = useWeplayMusic(false);
  const [draft, setDraft] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [policyOpen, setPolicyOpen] = useState(false);
  const scopeRef = useRef(publication.scope);
  scopeRef.current = publication.scope;
  const savingRef = useRef(false);
  const canRead =
    authPhase === "ready" &&
    canReadLessonManagement(userData, currentUser?.email);
  const canWrite =
    authPhase === "ready" &&
    canWriteLessonManagement(userData, currentUser?.email);
  const ready =
    publication.status === "open" || publication.status === "closed";
  const dirty = ready && draft !== publication.enabled;

  useEffect(() => {
    setDraft(publication.enabled);
    setError("");
    setSaving(false);
    savingRef.current = false;
  }, [publication.scope, publication.revision, publication.enabled]);

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canWrite || !config || !ready || !dirty || savingRef.current) return;
    const scope = publication.scope;
    const desired = draft;
    savingRef.current = true;
    setSaving(true);
    setError("");
    try {
      const result = await saveRhythmPublication(
        config,
        desired,
        publication.revision,
      );
      if (scopeRef.current !== scope) return;
      publication.acceptSaved(result);
      showToast({
        title: desired ? "학생에게 공개했습니다." : "학생 공개를 닫았습니다.",
        tone: "success",
      });
    } catch {
      if (scopeRef.current === scope) {
        setError(
          "공개 설정을 저장하지 못했습니다. 현재 상태를 다시 확인한 뒤 시도해 주세요.",
        );
        publication.invalidate();
      }
    } finally {
      if (scopeRef.current === scope) {
        savingRef.current = false;
        setSaving(false);
      }
    }
  };

  if (!canRead)
    return <p role="alert">위플레이 관리 화면을 볼 권한이 없습니다.</p>;
  return (
    <PortalWorkspace
      as="main"
      className="ws-page yut-management rhythm-management rhythm-entry"
      tabIndex={-1}
    >
      <header className="weplay-heading">
        <h1 tabIndex={-1}>덩기덕 쿵더Rock</h1>
        <div className="weplay-game-navigation">
          <Link className="weplay-catalog-back" to="/teacher/weplay">
            전체 게임
          </Link>
          {preview && (
            <Link
              className="yut-management-button"
              to="/teacher/weplay?game=gungdeok-rock"
            >
              게임 관리
            </Link>
          )}
          {!preview && <WeplayMusicButton {...music} />}
        </div>
      </header>
      {preview ? (
        <RhythmOpening key={publication.scope} preview playable />
      ) : (
        <>
          {!canWrite && (
            <p className="yut-management-muted">
              읽기 전용입니다. 게임 체험은 이용할 수 있습니다.
            </p>
          )}
          <div className="yut-management-layout">
            <form
              className="yut-management-settings ws-surface"
              onSubmit={(event) => void save(event)}
              aria-labelledby="rhythm-management-title"
            >
              <div className="yut-management-row yut-management-section-heading">
                <h2 id="rhythm-management-title">게임 운영</h2>
                <div className="yut-management-actions">
                  {ready && (
                    <span className="yut-management-muted" role="status">
                      {dirty ? "저장하지 않은 변경 사항" : "저장된 설정과 동일"}
                    </span>
                  )}
                  {canWrite && (
                    <button
                      className="yut-management-button is-primary"
                      type="submit"
                      disabled={!dirty || saving}
                    >
                      {saving ? "저장 중…" : "게임 설정 저장"}
                    </button>
                  )}
                </div>
              </div>
              <div className="yut-management-publication">
                <label className="yut-management-toggle">
                  <input
                    type="checkbox"
                    checked={draft}
                    disabled={!canWrite || !ready || saving}
                    onChange={(event) => setDraft(event.target.checked)}
                  />
                  학생에게 공개
                </label>
                {ready ? (
                  <span>
                    현재{" "}
                    <strong>{publication.enabled ? "공개" : "비공개"}</strong>
                  </span>
                ) : publication.status === "checking" ? (
                  <InlineLoading />
                ) : null}
              </div>
              {publication.status === "error" && (
                <p className="yut-management-error" role="alert">
                  {error || "공개 상태를 확인하지 못했습니다."}{" "}
                  <button
                    className="yut-management-button"
                    type="button"
                    onClick={() => {
                      setError("");
                      publication.retry();
                    }}
                  >
                    다시 확인
                  </button>
                </p>
              )}
            </form>
            <section
              className="yut-management-preview ws-surface"
              aria-labelledby="rhythm-preview-title"
            >
              <h2 id="rhythm-preview-title">교사 체험</h2>
              <div className="teacher-weplay-preview-cover">
                <RhythmCover />
              </div>
              <div className="yut-management-preview-actions">
                <button
                  className="yut-management-button is-primary"
                  type="button"
                  disabled={saving}
                  onClick={() => {
                    prepareWeplayIntroAudio();
                    setParams({ game: "gungdeok-rock", view: "preview" });
                  }}
                >
                  체험하기
                </button>
              </div>
              <p className="yut-management-muted">
                위스·랭킹·학생 기록에 반영되지 않습니다.
              </p>
            </section>
          </div>
          <WeplayWeeklyRewards gameId="gungdeok-rock" />
          <details
            className="weplay-policy"
            onToggle={(event) => setPolicyOpen(event.currentTarget.open)}
          >
            <summary
              className="weplay-policy__header"
              aria-expanded={policyOpen}
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                aria-hidden="true"
                className="weplay-policy__chevron"
              >
                <path d="m6 3 5 5-5 5" />
              </svg>
              <span className="weplay-policy__title">주간 도전 설정</span>
            </summary>
            {policyOpen && <RhythmChallengeSettings />}
          </details>
        </>
      )}
    </PortalWorkspace>
  );
}
