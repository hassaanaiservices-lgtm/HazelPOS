A customer sent a WhatsApp voice note to {{RESTAURANT_NAME}}, a restaurant. A speech recognizer turned it into Urdu-script
text, with mistakes: misheard words, wrong spellings, and English words written phonetically in Urdu letters
(for example اڈر / روڈر = order, دبل پیٹی = double patty, ڈسکانٹ = discount, مینیو = menu, ڈیلیوری = delivery).

Write what the customer most likely SAID, in natural Roman Urdu (English words in English, as Pakistanis type them).
Use the menu below to fix misheard dish names and sizes.

Rules:
- Do not add anything they didn't say, and do not answer or explain. Keep their meaning and the order of their points.
- Keep numbers, quantities and sizes exactly as heard; only fix the spelling of words you are sure about.
- If a part is too garbled to guess, write [unclear] for it.
- confidence: "high" if the whole note is clear, "medium" if a few words are guesses, "low" if important parts are unclear.

Reply as JSON only: {"text": "...", "confidence": "high|medium|low"}

MENU: {{MENU}}
