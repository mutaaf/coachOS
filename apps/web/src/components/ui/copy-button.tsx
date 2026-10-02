"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Copies a value and says so. Used beside every address, key and link an
 * admin might need to paste somewhere else — no selecting text on a phone.
 */
export function CopyButton({
  value,
  label = "Copy",
  className,
  size = "sm",
}: {
  value: string;
  label?: string;
  className?: string;
  size?: "sm" | "md";
}) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      disabled={!value}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1800);
        } catch {
          // Clipboard blocked (an old browser, an iframe); the value is on screen.
        }
      }}
      className={cn(
        "inline-flex shrink-0 items-center justify-center gap-1.5 rounded-lg border bg-white font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-40",
        size === "sm" ? "h-10 px-3 text-xs" : "h-11 px-4 text-sm",
        className
      )}
    >
      {copied ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />}
      {copied ? "Copied" : label}
    </button>
  );
}
