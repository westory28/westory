const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const ts = require('../../node_modules/typescript');
const source = fs.readFileSync(path.join(__dirname, '../../src/lib/quizAnalysis.ts'), 'utf8').replace(/\r\n/g, '\n');
const hash = crypto.createHash('sha256').update(source).digest('hex');
const output = `// Generated from src/lib/quizAnalysis.ts. Do not edit.\n// source-sha256: ${hash}\n` + ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, removeComments: false },
}).outputText;
const target = path.join(__dirname, '../quizClassAnalysisCore.cjs');
if (process.argv.includes('--check')) {
  if (fs.readFileSync(target, 'utf8').replace(/\r\n/g, '\n') !== output.replace(/\r\n/g, '\n')) {
    throw new Error('Quiz class analysis core is stale. Run node functions/scripts/generate-quiz-class-analysis-core.cjs');
  }
} else fs.writeFileSync(target, output);
