# Phase 5.2 — Wallet / Budget Guard Findings

During the spike/investigation phase, we ran a task and monitored OpenCode's SSE stream and SQLite database structures. This document summarizes how token usage and cost data can be accurately extracted and tracked per task.

## Data Source Investigation

We found two distinct sources of truth for token usage:

1. **SQLite Database (`opencode.db` at `~/.local/share/opencode/opencode.db`)**:
   - The `session` table has columns `tokens_input`, `tokens_output`, `tokens_reasoning`, `tokens_cache_read`, `tokens_cache_write`, and `cost`.
   - These are updated periodically as the task runs.
   - However, querying the SQLite database requires out-of-band polling and file locks, which can be brittle during concurrent execution.

2. **SSE Event Stream (`subscribe` API on OpenCode client)**:
   - When subscribing to the SSE stream (`client.event.subscribe`), the stream emits events of type `"message.updated"`.
   - When the event is a `"message.updated"` type, the `properties.info` payload contains the message details:
     - `role`: `"user"` or `"assistant"`
     - `id`: Unique message ID (e.g. `msg_...`)
     - `modelID`: The model identifier (e.g. `meta-llama/Llama-3.3-70B-Instruct-Turbo`)
     - `providerID`: The provider identifier (e.g. `together`)
     - `tokens`: An object containing:
       - `input`: Prompt tokens
       - `output`: Completion/response tokens
       - `reasoning`: Reasoning tokens
       - `cache`: `{ read, write }` cache tokens
   - Each prompt turn creates a new assistant message ID.
   - We can keep an in-memory map of `messageId -> { input, output }` inside the `OpenCodeAdapter`'s event subscription consumer, and sum them up in real time to get cumulative input and output tokens for the task run.

## Together AI / OpenAI Model Pricing Lookups

Since `cost` in the OpenCode SSE stream defaults to `0` for certain custom models/providers, we will compute the cost in USD programmatically using actual published model pricing rates.

We define the pricing rates (per 1,000,000 tokens) as follows:

| Model ID / Pattern | Input Price ($/1M) | Output Price ($/1M) |
| --- | --- | --- |
| `meta-llama/Llama-3.3-70B-Instruct-Turbo` | $0.60 | $0.60 |
| `meta-llama/Meta-Llama-3.1-405B-Instruct-Turbo` | $2.66 | $2.66 |
| `Qwen/Qwen2.5-72B-Instruct-Turbo` | $0.40 | $0.40 |
| `deepseek-ai/DeepSeek-V3` | $0.14 | $0.28 |
| `gpt-4o` | $2.50 | $10.00 |
| `gpt-4o-mini` | $0.150 | $0.60 |
| `gpt-3.5-turbo` | $0.50 | $1.50 |
| *Fallback (Default)* | $1.00 | $1.00 |

### Cost Calculation Formula

$$\text{Cost (USD)} = \left( \frac{\text{Input Tokens}}{1,000,000} \times \text{Input Price} \right) + \left( \frac{\text{Output Tokens}}{1,000,000} \times \text{Output Price} \right)$$
