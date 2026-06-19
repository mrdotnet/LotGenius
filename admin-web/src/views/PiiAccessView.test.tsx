import { describe, expect, it } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PiiAccessView } from "./PiiAccessView";
import { createMockApi } from "../api/mock";

describe("PiiAccessView", () => {
  it("renders the group×field-class matrix reflecting the locked grants", async () => {
    render(<PiiAccessView api={createMockApi()} />);
    await screen.findByTestId("pii-matrix");

    // appraisers→consignor is granted; appraisers→winning_bidder is not.
    expect(screen.getByTestId("pii-grant-appraisers-consignor")).toBeChecked();
    expect(
      screen.getByTestId("pii-grant-appraisers-winning_bidder"),
    ).not.toBeChecked();
    // basic has nothing.
    expect(screen.getByTestId("pii-grant-basic-consignor")).not.toBeChecked();
    // admins see everything.
    expect(
      screen.getByTestId("pii-grant-admins-bid_invoice_buyer"),
    ).toBeChecked();
  });

  it("toggles a grant via the matrix checkbox", async () => {
    render(<PiiAccessView api={createMockApi()} />);
    await screen.findByTestId("pii-matrix");

    const cell = screen.getByTestId("pii-grant-appraisers-winning_bidder");
    expect(cell).not.toBeChecked();

    await userEvent.click(cell);
    await waitFor(() =>
      expect(
        screen.getByTestId("pii-grant-appraisers-winning_bidder"),
      ).toBeChecked(),
    );

    // Revoke again.
    await userEvent.click(
      screen.getByTestId("pii-grant-appraisers-winning_bidder"),
    );
    await waitFor(() =>
      expect(
        screen.getByTestId("pii-grant-appraisers-winning_bidder"),
      ).not.toBeChecked(),
    );
  });

  it("lists the seeded column tags", async () => {
    render(<PiiAccessView api={createMockApi()} />);
    const tags = await screen.findByTestId("pii-tags");
    expect(within(tags).getByText("consignor_name")).toBeInTheDocument();
    expect(within(tags).getByText("consignor_phone")).toBeInTheDocument();
  });

  it("tags a new column, then untags it", async () => {
    render(<PiiAccessView api={createMockApi()} />);
    await screen.findByTestId("pii-tags");

    await userEvent.type(screen.getByTestId("pii-tag-table"), "curated_lots");
    await userEvent.type(screen.getByTestId("pii-tag-column"), "winner_name");
    await userEvent.selectOptions(
      screen.getByTestId("pii-tag-class"),
      "winning_bidder",
    );
    await userEvent.click(screen.getByTestId("pii-tag-btn"));

    const tags = screen.getByTestId("pii-tags");
    expect(await within(tags).findByText("winner_name")).toBeInTheDocument();

    // Untag it.
    await userEvent.click(
      screen.getByTestId("pii-untag-curated_lots.winner_name"),
    );
    await waitFor(() =>
      expect(within(tags).queryByText("winner_name")).not.toBeInTheDocument(),
    );
  });
});
