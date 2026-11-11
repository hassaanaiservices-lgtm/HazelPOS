# Voice-note test recordings

**Goal:** real test material for the speech-to-text engine. Every recording you correct becomes a test case, and every
engine change is scored on all of them — so we improve on *your customers' voices*, not on news readers.

## How to record (important)

- **Don't read.** Look at a scenario, put the phone down, and talk the way a customer would: "umm", "yaar", restarting
  a sentence, changing your mind, English words in Urdu. Reading neat sentences gives results that won't hold up.
- **Mix the length:** some 3–5 second notes, some 15–30 seconds, a couple of a minute or more.
- **Mix the conditions:** quiet room, kitchen/road noise, TV on, phone held far away, walking, fast speech.
- **More than one voice** if you can (a friend, a family member, someone older, a woman's voice) — the engine must
  work for all customers.
- **Send each as a WhatsApp voice note** to the linked number, as a customer would.

## Then, in the POS (2 minutes)

Open the chat → on each voice note tap **✎** → type **exactly what you said**, in Roman Urdu or Urdu script, as it
comes naturally (spelling doesn't need to be perfect). Tap 👍 instead if the transcript was already right.

See the ratings and corrections any time:
```bash
sqlite3 server/pos.db "SELECT rating, transcript, corrected FROM stt_feedback ORDER BY id DESC"
```

## Scenarios (pick at least 15; do the ★ ones)

**Short (3–8 s)**
1. ★ Ask the price of one item, any size.
2. ★ Ask "what's on the menu / what do you have".
3. Say yes/confirm in your own way ("haan ji theek hai bhej do").
4. ★ Cancel an order.
5. Ask how long delivery takes.
6. Ask if something not on the menu exists (biryani, shawarma, Pepsi).

**Ordering (10–30 s)**
7. ★ Order 2–3 items with sizes and quantities, in one breath.
8. ★ Order, then change your mind mid-sentence ("nahi nahi, medium kar do").
9. Order using numbers in Urdu ("teen", "dedh litre", "barah piece").
10. ★ Order for delivery and give your full address with a landmark.
11. Order takeaway and say when you'll come ("aadhe ghante mein").
12. Add an item to an order you already placed ("aur ek coke bhi").

**Talking (30 s – 2 min)**
13. ★ A long order for a family: several pizzas, sides, drinks, a question about spice, delivery address.
14. Complain about last time (cold food / late), ask for a discount, then order anyway.
15. Ask for a suggestion ("kya acha hai? bachon ke liye kya loon?"), react to it, then order.
16. Ask about deals, payment (JazzCash / cash), and timings in one note.

**Hard conditions (any content)**
17. ★ Background noise (kitchen, road, TV).
18. ★ Very fast speech.
19. Phone held far from the mouth / speaker-phone style.
20. A different person's voice.
