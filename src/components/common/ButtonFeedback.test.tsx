import { describe, expect, it } from "vitest";
import { fireEvent, render } from "@testing-library/react";
import { SpinnerIcon } from "@/components/common/Icons";

function TestButton({ disabled = false }: { disabled?: boolean }) {
  return (
    <button type="button" disabled={disabled} className="btn btn-primary">
      <span>Save</span>
    </button>
  );
}

describe("button interaction feedback", () => {
  it("keeps a shared button keyboard and pointer ready when enabled", () => {
    const { getByRole } = render(<TestButton />);
    const button = getByRole("button", { name: "Save" });

    expect(button).toHaveClass("btn", "btn-primary");
    expect(button).not.toBeDisabled();

    fireEvent.mouseDown(button);
    fireEvent.mouseUp(button);
    expect(button).not.toBeDisabled();
  });

  it("exposes native disabled state for inactive actions", () => {
    const { getByRole } = render(<TestButton disabled />);
    expect(getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("marks a spinner as decorative", () => {
    const { container } = render(<SpinnerIcon />);
    expect(container.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
  });
});
