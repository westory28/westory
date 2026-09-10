const { HttpsError } = require("firebase-functions/v2/https");
const tags = new Set(
  "p div span br hr strong b em i u s strike ol ul li h1 h2 h3 h4 h5 h6 blockquote pre code sub sup table thead tbody tfoot tr td th a img font".split(
    " ",
  ),
);
const reject = () => {
  throw new HttpsError(
    "invalid-argument",
    "본문 또는 각주에 지원하지 않는 HTML이 있습니다. 일반 글·서식·링크만 사용해 주세요.",
    { reason: "LESSON_HTML_UNSAFE" },
  );
};
const safeUrl = (value) => {
  try {
    const url = new URL(value);
    return (
      ["https:", "http:"].includes(url.protocol) &&
      !url.username &&
      !url.password
    );
  } catch {
    return false;
  }
};
// Fail closed instead of trying to repair arbitrary HTML with replacements.
// Every '<' and every attribute must be consumed by this restricted grammar.
const assertLessonHtml = (html = "") => {
  if (typeof html !== "string") reject();
  let cursor = 0;
  while ((cursor = html.indexOf("<", cursor)) !== -1) {
    const match = html
      .slice(cursor)
      .match(/^<(\/?)([A-Za-z][A-Za-z0-9]*)([^<>]*)>/);
    if (!match || !tags.has(match[2].toLowerCase())) reject();
    let attrs = match[3];
    if (match[1] && attrs.trim()) reject();
    attrs = attrs.replace(/\/\s*$/, "");
    while (attrs.trim()) {
      const attribute = attrs.match(
        /^\s+([A-Za-z][A-Za-z0-9_-]*)\s*=\s*(?:"([^"<>]*)"|'([^'<>]*)')/,
      );
      if (!attribute) reject();
      const name = attribute[1].toLowerCase();
      const value = attribute[2] ?? attribute[3];
      if (name === "href" || name === "src") {
        if (!safeUrl(value)) reject();
      } else if (name === "style") {
        for (const declaration of value
          .split(";")
          .filter((part) => part.trim())) {
          const style = declaration
            .trim()
            .match(/^([a-z-]+)\s*:\s*([a-zA-Z0-9#.,%() +\-]+)$/);
          if (
            !style ||
            !/^(color|background-color|font-size|font-weight|font-family|font-style|text-align|text-decoration|line-height|margin(-left|-right|-top|-bottom)?|padding(-left|-right|-top|-bottom)?|width|height|border(-color|-width|-style)?|vertical-align|white-space)$/.test(
              style[1],
            ) ||
            /url|expression|behavior|import/i.test(style[2])
          )
            reject();
        }
      } else if (["class", "title", "alt", "aria-label"].includes(name)) {
        // Quoted text attributes have no executable meaning on allowed tags.
      } else if (name === "target") {
        if (!["_blank", "_self"].includes(value)) reject();
      } else if (name === "rel") {
        if (!/^[a-z -]*$/.test(value)) reject();
      } else if (
        ["colspan", "rowspan", "width", "height", "size"].includes(name)
      ) {
        if (!/^\d{1,4}%?$/.test(value)) reject();
      } else if (name === "color") {
        if (!/^[a-zA-Z0-9#]+$/.test(value)) reject();
      } else reject();
      attrs = attrs.slice(attribute[0].length);
    }
    cursor += match[0].length;
  }
};
module.exports = { assertLessonHtml };
