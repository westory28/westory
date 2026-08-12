import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SystemConfig } from "../types";
import type {
  CommandGatewayResponse,
  TeacherDraftCommandKey,
  W2CommandType,
} from "./commandGateway";
import { WestoryCommandError } from "./commandGateway";
import { W8DomainError } from "./w8Domains";
import {
  discardTeacherDraft,
  getTeacherOperationsState,
  hashTeacherOperationPayload,
  resolveTeacherDraft,
  saveTeacherDraft,
  TeacherOperationsError,
  type TeacherDraftRecord,
  type TeacherOperationsSource,
} from "./teacherOperations";

type JsonRecord = Record<string, unknown>;

export type TeacherDraftUiState =
  | "clean"
  | "dirty"
  | "saving"
  | "saved"
  | "offline"
  | "conflict"
  | "error"
  | "recoverable";

export interface TeacherDraftBinding<TPayload extends JsonRecord> {
  config?: Pick<SystemConfig, "year" | "semester"> | null;
  semesterId: string;
  manifestRevision: number;
  source: TeacherOperationsSource;
  enabled: boolean;
  key: TeacherDraftCommandKey;
  baseEntityRevision: number | null;
  basePayload: TPayload;
  payload: TPayload;
  intendedCommandType: W2CommandType;
  commandPayload: JsonRecord;
  onRecover: (payload: TPayload) => void;
  debounceMs?: number;
}

const payloadSignature = (value: JsonRecord) => {
  const normalize = (input: unknown): unknown => {
    if (Array.isArray(input)) return input.map(normalize);
    if (!input || typeof input !== "object") return input;
    const record = input as JsonRecord;
    return Object.keys(record)
      .sort()
      .reduce<JsonRecord>((result, key) => {
        result[key] = normalize(record[key]);
        return result;
      }, {});
  };
  return JSON.stringify(normalize(value));
};

const keySignature = (key: TeacherDraftCommandKey) =>
  [
    key.routeKey,
    key.surfaceKey,
    key.entityType,
    key.entityId,
    key.clientDraftId,
  ].join("\n");

export const useTeacherDraft = <TPayload extends JsonRecord>({
  config,
  semesterId,
  manifestRevision,
  source,
  enabled,
  key,
  baseEntityRevision,
  basePayload,
  payload,
  intendedCommandType,
  commandPayload,
  onRecover,
  debounceMs = 1200,
}: TeacherDraftBinding<TPayload>) => {
  const [uiState, setUiState] = useState<TeacherDraftUiState>("clean");
  const [draft, setDraft] = useState<TeacherDraftRecord | null>(null);
  const [recoveryDraft, setRecoveryDraft] = useState<TeacherDraftRecord | null>(
    null,
  );
  const [message, setMessage] = useState("");
  const [savedAt, setSavedAt] = useState("");
  const [baseHash, setBaseHash] = useState("");
  const [payloadHash, setPayloadHash] = useState("");
  const [commandPayloadHash, setCommandPayloadHash] = useState("");
  const [lastPersistedHash, setLastPersistedHash] = useState("");
  const saveSequenceRef = useRef(0);
  const mountedRef = useRef(true);

  const routeKey = key.routeKey;
  const surfaceKey = key.surfaceKey;
  const entityType = key.entityType;
  const entityId = key.entityId;

  const stableKey = useMemo(() => keySignature(key), [key]);
  const stableBasePayload = useMemo(
    () => payloadSignature(basePayload),
    [basePayload],
  );
  const stablePayload = useMemo(() => payloadSignature(payload), [payload]);
  const stableCommandPayload = useMemo(
    () => payloadSignature(commandPayload),
    [commandPayload],
  );
  const stableBaseObject = useMemo(
    () => JSON.parse(stableBasePayload) as TPayload,
    [stableBasePayload],
  );
  const stablePayloadObject = useMemo(
    () => JSON.parse(stablePayload) as TPayload,
    [stablePayload],
  );
  const stableCommandPayloadObject = useMemo(
    () => JSON.parse(stableCommandPayload) as JsonRecord,
    [stableCommandPayload],
  );

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      hashTeacherOperationPayload(stableBaseObject),
      hashTeacherOperationPayload(stablePayloadObject),
      hashTeacherOperationPayload(stableCommandPayloadObject),
    ]).then(([nextBaseHash, nextPayloadHash, nextCommandHash]) => {
      if (cancelled) return;
      setBaseHash(nextBaseHash);
      setPayloadHash(nextPayloadHash);
      setCommandPayloadHash(nextCommandHash);
    });
    return () => {
      cancelled = true;
    };
  }, [stableBaseObject, stableCommandPayloadObject, stablePayloadObject]);

  useEffect(() => {
    let cancelled = false;
    setDraft(null);
    setRecoveryDraft(null);
    setLastPersistedHash("");
    setMessage("");
    setUiState("clean");
    if (!enabled || source !== "CURRENT") return undefined;

    void getTeacherOperationsState({
      config,
      semesterId,
      source,
      includeTerminal: false,
    })
      .then((state) => {
        if (cancelled) return;
        const exactCandidate = state.drafts.find(
          (item) => keySignature(item.key) === stableKey,
        );
        const equivalentCandidates = state.drafts
          .filter(
            (item) =>
              item.key.routeKey === routeKey &&
              item.key.surfaceKey === surfaceKey &&
              item.key.entityType === entityType &&
              item.key.entityId === entityId,
          )
          .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
        const candidate = exactCandidate || equivalentCandidates[0] || null;
        if (!candidate) return;
        setDraft(candidate);
        setLastPersistedHash(candidate.payloadHash);
        if (candidate.status === "CONFLICT") {
          setRecoveryDraft(candidate);
          setUiState("conflict");
          setMessage(
            "다른 저장 내용과 기준 revision이 달라 자동으로 덮어쓰지 않았습니다.",
          );
          return;
        }
        setRecoveryDraft(candidate);
        setUiState("recoverable");
        setMessage("같은 계정으로 작성하던 임시 저장 내용이 있습니다.");
      })
      .catch((error) => {
        if (cancelled) return;
        const mapped =
          error instanceof TeacherOperationsError
            ? error
            : new TeacherOperationsError(
                "UNKNOWN",
                "임시 저장 내용을 확인하지 못했습니다.",
              );
        setUiState(mapped.kind === "NETWORK" ? "offline" : "error");
        setMessage(mapped.message);
      });
    return () => {
      cancelled = true;
    };
  }, [
    config,
    enabled,
    entityId,
    entityType,
    routeKey,
    semesterId,
    source,
    stableKey,
    surfaceKey,
  ]);

  const persist = useCallback(
    async (options?: { force?: boolean }) => {
      if (
        !enabled ||
        source !== "CURRENT" ||
        !baseHash ||
        !payloadHash ||
        !commandPayloadHash ||
        payloadHash === baseHash ||
        (!options?.force && payloadHash === lastPersistedHash)
      ) {
        return draft;
      }
      const sequence = ++saveSequenceRef.current;
      const effectiveKey = draft?.key || recoveryDraft?.key || key;
      setUiState("saving");
      setMessage("임시 저장 중입니다.");
      try {
        const response = await saveTeacherDraft({
          semesterId,
          expectedSemesterRevision: manifestRevision,
          payloadSchemaVersion: 1,
          key: effectiveKey,
          expectedDraftRevision: draft?.draftRevision ?? null,
          baseEntityRevision,
          basePayloadHash: baseHash,
          intendedCommandType,
          expectedCommandPayloadHash: commandPayloadHash,
          payload: stablePayloadObject,
          stagedAssets: [],
        });
        if (!mountedRef.current || sequence !== saveSequenceRef.current) {
          return draft;
        }
        const result = response.result;
        const nextDraft: TeacherDraftRecord = {
          draftId: String(result.draftId || draft?.draftId || ""),
          semesterId,
          key: effectiveKey,
          baseEntityRevision,
          basePayloadHash: baseHash,
          intendedCommandType,
          expectedCommandPayloadHash: commandPayloadHash,
          payload: stablePayloadObject,
          payloadHash: String(result.payloadHash || payloadHash),
          draftRevision: Number(result.draftRevision || 0),
          status: result.status === "CONFLICT" ? "CONFLICT" : "ACTIVE",
          conflictReason: String(result.conflictReason || ""),
          expiresAt: String(result.expiresAt || ""),
          updatedAt: new Date().toISOString(),
          readOnly: false,
        };
        setDraft(nextDraft);
        setLastPersistedHash(nextDraft.payloadHash);
        setSavedAt(nextDraft.updatedAt);
        if (nextDraft.status === "CONFLICT") {
          setRecoveryDraft(nextDraft);
          setUiState("conflict");
          setMessage(
            "최신 자료와 기준 revision이 달라 임시 저장을 충돌 상태로 보존했습니다.",
          );
        } else {
          setUiState("saved");
          setMessage("서버에 임시 저장했습니다.");
        }
        return nextDraft;
      } catch (error) {
        if (!mountedRef.current || sequence !== saveSequenceRef.current) {
          return draft;
        }
        const mapped =
          error instanceof TeacherOperationsError
            ? error
            : new TeacherOperationsError(
                "UNKNOWN",
                "임시 저장하지 못했습니다.",
              );
        setUiState(
          mapped.kind === "NETWORK"
            ? "offline"
            : mapped.kind === "CONFLICT"
              ? "conflict"
              : "error",
        );
        setMessage(mapped.message);
        throw mapped;
      }
    },
    [
      baseEntityRevision,
      baseHash,
      commandPayloadHash,
      draft,
      enabled,
      intendedCommandType,
      key,
      lastPersistedHash,
      manifestRevision,
      payloadHash,
      recoveryDraft,
      semesterId,
      source,
      stablePayloadObject,
    ],
  );

  useEffect(() => {
    if (
      !enabled ||
      source !== "CURRENT" ||
      !baseHash ||
      !payloadHash ||
      payloadHash === baseHash ||
      payloadHash === lastPersistedHash ||
      uiState === "recoverable" ||
      uiState === "conflict" ||
      uiState === "saving" ||
      uiState === "offline" ||
      uiState === "error"
    ) {
      return undefined;
    }
    setUiState("dirty");
    setMessage("변경 내용을 잠시 후 임시 저장합니다.");
    const timer = window.setTimeout(() => {
      void persist().catch(() => undefined);
    }, debounceMs);
    return () => window.clearTimeout(timer);
  }, [
    baseHash,
    debounceMs,
    enabled,
    lastPersistedHash,
    payloadHash,
    persist,
    source,
    uiState,
  ]);

  useEffect(() => {
    if (
      !["dirty", "saving", "offline", "error", "conflict"].includes(uiState)
    ) {
      return undefined;
    }
    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warnBeforeUnload);
    const warnInternalNavigation = (event: MouseEvent) => {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      ) {
        return;
      }
      const target = event.target;
      if (!(target instanceof Element)) return;
      const anchor = target.closest<HTMLAnchorElement>("a[href]");
      if (
        !anchor ||
        anchor.target === "_blank" ||
        anchor.hasAttribute("download")
      ) {
        return;
      }
      const confirmed = window.confirm(
        "임시 저장이 끝나지 않았습니다. 지금 이동하면 화면의 최신 변경 내용이 남지 않을 수 있습니다. 그래도 이동하시겠습니까?",
      );
      if (!confirmed) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    document.addEventListener("click", warnInternalNavigation, true);
    return () => {
      window.removeEventListener("beforeunload", warnBeforeUnload);
      document.removeEventListener("click", warnInternalNavigation, true);
    };
  }, [uiState]);

  const recover = useCallback(() => {
    if (!recoveryDraft) return;
    onRecover(recoveryDraft.payload as TPayload);
    setDraft(recoveryDraft);
    setLastPersistedHash(recoveryDraft.payloadHash);
    setRecoveryDraft(null);
    setUiState("saved");
    setMessage(
      "임시 저장 내용을 복구했습니다. 공식 저장은 따로 실행해 주세요.",
    );
  }, [onRecover, recoveryDraft]);

  const discard = useCallback(async () => {
    if (!recoveryDraft && !draft) return;
    const target = recoveryDraft || draft;
    if (!target) return;
    await discardTeacherDraft({
      semesterId,
      expectedSemesterRevision: manifestRevision,
      draftId: target.draftId,
      expectedDraftRevision: target.draftRevision,
      reason: "교사가 임시 저장 내용을 폐기함",
    });
    setDraft(null);
    setRecoveryDraft(null);
    setLastPersistedHash("");
    setUiState("clean");
    setMessage("임시 저장 내용을 폐기했습니다.");
  }, [draft, manifestRevision, recoveryDraft, semesterId]);

  const keepCurrent = useCallback(() => {
    setDraft(null);
    setRecoveryDraft(null);
    setUiState(payloadHash === baseHash ? "clean" : "dirty");
    setMessage("현재 화면의 내용을 유지합니다.");
  }, [baseHash, payloadHash]);

  const commit = useCallback(
    async <Result>(
      operation: () => Promise<CommandGatewayResponse<Result>>,
    ) => {
      let currentDraft = draft;
      if (
        enabled &&
        source === "CURRENT" &&
        payloadHash &&
        payloadHash !== baseHash
      ) {
        currentDraft = await persist({
          force: payloadHash !== lastPersistedHash,
        });
      }
      try {
        const response = await operation();
        if (
          response.status === "SUCCEEDED" &&
          currentDraft?.draftId &&
          currentDraft.draftRevision > 0
        ) {
          await resolveTeacherDraft({
            semesterId,
            expectedSemesterRevision: manifestRevision,
            draftId: currentDraft.draftId,
            expectedDraftRevision: currentDraft.draftRevision,
            canonicalCommandType: intendedCommandType,
            canonicalCommandId: response.commandId,
            expectedCommandPayloadHash: commandPayloadHash,
          });
          setDraft(null);
          setRecoveryDraft(null);
          setLastPersistedHash("");
          setUiState("clean");
          setMessage("공식 저장과 임시 저장 정리를 마쳤습니다.");
        }
        return response;
      } catch (error) {
        const commandConflict =
          (error instanceof WestoryCommandError &&
            error.state === "conflict") ||
          (error instanceof TeacherOperationsError &&
            error.kind === "CONFLICT") ||
          (error instanceof W8DomainError && error.kind === "CONFLICT");
        if (commandConflict && currentDraft) {
          setDraft(currentDraft);
          setRecoveryDraft(currentDraft);
          setUiState("conflict");
          setMessage(
            "다른 저장으로 최신 자료가 바뀌었습니다. 임시 저장은 유지했으며 자동으로 덮어쓰지 않았습니다.",
          );
        } else {
          setDraft(currentDraft);
          setUiState(
            (error instanceof TeacherOperationsError &&
              error.kind === "NETWORK") ||
              (error instanceof W8DomainError && error.kind === "NETWORK")
              ? "offline"
              : "error",
          );
          setMessage(
            error instanceof Error
              ? error.message
              : "공식 저장을 마치지 못해 임시 저장을 유지합니다.",
          );
        }
        throw error;
      }
    },
    [
      baseHash,
      commandPayloadHash,
      draft,
      enabled,
      intendedCommandType,
      lastPersistedHash,
      manifestRevision,
      payloadHash,
      persist,
      semesterId,
      source,
    ],
  );

  return {
    state: uiState,
    message,
    savedAt,
    draft,
    recoveryDraft,
    recover,
    discard,
    keepCurrent,
    retry: () => persist({ force: true }),
    flush: () => persist({ force: true }),
    commit,
  };
};
