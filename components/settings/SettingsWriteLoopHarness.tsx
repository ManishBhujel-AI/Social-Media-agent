"use client";

import { useCallback, useState } from "react";
import { createId } from "@paralleldrive/cuid2";
import { GLASS_CARD } from "@/lib/design/tokens";
import { SettingsProposalCard } from "./SettingsProposalCard";
import { SettingsChangelogPanel } from "./SettingsChangelogPanel";

/**
 * Dev harness for the settings-write loop — proves propose → confirm → apply → revert
 * without wiring the chat agent.
 */
export function SettingsWriteLoopHarness({ projectId }: { projectId: string }) {
  const [proposalVisible, setProposalVisible] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [lastEntryId, setLastEntryId] = useState<string | null>(null);

  const proposal = {
    summary: "Never use yellow or purple anywhere (test preference)",
    source: "agent" as const,
    patches: [
      {
        path: "clientPreferences",
        value: [
          {
            id: createId(),
            date: new Date().toISOString().slice(0, 10),
            scope: "client",
            note: "Never use yellow or purple — anywhere, including text, fonts, accents.",
          },
        ],
      },
      {
        path: "avoidColors",
        value: ["yellow", "purple"],
      },
    ],
  };

  const onApplied = useCallback((entryId: string) => {
    setProposalVisible(false);
    setLastEntryId(entryId);
    setRefreshKey((k) => k + 1);
  }, []);

  return (
    <div className={`${GLASS_CARD} w-full max-w-3xl mb-6`}>
      <div className="px-5 py-4 border-b border-white/70">
        <h2 className="text-sm font-semibold text-slate-800">Settings write loop (test harness)</h2>
        <p className="text-xs text-slate-500 mt-0.5">
          Simulates an agent proposal. Confirm applies via the same API the chat card will use.
        </p>
      </div>
      <div className="p-5 flex flex-col gap-4">
        {!proposalVisible ? (
          <button
            type="button"
            onClick={() => setProposalVisible(true)}
            className="self-start px-3 py-1.5 rounded-lg text-xs font-semibold bg-violet-600 text-white hover:bg-violet-700"
          >
            Simulate agent proposal
          </button>
        ) : (
          <SettingsProposalCard
            projectId={projectId}
            proposal={proposal}
            onApplied={onApplied}
            onDeclined={() => setProposalVisible(false)}
          />
        )}
        {lastEntryId ? (
          <p className="text-xs text-slate-500">
            Last applied entry: <span className="font-mono">{lastEntryId}</span> — revert from
            changelog below.
          </p>
        ) : null}
        <SettingsChangelogPanel projectId={projectId} refreshKey={refreshKey} />
      </div>
    </div>
  );
}
