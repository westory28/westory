import React, { useEffect, useRef } from "react";
import {
  drawProductWatermark,
  prepareProductWatermarkFont,
} from "../../../../lib/pointProductWatermark";

const ProductImageWatermark: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let cancelled = false;
    void prepareProductWatermarkFont().then(() => {
      if (cancelled) return;
      const canvas = canvasRef.current;
      const context = canvas?.getContext("2d");
      if (!canvas || !context) return;
      context.clearRect(0, 0, canvas.width, canvas.height);
      drawProductWatermark(context, canvas.width, canvas.height);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return (
    <canvas
      ref={canvasRef}
      width={1200}
      height={1200}
      className="wis-product-watermark"
      role="img"
      aria-label="우측 하단 Westory 워터마크"
    />
  );
};

export default ProductImageWatermark;
