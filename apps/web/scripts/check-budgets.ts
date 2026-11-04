// Fails when the production build in dist/ exceeds a size budget of src/build/budgets.ts.
import { fileURLToPath } from "node:url";
import { BUDGETS_DATED, SIZE_BUDGETS } from "../src/build/budgets.ts";
import { describeOverrun, measureBuild, overruns } from "../src/build/bundle-budgets.ts";

const measures = await measureBuild(fileURLToPath(new URL("../dist", import.meta.url)));
if (!measures.ok) {
  console.error(`budgets: ${measures.error}`);
  process.exit(1);
}
for (const { id, label, limit } of SIZE_BUDGETS) {
  console.log(`budgets: ${label}: ${String(measures.value[id])} of ${String(limit)} bytes`);
}
const exceeded = overruns(measures.value, SIZE_BUDGETS);
if (exceeded.length > 0) {
  for (const overrun of exceeded) console.error(`budgets: ${describeOverrun(overrun)}`);
  console.error(`budgets: limits set ${BUDGETS_DATED} in src/build/budgets.ts`);
  process.exit(1);
}
