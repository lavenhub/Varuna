import { cn } from "@/lib/utils";

/** Varuna wordmark glyph — a droplet over a survey grid. */
export function OilyMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={cn("shrink-0", className)} aria-hidden>
      <rect x="1" y="1" width="30" height="30" rx="6" fill="currentColor" opacity="0.1" />
      <rect x="1.5" y="1.5" width="29" height="29" rx="5.5" fill="none" stroke="currentColor" strokeOpacity="0.35" />
      <path d="M6 22h20M6 26h20" stroke="var(--cyan)" strokeOpacity="0.6" strokeWidth="1" />
      <path
        d="M16 5.5c3.6 4.2 6.2 7.3 6.2 10.6a6.2 6.2 0 1 1-12.4 0c0-3.3 2.6-6.4 6.2-10.6Z"
        fill="var(--cyan)"
      />
      <circle cx="16" cy="17.4" r="2.1" fill="var(--navy)" opacity="0.75" />
    </svg>
  );
}

export function OilyWordmark({ className }: { className?: string }) {
  return (
    <span className={cn("flex items-center gap-2.5", className)}>
      <OilyMark className="size-8 text-navy" />
      <span>
        <span className="block text-lg font-semibold tracking-[0.16em]">VARUNA</span>
        <span className="block text-[10px] uppercase tracking-wider text-muted-foreground">
          Spill Intelligence
        </span>
      </span>
    </span>
  );
}
