import { openRouterChat, parseOpenRouterChatStream, type ChatMessage, type ToolDef } from "./openrouter";
import { parseModelJson } from "./parseJson";
import { RetryableError } from "./errors";
import { throwIfAborted } from "./abort";

export type AssistantToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

export type LoopMessage = ChatMessage & {
  tool_calls?: AssistantToolCall[];
};

export type AgentLoopState = {
  messages: LoopMessage[];
  stepCount: number;
  pendingToolCallId?: string;
  pausedAtTool?: string;
};

export type ToolHandlerResult =
  | string
  | {
      content: string;
      pause?: boolean;
    };

export type AgentTurnResult = {
  content?: string;
  tool_calls?: AssistantToolCall[];
};

export type CompleteTurnFn = (
  messages: LoopMessage[],
  tools: ToolDef[]
) => Promise<AgentTurnResult>;

export type RunAgentLoopParams = {
  model: string;
  systemPrompt: string;
  messages: LoopMessage[];
  tools: ToolDef[];
  toolHandlers: Record<string, (args: Record<string, unknown>) => Promise<ToolHandlerResult>>;
  maxSteps: number;
  onTurnStart?: (info: { step: number }) => Promise<void>;
  onStep?: (info: {
    step: number;
    toolName?: string;
    toolArgs?: Record<string, unknown>;
  }) => Promise<void>;
  onToken?: (chunk: string) => void;
  /** Stream assistant content tokens on non-tool turns (planning chat). */
  streamTokens?: boolean;
  signal?: AbortSignal;
  /** Return true to stop the loop and save checkpoint (user pause). */
  shouldAbort?: () => boolean | Promise<boolean>;
  persistState?: (state: AgentLoopState) => Promise<void>;
  /** Inject for tests; defaults to OpenRouter chat completions. */
  completeTurn?: CompleteTurnFn;
};

export type AgentLoopResult = {
  messages: LoopMessage[];
  state: AgentLoopState;
  done: boolean;
  paused: boolean;
  exhausted?: boolean;
  aborted?: boolean;
  finalContent?: string;
};

export function parseToolArguments(raw: string | undefined): Record<string, unknown> {
  if (!raw?.trim()) return {};
  try {
    return parseModelJson<Record<string, unknown>>(raw, "tool_arguments");
  } catch {
    try {
      return JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
}

export function serializeAgentState(state: AgentLoopState): object {
  return {
    messages: state.messages,
    stepCount: state.stepCount,
    pendingToolCallId: state.pendingToolCallId,
    pausedAtTool: state.pausedAtTool,
  };
}

export function deserializeAgentState(raw: unknown): AgentLoopState | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  if (!Array.isArray(obj.messages) || typeof obj.stepCount !== "number") return null;
  return {
    messages: obj.messages as LoopMessage[],
    stepCount: obj.stepCount,
    pendingToolCallId:
      typeof obj.pendingToolCallId === "string" ? obj.pendingToolCallId : undefined,
    pausedAtTool: typeof obj.pausedAtTool === "string" ? obj.pausedAtTool : undefined,
  };
}

/** Append a user answer as the tool result for a paused askUser call. */
export function appendResumeToolResult(
  state: AgentLoopState,
  userReply: string
): AgentLoopState {
  if (!state.pendingToolCallId || !state.pausedAtTool) {
    throw new Error("Cannot resume: no pending tool call in agent state");
  }
  return {
    ...state,
    messages: [
      ...state.messages,
      {
        role: "tool",
        tool_call_id: state.pendingToolCallId,
        name: state.pausedAtTool,
        content: userReply,
      },
    ],
    pendingToolCallId: undefined,
    pausedAtTool: undefined,
  };
}

export function createOpenRouterStreamingCompleteTurn(
  model: string,
  onToken?: (chunk: string) => void,
  signal?: AbortSignal
): CompleteTurnFn {
  return async (messages, tools) => {
    throwIfAborted(signal);
    const res = await openRouterChat({
      model,
      messages,
      tools,
      tool_choice: "auto",
      stream: true,
      signal,
    });
    if (!res.ok) {
      const text = await res.text();
      throw new RetryableError(`Agent loop chat error ${res.status}: ${text}`);
    }
    const turn = await parseOpenRouterChatStream(res, onToken, signal);
    return {
      content: turn.content,
      tool_calls: turn.tool_calls,
    };
  };
}

export function createOpenRouterCompleteTurn(model: string, signal?: AbortSignal): CompleteTurnFn {
  return async (messages, tools) => {
    throwIfAborted(signal);
    const res = await openRouterChat({
      model,
      messages,
      tools,
      tool_choice: "auto",
      stream: false,
      signal,
    });
    if (!res.ok) {
      const text = await res.text();
      throw new RetryableError(`Agent loop chat error ${res.status}: ${text}`);
    }
    const data = await res.json();
    const msg = data.choices?.[0]?.message;
    return {
      content: typeof msg?.content === "string" ? msg.content : "",
      tool_calls: msg?.tool_calls,
    };
  };
}

function withoutSystem(messages: LoopMessage[]): LoopMessage[] {
  return messages.filter((m) => m.role !== "system");
}

function buildState(
  messages: LoopMessage[],
  stepCount: number,
  extras?: Pick<AgentLoopState, "pendingToolCallId" | "pausedAtTool">
): AgentLoopState {
  return {
    messages: withoutSystem(messages),
    stepCount,
    ...extras,
  };
}

export async function runAgentLoop(params: RunAgentLoopParams): Promise<AgentLoopResult> {
  const {
    model,
    systemPrompt,
    messages: seedMessages,
    tools,
    toolHandlers,
    maxSteps,
    onTurnStart,
    onStep,
    onToken,
    streamTokens,
    persistState,
    signal,
    shouldAbort,
  } = params;

  const completeTurn =
    params.completeTurn ??
    (streamTokens
      ? createOpenRouterStreamingCompleteTurn(model, onToken, signal)
      : createOpenRouterCompleteTurn(model, signal));
  const messages: LoopMessage[] = [{ role: "system", content: systemPrompt }, ...seedMessages];

  let stepCount = 0;
  let pendingToolCallId: string | undefined;
  let pausedAtTool: string | undefined;

  const persist = async () => {
    if (persistState) {
      await persistState(buildState(messages, stepCount, { pendingToolCallId, pausedAtTool }));
    }
  };

  while (stepCount < maxSteps) {
    throwIfAborted(signal);
    if (shouldAbort && (await shouldAbort())) {
      await persist();
      const state = buildState(messages, stepCount, { pendingToolCallId, pausedAtTool });
      return {
        messages: state.messages,
        state,
        done: false,
        paused: false,
        aborted: true,
      };
    }
    stepCount += 1;
    await onTurnStart?.({ step: stepCount });
    const turn = await completeTurn(messages, tools);

    if (turn.tool_calls?.length) {
      messages.push({
        role: "assistant",
        content: turn.content ?? "",
        tool_calls: turn.tool_calls,
      });

      for (const tc of turn.tool_calls) {
        throwIfAborted(signal);
        const name = tc.function.name;
        const args = parseToolArguments(tc.function.arguments);
        await onStep?.({ step: stepCount, toolName: name, toolArgs: args });

        const handler = toolHandlers[name];
        let content: string;
        let pause = false;

        if (!handler) {
          content = JSON.stringify({ error: `Unknown tool: ${name}` });
        } else {
          const result = await handler(args);
          if (typeof result === "string") {
            content = result;
          } else {
            content = result.content;
            pause = Boolean(result.pause);
          }
        }

        if (pause) {
          pendingToolCallId = tc.id;
          pausedAtTool = name;
          await persist();
          const state = buildState(messages, stepCount, { pendingToolCallId, pausedAtTool });
          return {
            messages: state.messages,
            state,
            done: false,
            paused: true,
          };
        }

        messages.push({
          role: "tool",
          tool_call_id: tc.id,
          name,
          content,
        });
      }

      await persist();
      continue;
    }

    const finalContent = turn.content ?? "";
    if (finalContent) {
      messages.push({ role: "assistant", content: finalContent });
    }
    await persist();
    const state = buildState(messages, stepCount);
    return {
      messages: state.messages,
      state,
      done: true,
      paused: false,
      finalContent,
    };
  }

  await persist();
  const state = buildState(messages, stepCount, { pendingToolCallId, pausedAtTool });
  return {
    messages: state.messages,
    state,
    done: false,
    paused: false,
    exhausted: true,
  };
}
