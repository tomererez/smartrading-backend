// marketDataService.js
// Responsible for fetching + unifying Futures market data for AI models

const axios = require("axios");

const BASE_URL = "https://open-api-v4.coinglass.com/api";
const API_KEY = process.env.COINGLASS_API_KEY;

// ---------------------------
// Generic request wrapper
// ---------------------------
async function coinglassGET(endpoint, params = {}) {
  try {
    const { data } = await axios.get(`${BASE_URL}${endpoint}`, {
      params,
      headers: {
        accept: "application/json",
        "CG-API-KEY": API_KEY
      }
    });

    if (data.code !== "0") {
      console.warn("⚠️ Coinglass API warning:", endpoint, params, data.msg);
      return [];
    }

    return data.data || [];
  } catch (err) {
    console.error(`❌ Coinglass error at ${endpoint}:`, err?.response?.data || err.message);
    return [];
  }
}

// ---------------------------
// Fetchers
// ---------------------------

// Price OHLC
async function getPriceOHLC(exchange, symbol, interval = "4h", limit = 10) {
  return await coinglassGET("/futures/price/history", {
    exchange,
    symbol,
    interval,
    limit,
  });
}

// Open Interest OHLC
async function getOpenInterestOHLC(exchange, symbol, interval = "4h", limit = 10) {
  return await coinglassGET("/futures/open-interest/history", {
    exchange,
    symbol,
    interval,
    limit,
  });
}

// Funding Rate OHLC
async function getFundingRateOHLC(exchange, symbol, interval = "4h", limit = 10) {
  return await coinglassGET("/futures/funding-rate/history", {
    exchange,
    symbol,
    interval,
    limit,
  });
}

// Taker Buy/Sell (CVD)
async function getTakerBuySellVolume(exchange, symbol, interval = "h4", limit = 100) {
  return await coinglassGET("/futures/v2/taker-buy-sell-volume/history", {
    exchange,
    symbol,
    interval,
    limit,
  });
}

// ---------------------------
// Historical Data Fetchers (NEW)
// ---------------------------

// Get price history for technical analysis
async function getPriceHistory(exchange, symbol, interval = "4h", limit = 50) {
  const data = await coinglassGET("/futures/price/history", {
    exchange,
    symbol,
    interval,
    limit,
  });
  
  // Transform to consistent format
  return data.map(candle => ({
    time: candle.time,
    open: Number(candle.open),
    high: Number(candle.high),
    low: Number(candle.low),
    close: Number(candle.close),
    volume: Number(candle.volume_usd || 0),
    price: Number(candle.close) // Alias for marketMetrics
  }));
}

// Get OI history for technical analysis
async function getOIHistory(exchange, symbol, interval = "4h", limit = 50) {
  const data = await coinglassGET("/futures/open-interest/history", {
    exchange,
    symbol,
    interval,
    limit,
  });
  
  return data.map(candle => ({
    time: candle.time,
    open: Number(candle.open || candle.o),
    high: Number(candle.high || candle.h),
    low: Number(candle.low || candle.l),
    close: Number(candle.close || candle.c),
    oi: Number(candle.close || candle.c) // Alias for marketMetrics
  }));
}

// Get funding rate history for technical analysis
async function getFundingHistory(exchange, symbol, interval = "4h", limit = 30) {
  const data = await coinglassGET("/futures/funding-rate/history", {
    exchange,
    symbol,
    interval,
    limit,
  });
  
  return data.map(candle => ({
    time: candle.time,
    open: Number(candle.open),
    high: Number(candle.high),
    low: Number(candle.low),
    close: Number(candle.close),
    rate: Number(candle.close), // Alias for marketMetrics
    funding_rate_avg_pct: Number(candle.close * 100) // Convert to percentage
  }));
}

// ---------------------------
// Calculations
// ---------------------------

// Price / OI change %
function calculateChange(latest, previous) {
  if (!latest || !previous || previous === 0) return null;
  return Number((((latest - previous) / previous) * 100).toFixed(2));
}

// Extract volume from price OHLC - flexible based on use case
function extractVolumeFromPriceOHLC(priceData, mode = "single") {
  if (!priceData?.length) return { volume: null, volume_sum: null };
  
  const lastCandle = priceData[priceData.length - 1];
  const singleVolume = Number(lastCandle.volume_usd || 0);
  
  // Sum all volumes for macro analysis
  const totalVolume = priceData.reduce((acc, candle) => {
    return acc + Number(candle.volume_usd || 0);
  }, 0);
  
  return {
    volume: Number(singleVolume.toFixed(2)),      // Last candle only
    volume_sum: Number(totalVolume.toFixed(2)),    // Sum of all candles (for macro)
    volume_avg: Number((totalVolume / priceData.length).toFixed(2)) // Average per candle
  };
}

// CVD (Taker Buy vs Sell)
function calculateCVD(takerData) {
  if (!takerData?.length) return 0;

  const cvd = takerData.reduce((acc, c) => {
    const buy = Number(c.taker_buy_volume_usd || c.buyVol || 0);
    const sell = Number(c.taker_sell_volume_usd || c.sellVol || 0);
    return acc + (buy - sell);
  }, 0);

  return Number(cvd.toFixed(2));
}

// Funding rate average - INCLUDE NEGATIVE VALUES
function calculateFundingAverage(fundingData) {
  if (!fundingData?.length) return null;

  // Extract close values and convert to numbers - KEEP NEGATIVE VALUES
  const values = fundingData
    .map(c => Number(c.close || c.rate || c.fundingRate || 0))
    .filter(v => !Number.isNaN(v)); // Only filter NaN, keep negative and zero

  if (values.length === 0) return null;

  const sum = values.reduce((a, b) => a + b, 0);
  const avg = sum / values.length;
  
  // Return as percentage with 4 decimals (e.g., 0.0056 = 0.56%)
  return Number((avg * 100).toFixed(4));
}

// ---------------------------
// Unified Market Snapshot Builder
// ---------------------------

async function getMarketSnapshot(exchange, symbol, intervals = ["4h", "1d"]) {
  const result = {};

  for (const tf of intervals) {
    const [
      priceOHLC,
      oiOHLC,
      fundingOHLC,
      takerVolume
    ] = await Promise.all([
      getPriceOHLC(exchange, symbol, tf, 10),
      getOpenInterestOHLC(exchange, symbol, tf, 10),
      getFundingRateOHLC(exchange, symbol, tf, 10),
      getTakerBuySellVolume(exchange, symbol, tf === "4h" ? "h4" : "h24", 100),
    ]);

    // Validate we have enough data (at least 2 candles for change calculation)
    if (!priceOHLC?.length || priceOHLC.length < 2 || 
        !oiOHLC?.length || oiOHLC.length < 2) {
      console.warn(`⚠️ Insufficient data for ${exchange} ${symbol} ${tf}`);
      result[tf] = null;
      continue;
    }

    // Arrays are returned in chronological order, so LAST item is the latest
    const latestPrice = priceOHLC[priceOHLC.length - 1];
    const previousPrice = priceOHLC[priceOHLC.length - 2];
    const latestOI = oiOHLC[oiOHLC.length - 1];
    const previousOI = oiOHLC[oiOHLC.length - 2];

    const volumeData = extractVolumeFromPriceOHLC(priceOHLC);

    result[tf] = {
      price: Number(latestPrice?.close || 0),
      price_change: calculateChange(
        Number(latestPrice?.close || 0),
        Number(previousPrice?.close || 0)
      ),
      oi: Number(latestOI?.close || latestOI?.high || 0),
      oi_change: calculateChange(
        Number(latestOI?.close || latestOI?.high || 0),
        Number(previousOI?.close || previousOI?.high || 0)
      ),
      volume: volumeData.volume,           // Last candle volume (for micro analysis)
      volume_sum: volumeData.volume_sum,   // Sum of 10 candles (for macro analysis)
      volume_avg: volumeData.volume_avg,   // Average per candle
      cvd: calculateCVD(takerVolume),
      funding_rate_avg_pct: calculateFundingAverage(fundingOHLC),
    };
  }

  return result;
}

// ---------------------------
// Main exported function (UPDATED)
// ---------------------------
async function getFuturesMarketData(symbol = "BTCUSDT", options = {}) {
  const {
    includeHistory = true,
    timeframes = ["4h", "1d"], // Default: macro analysis
    // Available timeframes: "1m", "5m", "15m", "30m", "1h", "4h", "1d"
  } = options;

  const exchanges = ["Binance", "Bybit"];
  const snapshot = {};

  // Fetch snapshot data for both exchanges
  for (const ex of exchanges) {
    // Map symbol for Bybit - use COIN-MARGINED (BTCUSD) instead of USDT-M
    let exSymbol = symbol;
    if (ex === "Bybit" && symbol === "BTCUSDT") {
      exSymbol = "BTCUSD"; // Bybit coin-margined = smart money
    }
    
    try {
      snapshot[ex] = await getMarketSnapshotMultiTF(ex, exSymbol, timeframes);
    } catch (err) {
      console.error(`❌ Error fetching data for ${ex}:`, err.message);
      snapshot[ex] = null;
    }
  }

  // If history is not requested, return only snapshot
  if (!includeHistory) {
    return snapshot;
  }

  // Fetch historical data (using Binance as primary source)
  // Use the primary timeframe (first in array) for historical analysis
  const primaryTF = timeframes[0] || "4h";
  let history = {
    priceHistory: [],
    oiHistory: [],
    fundingHistory: []
  };

  try {
    const [priceHist, oiHist, fundingHist] = await Promise.all([
      getPriceHistory("Binance", symbol, primaryTF, 50),
      getOIHistory("Binance", symbol, primaryTF, 50),
      getFundingHistory("Binance", symbol, primaryTF, 30)
    ]);

    history = {
      priceHistory: priceHist,
      oiHistory: oiHist,
      fundingHistory: fundingHist
    };
  } catch (err) {
    console.error(`⚠️ Error fetching historical data:`, err.message);
  }

  return {
    snapshot,
    history
  };
}

// Helper function for multi-timeframe snapshot
async function getMarketSnapshotMultiTF(exchange, symbol, timeframes) {
  const result = {};
  
  for (const tf of timeframes) {
    try {
      const snapshotData = await getMarketSnapshot(exchange, symbol, [tf]);
      result[tf] = snapshotData[tf];
    } catch (err) {
      console.error(`⚠️ Error fetching ${exchange} ${symbol} ${tf}:`, err.message);
      result[tf] = null;
    }
  }
  
  return result;
}

// ---------------------------
// Exports
// ---------------------------
module.exports = {
  getFuturesMarketData,
  getPriceOHLC,
  getOpenInterestOHLC,
  getFundingRateOHLC,
  getTakerBuySellVolume,
  getPriceHistory,
  getOIHistory,
  getFundingHistory,
  calculateChange,
  calculateCVD,
  calculateFundingAverage,
  getMarketSnapshot,
  getMarketSnapshotMultiTF
};
