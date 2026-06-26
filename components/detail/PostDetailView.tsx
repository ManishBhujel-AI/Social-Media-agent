"use client";

import { useState } from "react";
import Link from "next/link";
import type { Generation, Task } from "@prisma/client";
import { GLASS_CARD, PAGE_PADDING, taskStatusToKey } from "@/lib/design/tokens";
import { getProductResearchInfo } from "@/lib/ai/productContext";
import { PostThumbnail, StatusChip } from "@/components/posts/PostThumbnail";
import { ProductResearchPanel } from "@/components/posts/ProductResearchPanel";

type TaskFull = Task & {
  generations: Generation[];
  captionRevisions: { caption: string; feedback: string | null; createdAt: Date }[];
};

export function PostDetailView({ task }: { task: TaskFull }) {
  const [version, setVersion] = useState(Math.max(0, task.generations.length - 1));
  const gen = task.generations[version];
  const key = taskStatusToKey(task.status);
  const researchInfo = getProductResearchInfo(task.productSummary);

  return (
    <div className={`${PAGE_PADDING} flex gap-5 flex-wrap items-start`}>
      <div className="flex-[1.3] min-w-[420px] flex flex-col gap-4">
        <div className={GLASS_CARD + " p-5"}>
          <div className="h-[320px]">
            <PostThumbnail
              seed={task.orderIndex}
              height="320px"
              label={gen ? `graphic v${version + 1}` : undefined}
              imageUrl={gen?.imagePath}
            />
          </div>
          <div className="mt-3.5">
            <div className="text-xs font-semibold text-slate-400 mb-2">GRAPHIC VERSIONS</div>
            <div className="flex gap-2.5 flex-wrap">
              {task.generations.map((g, i) => (
                <button
                  key={g.id}
                  type="button"
                  onClick={() => setVersion(i)}
                  className="w-[78px] flex-none"
                >
                  <div
                    className={`w-[78px] h-[78px] rounded-xl overflow-hidden border-2 ${
                      i === version ? "border-blue-500 shadow-[0_4px_12px_rgba(59,130,246,0.28)]" : "border-transparent"
                    }`}
                  >
                    <PostThumbnail seed={i} height="78px" imageUrl={g.imagePath} />
                  </div>
                  <div
                    className={`text-[11px] font-semibold text-center mt-1 ${
                      i === version ? "text-blue-600" : "text-slate-500"
                    }`}
                  >
                    v{i + 1}
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className={GLASS_CARD + " p-5"}>
          <div className="text-xs font-semibold text-slate-400 mb-2">IMAGE PROMPT USED</div>
          <div className="text-[13px] leading-relaxed text-slate-700 font-mono p-3 rounded-xl bg-white/55 border border-white/85">
            {gen?.prompt ?? task.imagePrompt ?? "—"}
          </div>
        </div>
      </div>

      <div className="flex-1 min-w-[330px] flex flex-col gap-4">
        <div className={GLASS_CARD + " p-5"}>
          <div className="flex justify-between mb-3">
            <StatusChip statusKey={key} />
            <span className="text-[11px] font-semibold text-slate-400">Post {task.orderIndex + 1}</span>
          </div>
          <div className="text-sm leading-relaxed whitespace-pre-wrap">{task.caption ?? "—"}</div>
          <div className="flex gap-2 mt-3.5">
            <button
              type="button"
              onClick={() => navigator.clipboard.writeText(task.caption ?? "")}
              className="px-3.5 py-2 rounded-[10px] text-xs font-semibold text-slate-600 bg-white/60 border border-white/85"
            >
              Copy caption
            </button>
            <Link
              href={`/project/${task.projectId}/approve`}
              className="px-3.5 py-2 rounded-[10px] text-xs font-semibold text-slate-600 bg-white/60 border border-white/85"
            >
              Review
            </Link>
          </div>
        </div>
        {researchInfo ? (
          <div className={GLASS_CARD + " p-5"}>
            <div className="text-xs font-semibold text-slate-400 mb-2">PRODUCT RESEARCH</div>
            <ProductResearchPanel productSummary={task.productSummary} />
          </div>
        ) : null}
        <div className={GLASS_CARD + " p-5"}>
          <div className="text-xs font-semibold text-slate-400 mb-3">FEEDBACK & AGENT NOTES</div>
          {task.generations
            .filter((g) => g.feedback || g.agentNote)
            .map((g) => (
              <div key={g.id} className="mb-3 text-xs">
                {g.feedback && <p className="text-slate-600">You: {g.feedback}</p>}
                {g.agentNote && <p className="text-green-700 mt-1">Agent: {g.agentNote}</p>}
              </div>
            ))}
          {task.captionRevisions.map((r) => (
            <div key={r.caption} className="mb-3 text-xs text-slate-600">
              Caption revision: {r.feedback}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
