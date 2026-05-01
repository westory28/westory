import React, { useEffect, useState } from "react";
import {
  collection,
  deleteDoc,
  doc,
  serverTimestamp,
  setDoc,
} from "firebase/firestore";
import { useAppToast } from "../../../components/common/AppToastProvider";
import { useAuth } from "../../../contexts/AuthContext";
import { db } from "../../../lib/firebase";
import { uploadNoticeImage, tryDeleteNoticeImage } from "../../../lib/noticeImages";

interface NoticeModalProps {
  isOpen: boolean;
  onClose: () => void;
  noticeData?: any;
  onSave: () => void;
}

const NOTICE_CATEGORIES = [
  { val: "normal", label: "공지" },
  { val: "event", label: "학교 행사" },
  { val: "exam", label: "정기 시험" },
  { val: "performance", label: "수행평가" },
  { val: "prep", label: "준비" },
  { val: "dday", label: "D-Day" },
] as const;

const NoticeModal: React.FC<NoticeModalProps> = ({
  isOpen,
  onClose,
  noticeData,
  onSave,
}) => {
  const { config } = useAuth();
  const { showToast } = useAppToast();
  const [category, setCategory] = useState("event");
  const [targetType, setTargetType] = useState("common");
  const [targetGrade, setTargetGrade] = useState("1");
  const [targetClass, setTargetClass] = useState("1");
  const [targetDate, setTargetDate] = useState("");
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!isOpen) return;

    if (noticeData) {
      setCategory(noticeData.category || "event");
      setTargetType(noticeData.targetType || "common");
      const [grade, className] = (noticeData.targetClass || "1-1").split("-");
      setTargetGrade(grade || "1");
      setTargetClass(className || "1");
      setTargetDate(noticeData.targetDate || "");
      setPreviewUrl(noticeData.imageUrl || "");
      setImageFile(null);
      return;
    }

    setCategory("event");
    setTargetType("common");
    setTargetGrade("1");
    setTargetClass("1");
    setTargetDate("");
    setPreviewUrl("");
    setImageFile(null);
  }, [isOpen, noticeData]);

  useEffect(() => {
    if (!imageFile) return undefined;
    const objectUrl = URL.createObjectURL(imageFile);
    setPreviewUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [imageFile]);

  if (!isOpen) return null;

  const handleSave = async () => {
    if (!config) return;
    if (!imageFile && !noticeData?.imageUrl) {
      showToast({
        tone: "warning",
        title: "알림장 이미지를 선택해 주세요.",
        message: "학생에게 표시할 압축 이미지가 필요합니다.",
      });
      return;
    }
    setLoading(true);

    try {
      const path = `years/${config.year}/semesters/${config.semester}/notices`;
      const docRef = noticeData ? doc(db, path, noticeData.id) : doc(collection(db, path));
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
        content: "",
        targetType,
        targetClass: targetType === "class" ? `${targetGrade}-${targetClass}` : null,
        targetDate: category === "dday" && targetDate ? targetDate : null,
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
      onSave();
      showToast({
        tone: "success",
        title: noticeData ? "알림장 이미지가 수정되었습니다." : "알림장 이미지가 게시되었습니다.",
        message: "학생 화면에는 압축된 이미지로 표시됩니다.",
      });
      onClose();
    } catch (error) {
      console.error("Error saving notice:", error);
      showToast({
        tone: "error",
        title: "알림장 저장에 실패했습니다.",
        message: error instanceof Error ? error.message : "잠시 후 다시 시도해 주세요.",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!noticeData || !config || !confirm("이 알림장 이미지를 삭제하시겠습니까?")) return;
    setLoading(true);
    try {
      const path = `years/${config.year}/semesters/${config.semester}/notices`;
      await deleteDoc(doc(db, path, noticeData.id));
      void tryDeleteNoticeImage(noticeData.imageStoragePath);
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
      setLoading(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-2xl overflow-hidden rounded-xl bg-white shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-gray-100 px-6 py-5">
          <h3 className="text-xl font-extrabold text-gray-900">
            <i className="fas fa-image mr-2 text-blue-600"></i>
            {noticeData ? "알림장 이미지 수정" : "알림장 이미지 등록"}
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-9 w-9 items-center justify-center rounded-full text-gray-400 hover:bg-gray-50 hover:text-gray-700"
            aria-label="닫기"
          >
            <i className="fas fa-times"></i>
          </button>
        </div>

        <div className="grid gap-5 px-6 py-5 md:grid-cols-[minmax(0,1fr)_220px]">
          <div className="space-y-4">
            <label className="block">
              <span className="mb-2 block text-sm font-extrabold text-gray-800">
                알림장 이미지
              </span>
              <input
                type="file"
                accept="image/*"
                onChange={(event) => setImageFile(event.target.files?.[0] || null)}
                className="block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-semibold text-gray-700 file:mr-3 file:rounded-md file:border-0 file:bg-blue-50 file:px-3 file:py-2 file:text-sm file:font-extrabold file:text-blue-700"
              />
              <p className="mt-2 text-xs font-semibold text-gray-500">
                권장 크기: 1200 x 800px (3:2). 최소 900 x 600px 이상이면 선명하게 보입니다.
              </p>
              <p className="mt-1 text-xs font-semibold text-gray-500">
                16:9, 세로형, 정사각형 이미지는 잘리지 않지만 위아래 또는 좌우 여백이 생길 수 있습니다.
              </p>
              <p className="mt-1 text-xs font-semibold text-gray-500">
                업로드 시 WebP로 변환하고 선명도를 우선해 약 460KB 목표, 최대 680KB 이하로 압축합니다.
              </p>
            </label>

            <div className="overflow-hidden rounded-xl border border-gray-200 bg-gray-50">
              {previewUrl ? (
                <img
                  src={previewUrl}
                  alt="알림장 미리보기"
                  className="aspect-[3/2] w-full object-contain"
                />
              ) : (
                <div className="flex aspect-[3/2] items-center justify-center text-sm font-bold text-gray-400">
                  이미지를 선택해 주세요.
                </div>
              )}
            </div>
          </div>

          <div className="space-y-4">
            <div>
              <span className="mb-2 block text-sm font-extrabold text-gray-800">
                분류
              </span>
              <div className="grid grid-cols-2 gap-2">
                {NOTICE_CATEGORIES.map((option) => (
                  <label key={option.val} className="cursor-pointer">
                    <input
                      type="radio"
                      name="noticeCategory"
                      value={option.val}
                      checked={category === option.val}
                      onChange={(event) => setCategory(event.target.value)}
                      className="peer sr-only"
                    />
                    <div className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-center text-xs font-extrabold text-gray-700 transition peer-checked:border-blue-500 peer-checked:bg-blue-50 peer-checked:text-blue-700">
                      {option.label}
                    </div>
                  </label>
                ))}
              </div>
            </div>

            {category === "dday" && (
              <label className="block">
                <span className="mb-1 block text-xs font-extrabold text-gray-700">
                  목표 날짜
                </span>
                <input
                  type="date"
                  value={targetDate}
                  onChange={(event) => setTargetDate(event.target.value)}
                  className="h-10 w-full rounded-lg border border-gray-300 px-3 text-sm font-bold outline-none focus:border-blue-500"
                />
              </label>
            )}

            <div>
              <span className="mb-2 block text-sm font-extrabold text-gray-800">
                대상
              </span>
              <div className="space-y-2">
                <label className="flex cursor-pointer items-center gap-2 text-sm font-bold text-gray-800">
                  <input
                    type="radio"
                    name="targetType"
                    value="common"
                    checked={targetType === "common"}
                    onChange={() => setTargetType("common")}
                    className="text-blue-600"
                  />
                  전체 공통
                </label>
                <label className="flex cursor-pointer items-center gap-2 text-sm font-bold text-gray-800">
                  <input
                    type="radio"
                    name="targetType"
                    value="class"
                    checked={targetType === "class"}
                    onChange={() => setTargetType("class")}
                    className="text-blue-600"
                  />
                  반 선택
                </label>
              </div>

              {targetType === "class" && (
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <select
                    value={targetGrade}
                    onChange={(event) => setTargetGrade(event.target.value)}
                    className="h-10 rounded-lg border border-gray-300 bg-white text-center text-sm font-bold outline-none"
                  >
                    {[1, 2, 3].map((grade) => (
                      <option key={grade} value={grade}>
                        {grade}학년
                      </option>
                    ))}
                  </select>
                  <select
                    value={targetClass}
                    onChange={(event) => setTargetClass(event.target.value)}
                    className="h-10 rounded-lg border border-gray-300 bg-white text-center text-sm font-bold outline-none"
                  >
                    {Array.from({ length: 12 }, (_, index) => index + 1).map(
                      (className) => (
                        <option key={className} value={className}>
                          {className}반
                        </option>
                      ),
                    )}
                  </select>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between border-t border-gray-100 px-6 py-4">
          <div>
            {noticeData && (
              <button
                type="button"
                onClick={handleDelete}
                disabled={loading}
                className="rounded-lg px-3 py-2 text-sm font-extrabold text-red-600 hover:bg-red-50 disabled:opacity-50"
              >
                삭제
              </button>
            )}
          </div>
          <button
            type="button"
            onClick={handleSave}
            disabled={loading}
            className="rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-extrabold text-white shadow-md transition hover:bg-blue-700 disabled:opacity-50"
          >
            {loading ? "저장 중..." : noticeData ? "수정 저장" : "게시하기"}
          </button>
        </div>
      </div>
    </div>
  );
};

export default NoticeModal;
