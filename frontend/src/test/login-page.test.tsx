import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const authMocks = vi.hoisted(() => ({
  login: vi.fn(),
  register: vi.fn(),
}));

vi.mock("../services/api", () => ({
  authApi: {
    login: authMocks.login,
    register: authMocks.register,
  },
}));

import LoginPage from "../pages/LoginPage";
import { useStore } from "../store/useStore";

const user = {
  id: "user-1",
  email: "ada@example.com",
  username: "ada",
};

type StoreStateOverrides = {
  user: typeof user | null;
  token: string | null;
  authReady: boolean;
  projects: [];
  currentProject: null;
  documents: [];
  currentDoc: null;
  presence: [];
  isConnected: boolean;
  compiledPdf: string | null;
  compileLog: string;
  isCompiling: boolean;
};

const defaultState: StoreStateOverrides = {
  user: null,
  token: null,
  authReady: true,
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

function resetStore(overrides: Partial<StoreStateOverrides> = {}) {
  localStorage.clear();
  useStore.setState({ ...defaultState, ...overrides });
}

function renderLogin(initialEntry = "/login") {
  render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/projects" element={<div>Projects Route</div>} />
        <Route path="/projects/:projectId" element={<div>Project Route</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

function clickSubmit(label: "Sign In" | "Create Account") {
  const buttons = screen.getAllByRole("button", { name: label });
  fireEvent.click(buttons[buttons.length - 1]);
}

describe("LoginPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetStore();
  });

  it("redirects authenticated users to the requested path", async () => {
    resetStore({ user, token: "session" });

    renderLogin("/login?next=/projects/project-1");

    expect(await screen.findByText("Project Route")).toBeInTheDocument();
  });

  it("submits the login form and persists the session placeholder token", async () => {
    authMocks.login.mockResolvedValueOnce({ data: { user } });

    renderLogin("/login?next=/projects");

    fireEvent.change(screen.getByPlaceholderText("you@example.com"), {
      target: { value: "ada@example.com" },
    });
    fireEvent.change(screen.getByPlaceholderText("••••••••"), {
      target: { value: "secret-pass" },
    });
    clickSubmit("Sign In");

    await waitFor(() => {
      expect(authMocks.login).toHaveBeenCalledWith("ada@example.com", "secret-pass");
    });

    expect(await screen.findByText("Projects Route")).toBeInTheDocument();
    expect(localStorage.getItem("token")).toBe("session");
    expect(useStore.getState().user).toEqual(user);
  });

  it("submits registration with username and follows the next redirect", async () => {
    authMocks.register.mockResolvedValueOnce({ data: { user } });

    renderLogin("/login?next=/projects/project-1");

    fireEvent.click(screen.getByRole("button", { name: "Register" }));
    fireEvent.change(screen.getByPlaceholderText("you@example.com"), {
      target: { value: "ada@example.com" },
    });
    fireEvent.change(screen.getByPlaceholderText("username"), {
      target: { value: "ada" },
    });
    fireEvent.change(screen.getByPlaceholderText("••••••••"), {
      target: { value: "secret-pass" },
    });
    clickSubmit("Create Account");

    await waitFor(() => {
      expect(authMocks.register).toHaveBeenCalledWith("ada@example.com", "ada", "secret-pass");
    });

    expect(await screen.findByText("Project Route")).toBeInTheDocument();
  });

  it("renders the API error for failed login attempts", async () => {
    authMocks.login.mockRejectedValueOnce({
      response: { data: { detail: "Invalid credentials" } },
    });

    renderLogin();

    fireEvent.change(screen.getByPlaceholderText("you@example.com"), {
      target: { value: "ada@example.com" },
    });
    fireEvent.change(screen.getByPlaceholderText("••••••••"), {
      target: { value: "wrong-pass" },
    });
    clickSubmit("Sign In");

    expect(await screen.findByText("Invalid credentials")).toBeInTheDocument();
  });
});
