"use client";

import { useState } from "react";

function ClipboardIcon({ className = "w-3.5 h-3.5" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      className={className}
      aria-hidden
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M8 8V5.2A1.2 1.2 0 0 1 9.2 4h9.6A1.2 1.2 0 0 1 20 5.2v9.6a1.2 1.2 0 0 1-1.2 1.2H16M6 8h9.6A1.2 1.2 0 0 1 16.8 9.2v9.6a1.2 1.2 0 0 1-1.2 1.2H6.8A1.2 1.2 0 0 1 5.6 18V9.2A1.2 1.2 0 0 1 6.8 8H6Z"
      />
    </svg>
  );
}

function CheckIcon({ className = "w-3.5 h-3.5" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      className={className}
      aria-hidden
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
    </svg>
  );
}

export function CopyTextButton({
  text,
  label = "Copy",
  className = "",
}: {
  text: string;
  label?: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);

  const copy = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!text.trim()) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* ignore */
    }
  };

  return (
    <button
      type="button"
      onClick={copy}
      aria-label={copied ? "Copied" : label}
      title={copied ? "Copied" : label}
      className={`inline-flex items-center justify-center shrink-0 w-6 h-6 rounded-md border transition-colors ${
        copied
          ? "text-emerald-700 bg-emerald-500/10 border-emerald-500/25"
          : "text-slate-500 bg-white/70 border-white/90 hover:text-slate-700 hover:bg-white/90"
      } ${className}`}
    >
      {copied ? <CheckIcon /> : <ClipboardIcon />}
    </button>
  );
}
