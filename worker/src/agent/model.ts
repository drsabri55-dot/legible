// The agent talks to a model through this interface: Claude in production,
// a replay of recorded answers in tests (no key, no cost, same result).
import Anthropic from "@anthropic-ai/sdk";
import type { AgentUsage } from "../types";

export interface ModelRequest {
  system: string;
  tools: Anthropic.Tool[];
  messages: Anthropic.MessageParam[];
  // Epoch milliseconds: the answer is no use after this.
  deadline?: number;
}

export interface ModelTurn {
  content: Anthropic.ContentBlock[];
  stopReason: string | null;
  usage: AgentUsage;
}

export interface AgentModel {
  readonly name: string;
  turn(req: ModelRequest): Promise<ModelTurn>;
}

export function emptyUsage(): AgentUsage {
  return { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
}

export function addUsage(a: AgentUsage, b: AgentUsage): AgentUsage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
    cacheWriteTokens: a.cacheWriteTokens + b.cacheWriteTokens,
  };
}

type Client = { messages: { create: (body: never, options?: never) => Promise<unknown> } };

export class AnthropicModel implements AgentModel {
  constructor(
    private readonly client: Client = new Anthropic(),
    readonly name: string = process.env.AGENT_MODEL || "claude-sonnet-5-5",
  ) {}

  async turn(req: ModelRequest): Promise<ModelTurn> {
    const body = {
      model: this.name,
      max_tokens: 4000,
      // Forced tool choice returns 400 on this model: steer with the prompt,
      // keep inputs schema-valid with strict tools.
      tool_choice: { type: "auto" },
      tools: req.tools.map((t) => ({ ...t, strict: true })),
      output_config: { effort: "medium" },
      // Caches the growing conversation, so each step pays full price only
      // for what is new.
      cache_control: { type: "ephemeral" },
      system: req.system,
      messages: req.messages,
    };
    // One retry at most, and never past the deadline: the page's budget is
    // what keeps a slow model from costing the whole scan.
    const left = req.deadline ? req.deadline - Date.now() : 60_000;
    const timeout = Math.max(1000, Math.min(60_000, left));
    const res = (await this.client.messages.create(body as never, { timeout, maxRetries: 1 } as never)) as Anthropic.Message;
    return {
      content: res.content,
      stopReason: res.stop_reason,
      usage: {
        inputTokens: res.usage.input_tokens,
        outputTokens: res.usage.output_tokens,
        cacheReadTokens: res.usage.cache_read_input_tokens ?? 0,
        cacheWriteTokens: res.usage.cache_creation_input_tokens ?? 0,
      },
    };
  }
}

export type ReplayStep =
  | { calls: { name: string; input: Record<string, unknown> }[] }
  | { refuse: true }
  | { error: string }
  | { text: string };

export class ReplayModel implements AgentModel {
  readonly name = "replay";
  readonly requests: ModelRequest[] = [];
  private n = 0;

  constructor(private readonly script: ReplayStep[]) {}

  async turn(req: ModelRequest): Promise<ModelTurn> {
    this.requests.push(structuredClone(req));
    const step = this.script.shift() ?? { text: "Finished." };
    const usage = { inputTokens: 100, outputTokens: 10, cacheReadTokens: 0, cacheWriteTokens: 0 };
    this.n++;
    if ("error" in step) throw new Error(step.error);
    if ("refuse" in step) return { content: [], stopReason: "refusal", usage };
    if ("text" in step) {
      return { content: [{ type: "text", text: step.text, citations: null } as Anthropic.ContentBlock], stopReason: "end_turn", usage };
    }
    const content = step.calls.map(
      (c, i) => ({ type: "tool_use", id: `toolu_replay_${this.n}_${i}`, name: c.name, input: c.input }) as unknown as Anthropic.ContentBlock,
    );
    return { content, stopReason: "tool_use", usage };
  }
}

export function agentModelFromEnv(): AgentModel | null {
  return process.env.ANTHROPIC_API_KEY ? new AnthropicModel() : null;
}
