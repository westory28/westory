const AVATAR_UPDATED = "westory:avatar-updated";
let avatarRevision = 0;
export const getAvatarRevision = () => avatarRevision;
export const notifyAvatarUpdated = () => {
  avatarRevision += 1;
  window.dispatchEvent(new Event(AVATAR_UPDATED));
};
export const subscribeAvatarUpdated = (listener: () => void) => {
  window.addEventListener(AVATAR_UPDATED, listener);
  return () => window.removeEventListener(AVATAR_UPDATED, listener);
};
