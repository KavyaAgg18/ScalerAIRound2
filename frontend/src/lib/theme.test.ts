import { beforeEach, describe, expect, it } from "vitest";
import { getVisualMode, setVisualMode } from "./theme";

const isDark = () => document.body.classList.contains("awsui-dark-mode");

describe("visual mode", () => {
  beforeEach(() => localStorage.clear());

  it("defaults to the browser setting", () => {
    expect(getVisualMode()).toBe("system");
  });

  it("dark and light are applied and remembered", () => {
    setVisualMode("dark");
    expect(isDark()).toBe(true);
    expect(getVisualMode()).toBe("dark");

    setVisualMode("light");
    expect(isDark()).toBe(false);
    expect(localStorage.getItem("r53.visualMode")).toBe("light");
  });

  it("'Browser default' forgets the choice", () => {
    setVisualMode("dark");
    setVisualMode("system");
    expect(localStorage.getItem("r53.visualMode")).toBeNull();
    expect(getVisualMode()).toBe("system");
  });
});
