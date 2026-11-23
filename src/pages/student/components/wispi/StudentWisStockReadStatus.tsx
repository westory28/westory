import { useEffect, useState } from "react";
import { InlineLoading } from "../../../../components/common/LoadingState";

/** The timer changes presentation only; reads and bounded recovery belong to the client. */
export default function StudentWisStockReadStatus({
  loading,
  error = "",
  label,
  retry,
}: {
  loading: boolean;
  error?: string;
  label: string;
  retry?: () => void;
}) {
  const [delayed, setDelayed] = useState(false);
  useEffect(() => {
    setDelayed(false);
    if (!loading) return;
    const timer = window.setTimeout(() => setDelayed(true), 800);
    return () => window.clearTimeout(timer);
  }, [loading]);
  if (loading)
    return (
      <div className="student-wispi-read-status" aria-busy="true">
        {delayed ? (
          <InlineLoading />
        ) : (
          <p role="status">{label} 확인 중입니다.</p>
        )}
      </div>
    );
  if (!error) return null;
  return (
    <div
      role={
        /로그인|권한|접근|학기|공개|종료|할 수 없|다시 열어/.test(error)
          ? "alert"
          : "status"
      }
      className="student-wispi-read-status"
    >
      <p>
        {/로그인|권한|접근|학기|공개|종료|할 수 없|다시 열어/.test(error)
          ? error
          : `${label} 연결을 다시 확인해 주세요.`}
      </p>
      {retry && (
        <button type="button" onClick={retry}>
          다시 연결
        </button>
      )}
    </div>
  );
}
