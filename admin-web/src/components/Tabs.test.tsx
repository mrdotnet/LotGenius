import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Tabs } from "./Tabs";

const TABS = [
  { id: "review", label: "Review" },
  { id: "users", label: "Users & Groups" },
  { id: "calibration", label: "Calibration" },
];

describe("Tabs", () => {
  it("renders an accessible tablist with the active tab selected", () => {
    render(<Tabs tabs={TABS} active="review" onChange={() => {}} />);
    const list = screen.getByRole("tablist");
    expect(list).toBeInTheDocument();
    const review = screen.getByRole("tab", { name: "Review" });
    expect(review).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "Calibration" })).toHaveAttribute(
      "aria-selected",
      "false",
    );
  });

  it("fires onChange when a tab is clicked", async () => {
    const onChange = vi.fn();
    render(<Tabs tabs={TABS} active="review" onChange={onChange} />);
    await userEvent.click(screen.getByRole("tab", { name: "Calibration" }));
    expect(onChange).toHaveBeenCalledWith("calibration");
  });

  it("moves selection with arrow keys (roving focus)", async () => {
    const onChange = vi.fn();
    render(<Tabs tabs={TABS} active="review" onChange={onChange} />);
    const review = screen.getByRole("tab", { name: "Review" });
    review.focus();
    await userEvent.keyboard("{ArrowRight}");
    expect(onChange).toHaveBeenCalledWith("users");
  });

  it("only the active tab is in the tab order", () => {
    render(<Tabs tabs={TABS} active="users" onChange={() => {}} />);
    expect(screen.getByRole("tab", { name: "Users & Groups" })).toHaveAttribute("tabindex", "0");
    expect(screen.getByRole("tab", { name: "Review" })).toHaveAttribute("tabindex", "-1");
  });
});
