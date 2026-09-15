import React, { useEffect, useRef, useState } from "react";
import ModalSurface from "../../../components/common/ModalSurface";
import { compressNoticeImage } from "../../../lib/noticeImages";
import { registerSchoolBanner } from "../../../lib/schoolBanners";

interface Props {
  semesterId: string;
  ownerUid: string;
  onClose: () => void;
  onSaved: () => void;
}

const SchoolBannerModal: React.FC<Props> = ({
  semesterId,
  ownerUid,
  onClose,
  onSaved,
}) => {
  const [title, setTitle] = useState("");
  const [image, setImage] = useState<Blob | null>(null);
  const [preview, setPreview] = useState("");
  const [preparing, setPreparing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const requestId = useRef(crypto.randomUUID());
  const sequence = useRef(0);
  const inFlight = useRef(false);
  const titleRef = useRef<HTMLInputElement>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      sequence.current++;
    };
  }, []);
  useEffect(() => {
    if (!image) {
      setPreview("");
      return;
    }
    const url = URL.createObjectURL(image);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [image]);

  const selectFile = async (file?: File) => {
    if (!file || inFlight.current) return;
    const current = ++sequence.current;
    setImage(null);
    setError("");
    requestId.current = crypto.randomUUID();
    if (
      !["image/jpeg", "image/png", "image/webp"].includes(file.type) ||
      file.size > 10 * 1024 * 1024
    ) {
      setPreparing(false);
      setError("JPG, PNG, WebP 이미지 중 10MB 이하의 파일을 선택해 주세요.");
      return;
    }
    setPreparing(true);
    try {
      const compressed = await compressNoticeImage(file);
      if (current === sequence.current) setImage(compressed.blob);
    } catch {
      if (current === sequence.current)
        setError(
          "이미지를 처리하지 못했습니다. 다른 이미지 파일을 선택해 주세요.",
        );
    } finally {
      if (current === sequence.current) setPreparing(false);
    }
  };

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (inFlight.current || preparing) return;
    if (!title.trim() || !image) {
      setError("배너 제목과 이미지를 입력해 주세요.");
      return;
    }
    inFlight.current = true;
    setSaving(true);
    setError("");
    try {
      await registerSchoolBanner(
        { semesterId, requestId: requestId.current, title, image },
        ownerUid,
      );
      if (mounted.current) onSaved();
    } catch (caught) {
      if (!mounted.current) return;
      const code = String((caught as { code?: string })?.code || "");
      setError(
        /permission-denied|unauthenticated/.test(code)
          ? "등록 권한 또는 로그인 상태를 확인해 주세요. 다시 로그인한 뒤 등록할 수 있습니다."
          : /unavailable|deadline-exceeded|internal|aborted/.test(code)
            ? "등록 결과를 확인하지 못했습니다. 같은 내용으로 다시 등록을 눌러 주세요. 중복 등록은 방지됩니다."
            : caught instanceof Error
              ? caught.message
              : "배너를 등록하지 못했습니다. 잠시 후 다시 시도해 주세요.",
      );
    } finally {
      inFlight.current = false;
      if (mounted.current) setSaving(false);
    }
  };

  return (
    <ModalSurface
      open
      title="학교 배너 등록"
      onClose={onClose}
      dismissible={!saving}
      initialFocusRef={titleRef}
      footer={
        <>
          <button
            type="button"
            className="min-h-11 rounded-lg border border-gray-200 px-4 font-bold text-gray-700 disabled:opacity-60"
            onClick={onClose}
            disabled={saving}
          >
            취소
          </button>
          <button
            type="submit"
            form="school-banner-form"
            className="min-h-11 rounded-lg bg-blue-600 px-4 font-bold text-white hover:bg-blue-700 disabled:opacity-60"
            disabled={saving || preparing || !image}
          >
            {saving ? "등록 중…" : "등록"}
          </button>
        </>
      }
    >
      <form
        id="school-banner-form"
        onSubmit={save}
        className="space-y-4"
        aria-busy={saving || preparing}
      >
        <p className="text-sm text-gray-600">
          {semesterId.replace("-", "학년도 ")}학기 학교 배너에 바로 게시됩니다.
        </p>
        <div>
          <label
            htmlFor="school-banner-title"
            className="mb-2 block font-bold text-gray-800"
          >
            배너 제목
          </label>
          <input
            ref={titleRef}
            id="school-banner-title"
            className="min-h-11 w-full rounded-lg border border-gray-200 p-3 focus:ring-2 focus:ring-blue-500"
            maxLength={120}
            required
            disabled={saving}
            value={title}
            onChange={(event) => {
              setTitle(event.target.value);
              requestId.current = crypto.randomUUID();
            }}
          />
        </div>
        <div>
          <label
            htmlFor="school-banner-image"
            className="mb-2 block font-bold text-gray-800"
          >
            배너 이미지
          </label>
          <input
            id="school-banner-image"
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="min-h-11 w-full min-w-0 rounded-lg border border-gray-200 p-2 text-sm"
            disabled={saving}
            aria-describedby="school-banner-help"
            onChange={(event) => {
              const file = event.target.files?.[0];
              void selectFile(file);
            }}
          />
          <p id="school-banner-help" className="mt-2 text-sm text-gray-600">
            JPG·PNG·WebP, 최대 10MB. 권장 크기는 1200 × 675px이며, 가운데를
            기준으로 16:9 비율로 맞추고 압축합니다.
          </p>
        </div>
        {preparing && (
          <p role="status" className="text-sm text-blue-700">
            이미지를 준비하는 중입니다.
          </p>
        )}
        {preview && (
          <div className="overflow-hidden rounded-lg border border-gray-200">
            <img
              src={preview}
              alt={title.trim() || "배너 미리보기"}
              className="aspect-video h-auto w-full object-contain"
            />
          </div>
        )}
        {error && (
          <p
            role="alert"
            className="rounded-lg bg-red-50 p-3 text-sm text-red-700"
          >
            {error}
          </p>
        )}
        {saving && (
          <p role="status" className="text-sm text-blue-700">
            이미지와 배너 정보를 저장하고 있습니다.
          </p>
        )}
      </form>
    </ModalSurface>
  );
};

export default SchoolBannerModal;
