import { describe, expect, it } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "./App";
import { makeFakeApi, makeStranger } from "./test/fixtures";

describe("App — hero flow", () => {
  it("select → dry-run → apply updates the lane and fires the receipt/Undo toast", async () => {
    const strangers = [
      makeStranger({ lot_id: 4101, title: "JD S680 Combine", confidence: 0.28 }),
      makeStranger({ lot_id: 4102, title: "Case IH 8240", confidence: 0.31 }),
    ];
    const { api, calls } = makeFakeApi(strangers);
    render(<App api={api} />);

    // Lane renders both strangers.
    await screen.findByTestId("card-4101");
    expect(screen.getByTestId("stranger-count")).toHaveTextContent("2 strangers");

    // Selection bar is hidden until something is selected.
    expect(screen.getByTestId("selection-bar")).toHaveAttribute("aria-hidden", "true");

    // Select both red cards (they share suggested home "Combine").
    await userEvent.click(screen.getByTestId("card-4101"));
    await userEvent.click(screen.getByTestId("card-4102"));

    const bar = screen.getByTestId("selection-bar");
    expect(bar).toHaveAttribute("aria-hidden", "false");
    expect(within(bar).getByText(/2 selected/)).toBeInTheDocument();
    expect(within(bar).getByText("COMBINE")).toBeInTheDocument();

    // Apply → dry-run runs and the confirm dialog shows the diff, gated on N.
    await userEvent.click(screen.getByTestId("apply-btn"));

    const dialog = await screen.findByTestId("confirm-dialog");
    expect(calls.dryRun).toBe(1);
    expect(calls.override).toBe(0); // not committed yet
    expect(within(dialog).getByTestId("dryrun-affects")).toHaveTextContent("2");

    // Confirm → override commits, cards leave the lane, receipt toast appears.
    await userEvent.click(screen.getByTestId("confirm-apply-btn"));

    await waitFor(() => expect(calls.override).toBe(1));

    // Lane reflowed: the two cards are gone.
    await waitFor(() => {
      expect(screen.queryByTestId("card-4101")).not.toBeInTheDocument();
      expect(screen.queryByTestId("card-4102")).not.toBeInTheDocument();
    });

    // Receipt toast with the rule + Undo affordance.
    const toast = screen.getByTestId("receipt-toast");
    expect(toast).toHaveTextContent(/now=Tractor → COMBINE/);
    expect(toast).toHaveTextContent(/2 lots reclassified/);

    // Undo wires through to /admin/undo.
    await userEvent.click(screen.getByTestId("undo-btn"));
    await waitFor(() => expect(calls.undo).toBe(1));
    expect(screen.getByTestId("undo-toast")).toHaveTextContent(/restored/i);
  });

  it("gates confirm on the dry-run count (no override before confirm)", async () => {
    const { api, calls } = makeFakeApi([makeStranger({ lot_id: 1 })]);
    render(<App api={api} />);
    await screen.findByTestId("card-1");

    await userEvent.click(screen.getByTestId("card-1"));
    await userEvent.click(screen.getByTestId("apply-btn"));
    await screen.findByTestId("confirm-dialog");

    // Cancel must not commit.
    await userEvent.click(screen.getByText("Cancel"));
    expect(calls.override).toBe(0);
    expect(screen.queryByTestId("confirm-dialog")).not.toBeInTheDocument();
  });
});
