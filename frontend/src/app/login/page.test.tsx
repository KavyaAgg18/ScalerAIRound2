import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api";
import { apiMock, router, setUrl } from "@/test/mocks";
import LoginPage from "./page";

vi.mock("next/navigation", async () => (await import("@/test/mocks")).navigationMock);
vi.mock("@/lib/api", async (orig) => (await import("@/test/mocks")).apiModuleMock(orig));

async function signIn(username: string, password: string) {
  const user = userEvent.setup();
  if (username) await user.type(screen.getByLabelText("Username"), username);
  if (password) await user.type(screen.getByLabelText("Password"), password);
  await user.click(screen.getByRole("button", { name: "Sign in" }));
}

describe("LoginPage", () => {
  beforeEach(() => setUrl("/login/"));

  it("validates required fields without calling the API", async () => {
    render(<LoginPage />);
    await signIn("", "");
    expect(screen.getByText("Enter your username.")).toBeInTheDocument();
    expect(screen.getByText("Enter your password.")).toBeInTheDocument();
    expect(apiMock.login).not.toHaveBeenCalled();
  });

  it("shows the server error for wrong credentials", async () => {
    apiMock.login.mockRejectedValue(new ApiError(401, "Incorrect user name or password."));
    render(<LoginPage />);
    await signIn("demo", "nope");
    expect(apiMock.login).toHaveBeenCalledWith("demo", "nope");
    expect(await screen.findAllByText("Incorrect user name or password.")).not.toHaveLength(0);
    expect(router.replace).not.toHaveBeenCalled();
  });

  it("redirects to the requested page after sign-in", async () => {
    apiMock.login.mockResolvedValue({ username: "demo" });
    setUrl("/login/", "next=%2Fhostedzones%2F%3Fq%3Dx");
    render(<LoginPage />);
    await signIn("demo", "demo1234");
    expect(router.replace).toHaveBeenCalledWith("/hostedzones/?q=x");
  });

  it("ignores off-site redirect targets", async () => {
    apiMock.login.mockResolvedValue({ username: "demo" });
    setUrl("/login/", "next=%2F%2Fevil.example.com");
    render(<LoginPage />);
    await signIn("demo", "demo1234");
    expect(router.replace).toHaveBeenCalledWith("/");
  });

  it("explains an expired session and shows demo credentials", () => {
    setUrl("/login/", "expired=1");
    render(<LoginPage />);
    expect(screen.getByText(/Your session has expired/)).toBeInTheDocument();
    expect(screen.getByText("demo1234")).toBeInTheDocument();
  });
});
