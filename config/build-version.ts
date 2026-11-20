import { execFileSync } from "node:child_process";

/** The global the site reads its own version from (src/lib/usageSwitch.ts). */
export const BUILD_VERSION_GLOBAL = "__TYL_BUILD__";

const git = (args: string[]): string | null => {
  try {
    return execFileSync("git", args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
};

/**
 * The site's version as its usage statistics name it: the day of the commit it
 * is built from and the commit's first seven characters, `2026.11.20-327ea66`.
 * Both come from the commit, not the clock, so the same commit always builds
 * the same bytes. Without git it is `dev`.
 */
export function buildVersion(read: (args: string[]) => string | null = git): string {
  const sha = read(["rev-parse", "--short=7", "HEAD"]);
  const day = read(["log", "-1", "--format=%cd", "--date=format:%Y.%m.%d"]);
  if (
    sha === null ||
    day === null ||
    !/^[0-9a-f]{7}$/.test(sha) ||
    !/^\d{4}\.\d{2}\.\d{2}$/.test(day)
  ) {
    return "dev";
  }
  return `${day}-${sha}`;
}

export const buildVersionDefine = (): Record<string, string> => ({
  [BUILD_VERSION_GLOBAL]: JSON.stringify(buildVersion()),
});
