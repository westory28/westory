import { execFileSync } from "node:child_process";
const configUrl = new URL("../vercel.mjs", import.meta.url);
const script = `import(${JSON.stringify(configUrl.href)}).then(({ config }) => process.stdout.write(JSON.stringify(config)))`;

const loadConfig = (projectId, vercelEnvironment = "") => {
  const env = { ...process.env };
  if (projectId) env.VITE_FIREBASE_PROJECT_ID = projectId;
  else delete env.VITE_FIREBASE_PROJECT_ID;
  if (vercelEnvironment) env.VERCEL_ENV = vercelEnvironment;
  else delete env.VERCEL_ENV;

  return JSON.parse(
    execFileSync(process.execPath, ["--input-type=module", "--eval", script], {
      encoding: "utf8",
      env,
      stdio: ["ignore", "pipe", "pipe"],
    }),
  );
};

const assertDestination = (projectId) => {
  const config = loadConfig(projectId);
  const expected = [
    {
      source: "/__/firebase/init.json",
      destination: `https://${projectId}.firebaseapp.com/__/firebase/init.json`,
    },
    {
      source: "/__/auth/:path*",
      destination: `https://${projectId}.firebaseapp.com/__/auth/:path*`,
    },
  ];
  if (JSON.stringify(config.rewrites) !== JSON.stringify(expected)) {
    throw new Error(
      `Unexpected Auth helper rewrites for ${projectId}: ${JSON.stringify(config.rewrites)}`,
    );
  }
};

const assertRejected = (projectId) => {
  try {
    loadConfig(projectId);
  } catch (error) {
    if (
      String(error.stderr || error.message).includes(
        "requires an approved Firebase project ID",
      )
    ) {
      return;
    }
    throw error;
  }
  throw new Error(
    `Unapproved Firebase project was accepted: ${projectId || "<missing>"}`,
  );
};

assertDestination("history-quiz-yongsin");
assertDestination("westory-staging-177587430482");
assertRejected("westory-unapproved");
assertRejected("");

const ignoredPreviewConfig = loadConfig("", "preview");
if (ignoredPreviewConfig.rewrites?.length !== 0) {
  throw new Error(
    "Unconfigured Production-project Preview must expose no rewrite.",
  );
}

console.log("Vercel Firebase Auth rewrite isolation: PASS (5 cases, 2 routes)");
