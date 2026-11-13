import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AboutButton, AboutPicture, hasAbout, openPage, pageOf, PictureMenu } from "./AboutPicture";

afterEach(() => vi.restoreAllMocks());

describe("what a card's picture says about itself", () => {
  it("is something when it names a person, a licence, a page, TMDB or an old credit", () => {
    expect(hasAbout({ attribution: { source: "wikimedia", author: "Jane" } })).toBe(true);
    expect(hasAbout({ attribution: { source: "wikimedia", license: "CC BY" } })).toBe(true);
    expect(hasAbout({ attribution: { source: "web", link: "https://site.test/p" } })).toBe(true);
    expect(hasAbout({ attribution: { source: "tmdb" } })).toBe(true);
    expect(hasAbout({ credit: "Jane, CC BY" })).toBe(true);
    expect(hasAbout({ attribution: { source: "web" } })).toBe(false);
    expect(hasAbout({ attribution: { source: "web", id: "x:1" }, credit: "  " })).toBe(false);
    expect(hasAbout({})).toBe(false);
  });

  it("names the page the picture is from, if it says one", () => {
    expect(pageOf({ attribution: { source: "web", link: "https://site.test/p" } })).toBe(
      "https://site.test/p",
    );
    expect(pageOf({ attribution: { source: "web" } })).toBeNull();
    expect(pageOf({ credit: "https://site.test/p" })).toBeNull();
  });

  it("opens the page in a tab of its own, without a way back to this one", () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    openPage("https://site.test/p");
    expect(open).toHaveBeenCalledWith("https://site.test/p", "_blank", "noopener,noreferrer");
  });
});

describe("About the picture", () => {
  it("names an IGDB cover's source IGDB.com, a link to its page or to IGDB", () => {
    const { unmount } = render(
      <AboutPicture name="The Witcher 3" attribution={{ source: "igdb" }} onClose={vi.fn()} />,
    );
    const dialog = screen.getByRole("dialog", { name: "The Witcher 3" });
    expect(within(dialog).getByRole("term")).toHaveTextContent("From");
    expect(within(dialog).getByRole("link", { name: "IGDB.com" })).toHaveAttribute(
      "href",
      "https://www.igdb.com",
    );
    unmount();
    render(
      <AboutPicture
        name="The Witcher 3"
        attribution={{ source: "igdb", link: "https://www.igdb.com/games/the-witcher-3" }}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByRole("link", { name: "IGDB.com" })).toHaveAttribute(
      "href",
      "https://www.igdb.com/games/the-witcher-3",
    );
    // So an IGDB cover always has something to say.
    expect(hasAbout({ attribution: { source: "igdb" } })).toBe(true);
  });

  it("shows who took it, its licence and the page it is from, each a row", () => {
    const onClose = vi.fn();
    render(
      <AboutPicture
        name="Red fox"
        attribution={{
          source: "wikimedia",
          author: "Jane Doe",
          license: "CC BY-SA 4.0",
          licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/",
          link: "https://www.commons.example.org/wiki/File:Fox.jpg",
        }}
        credit="old words"
        onClose={onClose}
      />,
    );
    const dialog = screen.getByRole("dialog", { name: "Red fox" });
    const rows = within(dialog)
      .getAllByRole("term")
      .map((term) => term.textContent);
    expect(rows).toEqual(["Photo", "Licence", "From"]);
    expect(dialog).toHaveTextContent("Jane Doe");
    expect(within(dialog).getByRole("link", { name: "CC BY-SA 4.0" })).toHaveAttribute(
      "href",
      "https://creativecommons.org/licenses/by-sa/4.0/",
    );
    expect(within(dialog).getByRole("link", { name: "commons.example.org" })).toHaveAttribute(
      "href",
      "https://www.commons.example.org/wiki/File:Fox.jpg",
    );
    // An attribution that says something takes the old words' place.
    expect(dialog).not.toHaveTextContent("old words");
    expect(dialog).not.toHaveTextContent("TMDB");
    fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalled();
  });

  it("leaves out the rows it has nothing for, and the licence unlinked without its address", () => {
    render(
      <AboutPicture
        name="Fox"
        attribution={{ source: "inaturalist", license: "CC0" }}
        onClose={vi.fn()}
      />,
    );
    const dialog = screen.getByRole("dialog", { name: "Fox" });
    expect(
      within(dialog)
        .getAllByRole("term")
        .map((term) => term.textContent),
    ).toEqual(["Licence"]);
    expect(within(dialog).queryByRole("link")).toBeNull();
  });

  it("adds TMDB's logo and their sentence, in English, by the source and not by the host", () => {
    const { unmount } = render(
      <AboutPicture
        name="Dune"
        attribution={{ source: "tmdb", link: "https://www.themoviedb.org/movie/438631" }}
        onClose={vi.fn()}
      />,
    );
    const dialog = screen.getByRole("dialog", { name: "Dune" });
    expect(within(dialog).getByRole("img", { name: "TMDB" })).toBeInTheDocument();
    const sentence = within(dialog).getByText(
      "This product uses the TMDB API but is not endorsed or certified by TMDB.",
    );
    expect(sentence).toHaveAttribute("lang", "en");
    unmount();

    // A picture kept from TMDB's host by somebody's own link is not TMDB's.
    render(
      <AboutPicture
        name="Dune"
        attribution={{ source: "web", link: "https://image.tmdb.org/t/p/w500/a.jpg" }}
        onClose={vi.fn()}
      />,
    );
    expect(screen.queryByRole("img", { name: "TMDB" })).toBeNull();
  });

  it("shows a card's old credit when there is no attribution, its addresses links", () => {
    render(
      <AboutPicture
        name="Fox"
        attribution={null}
        credit="Jane Doe https://creativecommons.org/licenses/by/4.0/"
        onClose={vi.fn()}
      />,
    );
    const dialog = screen.getByRole("dialog", { name: "Fox" });
    expect(dialog).toHaveTextContent("Jane Doe");
    expect(
      within(dialog).getByRole("link", { name: "https://creativecommons.org/licenses/by/4.0/" }),
    ).toBeInTheDocument();
    expect(within(dialog).queryByRole("term")).toBeNull();
  });

  it("shows the old credit with an attribution that says nothing", () => {
    render(
      <AboutPicture name="Fox" attribution={{ source: "web" }} credit="Jane" onClose={vi.fn()} />,
    );
    expect(screen.getByRole("dialog", { name: "Fox" })).toHaveTextContent("Jane");
  });

  it("opens beside the point it was asked from, inside the window", () => {
    render(
      <AboutPicture
        name="Fox"
        attribution={{ source: "wikimedia", author: "Jane" }}
        anchor={{ x: 20, y: 30 }}
        onClose={vi.fn()}
      />,
    );
    const dialog = screen.getByRole("dialog", { name: "Fox" });
    expect(dialog).toHaveStyle({ position: "fixed", left: "20px", top: "34px" });
    expect(document.querySelector(".scrim--clear")).not.toBeNull();
  });

  it("draws the picture large when asked", () => {
    render(
      <AboutPicture
        name="Fox"
        credit="Jane"
        imageUrl="https://img.test/fox.jpg"
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByRole("dialog", { name: "Fox" }).querySelector("img")).toHaveAttribute(
      "src",
      "https://img.test/fox.jpg",
    );
  });
});

describe("the «i» on a card", () => {
  it("is named for the card, and opens beside it", async () => {
    const onOpen = vi.fn();
    render(<AboutButton name="Fox" onOpen={onOpen} />);
    await userEvent.click(screen.getByRole("button", { name: "About the picture of Fox" }));
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ x: expect.any(Number) }));
  });
});

describe("the right-click menu of a card one only looks at", () => {
  it("offers About the picture and Open its page, and closes once one is chosen", async () => {
    const onAbout = vi.fn();
    const onOpenPage = vi.fn();
    const onClose = vi.fn();
    render(
      <PictureMenu
        name="Fox"
        at={{ x: 10, y: 10 }}
        onAbout={onAbout}
        onOpenPage={onOpenPage}
        onClose={onClose}
      />,
    );
    const menu = screen.getByRole("menu", { name: "Fox" });
    const items = within(menu).getAllByRole("menuitem");
    expect(items.map((item) => item.textContent)).toEqual(["About the picture", "Open its page"]);
    expect(items[0]).toHaveFocus();
    await userEvent.keyboard("{ArrowDown}");
    expect(items[1]).toHaveFocus();
    await userEvent.keyboard("{ArrowDown}");
    expect(items[0]).toHaveFocus();
    await userEvent.keyboard("{ArrowUp}");
    expect(items[1]).toHaveFocus();
    await userEvent.click(items[1]!);
    expect(onClose).toHaveBeenCalled();
    expect(onOpenPage).toHaveBeenCalled();
    expect(onAbout).not.toHaveBeenCalled();
  });

  it("offers only what there is, and closes on Escape, a press elsewhere, a scroll or a resize", async () => {
    const onClose = vi.fn();
    render(<PictureMenu name="Fox" at={{ x: 10, y: 10 }} onAbout={vi.fn()} onClose={onClose} />);
    expect(screen.getAllByRole("menuitem")).toHaveLength(1);
    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.pointerDown(document.body);
    expect(onClose).toHaveBeenCalledTimes(2);
    fireEvent.pointerDown(screen.getByRole("menuitem"));
    expect(onClose).toHaveBeenCalledTimes(2);
    fireEvent.scroll(window);
    fireEvent(window, new Event("resize"));
    expect(onClose).toHaveBeenCalledTimes(4);
  });
});
