import * as React from "react";
import { cn } from "cn";

type ResponsiveDateInputProps = Omit<React.ComponentProps<"input">, "type"> & {
  type?: "date" | "month";
};

export function ResponsiveDateInput({
  type = "date",
  className,
  style,
  ...props
}: ResponsiveDateInputProps) {
  return (
    <span className="flex w-full min-w-0 max-w-full">
      <input
        {...props}
        type={type}
        className={cn(className)}
        style={{
          ...style,
          width: 0,
          minWidth: 0,
          maxWidth: "100%",
          flex: "1 1 0%",
        }}
      />
    </span>
  );
}
