import { useEffect, useRef, useState, type FormEvent } from "react";
import { doc, runTransaction, serverTimestamp } from "firebase/firestore";
import { sanitizeMenuConfig } from "../../../constants/menus";
import { useAuth } from "../../../contexts/AuthContext";
import { auth, db } from "../../../lib/firebase";
import { notifyMenuConfigUpdated } from "../../../lib/appEvents";
import { isDeveloperUser } from "../../../lib/permissions";
import { invalidateSiteSettingDocCache } from "../../../lib/siteSettings";
import {
  getWeplayGameTitle,
  setWeplayGameTitle,
} from "../../../lib/weplayTitle";

export default function WeplayTitleEditor({ title }: { title: string }) {
  const { currentUser } = useAuth();
  const canEdit = isDeveloperUser(currentUser?.email);
  const [draft, setDraft] = useState(title);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [feedback, setFeedback] = useState("");
  const mounted = useRef(true);
  useEffect(() => {
    setDraft(title);
  }, [title]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    const nextTitle = draft.trim();
    if (!currentUser || !canEdit || saving || nextTitle === title) return;
    if (!nextTitle) {
      setError("게임 이름을 입력해 주세요.");
      return;
    }
    const requestedUser = currentUser;
    setSaving(true);
    setError("");
    setFeedback("");
    try {
      const reference = doc(db, "site_settings", "menu_config");
      await runTransaction(db, async (transaction) => {
        const snapshot = await transaction.get(reference);
        if (auth.currentUser?.uid !== requestedUser.uid)
          throw new Error("로그인 상태가 바뀌었습니다. 다시 로그인해 주세요.");
        const menus = sanitizeMenuConfig(snapshot.data());
        if (getWeplayGameTitle(menus) !== title)
          throw new Error(
            "다른 곳에서 게임 이름이 바뀌었습니다. 새로고침 후 다시 수정해 주세요.",
          );
        transaction.set(
          reference,
          {
            student: setWeplayGameTitle(menus, nextTitle).student,
            updatedAt: serverTimestamp(),
          },
          { merge: true },
        );
      });
      invalidateSiteSettingDocCache("menu_config");
      notifyMenuConfigUpdated();
      if (mounted.current && auth.currentUser?.uid === requestedUser.uid)
        setFeedback("게임 이름을 저장했습니다.");
    } catch (caught) {
      if (mounted.current && auth.currentUser?.uid === requestedUser.uid)
        setError(
          caught instanceof Error && !("code" in caught)
            ? caught.message
            : "게임 이름을 저장하지 못했습니다. 다시 시도해 주세요.",
        );
    } finally {
      if (mounted.current) setSaving(false);
    }
  };

  return (
    <form className="teacher-weplay-name-editor" onSubmit={save}>
      <label htmlFor="weplay-game-title">게임 이름</label>
      <div className="teacher-weplay-name-controls">
        <input
          id="weplay-game-title"
          value={draft}
          onChange={(event) => {
            setDraft(event.target.value);
            setError("");
            setFeedback("");
          }}
          maxLength={60}
          required
          disabled={!canEdit || saving}
          aria-describedby={
            !canEdit
              ? "weplay-game-title-permission"
              : error
                ? "weplay-game-title-error"
                : undefined
          }
          aria-invalid={!!error}
        />
        {canEdit && (
          <button
            className="teacher-weplay-button"
            type="submit"
            disabled={saving || !draft.trim() || draft.trim() === title}
          >
            {saving ? "저장 중…" : "이름 저장"}
          </button>
        )}
      </div>
      {!canEdit && (
        <p id="weplay-game-title-permission" className="teacher-weplay-note">
          게임 이름은 메뉴 설정 권한이 있는 관리자 교사가 변경할 수 있습니다.
        </p>
      )}
      {error && (
        <p
          id="weplay-game-title-error"
          className="teacher-weplay-error"
          role="alert"
        >
          {error}
        </p>
      )}
      {feedback && (
        <p className="teacher-weplay-note" role="status">
          {feedback}
        </p>
      )}
    </form>
  );
}
