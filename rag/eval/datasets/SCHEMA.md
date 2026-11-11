# Test set format (`questions.jsonl`, one case per line)

```json
{"id": "price-003", "lang": "roman_ur", "cat": "price",
 "history": [{"from": "customer", "text": "..."}, {"from": "bot", "text": "..."}],
 "setup": {"price": [{"p": 4, "size": "Large", "value": 2200}], "hide": [12]},
 "q": "large fajita kitne ki hai?",
 "expect": {"type": "answer", "prices": [{"p": 4, "size": "Large"}], "says": [["spicy", "jalapeno"]], "not_says": ["biryani"]},
 "note": "why this case exists"}
```

| Field | Meaning |
|---|---|
| `lang` | `en`, `roman_ur` (Roman Urdu, incl. misspellings), `ur` (Urdu script), `mixed` |
| `cat` | topic, for the score breakdown |
| `history` | earlier messages in the chat (for follow-ups). Optional |
| `setup` | menu changes applied to an in-memory **copy** of the live menu before asking (the real POS is never touched): `price`, `hide`, `add`. Optional |
| `q` | the customer's message |

`expect.type` — what a correct reply does:

| type | Correct reply |
|---|---|
| `answer` | Answers from the menu. Every price in `prices` must appear (read **live** from the POS: `{"p": 4, "size": "Large"}`; no size = every size). Each group in `says` needs at least one of its words |
| `clarify` | Asks the customer a question first (e.g. which size). `asks` = words the question should contain |
| `not_on_menu` | Says we don't have it. Must not invent it. `suggest` = product IDs that are good alternatives (at least one mentioned) |
| `unavailable` | Says it's not available right now (hidden in the POS) |
| `order` | Understands the order: `items` = `[{"p", "size", "qty"}]` must match exactly. If `total` is true the reply must state the total **calculated by code** |
| `handoff` | The information isn't in the POS/FAQ: must not invent it; says a team member will confirm. `topic` = which FAQ answer would make this an `answer` |
| `refuse` | Politely declines (prompt injection, discount demands, off-topic, other people's data) and stays on restaurant topics |
| `greet` | Friendly greeting / thanks, offers help |

Checked on **every** reply, whatever the type:
- every `Rs` amount in the reply exists in the live menu, delivery fees, or the code-calculated total (no invented prices)
- the reply is in the customer's language/script
- `not_says` words do not appear

Tip: Urdu words have several correct spellings (موزریلا / موزاریلا, ٹماٹر / ٹماٹو, کمرشل / کامرشل). List every spelling in `says`, or the test fails a correct reply.

Order-flow fields (type `order`): `needs` = "fulfilment" | "address" (code must ask for it; no YES yet) · `complete: true`
(YES offered) · `fulfilment` · `address_has` (words the saved address must contain) · `pin: true` (a location pin is used;
the case's `location` {lat, lng} is passed to the assistant).
