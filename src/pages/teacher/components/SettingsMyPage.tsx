import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useAuth } from "../../../contexts/AuthContext";
import { useAppToast } from "../../../components/common/AppToastProvider";
import {
  AvatarStudio,
  type AvatarStudioAdapter,
} from "../../../features/avatar/AvatarStudio";
import {
  avatarErrorMessage,
  getTeacherMyPage,
  saveTeacherAvatar,
  updateTeacherProfileIcon,
  type TeacherMyPageState,
} from "../../../features/avatar/service";
import "./teacherMyPage.css";

export default function SettingsMyPage() {
  const { user, userData, config, authGeneration } = useAuth();
  const { showToast } = useAppToast();
  const [data, setData] = useState<TeacherMyPageState | null>(null);
  const dataRef = useRef<TeacherMyPageState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedEmojiId, setSelectedEmojiId] = useState("");
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const generation = useRef(0);
  const [tab, setTab] = useState<"emoji" | "avatar">("emoji");
  const [avatarOpened, setAvatarOpened] = useState(false);
  const year = config?.year;
  const semester = config?.semester;

  const load = useCallback(async () => {
    const current = ++generation.current;
    setLoading(true);
    setError("");
    try {
      if (!user || !year || !semester)
        throw new Error("로그인과 학기를 확인해 주세요.");
      const result = await getTeacherMyPage({ year, semester });
      if (current !== generation.current) return;
      dataRef.current = result;
      setData(result);
      setSelectedEmojiId(result.profileEmojiId);
    } catch (failure) {
      if (current === generation.current) setError(avatarErrorMessage(failure));
    } finally {
      if (current === generation.current) setLoading(false);
    }
  }, [user?.uid, year, semester, authGeneration]);

  useEffect(() => {
    dataRef.current = null;
    setData(null);
    busyRef.current = false;
    setBusy(false);
    void load();
    return () => {
      generation.current++;
      dataRef.current = null;
    };
  }, [load]);

  const adapter = useMemo<AvatarStudioAdapter>(
    () => ({
      load: async () => {
        const current = dataRef.current;
        if (!current) throw new Error("마이페이지를 다시 열어 주세요.");
        return { avatar: current.avatar, balance: null };
      },
      purchase: async () => {
        throw new Error("교사 아바타는 구매 없이 사용할 수 있습니다.");
      },
      save: async (look, revision, thumbnail) => {
        if (!year || !semester) throw new Error("학기를 확인해 주세요.");
        const current = generation.current;
        const avatar = await saveTeacherAvatar(
          { year, semester },
          look,
          revision,
          thumbnail,
        );
        if (current === generation.current && dataRef.current) {
          dataRef.current = { ...dataRef.current, avatar };
          setData(dataRef.current);
        }
        return avatar;
      },
    }),
    [user?.uid, year, semester, authGeneration],
  );

  const saveEmoji = async () => {
    if (
      !data ||
      !year ||
      !semester ||
      busyRef.current ||
      selectedEmojiId === data.profileEmojiId
    )
      return;
    const selected = data.emojiRegistry.find(
      (entry) => entry.id === selectedEmojiId && entry.enabled !== false,
    );
    if (!selected) return;
    busyRef.current = true;
    setBusy(true);
    setError("");
    const current = generation.current;
    try {
      const result = await updateTeacherProfileIcon(
        { year, semester },
        selected.id,
      );
      if (current !== generation.current || !dataRef.current) return;
      dataRef.current = {
        ...dataRef.current,
        profileEmojiId: result.emojiId,
        profileIcon: result.profileIcon,
      };
      setData(dataRef.current);
      setSelectedEmojiId(result.emojiId);
      showToast({ title: "프로필 이모지를 저장했습니다", tone: "success" });
    } catch (failure) {
      if (current === generation.current) setError(avatarErrorMessage(failure));
    } finally {
      if (current === generation.current) {
        busyRef.current = false;
        setBusy(false);
      }
    }
  };

  if (loading)
    return (
      <div className="avatar-studio-status" role="status">
        마이페이지를 불러오는 중입니다.
      </div>
    );
  if (!data)
    return (
      <div className="avatar-studio-status" role="alert">
        <p>{error}</p>
        <button type="button" onClick={() => void load()}>
          다시 불러오기
        </button>
      </div>
    );
  const selected = data.emojiRegistry.find(
    (entry) => entry.id === selectedEmojiId,
  );

  return (
    <div className="teacher-my-page">
      <div className="ws-page-header">
        <h2>마이페이지</h2>
        <span className="teacher-my-page-name">
          {userData?.name || user?.displayName || "교사"}
        </span>
      </div>
      <nav className="ws-page-tabs" aria-label="마이페이지 보기">
        <button
          type="button"
          className={tab === "emoji" ? "is-active" : ""}
          aria-pressed={tab === "emoji"}
          onClick={() => setTab("emoji")}
        >
          프로필 이모지
        </button>
        <button
          type="button"
          className={tab === "avatar" ? "is-active" : ""}
          aria-pressed={tab === "avatar"}
          onClick={() => {
            setAvatarOpened(true);
            setTab("avatar");
          }}
        >
          아바타 꾸미기
        </button>
      </nav>
      <div hidden={tab !== "emoji"}>
        <section className="teacher-my-page-emoji" aria-label="프로필 이모지">
          <div className="teacher-my-page-emoji-heading">
            <div className="teacher-my-page-emoji-preview">
              <span aria-hidden="true">
                {selected?.emoji || data.profileIcon}
              </span>
              <strong>{selected?.label || "프로필 이모지"}</strong>
            </div>
            <button
              type="button"
              className="teacher-my-page-save"
              disabled={
                busy || !selected || selectedEmojiId === data.profileEmojiId
              }
              onClick={() => void saveEmoji()}
            >
              {busy ? "저장 중…" : "이모지 저장"}
            </button>
          </div>
          <div
            className="teacher-my-page-emoji-options"
            aria-label="이모지 선택"
          >
            {data.emojiRegistry
              .filter((entry) => entry.enabled !== false)
              .map((entry) => (
                <button
                  type="button"
                  key={entry.id}
                  aria-pressed={selectedEmojiId === entry.id}
                  disabled={busy}
                  onClick={() => setSelectedEmojiId(entry.id)}
                >
                  <span aria-hidden="true">{entry.emoji}</span>
                  <span>{entry.label}</span>
                </button>
              ))}
          </div>
          {error && (
            <p className="avatar-studio-error" role="alert">
              {error}
            </p>
          )}
        </section>
      </div>
      {avatarOpened && (
        <div hidden={tab !== "avatar"}>
          <AvatarStudio
            key={`${user?.uid}:${authGeneration}:${year}:${semester}`}
            adapter={adapter}
            access="teacher"
            active={tab === "avatar"}
          />
        </div>
      )}
    </div>
  );
}
