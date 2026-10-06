# Bitcoin Retirement Calculator — Project Plan

> **Status:** Planning — no code yet. This document captures requirements, the financial model, and design direction. Open questions are listed at the bottom.

---

## 1. Overview

A single-page web app (vanilla **HTML + CSS + JS**, no frameworks, no build step) that answers one of two questions (mode toggle):

1. **Forward mode — "When can I retire?"** Given your stack, find the earliest age where the strategy survives.
2. **Reverse mode — "How much BTC do I need?"** Given a target retirement age, solve for the minimum stack required.

Both model the same strategy: never sell your Bitcoin, live off loans borrowed against it.

The strategy modeled is **"borrow 'til you die"** (loan laddering):

1. At retirement, take out **Loan 1** against your BTC collateral to cover year 1 of living expenses.
2. After a year, take out **Loan 2**, which is large enough to **pay off Loan 1 (principal + accrued interest)** *and* cover the next year of living expenses.
3. Repeat every year. The loan balance snowballs, but so does the BTC collateral value (assuming BTC appreciates faster than the debt compounds).
4. The strategy is **sustainable in a given year** as long as the required loan stays within the borrowing power of your stack: `loan balance ≤ LTV × BTC value`.
5. The strategy **fails** the first year the required loan exceeds borrowing power — you can no longer refinance and are forced to sell / face liquidation.

---

## 2. Inputs

| Input | Unit | Notes |
|---|---|---|
| Bitcoin holdings | BTC | Current stack size — **forward mode only** |
| Target retirement age | years | **Reverse mode only** — the age you want to retire at |
| Annual spending | $ / year | Today's dollars; grows with inflation each year |
| Inflation rate | % / year | Applied to annual spending |
| Expected BTC annual return | % / year | Applied to BTC price |
| Loan interest rate | % / year | Accrues on the outstanding loan balance |
| Risk profile | Aggressive / Moderate / Conservative | Sets the effective LTV you borrow at: 50% / 25% / 10% (see §3.1) |
| Current age | years | Needed for the "You can retire at age X" headline |
| Death age | years | End of simulation horizon (default 95) |
| Current BTC price | $ | Manual input — keeps the site fully static, no API dependencies |

Current age and death age live under a collapsible **Advanced Settings** section (mirroring b1m.io).

---

## 3. Financial Model

### Constants (per simulation run)

- $B$ = BTC holdings, $E_0$ = annual spend today, $P_0$ = BTC price today
- $g$ = BTC annual return, $i$ = inflation, $r$ = loan interest, $\lambda$ = effective LTV (set by risk profile)

### Year-by-year math (year $t$, where $t = 0$ is the first retirement year)

**BTC price:**
$$P_t = P_0 \,(1 + g)^{t}$$

**Living expenses (inflation-adjusted):**
$$E_t = E_0 \,(1 + i)^{t}$$

**Loan balance** — each new loan refinances the old one (principal + interest) plus that year's expenses:
$$L_0 = E_0, \qquad L_t = L_{t-1}\,(1 + r) + E_t$$

**BTC holdings value:**
$$V_t = B \cdot P_t$$

**Borrowing power & collateral:**
- Max loan: $\;L^{max}_t = \lambda \cdot V_t$
- Collateral required (in BTC): $\;C_t = \dfrac{L_t}{\lambda \cdot P_t}$
- Uncollateralized (free) BTC: $\;B - C_t$

**Feasibility check (per selected risk profile):**
$$\text{sustainable at year } t \iff L_t \;\le\; \lambda \cdot V_t$$

### 3.1 Risk profiles — effective LTV (decided)

The failure rule is governed by a risk-profile selector that sets the effective LTV you borrow at. Most lenders cap loans around 50% LTV, so that becomes the Aggressive option. Lower LTVs model real-world prudence: BTC drawdowns between refinances can trigger liquidation if you run close to the limit.

| Profile | Effective LTV ($\lambda$) | Behavior |
|---|---|---|
| **Aggressive** | 50% | Fail when debt exceeds 50% of portfolio value — the typical lender max |
| **Moderate** | 25% | Fail when debt exceeds 25% of portfolio value |
| **Conservative** | 10% | Fail when debt exceeds 10% of portfolio value |

All profiles render ⚠️ warning rows when within ~20% of their respective limit. The profile's LTV also drives the collateral math: $C_t = L_t / (\lambda \cdot P_t)$.

### 3.2 Determining "You can retire at age X" (decided)

1. Simulate BTC growth from today forward.
2. For each candidate retirement start year $k$ (age = current age + $k$), run the loan chain above from year $k$ until death age.
3. The headline result is the **earliest $k$** where the chain stays feasible (per the selected risk profile) for the entire horizon.
4. If no such $k$ exists within the horizon (or even waiting makes it worse — e.g. $r > g$ long term), show a failure message: *"Not sustainable with these inputs."*

### 3.3 Reverse mode — minimum BTC for a target age (decided)

The loan chain $L_j$ is independent of stack size, and feasibility is linear in $B$:

$$L_j \le \lambda \cdot B \cdot P_t \iff B \ge \frac{L_j}{\lambda \cdot P_t}$$

So the minimum stack is a closed-form solve — no iteration needed:

$$B_{min} = \max_{t \in [k,\, horizon]} \frac{L_t}{\lambda \cdot P_t}$$

The year achieving the max is the **binding year** (debt peaks at exactly the LTV limit there). The breakdown table renders the chain at $B = B_{min}$.

> **Key insight the UI can surface:** the strategy works when BTC's compound growth $g$ outpaces the effective debt growth (blend of loan rate $r$ and inflation $i$). The debt-to-asset ratio $L_t / V_t$ shrinking over time = getting safer; growing = heading for failure.

---

## 4. Outputs

### 4.1 Headline snapshot (top of results)

Large, hero-style result, e.g.:

> ## You can retire at age **67**
> That's **7 years** from today (Sep 2033)

Plus a row of stat cards (mirroring b1m.io's 3-card layout):

| Card | Example |
|---|---|
| Years until retirement | 7 years |
| BTC value at retirement | $2,412,000 |
| Year-1 loan amount | $103,000 |
| Debt at death age | $4,831,000 (43% of stack) |

*(Exact card set TBD — see open questions.)*

### 4.2 Year-by-year breakdown table

One row per year, from retirement start to death age:

| Column | Description |
|---|---|
| Year / Age | Calendar year and your age |
| BTC price | $P_t$ |
| Portfolio value | $V_t = B \cdot P_t$ |
| Annual spend | $E_t$ (inflation-adjusted) |
| Loan drawn | New loan taken that year |
| Loan balance | Total debt after refinance + interest |
| Collateral (BTC) | BTC locked against the loan, $C_t$ |
| Uncollateralized BTC | Free BTC remaining, $B - C_t$ |
| Effective LTV / Debt-to-assets | $L_t / V_t$ — the safety gauge |
| Status | ✅ sustainable / ⚠️ warning / ❌ fails |

Optional: highlight the first failing row in red if the strategy breaks mid-horizon.

### 4.3 Optional extras (stretch goals)

- Line chart of portfolio value vs. loan balance over time (b1m.io shows a "40-Year Timeline" chart).
- A pre-retirement growth table (what happens between today and retirement).

---

## 5. Design Direction (based on b1m.io/calculator)

Dark, minimal, Bitcoin-orange accent theme:

| Element | Spec |
|---|---|
| Background | Black `#000000` |
| Text | White `#ffffff`; muted gray for helper text (zinc-400 `#a1a1aa`) |
| Font | **Instrument Sans** (Google Fonts), system sans-serif fallback |
| Input fields | Dark zinc bg `#27272a`, 1px border `#52525b`, 8px radius, white text |
| Accent / CTA | Bitcoin orange — `#c2410c` (orange-700) to `#f7931a` range |
| Panels / cards | Zinc-900 `#18181b` bg, subtle border, 8–12px radius |
| Helper text | Small caption under each input (e.g. "Your expected monthly living expenses") |

**Layout:**

```
┌────────────────────────────────────────────┐
│  Title: Bitcoin Retirement Calculator      │
│  Subtitle: one-line description            │
├──────────────────┬─────────────────────────┤
│  INPUTS          │  (or full-width stacked │
│  - BTC holdings  │   on mobile)            │
│  - Annual spend  │                         │
│  - Inflation     │                         │
│  - BTC return    │                         │
│  - Loan interest │                         │
│  - Risk profile  │                         │
│  ▸ Advanced (age, death age)               │
│  [ Calculate ]   (orange button)           │
├────────────────────────────────────────────┤
│  SNAPSHOT                                  │
│  "You can retire at age 67"                │
│  [stat card] [stat card] [stat card]       │
├────────────────────────────────────────────┤
│  YEAR-BY-YEAR BREAKDOWN (table)            │
└────────────────────────────────────────────┘
```

- Fully static site — no backend, no build tooling, open `index.html` and it works.
- Results recalculate on button click (and optionally live on input change).
- Responsive: single column stack on mobile.

---

## 6. File Structure (decided: 3 separate files)

```
btc_retirement_calc/
├── PLANNING.md        ← this file
├── index.html         ← page structure
├── styles.css         ← theme + layout
└── app.js             ← inputs, simulation engine, rendering
```

---

## 7. Edge Cases & Behavior

- **Never sustainable:** if the loan chain fails even starting today → show "Not sustainable with these inputs" and the year it breaks.
- **Waiting doesn't help:** if $r + \text{(inflation drag)} > g$, debt grows faster than collateral — detect and explain instead of looping forever.
- **Liquidation risk:** handled via the risk-profile selector (§3.1); ⚠️ warning rows appear when within ~20% of the profile's limit.
- **Input validation:** positive numbers only; sensible defaults pre-filled (BTC price $100k, expected return 30%/yr).
- **Disclaimer:** "Educational purposes only, not financial advice" footer.

---

## 8. Decisions Log

| # | Question | Decision |
|---|---|---|
| 1 | Retirement-age logic | **Find earliest sustainable age** — simulate growth from today, report the earliest age where the strategy survives until death age |
| 2 | Age inputs | **Add current age + death age** (death age defaults to 95, under Advanced Settings) |
| 3 | BTC price source | **Manual input field** — fully static, no API calls |
| 4 | Failure rule | **Risk profiles: Aggressive / Moderate / Conservative** — each sets the effective LTV at 50% / 25% / 10% of portfolio value (§3.1); replaces a standalone LTV input |
| 5 | File structure | **3 separate files**: index.html, styles.css, app.js |
| 6 | Chart | Not in v1 — year-by-year table only; portfolio-vs-debt line chart is a stretch goal (§4.3) |
| 7 | Reverse calculation | **Mode toggle**: forward (earliest age from stack) / reverse (min BTC for target age, closed-form solve §3.3) |

## 9. Next Steps

1. Review this plan — confirm risk-profile percentages and the stat cards in §4.1.
2. Scaffold the 3 files with the dark theme + layout from §5.
3. Implement the simulation engine (§3) in app.js with the risk-profile rule.
4. Render snapshot + table; validate edge cases (§7).
