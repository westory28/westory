export type CommonComponentRole =
  | "page-heading"
  | "semester-context"
  | "async-state"
  | "responsive-data"
  | "form-field"
  | "modal"
  | "application-dialog";

export interface CommonComponentContract {
  role: CommonComponentRole;
  module: string;
  owns: readonly string[];
}

export const COMMON_COMPONENT_REGISTRY = {
  PageHeader: {
    role: "page-heading",
    module: "./PageHeader",
    owns: ["route title", "route description", "semester context"],
  },
  SemesterContextBar: {
    role: "semester-context",
    module: "./SemesterContextBar",
    owns: ["current semester", "provenance", "read-only state"],
  },
  StatePanel: {
    role: "async-state",
    module: "./StatePanel",
    owns: ["loading", "empty", "error", "permission", "disabled"],
  },
  ResponsiveDataContainer: {
    role: "responsive-data",
    module: "./ResponsiveDataContainer",
    owns: ["table label", "horizontal overflow affordance"],
  },
  FormField: {
    role: "form-field",
    module: "./FormField",
    owns: ["label", "help text", "validation message"],
  },
  ModalSurface: {
    role: "modal",
    module: "./ModalSurface",
    owns: ["modal focus", "Escape", "focus restoration"],
  },
  AppDialogProvider: {
    role: "application-dialog",
    module: "./AppDialogProvider",
    owns: ["confirm", "alert", "danger confirmation"],
  },
} as const satisfies Record<string, CommonComponentContract>;

export type CommonComponentName = keyof typeof COMMON_COMPONENT_REGISTRY;
