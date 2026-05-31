import usageTracker, { calculateCost, MODEL_PRICES } from '../src/auth/usage_tracker.js';
import assert from 'assert';

console.log('Running usage tracker test...');

// 1. Verify pricing matches expectations
console.log('MODEL_PRICES:', MODEL_PRICES);

// 2. Test calculateCost for Sonnet
const sonnetCostNoCache = calculateCost('claude-sonnet-4-6', 10000, 2000, 0, 0);
console.log('Sonnet No Cache Cost (10k in, 2k out):', sonnetCostNoCache);
assert.strictEqual(sonnetCostNoCache, (10000 * 3.00 + 2000 * 15.00) / 1000000);

const sonnetCostWithCache = calculateCost('claude-sonnet-4-6', 10000, 2000, 8000, 1000);
console.log('Sonnet Cache Cost (10k total in, 8k read, 1k write, 1k normal):', sonnetCostWithCache);
// normal: 10000 - 8000 - 1000 = 1000 tokens
// expected: (1000 * 3.00 + 2000 * 15.00 + 8000 * 0.30 + 1000 * 3.75) / 1000000
const expectedSonnetCache = (1000 * 3.00 + 2000 * 15.00 + 8000 * 0.30 + 1000 * 3.75) / 1000000;
assert.strictEqual(sonnetCostWithCache, Number(expectedSonnetCache.toFixed(6)));

// 3. Test recordUsage
console.log('Testing recordUsage...');
const tokenId = 'test_token_123';
usageTracker.clearUsage(tokenId);

usageTracker.recordUsage(tokenId, 'claude-sonnet-4-6', {
  promptTokenCount: 10000,
  candidatesTokenCount: 2000,
  cachedContentTokenCount: 8000
}, true); // hasSessionId = true -> cachedWriteTokens will be promptTokens - cachedReadTokens = 2000

const usage = usageTracker.getUsage(tokenId);
console.log('Recorded usage:', usage);

assert.strictEqual(usage.summary['claude-sonnet-4-6'].requests, 1);
assert.strictEqual(usage.summary['claude-sonnet-4-6'].promptTokens, 10000);
assert.strictEqual(usage.summary['claude-sonnet-4-6'].completionTokens, 2000);
assert.strictEqual(usage.summary['claude-sonnet-4-6'].cachedReadTokens, 8000);
assert.strictEqual(usage.summary['claude-sonnet-4-6'].cachedWriteTokens, 2000);

assert.strictEqual(usage.history.length, 1);
assert.strictEqual(usage.history[0].modelId, 'claude-sonnet-4-6');
assert.strictEqual(usage.history[0].promptTokens, 10000);
assert.strictEqual(usage.history[0].completionTokens, 2000);
assert.strictEqual(usage.history[0].cachedReadTokens, 8000);
assert.strictEqual(usage.history[0].cachedWriteTokens, 2000);

// Test recordUsage with cache miss (cachedContentTokenCount = 0)
console.log('Testing recordUsage with cache miss...');
usageTracker.recordUsage(tokenId, 'claude-sonnet-4-6', {
  promptTokenCount: 10000,
  candidatesTokenCount: 2000,
  cachedContentTokenCount: 0
}, true); // hasSessionId = true -> but cachedContentTokenCount is 0 -> cachedWriteTokens will be 0

const usage2 = usageTracker.getUsage(tokenId);
console.log('Recorded usage 2:', usage2);

assert.strictEqual(usage2.summary['claude-sonnet-4-6'].requests, 2);
assert.strictEqual(usage2.summary['claude-sonnet-4-6'].promptTokens, 20000);
assert.strictEqual(usage2.summary['claude-sonnet-4-6'].cachedWriteTokens, 2000); // 2000 + 0

assert.strictEqual(usage2.history.length, 2);
assert.strictEqual(usage2.history[1].cachedReadTokens, 0);
assert.strictEqual(usage2.history[1].cachedWriteTokens, 0);
const expectedMissCost = (10000 * 3.00 + 2000 * 15.00) / 1000000; // $0.06
assert.strictEqual(usage2.history[1].cost, expectedMissCost);

// Test dynamic models.json pricing for a custom model (gemini-3.5-flash-low)
console.log('Testing recordUsage with custom models.json pricing...');
usageTracker.recordUsage(tokenId, 'gemini-3.5-flash-low', {
  promptTokenCount: 100000, // 100k
  candidatesTokenCount: 20000, // 20k
  cachedContentTokenCount: 80000 // 80k
}, true); // hasSessionId = true -> cachedWrite = 20k, cachedRead = 80k

const usage3 = usageTracker.getUsage(tokenId);
console.log('Recorded usage 3 (custom model):', usage3.history[2]);
// pricing for gemini-3.5-flash-low: input: 0.05, output: 0.20, cacheWrite: 0.05, cacheRead: 0.0125 per million
// normalInput = 100k - 80k - 20k = 0
// cost = (80k * 0.0125 + 20k * 0.05 + 20k * 0.20) / 1,000,000 = (1 + 1 + 4) / 1M = 6 / 1M = 0.000006
assert.strictEqual(usage3.history[2].cost, 0.006);

// Test dynamic models.json flat-fee model (gemini-3.1-flash-image)
console.log('Testing recordUsage with flat-fee pricing...');
usageTracker.recordUsage(tokenId, 'gemini-3.1-flash-image', {
  promptTokenCount: 1,
  candidatesTokenCount: 1,
  cachedContentTokenCount: 0
});
const usage4 = usageTracker.getUsage(tokenId);
console.log('Recorded usage 4 (flat fee):', usage4.history[3]);
assert.strictEqual(usage4.history[3].cost, 0.03);

// Cleanup
usageTracker.clearUsage(tokenId);
console.log('All tests passed successfully!');
