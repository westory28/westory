import DOMPurify from "dompurify";

// Rich text is content, even when an administrator authored it. Keep its
// formatting but never import executable documents or interactive forms.
const options = {
  USE_PROFILES: { html: true },
  ADD_ATTR: ["target"],
  FORBID_TAGS: [
    "style",
    "form",
    "input",
    "button",
    "textarea",
    "select",
    "option",
    "iframe",
    "object",
    "embed",
    "base",
    "meta",
    "link",
  ],
  FORBID_ATTR: ["srcdoc", "autofocus"],
};

const safeContentUrl = (value: string, image: boolean) => {
  const compact = value.replace(/[\u0000-\u0020\u007f]/g, "");
  if (/^data:/i.test(compact))
    return (
      image &&
      /^data:image\/(?:png|jpe?g|gif|webp|avif|bmp);base64,/i.test(compact)
    );
  try {
    const url = new URL(value, window.location.href);
    return (
      [
        "https:",
        "http:",
        ...(image ? ["blob:"] : ["mailto:", "tel:"]),
      ].includes(url.protocol) &&
      !url.username &&
      !url.password
    );
  } catch {
    return false;
  }
};

if (typeof DOMPurify.addHook === "function") {
  DOMPurify.addHook("uponSanitizeAttribute", (node, attribute) => {
    if (["href", "src"].includes(attribute.attrName)) {
      attribute.keepAttr = safeContentUrl(
        attribute.attrValue,
        node.nodeName === "IMG" && attribute.attrName === "src",
      );
    }
    // srcset is only used for responsive notice images. Keep ordinary image
    // URLs and descriptors; do not permit data or active-scheme candidates.
    if (attribute.attrName === "srcset") {
      attribute.keepAttr = attribute.attrValue.split(",").every((candidate) => {
        const url = candidate.trim().split(/\s+/)[0];
        return (
          Boolean(url) && !/^data:/i.test(url) && safeContentUrl(url, true)
        );
      });
    }
    if (attribute.attrName === "style") {
      // Preserve authored typography/layout. CSS resource loads and legacy
      // executable expressions do not belong in stored rich text.
      attribute.keepAttr =
        !/(?:url\s*\(|expression\s*\(|@import|behavior\s*:|-moz-binding\s*:|\\)/i.test(
          attribute.attrValue,
        );
    }
  });
  DOMPurify.addHook("afterSanitizeAttributes", (node) => {
    if (node instanceof HTMLAnchorElement && node.target === "_blank") {
      const rel = new Set((node.getAttribute("rel") || "").split(/\s+/));
      rel.add("noopener");
      rel.add("noreferrer");
      node.setAttribute("rel", [...rel].filter(Boolean).join(" "));
    }
  });
}

/** Apply at a rendering boundary; never overwrite the saved source document. */
export const sanitizeRichHtml = (html: string): string => {
  if (!html || typeof DOMPurify.sanitize !== "function") return "";
  return DOMPurify.sanitize(html, options);
};
