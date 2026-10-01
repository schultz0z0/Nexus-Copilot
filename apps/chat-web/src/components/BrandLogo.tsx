import { cn } from "@/lib/utils";

/** Original artwork supplied in docs/brandbook; never redraw or stretch. */
export function BrandLogo({
  symbol = false,
  className,
  decorative = false,
}: {
  symbol?: boolean;
  className?: string;
  decorative?: boolean;
}) {
  return (
    <img
      src={symbol ? "/brand/prometeus-symbol.png" : "/brand/prometeus-logo.png"}
      width={symbol ? 500 : 322}
      height={symbol ? 500 : 88}
      alt={decorative ? "" : "Prometeus"}
      className={cn("object-contain shrink-0", symbol ? "h-16 w-16" : "h-auto w-40", className)}
      draggable={false}
    />
  );
}
