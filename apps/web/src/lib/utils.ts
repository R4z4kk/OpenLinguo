import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

const twMerge = extendTailwindMerge({
  extend: { theme: { text: ["caption", "small", "body", "pinyin", "subtitle", "title"] } },
});

export const cn = (...inputs: ClassValue[]): string => twMerge(clsx(inputs));
