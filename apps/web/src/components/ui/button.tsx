import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-control px-4 font-semibold transition-colors disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        default: "bg-ink text-on-ink hover:bg-ink/90",
        outline: "border border-border-strong bg-surface text-ink hover:bg-sunken",
        ghost: "text-ink hover:bg-sunken",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

export const Button = ({
  className,
  variant,
  type = "button",
  ...props
}: ComponentProps<"button"> & VariantProps<typeof buttonVariants>) => (
  <button type={type} className={cn(buttonVariants({ variant }), className)} {...props} />
);
