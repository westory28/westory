import { useEffect, useRef, useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/TextLayer.css";

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url,
).toString();

export default function WisStockReportPdf({ file }: { file: Blob }) {
  const container = useRef<HTMLDivElement>(null);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const node = container.current;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) =>
      setWidth(Math.min(900, Math.floor(entry.contentRect.width))),
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return (
    <div ref={container} className="wis-report__pdf">
      {total > 1 && (
        <nav aria-label="보고서 PDF 페이지" className="wis-stocks__actions">
          <button
            type="button"
            disabled={page === 1}
            onClick={() => setPage(page - 1)}
          >
            이전 쪽
          </button>
          <span>
            {page} / {total}쪽
          </span>
          <button
            type="button"
            disabled={page === total}
            onClick={() => setPage(page + 1)}
          >
            다음 쪽
          </button>
        </nav>
      )}
      <Document
        file={file}
        loading="PDF를 여는 중입니다."
        error="PDF를 표시하지 못했습니다. 원본 파일을 확인해 주세요."
        onPassword={(_callback) => setTotal(-1)}
        onLoadSuccess={({ numPages }) => setTotal(numPages)}
      >
        {width > 0 && total > 0 && (
          <Page pageNumber={page} width={width} renderAnnotationLayer={false} />
        )}
      </Document>
      {total === -1 && (
        <p role="alert">
          암호가 설정된 PDF입니다. 원본을 다운로드해 열어 주세요.
        </p>
      )}
    </div>
  );
}
