export interface StepUpRequestOptions {
  force?: boolean;
}

type StepUpHandler = (
  commandName: string,
  options?: StepUpRequestOptions,
) => Promise<void>;

let activeHandler: StepUpHandler | null = null;

export const registerStepUpReauthHandler = (handler: StepUpHandler) => {
  activeHandler = handler;
  return () => {
    if (activeHandler === handler) activeHandler = null;
  };
};

export const requestStepUpReauthentication = async (
  commandName: string,
  options?: StepUpRequestOptions,
) => {
  if (!activeHandler) {
    throw new Error("Step-up reauthentication is not available.");
  }
  await activeHandler(commandName, options);
};
