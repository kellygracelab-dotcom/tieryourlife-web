import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { bare, payloadOf, reportLimiter, violationsOf } from "../src/cspReport";

// QA S27: what a browser reports of the report-only policy, kept as a log line without a person in it.
describe("CSP reports", () => {
  it("reads the old report-uri shape, keeping no query, fragment or host of the page", () => {
    const payload = {
      "csp-report": {
        "document-uri": "https://tieryourlife.web.app/l/abc?ref=mail#top",
        "effective-directive": "script-src-elem",
        "violated-directive": "script-src",
        "blocked-uri": "https://evil.example/x.js?uid=123",
        "source-file": "https://tieryourlife.web.app/assets/index.js?v=1",
        "line-number": 12,
      },
    };
    assert.deepEqual(violationsOf(payload), [
      {
        directive: "script-src-elem",
        blocked: "https://evil.example/x.js",
        page: "/l/abc",
        source: "https://tieryourlife.web.app/assets/index.js",
        line: 12,
      },
    ]);
  });

  it("reads the Reporting API's list, and skips what is not a CSP violation", () => {
    const payload = [
      { type: "deprecation", body: { message: "x" } },
      {
        type: "csp-violation",
        body: {
          documentURL: "https://tieryourlife.web.app/me",
          effectiveDirective: "script-src-elem",
          blockedURL: "inline",
          lineNumber: 3,
        },
      },
    ];
    assert.deepEqual(violationsOf(payload), [
      { directive: "script-src-elem", blocked: "inline", page: "/me", source: null, line: 3 },
    ]);
  });

  it("takes nothing from what is no report", () => {
    for (const payload of [null, "x", 1, {}, { "csp-report": "x" }, [{ type: "csp-violation" }]]) {
      assert.deepEqual(violationsOf(payload), []);
    }
    assert.equal(bare("data:image/png;base64,AAAA"), "data");
    assert.equal(payloadOf(Buffer.from("not json"), undefined), null);
    assert.equal(payloadOf(Buffer.alloc(20_000, 32), undefined), null);
    assert.deepEqual(payloadOf(Buffer.from('{"a":1}'), undefined), { a: 1 });
  });

  it("lets so many a minute through, and says next minute how many it held", () => {
    const room = reportLimiter(2);
    assert.deepEqual(
      [room(0), room(1), room(2), room(3)].map((it) => it.write),
      [true, true, false, false],
    );
    assert.deepEqual(room(60_000), { write: true, heldBefore: 2 });
  });
});
