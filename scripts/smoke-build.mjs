// Exercise the production bundle, including lazy chunks, without contacting live accounts or APIs.
import { chromium } from "@playwright/test";
import { preview } from "vite";
const server = await preview({ preview: { host: "127.0.0.1", port: 0, open: false } });
try {
  const origin = "http://127.0.0.1:" + server.httpServer.address().port;
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("**/*", (route) =>
      new URL(route.request().url()).origin === origin ? route.continue() : route.abort(),
    );
    await page.goto(origin + "/about");
    await page.locator("nav.site-tabs").first().waitFor({ state: "attached" });
    await page.locator("main h1").first().waitFor();
    if (errors.length) throw Error(errors.join("\n"));
    console.log("The production bundle rendered the About page in Chromium.");
  } finally {
    await browser.close();
  }
} finally {
  await server.close();
}
