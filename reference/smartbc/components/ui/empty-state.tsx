import { cn } from "@/lib/utils";

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center py-16 text-center", className)}>
      {icon && (
        <div className="mb-4 rounded-2xl border border-gold/15 bg-gold/5 p-5 text-gold/60">
          {icon}
        </div>
      )}
      <h3 className="text-sm font-semibold text-ink/75">{title}</h3>
      {description && <p className="mt-1 max-w-sm text-[12px] text-ink/45">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
