import React, { useEffect, useMemo, useRef, useState } from "react";
import "./developerEventArticles.css";
import "./developerLog.css";
import { sanitizeRichHtml } from "../lib/sanitizeRichHtml";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
} from "firebase/firestore";
import { db } from "../lib/firebase";
import { useAuth } from "../contexts/AuthContext";
import { useAppToast } from "../components/common/AppToastProvider";
import {
  InlineLoading,
  LoadingOverlay,
  PageLoading,
} from "../components/common/LoadingState";
import QuillEditor from "../components/common/QuillEditor";
import NoticeImageArticle, {
  hasNoticeImageArticleMarkup,
} from "../components/common/NoticeImageArticle";
import {
  DEVELOPER_LOG_CATEGORIES,
  DEVELOPER_LOG_ITEMS_COLLECTION,
  DEVELOPER_LOG_SETTINGS_DOC,
  type DeveloperLogCategory,
  type DeveloperLogImage,
  type DeveloperLogPost,
  getDeveloperLogCategoryMeta,
  normalizeDeveloperLogPost,
} from "../lib/developerLogs";
import {
  tryDeleteDeveloperLogImage,
  uploadDeveloperLogImage,
} from "../lib/developerLogImages";
import { isDeveloperUser } from "../lib/permissions";
import { setDeveloperLogLike } from "../lib/developerLogLikes";
import DeveloperLogLikeStudentsDialog from "./DeveloperLogLikeStudentsDialog";

type SortMode = "latest" | "views" | "likes";

interface FormState {
  title: string;
  version: string;
  category: DeveloperLogCategory;
  summary: string;
  bodyHtml: string;
  action: "wispi" | "";
  isPinned: boolean;
  images: DeveloperLogImage[];
}

const EMPTY_FORM: FormState = {
  title: "",
  version: "",
  category: "feature",
  summary: "",
  bodyHtml: "",
  action: "",
  isPinned: false,
  images: [],
};

const MAX_CARD_IMAGE_COUNT = 20;
const VIEWED_STORAGE_PREFIX = "developerLogViewed:";

const getDeveloperLogItemsCollection = () =>
  collection(
    db,
    "site_settings",
    DEVELOPER_LOG_SETTINGS_DOC,
    DEVELOPER_LOG_ITEMS_COLLECTION,
  );

const getDeveloperLogPostRef = (id: string) =>
  doc(
    db,
    "site_settings",
    DEVELOPER_LOG_SETTINGS_DOC,
    DEVELOPER_LOG_ITEMS_COLLECTION,
    id,
  );

const toDate = (value: any) => {
  if (!value) return null;
  if (typeof value.toDate === "function") return value.toDate() as Date;
  if (value instanceof Date) return value;
  return null;
};

const formatDate = (value: any) => {
  const date = toDate(value);
  if (!date) return "-";
  return new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
    .format(date)
    .replace(/\.\s?/g, ".")
    .replace(/\.$/, "");
};

const stripHtml = (html: string) => {
  const template = document.createElement("template");
  template.innerHTML = html || "";
  // Include the image transcription in search without requesting any images.
  template.content.querySelectorAll("img").forEach((image) => {
    image.replaceWith(document.createTextNode(` ${image.alt} `));
  });
  return (template.content.textContent || "").replace(/\s+/g, " ").trim();
};

const getDisplayTitle = (post: Pick<DeveloperLogPost, "title" | "version">) =>
  post.version ? `[${post.version}] ${post.title}` : post.title;

const buildDraftPost = (
  form: FormState,
  currentUserName: string,
  id = "preview",
): DeveloperLogPost => ({
  id,
  title: form.title.trim() || "제목 미입력",
  version: form.version.trim(),
  category: form.category,
  summary: form.summary.trim(),
  bodyHtml: form.bodyHtml,
  action: form.action,
  images: form.images,
  isPinned: form.isPinned,
  viewCount: 0,
  likeCount: 0,
  createdBy: "",
  createdByName: currentUserName || "개발자",
  publishedAt: new Date(),
});

export const hasEventArticleMarkup = (bodyHtml: string) =>
  /<(?:article|div|section)\b[^>]*\bclass\s*=\s*(["'])[^"']*\bwestory-event-article\b[^"']*\1/i.test(
    bodyHtml,
  );

// Keep authored tables, inline images and section markup intact while editing.
// Quill's standard document model strips those structures on initialization.
export const EventArticleEditor: React.FC<{
  value: string;
  onChange: (value: string) => void;
}> = ({ value, onChange }) => {
  const editorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const editor = editorRef.current;
    const safeHtml = sanitizeRichHtml(value);
    if (editor && editor.innerHTML !== safeHtml) editor.innerHTML = safeHtml;
  }, [value]);

  return (
    <div
      ref={editorRef}
      className="developer-log-rich-text developer-log-event-editor"
      contentEditable
      suppressContentEditableWarning
      role="textbox"
      aria-label="본문"
      aria-multiline="true"
      onInput={(event) => onChange(event.currentTarget.innerHTML)}
      onPaste={(event) => {
        event.preventDefault();
        // Paste words without introducing external active HTML into the post.
        document.execCommand(
          "insertText",
          false,
          event.clipboardData.getData("text/plain"),
        );
        onChange(event.currentTarget.innerHTML);
      }}
      onDrop={(event) => event.preventDefault()}
    />
  );
};

const DeveloperLog: React.FC = () => {
  const { postId } = useParams();
  const navigate = useNavigate();
  const { currentUser, userData } = useAuth();
  const { showToast } = useAppToast();
  const canManage = isDeveloperUser(currentUser?.email);
  const canLike = userData?.role === "student";
  const canViewLikeStudents = userData?.role === "teacher" || canManage;
  const [likeStudentsPost, setLikeStudentsPost] = useState<{
    postId: string;
    owner: object;
    role: string | undefined;
  } | null>(null);
  const displayName = (userData?.name || "방재석 교사").trim();

  const [posts, setPosts] = useState<DeveloperLogPost[]>([]);
  const [listLoading, setListLoading] = useState(true);
  const [selectedPost, setSelectedPost] = useState<DeveloperLogPost | null>(
    null,
  );
  const [detailLoading, setDetailLoading] = useState(false);
  const [liked, setLiked] = useState(false);
  const [pendingLikeScope, setPendingLikeScope] = useState<string | null>(null);
  const likeScope = `${currentUser?.uid || ""}:${postId || ""}`;
  const activeLikeScope = useRef(likeScope);
  activeLikeScope.current = likeScope;
  const likeRequest = useRef<{ scope: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [pendingMutation, setPendingMutation] = useState(false);
  const mutationLock = useRef(false);
  const draftPostId = useRef<{ uid: string; id: string } | null>(null);
  const [mode, setMode] = useState<"list" | "detail" | "write" | "edit">(
    "list",
  );
  const [previewOpen, setPreviewOpen] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [newImageFiles, setNewImageFiles] = useState<File[]>([]);
  const [newImagePreviews, setNewImagePreviews] = useState<string[]>([]);
  const [expandedImage, setExpandedImage] = useState<{
    src: string;
    alt: string;
    label: string;
  } | null>(null);
  const [activeCardImageIndex, setActiveCardImageIndex] = useState(0);
  const cardSwipeStartRef = useRef<{ x: number; y: number } | null>(null);
  const [searchText, setSearchText] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<
    "all" | DeveloperLogCategory
  >("all");
  const [sortMode, setSortMode] = useState<SortMode>("latest");

  useEffect(() => {
    setLikeStudentsPost(null);
  }, [currentUser, userData?.role, postId, mode]);

  useEffect(() => {
    likeRequest.current = null;
    setPendingLikeScope(null);
    return () => {
      likeRequest.current = null;
    };
  }, [likeScope]);

  useEffect(() => {
    if (postId) return;
    setListLoading(true);
    const q = query(
      getDeveloperLogItemsCollection(),
      orderBy("publishedAt", "desc"),
      limit(60),
    );

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        setPosts(
          snapshot.docs.map((item) =>
            normalizeDeveloperLogPost(item.id, item.data()),
          ),
        );
        setListLoading(false);
      },
      (error) => {
        console.error("Failed to load developer logs:", error);
        setListLoading(false);
        showToast({
          tone: "error",
          title: "개발자 일지를 불러오지 못했습니다.",
        });
      },
    );

    return () => unsubscribe();
  }, [postId, currentUser?.uid, showToast]);

  useEffect(() => {
    if (!postId) {
      setMode((prev) => (prev === "write" ? prev : "list"));
      setSelectedPost(null);
      return;
    }

    let cancelled = false;
    setMode((prev) => (prev === "edit" && canManage ? "edit" : "detail"));
    setDetailLoading(true);
    setSelectedPost(null);
    setLiked(false);
    const postRef = getDeveloperLogPostRef(postId);

    void Promise.all([
      getDoc(postRef),
      currentUser && canLike
        ? getDoc(doc(postRef, "likes", currentUser.uid))
        : Promise.resolve(null),
    ])
      .then(([snapshot, likeSnapshot]) => {
        if (cancelled) return;
        if (!snapshot.exists()) {
          setSelectedPost(null);
          showToast({
            tone: "warning",
            title: "게시글을 찾지 못했습니다.",
          });
          navigate("/developer-log", { replace: true });
          return;
        }

        const post = normalizeDeveloperLogPost(snapshot.id, snapshot.data());
        setSelectedPost(post);
        setForm({
          title: post.title,
          version: post.version,
          category: post.category,
          summary: post.summary,
          bodyHtml: post.bodyHtml,
          action: post.action || "",
          isPinned: post.isPinned,
          images: post.images,
        });

        setLiked(likeSnapshot?.exists() || false);

        const viewedKey = `${VIEWED_STORAGE_PREFIX}${post.id}`;
        if (
          typeof window !== "undefined" &&
          !window.localStorage.getItem(viewedKey)
        ) {
          window.localStorage.setItem(viewedKey, "1");
          void updateDoc(postRef, { viewCount: post.viewCount + 1 }).catch(
            (error) => {
              console.warn("Failed to update developer log view count:", error);
            },
          );
          setSelectedPost((prev) =>
            prev && prev.id === post.id
              ? { ...prev, viewCount: prev.viewCount + 1 }
              : prev,
          );
        }
      })
      .catch((error) => {
        if (cancelled) return;
        console.error("Failed to load developer log:", error);
        showToast({
          tone: "error",
          title: "게시글을 불러오지 못했습니다.",
        });
      })
      .finally(() => {
        if (!cancelled) setDetailLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [currentUser?.uid, canLike, canManage, navigate, postId, showToast]);

  useEffect(() => {
    const previews = newImageFiles.map((file) => URL.createObjectURL(file));
    setNewImagePreviews(previews);
    return () => previews.forEach((url) => URL.revokeObjectURL(url));
  }, [newImageFiles]);

  useEffect(() => {
    setActiveCardImageIndex(0);
    cardSwipeStartRef.current = null;
  }, [mode, postId, previewOpen]);

  const filteredPosts = useMemo(() => {
    const keyword = searchText.replace(/\s+/g, " ").trim().toLowerCase();
    const nextPosts = posts
      .filter(
        (post) => categoryFilter === "all" || post.category === categoryFilter,
      )
      .filter((post) => {
        if (!keyword) return true;
        const haystack = [
          post.title,
          post.version,
          post.summary,
          stripHtml(post.bodyHtml),
        ]
          .join(" ")
          .toLowerCase();
        return haystack.includes(keyword);
      });

    return nextPosts.sort((left, right) => {
      if (left.isPinned !== right.isPinned) return left.isPinned ? -1 : 1;
      if (sortMode === "views") return right.viewCount - left.viewCount;
      if (sortMode === "likes") return right.likeCount - left.likeCount;
      return (
        (toDate(right.publishedAt)?.getTime() || 0) -
        (toDate(left.publishedAt)?.getTime() || 0)
      );
    });
  }, [categoryFilter, posts, searchText, sortMode]);

  const resetWriteForm = (category: DeveloperLogCategory = "feature") => {
    draftPostId.current = null;
    setForm({ ...EMPTY_FORM, category });
    setNewImageFiles([]);
    setPreviewOpen(false);
    setExpandedImage(null);
  };

  const startWrite = () => {
    if (!canManage) return;
    resetWriteForm(categoryFilter === "event" ? "event" : "feature");
    setMode("write");
    navigate("/developer-log");
  };

  const startEdit = () => {
    if (!canManage || !selectedPost) return;
    draftPostId.current = null;
    setForm({
      title: selectedPost.title,
      version: selectedPost.version,
      category: selectedPost.category,
      summary: selectedPost.summary,
      bodyHtml: selectedPost.bodyHtml,
      action: selectedPost.action || "",
      isPinned: selectedPost.isPinned,
      images: selectedPost.images,
    });
    setNewImageFiles([]);
    setPreviewOpen(false);
    setMode("edit");
  };

  const cancelEditor = () => {
    draftPostId.current = null;
    setPreviewOpen(false);
    setNewImageFiles([]);
    setExpandedImage(null);
    if (selectedPost) {
      setMode("detail");
      return;
    }
    setMode("list");
  };

  const handleImageFiles = (files: FileList | null) => {
    const incoming = Array.from(files || []).filter((file) =>
      file.type.startsWith("image/"),
    );
    if (!incoming.length) return;

    const remaining =
      MAX_CARD_IMAGE_COUNT - form.images.length - newImageFiles.length;
    if (remaining <= 0) {
      showToast({
        tone: "warning",
        title: `카드뉴스 이미지는 최대 ${MAX_CARD_IMAGE_COUNT}장까지 첨부할 수 있습니다.`,
      });
      return;
    }

    setNewImageFiles((prev) => [...prev, ...incoming.slice(0, remaining)]);
    if (incoming.length > remaining) {
      showToast({
        tone: "info",
        title: `${remaining}장만 추가했습니다.`,
        message: `카드뉴스 이미지는 최대 ${MAX_CARD_IMAGE_COUNT}장까지 첨부할 수 있습니다.`,
      });
    }
  };

  const removeExistingImage = (storagePath: string) => {
    setForm((prev) => ({
      ...prev,
      images: prev.images.filter(
        (image) => image.imageStoragePath !== storagePath,
      ),
    }));
  };

  const savePost = async () => {
    if (!canManage || saving || mutationLock.current) return;
    const title = form.title.trim();
    const bodyText = stripHtml(form.bodyHtml);
    if (!title) {
      showToast({ tone: "warning", title: "제목을 입력해 주세요." });
      return;
    }
    if (!form.summary.trim() && !bodyText) {
      showToast({ tone: "warning", title: "요약 또는 본문을 입력해 주세요." });
      return;
    }
    if (form.images.length + newImageFiles.length > MAX_CARD_IMAGE_COUNT) {
      showToast({
        tone: "warning",
        title: `카드뉴스 이미지는 최대 ${MAX_CARD_IMAGE_COUNT}장까지 첨부할 수 있습니다.`,
      });
      return;
    }

    mutationLock.current = true;
    setSaving(true);
    const uploadedImages: DeveloperLogImage[] = [];

    try {
      const editingPost = mode === "edit" ? selectedPost : null;
      if (
        !editingPost &&
        (!draftPostId.current || draftPostId.current.uid !== currentUser?.uid)
      ) {
        // Reserving a reference is local: publish only after every image is ready.
        // Keep this ID on failure so retrying cannot create another post.
        draftPostId.current = {
          uid: currentUser?.uid || "",
          id: doc(getDeveloperLogItemsCollection()).id,
        };
      }
      const postRef = getDeveloperLogPostRef(
        editingPost?.id || draftPostId.current!.id,
      );

      for (const file of newImageFiles) {
        const uploaded = await uploadDeveloperLogImage({
          postId: postRef.id,
          file,
        });
        uploadedImages.push({
          ...uploaded,
          alt: title,
          order: form.images.length + uploadedImages.length,
        });
      }

      const nextImages = [...form.images, ...uploadedImages].map(
        (image, index) => ({
          ...image,
          order: index,
        }),
      );
      const payload = {
        title,
        version: form.version.trim(),
        category: form.category,
        summary: form.summary.trim(),
        bodyHtml: form.bodyHtml,
        action: form.action,
        images: nextImages,
        isPinned: form.isPinned,
        updatedAt: serverTimestamp(),
      };

      if (editingPost) {
        await updateDoc(postRef, payload);
        setSelectedPost((prev) =>
          prev?.id === editingPost.id ? { ...prev, ...payload } : prev,
        );
      } else {
        await setDoc(postRef, {
          ...payload,
          viewCount: 0,
          likeCount: 0,
          createdBy: currentUser?.uid || "",
          createdByName: displayName,
          createdAt: serverTimestamp(),
          publishedAt: serverTimestamp(),
        });
      }

      if (editingPost) {
        const kept = new Set(nextImages.map((image) => image.imageStoragePath));
        const removedImages = editingPost.images.filter(
          (image) => !kept.has(image.imageStoragePath),
        );
        await Promise.all(
          removedImages.map((image) =>
            tryDeleteDeveloperLogImage(image.imageStoragePath),
          ),
        );
      }

      showToast({
        tone: "success",
        title:
          mode === "edit"
            ? "개발자 일지를 수정했습니다."
            : "개발자 일지를 게시했습니다.",
      });
      draftPostId.current = null;
      setNewImageFiles([]);
      setPreviewOpen(false);
      navigate(`/developer-log/${postRef.id}`);
      setMode("detail");
    } catch (error: any) {
      console.error("Failed to save developer log:", error);
      await Promise.all(
        uploadedImages.map((image) =>
          tryDeleteDeveloperLogImage(image.imageStoragePath),
        ),
      );
      showToast({
        tone: "error",
        title: "개발자 일지 저장에 실패했습니다.",
        message: error?.message,
      });
    } finally {
      mutationLock.current = false;
      setSaving(false);
    }
  };

  const deletePost = async () => {
    if (!canManage || !selectedPost || saving || mutationLock.current) return;
    if (
      !window.confirm(
        "이 개발자 일지를 삭제할까요? 첨부 이미지도 함께 정리됩니다.",
      )
    )
      return;

    mutationLock.current = true;
    setPendingMutation(true);
    try {
      await deleteDoc(getDeveloperLogPostRef(selectedPost.id));
      await Promise.all(
        selectedPost.images.map((image) =>
          tryDeleteDeveloperLogImage(image.imageStoragePath),
        ),
      );
      showToast({ tone: "success", title: "개발자 일지를 삭제했습니다." });
      navigate("/developer-log");
      setMode("list");
    } catch (error: any) {
      console.error("Failed to delete developer log:", error);
      showToast({
        tone: "error",
        title: "개발자 일지 삭제에 실패했습니다.",
        message: error?.message,
      });
    } finally {
      mutationLock.current = false;
      setPendingMutation(false);
    }
  };

  const toggleLike = async () => {
    if (
      saving ||
      mutationLock.current ||
      detailLoading ||
      likeRequest.current?.scope === likeScope
    )
      return;
    if (!currentUser || !selectedPost || !canLike) {
      showToast({
        tone: "info",
        title: "좋아요는 학생만 누를 수 있습니다.",
      });
      return;
    }

    const previous = { liked, likeCount: selectedPost.likeCount };
    const desiredLiked = !liked;
    const request = { scope: likeScope };
    likeRequest.current = request;
    setPendingLikeScope(likeScope);
    setLiked(desiredLiked);
    setSelectedPost((prev) =>
      prev && prev.id === selectedPost.id
        ? {
            ...prev,
            likeCount: Math.max(0, prev.likeCount + (desiredLiked ? 1 : -1)),
          }
        : prev,
    );

    const result = await setDeveloperLogLike(
      getDeveloperLogPostRef(selectedPost.id),
      currentUser.uid,
      desiredLiked,
    );
    // A response from another account or article must never change this screen.
    if (
      likeRequest.current !== request ||
      activeLikeScope.current !== request.scope
    )
      return;
    const state =
      "state" in result ? result.state : !result.confirmed ? previous : null;
    if (state) {
      setLiked(state.liked);
      setSelectedPost((prev) =>
        prev && prev.id === selectedPost.id
          ? { ...prev, likeCount: state.likeCount }
          : prev,
      );
    }
    if (!result.confirmed) {
      console.error("Failed to toggle developer log like:", result.error);
      showToast({
        tone: "error",
        title: "좋아요 처리에 실패했습니다.",
        message: "잠시 후 다시 눌러 주세요.",
      });
    }
    likeRequest.current = null;
    setPendingLikeScope(null);
  };

  const renderCategoryBadge = (category: string) => {
    const meta = getDeveloperLogCategoryMeta(category);
    return (
      <span
        className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-black ${meta.badgeClassName}`}
      >
        {meta.label}
      </span>
    );
  };

  const moveCardImage = (imageCount: number, direction: -1 | 1) => {
    if (imageCount <= 1) return;
    setActiveCardImageIndex(
      (prev) => (prev + direction + imageCount) % imageCount,
    );
  };

  const handleCardSwipeStart = (
    event: React.PointerEvent,
    imageCount: number,
  ) => {
    if (imageCount <= 1) return;
    cardSwipeStartRef.current = { x: event.clientX, y: event.clientY };
  };

  const handleCardSwipeEnd = (
    event: React.PointerEvent,
    imageCount: number,
  ) => {
    const start = cardSwipeStartRef.current;
    cardSwipeStartRef.current = null;
    if (!start || imageCount <= 1) return;

    const diffX = event.clientX - start.x;
    const diffY = event.clientY - start.y;
    if (Math.abs(diffX) < 48 || Math.abs(diffX) <= Math.abs(diffY) * 1.2) {
      return;
    }

    moveCardImage(imageCount, diffX < 0 ? 1 : -1);
  };

  const renderPostDetail = (post: DeveloperLogPost, preview = false) => {
    const eventArticle =
      post.category === "event" ||
      (post.category === "notice" && hasEventArticleMarkup(post.bodyHtml));
    const imageArticle =
      eventArticle && hasNoticeImageArticleMarkup(post.bodyHtml);
    const imageCount = post.images.length;
    const activeImageIndex =
      imageCount > 0 ? Math.min(activeCardImageIndex, imageCount - 1) : 0;
    const showCarouselControls = imageCount > 1;

    return (
      <article
        className={`developer-log-post rounded-2xl border border-gray-200 bg-white p-5 shadow-sm sm:p-7 lg:p-8${imageArticle || (post.category === "event" && imageCount > 0) ? " developer-log-image-post" : ""}`}
      >
        {pendingMutation && <LoadingOverlay />}
        <div className="border-b border-gray-200 pb-4">
          <div className="min-w-0">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              {post.isPinned && (
                <span className="inline-flex items-center rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-xs font-black text-blue-700">
                  <i className="fas fa-thumbtack mr-1.5" aria-hidden="true"></i>
                  고정
                </span>
              )}
              {renderCategoryBadge(post.category)}
            </div>
            <h1 className="break-keep text-2xl font-black leading-tight text-slate-950 sm:text-3xl">
              {getDisplayTitle(post)}
            </h1>
            {post.summary && (
              <p className="mt-3 max-w-3xl break-keep text-sm leading-6 text-slate-600 sm:text-base">
                {post.summary}
              </p>
            )}
            <div className="developer-log-meta mt-4 text-slate-500">
              <span className="developer-log-meta-author">
                <i className="fas fa-user" aria-hidden="true"></i>
                {post.createdByName || "개발자"}
              </span>
              <time
                className="developer-log-meta-date"
                dateTime={toDate(post.publishedAt)?.toISOString()}
              >
                <i className="far fa-calendar-alt" aria-hidden="true"></i>
                {formatDate(post.publishedAt)}
              </time>
              <span aria-label={`조회수 ${post.viewCount}`}>
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  aria-hidden="true"
                >
                  <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
                  <circle cx="12" cy="12" r="3" />
                </svg>
                <span className="developer-log-meta-label">조회수</span>{" "}
                {post.viewCount}
              </span>
              <button
                type="button"
                onClick={() =>
                  canViewLikeStudents && currentUser
                    ? setLikeStudentsPost({
                        postId: post.id,
                        owner: currentUser,
                        role: userData?.role,
                      })
                    : void toggleLike()
                }
                disabled={
                  preview ||
                  (!canLike && !canViewLikeStudents) ||
                  pendingLikeScope === likeScope
                }
                aria-label={
                  canViewLikeStudents ? "좋아요 누른 학생 보기" : "좋아요"
                }
                aria-haspopup={canViewLikeStudents ? "dialog" : undefined}
                aria-pressed={
                  canViewLikeStudents ? undefined : !preview && liked
                }
                aria-busy={!preview && pendingLikeScope === likeScope}
                className={`developer-log-like inline-flex items-center justify-center rounded-full border font-bold transition ${
                  liked
                    ? "border-rose-200 bg-rose-50 text-rose-600"
                    : "border-gray-200 bg-white text-blue-700 hover:border-blue-200 hover:bg-blue-50"
                } ${preview ? "cursor-default opacity-80" : ""}`}
              >
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill={liked ? "currentColor" : "none"}
                  stroke="currentColor"
                  strokeWidth="1.8"
                  aria-hidden="true"
                >
                  <path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z" />
                </svg>
                <span className="developer-log-meta-label">좋아요</span>
                <span className="developer-log-like-count" aria-live="polite">
                  {post.likeCount}
                </span>
              </button>
            </div>
          </div>
        </div>

        <div
          className={
            eventArticle
              ? "developer-log-event-layout py-8"
              : "grid gap-8 py-8 lg:grid-cols-[minmax(0,1fr)_minmax(280px,420px)]"
          }
        >
          {post.category === "event" && !imageArticle && imageCount > 0 && (
            <div
              className="developer-log-event-images"
              aria-label="이벤트 안내 이미지"
            >
              {post.images.map((image, index) => (
                <button
                  key={image.imageStoragePath || image.imageUrl}
                  type="button"
                  aria-label={`${index + 1}번째 이벤트 이미지 크게 보기`}
                  onClick={() =>
                    setExpandedImage({
                      src: image.imageUrl,
                      alt: image.alt || post.title,
                      label: `${index + 1} / ${imageCount}`,
                    })
                  }
                >
                  <img
                    src={image.imageUrl}
                    alt={image.alt || post.title}
                    width={image.imageWidth || undefined}
                    height={image.imageHeight || undefined}
                    loading={index === 0 ? "eager" : "lazy"}
                    decoding="async"
                  />
                </button>
              ))}
            </div>
          )}
          {imageArticle ? (
            <div className="developer-log-rich-text min-w-0">
              <NoticeImageArticle
                key={`${preview ? "preview" : "detail"}:${post.id}:${post.bodyHtml}`}
                bodyHtml={post.bodyHtml}
                title={post.title}
              />
            </div>
          ) : (
            <div
              className="developer-log-rich-text developer-log-body-copy min-w-0"
              dangerouslySetInnerHTML={{
                __html: sanitizeRichHtml(post.bodyHtml),
              }}
            />
          )}
          {!eventArticle && (
            <div className="min-w-0">
              {post.images.length > 0 ? (
                <div
                  className="overflow-hidden rounded-2xl border border-gray-200 bg-gray-50"
                  aria-label="카드뉴스 이미지 슬라이드"
                >
                  <div
                    className="relative aspect-[4/5] touch-pan-y select-none overflow-hidden bg-gray-50"
                    onPointerDown={(event) =>
                      handleCardSwipeStart(event, imageCount)
                    }
                    onPointerUp={(event) =>
                      handleCardSwipeEnd(event, imageCount)
                    }
                    onPointerCancel={() => {
                      cardSwipeStartRef.current = null;
                    }}
                    onPointerLeave={() => {
                      cardSwipeStartRef.current = null;
                    }}
                  >
                    <div
                      className="flex h-full transition-transform duration-500 ease-out motion-reduce:transition-none"
                      style={{
                        transform: `translateX(-${activeImageIndex * 100}%)`,
                      }}
                    >
                      {post.images.map((image, index) => (
                        <figure
                          key={image.imageStoragePath || image.imageUrl}
                          className="h-full w-full shrink-0"
                        >
                          <img
                            src={image.imageUrl}
                            alt={
                              image.alt || `${post.title} 카드뉴스 ${index + 1}`
                            }
                            className="h-full w-full object-contain"
                            loading={index === 0 ? "eager" : "lazy"}
                            decoding="async"
                          />
                        </figure>
                      ))}
                    </div>

                    {showCarouselControls && (
                      <>
                        <button
                          type="button"
                          onClick={() => moveCardImage(imageCount, -1)}
                          className="absolute left-3 top-1/2 inline-flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full bg-white/90 text-slate-700 shadow transition hover:bg-white hover:text-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-200"
                          aria-label="이전 카드뉴스 이미지"
                        >
                          <i
                            className="fas fa-chevron-left text-xs"
                            aria-hidden="true"
                          ></i>
                        </button>
                        <button
                          type="button"
                          onClick={() => moveCardImage(imageCount, 1)}
                          className="absolute right-3 top-1/2 inline-flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full bg-white/90 text-slate-700 shadow transition hover:bg-white hover:text-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-200"
                          aria-label="다음 카드뉴스 이미지"
                        >
                          <i
                            className="fas fa-chevron-right text-xs"
                            aria-hidden="true"
                          ></i>
                        </button>
                      </>
                    )}
                  </div>

                  {showCarouselControls && (
                    <div className="flex h-10 items-center justify-center gap-2 border-t border-gray-200 bg-white">
                      {post.images.map((image, index) => (
                        <button
                          key={`${image.imageStoragePath || image.imageUrl}-dot`}
                          type="button"
                          onClick={() => setActiveCardImageIndex(index)}
                          className={`h-2.5 w-2.5 rounded-full border transition ${
                            activeImageIndex === index
                              ? "border-blue-600 bg-blue-600"
                              : "border-gray-300 bg-white hover:border-blue-300"
                          }`}
                          aria-label={`${index + 1}번째 카드뉴스 이미지 보기`}
                          aria-current={
                            activeImageIndex === index ? "true" : undefined
                          }
                        />
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <div className="rounded-2xl border border-dashed border-gray-200 bg-gray-50 px-5 py-8 text-center text-sm font-semibold text-gray-400">
                  첨부된 카드뉴스 이미지가 없습니다.
                </div>
              )}
            </div>
          )}
        </div>

        {post.action === "wispi" && (
          <div className="developer-log-cta">
            <Link
              to={
                userData?.role === "teacher"
                  ? "/teacher/points?tab=stocks"
                  : "/student/wispi"
              }
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-blue-600 px-6 py-3 text-sm font-bold text-white hover:bg-blue-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
            >
              위스피 하러 가기
              <i className="fas fa-arrow-right" aria-hidden="true"></i>
            </Link>
          </div>
        )}

        {!preview && (
          <div className="flex flex-col gap-3 border-t border-gray-200 pt-5 sm:flex-row sm:items-center sm:justify-between">
            <button
              type="button"
              onClick={() => navigate("/developer-log")}
              className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white px-4 text-sm font-black text-slate-700 transition hover:bg-gray-50"
            >
              <i className="fas fa-arrow-left" aria-hidden="true"></i>
              목록으로
            </button>
            {canManage && (
              <div className="flex items-center justify-end gap-2">
                <span className="mr-2 hidden text-sm font-bold text-slate-500 sm:inline">
                  <i className="fas fa-lock mr-1.5" aria-hidden="true"></i>
                  개발자 전용
                </span>
                <button
                  type="button"
                  onClick={startEdit}
                  className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-blue-200 bg-white px-4 text-sm font-black text-blue-700 transition hover:bg-blue-50"
                >
                  <i className="fas fa-pen" aria-hidden="true"></i>
                  수정
                </button>
                <button
                  type="button"
                  onClick={() => void deletePost()}
                  className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-rose-200 bg-white px-4 text-sm font-black text-rose-600 transition hover:bg-rose-50"
                >
                  <i className="fas fa-trash-alt" aria-hidden="true"></i>
                  삭제
                </button>
              </div>
            )}
          </div>
        )}
      </article>
    );
  };

  const renderEditor = () => {
    const preserveEventMarkup =
      mode === "edit" &&
      (selectedPost?.category === "notice" ||
        selectedPost?.category === "event") &&
      hasEventArticleMarkup(selectedPost.bodyHtml);
    const draftPost = buildDraftPost(
      form,
      displayName,
      selectedPost?.id || "preview",
    );
    const previewImages: DeveloperLogImage[] = newImagePreviews.map(
      (url, index) => ({
        imageUrl: url,
        imageStoragePath: `preview-${index}`,
        imageByteSize: newImageFiles[index]?.size || 0,
        imageWidth: 0,
        imageHeight: 0,
        imageMimeType: newImageFiles[index]?.type || "image/*",
        alt: form.title,
        order: form.images.length + index,
      }),
    );
    draftPost.images = [...form.images, ...previewImages];
    const totalImageCount = draftPost.images.length;

    return (
      <div className="space-y-5">
        {saving && <LoadingOverlay />}
        <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm sm:p-6">
          <div className="mb-5 flex flex-col gap-3 border-b border-gray-100 pb-5 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-xl font-black text-slate-950">
                {mode === "edit" ? "개발자 일지 수정" : "개발자 일지 작성"}
              </h2>
              <p className="mt-1 text-sm font-semibold text-slate-500">
                게시 전 미리보기로 학생 화면에서 보일 내용을 확인할 수 있습니다.
              </p>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setPreviewOpen((prev) => !prev)}
                className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white px-4 text-sm font-black text-slate-700 transition hover:bg-gray-50"
              >
                <i className="far fa-eye" aria-hidden="true"></i>
                {previewOpen ? "편집으로" : "미리보기"}
              </button>
              <button
                type="button"
                onClick={cancelEditor}
                className="inline-flex h-11 items-center justify-center rounded-xl border border-gray-200 bg-white px-4 text-sm font-black text-slate-500 transition hover:bg-gray-50"
              >
                취소
              </button>
            </div>
          </div>

          {!previewOpen ? (
            <div className="space-y-5">
              <div className="grid gap-4 lg:grid-cols-[180px_minmax(0,1fr)]">
                <label
                  className="text-sm font-black text-slate-700"
                  htmlFor="developer-log-version"
                >
                  버전
                </label>
                <input
                  id="developer-log-version"
                  value={form.version}
                  onChange={(event) =>
                    setForm((prev) => ({
                      ...prev,
                      version: event.target.value,
                    }))
                  }
                  placeholder="예: v1.4.2"
                  className="h-11 rounded-xl border border-gray-200 px-4 text-sm font-semibold outline-none transition focus:border-blue-400 focus:ring-4 focus:ring-blue-50"
                />
              </div>

              <div className="grid gap-4 lg:grid-cols-[180px_minmax(0,1fr)]">
                <label
                  className="text-sm font-black text-slate-700"
                  htmlFor="developer-log-title"
                >
                  제목
                </label>
                <input
                  lang="ko"
                  inputMode="text"
                  id="developer-log-title"
                  value={form.title}
                  onChange={(event) =>
                    setForm((prev) => ({ ...prev, title: event.target.value }))
                  }
                  placeholder="업데이트 제목을 입력하세요."
                  className="h-11 rounded-xl border border-gray-200 px-4 text-sm font-semibold outline-none transition focus:border-blue-400 focus:ring-4 focus:ring-blue-50"
                />
              </div>

              <div className="grid gap-4 lg:grid-cols-[180px_minmax(0,1fr)]">
                <span className="text-sm font-black text-slate-700">분류</span>
                <div className="flex flex-wrap gap-2">
                  {DEVELOPER_LOG_CATEGORIES.map((category) => (
                    <button
                      type="button"
                      key={category.value}
                      aria-pressed={form.category === category.value}
                      onClick={() =>
                        setForm((prev) => ({
                          ...prev,
                          category: category.value,
                        }))
                      }
                      className={`rounded-full border px-4 py-2 text-sm font-black transition ${
                        form.category === category.value
                          ? "border-blue-300 bg-blue-50 text-blue-700"
                          : "border-gray-200 bg-white text-slate-600 hover:bg-gray-50"
                      }`}
                    >
                      {category.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid gap-4 lg:grid-cols-[180px_minmax(0,1fr)]">
                <label
                  className="text-sm font-black text-slate-700"
                  htmlFor="developer-log-summary"
                >
                  요약
                </label>
                <textarea
                  lang="ko"
                  inputMode="text"
                  id="developer-log-summary"
                  value={form.summary}
                  onChange={(event) =>
                    setForm((prev) => ({
                      ...prev,
                      summary: event.target.value,
                    }))
                  }
                  rows={3}
                  placeholder="목록과 상세 상단에 표시할 짧은 요약을 입력하세요."
                  className="resize-none rounded-xl border border-gray-200 px-4 py-3 text-sm font-semibold leading-6 outline-none transition focus:border-blue-400 focus:ring-4 focus:ring-blue-50"
                />
              </div>

              <div className="grid gap-4 lg:grid-cols-[180px_minmax(0,1fr)]">
                <span className="text-sm font-black text-slate-700">본문</span>
                {preserveEventMarkup ? (
                  <EventArticleEditor
                    value={form.bodyHtml}
                    onChange={(value) =>
                      setForm((prev) => ({ ...prev, bodyHtml: value }))
                    }
                  />
                ) : (
                  <QuillEditor
                    value={form.bodyHtml}
                    onChange={(value) =>
                      setForm((prev) => ({ ...prev, bodyHtml: value }))
                    }
                    minHeight={300}
                    placeholder="패치 요약, 주요 변경 사항, 기대 효과 등을 정리하세요."
                    toolbar={[
                      [{ header: [2, 3, false] }],
                      ["bold", "italic", "underline"],
                      [{ list: "ordered" }, { list: "bullet" }],
                      ["link"],
                      ["clean"],
                    ]}
                  />
                )}
              </div>

              <div className="grid gap-4 lg:grid-cols-[180px_minmax(0,1fr)]">
                <span className="text-sm font-black text-slate-700">
                  카드뉴스 이미지
                </span>
                <div className="space-y-3">
                  <label className="flex cursor-pointer flex-col items-center justify-center rounded-2xl border border-dashed border-blue-200 bg-blue-50/50 px-5 py-8 text-center transition hover:bg-blue-50">
                    <input
                      type="file"
                      accept="image/*"
                      multiple
                      className="sr-only"
                      onChange={(event) => {
                        handleImageFiles(event.target.files);
                        event.currentTarget.value = "";
                      }}
                    />
                    <i
                      className="far fa-images mb-3 text-2xl text-blue-600"
                      aria-hidden="true"
                    ></i>
                    <span className="text-sm font-black text-blue-700">
                      이미지 선택
                    </span>
                    <span className="mt-1 text-xs font-semibold text-slate-500">
                      최대 {MAX_CARD_IMAGE_COUNT}장까지 업로드할 수 있으며, 저장
                      시 WebP로 압축하고 1장당 700KB 이하로 맞춥니다.
                    </span>
                  </label>

                  {(form.images.length > 0 || newImagePreviews.length > 0) && (
                    <div className="rounded-xl border border-gray-200 bg-gray-50 p-3">
                      <div className="mb-3 flex items-center justify-between gap-3 text-xs font-black text-slate-500">
                        <span>
                          미리보기 목록 {totalImageCount}/{MAX_CARD_IMAGE_COUNT}
                        </span>
                        <span>썸네일을 누르면 크게 볼 수 있습니다.</span>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {form.images.map((image, index) => (
                          <div
                            key={image.imageStoragePath}
                            className="relative h-20 w-20 overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm"
                          >
                            <button
                              type="button"
                              onClick={() =>
                                setExpandedImage({
                                  src: image.imageUrl,
                                  alt: form.title || "기존 카드뉴스 이미지",
                                  label: `기존 카드뉴스 이미지 ${index + 1}`,
                                })
                              }
                              className="block h-full w-full focus:outline-none focus:ring-2 focus:ring-blue-300"
                              aria-label={`기존 카드뉴스 이미지 ${index + 1} 크게 보기`}
                            >
                              <img
                                src={image.imageUrl}
                                alt={form.title || "기존 카드뉴스 이미지"}
                                className="h-full w-full object-contain"
                              />
                            </button>
                            <span className="absolute bottom-1 left-1 rounded bg-slate-900/80 px-1.5 py-0.5 text-[10px] font-black text-white">
                              {index + 1}
                            </span>
                            <button
                              type="button"
                              onClick={() =>
                                removeExistingImage(image.imageStoragePath)
                              }
                              className="absolute right-1 top-1 inline-flex h-6 w-6 items-center justify-center rounded-full bg-white/95 text-rose-600 shadow"
                              aria-label="기존 이미지 제거"
                            >
                              <i
                                className="fas fa-times text-xs"
                                aria-hidden="true"
                              ></i>
                            </button>
                          </div>
                        ))}
                        {newImagePreviews.map((url, index) => (
                          <div
                            key={url}
                            className="relative h-20 w-20 overflow-hidden rounded-lg border border-blue-200 bg-white shadow-sm"
                          >
                            <button
                              type="button"
                              onClick={() =>
                                setExpandedImage({
                                  src: url,
                                  alt: `새 카드뉴스 이미지 ${index + 1}`,
                                  label: `새 카드뉴스 이미지 ${form.images.length + index + 1}`,
                                })
                              }
                              className="block h-full w-full focus:outline-none focus:ring-2 focus:ring-blue-300"
                              aria-label={`새 카드뉴스 이미지 ${index + 1} 크게 보기`}
                            >
                              <img
                                src={url}
                                alt={`새 카드뉴스 이미지 ${index + 1}`}
                                className="h-full w-full object-contain"
                              />
                            </button>
                            <span className="absolute bottom-1 left-1 rounded bg-blue-600 px-1.5 py-0.5 text-[10px] font-black text-white">
                              {form.images.length + index + 1}
                            </span>
                            <button
                              type="button"
                              onClick={() =>
                                setNewImageFiles((prev) =>
                                  prev.filter(
                                    (_, itemIndex) => itemIndex !== index,
                                  ),
                                )
                              }
                              className="absolute right-1 top-1 inline-flex h-6 w-6 items-center justify-center rounded-full bg-white/95 text-rose-600 shadow"
                              aria-label="새 이미지 제거"
                            >
                              <i
                                className="fas fa-times text-xs"
                                aria-hidden="true"
                              ></i>
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              <div className="grid gap-4 lg:grid-cols-[180px_minmax(0,1fr)]">
                <span className="text-sm font-black text-slate-700">
                  게시 옵션
                </span>
                <div className="flex flex-wrap items-center gap-4">
                  <label className="flex min-h-11 items-center gap-3 text-sm font-bold text-slate-700">
                    <input
                      type="checkbox"
                      checked={form.isPinned}
                      onChange={(event) =>
                        setForm((prev) => ({
                          ...prev,
                          isPinned: event.target.checked,
                        }))
                      }
                      className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                    />
                    목록 상단에 고정
                  </label>
                  <label className="flex min-h-11 items-center gap-3 text-sm font-bold text-slate-700">
                    <input
                      type="checkbox"
                      checked={form.action === "wispi"}
                      onChange={(event) =>
                        setForm((prev) => ({
                          ...prev,
                          action: event.target.checked ? "wispi" : "",
                        }))
                      }
                      className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                    />
                    위스피 이동 버튼
                  </label>
                </div>
              </div>
            </div>
          ) : (
            renderPostDetail(draftPost, true)
          )}

          <div className="mt-6 flex justify-end gap-2 border-t border-gray-100 pt-5">
            <button
              type="button"
              onClick={cancelEditor}
              className="inline-flex h-12 items-center justify-center rounded-xl border border-gray-200 bg-white px-5 text-sm font-black text-slate-500 transition hover:bg-gray-50"
            >
              취소
            </button>
            <button
              type="button"
              onClick={() => void savePost()}
              disabled={saving}
              className="inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-blue-600 px-6 text-sm font-black text-white shadow-lg shadow-blue-600/20 transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <i className="fas fa-paper-plane" aria-hidden="true"></i>
              {saving
                ? "저장 중..."
                : mode === "edit"
                  ? "수정 저장"
                  : "게시하기"}
            </button>
          </div>
        </div>
      </div>
    );
  };

  if (detailLoading) {
    return (
      <PageLoading scope="screen" message="개발자 일지를 불러오는 중입니다." />
    );
  }

  return (
    <div className="ws-page developer-log-page">
      <header className="ws-page-header mb-5">
        <h1>개발자 일지</h1>
        {canManage && mode !== "write" && mode !== "edit" && (
          <button
            type="button"
            onClick={startWrite}
            className="inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-blue-600 px-5 text-sm font-bold text-white shadow-sm transition hover:bg-blue-700"
          >
            <i className="fas fa-pen" aria-hidden="true"></i>
            글쓰기
          </button>
        )}
      </header>

      <div className="w-full">
        {mode === "write" || mode === "edit" ? (
          renderEditor()
        ) : postId && selectedPost ? (
          renderPostDetail(selectedPost)
        ) : (
          <section>
            <div className="developer-log-toolbar">
              <div className="ws-page-tabs">
                <button
                  type="button"
                  onClick={() => setCategoryFilter("all")}
                  aria-pressed={categoryFilter === "all"}
                  className={categoryFilter === "all" ? "is-active" : ""}
                >
                  전체
                </button>
                {DEVELOPER_LOG_CATEGORIES.map((category) => (
                  <button
                    type="button"
                    key={category.value}
                    onClick={() => setCategoryFilter(category.value)}
                    aria-pressed={categoryFilter === category.value}
                    className={
                      categoryFilter === category.value ? "is-active" : ""
                    }
                  >
                    {category.label}
                  </button>
                ))}
              </div>
              <div className="developer-log-search-controls">
                <label className="relative block min-w-0">
                  <span className="sr-only">개발자 일지 검색</span>
                  <i
                    className="fas fa-search absolute left-4 top-1/2 -translate-y-1/2 text-slate-400"
                    aria-hidden="true"
                  ></i>
                  <input
                    lang="ko"
                    inputMode="text"
                    value={searchText}
                    onChange={(event) => setSearchText(event.target.value)}
                    placeholder="제목, 내용을 검색하세요"
                    className="h-12 w-full rounded-xl border border-gray-200 pl-11 pr-4 text-sm font-semibold outline-none transition focus:border-blue-400 focus:ring-4 focus:ring-blue-50"
                  />
                </label>
                <select
                  value={sortMode}
                  onChange={(event) =>
                    setSortMode(event.target.value as SortMode)
                  }
                  className="h-12 rounded-xl border border-gray-200 bg-white px-4 text-sm font-black text-slate-700 outline-none transition focus:border-blue-400 focus:ring-4 focus:ring-blue-50"
                  aria-label="정렬 방식"
                >
                  <option value="latest">최신순</option>
                  <option value="views">조회수순</option>
                  <option value="likes">좋아요순</option>
                </select>
              </div>
            </div>

            {listLoading ? (
              <InlineLoading
                message="개발자 일지를 불러오는 중입니다."
                showWarning
              />
            ) : filteredPosts.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-gray-200 py-14 text-center">
                <div className="text-sm font-black text-slate-400">
                  등록된 개발자 일지가 없습니다.
                </div>
              </div>
            ) : (
              <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
                <div className="developer-log-list-grid developer-log-list-header border-b border-gray-200 bg-gray-50 px-5 py-3 text-center text-sm font-black text-slate-600">
                  <div className="text-left">제목</div>
                  <div>분류</div>
                  <div>작성일</div>
                  <div>조회수</div>
                  <div>좋아요</div>
                </div>
                <div className="divide-y divide-gray-100">
                  {filteredPosts.map((post) => (
                    <Link
                      key={post.id}
                      to={`/developer-log/${post.id}`}
                      className="developer-log-list-grid developer-log-list-row px-4 py-3 transition hover:bg-blue-50/40 lg:px-5 lg:py-4"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          {post.isPinned && (
                            <i
                              className="fas fa-thumbtack text-blue-600"
                              aria-label="고정 게시글"
                            ></i>
                          )}
                          <span className="developer-log-list-title text-base font-black text-slate-950">
                            {getDisplayTitle(post)}
                          </span>
                        </div>
                      </div>
                      <div className="text-left lg:text-center">
                        {renderCategoryBadge(post.category)}
                      </div>
                      <div className="text-sm font-semibold text-slate-600 lg:text-center">
                        {formatDate(post.publishedAt)}
                      </div>
                      <div className="text-sm font-black text-slate-700 lg:text-center">
                        <span className="sr-only">조회수 </span>
                        <i
                          className="far fa-eye mr-1.5 text-slate-400 lg:hidden"
                          aria-hidden="true"
                        ></i>
                        {post.viewCount}
                      </div>
                      <div className="text-sm font-black text-slate-700 lg:text-center">
                        <span className="sr-only">좋아요 </span>
                        <i
                          className="fas fa-heart mr-1.5 text-rose-500"
                          aria-hidden="true"
                        ></i>
                        {post.likeCount}
                      </div>
                    </Link>
                  ))}
                </div>
              </div>
            )}
          </section>
        )}
      </div>
      {likeStudentsPost?.postId === postId &&
        likeStudentsPost?.owner === currentUser &&
        likeStudentsPost?.role === userData?.role &&
        canViewLikeStudents &&
        currentUser &&
        mode === "detail" && (
          <DeveloperLogLikeStudentsDialog
            key={`${currentUser.uid}:${userData?.role}:${likeStudentsPost.postId}`}
            user={currentUser}
            postId={likeStudentsPost.postId}
            onClose={() => setLikeStudentsPost(null)}
          />
        )}
      {expandedImage && (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/75 p-4"
          role="dialog"
          aria-modal="true"
          aria-label={`${expandedImage.label} 크게 보기`}
          onClick={() => setExpandedImage(null)}
        >
          <div
            className="relative flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
              <div className="min-w-0 text-sm font-black text-slate-700">
                {expandedImage.label}
              </div>
              <button
                type="button"
                onClick={() => setExpandedImage(null)}
                className="inline-flex h-9 w-9 items-center justify-center rounded-full text-slate-500 transition hover:bg-gray-50 hover:text-slate-900"
                aria-label="확대 이미지 닫기"
              >
                <i className="fas fa-times" aria-hidden="true"></i>
              </button>
            </div>
            <div className="min-h-0 bg-gray-50 p-3">
              <img
                src={expandedImage.src}
                alt={expandedImage.alt}
                className="mx-auto max-h-[78vh] w-full object-contain"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default DeveloperLog;
