import { LUXURY_CARD_CLASS } from "@/lib/constants";
import { cn } from "@/lib/utils";

type CardElement = "section" | "article" | "div" | "aside";

type Props = {
  as?: CardElement;
  className?: string;
  children?: React.ReactNode;
} & React.HTMLAttributes<HTMLElement>;

/**
 * Reusable luxury surface used for all panels, modals and grouped content.
 * Renders a `<section>` by default — pass `as` to use a different element.
 *
 * Default padding / spacing is intentionally NOT included so each callsite
 * can keep its own (some are p-5, some p-6, some have asymmetric padding).
 */
export function Card({
  as: Tag = "section",
  className,
  ...rest
}: Props) {
  return (
    <Tag {...rest} className={cn(LUXURY_CARD_CLASS, className)} />
  );
}
