import { createContext, useContext, type ReactNode } from "react";

const EntryMotionContext = createContext(true);

export function EntryMotionProvider({
  enabled,
  children,
}: {
  enabled: boolean;
  children: ReactNode;
}) {
  return (
    <EntryMotionContext.Provider value={enabled}>
      {children}
    </EntryMotionContext.Provider>
  );
}

export function useEntryMotionEnabled(): boolean {
  return useContext(EntryMotionContext);
}
