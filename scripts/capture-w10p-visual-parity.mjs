import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { platform, release } from "node:os";
import { createServer, request as httpRequest } from "node:http";
import {
  createServer as createHttpsServer,
  request as httpsRequest,
} from "node:https";
import {
  connect as connectTcp,
  createServer as createTcpServer,
  isIP,
} from "node:net";
import { createSocket as createUdpSocket } from "node:dgram";
import { createRequire } from "node:module";
import { chromium } from "playwright-core";

const STAGING_PROJECT_NUMBER = "894916304910";
const STAGING_APP_ID = "1:894916304910:web:bd8c8a9e3ed8bd1620dc5f";
const APP_CHECK_DEBUG_SENTINEL = "w10p-visual-app-check-debug-sentinel-v1";
const BROWSER_SECRET_ENVIRONMENT_VARIABLE_NAMES = [
  "W10P_VISUAL_APPCHECK_DEBUG_TOKEN",
  "W10P_VISUAL_CREDENTIALS_JSON",
  "W10P_VISUAL_FIREBASE_CONFIG_JSON",
  "VERCEL_AUTOMATION_BYPASS_SECRET",
];
const BROWSER_CHILD_ENVIRONMENT_ALLOWLIST = [
  "ALLUSERSPROFILE",
  "APPDATA",
  "COMMONPROGRAMFILES",
  "COMMONPROGRAMFILES(X86)",
  "COMMONPROGRAMW6432",
  "COMSPEC",
  "DRIVERDATA",
  "HOMEDRIVE",
  "HOMEPATH",
  "LANG",
  "LOCALAPPDATA",
  "LOGONSERVER",
  "NUMBER_OF_PROCESSORS",
  "OS",
  "PATH",
  "PATHEXT",
  "PROCESSOR_ARCHITECTURE",
  "PROCESSOR_IDENTIFIER",
  "PROCESSOR_LEVEL",
  "PROCESSOR_REVISION",
  "PROGRAMDATA",
  "PROGRAMFILES",
  "PROGRAMFILES(X86)",
  "PROGRAMW6432",
  "PUBLIC",
  "SESSIONNAME",
  "SYSTEMDRIVE",
  "SYSTEMROOT",
  "TEMP",
  "TMP",
  "TZ",
  "USERDOMAIN",
  "USERDOMAIN_ROAMINGPROFILE",
  "USERNAME",
  "USERPROFILE",
  "WINDIR",
].sort();
const createBrowserChildEnvironment = () =>
  Object.fromEntries(
    Object.entries(process.env).filter(([name]) =>
      BROWSER_CHILD_ENVIRONMENT_ALLOWLIST.includes(name.toUpperCase()),
    ),
  );
const blockBrowserSecondaryExecutionAndWebTransport = () => {
  class BlockedBrowserCapability {
    constructor() {
      throw new DOMException(
        "Secondary or peer browser execution is disabled during capture.",
        "SecurityError",
      );
    }
  }
  for (const name of [
    "Worker",
    "SharedWorker",
    "RTCPeerConnection",
    "WebSocketStream",
    "WebTransport",
    "webkitRTCPeerConnection",
  ]) {
    Object.defineProperty(globalThis, name, {
      configurable: false,
      enumerable: false,
      writable: false,
      value: BlockedBrowserCapability,
    });
  }
  const blockedOperation = () => {
    throw new DOMException(
      "Speculative browser egress is disabled during capture.",
      "SecurityError",
    );
  };
  const lockMethod = (target, name, replacement) => {
    if (!target || typeof target[name] !== "function") return;
    Object.defineProperty(target, name, {
      configurable: false,
      enumerable: false,
      writable: false,
      value: replacement,
    });
  };
  lockMethod(globalThis.Navigator?.prototype, "sendBeacon", blockedOperation);
  if (globalThis.navigator) {
    Object.defineProperty(globalThis.navigator, "sendBeacon", {
      configurable: false,
      enumerable: false,
      writable: false,
      value: blockedOperation,
    });
  }
  for (const workletTarget of [
    globalThis.Worklet?.prototype,
    globalThis.AudioWorklet?.prototype,
    globalThis.CSS?.paintWorklet,
  ]) {
    if (!workletTarget || typeof workletTarget.addModule !== "function") {
      continue;
    }
    Object.defineProperty(workletTarget, "addModule", {
      configurable: false,
      enumerable: false,
      writable: false,
      value: blockedOperation,
    });
  }
  lockMethod(
    globalThis.ServiceWorkerContainer?.prototype,
    "register",
    blockedOperation,
  );
  if (globalThis.navigator?.serviceWorker) {
    Object.defineProperty(globalThis.navigator.serviceWorker, "register", {
      configurable: false,
      enumerable: false,
      writable: false,
      value: blockedOperation,
    });
  }
  const speculativeRelTokens = new Set([
    "dns-prefetch",
    "modulepreload",
    "preconnect",
    "prefetch",
    "preload",
    "prerender",
  ]);
  const hasBlockedRelToken = (value) =>
    String(value || "")
      .toLowerCase()
      .split(/\s+/u)
      .some((token) => speculativeRelTokens.has(token));
  const blockedRelLists = new WeakSet();
  const nativeRelListDescriptor = Object.getOwnPropertyDescriptor(
    HTMLLinkElement.prototype,
    "relList",
  );
  if (nativeRelListDescriptor?.get) {
    Object.defineProperty(HTMLLinkElement.prototype, "relList", {
      ...nativeRelListDescriptor,
      configurable: false,
      get() {
        const relList = nativeRelListDescriptor.get.call(this);
        blockedRelLists.add(relList);
        return relList;
      },
    });
  }
  const blockRelListMutation = (name, tokenSelector) => {
    const original = DOMTokenList.prototype[name];
    if (typeof original !== "function") return;
    Object.defineProperty(DOMTokenList.prototype, name, {
      configurable: false,
      writable: false,
      value(...args) {
        if (
          blockedRelLists.has(this) &&
          tokenSelector(args).some((token) =>
            speculativeRelTokens.has(String(token).toLowerCase()),
          )
        ) {
          return blockedOperation();
        }
        return original.apply(this, args);
      },
    });
  };
  blockRelListMutation("add", (args) => args);
  blockRelListMutation("replace", (args) => args.slice(1));
  blockRelListMutation("toggle", (args) => args.slice(0, 1));
  const nativeTokenListValueDescriptor = Object.getOwnPropertyDescriptor(
    DOMTokenList.prototype,
    "value",
  );
  if (nativeTokenListValueDescriptor?.set) {
    Object.defineProperty(DOMTokenList.prototype, "value", {
      ...nativeTokenListValueDescriptor,
      configurable: false,
      set(value) {
        if (blockedRelLists.has(this) && hasBlockedRelToken(value)) {
          return blockedOperation();
        }
        return nativeTokenListValueDescriptor.set.call(this, value);
      },
    });
  }
  const isBlockedSpeculativeNode = (node) => {
    if (node instanceof HTMLLinkElement) {
      return node.relList
        ? [...node.relList].some((token) => speculativeRelTokens.has(token))
        : hasBlockedRelToken(node.rel);
    }
    if (
      node instanceof HTMLScriptElement &&
      String(node.type || "").toLowerCase() === "speculationrules"
    ) {
      return true;
    }
    if (node instanceof HTMLAnchorElement && Boolean(node.ping)) return true;
    return node instanceof HTMLIFrameElement && node.hasAttribute("srcdoc");
  };
  const containsBlockedSpeculativeNode = (node) => {
    if (isBlockedSpeculativeNode(node)) return true;
    return (
      typeof node?.querySelectorAll === "function" &&
      [...node.querySelectorAll("link,script,a,iframe[srcdoc]")].some(
        (candidate) => isBlockedSpeculativeNode(candidate),
      )
    );
  };
  const assertNodesAllowed = (nodes) => {
    if (
      nodes.some(
        (node) =>
          typeof node !== "string" && containsBlockedSpeculativeNode(node),
      )
    ) {
      return blockedOperation();
    }
  };
  const nativeElementInnerHtmlDescriptor = Object.getOwnPropertyDescriptor(
    Element.prototype,
    "innerHTML",
  );
  const assertMarkupAllowed = (markup) => {
    if (!nativeElementInnerHtmlDescriptor?.set) return;
    const template = document.createElement("template");
    nativeElementInnerHtmlDescriptor.set.call(template, markup);
    if (containsBlockedSpeculativeNode(template.content)) {
      return blockedOperation();
    }
  };
  const originalAppendChild = Node.prototype.appendChild;
  Object.defineProperty(Node.prototype, "appendChild", {
    configurable: false,
    writable: false,
    value(node) {
      assertNodesAllowed([node]);
      return originalAppendChild.call(this, node);
    },
  });
  const originalInsertBefore = Node.prototype.insertBefore;
  Object.defineProperty(Node.prototype, "insertBefore", {
    configurable: false,
    writable: false,
    value(node, referenceNode) {
      assertNodesAllowed([node]);
      return originalInsertBefore.call(this, node, referenceNode);
    },
  });
  const originalReplaceChild = Node.prototype.replaceChild;
  Object.defineProperty(Node.prototype, "replaceChild", {
    configurable: false,
    writable: false,
    value(node, child) {
      assertNodesAllowed([node]);
      return originalReplaceChild.call(this, node, child);
    },
  });
  for (const target of [
    Element.prototype,
    Document.prototype,
    DocumentFragment.prototype,
    globalThis.ShadowRoot?.prototype,
  ].filter(Boolean)) {
    for (const name of ["append", "prepend", "replaceChildren"]) {
      const original = target[name];
      if (typeof original !== "function") continue;
      Object.defineProperty(target, name, {
        configurable: false,
        writable: false,
        value(...nodes) {
          assertNodesAllowed(nodes);
          return original.apply(this, nodes);
        },
      });
    }
  }
  for (const target of [
    Element.prototype,
    CharacterData.prototype,
    DocumentType.prototype,
  ]) {
    for (const name of ["after", "before", "replaceWith"]) {
      const original = target[name];
      if (typeof original !== "function") continue;
      Object.defineProperty(target, name, {
        configurable: false,
        writable: false,
        value(...nodes) {
          assertNodesAllowed(nodes);
          return original.apply(this, nodes);
        },
      });
    }
  }
  const originalInsertAdjacentElement = Element.prototype.insertAdjacentElement;
  lockMethod(
    Element.prototype,
    "insertAdjacentElement",
    function (position, node) {
      assertNodesAllowed([node]);
      return originalInsertAdjacentElement.call(this, position, node);
    },
  );
  const originalInsertAdjacentHtml = Element.prototype.insertAdjacentHTML;
  lockMethod(
    Element.prototype,
    "insertAdjacentHTML",
    function (position, markup) {
      assertMarkupAllowed(markup);
      return originalInsertAdjacentHtml.call(this, position, markup);
    },
  );
  for (const [target, property] of [
    [Element.prototype, "innerHTML"],
    [Element.prototype, "outerHTML"],
    [globalThis.ShadowRoot?.prototype, "innerHTML"],
  ]) {
    if (!target) continue;
    const descriptor = Object.getOwnPropertyDescriptor(target, property);
    if (!descriptor?.set) continue;
    Object.defineProperty(target, property, {
      ...descriptor,
      configurable: false,
      set(markup) {
        assertMarkupAllowed(markup);
        return descriptor.set.call(this, markup);
      },
    });
  }
  for (const name of ["write", "writeln"]) {
    const original = Document.prototype[name];
    lockMethod(Document.prototype, name, function (...markupParts) {
      assertMarkupAllowed(markupParts.join(""));
      return original.apply(this, markupParts);
    });
  }
  const originalParseFromString = DOMParser.prototype.parseFromString;
  lockMethod(DOMParser.prototype, "parseFromString", function (markup, type) {
    if (String(type).toLowerCase().includes("html")) {
      assertMarkupAllowed(markup);
    }
    return originalParseFromString.call(this, markup, type);
  });
  const originalCreateContextualFragment =
    Range.prototype.createContextualFragment;
  lockMethod(Range.prototype, "createContextualFragment", function (markup) {
    assertMarkupAllowed(markup);
    const fragment = originalCreateContextualFragment.call(this, markup);
    assertNodesAllowed([fragment]);
    return fragment;
  });
  const originalRangeInsertNode = Range.prototype.insertNode;
  lockMethod(Range.prototype, "insertNode", function (node) {
    assertNodesAllowed([node]);
    return originalRangeInsertNode.call(this, node);
  });
  for (const target of [Element.prototype, DocumentFragment.prototype]) {
    const originalMoveBefore = target.moveBefore;
    lockMethod(target, "moveBefore", function (node, referenceNode) {
      assertNodesAllowed([node]);
      return originalMoveBefore.call(this, node, referenceNode);
    });
  }
  for (const target of [Element.prototype, globalThis.ShadowRoot?.prototype]) {
    if (!target) continue;
    const originalSetHtmlUnsafe = target.setHTMLUnsafe;
    lockMethod(target, "setHTMLUnsafe", function (markup, ...options) {
      assertMarkupAllowed(markup);
      return originalSetHtmlUnsafe.call(this, markup, ...options);
    });
  }
  const originalDocumentParseHtmlUnsafe = globalThis.Document?.parseHTMLUnsafe;
  lockMethod(
    globalThis.Document,
    "parseHTMLUnsafe",
    function (markup, ...options) {
      assertMarkupAllowed(markup);
      const parsed = originalDocumentParseHtmlUnsafe.call(
        this,
        markup,
        ...options,
      );
      assertNodesAllowed([parsed]);
      return parsed;
    },
  );
  const originalExecCommand = Document.prototype.execCommand;
  lockMethod(
    Document.prototype,
    "execCommand",
    function (command, showUi, value) {
      if (String(command).toLowerCase() === "inserthtml") {
        assertMarkupAllowed(value);
      }
      return originalExecCommand.call(this, command, showUi, value);
    },
  );
  const attributeMutationRelevantNames = new Set([
    "href",
    "ping",
    "rel",
    "srcdoc",
    "type",
  ]);
  const validateAttributeMutation = ({ element, name, value }) => {
    const normalizedName = String(name || "")
      .split(":")
      .at(-1)
      .toLowerCase();
    if (!attributeMutationRelevantNames.has(normalizedName)) return;
    if (!(element instanceof Element)) return blockedOperation();
    if (
      (element instanceof HTMLLinkElement &&
        ((normalizedName === "rel" && hasBlockedRelToken(value)) ||
          (normalizedName === "href" && hasBlockedRelToken(element.rel)))) ||
      (element instanceof HTMLScriptElement &&
        normalizedName === "type" &&
        String(value).toLowerCase() === "speculationrules") ||
      (element instanceof HTMLAnchorElement &&
        normalizedName === "ping" &&
        Boolean(String(value))) ||
      (element instanceof HTMLIFrameElement && normalizedName === "srcdoc")
    ) {
      return blockedOperation();
    }
  };
  const originalSetAttribute = Element.prototype.setAttribute;
  lockMethod(Element.prototype, "setAttribute", function (name, value) {
    validateAttributeMutation({ element: this, name, value });
    return originalSetAttribute.call(this, name, value);
  });
  const originalSetAttributeNs = Element.prototype.setAttributeNS;
  lockMethod(
    Element.prototype,
    "setAttributeNS",
    function (namespace, name, value) {
      validateAttributeMutation({ element: this, name, value });
      return originalSetAttributeNs.call(this, namespace, name, value);
    },
  );
  for (const name of ["setAttributeNode", "setAttributeNodeNS"]) {
    const original = Element.prototype[name];
    lockMethod(Element.prototype, name, function (attribute) {
      if (!(attribute instanceof Attr)) return blockedOperation();
      validateAttributeMutation({
        element: this,
        name: attribute.localName || attribute.name,
        value: attribute.value,
      });
      return original.call(this, attribute);
    });
  }
  for (const name of ["setNamedItem", "setNamedItemNS"]) {
    const original = NamedNodeMap.prototype[name];
    lockMethod(NamedNodeMap.prototype, name, function (attribute) {
      if (!(attribute instanceof Attr)) return blockedOperation();
      validateAttributeMutation({
        element: attribute.ownerElement,
        name: attribute.localName || attribute.name,
        value: attribute.value,
      });
      return original.call(this, attribute);
    });
  }
  const lockAttrValueSetter = (target, property) => {
    const descriptor = Object.getOwnPropertyDescriptor(target, property);
    if (!descriptor?.set) return;
    Object.defineProperty(target, property, {
      ...descriptor,
      configurable: false,
      set(value) {
        if (this instanceof Attr) {
          validateAttributeMutation({
            element: this.ownerElement,
            name: this.localName || this.name,
            value,
          });
        }
        return descriptor.set.call(this, value);
      },
    });
  };
  lockAttrValueSetter(Attr.prototype, "value");
  lockAttrValueSetter(Node.prototype, "nodeValue");
  lockAttrValueSetter(Node.prototype, "textContent");
  const lockPropertySetter = (target, property, blocked) => {
    const descriptor = Object.getOwnPropertyDescriptor(target, property);
    if (!descriptor?.set) return;
    Object.defineProperty(target, property, {
      ...descriptor,
      configurable: false,
      set(value) {
        if (blocked.call(this, value)) return blockedOperation();
        return descriptor.set.call(this, value);
      },
    });
  };
  lockPropertySetter(HTMLLinkElement.prototype, "rel", (value) =>
    hasBlockedRelToken(value),
  );
  lockPropertySetter(HTMLLinkElement.prototype, "href", function () {
    return hasBlockedRelToken(this.rel);
  });
  lockPropertySetter(
    HTMLScriptElement.prototype,
    "type",
    (value) => String(value).toLowerCase() === "speculationrules",
  );
  lockPropertySetter(HTMLAnchorElement.prototype, "ping", (value) =>
    Boolean(String(value)),
  );
  lockPropertySetter(HTMLIFrameElement.prototype, "srcdoc", () => true);
  const originalAnchorClick = HTMLAnchorElement.prototype.click;
  Object.defineProperty(HTMLAnchorElement.prototype, "click", {
    configurable: false,
    writable: false,
    value() {
      if (this.ping) return blockedOperation();
      return originalAnchorClick.call(this);
    },
  });
  const originalDispatchEvent = EventTarget.prototype.dispatchEvent;
  Object.defineProperty(EventTarget.prototype, "dispatchEvent", {
    configurable: false,
    writable: false,
    value(event) {
      if (
        this instanceof HTMLAnchorElement &&
        this.ping &&
        String(event?.type).toLowerCase() === "click"
      ) {
        return blockedOperation();
      }
      return originalDispatchEvent.call(this, event);
    },
  });
};
const EXACT_PARSER_MODULEPRELOAD_TAG_PATTERN =
  /^<link rel="modulepreload" crossorigin href="(?<href>\/assets\/[A-Za-z0-9._-]+\.js)">$/u;
const VERCEL_PREVIEW_TOOLBAR_SCRIPT_URL =
  "https://vercel.live/_next-live/feedback/feedback.js";
const VERCEL_PREVIEW_TOOLBAR_SCRIPT_PATH = "/_next-live/feedback/feedback.js";
const FIXED_HTML_ATTRIBUTE_CHARACTER_REFERENCES = Object.freeze({
  AMP: "&",
  amp: "&",
  bsol: "\\",
  colon: ":",
  equals: "=",
  num: "#",
  period: ".",
  quest: "?",
  NewLine: "\n",
  sol: "/",
  Tab: "\t",
});
const decodeFixedHtmlAttributeCharacterReferences = (value) =>
  String(value).replace(
    /&(?:(?:#(?<decimal>[0-9]+)|#[xX](?<hex>[0-9A-Fa-f]+));?|(?<named>AMP|NewLine|Tab|amp|bsol|colon|equals|num|period|quest|sol);)/gu,
    (match, _numeric, _hexNumeric, _named, _offset, _input, groups) => {
      const numericValue = groups.decimal
        ? Number.parseInt(groups.decimal, 10)
        : groups.hex
          ? Number.parseInt(groups.hex, 16)
          : null;
      if (numericValue !== null) {
        return Number.isSafeInteger(numericValue) &&
          numericValue > 0 &&
          numericValue <= 0x10ffff &&
          !(numericValue >= 0xd800 && numericValue <= 0xdfff)
          ? String.fromCodePoint(numericValue)
          : match;
      }
      return (
        FIXED_HTML_ATTRIBUTE_CHARACTER_REFERENCES[groups.named || ""] ?? match
      );
    },
  );
const isVercelPreviewToolbarScriptSource = (value) => {
  const decodedValue = decodeFixedHtmlAttributeCharacterReferences(
    value,
  ).replace(/^[\t\n\f\r ]+|[\t\n\f\r ]+$/gu, "");
  try {
    const parsed = new URL(decodedValue, "https://w10p.invalid/");
    return parsed.pathname.toLowerCase() === VERCEL_PREVIEW_TOOLBAR_SCRIPT_PATH;
  } catch {
    return false;
  }
};
const scanHtmlOpeningTags = (markup) => {
  const source = String(markup);
  const lowerSource = source.toLowerCase();
  const tags = [];
  let index = 0;
  while (index < source.length) {
    if (source.startsWith("<!--", index)) {
      let commentEnd = source.length;
      for (let cursor = index + 4; cursor < source.length; cursor += 1) {
        if (cursor === index + 4 && source[cursor] === ">") {
          commentEnd = cursor + 1;
          break;
        }
        if (cursor === index + 4 && source.startsWith("->", cursor)) {
          commentEnd = cursor + 2;
          break;
        }
        if (source.startsWith("-->", cursor)) {
          commentEnd = cursor + 3;
          break;
        }
        if (source.startsWith("--!>", cursor)) {
          commentEnd = cursor + 4;
          break;
        }
      }
      index = commentEnd;
      continue;
    }
    if (source[index] !== "<" || !/[A-Za-z]/u.test(source[index + 1] || "")) {
      index += 1;
      continue;
    }
    let quote = null;
    let end = index + 1;
    for (; end < source.length; end += 1) {
      const character = source[end];
      if (quote !== null) {
        if (character === quote) quote = null;
        continue;
      }
      if (character === '"' || character === "'") {
        quote = character;
        continue;
      }
      if (character === ">") break;
    }
    if (end >= source.length) break;
    const tagMarkup = source.slice(index, end + 1);
    const tagName = tagMarkup.match(/^<([A-Za-z][^\s/>]*)/u)?.[1] || "";
    tags.push({ tagName: tagName.toLowerCase(), tagMarkup });
    index = end + 1;
    if (tagName.toLowerCase() === "script" && !/\/\s*>$/u.test(tagMarkup)) {
      const rawTextEnd = lowerSource.indexOf("</script", index);
      if (rawTextEnd < 0) break;
      const rawTextClose = source.indexOf(">", rawTextEnd + 8);
      index = rawTextClose < 0 ? source.length : rawTextClose + 1;
    }
  }
  return tags;
};
const parseHtmlOpeningTagAttributes = (tagMarkup) => {
  const tagStart = String(tagMarkup).match(/^<([A-Za-z][^\s/>]*)/u);
  assert.ok(tagStart);
  const attributes = new Map();
  let index = tagStart[0].length;
  while (index < tagMarkup.length) {
    while (/\s/u.test(tagMarkup[index] || "")) index += 1;
    if (tagMarkup[index] === ">") break;
    if (tagMarkup[index] === "/") {
      if (tagMarkup[index + 1] === ">") break;
      index += 1;
      continue;
    }
    const nameStart = index;
    while (index < tagMarkup.length && !/[\s=/>]/u.test(tagMarkup[index])) {
      index += 1;
    }
    if (index === nameStart) {
      index += 1;
      continue;
    }
    const name = tagMarkup.slice(nameStart, index).toLowerCase();
    while (/\s/u.test(tagMarkup[index] || "")) index += 1;
    let value = "";
    if (tagMarkup[index] === "=") {
      index += 1;
      while (/\s/u.test(tagMarkup[index] || "")) index += 1;
      const quote = ["'", '"'].includes(tagMarkup[index])
        ? tagMarkup[index]
        : null;
      if (quote !== null) {
        index += 1;
        const valueStart = index;
        while (index < tagMarkup.length && tagMarkup[index] !== quote) {
          index += 1;
        }
        value = tagMarkup.slice(valueStart, index);
        if (tagMarkup[index] === quote) index += 1;
      } else {
        const valueStart = index;
        while (index < tagMarkup.length && !/[\s>]/u.test(tagMarkup[index])) {
          index += 1;
        }
        value = tagMarkup.slice(valueStart, index);
      }
    }
    if (!attributes.has(name)) attributes.set(name, value);
  }
  return attributes;
};
const containsVercelPreviewToolbarMarkup = (bodyBytes) => {
  const markup = Buffer.isBuffer(bodyBytes)
    ? bodyBytes.toString("utf8")
    : String(bodyBytes);
  for (const { tagName, tagMarkup } of scanHtmlOpeningTags(markup)) {
    const attributes = parseHtmlOpeningTagAttributes(tagMarkup);
    if (attributes.has("data-vercel-toolbar")) return true;
    if (
      tagName === "script" &&
      attributes.has("src") &&
      isVercelPreviewToolbarScriptSource(attributes.get("src"))
    ) {
      return true;
    }
  }
  return false;
};
const createNodeOwnedVercelRequestHeaders = (protectionBypassSecret = "") => {
  const normalizedSecret = String(protectionBypassSecret);
  if (/[\r\n\0]/u.test(normalizedSecret)) {
    throw new Error("Invalid Vercel bypass secret header value.");
  }
  const headers = {
    "cache-control": "no-cache",
    "x-vercel-skip-toolbar": "1",
    ...(normalizedSecret
      ? { "x-vercel-protection-bypass": normalizedSecret }
      : {}),
  };
  assert.deepEqual(
    Object.keys(headers).sort(),
    [
      "cache-control",
      ...(normalizedSecret ? ["x-vercel-protection-bypass"] : []),
      "x-vercel-skip-toolbar",
    ].sort(),
  );
  return Object.freeze(headers);
};
const hasVercelSkipToolbarRequestHeader = (headers) =>
  Object.keys(headers || {}).some(
    (name) => name.toLowerCase() === "x-vercel-skip-toolbar",
  );
const immutableDocumentParserMarkupDecision = (
  bodyBytes,
  { allowExactInertTestFixture = false, documentOrigin = null } = {},
) => {
  let markup = Buffer.isBuffer(bodyBytes)
    ? bodyBytes.toString("utf8")
    : String(bodyBytes);
  if (allowExactInertTestFixture) {
    markup = markup.replace(
      /<template\s+id=["']w10p-inert-parser-fixtures["'][^>]*>[\s\S]*?<\/template\s*>/giu,
      "",
    );
  }
  if (/<base\b/iu.test(markup)) {
    return { valid: false, marker: "parser-base-url" };
  }
  for (const match of markup.matchAll(/<(link|script|a|iframe)\b[^>]*>/giu)) {
    const tagName = match[1].toLowerCase();
    const tagMarkup = match[0];
    if (tagName === "iframe" && /\bsrcdoc\s*(?:=|\s|>)/iu.test(tagMarkup)) {
      return { valid: false, marker: "parser-iframe-srcdoc" };
    }
    if (tagName === "a" && /\bping\s*(?:=|\s|>)/iu.test(tagMarkup)) {
      return { valid: false, marker: "parser-anchor-ping" };
    }
    if (tagName === "script") {
      const typeMatch = tagMarkup.match(
        /\btype\s*=\s*(?:(["'])(.*?)\1|([^\s>]+))/iu,
      );
      const typeValue = typeMatch?.[2] ?? typeMatch?.[3] ?? "";
      if (/&|speculationrules/iu.test(typeValue)) {
        return { valid: false, marker: "parser-speculation-rules" };
      }
    }
    if (tagName === "link") {
      const relMatch = tagMarkup.match(
        /\brel\s*=\s*(?:(["'])(.*?)\1|([^\s>]+))/iu,
      );
      const relValue = relMatch?.[2] ?? relMatch?.[3] ?? "";
      if (/&/u.test(relValue)) {
        return { valid: false, marker: "parser-speculative-link" };
      }
      const relTokens = relValue.toLowerCase().split(/\s+/u).filter(Boolean);
      const speculativeRelTokens = [
        "dns-prefetch",
        "modulepreload",
        "preconnect",
        "prefetch",
        "preload",
        "prerender",
      ];
      if (relTokens.some((token) => speculativeRelTokens.includes(token))) {
        const exactModulepreloadMatch = tagMarkup.match(
          EXACT_PARSER_MODULEPRELOAD_TAG_PATTERN,
        );
        let exactParserModulepreloadAllowed = false;
        if (
          relTokens.length === 1 &&
          relTokens[0] === "modulepreload" &&
          exactModulepreloadMatch?.groups?.href
        ) {
          try {
            const parsedDocumentOrigin = new URL(String(documentOrigin));
            const resolvedModulepreload = new URL(
              exactModulepreloadMatch.groups.href,
              parsedDocumentOrigin,
            );
            exactParserModulepreloadAllowed =
              parsedDocumentOrigin.protocol === "https:" &&
              parsedDocumentOrigin.username === "" &&
              parsedDocumentOrigin.password === "" &&
              ["", "443"].includes(parsedDocumentOrigin.port) &&
              parsedDocumentOrigin.pathname === "/" &&
              parsedDocumentOrigin.search === "" &&
              parsedDocumentOrigin.hash === "" &&
              resolvedModulepreload.origin === parsedDocumentOrigin.origin &&
              resolvedModulepreload.pathname ===
                exactModulepreloadMatch.groups.href &&
              resolvedModulepreload.search === "" &&
              resolvedModulepreload.hash === "";
          } catch {
            exactParserModulepreloadAllowed = false;
          }
        }
        if (exactParserModulepreloadAllowed) continue;
        return { valid: false, marker: "parser-speculative-link" };
      }
    }
  }
  return { valid: true, marker: null };
};
const PLAYWRIGHT_DEFAULT_DISABLED_FEATURES = [
  "AvoidUnnecessaryBeforeUnloadCheckSync",
  "BoundaryEventDispatchTracksNodeRemoval",
  "DestroyProfileOnBrowserClose",
  "DialMediaRouteProvider",
  "GlobalMediaControls",
  "HttpsUpgrades",
  "LensOverlay",
  "MediaRouter",
  "PaintHolding",
  "ThirdPartyStoragePartitioning",
  "BlockOriginHeaderModificationOnRedirect",
  "Translate",
  "AutoDeElevate",
  "OptimizationHints",
  "msForceBrowserSignIn",
  "msEdgeUpdateLaunchServicesPreferredVersion",
];
const CAPTURE_ADDITIONAL_DISABLED_FEATURES = [
  "EarlyHintsPreloadForNavigation",
  "PreconnectOnRedirect",
  "PreconnectToSearch",
  "Prerender2",
  "SpeculationRulesPrefetchFuture",
  "msSmartScreenBrowserDnsLookups",
  "msSmartScreenCertCollection",
  "msSmartScreenCollectFaviconUrls",
  "msSmartScreenEnableTelemetry",
  "msSmartScreenMultipleRedirectBlockPages",
  "msSmartScreenProtection",
  "msSmartScreenSendReferrerChain",
  "msSmartScreenSubResourceThrottle",
  "msSmartScreenSyncWcfCalls",
  "msSmartScreenUseEdgeNetworking",
  "msSmartScreenWebSocketThrottle",
  "msSmartScreenWebSocketThrottleBlock",
];
const BROWSER_EFFECTIVE_DISABLED_FEATURES = [
  ...new Set([
    ...PLAYWRIGHT_DEFAULT_DISABLED_FEATURES,
    ...CAPTURE_ADDITIONAL_DISABLED_FEATURES,
  ]),
].sort();
const PLAYWRIGHT_DEFAULT_DISABLE_FEATURES_ARGUMENT = `--disable-features=${PLAYWRIGHT_DEFAULT_DISABLED_FEATURES.join(",")}`;
const BROWSER_EFFECTIVE_DISABLE_FEATURES_ARGUMENT = `--disable-features=${BROWSER_EFFECTIVE_DISABLED_FEATURES.join(",")}`;
const BROWSER_PRETRANSMISSION_LAUNCH_ARGS = [
  "--disable-quic",
  "--disable-preconnect",
  "--dns-prefetch-disable",
  "--enable-automation",
  "--no-pings",
  BROWSER_EFFECTIVE_DISABLE_FEATURES_ARGUMENT,
];
const BROWSER_PRETRANSMISSION_IGNORE_DEFAULT_ARGS = [
  PLAYWRIGHT_DEFAULT_DISABLE_FEATURES_ARGUMENT,
];
const BROWSER_PRETRANSMISSION_REQUIRED_EFFECTIVE_ARGUMENTS = [
  "--disable-background-networking",
  "--disable-quic",
  "--disable-preconnect",
  "--dns-prefetch-disable",
  "--enable-automation",
  "--no-pings",
  BROWSER_EFFECTIVE_DISABLE_FEATURES_ARGUMENT,
].sort();
const BROWSER_PROXY_BYPASS_LIST_ARGUMENT = "--proxy-bypass-list=<-loopback>";
const attestBrowserPreTransmissionCommandLine = async (
  browser,
  { expectedProxyServerArgument },
) => {
  assert.match(
    expectedProxyServerArgument,
    /^--proxy-server=http:\/\/127\.0\.0\.1:\d+$/u,
  );
  const session = await browser.newBrowserCDPSession();
  let result;
  try {
    result = await session.send("Browser.getBrowserCommandLine");
  } finally {
    await session.detach();
  }
  const commandLineArguments = result.arguments || [];
  assert.equal(Array.isArray(commandLineArguments), true);
  const disableFeaturesArguments = commandLineArguments.filter((argument) =>
    argument.startsWith("--disable-features="),
  );
  assert.deepEqual(disableFeaturesArguments, [
    BROWSER_EFFECTIVE_DISABLE_FEATURES_ARGUMENT,
  ]);
  const effectiveDisabledFeatures = [
    ...new Set(
      disableFeaturesArguments[0]
        .slice("--disable-features=".length)
        .split(",")
        .filter(Boolean),
    ),
  ].sort();
  assert.deepEqual(
    effectiveDisabledFeatures,
    BROWSER_EFFECTIVE_DISABLED_FEATURES,
  );
  const requiredEffectiveArguments = [
    ...BROWSER_PRETRANSMISSION_REQUIRED_EFFECTIVE_ARGUMENTS,
    BROWSER_PROXY_BYPASS_LIST_ARGUMENT,
    expectedProxyServerArgument,
  ].sort();
  assert.equal(
    commandLineArguments.filter((argument) =>
      argument.startsWith("--proxy-server="),
    ).length,
    1,
  );
  assert.equal(
    commandLineArguments.filter((argument) =>
      argument.startsWith("--proxy-bypass-list="),
    ).length,
    1,
  );
  for (const argument of requiredEffectiveArguments) {
    assert.equal(
      commandLineArguments.filter((candidate) => candidate === argument).length,
      1,
      `effective browser argument must occur exactly once: ${argument}`,
    );
  }
  return {
    schemaVersion: 2,
    browserCommandLineQueryCount: 1,
    browserCommandLineArgumentCount: commandLineArguments.length,
    disableFeaturesSwitchCount: disableFeaturesArguments.length,
    effectiveDisabledFeatures,
    effectiveDisabledFeaturesHash: createHash("sha256")
      .update(JSON.stringify(effectiveDisabledFeatures), "utf8")
      .digest("hex"),
    requiredEffectiveArguments,
    requiredEffectiveArgumentsHash: createHash("sha256")
      .update(JSON.stringify(requiredEffectiveArguments), "utf8")
      .digest("hex"),
    requiredEffectiveArgumentDuplicateCount: 0,
    proxyServerSwitchCount: commandLineArguments.filter((argument) =>
      argument.startsWith("--proxy-server="),
    ).length,
    proxyBypassListSwitchCount: commandLineArguments.filter((argument) =>
      argument.startsWith("--proxy-bypass-list="),
    ).length,
    proxyServerArgumentSha256: secretSha256(expectedProxyServerArgument),
    proxyBypassListArgument: BROWSER_PROXY_BYPASS_LIST_ARGUMENT,
  };
};

const readJson = (path) => JSON.parse(readFileSync(resolve(path), "utf8"));
const contract = readJson("scripts/w10p-visual-parity-contract.json");
assert.equal(contract.schemaVersion, 12);
const BROWSER_CONNECT_PROXY_ALLOWED_FIREBASE_HOSTNAMES = [
  "content-firebaseappcheck.googleapis.com",
  "firebaseappcheck.googleapis.com",
  "firebasestorage.googleapis.com",
  "firestore.googleapis.com",
  "identitytoolkit.googleapis.com",
  "securetoken.googleapis.com",
  `asia-northeast3-${contract.firebaseProjectId}.cloudfunctions.net`,
  `${contract.firebaseProjectId}.firebaseapp.com`,
  `${contract.firebaseProjectId}.firebaseio.com`,
  `${contract.firebaseProjectId}.web.app`,
].sort();
const BROWSER_PRODUCT_BACKGROUND_DENY_HOSTNAMES = [
  "edge.microsoft.com",
  "www.bing.com",
].sort();
const BROWSER_CONNECT_PROXY_AUTHORIZED_REQUEST_METHODS = [
  "DELETE",
  "GET",
  "HEAD",
  "OPTIONS",
  "PATCH",
  "POST",
  "PUT",
];
const inventory = readJson("scripts/w10p-route-menu-inventory.json");
const args = process.argv.slice(2);
const APP_CHECK_DEBUG_TOKEN_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const JWT_PATTERN =
  /[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/u;
const APP_CHECK_JWT_SHAPE_PATTERN =
  /^[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}$/u;
const secretSha256 = (value) =>
  createHash("sha256").update(String(value), "utf8").digest("hex");
const canonicalNetworkHostname = (hostname) => {
  assert.equal(typeof hostname, "string");
  const lowercaseHostname = hostname.toLowerCase();
  if (lowercaseHostname.startsWith("[") && lowercaseHostname.endsWith("]")) {
    return lowercaseHostname;
  }
  return lowercaseHostname.replace(/\.+$/u, "");
};
const firebaseServiceForHost = (hostname) => {
  const canonicalHostname = canonicalNetworkHostname(hostname);
  if (
    canonicalHostname === "identitytoolkit.googleapis.com" ||
    canonicalHostname === "securetoken.googleapis.com"
  ) {
    return "auth";
  }
  if (
    canonicalHostname === "firebaseappcheck.googleapis.com" ||
    canonicalHostname === "content-firebaseappcheck.googleapis.com"
  ) {
    return "app-check";
  }
  if (canonicalHostname === "firestore.googleapis.com") return "firestore";
  if (canonicalHostname === "firebasestorage.googleapis.com") return "storage";
  if (canonicalHostname.endsWith(".cloudfunctions.net")) return "functions";
  if (
    canonicalHostname.endsWith(".firebaseio.com") ||
    canonicalHostname.endsWith(".firebasedatabase.app")
  ) {
    return "realtime-database";
  }
  if (
    canonicalHostname.endsWith(".firebaseapp.com") ||
    canonicalHostname.endsWith(".web.app")
  ) {
    return "hosting";
  }
  return null;
};
const safelyDecodeUrl = (value) => {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
};
const commonFirebaseApiHosts = new Set([
  "identitytoolkit.googleapis.com",
  "securetoken.googleapis.com",
  "firebaseappcheck.googleapis.com",
  "content-firebaseappcheck.googleapis.com",
]);
const extractApiKeyHeaderValues = (headers) =>
  Object.entries(headers || {})
    .filter(([name]) => name.toLowerCase() === "x-goog-api-key")
    .map(([, value]) => String(value));
const inspectNetworkBoundary = ({
  requestUrl,
  method = "GET",
  resourceType = "Fetch",
  apiKeyHeaderValues = [],
  stagingApiKey,
  allowedNonFirebaseOrigins,
}) => {
  assert.equal(typeof stagingApiKey, "string");
  assert.equal(Array.isArray(apiKeyHeaderValues), true);
  assert.equal(
    apiKeyHeaderValues.every((value) => typeof value === "string"),
    true,
  );
  const parsed = new URL(requestUrl);
  const hostname = parsed.hostname.toLowerCase();
  const canonicalHostname = canonicalNetworkHostname(hostname);
  const decodedValue = safelyDecodeUrl(requestUrl);
  const malformedUrlEncoding = decodedValue === null;
  const decoded = (decodedValue || "").toLowerCase();
  const decodedPathname = (
    safelyDecodeUrl(parsed.pathname) || ""
  ).toLowerCase();
  const observedProjectIds = new Set();
  const firebaseService = firebaseServiceForHost(canonicalHostname);
  const isFirebaseRequest = Boolean(firebaseService);
  const apiKeyValues = isFirebaseRequest
    ? [...parsed.searchParams.getAll("key"), ...apiKeyHeaderValues]
    : [];
  const apiKeyBindingValid =
    apiKeyValues.length === 1 && apiKeyValues[0] === stagingApiKey;
  const apiKeySha256 =
    apiKeyValues.length === 1 ? secretSha256(apiKeyValues[0]) : null;
  const firebaseTransportValid =
    !isFirebaseRequest ||
    (parsed.protocol === "https:" &&
      parsed.username === "" &&
      parsed.password === "" &&
      (parsed.port === "" || parsed.port === "443"));
  let serviceResourceBound = false;
  if (firebaseService === "auth") {
    serviceResourceBound = apiKeyBindingValid;
  } else if (firebaseService === "app-check") {
    const appCheckResourceMatch = decodedPathname.match(
      /^\/v1\/projects\/([^/]+)\/apps\/(.+):([a-z0-9]+)$/u,
    );
    const appCheckProject = appCheckResourceMatch?.[1] || "";
    const appCheckAppId = appCheckResourceMatch?.[2] || "";
    const exactAppCheckProject =
      appCheckProject === contract.firebaseProjectId.toLowerCase() ||
      appCheckProject === STAGING_PROJECT_NUMBER;
    serviceResourceBound =
      apiKeyBindingValid &&
      exactAppCheckProject &&
      appCheckAppId === STAGING_APP_ID.toLowerCase();
    if (exactAppCheckProject) {
      observedProjectIds.add(contract.firebaseProjectId.toLowerCase());
    } else if (appCheckProject) {
      observedProjectIds.add(appCheckProject);
    }
  } else if (firebaseService === "firestore") {
    const firestoreProjects = [];
    for (const match of decodedPathname.matchAll(
      /\/projects\/([^/]+)\/databases\//gu,
    )) {
      firestoreProjects.push(match[1]);
    }
    for (const database of parsed.searchParams.getAll("database")) {
      const databaseValue = (safelyDecodeUrl(database) || "").toLowerCase();
      const match = databaseValue.match(/^projects\/([^/]+)\/databases\//u);
      if (match) firestoreProjects.push(match[1]);
    }
    for (const projectId of firestoreProjects) {
      observedProjectIds.add(projectId);
    }
    serviceResourceBound =
      firestoreProjects.length > 0 &&
      firestoreProjects.every(
        (projectId) => projectId === contract.firebaseProjectId.toLowerCase(),
      );
  } else if (firebaseService === "storage") {
    const storageResourceMatch = decodedPathname.match(
      /^\/v0\/b\/([^/]+)\/o(?:\/|$)/u,
    );
    const storageBucket = storageResourceMatch?.[1] || "";
    const storageProject = storageBucket.replace(
      /\.(?:appspot\.com|firebasestorage\.app)$/u,
      "",
    );
    if (storageProject) observedProjectIds.add(storageProject);
    serviceResourceBound =
      storageProject === contract.firebaseProjectId.toLowerCase() &&
      [
        `${contract.firebaseProjectId.toLowerCase()}.appspot.com`,
        `${contract.firebaseProjectId.toLowerCase()}.firebasestorage.app`,
      ].includes(storageBucket);
  } else if (firebaseService === "functions") {
    const expectedHostname = `asia-northeast3-${contract.firebaseProjectId.toLowerCase()}.cloudfunctions.net`;
    serviceResourceBound = canonicalHostname === expectedHostname;
    const functionsProjectMatch = canonicalHostname.match(
      /^asia-northeast3-(.+)\.cloudfunctions\.net$/u,
    );
    if (functionsProjectMatch) observedProjectIds.add(functionsProjectMatch[1]);
  } else if (firebaseService === "realtime-database") {
    const realtimeProjectMatch = canonicalHostname.match(
      /^([a-z0-9-]+)\.firebaseio\.com$/u,
    );
    if (realtimeProjectMatch) observedProjectIds.add(realtimeProjectMatch[1]);
    serviceResourceBound =
      realtimeProjectMatch?.[1] === contract.firebaseProjectId.toLowerCase();
  } else if (firebaseService === "hosting") {
    const hostingProjectMatch = canonicalHostname.match(
      /^([a-z0-9-]+)\.(?:firebaseapp\.com|web\.app)$/u,
    );
    if (hostingProjectMatch) observedProjectIds.add(hostingProjectMatch[1]);
    serviceResourceBound =
      hostingProjectMatch?.[1] === contract.firebaseProjectId.toLowerCase();
  }
  const nonFirebaseHostnameAllowed = isNonFirebaseHostnameAllowed({
    requestUrl,
    method,
    resourceType,
    isFirebaseRequest,
    allowedOrigins: allowedNonFirebaseOrigins,
  });
  const nonFirebaseRuleId = nonFirebasePolicyRuleId({
    requestUrl,
    method,
    resourceType,
    isFirebaseRequest,
    allowedOrigins: allowedNonFirebaseOrigins,
  });
  assert.equal(nonFirebaseHostnameAllowed, nonFirebaseRuleId !== null);
  const productionMarker =
    contract.networkBoundary.forbiddenWebHosts.includes(canonicalHostname) ||
    contract.networkBoundary.forbiddenFirebaseProjectIds.some(
      (projectId) =>
        decoded.includes(projectId.toLowerCase()) ||
        observedProjectIds.has(projectId.toLowerCase()),
    );
  const commonFirebaseApiHost = commonFirebaseApiHosts.has(canonicalHostname);
  const optionalApiKeyBindingValid =
    apiKeyValues.length === 0 || apiKeyBindingValid;
  const stagingMarker =
    isFirebaseRequest &&
    !productionMarker &&
    !malformedUrlEncoding &&
    firebaseTransportValid &&
    serviceResourceBound &&
    (commonFirebaseApiHost ? apiKeyBindingValid : optionalApiKeyBindingValid);
  const unboundFirebaseRequest =
    isFirebaseRequest && !stagingMarker && !productionMarker;

  return {
    hostname,
    canonicalHostname,
    firebaseService,
    isFirebaseRequest,
    nonFirebaseHostnameAllowed,
    nonFirebasePolicyRuleId: nonFirebaseRuleId,
    stagingMarker,
    productionMarker,
    unboundFirebaseRequest,
    malformedUrlEncoding,
    apiKeySha256,
    apiKeyValueCount: apiKeyValues.length,
    apiKeyBindingValid,
    firebaseTransportValid,
    serviceResourceBound,
    observedProjectIds: [...observedProjectIds].sort(),
  };
};
const FIXTURE_AUDIT_FRESHNESS_KEYS = [
  "issuedAt",
  "expiresAt",
  "maxAgeSeconds",
  "fixedFixtureTime",
].sort();
const assertFixtureAuditFreshnessBinding = ({
  freshness,
  captureBindingFreshness,
  expectedFixedTime,
}) => {
  assert.ok(freshness && typeof freshness === "object");
  assert.equal(Array.isArray(freshness), false);
  assert.deepEqual(
    Object.keys(freshness).sort(),
    FIXTURE_AUDIT_FRESHNESS_KEYS,
    "The fixture audit freshness schema drifted.",
  );
  assert.deepEqual(
    captureBindingFreshness,
    freshness,
    "The fixture audit freshness is not exactly bound to captureBinding.",
  );
  const issuedAt = Date.parse(freshness.issuedAt);
  const expiresAt = Date.parse(freshness.expiresAt);
  assert.equal(Number.isNaN(issuedAt), false);
  assert.equal(Number.isNaN(expiresAt), false);
  assert.equal(new Date(issuedAt).toISOString(), freshness.issuedAt);
  assert.equal(new Date(expiresAt).toISOString(), freshness.expiresAt);
  assert.equal(freshness.maxAgeSeconds, 3600);
  assert.equal(freshness.fixedFixtureTime, expectedFixedTime);
  assert.equal(
    expiresAt - issuedAt,
    3600 * 1000,
    "The fixture audit freshness window must be exactly one hour.",
  );
  return { issuedAt, expiresAt };
};
const PRE_TRANSMISSION_NETWORK_BOUNDARY_ATTESTATION = {
  schemaVersion: 8,
  interceptionStage: "cdp-fetch-request-stage",
  inspectionFunction: "inspectNetworkRequest",
  blockedMarkers: [
    "production",
    "cross-origin-document",
    "unbound-firebase",
    "non-firebase-hostname-not-allowlisted",
    "malformed-url-encoding",
  ],
  nonFirebaseHostnameAllowlist:
    contract.networkBoundary.nonFirebaseHostnameAllowlist,
  hostnameCanonicalization: contract.networkBoundary.hostnameCanonicalization,
  firebaseRequestBinding: contract.networkBoundary.firebaseRequestBinding,
  executionTargetBoundary: contract.networkBoundary.executionTargetBoundary,
  networkResponseBoundary: contract.networkBoundary.networkResponseBoundary,
  browserConnectProxy: contract.networkBoundary.browserConnectProxy,
  requestBodyResolver: "resolvePausedRequestPostData",
  requestBodyMaximumBytes:
    contract.networkBoundary.executionTargetBoundary.requestBodyMaximumBytes,
  blockMechanism: "Fetch.failRequest",
  blockErrorReason: "BlockedByClient",
  ordering:
    "after-single-full-request-body-resolution-before-sensitive-scan-telemetry-deterministic-external-or-secret-mutation",
};
const preTransmissionBoundaryDecision = ({
  productionMarker,
  unboundFirebaseRequest,
  isFirebaseRequest,
  nonFirebaseHostnameAllowed,
  malformedUrlEncoding = false,
  crossOriginDocument = false,
}) => {
  assert.equal(typeof productionMarker, "boolean");
  assert.equal(typeof unboundFirebaseRequest, "boolean");
  assert.equal(typeof isFirebaseRequest, "boolean");
  assert.equal(typeof nonFirebaseHostnameAllowed, "boolean");
  assert.equal(typeof malformedUrlEncoding, "boolean");
  assert.equal(typeof crossOriginDocument, "boolean");
  if (malformedUrlEncoding) {
    return { block: true, marker: "malformed-url-encoding" };
  }
  if (productionMarker) {
    return { block: true, marker: "production" };
  }
  if (crossOriginDocument) {
    return { block: true, marker: "cross-origin-document" };
  }
  if (unboundFirebaseRequest) {
    return { block: true, marker: "unbound-firebase" };
  }
  if (!isFirebaseRequest && !nonFirebaseHostnameAllowed) {
    return {
      block: true,
      marker: "non-firebase-hostname-not-allowlisted",
    };
  }
  return { block: false, marker: null };
};
const exactOriginTransportAllowed = ({
  value,
  allowedOrigins,
  transportContract,
}) => {
  let parsed;
  try {
    parsed = new URL(value);
  } catch (_error) {
    return false;
  }
  return (
    parsed.protocol === transportContract.requiredProtocol &&
    (transportContract.userinfoAllowed ||
      (!parsed.username && !parsed.password)) &&
    transportContract.allowedPorts.includes(parsed.port) &&
    allowedOrigins.includes(parsed.origin)
  );
};
const redirectResponseMustAbort = (status) => {
  const normalizedStatus = Number(status || 0);
  return normalizedStatus >= 300 && normalizedStatus < 400;
};
const isInformationalResponseStatus = (status) => {
  const normalizedStatus = Number(status || 0);
  return normalizedStatus >= 100 && normalizedStatus < 200;
};
const responseStageCorrelationDecision = ({
  responseStatusCode,
  responseErrorReason,
}) => {
  if (responseErrorReason !== undefined) {
    return { kind: "response-error", status: null, terminal: true };
  }
  const status = Number(responseStatusCode || 0);
  if (isInformationalResponseStatus(status)) {
    return { kind: "informational", status, terminal: false };
  }
  if (status < 200) {
    return { kind: "invalid-pre-final", status, terminal: true };
  }
  return { kind: "final", status, terminal: true };
};
const allowedEgressRequestInvariantForEvent = (event) => {
  const request = event?.request;
  if (
    !request ||
    typeof request !== "object" ||
    typeof request.url !== "string" ||
    request.url.length === 0 ||
    typeof request.method !== "string" ||
    request.method.length === 0 ||
    typeof event.resourceType !== "string" ||
    event.resourceType.length === 0 ||
    (event.frameId !== undefined &&
      (typeof event.frameId !== "string" || event.frameId.length === 0)) ||
    (event.networkId !== undefined &&
      (typeof event.networkId !== "string" || event.networkId.length === 0))
  ) {
    return null;
  }
  return Object.freeze({
    url: request.url,
    method: request.method,
    resourceType: event.resourceType,
    frameId: event.frameId ?? null,
    networkId: event.networkId ?? null,
  });
};
const allowedEgressRequestInvariantsEqual = (left, right) =>
  left !== null &&
  right !== null &&
  left.url === right.url &&
  left.method === right.method &&
  left.resourceType === right.resourceType &&
  left.frameId === right.frameId &&
  left.networkId === right.networkId;
const activeAllowedEgressResponseCorrelationStates = new Set([
  "request-continue-in-flight",
  "response-awaiting",
  "final-response-command-in-flight",
  "final-response-released",
  "post-final-error-command-in-flight",
]);
const resolveAllowedEgressResponseCorrelation = ({
  event,
  lifecycleByFetchRequestId,
  fetchRequestIdsByNetworkId,
}) => {
  assert.ok(lifecycleByFetchRequestId instanceof Map);
  assert.ok(fetchRequestIdsByNetworkId instanceof Map);
  const currentRequestId =
    typeof event?.requestId === "string" && event.requestId.length > 0
      ? event.requestId
      : null;
  const currentInvariant = allowedEgressRequestInvariantForEvent(event);
  if (currentRequestId === null || currentInvariant === null) {
    return Object.freeze({
      valid: false,
      reason: "response-correlation-request-invariant-invalid",
      source: null,
      primaryRequestId: null,
      lifecycle: null,
    });
  }
  const directLifecycle =
    lifecycleByFetchRequestId.get(currentRequestId) || null;
  if (directLifecycle !== null) {
    const invariantMatch = allowedEgressRequestInvariantsEqual(
      directLifecycle.requestInvariant,
      currentInvariant,
    );
    return Object.freeze({
      valid: invariantMatch,
      reason: invariantMatch
        ? null
        : "response-correlation-request-invariant-mismatch",
      source: "same-fetch",
      primaryRequestId: directLifecycle.primaryRequestId,
      lifecycle: directLifecycle,
    });
  }
  if (currentInvariant.networkId === null) {
    return Object.freeze({
      valid: false,
      reason: "response-correlation-network-id-missing",
      source: null,
      primaryRequestId: null,
      lifecycle: null,
    });
  }
  const aliasLifecycles = [
    ...(fetchRequestIdsByNetworkId.get(currentInvariant.networkId) || []),
  ]
    .filter((requestId) => requestId !== currentRequestId)
    .map((requestId) => lifecycleByFetchRequestId.get(requestId) || null)
    .filter((lifecycle) => lifecycle !== null);
  const activeAliasLifecycles = aliasLifecycles.filter(({ state }) =>
    activeAllowedEgressResponseCorrelationStates.has(state),
  );
  if (activeAliasLifecycles.length !== 1) {
    const singleRetiredAlias =
      activeAliasLifecycles.length === 0 && aliasLifecycles.length === 1
        ? aliasLifecycles[0]
        : null;
    return Object.freeze({
      valid: false,
      reason:
        activeAliasLifecycles.length > 1 || aliasLifecycles.length > 1
          ? "response-correlation-same-network-ambiguous"
          : singleRetiredAlias
            ? "response-correlation-same-network-single-retired-alias"
            : "response-correlation-network-id-unseen",
      source: singleRetiredAlias ? "same-network-single-alias" : null,
      primaryRequestId: singleRetiredAlias?.primaryRequestId || null,
      lifecycle: singleRetiredAlias,
    });
  }
  const lifecycle = activeAliasLifecycles[0];
  const invariantMatch = allowedEgressRequestInvariantsEqual(
    lifecycle.requestInvariant,
    currentInvariant,
  );
  return Object.freeze({
    valid: invariantMatch,
    reason: invariantMatch
      ? null
      : "response-correlation-request-invariant-mismatch",
    source: "same-network-single-alias",
    primaryRequestId: lifecycle.primaryRequestId,
    lifecycle,
  });
};
const allowedEgressResponseLifecycleDecision = ({
  lifecycleState,
  responseStageDecision,
}) => {
  assert.equal(typeof lifecycleState, "string");
  assert.ok(responseStageDecision && typeof responseStageDecision === "object");
  if (lifecycleState === "final-response-released") {
    return responseStageDecision.kind === "response-error"
      ? Object.freeze({
          valid: true,
          kind: "post-final-error",
          reason: null,
        })
      : Object.freeze({
          valid: false,
          kind: "reject",
          reason: "response-correlation-final-released-invalid-transition",
        });
  }
  if (lifecycleState === "response-awaiting") {
    return Object.freeze({ valid: true, kind: "primary", reason: null });
  }
  return Object.freeze({
    valid: false,
    kind: "reject",
    reason: "response-correlation-lifecycle-transition-invalid",
  });
};
const postFinalErrorContinueResponseParams = (requestId) => {
  assert.equal(typeof requestId, "string");
  assert.ok(requestId.length > 0);
  return Object.freeze({ requestId });
};
const POST_FINAL_ALREADY_RETIRED_INTERCEPTION_ERROR_MESSAGES = new Set([
  "Protocol error (Fetch.continueResponse): Invalid InterceptionId.",
  "cdpSession.send: Protocol error (Fetch.continueResponse): Invalid InterceptionId.",
]);
const isPostFinalAlreadyRetiredInterceptionError = (error) =>
  error instanceof Error &&
  ["Error", "ProtocolError"].includes(error.name) &&
  POST_FINAL_ALREADY_RETIRED_INTERCEPTION_ERROR_MESSAGES.has(error.message);
const createPerCorrelationTaskCoordinator = () => {
  const tailsByCorrelation = new Map();
  return Object.freeze({
    enqueue(correlationId, task) {
      assert.equal(typeof correlationId, "string");
      assert.ok(correlationId.length > 0);
      assert.equal(typeof task, "function");
      const previous =
        tailsByCorrelation.get(correlationId) || Promise.resolve();
      const run = previous.catch(() => undefined).then(task);
      let settled;
      settled = run.finally(() => {
        if (tailsByCorrelation.get(correlationId) === settled) {
          tailsByCorrelation.delete(correlationId);
        }
      });
      tailsByCorrelation.set(correlationId, settled);
      return settled;
    },
    pendingCount() {
      return tailsByCorrelation.size;
    },
  });
};
const createSingleOwnerProxyAuthorizationCoordinator = ({
  onAuthorize,
  onComplete,
  onRevoke,
}) => {
  assert.equal(typeof onAuthorize, "function");
  assert.equal(typeof onComplete, "function");
  assert.equal(typeof onRevoke, "function");
  const statesByOwner = new Map();
  const transitionActiveOwner = (
    ownerId,
    inFlightState,
    finalState,
    action,
  ) => {
    assert.equal(typeof ownerId, "string");
    assert.ok(ownerId.length > 0);
    if (statesByOwner.get(ownerId) !== "active") return false;
    statesByOwner.set(ownerId, inFlightState);
    try {
      action(ownerId);
      statesByOwner.set(ownerId, finalState);
      return true;
    } catch (error) {
      statesByOwner.set(ownerId, "active");
      throw error;
    }
  };
  return Object.freeze({
    authorize(ownerId, authorization) {
      assert.equal(typeof ownerId, "string");
      assert.ok(ownerId.length > 0);
      assert.equal(statesByOwner.has(ownerId), false);
      onAuthorize(ownerId, authorization);
      statesByOwner.set(ownerId, "active");
    },
    complete(ownerId) {
      return transitionActiveOwner(
        ownerId,
        "complete-in-flight",
        "completed",
        onComplete,
      );
    },
    revoke(ownerId) {
      return transitionActiveOwner(
        ownerId,
        "revoke-in-flight",
        "revoked",
        onRevoke,
      );
    },
    stateFor(ownerId) {
      return statesByOwner.get(ownerId) || null;
    },
    activeCount() {
      return [...statesByOwner.values()].filter((state) => state === "active")
        .length;
    },
  });
};
const retiredAllowedEgressLifecycleStates = new Set([
  "request-continue-failed",
  "terminal-command-in-flight",
  "terminal-complete",
  "post-final-error-observed-retired",
  "redirect-retired",
  "handler-failed",
]);
const missingResponseCorrelationFailureReason = ({
  sameFetchState = null,
  networkIdPresent,
  networkAliasStates = [],
}) => {
  if (sameFetchState === "terminal-command-in-flight") {
    return "response-correlation-same-fetch-terminal-in-flight";
  }
  if (sameFetchState === "terminal-complete") {
    return "response-correlation-same-fetch-terminal-complete";
  }
  if (sameFetchState !== null) {
    return retiredAllowedEgressLifecycleStates.has(sameFetchState)
      ? "response-correlation-same-fetch-other-retired"
      : "response-correlation-same-fetch-active";
  }
  if (!networkIdPresent) {
    return "response-correlation-network-id-missing";
  }
  if (networkAliasStates.length === 0) {
    return "response-correlation-network-id-unseen";
  }
  if (networkAliasStates.length !== 1) {
    return "response-correlation-same-network-ambiguous";
  }
  return retiredAllowedEgressLifecycleStates.has(networkAliasStates[0])
    ? "response-correlation-same-network-single-retired-alias"
    : "response-correlation-same-network-single-active-alias";
};
const FETCH_INLINE_POST_DATA_LIMIT_BYTES = 64 * 1024;
const MAX_RESOLVED_REQUEST_POST_DATA_BYTES = 8 * 1024 * 1024;
class PausedRequestPostDataResolutionError extends Error {
  constructor(code, message, options = undefined) {
    super(message, options);
    this.name = "PausedRequestPostDataResolutionError";
    this.code = code;
  }
}
const postDataEntriesBytes = (postDataEntries) => {
  if (postDataEntries === undefined) return null;
  if (!Array.isArray(postDataEntries)) {
    throw new PausedRequestPostDataResolutionError(
      "representation-mismatch",
      "Fetch postDataEntries was not an array.",
    );
  }
  const chunks = postDataEntries.map((entry) => {
    if (!entry || typeof entry.bytes !== "string") {
      throw new PausedRequestPostDataResolutionError(
        "representation-mismatch",
        "Fetch postDataEntries contained a non-byte entry.",
      );
    }
    return Buffer.from(entry.bytes, "base64");
  });
  return Buffer.concat(chunks);
};
const resolvePausedRequestPostData = async ({
  event,
  send,
  maximumBytes = MAX_RESOLVED_REQUEST_POST_DATA_BYTES,
}) => {
  assert.equal(typeof send, "function");
  assert.ok(Number.isSafeInteger(maximumBytes) && maximumBytes > 0);
  const request = event?.request;
  if (!request || typeof request !== "object") {
    throw new PausedRequestPostDataResolutionError(
      "representation-mismatch",
      "Fetch.requestPaused did not include a request object.",
    );
  }
  const entryBytes = postDataEntriesBytes(request.postDataEntries);
  const inlinePostDataPresent = typeof request.postData === "string";
  if (request.postData !== undefined && !inlinePostDataPresent) {
    throw new PausedRequestPostDataResolutionError(
      "representation-mismatch",
      "Fetch postData was present but was not a string.",
    );
  }
  let postData;
  let source;
  if (inlinePostDataPresent) {
    postData = request.postData;
    source = "fetch-inline";
    if (request.hasPostData === false && Buffer.byteLength(postData) > 0) {
      throw new PausedRequestPostDataResolutionError(
        "representation-mismatch",
        "Fetch postData contradicted hasPostData=false.",
      );
    }
  } else if (request.hasPostData === true) {
    if (typeof event.networkId !== "string" || event.networkId.length === 0) {
      throw new PausedRequestPostDataResolutionError(
        "missing-network-id",
        "A paused request with omitted POST data had no Network request id.",
      );
    }
    let networkBody;
    try {
      networkBody = await send("Network.getRequestPostData", {
        requestId: event.networkId,
      });
    } catch (error) {
      throw new PausedRequestPostDataResolutionError(
        "network-read-failed",
        "Network.getRequestPostData failed for an omitted POST body.",
        { cause: error },
      );
    }
    if (!networkBody || typeof networkBody.postData !== "string") {
      throw new PausedRequestPostDataResolutionError(
        "representation-mismatch",
        "Network.getRequestPostData did not return a string body.",
      );
    }
    postData = networkBody.postData;
    source = "network-domain";
  } else {
    if (entryBytes && entryBytes.length > 0) {
      throw new PausedRequestPostDataResolutionError(
        "representation-mismatch",
        "Fetch postDataEntries contradicted an absent POST body.",
      );
    }
    postData = "";
    source = "absent";
  }
  const postDataBytes = Buffer.from(postData, "utf8");
  if (postDataBytes.length > maximumBytes) {
    throw new PausedRequestPostDataResolutionError(
      "maximum-bytes-exceeded",
      `Resolved POST body exceeded ${maximumBytes} bytes.`,
    );
  }
  if (entryBytes && !entryBytes.equals(postDataBytes)) {
    throw new PausedRequestPostDataResolutionError(
      "representation-mismatch",
      "Fetch and Network POST body representations differed.",
    );
  }
  return {
    postData,
    postDataBytes: postDataBytes.length,
    source,
  };
};
const BROWSER_RESPONSE_HEADER_ALLOWLIST = new Set([
  "accept-ranges",
  "access-control-allow-credentials",
  "access-control-allow-headers",
  "access-control-allow-methods",
  "access-control-allow-origin",
  "access-control-expose-headers",
  "access-control-max-age",
  "cache-control",
  "content-disposition",
  "content-encoding",
  "content-language",
  "content-length",
  "content-range",
  "content-type",
  "cross-origin-embedder-policy",
  "cross-origin-opener-policy",
  "cross-origin-resource-policy",
  "date",
  "etag",
  "expires",
  "grpc-message",
  "grpc-status",
  "last-modified",
  "server-timing",
  "timing-allow-origin",
  "vary",
  "x-firebase-locale",
  "x-goog-generation",
  "x-goog-hash",
  "x-goog-metageneration",
  "x-goog-storage-class",
  "x-goog-stored-content-encoding",
  "x-goog-stored-content-length",
  "x-guploader-uploadid",
]);
const FIRESTORE_WEBCHANNEL_SESSION_RESPONSE_RULE_ID =
  "staging-firestore-webchannel-session";
const FIRESTORE_WEBCHANNEL_SESSION_RESPONSE_HEADER_NAME = "x-http-session-id";
const FIRESTORE_WEBCHANNEL_PATHNAMES = new Set([
  "/google.firestore.v1.Firestore/Listen/channel",
  "/google.firestore.v1.Firestore/Write/channel",
]);
const FIRESTORE_WEBCHANNEL_INITIAL_QUERY_NAMES = [
  "CVER",
  "RID",
  "VER",
  "X-HTTP-Session-Id",
  "database",
  "t",
  "zx",
].sort();
const BROWSER_EGRESS_CAPABLE_RESPONSE_HEADER_NAMES = new Set([
  "alt-svc",
  "clear-site-data",
  "content-security-policy",
  "content-security-policy-report-only",
  "link",
  "location",
  "nel",
  "refresh",
  "report-to",
  "reporting-endpoints",
  "set-cookie",
  "speculation-rules",
  "x-dns-prefetch-control",
]);
const sanitizeBrowserResponseHeaders = (
  responseHeaders = [],
  { conditionalResponseHeaderRuleId = null, onDiagnosticCheck = null } = {},
) => {
  assert.ok(
    onDiagnosticCheck === null || typeof onDiagnosticCheck === "function",
  );
  onDiagnosticCheck?.("response-header-collection-invalid");
  assert.equal(Array.isArray(responseHeaders), true);
  onDiagnosticCheck?.("response-rule-id-invalid");
  assert.ok(
    conditionalResponseHeaderRuleId === null ||
      conditionalResponseHeaderRuleId ===
        FIRESTORE_WEBCHANNEL_SESSION_RESPONSE_RULE_ID,
  );
  const conditionalSessionHeaders = responseHeaders.filter(
    (header) =>
      String(header?.name || "").toLowerCase() ===
      FIRESTORE_WEBCHANNEL_SESSION_RESPONSE_HEADER_NAME,
  );
  if (conditionalResponseHeaderRuleId !== null) {
    onDiagnosticCheck?.("response-session-header-duplicate");
    assert.ok(conditionalSessionHeaders.length <= 1);
  }
  const sanitizedHeaders = [];
  const observedEgressHeaderNames = [];
  let omittedHeaderCount = 0;
  let conditionalHeaderForwardCount = 0;
  for (const header of responseHeaders) {
    const name = String(header?.name || "").toLowerCase();
    const value = String(header?.value ?? "");
    onDiagnosticCheck?.("response-header-name-invalid");
    assert.match(name, /^[!#$%&'*+.^_`|~0-9a-z-]+$/u);
    onDiagnosticCheck?.("response-header-value-invalid");
    assert.doesNotMatch(value, /[\r\n\0]/u);
    if (BROWSER_EGRESS_CAPABLE_RESPONSE_HEADER_NAMES.has(name)) {
      observedEgressHeaderNames.push(name);
      omittedHeaderCount += 1;
      continue;
    }
    if (name === FIRESTORE_WEBCHANNEL_SESSION_RESPONSE_HEADER_NAME) {
      if (
        conditionalResponseHeaderRuleId !==
        FIRESTORE_WEBCHANNEL_SESSION_RESPONSE_RULE_ID
      ) {
        omittedHeaderCount += 1;
        continue;
      }
      onDiagnosticCheck?.("response-session-header-value-invalid");
      assert.match(value, /^[\x21-\x7e]+$/u);
      onDiagnosticCheck?.("response-session-header-value-too-large");
      assert.ok(Buffer.byteLength(value, "utf8") <= 1024);
      sanitizedHeaders.push({ name, value });
      conditionalHeaderForwardCount += 1;
      continue;
    }
    if (!BROWSER_RESPONSE_HEADER_ALLOWLIST.has(name)) {
      omittedHeaderCount += 1;
      continue;
    }
    sanitizedHeaders.push({ name, value });
  }
  return {
    responseHeaders: sanitizedHeaders,
    observedEgressHeaderNames,
    egressHeaderObservationCount: observedEgressHeaderNames.length,
    omittedHeaderCount,
    conditionalHeaderForwardCount,
  };
};
const NODE_OWNED_EXTERNAL_STATIC_RESPONSE_HEADER_MAXIMUM_BYTES = 64 * 1024;
const NODE_OWNED_EXTERNAL_STATIC_RESPONSE_BODY_MAXIMUM_BYTES = 16 * 1024 * 1024;
const NODE_OWNED_EXTERNAL_STATIC_TIMEOUT_MILLISECONDS = 30_000;
const NODE_OWNED_EXTERNAL_STATIC_REQUEST_HEADERS = Object.freeze({
  accept: "*/*",
  "accept-encoding": "identity",
  "cache-control": "no-cache, no-store, max-age=0",
  pragma: "no-cache",
});
const NODE_OWNED_EXTERNAL_STATIC_RESPONSE_HEADER_ALLOWLIST = new Set([
  "access-control-allow-origin",
  "cache-control",
  "content-language",
  "content-type",
  "cross-origin-resource-policy",
  "etag",
  "last-modified",
  "timing-allow-origin",
]);
const NODE_OWNED_EXTERNAL_STATIC_REQUEST_CONTRACT = Object.freeze({
  schemaVersion: 1,
  method: "GET",
  headers: NODE_OWNED_EXTERNAL_STATIC_REQUEST_HEADERS,
  redirectPolicy: "manual-no-follow-exact-200",
  contentEncodingPolicy: "absent-or-identity",
  timeoutMilliseconds: NODE_OWNED_EXTERNAL_STATIC_TIMEOUT_MILLISECONDS,
  responseHeaderMaximumBytes:
    NODE_OWNED_EXTERNAL_STATIC_RESPONSE_HEADER_MAXIMUM_BYTES,
  responseBodyMaximumBytes:
    NODE_OWNED_EXTERNAL_STATIC_RESPONSE_BODY_MAXIMUM_BYTES,
});
class NodeOwnedExternalStaticFetchError extends Error {
  constructor(code, message, options = undefined) {
    super(message, options);
    this.name = "NodeOwnedExternalStaticFetchError";
    this.code = code;
  }
}
const nodeResponseHeaderEntries = ({ rawHeaders = [], headers = {} }) => {
  if (Array.isArray(rawHeaders) && rawHeaders.length > 0) {
    assert.equal(rawHeaders.length % 2, 0);
    const entries = [];
    for (let index = 0; index < rawHeaders.length; index += 2) {
      entries.push({
        name: String(rawHeaders[index]),
        value: String(rawHeaders[index + 1]),
      });
    }
    return entries;
  }
  return Object.entries(headers).flatMap(([name, value]) =>
    (Array.isArray(value) ? value : [value]).map((entry) => ({
      name,
      value: String(entry ?? ""),
    })),
  );
};
const nodeResponseHeaderBytes = (responseHeaders) =>
  Buffer.byteLength(
    responseHeaders.map(({ name, value }) => `${name}: ${value}\r\n`).join(""),
    "utf8",
  );
const assertNodeResponseHeaderShape = (responseHeaders) => {
  const headerCounts = new Map();
  for (const header of responseHeaders) {
    const name = String(header.name).toLowerCase();
    headerCounts.set(name, (headerCounts.get(name) || 0) + 1);
  }
  const duplicateHeaderNames = [...headerCounts]
    .filter(([, count]) => count > 1)
    .map(([name]) => name)
    .sort();
  if (duplicateHeaderNames.length > 0) {
    throw new NodeOwnedExternalStaticFetchError(
      "duplicate-response-header",
      `Node-owned external GET rejected duplicate response headers: ${duplicateHeaderNames.join(", ")}.`,
    );
  }
  const contentEncoding = responseHeaders.find(
    ({ name }) => String(name).toLowerCase() === "content-encoding",
  )?.value;
  if (
    contentEncoding !== undefined &&
    String(contentEncoding).trim().toLowerCase() !== "identity"
  ) {
    throw new NodeOwnedExternalStaticFetchError(
      "non-identity-content-encoding",
      "Node-owned external GET rejected non-identity content encoding.",
    );
  }
};
const externalStaticCacheKey = ({ method, requestUrl }) => {
  const normalizedMethod = String(method).toUpperCase();
  assert.equal(normalizedMethod, "GET");
  return JSON.stringify({
    method: normalizedMethod,
    requestUrl: new URL(requestUrl).toString(),
    requestContractHash: secretSha256(
      JSON.stringify(NODE_OWNED_EXTERNAL_STATIC_REQUEST_CONTRACT),
    ),
  });
};
const nodeOwnedExactExternalStaticGet = ({
  requestUrl,
  expectedHostname,
  expectedPort,
  allowLoopbackHttp = false,
}) => {
  const parsed = new URL(requestUrl);
  assert.equal(parsed.username, "");
  assert.equal(parsed.password, "");
  assert.equal(parsed.hash, "");
  assert.equal(parsed.hostname.toLowerCase(), expectedHostname.toLowerCase());
  if (allowLoopbackHttp) {
    assert.equal(parsed.protocol, "http:");
    assert.equal(parsed.hostname, "127.0.0.1");
    assert.equal(parsed.port, String(expectedPort));
  } else {
    assert.equal(parsed.protocol, "https:");
    assert.ok(!parsed.port || parsed.port === "443");
    assert.ok(!expectedPort || ["", "443"].includes(String(expectedPort)));
  }
  for (const name of Object.keys(NODE_OWNED_EXTERNAL_STATIC_REQUEST_HEADERS)) {
    assert.equal(
      [
        "authorization",
        "cookie",
        "x-firebase-appcheck",
        "x-goog-api-key",
        "x-vercel-protection-bypass",
      ].includes(name.toLowerCase()),
      false,
    );
  }
  const requestImplementation =
    parsed.protocol === "https:" ? httpsRequest : httpRequest;
  return new Promise((resolveRequest, rejectRequest) => {
    const informationalResponses = [];
    let settled = false;
    const fail = (error) => {
      if (settled) return;
      settled = true;
      rejectRequest(error);
    };
    const clientRequest = requestImplementation(
      parsed,
      {
        method: "GET",
        headers: NODE_OWNED_EXTERNAL_STATIC_REQUEST_HEADERS,
        maxHeaderSize:
          NODE_OWNED_EXTERNAL_STATIC_RESPONSE_HEADER_MAXIMUM_BYTES + 1024,
      },
      (response) => {
        try {
          const responseStatus = Number(response.statusCode || 0);
          if (responseStatus !== 200) {
            throw new NodeOwnedExternalStaticFetchError(
              redirectResponseMustAbort(responseStatus)
                ? "redirect-response"
                : "non-200-response",
              `Node-owned external GET returned HTTP ${responseStatus}.`,
            );
          }
          const responseHeaders = nodeResponseHeaderEntries(response);
          if (
            nodeResponseHeaderBytes(responseHeaders) >
            NODE_OWNED_EXTERNAL_STATIC_RESPONSE_HEADER_MAXIMUM_BYTES
          ) {
            throw new NodeOwnedExternalStaticFetchError(
              "response-headers-too-large",
              "Node-owned external GET response headers exceeded the bound.",
            );
          }
          assertNodeResponseHeaderShape(responseHeaders);
          const declaredContentLength = responseHeaders.find(
            ({ name }) => String(name).toLowerCase() === "content-length",
          )?.value;
          if (
            declaredContentLength !== undefined &&
            (!/^\d+$/u.test(String(declaredContentLength)) ||
              Number(declaredContentLength) >
                NODE_OWNED_EXTERNAL_STATIC_RESPONSE_BODY_MAXIMUM_BYTES)
          ) {
            throw new NodeOwnedExternalStaticFetchError(
              "invalid-content-length",
              "Node-owned external GET rejected an invalid or oversized Content-Length.",
            );
          }
          const sanitizedFinal =
            sanitizeBrowserResponseHeaders(responseHeaders);
          const safeFinalResponseHeaders =
            sanitizedFinal.responseHeaders.filter(({ name }) =>
              NODE_OWNED_EXTERNAL_STATIC_RESPONSE_HEADER_ALLOWLIST.has(name),
            );
          const chunks = [];
          let bodyBytes = 0;
          response.on("data", (chunk) => {
            if (settled) return;
            const bytes = Buffer.from(chunk);
            bodyBytes += bytes.length;
            if (
              bodyBytes > NODE_OWNED_EXTERNAL_STATIC_RESPONSE_BODY_MAXIMUM_BYTES
            ) {
              response.destroy(
                new NodeOwnedExternalStaticFetchError(
                  "response-body-too-large",
                  "Node-owned external GET response body exceeded the bound.",
                ),
              );
              return;
            }
            chunks.push(bytes);
          });
          response.on("error", fail);
          response.on("end", () => {
            if (settled) return;
            settled = true;
            const body = Buffer.concat(chunks);
            resolveRequest({
              requestUrl: parsed.toString(),
              responseStatus,
              responseHeaders: [
                ...safeFinalResponseHeaders,
                { name: "content-length", value: String(body.length) },
              ],
              finalEgressHeaderObservationCount:
                sanitizedFinal.egressHeaderObservationCount,
              finalHeaderSuppressionCount:
                sanitizedFinal.omittedHeaderCount +
                sanitizedFinal.responseHeaders.filter(
                  ({ name }) =>
                    !NODE_OWNED_EXTERNAL_STATIC_RESPONSE_HEADER_ALLOWLIST.has(
                      name,
                    ),
                ).length,
              informationalResponses,
              body,
              bodyBytes: body.length,
              bodySha256: createHash("sha256").update(body).digest("hex"),
            });
          });
        } catch (error) {
          response.resume();
          fail(error);
        }
      },
    );
    clientRequest.on("information", (information) => {
      try {
        const responseStageDecision = responseStageCorrelationDecision({
          responseStatusCode: information.statusCode,
        });
        if (
          responseStageDecision.kind !== "informational" ||
          responseStageDecision.status === 101
        ) {
          throw new NodeOwnedExternalStaticFetchError(
            "invalid-informational-response",
            `Node-owned external GET received unsupported HTTP ${information.statusCode}.`,
          );
        }
        const responseHeaders = nodeResponseHeaderEntries(information);
        if (
          nodeResponseHeaderBytes(responseHeaders) >
          NODE_OWNED_EXTERNAL_STATIC_RESPONSE_HEADER_MAXIMUM_BYTES
        ) {
          throw new NodeOwnedExternalStaticFetchError(
            "informational-headers-too-large",
            "Node-owned external GET informational headers exceeded the bound.",
          );
        }
        assertNodeResponseHeaderShape(responseHeaders);
        const sanitizedInformational =
          sanitizeBrowserResponseHeaders(responseHeaders);
        informationalResponses.push({
          status: responseStageDecision.status,
          terminal: responseStageDecision.terminal,
          egressHeaderObservationCount:
            sanitizedInformational.egressHeaderObservationCount,
          headerSuppressionCount: responseHeaders.length,
        });
      } catch (error) {
        clientRequest.destroy(error);
      }
    });
    clientRequest.on("upgrade", (_response, socket) => {
      socket.destroy();
      clientRequest.destroy(
        new NodeOwnedExternalStaticFetchError(
          "upgrade-response",
          "Node-owned external GET rejected an HTTP 101 upgrade.",
        ),
      );
    });
    clientRequest.on("error", fail);
    clientRequest.setTimeout(
      NODE_OWNED_EXTERNAL_STATIC_TIMEOUT_MILLISECONDS,
      () =>
        clientRequest.destroy(
          new NodeOwnedExternalStaticFetchError(
            "request-timeout",
            "Node-owned external GET exceeded the timeout.",
          ),
        ),
    );
    clientRequest.end();
  });
};
const parseProxyConnectAuthority = (authority) => {
  const rawAuthority = String(authority || "");
  if (
    !rawAuthority ||
    /[\s\\/?#@]/u.test(rawAuthority) ||
    rawAuthority.endsWith(".")
  ) {
    return {
      valid: false,
      hostname: "",
      port: "",
      reason: "invalid-authority",
    };
  }
  let hostname = "";
  let port = "";
  if (rawAuthority.startsWith("[")) {
    const match = rawAuthority.match(/^\[([^\]]+)\]:(\d+)$/u);
    if (!match) {
      return {
        valid: false,
        hostname: "",
        port: "",
        reason: "invalid-authority",
      };
    }
    hostname = match[1].toLowerCase();
    port = match[2];
  } else {
    const separatorIndex = rawAuthority.lastIndexOf(":");
    if (separatorIndex <= 0 || rawAuthority.indexOf(":") !== separatorIndex) {
      return {
        valid: false,
        hostname: "",
        port: "",
        reason: "invalid-authority",
      };
    }
    hostname = rawAuthority.slice(0, separatorIndex).toLowerCase();
    port = rawAuthority.slice(separatorIndex + 1);
  }
  if (!/^\d+$/u.test(port) || Number(port) < 1 || Number(port) > 65535) {
    return { valid: false, hostname, port, reason: "invalid-port" };
  }
  if (isIP(hostname)) {
    return { valid: false, hostname, port, reason: "ip-literal" };
  }
  return { valid: true, hostname, port, reason: null };
};
const listenOnLoopback = (server) =>
  new Promise((resolveListen, rejectListen) => {
    const onError = (error) => {
      server.removeListener("listening", onListening);
      rejectListen(error);
    };
    const onListening = () => {
      server.removeListener("error", onError);
      const address = server.address();
      assert.ok(address && typeof address === "object");
      resolveListen(address);
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(0, "127.0.0.1");
  });
const createBrowserConnectProxyGate = ({
  allowedHostnames,
  allowedRequestOrigins,
  nonFatalBrowserProductHostnames = [],
  fatalOnDeny = true,
  connectAllowed = ({ hostname, port }) =>
    connectTcp({ host: hostname, port: Number(port) }),
}) => {
  const allowedHostnameSet = new Set(
    [...allowedHostnames].map((hostname) => String(hostname).toLowerCase()),
  );
  const nonFatalBrowserProductHostnameSet = new Set(
    [...nonFatalBrowserProductHostnames].map((hostname) =>
      String(hostname).toLowerCase(),
    ),
  );
  const allowedRequestOriginSet = new Set(
    [...allowedRequestOrigins].map((origin) => new URL(origin).origin),
  );
  assert.ok(allowedHostnameSet.size > 0);
  assert.ok(allowedRequestOriginSet.size > 0);
  assert.equal(
    [...allowedHostnameSet].every(
      (hostname) =>
        hostname === canonicalNetworkHostname(hostname) && !isIP(hostname),
    ),
    true,
  );
  assert.equal(
    [...nonFatalBrowserProductHostnameSet].every(
      (hostname) =>
        hostname === canonicalNetworkHostname(hostname) &&
        !isIP(hostname) &&
        !allowedHostnameSet.has(hostname),
    ),
    true,
  );
  const clientSockets = new Set();
  const upstreamSockets = new Set();
  const fatalErrors = [];
  const allowedConnectHostCounts = new Map();
  const deniedConnectAuthorityCounts = new Map();
  const browserProductBackgroundDenyCounts = new Map();
  const requestStageAuthorizationsByRequestId = new Map();
  const authorityLeasesByRequestId = new Map();
  const authorityLeaseQueues = new Map();
  const activeAllowedTunnelCounts = new Map();
  const requestStageAuthorizationCounts = new Map();
  const authorityLeaseConsumeCounts = new Map();
  let auditStage = "browser-launch";
  const authorityLeaseTtlMilliseconds = 5_000;
  const stats = {
    listenerStartCount: 0,
    listenerCloseCount: 0,
    connectRequestCount: 0,
    allowedConnectCount: 0,
    deniedConnectCount: 0,
    browserProductBackgroundDenyCount: 0,
    browserProductBackgroundCredentialOrBodyObservationCount: 0,
    fatalPolicyDenyCount: 0,
    requestStageAuthorizationCount: 0,
    requestStageAuthorizationCompleteCount: 0,
    requestStageAuthorizationRevocationCount: 0,
    activeTunnelPresentAtAuthorizationCount: 0,
    authorityLeaseIssueCount: 0,
    authorityLeaseConsumeCount: 0,
    authorityLeaseUnusedCompletionCount: 0,
    authorityLeaseRevocationCount: 0,
    authorityLeaseExpiredBeforeConnectCount: 0,
    uncorrelatedAllowedConnectDenyCount: 0,
    upstreamSocketCreateCount: 0,
    httpAbsoluteFormDenyCount: 0,
    upgradeDenyCount: 0,
    invalidAuthorityDenyCount: 0,
    ipLiteralDenyCount: 0,
    alternatePortDenyCount: 0,
    unallowlistedHostnameDenyCount: 0,
    connectHeaderDenyCount: 0,
    clientSocketErrorCount: 0,
    tunnelErrorCount: 0,
  };
  const recordFatal = (message) => {
    if (fatalOnDeny) fatalErrors.push(new Error(message));
  };
  const authorityKey = (hostname, port) =>
    `${String(hostname).toLowerCase()}:${String(port)}`;
  const removeLeaseFromQueue = (lease) => {
    const queue = authorityLeaseQueues.get(lease.authority) || [];
    const nextQueue = queue.filter(
      (requestId) => requestId !== lease.requestId,
    );
    if (nextQueue.length > 0) {
      authorityLeaseQueues.set(lease.authority, nextQueue);
    } else {
      authorityLeaseQueues.delete(lease.authority);
    }
  };
  const recordAuthorizationObservation = ({
    stage,
    hostname,
    method,
    origin,
    kind,
  }) => {
    const key = JSON.stringify({ stage, hostname, method, origin, kind });
    requestStageAuthorizationCounts.set(
      key,
      (requestStageAuthorizationCounts.get(key) || 0) + 1,
    );
  };
  const recordLeaseConsumeObservation = ({
    stage,
    hostname,
    requestMethod,
    requestOrigin,
  }) => {
    const key = JSON.stringify({
      stage,
      hostname,
      method: requestMethod,
      origin: requestOrigin,
    });
    authorityLeaseConsumeCounts.set(
      key,
      (authorityLeaseConsumeCounts.get(key) || 0) + 1,
    );
  };
  const denySocket = (socket, responseLine, message, { fatal = true } = {}) => {
    if (fatal) recordFatal(message);
    if (!socket.destroyed)
      socket.end(`${responseLine}\r\nConnection: close\r\n\r\n`);
  };
  const server = createServer((request, response) => {
    stats.httpAbsoluteFormDenyCount += 1;
    recordFatal(
      `Browser proxy rejected absolute-form HTTP request: ${request.url}`,
    );
    response.writeHead(403, { connection: "close", "content-length": "0" });
    response.end();
  });
  server.on("connection", (socket) => {
    clientSockets.add(socket);
    socket.once("close", () => clientSockets.delete(socket));
    socket.on("error", () => {
      stats.clientSocketErrorCount += 1;
    });
  });
  server.on("connect", (request, clientSocket, head) => {
    stats.connectRequestCount += 1;
    const authority = parseProxyConnectAuthority(request.url);
    const credentialOrBodyObserved = Boolean(
      request.headers["proxy-authorization"] ||
      request.headers.authorization ||
      request.headers.cookie ||
      request.headers["content-length"] ||
      request.headers["transfer-encoding"] ||
      request.headers["x-firebase-appcheck"] ||
      request.headers["x-goog-api-key"] ||
      request.headers["x-vercel-protection-bypass"] ||
      head.length > 0,
    );
    const browserProductBackgroundAuthority =
      authority.valid &&
      authority.port === "443" &&
      nonFatalBrowserProductHostnameSet.has(authority.hostname);
    stats.browserProductBackgroundCredentialOrBodyObservationCount += Number(
      browserProductBackgroundAuthority && credentialOrBodyObserved,
    );
    const connectHeadersValid =
      !request.headers.upgrade &&
      !credentialOrBodyObserved &&
      String(request.headers.host || "").toLowerCase() ===
        String(request.url || "").toLowerCase();
    let denyReason = !connectHeadersValid
      ? "connect-headers"
      : !authority.valid
        ? authority.reason
        : authority.port !== "443"
          ? "alternate-port"
          : !allowedHostnameSet.has(authority.hostname)
            ? "unallowlisted-hostname"
            : null;
    let consumedAuthorityLease = null;
    if (!denyReason) {
      const allowedAuthorityKey = authorityKey(
        authority.hostname,
        authority.port,
      );
      const queue = authorityLeaseQueues.get(allowedAuthorityKey) || [];
      while (queue.length > 0 && !consumedAuthorityLease) {
        const requestId = queue.shift();
        const lease = authorityLeasesByRequestId.get(requestId);
        if (!lease || lease.state !== "issued") continue;
        if (Date.now() > lease.expiresAt) {
          lease.state = "expired";
          stats.authorityLeaseExpiredBeforeConnectCount += 1;
          continue;
        }
        lease.state = "consumed";
        lease.consumedAt = Date.now();
        consumedAuthorityLease = lease;
      }
      if (queue.length > 0) {
        authorityLeaseQueues.set(allowedAuthorityKey, queue);
      } else {
        authorityLeaseQueues.delete(allowedAuthorityKey);
      }
      if (!consumedAuthorityLease) {
        denyReason = "missing-authority-lease";
        stats.uncorrelatedAllowedConnectDenyCount += 1;
      }
    }
    if (denyReason) {
      const browserProductBackgroundDeny =
        denyReason === "unallowlisted-hostname" &&
        authority.valid &&
        authority.port === "443" &&
        auditStage === "browser-launch" &&
        browserProductBackgroundAuthority;
      stats.deniedConnectCount += 1;
      stats.browserProductBackgroundDenyCount += Number(
        browserProductBackgroundDeny,
      );
      stats.fatalPolicyDenyCount += Number(!browserProductBackgroundDeny);
      if (browserProductBackgroundDeny) {
        const observationKey = JSON.stringify({
          stage: auditStage,
          source: "browser-process-proxy-only-connect",
          hostname: authority.hostname,
          port: authority.port,
        });
        browserProductBackgroundDenyCounts.set(
          observationKey,
          (browserProductBackgroundDenyCounts.get(observationKey) || 0) + 1,
        );
      }
      stats.invalidAuthorityDenyCount += Number(
        ["invalid-authority", "invalid-port"].includes(denyReason),
      );
      stats.ipLiteralDenyCount += Number(denyReason === "ip-literal");
      stats.alternatePortDenyCount += Number(denyReason === "alternate-port");
      stats.unallowlistedHostnameDenyCount += Number(
        denyReason === "unallowlisted-hostname",
      );
      stats.connectHeaderDenyCount += Number(denyReason === "connect-headers");
      deniedConnectAuthorityCounts.set(
        String(request.url),
        (deniedConnectAuthorityCounts.get(String(request.url)) || 0) + 1,
      );
      denySocket(
        clientSocket,
        "HTTP/1.1 403 Forbidden",
        `Browser proxy denied CONNECT ${request.url}: ${denyReason}`,
        { fatal: !browserProductBackgroundDeny },
      );
      return;
    }
    stats.allowedConnectCount += 1;
    stats.authorityLeaseConsumeCount += 1;
    recordLeaseConsumeObservation(consumedAuthorityLease);
    stats.upstreamSocketCreateCount += 1;
    const allowedAuthority = authorityKey(authority.hostname, authority.port);
    activeAllowedTunnelCounts.set(
      allowedAuthority,
      (activeAllowedTunnelCounts.get(allowedAuthority) || 0) + 1,
    );
    allowedConnectHostCounts.set(
      authority.hostname,
      (allowedConnectHostCounts.get(authority.hostname) || 0) + 1,
    );
    let upstreamSocket;
    try {
      upstreamSocket = connectAllowed(authority);
    } catch (error) {
      stats.tunnelErrorCount += 1;
      fatalErrors.push(error);
      denySocket(
        clientSocket,
        "HTTP/1.1 502 Bad Gateway",
        `Browser proxy failed CONNECT ${request.url}`,
      );
      return;
    }
    upstreamSockets.add(upstreamSocket);
    upstreamSocket.once("close", () => {
      upstreamSockets.delete(upstreamSocket);
      const remaining =
        (activeAllowedTunnelCounts.get(allowedAuthority) || 1) - 1;
      if (remaining > 0)
        activeAllowedTunnelCounts.set(allowedAuthority, remaining);
      else activeAllowedTunnelCounts.delete(allowedAuthority);
    });
    upstreamSocket.once("error", (error) => {
      stats.tunnelErrorCount += 1;
      fatalErrors.push(error);
      if (!clientSocket.destroyed) clientSocket.destroy();
    });
    upstreamSocket.once("connect", () => {
      if (clientSocket.destroyed) {
        upstreamSocket.destroy();
        return;
      }
      clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      if (head.length > 0) upstreamSocket.write(head);
      clientSocket.pipe(upstreamSocket);
      upstreamSocket.pipe(clientSocket);
    });
  });
  server.on("upgrade", (request, socket) => {
    stats.upgradeDenyCount += 1;
    denySocket(
      socket,
      "HTTP/1.1 403 Forbidden",
      `Browser proxy rejected upgrade request: ${request.url}`,
    );
  });
  let address = null;
  return {
    async start() {
      assert.equal(address, null);
      address = await listenOnLoopback(server);
      stats.listenerStartCount += 1;
      return `http://127.0.0.1:${address.port}`;
    },
    async close() {
      for (const [requestId, authorization] of [
        ...requestStageAuthorizationsByRequestId.entries(),
      ]) {
        const lease = authorityLeasesByRequestId.get(requestId);
        if (lease?.state === "issued") {
          removeLeaseFromQueue(lease);
          stats.authorityLeaseRevocationCount += 1;
        } else if (lease?.state === "consumed") {
          recordFatal(
            `Browser proxy closed with an unterminated consumed authority lease: ${authorization.authority}`,
          );
        }
        authorityLeasesByRequestId.delete(requestId);
        requestStageAuthorizationsByRequestId.delete(requestId);
        stats.requestStageAuthorizationRevocationCount += 1;
      }
      authorityLeaseQueues.clear();
      const sockets = [...new Set([...clientSockets, ...upstreamSockets])];
      const socketClosePromises = sockets.map(
        (socket) =>
          new Promise((resolveSocketClose) => {
            if (socket.closed) {
              resolveSocketClose();
              return;
            }
            socket.once("close", resolveSocketClose);
          }),
      );
      for (const socket of sockets) {
        socket.destroy();
      }
      server.closeIdleConnections?.();
      server.closeAllConnections?.();
      await Promise.all(socketClosePromises);
      if (server.listening) {
        await new Promise((resolveClose, rejectClose) =>
          server.close((error) =>
            error ? rejectClose(error) : resolveClose(),
          ),
        );
        stats.listenerCloseCount += 1;
      }
      assert.equal(clientSockets.size, 0);
      assert.equal(upstreamSockets.size, 0);
    },
    setAuditStage(stage) {
      assert.equal(typeof stage, "string");
      assert.match(
        stage,
        /^(?:browser-launch|browser-cleanup|loopback-capture|baseline|candidate)$/u,
      );
      auditStage = stage;
    },
    authorizeRequestStage({
      requestId,
      requestUrl,
      requestMethod,
      requestOrigin,
      stage,
    }) {
      assert.equal(typeof requestId, "string");
      assert.ok(requestId);
      assert.equal(requestStageAuthorizationsByRequestId.has(requestId), false);
      const parsed = new URL(requestUrl);
      const hostname = parsed.hostname.toLowerCase();
      const port = parsed.port || "443";
      assert.equal(parsed.protocol, "https:");
      assert.equal(parsed.username, "");
      assert.equal(parsed.password, "");
      assert.equal(port, "443");
      assert.equal(allowedHostnameSet.has(hostname), true);
      const normalizedRequestMethod = String(requestMethod).toUpperCase();
      assert.equal(
        BROWSER_CONNECT_PROXY_AUTHORIZED_REQUEST_METHODS.includes(
          normalizedRequestMethod,
        ),
        true,
      );
      const normalizedRequestOrigin = new URL(requestOrigin).origin;
      assert.equal(allowedRequestOriginSet.has(normalizedRequestOrigin), true);
      assert.equal(stage, auditStage);
      const authority = authorityKey(hostname, port);
      const activeTunnelPresentAtAuthorization =
        (activeAllowedTunnelCounts.get(authority) || 0) > 0;
      const authorization = {
        requestId,
        stage,
        hostname,
        authority,
        requestMethod: normalizedRequestMethod,
        requestOrigin: normalizedRequestOrigin,
        activeTunnelPresentAtAuthorization,
      };
      requestStageAuthorizationsByRequestId.set(requestId, authorization);
      stats.requestStageAuthorizationCount += 1;
      stats.activeTunnelPresentAtAuthorizationCount += Number(
        activeTunnelPresentAtAuthorization,
      );
      recordAuthorizationObservation({
        stage,
        hostname,
        method: normalizedRequestMethod,
        origin: normalizedRequestOrigin,
        kind: activeTunnelPresentAtAuthorization
          ? "authority-lease-active-tunnel-present"
          : "authority-lease-no-active-tunnel",
      });
      const issuedAt = Date.now();
      const lease = {
        requestId,
        stage,
        hostname,
        authority,
        requestMethod: normalizedRequestMethod,
        requestOrigin: normalizedRequestOrigin,
        issuedAt,
        expiresAt: issuedAt + authorityLeaseTtlMilliseconds,
        state: "issued",
        consumedAt: null,
      };
      authorityLeasesByRequestId.set(requestId, lease);
      authorityLeaseQueues.set(authority, [
        ...(authorityLeaseQueues.get(authority) || []),
        requestId,
      ]);
      stats.authorityLeaseIssueCount += 1;
      return {
        activeTunnelPresentAtAuthorization,
        authorityLeaseIssued: true,
      };
    },
    hasRequestStageAuthorization(requestId) {
      return requestStageAuthorizationsByRequestId.has(requestId);
    },
    completeRequestStageAuthorization(requestId) {
      const authorization =
        requestStageAuthorizationsByRequestId.get(requestId);
      assert.ok(authorization);
      const lease = authorityLeasesByRequestId.get(requestId);
      if (lease?.state === "issued") {
        removeLeaseFromQueue(lease);
        lease.state = "completed-unused";
        stats.authorityLeaseUnusedCompletionCount += 1;
      }
      authorityLeasesByRequestId.delete(requestId);
      requestStageAuthorizationsByRequestId.delete(requestId);
      stats.requestStageAuthorizationCompleteCount += 1;
    },
    revokeRequestStageAuthorization(requestId) {
      const authorization =
        requestStageAuthorizationsByRequestId.get(requestId);
      if (!authorization) return;
      const lease = authorityLeasesByRequestId.get(requestId);
      if (lease?.state === "consumed") {
        recordFatal(
          `Browser proxy request-stage authorization failed after its authority lease was consumed: ${authorization.authority}`,
        );
      }
      if (lease?.state === "issued") {
        removeLeaseFromQueue(lease);
        stats.authorityLeaseRevocationCount += 1;
      }
      authorityLeasesByRequestId.delete(requestId);
      requestStageAuthorizationsByRequestId.delete(requestId);
      stats.requestStageAuthorizationRevocationCount += 1;
    },
    assertHealthy() {
      assert.deepEqual(fatalErrors, []);
    },
    snapshot() {
      const allowedConnectHosts = [...allowedConnectHostCounts.entries()]
        .map(([hostname, count]) => ({ hostname, count }))
        .sort((left, right) => left.hostname.localeCompare(right.hostname));
      const deniedConnectAuthorities = [
        ...deniedConnectAuthorityCounts.entries(),
      ]
        .map(([authority, count]) => ({ authority, count }))
        .sort((left, right) => left.authority.localeCompare(right.authority));
      const browserProductBackgroundDenyObservations = [
        ...browserProductBackgroundDenyCounts.entries(),
      ]
        .map(([serializedObservation, count]) => ({
          ...JSON.parse(serializedObservation),
          count,
        }))
        .sort((left, right) =>
          JSON.stringify(left).localeCompare(JSON.stringify(right)),
        );
      const requestStageAuthorizationObservations = [
        ...requestStageAuthorizationCounts.entries(),
      ]
        .map(([serializedObservation, count]) => ({
          ...JSON.parse(serializedObservation),
          count,
        }))
        .sort((left, right) =>
          JSON.stringify(left).localeCompare(JSON.stringify(right)),
        );
      const authorityLeaseConsumeObservations = [
        ...authorityLeaseConsumeCounts.entries(),
      ]
        .map(([serializedObservation, count]) => ({
          ...JSON.parse(serializedObservation),
          count,
        }))
        .sort((left, right) =>
          JSON.stringify(left).localeCompare(JSON.stringify(right)),
        );
      return {
        schemaVersion: 2,
        allowedHostnames: [...allowedHostnameSet].sort(),
        allowedHostnameSetHash: secretSha256(
          JSON.stringify([...allowedHostnameSet].sort()),
        ),
        allowedRequestOrigins: [...allowedRequestOriginSet].sort(),
        allowedRequestOriginSetHash: secretSha256(
          JSON.stringify([...allowedRequestOriginSet].sort()),
        ),
        authorizedRequestMethods:
          BROWSER_CONNECT_PROXY_AUTHORIZED_REQUEST_METHODS,
        browserProductBackgroundDenyHostnames: [
          ...nonFatalBrowserProductHostnameSet,
        ].sort(),
        browserProductBackgroundDenyHostnameSetHash: secretSha256(
          JSON.stringify([...nonFatalBrowserProductHostnameSet].sort()),
        ),
        ...stats,
        allowedConnectHosts,
        allowedConnectHostSetHash: secretSha256(
          JSON.stringify(allowedConnectHosts),
        ),
        deniedConnectAuthorities,
        deniedConnectAuthoritySetHash: secretSha256(
          JSON.stringify(deniedConnectAuthorities),
        ),
        browserProductBackgroundDenyObservations,
        browserProductBackgroundDenyObservationSetHash: secretSha256(
          JSON.stringify(browserProductBackgroundDenyObservations),
        ),
        authorityLeaseTtlMilliseconds,
        requestStageAuthorizationObservations,
        requestStageAuthorizationObservationSetHash: secretSha256(
          JSON.stringify(requestStageAuthorizationObservations),
        ),
        authorityLeaseConsumeObservations,
        authorityLeaseConsumeObservationSetHash: secretSha256(
          JSON.stringify(authorityLeaseConsumeObservations),
        ),
        requestStageAuthorizationResidualCount:
          requestStageAuthorizationsByRequestId.size,
        authorityLeaseResidualCount: authorityLeasesByRequestId.size,
        authorityLeaseQueueResidualCount: [
          ...authorityLeaseQueues.values(),
        ].reduce((total, queue) => total + queue.length, 0),
        activeAllowedTunnelResidualCount: [
          ...activeAllowedTunnelCounts.values(),
        ].reduce((total, count) => total + count, 0),
        activeClientSocketCount: clientSockets.size,
        activeUpstreamSocketCount: upstreamSockets.size,
        fatalErrorCount: fatalErrors.length,
      };
    },
  };
};
const sendLoopbackProxyFixtureRequest = ({ proxyUrl, requestText }) => {
  const parsedProxyUrl = new URL(proxyUrl);
  assert.equal(parsedProxyUrl.protocol, "http:");
  assert.equal(parsedProxyUrl.hostname, "127.0.0.1");
  assert.match(requestText, /\r\n\r\n$/u);
  return new Promise((resolveRequest, rejectRequest) => {
    const responseChunks = [];
    const socket = connectTcp({
      host: parsedProxyUrl.hostname,
      port: Number(parsedProxyUrl.port),
    });
    socket.setTimeout(5_000, () =>
      socket.destroy(new Error("Loopback proxy fixture timed out.")),
    );
    socket.on("connect", () => socket.end(requestText));
    socket.on("data", (chunk) => responseChunks.push(Buffer.from(chunk)));
    socket.on("end", () =>
      resolveRequest(Buffer.concat(responseChunks).toString("latin1")),
    );
    socket.on("error", rejectRequest);
  });
};
const LOOPBACK_PROXY_TLS_CERTIFICATE = `-----BEGIN CERTIFICATE-----
MIIDDTCCAfWgAwIBAgIJAKUdo1/aMAX/MA0GCSqGSIb3DQEBCwUAMCkxJzAlBgNVBAMTHmlkZW50
aXR5dG9vbGtpdC5nb29nbGVhcGlzLmNvbTAeFw0yNjA4MjMxOTIwMDZaFw0zMTA4MjQxOTIwMDZa
MCkxJzAlBgNVBAMTHmlkZW50aXR5dG9vbGtpdC5nb29nbGVhcGlzLmNvbTCCASIwDQYJKoZIhvcN
AQEBBQADggEPADCCAQoCggEBAORDwYTFBxy4gwwWjb23YsafbCJyZMaupeT7gG9G/NxyWn+3CBid
uF0xixObkAGbWWuamAchyzJ1L6sw1v6EsyoApf7dzXxL/l6Y3AxoJvlsT6TNWhO6HsWTDLPKflFn
Fm7QklPg7l33O02wSo0ZRHPiS50P80mfzvn73bs5QWc16S7tYPTSJzggeCIRx2Px5n1wdq7Kqegc
Y1YXaPcOqOc4RpScFKhqC/xPUPi6Z+204zzL4LFDHE1VsT2m2lZO+b8LZky00V/hiDK1OjA8trle
e+ebLu0TQ4x7kNIVwghqrW5XEYNUSTPCaxhGTO3L39+gig5gY8CHkINRFaxqbLECAwEAAaM4MDYw
KQYDVR0RBCIwIIIeaWRlbnRpdHl0b29sa2l0Lmdvb2dsZWFwaXMuY29tMAkGA1UdEwQCMAAwDQYJ
KoZIhvcNAQELBQADggEBANnH+ymAGJmS21jueP6f+RmrKYm2MV/R0UMMr0cviybrK59pPw46Qrjt
5VfXgnEFBk+6J9jIe/piKCZVL5+D8DKx7T0/8yQxdr0J3+WU2uKmgD5NuFKLlcZduLMjXF0zZpMn
qiGadrfEMj1SKxQz4YPSCExk4x0L8uEtDi+IcZNFzI0HYkqYHv9Shuz2kqKsS1ulXfYhPZQ8xM4Y
d819SxQOzLbg4kISeeEePqdCG5vUWQsmKnTUr6SGSNw4S4QVoBZcASiTuWB+Ev5zmuCeogqRoufI
y54NpIwIAViqG8ytx49doN/2Xu/w+5vhOs+PVC9oxyTSOOQWtfPTNNLj5t0=
-----END CERTIFICATE-----`;
const LOOPBACK_PROXY_TLS_PRIVATE_KEY = `-----BEGIN PRIVATE KEY-----
MIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQDkQ8GExQccuIMMFo29t2LGn2wi
cmTGrqXk+4BvRvzcclp/twgYnbhdMYsTm5ABm1lrmpgHIcsydS+rMNb+hLMqAKX+3c18S/5emNwM
aCb5bE+kzVoTuh7Fkwyzyn5RZxZu0JJT4O5d9ztNsEqNGURz4kudD/NJn875+927OUFnNeku7WD0
0ic4IHgiEcdj8eZ9cHauyqnoHGNWF2j3DqjnOEaUnBSoagv8T1D4umfttOM8y+CxQxxNVbE9ptpW
Tvm/C2ZMtNFf4YgytTowPLa5Xnvnmy7tE0OMe5DSFcIIaq1uVxGDVEkzwmsYRkzty9/foIoOYGPA
h5CDURWsamyxAgMBAAECggEBAMqGf1Wwho3p+4OnIx13bzExU30Ap/9MB66xopOYlVN2NmtoVsuY
bHJrOa0s8ckrL1x0bnytdB8RsDigfbCWxmv25VDLNL0ao9cEowBzDFlyyvs6o7grA5Bi1vtSJ19M
KrApaBr50CQY7koQpySnjX+QAWyaMU5adwZ/fIzX0PqjQklv8CyAqTBm/k4muSizZs+A6tP/q6WJ
CeQ/oIvWOKeULPxkVcz+8GHRA9XcETmUy7Oh0l8TxxPu8RgVDUJXRmQZzM4aWl0V3RJA1JCnG6bZ
rVDkHzlEZBLQpTtV/MZ4rGIq9bGn5beo2GRHoL4TrTEuTQyMDNNe+Lujbvg0Uu0CgYEA+jNGs/f6
ly/QlOzSuKdgzvPtjt60SHyADSeUCTU6zubZpmiY1/vXcVuzDL1+KZnnNwrSTIZVfTwZuQryDHmP
Nlqjewiz81WptOeGAhjcsvv1L15iey4pSABHbB9nY3pQFKsl/lrtgDdCnIw4cFeXaAp4hAqIfgFg
RzRBbJBYsFcCgYEA6Y5PhvyQvkKF3Ff5Y49u0dAjvblZmx7RIZPnUJRHZqT9QkiCbaOFodcItrjy
1oTpCcV1++hMTuInA0roKw44GOTlX1vwl9jGhdrwkOYtU2Nc376SGN0fRmZ98KrvmSpUVED2860g
CHqKMCGE5CW5fzZLPTmHVP2Yz+8vLAYJhjcCgYA5AngIx+dUjbOUS4YURyc64L/vfvVLUvsGhE8p
7fQRcu6DCXBSPnMvxDo/G+pkZkoV86RJhY5zM7+Ut1bB2uzz8KExhqEiQBGkQ+D4F1wqeFi8y1/b
O4ByhIXBsEIpm5QlsX29wFA/l9fYveaaSosYTNJ7G79QHtYmQ1To/NcIjwKBgQCqXvyWbKEtmRtK
3AX5YYUmmp2n5ZB+/qDxzJGdjzzynIJ+mqRCVFnD8DfUCuBiKjxQu3FQnGkl1gU9eqQX3FyBlF/a
CxhbvG8877QzDyWbQc1bDgpHBu6sjVFrgVYcteskNuuuX+kRJkqtx5XIU9iX+sQx2khlcETL0h/o
DlNeSwKBgBDT9uiwAlmI8fvGWPASdUAvAPXkVgFjt5l5AgdLNMMnjXiQDIs4Xxsc6GRBvOXa/4TO
ZPkFFQhlnG9qSNN73wkQXlCK9EXINr74anhX2TtkhrgzZU5pBAYQziLPYK49z/zhGkGI4jSDLKDC
SNG7kGa+MigrFc7Simh9AYYzHAMk
-----END PRIVATE KEY-----`;
assert.equal(
  contract.networkBoundary.executionTargetBoundary.requestBodyMaximumBytes,
  MAX_RESOLVED_REQUEST_POST_DATA_BYTES,
);
assert.deepEqual(
  [...BROWSER_RESPONSE_HEADER_ALLOWLIST],
  contract.networkBoundary.networkResponseBoundary.allowedHeaderNames,
);
assert.deepEqual(
  [...BROWSER_EGRESS_CAPABLE_RESPONSE_HEADER_NAMES],
  contract.networkBoundary.networkResponseBoundary.egressCapableHeaderNames,
);
assert.equal(
  BROWSER_RESPONSE_HEADER_ALLOWLIST.has(
    FIRESTORE_WEBCHANNEL_SESSION_RESPONSE_HEADER_NAME,
  ),
  false,
);
assert.equal(
  BROWSER_EGRESS_CAPABLE_RESPONSE_HEADER_NAMES.has(
    FIRESTORE_WEBCHANNEL_SESSION_RESPONSE_HEADER_NAME,
  ),
  false,
);
assert.deepEqual(
  contract.networkBoundary.networkResponseBoundary
    .requestBoundConditionalHeaderRules,
  [
    {
      id: FIRESTORE_WEBCHANNEL_SESSION_RESPONSE_RULE_ID,
      headerName: FIRESTORE_WEBCHANNEL_SESSION_RESPONSE_HEADER_NAME,
      responseStage: "successful-final-only",
      requestScope: "exact-firestore-webchannel-encoded-init",
      scopeMismatchAction: "omit",
      informationalResponseAction: "omit",
      duplicateHeaderAction: "capture-fatal",
      valuePolicy: "nonempty-visible-ascii-maximum-1024-bytes",
    },
  ],
);
const isCrossOriginDocumentRequest = ({
  requestUrl,
  resourceType,
  stableBrowserOrigin,
}) =>
  resourceType === "Document" &&
  new URL(requestUrl).origin !== stableBrowserOrigin;
const isVercelNetworkHostname = (hostname) =>
  canonicalNetworkHostname(hostname) === "vercel.app" ||
  canonicalNetworkHostname(hostname).endsWith(".vercel.app");
const normalizedNetworkResourceType = (resourceType) =>
  String(resourceType || "").toLowerCase();
const exactStaticExternalRuleId = ({
  requestUrl,
  method,
  resourceType,
  allowlist = contract.networkBoundary.externalStaticRequestAllowlist,
}) => {
  const parsed = new URL(requestUrl);
  const normalizedMethod = String(method).toUpperCase();
  const normalizedResourceType = normalizedNetworkResourceType(resourceType);
  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    (parsed.port && parsed.port !== "443") ||
    !allowlist.methods.includes(normalizedMethod)
  ) {
    return null;
  }
  const rule = allowlist.rules.find((candidate) => {
    if (
      parsed.hostname.toLowerCase() !== candidate.hostname ||
      !candidate.resourceTypes.some(
        (value) => value.toLowerCase() === normalizedResourceType,
      )
    ) {
      return false;
    }
    if (candidate.exactPathAndSearch !== undefined) {
      return (
        `${parsed.pathname}${parsed.search}` === candidate.exactPathAndSearch
      );
    }
    if (candidate.queryPolicy === "none" && parsed.search) return false;
    if (candidate.exactPathnames?.includes(parsed.pathname)) return true;
    if (
      candidate.pathnamePrefix &&
      parsed.pathname.startsWith(candidate.pathnamePrefix) &&
      candidate.allowedExtensions?.some((extension) =>
        parsed.pathname.toLowerCase().endsWith(extension),
      )
    ) {
      return true;
    }
    return false;
  });
  return rule?.id || null;
};
const deterministicRecaptchaRequestInScope = ({
  requestUrl,
  method,
  resourceType,
}) => {
  const parsed = new URL(requestUrl);
  const responseContract =
    contract.browserTransport.deterministicRecaptchaResponse;
  return (
    parsed.protocol === responseContract.protocol &&
    parsed.hostname.toLowerCase() === responseContract.hostname &&
    responseContract.allowedPorts.includes(parsed.port) &&
    (responseContract.userinfoAllowed ||
      (!parsed.username && !parsed.password)) &&
    String(method).toUpperCase() === responseContract.method &&
    parsed.pathname === responseContract.pathname &&
    parsed.search === "" &&
    parsed.hash === "" &&
    normalizedNetworkResourceType(resourceType) ===
      responseContract.resourceType.toLowerCase()
  );
};
const optionalTelemetrySuppressionDecision = ({ requestUrl, method }) => {
  const parsed = new URL(requestUrl);
  const suppression = contract.networkBoundary.optionalTelemetrySuppression;
  const eligible =
    parsed.protocol === "https:" &&
    !parsed.username &&
    !parsed.password &&
    (!parsed.port || parsed.port === "443") &&
    suppression.methods.includes(String(method).toUpperCase()) &&
    suppression.hostnames.includes(parsed.hostname.toLowerCase());
  return {
    eligible,
    hostname: parsed.hostname.toLowerCase(),
    ruleId: eligible ? "optional-telemetry-host" : null,
  };
};
const exactAuthCredentialBodyRequestScope = ({
  requestUrl,
  method,
  stagingApiKey,
}) => {
  const parsed = new URL(requestUrl);
  const queryKeys = [...parsed.searchParams.keys()];
  return (
    String(method).toUpperCase() === "POST" &&
    parsed.protocol === "https:" &&
    !parsed.username &&
    !parsed.password &&
    (!parsed.port || parsed.port === "443") &&
    parsed.hostname === "identitytoolkit.googleapis.com" &&
    parsed.pathname === "/v1/accounts:signInWithPassword" &&
    parsed.hash === "" &&
    queryKeys.length === 1 &&
    queryKeys[0] === "key" &&
    parsed.searchParams.getAll("key").length === 1 &&
    parsed.searchParams.get("key") === stagingApiKey
  );
};
const exactRefreshTokenBodyRequestScope = ({
  requestUrl,
  method,
  stagingApiKey,
}) => {
  const parsed = new URL(requestUrl);
  const queryKeys = [...parsed.searchParams.keys()];
  return (
    String(method).toUpperCase() === "POST" &&
    parsed.protocol === "https:" &&
    !parsed.username &&
    !parsed.password &&
    (!parsed.port || parsed.port === "443") &&
    parsed.hostname === "securetoken.googleapis.com" &&
    parsed.pathname === "/v1/token" &&
    parsed.hash === "" &&
    queryKeys.length === 1 &&
    queryKeys[0] === "key" &&
    parsed.searchParams.getAll("key").length === 1 &&
    parsed.searchParams.get("key") === stagingApiKey
  );
};
const deterministicResponseDecision = ({
  requestUrl,
  method,
  resourceType,
  headers = {},
  postData = "",
  stableBrowserOrigin,
}) => {
  const parsed = new URL(requestUrl);
  const normalizedMethod = String(method).toUpperCase();
  const normalizedResourceType = normalizedNetworkResourceType(resourceType);
  const headerNames = Object.keys(headers).map((name) => name.toLowerCase());
  const bodyAbsent = String(postData || "") === "";
  const holidayContract = contract.browserTransport.deterministicLocalResponse;
  const holidayNamespace =
    parsed.origin === stableBrowserOrigin &&
    (parsed.pathname === "/api" || parsed.pathname.startsWith("/api/"));
  if (holidayNamespace) {
    const yearValues = parsed.searchParams.getAll("year");
    const yearValue = yearValues.length === 1 ? yearValues[0] : "";
    const canonicalYear =
      /^(?:19[0-9]{2}|20[0-9]{2}|2100)$/u.test(yearValue) &&
      Number(yearValue) >= holidayContract.yearCanonicalDecimalMinimum &&
      Number(yearValue) <= holidayContract.yearCanonicalDecimalMaximum &&
      parsed.search === `?year=${yearValue}`;
    const forbiddenHeaderPresent =
      holidayContract.forbiddenRequestHeaderNames.some((name) =>
        headerNames.includes(name),
      );
    const eligible =
      parsed.pathname === holidayContract.pathname &&
      parsed.hash === "" &&
      normalizedMethod === holidayContract.method &&
      holidayContract.resourceTypes.some(
        (value) => value.toLowerCase() === normalizedResourceType,
      ) &&
      [...parsed.searchParams.keys()].length ===
        holidayContract.queryOccurrenceCount &&
      canonicalYear &&
      bodyAbsent &&
      !forbiddenHeaderPresent;
    return {
      scoped: true,
      eligible,
      id: holidayContract.id,
      year: canonicalYear ? Number(yearValue) : null,
      responseContract: holidayContract,
    };
  }
  if (
    deterministicRecaptchaRequestInScope({
      requestUrl,
      method,
      resourceType,
    })
  ) {
    const responseContract =
      contract.browserTransport.deterministicRecaptchaResponse;
    const forbiddenHeaderPresent =
      responseContract.forbiddenRequestHeaderNames.some((name) =>
        headerNames.includes(name),
      );
    return {
      scoped: true,
      eligible: bodyAbsent && !forbiddenHeaderPresent,
      id: responseContract.id,
      year: null,
      responseContract,
    };
  }
  return {
    scoped: false,
    eligible: false,
    id: null,
    year: null,
    responseContract: null,
  };
};
const isNonFirebaseHostnameAllowed = ({
  requestUrl,
  method,
  resourceType,
  isFirebaseRequest,
  allowedOrigins,
}) => {
  assert.equal(typeof isFirebaseRequest, "boolean");
  assert.equal(Array.isArray(allowedOrigins), true);
  if (isFirebaseRequest) return false;
  const parsed = new URL(requestUrl);
  return (
    allowedOrigins.includes(parsed.origin) ||
    exactStaticExternalRuleId({ requestUrl, method, resourceType }) !== null ||
    deterministicRecaptchaRequestInScope({
      requestUrl,
      method,
      resourceType,
    })
  );
};
const nonFirebasePolicyRuleId = ({
  requestUrl,
  method,
  resourceType,
  isFirebaseRequest,
  allowedOrigins,
}) => {
  if (isFirebaseRequest) return null;
  const parsed = new URL(requestUrl);
  if (allowedOrigins.includes(parsed.origin)) {
    return "exact-browser-or-immutable-origin";
  }
  const externalRuleId = exactStaticExternalRuleId({
    requestUrl,
    method,
    resourceType,
  });
  if (externalRuleId) return `external-static:${externalRuleId}`;
  if (
    deterministicRecaptchaRequestInScope({
      requestUrl,
      method,
      resourceType,
    })
  ) {
    return `deterministic:${contract.browserTransport.deterministicRecaptchaResponse.id}`;
  }
  return null;
};
const externalStaticRequestDecision = ({
  requestUrl,
  method,
  resourceType,
  headers = {},
  postData = "",
}) => {
  const ruleId = exactStaticExternalRuleId({
    requestUrl,
    method,
    resourceType,
  });
  if (!ruleId) {
    return { scoped: false, eligible: false, rule: null, action: null };
  }
  const allowlist = contract.networkBoundary.externalStaticRequestAllowlist;
  const rule = allowlist.rules.find((candidate) => candidate.id === ruleId);
  assert.ok(rule);
  const headerNames = Object.keys(headers).map((name) => name.toLowerCase());
  const forbiddenHeaderPresent = allowlist.forbiddenRequestHeaderNames.some(
    (name) => headerNames.includes(name),
  );
  const bodyAbsent = String(postData || "") === "";
  const action = rule.action;
  return {
    scoped: true,
    eligible:
      bodyAbsent &&
      !forbiddenHeaderPresent &&
      action !== "block-before-transmission-until-trusted-pin",
    rule,
    action,
  };
};
const literalOccurrenceCount = (textValue, needle) =>
  needle ? String(textValue).split(String(needle)).length - 1 : 0;
const exactStagingFirestoreWebChannelInitialRequestScope = ({
  requestUrl,
  method,
  inspection,
}) => {
  if (
    !inspection ||
    inspection.firebaseService !== "firestore" ||
    inspection.isFirebaseRequest !== true ||
    inspection.stagingMarker !== true ||
    inspection.productionMarker !== false ||
    inspection.unboundFirebaseRequest !== false ||
    inspection.malformedUrlEncoding !== false ||
    inspection.firebaseTransportValid !== true ||
    inspection.serviceResourceBound !== true ||
    String(method).toUpperCase() !== "POST"
  ) {
    return false;
  }
  try {
    const parsed = new URL(requestUrl);
    const queryNames = [...parsed.searchParams.keys()].sort();
    const databaseValues = parsed.searchParams.getAll("database");
    const ridValues = parsed.searchParams.getAll("RID");
    const attemptValues = parsed.searchParams.getAll("t");
    const cacheBusterValues = parsed.searchParams.getAll("zx");
    return (
      parsed.protocol === "https:" &&
      parsed.hostname.toLowerCase() === "firestore.googleapis.com" &&
      parsed.username === "" &&
      parsed.password === "" &&
      (parsed.port === "" || parsed.port === "443") &&
      parsed.hash === "" &&
      FIRESTORE_WEBCHANNEL_PATHNAMES.has(parsed.pathname) &&
      JSON.stringify(queryNames) ===
        JSON.stringify(FIRESTORE_WEBCHANNEL_INITIAL_QUERY_NAMES) &&
      databaseValues.length === 1 &&
      databaseValues[0] ===
        `projects/${contract.firebaseProjectId}/databases/(default)` &&
      parsed.searchParams.getAll("VER").length === 1 &&
      parsed.searchParams.get("VER") === "8" &&
      parsed.searchParams.getAll("CVER").length === 1 &&
      parsed.searchParams.get("CVER") === "22" &&
      parsed.searchParams.getAll("X-HTTP-Session-Id").length === 1 &&
      parsed.searchParams.get("X-HTTP-Session-Id") === "gsessionid" &&
      ridValues.length === 1 &&
      /^(?:0|[1-9][0-9]{0,4})$/u.test(ridValues[0]) &&
      Number(ridValues[0]) <= 99_999 &&
      attemptValues.length === 1 &&
      /^[1-9][0-9]*$/u.test(attemptValues[0]) &&
      cacheBusterValues.length === 1 &&
      /^[0-9a-z]+$/u.test(cacheBusterValues[0])
    );
  } catch {
    return false;
  }
};
const exactStagingFirestoreWebChannelEncodedApiKeyBodyScope = ({
  requestUrl,
  method,
  headers = {},
  postData = "",
  stagingApiKey,
  inspection,
}) => {
  const rawPostData = String(postData);
  const decodedPostData = safelyDecodeUrl(rawPostData.replace(/\+/gu, "%20"));
  if (
    !exactStagingFirestoreWebChannelInitialRequestScope({
      requestUrl,
      method,
      inspection,
    }) ||
    inspection.apiKeyValueCount !== 0 ||
    inspection.apiKeyBindingValid !== false ||
    decodedPostData === null ||
    literalOccurrenceCount(rawPostData, stagingApiKey) !== 1 ||
    literalOccurrenceCount(decodedPostData, stagingApiKey) !== 1
  ) {
    return false;
  }
  const contentTypeValues = Object.entries(headers)
    .filter(([name]) => String(name).toLowerCase() === "content-type")
    .map(([, value]) => String(value));
  if (
    contentTypeValues.length !== 1 ||
    !/^application\/x-www-form-urlencoded(?:\s*;\s*charset=utf-8)?$/iu.test(
      contentTypeValues[0],
    )
  ) {
    return false;
  }
  const rawHeaderFieldCount = rawPostData
    .split("&")
    .filter((segment) => segment.split("=", 1)[0] === "headers").length;
  const bodyParams = new URLSearchParams(rawPostData);
  const encodedHeaderFields = [...bodyParams.entries()].filter(
    ([name]) => String(name).toLowerCase() === "headers",
  );
  if (
    rawHeaderFieldCount !== 1 ||
    encodedHeaderFields.length !== 1 ||
    encodedHeaderFields[0][0] !== "headers"
  ) {
    return false;
  }
  const encodedHeaderBlock = encodedHeaderFields[0][1];
  if (
    !encodedHeaderBlock.endsWith("\r\n") ||
    encodedHeaderBlock.includes("\0")
  ) {
    return false;
  }
  const headerLines = encodedHeaderBlock.split("\r\n");
  if (headerLines.pop() !== "" || headerLines.some((line) => line === "")) {
    return false;
  }
  const parsedHeaderLines = [];
  for (const line of headerLines) {
    const separatorIndex = line.indexOf(":");
    if (separatorIndex <= 0) return false;
    const name = line.slice(0, separatorIndex);
    const value = line.slice(separatorIndex + 1);
    if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/u.test(name)) return false;
    parsedHeaderLines.push({ name: name.toLowerCase(), value });
  }
  const apiKeyHeaderLines = parsedHeaderLines.filter(
    ({ name }) => name === "x-goog-api-key",
  );
  return (
    apiKeyHeaderLines.length === 1 &&
    apiKeyHeaderLines[0].value === stagingApiKey
  );
};
const stagingApiKeyScopeDecision = ({
  requestUrl,
  method = "GET",
  headers = {},
  postData = "",
  stagingApiKey,
  inspection,
}) => {
  assert.ok(stagingApiKey);
  assert.ok(inspection && typeof inspection === "object");
  const decodedRequestUrl = safelyDecodeUrl(requestUrl);
  const headerOccurrenceCount = Object.values(headers).reduce(
    (count, value) => {
      const rawValue = String(value);
      const decodedValue = safelyDecodeUrl(rawValue) || rawValue;
      return count + literalOccurrenceCount(decodedValue, stagingApiKey);
    },
    0,
  );
  const rawPostData = String(postData);
  const decodedPostData =
    safelyDecodeUrl(rawPostData.replace(/\+/gu, "%20")) || rawPostData;
  const observedOccurrenceCount =
    literalOccurrenceCount(decodedRequestUrl || "", stagingApiKey) +
    headerOccurrenceCount +
    literalOccurrenceCount(decodedPostData, stagingApiKey);
  const approvedRequestOccurrenceCount =
    inspection.isFirebaseRequest && inspection.apiKeyBindingValid
      ? inspection.apiKeyValueCount
      : 0;
  const approvedEncodedBodyOccurrenceCount = Number(
    exactStagingFirestoreWebChannelEncodedApiKeyBodyScope({
      requestUrl,
      method,
      headers,
      postData,
      stagingApiKey,
      inspection,
    }),
  );
  const approvedOccurrenceCount =
    approvedRequestOccurrenceCount + approvedEncodedBodyOccurrenceCount;
  return {
    observedOccurrenceCount,
    approvedOccurrenceCount,
    approvedEncodedBodyOccurrenceCount,
    valid: observedOccurrenceCount === approvedOccurrenceCount,
  };
};
const sensitiveMaterialScopeDecision = ({
  requestUrl,
  headers = {},
  postData = "",
  credentialValues = [],
  refreshTokenValues = [],
  debugToken = "",
  debugSentinel = "",
  authCredentialBodyScope = false,
  refreshTokenBodyScope = false,
  debugSentinelBodyScope = false,
}) => {
  const decodedRequestUrl = safelyDecodeUrl(requestUrl) || "";
  const headerEntries = Object.entries(headers).map(([name, value]) => ({
    name: String(name),
    value: String(value),
  }));
  const headerValues = headerEntries.map(({ value }) => value);
  const valueInUrlOrHeaders = (value) =>
    Boolean(value) &&
    (decodedRequestUrl.includes(value) ||
      headerValues.some((headerValue) => headerValue.includes(value)));
  const valueInBody = (value) =>
    Boolean(value) && String(postData).includes(value);
  const credentialInUrlOrHeaders = credentialValues.some(valueInUrlOrHeaders);
  const credentialInBody = credentialValues.some(valueInBody);
  const refreshTokenFieldPresent =
    /(?:^|[&{,])\s*"?(?:refresh_token|refreshToken)"?\s*(?:=|:)/u.test(
      String(postData),
    ) ||
    /[?&](?:refresh_token|refreshToken)=/u.test(decodedRequestUrl) ||
    headerEntries.some(
      ({ name, value }) =>
        /(?:^|[-_])refresh[-_]?token$/iu.test(name) ||
        /(?:^|[&{,])\s*"?(?:refresh_token|refreshToken)"?\s*(?:=|:)/u.test(
          value,
        ),
    );
  const refreshTokenInUrlOrHeaders =
    refreshTokenValues.some(valueInUrlOrHeaders);
  const refreshTokenInBody = refreshTokenValues.some(valueInBody);
  const debugTokenObserved =
    valueInUrlOrHeaders(debugToken) || valueInBody(debugToken);
  const debugSentinelInUrlOrHeaders = valueInUrlOrHeaders(debugSentinel);
  const debugSentinelInBody = valueInBody(debugSentinel);
  if (
    credentialInUrlOrHeaders ||
    (credentialInBody && !authCredentialBodyScope)
  ) {
    return { valid: false, marker: "test-credential-scope" };
  }
  if (
    refreshTokenInUrlOrHeaders ||
    ((refreshTokenFieldPresent || refreshTokenInBody) && !refreshTokenBodyScope)
  ) {
    return { valid: false, marker: "refresh-token-scope" };
  }
  if (debugTokenObserved) {
    return { valid: false, marker: "debug-token-scope" };
  }
  if (
    debugSentinelInUrlOrHeaders ||
    (debugSentinelInBody && !debugSentinelBodyScope)
  ) {
    return { valid: false, marker: "debug-sentinel-scope" };
  }
  return { valid: true, marker: null };
};
const unifiedSensitivePreTransmissionDecision = ({
  requestUrl,
  method = "GET",
  headers = {},
  postData = "",
  inspection,
  stagingApiKey,
  credentialValues = [],
  refreshTokenValues = [],
  debugToken = "",
  debugSentinel = "",
  bypassSecret = "",
  authCredentialBodyScope = false,
  refreshTokenBodyScope = false,
  debugSentinelBodyScope = false,
}) => {
  assert.ok(inspection && typeof inspection === "object");
  const headerEntries = Object.entries(headers).map(([name, value]) => ({
    name: String(name),
    value: String(value),
  }));
  const decodedRequestUrl = safelyDecodeUrl(requestUrl) || "";
  const rawBypassHeaderPresent = headerEntries.some(
    ({ name }) => name.toLowerCase() === "x-vercel-protection-bypass",
  );
  const rawBypassSecretObserved =
    Boolean(bypassSecret) &&
    (decodedRequestUrl.includes(bypassSecret) ||
      String(postData).includes(bypassSecret) ||
      headerEntries.some(({ value }) => value.includes(bypassSecret)));
  const apiKeyScope = stagingApiKeyScopeDecision({
    requestUrl,
    method,
    headers,
    postData,
    stagingApiKey,
    inspection,
  });
  const sensitiveMaterialScope = sensitiveMaterialScopeDecision({
    requestUrl,
    headers,
    postData,
    credentialValues,
    refreshTokenValues,
    debugToken,
    debugSentinel,
    authCredentialBodyScope,
    refreshTokenBodyScope,
    debugSentinelBodyScope,
  });
  if (inspection.productionMarker) {
    return { valid: false, marker: "production" };
  }
  if (rawBypassHeaderPresent || rawBypassSecretObserved) {
    return { valid: false, marker: "vercel-bypass-scope" };
  }
  if (!apiKeyScope.valid) {
    return { valid: false, marker: "staging-api-key-scope" };
  }
  if (!sensitiveMaterialScope.valid) return sensitiveMaterialScope;
  return { valid: true, marker: null };
};
const deterministicFulfillPayload = (responseContract, bodyBytes = null) => {
  const bytes =
    bodyBytes || Buffer.from(responseContract.responseBodyUtf8, "utf8");
  assert.equal(
    bytes.length,
    responseContract.bytes ??
      responseContract.responseBodyBytes ??
      bytes.length,
  );
  assert.equal(
    secretSha256(bytes),
    responseContract.sha256 ?? responseContract.responseBodySha256,
  );
  const responseHeaders = Object.entries(
    responseContract.responseHeaders || {
      "cache-control": "no-store",
      "content-type": "text/javascript; charset=utf-8",
    },
  ).map(([name, value]) => ({ name, value }));
  return {
    responseCode: responseContract.responseStatus ?? 200,
    responseHeaders,
    body: bytes.toString("base64"),
    bodySha256: secretSha256(bytes),
    bodyBytes: bytes.length,
  };
};
const localFirebaseModulePayloadCache = new Map();
const localFirebaseModulePayload = (requestUrl) => {
  const pathname = new URL(requestUrl).pathname;
  if (localFirebaseModulePayloadCache.has(pathname)) {
    return localFirebaseModulePayloadCache.get(pathname);
  }
  const firebaseRule =
    contract.networkBoundary.externalStaticRequestAllowlist.rules.find(
      (rule) => rule.id === "firebase-esm-12.9.0",
    );
  const moduleContract = firebaseRule?.localModules?.[pathname];
  assert.ok(moduleContract);
  const bytes = readFileSync(resolve(moduleContract.path));
  const payload = deterministicFulfillPayload(
    {
      ...moduleContract,
      responseStatus: 200,
      responseHeaders: firebaseRule.responseHeaders,
    },
    bytes,
  );
  localFirebaseModulePayloadCache.set(pathname, payload);
  return payload;
};
const fetchPinnedExternalStaticSources = async () => {
  const cacheEntries = [];
  const attestations = [];
  for (const rule of contract.networkBoundary.externalStaticRequestAllowlist
    .rules) {
    if (rule.action !== "startup-pinned-source-fetch-then-local-fulfill") {
      continue;
    }
    for (const [browserPathname, source] of Object.entries(
      rule.pinnedSources || {},
    )) {
      const sourceUrl = new URL(source.url);
      assert.equal(sourceUrl.protocol, "https:");
      assert.equal(sourceUrl.username, "");
      assert.equal(sourceUrl.password, "");
      assert.ok(!sourceUrl.port || sourceUrl.port === "443");
      assert.equal(sourceUrl.hash, "");
      const response = await nodeOwnedExactExternalStaticGet({
        requestUrl: sourceUrl.toString(),
        expectedHostname: sourceUrl.hostname,
        expectedPort: sourceUrl.port,
      });
      assert.equal(response.responseStatus, 200);
      assert.equal(response.requestUrl, sourceUrl.toString());
      const bytes = response.body;
      assert.equal(bytes.length, source.bytes);
      assert.equal(
        createHash("sha256").update(bytes).digest("hex"),
        source.sha256,
      );
      const browserUrl = `https://${rule.hostname}${browserPathname}`;
      const responseHeaders = [
        { name: "access-control-allow-origin", value: "*" },
        { name: "cache-control", value: "no-store" },
        { name: "content-type", value: source.contentType },
        { name: "cross-origin-resource-policy", value: "cross-origin" },
      ];
      cacheEntries.push([
        browserUrl,
        {
          body: bytes.toString("base64"),
          bodySha256: source.sha256,
          bodyBytes: source.bytes,
          responseHeaders,
          sourceUrl: sourceUrl.toString(),
          sourceUrlSha256: secretSha256(sourceUrl.toString()),
          ruleId: rule.id,
          requestContractHash: secretSha256(
            JSON.stringify(NODE_OWNED_EXTERNAL_STATIC_REQUEST_CONTRACT),
          ),
          informationalResponseCount: response.informationalResponses.length,
          informationalEgressHeaderObservationCount:
            response.informationalResponses.reduce(
              (total, observation) =>
                total + observation.egressHeaderObservationCount,
              0,
            ),
          informationalBrowserExposureCount: 0,
          finalHeaderSuppressionCount: response.finalHeaderSuppressionCount,
        },
      ]);
      attestations.push({
        schemaVersion: 1,
        ruleId: rule.id,
        browserUrlSha256: secretSha256(browserUrl),
        sourceUrl: sourceUrl.toString(),
        sourceUrlSha256: secretSha256(sourceUrl.toString()),
        responseStatus: response.responseStatus,
        responseBodySha256: source.sha256,
        responseBodyBytes: source.bytes,
        informationalResponseCount: response.informationalResponses.length,
        informationalEgressHeaderObservationCount:
          response.informationalResponses.reduce(
            (total, observation) =>
              total + observation.egressHeaderObservationCount,
            0,
          ),
        informationalBrowserExposureCount: 0,
        finalHeaderSuppressionCount: response.finalHeaderSuppressionCount,
        requestContractHash: secretSha256(
          JSON.stringify(NODE_OWNED_EXTERNAL_STATIC_REQUEST_CONTRACT),
        ),
      });
    }
  }
  return { cacheEntries, attestations };
};
const resolvePlaywrightPrivateCdpBoundaryShape = (browser) => {
  const crBrowser = browser?._connection?.toImpl?.(browser);
  assert.equal(crBrowser?.constructor?.name, "_CRBrowser");
  for (const field of ["_session", "_connection", "_crPages"]) {
    assert.equal(Object.hasOwn(crBrowser, field), true);
  }
  const rootSession = crBrowser._session;
  assert.equal(rootSession?.constructor?.name, "_CRSession");
  const crSessionPrototype = Object.getPrototypeOf(rootSession);
  const originalSend = crSessionPrototype.send;
  const originalDetach = crSessionPrototype.detach;
  assert.equal(typeof originalSend, "function");
  assert.equal(typeof originalDetach, "function");
  assert.match(
    String(originalDetach),
    /Runtime\.runIfWaitingForDebugger[\s\S]*Target\.detachFromTarget/u,
  );
  const originalRootAttachedListeners = rootSession.listeners(
    "Target.attachedToTarget",
  );
  assert.equal(originalRootAttachedListeners.length, 1);
  const originalRootAttachedListener = originalRootAttachedListeners[0];
  return {
    crBrowser,
    rootSession,
    crSessionPrototype,
    originalSend,
    originalRootAttachedListener,
  };
};
const installBrowserWidePreTransmissionBoundary = async ({
  browser,
  inspectPausedRequest,
  inspectSensitiveRequest,
}) => {
  assert.equal(typeof inspectPausedRequest, "function");
  assert.equal(typeof inspectSensitiveRequest, "function");
  const {
    crBrowser,
    rootSession,
    crSessionPrototype,
    originalSend,
    originalRootAttachedListener,
  } = resolvePlaywrightPrivateCdpBoundaryShape(browser);
  const sessionStates = new Map();
  const pendingSetups = new Set();
  const pendingHandlers = new Set();
  const fatalErrors = [];
  const closedSecondaryTargetIds = new Set();
  const stats = {
    activationCount: 0,
    waitingTargetCount: 0,
    primaryTargetConfiguredCount: 0,
    primaryRequestBoundaryHandoffCount: 0,
    heldRuntimeResumeCount: 0,
    secondaryTargetClosedBeforeResumeCount: 0,
    requestInspectionCount: 0,
    requestBlockCount: 0,
    requestContinueCount: 0,
    rawSensitiveInspectionCount: 0,
    rawSensitiveBlockCount: 0,
    rawProductionBlockCount: 0,
    rawVercelBypassBlockCount: 0,
    rawStagingApiKeyBlockCount: 0,
    rawTestCredentialBlockCount: 0,
    rawRefreshTokenBlockCount: 0,
    rawDebugTokenBlockCount: 0,
    rawDebugSentinelBlockCount: 0,
    optionalTelemetrySuppressionCount: 0,
    deterministicResponseFulfillCount: 0,
    deterministicResponseScopeMismatchBlockCount: 0,
    externalStaticPrivateOwnerBlockCount: 0,
    fullPostDataResolutionCount: 0,
    fullPostDataNetworkFallbackCount: 0,
    fullPostDataResolutionFailureCount: 0,
    fullPostDataOversizeBlockCount: 0,
    fullPostDataRepresentationMismatchBlockCount: 0,
    handlerErrorCount: 0,
  };
  let activeScope = null;
  let restored = false;

  crSessionPrototype.send = function guardedCrSessionSend(method, params) {
    const state = sessionStates.get(this._sessionId);
    if (
      method === "Runtime.runIfWaitingForDebugger" &&
      state?.status === "configuring"
    ) {
      stats.heldRuntimeResumeCount += 1;
      return new Promise((resolveResume, rejectResume) => {
        state.heldRuntimeResumes.push({ resolveResume, rejectResume });
      });
    }
    return originalSend.call(this, method, params);
  };

  const track = (set, promise) => {
    set.add(promise);
    promise.finally(() => set.delete(promise)).catch(() => {});
    return promise;
  };
  const closeSecondaryTarget = (targetInfo) => {
    if (closedSecondaryTargetIds.has(targetInfo.targetId)) return;
    closedSecondaryTargetIds.add(targetInfo.targetId);
    stats.secondaryTargetClosedBeforeResumeCount += 1;
    track(
      pendingSetups,
      originalSend
        .call(rootSession, "Target.closeTarget", {
          targetId: targetInfo.targetId,
        })
        .then(({ success }) => assert.equal(success, true))
        .catch((error) => {
          stats.handlerErrorCount += 1;
          fatalErrors.push(error);
        }),
    );
  };
  const handlePausedRequest = (session, event, scope) => {
    const handlerPromise = (async () => {
      const resolvedPostData = await resolvePausedRequestPostData({
        event,
        send: (method, params) => originalSend.call(session, method, params),
      });
      stats.fullPostDataResolutionCount += 1;
      stats.fullPostDataNetworkFallbackCount += Number(
        resolvedPostData.source === "network-domain",
      );
      const resolvedEvent = {
        ...event,
        request: {
          ...event.request,
          postData: resolvedPostData.postData,
        },
      };
      stats.requestInspectionCount += 1;
      const inspection = inspectPausedRequest({ event: resolvedEvent, scope });
      stats.rawSensitiveInspectionCount += 1;
      const sensitiveDecision = inspectSensitiveRequest({
        event: resolvedEvent,
        scope,
        inspection,
      });
      if (!sensitiveDecision.valid) {
        stats.rawSensitiveBlockCount += 1;
        stats.rawProductionBlockCount += Number(
          sensitiveDecision.marker === "production",
        );
        stats.rawVercelBypassBlockCount += Number(
          sensitiveDecision.marker === "vercel-bypass-scope",
        );
        stats.rawStagingApiKeyBlockCount += Number(
          sensitiveDecision.marker === "staging-api-key-scope",
        );
        stats.rawTestCredentialBlockCount += Number(
          sensitiveDecision.marker === "test-credential-scope",
        );
        stats.rawRefreshTokenBlockCount += Number(
          sensitiveDecision.marker === "refresh-token-scope",
        );
        stats.rawDebugTokenBlockCount += Number(
          sensitiveDecision.marker === "debug-token-scope",
        );
        stats.rawDebugSentinelBlockCount += Number(
          sensitiveDecision.marker === "debug-sentinel-scope",
        );
        stats.requestBlockCount += 1;
        await originalSend.call(session, "Fetch.failRequest", {
          requestId: event.requestId,
          errorReason: "BlockedByClient",
        });
        return;
      }
      const telemetryDecision = optionalTelemetrySuppressionDecision({
        requestUrl: resolvedEvent.request.url,
        method: resolvedEvent.request.method,
      });
      if (telemetryDecision.eligible) {
        stats.optionalTelemetrySuppressionCount += 1;
        await originalSend.call(session, "Fetch.failRequest", {
          requestId: event.requestId,
          errorReason: "BlockedByClient",
        });
        return;
      }
      const creatorSideSecondaryBootstrap = [
        "Worker",
        "SharedWorker",
        "ServiceWorker",
      ].includes(event.resourceType);
      const crossOriginDocument = isCrossOriginDocumentRequest({
        requestUrl: resolvedEvent.request.url,
        resourceType: event.resourceType,
        stableBrowserOrigin: scope.stableBrowserOrigin,
      });
      const decision = preTransmissionBoundaryDecision({
        ...inspection,
        crossOriginDocument,
      });
      if (decision.block || creatorSideSecondaryBootstrap) {
        stats.requestBlockCount += 1;
        await originalSend.call(session, "Fetch.failRequest", {
          requestId: event.requestId,
          errorReason: "BlockedByClient",
        });
        return;
      }
      const apiKeyScope = stagingApiKeyScopeDecision({
        requestUrl: resolvedEvent.request.url,
        method: resolvedEvent.request.method,
        headers: resolvedEvent.request.headers,
        postData: resolvedPostData.postData,
        stagingApiKey: scope.stagingApiKey,
        inspection,
      });
      if (!apiKeyScope.valid) {
        stats.requestBlockCount += 1;
        await originalSend.call(session, "Fetch.failRequest", {
          requestId: event.requestId,
          errorReason: "BlockedByClient",
        });
        return;
      }
      const deterministicDecision = deterministicResponseDecision({
        requestUrl: resolvedEvent.request.url,
        method: resolvedEvent.request.method,
        resourceType: event.resourceType,
        headers: resolvedEvent.request.headers,
        postData: resolvedPostData.postData,
        stableBrowserOrigin: scope.stableBrowserOrigin,
      });
      if (deterministicDecision.scoped) {
        if (!deterministicDecision.eligible) {
          stats.deterministicResponseScopeMismatchBlockCount += 1;
          await originalSend.call(session, "Fetch.failRequest", {
            requestId: event.requestId,
            errorReason: "BlockedByClient",
          });
          return;
        }
        const payload = deterministicFulfillPayload(
          deterministicDecision.responseContract,
        );
        stats.deterministicResponseFulfillCount += 1;
        await originalSend.call(session, "Fetch.fulfillRequest", {
          requestId: event.requestId,
          responseCode: payload.responseCode,
          responseHeaders: payload.responseHeaders,
          body: payload.body,
        });
        return;
      }
      const externalDecision = externalStaticRequestDecision({
        requestUrl: resolvedEvent.request.url,
        method: resolvedEvent.request.method,
        resourceType: event.resourceType,
        headers: resolvedEvent.request.headers,
        postData: resolvedPostData.postData,
      });
      if (externalDecision.scoped) {
        if (
          externalDecision.eligible &&
          externalDecision.action === "local-node-module-fulfill"
        ) {
          const payload = localFirebaseModulePayload(resolvedEvent.request.url);
          stats.deterministicResponseFulfillCount += 1;
          await originalSend.call(session, "Fetch.fulfillRequest", {
            requestId: event.requestId,
            responseCode: payload.responseCode,
            responseHeaders: payload.responseHeaders,
            body: payload.body,
          });
          return;
        }
        stats.externalStaticPrivateOwnerBlockCount += 1;
        await originalSend.call(session, "Fetch.failRequest", {
          requestId: event.requestId,
          errorReason: "BlockedByClient",
        });
        return;
      }
      stats.requestContinueCount += 1;
      await originalSend.call(session, "Fetch.continueRequest", {
        requestId: event.requestId,
      });
    })().catch(async (error) => {
      if (error instanceof PausedRequestPostDataResolutionError) {
        stats.fullPostDataResolutionFailureCount += 1;
        stats.fullPostDataOversizeBlockCount += Number(
          error.code === "maximum-bytes-exceeded",
        );
        stats.fullPostDataRepresentationMismatchBlockCount += Number(
          error.code === "representation-mismatch",
        );
      }
      stats.handlerErrorCount += 1;
      fatalErrors.push(error);
      try {
        await originalSend.call(session, "Fetch.failRequest", {
          requestId: event.requestId,
          errorReason: "BlockedByClient",
        });
      } catch (_failError) {
        // The target remains capture-fatal even if it closed first.
      }
    });
    track(pendingHandlers, handlerPromise);
  };
  const configurePrimaryTarget = (event, scope) => {
    const setupPromise = (async () => {
      const state = {
        status: "configuring",
        heldRuntimeResumes: [],
        targetId: event.targetInfo.targetId,
        session: null,
        fetchPausedListener: null,
      };
      sessionStates.set(event.sessionId, state);
      originalRootAttachedListener(event);
      const crPage = crBrowser._crPages.get(event.targetInfo.targetId);
      assert.ok(crPage);
      const frameSession = crPage._mainFrameSession;
      const session = frameSession?._client;
      assert.equal(session?._sessionId, event.sessionId);
      state.session = session;
      const originalNestedAttachedHandler = frameSession._onAttachedToTarget;
      assert.equal(typeof originalNestedAttachedHandler, "function");
      const guardedNestedAttachedListener = (nestedEvent) => {
        stats.waitingTargetCount += 1;
        assert.equal(nestedEvent.waitingForDebugger, true);
        closeSecondaryTarget(nestedEvent.targetInfo);
      };
      frameSession._onAttachedToTarget = guardedNestedAttachedListener;
      let nestedAttachedListeners = session.listeners(
        "Target.attachedToTarget",
      );
      for (
        let attempt = 0;
        nestedAttachedListeners.length === 0 && attempt < 1000;
        attempt += 1
      ) {
        await new Promise((resolveTurn) => setTimeout(resolveTurn, 2));
        nestedAttachedListeners = session.listeners("Target.attachedToTarget");
      }
      assert.equal(nestedAttachedListeners.length, 1);
      state.fetchPausedListener = (pausedEvent) =>
        handlePausedRequest(session, pausedEvent, scope);
      session.on("Fetch.requestPaused", state.fetchPausedListener);
      await originalSend.call(session, "Network.enable", {
        maxPostDataSize: FETCH_INLINE_POST_DATA_LIMIT_BYTES,
      });
      await originalSend.call(session, "Fetch.enable", {
        patterns: [{ urlPattern: "*", requestStage: "Request" }],
      });
      state.status = "active";
      assert.ok(state.heldRuntimeResumes.length > 0);
      for (const { resolveResume, rejectResume } of state.heldRuntimeResumes) {
        originalSend
          .call(session, "Runtime.runIfWaitingForDebugger", {})
          .then(resolveResume, rejectResume);
      }
      state.heldRuntimeResumes.length = 0;
      stats.primaryTargetConfiguredCount += 1;
    })().catch(async (error) => {
      stats.handlerErrorCount += 1;
      fatalErrors.push(error);
      const state = sessionStates.get(event.sessionId);
      for (const { rejectResume } of state?.heldRuntimeResumes || []) {
        rejectResume(error);
      }
      if (state) state.heldRuntimeResumes.length = 0;
      try {
        await originalSend.call(rootSession, "Target.closeTarget", {
          targetId: event.targetInfo.targetId,
        });
      } catch (_closeError) {
        // Leaving the target paused is fail-closed until browser teardown.
      }
    });
    track(pendingSetups, setupPromise);
  };
  const guardedRootAttachedListener = (event) => {
    if (event.targetInfo.type === "browser") {
      originalRootAttachedListener(event);
      return;
    }
    stats.waitingTargetCount += 1;
    if (!activeScope || event.waitingForDebugger !== true) {
      stats.handlerErrorCount += 1;
      fatalErrors.push(
        new Error(
          "A target escaped the active wait-for-debugger capture scope.",
        ),
      );
      closeSecondaryTarget(event.targetInfo);
      return;
    }
    if (
      event.targetInfo.type === "page" &&
      activeScope.primaryTargetId === null &&
      ["", "about:blank"].includes(event.targetInfo.url)
    ) {
      activeScope.primaryTargetId = event.targetInfo.targetId;
      configurePrimaryTarget(event, activeScope);
      return;
    }
    closeSecondaryTarget(event.targetInfo);
  };
  rootSession.removeListener(
    "Target.attachedToTarget",
    originalRootAttachedListener,
  );
  rootSession.on("Target.attachedToTarget", guardedRootAttachedListener);

  const flush = async () => {
    while (pendingSetups.size > 0 || pendingHandlers.size > 0) {
      await Promise.allSettled([...pendingSetups, ...pendingHandlers]);
    }
  };
  const restorePrivateHooks = () => {
    if (restored) return;
    rootSession.removeListener(
      "Target.attachedToTarget",
      guardedRootAttachedListener,
    );
    rootSession.on("Target.attachedToTarget", originalRootAttachedListener);
    crSessionPrototype.send = originalSend;
    restored = true;
  };
  return {
    activate(scope) {
      assert.equal(activeScope, null);
      assert.ok(scope?.id);
      assert.ok(scope?.stableBrowserOrigin);
      assert.ok(scope?.stagingApiKey);
      activeScope = { ...scope, primaryTargetId: null };
      stats.activationCount += 1;
      return { ...stats };
    },
    async deactivate(scopeId) {
      assert.equal(activeScope?.id, scopeId);
      await flush();
      assert.ok(activeScope.primaryTargetId);
      const primaryState = [...sessionStates.values()].find(
        (candidate) => candidate.targetId === activeScope.primaryTargetId,
      );
      assert.equal(primaryState?.status, "handed-off");
      activeScope = null;
      assert.deepEqual(fatalErrors, []);
      return { ...stats };
    },
    async handoffPrimaryRequestBoundary(scopeId) {
      assert.equal(activeScope?.id, scopeId);
      await flush();
      const state = [...sessionStates.values()].find(
        (candidate) => candidate.targetId === activeScope.primaryTargetId,
      );
      assert.equal(state?.status, "active");
      assert.ok(state.session);
      assert.ok(state.fetchPausedListener);
      await originalSend.call(state.session, "Fetch.disable", {});
      state.session.removeListener(
        "Fetch.requestPaused",
        state.fetchPausedListener,
      );
      state.fetchPausedListener = null;
      state.status = "handed-off";
      stats.primaryRequestBoundaryHandoffCount += 1;
    },
    async restore() {
      if (restored) return;
      await flush();
      assert.equal(activeScope, null);
      assert.deepEqual(fatalErrors, []);
      assert.equal(
        [...sessionStates.values()].reduce(
          (count, state) => count + state.heldRuntimeResumes.length,
          0,
        ),
        0,
      );
      restorePrivateHooks();
    },
    async forceRestore() {
      if (restored) return;
      await flush();
      activeScope = null;
      for (const state of sessionStates.values()) {
        const teardownError = new Error(
          "The browser-wide pre-transmission boundary was torn down.",
        );
        for (const { rejectResume } of state.heldRuntimeResumes) {
          rejectResume(teardownError);
        }
        state.heldRuntimeResumes.length = 0;
        if (state.session && state.fetchPausedListener) {
          state.session.removeListener(
            "Fetch.requestPaused",
            state.fetchPausedListener,
          );
          state.fetchPausedListener = null;
        }
      }
      restorePrivateHooks();
      if (fatalErrors.length > 0) {
        throw new AggregateError(
          fatalErrors,
          "The browser-wide pre-transmission boundary failed closed.",
        );
      }
    },
    snapshot() {
      return {
        ...stats,
        pendingSetupCount: pendingSetups.size,
        pendingHandlerCount: pendingHandlers.size,
        heldRuntimeResumeResidualCount: [...sessionStates.values()].reduce(
          (count, state) => count + state.heldRuntimeResumes.length,
          0,
        ),
        fatalErrorCount: fatalErrors.length,
      };
    },
  };
};
const stableOriginRewriteDecision = ({
  stage,
  requestUrl,
  method,
  resourceType,
  browserOrigin,
  upstreamOrigins,
  transportContract,
}) => {
  assert.ok(["baseline", "candidate"].includes(stage));
  const parsed = new URL(requestUrl);
  const stableOriginRequest =
    parsed.protocol === transportContract.requiredProtocol &&
    (transportContract.userinfoAllowed ||
      (parsed.username === "" && parsed.password === "")) &&
    transportContract.allowedPorts.includes(parsed.port) &&
    parsed.origin === browserOrigin;
  const normalizedMethod = String(method).toUpperCase();
  const normalizedResourceType = String(resourceType);
  const pathname = parsed.pathname;
  const extensionMatch = pathname.toLowerCase().match(/\.[a-z0-9]+$/u);
  const pathExtension = extensionMatch?.[0] || "";
  const documentRequest =
    normalizedResourceType === transportContract.documentResourceType;
  const staticRequest =
    transportContract.staticResourceTypes.includes(normalizedResourceType) ||
    transportContract.staticPathPrefixes.some((prefix) =>
      pathname.startsWith(prefix),
    ) ||
    transportContract.staticPathExtensions.includes(pathExtension);
  const eligible =
    stableOriginRequest &&
    transportContract.allowedMethods.includes(normalizedMethod) &&
    (documentRequest || staticRequest);
  if (!eligible) {
    return {
      stableOriginRequest,
      eligible: false,
      kind: null,
      browserOrigin: parsed.origin,
      browserPath: `${parsed.pathname}${parsed.search}`,
      upstreamOrigin: null,
      upstreamUrl: null,
    };
  }
  const upstreamOrigin = upstreamOrigins[stage];
  assert.match(upstreamOrigin, /^https:\/\/[^/?#]+\.vercel\.app$/u);
  const upstreamUrl = new URL(
    `${parsed.pathname}${parsed.search}`,
    upstreamOrigin,
  );
  assert.equal(upstreamUrl.origin, upstreamOrigin);
  return {
    stableOriginRequest: true,
    eligible: true,
    kind: documentRequest ? "document" : "static",
    browserOrigin: parsed.origin,
    browserPath: `${parsed.pathname}${parsed.search}`,
    upstreamOrigin,
    upstreamUrl: upstreamUrl.toString(),
  };
};
const verifyStableOriginRewriteNegativeFixtures = () => {
  const browserOrigin = "https://stable.example.vercel.app";
  const upstreamOrigins = {
    baseline: "https://baseline.example.vercel.app",
    candidate: "https://candidate.example.vercel.app",
  };
  const transportContract = contract.browserTransport;
  const document = stableOriginRewriteDecision({
    stage: "baseline",
    requestUrl: `${browserOrigin}/?fixture=1`,
    method: "GET",
    resourceType: "Document",
    browserOrigin,
    upstreamOrigins,
    transportContract,
  });
  assert.equal(document.eligible, true);
  assert.equal(document.kind, "document");
  assert.equal(document.upstreamUrl, `${upstreamOrigins.baseline}/?fixture=1`);
  const script = stableOriginRewriteDecision({
    stage: "candidate",
    requestUrl: `${browserOrigin}/assets/index-123.js`,
    method: "GET",
    resourceType: "Script",
    browserOrigin,
    upstreamOrigins,
    transportContract,
  });
  assert.equal(script.eligible, true);
  assert.equal(script.kind, "static");
  assert.equal(script.upstreamOrigin, upstreamOrigins.candidate);
  for (const fixture of [
    {
      requestUrl:
        "https://firestore.googleapis.com/google.firestore.v1.Firestore/Listen/channel",
      method: "GET",
      resourceType: "XHR",
    },
    {
      requestUrl: `${browserOrigin}/api/write`,
      method: "POST",
      resourceType: "Fetch",
    },
    {
      requestUrl: `${upstreamOrigins.baseline}/assets/index-123.js`,
      method: "GET",
      resourceType: "Script",
    },
    {
      requestUrl: "https://user@stable.example.vercel.app/assets/index-123.js",
      method: "GET",
      resourceType: "Script",
    },
  ]) {
    const decision = stableOriginRewriteDecision({
      stage: "baseline",
      ...fixture,
      browserOrigin,
      upstreamOrigins,
      transportContract,
    });
    assert.equal(decision.eligible, false);
    assert.equal(decision.upstreamUrl, null);
  }
  return {
    acceptedStableDocumentCaseCount: 1,
    acceptedStableStaticCaseCount: 1,
    rejectedExternalOrNonStaticCaseCount: 4,
  };
};
const verifyNetworkPolicyNegativeFixtures = () => {
  const stableBrowserOrigin = "https://stable.example.vercel.app";
  const stagingApiKey = "w10p-synthetic-staging-api-key";
  const credentialValues = [
    "w10p-student@example.invalid",
    "w10p-password-secret",
  ];
  const refreshToken = "w10p-refresh-token-secret";
  const debugToken = "12345678-1234-4123-8123-123456789abc";
  const holidayRequest = `${stableBrowserOrigin}/api/korean-holidays?year=2026`;
  const holiday = deterministicResponseDecision({
    requestUrl: holidayRequest,
    method: "GET",
    resourceType: "Fetch",
    stableBrowserOrigin,
  });
  assert.equal(holiday.scoped, true);
  assert.equal(holiday.eligible, true);
  assert.equal(holiday.year, 2026);
  const rejectedHolidayRequests = [
    { requestUrl: `${stableBrowserOrigin}/api/korean-holidays`, method: "GET" },
    {
      requestUrl: `${stableBrowserOrigin}/api/korean-holidays?year=2026&year=2026`,
      method: "GET",
    },
    {
      requestUrl: `${stableBrowserOrigin}/api/korean-holidays?year=02026`,
      method: "GET",
    },
    {
      requestUrl: `${stableBrowserOrigin}/api/korean-holidays?year=2026`,
      method: "POST",
    },
    {
      requestUrl: `${stableBrowserOrigin}/api/unknown?year=2026`,
      method: "GET",
    },
  ];
  for (const fixture of rejectedHolidayRequests) {
    const decision = deterministicResponseDecision({
      ...fixture,
      resourceType: "Fetch",
      stableBrowserOrigin,
    });
    assert.equal(decision.scoped, true);
    assert.equal(decision.eligible, false);
  }
  const recaptchaContract =
    contract.browserTransport.deterministicRecaptchaResponse;
  const recaptchaUrl = `${recaptchaContract.protocol}//${recaptchaContract.hostname}${recaptchaContract.pathname}`;
  assert.equal(
    deterministicResponseDecision({
      requestUrl: recaptchaUrl,
      method: "GET",
      resourceType: "Script",
      stableBrowserOrigin,
    }).eligible,
    true,
  );
  assert.equal(
    isNonFirebaseHostnameAllowed({
      requestUrl: `https://${recaptchaContract.hostname}/recaptcha/api.js`,
      method: "GET",
      resourceType: "Script",
      isFirebaseRequest: false,
      allowedOrigins: [stableBrowserOrigin],
    }),
    false,
  );
  const firebaseModuleUrl =
    "https://www.gstatic.com/firebasejs/12.9.0/firebase-app.js";
  assert.equal(
    externalStaticRequestDecision({
      requestUrl: firebaseModuleUrl,
      method: "GET",
      resourceType: "Script",
    }).eligible,
    true,
  );
  assert.equal(
    exactStaticExternalRuleId({
      requestUrl: firebaseModuleUrl,
      method: "HEAD",
      resourceType: "Script",
    }),
    null,
  );
  const productionPresentationExternalFixtures = [
    {
      requestUrl: "https://cdn.tailwindcss.com/",
      resourceType: "Script",
      expectedRuleId: "tailwind-play-3.4.17",
    },
    {
      requestUrl:
        "https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css",
      resourceType: "Stylesheet",
      expectedRuleId: "font-awesome-6.4.0-css",
    },
    {
      requestUrl:
        "https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/webfonts/fa-solid-900.woff2",
      resourceType: "Font",
      expectedRuleId: "font-awesome-6.4.0-font",
    },
    {
      requestUrl: "https://fonts.gstatic.com/s/notosanskr/v1/fixture.ttf",
      resourceType: "Font",
      expectedRuleId: "noto-sans-kr-font",
    },
  ];
  for (const fixture of productionPresentationExternalFixtures) {
    assert.equal(
      exactStaticExternalRuleId({
        requestUrl: fixture.requestUrl,
        method: "GET",
        resourceType: fixture.resourceType,
      }),
      fixture.expectedRuleId,
    );
  }
  const rejectedProductionPresentationExternalFixtures = [
    {
      requestUrl: "https://cdn.tailwindcss.com/3.4.17",
      resourceType: "Script",
    },
    {
      requestUrl: "https://cdn.tailwindcss.com/?plugins=forms",
      resourceType: "Script",
    },
    {
      requestUrl:
        "https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.0/css/all.min.css",
      resourceType: "Stylesheet",
    },
    {
      requestUrl:
        "https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/webfonts/unknown.woff2",
      resourceType: "Font",
    },
  ];
  for (const fixture of rejectedProductionPresentationExternalFixtures) {
    assert.equal(
      exactStaticExternalRuleId({
        requestUrl: fixture.requestUrl,
        method: "GET",
        resourceType: fixture.resourceType,
      }),
      null,
    );
  }
  const externalScopeMismatchFixtures = [
    { headers: { range: "bytes=0-10" } },
    { headers: { authorization: "synthetic" } },
    { headers: { "x-goog-api-key": stagingApiKey } },
    { postData: "synthetic-body" },
  ];
  for (const fixture of externalScopeMismatchFixtures) {
    const decision = externalStaticRequestDecision({
      requestUrl: firebaseModuleUrl,
      method: "GET",
      resourceType: "Script",
      ...fixture,
    });
    assert.equal(decision.scoped, true);
    assert.equal(decision.eligible, false);
  }
  for (const requestUrl of [
    `${firebaseModuleUrl}?unexpected=1`,
    "https://www.gstatic.com/firebasejs/12.9.0/unknown.js",
    "https://unknown-external.invalid/file.js",
  ]) {
    assert.equal(
      exactStaticExternalRuleId({
        requestUrl,
        method: "GET",
        resourceType: "Script",
      }),
      null,
    );
  }
  const externalInspection = inspectNetworkBoundary({
    requestUrl: firebaseModuleUrl,
    method: "GET",
    resourceType: "Script",
    stagingApiKey,
    allowedNonFirebaseOrigins: [stableBrowserOrigin],
  });
  assert.equal(
    stagingApiKeyScopeDecision({
      requestUrl: firebaseModuleUrl,
      method: "GET",
      headers: { "x-goog-api-key": stagingApiKey },
      stagingApiKey,
      inspection: externalInspection,
    }).valid,
    false,
  );
  const firestoreDatabase = `projects/${contract.firebaseProjectId}/databases/(default)`;
  const firestoreWebChannelUrl = new URL(
    "https://firestore.googleapis.com/google.firestore.v1.Firestore/Listen/channel",
  );
  firestoreWebChannelUrl.searchParams.set("database", firestoreDatabase);
  firestoreWebChannelUrl.searchParams.set("VER", "8");
  firestoreWebChannelUrl.searchParams.set("RID", "12345");
  firestoreWebChannelUrl.searchParams.set("CVER", "22");
  firestoreWebChannelUrl.searchParams.set("X-HTTP-Session-Id", "gsessionid");
  firestoreWebChannelUrl.searchParams.set("zx", "abc123");
  firestoreWebChannelUrl.searchParams.set("t", "1");
  const firestoreHeaders = {
    "content-type": "application/x-www-form-urlencoded;charset=UTF-8",
  };
  const firestoreEncodedHeaderBlock = [
    "X-Goog-Api-Client:gl-js/fire/12.9.0",
    `X-Goog-Api-Key:${stagingApiKey}`,
    "Authorization:Bearer synthetic-token",
    "",
  ].join("\r\n");
  const firestorePostData = [
    `headers=${encodeURIComponent(firestoreEncodedHeaderBlock)}`,
    "count=1",
    "ofs=0",
    `req0___data__=${encodeURIComponent('{"database":"staging"}')}`,
  ].join("&");
  const firestoreInspection = inspectNetworkBoundary({
    requestUrl: firestoreWebChannelUrl.toString(),
    method: "POST",
    resourceType: "XHR",
    stagingApiKey,
    allowedNonFirebaseOrigins: [stableBrowserOrigin],
  });
  assert.equal(firestoreInspection.stagingMarker, true);
  assert.equal(
    exactStagingFirestoreWebChannelEncodedApiKeyBodyScope({
      requestUrl: firestoreWebChannelUrl.toString(),
      method: "POST",
      headers: firestoreHeaders,
      postData: firestorePostData,
      stagingApiKey,
      inspection: firestoreInspection,
    }),
    true,
  );
  assert.equal(
    exactStagingFirestoreWebChannelEncodedApiKeyBodyScope({
      requestUrl: firestoreWebChannelUrl.toString(),
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      postData: firestorePostData,
      stagingApiKey,
      inspection: firestoreInspection,
    }),
    true,
  );
  assert.deepEqual(
    stagingApiKeyScopeDecision({
      requestUrl: firestoreWebChannelUrl.toString(),
      method: "POST",
      headers: firestoreHeaders,
      postData: firestorePostData,
      stagingApiKey,
      inspection: firestoreInspection,
    }),
    {
      observedOccurrenceCount: 1,
      approvedOccurrenceCount: 1,
      approvedEncodedBodyOccurrenceCount: 1,
      valid: true,
    },
  );
  const duplicateDatabaseUrl = new URL(firestoreWebChannelUrl);
  duplicateDatabaseUrl.searchParams.append("database", firestoreDatabase);
  const wrongSessionNegotiationUrl = new URL(firestoreWebChannelUrl);
  wrongSessionNegotiationUrl.searchParams.set(
    "X-HTTP-Session-Id",
    "wrong-session-parameter",
  );
  const queryApiKeyUrl = new URL(firestoreWebChannelUrl);
  queryApiKeyUrl.searchParams.set("key", stagingApiKey);
  const rejectedFirestoreWebChannelApiKeyScopes = [
    { method: "GET" },
    {
      requestUrl: firestoreWebChannelUrl
        .toString()
        .replace("/Listen/channel?", "/Listen/channel/extra?"),
    },
    { requestUrl: duplicateDatabaseUrl.toString() },
    { requestUrl: wrongSessionNegotiationUrl.toString() },
    { requestUrl: queryApiKeyUrl.toString() },
    { headers: { "content-type": "application/json" } },
    {
      postData: `${firestorePostData}&headers=${encodeURIComponent(firestoreEncodedHeaderBlock)}`,
    },
    { postData: `req0___data__=${stagingApiKey}` },
    {
      postData: `${firestorePostData}&extra=%77${stagingApiKey.slice(1)}`,
    },
    {
      postData: firestorePostData.replace(
        encodeURIComponent(firestoreEncodedHeaderBlock),
        encodeURIComponent(
          `${firestoreEncodedHeaderBlock}X-Goog-Api-Key:${stagingApiKey}\r\n`,
        ),
      ),
    },
    { postData: `headers=%E0%A4%A${stagingApiKey}` },
    { inspection: { ...firestoreInspection, stagingMarker: false } },
  ];
  for (const fixture of rejectedFirestoreWebChannelApiKeyScopes) {
    assert.equal(
      exactStagingFirestoreWebChannelEncodedApiKeyBodyScope({
        requestUrl: firestoreWebChannelUrl.toString(),
        method: "POST",
        headers: firestoreHeaders,
        postData: firestorePostData,
        stagingApiKey,
        inspection: firestoreInspection,
        ...fixture,
      }),
      false,
    );
  }
  const sensitiveFixtures = [
    {
      postData: credentialValues[0],
      credentialValues,
      marker: "test-credential-scope",
    },
    {
      headers: { "x-test": credentialValues[1] },
      credentialValues,
      marker: "test-credential-scope",
    },
    {
      postData: `refresh_token=${refreshToken}`,
      refreshTokenValues: [refreshToken],
      marker: "refresh-token-scope",
    },
    {
      requestUrl: `${firebaseModuleUrl}?refresh_token=opaque-refresh`,
      marker: "refresh-token-scope",
    },
    {
      headers: { "x-refresh-token": "opaque-refresh" },
      marker: "refresh-token-scope",
    },
    { postData: debugToken, debugToken, marker: "debug-token-scope" },
    {
      headers: { "x-test": APP_CHECK_DEBUG_SENTINEL },
      debugSentinel: APP_CHECK_DEBUG_SENTINEL,
      marker: "debug-sentinel-scope",
    },
  ];
  for (const { marker, ...fixture } of sensitiveFixtures) {
    assert.deepEqual(
      sensitiveMaterialScopeDecision({
        requestUrl: firebaseModuleUrl,
        ...fixture,
      }),
      { valid: false, marker },
    );
  }
  assert.equal(
    exactAuthCredentialBodyRequestScope({
      requestUrl: `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${stagingApiKey}`,
      method: "POST",
      stagingApiKey,
    }),
    true,
  );
  assert.equal(
    exactRefreshTokenBodyRequestScope({
      requestUrl: `https://securetoken.googleapis.com/v1/token?key=${stagingApiKey}`,
      method: "POST",
      stagingApiKey,
    }),
    true,
  );
  for (const requestUrl of [
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${stagingApiKey}`,
    `https://securetoken.googleapis.com/v1/token?key=${stagingApiKey}&key=${stagingApiKey}`,
    `https://securetoken.googleapis.com/v1/other?key=${stagingApiKey}`,
  ]) {
    assert.equal(
      exactRefreshTokenBodyRequestScope({
        requestUrl,
        method: "POST",
        stagingApiKey,
      }),
      false,
    );
  }
  assert.equal(
    optionalTelemetrySuppressionDecision({
      requestUrl:
        "https://firebaseinstallations.googleapis.com/v1/projects/x/installations",
      method: "POST",
    }).eligible,
    true,
  );
  const telemetryUrl =
    "https://firebaseinstallations.googleapis.com/v1/projects/x/installations";
  const telemetryInspection = inspectNetworkBoundary({
    requestUrl: telemetryUrl,
    method: "POST",
    resourceType: "Fetch",
    stagingApiKey,
    allowedNonFirebaseOrigins: [stableBrowserOrigin],
  });
  const telemetrySensitiveCases = [
    {
      postData: stagingApiKey,
      marker: "staging-api-key-scope",
    },
    {
      postData: credentialValues[0],
      marker: "test-credential-scope",
    },
    {
      postData: refreshToken,
      marker: "refresh-token-scope",
    },
    {
      postData: debugToken,
      marker: "debug-token-scope",
    },
    {
      postData: APP_CHECK_DEBUG_SENTINEL,
      marker: "debug-sentinel-scope",
    },
    {
      headers: { "x-vercel-protection-bypass": "synthetic-bypass" },
      bypassSecret: "synthetic-bypass",
      marker: "vercel-bypass-scope",
    },
  ];
  for (const { marker, ...fixture } of telemetrySensitiveCases) {
    assert.deepEqual(
      unifiedSensitivePreTransmissionDecision({
        requestUrl: telemetryUrl,
        method: "POST",
        inspection: telemetryInspection,
        stagingApiKey,
        credentialValues,
        refreshTokenValues: [refreshToken],
        debugToken,
        debugSentinel: APP_CHECK_DEBUG_SENTINEL,
        ...fixture,
      }),
      { valid: false, marker },
    );
  }
  assert.deepEqual(
    [99, 100, 103, 199, 200, 204, 299].map((status) =>
      isInformationalResponseStatus(status),
    ),
    [false, true, true, true, false, false, false],
  );
  const informationalStatuses = [100, 103, 199];
  const terminalStatuses = [99, 200, 204, 299];
  const responseCorrelation = new Map([
    ["request-1", { requestStageDecision: "allow" }],
  ]);
  for (const status of informationalStatuses) {
    const decision = responseStageCorrelationDecision({
      responseStatusCode: status,
    });
    assert.deepEqual(decision, {
      kind: "informational",
      status,
      terminal: false,
    });
    assert.equal(responseCorrelation.has("request-1"), true);
  }
  for (const status of terminalStatuses) {
    const terminalCorrelation = new Map([
      ["request-1", { requestStageDecision: "allow" }],
    ]);
    const decision = responseStageCorrelationDecision({
      responseStatusCode: status,
    });
    assert.equal(decision.terminal, true);
    terminalCorrelation.delete("request-1");
    assert.equal(terminalCorrelation.has("request-1"), false);
  }
  assert.deepEqual(
    responseStageCorrelationDecision({ responseErrorReason: "Failed" }),
    { kind: "response-error", status: null, terminal: true },
  );
  const missingCorrelationFixtures = [
    {
      input: {
        sameFetchState: "terminal-command-in-flight",
        networkIdPresent: true,
        networkAliasStates: ["response-awaiting"],
      },
      expected: "response-correlation-same-fetch-terminal-in-flight",
    },
    {
      input: {
        sameFetchState: "terminal-complete",
        networkIdPresent: true,
        networkAliasStates: [],
      },
      expected: "response-correlation-same-fetch-terminal-complete",
    },
    {
      input: {
        sameFetchState: "handler-failed",
        networkIdPresent: false,
        networkAliasStates: [],
      },
      expected: "response-correlation-same-fetch-other-retired",
    },
    {
      input: {
        sameFetchState: "response-awaiting",
        networkIdPresent: true,
        networkAliasStates: [],
      },
      expected: "response-correlation-same-fetch-active",
    },
    {
      input: {
        networkIdPresent: true,
        networkAliasStates: ["response-awaiting"],
      },
      expected: "response-correlation-same-network-single-active-alias",
    },
    {
      input: {
        networkIdPresent: true,
        networkAliasStates: ["redirect-retired"],
      },
      expected: "response-correlation-same-network-single-retired-alias",
    },
    {
      input: {
        networkIdPresent: true,
        networkAliasStates: ["response-awaiting", "terminal-complete"],
      },
      expected: "response-correlation-same-network-ambiguous",
    },
    {
      input: { networkIdPresent: true, networkAliasStates: [] },
      expected: "response-correlation-network-id-unseen",
    },
    {
      input: { networkIdPresent: false, networkAliasStates: [] },
      expected: "response-correlation-network-id-missing",
    },
  ];
  for (const fixture of missingCorrelationFixtures) {
    assert.equal(
      missingResponseCorrelationFailureReason(fixture.input),
      fixture.expected,
    );
  }
  const parserDocumentOrigin = "https://westory-staging.example";
  const exactParserModulepreloadMarkup =
    '<link rel="modulepreload" crossorigin href="/assets/app-123_ABC.js">';
  const rejectedParserMarkupFixtures = [
    '<link rel="preconnect" href="https://outside.invalid">',
    '<link rel="prefetch" href="https://outside.invalid">',
    '<script type="speculationrules">{}</script>',
    '<a ping="https://outside.invalid">ping</a>',
    '<iframe srcdoc="&lt;img src=https://outside.invalid&gt;"></iframe>',
    '<link rel="pre&#99;onnect" href="https://outside.invalid">',
    `<base href="https://outside.invalid/">${exactParserModulepreloadMarkup}`,
    '<link rel="modulepreload" crossorigin href="https://outside.invalid/assets/app.js">',
    '<link rel="modulepreload" crossorigin href="//outside.invalid/assets/app.js">',
    '<link rel="modulepreload" crossorigin href="/assets/app.js?v=1">',
    '<link rel="modulepreload" crossorigin href="/assets/app.js#fragment">',
    '<link rel="modulepreload" crossorigin href="/assets/nested/app.js">',
    '<link rel="modulepreload" crossorigin href="/assets/app.mjs">',
    '<link rel="modulepreload preload" crossorigin href="/assets/app.js">',
    '<link rel="modulepreload" crossorigin href="/assets/app&#46;js">',
    '<link rel="modulepreload" crossorigin crossorigin href="/assets/app.js">',
  ];
  for (const markup of rejectedParserMarkupFixtures) {
    assert.equal(
      immutableDocumentParserMarkupDecision(markup, {
        documentOrigin: parserDocumentOrigin,
      }).valid,
      false,
    );
  }
  const rejectedParserModulepreloadOrigins = [
    null,
    "http://westory-staging.example",
    "https://user@westory-staging.example",
    "https://westory-staging.example:8443",
  ];
  for (const documentOrigin of rejectedParserModulepreloadOrigins) {
    assert.equal(
      immutableDocumentParserMarkupDecision(exactParserModulepreloadMarkup, {
        documentOrigin,
      }).valid,
      false,
    );
  }
  assert.deepEqual(
    immutableDocumentParserMarkupDecision(
      '<link rel="stylesheet" href="/app.css"><script type="module" src="/app.js"></script>',
    ),
    { valid: true, marker: null },
  );
  assert.deepEqual(
    immutableDocumentParserMarkupDecision(exactParserModulepreloadMarkup, {
      documentOrigin: parserDocumentOrigin,
    }),
    { valid: true, marker: null },
  );
  for (const toolbarMarkup of [
    `<script src="${VERCEL_PREVIEW_TOOLBAR_SCRIPT_URL}"></script>`,
    '<script src="//vercel.live/_next-live/feedback/feedback.js"></script>',
    '<script src="https://candidate.invalid/_next-live/feedback/feedback.js"></script>',
    '<script src="HTTPS://VERCEL.LIVE/_NEXT-LIVE/FEEDBACK/FEEDBACK.JS?variant=1"></script>',
    '<script src="/_next-live/feedback/feedback.js"></script>',
    '<script src="./_next-live/feedback/feedback.js"></script>',
    '<script src="_next-live/feedback/feedback.js"></script>',
    '<script src="https:&#x2f;&#x2f;vercel.live&#x2f;_next-live&#x2f;feedback&#x2f;feedback.js"></script>',
    '<script src="https://vercel.live/_next-live/feedback/fee&#x64;back.js"></script>',
    '<script src="&Tab;https://vercel.live/_next-live/feedback/feedback.js"></script>',
    '<script src=" &#x2f;_next-live/feedback/feedback.js&#x20;"></script>',
    '<script src="&#92;_next-live&#92;feedback&#92;feedback.js"></script>',
    '<script src="&bsol;_next-live&bsol;feedback&bsol;feedback.js"></script>',
    '<script src="https://vercel.live/_next-live/feedback/feed&NewLine;back.js"></script>',
    '<script data-x="> src=\'/safe.js\'" src="https://vercel.live/_next-live/feedback/feedback.js"></script>',
    '<script/src="https://vercel.live/_next-live/feedback/feedback.js"></script>',
    '<!--><script src="https://vercel.live/_next-live/feedback/feedback.js"></script>',
    '<!---><script src="https://vercel.live/_next-live/feedback/feedback.js"></script>',
    '<!--x--!><script src="https://vercel.live/_next-live/feedback/feedback.js"></script>',
    '<div data-vercel-toolbar="true"></div>',
  ]) {
    assert.equal(containsVercelPreviewToolbarMarkup(toolbarMarkup), true);
  }
  for (const ordinaryMarkup of [
    '<script type="module" src="/assets/app.js"></script>',
    "<p>Deployed with Vercel.</p>",
    '<!-- <script src="https://vercel.live/_next-live/feedback/feedback.js"></script> -->',
    '<div data-vercel-toolbar-disabled="true"></div>',
    "<p>/_next-live/feedback/feedback.js</p>",
    '<script data-x=" src=\'https://vercel.live/_next-live/feedback/feedback.js\'" src="/assets/app.js"></script>',
    "<script>const inert = \"<script src='https://vercel.live/_next-live/feedback/feedback.js'>\";</script>",
    '<script src="&SOL;_next-live/feedback/feedback.js"></script>',
    '<script src="&sol_next-live/feedback/feedback.js"></script>',
    '<script src="&Backslash;_next-live&Backslash;feedback&Backslash;feedback.js"></script>',
    '<script src="&tab;_next-live/feedback/feedback.js"></script>',
  ]) {
    assert.equal(containsVercelPreviewToolbarMarkup(ordinaryMarkup), false);
  }
  assert.deepEqual(createNodeOwnedVercelRequestHeaders(), {
    "cache-control": "no-cache",
    "x-vercel-skip-toolbar": "1",
  });
  assert.deepEqual(createNodeOwnedVercelRequestHeaders("fixed-test-secret"), {
    "cache-control": "no-cache",
    "x-vercel-protection-bypass": "fixed-test-secret",
    "x-vercel-skip-toolbar": "1",
  });
  assert.equal(
    hasVercelSkipToolbarRequestHeader({ "X-Vercel-Skip-Toolbar": "1" }),
    true,
  );
  assert.equal(
    hasVercelSkipToolbarRequestHeader({ "cache-control": "no-cache" }),
    false,
  );
  const malformedHeaderFixture = "fixed-test-secret\r\ninvalid: 1";
  let malformedHeaderError = null;
  try {
    createNodeOwnedVercelRequestHeaders(malformedHeaderFixture);
  } catch (error) {
    malformedHeaderError = error;
  }
  assert.ok(malformedHeaderError instanceof Error);
  assert.equal(
    `${malformedHeaderError.message}\n${malformedHeaderError.stack || ""}`.includes(
      "fixed-test-secret",
    ),
    false,
  );
  for (const forbiddenHeader of [
    "authorization",
    "cookie",
    "origin",
    "referer",
  ]) {
    assert.equal(
      Object.hasOwn(
        createNodeOwnedVercelRequestHeaders("fixed-test-secret"),
        forbiddenHeader,
      ),
      false,
    );
  }
  const firebaseRule =
    contract.networkBoundary.externalStaticRequestAllowlist.rules.find(
      ({ id }) => id === "firebase-esm-12.9.0",
    );
  assert.ok(firebaseRule);
  for (const pathname of Object.keys(firebaseRule.localModules)) {
    const payload = localFirebaseModulePayload(
      `https://${firebaseRule.hostname}${pathname}`,
    );
    const responseHeaders = Object.fromEntries(
      payload.responseHeaders.map(({ name, value }) => [name, value]),
    );
    assert.equal(responseHeaders["access-control-allow-origin"], "*");
    assert.equal(
      responseHeaders["cross-origin-resource-policy"],
      "cross-origin",
    );
    assert.equal(responseHeaders["cache-control"], "no-store");
  }
  return {
    acceptedDeterministicHolidayCaseCount: 1,
    rejectedDeterministicHolidayScopeCaseCount: rejectedHolidayRequests.length,
    acceptedDeterministicRecaptchaCaseCount: 1,
    rejectedRecaptchaPathCaseCount: 1,
    acceptedExternalStaticCaseCount: 1,
    acceptedProductionPresentationExternalStaticCaseCount:
      productionPresentationExternalFixtures.length,
    rejectedExternalStaticHeadCaseCount: 1,
    rejectedExternalStaticSensitiveInputCaseCount:
      externalScopeMismatchFixtures.length,
    rejectedExternalStaticPathCaseCount: 3,
    rejectedProductionPresentationExternalStaticCaseCount:
      rejectedProductionPresentationExternalFixtures.length,
    rejectedStagingApiKeyExfiltrationCaseCount: 1,
    acceptedFirestoreWebChannelEncodedApiKeyCaseCount: 2,
    rejectedFirestoreWebChannelEncodedApiKeyCaseCount:
      rejectedFirestoreWebChannelApiKeyScopes.length,
    rejectedSensitiveMaterialExfiltrationCaseCount: sensitiveFixtures.length,
    acceptedExactAuthCredentialBodyScopeCaseCount: 1,
    acceptedExactRefreshTokenBodyScopeCaseCount: 1,
    rejectedRefreshTokenBodyScopeCaseCount: 3,
    optionalTelemetrySuppressionCaseCount: 1,
    sensitiveBeforeTelemetryPrecedenceCaseCount: telemetrySensitiveCases.length,
    informationalResponseNonterminalCaseCount: informationalStatuses.length,
    informationalResponseTerminalCaseCount: terminalStatuses.length,
    rejectedImmutableParserMarkupCaseCount:
      rejectedParserMarkupFixtures.length +
      rejectedParserModulepreloadOrigins.length,
    acceptedImmutableParserMarkupCaseCount: 2,
    verifiedLocalFirebaseModuleCaseCount: Object.keys(firebaseRule.localModules)
      .length,
  };
};
const verifyAllowedEgressResponseLifecycleFixtures = async () => {
  const primaryRequestEvent = {
    requestId: "fixture-primary-fetch",
    networkId: "fixture-network",
    frameId: "fixture-frame",
    resourceType: "XHR",
    request: {
      url: "https://firestore.googleapis.com/google.firestore.v1.Firestore/Listen/channel",
      method: "POST",
    },
  };
  const primaryRequestInvariant =
    allowedEgressRequestInvariantForEvent(primaryRequestEvent);
  assert.ok(primaryRequestInvariant);
  const lifecycleByFetchRequestId = new Map([
    [
      primaryRequestEvent.requestId,
      Object.freeze({
        primaryRequestId: primaryRequestEvent.requestId,
        requestInvariant: primaryRequestInvariant,
        networkId: primaryRequestEvent.networkId,
        state: "final-response-released",
        diagnosticPhase: "screen-interaction",
      }),
    ],
  ]);
  const fetchRequestIdsByNetworkId = new Map([
    [primaryRequestEvent.networkId, new Set([primaryRequestEvent.requestId])],
  ]);
  const directPostFinalErrorEvent = {
    ...primaryRequestEvent,
    responseErrorReason: "Aborted",
  };
  const directCorrelation = resolveAllowedEgressResponseCorrelation({
    event: directPostFinalErrorEvent,
    lifecycleByFetchRequestId,
    fetchRequestIdsByNetworkId,
  });
  assert.equal(directCorrelation.valid, true);
  assert.equal(directCorrelation.source, "same-fetch");
  const directTransition = allowedEgressResponseLifecycleDecision({
    lifecycleState: directCorrelation.lifecycle.state,
    responseStageDecision: responseStageCorrelationDecision({
      responseErrorReason: directPostFinalErrorEvent.responseErrorReason,
    }),
  });
  assert.deepEqual(directTransition, {
    valid: true,
    kind: "post-final-error",
    reason: null,
  });
  assert.deepEqual(
    postFinalErrorContinueResponseParams(directPostFinalErrorEvent.requestId),
    { requestId: directPostFinalErrorEvent.requestId },
  );
  for (const message of POST_FINAL_ALREADY_RETIRED_INTERCEPTION_ERROR_MESSAGES) {
    assert.equal(
      isPostFinalAlreadyRetiredInterceptionError(new Error(message)),
      true,
    );
  }
  const protocolErrorFixture = new Error(
    "Protocol error (Fetch.continueResponse): Invalid InterceptionId.",
  );
  protocolErrorFixture.name = "ProtocolError";
  assert.equal(
    isPostFinalAlreadyRetiredInterceptionError(protocolErrorFixture),
    true,
  );
  for (const rejectedError of [
    new Error("Invalid InterceptionId"),
    new Error(
      "Protocol error (Fetch.continueResponse): Invalid InterceptionId",
    ),
    new Error("Protocol error (Fetch.continueResponse): Other failure"),
    new Error(
      "Protocol error (Fetch.continueRequest): Invalid InterceptionId.",
    ),
    new Error("Protocol error (Fetch.failRequest): Invalid InterceptionId."),
    new Error(
      "Protocol error (Fetch.continueResponse): Invalid state for continueInterceptedRequest",
    ),
    new Error(
      "Protocol error (Fetch.continueResponse): Invalid InterceptionId. trailing",
    ),
    {
      message:
        "Protocol error (Fetch.continueResponse): Invalid InterceptionId.",
    },
  ]) {
    assert.equal(
      isPostFinalAlreadyRetiredInterceptionError(rejectedError),
      false,
    );
  }
  const aliasPostFinalErrorEvent = {
    ...directPostFinalErrorEvent,
    requestId: "fixture-response-fetch-alias",
  };
  const aliasCorrelation = resolveAllowedEgressResponseCorrelation({
    event: aliasPostFinalErrorEvent,
    lifecycleByFetchRequestId,
    fetchRequestIdsByNetworkId,
  });
  assert.equal(aliasCorrelation.valid, true);
  assert.equal(aliasCorrelation.source, "same-network-single-alias");
  assert.equal(
    aliasCorrelation.primaryRequestId,
    primaryRequestEvent.requestId,
  );
  const mismatchCorrelation = resolveAllowedEgressResponseCorrelation({
    event: {
      ...aliasPostFinalErrorEvent,
      request: {
        ...aliasPostFinalErrorEvent.request,
        url: `${aliasPostFinalErrorEvent.request.url}/mismatch`,
      },
    },
    lifecycleByFetchRequestId,
    fetchRequestIdsByNetworkId,
  });
  assert.equal(mismatchCorrelation.valid, false);
  assert.equal(
    mismatchCorrelation.reason,
    "response-correlation-request-invariant-mismatch",
  );
  const ambiguousLifecycleByFetchRequestId = new Map(lifecycleByFetchRequestId);
  ambiguousLifecycleByFetchRequestId.set(
    "fixture-second-primary-fetch",
    Object.freeze({
      primaryRequestId: "fixture-second-primary-fetch",
      requestInvariant: primaryRequestInvariant,
      networkId: primaryRequestEvent.networkId,
      state: "response-awaiting",
      diagnosticPhase: "screen-interaction",
    }),
  );
  const ambiguousFetchRequestIdsByNetworkId = new Map([
    [
      primaryRequestEvent.networkId,
      new Set([primaryRequestEvent.requestId, "fixture-second-primary-fetch"]),
    ],
  ]);
  const ambiguousCorrelation = resolveAllowedEgressResponseCorrelation({
    event: aliasPostFinalErrorEvent,
    lifecycleByFetchRequestId: ambiguousLifecycleByFetchRequestId,
    fetchRequestIdsByNetworkId: ambiguousFetchRequestIdsByNetworkId,
  });
  assert.equal(ambiguousCorrelation.valid, false);
  assert.equal(
    ambiguousCorrelation.reason,
    "response-correlation-same-network-ambiguous",
  );
  const invalidCorrelation = resolveAllowedEgressResponseCorrelation({
    event: { ...aliasPostFinalErrorEvent, resourceType: undefined },
    lifecycleByFetchRequestId,
    fetchRequestIdsByNetworkId,
  });
  assert.equal(invalidCorrelation.valid, false);
  assert.equal(
    invalidCorrelation.reason,
    "response-correlation-request-invariant-invalid",
  );
  assert.deepEqual(
    allowedEgressResponseLifecycleDecision({
      lifecycleState: "final-response-released",
      responseStageDecision: responseStageCorrelationDecision({
        responseStatusCode: 200,
      }),
    }),
    {
      valid: false,
      kind: "reject",
      reason: "response-correlation-final-released-invalid-transition",
    },
  );

  const proxyCounts = { authorize: 0, complete: 0, revoke: 0 };
  const proxyCoordinator = createSingleOwnerProxyAuthorizationCoordinator({
    onAuthorize: () => {
      proxyCounts.authorize += 1;
    },
    onComplete: () => {
      proxyCounts.complete += 1;
    },
    onRevoke: () => {
      proxyCounts.revoke += 1;
    },
  });
  proxyCoordinator.authorize(primaryRequestEvent.requestId, {});
  const taskCoordinator = createPerCorrelationTaskCoordinator();
  const serializedOrder = [];
  let resolveFinalStarted;
  const finalStarted = new Promise((resolve) => {
    resolveFinalStarted = resolve;
  });
  let releaseFinalCommand;
  const finalCommandGate = new Promise((resolve) => {
    releaseFinalCommand = resolve;
  });
  let serializedLifecycleState = "final-response-command-in-flight";
  const finalTask = taskCoordinator.enqueue(
    primaryRequestEvent.requestId,
    async () => {
      serializedOrder.push("final-start");
      resolveFinalStarted();
      await finalCommandGate;
      assert.equal(
        proxyCoordinator.complete(primaryRequestEvent.requestId),
        true,
      );
      serializedLifecycleState = "final-response-released";
      serializedOrder.push("final-released");
    },
  );
  const postFinalErrorTask = taskCoordinator.enqueue(
    primaryRequestEvent.requestId,
    async () => {
      serializedOrder.push("post-final-error-start");
      const transition = allowedEgressResponseLifecycleDecision({
        lifecycleState: serializedLifecycleState,
        responseStageDecision: responseStageCorrelationDecision({
          responseErrorReason: "Aborted",
        }),
      });
      assert.equal(transition.kind, "post-final-error");
      assert.deepEqual(
        postFinalErrorContinueResponseParams(
          aliasPostFinalErrorEvent.requestId,
        ),
        { requestId: aliasPostFinalErrorEvent.requestId },
      );
      serializedLifecycleState = "terminal-complete";
      serializedOrder.push("post-final-error-complete");
    },
  );
  await finalStarted;
  assert.deepEqual(serializedOrder, ["final-start"]);
  releaseFinalCommand();
  await Promise.all([finalTask, postFinalErrorTask]);
  assert.deepEqual(serializedOrder, [
    "final-start",
    "final-released",
    "post-final-error-start",
    "post-final-error-complete",
  ]);
  assert.equal(serializedLifecycleState, "terminal-complete");
  assert.equal(proxyCoordinator.complete(primaryRequestEvent.requestId), false);
  assert.equal(proxyCoordinator.revoke(primaryRequestEvent.requestId), false);
  assert.deepEqual(proxyCounts, { authorize: 1, complete: 1, revoke: 0 });
  assert.equal(proxyCoordinator.activeCount(), 0);
  assert.equal(taskCoordinator.pendingCount(), 0);
  const retiredProxyCounts = { authorize: 0, complete: 0, revoke: 0 };
  const retiredProxyCoordinator =
    createSingleOwnerProxyAuthorizationCoordinator({
      onAuthorize: () => {
        retiredProxyCounts.authorize += 1;
      },
      onComplete: () => {
        retiredProxyCounts.complete += 1;
      },
      onRevoke: () => {
        retiredProxyCounts.revoke += 1;
      },
    });
  retiredProxyCoordinator.authorize(primaryRequestEvent.requestId, {});
  assert.equal(
    retiredProxyCoordinator.complete(primaryRequestEvent.requestId),
    true,
  );
  let retiredLifecycleState = "final-response-released";
  try {
    throw new Error(
      "Protocol error (Fetch.continueResponse): Invalid InterceptionId.",
    );
  } catch (error) {
    assert.equal(isPostFinalAlreadyRetiredInterceptionError(error), true);
    retiredLifecycleState = "post-final-error-observed-retired";
  }
  assert.equal(retiredLifecycleState, "post-final-error-observed-retired");
  assert.equal(
    allowedEgressResponseLifecycleDecision({
      lifecycleState: retiredLifecycleState,
      responseStageDecision: responseStageCorrelationDecision({
        responseErrorReason: "Failed",
      }),
    }).valid,
    false,
  );
  assert.equal(
    retiredProxyCoordinator.revoke(primaryRequestEvent.requestId),
    false,
  );
  assert.deepEqual(retiredProxyCounts, {
    authorize: 1,
    complete: 1,
    revoke: 0,
  });
  return {
    allowedEgressFinalToErrorTransitionCaseCount: 1,
    allowedEgressSerializedInFlightCaseCount: 1,
    allowedEgressSingleNetworkAliasCaseCount: 1,
    rejectedAllowedEgressCorrelationCaseCount: 3,
    allowedEgressProxySingleCompletionCaseCount: 1,
    allowedEgressRetiredInterceptionCaseCount: 1,
  };
};
const verifyPostDataAndResponseSanitizationNegativeFixtures = async () => {
  const inline = await resolvePausedRequestPostData({
    event: {
      request: { postData: "exact-body", hasPostData: true },
    },
    send: async () => assert.fail("Inline POST data must not query Network."),
  });
  assert.deepEqual(inline, {
    postData: "exact-body",
    postDataBytes: 10,
    source: "fetch-inline",
  });
  const absent = await resolvePausedRequestPostData({
    event: { request: { hasPostData: false } },
    send: async () => assert.fail("Absent POST data must not query Network."),
  });
  assert.deepEqual(absent, {
    postData: "",
    postDataBytes: 0,
    source: "absent",
  });
  let networkReadCount = 0;
  const recovered = await resolvePausedRequestPostData({
    event: {
      networkId: "network-request-1",
      request: { hasPostData: true },
    },
    send: async (method, { requestId }) => {
      assert.equal(method, "Network.getRequestPostData");
      assert.equal(requestId, "network-request-1");
      networkReadCount += 1;
      return { postData: "network-body" };
    },
  });
  assert.deepEqual(recovered, {
    postData: "network-body",
    postDataBytes: 12,
    source: "network-domain",
  });
  assert.equal(networkReadCount, 1);
  const rejectedCodes = [];
  for (const fixture of [
    {
      event: { request: { hasPostData: true } },
      send: async () => ({ postData: "unreachable" }),
      code: "missing-network-id",
    },
    {
      event: {
        networkId: "network-request-2",
        request: { hasPostData: true },
      },
      send: async () => {
        throw new Error("synthetic Network failure");
      },
      code: "network-read-failed",
    },
    {
      event: { request: { postData: "oversize", hasPostData: true } },
      send: async () => ({ postData: "unreachable" }),
      maximumBytes: 4,
      code: "maximum-bytes-exceeded",
    },
    {
      event: {
        request: {
          postData: "one",
          hasPostData: true,
          postDataEntries: [{ bytes: Buffer.from("two").toString("base64") }],
        },
      },
      send: async () => ({ postData: "unreachable" }),
      code: "representation-mismatch",
    },
  ]) {
    await assert.rejects(resolvePausedRequestPostData(fixture), (error) => {
      assert.ok(error instanceof PausedRequestPostDataResolutionError);
      assert.equal(error.code, fixture.code);
      rejectedCodes.push(error.code);
      return true;
    });
  }
  const egressHeaderNames = [
    "Alt-Svc",
    "Clear-Site-Data",
    "Content-Security-Policy",
    "Content-Security-Policy-Report-Only",
    "Link",
    "Location",
    "NEL",
    "Refresh",
    "Report-To",
    "Reporting-Endpoints",
    "Set-Cookie",
    "Speculation-Rules",
    "X-DNS-Prefetch-Control",
  ];
  const sanitized = sanitizeBrowserResponseHeaders([
    { name: "Access-Control-Allow-Origin", value: "*" },
    { name: "Content-Type", value: "application/json" },
    { name: "X-HTTP-Session-Id", value: "omitted-without-request-scope" },
    ...egressHeaderNames.map((name) => ({
      name,
      value: name === "Location" ? "https://outside.invalid" : "blocked",
    })),
    { name: "X-Unknown-Response-Metadata", value: "omitted" },
  ]);
  assert.deepEqual(sanitized.responseHeaders, [
    { name: "access-control-allow-origin", value: "*" },
    { name: "content-type", value: "application/json" },
  ]);
  assert.equal(
    sanitized.egressHeaderObservationCount,
    egressHeaderNames.length,
  );
  assert.equal(sanitized.omittedHeaderCount, egressHeaderNames.length + 2);
  assert.equal(sanitized.conditionalHeaderForwardCount, 0);
  const conditionallySanitized = sanitizeBrowserResponseHeaders(
    [{ name: "X-HTTP-Session-Id", value: "session_123-ABC" }],
    {
      conditionalResponseHeaderRuleId:
        FIRESTORE_WEBCHANNEL_SESSION_RESPONSE_RULE_ID,
    },
  );
  assert.deepEqual(conditionallySanitized.responseHeaders, [
    { name: "x-http-session-id", value: "session_123-ABC" },
  ]);
  assert.equal(conditionallySanitized.conditionalHeaderForwardCount, 1);
  const responseHeaderDiagnosticChecks = [];
  assert.throws(() =>
    sanitizeBrowserResponseHeaders([], {
      conditionalResponseHeaderRuleId: "unknown-rule",
      onDiagnosticCheck: (reason) =>
        responseHeaderDiagnosticChecks.push(reason),
    }),
  );
  assert.equal(
    responseHeaderDiagnosticChecks.at(-1),
    "response-rule-id-invalid",
  );
  responseHeaderDiagnosticChecks.length = 0;
  assert.throws(() =>
    sanitizeBrowserResponseHeaders(
      [
        { name: "X-HTTP-Session-Id", value: "first" },
        { name: "x-http-session-id", value: "second" },
      ],
      {
        conditionalResponseHeaderRuleId:
          FIRESTORE_WEBCHANNEL_SESSION_RESPONSE_RULE_ID,
        onDiagnosticCheck: (reason) =>
          responseHeaderDiagnosticChecks.push(reason),
      },
    ),
  );
  assert.equal(
    responseHeaderDiagnosticChecks.at(-1),
    "response-session-header-duplicate",
  );
  for (const value of ["", "invalid\r\nvalue", "invalid\0value"]) {
    assert.throws(() =>
      sanitizeBrowserResponseHeaders([{ name: "X-HTTP-Session-Id", value }], {
        conditionalResponseHeaderRuleId:
          FIRESTORE_WEBCHANNEL_SESSION_RESPONSE_RULE_ID,
      }),
    );
  }
  return {
    fullPostDataInlineCaseCount: 1,
    fullPostDataAbsentCaseCount: 1,
    fullPostDataNetworkFallbackCaseCount: 1,
    fullPostDataRejectedCaseCount: rejectedCodes.length,
    responseHeaderAllowedCaseCount: sanitized.responseHeaders.length,
    responseHeaderEgressRejectedCaseCount:
      sanitized.egressHeaderObservationCount,
    responseHeaderUnknownRejectedCaseCount: 1,
    responseHeaderConditionalRejectedCaseCount: 1,
    responseHeaderConditionalAllowedCaseCount: 1,
    responseHeaderConditionalInvalidCaseCount: 5,
  };
};
const verifyPreTransmissionBoundaryNegativeFixtures = () => {
  assert.throws(() => resolvePlaywrightPrivateCdpBoundaryShape({}));
  const cases = [
    {
      method: "GET",
      inspection: {
        productionMarker: true,
        unboundFirebaseRequest: false,
        isFirebaseRequest: false,
        nonFirebaseHostnameAllowed: false,
      },
      marker: "production",
    },
    {
      method: "POST",
      inspection: {
        productionMarker: true,
        unboundFirebaseRequest: false,
        isFirebaseRequest: false,
        nonFirebaseHostnameAllowed: false,
      },
      marker: "production",
    },
    {
      method: "GET",
      inspection: {
        productionMarker: false,
        crossOriginDocument: true,
        unboundFirebaseRequest: false,
        isFirebaseRequest: false,
        nonFirebaseHostnameAllowed: true,
      },
      marker: "cross-origin-document",
    },
    {
      method: "POST",
      inspection: {
        productionMarker: false,
        unboundFirebaseRequest: true,
        isFirebaseRequest: true,
        nonFirebaseHostnameAllowed: false,
      },
      marker: "unbound-firebase",
    },
    {
      method: "GET",
      inspection: {
        productionMarker: false,
        unboundFirebaseRequest: false,
        isFirebaseRequest: false,
        nonFirebaseHostnameAllowed: false,
      },
      marker: "non-firebase-hostname-not-allowlisted",
    },
  ];
  for (const fixture of cases) {
    const decision = preTransmissionBoundaryDecision(fixture.inspection);
    assert.deepEqual(decision, { block: true, marker: fixture.marker });
    assert.ok(["GET", "POST"].includes(fixture.method));
  }
  assert.deepEqual(
    preTransmissionBoundaryDecision({
      productionMarker: false,
      unboundFirebaseRequest: false,
      isFirebaseRequest: false,
      nonFirebaseHostnameAllowed: true,
    }),
    { block: false, marker: null },
  );
  assert.deepEqual(
    preTransmissionBoundaryDecision({
      productionMarker: false,
      unboundFirebaseRequest: false,
      isFirebaseRequest: true,
      nonFirebaseHostnameAllowed: false,
    }),
    { block: false, marker: null },
  );
  for (const fixture of [
    {
      requestUrl:
        "https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;500;700;800;900&display=swap",
      resourceType: "Stylesheet",
    },
    {
      requestUrl: "https://fonts.gstatic.com/s/notosanskr/v1/fixture.woff2",
      resourceType: "Font",
    },
  ]) {
    assert.equal(
      isNonFirebaseHostnameAllowed({
        ...fixture,
        method: "GET",
        isFirebaseRequest: false,
        allowedOrigins: ["https://stable.example.vercel.app"],
      }),
      true,
    );
  }
  assert.equal(
    isNonFirebaseHostnameAllowed({
      requestUrl: "https://unknown.example/exfiltrate",
      method: "GET",
      resourceType: "Fetch",
      isFirebaseRequest: false,
      allowedOrigins: ["https://stable.example.vercel.app"],
    }),
    false,
  );
  assert.equal(
    isNonFirebaseHostnameAllowed({
      requestUrl: "https://stable.example.vercel.app./",
      method: "GET",
      resourceType: "Document",
      isFirebaseRequest: false,
      allowedOrigins: ["https://stable.example.vercel.app"],
    }),
    false,
  );
  assert.equal(canonicalNetworkHostname("WESTORY.KR."), "westory.kr");
  assert.equal(canonicalNetworkHostname("westory.kr..."), "westory.kr");
  assert.equal(canonicalNetworkHostname("[2001:DB8::1]"), "[2001:db8::1]");
  const syntheticStagingApiKey = "w10p-synthetic-staging-api-key";
  const boundaryFixture = ({ requestUrl, apiKeyHeaderValues = [] }) =>
    inspectNetworkBoundary({
      requestUrl,
      method: "GET",
      resourceType: "Fetch",
      apiKeyHeaderValues,
      stagingApiKey: syntheticStagingApiKey,
      allowedNonFirebaseOrigins: ["https://stable.example.vercel.app"],
    });
  for (const method of ["GET", "POST"]) {
    const inspection = boundaryFixture({
      requestUrl: `https://westory.kr./terminal-dot-${method.toLowerCase()}`,
    });
    assert.equal(inspection.canonicalHostname, "westory.kr");
    assert.deepEqual(preTransmissionBoundaryDecision(inspection), {
      block: true,
      marker: "production",
    });
  }
  for (const hostname of [
    "identitytoolkit.googleapis.com.",
    "securetoken.googleapis.com.",
  ]) {
    const inspection = boundaryFixture({
      requestUrl: `https://${hostname}/v1/token?key=production-key&continueUrl=https://example.invalid/${contract.firebaseProjectId}`,
    });
    assert.equal(inspection.firebaseService, "auth");
    assert.equal(inspection.stagingMarker, false);
    assert.equal(inspection.unboundFirebaseRequest, true);
    assert.deepEqual(preTransmissionBoundaryDecision(inspection), {
      block: true,
      marker: "unbound-firebase",
    });
  }
  const headerKeyDecoyInspection = boundaryFixture({
    requestUrl: `https://identitytoolkit.googleapis.com./v1/accounts:signInWithPassword?continueUrl=https://example.invalid/${contract.firebaseProjectId}`,
    apiKeyHeaderValues: ["production-key"],
  });
  assert.equal(headerKeyDecoyInspection.apiKeyValueCount, 1);
  assert.equal(headerKeyDecoyInspection.apiKeyBindingValid, false);
  assert.deepEqual(preTransmissionBoundaryDecision(headerKeyDecoyInspection), {
    block: true,
    marker: "unbound-firebase",
  });
  const duplicateKeyInspection = boundaryFixture({
    requestUrl: `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${syntheticStagingApiKey}&key=${syntheticStagingApiKey}`,
  });
  assert.equal(duplicateKeyInspection.apiKeyValueCount, 2);
  assert.equal(duplicateKeyInspection.apiKeyBindingValid, false);
  assert.deepEqual(preTransmissionBoundaryDecision(duplicateKeyInspection), {
    block: true,
    marker: "unbound-firebase",
  });
  const unknownAppCheckResourceInspection = boundaryFixture({
    requestUrl: `https://content-firebaseappcheck.googleapis.com/v1/projects/unknown-project/apps/1:999:web:unknown:exchangeDebugToken?key=${syntheticStagingApiKey}`,
  });
  assert.equal(unknownAppCheckResourceInspection.serviceResourceBound, false);
  assert.deepEqual(
    preTransmissionBoundaryDecision(unknownAppCheckResourceInspection),
    { block: true, marker: "unbound-firebase" },
  );
  const unknownFirestoreResourceInspection = boundaryFixture({
    requestUrl: `https://firestore.googleapis.com/v1/projects/unknown-project/databases/(default)/documents?continueUrl=https://example.invalid/projects/${contract.firebaseProjectId}/databases/(default)`,
  });
  assert.equal(unknownFirestoreResourceInspection.serviceResourceBound, false);
  assert.deepEqual(
    preTransmissionBoundaryDecision(unknownFirestoreResourceInspection),
    { block: true, marker: "unbound-firebase" },
  );
  const unknownStorageResourceInspection = boundaryFixture({
    requestUrl: `https://firebasestorage.googleapis.com/v0/b/unknown-project.appspot.com/o/file?decoy=${contract.firebaseProjectId}`,
  });
  assert.equal(unknownStorageResourceInspection.serviceResourceBound, false);
  assert.deepEqual(
    preTransmissionBoundaryDecision(unknownStorageResourceInspection),
    { block: true, marker: "unbound-firebase" },
  );
  const exactLegacyRealtimeDatabaseInspection = boundaryFixture({
    requestUrl: `https://${contract.firebaseProjectId}.firebaseio.com/fixture.json`,
  });
  assert.equal(
    exactLegacyRealtimeDatabaseInspection.firebaseService,
    "realtime-database",
  );
  assert.equal(
    exactLegacyRealtimeDatabaseInspection.serviceResourceBound,
    true,
  );
  assert.deepEqual(
    preTransmissionBoundaryDecision(exactLegacyRealtimeDatabaseInspection),
    { block: false, marker: null },
  );
  const regionalRealtimeDatabaseNegativeFixtures = [
    {
      hostname:
        "history-quiz-yongsin-default-rtdb.asia-southeast1.firebasedatabase.app",
      marker: "production",
    },
    {
      hostname:
        "unknown-project-default-rtdb.europe-west1.firebasedatabase.app",
      marker: "unbound-firebase",
    },
    {
      hostname: `${contract.firebaseProjectId}-default-rtdb.asia-southeast1.firebasedatabase.app`,
      marker: "unbound-firebase",
    },
    {
      hostname: `${contract.firebaseProjectId}-alternate.europe-west1.firebasedatabase.app.`,
      marker: "unbound-firebase",
    },
  ];
  for (const { hostname, marker } of regionalRealtimeDatabaseNegativeFixtures) {
    const inspection = boundaryFixture({
      requestUrl: `https://${hostname}/fixture.json?decoy=${contract.firebaseProjectId}`,
    });
    assert.equal(inspection.firebaseService, "realtime-database");
    assert.equal(inspection.serviceResourceBound, false);
    assert.equal(inspection.stagingMarker, false);
    assert.deepEqual(preTransmissionBoundaryDecision(inspection), {
      block: true,
      marker,
    });
  }
  const insecureFirebaseTransportInspection = boundaryFixture({
    requestUrl: `http://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${syntheticStagingApiKey}`,
  });
  assert.equal(
    insecureFirebaseTransportInspection.firebaseTransportValid,
    false,
  );
  assert.deepEqual(
    preTransmissionBoundaryDecision(insecureFirebaseTransportInspection),
    { block: true, marker: "unbound-firebase" },
  );
  const malformedEncodingInspection = boundaryFixture({
    requestUrl: "https://fonts.googleapis.com/css2?family=%ZZ",
  });
  assert.equal(malformedEncodingInspection.malformedUrlEncoding, true);
  assert.deepEqual(
    preTransmissionBoundaryDecision(malformedEncodingInspection),
    {
      block: true,
      marker: "malformed-url-encoding",
    },
  );
  return {
    preTransmissionProductionGetRejectedCaseCount: 1,
    preTransmissionProductionPostRejectedCaseCount: 1,
    preTransmissionCrossOriginDocumentRejectedCaseCount: 1,
    preTransmissionUnboundFirebaseRejectedCaseCount: 1,
    preTransmissionUnallowlistedNonFirebaseRejectedCaseCount: 1,
    preTransmissionAcceptedStagingCaseCount: 1,
    preTransmissionAcceptedBoundFirebaseCaseCount: 1,
    preTransmissionAllowedNonVercelExternalCaseCount: 2,
    preTransmissionRejectedUnknownVercelHostnameCaseCount: 2,
    preTransmissionRejectedDottedProductionCustomDomainCaseCount: 2,
    preTransmissionRejectedDottedFirebaseAuthCaseCount: 2,
    preTransmissionRejectedHeaderApiKeyDecoyCaseCount: 1,
    preTransmissionRejectedDuplicateApiKeyCaseCount: 1,
    preTransmissionRejectedUnknownAppCheckResourceCaseCount: 1,
    preTransmissionRejectedUnknownFirestoreResourceCaseCount: 1,
    preTransmissionRejectedUnknownStorageResourceCaseCount: 1,
    preTransmissionAcceptedExactLegacyRealtimeDatabaseCaseCount: 1,
    preTransmissionRejectedRegionalRealtimeDatabaseCaseCount: 4,
    preTransmissionRejectedInsecureFirebaseTransportCaseCount: 1,
    preTransmissionRejectedMalformedPercentEncodingCaseCount: 1,
    hostnameCanonicalizationIpv6PreservationCaseCount: 1,
    playwrightPrivateCdpShapeMismatchRejectedCaseCount: 1,
  };
};
const verifyFixtureAuditFreshnessNegativeFixtures = () => {
  const freshness = {
    issuedAt: "2026-08-24T00:00:00.000Z",
    expiresAt: "2026-08-24T01:00:00.000Z",
    maxAgeSeconds: 3600,
    fixedFixtureTime: contract.fixedTime,
  };
  assert.doesNotThrow(() =>
    assertFixtureAuditFreshnessBinding({
      freshness,
      captureBindingFreshness: structuredClone(freshness),
      expectedFixedTime: contract.fixedTime,
    }),
  );
  const mutations = [
    {
      freshness: { ...freshness, unexpected: true },
      captureBindingFreshness: { ...freshness, unexpected: true },
    },
    {
      freshness,
      captureBindingFreshness: {
        ...freshness,
        issuedAt: "2026-08-24T00:00:00.001Z",
      },
    },
    {
      freshness,
      captureBindingFreshness: { ...freshness, unexpected: true },
    },
    {
      freshness: {
        ...freshness,
        expiresAt: "2026-08-24T01:00:00.001Z",
      },
      captureBindingFreshness: {
        ...freshness,
        expiresAt: "2026-08-24T01:00:00.001Z",
      },
    },
    {
      freshness: { ...freshness, maxAgeSeconds: 3599 },
      captureBindingFreshness: { ...freshness, maxAgeSeconds: 3599 },
    },
    {
      freshness: { ...freshness, fixedFixtureTime: "2026-08-17T06:00:00.001Z" },
      captureBindingFreshness: {
        ...freshness,
        fixedFixtureTime: "2026-08-17T06:00:00.001Z",
      },
    },
  ];
  for (const mutation of mutations) {
    assert.throws(() =>
      assertFixtureAuditFreshnessBinding({
        ...mutation,
        expectedFixedTime: contract.fixedTime,
      }),
    );
  }
  return {
    acceptedFreshnessBindingCaseCount: 1,
    rejectedFreshnessMutationCaseCount: mutations.length,
  };
};
const assertNoAppCheckSecretMaterial = (
  textValue,
  { debugToken = "", debugSentinel = "", exchangedToken = "" } = {},
) => {
  const text = String(textValue);
  if (debugToken) {
    assert.equal(
      text.includes(debugToken),
      false,
      "Raw App Check debug token material reached evidence.",
    );
  }
  if (exchangedToken) {
    assert.equal(
      text.includes(exchangedToken),
      false,
      "Raw exchanged App Check token material reached evidence.",
    );
  }
  if (debugSentinel) {
    assert.equal(
      text.includes(debugSentinel),
      false,
      "Raw App Check debug sentinel material reached evidence.",
    );
  }
  assert.doesNotMatch(
    text,
    JWT_PATTERN,
    "Token-shaped App Check material reached evidence.",
  );
};
const sanitizeAppCheckDiagnostic = (
  value,
  debugToken,
  debugSentinel = APP_CHECK_DEBUG_SENTINEL,
  deploymentBypassSecret = "",
) => {
  let sanitized = String(value)
    .replaceAll(debugToken, "[W10P_APPCHECK_DEBUG_TOKEN_REDACTED]")
    .replaceAll(debugSentinel, "[W10P_APPCHECK_DEBUG_SENTINEL_REDACTED]")
    .replace(
      /[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/gu,
      "[W10P_APPCHECK_JWT_REDACTED]",
    );
  if (deploymentBypassSecret) {
    sanitized = sanitized.replaceAll(
      deploymentBypassSecret,
      "[W10P_VERCEL_BYPASS_REDACTED]",
    );
  }
  return sanitized;
};
const verifyAppCheckSecretNegativeFixtures = () => {
  const debugToken = "12345678-1234-4123-8123-123456789abc";
  const exchangedToken = `${"a".repeat(24)}.${"b".repeat(24)}.${"c".repeat(
    24,
  )}`;
  assert.throws(() =>
    assertNoAppCheckSecretMaterial(`raw=${debugToken}`, { debugToken }),
  );
  assert.throws(() =>
    assertNoAppCheckSecretMaterial(`raw=${exchangedToken}`, {
      exchangedToken,
    }),
  );
  assert.throws(() =>
    assertNoAppCheckSecretMaterial(`raw=${APP_CHECK_DEBUG_SENTINEL}`, {
      debugSentinel: APP_CHECK_DEBUG_SENTINEL,
    }),
  );
  assert.doesNotThrow(() =>
    assertNoAppCheckSecretMaterial(
      JSON.stringify({ debugTokenSha256: secretSha256(debugToken) }),
      { debugToken },
    ),
  );
  return { rejectedRawSecretCaseCount: 3, acceptedSanitizedCaseCount: 1 };
};
const appCheckSecretNegativeSelfTest = verifyAppCheckSecretNegativeFixtures();
const preTransmissionBoundaryNegativeSelfTest =
  verifyPreTransmissionBoundaryNegativeFixtures();
const fixtureAuditFreshnessNegativeSelfTest =
  verifyFixtureAuditFreshnessNegativeFixtures();
const stableOriginRewriteNegativeSelfTest =
  verifyStableOriginRewriteNegativeFixtures();
const networkPolicyNegativeSelfTest = verifyNetworkPolicyNegativeFixtures();
const allowedEgressResponseLifecycleSelfTest =
  await verifyAllowedEgressResponseLifecycleFixtures();
const postDataAndResponseSanitizationNegativeSelfTest =
  await verifyPostDataAndResponseSanitizationNegativeFixtures();
const verifyDirectCdpAllHeadersLoopback = async () => {
  for (const name of BROWSER_SECRET_ENVIRONMENT_VARIABLE_NAMES) {
    delete process.env[name];
  }
  const loopbackBrowserEnvironment = createBrowserChildEnvironment();
  assert.equal(
    BROWSER_SECRET_ENVIRONMENT_VARIABLE_NAMES.filter((name) =>
      Object.hasOwn(loopbackBrowserEnvironment, name),
    ).length,
    0,
  );
  const productionImmutableHostname =
    "westory-70z9g2tvv-bbbs-projects-44f9da30.vercel.app";
  const unknownVercelHostname =
    "westory-unknown-w10p-bbbs-projects-44f9da30.vercel.app";
  const vercelApexHostname = "vercel.app";
  const vercelApexDottedHostname = "vercel.app.";
  const productionCustomDottedHostname = "westory.kr.";
  const dottedAuthHostname = "identitytoolkit.googleapis.com.";
  const dottedRefreshHostname = "securetoken.googleapis.com.";
  const regionalRealtimeDatabaseFixtures = [
    {
      id: "production",
      hostname:
        "history-quiz-yongsin-default-rtdb.asia-southeast1.firebasedatabase.app",
      requestPath: "/regional-rtdb-production",
    },
    {
      id: "unknown",
      hostname:
        "unknown-project-default-rtdb.europe-west1.firebasedatabase.app",
      requestPath: "/regional-rtdb-unknown",
    },
    {
      id: "staging-looking",
      hostname: `${contract.firebaseProjectId}-default-rtdb.asia-southeast1.firebasedatabase.app`,
      requestPath: "/regional-rtdb-staging-looking",
    },
    {
      id: "terminal-dot-alternate-instance",
      hostname: `${contract.firebaseProjectId}-alternate.europe-west1.firebasedatabase.app.`,
      requestPath: "/regional-rtdb-terminal-dot-alternate",
    },
  ];
  const syntheticStagingApiKey = "w10p-synthetic-staging-api-key";
  const syntheticProductionApiKey = "w10p-synthetic-production-api-key";
  const syntheticTestEmail = "w10p-loopback-student@example.invalid";
  const syntheticTestPassword = "w10p-loopback-password-secret";
  const syntheticRefreshToken = "w10p-loopback-refresh-token-secret";
  const syntheticDebugToken = "12345678-1234-4123-8123-123456789abc";
  assert.ok(
    contract.networkBoundary.forbiddenWebHosts.includes(
      productionImmutableHostname,
    ),
  );
  let documentPayload = "";
  let immutableResponseLinkHeader = "";
  let directEarlyHintsLinkHeader = "";
  const unsafeParserDocumentPayload =
    '<!doctype html><iframe srcdoc="&lt;img src=http://127.0.0.1/unsafe-srcdoc-wire&gt;"></iframe><link rel="preconnect" href="http://127.0.0.1/unsafe-parser-wire"><title>unsafe</title>';
  const toolbarParserDocumentPayload =
    '<!doctype html><script src="https:&#x2f;&#x2f;vercel.live&#x2f;_next-live&#x2f;feedback&#x2f;fee&#x64;back.js"></script><title>toolbar</title>';
  const scriptPayload =
    'globalThis.__w10pImmutableScript = "w10p-cdp-url-override-payload-v2";';
  const networkBackedProbeResponseBody = JSON.stringify({ ok: true });
  const postFinalAbortResponseBodyPrefix = '{"partial":true';
  const postFinalAbortDeclaredContentLength =
    Buffer.byteLength(postFinalAbortResponseBodyPrefix) + 4096;
  const syntheticJwt = `${"a".repeat(24)}.${"b".repeat(24)}.${"c".repeat(24)}`;
  const syntheticBypassSecret = "w10p-loopback-bypass-secret";
  const stableWireRequests = [];
  const upstreamWireRequests = [];
  const apiWireRequests = [];
  const directAllowedTlsWireRequests = [];
  const nodeExternalWireRequests = [];
  const preTransmissionBlockedWirePaths = [];
  const forbiddenHostnameWireRequests = [];
  const regionalRealtimeDatabaseWireRequests = [];
  const crossOriginDocumentWireRequests = [];
  const eventSourceWireRequests = [];
  const websocketWireRequests = [];
  const rawExternalWireConnections = [];
  const rawExternalWireBytes = [];
  const udpStunWireDatagrams = [];
  const postFinalAbortOpenResponses = new Set();
  const postFinalAbortLifecycleByFetchRequestId = new Map();
  const postFinalAbortFetchRequestIdsByNetworkId = new Map();
  const loopbackHandlerTaskCoordinator = createPerCorrelationTaskCoordinator();
  let resolvePostFinalAbortErrorPauseEnqueued;
  const postFinalAbortErrorPauseEnqueued = new Promise((resolve) => {
    resolvePostFinalAbortErrorPauseEnqueued = resolve;
  });
  let immutableEarlyHintsSentCount = 0;
  let immutableFinalLinkHeaderSentCount = 0;
  let networkBackedEarlyHintsSentCount = 0;
  let networkBackedInformationalEgressHeaderSentCount = 0;
  let networkBackedFinalEgressHeaderSentCount = 0;
  let networkBackedInformationalResponsePauseCount = 0;
  let networkBackedFinalResponsePauseCount = 0;
  let networkBackedInformationalEgressHeaderObservationCount = 0;
  let networkBackedFinalEgressHeaderObservationCount = 0;
  let networkBackedResponseHeaderSuppressionCount = 0;
  let networkBackedEgressHeaderForwardCount = 0;
  let networkBackedResponseBodyHashMatchCount = 0;
  let postFinalAbortFinalResponsePauseCount = 0;
  let postFinalAbortResponseErrorPauseCount = 0;
  let postFinalAbortNoOverrideContinueResponseSuccessCount = 0;
  let postFinalAbortProxyCompleteCount = 0;
  let postFinalAbortProxyRevokeCount = 0;
  let postFinalAbortHeadersObserved = false;
  let postFinalAbortBodyRejected = false;
  let postFinalAbortWatchdogFired = false;
  let postFinalAbortErrorPauseEnqueuedCount = 0;
  let postFinalAbortErrorPauseEnqueuedBeforeFinalReleaseCount = 0;
  let postFinalAbortRequestFailureCount = 0;
  const postFinalAbortRequestFailureTexts = [];
  let postFinalAbortSameFetchCorrelationCount = 0;
  let postFinalAbortAliasCorrelationCount = 0;
  let directBrowserEarlyHintsObservationCount = 0;
  let directBrowserEarlyHintsEgressHeaderObservationCount = 0;
  let directBrowserEarlyHintsCaptureInvalidationCount = 0;
  let directEarlyHintsAllowedHostFetchRequestStageObservationCount = 0;
  let directEarlyHintsAllowedHostFetchRequestStageBlockCount = 0;
  let nodeOwnedExternalInformationalResponseCount = 0;
  let nodeOwnedExternalInformationalEgressHeaderObservationCount = 0;
  let nodeOwnedExternalBrowserExposureCount = 0;
  let nodeOwnedExternalFinalBodyHashMatchCount = 0;
  let proxyDenyFixtureRequestCount = 0;
  let directBrowserAllowedFirebaseTunnelCount = 0;
  let directEarlyHintsAllowedHostAdditionalTunnelCount = 0;
  let directEarlyHintsAllowedHostProxyDenyCountBeforeManualFixture = 0;
  let fullPostDataResolutionCount = 0;
  let fullPostDataNetworkFallbackCount = 0;
  let fullPostDataResolutionFailureCount = 0;
  let postDataOmissionFixtureInjectionCount = 0;
  let postDataOmissionFixtureRealNetworkIdCount = 0;
  let fullPostDataRecoveredBodyExactMatchCount = 0;
  let fullPostDataRecoveredBodyBytes = 0;
  let fullPostDataRecoveredBodySha256 = "";
  let stableOrigin = "";
  const preTransmissionSyntheticMarkers = new Map([
    ["/production-get", "production"],
    ["/production-post", "production"],
    ["/unbound-firebase", "unbound-firebase"],
  ]);
  const preTransmissionBlockedPaths = new Set([
    ...preTransmissionSyntheticMarkers.keys(),
    "/production-immutable",
    "/unknown-vercel",
    "/vercel-apex",
    "/vercel-apex-dotted",
    "/production-custom-dotted-get",
    "/production-custom-dotted-post",
    "/dotted-auth-query-key",
    "/dotted-refresh-header-key",
    ...regionalRealtimeDatabaseFixtures.map(({ requestPath }) => requestPath),
    "/worker-wire.js",
    "/shared-worker-wire.js",
    "/sw-wire.js",
    "/oopif-wire",
    "/popup-wire",
    "/event-source-wire",
    "/api/korean-holidays",
    "/api/unknown",
  ]);
  const stableServer = createServer((request, response) => {
    const requestPath = new URL(request.url || "/", "http://127.0.0.1")
      .pathname;
    const wireHostname = String(request.headers.host || "")
      .replace(/:[0-9]+$/u, "")
      .toLowerCase();
    stableWireRequests.push({ hostname: wireHostname, requestPath });
    if (preTransmissionBlockedPaths.has(requestPath)) {
      preTransmissionBlockedWirePaths.push(requestPath);
    }
    if (
      regionalRealtimeDatabaseFixtures.some(
        (fixture) => fixture.requestPath === requestPath,
      )
    ) {
      regionalRealtimeDatabaseWireRequests.push({
        hostname: wireHostname,
        requestPath,
      });
    }
    if (requestPath === "/event-source-wire") {
      eventSourceWireRequests.push({ hostname: wireHostname, requestPath });
    }
    if (
      [
        productionImmutableHostname,
        unknownVercelHostname,
        productionCustomDottedHostname,
        dottedAuthHostname,
        dottedRefreshHostname,
      ].includes(wireHostname)
    ) {
      forbiddenHostnameWireRequests.push({
        hostname: wireHostname,
        requestPath,
      });
    }
    response.writeHead(500);
    response.end("stable origin must not receive loopback wire requests");
  });
  stableServer.on("upgrade", (request, socket) => {
    websocketWireRequests.push(request.url || "");
    socket.destroy();
  });
  const upstreamServer = createServer((request, response) => {
    const requestPath = new URL(request.url || "/", "http://127.0.0.1")
      .pathname;
    upstreamWireRequests.push({
      requestPath,
      bypassHeader: request.headers["x-vercel-protection-bypass"] || "",
      skipToolbarHeader: request.headers["x-vercel-skip-toolbar"] || "",
    });
    if (requestPath === "/document.html") {
      if (typeof response.writeEarlyHints === "function") {
        response.writeEarlyHints({ link: immutableResponseLinkHeader });
        immutableEarlyHintsSentCount += 1;
      }
      response.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        link: immutableResponseLinkHeader,
      });
      immutableFinalLinkHeaderSentCount += 1;
      response.end(documentPayload);
      return;
    }
    if (requestPath === "/rewrite.js") {
      response.writeHead(200, {
        "content-type": "text/javascript; charset=utf-8",
      });
      response.end(scriptPayload);
      return;
    }
    if (requestPath === "/unsafe-parser.html") {
      response.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
      });
      response.end(unsafeParserDocumentPayload);
      return;
    }
    if (requestPath === "/toolbar-parser.html") {
      response.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
      });
      response.end(toolbarParserDocumentPayload);
      return;
    }
    if (requestPath === "/redirect.css") {
      response.writeHead(302, { location: "/redirect-target.css" });
      response.end();
      return;
    }
    response.writeHead(404);
    response.end();
  });
  const apiRequestHandler = (request, response) => {
    const requestPath = new URL(request.url || "/", "http://127.0.0.1")
      .pathname;
    if (requestPath === "/cross-origin-document-wire") {
      crossOriginDocumentWireRequests.push(requestPath);
    }
    if (requestPath === "/node-owned-external-probe") {
      nodeExternalWireRequests.push({
        method: request.method,
        headers: Object.fromEntries(
          Object.entries(request.headers).sort(([left], [right]) =>
            left.localeCompare(right),
          ),
        ),
      });
      response.writeEarlyHints({
        link: directEarlyHintsLinkHeader,
        "reporting-endpoints": `w10p="${directEarlyHintsLinkHeader}"`,
      });
      response.writeHead(200, {
        "access-control-allow-origin": "*",
        "cache-control": "no-store",
        "content-type": "application/json; charset=utf-8",
        link: directEarlyHintsLinkHeader,
        "content-length": Buffer.byteLength(networkBackedProbeResponseBody),
      });
      response.end(networkBackedProbeResponseBody);
      return;
    }
    apiWireRequests.push({
      requestPath,
      origin: request.headers.origin || "",
      referer: request.headers.referer || "",
      appCheckHeader: request.headers["x-firebase-appcheck"] || "",
      bypassHeader: request.headers["x-vercel-protection-bypass"] || "",
    });
    if (requestPath === "/post-final-abort") {
      postFinalAbortOpenResponses.add(response);
      const forgetOpenResponse = () =>
        postFinalAbortOpenResponses.delete(response);
      response.once("close", forgetOpenResponse);
      response.once("error", forgetOpenResponse);
      response.writeHead(200, {
        "access-control-allow-origin": stableOrigin,
        "cache-control": "no-store",
        "content-type": "application/json; charset=utf-8",
        "content-length": postFinalAbortDeclaredContentLength,
      });
      response.flushHeaders();
      response.write(postFinalAbortResponseBodyPrefix);
      return;
    }
    if (requestPath === "/probe") {
      response.writeEarlyHints({
        link: directEarlyHintsLinkHeader,
        "reporting-endpoints": `w10p="${directEarlyHintsLinkHeader}"`,
      });
      networkBackedEarlyHintsSentCount += 1;
      networkBackedInformationalEgressHeaderSentCount += 2;
      response.writeHead(200, {
        "access-control-allow-origin": stableOrigin,
        "cache-control": "no-store",
        "content-type": "application/json; charset=utf-8",
        link: directEarlyHintsLinkHeader,
        "alt-svc": `h2="127.0.0.1:${rawExternalWireAddress.port}"; ma=86400`,
        location: `${rawExternalLoopbackOrigin}/response-location-wire`,
        refresh: `0; url=${rawExternalLoopbackOrigin}/response-refresh-wire`,
        nel: JSON.stringify({
          report_to: "w10p",
          max_age: 86400,
        }),
        "report-to": JSON.stringify({
          group: "w10p",
          max_age: 86400,
          endpoints: [
            { url: `${rawExternalLoopbackOrigin}/response-report-wire` },
          ],
        }),
        "reporting-endpoints": `w10p="${rawExternalLoopbackOrigin}/response-reporting-wire"`,
        "content-security-policy-report-only": `default-src 'none'; report-uri ${rawExternalLoopbackOrigin}/response-csp-report-wire`,
        "content-security-policy": `default-src 'self'; report-uri ${rawExternalLoopbackOrigin}/response-csp-wire`,
        "content-length": Buffer.byteLength(networkBackedProbeResponseBody),
      });
      networkBackedFinalEgressHeaderSentCount += 9;
      response.end(networkBackedProbeResponseBody);
      return;
    }
    response.writeHead(204, {
      "access-control-allow-origin": stableOrigin,
      "cache-control": "no-store",
    });
    response.end();
  };
  const apiServer = createServer(apiRequestHandler);
  const directAllowedTlsServer = createHttpsServer(
    {
      cert: LOOPBACK_PROXY_TLS_CERTIFICATE,
      key: LOOPBACK_PROXY_TLS_PRIVATE_KEY,
    },
    (request, response) => {
      directAllowedTlsWireRequests.push({
        method: request.method,
        url: request.url,
        host: request.headers.host || "",
      });
      apiRequestHandler(request, response);
    },
  );
  const rawExternalWireServer = createTcpServer((socket) => {
    rawExternalWireConnections.push(socket.remoteAddress || "unknown");
    socket.on("data", (bytes) => {
      rawExternalWireBytes.push(bytes.length);
      socket.destroy();
    });
  });
  const udpStunServer = createUdpSocket("udp4");
  udpStunServer.on("message", (message) => {
    udpStunWireDatagrams.push(message.length);
  });
  for (const server of [
    stableServer,
    upstreamServer,
    apiServer,
    directAllowedTlsServer,
  ]) {
    await new Promise((resolveListen) =>
      server.listen(0, "127.0.0.1", resolveListen),
    );
  }
  await new Promise((resolveListen) =>
    rawExternalWireServer.listen(0, "127.0.0.1", resolveListen),
  );
  await new Promise((resolveListen) =>
    udpStunServer.bind(0, "127.0.0.1", resolveListen),
  );
  const stableAddress = stableServer.address();
  const upstreamAddress = upstreamServer.address();
  const apiAddress = apiServer.address();
  const directAllowedTlsAddress = directAllowedTlsServer.address();
  const rawExternalWireAddress = rawExternalWireServer.address();
  const udpStunAddress = udpStunServer.address();
  assert.ok(stableAddress && typeof stableAddress === "object");
  assert.ok(upstreamAddress && typeof upstreamAddress === "object");
  assert.ok(apiAddress && typeof apiAddress === "object");
  assert.ok(
    directAllowedTlsAddress && typeof directAllowedTlsAddress === "object",
  );
  assert.ok(
    rawExternalWireAddress && typeof rawExternalWireAddress === "object",
  );
  assert.ok(udpStunAddress && typeof udpStunAddress === "object");
  const rawExternalLoopbackOrigin = `http://127.0.0.1:${rawExternalWireAddress.port}`;
  immutableResponseLinkHeader = `<${rawExternalLoopbackOrigin}/response-link-wire>; rel=preconnect`;
  const directEarlyHintsAllowedHostTargetUrl =
    "https://identitytoolkit.googleapis.com/early-hints-preload-wire";
  directEarlyHintsLinkHeader = `<${directEarlyHintsAllowedHostTargetUrl}>; rel=preload; as=script`;
  documentPayload = [
    "<!doctype html><title>direct-cdp-probe</title>",
    '<link rel="icon" href="data:,w10p">',
    '<template id="w10p-inert-parser-fixtures">',
    `<link rel="preconnect" href="${rawExternalLoopbackOrigin}/parser-preconnect-wire">`,
    `<link rel="prefetch" href="${rawExternalLoopbackOrigin}/parser-prefetch-wire">`,
    `<script type="speculationrules">${JSON.stringify({ prefetch: [{ source: "list", urls: [`${rawExternalLoopbackOrigin}/parser-speculation-wire`] }] })}</script>`,
    `<a id="parser-ping" href="#parser-ping-target" ping="${rawExternalLoopbackOrigin}/parser-ping-wire">parser ping</a>`,
    `<iframe id="parser-srcdoc" srcdoc="&lt;img src='${rawExternalLoopbackOrigin}/parser-srcdoc-wire'&gt;"></iframe>`,
    "</template>",
    '<script src="/rewrite.js"></script>',
    '<link rel="stylesheet" href="/redirect.css">',
  ].join("");
  stableOrigin = `http://127.0.0.1:${stableAddress.port}`;
  const upstreamOrigin = `http://127.0.0.1:${upstreamAddress.port}`;
  const apiOrigin = `http://127.0.0.1:${apiAddress.port}`;
  const stableDocumentUrl = `${stableOrigin}/document.html`;
  const stableScriptUrl = `${stableOrigin}/rewrite.js`;
  const stableRedirectUrl = `${stableOrigin}/redirect.css`;
  const stableUnsafeParserUrl = `${stableOrigin}/unsafe-parser.html`;
  const stableToolbarParserUrl = `${stableOrigin}/toolbar-parser.html`;
  const browserSkipToolbarHeaderNegativeUrl = `${stableOrigin}/browser-skip-toolbar-negative`;
  const probeUrl = `https://identitytoolkit.googleapis.com/probe?key=${encodeURIComponent(syntheticStagingApiKey)}`;
  const postFinalAbortUrl = `https://identitytoolkit.googleapis.com/post-final-abort?key=${encodeURIComponent(syntheticStagingApiKey)}`;
  const wrongApiKeyAllowedHostnameUrl = `https://identitytoolkit.googleapis.com/wrong-key-before-tunnel?key=${encodeURIComponent(syntheticProductionApiKey)}`;
  const wrongCredentialScopeAllowedHostnameUrl = `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(syntheticStagingApiKey)}`;
  const nodeOwnedExternalProbeUrl = `${apiOrigin}/node-owned-external-probe`;
  const crossOriginDocumentUrl = `${apiOrigin}/cross-origin-document-wire`;
  const productionImmutableUrl = `http://${productionImmutableHostname}:${stableAddress.port}/production-immutable`;
  const unknownVercelUrl = `http://${unknownVercelHostname}:${stableAddress.port}/unknown-vercel`;
  const vercelApexUrl = `http://${vercelApexHostname}:${stableAddress.port}/vercel-apex`;
  const vercelApexDottedUrl = `http://${vercelApexDottedHostname}:${stableAddress.port}/vercel-apex-dotted`;
  const productionCustomDottedGetUrl = `http://${productionCustomDottedHostname}:${stableAddress.port}/production-custom-dotted-get`;
  const productionCustomDottedPostUrl = `http://${productionCustomDottedHostname}:${stableAddress.port}/production-custom-dotted-post`;
  const dottedAuthQueryKeyUrl = `http://${dottedAuthHostname}:${stableAddress.port}/dotted-auth-query-key?key=${syntheticProductionApiKey}&continueUrl=https://example.invalid/${contract.firebaseProjectId}`;
  const dottedRefreshHeaderKeyUrl = `http://${dottedRefreshHostname}:${stableAddress.port}/dotted-refresh-header-key?continueUrl=https://example.invalid/${contract.firebaseProjectId}`;
  const regionalRealtimeDatabaseUrls = regionalRealtimeDatabaseFixtures.map(
    (fixture) => ({
      ...fixture,
      url: `http://${fixture.hostname}:${stableAddress.port}${fixture.requestPath}?decoy=${contract.firebaseProjectId}`,
    }),
  );
  const workerWireUrl = `${stableOrigin}/worker-wire.js`;
  const sharedWorkerWireUrl = `${stableOrigin}/shared-worker-wire.js`;
  const serviceWorkerWireUrl = `${stableOrigin}/sw-wire.js`;
  const oopifWireUrl = `http://${productionCustomDottedHostname}:${stableAddress.port}/oopif-wire`;
  const popupWireUrl = `http://${unknownVercelHostname}:${stableAddress.port}/popup-wire`;
  const websocketWireUrl = `ws://127.0.0.1:${stableAddress.port}/websocket-wire`;
  const allowedFirebaseWebsocketWireUrl =
    "wss://identitytoolkit.googleapis.com/allowed-websocket-wire?key=invalid-loopback-key";
  const webSocketStreamWireUrl = `ws://127.0.0.1:${stableAddress.port}/websocket-stream-wire`;
  const allowedFirebaseWebSocketStreamWireUrl =
    "wss://identitytoolkit.googleapis.com/allowed-websocket-stream-wire?key=invalid-loopback-key";
  const allowedFirebaseWorkerFetchWireUrl =
    "https://identitytoolkit.googleapis.com/allowed-worker-fetch-wire?key=invalid-loopback-key";
  const allowedFirebasePreconnectWireUrl =
    "https://identitytoolkit.googleapis.com/allowed-parser-preconnect-wire";
  const webTransportWireUrl = `https://127.0.0.1:${stableAddress.port}/webtransport-wire`;
  const eventSourceWireUrl = `http://${unknownVercelHostname}:${stableAddress.port}/event-source-wire`;
  const holidayUrl = `${stableOrigin}/api/korean-holidays?year=2026`;
  const invalidHolidayUrls = [
    `${stableOrigin}/api/unknown?year=2026`,
    `${stableOrigin}/api/korean-holidays`,
    `${stableOrigin}/api/korean-holidays?year=2026&year=2026`,
    `${stableOrigin}/api/korean-holidays?year=1899`,
    `${stableOrigin}/api/korean-holidays?year=02026`,
    `${stableOrigin}/api/korean-holidays?year=%ZZ`,
  ];
  const recaptchaScriptUrl = "https://www.google.com/recaptcha/enterprise.js";
  const recaptchaDisallowedUrl = "https://www.google.com/recaptcha/api.js";
  const firebaseModuleUrls =
    contract.networkBoundary.externalStaticRequestAllowlist.rules
      .find((rule) => rule.id === "firebase-esm-12.9.0")
      .exactPathnames.map((pathname) => `https://www.gstatic.com${pathname}`);
  const telemetryUrl =
    "https://firebaseinstallations.googleapis.com/v1/projects/w10p/installations";
  const largeSensitiveTelemetryUrl = `${telemetryUrl}?w10p-full-post-data-fixture=1`;
  const largeSensitiveBody = `${"x".repeat(
    FETCH_INLINE_POST_DATA_LIMIT_BYTES * 2,
  )}${syntheticDebugToken}`;
  const unknownExternalOrigin = "https://unknown-external.invalid";
  const unknownExternalUrl = `${unknownExternalOrigin}/unknown-wire`;
  const externalQueryExfilUrl = `https://www.gstatic.com/firebasejs/12.9.0/firebase-app.js?leak=${syntheticStagingApiKey}`;
  const externalBodyExfilUrl =
    "https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;500;700;800;900&display=swap";
  const externalHeaderExfilUrl = externalBodyExfilUrl;
  const beaconWireUrl = `${unknownExternalOrigin}/beacon-wire`;
  const pingWireUrl = `${unknownExternalOrigin}/ping-wire`;
  const preconnectWireUrl = `${unknownExternalOrigin}/preconnect-wire`;
  const prefetchWireUrl = `${unknownExternalOrigin}/prefetch-wire`;
  const speculationWireUrl = `${unknownExternalOrigin}/speculation-wire`;
  const workletWireUrl = `${unknownExternalOrigin}/worklet-wire.js`;
  const stunWireUrl = `stun:127.0.0.1:${udpStunAddress.port}`;
  const stagingApiKeyExfilUrl = `${stableOrigin}/api/unknown?leak=${encodeURIComponent(syntheticStagingApiKey)}`;
  const credentialExfilUrl = `${stableOrigin}/api/unknown?email=${encodeURIComponent(syntheticTestEmail)}`;
  const refreshTokenExfilUrl = `${stableOrigin}/api/unknown`;
  const debugTokenExfilUrl = `${stableOrigin}/api/unknown`;
  const debugSentinelExfilUrl = `${stableOrigin}/api/unknown`;
  const loopbackRewriteTargets = new Map([
    [stableDocumentUrl, `${upstreamOrigin}/document.html`],
    [stableScriptUrl, `${upstreamOrigin}/rewrite.js`],
    [stableRedirectUrl, `${upstreamOrigin}/redirect.css`],
    [stableUnsafeParserUrl, `${upstreamOrigin}/unsafe-parser.html`],
    [stableToolbarParserUrl, `${upstreamOrigin}/toolbar-parser.html`],
  ]);
  const loopbackAllowedNonFirebaseOrigins = [
    stableOrigin,
    upstreamOrigin,
    apiOrigin,
  ];
  const loopbackBypassAllowedOrigins = [upstreamOrigin];
  const loopbackBypassTransportContract = {
    requiredProtocol: "http:",
    allowedPorts: [String(upstreamAddress.port)],
    userinfoAllowed: false,
  };
  assert.equal(
    exactOriginTransportAllowed({
      value: `${upstreamOrigin}/document.html`,
      allowedOrigins: loopbackBypassAllowedOrigins,
      transportContract: loopbackBypassTransportContract,
    }),
    true,
  );
  for (const outOfScopeUrl of [
    probeUrl,
    postFinalAbortUrl,
    productionImmutableUrl,
    unknownVercelUrl,
    vercelApexUrl,
    vercelApexDottedUrl,
    productionCustomDottedGetUrl,
    productionCustomDottedPostUrl,
    dottedAuthQueryKeyUrl,
    dottedRefreshHeaderKeyUrl,
    ...regionalRealtimeDatabaseUrls.map(({ url }) => url),
    oopifWireUrl,
    popupWireUrl,
    crossOriginDocumentUrl,
    eventSourceWireUrl,
    recaptchaScriptUrl,
    ...firebaseModuleUrls,
    telemetryUrl,
    unknownExternalUrl,
  ]) {
    assert.equal(
      exactOriginTransportAllowed({
        value: outOfScopeUrl,
        allowedOrigins: loopbackBypassAllowedOrigins,
        transportContract: loopbackBypassTransportContract,
      }),
      false,
    );
  }
  const executablePath =
    args
      .find((item) => item.startsWith("--browser-executable="))
      ?.slice("--browser-executable=".length) ||
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
  const loopbackProxy = createBrowserConnectProxyGate({
    allowedHostnames: [
      "identitytoolkit.googleapis.com",
      "securetoken.googleapis.com",
    ],
    allowedRequestOrigins: [stableOrigin],
    nonFatalBrowserProductHostnames: BROWSER_PRODUCT_BACKGROUND_DENY_HOSTNAMES,
    fatalOnDeny: false,
    connectAllowed: ({ hostname, port }) => {
      assert.equal(hostname, "identitytoolkit.googleapis.com");
      assert.equal(port, "443");
      return connectTcp({
        host: "127.0.0.1",
        port: directAllowedTlsAddress.port,
      });
    },
  });
  let loopbackProxyUrl = "";
  let loopbackProxyServerArgument = "";
  let loopbackProxySnapshot = null;
  let sensitiveAllowedHostnameBlockedBeforeProxyTunnelCount = 0;
  let loopbackBrowser = null;
  let loopbackBrowserCommandLineAttestation = null;
  const rewriteObservations = new Map();
  let testOwnedBrowserCloseCount = 0;
  let testOwnedServerCloseCount = 0;
  let rewriteRequestCount = 0;
  let rewriteResponseCount = 0;
  let rewriteBodyHashMatchCount = 0;
  let rewriteRedirectResponseAbortCount = 0;
  let rewriteRedirectFollowAttemptCount = 0;
  let unsafeParserDocumentRejectCount = 0;
  let toolbarParserDocumentRejectCount = 0;
  let unexpectedContinueRequestCount = 0;
  const unexpectedRequestUrls = [];
  let preTransmissionBoundaryInspectionCount = 0;
  let preTransmissionBoundaryBlockAttemptCount = 0;
  let preTransmissionBoundaryProductionBlockCount = 0;
  let preTransmissionBoundaryCrossOriginDocumentBlockCount = 0;
  let preTransmissionBoundaryUnboundFirebaseBlockCount = 0;
  let preTransmissionBoundaryNonFirebaseHostnameBlockCount = 0;
  let preTransmissionBoundaryMalformedUrlBlockCount = 0;
  let preTransmissionBoundaryFailRequestCount = 0;
  let rawSensitivePreTransmissionInspectionCount = 0;
  let rawSensitivePreTransmissionBlockCount = 0;
  let rawProductionPreTransmissionBlockCount = 0;
  let rawVercelBypassPreTransmissionBlockCount = 0;
  let rawStagingApiKeyPreTransmissionBlockCount = 0;
  let rawTestCredentialPreTransmissionBlockCount = 0;
  let rawRefreshTokenPreTransmissionBlockCount = 0;
  let rawDebugTokenPreTransmissionBlockCount = 0;
  let rawDebugSentinelPreTransmissionBlockCount = 0;
  let loopbackBoundaryController = null;
  let loopbackBoundarySnapshot = null;
  let loopbackContext = null;
  let websocketRouteInterceptCount = 0;
  let websocketConnectToServerCount = 0;
  let websocketHandshakeRequestCount = 0;
  let webTransportCreatedCount = 0;
  let optionalTelemetrySuppressionCount = 0;
  let deterministicHolidayFulfillCount = 0;
  let deterministicRecaptchaFulfillCount = 0;
  let deterministicScopeMismatchBlockCount = 0;
  let firebaseModuleLocalFulfillCount = 0;
  let externalStaticScopeMismatchBlockCount = 0;
  let stagingApiKeyScopeViolationBlockCount = 0;
  let testCredentialScopeViolationBlockCount = 0;
  let refreshTokenScopeViolationBlockCount = 0;
  let debugMaterialScopeViolationBlockCount = 0;
  let recaptchaRequestFailureCount = 0;
  let firebaseModuleRequestFailureCount = 0;
  let firebaseModuleHeadRequestFailureCount = 0;
  let firebaseModuleDynamicImportSuccessCount = 0;
  let recaptchaIframeDocumentRequestCount = 0;
  let loopbackBrowserSkipToolbarHeaderPreTransmissionBlockCount = 0;
  const setPostFinalAbortLifecycleState = (primaryRequestId, state) => {
    const lifecycle =
      postFinalAbortLifecycleByFetchRequestId.get(primaryRequestId) || null;
    assert.ok(lifecycle);
    postFinalAbortLifecycleByFetchRequestId.set(
      primaryRequestId,
      Object.freeze({ ...lifecycle, state }),
    );
  };
  const resolvePostFinalAbortResponseCorrelation = (event) =>
    resolveAllowedEgressResponseCorrelation({
      event,
      lifecycleByFetchRequestId: postFinalAbortLifecycleByFetchRequestId,
      fetchRequestIdsByNetworkId: postFinalAbortFetchRequestIdsByNetworkId,
    });
  const dottedProductionBlockedMethods = [];
  const dottedFirebaseBlockedPaths = [];
  const regionalRealtimeDatabaseBlockedPaths = [];
  const crossOriginDocumentBlockedPaths = [];
  const eventSourceBlockedPaths = [];
  const inspectLoopbackPausedRequest = (event) => {
    const parsedRequest = new URL(event.request.url);
    const requestPath = parsedRequest.pathname;
    const syntheticBoundaryMarker =
      preTransmissionSyntheticMarkers.get(requestPath) || null;
    const inspection = inspectNetworkBoundary({
      requestUrl: event.request.url,
      method: event.request.method,
      resourceType: event.resourceType,
      apiKeyHeaderValues: extractApiKeyHeaderValues(event.request.headers),
      stagingApiKey: syntheticStagingApiKey,
      allowedNonFirebaseOrigins: loopbackAllowedNonFirebaseOrigins,
    });
    if (syntheticBoundaryMarker === "production") {
      return {
        ...inspection,
        productionMarker: true,
        unboundFirebaseRequest: false,
      };
    }
    if (syntheticBoundaryMarker === "unbound-firebase") {
      return {
        ...inspection,
        firebaseService: "auth",
        isFirebaseRequest: true,
        nonFirebaseHostnameAllowed: false,
        stagingMarker: false,
        productionMarker: false,
        unboundFirebaseRequest: true,
      };
    }
    return inspection;
  };
  try {
    loopbackProxyUrl = await loopbackProxy.start();
    loopbackProxyServerArgument = `--proxy-server=${loopbackProxyUrl}`;
    const nodeOwnedExternalResponse = await nodeOwnedExactExternalStaticGet({
      requestUrl: nodeOwnedExternalProbeUrl,
      expectedHostname: "127.0.0.1",
      expectedPort: String(apiAddress.port),
      allowLoopbackHttp: true,
    });
    nodeOwnedExternalInformationalResponseCount =
      nodeOwnedExternalResponse.informationalResponses.length;
    nodeOwnedExternalInformationalEgressHeaderObservationCount =
      nodeOwnedExternalResponse.informationalResponses.reduce(
        (total, observation) =>
          total + observation.egressHeaderObservationCount,
        0,
      );
    nodeOwnedExternalFinalBodyHashMatchCount = Number(
      nodeOwnedExternalResponse.body.equals(
        Buffer.from(networkBackedProbeResponseBody, "utf8"),
      ) &&
        nodeOwnedExternalResponse.bodySha256 ===
          createHash("sha256")
            .update(networkBackedProbeResponseBody, "utf8")
            .digest("hex"),
    );
    assert.equal(nodeOwnedExternalInformationalResponseCount, 1);
    assert.ok(nodeOwnedExternalInformationalEgressHeaderObservationCount > 0);
    assert.equal(nodeOwnedExternalFinalBodyHashMatchCount, 1);
    assert.deepEqual(
      nodeOwnedExternalResponse.responseHeaders.find(
        ({ name }) => name === "content-length",
      ),
      {
        name: "content-length",
        value: String(Buffer.byteLength(networkBackedProbeResponseBody)),
      },
    );
    loopbackBrowser = await chromium.launch({
      executablePath,
      headless: true,
      env: loopbackBrowserEnvironment,
      ignoreDefaultArgs: BROWSER_PRETRANSMISSION_IGNORE_DEFAULT_ARGS,
      args: [
        ...BROWSER_PRETRANSMISSION_LAUNCH_ARGS,
        BROWSER_PROXY_BYPASS_LIST_ARGUMENT,
        loopbackProxyServerArgument,
        "--ignore-certificate-errors",
        `--host-resolver-rules=MAP ${productionImmutableHostname} 127.0.0.1, MAP ${unknownVercelHostname} 127.0.0.1, MAP ${vercelApexHostname} 127.0.0.1, MAP westory.kr 127.0.0.1, MAP identitytoolkit.googleapis.com 127.0.0.1, MAP securetoken.googleapis.com 127.0.0.1, MAP www.gstatic.com 127.0.0.1:${rawExternalWireAddress.port}, MAP www.google.com 127.0.0.1:${rawExternalWireAddress.port}, MAP firebaseinstallations.googleapis.com 127.0.0.1:${rawExternalWireAddress.port}, MAP fonts.googleapis.com 127.0.0.1:${rawExternalWireAddress.port}, MAP unknown-external.invalid 127.0.0.1:${rawExternalWireAddress.port}, ${regionalRealtimeDatabaseFixtures
          .map(
            ({ hostname }) =>
              `MAP ${canonicalNetworkHostname(hostname)} 127.0.0.1`,
          )
          .join(", ")}`,
      ],
    });
    loopbackBrowserCommandLineAttestation =
      await attestBrowserPreTransmissionCommandLine(loopbackBrowser, {
        expectedProxyServerArgument: loopbackProxyServerArgument,
      });
    loopbackBoundaryController =
      await installBrowserWidePreTransmissionBoundary({
        browser: loopbackBrowser,
        inspectPausedRequest: ({ event }) =>
          inspectLoopbackPausedRequest(event),
        inspectSensitiveRequest: ({ event, inspection }) =>
          unifiedSensitivePreTransmissionDecision({
            requestUrl: event.request.url,
            method: event.request.method,
            headers: event.request.headers,
            postData: event.request.postData,
            inspection,
            stagingApiKey: syntheticStagingApiKey,
            credentialValues: [syntheticTestEmail, syntheticTestPassword],
            refreshTokenValues: [syntheticRefreshToken],
            debugToken: syntheticDebugToken,
            debugSentinel: APP_CHECK_DEBUG_SENTINEL,
            bypassSecret: syntheticBypassSecret,
          }),
      });
    loopbackBoundaryController.activate({
      id: "loopback",
      stableBrowserOrigin: stableOrigin,
      stagingApiKey: syntheticStagingApiKey,
    });
    const context = await loopbackBrowser.newContext({
      serviceWorkers: "block",
    });
    loopbackContext = context;
    await context.addInitScript(blockBrowserSecondaryExecutionAndWebTransport);
    await context.routeWebSocket("**/*", async (webSocketRoute) => {
      websocketRouteInterceptCount += 1;
      assert.equal(
        [websocketWireUrl, allowedFirebaseWebsocketWireUrl].includes(
          webSocketRoute.url(),
        ),
        true,
      );
      await webSocketRoute.close({
        code: 1008,
        reason: "W10P pre-transmission boundary",
      });
    });
    const page = await context.newPage();
    page.on("requestfailed", (request) => {
      if (request.url() === postFinalAbortUrl) {
        postFinalAbortRequestFailureCount += 1;
        postFinalAbortRequestFailureTexts.push(
          String(request.failure()?.errorText || ""),
        );
      }
      if (request.url() === recaptchaScriptUrl) {
        recaptchaRequestFailureCount += 1;
      }
      if (firebaseModuleUrls.includes(request.url())) {
        firebaseModuleRequestFailureCount += 1;
        firebaseModuleHeadRequestFailureCount += Number(
          request.method() === "HEAD",
        );
      }
    });
    const cdp = await context.newCDPSession(page);
    await cdp.send("Network.enable", {
      maxPostDataSize: FETCH_INLINE_POST_DATA_LIMIT_BYTES,
    });
    cdp.on("Network.responseReceivedEarlyHints", ({ headers }) => {
      const responseHeaders = Object.entries(headers || {}).map(
        ([name, value]) => ({ name, value: String(value) }),
      );
      const sanitizedEarlyHints =
        sanitizeBrowserResponseHeaders(responseHeaders);
      directBrowserEarlyHintsObservationCount += 1;
      directBrowserEarlyHintsEgressHeaderObservationCount +=
        sanitizedEarlyHints.egressHeaderObservationCount;
      directBrowserEarlyHintsCaptureInvalidationCount += 1;
    });
    cdp.on("Network.webSocketWillSendHandshakeRequest", () => {
      websocketHandshakeRequestCount += 1;
    });
    cdp.on("Network.webTransportCreated", () => {
      webTransportCreatedCount += 1;
    });
    const handlerPromises = new Set();
    cdp.on("Fetch.requestPaused", (event) => {
      const responseStagePause =
        event.responseStatusCode !== undefined ||
        event.responseErrorReason !== undefined;
      const postFinalAbortResponseCorrelation =
        responseStagePause && event.request.url === postFinalAbortUrl
          ? resolvePostFinalAbortResponseCorrelation(event)
          : null;
      const handlerCorrelationId =
        postFinalAbortResponseCorrelation?.primaryRequestId || event.requestId;
      if (
        event.request.url === postFinalAbortUrl &&
        event.responseErrorReason !== undefined
      ) {
        postFinalAbortErrorPauseEnqueuedCount += 1;
        postFinalAbortErrorPauseEnqueuedBeforeFinalReleaseCount += Number(
          postFinalAbortResponseCorrelation?.valid === true &&
            postFinalAbortResponseCorrelation.lifecycle?.state ===
              "final-response-command-in-flight",
        );
        resolvePostFinalAbortErrorPauseEnqueued();
      }
      const handleLoopbackPausedRequest = async () => {
        if (responseStagePause) {
          if (event.request.url === postFinalAbortUrl) {
            const responseCorrelation =
              postFinalAbortResponseCorrelation ||
              resolvePostFinalAbortResponseCorrelation(event);
            assert.equal(responseCorrelation.valid, true);
            assert.equal(
              ["same-fetch", "same-network-single-alias"].includes(
                responseCorrelation.source,
              ),
              true,
            );
            postFinalAbortSameFetchCorrelationCount += Number(
              responseCorrelation.source === "same-fetch",
            );
            postFinalAbortAliasCorrelationCount += Number(
              responseCorrelation.source === "same-network-single-alias",
            );
            const primaryRequestId = responseCorrelation.primaryRequestId;
            assert.equal(typeof primaryRequestId, "string");
            const lifecycle =
              postFinalAbortLifecycleByFetchRequestId.get(primaryRequestId) ||
              null;
            assert.ok(lifecycle);
            const responseDecision = responseStageCorrelationDecision({
              responseStatusCode: event.responseStatusCode,
              responseErrorReason: event.responseErrorReason,
            });
            const lifecycleDecision = allowedEgressResponseLifecycleDecision({
              lifecycleState: lifecycle.state,
              responseStageDecision: responseDecision,
            });
            assert.equal(lifecycleDecision.valid, true);
            if (lifecycleDecision.kind === "post-final-error") {
              assert.equal(responseDecision.kind, "response-error");
              assert.equal(
                loopbackProxy.hasRequestStageAuthorization(primaryRequestId),
                false,
              );
              postFinalAbortResponseErrorPauseCount += 1;
              setPostFinalAbortLifecycleState(
                primaryRequestId,
                "post-final-error-command-in-flight",
              );
              const continueResponseParams =
                postFinalErrorContinueResponseParams(event.requestId);
              assert.deepEqual(Object.keys(continueResponseParams), [
                "requestId",
              ]);
              await cdp.send("Fetch.continueResponse", continueResponseParams);
              postFinalAbortNoOverrideContinueResponseSuccessCount += 1;
              setPostFinalAbortLifecycleState(
                primaryRequestId,
                "terminal-complete",
              );
              postFinalAbortLifecycleByFetchRequestId.delete(primaryRequestId);
              if (lifecycle.networkId !== null) {
                const aliases =
                  postFinalAbortFetchRequestIdsByNetworkId.get(
                    lifecycle.networkId,
                  ) || new Set();
                aliases.delete(primaryRequestId);
                if (aliases.size === 0) {
                  postFinalAbortFetchRequestIdsByNetworkId.delete(
                    lifecycle.networkId,
                  );
                }
              }
              return;
            }
            assert.equal(lifecycleDecision.kind, "primary");
            assert.equal(responseDecision.kind, "final");
            assert.equal(responseDecision.status, 200);
            assert.equal(event.responseErrorReason, undefined);
            const sanitizedFinal = sanitizeBrowserResponseHeaders(
              event.responseHeaders || [],
            );
            postFinalAbortFinalResponsePauseCount += 1;
            setPostFinalAbortLifecycleState(
              primaryRequestId,
              "final-response-command-in-flight",
            );
            await cdp.send("Fetch.continueResponse", {
              requestId: event.requestId,
              responseCode: responseDecision.status,
              responseHeaders: sanitizedFinal.responseHeaders,
            });
            await new Promise((resolve) => setTimeout(resolve, 100));
            assert.equal(postFinalAbortOpenResponses.size, 1);
            for (const response of postFinalAbortOpenResponses) {
              response.destroy();
            }
            let errorPauseEnqueueTimeout = null;
            try {
              await Promise.race([
                postFinalAbortErrorPauseEnqueued,
                new Promise((_, reject) => {
                  errorPauseEnqueueTimeout = setTimeout(
                    () =>
                      reject(
                        new Error(
                          "Timed out waiting for the post-final response error pause.",
                        ),
                      ),
                    2000,
                  );
                }),
              ]);
            } finally {
              if (errorPauseEnqueueTimeout !== null) {
                clearTimeout(errorPauseEnqueueTimeout);
              }
            }
            assert.equal(postFinalAbortErrorPauseEnqueuedCount, 1);
            assert.equal(
              postFinalAbortErrorPauseEnqueuedBeforeFinalReleaseCount,
              1,
            );
            assert.equal(
              loopbackProxy.hasRequestStageAuthorization(primaryRequestId),
              true,
            );
            loopbackProxy.completeRequestStageAuthorization(primaryRequestId);
            postFinalAbortProxyCompleteCount += 1;
            setPostFinalAbortLifecycleState(
              primaryRequestId,
              "final-response-released",
            );
            return;
          }
          const observation = rewriteObservations.get(event.requestId);
          assert.ok(observation);
          assert.equal(event.responseErrorReason, undefined);
          const responseStageDecision = responseStageCorrelationDecision({
            responseStatusCode: event.responseStatusCode,
          });
          const responseStatus = responseStageDecision.status;
          if (responseStageDecision.kind === "informational") {
            assert.equal(responseStageDecision.terminal, false);
            const sanitizedInformational = sanitizeBrowserResponseHeaders(
              event.responseHeaders || [],
            );
            networkBackedInformationalResponsePauseCount += 1;
            networkBackedInformationalEgressHeaderObservationCount +=
              sanitizedInformational.egressHeaderObservationCount;
            networkBackedResponseHeaderSuppressionCount +=
              sanitizedInformational.omittedHeaderCount;
            await cdp.send("Fetch.continueResponse", {
              requestId: event.requestId,
              responseCode: responseStatus,
              responseHeaders: sanitizedInformational.responseHeaders,
            });
            return;
          }
          assert.equal(responseStageDecision.kind, "final");
          assert.equal(responseStageDecision.terminal, true);
          const sanitizedFinal = sanitizeBrowserResponseHeaders(
            event.responseHeaders || [],
          );
          networkBackedFinalResponsePauseCount += 1;
          networkBackedFinalEgressHeaderObservationCount +=
            sanitizedFinal.egressHeaderObservationCount;
          networkBackedResponseHeaderSuppressionCount +=
            sanitizedFinal.omittedHeaderCount;
          if (redirectResponseMustAbort(responseStatus)) {
            rewriteRedirectResponseAbortCount += 1;
            rewriteObservations.delete(event.requestId);
            await cdp.send("Fetch.failRequest", {
              requestId: event.requestId,
              errorReason: "BlockedByClient",
            });
            loopbackProxy.completeRequestStageAuthorization(event.requestId);
            return;
          }
          assert.equal(responseStatus, 200);
          const responseBody = await cdp.send("Fetch.getResponseBody", {
            requestId: event.requestId,
          });
          const responseBytes = Buffer.from(
            responseBody.body,
            responseBody.base64Encoded ? "base64" : "utf8",
          );
          networkBackedResponseBodyHashMatchCount += Number(
            secretSha256(responseBytes) ===
              secretSha256(observation.expectedBody),
          );
          rewriteObservations.delete(event.requestId);
          const syntheticResponseHeaders =
            sanitizedFinal.responseHeaders.filter(
              ({ name }) => name !== "content-length",
            );
          await cdp.send("Fetch.fulfillRequest", {
            requestId: event.requestId,
            responseCode: responseStatus,
            responseHeaders: syntheticResponseHeaders,
            body: responseBytes.toString("base64"),
          });
          loopbackProxy.completeRequestStageAuthorization(event.requestId);
          return;
        }
        if (hasVercelSkipToolbarRequestHeader(event.request.headers)) {
          loopbackBrowserSkipToolbarHeaderPreTransmissionBlockCount += 1;
          await cdp.send("Fetch.failRequest", {
            requestId: event.requestId,
            errorReason: "BlockedByClient",
          });
          return;
        }
        const postDataOmissionFixture =
          event.request.url === largeSensitiveTelemetryUrl;
        if (postDataOmissionFixture) {
          assert.equal(event.request.hasPostData, true);
          assert.equal(typeof event.request.postData, "string");
          assert.equal(event.request.postData, largeSensitiveBody);
          assert.ok(
            typeof event.networkId === "string" && event.networkId.length > 0,
          );
          postDataOmissionFixtureInjectionCount += 1;
          postDataOmissionFixtureRealNetworkIdCount += 1;
        }
        const postDataOmissionFixtureEvent = postDataOmissionFixture
          ? {
              ...event,
              request: {
                ...event.request,
                hasPostData: true,
                postData: undefined,
              },
            }
          : event;
        const resolvedPostData = await resolvePausedRequestPostData({
          event: postDataOmissionFixtureEvent,
          send: (method, params) => cdp.send(method, params),
        });
        fullPostDataResolutionCount += 1;
        fullPostDataNetworkFallbackCount += Number(
          resolvedPostData.source === "network-domain",
        );
        if (event.request.url === largeSensitiveTelemetryUrl) {
          assert.equal(resolvedPostData.source, "network-domain");
          fullPostDataRecoveredBodyExactMatchCount += Number(
            resolvedPostData.postData === largeSensitiveBody,
          );
          fullPostDataRecoveredBodyBytes = resolvedPostData.postDataBytes;
          fullPostDataRecoveredBodySha256 = secretSha256(
            Buffer.from(resolvedPostData.postData, "utf8"),
          );
        }
        const resolvedEvent = {
          ...event,
          request: {
            ...event.request,
            postData: resolvedPostData.postData,
          },
        };
        const parsedRequest = new URL(event.request.url);
        const requestPath = parsedRequest.pathname;
        const requestHostname = parsedRequest.hostname.toLowerCase();
        directEarlyHintsAllowedHostFetchRequestStageObservationCount += Number(
          event.request.url === directEarlyHintsAllowedHostTargetUrl,
        );
        if (
          event.resourceType === "Document" &&
          canonicalNetworkHostname(requestHostname) === "www.google.com"
        ) {
          recaptchaIframeDocumentRequestCount += 1;
        }
        const preTransmissionInspection =
          inspectLoopbackPausedRequest(resolvedEvent);
        preTransmissionBoundaryInspectionCount += 1;
        rawSensitivePreTransmissionInspectionCount += 1;
        const rawSensitiveDecision = unifiedSensitivePreTransmissionDecision({
          requestUrl: event.request.url,
          method: event.request.method,
          headers: event.request.headers,
          postData: resolvedPostData.postData,
          inspection: preTransmissionInspection,
          stagingApiKey: syntheticStagingApiKey,
          credentialValues: [syntheticTestEmail, syntheticTestPassword],
          refreshTokenValues: [syntheticRefreshToken],
          debugToken: syntheticDebugToken,
          debugSentinel: APP_CHECK_DEBUG_SENTINEL,
          bypassSecret: syntheticBypassSecret,
        });
        if (!rawSensitiveDecision.valid) {
          directEarlyHintsAllowedHostFetchRequestStageBlockCount += Number(
            event.request.url === directEarlyHintsAllowedHostTargetUrl,
          );
          rawSensitivePreTransmissionBlockCount += 1;
          rawProductionPreTransmissionBlockCount += Number(
            rawSensitiveDecision.marker === "production",
          );
          rawVercelBypassPreTransmissionBlockCount += Number(
            rawSensitiveDecision.marker === "vercel-bypass-scope",
          );
          rawStagingApiKeyPreTransmissionBlockCount += Number(
            rawSensitiveDecision.marker === "staging-api-key-scope",
          );
          rawTestCredentialPreTransmissionBlockCount += Number(
            rawSensitiveDecision.marker === "test-credential-scope",
          );
          rawRefreshTokenPreTransmissionBlockCount += Number(
            rawSensitiveDecision.marker === "refresh-token-scope",
          );
          rawDebugTokenPreTransmissionBlockCount += Number(
            rawSensitiveDecision.marker === "debug-token-scope",
          );
          rawDebugSentinelPreTransmissionBlockCount += Number(
            rawSensitiveDecision.marker === "debug-sentinel-scope",
          );
          if (rawSensitiveDecision.marker === "production") {
            preTransmissionBoundaryBlockAttemptCount += 1;
            preTransmissionBoundaryProductionBlockCount += 1;
            if (canonicalNetworkHostname(requestHostname) === "westory.kr") {
              dottedProductionBlockedMethods.push(event.request.method);
            }
            if (
              [
                "identitytoolkit.googleapis.com",
                "securetoken.googleapis.com",
              ].includes(canonicalNetworkHostname(requestHostname))
            ) {
              dottedFirebaseBlockedPaths.push(requestPath);
            }
            if (
              canonicalNetworkHostname(requestHostname).endsWith(
                ".firebasedatabase.app",
              )
            ) {
              regionalRealtimeDatabaseBlockedPaths.push(requestPath);
            }
          }
          stagingApiKeyScopeViolationBlockCount += Number(
            rawSensitiveDecision.marker === "staging-api-key-scope",
          );
          testCredentialScopeViolationBlockCount += Number(
            rawSensitiveDecision.marker === "test-credential-scope",
          );
          refreshTokenScopeViolationBlockCount += Number(
            rawSensitiveDecision.marker === "refresh-token-scope",
          );
          debugMaterialScopeViolationBlockCount += Number(
            ["debug-token-scope", "debug-sentinel-scope"].includes(
              rawSensitiveDecision.marker,
            ),
          );
          await cdp.send("Fetch.failRequest", {
            requestId: event.requestId,
            errorReason: "BlockedByClient",
          });
          if (rawSensitiveDecision.marker === "production") {
            preTransmissionBoundaryFailRequestCount += 1;
          }
          return;
        }
        const telemetryDecision = optionalTelemetrySuppressionDecision({
          requestUrl: event.request.url,
          method: event.request.method,
        });
        if (telemetryDecision.eligible) {
          optionalTelemetrySuppressionCount += 1;
          await cdp.send("Fetch.failRequest", {
            requestId: event.requestId,
            errorReason: "BlockedByClient",
          });
          return;
        }
        const preTransmissionDecision = preTransmissionBoundaryDecision({
          ...preTransmissionInspection,
          crossOriginDocument: isCrossOriginDocumentRequest({
            requestUrl: event.request.url,
            resourceType: event.resourceType,
            stableBrowserOrigin: stableOrigin,
          }),
        });
        if (preTransmissionDecision.block) {
          directEarlyHintsAllowedHostFetchRequestStageBlockCount += Number(
            event.request.url === directEarlyHintsAllowedHostTargetUrl,
          );
          preTransmissionBoundaryBlockAttemptCount += 1;
          preTransmissionBoundaryProductionBlockCount += Number(
            preTransmissionDecision.marker === "production",
          );
          preTransmissionBoundaryCrossOriginDocumentBlockCount += Number(
            preTransmissionDecision.marker === "cross-origin-document",
          );
          preTransmissionBoundaryUnboundFirebaseBlockCount += Number(
            preTransmissionDecision.marker === "unbound-firebase",
          );
          preTransmissionBoundaryNonFirebaseHostnameBlockCount += Number(
            preTransmissionDecision.marker ===
              "non-firebase-hostname-not-allowlisted",
          );
          preTransmissionBoundaryMalformedUrlBlockCount += Number(
            preTransmissionDecision.marker === "malformed-url-encoding",
          );
          if (canonicalNetworkHostname(requestHostname) === "westory.kr") {
            dottedProductionBlockedMethods.push(event.request.method);
          }
          if (
            [
              "identitytoolkit.googleapis.com",
              "securetoken.googleapis.com",
            ].includes(canonicalNetworkHostname(requestHostname))
          ) {
            dottedFirebaseBlockedPaths.push(requestPath);
          }
          if (
            canonicalNetworkHostname(requestHostname).endsWith(
              ".firebasedatabase.app",
            )
          ) {
            regionalRealtimeDatabaseBlockedPaths.push(requestPath);
          }
          if (preTransmissionDecision.marker === "cross-origin-document") {
            crossOriginDocumentBlockedPaths.push(requestPath);
          }
          if (requestPath === "/event-source-wire") {
            eventSourceBlockedPaths.push(requestPath);
          }
          await cdp.send("Fetch.failRequest", {
            requestId: event.requestId,
            errorReason: "BlockedByClient",
          });
          preTransmissionBoundaryFailRequestCount += 1;
          return;
        }
        const deterministicDecision = deterministicResponseDecision({
          requestUrl: event.request.url,
          method: event.request.method,
          resourceType: event.resourceType,
          headers: event.request.headers,
          postData: resolvedPostData.postData,
          stableBrowserOrigin: stableOrigin,
        });
        if (deterministicDecision.scoped) {
          if (!deterministicDecision.eligible) {
            deterministicScopeMismatchBlockCount += 1;
            await cdp.send("Fetch.failRequest", {
              requestId: event.requestId,
              errorReason: "BlockedByClient",
            });
            return;
          }
          const payload = deterministicFulfillPayload(
            deterministicDecision.responseContract,
          );
          deterministicHolidayFulfillCount += Number(
            deterministicDecision.id ===
              contract.browserTransport.deterministicLocalResponse.id,
          );
          deterministicRecaptchaFulfillCount += Number(
            deterministicDecision.id ===
              contract.browserTransport.deterministicRecaptchaResponse.id,
          );
          await cdp.send("Fetch.fulfillRequest", {
            requestId: event.requestId,
            responseCode: payload.responseCode,
            responseHeaders: payload.responseHeaders,
            body: payload.body,
          });
          return;
        }
        const externalDecision = externalStaticRequestDecision({
          requestUrl: event.request.url,
          method: event.request.method,
          resourceType: event.resourceType,
          headers: event.request.headers,
          postData: resolvedPostData.postData,
        });
        if (externalDecision.scoped) {
          if (
            !externalDecision.eligible ||
            externalDecision.action !== "local-node-module-fulfill"
          ) {
            externalStaticScopeMismatchBlockCount += 1;
            await cdp.send("Fetch.failRequest", {
              requestId: event.requestId,
              errorReason: "BlockedByClient",
            });
            return;
          }
          const payload = localFirebaseModulePayload(event.request.url);
          firebaseModuleLocalFulfillCount += 1;
          await cdp.send("Fetch.fulfillRequest", {
            requestId: event.requestId,
            responseCode: payload.responseCode,
            responseHeaders: payload.responseHeaders,
            body: payload.body,
          });
          return;
        }
        if (event.redirectedRequestId) {
          rewriteRedirectFollowAttemptCount += 1;
          await cdp.send("Fetch.failRequest", {
            requestId: event.requestId,
            errorReason: "BlockedByClient",
          });
          return;
        }
        const rewriteTarget = loopbackRewriteTargets.get(event.request.url);
        if (rewriteTarget) {
          const bypassEligible = exactOriginTransportAllowed({
            value: rewriteTarget,
            allowedOrigins: loopbackBypassAllowedOrigins,
            transportContract: loopbackBypassTransportContract,
          });
          assert.equal(bypassEligible, true);
          rewriteRequestCount += 1;
          const immutableResponse = await fetch(rewriteTarget, {
            method: "GET",
            headers: createNodeOwnedVercelRequestHeaders(syntheticBypassSecret),
            redirect: "manual",
          });
          if (redirectResponseMustAbort(immutableResponse.status)) {
            rewriteRedirectResponseAbortCount += 1;
            await immutableResponse.body?.cancel();
            await cdp.send("Fetch.failRequest", {
              requestId: event.requestId,
              errorReason: "BlockedByClient",
            });
            return;
          }
          assert.equal(immutableResponse.status, 200);
          assert.equal(new URL(immutableResponse.url).origin, upstreamOrigin);
          const responseBytes = Buffer.from(
            await immutableResponse.arrayBuffer(),
          );
          if (event.resourceType === "Document") {
            if (containsVercelPreviewToolbarMarkup(responseBytes)) {
              toolbarParserDocumentRejectCount += 1;
              await cdp.send("Fetch.failRequest", {
                requestId: event.requestId,
                errorReason: "BlockedByClient",
              });
              return;
            }
            const parserMarkupDecision = immutableDocumentParserMarkupDecision(
              responseBytes,
              {
                allowExactInertTestFixture:
                  event.request.url === stableDocumentUrl,
                documentOrigin: stableOrigin,
              },
            );
            if (!parserMarkupDecision.valid) {
              unsafeParserDocumentRejectCount += 1;
              await cdp.send("Fetch.failRequest", {
                requestId: event.requestId,
                errorReason: "BlockedByClient",
              });
              return;
            }
          }
          const expectedBody =
            event.request.url === stableDocumentUrl
              ? documentPayload
              : scriptPayload;
          rewriteResponseCount += 1;
          rewriteBodyHashMatchCount += Number(
            secretSha256(responseBytes) === secretSha256(expectedBody),
          );
          await cdp.send("Fetch.fulfillRequest", {
            requestId: event.requestId,
            responseCode: 200,
            responseHeaders: [
              { name: "cache-control", value: "no-store" },
              {
                name: "content-type",
                value:
                  immutableResponse.headers.get("content-type") ||
                  (event.resourceType === "Document"
                    ? "text/html; charset=utf-8"
                    : "text/javascript; charset=utf-8"),
              },
              { name: "x-dns-prefetch-control", value: "off" },
            ],
            body: responseBytes.toString("base64"),
          });
          return;
        }
        if ([probeUrl, postFinalAbortUrl].includes(event.request.url)) {
          assert.equal(
            exactOriginTransportAllowed({
              value: event.request.url,
              allowedOrigins: loopbackBypassAllowedOrigins,
              transportContract: loopbackBypassTransportContract,
            }),
            false,
          );
          const headerEntries = Object.entries(event.request.headers || {}).map(
            ([name, value]) => ({ name, value: String(value) }),
          );
          const postFinalAbortProbe = event.request.url === postFinalAbortUrl;
          if (postFinalAbortProbe) {
            const requestInvariant =
              allowedEgressRequestInvariantForEvent(event);
            assert.ok(requestInvariant);
            const networkId = requestInvariant.networkId;
            postFinalAbortLifecycleByFetchRequestId.set(
              event.requestId,
              Object.freeze({
                primaryRequestId: event.requestId,
                requestInvariant,
                networkId,
                state: "request-continue-in-flight",
              }),
            );
            if (networkId !== null) {
              postFinalAbortFetchRequestIdsByNetworkId.set(
                networkId,
                new Set([event.requestId]),
              );
            }
          } else {
            rewriteObservations.set(event.requestId, {
              kind: "network-backed-probe",
              expectedBody: networkBackedProbeResponseBody,
            });
          }
          loopbackProxy.authorizeRequestStage({
            requestId: event.requestId,
            requestUrl: event.request.url,
            requestMethod: event.request.method,
            requestOrigin: stableOrigin,
            stage: "loopback-capture",
          });
          try {
            await cdp.send("Fetch.continueRequest", {
              requestId: event.requestId,
              headers: [
                ...headerEntries.filter(
                  ({ name }) => name.toLowerCase() !== "x-firebase-appcheck",
                ),
                { name: "X-Firebase-AppCheck", value: syntheticJwt },
              ],
              interceptResponse: true,
            });
            if (postFinalAbortProbe) {
              setPostFinalAbortLifecycleState(
                event.requestId,
                "response-awaiting",
              );
            }
          } catch (error) {
            if (
              postFinalAbortProbe &&
              loopbackProxy.hasRequestStageAuthorization(event.requestId)
            ) {
              postFinalAbortProxyRevokeCount += 1;
            }
            loopbackProxy.revokeRequestStageAuthorization(event.requestId);
            rewriteObservations.delete(event.requestId);
            postFinalAbortLifecycleByFetchRequestId.delete(event.requestId);
            if (event.networkId) {
              postFinalAbortFetchRequestIdsByNetworkId.delete(event.networkId);
            }
            throw error;
          }
          return;
        }
        unexpectedContinueRequestCount += 1;
        unexpectedRequestUrls.push(event.request.url);
        await cdp.send("Fetch.failRequest", {
          requestId: event.requestId,
          errorReason: "BlockedByClient",
        });
      };
      const handlerPromise = (
        event.request.url === postFinalAbortUrl
          ? loopbackHandlerTaskCoordinator.enqueue(
              handlerCorrelationId,
              handleLoopbackPausedRequest,
            )
          : handleLoopbackPausedRequest()
      )
        .catch(async (error) => {
          const revokeRequestId =
            postFinalAbortResponseCorrelation?.primaryRequestId ||
            event.requestId;
          if (
            event.request.url === postFinalAbortUrl &&
            loopbackProxy.hasRequestStageAuthorization(revokeRequestId)
          ) {
            postFinalAbortProxyRevokeCount += 1;
          }
          loopbackProxy.revokeRequestStageAuthorization(revokeRequestId);
          if (error instanceof PausedRequestPostDataResolutionError) {
            fullPostDataResolutionFailureCount += 1;
          }
          try {
            await cdp.send("Fetch.failRequest", {
              requestId: event.requestId,
              errorReason: "BlockedByClient",
            });
          } catch (_failError) {
            // The test remains fatal even if the browser terminated first.
          }
          throw error;
        })
        .finally(() => handlerPromises.delete(handlerPromise));
      handlerPromises.add(handlerPromise);
    });
    await cdp.send("Fetch.enable", {
      patterns: [{ urlPattern: "*", requestStage: "Request" }],
    });
    await page.waitForTimeout(250);
    loopbackProxy.setAuditStage("loopback-capture");
    await loopbackBoundaryController.handoffPrimaryRequestBoundary("loopback");
    await page.goto(stableDocumentUrl);
    await page.waitForFunction(
      () =>
        globalThis.__w10pImmutableScript === "w10p-cdp-url-override-payload-v2",
    );
    const browserOriginAttestation = await page.evaluate(
      (scriptUrl) => ({
        locationOrigin: location.origin,
        navigationOrigin: new URL(
          performance.getEntriesByType("navigation")[0].name,
        ).origin,
        resourceOrigin: new URL(
          performance
            .getEntriesByType("resource")
            .find((entry) => entry.name === scriptUrl).name,
        ).origin,
      }),
      stableScriptUrl,
    );
    assert.deepEqual(browserOriginAttestation, {
      locationOrigin: stableOrigin,
      navigationOrigin: stableOrigin,
      resourceOrigin: stableOrigin,
    });
    const browserSkipToolbarHeaderRejectedBeforeWire = await page.evaluate(
      async (url) => {
        try {
          await fetch(url, {
            headers: { "x-vercel-skip-toolbar": "1" },
          });
          return false;
        } catch {
          return true;
        }
      },
      browserSkipToolbarHeaderNegativeUrl,
    );
    assert.equal(browserSkipToolbarHeaderRejectedBeforeWire, true);
    while (handlerPromises.size > 0) {
      await Promise.all([...handlerPromises]);
    }
    assert.equal(loopbackBrowserSkipToolbarHeaderPreTransmissionBlockCount, 1);
    await page.waitForTimeout(250);
    assert.deepEqual(
      rawExternalWireConnections,
      [],
      "Parser markup, 103 Early Hints, or final Link headers reached raw wire.",
    );
    await page.evaluate((url) => {
      const frame = document.createElement("iframe");
      frame.id = "w10p-unsafe-parser-negative";
      frame.src = url;
      document.body.append(frame);
    }, stableUnsafeParserUrl);
    await page.waitForTimeout(250);
    while (handlerPromises.size > 0) {
      await Promise.all([...handlerPromises]);
    }
    assert.equal(unsafeParserDocumentRejectCount, 1);
    assert.deepEqual(rawExternalWireConnections, []);
    await page.evaluate(() =>
      document.querySelector("#w10p-unsafe-parser-negative")?.remove(),
    );
    await page.evaluate((url) => {
      const frame = document.createElement("iframe");
      frame.id = "w10p-toolbar-parser-negative";
      frame.src = url;
      document.body.append(frame);
    }, stableToolbarParserUrl);
    await page.waitForTimeout(250);
    while (handlerPromises.size > 0) {
      await Promise.all([...handlerPromises]);
    }
    assert.equal(toolbarParserDocumentRejectCount, 1);
    assert.deepEqual(rawExternalWireConnections, []);
    await page.evaluate(() =>
      document.querySelector("#w10p-toolbar-parser-negative")?.remove(),
    );
    const proxyAllowedTunnelCountBeforeSensitiveNegatives =
      loopbackProxy.snapshot().allowedConnectCount;
    const sensitiveAllowedHostnameNegativeResults = await page.evaluate(
      async ({ wrongApiKeyUrl, wrongCredentialScopeUrl, email, password }) => {
        const rejected = async (url, init) => {
          try {
            await fetch(url, init);
            return false;
          } catch {
            return true;
          }
        };
        return [
          await rejected(wrongApiKeyUrl),
          await rejected(wrongCredentialScopeUrl, {
            method: "POST",
            headers: { "content-type": "text/plain;charset=UTF-8" },
            body: JSON.stringify({ email, password, returnSecureToken: true }),
          }),
        ];
      },
      {
        wrongApiKeyUrl: wrongApiKeyAllowedHostnameUrl,
        wrongCredentialScopeUrl: wrongCredentialScopeAllowedHostnameUrl,
        email: syntheticTestEmail,
        password: syntheticTestPassword,
      },
    );
    assert.deepEqual(sensitiveAllowedHostnameNegativeResults, [true, true]);
    while (handlerPromises.size > 0) {
      await Promise.all([...handlerPromises]);
    }
    assert.equal(
      loopbackProxy.snapshot().allowedConnectCount,
      proxyAllowedTunnelCountBeforeSensitiveNegatives,
    );
    sensitiveAllowedHostnameBlockedBeforeProxyTunnelCount =
      sensitiveAllowedHostnameNegativeResults.length;
    const probeResponse = await page.evaluate(async (url) => {
      const response = await fetch(url);
      return {
        status: response.status,
        body: await response.json(),
        contentType: response.headers.get("content-type"),
        link: response.headers.get("link"),
        altSvc: response.headers.get("alt-svc"),
        refresh: response.headers.get("refresh"),
        nel: response.headers.get("nel"),
        reportTo: response.headers.get("report-to"),
        reportingEndpoints: response.headers.get("reporting-endpoints"),
        contentSecurityPolicyReportOnly: response.headers.get(
          "content-security-policy-report-only",
        ),
        location: response.headers.get("location"),
      };
    }, probeUrl);
    assert.deepEqual(probeResponse, {
      status: 200,
      body: { ok: true },
      contentType: "application/json; charset=utf-8",
      link: null,
      altSvc: null,
      refresh: null,
      nel: null,
      reportTo: null,
      reportingEndpoints: null,
      contentSecurityPolicyReportOnly: null,
      location: null,
    });
    await page.waitForTimeout(250);
    const positiveProxySnapshot = loopbackProxy.snapshot();
    directBrowserAllowedFirebaseTunnelCount =
      positiveProxySnapshot.allowedConnectCount;
    assert.ok(directBrowserAllowedFirebaseTunnelCount > 0);
    assert.deepEqual(
      positiveProxySnapshot.allowedConnectHosts.map(({ hostname }) => hostname),
      ["identitytoolkit.googleapis.com"],
    );
    directEarlyHintsAllowedHostAdditionalTunnelCount =
      positiveProxySnapshot.allowedConnectCount - 1;
    assert.equal(directEarlyHintsAllowedHostAdditionalTunnelCount, 0);
    directEarlyHintsAllowedHostProxyDenyCountBeforeManualFixture =
      positiveProxySnapshot.deniedConnectAuthorities.find(
        ({ authority }) => authority === "identitytoolkit.googleapis.com:443",
      )?.count || 0;
    assert.equal(
      directEarlyHintsAllowedHostFetchRequestStageBlockCount,
      directEarlyHintsAllowedHostFetchRequestStageObservationCount,
    );
    const postFinalAbortResult = await page.evaluate(async (url) => {
      let watchdogFired = false;
      const controller = new AbortController();
      const watchdog = setTimeout(() => {
        watchdogFired = true;
        controller.abort();
      }, 5000);
      try {
        const response = await fetch(url, { signal: controller.signal });
        const headersObserved = response.status === 200;
        try {
          await response.text();
          return { headersObserved, bodyRejected: false, watchdogFired };
        } catch {
          return { headersObserved, bodyRejected: true, watchdogFired };
        }
      } catch {
        return {
          headersObserved: false,
          bodyRejected: true,
          watchdogFired,
        };
      } finally {
        clearTimeout(watchdog);
      }
    }, postFinalAbortUrl);
    postFinalAbortHeadersObserved = postFinalAbortResult.headersObserved;
    postFinalAbortBodyRejected = postFinalAbortResult.bodyRejected;
    postFinalAbortWatchdogFired = postFinalAbortResult.watchdogFired;
    assert.equal(postFinalAbortHeadersObserved, true);
    assert.equal(postFinalAbortBodyRejected, true);
    assert.equal(postFinalAbortWatchdogFired, false);
    while (handlerPromises.size > 0) {
      await Promise.all([...handlerPromises]);
    }
    await page.waitForTimeout(250);
    assert.equal(postFinalAbortFinalResponsePauseCount, 1);
    assert.equal(postFinalAbortResponseErrorPauseCount, 1);
    assert.equal(postFinalAbortNoOverrideContinueResponseSuccessCount, 1);
    assert.equal(postFinalAbortProxyCompleteCount, 1);
    assert.equal(postFinalAbortProxyRevokeCount, 0);
    assert.equal(postFinalAbortErrorPauseEnqueuedCount, 1);
    assert.equal(postFinalAbortErrorPauseEnqueuedBeforeFinalReleaseCount, 1);
    assert.equal(postFinalAbortRequestFailureCount, 1);
    assert.deepEqual(postFinalAbortRequestFailureTexts, [
      "net::ERR_CONTENT_LENGTH_MISMATCH",
    ]);
    assert.equal(
      optionalTelemetrySuppressionDecision({
        requestUrl: postFinalAbortUrl,
        method: "GET",
      }).eligible,
      false,
    );
    assert.equal(
      postFinalAbortSameFetchCorrelationCount +
        postFinalAbortAliasCorrelationCount,
      2,
    );
    assert.equal(loopbackHandlerTaskCoordinator.pendingCount(), 0);
    assert.equal(postFinalAbortLifecycleByFetchRequestId.size, 0);
    assert.equal(postFinalAbortFetchRequestIdsByNetworkId.size, 0);
    assert.equal(postFinalAbortOpenResponses.size, 0);
    const postFinalAbortProxySnapshot = loopbackProxy.snapshot();
    assert.ok(
      postFinalAbortProxySnapshot.allowedConnectCount >=
        positiveProxySnapshot.allowedConnectCount,
    );
    assert.ok(
      postFinalAbortProxySnapshot.allowedConnectCount <=
        positiveProxySnapshot.allowedConnectCount + 1,
    );
    directBrowserAllowedFirebaseTunnelCount =
      postFinalAbortProxySnapshot.allowedConnectCount;
    const deniedProxyFixtures = [
      `CONNECT ${productionImmutableHostname}:443 HTTP/1.1\r\nHost: ${productionImmutableHostname}:443\r\n\r\n`,
      "CONNECT unknown-external.invalid:443 HTTP/1.1\r\nHost: unknown-external.invalid:443\r\n\r\n",
      "CONNECT securetoken.googleapis.com:443 HTTP/1.1\r\nHost: securetoken.googleapis.com:443\r\n\r\n",
      "CONNECT 127.0.0.1:443 HTTP/1.1\r\nHost: 127.0.0.1:443\r\n\r\n",
      "CONNECT identitytoolkit.googleapis.com:444 HTTP/1.1\r\nHost: identitytoolkit.googleapis.com:444\r\n\r\n",
      "GET http://unknown-external.invalid/absolute-form-wire HTTP/1.1\r\nHost: unknown-external.invalid\r\nConnection: close\r\n\r\n",
      "GET /upgrade-wire HTTP/1.1\r\nHost: unknown-external.invalid\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n",
    ];
    for (const requestText of deniedProxyFixtures) {
      const proxyResponse = await sendLoopbackProxyFixtureRequest({
        proxyUrl: loopbackProxyUrl,
        requestText,
      });
      assert.match(proxyResponse, /^HTTP\/1\.1 403 Forbidden/u);
      proxyDenyFixtureRequestCount += 1;
    }
    const deniedProxySnapshot = loopbackProxy.snapshot();
    assert.ok(deniedProxySnapshot.deniedConnectCount >= 4);
    assert.ok(deniedProxySnapshot.unallowlistedHostnameDenyCount >= 2);
    assert.ok(deniedProxySnapshot.uncorrelatedAllowedConnectDenyCount >= 1);
    assert.ok(deniedProxySnapshot.ipLiteralDenyCount >= 1);
    assert.ok(deniedProxySnapshot.alternatePortDenyCount >= 1);
    assert.ok(deniedProxySnapshot.httpAbsoluteFormDenyCount >= 1);
    assert.ok(deniedProxySnapshot.upgradeDenyCount >= 1);
    assert.deepEqual(rawExternalWireConnections, []);
    const holidayPayload = await page.evaluate(async (url) => {
      const response = await fetch(url);
      return {
        status: response.status,
        cacheControl: response.headers.get("cache-control"),
        contentType: response.headers.get("content-type"),
        body: await response.json(),
      };
    }, holidayUrl);
    assert.deepEqual(holidayPayload, {
      status: 200,
      cacheControl: "no-store",
      contentType: "application/json; charset=utf-8",
      body: { holidays: [] },
    });
    const firebaseModuleImportAttestation = await page.evaluate(
      async (urls) => {
        const exportCounts = [];
        for (const url of urls) {
          const module = await import(url);
          exportCounts.push({ url, exportCount: Object.keys(module).length });
        }
        return exportCounts;
      },
      firebaseModuleUrls,
    );
    assert.equal(firebaseModuleImportAttestation.length, 4);
    assert.equal(
      firebaseModuleImportAttestation.every(
        ({ exportCount }) => exportCount > 0,
      ),
      true,
    );
    firebaseModuleDynamicImportSuccessCount =
      firebaseModuleImportAttestation.length;
    const recaptchaBootstrapAttestation = await page.evaluate(
      async (scriptUrl) => {
        delete globalThis.grecaptcha;
        await new Promise((resolveLoad, rejectLoad) => {
          const script = document.createElement("script");
          script.src = scriptUrl;
          script.onload = resolveLoad;
          script.onerror = () => rejectLoad(new Error("stub load failed"));
          document.head.append(script);
        });
        let readyCalled = false;
        globalThis.grecaptcha.enterprise.ready(() => {
          readyCalled = true;
        });
        const renderResult = globalThis.grecaptcha.enterprise.render();
        const executeResult = await globalThis.grecaptcha.enterprise.execute();
        return {
          readyCalled,
          renderResult,
          executeResult,
          iframeCount: document.querySelectorAll("iframe").length,
        };
      },
      recaptchaScriptUrl,
    );
    assert.deepEqual(recaptchaBootstrapAttestation, {
      readyCalled: true,
      renderResult: 0,
      executeResult: "w10p-recaptcha-stub-token",
      iframeCount: 0,
    });
    const telemetryRejectedBeforeWire = await page.evaluate(async (url) => {
      try {
        await fetch(url, { method: "POST", body: "{}" });
        return false;
      } catch (_error) {
        return true;
      }
    }, telemetryUrl);
    assert.equal(telemetryRejectedBeforeWire, true);
    const rejectedRequest = async ({ url, method = "GET", headers, body }) =>
      page.evaluate(
        async (request) => {
          try {
            await fetch(request.url, {
              method: request.method,
              ...(request.headers ? { headers: request.headers } : {}),
              ...(request.body === null || request.body === undefined
                ? {}
                : { body: request.body }),
            });
            return false;
          } catch (_error) {
            return true;
          }
        },
        { url, method, headers: headers || null, body: body ?? null },
      );
    const rawSensitiveBlockCountBeforeTelemetryCases =
      rawSensitivePreTransmissionBlockCount;
    const telemetrySensitiveRequests = [
      {
        url: `${telemetryUrl}?key=${encodeURIComponent(syntheticStagingApiKey)}`,
        method: "POST",
        body: "{}",
      },
      { url: telemetryUrl, method: "POST", body: syntheticTestEmail },
      { url: telemetryUrl, method: "POST", body: syntheticRefreshToken },
      { url: telemetryUrl, method: "POST", body: syntheticDebugToken },
      { url: telemetryUrl, method: "POST", body: APP_CHECK_DEBUG_SENTINEL },
      {
        url: `${telemetryUrl}?bypass=${encodeURIComponent(syntheticBypassSecret)}`,
        method: "POST",
        body: "{}",
      },
    ];
    for (const request of telemetrySensitiveRequests) {
      assert.equal(await rejectedRequest(request), true);
    }
    const fullPostDataNetworkFallbackCountBeforeLargeBody =
      fullPostDataNetworkFallbackCount;
    const rawSensitiveBlockCountBeforeLargeBody =
      rawSensitivePreTransmissionBlockCount;
    const rawWireConnectionCountBeforeLargeBody =
      rawExternalWireConnections.length;
    assert.equal(
      await rejectedRequest({
        url: largeSensitiveTelemetryUrl,
        method: "POST",
        body: largeSensitiveBody,
      }),
      true,
    );
    assert.equal(
      fullPostDataNetworkFallbackCount -
        fullPostDataNetworkFallbackCountBeforeLargeBody,
      1,
    );
    assert.equal(postDataOmissionFixtureInjectionCount, 1);
    assert.equal(postDataOmissionFixtureRealNetworkIdCount, 1);
    assert.equal(fullPostDataRecoveredBodyExactMatchCount, 1);
    assert.equal(
      fullPostDataRecoveredBodyBytes,
      Buffer.byteLength(largeSensitiveBody, "utf8"),
    );
    assert.equal(
      fullPostDataRecoveredBodySha256,
      secretSha256(Buffer.from(largeSensitiveBody, "utf8")),
    );
    assert.equal(
      rawExternalWireConnections.length - rawWireConnectionCountBeforeLargeBody,
      0,
    );
    assert.equal(
      rawSensitivePreTransmissionBlockCount -
        rawSensitiveBlockCountBeforeLargeBody,
      1,
    );
    assert.equal(optionalTelemetrySuppressionCount, 1);
    assert.equal(
      rawSensitivePreTransmissionBlockCount -
        rawSensitiveBlockCountBeforeTelemetryCases,
      telemetrySensitiveRequests.length + 1,
    );
    assert.equal(
      await rejectedRequest({ url: firebaseModuleUrls[0], method: "HEAD" }),
      true,
    );
    for (const invalidHolidayUrl of invalidHolidayUrls) {
      assert.equal(await rejectedRequest({ url: invalidHolidayUrl }), true);
    }
    assert.equal(
      await rejectedRequest({
        url: holidayUrl,
        method: "POST",
        body: "{}",
      }),
      true,
    );
    assert.equal(await rejectedRequest({ url: stagingApiKeyExfilUrl }), true);
    assert.equal(await rejectedRequest({ url: credentialExfilUrl }), true);
    assert.equal(
      await rejectedRequest({
        url: refreshTokenExfilUrl,
        method: "POST",
        body: JSON.stringify({ refresh_token: syntheticRefreshToken }),
      }),
      true,
    );
    assert.equal(
      await rejectedRequest({
        url: debugTokenExfilUrl,
        method: "POST",
        body: syntheticDebugToken,
      }),
      true,
    );
    assert.equal(
      await rejectedRequest({
        url: debugSentinelExfilUrl,
        method: "POST",
        body: APP_CHECK_DEBUG_SENTINEL,
      }),
      true,
    );
    assert.equal(await rejectedRequest({ url: unknownExternalUrl }), true);
    assert.equal(
      await rejectedRequest({
        url: externalBodyExfilUrl,
        method: "POST",
        body: syntheticTestPassword,
      }),
      true,
    );
    assert.equal(
      await rejectedRequest({
        url: externalHeaderExfilUrl,
        headers: { "X-Goog-Api-Key": syntheticStagingApiKey },
      }),
      true,
    );
    const externalQueryExfilRejected = await page.evaluate(
      (url) =>
        new Promise((resolveScript) => {
          const script = document.createElement("script");
          script.src = url;
          script.onload = () => resolveScript(false);
          script.onerror = () => resolveScript(true);
          document.head.append(script);
        }),
      externalQueryExfilUrl,
    );
    assert.equal(externalQueryExfilRejected, true);
    const recaptchaOtherPathRejected = await page.evaluate(
      (url) =>
        new Promise((resolveScript) => {
          const script = document.createElement("script");
          script.src = url;
          script.onload = () => resolveScript(false);
          script.onerror = () => resolveScript(true);
          document.head.append(script);
        }),
      recaptchaDisallowedUrl,
    );
    assert.equal(recaptchaOtherPathRejected, true);
    const negativeBoundaryCases = [
      { url: `${stableOrigin}/production-get`, method: "GET", body: null },
      {
        url: `${stableOrigin}/production-post`,
        method: "POST",
        body: `sensitive=${syntheticJwt}`,
      },
      {
        url: `${stableOrigin}/unbound-firebase`,
        method: "POST",
        body: `sensitive=${syntheticJwt}`,
      },
      { url: productionImmutableUrl, method: "GET", body: null },
      { url: unknownVercelUrl, method: "GET", body: null },
      { url: vercelApexUrl, method: "GET", body: null },
      { url: vercelApexDottedUrl, method: "GET", body: null },
      { url: productionCustomDottedGetUrl, method: "GET", body: null },
      {
        url: productionCustomDottedPostUrl,
        method: "POST",
        body: `sensitive=${syntheticJwt}`,
      },
      {
        url: dottedAuthQueryKeyUrl,
        method: "POST",
        body: `sensitive=${syntheticJwt}`,
      },
      {
        url: dottedRefreshHeaderKeyUrl,
        method: "POST",
        body: `sensitive=${syntheticJwt}`,
        apiKeyHeader: syntheticProductionApiKey,
      },
      ...regionalRealtimeDatabaseUrls.map(({ url }) => ({
        url,
        method: "GET",
        body: null,
      })),
    ];
    for (const negativeCase of negativeBoundaryCases) {
      const rejectedBeforeWire = await page.evaluate(
        async ({ url, method, body, apiKeyHeader }) => {
          try {
            await fetch(url, {
              method,
              ...(apiKeyHeader
                ? { headers: { "X-Goog-Api-Key": apiKeyHeader } }
                : {}),
              ...(body === null ? {} : { body }),
            });
            return false;
          } catch (_error) {
            return true;
          }
        },
        {
          url: negativeCase.url,
          method: negativeCase.method,
          body: negativeCase.body,
          apiKeyHeader: negativeCase.apiKeyHeader || "",
        },
      );
      assert.equal(rejectedBeforeWire, true);
    }
    const secondaryCapabilityBlocks = await page.evaluate(
      async ({
        workerUrl,
        sharedWorkerUrl,
        serviceWorkerUrl,
        webSocketStreamUrl,
        allowedFirebaseWebSocketStreamUrl,
        allowedFirebaseWorkerFetchUrl,
        webTransportUrl,
        stunUrl,
        beaconUrl,
        workletUrl,
      }) => {
        const blocked = async (operation) => {
          try {
            await operation();
            return false;
          } catch (error) {
            return (
              error instanceof DOMException && error.name === "SecurityError"
            );
          }
        };
        return {
          dedicatedWorker: await blocked(() => new Worker(workerUrl)),
          sharedWorker: await blocked(() => new SharedWorker(sharedWorkerUrl)),
          serviceWorker: await blocked(() =>
            navigator.serviceWorker.register(serviceWorkerUrl),
          ),
          serviceWorkerPrototype: await blocked(() =>
            ServiceWorkerContainer.prototype.register.call(
              navigator.serviceWorker,
              serviceWorkerUrl,
            ),
          ),
          blobWorkerAllowedFirebaseFetch: await blocked(() => {
            const blobUrl = URL.createObjectURL(
              new Blob(
                [
                  `fetch(${JSON.stringify(allowedFirebaseWorkerFetchUrl)}).then(() => postMessage('unexpected'))`,
                ],
                {
                  type: "text/javascript",
                },
              ),
            );
            try {
              return new Worker(blobUrl);
            } finally {
              URL.revokeObjectURL(blobUrl);
            }
          }),
          webSocketStream: await blocked(
            () => new WebSocketStream(webSocketStreamUrl),
          ),
          webSocketStreamAllowedFirebase: await blocked(
            () => new WebSocketStream(allowedFirebaseWebSocketStreamUrl),
          ),
          webTransport: await blocked(() => new WebTransport(webTransportUrl)),
          rtcPeerConnection: await blocked(
            () =>
              new RTCPeerConnection({
                iceServers: [{ urls: stunUrl }],
              }),
          ),
          webkitRtcPeerConnection: await blocked(
            () =>
              new webkitRTCPeerConnection({
                iceServers: [{ urls: stunUrl }],
              }),
          ),
          sendBeacon: await blocked(() =>
            navigator.sendBeacon(beaconUrl, "w10p-no-wire"),
          ),
          sendBeaconPrototype: await blocked(() =>
            Navigator.prototype.sendBeacon.call(
              navigator,
              beaconUrl,
              "w10p-no-wire",
            ),
          ),
          worklet: await (async () => {
            if (globalThis.CSS?.paintWorklet?.addModule) {
              return blocked(() => CSS.paintWorklet.addModule(workletUrl));
            }
            if (globalThis.AudioContext) {
              const context = new AudioContext();
              try {
                if (context.audioWorklet?.addModule) {
                  return await blocked(() =>
                    context.audioWorklet.addModule(workletUrl),
                  );
                }
              } finally {
                await context.close();
              }
            }
            return true;
          })(),
        };
      },
      {
        workerUrl: workerWireUrl,
        sharedWorkerUrl: sharedWorkerWireUrl,
        serviceWorkerUrl: serviceWorkerWireUrl,
        webSocketStreamUrl: webSocketStreamWireUrl,
        allowedFirebaseWebSocketStreamUrl:
          allowedFirebaseWebSocketStreamWireUrl,
        allowedFirebaseWorkerFetchUrl: allowedFirebaseWorkerFetchWireUrl,
        webTransportUrl: webTransportWireUrl,
        stunUrl: stunWireUrl,
        beaconUrl: beaconWireUrl,
        workletUrl: workletWireUrl,
      },
    );
    assert.deepEqual(secondaryCapabilityBlocks, {
      dedicatedWorker: true,
      sharedWorker: true,
      serviceWorker: true,
      serviceWorkerPrototype: true,
      blobWorkerAllowedFirebaseFetch: true,
      webSocketStream: true,
      webSocketStreamAllowedFirebase: true,
      webTransport: true,
      rtcPeerConnection: true,
      webkitRtcPeerConnection: true,
      sendBeacon: true,
      sendBeaconPrototype: true,
      worklet: true,
    });
    const speculativeCapabilityBlocks = await page.evaluate(
      ({
        preconnectUrl,
        allowedFirebasePreconnectUrl,
        prefetchUrl,
        speculationUrl,
        pingUrl,
      }) => {
        const blocked = (operation) => {
          try {
            operation();
            return false;
          } catch (error) {
            return (
              error instanceof DOMException && error.name === "SecurityError"
            );
          }
        };
        const fixtureTemplate = document.querySelector(
          "#w10p-inert-parser-fixtures",
        );
        if (!(fixtureTemplate instanceof HTMLTemplateElement)) {
          throw new Error("inert parser fixture template is missing");
        }
        const parserFixtureRoot = fixtureTemplate.content;
        const parserPreconnect = parserFixtureRoot.querySelector(
          'link[rel~="preconnect"]',
        );
        const parserPrefetch = parserFixtureRoot.querySelector(
          'link[rel~="prefetch"]',
        );
        const parserSpeculation = parserFixtureRoot.querySelector(
          'script[type="speculationrules"]',
        );
        const parserPing = parserFixtureRoot.querySelector("#parser-ping");
        const parserSrcdoc = parserFixtureRoot.querySelector("#parser-srcdoc");
        if (
          !parserPreconnect ||
          !parserPrefetch ||
          !parserSpeculation ||
          !parserPing ||
          !parserSrcdoc
        ) {
          throw new Error("parser speculative fixtures are missing");
        }
        const speculativeMarkup = `<link rel="preconnect" href="${preconnectUrl}">`;
        const ping = parserPing.cloneNode(true);
        return {
          allowedFirebasePreconnectConnectedNode: blocked(() => {
            const link = document.createElement("link");
            link.rel = "preconnect";
            link.href = allowedFirebasePreconnectUrl;
            document.head.append(link);
          }),
          appendChild: blocked(() =>
            document.head.appendChild(parserPreconnect.cloneNode(true)),
          ),
          prepend: blocked(() =>
            document.head.prepend(parserPreconnect.cloneNode(true)),
          ),
          replaceChildren: blocked(() => {
            const fragment = document.createDocumentFragment();
            fragment.replaceChildren(parserPrefetch.cloneNode(true));
          }),
          insertAdjacentElement: blocked(() =>
            document.head.insertAdjacentElement(
              "beforeend",
              parserSpeculation.cloneNode(true),
            ),
          ),
          innerHTML: blocked(() => {
            const container = document.createElement("div");
            container.innerHTML = speculativeMarkup;
          }),
          insertAdjacentHTML: blocked(() => {
            const container = document.createElement("div");
            container.insertAdjacentHTML("beforeend", speculativeMarkup);
          }),
          setAttributeRel: blocked(() => {
            const link = document.createElement("link");
            link.setAttribute("rel", "preconnect");
          }),
          setAttributeHref: blocked(() => {
            const link = parserPreconnect.cloneNode(true);
            link.setAttribute("href", preconnectUrl);
          }),
          setAttributeNsRel: blocked(() => {
            const link = document.createElement("link");
            link.setAttributeNS(null, "rel", "prefetch");
          }),
          setAttributeNode: blocked(() => {
            const link = document.createElement("link");
            link.setAttributeNode(
              parserPreconnect.getAttributeNode("rel").cloneNode(true),
            );
          }),
          setAttributeNodeNs: blocked(() => {
            const link = document.createElement("link");
            link.setAttributeNodeNS(
              parserPreconnect.getAttributeNode("rel").cloneNode(true),
            );
          }),
          namedNodeMapSetNamedItem: blocked(() => {
            const link = document.createElement("link");
            link.attributes.setNamedItem(
              parserPreconnect.getAttributeNode("rel").cloneNode(true),
            );
          }),
          namedNodeMapSetNamedItemNs: blocked(() => {
            const link = document.createElement("link");
            link.attributes.setNamedItemNS(
              parserPreconnect.getAttributeNode("rel").cloneNode(true),
            );
          }),
          attrValue: blocked(() => {
            const link = document.createElement("link");
            link.setAttribute("rel", "stylesheet");
            link.getAttributeNode("rel").value = "preconnect";
          }),
          attrNodeValue: blocked(() => {
            const link = document.createElement("link");
            link.setAttribute("rel", "stylesheet");
            link.getAttributeNode("rel").nodeValue = "prefetch";
          }),
          attrTextContent: blocked(() => {
            const link = document.createElement("link");
            link.setAttribute("rel", "stylesheet");
            link.getAttributeNode("rel").textContent = "preload";
          }),
          connectedAttrValue: blocked(() => {
            const link = document.createElement("link");
            link.setAttribute("rel", "stylesheet");
            document.head.append(link);
            try {
              link.getAttributeNode("rel").value = "preconnect";
            } finally {
              link.remove();
            }
          }),
          detachedAttrOwnerFailClosed: blocked(() => {
            const attribute = parserPreconnect
              .getAttributeNode("rel")
              .cloneNode(true);
            attribute.value = "stylesheet";
          }),
          iframeSrcdocAttribute: blocked(() => {
            const frame = document.createElement("iframe");
            frame.setAttribute("srcdoc", parserSrcdoc.getAttribute("srcdoc"));
          }),
          iframeSrcdocProperty: blocked(() => {
            const frame = document.createElement("iframe");
            frame.srcdoc = parserSrcdoc.srcdoc;
          }),
          relProperty: blocked(() => {
            const link = document.createElement("link");
            link.rel = "dns-prefetch";
          }),
          hrefProperty: blocked(() => {
            const link = parserPreconnect.cloneNode(true);
            link.href = preconnectUrl;
          }),
          relList: blocked(() => {
            const link = document.createElement("link");
            link.relList.add("prerender");
          }),
          domParser: blocked(() =>
            new DOMParser().parseFromString(speculativeMarkup, "text/html"),
          ),
          contextualFragment: blocked(() =>
            document.createRange().createContextualFragment(speculativeMarkup),
          ),
          rangeInsertNode: blocked(() =>
            document.createRange().insertNode(parserPreconnect.cloneNode(true)),
          ),
          elementMoveBefore:
            typeof Element.prototype.moveBefore === "function"
              ? blocked(() =>
                  document.body.moveBefore(
                    parserPreconnect.cloneNode(true),
                    null,
                  ),
                )
              : true,
          documentFragmentMoveBefore:
            typeof DocumentFragment.prototype.moveBefore === "function"
              ? blocked(() =>
                  document
                    .createDocumentFragment()
                    .moveBefore(parserPreconnect.cloneNode(true), null),
                )
              : true,
          elementSetHTMLUnsafe:
            typeof Element.prototype.setHTMLUnsafe === "function"
              ? blocked(() => {
                  const container = document.createElement("div");
                  container.setHTMLUnsafe(speculativeMarkup);
                })
              : true,
          shadowRootSetHTMLUnsafe:
            typeof ShadowRoot.prototype.setHTMLUnsafe === "function"
              ? blocked(() => {
                  const host = document.createElement("div");
                  host.attachShadow({ mode: "open" });
                  host.shadowRoot.setHTMLUnsafe(speculativeMarkup);
                })
              : true,
          documentParseHTMLUnsafe:
            typeof Document.parseHTMLUnsafe === "function"
              ? blocked(() => Document.parseHTMLUnsafe(speculativeMarkup))
              : true,
          execCommandInsertHTML:
            typeof document.execCommand === "function"
              ? blocked(() =>
                  document.execCommand("insertHTML", false, speculativeMarkup),
                )
              : true,
          trustedHTML: globalThis.trustedTypes
            ? blocked(() => {
                const policy = trustedTypes.createPolicy(
                  `w10p-speculative-negative-${Date.now()}`,
                  { createHTML: (value) => value },
                );
                const container = document.createElement("div");
                container.innerHTML = policy.createHTML(speculativeMarkup);
              })
            : true,
          anchorSetAttribute: blocked(() => {
            const anchor = document.createElement("a");
            anchor.setAttribute("ping", pingUrl);
          }),
          anchorPing: blocked(() => ping.click()),
          anchorDispatch: blocked(() =>
            ping.dispatchEvent(new MouseEvent("click", { bubbles: true })),
          ),
          parserFixtureCount: parserFixtureRoot.querySelectorAll(
            'link[rel~="preconnect"],link[rel~="prefetch"],script[type="speculationrules"],a[ping],iframe[srcdoc]',
          ).length,
        };
      },
      {
        preconnectUrl: preconnectWireUrl,
        allowedFirebasePreconnectUrl: allowedFirebasePreconnectWireUrl,
        prefetchUrl: prefetchWireUrl,
        speculationUrl: speculationWireUrl,
        pingUrl: pingWireUrl,
      },
    );
    assert.deepEqual(speculativeCapabilityBlocks, {
      allowedFirebasePreconnectConnectedNode: true,
      appendChild: true,
      prepend: true,
      replaceChildren: true,
      insertAdjacentElement: true,
      innerHTML: true,
      insertAdjacentHTML: true,
      setAttributeRel: true,
      setAttributeHref: true,
      setAttributeNsRel: true,
      setAttributeNode: true,
      setAttributeNodeNs: true,
      namedNodeMapSetNamedItem: true,
      namedNodeMapSetNamedItemNs: true,
      attrValue: true,
      attrNodeValue: true,
      attrTextContent: true,
      connectedAttrValue: true,
      detachedAttrOwnerFailClosed: true,
      iframeSrcdocAttribute: true,
      iframeSrcdocProperty: true,
      relProperty: true,
      hrefProperty: true,
      relList: true,
      domParser: true,
      contextualFragment: true,
      rangeInsertNode: true,
      elementMoveBefore: true,
      documentFragmentMoveBefore: true,
      elementSetHTMLUnsafe: true,
      shadowRootSetHTMLUnsafe: true,
      documentParseHTMLUnsafe: true,
      execCommandInsertHTML: true,
      trustedHTML: true,
      anchorSetAttribute: true,
      anchorPing: true,
      anchorDispatch: true,
      parserFixtureCount: 5,
    });
    await page.waitForTimeout(250);
    await page.evaluate((url) => {
      const frame = document.createElement("iframe");
      frame.src = url;
      document.body.append(frame);
    }, oopifWireUrl);
    await page.waitForTimeout(150);
    await page.evaluate((url) => {
      window.open(url, "_blank", "noopener");
    }, popupWireUrl);
    await page.waitForTimeout(150);
    await page.evaluate((url) => {
      const frame = document.createElement("iframe");
      frame.src = url;
      document.body.append(frame);
    }, crossOriginDocumentUrl);
    await page.waitForTimeout(150);
    const eventSourceRejectedBeforeWire = await page.evaluate(
      (url) =>
        new Promise((resolveEventSource) => {
          const source = new EventSource(url);
          const timeout = setTimeout(() => {
            source.close();
            resolveEventSource(false);
          }, 1000);
          source.addEventListener(
            "open",
            () => {
              clearTimeout(timeout);
              source.close();
              resolveEventSource(false);
            },
            { once: true },
          );
          source.addEventListener(
            "error",
            () => {
              clearTimeout(timeout);
              source.close();
              resolveEventSource(true);
            },
            { once: true },
          );
        }),
      eventSourceWireUrl,
    );
    assert.equal(eventSourceRejectedBeforeWire, true);
    const websocketClosedByRoute = await page.evaluate(
      async (urls) =>
        Promise.all(
          urls.map(
            (url) =>
              new Promise((resolveWebSocket) => {
                const socket = new WebSocket(url);
                socket.addEventListener("open", () => resolveWebSocket(false), {
                  once: true,
                });
                socket.addEventListener("close", () => resolveWebSocket(true), {
                  once: true,
                });
                socket.addEventListener("error", () => resolveWebSocket(true), {
                  once: true,
                });
              }),
          ),
        ),
      [websocketWireUrl, allowedFirebaseWebsocketWireUrl],
    );
    assert.deepEqual(websocketClosedByRoute, [true, true]);
    while (handlerPromises.size > 0) {
      await Promise.all([...handlerPromises]);
    }
    const allowedHostNegativeCapabilityProxySnapshot = loopbackProxy.snapshot();
    assert.equal(
      allowedHostNegativeCapabilityProxySnapshot.allowedConnectCount,
      directBrowserAllowedFirebaseTunnelCount,
    );
    assert.equal(
      allowedHostNegativeCapabilityProxySnapshot.upstreamSocketCreateCount,
      directBrowserAllowedFirebaseTunnelCount,
    );
    assert.deepEqual(directAllowedTlsWireRequests, [
      {
        method: "GET",
        url: `/probe?key=${encodeURIComponent(syntheticStagingApiKey)}`,
        host: "identitytoolkit.googleapis.com",
      },
      {
        method: "GET",
        url: `/post-final-abort?key=${encodeURIComponent(syntheticStagingApiKey)}`,
        host: "identitytoolkit.googleapis.com",
      },
    ]);
    assert.deepEqual(stableWireRequests, []);
    assert.deepEqual(preTransmissionBlockedWirePaths, []);
    assert.deepEqual(forbiddenHostnameWireRequests, []);
    assert.deepEqual(regionalRealtimeDatabaseWireRequests, []);
    assert.deepEqual(crossOriginDocumentWireRequests, []);
    assert.deepEqual(eventSourceWireRequests, []);
    assert.deepEqual(websocketWireRequests, []);
    assert.deepEqual(rawExternalWireConnections, []);
    assert.deepEqual(rawExternalWireBytes, []);
    assert.deepEqual(udpStunWireDatagrams, []);
    assert.equal(networkBackedEarlyHintsSentCount, 1);
    assert.equal(networkBackedInformationalEgressHeaderSentCount, 2);
    assert.equal(networkBackedFinalEgressHeaderSentCount, 9);
    assert.equal(networkBackedInformationalResponsePauseCount, 0);
    assert.ok(networkBackedFinalResponsePauseCount > 0);
    assert.equal(networkBackedInformationalEgressHeaderObservationCount, 0);
    assert.ok(networkBackedFinalEgressHeaderObservationCount > 0);
    assert.ok(networkBackedResponseHeaderSuppressionCount > 0);
    assert.equal(networkBackedEgressHeaderForwardCount, 0);
    assert.equal(networkBackedResponseBodyHashMatchCount, 1);
    assert.equal(directBrowserEarlyHintsObservationCount, 0);
    assert.equal(directBrowserEarlyHintsEgressHeaderObservationCount, 0);
    assert.equal(directBrowserEarlyHintsCaptureInvalidationCount, 0);
    assert.equal(nodeOwnedExternalInformationalResponseCount, 1);
    assert.ok(nodeOwnedExternalInformationalEgressHeaderObservationCount > 0);
    assert.equal(nodeOwnedExternalBrowserExposureCount, 0);
    assert.equal(nodeOwnedExternalFinalBodyHashMatchCount, 1);
    assert.equal(nodeExternalWireRequests.length, 1);
    assert.equal(nodeExternalWireRequests[0].method, "GET");
    assert.equal(nodeExternalWireRequests[0].headers.accept, "*/*");
    assert.equal(
      nodeExternalWireRequests[0].headers["accept-encoding"],
      "identity",
    );
    assert.equal(
      nodeExternalWireRequests[0].headers["cache-control"],
      "no-cache, no-store, max-age=0",
    );
    assert.equal(nodeExternalWireRequests[0].headers.pragma, "no-cache");
    for (const forbiddenHeaderName of [
      "authorization",
      "cookie",
      "origin",
      "referer",
      "x-firebase-appcheck",
      "x-goog-api-key",
      "x-vercel-protection-bypass",
    ]) {
      assert.equal(
        Object.hasOwn(nodeExternalWireRequests[0].headers, forbiddenHeaderName),
        false,
      );
    }
    assert.equal(sensitiveAllowedHostnameBlockedBeforeProxyTunnelCount, 2);
    assert.ok(directBrowserAllowedFirebaseTunnelCount > 0);
    assert.equal(proxyDenyFixtureRequestCount, 7);
    assert.equal(fullPostDataResolutionFailureCount, 0);
    assert.ok(fullPostDataNetworkFallbackCount > 0);
    assert.equal(postDataOmissionFixtureInjectionCount, 1);
    assert.equal(postDataOmissionFixtureRealNetworkIdCount, 1);
    assert.equal(fullPostDataRecoveredBodyExactMatchCount, 1);
    assert.equal(
      fullPostDataResolutionCount,
      preTransmissionBoundaryInspectionCount,
    );
    assert.equal(optionalTelemetrySuppressionCount, 1);
    assert.equal(deterministicHolidayFulfillCount, 1);
    assert.equal(deterministicRecaptchaFulfillCount, 1);
    assert.equal(firebaseModuleLocalFulfillCount, 4);
    assert.ok(deterministicScopeMismatchBlockCount >= 6);
    assert.ok(stagingApiKeyScopeViolationBlockCount >= 1);
    assert.ok(testCredentialScopeViolationBlockCount >= 1);
    assert.ok(refreshTokenScopeViolationBlockCount >= 1);
    assert.ok(debugMaterialScopeViolationBlockCount >= 2);
    assert.equal(
      rawSensitivePreTransmissionBlockCount,
      rawProductionPreTransmissionBlockCount +
        rawVercelBypassPreTransmissionBlockCount +
        rawStagingApiKeyPreTransmissionBlockCount +
        rawTestCredentialPreTransmissionBlockCount +
        rawRefreshTokenPreTransmissionBlockCount +
        rawDebugTokenPreTransmissionBlockCount +
        rawDebugSentinelPreTransmissionBlockCount,
    );
    assert.ok(rawSensitivePreTransmissionInspectionCount > 0);
    assert.ok(rawProductionPreTransmissionBlockCount >= 1);
    assert.ok(rawVercelBypassPreTransmissionBlockCount >= 1);
    assert.ok(rawStagingApiKeyPreTransmissionBlockCount >= 2);
    assert.ok(rawTestCredentialPreTransmissionBlockCount >= 2);
    assert.ok(rawRefreshTokenPreTransmissionBlockCount >= 2);
    assert.ok(rawDebugTokenPreTransmissionBlockCount >= 2);
    assert.ok(rawDebugSentinelPreTransmissionBlockCount >= 2);
    assert.equal(recaptchaRequestFailureCount, 0);
    assert.equal(firebaseModuleRequestFailureCount, 1);
    assert.equal(firebaseModuleHeadRequestFailureCount, 1);
    assert.equal(recaptchaIframeDocumentRequestCount, 0);
    assert.equal(websocketRouteInterceptCount, 2);
    assert.equal(websocketConnectToServerCount, 0);
    assert.equal(websocketHandshakeRequestCount, 0);
    assert.equal(webTransportCreatedCount, 0);
    assert.deepEqual(
      upstreamWireRequests.map(({ requestPath }) => requestPath).sort(),
      [
        "/document.html",
        "/redirect.css",
        "/rewrite.js",
        "/toolbar-parser.html",
        "/unsafe-parser.html",
      ].sort(),
    );
    assert.equal(
      upstreamWireRequests.every(
        ({ bypassHeader }) => bypassHeader === syntheticBypassSecret,
      ),
      true,
    );
    assert.equal(
      upstreamWireRequests.every(
        ({ skipToolbarHeader }) => skipToolbarHeader === "1",
      ),
      true,
    );
    assert.equal(
      upstreamWireRequests.filter(
        ({ requestPath }) => requestPath === "/document.html",
      ).length,
      1,
    );
    assert.equal(immutableEarlyHintsSentCount, 1);
    assert.equal(immutableFinalLinkHeaderSentCount, 1);
    assert.equal(
      upstreamWireRequests.filter(
        ({ requestPath }) => requestPath === "/rewrite.js",
      ).length,
      1,
    );
    assert.equal(
      upstreamWireRequests.some(
        ({ requestPath }) => requestPath === "/redirect-target.css",
      ),
      false,
    );
    assert.deepEqual(apiWireRequests, [
      {
        requestPath: "/probe",
        origin: stableOrigin,
        referer: `${stableOrigin}/`,
        appCheckHeader: syntheticJwt,
        bypassHeader: "",
      },
      {
        requestPath: "/post-final-abort",
        origin: stableOrigin,
        referer: `${stableOrigin}/`,
        appCheckHeader: syntheticJwt,
        bypassHeader: "",
      },
    ]);
    assert.equal(rewriteRequestCount, 5);
    assert.equal(rewriteResponseCount, 2);
    assert.equal(rewriteBodyHashMatchCount, 2);
    assert.equal(rewriteRedirectResponseAbortCount, 1);
    assert.equal(unsafeParserDocumentRejectCount, 1);
    assert.equal(toolbarParserDocumentRejectCount, 1);
    assert.equal(rewriteRedirectFollowAttemptCount, 0);
    assert.equal(rewriteObservations.size, 0);
    assert.deepEqual(unexpectedRequestUrls, []);
    assert.equal(unexpectedContinueRequestCount, 0);
    assert.ok(preTransmissionBoundaryInspectionCount >= 19);
    assert.ok(preTransmissionBoundaryBlockAttemptCount >= 15);
    assert.ok(preTransmissionBoundaryProductionBlockCount >= 6);
    assert.ok(preTransmissionBoundaryUnboundFirebaseBlockCount >= 6);
    assert.ok(preTransmissionBoundaryNonFirebaseHostnameBlockCount >= 2);
    assert.equal(
      preTransmissionBoundaryBlockAttemptCount,
      preTransmissionBoundaryProductionBlockCount +
        preTransmissionBoundaryCrossOriginDocumentBlockCount +
        preTransmissionBoundaryUnboundFirebaseBlockCount +
        preTransmissionBoundaryNonFirebaseHostnameBlockCount +
        preTransmissionBoundaryMalformedUrlBlockCount,
    );
    assert.equal(
      preTransmissionBoundaryFailRequestCount,
      preTransmissionBoundaryBlockAttemptCount,
    );
    assert.ok(dottedProductionBlockedMethods.includes("GET"));
    assert.ok(dottedProductionBlockedMethods.includes("POST"));
    assert.ok(dottedFirebaseBlockedPaths.includes("/dotted-auth-query-key"));
    assert.ok(
      dottedFirebaseBlockedPaths.includes("/dotted-refresh-header-key"),
    );
    assert.deepEqual(
      [...regionalRealtimeDatabaseBlockedPaths].sort(),
      regionalRealtimeDatabaseFixtures
        .map(({ requestPath }) => requestPath)
        .sort(),
    );
    assert.deepEqual(crossOriginDocumentBlockedPaths, [
      "/cross-origin-document-wire",
    ]);
    assert.deepEqual(eventSourceBlockedPaths, ["/event-source-wire"]);
    assert.equal(preTransmissionBoundaryCrossOriginDocumentBlockCount, 1);
    await cdp.send("Fetch.disable");
    await cdp.detach();
    await context.close();
    loopbackContext = null;
    await loopbackBoundaryController.deactivate("loopback");
    loopbackBoundarySnapshot = loopbackBoundaryController.snapshot();
    assert.equal(loopbackBoundarySnapshot.activationCount, 1);
    assert.equal(loopbackBoundarySnapshot.primaryTargetConfiguredCount, 1);
    assert.equal(
      loopbackBoundarySnapshot.primaryRequestBoundaryHandoffCount,
      1,
    );
    assert.ok(loopbackBoundarySnapshot.heldRuntimeResumeCount >= 1);
    assert.ok(
      loopbackBoundarySnapshot.secondaryTargetClosedBeforeResumeCount >= 1,
    );
    assert.equal(loopbackBoundarySnapshot.requestInspectionCount, 0);
    assert.equal(loopbackBoundarySnapshot.handlerErrorCount, 0);
    assert.equal(loopbackBoundarySnapshot.pendingSetupCount, 0);
    assert.equal(loopbackBoundarySnapshot.pendingHandlerCount, 0);
    assert.equal(loopbackBoundarySnapshot.heldRuntimeResumeResidualCount, 0);
    assert.equal(loopbackBoundarySnapshot.fatalErrorCount, 0);
    await loopbackBoundaryController.restore();
  } finally {
    for (const response of postFinalAbortOpenResponses) {
      response.destroy();
    }
    postFinalAbortOpenResponses.clear();
    if (loopbackContext) {
      try {
        await loopbackContext.close();
      } catch (_error) {
        // The browser may already be closing after a fail-closed assertion.
      }
    }
    if (loopbackBoundaryController) {
      await loopbackBoundaryController.forceRestore();
    }
    if (loopbackBrowser) {
      await loopbackBrowser.close();
      testOwnedBrowserCloseCount += 1;
    }
    if (loopbackProxyUrl) {
      await loopbackProxy.close();
      loopbackProxySnapshot = loopbackProxy.snapshot();
      testOwnedServerCloseCount += 1;
    }
    for (const server of [
      stableServer,
      upstreamServer,
      apiServer,
      directAllowedTlsServer,
    ]) {
      await new Promise((resolveClose) => server.close(resolveClose));
      testOwnedServerCloseCount += 1;
    }
    await new Promise((resolveClose) =>
      rawExternalWireServer.close(resolveClose),
    );
    testOwnedServerCloseCount += 1;
    await new Promise((resolveClose) => udpStunServer.close(resolveClose));
    testOwnedServerCloseCount += 1;
  }
  assert.equal(testOwnedBrowserCloseCount, 1);
  assert.equal(testOwnedServerCloseCount, 7);
  assert.equal(loopbackBrowser.isConnected(), false);
  assert.equal(
    [
      stableServer,
      upstreamServer,
      apiServer,
      directAllowedTlsServer,
      rawExternalWireServer,
    ].filter((server) => server.listening).length,
    0,
  );
  assert.throws(() => udpStunServer.address());
  assert.ok(loopbackProxySnapshot);
  assert.equal(loopbackProxySnapshot.listenerStartCount, 1);
  assert.equal(loopbackProxySnapshot.listenerCloseCount, 1);
  assert.equal(loopbackProxySnapshot.activeClientSocketCount, 0);
  assert.equal(loopbackProxySnapshot.activeUpstreamSocketCount, 0);
  assert.equal(loopbackProxySnapshot.requestStageAuthorizationCount, 2);
  assert.equal(loopbackProxySnapshot.requestStageAuthorizationCompleteCount, 2);
  assert.equal(
    loopbackProxySnapshot.requestStageAuthorizationRevocationCount,
    0,
  );
  assert.equal(loopbackProxySnapshot.authorityLeaseIssueCount, 2);
  assert.equal(
    loopbackProxySnapshot.authorityLeaseConsumeCount +
      loopbackProxySnapshot.authorityLeaseUnusedCompletionCount,
    2,
  );
  assert.equal(loopbackProxySnapshot.authorityLeaseRevocationCount, 0);
  assert.equal(
    loopbackProxySnapshot.authorityLeaseExpiredBeforeConnectCount,
    0,
  );
  assert.equal(loopbackProxySnapshot.requestStageAuthorizationResidualCount, 0);
  assert.equal(loopbackProxySnapshot.authorityLeaseResidualCount, 0);
  assert.equal(loopbackProxySnapshot.authorityLeaseQueueResidualCount, 0);
  assert.equal(loopbackProxySnapshot.activeAllowedTunnelResidualCount, 0);
  assert.ok(loopbackProxySnapshot.uncorrelatedAllowedConnectDenyCount >= 1);
  assert.equal(
    loopbackProxySnapshot.authorityLeaseIssueCount,
    loopbackProxySnapshot.authorityLeaseConsumeCount +
      loopbackProxySnapshot.authorityLeaseUnusedCompletionCount +
      loopbackProxySnapshot.authorityLeaseRevocationCount +
      loopbackProxySnapshot.authorityLeaseExpiredBeforeConnectCount,
  );
  const deniedProxyAuthorities =
    loopbackProxySnapshot.deniedConnectAuthorities.map(
      ({ authority }) => authority,
    );
  for (const authority of [
    `${productionImmutableHostname}:443`,
    "unknown-external.invalid:443",
    "127.0.0.1:443",
    "identitytoolkit.googleapis.com:444",
  ]) {
    assert.ok(deniedProxyAuthorities.includes(authority));
  }
  const allowedHostUnleasedConnectProxyDenyCount =
    loopbackProxySnapshot.deniedConnectAuthorities.find(
      ({ authority }) => authority === "securetoken.googleapis.com:443",
    )?.count || 0;
  const manualUnleasedAllowedHostProxyDenyCount =
    allowedHostUnleasedConnectProxyDenyCount -
    directEarlyHintsAllowedHostProxyDenyCountBeforeManualFixture;
  assert.ok(manualUnleasedAllowedHostProxyDenyCount > 0);
  const directEarlyHintsAllowedHostRawTlsRequestCount =
    directAllowedTlsWireRequests.filter(
      ({ host, url }) =>
        host === "identitytoolkit.googleapis.com" &&
        url === "/early-hints-preload-wire",
    ).length;
  assert.equal(directEarlyHintsAllowedHostAdditionalTunnelCount, 0);
  assert.equal(directEarlyHintsAllowedHostRawTlsRequestCount, 0);
  return {
    directCdpHeaderObservedByRequestAllHeaders: false,
    directCdpHeaderObservedOnWire: true,
    serviceWorkerPolicy: "block",
    playwrightRouteRegistrationCount: 0,
    childProcessSecretEnvScrubbed: true,
    browserChildEnvironmentAllowlisted: true,
    browserChildEnvironmentUnexpectedKeyCount: 0,
    browserChildSecretEnvironmentVariableCount: 0,
    preTransmissionProductionGetBlockedBeforeWireCount: 1,
    preTransmissionProductionPostBlockedBeforeWireCount: 1,
    preTransmissionProductionImmutableBlockedBeforeWireCount: 1,
    preTransmissionUnboundFirebaseBlockedBeforeWireCount: 1,
    preTransmissionUnknownVercelBlockedBeforeWireCount: 1,
    preTransmissionVercelApexBlockedBeforeWireCount: 1,
    preTransmissionVercelApexDottedBlockedBeforeWireCount: 1,
    preTransmissionProductionCustomDottedGetBlockedBeforeWireCount: 1,
    preTransmissionProductionCustomDottedPostBlockedBeforeWireCount: 1,
    preTransmissionDottedAuthProductionKeyBlockedBeforeWireCount: 1,
    preTransmissionDottedRefreshProductionHeaderBlockedBeforeWireCount: 1,
    preTransmissionProductionRegionalRealtimeDatabaseBlockedBeforeWireCount: 1,
    preTransmissionUnknownRegionalRealtimeDatabaseBlockedBeforeWireCount: 1,
    preTransmissionStagingLookingRegionalRealtimeDatabaseBlockedBeforeWireCount: 1,
    preTransmissionDottedAlternateRegionalRealtimeDatabaseBlockedBeforeWireCount: 1,
    productionImmutableWireRequestCount: 0,
    unknownVercelWireRequestCount: 0,
    productionCustomDottedWireRequestCount: 0,
    dottedFirebaseWireRequestCount: 0,
    regionalRealtimeDatabaseWireRequestCount: 0,
    crossOriginDocumentWireRequestCount: 0,
    eventSourceRejectedBeforeWire: true,
    eventSourceWireRequestCount: 0,
    optionalTelemetrySuppressedBeforeWireCount:
      optionalTelemetrySuppressionCount,
    rawSensitiveBeforeTelemetryRejectedCaseCount: 7,
    rawSensitiveBeforeTelemetryBlockCount: 7,
    rawSensitivePreTransmissionInspectionCount,
    rawSensitivePreTransmissionBlockCount,
    rawVercelBypassPreTransmissionBlockCount,
    rawStagingApiKeyPreTransmissionBlockCount,
    rawTestCredentialPreTransmissionBlockCount,
    rawRefreshTokenPreTransmissionBlockCount,
    rawDebugTokenPreTransmissionBlockCount,
    rawDebugSentinelPreTransmissionBlockCount,
    optionalTelemetryWireConnectionCount: 0,
    deterministicHolidayFulfillCount,
    deterministicHolidayWireRequestCount: 0,
    deterministicRecaptchaFulfillCount,
    deterministicRecaptchaWireConnectionCount: 0,
    deterministicRecaptchaIframeDocumentRequestCount:
      recaptchaIframeDocumentRequestCount,
    deterministicRecaptchaRequestFailureCount: recaptchaRequestFailureCount,
    firebaseModuleLocalFulfillCount,
    firebaseModuleDynamicImportSuccessCount,
    firebaseModuleWireConnectionCount: 0,
    externalStaticHeadRejectedBeforeWireCount: 1,
    externalStaticHeadRequestFailureCount:
      firebaseModuleHeadRequestFailureCount,
    firebaseModuleRequestFailureCount,
    externalUnknownWireConnectionCount: 0,
    externalSensitiveExfiltrationWireConnectionCount: 0,
    stagingApiKeyScopeViolationBlockCount,
    testCredentialScopeViolationBlockCount,
    refreshTokenScopeViolationBlockCount,
    debugMaterialScopeViolationBlockCount,
    rtcStunDatagramWireCount: udpStunWireDatagrams.length,
    speculativeTcpWireConnectionCount: rawExternalWireConnections.length,
    parserMarkupRawWireConnectionCount: rawExternalWireConnections.length,
    response103EarlyHintsSentCount: immutableEarlyHintsSentCount,
    responseFinalLinkHeaderSentCount: immutableFinalLinkHeaderSentCount,
    response103AndLinkBrowserWireConnectionCount:
      rawExternalWireConnections.length,
    networkBackedResponse103SourceCount: networkBackedEarlyHintsSentCount,
    networkBackedResponse103EgressHeaderSourceCount:
      networkBackedInformationalEgressHeaderSentCount,
    networkBackedResponseFinalEgressHeaderSourceCount:
      networkBackedFinalEgressHeaderSentCount,
    networkBackedResponse103PauseCount:
      networkBackedInformationalResponsePauseCount,
    directBrowserEarlyHintsObservationCount,
    directBrowserEarlyHintsEgressHeaderObservationCount,
    directBrowserEarlyHintsCaptureInvalidationCount,
    directBrowserEarlyHintsSemantics:
      "observed-after-receipt-capture-invalid-not-pre-transmission-block",
    directBrowserEarlyHintsEventExposureUnsupportedCount: 1,
    directEarlyHintsAllowedHostFetchRequestStageObservationCount,
    directEarlyHintsAllowedHostFetchRequestStageBlockCount,
    directEarlyHintsAllowedHostDisposition:
      directEarlyHintsAllowedHostFetchRequestStageObservationCount > 0
        ? "fetch-request-stage-rejected-before-connect"
        : directEarlyHintsAllowedHostProxyDenyCountBeforeManualFixture > 0
          ? "proxy-denied-before-upstream"
          : "effective-browser-features-suppressed-preload",
    directEarlyHintsAllowedHostProxyDenyCountBeforeManualFixture,
    directEarlyHintsAllowedHostAdditionalTunnelCount,
    directEarlyHintsAllowedHostRawTlsRequestCount,
    manualUnleasedAllowedHostProxyDenyCount,
    nodeOwnedExternalInformationalResponseCount,
    nodeOwnedExternalInformationalEgressHeaderObservationCount,
    nodeOwnedExternalBrowserExposureCount,
    nodeOwnedExternalFinalBodyHashMatchCount,
    networkBackedResponseFinalPauseCount: networkBackedFinalResponsePauseCount,
    networkBackedResponse103EgressHeaderObservationCount:
      networkBackedInformationalEgressHeaderObservationCount,
    networkBackedResponseFinalEgressHeaderObservationCount:
      networkBackedFinalEgressHeaderObservationCount,
    networkBackedResponseHeaderSuppressionCount,
    networkBackedResponseEgressHeaderForwardCount:
      networkBackedEgressHeaderForwardCount,
    networkBackedResponseBodyHashMatchCount,
    networkBackedResponseCorrelationResidualCount: rewriteObservations.size,
    networkBackedResponseEgressRawWireConnectionCount:
      rawExternalWireConnections.length,
    postFinalAbortFinalResponsePauseCount,
    postFinalAbortResponseErrorPauseCount,
    postFinalAbortNoOverrideContinueResponseSuccessCount,
    postFinalAbortProxyCompleteCount,
    postFinalAbortProxyRevokeCount,
    postFinalAbortHeadersObserved,
    postFinalAbortBodyRejected,
    postFinalAbortWatchdogFired,
    postFinalAbortErrorPauseEnqueuedCount,
    postFinalAbortErrorPauseEnqueuedBeforeFinalReleaseCount,
    postFinalAbortRequestFailureCount,
    postFinalAbortRequestFailureText:
      postFinalAbortRequestFailureTexts[0] || null,
    postFinalAbortProductionRequestFailureDisposition: "fatal-non-telemetry",
    postFinalAbortSameFetchCorrelationCount,
    postFinalAbortAliasCorrelationCount,
    postFinalAbortHandlerQueueResidualCount:
      loopbackHandlerTaskCoordinator.pendingCount(),
    postFinalAbortLifecycleResidualCount:
      postFinalAbortLifecycleByFetchRequestId.size,
    postFinalAbortNetworkAliasResidualCount:
      postFinalAbortFetchRequestIdsByNetworkId.size,
    fullPostDataResolutionCount,
    fullPostDataNetworkFallbackCount,
    fullPostDataResolutionFailureCount,
    postDataOmissionFixtureInjectionCount,
    postDataOmissionFixtureRealNetworkIdCount,
    fullPostDataRecoveredBodyExactMatchCount,
    fullPostDataRecoveredBodyBytes,
    fullPostDataRecoveredBodySha256,
    fullPostDataLargeSensitiveRejectedBeforeWireCount: 1,
    fullPostDataLargeSensitiveRawWireConnectionCount:
      rawExternalWireConnections.length,
    sensitiveAllowedHostnameBlockedBeforeProxyTunnelCount,
    directBrowserAllowedFirebaseTunnelCount,
    proxyDenyFixtureRequestCount,
    browserConnectProxy: loopbackProxySnapshot,
    unsafeParserDocumentRejectedBeforeBrowserCount:
      unsafeParserDocumentRejectCount,
    toolbarParserDocumentRejectedBeforeBrowserCount:
      toolbarParserDocumentRejectCount,
    immutableUpstreamSkipToolbarHeaderWireObservationCount:
      upstreamWireRequests.filter(
        ({ skipToolbarHeader }) => skipToolbarHeader === "1",
      ).length,
    browserSkipToolbarHeaderRejectedBeforeWireCount:
      loopbackBrowserSkipToolbarHeaderPreTransmissionBlockCount,
    sendBeaconWireConnectionCount: 0,
    anchorPingWireConnectionCount: 0,
    prefetchSpeculationWireConnectionCount: 0,
    workletWireConnectionCount: 0,
    networkDedicatedWorkerWireRequestCount: 0,
    networkSharedWorkerWireRequestCount: 0,
    networkServiceWorkerWireRequestCount: 0,
    oopifWireRequestCount: 0,
    popupInitialNavigationWireRequestCount: 0,
    blobWorkerBlockedBeforeExecution: true,
    allowedFirebaseWorkerFetchBlockedBeforeExecution: true,
    webSocketStreamBlockedBeforeExecution: true,
    allowedFirebaseWebSocketStreamBlockedBeforeExecution: true,
    allowedFirebaseParserPreconnectBlockedBeforeConnection: true,
    allowedFirebaseWebSocketRouteBlockedBeforeConnection: true,
    allowedFirebaseNegativeRawTlsRequestCount:
      directAllowedTlsWireRequests.length - 2,
    webSocketStreamHandshakeWireRequestCount: 0,
    websocketRouteInterceptCount,
    websocketConnectToServerCount,
    websocketHandshakeWireRequestCount: websocketWireRequests.length,
    webTransportCreatedCount,
    browserWideBoundaryPrimaryTargetConfiguredCount:
      loopbackBoundarySnapshot.primaryTargetConfiguredCount,
    browserWideBoundarySecondaryTargetClosedBeforeResumeCount:
      loopbackBoundarySnapshot.secondaryTargetClosedBeforeResumeCount,
    browserWideBoundaryHandlerErrorCount:
      loopbackBoundarySnapshot.handlerErrorCount,
    browserWideBoundaryPrivateRequestInspectionCount:
      loopbackBoundarySnapshot.requestInspectionCount,
    browserWideBoundaryResidualCount:
      loopbackBoundarySnapshot.pendingSetupCount +
      loopbackBoundarySnapshot.pendingHandlerCount +
      loopbackBoundarySnapshot.heldRuntimeResumeResidualCount,
    browserCommandLineAttestation: loopbackBrowserCommandLineAttestation,
    preTransmissionBlockedWireRequestCount: 0,
    preTransmissionCrossOriginDocumentBlockedBeforeWireCount: 1,
    productionHandlerHostnameClassifierPathVerified: true,
    stableOriginRequestStageHandledCount: rewriteRequestCount,
    stableOriginLocalFulfillRequestCount: rewriteResponseCount,
    stableTopLevelDocumentWireRequestCount: 0,
    stableStaticWireRequestCount: 0,
    immutableDocumentWireRequestCount: 1,
    immutableScriptWireRequestCount: 1,
    immutableRedirectWireRequestCount: 1,
    immutableRedirectFollowWireRequestCount: 0,
    immutableRedirectResponseAbortCount: rewriteRedirectResponseAbortCount,
    redirectPolicySharedRuntimePathVerified: true,
    stableLocationOriginPreserved: true,
    stableNavigationOriginPreserved: true,
    stableResourcePerformanceOriginPreserved: true,
    crossOriginApiOriginHeaderStable: true,
    crossOriginApiRefererOriginStable: true,
    bypassExactScopeVerified: true,
    bypassOutOfScopeWireRequestCount: 0,
    immutableUpstreamWireRequestCount: upstreamWireRequests.length,
    stableOriginWireRequestCount: stableWireRequests.length,
    immutableResponseBodyHashMatchCount: rewriteBodyHashMatchCount,
    testOwnedBrowserCloseCount,
    testOwnedProcessResidualCount: 0,
    testOwnedServerCloseCount,
    testOwnedListenerResidualCount: 0,
    externalNetworkAccess: 0,
  };
};
if (args.includes("--self-test-app-check-cdp")) {
  console.log(
    JSON.stringify({
      suite: "w10p-app-check-direct-cdp-loopback",
      passed: true,
      ...(await verifyDirectCdpAllHeadersLoopback()),
    }),
  );
  process.exit(0);
}
if (args.includes("--self-test-app-check")) {
  console.log(
    JSON.stringify({
      suite: "w10p-app-check-capture-secret-self-test",
      passed: true,
      ...appCheckSecretNegativeSelfTest,
      ...preTransmissionBoundaryNegativeSelfTest,
      ...fixtureAuditFreshnessNegativeSelfTest,
      ...stableOriginRewriteNegativeSelfTest,
      ...networkPolicyNegativeSelfTest,
      ...allowedEgressResponseLifecycleSelfTest,
      ...postDataAndResponseSanitizationNegativeSelfTest,
      productionAccess: 0,
      networkAccess: 0,
    }),
  );
  process.exit(0);
}
const valueArg = (name) =>
  args.find((item) => item.startsWith(`${name}=`))?.slice(name.length + 1) ||
  "";
const requiredArg = (name) => {
  const value = valueArg(name).trim();
  assert.ok(value, `${name}=... is required.`);
  return value;
};

const outputRoot = resolve(requiredArg("--output"));
const sourceCommitSha = requiredArg("--source-commit");
const baselineDeploymentId = requiredArg("--baseline-deployment-id");
const baselineDeploymentUrl = requiredArg("--baseline-url");
const candidateDeploymentId = requiredArg("--candidate-deployment-id");
const candidateDeploymentUrl = requiredArg("--candidate-url");
const STAGING_VERCEL_HOST_PATTERN =
  /^westory-staging-[a-z0-9-]+-bbbs-projects-44f9da30\.vercel\.app$/u;
const exactVercelOrigin = (value) => {
  const parsed = new URL(value);
  assert.equal(parsed.protocol, "https:");
  assert.equal(parsed.username, "");
  assert.equal(parsed.password, "");
  assert.ok(!parsed.port || parsed.port === "443");
  assert.match(parsed.hostname.toLowerCase(), STAGING_VERCEL_HOST_PATTERN);
  return parsed.origin;
};
const exactDeploymentRoot = (value) => {
  const parsed = new URL(value);
  const origin = exactVercelOrigin(parsed);
  assert.equal(parsed.pathname, "/");
  assert.equal(parsed.search, "");
  assert.equal(parsed.hash, "");
  return origin;
};
const stableBrowserOrigin = exactDeploymentRoot(contract.stableAlias);
const upstreamOrigins = {
  baseline: exactDeploymentRoot(baselineDeploymentUrl),
  candidate: exactDeploymentRoot(candidateDeploymentUrl),
};
assert.deepEqual(contract.networkBoundary, {
  forbiddenFirebaseProjectIds: ["history-quiz-yongsin"],
  forbiddenWebHosts: [
    "westory.kr",
    "www.westory.kr",
    "westory-70z9g2tvv-bbbs-projects-44f9da30.vercel.app",
  ],
  requiredMeasuredFirebaseProjectIds: [contract.firebaseProjectId],
  hostnameCanonicalization: {
    schemaVersion: 1,
    rawHostnameSource: "whatwg-url-hostname-lowercase",
    dnsComparison: "strip-all-terminal-dots-except-bracketed-ipv6",
    vercelAllowlistComparison: "raw-exact-terminal-dot-rejected",
    malformedPercentEncodingAction: "block-before-transmission",
  },
  firebaseRequestBinding: {
    schemaVersion: 3,
    transport: "https-default-443-no-userinfo",
    queryApiKeyName: "key",
    headerApiKeyName: "x-goog-api-key",
    auth: "exact-single-staging-api-key",
    appCheck: "exact-single-staging-api-key-plus-project-identity-and-app-id",
    firestore: "all-database-resource-project-slots-exact-staging",
    storage: "exact-staging-bucket-resource-slot",
    functions: "exact-asia-northeast3-staging-project-host",
    realtimeDatabase: "exact-staging-project-firebaseio-host",
    regionalRealtimeDatabase:
      "all-firebasedatabase-app-hosts-classified-firebase-and-unbound-without-configured-database-url",
    hosting: "exact-staging-project-host",
    firestoreWebChannel: {
      schemaVersion: 1,
      protocol: "https:",
      hostname: "firestore.googleapis.com",
      method: "POST",
      pathnames: [
        "/google.firestore.v1.Firestore/Listen/channel",
        "/google.firestore.v1.Firestore/Write/channel",
      ],
      databaseQueryName: "database",
      databaseQueryValue: `projects/${contract.firebaseProjectId}/databases/(default)`,
      exactInitialQueryNames: [
        "CVER",
        "RID",
        "VER",
        "X-HTTP-Session-Id",
        "database",
        "t",
        "zx",
      ],
      versionQueryValue: "8",
      clientVersionQueryValue: "22",
      sessionHeaderQueryName: "X-HTTP-Session-Id",
      sessionHeaderQueryValue: "gsessionid",
      encodedHeaderBodyField: "headers",
      encodedApiKeyHeaderName: "x-goog-api-key",
      encodedApiKeyOccurrencePolicy:
        "exact-single-body-header-line-and-zero-url-or-wire-header-occurrences",
      contentTypePolicy:
        "application-x-www-form-urlencoded-with-optional-utf-8-charset",
      scopeMismatchAction: "block-before-transmission",
    },
  },
  executionTargetBoundary: {
    schemaVersion: 6,
    mechanism: "playwright-1.62.1-private-crsession-runtime-resume-gate",
    primaryRequestOwnerHandoff:
      "private-fetch-before-page-init-to-public-cdp-fetch-before-navigation",
    secondaryTargetPolicy: "close-before-runtime-resume",
    coveredTargetTypes: [
      "iframe",
      "page",
      "service_worker",
      "shared_worker",
      "worker",
    ],
    creatorCapabilityPolicy:
      "locked-instance-and-prototype-init-script-block-worker-shared-worker-service-worker-send-beacon",
    crossOriginDocumentPolicy:
      "stable-browser-origin-only-in-private-and-public-fetch-owners",
    webSocketPolicy: "playwright-websocket-route-without-connect-to-server",
    webSocketStreamPolicy: "init-script-constructor-block-before-use",
    webTransportPolicy: "init-script-constructor-block-before-use",
    eventSourcePolicy: "public-cdp-fetch-pre-transmission-boundary",
    peerConnectionPolicy:
      "init-script-block-rtc-peer-connection-and-webkit-alias",
    workletPolicy: "init-script-block-all-observable-add-module-entrypoints",
    beaconPolicy:
      "locked-navigator-instance-and-navigator-prototype-send-beacon-before-use",
    speculativeTransportPolicy:
      "exact-merged-effective-chromium-argv-plus-forced-connect-proxy-plus-parser-safe-node-local-fulfill-plus-locked-dom-attr-srcdoc-range-move-before-exec-command-and-trusted-markup-guards",
    chromiumCommandLinePolicy:
      "browser-get-browser-command-line-exact-single-disable-features-union-single-proxy-server-no-loopback-bypass-disable-quic",
    informationalResponsePolicy:
      "node-owned-external-one-xx-nonterminal-browser-unexposed-direct-browser-early-hints-observed-after-receipt-capture-invalid-fatal",
    requestBodyResolutionPolicy:
      "fetch-inline-exact-else-network-get-request-post-data-fail-closed-on-missing-id-read-failure-oversize-or-representation-mismatch",
    requestBodyMaximumBytes: MAX_RESOLVED_REQUEST_POST_DATA_BYTES,
    handlerErrorAction: "capture-fatal",
    residualTargetAction: "capture-fatal",
  },
  networkResponseBoundary: {
    schemaVersion: 3,
    scope:
      "split-direct-browser-final-direct-browser-early-hints-and-node-owned-external",
    directBrowserFinalInterception: "fetch-intercept-response-final-sanitized",
    directBrowserInformationalObservation:
      "network-response-received-early-hints-observed-after-receipt-capture-invalid-fatal",
    directBrowserInformationalFixturePolicy:
      "server-one-zero-three-sent-positive-cdp-event-may-be-zero-event-observation-invalidates-capture",
    directBrowserInformationalTransmissionBoundary:
      "allowed-host-link-target-fetch-rejected-if-exposed-else-feature-suppressed-or-proxy-denied-tunnel-and-raw-zero",
    nodeOwnedExternalInformationalPolicy:
      "node-http-information-nonterminal-browser-unexposed",
    informationalCorrelation:
      "node-owned-nonterminal-retain-until-final-direct-observation-invalidates-capture",
    externalStaticFinalPolicy:
      "node-owned-exact-200-body-hash-cache-safe-header-synthetic-local-fulfill",
    headerPolicy:
      "explicit-base-allowlist-plus-exact-request-bound-conditional-rules-all-other-headers-omitted",
    allowedHeaderNames: [...BROWSER_RESPONSE_HEADER_ALLOWLIST],
    requestBoundConditionalHeaderRules: [
      {
        id: FIRESTORE_WEBCHANNEL_SESSION_RESPONSE_RULE_ID,
        headerName: FIRESTORE_WEBCHANNEL_SESSION_RESPONSE_HEADER_NAME,
        responseStage: "successful-final-only",
        requestScope: "exact-firestore-webchannel-encoded-init",
        scopeMismatchAction: "omit",
        informationalResponseAction: "omit",
        duplicateHeaderAction: "capture-fatal",
        valuePolicy: "nonempty-visible-ascii-maximum-1024-bytes",
      },
    ],
    egressCapableHeaderNames: [...BROWSER_EGRESS_CAPABLE_RESPONSE_HEADER_NAMES],
    egressCapableHeaderForwardAction:
      "omit-before-browser-for-final-and-node-owned-never-expose-informational",
    invalidHeaderAction: "fail-request-and-capture-fatal",
  },
  browserConnectProxy: {
    schemaVersion: 2,
    mechanism: "forced-loopback-http-connect-proxy-gate",
    proxyServerArgument: "single-http-loopback-ephemeral-port",
    proxyBypassListArgument: "<-loopback>",
    allowedHostnames: BROWSER_CONNECT_PROXY_ALLOWED_FIREBASE_HOSTNAMES,
    browserProductBackgroundDenyHostnames:
      BROWSER_PRODUCT_BACKGROUND_DENY_HOSTNAMES,
    allowedMethod: "CONNECT",
    allowedPort: 443,
    authorizedRequestMethods: BROWSER_CONNECT_PROXY_AUTHORIZED_REQUEST_METHODS,
    allowedTunnelAuthorization:
      "cdp-fetch-request-stage-short-lived-single-use-exact-authority-lease",
    requestAuthorizationBinding:
      "request-id-stage-method-stable-browser-origin-exact-hostname-default-443",
    authorityLeaseTtlMilliseconds: 5_000,
    pooledExistingTunnelPolicy:
      "every-request-remains-cdp-inspected-issued-lease-may-complete-unused-when-no-new-connect",
    requestConnectionCardinality:
      "not-one-to-one-http-connection-pooling-explicitly-reconciled",
    uncorrelatedAllowedConnectAction:
      "deny-before-upstream-socket-capture-fatal",
    expiredOrReplayLeaseAction: "deny-before-upstream-socket-capture-fatal",
    browserProductBackgroundDenyScope:
      "connect-only-exact-authority-443-browser-launch-stage-proxy-only-browser-process-source-no-credentials-or-body",
    browserProductBackgroundDenyAction:
      "deny-before-upstream-socket-hashed-audit-nonfatal",
    otherDenyAction: "deny-before-upstream-socket-capture-fatal",
    ipLiteralAction: "deny-before-upstream-socket-capture-fatal",
    alternatePortAction: "deny-before-upstream-socket-capture-fatal",
    unallowlistedHostnameAction: "deny-before-upstream-socket-capture-fatal",
    httpAbsoluteFormAction: "deny-before-upstream-socket-capture-fatal",
    upgradeAction: "deny-before-upstream-socket-capture-fatal",
    allowedTunnelScope:
      "host-contact-only-fetch-request-stage-sensitive-and-project-scope-remain-authoritative",
    sensitiveOrderingEvidence:
      "wrong-api-key-or-credential-scope-exact-allowed-host-fetch-failed-before-connect",
    allowedHostnameNegativeEvidence:
      "early-hints-link-parser-preconnect-websocket-websocket-stream-and-worker-invalid-request-create-no-upstream-request-without-lease",
    leaseLifecycleReconciliation:
      "issued-equals-consumed-plus-completed-unused-plus-revoked-plus-expired-and-live-residual-zero",
    cleanupPolicy:
      "destroy-client-and-upstream-sockets-close-listener-revoke-unused-leases-residual-zero",
  },
  nonFirebaseHostnameAllowlist: {
    schemaVersion: 3,
    scope: "exact-vercel-or-declared-external-static-request",
    match: "exact-raw-url-lowercase-hostname-no-terminal-dot",
    allowedHostnameSources: [
      "stable-alias",
      "baseline-immutable-deployment",
      "candidate-immutable-deployment",
    ],
    unallowlistedAction: "block-before-transmission",
    nonVercelHostnameAction:
      "block-unless-exact-external-static-rule-or-deterministic-response",
    vercelWildcardAllowed: false,
  },
  externalStaticRequestAllowlist: {
    schemaVersion: 3,
    transport: "https-default-443-no-userinfo",
    methods: ["GET"],
    requestBodyPolicy: "absent",
    nodeOwnedRequestHeaders: NODE_OWNED_EXTERNAL_STATIC_REQUEST_HEADERS,
    nodeOwnedRequestHeaderPolicy:
      "fixed-no-origin-referer-cookie-auth-bypass-app-check-or-api-key",
    nodeOwnedCacheKey: "exact-canonical-url-plus-fixed-request-contract-hash",
    nodeOwnedRedirectPolicy: "manual-no-follow-exact-200",
    nodeOwnedInformationalPolicy:
      "all-one-xx-observed-nonterminal-and-browser-unexposed-101-rejected",
    nodeOwnedContentEncodingPolicy: "absent-or-identity",
    nodeOwnedDuplicateResponseHeaderAction: "fail-closed",
    nodeOwnedResponseHeaderMaximumBytes:
      NODE_OWNED_EXTERNAL_STATIC_RESPONSE_HEADER_MAXIMUM_BYTES,
    nodeOwnedResponseBodyMaximumBytes:
      NODE_OWNED_EXTERNAL_STATIC_RESPONSE_BODY_MAXIMUM_BYTES,
    nodeOwnedTimeoutMilliseconds:
      NODE_OWNED_EXTERNAL_STATIC_TIMEOUT_MILLISECONDS,
    nodeOwnedResponseHeaderAllowlist: [
      ...NODE_OWNED_EXTERNAL_STATIC_RESPONSE_HEADER_ALLOWLIST,
    ],
    nodeOwnedContentLengthPolicy:
      "discard-source-and-recalculate-from-captured-final-bytes",
    forbiddenRequestHeaderNames: [
      "authorization",
      "content-type",
      "cookie",
      "range",
      "x-firebase-appcheck",
      "x-goog-api-key",
      "x-vercel-protection-bypass",
    ],
    rules: [
      {
        id: "firebase-esm-12.9.0",
        hostname: "www.gstatic.com",
        resourceTypes: ["Script"],
        exactPathnames: [
          "/firebasejs/12.9.0/firebase-app-check.js",
          "/firebasejs/12.9.0/firebase-app.js",
          "/firebasejs/12.9.0/firebase-auth.js",
          "/firebasejs/12.9.0/firebase-firestore.js",
        ],
        queryPolicy: "none",
        action: "local-node-module-fulfill",
        responseHeaders: {
          "access-control-allow-origin": "*",
          "cache-control": "no-store",
          "content-type": "text/javascript; charset=utf-8",
          "cross-origin-resource-policy": "cross-origin",
        },
        localModules: {
          "/firebasejs/12.9.0/firebase-app-check.js": {
            path: "node_modules/firebase/firebase-app-check.js",
            bytes: 24975,
            sha256:
              "c44ef6c21d1eac0f5df0dda56fe1bc0cdf49458c76a837638efa2cb48aebc99e",
          },
          "/firebasejs/12.9.0/firebase-app.js": {
            path: "node_modules/firebase/firebase-app.js",
            bytes: 103065,
            sha256:
              "9d1506ac46c736e133afa49ceba8dff794c13898388cd91bbd1b8d2463f18315",
          },
          "/firebasejs/12.9.0/firebase-auth.js": {
            path: "node_modules/firebase/firebase-auth.js",
            bytes: 158797,
            sha256:
              "a44e3c26c183eab2ab6795af3c0f2ec6dad9adfe0057340e14df5324a4417356",
          },
          "/firebasejs/12.9.0/firebase-firestore.js": {
            path: "node_modules/firebase/firebase-firestore.js",
            bytes: 455145,
            sha256:
              "d300a686d0f9298189e7462737072cf69c564ccb15f7f01a061d19a741b6c909",
          },
        },
      },
      {
        id: "tailwind-play-3.4.17",
        hostname: "cdn.tailwindcss.com",
        resourceTypes: ["Script"],
        exactPathnames: ["/"],
        queryPolicy: "none",
        action: "startup-pinned-source-fetch-then-local-fulfill",
        pinnedSources: {
          "/": {
            url: "https://cdn.tailwindcss.com/3.4.17",
            contentType: "text/javascript; charset=utf-8",
            bytes: 407279,
            sha256:
              "176e894661aa9cdc9a5cba6c720044cbbf7b8bd80d1c9a142a7c24b1b6c50d15",
          },
        },
      },
      {
        id: "noto-sans-kr-css",
        hostname: "fonts.googleapis.com",
        resourceTypes: ["Stylesheet"],
        exactPathAndSearch:
          "/css2?family=Noto+Sans+KR:wght@400;500;700;800;900&display=swap",
        action: "baseline-fetch-hash-cache-then-local-fulfill",
      },
      {
        id: "noto-sans-kr-font",
        hostname: "fonts.gstatic.com",
        resourceTypes: ["Font"],
        pathnamePrefix: "/s/notosanskr/",
        allowedExtensions: [".ttf", ".woff", ".woff2"],
        queryPolicy: "none",
        action: "baseline-fetch-hash-cache-then-local-fulfill",
      },
      {
        id: "google-login-logo",
        hostname: "fonts.gstatic.com",
        resourceTypes: ["Image"],
        exactPathnames: ["/s/i/productlogos/googleg/v6/24px.svg"],
        queryPolicy: "none",
        action: "baseline-fetch-hash-cache-then-local-fulfill",
      },
      {
        id: "font-awesome-6.4.0-css",
        hostname: "cdnjs.cloudflare.com",
        resourceTypes: ["Stylesheet"],
        exactPathnames: ["/ajax/libs/font-awesome/6.4.0/css/all.min.css"],
        queryPolicy: "none",
        action: "startup-pinned-source-fetch-then-local-fulfill",
        pinnedSources: {
          "/ajax/libs/font-awesome/6.4.0/css/all.min.css": {
            url: "https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css",
            contentType: "text/css; charset=utf-8",
            bytes: 102025,
            sha256:
              "1edb1725a9ea8ca4dcf2f5508cee183218aa1685e47c1b23056717f754f58ebf",
          },
        },
      },
      {
        id: "font-awesome-6.4.0-font",
        hostname: "cdnjs.cloudflare.com",
        resourceTypes: ["Font"],
        exactPathnames: [
          "/ajax/libs/font-awesome/6.4.0/webfonts/fa-brands-400.ttf",
          "/ajax/libs/font-awesome/6.4.0/webfonts/fa-brands-400.woff2",
          "/ajax/libs/font-awesome/6.4.0/webfonts/fa-regular-400.ttf",
          "/ajax/libs/font-awesome/6.4.0/webfonts/fa-regular-400.woff2",
          "/ajax/libs/font-awesome/6.4.0/webfonts/fa-solid-900.ttf",
          "/ajax/libs/font-awesome/6.4.0/webfonts/fa-solid-900.woff2",
          "/ajax/libs/font-awesome/6.4.0/webfonts/fa-v4compatibility.ttf",
          "/ajax/libs/font-awesome/6.4.0/webfonts/fa-v4compatibility.woff2",
        ],
        queryPolicy: "none",
        action: "baseline-fetch-hash-cache-then-local-fulfill",
      },
      {
        id: "quill-1.3.6",
        hostname: "cdn.quilljs.com",
        resourceTypes: ["Script", "Stylesheet"],
        exactPathnames: ["/1.3.6/quill.js", "/1.3.6/quill.snow.css"],
        queryPolicy: "none",
        action: "startup-pinned-source-fetch-then-local-fulfill",
        pinnedSources: {
          "/1.3.6/quill.js": {
            url: "https://cdn.jsdelivr.net/npm/quill@1.3.6/dist/quill.js",
            contentType: "text/javascript; charset=utf-8",
            bytes: 437299,
            sha256:
              "a4da70cd71b5a0e224e95865829a8356a93907c7d47ebb6b23cb8014c6ff9c48",
          },
          "/1.3.6/quill.snow.css": {
            url: "https://cdn.jsdelivr.net/npm/quill@1.3.6/dist/quill.snow.css",
            contentType: "text/css; charset=utf-8",
            bytes: 24743,
            sha256:
              "892e299431955e9ae388ae257f72024ee76af2d52a7a97a868f70fbe50f16144",
          },
        },
      },
      {
        id: "pdfjs-3.11.174",
        hostname: "cdnjs.cloudflare.com",
        resourceTypes: ["Script"],
        exactPathnames: [
          "/ajax/libs/pdf.js/3.11.174/pdf.min.js",
          "/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js",
        ],
        queryPolicy: "none",
        action: "startup-pinned-source-fetch-then-local-fulfill",
        pinnedSources: {
          "/ajax/libs/pdf.js/3.11.174/pdf.min.js": {
            url: "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js",
            contentType: "text/javascript; charset=utf-8",
            bytes: 320004,
            sha256:
              "5b5799e6f8c680663207ac5b42ee14eed2a406fa7af48f50c154f0c0b1566946",
          },
          "/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js": {
            url: "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js",
            contentType: "text/javascript; charset=utf-8",
            bytes: 1087212,
            sha256:
              "feabdf309770ed24bba31a5467836cdc8cf639c705af27d52b585b041bb8527b",
          },
        },
      },
    ],
    unmatchedAction: "block-before-transmission",
    networkResponsePolicy:
      "request-stage-node-owned-exact-get-no-redirect-no-error-hash-cache-safe-header-synthetic-final-fulfill-browser-wire-zero",
  },
  optionalTelemetrySuppression: {
    schemaVersion: 1,
    transport: "https-default-443-no-userinfo",
    methods: ["GET", "POST", "OPTIONS"],
    hostnames: [
      "analytics.google.com",
      "firebase.googleapis.com",
      "firebaseinstallations.googleapis.com",
      "google-analytics.com",
      "region1.google-analytics.com",
      "www.google-analytics.com",
      "www.googletagmanager.com",
    ],
    action: "fail-request-before-transmission-nonfatal",
  },
  sensitiveValueScope: {
    schemaVersion: 3,
    stagingApiKey:
      "exact-firebase-query-key-or-x-goog-api-key-slot-or-exact-firestore-webchannel-encoded-init-header-only",
    testEmailPassword:
      "exact-identitytoolkit-sign-in-with-password-json-body-only",
    refreshToken: "exact-securetoken-token-post-body-only",
    debugToken: "node-only-never-browser-egress",
    debugSentinel:
      "exact-app-check-debug-exchange-json-body-replaced-before-transmission",
    evidence: "count-and-sha256-only-no-raw-values",
    scopeMismatchAction: "block-before-transmission",
    requestBodyResolution:
      "single-resolved-body-before-sensitive-telemetry-deterministic-or-external-decisions",
  },
});
assert.equal(contract.browserTransport?.browserOrigin, stableBrowserOrigin);
assert.deepEqual(contract.browserTransport, {
  schemaVersion: 6,
  mechanism:
    "cdp-fetch-request-stage-local-fulfill-from-node-attested-immutable-bytes",
  browserOrigin: stableBrowserOrigin,
  upstreamSource: "stage-immutable-deployment-url",
  immutableFetchOwner: "node-only-exact-origin-no-redirect",
  immutableRequestHeaderPolicy:
    "node-owned-cache-control-no-cache-x-vercel-skip-toolbar-1-and-optional-exact-origin-protection-bypass",
  injectedToolbarMarkupPolicy:
    "reject-any-url-resolving-to-fixed-vercel-preview-toolbar-script-path-and-data-marker-before-browser-fulfill",
  browserWirePolicy: "zero-browser-network-to-immutable-upstream",
  responseHeaderPolicy:
    "synthetic-no-store-content-type-and-x-dns-prefetch-control-link-omitted",
  informationalResponsePolicy: "immutable-one-xx-never-exposed-to-browser",
  parserMarkupPolicy:
    "node-scan-fail-closed-before-browser-fulfill-on-speculative-link-except-exact-parser-same-origin-root-assets-js-modulepreload-without-base-query-or-fragment-speculationrules-anchor-ping-or-iframe-srcdoc",
  domMutationPolicy:
    "locked-common-attribute-validator-plus-srcdoc-set-html-unsafe-parse-html-unsafe-range-insert-node-move-before-and-insert-html-entrypoints",
  requiredProtocol: "https:",
  allowedPorts: ["", "443"],
  userinfoAllowed: false,
  allowedMethods: ["GET", "HEAD"],
  documentResourceType: "Document",
  staticResourceTypes: [
    "Font",
    "Image",
    "Manifest",
    "Media",
    "Script",
    "Stylesheet",
    "TextTrack",
  ],
  staticPathPrefixes: ["/assets/"],
  staticPathExtensions: [
    ".css",
    ".gif",
    ".ico",
    ".jpeg",
    ".jpg",
    ".js",
    ".json",
    ".map",
    ".mjs",
    ".otf",
    ".png",
    ".svg",
    ".ttf",
    ".webmanifest",
    ".webp",
    ".woff",
    ".woff2",
  ],
  externalOriginRewriteAllowed: false,
  firebaseGoogleRewriteAllowed: false,
  redirectPolicy: "abort-before-follow",
  responseBodyHashResourceTypes: ["Document", "Script"],
  requiredPerGroupResourceTypes: ["Document", "Script"],
  deterministicLocalResponse: {
    schemaVersion: 1,
    id: "korean-holidays-empty-v1",
    browserOriginSource: "stable-alias",
    method: "GET",
    pathname: "/api/korean-holidays",
    resourceTypes: ["Fetch", "XHR"],
    queryKeys: ["year"],
    queryOccurrenceCount: 1,
    yearCanonicalDecimalMinimum: 1900,
    yearCanonicalDecimalMaximum: 2100,
    requestBodyPolicy: "absent",
    forbiddenRequestHeaderNames: [
      "authorization",
      "content-type",
      "cookie",
      "x-firebase-appcheck",
      "x-goog-api-key",
      "x-vercel-protection-bypass",
    ],
    responseStatus: 200,
    responseHeaders: {
      "cache-control": "no-store",
      "content-type": "application/json; charset=utf-8",
    },
    responseBodyUtf8: '{"holidays":[]}',
    responseBodyBytes: 15,
    responseBodySha256:
      "b2353ccf5bff3a3f3f626773cf9824f9d0b7fc42f4f52488c49b36ebcdc64348",
    scopeMismatchAction: "block-before-transmission",
  },
  deterministicRecaptchaResponse: {
    schemaVersion: 1,
    id: "recaptcha-enterprise-bootstrap-stub-v1",
    protocol: "https:",
    hostname: "www.google.com",
    allowedPorts: ["", "443"],
    userinfoAllowed: false,
    method: "GET",
    pathname: "/recaptcha/enterprise.js",
    queryPolicy: "none",
    resourceType: "Script",
    requestBodyPolicy: "absent",
    forbiddenRequestHeaderNames: [
      "authorization",
      "content-type",
      "cookie",
      "x-firebase-appcheck",
      "x-goog-api-key",
      "x-vercel-protection-bypass",
    ],
    responseStatus: 200,
    responseHeaders: {
      "cache-control": "no-store",
      "content-type": "text/javascript; charset=utf-8",
    },
    responseBodyUtf8:
      'globalThis.grecaptcha={enterprise:{ready:(callback)=>callback(),render:()=>0,execute:()=>Promise.resolve("w10p-recaptcha-stub-token")}};',
    responseBodyBytes: 136,
    responseBodySha256:
      "9cf02df627dfd408fc5c4559b56b187450cbecc5684c72015708bcb18da5ed64",
    scopeMismatchAction: "block-before-transmission",
  },
  playwrightRouteRegistrationAllowed: false,
});
assert.equal(new Set(Object.values(upstreamOrigins)).size, 2);
assert.equal(
  Object.values(upstreamOrigins).includes(stableBrowserOrigin),
  false,
);
const nonFirebaseNetworkAllowedHostnames = [
  ...new Set(
    [stableBrowserOrigin, ...Object.values(upstreamOrigins)].map((origin) =>
      new URL(origin).hostname.toLowerCase(),
    ),
  ),
].sort();
assert.equal(nonFirebaseNetworkAllowedHostnames.length, 3);
const nonFirebaseNetworkAllowedOrigins = [
  stableBrowserOrigin,
  ...Object.values(upstreamOrigins),
].sort();
assert.equal(nonFirebaseNetworkAllowedOrigins.length, 3);
const vercelBypassAllowedOrigins = [
  ...new Set([stableBrowserOrigin, ...Object.values(upstreamOrigins)]),
].sort();
const VERCEL_BYPASS_TRANSPORT_CONTRACT = {
  requiredProtocol: "https:",
  allowedPorts: ["", "443"],
  userinfoAllowed: false,
  originMatch: "exact",
};
const isVercelBypassEligibleUrl = (value) => {
  return exactOriginTransportAllowed({
    value,
    allowedOrigins: vercelBypassAllowedOrigins,
    transportContract: VERCEL_BYPASS_TRANSPORT_CONTRACT,
  });
};
const fixtureAuditInputPath = resolve(requiredArg("--fixture-audit"));
assert.equal(
  existsSync(fixtureAuditInputPath),
  true,
  "The fresh staging fixture audit is missing.",
);
const fixtureAuditBytes = readFileSync(fixtureAuditInputPath);
const fixtureAuditText = fixtureAuditBytes.toString("utf8");
assert.doesNotMatch(fixtureAuditText, /@/u);
assert.doesNotMatch(
  fixtureAuditText,
  /[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/u,
);
const fixtureAudit = JSON.parse(fixtureAuditText);
const fixtureId = requiredArg("--fixture-id");
assert.equal(
  fixtureId,
  contract.fixtureId,
  "Visual capture must use the contract-bound staging fixture.",
);
const fixedTime = requiredArg("--fixed-time");
assert.equal(Number.isNaN(Date.parse(fixedTime)), false);
assert.equal(
  fixedTime,
  contract.fixedTime,
  "Visual capture time must match the contract-bound clock.",
);
assert.equal(existsSync(outputRoot), false, "Evidence output already exists.");

const appCheckDebugToken = String(
  process.env.W10P_VISUAL_APPCHECK_DEBUG_TOKEN || "",
).trim();
const appCheckDebugTokenSha256 = secretSha256(appCheckDebugToken);
delete process.env.W10P_VISUAL_APPCHECK_DEBUG_TOKEN;
assert.equal(
  APP_CHECK_DEBUG_TOKEN_PATTERN.test(appCheckDebugToken),
  true,
  "A strong registered UUIDv4 App Check debug token is required.",
);
assert.equal(
  process.argv.some((argument) => argument.includes(appCheckDebugToken)),
  false,
  "The App Check debug token must not be passed in argv.",
);
assert.equal(
  String(process.env.DEBUG || "").trim(),
  "",
  "DEBUG must be unset so Playwright CDP parameters cannot be logged.",
);
assertNoAppCheckSecretMaterial(fixtureAuditText, {
  debugToken: appCheckDebugToken,
});

let credentialsEnvironmentJson = String(
  process.env.W10P_VISUAL_CREDENTIALS_JSON || "{}",
);
delete process.env.W10P_VISUAL_CREDENTIALS_JSON;
const credentials = JSON.parse(credentialsEnvironmentJson);
for (const role of ["student", "teacher", "admin"]) {
  assert.match(credentials[role]?.email ?? "", /@/u);
  assert.ok(String(credentials[role]?.password ?? "").length >= 8);
}
assert.equal(
  new Set(
    Object.values(credentials).map((credential) =>
      String(credential.email).trim().toLowerCase(),
    ),
  ).size,
  3,
  "Student, teacher, and admin captures require distinct accounts.",
);
let firebaseConfigEnvironmentJson = String(
  process.env.W10P_VISUAL_FIREBASE_CONFIG_JSON || "{}",
);
delete process.env.W10P_VISUAL_FIREBASE_CONFIG_JSON;
const firebaseConfig = JSON.parse(firebaseConfigEnvironmentJson);
assert.deepEqual(
  Object.keys(firebaseConfig).sort(),
  contract.firebaseConfigBinding.exactKeys,
  "W10P_VISUAL_FIREBASE_CONFIG_JSON must contain exactly the six contract-bound SDK fields.",
);
for (const field of [
  "apiKey",
  "authDomain",
  "projectId",
  "storageBucket",
  "messagingSenderId",
  "appId",
]) {
  assert.ok(
    String(firebaseConfig[field] ?? "").trim().length > 0,
    `W10P_VISUAL_FIREBASE_CONFIG_JSON.${field} is required.`,
  );
}
assert.equal(
  firebaseConfig.projectId,
  contract.firebaseProjectId,
  "The visual login config must use the dedicated staging Firebase project.",
);
assert.equal(
  firebaseConfig.appId,
  STAGING_APP_ID,
  "The visual login config must use the dedicated staging Firebase web app.",
);
assert.equal(
  contract.firebaseConfigBinding.allowedAuthDomains.includes(
    String(firebaseConfig.authDomain),
  ),
  true,
  "The visual login authDomain must be an exact contract-bound staging Firebase hostname.",
);
assert.equal(
  firebaseConfig.messagingSenderId,
  contract.firebaseConfigBinding.messagingSenderId,
  "The visual login messagingSenderId must match the staging Firebase app.",
);
assert.match(
  String(firebaseConfig.storageBucket),
  new RegExp(
    `^${contract.firebaseProjectId.replace(
      /[.*+?^${}()|[\]\\]/gu,
      "\\$&",
    )}\\.(?:appspot\\.com|firebasestorage\\.app)$`,
    "u",
  ),
  "The visual login storageBucket must be an exact staging Firebase bucket.",
);
for (const forbiddenProjectId of contract.networkBoundary
  .forbiddenFirebaseProjectIds) {
  assert.doesNotMatch(
    JSON.stringify(firebaseConfig),
    new RegExp(
      forbiddenProjectId.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"),
      "iu",
    ),
    "The visual login config contains a Production Firebase identifier.",
  );
}
const createCaptureAppCheckTokenManager = () => {
  const requireFromFunctions = createRequire(resolve("functions/package.json"));
  const { applicationDefault, deleteApp, initializeApp } =
    requireFromFunctions("firebase-admin/app");
  const { getAppCheck } = requireFromFunctions("firebase-admin/app-check");
  const adminApp = initializeApp(
    {
      credential: applicationDefault(),
      projectId: contract.firebaseProjectId,
    },
    `w10p-capture-app-check-${process.pid}`,
  );
  const adminAppCheck = getAppCheck(adminApp);
  let token = "";
  let expiresAt = 0;
  let exchangeRequestCount = 0;
  let exchangeHttp200Count = 0;
  let adminVerificationCount = 0;
  let exchangePromise = null;
  const issuedTokenHashes = new Set();
  const exchangeEndpoint = `https://content-firebaseappcheck.googleapis.com/v1/projects/${contract.firebaseProjectId}/apps/${STAGING_APP_ID}:exchangeDebugToken`;
  const verifiedAudienceSet = [
    `projects/${contract.firebaseProjectId}`,
    `projects/${STAGING_PROJECT_NUMBER}`,
  ].sort();
  const verifiedIssuer = `https://firebaseappcheck.googleapis.com/${STAGING_PROJECT_NUMBER}`;
  const exchangeTransportContract = {
    method: "POST",
    contentType: "application/json",
    queryKeys: ["key"],
    requiredRequestHeaders: { "Content-Type": "application/json" },
    optionalRequestHeaders: ["X-Firebase-Client"],
    originHeaderPolicy: "exact-stable-alias-origin",
    refererHeaderPolicy: "exact-stable-alias-origin-slash",
    redirectMode: "error",
    requestBodyKeys: ["debug_token"],
    expectedStatus: 200,
    requiredResponseBodyKeys: ["token", "ttl"],
    ttlPattern: "^([\\d.]+)s$",
  };
  const exchange = async () => {
    token = "";
    expiresAt = 0;
    exchangeRequestCount += 1;
    const response = await fetch(
      `${exchangeEndpoint}?key=${encodeURIComponent(firebaseConfig.apiKey)}`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: new URL(contract.stableAlias).origin,
          referer: `${new URL(contract.stableAlias).origin}/`,
        },
        body: JSON.stringify({ debug_token: appCheckDebugToken }),
        redirect: "error",
        signal: AbortSignal.timeout(20_000),
      },
    );
    assert.equal(
      response.status,
      200,
      `The registered capture App Check debug token exchange failed with HTTP ${response.status}.`,
    );
    exchangeHttp200Count += 1;
    let payload = await response.json();
    token = String(payload?.token || "");
    assert.equal(
      APP_CHECK_JWT_SHAPE_PATTERN.test(token),
      true,
      "The capture App Check token is invalid.",
    );
    const ttlMatch = String(payload?.ttl || "").match(/^([\d.]+)s$/u);
    assert.ok(ttlMatch, "The capture App Check TTL is invalid.");
    const ttlSeconds = Number(ttlMatch[1]);
    assert.ok(ttlSeconds > 0 && ttlSeconds <= 7 * 24 * 60 * 60);
    const verification = await adminAppCheck.verifyToken(token);
    adminVerificationCount += 1;
    const decoded = verification?.token || {};
    assert.equal(verification?.appId, STAGING_APP_ID);
    assert.equal(decoded.app_id, STAGING_APP_ID);
    assert.equal(decoded.sub, STAGING_APP_ID);
    assert.deepEqual(
      [...new Set(decoded.aud || [])].sort(),
      verifiedAudienceSet,
    );
    assert.equal(decoded.iss, verifiedIssuer);
    const issuedAt = Number(decoded.iat || 0);
    expiresAt = Number(decoded.exp || 0);
    const now = Math.floor(Date.now() / 1_000);
    assert.ok(Number.isSafeInteger(issuedAt) && issuedAt <= now + 60);
    assert.ok(Number.isSafeInteger(expiresAt) && expiresAt >= now + 5 * 60);
    assert.ok(Math.abs(expiresAt - issuedAt - ttlSeconds) <= 5);
    issuedTokenHashes.add(secretSha256(token));
    payload = null;
  };
  return {
    async ensureFresh() {
      const now = Math.floor(Date.now() / 1_000);
      if (!token || expiresAt - now < 5 * 60) {
        exchangePromise ||= exchange().finally(() => {
          exchangePromise = null;
        });
        await exchangePromise;
      }
      return token;
    },
    matchesIssuedToken(candidate) {
      return (
        APP_CHECK_JWT_SHAPE_PATTERN.test(String(candidate || "")) &&
        issuedTokenHashes.has(secretSha256(candidate))
      );
    },
    get binding() {
      return {
        status: "VERIFIED_EXCHANGED",
        appCheckBound: true,
        debugTokenSha256: appCheckDebugTokenSha256,
        verifiedAppIdHash: secretSha256(STAGING_APP_ID),
        verifiedProjectIdHash: secretSha256(contract.firebaseProjectId),
        verifiedProjectNumberHash: secretSha256(STAGING_PROJECT_NUMBER),
        verifiedAudienceSetHash: secretSha256(
          canonicalJson(verifiedAudienceSet),
        ),
        verifiedIssuerHash: secretSha256(verifiedIssuer),
        exchangeOriginHash: secretSha256(new URL(contract.stableAlias).origin),
        exchangeEndpointHash: secretSha256(exchangeEndpoint),
        exchangeTransportContractHash: secretSha256(
          canonicalJson(exchangeTransportContract),
        ),
        exchangeRequestCount,
        exchangeHttp200Count,
        adminVerificationCount,
        refreshCount: Math.max(0, exchangeRequestCount - 1),
        minimumRemainingLifetimeSeconds: 5 * 60,
        allExchangesHttp200: exchangeRequestCount === exchangeHttp200Count,
        allExchangesAdminVerified:
          exchangeRequestCount === adminVerificationCount,
        tokenValidAtExchange: true,
        tokenJwtShapeValid: true,
        tokenLifetimeMatchedTtl: true,
        localStorageSecretWriteCount: browserLocalStorageSecretWriteCount,
      };
    },
    async close() {
      token = "";
      expiresAt = 0;
      issuedTokenHashes.clear();
      await deleteApp(adminApp);
    },
  };
};
const bypassSecret = String(
  process.env.VERCEL_AUTOMATION_BYPASS_SECRET || "",
).trim();
delete process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
const edgeExecutable =
  valueArg("--browser-executable") ||
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
assert.equal(
  existsSync(edgeExecutable),
  true,
  "Microsoft Edge is unavailable.",
);

const git = (...gitArgs) =>
  execFileSync("git", gitArgs, {
    cwd: process.cwd(),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const canonicalJson = (value) => {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
};
const stableOriginRewriteTransportContractHash = sha256(
  Buffer.from(canonicalJson(contract.browserTransport)),
);
const nonFirebaseNetworkAllowedHostnameSetHash = sha256(
  Buffer.from(canonicalJson(nonFirebaseNetworkAllowedHostnames)),
);
const immutableUpstreamBinding = {
  baseline: {
    deploymentId: baselineDeploymentId,
    deploymentUrl: upstreamOrigins.baseline,
    deploymentUrlSha256: sha256(upstreamOrigins.baseline),
    sourceCommitSha: contract.productionPresentationSha,
  },
  candidate: {
    deploymentId: candidateDeploymentId,
    deploymentUrl: upstreamOrigins.candidate,
    deploymentUrlSha256: sha256(upstreamOrigins.candidate),
    sourceCommitSha,
  },
};
const immutableUpstreamBindingHash = sha256(
  Buffer.from(canonicalJson(immutableUpstreamBinding)),
);
const canonicalBackupDouble = (value) => {
  if (Number.isNaN(value)) return "NaN";
  if (value === Infinity) return "Infinity";
  if (value === -Infinity) return "-Infinity";
  if (Object.is(value, -0)) return "-0";
  return String(value);
};
const canonicalizeBackupValue = (value) => {
  if (value === null) return ["null"];
  if (value === undefined) return ["undefined"];
  if (typeof value === "string") return ["string", value];
  if (typeof value === "boolean") return ["boolean", value];
  if (typeof value === "bigint") return ["integer", value.toString()];
  if (typeof value === "number")
    return ["double", canonicalBackupDouble(value)];
  if (value instanceof Date) return ["date", value.toISOString()];
  if (Array.isArray(value))
    return ["array", value.map(canonicalizeBackupValue)];
  if (
    value?.constructor?.name === "Timestamp" &&
    Number.isFinite(value.seconds) &&
    Number.isFinite(value.nanoseconds)
  ) {
    return ["timestamp", String(value.seconds), String(value.nanoseconds)];
  }
  if (
    value?.constructor?.name === "DocumentReference" &&
    typeof value.path === "string"
  ) {
    return ["reference", String(value.formattedName || value.path)];
  }
  if (
    value?.constructor?.name === "GeoPoint" &&
    Number.isFinite(value.latitude) &&
    Number.isFinite(value.longitude)
  ) {
    return [
      "geoPoint",
      canonicalBackupDouble(value.latitude),
      canonicalBackupDouble(value.longitude),
    ];
  }
  if (Buffer.isBuffer(value)) return ["bytes", value.toString("base64")];
  if (value?.constructor?.name === "Bytes" && value.toBase64) {
    return ["bytes", value.toBase64()];
  }
  if (
    value?.constructor?.name === "VectorValue" &&
    typeof value.toArray === "function"
  ) {
    return ["vector", value.toArray().map(canonicalBackupDouble)];
  }
  if (value && typeof value === "object") {
    return [
      "map",
      Object.keys(value)
        .sort()
        .filter((key) => value[key] !== undefined)
        .map((key) => [key, canonicalizeBackupValue(value[key])]),
    ];
  }
  throw new TypeError("Unsupported Firestore backup value type.");
};
const canonicalBackupJson = (value) =>
  JSON.stringify(canonicalizeBackupValue(value));
const listEvidenceFiles = (root, current = root) =>
  readdirSync(current, { withFileTypes: true }).flatMap((entry) => {
    const absolute = resolve(current, entry.name);
    if (entry.isDirectory()) return listEvidenceFiles(root, absolute);
    assert.equal(
      entry.isFile(),
      true,
      "The evidence root contains a non-file filesystem entry.",
    );
    return [relative(root, absolute).replaceAll("\\", "/")];
  });
const FIXTURE_APP_CHECK_EXCHANGE_ENDPOINT = `https://content-firebaseappcheck.googleapis.com/v1/projects/${contract.firebaseProjectId}/apps/${STAGING_APP_ID}:exchangeDebugToken`;
const FIXTURE_APP_CHECK_VERIFIED_AUDIENCE_SET = [
  `projects/${contract.firebaseProjectId}`,
  `projects/${STAGING_PROJECT_NUMBER}`,
].sort();
const FIXTURE_APP_CHECK_EXCHANGE_TRANSPORT_CONTRACT = {
  method: "POST",
  contentType: "application/json",
  queryKeys: ["key"],
  requiredRequestHeaders: { "Content-Type": "application/json" },
  optionalRequestHeaders: ["X-Firebase-Client"],
  originHeaderPolicy: "exact-stable-alias-origin",
  refererHeaderPolicy: "exact-stable-alias-origin-slash",
  redirectMode: "error",
  requestBodyKeys: ["debug_token"],
  expectedStatus: 200,
  requiredResponseBodyKeys: ["token", "ttl"],
  ttlPattern: "^([\\d.]+)s$",
};
const BASELINE_APP_CHECK_BRIDGE_SCOPE = {
  schemaVersion: 1,
  baselinePresentationSha: "676869fa289d3e7ecef234cbb5cca65c60ec4597",
  reason: "baseline-presentation-source-has-no-app-check-initialization",
  firebaseProjectId: contract.firebaseProjectId,
  allowedServices: ["firestore", "functions", "storage"],
  allowedHosts: [
    "firestore.googleapis.com",
    "firebasestorage.googleapis.com",
    `asia-northeast3-${contract.firebaseProjectId}.cloudfunctions.net`,
  ],
  requiredProtocol: "https:",
  allowedPorts: ["", "443"],
  userinfoAllowed: false,
  excludedMethods: ["OPTIONS"],
  firestoreDatabaseBoundaryHash: sha256(
    `projects/${contract.firebaseProjectId}/databases/(default)`,
  ),
  storageBucketHash: sha256(firebaseConfig.storageBucket),
  storagePathBoundaryHash: sha256(`/v0/b/${firebaseConfig.storageBucket}/o`),
  functionsPathRuleHash: sha256("single-callable-path-segment-v1"),
  interceptionMechanism: "cdp-fetch-request-stage",
  headerCorrelationMechanism: "playwright-request-allHeaders",
  urlMethodFifoCorrelationAllowed: false,
  redirectHeaderOverridePropagation: false,
  redirectPolicyHash: sha256(
    "abort-before-send-every-redirect-from-bridge-injected-request-v1",
  ),
  serviceWorkerPolicy: "block",
  candidateBridgeAllowed: false,
};
assert.equal(
  contract.productionPresentationSha,
  BASELINE_APP_CHECK_BRIDGE_SCOPE.baselinePresentationSha,
);
const baselineAppCheckBridgeScopeHash = sha256(
  Buffer.from(canonicalJson(BASELINE_APP_CHECK_BRIDGE_SCOPE)),
);
const preTransmissionNetworkBoundaryAttestationHash = sha256(
  Buffer.from(canonicalJson(PRE_TRANSMISSION_NETWORK_BOUNDARY_ATTESTATION)),
);
const BROWSER_APP_CHECK_CDP_SECURITY_SCOPE = {
  schemaVersion: 4,
  interceptionMechanism: "cdp-fetch-request-stage",
  preTransmissionNetworkBoundaryAttestationHash,
  nonFirebaseNetworkAllowedHostnameSetHash,
  executionTargetBoundaryHash: sha256(
    canonicalJson(contract.networkBoundary.executionTargetBoundary),
  ),
  browserConnectProxyHash: sha256(
    canonicalJson(contract.networkBoundary.browserConnectProxy),
  ),
  directBrowserEarlyHintsPolicy:
    "observed-after-receipt-capture-invalid-fatal-not-pre-transmission-block",
  secretInitScope: "primary-page-only",
  browserGlobalValueKind: "non-secret-fixed-sentinel",
  debugSentinelHash: sha256(APP_CHECK_DEBUG_SENTINEL),
  exchangeEndpointHash: sha256(FIXTURE_APP_CHECK_EXCHANGE_ENDPOINT),
  exchangeApiKeyHash: sha256(firebaseConfig.apiKey),
  exchangeMethod: "POST",
  exchangeQueryKeys: ["key"],
  exchangeContentType: "application/json",
  exchangeRequestBodyKeys: ["debug_token"],
  replacementEncoding: "base64-utf8-json",
  appCheckHeaderAllowedScopeHashes: [
    baselineAppCheckBridgeScopeHash,
    sha256(
      canonicalJson({
        hosts: ["identitytoolkit.googleapis.com", "securetoken.googleapis.com"],
        apiKeyHash: sha256(firebaseConfig.apiKey),
        identityToolkitPathRule: "/v[12]/accounts:<operation>",
        secureTokenPath: "/v1/token",
        requiredProtocol: "https:",
        allowedPorts: ["", "443"],
        userinfoAllowed: false,
      }),
    ),
  ].sort(),
  rawDebugTokenRendererInjectionAllowed: false,
  sensitiveResponseInterception: true,
  sensitiveRedirectPolicyHash: sha256(
    "abort-before-send-any-redirect-for-debug-body-or-app-check-header-v1",
  ),
  protocolDebugLoggingAllowed: false,
  browserChildSecretEnvironmentScrubRequired: true,
  browserChildEnvironmentAllowlistHash: sha256(
    canonicalJson(BROWSER_CHILD_ENVIRONMENT_ALLOWLIST),
  ),
  browserGlobalExtraHttpHeadersAllowed: false,
  vercelBypassInjectionMechanism: "cdp-fetch-exact-origin-only",
  vercelBypassAllowedOriginSetHash: sha256(
    canonicalJson(vercelBypassAllowedOrigins),
  ),
  vercelBypassTransportContractHash: sha256(
    canonicalJson(VERCEL_BYPASS_TRANSPORT_CONTRACT),
  ),
  vercelBypassRedirectPolicyHash: sha256(
    "abort-before-send-any-redirect-for-cdp-injected-vercel-bypass-v1",
  ),
  monitoredTargetKind: "all-relevant-targets-before-runtime-resume",
  targetGuardMechanism:
    "playwright-private-crsession-runtime-resume-gate-plus-primary-fetch-handoff",
  secondaryTargetExecutionAllowed: false,
  creatorCapabilityInitScriptRequired: true,
  playwrightWebSocketRouteRequired: true,
  webSocketConnectToServerAllowed: false,
  webTransportConstructorAllowed: false,
  monitorTerminationMechanism: "context-close-with-fetch-enabled",
  targetDiscoveryMechanism: "cdp-target-created-cumulative",
  retainedTargetSnapshotCrossCheck: true,
  unexpectedPagePolicy: "zero",
  dedicatedWorkerPolicy: "zero",
  sharedWorkerPolicy: "zero",
  serviceWorkerTargetPolicy: "zero",
  crossOriginFramePolicy: "zero",
  oopifTargetPolicy: "zero",
  playwrightRouteInterceptionAllowed: false,
  traceWriteAllowed: false,
  harWriteAllowed: false,
  storageStateWriteAllowed: false,
};
const browserAppCheckCdpSecurityScopeHash = sha256(
  Buffer.from(canonicalJson(BROWSER_APP_CHECK_CDP_SECURITY_SCOPE)),
);
const backupAccessProbeCanary = (kind) => {
  const revisionHash = sha256(
    `${contract.fixtureId}\n${contract.fixtureRevision}\nbackup-access-${kind}-canary-v1`,
  );
  const documentId = sha256(`${revisionHash}\ndocument`);
  const data = {
    schemaVersion: 1,
    fixtureOwner: "w10p-visual-parity",
    fixtureId: contract.fixtureId,
    fixtureRevision: contract.fixtureRevision,
    canaryPurpose: `backup-access-${kind}-deny-probe`,
    canaryRevision: revisionHash,
    payloadSentinelHash: sha256(
      `${contract.fixtureId}\n${contract.fixtureRevision}\n${kind}\npayload`,
    ),
  };
  return {
    revisionHash,
    path: `w10p_visual_fixture_backups/${contract.fixtureId}/documents/${documentId}`,
    documentHash: sha256(Buffer.from(canonicalBackupJson(data))),
  };
};
const verifyBackupHashKnownVectors = () => {
  const canaryVectors = [
    [
      "existing-update-delete",
      "a64dd06032f8d72c981a05f4fb59c0e8cd516f6ada1266d4fffa5654f0de931a",
      "af573ffe4c29aa45b0859cdce167f9504697aa729b35ba12288d45274e1dee2d",
    ],
    [
      "absent-create",
      "f5f4ba73a1b23a33e72d3a0287bd196a19316250937a3190b4b8ff015ccafb24",
      "0987a826ae977395ba7e064ce1b1734fc8e81159ed17ab67db0959fb9bfd71bd",
    ],
    [
      "pre-backup-existing-update-delete",
      "0bd618252e9b5c8d1be515b4db0c7743e6d6f330228ce96b4d6d2f3cea58f3aa",
      "ba5a118158a41378bb03ebd51af8319d9d52d71206063beb2d8c86712142887a",
    ],
    [
      "pre-backup-absent-create",
      "415e0746cbef40610b4fdd7e1e17572bf35d1cf6c45fd62c0187c021a199497b",
      "fec5142c3082251f5e4cf603651debe41de1bf557b0c0aa762319c61b5412630",
    ],
  ];
  for (const [kind, backupHash, genericHash] of canaryVectors) {
    const actual = backupAccessProbeCanary(kind).documentHash;
    assert.equal(actual, backupHash, `${kind} backup hash drifted.`);
    assert.notEqual(
      actual,
      genericHash,
      `${kind} must retain Firestore backup type tags.`,
    );
  }
  const probeRevisionHash = sha256(
    `${contract.fixtureId}\n${contract.fixtureRevision}\npre-backup-access-probe-v1`,
  );
  const positiveControlData = {
    schemaVersion: 1,
    fixtureOwner: "w10p-visual-parity",
    fixtureId: contract.fixtureId,
    fixtureRevision: contract.fixtureRevision,
    fixturePurpose: "pre-backup-positive-control",
    probeRevision: probeRevisionHash,
    sentinelHash: sha256(`${probeRevisionHash}\npositive-control-sentinel`),
  };
  const positiveControlHash = sha256(
    Buffer.from(canonicalBackupJson(positiveControlData)),
  );
  assert.equal(
    positiveControlHash,
    "a7aeff4656ddf93f04b09f12eeb72ede57b0e57472f2b85a49c0ec341bb3c171",
    "The pre-backup positive-control backup hash drifted.",
  );
  assert.notEqual(
    positiveControlHash,
    sha256(Buffer.from(canonicalJson(positiveControlData))),
    "The pre-backup positive control must retain Firestore backup type tags.",
  );
  return canaryVectors.length + 1;
};
const POST_BACKUP_PROBE_EXACT = {
  status: "VERIFIED_DENIED",
  probeKind: "synthetic-fixture-id-token-backup-read-update-delete-create",
  sessionBound: true,
  appCheckBound: true,
  appCheckExchangeHttpStatus: 200,
  appCheckExchangeRequestCount: 1,
  appCheckAdminVerificationCount: 1,
  appCheckProjectBindingVerified: true,
  appCheckAppBindingVerified: true,
  appCheckTokenValidAtVerification: true,
  appCheckTokenLifetimeWithinMaximum: true,
  appCheckHeaderRequestCount: 4,
  readDenied: true,
  writeDenied: true,
  updateDenied: true,
  deleteDenied: true,
  createDenied: true,
  readHttpStatus: 403,
  readFirestoreStatus: "PERMISSION_DENIED",
  updateHttpStatus: 403,
  updateFirestoreStatus: "PERMISSION_DENIED",
  deleteHttpStatus: 403,
  deleteFirestoreStatus: "PERMISSION_DENIED",
  createHttpStatus: 403,
  createFirestoreStatus: "PERMISSION_DENIED",
  existingCanaryOriginalHashPreserved: true,
  requestCount: 6,
  identityRequestCount: 1,
  accessRequestCount: 4,
  readRequestCount: 1,
  writeRequestCount: 3,
  updateRequestCount: 1,
  deleteRequestCount: 1,
  createRequestCount: 1,
  adminCanarySetupWriteCount: 1,
  conditionalCanaryCleanupWriteCount: 1,
  canaryOwnershipMismatchCount: 0,
  canaryResidualCount: 0,
  temporarySessionWriteCount: 2,
  temporarySessionCleanupWriteCount: 1,
  temporarySessionResidualCount: 0,
  rawTokenOutputCount: 0,
  rawAppCheckDebugTokenOutputCount: 0,
  rawAppCheckJwtOutputCount: 0,
  rawResponseBodyOutputCount: 0,
  rawDocumentPathOutputCount: 0,
  rawCanaryDocumentOutputCount: 0,
  rawPiiOutputCount: 0,
};
const POST_BACKUP_PROBE_HASH_FIELDS = [
  "appCheckDebugTokenHash",
  "verifiedAppIdHash",
  "verifiedProjectIdHash",
  "verifiedProjectNumberHash",
  "verifiedAudienceSetHash",
  "verifiedIssuerHash",
  "exchangeEndpointHash",
  "exchangeTransportContractHash",
  "projectIdHash",
  "identityUidHash",
  "backupNamespaceHash",
  "backupManifestHash",
  "localRulesSourceHash",
  "probeSessionPathHash",
  "readDocumentPathHash",
  "existingWriteCanaryPathHash",
  "absentWriteCanaryPathHash",
  "existingWriteCanaryRevisionHash",
  "absentWriteCanaryRevisionHash",
  "existingWriteCanaryDocumentHash",
  "absentWriteCanaryDocumentHash",
];
const PRE_BACKUP_PROBE_EXACT = {
  status: "VERIFIED_DENIED",
  probeKind:
    "ephemeral-synthetic-id-token-pre-backup-read-update-delete-create",
  sessionBound: true,
  appCheckBound: true,
  appCheckExchangeHttpStatus: 200,
  appCheckExchangeRequestCount: 1,
  appCheckAdminVerificationCount: 1,
  appCheckProjectBindingVerified: true,
  appCheckAppBindingVerified: true,
  appCheckTokenValidAtVerification: true,
  appCheckTokenLifetimeWithinMaximum: true,
  appCheckHeaderRequestCount: 6,
  positiveControlPassed: true,
  positiveControlHttpStatus: 200,
  positiveControlSentinelMatched: true,
  positiveControlOriginalHashPreserved: true,
  readDenied: true,
  existingReadDenied: true,
  absentReadDenied: true,
  writeDenied: true,
  updateDenied: true,
  deleteDenied: true,
  createDenied: true,
  existingReadHttpStatus: 403,
  existingReadFirestoreStatus: "PERMISSION_DENIED",
  absentReadHttpStatus: 403,
  absentReadFirestoreStatus: "PERMISSION_DENIED",
  updateHttpStatus: 403,
  updateFirestoreStatus: "PERMISSION_DENIED",
  deleteHttpStatus: 403,
  deleteFirestoreStatus: "PERMISSION_DENIED",
  createHttpStatus: 403,
  createFirestoreStatus: "PERMISSION_DENIED",
  existingCanaryOriginalHashPreserved: true,
  requestCount: 8,
  identityRequestCount: 1,
  accessRequestCount: 6,
  readRequestCount: 2,
  writeRequestCount: 3,
  positiveControlReadRequestCount: 1,
  existingReadRequestCount: 1,
  absentReadRequestCount: 1,
  updateRequestCount: 1,
  deleteRequestCount: 1,
  createRequestCount: 1,
  ephemeralAuthWriteCount: 3,
  ephemeralAuthSetupWriteCount: 2,
  ephemeralAuthCleanupWriteCount: 1,
  ephemeralAuthResidualCount: 0,
  ephemeralProfileWriteCount: 2,
  ephemeralProfileSetupWriteCount: 1,
  ephemeralProfileCleanupWriteCount: 1,
  ephemeralProfileResidualCount: 0,
  positiveControlWriteCount: 2,
  positiveControlSetupWriteCount: 1,
  positiveControlCleanupWriteCount: 1,
  positiveControlResidualCount: 0,
  temporarySessionWriteCount: 2,
  temporarySessionCleanupWriteCount: 1,
  temporarySessionResidualCount: 0,
  adminCanarySetupWriteCount: 1,
  conditionalCanaryCleanupWriteCount: 1,
  canaryResidualCount: 0,
  ownershipMismatchCount: 0,
  rawBackupWriteCount: 0,
  rawTokenOutputCount: 0,
  rawAppCheckDebugTokenOutputCount: 0,
  rawAppCheckJwtOutputCount: 0,
  rawResponseBodyOutputCount: 0,
  rawDocumentPathOutputCount: 0,
  rawCanaryDocumentOutputCount: 0,
  rawPiiOutputCount: 0,
};
const PRE_BACKUP_PROBE_HASH_FIELDS = [
  "appCheckDebugTokenHash",
  "verifiedAppIdHash",
  "verifiedProjectIdHash",
  "verifiedProjectNumberHash",
  "verifiedAudienceSetHash",
  "verifiedIssuerHash",
  "exchangeEndpointHash",
  "exchangeTransportContractHash",
  "projectIdHash",
  "identityUidHash",
  "identityEmailHash",
  "backupNamespaceHash",
  "localRulesSourceHash",
  "probeRevisionHash",
  "probeProfilePathHash",
  "probeSessionPathHash",
  "positiveControlPathHash",
  "positiveControlSentinelHash",
  "positiveControlDocumentHash",
  "existingWriteCanaryPathHash",
  "absentWriteCanaryPathHash",
  "existingWriteCanaryRevisionHash",
  "absentWriteCanaryRevisionHash",
  "existingWriteCanaryDocumentHash",
  "absentWriteCanaryDocumentHash",
];
const assertExactBackupProbeAttestation = ({
  probe,
  exact,
  hashFields,
  expected,
  label,
}) => {
  assert.ok(
    probe && typeof probe === "object" && !Array.isArray(probe),
    `${label} is missing.`,
  );
  assert.deepEqual(
    Object.keys(probe).sort(),
    [...Object.keys(exact), ...hashFields, "attestationHash"].sort(),
    `${label} schema drifted.`,
  );
  for (const [field, value] of Object.entries(exact)) {
    assert.equal(probe[field], value, `${label} ${field} is invalid.`);
  }
  for (const field of [...hashFields, "attestationHash"]) {
    assert.match(
      probe[field],
      /^[a-f0-9]{64}$/u,
      `${label} ${field} must be SHA-256.`,
    );
  }
  for (const [field, value] of Object.entries(expected)) {
    assert.equal(probe[field], value, `${label} ${field} is invalid.`);
  }
  const { attestationHash, ...projection } = probe;
  assert.equal(
    sha256(Buffer.from(canonicalJson(projection))),
    attestationHash,
    `${label} attestation hash is invalid.`,
  );
  return attestationHash;
};
const assertBackupAccessProbeAttestation = (probe, expected) =>
  assertExactBackupProbeAttestation({
    probe,
    exact: POST_BACKUP_PROBE_EXACT,
    hashFields: POST_BACKUP_PROBE_HASH_FIELDS,
    expected,
    label: "The post-backup namespace access probe",
  });
const assertPreBackupAccessProbeAttestation = (probe, expected) =>
  assertExactBackupProbeAttestation({
    probe,
    exact: PRE_BACKUP_PROBE_EXACT,
    hashFields: PRE_BACKUP_PROBE_HASH_FIELDS,
    expected,
    label: "The pre-backup namespace access probe",
  });
const verifyBackupAccessProbeNegativeFixtures = () => {
  const backupHashKnownVectorCount = verifyBackupHashKnownVectors();
  const hash = "a".repeat(64);
  const attest = (projection) => ({
    ...projection,
    attestationHash: sha256(Buffer.from(canonicalJson(projection))),
  });
  const postProjection = {
    ...POST_BACKUP_PROBE_EXACT,
    ...Object.fromEntries(
      POST_BACKUP_PROBE_HASH_FIELDS.map((field) => [field, hash]),
    ),
  };
  const valid = attest(postProjection);
  const postExpected = Object.fromEntries(
    POST_BACKUP_PROBE_HASH_FIELDS.map((field) => [field, hash]),
  );
  assert.doesNotThrow(() =>
    assertBackupAccessProbeAttestation(valid, postExpected),
  );
  const postInvalid = [
    null,
    attest({ ...postProjection, status: "NOT_EXECUTED" }),
    attest({ ...postProjection, appCheckBound: false }),
    attest({ ...postProjection, appCheckHeaderRequestCount: 3 }),
    attest({ ...postProjection, appCheckExchangeRequestCount: 0 }),
    attest({ ...postProjection, appCheckAdminVerificationCount: 0 }),
    attest({ ...postProjection, rawAppCheckDebugTokenOutputCount: 1 }),
    attest({ ...postProjection, rawAppCheckJwtOutputCount: 1 }),
    Object.fromEntries(
      Object.entries(valid).filter(([field]) => field !== "writeDenied"),
    ),
    attest({ ...postProjection, readDenied: false }),
    attest({ ...postProjection, writeDenied: false }),
    attest({ ...postProjection, updateDenied: false }),
    attest({ ...postProjection, deleteDenied: false }),
    attest({ ...postProjection, createDenied: false }),
    attest({ ...postProjection, createHttpStatus: 200 }),
    attest({ ...postProjection, writeRequestCount: 2 }),
    attest({ ...postProjection, canaryResidualCount: 1 }),
    attest({ ...postProjection, temporarySessionResidualCount: 1 }),
    { ...valid, requestCount: 4 },
    attest({
      ...postProjection,
      existingWriteCanaryPathHash: "b".repeat(64),
    }),
    attest({ ...postProjection, exchangeEndpointHash: "b".repeat(64) }),
    attest({
      ...postProjection,
      exchangeTransportContractHash: "b".repeat(64),
    }),
  ];
  for (const invalid of postInvalid) {
    assert.throws(() =>
      assertBackupAccessProbeAttestation(invalid, postExpected),
    );
  }
  const preProjection = {
    ...PRE_BACKUP_PROBE_EXACT,
    ...Object.fromEntries(
      PRE_BACKUP_PROBE_HASH_FIELDS.map((field) => [field, hash]),
    ),
  };
  const validPre = attest(preProjection);
  const preExpected = Object.fromEntries(
    PRE_BACKUP_PROBE_HASH_FIELDS.map((field) => [field, hash]),
  );
  assert.doesNotThrow(() =>
    assertPreBackupAccessProbeAttestation(validPre, preExpected),
  );
  const preInvalid = [
    null,
    attest({ ...preProjection, status: "NOT_EXECUTED" }),
    attest({ ...preProjection, appCheckBound: false }),
    attest({ ...preProjection, appCheckHeaderRequestCount: 5 }),
    attest({ ...preProjection, appCheckExchangeRequestCount: 0 }),
    attest({ ...preProjection, appCheckAdminVerificationCount: 0 }),
    attest({ ...preProjection, rawAppCheckDebugTokenOutputCount: 1 }),
    attest({ ...preProjection, rawAppCheckJwtOutputCount: 1 }),
    attest({ ...preProjection, positiveControlPassed: false }),
    attest({ ...preProjection, positiveControlHttpStatus: 403 }),
    attest({ ...preProjection, positiveControlSentinelMatched: false }),
    Object.fromEntries(
      Object.entries(validPre).filter(
        ([field]) => field !== "rawBackupWriteCount",
      ),
    ),
    attest({ ...preProjection, readDenied: false }),
    attest({ ...preProjection, absentReadDenied: false }),
    attest({ ...preProjection, writeDenied: false }),
    attest({ ...preProjection, updateDenied: false }),
    attest({ ...preProjection, deleteDenied: false }),
    attest({ ...preProjection, createDenied: false }),
    attest({ ...preProjection, rawBackupWriteCount: 1 }),
    attest({ ...preProjection, ephemeralAuthResidualCount: 1 }),
    attest({ ...preProjection, ephemeralProfileResidualCount: 1 }),
    attest({ ...preProjection, temporarySessionResidualCount: 1 }),
    attest({ ...preProjection, positiveControlResidualCount: 1 }),
    attest({ ...preProjection, canaryResidualCount: 1 }),
    attest({ ...preProjection, writeRequestCount: 2 }),
    { ...validPre, requestCount: 5 },
    attest({ ...preProjection, probeRevisionHash: "b".repeat(64) }),
    attest({ ...preProjection, verifiedAudienceSetHash: "b".repeat(64) }),
    attest({
      ...preProjection,
      exchangeTransportContractHash: "b".repeat(64),
    }),
  ];
  for (const invalid of preInvalid) {
    assert.throws(() =>
      assertPreBackupAccessProbeAttestation(invalid, preExpected),
    );
  }
  return {
    backupHashKnownVectorCount,
    postBackupNegativeCaseCount: postInvalid.length,
    preBackupNegativeCaseCount: preInvalid.length,
  };
};
const backupAccessProbeNegativeSelfTest =
  verifyBackupAccessProbeNegativeFixtures();
if (args.includes("--self-test-backup-probe")) {
  console.log(
    JSON.stringify({
      suite: "w10p-backup-access-probe-capture-self-test",
      passed: true,
      ...backupAccessProbeNegativeSelfTest,
      productionAccess: 0,
      networkAccess: 0,
    }),
  );
  process.exit(0);
}
const fixtureAuditSha256 = sha256(fixtureAuditBytes);
assert.equal(fixtureAudit.suite, "w10p-visual-fixture-audit");
assert.equal(fixtureAudit.passed, true);
assert.equal(
  fixtureAudit.artifactSchemaVersion,
  "w10p-visual-fixture-audit-v2",
);
assert.equal(fixtureAudit.projectId, contract.firebaseProjectId);
assert.equal(fixtureAudit.fixtureId, contract.fixtureId);
assert.equal(fixtureAudit.fixtureNamespace, contract.fixtureId);
assert.equal(fixtureAudit.fixtureRevision, contract.fixtureRevision);
assert.equal(fixtureAudit.planHash, contract.fixturePlanHash);
assert.equal(fixtureAudit.captureBinding?.planHash, contract.fixturePlanHash);
assert.equal(
  fixtureAudit.captureBinding?.fixtureRevision,
  contract.fixtureRevision,
);
assert.equal(fixtureAudit.captureBinding?.fixtureNamespace, contract.fixtureId);
assert.equal(
  fixtureAudit.captureBinding?.projectId,
  contract.firebaseProjectId,
);
assert.deepEqual(
  Object.keys(fixtureAudit.captureBinding || {}).sort(),
  [
    "fixtureNamespace",
    "fixtureRevision",
    "projectId",
    "planHash",
    "authAllowedUidSetHash",
    "authManifestHash",
    "authFixtureIdentityScopeManifestHash",
    "fixtureDocumentCount",
    "documentProjectionHash",
    "plannedMutationTopologyAllowlistHash",
    "plannedMutationTopologyObservedHash",
    "plannedMutationTopologyBaselineHash",
    "strictCollectionCount",
    "strictExpectedRowCount",
    "strictActualRowCount",
    "strictAllowlistManifestHash",
    "strictManifestHash",
    "presentationAttestationHash",
    "privacyAttestationHash",
    "appCheckDebugTokenHash",
    "verifiedAppIdHash",
    "verifiedProjectIdHash",
    "verifiedProjectNumberHash",
    "verifiedAudienceSetHash",
    "verifiedIssuerHash",
    "exchangeEndpointHash",
    "exchangeTransportContractHash",
    "preBackupNamespaceAccessAttestationHash",
    "backupNamespaceAccessAttestationHash",
    "postBackupProbeLifecycleHash",
    "freshness",
    "extraRowCount",
  ].sort(),
  "The staging fixture capture binding schema drifted.",
);
assert.equal(
  sha256(Buffer.from(canonicalJson(fixtureAudit.captureBinding))),
  fixtureAudit.captureBindingHash,
  "The staging fixture capture binding hash is invalid.",
);
const plannedMutationTopology = fixtureAudit.isolation?.plannedMutationTopology;
assert.deepEqual(
  Object.keys(plannedMutationTopology || {}).sort(),
  [
    "documentCount",
    "allowlistHash",
    "observedHash",
    "baselineHash",
    "rows",
  ].sort(),
  "The planned mutation topology schema drifted.",
);
assert.equal(
  Number(plannedMutationTopology.documentCount),
  plannedMutationTopology.rows?.length,
);
assert.ok(Number(plannedMutationTopology.documentCount) > 0);
for (const field of ["allowlistHash", "observedHash", "baselineHash"]) {
  assert.match(plannedMutationTopology[field], /^[a-f0-9]{64}$/u);
}
const plannedMutationPathHashes = [];
const topologyRowUsesOnlyAllowedChildren = (row) => {
  const allowedChildIds = new Set(row.allowedChildIds || []);
  return (row.actualChildIds || []).every((childId) =>
    allowedChildIds.has(childId),
  );
};
for (const row of plannedMutationTopology.rows || []) {
  assert.deepEqual(
    Object.keys(row || {}).sort(),
    ["pathHash", "allowedChildIds", "actualChildIds"].sort(),
  );
  assert.match(row.pathHash, /^[a-f0-9]{64}$/u);
  assert.deepEqual(row.allowedChildIds, [...row.allowedChildIds].sort());
  assert.deepEqual(row.actualChildIds, [...row.actualChildIds].sort());
  assert.equal(new Set(row.allowedChildIds).size, row.allowedChildIds.length);
  assert.equal(new Set(row.actualChildIds).size, row.actualChildIds.length);
  assert.equal(topologyRowUsesOnlyAllowedChildren(row), true);
  plannedMutationPathHashes.push(row.pathHash);
}
assert.deepEqual(
  plannedMutationPathHashes,
  [...plannedMutationPathHashes].sort(),
);
assert.equal(
  new Set(plannedMutationPathHashes).size,
  plannedMutationPathHashes.length,
);
const unknownChildTopologyNegative = structuredClone(
  plannedMutationTopology.rows[0],
);
unknownChildTopologyNegative.actualChildIds.push("unknown-fixture-child");
assert.equal(
  topologyRowUsesOnlyAllowedChildren(unknownChildTopologyNegative),
  false,
);
assert.equal(
  sha256(Buffer.from(canonicalJson(plannedMutationTopology.rows))),
  plannedMutationTopology.observedHash,
);
assert.equal(
  sha256(
    Buffer.from(
      canonicalJson(
        plannedMutationTopology.rows.map(({ pathHash, allowedChildIds }) => ({
          pathHash,
          allowedChildIds,
        })),
      ),
    ),
  ),
  plannedMutationTopology.allowlistHash,
);
assert.equal(
  fixtureAudit.captureBinding.plannedMutationTopologyAllowlistHash,
  plannedMutationTopology.allowlistHash,
);
assert.equal(
  fixtureAudit.captureBinding.plannedMutationTopologyObservedHash,
  plannedMutationTopology.observedHash,
);
assert.equal(
  fixtureAudit.captureBinding.plannedMutationTopologyBaselineHash,
  plannedMutationTopology.baselineHash,
);
const postExistingCanary = backupAccessProbeCanary("existing-update-delete");
const postAbsentCanary = backupAccessProbeCanary("absent-create");
const preExistingCanary = backupAccessProbeCanary(
  "pre-backup-existing-update-delete",
);
const preAbsentCanary = backupAccessProbeCanary("pre-backup-absent-create");
const preBackupProbeRevisionHash = sha256(
  `${contract.fixtureId}\n${contract.fixtureRevision}\npre-backup-access-probe-v1`,
);
const preBackupPositiveControlSentinelHash = sha256(
  `${preBackupProbeRevisionHash}\npositive-control-sentinel`,
);
const preBackupPositiveControlData = {
  schemaVersion: 1,
  fixtureOwner: "w10p-visual-parity",
  fixtureId: contract.fixtureId,
  fixtureRevision: contract.fixtureRevision,
  fixturePurpose: "pre-backup-positive-control",
  probeRevision: preBackupProbeRevisionHash,
  sentinelHash: preBackupPositiveControlSentinelHash,
};
const preBackupNamespaceAccessAttestationHash =
  assertPreBackupAccessProbeAttestation(
    fixtureAudit.isolation?.preBackupAccessProbe,
    {
      appCheckDebugTokenHash: sha256(appCheckDebugToken),
      verifiedAppIdHash: sha256(STAGING_APP_ID),
      verifiedProjectIdHash: sha256(contract.firebaseProjectId),
      verifiedProjectNumberHash: sha256(STAGING_PROJECT_NUMBER),
      verifiedAudienceSetHash: sha256(
        canonicalJson(FIXTURE_APP_CHECK_VERIFIED_AUDIENCE_SET),
      ),
      verifiedIssuerHash: sha256(
        `https://firebaseappcheck.googleapis.com/${STAGING_PROJECT_NUMBER}`,
      ),
      exchangeEndpointHash: sha256(FIXTURE_APP_CHECK_EXCHANGE_ENDPOINT),
      exchangeTransportContractHash: sha256(
        canonicalJson(FIXTURE_APP_CHECK_EXCHANGE_TRANSPORT_CONTRACT),
      ),
      projectIdHash: sha256(contract.firebaseProjectId),
      identityUidHash: sha256("w10p-visual-backup-preflight"),
      identityEmailHash: sha256(
        "w10p-visual-backup-preflight@yongshin-ms.ms.kr",
      ),
      backupNamespaceHash: sha256(
        `w10p_visual_fixture_backups/${contract.fixtureId}`,
      ),
      localRulesSourceHash: sha256(readFileSync(resolve("firestore.rules"))),
      probeRevisionHash: preBackupProbeRevisionHash,
      probeProfilePathHash: sha256("users/w10p-visual-backup-preflight"),
      positiveControlPathHash: sha256(
        "users/w10p-visual-backup-preflight/academic_records/access-control",
      ),
      positiveControlSentinelHash: preBackupPositiveControlSentinelHash,
      positiveControlDocumentHash: sha256(
        Buffer.from(canonicalBackupJson(preBackupPositiveControlData)),
      ),
      existingWriteCanaryPathHash: sha256(preExistingCanary.path),
      absentWriteCanaryPathHash: sha256(preAbsentCanary.path),
      existingWriteCanaryRevisionHash: preExistingCanary.revisionHash,
      absentWriteCanaryRevisionHash: preAbsentCanary.revisionHash,
      existingWriteCanaryDocumentHash: preExistingCanary.documentHash,
      absentWriteCanaryDocumentHash: preAbsentCanary.documentHash,
    },
  );
assert.equal(
  fixtureAudit.captureBinding?.preBackupNamespaceAccessAttestationHash,
  preBackupNamespaceAccessAttestationHash,
  "The capture binding is not bound to the pre-backup deny attestation.",
);
const backupNamespaceAccessAttestationHash = assertBackupAccessProbeAttestation(
  fixtureAudit.isolation?.liveBackupAccessProbe,
  {
    appCheckDebugTokenHash: sha256(appCheckDebugToken),
    verifiedAppIdHash: sha256(STAGING_APP_ID),
    verifiedProjectIdHash: sha256(contract.firebaseProjectId),
    verifiedProjectNumberHash: sha256(STAGING_PROJECT_NUMBER),
    verifiedAudienceSetHash: sha256(
      canonicalJson(FIXTURE_APP_CHECK_VERIFIED_AUDIENCE_SET),
    ),
    verifiedIssuerHash: sha256(
      `https://firebaseappcheck.googleapis.com/${STAGING_PROJECT_NUMBER}`,
    ),
    exchangeEndpointHash: sha256(FIXTURE_APP_CHECK_EXCHANGE_ENDPOINT),
    exchangeTransportContractHash: sha256(
      canonicalJson(FIXTURE_APP_CHECK_EXCHANGE_TRANSPORT_CONTRACT),
    ),
    projectIdHash: sha256(contract.firebaseProjectId),
    identityUidHash: sha256(contract.captureIdentities.roles.student.uid),
    backupNamespaceHash: sha256(
      `w10p_visual_fixture_backups/${contract.fixtureId}`,
    ),
    backupManifestHash: fixtureAudit.isolation?.backupManifestHash,
    localRulesSourceHash: sha256(readFileSync(resolve("firestore.rules"))),
    existingWriteCanaryPathHash: sha256(postExistingCanary.path),
    absentWriteCanaryPathHash: sha256(postAbsentCanary.path),
    existingWriteCanaryRevisionHash: postExistingCanary.revisionHash,
    absentWriteCanaryRevisionHash: postAbsentCanary.revisionHash,
    existingWriteCanaryDocumentHash: postExistingCanary.documentHash,
    absentWriteCanaryDocumentHash: postAbsentCanary.documentHash,
  },
);
assert.equal(
  fixtureAudit.captureBinding?.backupNamespaceAccessAttestationHash,
  backupNamespaceAccessAttestationHash,
  "The capture binding is not bound to the live backup deny attestation.",
);
assert.equal(
  fixtureAudit.captureBinding?.appCheckDebugTokenHash,
  sha256(appCheckDebugToken),
  "The capture binding is not bound to the registered App Check debug token.",
);
assert.equal(
  fixtureAudit.captureBinding?.verifiedAppIdHash,
  sha256(STAGING_APP_ID),
  "The capture binding is not bound to the dedicated staging Firebase app.",
);
for (const [field, expectedHash] of Object.entries({
  verifiedProjectIdHash: sha256(contract.firebaseProjectId),
  verifiedProjectNumberHash: sha256(STAGING_PROJECT_NUMBER),
  verifiedAudienceSetHash: sha256(
    canonicalJson(FIXTURE_APP_CHECK_VERIFIED_AUDIENCE_SET),
  ),
  verifiedIssuerHash: sha256(
    `https://firebaseappcheck.googleapis.com/${STAGING_PROJECT_NUMBER}`,
  ),
  exchangeEndpointHash: sha256(FIXTURE_APP_CHECK_EXCHANGE_ENDPOINT),
  exchangeTransportContractHash: sha256(
    canonicalJson(FIXTURE_APP_CHECK_EXCHANGE_TRANSPORT_CONTRACT),
  ),
})) {
  assert.equal(
    fixtureAudit.captureBinding?.[field],
    expectedHash,
    `The capture binding ${field} is invalid.`,
  );
}
const postBackupProbeLifecycle =
  fixtureAudit.isolation?.postBackupProbeLifecycle;
assert.deepEqual(Object.keys(postBackupProbeLifecycle || {}).sort(), [
  "absentCanaryPathHash",
  "artifactResidualCount",
  "attestationHash",
  "existingCanaryPathHash",
  "revisionHash",
  "state",
]);
assert.deepEqual(postBackupProbeLifecycle, {
  state: "VERIFIED_CLEAN",
  revisionHash: sha256(
    `${contract.fixtureId}\n${contract.fixtureRevision}\npost-backup-access-probe-v1`,
  ),
  existingCanaryPathHash: sha256(postExistingCanary.path),
  absentCanaryPathHash: sha256(postAbsentCanary.path),
  attestationHash: backupNamespaceAccessAttestationHash,
  artifactResidualCount: 0,
});
assert.equal(
  sha256(Buffer.from(canonicalJson(postBackupProbeLifecycle))),
  fixtureAudit.isolation?.postBackupProbeLifecycleHash,
);
assert.equal(
  fixtureAudit.captureBinding?.postBackupProbeLifecycleHash,
  fixtureAudit.isolation?.postBackupProbeLifecycleHash,
  "The capture binding is not bound to the post-backup probe lifecycle.",
);
for (const field of [
  "productionAccess",
  "rawCredentialOutputCount",
  "rawPiiOutputCount",
  "extraRowCount",
]) {
  assert.equal(fixtureAudit[field], 0, `fixture audit ${field} must be zero.`);
}
assert.equal(fixtureAudit.authRoleCount, 3);
assert.deepEqual(
  fixtureAudit.authRoles.map((row) => row.role),
  ["student", "teacher", "admin"],
);
assert.equal(
  fixtureAudit.authFixtureIdentityScope?.scopeKind,
  "fixture-auth-identities",
);
assert.equal(
  fixtureAudit.authFixtureIdentityScope?.scopeBoundary,
  "fixed-uid-and-email-pairs-only",
);
assert.equal(
  fixtureAudit.authFixtureIdentityScope?.tenantWideEnumerationPerformed,
  false,
);
assert.equal(
  fixtureAudit.authFixtureIdentityScope?.nonFixtureTenantUsersInScope,
  false,
);
assert.equal(fixtureAudit.authFixtureIdentityScope?.scopedIdentityCount, 3);
assert.equal(
  fixtureAudit.authFixtureIdentityScope?.expectedPresentIdentityCount,
  3,
);
assert.equal(
  fixtureAudit.authFixtureIdentityScope?.actualPresentIdentityCount,
  3,
);
assert.equal(fixtureAudit.authFixtureIdentityScope?.uidLookupCount, 3);
assert.equal(fixtureAudit.authFixtureIdentityScope?.emailLookupCount, 3);
assert.equal(
  fixtureAudit.authFixtureIdentityScope?.uidExpectationMatchCount,
  3,
);
assert.equal(
  fixtureAudit.authFixtureIdentityScope?.emailExpectationMatchCount,
  3,
);
assert.equal(fixtureAudit.authFixtureIdentityScope?.customClaimMatchCount, 3);
assert.equal(
  fixtureAudit.authFixtureIdentityScope?.missingScopedIdentityCount,
  0,
);
assert.equal(
  fixtureAudit.authFixtureIdentityScope?.mismatchedScopedIdentityCount,
  0,
);
assert.equal(
  fixtureAudit.captureBinding?.authFixtureIdentityScopeManifestHash,
  fixtureAudit.authFixtureIdentityScope?.manifestHash,
);
const {
  manifestHash: authFixtureIdentityScopeManifestHash,
  ...authFixtureIdentityScopeAttestation
} = fixtureAudit.authFixtureIdentityScope;
assert.equal(
  sha256(Buffer.from(canonicalJson(authFixtureIdentityScopeAttestation))),
  authFixtureIdentityScopeManifestHash,
  "The scoped fixture Auth identity attestation hash is invalid.",
);
assert.deepEqual(
  fixtureAudit.authFixtureIdentityScope.identities.map(
    ({ role, uidHash, emailHash }) => ({ role, uidHash, emailHash }),
  ),
  fixtureAudit.authRoles,
);
assert.equal(
  fixtureAudit.authFixtureIdentityScope.identities.every(
    (row) =>
      row.expectedPresent === true &&
      row.actualPresent === true &&
      row.uidExpectationMatched === true &&
      row.emailExpectationMatched === true &&
      row.customClaimsMatched === true,
  ),
  true,
);
assert.equal(fixtureAudit.strict?.collectionCount, 63);
assert.equal(fixtureAudit.strict?.expectedRowCount, 51);
assert.equal(fixtureAudit.strict?.actualRowCount, 51);
assert.equal(fixtureAudit.strict?.extraRowCount, 0);
assert.equal(
  fixtureAudit.strict?.collections?.every(
    (row) =>
      row.expectedRowCount === row.actualRowCount &&
      row.expectedIdSetHash === row.actualIdSetHash &&
      row.extraRowCount === 0,
  ),
  true,
);
assert.equal(fixtureAudit.presentation?.unexpectedPersonRowCount, 0);
assert.equal(fixtureAudit.privacy?.forbiddenPatternCount, 0);
assert.equal(fixtureAudit.captureBinding?.extraRowCount, 0);
assert.equal(
  fixtureAudit.captureBinding?.presentationAttestationHash,
  fixtureAudit.presentation?.attestationHash,
);
assert.equal(
  fixtureAudit.captureBinding?.privacyAttestationHash,
  fixtureAudit.privacyAttestationHash,
);
const { issuedAt: fixtureAuditIssuedAt, expiresAt: fixtureAuditExpiresAt } =
  assertFixtureAuditFreshnessBinding({
    freshness: fixtureAudit.freshness,
    captureBindingFreshness: fixtureAudit.captureBinding?.freshness,
    expectedFixedTime: contract.fixedTime,
  });
assert.ok(fixtureAuditIssuedAt <= Date.now() + 30_000);
assert.ok(fixtureAuditExpiresAt > Date.now());
const runnerScriptPath = contract.captureRunner.scriptPath;
assert.equal(
  git("rev-parse", "HEAD"),
  sourceCommitSha,
  "Visual capture must run from the deployed candidate commit.",
);
assert.equal(
  realpathSync(resolve(process.argv[1])),
  realpathSync(resolve(runnerScriptPath)),
  "Visual capture must execute the contract-bound runner entrypoint.",
);
const trustedInputPaths = [
  runnerScriptPath,
  "scripts/w10p-visual-parity-contract.json",
  "scripts/w10p-route-menu-inventory.json",
  "scripts/seed-w10p-visual-fixture.mjs",
  "firestore.rules",
  "package.json",
  "package-lock.json",
];
const trustedInputs = Object.fromEntries(
  trustedInputPaths.map((path) => {
    const runtimeBytes = readFileSync(resolve(path));
    const committedBlobSha = git("rev-parse", `${sourceCommitSha}:${path}`);
    const workingBlobSha = git("hash-object", "--path", path, path);
    assert.equal(
      workingBlobSha,
      committedBlobSha,
      `Trusted visual input differs from the candidate commit: ${path}.`,
    );
    return [
      path,
      {
        gitBlobSha: committedBlobSha,
        runtimeSha256: sha256(runtimeBytes),
      },
    ];
  }),
);
const runnerCommittedBlobSha = trustedInputs[runnerScriptPath].gitBlobSha;
const runnerRuntimeSha256 = trustedInputs[runnerScriptPath].runtimeSha256;
const runnerSourceText = readFileSync(resolve(runnerScriptPath), "utf8");
const playwrightRouteRegistrationCount = (
  runnerSourceText.match(/\.(?:route|unroute)\s*\(/gu) || []
).length;
const browserGlobalExtraHttpHeaderRegistrationCount = (
  runnerSourceText.match(/\bextraHTTPHeaders\s*:/gu) || []
).length;
const pageAppCheckSecretInitRegistrationCount = (
  runnerSourceText.match(
    /\bpage\.addInitScript\(\s*appCheckDebugInitScript\s*,\s*appCheckDebugInitArgument\s*,?\s*\)/gu,
  ) || []
).length;
const pageAppCheckSentinelInitArgumentSourceCount = (
  runnerSourceText.match(
    /\bconst\s+appCheckDebugInitArgument\s*=\s*\{\s*allowedOrigin:\s*origin,\s*debugToken:\s*APP_CHECK_DEBUG_SENTINEL,\s*\};/gu,
  ) || []
).length;
const contextAppCheckSecretInitRegistrationCount = (
  runnerSourceText.match(
    /\bcontext\.addInitScript\(appCheckDebugInitScript\s*,/gu,
  ) || []
).length;
assert.equal(
  playwrightRouteRegistrationCount,
  0,
  "Playwright route interception must not be combined with the CDP App Check bridge.",
);
assert.equal(
  browserGlobalExtraHttpHeaderRegistrationCount,
  0,
  "Browser-global HTTP headers must not carry deployment secrets.",
);
assert.equal(pageAppCheckSecretInitRegistrationCount, 1);
assert.equal(pageAppCheckSentinelInitArgumentSourceCount, 1);
assert.equal(contextAppCheckSecretInitRegistrationCount, 0);
const trustedInputsSha256 = sha256(Buffer.from(JSON.stringify(trustedInputs)));
const viewportKey = ({ width, height }) => `${width}x${height}`;
const captureKey = (stage, screenId, viewport) =>
  `${stage}:${screenId}:${viewportKey(viewport)}`;
const comparisonKey = (screenId, viewport) =>
  `${screenId}:${viewportKey(viewport)}`;
const normalizeOrigin = (value) => new URL(value).origin;
const screenIdForRoute = (route) => {
  if (route === "/") return "login";
  if (route === "*") return "not-found";
  return route
    .split("?")[0]
    .replace(/^\//u, "")
    .replace(/:([a-z])([A-Z])/gu, "$1-$2")
    .replace(/:/gu, "")
    .replace(/\*/gu, "wildcard")
    .replace(/\//gu, "-")
    .toLowerCase();
};

const productionPatterns = new Set(contract.productionRoutePatterns);
const screens = inventory.routes
  .filter((route) => route.role !== "alias")
  .map((route) => ({
    id: screenIdForRoute(route.path),
    role: route.role,
    route: route.path,
    captureRoute: contract.captureOverrides[route.path] ?? route.path,
    productionPresentation: productionPatterns.has(route.path),
  }))
  .concat(
    contract.queryVariants.map((variant) => ({
      ...variant,
      captureRoute: variant.route,
    })),
  );
assert.equal(screens.length, 69);
const screensById = new Map(screens.map((screen) => [screen.id, screen]));
const minimumViewports = new Set(contract.minimumViewportKeys);
const keyScreens = new Set(contract.keyScreenIds);
const viewportsForScreen = (screenId) =>
  contract.viewports.filter(
    (viewport) =>
      keyScreens.has(screenId) || minimumViewports.has(viewportKey(viewport)),
  );

const candidateTargets = [];
const baselineTargetsByKey = new Map();
for (const screen of screens) {
  for (const viewport of viewportsForScreen(screen.id)) {
    const candidatePrimitiveRequirements = screen.productionPresentation
      ? []
      : contract.newSurfaceRequiredPrimitives[screen.id].map((requirement) => ({
          id: requirement.id,
          selector: requirement.selector,
          tagPattern: requirement.tagPattern,
          exactCount: requirement.exactCount,
        }));
    candidateTargets.push({
      stage: "candidate",
      screen,
      viewport,
      primitiveRequirements: candidatePrimitiveRequirements,
    });
    const baselineId = screen.productionPresentation
      ? screen.id
      : contract.newSurfaceReferences[screen.id];
    const baselineScreen = screensById.get(baselineId);
    assert.ok(baselineScreen?.productionPresentation);
    const baselineKey = captureKey("baseline", baselineId, viewport);
    const baselineTarget = baselineTargetsByKey.get(baselineKey) || {
      stage: "baseline",
      screen: baselineScreen,
      viewport,
      primitiveRequirements: [],
    };
    if (!screen.productionPresentation) {
      for (const requirement of contract.newSurfaceRequiredPrimitives[
        screen.id
      ]) {
        baselineTarget.primitiveRequirements.push({
          id: `${screen.id}:${requirement.id}`,
          selector: requirement.referenceSelector,
          tagPattern: requirement.referenceTagPattern,
          exactCount: requirement.referenceExactCount,
        });
      }
    }
    baselineTargetsByKey.set(baselineKey, baselineTarget);
  }
}
const targets = [...baselineTargetsByKey.values(), ...candidateTargets].sort(
  (left, right) =>
    captureKey(left.stage, left.screen.id, left.viewport).localeCompare(
      captureKey(right.stage, right.screen.id, right.viewport),
    ),
);

mkdirSync(outputRoot, { recursive: true });
mkdirSync(resolve(outputRoot, "baseline"));
mkdirSync(resolve(outputRoot, "candidate"));
mkdirSync(resolve(outputRoot, "browser-audits"));
const fixtureAuditFileName = "fixture-audit.json";
const fixtureAuditEvidencePath = resolve(outputRoot, fixtureAuditFileName);
writeFileSync(fixtureAuditEvidencePath, fixtureAuditBytes);
assert.equal(
  sha256(readFileSync(fixtureAuditEvidencePath)),
  fixtureAuditSha256,
  "The copied fixture audit differs from its fresh input.",
);

const styleProperties = contract.layoutDiff.computedStyleProperties;
const describePage = async (
  page,
  anchorRequirements = [],
  readyRequirements = [],
  primitiveRequirements = [],
  fixtureRequirements = null,
) =>
  page.evaluate(
    async ({
      styleProperties,
      anchorRequirements,
      readyRequirements,
      primitiveRequirements,
      fixtureRequirements,
      privacyContract,
    }) => {
      const cssEscape = (value) => {
        if (globalThis.CSS?.escape) return globalThis.CSS.escape(value);
        return value.replace(
          /[^a-zA-Z0-9_-]/gu,
          (character) => `\\${character.codePointAt(0).toString(16)} `,
        );
      };
      const selectorFor = (element) => {
        if (!(element instanceof Element)) return "";
        if (element.id) return `#${cssEscape(element.id)}`;
        const parts = [];
        let current = element;
        while (current && current !== document.documentElement) {
          const parent = current.parentElement;
          if (!parent) break;
          const tag = current.tagName.toLowerCase();
          const siblings = [...parent.children].filter(
            (sibling) => sibling.tagName === current.tagName,
          );
          const index = siblings.indexOf(current) + 1;
          parts.unshift(`${tag}:nth-of-type(${index})`);
          current = parent;
          if (current.id) {
            parts.unshift(`#${cssEscape(current.id)}`);
            break;
          }
        }
        return parts.join(" > ");
      };
      let pointerlessPositionedOverlaysCache = null;
      let blockingPseudoOverlaysCache = null;
      const positionedOverlayPositions = new Set([
        "absolute",
        "fixed",
        "sticky",
      ]);
      const pointerlessPositionedOverlays = () => {
        if (pointerlessPositionedOverlaysCache) {
          return pointerlessPositionedOverlaysCache;
        }
        pointerlessPositionedOverlaysCache = [
          ...document.body.querySelectorAll("*"),
        ].filter((candidate) => {
          const style = getComputedStyle(candidate);
          return (
            positionedOverlayPositions.has(style.position) &&
            style.pointerEvents === "none"
          );
        });
        return pointerlessPositionedOverlaysCache;
      };
      const blockingPseudoOverlays = () => {
        if (blockingPseudoOverlaysCache !== null) {
          return blockingPseudoOverlaysCache;
        }
        blockingPseudoOverlaysCache = [
          document.documentElement,
          document.body,
          ...document.body.querySelectorAll("*"),
        ].flatMap((candidate) =>
          ["::before", "::after"].flatMap((pseudo) => {
            const style = getComputedStyle(candidate, pseudo);
            const content = String(style.content || "").trim();
            if (
              !positionedOverlayPositions.has(style.position) ||
              ["", "none", "normal"].includes(content)
            ) {
              return [];
            }
            const insetCoversHost = [
              style.top,
              style.right,
              style.bottom,
              style.left,
            ].every((value) => {
              const parsed = Number.parseFloat(value || "0");
              return Number.isFinite(parsed) && Math.abs(parsed) <= 1;
            });
            const opacity = Number.parseFloat(style.opacity || "1");
            const paintAlpha =
              (Number.isFinite(opacity) ? opacity : 1) *
              colorAlpha(style.backgroundColor);
            const zIndex = Number.parseInt(style.zIndex || "0", 10);
            const visiblyPainted =
              paintAlpha >= 0.5 ||
              ((Number.isFinite(opacity) ? opacity : 1) >= 0.5 &&
                style.backgroundImage &&
                style.backgroundImage !== "none");
            if (
              !insetCoversHost ||
              !visiblyPainted ||
              !Number.isFinite(zIndex) ||
              zIndex < 100
            ) {
              return [];
            }
            return [
              { host: candidate, pseudo, position: style.position, zIndex },
            ];
          }),
        );
        return blockingPseudoOverlaysCache;
      };
      const visibilityFor = (element) => {
        if (!(element instanceof Element)) {
          return {
            visible: false,
            areaRatio: 0,
            effectiveOpacity: 0,
            paintVisibilityRatio: 0,
            box: { x: 0, y: 0, width: 0, height: 0 },
          };
        }
        const own = element.getBoundingClientRect();
        if (own.width <= 0 || own.height <= 0) {
          return {
            visible: false,
            areaRatio: 0,
            effectiveOpacity: 0,
            paintVisibilityRatio: 0,
            box: { x: own.x, y: own.y, width: 0, height: 0 },
          };
        }
        if (
          typeof element.checkVisibility === "function" &&
          !element.checkVisibility({
            checkOpacity: true,
            checkVisibilityCSS: true,
          })
        ) {
          return {
            visible: false,
            areaRatio: 0,
            effectiveOpacity: 0,
            paintVisibilityRatio: 0,
            box: { x: own.x, y: own.y, width: 0, height: 0 },
          };
        }
        let left = Math.max(0, own.left);
        let right = Math.min(window.innerWidth, own.right);
        let top = Math.max(-window.scrollY, own.top);
        let bottom = Math.min(
          document.documentElement.scrollHeight - window.scrollY,
          own.bottom,
        );
        let current = element;
        let effectiveOpacity = 1;
        while (current instanceof Element) {
          const style = getComputedStyle(current);
          const opacity = Number.parseFloat(style.opacity || "1");
          effectiveOpacity *= Number.isFinite(opacity) ? opacity : 1;
          if (
            style.display === "none" ||
            style.visibility === "hidden" ||
            style.visibility === "collapse" ||
            effectiveOpacity < 0.9 ||
            (style.clipPath && style.clipPath !== "none")
          ) {
            return {
              visible: false,
              areaRatio: 0,
              effectiveOpacity,
              paintVisibilityRatio: 0,
              box: { x: own.x, y: own.y, width: 0, height: 0 },
            };
          }
          if (current !== element) {
            const clipBox = current.getBoundingClientRect();
            if (
              ["auto", "clip", "hidden", "scroll"].includes(style.overflowX)
            ) {
              left = Math.max(left, clipBox.left);
              right = Math.min(right, clipBox.right);
            }
            if (
              ["auto", "clip", "hidden", "scroll"].includes(style.overflowY)
            ) {
              top = Math.max(top, clipBox.top);
              bottom = Math.min(bottom, clipBox.bottom);
            }
          }
          current = current.parentElement;
        }
        const width = Math.max(0, right - left);
        const height = Math.max(0, bottom - top);
        const areaRatio = (width * height) / (own.width * own.height);
        const sampleIsPaintVisible = ([x, y]) => {
          const stack = document.elementsFromPoint(x, y);
          const targetIndex = stack.findIndex(
            (candidate) => candidate === element || element.contains(candidate),
          );
          if (targetIndex < 0) return false;
          const positionedDescendantOccludes = stack
            .slice(0, targetIndex + 1)
            .some((candidate) => {
              if (candidate === element || !element.contains(candidate)) {
                return false;
              }
              const style = getComputedStyle(candidate);
              if (!positionedOverlayPositions.has(style.position)) {
                return false;
              }
              const opacity = Number.parseFloat(style.opacity || "1");
              const paintAlpha =
                (Number.isFinite(opacity) ? opacity : 1) *
                colorAlpha(style.backgroundColor);
              return (
                paintAlpha >= 0.5 ||
                ((Number.isFinite(opacity) ? opacity : 1) >= 0.5 &&
                  style.backgroundImage &&
                  style.backgroundImage !== "none")
              );
            });
          if (positionedDescendantOccludes) return false;
          const stackOccludes = stack
            .slice(0, targetIndex)
            .some((candidate) => {
              if (element.contains(candidate)) return false;
              const style = getComputedStyle(candidate);
              const opacity = Number.parseFloat(style.opacity || "1");
              const effectivePaintAlpha =
                (Number.isFinite(opacity) ? opacity : 1) *
                colorAlpha(style.backgroundColor);
              return (
                effectivePaintAlpha >= 0.5 ||
                ((Number.isFinite(opacity) ? opacity : 1) >= 0.5 &&
                  style.backgroundImage &&
                  style.backgroundImage !== "none")
              );
            });
          if (stackOccludes) return false;
          const targetZIndex = Number.parseInt(
            getComputedStyle(element).zIndex || "0",
            10,
          );
          const pointerlessPositionedOverlay =
            pointerlessPositionedOverlays().some((candidate) => {
              if (candidate === element || candidate.contains(element)) {
                return false;
              }
              const style = getComputedStyle(candidate);
              if (
                !positionedOverlayPositions.has(style.position) ||
                style.pointerEvents !== "none"
              ) {
                return false;
              }
              const box = candidate.getBoundingClientRect();
              if (
                x < box.left ||
                x > box.right ||
                y < box.top ||
                y > box.bottom
              ) {
                return false;
              }
              const opacity = Number.parseFloat(style.opacity || "1");
              const zIndex = Number.parseInt(style.zIndex || "0", 10);
              const paintAlpha =
                (Number.isFinite(opacity) ? opacity : 1) *
                colorAlpha(style.backgroundColor);
              return (
                (Number.isFinite(zIndex) ? zIndex : 0) >=
                  (Number.isFinite(targetZIndex) ? targetZIndex : 0) &&
                (paintAlpha >= 0.5 ||
                  ((Number.isFinite(opacity) ? opacity : 1) >= 0.5 &&
                    style.backgroundImage &&
                    style.backgroundImage !== "none"))
              );
            });
          if (pointerlessPositionedOverlay) return false;
          const pseudoOverlay = blockingPseudoOverlays().some((overlay) => {
            const box =
              overlay.position === "fixed"
                ? {
                    left: 0,
                    top: 0,
                    right: window.innerWidth,
                    bottom: window.innerHeight,
                  }
                : overlay.host.getBoundingClientRect();
            if (
              x < box.left ||
              x > box.right ||
              y < box.top ||
              y > box.bottom
            ) {
              return false;
            }
            return (
              overlay.zIndex >=
              (Number.isFinite(targetZIndex) ? targetZIndex : 0)
            );
          });
          return !pseudoOverlay;
        };
        const hitTest = () => {
          const box = element.getBoundingClientRect();
          const sampleLeft = Math.max(0, box.left);
          const sampleRight = Math.min(window.innerWidth, box.right);
          const sampleTop = Math.max(0, box.top);
          const sampleBottom = Math.min(window.innerHeight, box.bottom);
          const sampleWidth = Math.max(0, sampleRight - sampleLeft);
          const sampleHeight = Math.max(0, sampleBottom - sampleTop);
          if (sampleWidth <= 0 || sampleHeight <= 0) return 0;
          const insetX = Math.min(2, sampleWidth / 4);
          const insetY = Math.min(2, sampleHeight / 4);
          const samplePoints = [
            [sampleLeft + sampleWidth / 2, sampleTop + sampleHeight / 2],
            [sampleLeft + insetX, sampleTop + insetY],
            [sampleRight - insetX, sampleTop + insetY],
            [sampleLeft + insetX, sampleBottom - insetY],
            [sampleRight - insetX, sampleBottom - insetY],
          ];
          return (
            samplePoints.filter(sampleIsPaintVisible).length /
            samplePoints.length
          );
        };
        const savedScroll = { x: window.scrollX, y: window.scrollY };
        let paintVisibilityRatio = hitTest();
        if (paintVisibilityRatio === 0 && areaRatio >= 0.9) {
          const documentTop = own.top + savedScroll.y;
          const targetScrollY = Math.max(
            0,
            Math.min(
              document.documentElement.scrollHeight - window.innerHeight,
              documentTop - Math.max(16, (window.innerHeight - own.height) / 2),
            ),
          );
          window.scrollTo(savedScroll.x, targetScrollY);
          paintVisibilityRatio = hitTest();
          window.scrollTo(savedScroll.x, savedScroll.y);
        }
        return {
          visible:
            areaRatio >= 0.9 &&
            effectiveOpacity >= 0.9 &&
            paintVisibilityRatio >= 0.6,
          areaRatio,
          effectiveOpacity,
          paintVisibilityRatio,
          box: { x: left, y: top, width, height },
        };
      };
      const colorAlpha = (value) => {
        const normalized = String(value || "")
          .trim()
          .toLowerCase();
        if (!normalized || normalized === "transparent") return 0;
        const rgba = normalized.match(
          /^rgba\([^,]+,[^,]+,[^,]+,\s*([0-9.]+)\)$/u,
        );
        if (rgba) return Number.parseFloat(rgba[1]);
        const modern = normalized.match(/\/\s*([0-9.]+)(%)?\s*\)$/u);
        if (!modern) return 1;
        const parsed = Number.parseFloat(modern[1]);
        return modern[2] ? parsed / 100 : parsed;
      };
      const colorRgb = (value) => {
        const normalized = String(value || "")
          .trim()
          .toLowerCase();
        const srgb = normalized.match(
          /^color\(srgb\s+([-+]?[0-9.]+)\s+([-+]?[0-9.]+)\s+([-+]?[0-9.]+)/u,
        );
        if (srgb) {
          return srgb
            .slice(1, 4)
            .map((component) =>
              Math.max(0, Math.min(255, Number(component) * 255)),
            );
        }
        if (normalized.startsWith("color(")) return null;
        const rgb = normalized.match(/^rgba?\(([^)]*)\)$/u);
        if (!rgb) return null;
        const channelPart = rgb[1].split("/")[0];
        const channels = channelPart
          .trim()
          .split(/[\s,]+/u)
          .filter(Boolean)
          .slice(0, 3);
        if (channels.length !== 3) return null;
        const components = channels.map((channel) => {
          const percentage = channel.endsWith("%");
          const parsed = Number.parseFloat(channel);
          if (!Number.isFinite(parsed)) return Number.NaN;
          const component = percentage ? (parsed / 100) * 255 : parsed;
          return Math.max(0, Math.min(255, component));
        });
        return components.every(Number.isFinite) ? components : null;
      };
      const luminance = (rgb) => {
        const linear = rgb.map((component) => {
          const channel = component / 255;
          return channel <= 0.03928
            ? channel / 12.92
            : ((channel + 0.055) / 1.055) ** 2.4;
        });
        return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
      };
      const contrastRatio = (foreground, background) => {
        const foregroundLuminance = luminance(foreground);
        const backgroundLuminance = luminance(background);
        return (
          (Math.max(foregroundLuminance, backgroundLuminance) + 0.05) /
          (Math.min(foregroundLuminance, backgroundLuminance) + 0.05)
        );
      };
      const compositeRgb = (foreground, background, alpha) =>
        foreground.map(
          (component, index) =>
            component * alpha + background[index] * (1 - alpha),
        );
      const splitCssLayers = (value) => {
        const layers = [];
        let depth = 0;
        let start = 0;
        for (let index = 0; index < value.length; index += 1) {
          if (value[index] === "(") depth += 1;
          if (value[index] === ")") depth -= 1;
          if (value[index] === "," && depth === 0) {
            layers.push(value.slice(start, index).trim());
            start = index + 1;
          }
        }
        layers.push(value.slice(start).trim());
        return layers.filter(Boolean);
      };
      const gradientStopsFor = (value) => {
        if (
          !/^(?:repeating-)?(?:linear|radial|conic)-gradient\(/u.test(value) ||
          /url\(/u.test(value)
        ) {
          return null;
        }
        const colors = [...value.matchAll(/rgba?\([^)]*\)/gu)]
          .map((match) => ({
            rgb: colorRgb(match[0]),
            alpha: colorAlpha(match[0]),
          }))
          .filter((color) => color.rgb);
        return colors.length >= 2 ? colors : null;
      };
      const compositeCandidates = (backgrounds, overlays) => {
        const unique = new Map();
        for (const background of backgrounds) {
          for (const overlay of overlays) {
            const rgb = compositeRgb(overlay.rgb, background, overlay.alpha);
            const key = rgb.map((value) => value.toFixed(2)).join(":");
            unique.set(key, rgb);
            if (unique.size > 512) return null;
          }
        }
        return [...unique.values()];
      };
      const resolvedBackgroundFor = (element) => {
        const ancestry = [];
        let unresolvedImage = false;
        let current = element;
        while (current instanceof Element) {
          ancestry.push(current);
          current = current.parentElement;
        }
        let rgbCandidates = [[255, 255, 255]];
        for (const layerElement of ancestry.reverse()) {
          const style = getComputedStyle(layerElement);
          const solidRgb = colorRgb(style.backgroundColor);
          const solidAlpha = colorAlpha(style.backgroundColor);
          if (solidRgb && solidAlpha > 0) {
            const composited = compositeCandidates(rgbCandidates, [
              { rgb: solidRgb, alpha: solidAlpha },
            ]);
            if (!composited) unresolvedImage = true;
            else rgbCandidates = composited;
          }
          if (style.backgroundImage && style.backgroundImage !== "none") {
            const imageLayers = splitCssLayers(style.backgroundImage);
            for (const imageLayer of imageLayers.reverse()) {
              const stops = gradientStopsFor(imageLayer);
              if (!stops) {
                unresolvedImage = true;
                continue;
              }
              const composited = compositeCandidates(rgbCandidates, stops);
              if (!composited) unresolvedImage = true;
              else rgbCandidates = composited;
            }
          }
        }
        if (element instanceof SVGTextElement) {
          const svgStops = [];
          const svg = element.closest("svg");
          for (const stop of svg?.querySelectorAll("defs stop") ?? []) {
            const stopStyle = getComputedStyle(stop);
            const stopColor =
              stopStyle.stopColor || stop.getAttribute("stop-color");
            const stopOpacity = Number.parseFloat(
              stopStyle.stopOpacity || stop.getAttribute("stop-opacity") || "1",
            );
            const rgb = colorRgb(stopColor);
            const alpha =
              colorAlpha(stopColor) *
              (Number.isFinite(stopOpacity) ? stopOpacity : 1);
            if (rgb) svgStops.push({ rgb, alpha });
          }
          if (svgStops.length > 0) {
            const composited = compositeCandidates(rgbCandidates, svgStops);
            if (!composited) unresolvedImage = true;
            else rgbCandidates = composited;
          }
        }
        return { rgbCandidates, resolved: !unresolvedImage };
      };
      const paintEffectsSafeFor = (element) => {
        let current = element;
        while (current instanceof Element) {
          const style = getComputedStyle(current);
          const filter = String(style.filter || "none").toLowerCase();
          const maskImage = String(
            style.maskImage || style.webkitMaskImage || "none",
          ).toLowerCase();
          const blendMode = String(
            style.mixBlendMode || "normal",
          ).toLowerCase();
          if (
            /(?:opacity|blur|brightness|contrast)\(/u.test(filter) ||
            maskImage !== "none" ||
            blendMode !== "normal"
          ) {
            return false;
          }
          current = current.parentElement;
        }
        return true;
      };
      const glyphVisibleRatioFor = (element) => {
        if (!(element instanceof Element)) return 0;
        const own = element.getBoundingClientRect();
        if (own.width <= 0 || own.height <= 0) return 0;
        const style = getComputedStyle(element);
        const textIndent = Number.parseFloat(style.textIndent || "0");
        if (
          Number.isFinite(textIndent) &&
          Math.abs(textIndent) >= Math.max(8, own.width)
        ) {
          return 0;
        }
        if (
          element instanceof HTMLInputElement ||
          element instanceof HTMLTextAreaElement ||
          element instanceof HTMLSelectElement
        ) {
          return String(element.value || "").trim() ||
            (element instanceof HTMLSelectElement &&
              element.selectedOptions.length > 0)
            ? 1
            : 0;
        }
        const directTextNodes = [...element.childNodes].filter(
          (node) =>
            node.nodeType === Node.TEXT_NODE &&
            String(node.textContent || "").trim().length > 0,
        );
        if (directTextNodes.length === 0) return 0;
        const clipRectFor = (rect) => {
          let left = Math.max(rect.left, own.left);
          let right = Math.min(rect.right, own.right);
          let top = Math.max(rect.top, own.top);
          let bottom = Math.min(rect.bottom, own.bottom);
          let current = element;
          while (current instanceof Element) {
            const currentStyle = getComputedStyle(current);
            const currentBox = current.getBoundingClientRect();
            if (
              ["auto", "clip", "hidden", "scroll"].includes(
                currentStyle.overflowX,
              )
            ) {
              left = Math.max(left, currentBox.left);
              right = Math.min(right, currentBox.right);
            }
            if (
              ["auto", "clip", "hidden", "scroll"].includes(
                currentStyle.overflowY,
              )
            ) {
              top = Math.max(top, currentBox.top);
              bottom = Math.min(bottom, currentBox.bottom);
            }
            current = current.parentElement;
          }
          return {
            visibleArea: Math.max(0, right - left) * Math.max(0, bottom - top),
            totalArea: Math.max(0, rect.width) * Math.max(0, rect.height),
          };
        };
        let visibleArea = 0;
        let totalArea = 0;
        for (const node of directTextNodes) {
          const range = document.createRange();
          range.selectNodeContents(node);
          let rects = [...range.getClientRects()];
          range.detach();
          if (rects.length === 0 && element instanceof SVGTextElement) {
            rects = [own];
          }
          for (const rect of rects) {
            const clipped = clipRectFor(rect);
            visibleArea += clipped.visibleArea;
            totalArea += clipped.totalArea;
          }
        }
        return totalArea > 0 ? Math.min(1, visibleArea / totalArea) : 0;
      };
      const textPaintFor = (
        element,
        minimumContrastRatio = null,
        minimumGlyphVisibleRatio = 0.6,
      ) => {
        if (!(element instanceof Element)) {
          return {
            painted: false,
            fontSizePx: 0,
            foregroundAlpha: 0,
            contrastRatio: 0,
            glyphVisibleRatio: 0,
            effectsSafe: false,
          };
        }
        const style = getComputedStyle(element);
        const fontSizePx = Number.parseFloat(style.fontSize || "0");
        const fontWeight = Number.parseFloat(style.fontWeight || "400");
        const requiredContrastRatio = Number.isFinite(minimumContrastRatio)
          ? minimumContrastRatio
          : fontSizePx >= 24 ||
              (fontSizePx >= 18.66 &&
                Number.isFinite(fontWeight) &&
                fontWeight >= 700)
            ? 3
            : 4.5;
        const foregroundColor =
          element instanceof SVGTextElement
            ? style.fill
            : style.webkitTextFillColor || style.color;
        const foregroundAlpha = Math.min(
          colorAlpha(foregroundColor),
          element instanceof SVGTextElement
            ? Number.parseFloat(style.fillOpacity || "1")
            : colorAlpha(style.color),
        );
        const foregroundRgb = colorRgb(foregroundColor);
        const background = resolvedBackgroundFor(element);
        const measuredContrast =
          foregroundRgb && background.resolved
            ? Math.min(
                ...background.rgbCandidates.map((backgroundRgb) =>
                  contrastRatio(
                    compositeRgb(foregroundRgb, backgroundRgb, foregroundAlpha),
                    backgroundRgb,
                  ),
                ),
              )
            : 0;
        const glyphVisibleRatio = glyphVisibleRatioFor(element);
        const effectsSafe = paintEffectsSafeFor(element);
        return {
          painted:
            Number.isFinite(fontSizePx) &&
            fontSizePx >= 8 &&
            foregroundAlpha >= 0.9 &&
            measuredContrast >= requiredContrastRatio &&
            glyphVisibleRatio >= minimumGlyphVisibleRatio &&
            effectsSafe,
          fontSizePx,
          foregroundAlpha,
          contrastRatio: measuredContrast,
          requiredContrastRatio,
          glyphVisibleRatio,
          effectsSafe,
        };
      };
      const canvasPaintFor = (element) => {
        if (!(element instanceof HTMLCanvasElement)) {
          return { painted: false, sampledOpaquePixels: 0, sampledColors: 0 };
        }
        try {
          const context = element.getContext("2d", {
            willReadFrequently: true,
          });
          if (!context || element.width <= 0 || element.height <= 0) {
            return { painted: false, sampledOpaquePixels: 0, sampledColors: 0 };
          }
          const pixels = context.getImageData(
            0,
            0,
            element.width,
            element.height,
          ).data;
          const pixelCount = element.width * element.height;
          const stride = Math.max(1, Math.floor(pixelCount / 8192));
          let sampledOpaquePixels = 0;
          const sampledColors = new Set();
          for (let index = 0; index < pixels.length; index += 4 * stride) {
            if (pixels[index + 3] < 64) continue;
            sampledOpaquePixels += 1;
            sampledColors.add(
              `${pixels[index]}:${pixels[index + 1]}:${pixels[index + 2]}:${pixels[index + 3]}`,
            );
            if (sampledColors.size > 32) break;
          }
          return {
            painted: sampledOpaquePixels >= 8 && sampledColors.size >= 2,
            sampledOpaquePixels,
            sampledColors: sampledColors.size,
          };
        } catch {
          return { painted: false, sampledOpaquePixels: 0, sampledColors: 0 };
        }
      };
      const describe = (
        element,
        { minimumContrastRatio = null, minimumGlyphVisibleRatio = 0.6 } = {},
      ) => {
        if (!(element instanceof Element)) return { present: false };
        const box = element.getBoundingClientRect();
        const computedStyle = getComputedStyle(element);
        const visibility = visibilityFor(element);
        const textPaint = textPaintFor(
          element,
          minimumContrastRatio,
          minimumGlyphVisibleRatio,
        );
        const canvasPaint = canvasPaintFor(element);
        return {
          present: true,
          selector: selectorFor(element),
          tagName: element.tagName,
          box: {
            x: box.x,
            y: box.y,
            width: box.width,
            height: box.height,
          },
          visibleAreaRatio: visibility.areaRatio,
          effectiveOpacity: visibility.effectiveOpacity,
          paintVisibilityRatio: visibility.paintVisibilityRatio,
          visibleBox: visibility.box,
          textPainted: textPaint.painted,
          textFontSizePx: textPaint.fontSizePx,
          textForegroundAlpha: textPaint.foregroundAlpha,
          textContrastRatio: textPaint.contrastRatio,
          textRequiredContrastRatio: textPaint.requiredContrastRatio,
          textGlyphVisibleRatio: textPaint.glyphVisibleRatio,
          textPaintEffectsSafe: textPaint.effectsSafe,
          canvasPainted: canvasPaint.painted,
          canvasSampledOpaquePixels: canvasPaint.sampledOpaquePixels,
          canvasSampledColors: canvasPaint.sampledColors,
          computed: Object.fromEntries(
            styleProperties.map((property) => [
              property,
              computedStyle[property] || "",
            ]),
          ),
        };
      };
      const contentRoot =
        document.querySelector("#main-content") ||
        document.querySelector("main") ||
        document.querySelector("#root > div") ||
        document.body;
      const firstVisible = (selector, root = document) =>
        [...root.querySelectorAll(selector)].find(
          (element) => visibilityFor(element).visible,
        ) || null;
      const isVisible = (element) => visibilityFor(element).visible;
      const isRendered = (element) => {
        if (!(element instanceof Element)) return false;
        const box = element.getBoundingClientRect();
        if (box.width <= 0 || box.height <= 0) return false;
        let current = element;
        let effectiveOpacity = 1;
        while (current instanceof Element) {
          const style = getComputedStyle(current);
          const opacity = Number.parseFloat(style.opacity || "1");
          effectiveOpacity *= Number.isFinite(opacity) ? opacity : 1;
          if (
            style.display === "none" ||
            style.visibility === "hidden" ||
            style.visibility === "collapse" ||
            effectiveOpacity < 0.9
          ) {
            return false;
          }
          current = current.parentElement;
        }
        return true;
      };
      const readableText = (element) => {
        if (element instanceof HTMLSelectElement) {
          return `${String(element.value || "")} ${[...element.selectedOptions]
            .map((option) => option.textContent || "")
            .join(" ")}`
            .replace(/\s+/gu, " ")
            .trim();
        }
        if (
          element instanceof HTMLInputElement ||
          element instanceof HTMLTextAreaElement
        ) {
          return String(element.value || "")
            .replace(/\s+/gu, " ")
            .trim();
        }
        return String(element.innerText || element.textContent || "")
          .replace(/\s+/gu, " ")
          .trim();
      };
      const directPaintText = (element) => {
        if (
          element instanceof HTMLSelectElement ||
          element instanceof HTMLInputElement ||
          element instanceof HTMLTextAreaElement
        ) {
          return readableText(element);
        }
        return [...element.childNodes]
          .filter((node) => node.nodeType === Node.TEXT_NODE)
          .map((node) => node.textContent || "")
          .join(" ")
          .replace(/\s+/gu, " ")
          .trim();
      };
      const paintWitnessFor = (
        container,
        pattern,
        {
          allowRendered = false,
          minimumContrastRatio = null,
          minimumGlyphVisibleRatio = 0.6,
        } = {},
      ) => {
        if (!(container instanceof Element)) return null;
        const candidates = [container, ...container.querySelectorAll("*")]
          .filter((element) => {
            const rendered = allowRendered
              ? isRendered(element)
              : isVisible(element);
            return (
              rendered &&
              pattern.test(directPaintText(element)) &&
              textPaintFor(
                element,
                minimumContrastRatio,
                minimumGlyphVisibleRatio,
              ).painted
            );
          })
          .sort((left, right) => {
            const leftBox = left.getBoundingClientRect();
            const rightBox = right.getBoundingClientRect();
            return (
              leftBox.width * leftBox.height - rightBox.width * rightBox.height
            );
          });
        return candidates[0] || null;
      };
      const elements = {
        header: describe(document.querySelector("#root > div > header")),
        content: describe(contentRoot),
        desktopNavigation: describe(firstVisible(".desktop-nav")),
        mobileNavigationTrigger: describe(firstVisible(".mobile-menu-btn")),
        table: describe(firstVisible("table", contentRoot)),
        firstTableRow: describe(firstVisible("table tr", contentRoot)),
        primaryButton: describe(firstVisible("button, a", contentRoot)),
      };
      const pickAnchor = (requirement) => {
        const pattern = requirement.textPattern
          ? new RegExp(requirement.textPattern, "u")
          : null;
        const selectors =
          requirement.selector ||
          (requirement.id === "heading"
            ? "h1, h2, h3"
            : requirement.id === "primary-action"
              ? "button, a"
              : "section, article, form, table, [role='status'], p, div");
        const candidates = [...contentRoot.querySelectorAll(selectors)].filter(
          (element) => {
            const text = readableText(element);
            const paintReady =
              requirement.paintMode === "canvas"
                ? canvasPaintFor(element).painted
                : !pattern ||
                  Boolean(
                    paintWitnessFor(element, pattern, {
                      minimumContrastRatio: requirement.minimumContrastRatio,
                      minimumGlyphVisibleRatio:
                        requirement.minimumGlyphVisibleRatio,
                    }),
                  );
            return (
              isVisible(element) &&
              paintReady &&
              (requirement.allowEmptyText || text.length > 0) &&
              (!pattern || pattern.test(text))
            );
          },
        );
        if (requirement.id === "content" || requirement.preferSmallest) {
          candidates.sort((left, right) => {
            const leftBox = left.getBoundingClientRect();
            const rightBox = right.getBoundingClientRect();
            return (
              leftBox.width * leftBox.height - rightBox.width * rightBox.height
            );
          });
        }
        return candidates[0] || null;
      };
      const anchorIds = ["heading", "content", "primary-action"];
      const requirementsById = new Map(
        anchorRequirements.map((requirement) => [requirement.id, requirement]),
      );
      const anchors = {};
      for (const id of anchorIds) {
        const requirement = requirementsById.get(id) || { id };
        const element = pickAnchor(requirement);
        if (!element) continue;
        const described = describe(element, {
          minimumContrastRatio: requirement.minimumContrastRatio,
          minimumGlyphVisibleRatio: requirement.minimumGlyphVisibleRatio,
        });
        const paintPattern = requirement.textPattern
          ? new RegExp(requirement.textPattern, "u")
          : null;
        const paintWitness = paintPattern
          ? paintWitnessFor(element, paintPattern, {
              minimumContrastRatio: requirement.minimumContrastRatio,
              minimumGlyphVisibleRatio: requirement.minimumGlyphVisibleRatio,
            })
          : element;
        const describedPaintWitness = describe(paintWitness, {
          minimumContrastRatio: requirement.minimumContrastRatio,
          minimumGlyphVisibleRatio: requirement.minimumGlyphVisibleRatio,
        });
        anchors[id] = {
          selector: described.selector,
          tagName: described.tagName,
          box: described.box,
          visibleAreaRatio: described.visibleAreaRatio,
          effectiveOpacity: described.effectiveOpacity,
          paintVisibilityRatio: described.paintVisibilityRatio,
          visibleBox: described.visibleBox,
          textPainted: described.textPainted,
          textFontSizePx: described.textFontSizePx,
          textForegroundAlpha: described.textForegroundAlpha,
          textContrastRatio: described.textContrastRatio,
          textRequiredContrastRatio: described.textRequiredContrastRatio,
          textGlyphVisibleRatio: described.textGlyphVisibleRatio,
          textPaintEffectsSafe: described.textPaintEffectsSafe,
          canvasPainted: described.canvasPainted,
          canvasSampledOpaquePixels: described.canvasSampledOpaquePixels,
          canvasSampledColors: described.canvasSampledColors,
          paintWitness: describedPaintWitness.present
            ? {
                selector: describedPaintWitness.selector,
                tagName: describedPaintWitness.tagName,
                effectiveOpacity: describedPaintWitness.effectiveOpacity,
                paintVisibilityRatio:
                  describedPaintWitness.paintVisibilityRatio,
                visibleAreaRatio: describedPaintWitness.visibleAreaRatio,
                textPainted: describedPaintWitness.textPainted,
                textFontSizePx: describedPaintWitness.textFontSizePx,
                textForegroundAlpha: describedPaintWitness.textForegroundAlpha,
                textContrastRatio: describedPaintWitness.textContrastRatio,
                textRequiredContrastRatio:
                  describedPaintWitness.textRequiredContrastRatio,
                textGlyphVisibleRatio:
                  describedPaintWitness.textGlyphVisibleRatio,
                textPaintEffectsSafe:
                  describedPaintWitness.textPaintEffectsSafe,
                text: directPaintText(paintWitness),
              }
            : null,
          computed: described.computed,
          text: readableText(element),
        };
      }
      const readySignals = {};
      for (const requirement of readyRequirements) {
        const element = pickAnchor({ ...requirement, preferSmallest: true });
        if (!element) continue;
        const described = describe(element, {
          minimumContrastRatio: requirement.minimumContrastRatio,
          minimumGlyphVisibleRatio: requirement.minimumGlyphVisibleRatio,
        });
        const paintPattern = new RegExp(requirement.textPattern, "u");
        const paintWitness =
          requirement.paintMode === "canvas"
            ? null
            : paintWitnessFor(element, paintPattern, {
                minimumContrastRatio: requirement.minimumContrastRatio,
                minimumGlyphVisibleRatio: requirement.minimumGlyphVisibleRatio,
              });
        const describedPaintWitness = describe(paintWitness, {
          minimumContrastRatio: requirement.minimumContrastRatio,
          minimumGlyphVisibleRatio: requirement.minimumGlyphVisibleRatio,
        });
        readySignals[requirement.id] = {
          selector: described.selector,
          tagName: described.tagName,
          box: described.box,
          visibleAreaRatio: described.visibleAreaRatio,
          effectiveOpacity: described.effectiveOpacity,
          paintVisibilityRatio: described.paintVisibilityRatio,
          visibleBox: described.visibleBox,
          textPainted: described.textPainted,
          textFontSizePx: described.textFontSizePx,
          textForegroundAlpha: described.textForegroundAlpha,
          textContrastRatio: described.textContrastRatio,
          textRequiredContrastRatio: described.textRequiredContrastRatio,
          textGlyphVisibleRatio: described.textGlyphVisibleRatio,
          textPaintEffectsSafe: described.textPaintEffectsSafe,
          canvasPainted: described.canvasPainted,
          canvasSampledOpaquePixels: described.canvasSampledOpaquePixels,
          canvasSampledColors: described.canvasSampledColors,
          paintWitness: describedPaintWitness.present
            ? {
                selector: describedPaintWitness.selector,
                tagName: describedPaintWitness.tagName,
                effectiveOpacity: describedPaintWitness.effectiveOpacity,
                paintVisibilityRatio:
                  describedPaintWitness.paintVisibilityRatio,
                visibleAreaRatio: describedPaintWitness.visibleAreaRatio,
                textPainted: describedPaintWitness.textPainted,
                textFontSizePx: describedPaintWitness.textFontSizePx,
                textForegroundAlpha: describedPaintWitness.textForegroundAlpha,
                textContrastRatio: describedPaintWitness.textContrastRatio,
                textRequiredContrastRatio:
                  describedPaintWitness.textRequiredContrastRatio,
                textGlyphVisibleRatio:
                  describedPaintWitness.textGlyphVisibleRatio,
                textPaintEffectsSafe:
                  describedPaintWitness.textPaintEffectsSafe,
                text: directPaintText(paintWitness),
              }
            : null,
          computed: described.computed,
          text: readableText(element),
        };
      }
      const primitives = {};
      for (const requirement of primitiveRequirements) {
        const matches = [
          ...document.querySelectorAll(requirement.selector),
        ].filter(requirement.countMode === "rendered" ? isRendered : isVisible);
        primitives[requirement.id] = {
          selector: requirement.selector,
          matchCount: matches.length,
          items: matches.map((element) => {
            const described = describe(element);
            const paintWitness = paintWitnessFor(element, /.+/u);
            const describedPaintWitness = describe(paintWitness);
            return {
              selector: described.selector,
              tagName: described.tagName,
              box: described.box,
              visibleAreaRatio: described.visibleAreaRatio,
              effectiveOpacity: described.effectiveOpacity,
              paintVisibilityRatio: described.paintVisibilityRatio,
              visibleBox: described.visibleBox,
              textPainted: described.textPainted,
              textFontSizePx: described.textFontSizePx,
              textForegroundAlpha: described.textForegroundAlpha,
              textContrastRatio: described.textContrastRatio,
              textRequiredContrastRatio: described.textRequiredContrastRatio,
              textGlyphVisibleRatio: described.textGlyphVisibleRatio,
              textPaintEffectsSafe: described.textPaintEffectsSafe,
              canvasPainted: described.canvasPainted,
              canvasSampledOpaquePixels: described.canvasSampledOpaquePixels,
              canvasSampledColors: described.canvasSampledColors,
              paintWitness: describedPaintWitness.present
                ? {
                    selector: describedPaintWitness.selector,
                    tagName: describedPaintWitness.tagName,
                    effectiveOpacity: describedPaintWitness.effectiveOpacity,
                    paintVisibilityRatio:
                      describedPaintWitness.paintVisibilityRatio,
                    visibleAreaRatio: describedPaintWitness.visibleAreaRatio,
                    textPainted: describedPaintWitness.textPainted,
                    textFontSizePx: describedPaintWitness.textFontSizePx,
                    textForegroundAlpha:
                      describedPaintWitness.textForegroundAlpha,
                    textContrastRatio: describedPaintWitness.textContrastRatio,
                    textRequiredContrastRatio:
                      describedPaintWitness.textRequiredContrastRatio,
                    textGlyphVisibleRatio:
                      describedPaintWitness.textGlyphVisibleRatio,
                    textPaintEffectsSafe:
                      describedPaintWitness.textPaintEffectsSafe,
                    text: directPaintText(paintWitness),
                  }
                : null,
              computed: described.computed,
              text: readableText(element),
            };
          }),
        };
      }
      const sha256Text = async (value) => {
        const digest = await crypto.subtle.digest(
          "SHA-256",
          new TextEncoder().encode(String(value || "")),
        );
        return [...new Uint8Array(digest)]
          .map((byte) => byte.toString(16).padStart(2, "0"))
          .join("");
      };
      const fixtureAssertions = {};
      const fixtureItemTexts = [];
      for (const requirement of fixtureRequirements?.items ?? []) {
        const pattern = new RegExp(requirement.textPattern, "u");
        const matches = [
          ...document.querySelectorAll(requirement.selector),
        ].filter((element) => {
          const rendered =
            requirement.countMode === "rendered"
              ? isRendered(element)
              : isVisible(element);
          return (
            rendered &&
            Boolean(
              paintWitnessFor(element, pattern, {
                allowRendered: requirement.countMode === "rendered",
                minimumContrastRatio: requirement.minimumContrastRatio,
                minimumGlyphVisibleRatio: requirement.minimumGlyphVisibleRatio,
              }),
            )
          );
        });
        const items = [];
        for (const element of matches) {
          const text = readableText(element);
          fixtureItemTexts.push(text);
          const described = describe(element, {
            minimumContrastRatio: requirement.minimumContrastRatio,
            minimumGlyphVisibleRatio: requirement.minimumGlyphVisibleRatio,
          });
          const paintWitness = paintWitnessFor(element, pattern, {
            minimumContrastRatio: requirement.minimumContrastRatio,
            minimumGlyphVisibleRatio: requirement.minimumGlyphVisibleRatio,
          });
          const describedPaintWitness = describe(paintWitness, {
            minimumContrastRatio: requirement.minimumContrastRatio,
            minimumGlyphVisibleRatio: requirement.minimumGlyphVisibleRatio,
          });
          items.push({
            selector: described.selector,
            tagName: described.tagName,
            visibleAreaRatio: described.visibleAreaRatio,
            effectiveOpacity: described.effectiveOpacity,
            paintVisibilityRatio: described.paintVisibilityRatio,
            visibleBox: described.visibleBox,
            textPainted: described.textPainted,
            textFontSizePx: described.textFontSizePx,
            textForegroundAlpha: described.textForegroundAlpha,
            textContrastRatio: described.textContrastRatio,
            textRequiredContrastRatio: described.textRequiredContrastRatio,
            textGlyphVisibleRatio: described.textGlyphVisibleRatio,
            textPaintEffectsSafe: described.textPaintEffectsSafe,
            paintWitness: describedPaintWitness.present
              ? {
                  selector: describedPaintWitness.selector,
                  tagName: describedPaintWitness.tagName,
                  effectiveOpacity: describedPaintWitness.effectiveOpacity,
                  paintVisibilityRatio:
                    describedPaintWitness.paintVisibilityRatio,
                  visibleAreaRatio: describedPaintWitness.visibleAreaRatio,
                  textPainted: describedPaintWitness.textPainted,
                  textFontSizePx: describedPaintWitness.textFontSizePx,
                  textForegroundAlpha:
                    describedPaintWitness.textForegroundAlpha,
                  textContrastRatio: describedPaintWitness.textContrastRatio,
                  textRequiredContrastRatio:
                    describedPaintWitness.textRequiredContrastRatio,
                  textGlyphVisibleRatio:
                    describedPaintWitness.textGlyphVisibleRatio,
                  textPaintEffectsSafe:
                    describedPaintWitness.textPaintEffectsSafe,
                  textSha256: await sha256Text(directPaintText(paintWitness)),
                  textMatches: pattern.test(directPaintText(paintWitness)),
                }
              : null,
            textSha256: await sha256Text(text),
            textMatches: pattern.test(text),
            optionCount:
              element instanceof HTMLSelectElement
                ? element.options.length
                : null,
          });
        }
        fixtureAssertions[requirement.id] = {
          selector: requirement.selector,
          matchCount: matches.length,
          items,
        };
      }
      const contentText = `${String(
        contentRoot.innerText || contentRoot.textContent || "",
      )} ${[...contentRoot.querySelectorAll("input, textarea, select")]
        .filter(isVisible)
        .map((element) => readableText(element))
        .join(" ")}`
        .replace(/\s+/gu, " ")
        .trim();
      const observedEmails = [
        ...new Set(
          [
            ...contentText.matchAll(
              /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/gu,
            ),
          ].map((match) => match[0].toLowerCase()),
        ),
      ].sort();
      const allowedEmailSet = new Set(
        privacyContract.allowedVisibleEmails.map((email) =>
          email.toLowerCase(),
        ),
      );
      const observedEmailSha256s = [];
      const unexpectedEmailSha256s = [];
      for (const email of observedEmails) {
        const emailHash = await sha256Text(email);
        observedEmailSha256s.push(emailHash);
        if (!allowedEmailSet.has(email)) unexpectedEmailSha256s.push(emailHash);
      }
      const forbiddenPatternMatchCounts = {};
      for (const [id, source] of Object.entries(
        privacyContract.forbiddenVisibleTextPatterns,
      )) {
        forbiddenPatternMatchCounts[id] = [
          ...contentText.matchAll(new RegExp(source, "gu")),
        ].length;
      }
      const personPattern = new RegExp(
        privacyContract.personLabelPattern,
        "gu",
      );
      const personLabels = [
        ...new Set(
          fixtureItemTexts.flatMap((text) =>
            [...text.matchAll(personPattern)].map((match) => match[0]),
          ),
        ),
      ].sort();
      const allowedPersonLabels = new Set(
        fixtureRequirements?.allowedPersonLabels ?? [],
      );
      const unexpectedPersonLabels = personLabels.filter(
        (label) => !allowedPersonLabels.has(label),
      );
      const firstRow = firstVisible("table tr", contentRoot);
      return {
        finalUrl: location.href,
        performanceNavigationUrl:
          performance.getEntriesByType("navigation")[0]?.name || location.href,
        documentReadyState: document.readyState,
        elements,
        anchors,
        readySignals,
        primitives,
        fixtureEvidence: {
          assertions: fixtureAssertions,
          privacy: {
            contentTextSha256: await sha256Text(contentText),
            observedEmailSha256s,
            unexpectedEmailSha256s,
            forbiddenPatternMatchCounts,
            personLabels,
            unexpectedPersonLabels,
          },
        },
        dom: {
          scrollWidth: document.documentElement.scrollWidth,
          clientWidth: document.documentElement.clientWidth,
          scrollHeight: document.documentElement.scrollHeight,
          clientHeight: document.documentElement.clientHeight,
          overflowX:
            document.documentElement.scrollWidth -
            document.documentElement.clientWidth,
          tableCount: contentRoot.querySelectorAll("table").length,
          buttonCount: contentRoot.querySelectorAll("button").length,
          tableColumnWidths: firstRow
            ? [...firstRow.querySelectorAll("th, td")].map(
                (cell) => cell.getBoundingClientRect().width,
              )
            : [],
        },
      };
    },
    {
      styleProperties,
      anchorRequirements,
      readyRequirements,
      primitiveRequirements,
      fixtureRequirements,
      privacyContract: contract.fixturePrivacy,
    },
  );

const waitForScreenReady = async (page, screenId) => {
  const readiness = contract.screenReadyStates[screenId];
  assert.ok(readiness, `Missing ready-state contract for ${screenId}.`);
  assert.ok(Array.isArray(readiness.signals) && readiness.signals.length > 0);
  const waitInput = {
    signals: readiness.signals,
    blockingTextPattern: contract.readiness.blockingVisibleTextPattern,
  };
  const evaluateReadiness = ({
    signals,
    blockingTextPattern,
    returnDiagnostic = false,
  }) => {
    const contentRoot =
      document.querySelector("#main-content") ||
      document.querySelector("main") ||
      document.querySelector("#root > div") ||
      document.body;
    const visible = (element) => {
      const own = element.getBoundingClientRect();
      if (own.width <= 0 || own.height <= 0) return false;
      if (
        typeof element.checkVisibility === "function" &&
        !element.checkVisibility({
          checkOpacity: true,
          checkVisibilityCSS: true,
        })
      ) {
        return false;
      }
      let left = Math.max(0, own.left);
      let right = Math.min(window.innerWidth, own.right);
      let top = Math.max(-window.scrollY, own.top);
      let bottom = Math.min(
        document.documentElement.scrollHeight - window.scrollY,
        own.bottom,
      );
      let current = element;
      let effectiveOpacity = 1;
      while (current instanceof Element) {
        const style = getComputedStyle(current);
        const opacity = Number.parseFloat(style.opacity || "1");
        effectiveOpacity *= Number.isFinite(opacity) ? opacity : 1;
        if (
          style.display === "none" ||
          style.visibility === "hidden" ||
          style.visibility === "collapse" ||
          effectiveOpacity < 0.9 ||
          (style.clipPath && style.clipPath !== "none")
        ) {
          return false;
        }
        if (current !== element) {
          const clipBox = current.getBoundingClientRect();
          if (["auto", "clip", "hidden", "scroll"].includes(style.overflowX)) {
            left = Math.max(left, clipBox.left);
            right = Math.min(right, clipBox.right);
          }
          if (["auto", "clip", "hidden", "scroll"].includes(style.overflowY)) {
            top = Math.max(top, clipBox.top);
            bottom = Math.min(bottom, clipBox.bottom);
          }
        }
        current = current.parentElement;
      }
      const visibleArea = Math.max(0, right - left) * Math.max(0, bottom - top);
      return (
        visibleArea / (own.width * own.height) >= 0.9 && effectiveOpacity >= 0.9
      );
    };
    const colorAlpha = (value) => {
      const normalized = String(value || "")
        .trim()
        .toLowerCase();
      if (!normalized || normalized === "transparent") return 0;
      const rgba = normalized.match(
        /^rgba\([^,]+,[^,]+,[^,]+,\s*([0-9.]+)\)$/u,
      );
      if (rgba) return Number.parseFloat(rgba[1]);
      const modern = normalized.match(/\/\s*([0-9.]+)(%)?\s*\)$/u);
      if (!modern) return 1;
      const parsed = Number.parseFloat(modern[1]);
      return modern[2] ? parsed / 100 : parsed;
    };
    const paintedText = (element) => {
      const style = getComputedStyle(element);
      const fontSize = Number.parseFloat(style.fontSize || "0");
      const foreground =
        element instanceof SVGTextElement
          ? style.fill
          : style.webkitTextFillColor || style.color;
      return (
        Number.isFinite(fontSize) &&
        fontSize >= 1 &&
        Math.min(
          colorAlpha(foreground),
          element instanceof SVGTextElement
            ? Number.parseFloat(style.fillOpacity || "1")
            : colorAlpha(style.color),
        ) >= 0.9
      );
    };
    const normalizedText = (element) => {
      if (element instanceof HTMLSelectElement) {
        return `${String(element.value || "")} ${[...element.selectedOptions]
          .map((option) => option.textContent || "")
          .join(" ")}`
          .replace(/\s+/gu, " ")
          .trim();
      }
      if (
        element instanceof HTMLInputElement ||
        element instanceof HTMLTextAreaElement
      ) {
        return String(element.value || "")
          .replace(/\s+/gu, " ")
          .trim();
      }
      return String(element.innerText || element.textContent || "")
        .replace(/\s+/gu, " ")
        .trim();
    };
    const directPaintText = (element) => {
      if (
        element instanceof HTMLSelectElement ||
        element instanceof HTMLInputElement ||
        element instanceof HTMLTextAreaElement
      ) {
        return normalizedText(element);
      }
      return [...element.childNodes]
        .filter((node) => node.nodeType === Node.TEXT_NODE)
        .map((node) => node.textContent || "")
        .join(" ")
        .replace(/\s+/gu, " ")
        .trim();
    };
    const canvasPainted = (element) => {
      if (!(element instanceof HTMLCanvasElement)) return false;
      try {
        const context = element.getContext("2d", {
          willReadFrequently: true,
        });
        if (!context || element.width <= 0 || element.height <= 0) return false;
        const pixels = context.getImageData(
          0,
          0,
          element.width,
          element.height,
        ).data;
        const stride = Math.max(
          1,
          Math.floor((element.width * element.height) / 8192),
        );
        let opaque = 0;
        const colors = new Set();
        for (let index = 0; index < pixels.length; index += 4 * stride) {
          if (pixels[index + 3] < 64) continue;
          opaque += 1;
          colors.add(
            `${pixels[index]}:${pixels[index + 1]}:${pixels[index + 2]}`,
          );
          if (colors.size > 32) break;
        }
        return opaque >= 8 && colors.size >= 2;
      } catch {
        return false;
      }
    };
    const candidateSignalState = (signal, pattern, tagPattern, element) => {
      const text = normalizedText(element);
      const paintedWitness =
        signal.paintMode === "canvas"
          ? canvasPainted(element)
          : [element, ...element.querySelectorAll("*")]
              .filter(visible)
              .some(
                (candidate) =>
                  pattern.test(directPaintText(candidate)) &&
                  paintedText(candidate),
              );
      const elementVisible = visible(element);
      const tagMatch = tagPattern.test(element.tagName);
      const textMatch = pattern.test(text);
      const nonempty = signal.allowEmptyText || text.length > 0;
      return {
        visible: elementVisible,
        paintedWitness,
        tagMatch,
        textMatch,
        ready:
          elementVisible && paintedWitness && tagMatch && nonempty && textMatch,
      };
    };
    const signalCandidates = (signal) => ({
      pattern: new RegExp(signal.textPattern, "u"),
      tagPattern: new RegExp(signal.tagPattern, "u"),
      elements: [...contentRoot.querySelectorAll(signal.selector)],
    });
    const hasSignal = (signal) => {
      const { pattern, tagPattern, elements } = signalCandidates(signal);
      return elements.some((element) => {
        const text = normalizedText(element);
        const paintedWitness =
          signal.paintMode === "canvas"
            ? canvasPainted(element)
            : [element, ...element.querySelectorAll("*")]
                .filter(visible)
                .some(
                  (candidate) =>
                    pattern.test(directPaintText(candidate)) &&
                    paintedText(candidate),
                );
        return (
          visible(element) &&
          paintedWitness &&
          tagPattern.test(element.tagName) &&
          (signal.allowEmptyText || text.length > 0) &&
          pattern.test(text)
        );
      });
    };
    const signalState = (signal) => {
      const { pattern, tagPattern, elements } = signalCandidates(signal);
      const candidateStates = elements.map((element) =>
        candidateSignalState(signal, pattern, tagPattern, element),
      );
      return {
        id: signal.id,
        selectorMatchCount: candidateStates.length,
        visibleMatchCount: candidateStates.filter(({ visible }) => visible)
          .length,
        paintedWitnessMatchCount: candidateStates.filter(
          ({ paintedWitness }) => paintedWitness,
        ).length,
        tagMatchCount: candidateStates.filter(({ tagMatch }) => tagMatch)
          .length,
        textMatchCount: candidateStates.filter(({ textMatch }) => textMatch)
          .length,
        readyMatchCount: candidateStates.filter(({ ready }) => ready).length,
        met: candidateStates.some(({ ready }) => ready),
      };
    };
    const blockingPattern = new RegExp(blockingTextPattern, "u");
    const blockingCandidates = [...contentRoot.querySelectorAll("*")].filter(
      (element) =>
        element.children.length === 0 &&
        !["OPTION", "SCRIPT", "STYLE", "TEMPLATE"].includes(element.tagName),
    );
    const isBlockingVisible = (element) =>
      visible(element) &&
      paintedText(element) &&
      blockingPattern.test(normalizedText(element));
    const blockingVisibleMatches = returnDiagnostic
      ? blockingCandidates.filter(isBlockingVisible)
      : [];
    const blockingVisible = returnDiagnostic
      ? blockingVisibleMatches.length > 0
      : blockingCandidates.some(isBlockingVisible);
    const documentReady = document.readyState === "complete";
    const signalStates = returnDiagnostic ? signals.map(signalState) : [];
    const signalsReady = returnDiagnostic
      ? signalStates.every(({ met }) => met)
      : documentReady && !blockingVisible
        ? signals.every(hasSignal)
        : false;
    const ready = documentReady && !blockingVisible && signalsReady;
    if (!returnDiagnostic) return ready;
    return {
      documentReadyState: document.readyState,
      contentRootPresent: Boolean(contentRoot),
      blockingVisible,
      blockingVisibleMatchCount: blockingVisibleMatches.length,
      signalStates,
      evaluationFailed: false,
    };
  };
  const readinessWait = page.waitForFunction(evaluateReadiness, waitInput, {
    timeout: contract.readiness.timeoutMs,
  });
  await readinessWait.catch(async (error) => {
    let readinessDiagnostic = {
      documentReadyState: "unknown",
      contentRootPresent: false,
      blockingVisible: null,
      blockingVisibleMatchCount: -1,
      signalStates: [],
      evaluationFailed: true,
    };
    try {
      readinessDiagnostic = await page.evaluate(evaluateReadiness, {
        ...waitInput,
        returnDiagnostic: true,
      });
    } catch {
      // The original readiness failure remains authoritative if the page closed.
    }
    if (error && typeof error === "object") {
      Object.defineProperty(error, "w10pReadinessDiagnostic", {
        value: Object.freeze(readinessDiagnostic),
        enumerable: false,
      });
    }
    throw error;
  });

  let previousFingerprint = "";
  let stableSamples = 0;
  for (
    let attempt = 0;
    attempt < contract.readiness.maxSettleSamples;
    attempt += 1
  ) {
    const fingerprint = await page.evaluate(
      ({ signals }) => {
        const contentRoot =
          document.querySelector("#main-content") ||
          document.querySelector("main") ||
          document.querySelector("#root > div") ||
          document.body;
        const visible = (element) => {
          const own = element.getBoundingClientRect();
          if (own.width <= 0 || own.height <= 0) return false;
          if (
            typeof element.checkVisibility === "function" &&
            !element.checkVisibility({
              checkOpacity: true,
              checkVisibilityCSS: true,
            })
          ) {
            return false;
          }
          let left = Math.max(0, own.left);
          let right = Math.min(window.innerWidth, own.right);
          let top = Math.max(-window.scrollY, own.top);
          let bottom = Math.min(
            document.documentElement.scrollHeight - window.scrollY,
            own.bottom,
          );
          let current = element;
          let effectiveOpacity = 1;
          while (current instanceof Element) {
            const style = getComputedStyle(current);
            const opacity = Number.parseFloat(style.opacity || "1");
            effectiveOpacity *= Number.isFinite(opacity) ? opacity : 1;
            if (
              style.display === "none" ||
              style.visibility === "hidden" ||
              style.visibility === "collapse" ||
              effectiveOpacity < 0.9 ||
              (style.clipPath && style.clipPath !== "none")
            ) {
              return false;
            }
            if (current !== element) {
              const clipBox = current.getBoundingClientRect();
              if (
                ["auto", "clip", "hidden", "scroll"].includes(style.overflowX)
              ) {
                left = Math.max(left, clipBox.left);
                right = Math.min(right, clipBox.right);
              }
              if (
                ["auto", "clip", "hidden", "scroll"].includes(style.overflowY)
              ) {
                top = Math.max(top, clipBox.top);
                bottom = Math.min(bottom, clipBox.bottom);
              }
            }
            current = current.parentElement;
          }
          const visibleArea =
            Math.max(0, right - left) * Math.max(0, bottom - top);
          return (
            visibleArea / (own.width * own.height) >= 0.9 &&
            effectiveOpacity >= 0.9
          );
        };
        const colorAlpha = (value) => {
          const normalized = String(value || "")
            .trim()
            .toLowerCase();
          if (!normalized || normalized === "transparent") return 0;
          const rgba = normalized.match(
            /^rgba\([^,]+,[^,]+,[^,]+,\s*([0-9.]+)\)$/u,
          );
          if (rgba) return Number.parseFloat(rgba[1]);
          const modern = normalized.match(/\/\s*([0-9.]+)(%)?\s*\)$/u);
          if (!modern) return 1;
          const parsed = Number.parseFloat(modern[1]);
          return modern[2] ? parsed / 100 : parsed;
        };
        const paintedText = (element) => {
          const style = getComputedStyle(element);
          const fontSize = Number.parseFloat(style.fontSize || "0");
          const foreground =
            element instanceof SVGTextElement
              ? style.fill
              : style.webkitTextFillColor || style.color;
          return (
            Number.isFinite(fontSize) &&
            fontSize >= 1 &&
            Math.min(
              colorAlpha(foreground),
              element instanceof SVGTextElement
                ? Number.parseFloat(style.fillOpacity || "1")
                : colorAlpha(style.color),
            ) >= 0.9
          );
        };
        const readableText = (element) => {
          if (element instanceof HTMLSelectElement) {
            return `${String(element.value || "")} ${[
              ...element.selectedOptions,
            ]
              .map((option) => option.textContent || "")
              .join(" ")}`
              .replace(/\s+/gu, " ")
              .trim();
          }
          if (
            element instanceof HTMLInputElement ||
            element instanceof HTMLTextAreaElement
          ) {
            return String(element.value || "")
              .replace(/\s+/gu, " ")
              .trim();
          }
          return String(element.innerText || element.textContent || "")
            .replace(/\s+/gu, " ")
            .trim();
        };
        const directPaintText = (element) => {
          if (
            element instanceof HTMLSelectElement ||
            element instanceof HTMLInputElement ||
            element instanceof HTMLTextAreaElement
          ) {
            return readableText(element);
          }
          return [...element.childNodes]
            .filter((node) => node.nodeType === Node.TEXT_NODE)
            .map((node) => node.textContent || "")
            .join(" ")
            .replace(/\s+/gu, " ")
            .trim();
        };
        const canvasPainted = (element) => {
          if (!(element instanceof HTMLCanvasElement)) return false;
          try {
            const context = element.getContext("2d", {
              willReadFrequently: true,
            });
            if (!context || element.width <= 0 || element.height <= 0) {
              return false;
            }
            const pixels = context.getImageData(
              0,
              0,
              element.width,
              element.height,
            ).data;
            const stride = Math.max(
              1,
              Math.floor((element.width * element.height) / 8192),
            );
            let opaque = 0;
            const colors = new Set();
            for (let index = 0; index < pixels.length; index += 4 * stride) {
              if (pixels[index + 3] < 64) continue;
              opaque += 1;
              colors.add(
                `${pixels[index]}:${pixels[index + 1]}:${pixels[index + 2]}`,
              );
              if (colors.size > 32) break;
            }
            return opaque >= 8 && colors.size >= 2;
          } catch {
            return false;
          }
        };
        const signalRows = signals.map((signal) => {
          const pattern = new RegExp(signal.textPattern, "u");
          const tagPattern = new RegExp(signal.tagPattern, "u");
          const candidates = [...contentRoot.querySelectorAll(signal.selector)]
            .filter((element) => {
              const text = readableText(element);
              const paintedWitness =
                signal.paintMode === "canvas"
                  ? canvasPainted(element)
                  : [element, ...element.querySelectorAll("*")]
                      .filter(visible)
                      .some(
                        (candidate) =>
                          pattern.test(directPaintText(candidate)) &&
                          paintedText(candidate),
                      );
              return (
                visible(element) &&
                paintedWitness &&
                tagPattern.test(element.tagName) &&
                (signal.allowEmptyText || text.length > 0) &&
                pattern.test(text)
              );
            })
            .sort((left, right) => {
              const leftBox = left.getBoundingClientRect();
              const rightBox = right.getBoundingClientRect();
              return (
                leftBox.width * leftBox.height -
                rightBox.width * rightBox.height
              );
            });
          const element = candidates[0];
          if (!element) return null;
          const box = element.getBoundingClientRect();
          return {
            id: signal.id,
            text: readableText(element),
            box: [box.x, box.y, box.width, box.height].map((value) =>
              Number(value.toFixed(2)),
            ),
            canvasPixels:
              element instanceof HTMLCanvasElement
                ? element.toDataURL("image/png")
                : "",
          };
        });
        const canvasRows = [...contentRoot.querySelectorAll("canvas")]
          .filter(visible)
          .map((canvas) => {
            try {
              return canvas.toDataURL("image/png");
            } catch {
              return `TAINTED:${canvas.width}x${canvas.height}`;
            }
          });
        const controlRows = [
          ...contentRoot.querySelectorAll("input, textarea, select"),
        ]
          .filter(visible)
          .map((control) => readableText(control));
        return JSON.stringify({
          scrollWidth: document.documentElement.scrollWidth,
          scrollHeight: document.documentElement.scrollHeight,
          contentText: readableText(contentRoot),
          elementCount: contentRoot.querySelectorAll("*").length,
          controlRows,
          canvasRows,
          signalRows,
        });
      },
      { signals: readiness.signals },
    );
    stableSamples = fingerprint === previousFingerprint ? stableSamples + 1 : 1;
    previousFingerprint = fingerprint;
    if (stableSamples >= contract.readiness.requiredStableSamples) return;
    await page.waitForTimeout(contract.readiness.settleIntervalMs);
  }
  assert.fail(`${screenId} did not reach a stable ready layout.`);
};

const applyScreenFixtureActions = async (page, screenId, viewport) => {
  const actions = contract.screenFixtureActions?.[screenId] ?? [];
  const results = [];
  for (const action of actions) {
    const viewportExcluded =
      (Number.isFinite(action.maxViewportWidth) &&
        viewport.width > action.maxViewportWidth) ||
      (Number.isFinite(action.minViewportWidth) &&
        viewport.width < action.minViewportWidth);
    if (viewportExcluded) {
      results.push({
        id: action.id,
        type: action.type,
        applied: false,
        skippedByViewport: true,
        matchCount: 0,
      });
      continue;
    }

    if (action.type === "select-option-text") {
      await page.waitForFunction(
        ({ selector, text, exactMatchCount }) => {
          const normalize = (value) =>
            String(value || "")
              .replace(/\s+/gu, " ")
              .trim();
          const matches = [...document.querySelectorAll(selector)].filter(
            (element) =>
              element instanceof HTMLSelectElement &&
              [...element.options].some(
                (option) => normalize(option.textContent) === text,
              ),
          );
          return matches.length === exactMatchCount;
        },
        {
          selector: action.selector,
          text: action.text,
          exactMatchCount: action.exactMatchCount,
        },
        { timeout: contract.readiness.timeoutMs },
      );
      const result = await page.evaluate(({ selector, text }) => {
        const normalize = (value) =>
          String(value || "")
            .replace(/\s+/gu, " ")
            .trim();
        const matches = [...document.querySelectorAll(selector)].filter(
          (element) =>
            element instanceof HTMLSelectElement &&
            [...element.options].some(
              (option) => normalize(option.textContent) === text,
            ),
        );
        const select = matches[0];
        const option = [...select.options].find(
          (candidate) => normalize(candidate.textContent) === text,
        );
        select.value = option.value;
        select.dispatchEvent(new Event("input", { bubbles: true }));
        select.dispatchEvent(new Event("change", { bubbles: true }));
        return {
          matchCount: matches.length,
          selected: normalize(select.selectedOptions[0]?.textContent) === text,
        };
      }, action);
      assert.equal(result.matchCount, action.exactMatchCount);
      assert.equal(result.selected, true);
      results.push({
        id: action.id,
        type: action.type,
        applied: true,
        skippedByViewport: false,
        matchCount: result.matchCount,
      });
      continue;
    }

    if (action.type === "fill" || action.type === "click") {
      const locator = page.locator(action.selector);
      await locator.first().waitFor({
        state: "visible",
        timeout: contract.readiness.timeoutMs,
      });
      const matchCount = await locator.count();
      assert.equal(matchCount, action.exactMatchCount);
      if (action.type === "fill") await locator.fill(action.value);
      else await locator.click();
      results.push({
        id: action.id,
        type: action.type,
        applied: true,
        skippedByViewport: false,
        matchCount,
      });
      continue;
    }

    if (action.type === "scroll-text-into-view") {
      await page.waitForFunction(
        ({ selector, text, exactMatchCount }) => {
          const normalize = (value) =>
            String(value || "")
              .replace(/\s+/gu, " ")
              .trim();
          return (
            [...document.querySelectorAll(selector)].filter(
              (element) =>
                normalize(element.innerText || element.textContent) === text,
            ).length === exactMatchCount
          );
        },
        action,
        { timeout: contract.readiness.timeoutMs },
      );
      const matchCount = await page.evaluate(({ selector, text }) => {
        const normalize = (value) =>
          String(value || "")
            .replace(/\s+/gu, " ")
            .trim();
        const matches = [...document.querySelectorAll(selector)].filter(
          (element) =>
            normalize(element.innerText || element.textContent) === text,
        );
        matches[0].scrollIntoView({
          behavior: "auto",
          block: "nearest",
          inline: "center",
        });
        return matches.length;
      }, action);
      assert.equal(matchCount, action.exactMatchCount);
      results.push({
        id: action.id,
        type: action.type,
        applied: true,
        skippedByViewport: false,
        matchCount,
      });
      continue;
    }

    assert.fail(
      `${screenId} declares an unsupported fixture action: ${action.type}`,
    );
  }
  return results;
};

const fixedClockScript = ({ fixedTimestamp }) => {
  const NativeDate = Date;
  const fixed = new NativeDate(fixedTimestamp).valueOf();
  class FrozenDate extends NativeDate {
    constructor(...dateArgs) {
      super(...(dateArgs.length ? dateArgs : [fixed]));
    }
    static now() {
      return fixed;
    }
  }
  Object.defineProperty(globalThis, "Date", {
    configurable: true,
    writable: true,
    value: FrozenDate,
  });
};

const appCheckDebugInitScript = ({ allowedOrigin, debugToken }) => {
  if (location.origin !== allowedOrigin) return;
  const jwtPattern =
    /[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/gu;
  const redact = (value) => {
    if (typeof value === "string") {
      return value
        .replaceAll(debugToken, "[W10P_APPCHECK_DEBUG_TOKEN_REDACTED]")
        .replace(jwtPattern, "[W10P_APPCHECK_JWT_REDACTED]");
    }
    if (value instanceof Error) {
      return `${value.name}: ${redact(value.message)}`;
    }
    if (value && typeof value === "object") {
      return "[W10P_CONSOLE_OBJECT_REDACTED]";
    }
    return value;
  };
  for (const method of ["debug", "error", "info", "log", "warn"]) {
    const original = console[method].bind(console);
    console[method] = (...values) => original(...values.map(redact));
  }
  Object.defineProperty(self, "FIREBASE_APPCHECK_DEBUG_TOKEN", {
    configurable: false,
    enumerable: false,
    writable: false,
    value: debugToken,
  });
};

const authenticate = async (page, credential, origin) => {
  await page.goto(`${origin}/#/`, { waitUntil: "domcontentloaded" });
  const identity = await page.evaluate(
    async ({ email, password, config }) => {
      const appModule =
        await import("https://www.gstatic.com/firebasejs/12.9.0/firebase-app.js");
      const authModule =
        await import("https://www.gstatic.com/firebasejs/12.9.0/firebase-auth.js");
      const appCheckModule =
        await import("https://www.gstatic.com/firebasejs/12.9.0/firebase-app-check.js");
      const firestoreModule =
        await import("https://www.gstatic.com/firebasejs/12.9.0/firebase-firestore.js");
      const app = appModule.initializeApp(config);
      const auxiliaryAppCheck = appCheckModule.initializeAppCheck(app, {
        provider: new appCheckModule.CustomProvider({
          getToken: async () => {
            throw new Error("VISUAL_APPCHECK_DEBUG_PROVIDER_REQUIRED");
          },
        }),
        isTokenAutoRefreshEnabled: false,
      });
      let auxiliaryAppCheckToken =
        await appCheckModule.getToken(auxiliaryAppCheck);
      if (!auxiliaryAppCheckToken?.token) {
        throw new Error("VISUAL_APPCHECK_TOKEN_MISSING");
      }
      auxiliaryAppCheckToken = null;
      const auth = authModule.getAuth(app);
      await authModule.setPersistence(auth, authModule.browserLocalPersistence);
      const credentialResult = await authModule.signInWithEmailAndPassword(
        auth,
        email,
        password,
      );
      await auth.authStateReady();
      const token = await authModule.getIdTokenResult(credentialResult.user);
      const database = firestoreModule.getFirestore(app);
      const profileSnapshot = await firestoreModule.getDoc(
        firestoreModule.doc(database, "users", credentialResult.user.uid),
      );
      if (!profileSnapshot.exists()) throw new Error("VISUAL_PROFILE_MISSING");
      const profile = profileSnapshot.data();
      return {
        uid: credentialResult.user.uid,
        email: credentialResult.user.email || "",
        profileEmail: String(profile.email || ""),
        profileRole: String(profile.role || ""),
        teacherPortalEnabled: profile.teacherPortalEnabled === true,
        staffPermissions: Array.isArray(profile.staffPermissions)
          ? profile.staffPermissions.map(String).sort()
          : [],
        appCheckBound: true,
        tokenRole:
          typeof token.claims.role === "string" ? token.claims.role : null,
      };
    },
    { ...credential, config: firebaseConfig },
  );
  await page.reload({ waitUntil: "domcontentloaded" });
  return identity;
};

const createIdentityAttestation = (role, identity) => {
  const expected = contract.captureIdentities.roles[role];
  assert.ok(expected, `Missing capture identity contract for ${role}.`);
  assert.equal(identity.uid, expected.uid);
  assert.equal(identity.appCheckBound, true);
  assert.equal(identity.profileRole, expected.profileRole);
  assert.equal(identity.teacherPortalEnabled, expected.teacherPortalEnabled);
  assert.equal(
    identity.profileEmail.trim().toLowerCase(),
    identity.email.trim().toLowerCase(),
    `${role} Auth and profile emails differ.`,
  );
  assert.equal(
    identity.tokenRole === null || identity.tokenRole === identity.profileRole,
    true,
    `${role} token and profile roles conflict.`,
  );
  for (const permission of expected.requiredStaffPermissions) {
    assert.equal(
      identity.staffPermissions.includes(permission),
      true,
      `${role} is missing ${permission}.`,
    );
  }
  const emailSha256 = sha256(identity.email.trim().toLowerCase());
  const adminEmail =
    emailSha256 === contract.captureIdentities.adminEmailSha256;
  assert.equal(adminEmail, role === "admin");
  return {
    role,
    appCheckBound: identity.appCheckBound === true,
    uidSha256: sha256(identity.uid),
    emailSha256,
    profileRole: identity.profileRole,
    tokenRole: identity.tokenRole,
    teacherPortalEnabled: identity.teacherPortalEnabled,
    staffPermissions: [...new Set(identity.staffPermissions)].sort(),
    adminEmail,
  };
};

const sanitizeBrowserUrl = (value) => {
  const url = new URL(value);
  url.searchParams.delete("x-vercel-protection-bypass");
  url.searchParams.delete("x-vercel-set-bypass-cookie");
  return url.toString();
};
const fixtureDataServices = new Set(["firestore", "functions", "storage"]);
const inspectNetworkRequest = ({
  url: requestUrl,
  method,
  resourceType = "Fetch",
  phase,
  groupKey,
  captureId,
  correlationId,
  appCheckHeaderPresent = false,
  appCheckHeaderSource = null,
  appCheckHeaderJwtShapeValid = false,
  appCheckBridgeDecisionObserved = false,
  appCheckBridgeScopeEligible = false,
  appCheckBridgeHeaderStripped = false,
  appCheckBridgeRedirectedRequest = false,
  apiKeyHeaderValues = [],
}) => {
  const {
    hostname,
    canonicalHostname,
    firebaseService,
    isFirebaseRequest,
    nonFirebaseHostnameAllowed,
    nonFirebasePolicyRuleId,
    stagingMarker,
    productionMarker,
    unboundFirebaseRequest,
    malformedUrlEncoding,
    apiKeySha256,
    apiKeyValueCount,
    apiKeyBindingValid,
    firebaseTransportValid,
    serviceResourceBound,
    observedProjectIds,
  } = inspectNetworkBoundary({
    requestUrl,
    method,
    resourceType,
    apiKeyHeaderValues,
    stagingApiKey: firebaseConfig.apiKey,
    allowedNonFirebaseOrigins: nonFirebaseNetworkAllowedOrigins,
  });

  return {
    groupKey,
    captureId,
    correlationId,
    phase,
    method: method.toUpperCase(),
    resourceType,
    hostname,
    canonicalHostname,
    firebaseService,
    isFirebaseRequest,
    nonFirebaseHostnameAllowed,
    nonFirebasePolicyRuleId,
    stagingMarker,
    productionMarker,
    unboundFirebaseRequest,
    malformedUrlEncoding,
    apiKeySha256,
    apiKeyValueCount,
    apiKeyBindingValid,
    firebaseTransportValid,
    serviceResourceBound,
    appCheckHeaderPresent,
    appCheckHeaderSource,
    appCheckHeaderJwtShapeValid,
    appCheckBridgeDecisionObserved,
    appCheckBridgeScopeEligible,
    appCheckBridgeHeaderStripped,
    appCheckBridgeRedirectedRequest,
    productionWrite:
      productionMarker &&
      !["GET", "HEAD", "OPTIONS"].includes(method.toUpperCase()),
    observedProjectIds,
  };
};
const summarizeNetwork = (observations, responses = []) => {
  const firebaseRequests = observations.filter(
    (observation) => observation.isFirebaseRequest,
  );
  const productionRequests = observations.filter(
    (observation) => observation.productionMarker,
  );
  const nonFirebaseRequests = observations.filter(
    (observation) => !observation.isFirebaseRequest,
  );
  const nonFirebaseResponses = responses.filter(
    (observation) => !observation.isFirebaseRequest,
  );
  const unallowlistedNonFirebaseRequests = nonFirebaseRequests.filter(
    (observation) => !observation.nonFirebaseHostnameAllowed,
  );
  const unallowlistedNonFirebaseResponses = nonFirebaseResponses.filter(
    (observation) => !observation.nonFirebaseHostnameAllowed,
  );
  const productionVercelRequests = unallowlistedNonFirebaseRequests.filter(
    (observation) =>
      isVercelNetworkHostname(observation.hostname) &&
      contract.networkBoundary.forbiddenWebHosts.includes(
        canonicalNetworkHostname(observation.hostname),
      ),
  );
  const productionVercelResponses = unallowlistedNonFirebaseResponses.filter(
    (observation) =>
      isVercelNetworkHostname(observation.hostname) &&
      contract.networkBoundary.forbiddenWebHosts.includes(
        canonicalNetworkHostname(observation.hostname),
      ),
  );
  const unknownVercelRequests = unallowlistedNonFirebaseRequests.filter(
    (observation) =>
      isVercelNetworkHostname(observation.hostname) &&
      !contract.networkBoundary.forbiddenWebHosts.includes(
        canonicalNetworkHostname(observation.hostname),
      ),
  );
  const unknownVercelResponses = unallowlistedNonFirebaseResponses.filter(
    (observation) =>
      isVercelNetworkHostname(observation.hostname) &&
      !contract.networkBoundary.forbiddenWebHosts.includes(
        canonicalNetworkHostname(observation.hostname),
      ),
  );
  const stagingRequests = firebaseRequests.filter(
    (observation) => observation.stagingMarker,
  );
  const unboundFirebaseRequests = firebaseRequests.filter(
    (observation) => observation.unboundFirebaseRequest,
  );
  const stagingFirebaseResponses = responses.filter(
    (response) =>
      response.isFirebaseRequest &&
      response.stagingMarker &&
      response.status < 400,
  );
  const stagingDataRequests = stagingRequests.filter((request) =>
    fixtureDataServices.has(request.firebaseService),
  );
  const appCheckProtectedDataRequests = stagingDataRequests.filter(
    (request) => request.method !== "OPTIONS",
  );
  const appCheckExchangeRequests = stagingRequests.filter(
    (request) =>
      request.firebaseService === "app-check" && request.method === "POST",
  );
  const successfulAppCheckExchangeResponses = stagingFirebaseResponses.filter(
    (response) =>
      response.firebaseService === "app-check" &&
      response.method === "POST" &&
      response.status === 200,
  );
  const stagingDataResponses = stagingFirebaseResponses.filter((response) =>
    fixtureDataServices.has(response.firebaseService),
  );
  const countBy = (items, selectKey) =>
    Object.fromEntries(
      [
        ...items.reduce((counts, item) => {
          const key = selectKey(item);
          counts.set(key, (counts.get(key) || 0) + 1);
          return counts;
        }, new Map()),
      ].sort(([left], [right]) => left.localeCompare(right)),
    );
  return {
    requestCount: observations.length,
    responseCount: responses.length,
    firebaseRequestCount: firebaseRequests.length,
    nonFirebaseRequestCount: nonFirebaseRequests.length,
    nonFirebaseAllowedRequestCount: nonFirebaseRequests.filter(
      (observation) => observation.nonFirebaseHostnameAllowed,
    ).length,
    nonFirebaseUnallowlistedRequestCount:
      unallowlistedNonFirebaseRequests.length,
    nonFirebaseUnallowlistedResponseCount:
      unallowlistedNonFirebaseResponses.length,
    productionVercelRequestCount: productionVercelRequests.length,
    productionVercelResponseCount: productionVercelResponses.length,
    unknownVercelRequestCount: unknownVercelRequests.length,
    unknownVercelResponseCount: unknownVercelResponses.length,
    stagingFirebaseRequestCount: stagingRequests.length,
    stagingFirebaseResponseCount: stagingFirebaseResponses.length,
    stagingDataRequestCount: stagingDataRequests.length,
    stagingDataResponseCount: stagingDataResponses.length,
    appCheckExchangeRequestCount: appCheckExchangeRequests.length,
    successfulAppCheckExchangeResponseCount:
      successfulAppCheckExchangeResponses.length,
    appCheckProtectedDataRequestCount: appCheckProtectedDataRequests.length,
    appCheckHeaderPresentRequestCount: appCheckProtectedDataRequests.filter(
      (request) => request.appCheckHeaderPresent,
    ).length,
    appCheckHeaderMissingRequestCount: appCheckProtectedDataRequests.filter(
      (request) => !request.appCheckHeaderPresent,
    ).length,
    appCheckHeaderJwtShapeValidRequestCount:
      appCheckProtectedDataRequests.filter(
        (request) => request.appCheckHeaderJwtShapeValid,
      ).length,
    appCheckHeaderJwtShapeInvalidRequestCount:
      appCheckProtectedDataRequests.filter(
        (request) =>
          request.appCheckHeaderPresent && !request.appCheckHeaderJwtShapeValid,
      ).length,
    rawAppCheckHeaderValueOutputCount: 0,
    stagingFirebaseRequestsByPhase: countBy(
      stagingRequests,
      (observation) => observation.phase,
    ),
    stagingFirebaseRequestsByStage: countBy(
      stagingRequests,
      (observation) => observation.groupKey.split(":")[0],
    ),
    stagingScreenRequestsByStage: countBy(
      stagingRequests.filter(
        (observation) => observation.phase === "screen-capture",
      ),
      (observation) => observation.groupKey.split(":")[0],
    ),
    productionAccess: productionRequests.length,
    productionWrites: productionRequests.filter(
      (observation) => observation.productionWrite,
    ).length,
    unboundFirebaseRequestCount: unboundFirebaseRequests.length,
    observedFirebaseApiKeySha256s: [
      ...new Set(
        firebaseRequests
          .map((observation) => observation.apiKeySha256)
          .filter(Boolean),
      ),
    ].sort(),
    observedFirebaseProjectIds: [
      ...new Set(
        firebaseRequests.flatMap(
          (observation) => observation.observedProjectIds,
        ),
      ),
    ].sort(),
    observedFirebaseHosts: [
      ...new Set(firebaseRequests.map((observation) => observation.hostname)),
    ].sort(),
    productionRequestHosts: [
      ...new Set(productionRequests.map((observation) => observation.hostname)),
    ].sort(),
    nonFirebaseUnallowlistedRequestHosts: [
      ...new Set(
        unallowlistedNonFirebaseRequests.map(
          (observation) => observation.hostname,
        ),
      ),
    ].sort(),
    productionVercelRequestHosts: [
      ...new Set(
        productionVercelRequests.map((observation) => observation.hostname),
      ),
    ].sort(),
    unknownVercelRequestHosts: [
      ...new Set(
        unknownVercelRequests.map((observation) => observation.hostname),
      ),
    ].sort(),
    failedFirebaseResponseCount: responses.filter(
      (response) => response.isFirebaseRequest && response.status >= 400,
    ).length,
  };
};
const deploymentNodeRequestHeaders =
  createNodeOwnedVercelRequestHeaders(bypassSecret);
const immutableResourceFetchCache = new Map();
let immutableResourceAttestationRequestCount = 0;
let immutableResourceAttestationCacheHitCount = 0;
let immutableResourceAttestationHttp200Count = 0;
let immutableResourceAttestationRedirectResponseCount = 0;
let immutableResourceAttestationBypassHeaderRequestCount = 0;
let immutableResourceAttestationSkipToolbarHeaderRequestCount = 0;
let immutableResourceAttestationLinkHeaderObservationCount = 0;
let immutableResourceAttestationParserMarkupRejectCount = 0;
let immutableResourceAttestationVercelToolbarMarkupObservationCount = 0;
const fetchImmutableResourceAttestation = async (stage, upstreamUrl) => {
  const parsed = new URL(upstreamUrl);
  assert.equal(parsed.origin, upstreamOrigins[stage]);
  assert.ok(vercelBypassAllowedOrigins.includes(parsed.origin));
  const cacheKey = `${stage}:${parsed.toString()}`;
  if (immutableResourceFetchCache.has(cacheKey)) {
    immutableResourceAttestationCacheHitCount += 1;
    return immutableResourceFetchCache.get(cacheKey);
  }
  const attestationPromise = (async () => {
    immutableResourceAttestationRequestCount += 1;
    if (bypassSecret) immutableResourceAttestationBypassHeaderRequestCount += 1;
    immutableResourceAttestationSkipToolbarHeaderRequestCount += 1;
    const response = await fetch(parsed, {
      headers: deploymentNodeRequestHeaders,
      redirect: "error",
      signal: AbortSignal.timeout(20_000),
    });
    if (response.status >= 300 && response.status < 400) {
      immutableResourceAttestationRedirectResponseCount += 1;
    }
    assert.equal(
      response.status,
      200,
      `${stage} immutable resource ${parsed.pathname} is not HTTP 200.`,
    );
    assert.equal(new URL(response.url).origin, upstreamOrigins[stage]);
    immutableResourceAttestationHttp200Count += 1;
    immutableResourceAttestationLinkHeaderObservationCount += Number(
      response.headers.has("link"),
    );
    const bytes = Buffer.from(await response.arrayBuffer());
    const contentType =
      response.headers.get("content-type") || "application/octet-stream";
    assert.doesNotMatch(contentType, /[\r\n\0]/u);
    if (/^text\/html(?:;|$)/iu.test(contentType)) {
      const vercelToolbarMarkupObserved =
        containsVercelPreviewToolbarMarkup(bytes);
      immutableResourceAttestationVercelToolbarMarkupObservationCount += Number(
        vercelToolbarMarkupObserved,
      );
      assert.equal(
        vercelToolbarMarkupObserved,
        false,
        `${stage} immutable Document contains Vercel Preview Toolbar markup.`,
      );
      const parserMarkupDecision = immutableDocumentParserMarkupDecision(
        bytes,
        {
          documentOrigin: stableBrowserOrigin,
        },
      );
      if (!parserMarkupDecision.valid) {
        immutableResourceAttestationParserMarkupRejectCount += 1;
        assert.fail(
          `${stage} immutable Document contains forbidden ${parserMarkupDecision.marker} markup.`,
        );
      }
    }
    return {
      status: response.status,
      bytes: bytes.length,
      sha256: sha256(bytes),
      body: bytes.toString("base64"),
      responseHeaders: [
        { name: "cache-control", value: "no-store" },
        { name: "content-type", value: contentType },
        { name: "x-dns-prefetch-control", value: "off" },
      ],
    };
  })();
  immutableResourceFetchCache.set(cacheKey, attestationPromise);
  return attestationPromise;
};
const captureAppCheckTokenManager = createCaptureAppCheckTokenManager();
let baselineBridgeEligibleRequestCount = 0;
let baselineBridgeInjectedRequestCount = 0;
let baselineBridgeNativeHeaderRequestCount = 0;
let baselineBridgeScopeMismatchRequestCount = 0;
let baselineBridgeStrippedHeaderRequestCount = 0;
let baselineBridgeRedirectRequestCount = 0;
let baselineBridgeRedirectHeaderAbsentRequestCount = 0;
let baselineBridgeRedirectAbortRequestCount = 0;
let baselineBridgeCdpPausedRequestCount = 0;
let baselineBridgeCdpResponsePausedRequestCount = 0;
let baselineBridgeCdpReconciledRequestCount = 0;
let appCheckCdpHandlerErrorCount = 0;
const cdpHandlerFailureClassCounts = new Map();
let baselineBridgeInjectedRedirectResponseAbortCount = 0;
let appCheckCdpMonitorPausedRequestCount = 0;
let preTransmissionBoundaryInspectionCount = 0;
let preTransmissionBoundaryBlockAttemptCount = 0;
let preTransmissionBoundaryProductionBlockCount = 0;
let preTransmissionBoundaryCrossOriginDocumentBlockCount = 0;
let preTransmissionBoundaryUnboundFirebaseBlockCount = 0;
let preTransmissionBoundaryNonFirebaseHostnameBlockCount = 0;
let preTransmissionBoundaryMalformedUrlBlockCount = 0;
let preTransmissionBoundaryFailRequestCount = 0;
const preTransmissionBoundaryBlockClassCounts = new Map();
const SAFE_CDP_DIAGNOSTIC_CAPTURE_STAGES = ["baseline", "candidate"];
const SAFE_CDP_DIAGNOSTIC_PHASES = [
  "context-bootstrap",
  "authentication",
  "screen-capture",
  "browser-audit-finalization",
];
const SAFE_CDP_DIAGNOSTIC_OPERATIONS = [
  "request-post-data",
  "request-pre-transmission",
  "request-policy",
  "request-proxy-authorize",
  "request-continue",
  "request-fail",
  "request-fulfill",
  "request-node-fetch",
  "request-bridge-token",
  "response-correlation",
  "response-sanitize-informational",
  "response-continue-informational",
  "response-fail",
  "response-sanitize-final",
  "response-body-attestation",
  "response-continue-final",
  "response-proxy-complete",
];
const SAFE_CDP_DIAGNOSTIC_SERVICES = [
  "auth",
  "app-check",
  "firestore",
  "storage",
  "functions",
  "realtime-database",
  "hosting",
  "non-firebase",
  "unknown",
];
const SAFE_CDP_DIAGNOSTIC_REQUEST_CLASSES = [
  "firebase",
  "browser-product-background",
  "recaptcha",
  "firebase-static-module",
  "font-static",
  "quill-static",
  "pdf-static",
  "vercel",
  "other-non-firebase",
  "malformed",
];
const SAFE_CDP_DIAGNOSTIC_RESOURCE_CLASSES = [
  "document",
  "script",
  "stylesheet",
  "image",
  "font",
  "xhr",
  "fetch",
  "other",
];
const SAFE_CDP_SANITIZER_FAILURE_REASONS = [
  "response-header-collection-invalid",
  "response-rule-id-invalid",
  "response-session-header-duplicate",
  "response-header-name-invalid",
  "response-header-value-invalid",
  "response-session-header-value-invalid",
  "response-session-header-value-too-large",
];
const SAFE_CDP_CORRELATION_FAILURE_REASONS = [
  "response-correlation-same-fetch-terminal-in-flight",
  "response-correlation-same-fetch-terminal-complete",
  "response-correlation-same-fetch-other-retired",
  "response-correlation-same-fetch-active",
  "response-correlation-same-network-single-active-alias",
  "response-correlation-same-network-single-retired-alias",
  "response-correlation-same-network-ambiguous",
  "response-correlation-network-id-unseen",
  "response-correlation-network-id-missing",
  "response-correlation-request-invariant-invalid",
  "response-correlation-request-invariant-mismatch",
  "response-correlation-final-released-invalid-transition",
  "response-correlation-lifecycle-transition-invalid",
  "response-stage-status-invalid",
];
const SAFE_CDP_HANDLER_FAILURE_REASONS = [
  "missing-network-id",
  "network-read-failed",
  "representation-mismatch",
  "maximum-bytes-exceeded",
  "assertion-failed",
  "cdp-protocol-error",
  "target-closed",
  "unexpected-handler-error",
  ...SAFE_CDP_SANITIZER_FAILURE_REASONS,
  ...SAFE_CDP_CORRELATION_FAILURE_REASONS,
];
const SAFE_PRE_TRANSMISSION_BOUNDARY_FAILURE_REASONS = [
  "production",
  "cross-origin-document",
  "unbound-firebase",
  "non-firebase-hostname-not-allowlisted",
  "malformed-url-encoding",
];
const safeCdpDiagnosticServiceForEvent = (event) => {
  try {
    return (
      firebaseServiceForHost(
        new URL(String(event?.request?.url || "")).hostname,
      ) || "non-firebase"
    );
  } catch {
    return "unknown";
  }
};
const safeCdpDiagnosticRequestClassForEvent = (event) => {
  try {
    const hostname = canonicalNetworkHostname(
      new URL(String(event?.request?.url || "")).hostname,
    );
    if (firebaseServiceForHost(hostname)) return "firebase";
    if (BROWSER_PRODUCT_BACKGROUND_DENY_HOSTNAMES.includes(hostname)) {
      return "browser-product-background";
    }
    if (
      hostname ===
      contract.browserTransport.deterministicRecaptchaResponse.hostname
    ) {
      return "recaptcha";
    }
    if (hostname === "www.gstatic.com") return "firebase-static-module";
    if (["fonts.googleapis.com", "fonts.gstatic.com"].includes(hostname)) {
      return "font-static";
    }
    if (hostname === "cdn.quilljs.com") return "quill-static";
    if (hostname === "cdnjs.cloudflare.com") return "pdf-static";
    if (isVercelNetworkHostname(hostname)) return "vercel";
    return "other-non-firebase";
  } catch {
    return "malformed";
  }
};
const safeCdpDiagnosticResourceClassForEvent = (event) => {
  const resourceClass = String(event?.resourceType || "").toLowerCase();
  return SAFE_CDP_DIAGNOSTIC_RESOURCE_CLASSES.includes(resourceClass)
    ? resourceClass
    : "other";
};
const incrementSafeDiagnosticClass = (
  histogram,
  {
    captureStage,
    phase,
    operation,
    reason,
    service,
    requestClass,
    resourceClass,
  },
  allowedReasons,
) => {
  assert.ok(SAFE_CDP_DIAGNOSTIC_CAPTURE_STAGES.includes(captureStage));
  assert.ok(SAFE_CDP_DIAGNOSTIC_PHASES.includes(phase));
  assert.ok(SAFE_CDP_DIAGNOSTIC_OPERATIONS.includes(operation));
  assert.ok(allowedReasons.includes(reason));
  assert.ok(SAFE_CDP_DIAGNOSTIC_SERVICES.includes(service));
  assert.ok(SAFE_CDP_DIAGNOSTIC_REQUEST_CLASSES.includes(requestClass));
  assert.ok(SAFE_CDP_DIAGNOSTIC_RESOURCE_CLASSES.includes(resourceClass));
  const key = JSON.stringify([
    captureStage,
    phase,
    operation,
    reason,
    service,
    requestClass,
    resourceClass,
  ]);
  const previous = histogram.get(key);
  histogram.set(key, {
    captureStage,
    phase,
    operation,
    reason,
    service,
    requestClass,
    resourceClass,
    count: (previous?.count || 0) + 1,
  });
};
const snapshotSafeDiagnosticClasses = (histogram, baseline = new Map()) =>
  [...histogram.entries()]
    .map(([key, value]) => ({
      ...value,
      count: value.count - (baseline.get(key)?.count || 0),
    }))
    .filter(({ count }) => count > 0)
    .sort((left, right) =>
      JSON.stringify(left).localeCompare(JSON.stringify(right)),
    );
const safeDiagnosticClassTotal = (histogram) =>
  [...histogram.values()].reduce((total, value) => total + value.count, 0);
const safeCdpHandlerFailureReason = (error, diagnosticContext) => {
  if (
    error instanceof PausedRequestPostDataResolutionError &&
    SAFE_CDP_HANDLER_FAILURE_REASONS.includes(String(error.code))
  ) {
    return String(error.code);
  }
  if (
    error &&
    typeof error === "object" &&
    String(error.code) === "ERR_ASSERTION"
  ) {
    return [
      ...SAFE_CDP_SANITIZER_FAILURE_REASONS,
      ...SAFE_CDP_CORRELATION_FAILURE_REASONS,
    ].includes(diagnosticContext.reason)
      ? diagnosticContext.reason
      : "assertion-failed";
  }
  const safeErrorName =
    error && typeof error === "object" ? String(error.name || "") : "";
  if (safeErrorName === "ProtocolError") return "cdp-protocol-error";
  if (safeErrorName === "TargetClosedError") return "target-closed";
  return "unexpected-handler-error";
};
let rawSensitivePreTransmissionInspectionCount = 0;
let rawSensitivePreTransmissionBlockCount = 0;
let rawProductionPreTransmissionBlockCount = 0;
let rawVercelBypassPreTransmissionBlockCount = 0;
let rawStagingApiKeyPreTransmissionBlockCount = 0;
let rawTestCredentialPreTransmissionBlockCount = 0;
let rawRefreshTokenPreTransmissionBlockCount = 0;
let rawDebugTokenPreTransmissionBlockCount = 0;
let rawDebugSentinelPreTransmissionBlockCount = 0;
let optionalTelemetrySuppressedRequestCount = 0;
let deterministicHolidayResponseFulfillCount = 0;
let deterministicRecaptchaResponseFulfillCount = 0;
let deterministicFirebaseModuleFulfillCount = 0;
let deterministicResponseScopeMismatchBlockCount = 0;
let externalStaticRequestNetworkFetchCount = 0;
let externalStaticRequestCacheFulfillCount = 0;
let externalStaticRequestScopeMismatchBlockCount = 0;
let externalStaticResponseNon200AbortCount = 0;
let stagingApiKeyScopeViolationBlockCount = 0;
let testCredentialScopeViolationBlockCount = 0;
let refreshTokenScopeViolationBlockCount = 0;
let allowedEgressResponsePauseCount = 0;
let allowedEgressInformationalResponsePauseCount = 0;
let allowedEgressInformationalFinalResponseCount = 0;
let allowedEgressInformationalTrackingResidualCount = 0;
let allowedEgressInvalidResponseStatusAbortCount = 0;
let allowedEgressRedirectAbortCount = 0;
let allowedEgressHttpErrorAbortCount = 0;
let allowedEgressResponseErrorAbortCount = 0;
let allowedEgressPostFinalResponseErrorPauseCount = 0;
let allowedEgressPostFinalContinueResponseSuccessCount = 0;
let allowedEgressPostFinalAlreadyRetiredInterceptionCount = 0;
let allowedEgressInformationalEgressHeaderObservationCount = 0;
let allowedEgressFinalEgressHeaderObservationCount = 0;
let allowedEgressResponseHeaderSuppressionCount = 0;
let allowedEgressEgressHeaderForwardCount = 0;
let allowedEgressTrackingResidualCount = 0;
let externalStaticTrackingResidualCount = 0;
let directBrowserEarlyHintsObservationCount = 0;
let directBrowserEarlyHintsEgressHeaderObservationCount = 0;
let directBrowserEarlyHintsCaptureInvalidationCount = 0;
const directBrowserEarlyHintsObservations = [];
let fullPostDataResolutionCount = 0;
let fullPostDataNetworkFallbackCount = 0;
let fullPostDataResolutionFailureCount = 0;
let fullPostDataOversizeBlockCount = 0;
let fullPostDataRepresentationMismatchBlockCount = 0;
const deterministicResponseObservations = [];
const externalStaticResponseObservations = [];
const optionalTelemetrySuppressionObservations = [];
const externalStaticByteCache = new Map();
const pinnedExternalStaticStartup = await fetchPinnedExternalStaticSources();
for (const [
  browserUrl,
  cachedResponse,
] of pinnedExternalStaticStartup.cacheEntries) {
  externalStaticByteCache.set(
    externalStaticCacheKey({ method: "GET", requestUrl: browserUrl }),
    cachedResponse,
  );
}
const externalStaticStartupSourceAttestations =
  pinnedExternalStaticStartup.attestations;
let nodeOwnedExternalRequestCount =
  externalStaticStartupSourceAttestations.length;
let nodeOwnedExternalInformationalResponseCount =
  externalStaticStartupSourceAttestations.reduce(
    (total, observation) => total + observation.informationalResponseCount,
    0,
  );
let nodeOwnedExternalInformationalEgressHeaderObservationCount =
  externalStaticStartupSourceAttestations.reduce(
    (total, observation) =>
      total + observation.informationalEgressHeaderObservationCount,
    0,
  );
let nodeOwnedExternalInformationalBrowserExposureCount = 0;
let nodeOwnedExternalFinalResponseCount =
  externalStaticStartupSourceAttestations.length;
let nodeOwnedExternalFinalBodyHashAttestationCount =
  externalStaticStartupSourceAttestations.length;
let nodeOwnedExternalFinalHeaderSuppressionCount =
  externalStaticStartupSourceAttestations.reduce(
    (total, observation) => total + observation.finalHeaderSuppressionCount,
    0,
  );
let debugTokenNetworkObservationCount = 0;
let debugSentinelNetworkObservationCount = 0;
let authorizedDebugExchangeBodyReplacementCount = 0;
let unauthorizedDebugTokenEgressCount = 0;
let unauthorizedDebugSentinelEgressCount = 0;
let appCheckHeaderNetworkObservationCount = 0;
let authorizedAppCheckHeaderRequestCount = 0;
let unauthorizedAppCheckHeaderEgressCount = 0;
let sensitiveAppCheckRedirectRequestCount = 0;
let sensitiveAppCheckRedirectAbortRequestCount = 0;
let sensitiveAppCheckCdpResponsePausedRequestCount = 0;
let sensitiveAppCheckRedirectResponseAbortRequestCount = 0;
let sensitiveAppCheckResponseErrorAbortRequestCount = 0;
let sensitiveAppCheckRequestTrackingResidualCount = 0;
let vercelBypassCdpInjectedRequestCount = 0;
let vercelBypassPreexistingHeaderObservationCount = 0;
let unauthorizedVercelBypassEgressCount = 0;
let vercelBypassCdpResponsePausedRequestCount = 0;
let vercelBypassHttpSuccessResponseCount = 0;
let vercelBypassHttpErrorResponseCount = 0;
let vercelBypassRedirectRequestCount = 0;
let vercelBypassRedirectAbortRequestCount = 0;
let vercelBypassRedirectResponseAbortRequestCount = 0;
let vercelBypassResponseErrorAbortRequestCount = 0;
let vercelBypassObservedEligibleRequestCount = 0;
let vercelBypassHeaderObservedRequestCount = 0;
let vercelBypassHeaderMissingRequestCount = 0;
let vercelBypassHeaderMismatchRequestCount = 0;
let pendingBridgeDecisionResidualCount = 0;
let pendingBridgeObservationResidualCount = 0;
let candidateBridgeInjectedRequestCount = 0;
const stableOriginRewriteObservations = [];
const stableOriginRewriteGroups = [];
let stableOriginRewriteRequestCount = 0;
let stableOriginRewriteResponseCount = 0;
let stableOriginRewriteHttpSuccessResponseCount = 0;
let stableOriginRewriteHttpErrorResponseCount = 0;
let stableOriginRewriteRedirectRequestCount = 0;
let stableOriginRewriteRedirectResponseCount = 0;
let stableOriginRewriteResponseErrorCount = 0;
let stableOriginRewriteDocumentRequestCount = 0;
let stableOriginRewriteScriptRequestCount = 0;
let stableOriginRewriteBodyHashCount = 0;
let stableOriginRewriteBodyHashMismatchCount = 0;
let stableOriginRewriteLocalFulfillCount = 0;
let stableOriginRewriteBrowserNetworkRequestCount = 0;
let stableOriginRewriteResponseLinkHeaderForwardCount = 0;
let stableOriginRewriteTrackingResidualCount = 0;
let stableOriginRewriteExternalRequestCount = 0;
let stableOriginRewriteFirebaseGoogleRequestCount = 0;
let stableOriginRewriteScopeMismatchRequestCount = 0;
let directImmutableOriginBrowserRequestCount = 0;
let browserSkipToolbarHeaderObservationCount = 0;
let browserSkipToolbarHeaderPreTransmissionBlockCount = 0;
const createStableOriginRewriteSummary = ({
  stage,
  groupKey,
  observations,
}) => {
  assert.ok(observations.length > 0);
  const upstreamBinding = immutableUpstreamBinding[stage];
  assert.ok(upstreamBinding);
  for (const observation of observations) {
    assert.equal(observation.stage, stage);
    assert.equal(observation.groupKey, groupKey);
    assert.equal(observation.browserOrigin, stableBrowserOrigin);
    assert.equal(observation.upstreamOrigin, upstreamBinding.deploymentUrl);
    assert.equal(
      observation.upstreamDeploymentId,
      upstreamBinding.deploymentId,
    );
    assert.equal(observation.responseError, false);
    assert.equal(observation.redirectRequest, false);
    assert.equal(observation.redirectResponse, false);
    assert.ok(
      Number.isInteger(observation.responseStatus) &&
        observation.responseStatus >= 200 &&
        observation.responseStatus < 300,
    );
  }
  const documentObservations = observations.filter(
    (observation) => observation.resourceType === "Document",
  );
  const scriptObservations = observations.filter(
    (observation) => observation.resourceType === "Script",
  );
  const hashedObservations = observations.filter(
    (observation) => observation.responseBodySha256,
  );
  assert.ok(documentObservations.length > 0);
  assert.ok(scriptObservations.length > 0);
  assert.ok(
    documentObservations.some(
      (observation) =>
        observation.responseBodySha256 && observation.byteMatch === true,
    ),
  );
  assert.ok(
    scriptObservations.some(
      (observation) =>
        observation.responseBodySha256 && observation.byteMatch === true,
    ),
  );
  assert.equal(
    hashedObservations.every(
      (observation) =>
        observation.byteMatch === true &&
        observation.responseBodySha256 ===
          observation.immutableAttestationSha256 &&
        observation.responseBodyBytes === observation.immutableAttestationBytes,
    ),
    true,
  );
  const provenanceRows = observations.map((observation) => ({
    method: observation.method,
    resourceType: observation.resourceType,
    kind: observation.kind,
    browserPath: observation.browserPath,
    browserUrlSha256: observation.browserUrlSha256,
    upstreamUrl: observation.upstreamUrl,
    upstreamUrlSha256: observation.upstreamUrlSha256,
    responseStatus: observation.responseStatus,
    responseBodySha256: observation.responseBodySha256,
    responseBodyBytes: observation.responseBodyBytes,
    immutableAttestationSha256: observation.immutableAttestationSha256,
    immutableAttestationBytes: observation.immutableAttestationBytes,
    byteMatch: observation.byteMatch,
  }));
  const summary = {
    schemaVersion: 1,
    transportContractHash: stableOriginRewriteTransportContractHash,
    immutableUpstreamBindingHash,
    stage,
    browserOrigin: stableBrowserOrigin,
    browserOriginSha256: sha256(stableBrowserOrigin),
    upstreamDeploymentId: upstreamBinding.deploymentId,
    upstreamDeploymentUrl: upstreamBinding.deploymentUrl,
    upstreamDeploymentUrlSha256: upstreamBinding.deploymentUrlSha256,
    upstreamSourceCommitSha: upstreamBinding.sourceCommitSha,
    requestCount: observations.length,
    responseCount: observations.filter(
      (observation) => observation.responseStatus !== null,
    ).length,
    httpSuccessResponseCount: observations.filter(
      (observation) =>
        observation.responseStatus >= 200 && observation.responseStatus < 300,
    ).length,
    httpErrorResponseCount: observations.filter(
      (observation) => observation.responseStatus >= 400,
    ).length,
    documentRequestCount: documentObservations.length,
    scriptRequestCount: scriptObservations.length,
    bodyHashCount: hashedObservations.length,
    bodyHashMatchCount: hashedObservations.filter(
      (observation) => observation.byteMatch === true,
    ).length,
    bodyHashMismatchCount: hashedObservations.filter(
      (observation) => observation.byteMatch === false,
    ).length,
    redirectRequestCount: observations.filter(
      (observation) => observation.redirectRequest,
    ).length,
    redirectResponseCount: observations.filter(
      (observation) => observation.redirectResponse,
    ).length,
    responseErrorCount: observations.filter(
      (observation) => observation.responseError,
    ).length,
    documentBodySha256s: [
      ...new Set(
        documentObservations
          .map((observation) => observation.responseBodySha256)
          .filter(Boolean),
      ),
    ].sort(),
    scriptBodySha256s: [
      ...new Set(
        scriptObservations
          .map((observation) => observation.responseBodySha256)
          .filter(Boolean),
      ),
    ].sort(),
    resourceProvenanceSha256: sha256(
      Buffer.from(canonicalJson(provenanceRows)),
    ),
  };
  return {
    ...summary,
    summarySha256: sha256(Buffer.from(canonicalJson(summary))),
  };
};
const baselineAppCheckBridgeDecision = ({ method, url }) => {
  if (method.toUpperCase() === "OPTIONS") {
    return { eligible: false, scopeMismatch: false };
  }
  const parsed = new URL(url);
  const hostname = parsed.hostname.toLowerCase();
  const service = firebaseServiceForHost(hostname);
  if (!fixtureDataServices.has(service)) {
    return { eligible: false, scopeMismatch: false };
  }
  const transportBound =
    parsed.protocol === "https:" &&
    !parsed.username &&
    !parsed.password &&
    (!parsed.port || parsed.port === "443");
  if (!transportBound) return { eligible: false, scopeMismatch: true };
  if (hostname === "firestore.googleapis.com") {
    const databaseResource =
      `projects/${contract.firebaseProjectId}/databases/(default)`.toLowerCase();
    const pathname = safelyDecodeUrl(parsed.pathname).toLowerCase();
    const escapedProjectId = contract.firebaseProjectId.replace(
      /[.*+?^${}()|[\]\\]/gu,
      "\\$&",
    );
    const pathnameBound = new RegExp(
      `^/v1/projects/${escapedProjectId}/databases/\\(default\\)(?:/|$)`,
      "u",
    ).test(pathname);
    const databaseQuery = String(parsed.searchParams.get("database") || "")
      .replace(/^\/+/, "")
      .toLowerCase();
    const resourceBound = pathnameBound || databaseQuery === databaseResource;
    return {
      eligible: resourceBound,
      scopeMismatch: !resourceBound,
    };
  }
  if (hostname === "firebasestorage.googleapis.com") {
    const storageBoundary = `/v0/b/${String(
      firebaseConfig.storageBucket,
    ).toLowerCase()}/o`;
    const pathname = safelyDecodeUrl(parsed.pathname).toLowerCase();
    const storageBound =
      pathname === storageBoundary ||
      pathname.startsWith(`${storageBoundary}/`);
    return {
      eligible: storageBound,
      scopeMismatch: !storageBound,
    };
  }
  const functionBound =
    hostname ===
      `asia-northeast3-${contract.firebaseProjectId}.cloudfunctions.net` &&
    /^\/[A-Za-z0-9_-]+\/?$/u.test(parsed.pathname);
  return { eligible: functionBound, scopeMismatch: !functionBound };
};
const exactAuthAppCheckHeaderScope = ({ method, url }) => {
  if (method.toUpperCase() === "OPTIONS") return false;
  const parsed = new URL(url);
  const transportBound =
    parsed.protocol === "https:" &&
    !parsed.username &&
    !parsed.password &&
    (!parsed.port || parsed.port === "443");
  if (!transportBound) return false;
  const queryKeys = [...parsed.searchParams.keys()].sort();
  if (
    queryKeys.length !== 1 ||
    queryKeys[0] !== "key" ||
    parsed.searchParams.get("key") !== firebaseConfig.apiKey
  ) {
    return false;
  }
  if (parsed.hostname === "identitytoolkit.googleapis.com") {
    return /^\/v[12]\/accounts:[A-Za-z][A-Za-z0-9]*$/u.test(parsed.pathname);
  }
  return (
    parsed.hostname === "securetoken.googleapis.com" &&
    parsed.pathname === "/v1/token"
  );
};
const exactBrowserDebugExchangeScope = ({ method, url, headers, postData }) => {
  if (method.toUpperCase() !== "POST") return false;
  const parsed = new URL(url);
  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    (parsed.port && parsed.port !== "443") ||
    parsed.hostname !== "content-firebaseappcheck.googleapis.com" ||
    parsed.pathname !==
      `/v1/projects/${contract.firebaseProjectId}/apps/${STAGING_APP_ID}:exchangeDebugToken` ||
    parsed.hash
  ) {
    return false;
  }
  const queryKeys = [...parsed.searchParams.keys()];
  if (
    queryKeys.length !== 1 ||
    queryKeys[0] !== "key" ||
    parsed.searchParams.get("key") !== firebaseConfig.apiKey
  ) {
    return false;
  }
  const contentType = headers.find(
    ({ name }) => name.toLowerCase() === "content-type",
  )?.value;
  if (
    String(contentType || "")
      .trim()
      .toLowerCase() !== "application/json"
  ) {
    return false;
  }
  let body;
  try {
    body = JSON.parse(String(postData || ""));
  } catch (_error) {
    return false;
  }
  return (
    body &&
    typeof body === "object" &&
    !Array.isArray(body) &&
    Object.keys(body).length === 1 &&
    Object.keys(body)[0] === "debug_token" &&
    body.debug_token === APP_CHECK_DEBUG_SENTINEL
  );
};
const browserChildEnvironment = createBrowserChildEnvironment();
const browserChildEnvironmentUnexpectedKeyCount = Object.keys(
  browserChildEnvironment,
).filter(
  (name) => !BROWSER_CHILD_ENVIRONMENT_ALLOWLIST.includes(name.toUpperCase()),
).length;
const browserChildSecretEnvironmentVariableCount =
  BROWSER_SECRET_ENVIRONMENT_VARIABLE_NAMES.filter((name) =>
    Object.hasOwn(browserChildEnvironment, name),
  ).length;
const browserChildSecretValues = [
  appCheckDebugToken,
  credentialsEnvironmentJson,
  firebaseConfigEnvironmentJson,
  ...Object.values(credentials).flatMap((credential) => [
    credential.email,
    credential.password,
  ]),
  firebaseConfig.apiKey,
  bypassSecret,
].filter(Boolean);
const browserChildSecretValueObservationCount = Object.values(
  browserChildEnvironment,
).filter((environmentValue) =>
  browserChildSecretValues.some((secretValue) =>
    String(environmentValue).includes(String(secretValue)),
  ),
).length;
const argvSecretCount = process.argv.filter((argument) =>
  browserChildSecretValues.some((secretValue) =>
    String(argument).includes(String(secretValue)),
  ),
).length;
assert.equal(browserChildSecretEnvironmentVariableCount, 0);
assert.equal(browserChildSecretValueObservationCount, 0);
assert.equal(browserChildEnvironmentUnexpectedKeyCount, 0);
assert.equal(argvSecretCount, 0);
credentialsEnvironmentJson = "";
firebaseConfigEnvironmentJson = "";
browserChildSecretValues.fill("");
const browserConnectProxy = createBrowserConnectProxyGate({
  allowedHostnames: BROWSER_CONNECT_PROXY_ALLOWED_FIREBASE_HOSTNAMES,
  allowedRequestOrigins: [stableBrowserOrigin],
  nonFatalBrowserProductHostnames: BROWSER_PRODUCT_BACKGROUND_DENY_HOSTNAMES,
});
const browserConnectProxyUrl = await browserConnectProxy.start();
const browserConnectProxyServerArgument = `--proxy-server=${browserConnectProxyUrl}`;
const browserLaunchArguments = [
  ...BROWSER_PRETRANSMISSION_LAUNCH_ARGS,
  BROWSER_PROXY_BYPASS_LIST_ARGUMENT,
  browserConnectProxyServerArgument,
];
let browser;
let browserCommandLineAttestation;
try {
  browser = await chromium.launch({
    executablePath: edgeExecutable,
    headless: true,
    env: browserChildEnvironment,
    ignoreDefaultArgs: BROWSER_PRETRANSMISSION_IGNORE_DEFAULT_ARGS,
    args: browserLaunchArguments,
  });
  browserCommandLineAttestation = await attestBrowserPreTransmissionCommandLine(
    browser,
    {
      expectedProxyServerArgument: browserConnectProxyServerArgument,
    },
  );
} catch (error) {
  await browser?.close();
  await browserConnectProxy.close();
  await captureAppCheckTokenManager.close();
  throw error;
}
let browserWideBoundaryController = null;
let browserWideBoundaryFinalSnapshot = null;
let browserConnectProxyFinalSnapshot = null;
const browserWideBoundaryGroupAttestations = [];
const browserVersion = browser.version();
const captureSessionId = randomUUID();
const startedAt = new Date().toISOString();
assert.ok(Date.parse(startedAt) >= fixtureAuditIssuedAt);
assert.ok(
  Date.parse(startedAt) < fixtureAuditExpiresAt,
  "The fixture audit expired before browser capture began.",
);
const captures = [];
const browserAudits = [];
const identityAttestations = new Map();
const networkObservations = [];
const networkResponseObservations = [];
let appCheckInitScriptInjectionCount = 0;
let pageRawDebugTokenInjectionCount = 0;
let browserGlobalRawDebugTokenWriteCount = 0;
let browserGlobalDebugSentinelWriteCount = 0;
let browserLocalStorageSecretWriteCount = 0;
let browserConsoleMessageCount = 0;
let browserConsoleSecretObservationCount = 0;
let browserCorsConsoleErrorCount = 0;
let browserDomSecretObservationCount = 0;
let browserRequestFailureCount = 0;
let browserContextCloseCount = 0;
let unexpectedExtraPageCount = 0;
let unexpectedDedicatedWorkerCount = 0;
let unexpectedServiceWorkerCount = 0;
let unexpectedCrossOriginFrameCount = 0;
let unexpectedOopifTargetCount = 0;
let unexpectedDedicatedWorkerTargetCount = 0;
let unexpectedSharedWorkerTargetCount = 0;
let unexpectedServiceWorkerTargetCount = 0;
let retainedOopifTargetCount = 0;
let retainedDedicatedWorkerTargetCount = 0;
let retainedSharedWorkerTargetCount = 0;
let retainedServiceWorkerTargetCount = 0;
let browserNetworkHeaderAttestationErrorCount = 0;
let targetDiscoveryActivationCount = 0;
let targetSnapshotCount = 0;
let secondaryExecutionGuardInitScriptRegistrationCount = 0;
let playwrightWebSocketRouteRegistrationCount = 0;
let playwrightWebSocketRouteInterceptCount = 0;
let webSocketConnectToServerCount = 0;
let webSocketHandshakeRequestCount = 0;
let webTransportCreatedCount = 0;
const groupedTargets = new Map();
for (const target of targets) {
  const authenticationRole =
    contract.captureAuthenticationRoles[target.screen.id] ??
    (target.screen.role === "support" ? null : target.screen.role);
  const traceRole =
    target.screen.role === "support"
      ? authenticationRole
        ? `support-${authenticationRole}`
        : "support-public"
      : target.screen.role;
  const key = `${target.stage}:${traceRole}:${viewportKey(target.viewport)}`;
  const current = groupedTargets.get(key) || [];
  current.push({ ...target, authenticationRole });
  groupedTargets.set(key, current);
}

try {
  browserWideBoundaryController =
    await installBrowserWidePreTransmissionBoundary({
      browser,
      inspectPausedRequest: ({ event, scope }) =>
        inspectNetworkRequest({
          url: event.request.url,
          method: event.request.method,
          resourceType: event.resourceType,
          apiKeyHeaderValues: extractApiKeyHeaderValues(event.request.headers),
          phase: scope.getNetworkPhase(),
          groupKey: scope.id,
          captureId: scope.getCaptureId(),
          correlationId: `${scope.id}:private-pre-transmission`,
        }),
      inspectSensitiveRequest: ({ event, inspection }) => {
        const headerEntries = Object.entries(event.request.headers || {}).map(
          ([name, value]) => ({ name, value: String(value) }),
        );
        const requestMethod = String(event.request.method).toUpperCase();
        const requestUrl = event.request.url;
        return unifiedSensitivePreTransmissionDecision({
          requestUrl,
          method: requestMethod,
          headers: event.request.headers,
          postData: event.request.postData,
          inspection,
          stagingApiKey: firebaseConfig.apiKey,
          credentialValues: Object.values(credentials).flatMap(
            ({ email, password }) => [String(email), String(password)],
          ),
          debugToken: appCheckDebugToken,
          debugSentinel: APP_CHECK_DEBUG_SENTINEL,
          bypassSecret,
          authCredentialBodyScope: exactAuthCredentialBodyRequestScope({
            requestUrl,
            method: requestMethod,
            stagingApiKey: firebaseConfig.apiKey,
          }),
          refreshTokenBodyScope: exactRefreshTokenBodyRequestScope({
            requestUrl,
            method: requestMethod,
            stagingApiKey: firebaseConfig.apiKey,
          }),
          debugSentinelBodyScope: exactBrowserDebugExchangeScope({
            method: requestMethod,
            url: requestUrl,
            headers: headerEntries,
            postData: String(event.request.postData || ""),
          }),
        });
      },
    });
  for (const [groupKey, groupTargets] of [...groupedTargets.entries()].sort()) {
    const [stage, traceRole, viewportName] = groupKey.split(":");
    const viewport = contract.viewports.find(
      (candidate) => viewportKey(candidate) === viewportName,
    );
    const origin = stableBrowserOrigin;
    const upstreamBinding = immutableUpstreamBinding[stage];
    assert.equal(normalizeOrigin(origin), stableBrowserOrigin);
    assert.equal(upstreamBinding.deploymentUrl, upstreamOrigins[stage]);
    const context = await browser.newContext({
      viewport,
      deviceScaleFactor: contract.requiredDpr,
      locale: "ko-KR",
      timezoneId: "Asia/Seoul",
      reducedMotion: "reduce",
      serviceWorkers: "block",
    });
    const groupBaselineBridgeEligibleStart = baselineBridgeEligibleRequestCount;
    const groupBaselineBridgeInjectedStart = baselineBridgeInjectedRequestCount;
    const groupBaselineBridgeNativeHeaderStart =
      baselineBridgeNativeHeaderRequestCount;
    const groupBaselineBridgeScopeMismatchStart =
      baselineBridgeScopeMismatchRequestCount;
    const groupBaselineBridgeStrippedHeaderStart =
      baselineBridgeStrippedHeaderRequestCount;
    const groupBaselineBridgeRedirectStart = baselineBridgeRedirectRequestCount;
    const groupBaselineBridgeRedirectHeaderAbsentStart =
      baselineBridgeRedirectHeaderAbsentRequestCount;
    const groupBaselineBridgeRedirectAbortStart =
      baselineBridgeRedirectAbortRequestCount;
    const groupBaselineBridgeCdpPausedStart =
      baselineBridgeCdpPausedRequestCount;
    const groupBaselineBridgeCdpResponsePausedStart =
      baselineBridgeCdpResponsePausedRequestCount;
    const groupBaselineBridgeCdpReconciledStart =
      baselineBridgeCdpReconciledRequestCount;
    const groupCandidateBridgeInjectedStart =
      candidateBridgeInjectedRequestCount;
    const groupPageRawDebugTokenInjectionStart =
      pageRawDebugTokenInjectionCount;
    const groupBrowserGlobalRawDebugTokenWriteStart =
      browserGlobalRawDebugTokenWriteCount;
    const groupBrowserGlobalDebugSentinelWriteStart =
      browserGlobalDebugSentinelWriteCount;
    const groupBrowserLocalStorageSecretWriteStart =
      browserLocalStorageSecretWriteCount;
    const groupTargetDiscoveryActivationStart = targetDiscoveryActivationCount;
    const groupTargetSnapshotStart = targetSnapshotCount;
    const groupBaselineBridgeHandlerErrorStart = appCheckCdpHandlerErrorCount;
    const groupCdpHandlerFailureClassCountsStart = new Map(
      cdpHandlerFailureClassCounts,
    );
    const groupPreTransmissionBoundaryBlockClassCountsStart = new Map(
      preTransmissionBoundaryBlockClassCounts,
    );
    const groupBaselineBridgeInjectedRedirectResponseAbortStart =
      baselineBridgeInjectedRedirectResponseAbortCount;
    const groupAppCheckCdpMonitorPausedStart =
      appCheckCdpMonitorPausedRequestCount;
    const groupPreTransmissionBoundaryInspectionStart =
      preTransmissionBoundaryInspectionCount;
    const groupPreTransmissionBoundaryBlockAttemptStart =
      preTransmissionBoundaryBlockAttemptCount;
    const groupPreTransmissionBoundaryProductionBlockStart =
      preTransmissionBoundaryProductionBlockCount;
    const groupPreTransmissionBoundaryCrossOriginDocumentBlockStart =
      preTransmissionBoundaryCrossOriginDocumentBlockCount;
    const groupPreTransmissionBoundaryUnboundFirebaseBlockStart =
      preTransmissionBoundaryUnboundFirebaseBlockCount;
    const groupPreTransmissionBoundaryNonFirebaseHostnameBlockStart =
      preTransmissionBoundaryNonFirebaseHostnameBlockCount;
    const groupPreTransmissionBoundaryMalformedUrlBlockStart =
      preTransmissionBoundaryMalformedUrlBlockCount;
    const groupPreTransmissionBoundaryFailRequestStart =
      preTransmissionBoundaryFailRequestCount;
    const groupOptionalTelemetrySuppressedStart =
      optionalTelemetrySuppressedRequestCount;
    const groupDeterministicHolidayFulfillStart =
      deterministicHolidayResponseFulfillCount;
    const groupDeterministicRecaptchaFulfillStart =
      deterministicRecaptchaResponseFulfillCount;
    const groupDeterministicFirebaseModuleFulfillStart =
      deterministicFirebaseModuleFulfillCount;
    const groupDeterministicScopeMismatchBlockStart =
      deterministicResponseScopeMismatchBlockCount;
    const groupExternalStaticNetworkFetchStart =
      externalStaticRequestNetworkFetchCount;
    const groupExternalStaticCacheFulfillStart =
      externalStaticRequestCacheFulfillCount;
    const groupExternalStaticScopeMismatchBlockStart =
      externalStaticRequestScopeMismatchBlockCount;
    const groupNodeOwnedExternalRequestStart = nodeOwnedExternalRequestCount;
    const groupNodeOwnedExternalInformationalResponseStart =
      nodeOwnedExternalInformationalResponseCount;
    const groupNodeOwnedExternalInformationalEgressHeaderObservationStart =
      nodeOwnedExternalInformationalEgressHeaderObservationCount;
    const groupNodeOwnedExternalInformationalBrowserExposureStart =
      nodeOwnedExternalInformationalBrowserExposureCount;
    const groupNodeOwnedExternalFinalResponseStart =
      nodeOwnedExternalFinalResponseCount;
    const groupNodeOwnedExternalFinalBodyHashAttestationStart =
      nodeOwnedExternalFinalBodyHashAttestationCount;
    const groupNodeOwnedExternalFinalHeaderSuppressionStart =
      nodeOwnedExternalFinalHeaderSuppressionCount;
    const groupExternalStaticResponseNon200AbortStart =
      externalStaticResponseNon200AbortCount;
    const groupStagingApiKeyScopeViolationBlockStart =
      stagingApiKeyScopeViolationBlockCount;
    const groupTestCredentialScopeViolationBlockStart =
      testCredentialScopeViolationBlockCount;
    const groupRefreshTokenScopeViolationBlockStart =
      refreshTokenScopeViolationBlockCount;
    const groupRawSensitiveInspectionStart =
      rawSensitivePreTransmissionInspectionCount;
    const groupRawSensitiveBlockStart = rawSensitivePreTransmissionBlockCount;
    const groupRawProductionBlockStart = rawProductionPreTransmissionBlockCount;
    const groupRawVercelBypassBlockStart =
      rawVercelBypassPreTransmissionBlockCount;
    const groupRawStagingApiKeyBlockStart =
      rawStagingApiKeyPreTransmissionBlockCount;
    const groupRawTestCredentialBlockStart =
      rawTestCredentialPreTransmissionBlockCount;
    const groupRawRefreshTokenBlockStart =
      rawRefreshTokenPreTransmissionBlockCount;
    const groupRawDebugTokenBlockStart = rawDebugTokenPreTransmissionBlockCount;
    const groupRawDebugSentinelBlockStart =
      rawDebugSentinelPreTransmissionBlockCount;
    const groupAllowedEgressResponsePauseStart =
      allowedEgressResponsePauseCount;
    const groupAllowedEgressInformationalResponsePauseStart =
      allowedEgressInformationalResponsePauseCount;
    const groupAllowedEgressInformationalFinalResponseStart =
      allowedEgressInformationalFinalResponseCount;
    const groupAllowedEgressInvalidResponseStatusAbortStart =
      allowedEgressInvalidResponseStatusAbortCount;
    const groupAllowedEgressRedirectAbortStart =
      allowedEgressRedirectAbortCount;
    const groupAllowedEgressHttpErrorAbortStart =
      allowedEgressHttpErrorAbortCount;
    const groupAllowedEgressResponseErrorAbortStart =
      allowedEgressResponseErrorAbortCount;
    const groupAllowedEgressInformationalEgressHeaderObservationStart =
      allowedEgressInformationalEgressHeaderObservationCount;
    const groupAllowedEgressFinalEgressHeaderObservationStart =
      allowedEgressFinalEgressHeaderObservationCount;
    const groupAllowedEgressResponseHeaderSuppressionStart =
      allowedEgressResponseHeaderSuppressionCount;
    const groupAllowedEgressEgressHeaderForwardStart =
      allowedEgressEgressHeaderForwardCount;
    const groupDirectBrowserEarlyHintsObservationStart =
      directBrowserEarlyHintsObservationCount;
    const groupDirectBrowserEarlyHintsEgressHeaderObservationStart =
      directBrowserEarlyHintsEgressHeaderObservationCount;
    const groupDirectBrowserEarlyHintsCaptureInvalidationStart =
      directBrowserEarlyHintsCaptureInvalidationCount;
    const groupFullPostDataResolutionStart = fullPostDataResolutionCount;
    const groupFullPostDataNetworkFallbackStart =
      fullPostDataNetworkFallbackCount;
    const groupFullPostDataResolutionFailureStart =
      fullPostDataResolutionFailureCount;
    const groupFullPostDataOversizeBlockStart = fullPostDataOversizeBlockCount;
    const groupFullPostDataRepresentationMismatchBlockStart =
      fullPostDataRepresentationMismatchBlockCount;
    const groupDebugTokenNetworkObservationStart =
      debugTokenNetworkObservationCount;
    const groupDebugSentinelNetworkObservationStart =
      debugSentinelNetworkObservationCount;
    const groupAuthorizedDebugExchangeBodyReplacementStart =
      authorizedDebugExchangeBodyReplacementCount;
    const groupUnauthorizedDebugTokenEgressStart =
      unauthorizedDebugTokenEgressCount;
    const groupUnauthorizedDebugSentinelEgressStart =
      unauthorizedDebugSentinelEgressCount;
    const groupAppCheckHeaderNetworkObservationStart =
      appCheckHeaderNetworkObservationCount;
    const groupAuthorizedAppCheckHeaderRequestStart =
      authorizedAppCheckHeaderRequestCount;
    const groupUnauthorizedAppCheckHeaderEgressStart =
      unauthorizedAppCheckHeaderEgressCount;
    const groupSensitiveAppCheckRedirectRequestStart =
      sensitiveAppCheckRedirectRequestCount;
    const groupSensitiveAppCheckRedirectAbortRequestStart =
      sensitiveAppCheckRedirectAbortRequestCount;
    const groupSensitiveAppCheckCdpResponsePausedStart =
      sensitiveAppCheckCdpResponsePausedRequestCount;
    const groupSensitiveAppCheckRedirectResponseAbortStart =
      sensitiveAppCheckRedirectResponseAbortRequestCount;
    const groupSensitiveAppCheckResponseErrorAbortStart =
      sensitiveAppCheckResponseErrorAbortRequestCount;
    const groupVercelBypassCdpInjectedStart =
      vercelBypassCdpInjectedRequestCount;
    const groupVercelBypassPreexistingHeaderObservationStart =
      vercelBypassPreexistingHeaderObservationCount;
    const groupUnauthorizedVercelBypassEgressStart =
      unauthorizedVercelBypassEgressCount;
    const groupVercelBypassCdpResponsePausedStart =
      vercelBypassCdpResponsePausedRequestCount;
    const groupVercelBypassHttpSuccessResponseStart =
      vercelBypassHttpSuccessResponseCount;
    const groupVercelBypassHttpErrorResponseStart =
      vercelBypassHttpErrorResponseCount;
    const groupVercelBypassRedirectRequestStart =
      vercelBypassRedirectRequestCount;
    const groupVercelBypassRedirectAbortRequestStart =
      vercelBypassRedirectAbortRequestCount;
    const groupVercelBypassRedirectResponseAbortStart =
      vercelBypassRedirectResponseAbortRequestCount;
    const groupVercelBypassResponseErrorAbortStart =
      vercelBypassResponseErrorAbortRequestCount;
    const groupVercelBypassObservedEligibleStart =
      vercelBypassObservedEligibleRequestCount;
    const groupVercelBypassHeaderObservedStart =
      vercelBypassHeaderObservedRequestCount;
    const groupVercelBypassHeaderMissingStart =
      vercelBypassHeaderMissingRequestCount;
    const groupVercelBypassHeaderMismatchStart =
      vercelBypassHeaderMismatchRequestCount;
    let networkPhase = "context-bootstrap";
    let activeCaptureId = null;
    let groupBrowserWideBoundaryAttestation = null;
    let networkRequestSequence = 0;
    const requestCorrelations = new WeakMap();
    const requestObservations = new WeakMap();
    const requestHeaderAttestations = new WeakMap();
    const pendingNetworkAttestations = new Set();
    let networkHeaderAttestationErrorCount = 0;
    const trackNetworkAttestation = (promise) => {
      pendingNetworkAttestations.add(promise);
      promise.finally(() => pendingNetworkAttestations.delete(promise));
      return promise;
    };
    const flushNetworkAttestations = async () => {
      while (pendingNetworkAttestations.size > 0) {
        await Promise.all([...pendingNetworkAttestations]);
      }
      assert.equal(
        networkHeaderAttestationErrorCount,
        0,
        "A browser request header attestation failed.",
      );
    };
    let appCheckCdpSession = null;
    const appCheckCdpHandlerPromises = new Set();
    let groupPendingBridgeDecisionResidualCount = 0;
    let groupPendingBridgeObservationResidualCount = 0;
    let groupSensitiveRequestTrackingResidualCount = 0;
    let groupStableOriginRewriteTrackingResidualCount = 0;
    let groupAllowedEgressTrackingResidualCount = 0;
    let groupExternalStaticTrackingResidualCount = 0;
    let groupInformationalResponseTrackingResidualCount = 0;
    let groupRetainedPageCount = 0;
    let groupServiceWorkerCount = 0;
    const groupNetworkObservationStart = networkObservations.length;
    const groupNetworkResponseObservationStart =
      networkResponseObservations.length;
    const groupStableOriginRewriteObservationStart =
      stableOriginRewriteObservations.length;
    const groupDeterministicResponseObservationStart =
      deterministicResponseObservations.length;
    const groupExternalStaticResponseObservationStart =
      externalStaticResponseObservations.length;
    const groupOptionalTelemetryObservationStart =
      optionalTelemetrySuppressionObservations.length;
    const groupCaptureAttestations = [];
    context.on("request", (request) => {
      if (
        optionalTelemetrySuppressionDecision({
          requestUrl: request.url(),
          method: request.method(),
        }).eligible
      ) {
        return;
      }
      const appCheckHeaderValue =
        request.headers()["x-firebase-appcheck"] || "";
      const appCheckHeaderPresent = Boolean(appCheckHeaderValue);
      const appCheckHeaderJwtShapeValid =
        APP_CHECK_JWT_SHAPE_PATTERN.test(appCheckHeaderValue);
      const correlation = {
        correlationId: `${groupKey}:request-${networkRequestSequence}`,
        phase: networkPhase,
        captureId: activeCaptureId,
        appCheckHeaderPresent,
        appCheckHeaderSource: appCheckHeaderPresent ? "native-sdk" : null,
        appCheckHeaderJwtShapeValid,
        appCheckBridgeDecisionObserved: false,
        appCheckBridgeScopeEligible: false,
        appCheckBridgeHeaderStripped: false,
        appCheckBridgeRedirectedRequest: false,
        apiKeyHeaderValues: extractApiKeyHeaderValues(request.headers()),
      };
      networkRequestSequence += 1;
      requestCorrelations.set(request, correlation);
      const observation = inspectNetworkRequest({
        url: request.url(),
        method: request.method(),
        resourceType: request.resourceType(),
        apiKeyHeaderValues: extractApiKeyHeaderValues(request.headers()),
        phase: correlation.phase,
        groupKey,
        captureId: correlation.captureId,
        correlationId: correlation.correlationId,
        appCheckHeaderPresent,
        appCheckHeaderSource: correlation.appCheckHeaderSource,
        appCheckHeaderJwtShapeValid,
      });
      requestObservations.set(request, observation);
      networkObservations.push(observation);
      const headerAttestation = trackNetworkAttestation(
        (async () => {
          const allHeaders = await request.allHeaders();
          browserSkipToolbarHeaderObservationCount += Number(
            hasVercelSkipToolbarRequestHeader(allHeaders),
          );
          correlation.apiKeyHeaderValues =
            extractApiKeyHeaderValues(allHeaders);
          const reconciledBoundaryObservation = inspectNetworkRequest({
            url: request.url(),
            method: request.method(),
            resourceType: request.resourceType(),
            apiKeyHeaderValues: correlation.apiKeyHeaderValues,
            phase: correlation.phase,
            groupKey,
            captureId: correlation.captureId,
            correlationId: correlation.correlationId,
          });
          for (const field of [
            "canonicalHostname",
            "firebaseService",
            "isFirebaseRequest",
            "nonFirebaseHostnameAllowed",
            "nonFirebasePolicyRuleId",
            "stagingMarker",
            "productionMarker",
            "unboundFirebaseRequest",
            "malformedUrlEncoding",
            "apiKeySha256",
            "apiKeyValueCount",
            "apiKeyBindingValid",
            "firebaseTransportValid",
            "serviceResourceBound",
            "productionWrite",
            "observedProjectIds",
          ]) {
            observation[field] = reconciledBoundaryObservation[field];
          }
          const effectiveVercelBypassHeader =
            allHeaders["x-vercel-protection-bypass"] || "";
          const vercelBypassObservationEligible = false;
          if (vercelBypassObservationEligible) {
            vercelBypassObservedEligibleRequestCount += 1;
            if (effectiveVercelBypassHeader) {
              vercelBypassHeaderObservedRequestCount += 1;
            } else {
              vercelBypassHeaderMissingRequestCount += 1;
            }
          }
          if (
            effectiveVercelBypassHeader &&
            (!vercelBypassObservationEligible ||
              effectiveVercelBypassHeader !== bypassSecret)
          ) {
            vercelBypassHeaderMismatchRequestCount += 1;
          }
          const effectiveHeaderValue = allHeaders["x-firebase-appcheck"] || "";
          const effectiveHeaderPresent = Boolean(effectiveHeaderValue);
          const effectiveHeaderJwtShapeValid =
            APP_CHECK_JWT_SHAPE_PATTERN.test(effectiveHeaderValue);
          const bridgeInjectedHeader =
            stage === "baseline" &&
            captureAppCheckTokenManager.matchesIssuedToken(
              effectiveHeaderValue,
            );
          const effectiveHeaderSource = effectiveHeaderPresent
            ? bridgeInjectedHeader
              ? "baseline-cdp-fetch-bridge"
              : "native-sdk"
            : null;
          const bridgeDecision = baselineAppCheckBridgeDecision({
            method: request.method(),
            url: request.url(),
          });
          const update = {
            appCheckHeaderPresent: effectiveHeaderPresent,
            appCheckHeaderSource: effectiveHeaderSource,
            appCheckHeaderJwtShapeValid: effectiveHeaderJwtShapeValid,
            appCheckBridgeDecisionObserved: stage === "baseline",
            appCheckBridgeScopeEligible:
              stage === "baseline" && bridgeDecision.eligible,
            appCheckBridgeHeaderStripped: false,
            appCheckBridgeRedirectedRequest:
              stage === "baseline" && Boolean(request.redirectedFrom()),
          };
          Object.assign(correlation, update);
          Object.assign(observation, update);
          if (stage === "baseline") {
            baselineBridgeCdpReconciledRequestCount += 1;
          }
        })().catch(() => {
          networkHeaderAttestationErrorCount += 1;
          browserNetworkHeaderAttestationErrorCount += 1;
        }),
      );
      requestHeaderAttestations.set(request, headerAttestation);
    });
    context.on("response", (response) => {
      const request = response.request();
      trackNetworkAttestation(
        (async () => {
          await requestHeaderAttestations.get(request);
          const correlation = requestCorrelations.get(request);
          assert.ok(
            correlation,
            "A browser response has no originating request.",
          );
          networkResponseObservations.push({
            ...inspectNetworkRequest({
              url: response.url(),
              method: request.method(),
              resourceType: request.resourceType(),
              apiKeyHeaderValues: correlation.apiKeyHeaderValues,
              phase: correlation.phase,
              groupKey,
              captureId: correlation.captureId,
              correlationId: correlation.correlationId,
              appCheckHeaderPresent: correlation.appCheckHeaderPresent,
              appCheckHeaderSource: correlation.appCheckHeaderSource,
              appCheckHeaderJwtShapeValid:
                correlation.appCheckHeaderJwtShapeValid,
              appCheckBridgeDecisionObserved:
                correlation.appCheckBridgeDecisionObserved,
              appCheckBridgeScopeEligible:
                correlation.appCheckBridgeScopeEligible,
              appCheckBridgeHeaderStripped:
                correlation.appCheckBridgeHeaderStripped,
              appCheckBridgeRedirectedRequest:
                correlation.appCheckBridgeRedirectedRequest,
            }),
            status: response.status(),
          });
        })().catch(() => {
          networkHeaderAttestationErrorCount += 1;
          browserNetworkHeaderAttestationErrorCount += 1;
        }),
      );
    });
    await context.addInitScript(fixedClockScript, {
      fixedTimestamp: fixedTime,
    });
    await context.addInitScript(blockBrowserSecondaryExecutionAndWebTransport);
    secondaryExecutionGuardInitScriptRegistrationCount += 1;
    await context.routeWebSocket("**/*", async (webSocketRoute) => {
      playwrightWebSocketRouteInterceptCount += 1;
      await webSocketRoute.close({
        code: 1008,
        reason: "W10P pre-transmission boundary",
      });
    });
    playwrightWebSocketRouteRegistrationCount += 1;
    const groupBrowserWideBoundaryStart =
      browserWideBoundaryController.snapshot();
    browserWideBoundaryController.activate({
      id: groupKey,
      stableBrowserOrigin: origin,
      stagingApiKey: firebaseConfig.apiKey,
      getNetworkPhase: () => networkPhase,
      getCaptureId: () => activeCaptureId,
    });
    let groupPageCount = 0;
    context.on("page", () => {
      groupPageCount += 1;
    });
    const page = await context.newPage();
    let groupDedicatedWorkerCount = 0;
    let groupUnexpectedCrossOriginFrameCount = 0;
    let groupOopifTargetCount = 0;
    let groupDedicatedWorkerTargetCount = 0;
    let groupSharedWorkerTargetCount = 0;
    let groupServiceWorkerTargetCount = 0;
    let groupRetainedOopifTargetCount = 0;
    let groupRetainedDedicatedWorkerTargetCount = 0;
    let groupRetainedSharedWorkerTargetCount = 0;
    let groupRetainedServiceWorkerTargetCount = 0;
    const discoveredTargetIdsByType = new Map(
      ["iframe", "worker", "shared_worker", "service_worker"].map((type) => [
        type,
        new Set(),
      ]),
    );
    const observedCrossOriginFrames = new WeakSet();
    const observeFrameOrigin = (frame) => {
      if (frame === page.mainFrame() || observedCrossOriginFrames.has(frame)) {
        return;
      }
      const frameUrl = String(frame.url() || "");
      let parsedFrameUrl;
      try {
        parsedFrameUrl = new URL(frameUrl);
      } catch (_error) {
        return;
      }
      if (!["http:", "https:"].includes(parsedFrameUrl.protocol)) return;
      if (parsedFrameUrl.origin !== origin) {
        observedCrossOriginFrames.add(frame);
        groupUnexpectedCrossOriginFrameCount += 1;
      }
    };
    page.on("framenavigated", observeFrameOrigin);
    page.on("worker", () => {
      groupDedicatedWorkerCount += 1;
    });
    const appCheckDebugInitArgument = {
      allowedOrigin: origin,
      debugToken: APP_CHECK_DEBUG_SENTINEL,
    };
    const pageInitArgumentContainsRawDebugToken = Object.values(
      appCheckDebugInitArgument,
    ).some((value) => value === appCheckDebugToken);
    pageRawDebugTokenInjectionCount += Number(
      pageInitArgumentContainsRawDebugToken,
    );
    assert.equal(
      pageInitArgumentContainsRawDebugToken,
      false,
      "The App Check page init argument contained the raw debug token.",
    );
    assert.equal(
      appCheckDebugInitArgument.debugToken === APP_CHECK_DEBUG_SENTINEL,
      true,
      "The App Check page init argument must contain only the fixed sentinel.",
    );
    await page.addInitScript(
      appCheckDebugInitScript,
      appCheckDebugInitArgument,
    );
    appCheckInitScriptInjectionCount += 1;
    if (stage === "baseline") {
      await captureAppCheckTokenManager.ensureFresh();
    }
    appCheckCdpSession = await context.newCDPSession(page);
    await appCheckCdpSession.send("Network.enable", {
      maxPostDataSize: FETCH_INLINE_POST_DATA_LIMIT_BYTES,
    });
    appCheckCdpSession.on(
      "Network.responseReceivedEarlyHints",
      ({ requestId, headers }) => {
        const responseHeaders = Object.entries(headers || {}).map(
          ([name, value]) => ({ name, value: String(value) }),
        );
        let egressHeaderObservationCount = 0;
        try {
          egressHeaderObservationCount =
            sanitizeBrowserResponseHeaders(
              responseHeaders,
            ).egressHeaderObservationCount;
        } catch {
          // Invalid early-hints headers are capture-fatal under the same policy.
        }
        directBrowserEarlyHintsObservationCount += 1;
        directBrowserEarlyHintsEgressHeaderObservationCount +=
          egressHeaderObservationCount;
        directBrowserEarlyHintsCaptureInvalidationCount += 1;
        directBrowserEarlyHintsObservations.push({
          schemaVersion: 1,
          stage,
          groupKey,
          requestIdSha256: sha256(String(requestId)),
          headerNames: responseHeaders
            .map(({ name }) => String(name).toLowerCase())
            .sort(),
          headerSetSha256: sha256(canonicalJson(responseHeaders)),
          egressHeaderObservationCount,
          captureInvalidated: true,
          semantics: "observed-after-receipt-not-pre-transmission-block",
        });
        networkHeaderAttestationErrorCount += 1;
        browserNetworkHeaderAttestationErrorCount += 1;
      },
    );
    appCheckCdpSession.on("Network.webSocketWillSendHandshakeRequest", () => {
      webSocketHandshakeRequestCount += 1;
    });
    appCheckCdpSession.on("Network.webTransportCreated", () => {
      webTransportCreatedCount += 1;
    });
    const currentTarget = await appCheckCdpSession.send("Target.getTargetInfo");
    const groupBrowserContextId = currentTarget.targetInfo.browserContextId;
    assert.ok(groupBrowserContextId);
    appCheckCdpSession.on("Target.targetCreated", ({ targetInfo }) => {
      const observedTargetIds = discoveredTargetIdsByType.get(targetInfo.type);
      if (
        observedTargetIds &&
        targetInfo.browserContextId === groupBrowserContextId
      ) {
        observedTargetIds.add(targetInfo.targetId);
      }
    });
    await appCheckCdpSession.send("Target.setDiscoverTargets", {
      discover: true,
    });
    targetDiscoveryActivationCount += 1;
    const sensitiveAppCheckRequestsByFetchRequestId = new Map();
    const stableOriginRewriteRequestsByFetchRequestId = new Map();
    const allowedEgressRequestsByFetchRequestId = new Map();
    const informationalResponseRequestsByFetchRequestId = new Set();
    const allowedEgressLifecycleByFetchRequestId = new Map();
    const allowedEgressFetchRequestIdsByNetworkId = new Map();
    const cdpHandlerDiagnosticContexts = new WeakMap();
    const cdpHandlerPrimaryRequestIds = new WeakMap();
    const allowedEgressHandlerTaskCoordinator =
      createPerCorrelationTaskCoordinator();
    const allowedEgressProxyAuthorizationCoordinator =
      createSingleOwnerProxyAuthorizationCoordinator({
        onAuthorize: (requestId, authorization) => {
          browserConnectProxy.authorizeRequestStage({
            requestId,
            ...authorization,
          });
        },
        onComplete: (requestId) => {
          browserConnectProxy.completeRequestStageAuthorization(requestId);
        },
        onRevoke: (requestId) => {
          browserConnectProxy.revokeRequestStageAuthorization(requestId);
        },
      });
    const allowedEgressLifecycleStates = new Set([
      "request-continue-in-flight",
      "response-awaiting",
      "request-continue-failed",
      "final-response-command-in-flight",
      "final-response-released",
      "post-final-error-command-in-flight",
      "terminal-command-in-flight",
      "terminal-complete",
      "post-final-error-observed-retired",
      "redirect-retired",
      "handler-failed",
    ]);
    const recordAllowedEgressRequestStageLifecycle = (
      event,
      diagnosticPhase,
    ) => {
      assert.equal(typeof event.requestId, "string");
      assert.ok(SAFE_CDP_DIAGNOSTIC_PHASES.includes(diagnosticPhase));
      assert.equal(
        allowedEgressLifecycleByFetchRequestId.has(event.requestId),
        false,
      );
      const requestInvariant = allowedEgressRequestInvariantForEvent(event);
      assert.ok(requestInvariant);
      const networkId =
        typeof event.networkId === "string" && event.networkId.length > 0
          ? event.networkId
          : null;
      allowedEgressLifecycleByFetchRequestId.set(
        event.requestId,
        Object.freeze({
          primaryRequestId: event.requestId,
          requestInvariant,
          networkId,
          state: "request-continue-in-flight",
          diagnosticPhase,
        }),
      );
      if (networkId !== null) {
        const aliases =
          allowedEgressFetchRequestIdsByNetworkId.get(networkId) || new Set();
        aliases.add(event.requestId);
        allowedEgressFetchRequestIdsByNetworkId.set(networkId, aliases);
      }
    };
    const setAllowedEgressLifecycleState = (requestId, state) => {
      assert.ok(allowedEgressLifecycleStates.has(state));
      const lifecycle =
        allowedEgressLifecycleByFetchRequestId.get(requestId) || null;
      if (lifecycle === null) return;
      allowedEgressLifecycleByFetchRequestId.set(
        requestId,
        Object.freeze({ ...lifecycle, state }),
      );
    };
    const resolveResponseCorrelationForEvent = (event) =>
      resolveAllowedEgressResponseCorrelation({
        event,
        lifecycleByFetchRequestId: allowedEgressLifecycleByFetchRequestId,
        fetchRequestIdsByNetworkId: allowedEgressFetchRequestIdsByNetworkId,
      });
    const correlatedDiagnosticPhaseForEvent = (event) => {
      if (
        event.responseStatusCode !== undefined ||
        event.responseErrorReason !== undefined
      ) {
        const correlation = resolveResponseCorrelationForEvent(event);
        const correlatedPhase = correlation.lifecycle?.diagnosticPhase || null;
        if (correlatedPhase !== null) return correlatedPhase;
      }
      const directPhase =
        allowedEgressRequestsByFetchRequestId.get(event.requestId)
          ?.diagnosticPhase || null;
      if (directPhase !== null) return directPhase;
      const sameFetchPhase =
        allowedEgressLifecycleByFetchRequestId.get(event.requestId)
          ?.diagnosticPhase || null;
      if (sameFetchPhase !== null) return sameFetchPhase;
      const networkIdPresent =
        typeof event.networkId === "string" && event.networkId.length > 0;
      if (!networkIdPresent) return networkPhase;
      const networkAliasPhases = [
        ...(allowedEgressFetchRequestIdsByNetworkId.get(event.networkId) || []),
      ]
        .filter((requestId) => requestId !== event.requestId)
        .map(
          (requestId) =>
            allowedEgressLifecycleByFetchRequestId.get(requestId)
              ?.diagnosticPhase || null,
        )
        .filter((phase) => phase !== null);
      return networkAliasPhases.length === 1
        ? networkAliasPhases[0]
        : networkPhase;
    };
    const continueInspectedDirectFirebaseRequest = async ({
      event,
      requestUrl,
      requestMethod,
      requestHeaders,
      requestPostData,
      preTransmissionInspection,
      diagnosticContext,
      overrides = {},
    }) => {
      assert.equal(preTransmissionInspection.isFirebaseRequest, true);
      assert.equal(preTransmissionInspection.stagingMarker, true);
      const allowedEgressObservation =
        allowedEgressRequestsByFetchRequestId.get(event.requestId);
      assert.ok(allowedEgressObservation);
      const conditionalResponseHeaderRuleId =
        exactStagingFirestoreWebChannelEncodedApiKeyBodyScope({
          requestUrl,
          method: requestMethod,
          headers: requestHeaders,
          postData: requestPostData,
          stagingApiKey: firebaseConfig.apiKey,
          inspection: preTransmissionInspection,
        })
          ? FIRESTORE_WEBCHANNEL_SESSION_RESPONSE_RULE_ID
          : null;
      allowedEgressRequestsByFetchRequestId.set(
        event.requestId,
        Object.freeze({
          ...allowedEgressObservation,
          conditionalResponseHeaderRuleId,
          diagnosticPhase: diagnosticContext.phase,
        }),
      );
      recordAllowedEgressRequestStageLifecycle(event, diagnosticContext.phase);
      diagnosticContext.operation = "request-proxy-authorize";
      diagnosticContext.reason = "unexpected-handler-error";
      allowedEgressProxyAuthorizationCoordinator.authorize(event.requestId, {
        requestUrl,
        requestMethod,
        requestOrigin: stableBrowserOrigin,
        stage,
      });
      try {
        diagnosticContext.operation = "request-continue";
        await appCheckCdpSession.send("Fetch.continueRequest", {
          requestId: event.requestId,
          ...overrides,
          interceptResponse: true,
        });
        setAllowedEgressLifecycleState(event.requestId, "response-awaiting");
      } catch (error) {
        setAllowedEgressLifecycleState(
          event.requestId,
          "request-continue-failed",
        );
        allowedEgressProxyAuthorizationCoordinator.revoke(event.requestId);
        allowedEgressRequestsByFetchRequestId.delete(event.requestId);
        sensitiveAppCheckRequestsByFetchRequestId.delete(event.requestId);
        throw error;
      }
    };
    const handlePausedRequest = async (event) => {
      const diagnosticContext = cdpHandlerDiagnosticContexts.get(event);
      assert.ok(diagnosticContext);
      if (
        event.responseStatusCode !== undefined ||
        event.responseErrorReason !== undefined
      ) {
        diagnosticContext.operation = "response-correlation";
        diagnosticContext.reason = "unexpected-handler-error";
        const responseCorrelation = resolveResponseCorrelationForEvent(event);
        if (responseCorrelation.primaryRequestId !== null) {
          cdpHandlerPrimaryRequestIds.set(
            event,
            responseCorrelation.primaryRequestId,
          );
        }
        diagnosticContext.reason =
          responseCorrelation.reason || "unexpected-handler-error";
        assert.equal(
          responseCorrelation.valid,
          true,
          "A response-stage request pause failed exact correlation.",
        );
        const primaryRequestId = responseCorrelation.primaryRequestId;
        assert.equal(typeof primaryRequestId, "string");
        const lifecycle =
          allowedEgressLifecycleByFetchRequestId.get(primaryRequestId) || null;
        assert.ok(lifecycle);
        diagnosticContext.reason = "response-stage-status-invalid";
        const responseStageDecision = responseStageCorrelationDecision({
          responseStatusCode: event.responseStatusCode,
          responseErrorReason: event.responseErrorReason,
        });
        const lifecycleDecision = allowedEgressResponseLifecycleDecision({
          lifecycleState: lifecycle.state,
          responseStageDecision,
        });
        diagnosticContext.reason =
          lifecycleDecision.reason || "unexpected-handler-error";
        assert.equal(
          lifecycleDecision.valid,
          true,
          "A response-stage request pause had an invalid lifecycle transition.",
        );
        if (lifecycleDecision.kind === "post-final-error") {
          // Chromium can re-pause a streamed response with its body error after
          // final headers were released. Preserve that original terminal error.
          assert.equal(responseStageDecision.kind, "response-error");
          assert.equal(
            allowedEgressProxyAuthorizationCoordinator.stateFor(
              primaryRequestId,
            ),
            "completed",
          );
          allowedEgressPostFinalResponseErrorPauseCount += 1;
          setAllowedEgressLifecycleState(
            primaryRequestId,
            "post-final-error-command-in-flight",
          );
          diagnosticContext.operation = "response-continue-final";
          diagnosticContext.reason = "unexpected-handler-error";
          try {
            await appCheckCdpSession.send(
              "Fetch.continueResponse",
              postFinalErrorContinueResponseParams(event.requestId),
            );
            allowedEgressPostFinalContinueResponseSuccessCount += 1;
          } catch (error) {
            if (!isPostFinalAlreadyRetiredInterceptionError(error)) {
              throw error;
            }
            // A reload/cancel can retire the interception after Chromium emits
            // the terminal event but before Playwright delivers it to JS.
            allowedEgressPostFinalAlreadyRetiredInterceptionCount += 1;
            setAllowedEgressLifecycleState(
              primaryRequestId,
              "post-final-error-observed-retired",
            );
            return;
          }
          setAllowedEgressLifecycleState(primaryRequestId, "terminal-complete");
          return;
        }
        assert.equal(lifecycleDecision.kind, "primary");
        const sensitiveRequestKind =
          sensitiveAppCheckRequestsByFetchRequestId.get(primaryRequestId);
        const rewriteObservation =
          stableOriginRewriteRequestsByFetchRequestId.get(primaryRequestId);
        const allowedEgressObservation =
          allowedEgressRequestsByFetchRequestId.get(primaryRequestId);
        diagnosticContext.reason =
          "response-correlation-lifecycle-transition-invalid";
        assert.ok(allowedEgressObservation);
        const completeProxyAuthorization = () => {
          diagnosticContext.operation = "response-proxy-complete";
          diagnosticContext.reason = "unexpected-handler-error";
          assert.equal(
            allowedEgressProxyAuthorizationCoordinator.complete(
              primaryRequestId,
            ),
            true,
          );
        };
        if (responseStageDecision.kind === "response-error") {
          allowedEgressResponsePauseCount += 1;
          if (sensitiveRequestKind) {
            sensitiveAppCheckCdpResponsePausedRequestCount += 1;
          }
          if (sensitiveRequestKind === "baseline-cdp-fetch-bridge") {
            baselineBridgeCdpResponsePausedRequestCount += 1;
          }
          if (sensitiveRequestKind === "vercel-bypass-header") {
            vercelBypassCdpResponsePausedRequestCount += 1;
          }
          allowedEgressResponseErrorAbortCount += 1;
          if (sensitiveRequestKind) {
            sensitiveAppCheckResponseErrorAbortRequestCount += 1;
          }
          if (sensitiveRequestKind === "vercel-bypass-header") {
            vercelBypassResponseErrorAbortRequestCount += 1;
          }
          if (rewriteObservation) {
            stableOriginRewriteResponseErrorCount += 1;
            rewriteObservation.responseError = true;
          }
          setAllowedEgressLifecycleState(
            primaryRequestId,
            "terminal-command-in-flight",
          );
          allowedEgressRequestsByFetchRequestId.delete(primaryRequestId);
          sensitiveAppCheckRequestsByFetchRequestId.delete(primaryRequestId);
          stableOriginRewriteRequestsByFetchRequestId.delete(primaryRequestId);
          informationalResponseRequestsByFetchRequestId.delete(
            primaryRequestId,
          );
          diagnosticContext.operation = "response-fail";
          await appCheckCdpSession.send("Fetch.failRequest", {
            requestId: event.requestId,
            errorReason: "BlockedByClient",
          });
          completeProxyAuthorization();
          setAllowedEgressLifecycleState(primaryRequestId, "terminal-complete");
          return;
        }
        const responseStatus = responseStageDecision.status;
        if (responseStageDecision.kind === "informational") {
          assert.equal(responseStageDecision.terminal, false);
          allowedEgressInformationalResponsePauseCount += 1;
          informationalResponseRequestsByFetchRequestId.add(primaryRequestId);
          diagnosticContext.operation = "response-sanitize-informational";
          diagnosticContext.reason = "unexpected-handler-error";
          const sanitizedInformational = sanitizeBrowserResponseHeaders(
            event.responseHeaders || [],
            {
              onDiagnosticCheck: (reason) => {
                diagnosticContext.reason = reason;
              },
            },
          );
          allowedEgressInformationalEgressHeaderObservationCount +=
            sanitizedInformational.egressHeaderObservationCount;
          allowedEgressResponseHeaderSuppressionCount +=
            sanitizedInformational.omittedHeaderCount;
          diagnosticContext.operation = "response-continue-informational";
          diagnosticContext.reason = "unexpected-handler-error";
          await appCheckCdpSession.send("Fetch.continueResponse", {
            requestId: event.requestId,
            responseCode: responseStatus,
            responseHeaders: sanitizedInformational.responseHeaders,
          });
          setAllowedEgressLifecycleState(primaryRequestId, "response-awaiting");
          return;
        }
        if (responseStageDecision.kind === "invalid-pre-final") {
          assert.equal(responseStageDecision.terminal, true);
          allowedEgressInvalidResponseStatusAbortCount += 1;
          setAllowedEgressLifecycleState(
            primaryRequestId,
            "terminal-command-in-flight",
          );
          allowedEgressRequestsByFetchRequestId.delete(primaryRequestId);
          sensitiveAppCheckRequestsByFetchRequestId.delete(primaryRequestId);
          stableOriginRewriteRequestsByFetchRequestId.delete(primaryRequestId);
          informationalResponseRequestsByFetchRequestId.delete(
            primaryRequestId,
          );
          diagnosticContext.operation = "response-fail";
          diagnosticContext.reason = "unexpected-handler-error";
          await appCheckCdpSession.send("Fetch.failRequest", {
            requestId: event.requestId,
            errorReason: "BlockedByClient",
          });
          completeProxyAuthorization();
          setAllowedEgressLifecycleState(primaryRequestId, "terminal-complete");
          return;
        }
        assert.equal(responseStageDecision.kind, "final");
        assert.equal(responseStageDecision.terminal, true);
        allowedEgressResponsePauseCount += 1;
        const finalConditionalResponseHeaderRuleId =
          responseStatus >= 200 && responseStatus < 300
            ? allowedEgressObservation?.conditionalResponseHeaderRuleId || null
            : null;
        diagnosticContext.operation = "response-sanitize-final";
        diagnosticContext.reason = "unexpected-handler-error";
        const sanitizedFinal = sanitizeBrowserResponseHeaders(
          event.responseHeaders || [],
          {
            conditionalResponseHeaderRuleId:
              finalConditionalResponseHeaderRuleId,
            onDiagnosticCheck: (reason) => {
              diagnosticContext.reason = reason;
            },
          },
        );
        allowedEgressFinalEgressHeaderObservationCount +=
          sanitizedFinal.egressHeaderObservationCount;
        allowedEgressResponseHeaderSuppressionCount +=
          sanitizedFinal.omittedHeaderCount;
        if (
          informationalResponseRequestsByFetchRequestId.delete(primaryRequestId)
        ) {
          allowedEgressInformationalFinalResponseCount += 1;
        }
        if (sensitiveRequestKind) {
          sensitiveAppCheckCdpResponsePausedRequestCount += 1;
        }
        if (sensitiveRequestKind === "baseline-cdp-fetch-bridge") {
          baselineBridgeCdpResponsePausedRequestCount += 1;
        }
        if (sensitiveRequestKind === "vercel-bypass-header") {
          vercelBypassCdpResponsePausedRequestCount += 1;
        }
        if (rewriteObservation) {
          stableOriginRewriteResponseCount += 1;
          rewriteObservation.responseStatus = responseStatus;
          rewriteObservation.responseError = false;
          if (responseStatus >= 200 && responseStatus < 300) {
            stableOriginRewriteHttpSuccessResponseCount += 1;
          } else if (responseStatus >= 400) {
            stableOriginRewriteHttpErrorResponseCount += 1;
          }
        }
        if (sensitiveRequestKind === "vercel-bypass-header") {
          if (responseStatus >= 200 && responseStatus < 300) {
            vercelBypassHttpSuccessResponseCount += 1;
          } else {
            vercelBypassHttpErrorResponseCount += 1;
          }
        }
        if (responseStatus >= 300) {
          if (redirectResponseMustAbort(responseStatus)) {
            allowedEgressRedirectAbortCount += 1;
          } else {
            allowedEgressHttpErrorAbortCount += 1;
          }
          if (sensitiveRequestKind) {
            sensitiveAppCheckRedirectResponseAbortRequestCount += 1;
          }
          if (sensitiveRequestKind === "baseline-cdp-fetch-bridge") {
            baselineBridgeInjectedRedirectResponseAbortCount += 1;
          }
          if (sensitiveRequestKind === "vercel-bypass-header") {
            vercelBypassRedirectResponseAbortRequestCount += 1;
          }
          if (rewriteObservation) {
            stableOriginRewriteRedirectResponseCount += 1;
            rewriteObservation.redirectResponse = true;
          }
          setAllowedEgressLifecycleState(
            primaryRequestId,
            "terminal-command-in-flight",
          );
          allowedEgressRequestsByFetchRequestId.delete(primaryRequestId);
          sensitiveAppCheckRequestsByFetchRequestId.delete(primaryRequestId);
          stableOriginRewriteRequestsByFetchRequestId.delete(primaryRequestId);
          diagnosticContext.operation = "response-fail";
          diagnosticContext.reason = "unexpected-handler-error";
          await appCheckCdpSession.send("Fetch.failRequest", {
            requestId: event.requestId,
            errorReason: "BlockedByClient",
          });
          completeProxyAuthorization();
          setAllowedEgressLifecycleState(primaryRequestId, "terminal-complete");
          return;
        }
        if (rewriteObservation) {
          rewriteObservation.redirectResponse = false;
          const responseBodyHashRequired =
            rewriteObservation.method === "GET" &&
            contract.browserTransport.responseBodyHashResourceTypes.includes(
              rewriteObservation.resourceType,
            );
          if (responseBodyHashRequired) {
            diagnosticContext.operation = "response-body-attestation";
            diagnosticContext.reason = "unexpected-handler-error";
            const responseBody = await appCheckCdpSession.send(
              "Fetch.getResponseBody",
              { requestId: event.requestId },
            );
            const browserBytes = Buffer.from(
              responseBody.body,
              responseBody.base64Encoded ? "base64" : "utf8",
            );
            const immutableAttestation =
              await fetchImmutableResourceAttestation(
                stage,
                rewriteObservation.upstreamUrl,
              );
            rewriteObservation.responseBodySha256 = sha256(browserBytes);
            rewriteObservation.responseBodyBytes = browserBytes.length;
            rewriteObservation.immutableAttestationSha256 =
              immutableAttestation.sha256;
            rewriteObservation.immutableAttestationBytes =
              immutableAttestation.bytes;
            rewriteObservation.byteMatch =
              rewriteObservation.responseBodySha256 ===
                immutableAttestation.sha256 &&
              rewriteObservation.responseBodyBytes ===
                immutableAttestation.bytes;
            stableOriginRewriteBodyHashCount += 1;
            stableOriginRewriteBodyHashMismatchCount += Number(
              !rewriteObservation.byteMatch,
            );
            assert.equal(
              rewriteObservation.byteMatch,
              true,
              `${stage} ${rewriteObservation.resourceType} bytes did not match the immutable deployment.`,
            );
          } else {
            rewriteObservation.responseBodySha256 = null;
            rewriteObservation.responseBodyBytes = null;
            rewriteObservation.immutableAttestationSha256 = null;
            rewriteObservation.immutableAttestationBytes = null;
            rewriteObservation.byteMatch = null;
          }
          stableOriginRewriteRequestsByFetchRequestId.delete(primaryRequestId);
        }
        setAllowedEgressLifecycleState(
          primaryRequestId,
          "final-response-command-in-flight",
        );
        sensitiveAppCheckRequestsByFetchRequestId.delete(primaryRequestId);
        allowedEgressRequestsByFetchRequestId.delete(primaryRequestId);
        diagnosticContext.operation = "response-continue-final";
        diagnosticContext.reason = "unexpected-handler-error";
        await appCheckCdpSession.send("Fetch.continueResponse", {
          requestId: event.requestId,
          responseCode: responseStatus,
          responseHeaders: sanitizedFinal.responseHeaders,
        });
        completeProxyAuthorization();
        setAllowedEgressLifecycleState(
          primaryRequestId,
          "final-response-released",
        );
        return;
      }
      if (hasVercelSkipToolbarRequestHeader(event.request.headers)) {
        browserSkipToolbarHeaderPreTransmissionBlockCount += 1;
        diagnosticContext.operation = "request-fail";
        diagnosticContext.reason = "unexpected-handler-error";
        await appCheckCdpSession.send("Fetch.failRequest", {
          requestId: event.requestId,
          errorReason: "BlockedByClient",
        });
        return;
      }
      diagnosticContext.operation = "request-post-data";
      diagnosticContext.reason = "unexpected-handler-error";
      const resolvedPostData = await resolvePausedRequestPostData({
        event,
        send: (method, params) => appCheckCdpSession.send(method, params),
      });
      fullPostDataResolutionCount += 1;
      fullPostDataNetworkFallbackCount += Number(
        resolvedPostData.source === "network-domain",
      );
      appCheckCdpMonitorPausedRequestCount += 1;
      if (stage === "baseline") baselineBridgeCdpPausedRequestCount += 1;
      const requestUrl = event.request.url;
      const requestMethod = String(event.request.method).toUpperCase();
      const headerEntries = Object.entries(event.request.headers || {}).map(
        ([name, value]) => ({ name, value: String(value) }),
      );
      const postData = resolvedPostData.postData;
      const preTransmissionApiKeyHeaderValues = extractApiKeyHeaderValues(
        event.request.headers,
      );
      const preTransmissionInspection = inspectNetworkRequest({
        url: requestUrl,
        method: requestMethod,
        resourceType: event.resourceType,
        apiKeyHeaderValues: preTransmissionApiKeyHeaderValues,
        phase: networkPhase,
        groupKey,
        captureId: activeCaptureId,
        correlationId: `${groupKey}:cdp-pre-transmission-${appCheckCdpMonitorPausedRequestCount}`,
      });
      diagnosticContext.operation = "request-pre-transmission";
      diagnosticContext.reason = "unexpected-handler-error";
      diagnosticContext.service =
        preTransmissionInspection.firebaseService ||
        (preTransmissionInspection.isFirebaseRequest
          ? "unknown"
          : "non-firebase");
      preTransmissionBoundaryInspectionCount += 1;
      const exactAuthCredentialBodyScope = exactAuthCredentialBodyRequestScope({
        requestUrl,
        method: requestMethod,
        stagingApiKey: firebaseConfig.apiKey,
      });
      const testCredentialValues = Object.values(credentials).flatMap(
        ({ email, password }) => [String(email), String(password)],
      );
      const exactRefreshTokenBodyScope = exactRefreshTokenBodyRequestScope({
        requestUrl,
        method: requestMethod,
        stagingApiKey: firebaseConfig.apiKey,
      });
      const exactDebugSentinelBodyScope = exactBrowserDebugExchangeScope({
        method: requestMethod,
        url: requestUrl,
        headers: headerEntries,
        postData,
      });
      rawSensitivePreTransmissionInspectionCount += 1;
      const rawSensitiveDecision = unifiedSensitivePreTransmissionDecision({
        requestUrl,
        method: requestMethod,
        headers: event.request.headers,
        postData,
        inspection: preTransmissionInspection,
        stagingApiKey: firebaseConfig.apiKey,
        credentialValues: testCredentialValues,
        debugToken: appCheckDebugToken,
        debugSentinel: APP_CHECK_DEBUG_SENTINEL,
        bypassSecret,
        authCredentialBodyScope: exactAuthCredentialBodyScope,
        refreshTokenBodyScope: exactRefreshTokenBodyScope,
        debugSentinelBodyScope: exactDebugSentinelBodyScope,
      });
      if (!rawSensitiveDecision.valid) {
        rawSensitivePreTransmissionBlockCount += 1;
        rawProductionPreTransmissionBlockCount += Number(
          rawSensitiveDecision.marker === "production",
        );
        rawVercelBypassPreTransmissionBlockCount += Number(
          rawSensitiveDecision.marker === "vercel-bypass-scope",
        );
        rawStagingApiKeyPreTransmissionBlockCount += Number(
          rawSensitiveDecision.marker === "staging-api-key-scope",
        );
        rawTestCredentialPreTransmissionBlockCount += Number(
          rawSensitiveDecision.marker === "test-credential-scope",
        );
        rawRefreshTokenPreTransmissionBlockCount += Number(
          rawSensitiveDecision.marker === "refresh-token-scope",
        );
        rawDebugTokenPreTransmissionBlockCount += Number(
          rawSensitiveDecision.marker === "debug-token-scope",
        );
        rawDebugSentinelPreTransmissionBlockCount += Number(
          rawSensitiveDecision.marker === "debug-sentinel-scope",
        );
        if (rawSensitiveDecision.marker === "production") {
          preTransmissionBoundaryBlockAttemptCount += 1;
          preTransmissionBoundaryProductionBlockCount += 1;
        }
        stagingApiKeyScopeViolationBlockCount += Number(
          rawSensitiveDecision.marker === "staging-api-key-scope",
        );
        testCredentialScopeViolationBlockCount += Number(
          rawSensitiveDecision.marker === "test-credential-scope",
        );
        refreshTokenScopeViolationBlockCount += Number(
          rawSensitiveDecision.marker === "refresh-token-scope",
        );
        if (rawSensitiveDecision.marker === "debug-token-scope") {
          debugTokenNetworkObservationCount += 1;
          unauthorizedDebugTokenEgressCount += 1;
        }
        if (rawSensitiveDecision.marker === "debug-sentinel-scope") {
          debugSentinelNetworkObservationCount += 1;
          unauthorizedDebugSentinelEgressCount += 1;
        }
        if (rawSensitiveDecision.marker === "vercel-bypass-scope") {
          vercelBypassPreexistingHeaderObservationCount += Number(
            headerEntries.some(
              ({ name }) => name.toLowerCase() === "x-vercel-protection-bypass",
            ),
          );
          unauthorizedVercelBypassEgressCount += 1;
        }
        diagnosticContext.operation = "request-fail";
        diagnosticContext.reason = "unexpected-handler-error";
        if (rawSensitiveDecision.marker === "production") {
          incrementSafeDiagnosticClass(
            preTransmissionBoundaryBlockClassCounts,
            {
              captureStage: stage,
              phase: diagnosticContext.phase,
              operation: "request-fail",
              reason: "production",
              service: diagnosticContext.service,
              requestClass: diagnosticContext.requestClass,
              resourceClass: diagnosticContext.resourceClass,
            },
            SAFE_PRE_TRANSMISSION_BOUNDARY_FAILURE_REASONS,
          );
        }
        await appCheckCdpSession.send("Fetch.failRequest", {
          requestId: event.requestId,
          errorReason: "BlockedByClient",
        });
        if (rawSensitiveDecision.marker === "production") {
          preTransmissionBoundaryFailRequestCount += 1;
        }
        return;
      }
      const telemetryDecision = optionalTelemetrySuppressionDecision({
        requestUrl,
        method: requestMethod,
      });
      if (telemetryDecision.eligible) {
        optionalTelemetrySuppressedRequestCount += 1;
        optionalTelemetrySuppressionObservations.push({
          schemaVersion: 1,
          stage,
          groupKey,
          method: requestMethod,
          hostname: telemetryDecision.hostname,
          requestUrlSha256: sha256(requestUrl),
          rawSensitiveInspectionPassed: true,
        });
        diagnosticContext.operation = "request-fail";
        diagnosticContext.reason = "unexpected-handler-error";
        await appCheckCdpSession.send("Fetch.failRequest", {
          requestId: event.requestId,
          errorReason: "BlockedByClient",
        });
        return;
      }
      const preTransmissionDecision = preTransmissionBoundaryDecision({
        ...preTransmissionInspection,
        crossOriginDocument: isCrossOriginDocumentRequest({
          requestUrl,
          resourceType: event.resourceType,
          stableBrowserOrigin,
        }),
      });
      if (preTransmissionDecision.block) {
        preTransmissionBoundaryBlockAttemptCount += 1;
        preTransmissionBoundaryProductionBlockCount += Number(
          preTransmissionDecision.marker === "production",
        );
        preTransmissionBoundaryCrossOriginDocumentBlockCount += Number(
          preTransmissionDecision.marker === "cross-origin-document",
        );
        preTransmissionBoundaryUnboundFirebaseBlockCount += Number(
          preTransmissionDecision.marker === "unbound-firebase",
        );
        preTransmissionBoundaryNonFirebaseHostnameBlockCount += Number(
          preTransmissionDecision.marker ===
            "non-firebase-hostname-not-allowlisted",
        );
        preTransmissionBoundaryMalformedUrlBlockCount += Number(
          preTransmissionDecision.marker === "malformed-url-encoding",
        );
        diagnosticContext.operation = "request-fail";
        diagnosticContext.reason = "unexpected-handler-error";
        incrementSafeDiagnosticClass(
          preTransmissionBoundaryBlockClassCounts,
          {
            captureStage: stage,
            phase: diagnosticContext.phase,
            operation: "request-fail",
            reason: preTransmissionDecision.marker,
            service: diagnosticContext.service,
            requestClass: diagnosticContext.requestClass,
            resourceClass: diagnosticContext.resourceClass,
          },
          SAFE_PRE_TRANSMISSION_BOUNDARY_FAILURE_REASONS,
        );
        await appCheckCdpSession.send("Fetch.failRequest", {
          requestId: event.requestId,
          errorReason: "BlockedByClient",
        });
        preTransmissionBoundaryFailRequestCount += 1;
        return;
      }
      diagnosticContext.operation = "request-policy";
      diagnosticContext.reason = "unexpected-handler-error";
      const deterministicDecision = deterministicResponseDecision({
        requestUrl,
        method: requestMethod,
        resourceType: event.resourceType,
        headers: event.request.headers,
        postData,
        stableBrowserOrigin,
      });
      if (deterministicDecision.scoped) {
        if (!deterministicDecision.eligible) {
          deterministicResponseScopeMismatchBlockCount += 1;
          diagnosticContext.operation = "request-fail";
          diagnosticContext.reason = "unexpected-handler-error";
          await appCheckCdpSession.send("Fetch.failRequest", {
            requestId: event.requestId,
            errorReason: "BlockedByClient",
          });
          return;
        }
        const payload = deterministicFulfillPayload(
          deterministicDecision.responseContract,
        );
        if (
          deterministicDecision.id ===
          contract.browserTransport.deterministicLocalResponse.id
        ) {
          deterministicHolidayResponseFulfillCount += 1;
        } else {
          deterministicRecaptchaResponseFulfillCount += 1;
        }
        deterministicResponseObservations.push({
          schemaVersion: 1,
          stage,
          groupKey,
          id: deterministicDecision.id,
          requestUrlSha256: sha256(requestUrl),
          browserOrigin: stableBrowserOrigin,
          year: deterministicDecision.year,
          responseStatus: payload.responseCode,
          responseBodySha256: payload.bodySha256,
          responseBodyBytes: payload.bodyBytes,
        });
        diagnosticContext.operation = "request-fulfill";
        diagnosticContext.reason = "unexpected-handler-error";
        await appCheckCdpSession.send("Fetch.fulfillRequest", {
          requestId: event.requestId,
          responseCode: payload.responseCode,
          responseHeaders: payload.responseHeaders,
          body: payload.body,
        });
        return;
      }
      const externalStaticDecision = externalStaticRequestDecision({
        requestUrl,
        method: requestMethod,
        resourceType: event.resourceType,
        headers: event.request.headers,
        postData,
      });
      if (externalStaticDecision.scoped) {
        if (!externalStaticDecision.eligible) {
          externalStaticRequestScopeMismatchBlockCount += 1;
          diagnosticContext.operation = "request-fail";
          diagnosticContext.reason = "unexpected-handler-error";
          await appCheckCdpSession.send("Fetch.failRequest", {
            requestId: event.requestId,
            errorReason: "BlockedByClient",
          });
          return;
        }
        if (externalStaticDecision.action === "local-node-module-fulfill") {
          const payload = localFirebaseModulePayload(requestUrl);
          deterministicFirebaseModuleFulfillCount += 1;
          deterministicResponseObservations.push({
            schemaVersion: 1,
            stage,
            groupKey,
            id: externalStaticDecision.rule.id,
            requestUrlSha256: sha256(requestUrl),
            browserOrigin: stableBrowserOrigin,
            year: null,
            responseStatus: payload.responseCode,
            responseBodySha256: payload.bodySha256,
            responseBodyBytes: payload.bodyBytes,
          });
          diagnosticContext.operation = "request-fulfill";
          diagnosticContext.reason = "unexpected-handler-error";
          await appCheckCdpSession.send("Fetch.fulfillRequest", {
            requestId: event.requestId,
            responseCode: payload.responseCode,
            responseHeaders: payload.responseHeaders,
            body: payload.body,
          });
          return;
        }
        const cacheKey = externalStaticCacheKey({
          method: requestMethod,
          requestUrl,
        });
        const cachedExternal = externalStaticByteCache.get(cacheKey);
        if (cachedExternal) {
          externalStaticRequestCacheFulfillCount += 1;
          externalStaticResponseObservations.push({
            schemaVersion: 1,
            stage,
            groupKey,
            ruleId: externalStaticDecision.rule.id,
            requestUrl,
            requestUrlSha256: sha256(requestUrl),
            method: requestMethod,
            resourceType: event.resourceType,
            requestBodyAbsent: true,
            sensitiveHeaderAbsent: true,
            source:
              externalStaticDecision.action ===
              "startup-pinned-source-fetch-then-local-fulfill"
                ? "startup-pinned-source-cache"
                : "baseline-byte-cache",
            sourceUrlSha256: cachedExternal.sourceUrlSha256 || null,
            responseStatus: 200,
            responseBodySha256: cachedExternal.bodySha256,
            responseBodyBytes: cachedExternal.bodyBytes,
            requestContractHash: cachedExternal.requestContractHash,
            cacheKeySha256: sha256(cacheKey),
            nodeOwnedNetworkRequest: false,
            informationalResponseCount:
              cachedExternal.informationalResponseCount,
            informationalEgressHeaderObservationCount:
              cachedExternal.informationalEgressHeaderObservationCount,
            informationalBrowserExposureCount:
              cachedExternal.informationalBrowserExposureCount,
            finalHeaderSuppressionCount:
              cachedExternal.finalHeaderSuppressionCount,
          });
          diagnosticContext.operation = "request-fulfill";
          diagnosticContext.reason = "unexpected-handler-error";
          await appCheckCdpSession.send("Fetch.fulfillRequest", {
            requestId: event.requestId,
            responseCode: 200,
            responseHeaders: cachedExternal.responseHeaders,
            body: cachedExternal.body,
          });
          return;
        }
        assert.equal(stage, "baseline");
        externalStaticRequestNetworkFetchCount += 1;
        nodeOwnedExternalRequestCount += 1;
        let fetchedExternal;
        try {
          diagnosticContext.operation = "request-node-fetch";
          diagnosticContext.reason = "unexpected-handler-error";
          fetchedExternal = await nodeOwnedExactExternalStaticGet({
            requestUrl,
            expectedHostname: externalStaticDecision.rule.hostname,
            expectedPort: "443",
          });
        } catch (error) {
          externalStaticResponseNon200AbortCount += Number(
            error instanceof NodeOwnedExternalStaticFetchError &&
              ["redirect-response", "non-200-response"].includes(error.code),
          );
          allowedEgressRedirectAbortCount += Number(
            error instanceof NodeOwnedExternalStaticFetchError &&
              error.code === "redirect-response",
          );
          allowedEgressHttpErrorAbortCount += Number(
            error instanceof NodeOwnedExternalStaticFetchError &&
              error.code === "non-200-response",
          );
          throw error;
        }
        for (const informational of fetchedExternal.informationalResponses) {
          assert.equal(informational.terminal, false);
          allowedEgressInformationalResponsePauseCount += 1;
          allowedEgressInformationalEgressHeaderObservationCount +=
            informational.egressHeaderObservationCount;
          allowedEgressResponseHeaderSuppressionCount +=
            informational.headerSuppressionCount;
        }
        nodeOwnedExternalInformationalResponseCount +=
          fetchedExternal.informationalResponses.length;
        nodeOwnedExternalInformationalEgressHeaderObservationCount +=
          fetchedExternal.informationalResponses.reduce(
            (total, informational) =>
              total + informational.egressHeaderObservationCount,
            0,
          );
        allowedEgressInformationalFinalResponseCount += Number(
          fetchedExternal.informationalResponses.length > 0,
        );
        allowedEgressResponsePauseCount += 1;
        allowedEgressFinalEgressHeaderObservationCount +=
          fetchedExternal.finalEgressHeaderObservationCount;
        allowedEgressResponseHeaderSuppressionCount +=
          fetchedExternal.finalHeaderSuppressionCount;
        nodeOwnedExternalFinalResponseCount += 1;
        nodeOwnedExternalFinalBodyHashAttestationCount += 1;
        nodeOwnedExternalFinalHeaderSuppressionCount +=
          fetchedExternal.finalHeaderSuppressionCount;
        const nodeOwnedCachedExternal = {
          body: fetchedExternal.body.toString("base64"),
          bodySha256: fetchedExternal.bodySha256,
          bodyBytes: fetchedExternal.bodyBytes,
          responseHeaders: fetchedExternal.responseHeaders,
          sourceUrlSha256: sha256(fetchedExternal.requestUrl),
          requestContractHash: secretSha256(
            JSON.stringify(NODE_OWNED_EXTERNAL_STATIC_REQUEST_CONTRACT),
          ),
          informationalResponseCount:
            fetchedExternal.informationalResponses.length,
          informationalEgressHeaderObservationCount:
            fetchedExternal.informationalResponses.reduce(
              (total, informational) =>
                total + informational.egressHeaderObservationCount,
              0,
            ),
          informationalBrowserExposureCount: 0,
          finalHeaderSuppressionCount:
            fetchedExternal.finalHeaderSuppressionCount,
        };
        externalStaticByteCache.set(cacheKey, nodeOwnedCachedExternal);
        externalStaticResponseObservations.push({
          schemaVersion: 1,
          stage,
          groupKey,
          ruleId: externalStaticDecision.rule.id,
          requestUrl,
          requestUrlSha256: sha256(requestUrl),
          method: requestMethod,
          resourceType: event.resourceType,
          requestBodyAbsent: true,
          sensitiveHeaderAbsent: true,
          source: "baseline-node-network",
          sourceUrlSha256: nodeOwnedCachedExternal.sourceUrlSha256,
          responseStatus: fetchedExternal.responseStatus,
          responseBodySha256: nodeOwnedCachedExternal.bodySha256,
          responseBodyBytes: nodeOwnedCachedExternal.bodyBytes,
          requestContractHash: nodeOwnedCachedExternal.requestContractHash,
          cacheKeySha256: sha256(cacheKey),
          nodeOwnedNetworkRequest: true,
          informationalResponseCount:
            nodeOwnedCachedExternal.informationalResponseCount,
          informationalEgressHeaderObservationCount:
            nodeOwnedCachedExternal.informationalEgressHeaderObservationCount,
          informationalBrowserExposureCount:
            nodeOwnedCachedExternal.informationalBrowserExposureCount,
          finalHeaderSuppressionCount:
            nodeOwnedCachedExternal.finalHeaderSuppressionCount,
        });
        diagnosticContext.operation = "request-fulfill";
        diagnosticContext.reason = "unexpected-handler-error";
        await appCheckCdpSession.send("Fetch.fulfillRequest", {
          requestId: event.requestId,
          responseCode: fetchedExternal.responseStatus,
          responseHeaders: nodeOwnedCachedExternal.responseHeaders,
          body: nodeOwnedCachedExternal.body,
        });
        return;
      }
      const rewriteDecision = stableOriginRewriteDecision({
        stage,
        requestUrl,
        method: requestMethod,
        resourceType: event.resourceType,
        browserOrigin: stableBrowserOrigin,
        upstreamOrigins,
        transportContract: contract.browserTransport,
      });
      const requestOrigin = new URL(requestUrl).origin;
      if (
        Object.values(upstreamOrigins).includes(requestOrigin) &&
        !rewriteDecision.eligible
      ) {
        directImmutableOriginBrowserRequestCount += 1;
        stableOriginRewriteScopeMismatchRequestCount += 1;
        diagnosticContext.operation = "request-fail";
        diagnosticContext.reason = "unexpected-handler-error";
        await appCheckCdpSession.send("Fetch.failRequest", {
          requestId: event.requestId,
          errorReason: "BlockedByClient",
        });
        return;
      }
      if (rewriteDecision.stableOriginRequest && !rewriteDecision.eligible) {
        stableOriginRewriteScopeMismatchRequestCount += 1;
        diagnosticContext.operation = "request-fail";
        diagnosticContext.reason = "unexpected-handler-error";
        await appCheckCdpSession.send("Fetch.failRequest", {
          requestId: event.requestId,
          errorReason: "BlockedByClient",
        });
        return;
      }
      const debugSentinelInUrl = requestUrl.includes(APP_CHECK_DEBUG_SENTINEL);
      const debugSentinelInHeaders = headerEntries.some(({ value }) =>
        value.includes(APP_CHECK_DEBUG_SENTINEL),
      );
      const debugSentinelInPostData = postData.includes(
        APP_CHECK_DEBUG_SENTINEL,
      );
      const debugSentinelObserved =
        debugSentinelInUrl || debugSentinelInHeaders || debugSentinelInPostData;
      let replaceDebugExchangeBody = false;
      if (debugSentinelObserved) {
        debugSentinelNetworkObservationCount += 1;
        assert.equal(debugSentinelInUrl, false);
        assert.equal(debugSentinelInHeaders, false);
        assert.equal(debugSentinelInPostData, true);
        assert.equal(exactDebugSentinelBodyScope, true);
        replaceDebugExchangeBody = true;
      }
      const appCheckHeaderEntry = headerEntries.find(
        ({ name }) => name.toLowerCase() === "x-firebase-appcheck",
      );
      const nativeHeaderValue = appCheckHeaderEntry?.value || "";
      const nativeHeaderPresent = Boolean(nativeHeaderValue);
      const nativeHeaderJwtShapeValid =
        APP_CHECK_JWT_SHAPE_PATTERN.test(nativeHeaderValue);
      const redirectedSensitiveRequestKind = event.redirectedRequestId
        ? sensitiveAppCheckRequestsByFetchRequestId.get(
            event.redirectedRequestId,
          ) || ""
        : "";
      const redirectedRewriteObservation = event.redirectedRequestId
        ? stableOriginRewriteRequestsByFetchRequestId.get(
            event.redirectedRequestId,
          )
        : null;
      const redirectedAllowedEgressObservation = event.redirectedRequestId
        ? allowedEgressRequestsByFetchRequestId.get(event.redirectedRequestId)
        : null;
      if (
        redirectedSensitiveRequestKind ||
        redirectedRewriteObservation ||
        redirectedAllowedEgressObservation
      ) {
        allowedEgressRedirectAbortCount += 1;
        if (redirectedSensitiveRequestKind) {
          sensitiveAppCheckRedirectRequestCount += 1;
          sensitiveAppCheckRedirectAbortRequestCount += 1;
        }
        if (redirectedSensitiveRequestKind === "baseline-cdp-fetch-bridge") {
          baselineBridgeRedirectRequestCount += 1;
          baselineBridgeRedirectHeaderAbsentRequestCount += 1;
          baselineBridgeRedirectAbortRequestCount += 1;
        }
        if (redirectedSensitiveRequestKind === "vercel-bypass-header") {
          vercelBypassRedirectRequestCount += 1;
          vercelBypassRedirectAbortRequestCount += 1;
        }
        if (redirectedRewriteObservation) {
          stableOriginRewriteRedirectRequestCount += 1;
          redirectedRewriteObservation.redirectRequest = true;
        }
        if (event.redirectedRequestId) {
          assert.equal(
            allowedEgressProxyAuthorizationCoordinator.complete(
              event.redirectedRequestId,
            ),
            Boolean(redirectedAllowedEgressObservation),
          );
          setAllowedEgressLifecycleState(
            event.redirectedRequestId,
            "redirect-retired",
          );
          allowedEgressRequestsByFetchRequestId.delete(
            event.redirectedRequestId,
          );
        }
        diagnosticContext.operation = "request-fail";
        diagnosticContext.reason = "unexpected-handler-error";
        await appCheckCdpSession.send("Fetch.failRequest", {
          requestId: event.requestId,
          errorReason: "BlockedByClient",
        });
        return;
      }
      const decision = baselineAppCheckBridgeDecision({
        method: requestMethod,
        url: requestUrl,
      });
      if (nativeHeaderPresent) {
        appCheckHeaderNetworkObservationCount += 1;
        const headerScopeAllowed =
          nativeHeaderJwtShapeValid &&
          (decision.eligible ||
            exactAuthAppCheckHeaderScope({
              method: requestMethod,
              url: requestUrl,
            }));
        if (!headerScopeAllowed) {
          unauthorizedAppCheckHeaderEgressCount += 1;
          diagnosticContext.operation = "request-fail";
          diagnosticContext.reason = "unexpected-handler-error";
          await appCheckCdpSession.send("Fetch.failRequest", {
            requestId: event.requestId,
            errorReason: "BlockedByClient",
          });
          return;
        }
        authorizedAppCheckHeaderRequestCount += 1;
      }
      let rewriteObservation = null;
      if (rewriteDecision.eligible) {
        const upstreamParsed = new URL(rewriteDecision.upstreamUrl);
        const googleOrFirebaseUpstream =
          upstreamParsed.hostname.endsWith(".googleapis.com") ||
          upstreamParsed.hostname.endsWith(".firebaseio.com") ||
          upstreamParsed.hostname.endsWith(".firebasedatabase.app") ||
          upstreamParsed.hostname.endsWith(".firebaseapp.com");
        stableOriginRewriteFirebaseGoogleRequestCount += Number(
          googleOrFirebaseUpstream,
        );
        stableOriginRewriteExternalRequestCount += Number(
          upstreamParsed.origin !== upstreamOrigins[stage],
        );
        assert.equal(googleOrFirebaseUpstream, false);
        assert.equal(upstreamParsed.origin, upstreamOrigins[stage]);
        rewriteObservation = {
          stage,
          groupKey,
          phase: networkPhase,
          captureId: activeCaptureId,
          method: requestMethod,
          resourceType: event.resourceType,
          kind: rewriteDecision.kind,
          browserOrigin: stableBrowserOrigin,
          browserPath: rewriteDecision.browserPath,
          browserUrlSha256: sha256(requestUrl),
          upstreamDeploymentId: upstreamBinding.deploymentId,
          upstreamOrigin: rewriteDecision.upstreamOrigin,
          upstreamUrl: rewriteDecision.upstreamUrl,
          upstreamUrlSha256: sha256(rewriteDecision.upstreamUrl),
          redirectRequest: false,
          redirectResponse: null,
          responseStatus: null,
          responseError: null,
          responseBodySha256: null,
          responseBodyBytes: null,
          immutableAttestationSha256: null,
          immutableAttestationBytes: null,
          byteMatch: null,
        };
        stableOriginRewriteObservations.push(rewriteObservation);
        stableOriginRewriteRequestCount += 1;
        stableOriginRewriteDocumentRequestCount += Number(
          event.resourceType === "Document",
        );
        stableOriginRewriteScriptRequestCount += Number(
          event.resourceType === "Script",
        );
        diagnosticContext.operation = "request-node-fetch";
        diagnosticContext.reason = "unexpected-handler-error";
        const immutableAttestation = await fetchImmutableResourceAttestation(
          stage,
          rewriteObservation.upstreamUrl,
        );
        rewriteObservation.redirectResponse = false;
        rewriteObservation.responseStatus = immutableAttestation.status;
        rewriteObservation.responseError = false;
        stableOriginRewriteResponseCount += 1;
        stableOriginRewriteHttpSuccessResponseCount += 1;
        stableOriginRewriteLocalFulfillCount += 1;
        const responseBodyHashRequired =
          rewriteObservation.method === "GET" &&
          contract.browserTransport.responseBodyHashResourceTypes.includes(
            rewriteObservation.resourceType,
          );
        if (responseBodyHashRequired) {
          rewriteObservation.responseBodySha256 = immutableAttestation.sha256;
          rewriteObservation.responseBodyBytes = immutableAttestation.bytes;
          rewriteObservation.immutableAttestationSha256 =
            immutableAttestation.sha256;
          rewriteObservation.immutableAttestationBytes =
            immutableAttestation.bytes;
          rewriteObservation.byteMatch = true;
          stableOriginRewriteBodyHashCount += 1;
        }
        diagnosticContext.operation = "request-fulfill";
        diagnosticContext.reason = "unexpected-handler-error";
        await appCheckCdpSession.send("Fetch.fulfillRequest", {
          requestId: event.requestId,
          responseCode: immutableAttestation.status,
          responseHeaders: immutableAttestation.responseHeaders,
          body:
            rewriteObservation.method === "HEAD"
              ? Buffer.alloc(0).toString("base64")
              : immutableAttestation.body,
        });
        return;
      }
      if (replaceDebugExchangeBody) {
        authorizedDebugExchangeBodyReplacementCount += 1;
        sensitiveAppCheckRequestsByFetchRequestId.set(
          event.requestId,
          "browser-debug-exchange-body-rewrite",
        );
        allowedEgressRequestsByFetchRequestId.set(event.requestId, {
          kind: "browser-debug-exchange-body-rewrite",
        });
        await continueInspectedDirectFirebaseRequest({
          event,
          requestUrl,
          requestMethod,
          requestHeaders: event.request.headers,
          requestPostData: postData,
          preTransmissionInspection,
          diagnosticContext,
          overrides: {
            postData: Buffer.from(
              JSON.stringify({ debug_token: appCheckDebugToken }),
              "utf8",
            ).toString("base64"),
          },
        });
        return;
      }
      if (stage !== "baseline") {
        if (nativeHeaderPresent) {
          sensitiveAppCheckRequestsByFetchRequestId.set(
            event.requestId,
            "native-app-check-header",
          );
        }
        allowedEgressRequestsByFetchRequestId.set(event.requestId, {
          kind: nativeHeaderPresent
            ? "candidate-native-app-check"
            : "candidate-allowed-egress",
        });
        await continueInspectedDirectFirebaseRequest({
          event,
          requestUrl,
          requestMethod,
          requestHeaders: event.request.headers,
          requestPostData: postData,
          preTransmissionInspection,
          diagnosticContext,
        });
        return;
      }
      if (decision.scopeMismatch) {
        baselineBridgeScopeMismatchRequestCount += 1;
      }
      if (!decision.eligible) {
        if (nativeHeaderPresent) {
          sensitiveAppCheckRequestsByFetchRequestId.set(
            event.requestId,
            "native-app-check-header",
          );
        }
        allowedEgressRequestsByFetchRequestId.set(event.requestId, {
          kind: nativeHeaderPresent
            ? "baseline-native-app-check"
            : "baseline-allowed-egress",
        });
        await continueInspectedDirectFirebaseRequest({
          event,
          requestUrl,
          requestMethod,
          requestHeaders: event.request.headers,
          requestPostData: postData,
          preTransmissionInspection,
          diagnosticContext,
        });
        return;
      }
      baselineBridgeEligibleRequestCount += 1;
      if (nativeHeaderPresent) {
        baselineBridgeNativeHeaderRequestCount += 1;
        sensitiveAppCheckRequestsByFetchRequestId.set(
          event.requestId,
          "native-app-check-header",
        );
        allowedEgressRequestsByFetchRequestId.set(event.requestId, {
          kind: "baseline-native-app-check",
        });
        await continueInspectedDirectFirebaseRequest({
          event,
          requestUrl,
          requestMethod,
          requestHeaders: event.request.headers,
          requestPostData: postData,
          preTransmissionInspection,
          diagnosticContext,
        });
        return;
      }
      diagnosticContext.operation = "request-bridge-token";
      diagnosticContext.reason = "unexpected-handler-error";
      const bridgeToken = await captureAppCheckTokenManager.ensureFresh();
      if (stage === "candidate") candidateBridgeInjectedRequestCount += 1;
      else baselineBridgeInjectedRequestCount += 1;
      appCheckHeaderNetworkObservationCount += 1;
      authorizedAppCheckHeaderRequestCount += 1;
      sensitiveAppCheckRequestsByFetchRequestId.set(
        event.requestId,
        "baseline-cdp-fetch-bridge",
      );
      allowedEgressRequestsByFetchRequestId.set(event.requestId, {
        kind: "baseline-cdp-fetch-bridge",
      });
      await continueInspectedDirectFirebaseRequest({
        event,
        requestUrl,
        requestMethod,
        requestHeaders: event.request.headers,
        requestPostData: postData,
        preTransmissionInspection,
        diagnosticContext,
        overrides: {
          headers: [
            ...headerEntries.filter(
              ({ name }) => name.toLowerCase() !== "x-firebase-appcheck",
            ),
            { name: "X-Firebase-AppCheck", value: bridgeToken },
          ],
        },
      });
    };
    appCheckCdpSession.on("Fetch.requestPaused", (event) => {
      const responseStagePause =
        event.responseStatusCode !== undefined ||
        event.responseErrorReason !== undefined;
      const responseCorrelationHint = responseStagePause
        ? resolveResponseCorrelationForEvent(event)
        : null;
      const redirectedLifecycle =
        !responseStagePause && event.redirectedRequestId
          ? allowedEgressLifecycleByFetchRequestId.get(
              event.redirectedRequestId,
            ) || null
          : null;
      const handlerCorrelationId =
        responseCorrelationHint?.primaryRequestId ||
        redirectedLifecycle?.primaryRequestId ||
        event.requestId;
      const correlatedDiagnosticPhase =
        correlatedDiagnosticPhaseForEvent(event);
      const diagnosticContext = {
        captureStage: stage,
        phase: correlatedDiagnosticPhase,
        operation:
          event.responseStatusCode !== undefined ||
          event.responseErrorReason !== undefined
            ? "response-correlation"
            : "request-post-data",
        reason: "unexpected-handler-error",
        service: safeCdpDiagnosticServiceForEvent(event),
        requestClass: safeCdpDiagnosticRequestClassForEvent(event),
        resourceClass: safeCdpDiagnosticResourceClassForEvent(event),
      };
      cdpHandlerDiagnosticContexts.set(event, diagnosticContext);
      const handlerPromise = allowedEgressHandlerTaskCoordinator
        .enqueue(handlerCorrelationId, () =>
          handlePausedRequest(event).catch(async (error) => {
            incrementSafeDiagnosticClass(
              cdpHandlerFailureClassCounts,
              {
                ...diagnosticContext,
                reason: safeCdpHandlerFailureReason(error, diagnosticContext),
              },
              SAFE_CDP_HANDLER_FAILURE_REASONS,
            );
            appCheckCdpHandlerErrorCount += 1;
            const primaryRequestId =
              cdpHandlerPrimaryRequestIds.get(event) || event.requestId;
            setAllowedEgressLifecycleState(primaryRequestId, "handler-failed");
            allowedEgressProxyAuthorizationCoordinator.revoke(primaryRequestId);
            allowedEgressRequestsByFetchRequestId.delete(primaryRequestId);
            sensitiveAppCheckRequestsByFetchRequestId.delete(primaryRequestId);
            stableOriginRewriteRequestsByFetchRequestId.delete(
              primaryRequestId,
            );
            informationalResponseRequestsByFetchRequestId.delete(
              primaryRequestId,
            );
            if (error instanceof PausedRequestPostDataResolutionError) {
              fullPostDataResolutionFailureCount += 1;
              fullPostDataOversizeBlockCount += Number(
                error.code === "maximum-bytes-exceeded",
              );
              fullPostDataRepresentationMismatchBlockCount += Number(
                error.code === "representation-mismatch",
              );
            }
            try {
              await appCheckCdpSession.send("Fetch.failRequest", {
                requestId: event.requestId,
                errorReason: "BlockedByClient",
              });
            } catch (_error) {
              // The request may already have been terminated by the browser.
            }
          }),
        )
        .finally(() => {
          cdpHandlerDiagnosticContexts.delete(event);
          cdpHandlerPrimaryRequestIds.delete(event);
          appCheckCdpHandlerPromises.delete(handlerPromise);
        });
      appCheckCdpHandlerPromises.add(handlerPromise);
    });
    await appCheckCdpSession.send("Fetch.enable", {
      patterns: [{ urlPattern: "*", requestStage: "Request" }],
    });
    browserConnectProxy.setAuditStage(stage);
    await browserWideBoundaryController.handoffPrimaryRequestBoundary(groupKey);
    const pageErrors = [];
    page.on("pageerror", (error) => {
      const rawText = String(error);
      if (
        /\bcors\b|cross-origin request blocked|access-control-allow-origin/iu.test(
          rawText,
        )
      ) {
        browserCorsConsoleErrorCount += 1;
      }
      if (
        rawText.includes(appCheckDebugToken) ||
        rawText.includes(APP_CHECK_DEBUG_SENTINEL) ||
        (Boolean(bypassSecret) && rawText.includes(bypassSecret)) ||
        JWT_PATTERN.test(rawText)
      ) {
        browserConsoleSecretObservationCount += 1;
      }
      pageErrors.push(
        sanitizeAppCheckDiagnostic(
          rawText,
          appCheckDebugToken,
          APP_CHECK_DEBUG_SENTINEL,
          bypassSecret,
        ),
      );
    });
    page.on("requestfailed", (request) => {
      if (
        optionalTelemetrySuppressionDecision({
          requestUrl: request.url(),
          method: request.method(),
        }).eligible
      ) {
        return;
      }
      browserRequestFailureCount += 1;
    });
    page.on("console", (message) => {
      const rawText = message.text();
      browserConsoleMessageCount += 1;
      if (
        message.type() === "error" &&
        /\bcors\b|cross-origin request blocked|access-control-allow-origin/iu.test(
          rawText,
        )
      ) {
        browserCorsConsoleErrorCount += 1;
      }
      if (
        rawText.includes(appCheckDebugToken) ||
        rawText.includes(APP_CHECK_DEBUG_SENTINEL) ||
        (Boolean(bypassSecret) && rawText.includes(bypassSecret)) ||
        JWT_PATTERN.test(rawText)
      ) {
        browserConsoleSecretObservationCount += 1;
      }
      const textValue = sanitizeAppCheckDiagnostic(
        rawText,
        appCheckDebugToken,
        APP_CHECK_DEBUG_SENTINEL,
        bypassSecret,
      );
      if (message.type() === "error") pageErrors.push(textValue);
    });
    const authenticationRole = groupTargets[0].authenticationRole;
    assert.equal(
      groupTargets.every(
        (target) => target.authenticationRole === authenticationRole,
      ),
      true,
    );
    let groupIdentityAttestation = null;
    if (authenticationRole) {
      networkPhase = "authentication";
      const identity = await authenticate(
        page,
        credentials[authenticationRole],
        origin,
      );
      groupIdentityAttestation = createIdentityAttestation(
        authenticationRole,
        identity,
      );
      const previous = identityAttestations.get(authenticationRole);
      if (previous) assert.deepEqual(groupIdentityAttestation, previous);
      else
        identityAttestations.set(authenticationRole, groupIdentityAttestation);
    }
    for (const target of groupTargets) {
      pageErrors.length = 0;
      activeCaptureId = captureKey(stage, target.screen.id, viewport);
      networkPhase = "screen-capture";
      const networkObservationStart = networkObservations.length;
      const networkResponseObservationStart =
        networkResponseObservations.length;
      const routeUrl = `${origin}/#${target.screen.captureRoute}`;
      await page.goto(routeUrl, { waitUntil: "domcontentloaded" });
      await page.waitForFunction(
        (expectedRoute) =>
          decodeURIComponent(location.hash.slice(1)) ===
          decodeURIComponent(expectedRoute),
        target.screen.captureRoute,
      );
      await page.waitForLoadState("load");
      await page.evaluate(async () => document.fonts.ready);
      const appCheckDebugGlobalDescriptor = await page.evaluate(() => {
        const descriptor = Object.getOwnPropertyDescriptor(
          self,
          "FIREBASE_APPCHECK_DEBUG_TOKEN",
        );
        return {
          value: typeof descriptor?.value === "string" ? descriptor.value : "",
          enumerable: descriptor?.enumerable,
        };
      });
      const browserGlobalContainsRawDebugToken =
        appCheckDebugGlobalDescriptor.value === appCheckDebugToken;
      browserGlobalRawDebugTokenWriteCount += Number(
        browserGlobalContainsRawDebugToken,
      );
      browserGlobalDebugSentinelWriteCount += Number(
        appCheckDebugGlobalDescriptor.value === APP_CHECK_DEBUG_SENTINEL,
      );
      assert.equal(
        browserGlobalContainsRawDebugToken,
        false,
        "The App Check browser global contained the raw debug token.",
      );
      assert.equal(
        appCheckDebugGlobalDescriptor.value === APP_CHECK_DEBUG_SENTINEL,
        true,
        "The App Check browser global did not contain the fixed sentinel.",
      );
      assert.equal(appCheckDebugGlobalDescriptor.enumerable, false);
      appCheckDebugGlobalDescriptor.value = "";

      const localStorageSnapshot = await page.evaluate(() =>
        Object.entries(localStorage).flatMap(([key, value]) => [key, value]),
      );
      const localStorageContainsRawDebugToken = localStorageSnapshot.some(
        (value) => String(value).includes(appCheckDebugToken),
      );
      browserLocalStorageSecretWriteCount += Number(
        localStorageContainsRawDebugToken,
      );
      localStorageSnapshot.fill("");
      assert.equal(
        localStorageContainsRawDebugToken,
        false,
        "Browser localStorage contained the raw App Check debug token.",
      );

      let appCheckDomText = await page.evaluate(
        () => document.documentElement?.outerHTML || "",
      );
      const appCheckSecretObservedInDom =
        appCheckDomText.includes(appCheckDebugToken) ||
        appCheckDomText.includes(APP_CHECK_DEBUG_SENTINEL) ||
        /[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/u.test(
          appCheckDomText,
        );
      appCheckDomText = "";
      if (appCheckSecretObservedInDom) browserDomSecretObservationCount += 1;
      assert.equal(
        appCheckSecretObservedInDom,
        false,
        "Raw App Check token material reached the rendered DOM.",
      );
      await page.addStyleTag({
        content:
          "*,*::before,*::after{animation-duration:0s!important;transition-duration:0s!important;caret-color:transparent!important}",
      });
      const fixtureActions = await applyScreenFixtureActions(
        page,
        target.screen.id,
        viewport,
      );
      try {
        await waitForScreenReady(page, target.screen.id);
      } catch (error) {
        const routeRequests = networkObservations.slice(
          networkObservationStart,
        );
        const routeResponses = networkResponseObservations.slice(
          networkResponseObservationStart,
        );
        const failureDiagnostic = {
          stage,
          screenId: target.screen.id,
          viewport: viewportName,
          originalErrorName:
            error &&
            typeof error === "object" &&
            ["Error", "TimeoutError"].includes(String(error.name))
              ? String(error.name)
              : "UnknownError",
          readiness:
            error && typeof error === "object"
              ? error.w10pReadinessDiagnostic || null
              : null,
          pageErrorCount: pageErrors.length,
          pageErrorSha256s: pageErrors
            .map((value) => sha256(String(value)))
            .sort(),
          routeObservedRequestCount: routeRequests.length,
          routeObservedResponseCount: routeResponses.length,
          routeObservedFirebaseRequestCount: routeRequests.filter(
            (observation) => observation.isFirebaseRequest,
          ).length,
          routeObservedFirebaseResponseCount: routeResponses.filter(
            (observation) => observation.isFirebaseRequest,
          ).length,
          routeObservedFirestoreRequestCount: routeRequests.filter(
            (observation) => observation.firebaseService === "firestore",
          ).length,
          routeObservedFirestoreResponseCount: routeResponses.filter(
            (observation) => observation.firebaseService === "firestore",
          ).length,
          routeObservedFirestoreHttpErrorResponseCount: routeResponses.filter(
            (observation) =>
              observation.firebaseService === "firestore" &&
              Number(observation.status) >= 400,
          ).length,
          routeObservedUnboundFirebaseRequestCount: routeRequests.filter(
            (observation) => observation.unboundFirebaseRequest,
          ).length,
          cumulativeBrowserRequestFailureCount: browserRequestFailureCount,
          cumulativeAppCheckCdpHandlerErrorCount: appCheckCdpHandlerErrorCount,
          groupAppCheckCdpHandlerErrorCount:
            appCheckCdpHandlerErrorCount - groupBaselineBridgeHandlerErrorStart,
          groupCdpHandlerFailureClasses: snapshotSafeDiagnosticClasses(
            cdpHandlerFailureClassCounts,
            groupCdpHandlerFailureClassCountsStart,
          ),
          cumulativeNetworkHeaderAttestationErrorCount:
            networkHeaderAttestationErrorCount,
          cumulativePreTransmissionBoundaryFailRequestCount:
            preTransmissionBoundaryFailRequestCount,
          groupPreTransmissionBoundaryFailRequestCount:
            preTransmissionBoundaryFailRequestCount -
            groupPreTransmissionBoundaryFailRequestStart,
          groupPreTransmissionBoundaryBlockClasses:
            snapshotSafeDiagnosticClasses(
              preTransmissionBoundaryBlockClassCounts,
              groupPreTransmissionBoundaryBlockClassCountsStart,
            ),
          cumulativeAllowedEgressResponseErrorAbortCount:
            allowedEgressResponseErrorAbortCount,
        };
        throw new Error(
          `W10P screen readiness failure: ${JSON.stringify(failureDiagnostic)}`,
        );
      }
      assert.deepEqual(pageErrors, [], `${target.screen.id} browser errors.`);
      const anchorRequirements =
        stage === "candidate" && !target.screen.productionPresentation
          ? contract.newSurfaceRequiredAnchors[target.screen.id]
          : [];
      const readyRequirements =
        contract.screenReadyStates[target.screen.id].signals;
      const metadata = await describePage(
        page,
        anchorRequirements,
        readyRequirements,
        target.primitiveRequirements,
        contract.fixtureDomAssertions[target.screen.id] ?? null,
      );
      assert.deepEqual(
        metadata.fixtureEvidence.privacy.unexpectedEmailSha256s,
        [],
        `${target.screen.id} exposed a non-fixture email.`,
      );
      assert.deepEqual(
        metadata.fixtureEvidence.privacy.unexpectedPersonLabels,
        [],
        `${target.screen.id} exposed an unapproved fixture person label.`,
      );
      assert.equal(
        Object.values(
          metadata.fixtureEvidence.privacy.forbiddenPatternMatchCounts,
        ).every((count) => count === 0),
        true,
        `${target.screen.id} exposed a forbidden personal-data pattern.`,
      );
      metadata.finalUrl = sanitizeBrowserUrl(metadata.finalUrl);
      metadata.performanceNavigationUrl = sanitizeBrowserUrl(
        metadata.performanceNavigationUrl,
      );
      const fullPage = contract.fullPageViewportKeys.includes(viewportName);
      const fileName = `${stage}/${target.screen.id}-${viewportName}.png`;
      const absoluteFile = resolve(outputRoot, fileName);
      await page.screenshot({ path: absoluteFile, fullPage });
      assert.deepEqual(
        pageErrors,
        [],
        `${target.screen.id} emitted an error during screenshot capture.`,
      );
      const postScreenshotMetadata = await describePage(
        page,
        anchorRequirements,
        readyRequirements,
        target.primitiveRequirements,
        contract.fixtureDomAssertions[target.screen.id] ?? null,
      );
      postScreenshotMetadata.finalUrl = sanitizeBrowserUrl(
        postScreenshotMetadata.finalUrl,
      );
      postScreenshotMetadata.performanceNavigationUrl = sanitizeBrowserUrl(
        postScreenshotMetadata.performanceNavigationUrl,
      );
      assert.deepEqual(
        postScreenshotMetadata,
        metadata,
        `${target.screen.id} DOM or paint evidence changed during screenshot capture.`,
      );
      const png = readFileSync(absoluteFile);
      const actualPixelSize = {
        width: viewport.width,
        height: fullPage
          ? Math.max(viewport.height, metadata.dom.scrollHeight)
          : viewport.height,
      };
      await flushNetworkAttestations();
      const captureRequests = networkObservations
        .slice(networkObservationStart)
        .filter((observation) => observation.captureId === activeCaptureId);
      const captureResponses = networkResponseObservations
        .slice(networkResponseObservationStart)
        .filter((observation) => observation.captureId === activeCaptureId);
      const captureNetwork = summarizeNetwork(
        captureRequests,
        captureResponses,
      );
      if (contract.fixtureMarkers[target.screen.id]) {
        assert.ok(
          captureNetwork.stagingDataRequestCount > 0,
          `${target.screen.id} rendered fixture data without a capture-bound staging data request.`,
        );
        assert.ok(
          captureNetwork.stagingDataResponseCount > 0,
          `${target.screen.id} rendered fixture data without a successful capture-bound staging data response.`,
        );
        const successfulDataResponseIds = new Set(
          captureResponses
            .filter(
              (response) =>
                response.stagingMarker &&
                fixtureDataServices.has(response.firebaseService) &&
                response.status >= 200 &&
                response.status < 300,
            )
            .map((response) => response.correlationId),
        );
        const successfulProtectedRequests = captureRequests.filter(
          (request) =>
            request.method !== "OPTIONS" &&
            request.stagingMarker &&
            fixtureDataServices.has(request.firebaseService) &&
            successfulDataResponseIds.has(request.correlationId),
        );
        assert.ok(
          successfulProtectedRequests.length > 0,
          `${target.screen.id} has no correlated successful staging data exchange.`,
        );
        const requiredHeaderSource =
          stage === "baseline" ? "baseline-cdp-fetch-bridge" : "native-sdk";
        assert.equal(
          successfulProtectedRequests.every(
            (request) =>
              request.appCheckHeaderPresent &&
              request.appCheckHeaderJwtShapeValid &&
              request.appCheckHeaderSource === requiredHeaderSource,
          ),
          true,
          `${target.screen.id} has a successful capture-bound data request without the required ${requiredHeaderSource} App Check JWT.`,
        );
      }
      const captureRow = {
        id: captureKey(stage, target.screen.id, viewport),
        stage,
        screenId: target.screen.id,
        role: target.screen.role,
        route: target.screen.captureRoute,
        sourceCommitSha:
          stage === "baseline"
            ? contract.productionPresentationSha
            : sourceCommitSha,
        observedOrigin: origin,
        finalUrl: metadata.finalUrl,
        performanceNavigationUrl: metadata.performanceNavigationUrl,
        documentReadyState: metadata.documentReadyState,
        capturedAt: new Date().toISOString(),
        viewport,
        actualPixelSize,
        dpr: contract.requiredDpr,
        fullPage,
        fileName,
        sha256: sha256(png),
        status: "CAPTURED",
        dom: metadata.dom,
        elements: metadata.elements,
        anchors: metadata.anchors,
        primitives: metadata.primitives,
        readyStateId: target.screen.id,
        readySignals: metadata.readySignals,
        fixtureMarker: contract.fixtureMarkers[target.screen.id] ?? null,
        fixtureId,
        fixturePlanHash: contract.fixturePlanHash,
        fixtureCaptureBindingHash: fixtureAudit.captureBindingHash,
        fixtureAuditSha256,
        fixtureActions,
        fixtureEvidence: metadata.fixtureEvidence,
        network: captureNetwork,
      };
      const captureAttestation = {
        type: "capture",
        id: captureRow.id,
        route: captureRow.route,
        finalUrl: captureRow.finalUrl,
        fixtureId,
        fixturePlanHash: contract.fixturePlanHash,
        fixtureCaptureBindingHash: fixtureAudit.captureBindingHash,
        fixtureAuditSha256,
        screenshotFile: captureRow.fileName,
        screenshotSha256: captureRow.sha256,
        readySignalsSha256: sha256(
          Buffer.from(JSON.stringify(captureRow.readySignals)),
        ),
        domSha256: sha256(Buffer.from(JSON.stringify(captureRow.dom))),
        elementsSha256: sha256(
          Buffer.from(JSON.stringify(captureRow.elements)),
        ),
        anchorsSha256: sha256(Buffer.from(JSON.stringify(captureRow.anchors))),
        primitivesSha256: sha256(
          Buffer.from(JSON.stringify(captureRow.primitives)),
        ),
        fixtureActionsSha256: sha256(
          Buffer.from(JSON.stringify(captureRow.fixtureActions)),
        ),
        fixtureEvidenceSha256: sha256(
          Buffer.from(JSON.stringify(captureRow.fixtureEvidence)),
        ),
      };
      captureRow.browserAttestationSha256 = sha256(
        Buffer.from(JSON.stringify(captureAttestation)),
      );
      captures.push(captureRow);
      groupCaptureAttestations.push(captureAttestation);
    }
    if (appCheckCdpSession) {
      for (const frame of page.frames()) observeFrameOrigin(frame);
      const targetSnapshot = await appCheckCdpSession.send("Target.getTargets");
      targetSnapshotCount += 1;
      groupRetainedOopifTargetCount = targetSnapshot.targetInfos.filter(
        (targetInfo) =>
          targetInfo.browserContextId === groupBrowserContextId &&
          targetInfo.type === "iframe",
      ).length;
      groupRetainedDedicatedWorkerTargetCount =
        targetSnapshot.targetInfos.filter(
          (targetInfo) =>
            targetInfo.browserContextId === groupBrowserContextId &&
            targetInfo.type === "worker",
        ).length;
      groupRetainedSharedWorkerTargetCount = targetSnapshot.targetInfos.filter(
        (targetInfo) =>
          targetInfo.browserContextId === groupBrowserContextId &&
          targetInfo.type === "shared_worker",
      ).length;
      groupRetainedServiceWorkerTargetCount = targetSnapshot.targetInfos.filter(
        (targetInfo) =>
          targetInfo.browserContextId === groupBrowserContextId &&
          targetInfo.type === "service_worker",
      ).length;
      while (appCheckCdpHandlerPromises.size > 0) {
        await Promise.all([...appCheckCdpHandlerPromises]);
      }
      assert.equal(
        allowedEgressHandlerTaskCoordinator.pendingCount(),
        0,
        `Allowed-egress handler queue must be empty for ${groupKey}.`,
      );
      await flushNetworkAttestations();
      groupRetainedPageCount = context.pages().length;
      groupServiceWorkerCount = context.serviceWorkers().length;
      assert.equal(
        groupRetainedPageCount,
        1,
        "The App Check capture retained an unmonitored extra page.",
      );
      assert.equal(
        groupServiceWorkerCount,
        0,
        "The App Check capture created an unmonitored service worker.",
      );
      await context.close();
      browserContextCloseCount += 1;
      await browserWideBoundaryController.deactivate(groupKey);
      const groupBrowserWideBoundaryEnd =
        browserWideBoundaryController.snapshot();
      groupBrowserWideBoundaryAttestation = {
        schemaVersion: 3,
        mechanism: contract.networkBoundary.executionTargetBoundary.mechanism,
        activationCount:
          groupBrowserWideBoundaryEnd.activationCount -
          groupBrowserWideBoundaryStart.activationCount,
        waitingTargetCount:
          groupBrowserWideBoundaryEnd.waitingTargetCount -
          groupBrowserWideBoundaryStart.waitingTargetCount,
        primaryTargetConfiguredCount:
          groupBrowserWideBoundaryEnd.primaryTargetConfiguredCount -
          groupBrowserWideBoundaryStart.primaryTargetConfiguredCount,
        primaryRequestBoundaryHandoffCount:
          groupBrowserWideBoundaryEnd.primaryRequestBoundaryHandoffCount -
          groupBrowserWideBoundaryStart.primaryRequestBoundaryHandoffCount,
        heldRuntimeResumeCount:
          groupBrowserWideBoundaryEnd.heldRuntimeResumeCount -
          groupBrowserWideBoundaryStart.heldRuntimeResumeCount,
        secondaryTargetClosedBeforeResumeCount:
          groupBrowserWideBoundaryEnd.secondaryTargetClosedBeforeResumeCount -
          groupBrowserWideBoundaryStart.secondaryTargetClosedBeforeResumeCount,
        privateRequestInspectionCount:
          groupBrowserWideBoundaryEnd.requestInspectionCount -
          groupBrowserWideBoundaryStart.requestInspectionCount,
        privateRequestBlockCount:
          groupBrowserWideBoundaryEnd.requestBlockCount -
          groupBrowserWideBoundaryStart.requestBlockCount,
        privateRequestContinueCount:
          groupBrowserWideBoundaryEnd.requestContinueCount -
          groupBrowserWideBoundaryStart.requestContinueCount,
        privateRawSensitiveInspectionCount:
          groupBrowserWideBoundaryEnd.rawSensitiveInspectionCount -
          groupBrowserWideBoundaryStart.rawSensitiveInspectionCount,
        privateRawSensitiveBlockCount:
          groupBrowserWideBoundaryEnd.rawSensitiveBlockCount -
          groupBrowserWideBoundaryStart.rawSensitiveBlockCount,
        privateRawProductionBlockCount:
          groupBrowserWideBoundaryEnd.rawProductionBlockCount -
          groupBrowserWideBoundaryStart.rawProductionBlockCount,
        privateRawVercelBypassBlockCount:
          groupBrowserWideBoundaryEnd.rawVercelBypassBlockCount -
          groupBrowserWideBoundaryStart.rawVercelBypassBlockCount,
        privateRawStagingApiKeyBlockCount:
          groupBrowserWideBoundaryEnd.rawStagingApiKeyBlockCount -
          groupBrowserWideBoundaryStart.rawStagingApiKeyBlockCount,
        privateRawTestCredentialBlockCount:
          groupBrowserWideBoundaryEnd.rawTestCredentialBlockCount -
          groupBrowserWideBoundaryStart.rawTestCredentialBlockCount,
        privateRawRefreshTokenBlockCount:
          groupBrowserWideBoundaryEnd.rawRefreshTokenBlockCount -
          groupBrowserWideBoundaryStart.rawRefreshTokenBlockCount,
        privateRawDebugTokenBlockCount:
          groupBrowserWideBoundaryEnd.rawDebugTokenBlockCount -
          groupBrowserWideBoundaryStart.rawDebugTokenBlockCount,
        privateRawDebugSentinelBlockCount:
          groupBrowserWideBoundaryEnd.rawDebugSentinelBlockCount -
          groupBrowserWideBoundaryStart.rawDebugSentinelBlockCount,
        privateOptionalTelemetrySuppressionCount:
          groupBrowserWideBoundaryEnd.optionalTelemetrySuppressionCount -
          groupBrowserWideBoundaryStart.optionalTelemetrySuppressionCount,
        privateDeterministicResponseFulfillCount:
          groupBrowserWideBoundaryEnd.deterministicResponseFulfillCount -
          groupBrowserWideBoundaryStart.deterministicResponseFulfillCount,
        privateDeterministicResponseScopeMismatchBlockCount:
          groupBrowserWideBoundaryEnd.deterministicResponseScopeMismatchBlockCount -
          groupBrowserWideBoundaryStart.deterministicResponseScopeMismatchBlockCount,
        privateExternalStaticBlockCount:
          groupBrowserWideBoundaryEnd.externalStaticPrivateOwnerBlockCount -
          groupBrowserWideBoundaryStart.externalStaticPrivateOwnerBlockCount,
        privateFullPostDataResolutionCount:
          groupBrowserWideBoundaryEnd.fullPostDataResolutionCount -
          groupBrowserWideBoundaryStart.fullPostDataResolutionCount,
        privateFullPostDataNetworkFallbackCount:
          groupBrowserWideBoundaryEnd.fullPostDataNetworkFallbackCount -
          groupBrowserWideBoundaryStart.fullPostDataNetworkFallbackCount,
        privateFullPostDataResolutionFailureCount:
          groupBrowserWideBoundaryEnd.fullPostDataResolutionFailureCount -
          groupBrowserWideBoundaryStart.fullPostDataResolutionFailureCount,
        privateFullPostDataOversizeBlockCount:
          groupBrowserWideBoundaryEnd.fullPostDataOversizeBlockCount -
          groupBrowserWideBoundaryStart.fullPostDataOversizeBlockCount,
        privateFullPostDataRepresentationMismatchBlockCount:
          groupBrowserWideBoundaryEnd.fullPostDataRepresentationMismatchBlockCount -
          groupBrowserWideBoundaryStart.fullPostDataRepresentationMismatchBlockCount,
        handlerErrorCount:
          groupBrowserWideBoundaryEnd.handlerErrorCount -
          groupBrowserWideBoundaryStart.handlerErrorCount,
        pendingSetupResidualCount:
          groupBrowserWideBoundaryEnd.pendingSetupCount,
        pendingHandlerResidualCount:
          groupBrowserWideBoundaryEnd.pendingHandlerCount,
        heldRuntimeResumeResidualCount:
          groupBrowserWideBoundaryEnd.heldRuntimeResumeResidualCount,
        fatalErrorCount:
          groupBrowserWideBoundaryEnd.fatalErrorCount -
          groupBrowserWideBoundaryStart.fatalErrorCount,
      };
      assert.equal(groupBrowserWideBoundaryAttestation.activationCount, 1);
      assert.equal(
        groupBrowserWideBoundaryAttestation.primaryTargetConfiguredCount,
        1,
      );
      assert.equal(
        groupBrowserWideBoundaryAttestation.primaryRequestBoundaryHandoffCount,
        1,
      );
      assert.ok(
        groupBrowserWideBoundaryAttestation.heldRuntimeResumeCount >= 1,
      );
      for (const field of [
        "secondaryTargetClosedBeforeResumeCount",
        "handlerErrorCount",
        "pendingSetupResidualCount",
        "pendingHandlerResidualCount",
        "heldRuntimeResumeResidualCount",
        "fatalErrorCount",
        "privateFullPostDataResolutionFailureCount",
        "privateFullPostDataOversizeBlockCount",
        "privateFullPostDataRepresentationMismatchBlockCount",
      ]) {
        assert.equal(
          groupBrowserWideBoundaryAttestation[field],
          0,
          `browser-wide boundary ${field} must be zero for ${groupKey}.`,
        );
      }
      assert.equal(
        groupBrowserWideBoundaryAttestation.privateFullPostDataResolutionCount,
        groupBrowserWideBoundaryAttestation.privateRequestInspectionCount,
      );
      browserWideBoundaryGroupAttestations.push({
        id: groupKey,
        ...groupBrowserWideBoundaryAttestation,
      });
      while (appCheckCdpHandlerPromises.size > 0) {
        await Promise.all([...appCheckCdpHandlerPromises]);
      }
      assert.equal(
        allowedEgressHandlerTaskCoordinator.pendingCount(),
        0,
        `Allowed-egress handler queue must be empty after cleanup for ${groupKey}.`,
      );
      assert.equal(
        allowedEgressProxyAuthorizationCoordinator.activeCount(),
        0,
        `Allowed-egress proxy authorization must be settled for ${groupKey}.`,
      );
      await flushNetworkAttestations();
      groupOopifTargetCount = discoveredTargetIdsByType.get("iframe").size;
      groupDedicatedWorkerTargetCount =
        discoveredTargetIdsByType.get("worker").size;
      groupSharedWorkerTargetCount =
        discoveredTargetIdsByType.get("shared_worker").size;
      groupServiceWorkerTargetCount =
        discoveredTargetIdsByType.get("service_worker").size;
      groupPendingBridgeDecisionResidualCount = appCheckCdpHandlerPromises.size;
      groupPendingBridgeObservationResidualCount =
        pendingNetworkAttestations.size;
      groupSensitiveRequestTrackingResidualCount =
        sensitiveAppCheckRequestsByFetchRequestId.size;
      groupStableOriginRewriteTrackingResidualCount =
        stableOriginRewriteRequestsByFetchRequestId.size;
      groupAllowedEgressTrackingResidualCount =
        allowedEgressRequestsByFetchRequestId.size;
      groupExternalStaticTrackingResidualCount = 0;
      groupInformationalResponseTrackingResidualCount =
        informationalResponseRequestsByFetchRequestId.size;
      sensitiveAppCheckRequestTrackingResidualCount +=
        groupSensitiveRequestTrackingResidualCount;
      stableOriginRewriteTrackingResidualCount +=
        groupStableOriginRewriteTrackingResidualCount;
      allowedEgressTrackingResidualCount +=
        groupAllowedEgressTrackingResidualCount;
      externalStaticTrackingResidualCount +=
        groupExternalStaticTrackingResidualCount;
      allowedEgressInformationalTrackingResidualCount +=
        groupInformationalResponseTrackingResidualCount;
      pendingBridgeDecisionResidualCount +=
        groupPendingBridgeDecisionResidualCount;
      pendingBridgeObservationResidualCount +=
        groupPendingBridgeObservationResidualCount;
      assert.equal(
        groupSensitiveRequestTrackingResidualCount,
        0,
        "An App Check-sensitive CDP request had no terminal response decision.",
      );
      assert.equal(
        groupStableOriginRewriteTrackingResidualCount,
        0,
        "A stable-origin rewrite had no terminal immutable response decision.",
      );
      assert.equal(groupAllowedEgressTrackingResidualCount, 0);
      assert.equal(groupExternalStaticTrackingResidualCount, 0);
      assert.equal(groupInformationalResponseTrackingResidualCount, 0);
      assert.equal(groupPendingBridgeDecisionResidualCount, 0);
      assert.equal(groupPendingBridgeObservationResidualCount, 0);
      assert.equal(
        safeDiagnosticClassTotal(cdpHandlerFailureClassCounts),
        appCheckCdpHandlerErrorCount,
        "The safe CDP handler failure histogram drifted from its counter.",
      );
      assert.equal(
        safeDiagnosticClassTotal(preTransmissionBoundaryBlockClassCounts),
        preTransmissionBoundaryBlockAttemptCount,
        "The safe pre-transmission block histogram drifted from its counter.",
      );
      assert.equal(
        appCheckCdpHandlerErrorCount - groupBaselineBridgeHandlerErrorStart,
        0,
        `A baseline CDP Fetch bridge handler failed: ${JSON.stringify({
          handlerFailureClasses: snapshotSafeDiagnosticClasses(
            cdpHandlerFailureClassCounts,
            groupCdpHandlerFailureClassCountsStart,
          ),
          boundaryBlockClasses: snapshotSafeDiagnosticClasses(
            preTransmissionBoundaryBlockClassCounts,
            groupPreTransmissionBoundaryBlockClassCountsStart,
          ),
        })}`,
      );
      appCheckCdpSession = null;
    }
    unexpectedExtraPageCount += Math.max(0, groupPageCount - 1);
    unexpectedDedicatedWorkerCount += groupDedicatedWorkerCount;
    unexpectedServiceWorkerCount += groupServiceWorkerCount;
    unexpectedCrossOriginFrameCount += groupUnexpectedCrossOriginFrameCount;
    unexpectedOopifTargetCount += groupOopifTargetCount;
    unexpectedDedicatedWorkerTargetCount += groupDedicatedWorkerTargetCount;
    unexpectedSharedWorkerTargetCount += groupSharedWorkerTargetCount;
    unexpectedServiceWorkerTargetCount += groupServiceWorkerTargetCount;
    retainedOopifTargetCount += groupRetainedOopifTargetCount;
    retainedDedicatedWorkerTargetCount +=
      groupRetainedDedicatedWorkerTargetCount;
    retainedSharedWorkerTargetCount += groupRetainedSharedWorkerTargetCount;
    retainedServiceWorkerTargetCount += groupRetainedServiceWorkerTargetCount;
    assert.equal(
      groupPageCount,
      1,
      "The App Check capture context opened an unmonitored extra page.",
    );
    assert.equal(
      groupDedicatedWorkerCount,
      0,
      "The App Check capture created an unmonitored dedicated worker.",
    );
    assert.equal(
      groupUnexpectedCrossOriginFrameCount,
      0,
      "The App Check capture created an unmonitored cross-origin frame.",
    );
    assert.equal(
      groupOopifTargetCount,
      0,
      "The App Check capture created an unmonitored OOPIF target.",
    );
    assert.equal(
      groupDedicatedWorkerTargetCount,
      0,
      "The App Check capture created an unmonitored dedicated-worker target.",
    );
    assert.equal(
      groupSharedWorkerTargetCount,
      0,
      "The App Check capture created an unmonitored shared-worker target.",
    );
    assert.equal(
      groupServiceWorkerTargetCount,
      0,
      "The App Check capture created an unmonitored service-worker target.",
    );
    assert.equal(groupRetainedOopifTargetCount, 0);
    assert.equal(groupRetainedDedicatedWorkerTargetCount, 0);
    assert.equal(groupRetainedSharedWorkerTargetCount, 0);
    assert.equal(groupRetainedServiceWorkerTargetCount, 0);
    activeCaptureId = null;
    networkPhase = "browser-audit-finalization";
    const groupRequests = networkObservations.slice(
      groupNetworkObservationStart,
    );
    const groupResponses = networkResponseObservations.slice(
      groupNetworkResponseObservationStart,
    );
    const groupStableOriginRewriteObservations =
      stableOriginRewriteObservations.slice(
        groupStableOriginRewriteObservationStart,
      );
    const groupUpstreamProvenance = createStableOriginRewriteSummary({
      stage,
      groupKey,
      observations: groupStableOriginRewriteObservations,
    });
    stableOriginRewriteGroups.push({
      id: groupKey,
      ...groupUpstreamProvenance,
    });
    const groupDeterministicResponseObservations =
      deterministicResponseObservations.slice(
        groupDeterministicResponseObservationStart,
      );
    const groupExternalStaticResponseObservations =
      externalStaticResponseObservations.slice(
        groupExternalStaticResponseObservationStart,
      );
    const groupOptionalTelemetryObservations =
      optionalTelemetrySuppressionObservations.slice(
        groupOptionalTelemetryObservationStart,
      );
    const groupNetworkPolicySummary = {
      schemaVersion: 4,
      externalStaticAllowlistHash: sha256(
        canonicalJson(contract.networkBoundary.externalStaticRequestAllowlist),
      ),
      optionalTelemetrySuppressionContractHash: sha256(
        canonicalJson(contract.networkBoundary.optionalTelemetrySuppression),
      ),
      sensitiveValueScopeContractHash: sha256(
        canonicalJson(contract.networkBoundary.sensitiveValueScope),
      ),
      deterministicResponseContractHash: sha256(
        canonicalJson({
          holiday: contract.browserTransport.deterministicLocalResponse,
          recaptcha: contract.browserTransport.deterministicRecaptchaResponse,
        }),
      ),
      optionalTelemetrySuppressedRequestCount:
        optionalTelemetrySuppressedRequestCount -
        groupOptionalTelemetrySuppressedStart,
      deterministicHolidayResponseFulfillCount:
        deterministicHolidayResponseFulfillCount -
        groupDeterministicHolidayFulfillStart,
      deterministicRecaptchaResponseFulfillCount:
        deterministicRecaptchaResponseFulfillCount -
        groupDeterministicRecaptchaFulfillStart,
      deterministicFirebaseModuleFulfillCount:
        deterministicFirebaseModuleFulfillCount -
        groupDeterministicFirebaseModuleFulfillStart,
      deterministicResponseScopeMismatchBlockCount:
        deterministicResponseScopeMismatchBlockCount -
        groupDeterministicScopeMismatchBlockStart,
      externalStaticRequestNetworkFetchCount:
        externalStaticRequestNetworkFetchCount -
        groupExternalStaticNetworkFetchStart,
      externalStaticRequestCacheFulfillCount:
        externalStaticRequestCacheFulfillCount -
        groupExternalStaticCacheFulfillStart,
      externalStaticRequestScopeMismatchBlockCount:
        externalStaticRequestScopeMismatchBlockCount -
        groupExternalStaticScopeMismatchBlockStart,
      externalStaticResponseNon200AbortCount:
        externalStaticResponseNon200AbortCount -
        groupExternalStaticResponseNon200AbortStart,
      nodeOwnedExternalRequestCount:
        nodeOwnedExternalRequestCount - groupNodeOwnedExternalRequestStart,
      nodeOwnedExternalInformationalResponseCount:
        nodeOwnedExternalInformationalResponseCount -
        groupNodeOwnedExternalInformationalResponseStart,
      nodeOwnedExternalInformationalEgressHeaderObservationCount:
        nodeOwnedExternalInformationalEgressHeaderObservationCount -
        groupNodeOwnedExternalInformationalEgressHeaderObservationStart,
      nodeOwnedExternalInformationalBrowserExposureCount:
        nodeOwnedExternalInformationalBrowserExposureCount -
        groupNodeOwnedExternalInformationalBrowserExposureStart,
      nodeOwnedExternalFinalResponseCount:
        nodeOwnedExternalFinalResponseCount -
        groupNodeOwnedExternalFinalResponseStart,
      nodeOwnedExternalFinalBodyHashAttestationCount:
        nodeOwnedExternalFinalBodyHashAttestationCount -
        groupNodeOwnedExternalFinalBodyHashAttestationStart,
      nodeOwnedExternalFinalHeaderSuppressionCount:
        nodeOwnedExternalFinalHeaderSuppressionCount -
        groupNodeOwnedExternalFinalHeaderSuppressionStart,
      stagingApiKeyScopeViolationBlockCount:
        stagingApiKeyScopeViolationBlockCount -
        groupStagingApiKeyScopeViolationBlockStart,
      testCredentialScopeViolationBlockCount:
        testCredentialScopeViolationBlockCount -
        groupTestCredentialScopeViolationBlockStart,
      refreshTokenScopeViolationBlockCount:
        refreshTokenScopeViolationBlockCount -
        groupRefreshTokenScopeViolationBlockStart,
      rawSensitivePreTransmissionInspectionCount:
        rawSensitivePreTransmissionInspectionCount -
        groupRawSensitiveInspectionStart,
      rawSensitivePreTransmissionBlockCount:
        rawSensitivePreTransmissionBlockCount - groupRawSensitiveBlockStart,
      rawProductionPreTransmissionBlockCount:
        rawProductionPreTransmissionBlockCount - groupRawProductionBlockStart,
      rawVercelBypassPreTransmissionBlockCount:
        rawVercelBypassPreTransmissionBlockCount -
        groupRawVercelBypassBlockStart,
      rawStagingApiKeyPreTransmissionBlockCount:
        rawStagingApiKeyPreTransmissionBlockCount -
        groupRawStagingApiKeyBlockStart,
      rawTestCredentialPreTransmissionBlockCount:
        rawTestCredentialPreTransmissionBlockCount -
        groupRawTestCredentialBlockStart,
      rawRefreshTokenPreTransmissionBlockCount:
        rawRefreshTokenPreTransmissionBlockCount -
        groupRawRefreshTokenBlockStart,
      rawDebugTokenPreTransmissionBlockCount:
        rawDebugTokenPreTransmissionBlockCount - groupRawDebugTokenBlockStart,
      rawDebugSentinelPreTransmissionBlockCount:
        rawDebugSentinelPreTransmissionBlockCount -
        groupRawDebugSentinelBlockStart,
      allowedEgressResponsePauseCount:
        allowedEgressResponsePauseCount - groupAllowedEgressResponsePauseStart,
      allowedEgressInformationalResponsePauseCount:
        allowedEgressInformationalResponsePauseCount -
        groupAllowedEgressInformationalResponsePauseStart,
      allowedEgressInformationalFinalResponseCount:
        allowedEgressInformationalFinalResponseCount -
        groupAllowedEgressInformationalFinalResponseStart,
      allowedEgressInformationalTrackingResidualCount:
        groupInformationalResponseTrackingResidualCount,
      allowedEgressInvalidResponseStatusAbortCount:
        allowedEgressInvalidResponseStatusAbortCount -
        groupAllowedEgressInvalidResponseStatusAbortStart,
      allowedEgressRedirectAbortCount:
        allowedEgressRedirectAbortCount - groupAllowedEgressRedirectAbortStart,
      allowedEgressHttpErrorAbortCount:
        allowedEgressHttpErrorAbortCount -
        groupAllowedEgressHttpErrorAbortStart,
      allowedEgressResponseErrorAbortCount:
        allowedEgressResponseErrorAbortCount -
        groupAllowedEgressResponseErrorAbortStart,
      allowedEgressInformationalEgressHeaderObservationCount:
        allowedEgressInformationalEgressHeaderObservationCount -
        groupAllowedEgressInformationalEgressHeaderObservationStart,
      allowedEgressFinalEgressHeaderObservationCount:
        allowedEgressFinalEgressHeaderObservationCount -
        groupAllowedEgressFinalEgressHeaderObservationStart,
      allowedEgressResponseHeaderSuppressionCount:
        allowedEgressResponseHeaderSuppressionCount -
        groupAllowedEgressResponseHeaderSuppressionStart,
      allowedEgressEgressHeaderForwardCount:
        allowedEgressEgressHeaderForwardCount -
        groupAllowedEgressEgressHeaderForwardStart,
      directBrowserEarlyHintsObservationCount:
        directBrowserEarlyHintsObservationCount -
        groupDirectBrowserEarlyHintsObservationStart,
      directBrowserEarlyHintsEgressHeaderObservationCount:
        directBrowserEarlyHintsEgressHeaderObservationCount -
        groupDirectBrowserEarlyHintsEgressHeaderObservationStart,
      directBrowserEarlyHintsCaptureInvalidationCount:
        directBrowserEarlyHintsCaptureInvalidationCount -
        groupDirectBrowserEarlyHintsCaptureInvalidationStart,
      fullPostDataResolutionCount:
        fullPostDataResolutionCount - groupFullPostDataResolutionStart,
      fullPostDataNetworkFallbackCount:
        fullPostDataNetworkFallbackCount -
        groupFullPostDataNetworkFallbackStart,
      fullPostDataResolutionFailureCount:
        fullPostDataResolutionFailureCount -
        groupFullPostDataResolutionFailureStart,
      fullPostDataOversizeBlockCount:
        fullPostDataOversizeBlockCount - groupFullPostDataOversizeBlockStart,
      fullPostDataRepresentationMismatchBlockCount:
        fullPostDataRepresentationMismatchBlockCount -
        groupFullPostDataRepresentationMismatchBlockStart,
      deterministicResponseObservationCount:
        groupDeterministicResponseObservations.length,
      deterministicResponseObservationSetHash: sha256(
        canonicalJson(groupDeterministicResponseObservations),
      ),
      externalStaticResponseObservationCount:
        groupExternalStaticResponseObservations.length,
      externalStaticResponseObservationSetHash: sha256(
        canonicalJson(groupExternalStaticResponseObservations),
      ),
      optionalTelemetryObservationCount:
        groupOptionalTelemetryObservations.length,
      optionalTelemetryObservationSetHash: sha256(
        canonicalJson(groupOptionalTelemetryObservations),
      ),
      pinnedStartupSourceAttestationCount:
        externalStaticStartupSourceAttestations.length,
      pinnedStartupSourceAttestationSetHash: sha256(
        canonicalJson(externalStaticStartupSourceAttestations),
      ),
      allowedEgressTrackingResidualCount:
        groupAllowedEgressTrackingResidualCount,
      externalStaticTrackingResidualCount:
        groupExternalStaticTrackingResidualCount,
    };
    assert.equal(
      groupNetworkPolicySummary.fullPostDataResolutionCount,
      appCheckCdpMonitorPausedRequestCount - groupAppCheckCdpMonitorPausedStart,
    );
    assert.equal(
      groupNetworkPolicySummary.fullPostDataResolutionFailureCount,
      0,
    );
    assert.equal(groupNetworkPolicySummary.fullPostDataOversizeBlockCount, 0);
    assert.equal(
      groupNetworkPolicySummary.fullPostDataRepresentationMismatchBlockCount,
      0,
    );
    assert.equal(
      groupNetworkPolicySummary.allowedEgressEgressHeaderForwardCount,
      0,
    );
    assert.equal(
      groupNetworkPolicySummary.nodeOwnedExternalInformationalBrowserExposureCount,
      0,
    );
    assert.equal(
      groupNetworkPolicySummary.directBrowserEarlyHintsObservationCount,
      0,
    );
    assert.equal(
      groupNetworkPolicySummary.directBrowserEarlyHintsCaptureInvalidationCount,
      0,
    );
    groupNetworkPolicySummary.summarySha256 = sha256(
      canonicalJson(groupNetworkPolicySummary),
    );
    for (const captureAttestation of groupCaptureAttestations) {
      const captureRow = captures.find(
        (capture) => capture.id === captureAttestation.id,
      );
      assert.ok(captureRow);
      captureRow.upstreamProvenance = groupUpstreamProvenance;
      captureRow.networkPolicy = groupNetworkPolicySummary;
      captureAttestation.upstreamProvenance = groupUpstreamProvenance;
      captureAttestation.networkPolicy = groupNetworkPolicySummary;
      captureRow.browserAttestationSha256 = sha256(
        Buffer.from(JSON.stringify(captureAttestation)),
      );
    }
    const groupScreenCaptureProtectedRequests = groupRequests.filter(
      (request) =>
        request.phase === "screen-capture" &&
        request.stagingMarker &&
        fixtureDataServices.has(request.firebaseService) &&
        request.method !== "OPTIONS",
    );
    const groupProtectedDataRequests = groupRequests.filter(
      (request) =>
        request.stagingMarker &&
        fixtureDataServices.has(request.firebaseService) &&
        request.method !== "OPTIONS",
    );
    const groupBridgeDecisionUnmatchedProtectedRequestCount =
      stage === "baseline"
        ? groupProtectedDataRequests.filter(
            (request) => !request.appCheckBridgeDecisionObserved,
          ).length
        : 0;
    const groupBridgeScopeIneligibleProtectedRequestCount =
      stage === "baseline"
        ? groupProtectedDataRequests.filter(
            (request) => !request.appCheckBridgeScopeEligible,
          ).length
        : 0;
    const browserAuditFileName = `browser-audits/${stage}-${traceRole}-${viewportName}.jsonl`;
    const browserAuditPath = resolve(outputRoot, browserAuditFileName);
    const auditEvents = [
      {
        type: "browser-session",
        id: groupKey,
        stage,
        role: traceRole,
        viewport,
        browserVersion,
        captureSessionId,
        runnerRuntimeSha256,
        trustedInputsSha256,
        firebaseProjectId: contract.firebaseProjectId,
        fixtureId,
        fixturePlanHash: contract.fixturePlanHash,
        fixtureCaptureBindingHash: fixtureAudit.captureBindingHash,
        fixtureAuditSha256,
        identityAttestation: groupIdentityAttestation,
      },
      {
        type: "origin-rewrite-session",
        id: groupKey,
        ...groupUpstreamProvenance,
      },
      {
        type: "network-policy-session",
        id: groupKey,
        stage,
        ...groupNetworkPolicySummary,
      },
      ...groupDeterministicResponseObservations.map((observation, index) => ({
        type: "deterministic-local-response",
        auditEventId: `${groupKey}:deterministic-${index}`,
        ...observation,
      })),
      ...groupExternalStaticResponseObservations.map((observation, index) => ({
        type: "external-static-response",
        auditEventId: `${groupKey}:external-static-${index}`,
        ...observation,
      })),
      ...groupOptionalTelemetryObservations.map((observation, index) => ({
        type: "optional-telemetry-suppression",
        auditEventId: `${groupKey}:telemetry-${index}`,
        ...observation,
      })),
      {
        type: "app-check-bridge",
        id: groupKey,
        stage,
        scopeHash: baselineAppCheckBridgeScopeHash,
        browserCdpSecurityScopeHash,
        browserWideBoundaryAttestation: groupBrowserWideBoundaryAttestation,
        browserWideBoundaryAttestationHash: sha256(
          canonicalJson(groupBrowserWideBoundaryAttestation),
        ),
        serviceWorkerPolicy: "block",
        interceptionMechanism: "cdp-fetch-request-stage",
        preTransmissionBoundaryAttestationHash:
          preTransmissionNetworkBoundaryAttestationHash,
        nonFirebaseNetworkAllowedHostnameSetHash,
        nonFirebaseNetworkAllowedHostnameCount:
          nonFirebaseNetworkAllowedHostnames.length,
        preTransmissionBoundaryInspectionCount:
          preTransmissionBoundaryInspectionCount -
          groupPreTransmissionBoundaryInspectionStart,
        preTransmissionBoundaryBlockAttemptCount:
          preTransmissionBoundaryBlockAttemptCount -
          groupPreTransmissionBoundaryBlockAttemptStart,
        preTransmissionBoundaryProductionBlockCount:
          preTransmissionBoundaryProductionBlockCount -
          groupPreTransmissionBoundaryProductionBlockStart,
        preTransmissionBoundaryCrossOriginDocumentBlockCount:
          preTransmissionBoundaryCrossOriginDocumentBlockCount -
          groupPreTransmissionBoundaryCrossOriginDocumentBlockStart,
        preTransmissionBoundaryUnboundFirebaseBlockCount:
          preTransmissionBoundaryUnboundFirebaseBlockCount -
          groupPreTransmissionBoundaryUnboundFirebaseBlockStart,
        preTransmissionBoundaryNonFirebaseHostnameBlockCount:
          preTransmissionBoundaryNonFirebaseHostnameBlockCount -
          groupPreTransmissionBoundaryNonFirebaseHostnameBlockStart,
        preTransmissionBoundaryMalformedUrlBlockCount:
          preTransmissionBoundaryMalformedUrlBlockCount -
          groupPreTransmissionBoundaryMalformedUrlBlockStart,
        preTransmissionBoundaryFailRequestCount:
          preTransmissionBoundaryFailRequestCount -
          groupPreTransmissionBoundaryFailRequestStart,
        optionalTelemetrySuppressedRequestCount:
          optionalTelemetrySuppressedRequestCount -
          groupOptionalTelemetrySuppressedStart,
        rawSensitivePreTransmissionInspectionCount:
          rawSensitivePreTransmissionInspectionCount -
          groupRawSensitiveInspectionStart,
        rawSensitivePreTransmissionBlockCount:
          rawSensitivePreTransmissionBlockCount - groupRawSensitiveBlockStart,
        rawProductionPreTransmissionBlockCount:
          rawProductionPreTransmissionBlockCount - groupRawProductionBlockStart,
        rawVercelBypassPreTransmissionBlockCount:
          rawVercelBypassPreTransmissionBlockCount -
          groupRawVercelBypassBlockStart,
        rawStagingApiKeyPreTransmissionBlockCount:
          rawStagingApiKeyPreTransmissionBlockCount -
          groupRawStagingApiKeyBlockStart,
        rawTestCredentialPreTransmissionBlockCount:
          rawTestCredentialPreTransmissionBlockCount -
          groupRawTestCredentialBlockStart,
        rawRefreshTokenPreTransmissionBlockCount:
          rawRefreshTokenPreTransmissionBlockCount -
          groupRawRefreshTokenBlockStart,
        rawDebugTokenPreTransmissionBlockCount:
          rawDebugTokenPreTransmissionBlockCount - groupRawDebugTokenBlockStart,
        rawDebugSentinelPreTransmissionBlockCount:
          rawDebugSentinelPreTransmissionBlockCount -
          groupRawDebugSentinelBlockStart,
        allowedEgressResponsePauseCount:
          allowedEgressResponsePauseCount -
          groupAllowedEgressResponsePauseStart,
        allowedEgressInformationalResponsePauseCount:
          allowedEgressInformationalResponsePauseCount -
          groupAllowedEgressInformationalResponsePauseStart,
        allowedEgressInformationalFinalResponseCount:
          allowedEgressInformationalFinalResponseCount -
          groupAllowedEgressInformationalFinalResponseStart,
        allowedEgressInformationalTrackingResidualCount:
          groupInformationalResponseTrackingResidualCount,
        allowedEgressInvalidResponseStatusAbortCount:
          allowedEgressInvalidResponseStatusAbortCount -
          groupAllowedEgressInvalidResponseStatusAbortStart,
        allowedEgressInformationalEgressHeaderObservationCount:
          allowedEgressInformationalEgressHeaderObservationCount -
          groupAllowedEgressInformationalEgressHeaderObservationStart,
        allowedEgressFinalEgressHeaderObservationCount:
          allowedEgressFinalEgressHeaderObservationCount -
          groupAllowedEgressFinalEgressHeaderObservationStart,
        allowedEgressResponseHeaderSuppressionCount:
          allowedEgressResponseHeaderSuppressionCount -
          groupAllowedEgressResponseHeaderSuppressionStart,
        allowedEgressEgressHeaderForwardCount:
          allowedEgressEgressHeaderForwardCount -
          groupAllowedEgressEgressHeaderForwardStart,
        directBrowserEarlyHintsObservationCount:
          directBrowserEarlyHintsObservationCount -
          groupDirectBrowserEarlyHintsObservationStart,
        directBrowserEarlyHintsEgressHeaderObservationCount:
          directBrowserEarlyHintsEgressHeaderObservationCount -
          groupDirectBrowserEarlyHintsEgressHeaderObservationStart,
        directBrowserEarlyHintsCaptureInvalidationCount:
          directBrowserEarlyHintsCaptureInvalidationCount -
          groupDirectBrowserEarlyHintsCaptureInvalidationStart,
        fullPostDataResolutionCount:
          fullPostDataResolutionCount - groupFullPostDataResolutionStart,
        fullPostDataNetworkFallbackCount:
          fullPostDataNetworkFallbackCount -
          groupFullPostDataNetworkFallbackStart,
        fullPostDataResolutionFailureCount:
          fullPostDataResolutionFailureCount -
          groupFullPostDataResolutionFailureStart,
        fullPostDataOversizeBlockCount:
          fullPostDataOversizeBlockCount - groupFullPostDataOversizeBlockStart,
        fullPostDataRepresentationMismatchBlockCount:
          fullPostDataRepresentationMismatchBlockCount -
          groupFullPostDataRepresentationMismatchBlockStart,
        networkPolicySummaryHash: groupNetworkPolicySummary.summarySha256,
        headerCorrelationMechanism: "playwright-request-allHeaders",
        secretInitScope: "primary-page-only",
        browserGlobalValueKind: "non-secret-fixed-sentinel",
        debugSentinelHash: sha256(APP_CHECK_DEBUG_SENTINEL),
        pageRawDebugTokenInjectionCount:
          pageRawDebugTokenInjectionCount -
          groupPageRawDebugTokenInjectionStart,
        browserGlobalRawDebugTokenWriteCount:
          browserGlobalRawDebugTokenWriteCount -
          groupBrowserGlobalRawDebugTokenWriteStart,
        browserGlobalDebugSentinelWriteCount:
          browserGlobalDebugSentinelWriteCount -
          groupBrowserGlobalDebugSentinelWriteStart,
        localStorageSecretWriteCount:
          browserLocalStorageSecretWriteCount -
          groupBrowserLocalStorageSecretWriteStart,
        pageAppCheckSecretInitRegistrationCount,
        contextAppCheckSecretInitCount:
          contextAppCheckSecretInitRegistrationCount,
        protocolDebugLoggingDisabled: true,
        browserLaunchExplicitEnvironment: true,
        childProcessSecretEnvScrubbed: true,
        browserChildEnvironmentAllowlisted: true,
        browserChildEnvironmentAllowlistHash: sha256(
          canonicalJson(BROWSER_CHILD_ENVIRONMENT_ALLOWLIST),
        ),
        browserChildEnvironmentUnexpectedKeyCount,
        scrubbedSecretEnvironmentVariableCount:
          BROWSER_SECRET_ENVIRONMENT_VARIABLE_NAMES.length,
        browserChildSecretEnvironmentVariableCount,
        browserChildSecretValueObservationCount,
        browserGlobalExtraHttpHeaderRegistrationCount,
        vercelBypassConfigured: Boolean(bypassSecret),
        vercelBypassAllowedOriginSetHash: sha256(
          canonicalJson(vercelBypassAllowedOrigins),
        ),
        vercelBypassTransportContractHash: sha256(
          canonicalJson(VERCEL_BYPASS_TRANSPORT_CONTRACT),
        ),
        vercelBypassCdpInjectedRequestCount:
          vercelBypassCdpInjectedRequestCount -
          groupVercelBypassCdpInjectedStart,
        vercelBypassPreexistingHeaderObservationCount:
          vercelBypassPreexistingHeaderObservationCount -
          groupVercelBypassPreexistingHeaderObservationStart,
        unauthorizedVercelBypassEgressCount:
          unauthorizedVercelBypassEgressCount -
          groupUnauthorizedVercelBypassEgressStart,
        vercelBypassCdpResponsePausedRequestCount:
          vercelBypassCdpResponsePausedRequestCount -
          groupVercelBypassCdpResponsePausedStart,
        vercelBypassHttpSuccessResponseCount:
          vercelBypassHttpSuccessResponseCount -
          groupVercelBypassHttpSuccessResponseStart,
        vercelBypassHttpErrorResponseCount:
          vercelBypassHttpErrorResponseCount -
          groupVercelBypassHttpErrorResponseStart,
        vercelBypassRedirectRequestCount:
          vercelBypassRedirectRequestCount -
          groupVercelBypassRedirectRequestStart,
        vercelBypassRedirectAbortRequestCount:
          vercelBypassRedirectAbortRequestCount -
          groupVercelBypassRedirectAbortStart,
        vercelBypassRedirectResponseAbortRequestCount:
          vercelBypassRedirectResponseAbortRequestCount -
          groupVercelBypassRedirectResponseAbortStart,
        vercelBypassResponseErrorAbortRequestCount:
          vercelBypassResponseErrorAbortRequestCount -
          groupVercelBypassResponseErrorAbortStart,
        vercelBypassObservedEligibleRequestCount:
          vercelBypassObservedEligibleRequestCount -
          groupVercelBypassObservedEligibleStart,
        vercelBypassHeaderObservedRequestCount:
          vercelBypassHeaderObservedRequestCount -
          groupVercelBypassHeaderObservedStart,
        vercelBypassHeaderMissingRequestCount:
          vercelBypassHeaderMissingRequestCount -
          groupVercelBypassHeaderMissingStart,
        vercelBypassHeaderMismatchRequestCount:
          vercelBypassHeaderMismatchRequestCount -
          groupVercelBypassHeaderMismatchStart,
        rawVercelBypassOutputCount: 0,
        urlMethodFifoCorrelationUsed: false,
        playwrightRouteRegistrationCount,
        eligibleRequestCount:
          baselineBridgeEligibleRequestCount - groupBaselineBridgeEligibleStart,
        injectedRequestCount:
          baselineBridgeInjectedRequestCount - groupBaselineBridgeInjectedStart,
        nativeHeaderRequestCount:
          baselineBridgeNativeHeaderRequestCount -
          groupBaselineBridgeNativeHeaderStart,
        scopeMismatchRequestCount:
          baselineBridgeScopeMismatchRequestCount -
          groupBaselineBridgeScopeMismatchStart,
        strippedHeaderRequestCount:
          baselineBridgeStrippedHeaderRequestCount -
          groupBaselineBridgeStrippedHeaderStart,
        redirectRequestCount:
          baselineBridgeRedirectRequestCount - groupBaselineBridgeRedirectStart,
        redirectHeaderAbsentRequestCount:
          baselineBridgeRedirectHeaderAbsentRequestCount -
          groupBaselineBridgeRedirectHeaderAbsentStart,
        redirectAbortRequestCount:
          baselineBridgeRedirectAbortRequestCount -
          groupBaselineBridgeRedirectAbortStart,
        cdpPausedRequestCount:
          baselineBridgeCdpPausedRequestCount -
          groupBaselineBridgeCdpPausedStart,
        cdpResponsePausedRequestCount:
          baselineBridgeCdpResponsePausedRequestCount -
          groupBaselineBridgeCdpResponsePausedStart,
        cdpReconciledRequestCount:
          baselineBridgeCdpReconciledRequestCount -
          groupBaselineBridgeCdpReconciledStart,
        handlerErrorCount:
          appCheckCdpHandlerErrorCount - groupBaselineBridgeHandlerErrorStart,
        injectedRedirectResponseAbortRequestCount:
          baselineBridgeInjectedRedirectResponseAbortCount -
          groupBaselineBridgeInjectedRedirectResponseAbortStart,
        cdpMonitorPausedRequestCount:
          appCheckCdpMonitorPausedRequestCount -
          groupAppCheckCdpMonitorPausedStart,
        debugTokenNetworkObservationCount:
          debugTokenNetworkObservationCount -
          groupDebugTokenNetworkObservationStart,
        debugSentinelNetworkObservationCount:
          debugSentinelNetworkObservationCount -
          groupDebugSentinelNetworkObservationStart,
        authorizedDebugExchangeBodyReplacementCount:
          authorizedDebugExchangeBodyReplacementCount -
          groupAuthorizedDebugExchangeBodyReplacementStart,
        unauthorizedDebugTokenEgressCount:
          unauthorizedDebugTokenEgressCount -
          groupUnauthorizedDebugTokenEgressStart,
        unauthorizedDebugSentinelEgressCount:
          unauthorizedDebugSentinelEgressCount -
          groupUnauthorizedDebugSentinelEgressStart,
        appCheckHeaderNetworkObservationCount:
          appCheckHeaderNetworkObservationCount -
          groupAppCheckHeaderNetworkObservationStart,
        authorizedAppCheckHeaderRequestCount:
          authorizedAppCheckHeaderRequestCount -
          groupAuthorizedAppCheckHeaderRequestStart,
        unauthorizedAppCheckHeaderEgressCount:
          unauthorizedAppCheckHeaderEgressCount -
          groupUnauthorizedAppCheckHeaderEgressStart,
        sensitiveRedirectRequestCount:
          sensitiveAppCheckRedirectRequestCount -
          groupSensitiveAppCheckRedirectRequestStart,
        sensitiveRedirectAbortRequestCount:
          sensitiveAppCheckRedirectAbortRequestCount -
          groupSensitiveAppCheckRedirectAbortRequestStart,
        sensitiveCdpResponsePausedRequestCount:
          sensitiveAppCheckCdpResponsePausedRequestCount -
          groupSensitiveAppCheckCdpResponsePausedStart,
        sensitiveRedirectResponseAbortRequestCount:
          sensitiveAppCheckRedirectResponseAbortRequestCount -
          groupSensitiveAppCheckRedirectResponseAbortStart,
        sensitiveResponseErrorAbortRequestCount:
          sensitiveAppCheckResponseErrorAbortRequestCount -
          groupSensitiveAppCheckResponseErrorAbortStart,
        sensitiveRequestTrackingResidualCount:
          groupSensitiveRequestTrackingResidualCount,
        allowedEgressTrackingResidualCount:
          groupAllowedEgressTrackingResidualCount,
        externalStaticTrackingResidualCount:
          groupExternalStaticTrackingResidualCount,
        networkHeaderAttestationErrorCount,
        pendingBridgeDecisionResidualCount:
          groupPendingBridgeDecisionResidualCount,
        pendingBridgeObservationResidualCount:
          groupPendingBridgeObservationResidualCount,
        unexpectedExtraPageCount: Math.max(0, groupPageCount - 1),
        unexpectedDedicatedWorkerCount: groupDedicatedWorkerCount,
        unexpectedServiceWorkerCount: groupServiceWorkerCount,
        unexpectedCrossOriginFrameCount: groupUnexpectedCrossOriginFrameCount,
        unexpectedOopifTargetCount: groupOopifTargetCount,
        unexpectedDedicatedWorkerTargetCount: groupDedicatedWorkerTargetCount,
        unexpectedSharedWorkerTargetCount: groupSharedWorkerTargetCount,
        unexpectedServiceWorkerTargetCount: groupServiceWorkerTargetCount,
        retainedOopifTargetCount: groupRetainedOopifTargetCount,
        retainedDedicatedWorkerTargetCount:
          groupRetainedDedicatedWorkerTargetCount,
        retainedSharedWorkerTargetCount: groupRetainedSharedWorkerTargetCount,
        retainedServiceWorkerTargetCount: groupRetainedServiceWorkerTargetCount,
        targetDiscoveryActivationCount:
          targetDiscoveryActivationCount - groupTargetDiscoveryActivationStart,
        targetSnapshotCount: targetSnapshotCount - groupTargetSnapshotStart,
        unmatchedProtectedRequestCount:
          groupBridgeDecisionUnmatchedProtectedRequestCount,
        scopeIneligibleProtectedRequestCount:
          groupBridgeScopeIneligibleProtectedRequestCount,
        candidateBridgeInjectedRequestCount:
          candidateBridgeInjectedRequestCount -
          groupCandidateBridgeInjectedStart,
        screenCaptureProtectedRequestCount:
          groupScreenCaptureProtectedRequests.length,
        screenCaptureBridgeHeaderRequestCount:
          groupScreenCaptureProtectedRequests.filter(
            (request) =>
              request.appCheckHeaderSource === "baseline-cdp-fetch-bridge",
          ).length,
        screenCaptureNativeHeaderRequestCount:
          groupScreenCaptureProtectedRequests.filter(
            (request) => request.appCheckHeaderSource === "native-sdk",
          ).length,
        invalidHeaderJwtShapeRequestCount:
          groupScreenCaptureProtectedRequests.filter(
            (request) => !request.appCheckHeaderJwtShapeValid,
          ).length,
        rawHeaderValueOutputCount: 0,
        rawTokenOutputCount: 0,
      },
      ...groupRequests.map((request, sequence) => ({
        type: "network-request",
        sequence,
        phase: request.phase,
        captureId: request.captureId,
        correlationId: request.correlationId,
        method: request.method,
        resourceType: request.resourceType,
        hostname: request.hostname,
        canonicalHostname: request.canonicalHostname,
        firebaseService: request.firebaseService,
        firebase: request.isFirebaseRequest,
        nonFirebaseHostnameAllowed: request.nonFirebaseHostnameAllowed,
        nonFirebasePolicyRuleId: request.nonFirebasePolicyRuleId,
        staging: request.stagingMarker,
        production: request.productionMarker,
        unboundFirebase: request.unboundFirebaseRequest,
        malformedUrlEncoding: request.malformedUrlEncoding,
        productionWrite: request.productionWrite,
        apiKeySha256: request.apiKeySha256,
        apiKeyValueCount: request.apiKeyValueCount,
        apiKeyBindingValid: request.apiKeyBindingValid,
        firebaseTransportValid: request.firebaseTransportValid,
        serviceResourceBound: request.serviceResourceBound,
        appCheckHeaderPresent: request.appCheckHeaderPresent,
        appCheckHeaderSource: request.appCheckHeaderSource,
        appCheckHeaderJwtShapeValid: request.appCheckHeaderJwtShapeValid,
        appCheckBridgeDecisionObserved: request.appCheckBridgeDecisionObserved,
        appCheckBridgeScopeEligible: request.appCheckBridgeScopeEligible,
        appCheckBridgeHeaderStripped: request.appCheckBridgeHeaderStripped,
        appCheckBridgeRedirectedRequest:
          request.appCheckBridgeRedirectedRequest,
        observedProjectIds: request.observedProjectIds,
      })),
      ...groupResponses.map((response, sequence) => ({
        type: "network-response",
        sequence,
        phase: response.phase,
        captureId: response.captureId,
        correlationId: response.correlationId,
        method: response.method,
        resourceType: response.resourceType,
        hostname: response.hostname,
        canonicalHostname: response.canonicalHostname,
        firebaseService: response.firebaseService,
        status: response.status,
        firebase: response.isFirebaseRequest,
        nonFirebaseHostnameAllowed: response.nonFirebaseHostnameAllowed,
        nonFirebasePolicyRuleId: response.nonFirebasePolicyRuleId,
        staging: response.stagingMarker,
        production: response.productionMarker,
        unboundFirebase: response.unboundFirebaseRequest,
        malformedUrlEncoding: response.malformedUrlEncoding,
        apiKeySha256: response.apiKeySha256,
        apiKeyValueCount: response.apiKeyValueCount,
        apiKeyBindingValid: response.apiKeyBindingValid,
        firebaseTransportValid: response.firebaseTransportValid,
        serviceResourceBound: response.serviceResourceBound,
        appCheckHeaderPresent: response.appCheckHeaderPresent,
        appCheckHeaderSource: response.appCheckHeaderSource,
        appCheckHeaderJwtShapeValid: response.appCheckHeaderJwtShapeValid,
        appCheckBridgeDecisionObserved: response.appCheckBridgeDecisionObserved,
        appCheckBridgeScopeEligible: response.appCheckBridgeScopeEligible,
        appCheckBridgeHeaderStripped: response.appCheckBridgeHeaderStripped,
        appCheckBridgeRedirectedRequest:
          response.appCheckBridgeRedirectedRequest,
        observedProjectIds: response.observedProjectIds,
      })),
      ...groupStableOriginRewriteObservations.map((observation, sequence) => ({
        type: "origin-rewrite",
        sequence,
        stage: observation.stage,
        phase: observation.phase,
        captureId: observation.captureId,
        method: observation.method,
        resourceType: observation.resourceType,
        kind: observation.kind,
        browserOrigin: observation.browserOrigin,
        browserPath: observation.browserPath,
        browserUrlSha256: observation.browserUrlSha256,
        upstreamDeploymentId: observation.upstreamDeploymentId,
        upstreamOrigin: observation.upstreamOrigin,
        upstreamUrl: observation.upstreamUrl,
        upstreamUrlSha256: observation.upstreamUrlSha256,
        redirectRequest: observation.redirectRequest,
        redirectResponse: observation.redirectResponse,
        responseStatus: observation.responseStatus,
        responseError: observation.responseError,
        payloadSha256: observation.responseBodySha256,
        payloadBytes: observation.responseBodyBytes,
        immutableAttestationSha256: observation.immutableAttestationSha256,
        immutableAttestationBytes: observation.immutableAttestationBytes,
        byteMatch: observation.byteMatch,
      })),
      ...groupCaptureAttestations,
      {
        type: "browser-session-complete",
        id: groupKey,
        captureCount: groupCaptureAttestations.length,
        network: summarizeNetwork(groupRequests, groupResponses),
      },
    ];
    const browserAuditText = `${auditEvents
      .map((event) => JSON.stringify(event))
      .join("\n")}\n`;
    for (const secret of [
      ...Object.values(credentials).flatMap((credential) => [
        credential.email,
        credential.password,
      ]),
      firebaseConfig.apiKey,
      firebaseConfig.appId,
      appCheckDebugToken,
      APP_CHECK_DEBUG_SENTINEL,
      bypassSecret,
    ].filter(Boolean)) {
      assert.equal(
        browserAuditText.includes(secret),
        false,
        "A credential or deployment secret reached the browser audit.",
      );
    }
    assert.doesNotMatch(
      browserAuditText,
      /"(?:authorization|idToken|refreshToken|password|postData|responseBody)"\s*:/iu,
      "The browser audit contains a sensitive transport field.",
    );
    assertNoAppCheckSecretMaterial(browserAuditText, {
      debugToken: appCheckDebugToken,
      debugSentinel: APP_CHECK_DEBUG_SENTINEL,
    });
    writeFileSync(browserAuditPath, browserAuditText, "utf8");
    browserAudits.push({
      id: groupKey,
      stage,
      role: traceRole,
      viewport,
      fileName: browserAuditFileName,
      sha256: sha256(readFileSync(browserAuditPath)),
      captureIds: groupTargets.map((target) =>
        captureKey(stage, target.screen.id, viewport),
      ),
    });
  }
  browserWideBoundaryFinalSnapshot = browserWideBoundaryController.snapshot();
  assert.equal(
    browserWideBoundaryFinalSnapshot.activationCount,
    groupedTargets.size,
  );
  assert.equal(
    browserWideBoundaryFinalSnapshot.primaryTargetConfiguredCount,
    groupedTargets.size,
  );
  assert.equal(
    browserWideBoundaryFinalSnapshot.primaryRequestBoundaryHandoffCount,
    groupedTargets.size,
  );
  assert.equal(
    browserWideBoundaryFinalSnapshot.secondaryTargetClosedBeforeResumeCount,
    0,
  );
  assert.equal(browserWideBoundaryFinalSnapshot.handlerErrorCount, 0);
  assert.equal(
    browserWideBoundaryFinalSnapshot.fullPostDataResolutionCount,
    browserWideBoundaryFinalSnapshot.requestInspectionCount,
  );
  assert.equal(
    browserWideBoundaryFinalSnapshot.fullPostDataResolutionFailureCount,
    0,
  );
  assert.equal(
    browserWideBoundaryFinalSnapshot.fullPostDataOversizeBlockCount,
    0,
  );
  assert.equal(
    browserWideBoundaryFinalSnapshot.fullPostDataRepresentationMismatchBlockCount,
    0,
  );
  assert.equal(browserWideBoundaryFinalSnapshot.pendingSetupCount, 0);
  assert.equal(browserWideBoundaryFinalSnapshot.pendingHandlerCount, 0);
  assert.equal(
    browserWideBoundaryFinalSnapshot.heldRuntimeResumeResidualCount,
    0,
  );
  assert.equal(browserWideBoundaryFinalSnapshot.fatalErrorCount, 0);
  await browserWideBoundaryController.restore();
} finally {
  try {
    browserConnectProxy.setAuditStage("browser-cleanup");
    if (browserWideBoundaryController) {
      await browserWideBoundaryController.forceRestore();
    }
  } finally {
    try {
      await browser.close();
    } finally {
      try {
        await browserConnectProxy.close();
        browserConnectProxyFinalSnapshot = browserConnectProxy.snapshot();
      } finally {
        await captureAppCheckTokenManager.close();
      }
    }
  }
}
assert.ok(browserConnectProxyFinalSnapshot);
browserConnectProxy.assertHealthy();
assert.equal(browserConnectProxyFinalSnapshot.listenerStartCount, 1);
assert.equal(browserConnectProxyFinalSnapshot.listenerCloseCount, 1);
assert.deepEqual(
  browserConnectProxyFinalSnapshot.browserProductBackgroundDenyHostnames,
  BROWSER_PRODUCT_BACKGROUND_DENY_HOSTNAMES,
);
assert.equal(
  browserConnectProxyFinalSnapshot.browserProductBackgroundDenyHostnameSetHash,
  secretSha256(JSON.stringify(BROWSER_PRODUCT_BACKGROUND_DENY_HOSTNAMES)),
);
assert.equal(
  browserConnectProxyFinalSnapshot.deniedConnectCount,
  browserConnectProxyFinalSnapshot.browserProductBackgroundDenyCount,
);
assert.equal(browserConnectProxyFinalSnapshot.fatalPolicyDenyCount, 0);
assert.equal(
  browserConnectProxyFinalSnapshot.browserProductBackgroundCredentialOrBodyObservationCount,
  0,
);
assert.equal(
  browserConnectProxyFinalSnapshot.uncorrelatedAllowedConnectDenyCount,
  0,
);
assert.equal(browserConnectProxyFinalSnapshot.httpAbsoluteFormDenyCount, 0);
assert.equal(browserConnectProxyFinalSnapshot.upgradeDenyCount, 0);
assert.equal(browserConnectProxyFinalSnapshot.invalidAuthorityDenyCount, 0);
assert.equal(browserConnectProxyFinalSnapshot.ipLiteralDenyCount, 0);
assert.equal(browserConnectProxyFinalSnapshot.alternatePortDenyCount, 0);
assert.equal(browserConnectProxyFinalSnapshot.connectHeaderDenyCount, 0);
assert.equal(
  browserConnectProxyFinalSnapshot.unallowlistedHostnameDenyCount,
  browserConnectProxyFinalSnapshot.browserProductBackgroundDenyCount,
);
assert.equal(browserConnectProxyFinalSnapshot.activeClientSocketCount, 0);
assert.equal(browserConnectProxyFinalSnapshot.activeUpstreamSocketCount, 0);
assert.equal(browserConnectProxyFinalSnapshot.fatalErrorCount, 0);
assert.deepEqual(browserConnectProxyFinalSnapshot.allowedRequestOrigins, [
  stableBrowserOrigin,
]);
assert.deepEqual(
  browserConnectProxyFinalSnapshot.authorizedRequestMethods,
  BROWSER_CONNECT_PROXY_AUTHORIZED_REQUEST_METHODS,
);
assert.equal(
  browserConnectProxyFinalSnapshot.requestStageAuthorizationCount,
  browserConnectProxyFinalSnapshot.requestStageAuthorizationCompleteCount,
);
assert.equal(
  browserConnectProxyFinalSnapshot.requestStageAuthorizationRevocationCount,
  0,
);
assert.equal(
  browserConnectProxyFinalSnapshot.authorityLeaseIssueCount,
  browserConnectProxyFinalSnapshot.requestStageAuthorizationCount,
);
assert.equal(
  browserConnectProxyFinalSnapshot.authorityLeaseConsumeCount,
  browserConnectProxyFinalSnapshot.allowedConnectCount,
);
assert.equal(
  browserConnectProxyFinalSnapshot.upstreamSocketCreateCount,
  browserConnectProxyFinalSnapshot.allowedConnectCount,
);
assert.equal(browserConnectProxyFinalSnapshot.authorityLeaseRevocationCount, 0);
assert.equal(
  browserConnectProxyFinalSnapshot.authorityLeaseExpiredBeforeConnectCount,
  0,
);
assert.equal(
  browserConnectProxyFinalSnapshot.authorityLeaseIssueCount,
  browserConnectProxyFinalSnapshot.authorityLeaseConsumeCount +
    browserConnectProxyFinalSnapshot.authorityLeaseUnusedCompletionCount +
    browserConnectProxyFinalSnapshot.authorityLeaseRevocationCount +
    browserConnectProxyFinalSnapshot.authorityLeaseExpiredBeforeConnectCount,
);
assert.equal(
  browserConnectProxyFinalSnapshot.requestStageAuthorizationResidualCount,
  0,
);
assert.equal(browserConnectProxyFinalSnapshot.authorityLeaseResidualCount, 0);
assert.equal(
  browserConnectProxyFinalSnapshot.authorityLeaseQueueResidualCount,
  0,
);
assert.equal(
  browserConnectProxyFinalSnapshot.activeAllowedTunnelResidualCount,
  0,
);
for (const observation of browserConnectProxyFinalSnapshot.browserProductBackgroundDenyObservations) {
  assert.equal(observation.stage, "browser-launch");
  assert.equal(observation.source, "browser-process-proxy-only-connect");
  assert.equal(observation.port, "443");
  assert.equal(
    BROWSER_PRODUCT_BACKGROUND_DENY_HOSTNAMES.includes(observation.hostname),
    true,
  );
  assert.ok(observation.count > 0);
}
assert.equal(
  browserConnectProxyFinalSnapshot.browserProductBackgroundDenyObservations.reduce(
    (total, observation) => total + observation.count,
    0,
  ),
  browserConnectProxyFinalSnapshot.browserProductBackgroundDenyCount,
);
assert.equal(
  browserConnectProxyFinalSnapshot.connectRequestCount,
  browserConnectProxyFinalSnapshot.allowedConnectCount +
    browserConnectProxyFinalSnapshot.deniedConnectCount,
);
for (const observation of browserConnectProxyFinalSnapshot.requestStageAuthorizationObservations) {
  assert.equal(["baseline", "candidate"].includes(observation.stage), true);
  assert.equal(
    BROWSER_CONNECT_PROXY_ALLOWED_FIREBASE_HOSTNAMES.includes(
      observation.hostname,
    ),
    true,
  );
  assert.equal(
    BROWSER_CONNECT_PROXY_AUTHORIZED_REQUEST_METHODS.includes(
      observation.method,
    ),
    true,
  );
  assert.equal(observation.origin, stableBrowserOrigin);
  assert.equal(
    [
      "authority-lease-active-tunnel-present",
      "authority-lease-no-active-tunnel",
    ].includes(observation.kind),
    true,
  );
  assert.ok(observation.count > 0);
}
assert.equal(
  browserConnectProxyFinalSnapshot.requestStageAuthorizationObservations.reduce(
    (total, observation) => total + observation.count,
    0,
  ),
  browserConnectProxyFinalSnapshot.requestStageAuthorizationCount,
);
for (const observation of browserConnectProxyFinalSnapshot.authorityLeaseConsumeObservations) {
  assert.equal(["baseline", "candidate"].includes(observation.stage), true);
  assert.equal(
    BROWSER_CONNECT_PROXY_ALLOWED_FIREBASE_HOSTNAMES.includes(
      observation.hostname,
    ),
    true,
  );
  assert.equal(
    BROWSER_CONNECT_PROXY_AUTHORIZED_REQUEST_METHODS.includes(
      observation.method,
    ),
    true,
  );
  assert.equal(observation.origin, stableBrowserOrigin);
  assert.ok(observation.count > 0);
}
assert.equal(
  browserConnectProxyFinalSnapshot.authorityLeaseConsumeObservations.reduce(
    (total, observation) => total + observation.count,
    0,
  ),
  browserConnectProxyFinalSnapshot.authorityLeaseConsumeCount,
);
for (const {
  authority,
  count,
} of browserConnectProxyFinalSnapshot.deniedConnectAuthorities) {
  assert.equal(
    BROWSER_PRODUCT_BACKGROUND_DENY_HOSTNAMES.map(
      (hostname) => `${hostname}:443`,
    ).includes(authority),
    true,
  );
  assert.ok(count > 0);
}
const browserObservedDirectFirebaseHostnames = [
  ...new Set(
    networkObservations
      .filter(
        (observation) =>
          observation.isFirebaseRequest && observation.stagingMarker,
      )
      .map(({ canonicalHostname }) => canonicalHostname),
  ),
].sort();
const browserConnectProxyAllowedConnectHostnames =
  browserConnectProxyFinalSnapshot.allowedConnectHosts
    .map(({ hostname }) => hostname)
    .sort();
const browserConnectProxyAuthorizedHostnames = [
  ...new Set(
    browserConnectProxyFinalSnapshot.requestStageAuthorizationObservations.map(
      ({ hostname }) => hostname,
    ),
  ),
].sort();
assert.deepEqual(
  browserConnectProxyAuthorizedHostnames,
  browserObservedDirectFirebaseHostnames,
);
assert.deepEqual(
  browserConnectProxyAllowedConnectHostnames,
  browserObservedDirectFirebaseHostnames,
);
assert.ok(browserConnectProxyFinalSnapshot.allowedConnectCount > 0);
assert.equal(appCheckInitScriptInjectionCount, groupedTargets.size);
assert.equal(
  secondaryExecutionGuardInitScriptRegistrationCount,
  groupedTargets.size,
);
assert.equal(playwrightWebSocketRouteRegistrationCount, groupedTargets.size);
assert.equal(playwrightWebSocketRouteInterceptCount, 0);
assert.equal(webSocketConnectToServerCount, 0);
assert.equal(webSocketHandshakeRequestCount, 0);
assert.equal(webTransportCreatedCount, 0);
assert.equal(browserWideBoundaryGroupAttestations.length, groupedTargets.size);
assert.equal(pageRawDebugTokenInjectionCount, 0);
assert.equal(browserGlobalRawDebugTokenWriteCount, 0);
assert.equal(browserLocalStorageSecretWriteCount, 0);
assert.ok(browserGlobalDebugSentinelWriteCount >= groupedTargets.size);
assert.equal(browserContextCloseCount, groupedTargets.size);
assert.equal(targetDiscoveryActivationCount, groupedTargets.size);
assert.equal(targetSnapshotCount, groupedTargets.size);
assert.equal(
  browserConsoleSecretObservationCount,
  0,
  "Raw App Check token material reached the browser console.",
);
assert.equal(
  browserDomSecretObservationCount,
  0,
  "Raw App Check token material reached the rendered DOM.",
);
assert.equal(
  browserRequestFailureCount,
  0,
  "A browser request failed during App Check-bound capture.",
);
assert.equal(
  browserCorsConsoleErrorCount,
  0,
  "A browser CORS error occurred during App Check-bound capture.",
);
assert.equal(browserNetworkHeaderAttestationErrorCount, 0);
assert.equal(unexpectedExtraPageCount, 0);
assert.equal(unexpectedDedicatedWorkerCount, 0);
assert.equal(unexpectedServiceWorkerCount, 0);
assert.equal(unexpectedCrossOriginFrameCount, 0);
assert.equal(unexpectedOopifTargetCount, 0);
assert.equal(unexpectedDedicatedWorkerTargetCount, 0);
assert.equal(unexpectedSharedWorkerTargetCount, 0);
assert.equal(unexpectedServiceWorkerTargetCount, 0);
assert.equal(retainedOopifTargetCount, 0);
assert.equal(retainedDedicatedWorkerTargetCount, 0);
assert.equal(retainedSharedWorkerTargetCount, 0);
assert.equal(retainedServiceWorkerTargetCount, 0);
assert.equal(playwrightRouteRegistrationCount, 0);
assert.equal(browserGlobalExtraHttpHeaderRegistrationCount, 0);

const comparisonRows = [];
for (const screen of screens) {
  for (const viewport of viewportsForScreen(screen.id)) {
    const baselineScreenId = screen.productionPresentation
      ? screen.id
      : contract.newSurfaceReferences[screen.id];
    comparisonRows.push({
      id: comparisonKey(screen.id, viewport),
      screenId: screen.id,
      viewport,
      mode: screen.productionPresentation ? "pixel" : "shell",
      baselineCaptureId: captureKey("baseline", baselineScreenId, viewport),
      candidateCaptureId: captureKey("candidate", screen.id, viewport),
      maskRegions: [],
    });
  }
}

let nodeDeploymentFetchRequestCount = 0;
let nodeDeploymentFetchHttp200Count = 0;
let nodeDeploymentRedirectResponseCount = 0;
let nodeVercelBypassHeaderRequestCount = 0;
let nodeDeploymentSkipToolbarHeaderRequestCount = 0;
let nodeDeploymentVercelToolbarMarkupObservationCount = 0;
const fetchHtml = async (url) => {
  const parsed = new URL(url);
  assert.ok(vercelBypassAllowedOrigins.includes(exactVercelOrigin(parsed)));
  nodeDeploymentFetchRequestCount += 1;
  if (bypassSecret) nodeVercelBypassHeaderRequestCount += 1;
  nodeDeploymentSkipToolbarHeaderRequestCount += 1;
  const response = await fetch(parsed, {
    headers: deploymentNodeRequestHeaders,
    redirect: "error",
  });
  if (response.status >= 300 && response.status < 400) {
    nodeDeploymentRedirectResponseCount += 1;
  }
  assert.equal(response.status, 200, `${url} is not available.`);
  nodeDeploymentFetchHttp200Count += 1;
  const bytes = Buffer.from(await response.arrayBuffer());
  const vercelToolbarMarkupObserved = containsVercelPreviewToolbarMarkup(bytes);
  nodeDeploymentVercelToolbarMarkupObservationCount += Number(
    vercelToolbarMarkupObserved,
  );
  assert.equal(
    vercelToolbarMarkupObserved,
    false,
    `${parsed.origin} HTML contains Vercel Preview Toolbar markup.`,
  );
  return bytes;
};
const inspectFirebaseBundle = async (deploymentUrl, html) => {
  const deploymentOrigin = new URL(deploymentUrl).origin;
  const scriptPaths = [
    ...new Set(
      [
        ...html
          .toString("utf8")
          .matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["']/giu),
      ]
        .map((match) => new URL(match[1], deploymentUrl))
        .filter((url) => url.origin === deploymentOrigin)
        .map((url) => `${url.pathname}${url.search}`),
    ),
  ].sort();
  assert.ok(
    scriptPaths.length > 0,
    `${deploymentUrl} has no local script bundle.`,
  );
  const assets = [];
  let combinedSource = "";
  for (const path of scriptPaths) {
    const assetUrl = new URL(path, deploymentUrl);
    assert.ok(vercelBypassAllowedOrigins.includes(exactVercelOrigin(assetUrl)));
    nodeDeploymentFetchRequestCount += 1;
    if (bypassSecret) nodeVercelBypassHeaderRequestCount += 1;
    nodeDeploymentSkipToolbarHeaderRequestCount += 1;
    const response = await fetch(assetUrl, {
      headers: deploymentNodeRequestHeaders,
      redirect: "error",
    });
    if (response.status >= 300 && response.status < 400) {
      nodeDeploymentRedirectResponseCount += 1;
    }
    assert.equal(response.status, 200, `${path} is not available.`);
    nodeDeploymentFetchHttp200Count += 1;
    const bytes = Buffer.from(await response.arrayBuffer());
    combinedSource += bytes.toString("utf8");
    assets.push({ path, sha256: sha256(bytes), bytes: bytes.length });
  }
  assert.match(
    combinedSource,
    new RegExp(
      contract.firebaseProjectId.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"),
      "u",
    ),
    `${deploymentUrl} is not built for the dedicated staging Firebase project.`,
  );
  return {
    firebaseProjectId: contract.firebaseProjectId,
    assets,
  };
};
const baselineHtml = await fetchHtml(baselineDeploymentUrl);
const candidateHtml = await fetchHtml(candidateDeploymentUrl);
const candidateAliasHtml = await fetchHtml(contract.stableAlias);
assert.equal(
  sha256(candidateAliasHtml),
  sha256(candidateHtml),
  "The fixed candidate alias does not serve the immutable candidate deployment.",
);
const baselineFirebaseBundle = await inspectFirebaseBundle(
  baselineDeploymentUrl,
  baselineHtml,
);
const candidateFirebaseBundle = await inspectFirebaseBundle(
  candidateDeploymentUrl,
  candidateHtml,
);
for (const group of stableOriginRewriteGroups) {
  const deploymentHtml =
    group.stage === "baseline" ? baselineHtml : candidateHtml;
  const deploymentBundle =
    group.stage === "baseline"
      ? baselineFirebaseBundle
      : candidateFirebaseBundle;
  assert.deepEqual(group.documentBodySha256s, [sha256(deploymentHtml)]);
  assert.equal(
    deploymentBundle.assets.every((asset) =>
      group.scriptBodySha256s.includes(asset.sha256),
    ),
    true,
    `${group.id} did not load every immutable entry script.`,
  );
}
const completedAt = new Date().toISOString();
assert.equal(nodeDeploymentRedirectResponseCount, 0);
assert.equal(nodeDeploymentFetchRequestCount, nodeDeploymentFetchHttp200Count);
assert.equal(
  nodeVercelBypassHeaderRequestCount,
  bypassSecret ? nodeDeploymentFetchRequestCount : 0,
);
assert.equal(
  nodeDeploymentSkipToolbarHeaderRequestCount,
  nodeDeploymentFetchRequestCount,
);
assert.equal(nodeDeploymentVercelToolbarMarkupObservationCount, 0);
assert.ok(
  Date.parse(completedAt) <= fixtureAuditExpiresAt,
  "The fixture audit expired before browser capture completed.",
);
for (const auditRole of fixtureAudit.authRoles) {
  const identity = identityAttestations.get(auditRole.role);
  assert.ok(identity, `Missing browser identity for ${auditRole.role}.`);
  assert.equal(identity.uidSha256, auditRole.uidHash);
  assert.equal(identity.emailSha256, auditRole.emailHash);
}
const networkSummary = summarizeNetwork(
  networkObservations,
  networkResponseObservations,
);
const protectedDataRequests = networkObservations.filter(
  (request) =>
    request.stagingMarker &&
    fixtureDataServices.has(request.firebaseService) &&
    request.method !== "OPTIONS",
);
const baselineProtectedDataRequests = protectedDataRequests.filter((request) =>
  request.groupKey.startsWith("baseline:"),
);
const candidateProtectedDataRequests = protectedDataRequests.filter((request) =>
  request.groupKey.startsWith("candidate:"),
);
const candidateNativeAppCheckHeaderMissingRequestCount =
  candidateProtectedDataRequests.filter(
    (request) => !request.appCheckHeaderPresent,
  ).length;
const baselineEffectiveHeaderMissingRequestCount =
  baselineProtectedDataRequests.filter(
    (request) => !request.appCheckHeaderPresent,
  ).length;
const baselineBridgeDecisionUnmatchedProtectedRequestCount =
  baselineProtectedDataRequests.filter(
    (request) => !request.appCheckBridgeDecisionObserved,
  ).length;
const baselineBridgeScopeIneligibleProtectedRequestCount =
  baselineProtectedDataRequests.filter(
    (request) => !request.appCheckBridgeScopeEligible,
  ).length;
const protectedHeaderJwtShapeInvalidRequestCount = protectedDataRequests.filter(
  (request) =>
    !request.appCheckHeaderPresent || !request.appCheckHeaderJwtShapeValid,
).length;
const baselineScreenCaptureProtectedDataRequests =
  baselineProtectedDataRequests.filter(
    (request) => request.phase === "screen-capture",
  );
const candidateScreenCaptureProtectedDataRequests =
  candidateProtectedDataRequests.filter(
    (request) => request.phase === "screen-capture",
  );
const baselineScreenCaptureBridgeRequestCount =
  baselineScreenCaptureProtectedDataRequests.filter(
    (request) => request.appCheckHeaderSource === "baseline-cdp-fetch-bridge",
  ).length;
const candidateScreenCaptureNativeRequestCount =
  candidateScreenCaptureProtectedDataRequests.filter(
    (request) => request.appCheckHeaderSource === "native-sdk",
  ).length;
const firebaseDataRedirectResponseCount = networkResponseObservations.filter(
  (response) =>
    response.stagingMarker &&
    fixtureDataServices.has(response.firebaseService) &&
    response.status >= 300 &&
    response.status < 400,
).length;
const firebaseDataErrorResponseCount = networkResponseObservations.filter(
  (response) =>
    response.stagingMarker &&
    fixtureDataServices.has(response.firebaseService) &&
    response.status >= 400,
).length;
const successfulFirebaseDataResponseCount = networkResponseObservations.filter(
  (response) =>
    response.stagingMarker &&
    fixtureDataServices.has(response.firebaseService) &&
    response.status >= 200 &&
    response.status < 300,
).length;
assert.ok(baselineProtectedDataRequests.length > 0);
assert.ok(candidateProtectedDataRequests.length > 0);
assert.equal(
  baselineBridgeEligibleRequestCount,
  baselineProtectedDataRequests.length,
  "A baseline Firebase data request escaped the exact App Check bridge scope.",
);
assert.equal(
  baselineBridgeInjectedRequestCount + baselineBridgeNativeHeaderRequestCount,
  baselineBridgeEligibleRequestCount,
);
assert.ok(
  baselineBridgeInjectedRequestCount > 0,
  "The baseline bundle never exercised the App Check route bridge.",
);
assert.equal(baselineBridgeScopeMismatchRequestCount, 0);
assert.equal(baselineEffectiveHeaderMissingRequestCount, 0);
assert.equal(baselineBridgeDecisionUnmatchedProtectedRequestCount, 0);
assert.equal(baselineBridgeScopeIneligibleProtectedRequestCount, 0);
assert.ok(baselineBridgeCdpPausedRequestCount > 0);
assert.ok(baselineBridgeCdpReconciledRequestCount > 0);
assert.equal(appCheckCdpHandlerErrorCount, 0);
assert.equal(baselineBridgeRedirectAbortRequestCount, 0);
assert.equal(candidateBridgeInjectedRequestCount, 0);
assert.equal(candidateNativeAppCheckHeaderMissingRequestCount, 0);
assert.equal(protectedHeaderJwtShapeInvalidRequestCount, 0);
assert.ok(baselineScreenCaptureProtectedDataRequests.length > 0);
assert.equal(
  baselineScreenCaptureBridgeRequestCount,
  baselineScreenCaptureProtectedDataRequests.length,
);
assert.ok(candidateScreenCaptureProtectedDataRequests.length > 0);
assert.equal(
  candidateScreenCaptureNativeRequestCount,
  candidateScreenCaptureProtectedDataRequests.length,
);
assert.equal(firebaseDataRedirectResponseCount, 0);
assert.equal(firebaseDataErrorResponseCount, 0);
assert.ok(successfulFirebaseDataResponseCount > 0);
assert.ok(networkSummary.appCheckExchangeRequestCount > 0);
assert.equal(
  networkSummary.successfulAppCheckExchangeResponseCount,
  networkSummary.appCheckExchangeRequestCount,
);
assert.equal(
  networkSummary.appCheckProtectedDataRequestCount,
  protectedDataRequests.length,
);
assert.equal(
  networkSummary.appCheckHeaderPresentRequestCount,
  protectedDataRequests.length,
);
assert.equal(networkSummary.appCheckHeaderMissingRequestCount, 0);
assert.equal(
  networkSummary.appCheckHeaderJwtShapeValidRequestCount,
  protectedDataRequests.length,
);
assert.equal(networkSummary.appCheckHeaderJwtShapeInvalidRequestCount, 0);
assert.equal(debugTokenNetworkObservationCount, 0);
assert.equal(unauthorizedDebugTokenEgressCount, 0);
assert.equal(
  debugSentinelNetworkObservationCount,
  authorizedDebugExchangeBodyReplacementCount,
);
assert.equal(unauthorizedDebugSentinelEgressCount, 0);
assert.equal(
  authorizedDebugExchangeBodyReplacementCount,
  networkSummary.appCheckExchangeRequestCount,
);
assert.equal(
  appCheckHeaderNetworkObservationCount,
  authorizedAppCheckHeaderRequestCount,
);
assert.equal(unauthorizedAppCheckHeaderEgressCount, 0);
assert.equal(sensitiveAppCheckRedirectRequestCount, 0);
assert.equal(sensitiveAppCheckRedirectAbortRequestCount, 0);
assert.equal(sensitiveAppCheckRedirectResponseAbortRequestCount, 0);
assert.equal(sensitiveAppCheckResponseErrorAbortRequestCount, 0);
assert.equal(sensitiveAppCheckRequestTrackingResidualCount, 0);
assert.equal(pendingBridgeDecisionResidualCount, 0);
assert.equal(pendingBridgeObservationResidualCount, 0);
assert.equal(vercelBypassPreexistingHeaderObservationCount, 0);
assert.equal(unauthorizedVercelBypassEgressCount, 0);
assert.equal(vercelBypassRedirectRequestCount, 0);
assert.equal(vercelBypassRedirectAbortRequestCount, 0);
assert.equal(vercelBypassRedirectResponseAbortRequestCount, 0);
assert.equal(vercelBypassResponseErrorAbortRequestCount, 0);
assert.equal(vercelBypassHttpErrorResponseCount, 0);
assert.equal(vercelBypassHeaderMissingRequestCount, 0);
assert.equal(vercelBypassHeaderMismatchRequestCount, 0);
assert.equal(vercelBypassCdpInjectedRequestCount, 0);
assert.equal(vercelBypassObservedEligibleRequestCount, 0);
assert.equal(vercelBypassHeaderObservedRequestCount, 0);
assert.equal(vercelBypassCdpResponsePausedRequestCount, 0);
assert.equal(vercelBypassHttpSuccessResponseCount, 0);
assert.equal(
  sensitiveAppCheckCdpResponsePausedRequestCount,
  authorizedDebugExchangeBodyReplacementCount +
    authorizedAppCheckHeaderRequestCount,
);
assert.equal(
  baselineBridgeCdpResponsePausedRequestCount,
  baselineBridgeInjectedRequestCount,
);
assert.equal(baselineBridgeRedirectRequestCount, 0);
assert.equal(baselineBridgeRedirectHeaderAbsentRequestCount, 0);
assert.equal(baselineBridgeStrippedHeaderRequestCount, 0);
assert.ok(stableOriginRewriteRequestCount > 0);
assert.equal(
  stableOriginRewriteRequestCount,
  stableOriginRewriteObservations.length,
);
assert.equal(stableOriginRewriteResponseCount, stableOriginRewriteRequestCount);
assert.equal(
  stableOriginRewriteHttpSuccessResponseCount,
  stableOriginRewriteRequestCount,
);
assert.ok(stableOriginRewriteDocumentRequestCount >= groupedTargets.size);
assert.ok(stableOriginRewriteScriptRequestCount >= groupedTargets.size);
assert.ok(stableOriginRewriteBodyHashCount >= groupedTargets.size * 2);
assert.equal(stableOriginRewriteGroups.length, groupedTargets.size);
for (const count of [
  stableOriginRewriteHttpErrorResponseCount,
  stableOriginRewriteRedirectRequestCount,
  stableOriginRewriteRedirectResponseCount,
  stableOriginRewriteResponseErrorCount,
  stableOriginRewriteBodyHashMismatchCount,
  stableOriginRewriteTrackingResidualCount,
  stableOriginRewriteExternalRequestCount,
  stableOriginRewriteFirebaseGoogleRequestCount,
  stableOriginRewriteScopeMismatchRequestCount,
  directImmutableOriginBrowserRequestCount,
]) {
  assert.equal(count, 0);
}
assert.ok(immutableResourceAttestationRequestCount >= 4);
assert.equal(
  immutableResourceAttestationRequestCount,
  immutableResourceFetchCache.size,
);
assert.equal(
  immutableResourceAttestationHttp200Count,
  immutableResourceAttestationRequestCount,
);
assert.equal(immutableResourceAttestationRedirectResponseCount, 0);
assert.equal(immutableResourceAttestationParserMarkupRejectCount, 0);
assert.equal(
  immutableResourceAttestationBypassHeaderRequestCount,
  bypassSecret ? immutableResourceAttestationRequestCount : 0,
);
assert.equal(
  immutableResourceAttestationSkipToolbarHeaderRequestCount,
  immutableResourceAttestationRequestCount,
);
assert.equal(
  immutableResourceAttestationVercelToolbarMarkupObservationCount,
  0,
);
if (bypassSecret) {
  assert.equal(
    immutableResourceAttestationBypassHeaderRequestCount,
    immutableResourceAttestationRequestCount,
  );
}
for (const count of [
  vercelBypassCdpInjectedRequestCount,
  vercelBypassPreexistingHeaderObservationCount,
  vercelBypassCdpResponsePausedRequestCount,
  vercelBypassHttpSuccessResponseCount,
  vercelBypassHttpErrorResponseCount,
  vercelBypassObservedEligibleRequestCount,
  vercelBypassHeaderObservedRequestCount,
  vercelBypassHeaderMissingRequestCount,
  vercelBypassHeaderMismatchRequestCount,
]) {
  assert.equal(count, 0);
}
assert.equal(
  stableOriginRewriteLocalFulfillCount,
  stableOriginRewriteRequestCount,
);
assert.equal(stableOriginRewriteBrowserNetworkRequestCount, 0);
assert.equal(stableOriginRewriteResponseLinkHeaderForwardCount, 0);
assert.equal(browserSkipToolbarHeaderObservationCount, 0);
assert.equal(browserSkipToolbarHeaderPreTransmissionBlockCount, 0);
const browserTransportBinding = {
  schemaVersion: 3,
  contract: contract.browserTransport,
  contractHash: stableOriginRewriteTransportContractHash,
  browserOrigin: stableBrowserOrigin,
  browserOriginSha256: sha256(stableBrowserOrigin),
  immutableUpstreamBinding,
  immutableUpstreamBindingHash,
  requestCount: stableOriginRewriteRequestCount,
  responseCount: stableOriginRewriteResponseCount,
  httpSuccessResponseCount: stableOriginRewriteHttpSuccessResponseCount,
  httpErrorResponseCount: stableOriginRewriteHttpErrorResponseCount,
  documentRequestCount: stableOriginRewriteDocumentRequestCount,
  scriptRequestCount: stableOriginRewriteScriptRequestCount,
  bodyHashCount: stableOriginRewriteBodyHashCount,
  bodyHashMismatchCount: stableOriginRewriteBodyHashMismatchCount,
  redirectRequestCount: stableOriginRewriteRedirectRequestCount,
  redirectResponseCount: stableOriginRewriteRedirectResponseCount,
  responseErrorCount: stableOriginRewriteResponseErrorCount,
  trackingResidualCount: stableOriginRewriteTrackingResidualCount,
  externalRewriteRequestCount: stableOriginRewriteExternalRequestCount,
  firebaseGoogleRewriteRequestCount:
    stableOriginRewriteFirebaseGoogleRequestCount,
  scopeMismatchRequestCount: stableOriginRewriteScopeMismatchRequestCount,
  directImmutableOriginBrowserRequestCount,
  immutableResourceAttestationRequestCount,
  immutableResourceAttestationCacheHitCount,
  immutableResourceAttestationHttp200Count,
  immutableResourceAttestationRedirectResponseCount,
  immutableResourceAttestationBypassHeaderRequestCount,
  immutableResourceAttestationSkipToolbarHeaderRequestCount,
  immutableResourceAttestationLinkHeaderObservationCount,
  immutableResourceAttestationParserMarkupRejectCount,
  immutableResourceAttestationVercelToolbarMarkupObservationCount,
  localFulfillCount: stableOriginRewriteLocalFulfillCount,
  browserNetworkRequestCount: stableOriginRewriteBrowserNetworkRequestCount,
  browserSkipToolbarHeaderObservationCount,
  browserSkipToolbarHeaderPreTransmissionBlockCount,
  responseLinkHeaderForwardCount:
    stableOriginRewriteResponseLinkHeaderForwardCount,
  playwrightRouteRegistrationCount,
  groups: stableOriginRewriteGroups.sort((left, right) =>
    left.id.localeCompare(right.id),
  ),
};
const browserTransportBindingHash = sha256(
  Buffer.from(canonicalJson(browserTransportBinding)),
);
const preManifestEvidenceFiles = listEvidenceFiles(outputRoot);
const preManifestEvidenceText = preManifestEvidenceFiles
  .filter((fileName) => /\.jsonl?$/iu.test(fileName))
  .map((fileName) => readFileSync(resolve(outputRoot, fileName), "utf8"))
  .join("\n");
const rawDebugTokenOutputCount = literalOccurrenceCount(
  preManifestEvidenceText,
  appCheckDebugToken,
);
const rawExchangedTokenOutputCount = (
  preManifestEvidenceText.match(
    /[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/gu,
  ) || []
).length;
const rawResponseBodyOutputCount = (
  preManifestEvidenceText.match(/"responseBody"\s*:/giu) || []
).length;
const rawHeaderValueOutputCount = (
  preManifestEvidenceText.match(
    /"(?:appCheckHeaderValue|x-firebase-appcheck|x-vercel-protection-bypass)"\s*:/giu,
  ) || []
).length;
const rawVercelBypassOutputCount = literalOccurrenceCount(
  preManifestEvidenceText,
  bypassSecret,
);
const rawTokenOutputCount =
  rawDebugTokenOutputCount + rawExchangedTokenOutputCount;
const traceWriteCount = preManifestEvidenceFiles.filter((fileName) =>
  /(?:\.trace|\.zip)$/iu.test(fileName),
).length;
const harWriteCount = preManifestEvidenceFiles.filter((fileName) =>
  /\.har$/iu.test(fileName),
).length;
const storageStateWriteCount = preManifestEvidenceFiles.filter((fileName) =>
  /storage[-_.]?state/iu.test(fileName),
).length;
assert.equal(traceWriteCount, 0);
assert.equal(harWriteCount, 0);
assert.equal(storageStateWriteCount, 0);
assert.equal(rawDebugTokenOutputCount, 0);
assert.equal(rawExchangedTokenOutputCount, 0);
assert.equal(rawResponseBodyOutputCount, 0);
assert.equal(rawHeaderValueOutputCount, 0);
assert.equal(rawVercelBypassOutputCount, 0);
assert.equal(rawTokenOutputCount, 0);
const browserWideBoundaryAttestation = {
  schemaVersion: 5,
  executionTargetBoundaryHash: sha256(
    canonicalJson(contract.networkBoundary.executionTargetBoundary),
  ),
  ...browserWideBoundaryFinalSnapshot,
  groupAttestationCount: browserWideBoundaryGroupAttestations.length,
  groupAttestationSetHash: sha256(
    canonicalJson(browserWideBoundaryGroupAttestations),
  ),
  secondaryExecutionGuardInitScriptRegistrationCount,
  playwrightWebSocketRouteRegistrationCount,
  playwrightWebSocketRouteInterceptCount,
  webSocketConnectToServerCount,
  webSocketHandshakeRequestCount,
  webTransportCreatedCount,
  launchArguments: browserLaunchArguments,
  launchArgumentsHash: sha256(canonicalJson(browserLaunchArguments)),
  ignoredDefaultArguments: BROWSER_PRETRANSMISSION_IGNORE_DEFAULT_ARGS,
  ignoredDefaultArgumentsHash: sha256(
    canonicalJson(BROWSER_PRETRANSMISSION_IGNORE_DEFAULT_ARGS),
  ),
  effectiveDisabledFeatures: BROWSER_EFFECTIVE_DISABLED_FEATURES,
  effectiveDisabledFeaturesHash: sha256(
    canonicalJson(BROWSER_EFFECTIVE_DISABLED_FEATURES),
  ),
  browserCommandLineAttestation,
  browserCommandLineAttestationHash: sha256(
    canonicalJson(browserCommandLineAttestation),
  ),
  browserConnectProxyContractHash: sha256(
    canonicalJson(contract.networkBoundary.browserConnectProxy),
  ),
  browserConnectProxy: browserConnectProxyFinalSnapshot,
  browserConnectProxyHash: sha256(
    canonicalJson(browserConnectProxyFinalSnapshot),
  ),
  browserObservedDirectFirebaseHostnames,
  browserObservedDirectFirebaseHostnameSetHash: sha256(
    canonicalJson(browserObservedDirectFirebaseHostnames),
  ),
  browserConnectProxyAllowedConnectHostnames,
  browserConnectProxyAllowedConnectHostnameSetHash: sha256(
    canonicalJson(browserConnectProxyAllowedConnectHostnames),
  ),
  stableImmutableDeterministicExternalProxyConnectCount: 0,
  browserConnectProxyCleanupResidualCount:
    browserConnectProxyFinalSnapshot.activeClientSocketCount +
    browserConnectProxyFinalSnapshot.activeUpstreamSocketCount +
    browserConnectProxyFinalSnapshot.activeAllowedTunnelResidualCount +
    browserConnectProxyFinalSnapshot.requestStageAuthorizationResidualCount +
    browserConnectProxyFinalSnapshot.authorityLeaseResidualCount +
    browserConnectProxyFinalSnapshot.authorityLeaseQueueResidualCount,
};
const networkPolicyBinding = {
  schemaVersion: 4,
  externalStaticAllowlistHash: sha256(
    canonicalJson(contract.networkBoundary.externalStaticRequestAllowlist),
  ),
  optionalTelemetrySuppressionContractHash: sha256(
    canonicalJson(contract.networkBoundary.optionalTelemetrySuppression),
  ),
  sensitiveValueScopeContractHash: sha256(
    canonicalJson(contract.networkBoundary.sensitiveValueScope),
  ),
  deterministicResponseContractHash: sha256(
    canonicalJson({
      holiday: contract.browserTransport.deterministicLocalResponse,
      recaptcha: contract.browserTransport.deterministicRecaptchaResponse,
    }),
  ),
  optionalTelemetrySuppressedRequestCount,
  deterministicHolidayResponseFulfillCount,
  deterministicRecaptchaResponseFulfillCount,
  deterministicFirebaseModuleFulfillCount,
  deterministicResponseScopeMismatchBlockCount,
  externalStaticRequestNetworkFetchCount,
  externalStaticRequestCacheFulfillCount,
  externalStaticRequestScopeMismatchBlockCount,
  externalStaticResponseNon200AbortCount,
  nodeOwnedExternalRequestContract: NODE_OWNED_EXTERNAL_STATIC_REQUEST_CONTRACT,
  nodeOwnedExternalRequestContractHash: sha256(
    canonicalJson(NODE_OWNED_EXTERNAL_STATIC_REQUEST_CONTRACT),
  ),
  nodeOwnedExternalResponseHeaderAllowlist: [
    ...NODE_OWNED_EXTERNAL_STATIC_RESPONSE_HEADER_ALLOWLIST,
  ],
  nodeOwnedExternalResponseHeaderAllowlistHash: sha256(
    canonicalJson([...NODE_OWNED_EXTERNAL_STATIC_RESPONSE_HEADER_ALLOWLIST]),
  ),
  nodeOwnedExternalRequestCount,
  nodeOwnedExternalInformationalResponseCount,
  nodeOwnedExternalInformationalEgressHeaderObservationCount,
  nodeOwnedExternalInformationalBrowserExposureCount,
  nodeOwnedExternalFinalResponseCount,
  nodeOwnedExternalFinalBodyHashAttestationCount,
  nodeOwnedExternalFinalHeaderSuppressionCount,
  stagingApiKeyScopeViolationBlockCount,
  testCredentialScopeViolationBlockCount,
  refreshTokenScopeViolationBlockCount,
  rawSensitivePreTransmissionInspectionCount,
  rawSensitivePreTransmissionBlockCount,
  rawProductionPreTransmissionBlockCount,
  rawVercelBypassPreTransmissionBlockCount,
  rawStagingApiKeyPreTransmissionBlockCount,
  rawTestCredentialPreTransmissionBlockCount,
  rawRefreshTokenPreTransmissionBlockCount,
  rawDebugTokenPreTransmissionBlockCount,
  rawDebugSentinelPreTransmissionBlockCount,
  allowedEgressResponsePauseCount,
  allowedEgressInformationalResponsePauseCount,
  allowedEgressInformationalFinalResponseCount,
  allowedEgressInformationalTrackingResidualCount,
  allowedEgressInvalidResponseStatusAbortCount,
  allowedEgressRedirectAbortCount,
  allowedEgressHttpErrorAbortCount,
  allowedEgressResponseErrorAbortCount,
  allowedEgressInformationalEgressHeaderObservationCount,
  allowedEgressFinalEgressHeaderObservationCount,
  allowedEgressResponseHeaderSuppressionCount,
  allowedEgressEgressHeaderForwardCount,
  allowedEgressTrackingResidualCount,
  externalStaticTrackingResidualCount,
  directBrowserEarlyHintsObservationCount,
  directBrowserEarlyHintsEgressHeaderObservationCount,
  directBrowserEarlyHintsCaptureInvalidationCount,
  directBrowserEarlyHintsObservationSetHash: sha256(
    canonicalJson(directBrowserEarlyHintsObservations),
  ),
  fullPostDataResolutionCount,
  fullPostDataNetworkFallbackCount,
  fullPostDataResolutionFailureCount,
  fullPostDataOversizeBlockCount,
  fullPostDataRepresentationMismatchBlockCount,
  deterministicResponseObservationCount:
    deterministicResponseObservations.length,
  deterministicResponseObservationSetHash: sha256(
    canonicalJson(deterministicResponseObservations),
  ),
  externalStaticResponseObservationCount:
    externalStaticResponseObservations.length,
  externalStaticResponseObservationSetHash: sha256(
    canonicalJson(externalStaticResponseObservations),
  ),
  optionalTelemetryObservationCount:
    optionalTelemetrySuppressionObservations.length,
  optionalTelemetryObservationSetHash: sha256(
    canonicalJson(optionalTelemetrySuppressionObservations),
  ),
  pinnedStartupSourceAttestations: externalStaticStartupSourceAttestations,
  pinnedStartupSourceAttestationCount:
    externalStaticStartupSourceAttestations.length,
  pinnedStartupSourceAttestationSetHash: sha256(
    canonicalJson(externalStaticStartupSourceAttestations),
  ),
};
const networkPolicyBindingHash = sha256(canonicalJson(networkPolicyBinding));
const appCheckBinding = {
  ...captureAppCheckTokenManager.binding,
  fixturePreBackupAttestationHash: preBackupNamespaceAccessAttestationHash,
  fixturePostBackupAttestationHash: backupNamespaceAccessAttestationHash,
  baselineBridgeScope: BASELINE_APP_CHECK_BRIDGE_SCOPE,
  baselineBridgeScopeHash: baselineAppCheckBridgeScopeHash,
  browserCdpSecurityScope: BROWSER_APP_CHECK_CDP_SECURITY_SCOPE,
  browserCdpSecurityScopeHash: browserAppCheckCdpSecurityScopeHash,
  browserWideBoundaryAttestation,
  browserConnectProxyHash: sha256(
    canonicalJson(browserConnectProxyFinalSnapshot),
  ),
  browserConnectProxyAllowedConnectCount:
    browserConnectProxyFinalSnapshot.allowedConnectCount,
  browserConnectProxyDeniedConnectCount:
    browserConnectProxyFinalSnapshot.deniedConnectCount,
  browserConnectProxyCleanupResidualCount:
    browserConnectProxyFinalSnapshot.activeClientSocketCount +
    browserConnectProxyFinalSnapshot.activeUpstreamSocketCount +
    browserConnectProxyFinalSnapshot.activeAllowedTunnelResidualCount +
    browserConnectProxyFinalSnapshot.requestStageAuthorizationResidualCount +
    browserConnectProxyFinalSnapshot.authorityLeaseResidualCount +
    browserConnectProxyFinalSnapshot.authorityLeaseQueueResidualCount,
  preTransmissionBoundaryAttestationHash:
    preTransmissionNetworkBoundaryAttestationHash,
  nonFirebaseNetworkAllowedHostnameSetHash,
  nonFirebaseNetworkAllowedHostnameCount:
    nonFirebaseNetworkAllowedHostnames.length,
  preTransmissionBoundaryInspectionCount,
  preTransmissionBoundaryBlockAttemptCount,
  preTransmissionBoundaryProductionBlockCount,
  preTransmissionBoundaryCrossOriginDocumentBlockCount,
  preTransmissionBoundaryUnboundFirebaseBlockCount,
  preTransmissionBoundaryNonFirebaseHostnameBlockCount,
  preTransmissionBoundaryMalformedUrlBlockCount,
  preTransmissionBoundaryFailRequestCount,
  networkPolicyBindingHash,
  optionalTelemetrySuppressedRequestCount,
  deterministicHolidayResponseFulfillCount,
  deterministicRecaptchaResponseFulfillCount,
  deterministicFirebaseModuleFulfillCount,
  deterministicResponseScopeMismatchBlockCount,
  externalStaticRequestNetworkFetchCount,
  externalStaticRequestCacheFulfillCount,
  externalStaticRequestScopeMismatchBlockCount,
  externalStaticResponseNon200AbortCount,
  nodeOwnedExternalInformationalResponseCount,
  nodeOwnedExternalInformationalBrowserExposureCount,
  stagingApiKeyScopeViolationBlockCount,
  testCredentialScopeViolationBlockCount,
  refreshTokenScopeViolationBlockCount,
  rawSensitivePreTransmissionInspectionCount,
  rawSensitivePreTransmissionBlockCount,
  rawProductionPreTransmissionBlockCount,
  rawVercelBypassPreTransmissionBlockCount,
  rawStagingApiKeyPreTransmissionBlockCount,
  rawTestCredentialPreTransmissionBlockCount,
  rawRefreshTokenPreTransmissionBlockCount,
  rawDebugTokenPreTransmissionBlockCount,
  rawDebugSentinelPreTransmissionBlockCount,
  allowedEgressResponsePauseCount,
  allowedEgressInformationalResponsePauseCount,
  allowedEgressInformationalFinalResponseCount,
  allowedEgressInformationalTrackingResidualCount,
  allowedEgressInvalidResponseStatusAbortCount,
  allowedEgressRedirectAbortCount,
  allowedEgressHttpErrorAbortCount,
  allowedEgressResponseErrorAbortCount,
  allowedEgressInformationalEgressHeaderObservationCount,
  allowedEgressFinalEgressHeaderObservationCount,
  allowedEgressResponseHeaderSuppressionCount,
  allowedEgressEgressHeaderForwardCount,
  allowedEgressTrackingResidualCount,
  externalStaticTrackingResidualCount,
  directBrowserEarlyHintsObservationCount,
  directBrowserEarlyHintsEgressHeaderObservationCount,
  directBrowserEarlyHintsCaptureInvalidationCount,
  fullPostDataResolutionCount,
  fullPostDataNetworkFallbackCount,
  fullPostDataResolutionFailureCount,
  fullPostDataOversizeBlockCount,
  fullPostDataRepresentationMismatchBlockCount,
  debugSentinelHash: sha256(APP_CHECK_DEBUG_SENTINEL),
  browserGlobalValueKind: "non-secret-fixed-sentinel",
  secretInitScope: "primary-page-only",
  pageRawDebugTokenInjectionCount,
  pageAppCheckSecretInitRegistrationCount,
  browserGlobalRawDebugTokenWriteCount,
  browserGlobalDebugSentinelWriteCount,
  contextAppCheckSecretInitCount: contextAppCheckSecretInitRegistrationCount,
  protocolDebugLoggingDisabled: true,
  browserLaunchExplicitEnvironment: true,
  childProcessSecretEnvScrubbed: true,
  browserChildEnvironmentAllowlisted: true,
  browserChildEnvironmentAllowlistHash: sha256(
    canonicalJson(BROWSER_CHILD_ENVIRONMENT_ALLOWLIST),
  ),
  browserChildEnvironmentUnexpectedKeyCount,
  scrubbedSecretEnvironmentVariableCount:
    BROWSER_SECRET_ENVIRONMENT_VARIABLE_NAMES.length,
  browserChildSecretEnvironmentVariableCount,
  browserChildSecretValueObservationCount,
  browserGlobalExtraHttpHeaderRegistrationCount,
  vercelBypassConfigured: Boolean(bypassSecret),
  vercelBypassAllowedOriginSetHash: sha256(
    canonicalJson(vercelBypassAllowedOrigins),
  ),
  vercelBypassTransportContractHash: sha256(
    canonicalJson(VERCEL_BYPASS_TRANSPORT_CONTRACT),
  ),
  vercelBypassCdpInjectedRequestCount,
  vercelBypassPreexistingHeaderObservationCount,
  unauthorizedVercelBypassEgressCount,
  vercelBypassCdpResponsePausedRequestCount,
  vercelBypassHttpSuccessResponseCount,
  vercelBypassHttpErrorResponseCount,
  vercelBypassRedirectRequestCount,
  vercelBypassRedirectAbortRequestCount,
  vercelBypassRedirectResponseAbortRequestCount,
  vercelBypassResponseErrorAbortRequestCount,
  vercelBypassObservedEligibleRequestCount,
  vercelBypassHeaderObservedRequestCount,
  vercelBypassHeaderMissingRequestCount,
  vercelBypassHeaderMismatchRequestCount,
  rawVercelBypassOutputCount,
  rawDebugTokenOutputCount,
  rawExchangedTokenOutputCount,
  rawResponseBodyOutputCount,
  argvSecretCount,
  nodeDeploymentFetchRequestCount,
  nodeDeploymentFetchHttp200Count,
  nodeDeploymentRedirectResponseCount,
  nodeVercelBypassHeaderRequestCount,
  nodeDeploymentSkipToolbarHeaderRequestCount,
  nodeDeploymentVercelToolbarMarkupObservationCount,
  allowedEgressPostFinalResponseErrorPauseCount,
  allowedEgressPostFinalContinueResponseSuccessCount,
  allowedEgressPostFinalAlreadyRetiredInterceptionCount,
  traceWriteCount,
  harWriteCount,
  storageStateWriteCount,
  playwrightRouteRegistrationCount,
  headerCorrelationMechanism: "playwright-request-allHeaders",
  urlMethodFifoCorrelationUsed: false,
  pendingBridgeDecisionResidualCount,
  pendingBridgeObservationResidualCount,
  baselineProtectedDataRequestCount: baselineProtectedDataRequests.length,
  baselineBridgeEligibleRequestCount,
  baselineBridgeInjectedRequestCount,
  baselineBridgeNativeHeaderRequestCount,
  baselineBridgeScopeMismatchRequestCount,
  baselineBridgeStrippedHeaderRequestCount,
  baselineBridgeRedirectRequestCount,
  baselineBridgeRedirectHeaderAbsentRequestCount,
  baselineBridgeRedirectAbortRequestCount,
  baselineBridgeCdpPausedRequestCount,
  baselineBridgeCdpResponsePausedRequestCount,
  baselineBridgeCdpReconciledRequestCount,
  appCheckCdpHandlerErrorCount,
  baselineBridgeInjectedRedirectResponseAbortCount,
  baselineBridgeDecisionUnmatchedProtectedRequestCount,
  baselineBridgeScopeIneligibleProtectedRequestCount,
  baselineEffectiveHeaderMissingRequestCount,
  baselineScreenCaptureProtectedRequestCount:
    baselineScreenCaptureProtectedDataRequests.length,
  baselineScreenCaptureBridgeRequestCount,
  candidateProtectedDataRequestCount: candidateProtectedDataRequests.length,
  candidateNativeHeaderPresentRequestCount:
    candidateProtectedDataRequests.length -
    candidateNativeAppCheckHeaderMissingRequestCount,
  candidateNativeHeaderMissingRequestCount:
    candidateNativeAppCheckHeaderMissingRequestCount,
  candidateScreenCaptureProtectedRequestCount:
    candidateScreenCaptureProtectedDataRequests.length,
  candidateScreenCaptureNativeRequestCount,
  candidateBridgeInjectedRequestCount,
  protectedHeaderJwtShapeInvalidRequestCount,
  browserAppCheckExchangeRequestCount:
    networkSummary.appCheckExchangeRequestCount,
  browserAppCheckExchangeHttp200Count:
    networkSummary.successfulAppCheckExchangeResponseCount,
  appCheckCdpMonitorPausedRequestCount,
  debugTokenNetworkObservationCount,
  debugSentinelNetworkObservationCount,
  authorizedDebugExchangeBodyReplacementCount,
  unauthorizedDebugTokenEgressCount,
  unauthorizedDebugSentinelEgressCount,
  appCheckHeaderNetworkObservationCount,
  authorizedAppCheckHeaderRequestCount,
  unauthorizedAppCheckHeaderEgressCount,
  sensitiveAppCheckRedirectRequestCount,
  sensitiveAppCheckRedirectAbortRequestCount,
  sensitiveAppCheckCdpResponsePausedRequestCount,
  sensitiveAppCheckRedirectResponseAbortRequestCount,
  sensitiveAppCheckResponseErrorAbortRequestCount,
  sensitiveAppCheckRequestTrackingResidualCount,
  browserNetworkHeaderAttestationErrorCount,
  firebaseDataRedirectResponseCount,
  firebaseDataErrorResponseCount,
  successfulFirebaseDataResponseCount,
  serviceWorkerPolicy: "block",
  initScriptInjectionCount: appCheckInitScriptInjectionCount,
  contextCloseCount: browserContextCloseCount,
  unexpectedExtraPageCount,
  unexpectedDedicatedWorkerCount,
  unexpectedServiceWorkerCount,
  unexpectedCrossOriginFrameCount,
  unexpectedOopifTargetCount,
  unexpectedDedicatedWorkerTargetCount,
  unexpectedSharedWorkerTargetCount,
  unexpectedServiceWorkerTargetCount,
  retainedOopifTargetCount,
  retainedDedicatedWorkerTargetCount,
  retainedSharedWorkerTargetCount,
  retainedServiceWorkerTargetCount,
  targetDiscoveryActivationCount,
  targetSnapshotCount,
  consoleMessageCount: browserConsoleMessageCount,
  consoleSecretObservationCount: browserConsoleSecretObservationCount,
  corsConsoleErrorCount: browserCorsConsoleErrorCount,
  domSecretObservationCount: browserDomSecretObservationCount,
  requestFailureCount: browserRequestFailureCount,
  rawHeaderValueOutputCount,
  rawTokenOutputCount,
};
const appCheckBindingHash = sha256(Buffer.from(canonicalJson(appCheckBinding)));
assert.ok(
  preTransmissionBoundaryInspectionCount > 0,
  "The request-stage network boundary did not inspect any browser requests.",
);
assert.equal(
  appCheckCdpMonitorPausedRequestCount,
  preTransmissionBoundaryInspectionCount,
  "Every CDP request-stage pause must pass the pre-transmission boundary.",
);
assert.equal(
  rawSensitivePreTransmissionInspectionCount,
  appCheckCdpMonitorPausedRequestCount,
  "Every CDP request-stage pause must pass the unified raw-sensitive scan.",
);
assert.equal(
  fullPostDataResolutionCount,
  appCheckCdpMonitorPausedRequestCount,
  "Every CDP request-stage pause must use the single resolved POST body.",
);
assert.equal(
  rawSensitivePreTransmissionBlockCount,
  rawProductionPreTransmissionBlockCount +
    rawVercelBypassPreTransmissionBlockCount +
    rawStagingApiKeyPreTransmissionBlockCount +
    rawTestCredentialPreTransmissionBlockCount +
    rawRefreshTokenPreTransmissionBlockCount +
    rawDebugTokenPreTransmissionBlockCount +
    rawDebugSentinelPreTransmissionBlockCount,
);
assert.equal(
  preTransmissionBoundaryBlockAttemptCount,
  preTransmissionBoundaryProductionBlockCount +
    preTransmissionBoundaryCrossOriginDocumentBlockCount +
    preTransmissionBoundaryUnboundFirebaseBlockCount +
    preTransmissionBoundaryNonFirebaseHostnameBlockCount +
    preTransmissionBoundaryMalformedUrlBlockCount,
);
assert.equal(
  preTransmissionBoundaryFailRequestCount,
  preTransmissionBoundaryBlockAttemptCount,
);
assert.equal(
  safeDiagnosticClassTotal(preTransmissionBoundaryBlockClassCounts),
  preTransmissionBoundaryBlockAttemptCount,
);
for (const [label, count] of Object.entries({
  preTransmissionBoundaryBlockAttemptCount,
  preTransmissionBoundaryProductionBlockCount,
  preTransmissionBoundaryCrossOriginDocumentBlockCount,
  preTransmissionBoundaryUnboundFirebaseBlockCount,
  preTransmissionBoundaryNonFirebaseHostnameBlockCount,
  preTransmissionBoundaryMalformedUrlBlockCount,
  preTransmissionBoundaryFailRequestCount,
})) {
  assert.equal(
    count,
    0,
    `${label} must be zero in a passing visual capture: ${JSON.stringify(
      snapshotSafeDiagnosticClasses(preTransmissionBoundaryBlockClassCounts),
    )}`,
  );
}
assert.equal(
  deterministicResponseObservations.length,
  deterministicHolidayResponseFulfillCount +
    deterministicRecaptchaResponseFulfillCount +
    deterministicFirebaseModuleFulfillCount,
);
assert.equal(
  optionalTelemetrySuppressionObservations.length,
  optionalTelemetrySuppressedRequestCount,
);
assert.equal(
  externalStaticStartupSourceAttestations.length,
  contract.networkBoundary.externalStaticRequestAllowlist.rules.reduce(
    (total, rule) => total + Object.keys(rule.pinnedSources || {}).length,
    0,
  ),
);
assert.equal(
  externalStaticResponseObservations.length,
  externalStaticRequestNetworkFetchCount +
    externalStaticRequestCacheFulfillCount,
);
assert.equal(allowedEgressTrackingResidualCount, 0);
assert.equal(externalStaticTrackingResidualCount, 0);
assert.equal(allowedEgressInformationalTrackingResidualCount, 0);
assert.equal(allowedEgressInvalidResponseStatusAbortCount, 0);
assert.equal(allowedEgressEgressHeaderForwardCount, 0);
assert.equal(
  allowedEgressPostFinalResponseErrorPauseCount,
  allowedEgressPostFinalContinueResponseSuccessCount +
    allowedEgressPostFinalAlreadyRetiredInterceptionCount,
);
assert.equal(nodeOwnedExternalInformationalBrowserExposureCount, 0);
assert.equal(directBrowserEarlyHintsObservationCount, 0);
assert.equal(directBrowserEarlyHintsEgressHeaderObservationCount, 0);
assert.equal(directBrowserEarlyHintsCaptureInvalidationCount, 0);
assert.deepEqual(directBrowserEarlyHintsObservations, []);
assert.equal(
  nodeOwnedExternalRequestCount,
  externalStaticStartupSourceAttestations.length +
    externalStaticRequestNetworkFetchCount,
);
assert.equal(
  nodeOwnedExternalFinalResponseCount,
  nodeOwnedExternalRequestCount,
);
assert.equal(
  nodeOwnedExternalFinalBodyHashAttestationCount,
  nodeOwnedExternalFinalResponseCount,
);
assert.ok(
  allowedEgressInformationalFinalResponseCount <=
    allowedEgressInformationalResponsePauseCount,
);
for (const [label, count] of Object.entries({
  deterministicResponseScopeMismatchBlockCount,
  externalStaticRequestScopeMismatchBlockCount,
  externalStaticResponseNon200AbortCount,
  stagingApiKeyScopeViolationBlockCount,
  testCredentialScopeViolationBlockCount,
  refreshTokenScopeViolationBlockCount,
  allowedEgressRedirectAbortCount,
  allowedEgressHttpErrorAbortCount,
  allowedEgressResponseErrorAbortCount,
  rawSensitivePreTransmissionBlockCount,
  rawProductionPreTransmissionBlockCount,
  rawVercelBypassPreTransmissionBlockCount,
  rawStagingApiKeyPreTransmissionBlockCount,
  rawTestCredentialPreTransmissionBlockCount,
  rawRefreshTokenPreTransmissionBlockCount,
  rawDebugTokenPreTransmissionBlockCount,
  rawDebugSentinelPreTransmissionBlockCount,
  fullPostDataResolutionFailureCount,
  fullPostDataOversizeBlockCount,
  fullPostDataRepresentationMismatchBlockCount,
})) {
  assert.equal(count, 0, `${label} must be zero in a passing visual capture.`);
}
assert.ok(deterministicHolidayResponseFulfillCount > 0);
assert.ok(deterministicRecaptchaResponseFulfillCount > 0);
assert.ok(deterministicFirebaseModuleFulfillCount > 0);
assert.ok(externalStaticRequestNetworkFetchCount > 0);
assert.ok(externalStaticRequestCacheFulfillCount > 0);
assert.equal(
  networkSummary.productionAccess,
  0,
  `Production network access detected: ${networkSummary.productionRequestHosts.join(", ")}`,
);
assert.equal(networkSummary.productionWrites, 0);
for (const field of [
  "nonFirebaseUnallowlistedRequestCount",
  "nonFirebaseUnallowlistedResponseCount",
  "productionVercelRequestCount",
  "productionVercelResponseCount",
  "unknownVercelRequestCount",
  "unknownVercelResponseCount",
]) {
  assert.equal(
    networkSummary[field],
    0,
    `Unallowlisted non-Firebase network activity detected: ${field}.`,
  );
}
assert.equal(
  networkSummary.nonFirebaseRequestCount,
  networkSummary.nonFirebaseAllowedRequestCount,
);
assert.deepEqual(networkSummary.nonFirebaseUnallowlistedRequestHosts, []);
assert.deepEqual(networkSummary.productionVercelRequestHosts, []);
assert.deepEqual(networkSummary.unknownVercelRequestHosts, []);
assert.equal(
  networkSummary.unboundFirebaseRequestCount,
  0,
  "A Firebase request was not bound to the staging project or API key.",
);
assert.deepEqual(
  networkSummary.observedFirebaseApiKeySha256s,
  [sha256(firebaseConfig.apiKey)],
  "The browser used an unexpected Firebase API key.",
);
assert.ok(
  networkSummary.stagingFirebaseRequestCount > 0,
  "The browser did not make a measured request to the staging Firebase project.",
);
assert.ok(
  (networkSummary.stagingFirebaseRequestsByPhase.authentication || 0) > 0,
  "The explicit staging authentication flow was not observed.",
);
for (const stage of ["baseline", "candidate"]) {
  assert.ok(
    (networkSummary.stagingScreenRequestsByStage[stage] || 0) > 0,
    `${stage} application routes did not contact staging Firebase.`,
  );
}
assert.deepEqual(
  networkSummary.observedFirebaseProjectIds,
  contract.networkBoundary.requiredMeasuredFirebaseProjectIds,
  "The browser observed an unexpected Firebase project.",
);
assert.equal(
  networkSummary.failedFirebaseResponseCount,
  0,
  "One or more staging Firebase requests failed during visual capture.",
);
const manifest = {
  schemaVersion: contract.schemaVersion,
  phase: contract.phase,
  testRunId: outputRoot.split(/[\\/]/u).at(-1),
  branch: contract.branch,
  sourceCommitSha,
  sourceTreeSha: git("rev-parse", `${sourceCommitSha}^{tree}`),
  functionalBaselineSha: contract.functionalBaselineSha,
  productionPresentationSha: contract.productionPresentationSha,
  firebaseProjectId: contract.firebaseProjectId,
  vercelProjectId: contract.vercelProjectId,
  stableAlias: contract.stableAlias,
  productionAccess: networkSummary.productionAccess,
  productionWrites: networkSummary.productionWrites,
  networkSummary,
  browserTransport: browserTransportBinding,
  browserTransportHash: browserTransportBindingHash,
  networkPolicy: networkPolicyBinding,
  networkPolicyHash: networkPolicyBindingHash,
  appCheckBinding,
  appCheckBindingHash,
  status: "CAPTURED",
  startedAt,
  completedAt,
  fixtureAudit: {
    fileName: fixtureAuditFileName,
    sha256: fixtureAuditSha256,
    artifactSchemaVersion: fixtureAudit.artifactSchemaVersion,
    fixtureRevision: contract.fixtureRevision,
    planHash: contract.fixturePlanHash,
    captureBindingHash: fixtureAudit.captureBindingHash,
    issuedAt: fixtureAudit.freshness.issuedAt,
    expiresAt: fixtureAudit.freshness.expiresAt,
  },
  generator: {
    scriptPath: runnerScriptPath,
    scriptGitBlobSha: runnerCommittedBlobSha,
    scriptRuntimeSha256: runnerRuntimeSha256,
    entrypointVerified: true,
    trustedInputsSha256,
    playwrightCoreVersion: JSON.parse(
      readFileSync(
        resolve("node_modules/playwright-core/package.json"),
        "utf8",
      ),
    ).version,
    browserExecutable: edgeExecutable,
  },
  trustedInputs,
  environment: {
    viewports: contract.viewports,
    dpr: contract.requiredDpr,
    fontsReady: true,
    animationsDisabled: true,
    browser: "Microsoft Edge via Playwright",
    browserVersion,
    operatingSystem: `${platform()} ${release()}`,
    locale: "ko-KR",
    timezone: "Asia/Seoul",
    fixtureId,
    fixtureRevision: contract.fixtureRevision,
    fixturePlanHash: contract.fixturePlanHash,
    fixtureCaptureBindingHash: fixtureAudit.captureBindingHash,
    captureSessionId,
    fixedTime,
    firebaseConfig: {
      projectId: firebaseConfig.projectId,
      authDomain: firebaseConfig.authDomain,
      storageBucket: firebaseConfig.storageBucket,
      messagingSenderId: firebaseConfig.messagingSenderId,
      apiKeySha256: sha256(firebaseConfig.apiKey),
      appIdSha256: sha256(firebaseConfig.appId),
    },
  },
  identityAttestations: Object.fromEntries(
    [...identityAttestations.entries()].sort(([left], [right]) =>
      left.localeCompare(right),
    ),
  ),
  baselineDeployment: {
    id: baselineDeploymentId,
    url: baselineDeploymentUrl,
    projectId: contract.vercelProjectId,
    status: "READY",
    sourceCommitSha: contract.productionPresentationSha,
    htmlSha256: sha256(baselineHtml),
    firebaseBundle: baselineFirebaseBundle,
    inspectedAt: startedAt,
  },
  candidateDeployment: {
    id: candidateDeploymentId,
    url: candidateDeploymentUrl,
    projectId: contract.vercelProjectId,
    status: "READY",
    sourceCommitSha,
    htmlSha256: sha256(candidateHtml),
    firebaseBundle: candidateFirebaseBundle,
    inspectedAt: startedAt,
  },
  captures: captures.sort((left, right) => left.id.localeCompare(right.id)),
  browserAudits: browserAudits.sort((left, right) =>
    left.id.localeCompare(right.id),
  ),
  comparisons: comparisonRows.sort((left, right) =>
    left.id.localeCompare(right.id),
  ),
};
const manifestPath = resolve(outputRoot, "visual-parity-manifest.json");
const manifestText = `${JSON.stringify(manifest, null, 2)}\n`;
assertNoAppCheckSecretMaterial(manifestText, {
  debugToken: appCheckDebugToken,
  debugSentinel: APP_CHECK_DEBUG_SENTINEL,
});
if (bypassSecret) {
  assert.equal(
    manifestText.includes(bypassSecret),
    false,
    "The Vercel bypass secret reached the visual manifest.",
  );
}
writeFileSync(manifestPath, manifestText, "utf8");
assert.equal(statSync(manifestPath).isFile(), true);
const expectedEvidenceFiles = [
  "visual-parity-manifest.json",
  fixtureAuditFileName,
  ...captures.map((capture) => capture.fileName),
  ...browserAudits.map((audit) => audit.fileName),
].sort();
assert.deepEqual(
  listEvidenceFiles(outputRoot).sort(),
  expectedEvidenceFiles,
  "The capture output contains an unrepresented artifact.",
);
console.log(
  JSON.stringify(
    {
      suite: "w10p-visual-capture",
      captured: true,
      manifestPath: relative(process.cwd(), manifestPath).replaceAll("\\", "/"),
      captures: captures.length,
      comparisons: comparisonRows.length,
      browserAudits: browserAudits.length,
      stableBrowserOrigin: browserTransportBinding.browserOrigin,
      immutableOriginRewriteRequests: browserTransportBinding.requestCount,
      immutableOriginRewriteBodyHashes: browserTransportBinding.bodyHashCount,
      immutableOriginRewriteMismatches:
        browserTransportBinding.bodyHashMismatchCount,
      stagingFirebaseRequests: networkSummary.stagingFirebaseRequestCount,
      productionAccess: networkSummary.productionAccess,
      productionWrites: networkSummary.productionWrites,
    },
    null,
    2,
  ),
);
