export interface WordBox {
  text: string;
  width: number;
  height: number;
}

export interface PlacedWord extends WordBox {
  x: number;
  y: number;
}

export const wordHash = (text: string) => {
  let hash = 2166136261;
  for (const letter of text)
    hash = Math.imul(hash ^ letter.codePointAt(0)!, 16777619);
  return hash >>> 0;
};

// Measured, horizontal boxes grow out from (0, 0). A spatial index keeps
// collision checks local; no animation frame, timer or server work is needed.
export const placeCloudWords = (
  words: WordBox[],
  width: number,
  minHeight: number,
  previous = new Map<string, PlacedWord>(),
) => {
  const padding = width < 600 ? 12 : 24;
  const gap = width < 600 ? 9 : 14;
  const edge = Math.max(1, width / 2 - padding);
  const cells = new Map<string, PlacedWord[]>();
  const placed: PlacedWord[] = [];
  const cellSize = 80;
  const range = (box: PlacedWord) => [
    Math.floor((box.x - box.width / 2 - gap) / cellSize),
    Math.floor((box.x + box.width / 2 + gap) / cellSize),
    Math.floor((box.y - box.height / 2 - gap) / cellSize),
    Math.floor((box.y + box.height / 2 + gap) / cellSize),
  ];
  const fits = (box: PlacedWord) => {
    if (Math.abs(box.x) + box.width / 2 > edge + 0.5) return false;
    const [left, right, top, bottom] = range(box);
    for (let x = left; x <= right; x++) {
      for (let y = top; y <= bottom; y++) {
        for (const other of cells.get(`${x},${y}`) || []) {
          if (
            Math.abs(box.x - other.x) <
              (box.width + other.width) / 2 + gap - 0.1 &&
            Math.abs(box.y - other.y) <
              (box.height + other.height) / 2 + gap - 0.1
          )
            return false;
        }
      }
    }
    return true;
  };
  const insert = (box: PlacedWord) => {
    placed.push(box);
    const [left, right, top, bottom] = range(box);
    for (let x = left; x <= right; x++) {
      for (let y = top; y <= bottom; y++) {
        const key = `${x},${y}`;
        const bucket = cells.get(key) || [];
        bucket.push(box);
        cells.set(key, bucket);
      }
    }
  };

  const pending: Array<{ word: WordBox; index: number }> = [];
  if (words[0]) insert({ ...words[0], x: 0, y: 0 });
  // Reserve every unchanged position before growing or inserting a word.
  // Otherwise an earlier growing word can displace many later neighbors.
  words.slice(1).forEach((word, offset) => {
    const old = previous.get(word.text);
    if (
      old &&
      Math.abs(old.width - word.width) < 0.1 &&
      Math.abs(old.height - word.height) < 0.1 &&
      fits({ ...word, x: old.x, y: old.y })
    ) {
      insert({ ...word, x: old.x, y: old.y });
    } else pending.push({ word, index: offset + 1 });
  });
  pending.forEach(({ word, index }) => {
    const old = previous.get(word.text);
    if (old && fits({ ...word, x: old.x, y: old.y })) {
      insert({ ...word, x: old.x, y: old.y });
      return;
    }
    const seed = wordHash(word.text) / 4294967296;
    const preferredAngle = index * 2.3999632297 + seed * 0.7;
    let best: PlacedWord | undefined;
    let bestScore = Infinity;
    const consider = (x: number, y: number) => {
      const candidate = { ...word, x, y };
      const radius = Math.hypot(x / 1.25, y);
      const angularDistance = 1 - Math.cos(Math.atan2(y, x) - preferredAngle);
      const score = radius + angularDistance * Math.min(70, word.width * 0.45);
      if (score >= bestScore || !fits(candidate)) return;
      best = candidate;
      bestScore = score;
    };
    // Try the boundary of each occupied rectangle in twelve staggered
    // directions. Unlike row packing, neither baselines nor columns are shared.
    for (const anchor of placed) {
      for (let direction = 0; direction < 12; direction++) {
        const angle = (direction / 12) * Math.PI * 2 + seed * 0.45;
        const dx = Math.cos(angle);
        const dy = Math.sin(angle);
        const distance = Math.min(
          ((anchor.width + word.width) / 2 + gap) / Math.abs(dx || 0.0001),
          ((anchor.height + word.height) / 2 + gap) / Math.abs(dy || 0.0001),
        );
        consider(anchor.x + dx * distance, anchor.y + dy * distance);
      }
    }
    // Full-width sentences still fit on narrow screens. These two boundary
    // candidates guarantee progress without hiding or shrinking any response.
    const top = Math.min(...placed.map((box) => box.y - box.height / 2));
    const bottom = Math.max(...placed.map((box) => box.y + box.height / 2));
    consider(0, top - gap - word.height / 2);
    consider(0, bottom + gap + word.height / 2);
    insert(best!);
  });
  const extent = Math.max(
    0,
    ...placed.map((box) => Math.abs(box.y) + box.height / 2),
  );
  const byText = new Map(placed.map((word) => [word.text, word]));
  return {
    words: words.map((word) => byText.get(word.text)!),
    height: Math.ceil(Math.max(minHeight, (extent + padding) * 2)),
  };
};
