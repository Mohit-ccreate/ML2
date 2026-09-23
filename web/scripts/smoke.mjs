import { smoke } from "../dist-smoke/smoke-entry.js";

const fail = smoke();
if (fail.length) {
  console.error("SMOKE FAIL:\n - " + fail.join("\n - "));
  process.exit(1);
}
console.log("SMOKE OK — 8 tabs rendered server-side, mock-engine unit checks passed");
