#!/usr/bin/env tsx
/**
 * Agent loop smoke test with mocked LLM turns (no OpenRouter / DB).
 */
import assert from "node:assert/strict";
import {
  appendResumeToolResult,
  deserializeAgentState,
  runAgentLoop,
  serializeAgentState,
  type AgentTurnResult,
  type LoopMessage,
} from "../lib/ai/agentLoop";
import type { ToolDef } from "../lib/ai/openrouter";

const TOOLS: ToolDef[] = [
  {
    type: "function",
    function: {
      name: "lookupA",
      description: "First lookup",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "lookupB",
      description: "Second lookup",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "askUser",
      description: "Pause for user",
      parameters: {
        type: "object",
        properties: { question: { type: "string" } },
        required: ["question"],
      },
    },
  },
];

async function testMultiStepLoop() {
  const turns: AgentTurnResult[] = [
    {
      tool_calls: [
        {
          id: "call_a",
          type: "function",
          function: { name: "lookupA", arguments: "{}" },
        },
      ],
    },
    {
      tool_calls: [
        {
          id: "call_b",
          type: "function",
          function: { name: "lookupB", arguments: "{}" },
        },
      ],
    },
    { content: "All done." },
  ];

  let turnIndex = 0;
  const persisted: unknown[] = [];

  const result = await runAgentLoop({
    model: "mock",
    systemPrompt: "You are a test agent.",
    messages: [{ role: "user", content: "Go." }],
    tools: TOOLS,
    maxSteps: 8,
    toolHandlers: {
      lookupA: async () => JSON.stringify({ ok: true, step: "a" }),
      lookupB: async () => JSON.stringify({ ok: true, step: "b" }),
      askUser: async () => ({ content: JSON.stringify({ paused: true }), pause: true }),
    },
    persistState: async (state) => {
      persisted.push(serializeAgentState(state));
    },
    completeTurn: async () => {
      const turn = turns[turnIndex++];
      if (!turn) throw new Error("Unexpected extra LLM turn");
      return turn;
    },
  });

  assert.equal(result.done, true);
  assert.equal(result.paused, false);
  assert.equal(result.finalContent, "All done.");
  assert.equal(turnIndex, 3);
  assert.ok(persisted.length >= 2, "expected persistState to run after tool rounds");
  assert.equal(result.state.stepCount, 3);
}

async function testMaxStepsExhausted() {
  const result = await runAgentLoop({
    model: "mock",
    systemPrompt: "Test",
    messages: [{ role: "user", content: "Loop forever" }],
    tools: TOOLS,
    maxSteps: 2,
    toolHandlers: {
      lookupA: async () => JSON.stringify({ ok: true }),
    },
    completeTurn: async () => ({
      tool_calls: [
        {
          id: "call_loop",
          type: "function",
          function: { name: "lookupA", arguments: "{}" },
        },
      ],
    }),
  });

  assert.equal(result.exhausted, true);
  assert.equal(result.done, false);
  assert.equal(result.state.stepCount, 2);
}

async function testPauseAndResume() {
  const pauseResult = await runAgentLoop({
    model: "mock",
    systemPrompt: "Test",
    messages: [{ role: "user", content: "Find product" }],
    tools: TOOLS,
    maxSteps: 4,
    toolHandlers: {
      askUser: async () => ({
        content: JSON.stringify({ question: "Which model?" }),
        pause: true,
      }),
    },
    completeTurn: async () => ({
      tool_calls: [
        {
          id: "call_ask_1",
          type: "function",
          function: { name: "askUser", arguments: '{"question":"Which model?"}' },
        },
      ],
    }),
  });

  assert.equal(pauseResult.paused, true);
  assert.equal(pauseResult.state.pendingToolCallId, "call_ask_1");
  assert.equal(pauseResult.state.pausedAtTool, "askUser");

  const restored = deserializeAgentState(serializeAgentState(pauseResult.state));
  assert.ok(restored);

  const resumed = appendResumeToolResult(restored!, "ZoomLock Pro");
  const messages: LoopMessage[] = resumed.messages;

  const afterResume = await runAgentLoop({
    model: "mock",
    systemPrompt: "Test",
    messages,
    tools: TOOLS,
    maxSteps: 4,
    toolHandlers: {
      lookupA: async () => JSON.stringify({ found: true }),
    },
    completeTurn: async () => ({ content: "Thanks, continuing." }),
  });

  assert.equal(afterResume.done, true);
  assert.equal(afterResume.finalContent, "Thanks, continuing.");
  const toolMsg = afterResume.state.messages.find((m) => m.role === "tool" && m.name === "askUser");
  assert.equal(toolMsg?.tool_call_id, "call_ask_1");
  assert.equal(toolMsg?.content, "ZoomLock Pro");
}

async function main() {
  await testMultiStepLoop();
  await testMaxStepsExhausted();
  await testPauseAndResume();
  console.log("PASS: test-agent-loop (3 checks)");
}

main().catch((err) => {
  console.error("FAIL: test-agent-loop", err);
  process.exit(1);
});
