import { quoteNumber, signedQuote } from "./wisStockQuote";

export const direction = (change: number) =>
  change > 0 ? "up" : change < 0 ? "down" : "flat";

export function Movement({
  price,
  previous,
  digits = 0,
}: {
  price: number;
  previous: number | null;
  digits?: number;
}) {
  if (previous === null) return <span className="wis-exchange__muted">—</span>;
  const change = price - previous;
  const icon = change > 0 ? "▲" : change < 0 ? "▼" : "―";
  return (
    <span className={"wis-exchange__movement is-" + direction(change)}>
      <span>
        <span aria-hidden="true">{icon} </span>
        <span className="sr-only">
          {change > 0 ? "상승 " : change < 0 ? "하락 " : "보합 "}
        </span>
        {quoteNumber(Math.abs(change), digits)}
      </span>
      <small>({signedQuote((change / previous) * 100, 2)}%)</small>
    </span>
  );
}
