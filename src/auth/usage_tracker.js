import fs from 'fs';
import path from 'path';
import { log } from '../utils/logger.js';
import { getDataDir, getConfigPaths } from '../utils/paths.js';
import { getStore } from '../store/index.js';

// Model pricing in USD per 1,000,000 tokens
export const MODEL_PRICES = {
  opus: { input: 15.00, output: 75.00, cacheWrite: 18.75, cacheRead: 1.50 },
  sonnet: { input: 3.00, output: 15.00, cacheWrite: 3.75, cacheRead: 0.30 },
  pro: { input: 1.25, output: 5.00, cacheWrite: 1.25, cacheRead: 0.3125 },
  lite: { input: 0.0375, output: 0.15, cacheWrite: 0.0375, cacheRead: 0.009375 },
  flash: { input: 0.075, output: 0.30, cacheWrite: 0.075, cacheRead: 0.01875 }
};

// Dynamically load models.json
let loadedPrices = {};
try {
  const paths = getConfigPaths();
  if (fs.existsSync(paths.modelsJsonPath)) {
    loadedPrices = JSON.parse(fs.readFileSync(paths.modelsJsonPath, 'utf8'));
  } else if (fs.existsSync(paths.modelsJsonExamplePath)) {
    loadedPrices = JSON.parse(fs.readFileSync(paths.modelsJsonExamplePath, 'utf8'));
  }
} catch (err) {
  log.error('加载 models.json 失败, 将使用硬编码的后备价格配置:', err.message);
}

/**
 * Get pricing for a given model ID
 */
export function getModelPricing(modelId) {
  const model = modelId.toLowerCase();
  
  // 1. Direct key match
  if (loadedPrices[modelId]) {
    return loadedPrices[modelId];
  }
  
  // 2. Case-insensitive key match
  for (const key of Object.keys(loadedPrices)) {
    if (key.toLowerCase() === model) {
      return loadedPrices[key];
    }
  }
  
  // 3. Fallback to hardcoded fuzzy patterns
  let prices = MODEL_PRICES.flash;
  if (model.includes('opus')) {
    prices = MODEL_PRICES.opus;
  } else if (model.includes('sonnet')) {
    prices = MODEL_PRICES.sonnet;
  } else if (model.includes('pro')) {
    prices = MODEL_PRICES.pro;
  } else if (model.includes('lite')) {
    prices = MODEL_PRICES.lite;
  }
  return prices;
}

/**
 * Calculate cost for a request
 */
export function calculateCost(modelId, promptTokens, completionTokens, cachedReadTokens, cachedWriteTokens) {
  const model = modelId.toLowerCase();
  const pricing = getModelPricing(modelId);

  // If flat fee model
  if (pricing.isFlatFee) {
    return pricing.flatFee ?? 0.03;
  }

  if (model.includes('-image') || model.includes('banana')) {
    return pricing.flatFee ?? 0.03;
  }

  const normalInputTokens = Math.max(0, promptTokens - cachedReadTokens - cachedWriteTokens);
  
  const cost = (
    (normalInputTokens * (pricing.input ?? 0)) +
    (completionTokens * (pricing.output ?? 0)) +
    (cachedReadTokens * (pricing.cacheRead ?? 0)) +
    (cachedWriteTokens * (pricing.cacheWrite ?? 0))
  ) / 1000000;

  return Number(cost.toFixed(6));
}

class UsageTracker {
  constructor(filePath = path.join(getDataDir(), 'usage.json')) {
    this.filePath = filePath;
    this.usageData = {};
    this._saveTimer = null;
    this.ensureFileExists();
    this.loadFromFile();
  }

  async initFromStore() {
    try {
      const store = getStore();
      const storeData = await store.get('usage');
      if (storeData && typeof storeData === 'object' && Object.keys(storeData).length > 0) {
        this.usageData = storeData;
        log.info(`[UsageTracker] 从 store 加载了 ${Object.keys(storeData).length} 个账号的使用量`);
      }
    } catch (e) {
      log.warn(`[UsageTracker] initFromStore failed: ${e.message}`);
    }
  }

  ensureFileExists() {
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    if (!fs.existsSync(this.filePath)) {
      fs.writeFileSync(this.filePath, JSON.stringify({}, null, 2), 'utf8');
    }
  }

  loadFromFile() {
    try {
      const data = fs.readFileSync(this.filePath, 'utf8');
      this.usageData = JSON.parse(data);
    } catch (error) {
      log.error('加载使用量记录文件失败:', error.message);
      this.usageData = {};
    }
  }

  saveToFile() {
    try {
      fs.writeFileSync(this.filePath, JSON.stringify(this.usageData, null, 2), 'utf8');
    } catch (error) {
      log.error('保存使用量记录文件失败:', error.message);
    }
  }

  _debouncedSave() {
    if (this._saveTimer) clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => {
      this.saveToFile();
      const store = getStore();
      if (store.isCloudEnabled) {
        store.set('usage', this.usageData).catch(e => {
          log.warn(`[UsageTracker] cloud write failed: ${e.message}`);
        });
      }
    }, 1000);
    if (this._saveTimer.unref) this._saveTimer.unref();
  }

  /**
   * Record usage for a specific token and model
   * @param {string} tokenId - Token ID
   * @param {string} modelId - Model ID
   * @param {Object} [usageMetadata={}] - Upstream usage metadata
   * @param {boolean} [hasSessionId=false] - Whether session ID / caching is active
   */
  recordUsage(tokenId, modelId, usageMetadata = {}, hasSessionId = false) {
    if (!tokenId || !modelId) return;

    const promptTokens = usageMetadata.promptTokenCount || 0;
    const thoughtsTokens = usageMetadata.thoughtsTokenCount || 0;
    const completionTokens = (usageMetadata.candidatesTokenCount || 0) + thoughtsTokens;
    const cachedReadTokens = usageMetadata.cachedContentTokenCount || 0;
    
    // Determine cache write tokens:
    // If sessionId is active and cache was hit (cachedReadTokens > 0):
    // cachedWriteTokens is promptTokens - cachedReadTokens.
    // If cache was not hit (cachedReadTokens is 0), cachedWriteTokens is 0.
    let cachedWriteTokens = 0;
    if (hasSessionId && cachedReadTokens > 0) {
      cachedWriteTokens = Math.max(0, promptTokens - cachedReadTokens);
    }

    const cost = calculateCost(modelId, promptTokens, completionTokens, cachedReadTokens, cachedWriteTokens);

    // Initialize or migrate format
    if (!this.usageData[tokenId]) {
      this.usageData[tokenId] = {
        summary: {},
        history: []
      };
    } else if (!this.usageData[tokenId].summary || !this.usageData[tokenId].history) {
      // Migrate old format to new format
      const oldUsage = this.usageData[tokenId];
      this.usageData[tokenId] = {
        summary: oldUsage,
        history: []
      };
    }

    const tokenUsage = this.usageData[tokenId];

    if (!tokenUsage.summary[modelId]) {
      tokenUsage.summary[modelId] = {
        requests: 0,
        promptTokens: 0,
        completionTokens: 0,
        cachedReadTokens: 0,
        cachedWriteTokens: 0,
        cost: 0
      };
    }

    const record = tokenUsage.summary[modelId];
    record.requests += 1;
    record.promptTokens += promptTokens;
    record.completionTokens += completionTokens;
    record.cachedReadTokens += cachedReadTokens;
    record.cachedWriteTokens += cachedWriteTokens;
    record.cost = Number((record.cost + cost).toFixed(6));

    // Record individual request history
    tokenUsage.history.push({
      timestamp: new Date().toISOString(),
      modelId,
      promptTokens,
      completionTokens,
      cachedReadTokens,
      cachedWriteTokens,
      cost: Number(cost.toFixed(6))
    });

    // Prevent history array from growing infinitely (limit to last 2000 requests)
    if (tokenUsage.history.length > 2000) {
      tokenUsage.history.shift();
    }

    this._debouncedSave();
  }

  /**
   * Get usage for a specific token
   * @param {string} tokenId
   */
  getUsage(tokenId) {
    const data = this.usageData[tokenId];
    if (!data) {
      return { summary: {}, history: [] };
    }
    // Backward compatibility normalization during retrieval
    if (!data.summary || !data.history) {
      return {
        summary: data,
        history: []
      };
    }
    return data;
  }

  /**
   * Clear usage for a specific token
   * @param {string} tokenId
   */
  clearUsage(tokenId) {
    if (this.usageData[tokenId]) {
      delete this.usageData[tokenId];
      this._debouncedSave();
    }
  }
}

const usageTracker = new UsageTracker();
export default usageTracker;
