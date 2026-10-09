import { formatProblem, freshnessProblems } from "./freshness.ts";
import { formatManifestError, manifestPath, readManifest } from "./manifest.ts";

const manifest = await readManifest(manifestPath);
if (!manifest.ok) {
  console.error(formatManifestError(manifest.error));
  process.exitCode = 1;
} else {
  const problems = freshnessProblems(manifest.value, new Date());
  for (const problem of problems) console.error(formatProblem(problem));
  if (problems.length > 0) {
    process.exitCode = 1;
  } else {
    console.log(`${String(Object.keys(manifest.value).length)} dataset(s) within their max age.`);
  }
}
