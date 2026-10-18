import React, { useEffect, useRef, useState } from "react";
import InfoHelp from "../../../../components/common/InfoHelp";
import {
  cropProductImage,
  getProductCropRect,
  type ProductImageCrop,
} from "../../../../lib/pointProductCrop";

interface Props {
  file: File;
  initialCrop?: ProductImageCrop;
  onApply: (file: File, crop: ProductImageCrop) => void;
  onCancel: () => void;
}

const CENTER: ProductImageCrop = { zoom: 1, x: 0.5, y: 0.5 };
const clamp = (value: number) => Math.max(0, Math.min(1, value));

const ProductImageCropper: React.FC<Props> = ({
  file,
  initialCrop,
  onApply,
  onCancel,
}) => {
  const [crop, setCrop] = useState(initialCrop || CENTER);
  const [image, setImage] = useState<{
    url: string;
    width: number;
    height: number;
  } | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const generation = useRef(0);
  const stage = useRef<HTMLDivElement>(null);
  const drag = useRef<{
    pointerId: number;
    x: number;
    y: number;
    width: number;
    crop: ProductImageCrop;
  } | null>(null);

  useEffect(() => {
    generation.current += 1;
    const current = generation.current;
    setImage(null);
    setError("");
    setBusy(false);
    setCrop(initialCrop || CENTER);
    if (!file.type.startsWith("image/") || file.size > 20 * 1024 * 1024) {
      setError("20MB 이하의 이미지 파일을 선택해 주세요.");
      return;
    }
    const url = URL.createObjectURL(file);
    const decoded = new Image();
    decoded.onload = () => {
      if (generation.current !== current) return;
      if (
        !decoded.naturalWidth ||
        !decoded.naturalHeight ||
        decoded.naturalWidth * decoded.naturalHeight > 40_000_000
      ) {
        setError("이미지 해상도를 4천만 화소 이하로 줄여 주세요.");
        return;
      }
      setImage({
        url,
        width: decoded.naturalWidth,
        height: decoded.naturalHeight,
      });
      stage.current?.focus();
    };
    decoded.onerror = () => {
      if (generation.current === current)
        setError("사진을 읽지 못했습니다. 다른 이미지 파일을 선택해 주세요.");
    };
    decoded.src = url;
    return () => {
      generation.current += 1;
      decoded.onload = null;
      decoded.onerror = null;
      URL.revokeObjectURL(url);
      drag.current = null;
    };
  }, [file, initialCrop]);

  const rect = image
    ? getProductCropRect(image.width, image.height, crop)
    : null;
  const apply = async () => {
    if (busy || !image) return;
    const current = generation.current;
    setBusy(true);
    setError("");
    try {
      const result = await cropProductImage(file, crop);
      if (generation.current === current) onApply(result, crop);
    } catch (cause) {
      if (generation.current === current)
        setError(
          cause instanceof Error
            ? cause.message
            : "사진을 자르지 못했습니다. 다시 시도해 주세요.",
        );
    } finally {
      if (generation.current === current) setBusy(false);
    }
  };

  return (
    <div
      className="wis-product-crop"
      aria-busy={busy}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          onCancel();
        }
      }}
    >
      <div className="wis-product-crop__title">
        <strong>사진 자르기 · 1:1</strong>
        <InfoHelp
          label="사진 자르기"
          sections={[
            {
              rows: [
                {
                  label: "위치",
                  content:
                    "사진을 끌거나 방향키, 아래 위치 조절 막대로 움직일 수 있습니다.",
                },
                {
                  label: "배경",
                  content:
                    "투명한 부분은 흰색으로 표시됩니다. 적용한 모습 그대로 상점에 표시됩니다.",
                },
              ],
            },
          ]}
        />
      </div>
      <div
        ref={stage}
        className="wis-product-crop__stage"
        role="group"
        aria-label="상품 사진 위치 조절"
        tabIndex={0}
        onKeyDown={(event) => {
          if (
            !image ||
            busy ||
            !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(
              event.key,
            )
          )
            return;
          event.preventDefault();
          const step = event.shiftKey ? 0.1 : 0.01;
          setCrop((previous) => ({
            ...previous,
            x: clamp(
              previous.x +
                (event.key === "ArrowLeft"
                  ? step
                  : event.key === "ArrowRight"
                    ? -step
                    : 0),
            ),
            y: clamp(
              previous.y +
                (event.key === "ArrowUp"
                  ? step
                  : event.key === "ArrowDown"
                    ? -step
                    : 0),
            ),
          }));
        }}
        onPointerDown={(event) => {
          if (!image || busy || event.button !== 0) return;
          event.currentTarget.focus();
          event.currentTarget.setPointerCapture(event.pointerId);
          drag.current = {
            pointerId: event.pointerId,
            x: event.clientX,
            y: event.clientY,
            width: event.currentTarget.clientWidth,
            crop,
          };
        }}
        onPointerMove={(event) => {
          const start = drag.current;
          if (
            !image ||
            busy ||
            !start ||
            start.pointerId !== event.pointerId ||
            !start.width
          )
            return;
          const startRect = getProductCropRect(
            image.width,
            image.height,
            start.crop,
          );
          setCrop({
            ...start.crop,
            x:
              image.width > startRect.size
                ? clamp(
                    start.crop.x -
                      ((event.clientX - start.x) * startRect.size) /
                        (start.width * (image.width - startRect.size)),
                  )
                : 0.5,
            y:
              image.height > startRect.size
                ? clamp(
                    start.crop.y -
                      ((event.clientY - start.y) * startRect.size) /
                        (start.width * (image.height - startRect.size)),
                  )
                : 0.5,
          });
        }}
        onPointerUp={() => {
          drag.current = null;
        }}
        onPointerCancel={() => {
          drag.current = null;
        }}
        onLostPointerCapture={() => {
          drag.current = null;
        }}
      >
        {image && rect ? (
          <>
            <img
              src={image.url}
              alt="상점에 표시될 사진"
              draggable={false}
              style={{
                width: `${(image.width / rect.size) * 100}%`,
                height: `${(image.height / rect.size) * 100}%`,
                left: `${(-rect.x / rect.size) * 100}%`,
                top: `${(-rect.y / rect.size) * 100}%`,
              }}
            />
            <span className="wis-product-crop__guides" aria-hidden="true" />
          </>
        ) : (
          <span>{error ? "사진을 확인해 주세요." : "사진을 불러오는 중…"}</span>
        )}
      </div>
      {rect && (
        <small>
          저장 크기 {Math.floor(Math.min(rect.size, 1200))} ×{" "}
          {Math.floor(Math.min(rect.size, 1200))}px
        </small>
      )}
      <fieldset
        disabled={!image || busy}
        className="wis-product-crop__controls"
      >
        {(
          [
            ["zoom", "확대", 1, 3, 0.05],
            ["x", "가로 위치", 0, 1, 0.01],
            ["y", "세로 위치", 0, 1, 0.01],
          ] as const
        ).map(([key, label, min, max, step]) => (
          <label key={key}>
            <span>
              {label}
              <output>{Math.round(crop[key] * 100)}%</output>
            </span>
            <input
              type="range"
              min={min}
              max={max}
              step={step}
              value={crop[key]}
              aria-label={label}
              disabled={
                key === "x"
                  ? image?.width === rect?.size
                  : key === "y"
                    ? image?.height === rect?.size
                    : false
              }
              onChange={(event) => {
                drag.current = null;
                setCrop((previous) => ({
                  ...previous,
                  [key]: Number(event.target.value),
                }));
              }}
            />
          </label>
        ))}
      </fieldset>
      {error && (
        <p className="wis-product-crop__error" role="alert">
          {error}
        </p>
      )}
      <div className="wis-product-crop__actions">
        <button
          type="button"
          className="teacher-wis-shop__button is-quiet"
          disabled={busy}
          onClick={() => setCrop(CENTER)}
        >
          초기화
        </button>
        <button
          type="button"
          className="teacher-wis-shop__button"
          onClick={onCancel}
        >
          취소
        </button>
        <button
          type="button"
          className="teacher-wis-shop__button is-primary"
          disabled={busy || !image}
          onClick={apply}
        >
          {busy ? "적용 중…" : "자르기 적용"}
        </button>
      </div>
    </div>
  );
};

export default ProductImageCropper;
