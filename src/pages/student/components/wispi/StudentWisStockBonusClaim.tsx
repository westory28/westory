import { useEffect, useId, useRef, useState } from "react";
import InfoHelp from "../../../../components/common/InfoHelp";
import { useAppToast } from "../../../../components/common/AppToastProvider";
import {
  claimStudentWisStockBonus,
  getStudentWisStockBonus,
  studentWisStockError,
} from "../../../../lib/studentWisStockClient";
import type {
  StudentWisStockBonus,
  WisStockScope,
} from "../../../../lib/studentWisStockTypes";

type BonusLoad = {
  key: string;
  data: StudentWisStockBonus | null;
  error: string;
};
const awakeNow = () =>
  document.visibilityState !== "hidden" && navigator.onLine !== false;

export default function StudentWisStockBonusClaim({
  scope,
  identity,
  revision,
  refreshToken,
  tradingEnabled,
  disabled,
  onBusyChange,
}: {
  scope: WisStockScope;
  identity: string;
  revision: number;
  refreshToken: number;
  tradingEnabled: boolean;
  disabled: boolean;
  onBusyChange: (busy: boolean) => void;
}) {
  const { showToast } = useAppToast();
  const descriptionId = useId();
  const key = `${identity}:${revision}:${refreshToken}`;
  const identityRef = useRef(identity);
  identityRef.current = identity;
  const alive = useRef(true);
  const claimingRef = useRef(false);
  const [claiming, setClaiming] = useState(false);
  const [awake, setAwake] = useState(awakeNow);
  const [retry, setRetry] = useState(0);
  const [load, setLoad] = useState<BonusLoad | null>(null);
  const cached = useRef<BonusLoad | null>(null);
  const [feedback, setFeedback] = useState<{
    identity: string;
    text: string;
  } | null>(null);
  useEffect(() => {
    alive.current = true;
    const update = () => {
      cached.current = null;
      setAwake(awakeNow());
    };
    document.addEventListener("visibilitychange", update);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      alive.current = false;
      onBusyChange(false);
      document.removeEventListener("visibilitychange", update);
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, [onBusyChange]);
  useEffect(() => {
    claimingRef.current = false;
    setClaiming(false);
    onBusyChange(false);
    setFeedback(null);
  }, [identity, onBusyChange]);
  useEffect(() => {
    let live = true;
    if (!awake) {
      setLoad(null);
      return;
    }
    if (claiming || disabled) return;
    if (cached.current?.key === key) {
      setLoad(cached.current);
      return;
    }
    setLoad(null);
    void getStudentWisStockBonus(scope).then(
      (data) => {
        if (!live || !awakeNow() || identityRef.current !== identity) return;
        cached.current = { key, data, error: "" };
        setLoad(cached.current);
      },
      (error) => {
        if (live && awakeNow() && identityRef.current === identity)
          setLoad({ key, data: null, error: studentWisStockError(error) });
      },
    );
    return () => {
      live = false;
    };
  }, [key, awake, claiming, disabled, retry]);
  const current = load?.key === key ? load : null;
  const bonus = current?.data;
  const claim = async () => {
    if (
      claimingRef.current ||
      disabled ||
      !tradingEnabled ||
      !awakeNow() ||
      bonus?.status !== "ELIGIBLE"
    )
      return;
    claimingRef.current = true;
    setClaiming(true);
    onBusyChange(true);
    setFeedback(null);
    try {
      const result = await claimStudentWisStockBonus(scope);
      if (!alive.current || identityRef.current !== identity || !awakeNow())
        return;
      cached.current = {
        key: `${identity}:${result.state.account.revision}:${refreshToken}`,
        data: result.depositBonus!,
        error: "",
      };
      setLoad(cached.current);
      showToast({
        tone: result.changed ? "reward" : "info",
        title: result.changed
          ? `${result.depositBonus!.amount.toLocaleString("ko-KR")}위스를 주식 지갑에 받았습니다.`
          : "이미 지원금을 받았습니다.",
      });
    } catch (error) {
      if (alive.current && identityRef.current === identity && awakeNow()) {
        setFeedback({
          identity,
          text: studentWisStockError(error),
        });
        const reason = (error as { details?: { reason?: string } }).details
          ?.reason;
        if (
          reason === "WIS_STOCK_CAMPAIGN_DISABLED" ||
          reason === "WIS_STOCK_CAMPAIGN_INELIGIBLE"
        ) {
          cached.current = null;
          setRetry((value) => value + 1);
        }
      }
    } finally {
      if (alive.current && identityRef.current === identity) {
        claimingRef.current = false;
        setClaiming(false);
        onBusyChange(false);
      }
    }
  };
  if (bonus?.status === "DISABLED") return null;
  return (
    <section className="student-wispi-bonus" aria-label="위스피 지원금">
      <div className="student-wispi-inline">
        <div className="student-wispi-bonus-label">
          <strong>위스피 지원금</strong>
          <InfoHelp label="위스피 지원금 기준">
            <p>
              주식 지갑에 누적 500위스를 입금한 뒤 지원금을 한 번 받을 수
              있습니다. 지원금 원금은 위스피 매수에만 사용할 수 있으며,
              지원금으로 얻은 수익은 손실을 만회한 뒤 출금할 수 있습니다.
            </p>
          </InfoHelp>
        </div>
        {current?.error ? (
          <button type="button" onClick={() => setRetry((value) => value + 1)}>
            지원금 다시 확인
          </button>
        ) : (
          <button
            className={
              bonus?.status === "ELIGIBLE" ? "student-wispi-primary" : ""
            }
            type="button"
            disabled={
              claiming ||
              disabled ||
              !awake ||
              !tradingEnabled ||
              bonus?.status !== "ELIGIBLE"
            }
            aria-describedby={
              bonus?.status === "INELIGIBLE" ? descriptionId : undefined
            }
            onClick={() => void claim()}
          >
            {claiming
              ? "받는 중"
              : bonus?.status === "CLAIMED"
                ? "받기 완료"
                : bonus
                  ? `${bonus.amount.toLocaleString("ko-KR")}위스 받기`
                  : "지원금 확인 중"}
          </button>
        )}
      </div>
      {bonus?.status === "INELIGIBLE" && (
        <p id={descriptionId} className="student-wispi-muted">
          누적 입금 {bonus.qualifyingDepositAmount.toLocaleString("ko-KR")} /{" "}
          {bonus.threshold.toLocaleString("ko-KR")} 위스
        </p>
      )}
      {current?.error && (
        <p role="alert" className="student-wispi-error">
          {current.error}
        </p>
      )}
      {feedback?.identity === identity && (
        <p role="alert" className="student-wispi-error">
          {feedback.text}
        </p>
      )}
    </section>
  );
}
