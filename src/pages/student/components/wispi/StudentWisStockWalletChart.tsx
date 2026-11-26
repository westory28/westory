import { useEffect, useState } from "react";
import {
  getStudentWisStockReturns,
  studentWisStockError,
} from "../../../../lib/studentWisStockClient";
import type {
  StudentWisStockReturns,
  WisStockScope,
} from "../../../../lib/studentWisStockTypes";
import StudentWisStockReadStatus from "./StudentWisStockReadStatus";
import ReturnChart, { dateTime, percent } from "./StudentWisStockReturnChart";
import { useWisStockVenue } from "./wisStockVenueContext";

export default function StudentWisStockWalletChart({
  scope: { year, semester },
  active,
}: {
  scope: WisStockScope;
  active: boolean;
}) {
  // The parent keys this view by session, semester, account and quote revision.
  const venue = useWisStockVenue();
  const [attempt, setAttempt] = useState(0);
  const [data, setData] = useState<StudentWisStockReturns | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    if (active && attempt === 0) setAttempt(1);
  }, [active, attempt]);
  useEffect(() => {
    if (!attempt) return;
    let current = true;
    setError("");
    void getStudentWisStockReturns({ year, semester }, venue).then(
      (result) => {
        if (current) setData(result);
      },
      (failure) => {
        if (current) setError(studentWisStockError(failure));
      },
    );
    return () => {
      current = false;
    };
  }, [year, semester, attempt, venue]);
  if (!active) return null;
  const latest = data?.points.at(-1)?.returnPercent;
  return (
    <section aria-label="내 수익률 그래프">
      <div className="student-wispi-inline">
        <h3>내 보유 수익률</h3>
        {latest != null && <strong>{percent(latest)}</strong>}
      </div>
      {data && (
        <p className="student-wispi-muted">
          최근 30일 · {dateTime.format(data.asOfMs)} 기준
        </p>
      )}
      <StudentWisStockReadStatus
        loading={!data && !error}
        error={error}
        label="수익률 그래프"
        retry={() => setAttempt((value) => value + 1)}
      />
      {data && (
        <ReturnChart
          series={[{ displayName: "내", points: data.points }]}
          showLegend={false}
        />
      )}
    </section>
  );
}
