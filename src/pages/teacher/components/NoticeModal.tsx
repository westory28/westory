import React, { useEffect, useId, useRef, useState } from "react";
import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
} from "firebase/firestore";
import { useAppToast } from "../../../components/common/AppToastProvider";
import { useAuth } from "../../../contexts/AuthContext";
import { db } from "../../../lib/firebase";
import {
  NOTICE_IMAGE_RECOMMENDED_HEIGHT,
  NOTICE_IMAGE_RECOMMENDED_WIDTH,
  uploadNoticeImage,
  tryDeleteNoticeImage,
} from "../../../lib/noticeImages";
import {
  DEVELOPER_LOG_ITEMS_COLLECTION,
  DEVELOPER_LOG_SETTINGS_DOC,
  normalizeDeveloperLogPost,
  type DeveloperLogPost,
} from "../../../lib/developerLogs";

interface NoticeModalProps {
  isOpen: boolean;
  onClose: () => void;
  noticeData?: any;
  onSave: () => void;
  embedded?: boolean;
  onBusyChange?: (busy: boolean) => void;
  onDirtyChange?: (dirty: boolean) => void;
  onPreview?: (url: string) => void;
  recommendedImageSize?: { width: number; height: number };
}

const NOTICE_CATEGORIES = [
  { val: "normal", label: "공지" },
  { val: "event", label: "학교 행사" },
  { val: "exam", label: "정기 시험" },
  { val: "performance", label: "수행평가" },
  { val: "prep", label: "준비" },
  { val: "dday", label: "D-Day" },
] as const;

const toLocalDateTimeInputValue = (value?: unknown) => {
  if (!value) return "";
  const date =
    typeof (value as { toDate?: () => Date }).toDate === "function"
      ? (value as { toDate: () => Date }).toDate()
      : new Date(value as string | number | Date);
  if (Number.isNaN(date.getTime())) return "";
  const offsetDate = new Date(
    date.getTime() - date.getTimezoneOffset() * 60000,
  );
  return offsetDate.toISOString().slice(0, 16);
};

const getDefaultPublishAt = () => toLocalDateTimeInputValue(new Date());

const NoticeModal: React.FC<NoticeModalProps> = ({
  isOpen,
  onClose,
  noticeData,
  onSave,
  embedded = false,
  onBusyChange,
  onDirtyChange,
  onPreview,
  recommendedImageSize,
}) => {
  const { config } = useAuth();
  const { showToast } = useAppToast();
  const fileInputId = useId();
  const [category, setCategory] = useState("event");
  const [targetType, setTargetType] = useState("common");
  const [targetGrade, setTargetGrade] = useState("1");
  const [targetClass, setTargetClass] = useState("1");
  const [targetDate, setTargetDate] = useState("");
  const [publishAt, setPublishAt] = useState(getDefaultPublishAt);
  const [expiresAt, setExpiresAt] = useState("");
  const [developerLogPostId, setDeveloperLogPostId] = useState("");
  const [developerLogPosts, setDeveloperLogPosts] = useState<
    DeveloperLogPost[]
  >([]);
  const [developerLogLoading, setDeveloperLogLoading] = useState(false);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const inFlight = useRef(false);
  const dirty = useRef(false);
  const callbacks = useRef({ onBusyChange, onDirtyChange });
  callbacks.current = { onBusyChange, onDirtyChange };

  useEffect(() => {
    callbacks.current.onBusyChange?.(loading);
  }, [loading]);

  useEffect(
    () => () => {
      callbacks.current.onBusyChange?.(false);
      callbacks.current.onDirtyChange?.(false);
    },
    [],
  );

  useEffect(() => {
    dirty.current = false;
    callbacks.current.onDirtyChange?.(false);
    if (!isOpen) return;

    if (noticeData) {
      setCategory(noticeData.category || "event");
      setTargetType(noticeData.targetType || "common");
      const [grade, className] = (noticeData.targetClass || "1-1").split("-");
      setTargetGrade(grade || "1");
      setTargetClass(className || "1");
      setTargetDate(noticeData.targetDate || "");
      setPublishAt(
        toLocalDateTimeInputValue(noticeData.publishAt) ||
          getDefaultPublishAt(),
      );
      setExpiresAt(toLocalDateTimeInputValue(noticeData.expiresAt));
      setDeveloperLogPostId(String(noticeData.developerLogPostId || ""));
      setPreviewUrl(noticeData.imageUrl || "");
      setImageFile(null);
      return;
    }

    setCategory("event");
    setTargetType("common");
    setTargetGrade("1");
    setTargetClass("1");
    setTargetDate("");
    setPublishAt(getDefaultPublishAt());
    setExpiresAt("");
    setDeveloperLogPostId("");
    setPreviewUrl("");
    setImageFile(null);
  }, [isOpen, noticeData]);

  useEffect(() => {
    if (!isOpen) return undefined;

    let active = true;
    setDeveloperLogLoading(true);

    void getDocs(
      query(
        collection(
          db,
          "site_settings",
          DEVELOPER_LOG_SETTINGS_DOC,
          DEVELOPER_LOG_ITEMS_COLLECTION,
        ),
        orderBy("publishedAt", "desc"),
        limit(80),
      ),
    )
      .then((snapshot) => {
        if (!active) return;
        setDeveloperLogPosts(
          snapshot.docs.map((item) =>
            normalizeDeveloperLogPost(item.id, item.data()),
          ),
        );
      })
      .catch((error) => {
        console.error("Failed to load developer logs for notice link:", error);
        if (active) setDeveloperLogPosts([]);
      })
      .finally(() => {
        if (active) setDeveloperLogLoading(false);
      });

    return () => {
      active = false;
    };
  }, [isOpen]);

  useEffect(() => {
    if (!imageFile) return undefined;
    const objectUrl = URL.createObjectURL(imageFile);
    setPreviewUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [imageFile]);

  if (!isOpen) return null;

  const handleSave = async () => {
    if (!config || inFlight.current) return;
    if (!imageFile && !noticeData?.imageUrl) {
      showToast({
        tone: "warning",
        title: "알림장 이미지를 선택해 주세요.",
        message: "학생에게 표시할 압축 이미지가 필요합니다.",
      });
      return;
    }
    const publishDate = publishAt ? new Date(publishAt) : new Date();
    const expireDate = expiresAt ? new Date(expiresAt) : null;
    if (Number.isNaN(publishDate.getTime())) {
      showToast({
        tone: "warning",
        title: "공개 시작 일시를 확인해 주세요.",
        message: "예약 공개에 사용할 시작 일시가 올바르지 않습니다.",
      });
      return;
    }
    if (expireDate && Number.isNaN(expireDate.getTime())) {
      showToast({
        tone: "warning",
        title: "공개 종료 일시를 확인해 주세요.",
        message: "알림장이 내려갈 종료 일시가 올바르지 않습니다.",
      });
      return;
    }
    if (expireDate && expireDate <= publishDate) {
      showToast({
        tone: "warning",
        title: "공개 기간을 확인해 주세요.",
        message: "종료 일시는 시작 일시보다 뒤여야 합니다.",
      });
      return;
    }
    inFlight.current = true;
    callbacks.current.onBusyChange?.(true);
    setLoading(true);

    try {
      const path = `years/${config.year}/semesters/${config.semester}/notices`;
      const docRef = noticeData
        ? doc(db, path, noticeData.id)
        : doc(collection(db, path));
      let imagePayload = {
        imageUrl: noticeData?.imageUrl || "",
        imageStoragePath: noticeData?.imageStoragePath || "",
        imageWidth: noticeData?.imageWidth || 0,
        imageHeight: noticeData?.imageHeight || 0,
        imageByteSize: noticeData?.imageByteSize || 0,
        imageMimeType: noticeData?.imageMimeType || "",
      };

      if (imageFile) {
        imagePayload = await uploadNoticeImage({
          config,
          noticeId: docRef.id,
          file: imageFile,
        });
      }

      const data: Record<string, unknown> = {
        category,
        content: noticeData?.content || "",
        targetType,
        targetClass:
          targetType === "class" ? `${targetGrade}-${targetClass}` : null,
        targetDate: category === "dday" && targetDate ? targetDate : null,
        publishAt: Timestamp.fromDate(publishDate),
        expiresAt: expireDate ? Timestamp.fromDate(expireDate) : null,
        developerLogPostId: developerLogPostId || null,
        ...imagePayload,
        updatedAt: serverTimestamp(),
      };

      if (!noticeData) {
        data.createdAt = serverTimestamp();
        data.noticeOrder = -Date.now();
      }

      await setDoc(docRef, data, { merge: true });
      if (imageFile && noticeData?.imageStoragePath) {
        void tryDeleteNoticeImage(noticeData.imageStoragePath);
      }
      dirty.current = false;
      callbacks.current.onDirtyChange?.(false);
      onSave();
      showToast({
        tone: "success",
        title: noticeData
          ? "알림장 이미지가 수정되었습니다."
          : "알림장 이미지가 게시되었습니다.",
        message: "학생 화면에는 압축된 이미지로 표시됩니다.",
      });
      onClose();
    } catch (error) {
      console.error("Error saving notice:", error);
      showToast({
        tone: "error",
        title: "알림장 저장에 실패했습니다.",
        message:
          error instanceof Error
            ? error.message
            : "잠시 후 다시 시도해 주세요.",
      });
    } finally {
      inFlight.current = false;
      callbacks.current.onBusyChange?.(false);
      setLoading(false);
    }
  };

  const handleDelete = async () => {
    if (
      inFlight.current ||
      !noticeData ||
      !config ||
      !confirm("이 알림장 이미지를 삭제하시겠습니까?")
    )
      return;
    inFlight.current = true;
    callbacks.current.onBusyChange?.(true);
    setLoading(true);
    try {
      const path = `years/${config.year}/semesters/${config.semester}/notices`;
      await deleteDoc(doc(db, path, noticeData.id));
      void tryDeleteNoticeImage(noticeData.imageStoragePath);
      dirty.current = false;
      callbacks.current.onDirtyChange?.(false);
      onSave();
      showToast({
        tone: "success",
        title: "알림장 이미지가 삭제되었습니다.",
      });
      onClose();
    } catch (error) {
      console.error("Error deleting notice:", error);
      showToast({
        tone: "error",
        title: "알림장 삭제에 실패했습니다.",
        message: "잠시 후 다시 시도해 주세요.",
      });
    } finally {
      inFlight.current = false;
      callbacks.current.onBusyChange?.(false);
      setLoading(false);
    }
  };

  const closeEditor = () => {
    if (inFlight.current) return;
    if (dirty.current && !confirm("저장하지 않은 변경을 취소하시겠습니까?"))
      return;
    onClose();
  };
  const inputClass =
    "min-h-11 w-full min-w-0 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-bold outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-200 disabled:bg-gray-50 disabled:text-gray-400";
  const labelClass = "mb-1 block text-sm font-extrabold text-gray-800";
  const title = noticeData ? "알림장 이미지 수정" : "알림장 이미지 등록";
  const editor = (
    <form
      className="notice-image-editor"
      aria-busy={loading}
      onSubmit={(event) => {
        event.preventDefault();
        void handleSave();
      }}
      onChangeCapture={() => {
        if (!inFlight.current) {
          dirty.current = true;
          callbacks.current.onDirtyChange?.(true);
        }
      }}
    >
      {embedded && (
        <h3 className="mb-3 text-lg font-extrabold text-gray-900">{title}</h3>
      )}
      <fieldset
        disabled={loading}
        className="notice-image-editor__columns min-w-0"
      >
        <legend className="sr-only">{title}</legend>
        <div className="min-w-0 space-y-2">
          <label htmlFor={fileInputId} className={labelClass}>
            알림장 이미지
          </label>
          <div className="overflow-hidden rounded-lg border border-gray-200 bg-gray-50">
            {previewUrl ? (
              <img
                src={previewUrl}
                alt="알림장 미리보기"
                className="aspect-[16/9] max-h-[180px] w-full object-contain"
              />
            ) : (
              <div className="flex aspect-[16/9] max-h-[180px] items-center justify-center text-sm font-bold text-gray-500">
                이미지를 선택해 주세요.
              </div>
            )}
          </div>
          <input
            id={fileInputId}
            type="file"
            accept="image/*"
            aria-describedby={`${fileInputId}-help`}
            onChange={(event) => {
              const file = event.target.files?.[0] || null;
              setImageFile(file);
              if (!file) setPreviewUrl(noticeData?.imageUrl || "");
            }}
            className="min-h-11 w-full min-w-0 rounded-lg border border-gray-300 p-2 text-sm focus:ring-2 focus:ring-blue-200"
          />
          <p
            id={`${fileInputId}-help`}
            className="text-xs leading-5 text-gray-500"
          >
            권장 {recommendedImageSize?.width ?? NOTICE_IMAGE_RECOMMENDED_WIDTH}{" "}
            × {recommendedImageSize?.height ?? NOTICE_IMAGE_RECOMMENDED_HEIGHT}
            px
            {recommendedImageSize ? " · 현재 화면 기준" : ""}
            {" · 16:9 중앙 맞춤·압축"}
          </p>
          {noticeData && (
            <p className="text-xs leading-5 text-gray-500">
              선택하지 않으면 기존 이미지를 유지합니다.
            </p>
          )}
          {previewUrl && onPreview && (
            <button
              type="button"
              onClick={() => onPreview(previewUrl)}
              className="min-h-11 rounded-lg border border-gray-200 px-3 text-sm font-bold text-gray-700 disabled:opacity-50"
            >
              크게 미리보기
            </button>
          )}
        </div>
        <div className="min-w-0 space-y-3">
          <div>
            <div className="notice-image-editor__period">
              <label className="block min-w-0">
                <span className={labelClass}>공개 시작</span>
                <input
                  type="datetime-local"
                  value={publishAt}
                  onChange={(event) => setPublishAt(event.target.value)}
                  className={inputClass}
                  aria-describedby={`${fileInputId}-period-help`}
                />
              </label>
              <label className="block min-w-0">
                <span className={labelClass}>공개 종료</span>
                <input
                  type="datetime-local"
                  value={expiresAt}
                  onChange={(event) => setExpiresAt(event.target.value)}
                  className={inputClass}
                  aria-describedby={`${fileInputId}-period-help`}
                />
              </label>
            </div>
            <p
              id={`${fileInputId}-period-help`}
              className="mt-1 text-xs leading-5 text-gray-500"
            >
              시작 공란: 바로 공개 · 종료 공란: 계속 공개
            </p>
          </div>
          <div className="notice-image-editor__pair">
            <label className="block min-w-0">
              <span className={labelClass}>분류</span>
              <select
                value={category}
                onChange={(event) => setCategory(event.target.value)}
                className={inputClass}
              >
                {!NOTICE_CATEGORIES.some(
                  (option) => option.val === category,
                ) && (
                  <option value={category}>
                    {category === "notice" ? "공지" : "기존 분류"}
                  </option>
                )}
                {NOTICE_CATEGORIES.map((option) => (
                  <option key={option.val} value={option.val}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="block min-w-0">
              <span className={labelClass}>대상</span>
              <select
                value={targetType}
                onChange={(event) => setTargetType(event.target.value)}
                className={inputClass}
              >
                <option
                  value={noticeData?.targetType === "all" ? "all" : "common"}
                >
                  전체 공통
                </option>
                <option value="class">반 선택</option>
              </select>
            </label>
          </div>
          {(category === "dday" || targetType === "class") && (
            <div className="notice-image-editor__pair">
              {category === "dday" && (
                <label className="block min-w-0">
                  <span className={labelClass}>목표 날짜</span>
                  <input
                    type="date"
                    value={targetDate}
                    onChange={(event) => setTargetDate(event.target.value)}
                    className={inputClass}
                  />
                </label>
              )}
              {targetType === "class" && (
                <div className="notice-image-editor__pair">
                  <label className="block min-w-0">
                    <span className={labelClass}>학년</span>
                    <select
                      value={targetGrade}
                      onChange={(event) => setTargetGrade(event.target.value)}
                      className={inputClass}
                    >
                      {!["1", "2", "3"].includes(targetGrade) && (
                        <option value={targetGrade}>{targetGrade}학년</option>
                      )}
                      {[1, 2, 3].map((grade) => (
                        <option key={grade} value={grade}>
                          {grade}학년
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="block min-w-0">
                    <span className={labelClass}>반</span>
                    <select
                      value={targetClass}
                      onChange={(event) => setTargetClass(event.target.value)}
                      className={inputClass}
                    >
                      {!Array.from({ length: 12 }, (_, index) =>
                        String(index + 1),
                      ).includes(targetClass) && (
                        <option value={targetClass}>{targetClass}반</option>
                      )}
                      {Array.from({ length: 12 }, (_, index) => index + 1).map(
                        (className) => (
                          <option key={className} value={className}>
                            {className}반
                          </option>
                        ),
                      )}
                    </select>
                  </label>
                </div>
              )}
            </div>
          )}
          <label className="block min-w-0">
            <span className={labelClass}>연동 게시물</span>
            <select
              value={developerLogPostId}
              onChange={(event) => setDeveloperLogPostId(event.target.value)}
              disabled={loading || developerLogLoading}
              className={inputClass}
              aria-describedby={`${fileInputId}-post-help`}
            >
              <option value="">
                {developerLogLoading ? "게시물 불러오는 중..." : "연동 없음"}
              </option>
              {developerLogPostId &&
                !developerLogPosts.some(
                  (post) => post.id === developerLogPostId,
                ) && (
                  <option value={developerLogPostId}>현재 연결된 게시물</option>
                )}
              {developerLogPosts.map((post) => (
                <option key={post.id} value={post.id}>
                  {post.version ? `[${post.version}] ` : ""}
                  {post.title || "제목 없는 게시물"}
                </option>
              ))}
            </select>
            <span
              id={`${fileInputId}-post-help`}
              className="mt-1 block text-xs leading-5 text-gray-500"
            >
              학생이 이미지를 누르면 연결한 개발자 일지로 이동합니다.
            </span>
          </label>
        </div>
      </fieldset>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-gray-100 pt-3">
        <div>
          {noticeData && (
            <button
              type="button"
              onClick={() => void handleDelete()}
              disabled={loading}
              className="min-h-11 rounded-lg px-3 text-sm font-extrabold text-red-600 hover:bg-red-50 disabled:opacity-50"
            >
              삭제
            </button>
          )}
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={closeEditor}
            disabled={loading}
            className="min-h-11 rounded-lg border border-gray-200 px-4 text-sm font-extrabold text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            취소
          </button>
          <button
            type="submit"
            disabled={loading}
            className="min-h-11 rounded-lg bg-blue-600 px-5 text-sm font-extrabold text-white transition hover:bg-blue-700 disabled:opacity-50"
          >
            {loading ? "저장 중..." : noticeData ? "수정 저장" : "게시하기"}
          </button>
        </div>
      </div>
    </form>
  );

  if (embedded) return editor;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={closeEditor}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${fileInputId}-title`}
        className="relative max-h-[90vh] w-full max-w-4xl overflow-y-auto rounded-xl bg-white shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
          <h3
            id={`${fileInputId}-title`}
            className="text-xl font-extrabold text-gray-900"
          >
            <i
              className="fas fa-image mr-2 text-blue-600"
              aria-hidden="true"
            ></i>
            {title}
          </h3>
          <button
            type="button"
            onClick={closeEditor}
            disabled={loading}
            className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-full text-gray-400 hover:bg-gray-50 hover:text-gray-700 disabled:opacity-50"
            aria-label="닫기"
          >
            <i className="fas fa-times" aria-hidden="true"></i>
          </button>
        </div>
        <div className="p-4">{editor}</div>
      </div>
    </div>
  );
};

export default NoticeModal;
