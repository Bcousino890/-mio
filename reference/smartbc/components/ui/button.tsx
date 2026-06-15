import { cn } from "@/lib/utils";
import { ReactNode } from "react";

interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "default" | "outline" | "ghost";
  children: ReactNode;
}

export function Button({
  variant = "default",
  className,
  ...props
}: ButtonProps) {
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center rounded-lg px-4 py-2 text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed",
        variant === "default" &&
          "bg-blue-600 text-white hover:bg-blue-700 focus:ring-blue-500",
        variant === "outline" &&
          "border border-gray-300 bg-white text-gray-900 hover:bg-gray-50 focus:ring-gray-500",
        variant === "ghost" &&
          "text-gray-900 hover:bg-gray-100 focus:ring-gray-500",
        className
      )}
      {...props}
    />
  );
}
