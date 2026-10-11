import { describe, expect, it } from "vitest";
import { AnthropicModel, ReplayModel, addUsage, agentModelFromEnv, emptyUsage, meter } from "../src/agent/model";

const req = { system: "s", tools: [{ name: "look", description: "d", input_schema: { type: "object" as const, properties: {}, required: [], additionalProperties: false } }], messages: [{ role: "user" as const, content: "hi" }] };

describe("ReplayModel", () => {
  it("plays back tool calls, refusals, errors and a final text", async () => {
    const m = new ReplayModel([{ calls: [{ name: "look", input: {} }] }, { refuse: true }, { error: "boom" }, { text: "done" }]);
    const t1 = await m.turn(req);
    expect(t1.stopReason).toBe("tool_use");
    expect(t1.content[0]).toMatchObject({ type: "tool_use", name: "look", input: {} });
    expect((await m.turn(req)).stopReason).toBe("refusal");
    await expect(m.turn(req)).rejects.toThrow("boom");
    expect((await m.turn(req)).stopReason).toBe("end_turn");
    // Past the script: the agent is told it is finished.
    expect((await m.turn(req)).stopReason).toBe("end_turn");
    expect(m.requests.length).toBe(5);
  });
});

describe("AnthropicModel", () => {
  it("sends strict tools, auto tool choice, medium effort and caching, and reads usage", async () => {
    let sent: Record<string, unknown> = {};
    const fake = {
      messages: {
        create: async (body: Record<string, unknown>) => {
          sent = body;
          return {
            content: [{ type: "text", text: "ok" }],
            stop_reason: "end_turn",
            usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 100, cache_creation_input_tokens: 20 },
          };
        },
      },
    };
    const m = new AnthropicModel(fake, "claude-sonnet-5-5");
    const t = await m.turn(req);
    expect(sent).toMatchObject({
      model: "claude-sonnet-5-5",
      tool_choice: { type: "auto" },
      output_config: { effort: "medium" },
      cache_control: { type: "ephemeral" },
      system: "s",
    });
    expect((sent.tools as { strict: boolean }[])[0].strict).toBe(true);
    expect(t.usage).toEqual({ inputTokens: 10, outputTokens: 5, cacheReadTokens: 100, cacheWriteTokens: 20 });
  });
});

describe("AnthropicModel time limits", () => {
  it("never waits past the deadline it is given, and retries at most once", async () => {
    let options: Record<string, unknown> = {};
    const fake = {
      messages: {
        create: async (_body: unknown, opts?: Record<string, unknown>) => {
          options = opts ?? {};
          return { content: [], stop_reason: "end_turn", usage: { input_tokens: 1, output_tokens: 1 } };
        },
      },
    };
    const model = new AnthropicModel(fake, "claude-sonnet-5-5");
    // Under a minute left: one try, using the time there is.
    await model.turn({ ...req, deadline: Date.now() + 5000 });
    expect(options.timeout as number).toBeLessThanOrEqual(5000);
    expect(options.timeout as number).toBeGreaterThan(3000);
    expect(options.maxRetries).toBe(0);
    // More time: a retry only when both tries fit before the deadline.
    await model.turn({ ...req, deadline: Date.now() + 100_000 });
    expect(options.timeout as number).toBeLessThanOrEqual(50_000);
    expect(options.maxRetries).toBe(1);
    await model.turn({ ...req, deadline: Date.now() + 200_000 });
    expect(options.timeout).toBe(60_000);
    expect(options.maxRetries).toBe(1);
  });
});

describe("usage and setup", () => {
  it("adds usage and needs a key", () => {
    const u = addUsage(emptyUsage(), { inputTokens: 1, outputTokens: 2, cacheReadTokens: 3, cacheWriteTokens: 4 });
    expect(addUsage(u, u)).toEqual({ inputTokens: 2, outputTokens: 4, cacheReadTokens: 6, cacheWriteTokens: 8 });
    const key = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    expect(agentModelFromEnv()).toBeNull();
    if (key) process.env.ANTHROPIC_API_KEY = key;
  });
});

describe("meter", () => {
  it("adds up the usage of every answered call, including ones whose page is later dropped", async () => {
    const m = meter(new ReplayModel([{ text: "a" }, { error: "boom" }, { text: "b" }]));
    expect(m.model.name).toBe("replay");
    await m.model.turn(req);
    await expect(m.model.turn(req)).rejects.toThrow("boom");
    await m.model.turn(req);
    expect(m.total()).toEqual({ inputTokens: 200, outputTokens: 20, cacheReadTokens: 0, cacheWriteTokens: 0 });
  });
});
