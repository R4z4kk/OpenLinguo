import { err } from "@openlinguo/core";
import type { FileReader } from "../run.ts";

/** For builds that read no file of another dataset. */
export const noFile: FileReader = (dataset, name) =>
  Promise.resolve(err(`unexpected read of ${dataset}/${name}`));
