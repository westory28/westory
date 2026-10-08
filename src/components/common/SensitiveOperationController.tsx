import { useEffect } from "react";
import { useAppDialog } from "./AppDialogProvider";
import {
  cancelledReauthentication,
  registerSensitiveOperationPrompt,
} from "../../lib/sensitiveOperationPrompt";

export const SensitiveOperationController = () => {
  const { confirm } = useAppDialog();
  useEffect(
    () =>
      registerSensitiveOperationPrompt(async (start) => {
        let outcome: Promise<{ error?: unknown }> | undefined;
        const accepted = await confirm({
          title: "다시 인증",
          message:
            "보호된 작업을 계속하려면 현재 Google 계정으로 다시 인증해 주세요.",
          confirmLabel: "Google로 다시 인증",
          onConfirm: () => {
            // Do not await anything before start(): this is the browser user gesture.
            try {
              outcome = start().then(
                () => ({}),
                (error: unknown) => ({ error }),
              );
            } catch (error) {
              outcome = Promise.resolve({ error });
            }
          },
        });
        if (!accepted || !outcome) throw cancelledReauthentication();
        const result = await outcome;
        if ("error" in result) throw result.error;
      }),
    [confirm],
  );
  return null;
};
