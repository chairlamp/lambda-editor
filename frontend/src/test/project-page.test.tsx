import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const apiMocks = vi.hoisted(() => ({
  getProject: vi.fn(),
  listMembers: vi.fn(),
  listDocs: vi.fn(),
  createDoc: vi.fn(),
}));

vi.mock("../services/api", () => ({
  projectsApi: {
    get: apiMocks.getProject,
    listMembers: apiMocks.listMembers,
    updateMemberRole: vi.fn(),
    removeMember: vi.fn(),
    listInvites: vi.fn(),
    createInvite: vi.fn(),
    deleteInvite: vi.fn(),
  },
  docsApi: {
    list: apiMocks.listDocs,
    create: apiMocks.createDoc,
    upload: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock("../services/socket", () => ({
  ProjectSocket: class {
    connect() {}
    destroy() {}
    on() {
      return () => {};
    }
  },
}));

vi.mock("../components/ThemeToggle", () => ({
  default: () => <div data-testid="theme-toggle" />,
}));

import ProjectPage from "../pages/ProjectPage";
import { useStore } from "../store/useStore";

const initialState = useStore.getState();

const user = {
  id: "user-1",
  email: "ada@example.com",
  username: "ada",
};

function resetStore() {
  useStore.setState(
    {
      ...initialState,
      user,
      token: "session",
      authReady: true,
      currentProject: null,
      documents: [],
    },
    true,
  );
}

function renderProjectPage(initialEntry = "/projects/proj-1") {
  render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route path="/projects/:projectId" element={<ProjectPage />} />
        <Route path="/projects/:projectId/docs/:docId" element={<div>Editor Route</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("ProjectPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetStore();
    apiMocks.listMembers.mockResolvedValue({ data: [] });
    apiMocks.listDocs.mockResolvedValue({ data: [] });
  });

  it("creates a new document from the project document UI", async () => {
    apiMocks.getProject.mockResolvedValue({
      data: {
        id: "proj-1",
        title: "Lambda",
        description: "Collaborative writing",
        owner_id: user.id,
        my_role: "owner",
        main_doc_id: null,
      },
    });
    apiMocks.createDoc.mockResolvedValue({
      data: {
        id: "doc-2",
        title: "notes.tex",
        path: "notes.tex",
        kind: "latex",
        owner_id: user.id,
        project_id: "proj-1",
        content: "",
        content_revision: 0,
      },
    });

    renderProjectPage();

    expect(await screen.findByText("No documents yet. Create one to get started.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /new document/i }));
    fireEvent.change(screen.getByPlaceholderText("File path (e.g. src/app.py)"), {
      target: { value: "notes.tex" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^create$/i }));

    await waitFor(() => {
      expect(apiMocks.createDoc).toHaveBeenCalledWith("proj-1", "notes.tex", "");
    });

    expect(await screen.findByText("Editor Route")).toBeInTheDocument();
  });

  it("hides editing actions for viewer-only members", async () => {
    apiMocks.getProject.mockResolvedValue({
      data: {
        id: "proj-1",
        title: "Read Only",
        description: "",
        owner_id: "owner-1",
        my_role: "viewer",
        main_doc_id: null,
      },
    });

    renderProjectPage();

    expect(await screen.findByText("No documents yet.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /new document/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/upload files/i)).not.toBeInTheDocument();
  });
});
