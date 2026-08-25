import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const toPosix = (value) => value.replaceAll("\\", "/");
const EXECUTABLE_SOURCE_PATTERN = /\.(?:[cm]?[jt]s|[jt]sx)$/u;
const EXECUTABLE_JAVASCRIPT_PATTERN = /\.(?:[cm]?js|jsx)$/u;
const listExecutableSources = async (directory) => {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await listExecutableSources(path)));
    else if (EXECUTABLE_SOURCE_PATTERN.test(entry.name)) files.push(path);
  }
  return files;
};
const sourcePaths = await listExecutableSources(resolve(repoRoot, "src"));
const sourceEntries = new Map(
  await Promise.all(
    sourcePaths.map(async (path) => [
      toPosix(relative(repoRoot, path)),
      await readFile(path, "utf8"),
    ]),
  ),
);

const bindingSourceUrl = new URL(
  "../src/lib/firebaseActiveBinding.ts",
  import.meta.url,
);
const viteSourceUrl = new URL("../vite.config.ts", import.meta.url);
const bindingSource = sourceEntries.get("src/lib/firebaseActiveBinding.ts");
const firebaseSource = sourceEntries.get("src/lib/firebase.ts");
assert.ok(bindingSource, "active Firebase binding source is missing");
assert.ok(firebaseSource, "Firebase client source is missing");
const viteSource = await readFile(viteSourceUrl, "utf8");

const APPROVED_FIREBASE_CLIENT = "src/lib/firebase.ts";
const FIREBASE_CALL_TOKENS = new Set([
  "initializeApp",
  "initializeAppCheck",
  "getAuth",
  "getFirestore",
  "getFunctions",
  "getStorage",
]);
const SERVICE_CALL_TOKENS = [
  "initializeAppCheck",
  "getAuth",
  "getFirestore",
  "getFunctions",
  "getStorage",
];
const TOKEN_MODULES = new Map([
  ["initializeApp", "firebase/app"],
  ["initializeAppCheck", "firebase/app-check"],
  ["getAuth", "firebase/auth"],
  ["getFirestore", "firebase/firestore"],
  ["getFunctions", "firebase/functions"],
  ["getStorage", "firebase/storage"],
]);

const scriptKindFor = (file) => {
  if (file.endsWith(".tsx")) return ts.ScriptKind.TSX;
  if (file.endsWith(".jsx")) return ts.ScriptKind.JSX;
  if (/\.(?:[cm]?js)$/u.test(file)) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
};
const createSourceProgram = (sources) => {
  const options = {
    allowJs: true,
    checkJs: false,
    jsx: ts.JsxEmit.ReactJSX,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    noEmit: true,
    noLib: true,
    noResolve: true,
    skipLibCheck: true,
    target: ts.ScriptTarget.ESNext,
    types: [],
  };
  const defaultHost = ts.createCompilerHost(options, true);
  const canonicalPath = (file) => {
    const absolute = resolve(file);
    return ts.sys.useCaseSensitiveFileNames ? absolute : absolute.toLowerCase();
  };
  const virtualSources = new Map(
    [...sources].map(([file, source]) => {
      const absolute = resolve(repoRoot, file);
      return [canonicalPath(absolute), { absolute, file, source }];
    }),
  );
  const host = {
    ...defaultHost,
    fileExists: (file) =>
      virtualSources.has(canonicalPath(file)) || defaultHost.fileExists(file),
    getCurrentDirectory: () => repoRoot,
    getSourceFile: (
      file,
      languageVersion,
      onError,
      shouldCreateNewSourceFile,
    ) => {
      const virtual = virtualSources.get(canonicalPath(file));
      if (virtual) {
        return ts.createSourceFile(
          virtual.absolute,
          virtual.source,
          languageVersion,
          true,
          scriptKindFor(virtual.file),
        );
      }
      return defaultHost.getSourceFile(
        file,
        languageVersion,
        onError,
        shouldCreateNewSourceFile,
      );
    },
    readFile: (file) =>
      virtualSources.get(canonicalPath(file))?.source ??
      defaultHost.readFile(file),
  };
  const roots = [...virtualSources.values()];
  const program = ts.createProgram({
    rootNames: roots.map(({ absolute }) => absolute),
    options,
    host,
  });
  const sourceFiles = new Map(
    roots.map(({ absolute, file }) => {
      const sourceFile = program.getSourceFile(absolute);
      assert.ok(sourceFile, `${file} is missing from the TypeScript program`);
      assert.equal(
        sourceFile.parseDiagnostics.length,
        0,
        `${file} contains a TypeScript parse error`,
      );
      return [file, sourceFile];
    }),
  );
  return { checker: program.getTypeChecker(), program, sourceFiles };
};
const createSyntacticSourceFiles = (sources) =>
  new Map(
    [...sources].map(([file, source]) => {
      const sourceFile = ts.createSourceFile(
        resolve(repoRoot, file),
        source,
        ts.ScriptTarget.Latest,
        true,
        scriptKindFor(file),
      );
      assert.equal(
        sourceFile.parseDiagnostics.length,
        0,
        `${file} contains a TypeScript parse error`,
      );
      return [file, sourceFile];
    }),
  );
const stringLiteralValue = (node) =>
  ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)
    ? node.text
    : null;
const unwrapExpression = (expression) => {
  let current = expression;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isTypeAssertionExpression(current) ||
    ts.isNonNullExpression(current) ||
    ts.isSatisfiesExpression(current)
  ) {
    current = current.expression;
  }
  return current;
};
const staticStringValue = (expression) => {
  const current = unwrapExpression(expression);
  const literal = stringLiteralValue(current);
  if (literal !== null) return literal;
  if (
    ts.isBinaryExpression(current) &&
    current.operatorToken.kind === ts.SyntaxKind.PlusToken
  ) {
    const left = staticStringValue(current.left);
    const right = staticStringValue(current.right);
    return left === null || right === null ? null : `${left}${right}`;
  }
  return null;
};
const propertyName = (node) => {
  if (ts.isPropertyAccessExpression(node)) return node.name.text;
  if (ts.isElementAccessExpression(node) && node.argumentExpression) {
    return staticStringValue(node.argumentExpression);
  }
  return null;
};
const importedName = (element) => (element.propertyName || element.name).text;

const analyzeFirebaseInitializationInventory = (sources, prepared = null) => {
  const { checker, program, sourceFiles } =
    prepared ?? createSourceProgram(sources);
  const symbolSourceFiles = prepared?.symbolSourceFiles ?? sourceFiles;
  const aliasesByFile = new Map();
  const aliasEdgesByFile = new Map();
  const bindingDeclarations = [];
  const importBindings = [];
  const dynamicImports = [];
  const forbidden = [];

  for (const [file, sourceFile] of sourceFiles) {
    const aliases = new Map();
    const aliasEdges = [];
    aliasesByFile.set(file, aliases);
    aliasEdgesByFile.set(file, aliasEdges);
    if (EXECUTABLE_JAVASCRIPT_PATTERN.test(file)) {
      forbidden.push({
        file,
        reason: "executable JavaScript under src is explicitly forbidden",
      });
    }

    const seed = (local, token, kind, identifier, module = null) => {
      if (!FIREBASE_CALL_TOKENS.has(token)) return;
      aliases.set(local, token);
      bindingDeclarations.push({
        file,
        identifier,
        kind,
        local,
        module,
        token,
      });
      if (kind === "import") {
        importBindings.push({
          file,
          identifier,
          kind,
          local,
          module,
          token,
        });
      }
    };

    const visit = (node) => {
      if (ts.isImportDeclaration(node)) {
        const module = stringLiteralValue(node.moduleSpecifier);
        const clause = node.importClause;
        if (module && /firebase\/(?:compat\/app|app-compat)$/u.test(module)) {
          forbidden.push({ file, reason: `compat app import: ${module}` });
        }
        if (clause?.name && [...TOKEN_MODULES.values()].includes(module)) {
          forbidden.push({
            file,
            reason: `default Firebase service import: ${module}`,
          });
        }
        if (
          clause?.namedBindings &&
          ts.isNamespaceImport(clause.namedBindings)
        ) {
          if ([...TOKEN_MODULES.values()].includes(module)) {
            forbidden.push({
              file,
              reason: `namespace Firebase service import: ${module}`,
            });
          }
        }
        if (clause?.namedBindings && ts.isNamedImports(clause.namedBindings)) {
          for (const element of clause.namedBindings.elements) {
            seed(
              element.name.text,
              importedName(element),
              "import",
              element.name,
              module,
            );
          }
        }
      }
      if (ts.isExportDeclaration(node) && node.moduleSpecifier) {
        const module = stringLiteralValue(node.moduleSpecifier);
        if ([...TOKEN_MODULES.values()].includes(module)) {
          forbidden.push({
            file,
            reason: `re-exported Firebase service: ${module}`,
          });
        }
      }

      if (ts.isCallExpression(node)) {
        if (node.expression.kind === ts.SyntaxKind.ImportKeyword) {
          const module = node.arguments[0]
            ? staticStringValue(node.arguments[0])
            : null;
          dynamicImports.push({ file, module });
          if (module === null) {
            forbidden.push({
              file,
              reason: "nonliteral dynamic import is inventory-opaque",
            });
          }
          if (
            module === "firebase/app" ||
            [
              "firebase/app-check",
              "firebase/auth",
              "firebase/firestore",
            ].includes(module) ||
            /firebase\/(?:compat\/app|app-compat)$/u.test(module || "")
          ) {
            forbidden.push({ file, reason: `dynamic app import: ${module}` });
          }
        }
        if (
          ts.isIdentifier(node.expression) &&
          node.expression.text === "require"
        ) {
          const module = node.arguments[0]
            ? staticStringValue(node.arguments[0])
            : null;
          if (
            module === "firebase/app" ||
            /firebase\/(?:compat\/app|app-compat)$/u.test(module || "")
          ) {
            forbidden.push({ file, reason: `CommonJS app import: ${module}` });
          }
        }
      }

      if (
        (ts.isStringLiteral(node) ||
          ts.isNoSubstitutionTemplateLiteral(node)) &&
        /(?:firebase-app(?:-compat)?\.js|firebase\.initializeApp\s*\()/u.test(
          node.text,
        )
      ) {
        forbidden.push({
          file,
          reason: "string-constructed Firebase app initializer",
        });
      }

      if (ts.isVariableDeclaration(node)) {
        if (ts.isIdentifier(node.name)) {
          if (FIREBASE_CALL_TOKENS.has(node.name.text)) {
            seed(node.name.text, node.name.text, "declaration", node.name);
          }
          if (node.initializer) {
            aliasEdges.push({
              local: node.name.text,
              expression: node.initializer,
            });
          }
        } else if (ts.isObjectBindingPattern(node.name)) {
          for (const element of node.name.elements) {
            if (!ts.isIdentifier(element.name)) continue;
            const token = (element.propertyName || element.name).getText(
              sourceFile,
            );
            seed(element.name.text, token, "binding", element.name);
          }
        }
      }
      if (ts.isParameter(node) && ts.isObjectBindingPattern(node.name)) {
        for (const element of node.name.elements) {
          if (!ts.isIdentifier(element.name)) continue;
          const token = (element.propertyName || element.name).getText(
            sourceFile,
          );
          seed(element.name.text, token, "binding", element.name);
        }
      }
      if (
        ts.isFunctionDeclaration(node) &&
        node.name &&
        FIREBASE_CALL_TOKENS.has(node.name.text)
      ) {
        seed(node.name.text, node.name.text, "declaration", node.name);
      }
      if (
        ts.isBinaryExpression(node) &&
        node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
        ts.isIdentifier(node.left)
      ) {
        aliasEdges.push({ local: node.left.text, expression: node.right });
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }

  const resolveToken = (expression, aliases) => {
    const current = unwrapExpression(expression);
    if (ts.isIdentifier(current)) return aliases.get(current.text) || null;
    if (ts.isCallExpression(current)) {
      const expression = unwrapExpression(current.expression);
      if (
        (ts.isPropertyAccessExpression(expression) ||
          ts.isElementAccessExpression(expression)) &&
        propertyName(expression) === "bind"
      ) {
        return resolveToken(expression.expression, aliases);
      }
    }
    if (
      ts.isBinaryExpression(current) &&
      current.operatorToken.kind === ts.SyntaxKind.CommaToken
    ) {
      return resolveToken(current.right, aliases);
    }
    if (
      ts.isPropertyAccessExpression(current) ||
      ts.isElementAccessExpression(current)
    ) {
      const name = propertyName(current);
      if (FIREBASE_CALL_TOKENS.has(name)) return name;
      if (name === "call" || name === "apply") {
        return resolveToken(current.expression, aliases);
      }
    }
    return null;
  };

  for (const [file, edges] of aliasEdgesByFile) {
    const aliases = aliasesByFile.get(file);
    let changed = true;
    while (changed) {
      changed = false;
      for (const edge of edges) {
        const token = resolveToken(edge.expression, aliases);
        if (token && aliases.get(edge.local) !== token) {
          aliases.set(edge.local, token);
          changed = true;
        }
      }
    }
  }

  const calls = [];
  for (const [file, sourceFile] of sourceFiles) {
    const aliases = aliasesByFile.get(file);
    const visit = (node) => {
      if (ts.isCallExpression(node)) {
        const token = resolveToken(node.expression, aliases);
        if (token) calls.push({ file, token, node, sourceFile });
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }

  return {
    bindingDeclarations,
    calls,
    checker,
    dynamicImports,
    forbidden,
    importBindings,
    program,
    sourceFiles,
    symbolSourceFiles,
  };
};

const containingTopLevelAppDeclaration = (call) => {
  const declaration = call.node.parent;
  if (
    !ts.isVariableDeclaration(declaration) ||
    declaration.initializer !== call.node
  ) {
    return null;
  }
  if (!ts.isIdentifier(declaration.name) || declaration.name.text !== "app") {
    return null;
  }
  const declarationList = declaration.parent;
  const statement = declarationList.parent;
  return ts.isVariableStatement(statement) &&
    ts.isSourceFile(statement.parent) &&
    (declarationList.flags & ts.NodeFlags.Const) !== 0
    ? declaration
    : null;
};

const valueBindingsNamed = (sourceFile, name) => {
  const bindings = [];
  const collectBindingName = (bindingName, declaration) => {
    if (ts.isIdentifier(bindingName)) {
      if (bindingName.text === name) {
        bindings.push({ declaration, identifier: bindingName });
      }
      return;
    }
    for (const element of bindingName.elements) {
      if (ts.isOmittedExpression(element)) continue;
      collectBindingName(element.name, declaration);
    }
  };
  const visit = (node) => {
    if (ts.isVariableDeclaration(node) || ts.isParameter(node)) {
      collectBindingName(node.name, node);
    }
    if (
      (ts.isFunctionDeclaration(node) ||
        ts.isFunctionExpression(node) ||
        ts.isClassDeclaration(node) ||
        ts.isClassExpression(node) ||
        ts.isEnumDeclaration(node)) &&
      node.name?.text === name
    ) {
      bindings.push({ declaration: node, identifier: node.name });
    }
    if (
      (ts.isImportSpecifier(node) || ts.isNamespaceImport(node)) &&
      node.name.text === name
    ) {
      bindings.push({ declaration: node, identifier: node.name });
    }
    if (ts.isImportClause(node) && node.name?.text === name) {
      bindings.push({ declaration: node, identifier: node.name });
    }
    if (ts.isImportEqualsDeclaration(node) && node.name.text === name) {
      bindings.push({ declaration: node, identifier: node.name });
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return bindings;
};

const valueBindingsAcross = (sourceFiles, name) =>
  [...sourceFiles].flatMap(([file, sourceFile]) =>
    valueBindingsNamed(sourceFile, name).map((binding) => ({
      ...binding,
      file,
    })),
  );

const symbolReferences = (sourceFiles, checker, symbol) => {
  const references = [];
  for (const [file, sourceFile] of sourceFiles) {
    const visit = (node) => {
      if (
        ts.isIdentifier(node) &&
        checker.getSymbolAtLocation(node) === symbol
      ) {
        references.push({ file, node, sourceFile });
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }
  return references;
};

const assertExactSymbolReferences = (
  analysis,
  symbol,
  allowedNodes,
  description,
) => {
  const references = symbolReferences(
    analysis.symbolSourceFiles ?? analysis.sourceFiles,
    analysis.checker,
    symbol,
  );
  const allowed = new Set(allowedNodes);
  assert.equal(
    references.length,
    allowed.size,
    `${description} has an alias, export, assignment, argument, property, or other unapproved reference`,
  );
  for (const reference of references) {
    assert.ok(
      allowed.has(reference.node),
      `${description} has an unapproved symbol reference in ${reference.file}`,
    );
  }
};

const dynamicThenModuleForBinding = (identifier) => {
  const element = identifier.parent;
  if (!ts.isBindingElement(element)) return null;
  const pattern = element.parent;
  if (!ts.isObjectBindingPattern(pattern)) return null;
  const parameter = pattern.parent;
  if (!ts.isParameter(parameter)) return null;
  const callback = parameter.parent;
  if (!ts.isArrowFunction(callback) && !ts.isFunctionExpression(callback)) {
    return null;
  }
  const thenCall = callback.parent;
  if (
    !ts.isCallExpression(thenCall) ||
    !thenCall.arguments.includes(callback)
  ) {
    return null;
  }
  const thenExpression = unwrapExpression(thenCall.expression);
  if (
    !ts.isPropertyAccessExpression(thenExpression) ||
    thenExpression.name.text !== "then"
  ) {
    return null;
  }
  const importCall = unwrapExpression(thenExpression.expression);
  if (
    !ts.isCallExpression(importCall) ||
    importCall.expression.kind !== ts.SyntaxKind.ImportKeyword ||
    importCall.arguments.length !== 1
  ) {
    return null;
  }
  return staticStringValue(importCall.arguments[0]);
};

const nodeContainsSymbol = (node, checker, symbol) => {
  let found = false;
  const visit = (current) => {
    if (found) return;
    if (
      ts.isIdentifier(current) &&
      checker.getSymbolAtLocation(current) === symbol
    ) {
      found = true;
      return;
    }
    ts.forEachChild(current, visit);
  };
  visit(node);
  return found;
};

const isAssignmentOperator = (kind) =>
  kind >= ts.SyntaxKind.FirstAssignment && kind <= ts.SyntaxKind.LastAssignment;

const findSymbolWrites = (sourceFiles, checker, symbol) => {
  const writes = [];
  for (const [file, sourceFile] of sourceFiles) {
    const record = (node, target) => {
      if (nodeContainsSymbol(target, checker, symbol)) {
        writes.push({ file, node });
      }
    };
    const visit = (node) => {
      if (
        ts.isBinaryExpression(node) &&
        isAssignmentOperator(node.operatorToken.kind)
      ) {
        record(node, node.left);
      } else if (
        (ts.isPrefixUnaryExpression(node) ||
          ts.isPostfixUnaryExpression(node)) &&
        (node.operator === ts.SyntaxKind.PlusPlusToken ||
          node.operator === ts.SyntaxKind.MinusMinusToken)
      ) {
        record(node, node.operand);
      } else if (ts.isForInStatement(node) || ts.isForOfStatement(node)) {
        record(node, node.initializer);
      } else if (ts.isDeleteExpression(node)) {
        record(node, node.expression);
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }
  return writes;
};

const validateFirebaseInitializationInventory = (analysis) => {
  assert.deepEqual(
    analysis.forbidden,
    [],
    "compat, namespace, dynamic, or string-constructed Firebase app initializer detected",
  );
  for (const dynamicImport of analysis.dynamicImports) {
    if (
      dynamicImport.module === "firebase/functions" ||
      dynamicImport.module === "firebase/storage"
    ) {
      assert.equal(
        dynamicImport.file,
        APPROVED_FIREBASE_CLIENT,
        `${dynamicImport.module} may be dynamically imported only by the approved Firebase client`,
      );
    }
  }
  for (const binding of analysis.importBindings) {
    assert.equal(
      binding.module,
      TOKEN_MODULES.get(binding.token),
      `${binding.file} imports ${binding.token} from an unapproved module`,
    );
    assert.equal(
      binding.file,
      APPROVED_FIREBASE_CLIENT,
      `${binding.token} may be imported only by the approved Firebase client`,
    );
  }

  const tokenBindings = new Map();
  for (const token of FIREBASE_CALL_TOKENS) {
    const bindings = analysis.bindingDeclarations.filter(
      (binding) => binding.token === token,
    );
    assert.equal(bindings.length, 1, `${token} binding must be unique`);
    const binding = bindings[0];
    assert.equal(
      binding.file,
      APPROVED_FIREBASE_CLIENT,
      `${token} must be bound only by the approved Firebase client`,
    );
    if (binding.kind === "import") {
      assert.equal(
        binding.module,
        TOKEN_MODULES.get(token),
        `${token} import must preserve its exact Firebase module`,
      );
    } else {
      assert.ok(
        (token === "getFunctions" || token === "getStorage") &&
          binding.kind === "binding" &&
          dynamicThenModuleForBinding(binding.identifier) ===
            TOKEN_MODULES.get(token),
        `${token} must be an exact import or the approved dynamic-import .then binding`,
      );
    }
    const symbol = analysis.checker.getSymbolAtLocation(binding.identifier);
    assert.ok(symbol, `${token} binding symbol is missing`);
    tokenBindings.set(token, { ...binding, symbol });
  }

  const initializerImports = analysis.importBindings.filter(
    (binding) => binding.token === "initializeApp",
  );
  assert.equal(
    initializerImports.length,
    1,
    "initializeApp import must be unique",
  );
  const initializerCalls = analysis.calls.filter(
    (call) => call.token === "initializeApp",
  );
  assert.equal(initializerCalls.length, 1, "initializeApp call must be unique");
  const initializer = initializerCalls[0];
  assert.equal(initializer.file, APPROVED_FIREBASE_CLIENT);
  const appDeclaration = containingTopLevelAppDeclaration(initializer);
  assert.ok(
    appDeclaration,
    "the approved app initializer must be the live top-level const app binding",
  );
  const appBindings = valueBindingsAcross(analysis.symbolSourceFiles, "app");
  assert.equal(
    appBindings.length,
    1,
    "the Firebase source inventory must have exactly one unshadowed app value binding",
  );
  assert.equal(appBindings[0].declaration, appDeclaration);
  assert.equal(appBindings[0].file, APPROVED_FIREBASE_CLIENT);
  const appSymbol = analysis.checker.getSymbolAtLocation(appDeclaration.name);
  assert.ok(appSymbol, "the approved app binding symbol is missing");
  assert.equal(
    findSymbolWrites(analysis.symbolSourceFiles, analysis.checker, appSymbol)
      .length,
    0,
    "the approved const app binding must never be reassigned, updated, destructured into, or otherwise written",
  );

  for (const token of FIREBASE_CALL_TOKENS) {
    const tokenCalls = analysis.calls.filter((call) => call.token === token);
    assert.equal(tokenCalls.length, 1, `${token} call must be unique`);
    const tokenCall = tokenCalls[0];
    const callee = unwrapExpression(tokenCall.node.expression);
    const binding = tokenBindings.get(token);
    assert.ok(
      ts.isIdentifier(callee) &&
        analysis.checker.getSymbolAtLocation(callee) === binding.symbol,
      `${token} must be invoked only as its directly bound Firebase symbol`,
    );
    assertExactSymbolReferences(
      analysis,
      binding.symbol,
      [binding.identifier, callee],
      token,
    );
  }

  for (const token of SERVICE_CALL_TOKENS) {
    const consumers = analysis.calls.filter((call) => call.token === token);
    assert.equal(consumers.length, 1, `${token} call must be unique`);
    const consumer = consumers[0];
    assert.equal(
      consumer.file,
      APPROVED_FIREBASE_CLIENT,
      `${token} must remain in the approved Firebase client`,
    );
    assert.ok(
      consumer.node.arguments[0] &&
        ts.isIdentifier(unwrapExpression(consumer.node.arguments[0])) &&
        analysis.checker.getSymbolAtLocation(
          unwrapExpression(consumer.node.arguments[0]),
        ) === appSymbol,
      `${token} must consume the approved app binding directly`,
    );
    assert.ok(
      consumer.node.getStart() > initializer.node.getStart(),
      `${token} must execute after the app binding is initialized`,
    );
  }
  return initializer;
};

const callExpressionsNamed = (sourceFile, name) => {
  const matches = [];
  const visit = (node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(unwrapExpression(node.expression)) &&
      unwrapExpression(node.expression).text === name
    ) {
      matches.push(node);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return matches;
};

const variableDeclarationsNamed = (sourceFile, name) => {
  const matches = [];
  const visit = (node) => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === name
    ) {
      matches.push(node);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return matches;
};

const newExpressionsNamed = (sourceFile, name) => {
  const matches = [];
  const visit = (node) => {
    if (
      ts.isNewExpression(node) &&
      ts.isIdentifier(unwrapExpression(node.expression)) &&
      unwrapExpression(node.expression).text === name
    ) {
      matches.push(node);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return matches;
};

const ifConditionTexts = (sourceFile) => {
  const conditions = [];
  const visit = (node) => {
    if (ts.isIfStatement(node)) {
      conditions.push(compactSource(node.expression, sourceFile));
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return conditions;
};

const compactSource = (node, sourceFile) =>
  node.getText(sourceFile).replace(/\s+/gu, "");
const contractProgramSources = new Map([
  [APPROVED_FIREBASE_CLIENT, firebaseSource],
  ["vite.config.ts", viteSource],
]);
const contractProgram = createSourceProgram(contractProgramSources);
const syntacticSourceFiles = createSyntacticSourceFiles(sourceEntries);
syntacticSourceFiles.set(
  APPROVED_FIREBASE_CLIENT,
  contractProgram.sourceFiles.get(APPROVED_FIREBASE_CLIENT),
);
const firebaseSymbolSourceFiles = new Map([
  [
    APPROVED_FIREBASE_CLIENT,
    contractProgram.sourceFiles.get(APPROVED_FIREBASE_CLIENT),
  ],
]);
const firebaseProgramView = {
  ...contractProgram,
  sourceFiles: syntacticSourceFiles,
  symbolSourceFiles: firebaseSymbolSourceFiles,
};
const firebaseInventory = analyzeFirebaseInitializationInventory(
  sourceEntries,
  firebaseProgramView,
);
const appInitializer =
  validateFirebaseInitializationInventory(firebaseInventory);
const firebaseSourceFile = firebaseInventory.sourceFiles.get(
  APPROVED_FIREBASE_CLIENT,
);
const parseBindingCalls = callExpressionsNamed(
  firebaseSourceFile,
  "parseActiveFirebaseBindingMarker",
);
const boundaryCalls = callExpressionsNamed(
  firebaseSourceFile,
  "assertFirebaseEnvironmentBoundary",
);
assert.equal(parseBindingCalls.length, 1);
assert.equal(boundaryCalls.length, 1);
assert.ok(
  parseBindingCalls[0].getStart() < boundaryCalls[0].getStart() &&
    boundaryCalls[0].getStart() < appInitializer.node.getStart(),
  "binding parse and environment assertion must precede initializeApp",
);
assert.equal(
  compactSource(appInitializer.node.arguments[0], firebaseSourceFile),
  "activeFirebaseBinding?.config??firebaseConfig",
  "initializeApp must consume the parsed binding config directly",
);
const boundaryArgument = boundaryCalls[0].arguments[0];
assert.ok(ts.isObjectLiteralExpression(boundaryArgument));
const boundaryProperties = Object.fromEntries(
  boundaryArgument.properties
    .filter(ts.isPropertyAssignment)
    .map((property) => [
      property.name.getText(firebaseSourceFile),
      compactSource(property.initializer, firebaseSourceFile),
    ]),
);
assert.equal(
  boundaryProperties.config,
  "activeFirebaseBinding?.config??firebaseConfig",
);
assert.equal(boundaryProperties.environment, "runtimeEnvironment");
assert.equal(boundaryProperties.emulators, "emulatorTargets");

const singleVariable = (sourceFile, name) => {
  const declarations = variableDeclarationsNamed(sourceFile, name);
  assert.equal(declarations.length, 1, `${name} declaration must be unique`);
  assert.ok(declarations[0].initializer, `${name} must have an initializer`);
  return declarations[0];
};
assert.equal(
  compactSource(
    singleVariable(firebaseSourceFile, "normalizedExplicitEnvironment")
      .initializer,
    firebaseSourceFile,
  ),
  "import.meta.env.VITE_APP_ENV?.trim().toLowerCase()",
  "managed runtime classification must use the same normalized environment as Vite",
);
assert.equal(
  compactSource(
    singleVariable(firebaseSourceFile, "isNormalizedManagedFirebaseEnvironment")
      .initializer,
    firebaseSourceFile,
  ),
  'normalizedExplicitEnvironment==="production"||normalizedExplicitEnvironment==="staging"',
);
assert.equal(
  compactSource(
    singleVariable(firebaseSourceFile, "isManagedFirebaseBuild").initializer,
    firebaseSourceFile,
  ),
  "__W10P_ACTIVE_FIREBASE_CONFIG_MANAGED__",
);
assert.ok(
  ifConditionTexts(firebaseSourceFile).includes(
    "isManagedFirebaseBuild!==isNormalizedManagedFirebaseEnvironment",
  ),
  "the injected managed-build role must be checked against normalized VITE_APP_ENV",
);
const runtimeResolutionCalls = callExpressionsNamed(
  firebaseSourceFile,
  "resolveRuntimeEnvironment",
);
assert.equal(runtimeResolutionCalls.length, 1);
const runtimeResolutionInput = runtimeResolutionCalls[0].arguments[0];
assert.ok(ts.isObjectLiteralExpression(runtimeResolutionInput));
const explicitEnvironmentProperty = runtimeResolutionInput.properties.find(
  (property) =>
    ts.isPropertyAssignment(property) &&
    property.name.getText(firebaseSourceFile) === "explicitEnvironment",
);
assert.ok(ts.isPropertyAssignment(explicitEnvironmentProperty));
assert.equal(
  compactSource(explicitEnvironmentProperty.initializer, firebaseSourceFile),
  "normalizedExplicitEnvironment",
);
const getFunctionsConsumer = firebaseInventory.calls.find(
  (call) => call.token === "getFunctions",
);
assert.equal(
  compactSource(getFunctionsConsumer.node.arguments[1], firebaseSourceFile),
  'activeFirebaseBinding?.functionsRegion??(import.meta.env.VITE_FIREBASE_FUNCTIONS_REGION||"asia-northeast3")',
  "local/test Functions fallback must preserve empty-string fallback semantics",
);
assert.equal(
  compactSource(
    singleVariable(firebaseSourceFile, "emulatorTargets").initializer,
    firebaseSourceFile,
  ),
  "activeFirebaseBinding?.emulators??fallbackEmulatorTargets",
);
const recaptchaProviders = newExpressionsNamed(
  firebaseSourceFile,
  "ReCaptchaEnterpriseProvider",
);
assert.equal(recaptchaProviders.length, 1);
assert.equal(
  compactSource(recaptchaProviders[0].arguments[0], firebaseSourceFile),
  "activeFirebaseBinding?.appCheckSiteKey??appCheckSiteKey",
);

const exactObjectProperties = (expression, expectedNames, description) => {
  const current = unwrapExpression(expression);
  assert.ok(
    ts.isObjectLiteralExpression(current),
    `${description} must be an object literal`,
  );
  assert.ok(
    current.properties.every(
      (property) =>
        ts.isPropertyAssignment(property) && ts.isIdentifier(property.name),
    ),
    `${description} must contain only direct identifier property assignments`,
  );
  assert.deepEqual(
    current.properties.map((property) => property.name.text),
    expectedNames,
    `${description} must preserve its exact key set and canonical field order`,
  );
  return new Map(
    current.properties.map((property) => [property.name.text, property]),
  );
};

const assertBoundIdentifier = (expression, checker, symbol, description) => {
  const current = unwrapExpression(expression);
  assert.ok(
    ts.isIdentifier(current) && checker.getSymbolAtLocation(current) === symbol,
    `${description} must reference its exact source binding`,
  );
};

const assertBoundPropertyAccess = (
  expression,
  checker,
  receiverSymbol,
  expectedProperty,
  description,
) => {
  const current = unwrapExpression(expression);
  assert.ok(
    ts.isPropertyAccessExpression(current) &&
      current.name.text === expectedProperty &&
      ts.isIdentifier(unwrapExpression(current.expression)) &&
      checker.getSymbolAtLocation(unwrapExpression(current.expression)) ===
        receiverSymbol,
    `${description} must be bound directly to ${expectedProperty}`,
  );
};

const jsonStringifyArgument = (expression, description) => {
  const current = unwrapExpression(expression);
  assert.ok(
    ts.isCallExpression(current) &&
      current.arguments.length === 1 &&
      ts.isPropertyAccessExpression(unwrapExpression(current.expression)) &&
      ts.isIdentifier(unwrapExpression(current.expression).expression) &&
      unwrapExpression(current.expression).expression.text === "JSON" &&
      unwrapExpression(current.expression).name.text === "stringify",
    `${description} must be passed through direct JSON.stringify`,
  );
  return current.arguments[0];
};

const validateViteMarkerContract = (
  sources,
  file = "vite.config.ts",
  prepared = null,
) => {
  const analysis = prepared ?? createSourceProgram(sources);
  const sourceFile = analysis.sourceFiles.get(file);
  assert.ok(sourceFile, `${file} is missing`);

  const declarationWithSymbol = (name) => {
    const declaration = singleVariable(sourceFile, name);
    const symbol = analysis.checker.getSymbolAtLocation(declaration.name);
    assert.ok(symbol, `${name} binding symbol is missing`);
    return { declaration, symbol };
  };
  const env = declarationWithSymbol("env");
  const firebaseConfigBinding = declarationWithSymbol("firebaseConfig");
  const normalizedEnvironmentBinding = declarationWithSymbol(
    "normalizedEnvironment",
  );
  const normalizedProjectRoleBinding = declarationWithSymbol(
    "normalizedProjectRole",
  );
  const managedBuildBinding = declarationWithSymbol("isManagedFirebaseBuild");
  const emulatorsBinding = declarationWithSymbol("activeFirebaseEmulators");
  const markerBinding = declarationWithSymbol("activeFirebaseBindingMarker");

  const markerValueBindings = valueBindingsNamed(
    sourceFile,
    "activeFirebaseBindingMarker",
  );
  assert.equal(
    markerValueBindings.length,
    1,
    "activeFirebaseBindingMarker must be the unique unshadowed value binding",
  );
  assert.equal(markerValueBindings[0].declaration, markerBinding.declaration);
  assert.ok(
    (markerBinding.declaration.parent.flags & ts.NodeFlags.Const) !== 0,
    "activeFirebaseBindingMarker must be declared const",
  );
  assert.equal(
    valueBindingsNamed(sourceFile, "JSON").length,
    0,
    "the global JSON.stringify binding must not be shadowed",
  );

  const markerImports = [];
  const visitImports = (node) => {
    if (
      ts.isImportSpecifier(node) &&
      importedName(node) === "createActiveFirebaseBindingMarker"
    ) {
      const importDeclaration = node.parent.parent.parent;
      if (
        ts.isImportDeclaration(importDeclaration) &&
        stringLiteralValue(importDeclaration.moduleSpecifier) ===
          "./src/lib/firebaseActiveBinding"
      ) {
        markerImports.push(node);
      }
    }
    ts.forEachChild(node, visitImports);
  };
  visitImports(sourceFile);
  assert.equal(
    markerImports.length,
    1,
    "createActiveFirebaseBindingMarker import must be unique and exact",
  );
  const markerImportSymbol = analysis.checker.getSymbolAtLocation(
    markerImports[0].name,
  );
  assert.ok(markerImportSymbol, "marker creator import symbol is missing");

  const markerCreationCalls = [];
  const visitMarkerCalls = (node) => {
    if (ts.isCallExpression(node)) {
      const callee = unwrapExpression(node.expression);
      if (
        ts.isIdentifier(callee) &&
        analysis.checker.getSymbolAtLocation(callee) === markerImportSymbol
      ) {
        markerCreationCalls.push(node);
      }
    }
    ts.forEachChild(node, visitMarkerCalls);
  };
  visitMarkerCalls(sourceFile);
  assert.equal(
    markerCreationCalls.length,
    1,
    "createActiveFirebaseBindingMarker call must be unique",
  );

  const markerInitializer = unwrapExpression(
    markerBinding.declaration.initializer,
  );
  assert.ok(
    ts.isConditionalExpression(markerInitializer),
    "activeFirebaseBindingMarker initializer must be the exact managed-build conditional",
  );
  assertBoundIdentifier(
    markerInitializer.condition,
    analysis.checker,
    managedBuildBinding.symbol,
    "marker condition",
  );
  assert.equal(
    staticStringValue(markerInitializer.whenFalse),
    "",
    "unmanaged builds must inject the empty marker",
  );
  const managedMarkerCall = unwrapExpression(markerInitializer.whenTrue);
  assert.ok(
    managedMarkerCall === markerCreationCalls[0],
    "the managed marker branch must be the unique marker creator call",
  );
  assert.ok(
    ts.isCallExpression(managedMarkerCall) &&
      managedMarkerCall.arguments.length === 1 &&
      ts.isIdentifier(unwrapExpression(managedMarkerCall.expression)) &&
      analysis.checker.getSymbolAtLocation(
        unwrapExpression(managedMarkerCall.expression),
      ) === markerImportSymbol,
    "the managed marker branch must call the imported creator directly",
  );
  assertExactSymbolReferences(
    analysis,
    markerImportSymbol,
    [markerImports[0].name, unwrapExpression(managedMarkerCall.expression)],
    "createActiveFirebaseBindingMarker",
  );

  const markerProperties = exactObjectProperties(
    managedMarkerCall.arguments[0],
    [
      "config",
      "appCheckSiteKey",
      "functionsRegion",
      "environment",
      "projectRole",
      "emulators",
    ],
    "active marker input",
  );
  const firebaseConfigProperties = exactObjectProperties(
    markerProperties.get("config").initializer,
    [
      "apiKey",
      "authDomain",
      "projectId",
      "storageBucket",
      "messagingSenderId",
      "appId",
    ],
    "active marker Firebase config",
  );
  for (const key of firebaseConfigProperties.keys()) {
    assertBoundPropertyAccess(
      firebaseConfigProperties.get(key).initializer,
      analysis.checker,
      firebaseConfigBinding.symbol,
      key,
      `active marker config.${key}`,
    );
  }
  assertBoundPropertyAccess(
    markerProperties.get("appCheckSiteKey").initializer,
    analysis.checker,
    env.symbol,
    "VITE_FIREBASE_APPCHECK_SITE_KEY",
    "active marker App Check site key",
  );
  assertBoundPropertyAccess(
    markerProperties.get("functionsRegion").initializer,
    analysis.checker,
    env.symbol,
    "VITE_FIREBASE_FUNCTIONS_REGION",
    "active marker Functions region",
  );
  assertBoundIdentifier(
    markerProperties.get("environment").initializer,
    analysis.checker,
    normalizedEnvironmentBinding.symbol,
    "active marker environment",
  );
  assertBoundIdentifier(
    markerProperties.get("projectRole").initializer,
    analysis.checker,
    normalizedProjectRoleBinding.symbol,
    "active marker project role",
  );
  assertBoundIdentifier(
    markerProperties.get("emulators").initializer,
    analysis.checker,
    emulatorsBinding.symbol,
    "active marker emulator flags",
  );

  const injectedMarkerDefines = [];
  const injectedManagedDefines = [];
  const visitDefines = (node) => {
    if (ts.isPropertyAssignment(node)) {
      const name = node.name.getText(sourceFile);
      if (name === "__W10P_ACTIVE_FIREBASE_CONFIG__") {
        injectedMarkerDefines.push(node);
      } else if (name === "__W10P_ACTIVE_FIREBASE_CONFIG_MANAGED__") {
        injectedManagedDefines.push(node);
      }
    }
    ts.forEachChild(node, visitDefines);
  };
  visitDefines(sourceFile);
  assert.equal(injectedMarkerDefines.length, 1, "marker define must be unique");
  assert.equal(
    injectedManagedDefines.length,
    1,
    "managed-build define must be unique",
  );
  const markerDefineArgument = jsonStringifyArgument(
    injectedMarkerDefines[0].initializer,
    "marker define",
  );
  assertBoundIdentifier(
    markerDefineArgument,
    analysis.checker,
    markerBinding.symbol,
    "marker define",
  );
  const managedDefineArgument = jsonStringifyArgument(
    injectedManagedDefines[0].initializer,
    "managed-build define",
  );
  assertBoundIdentifier(
    managedDefineArgument,
    analysis.checker,
    managedBuildBinding.symbol,
    "managed-build define",
  );
  assertExactSymbolReferences(
    analysis,
    markerBinding.symbol,
    [markerBinding.declaration.name, unwrapExpression(markerDefineArgument)],
    "activeFirebaseBindingMarker",
  );

  return { markerCreationCall: managedMarkerCall, sourceFile };
};

const viteContractSources = new Map([["vite.config.ts", viteSource]]);
const viteProgramView = {
  ...contractProgram,
  sourceFiles: new Map([
    ["vite.config.ts", contractProgram.sourceFiles.get("vite.config.ts")],
  ]),
};
const { markerCreationCall, sourceFile: viteSourceFile } =
  validateViteMarkerContract(
    viteContractSources,
    "vite.config.ts",
    viteProgramView,
  );
assert.equal(
  compactSource(
    singleVariable(viteSourceFile, "normalizedEnvironment").initializer,
    viteSourceFile,
  ),
  "env.VITE_APP_ENV?.trim().toLowerCase()",
);
assert.equal(
  compactSource(
    singleVariable(viteSourceFile, "isManagedFirebaseBuild").initializer,
    viteSourceFile,
  ),
  'normalizedEnvironment==="production"||normalizedEnvironment==="staging"',
);
const buildBoundaryCalls = callExpressionsNamed(
  viteSourceFile,
  "assertFirebaseBuildBoundary",
);
assert.equal(buildBoundaryCalls.length, 1);
assert.ok(
  buildBoundaryCalls[0].getStart() < markerCreationCall.getStart(),
  "the build boundary must run before marker creation",
);

const validInventoryFixture = `
  import { initializeApp as bootApp } from "firebase/app";
  import { initializeAppCheck } from "firebase/app-check";
  import { getAuth } from "firebase/auth";
  import { getFirestore } from "firebase/firestore";
  import { getFunctions } from "firebase/functions";
  import { getStorage } from "firebase/storage";
  const app = bootApp(activeFirebaseBinding.config);
  initializeAppCheck(app, {});
  getAuth(app);
  getFirestore(app);
  getFunctions(app);
  getStorage(app);
`;
const validFixtureSources = new Map([
  [APPROVED_FIREBASE_CLIENT, validInventoryFixture],
]);
const inventoryFixtureScenarios = [
  {
    label: "valid Firebase inventory",
    pattern: null,
    sources: validFixtureSources,
  },
];
const expectInventoryRejected = (label, sources, pattern) => {
  inventoryFixtureScenarios.push({ label, pattern, sources });
};
expectInventoryRejected(
  "aliased dead secondary initializeApp",
  new Map([
    ...validFixtureSources,
    [
      "src/rogueAlias.ts",
      `import { initializeApp as rogueBoot } from "firebase/app"; if (false) rogueBoot({});`,
    ],
  ]),
  /approved Firebase client|unique/u,
);
expectInventoryRejected(
  "namespace secondary initializeApp",
  new Map([
    ...validFixtureSources,
    [
      "src/rogueNamespace.ts",
      `import * as firebaseApp from "firebase/app"; firebaseApp.initializeApp({});`,
    ],
  ]),
  /namespace|unique/u,
);
expectInventoryRejected(
  "compat secondary initializeApp",
  new Map([
    ...validFixtureSources,
    [
      "src/rogueCompat.ts",
      `import firebase from "firebase/compat/app"; firebase.initializeApp({});`,
    ],
  ]),
  /compat|unique/u,
);
expectInventoryRejected(
  "dynamic secondary initializeApp",
  new Map([
    ...validFixtureSources,
    [
      "src/rogueDynamic.ts",
      `async function rogue() { const { initializeApp: boot } = await import("firebase/app"); boot({}); }`,
    ],
  ]),
  /dynamic|unique/u,
);
expectInventoryRejected(
  "dead approved initializer path",
  new Map([
    [
      APPROVED_FIREBASE_CLIENT,
      validInventoryFixture.replace(
        "const app = bootApp(activeFirebaseBinding.config);",
        "if (false) { const app = bootApp(activeFirebaseBinding.config); }",
      ),
    ],
  ]),
  /live top-level/u,
);
expectInventoryRejected(
  "secondary getAuth consumer",
  new Map([
    ...validFixtureSources,
    [
      "src/rogueAuth.ts",
      `import { getAuth as otherAuth } from "firebase/auth"; otherAuth(otherApp);`,
    ],
  ]),
  /approved Firebase client|unique/u,
);
expectInventoryRejected(
  "mutable app declaration",
  new Map([
    [
      APPROVED_FIREBASE_CLIENT,
      validInventoryFixture.replace(
        "const app = bootApp(activeFirebaseBinding.config);",
        "let app = bootApp(activeFirebaseBinding.config);",
      ),
    ],
  ]),
  /top-level const/u,
);
expectInventoryRejected(
  "app reassignment",
  new Map([
    [
      APPROVED_FIREBASE_CLIENT,
      validInventoryFixture.replace(
        "const app = bootApp(activeFirebaseBinding.config);",
        "const app = bootApp(activeFirebaseBinding.config); app = otherApp;",
      ),
    ],
  ]),
  /reassigned|written/u,
);
expectInventoryRejected(
  "app destructuring write",
  new Map([
    [
      APPROVED_FIREBASE_CLIENT,
      validInventoryFixture.replace(
        "const app = bootApp(activeFirebaseBinding.config);",
        "const app = bootApp(activeFirebaseBinding.config); [app] = [otherApp];",
      ),
    ],
  ]),
  /reassigned|destructured|written/u,
);
expectInventoryRejected(
  "shadowed app binding",
  new Map([
    [
      APPROVED_FIREBASE_CLIENT,
      `${validInventoryFixture}\nfunction shadowApp(app) { return app; }`,
    ],
  ]),
  /unshadowed app value binding/u,
);
expectInventoryRejected(
  "initializeApp object-property escape",
  new Map([
    [
      APPROVED_FIREBASE_CLIENT,
      `${validInventoryFixture
        .replace("initializeApp as bootApp", "initializeApp")
        .replace(
          "bootApp(activeFirebaseBinding.config)",
          "initializeApp(activeFirebaseBinding.config)",
        )}\n({ run: initializeApp }).run({});`,
    ],
  ]),
  /unapproved reference|alias/u,
);
expectInventoryRejected(
  "Firebase service alias escape",
  new Map([
    [
      APPROVED_FIREBASE_CLIENT,
      `${validInventoryFixture}\nconst authAlias = getAuth; void authAlias;`,
    ],
  ]),
  /unapproved reference|alias/u,
);
expectInventoryRejected(
  "executable JavaScript source",
  new Map([...validFixtureSources, ["src/rogue.js", "void 0;"]]),
  /executable JavaScript/u,
);

const preparedScenarioViews = (scenarios, suiteName) => {
  const suiteSources = new Map();
  const logicalToPhysicalByScenario = [];
  scenarios.forEach((scenario, index) => {
    const logicalToPhysical = new Map();
    for (const [logicalFile, source] of scenario.sources) {
      const physicalFile = `__verification_fixtures__/${suiteName}-${index}/${logicalFile}`;
      suiteSources.set(physicalFile, source);
      logicalToPhysical.set(logicalFile, physicalFile);
    }
    logicalToPhysicalByScenario.push(logicalToPhysical);
  });
  const suiteProgram = createSourceProgram(suiteSources);
  return scenarios.map((scenario, index) => ({
    prepared: {
      ...suiteProgram,
      sourceFiles: new Map(
        [...logicalToPhysicalByScenario[index]].map(
          ([logicalFile, physicalFile]) => [
            logicalFile,
            suiteProgram.sourceFiles.get(physicalFile),
          ],
        ),
      ),
    },
    scenario,
  }));
};

for (const { prepared, scenario } of preparedScenarioViews(
  inventoryFixtureScenarios,
  "firebase-inventory",
)) {
  const validate = () =>
    validateFirebaseInitializationInventory(
      analyzeFirebaseInitializationInventory(new Map(), prepared),
    );
  if (scenario.pattern) {
    assert.throws(validate, scenario.pattern, scenario.label);
  } else {
    validate();
  }
}

const viteMarkerInputFixture = `{
  config: {
    apiKey: firebaseConfig.apiKey,
    authDomain: firebaseConfig.authDomain,
    projectId: firebaseConfig.projectId,
    storageBucket: firebaseConfig.storageBucket,
    messagingSenderId: firebaseConfig.messagingSenderId,
    appId: firebaseConfig.appId,
  },
  appCheckSiteKey: env.VITE_FIREBASE_APPCHECK_SITE_KEY,
  functionsRegion: env.VITE_FIREBASE_FUNCTIONS_REGION,
  environment: normalizedEnvironment,
  projectRole: normalizedProjectRole,
  emulators: activeFirebaseEmulators,
}`;
const viteMarkerFixture = ({ markerDeclarations, markerDefineReference }) => `
  import { createActiveFirebaseBindingMarker } from "./src/lib/firebaseActiveBinding";
  const env = {
    VITE_FIREBASE_APPCHECK_SITE_KEY: "site-key",
    VITE_FIREBASE_FUNCTIONS_REGION: "asia-northeast3",
  };
  const firebaseConfig = {
    apiKey: "api-key",
    authDomain: "example.firebaseapp.com",
    projectId: "example",
    storageBucket: "example.appspot.com",
    messagingSenderId: "123",
    appId: "1:123:web:abc",
  };
  const normalizedEnvironment = "staging";
  const normalizedProjectRole = "staging";
  const isManagedFirebaseBuild = true;
  const activeFirebaseEmulators = {
    auth: false,
    firestore: false,
    functions: false,
    storage: false,
  };
  ${markerDeclarations}
  const result = {
    define: {
      __W10P_ACTIVE_FIREBASE_CONFIG__: JSON.stringify(${markerDefineReference}),
      __W10P_ACTIVE_FIREBASE_CONFIG_MANAGED__: JSON.stringify(isManagedFirebaseBuild),
    },
  };
  void result;
`;
const validViteMarkerFixture = viteMarkerFixture({
  markerDeclarations: `const activeFirebaseBindingMarker = isManagedFirebaseBuild
    ? createActiveFirebaseBindingMarker(${viteMarkerInputFixture})
    : "";`,
  markerDefineReference: "activeFirebaseBindingMarker",
});
validateViteMarkerContract(
  new Map([["vite.config.ts", validViteMarkerFixture]]),
);
const expectViteMarkerRejected = (label, source, pattern) => {
  assert.throws(
    () => validateViteMarkerContract(new Map([["vite.config.ts", source]])),
    pattern,
    label,
  );
};
expectViteMarkerRejected(
  "inert marker creator call",
  viteMarkerFixture({
    markerDeclarations: `const activeFirebaseBindingMarker = isManagedFirebaseBuild ? "" : "";
      const inertMarker = createActiveFirebaseBindingMarker(${viteMarkerInputFixture});
      void inertMarker;`,
    markerDefineReference: "activeFirebaseBindingMarker",
  }),
  /managed marker branch|marker creator call/u,
);
expectViteMarkerRejected(
  "rogue marker define alias",
  viteMarkerFixture({
    markerDeclarations: `const activeFirebaseBindingMarker = isManagedFirebaseBuild
      ? createActiveFirebaseBindingMarker(${viteMarkerInputFixture})
      : "";
      const rogueMarker = activeFirebaseBindingMarker;`,
    markerDefineReference: "rogueMarker",
  }),
  /marker define|unapproved symbol reference/u,
);

const transpiled = ts.transpileModule(bindingSource, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
  },
  fileName: bindingSourceUrl.pathname,
}).outputText;
const moduleUrl = `data:text/javascript;base64,${Buffer.from(transpiled).toString("base64")}`;
const {
  createActiveFirebaseBindingMarker,
  getActiveFirebaseBindingMarkerPrefix,
  parseActiveFirebaseBindingMarker,
} = await import(moduleUrl);

const stagingInput = {
  config: {
    apiKey: "AIzaSyW10pStagingBindingContract123456",
    authDomain: "westory-staging-177587430482.firebaseapp.com",
    projectId: "westory-staging-177587430482",
    storageBucket: "westory-staging-177587430482.firebasestorage.app",
    messagingSenderId: "894916304910",
    appId: "1:894916304910:web:bd8c8a9e3ed8bd1620dc5f",
  },
  appCheckSiteKey: "6LcW10pStagingAppCheckContract123456",
  functionsRegion: "asia-northeast3",
  environment: "staging",
  projectRole: "staging",
  emulators: {
    auth: false,
    firestore: false,
    functions: false,
    storage: false,
  },
};
const productionInput = {
  config: {
    apiKey: "AIzaSyW10pProductionBindingContract123",
    authDomain: "history-quiz-yongsin.firebaseapp.com",
    projectId: "history-quiz-yongsin",
    storageBucket: "history-quiz-yongsin.firebasestorage.app",
    messagingSenderId: "177587430482",
    appId: "1:177587430482:web:d79cc145c11e335cc3ab8b",
  },
  appCheckSiteKey: "6LcW10pProductionAppCheckContract123",
  functionsRegion: "asia-northeast3",
  environment: "production",
  projectRole: "production",
  emulators: {
    auth: false,
    firestore: false,
    functions: false,
    storage: false,
  },
};

const prefix = getActiveFirebaseBindingMarkerPrefix();
assert.equal(prefix, "w10p-active-firebase-config-v1:");
const marker = createActiveFirebaseBindingMarker(stagingInput);
assert.equal(marker, createActiveFirebaseBindingMarker(stagingInput));
assert.ok(marker.startsWith(prefix));
assert.equal(marker.indexOf(prefix, prefix.length), -1);
assert.doesNotMatch(marker, /[^\u0020-\u007e]/u);
assert.match(marker.slice(prefix.length), /^[A-Za-z0-9_-]+$/u);
assert.doesNotMatch(marker.slice(prefix.length), /=/u);

const binding = parseActiveFirebaseBindingMarker(marker);
assert.deepEqual(binding, stagingInput);
assert.deepEqual(Object.keys(binding), [
  "config",
  "appCheckSiteKey",
  "functionsRegion",
  "environment",
  "projectRole",
  "emulators",
]);
assert.deepEqual(Object.keys(binding.config), [
  "apiKey",
  "authDomain",
  "projectId",
  "storageBucket",
  "messagingSenderId",
  "appId",
]);
assert.equal(
  Object.prototype.hasOwnProperty.call(binding.config, "measurementId"),
  false,
);
assert.deepEqual(Object.keys(binding.emulators), [
  "auth",
  "firestore",
  "functions",
  "storage",
]);
assert.ok(Object.isFrozen(binding));
assert.ok(Object.isFrozen(binding.config));
assert.ok(Object.isFrozen(binding.emulators));
assert.throws(() => {
  binding.config.projectId = "mutated-project";
}, TypeError);
assert.throws(() => {
  binding.emulators.auth = true;
}, TypeError);

const productionMarker = createActiveFirebaseBindingMarker(productionInput);
const customDomainBinding = parseActiveFirebaseBindingMarker(productionMarker, {
  productionAuthDomainOverride: "www.westory.kr",
});
assert.equal(customDomainBinding.config.authDomain, "www.westory.kr");
assert.equal(
  customDomainBinding.config.projectId,
  productionInput.config.projectId,
);
assert.ok(Object.isFrozen(customDomainBinding));
assert.ok(Object.isFrozen(customDomainBinding.config));
assert.throws(
  () =>
    parseActiveFirebaseBindingMarker(marker, {
      productionAuthDomainOverride: "www.westory.kr",
    }),
  /Production authDomain override/u,
);
assert.throws(
  () =>
    parseActiveFirebaseBindingMarker(productionMarker, {
      productionAuthDomainOverride: "staging.westory.kr",
    }),
  /Production authDomain override/u,
);

const decodedStaging = JSON.parse(
  Buffer.from(marker.slice(prefix.length), "base64url").toString("utf8"),
);
const markerFor = (value) =>
  `${prefix}${Buffer.from(JSON.stringify(value)).toString("base64url")}`;
const clone = (value) => structuredClone(value);
const expectRejected = (label, value, pattern) => {
  assert.throws(
    () => parseActiveFirebaseBindingMarker(markerFor(value)),
    pattern,
    label,
  );
};

for (const configKey of [
  "apiKey",
  "authDomain",
  "projectId",
  "storageBucket",
  "messagingSenderId",
  "appId",
]) {
  const missing = clone(decodedStaging);
  delete missing.config[configKey];
  expectRejected(
    `missing config.${configKey}`,
    missing,
    /exactly these own keys/u,
  );

  const wrongType = clone(decodedStaging);
  wrongType.config[configKey] = 17;
  expectRejected(`wrong config.${configKey} type`, wrongType, /invalid value/u);

  const emptyValue = clone(decodedStaging);
  emptyValue.config[configKey] = "";
  expectRejected(`empty config.${configKey}`, emptyValue, /invalid value/u);
}

const measurementTamper = clone(decodedStaging);
measurementTamper.config.measurementId = "G-W10PBOUNDARY";
expectRejected(
  "measurementId own-property tamper",
  measurementTamper,
  /exactly these own keys/u,
);

const identityTamper = clone(decodedStaging);
identityTamper.config.projectId = "westory-staging-177587430483";
expectRejected(
  "staging identity tamper",
  identityTamper,
  /approved Firebase app identity/u,
);

for (const siteKeyTamper of ["", " short-site-key ", 19, null]) {
  const tampered = clone(decodedStaging);
  tampered.appCheckSiteKey = siteKeyTamper;
  expectRejected("App Check site-key tamper", tampered, /invalid value/u);
}

for (const regionTamper of ["us-central1", "asia-northeast3 ", 3, null]) {
  const tampered = clone(decodedStaging);
  tampered.functionsRegion = regionTamper;
  expectRejected("Functions region tamper", tampered, /functionsRegion/u);
}

for (const emulator of ["auth", "firestore", "functions", "storage"]) {
  const wrongType = clone(decodedStaging);
  wrongType.emulators[emulator] = "false";
  expectRejected(
    `emulators.${emulator} type tamper`,
    wrongType,
    /must be a boolean/u,
  );

  const enabled = clone(decodedStaging);
  enabled.emulators[emulator] = true;
  expectRejected(
    `emulators.${emulator} value tamper`,
    enabled,
    /cannot enable/u,
  );
}

const roleTamper = clone(decodedStaging);
roleTamper.projectRole = "production";
expectRejected(
  "environment/projectRole identity tamper",
  roleTamper,
  /must identify the same/u,
);

const extraTopLevelKey = clone(decodedStaging);
extraTopLevelKey.unexpected = true;
expectRejected(
  "top-level key tamper",
  extraTopLevelKey,
  /exactly these own keys/u,
);

const nonCanonicalOrder = {
  environment: decodedStaging.environment,
  config: decodedStaging.config,
  appCheckSiteKey: decodedStaging.appCheckSiteKey,
  functionsRegion: decodedStaging.functionsRegion,
  projectRole: decodedStaging.projectRole,
  emulators: decodedStaging.emulators,
};
expectRejected(
  "non-canonical key order",
  nonCanonicalOrder,
  /canonical key order or encoding/u,
);

for (const malformedMarker of [
  "",
  "w10p-active-firebase-config-v1:",
  "w10p-active-firebase-config-v1:%",
  `${prefix}${Buffer.from("not-json").toString("base64url")}`,
  `${prefix}${Buffer.from("{}").toString("base64url")}${prefix}`,
  `x${marker}`,
]) {
  assert.throws(
    () => parseActiveFirebaseBindingMarker(malformedMarker),
    /Active Firebase/u,
  );
}

console.log(
  `W10P active Firebase binding: PASS (${sourceEntries.size} source files inventoried, canonical marker, frozen direct-use binding, rogue/dead initializer fixtures rejected)`,
);
