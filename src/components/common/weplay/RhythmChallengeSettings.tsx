import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "../../../contexts/AuthContext";
import {
  canReadLessonManagement,
  canWriteLessonManagement,
} from "../../../lib/permissions";
import {
  getRhythmChallengeState,
  saveRhythmChallengeSettings,
  type RhythmChallengeState,
} from "../../../lib/weplayRanking";
import { useAppToast } from "../AppToastProvider";
import { RHYTHM_SONGS } from "./rhythm/rhythmSongs";
import "./rhythm-challenge-settings.css";

export default function RhythmChallengeSettings() {
  const { config, currentUser, userData } = useAuth();
  const { showToast } = useAppToast();
  const canRead = canReadLessonManagement(userData, currentUser?.email);
  const canWrite = canWriteLessonManagement(userData, currentUser?.email);
  const scope = `${currentUser?.uid}/${config?.year}/${config?.semester}/${canRead}/${canWrite}`;
  const scopeRef = useRef(scope);
  scopeRef.current = scope;
  const generation = useRef(0);
  const savingRef = useRef(false);
  const requestRef = useRef<{ fingerprint: string; id: string }>();
  const [state, setState] = useState<RhythmChallengeState | null>(null);
  const [loadedScope, setLoadedScope] = useState("");
  const [selection, setSelection] = useState<"automatic" | "manual">(
    "automatic",
  );
  const [songId, setSongId] = useState(RHYTHM_SONGS[0].id);
  const [missLimit, setMissLimit] = useState("30");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const apply = (value: RhythmChallengeState, boundary = scope) => {
    setState(value);
    setLoadedScope(boundary);
    setSelection(value.selection);
    setSongId(value.songId);
    setMissLimit(String(value.missLimit));
  };
  const load = useCallback(async () => {
    if (!canRead || !config) return;
    const token = ++generation.current;
    const boundary = scope;
    setLoading(true);
    setError("");
    try {
      const response = await getRhythmChallengeState(config);
      if (token === generation.current && boundary === scopeRef.current) {
        apply(response, boundary);
        requestRef.current = undefined;
      }
    } catch (failure) {
      if (token === generation.current && boundary === scopeRef.current)
        setError(
          failure instanceof Error
            ? failure.message
            : "도전 설정을 불러오지 못했습니다.",
        );
    } finally {
      if (token === generation.current && boundary === scopeRef.current)
        setLoading(false);
    }
  }, [canRead, config, scope]);
  useEffect(() => {
    setState(null);
    void load();
    return () => {
      generation.current++;
    };
  }, [load]);
  const validLimit =
    /^\d+$/.test(missLimit) &&
    Number(missLimit) >= 1 &&
    Number(missLimit) <= 300;
  const dirty =
    loadedScope === scope &&
    !!state &&
    (state.selection !== selection ||
      state.missLimit !== Number(missLimit) ||
      (selection === "manual" && state.songId !== songId));
  const save = async () => {
    if (
      !state ||
      loadedScope !== scope ||
      !config ||
      !canWrite ||
      !dirty ||
      !validLimit ||
      savingRef.current
    )
      return;
    const boundary = scope;
    const data = {
      weekId: state.weekId,
      selection,
      songId,
      missLimit: Number(missLimit),
      expectedRevision: state.revision,
    };
    const fingerprint = JSON.stringify(data);
    if (requestRef.current?.fingerprint !== fingerprint)
      requestRef.current = { fingerprint, id: crypto.randomUUID() };
    savingRef.current = true;
    setSaving(true);
    setError("");
    try {
      const response = await saveRhythmChallengeSettings(config, {
        ...data,
        requestId: requestRef.current.id,
      });
      if (boundary !== scopeRef.current) return;
      apply({ ...state, ...response }, boundary);
      requestRef.current = undefined;
      showToast({ title: "도전 설정을 저장했습니다.", tone: "success" });
    } catch (failure) {
      if (boundary === scopeRef.current)
        setError(
          failure instanceof Error
            ? failure.message
            : "도전 설정을 저장하지 못했습니다.",
        );
    } finally {
      savingRef.current = false;
      if (boundary === scopeRef.current) setSaving(false);
    }
  };
  if (!canRead) return null;
  return (
    <section
      className="rhythm-challenge-settings"
      aria-labelledby="rhythm-challenge-settings-title"
      aria-busy={loading || saving}
    >
      <h2 id="rhythm-challenge-settings-title">주간 도전</h2>
      {state && loadedScope === scope && !loading && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <span className="rhythm-challenge-week">{state.weekId} 주차</span>
          <label>
            곡 배정
            <select
              value={selection}
              disabled={!canWrite || saving}
              onChange={(event) =>
                setSelection(event.target.value as "automatic" | "manual")
              }
            >
              <option value="automatic">매주 자동 교대</option>
              <option value="manual">이번 주 곡 지정</option>
            </select>
          </label>
          <label>
            이번 주 곡
            <select
              value={selection === "automatic" ? state.automaticSongId : songId}
              disabled={!canWrite || saving || selection === "automatic"}
              onChange={(event) => setSongId(event.target.value)}
            >
              {RHYTHM_SONGS.map((song) => (
                <option key={song.id} value={song.id}>
                  {song.title}
                </option>
              ))}
            </select>
          </label>
          <span className="rhythm-challenge-week">자진모리 · 휘모리</span>
          <label>
            아이쿠 종료 횟수
            <input
              type="number"
              min={1}
              max={300}
              step={1}
              value={missLimit}
              disabled={!canWrite || saving}
              onChange={(event) => setMissLimit(event.target.value)}
            />
          </label>
          <span className="rhythm-challenge-week">
            하루 무료 3회 · 추가 50위스
          </span>
          {canWrite && (
            <button type="submit" disabled={!dirty || !validLimit || saving}>
              {saving ? "저장 중…" : "도전 설정 저장"}
            </button>
          )}
        </form>
      )}
      {loading && <span role="status">도전 설정 확인 중…</span>}
      {!validLimit && state && (
        <p role="alert">아이쿠 종료 횟수는 1~300회로 입력해 주세요.</p>
      )}
      {error && (
        <p role="alert">
          {error}{" "}
          <button
            type="button"
            disabled={loading || saving}
            onClick={() => void load()}
          >
            다시 불러오기
          </button>
        </p>
      )}
    </section>
  );
}
