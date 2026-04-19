import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const apiMocks = vi.hoisted(() => ({
  history: vi.fn(),
  updateReviewState: vi.fn(),
  agent: vi.fn(),
  post: vi.fn(),
  streamAI: vi.fn(),
}));

vi.mock("../services/api", () => ({
  default: {
    post: apiMocks.post,
  },
  aiChatApi: {
    history: apiMocks.history,
    updateReviewState: apiMocks.updateReviewState,
    agent: apiMocks.agent,
  },
  streamAI: apiMocks.streamAI,
}));

import AIChat from "../components/AIChat";
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
      currentDoc: {
        id: "doc-1",
        title: "main.tex",
        path: "main.tex",
        kind: "latex",
        content: "\\section{Introduction}\nHello world",
        owner_id: user.id,
        project_id: "proj-1",
      },
    },
    true,
  );
}

describe("AIChat cancellation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetStore();
    localStorage.clear();
    localStorage.setItem("ai-disclosure-accepted:v2", "true");
    apiMocks.history.mockResolvedValue({ data: [] });
    apiMocks.updateReviewState.mockResolvedValue({ data: { ok: true } });
    apiMocks.agent.mockResolvedValue({ data: { content: "", status: "completed" } });
    Object.defineProperty(Element.prototype, "scrollIntoView", {
      value: vi.fn(),
      configurable: true,
      writable: true,
    });
  });

  it("cancels in-flight diff requests from the stop button", async () => {
    let capturedSignal: AbortSignal | undefined;

    apiMocks.post.mockImplementation(
      (_url: string, _body: unknown, config?: { signal?: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          capturedSignal = config?.signal;
          capturedSignal?.addEventListener(
            "abort",
            () => reject({ name: "CanceledError", code: "ERR_CANCELED", message: "canceled" }),
            { once: true },
          );
        }),
    );

    render(<AIChat socket={null} readOnly={false} currentDocTitle="main.tex" />);

    await waitFor(() => {
      expect(apiMocks.history).toHaveBeenCalledWith("proj-1", "doc-1");
    });

    fireEvent.click(screen.getByRole("button", { name: /ai edit/i }));
    const textarea = screen.getByPlaceholderText(/what to improve/i);
    fireEvent.change(textarea, { target: { value: "Tighten the introduction" } });
    fireEvent.keyDown(textarea, { key: "Enter", code: "Enter" });

    await waitFor(() => {
      expect(apiMocks.post).toHaveBeenCalled();
      expect(screen.getByRole("button", { name: /stop/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /stop/i }));

    await waitFor(() => {
      expect(capturedSignal?.aborted).toBe(true);
    });

    expect(await screen.findAllByText("Cancelled by user")).not.toHaveLength(0);
    expect(screen.getByText("cancelled")).toBeInTheDocument();
  });

  it("warns when a suggestion no longer matches the current document and rechecks on collaboration updates", async () => {
    let documentContent = "\\section{Background}\nHello world";
    let observer: (() => void) | null = null;
    const ydoc = {
      getText: () => ({
        toString: () => documentContent,
        delete: vi.fn(),
        insert: vi.fn(),
        observe: (cb: () => void) => {
          observer = cb;
        },
        unobserve: vi.fn(),
      }),
      transact: (fn: () => void) => fn(),
    };

    apiMocks.history.mockResolvedValue({
      data: [
        {
          id: "act-1-diff",
          role: "assistant",
          content: "",
          diff: {
            explanation: "Rewrite the introduction heading.",
            changes: [
              {
                id: "c1",
                description: "Rename introduction",
                old_text: "\\section{Introduction}",
                new_text: "\\section{Overview}",
              },
            ],
          },
          retry_action: { type: "suggest", instruction: "Tighten the introduction" },
        },
      ],
    });

    render(<AIChat socket={null} ydoc={ydoc as any} readOnly={false} currentDocTitle="main.tex" />);

    expect(await screen.findByText(/document changed after this suggestion was generated/i)).toBeInTheDocument();
    expect(screen.queryByTitle("Accept")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /refresh checks/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /review again/i })).toBeInTheDocument();

    documentContent = "\\section{Introduction}\nHello world";
    act(() => {
      observer?.();
    });

    expect(await screen.findByTitle("Accept")).toBeInTheDocument();
  });

  it("streams normal chat replies and hydrates audit metadata after completion", async () => {
    const fixedNow = 1700000000000;
    const fixedRandom = 0.123456789;
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(fixedNow);
    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(fixedRandom);
    try {
      const actionId = `${fixedNow}-${fixedRandom.toString(36).slice(2)}`;
      apiMocks.history
        .mockResolvedValueOnce({ data: [] })
        .mockResolvedValueOnce({
          data: [
            {
              id: `${actionId}-res`,
              role: "assistant",
              content: "Hello world",
              sources: [{ title: "Docs", url: "https://example.com/docs" }],
              tool_calls: ["research_topic"],
              provider: "openai",
              model: "gpt-4.1",
              status: "completed",
            },
          ],
        });

      apiMocks.streamAI.mockImplementation(
        async (
          endpoint: string,
          _body: unknown,
          onChunk: (chunk: string) => void,
          onDone: () => void,
        ) => {
          expect(endpoint).toBe("/projects/proj-1/documents/doc-1/ai/message-streams");
          onChunk("Hello ");
          onChunk("world");
          onDone();
        },
      );

      render(<AIChat socket={null} readOnly={false} currentDocTitle="main.tex" />);

      await waitFor(() => {
        expect(apiMocks.history).toHaveBeenCalledWith("proj-1", "doc-1");
      });

      const textarea = screen.getByPlaceholderText("Message…");
      fireEvent.change(textarea, { target: { value: "Explain the intro" } });
      fireEvent.keyDown(textarea, { key: "Enter", code: "Enter" });

      expect((await screen.findAllByText("Hello world")).length).toBeGreaterThan(0);

      await waitFor(() => {
        expect(apiMocks.streamAI).toHaveBeenCalledTimes(1);
        expect(apiMocks.history).toHaveBeenCalledTimes(2);
      });

      expect(screen.getByText("openai")).toBeInTheDocument();
      expect(screen.getByText("gpt-4.1")).toBeInTheDocument();
      expect(screen.getByText("research_topic")).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "Docs" })).toHaveAttribute("href", "https://example.com/docs");
    } finally {
      nowSpy.mockRestore();
      randomSpy.mockRestore();
    }
  });
});
