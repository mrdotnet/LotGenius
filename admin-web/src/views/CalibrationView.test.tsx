import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { CalibrationView } from "./CalibrationView";
import { createMockApi } from "../api/mock";
import type { AdminApi, ReviewResponse } from "../api";

const review: ReviewResponse = {
  strangers: [
    { lot_id: 1, title: "A", now_category: "Tractor", suggested_category: "Combine", confidence: 0.28, k: 25, photo_url: null },
    { lot_id: 2, title: "B", now_category: "Tractor", suggested_category: "Combine", confidence: 0.32, k: 25, photo_url: null },
    { lot_id: 3, title: "C", now_category: "Lifts", suggested_category: "Forklifts", confidence: 0.45, k: 25, photo_url: null },
  ],
  pens: [
    { category: "Tractor", count: 100, suspect_count: 2 },
    { category: "Lifts", count: 20, suspect_count: 1 },
  ],
};

/** A mock with a deterministic review so the derived stats are stable. */
function stubApi(payload: ReviewResponse): AdminApi {
  return {
    ...createMockApi(),
    async getReview() {
      return payload;
    },
  };
}

describe("CalibrationView", () => {
  it("renders derived calibration stats from the review payload", async () => {
    render(<CalibrationView api={stubApi(review)} />);

    // Summary surfaces the stranger count.
    const summary = await screen.findByTestId("cal-summary");
    expect(within(summary).getByTestId("cal-stranger-count")).toHaveTextContent("3");

    // The histogram has exactly 10 buckets covering [0,1].
    const hist = screen.getByTestId("cal-histogram");
    expect(within(hist).getAllByTestId(/^cal-bucket-/)).toHaveLength(10);

    // Top confusion pair is Tractor→Combine (count 2).
    const confusion = screen.getByTestId("cal-confusion");
    expect(within(confusion).getAllByRole("row")[1]).toHaveTextContent("Tractor");
    expect(within(confusion).getAllByRole("row")[1]).toHaveTextContent("Combine");

    // Hottest pen (highest suspect ratio) is Lifts (1/20 > 2/100).
    const pens = screen.getByTestId("cal-pens");
    expect(within(pens).getAllByRole("row")[1]).toHaveTextContent("Lifts");
  });

  it("shows an empty state when there are no strangers", async () => {
    render(<CalibrationView api={stubApi({ strangers: [], pens: [] })} />);
    expect(await screen.findByTestId("cal-empty")).toBeInTheDocument();
  });
});
