import { useAppToast } from "../../../components/common/AppToastProvider";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
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
  YUT_PRIVATE_DAILY_LIMIT,
  type YutManagedRoom,
  type YutManagement,
  type YutSettings,
} from "../../../lib/yut";
import { InfoHelp } from "../../../components/common/InfoHelp";
import { acquirePageScrollLock } from "../../../lib/pageScrollLock";
import PortalWorkspace from "../../../components/common/PortalWorkspace";
import YutGameEntry from "../../../components/common/weplay/YutGameEntry";
import YutSpectator from "./YutSpectator";
import WeplayMusicButton from "../../../components/common/weplay/WeplayMusicButton";
import {
  isWeplayAudioMuted,
  onWeplayAudioMutedChange,
  setWeplayAudioMuted,
} from "../../../components/common/weplay/weplayAudioPreference";
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
type DraftValues = Omit<
  YutSettings,
  "version" | "updatedAtMs" | "throwSeconds" | "moveSeconds"
> & { throwSeconds: string; moveSeconds: string };
type Draft = DraftValues & { version: number; saved: string };
const draftValues = (value: DraftValues): DraftValues => ({
  enabled: value.enabled,
  allowSolo: value.allowSolo,
  allowMultiplayer: value.allowMultiplayer,
  allowPrivateRooms: value.allowPrivateRooms,
  defaultPlayerCount: value.defaultPlayerCount,
  throwSeconds: value.throwSeconds,
  moveSeconds: value.moveSeconds,
});
const toDraft = (settings: YutSettings): Draft => {
  const values = draftValues({
    ...settings,
    throwSeconds: String(settings.throwSeconds),
    moveSeconds: String(settings.moveSeconds),
  });
  return {
    ...values,
    version: settings.version,
    saved: JSON.stringify(values),
  };
};
const isDirty = (draft: Draft) =>
  JSON.stringify(draftValues(draft)) !== draft.saved;
const secondsError = (
  value: string,
  label: string,
  minimum: number,
  maximum: number,
) =>
  /^\d+$/.test(value) && Number(value) >= minimum && Number(value) <= maximum
    ? ""
    : `${label}은 ${minimum}~${maximum}초의 정수로 입력해 주세요.`;

export default function YutManagement() {
  const { showToast } = useAppToast();
  const { config, currentUser, userData } = useAuth();
  const [params] = useSearchParams();
  const view = params.get("view");
  const muted = useSyncExternalStore(
    onWeplayAudioMutedChange,
    isWeplayAudioMuted,
  );
  const music = {
    enabled: !muted,
    failed: false,
    toggle: () => setWeplayAudioMuted(!isWeplayAudioMuted()),
  };
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
  const savingRef = useRef(false);
  const inFlight = useRef(false);
  const [data, setData] = useState<YutManagement | null>(null);
  const [serverOffsetMs, setServerOffsetMs] = useState(0);
  const [loadedScope, setLoadedScope] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [closing, setClosing] = useState("");
  const [monitorOpen, setMonitorOpen] = useState(false);
  const [spectating, setSpectating] = useState<{
    id: string;
    code: string;
  } | null>(null);
  const [pendingClose, setPendingClose] = useState("");
  const monitorRef = useRef<HTMLDialogElement>(null);
  const monitorCloseRef = useRef<HTMLButtonElement>(null);
  const spectatorBackRef = useRef<HTMLButtonElement>(null);
  const monitorOpenRef = useRef(false);
  monitorOpenRef.current = monitorOpen;
  const spectatingRef = useRef(false);
  spectatingRef.current = !!spectating;
  const [readError, setReadError] = useState("");
  const [saveError, setSaveError] = useState("");
  const [conflict, setConflict] = useState(false);
  const current = loadedScope === scope ? data : null;
  const dirty = !!draft && isDirty(draft);
  const throwError = draft
    ? secondsError(draft.throwSeconds, "윷 던지기 제한 시간", 3, 15)
    : "";
  const moveError = draft
    ? secondsError(draft.moveSeconds, "말 이동 제한 시간", 15, 60)
    : "";
  const validDraft: YutSettings | null =
    draft && !throwError && !moveError
      ? {
          ...draftValues(draft),
          version: draft.version,
          throwSeconds: Number(draft.throwSeconds),
          moveSeconds: Number(draft.moveSeconds),
        }
      : null;
  const disabled = !canWrite || saving || !!closing || conflict;
  const update = (patch: Partial<DraftValues>) => {
    setDraft((previous) => (previous ? { ...previous, ...patch } : previous));
  };

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
        setServerOffsetMs(
          Number.isFinite(response.serverNowMs)
            ? response.serverNowMs - Date.now()
            : 0,
        );
        setData(response);
        setLoadedScope(scope);
        setReadError("");
        setDraft((previous) =>
          resetDraft || !previous || !isDirty(previous)
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
    setData(null);
    setServerOffsetMs(0);
    setDraft(null);
    setLoadedScope("");
    setReadError("");
    setSaveError("");
    setConflict(false);
    setClosing("");
    setMonitorOpen(false);
    setSpectating(null);
    setPendingClose("");
    setSaving(false);
    inFlight.current = false;
    savingRef.current = false;
    void load();
    const refresh = () => {
      if (
        !document.hidden &&
        monitorOpenRef.current &&
        !spectatingRef.current &&
        !["preview", "online"].includes(viewRef.current || "")
      )
        void load();
    };
    const interval = window.setInterval(refresh, 15000);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      generation.current++;
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [load]);
  useEffect(() => {
    setSpectating(null);
    setPendingClose("");
    setMonitorOpen(false);
  }, [view]);
  const monitorVisible =
    monitorOpen && !!current && !["preview", "online"].includes(view || "");
  useEffect(() => {
    if (!monitorVisible) return;
    const dialog = monitorRef.current;
    if (!dialog) return;
    const opener = document.activeElement as HTMLElement | null;
    const releaseScrollLock = acquirePageScrollLock();
    dialog.showModal();
    void load();
    return () => {
      dialog.close();
      releaseScrollLock();
      opener?.focus();
    };
  }, [monitorVisible, load]);
  useEffect(() => {
    if (!monitorVisible) return;
    const body = monitorRef.current?.querySelector<HTMLElement>(
      ".yut-management-monitor-body",
    );
    if (body) body.scrollTop = 0;
    (spectating ? spectatorBackRef.current : monitorCloseRef.current)?.focus();
  }, [monitorVisible, spectating?.id]);
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
      !validDraft ||
      !dirty ||
      !current ||
      savingRef.current ||
      conflict ||
      !!readError
    )
      return;
    const requestedScope = scope;
    savingRef.current = true;
    const token = ++generation.current;
    inFlight.current = false;
    setRefreshing(false);
    setSaving(true);
    setSaveError("");
    try {
      const response = await saveYutSettings(config, {
        enabled: validDraft.enabled,
        allowSolo: validDraft.allowSolo,
        allowMultiplayer: validDraft.allowMultiplayer,
        allowPrivateRooms: validDraft.allowPrivateRooms,
        defaultPlayerCount: validDraft.defaultPlayerCount,
        throwSeconds: validDraft.throwSeconds,
        moveSeconds: validDraft.moveSeconds,
        expectedVersion: validDraft.version,
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
      showToast({
        tone: "success",
        title: "게임 설정 저장",
        message: "게임 설정을 저장했습니다.",
      });
    } catch (error) {
      if (scopeRef.current === requestedScope && generation.current === token) {
        const changed = String(
          (error as { code?: string })?.code || "",
        ).includes("aborted");
        setConflict(changed);
        const message = changed
          ? "다른 곳에서 게임 설정이 바뀌었습니다. 최신 설정을 불러온 뒤 다시 확인해 주세요."
          : yutErrorMessage(error);
        if (changed) setSaveError(message);
        showToast({
          tone: "error",
          title: "게임 설정 저장 실패",
          message: message,
        });
      }
    } finally {
      if (scopeRef.current === requestedScope && generation.current === token) {
        savingRef.current = false;
        setSaving(false);
      }
    }
  };
  const closeRoom = async (room: YutManagedRoom) => {
    if (
      !canWrite ||
      closing ||
      !current ||
      savingRef.current ||
      pendingClose !== room.id
    )
      return;
    const requestedScope = scope;
    setPendingClose("");
    savingRef.current = true;
    const token = ++generation.current;
    inFlight.current = false;
    setRefreshing(false);
    setClosing(room.id);
    setSaveError("");
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
      showToast({
        tone: "success",
        title: "방 닫기 완료",
        message: `${room.code} 방을 닫았습니다.`,
      });
    } catch (error) {
      if (scopeRef.current === requestedScope && generation.current === token) {
        showToast({
          tone: "error",
          title: "방 닫기 실패",
          message: yutErrorMessage(error),
        });
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
  if (current && ((view === "preview" && validDraft) || view === "online"))
    return (
      <YutGameEntry
        key={`${scope}/${view}`}
        portal="teacher"
        initialSettings={view === "preview" ? validDraft! : current.settings}
      />
    );
  return (
    <PortalWorkspace as="main" className="ws-page yut-management">
      <header className="weplay-heading">
        <h1>마우저구 윷놀이</h1>
        <div className="weplay-game-navigation">
          <Link className="weplay-catalog-back" to="/teacher/weplay">
            전체 게임
          </Link>
          <WeplayMusicButton {...music} />
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
          <div className="yut-management-layout">
            <form
              className="yut-management-settings ws-surface"
              noValidate
              onSubmit={(event) => void save(event)}
              aria-labelledby="yut-settings-title"
            >
              <div className="yut-management-row yut-management-section-heading">
                <h2 id="yut-settings-title">게임 운영</h2>
                <div className="yut-management-actions">
                  <span className="yut-management-muted" role="status">
                    {dirty ? "저장하지 않은 변경 사항" : "저장된 설정과 동일"}
                  </span>
                  {canWrite && (
                    <button
                      className="yut-management-button is-primary"
                      type="submit"
                      disabled={
                        !dirty || disabled || !validDraft || !!readError
                      }
                    >
                      {saving ? "저장 중…" : "게임 설정 저장"}
                    </button>
                  )}
                </div>
              </div>
              <div className="yut-management-publication">
                <div className="yut-management-actions">
                  <label className="yut-management-toggle">
                    <input
                      type="checkbox"
                      checked={draft.enabled}
                      disabled={disabled}
                      onChange={(event) =>
                        update({ enabled: event.target.checked })
                      }
                    />
                    학생에게 공개
                  </label>
                  <InfoHelp label="학생 공개 안내">
                    비공개로 저장하면 학생의 싱글·온라인 게임 이용이 중단됩니다.
                  </InfoHelp>
                </div>
                <span>
                  현재{" "}
                  <strong>
                    {current.settings.enabled ? "공개" : "비공개"}
                  </strong>
                </span>
              </div>
              <fieldset className="yut-management-options" disabled={disabled}>
                <legend>플레이 방식</legend>
                <div className="yut-management-mode-options">
                  <label className="yut-management-toggle">
                    <input
                      type="checkbox"
                      checked={draft.allowSolo}
                      onChange={(event) =>
                        update({ allowSolo: event.target.checked })
                      }
                    />
                    싱글 플레이 허용
                  </label>
                  <label className="yut-management-toggle">
                    <input
                      type="checkbox"
                      checked={draft.allowMultiplayer}
                      onChange={(event) =>
                        update({ allowMultiplayer: event.target.checked })
                      }
                    />
                    멀티플레이 허용
                  </label>
                  <label className="yut-management-toggle">
                    <input
                      type="checkbox"
                      checked={draft.allowPrivateRooms}
                      disabled={!draft.allowMultiplayer}
                      onChange={(event) =>
                        update({ allowPrivateRooms: event.target.checked })
                      }
                    />
                    비공개 방 허용
                  </label>
                </div>
              </fieldset>
              <fieldset className="yut-management-options" disabled={disabled}>
                <legend>새 게임 설정</legend>
                <div className="yut-management-number-options">
                  <div className="yut-management-field">
                    <label htmlFor="yut-player-count">기본 인원</label>
                    <select
                      id="yut-player-count"
                      value={draft.defaultPlayerCount}
                      onChange={(event) =>
                        update({
                          defaultPlayerCount: Number(event.target.value) as
                            | 2
                            | 3
                            | 4,
                        })
                      }
                    >
                      {[2, 3, 4].map((count) => (
                        <option key={count} value={count}>
                          {count}명
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="yut-management-field">
                    <label htmlFor="yut-throw-seconds">
                      윷 던지기 제한 시간
                    </label>
                    <div className="yut-management-input-unit">
                      <input
                        id="yut-throw-seconds"
                        type="number"
                        min={3}
                        max={15}
                        step={1}
                        value={draft.throwSeconds}
                        aria-invalid={!!throwError}
                        aria-describedby={
                          throwError ? "yut-throw-error" : undefined
                        }
                        onChange={(event) =>
                          update({ throwSeconds: event.target.value })
                        }
                      />
                      <span aria-hidden="true">초</span>
                    </div>
                    {throwError && (
                      <p
                        id="yut-throw-error"
                        className="yut-management-field-error"
                        role="alert"
                      >
                        {throwError}
                      </p>
                    )}
                  </div>
                  <div className="yut-management-field">
                    <label htmlFor="yut-move-seconds">말 이동 제한 시간</label>
                    <div className="yut-management-input-unit">
                      <input
                        id="yut-move-seconds"
                        type="number"
                        min={15}
                        max={60}
                        step={1}
                        value={draft.moveSeconds}
                        aria-invalid={!!moveError}
                        aria-describedby={
                          moveError ? "yut-move-error" : undefined
                        }
                        onChange={(event) =>
                          update({ moveSeconds: event.target.value })
                        }
                      />
                      <span aria-hidden="true">초</span>
                    </div>
                    {moveError && (
                      <p
                        id="yut-move-error"
                        className="yut-management-field-error"
                        role="alert"
                      >
                        {moveError}
                      </p>
                    )}
                  </div>
                </div>
              </fieldset>
              <dl className="yut-management-fixed-rules">
                <div>
                  <dt>비공개 방 참여</dt>
                  <dd>학생 하루 {YUT_PRIVATE_DAILY_LIMIT}회</dd>
                </div>
                <div>
                  <dt>말 수</dt>
                  <dd>2개</dd>
                </div>
                <div>
                  <dt>위스 보상</dt>
                  <dd>위스 운영 정책에서 설정</dd>
                </div>
              </dl>
              {saveError && (
                <p className="yut-management-error" role="alert">
                  {saveError}
                </p>
              )}
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
            <section
              className="yut-management-preview ws-surface"
              aria-labelledby="yut-preview-title"
            >
              <h2 id="yut-preview-title">교사 체험</h2>
              <img
                src={`${import.meta.env.BASE_URL}assets/weplay/yut/catalog-toss.webp`}
                alt=""
                width={1448}
                height={1086}
              />
              <div className="yut-management-preview-actions">
                {validDraft && !saving ? (
                  <Link
                    className="yut-management-button is-primary"
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
                ) : (
                  <button
                    type="button"
                    className="yut-management-button is-primary"
                    disabled
                  >
                    체험하기
                  </button>
                )}
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
                <button
                  type="button"
                  className="yut-management-button"
                  aria-haspopup="dialog"
                  aria-expanded={monitorVisible}
                  onClick={() => setMonitorOpen(true)}
                >
                  플레이 모니터링
                </button>
              </div>
              {dirty && validDraft && (
                <p className="yut-management-muted">
                  저장 전 설정으로 체험합니다.
                </p>
              )}
            </section>
          </div>
          {monitorOpen && (
            <dialog
              ref={monitorRef}
              className={`yut-management-monitor${spectating ? " is-spectating" : ""}`}
              aria-labelledby="yut-monitor-dialog-title"
              onKeyDown={(event) => {
                if (event.key !== "Tab" || event.defaultPrevented) return;
                const controls = Array.from(
                  event.currentTarget.querySelectorAll<HTMLElement>(
                    "button, [href], input, select, textarea, [tabindex]",
                  ),
                ).filter(
                  (element) =>
                    element.tabIndex >= 0 &&
                    !element.matches(":disabled") &&
                    element.getClientRects().length > 0,
                );
                const first = controls[0];
                const last = controls[controls.length - 1];
                if (event.shiftKey && document.activeElement === first) {
                  event.preventDefault();
                  last?.focus();
                } else if (!event.shiftKey && document.activeElement === last) {
                  event.preventDefault();
                  first?.focus();
                }
              }}
              onCancel={(event) => {
                event.preventDefault();
                setMonitorOpen(false);
                setSpectating(null);
                setPendingClose("");
              }}
              onClick={(event) => {
                if (event.target !== event.currentTarget) return;
                const bounds = event.currentTarget.getBoundingClientRect();
                if (
                  event.clientX < bounds.left ||
                  event.clientX > bounds.right ||
                  event.clientY < bounds.top ||
                  event.clientY > bounds.bottom
                ) {
                  setMonitorOpen(false);
                  setSpectating(null);
                  setPendingClose("");
                }
              }}
            >
              <div className="yut-management-monitor-header yut-management-row">
                <div className="yut-management-monitor-heading">
                  <h2 id="yut-monitor-dialog-title">
                    {spectating
                      ? `${spectating.code} 관전`
                      : "학생 플레이 모니터링"}
                  </h2>
                  {spectating && (
                    <span className="yut-management-muted">읽기 전용</span>
                  )}
                </div>
                <div className="yut-management-actions">
                  {spectating && (
                    <button
                      ref={spectatorBackRef}
                      type="button"
                      className="yut-management-button"
                      onClick={() => {
                        setSpectating(null);
                        void load();
                      }}
                    >
                      목록으로
                    </button>
                  )}
                  <button
                    ref={monitorCloseRef}
                    type="button"
                    className="yut-management-button"
                    autoFocus
                    onClick={() => {
                      setMonitorOpen(false);
                      setSpectating(null);
                      setPendingClose("");
                    }}
                  >
                    모니터링 닫기
                  </button>
                </div>
              </div>
              <div
                className={`yut-management-monitor-body${spectating ? " is-spectating" : ""}`}
              >
                {spectating ? (
                  <YutSpectator
                    key={`${scope}/${spectating.id}`}
                    config={config}
                    roomId={spectating.id}
                    actorKey={scope}
                    serverOffsetMs={serverOffsetMs}
                  />
                ) : (
                  <>
                    <div className="yut-management-row">
                      <strong>
                        대기·진행 중인 방 {current.rooms.length}개
                      </strong>
                      <div className="yut-management-actions">
                        <span className="yut-management-muted">
                          마지막 확인 {timeLabel(current.serverNowMs)}
                        </span>
                        <InfoHelp label="방 현황 갱신 안내">
                          모니터링 창이 열려 있을 때 15초마다 갱신합니다.
                        </InfoHelp>
                        <button
                          className="yut-management-button"
                          disabled={refreshing || saving}
                          onClick={() => void load()}
                        >
                          {refreshing ? "확인 중…" : "새로고침"}
                        </button>
                      </div>
                    </div>
                    {readError && (
                      <p className="yut-management-error" role="alert">
                        {readError}
                      </p>
                    )}
                    {current.truncated && <p>최근 방 100개를 표시합니다.</p>}
                    {current.rooms.length === 0 ? (
                      <p>대기 중이거나 진행 중인 방이 없습니다.</p>
                    ) : (
                      <ul className="yut-management-room-list">
                        {current.rooms.map((room) => {
                          const leaders = room.players.filter(
                            (player) =>
                              player.active &&
                              room.leadingUids?.includes(player.uid),
                          );
                          return (
                            <li className="ws-surface" key={room.id}>
                              <div className="yut-management-row">
                                <div className="yut-management-room-heading">
                                  <h3>{room.code}</h3>
                                  <span>
                                    {room.visibility === "public"
                                      ? "공개 방"
                                      : "비공개 방"}
                                  </span>
                                  <span>
                                    {
                                      room.players.filter(
                                        (player) => player.active,
                                      ).length
                                    }
                                    /{room.maxPlayers || 4}명
                                  </span>
                                  <span>
                                    {room.status === "playing"
                                      ? "진행 중"
                                      : "대기 중"}
                                  </span>
                                </div>
                                <div className="yut-management-actions">
                                  <button
                                    type="button"
                                    className="yut-management-button"
                                    onClick={() => {
                                      setPendingClose("");
                                      setSpectating({
                                        id: room.id,
                                        code: room.code,
                                      });
                                    }}
                                  >
                                    {room.code} 관전
                                  </button>
                                  {canWrite && (
                                    <button
                                      className="yut-management-button is-danger"
                                      disabled={!!closing}
                                      onClick={() => setPendingClose(room.id)}
                                    >
                                      {closing === room.id
                                        ? "닫는 중…"
                                        : `${room.code} 방 닫기`}
                                    </button>
                                  )}
                                </div>
                              </div>
                              {room.status === "playing" &&
                                leaders.length > 0 && (
                                  <p className="yut-management-leader">
                                    <strong>
                                      {leaders.length > 1
                                        ? "공동 선두"
                                        : "선두"}
                                    </strong>
                                    <InfoHelp label="선두 기준">
                                      완주한 말 수가 우선이며, 같으면 남은 최단
                                      이동 거리의 합으로 비교합니다. 마지막 확인
                                      시각 기준입니다.
                                    </InfoHelp>{" "}
                                    {leaders
                                      .map((player) => player.name)
                                      .join(", ")}
                                  </p>
                                )}
                              {pendingClose === room.id && (
                                <div
                                  className="yut-management-close-confirm"
                                  role="group"
                                  aria-label={`${room.code} 방 닫기 확인`}
                                >
                                  <p>
                                    {room.code} 방을 닫으면 참여 중인 학생의
                                    게임이 종료됩니다.
                                  </p>
                                  <div className="yut-management-actions">
                                    <button
                                      type="button"
                                      className="yut-management-button"
                                      onClick={() => setPendingClose("")}
                                    >
                                      취소
                                    </button>
                                    <button
                                      type="button"
                                      className="yut-management-button is-danger"
                                      onClick={() => void closeRoom(room)}
                                    >
                                      방 닫기
                                    </button>
                                  </div>
                                </div>
                              )}
                              <ul className="yut-management-players">
                                {room.players
                                  .filter((player) => player.active)
                                  .map((player) => {
                                    const standing = room.standings?.find(
                                      (entry) => entry.uid === player.uid,
                                    );
                                    return (
                                      <li key={player.uid}>
                                        <strong>{player.name}</strong>
                                        <span>
                                          {[
                                            player.studentNumber
                                              ? `${player.studentNumber}번`
                                              : "",
                                          ]
                                            .filter(Boolean)
                                            .join(" · ")}
                                        </span>
                                        {room.status === "playing" &&
                                          standing && (
                                            <span className="yut-management-muted">
                                              완주 {standing.finishedPieces}/
                                              {standing.totalPieces}
                                            </span>
                                          )}
                                        {room.turnUid === player.uid &&
                                          room.status === "playing" && (
                                            <span className="yut-management-turn">
                                              현재 차례
                                            </span>
                                          )}
                                      </li>
                                    );
                                  })}
                              </ul>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </>
                )}
              </div>
            </dialog>
          )}
        </>
      )}
    </PortalWorkspace>
  );
}
