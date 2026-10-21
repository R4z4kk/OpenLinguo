import { beforeEach, describe, expect, it } from "vitest";
import {
  clearStagedFile,
  rememberSaved,
  stageFile,
  stagedFile,
  takeSaved,
  type StagedFile,
} from "./text-handoff.ts";

const FILE: StagedFile = { name: "新闻.txt", bytes: 4, encoding: "GB18030", text: "你好" };

beforeEach(() => {
  clearStagedFile();
  takeSaved();
});

describe("staged file", () => {
  it("holds the file until the form is left", () => {
    expect(stagedFile()).toBeNull();
    stageFile(FILE);
    expect(stagedFile()).toBe(FILE);
    expect(stagedFile()).toBe(FILE);
    clearStagedFile();
    expect(stagedFile()).toBeNull();
  });
});

describe("saved title", () => {
  it("is given once, to the library that opens next", () => {
    expect(takeSaved()).toBeNull();
    rememberSaved("周末");
    expect(takeSaved()).toBe("周末");
    expect(takeSaved()).toBeNull();
  });
});
