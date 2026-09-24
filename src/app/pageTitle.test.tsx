import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PageTitleContext, usePageTitle } from "./pageTitle";

function Page({ title }: { title: string | null }) {
  usePageTitle(title);
  return null;
}

describe("usePageTitle", () => {
  it("hands the title to the shell, follows a change, and takes it back when the page goes", () => {
    const set = vi.fn();
    const { rerender, unmount } = render(
      <PageTitleContext.Provider value={set}>
        <Page title="Every A24 film, ranked" />
      </PageTitleContext.Provider>,
    );
    expect(set).toHaveBeenLastCalledWith("Every A24 film, ranked");
    rerender(
      <PageTitleContext.Provider value={set}>
        <Page title="Ghibli, ranked" />
      </PageTitleContext.Provider>,
    );
    expect(set).toHaveBeenLastCalledWith("Ghibli, ranked");
    unmount();
    expect(set).toHaveBeenLastCalledWith(null);
  });

  it("is harmless on a page rendered without the shell", () => {
    expect(() => render(<Page title="Anything" />)).not.toThrow();
  });
});
