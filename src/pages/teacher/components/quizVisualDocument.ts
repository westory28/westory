import { parseQuizPassageMarkup } from "../../../lib/quizPassageMarkup";

export type QuizVisualMark = "text" | "underline" | "box" | "blank";
export interface QuizVisualRun {
  text: string;
  mark: QuizVisualMark;
  group?: number;
}
export interface QuizVisualLine {
  bullet: boolean;
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
    ((run.mark !== "box" && run.mark !== "blank") ||
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
            line.bullet = true;
            parse(part.text);
          } else
            appendRun(line, {
              mark: part.type,
              ...(part.type === "box" || part.type === "blank"
                ? { group: ++nextMarkGroup }
                : {}),
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
        (line.bullet ? "{{bullet}}" : "") +
        line.runs
          .map((run) => {
            const text = run.text.replace(/\u200b/g, "");
            return run.mark === "text"
              ? text
              : `{{${run.mark === "underline" ? "u" : run.mark}:${text}}}`;
          })
          .join(""),
    )
    .join("\n");

export const quizVisualText = (lines: QuizVisualDocument) =>
  lines.map((line) => line.runs.map((run) => run.text).join("")).join("\n");

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
  const removeBullets = lines.every(
    (line, index) => !selectedLines[index] || line.bullet,
  );
  const formatGroup = ++nextMarkGroup;
  offset = 0;
  return lines.map((line, index) => {
    const next = {
      bullet:
        mark === "bullet" && selectedLines[index]
          ? !removeBullets
          : line.bullet,
      runs: [] as QuizVisualRun[],
    };
    line.runs.forEach((run) => {
      for (let i = 0; i < run.text.length; i += 1) {
        appendRun(next, {
          text: run.text[i],
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
  ["text", "underline", "box", "blank"].includes(value || "");

/** Reads only text and the four supported marks. No input element or attribute is cloned. */
export const readQuizVisualDom = (root: Node): QuizVisualDocument => {
  const read = (
    node: Node,
    inherited: QuizVisualMark = "text",
    inheritedGroup?: number,
  ): QuizVisualDocument => {
    if (node.nodeType === 3)
      return (node.textContent || "")
        .replace(/\r\n/g, "\n")
        .split("\n")
        .map((text) => ({
          bullet: false,
          runs: text ? [{ text, mark: inherited, group: inheritedGroup }] : [],
        }));
    if (node.nodeType !== 1 && node.nodeType !== 11) return [emptyLine()];
    const element = node.nodeType === 1 ? (node as HTMLElement) : null;
    if (element && ignoredTags.has(element.tagName.toUpperCase())) return [];
    if (element?.tagName === "BR") return [emptyLine(), emptyLine()];
    let mark = inherited;
    let group = inheritedGroup;
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
        (mark === "box" || mark === "blank") &&
        (mark !== inherited ||
          allowedMark(requested) ||
          /\bborder(?:-[a-z]+)?\s*:/i.test(element.getAttribute("style") || ""))
      )
        group = ++nextMarkGroup;
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
        const content = read(child, mark, group);
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
    if (element?.tagName === "LI" || element?.dataset?.quizBullet === "true")
      output[0].bullet = true;
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
  lines.forEach((line) => {
    const row = document.createElement("div");
    row.dataset.quizLine = "true";
    if (line.bullet) row.dataset.quizBullet = "true";
    line.runs.forEach((run) => {
      if (run.mark === "text")
        row.appendChild(document.createTextNode(run.text));
      else {
        const span = document.createElement("span");
        span.dataset.quizMark = run.mark;
        if (run.mark === "blank")
          span.title = "학생에게는 빈칸으로 표시됩니다.";
        span.textContent = run.text || "\u200b";
        row.appendChild(span);
      }
    });
    if (!row.childNodes.length) row.appendChild(document.createElement("br"));
    fragment.appendChild(row);
  });
  return fragment;
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
