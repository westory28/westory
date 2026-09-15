import React, { useRef, useState } from "react";
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
  onEdit: (banner: SchoolBannerRecord) => void;
  onSaved: (message: string) => void;
}

const period = (value: unknown, fallback: string) =>
  bannerDateTimeInput(value).replace("T", " ") || fallback;

const SchoolBannerManager: React.FC<Props> = ({
  semesterId,
  ownerUid,
  banners,
  onClose,
  onEdit,
  onSaved,
}) => {
  const [items, setItems] = useState(banners);
  const [preview, setPreview] = useState<SchoolBannerRecord | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<SchoolBannerRecord | null>(
    null,
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [conflicted, setConflicted] = useState(false);
  const inFlight = useRef(false);
  const requestId = useRef(crypto.randomUUID());
  const dirty = items.some((item, index) => item.id !== banners[index]?.id);
  const move = (index: number, direction: number) => {
    if (saving || conflicted) return;
    const destination = index + direction;
    if (destination < 0 || destination >= items.length) return;
    const next = [...items];
    [next[index], next[destination]] = [next[destination], next[index]];
    requestId.current = crypto.randomUUID();
    setItems(next);
    setError("");
  };
  const save = async (action: "REORDER" | "DELETE") => {
    if (
      inFlight.current ||
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
      onClose={preview ? () => setPreview(null) : onClose}
      dismissible={!saving}
      footer={
        preview ? (
          <button
            type="button"
            className="min-h-11 rounded-lg border border-gray-200 px-4 font-bold"
            onClick={() => setPreview(null)}
          >
            목록으로
          </button>
        ) : (
          <>
            <button
              type="button"
              className="min-h-11 rounded-lg border border-gray-200 px-4 font-bold disabled:opacity-60"
              onClick={onClose}
              disabled={saving}
            >
              닫기
            </button>
            <button
              type="button"
              className="min-h-11 rounded-lg bg-blue-600 px-4 font-bold text-white hover:bg-blue-700 disabled:opacity-60"
              disabled={!dirty || saving || Boolean(deleteTarget) || conflicted}
              onClick={() => void save("REORDER")}
            >
              {saving ? "저장 중…" : "순서 저장"}
            </button>
          </>
        )
      }
    >
      {preview ? (
        <div className="space-y-3">
          <h3 className="break-words font-bold">
            {preview.content || "학교 안내 배너"}
          </h3>
          <img
            src={preview.imageUrl}
            alt={preview.content || "학교 안내 배너"}
            className="h-auto w-full rounded-lg"
          />
          <p className="text-sm text-gray-600">
            {period(preview.publishAt, "시작 제한 없음")} ~{" "}
            {period(preview.expiresAt, "종료 제한 없음")} (한국 시간)
          </p>
          {preview.developerLogPostId && (
            <a
              href={`#/developer-log/${encodeURIComponent(preview.developerLogPostId)}`}
              className="inline-flex min-h-11 items-center rounded-lg border border-gray-200 px-4 font-bold text-blue-700"
            >
              연결된 개발자 일지 보기
            </a>
          )}
        </div>
      ) : (
        <>
          <p className="mb-4 text-sm text-gray-600">
            위에 있는 배너부터 표시됩니다. 예약·종료된 배너와 학급별 배너도
            수정할 수 있습니다.
          </p>
          {dirty && (
            <p role="status" className="mb-3 text-sm text-blue-700">
              순서를 이동했습니다. ‘순서 저장’을 눌러 반영해 주세요.
            </p>
          )}
          {error && (
            <p
              role="alert"
              className="mb-3 rounded-lg bg-red-50 p-3 text-sm text-red-700"
            >
              {error}
            </p>
          )}
          {!items.length && (
            <p className="py-8 text-center text-gray-600">
              등록된 배너가 없습니다.
            </p>
          )}
          <ol className="divide-y divide-gray-200">
            {items.map((item, index) => (
              <li key={item.id} className="py-4">
                <div className="flex items-start gap-3">
                  <span className="shrink-0 py-2 font-bold text-gray-600">
                    {index + 1}
                  </span>
                  <button
                    type="button"
                    className="w-24 shrink-0 overflow-hidden rounded-lg border border-gray-200"
                    aria-label={`${item.content || "학교 안내 배너"} 미리보기`}
                    onClick={() => setPreview(item)}
                    disabled={saving}
                  >
                    <img
                      src={item.imageUrl}
                      alt=""
                      className="aspect-video h-auto w-full object-contain"
                    />
                    <span className="block py-2 text-sm font-bold text-blue-700">
                      미리보기
                    </span>
                  </button>
                  <div className="min-w-0 flex-1">
                    <h3 className="break-words font-bold text-gray-900">
                      {item.content || "학교 안내 배너"}
                    </h3>
                    <p className="mt-1 text-sm text-gray-600">
                      {schoolBannerStatus(item)} ·{" "}
                      {item.targetType === "class"
                        ? `${item.targetClass} 학급`
                        : "전체 공통"}
                    </p>
                    <p className="mt-1 break-words text-sm text-gray-600">
                      {period(item.publishAt, "시작 제한 없음")} ~{" "}
                      {period(item.expiresAt, "종료 제한 없음")}
                    </p>
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap justify-end gap-2">
                  <button
                    type="button"
                    className="min-h-11 rounded-lg border border-gray-200 px-3 text-sm font-bold disabled:opacity-60"
                    onClick={() => move(index, -1)}
                    disabled={
                      saving ||
                      conflicted ||
                      Boolean(deleteTarget) ||
                      index === 0
                    }
                    aria-label={`${item.content || "배너"} 위로 이동`}
                  >
                    ↑ 위로
                  </button>
                  <button
                    type="button"
                    className="min-h-11 rounded-lg border border-gray-200 px-3 text-sm font-bold disabled:opacity-60"
                    onClick={() => move(index, 1)}
                    disabled={
                      saving ||
                      conflicted ||
                      Boolean(deleteTarget) ||
                      index === items.length - 1
                    }
                    aria-label={`${item.content || "배너"} 아래로 이동`}
                  >
                    ↓ 아래로
                  </button>
                  <button
                    type="button"
                    className="min-h-11 rounded-lg border border-gray-200 px-3 text-sm font-bold disabled:opacity-60"
                    disabled={
                      saving || dirty || Boolean(deleteTarget) || conflicted
                    }
                    onClick={() => onEdit(item)}
                  >
                    수정
                  </button>
                  <button
                    type="button"
                    className="min-h-11 rounded-lg border border-red-200 px-3 text-sm font-bold text-red-700 disabled:opacity-60"
                    disabled={
                      saving || dirty || Boolean(deleteTarget) || conflicted
                    }
                    onClick={() => {
                      requestId.current = crypto.randomUUID();
                      setDeleteTarget(item);
                      setError("");
                    }}
                  >
                    삭제
                  </button>
                </div>
                {deleteTarget?.id === item.id && (
                  <div className="mt-3 rounded-lg bg-red-50 p-3">
                    <p className="text-sm text-red-700">
                      이 배너를 삭제하시겠습니까? 목록과 게시 화면에서
                      제거됩니다.
                    </p>
                    <div className="mt-3 flex justify-end gap-2">
                      <button
                        type="button"
                        className="min-h-11 rounded-lg border border-gray-200 bg-white px-3 font-bold"
                        disabled={saving}
                        onClick={() => setDeleteTarget(null)}
                      >
                        삭제 취소
                      </button>
                      <button
                        type="button"
                        className="min-h-11 rounded-lg bg-red-600 px-3 font-bold text-white disabled:opacity-60"
                        disabled={saving || conflicted}
                        onClick={() => void save("DELETE")}
                      >
                        {saving ? "삭제 중…" : "배너 삭제"}
                      </button>
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ol>
        </>
      )}
    </ModalSurface>
  );
};

export default SchoolBannerManager;
