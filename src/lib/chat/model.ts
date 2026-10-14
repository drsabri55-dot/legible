import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import type { AgentUsage } from "@/types/scan";
import { env } from "../env";
import { ANSWER_MAX_TOKENS } from "./limits";

export type ChatTurn = { role: "user" | "assistant"; content: string };
export interface ChatModel {
  readonly name: string;
  ask(req: { system: string; messages: ChatTurn[] }): Promise<{ text: string; usage: AgentUsage }>;
}

export class AnthropicChatModel implements ChatModel {
  constructor(
    private readonly client = new Anthropic({ apiKey: env.anthropicApiKey() }),
    readonly name = env.agentModel(),
  ) {}

  async ask(req: { system: string; messages: ChatTurn[] }) {
    const res = await this.client.messages.create(
      { model: this.name, max_tokens: ANSWER_MAX_TOKENS, system: req.system, messages: req.messages },
      { timeout: 25_000, maxRetries: 1 },
    );
    const text = res.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("\n").trim();
    return {
      text,
      usage: {
        inputTokens: res.usage.input_tokens,
        outputTokens: res.usage.output_tokens,
        cacheReadTokens: res.usage.cache_read_input_tokens ?? 0,
        cacheWriteTokens: res.usage.cache_creation_input_tokens ?? 0,
      },
    };
  }
}

// Tests only: "[fail]" throws, "[law]" returns a banned phrase.
export class FakeChatModel implements ChatModel {
  readonly name = "fake";
  async ask(req: { system: string; messages: ChatTurn[] }) {
    const last = req.messages.at(-1)?.content ?? "";
    // The question follows the scan's data in the last message.
    const at = last.lastIndexOf("Question: ");
    const q = at === -1 ? last : last.slice(at + "Question: ".length);
    if (q.includes("[fail]")) throw new Error("fake model failure");
    const text = q.includes("[law]") ? "Yes, your site is compliant." : `Test answer to: ${q.slice(0, 60)}`;
    return { text, usage: { inputTokens: 1000, outputTokens: 100, cacheReadTokens: 0, cacheWriteTokens: 0 } };
  }
}

export function chatModelFromEnv(): ChatModel {
  return env.fakeChat() ? new FakeChatModel() : new AnthropicChatModel();
}
