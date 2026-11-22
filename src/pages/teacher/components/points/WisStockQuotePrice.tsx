import { memo, useState, type CSSProperties } from "react";
import { quoteNumber } from "./wisStockQuote";
import "./WisStockQuotePrice.css";

// Clockwise from the top bar, with the middle bar last.
const segments = {
  a: "M3 2 5 0h12l2 2-2.5 2.5h-11z",
  b: "M19.8 3l1.7 1.7v10.8l-2.2 2.2-2.3-2.3V5.8z",
  c: "M19.3 18.3l2.2 2.2v10.8L19.8 33 17 30.2v-9.6z",
  d: "M3 34l2.5-2.5h11L19 34l-2 2H5z",
  e: "M2.7 18.3 5 20.6v9.6L2.2 33 .5 31.3V20.5z",
  f: "M2.2 3 5 5.8v9.6l-2.3 2.3L.5 15.5V4.7z",
  g: "M3.5 18l2.3-2.1h10.4l2.3 2.1-2.3 2.1H5.8z",
};
const digitPaths = [
  "abcdef",
  "bc",
  "abdeg",
  "abcdg",
  "bcfg",
  "acdfg",
  "acdefg",
  "abc",
  "abcdefg",
  "abcdfg",
].map((bars) =>
  Array.from(bars, (bar) => segments[bar as keyof typeof segments]).join(" "),
);

function numberStrip(value: string) {
  let width = 0;
  const glyphs = Array.from(value, (character) => {
    const x = width;
    const narrow = character === ",";
    width += narrow ? 9 : 26;
    const path = narrow
      ? "M1 31h4v4l-3.5 5H0L2 35H1z"
      : character === "-"
        ? segments.g
        : digitPaths[Number(character)];
    return { x, path, digit: !narrow && character !== "-" };
  });
  return { width, glyphs };
}

function Face({
  strip,
  width,
}: {
  strip: ReturnType<typeof numberStrip>;
  width: number;
}) {
  return (
    <svg viewBox={`0 0 ${width} 46`} focusable="false" aria-hidden="true">
      <g transform={`translate(${width - strip.width - 3} 5)`}>
        {strip.glyphs.map(({ x, path, digit }) => (
          <g key={x} transform={`translate(${x})`} fill="currentColor">
            {digit && <path d={digitPaths[8]} opacity=".055" />}
            <path d={path} />
          </g>
        ))}
      </g>
    </svg>
  );
}

export type QuotePriceTransition = {
  from: number;
  to: number;
  id: number;
  delayMs: number;
};

export default memo(function WisStockQuotePrice({
  price,
  transition,
}: {
  price: number;
  transition?: QuotePriceTransition;
}) {
  const [finishedId, setFinishedId] = useState<number>();
  const value = quoteNumber(price);
  const current = numberStrip(value);
  const flip =
    transition?.to === price &&
    transition.from !== price &&
    transition.id !== finishedId
      ? transition
      : undefined;
  const previous = flip && numberStrip(quoteNumber(flip.from));
  const width = Math.max(current.width, previous?.width ?? 0) + 10;

  return (
    <span
      className="wis-quote-price"
      style={{ width: `${width / 36}em`, aspectRatio: `${width} / 46` }}
    >
      <span className="sr-only">현재가 {value}위스</span>
      <span className="wis-quote-price__face" aria-hidden="true">
        <Face strip={current} width={width} />
      </span>
      {flip && previous && (
        <span
          key={flip.id}
          className="wis-quote-price__transition"
          aria-hidden="true"
          style={{ "--quote-delay": `${flip.delayMs}ms` } as CSSProperties}
        >
          <span className="wis-quote-price__old-lower">
            <Face strip={previous} width={width} />
          </span>
          <span className="wis-quote-price__fold">
            <Face strip={previous} width={width} />
          </span>
          <span
            className="wis-quote-price__unfold"
            onAnimationEnd={() => setFinishedId(flip.id)}
          >
            <Face strip={current} width={width} />
          </span>
        </span>
      )}
    </span>
  );
});
