import React, { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  limit,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  updateDoc,
} from "firebase/firestore";
import { db } from "../lib/firebase";
import { useAuth } from "../contexts/AuthContext";
import { useAppToast } from "../components/common/AppToastProvider";
import { InlineLoading, PageLoading } from "../components/common/LoadingState";
import QuillEditor from "../components/common/QuillEditor";
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

type SortMode = "latest" | "views" | "likes";

interface FormState {
  title: string;
  version: string;
  category: DeveloperLogCategory;
  summary: string;
  bodyHtml: string;
  isPinned: boolean;
  images: DeveloperLogImage[];
}

const EMPTY_FORM: FormState = {
  title: "",
  version: "",
  category: "feature",
  summary: "",
  bodyHtml: "",
  isPinned: false,
  images: [],
};

const MAX_CARD_IMAGE_COUNT = 6;
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
  const element = document.createElement("div");
  element.innerHTML = html || "";
  return (element.textContent || element.innerText || "")
    .replace(/\s+/g, " ")
    .trim();
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
  images: form.images,
  isPinned: form.isPinned,
  viewCount: 0,
  likeCount: 0,
  createdBy: "",
  createdByName: currentUserName || "개발자",
  publishedAt: new Date(),
});

const DeveloperLog: React.FC = () => {
  const { postId } = useParams();
  const navigate = useNavigate();
  const { currentUser, userData } = useAuth();
  const { showToast } = useAppToast();
  const canManage = isDeveloperUser(currentUser?.email);
  const canLike = userData?.role === "student";
  const displayName = (userData?.name || "방재석 교사").trim();

  const [posts, setPosts] = useState<DeveloperLogPost[]>([]);
  const [listLoading, setListLoading] = useState(true);
  const [selectedPost, setSelectedPost] = useState<DeveloperLogPost | null>(
    null,
  );
  const [detailLoading, setDetailLoading] = useState(false);
  const [liked, setLiked] = useState(false);
  const [saving, setSaving] = useState(false);
  const [mode, setMode] = useState<"list" | "detail" | "write" | "edit">(
    "list",
  );
  const [previewOpen, setPreviewOpen] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [newImageFiles, setNewImageFiles] = useState<File[]>([]);
  const [newImagePreviews, setNewImagePreviews] = useState<string[]>([]);
  const [searchText, setSearchText] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<
    "all" | DeveloperLogCategory
  >("all");
  const [sortMode, setSortMode] = useState<SortMode>("latest");

  useEffect(() => {
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
  }, [showToast]);

  useEffect(() => {
    if (!postId) {
      if (mode !== "write") setMode("list");
      setSelectedPost(null);
      return;
    }

    setMode((prev) => (prev === "edit" ? "edit" : "detail"));
    setDetailLoading(true);
    const postRef = getDeveloperLogPostRef(postId);

    void getDoc(postRef)
      .then(async (snapshot) => {
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
          isPinned: post.isPinned,
          images: post.images,
        });

        if (currentUser) {
          const likeSnap = await getDoc(
            doc(getDeveloperLogPostRef(post.id), "likes", currentUser.uid),
          );
          setLiked(likeSnap.exists());
        }

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
        console.error("Failed to load developer log:", error);
        showToast({
          tone: "error",
          title: "게시글을 불러오지 못했습니다.",
        });
      })
      .finally(() => setDetailLoading(false));
  }, [currentUser, mode, navigate, postId, showToast]);

  useEffect(() => {
    const previews = newImageFiles.map((file) => URL.createObjectURL(file));
    setNewImagePreviews(previews);
    return () => previews.forEach((url) => URL.revokeObjectURL(url));
  }, [newImageFiles]);

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

  const resetWriteForm = () => {
    setForm(EMPTY_FORM);
    setNewImageFiles([]);
    setPreviewOpen(false);
  };

  const startWrite = () => {
    if (!canManage) return;
    resetWriteForm();
    setMode("write");
    navigate("/developer-log");
  };

  const startEdit = () => {
    if (!canManage || !selectedPost) return;
    setForm({
      title: selectedPost.title,
      version: selectedPost.version,
      category: selectedPost.category,
      summary: selectedPost.summary,
      bodyHtml: selectedPost.bodyHtml,
      isPinned: selectedPost.isPinned,
      images: selectedPost.images,
    });
    setNewImageFiles([]);
    setPreviewOpen(false);
    setMode("edit");
  };

  const cancelEditor = () => {
    setPreviewOpen(false);
    setNewImageFiles([]);
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
    if (!canManage || saving) return;
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

    setSaving(true);
    const uploadedImages: DeveloperLogImage[] = [];

    try {
      const postRef =
        mode === "edit" && selectedPost
          ? getDeveloperLogPostRef(selectedPost.id)
          : await addDoc(getDeveloperLogItemsCollection(), {
              title,
              version: form.version.trim(),
              category: form.category,
              summary: form.summary.trim(),
              bodyHtml: form.bodyHtml,
              images: [],
              isPinned: form.isPinned,
              viewCount: 0,
              likeCount: 0,
              createdBy: currentUser?.uid || "",
              createdByName: displayName,
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
              publishedAt: serverTimestamp(),
            });

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
        images: nextImages,
        isPinned: form.isPinned,
        updatedAt: serverTimestamp(),
      };

      await updateDoc(postRef, payload);

      if (selectedPost) {
        const kept = new Set(nextImages.map((image) => image.imageStoragePath));
        const removedImages = selectedPost.images.filter(
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
      setSaving(false);
    }
  };

  const deletePost = async () => {
    if (!canManage || !selectedPost) return;
    if (
      !window.confirm(
        "이 개발자 일지를 삭제할까요? 첨부 이미지도 함께 정리됩니다.",
      )
    )
      return;

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
    }
  };

  const toggleLike = async () => {
    if (!currentUser || !selectedPost || !canLike) {
      showToast({
        tone: "info",
        title: "좋아요는 학생만 누를 수 있습니다.",
      });
      return;
    }

    const postRef = getDeveloperLogPostRef(selectedPost.id);
    const likeRef = doc(postRef, "likes", currentUser.uid);

    try {
      await runTransaction(db, async (transaction) => {
        const [postSnap, likeSnap] = await Promise.all([
          transaction.get(postRef),
          transaction.get(likeRef),
        ]);
        if (!postSnap.exists()) throw new Error("게시글이 없습니다.");

        const currentLikeCount = Math.max(
          0,
          Number(postSnap.data().likeCount || 0),
        );
        if (likeSnap.exists()) {
          transaction.delete(likeRef);
          transaction.update(postRef, {
            likeCount: Math.max(0, currentLikeCount - 1),
          });
          return;
        }

        transaction.set(likeRef, {
          uid: currentUser.uid,
          createdAt: serverTimestamp(),
        });
        transaction.update(postRef, { likeCount: currentLikeCount + 1 });
      });

      setLiked((prev) => !prev);
      setSelectedPost((prev) =>
        prev
          ? {
              ...prev,
              likeCount: liked
                ? Math.max(0, prev.likeCount - 1)
                : prev.likeCount + 1,
            }
          : prev,
      );
    } catch (error: any) {
      console.error("Failed to toggle developer log like:", error);
      showToast({
        tone: "error",
        title: "좋아요 처리에 실패했습니다.",
        message: error?.message,
      });
    }
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

  const renderPostDetail = (post: DeveloperLogPost, preview = false) => (
    <article className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm sm:p-7 lg:p-8">
      <div className="flex flex-col gap-4 border-b border-gray-200 pb-6 lg:flex-row lg:items-start lg:justify-between">
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
          <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm font-semibold text-slate-500">
            <span>
              <i className="fas fa-user mr-2" aria-hidden="true"></i>
              {post.createdByName || "개발자"}
            </span>
            <span>
              <i className="far fa-calendar-alt mr-2" aria-hidden="true"></i>
              {formatDate(post.publishedAt)}
            </span>
            <span>
              <i className="far fa-eye mr-2" aria-hidden="true"></i>
              조회수 {post.viewCount}
            </span>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          {!preview && (
            <span className="hidden text-sm font-semibold text-slate-500 sm:inline">
              학생은 좋아요만 누를 수 있습니다.
            </span>
          )}
          <button
            type="button"
            onClick={() => void toggleLike()}
            disabled={preview}
            className={`inline-flex h-11 items-center justify-center gap-2 rounded-full border px-5 text-sm font-black transition ${
              liked
                ? "border-rose-200 bg-rose-50 text-rose-600"
                : "border-gray-200 bg-white text-blue-700 hover:border-blue-200 hover:bg-blue-50"
            } ${preview ? "cursor-default opacity-80" : ""}`}
          >
            <i
              className={liked ? "fas fa-heart" : "far fa-heart"}
              aria-hidden="true"
            ></i>
            좋아요
          </button>
          <span className="min-w-8 text-center text-sm font-black text-slate-700">
            {post.likeCount}
          </span>
        </div>
      </div>

      <div className="grid gap-8 py-8 lg:grid-cols-[minmax(0,1fr)_minmax(280px,420px)]">
        <div
          className="developer-log-rich-text min-w-0"
          dangerouslySetInnerHTML={{ __html: post.bodyHtml }}
        />
        <div className="space-y-4">
          {post.images.length > 0 ? (
            post.images.map((image, index) => (
              <figure
                key={image.imageStoragePath || image.imageUrl}
                className="overflow-hidden rounded-2xl border border-gray-200 bg-gray-50"
              >
                <img
                  src={image.imageUrl}
                  alt={image.alt || `${post.title} 카드뉴스 ${index + 1}`}
                  className="h-auto w-full object-contain"
                  loading="lazy"
                />
              </figure>
            ))
          ) : (
            <div className="rounded-2xl border border-dashed border-gray-200 bg-gray-50 px-5 py-8 text-center text-sm font-semibold text-gray-400">
              첨부된 카드뉴스 이미지가 없습니다.
            </div>
          )}
        </div>
      </div>

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

  const renderEditor = () => {
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

    return (
      <div className="space-y-5">
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
                      업로드 시 WebP로 압축하고 1장당 700KB 이하로 맞춥니다.
                    </span>
                  </label>

                  {(form.images.length > 0 || newImagePreviews.length > 0) && (
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                      {form.images.map((image) => (
                        <div
                          key={image.imageStoragePath}
                          className="relative overflow-hidden rounded-xl border border-gray-200 bg-gray-50"
                        >
                          <img
                            src={image.imageUrl}
                            alt={form.title || "기존 카드뉴스 이미지"}
                            className="h-44 w-full object-contain"
                          />
                          <button
                            type="button"
                            onClick={() =>
                              removeExistingImage(image.imageStoragePath)
                            }
                            className="absolute right-2 top-2 inline-flex h-8 w-8 items-center justify-center rounded-full bg-white/90 text-rose-600 shadow"
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
                          className="relative overflow-hidden rounded-xl border border-blue-200 bg-blue-50"
                        >
                          <img
                            src={url}
                            alt={`새 카드뉴스 이미지 ${index + 1}`}
                            className="h-44 w-full object-contain"
                          />
                          <button
                            type="button"
                            onClick={() =>
                              setNewImageFiles((prev) =>
                                prev.filter(
                                  (_, itemIndex) => itemIndex !== index,
                                ),
                              )
                            }
                            className="absolute right-2 top-2 inline-flex h-8 w-8 items-center justify-center rounded-full bg-white/90 text-rose-600 shadow"
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
                  )}
                </div>
              </div>

              <div className="grid gap-4 lg:grid-cols-[180px_minmax(0,1fr)]">
                <span className="text-sm font-black text-slate-700">
                  게시 옵션
                </span>
                <label className="flex items-center gap-3 rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm font-bold text-slate-700">
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
    return <PageLoading message="개발자 일지를 불러오는 중입니다." />;
  }

  return (
    <div className="mx-auto w-full max-w-[96rem] px-4 py-5 sm:py-8">
      <section className="mb-5 px-1 py-2">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex min-w-0 items-start gap-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-blue-100 bg-blue-50 text-blue-600">
              <i className="fas fa-book text-xl" aria-hidden="true"></i>
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-3">
                <h1 className="text-2xl font-black text-gray-900">
                  개발자 일지
                </h1>
                {postId && selectedPost && (
                  <>
                    <i
                      className="fas fa-chevron-right text-xs text-gray-300"
                      aria-hidden="true"
                    ></i>
                    <span className="max-w-xl truncate text-sm font-black text-gray-700">
                      {getDisplayTitle(selectedPost)}
                    </span>
                  </>
                )}
              </div>
              <p className="mt-2 break-keep text-sm leading-6 text-gray-600">
                최근 업데이트와 패치 내역을 기록합니다.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <span className="inline-flex items-center rounded-full border border-blue-200 bg-white px-3 py-1 text-xs font-black text-blue-700">
                  <i className="fas fa-lock mr-1.5" aria-hidden="true"></i>
                  작성 권한: 개발자 전용
                </span>
                <span className="inline-flex items-center rounded-full border border-gray-200 bg-white px-3 py-1 text-xs font-black text-gray-600">
                  학생은 좋아요만 가능
                </span>
              </div>
            </div>
          </div>
          {canManage && mode !== "write" && mode !== "edit" && (
            <button
              type="button"
              onClick={startWrite}
              className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-2xl bg-blue-600 px-5 text-sm font-bold text-white shadow-sm transition hover:bg-blue-700 sm:w-auto"
            >
              <i className="fas fa-pen" aria-hidden="true"></i>
              글쓰기
            </button>
          )}
        </div>
      </section>

      <div className="w-full">
        {mode === "write" || mode === "edit" ? (
          renderEditor()
        ) : postId && selectedPost ? (
          renderPostDetail(selectedPost)
        ) : (
          <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm sm:p-6">
            <div className="mb-5 rounded-xl border border-blue-200 bg-blue-50/50 px-4 py-3 text-sm font-black text-blue-700">
              <i className="fas fa-info-circle mr-2" aria-hidden="true"></i>
              학생은 게시글에 좋아요만 누를 수 있습니다.
            </div>

            <div className="mb-5 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setCategoryFilter("all")}
                  className={`rounded-full border px-4 py-2 text-sm font-black transition ${
                    categoryFilter === "all"
                      ? "border-blue-300 bg-blue-50 text-blue-700"
                      : "border-gray-200 bg-white text-slate-600 hover:bg-gray-50"
                  }`}
                >
                  전체
                </button>
                {DEVELOPER_LOG_CATEGORIES.map((category) => (
                  <button
                    type="button"
                    key={category.value}
                    onClick={() => setCategoryFilter(category.value)}
                    className={`rounded-full border px-4 py-2 text-sm font-black transition ${
                      categoryFilter === category.value
                        ? "border-blue-300 bg-blue-50 text-blue-700"
                        : "border-gray-200 bg-white text-slate-600 hover:bg-gray-50"
                    }`}
                  >
                    {category.label}
                  </button>
                ))}
              </div>
              <div className="flex flex-col gap-2 sm:flex-row">
                <label className="relative block min-w-0 sm:w-80">
                  <span className="sr-only">개발자 일지 검색</span>
                  <i
                    className="fas fa-search absolute left-4 top-1/2 -translate-y-1/2 text-slate-400"
                    aria-hidden="true"
                  ></i>
                  <input
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
              <div className="overflow-hidden rounded-2xl border border-gray-200">
                <div className="hidden grid-cols-[minmax(0,1fr)_140px_140px_110px_110px] border-b border-gray-200 bg-gray-50 px-5 py-3 text-center text-sm font-black text-slate-600 lg:grid">
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
                      className="grid gap-3 px-5 py-4 transition hover:bg-blue-50/40 lg:grid-cols-[minmax(0,1fr)_140px_140px_110px_110px] lg:items-center"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          {post.isPinned && (
                            <i
                              className="fas fa-thumbtack text-blue-600"
                              aria-label="고정 게시글"
                            ></i>
                          )}
                          <span className="truncate text-base font-black text-slate-950">
                            {getDisplayTitle(post)}
                          </span>
                        </div>
                        {post.summary && (
                          <p className="mt-1 line-clamp-2 text-sm font-semibold leading-5 text-slate-500 lg:hidden">
                            {post.summary}
                          </p>
                        )}
                      </div>
                      <div className="text-left lg:text-center">
                        {renderCategoryBadge(post.category)}
                      </div>
                      <div className="text-sm font-semibold text-slate-600 lg:text-center">
                        {formatDate(post.publishedAt)}
                      </div>
                      <div className="text-sm font-black text-slate-700 lg:text-center">
                        <i
                          className="far fa-eye mr-1.5 text-slate-400 lg:hidden"
                          aria-hidden="true"
                        ></i>
                        {post.viewCount}
                      </div>
                      <div className="text-sm font-black text-slate-700 lg:text-center">
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
    </div>
  );
};

export default DeveloperLog;
