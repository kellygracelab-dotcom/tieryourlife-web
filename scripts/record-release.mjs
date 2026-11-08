import { cache, readJson, saveJson } from "./release-artifact.mjs";
import { assertRevision } from "./release-checks.mjs";
import { deployedFunctions } from "./release-scope.mjs";

const m = readJson(cache + "/manifest.json");
assertRevision(".", m.sha);
saveJson(cache + "/receipt.json", {
  schema: 1,
  sha: m.sha,
  run: m.run,
  inputs: m.inputs,
  versions: deployedFunctions(),
});
