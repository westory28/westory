import React, { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "../../../../contexts/AuthContext";
import {
  commandYutRoom,
  getYutLobby,
  subscribeYutRoom,
  yutErrorMessage,
  type YutCommand,
  type YutLobby,
  type YutMove,
  type YutRoom,
} from "../../../../lib/yut";
import { getLegalYutMoves } from "../../../../../functions/yutCore.mjs";
import {
  advanceYutPreviewBot,
  createYutPreview,
  previewYutCommand,
  YUT_PREVIEW_UID,
} from "../../../../lib/yutPreview";
import type useYutMusic from "../useYutMusic";
import { PROFESSIONS, YutSprite, YutIcon } from "./YutArt";
import YutBoard, { yutNodeLabel } from "./YutBoard";
import YutThrow3D from "./YutThrow3D";
import "@fontsource/noto-serif-kr/600.css";
import "./yut.css";

function GameDialog({
  kind,
  onClose,
  onConfirm,
}: {
  kind: "rules" | "leave";
  onClose: () => void;
  onConfirm: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const node = ref.current;
    node?.showModal();
    return () => node?.close();
  }, []);
  return (
    <dialog
      className="yut-dialog"
      ref={ref}
      onCancel={onClose}
      aria-labelledby="yut-dialog-title"
    >
      <div className="yut-dialog-top">
        <h2 id="yut-dialog-title">
          {kind === "rules" ? "윷판의 약속" : "이 판에서 나갈까요?"}
        </h2>
        <button
          type="button"
          className="yut-plain"
          aria-label="닫기"
          onClick={onClose}
        >
          ×
        </button>
      </div>
      {kind === "rules" ? (
        <>
          <ol className="yut-rules">
            <li>두 말을 모두 한 바퀴 돌려 완주하면 이깁니다.</li>
            <li>
              도·개·걸·윷·모는 각각 1·2·3·4·5칸입니다. 먼저 말을 옮긴 뒤 다음
              윷을 던집니다.
            </li>
            <li>윷·모가 나오거나 다른 사람의 말을 잡으면 한 번 더 던집니다.</li>
            <li>
              같은 편의 말이 만나면 업고 함께 이동합니다. 모서리와 가운데에서는
              길을 고를 수 있습니다.
            </li>
            <li>
              한 차례는 60초입니다. 시간이 지나면 다음 차례로 넘길 수 있습니다.
              이번 판에는 빽도가 없습니다.
            </li>
          </ol>
          <p className="yut-rule-note">
            사·농·공·상은 조선 사회의 직업 구분에서 가져왔습니다. 네 인물의
            능력은 같습니다.
          </p>
          <button
            type="button"
            className="yut-button yut-button--primary"
            onClick={onClose}
          >
            알겠습니다
          </button>
        </>
      ) : (
        <>
          <p>진행 중인 판에서 나가면 내 말이 제외됩니다.</p>
          <div className="yut-dialog-actions">
            <button className="yut-button" type="button" onClick={onClose}>
              계속하기
            </button>
            <button
              className="yut-button yut-button--danger"
              type="button"
              onClick={onConfirm}
            >
              방 나가기
            </button>
          </div>
        </>
      )}
    </dialog>
  );
}

const requestKey = () => crypto.randomUUID();
export default function YutGame({
  portal,
  preview = false,
  onBack,
  music,
}: {
  portal: "student" | "teacher";
  preview?: boolean;
  onBack: () => void;
  music: ReturnType<typeof useYutMusic>;
}) {
  const { config, currentUser } = useAuth();
  const [local, setLocal] = useState(preview);
  const [room, setRoom] = useState<YutRoom | null>(null);
  const [lobby, setLobby] = useState<YutLobby | null>(null);
  const [loading, setLoading] = useState(!preview);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [pending, setPending] = useState("");
  const [disconnected, setDisconnected] = useState(false);
  const [needsSync, setNeedsSync] = useState(false);
  const [retry, setRetry] = useState(0);
  const [classId, setClassId] = useState("");
  const [code, setCode] = useState("");
  const [selectedPiece, setSelectedPiece] = useState("1");
  const [dialog, setDialog] = useState<"rules" | "leave" | null>(null);
  const [clock, setClock] = useState(Date.now());
  const [serverOffset, setServerOffset] = useState(0);
  const [toss, setToss] = useState<{
    key: string;
    sticks: boolean[];
    room: YutRoom;
  } | null>(null);
  const [settledThrow, setSettledThrow] = useState<string | null>(null);
  const generation = useRef(0);
  const pendingRef = useRef(false);
  const mounted = useRef(true);
  const uid = local ? YUT_PREVIEW_UID : currentUser?.uid || "";
  const identity = `${currentUser?.uid || ""}:${config?.year || ""}:${config?.semester || ""}:${local}`;
  const identityRef = useRef(identity);
  identityRef.current = identity;
  const roomRef = useRef(room);
  roomRef.current = room;
  const currentToss = toss?.room.id === room?.id ? toss : null;
  const retainedThrow =
    currentToss &&
    room?.pendingThrow &&
    currentToss.room.turnUid === room.turnUid &&
    currentToss.room.turnDeadlineMs === room.turnDeadlineMs &&
    currentToss.sticks.every(
      (value, index) => value === room.pendingThrow?.sticks[index],
    );
  const throwKey = room?.pendingThrow
    ? room.lastEvent.kind === "throw"
      ? `${room.id}:${room.turnUid}:${room.lastEvent.atMs}`
      : retainedThrow
        ? currentToss.key
        : `${room.id}:${room.turnUid}:${room.turnDeadlineMs}:${room.pendingThrow.sticks.join("")}`
    : null;
  const settling = Boolean(
    (throwKey && throwKey !== settledThrow) ||
    (currentToss && currentToss.key !== settledThrow),
  );
  const settlingRef = useRef(settling);
  settlingRef.current = settling;
  useEffect(() => {
    if (throwKey && room?.pendingThrow)
      setToss({ key: throwKey, sticks: room.pendingThrow.sticks, room });
  }, [throwKey]);
  useEffect(() => {
    if (!room || room.status === "waiting" || room.status === "closed") {
      setToss(null);
      setSettledThrow(null);
    }
  }, [room?.id, room?.status]);
  const acceptRoom = useCallback((next: YutRoom | null) => {
    setRoom((previous) =>
      previous &&
      next &&
      previous.id === next.id &&
      previous.revision > next.revision
        ? previous
        : next,
    );
  }, []);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      generation.current++;
    };
  }, []);
  useEffect(() => {
    const run = ++generation.current;
    pendingRef.current = false;
    setPending("");
    setError("");
    setNote("");
    setDisconnected(false);
    setRoom(null);
    setLobby(null);
    setToss(null);
    setSettledThrow(null);
    if (local) {
      setRoom(createYutPreview());
      setNeedsSync(false);
      setLoading(false);
      return;
    }
    if (!currentUser || !config?.year || !config?.semester) {
      setLoading(false);
      setError("로그인과 현재 학기 정보를 확인해 주세요.");
      return;
    }
    setLoading(true);
    void getYutLobby(config)
      .then((data) => {
        if (!mounted.current || generation.current !== run) return;
        setLobby(data);
        setClassId(data.classId || data.classes[0]?.id || "");
        setServerOffset(data.serverNowMs - Date.now());
        setClock(Date.now());
        setNeedsSync(false);
        acceptRoom(data.room);
      })
      .catch((failure) => {
        if (mounted.current && generation.current === run)
          setError(yutErrorMessage(failure));
      })
      .finally(() => {
        if (mounted.current && generation.current === run) setLoading(false);
      });
    return () => {
      generation.current++;
    };
    // Scope changes invalidate every pending response and room subscription.
  }, [identity, retry, acceptRoom]);

  useEffect(() => {
    if (local || !room?.id || !uid || !config) return;
    const scope = identity,
      id = room.id;
    let active = true;
    return (() => {
      const unsubscribe = subscribeYutRoom(
        config,
        id,
        (next) => {
          if (
            !active ||
            identityRef.current !== scope ||
            roomRef.current?.id !== id
          )
            return;
          if (
            next &&
            next.status !== "closed" &&
            next.participantUids.includes(uid)
          ) {
            acceptRoom(next);
            setDisconnected(false);
          } else {
            roomRef.current = null;
            acceptRoom(null);
            setNote("방이 닫혔습니다. 새 판을 열 수 있습니다.");
          }
        },
        (failure) => {
          if (
            active &&
            identityRef.current === scope &&
            roomRef.current?.id === id
          ) {
            setDisconnected(true);
            setError(yutErrorMessage(failure));
          }
        },
      );
      return () => {
        active = false;
        unsubscribe();
      };
    })();
  }, [
    room?.id,
    identity,
    local,
    uid,
    config?.year,
    config?.semester,
    acceptRoom,
  ]);

  useEffect(() => {
    if (room?.status !== "playing") return;
    const timer = window.setInterval(() => setClock(Date.now()), 500);
    return () => window.clearInterval(timer);
  }, [room?.status]);
  useEffect(() => {
    if (
      !local ||
      room?.status !== "playing" ||
      room.turnUid === uid ||
      settling
    )
      return;
    const timer = window.setTimeout(
      () => {
        const current = roomRef.current;
        if (!current || settlingRef.current) return;
        try {
          const next = advanceYutPreviewBot(current);
          roomRef.current = next;
          setRoom(next);
        } catch (failure) {
          setError(yutErrorMessage(failure));
        }
      },
      room.phase === "throw" ? 850 : 1100,
    );
    return () => window.clearTimeout(timer);
  }, [local, room, uid, settling]);

  const command = async (
    action: YutCommand["action"],
    extra: Partial<YutCommand> = {},
  ) => {
    if (pendingRef.current || disconnected || needsSync || loading) return;
    if ((action === "throw" || action === "move") && settlingRef.current)
      return;
    music.start();
    setError("");
    setNote("");
    if (local) {
      try {
        if (action === "leave" || action === "close") {
          if (preview) onBack();
          else setLocal(false);
          return;
        }
        if (roomRef.current) {
          const next = previewYutCommand(roomRef.current, { action, ...extra });
          roomRef.current = next;
          setRoom(next);
          setClock(Date.now());
        }
      } catch (failure) {
        setError(yutErrorMessage(failure));
      }
      return;
    }
    const scope = identityRef.current,
      run = generation.current;
    const oldRoomId = room?.id;
    pendingRef.current = true;
    setPending(action);
    try {
      const result = await commandYutRoom(config, {
        action,
        requestKey: requestKey(),
        ...(room ? { roomId: room.id, expectedRevision: room.revision } : {}),
        ...extra,
      });
      if (
        !mounted.current ||
        identityRef.current !== scope ||
        generation.current !== run
      )
        return;
      if (oldRoomId && roomRef.current && roomRef.current.id !== oldRoomId)
        return;
      setServerOffset(result.serverNowMs - Date.now());
      setClock(Date.now());
      setDisconnected(false);
      setError("");
      if (action === "leave" || action === "close") roomRef.current = null;
      acceptRoom(action === "leave" || action === "close" ? null : result.room);
    } catch (failure) {
      if (
        mounted.current &&
        identityRef.current === scope &&
        generation.current === run
      ) {
        setError(yutErrorMessage(failure));
        setNeedsSync(true);
      }
    } finally {
      if (
        mounted.current &&
        identityRef.current === scope &&
        generation.current === run
      ) {
        pendingRef.current = false;
        setPending("");
      }
    }
  };
  const player = room?.players.find((item) => item.uid === uid);
  const turn = room?.players.find((item) => item.uid === room.turnUid);
  const winner = room?.players.find((item) => item.uid === room.winnerUid);
  const myTurn = room?.turnUid === uid;
  const moves = room ? getLegalYutMoves(room, uid) : [];
  const seconds = room
    ? Math.max(
        0,
        Math.ceil(
          (room.turnDeadlineMs - clock - (local ? 0 : serverOffset)) / 1000,
        ),
      )
    : 0;
  const busy = Boolean(pending) || disconnected || needsSync || loading;
  const displayRoom =
    settling && currentToss && (!throwKey || currentToss.key === throwKey)
      ? currentToss.room
      : room;
  const resultVisible = !settling && pending !== "throw";
  const displayTurn = displayRoom?.players.find(
    (item) => item.uid === displayRoom.turnUid,
  );
  const primaryAction =
    room?.status === "finished"
      ? "again"
      : seconds === 0
        ? "skip"
        : myTurn && room?.phase === "throw"
          ? "throw"
          : null;
  const completeToss = useCallback(() => {
    if (toss) setSettledThrow(toss.key);
  }, [toss]);
  useEffect(() => {
    if (moves.length && !moves.some((move) => move.pieceId === selectedPiece))
      setSelectedPiece(moves[0].pieceId);
  }, [room?.revision, uid, selectedPiece]);
  const movePiece = (move: YutMove) =>
    void command("move", { pieceId: move.pieceId, route: move.route });
  const beginPreview = () => {
    music.start();
    setLocal(true);
  };
  const back = () => {
    if (room) setDialog("leave");
    else onBack();
  };

  return (
    <section
      className={`yut-game ${room ? "yut-game--in-room" : ""}`}
      aria-label="사농공상 윷놀이"
    >
      <div className="yut-topbar">
        <span className="yut-topbar-brand">
          WESTORY <b>·</b> WEPLAY
        </span>
        <div className="yut-topbar-actions">
          <button
            type="button"
            className="yut-icon-button"
            aria-label="게임 규칙 보기"
            title="게임 규칙"
            onClick={() => setDialog("rules")}
          >
            <YutIcon name="info" />
          </button>
          <button
            type="button"
            className="yut-icon-button"
            aria-label={room ? "방 나가기" : "전체 게임"}
            title={room ? "방 나가기" : "전체 게임"}
            onClick={back}
            disabled={Boolean(pending)}
          >
            <YutIcon name="back" />
          </button>
          <button
            type="button"
            className="yut-icon-button"
            aria-label={
              music.failed
                ? "음악 재시도"
                : music.enabled
                  ? "음악 끄기"
                  : "음악 켜기"
            }
            title={
              music.failed
                ? "음악 재시도"
                : music.enabled
                  ? "음악 끄기"
                  : "음악 켜기"
            }
            aria-pressed={music.enabled}
            onClick={music.toggle}
          >
            <YutIcon name={music.enabled ? "sound" : "muted"} />
          </button>
        </div>
      </div>
      {(error || note || disconnected || needsSync) && (
        <div
          className={`yut-message ${error || disconnected || needsSync ? "is-error" : ""}`}
          role={error || disconnected || needsSync ? "alert" : "status"}
        >
          <span>{error || note || "방 상태를 다시 확인해 주세요."}</span>
          {!local && (error || disconnected || needsSync) && (
            <button
              type="button"
              className="yut-button"
              onClick={() => setRetry((value) => value + 1)}
              disabled={Boolean(pending) || loading}
            >
              방 상태 다시 확인
            </button>
          )}
          {!disconnected && !needsSync && (
            <button
              type="button"
              className="yut-icon-button"
              aria-label="알림 닫기"
              onClick={() => {
                setError("");
                setNote("");
              }}
            >
              ×
            </button>
          )}
        </div>
      )}
      {!room ? (
        <div className="yut-entry">
          <div className="yut-entry-scene" aria-hidden="true" />
          <div className="yut-entry-title">
            <span className="yut-title-ornament" aria-hidden="true">
              四 民 遊 戱
            </span>
            <h1>
              사농공상<span>윷놀이</span>
            </h1>
            <div className="yut-title-rule" aria-hidden="true">
              <i />
              <span>윷</span>
              <i />
            </div>
          </div>
          <div className="yut-entry-menu">
            {loading ? (
              <p className="yut-loading" role="status">
                윷판을 준비하고 있습니다.
              </p>
            ) : (
              <>
                {portal === "teacher" && (
                  <label className="yut-label">
                    함께할 학급
                    <select
                      value={classId}
                      onChange={(event) => setClassId(event.target.value)}
                      disabled={busy}
                    >
                      {!lobby?.classes.length && (
                        <option value="">학급 없음</option>
                      )}
                      {lobby?.classes.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.label}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <button
                  type="button"
                  className="yut-button yut-button--primary yut-wide"
                  disabled={
                    busy || !lobby || (portal === "teacher" && !classId)
                  }
                  onClick={() => void command("create", { classId })}
                >
                  {pending === "create" ? "방을 여는 중…" : "새로운 판 만들기"}
                  <YutIcon name="arrow" />
                </button>
                <form
                  className="yut-join"
                  onSubmit={(event) => {
                    event.preventDefault();
                    if (code.trim())
                      void command("join", { code: code.trim().toUpperCase() });
                  }}
                >
                  <label className="yut-label" htmlFor="yut-room-code">
                    친구의 방 코드
                  </label>
                  <div>
                    <input
                      id="yut-room-code"
                      value={code}
                      onChange={(event) =>
                        setCode(
                          event.target.value
                            .replace(/[^a-zA-Z0-9]/g, "")
                            .slice(0, 6)
                            .toUpperCase(),
                        )
                      }
                      placeholder="6자리 코드"
                      autoComplete="off"
                      spellCheck={false}
                      maxLength={6}
                      disabled={busy}
                    />
                    <button
                      className="yut-button"
                      type="submit"
                      disabled={busy || !lobby || code.length !== 6}
                    >
                      {pending === "join" ? "입장 중" : "들어가기"}
                    </button>
                  </div>
                </form>
              </>
            )}
            <button
              type="button"
              className="yut-practice"
              onClick={beginPreview}
              disabled={busy}
            >
              {portal === "teacher" ? "대기실부터 체험하기" : "혼자 연습하기"}
              <YutIcon name="arrow" />
            </button>
            <p className="yut-entry-meta">
              2–4인 <span>·</span> 위스 변동 없음
            </p>
          </div>
        </div>
      ) : room.status === "waiting" ? (
        <div className="yut-waiting">
          <div className="yut-waiting-heading">
            <div>
              <span className="yut-eyebrow">
                {local ? "체험 · 기록 미반영" : room.classLabel}
              </span>
              <h1>한 판의 인연</h1>
            </div>
            <div className="yut-room-code">
              {local ? (
                <span>컴퓨터와 연습</span>
              ) : (
                <>
                  <span>방 코드</span>
                  <strong>{room.code}</strong>
                  <button
                    type="button"
                    className="yut-icon-button"
                    aria-label="방 코드 복사"
                    title="방 코드 복사"
                    onClick={() => {
                      void navigator.clipboard?.writeText(room.code).then(
                        () => setNote("방 코드를 복사했습니다."),
                        () => setNote(`방 코드: ${room.code}`),
                      );
                    }}
                  >
                    <YutIcon name="copy" />
                  </button>
                </>
              )}
            </div>
          </div>
          <div className="yut-waiting-seats">
            {[0, 1, 2, 3].map((index) => {
              const person = room.players[index];
              return (
                <div
                  key={index}
                  className={`yut-seat ${person ? "is-filled" : ""}`}
                >
                  {person ? (
                    <>
                      <span className="yut-seat-job">
                        {PROFESSIONS[person.role].name}
                        <small>{PROFESSIONS[person.role].job}</small>
                      </span>
                      <YutSprite role={person.role} />
                      <strong>
                        {person.name}
                        {person.uid === uid && person.name !== "나" && (
                          <span className="yut-me">나</span>
                        )}
                      </strong>
                      <span
                        className={`yut-seat-status ${person.ready ? "is-ready" : ""}`}
                      >
                        {person.uid === room.hostUid
                          ? "방장"
                          : person.ready
                            ? "준비 완료"
                            : "준비 중"}
                      </span>
                    </>
                  ) : (
                    <>
                      <div className="yut-empty-seat" aria-hidden="true">
                        —
                      </div>
                      <span>기다리는 자리</span>
                    </>
                  )}
                </div>
              );
            })}
          </div>
          <div className="yut-waiting-footer">
            <span>{room.players.length}/4명</span>
            {room.hostUid === uid ? (
              <button
                className="yut-button yut-button--primary"
                type="button"
                onClick={() => void command("start")}
                disabled={
                  busy ||
                  room.players.length < 2 ||
                  room.players.some((person) => !person.ready)
                }
              >
                {pending === "start" ? "시작하는 중…" : "윷판 펼치기"}
                <YutIcon name="arrow" />
              </button>
            ) : (
              <button
                className={`yut-button ${player?.ready ? "" : "yut-button--primary"}`}
                type="button"
                disabled={busy}
                onClick={() => void command("ready", { ready: !player?.ready })}
              >
                {player?.ready ? "준비 취소" : "준비 완료"}
              </button>
            )}
          </div>
        </div>
      ) : (
        <div className="yut-match">
          <div className="yut-match-heading">
            <div>
              <h1>사농공상</h1>
              <span className="yut-eyebrow">
                {local
                  ? "체험 · 기록 미반영"
                  : `${room.classLabel} · ${room.code}`}
              </span>
            </div>
            <div className="yut-turn-state">
              {room.status === "finished" && !settling ? (
                <span>판 종료</span>
              ) : (
                <>
                  <span aria-live="polite">
                    {displayRoom?.turnUid === uid
                      ? "내 차례"
                      : `${displayTurn?.name || "친구"}의 차례`}
                  </span>
                  <strong className={seconds <= 10 ? "is-low" : ""}>
                    {seconds}
                    <small>초</small>
                  </strong>
                </>
              )}
            </div>
          </div>
          <div className="yut-players">
            {(displayRoom || room).players.map((person) => (
              <div
                className={`yut-player ${displayRoom?.turnUid === person.uid ? "is-turn" : ""} ${!person.active ? "is-left" : ""}`}
                key={person.uid}
              >
                <YutSprite role={person.role} />
                <div>
                  <strong title={person.name}>
                    {person.name}
                    {person.uid === uid && person.name !== "나" && (
                      <span className="yut-me">나</span>
                    )}
                  </strong>
                  <span>
                    {PROFESSIONS[person.role].job} <b>·</b>{" "}
                    {person.active
                      ? `${person.pieces.filter((piece) => piece.node === "finish").length}/2`
                      : "퇴장"}
                  </span>
                </div>
              </div>
            ))}
          </div>
          <div className="yut-match-stage">
            <YutBoard
              room={displayRoom || room}
              uid={uid}
              selectedPiece={selectedPiece}
              onSelectPiece={setSelectedPiece}
              moves={moves}
              onMove={movePiece}
              disabled={busy || settling || seconds === 0}
              revealMoves={resultVisible}
            >
              {room.status !== "finished" || settling ? (
                <YutThrow3D
                  throwKey={currentToss?.key || null}
                  sticks={currentToss?.sticks || null}
                  rolling={pending === "throw"}
                  onComplete={completeToss}
                />
              ) : (
                <div className="yut-finish" role="status">
                  {winner && <YutSprite role={winner.role} />}
                  <span>이번 판의 승자</span>
                  <h2>{winner?.name || "참가자"}</h2>
                </div>
              )}
            </YutBoard>
            <div className="yut-action-dock">
              <div className="yut-throw-result" role="status">
                {settling || pending === "throw" ? (
                  <span>윷을 던지는 중</span>
                ) : room.pendingThrow ? (
                  <>
                    <strong>{room.pendingThrow.label}</strong>
                    <span>
                      {room.pendingThrow.value}칸
                      {room.pendingThrow.value >= 4 && " · 한 번 더"}
                    </span>
                  </>
                ) : room.status === "finished" ? (
                  <span>한 판, 잘 놀았습니다.</span>
                ) : !myTurn ? (
                  <span>{turn?.name || "친구"} 님의 차례</span>
                ) : null}
              </div>
              {primaryAction === "again" && !settling ? (
                <button
                  className="yut-button yut-button--primary"
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    local ? setRoom(createYutPreview()) : void command("leave")
                  }
                >
                  새 판 준비하기
                  <YutIcon name="arrow" />
                </button>
              ) : primaryAction === "skip" ? (
                <button
                  type="button"
                  className="yut-button yut-button--primary"
                  disabled={busy}
                  onClick={() => void command("skip")}
                >
                  다음 차례로 넘기기
                </button>
              ) : primaryAction === "throw" ? (
                <button
                  className="yut-button yut-button--primary yut-throw-button"
                  type="button"
                  disabled={busy || settling}
                  onClick={() => void command("throw")}
                >
                  {pending === "throw" ? "윷을 던지는 중…" : "윷 던지기"}
                  <YutIcon name="arrow" />
                </button>
              ) : myTurn && room.phase === "move" && resultVisible ? (
                <div
                  className="yut-home-tray"
                  role="group"
                  aria-label="출발 전 말 선택"
                >
                  {player?.pieces
                    .filter((piece) => piece.node === "home")
                    .map((piece) => (
                      <button
                        type="button"
                        className={`yut-home-piece ${selectedPiece === piece.id ? "is-selected" : ""}`}
                        key={piece.id}
                        disabled={busy}
                        aria-pressed={selectedPiece === piece.id}
                        aria-label={`말 ${piece.id}, 출발 전, 선택`}
                        onClick={() => setSelectedPiece(piece.id)}
                      >
                        <YutSprite role={player.role} />
                        <span>말 {piece.id}</span>
                      </button>
                    ))}
                  <span className="yut-move-hint">
                    윷판의 목적지를 선택하세요
                  </span>
                </div>
              ) : null}
            </div>
          </div>
          <div className="yut-event" aria-live="polite">
            {resultVisible && room.lastEvent.kind !== "throw"
              ? room.lastEvent.text
              : ""}
          </div>
        </div>
      )}
      {dialog && (
        <GameDialog
          kind={dialog}
          onClose={() => setDialog(null)}
          onConfirm={() => {
            setDialog(null);
            void command("leave");
          }}
        />
      )}
    </section>
  );
}
