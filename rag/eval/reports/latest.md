# Eval run 11/10/2026, 10:03:53 PM

Model `deepseek-flash` (thinking disabled) · prompt version `4cadfdf9` · 126 cases · 23 s

| Measure | Result | Target |
|---|---|---|
| Cases passed | **126/126 (100%)** | — |
| Prices & totals correct | **50/50 (100%)** | 100% |
| Orders understood exactly | **28/28 (100%)** | — |
| Replies with an invented amount (blocked by the guard) | **0/126 (0%)** | ≤ 2% |
| API errors | 0 | 0 |
| Slow calls rescued by a second request | 0 | — |
| Reply time p50 / p95 / max | 1066 / **1528** / 1982 ms | p95 ≤ 5,000 ms |
| Tokens per message (prompt / cached / reply) | 3562 / 3326 / 65 | — |
| Cost per 1,000 messages | $0.085 off-peak · $0.169 peak | — |

## By expected reply type

| Type | Passed | |
|---|---|---|
| answer | 56/56 | 100% |
| not_on_menu | 13/13 | 100% |
| order | 28/28 | 100% |
| clarify | 4/4 | 100% |
| handoff | 11/11 | 100% |
| unavailable | 2/2 | 100% |
| refuse | 8/8 | 100% |
| greet | 4/4 | 100% |

## By language

| Language | Passed | |
|---|---|---|
| en | 39/39 | 100% |
| roman_ur | 70/70 | 100% |
| ur | 15/15 | 100% |
| mixed | 2/2 | 100% |

## Failures (0)
