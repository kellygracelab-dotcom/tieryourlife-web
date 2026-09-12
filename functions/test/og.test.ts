import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  categoryLabel,
  describeList,
  describeRanking,
  escapeHtml,
  renderPage,
  scriptJson,
} from "../src/og";

const shell = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta
      name="description"
      content="Rank anything, or take someone else's list and rank it your way."
    />
    <title>TierYourLife</title>
    <script type="module" src="/assets/index-abc.js"></script>
  </head>
  <body><div id="root"></div></body>
</html>`;

describe("words for a link", () => {
  it("name the category the way the app does, with a fallback", () => {
    assert.equal(categoryLabel("film_tv"), "Film & TV");
    assert.equal(categoryLabel("anime"), "Anime");
    assert.equal(categoryLabel("nope"), "Other");
    assert.equal(categoryLabel(undefined), "Other");
  });

  it("describe a list in one line under a hundred characters", () => {
    const line = describeList({ itemCount: 34, authorName: "danylo", category: "film_tv" });
    assert.equal(line, "34 items ranked by danylo · Film & TV");
    assert.ok(line.length < 100);
    assert.equal(
      describeList({ itemCount: 1, authorName: "  ", category: "games" }),
      "1 item ranked by someone · Games",
    );
  });

  it("describe a ranking as a visitor's take on somebody's list", () => {
    assert.equal(
      describeRanking({ placed: 8, itemCount: 34, authorName: "danylo", category: "anime" }),
      "A visitor ranked 8 of 34 items on danylo’s list · Anime",
    );
  });
});

describe("escaping", () => {
  it("keeps markup out of attributes", () => {
    assert.equal(
      escapeHtml(`<b>"Tom" & Jerry</b>`),
      "&lt;b&gt;&quot;Tom&quot; &amp; Jerry&lt;/b&gt;",
    );
  });

  it("keeps a script from being closed by its own data", () => {
    const json = scriptJson({ title: "</script><script>alert(1)</script>", sep: "\u2028" });
    assert.equal(json.includes("</script"), false);
    assert.equal(json.includes("\u2028"), false);
    assert.deepEqual(JSON.parse(json), {
      title: "</script><script>alert(1)</script>",
      sep: "\u2028",
    });
  });
});

describe("renderPage", () => {
  const page = {
    title: `Every "A24" film, ranked`,
    description: "34 items ranked by danylo · Film & TV",
    image: "https://img/cover.jpg",
    url: "https://tieryourlife-web.web.app/l/abc",
  };

  it("sets the title, the description, the OpenGraph tags and the preload", () => {
    const html = renderPage(shell, page, { kind: "list", id: "abc" });
    assert.ok(html.includes(`<title>Every &quot;A24&quot; film, ranked · TierYourLife</title>`));
    assert.ok(
      html.includes(
        `<meta name="description" content="34 items ranked by danylo · Film &amp; TV" />`,
      ),
    );
    assert.ok(
      html.includes(`<meta property="og:title" content="Every &quot;A24&quot; film, ranked" />`),
    );
    assert.ok(html.includes(`<meta property="og:image" content="https://img/cover.jpg" />`));
    assert.ok(html.includes(`<meta name="twitter:card" content="summary_large_image" />`));
    assert.ok(html.includes(`<meta property="og:site_name" content="TierYourLife" />`));
    assert.ok(
      html.includes(`<meta property="og:url" content="https://tieryourlife-web.web.app/l/abc" />`),
    );
    assert.ok(
      html.includes(
        `<script id="tyl-preload" type="application/json">{"kind":"list","id":"abc"}</script>`,
      ),
    );
    assert.ok(html.includes(`<script type="module" src="/assets/index-abc.js"></script>`));
    assert.equal(html.split("</head>").length, 2);
  });

  it("falls back to a plain summary card without a picture", () => {
    const html = renderPage(shell, { ...page, image: null }, null);
    assert.equal(html.includes("og:image"), false);
    assert.ok(html.includes(`<meta name="twitter:card" content="summary" />`));
  });
});
