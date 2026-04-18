import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

function Hello({ name }: { name: string }) {
  return <h1>Hello, {name}</h1>;
}

describe("smoke", () => {
  it("renders a greeting", () => {
    render(<Hello name="Lambda" />);
    expect(screen.getByText("Hello, Lambda")).toBeInTheDocument();
  });
});
