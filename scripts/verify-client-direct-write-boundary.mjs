import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

const POSIX = (value) => value.replaceAll("\\", "/");
const SOURCE_PATTERN = /\.(?:ts|tsx)$/;

const DIRECT_MUTATIONS = new Map([
  [
    "firebase/firestore",
    new Set([
      "addDoc",
      "deleteDoc",
      "runTransaction",
      "setDoc",
      "updateDoc",
      "writeBatch",
    ]),
  ],
  [
    "firebase/storage",
    new Set([
      "deleteObject",
      "updateMetadata",
      "uploadBytes",
      "uploadBytesResumable",
      "uploadString",
    ]),
  ],
  [
    "firebase/auth",
    new Set([
      "createUserWithEmailAndPassword",
      "deleteUser",
      "reauthenticateWithCredential",
      "reauthenticateWithPopup",
      "setPersistence",
      "signInAnonymously",
      "signInWithCustomToken",
      "signInWithEmailAndPassword",
      "signInWithPopup",
      "signInWithRedirect",
      "signOut",
      "updateEmail",
      "updatePassword",
      "updateProfile",
    ]),
  ],
]);

const QUERY_CALLABLES = new Set([
  "getCommandStatus",
  "getSemesterCoreState",
  "getArchiveEnrollmentState",
  "previewEnrollmentRoster",
  "listStudentHistoryDictionaryWordsForTeacher",
  "getAssessmentState",
  "getGradeEvidenceState",
  "getWisEconomyState",
]);
const SESSION_CONTROL_CALLABLES = new Set([
  "beginApplicationSessionReauthentication",
  "closeApplicationSession",
  "openApplicationSession",
  "touchApplicationSession",
  "saveAssessmentProgress",
]);
const EFFECT_HOOKS = new Set(["useEffect", "useLayoutEffect"]);
const LISTENER_APIS = new Set([
  "addEventListener",
  "onAuthStateChanged",
  "onIdTokenChanged",
  "onSnapshot",
]);
const TIMER_APIS = new Set([
  "queueMicrotask",
  "requestAnimationFrame",
  "setInterval",
  "setTimeout",
]);
const WAVE_ORDER = [
  "LEGACY",
  "W0",
  "W1",
  "W2A",
  "W2B",
  "W3",
  "W4A",
  "W4B",
  "W5",
  "W6A",
  "W6B",
  "W7",
  "W7A",
  "W7B",
  "W8A",
  "W8B",
  "W9",
  "W10",
  "W12",
];
const REQUIRED_COMMANDS = new Map([
  ["D01", "createSemesterShell"],
  ["D02", "updateOperationalSettings"],
  ["D03", "updateSchoolSettings"],
  ["D04", "updateInterfaceSettings"],
  ["D05", "updateMenuSettings"],
  ["D06", "updateAccessSettings"],
  ["D07", "updateNotificationSettings"],
  ["D08", "updateTermsSettings"],
  ["D09", "updatePrivacySettings"],
  ["D10", "updateConsentSettings:add"],
  ["D11", "updateConsentSettings:save"],
  ["D12", "updateConsentSettings:delete"],
  ["C01", "deleteStudentData"],
  ["C02", "resetLessonCorePointProgress"],
  ["C03", "updateStudentData"],
  ["C04", "resetAssessmentAttemptsByClass"],
  ["C05", "resetQuizAttemptsForClass"],
  ["C06", "recalculateQuizResultsAfterQuestionCorrection"],
  ["C07", "grantHistoryClassroomExemptions"],
  ["C08", "revokeHistoryClassroomExemptions"],
  ["C09", "reviewHistoryClassroomExemptionRequest"],
  ["C10", "reviewPerformanceScoreObjection"],
  ["C11", "saveWisHallOfFameConfig"],
  ["C12", "rebuildPointWalletRankTotals"],
  ["C13", "adjustTeacherPoints"],
  ["C14", "updateTeacherPointAdjustment"],
  ["C15", "reviewTeacherPointOrder"],
  ["C16", "deleteSourceArchiveAsset"],
]);

const walkFiles = (directory) => {
  const found = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      found.push(...walkFiles(path));
    } else if (SOURCE_PATTERN.test(entry.name) && !entry.name.endsWith(".d.ts")) {
      found.push(path);
    }
  }
  return found;
};

const callName = (expression, sourceFile) => {
  if (ts.isIdentifier(expression)) return expression.text;
  if (ts.isPropertyAccessExpression(expression)) return expression.name.text;
  return expression.getText(sourceFile).slice(0, 100);
};

const isFunctionNode = (node) =>
  (ts.isArrowFunction(node) ||
    ts.isFunctionDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ts.isMethodDeclaration(node)) &&
  Boolean(node.body);

const functionDisplayName = (node, sourceFile) => {
  if (node.name) return node.name.getText(sourceFile);
  if (ts.isVariableDeclaration(node.parent) && ts.isIdentifier(node.parent.name)) {
    return node.parent.name.text;
  }
  if (
    ts.isCallExpression(node.parent) &&
    ts.isVariableDeclaration(node.parent.parent) &&
    ts.isIdentifier(node.parent.parent.name)
  ) {
    return node.parent.parent.name.text;
  }
  if (ts.isJsxExpression(node.parent) && ts.isJsxAttribute(node.parent.parent)) {
    return `<${node.parent.parent.name.getText(sourceFile)} callback>`;
  }
  if (ts.isCallExpression(node.parent)) {
    return `<${callName(node.parent.expression, sourceFile)} callback>`;
  }
  return "<anonymous>";
};

const sha256 = (value) =>
  createHash("sha256").update(value).digest("hex").slice(0, 24);

const findContainingFunction = (node, functionByNode) => {
  let current = node.parent;
  while (current) {
    const found = functionByNode.get(current);
    if (found) return found;
    current = current.parent;
  }
  return null;
};

const resolveAliasedSymbol = (checker, node) => {
  let symbol = checker.getSymbolAtLocation(node);
  if (!symbol) return null;
  if (symbol.flags & ts.SymbolFlags.Alias) {
    try {
      symbol = checker.getAliasedSymbol(symbol);
    } catch {
      return null;
    }
  }
  return symbol;
};

const resolveFunctionFromDeclaration = (declaration, functionByNode) => {
  if (!declaration) return null;
  if (isFunctionNode(declaration)) return functionByNode.get(declaration) || null;
  if (ts.isVariableDeclaration(declaration) && declaration.initializer) {
    if (isFunctionNode(declaration.initializer)) {
      return functionByNode.get(declaration.initializer) || null;
    }
    if (ts.isCallExpression(declaration.initializer)) {
      const callback = declaration.initializer.arguments.find(isFunctionNode);
      if (callback) return functionByNode.get(callback) || null;
    }
  }
  return null;
};

const resolveCalledFunction = (checker, expression, functionByNode) => {
  const lookup = ts.isPropertyAccessExpression(expression)
    ? expression.name
    : expression;
  const symbol = resolveAliasedSymbol(checker, lookup);
  if (!symbol) return null;
  for (const declaration of symbol.declarations || []) {
    const found = resolveFunctionFromDeclaration(declaration, functionByNode);
    if (found) return found;
  }
  return null;
};

const importedApi = (expression, imports) => {
  if (ts.isIdentifier(expression)) return imports.get(expression.text) || null;
  if (
    ts.isPropertyAccessExpression(expression) &&
    ts.isIdentifier(expression.expression)
  ) {
    const namespace = imports.get(expression.expression.text);
    if (namespace?.namespace) {
      return { module: namespace.module, imported: expression.name.text };
    }
  }
  return null;
};

const readImports = (sourceFile) => {
  const imports = new Map();
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    if (!ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const module = statement.moduleSpecifier.text;
    const bindings = statement.importClause?.namedBindings;
    if (bindings && ts.isNamedImports(bindings)) {
      for (const item of bindings.elements) {
        imports.set(item.name.text, {
          module,
          imported: (item.propertyName || item.name).text,
        });
      }
    } else if (bindings && ts.isNamespaceImport(bindings)) {
      imports.set(bindings.name.text, { module, namespace: true });
    }
  }
  return imports;
};

const expressionInitializer = (checker, identifier) => {
  const symbol = resolveAliasedSymbol(checker, identifier);
  if (!symbol) return null;
  for (const declaration of symbol.declarations || []) {
    if (ts.isVariableDeclaration(declaration) && declaration.initializer) {
      return declaration.initializer;
    }
  }
  return null;
};

const parameterContext = (checker, identifier, functionByNode) => {
  const symbol = resolveAliasedSymbol(checker, identifier);
  if (!symbol) return null;
  for (const declaration of symbol.declarations || []) {
    if (!ts.isParameter(declaration)) continue;
    const owner = functionByNode.get(declaration.parent);
    if (!owner) return null;
    return { owner, index: declaration.parent.parameters.indexOf(declaration) };
  }
  return null;
};

const resolveStringValues = (
  expression,
  checker,
  functionByNode,
  incomingCalls,
  seen = new Set(),
) => {
  if (!expression) return { values: new Set(), unknown: true };
  if (
    ts.isStringLiteral(expression) ||
    ts.isNoSubstitutionTemplateLiteral(expression)
  ) {
    return { values: new Set([expression.text]), unknown: false };
  }
  if (ts.isParenthesizedExpression(expression)) {
    return resolveStringValues(
      expression.expression,
      checker,
      functionByNode,
      incomingCalls,
      seen,
    );
  }
  if (ts.isConditionalExpression(expression)) {
    const left = resolveStringValues(
      expression.whenTrue,
      checker,
      functionByNode,
      incomingCalls,
      new Set(seen),
    );
    const right = resolveStringValues(
      expression.whenFalse,
      checker,
      functionByNode,
      incomingCalls,
      new Set(seen),
    );
    return {
      values: new Set([...left.values, ...right.values]),
      unknown: left.unknown || right.unknown,
    };
  }
  if (ts.isIdentifier(expression)) {
    const key = `${expression.getSourceFile().fileName}:${expression.pos}`;
    if (seen.has(key)) return { values: new Set(), unknown: true };
    seen.add(key);
    const initializer = expressionInitializer(checker, expression);
    if (initializer) {
      return resolveStringValues(
        initializer,
        checker,
        functionByNode,
        incomingCalls,
        seen,
      );
    }
    const parameter = parameterContext(checker, expression, functionByNode);
    if (parameter) {
      const calls = incomingCalls.get(parameter.owner.id) || [];
      if (!calls.length) return { values: new Set(), unknown: true };
      const combined = { values: new Set(), unknown: false };
      for (const call of calls) {
        const result = resolveStringValues(
          call.arguments[parameter.index],
          checker,
          functionByNode,
          incomingCalls,
          new Set(seen),
        );
        result.values.forEach((value) => combined.values.add(value));
        combined.unknown ||= result.unknown;
      }
      return combined;
    }
  }
  return { values: new Set(), unknown: true };
};

export const analyzeClientBoundary = ({ rootDir = process.cwd() } = {}) => {
  const sourceRoot = resolve(rootDir, "src");
  const files = walkFiles(sourceRoot);
  const program = ts.createProgram(files, {
    allowJs: false,
    jsx: ts.JsxEmit.ReactJSX,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    noEmit: true,
    skipLibCheck: true,
    target: ts.ScriptTarget.ESNext,
  });
  const checker = program.getTypeChecker();
  const sourceNames = new Set(files.map((file) => POSIX(resolve(file)).toLowerCase()));
  const sourceFiles = program
    .getSourceFiles()
    .filter((file) => sourceNames.has(POSIX(resolve(file.fileName)).toLowerCase()));
  const importsByFile = new Map(
    sourceFiles.map((sourceFile) => [sourceFile.fileName, readImports(sourceFile)]),
  );
  const functionByNode = new Map();
  const functions = [];
  const nameOrdinals = new Map();

  for (const sourceFile of sourceFiles) {
    const file = POSIX(relative(rootDir, sourceFile.fileName));
    const collect = (node) => {
      if (isFunctionNode(node)) {
        const name = functionDisplayName(node, sourceFile);
        const ordinalKey = `${file}\n${name}`;
        const ordinal = (nameOrdinals.get(ordinalKey) || 0) + 1;
        nameOrdinals.set(ordinalKey, ordinal);
        const record = {
          file,
          id: `${file}::${name}#${ordinal}`,
          name,
          node,
          sourceFile,
        };
        functionByNode.set(node, record);
        functions.push(record);
      }
      ts.forEachChild(node, collect);
    };
    collect(sourceFile);
  }

  const edges = [];
  const incomingCalls = new Map();
  const seeds = new Map();
  const pendingRoots = [];
  const unknown = [];
  const forbidden = [];
  const queryCallables = [];
  const fetches = [];
  const edgeOrdinals = new Map();

  const addSeed = (record, trigger, site) => {
    if (!record) return;
    const current = seeds.get(record.id) || [];
    current.push({ trigger, site });
    seeds.set(record.id, current);
  };
  const addEdge = (caller, callee, kind, sourceFile, node) => {
    if (!caller || !callee) return;
    const pair = `${caller.id}\n${callee.id}\n${kind}`;
    const ordinal = (edgeOrdinals.get(pair) || 0) + 1;
    edgeOrdinals.set(pair, ordinal);
    const line = sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1;
    const edge = {
      caller,
      callee,
      kind,
      line,
      signature: `${kind}:${caller.id}=>${callee.id}#${ordinal}`,
    };
    edges.push(edge);
    const calls = incomingCalls.get(callee.id) || [];
    if (ts.isCallExpression(node)) calls.push(node);
    incomingCalls.set(callee.id, calls);
  };

  for (const sourceFile of sourceFiles) {
    const imports = importsByFile.get(sourceFile.fileName);
    const file = POSIX(relative(rootDir, sourceFile.fileName));
    const visit = (node) => {
      if (isFunctionNode(node)) {
        const record = functionByNode.get(node);
        const parent = node.parent;
        if (ts.isCallExpression(parent)) {
          const api = callName(parent.expression, sourceFile);
          if (EFFECT_HOOKS.has(api)) addSeed(record, "MOUNT_EFFECT", `${file}:${api}`);
          else if (LISTENER_APIS.has(api)) addSeed(record, "LISTENER", `${file}:${api}`);
          else if (TIMER_APIS.has(api)) addSeed(record, "TIMER", `${file}:${api}`);
          else {
            const lexicalParent = findContainingFunction(node, functionByNode);
            addEdge(lexicalParent, record, "CALLBACK", sourceFile, parent);
          }
        }
        if (ts.isJsxExpression(parent) && ts.isJsxAttribute(parent.parent)) {
          const attribute = parent.parent.name.getText(sourceFile);
          if (/^on[A-Z]/.test(attribute)) {
            addSeed(record, "USER_EVENT", `${file}:${attribute}`);
          }
        }
        if (ts.isReturnStatement(parent)) {
          let current = parent.parent;
          while (current) {
            const owner = functionByNode.get(current);
            if (owner) {
              const ownerParent = owner.node.parent;
              if (
                ts.isCallExpression(ownerParent) &&
                EFFECT_HOOKS.has(callName(ownerParent.expression, sourceFile))
              ) {
                addSeed(record, "UNMOUNT_CLEANUP", `${file}:effect-cleanup`);
              }
              break;
            }
            current = current.parent;
          }
        }
        if (/^[A-Z]/.test(record.name) && sourceFile.fileName.endsWith(".tsx")) {
          addSeed(record, "RENDER", `${file}:component-render`);
        }
      }

      if (ts.isJsxAttribute(node) && /^on[A-Z]/.test(node.name.getText(sourceFile))) {
        const expression = node.initializer && ts.isJsxExpression(node.initializer)
          ? node.initializer.expression
          : null;
        if (expression && (ts.isIdentifier(expression) || ts.isPropertyAccessExpression(expression))) {
          const target = resolveCalledFunction(checker, expression, functionByNode);
          addSeed(target, "USER_EVENT", `${file}:${node.name.getText(sourceFile)}`);
        }
      }

      if (ts.isCallExpression(node)) {
        const caller = findContainingFunction(node, functionByNode);
        const callee = resolveCalledFunction(checker, node.expression, functionByNode);
        addEdge(caller, callee, "CALL", sourceFile, node);
        const origin = importedApi(node.expression, imports);
        if (origin) {
          const mutationSet = DIRECT_MUTATIONS.get(origin.module);
          if (mutationSet?.has(origin.imported)) {
            const boundary = origin.module.endsWith("/firestore")
              ? "FIRESTORE"
              : origin.module.endsWith("/storage")
                ? "STORAGE"
                : "AUTH";
            pendingRoots.push({
              api: `${origin.module}#${origin.imported}`,
              boundary,
              call: node,
              caller,
              callable: null,
              file,
              line: sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1,
            });
          }
          if (origin.module === "firebase/functions" && origin.imported === "httpsCallable") {
            if (file !== "src/lib/firebase.ts") {
              forbidden.push({
                file,
                line: sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1,
                reason: "firebase/functions httpsCallable must be centralized in src/lib/firebase.ts",
              });
            }
          }
          if (origin.imported === "getHttpsCallable") {
            pendingRoots.push({
              api: "westory#getHttpsCallable",
              boundary: "CALLABLE",
              call: node,
              caller,
              callableExpression: node.arguments[0],
              file,
              line: sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1,
            });
          }
          if (origin.imported === "executeWestoryCommand") {
            pendingRoots.push({
              api: "westory#executeWestoryCommand",
              boundary: "GATEWAY",
              call: node,
              caller,
              callableExpression: node.arguments[0],
              file,
              line: sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1,
            });
          }
        }
        if (ts.isIdentifier(node.expression) && node.expression.text === "fetch") {
          let method = "GET";
          let dynamic = false;
          const options = node.arguments[1];
          if (options && ts.isObjectLiteralExpression(options)) {
            const methodProperty = options.properties.find(
              (property) =>
                ts.isPropertyAssignment(property) &&
                property.name.getText(sourceFile).replaceAll(/["']/g, "") === "method",
            );
            if (methodProperty && ts.isPropertyAssignment(methodProperty)) {
              if (ts.isStringLiteral(methodProperty.initializer)) {
                method = methodProperty.initializer.text.toUpperCase();
              } else {
                dynamic = true;
              }
            }
          } else if (options) {
            dynamic = true;
          }
          fetches.push({ file, line: sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1, method, dynamic });
          if (dynamic) unknown.push({ file, line: fetches.at(-1).line, reason: "dynamic fetch method" });
          else if (!["GET", "HEAD", "OPTIONS"].includes(method)) {
            pendingRoots.push({
              api: `http#${method}`,
              boundary: "HTTP",
              call: node,
              caller,
              callable: null,
              file,
              line: fetches.at(-1).line,
            });
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }

  const triggers = new Map();
  for (const record of functions) {
    triggers.set(record.id, new Set((seeds.get(record.id) || []).map((item) => item.trigger)));
  }
  let changed = true;
  while (changed) {
    changed = false;
    for (const edge of edges) {
      const from = triggers.get(edge.caller.id) || new Set();
      const to = triggers.get(edge.callee.id) || new Set();
      for (const trigger of from) {
        if (!to.has(trigger)) {
          to.add(trigger);
          changed = true;
        }
      }
      triggers.set(edge.callee.id, to);
    }
  }

  const reverseEdges = new Map();
  for (const edge of edges) {
    const current = reverseEdges.get(edge.callee.id) || [];
    current.push(edge);
    reverseEdges.set(edge.callee.id, current);
  }
  const graphFingerprint = (record) => {
    if (!record) return sha256("module-root");
    const queue = [record.id];
    const seenFunctions = new Set();
    const signatures = new Set();
    while (queue.length) {
      const id = queue.shift();
      if (seenFunctions.has(id)) continue;
      seenFunctions.add(id);
      for (const seed of seeds.get(id) || []) {
        signatures.add(`SEED:${seed.trigger}:${id}`);
      }
      for (const edge of reverseEdges.get(id) || []) {
        signatures.add(edge.signature);
        queue.push(edge.caller.id);
      }
    }
    return sha256([...signatures].sort().join("\n"));
  };

  const roots = [];
  for (const pending of pendingRoots) {
    let callableValues = pending.callable === null ? { values: new Set(), unknown: false } : null;
    if (pending.callableExpression) {
      callableValues = resolveStringValues(
        pending.callableExpression,
        checker,
        functionByNode,
        incomingCalls,
      );
      if (callableValues.unknown || !callableValues.values.size) {
        unknown.push({
          file: pending.file,
          line: pending.line,
          reason: `unresolved ${pending.boundary.toLowerCase()} command name`,
        });
      }
    }
    const names = [...(callableValues?.values || [])].sort();
    if (
      pending.boundary === "CALLABLE" &&
      names.length &&
      names.every((name) => QUERY_CALLABLES.has(name))
    ) {
      queryCallables.push({ file: pending.file, line: pending.line, names });
      continue;
    }
    const resolvedTriggers = triggers.get(pending.caller?.id);
    roots.push({
      ...pending,
      callable: names.length ? names.join("|") : null,
      callGraphHash: graphFingerprint(pending.caller),
      function: pending.caller?.name || "<module>",
      symbolId: pending.caller?.id || `${pending.file}::<module>#1`,
      triggers: resolvedTriggers?.size
        ? [...resolvedTriggers].sort()
        : ["UNREACHED"],
    });
  }

  const grouped = new Map();
  for (const root of roots) {
    const key = [root.file, root.symbolId, root.boundary, root.api, root.callable || ""].join("\n");
    const current = grouped.get(key) || {
      api: root.api,
      boundary: root.boundary,
      callable: root.callable,
      callGraphHash: root.callGraphHash,
      file: root.file,
      function: root.function,
      key,
      lines: [],
      rootCount: 0,
      symbolId: root.symbolId,
      triggers: root.triggers,
    };
    current.lines.push(root.line);
    current.rootCount += 1;
    grouped.set(key, current);
  }

  return {
    fetches,
    forbidden,
    observations: [...grouped.values()].sort((left, right) => left.key.localeCompare(right.key)),
    queryCallables,
    unknown,
  };
};

const entryKey = (entry) =>
  [entry.file, entry.symbolId, entry.boundary, entry.api, entry.callable || ""].join("\n");

const compareWaves = (left, right) => {
  const leftIndex = WAVE_ORDER.indexOf(left);
  const rightIndex = WAVE_ORDER.indexOf(right);
  assert.notEqual(leftIndex, -1, `unknown Wave: ${left}`);
  assert.notEqual(rightIndex, -1, `unknown Wave: ${right}`);
  return leftIndex - rightIndex;
};

export const validateGatewayPurity = (analysis) => {
  const forbiddenTriggers = new Set([
    "LISTENER",
    "MOUNT_EFFECT",
    "RENDER",
    "TIMER",
    "UNMOUNT_CLEANUP",
    "UNREACHED",
  ]);
  for (const item of analysis.observations.filter((entry) => entry.boundary === "GATEWAY")) {
    const invalid = item.triggers.filter((trigger) => forbiddenTriggers.has(trigger));
    assert.deepEqual(
      invalid,
      [],
      `gateway dispatch must be reachable only from an explicit user event: ${item.file} :: ${item.function} (${invalid.join(", ")})`,
    );
    assert.ok(
      item.triggers.includes("USER_EVENT"),
      `gateway dispatch has no explicit JSX event entry: ${item.file} :: ${item.function}`,
    );
  }
};

export const buildProposedPolicy = (analysis) => {
  const entries = analysis.observations.map((item, index) => {
    const permanent =
      item.boundary === "AUTH" ||
      item.boundary === "GATEWAY" ||
      (item.boundary === "CALLABLE" &&
        String(item.callable || "")
          .split("|")
          .every((name) => SESSION_CONTROL_CALLABLES.has(name) || name === "executeCommand"));
    const reason = item.boundary === "AUTH"
      ? "Firebase Auth 로그인·로그아웃·재인증 수명주기"
      : item.boundary === "GATEWAY"
        ? "명시적 사용자 동작에서 W2 command gateway 호출"
        : item.boundary === "CALLABLE" && permanent
          ? "애플리케이션 세션 권한 control-plane callable"
          : item.boundary === "CALLABLE"
            ? "기존 callable command adapter; gateway 이전 전 임시 허용"
            : item.boundary === "STORAGE"
              ? "기존 명시적 파일 업로드·삭제 흐름; gateway 이전 전 임시 허용"
              : "기존 client direct write; 지정 Wave까지 gateway 이전 필요";
    return {
      id: `DW-${String(index + 1).padStart(3, "0")}`,
      file: item.file,
      function: item.function,
      symbolId: item.symbolId,
      boundary: item.boundary,
      api: item.api,
      callable: item.callable,
      triggers: item.triggers,
      reason,
      introducedWave: permanent && item.boundary === "GATEWAY" ? "W2A" : "LEGACY",
      migrationWave: permanent ? "PERMANENT" : "W12",
      expiresAfterWave: permanent ? "PERMANENT" : "W12",
      owner: "westory-maintainers",
      testOwner: "command-gateway-safety",
      rootCount: item.rootCount,
      callGraphHash: item.callGraphHash,
    };
  });
  return { schemaVersion: 1, currentWave: "W2B", approvedEntryCount: entries.length, entries };
};

export const validatePolicy = (policy, analysis) => {
  assert.equal(policy.schemaVersion, 1, "direct-write allowlist schemaVersion must be 1");
  assert.ok(WAVE_ORDER.includes(policy.currentWave), "allowlist currentWave must be recognized");
  assert.equal(
    policy.entries.length,
    policy.approvedEntryCount,
    "allowlist growth requires an explicit approvedEntryCount review",
  );
  assert.deepEqual(analysis.forbidden, [], "forbidden direct firebase/functions usage detected");
  assert.deepEqual(analysis.unknown, [], "UNKNOWN client mutation boundary detected");
  validateGatewayPurity(analysis);

  const byKey = new Map();
  for (const entry of policy.entries) {
    for (const field of [
      "id",
      "file",
      "function",
      "symbolId",
      "boundary",
      "api",
      "reason",
      "introducedWave",
      "migrationWave",
      "expiresAfterWave",
      "owner",
      "testOwner",
      "callGraphHash",
    ]) {
      assert.ok(entry[field], `allowlist ${entry.id || "entry"} missing ${field}`);
    }
    assert.ok(Array.isArray(entry.triggers) && entry.triggers.length, `${entry.id} missing triggers`);
    assert.ok(Number.isInteger(entry.rootCount) && entry.rootCount > 0, `${entry.id} invalid rootCount`);
    const key = entryKey(entry);
    assert.ok(!byKey.has(key), `duplicate allowlist boundary: ${entry.file} :: ${entry.function}`);
    byKey.set(key, entry);
    if (entry.expiresAfterWave === "PERMANENT") {
      assert.ok(
        entry.boundary === "AUTH" ||
          entry.boundary === "GATEWAY" ||
          (entry.boundary === "CALLABLE" &&
            String(entry.callable || "")
              .split("|")
              .every((name) => SESSION_CONTROL_CALLABLES.has(name) || name === "executeCommand")),
        `${entry.id} may not use PERMANENT expiry`,
      );
    } else {
      assert.ok(WAVE_ORDER.includes(entry.migrationWave), `${entry.id} invalid migrationWave`);
      assert.ok(WAVE_ORDER.includes(entry.expiresAfterWave), `${entry.id} invalid expiry`);
      assert.ok(
        compareWaves(policy.currentWave, entry.expiresAfterWave) <= 0,
        `${entry.id} expired after ${entry.expiresAfterWave}`,
      );
    }
  }

  const observedKeys = new Set();
  for (const observed of analysis.observations) {
    const key = entryKey(observed);
    observedKeys.add(key);
    const approved = byKey.get(key);
    assert.ok(
      approved,
      `unapproved client mutation boundary: ${observed.file} :: ${observed.function} :: ${observed.api}${observed.callable ? `(${observed.callable})` : ""}`,
    );
    assert.equal(approved.rootCount, observed.rootCount, `${approved.id} root count changed`);
    assert.equal(approved.callGraphHash, observed.callGraphHash, `${approved.id} wrapper/callsite graph changed`);
    assert.deepEqual(approved.triggers, observed.triggers, `${approved.id} trigger classification changed`);
  }
  for (const [key, entry] of byKey) {
    assert.ok(observedKeys.has(key), `stale allowlist entry: ${entry.id} ${entry.file} :: ${entry.function}`);
  }
};

export const validateCommandManifest = (manifest, analysis) => {
  assert.equal(manifest.schemaVersion, 1, "command inventory schemaVersion must be 1");
  assert.equal(manifest.commands.length, 28, "command inventory must contain exactly 28 commands");
  const seen = new Set();
  for (const command of manifest.commands) {
    assert.ok(!seen.has(command.id), `duplicate command inventory id: ${command.id}`);
    seen.add(command.id);
    assert.equal(REQUIRED_COMMANDS.get(command.id), command.name, `command inventory mismatch: ${command.id}`);
  }
  assert.deepEqual([...seen].sort(), [...REQUIRED_COMMANDS.keys()].sort(), "command inventory IDs must be exact");

  const dispositionCounts = Object.fromEntries(
    Object.keys(manifest.expectedDispositionCounts).map((key) => [key, 0]),
  );
  const canonicalGroups = new Map();

  for (const command of manifest.commands) {
    assert.ok(command.canonicalGroup, `${command.id} missing canonicalGroup`);
    assert.ok(command.ownerWave && WAVE_ORDER.includes(command.ownerWave), `${command.id} invalid ownerWave`);
    assert.ok(
      Object.hasOwn(manifest.expectedDispositionCounts, command.disposition),
      `${command.id} has UNKNOWN disposition`,
    );
    dispositionCounts[command.disposition] += 1;
    const canonical = canonicalGroups.get(command.canonicalGroup) || [];
    canonical.push(command);
    canonicalGroups.set(command.canonicalGroup, canonical);
    assert.ok(
      ["NATURALLY_IDEMPOTENT", "NON_IDEMPOTENT"].includes(command.idempotency),
      `${command.id} has unknown idempotency`,
    );
    assert.ok(
      ["GATEWAY", "LEGACY_DIRECT", "LEGACY_CALLABLE", "SERVER_ALIAS_NO_CLIENT", "ADAPTER_NO_UI"].includes(command.clientMode),
      `${command.id} has UNKNOWN clientMode`,
    );
    if (command.clientMode === "GATEWAY") {
      assert.ok(
        analysis.observations.some(
          (entry) => entry.boundary === "GATEWAY" && entry.callable === command.dispatchName,
        ),
        `${command.id} gateway dispatch not observed`,
      );
    } else if (["LEGACY_CALLABLE", "ADAPTER_NO_UI"].includes(command.clientMode)) {
      assert.ok(
        analysis.observations.some(
          (entry) =>
            entry.boundary === "CALLABLE" &&
            String(entry.callable || "").split("|").includes(command.dispatchName || command.name),
        ),
        `${command.id} callable adapter not observed`,
      );
    } else if (command.clientMode === "LEGACY_DIRECT") {
      assert.ok(Array.isArray(command.anchors) && command.anchors.length, `${command.id} needs direct anchors`);
      for (const anchor of command.anchors) {
        assert.ok(
          analysis.observations.some(
            (entry) =>
              entry.file === anchor.file &&
              entry.function === anchor.function &&
              entry.api.endsWith(`#${anchor.api}`),
          ),
          `${command.id} direct anchor not observed: ${anchor.file} :: ${anchor.function} :: ${anchor.api}`,
        );
      }
    } else if (command.clientMode === "SERVER_ALIAS_NO_CLIENT") {
      assert.ok(
        !analysis.observations.some(
          (entry) =>
            entry.boundary === "CALLABLE" &&
            String(entry.callable || "").split("|").includes(command.name),
        ),
        `${command.id} is declared no-client but has a client callable`,
      );
    }
  }
  assert.deepEqual(dispositionCounts, manifest.expectedDispositionCounts, "command disposition counts changed");
  assert.equal(canonicalGroups.size, manifest.expectedCanonicalCounts.total, "canonical command count changed");
  assert.equal(
    [...canonicalGroups.values()].filter((commands) => commands.every((command) => command.disposition !== "W2A_DONE")).length,
    manifest.expectedCanonicalCounts.remainingAfterW2A,
    "remaining canonical command count changed",
  );
  assert.equal(
    [...canonicalGroups.values()].filter((commands) =>
      commands.every((command) => !["W2A_DONE", "W3_DONE"].includes(command.disposition)),
    ).length,
    manifest.expectedCanonicalCounts.remainingAfterW3,
    "remaining canonical command count after W3 changed",
  );
  assert.equal(
    [...canonicalGroups.values()].filter((commands) => commands.some((command) => command.disposition === "DOMAIN_WAVE")).length,
    manifest.expectedCanonicalCounts.DOMAIN_WAVE,
    "DOMAIN_WAVE canonical count changed",
  );
  assert.deepEqual(
    manifest.commands.filter((command) => command.disposition === "TEMPORARY_ALLOWLIST").map(({ id, ownerWave }) => ({ id, ownerWave })),
    [{ id: "D04", ownerWave: "W5" }, { id: "C02", ownerWave: "W8A" }],
    "temporary allowlist owners must remain D04/W5 and C02/W8A",
  );
};

const run = () => {
  const rootDir = process.cwd();
  const analysis = analyzeClientBoundary({ rootDir });
  if (process.argv.includes("--inventory")) {
    console.log(JSON.stringify(analysis, null, 2));
    return;
  }
  if (process.argv.includes("--propose")) {
    console.log(JSON.stringify(buildProposedPolicy(analysis), null, 2));
    return;
  }
  const chunkArgument = process.argv.find((value) => value.startsWith("--propose-chunk="));
  if (chunkArgument) {
    const [start, end] = chunkArgument
      .slice("--propose-chunk=".length)
      .split(":")
      .map(Number);
    assert.ok(Number.isInteger(start) && Number.isInteger(end) && start >= 0 && end > start);
    console.log(JSON.stringify(buildProposedPolicy(analysis).entries.slice(start, end)));
    return;
  }
  const policy = JSON.parse(
    readFileSync(resolve(rootDir, "scripts/client-direct-write-allowlist.json"), "utf8"),
  );
  const manifest = JSON.parse(
    readFileSync(resolve(rootDir, "scripts/w2-high-risk-command-manifest.json"), "utf8"),
  );
  validatePolicy(policy, analysis);
  validateCommandManifest(manifest, analysis);
  console.log(
    JSON.stringify({
      suite: "client-direct-write-boundary",
      passed: true,
      approvedBoundaryGroups: analysis.observations.length,
      queryCallableFactories: analysis.queryCallables.length,
      fetches: analysis.fetches.length,
      commandInventory: manifest.commands.length,
      unknown: analysis.unknown.length,
    }),
  );
};

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : "";
if (invokedPath === import.meta.url) run();
