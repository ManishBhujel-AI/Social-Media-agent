import { MODELS } from "./models.config";
import { parseModelJson } from "./parseJson";
import { RetryableError } from "./errors";
import { mergeAbortSignals, throwIfAborted } from "./abort";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const REQUEST_TIMEOUT_MS = 60_000;

export type ChatMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string | ContentPart[];
  tool_call_id?: string;
  name?: string;
};

export type ContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

export type ToolDef = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
};

function wrapFetchError(err: unknown): Error {
  if (err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError")) {
    return new RetryableError(`OpenRouter request timed out after ${REQUEST_TIMEOUT_MS}ms`);
  }
  return err instanceof Error ? err : new Error(String(err));
}

export async function openRouterChat(params: {
  model?: string;
  messages: ChatMessage[];
  tools?: ToolDef[];
  tool_choice?: "auto" | "none";
  response_format?: { type: "json_object" };
  stream?: boolean;
  max_tokens?: number;
  signal?: AbortSignal;
}): Promise<Response> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("OPENROUTER_API_KEY is not set");

  const signal = mergeAbortSignals([params.signal], REQUEST_TIMEOUT_MS);

  try {
    return await fetch(OPENROUTER_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
        "X-Title": "Brewline Content Studio",
      },
      body: JSON.stringify({
        model: params.model ?? MODELS.caption.model,
        messages: params.messages,
        tools: params.tools,
        tool_choice: params.tool_choice,
        response_format: params.response_format,
        stream: params.stream ?? false,
        max_tokens: params.max_tokens ?? 4096,
      }),
      signal,
    });
  } catch (err) {
    throw wrapFetchError(err);
  }
}

export async function openRouterChatJSON<T>(params: {
  model?: string;
  messages: ChatMessage[];
  max_tokens?: number;
}): Promise<T> {
  const attempt = async (isRetry: boolean): Promise<T> => {
    const res = await openRouterChat({
      ...params,
      response_format: { type: "json_object" },
    });
    if (!res.ok) {
      const text = await res.text();
      throw new RetryableError(`OpenRouter error ${res.status}: ${text}`);
    }
    const data = await res.json();
    const content = data.choices?.[0]?.message?.content;
    const raw = typeof content === "string" ? content : "";
    if (!raw.trim()) {
      if (!isRetry) {
        console.warn("OpenRouter JSON response empty, retrying once…");
        return attempt(true);
      }
      throw new Error("No content in OpenRouter response");
    }
    try {
      return parseModelJson<T>(raw, "openRouterChatJSON");
    } catch {
      if (!isRetry) {
        console.warn("OpenRouter JSON parse failed, retrying once. Raw:", raw.slice(0, 500));
        return attempt(true);
      }
      throw new Error(
        `Failed to parse OpenRouter JSON after retry. Raw (first 500): ${raw.slice(0, 500)}`
      );
    }
  };

  return attempt(false);
}

export type StreamedChatTurn = {
  content: string;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;
};

/** Parse an OpenRouter SSE chat completion stream into a single turn result. */
export async function parseOpenRouterChatStream(
  res: Response,
  onContentDelta?: (delta: string) => void,
  signal?: AbortSignal
): Promise<StreamedChatTurn> {
  const reader = res.body?.getReader();
  if (!reader) throw new Error("OpenRouter stream has no body");

  const decoder = new TextDecoder();
  let buffer = "";
  let content = "";
  let toolCalls:
    | Array<{
        id: string;
        type: "function";
        function: { name: string; arguments: string };
      }>
    | undefined;
  let sawToolCalls = false;

  const onAbort = () => {
    void reader.cancel();
  };
  signal?.addEventListener("abort", onAbort, { once: true });

  try {
    const mergeToolDeltas = (
      deltas: Array<{
        index?: number;
        id?: string;
        function?: { name?: string; arguments?: string };
      }>
    ) => {
      if (!toolCalls) toolCalls = [];
      for (const delta of deltas) {
        const index = delta.index ?? 0;
        while (toolCalls.length <= index) {
          toolCalls.push({ id: "", type: "function", function: { name: "", arguments: "" } });
        }
        const call = toolCalls[index];
        if (delta.id) call.id = delta.id;
        if (delta.function?.name) call.function.name += delta.function.name;
        if (delta.function?.arguments) call.function.arguments += delta.function.arguments;
      }
    };

    while (true) {
      throwIfAborted(signal);
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const data = trimmed.slice(5).trim();
        if (!data || data === "[DONE]") continue;

        try {
          const parsed = JSON.parse(data) as {
            choices?: Array<{
              delta?: {
                content?: string;
                tool_calls?: Array<{
                  index?: number;
                  id?: string;
                  function?: { name?: string; arguments?: string };
                }>;
              };
            }>;
          };
          const delta = parsed.choices?.[0]?.delta;
          if (!delta) continue;

          if (delta.tool_calls?.length) {
            sawToolCalls = true;
            mergeToolDeltas(delta.tool_calls);
          }
          if (delta.content) {
            content += delta.content;
            if (!sawToolCalls) onContentDelta?.(delta.content);
          }
        } catch {
          /* skip malformed SSE chunks */
        }
      }
    }
  } finally {
    signal?.removeEventListener("abort", onAbort);
  }

  return {
    content,
    tool_calls: sawToolCalls ? toolCalls : undefined,
  };
}

export async function openRouterChatText(params: {
  model?: string;
  messages: ChatMessage[];
  max_tokens?: number;
}): Promise<string> {
  const res = await openRouterChat(params);
  if (!res.ok) {
    const text = await res.text();
    throw new RetryableError(`OpenRouter error ${res.status}: ${text}`);
  }
  const data = await res.json();
  return data.choices?.[0]?.message?.content ?? "";
}
