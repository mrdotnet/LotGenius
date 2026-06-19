import { describe, expect, it } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { UsersGroupsView } from "./UsersGroupsView";
import { createMockApi } from "../api/mock";

describe("UsersGroupsView", () => {
  it("lists seeded users and groups", async () => {
    render(<UsersGroupsView api={createMockApi()} />);
    expect(await screen.findByText("Nima Newhire")).toBeInTheDocument();
    const groups = await screen.findByTestId("ug-groups");
    expect(within(groups).getByText("admins")).toBeInTheDocument();
  });

  it("resolves a bare user to the default group, then reflects a new assignment", async () => {
    render(<UsersGroupsView api={createMockApi()} />);
    await screen.findByText("Nima Newhire");

    await userEvent.click(screen.getByTestId("ug-user-n.newhire@steffes.com"));

    // A user with no explicit groups still inherits the default "basic" group.
    const perms = await screen.findByTestId("ug-perms");
    await waitFor(() => expect(perms).toHaveTextContent("basic"));
    expect(screen.getByTestId("ug-perms-admin")).toHaveTextContent("No");

    // Assigning the admins group (id 4) elevates the resolved permissions.
    await userEvent.click(screen.getByTestId("ug-assign-4"));
    await waitFor(() =>
      expect(screen.getByTestId("ug-perms-admin")).toHaveTextContent("Yes"),
    );
  });

  it("never offers to delete the default group", async () => {
    render(<UsersGroupsView api={createMockApi()} />);
    await screen.findByTestId("ug-groups");
    // basic (id 1) is the default group → no delete control.
    expect(screen.queryByTestId("ug-delete-1")).not.toBeInTheDocument();
    // a non-default group can be deleted.
    expect(screen.getByTestId("ug-delete-4")).toBeInTheDocument();
  });

  it("creates a new group", async () => {
    render(<UsersGroupsView api={createMockApi()} />);
    await screen.findByTestId("ug-groups");

    await userEvent.type(screen.getByTestId("ug-new-name"), "auditors");
    await userEvent.click(screen.getByTestId("ug-create-btn"));

    expect(
      await within(screen.getByTestId("ug-groups")).findByText("auditors"),
    ).toBeInTheDocument();
  });
});
