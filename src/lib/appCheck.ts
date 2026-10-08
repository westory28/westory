import type { AppCheck } from "firebase/app-check";
import { app } from "./firebase";

let instance: AppCheck | null = null;
let flight: Promise<void> | null = null;

export const ensureWestoryAppCheck = (): Promise<void> => {
  if (
    import.meta.env.DEV &&
    (import.meta.env.VITE_USE_FIREBASE_EMULATORS === "true" ||
      import.meta.env.VITE_FUNCTIONS_EMULATOR_HOST)
  )
    return Promise.resolve();
  if (flight) return flight;
  flight = (async () => {
    const siteKey = String(
      import.meta.env.VITE_FIREBASE_APPCHECK_SITE_KEY || "",
    ).trim();
    if (!siteKey) throw new Error("운영 인증 설정을 확인해야 합니다.");
    const { initializeAppCheck, ReCaptchaEnterpriseProvider, getToken } =
      await import("firebase/app-check");
    if (!instance)
      instance = initializeAppCheck(app, {
        provider: new ReCaptchaEnterpriseProvider(siteKey),
        isTokenAutoRefreshEnabled: true,
      });
    await getToken(instance);
  })().finally(() => {
    flight = null;
  });
  return flight;
};
