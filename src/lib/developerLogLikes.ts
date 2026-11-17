import {
  doc,
  getDocFromServer,
  increment,
  serverTimestamp,
  writeBatch,
  type DocumentReference,
} from "firebase/firestore";

/** Rules pair the caller's like transition with an exact counter delta.
 * A batch needs no pre-read and does not retry when other students like a post.
 * Reconcile only rejected/ambiguous commits, including a stale second tab.
 */
export async function setDeveloperLogLike(
  postRef: DocumentReference,
  uid: string,
  desiredLiked: boolean,
) {
  const likeRef = doc(postRef, "likes", uid);
  const batch = writeBatch(postRef.firestore);
  if (desiredLiked) {
    batch.set(likeRef, { uid, createdAt: serverTimestamp() });
  } else {
    batch.delete(likeRef);
  }
  batch.update(postRef, { likeCount: increment(desiredLiked ? 1 : -1) });
  try {
    await batch.commit();
    return { confirmed: true as const };
  } catch (error) {
    try {
      const [postSnapshot, likeSnapshot] = await Promise.all([
        getDocFromServer(postRef),
        getDocFromServer(likeRef),
      ]);
      if (postSnapshot.exists()) {
        const liked = likeSnapshot.exists();
        return {
          confirmed: liked === desiredLiked,
          state: {
            liked,
            likeCount: Math.max(0, Number(postSnapshot.data().likeCount) || 0),
          },
          error,
        };
      }
    } catch {
      // Keep the original commit error if the authoritative read also fails.
    }
    return { confirmed: false as const, error };
  }
}
