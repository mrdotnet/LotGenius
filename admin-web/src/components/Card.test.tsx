import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Card } from "./Card";
import { makeStranger } from "../test/fixtures";

describe("Card", () => {
  it("shows suspicious styling + the suggested chip when filed != suggested", () => {
    const lot = makeStranger({
      lot_id: 42,
      now_category: "Tractor",
      suggested_category: "Combine",
      confidence: 0.3,
    });
    render(<Card lot={lot} selected={false} onToggle={() => {}} />);

    const card = screen.getByTestId("card-42");
    // Red double border == suspicious class, and the data flag is set.
    expect(card).toHaveClass("card--suspicious");
    expect(card).not.toHaveClass("card--quiet");
    expect(card).toHaveAttribute("data-suspicious", "true");

    // The "→ SUGGESTED●" chip is shown, uppercased.
    const chip = screen.getByTestId("suggest-42");
    expect(chip).toHaveTextContent("COMBINE");

    // Low confidence chip gets the alarm variant.
    expect(screen.getByText(/conf 0\.30/)).toHaveClass("conf-chip--low");
  });

  it("is quiet with no suggested chip when filed == suggested", () => {
    const lot = makeStranger({
      lot_id: 7,
      now_category: "Combine",
      suggested_category: "Combine",
      confidence: 0.92,
    });
    render(<Card lot={lot} selected={false} onToggle={() => {}} />);

    const card = screen.getByTestId("card-7");
    expect(card).toHaveClass("card--quiet");
    expect(card).not.toHaveClass("card--suspicious");
    expect(card).toHaveAttribute("data-suspicious", "false");
    // No suggested chip when there is no disagreement.
    expect(screen.queryByTestId("suggest-7")).not.toBeInTheDocument();
  });

  it("falls back to the silhouette when there is no photo", () => {
    render(<Card lot={makeStranger({ photo_url: null })} selected={false} onToggle={() => {}} />);
    expect(screen.getByTestId("silhouette")).toBeInTheDocument();
    expect(screen.queryByRole("img", { hidden: false })).not.toBeInTheDocument();
  });

  it("toggles on click", async () => {
    const onToggle = vi.fn();
    render(<Card lot={makeStranger({ lot_id: 9 })} selected={false} onToggle={onToggle} />);
    await userEvent.click(screen.getByTestId("card-9"));
    expect(onToggle).toHaveBeenCalledWith(9);
  });
});
