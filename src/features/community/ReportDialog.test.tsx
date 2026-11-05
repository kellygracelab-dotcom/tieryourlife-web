import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ReportDialog, type ReportState } from "./ReportDialog";

const open = (state: ReportState, authorName: string | null = "danylo") => {
  const send = vi.fn();
  const onSignIn = vi.fn();
  const onHideInstead = vi.fn();
  const onClose = vi.fn();
  const view = render(
    <ReportDialog
      state={state}
      authorName={authorName}
      send={send}
      onSignIn={onSignIn}
      onHideInstead={onHideInstead}
      onClose={onClose}
    />,
  );
  return { send, onSignIn, onHideInstead, onClose, ...view };
};

describe("ReportDialog", () => {
  it("offers no author to hide when the list has none", async () => {
    const { send } = open("open", null);
    const dialog = screen.getByRole("dialog", { name: "Report this list" });
    expect(within(dialog).queryByRole("checkbox")).toBeNull();
    await userEvent.click(within(dialog).getByRole("radio", { name: "Spam or advertising" }));
    await userEvent.click(within(dialog).getByRole("button", { name: "Report" }));
    expect(send).toHaveBeenCalledWith("spam", null, false);
  });

  it("is nothing while closed", () => {
    open("closed");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("opens afresh after a cancel: no reason, note or tick kept from before", async () => {
    const props = {
      authorName: "danylo",
      send: vi.fn(),
      onSignIn: vi.fn(),
      onHideInstead: vi.fn(),
      onClose: vi.fn(),
    };
    const { rerender } = render(<ReportDialog state="open" {...props} />);
    const dialog = screen.getByRole("dialog", { name: "Report this list" });
    // The dialog is the box, never the form inside it.
    expect(dialog.tagName).toBe("DIV");
    await userEvent.click(within(dialog).getByRole("radio", { name: "Spam or advertising" }));
    await userEvent.type(within(dialog).getByLabelText("Anything to add (optional)"), "ads");
    await userEvent.click(within(dialog).getByRole("checkbox"));
    rerender(<ReportDialog state="closed" {...props} />);
    rerender(<ReportDialog state="open" {...props} />);
    const again = screen.getByRole("dialog", { name: "Report this list" });
    expect(within(again).getByRole("radio", { name: "Spam or advertising" })).not.toBeChecked();
    expect(within(again).getByLabelText("Anything to add (optional)")).toHaveValue("");
    expect(within(again).getByRole("checkbox")).not.toBeChecked();
  });

  it("takes a reason, a note and the author, and sends only once a reason is picked", async () => {
    const { send } = open("open");
    const dialog = screen.getByRole("dialog", { name: "Report this list" });
    // The app's five, in its order: a list in the wrong place is not hidden.
    expect(
      within(dialog)
        .getAllByRole("radio")
        .map((radio) => radio.getAttribute("aria-label") ?? radio.closest("label")?.textContent),
    ).toEqual([
      "Sexual content",
      "Violence or shocking content",
      "Hate or harassment",
      "Spam or advertising",
      "Something else",
    ]);
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

  it("holds the focus at every step, and gives it back to what opened it", async () => {
    const props = {
      authorName: "danylo",
      send: vi.fn(),
      onSignIn: vi.fn(),
      onHideInstead: vi.fn(),
      onClose: vi.fn(),
    };
    const at = (state: ReportState) => (
      <>
        <button type="button">More about this list</button>
        <button type="button">Behind the dialog</button>
        <ReportDialog state={state} {...props} />
      </>
    );
    const { rerender } = render(at("closed"));
    screen.getByRole("button", { name: "More about this list" }).focus();

    // A guest is asked first; the question takes the focus, has a Cancel, and keeps Tab in.
    rerender(at("signIn"));
    const ask = screen.getByRole("dialog", { name: "Sign in to report" });
    expect(within(ask).getByRole("button", { name: "Continue with Google" })).toHaveFocus();
    await userEvent.tab();
    expect(within(ask).getByRole("button", { name: "Cancel" })).toHaveFocus();
    await userEvent.tab({ shift: true });
    expect(within(ask).getByRole("button", { name: "Continue with Google" })).toHaveFocus();

    rerender(at("open"));
    const form = screen.getByRole("dialog", { name: "Report this list" });
    expect(within(form).getByRole("radio", { name: "Sexual content" })).toHaveFocus();
    within(form).getByRole("button", { name: "Cancel" }).focus();
    await userEvent.tab();
    expect(form).toContainElement(document.activeElement as HTMLElement);

    // A refused send gives the button back; the receipt takes the focus too.
    await userEvent.click(within(form).getByRole("radio", { name: "Spam or advertising" }));
    rerender(at("sending"));
    rerender(at("failed"));
    expect(screen.getByRole("button", { name: "Report" })).toHaveFocus();
    rerender(at("sent"));
    expect(screen.getByRole("button", { name: "Done" })).toHaveFocus();

    rerender(at("closed"));
    expect(screen.getByRole("button", { name: "More about this list" })).toHaveFocus();
  });

  it("closes on Escape when nothing is under way", async () => {
    const { onClose } = open("open");
    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
