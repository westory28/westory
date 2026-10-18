import React, { useId } from "react";
import "./yut-character.css";

export type YutProfession = "sa" | "nong" | "gong" | "sang";
export type YutSpritePose = "idle" | "turn" | "throw" | "win" | "caught";
export const PROFESSIONS: Record<
  YutProfession,
  { color: string; clan: string; animal: string }
> = {
  sa: { color: "#7c9aa1", clan: "마가", animal: "말" },
  nong: { color: "#88a382", clan: "우가", animal: "소" },
  gong: { color: "#bc8068", clan: "저가", animal: "돼지" },
  sang: { color: "#c1a568", clan: "구가", animal: "개" },
};

/** Sleeve boundaries follow each animal's original folded robe, in one 627px atlas cell. */
const SLEEVES = {
  sa: {
    offset: [0, 0],
    headBottom: 250,
    left: "M266 243 277 280 276 363 282 377 262 412 243 492 221 482 196 442 188 411 201 369 196 349 205 317 228 278Z",
    right:
      "M399 249 429 259 463 297 478 323 487 355 484 396 476 439 446 489 425 499 404 460 388 416 372 381 385 372 392 324Z",
    pivots: [269, 255, 402, 258],
    front:
      "M298 240 382 240 391 284 388 376 376 405 413 580 250 580 277 408 276 284Z",
    seams: [260, 370, 250, 480],
  },
  nong: {
    offset: [-627, 0],
    headBottom: 242,
    left: "M205 230 245 254 261 280 273 360 282 375 260 417 225 500 198 500 165 463 145 425 140 380 143 335 163 285Z",
    right:
      "M376 248 402 272 426 309 442 344 446 378 434 426 412 471 394 487 380 471 365 429 354 390 354 376 370 365 377 315Z",
    pivots: [212, 239, 381, 259],
    front: "M249 265 372 265 378 402 403 580 232 580 253 403Z",
    seams: [245, 349, 245, 475],
  },
  gong: {
    offset: [0, -627],
    headBottom: 221,
    left: "M266 207 289 234 300 275 306 328 318 343 302 357 277 412 267 451 243 454 218 437 201 404 193 366 193 329 211 271 235 232Z",
    right:
      "M416 208 441 223 477 253 499 295 505 347 500 391 480 440 459 463 439 450 412 395 389 347 405 337 420 322 423 260Z",
    pivots: [270, 220, 420, 219],
    front: "M304 240 423 240 428 371 451 560 278 560 298 365 309 255Z",
    seams: [284, 386, 220, 445],
  },
  sang: {
    offset: [-627, -627],
    headBottom: 222,
    left: "M208 206 225 226 231 241 233 291 239 330 249 344 237 364 220 409 211 458 193 458 166 430 149 398 143 352 146 308 167 261Z",
    right:
      "M353 207 368 218 401 244 430 287 440 331 443 371 426 420 402 457 380 465 366 433 342 374 331 345 341 321 345 257Z",
    pivots: [212, 217, 355, 220],
    front: "M235 240 350 240 356 367 379 559 216 559 229 370 235 255Z",
    seams: [215, 328, 220, 445],
  },
} as const;

function WaitingSleeves({
  role,
  source,
}: {
  role: YutProfession;
  source: string;
}) {
  const id = `yut-sleeve-${useId().replace(/:/g, "")}`;
  const { offset, left, right, pivots, seams, front, headBottom } =
    SLEEVES[role];
  return (
    <svg
      className="yut-waiting-figure"
      viewBox="0 0 627 627"
      preserveAspectRatio="none"
      focusable="false"
    >
      <defs>
        <image
          id={`${id}-figure`}
          href={source}
          x={offset[0]}
          y={offset[1]}
          width="1254"
          height="1254"
        />
        <mask
          id={`${id}-left`}
          maskUnits="userSpaceOnUse"
          x="0"
          y="0"
          width="627"
          height="627"
        >
          <path
            d={left}
            fill="white"
            stroke="white"
            strokeWidth="14"
            strokeLinejoin="round"
          />
        </mask>
        <mask
          id={`${id}-right`}
          maskUnits="userSpaceOnUse"
          x="0"
          y="0"
          width="627"
          height="627"
        >
          <path
            d={right}
            fill="white"
            stroke="white"
            strokeWidth="14"
            strokeLinejoin="round"
          />
        </mask>
        <clipPath id={`${id}-front`}>
          <rect width="627" height={headBottom} />
          <rect y="560" width="627" height="67" />
          <path d={front} />
        </clipPath>
        <mask
          id={`${id}-arm-area`}
          maskUnits="userSpaceOnUse"
          x="0"
          y="0"
          width="627"
          height="627"
          style={{ maskType: "luminance" }}
        >
          <rect width="627" height="627" fill="white" />
          <rect width="627" height={headBottom} fill="black" />
          <rect y="560" width="627" height="67" fill="black" />
          <path d={front} fill="black" />
        </mask>
        <clipPath id={`${id}-seams`}>
          <rect
            x={seams[0]}
            y={seams[2]}
            width="68"
            height={seams[3] - seams[2]}
          />
          <rect
            x={seams[1]}
            y={seams[2]}
            width="68"
            height={seams[3] - seams[2]}
          />
        </clipPath>
        <mask
          id={`${id}-body`}
          maskUnits="userSpaceOnUse"
          x="0"
          y="0"
          width="627"
          height="627"
          style={{ maskType: "luminance" }}
        >
          <rect width="627" height="627" fill="white" />
          <path
            d={left}
            fill="black"
            stroke="black"
            strokeWidth="28"
            strokeLinejoin="round"
          />
          <path
            d={right}
            fill="black"
            stroke="black"
            strokeWidth="28"
            strokeLinejoin="round"
          />
        </mask>
      </defs>
      <use href={`#${id}-figure`} mask={`url(#${id}-body)`} />
      {/* Fabric behind the inside sleeve seam prevents a transparent shoulder gap. */}
      <g clipPath={`url(#${id}-seams)`}>
        <g mask={`url(#${id}-left)`}>
          <use href={`#${id}-figure`} transform="translate(20 0)" />
        </g>
        <g mask={`url(#${id}-right)`}>
          <use href={`#${id}-figure`} transform="translate(-20 0)" />
        </g>
      </g>
      <g mask={`url(#${id}-arm-area)`}>
        <g
          className="yut-waiting-arm yut-waiting-arm--left"
          style={{ transformOrigin: `${pivots[0]}px ${pivots[1]}px` }}
        >
          <use href={`#${id}-figure`} mask={`url(#${id}-left)`} />
        </g>
        <g
          className="yut-waiting-arm yut-waiting-arm--right"
          style={{ transformOrigin: `${pivots[2]}px ${pivots[3]}px` }}
        >
          <use href={`#${id}-figure`} mask={`url(#${id}-right)`} />
        </g>
      </g>
      <use href={`#${id}-figure`} clipPath={`url(#${id}-front)`} />
    </svg>
  );
}

/** Four original costumed animal sprites from the shared transparent 2 × 2 atlas. */
export function YutSprite({
  role,
  className = "",
  pose = "idle",
}: {
  role: YutProfession;
  className?: string;
  pose?: YutSpritePose;
}) {
  const source = `${import.meta.env.BASE_URL}assets/weplay/yut/characters.webp`;
  return (
    <span
      className={`yut-sprite yut-character--${role} yut-sprite--${pose} ${className}`}
      aria-hidden="true"
      style={{
        backgroundImage: `url(${source})`,
      }}
    >
      {pose === "idle" && <WaitingSleeves role={role} source={source} />}
    </span>
  );
}

export function YutIcon({
  name,
}: {
  name:
    | "back"
    | "info"
    | "sound"
    | "muted"
    | "arrow"
    | "copy"
    | "emote"
    | "rotate";
}) {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {name === "back" && <path d="m14 5-7 7 7 7M7 12h13" />}
      {name === "arrow" && <path d="M4 12h15m-6-6 6 6-6 6" />}
      {name === "info" && (
        <>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 11v6" />
          <circle cx="12" cy="7.5" r=".7" fill="currentColor" />
        </>
      )}
      {(name === "sound" || name === "muted") && (
        <>
          <path d="M11 4 5 9H2v6h3l6 5Z" />
          {name === "sound" ? (
            <>
              <path d="M15 8a6 6 0 0 1 0 8M18 5a10 10 0 0 1 0 14" />
            </>
          ) : (
            <path d="m16 9 6 6m0-6-6 6" />
          )}
        </>
      )}
      {name === "emote" && (
        <>
          <circle cx="12" cy="12" r="9" />
          <path d="M8 14q4 5 8 0M8 8h.01M16 8h.01" />
        </>
      )}
      {name === "rotate" && (
        <>
          <rect
            x="8"
            y="3"
            width="9"
            height="16"
            rx="2"
            transform="rotate(30 12 12)"
          />
          <path d="M3 11a9 9 0 0 1 4-7m-4 0v7h6M21 13a9 9 0 0 1-4 7m4 0v-7h-6" />
        </>
      )}
      {name === "copy" && (
        <>
          <rect x="8" y="8" width="11" height="13" rx="1" />
          <path d="M15 8V3H4v13h4" />
        </>
      )}
    </svg>
  );
}
