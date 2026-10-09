import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api";
import DeleteModal from "./DeleteModal";

function setup(onConfirm = vi.fn().mockResolvedValue(undefined)) {
  const onCancel = vi.fn();
  render(
    <DeleteModal visible title="Delete hosted zone?" onCancel={onCancel} onConfirm={onConfirm}>
      Delete <b>example.com</b>?
    </DeleteModal>,
  );
  return { onCancel, onConfirm, user: userEvent.setup() };
}

const deleteButton = () => screen.getByRole("button", { name: "Delete" });

describe("DeleteModal", () => {
  it("requires typing 'delete' before the Delete button is enabled", async () => {
    const { user, onConfirm } = setup();
    expect(screen.getByText("Delete hosted zone?")).toBeInTheDocument();
    expect(deleteButton()).toBeDisabled();

    await user.type(screen.getByPlaceholderText("delete"), "delet");
    expect(deleteButton()).toBeDisabled();
    await user.type(screen.getByPlaceholderText("delete"), "e");
    expect(deleteButton()).toBeEnabled();

    await user.click(deleteButton());
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it("confirms with Enter once the text matches", async () => {
    const { user, onConfirm } = setup();
    await user.type(screen.getByPlaceholderText("delete"), "delete{Enter}");
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it("shows the API error and stays open when deletion fails", async () => {
    const { user } = setup(vi.fn().mockRejectedValue(new ApiError(409, "Hosted zone is not empty.")));
    await user.type(screen.getByPlaceholderText("delete"), "delete");
    await user.click(deleteButton());
    expect(await screen.findByText("Hosted zone is not empty.")).toBeInTheDocument();
    expect(deleteButton()).toBeEnabled();
  });

  it("cancels without confirming", async () => {
    const { user, onCancel, onConfirm } = setup();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledOnce();
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
