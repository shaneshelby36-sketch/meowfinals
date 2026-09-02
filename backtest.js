'use strict';

const { correlation } = require('./indicators');
const { gatherIndicators, buildWindowPrediction, WINDOWS } = require('./prediction');
const { SignalAccumulatorManager } = require('./signalAccumulator');
const {
  stopRecoveryCentsRequired,
  stopRecoveryMaxAgeMs,
  peerCascadeMaxAgeMs,
  postStopSameSideCooldownMs,
  checkPostStopRecovery,
  checkPostStopPeerCascade,
  applyProfitBuckets,
  settleExitPlan,
  settleEntryBand,
  // model strategy helpers
  isCommoditySymbol,
  modelBankGreenCentsForTrade,
  modelNearTargetBankCentsForTrade,
  modelTrailArmCentsForTrade,
  modelTrailCentsForTrade,
  modelCommodityTpCents,
  modelMaxAdverseCentsForTrade,
  modelEffectiveMaxLossCents,
  modelHardAdverseCents,
  modelLeanGatedFloorCents,
  modelStopFloorForEntryCents,
  modelSettleCloseMinutes,
  modelLateBarrierMinutes,
  modelPreCloseForceMinutes,
  modelLateExitMaxLossCents,
  modelLateExtendMinConfidence,
  modelMinTpCents,
  modelMomentumStallMs,
  modelMomentumPullbackCents,
  modelStagnationSeconds,
  modelStagnationMinProgressCents,
  modelRapidAdverseCents,
  modelBeChaseSeconds,
  modelLeanDecayDropPts,
  modelLeanDecayFloor,
  modelLeanDecayCutState,
  modelHeldSideProb,
  modelLiveLeanAgainstHeld,
  modelLiveLeanStillFavors,
  modelLiveProbNotWithUs,
  modelEngineHardAgainst,
  modelEngineTurningAgainst,
  modelEngineClearlyWithUs,
  modelLiveLeanMarginPct,
  modelSoftLeanMarginPct,
  modelEntryLiveLeanMarginPct,
  modelMinEntryLeanPctForSymbol,
  modelLateExtendOk,
  modelMinHoldMs,
  modelOpenGraceMs,
  modelPeakProgressCents,
  MODEL_MIN_CONFIDENCE_DEFAULT,
  MODEL_MAX_ENTRY_DEFAULT_CENTS,
  MODEL_MIN_ENTRY_DEFAULT_CENTS,
} = require('./bot');

const LOOKBACK_MIN = 210;
const FIFTEEN_MIN_MS = 15 * 60 * 1000;
const MINUTE_MS = 60 * 1000;

// Same half-lives as the live engine, so a backtest run reflects the exact
// same accumulating-signal methodology that's actually trading live —
// not a separate, disconnected snapshot-only simulation.
const HALF_LIFE_MS = { w5: 2 * 60 * 1000, w10: 4 * 60 * 1000, w15: 7 * 60 * 1000 };

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function makeSeries(historySlice) {
  return {
    candles: historySlice,
    closes: () => historySlice.map((c) => c.close),
    volumes: () => historySlice.map((c) => c.volume),
    latestClose: () => historySlice[historySlice.length - 1].close,
    ready: (n) => historySlice.length >= n,
  };
}

function normalizeSettings(raw = {}) {
  const skimMode = ['insurance', 'percent', 'fixed', 'off'].includes(raw.skimMode) ? raw.skimMode : 'insurance';
  const out = {
    edgeThresholdPct: Number.isFinite(Number(raw.edgeThresholdPct)) ? Number(raw.edgeThresholdPct) : 1,
    minConfidence: Number.isFinite(Number(raw.minConfidence)) ? Number(raw.minConfidence) : 55,
    stopLossCents: Number.isFinite(Number(raw.stopLossCents)) ? Number(raw.stopLossCents) : 23,
    takeProfitCents: Number.isFinite(Number(raw.takeProfitCents)) ? Number(raw.takeProfitCents) : 15,
    minEntryCents: Number.isFinite(Number(raw.minEntryCents)) ? Number(raw.minEntryCents) : 40,
    stopRecoveryCents: Number.isFinite(Number(raw.stopRecoveryCents)) ? Number(raw.stopRecoveryCents) : 6,
    stopRecoveryMaxMinutes: Number.isFinite(Number(raw.stopRecoveryMaxMinutes))
      ? Number(raw.stopRecoveryMaxMinutes)
      : 15,
    peerCascadeMaxMinutes: Number.isFinite(Number(raw.peerCascadeMaxMinutes))
      ? Number(raw.peerCascadeMaxMinutes)
      : 3,
    postStopMaxOneMinutes: Number.isFinite(Number(raw.postStopMaxOneMinutes))
      ? Number(raw.postStopMaxOneMinutes)
      : 1.5,
    postStopSameSideCooldownMinutes: Number.isFinite(Number(raw.postStopSameSideCooldownMinutes))
      ? Number(raw.postStopSameSideCooldownMinutes)
      : 2,
    stakeDollars: Number.isFinite(Number(raw.stakeDollars)) ? Number(raw.stakeDollars) : 10,
    stakingStrategy: raw.stakingStrategy === 'halve-after-win' ? 'halve-after-win' : 'fixed',
    maxOpenPositions: Math.max(1, Math.round(Number(raw.maxOpenPositions) || 2)),
    skimMode,
    skimPercent: Number.isFinite(Number(raw.skimPercent)) ? Number(raw.skimPercent) : 50,
    skimFixedDollars: Number.isFinite(Number(raw.skimFixedDollars)) ? Number(raw.skimFixedDollars) : 5,
    insuranceCapDollars: Number.isFinite(Number(raw.insuranceCapDollars)) ? Number(raw.insuranceCapDollars) : 10,
    insuranceFloorDollars: Number.isFinite(Number(raw.insuranceFloorDollars)) ? Number(raw.insuranceFloorDollars) : 6,
    insuranceOverflowDollars: Number.isFinite(Number(raw.insuranceOverflowDollars))
      ? Number(raw.insuranceOverflowDollars)
      : 15,
    paperStartingBalanceDollars: Number.isFinite(Number(raw.paperStartingBalanceDollars))
      ? Number(raw.paperStartingBalanceDollars)
      : 100,
    // No historical Kalshi book — assume even-money (50¢) so edge is vs a coin flip.
    assumedEntryCents: Number.isFinite(Number(raw.assumedEntryCents)) ? Number(raw.assumedEntryCents) : 50,
    strategyMode: ['settle', 'model'].includes(String(raw.strategyMode || '').toLowerCase())
      ? String(raw.strategyMode).toLowerCase()
      : 'edge',
    settleStopLossCents: Number.isFinite(Number(raw.settleStopLossCents))
      ? Number(raw.settleStopLossCents)
      : 8,
    settleMinMinutesToOpen: Number.isFinite(Number(raw.settleMinMinutesToOpen))
      ? Number(raw.settleMinMinutesToOpen)
      : 0.5,
    settleMaxMinutesToOpen: Number.isFinite(Number(raw.settleMaxMinutesToOpen))
      ? Number(raw.settleMaxMinutesToOpen)
      : 8.5,
    // When false, settle mode only stops or holds to 0/100 (no tier TP / stale).
    settleTieredExits: raw.settleTieredExits !== false && raw.settleTieredExits !== 0,
  };
  const settleBand = settleEntryBand(raw);
  out.settleEntryMinCents = settleBand.min;
  out.settleEntryMaxCents = settleBand.max;
  if (out.insuranceFloorDollars >= out.insuranceCapDollars) {
    out.insuranceFloorDollars = out.insuranceCapDollars >= 1 ? out.insuranceCapDollars - 1 : 0;
  }
  if (out.insuranceOverflowDollars < out.insuranceCapDollars) {
    out.insuranceOverflowDollars = out.insuranceCapDollars;
  }
  return out;
}

function pickWindowKey(minutesRemaining) {
  if (minutesRemaining > 10) return 'w5';
  if (minutesRemaining > 5) return 'w10';
  return 'w15';
}

function computeSkim(pnlCents, settings) {
  if (pnlCents <= 0 || settings.skimMode === 'off') return 0;
  if (settings.skimMode === 'insurance') return Math.round(pnlCents * 0.4);
  if (settings.skimMode === 'fixed') {
    return Math.min(Math.round(settings.skimFixedDollars * 100), pnlCents);
  }
  return Math.round(pnlCents * (settings.skimPercent / 100));
}

/** Wins → wallet/insurance per settings; losses draw insurance when ready (hysteresis). */
function applyReserveFlow(pnlCents, reserveCents, insuranceCents, settings, { rebuildInsurance = true, insuranceReady = false } = {}) {
  return applyProfitBuckets({
    pnlCents,
    reserveCents,
    insuranceCents: insuranceCents || 0,
    insuranceReady,
    settings,
    rebuildInsurance,
  });
}

function computeNextStake(settings, lastClosed) {
  if (settings.stakingStrategy !== 'halve-after-win') return settings.stakeDollars;
  if (!lastClosed) return settings.stakeDollars;
  if (lastClosed.pnlCents > 0) return Math.max(0.5, lastClosed.stakeDollars / 2);
  return settings.stakeDollars;
}

/** Crude mark for a binary contract from spot move (no historical Kalshi quotes). */
function estimateMarkCents(side, entrySpot, currentSpot) {
  const pct = (currentSpot - entrySpot) / entrySpot;
  const signed = side === 'yes' ? pct : -pct;
  return clamp(Math.round(50 + (signed / 0.02) * 50), 1, 99);
}

/**
 * Settle-style mark: start at the high entry (e.g. 90¢) and drift with spot.
 * ~0.15% adverse move ≈ −8¢ — rough crypto-15m sensitivity, not a real book.
 */
function estimateSettleMarkCents(side, entrySpot, currentSpot, entryCents) {
  const entry = clamp(Math.round(Number(entryCents) || 50), 1, 99);
  if (!Number.isFinite(entrySpot) || !Number.isFinite(currentSpot) || entrySpot <= 0) return entry;
  const pct = (currentSpot - entrySpot) / entrySpot;
  const signed = side === 'yes' ? pct : -pct;
  const delta = Math.round((signed / 0.0015) * 8);
  return clamp(entry + delta, 1, 99);
}

/**
 * Model-mode mark: same 2% move = 50¢ swing as edge mode, but anchored at
 * entryCents instead of 50¢. Commodities use a tighter sensitivity (0.8% per
 * 50¢) because gold/silver/oil move smaller percentages per 15m window.
 */
function estimateModelMarkCents(side, entrySpot, currentSpot, entryCents, symbol) {
  const entry = clamp(Math.round(Number(entryCents) || 65), 1, 99);
  if (!Number.isFinite(entrySpot) || !Number.isFinite(currentSpot) || entrySpot <= 0) return entry;
  const pct = (currentSpot - entrySpot) / entrySpot;
  const signed = side === 'yes' ? pct : -pct;
  // Commodities are quoted in USD/oz or USD/barrel — their % swings per 15m are
  // smaller than crypto. We use 0.8% per 50¢ so the sim isn't too aggressive.
  const sensitivity = isCommoditySymbol(symbol) ? 0.008 : 0.02;
  const delta = Math.round((signed / sensitivity) * 50);
  return clamp(entry + delta, 1, 99);
}

/**
 * Synthesize a lean probability for the model backtest.
 * We don't have real Kalshi order book history, so we derive lean from the
 * spot price move relative to entry.  When price has moved strongly in our
 * favour the held-side probability is high; when it moves against us it falls.
 * This mirrors the general direction of real lean without the exact values.
 *
 * Returns an object shaped like a real prediction window:
 *   { probabilityUp, probabilityDown, confidence }
 * so all the existing model helper functions work unchanged.
 */
function synthesizeLeanWindow(side, entrySpot, currentSpot, entryConf, symbol) {
  const pct = (currentSpot - entrySpot) / entrySpot;
  const signed = side === 'yes' ? pct : -pct;
  const sensitivity = isCommoditySymbol(symbol) ? 0.008 : 0.02;
  // Map signed % move to lean: entry lean starts at entryConf, drifts with price.
  // +sensitivity → +20pts; −sensitivity → −20pts (roughly).
  const driftPts = Math.round((signed / sensitivity) * 20);
  const heldProb = clamp((entryConf || 75) + driftPts, 45, 99);
  const oppProb = 100 - heldProb;
  const probabilityUp = side === 'yes' ? heldProb : oppProb;
  const probabilityDown = side === 'yes' ? oppProb : heldProb;
  // Confidence tracks how far price has moved from entry — stronger move = higher conf.
  const movePts = Math.abs(driftPts);
  const confidence = clamp((entryConf || 75) + Math.round(movePts * 0.4), 50, 99);
  return { probabilityUp, probabilityDown, confidence };
}

/**
 * Normalise all model-strategy settings from a raw config object.
 * Returns a settings object consumed by the model simulation branch.
 */
function normalizeModelSettings(raw = {}) {
  const n = (k, def) => {
    const v = Number(raw[k]);
    return Number.isFinite(v) ? v : def;
  };
  return {
    // entry gates
    modelMinConfidence:   n('modelMinConfidence',   MODEL_MIN_CONFIDENCE_DEFAULT),
    modelMinEntryCents:   n('modelMinEntryCents',   MODEL_MIN_ENTRY_DEFAULT_CENTS),
    modelMaxEntryCents:   n('modelMaxEntryCents',   MODEL_MAX_ENTRY_DEFAULT_CENTS),
    modelMinEntryLeanPct: n('modelMinEntryLeanPct', 74),
    modelMinEntryLeanPctGold:   n('modelMinEntryLeanPctGold',   55),
    modelMinEntryLeanPctSilver: n('modelMinEntryLeanPctSilver', 55),
    modelMinEntryLeanPctOil:    n('modelMinEntryLeanPctOil',    54),
    modelMinEntryLeanPctBTC:    n('modelMinEntryLeanPctBTC',    0),
    modelMinEntryLeanPctETH:    n('modelMinEntryLeanPctETH',    0),
    modelMinEntryLeanPctSOL:    n('modelMinEntryLeanPctSOL',    0),
    modelMinEntryLeanPctBnb:    n('modelMinEntryLeanPctBnb',    0),
    modelEntryLiveLeanMarginPct: n('modelEntryLiveLeanMarginPct', 3),
    // stops
    modelMaxAdverseCents:   n('modelMaxAdverseCents',   15),
    modelMaxLossCents:      n('modelMaxLossCents',      15),
    modelHardAdverseCents:  n('modelHardAdverseCents',  0),
    modelHardStopFloorCents: n('modelHardStopFloorCents', 55),
    modelRichStopFloorCents: n('modelRichStopFloorCents', 0),
    modelRichStopEntryMinCents: n('modelRichStopEntryMinCents', 80),
    modelLeanFloorBaseDrop:  n('modelLeanFloorBaseDrop',  0),
    modelLeanFloorScale:     n('modelLeanFloorScale',     0.2),
    modelLeanFloorBaseEntry: n('modelLeanFloorBaseEntry', 65),
    modelMinRoomToFloorCents: n('modelMinRoomToFloorCents', 3),
    // TP / bank
    modelBankGreenCents:       n('modelBankGreenCents',       15),
    modelMinTpCents:           n('modelMinTpCents',           15),
    modelNearTargetBankCents:  n('modelNearTargetBankCents',  8),
    modelTrailCents:           n('modelTrailCents',           0),
    // commodity overrides
    commodityTpCentsGold:    n('commodityTpCentsGold',    25),
    commodityTpCentsSilver:  n('commodityTpCentsSilver',  25),
    commodityTpCentsOil:     n('commodityTpCentsOil',     20),
    commodityStopCentsGold:  n('commodityStopCentsGold',  15),
    commodityStopCentsSilver:n('commodityStopCentsSilver',15),
    commodityStopCentsOil:   n('commodityStopCentsOil',   15),
    commodityTrailCentsGold:   n('commodityTrailCentsGold',   15),
    commodityTrailCentsSilver: n('commodityTrailCentsSilver', 15),
    commodityTrailCentsOil:    n('commodityTrailCentsOil',    12),
    // lean / signal
    modelLiveLeanMarginPct:   n('modelLiveLeanMarginPct',   3),
    modelSoftLeanMarginPct:   n('modelSoftLeanMarginPct',   1),
    modelLeanDecayDropPts:    n('modelLeanDecayDropPts',    10),
    // timing
    modelSettleCloseMinutes:       n('modelSettleCloseMinutes',       2.5),
    modelLateBarrierMinutes:       n('modelLateBarrierMinutes',       2),
    modelPreCloseForceMinutes:     n('modelPreCloseForceMinutes',     0.25),
    modelLateExtendMinConfidence:  n('modelLateExtendMinConfidence',  75),
    commoditySettleCloseMinutes:   n('commoditySettleCloseMinutes',   3.5),
    commodityLateBarrierMinutes:   n('commodityLateBarrierMinutes',   7),
    modelMinMinutesToOpen:         n('modelMinMinutesToOpen',         3.5),
    modelOpenGraceMs:              n('modelOpenGraceMs',              4000),
    modelMinHoldSeconds:           n('modelMinHoldSeconds',           4),
    // stagnation
    modelStagnationSeconds:            n('modelStagnationSeconds',            60),
    modelStagnationMinProgressCents:   n('modelStagnationMinProgressCents',   8),
    modelRapidAdverseCents:            n('modelRapidAdverseCents',            0),
    modelBeChaseSeconds:               n('modelBeChaseSeconds',               20),
    modelMomentumStallSeconds:         n('modelMomentumStallSeconds',         4),
    modelMomentumPullbackCents:        n('modelMomentumPullbackCents',        2),
  };
}

function buildCandleIndex(candles) {
  const byMinute = new Map();
  for (const c of candles) {
    const minute = Math.floor(c.time / MINUTE_MS) * MINUTE_MS;
    byMinute.set(minute, c);
  }
  return {
    candles,
    byMinute,
    times: [...byMinute.keys()].sort((a, b) => a - b),
  };
}

function historyThrough(index, minute) {
  const out = [];
  for (const c of index.candles) {
    if (c.time > minute + MINUTE_MS - 1) break;
    out.push(c);
  }
  return out;
}

function spotAt(index, minute) {
  return index.byMinute.get(minute) || null;
}

/**
 * Directional accuracy by prediction window, using the real prediction
 * builder (including confidence scores) — not just raw directional lean.
 */
function backtestSymbol(candles, { stepMinutes = 1, symbol = 'BTC', btcCandles = null } = {}) {
  const perWindow = {};
  for (const w of WINDOWS) {
    perWindow[w.key] = {
      label: w.label,
      minutes: w.minutes,
      correct: 0,
      total: 0,
      confidenceSum: 0,
      highConfidenceCorrect: 0,
      highConfidenceTotal: 0,
    };
  }

  const accumulatorManager = new SignalAccumulatorManager(HALF_LIFE_MS);
  const maxHorizon = Math.max(...WINDOWS.map((w) => w.minutes));
  const lastUsableIndex = candles.length - maxHorizon - 1;
  const btcIndex = btcCandles && symbol !== 'BTC' ? buildCandleIndex(btcCandles) : null;

  for (let i = LOOKBACK_MIN; i <= lastUsableIndex; i += stepMinutes) {
    const historySlice = candles.slice(0, i + 1);
    const series = makeSeries(historySlice);
    const ind = gatherIndicators(series, null);
    if (!ind) continue;

    const currentPrice = candles[i].close;
    const historicalNow = candles[i].time;

    let otherInd = null;
    let crossCorrelation = null;
    if (btcIndex) {
      const btcHistory = historyThrough(btcIndex, historicalNow);
      if (btcHistory.length >= LOOKBACK_MIN) {
        otherInd = gatherIndicators(makeSeries(btcHistory), null);
        const assetCloses = historySlice.map((c) => c.close);
        const btcCloses = btcHistory.map((c) => c.close);
        const n = Math.min(assetCloses.length, btcCloses.length, 60);
        if (n >= 20) {
          crossCorrelation = correlation(assetCloses.slice(-n), btcCloses.slice(-n));
        }
      }
    }

    for (const w of WINDOWS) {
      const accumulator = accumulatorManager.get(`dir:${symbol}`, w.key);
      const prediction = buildWindowPrediction(
        w,
        ind,
        otherInd,
        crossCorrelation,
        currentPrice,
        symbol,
        accumulator,
        historicalNow
      );

      const futureIndex = i + w.minutes;
      if (futureIndex >= candles.length) continue;

      const predictedUp = prediction.probabilityUp >= 50;
      const actualUp = candles[futureIndex].close >= currentPrice;
      const bucket = perWindow[w.key];
      bucket.total += 1;
      bucket.confidenceSum += prediction.confidence;
      if (predictedUp === actualUp) bucket.correct += 1;
      if (prediction.confidence >= 55) {
        bucket.highConfidenceTotal += 1;
        if (predictedUp === actualUp) bucket.highConfidenceCorrect += 1;
      }
    }
  }

  const summary = {};
  for (const key of Object.keys(perWindow)) {
    const b = perWindow[key];
    const accuracyPct = b.total ? +((b.correct / b.total) * 100).toFixed(1) : null;
    const avgConfidence = b.total ? +(b.confidenceSum / b.total).toFixed(1) : null;
    const highConfAccuracyPct = b.highConfidenceTotal
      ? +((b.highConfidenceCorrect / b.highConfidenceTotal) * 100).toFixed(1)
      : null;
    summary[key] = {
      window: b.label,
      minutes: b.minutes,
      sampleSize: b.total,
      correctCount: b.correct,
      accuracyPct,
      avgConfidence,
      highConfidenceSampleSize: b.highConfidenceTotal,
      highConfidenceAccuracyPct: highConfAccuracyPct,
      illustrativeReturnPct: accuracyPct != null ? +((2 * accuracyPct - 100).toFixed(1)) : null,
    };
  }

  return summary;
}

/**
 * Paper-trade simulation using dashboard settings.
 * `candlesBySymbol` = { BTC: [...], ETH: [...], ... }
 * AUTO mode: continuously scans all symbols and trades the best opportunity
 * that clears confidence + edge (same ranking as live AUTO).
 */
function backtestWithSettings(
  candlesBySymbol,
  rawSettings = {},
  { stepMinutes = 1, mode = 'single', focusSymbol = null, continuousSearch = true } = {}
) {
  const settings = normalizeSettings(rawSettings);
  const accumulatorManager = new SignalAccumulatorManager(HALF_LIFE_MS);

  // Normalize: allow legacy single-array callers.
  let bySymbol = candlesBySymbol;
  if (Array.isArray(candlesBySymbol)) {
    bySymbol = { BTC: candlesBySymbol };
  }

  const symbols = Object.keys(bySymbol).filter((s) => Array.isArray(bySymbol[s]) && bySymbol[s].length);
  if (symbols.length === 0) {
    throw new Error('No candle data provided for backtest.');
  }

  const indexes = {};
  for (const sym of symbols) indexes[sym] = buildCandleIndex(bySymbol[sym]);

  const btcIndex = indexes.BTC || null;
  const timeline = (indexes.BTC || indexes[symbols[0]]).times;
  const autoMode = mode === 'AUTO';
  const tradeSymbols = autoMode
    ? symbols
    : [focusSymbol && indexes[focusSymbol] ? focusSymbol : symbols.find((s) => s !== 'BTC') || symbols[0]].filter(Boolean);

  const settleMode = settings.strategyMode === 'settle';
  const modelMode  = settings.strategyMode === 'model';
  // For model mode, pull in the full model settings on top of base settings.
  const ms = modelMode ? normalizeModelSettings(rawSettings) : null;
  const startingCents = Math.round(settings.paperStartingBalanceDollars * 100);
  const defaultEntryCents = settleMode
    ? clamp(Math.round((settings.settleEntryMinCents + settings.settleEntryMaxCents) / 2), 1, 99)
    : modelMode
      ? clamp(Math.round((ms.modelMinEntryCents + ms.modelMaxEntryCents) / 2), 1, 99)
      : clamp(Math.round(settings.assumedEntryCents), 1, 99);
  // Minimum cash to open at least one contract at a typical entry.
  const minTradeCostCents = Math.max(
    defaultEntryCents,
    Math.floor((settings.stakeDollars * 100) / defaultEntryCents) * defaultEntryCents
  );

  let reserveCents = 0;
  let insuranceCents = 0;
  let insuranceReady = false;
  let closedPnlCents = 0;
  const openTrades = [];
  const closedTrades = [];
  const skipCounts = {
    lowConfidence: 0,
    lowEdge: 0,
    maxPositions: 0,
    insufficientCash: 0,
    notReady: 0,
    postStopRecovery: 0,
    postStopPeerCascade: 0,
  };
  const tradesBySymbol = {};
  const confidenceSamples = [];
  const dailyEquity = [];
  let brokeAtMs = null;
  let lastDayBucket = null;

  const openExposure = () =>
    openTrades.reduce((sum, t) => sum + t.entryPriceCents * t.contracts, 0);

  const availableCash = () =>
    Math.max(0, startingCents + closedPnlCents - reserveCents - insuranceCents - openExposure());

  const totalEquityNow = () => availableCash() + openExposure() + reserveCents + insuranceCents;

  const simStartMs = timeline.length ? timeline[0] : null;
  const simEndMs = timeline.length ? timeline[timeline.length - 1] : null;

  for (let ti = 0; ti < timeline.length; ti += stepMinutes) {
    const minute = timeline[ti];
    const indicatorsCache = {};

    // Precompute BTC indicators once per minute for correlation peers.
    if (btcIndex) {
      const btcHistory = historyThrough(btcIndex, minute);
      if (btcHistory.length >= LOOKBACK_MIN) {
        indicatorsCache.BTC = gatherIndicators(makeSeries(btcHistory), null);
      }
    }

    // --- manage open trades against each symbol's own spot ---
    for (let t = openTrades.length - 1; t >= 0; t -= 1) {
      const trade = openTrades[t];
      const tradeIndex = indexes[trade.symbol];
      if (!tradeIndex) continue;
      const candle = spotAt(tradeIndex, minute);
      if (!candle) continue;
      const spot = candle.close;

      let exitPrice = null;
      let reason = null;
      const minsLeft = Math.max(0, (trade.closeTime - minute) / 60000);

      if (modelMode) {
        // ── MODEL strategy simulation ─────────────────────────────────────
        // Synthesize a lean window from the spot price movement so all real
        // model exit helpers (lean decay, hard-against, extend-late, etc.)
        // work exactly as in the live bot — just with a proxy lean instead
        // of a real Kalshi order book.
        const mark = estimateModelMarkCents(
          trade.side, trade.entrySpot, spot, trade.entryPriceCents, trade.symbol
        );
        const leanWindow = synthesizeLeanWindow(
          trade.side, trade.entrySpot, spot, trade.engineConfidence, trade.symbol
        );
        const entry  = trade.entryPriceCents;
        const heldMs = minute - trade.openedAt;
        const openGrace = ms.modelOpenGraceMs;
        const inOpenGrace = heldMs < openGrace;
        const minHoldMs = (ms.modelMinHoldSeconds || 4) * 1000;
        const heldLongEnough = heldMs >= minHoldMs;

        // Track peak bid
        if (!Number.isFinite(trade.peakHeldBidCents) || mark > trade.peakHeldBidCents) {
          trade.peakHeldBidCents = mark;
          trade.peakHeldBidAt   = minute;
        }
        const peak       = trade.peakHeldBidCents;
        const greenCents = mark > entry ? Math.round(mark - entry) : 0;
        const flatOrGreen = mark >= entry;
        const underwater  = mark < entry;
        const adverseCents = underwater ? Math.round(entry - mark) : 0;

        // Spread-adjusted "true" adverse (entry was ask, mark is bid)
        const entrySpread = trade.entrySpread || 0;
        const trueAdverse = underwater ? Math.max(0, adverseCents - entrySpread) : 0;
        const econUnderwater = trueAdverse > 0;

        // Peak progress above entry
        const peakProgress = peak > entry ? Math.round(peak - entry) : 0;

        // Trail arm / TP targets (trade-aware, commodity-overrides apply)
        const bankGreen      = modelBankGreenCentsForTrade(trade, ms);
        const nearTargetBank = modelNearTargetBankCentsForTrade(trade, ms);
        const armCents       = modelTrailArmCentsForTrade(trade, ms);
        const armed          = flatOrGreen && greenCents >= armCents;
        const isDecentGreen  = flatOrGreen && bankGreen > 0 && greenCents >= bankGreen;

        // Commodity TP override (99 = ride to settle)
        const commodityTpOverride  = modelCommodityTpCents(String(trade.symbol || '').toUpperCase(), ms);
        const commodityRideToSettle = commodityTpOverride === 99;

        // Late barrier / settle-close / pre-close (commodity-aware)
        const lateBarrierMins  = modelLateBarrierMinutes(ms, trade.symbol);
        const settleCloseMins  = modelSettleCloseMinutes(ms, trade.symbol);
        const preCloseForceMins = modelPreCloseForceMinutes(ms);
        const inLateBarrier    = lateBarrierMins > 0 && minsLeft <= lateBarrierMins;
        const inSettleClose    = settleCloseMins > 0 && minsLeft <= settleCloseMins;
        const inPreCloseForce  = preCloseForceMins > 0 && minsLeft <= preCloseForceMins;

        // Lean signals (mirroring live bot)
        const liveAgainst   = modelLiveLeanAgainstHeld(leanWindow, trade.side, modelLiveLeanMarginPct(ms));
        const liveFavors    = modelLiveLeanStillFavors(leanWindow, trade.side, modelSoftLeanMarginPct(ms));
        const engineTurning = modelEngineHardAgainst({
          window: leanWindow, direction: null, side: trade.side,
          minConf: ms.modelMinConfidence, config: ms,
        });
        const engineClearlyWithUs = modelEngineClearlyWithUs({
          window: leanWindow, direction: null, side: trade.side,
          entryHeldProb: trade.engineProbability, config: ms,
        });
        const engineSoftTurning = modelEngineTurningAgainst({
          window: leanWindow, direction: null, side: trade.side,
          minConf: ms.modelMinConfidence,
          entryHeldProb: trade.engineProbability, config: ms,
        });

        // canExtendLate: inside barrier + lean still with us → hold to settlement
        const canExtendLate = !!(
          inLateBarrier && !inPreCloseForce &&
          modelLateExtendOk(leanWindow, trade.side, ms)
        );

        // Lean decay
        const decayState = modelLeanDecayCutState(trade, leanWindow, trade.side, minute, ms);

        // modelDeteriorating mirrors bot.js logic
        const leanStaleScratch = !!(
          modelLiveProbNotWithUs(leanWindow, trade.side) ||
          !modelLiveLeanStillFavors(leanWindow, trade.side, modelSoftLeanMarginPct(ms))
        );
        const modelDeteriorating = !!(engineTurning || leanStaleScratch);

        // Hard adverse stop (unconditional)
        const maxAdverse = modelMaxAdverseCentsForTrade(trade, ms);
        if (!inOpenGrace && maxAdverse > 0 && adverseCents >= maxAdverse) {
          const hardStop = Math.max(Math.round(entry - maxAdverse), 1);
          exitPrice = hardStop;
          reason = 'model_hard_stop';
        }

        // Hard floor stop (entry > floor; bid dropped below floor)
        if (exitPrice == null && !inOpenGrace) {
          const floor = modelStopFloorForEntryCents(entry, ms);
          if (floor > 0 && mark < floor) {
            exitPrice = floor;
            reason = 'model_floor_stop';
          }
        }

        // Hard absolute max loss
        if (exitPrice == null && !inOpenGrace) {
          const maxLoss = modelEffectiveMaxLossCents(trade, ms);
          if (maxLoss > 0 && adverseCents >= maxLoss) {
            exitPrice = Math.max(Math.round(entry - maxLoss), 1);
            reason = 'model_max_loss';
          }
        }

        // Lean-gated floor (lean deteriorating + below entry-scaled floor)
        if (exitPrice == null && !inOpenGrace && modelDeteriorating && econUnderwater) {
          const leanFloor = modelLeanGatedFloorCents(trade, ms);
          if (leanFloor > 0 && mark < leanFloor) {
            exitPrice = Math.max(leanFloor, 1);
            reason = 'model_lean_floor';
          }
        }

        // Trail stop (once armed: peak − trailCents)
        const trailCents = modelTrailCentsForTrade(trade, ms);
        if (exitPrice == null && !inOpenGrace && trailCents > 0 && armed &&
            Number.isFinite(peak) && peak > entry) {
          const trailFloor = Math.round(peak - trailCents);
          if (trailFloor >= entry && mark < trailFloor) {
            exitPrice = trailFloor;
            reason = 'model_trail_stop';
          }
        }

        // Pre-close force (final N seconds — always exits)
        if (exitPrice == null && inPreCloseForce) {
          if (flatOrGreen && isDecentGreen && heldLongEnough) {
            exitPrice = mark;
            reason = 'take_profit';
          } else if (flatOrGreen) {
            exitPrice = mark;
            reason = 'breakeven';
          } else {
            const lateMax = modelLateExitMaxLossCents(ms);
            const ok = lateMax <= 0 || adverseCents <= lateMax;
            if (ok) {
              exitPrice = Math.max(mark, 1);
              reason = 'model_pre_close';
            }
          }
        }

        // Late barrier exit (canExtendLate = hold; otherwise force cash-out)
        if (exitPrice == null && inLateBarrier && !canExtendLate) {
          if (flatOrGreen && isDecentGreen && heldLongEnough) {
            exitPrice = mark;
            reason = 'take_profit';
          } else if (flatOrGreen) {
            exitPrice = mark;
            reason = 'breakeven';
          } else {
            const lateMax = modelLateExitMaxLossCents(ms);
            const ok = lateMax <= 0 || adverseCents <= lateMax;
            if (ok) {
              exitPrice = Math.max(mark, 1);
              reason = 'model_late_exit';
            }
          }
        }

        // Settle-close window (≤ settleCloseMins left)
        if (exitPrice == null && inSettleClose && !inLateBarrier && !canExtendLate) {
          const settleThresh = ms.modelSettleCloseLossCents != null
            ? ms.modelSettleCloseLossCents : 50;
          if (flatOrGreen || adverseCents <= settleThresh) {
            if (flatOrGreen && isDecentGreen && heldLongEnough) {
              exitPrice = mark;
              reason = 'take_profit';
            } else if (flatOrGreen) {
              exitPrice = mark;
              reason = 'breakeven';
            } else {
              exitPrice = Math.max(mark, 1);
              reason = 'model_late_exit';
            }
          }
        }

        // Stagnation: held too long with no progress + model decaying
        if (exitPrice == null && !canExtendLate) {
          const stagnSec  = modelStagnationSeconds(ms);
          const stagnProg = modelStagnationMinProgressCents(ms);
          const stagnReady = stagnSec > 0 && heldMs >= stagnSec * 1000 && peakProgress < stagnProg;
          if (stagnReady && modelDeteriorating) {
            if (flatOrGreen && isDecentGreen && heldLongEnough) {
              exitPrice = mark; reason = 'take_profit';
            } else if (flatOrGreen) {
              exitPrice = mark; reason = 'breakeven';
            } else {
              exitPrice = Math.max(mark, 1); reason = 'model_stagnation';
            }
          }
        }

        // Lean decay cut: strong lean collapsed + not recovered
        if (exitPrice == null && !canExtendLate && decayState.inDecayZone && decayState.cutReady) {
          if (flatOrGreen && isDecentGreen && heldLongEnough) {
            exitPrice = mark; reason = 'take_profit';
          } else if (flatOrGreen) {
            exitPrice = mark; reason = 'breakeven';
          } else {
            exitPrice = Math.max(mark, 1); reason = 'model_lean_decay';
          }
        }

        // Hard lean against + confirmed → cut or scratch
        const againstBeReady = !inOpenGrace && heldMs >= openGrace + (ms.modelLeanAgainstBeSeconds != null ? ms.modelLeanAgainstBeSeconds * 1000 : 2000);
        if (exitPrice == null && engineTurning && againstBeReady) {
          if (flatOrGreen && isDecentGreen && heldLongEnough) {
            exitPrice = mark; reason = 'take_profit';
          } else if (flatOrGreen) {
            exitPrice = mark; reason = 'breakeven';
          } else if (econUnderwater) {
            exitPrice = Math.max(mark, 1); reason = 'model_against';
          }
        }

        // Soft turning + flat/green → scratch to avoid riding into a loss
        if (exitPrice == null && engineSoftTurning && againstBeReady && flatOrGreen && !engineClearlyWithUs) {
          if (isDecentGreen && heldLongEnough) {
            exitPrice = mark; reason = 'take_profit';
          } else {
            exitPrice = mark; reason = 'breakeven';
          }
        }

        // ─── Green exits ──────────────────────────────────────────────────
        // Rich bank (≥96¢ bid)
        if (exitPrice == null && mark >= 96) {
          exitPrice = mark; reason = 'take_profit';
        }

        // Commodity TP override reached
        if (exitPrice == null && !commodityRideToSettle && commodityTpOverride > 0 &&
            flatOrGreen && greenCents >= commodityTpOverride && heldLongEnough) {
          exitPrice = mark; reason = 'take_profit';
        }

        // Standard TP: bid ≥ bankGreen above entry
        if (exitPrice == null && isDecentGreen && heldLongEnough) {
          exitPrice = mark; reason = 'take_profit';
        }

        // Trail stall-bank: armed, stalled, near target
        if (exitPrice == null && armed && greenCents >= 1 && heldLongEnough && !liveFavors) {
          const stallMs  = modelMomentumStallMs(ms);
          const stallPb  = modelMomentumPullbackCents(ms);
          const pullback = Number.isFinite(peak) ? Math.max(0, Math.round(peak - mark)) : 0;
          const peakAgeMs = Number.isFinite(trade.peakHeldBidAt) ? minute - trade.peakHeldBidAt : Infinity;
          const stalled = (stallPb > 0 && pullback >= stallPb) || (stallMs > 0 && peakAgeMs >= stallMs);
          if (stalled && peakProgress >= nearTargetBank) {
            exitPrice = mark; reason = 'take_profit';
          }
        }

        // Settlement (time expired)
        if (exitPrice == null && (minute >= trade.closeTime || minute >= trade.settleMinute)) {
          const settleCandle = spotAt(tradeIndex, trade.settleMinute) || candle;
          const settledUp = settleCandle.close >= trade.entrySpot;
          const won = trade.side === 'yes' ? settledUp : !settledUp;
          exitPrice = won ? 100 : 0;
          reason = 'settled';
        }

      } else if (settleMode) {
        const mark = estimateSettleMarkCents(
          trade.side,
          trade.entrySpot,
          spot,
          trade.entryPriceCents
        );
        const stopLevel = Math.max(1, trade.entryPriceCents - settings.settleStopLossCents);
        const plan = settings.settleTieredExits
          ? settleExitPlan(trade.entryPriceCents)
          : { targetCents: null, staleMinutesLeft: null };

        if (mark <= stopLevel) {
          exitPrice = stopLevel;
          reason = 'stop_loss';
        } else if (
          plan.targetCents != null &&
          mark >= plan.targetCents &&
          mark > trade.entryPriceCents
        ) {
          exitPrice = Math.min(99, Math.max(plan.targetCents, mark));
          reason = 'take_profit';
        } else if (
          plan.staleMinutesLeft != null &&
          minsLeft <= plan.staleMinutesLeft &&
          mark >= trade.entryPriceCents &&
          (plan.targetCents == null || mark < plan.targetCents)
        ) {
          exitPrice = mark;
          reason = 'settle_stale';
        } else if (minute >= trade.closeTime || minute >= trade.settleMinute) {
          const settleCandle = spotAt(tradeIndex, trade.settleMinute) || candle;
          const settledUp = settleCandle.close >= trade.entrySpot;
          const won = trade.side === 'yes' ? settledUp : !settledUp;
          exitPrice = won ? 100 : 0;
          reason = 'settled';
        }
      } else {
        // ── EDGE strategy simulation (original) ──────────────────────────
        const mark = estimateMarkCents(trade.side, trade.entrySpot, spot);
        const stopLevel = Math.max(1, trade.entryPriceCents - settings.stopLossCents);
        const takeProfitLevel =
          settings.takeProfitCents > 0
            ? Math.min(99, trade.entryPriceCents + settings.takeProfitCents)
            : null;

        if (mark <= stopLevel) {
          exitPrice = stopLevel;
          reason = 'stop_loss';
        } else if (
          takeProfitLevel != null &&
          mark >= takeProfitLevel &&
          mark > trade.entryPriceCents
        ) {
          exitPrice = takeProfitLevel;
          reason = 'take_profit';
        } else if (minute >= trade.closeTime || minute >= trade.settleMinute) {
          const settleCandle = spotAt(tradeIndex, trade.settleMinute) || candle;
          const settledUp = settleCandle.close >= trade.entrySpot;
          const won = trade.side === 'yes' ? settledUp : !settledUp;
          exitPrice = won ? 100 : 0;
          reason = 'settled';
        }
      }

      if (exitPrice == null) continue;

      const pnlCents = exitPrice * trade.contracts - trade.entryPriceCents * trade.contracts;
      const flow = applyReserveFlow(pnlCents, reserveCents, insuranceCents, settings, {
        rebuildInsurance: true,
        insuranceReady,
      });
      reserveCents = flow.reserveCents;
      insuranceCents = flow.insuranceCents;
      insuranceReady = !!flow.insuranceReady;
      closedPnlCents += pnlCents;
      closedTrades.push({
        ...trade,
        exitPriceCents: exitPrice,
        exitReason: reason,
        pnlCents,
        skimmedCents: flow.skimmedCents,
        insuranceAddedCents: flow.insuranceAddedCents,
        insuranceDrawnCents: flow.insuranceDrawnCents,
        insuranceOverflowCents: flow.insuranceOverflowCents,
        insuranceReleasedCents: flow.insuranceReleasedCents,
        reserveDrawnCents: 0,
        closedAt: minute,
      });
      openTrades.splice(t, 1);
    }

    // Longevity: first time Available can't fund another stake and nothing is open.
    if (
      brokeAtMs == null &&
      openTrades.length === 0 &&
      availableCash() < minTradeCostCents
    ) {
      brokeAtMs = minute;
    }

    // One equity snapshot per calendar day of the sim (end-of-day-ish).
    if (Number.isFinite(simStartMs)) {
      const dayBucket = Math.floor((minute - simStartMs) / (24 * 60 * 60 * 1000));
      if (dayBucket !== lastDayBucket) {
        lastDayBucket = dayBucket;
        dailyEquity.push({
          day: dayBucket + 1,
          at: minute,
          availableCashCents: availableCash(),
          reservedProfitCents: reserveCents,
          insuranceCents,
          openPositionsValueCents: openExposure(),
          totalEquityCents: totalEquityNow(),
          tradesSoFar: closedTrades.length,
          broke: brokeAtMs != null,
        });
      }
    }

    const bucketStart = Math.floor(minute / FIFTEEN_MIN_MS) * FIFTEEN_MIN_MS;
    const closeTime = bucketStart + FIFTEEN_MIN_MS;
    const minutesRemaining = Math.max(0.1, (closeTime - minute) / 60000);

    // Keep searching for setups throughout the window (like the live bot),
    // not only at the open — but still only one entry per 15m market.
    if (!continuousSearch) {
      const minutesIntoBucket = (minute - bucketStart) / 60000;
      if (minutesIntoBucket > 1.01) continue;
    }
    // Need enough time left for the trade to mean anything.
    const minMinsOpen = settleMode
      ? Math.max(0.5, settings.settleMinMinutesToOpen)
      : 2.5;
    if (minutesRemaining < minMinsOpen) continue;
    if (settleMode && minutesRemaining > settings.settleMaxMinutesToOpen) continue;
    if (timeline[timeline.length - 1] - minute < 3 * MINUTE_MS) continue;

    const alreadyInBucket = openTrades.some((t) => t.bucketStart === bucketStart)
      || closedTrades.some((t) => t.bucketStart === bucketStart);
    if (alreadyInBucket) continue;

    if (openTrades.length >= settings.maxOpenPositions) {
      skipCounts.maxPositions += 1;
      continue;
    }

    const windowKey = pickWindowKey(minutesRemaining);
    const windowDef = WINDOWS.find((w) => w.key === windowKey);

    const candidates = [];
    const predictionBySymbol = {};
    const scanSymbols = tradeSymbols;

    for (const symbol of scanSymbols) {
      const index = indexes[symbol];
      if (!index || !spotAt(index, minute)) {
        skipCounts.notReady += 1;
        continue;
      }

      // Build peer indicators for non-BTC symbols first so BTC can optionally agree.
      if (symbol !== 'BTC' && !indicatorsCache[symbol]) {
        const hist = historyThrough(index, minute);
        if (hist.length >= LOOKBACK_MIN) {
          indicatorsCache[symbol] = gatherIndicators(makeSeries(hist), null);
        }
      }

      let otherInd = null;
      let crossCorrelation = null;
      const hist = historyThrough(index, minute);
      const ind = indicatorsCache[symbol] || gatherIndicators(makeSeries(hist), null);
      if (!ind) {
        skipCounts.notReady += 1;
        continue;
      }
      indicatorsCache[symbol] = ind;

      if (symbol !== 'BTC' && indicatorsCache.BTC && btcIndex) {
        otherInd = indicatorsCache.BTC;
        const btcHistory = historyThrough(btcIndex, minute);
        const n = Math.min(hist.length, btcHistory.length, 60);
        if (n >= 20) {
          crossCorrelation = correlation(
            hist.slice(-n).map((c) => c.close),
            btcHistory.slice(-n).map((c) => c.close)
          );
        }
      } else if (symbol === 'BTC') {
        const peerSym = scanSymbols.find((s) => s !== 'BTC' && indexes[s] && spotAt(indexes[s], minute));
        if (peerSym) {
          const peerHist = historyThrough(indexes[peerSym], minute);
          otherInd = indicatorsCache[peerSym] || gatherIndicators(makeSeries(peerHist), null);
          if (otherInd) {
            indicatorsCache[peerSym] = otherInd;
            const n = Math.min(hist.length, peerHist.length, 60);
            if (n >= 20) {
              crossCorrelation = correlation(
                hist.slice(-n).map((c) => c.close),
                peerHist.slice(-n).map((c) => c.close)
              );
            }
          }
        }
      }

      const spot = hist[hist.length - 1].close;
      const accumulator = accumulatorManager.get(`trade:${symbol}`, windowKey);
      const prediction = buildWindowPrediction(
        windowDef,
        ind,
        otherInd,
        crossCorrelation,
        spot,
        symbol,
        accumulator,
        minute
      );

      // Snapshot for post-stop peer-cascade checks (cryptos often move together).
      predictionBySymbol[symbol] = { ready: true, windows: { w5: prediction } };

      confidenceSamples.push(prediction.confidence);

      // Confidence gate (model uses its own threshold; others use global)
      const confThreshold = modelMode ? ms.modelMinConfidence : settings.minConfidence;
      if (prediction.confidence < confThreshold) {
        skipCounts.lowConfidence += 1;
        continue;
      }

      let side;
      let edge;
      let entryPriceCents;
      if (modelMode) {
        // Model entry: favored side must have lean ≥ minEntryLean AND price in band.
        // We proxy "Kalshi ask" as the favored engine probability (same as live model).
        const favUp = prediction.probabilityUp >= prediction.probabilityDown;
        const favoredProb = favUp ? prediction.probabilityUp : prediction.probabilityDown;
        side = favUp ? 'yes' : 'no';
        // Entry price proxy: favored probability clamped to min/max entry band
        const minE = ms.modelMinEntryCents;
        const maxE = ms.modelMaxEntryCents;
        if (favoredProb < minE || favoredProb > maxE) {
          skipCounts.lowEdge += 1;
          continue;
        }
        // Lean gate: favored prob must be ≥ per-symbol minimum entry lean
        const minLean = modelMinEntryLeanPctForSymbol(symbol, ms);
        if (minLean > 0 && favoredProb < minLean) {
          skipCounts.lowEdge += 1;
          continue;
        }
        // Minimum time to settle window
        const minMinsModel = ms.modelMinMinutesToOpen || 3.5;
        if (minutesRemaining < minMinsModel) continue;
        entryPriceCents = clamp(Math.round(favoredProb), minE, maxE);
        edge = favoredProb - minE; // how far into the entry band
      } else if (settleMode) {
        // Proxy for Kalshi ask in band: engine favored-side % must land in settle band.
        const favUp = prediction.probabilityUp >= prediction.probabilityDown;
        const favoredProb = favUp ? prediction.probabilityUp : prediction.probabilityDown;
        if (
          favoredProb < settings.settleEntryMinCents ||
          favoredProb > settings.settleEntryMaxCents
        ) {
          skipCounts.lowEdge += 1;
          continue;
        }
        side = favUp ? 'yes' : 'no';
        entryPriceCents = clamp(Math.round(favoredProb), settings.settleEntryMinCents, settings.settleEntryMaxCents);
        edge = 100 - entryPriceCents;
      } else {
        const edgeVsBook = prediction.probabilityUp - defaultEntryCents;
        if (Math.abs(edgeVsBook) < settings.edgeThresholdPct) {
          skipCounts.lowEdge += 1;
          continue;
        }
        side = edgeVsBook > 0 ? 'yes' : 'no';
        edge = Math.abs(edgeVsBook);
        entryPriceCents = defaultEntryCents;
      }

      candidates.push({
        symbol,
        side,
        edge,
        entryPriceCents,
        confidence: prediction.confidence,
        probabilityUp: prediction.probabilityUp,
        probabilityDown: prediction.probabilityDown,
        window: prediction.window,
        entrySpot: spot,
        // Prefer strong edge + confidence; slight bonus for more time left
        // so early solid setups aren't ignored, but late spikes can still win.
        rankScore: Math.abs(edge) * (prediction.confidence / 100) * (0.85 + 0.15 * Math.min(1, minutesRemaining / 15)),
      });
    }

    if (candidates.length === 0) continue;

    // Post-stop (same window): peers calm → bounce → knife-catch; session/age clears.
    const lastClosedAnyGate = closedTrades.length ? closedTrades[closedTrades.length - 1] : null;
    const lastStopAny =
      lastClosedAnyGate && lastClosedAnyGate.exitReason === 'stop_loss' ? lastClosedAnyGate : null;
    const seriesMap = Object.fromEntries(symbols.map((s) => [s, true]));
    const afterGates = [];
    for (const c of candidates) {
      const peerCheck = checkPostStopPeerCascade({
        lastStopTrade: lastStopAny,
        candidateSide: c.side,
        predictions: predictionBySymbol,
        seriesBySymbol: seriesMap,
        minConfidence: settings.minConfidence,
        maxAgeMs: peerCascadeMaxAgeMs(settings),
        now: minute,
      });
      if (!peerCheck.ok) {
        skipCounts.postStopPeerCascade += 1;
        continue;
      }

      let recoveryPrice = c.entryPriceCents || defaultEntryCents;
      let recoveryWindow = predictionBySymbol[c.symbol]
        ? predictionBySymbol[c.symbol].windows.w5
        : null;
      if (lastStopAny) {
        const stopIndex = indexes[lastStopAny.symbol];
        const stopCandle = stopIndex ? spotAt(stopIndex, minute) : null;
        if (stopCandle && Number.isFinite(lastStopAny.entrySpot)) {
          recoveryPrice = settleMode
            ? estimateSettleMarkCents(
                lastStopAny.side,
                lastStopAny.entrySpot,
                stopCandle.close,
                lastStopAny.entryPriceCents
              )
            : estimateMarkCents(lastStopAny.side, lastStopAny.entrySpot, stopCandle.close);
        }
        const stoppedSnap = predictionBySymbol[lastStopAny.symbol];
        if (stoppedSnap && stoppedSnap.windows && stoppedSnap.windows.w5) {
          recoveryWindow = stoppedSnap.windows.w5;
        }
      }
      const recoveryCheck = checkPostStopRecovery({
        lastClosedForSymbol: lastStopAny,
        side: lastStopAny ? lastStopAny.side : c.side,
        priceCents: recoveryPrice,
        window: recoveryWindow,
        recoveryCents: stopRecoveryCentsRequired(settings),
        symbol: lastStopAny ? lastStopAny.symbol : c.symbol,
        forCandidateSymbol: c.symbol,
        forCandidateSide: c.side,
        maxAgeMs: stopRecoveryMaxAgeMs(settings),
        sameSideCooldownMs: postStopSameSideCooldownMs(settings),
        now: minute,
      });
      if (!recoveryCheck.ok) {
        skipCounts.postStopRecovery += 1;
        continue;
      }
      afterGates.push(c);
    }
    if (afterGates.length === 0) continue;

    // After a stop-loss, prefer a different coin before re-entering the stopped one.
    const lastClosedAny = closedTrades.length ? closedTrades[closedTrades.length - 1] : null;
    const preferOtherThan =
      lastClosedAny && lastClosedAny.exitReason === 'stop_loss' ? lastClosedAny.symbol : null;

    afterGates.sort((a, b) => {
      if (preferOtherThan) {
        const aPen = a.symbol === preferOtherThan ? 1 : 0;
        const bPen = b.symbol === preferOtherThan ? 1 : 0;
        if (aPen !== bPen) return aPen - bPen;
      }
      return b.rankScore - a.rankScore;
    });
    const best = afterGates[0];

    const lastClosed = closedTrades.length ? closedTrades[closedTrades.length - 1] : null;
    const stakeDollars = computeNextStake(settings, lastClosed);
    const entryCents = clamp(
      Math.round(best.entryPriceCents || defaultEntryCents),
      1,
      99
    );
    const contracts = Math.max(1, Math.floor((stakeDollars * 100) / entryCents));
    const entryCostCents = entryCents * contracts;

    if (entryCostCents > availableCash()) {
      skipCounts.insufficientCash += 1;
      continue;
    }

    const settleMinute = Math.min(
      timeline[timeline.length - 1],
      bucketStart + FIFTEEN_MIN_MS - MINUTE_MS
    );

    openTrades.push({
      symbol: best.symbol,
      side: best.side,
      entryPriceCents: entryCents,
      contracts,
      stakeDollars,
      entrySpot: best.entrySpot,
      // Approximate bid-ask spread (model entries are at ask; mark is at bid).
      // We stamp a 3¢ spread so lean-gated floor / econUnderwater work correctly.
      entrySpread: modelMode ? 3 : 0,
      bucketStart,
      closeTime,
      settleMinute,
      engineProbability: best.side === 'yes' ? best.probabilityUp : best.probabilityDown,
      engineConfidence: best.confidence,
      edge: best.edge,
      window: best.window,
      rankScore: best.rankScore,
      openedAt: minute,
      strategy: modelMode ? 'model' : settleMode ? 'settle' : 'edge',
      // Model state tracking (mirrors bot.js trade object fields)
      peakHeldBidCents: null,
      peakHeldBidAt: null,
      modelEntryHeldProb: best.side === 'yes' ? best.probabilityUp : best.probabilityDown,
    });
    tradesBySymbol[best.symbol] = (tradesBySymbol[best.symbol] || 0) + 1;
  }

  // Force-settle anything still open at end of series.
  for (const trade of openTrades.splice(0)) {
    const tradeIndex = indexes[trade.symbol];
    const endMinute = timeline[timeline.length - 1];
    const endCandle = tradeIndex ? spotAt(tradeIndex, endMinute) : null;
    const endSpot = endCandle ? endCandle.close : trade.entrySpot;
    const settledUp = endSpot >= trade.entrySpot;
    const won = trade.side === 'yes' ? settledUp : !settledUp;
    const exitPrice = won ? 100 : 0;
    const pnlCents = exitPrice * trade.contracts - trade.entryPriceCents * trade.contracts;
    const flow = applyReserveFlow(pnlCents, reserveCents, insuranceCents, settings, {
      rebuildInsurance: true,
      insuranceReady,
    });
    reserveCents = flow.reserveCents;
    insuranceCents = flow.insuranceCents;
    insuranceReady = !!flow.insuranceReady;
    closedPnlCents += pnlCents;
    closedTrades.push({
      ...trade,
      exitPriceCents: exitPrice,
      exitReason: 'end_of_data',
      pnlCents,
      skimmedCents: flow.skimmedCents,
      insuranceAddedCents: flow.insuranceAddedCents,
      insuranceDrawnCents: flow.insuranceDrawnCents,
      insuranceOverflowCents: flow.insuranceOverflowCents,
      insuranceReleasedCents: flow.insuranceReleasedCents,
      reserveDrawnCents: 0,
      closedAt: endMinute,
    });
  }

  const wins = closedTrades.filter((t) => t.pnlCents > 0).length;
  const losses = closedTrades.filter((t) => t.pnlCents <= 0).length;
  const available = availableCash();
  const openPos = openExposure();
  const totalEquity = available + openPos + reserveCents + insuranceCents;
  const netPnl = totalEquity - startingCents;
  const stopLossExits = closedTrades.filter((t) =>
    t.exitReason === 'stop_loss' ||
    t.exitReason === 'model_hard_stop' ||
    t.exitReason === 'model_floor_stop' ||
    t.exitReason === 'model_max_loss'
  ).length;
  const takeProfitExits = closedTrades.filter((t) => t.exitReason === 'take_profit').length;
  const settleStaleExits = closedTrades.filter((t) => t.exitReason === 'settle_stale').length;
  const settledExits = closedTrades.filter((t) => t.exitReason === 'settled' || t.exitReason === 'end_of_data').length;
  const breakevenExits = closedTrades.filter((t) => t.exitReason === 'breakeven').length;
  const modelAgainstExits = closedTrades.filter((t) =>
    t.exitReason === 'model_against' ||
    t.exitReason === 'model_lean_decay' ||
    t.exitReason === 'model_lean_floor' ||
    t.exitReason === 'model_trail_stop' ||
    t.exitReason === 'model_stagnation'
  ).length;
  const modelLateExits = closedTrades.filter((t) =>
    t.exitReason === 'model_late_exit' ||
    t.exitReason === 'model_pre_close'
  ).length;
  const avgConfidenceTaken = closedTrades.length
    ? +(closedTrades.reduce((s, t) => s + t.engineConfidence, 0) / closedTrades.length).toFixed(1)
    : null;
  const avgConfidenceScanned = confidenceSamples.length
    ? +(confidenceSamples.reduce((s, c) => s + c, 0) / confidenceSamples.length).toFixed(1)
    : null;

  // Final end-of-sim day snapshot (so a partial last day still shows).
  if (Number.isFinite(simEndMs) && (dailyEquity.length === 0 || dailyEquity[dailyEquity.length - 1].at !== simEndMs)) {
    dailyEquity.push({
      day: dailyEquity.length + 1,
      at: simEndMs,
      availableCashCents: available,
      reservedProfitCents: reserveCents,
      insuranceCents,
      openPositionsValueCents: openPos,
      totalEquityCents: totalEquity,
      tradesSoFar: closedTrades.length,
      broke: brokeAtMs != null,
    });
  }

  const simulatedMs =
    Number.isFinite(simStartMs) && Number.isFinite(simEndMs) ? Math.max(0, simEndMs - simStartMs) : 0;
  const simulatedHours = +(simulatedMs / (60 * 60 * 1000)).toFixed(2);
  const simulatedDays = +(simulatedHours / 24).toFixed(2);
  const survivedFullPeriod = brokeAtMs == null && available >= minTradeCostCents;
  const hoursUntilBroke =
    brokeAtMs != null && Number.isFinite(simStartMs)
      ? +((brokeAtMs - simStartMs) / (60 * 60 * 1000)).toFixed(2)
      : null;
  const daysUntilBroke = hoursUntilBroke != null ? +(hoursUntilBroke / 24).toFixed(2) : null;
  const daysSurvived = survivedFullPeriod
    ? simulatedDays
    : daysUntilBroke != null
      ? daysUntilBroke
      : simulatedDays;

  return {
    settings,
    mode: autoMode ? 'AUTO' : 'single',
    symbolsScanned: tradeSymbols,
    trades: closedTrades.length,
    tradesBySymbol,
    wins,
    losses,
    winRatePct: closedTrades.length ? +((wins / closedTrades.length) * 100).toFixed(1) : null,
    stopLossExits,
    takeProfitExits,
    settleStaleExits,
    settledExits,
    breakevenExits,
    modelAgainstExits,
    modelLateExits,
    avgConfidenceTaken,
    avgConfidenceScanned,
    startingBankrollCents: startingCents,
    availableCashCents: available,
    openPositionsValueCents: openPos,
    reservedProfitCents: reserveCents,
    insuranceCents,
    totalEquityCents: totalEquity,
    netPnlCents: netPnl,
    grossClosedPnlCents: closedPnlCents,
    skipCounts,
    longevity: {
      simulatedHours,
      simulatedDays,
      survivedFullPeriod,
      broke: brokeAtMs != null,
      hoursUntilBroke,
      daysUntilBroke,
      daysSurvived,
      minTradeCostCents,
      dailyEquity,
    },
    recentTrades: closedTrades.slice(-20).reverse().map((t) => ({
      symbol: t.symbol,
      side: t.side,
      window: t.window,
      stakeDollars: t.stakeDollars,
      confidence: t.engineConfidence,
      edge: +t.edge.toFixed(1),
      pnlDollars: +(t.pnlCents / 100).toFixed(2),
      exitReason: t.exitReason,
    })),
    modelSettings: modelMode ? ms : null,
    note:
      (autoMode
        ? 'AUTO mode: continuously scanned all listed cryptos and traded only the best opportunity that cleared your confidence + edge settings (same ranking idea as live AUTO). '
        : 'Continuously searched for setups during each 15-minute window (not only at the open). ') +
      'Simulated continuous running time (full 24h days of minute data), not just market open hours. Longevity = how long Available Cash could still fund another stake before going dry. ' +
      (modelMode
        ? 'MODEL mode: entry uses engine favored-% as a proxy for Kalshi ask; lean is synthesized from the spot price move (no historical Kalshi order books). All model stop/TP/trail/lean-exit rules apply — hard-stop, floor-stop, trail, stagnation, lean-decay, late-barrier hold-to-settle. Results are directionally accurate but lean values are approximate. '
        : settleMode
          ? 'SETTLE mode: entry ≈ engine favored % inside the settle band; marks drift from that entry with spot (no historical Kalshi books). Tiered TP/stale exits match live settleExitPlan when enabled. '
          : 'Kalshi quotes are assumed even-money (50¢ entry) because historical Kalshi order books are not available — real fill prices and edges will differ. Order-book signals are also excluded.'),
  };
}

/**
 * Score a trading result for the settings hunt — prioritizes profit, then
 * win rate, with a soft preference for enough sample size.
 */
function scoreTradingResult(trading) {
  const trades = trading.trades || 0;
  const wr = trading.winRatePct;
  const pnlDollars = (trading.netPnlCents || 0) / 100;
  if (trades < 3 || wr == null) return -1e9;
  return pnlDollars * 12 + wr * 2.5 + Math.min(trades, 40) * 0.2;
}

/**
 * Grid-search edge + confidence (+ a few stop-loss values) while keeping the
 * user's stake/skim/bankroll fixed. Returns the best combo for win rate + profit.
 */
function huntBestSettings(candlesBySymbol, baseSettings = {}, runOptions = {}) {
  const base = normalizeSettings(baseSettings);
  const edgeGrid = [5, 8, 10, 12, 15, 18, 22, 25];
  const confGrid = [50, 55, 60, 65, 70, 75, 80];
  const stopGrid = [8, 10, 12, 15, 20].includes(base.stopLossCents)
    ? [base.stopLossCents, 8, 10, 12, 15].filter((v, i, arr) => arr.indexOf(v) === i)
    : [base.stopLossCents, 8, 10, 12, 15];

  const candidates = [];
  const huntOpts = {
    stepMinutes: runOptions.stepMinutes || 2,
    mode: runOptions.mode || 'AUTO',
    focusSymbol: runOptions.focusSymbol || null,
    continuousSearch: true,
  };

  for (const edgeThresholdPct of edgeGrid) {
    for (const minConfidence of confGrid) {
      for (const stopLossCents of stopGrid) {
        const settings = {
          ...base,
          edgeThresholdPct,
          minConfidence,
          stopLossCents,
        };
        const trading = backtestWithSettings(candlesBySymbol, settings, huntOpts);
        const score = scoreTradingResult(trading);
        candidates.push({
          score,
          settings: {
            edgeThresholdPct,
            minConfidence,
            stopLossCents,
            takeProfitCents: base.takeProfitCents,
            stakeDollars: base.stakeDollars,
            maxOpenPositions: base.maxOpenPositions,
            paperStartingBalanceDollars: base.paperStartingBalanceDollars,
            skimMode: base.skimMode,
            skimPercent: base.skimPercent,
            skimFixedDollars: base.skimFixedDollars,
            insuranceCapDollars: base.insuranceCapDollars,
            insuranceFloorDollars: base.insuranceFloorDollars,
            insuranceOverflowDollars: base.insuranceOverflowDollars,
          },
          trades: trading.trades,
          wins: trading.wins,
          losses: trading.losses,
          winRatePct: trading.winRatePct,
          netPnlCents: trading.netPnlCents,
          totalEquityCents: trading.totalEquityCents,
          avgConfidenceTaken: trading.avgConfidenceTaken,
          tradesBySymbol: trading.tradesBySymbol,
        });
      }
    }
  }

  candidates.sort((a, b) => b.score - a.score);
  const best = candidates[0] || null;
  const top = candidates.filter((c) => c.score > -1e8).slice(0, 8);

  // Full continuous sim of the winner at step=1 for the reported trading block.
  let bestTrading = null;
  if (best) {
    bestTrading = backtestWithSettings(
      candlesBySymbol,
      { ...base, ...best.settings },
      {
        stepMinutes: 1,
        mode: huntOpts.mode,
        focusSymbol: huntOpts.focusSymbol,
        continuousSearch: true,
      }
    );
  }

  return {
    best,
    top,
    bestTrading,
    searched: candidates.length,
    note:
      'Hunted edge × confidence × stop-loss while keeping your stake/skim/bankroll. Ranked for higher net profit and win rate (min 3 trades). Continuous AUTO-style scanning used throughout.',
  };
}

module.exports = {
  backtestSymbol,
  backtestWithSettings,
  huntBestSettings,
  normalizeSettings,
  normalizeModelSettings,
  estimateSettleMarkCents,
  estimateModelMarkCents,
  LOOKBACK_MIN,
};
