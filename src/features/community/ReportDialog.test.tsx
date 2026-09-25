import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ReportDialog, type ReportState } from "./ReportDialog";

const open = (state: ReportState) => {
  const send = vi.fn();
  const onSignIn = vi.fn();
  const onHideInstead = vi.fn();
  const onClose = vi.fn();
  const view = render(
    <ReportDialog
      state={state}
      authorName="danylo"
      send={send}
      onSignIn={onSignIn}
      onHideInstead={onHideInstead}
      onClose={onClose}
    />,
  );
  return { send, onSignIn, onHideInstead, onClose, ...view };
};

describe("ReportDialog", () => {
  it("is nothing while closed", () => {
    open("closed");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("takes a reason, a note and the author, and sends only once a reason is picked", async () => {
    const { send } = open("open");
    const dialog = screen.getByRole("dialog", { name: "Report this list" });
    expect(within(dialog).getAllByRole("radio")).toHaveLength(5);
    expect(within(dialog).getByRole("radio", { name: "Sexual content" })).toHaveFocus();
    const report = within(dialog).getByRole("button", { name: "Report" });
    expect(report).toBeDisabled();

    await userEvent.click(within(dialog).getByRole("radio", { name: "Spam or advertising" }));
    await userEvent.type(
      within(dialog).getByLabelText("Anything to add (optional)"),
      "  Sells things  ",
    );
    expect(within(dialog).getByText("16 / 500")).toBeInTheDocument();
    await userEvent.click(
      within(dialog).getByRole("checkbox", { name: "Also hide everything from danylo" }),
    );
    await userEvent.click(report);
    expect(send).toHaveBeenCalledWith("spam", "Sells things", true);
  });

  it("sends nothing for a note alone, and an empty note goes as none", async () => {
    const { send } = open("open");
    const dialog = screen.getByRole("dialog");
    await userEvent.click(within(dialog).getByRole("radio", { name: "Something else" }));
    await userEvent.click(within(dialog).getByRole("button", { name: "Report" }));
    expect(send).toHaveBeenCalledWith("other", null, false);
  });

  it("names a failure and keeps the form; while sending nothing dismisses it", async () => {
    const { onClose } = open("failed");
    expect(screen.getByRole("alert")).toHaveTextContent("nothing was sent");
    expect(screen.getByRole("button", { name: "Cancel" })).toBeEnabled();

    const sending = open("sending");
    expect(screen.getAllByRole("button", { name: "Sending…" })[0]).toBeDisabled();
    await userEvent.keyboard("{Escape}");
    expect(sending.onClose).not.toHaveBeenCalled();
    void onClose;
  });

  it("becomes the receipt once sent, and closes on Done", async () => {
    const { onClose } = open("sent");
    expect(screen.getByRole("dialog", { name: "Reported, and hidden for you" })).toHaveTextContent(
      "A person reviews reports by hand",
    );
    await userEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("asks a guest to sign in first, or to hide instead", async () => {
    const { onSignIn, onHideInstead } = open("signIn");
    const dialog = screen.getByRole("dialog", { name: "Sign in to report" });
    expect(dialog).toHaveTextContent("Reports go to a person");
    await userEvent.click(within(dialog).getByRole("button", { name: "Hide instead" }));
    expect(onHideInstead).toHaveBeenCalledTimes(1);
    await userEvent.click(within(dialog).getByRole("button", { name: "Continue with Google" }));
    expect(onSignIn).toHaveBeenCalledTimes(1);
  });

  it("closes on Escape when nothing is under way", async () => {
    const { onClose } = open("open");
    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
