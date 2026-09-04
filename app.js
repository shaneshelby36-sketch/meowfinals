'use strict';

// When the dashboard is served from the same place as the engine (e.g. one
// combined Render deployment), it should just talk to itself automatically
// — no manual settings needed. Falls back to localhost only if opened as a
// bare local file with no real origin.
const AUTO_ENGINE_URL =
  typeof window !== 'undefined' && window.location && window.location.origin && window.location.origin !== 'null'
    ? window.location.origin
    : 'http://localhost:4000';

const DEFAULTS = {
  engineUrl: AUTO_ENGINE_URL,
  refreshSeconds: 7,
};

const ASSET_LABELS = {
  BTC: 'Bitcoin',
  XRP: 'XRP',
  ETH: 'Ethereum',
  SOL: 'Solana',
  BNB: 'BNB',
  NEAR: 'NEAR',
  HYPE: 'HYPE',
  DOGE: 'Dogecoin',
  ZEC: 'Zcash',
  GOLD: 'Gold',
  SILVER: 'Silver',
  OIL: 'Oil (WTI)',
};

// Non-asset keys that can appear alongside per-symbol entries in the
// /api/latest response — used to figure out which keys are actual assets.
const NON_ASSET_KEYS = new Set([
  'correlation',
  'correlations',
  'timestamp',
  'feedStatus',
  'message',
  'manualStrikes',
  'engineSymbols',
]);

const REC_CLASS = {
  'Strong UP': 'strong-buy',
  UP: 'buy',
  'Strong Buy': 'strong-buy', // legacy
  Buy: 'buy',
  Wait: 'wait',
  DOWN: 'sell',
  'Strong DOWN': 'strong-sell',
  Sell: 'sell',
  'Strong Sell': 'strong-sell',
};

const MAX_BROWSER_WINDOWS = 3;
const WINDOW_REGISTRY_KEY = 'cpe-window-registry';
const PINNED_ASSETS_KEY = 'cpe-pinned-assets';
const WINDOW_CHANNEL_NAME = 'cpe-windows';
const THIS_WINDOW_ID = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

function parseFocusView() {
  const view = new URLSearchParams(window.location.search).get('view');
  if (!view) return { mode: 'hub' };
  if (view.toLowerCase() === 'bot') return { mode: 'bot' };
  return { mode: 'asset', symbol: view.toUpperCase() };
}

const FOCUS_VIEW = parseFocusView();

let pollTimer = null;
let lastPrices = {};
let latestRankedSymbols = [];
let windowChannel = null;
const companionHandles = {};

// ---------- multi-window registry (max 3: 2 cryptos + bot) ----------

function readWindowRegistry() {
  try {
    const raw = JSON.parse(localStorage.getItem(WINDOW_REGISTRY_KEY) || '[]');
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

function writeWindowRegistry(entries) {
  localStorage.setItem(WINDOW_REGISTRY_KEY, JSON.stringify(entries.slice(0, MAX_BROWSER_WINDOWS)));
}

function registerThisWindow() {
  const role =
    FOCUS_VIEW.mode === 'bot' ? 'bot' : FOCUS_VIEW.mode === 'asset' ? `asset:${FOCUS_VIEW.symbol}` : 'hub';
  const now = Date.now();
  const entries = readWindowRegistry()
    .filter((e) => e && e.id && now - (e.seenAt || 0) < 60000)
    .filter((e) => e.id !== THIS_WINDOW_ID);
  entries.push({ id: THIS_WINDOW_ID, role, seenAt: now, href: location.href });
  writeWindowRegistry(entries);
  if (windowChannel) {
    windowChannel.postMessage({ type: 'ping', id: THIS_WINDOW_ID, role, href: location.href });
  }
  updateOpenWindowsButton();
}

function unregisterThisWindow() {
  writeWindowRegistry(readWindowRegistry().filter((e) => e.id !== THIS_WINDOW_ID));
  if (windowChannel) windowChannel.postMessage({ type: 'closed', id: THIS_WINDOW_ID });
}

function initWindowCoordination() {
  try {
    windowChannel = new BroadcastChannel(WINDOW_CHANNEL_NAME);
    windowChannel.onmessage = (event) => {
      const msg = event.data || {};
      if (msg.type === 'ping' || msg.type === 'closed') {
        registerThisWindow();
      }
    };
  } catch {
    windowChannel = null;
  }
  registerThisWindow();
  setInterval(registerThisWindow, 15000);
  window.addEventListener('beforeunload', unregisterThisWindow);
  window.addEventListener('pagehide', unregisterThisWindow);
}

function buildViewUrl(view) {
  const url = new URL(window.location.href);
  url.searchParams.set('view', view);
  return url.toString();
}

function openViewWindow(view, name) {
  const registry = readWindowRegistry().filter((e) => Date.now() - (e.seenAt || 0) < 60000);
  const role = view === 'bot' ? 'bot' : `asset:${String(view).toUpperCase()}`;
  const existingRole = registry.find((e) => e.role === role);
  if (existingRole && companionHandles[name] && !companionHandles[name].closed) {
    companionHandles[name].focus();
    return { ok: true, existing: true };
  }
  if (registry.length >= MAX_BROWSER_WINDOWS) {
    return { ok: false, reason: 'max' };
  }
  const handle = window.open(buildViewUrl(view), name, 'noopener,noreferrer');
  if (!handle) return { ok: false, reason: 'blocked' };
  companionHandles[name] = handle;
  registerThisWindow();
  return { ok: true };
}

function openOtherWindows() {
  const ranked = latestRankedSymbols;
  const btn = document.getElementById('open-windows-btn');

  if (FOCUS_VIEW.mode === 'hub') {
    const pinned = loadPinnedAssets();
    const featured = pickFeaturedSymbols(ranked, pinned);
    const best = featured[0] || ranked[0];
    const second = featured[1] || ranked.find((s) => s !== best);
    let blocked = false;
    let opened = 0;

    // Turn this hub into the best-crypto window, and open the other two roles.
    if (second) {
      const result = openViewWindow(second, `cpe-${second}`);
      if (result.reason === 'blocked') blocked = true;
      if (result.ok && !result.existing) opened += 1;
    }
    {
      const result = openViewWindow('bot', 'cpe-bot');
      if (result.reason === 'blocked') blocked = true;
      if (result.ok && !result.existing) opened += 1;
    }

    if (blocked && btn) {
      btn.textContent = 'Pop-ups blocked — allow pop-ups, then try again';
      setTimeout(() => updateOpenWindowsButton(), 3500);
      return;
    }

    if (best) {
      window.location.assign(buildViewUrl(best));
      return;
    }

    updateOpenWindowsButton();
    if (btn && opened === 0) {
      btn.textContent = 'Windows already open';
      setTimeout(() => updateOpenWindowsButton(), 2500);
    }
    return;
  }

  const targets = [];
  if (FOCUS_VIEW.mode === 'asset') {
    const others = ranked.filter((s) => s !== FOCUS_VIEW.symbol).slice(0, 2);
    others.forEach((symbol) => targets.push({ view: symbol, name: `cpe-${symbol}` }));
    if (targets.length < 2) targets.push({ view: 'bot', name: 'cpe-bot' });
  } else {
    ranked.slice(0, 2).forEach((symbol) => targets.push({ view: symbol, name: `cpe-${symbol}` }));
  }

  const slotsLeft = Math.max(0, MAX_BROWSER_WINDOWS - 1);
  let opened = 0;
  let blocked = false;
  for (const target of targets) {
    if (opened >= slotsLeft) break;
    const result = openViewWindow(target.view, target.name);
    if (result.ok && !result.existing) opened += 1;
    if (result.reason === 'blocked') blocked = true;
  }
  updateOpenWindowsButton();
  if (!btn) return;
  if (blocked) {
    btn.textContent = 'Pop-ups blocked';
    setTimeout(() => updateOpenWindowsButton(), 2500);
  } else if (opened === 0) {
    btn.textContent = 'Windows already open';
    setTimeout(() => updateOpenWindowsButton(), 2500);
  }
}

function updateOpenWindowsButton() {
  const btn = document.getElementById('open-windows-btn');
  if (!btn) return;
  const count = readWindowRegistry().length;
  btn.textContent = count >= MAX_BROWSER_WINDOWS ? `Windows full (${count}/3)` : `Open other windows (${count}/3)`;
  btn.disabled = count >= MAX_BROWSER_WINDOWS && FOCUS_VIEW.mode !== 'hub';
}

function applyFocusModeLayout() {
  document.body.dataset.viewMode = FOCUS_VIEW.mode;
  if (FOCUS_VIEW.mode === 'asset') document.body.dataset.viewSymbol = FOCUS_VIEW.symbol;
  const note = document.getElementById('server-note');
  if (note && FOCUS_VIEW.mode !== 'hub') {
    note.textContent =
      FOCUS_VIEW.mode === 'bot'
        ? 'Bot window — trading still runs on the server if you close this.'
        : `${FOCUS_VIEW.symbol} window — predictions keep computing on the server.`;
  }
}

// ---------- settings persistence ----------

function loadPinnedAssets() {
  try {
    const raw = JSON.parse(localStorage.getItem(PINNED_ASSETS_KEY) || '[]');
    if (!Array.isArray(raw)) return [];
    const seen = new Set();
    const out = [];
    for (const item of raw) {
      const symbol = String(item || '').toUpperCase();
      if (!symbol || seen.has(symbol)) continue;
      seen.add(symbol);
      out.push(symbol);
      if (out.length >= 2) break;
    }
    return out;
  } catch {
    return [];
  }
}

function savePinnedAssets(symbols) {
  localStorage.setItem(PINNED_ASSETS_KEY, JSON.stringify((symbols || []).slice(0, 2)));
}

function togglePinnedAsset(symbol) {
  const key = String(symbol || '').toUpperCase();
  if (!key) return loadPinnedAssets();
  const cur = loadPinnedAssets();
  const idx = cur.indexOf(key);
  if (idx >= 0) cur.splice(idx, 1);
  else if (cur.length < 2) cur.push(key);
  else {
    cur.shift();
    cur.push(key);
  }
  savePinnedAssets(cur);
  return cur;
}

function pickFeaturedSymbols(ranked, pinned) {
  const pins = (pinned || []).filter((symbol) => ranked.includes(symbol));
  if (pins.length) {
    const extra = ranked.find((symbol) => !pins.includes(symbol));
    return [...pins, extra].filter(Boolean).slice(0, 2);
  }
  return (ranked || []).filter(Boolean).slice(0, 2);
}

function loadSettings() {
  let engineUrl = localStorage.getItem('engineUrl') || DEFAULTS.engineUrl;
  let refreshSeconds = parseInt(localStorage.getItem('refreshSeconds') || '', 10);
  if (!refreshSeconds || refreshSeconds < 5 || refreshSeconds > 10) refreshSeconds = DEFAULTS.refreshSeconds;
  return { engineUrl: engineUrl.replace(/\/+$/, ''), refreshSeconds };
}

function saveSettings(engineUrl, refreshSeconds) {
  localStorage.setItem('engineUrl', engineUrl.replace(/\/+$/, ''));
  localStorage.setItem('refreshSeconds', String(refreshSeconds));
}

async function submitManualStrike(symbol, rawPrice) {
  const { engineUrl } = loadSettings();
  const trimmed = String(rawPrice ?? '').trim();
  try {
    const res = await fetch(`${engineUrl}/api/strikes/manual`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        symbol,
        price: trimmed === '' ? null : trimmed,
      }),
    });
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.message || 'Could not save strike');
  } catch (err) {
    console.warn('[dashboard] manual strike failed:', err.message);
  }
}

// ---------- rendering ----------

function ensurePanels(symbols) {
  const grid = document.getElementById('main-grid');
  const panelTpl = document.getElementById('asset-panel-template');
  const windowTpl = document.getElementById('window-card-template');

  for (const symbol of symbols) {
    if (grid.querySelector(`.asset-panel[data-symbol="${symbol}"]`)) continue; // already built

    const panel = panelTpl.content.firstElementChild.cloneNode(true);
    panel.dataset.symbol = symbol;
    panel.hidden = true; // hub only reveals the two featured cryptos
    panel.querySelector('.asset-symbol').textContent = symbol;
    panel.querySelector('.asset-name').textContent = ASSET_LABELS[symbol] || symbol;

    const row = panel.querySelector('.windows-row');
    for (let i = 0; i < 3; i++) {
      const card = windowTpl.content.firstElementChild.cloneNode(true);
      row.appendChild(card);
    }

    // Wire up tab clicks. A manual click "locks" the selection so the
    // real-time phase auto-switching (see updateActivePhase) stops
    // overriding what the user chose to look at — the glow on the tab
    // itself keeps showing the real current phase either way.
    panel.querySelectorAll('.window-tab').forEach((tab) => {
      tab.addEventListener('click', () => {
        panel.dataset.userSelectedTab = 'true';
        selectTab(panel, tab.dataset.windowKey);
      });
    });
    // Default starting tab before any real data/phase info has arrived.
    selectTab(panel, 'w5');

    const form = panel.querySelector('.manual-strike-form');
    const input = panel.querySelector('.manual-strike-input');
    const clearBtn = panel.querySelector('.manual-strike-clear');
    if (form && input) {
      form.addEventListener('submit', (event) => {
        event.preventDefault();
        submitManualStrike(symbol, input.value);
      });
    }
    if (clearBtn) {
      clearBtn.addEventListener('click', () => submitManualStrike(symbol, ''));
    }

    grid.appendChild(panel);
  }
}

function assetOpportunityScore(asset) {
  if (!asset || !asset.ready || !asset.overall) return -1;
  const conviction = Math.abs(Number(asset.overall.probabilityUp) - 50);
  const confidence = Number(asset.overall.confidence) || 0;
  // Favor a decisive call that the model itself trusts, rather than merely
  // a high confidence score with no directional edge.
  return conviction * (confidence / 100);
}

function rankAssets(data, symbols) {
  return [...symbols].sort((a, b) => {
    const difference = assetOpportunityScore(data[b]) - assetOpportunityScore(data[a]);
    return difference || a.localeCompare(b);
  });
}

function renderAssetTabs(symbols, data) {
  const picker = document.getElementById('asset-picker');
  const grid = document.getElementById('main-grid');
  const ranked = rankAssets(data, symbols);
  latestRankedSymbols = ranked;

  // Focused companion windows show exactly one panel.
  if (FOCUS_VIEW.mode === 'bot') {
    picker.replaceChildren();
    picker.hidden = true;
    const hint = document.getElementById('asset-picker-hint');
    if (hint) hint.hidden = true;
    grid.querySelectorAll('.asset-panel[data-symbol]').forEach((panel) => {
      panel.hidden = true;
    });
    const botCard = document.getElementById('bot-dashboard-card');
    if (botCard) {
      botCard.hidden = false;
      grid.appendChild(botCard);
    }
    updateOpenWindowsButton();
    return;
  }

  if (FOCUS_VIEW.mode === 'asset') {
    picker.hidden = true;
    picker.replaceChildren();
    const hint = document.getElementById('asset-picker-hint');
    if (hint) hint.hidden = true;
    const focusSymbol = FOCUS_VIEW.symbol;
    grid.querySelectorAll('.asset-panel[data-symbol]').forEach((panel) => {
      panel.hidden = panel.dataset.symbol !== focusSymbol;
    });
    const botCard = document.getElementById('bot-dashboard-card');
    if (botCard) botCard.hidden = true;
    if (focusSymbol) {
      const panel = grid.querySelector(`.asset-panel[data-symbol="${focusSymbol}"]`);
      if (panel) grid.appendChild(panel);
    }
    updateOpenWindowsButton();
    return;
  }

  // Hub: at most two cryptos + the bot card. Pinned coins stay; otherwise best/2nd.
  picker.hidden = false;
  const hint = document.getElementById('asset-picker-hint');
  if (hint) hint.hidden = false;
  const pinned = loadPinnedAssets();
  const featured = pickFeaturedSymbols(ranked, pinned);

  picker.replaceChildren();
  ranked.forEach((symbol) => {
    const asset = data[symbol];
    const tab = document.createElement('button');
    tab.type = 'button';
    tab.className =
      'asset-tab' +
      (featured.includes(symbol) ? ' selected' : '') +
      (pinned.includes(symbol) ? ' pinned' : '');
    const rec =
      asset && asset.enginePaused
        ? 'Paused'
        : asset && asset.ready && asset.overall
          ? asset.overall.recommendation
          : 'Seeding';
    const pinMark = pinned.includes(symbol) ? '📌 ' : '';
    tab.textContent = `${pinMark}${symbol} · ${rec}`;
    tab.addEventListener('click', () => {
      togglePinnedAsset(symbol);
      renderAssetTabs(symbols, data);
    });
    picker.appendChild(tab);
  });

  grid.querySelectorAll('.asset-panel[data-symbol]').forEach((panel) => {
    panel.hidden = !featured.includes(panel.dataset.symbol);
  });
  featured.forEach((symbol) => {
    const panel = grid.querySelector(`.asset-panel[data-symbol="${symbol}"]`);
    if (panel) grid.appendChild(panel);
  });
  const botCard = document.getElementById('bot-dashboard-card');
  if (botCard) grid.appendChild(botCard);
  updateOpenWindowsButton();
}

// Shows the given window's card and marks its tab as selected, without
// touching the separate real-time-phase glow.
function selectTab(panel, windowKey) {
  panel.querySelectorAll('.window-tab').forEach((tab) => {
    tab.classList.toggle('selected', tab.dataset.windowKey === windowKey);
  });
  panel.querySelectorAll('.window-card').forEach((card) => {
    card.classList.toggle('tab-visible', card.dataset.windowKey === windowKey);
  });
}

function formatPrice(v, symbol) {
  if (v == null) return '—';
  // XRP: 4 decimals; Gold/Silver: 2 decimals with thousands; Oil: 2 decimals; everything else: 2.
  const decimals = symbol === 'XRP' ? 4 : 2;
  return v.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function renderAsset(symbol, assetData) {
  const panel = document.querySelector(`.asset-panel[data-symbol="${symbol}"]`);
  if (!panel || !assetData) return;

  const priceEl = panel.querySelector('.asset-price');
  const changeEl = panel.querySelector('.asset-price-change');
  const price = assetData.price;
  priceEl.textContent = price != null ? `$${formatPrice(price, symbol)}` : '—';

  const prev = lastPrices[symbol];
  if (prev != null && price != null) {
    const diff = price - prev;
    const pct = (diff / prev) * 100;
    changeEl.textContent = `${diff >= 0 ? '▲' : '▼'} ${Math.abs(pct).toFixed(3)}%`;
    changeEl.className = 'asset-price-change ' + (diff >= 0 ? 'up' : 'down');
  }
  if (price != null) lastPrices[symbol] = price;

  const overall = assetData.overall;
  const overallRec = panel.querySelector('.overall-rec');
  const overallProb = panel.querySelector('.overall-prob');
  if (overallRec && overall) {
    overallRec.textContent = overall.recommendation || '—';
    overallRec.className = 'overall-rec ' + (REC_CLASS[overall.recommendation] || 'wait');
  }
  if (overallProb && overall) {
    overallProb.textContent = `UP ${overall.probabilityUp}% · DOWN ${overall.probabilityDown}%`;
  }

  if (!assetData.ready) {
    const patternEl = panel.querySelector('.meta-pattern');
    if (patternEl) {
      patternEl.textContent = assetData.enginePaused
        ? assetData.message || 'Engine paused — not in AUTO'
        : 'Seeding history…';
    }
    return;
  }

  // One shared target price per asset — manual strike when set, otherwise
  // current Coinbase price (Kalshi is trade-only; no dashboard strike polls).
  const targetEl = panel.querySelector('.target-price');
  const sourceEl = panel.querySelector('.target-source');
  targetEl.textContent = assetData.targetPrice != null ? `$${formatPrice(assetData.targetPrice, symbol)}` : '—';
  sourceEl.textContent =
    assetData.targetSource === 'manual'
      ? 'Manual price to beat'
      : assetData.targetSource === 'kalshi'
        ? 'Live Kalshi strike'
        : 'Using current price (enter strike below) — Kalshi reserved for trading';
  const strikeInput = panel.querySelector('.manual-strike-input');
  if (strikeInput && document.activeElement !== strikeInput) {
    if (assetData.targetSource === 'manual' && assetData.targetPrice != null) {
      strikeInput.value = String(assetData.targetPrice);
    } else if (!strikeInput.value) {
      strikeInput.placeholder =
        assetData.targetPrice != null ? `Strike (now $${formatPrice(assetData.targetPrice, symbol)})` : 'Enter strike $';
    }
  }
  if (assetData.targetCloseTime) {
    panel.dataset.targetCloseTime = String(assetData.targetCloseTime);
    updateBigCountdown(panel);
  }

  const snap = assetData.indicatorsSnapshot;
  panel.querySelector('.meta-rsi').textContent = snap.rsi != null ? snap.rsi.toFixed(0) : '—';
  panel.querySelector('.meta-macd').textContent = snap.macdHistogram != null ? snap.macdHistogram.toFixed(3) : '—';
  panel.querySelector('.meta-vol').textContent = snap.volatilityPct != null ? `${snap.volatilityPct.toFixed(2)}%` : '—';
  panel.querySelector('.meta-flow').textContent =
    snap.orderBookImbalance != null ? `${(snap.orderBookImbalance * 100).toFixed(0)}%` : '—';
  panel.querySelector('.meta-pattern').textContent = snap.candlePattern || '—';

  const cards = panel.querySelectorAll('.window-card');
  const windowKeys = ['w5', 'w10', 'w15'];
  windowKeys.forEach((key, i) => {
    const w = assetData.windows[key];
    const card = cards[i];
    if (!w || !card) return;
    card.dataset.windowKey = key;

    card.querySelector('.window-label').textContent = w.window;
    const recEl = card.querySelector('.window-rec');
    recEl.textContent = w.recommendation;
    recEl.className = 'window-rec ' + (REC_CLASS[w.recommendation] || 'wait');

    card.querySelector('.prob-up').style.width = `${w.probabilityUp}%`;
    card.querySelector('.prob-down').style.width = `${w.probabilityDown}%`;
    card.querySelector('.prob-up-text').textContent = `UP ${w.probabilityUp}%`;
    card.querySelector('.prob-down-text').textContent = `DOWN ${w.probabilityDown}%`;

    if (w.signalScore) {
      const { upScore, downScore, trend } = w.signalScore;
      const total = upScore + downScore || 1;
      card.querySelector('.signal-up-fill').style.width = `${(upScore / total) * 100}%`;
      card.querySelector('.signal-down-fill').style.width = `${(downScore / total) * 100}%`;
      card.querySelector('.signal-up-value').textContent = `UP ${upScore.toFixed(1)}`;
      card.querySelector('.signal-down-value').textContent = `DOWN ${downScore.toFixed(1)}`;
      const badge = card.querySelector('.signal-trend-badge');
      badge.textContent = trend === 'strengthening' ? '↗ Strengthening' : trend === 'weakening' ? '↘ Weakening' : '→ Flat';
      badge.className = `signal-trend-badge ${trend}`;
    }

    card.querySelector('.confidence-value').textContent = `${w.confidence}%`;
    card.querySelector('.risk-value').textContent = `${w.riskAdjustmentPct}%`;
    card.querySelector('.window-explanation').textContent = w.explanation;

    // Live countdown to when this specific checkpoint settles (all three
    // windows share one baseline price, shown once at the top of the panel)
    if (w.tracking) {
      card.dataset.targetTime = String(w.tracking.targetTime);
      updateCountdownEl(card);
    }

    // Most recent settled result for this window, if any
    const resultBox = card.querySelector('.track-result');
    if (w.lastResult) {
      resultBox.classList.remove('hidden');
      const badge = resultBox.querySelector('.result-badge');
      const text = resultBox.querySelector('.result-text');
      badge.textContent = w.lastResult.correct ? 'CORRECT' : 'MISSED';
      badge.className = 'result-badge ' + (w.lastResult.correct ? 'win' : 'loss');
      const dir = w.lastResult.actualDirection;
      const pct = w.lastResult.changePct;
      text.textContent = `Last settled: went ${dir} ${Math.abs(pct).toFixed(3)}% (predicted ${w.lastResult.predictedDirection})`;
    } else {
      resultBox.classList.add('hidden');
    }

    // Rolling accuracy for this asset/window pair
    const accEl = card.querySelector('.accuracy-value');
    if (w.accuracy && w.accuracy.sampleSize > 0) {
      const today = `${w.accuracy.correctCount}/${w.accuracy.sampleSize} (${w.accuracy.accuracyPct}%)`;
      const prev = w.accuracy.previous && w.accuracy.previous.sampleSize
        ? ` · yesterday ${w.accuracy.previous.correctCount}/${w.accuracy.previous.sampleSize} (${w.accuracy.previous.accuracyPct}%)`
        : '';
      accEl.textContent = `today ${today}${prev}`;
    } else if (w.accuracy && w.accuracy.previous && w.accuracy.previous.sampleSize) {
      const p = w.accuracy.previous;
      accEl.textContent = `today 0 · yesterday ${p.correctCount}/${p.sampleSize} (${p.accuracyPct}%)`;
    } else {
      accEl.textContent = 'No settled predictions yet today';
    }
  });
}

function updateCountdownEl(card) {
  const el = card.querySelector('.countdown-value');
  const target = parseInt(card.dataset.targetTime || '0', 10);
  if (!target) {
    el.textContent = '—';
    return;
  }
  const remainingMs = target - Date.now();
  if (remainingMs <= 0) {
    el.textContent = 'Next window…';
    el.classList.add('settling');
    return;
  }
  el.classList.remove('settling');
  const totalSeconds = Math.round(remainingMs / 1000);
  const mm = Math.floor(totalSeconds / 60);
  const ss = totalSeconds % 60;
  el.textContent = `${mm}:${String(ss).padStart(2, '0')}`;
}

function tickAllCountdowns() {
  document.querySelectorAll('.window-card').forEach(updateCountdownEl);
  document.querySelectorAll('.asset-panel').forEach((panel) => {
    updateBigCountdown(panel);
    updateActivePhase(panel);
  });
  updateBotRuntimeDisplays();
}

function updateBigCountdown(panel) {
  const el = panel.querySelector('.big-countdown');
  if (!el) return;
  const target = parseInt(panel.dataset.targetCloseTime || '0', 10);
  if (!target) {
    el.textContent = '—';
    return;
  }
  const remainingMs = target - Date.now();
  if (remainingMs <= 0) {
    // Gap between Kalshi windows (or a stale close time). Do not sit on
    // "Settling…" forever — the next poll should pick up a fresh market.
    el.textContent = 'Next window…';
    el.classList.add('settling');
    return;
  }
  el.classList.remove('settling');
  const totalSeconds = Math.round(remainingMs / 1000);
  const mm = Math.floor(totalSeconds / 60);
  const ss = totalSeconds % 60;
  el.textContent = `${mm}:${String(ss).padStart(2, '0')}`;
}

// Highlights whichever window (0-5 / 5-10 / 10-15 min) matches where we
// actually are right now in the real Kalshi 15-minute window, based on the
// same close time driving the big countdown at the top of the panel. Also
// auto-switches which tab is visible to follow the real phase, UNLESS the
// user has manually picked a tab of their own — the glow itself, though,
// always shows the real phase regardless of manual selection.
function updateActivePhase(panel) {
  const target = parseInt(panel.dataset.targetCloseTime || '0', 10);
  const tabs = panel.querySelectorAll('.window-tab');
  if (!target) {
    tabs.forEach((t) => t.classList.remove('active-phase'));
    return;
  }
  const secondsRemaining = Math.max(0, Math.round((target - Date.now()) / 1000));
  let activeKey;
  if (secondsRemaining > 600) activeKey = 'w5'; // more than 10 min left -> still in the first 5 minutes
  else if (secondsRemaining > 300) activeKey = 'w10'; // 5-10 min left -> in the middle stretch
  else activeKey = 'w15'; // 5 min or less left -> final stretch

  tabs.forEach((tab) => {
    tab.classList.toggle('active-phase', tab.dataset.windowKey === activeKey);
  });

  if (panel.dataset.userSelectedTab !== 'true') {
    selectTab(panel, activeKey);
  }
}

function setStatus(state, text) {
  const dot = document.getElementById('status-dot');
  const label = document.getElementById('status-text');
  dot.className = 'status-dot ' + (state === 'live' ? 'live' : state === 'down' ? 'down' : '');
  label.textContent = text;
}

function setAppVersion(version) {
  if (!version) return;
  const text = `v${String(version).replace(/^v/i, '')}`;
  document.querySelectorAll('#app-version, [data-app-version], .app-version').forEach((el) => {
    el.textContent = text;
  });
}

function renderUpdatedTime() {
  const el = document.getElementById('updated-text');
  const now = new Date();
  el.textContent = `Updated ${now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`;
}

// ---------- polling ----------

async function fetchLatest() {
  const { engineUrl } = loadSettings();
  try {
    const res = await fetch(`${engineUrl}/api/latest`, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    const assetSymbols = Object.keys(data).filter((k) => !NON_ASSET_KEYS.has(k));

    if (data.message && assetSymbols.length === 0) {
      setStatus('wait', data.message);
      return;
    }

    ensurePanels(assetSymbols);
    for (const symbol of assetSymbols) {
      renderAsset(symbol, data[symbol]);
    }
    renderAssetTabs(assetSymbols, data);
    renderCommodityLeanBar(data);
    checkCommoAlarms(data);
    refreshBotStatus();
    renderUpdatedTime();
    setStatus('live', 'Live');
  } catch (err) {
    setStatus('down', 'Connection lost — retrying…');
    console.error('[dashboard] fetch failed:', err.message);
  }
}

// ── Lean bar bot overlay ─────────────────────────────────────────────────────
let _latestBotStatus = null;
let _lastOpenTradeIds = new Set();

// Flash the lean bar briefly when a new trade opens
function checkTradeFlash(botData) {
  if (!botData || !Array.isArray(botData.openTrades)) return;
  const currentIds = new Set(botData.openTrades.map((t) => t.id));
  const newTrades = botData.openTrades.filter((t) => !_lastOpenTradeIds.has(t.id));
  _lastOpenTradeIds = currentIds;
  if (newTrades.length === 0) return;
  const bar = document.getElementById('lean-bar');
  if (!bar) return;
  const trade = newTrades[0];
  const sym = trade.symbol || '';
  const side = String(trade.side || '').toUpperCase();
  const price = trade.entryPriceCents != null ? `${trade.entryPriceCents}¢` : '';
  bar.style.transition = 'background 0.1s';
  bar.style.background = side === 'YES' ? '#052e16' : '#2d0a0a';
  const flash = document.createElement('div');
  flash.style.cssText = `position:absolute;left:0;right:0;top:0;bottom:0;display:flex;align-items:center;justify-content:center;background:${side === 'YES' ? '#16a34a' : '#dc2626'};color:#fff;font-size:13px;font-weight:700;z-index:10;pointer-events:none;`;
  flash.textContent = `🤖 BOT OPENED ${sym} ${side} @ ${price}`;
  bar.style.position = 'fixed';
  bar.appendChild(flash);
  setTimeout(() => {
    flash.remove();
    bar.style.background = '#0d1117';
  }, 3000);
}

// Session P&L + open positions summary for the bar footer
function renderLeanBarBotOverlay(botData) {
  checkTradeFlash(botData);
  const el = document.getElementById('lean-bar-pnl');
  if (!el || !botData) return;
  const netCents = botData.stats && botData.stats.netPnlCents != null ? botData.stats.netPnlCents : null;
  const opens = Array.isArray(botData.openTrades) ? botData.openTrades : [];
  let html = '';
  if (netCents != null) {
    const dollars = (netCents / 100).toFixed(2);
    const pos = netCents >= 0;
    html += `<span style="color:${pos ? '#22c55e' : '#ef4444'};font-weight:700;">P&L ${pos ? '+' : ''}$${dollars}</span>`;
  }
  if (opens.length > 0) {
    const parts = opens.map((t) => {
      const side = String(t.side || '').toUpperCase();
      return `<span style="color:${side === 'YES' ? '#22c55e' : '#f97316'};">${t.symbol} ${side}</span>`;
    });
    html += (html ? ' · ' : '') + parts.join(' · ');
  }
  el.innerHTML = html || '';
}

// Kalshi series → URL path mapping
const KALSHI_SERIES_PATHS = {
  BTC: 'kxbtc15m/bitcoin-15minute',
  ETH: 'kxeth15m/ethereum-15minute',
  SOL: 'kxsol15m/solana-15minute',
  XRP: 'kxxrp15m/xrp-15minute',
  DOGE: 'kxdoge15m/dogecoin-15minute',
  BNB: 'kxbnb15m/bnb-15minute',
  NEAR: 'kxnear15m/near-15minute',
  HYPE: 'kxhype15m/hype-15minute',
  GOLD: 'kxgold15m/gold-15minute',
  SILVER: 'kxsilver15m/silver-15minute',
  OIL: 'kxwti15m/crude-oil-wti-15minute',
  NATGAS: 'kxnatgas15m/natural-gas-15minute',
  COPPER: 'kxcopper15m/copper-15minute',
};

// Commodity lean alarm — beeps when any window hits ≥75% lean either side.
// Cooldown per symbol prevents repeat beeps on the same signal.
const _commoAlarmLastFired = {};
const COMMO_ALARM_COOLDOWN_MS = 60_000; // 1 minute between beeps per symbol

function playCommoAlarm(strong) {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = 'sine';
    osc.frequency.setValueAtTime(strong ? 880 : 660, ctx.currentTime);
    osc.frequency.setValueAtTime(strong ? 1100 : 880, ctx.currentTime + 0.12);
    gain.gain.setValueAtTime(0.18, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.35);
    osc.onended = () => ctx.close();
  } catch (_) {}
}

function checkCommoAlarms(data) {
  const now = Date.now();
  for (const { sym } of ALL_LEAN_SYMS) {
    const d = data && data[sym];
    if (!d || !d.ready || !d.windows) continue;
    const lastFired = _commoAlarmLastFired[sym] || 0;
    if (now - lastFired < COMMO_ALARM_COOLDOWN_MS) continue;

    const windows = ['w5', 'w10', 'w15'].map((k) => d.windows[k]).filter(Boolean);

    // Must hit ≥80% lean (raised from 75)
    const leans = windows.map((w) => {
      const up = Number(w.probabilityUp);
      return up >= 50 ? up : 100 - up;
    });
    const maxLean = Math.max(...leans, 0);
    if (maxLean < 80) continue;

    // Check if all 3 windows agree on same side
    const dirs = windows.map((w) => Number(w.probabilityUp) >= 50 ? 'YES' : 'NO');
    const allAgree = dirs.length === 3 && dirs.every((v) => v === dirs[0]);

    // Check if session is at least halfway through (7.5 min of 15 elapsed)
    const closeTime = d.targetCloseTime ? Number(d.targetCloseTime) : null;
    const SESSION_MS = 15 * 60 * 1000;
    const halfwayMs = SESSION_MS / 2; // 7.5 min
    const msRemaining = closeTime ? closeTime - now : null;
    const sessionHalfDone = msRemaining != null && msRemaining <= halfwayMs;

    // Fire if: session is halfway done OR all 3 windows agree same side
    // and every window is within the 78–82% band (right around 80%) + avg conf ≥80%
    if (!sessionHalfDone) {
      if (!allAgree) continue;
      // All 3 must individually be ≥78% lean
      const allNear80 = leans.every((l) => l >= 78);
      if (!allNear80) continue;
      const avgConf = windows.reduce((s, w) => s + Number(w.confidence || 0), 0) / windows.length;
      if (avgConf < 80) continue;
    }

    _commoAlarmLastFired[sym] = now;
    playCommoAlarm(maxLean >= 88);
    break; // one beep per cycle max
  }
}

let _leanBarTab = 'commo';

function leanBarSetTab(tab) {
  _leanBarTab = tab;
  const commoRow = document.getElementById('lean-bar-commo');
  const cryptoRow = document.getElementById('lean-bar-crypto');
  const commoBtn = document.getElementById('lean-tab-commo');
  const cryptoBtn = document.getElementById('lean-tab-crypto');
  if (commoRow) commoRow.style.display = tab === 'commo' ? 'flex' : 'none';
  if (cryptoRow) cryptoRow.style.display = tab === 'crypto' ? 'flex' : 'none';
  if (commoBtn) { commoBtn.style.background = tab === 'commo' ? '#10b981' : 'transparent'; commoBtn.style.color = tab === 'commo' ? '#fff' : '#57606a'; }
  if (cryptoBtn) { cryptoBtn.style.background = tab === 'crypto' ? '#3b82f6' : 'transparent'; cryptoBtn.style.color = tab === 'crypto' ? '#fff' : '#57606a'; }
}

const COMMO_SYMS = [
  { sym: 'GOLD',   id: 'commo-lean-gold' },
  { sym: 'SILVER', id: 'commo-lean-silver' },
  { sym: 'OIL',    id: 'commo-lean-oil' },
  { sym: 'NATGAS', id: 'commo-lean-natgas' },
  { sym: 'COPPER', id: 'commo-lean-copper' },
];

const CRYPTO_SYMS = [
  { sym: 'BTC',  id: 'commo-lean-btc' },
  { sym: 'ETH',  id: 'commo-lean-eth' },
  { sym: 'SOL',  id: 'commo-lean-sol' },
  { sym: 'XRP',  id: 'commo-lean-xrp' },
  { sym: 'DOGE', id: 'commo-lean-doge' },
  { sym: 'BNB',  id: 'commo-lean-bnb' },
  { sym: 'NEAR', id: 'commo-lean-near' },
  { sym: 'HYPE', id: 'commo-lean-hype' },
];

const ALL_LEAN_SYMS = [...COMMO_SYMS, ...CRYPTO_SYMS];

function windowLeanHtml(w) {
  if (!w) return `<span style="color:#57606a;">—</span>`;
  const up = Number(w.probabilityUp);
  const down = Number(w.probabilityDown);
  const dominant = up >= down ? 'YES' : 'NO';
  const pct = up >= down ? up : down;
  const strong = pct >= 80;
  const moderate = pct >= 65;
  const color = dominant === 'YES'
    ? (strong ? '#22c55e' : moderate ? '#86efac' : '#6b7280')
    : (strong ? '#ef4444' : moderate ? '#fca5a5' : '#6b7280');
  return `<span style="color:${color};font-weight:${strong ? '700' : '500'};">${dominant} ${pct.toFixed(0)}%</span>`;
}

function renderCommodityLeanBar(data) {
  // Render each group and sort by avg confidence (highest first, not-ready last)
  for (const group of [COMMO_SYMS, CRYPTO_SYMS]) {
    const scored = group.map(({ sym, id }) => {
      const d = data && data[sym];
      const confs = d && d.ready && d.windows
        ? ['w5','w10','w15'].map((k) => Number(d.windows[k] && d.windows[k].confidence)).filter(Number.isFinite)
        : [];
      const avgConf = confs.length ? confs.reduce((a, b) => a + b, 0) / confs.length : -1;
      return { sym, id, avgConf };
    });
    scored.sort((a, b) => b.avgConf - a.avgConf);
    // Reorder cells in DOM
    const firstCell = document.getElementById(scored[0].id);
    const parent = firstCell && firstCell.parentElement;
    if (parent) {
      for (const { id } of scored) {
        const el = document.getElementById(id);
        if (el) parent.appendChild(el);
      }
    }
  }

  for (const { sym, id } of ALL_LEAN_SYMS) {
    const cell = document.getElementById(id);
    if (!cell) continue;
    const d = data && data[sym];
    if (!d || !d.ready || !d.windows) {
      cell.innerHTML = `<span style="color:#57606a;font-size:11px;font-weight:600;">${sym}</span><span style="color:#57606a;font-size:10px;">seeding…</span>`;
      cell.style.background = '';
      cell.onclick = null;
      continue;
    }
    const w5 = d.windows.w5;
    const w10 = d.windows.w10;
    const w15 = d.windows.w15;

    // Stale window check — if close_time has passed, lean is from previous session
    const closeTime = d.targetCloseTime ? Number(d.targetCloseTime) : null;
    const isStale = closeTime && Date.now() > closeTime;

    // All 3 windows agree?
    const dirs = [w5, w10, w15].filter(Boolean).map((w) => Number(w.probabilityUp) >= 50 ? 'YES' : 'NO');
    const allAgree = dirs.length === 3 && dirs.every((v) => v === dirs[0]);
    const agreeDir = allAgree ? dirs[0] : null;

    // Background + confidence from w5
    const up5 = w5 ? Number(w5.probabilityUp) : 50;
    const dominant5 = up5 >= 50 ? 'YES' : 'NO';
    const pct5 = up5 >= 50 ? up5 : 100 - up5;
    const strong5 = pct5 >= 80;
    const moderate5 = pct5 >= 65;
    cell.style.background = dominant5 === 'YES'
      ? (strong5 ? '#052e16' : moderate5 ? '#071f14' : '')
      : (strong5 ? '#2d0a0a' : moderate5 ? '#1a0a0a' : '');

    // Confidence (average across windows)
    const confs = [w5, w10, w15].filter(Boolean).map((w) => Number(w.confidence)).filter(Number.isFinite);
    const avgConf = confs.length ? Math.round(confs.reduce((a, b) => a + b, 0) / confs.length) : null;

    // Price vs strike
    const price = d.price != null ? d.price : null;
    const strike = d.targetPrice != null ? d.targetPrice : null;
    let priceHtml = '';
    if (price != null && strike != null) {
      const above = price >= strike;
      priceHtml = `<span style="color:#57606a;font-size:9px;">${above ? '▲' : '▼'}strike</span>`;
    }

    // Kalshi link — use kalshiTicker if available, else series path
    const ticker = d.kalshiTicker || null;
    const seriesPath = KALSHI_SERIES_PATHS[sym];
    const kalshiUrl = ticker
      ? `https://kalshi.com/markets/${seriesPath}/${ticker.toLowerCase()}`
      : seriesPath
        ? `https://kalshi.com/markets/${seriesPath}`
        : null;
    if (kalshiUrl) {
      cell.style.cursor = 'pointer';
      cell.onclick = () => window.open(kalshiUrl, '_blank');
    } else {
      cell.style.cursor = 'default';
      cell.onclick = null;
    }

    // Agree dot
    const agreeDot = allAgree
      ? `<span style="color:${agreeDir === 'YES' ? '#22c55e' : '#ef4444'};font-size:13px;line-height:1;" title="All 3 windows agree">●</span>`
      : `<span style="color:#30363d;font-size:13px;line-height:1;" title="Windows disagree">○</span>`;

    // ── GO / WAIT / NO signal ──────────────────────────────────────────────
    let goSignal = 'WAIT';
    let goColor = '#d97706';
    let goTitle = '';

    if (!isStale) {
      // Timing: block first 3 min and last 2 min
      const SESSION_MS = 15 * 60 * 1000;
      const ct = d.targetCloseTime ? Number(d.targetCloseTime) : null;
      const msLeft = ct ? ct - Date.now() : null;
      const tooEarly = msLeft != null && msLeft > SESSION_MS - 3 * 60 * 1000; // >12 min left
      const tooLate  = msLeft != null && msLeft < 2 * 60 * 1000;              // <2 min left

      // Signal trends — count weakening windows
      const trends = [w5, w10, w15].filter(Boolean).map((w) => w.signalScore && w.signalScore.trend);
      const weakeningCount = trends.filter((t) => t === 'weakening').length;
      const strengtheningCount = trends.filter((t) => t === 'strengthening').length;

      // All leans ≥78%
      const allLeanOk = leans.every((l) => l >= 78);
      // Conf ok
      const confOk = avgConf != null && avgConf >= 70;

      if (tooEarly) {
        goSignal = 'EARLY'; goColor = '#57606a';
        goTitle = 'Too early — wait until 12 min or less remain';
      } else if (tooLate) {
        goSignal = 'LATE'; goColor = '#57606a';
        goTitle = 'Too late — less than 2 min left';
      } else if (weakeningCount >= 2) {
        goSignal = 'NO'; goColor = '#ef4444';
        goTitle = `${weakeningCount}/3 windows weakening — lean fading`;
      } else if (!allAgree) {
        goSignal = 'WAIT'; goColor = '#d97706';
        goTitle = 'Windows disagree on direction';
      } else if (!allLeanOk) {
        goSignal = 'WAIT'; goColor = '#d97706';
        goTitle = 'Lean not strong enough on all windows (need ≥78%)';
      } else if (!confOk) {
        goSignal = 'WAIT'; goColor = '#d97706';
        goTitle = `Confidence too low (${avgConf}%, need ≥70%)`;
      } else if (weakeningCount === 1 && strengtheningCount === 0) {
        goSignal = 'WAIT'; goColor = '#d97706';
        goTitle = '1 window weakening — borderline, be cautious';
      } else {
        goSignal = 'GO'; goColor = '#22c55e';
        goTitle = `All systems OK — ${agreeDir} entry looks good`;
      }
    }

    const goHtml = isStale ? '' : `<span style="color:${goColor};font-size:10px;font-weight:800;letter-spacing:0.5px;" title="${goTitle}">${goSignal}</span>`;

    cell.innerHTML = `
      <div style="display:flex;align-items:center;gap:3px;">
        ${agreeDot}
        <span style="color:${isStale ? '#57606a' : '#c9d1d9'};font-size:11px;font-weight:700;">${sym}</span>
        ${isStale ? `<span style="color:#f97316;font-size:9px;" title="Window closed — awaiting new market">⏳</span>` : ''}
        ${!isStale && avgConf != null ? `<span style="color:#57606a;font-size:9px;">c${avgConf}%</span>` : ''}
        ${!isStale ? priceHtml : ''}
        ${goHtml}
      </div>
      <div style="display:flex;gap:3px;align-items:center;font-size:10px;">
        <span style="color:#57606a;">5m</span>${windowLeanHtml(w5)}
        <span style="color:#30363d;">│</span>
        <span style="color:#57606a;">10m</span>${windowLeanHtml(w10)}
        <span style="color:#30363d;">│</span>
        <span style="color:#57606a;">15m</span>${windowLeanHtml(w15)}
      </div>
    `;
  }
}

function startPolling() {
  if (pollTimer) clearInterval(pollTimer);
  const { refreshSeconds } = loadSettings();
  fetchLatest();
  pollTimer = setInterval(fetchLatest, refreshSeconds * 1000);
}

// ---------- settings overlay ----------

function openSettings() {
  const { engineUrl, refreshSeconds } = loadSettings();
  document.getElementById('engine-url').value = engineUrl;
  document.getElementById('refresh-interval').value = refreshSeconds;
  document.getElementById('settings-overlay').classList.remove('hidden');
}

function closeSettings() {
  document.getElementById('settings-overlay').classList.add('hidden');
}

function wireSettingsUI() {
  document.getElementById('settings-btn').addEventListener('click', openSettings);
  document.getElementById('settings-cancel').addEventListener('click', closeSettings);
  document.getElementById('settings-save').addEventListener('click', () => {
    const url = document.getElementById('engine-url').value.trim() || DEFAULTS.engineUrl;
    let refresh = parseInt(document.getElementById('refresh-interval').value, 10);
    if (!refresh || refresh < 5) refresh = 5;
    if (refresh > 10) refresh = 10;
    saveSettings(url, refresh);
    closeSettings();
    startPolling();
  });
}

// ---------- bot overlay: live status, editable settings, backtest ----------

async function loadCalibration() {
  const { engineUrl } = loadSettings();
  const container = document.getElementById('calibration-table');
  try {
    const res = await fetch(`${engineUrl}/api/bot/calibration`, { cache: 'no-store' });
    if (!res.ok) {
      container.innerHTML = '<p class="settings-hint">Bot not enabled — no calibration data yet.</p>';
      return;
    }
    const data = await res.json();
    if (!data.buckets || data.buckets.length === 0) {
      container.innerHTML = '<p class="settings-hint">No settled trades yet — this fills in as the bot trades over time.</p>';
      return;
    }
    const qualityLabel = { too_few: 'Too few to trust yet', minimal: 'Minimal — starting to mean something', good: 'Good sample size', best: 'Strong sample size' };
    const rows = data.buckets
      .map(
        (b) => `
      <div class="calibration-row quality-${b.sampleQuality}">
        <span class="cal-range">${b.range}</span>
        <span class="cal-trades">${b.trades} trades</span>
        <span class="cal-wins">${b.wins} wins</span>
        <span class="cal-rate">${b.winRatePct != null ? b.winRatePct + '%' : '—'}</span>
        <span class="cal-quality">${qualityLabel[b.sampleQuality]}</span>
      </div>`
      )
      .join('');
    container.innerHTML = `
      <div class="calibration-row calibration-header">
        <span class="cal-range">Probability</span>
        <span class="cal-trades">Trades</span>
        <span class="cal-wins">Wins</span>
        <span class="cal-rate">Win rate</span>
        <span class="cal-quality">Sample</span>
      </div>
      ${rows}`;
  } catch (err) {
    container.innerHTML = `<p class="settings-hint">Could not load calibration data: ${err.message}</p>`;
  }
}

function openBotOverlay() {
  document.getElementById('bot-overlay').classList.remove('hidden');
  refreshBotStatus();
  loadBotConfigIntoForm();
  loadKalshiCredentialsStatus();
  loadCalibration();
}

function closeBotOverlay() {
  document.getElementById('bot-overlay').classList.add('hidden');
}

const EXIT_SOUND_ENABLED_KEY = 'botExitSoundEnabled';
const EXIT_SOUND_SEEN_KEY = 'botExitSoundSeenCloses';
const seenExitCloseKeys = new Set();
let exitSoundInitialized = false;
let exitAudioCtx = null;

function isExitSoundEnabled() {
  const raw = localStorage.getItem(EXIT_SOUND_ENABLED_KEY);
  if (raw === null) return false;
  return raw === '1' || raw === 'true';
}

function setExitSoundEnabled(on) {
  localStorage.setItem(EXIT_SOUND_ENABLED_KEY, on ? '1' : '0');
  const checkbox = document.getElementById('bot-exit-sound');
  if (checkbox) checkbox.checked = !!on;
}

function loadExitSoundSeenKeys() {
  try {
    const raw = localStorage.getItem(EXIT_SOUND_SEEN_KEY);
    if (!raw) return;
    JSON.parse(raw).forEach((key) => seenExitCloseKeys.add(String(key)));
  } catch (_) {
    /* ignore */
  }
}

function saveExitSoundSeenKeys() {
  const keys = Array.from(seenExitCloseKeys).slice(-100);
  localStorage.setItem(EXIT_SOUND_SEEN_KEY, JSON.stringify(keys));
}

function resetExitSoundSeenCloses() {
  seenExitCloseKeys.clear();
  exitSoundInitialized = false;
  localStorage.removeItem(EXIT_SOUND_SEEN_KEY);
}

function tradeCloseKey(trade) {
  if (trade && trade.id) return String(trade.id);
  return `${trade?.symbol || 'x'}-${trade?.closedAt || ''}-${trade?.exitReason || ''}`;
}

function exitSoundKind(trade) {
  const reason = String(trade?.exitReason || '').toLowerCase();
  if (reason === 'breakeven') return 'flat';
  const pnl = Number(trade?.pnlCents);
  if (Number.isFinite(pnl)) {
    if (pnl > 0) return 'win';
    if (pnl < 0) return 'loss';
  }
  if (reason === 'take_profit' || reason === 'near_certain') return 'win';
  if (reason === 'stop_loss' || reason === 'model_against' || reason === 'model_stagnation' || reason === 'model_rapid_adverse') return 'loss';
  return 'flat';
}

async function ensureExitAudioReady() {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return false;
    if (!exitAudioCtx) exitAudioCtx = new AudioCtx();
    if (exitAudioCtx.state === 'suspended') await exitAudioCtx.resume();
    return exitAudioCtx.state === 'running';
  } catch (_) {
    return false;
  }
}

function playExitChime(kind) {
  if (!exitAudioCtx || exitAudioCtx.state !== 'running') return;
  const ctx = exitAudioCtx;
  const now = ctx.currentTime;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sine';
  osc.connect(gain);
  gain.connect(ctx.destination);

  if (kind === 'win') {
    osc.frequency.setValueAtTime(880, now);
    osc.frequency.linearRampToValueAtTime(1174, now + 0.09);
  } else if (kind === 'loss') {
    osc.frequency.setValueAtTime(440, now);
    osc.frequency.linearRampToValueAtTime(330, now + 0.12);
  } else {
    osc.frequency.setValueAtTime(660, now);
  }

  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.12, now + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.18);
  osc.start(now);
  osc.stop(now + 0.2);
}

function processExitSounds(tradeLog) {
  if (!isExitSoundEnabled()) return;
  const trades = Array.isArray(tradeLog) ? tradeLog : [];
  const closed = trades.filter((t) => t && t.status === 'closed' && t.closedAt);

  if (!exitSoundInitialized) {
    closed.forEach((t) => seenExitCloseKeys.add(tradeCloseKey(t)));
    exitSoundInitialized = true;
    saveExitSoundSeenKeys();
    return;
  }

  const fresh = [];
  for (const trade of closed) {
    const key = tradeCloseKey(trade);
    if (seenExitCloseKeys.has(key)) continue;
    seenExitCloseKeys.add(key);
    fresh.push(trade);
  }
  if (!fresh.length) return;

  saveExitSoundSeenKeys();
  fresh.sort((a, b) => Number(b.closedAt) - Number(a.closedAt));
  ensureExitAudioReady().then((ready) => {
    if (!ready) return;
    playExitChime(exitSoundKind(fresh[0]));
  });
}

function initExitSoundUi() {
  loadExitSoundSeenKeys();
  const checkbox = document.getElementById('bot-exit-sound');
  if (!checkbox) return;
  checkbox.checked = isExitSoundEnabled();
  checkbox.addEventListener('change', async () => {
    const on = checkbox.checked;
    setExitSoundEnabled(on);
    if (on) {
      const ready = await ensureExitAudioReady();
      if (ready) playExitChime('win');
    }
  });
}

let _lastSeenAppVersion = null;

async function refreshBotStatus() {
  const { engineUrl } = loadSettings();
  const modeLine = document.getElementById('bot-mode-line');
  const persistLine = document.getElementById('bot-persist-line');
  const body = document.getElementById('bot-status-body');
  try {
    let _candleCounts = null;
    const healthRes = await fetch(`${engineUrl}/api/health`, { cache: 'no-store' });
    if (healthRes.ok) {
      const health = await healthRes.json();
      setAppVersion(health.version);
      // Auto-reload when the server deploys a new version — no more Ctrl+F5.
      if (_lastSeenAppVersion && health.version && health.version !== _lastSeenAppVersion) {
        window.location.reload();
        return;
      }
      if (health.version) _lastSeenAppVersion = health.version;
      if (health.candleCounts) _candleCounts = health.candleCounts;
      if (persistLine) {
        if (health.dataDirEphemeral) {
          persistLine.hidden = false;
          persistLine.style.color = 'var(--wait)';
          persistLine.textContent =
            'Warning: Render disk is ephemeral — Save works until the next restart, then settings reset. Attach a Persistent Disk at /var/data.';
        } else {
          persistLine.hidden = false;
          persistLine.style.color = 'var(--up)';
          persistLine.textContent = health.configFileExists
            ? `Settings persist on disk (${health.dataDir}).`
            : `Durable data dir ready (${health.dataDir}) — save settings once to create the config file.`;
        }
      }
    }

    const res = await fetch(`${engineUrl}/api/bot/status`, { cache: 'no-store' });
    const data = await res.json();
    setAppVersion(data.version);
    processExitSounds(data.tradeLog);
    if (!data.enabled) {
      modeLine.textContent = data.message || 'Bot is not enabled on the engine.';
      body.innerHTML = '';
      renderBotDashboard(data);
      return;
    }
    const mode = data.config.mode;
    modeLine.textContent = `Mode: ${mode === 'live' ? 'LIVE (real orders)' : 'Paper (simulated)'} · ${strategyModeLabel(data.config.strategyMode)} · Trading ${data.config.symbol}`;
    updateModeButtons(mode, data.config.liveAuthorized);

    const chips = [];
    chips.push(chip('Lifetime trades', data.tradeLogTotal != null ? data.tradeLogTotal : '—'));
    chips.push(chip('Trades opened', data.stats.totalAttempts));
    chips.push(chip('Settled', data.stats.totalTrades));
    chips.push(chip('Profitable exits', data.stats.profitableExits));
    chips.push(chip('Win rate', data.stats.winRatePct != null ? `${data.stats.winRatePct}%` : '—'));
    chips.push(chip('Current streak', `${data.stats.currentWinStreak} win${data.stats.currentWinStreak === 1 ? '' : 's'}`));
    chips.push(chip('Best streak', `${data.stats.longestWinStreak} win${data.stats.longestWinStreak === 1 ? '' : 's'}`));
    if (Number(data.overdueOpenCount) > 0) {
      chips.push(chip('Overdue (force-settling)', data.overdueOpenCount));
    }
    const capital = data.capital;
    if (capital && data.config.mode === 'live') {
      chips.push(chip('Kalshi available', capital.liveAvailableCents == null ? 'Checking…' : `$${(capital.liveAvailableCents / 100).toFixed(2)}`));
    }
    if (data.lastDecision) chips.push(chip('Decision', data.lastDecision));
    if (data.lastError) chips.push(chip('Last error', data.lastError));
    // Show/hide the daily loss reset button based on halt state.
    const resetRow = document.getElementById('daily-loss-reset-row');
    if (resetRow) resetRow.style.display = data.dailyLossHalted ? '' : 'none';
    renderSettleWindowRec(data.settleWindowRec);
    const activityScroll = captureLogScroll('bot-activity-log-list', 'bottom');
    const tradeScroll = captureLogScroll('bot-trade-log-list', 'top');
    body.innerHTML = [
      buildCapitalLedgerHtml(capital, { depositControls: true }),
      buildHourlyPnlHtml(data.hourlyPnl || (data.stats && data.stats.hourlyPnl)),
      buildOpenPositionsHtml(data.openTrades),
      `<div class="bot-stat-chips">${chips.join('')}</div>`,
      buildTradeLogHtml(data.tradeLog, data.tradeLogTotal),
      buildActivityLogHtml(data.activityLog, data.recentTrades),
    ].join('');
    restoreLogScroll('bot-activity-log-list', activityScroll, 'bottom');
    restoreLogScroll('bot-trade-log-list', tradeScroll, 'top');
    bindActivityLogUi();
    bindTradeLogUi();
    renderModelSetups(data.modelSetups, data.modelShadowBooks);
    renderActiveSetupBanner(data.modelSetups, data.config);
    renderBacktestActiveConfig(data.config, _candleCounts);
    renderAssetStats(data.assetStats, data.config);
    renderModelAutoSwitchNote(data.modelAutoSwitch);
    renderBotPerfGrid(data.assetStats);
    renderBotDashboard(data);
    // Cache for lean bar
    _latestBotStatus = data;
    renderLeanBarBotOverlay(data);
  } catch (err) {
    modeLine.textContent = 'Could not reach the engine to check bot status.';
    body.innerHTML = '';
  }
}

function formatBotRuntime(runningSince) {
  if (!runningSince) return 'Stopped';
  const seconds = Math.max(0, Math.floor((Date.now() - runningSince) / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  return `${hours}h ${String(minutes).padStart(2, '0')}m ${String(secs).padStart(2, '0')}s`;
}

let lastBotRunningSince = null;
let lastBotIsRunning = false;

function updateBotRuntimeDisplays() {
  const runtimeText = lastBotIsRunning ? formatBotRuntime(lastBotRunningSince) : 'Stopped';
  const runtimeEl = document.getElementById('bot-runtime-value');
  if (runtimeEl) {
    runtimeEl.textContent = lastBotIsRunning ? `Running ${runtimeText}` : 'Stopped';
    runtimeEl.classList.toggle('is-running', lastBotIsRunning);
    runtimeEl.classList.toggle('is-stopped', !lastBotIsRunning);
  }
  const banner = document.getElementById('bot-runtime-banner');
  if (banner) {
    banner.hidden = false;
    banner.classList.toggle('is-running', lastBotIsRunning);
  }
  const timer = document.getElementById('bot-running-timer');
  if (timer) timer.textContent = lastBotIsRunning ? `Running ${runtimeText}` : 'Stopped';
}

function renderBotDashboard(data) {
  const card = document.getElementById('bot-dashboard-card');
  if (!card) return;
  if (FOCUS_VIEW.mode === 'asset') {
    card.hidden = true;
    return;
  }
  if (FOCUS_VIEW.mode === 'bot') {
    card.hidden = false;
  } else {
    card.hidden = !data.enabled;
  }
  if (card.hidden) return;
  const state = document.getElementById('bot-dashboard-state');
  const stats = document.getElementById('bot-dashboard-stats');
  const toggle = document.getElementById('bot-dashboard-toggle');
  if (!data.enabled) {
    state.textContent = data.message || 'Bot not enabled on the server (set KALSHI_ENABLED=true).';
    stats.innerHTML = '';
    toggle.hidden = true;
    lastBotIsRunning = false;
    lastBotRunningSince = null;
    updateBotRuntimeDisplays();
    return;
  }
  toggle.hidden = false;
  lastBotIsRunning = !!data.isRunning;
  lastBotRunningSince = data.isRunning ? (Number(data.runningSince) || Date.now()) : null;
  updateBotRuntimeDisplays();

  const mode = data.config.mode === 'live' ? 'LIVE' : 'PAPER';
  state.textContent = `${mode} · ${strategyModeLabel(data.config.strategyMode)} · ${data.config.symbol || '—'} · ${formatSkimLabel(data.config)} · ${data.lastDecision || ''}`;
  const capital = data.capital || {};
  const openCount = (data.openTrades || []).length;
  stats.innerHTML = [
    buildCapitalLedgerHtml(capital, { depositControls: false }),
    buildOpenPositionsHtml(data.openTrades),
    chip('Open', openCount),
    chip('Trades opened', data.stats.totalAttempts),
    chip('Lifetime log', data.tradeLogTotal != null ? data.tradeLogTotal : data.stats.lifetimeTrades || 0),
    chip('Profitable exits', data.stats.profitableExits),
    buildTradeLogHtml(data.tradeLog, data.tradeLogTotal),
  ].join('');
  toggle.textContent = data.isRunning ? 'Stop new trades' : 'Start bot';
  toggle.dataset.running = String(!data.isRunning);
  const overlayToggle = document.getElementById('bot-running-toggle');
  if (overlayToggle) overlayToggle.textContent = toggle.textContent;
  bindTradeLogUi();
  bindActivityLogUi();
  renderModelSetups(data.modelSetups, data.modelShadowBooks);
  renderAssetStats(data.assetStats, data.config);
  renderModelAutoSwitchNote(data.modelAutoSwitch);
  renderBotPerfGrid(data.assetStats);
}

/**
 * Compact 2-column win-rate grid shown on the main bot dashboard card.
 * Renders all assets with at least 1 trade; shows win%, P&L, W/L count.
 */
function renderBotPerfGrid(stats) {
  const el = document.getElementById('bot-perf-grid');
  if (!el) return;
  const rows = Array.isArray(stats) ? stats : [];
  if (!rows.length) { el.innerHTML = ''; return; }
  el.innerHTML = `<div class="bpg-grid">${rows.map(r => {
    const wrTone = r.winRatePct != null ? (r.winRatePct >= 55 ? 'pos' : r.winRatePct < 40 ? 'neg' : '') : '';
    const pnlDollars = (r.pnlCents / 100).toFixed(2);
    const pnlTone = r.pnlCents > 0 ? 'pos' : r.pnlCents < 0 ? 'neg' : '';
    const liveTag = r.active ? '<span class="bpg-live">· live</span>' : r.isShadowOnly ? '<span class="bpg-live">· paper</span>' : '';
    const n = r.displayTrades || 0;
    const w = r.displayWins || 0;
    const l = r.displayLosses || 0;
    return `<div class="bpg-cell${r.active ? ' bpg-active' : ''}${r.excluded ? ' bpg-excluded' : ''}">
      <span class="bpg-sym">${escapeHtml(r.symbol)}${liveTag}</span>
      <span class="bpg-wr ${wrTone}">${r.winRatePct != null ? r.winRatePct + '%' : '—'}</span>
      <span class="bpg-pnl ${r.isShadowOnly ? '' : pnlTone}">${r.isShadowOnly ? '—' : (r.pnlCents >= 0 ? '+' : '') + '$' + pnlDollars}</span>
      <span class="bpg-n">${n}t · ${w}W/${l}L</span>
    </div>`;
  }).join('')}</div>`;
}

async function setBotRunning(running) {
  const { engineUrl } = loadSettings();
  try {
    const res = await fetch(`${engineUrl}/api/bot/running`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ running }),
    });
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.message || 'Could not update bot state.');
    await refreshBotStatus();
  } catch (err) {
    console.error('[dashboard] bot state update failed:', err.message);
  }
}

function formatTradeTime(ms) {
  if (!Number.isFinite(ms)) return '—';
  const d = new Date(ms);
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function formatCloseCountdown(closeTime) {
  if (!Number.isFinite(closeTime)) return '—';
  const remainingMs = closeTime - Date.now();
  if (remainingMs <= 0) {
    // Past close: bot should force-settle within a cycle. Don't imply a
    // forever "Settling…" hang on the open-positions list.
    const overdueSec = Math.round(-remainingMs / 1000);
    if (overdueSec > 20) return `overdue ${overdueSec}s`;
    return 'closing…';
  }
  const totalSeconds = Math.round(remainingMs / 1000);
  const mm = Math.floor(totalSeconds / 60);
  const ss = totalSeconds % 60;
  return `${mm}:${String(ss).padStart(2, '0')} left`;
}

function buildOpenPositionsHtml(openTrades) {
  const opens = (openTrades || []).filter(Boolean);
  if (!opens.length) {
    return `
      <div class="bot-positions">
        <div class="bot-panel-title">Open positions <span>0</span></div>
        <p class="bot-empty-line">No open positions.</p>
      </div>`;
  }
  const rows = opens
    .map((t) => {
      const side = String(t.side || '').toUpperCase();
      const entry = Number.isFinite(t.entryPriceCents) ? `${t.entryPriceCents}¢` : '—';
      const stake = Number.isFinite(t.stakeDollars) ? `$${Number(t.stakeDollars).toFixed(2)}` : '—';
      const contracts = Number.isFinite(t.contracts) ? t.contracts : '—';
      const conf = Number.isFinite(t.engineConfidence) ? `${t.engineConfidence}%` : '—';
      const strategy = strategyModeLabel(t.strategy);
      return `
        <div class="bot-position-row">
          <div class="bot-position-main">
            <strong>${t.symbol || '?'} ${side}</strong>
            <span>${entry} · ${contracts} ct · ${stake} · ${strategy}</span>
          </div>
          <div class="bot-position-meta">
            <span>Opened ${formatTradeTime(t.openedAt)}</span>
            <span>${formatCloseCountdown(Number(t.windowCloseTime))}</span>
            <span>Conf ${conf}</span>
          </div>
          ${t.holdReason ? `<div class="bot-position-hold">${escapeHtml(String(t.holdReason))}</div>` : ''}
        </div>`;
    })
    .join('');
  return `
    <div class="bot-positions">
      <div class="bot-panel-title">Open positions <span>${opens.length}</span></div>
      ${rows}
    </div>`;
}

function buildTradeLogHtml(tradeLog, tradeLogTotal) {
  const trades = Array.isArray(tradeLog) ? tradeLog : [];
  const total = Number.isFinite(tradeLogTotal) ? tradeLogTotal : trades.length;
  if (!trades.length) {
    return `
      <div class="bot-log bot-trade-log">
        <div class="bot-panel-title">Trade log <span>0</span></div>
        <p class="bot-empty-line">No trades saved yet. Every open/close is written to disk and stays after the 12h stats rotation.</p>
      </div>`;
  }

  const rows = trades
    .map((t) => {
      const side = String(t.side || '').toUpperCase();
      const status = t.status === 'open' ? 'OPEN' : String(t.exitReason || 'closed').toUpperCase();
      const entry = Number.isFinite(t.entryPriceCents) ? `${t.entryPriceCents}¢` : '—';
      const exit = Number.isFinite(t.exitPriceCents) ? `${t.exitPriceCents}¢` : '—';
      const pnl = t.status === 'closed' && Number.isFinite(t.pnlCents) ? t.pnlCents : null;
      const pnlClass =
        pnl != null && pnl > 0 ? 'chip-positive' : pnl != null && pnl < 0 ? 'chip-negative' : '';
      const skim =
        Number.isFinite(t.skimmedCents) && t.skimmedCents > 0
          ? ` · skim $${(t.skimmedCents / 100).toFixed(2)}`
          : '';
      const fees =
        Number.isFinite(t.feesCents) && t.feesCents > 0
          ? ` · fees $${(t.feesCents / 100).toFixed(2)}`
          : '';
      const gross =
        Number.isFinite(t.pnlGrossCents) &&
        Number.isFinite(t.feesCents) &&
        t.feesCents > 0 &&
        t.pnlGrossCents !== t.pnlCents
          ? ` · gross $${(t.pnlGrossCents / 100).toFixed(2)}`
          : '';
      const conf = Number.isFinite(t.engineConfidence) ? ` · conf ${t.engineConfidence}%` : '';
      const entryLean = Number.isFinite(t.modelEntryHeldProb) ? Math.round(t.modelEntryHeldProb) : null;
      const exitLean = Number.isFinite(t.modelExitHeldProb) ? Math.round(t.modelExitHeldProb) : null;
      const leanNote = entryLean != null
        ? exitLean != null
          ? ` · lean ${entryLean}→${exitLean}%`
          : ` · lean ${entryLean}%`
        : '';
      const peakNote = Number.isFinite(t.peakHeldBidCents)
        ? ` · hi ${Math.round(t.peakHeldBidCents)}¢`
        : '';
      const troughNote = Number.isFinite(t.troughHeldBidCents)
        ? ` · lo ${Math.round(t.troughHeldBidCents)}¢`
        : '';
      const beChaseNote = t.beChaseResult === 'achieved'
        ? ` · bounce ✓`
        : t.beChaseResult === 'expired'
          ? ` · bounce ✗`
          : '';
      let stopNote = '';
      let stopCopy = '';
      if (t.exitReason === 'stop_loss') {
        if (t.stopVerdictPending || t.stopVerdict === 'pending') {
          stopNote = `<span class="bot-log-sub stop-verdict pending">Stop review: checking whether this prevented more loss or missed a bounce…</span>`;
          stopCopy = 'Stop review pending';
        } else if (t.stopVerdict === 'prevented_loss') {
          const detail = t.stopVerdictDetail || 'Stop helped — prevented further loss';
          stopNote = `<span class="bot-log-sub stop-verdict helped">${escapeHtml(detail)}</span>`;
          stopCopy = detail;
        } else if (t.stopVerdict === 'missed_opportunity') {
          const detail = t.stopVerdictDetail || 'Missed opportunity — would have recovered';
          stopNote = `<span class="bot-log-sub stop-verdict missed">${escapeHtml(detail)}</span>`;
          stopCopy = detail;
        } else if (t.stopVerdict === 'mixed') {
          const detail = t.stopVerdictDetail || 'Stop outcome unclear';
          stopNote = `<span class="bot-log-sub stop-verdict mixed">${escapeHtml(detail)}</span>`;
          stopCopy = detail;
        }
      }
      const rowId = escapeHtml(t.id || `${t.symbol || 'x'}-${t.openedAt || ''}-${t.closedAt || ''}`);
      const copyLine = [
        formatTradeTime(t.closedAt || t.openedAt),
        `${t.symbol || '?'} ${side}`,
        status,
        `${entry}${t.status === 'closed' ? ` → ${exit}` : ''}`,
        Number.isFinite(t.stakeDollars) ? `$${Number(t.stakeDollars).toFixed(2)}` : null,
        conf ? conf.replace(/^\s·\s/, '') : null,
        fees ? fees.replace(/^\s·\s/, '') : null,
        gross ? gross.replace(/^\s·\s/, '') : null,
        skim ? skim.replace(/^\s·\s/, '') : null,
        `opened ${formatTradeTime(t.openedAt)}${t.mode ? ` · ${t.mode}` : ''}`,
        stopCopy || null,
        pnl != null ? formatMoneyCents(pnl, { signed: true }) : t.status === 'open' ? 'open' : null,
      ]
        .filter(Boolean)
        .join(' · ');
      return `
        <div class="bot-log-row kind-${t.status === 'open' ? 'open' : 'close'}" data-log-id="${rowId}" data-copy-line="${escapeHtml(copyLine)}">
          <span class="bot-log-time">${formatTradeTime(t.closedAt || t.openedAt)}</span>
          <span class="bot-log-msg">
            <strong>${t.symbol || '?'} ${side}</strong>
            ${status} · ${entry}${t.status === 'closed' ? ` → ${exit}` : ''}
            ${Number.isFinite(t.stakeDollars) ? ` · $${Number(t.stakeDollars).toFixed(2)}` : ''}${conf}${leanNote}${peakNote}${troughNote}${beChaseNote}${fees}${gross}${skim}
            <span class="bot-log-sub">opened ${formatTradeTime(t.openedAt)}${t.mode ? ` · ${t.mode}` : ''}</span>
            ${stopNote}
          </span>
          <span class="bot-log-pnl ${pnlClass}">${pnl != null ? formatMoneyCents(pnl, { signed: true }) : t.status === 'open' ? 'open' : ''}</span>
        </div>`;
    })
    .join('');

  return `
    <div class="bot-log bot-trade-log">
      <div class="bot-panel-title">Trade log <span>${total}</span> <button type="button" class="bot-log-copy" id="bot-trade-copy" title="Copy trade log text">Copy</button></div>
      <p class="bot-empty-line">Saved on disk (survives reboot + 12h rotation). Showing latest ${trades.length}${total > trades.length ? ` of ${total}` : ''}.</p>
      <div class="bot-log-list" id="bot-trade-log-list">${rows}</div>
    </div>`;
}

function buildHourlyPnlHtml(hourlyPnl) {
  const buckets = Array.isArray(hourlyPnl) ? hourlyPnl : [];
  if (!buckets.length) return '';
  const rows = buckets
    .map((b) => {
      const pnl = Number(b.pnlCents) || 0;
      const pnlClass = pnl > 0 ? 'chip-positive' : pnl < 0 ? 'chip-negative' : '';
      const trades = Number(b.trades) || 0;
      return `
        <div class="hourly-pnl-row">
          <span class="hourly-pnl-hour">${escapeHtml(b.label || '—')}</span>
          <span class="hourly-pnl-trades">${trades} trade${trades === 1 ? '' : 's'}</span>
          <span class="hourly-pnl-value ${pnlClass}">${formatMoneyCents(pnl, { signed: true })}</span>
        </div>`;
    })
    .join('');
  const total = buckets.reduce((sum, b) => sum + (Number(b.pnlCents) || 0), 0);
  const totalClass = total > 0 ? 'chip-positive' : total < 0 ? 'chip-negative' : '';
  return `
    <div class="hourly-pnl">
      <div class="bot-panel-title">P&amp;L by hour <span>last 6h</span></div>
      <div class="hourly-pnl-list">${rows}</div>
      <div class="hourly-pnl-total">
        <span>6h total</span>
        <span class="${totalClass}">${formatMoneyCents(total, { signed: true })}</span>
      </div>
    </div>`;
}

const LOG_STICKY_PX = 64;

function captureLogScroll(id, mode = 'bottom') {
  const el = document.getElementById(id);
  if (!el) return null;
  const nearLatest =
    mode === 'bottom'
      ? el.scrollHeight - el.scrollTop - el.clientHeight <= LOG_STICKY_PX
      : el.scrollTop <= LOG_STICKY_PX;
  let anchorId = null;
  let anchorOffset = 0;
  for (const child of el.children) {
    if (!(child instanceof HTMLElement)) continue;
    if (child.offsetTop + child.offsetHeight > el.scrollTop + 1) {
      anchorId = child.getAttribute('data-log-id') || child.id || null;
      anchorOffset = child.offsetTop - el.scrollTop;
      break;
    }
  }
  return { scrollTop: el.scrollTop, stickToLatest: nearLatest, mode, anchorId, anchorOffset };
}

function restoreLogScroll(id, state, defaultMode = 'bottom') {
  const el = document.getElementById(id);
  if (!el) return;
  const mode = (state && state.mode) || defaultMode;
  const apply = () => {
    if (!state || state.stickToLatest) {
      el.scrollTop = mode === 'bottom' ? el.scrollHeight : 0;
      return;
    }
    if (state.anchorId) {
      const anchor = el.querySelector(`[data-log-id="${CSS.escape(String(state.anchorId))}"]`);
      if (anchor instanceof HTMLElement) {
        el.scrollTop = Math.max(0, anchor.offsetTop - (Number(state.anchorOffset) || 0));
        return;
      }
    }
    el.scrollTop = state.scrollTop;
  };
  apply();
  // Second pass after images/fonts/layout — keep the same row under the thumb.
  requestAnimationFrame(apply);
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function bindActivityLogUi() {
  const list = document.getElementById('bot-activity-log-list');
  const copyBtn = document.getElementById('bot-activity-copy');
  if (!copyBtn || !list) return;
  copyBtn.onclick = (e) => {
    e.preventDefault();
    e.stopPropagation();
    const text = Array.from(list.querySelectorAll('.bot-log-row'))
      .map((row) => row.innerText.replace(/\s+/g, ' ').trim())
      .filter(Boolean)
      .join('\n');
    if (!text) return;
    copyTextToClipboard(text, copyBtn);
  };
}

function bindTradeLogUi() {
  const list = document.getElementById('bot-trade-log-list');
  const copyBtn = document.getElementById('bot-trade-copy');
  if (!copyBtn || !list) return;
  copyBtn.onclick = (e) => {
    e.preventDefault();
    e.stopPropagation();
    const text = Array.from(list.querySelectorAll('.bot-log-row'))
      .map((row) => {
        const fromAttr = row.getAttribute('data-copy-line');
        if (fromAttr && fromAttr.trim()) return fromAttr.trim();
        return row.innerText.replace(/\s+/g, ' ').trim();
      })
      .filter(Boolean)
      .join('\n');
    if (!text) return;
    copyTextToClipboard(text, copyBtn);
  };
}

function copyTextToClipboard(text, copyBtn) {
  const done = () => {
    if (!copyBtn) return;
    copyBtn.textContent = 'Copied';
    setTimeout(() => {
      copyBtn.textContent = 'Copy';
    }, 1200);
  };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(done).catch(() => {
      fallbackCopyText(text);
      done();
    });
  } else {
    fallbackCopyText(text);
    done();
  }
}

function fallbackCopyText(text) {
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
  } catch (_) {
    /* ignore */
  }
}

function buildActivityLogHtml(activityLog, recentTrades) {
  const events = Array.isArray(activityLog) ? activityLog.slice(0, 30) : [];
  // Fallback: synthesize from trades if log is empty (pre-upgrade ledgers).
  const rows = events.length
    ? events
    : (recentTrades || []).slice(0, 20).map((t) => ({
        at: t.closedAt || t.openedAt,
        kind: t.status === 'open' ? 'open' : 'close',
        message:
          t.status === 'open'
            ? `Open ${t.symbol} ${String(t.side || '').toUpperCase()} @ ${t.entryPriceCents}¢`
            : `Closed ${t.symbol} ${String(t.side || '').toUpperCase()} via ${t.exitReason || 'exit'} (P&L $${((t.pnlCents || 0) / 100).toFixed(2)})`,
        pnlCents: t.pnlCents,
      }));

  if (!rows.length) {
    return `
      <div class="bot-log bot-activity-log">
        <div class="bot-panel-title">Activity log</div>
        <p class="bot-empty-line">No activity yet — opens, closes, and mode changes show up here.</p>
      </div>`;
  }

  // Chronological (oldest → newest) so sticky-bottom follows the latest line.
  const displayRows = rows.slice().reverse();

  const html = displayRows
    .map((e) => {
      const pnl = e.pnlCents;
      const pnlClass =
        Number.isFinite(pnl) && pnl > 0 ? 'chip-positive' : Number.isFinite(pnl) && pnl < 0 ? 'chip-negative' : '';
      const kind = e.kind || 'info';
      const rowId = escapeHtml(`${e.at || ''}-${kind}-${String(e.message || '').slice(0, 40)}`);
      return `
        <div class="bot-log-row kind-${escapeHtml(kind)}" data-log-id="${rowId}">
          <span class="bot-log-time">${escapeHtml(formatTradeTime(e.at))}</span>
          <span class="bot-log-msg">${escapeHtml(e.message || '')}</span>
          ${Number.isFinite(pnl) ? `<span class="bot-log-pnl ${pnlClass}">${escapeHtml(formatMoneyCents(pnl, { signed: true }))}</span>` : '<span class="bot-log-pnl"></span>'}
        </div>`;
    })
    .join('');

  return `
    <div class="bot-log bot-activity-log">
      <div class="bot-panel-title">Activity log <button type="button" class="bot-log-copy" id="bot-activity-copy" title="Copy log text">Copy</button></div>
      <div class="bot-log-list" id="bot-activity-log-list">${html}</div>
    </div>`;
}

function formatMoneyCents(cents, { signed = false } = {}) {
  const value = (Number(cents) || 0) / 100;
  const abs = `$${Math.abs(value).toFixed(2)}`;
  if (!signed) return value < 0 ? `-${abs}` : abs;
  if (value > 0) return `+${abs}`;
  if (value < 0) return `-${abs}`;
  return abs;
}

/**
 * Capital ledger. Uses existing capital fields as-is:
 * Available + Open + Wallet + Insurance = Total Equity
 * Net P&L = Total Equity − Starting Bankroll − Insurance deposits (manual seeds)
 *
 * Deposit controls are overlay-only (`depositControls: true`) so the dashboard
 * summary cannot duplicate `#bot-insurance-deposit*` ids and steal getElementById.
 */
function buildCapitalLedgerHtml(capital, opts = {}) {
  if (!capital) return '';
  const depositControls = opts.depositControls === true;
  const starting = Number(capital.startingCents) || 0;
  const available = Number(capital.paperAvailableCents) || 0;
  const openPositions = Number(capital.openExposureCents) || 0;
  const reserved = Number(capital.reserveCents) || 0;
  const insurance = Number(capital.insuranceCents) || 0;
  const insuranceCap = Number(capital.insuranceCapCents) || 1000;
  const insuranceFloor = Number(capital.insuranceFloorCents) || 600;
  const insuranceOverflow = Number(capital.insuranceOverflowCents) || 1500;
  const deposited = Number(capital.insuranceDepositedCents) || 0;
  const insuranceReady = !!capital.insuranceReady;
  const totalEquity = available + openPositions + reserved + insurance;
  const netPnl = totalEquity - starting - deposited;
  const pnlClass = netPnl > 0 ? 'chip-positive' : netPnl < 0 ? 'chip-negative' : '';
  const reservedClass = reserved > 0 ? 'chip-positive' : '';
  const insuranceClass = insurance > 0 ? 'chip-positive' : '';
  const readyLabel = insuranceReady ? ' · armed' : '';
  const liveCash = Number(capital.liveAvailableCents);
  const hasLiveCash = Number.isFinite(liveCash);
  const liveGap = hasLiveCash ? liveCash - available : null;
  const liveGapClass =
    liveGap == null ? '' : liveGap > 0 ? 'chip-positive' : liveGap < 0 ? 'chip-negative' : '';
  const depositBlock = depositControls
    ? `<div class="insurance-deposit-row">
        <input id="bot-insurance-deposit" type="number" min="0.01" max="500" step="0.01" inputmode="decimal" placeholder="Amount $" aria-label="Insurance deposit dollars" />
        <button class="btn-secondary" id="bot-insurance-deposit-btn" type="button">Add to Insurance</button>
      </div>
      <p class="field-hint insurance-deposit-hint">Seed or top up with your own money (external — does not take from Available). Max $500 per add.</p>
      <p class="settings-hint" id="bot-insurance-deposit-feedback" role="status" aria-live="polite"></p>`
    : '';

  const liveBlock = hasLiveCash
    ? `<div class="capital-row"><span>Kalshi cash <em>(API balance)</em></span><span>${formatMoneyCents(liveCash)}</span></div>
      <div class="capital-row"><span>Bot Available vs Kalshi</span><span class="${liveGapClass}">${formatMoneyCents(liveGap, { signed: true })}</span></div>
      <div class="capital-divider"></div>`
    : '';

  return `
    <div class="capital-ledger">
      <div class="capital-ledger-title">Capital</div>
      <div class="capital-row capital-reserved">
        <span>Personal Wallet <em>(locked — never spent)</em></span>
        <span class="${reservedClass}">${formatMoneyCents(reserved)}</span>
      </div>
      <div class="capital-row capital-reserved">
        <span>Insurance Fund <em>(arm ${formatMoneyCents(insuranceCap)} / floor ${formatMoneyCents(insuranceFloor)} / overflow ${formatMoneyCents(insuranceOverflow)}${readyLabel})</em></span>
        <span class="${insuranceClass}">${formatMoneyCents(insurance)}</span>
      </div>
      ${depositBlock}
      <div class="capital-divider"></div>
      ${liveBlock}
      <div class="capital-row"><span>Starting Bankroll</span><span>${formatMoneyCents(starting)}</span></div>
      ${deposited > 0 ? `<div class="capital-row"><span>Insurance deposits <em>(manual)</em></span><span>${formatMoneyCents(deposited)}</span></div>` : ''}
      <div class="capital-row"><span>Available Cash</span><span>${formatMoneyCents(available)}</span></div>
      <div class="capital-row"><span>Open Positions Value</span><span>${formatMoneyCents(openPositions)}</span></div>
      <div class="capital-divider"></div>
      <div class="capital-row capital-total"><span>Total Equity</span><span>${formatMoneyCents(totalEquity)}</span></div>
      <div class="capital-row capital-pnl"><span>Net P&amp;L <em>(fee-net)</em></span><span class="${pnlClass}">${formatMoneyCents(netPnl, { signed: true })}</span></div>
      <p class="capital-formula">Closed P&amp;L is fee-net so Available tracks Kalshi cash closer (gross − fees). Insurance: every win is 20% Insurance / 40% Wallet / 40% Available. Arms at ${formatMoneyCents(insuranceCap)}; stays usable down to ${formatMoneyCents(insuranceFloor)}. Soft fill ceiling ${formatMoneyCents(insuranceOverflow)} — excess 20% skim → Available (fund stays as cushion). Below the floor, Available takes losses until re-armed. <strong>Personal Wallet is locked forever</strong> — never spent on entries or losses (append-only paycheck). New entries spend <strong>Available only</strong> — bot <strong>stops</strong> when Available cannot fund the next entry. Insurance still absorbs losses when armed. Manual Add seeds without touching Available.</p>
    </div>`;
}

function insuranceDepositEls() {
  const root = document.getElementById('bot-overlay') || document;
  return {
    input: root.querySelector('#bot-insurance-deposit'),
    feedback: root.querySelector('#bot-insurance-deposit-feedback'),
    btn: root.querySelector('#bot-insurance-deposit-btn'),
  };
}

function setInsuranceDepositFeedback(message, ok) {
  const { feedback } = insuranceDepositEls();
  if (!feedback) {
    console[ok ? 'log' : 'error']('[insurance deposit]', message);
    return;
  }
  feedback.textContent = message;
  feedback.style.color = ok ? 'var(--up)' : 'var(--down)';
}

async function depositInsuranceFromUi() {
  const { input, feedback, btn } = insuranceDepositEls();
  if (!input || !feedback) {
    console.error('[insurance deposit] controls missing — open the bot panel and try again.');
    return;
  }
  const dollars = parseFloat(String(input.value || '').trim());
  if (!Number.isFinite(dollars) || dollars <= 0) {
    setInsuranceDepositFeedback('Enter a positive dollar amount.', false);
    input.focus();
    return;
  }
  const { engineUrl } = loadSettings();
  if (!engineUrl) {
    setInsuranceDepositFeedback('Engine URL is not set. Open Settings and connect first.', false);
    return;
  }
  if (btn) btn.disabled = true;
  try {
    const res = await fetch(`${engineUrl}/api/bot/insurance/deposit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dollars }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) throw new Error(data.message || `Deposit failed (HTTP ${res.status}).`);
    input.value = '';
    await refreshBotStatus();
    setInsuranceDepositFeedback(data.message || 'Insurance updated.', true);
  } catch (err) {
    setInsuranceDepositFeedback(`Could not add to Insurance: ${err.message}`, false);
  } finally {
    const after = insuranceDepositEls();
    if (after.btn) after.btn.disabled = false;
  }
}

function chip(label, value, colorClass) {
  const cls = colorClass ? (colorClass === 'up' ? 'chip-positive' : 'chip-negative') : '';
  return `<div class="bot-stat-chip"><span class="stat-label">${label}</span><span class="stat-value${cls ? ' ' + cls : ''}">${value}</span></div>`;
}

const SLIDER_UNITS = {
  'bot-edge': (v) => `${(+v).toFixed(1)}%`,
  'bot-confidence': (v) => `${Math.round(v)}%`,
  'bot-stoploss': (v) => `−${Math.round(v)}¢`,
  'bot-stoprecovery': (v) => (Number(v) <= 0 ? 'off' : `+${Math.round(v)}¢`),
  'bot-takeprofit': (v) => `+${Math.round(v)}¢`,
  'bot-minentries': (v) => `${Math.round(v)}¢`,
  'bot-model-confidence': (v) => `${Math.round(v)}%`,
  'bot-model-min-entry-lean': (v) => (Number(v) <= 0 ? 'off' : `${Math.round(v)}%`),
  'bot-model-lean-skip-above': (v) => (Number(v) <= 0 ? 'min-entry' : `≥${Math.round(v)}¢`),
  'bot-model-min-entry-lean-sol': (v) => (Number(v) <= 0 ? 'off' : `${Math.round(v)}%`),
  'bot-model-min-entry-lean-btc': (v) => (Number(v) <= 0 ? 'off' : `${Math.round(v)}%`),
  'bot-model-min-entry-lean-eth': (v) => (Number(v) <= 0 ? 'off' : `${Math.round(v)}%`),
  'bot-model-min-entry-lean-xrp': (v) => (Number(v) <= 0 ? 'off' : `${Math.round(v)}%`),
  'bot-model-min-entry-lean-doge': (v) => (Number(v) <= 0 ? 'off' : `${Math.round(v)}%`),
  'bot-model-min-entry-lean-bnb': (v) => (Number(v) <= 0 ? 'off' : `${Math.round(v)}%`),
  'bot-model-min-entry-lean-near': (v) => (Number(v) <= 0 ? 'off' : `${Math.round(v)}%`),
  'bot-model-min-entry-lean-hype': (v) => (Number(v) <= 0 ? 'off' : `${Math.round(v)}%`),
  'bot-model-min-entry-lean-gold': (v) => (Number(v) <= 0 ? 'off' : `${Math.round(v)}%`),
  'bot-model-min-entry-lean-silver': (v) => (Number(v) <= 0 ? 'off' : `${Math.round(v)}%`),
  'bot-model-min-entry-lean-oil': (v) => (Number(v) <= 0 ? 'off' : `${Math.round(v)}%`),
  'bot-model-min-entry-lean-natgas': (v) => (Number(v) <= 0 ? 'off' : `${Math.round(v)}%`),
  'bot-model-min-entry-lean-copper': (v) => (Number(v) <= 0 ? 'off' : `${Math.round(v)}%`),
  'bot-commodity-min-entry': (v) => (Number(v) <= 0 ? 'global' : `${Math.round(v)}¢`),
  'bot-commodity-min-entry-gold': (v) => (Number(v) <= 0 ? 'global' : `${Math.round(v)}¢`),
  'bot-commodity-min-entry-silver': (v) => (Number(v) <= 0 ? 'global' : `${Math.round(v)}¢`),
  'bot-commodity-min-entry-oil': (v) => (Number(v) <= 0 ? 'global' : `${Math.round(v)}¢`),
  'bot-commodity-min-entry-natgas': (v) => (Number(v) <= 0 ? 'global' : `${Math.round(v)}¢`),
  'bot-commodity-min-entry-copper': (v) => (Number(v) <= 0 ? 'global' : `${Math.round(v)}¢`),
  'bot-commodity-max-entry': (v) => (Number(v) <= 0 ? 'off' : `${Math.round(v)}¢`),
  'bot-commodity-stake-gold': (v) => (Number(v) <= 0 ? 'global' : `$${parseFloat(v).toFixed(2)}`),
  'bot-commodity-stake-silver': (v) => (Number(v) <= 0 ? 'global' : `$${parseFloat(v).toFixed(2)}`),
  'bot-commodity-stake-oil': (v) => (Number(v) <= 0 ? 'global' : `$${parseFloat(v).toFixed(2)}`),
  'bot-commodity-stop-gold': (v) => (Number(v) <= 0 ? 'global' : `−${Math.round(v)}¢`),
  'bot-commodity-stop-silver': (v) => (Number(v) <= 0 ? 'global' : `−${Math.round(v)}¢`),
  'bot-commodity-stop-oil': (v) => (Number(v) <= 0 ? 'global' : `−${Math.round(v)}¢`),
  'bot-commodity-stop-natgas': (v) => (Number(v) <= 0 ? 'global' : `−${Math.round(v)}¢`),
  'bot-commodity-stop-copper': (v) => (Number(v) <= 0 ? 'global' : `−${Math.round(v)}¢`),
  'bot-commodity-tp-gold': (v) => (Number(v) <= 0 ? 'global' : Number(v) >= 99 ? 'settle' : `+${Math.round(v)}¢`),
  'bot-commodity-tp-silver': (v) => (Number(v) <= 0 ? 'global' : Number(v) >= 99 ? 'settle' : `+${Math.round(v)}¢`),
  'bot-commodity-tp-oil': (v) => (Number(v) <= 0 ? 'global' : Number(v) >= 99 ? 'settle' : `+${Math.round(v)}¢`),
  'bot-commodity-tp-natgas': (v) => (Number(v) <= 0 ? 'global' : Number(v) >= 99 ? 'settle' : `+${Math.round(v)}¢`),
  'bot-commodity-tp-copper': (v) => (Number(v) <= 0 ? 'global' : Number(v) >= 99 ? 'settle' : `+${Math.round(v)}¢`),
  'bot-commodity-stake-natgas': (v) => (Number(v) <= 0 ? 'global' : `$${parseFloat(v).toFixed(2)}`),
  'bot-commodity-stake-copper': (v) => (Number(v) <= 0 ? 'global' : `$${parseFloat(v).toFixed(2)}`),
  'bot-commodity-trail-gold': (v) => (Number(v) <= 0 ? 'off' : `−${Math.round(v)}¢ from peak`),
  'bot-commodity-trail-silver': (v) => (Number(v) <= 0 ? 'off' : `−${Math.round(v)}¢ from peak`),
  'bot-commodity-trail-oil': (v) => (Number(v) <= 0 ? 'off' : `−${Math.round(v)}¢ from peak`),
  'bot-commodity-trail-natgas': (v) => (Number(v) <= 0 ? 'off' : `−${Math.round(v)}¢ from peak`),
  'bot-commodity-trail-copper': (v) => (Number(v) <= 0 ? 'off' : `−${Math.round(v)}¢ from peak`),
  'bot-model-live-favor': (v) => (Number(v) <= 0 ? 'any lead' : `≥${Math.round(v)} pts`),
  'bot-model-min-room-floor': (v) => (Number(v) <= 0 ? 'off' : `≥${Math.round(v)}¢`),
  'bot-model-signal-dom': (v) => {
    const n = Number(v);
    if (!(n > 0)) return 'off';
    return `on ≥${(n / 10).toFixed(1)}`;
  },
  'bot-model-confirm-cross': (v) => (Number(v) <= 0 ? 'off' : `cross ${Math.round(v)}¢`),
  'bot-model-confirm-ext': (v) => `+${Math.round(v)}¢ max`,
  'bot-model-min-entry': (v) => `${Math.round(v)}¢`,
  'bot-model-low-ask-conf': (v) => (Number(v) <= 0 ? 'off' : `≤69¢ need ≥${Math.round(v)}%`),
  'bot-model-max-entry': (v) => `${Math.round(v)}¢`,
  'bot-model-bank-green': (v) => `+${Math.round(v)}¢`,
  'bot-model-near-target-bank': (v) => `+${Math.round(v)}¢`,
  'bot-model-stagnation-sec': (v) => (Number(v) <= 0 ? 'off' : `${Math.round(v)}s`),
  'bot-model-stagnation-sensitivity': (v) => (Number(v) <= 0 ? 'any progress' : `≥${Math.round(v)}¢`),
  'bot-model-be-chase-sec': (v) => (Number(v) <= 0 ? 'off' : `${Math.round(v)}s`),
  'bot-model-no-progress-sec': (v) => (Number(v) <= 0 ? 'off' : `${Math.round(v)}s`),
  'bot-model-no-progress-pct': (v) => `${Math.round(v)}%`,
  'bot-model-no-progress-arm': (v) => `+${Math.round(v)}¢`,
  'bot-model-trail-cents': (v) => (Number(v) <= 0 ? 'off' : `−${Math.round(v)}¢ from peak`),
  'bot-model-max-adverse': (v) => (Number(v) <= 0 ? 'off' : `−${Math.round(v)}¢`),
  'bot-model-underwater-window': (v) => (Number(v) <= 0 ? 'off' : `${Math.round(v)}s`),
  'bot-model-underwater-ratio': (v) => (Number(v) <= 0 ? 'off' : `${Math.round(v)}%`),
  'bot-model-rapid-adverse': (v) => (Number(v) <= 0 ? 'off' : `−${Math.round(v)}¢`),
  'bot-model-open-grace-ms': (v) => (Number(v) <= 0 ? 'off' : `${Math.round(Number(v) / 1000)}s`),
  'bot-model-prob-drift': (v) => `${Math.round(v)}pts`,
  'bot-model-live-lean-margin': (v) => `${Math.round(v)}%`,
  'bot-model-stall-sec': (v) => (Number(v) <= 0 ? 'off' : `${Math.round(v)}s`),
  'bot-model-decay-drop': (v) => `${Math.round(v)}pts`,
  'bot-model-decay-stall': (v) => (Number(v) <= 0 ? 'off' : `${Math.round(v)}s`),
  'bot-model-decay-floor': (v) => `${Math.round(v)}%`,
  'bot-model-min-open': (v) => (Number(v) <= 0 ? 'off' : `${(+v).toFixed(1)} min`),
  'bot-model-max-open': (v) => (Number(v) <= 0 ? 'off' : `≤${(+v).toFixed(1)} min`),
  'bot-model-peak-touch-tp': (v) => (Number(v) <= 0 ? 'off' : `${Math.round(v)}×`),
  'bot-model-peak-touch-window': (v) => `${Math.round(v)}¢`,
  'bot-model-entry-momentum-block': (v) => (Number(v) <= 0 ? 'off' : `${(+v * 100).toFixed(0)}%`),
  'bot-model-settle-close': (v) => (Number(v) <= 0 ? 'off' : `${(+v).toFixed(1)} min`),
  'bot-model-late-barrier': (v) => (Number(v) <= 0 ? 'off' : `${(+v).toFixed(1)} min`),
  'bot-commodity-settle-close': (v) => (Number(v) <= 0 ? 'default (6m)' : `${(+v).toFixed(1)} min`),
  'bot-commodity-late-barrier': (v) => (Number(v) <= 0 ? 'default (7m)' : `${(+v).toFixed(1)} min`),
  'bot-model-preclose-force': (v) => (Number(v) <= 0 ? 'off' : `${(+v).toFixed(2)} min`),
  'bot-model-late-exit-max-loss': (v) => (Number(v) <= 0 ? 'off' : `−${Math.round(v)}¢`),
  'bot-model-lean-floor-drop': (v) => (Number(v) <= 0 ? 'off' : `−${Math.round(v)}¢`),
  'bot-model-lean-floor-scale': (v) => `${(+v).toFixed(2)}×`,
  'bot-model-max-loss': (v) => `−${Math.round(v)}¢`,
  'bot-model-hard-floor': (v) => `${Math.round(v)}¢ floor`,
  'bot-model-pace-drawdown': (v) => `${Math.round(v)}% of room`,
  'bot-model-pace-sample': (v) => (Number(v) <= 0 ? 'off' : `${Math.round(v)}s sample`),
  'bot-model-rich-floor': (v) => (Number(v) <= 0 ? 'off' : `${Math.round(v)}¢ floor`),
  'bot-model-sitout': (v) => (Number(v) <= 0 ? 'off' : `${Math.round(v)}s`),
  'bot-model-global-sitout': (v) => (Number(v) <= 0 ? 'off' : `${Math.round(v)}s`),
  'bot-asset-auto-exclude-min-trades': (v) => `${Math.round(v)} trades`,
  'bot-asset-auto-exclude-floor': (v) => (Number(v) <= 0 ? 'off' : `${Math.round(v)}%`),
  'bot-asset-auto-exclude-ceiling': (v) => (Number(v) <= 0 ? 'off' : `${Math.round(v)}%`),
  'bot-asset-stats-lookback': (v) => `${Math.round(v)} trades`,
  'bot-settle-min': (v) => `${Math.round(v)}¢`,
  'bot-settle-max': (v) => `${Math.round(v)}¢`,
  'bot-settle-stoploss': (v) => `−${Math.round(v)}¢`,
  'bot-settle-maxmin': (v) => `${(+v).toFixed(1)} min`,
  'bot-settle-cooldown': (v) => (Number(v) <= 0 ? 'off' : `${(+v).toFixed(1)} min`),
  'bot-settle-late-min': (v) => (Number(v) <= 0 ? 'off' : `${(+v).toFixed(1)} min`),
  'bot-settle-late-floor': (v) => `${Math.round(v)}¢`,
  'bot-settle-stuck': (v) => (Number(v) <= 0 ? 'off' : `${(+v).toFixed(1)} min`),
  'bot-stake': (v) => `$${Math.round(v)}`,
  'bot-maxpos': (v) => `${Math.round(v)}`,
  'bot-paper-balance': (v) => `$${Math.round(v)}`,
};

function syncTradingSlidersFromConfig(c) {
  const dailyLossEl = document.getElementById('bot-daily-loss-value');
  if (dailyLossEl) {
    const v = c.dailyLossLimitDollars != null ? c.dailyLossLimitDollars : 5;
    dailyLossEl.textContent = v === 0 ? 'off' : `$${Number(v).toFixed(0)}`;
    dailyLossEl.dataset.value = v;
  }
  const stakeEl = document.getElementById('bot-stake');
  if (stakeEl) stakeEl.value = c.stakeDollars != null ? c.stakeDollars : 5;
  const maxEl = document.getElementById('bot-maxpos');
  if (maxEl) maxEl.value = c.maxOpenPositions != null ? c.maxOpenPositions : 1;
  const secondGreen = document.getElementById('bot-second-green');
  if (secondGreen) {
    secondGreen.value = c.secondOpenRequiresGreen === 'off' ? 'off' : 'on';
  }
}

function readTradingSlidersFromForm() {
  return {
    dailyLossLimitDollars: parseFloat(document.getElementById('bot-daily-loss-value')?.dataset.value || '5'),
    stakeDollars: parseFloat(document.getElementById('bot-stake')?.value || '5'),
    maxOpenPositions: parseFloat(document.getElementById('bot-maxpos')?.value || '1'),
    secondOpenRequiresGreen: document.getElementById('bot-second-green')?.value || 'on',
  };
}

function readAutoTradeSymbolsFromForm() {
  const boxes = document.querySelectorAll('#bot-auto-coins input[data-coin]');
  if (!boxes.length) return 'BTC,ETH';
  const picked = Array.from(boxes)
    .filter((el) => el.checked)
    .map((el) => String(el.dataset.coin || '').toUpperCase())
    .filter(Boolean);
  return picked.length ? picked.join(',') : 'BTC,ETH';
}

function syncAutoTradeSymbolsToForm(c) {
  const wrap = document.getElementById('bot-auto-coins');
  if (!wrap) return;
  let enabled = [];
  const raw = c && c.autoTradeSymbols;
  if (Array.isArray(raw)) enabled = raw.map((s) => String(s).toUpperCase());
  else if (typeof raw === 'string' && raw.trim()) {
    enabled = raw.split(/[,|\s]+/).map((s) => s.trim().toUpperCase()).filter(Boolean);
  } else {
    // Legacy: everything on except DOGE/NEAR unless toggled
    enabled = ['BTC', 'ETH', 'SOL', 'XRP', 'BNB', 'HYPE'];
    if (c && (c.tradeDoge === 'on' || c.tradeDoge === true)) enabled.push('DOGE');
    if (c && (c.tradeNear === 'on' || c.tradeNear === true)) enabled.push('NEAR');
  }
  if (!enabled.length) enabled = ['BTC', 'ETH'];
  const set = new Set(enabled);
  wrap.querySelectorAll('input[data-coin]').forEach((el) => {
    el.checked = set.has(String(el.dataset.coin || '').toUpperCase());
  });
}

function strategyModeLabel(mode) {
  const m = String(mode || '').toLowerCase();
  if (m === 'settle') return 'Settle';
  if (m === 'model') return 'MODEL';
  return 'Edge';
}

function formatSetupKnobs(s) {
  if (!s) return '';
  const bits = [];
  if (s.modelMinConfidence != null) bits.push(`conf ${s.modelMinConfidence}`);
  if (s.modelEntryLiveLeanMarginPct != null) bits.push(`favor ${s.modelEntryLiveLeanMarginPct}`);
  if (s.modelMinEntryLeanPct != null) {
    bits.push(Number(s.modelMinEntryLeanPct) > 0 ? `lean≥${s.modelMinEntryLeanPct}%` : 'lean off');
  }
  if (s.modelSignalDominanceMin != null) {
    bits.push(
      Number(s.modelSignalDominanceMin) > 0
        ? `sig≥${s.modelSignalDominanceMin}`
        : 'sig off'
    );
  }
  if (s.modelMinTpCents != null) bits.push(`TP +${s.modelMinTpCents}¢`);
  if (s.modelMaxLossCents != null && s.modelMaxLossCents > 0) bits.push(`max −${s.modelMaxLossCents}¢`);
  if (s.modelHardStopFloorCents != null) bits.push(`floor ${s.modelHardStopFloorCents}¢`);
  else bits.push('floor 55¢');
  if (s.modelRichStopFloorCents != null && Number(s.modelRichStopFloorCents) > 0) {
    bits.push(`rich→${s.modelRichStopFloorCents}¢`);
  }
  if (s.maxOpenPositions != null) {
    bits.push(`${s.maxOpenPositions} slot${Number(s.maxOpenPositions) === 1 ? '' : 's'}`);
  }
  if (s.modelDumpPullbackCents != null) bits.push(`dump ${s.modelDumpPullbackCents}¢`);
  if (s.modelFastRedCents != null) bits.push(`fast-red ${s.modelFastRedCents}¢`);
  if (s.modelMinEntryCents != null) bits.push(`min ${s.modelMinEntryCents}¢`);
  if (s.modelLeanStopBarrierCents != null) bits.push(`barrier ${s.modelLeanStopBarrierCents}¢`);
  if (s.modelLeanStopPaceDrawdownPct != null) bits.push(`pace ${s.modelLeanStopPaceDrawdownPct}%`);
  if (s.modelLeanStopPaceMinSampleSeconds != null) bits.push(`pace ${s.modelLeanStopPaceMinSampleSeconds}s`);
  if (s.modelMinRoomToFloorCents != null) bits.push(`room ${s.modelMinRoomToFloorCents}¢`);
  return bits.join(' · ');
}

function formatSetupScore(score) {
  if (!score || !score.trades) return 'what-if: no matching fills (raw PnL — no skim)';
  const pnl = Number(score.pnlCents) || 0;
  const dollars = `${pnl >= 0 ? '+' : '−'}$${(Math.abs(pnl) / 100).toFixed(2)}`;
  const wr = score.winRatePct != null ? `${score.winRatePct}% WR` : '';
  const worst = score.worstCents < 0 ? ` · worst −$${(Math.abs(score.worstCents) / 100).toFixed(2)}` : '';
  return `what-if ${dollars} · ${score.trades} fills · ${wr}${worst} (raw, no skim)`.replace(/ · $/, '');
}

function formatSetupCapital(capital, { prefix = '' } = {}) {
  if (!capital) return prefix || '';
  const bits = [];
  if (capital.paperAvailableCents != null) {
    bits.push(`avail $${(Number(capital.paperAvailableCents) / 100).toFixed(2)}`);
  }
  bits.push(`wallet $${((Number(capital.reserveCents) || 0) / 100).toFixed(2)}`);
  bits.push(`ins $${((Number(capital.insuranceCents) || 0) / 100).toFixed(2)}`);
  const line = bits.join(' · ');
  return prefix ? `${prefix} · ${line}` : line;
}

function formatShadowScore(shadow, { paused = false } = {}) {
  if (!shadow) return paused ? 'shadow · paused' : '';
  const pnl = Number(shadow.pnlCents) || 0;
  const dollars = `${pnl >= 0 ? '+' : '−'}$${(Math.abs(pnl) / 100).toFixed(2)}`;
  const fills = Number(shadow.trades) || 0;
  const open = Number(shadow.openCount) || 0;
  const wr = shadow.winRatePct != null ? ` · ${shadow.winRatePct}% WR` : '';
  const cap = formatSetupCapital(shadow);
  const capBit = cap ? ` · ${cap}` : '';
  const openBit = open ? ` · ${open} open${shadow.openSymbols ? ` ${shadow.openSymbols}` : ''}` : '';
  const pauseBit = paused ? ' · paused' : '';
  if (!fills && !open) return `shadow · waiting${capBit}${pauseBit}`;
  return `shadow ${dollars} · ${fills} fill${fills === 1 ? '' : 's'}${wr}${capBit}${openBit}${pauseBit}`;
}

function formatLiveBook(live, availDeltaCents = null) {
  if (!live) return 'LIVE book';
  let line = formatSetupCapital(live, { prefix: 'LIVE book' });
  if (availDeltaCents != null && Number(availDeltaCents) !== 0) {
    const d = Number(availDeltaCents);
    line += ` · ${d > 0 ? '+' : '−'}$${(Math.abs(d) / 100).toFixed(2)}`;
  }
  return line;
}

function renderModelAutoSwitchNote(autoSwitch) {
  const el = document.getElementById('bot-model-auto-switch-note');
  if (!el || !autoSwitch) return;
  if (!autoSwitch.enabled) {
    el.textContent = 'Auto-switch off — tap a setup to change live book manually.';
    el.style.color = '';
    return;
  }
  el.textContent = autoSwitch.note || 'Auto-switch on — watches shadow avail when live cash is low.';
  el.style.color = autoSwitch.note && /Auto-switched/i.test(autoSwitch.note) ? 'var(--up)' : '';
}

function renderModelSetups(setups, shadowBooks = null) {
  const list = document.getElementById('bot-model-setups-list');
  if (!list) return;
  const shadowsPaused = !(shadowBooks && shadowBooks.enabled);
  const rows = Array.isArray(setups) ? setups.filter((s) => s.id !== 'all-logged' || (s.score && s.score.trades)) : [];
  if (!rows.length) {
    list.innerHTML = '<p class="settings-hint">Setups load with bot status.</p>';
    return;
  }
  list.innerHTML = rows
    .map((s) => {
      const score = s.score || {};
      const pnl = Number(score.pnlCents) || 0;
      const tone = score.trades ? (pnl > 0 ? 'pos' : pnl < 0 ? 'neg' : '') : '';
      const rec = s.recommended ? ' · recommended' : '';
      const active = s.active ? ' active' : '';
      const coins = escapeHtml(s.autoTradeSymbols || '');
      const shadow = s.shadow;
      const shadowPnl = shadow ? Number(shadow.pnlCents) || 0 : 0;
      const shadowTone =
        shadow && (shadow.trades || shadow.openCount)
          ? shadowPnl > 0
            ? 'pos'
            : shadowPnl < 0
              ? 'neg'
              : ''
          : '';
      const liveOrShadow = s.active
        ? `<span class="setup-shadow live">${escapeHtml(formatLiveBook(s.live, s.availDeltaCents))}</span>`
        : shadow
          ? `<span class="setup-shadow ${shadowTone}">${escapeHtml(
              formatShadowScore(shadow, { paused: shadowsPaused })
            )}${
              !shadowsPaused && s.availDeltaCents != null && s.availDeltaCents > 0
                ? ` · +$${(s.availDeltaCents / 100).toFixed(2)}`
                : ''
            }</span>`
          : '';
      const knobs = formatSetupKnobs(s);
      return `<button type="button" class="model-setup-card${active}" data-setup-id="${escapeHtml(s.id)}">
        <span class="setup-label"><span>${escapeHtml(s.label)}${s.active ? ' · on' : ''}</span><span>${coins}</span></span>
        <span class="setup-why">${escapeHtml(s.why || '')}${rec}</span>
        ${knobs ? `<span class="setup-knobs">${escapeHtml(knobs)}</span>` : ''}
        ${liveOrShadow}
        <span class="setup-score ${tone}">${escapeHtml(formatSetupScore(score))}</span>
      </button>`;
    })
    .join('');
  list.querySelectorAll('[data-setup-id]').forEach((btn) => {
    btn.addEventListener('click', () => applyModelSetup(btn.dataset.setupId));
  });
}

function renderAssetStats(stats, config) {
  const list = document.getElementById('bot-asset-stats-list');
  if (!list) return;
  const rows = Array.isArray(stats) ? stats : [];
  if (!rows.length) {
    list.innerHTML = '<p class="settings-hint">No closed trades yet.</p>';
    return;
  }
  list.innerHTML = rows.map(r => {
    const wrTone = r.winRatePct != null ? (r.winRatePct >= 55 ? 'pos' : r.winRatePct < 40 ? 'neg' : '') : '';
    const pnlDollars = (r.pnlCents / 100).toFixed(2);
    const pnlTone = r.pnlCents > 0 ? 'pos' : r.pnlCents < 0 ? 'neg' : '';
    const shadowTag = '';
    const activeTag = r.active ? ' · live' : r.isShadowOnly ? ' · paper' : '';
    const pinnedLabel = r.pinned ? ' · pinned' : '';
    const excludedLabel = r.excluded ? ' · excl' : '';
    const pinBtn = r.pinned
      ? `<button type="button" class="asset-stat-btn" data-sym="${escapeHtml(r.symbol)}" data-action="unpin">unpin</button>`
      : `<button type="button" class="asset-stat-btn" data-sym="${escapeHtml(r.symbol)}" data-action="pin">pin</button>`;
    const exclBtn = r.excluded
      ? `<button type="button" class="asset-stat-btn" data-sym="${escapeHtml(r.symbol)}" data-action="unexclude">restore</button>`
      : `<button type="button" class="asset-stat-btn" data-sym="${escapeHtml(r.symbol)}" data-action="exclude">exclude</button>`;
    const n = r.displayTrades || 0;
    const w = r.displayWins || 0;
    const l = r.displayLosses || 0;
    return `<div class="asset-stat-row${r.excluded ? ' excluded' : ''}${r.pinned ? ' pinned' : ''}${r.active ? ' active-coin' : ''}">
      <span class="asset-stat-sym">${escapeHtml(r.symbol)}${activeTag}${pinnedLabel}${excludedLabel}${shadowTag}</span>
      <span class="asset-stat-wr ${wrTone}">${r.winRatePct != null ? r.winRatePct + '%' : '—'}</span>
      <span class="asset-stat-pnl ${r.isShadowOnly ? '' : pnlTone}">${r.isShadowOnly ? '—' : (r.pnlCents >= 0 ? '+' : '') + '$' + pnlDollars}</span>
      <span class="asset-stat-n">${n}t · ${w}W/${l}L</span>
      <span class="asset-stat-actions">${pinBtn}${exclBtn}</span>
    </div>`;
  }).join('');
  list.querySelectorAll('[data-action]').forEach(btn => {
    btn.addEventListener('click', () => toggleAssetStatus(btn.dataset.sym, btn.dataset.action, config));
  });
}

async function toggleAssetStatus(symbol, action, config) {
  const { engineUrl } = loadSettings();
  const feedback = document.getElementById('bot-settings-feedback');
  const sym = (symbol || '').toUpperCase();
  const pinned = String(config && config.assetPinnedSymbols || '').split(/[,|\s]+/).map(s => s.trim().toUpperCase()).filter(Boolean);
  const excluded = String(config && config.assetExcludedSymbols || '').split(/[,|\s]+/).map(s => s.trim().toUpperCase()).filter(Boolean);
  const pinnedSet = new Set(pinned);
  const excludedSet = new Set(excluded);
  if (action === 'pin') { pinnedSet.add(sym); excludedSet.delete(sym); }
  else if (action === 'unpin') { pinnedSet.delete(sym); }
  else if (action === 'exclude') { excludedSet.add(sym); pinnedSet.delete(sym); }
  else if (action === 'unexclude') { excludedSet.delete(sym); }
  try {
    const res = await fetch(`${engineUrl}/api/bot/config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        assetPinnedSymbols: [...pinnedSet].join(','),
        assetExcludedSymbols: [...excludedSet].join(','),
      }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    if (feedback) { feedback.textContent = `${sym} ${action}d.`; feedback.style.color = 'var(--up)'; }
    await refreshBotStatus();
  } catch (err) {
    if (feedback) { feedback.textContent = err.message; feedback.style.color = 'var(--down)'; }
  }
}

function renderActiveSetupBanner(setups, config) {
  const labelEl = document.getElementById('bot-active-setup-label');
  const coinsEl = document.getElementById('bot-active-setup-coins');
  const whyEl   = document.getElementById('bot-active-setup-why');
  const sel     = document.getElementById('bot-active-setup-select');
  if (!labelEl || !sel) return;

  const rows = Array.isArray(setups) ? setups.filter((s) => s.id !== 'all-logged') : [];
  const activeId = config && config.activeSetupId ? String(config.activeSetupId) : 'core';
  const active = rows.find((s) => s.id === activeId) || rows[0];

  // Update banner text
  if (active) {
    labelEl.textContent = active.label || active.id;
    if (coinsEl) coinsEl.textContent = active.autoTradeSymbols ? `· ${active.autoTradeSymbols}` : '';
    if (whyEl)   whyEl.textContent   = active.why || '';
  } else {
    labelEl.textContent = activeId;
    if (coinsEl) coinsEl.textContent = '';
    if (whyEl)   whyEl.textContent   = '';
  }

  // Rebuild the select options once (or sync selection if already populated)
  const currentIds = Array.from(sel.options).map((o) => o.value).filter(Boolean);
  const newIds = rows.map((s) => s.id);
  const needsRebuild = currentIds.join(',') !== newIds.join(',');
  if (needsRebuild) {
    sel.innerHTML = '<option value="">— select —</option>' +
      rows.map((s) => `<option value="${escapeHtml(s.id)}">${escapeHtml(s.label || s.id)} · ${escapeHtml(s.autoTradeSymbols || '')}</option>`).join('');
    // Wire the change handler once
    sel.addEventListener('change', () => {
      const id = sel.value;
      if (id) {
        sel.value = '';  // reset so it re-triggers next time
        applyModelSetup(id);
      }
    });
  }
  // Sync current value (show nothing selected — banner already shows it)
  sel.value = '';
}

async function refreshCommodityCandles() {
  const { engineUrl } = loadSettings();
  const btn = document.getElementById('bot-commodity-fetch-candles');
  const status = document.getElementById('bot-commodity-fetch-status');
  if (btn) { btn.disabled = true; btn.textContent = '⟳ Fetching…'; }
  if (status) { status.style.display = ''; status.style.color = 'var(--wait)'; status.textContent = 'Fetching from Polygon…'; }
  try {
    const res = await fetch(`${engineUrl}/api/bot/refresh-commodity-candles`, { method: 'POST' });
    const data = await res.json().catch(() => ({}));
    if (status) {
      status.textContent = data.message || (data.ok ? 'Done.' : 'Failed.');
      status.style.color = data.ok ? 'var(--up)' : 'var(--down)';
    }
  } catch (err) {
    if (status) { status.textContent = err.message; status.style.color = 'var(--down)'; }
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '⟳ Fetch candles now'; }
  }
}

async function applyModelSetup(setupId) {
  if (!setupId || setupId === 'all-logged') return;
  if (isBotSettingsLocked()) {
    const feedback = document.getElementById('bot-settings-feedback');
    if (feedback) {
      feedback.textContent = 'Unlock settings first, then tap a setup.';
      feedback.style.color = 'var(--wait)';
    }
    return;
  }
  const { engineUrl } = loadSettings();
  const feedback = document.getElementById('bot-settings-feedback');
  try {
    const res = await fetch(`${engineUrl}/api/bot/setup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ setupId }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.ok === false) {
      if (feedback) {
        feedback.textContent = data.message || `Could not apply setup (${res.status}).`;
        feedback.style.color = 'var(--down)';
      }
      return;
    }
    if (feedback) {
      feedback.textContent = data.message || 'Setup applied.';
      feedback.style.color = 'var(--up)';
    }
    renderModelSetups(data.setups);
    renderActiveSetupBanner(data.setups, data.config || { activeSetupId: setupId });
    await loadBotConfigIntoForm();
  } catch (err) {
    if (feedback) {
      feedback.textContent = err.message || 'Could not apply setup.';
      feedback.style.color = 'var(--down)';
    }
  }
}

function setBotStrategyTab(mode) {
  const raw = String(mode || '').toLowerCase();
  const strategy = raw === 'settle' || raw === 'model' ? raw : 'edge';
  const hidden = document.getElementById('bot-strategy-mode');
  if (hidden) hidden.value = strategy;
  document.querySelectorAll('.bot-strategy-tab').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.strategy === strategy);
  });
  const edgePanel = document.getElementById('bot-settings-edge');
  const settlePanel = document.getElementById('bot-settings-settle');
  const modelPanel = document.getElementById('bot-settings-model');
  if (edgePanel) edgePanel.hidden = strategy !== 'edge';
  if (settlePanel) settlePanel.hidden = strategy !== 'settle';
  if (modelPanel) modelPanel.hidden = strategy !== 'model';
  syncSettleExitTableEnabled();
}

/** Fallback if API omits tiers (offline / old deploy). Keep in sync with bot SETTLE_EXIT_TIERS. */
const SETTLE_EXIT_TIERS_FALLBACK = [
  { entryLabel: '≥90¢', aimLabel: 'hold to settle', staleLabel: '—' },
  { entryLabel: '85–89¢', aimLabel: '96¢', staleLabel: '≤2m left' },
  { entryLabel: '80–84¢', aimLabel: '94¢', staleLabel: '≤2.5m left' },
  { entryLabel: '75–79¢', aimLabel: '93¢', staleLabel: '≤3m left' },
  { entryLabel: '70–74¢ (late)', aimLabel: '88¢', staleLabel: '≤2.5m left' },
  { entryLabel: '<70¢ (late)', aimLabel: '85¢', staleLabel: '≤4m left' },
];

function renderSettleExitTable(tiers) {
  const body = document.getElementById('settle-exit-table-body');
  if (!body) return;
  const rows = Array.isArray(tiers) && tiers.length ? tiers : SETTLE_EXIT_TIERS_FALLBACK;
  body.innerHTML = rows
    .map(
      (t) =>
        `<tr><td>${escapeHtml(t.entryLabel || '')}</td><td>${escapeHtml(t.aimLabel || '')}</td><td>${escapeHtml(t.staleLabel || '')}</td></tr>`
    )
    .join('');
  syncSettleExitTableEnabled();
}

function renderSettleExitTableNote(config) {
  const note = document.getElementById('settle-exit-table-note');
  if (!note) return;
  note.textContent =
    'Live from bot tiers. After a trade’s bid tags 90¢, stuck/stale turn off and it rides settlement even if price dips back under 90 (stop still applies). Tier TP (e.g. 96¢) can still bank if hit.';
}

function syncSettleExitTableEnabled() {
  const wrap = document.getElementById('settle-exit-table-wrap');
  const tiered = document.getElementById('bot-settle-tiered');
  if (!wrap) return;
  const off = tiered && tiered.value === 'off';
  wrap.classList.toggle('is-disabled', !!off);
}

function wireBotStrategyTabs() {
  document.querySelectorAll('.bot-strategy-tab').forEach((btn) => {
    btn.addEventListener('click', () => {
      setBotStrategyTab(btn.dataset.strategy);
      scheduleAutoSaveBotConfig();
    });
  });
}

function updateSliderDisplay(id) {
  const input = document.getElementById(id);
  const display = document.getElementById(`${id}-value`);
  if (!input || !display) return;
  const formatter = SLIDER_UNITS[id];
  display.textContent = formatter ? formatter(input.value) : input.value;
}

function updateSkimSliderDisplay() {
  const mode = document.getElementById('bot-skim-mode').value;
  const input = document.getElementById('bot-skim-amount');
  const display = document.getElementById('bot-skim-amount-value');
  const label = document.getElementById('bot-skim-amount-label');
  const hint = document.getElementById('bot-skim-hint');
  if (!input || !display) return;
  if (mode === 'insurance') {
    input.min = '1';
    input.max = '50';
    display.textContent = `$${Math.round(input.value)} arm`;
    if (hint) {
      hint.textContent =
        'Each win: 20% → Insurance, 40% → Wallet, 40% → Available. Arms at this amount; stays usable down to the $6 floor. Soft fill ceiling $15 — excess 20% skim → Available (fund stays as cushion). Below floor, Available takes losses until re-armed.';
    }
    if (label) label.querySelector('span.field-hint') || hint;
  } else if (mode === 'percent') {
    input.min = '0';
    input.max = '100';
    display.textContent = `${Math.round(input.value)}%`;
    if (hint) hint.textContent = 'Percent of each win → Reserved (locked). Rest stays in Available. Losses do not draw Reserved.';
  } else if (mode === 'off') {
    display.textContent = 'off';
    if (hint) hint.textContent = 'No skim — full win/loss hits Available Cash.';
  } else {
    input.min = '0';
    input.max = '100';
    display.textContent = `$${Math.round(input.value)}`;
    if (hint) hint.textContent = 'Fixed dollar skim per win → Reserved (locked), capped at that trade’s profit.';
  }
}

function formatSkimLabel(config) {
  if (!config || config.skimMode === 'off') return 'skim off';
  if (config.skimMode === 'insurance') {
    const cap = config.insuranceCapDollars != null ? config.insuranceCapDollars : 10;
    const floor = config.insuranceFloorDollars != null ? config.insuranceFloorDollars : 6;
    const overflow = config.insuranceOverflowDollars != null ? config.insuranceOverflowDollars : 15;
    return `insurance 20/40/40 · arm $${cap} / floor $${floor} / overflow $${overflow}`;
  }
  if (config.skimMode === 'percent') return `skim ${config.skimPercent}% of each win → Wallet`;
  return `skim $${Number(config.skimFixedDollars || 0).toFixed(0)} per win → Wallet`;
}

function wireSliderDisplays() {
  [
    'bot-edge',
    'bot-confidence',
    'bot-stoploss',
    'bot-stoprecovery',
    'bot-takeprofit',
    'bot-minentries',
    'bot-model-confidence',
    'bot-model-live-favor',
    'bot-model-min-entry-lean',
    'bot-model-lean-skip-above',
    'bot-model-min-entry-lean-sol',
    'bot-model-min-entry-lean-btc',
    'bot-model-min-entry-lean-eth',
    'bot-model-min-entry-lean-xrp',
    'bot-model-min-entry-lean-doge',
    'bot-model-min-entry-lean-bnb',
    'bot-model-min-entry-lean-near',
    'bot-model-min-entry-lean-hype',
    'bot-model-min-entry-lean-gold',
    'bot-model-min-entry-lean-silver',
    'bot-model-min-entry-lean-oil',
    'bot-model-min-entry-lean-natgas',
    'bot-model-min-entry-lean-copper',
    'bot-commodity-min-entry',
    'bot-commodity-min-entry-gold',
    'bot-commodity-min-entry-silver',
    'bot-commodity-min-entry-oil',
    'bot-commodity-min-entry-natgas',
    'bot-commodity-min-entry-copper',
    'bot-commodity-max-entry',
    'bot-commodity-stake-gold',
    'bot-commodity-stake-silver',
    'bot-commodity-stake-oil',
    'bot-commodity-stake-natgas',
    'bot-commodity-stake-copper',
    'bot-commodity-stop-gold',
    'bot-commodity-stop-silver',
    'bot-commodity-stop-oil',
    'bot-commodity-stop-natgas',
    'bot-commodity-stop-copper',
    'bot-commodity-tp-gold',
    'bot-commodity-tp-silver',
    'bot-commodity-tp-oil',
    'bot-commodity-tp-natgas',
    'bot-commodity-tp-copper',
    'bot-commodity-trail-gold',
    'bot-commodity-trail-silver',
    'bot-commodity-trail-oil',
    'bot-commodity-trail-natgas',
    'bot-commodity-trail-copper',
    'bot-model-signal-dom',
    'bot-model-confirm-cross',
    'bot-model-confirm-ext',
    'bot-model-min-entry',
    'bot-model-min-room-floor',
    'bot-model-low-ask-conf',
    'bot-model-max-entry',
    'bot-model-bank-green',
    'bot-model-near-target-bank',
    'bot-model-stall-sec',
    'bot-model-stagnation-sec',
    'bot-model-stagnation-sensitivity',
    'bot-model-be-chase-sec',
    'bot-model-no-progress-sec',
    'bot-model-no-progress-pct',
    'bot-model-no-progress-arm',
    'bot-model-trail-cents',
    'bot-model-max-adverse',
    'bot-model-underwater-window',
    'bot-model-underwater-ratio',
    'bot-model-rapid-adverse',
    'bot-model-open-grace-ms',
    'bot-model-prob-drift',
    'bot-model-live-lean-margin',
    'bot-model-decay-drop',
    'bot-model-decay-stall',
    'bot-model-decay-floor',
    'bot-model-min-open',
    'bot-model-max-open',
    'bot-model-peak-touch-tp',
    'bot-model-peak-touch-window',
    'bot-model-entry-momentum-block',
    'bot-model-settle-close',
    'bot-model-late-barrier',
    'bot-commodity-settle-close',
    'bot-commodity-late-barrier',
    'bot-model-preclose-force',
    'bot-model-late-exit-max-loss',
    'bot-model-lean-floor-drop',
    'bot-model-lean-floor-scale',
    'bot-model-max-loss',
    'bot-model-hard-floor',
    'bot-model-pace-drawdown',
    'bot-model-pace-sample',
    'bot-model-rich-floor',
    'bot-model-late-extend-conf',
    'bot-model-sitout',
    'bot-model-global-sitout',
    'bot-asset-auto-exclude-min-trades',
    'bot-asset-auto-exclude-floor',
    'bot-asset-auto-exclude-ceiling',
    'bot-asset-stats-lookback',
    'bot-settle-min',
    'bot-settle-max',
    'bot-settle-stoploss',
    'bot-settle-maxmin',
    'bot-settle-cooldown',
    'bot-settle-late-min',
    'bot-settle-late-floor',
    'bot-settle-stuck',
    'bot-stake',
    'bot-maxpos',
    'bot-paper-balance',
  ].forEach((id) => {
    const input = document.getElementById(id);
    if (input) input.addEventListener('input', () => updateSliderDisplay(id));
  });
  const skimAmount = document.getElementById('bot-skim-amount');
  if (skimAmount) skimAmount.addEventListener('input', updateSkimSliderDisplay);
  const skimMode = document.getElementById('bot-skim-mode');
  if (skimMode) {
    skimMode.addEventListener('change', () => {
      const input = document.getElementById('bot-skim-amount');
      if (input && skimMode.value === 'insurance' && (Number(input.value) < 1 || Number(input.value) > 50)) {
        input.value = 10;
      }
      if (input && skimMode.value === 'percent' && Number(input.value) === 5) input.value = 50;
      if (input && skimMode.value === 'percent' && Number(input.value) === 10 && input.max === '50') input.value = 50;
      if (input && skimMode.value === 'fixed' && Number(input.value) === 50) input.value = 5;
      if (input && skimMode.value === 'fixed' && Number(input.value) === 10) input.value = 5;
      updateSkimSliderDisplay();
    });
  }
}

let botFormHydrating = false;
let botAutoSaveTimer = null;
const BOT_SETTINGS_LOCK_KEY = 'botSettingsLocked';

function isBotSettingsLocked() {
  try {
    return localStorage.getItem(BOT_SETTINGS_LOCK_KEY) === '1';
  } catch {
    return false;
  }
}

function setBotSettingsLocked(locked) {
  try {
    localStorage.setItem(BOT_SETTINGS_LOCK_KEY, locked ? '1' : '0');
  } catch {
    // ignore quota / private mode
  }
  applyBotSettingsLockUi();
}

function applyBotSettingsLockUi() {
  const locked = isBotSettingsLocked();
  const fields = document.getElementById('bot-settings-fields');
  if (fields) fields.classList.toggle('is-locked', locked);
  const btn = document.getElementById('bot-settings-lock');
  if (btn) {
    btn.setAttribute('aria-pressed', locked ? 'true' : 'false');
    btn.textContent = locked ? 'Locked — tap to edit' : 'Lock settings';
  }
  if (fields) {
    fields.querySelectorAll('input, select, button.bot-strategy-tab').forEach((el) => {
      if (el.id === 'bot-strategy-mode') return;
      el.disabled = locked;
    });
  }
  const saveBtn = document.getElementById('bot-settings-save');
  if (saveBtn) saveBtn.disabled = locked;
}

function wireBotSettingsLock() {
  const btn = document.getElementById('bot-settings-lock');
  if (!btn || btn.dataset.wired === '1') return;
  btn.dataset.wired = '1';
  // Default locked so a redeploy can't leave sliders naked for a sleepy bump.
  if (localStorage.getItem(BOT_SETTINGS_LOCK_KEY) == null) {
    setBotSettingsLocked(true);
  } else {
    applyBotSettingsLockUi();
  }
  btn.addEventListener('click', () => {
    setBotSettingsLocked(!isBotSettingsLocked());
  });
}

function scheduleAutoSaveBotConfig() {
  if (botFormHydrating || isBotSettingsLocked()) return;
  clearTimeout(botAutoSaveTimer);
  botAutoSaveTimer = setTimeout(() => {
    if (isBotSettingsLocked()) return;
    saveBotConfig({ auto: true });
  }, 700);
}

function wireBotConfigAutoSave() {
  const ids = [
    'bot-symbol',
    'bot-edge',
    'bot-confidence',
    'bot-stoploss',
    'bot-stoprecovery',
    'bot-takeprofit',
    'bot-minentries',
    'bot-model-confidence',
    'bot-model-live-favor',
    'bot-model-min-entry-lean',
    'bot-model-lean-skip-above',
    'bot-model-min-entry-lean-sol',
    'bot-model-min-entry-lean-btc',
    'bot-model-min-entry-lean-eth',
    'bot-model-min-entry-lean-xrp',
    'bot-model-min-entry-lean-doge',
    'bot-model-min-entry-lean-bnb',
    'bot-model-min-entry-lean-near',
    'bot-model-min-entry-lean-hype',
    'bot-model-min-entry-lean-gold',
    'bot-model-min-entry-lean-silver',
    'bot-model-min-entry-lean-oil',
    'bot-model-min-entry-lean-natgas',
    'bot-model-min-entry-lean-copper',
    'bot-commodity-stake-gold',
    'bot-commodity-min-entry',
    'bot-commodity-min-entry-gold',
    'bot-commodity-min-entry-silver',
    'bot-commodity-min-entry-oil',
    'bot-commodity-min-entry-natgas',
    'bot-commodity-min-entry-copper',
    'bot-commodity-max-entry',
    'bot-commodity-stake-silver',
    'bot-commodity-stake-oil',
    'bot-commodity-stake-natgas',
    'bot-commodity-stake-copper',
    'bot-commodity-stop-gold',
    'bot-commodity-stop-silver',
    'bot-commodity-stop-oil',
    'bot-commodity-stop-natgas',
    'bot-commodity-stop-copper',
    'bot-commodity-tp-gold',
    'bot-commodity-tp-silver',
    'bot-commodity-tp-oil',
    'bot-commodity-tp-natgas',
    'bot-commodity-tp-copper',
    'bot-commodity-trail-gold',
    'bot-commodity-trail-silver',
    'bot-commodity-trail-oil',
    'bot-commodity-trail-natgas',
    'bot-commodity-trail-copper',
    'bot-model-signal-dom',
    'bot-model-confirm-cross',
    'bot-model-confirm-ext',
    'bot-model-min-entry',
    'bot-model-min-room-floor',
    'bot-model-low-ask-conf',
    'bot-model-max-entry',
    'bot-model-bank-green',
    'bot-model-near-target-bank',
    'bot-model-stall-sec',
    'bot-model-stagnation-sec',
    'bot-model-stagnation-sensitivity',
    'bot-model-be-chase-sec',
    'bot-model-no-progress-sec',
    'bot-model-no-progress-pct',
    'bot-model-no-progress-arm',
    'bot-model-trail-cents',
    'bot-model-max-adverse',
    'bot-model-underwater-window',
    'bot-model-underwater-ratio',
    'bot-model-rapid-adverse',
    'bot-model-open-grace-ms',
    'bot-model-prob-drift',
    'bot-model-live-lean-margin',
    'bot-model-decay-drop',
    'bot-model-decay-stall',
    'bot-model-decay-floor',
    'bot-model-min-open',
    'bot-model-max-open',
    'bot-model-peak-touch-tp',
    'bot-model-peak-touch-window',
    'bot-model-entry-momentum-block',
    'bot-model-settle-close',
    'bot-model-late-barrier',
    'bot-commodity-settle-close',
    'bot-commodity-late-barrier',
    'bot-model-preclose-force',
    'bot-model-late-exit-max-loss',
    'bot-model-lean-floor-drop',
    'bot-model-lean-floor-scale',
    'bot-model-sitout',
    'bot-model-global-sitout',
    'bot-asset-auto-exclude-min-trades',
    'bot-asset-auto-exclude-floor',
    'bot-asset-auto-exclude-ceiling',
    'bot-asset-stats-lookback',
    'bot-settle-min',
    'bot-settle-max',
    'bot-settle-stoploss',
    'bot-settle-maxmin',
    'bot-settle-cooldown',
    'bot-settle-late-min',
    'bot-settle-late-floor',
    'bot-settle-stuck',
    'bot-stake',
    'bot-maxpos',
    'bot-paper-balance',
    'bot-skim-mode',
    'bot-skim-amount',
  ];
  for (const id of ids) {
    const el = document.getElementById(id);
    if (!el) continue;
    el.addEventListener('change', scheduleAutoSaveBotConfig);
    if (el.tagName === 'INPUT') el.addEventListener('input', scheduleAutoSaveBotConfig);
  }
  for (const id of [
    'bot-settle-tiered',
    'bot-half-stake-near',
    'bot-second-green',
    'bot-model-invert',
    'bot-model-auto-switch',
    'bot-asset-auto-exclude',
    'bot-symbol',
    'bot-strategy-mode',
  ]) {
    const el = document.getElementById(id);
    if (el) el.addEventListener('change', scheduleAutoSaveBotConfig);
  }
  const autoCoins = document.getElementById('bot-auto-coins');
  if (autoCoins) {
    autoCoins.addEventListener('change', scheduleAutoSaveBotConfig);
  }
  const settleTieredEl = document.getElementById('bot-settle-tiered');
  if (settleTieredEl) settleTieredEl.addEventListener('change', syncSettleExitTableEnabled);
}

function updateSettingsJson(config) {
  const pre = document.getElementById('bot-settings-json');
  if (!pre) return;
  pre.textContent = JSON.stringify(config, null, 2);
}

async function loadBotConfigIntoForm() {
  const { engineUrl } = loadSettings();
  botFormHydrating = true;
  try {
    const res = await fetch(`${engineUrl}/api/bot/config`, { cache: 'no-store' });
    if (!res.ok) return;
    const data = await res.json();
    const c = data.config;
    updateSettingsJson(c);
    renderSettleExitTable(data.settleExitTiers);
    renderSettleExitTableNote(c);
    document.getElementById('bot-symbol').value = c.symbol;
    setBotStrategyTab(c.strategyMode || 'model');
    const backtestSymbol = document.getElementById('backtest-symbol');
    if (backtestSymbol && [...backtestSymbol.options].some((o) => o.value === c.symbol)) {
      backtestSymbol.value = c.symbol;
    }
    document.getElementById('bot-edge').value = c.edgeThresholdPct;
    document.getElementById('bot-confidence').value = c.minConfidence;
    document.getElementById('bot-stoploss').value = c.stopLossCents;
    const stopRecEl = document.getElementById('bot-stoprecovery');
    if (stopRecEl) stopRecEl.value = c.stopRecoveryCents != null ? c.stopRecoveryCents : 6;
    document.getElementById('bot-takeprofit').value = c.takeProfitCents != null ? c.takeProfitCents : 15;
    document.getElementById('bot-minentries').value = c.minEntryCents != null ? c.minEntryCents : 40;
    const modelInvert = document.getElementById('bot-model-invert');
    if (modelInvert) {
      const on =
        c.modelInvertSide === true ||
        c.modelInvertSide === 1 ||
        c.modelInvertSide === 'on' ||
        c.modelInvertSide === 'true';
      modelInvert.value = on ? 'on' : 'off';
    }
    const modelAutoSwitch = document.getElementById('bot-model-auto-switch');
    if (modelAutoSwitch) {
      const on =
        c.modelAutoSwitchSetup === true ||
        c.modelAutoSwitchSetup === 1 ||
        c.modelAutoSwitchSetup === 'on' ||
        c.modelAutoSwitchSetup === 'true';
      modelAutoSwitch.value = on ? 'on' : 'off';
    }
    const modelShadowBooks = document.getElementById('bot-model-shadow-books');
    if (modelShadowBooks) {
      const on =
        c.modelShadowBooks === true ||
        c.modelShadowBooks === 1 ||
        c.modelShadowBooks === 'on' ||
        c.modelShadowBooks === 'true';
      modelShadowBooks.value = on ? 'on' : 'off';
    }
    const modelConf = document.getElementById('bot-model-confidence');
    if (modelConf) modelConf.value = c.modelMinConfidence != null ? c.modelMinConfidence : 55;
    const modelLiveFavor = document.getElementById('bot-model-live-favor');
    if (modelLiveFavor) {
      modelLiveFavor.value =
        c.modelEntryLiveLeanMarginPct != null ? c.modelEntryLiveLeanMarginPct : 2;
    }
    const softLeanDisplay = document.getElementById('bot-model-soft-lean-value');
    if (softLeanDisplay) {
      const v = c.modelSoftLeanMarginPct != null ? c.modelSoftLeanMarginPct : 3;
      softLeanDisplay.textContent = v + ' pts';
      softLeanDisplay.dataset.value = v;
    }
    const modelLeanSkipAbove = document.getElementById('bot-model-lean-skip-above');
    if (modelLeanSkipAbove) modelLeanSkipAbove.value = c.modelLeanSkipAboveCents != null ? c.modelLeanSkipAboveCents : 0;
    const modelMinEntryLean = document.getElementById('bot-model-min-entry-lean');
    if (modelMinEntryLean) {
      modelMinEntryLean.value =
        c.modelMinEntryLeanPct != null ? c.modelMinEntryLeanPct : 65;
    }
    const modelMinEntryLeanSOL = document.getElementById('bot-model-min-entry-lean-sol');
    if (modelMinEntryLeanSOL) {
      modelMinEntryLeanSOL.value = c.modelMinEntryLeanPctSOL != null ? c.modelMinEntryLeanPctSOL : 0;
    }
    const modelMinEntryLeanBTC = document.getElementById('bot-model-min-entry-lean-btc');
    if (modelMinEntryLeanBTC) {
      modelMinEntryLeanBTC.value = c.modelMinEntryLeanPctBTC != null ? c.modelMinEntryLeanPctBTC : 0;
    }
    const modelMinEntryLeanETH = document.getElementById('bot-model-min-entry-lean-eth');
    if (modelMinEntryLeanETH) {
      modelMinEntryLeanETH.value = c.modelMinEntryLeanPctETH != null ? c.modelMinEntryLeanPctETH : 0;
    }
    const modelMinEntryLeanXRP = document.getElementById('bot-model-min-entry-lean-xrp');
    if (modelMinEntryLeanXRP) {
      modelMinEntryLeanXRP.value = c.modelMinEntryLeanPctXrp != null ? c.modelMinEntryLeanPctXrp : 0;
    }
    const modelMinEntryLeanDOGE = document.getElementById('bot-model-min-entry-lean-doge');
    if (modelMinEntryLeanDOGE) {
      modelMinEntryLeanDOGE.value = c.modelMinEntryLeanPctDoge != null ? c.modelMinEntryLeanPctDoge : 0;
    }
    const modelMinEntryLeanBNB = document.getElementById('bot-model-min-entry-lean-bnb');
    if (modelMinEntryLeanBNB) {
      modelMinEntryLeanBNB.value = c.modelMinEntryLeanPctBnb != null ? c.modelMinEntryLeanPctBnb : 0;
    }
    const modelMinEntryLeanNEAR = document.getElementById('bot-model-min-entry-lean-near');
    if (modelMinEntryLeanNEAR) {
      modelMinEntryLeanNEAR.value = c.modelMinEntryLeanPctNear != null ? c.modelMinEntryLeanPctNear : 0;
    }
    const modelMinEntryLeanHYPE = document.getElementById('bot-model-min-entry-lean-hype');
    if (modelMinEntryLeanHYPE) {
      modelMinEntryLeanHYPE.value = c.modelMinEntryLeanPctHype != null ? c.modelMinEntryLeanPctHype : 0;
    }
    const modelMinEntryLeanGOLD = document.getElementById('bot-model-min-entry-lean-gold');
    if (modelMinEntryLeanGOLD) {
      modelMinEntryLeanGOLD.value = c.modelMinEntryLeanPctGold != null ? c.modelMinEntryLeanPctGold : 0;
    }
    const modelMinEntryLeanSILVER = document.getElementById('bot-model-min-entry-lean-silver');
    if (modelMinEntryLeanSILVER) {
      modelMinEntryLeanSILVER.value = c.modelMinEntryLeanPctSilver != null ? c.modelMinEntryLeanPctSilver : 0;
    }
    const modelMinEntryLeanOIL = document.getElementById('bot-model-min-entry-lean-oil');
    if (modelMinEntryLeanOIL) {
      modelMinEntryLeanOIL.value = c.modelMinEntryLeanPctOil != null ? c.modelMinEntryLeanPctOil : 0;
    }
    const modelMinEntryLeanNATGAS = document.getElementById('bot-model-min-entry-lean-natgas');
    if (modelMinEntryLeanNATGAS) modelMinEntryLeanNATGAS.value = c.modelMinEntryLeanPctNatgas != null ? c.modelMinEntryLeanPctNatgas : 0;
    const modelMinEntryLeanCOPPER = document.getElementById('bot-model-min-entry-lean-copper');
    if (modelMinEntryLeanCOPPER) modelMinEntryLeanCOPPER.value = c.modelMinEntryLeanPctCopper != null ? c.modelMinEntryLeanPctCopper : 0;
    // Commodity overrides
    const commodityMinEntry = document.getElementById('bot-commodity-min-entry');
    if (commodityMinEntry) commodityMinEntry.value = c.commodityMinEntryCents != null ? c.commodityMinEntryCents : 0;
    const commodityMinEntryGold = document.getElementById('bot-commodity-min-entry-gold');
    if (commodityMinEntryGold) commodityMinEntryGold.value = c.commodityMinEntryCentsGold != null ? c.commodityMinEntryCentsGold : 0;
    const commodityMinEntrySilver = document.getElementById('bot-commodity-min-entry-silver');
    if (commodityMinEntrySilver) commodityMinEntrySilver.value = c.commodityMinEntryCentsSilver != null ? c.commodityMinEntryCentsSilver : 0;
    const commodityMinEntryOil = document.getElementById('bot-commodity-min-entry-oil');
    if (commodityMinEntryOil) commodityMinEntryOil.value = c.commodityMinEntryCentsOil != null ? c.commodityMinEntryCentsOil : 0;
    const commodityMinEntryNatgas = document.getElementById('bot-commodity-min-entry-natgas');
    if (commodityMinEntryNatgas) commodityMinEntryNatgas.value = c.commodityMinEntryCentsNatgas != null ? c.commodityMinEntryCentsNatgas : 0;
    const commodityMinEntryCopper = document.getElementById('bot-commodity-min-entry-copper');
    if (commodityMinEntryCopper) commodityMinEntryCopper.value = c.commodityMinEntryCentsCopper != null ? c.commodityMinEntryCentsCopper : 0;
    const commodityMaxEntry = document.getElementById('bot-commodity-max-entry');
    if (commodityMaxEntry) commodityMaxEntry.value = c.commodityMaxEntryCents != null ? c.commodityMaxEntryCents : 0;
    const commodityStakeGold = document.getElementById('bot-commodity-stake-gold');
    if (commodityStakeGold) commodityStakeGold.value = c.commodityStakeDollarsGold != null ? c.commodityStakeDollarsGold : 0;
    const commodityStakeSilver = document.getElementById('bot-commodity-stake-silver');
    if (commodityStakeSilver) commodityStakeSilver.value = c.commodityStakeDollarsSilver != null ? c.commodityStakeDollarsSilver : 0;
    const commodityStakeOil = document.getElementById('bot-commodity-stake-oil');
    if (commodityStakeOil) commodityStakeOil.value = c.commodityStakeDollarsOil != null ? c.commodityStakeDollarsOil : 0;
    const commodityStakeNatgas = document.getElementById('bot-commodity-stake-natgas');
    if (commodityStakeNatgas) commodityStakeNatgas.value = c.commodityStakeDollarsNatgas != null ? c.commodityStakeDollarsNatgas : 0;
    const commodityStakeCopper = document.getElementById('bot-commodity-stake-copper');
    if (commodityStakeCopper) commodityStakeCopper.value = c.commodityStakeDollarsCopper != null ? c.commodityStakeDollarsCopper : 0;
    const commodityStopGold = document.getElementById('bot-commodity-stop-gold');
    if (commodityStopGold) commodityStopGold.value = c.commodityStopCentsGold != null ? c.commodityStopCentsGold : 0;
    const commodityStopSilver = document.getElementById('bot-commodity-stop-silver');
    if (commodityStopSilver) commodityStopSilver.value = c.commodityStopCentsSilver != null ? c.commodityStopCentsSilver : 0;
    const commodityStopOil = document.getElementById('bot-commodity-stop-oil');
    if (commodityStopOil) commodityStopOil.value = c.commodityStopCentsOil != null ? c.commodityStopCentsOil : 0;
    const commodityStopNatgas = document.getElementById('bot-commodity-stop-natgas');
    if (commodityStopNatgas) commodityStopNatgas.value = c.commodityStopCentsNatgas != null ? c.commodityStopCentsNatgas : 0;
    const commodityStopCopper = document.getElementById('bot-commodity-stop-copper');
    if (commodityStopCopper) commodityStopCopper.value = c.commodityStopCentsCopper != null ? c.commodityStopCentsCopper : 0;
    const commodityTpGold = document.getElementById('bot-commodity-tp-gold');
    if (commodityTpGold) commodityTpGold.value = c.commodityTpCentsGold != null ? c.commodityTpCentsGold : 0;
    const commodityTpSilver = document.getElementById('bot-commodity-tp-silver');
    if (commodityTpSilver) commodityTpSilver.value = c.commodityTpCentsSilver != null ? c.commodityTpCentsSilver : 0;
    const commodityTpOil = document.getElementById('bot-commodity-tp-oil');
    if (commodityTpOil) commodityTpOil.value = c.commodityTpCentsOil != null ? c.commodityTpCentsOil : 0;
    const commodityTpNatgas = document.getElementById('bot-commodity-tp-natgas');
    if (commodityTpNatgas) commodityTpNatgas.value = c.commodityTpCentsNatgas != null ? c.commodityTpCentsNatgas : 0;
    const commodityTpCopper = document.getElementById('bot-commodity-tp-copper');
    if (commodityTpCopper) commodityTpCopper.value = c.commodityTpCentsCopper != null ? c.commodityTpCentsCopper : 0;
    const commodityTrailGold = document.getElementById('bot-commodity-trail-gold');
    if (commodityTrailGold) commodityTrailGold.value = c.commodityTrailCentsGold != null ? c.commodityTrailCentsGold : 0;
    const commodityTrailSilver = document.getElementById('bot-commodity-trail-silver');
    if (commodityTrailSilver) commodityTrailSilver.value = c.commodityTrailCentsSilver != null ? c.commodityTrailCentsSilver : 0;
    const commodityTrailOil = document.getElementById('bot-commodity-trail-oil');
    if (commodityTrailOil) commodityTrailOil.value = c.commodityTrailCentsOil != null ? c.commodityTrailCentsOil : 0;
    const commodityTrailNatgas = document.getElementById('bot-commodity-trail-natgas');
    if (commodityTrailNatgas) commodityTrailNatgas.value = c.commodityTrailCentsNatgas != null ? c.commodityTrailCentsNatgas : 0;
    const commodityTrailCopper = document.getElementById('bot-commodity-trail-copper');
    if (commodityTrailCopper) commodityTrailCopper.value = c.commodityTrailCentsCopper != null ? c.commodityTrailCentsCopper : 0;
    const modelSignalDom = document.getElementById('bot-model-signal-dom');
    if (modelSignalDom) {
      const dom =
        c.modelSignalDominanceMin != null ? Number(c.modelSignalDominanceMin) : 0;
      modelSignalDom.value = Math.round(
        Math.max(0, Math.min(3, Number.isFinite(dom) ? dom : 0)) * 10
      );
    }
    const modelConfirmCross = document.getElementById('bot-model-confirm-cross');
    if (modelConfirmCross) {
      modelConfirmCross.value =
        c.modelConfirmCrossCents != null ? c.modelConfirmCrossCents : 0;
    }
    const modelConfirmExt = document.getElementById('bot-model-confirm-ext');
    if (modelConfirmExt) {
      modelConfirmExt.value =
        c.modelConfirmMaxExtensionCents != null ? c.modelConfirmMaxExtensionCents : 15;
    }
    const modelMinEntry = document.getElementById('bot-model-min-entry');
    if (modelMinEntry) modelMinEntry.value = c.modelMinEntryCents != null ? c.modelMinEntryCents : 65;
    const modelMinRoomFloor = document.getElementById('bot-model-min-room-floor');
    if (modelMinRoomFloor) {
      modelMinRoomFloor.value =
        c.modelMinRoomToFloorCents != null ? c.modelMinRoomToFloorCents : 10;
    }
    const modelLowAskConf = document.getElementById('bot-model-low-ask-conf');
    if (modelLowAskConf) {
      modelLowAskConf.value =
        c.modelLowAskMinConfidence != null ? c.modelLowAskMinConfidence : 0;
    }
    const modelMaxEntry = document.getElementById('bot-model-max-entry');
    if (modelMaxEntry) modelMaxEntry.value = c.modelMaxEntryCents != null ? c.modelMaxEntryCents : 88;
    const modelBankGreen = document.getElementById('bot-model-bank-green');
    if (modelBankGreen) modelBankGreen.value = c.modelBankGreenCents != null ? c.modelBankGreenCents : 11;
    const modelNearTargetBank = document.getElementById('bot-model-near-target-bank');
    if (modelNearTargetBank) {
      const bank = c.modelBankGreenCents != null ? c.modelBankGreenCents : 11;
      modelNearTargetBank.value =
        c.modelNearTargetBankCents != null ? c.modelNearTargetBankCents : Math.max(3, bank - 3);
    }
    const modelStallSec = document.getElementById('bot-model-stall-sec');
    if (modelStallSec) {
      modelStallSec.value =
        c.modelMomentumStallSeconds != null ? c.modelMomentumStallSeconds : 4;
    }
    const modelStagnationSec = document.getElementById('bot-model-stagnation-sec');
    if (modelStagnationSec) {
      modelStagnationSec.value =
        c.modelStagnationSeconds != null ? c.modelStagnationSeconds : 60;
    }
    const modelStagnationSensitivity = document.getElementById('bot-model-stagnation-sensitivity');
    if (modelStagnationSensitivity) {
      modelStagnationSensitivity.value =
        c.modelStagnationMinProgressCents != null ? c.modelStagnationMinProgressCents : 3;
    }
    const modelBeChaseSec = document.getElementById('bot-model-be-chase-sec');
    if (modelBeChaseSec) {
      modelBeChaseSec.value =
        c.modelBeChaseSeconds != null ? c.modelBeChaseSeconds : 20;
    }
    const modelNoProgressSec = document.getElementById('bot-model-no-progress-sec');
    if (modelNoProgressSec) modelNoProgressSec.value = c.modelNoProgressTightenSeconds != null ? c.modelNoProgressTightenSeconds : 0;
    const modelNoProgressPct = document.getElementById('bot-model-no-progress-pct');
    if (modelNoProgressPct) modelNoProgressPct.value = c.modelNoProgressTightenPct != null ? c.modelNoProgressTightenPct : 80;
    const modelNoProgressArm = document.getElementById('bot-model-no-progress-arm');
    if (modelNoProgressArm) modelNoProgressArm.value = c.modelNoProgressTightenArmCents != null ? c.modelNoProgressTightenArmCents : 15;
    const modelTrailCentsEl = document.getElementById('bot-model-trail-cents');
    if (modelTrailCentsEl) modelTrailCentsEl.value = c.modelTrailCents != null ? c.modelTrailCents : 0;
    const modelMaxAdverse = document.getElementById('bot-model-max-adverse');
    if (modelMaxAdverse) {
      modelMaxAdverse.value = c.modelMaxAdverseCents != null ? c.modelMaxAdverseCents : 0;
    }
    const modelUnderwaterWindow = document.getElementById('bot-model-underwater-window');
    if (modelUnderwaterWindow) {
      modelUnderwaterWindow.value = c.modelUnderwaterWindowSeconds != null ? c.modelUnderwaterWindowSeconds : 90;
    }
    const modelUnderwaterRatio = document.getElementById('bot-model-underwater-ratio');
    if (modelUnderwaterRatio) {
      modelUnderwaterRatio.value = c.modelUnderwaterRatioPct != null ? c.modelUnderwaterRatioPct : 70;
    }
    const modelRapidAdverse = document.getElementById('bot-model-rapid-adverse');
    if (modelRapidAdverse) {
      modelRapidAdverse.value =
        c.modelRapidAdverseCents != null ? c.modelRapidAdverseCents : 0;
    }
    const modelProbDrift = document.getElementById('bot-model-prob-drift');
    if (modelProbDrift) {
      modelProbDrift.value =
        c.modelProbDriftPts != null ? c.modelProbDriftPts : 15;
    }
    const modelLiveLeanMargin = document.getElementById('bot-model-live-lean-margin');
    if (modelLiveLeanMargin) {
      modelLiveLeanMargin.value =
        c.modelLiveLeanMarginPct != null ? c.modelLiveLeanMarginPct : 1;
    }
    const modelDecayDrop = document.getElementById('bot-model-decay-drop');
    if (modelDecayDrop) {
      modelDecayDrop.value = c.modelLeanDecayDropPts != null ? c.modelLeanDecayDropPts : 14;
    }
    const modelDecayStall = document.getElementById('bot-model-decay-stall');
    if (modelDecayStall) {
      modelDecayStall.value = c.modelLeanDecayStallSeconds != null ? c.modelLeanDecayStallSeconds : 6;
    }
    const modelDecayFloor = document.getElementById('bot-model-decay-floor');
    if (modelDecayFloor) {
      modelDecayFloor.value = c.modelLeanDecayFloor != null ? c.modelLeanDecayFloor : 85;
    }
    const modelOpenGraceEl = document.getElementById('bot-model-open-grace-ms');
    if (modelOpenGraceEl) modelOpenGraceEl.value = c.modelOpenGraceMs != null ? c.modelOpenGraceMs : 10000;
    const modelPeakTouchTp = document.getElementById('bot-model-peak-touch-tp');
    if (modelPeakTouchTp) modelPeakTouchTp.value = c.modelPeakTouchTp != null ? c.modelPeakTouchTp : 10;
    const modelPeakTouchWindow = document.getElementById('bot-model-peak-touch-window');
    if (modelPeakTouchWindow) modelPeakTouchWindow.value = c.modelPeakTouchWindow != null ? c.modelPeakTouchWindow : 2;
    const modelEntryMomentumBlock = document.getElementById('bot-model-entry-momentum-block');
    if (modelEntryMomentumBlock) modelEntryMomentumBlock.value = c.modelEntryMomentumBlockPct != null ? c.modelEntryMomentumBlockPct : 0;
    const modelMaxOpen = document.getElementById('bot-model-max-open');
    if (modelMaxOpen) modelMaxOpen.value = c.modelMaxMinutesToOpen != null ? c.modelMaxMinutesToOpen : 0;
    const modelMinOpen = document.getElementById('bot-model-min-open');
    if (modelMinOpen) {
      modelMinOpen.value = c.modelMinMinutesToOpen != null ? c.modelMinMinutesToOpen : 4;
    }
    const modelSettleClose = document.getElementById('bot-model-settle-close');
    if (modelSettleClose) {
      modelSettleClose.value =
        c.modelSettleCloseMinutes != null ? c.modelSettleCloseMinutes : 2.5;
    }
    const modelLateBarrier = document.getElementById('bot-model-late-barrier');
    if (modelLateBarrier) {
      modelLateBarrier.value =
        c.modelLateBarrierMinutes != null ? c.modelLateBarrierMinutes : 2;
    }
    const commoditySettleClose = document.getElementById('bot-commodity-settle-close');
    if (commoditySettleClose) commoditySettleClose.value = c.commoditySettleCloseMinutes != null ? c.commoditySettleCloseMinutes : 0;
    const commodityLateBarrier = document.getElementById('bot-commodity-late-barrier');
    if (commodityLateBarrier) commodityLateBarrier.value = c.commodityLateBarrierMinutes != null ? c.commodityLateBarrierMinutes : 0;
    const modelPreCloseForce = document.getElementById('bot-model-preclose-force');
    if (modelPreCloseForce) {
      modelPreCloseForce.value =
        c.modelPreCloseForceMinutes != null ? c.modelPreCloseForceMinutes : 1;
    }
    const modelLateExitMaxLoss = document.getElementById('bot-model-late-exit-max-loss');
    if (modelLateExitMaxLoss) {
      modelLateExitMaxLoss.value = c.modelLateExitMaxLossCents != null ? c.modelLateExitMaxLossCents : 0;
    }
    const modelLeanFloorDrop = document.getElementById('bot-model-lean-floor-drop');
    if (modelLeanFloorDrop) {
      modelLeanFloorDrop.value = c.modelLeanFloorBaseDrop != null ? c.modelLeanFloorBaseDrop : 0;
    }
    const modelLeanFloorScale = document.getElementById('bot-model-lean-floor-scale');
    if (modelLeanFloorScale) {
      modelLeanFloorScale.value = c.modelLeanFloorScale != null ? c.modelLeanFloorScale : 0.2;
    }
    const modelMaxLoss = document.getElementById('bot-model-max-loss');
    if (modelMaxLoss) modelMaxLoss.value = c.modelMaxLossCents != null ? c.modelMaxLossCents : 0;
    const modelHardFloor = document.getElementById('bot-model-hard-floor');
    if (modelHardFloor) {
      modelHardFloor.value =
        c.modelHardStopFloorCents != null ? c.modelHardStopFloorCents : 55;
    }
    const modelPaceDrawdown = document.getElementById('bot-model-pace-drawdown');
    if (modelPaceDrawdown) {
      modelPaceDrawdown.value =
        c.modelLeanStopPaceDrawdownPct != null ? c.modelLeanStopPaceDrawdownPct : 35;
    }
    const modelPaceSample = document.getElementById('bot-model-pace-sample');
    if (modelPaceSample) {
      modelPaceSample.value =
        c.modelLeanStopPaceMinSampleSeconds != null ? c.modelLeanStopPaceMinSampleSeconds : 8;
    }
    const modelRichFloor = document.getElementById('bot-model-rich-floor');
    if (modelRichFloor) {
      modelRichFloor.value =
        c.modelRichStopFloorCents != null ? c.modelRichStopFloorCents : 0;
    }
    const modelSitout = document.getElementById('bot-model-sitout');
    if (modelSitout) {
      if (c.modelPostExitCooldownSeconds != null && Number.isFinite(Number(c.modelPostExitCooldownSeconds))) {
        modelSitout.value = Math.round(Math.max(0, Number(c.modelPostExitCooldownSeconds)));
      } else {
        const mins =
          c.modelPostExitCooldownMinutes != null ? Number(c.modelPostExitCooldownMinutes) : 45 / 60;
        modelSitout.value = Math.round(Math.max(0, mins * 60));
      }
    }
    const modelGlobalSitout = document.getElementById('bot-model-global-sitout');
    if (modelGlobalSitout) {
      modelGlobalSitout.value =
        c.modelGlobalPostExitCooldownSeconds != null
          ? Math.round(Math.max(0, Number(c.modelGlobalPostExitCooldownSeconds)))
          : 20;
    }
    const assetAutoExclude = document.getElementById('bot-asset-auto-exclude');
    if (assetAutoExclude) {
      const on = c.assetAutoExcludeEnabled === true || c.assetAutoExcludeEnabled === 1 ||
        c.assetAutoExcludeEnabled === 'on' || c.assetAutoExcludeEnabled === 'true';
      assetAutoExclude.value = on ? 'on' : 'off';
    }
    const assetExclMinTrades = document.getElementById('bot-asset-auto-exclude-min-trades');
    if (assetExclMinTrades) assetExclMinTrades.value = c.assetAutoExcludeMinTrades != null ? c.assetAutoExcludeMinTrades : 5;
    const assetExclFloor = document.getElementById('bot-asset-auto-exclude-floor');
    if (assetExclFloor) assetExclFloor.value = c.assetAutoExcludeFloor != null ? c.assetAutoExcludeFloor : 30;
    const assetExclCeiling = document.getElementById('bot-asset-auto-exclude-ceiling');
    if (assetExclCeiling) assetExclCeiling.value = c.assetAutoExcludeCeiling != null ? c.assetAutoExcludeCeiling : 0;
    const assetLookback = document.getElementById('bot-asset-stats-lookback');
    if (assetLookback) assetLookback.value = c.assetStatsLookback != null ? c.assetStatsLookback : 50;
    const settleMin = document.getElementById('bot-settle-min');
    if (settleMin) settleMin.value = c.settleEntryMinCents != null ? c.settleEntryMinCents : 80;
    const settleMax = document.getElementById('bot-settle-max');
    if (settleMax) settleMax.value = c.settleEntryMaxCents != null ? c.settleEntryMaxCents : 94;
    const settleStop = document.getElementById('bot-settle-stoploss');
    if (settleStop) {
      const raw = c.settleStopLossCents != null ? Number(c.settleStopLossCents) : 50;
      settleStop.value = Math.max(8, Math.min(60, Number.isFinite(raw) ? raw : 50));
    }
    const settleMaxMin = document.getElementById('bot-settle-maxmin');
    if (settleMaxMin) settleMaxMin.value = c.settleMaxMinutesToOpen != null ? c.settleMaxMinutesToOpen : 8.5;
    const settleCd = document.getElementById('bot-settle-cooldown');
    if (settleCd) {
      settleCd.value =
        c.settlePostStopSameSideCooldownMinutes != null ? c.settlePostStopSameSideCooldownMinutes : 2.5;
    }
    const settleLateMin = document.getElementById('bot-settle-late-min');
    if (settleLateMin) {
      settleLateMin.value = c.settleLateEntryMinutes != null ? c.settleLateEntryMinutes : 2.5;
    }
    const settleLateFloor = document.getElementById('bot-settle-late-floor');
    if (settleLateFloor) {
      settleLateFloor.value = c.settleLateEntryMinCents != null ? c.settleLateEntryMinCents : 70;
    }
    const settleStuck = document.getElementById('bot-settle-stuck');
    if (settleStuck) {
      settleStuck.value = c.settleStuckHoldMinutes != null ? c.settleStuckHoldMinutes : 3;
    }
    const halfStakeNear = document.getElementById('bot-half-stake-near');
    if (halfStakeNear) {
      const nearOff =
        c.halfStakeNear === false ||
        c.halfStakeNear === 0 ||
        c.halfStakeNear === 'off' ||
        c.halfStakeNear === 'false';
      halfStakeNear.value = nearOff ? 'off' : 'on';
    }
    syncAutoTradeSymbolsToForm(c);
    const settleTiered = document.getElementById('bot-settle-tiered');
    if (settleTiered) {
      const tieredOff =
        c.settleTieredExits === false ||
        c.settleTieredExits === 0 ||
        c.settleTieredExits === 'off' ||
        c.settleTieredExits === 'false';
      settleTiered.value = tieredOff ? 'off' : 'on';
    }
    syncTradingSlidersFromConfig(c);
    document.getElementById('bot-paper-balance').value = c.paperStartingBalanceDollars;
    document.getElementById('bot-skim-mode').value = c.skimMode || 'insurance';
    const skimAmt = document.getElementById('bot-skim-amount');
    if (c.skimMode === 'insurance') {
      skimAmt.value = c.insuranceCapDollars != null ? c.insuranceCapDollars : 10;
    } else if (c.skimMode === 'percent') {
      skimAmt.value = c.skimPercent;
    } else {
      skimAmt.value = c.skimFixedDollars;
    }
    [
      'bot-edge',
      'bot-confidence',
      'bot-stoploss',
      'bot-stoprecovery',
      'bot-takeprofit',
      'bot-minentries',
      'bot-model-confidence',
      'bot-model-live-favor',
      'bot-model-min-entry-lean',
      'bot-model-lean-skip-above',
      'bot-model-min-entry-lean-sol',
      'bot-model-min-entry-lean-btc',
      'bot-model-min-entry-lean-eth',
      'bot-model-min-entry-lean-xrp',
      'bot-model-min-entry-lean-doge',
      'bot-model-min-entry-lean-bnb',
      'bot-model-min-entry-lean-near',
      'bot-model-min-entry-lean-hype',
      'bot-model-min-entry-lean-gold',
      'bot-model-min-entry-lean-silver',
      'bot-model-min-entry-lean-oil',
      'bot-model-min-entry-lean-natgas',
      'bot-model-min-entry-lean-copper',
      'bot-commodity-stake-gold',
      'bot-commodity-min-entry',
      'bot-commodity-min-entry-gold',
      'bot-commodity-min-entry-silver',
      'bot-commodity-min-entry-oil',
      'bot-commodity-min-entry-natgas',
      'bot-commodity-min-entry-copper',
      'bot-commodity-max-entry',
      'bot-commodity-stake-silver',
      'bot-commodity-stake-oil',
      'bot-commodity-stake-natgas',
      'bot-commodity-stake-copper',
      'bot-commodity-stop-gold',
      'bot-commodity-stop-silver',
      'bot-commodity-stop-oil',
      'bot-commodity-stop-natgas',
      'bot-commodity-stop-copper',
      'bot-commodity-tp-gold',
      'bot-commodity-tp-silver',
      'bot-commodity-tp-oil',
      'bot-commodity-tp-natgas',
      'bot-commodity-tp-copper',
      'bot-commodity-trail-gold',
      'bot-commodity-trail-silver',
      'bot-commodity-trail-oil',
      'bot-commodity-trail-natgas',
      'bot-commodity-trail-copper',
      'bot-model-signal-dom',
      'bot-model-confirm-cross',
      'bot-model-confirm-ext',
      'bot-model-min-entry',
    'bot-model-min-room-floor',
      'bot-model-low-ask-conf',
      'bot-model-max-entry',
      'bot-model-bank-green',
    'bot-model-near-target-bank',
    'bot-model-stall-sec',
    'bot-model-stagnation-sec',
    'bot-model-stagnation-sensitivity',
    'bot-model-be-chase-sec',
    'bot-model-no-progress-sec',
    'bot-model-no-progress-pct',
    'bot-model-no-progress-arm',
    'bot-model-trail-cents',
    'bot-model-max-adverse',
    'bot-model-underwater-window',
    'bot-model-underwater-ratio',
    'bot-model-rapid-adverse',
    'bot-model-open-grace-ms',
    'bot-model-prob-drift',
    'bot-model-live-lean-margin',
    'bot-model-decay-drop',
    'bot-model-decay-stall',
    'bot-model-decay-floor',
      'bot-model-min-open',
      'bot-model-max-open',
      'bot-model-peak-touch-tp',
      'bot-model-peak-touch-window',
      'bot-model-entry-momentum-block',
      'bot-model-settle-close',
      'bot-model-late-barrier',
      'bot-commodity-settle-close',
      'bot-commodity-late-barrier',
      'bot-model-preclose-force',
      'bot-model-late-exit-max-loss',
      'bot-model-lean-floor-drop',
      'bot-model-lean-floor-scale',
      'bot-model-max-loss',
      'bot-model-hard-floor',
      'bot-model-pace-drawdown',
      'bot-model-pace-sample',
      'bot-model-rich-floor',
      'bot-model-sitout',
      'bot-model-global-sitout',
      'bot-asset-auto-exclude-min-trades',
      'bot-asset-auto-exclude-floor',
      'bot-asset-auto-exclude-ceiling',
      'bot-asset-stats-lookback',
      'bot-settle-min',
      'bot-settle-max',
      'bot-settle-stoploss',
      'bot-settle-maxmin',
      'bot-settle-cooldown',
      'bot-settle-late-min',
      'bot-settle-late-floor',
      'bot-settle-stuck',
      'bot-stake',
      'bot-maxpos',
      'bot-paper-balance',
    ].forEach(updateSliderDisplay);
    updateSkimSliderDisplay();
  } catch {
    // Bot likely disabled or engine unreachable — form just stays blank.
  } finally {
    botFormHydrating = false;
    applyBotSettingsLockUi();
  }
}

function renderSettleWindowRec(rec) {
  const wrap = document.getElementById('settle-window-rec');
  const text = document.getElementById('settle-window-rec-text');
  const btnEdge = document.getElementById('settle-window-apply-edge');
  const btnSettle = document.getElementById('settle-window-apply-settle');
  if (!wrap || !text) return;
  if (btnEdge) btnEdge.disabled = false;
  if (btnSettle) btnSettle.disabled = false;
  if (!rec || typeof rec !== 'object') {
    wrap.dataset.light = 'neutral';
    text.textContent = 'Retrospect: waiting for settle history… Apply edge or settle anytime.';
    return;
  }
  const light = rec.light === 'green' || rec.light === 'red' ? rec.light : 'neutral';
  wrap.dataset.light = light;
  const look =
    rec.lookbackHours != null
      ? `${rec.lookbackHours}h`
      : rec.regime && rec.regime.ready
        ? '15m'
        : '—';
  const n =
    rec.stats && rec.stats.sampleSize != null
      ? rec.stats.sampleSize
      : rec.regime && rec.regime.symbolCount != null
        ? rec.regime.symbolCount
        : 0;
  const mode = rec.suggestedMode || (light === 'red' ? 'edge' : light === 'green' ? 'settle' : null);
  if (light === 'green') {
    const r = rec.regime;
    const rangeBit =
      r && r.medianRangePct != null
        ? ` · 15m range ${Number(r.medianRangePct).toFixed(2)}%`
        : '';
    text.textContent = `Green · suggest settle${rangeBit} · ${look}, n=${n}. ${rec.reason || ''}`;
  } else if (light === 'red') {
    const r = rec.regime;
    const rangeBit =
      r && r.medianRangePct != null
        ? ` · 15m range ${Number(r.medianRangePct).toFixed(2)}%`
        : '';
    text.textContent = `Red · suggest edge${rangeBit} · ${look}, n=${n}. ${rec.reason || ''}`;
  } else {
    text.textContent = `Neutral · ${rec.reason || 'Leave mode as-is.'} Apply edge or settle anytime.`;
  }
  if (btnEdge) btnEdge.classList.toggle('is-suggested', mode === 'edge');
  if (btnSettle) btnSettle.classList.toggle('is-suggested', mode === 'settle');
}

async function applySettleWindowRec(light) {
  const { engineUrl } = loadSettings();
  const feedback = document.getElementById('bot-settings-feedback');
  const btnEdge = document.getElementById('settle-window-apply-edge');
  const btnSettle = document.getElementById('settle-window-apply-settle');
  if (isBotSettingsLocked()) {
    if (feedback) {
      feedback.textContent = 'Settings are locked — unlock before applying strategy mode.';
      feedback.style.color = 'var(--wait)';
    }
    return;
  }
  const force = light === 'red' || light === 'green' || light === 'edge' || light === 'settle' ? light : null;
  if (!force) return;
  if (btnEdge) btnEdge.disabled = true;
  if (btnSettle) btnSettle.disabled = true;
  try {
    const res = await fetch(`${engineUrl}/api/bot/settle-window-rec/apply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ light: force }),
    });
    const data = await res.json();
    if (!res.ok || !data.ok) {
      if (feedback) {
        feedback.textContent = data.message || 'Could not apply strategy mode.';
        feedback.style.color = 'var(--wait)';
      }
      renderSettleWindowRec(data.recommendation);
      return;
    }
    if (feedback) {
      feedback.textContent = data.message || 'Strategy mode applied.';
      feedback.style.color = 'var(--up)';
    }
    renderSettleWindowRec(data.recommendation);
    if (data.config && data.config.strategyMode) {
      setBotStrategyTab(data.config.strategyMode);
    }
    renderSettleExitTableNote(data.config);
    refreshBotStatus();
  } catch (err) {
    if (feedback) {
      feedback.textContent = `Could not reach the engine: ${err.message}`;
      feedback.style.color = 'var(--down)';
    }
  } finally {
    if (btnEdge) btnEdge.disabled = false;
    if (btnSettle) btnSettle.disabled = false;
  }
}

async function saveBotConfig(opts = {}) {
  const { engineUrl } = loadSettings();
  const feedback = document.getElementById('bot-settings-feedback');
  if (isBotSettingsLocked()) {
    if (feedback) {
      feedback.textContent = 'Settings are locked — tap “Locked — tap to edit” before changing anything.';
      feedback.style.color = 'var(--wait)';
    }
    return;
  }
  const skimMode = document.getElementById('bot-skim-mode').value;
  const skimAmount = parseFloat(document.getElementById('bot-skim-amount').value);
  const trading = readTradingSlidersFromForm();
  const modelSitoutSec = parseFloat(document.getElementById('bot-model-sitout')?.value || '45');
  const modelGlobalSitoutSec = parseFloat(
    document.getElementById('bot-model-global-sitout')?.value || '20'
  );
  const payload = {
    symbol: document.getElementById('bot-symbol').value,
    strategyMode: document.getElementById('bot-strategy-mode')?.value || 'model',
    edgeThresholdPct: parseFloat(document.getElementById('bot-edge').value),
    minConfidence: parseFloat(document.getElementById('bot-confidence').value),
    stopLossCents: parseFloat(document.getElementById('bot-stoploss').value),
    stopRecoveryCents: parseFloat(document.getElementById('bot-stoprecovery').value),
    takeProfitCents: parseFloat(document.getElementById('bot-takeprofit').value),
    minEntryCents: parseFloat(document.getElementById('bot-minentries').value),
    modelInvertSide: document.getElementById('bot-model-invert')?.value || 'off',
    modelAutoSwitchSetup: document.getElementById('bot-model-auto-switch')?.value || 'off',
    modelShadowBooks: document.getElementById('bot-model-shadow-books')?.value || 'off',
    modelMinConfidence: parseFloat(document.getElementById('bot-model-confidence')?.value || '55'),
    modelEntryLiveLeanMarginPct: parseFloat(document.getElementById('bot-model-live-favor')?.value || '2'),
    modelSoftLeanMarginPct: parseFloat(document.getElementById('bot-model-soft-lean-value')?.dataset.value || '3'),
    modelMinEntryLeanPct: parseFloat(document.getElementById('bot-model-min-entry-lean')?.value || '65'),
    modelLeanSkipAboveCents: parseFloat(document.getElementById('bot-model-lean-skip-above')?.value || '0'),
    modelMinEntryLeanPctSOL: parseFloat(document.getElementById('bot-model-min-entry-lean-sol')?.value || '0'),
    modelMinEntryLeanPctBTC: parseFloat(document.getElementById('bot-model-min-entry-lean-btc')?.value || '0'),
    modelMinEntryLeanPctETH: parseFloat(document.getElementById('bot-model-min-entry-lean-eth')?.value || '0'),
    modelMinEntryLeanPctXrp: parseFloat(document.getElementById('bot-model-min-entry-lean-xrp')?.value || '0'),
    modelMinEntryLeanPctDoge: parseFloat(document.getElementById('bot-model-min-entry-lean-doge')?.value || '0'),
    modelMinEntryLeanPctBnb: parseFloat(document.getElementById('bot-model-min-entry-lean-bnb')?.value || '0'),
    modelMinEntryLeanPctNear: parseFloat(document.getElementById('bot-model-min-entry-lean-near')?.value || '0'),
    modelMinEntryLeanPctHype: parseFloat(document.getElementById('bot-model-min-entry-lean-hype')?.value || '0'),
    modelMinEntryLeanPctGold: parseFloat(document.getElementById('bot-model-min-entry-lean-gold')?.value || '0'),
    modelMinEntryLeanPctSilver: parseFloat(document.getElementById('bot-model-min-entry-lean-silver')?.value || '0'),
    modelMinEntryLeanPctOil: parseFloat(document.getElementById('bot-model-min-entry-lean-oil')?.value || '0'),
    modelMinEntryLeanPctNatgas: parseFloat(document.getElementById('bot-model-min-entry-lean-natgas')?.value || '0'),
    modelMinEntryLeanPctCopper: parseFloat(document.getElementById('bot-model-min-entry-lean-copper')?.value || '0'),
    commodityMinEntryCents: parseFloat(document.getElementById('bot-commodity-min-entry')?.value || '0'),
    commodityMinEntryCentsGold: parseFloat(document.getElementById('bot-commodity-min-entry-gold')?.value || '0'),
    commodityMinEntryCentsSilver: parseFloat(document.getElementById('bot-commodity-min-entry-silver')?.value || '0'),
    commodityMinEntryCentsOil: parseFloat(document.getElementById('bot-commodity-min-entry-oil')?.value || '0'),
    commodityMinEntryCentsNatgas: parseFloat(document.getElementById('bot-commodity-min-entry-natgas')?.value || '0'),
    commodityMinEntryCentsCopper: parseFloat(document.getElementById('bot-commodity-min-entry-copper')?.value || '0'),
    commodityMaxEntryCents: parseFloat(document.getElementById('bot-commodity-max-entry')?.value || '0'),
    commodityStakeDollarsGold: parseFloat(document.getElementById('bot-commodity-stake-gold')?.value || '0'),
    commodityStakeDollarsSilver: parseFloat(document.getElementById('bot-commodity-stake-silver')?.value || '0'),
    commodityStakeDollarsOil: parseFloat(document.getElementById('bot-commodity-stake-oil')?.value || '0'),
    commodityStakeDollarsNatgas: parseFloat(document.getElementById('bot-commodity-stake-natgas')?.value || '0'),
    commodityStakeDollarsCopper: parseFloat(document.getElementById('bot-commodity-stake-copper')?.value || '0'),
    commodityStopCentsGold: parseFloat(document.getElementById('bot-commodity-stop-gold')?.value || '0'),
    commodityStopCentsSilver: parseFloat(document.getElementById('bot-commodity-stop-silver')?.value || '0'),
    commodityStopCentsOil: parseFloat(document.getElementById('bot-commodity-stop-oil')?.value || '0'),
    commodityStopCentsNatgas: parseFloat(document.getElementById('bot-commodity-stop-natgas')?.value || '0'),
    commodityStopCentsCopper: parseFloat(document.getElementById('bot-commodity-stop-copper')?.value || '0'),
    commodityTpCentsGold: parseFloat(document.getElementById('bot-commodity-tp-gold')?.value || '0'),
    commodityTpCentsSilver: parseFloat(document.getElementById('bot-commodity-tp-silver')?.value || '0'),
    commodityTpCentsOil: parseFloat(document.getElementById('bot-commodity-tp-oil')?.value || '0'),
    commodityTpCentsNatgas: parseFloat(document.getElementById('bot-commodity-tp-natgas')?.value || '0'),
    commodityTpCentsCopper: parseFloat(document.getElementById('bot-commodity-tp-copper')?.value || '0'),
    commodityTrailCentsGold: parseFloat(document.getElementById('bot-commodity-trail-gold')?.value || '0'),
    commodityTrailCentsSilver: parseFloat(document.getElementById('bot-commodity-trail-silver')?.value || '0'),
    commodityTrailCentsOil: parseFloat(document.getElementById('bot-commodity-trail-oil')?.value || '0'),
    commodityTrailCentsNatgas: parseFloat(document.getElementById('bot-commodity-trail-natgas')?.value || '0'),
    commodityTrailCentsCopper: parseFloat(document.getElementById('bot-commodity-trail-copper')?.value || '0'),
    modelSignalDominanceMin: (() => {
      const raw = parseFloat(document.getElementById('bot-model-signal-dom')?.value || '0');
      if (!Number.isFinite(raw) || raw <= 0) return 0;
      return Math.round(raw) / 10;
    })(),
    modelConfirmCrossCents: parseFloat(document.getElementById('bot-model-confirm-cross')?.value || '0'),
    modelConfirmMaxExtensionCents: parseFloat(
      document.getElementById('bot-model-confirm-ext')?.value || '15'
    ),
    modelMinEntryCents: parseFloat(document.getElementById('bot-model-min-entry')?.value || '65'),
    modelMinRoomToFloorCents: parseFloat(
      document.getElementById('bot-model-min-room-floor')?.value || '10'
    ),
    modelLowAskMinConfidence: parseFloat(document.getElementById('bot-model-low-ask-conf')?.value || '0'),
    modelMaxEntryCents: parseFloat(document.getElementById('bot-model-max-entry')?.value || '88'),
    modelLowPriceMaxCents: 70,
    modelLowPriceStakeQuarters: 2,
    modelBankGreenCents: parseFloat(document.getElementById('bot-model-bank-green')?.value || '11'),
    modelMinTpCents: parseFloat(document.getElementById('bot-model-bank-green')?.value || '11'),
    modelNearTargetBankCents: parseFloat(
      document.getElementById('bot-model-near-target-bank')?.value || '8'
    ),
    modelMomentumStallSeconds: parseFloat(document.getElementById('bot-model-stall-sec')?.value || '4'),
    modelStagnationSeconds: parseFloat(document.getElementById('bot-model-stagnation-sec')?.value || '60'),
    modelStagnationMinProgressCents: parseFloat(
      document.getElementById('bot-model-stagnation-sensitivity')?.value || '3'
    ),
    modelBeChaseSeconds: parseFloat(document.getElementById('bot-model-be-chase-sec')?.value || '20'),
    modelNoProgressTightenSeconds: parseFloat(document.getElementById('bot-model-no-progress-sec')?.value || '0'),
    modelNoProgressTightenPct: parseFloat(document.getElementById('bot-model-no-progress-pct')?.value || '80'),
    modelNoProgressTightenArmCents: parseFloat(document.getElementById('bot-model-no-progress-arm')?.value || '15'),
    modelTrailCents: parseFloat(document.getElementById('bot-model-trail-cents')?.value || '0'),
    modelMaxAdverseCents: parseFloat(document.getElementById('bot-model-max-adverse')?.value || '0'),
    modelUnderwaterWindowSeconds: parseFloat(document.getElementById('bot-model-underwater-window')?.value || '90'),
    modelUnderwaterRatioPct: parseFloat(document.getElementById('bot-model-underwater-ratio')?.value || '70'),
    modelRapidAdverseCents: parseFloat(document.getElementById('bot-model-rapid-adverse')?.value || '0'),
    modelOpenGraceMs: parseFloat(document.getElementById('bot-model-open-grace-ms')?.value || '10000'),
    modelProbDriftPts: parseFloat(document.getElementById('bot-model-prob-drift')?.value || '15'),
    modelLiveLeanMarginPct: parseFloat(document.getElementById('bot-model-live-lean-margin')?.value || '1'),
    modelLeanDecayDropPts: parseFloat(document.getElementById('bot-model-decay-drop')?.value || '14'),
    modelLeanDecayStallSeconds: parseFloat(document.getElementById('bot-model-decay-stall')?.value || '6'),
    modelLeanDecayFloor: parseFloat(document.getElementById('bot-model-decay-floor')?.value || '85'),
    modelMinMinutesToOpen: parseFloat(document.getElementById('bot-model-min-open')?.value || '2.5'),
    modelMaxMinutesToOpen: parseFloat(document.getElementById('bot-model-max-open')?.value || '0'),
    modelPeakTouchTp: parseFloat(document.getElementById('bot-model-peak-touch-tp')?.value || '3'),
    modelPeakTouchWindow: parseFloat(document.getElementById('bot-model-peak-touch-window')?.value || '2'),
    modelEntryMomentumBlockPct: parseFloat(document.getElementById('bot-model-entry-momentum-block')?.value || '0'),
    modelSettleCloseMinutes: parseFloat(document.getElementById('bot-model-settle-close')?.value || '2.5'),
    modelLateBarrierMinutes: parseFloat(document.getElementById('bot-model-late-barrier')?.value || '2'),
    commoditySettleCloseMinutes: parseFloat(document.getElementById('bot-commodity-settle-close')?.value || '0'),
    commodityLateBarrierMinutes: parseFloat(document.getElementById('bot-commodity-late-barrier')?.value || '0'),
    modelPreCloseForceMinutes: parseFloat(
      document.getElementById('bot-model-preclose-force')?.value || '1'
    ),
    modelLateExitMaxLossCents: parseFloat(
      document.getElementById('bot-model-late-exit-max-loss')?.value || '0'
    ),
    modelLeanFloorBaseDrop: parseFloat(
      document.getElementById('bot-model-lean-floor-drop')?.value || '0'
    ),
    modelLeanFloorScale: parseFloat(
      document.getElementById('bot-model-lean-floor-scale')?.value || '0.2'
    ),
    modelMaxLossCents: parseFloat(document.getElementById('bot-model-max-loss')?.value || '0'),
    modelHardAdverseCents: parseFloat(document.getElementById('bot-model-max-loss')?.value || '0'),
    modelHardStopFloorCents: parseFloat(document.getElementById('bot-model-hard-floor')?.value || '55'),
    modelLeanStopBarrierCents: parseFloat(document.getElementById('bot-model-hard-floor')?.value || '55'),
    modelLeanStopPaceDrawdownPct: parseFloat(
      document.getElementById('bot-model-pace-drawdown')?.value || '35'
    ),
    modelLeanStopPaceMinSampleSeconds: parseFloat(
      document.getElementById('bot-model-pace-sample')?.value || '8'
    ),
    modelRichStopFloorCents: parseFloat(document.getElementById('bot-model-rich-floor')?.value || '0'),
    modelPostExitCooldownSeconds:
      Number.isFinite(modelSitoutSec) && modelSitoutSec > 0 ? Math.round(modelSitoutSec) : 0,
    modelPostExitCooldownMinutes:
      Number.isFinite(modelSitoutSec) && modelSitoutSec > 0 ? modelSitoutSec / 60 : 0,
    modelGlobalPostExitCooldownSeconds:
      Number.isFinite(modelGlobalSitoutSec) && modelGlobalSitoutSec > 0
        ? Math.round(modelGlobalSitoutSec)
        : 0,
    assetAutoExcludeEnabled: document.getElementById('bot-asset-auto-exclude')?.value || 'off',
    assetAutoExcludeMinTrades: parseFloat(document.getElementById('bot-asset-auto-exclude-min-trades')?.value || '5'),
    assetAutoExcludeFloor: parseFloat(document.getElementById('bot-asset-auto-exclude-floor')?.value || '30'),
    assetAutoExcludeCeiling: parseFloat(document.getElementById('bot-asset-auto-exclude-ceiling')?.value || '0'),
    assetStatsLookback: parseFloat(document.getElementById('bot-asset-stats-lookback')?.value || '50'),
    settleEntryMinCents: parseFloat(document.getElementById('bot-settle-min')?.value || '80'),
    settleEntryMaxCents: parseFloat(document.getElementById('bot-settle-max')?.value || '94'),
    settleStopLossCents: Math.max(
      8,
      Math.min(60, parseFloat(document.getElementById('bot-settle-stoploss')?.value || '50') || 50)
    ),
    settleMaxMinutesToOpen: parseFloat(document.getElementById('bot-settle-maxmin')?.value || '8.5'),
    settlePostStopSameSideCooldownMinutes: parseFloat(
      document.getElementById('bot-settle-cooldown')?.value || '2.5'
    ),
    settleLateEntryMinutes: parseFloat(document.getElementById('bot-settle-late-min')?.value || '2.5'),
    settleLateEntryMinCents: parseFloat(document.getElementById('bot-settle-late-floor')?.value || '70'),
    settleStuckHoldMinutes: parseFloat(document.getElementById('bot-settle-stuck')?.value || '3'),
    halfStakeNear: document.getElementById('bot-half-stake-near')?.value || 'on',
    autoTradeSymbols: readAutoTradeSymbolsFromForm(),
    settleTieredExits: document.getElementById('bot-settle-tiered')?.value || 'on',
    ...trading,
    paperStartingBalanceDollars: parseFloat(document.getElementById('bot-paper-balance').value),
    skimMode,
    ...(skimMode === 'insurance'
      ? { insuranceCapDollars: skimAmount }
      : skimMode === 'percent'
        ? { skimPercent: skimAmount }
        : skimMode === 'fixed'
          ? { skimFixedDollars: skimAmount }
          : {}),
  };
  try {
    const res = await fetch(`${engineUrl}/api/bot/config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      feedback.textContent = body.message
        ? `Not saved — ${body.message}`
        : `Not saved — engine returned an error (HTTP ${res.status}). Is the bot enabled (KALSHI_ENABLED=true)?`;
      feedback.style.color = 'var(--down)';
      return;
    }
    const saved = await res.json().catch(() => ({}));
    if (saved.config) updateSettingsJson(saved.config);
    if (saved.settleExitTiers) renderSettleExitTable(saved.settleExitTiers);
    syncSettleExitTableEnabled();
    const skimText = formatSkimLabel(saved.config || payload);
    let msg = opts.auto ? `✓ Auto-saved — ${skimText}.` : `✓ Saved — ${skimText}.`;
    try {
      const healthRes = await fetch(`${engineUrl}/api/health`, { cache: 'no-store' });
      if (healthRes.ok) {
        const health = await healthRes.json();
        if (health.dataDirEphemeral) {
          msg += ' Warning: disk is ephemeral — this will reset on next Render restart until you add a Persistent Disk.';
          feedback.style.color = 'var(--wait)';
        } else {
          feedback.style.color = 'var(--up)';
        }
      } else {
        feedback.style.color = 'var(--up)';
      }
    } catch {
      feedback.style.color = 'var(--up)';
    }
    feedback.textContent = msg;
    if (!opts.auto) refreshBotStatus();
  } catch (err) {
    feedback.textContent = `Not saved — could not reach the engine: ${err.message}`;
    feedback.style.color = 'var(--down)';
  }
}

async function resetPaperHistory() {
  if (
    !window.confirm(
      'Reset paper P&L, reserve, and open trades?\n\n' +
        'The newest 40 closed trades are kept so calibration stats are not wiped to zero. Full history is archived. This cannot be undone.'
    )
  ) {
    return;
  }
  const { engineUrl } = loadSettings();
  const feedback = document.getElementById('bot-settings-feedback');
  try {
    const res = await fetch(`${engineUrl}/api/bot/reset-paper`, { method: 'POST' });
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.message || 'Reset failed.');
    feedback.textContent = data.message;
    feedback.style.color = 'var(--up)';
    resetExitSoundSeenCloses();
    await refreshBotStatus();
    await loadCalibration();
  } catch (err) {
    feedback.textContent = `Could not reset paper history: ${err.message}`;
    feedback.style.color = 'var(--down)';
  }
}

function readBacktestSettingsFromForm() {
  const skimMode = document.getElementById('bot-skim-mode')?.value;
  const skimAmount = parseFloat(document.getElementById('bot-skim-amount')?.value);
  const strategyMode = document.getElementById('bot-strategy-mode')?.value || 'model';
  return {
    // Always send strategyMode so the server uses the right sim branch
    strategyMode,
    edgeThresholdPct: parseFloat(document.getElementById('bot-edge')?.value),
    minConfidence: parseFloat(document.getElementById('bot-confidence')?.value),
    stopLossCents: parseFloat(document.getElementById('bot-stoploss')?.value),
    stopRecoveryCents: parseFloat(document.getElementById('bot-stoprecovery')?.value),
    takeProfitCents: parseFloat(document.getElementById('bot-takeprofit')?.value),
    minEntryCents: parseFloat(document.getElementById('bot-minentries')?.value),
    stakeDollars: parseFloat(document.getElementById('bot-stake')?.value),
    maxOpenPositions: parseFloat(document.getElementById('bot-maxpos')?.value),
    paperStartingBalanceDollars: parseFloat(document.getElementById('bot-paper-balance')?.value),
    skimMode,
    ...(skimMode === 'insurance'
      ? { insuranceCapDollars: skimAmount }
      : skimMode === 'percent'
        ? { skimPercent: skimAmount }
        : skimMode === 'fixed'
          ? { skimFixedDollars: skimAmount }
          : {}),
  };
}

/** Render the "what will run" summary above the backtest controls. Called on every bot status refresh. */
function renderBacktestActiveConfig(config, candleCounts) {
  const el = document.getElementById('backtest-active-config');
  if (!el || !config) return;

  const mode = String(config.strategyMode || 'model').toUpperCase();
  const setup = String(config.activeSetupId || '—');
  const coins = String(config.autoTradeSymbols || '—');
  const stake = config.stakeDollars != null ? `$${config.stakeDollars}` : '—';

  let modeDetail = '';
  if (config.strategyMode === 'model') {
    const conf = config.modelMinConfidence != null ? `conf ≥${config.modelMinConfidence}%` : '';
    const stop = config.modelMaxAdverseCents != null && config.modelMaxAdverseCents > 0
      ? `stop −${config.modelMaxAdverseCents}¢` : '';
    const tp   = config.modelBankGreenCents != null ? `bank +${config.modelBankGreenCents}¢` : '';
    const commStop = config.commodityStopCentsGold != null && config.commodityStopCentsGold > 0
      ? `commodity stop −${config.commodityStopCentsGold}¢` : '';
    const commTp   = config.commodityTpCentsGold != null && config.commodityTpCentsGold > 0 && config.commodityTpCentsGold < 99
      ? `commodity TP +${config.commodityTpCentsGold}¢` : '';
    modeDetail = [conf, stop, tp, commStop, commTp].filter(Boolean).join(' · ');
  } else if (config.strategyMode === 'edge') {
    modeDetail = `edge ≥${config.edgeThresholdPct}% · conf ≥${config.minConfidence}% · stop −${config.stopLossCents}¢ · TP +${config.takeProfitCents}¢`;
  } else if (config.strategyMode === 'settle') {
    modeDetail = `entry ${config.settleEntryMinCents}–${config.settleEntryMaxCents}¢ · stop −${config.settleStopLossCents}¢`;
  }

  // Commodity candle counts
  let candleNote = '';
  if (candleCounts && (candleCounts.GOLD != null || candleCounts.SILVER != null || candleCounts.OIL != null)) {
    const parts = ['GOLD', 'SILVER', 'OIL']
      .map((s) => candleCounts[s] != null ? `${s} ${candleCounts[s]}` : null)
      .filter(Boolean);
    if (parts.length) {
      const allZero = ['GOLD', 'SILVER', 'OIL'].every((s) => !candleCounts[s]);
      const warn = allZero
        ? `<span class="bac-warn"> ⚠ No commodity candles — hit "⟳ Fetch candles now" in the MODEL tab first</span>`
        : '';
      candleNote = `<br>Commodity candles in memory: ${parts.join(' · ')}${warn}`;
    }
  }

  el.innerHTML =
    `<span class="bac-mode">${mode}</span>` +
    `setup: <strong>${setup}</strong> · coins: <strong>${coins}</strong> · stake: <strong>${stake}</strong>` +
    (modeDetail ? `<br>${modeDetail}` : '') +
    candleNote;
}

function formatMoneyFromCents(cents, { signed = false } = {}) {
  return formatMoneyCents(cents, { signed });
}

function applyHuntedSettingsToForm(settings) {
  if (!settings) return;
  if (settings.edgeThresholdPct != null) document.getElementById('bot-edge').value = settings.edgeThresholdPct;
  if (settings.minConfidence != null) document.getElementById('bot-confidence').value = settings.minConfidence;
  if (settings.stopLossCents != null) document.getElementById('bot-stoploss').value = settings.stopLossCents;
  if (settings.stopRecoveryCents != null) {
    const el = document.getElementById('bot-stoprecovery');
    if (el) el.value = settings.stopRecoveryCents;
  }
  if (settings.takeProfitCents != null) document.getElementById('bot-takeprofit').value = settings.takeProfitCents;
  if (settings.minEntryCents != null) document.getElementById('bot-minentries').value = settings.minEntryCents;
  ['bot-edge', 'bot-confidence', 'bot-stoploss', 'bot-stoprecovery', 'bot-takeprofit', 'bot-minentries'].forEach(updateSliderDisplay);
}

function renderBacktestResults(data, dayLabel) {
  const t = data.trading || {};
  const s = data.settingsUsed || {};
  const isModel = String(s.strategyMode || '').toLowerCase() === 'model';
  const skimLabel =
    s.skimMode === 'off'
      ? 'off'
      : s.skimMode === 'insurance'
        ? `insurance · arm $${s.insuranceCapDollars != null ? s.insuranceCapDollars : 10} / floor $${s.insuranceFloorDollars != null ? s.insuranceFloorDollars : 6} / overflow $${s.insuranceOverflowDollars != null ? s.insuranceOverflowDollars : 15}`
        : s.skimMode === 'percent'
        ? `${s.skimPercent}% of profit`
        : `$${Number(s.skimFixedDollars || 0).toFixed(0)} per win`;
  const pnlClass = (t.netPnlCents || 0) > 0 ? 'chip-positive' : (t.netPnlCents || 0) < 0 ? 'chip-negative' : '';
  const modeLabel = data.mode === 'AUTO' || t.mode === 'AUTO' ? 'AUTO' : data.symbol;
  const scanned = (data.symbolsScanned || t.symbolsScanned || [data.symbol]).join(', ');

  // Settings summary line — mode-aware
  let settingsLine;
  if (isModel) {
    const stop = s.modelMaxAdverseCents > 0 ? `stop −${s.modelMaxAdverseCents}¢` : 'stop global';
    const tp   = s.modelBankGreenCents   > 0 ? `bank +${s.modelBankGreenCents}¢`  : '';
    const commTp  = s.commodityTpCentsGold   > 0 && s.commodityTpCentsGold   < 99 ? `GOLD TP +${s.commodityTpCentsGold}¢`   : '';
    const commStp = s.commodityStopCentsGold > 0 ? `GOLD stop −${s.commodityStopCentsGold}¢` : '';
    settingsLine = [
      `MODEL · setup ${s.activeSetupId || '—'} · coins ${s.autoTradeSymbols || '—'}`,
      `conf ≥${s.modelMinConfidence}%`, stop, tp, commTp, commStp,
      `stake $${s.stakeDollars}`, `max ${s.maxOpenPositions} pos`,
      `skim ${skimLabel}`, `bankroll $${s.paperStartingBalanceDollars}`,
    ].filter(Boolean).join(' · ');
  } else {
    settingsLine = `${String(s.strategyMode || 'edge').toUpperCase()} · Edge ≥ ${s.edgeThresholdPct}% · Conf ≥ ${s.minConfidence}% · Stake $${s.stakeDollars} · Stop −${s.stopLossCents}¢ · TP +${s.takeProfitCents != null ? s.takeProfitCents + '¢' : '—'} · Max pos ${s.maxOpenPositions} · Skim ${skimLabel} · Bankroll $${s.paperStartingBalanceDollars}`;
  }

  const bySymbol = t.tradesBySymbol
    ? Object.entries(t.tradesBySymbol)
        .sort((a, b) => b[1] - a[1])
        .map(([sym, count]) => `${sym} ${count}`)
        .join(' · ')
    : '';

  let huntBlock = '';
  if (data.hunt && data.hunt.best) {
    const best = data.hunt.best;
    // Format each top-combo row based on which strategy was hunted
    const topRows = (data.hunt.top || [])
      .map((row, i) => {
        const bs = row.settings || {};
        const label = isModel
          ? `conf ${bs.modelMinConfidence}% · stop −${bs.modelMaxAdverseCents}¢ · TP +${bs.commodityTpCentsGold ?? bs.modelBankGreenCents ?? '—'}¢`
          : `edge ${bs.edgeThresholdPct}% · conf ${bs.minConfidence}% · stop −${bs.stopLossCents}¢`;
        return `<div class="backtest-row"><span>#${i + 1} ${label}</span><span>${row.winRatePct != null ? row.winRatePct + '%' : '—'} WR · ${row.trades} trades · ${formatMoneyFromCents(row.netPnlCents, { signed: true })}</span></div>`;
      })
      .join('');
    // Winner line — mode-aware
    const bs = best.settings || {};
    const winnerLine = isModel
      ? `conf ${bs.modelMinConfidence}% · stop −${bs.modelMaxAdverseCents}¢ · commodity TP +${bs.commodityTpCentsGold ?? '—'}¢`
      : `edge ${bs.edgeThresholdPct}% · confidence ${bs.minConfidence}% · stop −${bs.stopLossCents}¢`;
    const appliedNote = isModel
      ? 'Save settings to apply these to the live bot.'
      : 'Those values were applied to the settings sliders above — save settings if you want the live bot to use them.';

    // ── "What changed and why" insight block ─────────────────────────────────
    // Compare winning settings to what was actually used in this backtest run.
    // Highlight meaningful differences so it's obvious which knobs matter.
    let insightRows = '';
    if (isModel) {
      const changes = [];
      const warn = (cur, win, label, higherIsBetter = false) => {
        if (cur == null || win == null || cur === win) return;
        const improved = higherIsBetter ? win > cur : win < cur;
        const arrow = improved ? '\u25bc' : '\u25b2';
        const cls = improved ? 'chip-positive' : 'chip-negative';
        const suffix = label.includes('conf') ? '%' : '\u00a2';
        const note = Math.abs(win - cur) >= 15
          ? ' \u2014 large change, likely the main driver'
          : Math.abs(win - cur) >= 8
          ? ' \u2014 meaningful change'
          : '';
        changes.push(`<div class="backtest-row"><span>${label}</span><span><span class="${cls}">${arrow} ${cur}${suffix} \u2192 ${win}${suffix}</span>${note}</span></div>`);
      };
      warn(s.modelMinConfidence,    bs.modelMinConfidence,    'Confidence floor',     true);
      warn(s.modelMaxAdverseCents,  bs.modelMaxAdverseCents,  'Hard stop (crypto)',   false);
      warn(s.commodityStopCentsGold ?? s.modelMaxAdverseCents, bs.commodityStopCentsGold, 'Stop — Gold',   false);
      warn(s.commodityStopCentsSilver ?? s.modelMaxAdverseCents, bs.commodityStopCentsSilver, 'Stop — Silver', false);
      warn(s.commodityStopCentsOil ?? s.modelMaxAdverseCents, bs.commodityStopCentsOil, 'Stop — Oil',    false);
      warn(s.commodityTpCentsGold,  bs.commodityTpCentsGold,  'TP target — Gold',    true);
      warn(s.commodityTpCentsSilver,bs.commodityTpCentsSilver,'TP target — Silver',  true);
      warn(s.commodityTpCentsOil,   bs.commodityTpCentsOil,   'TP target — Oil',     true);
      if (changes.length === 0) {
        insightRows = `<div class="backtest-row"><span>No meaningful changes from current settings</span><span>—</span></div>`;
      } else {
        insightRows = changes.join('');
      }
    } else {
      const changes = [];
      const warn = (cur, win, label, higherIsBetter = false) => {
        if (cur == null || win == null || cur === win) return;
        const improved = higherIsBetter ? win > cur : win < cur;
        const arrow = improved ? '\u25bc' : '\u25b2';
        const cls = improved ? 'chip-positive' : 'chip-negative';
        const note = Math.abs(win - cur) >= 10 ? ' \u2014 large change' : '';
        changes.push(`<div class="backtest-row"><span>${label}</span><span><span class="${cls}">${arrow} ${cur} \u2192 ${win}</span>${note}</span></div>`);
      };
      warn(s.minConfidence,   bs.minConfidence,   'Confidence floor', true);
      warn(s.edgeThresholdPct,bs.edgeThresholdPct,'Edge threshold',   true);
      warn(s.stopLossCents,   bs.stopLossCents,   'Stop loss (¢)',    false);
      insightRows = changes.length
        ? changes.join('')
        : `<div class="backtest-row"><span>No meaningful changes from current settings</span><span>—</span></div>`;
    }

    huntBlock = `
      <div class="capital-ledger backtest-ledger">
        <div class="capital-ledger-title">Hunt result — best win rate + profit</div>
        <p class="backtest-settings-line">Searched ${data.hunt.searched} combos. Winner: ${winnerLine}</p>
        <p class="backtest-settings-line">${appliedNote}</p>
        <div class="backtest-recent-title">What changed vs your current settings</div>
        ${insightRows}
        <div class="backtest-recent-title">Top combos</div>
        ${topRows}
      </div>`;
    applyHuntedSettingsToForm(best.settings);
  }

  const lon = t.longevity || {};
  const longevityVerdict = lon.survivedFullPeriod
    ? `Survived the full ${lon.simulatedDays != null ? lon.simulatedDays : '—'} day(s) — Available Cash never ran dry.`
    : lon.broke
      ? `Available Cash ran dry after ~${lon.daysUntilBroke != null ? lon.daysUntilBroke : '—'} day(s) (${lon.hoursUntilBroke != null ? lon.hoursUntilBroke : '—'}h). Reserved may still hold skimmed profit.`
      : 'Longevity not available for this run.';
  const dailyRows = (lon.dailyEquity || [])
    .map(
      (d) =>
        `<div class="backtest-row"><span>Day ${d.day}${d.broke ? ' · dry' : ''}</span><span>${formatMoneyFromCents(d.totalEquityCents)} equity · ${formatMoneyFromCents(d.availableCashCents)} avail · ${d.tradesSoFar} trades</span></div>`
    )
    .join('');
  const longevityBlock = `
    <div class="capital-ledger backtest-ledger">
      <div class="capital-ledger-title">Bankroll longevity (continuous ${dayLabel})</div>
      <p class="backtest-settings-line">${longevityVerdict}</p>
      <div class="capital-row"><span>Simulated runtime</span><span>${lon.simulatedHours != null ? lon.simulatedHours + 'h' : '—'} (${lon.simulatedDays != null ? lon.simulatedDays : '—'} days)</span></div>
      <div class="capital-row"><span>Days survived</span><span>${lon.daysSurvived != null ? lon.daysSurvived : '—'}</span></div>
      <div class="capital-row"><span>Ran dry?</span><span class="${lon.broke ? 'chip-negative' : 'chip-positive'}">${lon.broke ? 'Yes — Available empty' : 'No'}</span></div>
      ${dailyRows ? `<div class="backtest-recent-title">Equity by day</div>${dailyRows}` : ''}
    </div>`;

  const tradingBlock = `
    <div class="capital-ledger backtest-ledger">
      <div class="capital-ledger-title">${data.hunted ? 'Best-hunt' : 'Settings-based'} trading sim (${modeLabel} · ${dayLabel})</div>
      <p class="backtest-settings-line">${settingsLine}</p>
      <p class="backtest-settings-line">Continuous scan · Scanned: ${scanned}${bySymbol ? ` · Trades taken: ${bySymbol}` : ''}</p>
      <div class="capital-row"><span>Trades taken</span><span>${t.trades ?? 0}</span></div>
      <div class="capital-row"><span>Wins / Losses</span><span>${t.wins ?? 0} / ${t.losses ?? 0}</span></div>
      <div class="capital-row"><span>Win rate</span><span>${t.winRatePct != null ? t.winRatePct + '%' : '—'}</span></div>
      <div class="capital-row"><span>Avg confidence (taken)</span><span>${t.avgConfidenceTaken != null ? t.avgConfidenceTaken + '%' : '—'}</span></div>
      <div class="capital-row"><span>Avg confidence (scanned)</span><span>${t.avgConfidenceScanned != null ? t.avgConfidenceScanned + '%' : '—'}</span></div>
      <div class="capital-row"><span>Stop-loss exits</span><span>${t.stopLossExits ?? 0}</span></div>
      <div class="capital-row"><span>Take-profit exits</span><span>${t.takeProfitExits ?? 0}</span></div>
      <div class="capital-row"><span>Breakeven exits</span><span>${t.breakevenExits ?? 0}</span></div>
      ${isModel ? '<div class="capital-row"><span>Model-against cuts</span><span>' + (t.modelAgainstExits ?? 0) + '</span></div><div class="capital-row"><span>Late/settle exits</span><span>' + (t.modelLateExits ?? 0) + '</span></div>' : ''}
      <div class="capital-divider"></div>
      <div class="capital-row capital-reserved"><span>Personal Wallet <em>(locked — never spent)</em></span><span class="${(t.reservedProfitCents || 0) > 0 ? 'chip-positive' : ''}">${formatMoneyFromCents(t.reservedProfitCents)}</span></div>
      <div class="capital-row capital-reserved"><span>Insurance Fund</span><span class="${(t.insuranceCents || 0) > 0 ? 'chip-positive' : ''}">${formatMoneyFromCents(t.insuranceCents || 0)}</span></div>
      <div class="capital-divider"></div>
      <div class="capital-row"><span>Starting Bankroll</span><span>${formatMoneyFromCents(t.startingBankrollCents)}</span></div>
      <div class="capital-row"><span>Available Cash</span><span>${formatMoneyFromCents(t.availableCashCents)}</span></div>
      <div class="capital-row"><span>Open Positions Value</span><span>${formatMoneyFromCents(t.openPositionsValueCents)}</span></div>
      <div class="capital-divider"></div>
      <div class="capital-row capital-total"><span>Total Equity</span><span>${formatMoneyFromCents(t.totalEquityCents)}</span></div>
      <div class="capital-row capital-pnl"><span>Net P&amp;L</span><span class="${pnlClass}">${formatMoneyFromCents(t.netPnlCents, { signed: true })}</span></div>
    </div>`;

  const skips = t.skipCounts || {};
  const skipBlock = `
    <div class="backtest-skips">
      <span>Skipped setups — low confidence: ${skips.lowConfidence || 0}, low edge: ${skips.lowEdge || 0}, cash: ${skips.insufficientCash || 0}</span>
    </div>`;

  const recent = (t.recentTrades || [])
    .map(
      (tr) =>
        `<div class="backtest-row"><span>${tr.symbol || data.symbol} ${tr.side.toUpperCase()} · ${tr.window} · conf ${tr.confidence}% · edge ${tr.edge}</span><span class="${tr.pnlDollars >= 0 ? 'chip-positive' : 'chip-negative'}">${tr.pnlDollars >= 0 ? '+' : ''}$${Math.abs(tr.pnlDollars).toFixed(2)} · ${tr.exitReason}</span></div>`
    )
    .join('');

  let windowRows = '';
  if (data.mode === 'AUTO' && data.windows && !data.windows.w5) {
    windowRows = Object.entries(data.windows)
      .map(([sym, windows]) => {
        const lines = Object.values(windows)
          .map(
            (w) =>
              `<div class="backtest-row"><span>${sym} ${w.window}</span><span>${w.accuracyPct != null ? w.accuracyPct + '%' : '—'} acc · avg conf ${w.avgConfidence != null ? w.avgConfidence + '%' : '—'} · high-conf ${w.highConfidenceAccuracyPct != null ? w.highConfidenceAccuracyPct + '%' : '—'} (${w.highConfidenceSampleSize || 0})</span></div>`
          )
          .join('');
        return lines;
      })
      .join('');
  } else {
    windowRows = Object.values(data.windows || {})
      .map(
        (w) =>
          `<div class="backtest-row"><span>Engine ${w.window}</span><span>${w.accuracyPct != null ? w.accuracyPct + '%' : '—'} acc · avg conf ${w.avgConfidence != null ? w.avgConfidence + '%' : '—'} · high-conf (≥55%) ${w.highConfidenceAccuracyPct != null ? w.highConfidenceAccuracyPct + '%' : '—'} (${w.correctCount}/${w.sampleSize})</span></div>`
      )
      .join('');
  }

  return `
    ${huntBlock}
    ${longevityBlock}
    ${tradingBlock}
    ${skipBlock}
    ${recent ? `<div class="backtest-recent-title">Recent simulated trades</div>${recent}` : ''}
    <div class="backtest-recent-title">Engine accuracy + confidence (from live prediction path)</div>
    ${windowRows}
    <p class="backtest-note">${data.candleCount} candles over ${dayLabel} (${data.hoursRequested}h). ${data.note || t.note || ''}</p>`;
}

async function runBacktest(hoursOverride, { hunt = false } = {}) {
  const { engineUrl } = loadSettings();
  const symbol = document.getElementById('backtest-symbol').value;
  const hoursInput = document.getElementById('backtest-hours');
  const hours = hoursOverride || hoursInput.value || 24;
  hoursInput.value = String(hours);
  document.querySelectorAll('.backtest-day-btn').forEach((btn) => {
    btn.classList.toggle('selected', String(btn.dataset.hours) === String(hours));
  });
  const resultsEl = document.getElementById('backtest-results');
  const days = Number(hours) / 24;
  const dayLabel = days === 1 ? '1 day' : `${days} days`;
  resultsEl.innerHTML = `<p class="settings-hint">${hunt ? 'Hunting best settings' : 'Running'} ${dayLabel} backtest${symbol === 'AUTO' ? ' (AUTO — continuous multi-market scan)' : ''}${hunt ? ' — this can take a while' : ''}…</p>`;
  try {
    const res = await fetch(`${engineUrl}/api/backtest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      cache: 'no-store',
      body: JSON.stringify({
        symbol,
        hours: Number(hours),
        hunt,
        ...readBacktestSettingsFromForm(),
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      resultsEl.innerHTML = `<p class="settings-hint">Error: ${data.error || 'unknown error'}</p>`;
      return;
    }
    resultsEl.innerHTML = renderBacktestResults(data, dayLabel);
  } catch (err) {
    resultsEl.innerHTML = `<p class="settings-hint">Failed to run backtest: ${err.message}</p>`;
  }
}

async function loadKalshiCredentialsStatus() {
  const { engineUrl } = loadSettings();
  const statusEl = document.getElementById('kalshi-creds-status');
  try {
    const res = await fetch(`${engineUrl}/api/kalshi/credentials-status`, { cache: 'no-store' });
    const data = await res.json();
    statusEl.textContent = data.configured
      ? `Configured (Key ID ${data.keyIdPreview})`
      : 'Not configured yet — enter your Key ID and private key below.';
  } catch {
    statusEl.textContent = 'Could not check credential status right now.';
  }
}

async function saveKalshiCredentials() {
  const { engineUrl } = loadSettings();
  const statusEl = document.getElementById('kalshi-creds-status');
  const keyId = document.getElementById('kalshi-key-id').value.trim();
  const privateKeyPem = document.getElementById('kalshi-private-key').value.trim();
  if (!keyId && !privateKeyPem) return;
  try {
    const res = await fetch(`${engineUrl}/api/kalshi/credentials`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ keyId: keyId || undefined, privateKeyPem: privateKeyPem || undefined }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      statusEl.textContent = `Not saved — ${body.error || 'engine returned HTTP ' + res.status}`;
      return;
    }
    // Never leave the private key sitting visible in the form after saving.
    document.getElementById('kalshi-private-key').value = '';
    loadKalshiCredentialsStatus();
  } catch (err) {
    statusEl.textContent = `Failed to save: ${err.message}`;
  }
}

const LIVE_NOT_AUTHORIZED_HINT =
  'Live is locked on this server. Set KALSHI_LIVE_TRADING=true, ' +
  'KALSHI_LIVE_TRADING_CONFIRM=I_UNDERSTAND_THE_RISK (exact), ensure Kalshi credentials are present at boot, then restart. ' +
  'Saving credentials in the UI alone cannot unlock live.';

function updateModeButtons(mode, liveAuthorized) {
  const paperBtn = document.getElementById('mode-btn-paper');
  const liveBtn = document.getElementById('mode-btn-live');
  const feedback = document.getElementById('mode-toggle-feedback');
  paperBtn.classList.toggle('active-mode', mode === 'paper');
  liveBtn.classList.toggle('active-mode', mode === 'live');
  liveBtn.classList.toggle('locked', !liveAuthorized);
  liveBtn.title = liveAuthorized ? '' : LIVE_NOT_AUTHORIZED_HINT;
  // Show the lock reason in the visible feedback line (tooltips alone are easy to miss).
  if (feedback && !liveAuthorized) {
    feedback.textContent = LIVE_NOT_AUTHORIZED_HINT;
    feedback.style.color = 'var(--wait)';
  } else if (feedback && liveAuthorized && feedback.textContent === LIVE_NOT_AUTHORIZED_HINT) {
    feedback.textContent = '';
  }
}

async function switchMode(requestedMode) {
  const { engineUrl } = loadSettings();
  const feedback = document.getElementById('mode-toggle-feedback');
  const liveBtn = document.getElementById('mode-btn-live');

  // Don't ask for a real-money confirm when the server has not authorized live —
  // surface the lock reason immediately instead of a misleading "Switch to LIVE?" dialog.
  if (requestedMode === 'live' && liveBtn && liveBtn.classList.contains('locked')) {
    feedback.textContent = LIVE_NOT_AUTHORIZED_HINT;
    feedback.style.color = 'var(--wait)';
    return;
  }

  if (requestedMode === 'live') {
    const confirmed = window.confirm(
      'Switch to LIVE trading? This places real orders with real money on Kalshi. ' +
        'Make sure your stake size, stop-loss, and other settings are exactly what you want first.'
    );
    if (!confirmed) return;
  }

  try {
    const res = await fetch(`${engineUrl}/api/bot/mode`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: requestedMode }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body.ok) {
      feedback.textContent = body.message || `Could not switch mode (HTTP ${res.status}).`;
      feedback.style.color = 'var(--down)';
      return;
    }
    feedback.textContent = `✓ Now in ${body.mode === 'live' ? 'LIVE' : 'paper'} mode.`;
    feedback.style.color = body.mode === 'live' ? 'var(--down)' : 'var(--up)';
    refreshBotStatus();
  } catch (err) {
    feedback.textContent = `Could not reach the engine: ${err.message}`;
    feedback.style.color = 'var(--down)';
  }
}

function wireBotUI() {
  initExitSoundUi();
  document.getElementById('bot-btn').addEventListener('click', openBotOverlay);
  document.getElementById('bot-overlay-close').addEventListener('click', closeBotOverlay);
  document.getElementById('bot-settings-refresh').addEventListener('click', () => {
    refreshBotStatus();
    loadBotConfigIntoForm();
  });
  document.getElementById('bot-settings-copy').addEventListener('click', async () => {
    const feedback = document.getElementById('bot-settings-feedback');
    const btn = document.getElementById('bot-settings-copy');
    const { engineUrl } = loadSettings();
    try {
      const res = await fetch(`${engineUrl}/api/bot/config`, { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const text = JSON.stringify(data.config, null, 2);
      await navigator.clipboard.writeText(text);
      const orig = btn.textContent;
      btn.textContent = '✓ Copied!';
      if (feedback) { feedback.textContent = '✓ Settings copied to clipboard.'; feedback.style.color = 'var(--up)'; }
      setTimeout(() => { btn.textContent = orig; }, 2000);
    } catch (err) {
      if (feedback) { feedback.textContent = `Could not copy: ${err.message}`; feedback.style.color = 'var(--down)'; }
    }
  });
  document.getElementById('bot-settings-save').addEventListener('click', () => saveBotConfig());
  const dailyLossStep = (delta) => {
    const el = document.getElementById('bot-daily-loss-value');
    if (!el) return;
    const cur = Number(el.dataset.value) || 5;
    const next = Math.max(0, Math.min(500, cur + delta));
    el.dataset.value = next;
    el.textContent = next === 0 ? 'off' : `$${next}`;
  };
  document.getElementById('bot-daily-loss-down')?.addEventListener('click', () => dailyLossStep(-1));
  document.getElementById('bot-daily-loss-up')?.addEventListener('click', () => dailyLossStep(1));
  const softLeanStep = (delta) => {
    const el = document.getElementById('bot-model-soft-lean-value');
    if (!el) return;
    const cur = Number(el.dataset.value) || 3;
    const next = Math.max(0, Math.min(20, cur + delta));
    el.dataset.value = next;
    el.textContent = next + ' pts';
  };
  document.getElementById('bot-model-soft-lean-down')?.addEventListener('click', () => softLeanStep(-1));
  document.getElementById('bot-model-soft-lean-up')?.addEventListener('click', () => softLeanStep(1));
  document.getElementById('bot-stake-half')?.addEventListener('click', () => {
    const el = document.getElementById('bot-stake');
    if (!el) return;
    el.value = Math.max(1, Math.round(parseFloat(el.value) / 2));
    updateSliderDisplay('bot-stake');
  });
  document.getElementById('bot-stake-quarter')?.addEventListener('click', () => {
    const el = document.getElementById('bot-stake');
    if (!el) return;
    el.value = Math.max(1, Math.round(parseFloat(el.value) / 4));
    updateSliderDisplay('bot-stake');
  });
  const settleWindowApplyEdge = document.getElementById('settle-window-apply-edge');
  if (settleWindowApplyEdge) {
    settleWindowApplyEdge.addEventListener('click', () => applySettleWindowRec('edge'));
  }
  const settleWindowApplySettle = document.getElementById('settle-window-apply-settle');
  if (settleWindowApplySettle) {
    settleWindowApplySettle.addEventListener('click', () => applySettleWindowRec('settle'));
  }
  document.getElementById('bot-running-toggle').addEventListener('click', () => {
    const isRunning = document.getElementById('bot-running-toggle').textContent !== 'Start bot';
    setBotRunning(!isRunning);
  });
  document.getElementById('bot-dashboard-toggle').addEventListener('click', (event) => setBotRunning(event.currentTarget.dataset.running === 'true'));
  document.getElementById('bot-dashboard-open').addEventListener('click', openBotOverlay);
  document.getElementById('bot-reset-paper').addEventListener('click', resetPaperHistory);
  document.getElementById('bot-commodity-fetch-candles')?.addEventListener('click', refreshCommodityCandles);
  document.getElementById('daily-loss-reset-btn')?.addEventListener('click', async () => {
    const btn = document.getElementById('daily-loss-reset-btn');
    if (btn) btn.disabled = true;
    try {
      const { engineUrl } = loadSettings();
      await fetch(`${engineUrl}/api/bot/reset-daily-loss`, { method: 'POST' });
      document.getElementById('daily-loss-reset-row').style.display = 'none';
      refreshBotStatus();
    } finally {
      if (btn) btn.disabled = false;
    }
  });
  const botOverlay = document.getElementById('bot-overlay');
  if (botOverlay) {
    botOverlay.addEventListener('click', (event) => {
      const btn = event.target && event.target.closest
        ? event.target.closest('#bot-insurance-deposit-btn')
        : null;
      if (btn) {
        event.preventDefault();
        depositInsuranceFromUi();
      }
    });
    botOverlay.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && event.target && event.target.id === 'bot-insurance-deposit') {
        event.preventDefault();
        depositInsuranceFromUi();
      }
    });
  }
  document.querySelectorAll('.backtest-day-btn').forEach((btn) => {
    btn.addEventListener('click', () => runBacktest(btn.dataset.hours, { hunt: false }));
  });
  document.getElementById('backtest-hunt').addEventListener('click', () => {
    const hours = document.getElementById('backtest-hours').value || 24;
    runBacktest(hours, { hunt: true });
  });
  document.getElementById('kalshi-creds-save').addEventListener('click', saveKalshiCredentials);
  document.getElementById('mode-btn-paper').addEventListener('click', () => switchMode('paper'));
  document.getElementById('mode-btn-live').addEventListener('click', () => switchMode('live'));
  wireBotStrategyTabs();
  wireBotConfigAutoSave();
  wireBotSettingsLock();
  wireSliderDisplays();
}

// ---------- misc: wake lock, orientation, service worker ----------

let wakeLock = null;
async function requestWakeLock() {
  try {
    if ('wakeLock' in navigator) {
      wakeLock = await navigator.wakeLock.request('screen');
    }
  } catch (err) {
    // Non-fatal — some browsers/OS power modes reject this.
    console.warn('[dashboard] wake lock unavailable:', err.message);
  }
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') requestWakeLock();
});

async function tryLockLandscape() {
  try {
    if (screen.orientation && screen.orientation.lock) {
      await screen.orientation.lock('landscape');
    }
  } catch {
    // Only works in installed/fullscreen PWA context on Android; ignore otherwise.
  }
}

function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    // Unregister any previously installed service worker so it can never
    // serve stale cached files again. The app works fine without it.
    navigator.serviceWorker.getRegistrations().then((regs) => {
      for (const reg of regs) reg.unregister();
    });
  }
}

// ---------- boot ----------

window.addEventListener('DOMContentLoaded', () => {
  applyFocusModeLayout();
  initWindowCoordination();
  wireSettingsUI();
  wireBotUI();
  document.getElementById('open-windows-btn').addEventListener('click', openOtherWindows);
  registerServiceWorker();
  requestWakeLock();
  tryLockLandscape();
  startPolling();
  setInterval(tickAllCountdowns, 1000);

  // If this is the very first run, nudge the user to set the engine address.
  if (!localStorage.getItem('engineUrl')) {
    openSettings();
  }
});
