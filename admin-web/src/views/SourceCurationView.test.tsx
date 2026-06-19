import { describe, expect, it } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SourceCurationView } from "./SourceCurationView";
import { createMockApi } from "../api/mock";

describe("SourceCurationView", () => {
  it("creates an alias→target remap rule via dry-run → confirm → undo", async () => {
    render(<SourceCurationView api={createMockApi()} />);

    // The pen inventory loads (source-of-truth categories).
    const inventory = await screen.findByTestId("sc-inventory");
    expect(within(inventory).getByText("Tractor")).toBeInTheDocument();

    // Build an alias rule: everything filed "Tractor" → "Combine".
    await userEvent.type(screen.getByTestId("sc-alias"), "Tractor");
    await userEvent.selectOptions(screen.getByTestId("sc-target"), "Combine");
    await userEvent.click(screen.getByTestId("sc-preview-btn"));

    // Dry-run preview gates the commit on the affected count (4 seeded combines).
    const dialog = await screen.findByTestId("confirm-dialog");
    expect(within(dialog).getByTestId("dryrun-affects")).toHaveTextContent("4");

    // Commit → receipt toast with Undo.
    await userEvent.click(screen.getByTestId("confirm-apply-btn"));
    const toast = await screen.findByTestId("receipt-toast");
    expect(toast).toHaveTextContent(/Tractor → COMBINE/);

    // Undo reverts the rule.
    await userEvent.click(screen.getByTestId("undo-btn"));
    await waitFor(() =>
      expect(screen.getByTestId("undo-toast")).toHaveTextContent(/restored/i),
    );
  });

  it("requires both an alias and a target before previewing", async () => {
    render(<SourceCurationView api={createMockApi()} />);
    await screen.findByTestId("sc-inventory");
    // Preview is disabled with an empty alias.
    expect(screen.getByTestId("sc-preview-btn")).toBeDisabled();
  });
});
