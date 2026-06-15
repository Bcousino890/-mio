import Image from "next/image";
import { cn } from "@/lib/utils";

type Size = "sm" | "md" | "lg" | "xl";

const widths: Record<Size, { className: string; width: number }> = {
  sm: { className: "w-40", width: 160 },
  md: { className: "w-56", width: 224 },
  lg: { className: "w-72 md:w-96", width: 384 },
  xl: { className: "w-[200px] md:w-[380px]", width: 380 },
};

// Aspect ratio of /public/logo.png after trim: 3282 x 519 ≈ 6.32:1
const ASPECT = 519 / 3282;

export function BrandLogo({
  size = "lg",
  className,
  priority = false,
}: {
  size?: Size;
  className?: string;
  priority?: boolean;
}) {
  const s = widths[size];
  return (
    <div className={cn("flex justify-center", s.className, className)}>
      <Image
        src="/logo.png"
        alt="Benjamín Cousiño Propiedades"
        width={s.width}
        height={Math.round(s.width * ASPECT)}
        priority={priority}
        className="h-auto w-full select-none drop-shadow-[0_2px_8px_rgba(248,243,233,0.85)]"
      />
    </div>
  );
}
