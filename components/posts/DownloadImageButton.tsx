"use client";

import { useState } from "react";

function DownloadIcon({ className = "w-3.5 h-3.5" }: { className?: string }) {
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
        d="M12 4v10m0 0 4-4m-4 4-4-4M5 20h14"
      />
    </svg>
  );
}

export function DownloadImageButton({
  imageUrl,
  filename,
  label = "Download image",
  className = "",
}: {
  imageUrl: string;
  filename: string;
  label?: string;
  className?: string;
}) {
  const [downloading, setDownloading] = useState(false);

  const download = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (downloading) return;

    setDownloading(true);
    try {
      const res = await fetch(imageUrl);
      if (!res.ok) throw new Error("fetch failed");
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = filename;
      anchor.click();
      URL.revokeObjectURL(objectUrl);
    } catch {
      window.open(imageUrl, "_blank", "noopener,noreferrer");
    } finally {
      setDownloading(false);
    }
  };

  return (
    <button
      type="button"
      onClick={download}
      disabled={downloading}
      aria-label={label}
      title={label}
      className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[11px] font-semibold border transition-colors disabled:opacity-50 text-slate-600 bg-white/70 border-white/90 hover:text-slate-800 hover:bg-white/90 ${className}`}
    >
      <DownloadIcon />
      {downloading ? "Downloading…" : "Download"}
    </button>
  );
}
