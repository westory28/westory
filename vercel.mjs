const ALLOWED_FIREBASE_PROJECT_IDS = new Set([
  "history-quiz-yongsin",
  "westory-staging-177587430482",
]);

const firebaseProjectId = process.env.VITE_FIREBASE_PROJECT_ID?.trim();
const isUnconfiguredPreview =
  process.env.VERCEL_ENV?.trim().toLowerCase() === "preview" &&
  !firebaseProjectId;

if (
  !isUnconfiguredPreview &&
  (!firebaseProjectId || !ALLOWED_FIREBASE_PROJECT_IDS.has(firebaseProjectId))
) {
  throw new Error(
    "[Environment] Vercel Auth helper rewrite requires an approved Firebase project ID.",
  );
}

export const config = {
  rewrites: isUnconfiguredPreview
    ? []
    : [
        {
          source: "/__/firebase/init.json",
          destination: `https://${firebaseProjectId}.firebaseapp.com/__/firebase/init.json`,
        },
        {
          source: "/__/auth/:path*",
          destination: `https://${firebaseProjectId}.firebaseapp.com/__/auth/:path*`,
        },
      ],
};
