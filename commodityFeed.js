'use strict';

const EventEmitter = require('events');
const WebSocket = require('ws');
const fetch = globalThis.fetch
  ? (...args) => globalThis.fetch(...args)
  : require('node-fetch');

// Polygon.io free tier: up to 1 connection, 5 API calls/min on the Stocks plan.
// For Forex/Crypto the free tier allows WebSocket streaming on the free plan.
// Commodity tickers on Polygon: C:XAUUSD (Gold), C:XAGUSD (Silver), C:USOILUSD (Oil/WTI)
// Set POLYGON_API_KEY in your environment to enable live commodity data.

const POLYGON_WS_URL = 'wss://socket.polygon.io/forex';
const POLYGON_REST_BASE = 'https://api.polygon.io';

// Map our internal symbols to Polygon forex/commodity tickers.
const POLYGON_TICKER = {
  GOLD: 'C:XAUUSD',
  SILVER: 'C:XAGUSD',
  OIL: 'C:USOILUSD',
};

// Rough multipliers: Polygon forex gives bid/ask mid; we treat it as a trade print.
// OIL on Polygon is available as 'C:USOILUSD'; if that's unavailable use 'X:WTIUSD' from the Crypto feed.

const CANDLE_SECONDS = 60;
const MAX_CANDLES = 300;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Fetches up to MAX_CANDLES 1-minute bars from Polygon REST for seeding.
 * Returns array of { time, open, high, low, close, volume } sorted oldest→newest.
 */
async function fetchPolygonCandles(polygonTicker, apiKey) {
  const end = new Date();
  const start = new Date(end.getTime() - MAX_CANDLES * CANDLE_SECONDS * 1000);
  const from = start.toISOString().slice(0, 10);
  const to = end.toISOString().slice(0, 10);
  const url =
    `${POLYGON_REST_BASE}/v2/aggs/ticker/${encodeURIComponent(polygonTicker)}/range/1/minute/${from}/${to}` +
    `?adjusted=false&sort=asc&limit=${MAX_CANDLES}&apiKey=${apiKey}`;
  const res = await fetch(url, { headers: { 'User-Agent': 'crypto-prediction-engine' } });
  if (!res.ok) throw new Error(`Polygon candles HTTP ${res.status} for ${polygonTicker}`);
  const data = await res.json();
  const results = Array.isArray(data.results) ? data.results : [];
  return results.map((r) => ({
    time: r.t, // already ms
    open: r.o,
    high: r.h,
    low: r.l,
    close: r.c,
    volume: r.v || 0,
  }));
}

/**
 * Streams live commodity/forex prices from Polygon WebSocket.
 * Emits 'trade' events shaped like CoinbaseFeed: { productId, price, size, time }.
 * productId is our internal symbol (GOLD/SILVER/OIL).
 *
 * On disconnect, auto-reconnects with exponential backoff.
 * If no API key is set, the feed simply never connects and logs a warning once.
 */
class CommodityFeed extends EventEmitter {
  constructor(symbols, apiKey) {
    super();
    this.symbols = symbols; // e.g. ['GOLD', 'SILVER', 'OIL']
    this.apiKey = apiKey || '';
    this.ws = null;
    this.reconnectDelay = 2000;
    this.maxReconnectDelay = 60000;
    this.closedByUser = false;
    this._authenticated = false;
  }

  connect() {
    if (!this.apiKey) {
      console.warn('[commodity-feed] No POLYGON_API_KEY set — commodity symbols (GOLD/SILVER/OIL) will have no live price feed.');
      return;
    }
    this.closedByUser = false;
    this.ws = new WebSocket(POLYGON_WS_URL);

    this.ws.on('open', () => {
      this.reconnectDelay = 2000;
      // Authentication required first.
      this.ws.send(JSON.stringify({ action: 'auth', params: this.apiKey }));
    });

    this.ws.on('message', (raw) => {
      let msgs;
      try { msgs = JSON.parse(raw.toString()); } catch { return; }
      if (!Array.isArray(msgs)) msgs = [msgs];
      for (const msg of msgs) this._handleMessage(msg);
    });

    this.ws.on('close', () => {
      this._authenticated = false;
      this.emit('disconnected');
      if (!this.closedByUser) this._scheduleReconnect();
    });

    this.ws.on('error', (err) => {
      this.emit('error', err);
    });
  }

  _subscribeAll() {
    const tickers = this.symbols
      .map((s) => POLYGON_TICKER[s])
      .filter(Boolean)
      .map((t) => `C.${t}`); // Polygon forex aggregate: "C.C:XAUUSD"
    if (!tickers.length) return;
    this.ws.send(JSON.stringify({ action: 'subscribe', params: tickers.join(',') }));
    this.emit('connected');
  }

  _handleMessage(msg) {
    if (!msg || !msg.ev) return;
    switch (msg.ev) {
      case 'status':
        if (msg.status === 'auth_success') {
          this._authenticated = true;
          this._subscribeAll();
        } else if (msg.status === 'auth_failed') {
          console.error('[commodity-feed] Polygon auth failed — check POLYGON_API_KEY');
          this.close();
        }
        break;
      // "C" = Forex aggregate (per-second or per-minute bar depending on subscription)
      case 'C': {
        const sym = this._symbolFromTicker(msg.pair ? `C:${msg.pair}` : msg.sym);
        if (!sym) break;
        // mid-price from the aggregate
        const price = msg.c != null ? msg.c : (msg.a != null && msg.b != null ? (msg.a + msg.b) / 2 : null);
        if (price == null) break;
        this.emit('trade', {
          productId: sym,
          price,
          size: msg.v || 1,
          time: msg.e || msg.s || Date.now(),
        });
        break;
      }
      // "CA" = Forex aggregate (minute)
      case 'CA': {
        const sym = this._symbolFromTicker(msg.pair ? `C:${msg.pair}` : msg.sym);
        if (!sym) break;
        const price = msg.c != null ? msg.c : null;
        if (price == null) break;
        this.emit('trade', {
          productId: sym,
          price,
          size: msg.v || 1,
          time: msg.e || msg.s || Date.now(),
        });
        break;
      }
      default:
        break;
    }
  }

  _symbolFromTicker(polygonTicker) {
    const t = String(polygonTicker || '').toUpperCase();
    for (const [sym, pt] of Object.entries(POLYGON_TICKER)) {
      if (t === pt.toUpperCase() || t === pt.replace('C:', '').toUpperCase()) return sym;
    }
    return null;
  }

  _scheduleReconnect() {
    setTimeout(() => this.connect(), this.reconnectDelay);
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, this.maxReconnectDelay);
  }

  close() {
    this.closedByUser = true;
    if (this.ws) this.ws.close();
  }
}

/**
 * Seeds historical candles for commodity symbols via Polygon REST.
 * Returns a map: { GOLD: [...candles], SILVER: [...candles], OIL: [...candles] }
 * Gracefully returns empty arrays when the API key is missing or the request fails.
 */
async function seedCommodityCandles(symbols, apiKey) {
  if (!apiKey) return Object.fromEntries(symbols.map((s) => [s, []]));
  const results = {};
  for (const sym of symbols) {
    const ticker = POLYGON_TICKER[sym];
    if (!ticker) { results[sym] = []; continue; }
    try {
      results[sym] = await fetchPolygonCandles(ticker, apiKey);
      await sleep(250); // be polite to the free-tier rate limit
    } catch (err) {
      console.error(`[commodity-feed] seed failed for ${sym}:`, err.message);
      results[sym] = [];
    }
  }
  return results;
}

module.exports = { CommodityFeed, seedCommodityCandles, POLYGON_TICKER, CANDLE_SECONDS, MAX_CANDLES };
