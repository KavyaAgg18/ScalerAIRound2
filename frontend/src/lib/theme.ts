import { applyMode, Mode } from "@cloudscape-design/global-styles";
import { applyTheme } from "@cloudscape-design/components/theming";

// The current AWS console uses orange primary buttons with dark text; Cloudscape's default is blue.
const orange = { default: "#ff9900", hover: "#fa6f00", active: "#ec7211" };
const ink = "#0f141a";

export type VisualMode = "light" | "dark" | "system";
const MODE_KEY = "r53.visualMode";

export function getVisualMode(): VisualMode {
  try {
    const v = localStorage.getItem(MODE_KEY);
    return v === "light" || v === "dark" ? v : "system";
  } catch {
    return "system";
  }
}

const prefersDark = () => window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;

function apply(mode: VisualMode) {
  const dark = mode === "dark" || (mode === "system" && prefersDark());
  applyMode(dark ? Mode.Dark : Mode.Light);
}

export function setVisualMode(mode: VisualMode) {
  try {
    if (mode === "system") localStorage.removeItem(MODE_KEY);
    else localStorage.setItem(MODE_KEY, mode);
  } catch {
    // Private windows can block storage; the mode still applies for this page.
  }
  apply(mode);
}

if (typeof document !== "undefined") {
  applyTheme({
    theme: {
      tokens: {
        colorBackgroundButtonPrimaryDefault: orange.default,
        colorBackgroundButtonPrimaryHover: orange.hover,
        colorBackgroundButtonPrimaryActive: orange.active,
        colorBorderButtonPrimaryDefault: orange.default,
        colorBorderButtonPrimaryHover: orange.hover,
        colorBorderButtonPrimaryActive: orange.active,
        colorTextButtonPrimaryDefault: ink,
        colorTextButtonPrimaryHover: ink,
        colorTextButtonPrimaryActive: ink,
      },
    },
  });
  apply(getVisualMode());
  // Follow the OS setting live when the user picked "Browser default".
  window.matchMedia?.("(prefers-color-scheme: dark)").addEventListener?.("change", () => {
    if (getVisualMode() === "system") apply("system");
  });
}
