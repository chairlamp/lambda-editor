import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import DiffView, { type DiffChange } from "../components/DiffView";

const change: DiffChange = {
  id: "c1",
  description: "Rewrite the opening sentence",
  old_text: "Old text",
  new_text: "New text",
};

describe("DiffView", () => {
  it("lets the user edit a suggestion before accepting it", () => {
    const onAccept = vi.fn();

    render(
      <DiffView
        explanation="Suggested one improvement."
        changes={[change]}
        onAccept={onAccept}
        onReject={vi.fn()}
        onAcceptAll={vi.fn()}
        onRejectAll={vi.fn()}
        accepted={new Set()}
        rejected={new Set()}
      />,
    );

    fireEvent.click(screen.getByTitle("Edit before accepting"));
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "Edited replacement" },
    });
    fireEvent.click(screen.getByTitle("Accept edited version"));

    expect(onAccept).toHaveBeenCalledWith({
      ...change,
      new_text: "Edited replacement",
    });
  });

  it("renders viewer messaging when review actions are disabled", () => {
    render(
      <DiffView
        explanation="Suggested one improvement."
        changes={[change]}
        onAccept={vi.fn()}
        onReject={vi.fn()}
        onAcceptAll={vi.fn()}
        onRejectAll={vi.fn()}
        accepted={new Set()}
        rejected={new Set()}
        canReview={false}
      />,
    );

    expect(screen.getByText("Viewers cannot accept or reject AI changes.")).toBeInTheDocument();
    expect(screen.queryByTitle("Accept")).not.toBeInTheDocument();
    expect(screen.queryByTitle("Reject")).not.toBeInTheDocument();
  });

  it("shows drift guidance for stale suggestions", () => {
    render(
      <DiffView
        explanation="Suggested one improvement."
        changes={[change]}
        onAccept={vi.fn()}
        onReject={vi.fn()}
        onAcceptAll={vi.fn()}
        onRejectAll={vi.fn()}
        onAskDifferent={vi.fn()}
        onRefreshConflicts={vi.fn()}
        accepted={new Set()}
        rejected={new Set()}
        conflicted={new Set(["c1"])}
      />,
    );

    expect(screen.getByText(/document changed after this suggestion was generated/i)).toBeInTheDocument();
    expect(screen.getByText(/current document no longer contains the expected original text/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /refresh checks/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /review again/i })).toBeInTheDocument();
    expect(screen.queryByTitle("Accept")).not.toBeInTheDocument();
  });
});
