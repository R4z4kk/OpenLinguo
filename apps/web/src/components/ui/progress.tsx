import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

export const Progress = ({ className, ...props }: ComponentProps<"progress">) => (
  <progress
    className={cn(
      "h-2 w-full appearance-none overflow-hidden rounded-full bg-sunken [&::-moz-progress-bar]:bg-ink [&::-webkit-progress-bar]:bg-sunken [&::-webkit-progress-value]:bg-ink",
      className,
    )}
    {...props}
  />
);
