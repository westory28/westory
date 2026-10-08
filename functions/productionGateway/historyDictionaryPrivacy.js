const { HttpsError } = require("firebase-functions/v2/https");

// Account deletion follows the existing all-personal-records policy. Query by
// owner first, then prove ownership again from the canonical path and payload.
const collectCanonicalDictionaryUserRefs = async (db, uid) => {
  if (typeof uid !== "string" || !uid || /[/\\\x00-\x1f]/.test(uid))
    throw new HttpsError("invalid-argument", "학생 계정 정보를 확인해 주세요.");
  const groups = await Promise.all(["history_dictionary_words", "history_dictionary_requests"].map(
    collection => db.collectionGroup(collection).where("uid", "==", uid).get(),
  ));
  const refs = new Map();
  for (const snapshot of groups) for (const document of snapshot.docs) {
    const segments = document.ref.path.split("/");
    const data = document.data() || {};
    if (data.uid !== uid || segments[0] !== "years" || !/^\d{4}$/.test(segments[1])
      || segments[2] !== "semesters" || !["1", "2"].includes(segments[3])) continue;
    const ownedWord = segments.length === 8 && segments[4] === "dictionary_students"
      && segments[5] === uid && segments[6] === "history_dictionary_words";
    const ownedRequest = segments.length === 6 && segments[4] === "history_dictionary_requests";
    if (ownedWord || ownedRequest) refs.set(document.ref.path, document.ref);
  }
  return [...refs.values()];
};

module.exports = { collectCanonicalDictionaryUserRefs };
