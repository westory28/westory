import React, { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { LoadingOverlay } from "../../components/common/LoadingState";
import { useAppToast } from "../../components/common/AppToastProvider";
import { useAuth } from "../../contexts/AuthContext";
import {
  approveHistoryDictionaryTermForRequests,
  deleteStudentHistoryDictionaryWordByTeacher,
  normalizeHistoryDictionaryWord,
  saveHistoryDictionaryTerm,
  subscribeTeacherHistoryDictionaryRequests,
  subscribeTeacherHistoryDictionaryTerms,
} from "../../lib/historyDictionary";
import { loadNotifications } from "../../lib/notifications";
import type {
  HistoryDictionaryRequest,
  HistoryDictionaryTerm,
  WestoryNotification,
} from "../../types";

const OPEN_REQUEST_STATUSES = new Set(["requested", "needs_approval"]);
const DEFAULT_STUDENT_LEVEL = "중학생 수준";
const EXCEL_TEMPLATE_HEADERS = ["단어", "학생용 풀이", "관련 단원", "태그"];
const MAX_EXCEL_UPLOAD_ROWS = 200;
const INITIAL_FILTERS = [
  "전체",
  "ㄱ",
  "ㄴ",
  "ㄷ",
  "ㄹ",
  "ㅁ",
  "ㅂ",
  "ㅅ",
  "ㅇ",
  "ㅈ",
  "ㅊ",
  "ㅋ",
  "ㅌ",
  "ㅍ",
  "ㅎ",
];
const HANGUL_INITIALS = INITIAL_FILTERS.slice(1);

type ActiveDictionaryPanel = "terms" | "requests" | "upload";

interface HistoryDictionaryUploadRow {
  id: string;
  rowNumber: number;
  word: string;
  definition: string;
  relatedUnitId: string;
  tags: string[];
  normalizedWord: string;
  errors: string[];
  notices: string[];
}

const timestampLabel = (value: unknown) => {
  const date =
    value && typeof (value as { toDate?: () => Date }).toDate === "function"
      ? (value as { toDate: () => Date }).toDate()
      : null;
  if (!date) return "";
  const pad = (number: number) => String(number).padStart(2, "0");
  return `${date.getFullYear()}.${pad(date.getMonth() + 1)}.${pad(
    date.getDate(),
  )} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

const statusLabel = (status: HistoryDictionaryRequest["status"]) => {
  if (status === "needs_approval") return "기존 풀이 승인 필요";
  if (status === "resolved") return "처리 완료";
  if (status === "rejected") return "보류";
  return "새 풀이 필요";
};

const getTimestampMs = (value: unknown) => {
  const date =
    value && typeof (value as { toDate?: () => Date }).toDate === "function"
      ? (value as { toDate: () => Date }).toDate()
      : null;
  return date?.getTime() || 0;
};

const getWordInitial = (value: string) => {
  const first = String(value || "")
    .trim()
    .charAt(0);
  if (!first) return "";
  const code = first.charCodeAt(0);
  if (code >= 0xac00 && code <= 0xd7a3) {
    return HANGUL_INITIALS[Math.floor((code - 0xac00) / 588)] || "";
  }
  return first.toUpperCase();
};

const normalizeTag = (value: string) =>
  String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 24);

const mapNotificationToHistoryDictionaryRequest = (
  notification: WestoryNotification,
): HistoryDictionaryRequest | null => {
  if (notification.type !== "history_dictionary_requested") return null;

  const requestId = String(notification.entityId || notification.id || "");
  const uid = String(notification.actorUid || "");
  const body = String(notification.body || "")
    .replace(/"/g, "")
    .trim();
  const match = body.match(
    /^(.+?)\s+학생이\s+(.+?)\s+뜻풀이를 요청했습니다\.$/,
  );
  const studentName = String(match?.[1] || "학생").trim();
  const word = String(match?.[2] || "").trim();
  const normalizedWord = normalizeHistoryDictionaryWord(word);
  if (!requestId || !uid || !word || !normalizedWord) return null;

  return {
    id: requestId,
    word,
    normalizedWord,
    uid,
    studentName,
    grade: "",
    class: "",
    number: "",
    memo: "알림 기록에서 확인한 요청입니다.",
    status: "requested",
    matchedTermId: "",
    resolvedTermId: "",
    resolvedBy: "",
    createdAt: notification.createdAt || null,
    updatedAt: notification.createdAt || null,
    resolvedAt: null,
  };
};

const mergeRequestSources = (
  primaryRequests: HistoryDictionaryRequest[],
  fallbackRequests: HistoryDictionaryRequest[],
) => {
  const byKey = new Map<string, HistoryDictionaryRequest>();

  primaryRequests.forEach((request) => {
    const key = request.id || `${request.uid}:${request.normalizedWord}`;
    byKey.set(key, request);
    if (request.uid && request.normalizedWord) {
      byKey.set(`${request.uid}:${request.normalizedWord}`, request);
    }
  });

  fallbackRequests.forEach((request) => {
    const requestKey = request.id || `${request.uid}:${request.normalizedWord}`;
    const wordKey = `${request.uid}:${request.normalizedWord}`;
    if (byKey.has(requestKey) || byKey.has(wordKey)) return;
    byKey.set(requestKey, request);
    if (request.uid && request.normalizedWord) {
      byKey.set(wordKey, request);
    }
  });

  return Array.from(new Set(byKey.values()));
};

const ManageHistoryDictionary: React.FC = () => {
  const { config, currentUser } = useAuth();
  const { showToast } = useAppToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const [requests, setRequests] = useState<HistoryDictionaryRequest[]>([]);
  const [notificationRequests, setNotificationRequests] = useState<
    HistoryDictionaryRequest[]
  >([]);
  const [terms, setTerms] = useState<HistoryDictionaryTerm[]>([]);
  const [selectedRequestId, setSelectedRequestId] = useState("");
  const [selectedTermId, setSelectedTermId] = useState("");
  const [word, setWord] = useState("");
  const [definition, setDefinition] = useState("");
  const [relatedUnitId, setRelatedUnitId] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState("");
  const [uploadRows, setUploadRows] = useState<HistoryDictionaryUploadRow[]>(
    [],
  );
  const [uploadFileName, setUploadFileName] = useState("");
  const [busyMessage, setBusyMessage] = useState("");
  const [requestSearch, setRequestSearch] = useState("");
  const [termSearch, setTermSearch] = useState("");
  const [activePanel, setActivePanel] =
    useState<ActiveDictionaryPanel>("terms");
  const [activeInitial, setActiveInitial] = useState("전체");

  useEffect(() => {
    const unsubscribeRequests =
      subscribeTeacherHistoryDictionaryRequests(setRequests);
    const unsubscribeTerms = subscribeTeacherHistoryDictionaryTerms(setTerms);
    return () => {
      unsubscribeRequests();
      unsubscribeTerms();
    };
  }, []);

  useEffect(() => {
    if (!config || !currentUser?.uid) {
      setNotificationRequests([]);
      return;
    }
    let cancelled = false;

    const loadFallbackRequests = async () => {
      try {
        const notifications = await loadNotifications(config, currentUser.uid);
        if (cancelled) return;
        setNotificationRequests(
          notifications
            .map(mapNotificationToHistoryDictionaryRequest)
            .filter((item): item is HistoryDictionaryRequest => Boolean(item)),
        );
      } catch (error) {
        console.error(
          "Failed to load history dictionary request notifications:",
          error,
        );
        if (!cancelled) setNotificationRequests([]);
      }
    };

    void loadFallbackRequests();
    return () => {
      cancelled = true;
    };
  }, [config?.semester, config?.year, currentUser?.uid]);

  useEffect(() => {
    const panel = searchParams.get("panel");
    const requestId = searchParams.get("requestId");
    if (panel === "upload") {
      setActivePanel("upload");
      setSelectedRequestId("");
      setSelectedTermId("");
    }
    if (panel === "requests") {
      setActivePanel("requests");
      setSelectedTermId("");
    }
    if (requestId) {
      setActivePanel("requests");
      setSelectedTermId("");
      setSelectedRequestId(requestId);
    }
  }, [searchParams]);

  const mergedRequests = useMemo(
    () => mergeRequestSources(requests, notificationRequests),
    [notificationRequests, requests],
  );

  const openRequests = useMemo(
    () =>
      mergedRequests.filter((item) =>
        OPEN_REQUEST_STATUSES.has(String(item.status || "")),
      ),
    [mergedRequests],
  );

  const visibleRequests = useMemo(() => {
    const keyword = requestSearch.trim().toLowerCase();
    return openRequests
      .filter((item) => {
        if (!keyword) return true;
        return (
          item.word.toLowerCase().includes(keyword) ||
          (item.studentName || "").toLowerCase().includes(keyword) ||
          (item.memo || "").toLowerCase().includes(keyword)
        );
      })
      .sort(
        (a, b) =>
          getTimestampMs(b.updatedAt || b.createdAt) -
          getTimestampMs(a.updatedAt || a.createdAt),
      );
  }, [openRequests, requestSearch]);

  const visibleTerms = useMemo(() => {
    const keyword = termSearch.trim().toLowerCase();
    return [...terms]
      .filter((item) => {
        const matchesInitial =
          activeInitial === "전체" ||
          getWordInitial(item.word) === activeInitial;
        const matchesSearch =
          !keyword ||
          item.word.toLowerCase().includes(keyword) ||
          (item.definition || "").toLowerCase().includes(keyword) ||
          (item.tags || []).some((tag) => tag.toLowerCase().includes(keyword));
        return matchesInitial && matchesSearch;
      })
      .sort((a, b) => a.word.localeCompare(b.word, "ko-KR"));
  }, [activeInitial, termSearch, terms]);

  const initialCounts = useMemo(() => {
    const counts = new Map<string, number>();
    terms.forEach((item) => {
      const initial = getWordInitial(item.word);
      counts.set(initial, (counts.get(initial) || 0) + 1);
    });
    return counts;
  }, [terms]);

  const groupedVisibleTerms = useMemo(() => {
    const groups = new Map<string, HistoryDictionaryTerm[]>();
    visibleTerms.forEach((item) => {
      const initial = getWordInitial(item.word) || "기타";
      groups.set(initial, [...(groups.get(initial) || []), item]);
    });
    return Array.from(groups.entries());
  }, [visibleTerms]);

  const selectedRequest =
    (selectedRequestId
      ? openRequests.find((item) => item.id === selectedRequestId)
      : null) ||
    (activePanel === "requests" && !selectedTermId ? openRequests[0] : null) ||
    mergedRequests.find((item) => item.id === selectedRequestId) ||
    null;

  const selectedTerm = terms.find((item) => item.id === selectedTermId) || null;
  const normalizedEditorWord = normalizeHistoryDictionaryWord(word);
  const matchingTerm = useMemo(() => {
    const target = selectedRequest?.normalizedWord || normalizedEditorWord;
    if (!target) return null;
    return (
      terms.find(
        (item) =>
          item.normalizedWord === target &&
          item.status === "published" &&
          item.definition,
      ) || null
    );
  }, [normalizedEditorWord, selectedRequest?.normalizedWord, terms]);
  const sameWordOpenCount = selectedRequest
    ? openRequests.filter(
        (item) => item.normalizedWord === selectedRequest.normalizedWord,
      ).length
    : 0;
  const uploadStats = useMemo(() => {
    const errorCount = uploadRows.filter((item) => item.errors.length).length;
    const noticeCount = uploadRows.filter(
      (item) => !item.errors.length && item.notices.length,
    ).length;
    return {
      total: uploadRows.length,
      ready: uploadRows.length - errorCount,
      errorCount,
      noticeCount,
    };
  }, [uploadRows]);
  const uploadReadyRows = useMemo(
    () => uploadRows.filter((item) => !item.errors.length),
    [uploadRows],
  );

  useEffect(() => {
    if (!selectedRequest) return;
    setSelectedRequestId(selectedRequest.id);
    setSelectedTermId("");
    setWord(selectedRequest.word);
    const term = terms.find(
      (item) =>
        item.normalizedWord === selectedRequest.normalizedWord &&
        item.status === "published",
    );
    setDefinition(term?.definition || "");
    setRelatedUnitId(term?.relatedUnitId || "");
    setTags(term?.tags || []);
    setTagInput("");
  }, [selectedRequest?.id, terms]);

  useEffect(() => {
    if (!selectedTerm) return;
    setWord(selectedTerm.word);
    setDefinition(selectedTerm.definition || "");
    setRelatedUnitId(selectedTerm.relatedUnitId || "");
    setTags(selectedTerm.tags || []);
    setTagInput("");
  }, [selectedTerm]);

  const handleSelectRequest = (requestId: string) => {
    setActivePanel("requests");
    setSelectedRequestId(requestId);
    setSelectedTermId("");
    setSearchParams({ panel: "requests", requestId });
  };

  const handleSelectTerm = (term: HistoryDictionaryTerm) => {
    setActivePanel("terms");
    setSelectedTermId(term.id);
    setSelectedRequestId("");
    setSearchParams({});
  };

  const handleNewTerm = () => {
    setActivePanel("terms");
    setSelectedRequestId("");
    setSelectedTermId("__new__");
    setSearchParams({});
    setWord("");
    setDefinition("");
    setRelatedUnitId("");
    setTags([]);
    setTagInput("");
  };

  const handleAddTag = () => {
    const nextTag = normalizeTag(tagInput);
    if (!nextTag) return;
    setTags((prev) => {
      if (prev.some((item) => item.toLowerCase() === nextTag.toLowerCase())) {
        return prev;
      }
      return [...prev, nextTag].slice(0, 12);
    });
    setTagInput("");
  };

  const handleRemoveTag = (target: string) => {
    setTags((prev) => prev.filter((item) => item !== target));
  };

  const handleDownloadExcelTemplate = async () => {
    const { default: writeXlsxFile } = await import("write-excel-file/browser");
    await writeXlsxFile(
      [
        EXCEL_TEMPLATE_HEADERS.map((value) => ({
          value,
          fontWeight: "bold",
        })),
        [
          "임진왜란",
          "조선 선조 때 일본이 조선을 침략하며 시작된 전쟁입니다.",
          "조선 전기 / 임진왜란",
          "전쟁, 조선, 일본",
        ].map((value) => ({ value })),
        [
          "실학",
          "조선 후기 현실 문제를 해결하기 위해 등장한 학문 경향입니다.",
          "조선 후기 사회 변화",
          "조선 후기, 개혁",
        ].map((value) => ({ value })),
      ],
      {
        columns: [{ width: 18 }, { width: 54 }, { width: 26 }, { width: 32 }],
        fileName: "westory_history_dictionary_template.xlsx",
        sheet: "역사 사전 업로드",
      },
    );
  };

  const parseUploadTags = (value: unknown) =>
    String(value || "")
      .split(/[,\n;]/)
      .map(normalizeTag)
      .filter(Boolean)
      .filter((tag, index, list) => {
        const key = tag.toLowerCase();
        return list.findIndex((item) => item.toLowerCase() === key) === index;
      })
      .slice(0, 12);

  const handleExcelUpload = async (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    setActivePanel("upload");
    setSelectedRequestId("");
    setSelectedTermId("");
    setSearchParams({ panel: "upload" });

    try {
      const { default: readXlsxFile } = await import("read-excel-file/browser");
      const workbookRows = (await readXlsxFile(file)) as unknown;
      const rows =
        Array.isArray(workbookRows) &&
        workbookRows.length === 1 &&
        typeof workbookRows[0] === "object" &&
        workbookRows[0] !== null &&
        Array.isArray((workbookRows[0] as { data?: unknown }).data)
          ? ((workbookRows[0] as { data: unknown[][] }).data as unknown[][])
          : (workbookRows as unknown[][]);
      if (!rows.length) {
        throw new Error("첫 번째 시트를 찾을 수 없습니다.");
      }

      const headerIndex = new Map<string, number>();
      (rows[0] || []).forEach((cell, index) => {
        const header = String(cell || "").trim();
        if (header) headerIndex.set(header, index);
      });
      const missingHeaders = EXCEL_TEMPLATE_HEADERS.filter(
        (header) => !headerIndex.has(header),
      );
      if (missingHeaders.length) {
        throw new Error(`필수 컬럼이 없습니다: ${missingHeaders.join(", ")}`);
      }

      const getCell = (row: unknown[], header: string, maxLength: number) =>
        String(row[headerIndex.get(header) ?? -1] || "")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, maxLength);

      const parsedRows = rows
        .slice(1, MAX_EXCEL_UPLOAD_ROWS + 1)
        .map((row, index) => {
          const word = getCell(row, "단어", 40);
          const definition = getCell(row, "학생용 풀이", 1200);
          const relatedUnitId = getCell(row, "관련 단원", 120);
          const tags = parseUploadTags(row[headerIndex.get("태그") ?? -1]);
          const normalizedWord = normalizeHistoryDictionaryWord(word);
          return {
            id: `upload-${index + 2}-${normalizedWord || index}`,
            rowNumber: index + 2,
            word,
            definition,
            relatedUnitId,
            tags,
            normalizedWord,
            errors: [],
            notices: [],
          } satisfies HistoryDictionaryUploadRow;
        })
        .filter(
          (row) =>
            row.word || row.definition || row.relatedUnitId || row.tags.length,
        );

      if (!parsedRows.length) {
        throw new Error("등록할 행이 없습니다.");
      }

      const normalizedCounts = new Map<string, number>();
      parsedRows.forEach((row) => {
        if (!row.normalizedWord) return;
        normalizedCounts.set(
          row.normalizedWord,
          (normalizedCounts.get(row.normalizedWord) || 0) + 1,
        );
      });
      const existingWords = new Set(
        terms
          .map((term) =>
            normalizeHistoryDictionaryWord(term.normalizedWord || term.word),
          )
          .filter(Boolean),
      );

      const inspectedRows = parsedRows.map((row) => {
        const errors: string[] = [];
        const notices: string[] = [];
        if (!row.word) errors.push("단어 빈칸");
        if (!row.definition) errors.push("학생용 풀이 빈칸");
        if (row.definition && row.definition.length < 5) {
          errors.push("풀이 5자 미만");
        }
        if (normalizedCounts.get(row.normalizedWord) > 1) {
          errors.push("파일 내 중복 단어");
        }
        if (row.normalizedWord && existingWords.has(row.normalizedWord)) {
          errors.push("이미 등록된 단어");
        }
        if (!row.relatedUnitId) notices.push("관련 단원 빈칸");
        if (!row.tags.length) notices.push("태그 빈칸");
        return { ...row, errors, notices };
      });

      setUploadFileName(file.name);
      setUploadRows(inspectedRows);
      showToast({
        tone: "success",
        title: "Excel 파일을 불러왔습니다.",
        message: "미리보기에서 오류와 중복 단어를 확인한 뒤 등록해 주세요.",
      });
    } catch (error) {
      console.error("Failed to parse history dictionary Excel:", error);
      setUploadFileName(file.name);
      setUploadRows([]);
      showToast({
        tone: "error",
        title: "Excel 파일을 읽지 못했습니다.",
        message:
          error instanceof Error
            ? error.message
            : "양식 파일인지 확인한 뒤 다시 업로드해 주세요.",
      });
    }
  };

  const handleClearUploadPreview = () => {
    setUploadRows([]);
    setUploadFileName("");
  };

  const handleRegisterUploadRows = async () => {
    if (!uploadReadyRows.length || uploadStats.errorCount || busyMessage) {
      return;
    }
    const existingWords = new Set(
      terms
        .map((term) =>
          normalizeHistoryDictionaryWord(term.normalizedWord || term.word),
        )
        .filter(Boolean),
    );
    const conflictedWords = new Set(
      uploadReadyRows
        .filter((row) => existingWords.has(row.normalizedWord))
        .map((row) => row.normalizedWord),
    );
    if (conflictedWords.size) {
      setUploadRows((prev) =>
        prev.map((row) =>
          conflictedWords.has(row.normalizedWord)
            ? {
                ...row,
                errors: Array.from(
                  new Set([...row.errors, "이미 등록된 단어"]),
                ),
              }
            : row,
        ),
      );
      showToast({
        tone: "error",
        title: "중복 단어가 확인되었습니다.",
        message: "최신 등록 단어 목록과 겹치는 항목을 확인해 주세요.",
      });
      return;
    }
    setBusyMessage(
      `역사 사전 용어 ${uploadReadyRows.length}개를 등록하는 중입니다.`,
    );
    let savedCount = 0;
    try {
      for (const row of uploadReadyRows) {
        await saveHistoryDictionaryTerm(config, {
          word: row.word,
          definition: row.definition,
          studentLevel: DEFAULT_STUDENT_LEVEL,
          relatedUnitId: row.relatedUnitId,
          tags: row.tags,
        });
        savedCount += 1;
      }
      showToast({
        tone: "success",
        title: "역사 사전 용어를 등록했습니다.",
        message: `${savedCount}개 항목을 학생용 풀이로 저장했습니다.`,
      });
      handleClearUploadPreview();
      setActivePanel("terms");
      setSearchParams({});
    } catch (error) {
      console.error("Failed to register history dictionary Excel rows:", error);
      showToast({
        tone: "error",
        title: "일괄 등록 중 일부 항목을 저장하지 못했습니다.",
        message: `${savedCount}개 저장 후 중단했습니다. 목록을 새로 확인한 뒤 다시 시도해 주세요.`,
      });
    } finally {
      setBusyMessage("");
    }
  };

  const handleSaveTerm = async () => {
    if (!word.trim() || definition.trim().length < 5 || busyMessage) return;
    setBusyMessage(
      "역사 사전 풀이를 저장하고 요청 학생에게 배포하는 중입니다.",
    );
    try {
      await saveHistoryDictionaryTerm(config, {
        word,
        definition,
        studentLevel: DEFAULT_STUDENT_LEVEL,
        relatedUnitId,
        tags,
        fallbackRequestId:
          selectedRequest &&
          !requests.some((item) => item.id === selectedRequest.id)
            ? selectedRequest.id
            : undefined,
        fallbackUid:
          selectedRequest &&
          !requests.some((item) => item.id === selectedRequest.id)
            ? selectedRequest.uid
            : undefined,
      });
      showToast({
        tone: "success",
        title: "역사 사전에 등록했습니다.",
        message: "같은 단어를 요청한 학생 단어장에 반영했습니다.",
      });
    } catch (error) {
      console.error("Failed to save history dictionary term:", error);
      showToast({
        tone: "error",
        title: "역사 사전 저장에 실패했습니다.",
        message: "입력 내용을 확인한 뒤 다시 시도해 주세요.",
      });
    } finally {
      setBusyMessage("");
    }
  };

  const handleApproveExisting = async (requestId?: string) => {
    if (!matchingTerm || busyMessage) return;
    setBusyMessage("기존 뜻풀이를 승인하고 학생 단어장에 반영하는 중입니다.");
    try {
      await approveHistoryDictionaryTermForRequests(config, {
        termId: matchingTerm.id,
        requestId,
      });
      showToast({
        tone: "success",
        title: "뜻풀이를 승인했습니다.",
        message: requestId
          ? "선택한 요청 학생에게 단어장을 배포했습니다."
          : "같은 단어의 대기 요청을 함께 처리했습니다.",
      });
    } catch (error) {
      console.error("Failed to approve history dictionary term:", error);
      showToast({
        tone: "error",
        title: "뜻풀이 승인에 실패했습니다.",
        message: "잠시 후 다시 시도해 주세요.",
      });
    } finally {
      setBusyMessage("");
    }
  };

  const handleRejectRequestWord = async () => {
    if (!selectedRequest || busyMessage) return;
    const confirmed = window.confirm(
      `"${selectedRequest.word}" 요청 단어를 삭제할까요?\n부적절하거나 내용이 부족한 단어라면 학생 단어장에서 삭제되고, 지급된 역사 사전 위스가 있으면 함께 회수됩니다.`,
    );
    if (!confirmed) return;
    setBusyMessage("요청 단어를 삭제하고 지급된 위스를 확인하는 중입니다.");
    try {
      const result = await deleteStudentHistoryDictionaryWordByTeacher(config, {
        uid: selectedRequest.uid,
        requestId: selectedRequest.id,
        termId: selectedRequest.matchedTermId || selectedRequest.resolvedTermId,
        word: selectedRequest.word,
        normalizedWord: selectedRequest.normalizedWord,
        reason: "teacher_rejected_history_dictionary_word",
      });
      showToast({
        tone: "success",
        title: "요청 단어를 삭제했습니다.",
        message: result.reward?.reclaimed
          ? `지급된 ${Number(result.reward.amount || 0)}위스를 회수했습니다.`
          : "요청을 반려하고 학생 단어장 항목을 정리했습니다.",
      });
      setSelectedRequestId("");
      setWord("");
      setDefinition("");
      setRelatedUnitId("");
      setTags([]);
      setTagInput("");
    } catch (error) {
      console.error("Failed to reject history dictionary request:", error);
      showToast({
        tone: "error",
        title: "요청 단어 삭제에 실패했습니다.",
        message: "잠시 후 다시 시도해 주세요.",
      });
    } finally {
      setBusyMessage("");
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-6 lg:px-6 xl:px-8">
      <div className="mx-auto max-w-7xl">
        <div className="grid gap-4 xl:grid-cols-[13rem_minmax(24rem,0.78fr)_minmax(0,1.2fr)]">
          <aside className="self-start overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
            <nav
              className="divide-y divide-slate-200"
              aria-label="역사 사전 관리 메뉴"
            >
              {[
                {
                  id: "terms" as const,
                  label: "등록된 단어",
                  description: "등록 풀이 수정",
                },
                {
                  id: "requests" as const,
                  label: "학생 요청 단어",
                  description: "요청 풀이 작성",
                },
                {
                  id: "upload" as const,
                  label: "Excel 업로드",
                  description: "양식 일괄 등록",
                },
              ].map((item) => {
                const active = activePanel === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      setActivePanel(item.id);
                      if (item.id === "terms") {
                        setSelectedRequestId("");
                        setSearchParams({});
                      } else if (item.id === "requests") {
                        setSelectedTermId("");
                        setSearchParams({ panel: "requests" });
                      } else {
                        setSelectedRequestId("");
                        setSelectedTermId("");
                        setSearchParams({ panel: "upload" });
                      }
                    }}
                    className={`relative block min-h-[3.75rem] w-full px-4 py-3 text-left transition ${
                      active
                        ? "bg-blue-50 text-blue-700"
                        : "bg-white text-slate-800 hover:bg-slate-50"
                    }`}
                  >
                    {active && (
                      <span
                        className="absolute inset-y-0 left-0 w-1 bg-blue-600"
                        aria-hidden="true"
                      />
                    )}
                    <span className="block text-sm font-extrabold">
                      {item.label}
                    </span>
                    <span
                      className={`mt-1 block text-xs font-bold ${
                        active ? "text-blue-600" : "text-slate-500"
                      }`}
                    >
                      {item.description}
                    </span>
                  </button>
                );
              })}
            </nav>
          </aside>

          {activePanel === "terms" ? (
            <aside className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-lg font-extrabold text-slate-950">
                  등록된 단어
                </h2>
                <button
                  type="button"
                  onClick={handleNewTerm}
                  className="inline-flex h-9 items-center gap-2 rounded-lg border border-blue-100 bg-blue-50 px-3 text-xs font-extrabold text-blue-700 transition hover:bg-blue-100"
                >
                  <i className="fas fa-plus text-[11px]" aria-hidden="true"></i>
                  새 풀이
                </button>
              </div>

              <div className="mt-5 grid gap-3 lg:grid-cols-[4.75rem_minmax(0,1fr)]">
                <div className="grid grid-cols-5 gap-2 lg:grid-cols-1">
                  {INITIAL_FILTERS.map((initial) => {
                    const active = activeInitial === initial;
                    const count =
                      initial === "전체"
                        ? terms.length
                        : initialCounts.get(initial) || 0;
                    return (
                      <button
                        key={initial}
                        type="button"
                        onClick={() => setActiveInitial(initial)}
                        className={`flex h-11 items-center justify-center rounded-lg border text-sm font-extrabold transition ${
                          active
                            ? "border-blue-600 bg-blue-600 text-white shadow-sm"
                            : "border-slate-200 bg-white text-slate-700 hover:border-blue-200 hover:bg-blue-50"
                        }`}
                        title={`${initial} ${count}개`}
                      >
                        {initial}
                      </button>
                    );
                  })}
                </div>

                <div className="min-w-0">
                  <label className="relative block">
                    <span className="sr-only">등록 풀이 검색</span>
                    <i
                      className="fas fa-magnifying-glass pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-sm text-slate-400"
                      aria-hidden="true"
                    ></i>
                    <input
                      type="search"
                      value={termSearch}
                      onChange={(event) => setTermSearch(event.target.value)}
                      className="h-11 w-full rounded-lg border border-slate-200 bg-white pl-10 pr-3 text-sm font-semibold text-slate-800 outline-none transition focus:border-blue-400 focus:ring-4 focus:ring-blue-100"
                      placeholder="단어, 뜻풀이 검색"
                    />
                  </label>

                  <div className="mt-4 text-xs font-bold text-slate-500">
                    등록된 단어 {terms.length}개
                  </div>

                  <div className="mt-4 max-h-[calc(100vh-22rem)] min-h-[26rem] overflow-y-auto pr-1">
                    {!visibleTerms.length && (
                      <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-10 text-center text-sm font-semibold text-slate-500">
                        표시할 단어가 없습니다.
                      </div>
                    )}
                    <div className="space-y-3">
                      {groupedVisibleTerms.map(([initial, items]) => (
                        <section key={initial}>
                          <div className="mb-2 px-2 text-sm font-extrabold text-slate-900">
                            {initial}
                          </div>
                          <div className="space-y-2">
                            {items.map((item) => {
                              const active = selectedTerm?.id === item.id;
                              return (
                                <button
                                  key={item.id}
                                  type="button"
                                  onClick={() => handleSelectTerm(item)}
                                  className={`block w-full rounded-lg border px-3 py-3 text-left transition ${
                                    active
                                      ? "border-blue-500 bg-blue-50 shadow-[0_0_0_3px_rgba(37,99,235,0.08)]"
                                      : "border-slate-200 bg-white hover:border-blue-200 hover:bg-blue-50/60"
                                  }`}
                                >
                                  <div className="flex items-center justify-between gap-3">
                                    <span
                                      className={`min-w-0 truncate text-sm font-extrabold ${
                                        active
                                          ? "text-blue-700"
                                          : "text-slate-900"
                                      }`}
                                    >
                                      {item.word}
                                    </span>
                                    <span className="shrink-0 rounded-full bg-blue-50 px-2.5 py-1 text-[11px] font-bold text-blue-700">
                                      학생용
                                    </span>
                                  </div>
                                  <p className="mt-2 line-clamp-2 text-xs leading-5 text-slate-500">
                                    {item.definition}
                                  </p>
                                  {!!item.tags?.length && (
                                    <div className="mt-2 flex flex-wrap gap-1.5">
                                      {item.tags.slice(0, 4).map((tag) => (
                                        <span
                                          key={`${item.id}-${tag}`}
                                          className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-bold text-slate-500"
                                        >
                                          {tag}
                                        </span>
                                      ))}
                                      {item.tags.length > 4 && (
                                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-bold text-slate-400">
                                          +{item.tags.length - 4}
                                        </span>
                                      )}
                                    </div>
                                  )}
                                  <div className="mt-2 text-[11px] font-bold text-slate-400">
                                    {timestampLabel(
                                      item.updatedAt ||
                                        item.publishedAt ||
                                        item.createdAt,
                                    )}
                                  </div>
                                </button>
                              );
                            })}
                          </div>
                        </section>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </aside>
          ) : activePanel === "requests" ? (
            <aside className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-lg font-extrabold text-slate-950">
                    학생 요청 단어
                  </h2>
                  <p className="mt-1 text-xs font-semibold text-slate-500">
                    요청 맥락을 확인한 뒤 풀이를 작성해 배포합니다.
                  </p>
                </div>
              </div>

              <label className="relative mt-5 block">
                <span className="sr-only">요청 검색</span>
                <i
                  className="fas fa-magnifying-glass pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-sm text-slate-400"
                  aria-hidden="true"
                ></i>
                <input
                  type="search"
                  value={requestSearch}
                  onChange={(event) => setRequestSearch(event.target.value)}
                  className="h-11 w-full rounded-lg border border-slate-200 bg-white pl-10 pr-3 text-sm font-semibold text-slate-800 outline-none transition focus:border-blue-400 focus:ring-4 focus:ring-blue-100"
                  placeholder="요청 단어, 학생, 메모 검색"
                />
              </label>

              <div className="mt-4 max-h-[calc(100vh-18rem)] min-h-[26rem] overflow-y-auto pr-1">
                {!visibleRequests.length && (
                  <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-10 text-center text-sm font-semibold text-slate-500">
                    대기 중인 요청이 없습니다.
                  </div>
                )}
                <div className="space-y-2">
                  {visibleRequests.map((item) => {
                    const active = selectedRequest?.id === item.id;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => handleSelectRequest(item.id)}
                        className={`block w-full rounded-lg border px-3 py-3 text-left transition ${
                          active
                            ? "border-blue-500 bg-blue-50 shadow-[0_0_0_3px_rgba(37,99,235,0.08)]"
                            : "border-slate-200 bg-white hover:border-blue-200 hover:bg-blue-50/60"
                        }`}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <span
                            className={`min-w-0 truncate text-sm font-extrabold ${
                              active ? "text-blue-700" : "text-slate-900"
                            }`}
                          >
                            {item.word}
                          </span>
                          <span
                            className={`shrink-0 rounded-full px-2 py-1 text-[11px] font-bold ${
                              item.status === "needs_approval"
                                ? "bg-emerald-50 text-emerald-700"
                                : "bg-amber-50 text-amber-700"
                            }`}
                          >
                            {statusLabel(item.status)}
                          </span>
                        </div>
                        <div className="mt-2 text-xs font-semibold text-slate-500">
                          {item.grade}학년 {item.class}반 {item.number}번 ·{" "}
                          {item.studentName || "학생"}
                        </div>
                        {item.memo && (
                          <div className="mt-2 line-clamp-2 text-xs leading-5 text-slate-600">
                            {item.memo}
                          </div>
                        )}
                        <div className="mt-2 text-[11px] font-bold text-slate-400">
                          {timestampLabel(item.updatedAt || item.createdAt)}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            </aside>
          ) : (
            <aside className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <div>
                <h2 className="text-lg font-extrabold text-slate-950">
                  Excel 일괄 등록
                </h2>
                <p className="mt-1 text-xs font-semibold leading-5 text-slate-500">
                  양식을 내려받아 작성한 뒤 업로드하면 저장 전 미리보기에서
                  오류와 중복을 확인합니다.
                </p>
              </div>

              <div className="mt-5 space-y-2">
                <button
                  type="button"
                  onClick={() => void handleDownloadExcelTemplate()}
                  className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg border border-blue-100 bg-blue-50 px-4 text-sm font-extrabold text-blue-700 transition hover:bg-blue-100"
                >
                  <i
                    className="fas fa-file-arrow-down text-xs"
                    aria-hidden="true"
                  ></i>
                  업로드 양식 다운로드
                </button>
                <button
                  type="button"
                  onClick={() => uploadInputRef.current?.click()}
                  className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 text-sm font-extrabold text-white transition hover:bg-blue-700"
                >
                  <i
                    className="fas fa-file-arrow-up text-xs"
                    aria-hidden="true"
                  ></i>
                  Excel 파일 선택
                </button>
                <input
                  ref={uploadInputRef}
                  type="file"
                  accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                  onChange={(event) => void handleExcelUpload(event)}
                  className="sr-only"
                  aria-label="역사 사전 용어 Excel 파일 업로드"
                />
              </div>

              <dl className="mt-5 grid grid-cols-2 gap-2 text-center">
                <div className="rounded-lg bg-slate-50 px-3 py-3">
                  <dt className="text-[11px] font-bold text-slate-500">
                    불러온 행
                  </dt>
                  <dd className="mt-1 text-lg font-extrabold text-slate-900">
                    {uploadStats.total}
                  </dd>
                </div>
                <div className="rounded-lg bg-slate-50 px-3 py-3">
                  <dt className="text-[11px] font-bold text-slate-500">
                    등록 가능
                  </dt>
                  <dd className="mt-1 text-lg font-extrabold text-blue-700">
                    {uploadStats.ready}
                  </dd>
                </div>
                <div className="rounded-lg bg-slate-50 px-3 py-3">
                  <dt className="text-[11px] font-bold text-slate-500">오류</dt>
                  <dd className="mt-1 text-lg font-extrabold text-rose-600">
                    {uploadStats.errorCount}
                  </dd>
                </div>
                <div className="rounded-lg bg-slate-50 px-3 py-3">
                  <dt className="text-[11px] font-bold text-slate-500">확인</dt>
                  <dd className="mt-1 text-lg font-extrabold text-amber-600">
                    {uploadStats.noticeCount}
                  </dd>
                </div>
              </dl>

              {uploadFileName && (
                <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 px-3 py-3 text-xs font-semibold text-slate-600">
                  <div className="font-extrabold text-slate-800">
                    선택한 파일
                  </div>
                  <div className="mt-1 break-all">{uploadFileName}</div>
                </div>
              )}
            </aside>
          )}

          <main className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm lg:p-7">
            {activePanel === "upload" ? (
              <>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="text-2xl font-extrabold tracking-tight text-slate-950">
                      역사 사전 용어 Excel 업로드
                    </h2>
                    <p className="mt-2 text-sm font-semibold leading-6 text-slate-500">
                      업로드 직후에는 DB에 저장하지 않습니다. 오류와 중복 단어를
                      확인한 뒤 등록하기를 눌러야 Firebase DB에 저장됩니다.
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => void handleDownloadExcelTemplate()}
                      className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-4 text-sm font-extrabold text-slate-700 transition hover:bg-slate-50"
                    >
                      <i
                        className="fas fa-file-arrow-down text-xs"
                        aria-hidden="true"
                      ></i>
                      양식 다운로드
                    </button>
                    <button
                      type="button"
                      onClick={() => uploadInputRef.current?.click()}
                      className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 text-sm font-extrabold text-white transition hover:bg-blue-700"
                    >
                      <i
                        className="fas fa-file-arrow-up text-xs"
                        aria-hidden="true"
                      ></i>
                      파일 업로드
                    </button>
                  </div>
                </div>

                <section className="mt-6 rounded-lg border border-slate-200 bg-slate-50 px-4 py-4">
                  <div className="grid gap-3 sm:grid-cols-4">
                    <div>
                      <div className="text-xs font-bold text-slate-500">
                        전체 행
                      </div>
                      <div className="mt-1 text-xl font-extrabold text-slate-950">
                        {uploadStats.total}
                      </div>
                    </div>
                    <div>
                      <div className="text-xs font-bold text-slate-500">
                        등록 가능
                      </div>
                      <div className="mt-1 text-xl font-extrabold text-blue-700">
                        {uploadStats.ready}
                      </div>
                    </div>
                    <div>
                      <div className="text-xs font-bold text-slate-500">
                        오류
                      </div>
                      <div className="mt-1 text-xl font-extrabold text-rose-600">
                        {uploadStats.errorCount}
                      </div>
                    </div>
                    <div>
                      <div className="text-xs font-bold text-slate-500">
                        빈칸 확인
                      </div>
                      <div className="mt-1 text-xl font-extrabold text-amber-600">
                        {uploadStats.noticeCount}
                      </div>
                    </div>
                  </div>
                </section>

                <section className="mt-5">
                  {!uploadRows.length ? (
                    <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-5 py-14 text-center">
                      <div className="text-sm font-extrabold text-slate-700">
                        업로드한 Excel 파일이 없습니다.
                      </div>
                      <p className="mt-2 text-sm font-semibold text-slate-500">
                        양식의 컬럼은 단어, 학생용 풀이, 관련 단원, 태그입니다.
                      </p>
                    </div>
                  ) : (
                    <div className="overflow-hidden rounded-lg border border-slate-200">
                      <div className="max-h-[calc(100vh-22rem)] overflow-auto">
                        <table className="min-w-full divide-y divide-slate-200 text-left text-sm">
                          <thead className="sticky top-0 bg-slate-50">
                            <tr>
                              {[
                                "행",
                                "단어",
                                "학생용 풀이",
                                "관련 단원",
                                "태그",
                                "검사 결과",
                              ].map((header) => (
                                <th
                                  key={header}
                                  scope="col"
                                  className="whitespace-nowrap px-3 py-3 text-xs font-extrabold text-slate-600"
                                >
                                  {header}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100 bg-white">
                            {uploadRows.map((row) => (
                              <tr
                                key={row.id}
                                className={
                                  row.errors.length
                                    ? "bg-rose-50/50"
                                    : row.notices.length
                                      ? "bg-amber-50/40"
                                      : "bg-white"
                                }
                              >
                                <td className="whitespace-nowrap px-3 py-3 text-xs font-bold text-slate-500">
                                  {row.rowNumber}
                                </td>
                                <td className="max-w-[10rem] px-3 py-3 font-extrabold text-slate-900">
                                  <span className="line-clamp-2">
                                    {row.word || "-"}
                                  </span>
                                </td>
                                <td className="min-w-[18rem] px-3 py-3 text-slate-700">
                                  <span className="line-clamp-3 leading-6">
                                    {row.definition || "-"}
                                  </span>
                                </td>
                                <td className="max-w-[12rem] px-3 py-3 text-slate-600">
                                  <span className="line-clamp-2">
                                    {row.relatedUnitId || "-"}
                                  </span>
                                </td>
                                <td className="min-w-[12rem] px-3 py-3">
                                  <div className="flex flex-wrap gap-1.5">
                                    {row.tags.length ? (
                                      row.tags.map((tag) => (
                                        <span
                                          key={`${row.id}-${tag}`}
                                          className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-bold text-slate-600"
                                        >
                                          {tag}
                                        </span>
                                      ))
                                    ) : (
                                      <span className="text-xs font-semibold text-slate-400">
                                        -
                                      </span>
                                    )}
                                  </div>
                                </td>
                                <td className="min-w-[12rem] px-3 py-3">
                                  <div className="flex flex-wrap gap-1.5">
                                    {row.errors.length ? (
                                      row.errors.map((error) => (
                                        <span
                                          key={`${row.id}-${error}`}
                                          className="rounded-full bg-rose-100 px-2 py-0.5 text-[11px] font-extrabold text-rose-700"
                                        >
                                          {error}
                                        </span>
                                      ))
                                    ) : (
                                      <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-extrabold text-blue-700">
                                        등록 가능
                                      </span>
                                    )}
                                    {row.notices.map((notice) => (
                                      <span
                                        key={`${row.id}-${notice}`}
                                        className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-extrabold text-amber-700"
                                      >
                                        {notice}
                                      </span>
                                    ))}
                                  </div>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </section>

                <div className="mt-7 flex flex-wrap justify-end gap-3 border-t border-slate-100 pt-5">
                  <button
                    type="button"
                    onClick={handleClearUploadPreview}
                    disabled={!uploadRows.length || Boolean(busyMessage)}
                    className="inline-flex min-h-11 items-center justify-center rounded-lg border border-slate-200 bg-white px-5 text-sm font-extrabold text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    미리보기 비우기
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleRegisterUploadRows()}
                    disabled={
                      Boolean(busyMessage) ||
                      !uploadReadyRows.length ||
                      uploadStats.errorCount > 0
                    }
                    className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-blue-600 px-6 text-sm font-extrabold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500"
                  >
                    <i
                      className="fas fa-database text-xs"
                      aria-hidden="true"
                    ></i>
                    등록하기
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="truncate text-2xl font-extrabold tracking-tight text-slate-950">
                        {word.trim() || "새 풀이"}
                      </h2>
                      {selectedRequest && (
                        <span className="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-extrabold text-amber-700">
                          요청 처리
                        </span>
                      )}
                      {selectedTerm && (
                        <span className="rounded-full bg-blue-50 px-2.5 py-1 text-xs font-extrabold text-blue-700">
                          등록됨
                        </span>
                      )}
                    </div>
                  </div>
                  {selectedTerm && (
                    <div className="text-xs font-semibold text-slate-400">
                      마지막 수정{" "}
                      {timestampLabel(
                        selectedTerm.updatedAt ||
                          selectedTerm.publishedAt ||
                          selectedTerm.createdAt,
                      )}
                    </div>
                  )}
                </div>

                {selectedRequest && (
                  <section className="mt-5 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <div className="text-xs font-bold uppercase tracking-[0.18em] text-slate-400">
                          학생 요청
                        </div>
                        <div className="mt-1 text-sm font-extrabold text-slate-900">
                          {selectedRequest.grade}학년 {selectedRequest.class}반{" "}
                          {selectedRequest.number}번 ·{" "}
                          {selectedRequest.studentName || "학생"}
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="rounded-full bg-white px-3 py-1.5 text-xs font-extrabold text-slate-600 shadow-sm">
                          같은 단어 대기 {sameWordOpenCount}건
                        </div>
                        <button
                          type="button"
                          onClick={() => void handleRejectRequestWord()}
                          disabled={Boolean(busyMessage)}
                          className="inline-flex min-h-9 items-center justify-center gap-2 rounded-lg border border-rose-100 bg-white px-3 text-xs font-extrabold text-rose-600 shadow-sm transition hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          <i
                            className="fas fa-trash-can text-[11px]"
                            aria-hidden="true"
                          ></i>
                          요청 삭제
                        </button>
                      </div>
                    </div>
                    {selectedRequest.memo && (
                      <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-slate-700">
                        {selectedRequest.memo}
                      </p>
                    )}
                  </section>
                )}

                {selectedRequest && matchingTerm && (
                  <section className="mt-5 rounded-lg border border-blue-100 bg-blue-50 px-4 py-3">
                    <div className="flex items-start gap-3">
                      <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white text-blue-600">
                        <i
                          className="fas fa-circle-info text-xs"
                          aria-hidden="true"
                        ></i>
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-extrabold text-blue-900">
                          이미 등록된 뜻풀이가 있습니다.
                        </div>
                        <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-blue-900">
                          {matchingTerm.definition}
                        </p>
                        <div className="mt-3 flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() =>
                              void handleApproveExisting(selectedRequest.id)
                            }
                            disabled={Boolean(busyMessage)}
                            className="inline-flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-3 py-2 text-xs font-extrabold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            <i className="fas fa-check text-[11px]"></i>이
                            요청만 승인
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleApproveExisting()}
                            disabled={Boolean(busyMessage)}
                            className="inline-flex items-center justify-center gap-2 rounded-lg border border-blue-100 bg-white px-3 py-2 text-xs font-extrabold text-blue-700 transition hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            같은 단어 모두 승인
                          </button>
                        </div>
                      </div>
                    </div>
                  </section>
                )}

                <section className="mt-6 space-y-5">
                  <label className="block">
                    <span className="text-sm font-extrabold text-slate-800">
                      단어
                    </span>
                    <input
                      type="text"
                      value={word}
                      onChange={(event) => setWord(event.target.value)}
                      maxLength={40}
                      className="mt-2 h-12 w-full rounded-lg border border-slate-200 bg-white px-4 text-base font-semibold text-slate-900 outline-none transition focus:border-blue-400 focus:ring-4 focus:ring-blue-100"
                    />
                  </label>

                  <label className="block">
                    <span className="text-sm font-extrabold text-slate-800">
                      학생용 역사 풀이
                    </span>
                    <textarea
                      value={definition}
                      onChange={(event) => setDefinition(event.target.value)}
                      maxLength={1200}
                      className="mt-2 min-h-[14rem] w-full resize-y rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm leading-7 text-slate-800 outline-none transition focus:border-blue-400 focus:ring-4 focus:ring-blue-100"
                      placeholder="학생 수준과 현재 수업 맥락에 맞게 풀이를 적어 주세요."
                    />
                    <span className="mt-2 block text-right text-xs font-semibold text-slate-400">
                      {definition.length} / 1200
                    </span>
                  </label>

                  <section>
                    <div className="mb-2 text-sm font-extrabold text-slate-800">
                      관련 단원 / 태그
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {relatedUnitId && (
                        <span className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1.5 text-xs font-bold text-slate-600">
                          {relatedUnitId}
                          <button
                            type="button"
                            onClick={() => setRelatedUnitId("")}
                            className="text-slate-400 transition hover:text-slate-700"
                            aria-label={`${relatedUnitId} 태그 제거`}
                          >
                            <i className="fas fa-times text-[10px]"></i>
                          </button>
                        </span>
                      )}
                      {tags.map((tag) => (
                        <span
                          key={tag}
                          className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1.5 text-xs font-bold text-slate-600"
                        >
                          {tag}
                          <button
                            type="button"
                            onClick={() => handleRemoveTag(tag)}
                            className="text-slate-400 transition hover:text-slate-700"
                            aria-label={`${tag} 태그 제거`}
                          >
                            <i className="fas fa-times text-[10px]"></i>
                          </button>
                        </span>
                      ))}
                      {!relatedUnitId && !tags.length && (
                        <span className="rounded-full bg-slate-100 px-3 py-1.5 text-xs font-bold text-slate-400">
                          태그 없음
                        </span>
                      )}
                    </div>
                    <div className="mt-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_8.25rem]">
                      <input
                        type="text"
                        value={tagInput}
                        onChange={(event) => setTagInput(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key !== "Enter") return;
                          event.preventDefault();
                          handleAddTag();
                        }}
                        maxLength={24}
                        className="h-11 w-full rounded-lg border border-slate-200 bg-white px-4 text-sm text-slate-800 outline-none transition focus:border-blue-400 focus:ring-4 focus:ring-blue-100"
                        placeholder="태그 입력 후 Enter"
                      />
                      <button
                        type="button"
                        onClick={handleAddTag}
                        disabled={!normalizeTag(tagInput) || tags.length >= 12}
                        className="inline-flex h-11 items-center justify-center gap-2 rounded-lg border border-blue-100 bg-blue-50 px-4 text-sm font-extrabold text-blue-700 transition hover:bg-blue-100 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-400"
                      >
                        <i
                          className="fas fa-plus text-xs"
                          aria-hidden="true"
                        ></i>
                        태그 추가
                      </button>
                    </div>
                    <input
                      type="text"
                      value={relatedUnitId}
                      onChange={(event) => setRelatedUnitId(event.target.value)}
                      maxLength={120}
                      className="mt-2 h-11 w-full rounded-lg border border-slate-200 bg-white px-4 text-sm text-slate-800 outline-none transition focus:border-blue-400 focus:ring-4 focus:ring-blue-100"
                      placeholder="관련 단원 ID 또는 단원명"
                    />
                  </section>

                  <section>
                    <div className="mb-2 text-sm font-extrabold text-slate-800">
                      처리 범위
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <span className="rounded-full bg-slate-100 px-3 py-1.5 text-xs font-bold text-slate-600">
                        학생용 풀이
                      </span>
                      {selectedRequest && (
                        <span className="rounded-full bg-amber-50 px-3 py-1.5 text-xs font-bold text-amber-700">
                          요청 {sameWordOpenCount}건 연결
                        </span>
                      )}
                      {selectedTerm?.status && (
                        <span className="rounded-full bg-blue-50 px-3 py-1.5 text-xs font-bold text-blue-700">
                          {selectedTerm.status === "published"
                            ? "공개됨"
                            : selectedTerm.status}
                        </span>
                      )}
                      {tags.map((tag) => (
                        <span
                          key={`scope-${tag}`}
                          className="rounded-full bg-slate-100 px-3 py-1.5 text-xs font-bold text-slate-600"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  </section>
                </section>

                <div className="mt-7 flex flex-wrap justify-end gap-3 border-t border-slate-100 pt-5">
                  <button
                    type="button"
                    onClick={handleNewTerm}
                    className="inline-flex min-h-11 items-center justify-center rounded-lg border border-slate-200 bg-white px-5 text-sm font-extrabold text-slate-600 transition hover:bg-slate-50"
                  >
                    취소
                  </button>
                  {selectedRequest && matchingTerm && (
                    <button
                      type="button"
                      onClick={() => void handleApproveExisting()}
                      disabled={Boolean(busyMessage)}
                      className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-blue-100 bg-blue-50 px-5 text-sm font-extrabold text-blue-700 transition hover:bg-blue-100 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
                    >
                      <i
                        className="fas fa-check text-xs"
                        aria-hidden="true"
                      ></i>
                      기존 풀이 승인
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => void handleSaveTerm()}
                    disabled={
                      Boolean(busyMessage) ||
                      !word.trim() ||
                      definition.trim().length < 5
                    }
                    className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-blue-600 px-6 text-sm font-extrabold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500"
                  >
                    <i
                      className="fas fa-floppy-disk text-xs"
                      aria-hidden="true"
                    ></i>
                    풀이 저장 및 배포
                  </button>
                </div>
              </>
            )}
          </main>
        </div>
      </div>

      {busyMessage && <LoadingOverlay message={busyMessage} />}
    </div>
  );
};

export default ManageHistoryDictionary;
