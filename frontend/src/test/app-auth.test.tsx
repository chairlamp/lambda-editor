import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const apiMocks = vi.hoisted(() => ({
  me: vi.fn(),
  join: vi.fn(),
  refreshAuthSession: vi.fn(),
}));

vi.mock("../services/api", () => ({
  authApi: {
    me: apiMocks.me,
  },
  projectsApi: {
    join: apiMocks.join,
  },
  refreshAuthSession: apiMocks.refreshAuthSession,
}));

vi.mock("../pages/LoginPage", () => ({
  default: () => <div>Login Page</div>,
}));

vi.mock("../pages/ProjectsPage", () => ({
  default: () => <div>Projects Page</div>,
}));

vi.mock("../pages/ProjectPage", () => ({
  default: () => <div>Project Page</div>,
}));

vi.mock("../pages/EditorPage", () => ({
  default: () => <div>Editor Page</div>,
}));

import App from "../App";
import { useStore } from "../store/useStore";

const defaultState = {
  user: null,
  token: null,
  authReady: false,
  projects: [],
  currentProject: null,
  documents: [],
  currentDoc: null,
  presence: [],
  isConnected: false,
  compiledPdf: null,
  compileLog: "",
  isCompiling: false,
};

const user = {
  id: "user-1",
  email: "ada@example.com",
  username: "ada",
};

function resetStore() {
  localStorage.clear();
  useStore.setState(defaultState);
  window.history.replaceState({}, "", "/");
}

describe("App auth bootstrap", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetStore();
  });

  it("redirects unauthenticated users from protected routes to login", async () => {
    apiMocks.me.mockRejectedValueOnce(new Error("unauthorized"));
    window.history.pushState({}, "", "/projects");

    render(<App />);

    expect(screen.getByText("Restoring session…")).toBeInTheDocument();
    expect(await screen.findByText("Login Page")).toBeInTheDocument();
    await waitFor(() => expect(window.location.pathname).toBe("/login"));
  });

  it("restores the session and renders the protected route", async () => {
    apiMocks.me.mockResolvedValueOnce({ data: user });
    window.history.pushState({}, "", "/projects");

    render(<App />);

    expect(await screen.findByText("Projects Page")).toBeInTheDocument();
    expect(useStore.getState().user).toEqual(user);
    expect(localStorage.getItem("token")).toBe("session");
  });

  it("registers the periodic refresh callback for active sessions", async () => {
    const intervalSpy = vi.spyOn(window, "setInterval");
    apiMocks.me.mockResolvedValueOnce({ data: user });
    apiMocks.refreshAuthSession.mockResolvedValue(undefined);
    window.history.pushState({}, "", "/projects");

    render(<App />);

    expect(await screen.findByText("Projects Page")).toBeInTheDocument();
    expect(intervalSpy).toHaveBeenCalledWith(expect.any(Function), 12 * 60 * 1000);

    const refreshCall = intervalSpy.mock.calls.find(
      ([callback, delay]) => typeof callback === "function" && delay === 12 * 60 * 1000,
    );
    const refreshCallback = refreshCall?.[0];
    if (typeof refreshCallback === "function") {
      await refreshCallback();
    }

    expect(apiMocks.refreshAuthSession).toHaveBeenCalledTimes(1);
  });
});
