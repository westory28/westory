import { lazy, Suspense, useMemo } from "react";
import type { ReportUpload } from "../../../../lib/wisStockWeeklyReports";

const ReportPdf = lazy(() => import("./WisStockReportPdf"));

export function downloadReportFile(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function MarkdownText({ text }: { text: string }) {
  // Render report headings, lists and tables as text-only React elements.
  const blocks = text.split(/\r?\n\s*\n/);
  return (
    <div className="wis-report__text">
      {blocks.map((block, index) => {
        const lines = block.trim().split(/\r?\n/);
        if (
          lines.length > 1 &&
          /^\|?\s*:?-{3,}/.test(lines[1]) &&
          lines[0].includes("|")
        ) {
          const cells = (line: string) =>
            line
              .replace(/^\||\|$/g, "")
              .split("|")
              .map((cell) => cell.trim());
          return (
            <div className="wis-report__table" key={index}>
              <table>
                <thead>
                  <tr>
                    {cells(lines[0]).map((cell, i) => (
                      <th key={i} scope="col">
                        {cell}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {lines.slice(2).map((row, i) => (
                    <tr key={i}>
                      {cells(row).map((cell, j) => (
                        <td key={j}>{cell}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        }
        if (lines.every((line) => /^[-*]\s/.test(line)))
          return (
            <ul key={index}>
              {lines.map((line, i) => (
                <li key={i}>{line.slice(2)}</li>
              ))}
            </ul>
          );
        const heading = /^#{1,6}\s+(.+)$/.exec(lines[0]);
        return (
          <div key={index}>
            {heading && <h4>{heading[1]}</h4>}
            <p>{(heading ? lines.slice(1) : lines).join("\n")}</p>
          </div>
        );
      })}
    </div>
  );
}

export default function WisStockReportDocument({
  file,
}: {
  file: ReportUpload;
}) {
  const document = useMemo(() => {
    const bytes = Uint8Array.from(atob(file.contentBase64), (char) =>
      char.charCodeAt(0),
    );
    const pdf = /\.pdf$/i.test(file.fileName);
    return {
      blob: new Blob([bytes], {
        type: pdf ? "application/pdf" : "text/plain;charset=utf-8",
      }),
      text: pdf ? null : new TextDecoder().decode(bytes),
    };
  }, [file.contentBase64, file.fileName]);
  return (
    <div className="wis-report__document">
      <div className="wis-report__filename">
        <span>{file.fileName}</span>
        <button
          type="button"
          onClick={() => downloadReportFile(document.blob, file.fileName)}
        >
          원본 다운로드
        </button>
      </div>
      {document.text === null ? (
        <Suspense fallback={<p>PDF를 여는 중입니다.</p>}>
          <ReportPdf file={document.blob} />
        </Suspense>
      ) : /\.md$/i.test(file.fileName) && document.text.length < 128_000 ? (
        <MarkdownText text={document.text} />
      ) : (
        <pre className="wis-report__text">{document.text}</pre>
      )}
    </div>
  );
}
