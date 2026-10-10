# Testing agent phase 2: spending ledger and daily cap. Implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Record the cost of every agent run, enforce the $10 daily cap on free scans, and switch the testing agent on for visitors when prices are set and the cap allows.

**Architecture:** The worker meters every model call and reports the exact token total with the scan's final message (complete or failed). The site prices those tokens from its settings, stores one `agent_spend` row per scan, and before each free scan compares today's (UTC) free spend with the cap to decide whether the job goes out with `agent: true`. The decision is stored on the scan (`scans.agent`), so the result page can say when the cap left the agent out.

**Tech Stack:** Next.js 16 App Router, postgres.js, Vitest with embedded Postgres, Express worker with Vitest.

**Spec:** `docs/superpowers/specs/2026-10-09-testing-agent-design.md`, section 4 (spending), section 7 (daily cap row), section 8.6 (spending tests), section 10 (settings).

## Global Constraints

- Prices come only from `AGENT_PRICE_INPUT_PER_MTOK` and `AGENT_PRICE_OUTPUT_PER_MTOK`. No built-in defaults: missing or invalid prices keep the agent off.
- `AGENT_DAILY_CAP_USD` defaults to 10. Today means since midnight UTC. Free spend is `free` + `chat_free`.
- At or over the cap: the job goes out with `agent: false` and the result page says so.
- No prices: the agent is off and the site looks exactly as it does today (no note).
- New tables enable RLS with no policies and revoke `anon`/`authenticated`.
- Only the site touches the database. The worker never knows prices.
- Copy: British spelling, short sentences, no em-dash chains, no "not X, but Y". New customer-facing wording goes to the owner's design doc as "awaiting approval".
- Never say "compliant" or "legally safe".
- Do not touch `.gitignore`, `eslint.config.mjs`, `tsconfig.json`, `.design-sync/` (another session's work).
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. A scan that fails or times out after the agent has spent money: the spend must still be recorded (the worker sends usage with `failed`).
2. The worker repeats a callback (it retries up to 4 times): spend must be recorded once per scan, never twice.
3. Spend exactly equal to the cap: the agent is off (at or over).
4. Prices set to nonsense ("abc", "-1", "0"): treated as missing, agent off.
5. A scan the stale-scan cleanup already failed, whose worker later completes: its spend must still be recorded.

---

### Task 1: The worker meters every model call and reports the total

**Files:**
- Modify: `worker/src/agent/model.ts` (add `meter`)
- Modify: `worker/src/server.ts` (wrap the model; usage on `complete` and `failed`)
- Test: `worker/test/model.test.ts`

**Interfaces:**
- Produces: `meter(model: AgentModel): { model: AgentModel; total(): AgentUsage }`. Worker messages: `complete.raw.agent.usage` is the metered total; `failed` gains optional `agent?: { model: string; usage: AgentUsage }`.

- [ ] **Step 1: Write the failing test** (append to `worker/test/model.test.ts`, and add `meter` to its import)

```ts
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
```

- [ ] **Step 2: Run it.** `npm --prefix worker test -- model` → FAIL, `meter` is not exported.

- [ ] **Step 3: Implement** in `worker/src/agent/model.ts` after `addUsage`:

```ts
// Counts what every answered call used, so the site is charged for the whole
// run even when a page is later dropped or the scan fails.
export function meter(inner: AgentModel): { model: AgentModel; total(): AgentUsage } {
  let total = emptyUsage();
  return {
    model: {
      name: inner.name,
      async turn(req) {
        const t = await inner.turn(req);
        total = addUsage(total, t.usage);
        return t;
      },
    },
    total: () => total,
  };
}
```

- [ ] **Step 4: Run it.** `npm --prefix worker test -- model` → PASS.

- [ ] **Step 5: Wire it into `worker/src/server.ts`.** Replace `const agent = req.body?.agent === true ? agentModelFromEnv() : null;` with:

```ts
  const model = req.body?.agent === true ? agentModelFromEnv() : null;
  const metered = model ? meter(model) : null;
  const agent = metered?.model ?? null;
```

Before `await callback(cb.toString(), { type: "complete", raw });` add:

```ts
      if (raw.agent && metered) raw.agent.usage = metered.total();
```

and in the `catch`, send the spend with the failure:

```ts
      await callback(cb.toString(), {
        type: "failed",
        error: code,
        detail: String((e as Error).message).slice(0, 300),
        ...(metered ? { agent: { model: metered.model.name, usage: metered.total() } } : {}),
      });
```

Import `meter` from `./agent/model`.

- [ ] **Step 6: Run** `npm --prefix worker test` and `npm run typecheck` → all pass.

- [ ] **Step 7: Commit** `Worker: meter every model call and report the spend with the final message`.

### Task 2: Spend table, the scan's agent mode, and the queries

**Files:**
- Create: `supabase/migrations/0003_agent_spend.sql`
- Modify: `src/lib/data.ts`
- Test: `tests/unit/spend.test.ts` (new; every test that writes spend lives in this one file, because the database is shared and today's total is global)

**Interfaces:**
- Produces:
  - `type AgentMode = "on" | "capped" | "off"`; `ScanRow.agent: AgentMode`; `createScan({ url, host, ipHash, agent?: AgentMode })` (default `"off"`).
  - `type SpendKind = "free" | "paid" | "chat_free" | "chat_paid"`.
  - `recordScanSpend(input: { scanId: string; kind: SpendKind; model: string; usage: AgentUsage; costUsd: number | null }): Promise<boolean>`: one row per scan and kind for `free` and `paid`; a repeat returns false and changes nothing.
  - `freeSpendTodayUsd(): Promise<number>`: sum of `cost_usd` for `free` and `chat_free` since midnight UTC.

- [ ] **Step 1: Write the migration** `supabase/migrations/0003_agent_spend.sql`:

```sql
-- What the testing agent cost, one row per scan run (and later per chat
-- answer). The daily cap adds up today's free rows.
create table agent_spend (
  id bigint generated always as identity primary key,
  scan_id uuid not null references scans (id) on delete cascade,
  kind text not null check (kind in ('free', 'paid', 'chat_free', 'chat_paid')),
  model text not null,
  input_tokens integer not null,
  output_tokens integer not null,
  cache_read_tokens integer not null default 0,
  cache_write_tokens integer not null default 0,
  -- Null only when the prices were removed while the scan ran.
  cost_usd numeric(12, 6),
  created_at timestamptz not null default now()
);
create index agent_spend_recent on agent_spend (created_at);
-- A scan run is charged once, however often the worker repeats its message.
create unique index agent_spend_once on agent_spend (scan_id, kind) where kind in ('free', 'paid');

alter table agent_spend enable row level security;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on agent_spend from anon, authenticated';
  end if;
end
$$;

-- Whether a free scan was sent with the testing agent: on, left out because
-- of the daily cap, or off (no prices set).
alter table scans add column agent text not null default 'off'
  check (agent in ('on', 'capped', 'off'));
```

- [ ] **Step 2: Write the failing tests** `tests/unit/spend.test.ts`:

```ts
// Spending: every test that writes agent_spend lives here, because the test
// database is shared and "today's spend" is a total over all of it.
import { beforeAll, describe, expect, inject, it } from "vitest";

type Data = typeof import("@/lib/data");
let data: Data;
const usage = { inputTokens: 1000, outputTokens: 100, cacheReadTokens: 0, cacheWriteTokens: 0 };

beforeAll(async () => {
  process.env.DATABASE_URL = inject("databaseUrl");
  data = await import("@/lib/data");
});

describe("agent spend", () => {
  it("stores the agent mode on the scan, off unless told", async () => {
    const off = await data.createScan({ url: "https://m1.example/", host: "m1.example", ipHash: null });
    const on = await data.createScan({ url: "https://m2.example/", host: "m2.example", ipHash: null, agent: "on" });
    expect(off.agent).toBe("off");
    expect((await data.getScan(on.id))?.agent).toBe("on");
  });

  it("charges a scan run once, however often the worker repeats it", async () => {
    const before = await data.freeSpendTodayUsd();
    const scan = await data.createScan({ url: "https://p1.example/", host: "p1.example", ipHash: null, agent: "on" });
    const row = { scanId: scan.id, kind: "free" as const, model: "claude-sonnet-5-5", usage, costUsd: 0.25 };
    expect(await data.recordScanSpend(row)).toBe(true);
    expect(await data.recordScanSpend(row)).toBe(false);
    expect(await data.freeSpendTodayUsd()).toBeCloseTo(before + 0.25, 6);
  });

  it("counts free and free-chat spend today, not paid spend or yesterday's", async () => {
    const before = await data.freeSpendTodayUsd();
    const scan = await data.createScan({ url: "https://p2.example/", host: "p2.example", ipHash: null });
    await data.recordScanSpend({ scanId: scan.id, kind: "paid", model: "m", usage, costUsd: 5 });
    const { db } = await import("@/lib/db");
    await db()`insert into agent_spend (scan_id, kind, model, input_tokens, output_tokens, cost_usd)
      values (${scan.id}, 'chat_free', 'm', 1, 1, 0.5)`;
    await db()`insert into agent_spend (scan_id, kind, model, input_tokens, output_tokens, cost_usd, created_at)
      values (${scan.id}, 'chat_free', 'm', 1, 1, 7, date_trunc('day', now() at time zone 'utc') at time zone 'utc' - interval '1 second')`;
    expect(await data.freeSpendTodayUsd()).toBeCloseTo(before + 0.5, 6);
  });
});
```

- [ ] **Step 3: Run it.** `npx vitest run tests/unit/spend.test.ts` → FAIL (`agent` missing, functions missing).

- [ ] **Step 4: Implement in `src/lib/data.ts`.** Add `"agent"` to `SCAN_COLUMNS`, `agent: AgentMode` to `ScanRow`, and:

```ts
export type AgentMode = "on" | "capped" | "off";
export type SpendKind = "free" | "paid" | "chat_free" | "chat_paid";
```

`createScan` takes `agent?: AgentMode` and inserts `${input.agent ?? "off"}` into the new column. Then a new section:

```ts
// ── agent spend ──────────────────────────────────────────────────────

export async function recordScanSpend(input: {
  scanId: string;
  kind: SpendKind;
  model: string;
  usage: AgentUsage;
  costUsd: number | null;
}): Promise<boolean> {
  const u = input.usage;
  const rows = await db()`
    insert into agent_spend (scan_id, kind, model, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cost_usd)
    values (${input.scanId}, ${input.kind}, ${input.model}, ${u.inputTokens}, ${u.outputTokens},
            ${u.cacheReadTokens}, ${u.cacheWriteTokens}, ${input.costUsd})
    on conflict do nothing
    returning id`;
  return rows.length > 0;
}

// Free scans and free chat since midnight UTC.
export async function freeSpendTodayUsd(): Promise<number> {
  const [row] = await db()<{ total: string | null }[]>`
    select sum(cost_usd) as total from agent_spend
    where kind in ('free', 'chat_free')
      and created_at >= date_trunc('day', now() at time zone 'utc') at time zone 'utc'`;
  return Number(row?.total ?? 0);
}
```

Import `AgentUsage` from `@/types/scan`.

- [ ] **Step 5: Run it.** `npx vitest run tests/unit/spend.test.ts tests/unit/data.test.ts` → PASS.

- [ ] **Step 6: Commit** `Spending: agent_spend table, the scan's agent mode, and today's free total`.

### Task 3: Prices, cost and the cap decision

**Files:**
- Create: `src/lib/spend.ts`
- Modify: `src/lib/env.ts`
- Test: `tests/unit/spend.test.ts` (pure tests in a new `describe`; the cap test writes spend, so it belongs here too)

**Interfaces:**
- Consumes: `freeSpendTodayUsd()`, `recordScanSpend()`, `AgentMode` (Task 2).
- Produces:
  - `agentPrices(): { inputPerMtok: number; outputPerMtok: number } | null`
  - `costUsd(usage: AgentUsage, prices): number`: input at the input price, output at the output price, cache reads at 0.1 × input, cache writes at 1.25 × input (Anthropic's published multipliers for 5-minute caching, which the agent uses).
  - `dailyCapUsd(): number` (default 10; a value of 0 or more is used, anything else falls back to 10)
  - `freeAgentMode(): Promise<AgentMode>`: `"off"` without prices, `"capped"` when today's free spend is at or over the cap, else `"on"`.

- [ ] **Step 1: Write the failing tests** (append to `tests/unit/spend.test.ts`):

```ts
describe("prices and the daily cap", () => {
  const set = (vars: Record<string, string | undefined>) => {
    for (const [k, v] of Object.entries(vars)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  };

  it("needs both prices as positive numbers", async () => {
    const { agentPrices } = await import("@/lib/spend");
    set({ AGENT_PRICE_INPUT_PER_MTOK: "2", AGENT_PRICE_OUTPUT_PER_MTOK: "10" });
    expect(agentPrices()).toEqual({ inputPerMtok: 2, outputPerMtok: 10 });
    for (const bad of ["", "abc", "-1", "0"]) {
      set({ AGENT_PRICE_INPUT_PER_MTOK: bad });
      expect(agentPrices()).toBeNull();
    }
    set({ AGENT_PRICE_INPUT_PER_MTOK: "2", AGENT_PRICE_OUTPUT_PER_MTOK: undefined });
    expect(agentPrices()).toBeNull();
  });

  it("prices input, output and both kinds of cached input", async () => {
    const { costUsd } = await import("@/lib/spend");
    const p = { inputPerMtok: 2, outputPerMtok: 10 };
    expect(costUsd({ inputTokens: 1_000_000, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }, p)).toBeCloseTo(2, 9);
    expect(costUsd({ inputTokens: 0, outputTokens: 1_000_000, cacheReadTokens: 0, cacheWriteTokens: 0 }, p)).toBeCloseTo(10, 9);
    expect(costUsd({ inputTokens: 0, outputTokens: 0, cacheReadTokens: 1_000_000, cacheWriteTokens: 0 }, p)).toBeCloseTo(0.2, 9);
    expect(costUsd({ inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 1_000_000 }, p)).toBeCloseTo(2.5, 9);
  });

  it("uses a cap of 10 dollars unless a valid one is set", async () => {
    const { dailyCapUsd } = await import("@/lib/spend");
    set({ AGENT_DAILY_CAP_USD: undefined });
    expect(dailyCapUsd()).toBe(10);
    set({ AGENT_DAILY_CAP_USD: "25" });
    expect(dailyCapUsd()).toBe(25);
    set({ AGENT_DAILY_CAP_USD: "0" });
    expect(dailyCapUsd()).toBe(0);
    set({ AGENT_DAILY_CAP_USD: "lots" });
    expect(dailyCapUsd()).toBe(10);
  });

  it("switches the agent off at exactly the cap, and keeps it off without prices", async () => {
    const { freeAgentMode } = await import("@/lib/spend");
    set({ AGENT_PRICE_INPUT_PER_MTOK: undefined, AGENT_PRICE_OUTPUT_PER_MTOK: undefined, AGENT_DAILY_CAP_USD: undefined });
    expect(await freeAgentMode()).toBe("off");

    set({ AGENT_PRICE_INPUT_PER_MTOK: "2", AGENT_PRICE_OUTPUT_PER_MTOK: "10" });
    const spent = await data.freeSpendTodayUsd();
    set({ AGENT_DAILY_CAP_USD: String(spent + 1) });
    expect(await freeAgentMode()).toBe("on");
    const scan = await data.createScan({ url: "https://cap.example/", host: "cap.example", ipHash: null, agent: "on" });
    await data.recordScanSpend({ scanId: scan.id, kind: "free", model: "m", usage, costUsd: 1 });
    expect(await freeAgentMode()).toBe("capped");
    set({ AGENT_DAILY_CAP_USD: String(spent + 1.000001) });
    expect(await freeAgentMode()).toBe("on");
    set({ AGENT_PRICE_INPUT_PER_MTOK: undefined, AGENT_PRICE_OUTPUT_PER_MTOK: undefined, AGENT_DAILY_CAP_USD: undefined });
  });
});
```

- [ ] **Step 2: Run it.** `npx vitest run tests/unit/spend.test.ts` → FAIL, `@/lib/spend` missing.

- [ ] **Step 3: Implement.** In `src/lib/env.ts` add:

```ts
  // Testing agent spending. Prices have no defaults: without them the agent stays off.
  agentPriceInputPerMtok: () => process.env.AGENT_PRICE_INPUT_PER_MTOK || "",
  agentPriceOutputPerMtok: () => process.env.AGENT_PRICE_OUTPUT_PER_MTOK || "",
  agentDailyCapUsd: () => process.env.AGENT_DAILY_CAP_USD || "",
```

Create `src/lib/spend.ts`:

```ts
import "server-only";
import type { AgentUsage } from "@/types/scan";
import { type AgentMode, freeSpendTodayUsd } from "./data";
import { env } from "./env";

// What the testing agent costs, and whether a free scan may use it today.
// Prices come only from settings: a wrong built-in guess could under-count.

export interface AgentPrices {
  inputPerMtok: number;
  outputPerMtok: number;
}

const positive = (s: string) => {
  const n = s.trim() === "" ? NaN : Number(s);
  return Number.isFinite(n) && n > 0 ? n : null;
};

export function agentPrices(): AgentPrices | null {
  const input = positive(env.agentPriceInputPerMtok());
  const output = positive(env.agentPriceOutputPerMtok());
  return input !== null && output !== null ? { inputPerMtok: input, outputPerMtok: output } : null;
}

// Cache reads cost a tenth of input; 5-minute cache writes cost a quarter more.
export function costUsd(u: AgentUsage, p: AgentPrices): number {
  const input = u.inputTokens + u.cacheReadTokens * 0.1 + u.cacheWriteTokens * 1.25;
  return (input * p.inputPerMtok + u.outputTokens * p.outputPerMtok) / 1_000_000;
}

export function dailyCapUsd(): number {
  const s = env.agentDailyCapUsd();
  const n = s.trim() === "" ? NaN : Number(s);
  return Number.isFinite(n) && n >= 0 ? n : 10;
}

export async function freeAgentMode(): Promise<AgentMode> {
  if (!agentPrices()) return "off";
  return (await freeSpendTodayUsd()) >= dailyCapUsd() ? "capped" : "on";
}
```

- [ ] **Step 4: Run it.** `npx vitest run tests/unit/spend.test.ts` → PASS.

- [ ] **Step 5: Commit** `Spending: prices from settings, cost per run, and the daily cap decision`.

### Task 4: Free scans go out with the agent when the cap allows

**Files:**
- Modify: `src/lib/worker.ts` (`dispatchScan` sends `agent`)
- Modify: `src/lib/scans.ts` (`startScan` decides, stores and sends)
- Test: `tests/unit/spend.test.ts` (new `describe`, because it writes spend)

**Interfaces:**
- Consumes: `freeAgentMode()` (Task 3), `createScan({ …, agent })` (Task 2).
- Produces: `dispatchScan(scan: { id: string; url: string; agent: boolean })`. The job body has `agent: true | false`.

- [ ] **Step 1: Write the failing test** (append to `tests/unit/spend.test.ts`; add `vi` to the vitest import):

```ts
describe("starting a free scan", () => {
  it("sends the agent while under the cap, and records when the cap left it out", async () => {
    process.env.ALLOW_PRIVATE_TARGETS = "1";
    process.env.WORKER_URL = "http://worker.test";
    process.env.WORKER_SECRET = "worker-secret-for-tests-0000";
    const bodies: { agent?: boolean }[] = [];
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      bodies.push(JSON.parse(String(init.body)));
      return new Response("{}", { status: 202 });
    });
    try {
      const { startScan } = await import("@/lib/scans");
      process.env.AGENT_PRICE_INPUT_PER_MTOK = "2";
      process.env.AGENT_PRICE_OUTPUT_PER_MTOK = "10";
      process.env.AGENT_DAILY_CAP_USD = String((await data.freeSpendTodayUsd()) + 100);
      const a = await startScan("https://start-a.example", "10.0.0.1");
      process.env.AGENT_DAILY_CAP_USD = "0";
      const b = await startScan("https://start-b.example", "10.0.0.2");
      delete process.env.AGENT_PRICE_INPUT_PER_MTOK;
      const c = await startScan("https://start-c.example", "10.0.0.3");
      expect(bodies.map((x) => x.agent)).toEqual([true, false, false]);
      const modes = await Promise.all([a, b, c].map(async (r) => (r.ok ? (await data.getScan(r.id))?.agent : r.error)));
      expect(modes).toEqual(["on", "capped", "off"]);
    } finally {
      vi.unstubAllGlobals();
      delete process.env.AGENT_PRICE_OUTPUT_PER_MTOK;
      delete process.env.AGENT_DAILY_CAP_USD;
      delete process.env.ALLOW_PRIVATE_TARGETS;
    }
  });
});
```

- [ ] **Step 2: Run it.** `npx vitest run tests/unit/spend.test.ts -t "free scan"` → FAIL (`agent` undefined in the body).

- [ ] **Step 3: Implement.** In `src/lib/worker.ts`, `dispatchScan(scan: { id: string; url: string; agent: boolean })` adds `agent: scan.agent` to the JSON body. In `src/lib/scans.ts`, import `freeAgentMode` from `./spend`, and replace the `createScan`/`dispatchScan` lines with:

```ts
  // The testing agent runs on free scans while today's spending is under the cap.
  const agent = await freeAgentMode();
  const scan = await createScan({ url: site.url, host: site.host, ipHash, agent });
  try {
    await dispatchScan({ id: scan.id, url: scan.url, agent: agent === "on" });
```

- [ ] **Step 4: Run it.** `npx vitest run tests/unit/spend.test.ts` → PASS. Then `npm run typecheck` → clean.

- [ ] **Step 5: Commit** `Scans: free scans use the testing agent while the daily cap allows`.

### Task 5: The worker's final message records the spend

**Files:**
- Modify: `src/app/api/worker/scans/[id]/route.ts`
- Test: `tests/unit/spend.test.ts` (new `describe`)

**Interfaces:**
- Consumes: `recordScanSpend`, `agentPrices`, `costUsd`, worker messages from Task 1.
- Produces: a `free` spend row per scan run that used the agent, whether it completed or failed, also when the scan was already closed (stale cleanup) and when the worker repeats the message.

- [ ] **Step 1: Write the failing test** (append to `tests/unit/spend.test.ts`):

```ts
describe("the worker's final message", () => {
  const SECRET = "worker-secret-for-tests-0000";
  const ctx = (id: string) => ({ params: Promise.resolve({ id }) }) as never;
  const post = async (id: string, body: unknown) => {
    const route = await import("@/app/api/worker/scans/[id]/route");
    return route.POST(
      new Request("http://x/", { method: "POST", headers: { authorization: `Bearer ${SECRET}`, "content-type": "application/json" }, body: JSON.stringify(body) }),
      ctx(id),
    );
  };
  const spendFor = async (id: string) => {
    const { db } = await import("@/lib/db");
    return db()<{ kind: string; input_tokens: number; cost_usd: string | null }[]>`select kind, input_tokens, cost_usd from agent_spend where scan_id = ${id}`;
  };

  it("records the agent's spend once on completion, even when repeated", async () => {
    process.env.WORKER_SECRET = SECRET;
    process.env.AGENT_PRICE_INPUT_PER_MTOK = "2";
    process.env.AGENT_PRICE_OUTPUT_PER_MTOK = "10";
    const { sampleScan } = await import("./fixture");
    const scan = await data.createScan({ url: "https://w1.example/", host: "w1.example", ipHash: null, agent: "on" });
    const raw = { ...sampleScan(), agent: { model: "claude-sonnet-5-5", usage: { inputTokens: 1_000_000, outputTokens: 100_000, cacheReadTokens: 0, cacheWriteTokens: 0 } } };
    expect((await post(scan.id, { type: "complete", raw })).status).toBe(200);
    expect((await post(scan.id, { type: "complete", raw })).status).toBe(200);
    const rows = await spendFor(scan.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: "free", input_tokens: 1_000_000 });
    expect(Number(rows[0].cost_usd)).toBeCloseTo(3, 6);
  });

  it("records the spend of a scan that failed, and of one already closed as stale", async () => {
    const failed = await data.createScan({ url: "https://w2.example/", host: "w2.example", ipHash: null, agent: "on" });
    const agent = { model: "claude-sonnet-5-5", usage: { inputTokens: 500_000, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 } };
    await post(failed.id, { type: "failed", error: "robots", agent });
    expect(Number((await spendFor(failed.id))[0].cost_usd)).toBeCloseTo(1, 6);

    const stale = await data.createScan({ url: "https://w3.example/", host: "w3.example", ipHash: null, agent: "on" });
    await data.failScan(stale.id, "timeout");
    const { sampleScan } = await import("./fixture");
    await post(stale.id, { type: "complete", raw: { ...sampleScan(), agent } });
    expect(await spendFor(stale.id)).toHaveLength(1);
  });

  it("keeps the tokens with no cost when the prices were removed mid-scan", async () => {
    delete process.env.AGENT_PRICE_INPUT_PER_MTOK;
    const scan = await data.createScan({ url: "https://w4.example/", host: "w4.example", ipHash: null, agent: "on" });
    const { sampleScan } = await import("./fixture");
    await post(scan.id, { type: "complete", raw: { ...sampleScan(), agent: { model: "m", usage: { inputTokens: 5, outputTokens: 5, cacheReadTokens: 0, cacheWriteTokens: 0 } } } });
    expect((await spendFor(scan.id))[0]).toMatchObject({ input_tokens: 5, cost_usd: null });
    delete process.env.AGENT_PRICE_OUTPUT_PER_MTOK;
  });
});
```

- [ ] **Step 2: Run it.** `npx vitest run tests/unit/spend.test.ts -t "final message"` → FAIL (no rows).

- [ ] **Step 3: Implement.** In the route, extend the `failed` message type with `agent?: { model: string; usage: AgentUsage }`, and add:

```ts
// Charged once per scan run (the table refuses a repeat), whatever state the
// scan is in, so a late or repeated message can never lose or double spend.
async function recordSpend(scanId: string, agent: { model?: unknown; usage?: Partial<AgentUsage> } | undefined) {
  if (!agent?.usage) return;
  const n = (v: unknown) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Math.round(Number(v)) : 0);
  const usage: AgentUsage = {
    inputTokens: n(agent.usage.inputTokens),
    outputTokens: n(agent.usage.outputTokens),
    cacheReadTokens: n(agent.usage.cacheReadTokens),
    cacheWriteTokens: n(agent.usage.cacheWriteTokens),
  };
  const prices = agentPrices();
  await recordScanSpend({
    scanId,
    kind: "free",
    model: String(agent.model || "unknown").slice(0, 80),
    usage,
    costUsd: prices ? costUsd(usage, prices) : null,
  });
}
```

Call `await recordSpend(id, msg.agent);` first thing in the `failed` branch, and `await recordSpend(id, msg.raw.agent);` first thing in the `complete` branch (inside the version check, before `buildReport`). Imports: `recordScanSpend` from `@/lib/data`, `agentPrices, costUsd` from `@/lib/spend`, `AgentUsage` from `@/types/scan`.

- [ ] **Step 4: Run it.** `npx vitest run tests/unit/spend.test.ts tests/unit/shots-route.test.ts` → PASS.

- [ ] **Step 5: Commit** `Spending: the worker's final message records what the agent cost`.

### Task 6: What visitors see, the stale-scan limit, and settings

**Files:**
- Create: `src/components/results/AgentNote.tsx`
- Modify: `src/app/scan/[id]/page.tsx`, `src/components/results/ScanProgress.tsx`
- Modify: `src/app/api/cron/daily/route.ts` (`failStaleScans(90)`)
- Modify: `.env.example`, `scripts/setup.mjs`, `CLAUDE.md`
- Modify: the owner's design doc (rows under "Testing agent wording (awaiting approval)")
- Test: `tests/unit/agent-sections.test.ts`

**Interfaces:**
- Consumes: `ScanRow.agent` (Task 2).
- Produces: `AgentCapNote({ mode }: { mode: AgentMode })` renders the cap note for `"capped"` only; `scanTimeText(agent: boolean): string` gives the progress page's time sentence; `ScanProgress` takes `agent: boolean`.

Wording (proposed, goes to the design doc for approval):
- Cap note: "Our testing agent has reached its limit for today, so this result has the automatic checks only. Scan again tomorrow to include its keyboard and layout tests."
- Progress, agent on: "Legible loads {host} in a real browser, checks every link, label, image and colour pair on each page, then tests it by keyboard like a person would. Most scans take 3 to 6 minutes."
- Progress, agent off: unchanged.

- [ ] **Step 1: Write the failing tests** (append to `tests/unit/agent-sections.test.ts`):

```ts
import { AgentCapNote, scanTimeText } from "@/components/results/AgentNote";

describe("what visitors see about the daily cap", () => {
  it("says so only when the cap left the agent out", () => {
    expect(renderToStaticMarkup(createElement(AgentCapNote, { mode: "capped" }))).toContain("reached its limit for today");
    expect(renderToStaticMarkup(createElement(AgentCapNote, { mode: "on" }))).toBe("");
    expect(renderToStaticMarkup(createElement(AgentCapNote, { mode: "off" }))).toBe("");
  });

  it("gives the longer scan time only when the agent runs", () => {
    expect(scanTimeText(true)).toContain("3 to 6 minutes");
    expect(scanTimeText(false)).toContain("under two minutes");
  });
});
```

- [ ] **Step 2: Run it.** `npx vitest run tests/unit/agent-sections.test.ts` → FAIL, module missing.

- [ ] **Step 3: Implement** `src/components/results/AgentNote.tsx`:

```tsx
import type { AgentMode } from "@/lib/data";

// Free scans leave the testing agent out once the day's spending cap is reached.
export function AgentCapNote({ mode }: { mode: AgentMode }) {
  if (mode !== "capped") return null;
  return (
    <p className="mt-4 mb-0 max-w-[46ch] text-[14px] leading-[1.8] text-nc-neutral-400">
      Our testing agent has reached its limit for today, so this result has the automatic checks only. Scan again
      tomorrow to include its keyboard and layout tests.
    </p>
  );
}

export function scanTimeText(agent: boolean): string {
  return agent
    ? "then tests it by keyboard like a person would. Most scans take 3 to 6 minutes."
    : "then moves to the next page after a short pause. Most scans take under two minutes.";
}
```

`AgentMode` is a type-only import, so the client component does not pull in the database module. In `ScanProgress.tsx` add the prop `agent: boolean` and render `Legible loads {host} in a real browser, checks every link, label, image and colour pair on each page, {scanTimeText(agent)}`. In the result page pass `agent={scan.agent === "on"}` to `ScanProgress`, and render `<AgentCapNote mode={scan.agent} />` directly under the score paragraph.

- [ ] **Step 4: Run it.** `npx vitest run tests/unit/agent-sections.test.ts` → PASS.

- [ ] **Step 5: The stale-scan limit.** In `src/app/api/cron/daily/route.ts` change `failStaleScans(10)` to `failStaleScans(90)` with the comment `// Agent scans can wait in the worker's queue and take up to 25 minutes.`

- [ ] **Step 6: Settings and docs.**
  - `.env.example`, new block after the worker block:

```
# ── Testing agent spending ────────────────────────────────────────────
# Prices in US dollars per million tokens, from the Anthropic pricing page
# for the model the worker uses (AGENT_MODEL). Without both, the agent is off.
AGENT_PRICE_INPUT_PER_MTOK=
AGENT_PRICE_OUTPUT_PER_MTOK=
# Free scans stop using the agent once today's spend (UTC) reaches this.
AGENT_DAILY_CAP_USD=10
```

  - `scripts/setup.mjs`: in the `.env.local` template, the same three lines commented out (`# AGENT_PRICE_INPUT_PER_MTOK=` and so on).
  - `CLAUDE.md`: replace "the site does not send it until the phase 2 spending cap exists" with "`startScan` sends it while today's free spend is under `AGENT_DAILY_CAP_USD` and both prices are set (`src/lib/spend.ts`); the worker meters every model call and its final message is charged once into `agent_spend`."
  - Design doc: add the three wording rows above to "Testing agent wording (awaiting approval)".

- [ ] **Step 7: Full check.** `npm run lint`, `npm run typecheck`, `npm test`, `npm --prefix worker test`, `npm run test:e2e` → all pass.

- [ ] **Step 8: Commit** `Result page: say when the daily cap left the agent out; longer time when it runs`.
