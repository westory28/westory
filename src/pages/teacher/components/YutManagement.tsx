import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useAuth } from "../../../contexts/AuthContext";
import {
  canReadLessonManagement,
  canWriteLessonManagement,
} from "../../../lib/permissions";
import {
  commandYutRoom,
  getYutManagement,
  saveYutSettings,
  yutErrorMessage,
  type YutManagedRoom,
  type YutManagement,
  type YutSettings,
} from "../../../lib/yut";
import { useAppDialog } from "../../../components/common/AppDialogProvider";
import PortalWorkspace from "../../../components/common/PortalWorkspace";
import YutGameEntry from "../../../components/common/weplay/YutGameEntry";
import { prepareWeplayIntroAudio } from "../../../components/common/weplay/weplayIntroAudio";
import "../../../components/common/portalPage.css";
import "./YutManagement.css";

const timeLabel = (value: number) =>
  new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(value);
type Draft = YutSettings & { savedEnabled: boolean };
const toDraft = (settings: YutSettings): Draft => ({
  ...settings,
  savedEnabled: settings.enabled,
});

export default function YutManagement() {
  const { config, currentUser, userData } = useAuth();
  const { confirm } = useAppDialog();
  const [params] = useSearchParams();
  const view = params.get("view");
  const canRead =
    !!currentUser && canReadLessonManagement(userData, currentUser.email);
  const canWrite =
    !!currentUser && canWriteLessonManagement(userData, currentUser.email);
  const scope = `${currentUser?.uid}/${config?.year}/${config?.semester}/${canRead}/${canWrite}`;
  const scopeRef = useRef(scope);
  scopeRef.current = scope;
  const viewRef = useRef(view);
  viewRef.current = view;
  const generation = useRef(0);
  const lifecycle = useRef(0);
  const savingRef = useRef(false);
  const inFlight = useRef(false);
  const [data, setData] = useState<YutManagement | null>(null);
  const [loadedScope, setLoadedScope] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [closing, setClosing] = useState("");
  const [readError, setReadError] = useState("");
  const [saveError, setSaveError] = useState("");
  const [conflict, setConflict] = useState(false);
  const [feedback, setFeedback] = useState("");
  const current = loadedScope === scope ? data : null;
  const dirty = !!draft && draft.enabled !== draft.savedEnabled;

  const load = useCallback(
    async (resetDraft = false) => {
      if (
        !canRead ||
        !currentUser ||
        !config?.year ||
        !config?.semester ||
        inFlight.current ||
        savingRef.current
      )
        return;
      const token = ++generation.current;
      inFlight.current = true;
      setRefreshing(true);
      try {
        const response = await getYutManagement(config);
        if (token !== generation.current || scopeRef.current !== scope) return;
        setData(response);
        setLoadedScope(scope);
        setReadError("");
        setDraft((previous) =>
          resetDraft || !previous || previous.enabled === previous.savedEnabled
            ? toDraft(response.settings)
            : previous,
        );
        if (resetDraft) {
          setConflict(false);
          setSaveError("");
        }
      } catch (error) {
        if (token === generation.current && scopeRef.current === scope)
          setReadError(yutErrorMessage(error));
      } finally {
        if (token === generation.current && scopeRef.current === scope) {
          inFlight.current = false;
          setRefreshing(false);
        }
      }
    },
    [scope, canRead, currentUser?.uid, config?.year, config?.semester],
  );

  useEffect(() => {
    lifecycle.current++;
    setData(null);
    setDraft(null);
    setLoadedScope("");
    setReadError("");
    setSaveError("");
    setFeedback("");
    setConflict(false);
    setClosing("");
    setSaving(false);
    inFlight.current = false;
    savingRef.current = false;
    void load();
    const refresh = () => {
      if (
        !document.hidden &&
        !["preview", "online"].includes(viewRef.current || "")
      )
        void load();
    };
    const interval = window.setInterval(refresh, 15000);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      lifecycle.current++;
      generation.current++;
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [load]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (
      !canWrite ||
      !draft ||
      !dirty ||
      !current ||
      savingRef.current ||
      conflict
    )
      return;
    const requestedScope = scope;
    savingRef.current = true;
    const token = ++generation.current;
    inFlight.current = false;
    setRefreshing(false);
    setSaving(true);
    setSaveError("");
    setFeedback("");
    try {
      const response = await saveYutSettings(config, {
        enabled: draft.enabled,
        expectedVersion: draft.version,
      });
      if (scopeRef.current !== requestedScope || generation.current !== token)
        return;
      setData((previous) =>
        previous
          ? {
              ...previous,
              settings: response.settings,
            }
          : previous,
      );
      setDraft(toDraft(response.settings));
      setFeedback(
        response.settings.enabled
          ? "학생 공개로 저장했습니다."
          : "학생 비공개로 저장했습니다.",
      );
    } catch (error) {
      if (scopeRef.current === requestedScope && generation.current === token) {
        const changed = String(
          (error as { code?: string })?.code || "",
        ).includes("aborted");
        setConflict(changed);
        setSaveError(
          changed
            ? "다른 곳에서 공개 설정이 바뀌었습니다. 최신 설정을 불러온 뒤 다시 확인해 주세요."
            : yutErrorMessage(error),
        );
      }
    } finally {
      if (scopeRef.current === requestedScope && generation.current === token) {
        savingRef.current = false;
        setSaving(false);
      }
    }
  };
  const closeRoom = async (room: YutManagedRoom) => {
    if (!canWrite || closing || !current || savingRef.current) return;
    const requestedScope = scope;
    const confirmationToken = lifecycle.current;
    const accepted = await confirm({
      title: `${room.code} 방을 닫을까요?`,
      message: "참여 중인 학생의 게임이 종료됩니다.",
      confirmLabel: "방 닫기",
      tone: "danger",
    });
    if (
      !accepted ||
      scopeRef.current !== requestedScope ||
      lifecycle.current !== confirmationToken ||
      savingRef.current
    )
      return;
    savingRef.current = true;
    const token = ++generation.current;
    inFlight.current = false;
    setRefreshing(false);
    setClosing(room.id);
    setSaveError("");
    setFeedback("");
    try {
      await commandYutRoom(config, {
        action: "close",
        roomId: room.id,
        expectedRevision: room.revision,
        requestKey: crypto.randomUUID(),
      });
      if (scopeRef.current !== requestedScope || generation.current !== token)
        return;
      setData((previous) =>
        previous
          ? {
              ...previous,
              rooms: previous.rooms.filter((item) => item.id !== room.id),
            }
          : previous,
      );
      setFeedback(`${room.code} 방을 닫았습니다.`);
    } catch (error) {
      if (scopeRef.current === requestedScope && generation.current === token) {
        setSaveError(yutErrorMessage(error));
      }
    } finally {
      if (scopeRef.current === requestedScope && generation.current === token) {
        savingRef.current = false;
        setClosing("");
        void load();
      }
    }
  };

  if (!canRead)
    return (
      <main className="ws-page">
        <p role="alert">위플레이 관리 화면을 볼 권한이 없습니다.</p>
      </main>
    );
  if (view === "preview" || view === "online")
    return <YutGameEntry key={`${scope}/${view}`} portal="teacher" />;
  return (
    <PortalWorkspace as="main" className="ws-page yut-management">
      <Link className="weplay-catalog-back" to="/teacher/weplay">
        전체 게임
      </Link>
      <header className="ws-page-header">
        <h1>마우저구 윷놀이</h1>
        <div className="yut-management-actions">
          <Link
            className="yut-management-button"
            to="/teacher/weplay?game=joseon-yut&view=preview"
            onClick={(event) => {
              if (
                !event.ctrlKey &&
                !event.metaKey &&
                !event.shiftKey &&
                !event.altKey
              )
                prepareWeplayIntroAudio();
            }}
          >
            체험하기
          </Link>
          <Link
            className="yut-management-button"
            to="/teacher/weplay?game=joseon-yut&view=online"
            onClick={(event) => {
              if (
                !event.ctrlKey &&
                !event.metaKey &&
                !event.shiftKey &&
                !event.altKey
              )
                prepareWeplayIntroAudio();
            }}
          >
            온라인 대기방
          </Link>
        </div>
      </header>
      {readError && (
        <p className="yut-management-error" role="alert">
          {readError}
        </p>
      )}
      {!current || !draft ? (
        <>
          {!readError && <p role="status">관리 정보를 불러오고 있습니다.</p>}
          <button
            className="yut-management-button"
            disabled={refreshing}
            onClick={() => void load()}
          >
            다시 불러오기
          </button>
        </>
      ) : (
        <>
          {!canWrite && (
            <p className="yut-management-muted">
              읽기 전용입니다. 공개 설정과 방 상태를 변경할 수 없습니다.
            </p>
          )}
          <form
            className="yut-management-settings ws-surface"
            onSubmit={(event) => void save(event)}
          >
            <div className="yut-management-row">
              <h2>학생 공개</h2>
              <strong>{current.settings.enabled ? "공개" : "비공개"}</strong>
            </div>
            <div className="yut-management-row">
              <label className="yut-management-toggle">
                <input
                  type="checkbox"
                  checked={draft.enabled}
                  disabled={!canWrite || saving || conflict}
                  onChange={(event) => {
                    setDraft({ ...draft, enabled: event.target.checked });
                    setFeedback("");
                  }}
                />
                학생에게 공개
              </label>
              {canWrite && (
                <button
                  className="yut-management-button is-primary"
                  type="submit"
                  disabled={!dirty || saving || conflict || !!readError}
                >
                  {saving ? "저장 중…" : "공개 설정 저장"}
                </button>
              )}
            </div>
            <p className="yut-management-muted">
              비공개로 저장하면 학생의 싱글·온라인 게임 이용이 중단됩니다.
            </p>
            {dirty && <p role="status">저장하지 않은 변경 사항</p>}
            {conflict && (
              <button
                type="button"
                className="yut-management-button"
                disabled={refreshing}
                onClick={() => void load(true)}
              >
                최신 설정 불러오기
              </button>
            )}
          </form>
          {saveError && (
            <p className="yut-management-error" role="alert">
              {saveError}
            </p>
          )}
          {feedback && <p role="status">{feedback}</p>}
          <section
            className="yut-management-rooms"
            aria-labelledby="yut-monitor-title"
          >
            <div className="yut-management-row">
              <h2 id="yut-monitor-title">
                대기·진행 중인 방 {current.rooms.length}개
              </h2>
              <button
                className="yut-management-button"
                disabled={refreshing || saving}
                onClick={() => void load()}
              >
                {refreshing ? "확인 중…" : "새로고침"}
              </button>
            </div>
            <p className="yut-management-muted">
              마지막 확인 {timeLabel(current.serverNowMs)} · 화면이 열려 있을 때
              15초마다 갱신
            </p>
            {current.truncated && <p>최근 방 100개를 표시합니다.</p>}
            {current.rooms.length === 0 ? (
              <p>대기 중이거나 진행 중인 방이 없습니다.</p>
            ) : (
              <ul className="yut-management-room-list">
                {current.rooms.map((room) => (
                  <li className="ws-surface" key={room.id}>
                    <div className="yut-management-row">
                      <h3>{room.code}</h3>
                      <span>
                        {room.status === "playing" ? "진행 중" : "대기 중"}
                      </span>
                      {canWrite && (
                        <button
                          className="yut-management-button is-danger"
                          disabled={!!closing}
                          onClick={() => void closeRoom(room)}
                        >
                          {closing === room.id
                            ? "닫는 중…"
                            : `${room.code} 방 닫기`}
                        </button>
                      )}
                    </div>
                    <ul className="yut-management-players">
                      {room.players
                        .filter((player) => player.active)
                        .map((player) => (
                          <li key={player.uid}>
                            <strong>{player.name}</strong>
                            <span>
                              {[
                                player.classLabel,
                                player.studentNumber
                                  ? `${player.studentNumber}번`
                                  : "",
                              ]
                                .filter(Boolean)
                                .join(" · ")}
                            </span>
                            {room.turnUid === player.uid &&
                              room.status === "playing" && (
                                <span className="yut-management-turn">
                                  현재 차례
                                </span>
                              )}
                          </li>
                        ))}
                    </ul>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </PortalWorkspace>
  );
}
