const express = require('express');
const router = express.Router();
const { marketDataService, marketMetrics } = require('../services');
const cacheManager = require('../utils/cache');
const logger = require('../utils/logger');

/**
 * GET /api/ai-market-analyzer/btc
 * Returns comprehensive BTC market analysis with whale vs retail intelligence
 * Cached for 30 minutes (configurable)
 */
router.get('/btc', async (req, res) => {
  const cacheKey = 'market_snapshot_btc';
  
  try {
    // Check if we want to force refresh
    const forceRefresh = req.query.refresh === 'true';

    // Try to get from cache first (unless force refresh)
    if (!forceRefresh) {
      const cached = cacheManager.get(cacheKey);
      if (cached) {
        logger.info('Returning cached market data');
        
        // Extract the actual response from cache
        // cache.get() returns { data, age, cachedAt }
        const cachedResponse = cached.data;
        
        return res.json({
          success: cachedResponse.success,
          data: cachedResponse.data,
          meta: {
            ...cachedResponse.meta,
            cached: true,
            cached_at: cached.cachedAt,
            age_minutes: Math.floor(cached.age / 60000)
          }
        });
      }
    }

    // Fetch fresh data with history
    logger.info('Fetching fresh market data from Coinglass...');
    const { snapshot, history } = await marketDataService.getFuturesMarketData('BTCUSDT');

    // Calculate comprehensive metrics
    logger.info('Calculating market metrics...');
    const metrics = marketMetrics.calculateMarketMetrics(snapshot, history);

    // Build response
    const response = {
      success: true,
      data: metrics,
      meta: {
        cached: false,
        timestamp: new Date().toISOString(),
        source: 'coinglass_api_v4',
        exchange_mapping: {
          binance: 'BTCUSDT (USDT-margined)',
          bybit: 'BTCUSD (coin-margined)'
        }
      }
    };

    // Store in cache
    cacheManager.set(cacheKey, response);
    logger.info('Market data fetched and cached successfully');

    res.json(response);

  } catch (error) {
    logger.error('Error in /api/ai-market-analyzer/btc:', error);
    res.status(500).json({
      success: false,
      error: 'failed_to_fetch_market_data',
      message: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * GET /api/ai-market-analyzer/cache-stats
 * Returns cache statistics (useful for debugging)
 */
router.get('/cache-stats', (req, res) => {
  const stats = cacheManager.getStats();
  res.json({
    success: true,
    data: stats
  });
});

/**
 * POST /api/ai-market-analyzer/clear-cache
 * Manually clear cache (useful for testing)
 */
router.post('/clear-cache', (req, res) => {
  const key = req.body.key;
  
  if (key) {
    const cleared = cacheManager.clear(key);
    res.json({
      success: cleared,
      message: cleared ? `Cache cleared for key: ${key}` : `Key not found: ${key}`
    });
  } else {
    cacheManager.clearAll();
    res.json({
      success: true,
      message: 'All cache cleared'
    });
  }
});

/**
 * GET /api/ai-market-analyzer/health
 * Health check for the analyzer service
 */
router.get('/health', (req, res) => {
  res.json({
    success: true,
    service: 'ai-market-analyzer',
    status: 'operational',
    features: {
      exchange_divergence: '9 scenarios',
      market_regime: '7 regimes',
      technical_analysis: 'EMA, momentum, volatility',
      funding_analysis: 'Z-score, extremes',
      weighted_decision: '5 signals'
    },
    timestamp: new Date().toISOString()
  });
});

module.exports = router;
