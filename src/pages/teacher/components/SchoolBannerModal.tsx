import React, { useEffect, useRef, useState } from "react";
import { collection, getDocs, limit, orderBy, query } from "firebase/firestore";
import { db } from "../../../lib/firebase";
import {
  DEVELOPER_LOG_ITEMS_COLLECTION,
  DEVELOPER_LOG_SETTINGS_DOC,
  normalizeDeveloperLogPost,
  type DeveloperLogPost,
} from "../../../lib/developerLogs";
import { compressNoticeImage } from "../../../lib/noticeImages";
import {
  bannerDateTimeInput,
  bannerDateTimeIso,
  bannerTimestamp,
  registerSchoolBanner,
  type SchoolBannerRecord,
} from "../../../lib/schoolBanners";

interface Props {
  semesterId: string;
  ownerUid: string;
  onClose: () => void;
  onSaved: () => void;
  banner?: SchoolBannerRecord;
  onBusyChange?: (busy: boolean) => void;
  onDirtyChange?: (dirty: boolean) => void;
  onPreview?: (url: string, title: string) => void;
}
const CATEGORIES = [
  { value: "notice", label: "공지" },
  { value: "event", label: "학교 행사" },
  { value: "exam", label: "정기 시험" },
  { value: "performance", label: "수행평가" },
  { value: "prep", label: "준비" },
  { value: "dday", label: "D-Day" },
];
const categoryLabel = (value: string) =>
  CATEGORIES.find((item) => item.value === value)?.label ||
  (value === "normal" ? "공지" : "학교 안내");
const inputClass =
  "min-h-11 w-full min-w-0 rounded-lg border border-gray-200 bg-white p-2 text-sm focus:ring-2 focus:ring-blue-500 disabled:opacity-60";
const labelClass = "mb-1 block text-sm font-bold text-gray-800";
const secondaryButton =
  "min-h-11 rounded-lg border border-gray-200 px-4 font-bold text-gray-700 disabled:opacity-60";

const SchoolBannerModal: React.FC<Props> = ({
  semesterId,
  ownerUid,
  onClose,
  onSaved,
  banner,
  onBusyChange,
  onDirtyChange,
  onPreview,
}) => {
  const editing = Boolean(banner);
  const [draft, setDraft] = useState(() => {
    const [grade, className] = String(banner?.targetClass || "1-1").split("-");
    return {
      title: banner ? banner.content || categoryLabel(banner.category) : "",
      publishAt: bannerDateTimeInput(banner?.publishAt),
      expiresAt: bannerDateTimeInput(banner?.expiresAt),
      category: banner?.category || "notice",
      targetType: banner?.targetType || "common",
      targetGrade: grade || "1",
      targetClass: className || "1",
      targetDate: banner?.targetDate || "",
      developerLogPostId: banner?.developerLogPostId || "",
    };
  });
  const [image, setImage] = useState<Blob | null>(null);
  const [preview, setPreview] = useState(banner?.imageUrl || "");
  const [preparing, setPreparing] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [posts, setPosts] = useState<DeveloperLogPost[]>([]);
  const [postsLoading, setPostsLoading] = useState(true);
  const [postsFailed, setPostsFailed] = useState(false);
  const requestId = useRef(crypto.randomUUID());
  const sequence = useRef(0);
  const inFlight = useRef(false);
  const titleRef = useRef<HTMLInputElement>(null);
  const errorRef = useRef<HTMLParagraphElement>(null);
  const mounted = useRef(true);
  const busyCallback = useRef(onBusyChange);
  const dirtyCallback = useRef(onDirtyChange);
  busyCallback.current = onBusyChange;
  dirtyCallback.current = onDirtyChange;

  useEffect(() => {
    mounted.current = true;
    titleRef.current?.focus();
    dirtyCallback.current?.(false);
    return () => {
      mounted.current = false;
      sequence.current++;
      dirtyCallback.current?.(false);
      busyCallback.current?.(false);
    };
  }, []);
  useEffect(() => {
    onBusyChange?.(saving || preparing);
  }, [onBusyChange, saving, preparing]);
  useEffect(() => {
    if (!image) {
      setPreview(banner?.imageUrl || "");
      return;
    }
    const url = URL.createObjectURL(image);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [image, banner?.imageUrl]);
  useEffect(() => {
    let active = true;
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
        if (active)
          setPosts(
            snapshot.docs.map((item) =>
              normalizeDeveloperLogPost(item.id, item.data()),
            ),
          );
      })
      .catch(() => {
        if (active) setPostsFailed(true);
      })
      .finally(() => {
        if (active) setPostsLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    if (error) errorRef.current?.scrollIntoView({ block: "nearest" });
  }, [error]);

  const change = (field: keyof typeof draft, value: string) => {
    if (inFlight.current) return;
    onDirtyChange?.(true);
    setDraft((previous) => ({ ...previous, [field]: value }));
    requestId.current = crypto.randomUUID();
    if (!imageFailed) setError("");
  };
  const selectFile = async (file?: File) => {
    if (!file || inFlight.current) return;
    onDirtyChange?.(true);
    const current = ++sequence.current;
    setImage(null);
    setImageFailed(false);
    setError("");
    requestId.current = crypto.randomUUID();
    if (
      !["image/jpeg", "image/png", "image/webp"].includes(file.type) ||
      file.size > 10 * 1024 * 1024
    ) {
      setPreparing(false);
      setImageFailed(true);
      setError("JPG, PNG, WebP 이미지 중 10MB 이하의 파일을 선택해 주세요.");
      return;
    }
    setPreparing(true);
    try {
      const compressed = await compressNoticeImage(file);
      if (current === sequence.current) setImage(compressed.blob);
    } catch {
      if (current === sequence.current) {
        setImageFailed(true);
        setError(
          "이미지를 처리하지 못했습니다. 다른 이미지 파일을 선택해 주세요.",
        );
      }
    } finally {
      if (current === sequence.current) setPreparing(false);
    }
  };
  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (inFlight.current || preparing || imageFailed) return;
    if (!draft.title.trim() || (!image && !banner?.imageUrl)) {
      setError("배너 제목과 이미지를 입력해 주세요.");
      return;
    }
    if (
      draft.targetType === "class" &&
      (!/^\d+-\d+$/.test(`${draft.targetGrade}-${draft.targetClass}`) ||
        Number(draft.targetGrade) < 1 ||
        Number(draft.targetClass) < 1 ||
        Number(draft.targetGrade) > 99 ||
        Number(draft.targetClass) > 99)
    ) {
      setError("게시할 학년과 반을 1~99 사이의 숫자로 입력해 주세요.");
      return;
    }
    if (draft.category === "dday" && !draft.targetDate) {
      setError("D-Day 목표 날짜를 입력해 주세요.");
      return;
    }
    let publishAt: string | null;
    let expiresAt: string | null;
    try {
      const dateValue = (input: string, original: unknown) => {
        const originalTime = bannerTimestamp(original);
        return editing &&
          originalTime &&
          input === bannerDateTimeInput(original)
          ? new Date(originalTime).toISOString()
          : bannerDateTimeIso(input);
      };
      publishAt = dateValue(draft.publishAt, banner?.publishAt);
      expiresAt = dateValue(draft.expiresAt, banner?.expiresAt);
      if ((draft.publishAt && !publishAt) || (draft.expiresAt && !expiresAt))
        throw new Error("invalid-date");
    } catch {
      setError("게시 시작과 종료 날짜·시간을 올바르게 입력해 주세요.");
      return;
    }
    if (
      expiresAt &&
      ((publishAt && Date.parse(expiresAt) <= Date.parse(publishAt)) ||
        (!editing && !publishAt && Date.parse(expiresAt) <= Date.now()))
    ) {
      setError("게시 종료는 게시 시작보다 늦어야 합니다.");
      return;
    }
    inFlight.current = true;
    setSaving(true);
    setError("");
    try {
      await registerSchoolBanner(
        {
          semesterId,
          requestId: requestId.current,
          title: draft.title,
          image,
          ...(banner
            ? { noticeId: banner.id, expectedRevision: banner.revision }
            : {}),
          publishAt,
          expiresAt,
          category: draft.category,
          targetType: draft.targetType,
          targetClass:
            draft.targetType === "class"
              ? `${draft.targetGrade}-${draft.targetClass}`
              : null,
          targetDate:
            draft.category === "dday" && draft.targetDate
              ? draft.targetDate
              : null,
          developerLogPostId: draft.developerLogPostId || null,
        },
        ownerUid,
      );
      if (mounted.current) onSaved();
    } catch (caught) {
      if (!mounted.current) return;
      const code = String((caught as { code?: string })?.code || "");
      setError(
        /permission-denied|unauthenticated/.test(code)
          ? "저장 권한 또는 로그인 상태를 확인해 주세요. 다시 로그인한 뒤 저장할 수 있습니다."
          : /unavailable|deadline-exceeded|internal/.test(code)
            ? "저장 결과를 확인하지 못했습니다. 같은 내용으로 다시 저장해 주세요. 중복 저장은 방지됩니다."
            : /aborted/.test(code)
              ? "다른 변경이 확인되었습니다. 입력한 내용을 확인한 뒤 창을 닫고 배너를 다시 열어 주세요."
              : caught instanceof Error
                ? caught.message
                : "배너를 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.",
      );
    } finally {
      inFlight.current = false;
      if (mounted.current) setSaving(false);
    }
  };

  return (
    <form
      id="school-banner-form"
      onSubmit={save}
      className="school-banner-editor"
      aria-busy={saving || preparing}
    >
      <h3 className="mb-3 text-lg font-bold text-gray-900">
        {editing ? "학교 배너 수정" : "학교 배너 등록"}
      </h3>
      <div className="school-banner-editor__columns">
        <div className="school-banner-editor__image">
          <label htmlFor="school-banner-image" className={labelClass}>
            {editing ? "배너 이미지 변경" : "배너 이미지"}
          </label>
          {preview ? (
            <div className="mb-2 overflow-hidden rounded-lg border border-gray-200">
              <img
                src={preview}
                alt={draft.title.trim() || "배너 미리보기"}
                className="aspect-video h-auto w-full object-contain"
              />
            </div>
          ) : (
            <div className="mb-2 flex aspect-video items-center justify-center rounded-lg border border-gray-200 bg-gray-50 text-sm text-gray-600">
              이미지를 선택해 주세요.
            </div>
          )}
          <input
            id="school-banner-image"
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="min-h-11 w-full min-w-0 rounded-lg border border-gray-200 p-2 text-sm"
            disabled={saving}
            aria-describedby="school-banner-help"
            onChange={(event) => {
              void selectFile(event.target.files?.[0]);
            }}
          />
          <p id="school-banner-help" className="mt-2 text-sm text-gray-600">
            JPG·PNG·WebP, 최대 10MB
            <br />
            권장 1200 × 675px · 16:9 중앙 맞춤·압축
          </p>
          {editing && (
            <p className="mt-1 text-sm text-gray-600">
              선택하지 않으면 기존 이미지를 유지합니다.
            </p>
          )}
          {preparing && (
            <p role="status" className="mt-2 text-sm text-blue-700">
              이미지를 준비하는 중입니다.
            </p>
          )}
          {preview && onPreview && (
            <button
              type="button"
              className={`${secondaryButton} mt-2 text-sm`}
              disabled={saving || preparing}
              onClick={() =>
                onPreview(preview, draft.title.trim() || "배너 미리보기")
              }
            >
              크게 미리보기
            </button>
          )}
        </div>
        <fieldset disabled={saving} className="school-banner-editor__fields">
          <div>
            <label htmlFor="school-banner-title" className={labelClass}>
              배너 제목
            </label>
            <input
              ref={titleRef}
              id="school-banner-title"
              className={inputClass}
              maxLength={120}
              required
              value={draft.title}
              onChange={(event) => change("title", event.target.value)}
            />
          </div>
          <div>
            <div className="school-banner-editor__period">
              <div>
                <label htmlFor="school-banner-publish" className={labelClass}>
                  게시 시작
                </label>
                <input
                  id="school-banner-publish"
                  type="datetime-local"
                  className={inputClass}
                  value={draft.publishAt}
                  onChange={(event) => change("publishAt", event.target.value)}
                  aria-describedby="school-banner-period-help"
                />
              </div>
              <div>
                <label htmlFor="school-banner-expires" className={labelClass}>
                  게시 종료
                </label>
                <input
                  id="school-banner-expires"
                  type="datetime-local"
                  className={inputClass}
                  value={draft.expiresAt}
                  onChange={(event) => change("expiresAt", event.target.value)}
                  aria-describedby="school-banner-period-help"
                />
              </div>
            </div>
            <p
              id="school-banner-period-help"
              className="mt-1 text-sm text-gray-600"
            >
              한국 시간(KST) · 시작 공란: 바로 게시 / 종료 공란: 계속 게시
            </p>
          </div>
          <div className="school-banner-editor__pair">
            <div>
              <label htmlFor="school-banner-category" className={labelClass}>
                분류
              </label>
              <select
                id="school-banner-category"
                className={inputClass}
                value={draft.category}
                onChange={(event) => change("category", event.target.value)}
              >
                {!CATEGORIES.some((item) => item.value === draft.category) && (
                  <option value={draft.category}>
                    {categoryLabel(draft.category)}
                  </option>
                )}
                {CATEGORIES.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="school-banner-target" className={labelClass}>
                게시 대상
              </label>
              <select
                id="school-banner-target"
                className={inputClass}
                value={draft.targetType}
                onChange={(event) => change("targetType", event.target.value)}
              >
                <option value={banner?.targetType === "all" ? "all" : "common"}>
                  전체 공통
                </option>
                <option value="class">학급 선택</option>
              </select>
            </div>
          </div>
          {(draft.category === "dday" || draft.targetType === "class") && (
            <div className="school-banner-editor__pair">
              {draft.category === "dday" && (
                <div>
                  <label
                    htmlFor="school-banner-target-date"
                    className={labelClass}
                  >
                    D-Day 목표 날짜
                  </label>
                  <input
                    id="school-banner-target-date"
                    type="date"
                    required
                    className={inputClass}
                    value={draft.targetDate}
                    onChange={(event) =>
                      change("targetDate", event.target.value)
                    }
                  />
                </div>
              )}
              {draft.targetType === "class" && (
                <div className="school-banner-editor__pair">
                  <div>
                    <label htmlFor="school-banner-grade" className={labelClass}>
                      학년
                    </label>
                    <input
                      id="school-banner-grade"
                      type="number"
                      min="1"
                      max="99"
                      step="1"
                      required
                      className={inputClass}
                      value={draft.targetGrade}
                      onChange={(event) =>
                        change("targetGrade", event.target.value)
                      }
                    />
                  </div>
                  <div>
                    <label htmlFor="school-banner-class" className={labelClass}>
                      반
                    </label>
                    <input
                      id="school-banner-class"
                      type="number"
                      min="1"
                      max="99"
                      step="1"
                      required
                      className={inputClass}
                      value={draft.targetClass}
                      onChange={(event) =>
                        change("targetClass", event.target.value)
                      }
                    />
                  </div>
                </div>
              )}
            </div>
          )}
          <div>
            <label htmlFor="school-banner-post" className={labelClass}>
              연동 게시물
            </label>
            <select
              id="school-banner-post"
              className={inputClass}
              value={draft.developerLogPostId}
              disabled={postsLoading}
              onChange={(event) =>
                change("developerLogPostId", event.target.value)
              }
              aria-describedby="school-banner-post-help"
            >
              <option value="">
                {postsLoading ? "게시물 불러오는 중…" : "연동 없음"}
              </option>
              {draft.developerLogPostId &&
                !posts.some((post) => post.id === draft.developerLogPostId) && (
                  <option value={draft.developerLogPostId}>
                    현재 연결된 게시물
                  </option>
                )}
              {posts.map((post) => (
                <option key={post.id} value={post.id}>
                  {post.version ? `[${post.version}] ` : ""}
                  {post.title || "제목 없는 게시물"}
                </option>
              ))}
            </select>
            <p
              id="school-banner-post-help"
              className="mt-1 text-sm text-gray-600"
            >
              배너와 연결할 개발자 일지를 선택합니다.
            </p>
            {postsFailed && (
              <p role="status" className="mt-1 text-sm text-gray-600">
                게시물 목록을 불러오지 못했습니다. 기존 연결은 유지됩니다.
                목록이 필요하면 창을 다시 열어 주세요.
              </p>
            )}
          </div>
        </fieldset>
      </div>
      {error && (
        <p
          ref={errorRef}
          role="alert"
          className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-700"
        >
          {error}
        </p>
      )}
      {saving && (
        <p role="status" className="mt-3 text-sm text-blue-700">
          배너 정보를 저장하고 있습니다.
        </p>
      )}
      <div className="mt-3 flex justify-end gap-2">
        <button
          type="button"
          className={secondaryButton}
          onClick={onClose}
          disabled={saving || preparing}
        >
          취소
        </button>
        <button
          type="submit"
          className="min-h-11 rounded-lg bg-blue-600 px-4 font-bold text-white hover:bg-blue-700 disabled:opacity-60"
          disabled={
            saving || preparing || imageFailed || (!image && !banner?.imageUrl)
          }
        >
          {saving ? "저장 중…" : editing ? "수정 저장" : "등록"}
        </button>
      </div>
    </form>
  );
};

export default SchoolBannerModal;
