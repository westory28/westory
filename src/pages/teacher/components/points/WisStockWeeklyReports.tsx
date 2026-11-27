import { InlineLoading } from "../../../../components/common/LoadingState";
import { useEffect, useRef, useState } from "react";
import InfoHelp from "../../../../components/common/InfoHelp";
import {
  calendarDateKey,
  getKoreanDateKey,
  shiftCalendarDate,
} from "../../../../lib/calendarWeek";
import {
  listWeeklyReports,
  publishWeeklyReport,
  readReportUpload,
  readWeeklyReport,
  weeklyMarketData,
  type ReportScope,
  type ReportUpload,
  type WeeklyReport,
  type WeeklyReportSummary,
} from "../../../../lib/wisStockWeeklyReports";
import WisStockReportDocument, {
  downloadReportFile,
} from "./WisStockReportDocument";
import "./WisStockWeeklyReports.css";

const mondayOf = (date: string) =>
  shiftCalendarDate(
    date,
    -((new Date(date + "T00:00:00Z").getUTCDay() + 6) % 7),
  );
const message = (error: unknown) =>
  error instanceof Error
    ? error.message
    : "요청을 완료하지 못했습니다. 다시 시도해 주세요.";
const shortDate = (date: string) => date.slice(5).replace("-", ".");
const weekLabel = (date: string) =>
  `${date.slice(0, 4)}년 ${shortDate(date)} ~ ${shortDate(shiftCalendarDate(date, 6))}`;

function PublishedWeeks({
  scope,
  select,
}: {
  scope: ReportScope;
  select: (week: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<WeeklyReportSummary[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const live = useRef(false);
  const flight = useRef(false);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);
  const load = async (before?: string) => {
    if (flight.current) return;
    flight.current = true;
    setBusy(true);
    setError("");
    try {
      const page = await listWeeklyReports(scope, before);
      if (!live.current) return;
      setRows((previous) =>
        before ? [...previous, ...page.reports] : page.reports,
      );
      setCursor(page.nextBefore);
      setLoaded(true);
    } catch (cause) {
      if (live.current) setError(message(cause));
    } finally {
      flight.current = false;
      if (live.current) setBusy(false);
    }
  };
  return (
    <div className="wis-report__archive">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => {
          setOpen(!open);
          if (!open && !loaded) void load();
        }}
      >
        발행한 보고서 목록
      </button>
      {open && (
        <div>
          {rows.map((row) => (
            <button
              type="button"
              className="wis-report__archive-row"
              key={row.weekStart}
              onClick={() => select(row.weekStart)}
            >
              <span>{weekLabel(row.weekStart)}</span>
              <strong>{row.title}</strong>
            </button>
          ))}
          {loaded && !rows.length && <p>발행한 보고서가 없습니다.</p>}
          {busy && <InlineLoading />}
          {error && <p role="alert">{error}</p>}
          {(cursor || error) && (
            <button
              type="button"
              disabled={busy}
              onClick={() => void load(cursor ?? undefined)}
            >
              {error ? "목록 다시 조회" : "이전 발행본 더 보기"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function ReportEdition({
  scope,
  week,
  onPublished,
}: {
  scope: ReportScope;
  week: string;
  onPublished: () => void;
}) {
  const [report, setReport] = useState<WeeklyReport | null>(null);
  const [ready, setReady] = useState(false);
  const [reload, setReload] = useState(0);
  const [readError, setReadError] = useState("");
  const [file, setFile] = useState<ReportUpload | null>(null);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const life = useRef<AbortController | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const picked = useRef(0);
  const pending = useRef(false);
  const downloading = useRef(false);
  const { year, semester } = scope;
  useEffect(() => {
    const controller = new AbortController();
    life.current = controller;
    return () => {
      controller.abort();
    };
  }, []);
  useEffect(() => {
    let active = true;
    setReady(false);
    setReadError("");
    void readWeeklyReport({ year, semester }, week)
      .then((result) => {
        if (!active) return;
        setReport(result.report);
        setReady(true);
      })
      .catch((cause) => {
        if (active) setReadError(message(cause));
      });
    return () => {
      active = false;
    };
  }, [week, year, semester, reload]);

  const download = async () => {
    const signal = life.current?.signal;
    if (!signal || downloading.current) return;
    downloading.current = true;
    setExporting(true);
    setExportError("");
    try {
      const data = await weeklyMarketData(scope, week, signal);
      if (!signal.aborted)
        downloadReportFile(
          new Blob([JSON.stringify(data, null, 2)], {
            type: "application/json;charset=utf-8",
          }),
          `위스피_${week}_주간분석.json`,
        );
    } catch (cause) {
      if (!signal.aborted) setExportError(message(cause));
    } finally {
      downloading.current = false;
      if (!signal.aborted) setExporting(false);
    }
  };
  const pick = async (selected?: File) => {
    const sequence = ++picked.current;
    setFile(null);
    setNotice("");
    setError("");
    if (!selected) return;
    try {
      const upload = await readReportUpload(selected);
      if (life.current?.signal.aborted || sequence !== picked.current) return;
      setTitle(selected.name.replace(/\.[^.]+$/, "").slice(0, 100));
      setFile(upload);
    } catch (cause) {
      if (!life.current?.signal.aborted && sequence === picked.current)
        setError(message(cause));
    }
  };
  const publish = async () => {
    const signal = life.current?.signal;
    if (!signal || !ready || !file || !title.trim() || pending.current) return;
    pending.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const saved = await publishWeeklyReport(
        scope,
        week,
        title.trim(),
        file,
        report?.revision ?? 0,
        signal,
      );
      if (signal.aborted) return;
      setReport({ ...saved.report, contentBase64: file.contentBase64 });
      setFile(null);
      if (fileInput.current) fileInput.current.value = "";
      setNotice("교사용 보고서를 발행했습니다.");
      onPublished();
    } catch (cause) {
      if (!signal.aborted) {
        setError(message(cause));
        if ((cause as { code?: string })?.code === "functions/aborted") {
          setReady(false);
          setReadError("최신 발행본을 다시 조회해 주세요.");
        }
      }
    } finally {
      pending.current = false;
      if (!signal.aborted) setBusy(false);
    }
  };
  return (
    <>
      <section className="wis-report__data" aria-label="주간 분석 자료">
        <div>
          <div className="wis-report__label">
            <h3>주간 분석 자료</h3>
            <InfoHelp label="분석 자료 항목">
              <p>
                종목별 시세, 매수·매도 동향과 예정된 시장 일정을 JSON으로
                내려받습니다. 집계 기간과 자료가 남아 있는 범위는 파일에
                표시됩니다.
              </p>
            </InfoHelp>
          </div>
          <p>{weekLabel(week)} · 한국 시각</p>
        </div>
        <button
          type="button"
          onClick={() => void download()}
          disabled={exporting}
        >
          {exporting ? "자료 준비 중…" : "분석 자료 다운로드"}
        </button>
        {exportError && <p role="alert">{exportError}</p>}
      </section>
      <section className="wis-report__edition" aria-label="교사용 발행본">
        <div className="wis-report__label">
          <h3>{file ? "발행 전 미리보기" : "교사용 발행본"}</h3>
          <span>학생 비공개</span>
        </div>
        {!ready && !readError && <InlineLoading />}
        {readError && (
          <p role="alert">
            {readError}{" "}
            <button type="button" onClick={() => setReload((n) => n + 1)}>
              발행본 다시 조회
            </button>
          </p>
        )}
        {ready &&
          !file &&
          (report ? (
            <>
              <h4>{report.title}</h4>
              <WisStockReportDocument key={report.revision} file={report} />
            </>
          ) : (
            <p>이 주차에 발행한 보고서가 없습니다.</p>
          ))}
        {file && (
          <>
            <label className="wis-report__title">
              보고서 제목
              <input
                value={title}
                maxLength={100}
                disabled={busy}
                onChange={(event) => setTitle(event.target.value)}
              />
            </label>
            <WisStockReportDocument
              key={file.contentBase64.slice(-64) + picked.current}
              file={file}
            />
          </>
        )}
        <div className="wis-report__upload">
          <label>
            보고서 파일 <span>PDF · MD · TXT / 최대 3MB</span>
            <input
              ref={fileInput}
              type="file"
              accept=".pdf,.md,.txt"
              disabled={!ready || busy}
              onChange={(event) => void pick(event.target.files?.[0])}
            />
          </label>
          {file && (
            <div className="wis-stocks__actions">
              <button
                type="button"
                className="wis-report__publish"
                disabled={!ready || busy || !title.trim()}
                onClick={() => void publish()}
              >
                {busy ? "발행 중…" : report ? "발행본 교체" : "교사용으로 발행"}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  void pick();
                  if (fileInput.current) fileInput.current.value = "";
                }}
              >
                선택 취소
              </button>
            </div>
          )}
        </div>
        {error && <p role="alert">{error}</p>}
        {notice && <p role="status">{notice}</p>}
      </section>
    </>
  );
}

export default function WisStockWeeklyReports(scope: ReportScope) {
  const [week, setWeek] = useState(() => mondayOf(getKoreanDateKey()));
  const [version, setVersion] = useState(0);
  return (
    <section className="wis-report" aria-label="주식 보고서">
      <h2 className="sr-only">주식 보고서</h2>
      <div className="wis-report__toolbar">
        <label>
          보고서 주차
          <input
            type="date"
            aria-label="보고서 주차"
            value={week}
            onChange={(event) => {
              const date = calendarDateKey(event.target.value);
              if (/^20\d\d-/.test(date)) setWeek(mondayOf(date));
            }}
          />
        </label>
        <button
          type="button"
          onClick={() => setWeek(shiftCalendarDate(week, -7))}
        >
          이전 주
        </button>
        <button
          type="button"
          onClick={() => setWeek(shiftCalendarDate(week, 7))}
        >
          다음 주
        </button>
        <PublishedWeeks key={version} scope={scope} select={setWeek} />
      </div>
      <ReportEdition
        key={week}
        scope={scope}
        week={week}
        onPublished={() => setVersion((n) => n + 1)}
      />
    </section>
  );
}
