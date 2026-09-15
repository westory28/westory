import React, { useEffect, useRef, useState } from "react";
import SchoolBannerModal from "./SchoolBannerModal";
import ModalSurface from "../../../components/common/ModalSurface";
import {
  bannerDateTimeInput,
  manageSchoolBanners,
  schoolBannerStatus,
  type SchoolBannerRecord,
} from "../../../lib/schoolBanners";

interface Props {
  semesterId: string;
  ownerUid: string;
  banners: SchoolBannerRecord[];
  onClose: () => void;
  loading: boolean;
  failed: boolean;
  onReload: () => void;
  onSaved: (message: string) => void;
}

const period = (value: unknown, fallback: string) =>
  bannerDateTimeInput(value).replace("T", " ") || fallback;

const SchoolBannerManager: React.FC<Props> = ({
  semesterId,
  ownerUid,
  banners,
  onClose,
  loading,
  failed,
  onReload,
  onSaved: notifySaved,
}) => {
  const [items, setItems] = useState(banners);
  const [preview, setPreview] = useState<{
    imageUrl: string;
    content: string;
    developerLogPostId?: string;
  } | null>(null);
  const [selectedId, setSelectedId] = useState<string>();
  const [editorKey, setEditorKey] = useState(0);
  const [editorBusy, setEditorBusy] = useState(false);
  const [editorDirty, setEditorDirty] = useState(false);
  const [page, setPage] = useState(0);
  const previewOpener = useRef<HTMLElement | null>(null);
  const previewBack = useRef<HTMLButtonElement>(null);
  const [deleteTarget, setDeleteTarget] = useState<SchoolBannerRecord | null>(
    null,
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const onSaved = (message: string) => {
    setNotice(message);
    notifySaved(message);
  };
  const [conflicted, setConflicted] = useState(false);
  const inFlight = useRef(false);
  const requestId = useRef(crypto.randomUUID());
  const busy = saving || editorBusy || loading;
  const selected = items.find((item) => item.id === selectedId);
  const pageCount = Math.max(1, Math.ceil(items.length / 3));
  useEffect(() => {
    if (!loading && !failed) {
      setItems(banners);
      setPage((value) =>
        Math.min(value, Math.max(0, Math.ceil(banners.length / 3) - 1)),
      );
    }
  }, [banners, loading, failed]);
  useEffect(() => {
    if (preview) previewBack.current?.focus();
  }, [preview]);
  const resetEditor = () => {
    setSelectedId(undefined);
    setEditorKey((value) => value + 1);
    setEditorDirty(false);
  };

  const showPreview = (
    imageUrl: string,
    content: string,
    developerLogPostId?: string,
  ) => {
    previewOpener.current = document.activeElement as HTMLElement;
    setPreview({ imageUrl, content, developerLogPostId });
  };
  const closePreview = () => {
    setPreview(null);
    requestAnimationFrame(() => previewOpener.current?.focus());
  };
  const dirty = items.some((item, index) => item.id !== banners[index]?.id);
  const move = (index: number, direction: number) => {
    if (busy || editorDirty || conflicted) return;
    const destination = index + direction;
    if (destination < 0 || destination >= items.length) return;
    const next = [...items];
    [next[index], next[destination]] = [next[destination], next[index]];
    requestId.current = crypto.randomUUID();
    setItems(next);
    setPage(Math.floor(destination / 3));
    setError("");
  };
  const save = async (action: "REORDER" | "DELETE") => {
    if (
      inFlight.current ||
      busy ||
      editorDirty ||
      conflicted ||
      (action === "DELETE" && !deleteTarget)
    )
      return;
    inFlight.current = true;
    setSaving(true);
    setError("");
    try {
      await manageSchoolBanners(
        {
          semesterId,
          requestId: requestId.current,
          ...(action === "REORDER"
            ? {
                action,
                items: items.map((item) => ({
                  id: item.id,
                  revision: item.revision,
                })),
              }
            : {
                action,
                noticeId: deleteTarget!.id,
                expectedRevision: deleteTarget!.revision,
              }),
        },
        ownerUid,
      );
      if (action === "DELETE") {
        setDeleteTarget(null);
        if (selectedId === deleteTarget?.id) resetEditor();
      }
      onSaved(
        action === "REORDER"
          ? "배너 순서가 저장되었습니다."
          : "배너가 삭제되었습니다.",
      );
    } catch (caught) {
      const code = String((caught as { code?: string })?.code || "");
      if (/aborted|failed-precondition/.test(code)) setConflicted(true);
      setError(
        /aborted|failed-precondition/.test(code)
          ? "다른 작업에서 배너나 학기 정보가 바뀌었습니다. 창을 닫고 다시 불러온 뒤 시도해 주세요."
          : /permission-denied|unauthenticated/.test(code)
            ? "관리 권한 또는 로그인 상태를 확인해 주세요."
            : "저장 결과를 확인하지 못했습니다. 같은 작업을 다시 눌러 주세요. 중복 처리는 방지됩니다.",
      );
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  };

  return (
    <ModalSurface
      open
      title={preview ? "학교 배너 미리보기" : "학교 배너 관리"}
      size="wide"
      onClose={preview ? closePreview : onClose}
      dismissible={!busy}
    >
      <div className="school-banner-workspace">
        {preview && (
          <div className="school-banner-workspace__preview">
            <h3 className="font-bold">{preview.content || "학교 안내 배너"}</h3>
            <img
              src={preview.imageUrl}
              alt={preview.content || "학교 안내 배너"}
            />
            <div className="flex flex-wrap justify-end gap-2">
              {preview.developerLogPostId && (
                <a
                  className="min-h-11 rounded-lg border px-3 py-2 font-bold text-blue-700"
                  href={`#/developer-log/${encodeURIComponent(preview.developerLogPostId)}`}
                >
                  연결된 개발자 일지 보기
                </a>
              )}
              <button
                ref={previewBack}
                type="button"
                className="min-h-11 rounded-lg border border-gray-200 px-4 font-bold"
                onClick={closePreview}
              >
                편집으로 돌아가기
              </button>
            </div>
          </div>
        )}
        <div
          className="school-banner-workspace__layout"
          hidden={Boolean(preview)}
        >
          <aside
            className="school-banner-workspace__list"
            aria-label="등록된 배너"
          >
            <div className="mb-2 flex items-center justify-between gap-2">
              <h3 className="font-bold">배너 {items.length}개</h3>
              <button
                type="button"
                className="min-h-11 rounded-lg border border-blue-200 px-3 font-bold text-blue-700 disabled:opacity-50"
                disabled={busy || dirty || editorDirty || Boolean(deleteTarget)}
                onClick={resetEditor}
              >
                새 배너
              </button>
            </div>
            {failed ? (
              <button
                type="button"
                onClick={onReload}
                className="min-h-11 text-blue-700"
              >
                목록 다시 불러오기
              </button>
            ) : loading ? (
              <p role="status" className="text-sm text-gray-600">
                목록을 불러오는 중입니다.
              </p>
            ) : null}
            {!items.length && !loading && (
              <p className="py-4 text-sm text-gray-600">
                등록된 배너가 없습니다. 오른쪽에서 새 배너를 등록해 주세요.
              </p>
            )}
            <ol className="divide-y divide-gray-200" start={page * 3 + 1}>
              {items.slice(page * 3, page * 3 + 3).map((item, offset) => {
                const index = page * 3 + offset;
                const locked =
                  busy || editorDirty || conflicted || Boolean(deleteTarget);
                return (
                  <li
                    key={item.id}
                    className="py-2"
                    aria-current={selectedId === item.id ? "true" : undefined}
                  >
                    <div className="flex items-start gap-2">
                      <button
                        type="button"
                        className="w-16 shrink-0 overflow-hidden rounded border border-gray-200 text-xs font-bold text-blue-700"
                        aria-label={`${item.content || "학교 안내 배너"} 미리보기`}
                        onClick={() =>
                          showPreview(
                            item.imageUrl || "",
                            item.content,
                            item.developerLogPostId,
                          )
                        }
                        disabled={busy}
                      >
                        <img
                          src={item.imageUrl}
                          alt=""
                          className="aspect-video w-full object-contain"
                        />
                        <span className="block py-1">미리보기</span>
                      </button>
                      <div className="min-w-0 flex-1">
                        <h3
                          className="truncate text-sm font-bold"
                          title={item.content}
                        >
                          {index + 1}. {item.content || "학교 안내 배너"}
                        </h3>
                        <p className="text-xs text-gray-600">
                          {schoolBannerStatus(item)} ·{" "}
                          {item.targetType === "class"
                            ? `${item.targetClass} 학급`
                            : "전체 공통"}
                        </p>
                        <p className="text-xs text-gray-500">
                          {period(item.publishAt, "즉시")} ~<br />
                          {period(item.expiresAt, "종료 제한 없음")}
                        </p>
                      </div>
                    </div>
                    <div className="mt-1 flex justify-end gap-1">
                      <button
                        type="button"
                        className="min-h-11 min-w-11 rounded border border-gray-200 font-bold disabled:opacity-40"
                        aria-label={`${item.content || "배너"} 위로 이동`}
                        disabled={locked || index === 0}
                        onClick={() => move(index, -1)}
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        className="min-h-11 min-w-11 rounded border border-gray-200 font-bold disabled:opacity-40"
                        aria-label={`${item.content || "배너"} 아래로 이동`}
                        disabled={locked || index === items.length - 1}
                        onClick={() => move(index, 1)}
                      >
                        ↓
                      </button>
                      <button
                        type="button"
                        className="min-h-11 rounded border border-gray-200 px-2 text-sm font-bold disabled:opacity-40"
                        disabled={locked || dirty}
                        onClick={() => {
                          setSelectedId(item.id);
                          setEditorKey((value) => value + 1);
                        }}
                      >
                        수정
                      </button>
                      <button
                        type="button"
                        className="min-h-11 rounded border border-red-200 px-2 text-sm font-bold text-red-700 disabled:opacity-40"
                        disabled={locked || dirty}
                        onClick={() => {
                          requestId.current = crypto.randomUUID();
                          setDeleteTarget(item);
                          setError("");
                        }}
                      >
                        삭제
                      </button>
                    </div>
                  </li>
                );
              })}
            </ol>
            {pageCount > 1 && (
              <nav
                aria-label="배너 목록 페이지"
                className="flex items-center justify-between gap-2"
              >
                <button
                  type="button"
                  className="min-h-11 px-2 text-sm disabled:opacity-40"
                  disabled={page === 0 || busy}
                  onClick={() => setPage((value) => value - 1)}
                >
                  이전 페이지
                </button>
                <span className="text-sm">
                  {page + 1} / {pageCount}
                </span>
                <button
                  type="button"
                  className="min-h-11 px-2 text-sm disabled:opacity-40"
                  disabled={page + 1 === pageCount || busy}
                  onClick={() => setPage((value) => value + 1)}
                >
                  다음 페이지
                </button>
              </nav>
            )}
            <div className="mt-2 flex items-center justify-between gap-2">
              <span className="text-xs text-gray-600">
                {dirty
                  ? "이동한 순서를 저장해 주세요."
                  : "위에 있는 배너부터 표시됩니다."}
              </span>
              <button
                type="button"
                className="min-h-11 shrink-0 rounded-lg border border-gray-200 px-3 text-sm font-bold text-blue-700 disabled:opacity-40"
                disabled={
                  !dirty ||
                  busy ||
                  editorDirty ||
                  conflicted ||
                  Boolean(deleteTarget)
                }
                onClick={() => void save("REORDER")}
              >
                순서 저장
              </button>
            </div>
          </aside>
          <section
            className="school-banner-workspace__editor"
            aria-label="배너 편집"
          >
            <fieldset
              disabled={
                saving || loading || failed || dirty || Boolean(deleteTarget)
              }
            >
              <SchoolBannerModal
                key={`${selectedId || "new"}:${editorKey}`}
                semesterId={semesterId}
                ownerUid={ownerUid}
                banner={selected}
                onClose={resetEditor}
                onBusyChange={setEditorBusy}
                onDirtyChange={setEditorDirty}
                onPreview={(url, title) =>
                  showPreview(url, title, selected?.developerLogPostId)
                }
                onSaved={() => {
                  const wasEditing = Boolean(selectedId);
                  resetEditor();
                  onSaved(
                    wasEditing
                      ? "학교 배너가 수정되었습니다."
                      : "학교 배너가 등록되었습니다.",
                  );
                }}
              />
            </fieldset>
          </section>
        </div>
        {!preview && deleteTarget && (
          <div className="school-banner-workspace__notice bg-red-50 text-red-700">
            <p className="text-sm">
              ‘{deleteTarget.content || "학교 안내 배너"}’를 삭제하시겠습니까?
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                className="min-h-11 rounded border border-gray-200 bg-white px-3 font-bold"
                disabled={busy}
                onClick={() => setDeleteTarget(null)}
              >
                삭제 취소
              </button>
              <button
                type="button"
                className="min-h-11 rounded bg-red-600 px-3 font-bold text-white disabled:opacity-40"
                disabled={busy || conflicted}
                onClick={() => void save("DELETE")}
              >
                배너 삭제
              </button>
            </div>
          </div>
        )}
        {!preview && notice && !error && (
          <p role="status" className="mt-2 text-sm text-green-700">
            {notice}
          </p>
        )}
        {!preview && error && (
          <p
            role="alert"
            className="mt-2 rounded bg-red-50 p-2 text-sm text-red-700"
          >
            {error}
          </p>
        )}
      </div>
    </ModalSurface>
  );
};

export default SchoolBannerManager;
