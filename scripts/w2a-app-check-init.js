try {
  const debugToken = self.localStorage?.getItem(
    "westory:w2a-appcheck-debug-token",
  );
  if (debugToken) {
    self.FIREBASE_APPCHECK_DEBUG_TOKEN = debugToken;
    self.localStorage?.removeItem("westory:w2a-appcheck-debug-token");
  }
} catch {
  // The first protected navigation seeds the token; the verification reload
  // applies it before Firebase initializes.
}
