import type { PointWallet } from "../types";

const toSafeNumber = (value: unknown) => {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
};

const getPointTimestampDate = (value: unknown): Date | null => {
  if (!value || typeof value !== "object") return null;
  const rawSeconds =
    "seconds" in value
      ? value.seconds
      : "_seconds" in value
        ? value._seconds
        : undefined;
  if (
    !rawSeconds ||
    (typeof rawSeconds !== "number" &&
      (typeof rawSeconds !== "string" || !rawSeconds.trim()))
  )
    return null;
  const seconds = Number(rawSeconds);
  const rawNanoseconds =
    "nanoseconds" in value
      ? value.nanoseconds
      : "_nanoseconds" in value
        ? value._nanoseconds
        : 0;
  const nanoseconds = Number(rawNanoseconds ?? 0);
  if (
    !Number.isFinite(seconds) ||
    !Number.isFinite(nanoseconds) ||
    nanoseconds < 0 ||
    nanoseconds >= 1_000_000_000
  )
    return null;
  const date = new Date(seconds * 1000 + Math.floor(nanoseconds / 1_000_000));
  return Number.isFinite(date.getTime()) ? date : null;
};

export const formatPointDateTime = (value: unknown) =>
  getPointTimestampDate(value)?.toLocaleString("ko-KR") ?? "-";

export const formatPointDateShortTime = (value: unknown) =>
  getPointTimestampDate(value)?.toLocaleString("ko-KR", {
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }) ?? "-";

export const formatPointTimeOnly = (value: unknown) =>
  getPointTimestampDate(value)?.toLocaleTimeString("ko-KR", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }) ?? "-";

export const formatPointDateOnly = (value: unknown) =>
  getPointTimestampDate(value)?.toLocaleDateString("ko-KR") ?? "-";

export const formatWisAmount = (value: unknown) =>
  `${toSafeNumber(value).toLocaleString("ko-KR")} ₩s`;

export const formatWisDelta = (value: unknown) => {
  const numericValue = toSafeNumber(value);
  return `${numericValue >= 0 ? "+" : ""}${numericValue.toLocaleString("ko-KR")} ₩s`;
};

export const formatPointStudentLabel = (
  wallet: Pick<PointWallet, "grade" | "class" | "number">,
) =>
  [
    wallet.grade ? `${wallet.grade}\uD559\uB144` : "",
    wallet.class ? `${wallet.class}\uBC18` : "",
    wallet.number ? `${wallet.number}\uBC88` : "",
  ]
    .filter(Boolean)
    .join(" ");
