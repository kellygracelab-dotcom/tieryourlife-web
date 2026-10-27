// Makes the icon font the site serves itself: Material Symbols Outlined cut
// down to the names in src/ui/icons.ts. Run it after adding an icon there:
//   node scripts/icons.mjs
// Google draws the subset; the file is kept in public/fonts, the list it
// was made from beside this script, and a config test fails while they disagree.
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

const source = readFileSync("src/ui/icons.ts", "utf8");
const block = /export const ICONS = \[([\s\S]*?)\] as const;/.exec(source)?.[1] ?? "";
const names = [...block.matchAll(/"([a-z0-9_]+)"/g)].map((match) => match[1]).sort();
if (names.length === 0) throw new Error("No icons found in src/ui/icons.ts");

const css = await (
  await fetch(
    "https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,400,0,0" +
      `&icon_names=${names.join(",")}&display=block`,
    // A current browser's name: the answer is woff2 only for one that takes it.
    {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140 Safari/537.36",
      },
    },
  )
).text();
const url = /url\((https:[^)]+)\) format\('woff2'\)/.exec(css)?.[1];
if (url === undefined) throw new Error(`No woff2 in Google's answer:\n${css}`);
const font = Buffer.from(await (await fetch(url)).arrayBuffer());
writeFileSync("public/fonts/material-symbols-outlined.woff2", font);
writeFileSync("scripts/material-symbols-outlined.icons.txt", `${names.join("\n")}\n`);
// The address carries the font's fingerprint: browsers keep fonts for a week,
// and one kept from before an icon was added drew that icon as its name.
const version = createHash("sha256").update(font).digest("hex").slice(0, 10);
for (const file of ["index.html", "src/index.css"]) {
  const text = readFileSync(file, "utf8");
  const versioned = `material-symbols-outlined.woff2?v=${version}`;
  writeFileSync(file, text.replace(/material-symbols-outlined\.woff2(\?v=[0-9a-f]+)?/g, versioned));
}
console.log(`${names.length} icons, ${font.length} bytes`);
