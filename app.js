/* ===== Bitcoin Retirement Calculator — borrow 'til you die simulation =====
 *
 * Model (see PLANNING.md §3):
 *   P_t = P0 * (1+g)^t                       BTC price
 *   E_t = E0 * (1+i)^t                       inflation-adjusted annual spend
 *   L_0 = E_k                                first loan (retirement year k)
 *   L_j = L_{j-1} * (1+r) + E_{k+j}          refinance old loan + new spend
 *   V_t = B * P_t                            portfolio value
 *   feasible(j) <=> L_j <= lambdaEff * V_t   per risk profile
 */

'use strict';

/* ---------- Risk profiles: effective LTV you borrow at ----------
   Most lenders cap loans around 50% LTV, so that is the Aggressive option.
   Lower LTVs = bigger buffer against drawdowns between refinances. */
const RISK_PROFILES = {
  aggressive:   { ltv: 0.50, label: 'Aggressive' },
  moderate:     { ltv: 0.25, label: 'Moderate' },
  conservative: { ltv: 0.10, label: 'Conservative' },
};
const WARN_THRESHOLD = 0.8; // warn when within 20% of the profile limit

/* ---------- DOM refs ---------- */
const $ = (id) => document.getElementById(id);
const inputIds = [
  'btcHoldings', 'annualSpend', 'btcPrice', 'inflation',
  'btcReturn', 'loanRate', 'currentAge', 'deathAge', 'targetAge',
];

/* ---------- Mode: forward (when can I retire?) vs reverse (how much BTC?) ---------- */
let mode = 'forward';

function setMode(next) {
  mode = next;
  $('mode-forward').classList.toggle('active', mode === 'forward');
  $('mode-reverse').classList.toggle('active', mode === 'reverse');
  $('field-btcHoldings').classList.toggle('hidden', mode === 'reverse');
  $('field-targetAge').classList.toggle('hidden', mode === 'forward');
  if (!$('snapshot').classList.contains('hidden')) calculate();
}

/* ---------- Formatting ---------- */
const fmtUSD = new Intl.NumberFormat('en-US', {
  style: 'currency', currency: 'USD', maximumFractionDigits: 0,
});
const fmtUSD2 = new Intl.NumberFormat('en-US', {
  style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2,
});
/** Compact USD for table cells: $1.2M, $340K, $950 — keeps the table narrow. */
const fmtCompact = (v) => {
  const abs = Math.abs(v);
  if (abs >= 1e9) return `$${(v / 1e9).toFixed(1)}B`;
  if (abs >= 1e6) return `$${(v / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `$${(v / 1e3).toFixed(0)}K`;
  return `$${v.toFixed(0)}`;
};
const fmtBTC = (v) => `${v.toFixed(4)} BTC`;
const fmtPct = (v) => `${(v * 100).toFixed(1)}%`;
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

/* ---------- Input handling ---------- */
function readInputs() {
  const v = Object.fromEntries(inputIds.map((id) => [id, parseFloat($(id).value)]));
  const errors = [];

  if (Object.values(v).some((x) => Number.isNaN(x))) errors.push('All fields must be numbers.');
  if (mode === 'forward' && v.btcHoldings <= 0) errors.push('Bitcoin holdings must be greater than 0.');
  if (v.annualSpend <= 0)   errors.push('Annual spending must be greater than 0.');
  if (v.btcPrice <= 0)      errors.push('BTC price must be greater than 0.');
  if (v.inflation < 0)      errors.push('Inflation cannot be negative.');
  if (v.loanRate < 0)       errors.push('Loan interest cannot be negative.');
  if (v.currentAge < 0)     errors.push('Current age must be 0 or more.');
  if (v.deathAge <= v.currentAge) errors.push('"Plan until age" must be greater than current age.');
  if (mode === 'reverse' && (v.targetAge <= v.currentAge || v.targetAge >= v.deathAge)) {
    errors.push('Target retirement age must be between your current age and "plan until" age.');
  }

  if (errors.length) return { errors };

  return {
    params: {
      btcHoldings: v.btcHoldings,
      annualSpend: v.annualSpend,          // today's dollars
      btcPrice0: v.btcPrice,
      inflation: v.inflation / 100,
      btcReturn: v.btcReturn / 100,
      loanRate: v.loanRate / 100,
      currentAge: Math.floor(v.currentAge),
      deathAge: Math.floor(v.deathAge),
      targetAge: Math.floor(v.targetAge),
      profileLtv: RISK_PROFILES[$('riskProfile').value].ltv,
      profileLabel: RISK_PROFILES[$('riskProfile').value].label,
    },
  };
}

/* ---------- Simulation ---------- */

/** Run the loan chain for one candidate retirement start year k. */
function simulateFrom(p, k, horizon) {
  const borrowLtv = p.profileLtv;
  const rows = [];
  let loan = null; // becomes E_k on the first iteration

  for (let j = 0; j <= horizon - k; j++) {
    const t = k + j; // years from today
    const price = p.btcPrice0 * Math.pow(1 + p.btcReturn, t);
    const spend = p.annualSpend * Math.pow(1 + p.inflation, t);
    const value = p.btcHoldings * price;

    loan = loan === null ? spend : loan * (1 + p.loanRate) + spend;

    const maxBorrow = borrowLtv * value;
    const debtRatio = value > 0 ? loan / value : Infinity;
    const collateralBTC = borrowLtv > 0 ? loan / (borrowLtv * price) : Infinity;
    const freeBTC = p.btcHoldings - collateralBTC;

    let status = 'ok';
    if (loan > maxBorrow) status = 'fail';
    else if (loan > WARN_THRESHOLD * maxBorrow) status = 'warn';

    rows.push({
      year: new Date().getFullYear() + t,
      age: p.currentAge + t,
      price, spend, value, loan, collateralBTC, freeBTC, debtRatio, status,
    });

    if (status === 'fail') break; // strategy is dead; no point continuing
  }

  const feasible = rows[rows.length - 1].status !== 'fail' &&
                   rows.length === horizon - k + 1;
  return { k, rows, feasible };
}

/** Find the earliest retirement year k where the chain survives to the horizon. */
function findEarliestRetirement(p) {
  const horizon = p.deathAge - p.currentAge; // years from today until death
  let firstFailure = null;

  for (let k = 0; k <= horizon; k++) {
    const result = simulateFrom(p, k, horizon);
    if (result.feasible) return { kind: 'success', result, horizon };
    if (k === 0) firstFailure = result; // keep k=0 chain to show where it breaks today
  }
  return { kind: 'fail', result: firstFailure, horizon };
}

/* ---------- Reverse mode: minimum BTC to retire at a target age ---------- */

/**
 * The loan chain L_j is independent of stack size, and feasibility is
 * L_j <= ltv * B * P_t  <=>  B >= L_j / (ltv * P_t).
 * So the minimum stack is the max of that ratio across the whole chain.
 */
function minBtcForRetirement(p, k, horizon) {
  let loan = null;
  let minBtc = 0;
  let bindingT = k;

  for (let j = 0; j <= horizon - k; j++) {
    const t = k + j;
    const price = p.btcPrice0 * Math.pow(1 + p.btcReturn, t);
    const spend = p.annualSpend * Math.pow(1 + p.inflation, t);
    loan = loan === null ? spend : loan * (1 + p.loanRate) + spend;

    const required = loan / (p.profileLtv * price);
    if (required > minBtc) { minBtc = required; bindingT = t; }
  }
  return { minBtc, bindingT };
}

/** Solve for the stack needed at the user's target retirement age. */
function solveReverse(p) {
  const horizon = p.deathAge - p.currentAge;
  const k = p.targetAge - p.currentAge;
  const { minBtc, bindingT } = minBtcForRetirement(p, k, horizon);
  const result = simulateFrom({ ...p, btcHoldings: minBtc }, k, horizon);
  return { kind: 'reverse', result, horizon, minBtc, bindingT };
}

/* ---------- Rendering ---------- */

function renderSnapshot(p, outcome) {
  const hero = $('snapshot-hero');
  const cards = $('snapshot-cards');

  if (outcome.kind === 'reverse') {
    const { minBtc, bindingT } = outcome;
    const { k, rows } = outcome.result;
    const first = rows[0];
    const last = rows[rows.length - 1];
    const binding = rows[bindingT - k];

    hero.classList.remove('fail');
    hero.innerHTML =
      `<h2>You need <span class="age">${minBtc.toFixed(4)} BTC</span> to retire at age <span class="age">${p.targetAge}</span></h2>
       <p>That's <strong>${fmtUSD.format(minBtc * p.btcPrice0)}</strong> at today's price — sustainable to age ${p.deathAge} on the ${p.profileLabel} profile.</p>`;

    cards.innerHTML = [
      { value: fmtUSD.format(minBtc * p.btcPrice0), label: 'Cost at today\'s price' },
      { value: fmtUSD.format(first.value), label: `Portfolio value at retirement (${first.year})` },
      { value: fmtUSD.format(first.loan), label: 'First-year loan' },
      { value: `${binding.year} (age ${binding.age})`, label: `Tightest year — debt hits ${fmtPct(binding.debtRatio)} of stack` },
    ].map((c) => `<div class="stat-card"><div class="value">${c.value}</div><div class="label">${c.label}</div></div>`).join('');

    $('snapshot').classList.remove('hidden');
    return;
  }

  if (outcome.kind === 'success') {
    const { k, rows } = outcome.result;
    const retireAge = p.currentAge + k;
    const retireDate = new Date();
    retireDate.setFullYear(retireDate.getFullYear() + k);
    const first = rows[0];
    const last = rows[rows.length - 1];

    hero.classList.remove('fail');
    hero.innerHTML = k === 0
      ? `<h2>You can retire <span class="age">now</span>, at age <span class="age">${retireAge}</span></h2>
         <p>The borrow 'til you die strategy survives to age ${p.deathAge} on the ${p.profileLabel} profile.</p>`
      : `<h2>You can retire at age <span class="age">${retireAge}</span></h2>
         <p>That's <strong>${k} year${k === 1 ? '' : 's'}</strong> from today (${MONTHS[retireDate.getMonth()]} ${retireDate.getFullYear()}) — sustainable to age ${p.deathAge} on the ${p.profileLabel} profile.</p>`;

    cards.innerHTML = [
      { value: k === 0 ? 'Now' : `${k} yr`, label: 'Until retirement' },
      { value: fmtUSD.format(first.value), label: `Portfolio value at retirement (${first.year})` },
      { value: fmtUSD.format(first.loan), label: 'First-year loan' },
      { value: fmtUSD.format(last.loan), label: `Debt at age ${p.deathAge} (${fmtPct(last.debtRatio)} of stack)` },
    ].map((c) => `<div class="stat-card"><div class="value">${c.value}</div><div class="label">${c.label}</div></div>`).join('');
  } else {
    const { rows } = outcome.result;
    const broke = rows[rows.length - 1];
    hero.classList.add('fail');
    hero.innerHTML =
      `<h2><span class="age">Not sustainable</span> with these inputs</h2>
       <p>Starting today, the strategy breaks in <strong>${broke.year}</strong> (age ${broke.age}) — and waiting longer doesn't fix it.
       Try more BTC, lower spending, a higher assumed return, or the Aggressive profile.</p>`;

    cards.innerHTML = [
      { value: `${broke.age - p.currentAge} yr`, label: 'Until the strategy breaks' },
      { value: fmtUSD.format(broke.loan), label: `Loan needed in ${broke.year}` },
      { value: fmtUSD.format(p.profileLtv * broke.value), label: `Borrowing power at ${(p.profileLtv * 100).toFixed(0)}% LTV` },
      { value: fmtPct(broke.debtRatio), label: 'Debt-to-assets at failure' },
    ].map((c) => `<div class="stat-card"><div class="value">${c.value}</div><div class="label">${c.label}</div></div>`).join('');
  }

  $('snapshot').classList.remove('hidden');
}

const STATUS_ICON = { ok: '✅', warn: '⚠️', fail: '❌' };

function renderTable(p, outcome) {
  const { result, horizon } = outcome;
  const body = $('results-body');

  body.innerHTML = result.rows.map((r) => `
    <tr class="status-${r.status}">
      <td>${r.year}</td>
      <td>${r.age}</td>
      <td title="${fmtUSD2.format(r.price)}">${fmtCompact(r.price)}</td>
      <td title="${fmtUSD.format(r.value)}">${fmtCompact(r.value)}</td>
      <td title="${fmtUSD.format(r.spend)}">${fmtCompact(r.spend)}</td>
      <td title="${fmtUSD.format(r.loan)}">${fmtCompact(r.loan)}</td>
      <td>${r.collateralBTC.toFixed(3)}</td>
      <td>${r.freeBTC.toFixed(3)}</td>
      <td>${fmtPct(r.debtRatio)}</td>
      <td class="status-badge" title="${r.status}">${STATUS_ICON[r.status]}</td>
    </tr>`).join('');

  const note = $('table-note');
  if (outcome.kind === 'reverse') {
    const binding = result.rows[outcome.bindingT - result.k];
    note.textContent = `Minimum stack of ${outcome.minBtc.toFixed(4)} BTC, retiring at age ${p.targetAge}. The binding year is ${binding.year} (age ${binding.age}) — debt peaks at ${fmtPct(binding.debtRatio)} of the stack, exactly at your ${(p.profileLtv * 100).toFixed(0)}% LTV limit.`;
  } else if (outcome.kind === 'success') {
    const k = result.k;
    note.textContent = k === 0
      ? `Retiring today. Each year you refinance the old loan (plus ${(p.loanRate * 100).toFixed(1)}% interest) and borrow that year's expenses on top.`
      : `Strategy begins at age ${p.currentAge + k} (${new Date().getFullYear() + k}). Your stack compounds at ${(p.btcReturn * 100).toFixed(1)}%/yr until then — no loans before retirement.`;
  } else {
    note.textContent = `Shown: what happens if you retire today. The chain fails the first year the required loan exceeds your ${(p.profileLtv * 100).toFixed(0)}% LTV borrowing limit (${p.profileLabel} profile).`;
  }

  $('breakdown').classList.remove('hidden');
  syncTopScrollbar();
}

function renderError(errors) {
  const hero = $('snapshot-hero');
  hero.classList.add('fail');
  hero.innerHTML = `<h2><span class="age">Check your inputs</span></h2>
    <p>${errors.join('<br>')}</p>`;
  $('snapshot-cards').innerHTML = '';
  $('snapshot').classList.remove('hidden');
  $('breakdown').classList.add('hidden');
}

/* ---------- Dual horizontal scrollbar (top + bottom) ---------- */
const tableWrap = $('table-wrap');
const scrollTopBar = $('scroll-top');
const scrollSpacer = $('scroll-spacer');
let syncingScroll = false;

function syncTopScrollbar() {
  scrollSpacer.style.width = `${tableWrap.scrollWidth}px`;
}

function mirrorScroll(source, target) {
  source.addEventListener('scroll', () => {
    if (syncingScroll) return;
    syncingScroll = true;
    target.scrollLeft = source.scrollLeft;
    syncingScroll = false;
  });
}
mirrorScroll(tableWrap, scrollTopBar);
mirrorScroll(scrollTopBar, tableWrap);
window.addEventListener('resize', syncTopScrollbar);

/* ---------- Main ---------- */

function calculate() {
  const { params, errors } = readInputs();
  if (errors) { renderError(errors); return; }
  const outcome = mode === 'reverse' ? solveReverse(params) : findEarliestRetirement(params);
  renderSnapshot(params, outcome);
  renderTable(params, outcome);
}

$('calculate').addEventListener('click', calculate);
$('mode-forward').addEventListener('click', () => setMode('forward'));
$('mode-reverse').addEventListener('click', () => setMode('reverse'));
inputIds.concat(['riskProfile']).forEach((id) => {
  $(id).addEventListener('input', () => {
    if (!$('snapshot').classList.contains('hidden')) calculate();
  });
});

// Run once on load so the page isn't empty.
calculate();
