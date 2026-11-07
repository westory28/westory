import {
  isQuizPassageBlankLabel,
  parseQuizPassageMarkup,
  quizPassageHangulMarker,
} from "../../../lib/quizPassageMarkup";

export type QuizVisualMark =
  | "text"
  | "underline"
  | "box"
  | "blank"
  | "blankBox";
export interface QuizVisualRun {
  text: string;
  mark: QuizVisualMark;
  group?: number;
  widthEm?: number;
}
export interface QuizVisualLine {
  bullet: boolean | "hangul";
  runs: QuizVisualRun[];
}
export type QuizVisualDocument = QuizVisualLine[];
const emptyLine = (): QuizVisualLine => ({ bullet: false, runs: [] });
let nextMarkGroup = 0;
const appendRun = (line: QuizVisualLine, run: QuizVisualRun) => {
  if (!run.text) return;
  const last = line.runs[line.runs.length - 1];
  if (
    last?.mark === run.mark &&
    last.widthEm === run.widthEm &&
    ((run.mark !== "box" && run.mark !== "blank" && run.mark !== "blankBox") ||
      (run.group != null && last.group === run.group))
  )
    last.text += run.text;
  else line.runs.push({ ...run });
};

export const parseQuizVisualDocument = (value: string): QuizVisualDocument =>
  value
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((text) => {
      const line = emptyLine();
      const parse = (source: string) =>
        parseQuizPassageMarkup(source).forEach((part) => {
          if (part.type === "bullet") {
            line.bullet = part.bulletStyle === "hangul" ? "hangul" : true;
            parse(part.text);
          } else
            appendRun(line, {
              mark: part.type,
              ...(part.type === "box" ||
              part.type === "blank" ||
              part.type === "blankBox"
                ? { group: ++nextMarkGroup }
                : {}),
              ...(part.type === "blankBox" ? { widthEm: part.widthEm } : {}),
              text: part.text || (part.type !== "text" ? "\u200b" : ""),
            });
        });
      parse(text);
      return line;
    });

export const serializeQuizVisualDocument = (
  lines: QuizVisualDocument,
): string =>
  lines
    .map(
      (line) =>
        (line.bullet === "hangul"
          ? "{{hangul}}"
          : line.bullet
            ? "{{bullet}}"
            : "") +
        line.runs
          .map((run) => {
            const text = run.text.replace(/\u200b/g, "");
            if (run.mark === "blankBox")
              return `{{blankbox:${normalizeBlankWidth(run.widthEm)}|${text.replace(/[{}\r\n|]/g, "").slice(0, 20) || "(가)"}}}`;
            return run.mark === "text"
              ? text
              : `{{${run.mark === "underline" ? "u" : run.mark}:${text}}}`;
          })
          .join(""),
    )
    .join("\n");

export const quizVisualText = (lines: QuizVisualDocument) =>
  lines.map((line) => line.runs.map((run) => run.text).join("")).join("\n");

export const normalizeBlankWidth = (width: number | undefined) =>
  Math.round(
    Math.max(1, Math.min(30, Number.isFinite(width) ? width! : 2)) * 1000,
  ) / 1000;

/** A clipboard selection contains visible text and supported marks, never source tokens. */
export const sliceQuizVisualDocument = (
  lines: QuizVisualDocument,
  start: number,
  end: number,
): QuizVisualDocument => {
  const output: QuizVisualDocument = [];
  let offset = 0;
  lines.forEach((line) => {
    const length = quizVisualText([line]).length;
    if (end > offset && start <= offset + length) {
      const next: QuizVisualLine = {
        bullet: start <= offset ? line.bullet : false,
        runs: [],
      };
      let cursor = offset;
      line.runs.forEach((run) => {
        const from = Math.max(0, start - cursor);
        const to = Math.min(run.text.length, end - cursor);
        if (to > from)
          appendRun(next, { ...run, text: run.text.slice(from, to) });
        cursor += run.text.length;
      });
      output.push(next);
    }
    offset += length + 1;
  });
  return output.length ? output : [emptyLine()];
};

export const quizVisualClipboard = (lines: QuizVisualDocument) => {
  const root = document.createElement("div");
  let hangulIndex = 0;
  const plainLines: string[] = [];
  lines.forEach((line) => {
    const row = document.createElement("div");
    const marker =
      line.bullet === "hangul" ? quizPassageHangulMarker(hangulIndex++) : "•";
    if (line.bullet !== "hangul") hangulIndex = 0;
    if (line.bullet) {
      row.dataset.quizBullet = String(line.bullet);
      row.dataset.quizClipboardBullet = "true";
      row.appendChild(document.createTextNode(`${marker} `));
    }
    plainLines.push(
      (line.bullet ? `${marker} ` : "") +
        quizVisualText([line]).replace(/\u200b/g, ""),
    );
    line.runs.forEach((run) => {
      if (run.mark === "text")
        row.appendChild(document.createTextNode(run.text));
      else {
        const span = document.createElement("span");
        span.dataset.quizMark = run.mark;
        if (run.mark === "box" && isQuizPassageBlankLabel(run.text))
          span.dataset.quizLabelBox = "true";
        span.textContent = run.text.replace(/\u200b/g, "");
        if (run.mark === "underline") span.style.textDecoration = "underline";
        else if (run.mark === "blank")
          span.style.borderBottom = "1px solid currentColor";
        else {
          span.style.border = "1px solid currentColor";
          span.style.display = "inline-block";
          span.style.padding = "0 .3em";
          if (run.mark === "blankBox") {
            span.dataset.quizWidth = String(normalizeBlankWidth(run.widthEm));
            span.style.width = `${normalizeBlankWidth(run.widthEm)}em`;
            span.style.boxSizing = "content-box";
            span.style.lineHeight = "1.2";
            span.style.whiteSpace = "nowrap";
            span.style.textAlign = "center";
          }
        }
        row.appendChild(span);
      }
    });
    if (!row.childNodes.length) row.appendChild(document.createElement("br"));
    root.appendChild(row);
  });
  return {
    text: plainLines.join("\n"),
    html: root.innerHTML,
  };
};

export const replaceQuizVisualSelection = (
  lines: QuizVisualDocument,
  start: number,
  end: number,
  inserted: QuizVisualDocument,
): QuizVisualDocument => {
  const split = (position: number) => {
    let remaining = position;
    for (let index = 0; index < lines.length; index += 1) {
      const length = quizVisualText([lines[index]]).length;
      if (remaining <= length || index === lines.length - 1) {
        const before = {
          bullet: lines[index].bullet,
          runs: [] as QuizVisualRun[],
        };
        const after = {
          bullet: lines[index].bullet,
          runs: [] as QuizVisualRun[],
        };
        let offset = 0;
        lines[index].runs.forEach((run) => {
          const at = Math.max(0, Math.min(remaining - offset, run.text.length));
          appendRun(before, { ...run, text: run.text.slice(0, at) });
          appendRun(after, { ...run, text: run.text.slice(at) });
          offset += run.text.length;
        });
        return {
          before: [...lines.slice(0, index), before],
          after: [after, ...lines.slice(index + 1)],
        };
      }
      remaining -= length + 1;
    }
    return { before: [emptyLine()], after: [emptyLine()] };
  };
  const before = split(start).before,
    after = split(end).after;
  const result = before.map((line) => ({
    ...line,
    runs: line.runs.map((run) => ({ ...run })),
  }));
  (inserted.length ? inserted : [emptyLine()]).forEach((line, index) => {
    if (index) result.push(emptyLine());
    const target = result[result.length - 1];
    target.bullet = target.bullet || line.bullet;
    line.runs.forEach((run) => appendRun(target, run));
  });
  after[0].runs.forEach((run) => appendRun(result[result.length - 1], run));
  result.push(...after.slice(1));
  return result;
};

export const formatQuizVisualDocument = (
  lines: QuizVisualDocument,
  start: number,
  end: number,
  mark: QuizVisualMark | "bullet",
): QuizVisualDocument => {
  let offset = 0;
  const selectedLines = lines.map((line) => {
    const length = line.runs.reduce((sum, run) => sum + run.text.length, 0);
    const selected =
      start === end
        ? start >= offset && start <= offset + length
        : end > offset && start <= offset + length;
    offset += length + 1;
    return selected;
  });
  const selectedBullets = lines.filter((_line, index) => selectedLines[index]);
  const nextBullet: QuizVisualLine["bullet"] = selectedBullets.every(
    (line) => line.bullet === "hangul",
  )
    ? false
    : selectedBullets.every((line) => line.bullet === true)
      ? "hangul"
      : true;
  const formatGroup = ++nextMarkGroup;
  offset = 0;
  return lines.map((line, index) => {
    const next = {
      bullet:
        mark === "bullet" && selectedLines[index] ? nextBullet : line.bullet,
      runs: [] as QuizVisualRun[],
    };
    line.runs.forEach((run) => {
      for (let i = 0; i < run.text.length; i += 1) {
        appendRun(next, {
          text: run.text[i],
          ...(mark !== "bullet" && offset >= start && offset < end
            ? {}
            : { widthEm: run.widthEm }),
          group:
            mark !== "bullet" && offset >= start && offset < end
              ? formatGroup
              : run.group,
          mark:
            mark !== "bullet" && offset >= start && offset < end
              ? mark
              : run.mark,
        });
        offset += 1;
      }
    });
    offset += 1;
    return next;
  });
};

const blockTags = new Set([
  "DIV",
  "P",
  "LI",
  "UL",
  "OL",
  "BLOCKQUOTE",
  "PRE",
  "H1",
  "H2",
  "H3",
  "H4",
  "H5",
  "H6",
]);
const ignoredTags = new Set([
  "SCRIPT",
  "STYLE",
  "IFRAME",
  "OBJECT",
  "EMBED",
  "SVG",
  "MATH",
  "IMG",
  "VIDEO",
  "AUDIO",
  "SOURCE",
  "LINK",
  "META",
  "BASE",
  "INPUT",
  "TEXTAREA",
  "SELECT",
  "BUTTON",
  "TEMPLATE",
]);
const allowedMark = (value: string | undefined): value is QuizVisualMark =>
  ["text", "underline", "box", "blank", "blankBox"].includes(value || "");

/** Reads only text and the four supported marks. No input element or attribute is cloned. */
export const readQuizVisualDom = (root: Node): QuizVisualDocument => {
  const read = (
    node: Node,
    inherited: QuizVisualMark = "text",
    inheritedGroup?: number,
    inheritedWidth?: number,
  ): QuizVisualDocument => {
    if (node.nodeType === 3)
      return (node.textContent || "")
        .replace(/\r\n/g, "\n")
        .split("\n")
        .map((text) => ({
          bullet: false,
          runs: text
            ? [
                {
                  text,
                  mark: inherited,
                  group: inheritedGroup,
                  widthEm: inheritedWidth,
                },
              ]
            : [],
        }));
    if (node.nodeType !== 1 && node.nodeType !== 11) return [emptyLine()];
    const element = node.nodeType === 1 ? (node as HTMLElement) : null;
    if (element && ignoredTags.has(element.tagName.toUpperCase())) return [];
    if (element?.tagName === "BR") return [emptyLine(), emptyLine()];
    let mark = inherited;
    let group = inheritedGroup;
    let widthEm = inheritedWidth;
    if (element) {
      const requested = element.dataset?.quizMark;
      if (allowedMark(requested)) mark = requested;
      else if (
        element.tagName === "U" ||
        /(?:^|;)\s*text-decoration(?:-line)?\s*:[^;]*\bunderline\b/i.test(
          element.getAttribute("style") || "",
        )
      )
        mark = "underline";
      else if (
        /\bborder(?:-[a-z]+)?\s*:[^;]*\b(?:solid|dashed|dotted)\b/i.test(
          element.getAttribute("style") || "",
        )
      )
        mark = "box";
      if (
        (mark === "box" || mark === "blank" || mark === "blankBox") &&
        (mark !== inherited ||
          allowedMark(requested) ||
          /\bborder(?:-[a-z]+)?\s*:/i.test(element.getAttribute("style") || ""))
      )
        group = ++nextMarkGroup;
      if (mark === "blankBox")
        widthEm = normalizeBlankWidth(Number(element.dataset.quizWidth));
    }
    const children = Array.from(node.childNodes);
    const placeholder =
      children.length === 1 && (children[0] as HTMLElement).tagName === "BR";
    const output = [emptyLine()];
    let hasContent = false,
      previousBlock = false;
    if (!placeholder)
      children.forEach((child) => {
        const childElement =
          child.nodeType === 1 ? (child as HTMLElement) : null;
        if (childElement && ignoredTags.has(childElement.tagName.toUpperCase()))
          return;
        if (
          child.nodeType === 3 &&
          !child.textContent?.trim() &&
          /[\r\n]/.test(child.textContent || "")
        )
          return;
        const block = !!childElement && blockTags.has(childElement.tagName);
        const content = read(child, mark, group, widthEm);
        if (!content.length) return;
        if (hasContent && (block || previousBlock)) output.push(emptyLine());
        content.forEach((line, index) => {
          if (index) output.push(emptyLine());
          const target = output[output.length - 1];
          target.bullet = target.bullet || line.bullet;
          line.runs.forEach((run) => appendRun(target, run));
        });
        hasContent = true;
        previousBlock = block;
      });
    if (element?.dataset?.quizBullet === "hangul") output[0].bullet = "hangul";
    else if (
      element?.tagName === "LI" ||
      element?.dataset?.quizBullet === "true"
    )
      output[0].bullet = true;
    if (element?.dataset?.quizClipboardBullet === "true" && output[0].runs[0])
      output[0].runs[0].text = output[0].runs[0].text.replace(
        output[0].bullet === "hangul" ? /^(?:[ㄱ-ㅎ]|\d+)\. / : /^• /,
        "",
      );
    return output;
  };
  return read(root);
};

export const importQuizVisualHtml = (html: string): QuizVisualDocument => {
  // Template contents are inert; never append this untrusted fragment to a page.
  const template = document.createElement("template");
  template.innerHTML = html;
  return readQuizVisualDom(template.content);
};

export const createQuizVisualFragment = (
  lines: QuizVisualDocument,
): DocumentFragment => {
  const fragment = document.createDocumentFragment();
  let hangulIndex = 0;
  lines.forEach((line) => {
    const row = document.createElement("div");
    row.dataset.quizLine = "true";
    if (line.bullet) row.dataset.quizBullet = String(line.bullet);
    if (line.bullet === "hangul")
      row.dataset.quizListMarker = quizPassageHangulMarker(hangulIndex++);
    else hangulIndex = 0;
    line.runs.forEach((run) => {
      if (run.mark === "text")
        row.appendChild(document.createTextNode(run.text));
      else {
        const span = document.createElement("span");
        span.dataset.quizMark = run.mark;
        if (run.mark === "blank")
          span.title = "학생에게는 빈칸으로 표시됩니다.";
        if (run.mark === "box" && isQuizPassageBlankLabel(run.text))
          span.dataset.quizLabelBox = "true";
        if (run.mark === "blankBox") {
          span.dataset.quizWidth = String(normalizeBlankWidth(run.widthEm));
          span.style.width = `${normalizeBlankWidth(run.widthEm)}em`;
        }
        span.textContent = run.text || "\u200b";
        row.appendChild(span);
      }
    });
    if (!row.childNodes.length) row.appendChild(document.createElement("br"));
    fragment.appendChild(row);
  });
  return fragment;
};

/** Keep generated markers and hanging indents current after native editing. */
export const decorateQuizVisualRows = (root: HTMLElement) => {
  let hangulIndex = 0;
  Array.from(root.children).forEach((child) => {
    const row = child as HTMLElement;
    if (row.dataset.quizBullet === "hangul") {
      row.dataset.quizListMarker = quizPassageHangulMarker(hangulIndex++);
    } else {
      hangulIndex = 0;
      delete row.dataset.quizListMarker;
    }
    delete row.dataset.quizLeadingLabel;
    row.style.removeProperty("--quiz-leading-label-width");
    if (row.dataset.quizBullet) return;
    const leading = /^\([가-힣ㄱ-ㅎA-Za-z0-9]{1,3}\)[ \t]+(?=\S)/u.exec(
      row.textContent || "",
    );
    if (!leading) return;
    let remaining = leading[0].length;
    const walker = document.createTreeWalker(row, NodeFilter.SHOW_TEXT);
    let text: Node | null;
    while ((text = walker.nextNode())) {
      const length = text.textContent?.length || 0;
      if (remaining <= length) {
        const range = document.createRange();
        range.selectNodeContents(row);
        range.setEnd(text, remaining);
        const width = range.getBoundingClientRect().width;
        if (width > 0) {
          row.dataset.quizLeadingLabel = "true";
          row.style.setProperty("--quiz-leading-label-width", `${width}px`);
        }
        break;
      }
      remaining -= length;
    }
  });
};

/** Selection offsets are derived from a clone of the visible editor DOM. */
export const getQuizVisualSelection = (
  root: HTMLElement,
): { start: number; end: number } | null => {
  const selection = window.getSelection();
  if (!selection?.rangeCount) return null;
  const range = selection.getRangeAt(0);
  if (
    !root.contains(range.startContainer) ||
    !root.contains(range.endContainer)
  )
    return null;
  const offset = (node: Node, position: number) => {
    const prefix = document.createRange();
    prefix.selectNodeContents(root);
    prefix.setEnd(node, position);
    return quizVisualText(readQuizVisualDom(prefix.cloneContents())).length;
  };
  return {
    start: offset(range.startContainer, range.startOffset),
    end: offset(range.endContainer, range.endOffset),
  };
};

export const setQuizVisualSelection = (
  root: HTMLElement,
  start: number,
  end = start,
) => {
  let offset = 0;
  const points: { node: Node; start: number; end: number }[] = [];
  Array.from(root.childNodes).forEach((row, index) => {
    if (index) offset += 1;
    const walker = document.createTreeWalker(row, NodeFilter.SHOW_TEXT);
    let text: Node | null;
    while ((text = walker.nextNode())) {
      const length = text.textContent?.length || 0;
      points.push({ node: text, start: offset, end: offset + length });
      offset += length;
    }
    if (!row.textContent)
      points.push({ node: row, start: offset, end: offset });
  });
  const point = (value: number) => {
    const found =
      points.find((entry) => entry.end >= value) || points[points.length - 1];
    return found
      ? {
          node: found.node,
          offset:
            found.node.nodeType === 3
              ? Math.max(
                  0,
                  Math.min(value - found.start, found.end - found.start),
                )
              : 0,
        }
      : { node: root, offset: 0 };
  };
  const a = point(start),
    b = point(end);
  const range = document.createRange();
  range.setStart(a.node, a.offset);
  range.setEnd(b.node, b.offset);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
};
