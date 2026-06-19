import { describe, expect, it } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "./App";
import { categoryId, makeId, modelId } from "./graph/buildGraph";
import { makeTestSource } from "./test/fixtures";

describe("App — relationship explorer", () => {
  it("loads the corpus and renders the graph + facets + source badge", async () => {
    render(<App source={makeTestSource()} />);

    await screen.findByTestId("relationship-graph");
    expect(screen.getByTestId("source-badge")).toHaveTextContent("FIXTURE");
    expect(screen.getByTestId("corpus-count")).toHaveTextContent("6 lots");

    // Category facet lists both categories with counts.
    const catFacet = screen.getByTestId("facet-category");
    expect(within(catFacet).getByTestId("facet-category-Combine")).toHaveTextContent(
      "4",
    );
    expect(within(catFacet).getByTestId("facet-category-Tractor")).toHaveTextContent(
      "2",
    );
  });

  it("filters the graph when a facet is toggled", async () => {
    render(<App source={makeTestSource()} />);
    await screen.findByTestId("relationship-graph");

    // Before filtering, the Tractor category node exists.
    expect(
      screen.getByTestId(`gnode-${categoryId("Tractor")}`),
    ).toBeInTheDocument();

    await userEvent.click(screen.getByTestId("facet-category-Combine"));

    // Now only Combine remains in the graph.
    await waitFor(() => {
      expect(
        screen.queryByTestId(`gnode-${categoryId("Tractor")}`),
      ).not.toBeInTheDocument();
    });
    expect(
      screen.getByTestId(`gnode-${categoryId("Combine")}`),
    ).toBeInTheDocument();
  });

  it("drills a make node into its member lots and shows comps for a focus lot", async () => {
    render(<App source={makeTestSource()} />);
    await screen.findByTestId("relationship-graph");

    // Select the Combine/John Deere make node → 3 member lots.
    await userEvent.click(
      screen.getByTestId(`gnode-${makeId("Combine", "John Deere")}`),
    );

    const detail = await screen.findByTestId("detail-rail");
    expect(within(detail).getByText("John Deere")).toBeInTheDocument();
    const members = within(detail).getByTestId("member-list");
    expect(within(members).getAllByRole("button")).toHaveLength(3);

    // A focus lot auto-selects → comps list renders, excluding the focus lot.
    const comps = await within(detail).findByTestId("comps-list");
    expect(within(comps).getAllByRole("listitem").length).toBeGreaterThan(0);
  });

  it("surfaces the low-confidence state when the similarity floor is unreachable", async () => {
    render(<App source={makeTestSource()} />);
    await screen.findByTestId("relationship-graph");

    // S780 is a single-lot model whose nearest neighbour sits at ~0.87 — below
    // the 95% floor — so nothing clears and the no-fabrication state shows.
    await userEvent.click(
      screen.getByTestId(`gnode-${modelId("Combine", "John Deere", "S780")}`),
    );
    await screen.findByTestId("detail-rail");

    // Raise the floor to 95% — no comp clears it on this small corpus.
    await userEvent.selectOptions(screen.getByTestId("min-similarity"), "0.95");

    await screen.findByTestId("comps-lowconf");
    expect(screen.queryByTestId("comps-list")).not.toBeInTheDocument();
  });

  it("surfaces a load error", async () => {
    const failing = {
      load: () => Promise.reject(new Error("boom")),
    };
    render(<App source={failing} />);
    const banner = await screen.findByTestId("error-banner");
    expect(banner).toHaveTextContent("boom");
  });
});
