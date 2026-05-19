import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const compromisedPackages = new Map(
  Object.entries({
    "@tanstack/arktype-adapter": ["1.166.12", "1.166.15"],
    "@tanstack/eslint-plugin-router": ["1.161.9", "1.161.12"],
    "@tanstack/eslint-plugin-start": ["0.0.4", "0.0.7"],
    "@tanstack/history": ["1.161.9", "1.161.12"],
    "@tanstack/nitro-v2-vite-plugin": ["1.154.12", "1.154.15"],
    "@tanstack/react-router": ["1.169.5", "1.169.8"],
    "@tanstack/react-router-devtools": ["1.166.16", "1.166.19"],
    "@tanstack/react-router-ssr-query": ["1.166.15", "1.166.18"],
    "@tanstack/react-start": ["1.167.68", "1.167.71"],
    "@tanstack/react-start-client": ["1.166.51", "1.166.54"],
    "@tanstack/react-start-rsc": ["0.0.47", "0.0.50"],
    "@tanstack/react-start-server": ["1.166.55", "1.166.58"],
    "@tanstack/router-cli": ["1.166.46", "1.166.49"],
    "@tanstack/router-core": ["1.169.5", "1.169.8"],
    "@tanstack/router-devtools": ["1.166.16", "1.166.19"],
    "@tanstack/router-devtools-core": ["1.167.6", "1.167.9"],
    "@tanstack/router-generator": ["1.166.45", "1.166.48"],
    "@tanstack/router-plugin": ["1.167.38", "1.167.41"],
    "@tanstack/router-ssr-query-core": ["1.168.3", "1.168.6"],
    "@tanstack/router-utils": ["1.161.11", "1.161.14"],
    "@tanstack/router-vite-plugin": ["1.166.53", "1.166.56"],
    "@tanstack/solid-router": ["1.169.5", "1.169.8"],
    "@tanstack/solid-router-devtools": ["1.166.16", "1.166.19"],
    "@tanstack/solid-router-ssr-query": ["1.166.15", "1.166.18"],
    "@tanstack/solid-start": ["1.167.65", "1.167.68"],
    "@tanstack/solid-start-client": ["1.166.50", "1.166.53"],
    "@tanstack/solid-start-server": ["1.166.54", "1.166.57"],
    "@tanstack/start-client-core": ["1.168.5", "1.168.8"],
    "@tanstack/start-fn-stubs": ["1.161.9", "1.161.12"],
    "@tanstack/start-plugin-core": ["1.169.23", "1.169.26"],
    "@tanstack/start-server-core": ["1.167.33", "1.167.36"],
    "@tanstack/start-static-server-functions": ["1.166.44", "1.166.47"],
    "@tanstack/start-storage-context": ["1.166.38", "1.166.41"],
    "@tanstack/valibot-adapter": ["1.166.12", "1.166.15"],
    "@tanstack/virtual-file-routes": ["1.161.10", "1.161.13"],
    "@tanstack/vue-router": ["1.169.5", "1.169.8"],
    "@tanstack/vue-router-devtools": ["1.166.16", "1.166.19"],
    "@tanstack/vue-router-ssr-query": ["1.166.15", "1.166.18"],
    "@tanstack/vue-start": ["1.167.61", "1.167.64"],
    "@tanstack/vue-start-client": ["1.166.46", "1.166.49"],
    "@tanstack/vue-start-server": ["1.166.50", "1.166.53"],
    "@tanstack/zod-adapter": ["1.166.12", "1.166.15"],
    "@opensearch-project/opensearch": ["3.5.3", "3.6.2", "3.7.0", "3.8.0"],
    "@squawk/mcp": ["0.9.5"],
    "@squawk/weather": ["0.5.10"],
    "@squawk/flightplan": ["0.5.6"],
  }).map(([name, versions]) => [name, new Set(versions)]),
);

const indicators = [
  "@tanstack/setup",
  "github:tanstack/router#79ac49eedf774dd4b0cfa308722bc463cfe5885c",
  "router_init.js",
  "tanstack_runner.js",
  "filev2.getsession.org",
  "seed1.getsession.org",
  "seed2.getsession.org",
  "seed3.getsession.org",
  "litter.catbox.moe/h8nc9u.js",
  "litter.catbox.moe/7rrc6l.mjs",
  "git-tanstack.com/transformers.pyz",
  "83.142.209.194",
  "transformers.pyz",
  "pgmonitor.py",
  "pgsql-monitor.service",
];

const root = process.cwd();
const findings = [];

function readText(relativePath) {
  const absolutePath = join(root, relativePath);
  if (!existsSync(absolutePath)) {
    return null;
  }
  return readFileSync(absolutePath, "utf8");
}

function scanText(relativePath) {
  const text = readText(relativePath);
  if (!text) {
    return;
  }

  for (const indicator of indicators) {
    if (text.includes(indicator)) {
      findings.push(`${relativePath}: known supply-chain IOC found: ${indicator}`);
    }
  }
}

function packageNameFromLockPath(lockPath) {
  const marker = "node_modules/";
  const index = lockPath.lastIndexOf(marker);
  return index === -1 ? null : lockPath.slice(index + marker.length);
}

function scanLockfile(relativePath) {
  const text = readText(relativePath);
  if (!text) {
    return;
  }

  scanText(relativePath);

  let lockfile;
  try {
    lockfile = JSON.parse(text);
  } catch (error) {
    findings.push(`${relativePath}: could not parse JSON lockfile: ${error.message}`);
    return;
  }

  for (const [lockPath, metadata] of Object.entries(lockfile.packages ?? {})) {
    const name = metadata?.name ?? packageNameFromLockPath(lockPath);
    const version = metadata?.version;
    if (!name || !version) {
      continue;
    }

    if (compromisedPackages.get(name)?.has(version)) {
      findings.push(`${relativePath}: compromised package pinned: ${name}@${version}`);
    }
  }
}

function workflowFiles() {
  const workflowDir = join(root, ".github", "workflows");
  if (!existsSync(workflowDir)) {
    return [];
  }

  return readdirSync(workflowDir)
    .filter((name) => /\.(ya?ml)$/i.test(name))
    .map((name) => `.github/workflows/${name}`);
}

for (const relativePath of ["package.json", "functions/package.json"]) {
  scanText(relativePath);
}

for (const relativePath of ["package-lock.json", "functions/package-lock.json"]) {
  scanLockfile(relativePath);
}

for (const relativePath of workflowFiles()) {
  scanText(relativePath);
}

if (findings.length > 0) {
  console.error("Supply-chain IOC check failed:");
  for (const finding of findings) {
    console.error(`- ${finding}`);
  }
  process.exit(1);
}

console.log("Supply-chain IOC check passed.");
