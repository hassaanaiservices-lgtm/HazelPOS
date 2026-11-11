# Data validation report

Run: 11/9/2026, 8:36:16 PM · POS export: 11/9/2026, 8:36:16 PM

**0 errors · 2 warnings · 0 info**

## Documents loaded

| Type | Count |
|---|---|
| restaurant | 1 |
| product | 17 |
| category | 5 |
| **total** | **23** |

## Issues

| Level | Where | Problem |
|---|---|---|
| warning | delivery | no delivery areas set up in the POS (Settings → Delivery Zones): "do you deliver to X?" can't be answered |
| warning | faq | no FAQ files yet (rag/data/raw/faq/): opening hours, payment methods, halal, etc. can't be answered |

## Example documents (what search will read)

**product:1** (menu.json)
```
Margherita (Pizza)
Pizza · Serves 1–3 depending on size
Classic hand-stretched pizza with slow-cooked tomato sauce, fresh mozzarella and basil, baked in a stone oven.
Ingredients: Mozzarella, Tomato sauce, Fresh basil, Olive oil
Sizes: Small (8 inch), Medium (10 inch), Large (12 inch)
```

**category:1** (categories.json)
```
Pizza menu: Margherita, Pepperoni, Chicken Tikka, Fajita, Veggie Supreme
```

**restaurant:info** (restaurant.json)
```
Restaurant: Pizza Venu
Address / location: Commercial Market, Block B, Main Boulevard
Phone: +92 300 1234567
```
