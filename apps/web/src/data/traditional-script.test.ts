import { describe, expect, it } from "vitest";
import { looksTraditional, traditionalCharacters } from "./traditional-script.ts";

const SIMPLIFIED =
  "我的同学王芳和老师冯文敏去张家界玩了。她们说那里的山很高，路很长，风景很美。她们在袁家界拍了很多照片，也给我买了一件礼物。";
const TRADITIONAL =
  "我的同學王芳和老師馮文敏去張家界玩了。她們說那裡的山很高，路很長，風景很美。她們在袁家界拍了很多照片，也給我買了一件禮物。";

describe("traditionalCharacters", () => {
  it("counts the Han characters a simplified reader does not know and those of the text", () => {
    expect(traditionalCharacters("學 a 好")).toEqual({ traditional: 1, han: 2 });
    expect(traditionalCharacters("Hello, 2026!")).toEqual({ traditional: 0, han: 0 });
  });

  it("counts every occurrence, the cost being that of the distinct characters", () => {
    expect(traditionalCharacters("學學學好")).toEqual({ traditional: 3, han: 4 });
  });
});

describe("looksTraditional", () => {
  it("is false for simplified text, even with a quoted traditional phrase", () => {
    expect(looksTraditional(SIMPLIFIED)).toBe(false);
    expect(looksTraditional(`${SIMPLIFIED}他說：「我們去」。`)).toBe(false);
  });

  it("is true for traditional text", () => {
    expect(looksTraditional(TRADITIONAL)).toBe(true);
    expect(looksTraditional("我們去圖書館")).toBe(true);
  });

  it("is false when there is nothing to judge", () => {
    expect(looksTraditional("")).toBe(false);
    expect(looksTraditional("Hello, 2026!")).toBe(false);
  });
});
