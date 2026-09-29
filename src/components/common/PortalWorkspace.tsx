import React, {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useState,
} from "react";
import Footer from "./Footer";
import "./portalSubNavigation.css";

interface WorkspaceFooterContextValue {
  count: number;
  register: () => () => void;
}

const WorkspaceFooterContext =
  createContext<WorkspaceFooterContextValue | null>(null);

export const PortalWorkspaceFooterProvider: React.FC<{
  children: React.ReactNode;
}> = ({ children }) => {
  const [count, setCount] = useState(0);
  const register = useCallback(() => {
    setCount((previous) => previous + 1);
    return () => setCount((previous) => previous - 1);
  }, []);
  const value = useMemo(() => ({ count, register }), [count, register]);

  return (
    <WorkspaceFooterContext.Provider value={value}>
      {children}
    </WorkspaceFooterContext.Provider>
  );
};

export const PortalFallbackFooter: React.FC<
  React.ComponentProps<typeof Footer>
> = (props) => {
  const context = useContext(WorkspaceFooterContext);
  return context?.count ? null : <Footer {...props} />;
};

interface PortalWorkspaceProps extends React.HTMLAttributes<HTMLElement> {
  as?: "div" | "main";
  footerActive?: boolean;
}

/** Keeps the page navigation surface alongside both its content and footer. */
const PortalWorkspace: React.FC<PortalWorkspaceProps> = ({
  as: Element = "div",
  footerActive = true,
  children,
  ...props
}) => {
  const register = useContext(WorkspaceFooterContext)?.register;

  useLayoutEffect(() => {
    if (footerActive) return register?.();
    return undefined;
  }, [footerActive, register]);

  return (
    <Element {...props}>
      {children}
      {footerActive && (
        <div className="teacher-sub-workspace-footer">
          <Footer teacher />
        </div>
      )}
    </Element>
  );
};

export default PortalWorkspace;
