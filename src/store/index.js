import FileBackend from './file-backend.js';
import SupabaseBackend from './supabase-backend.js';
import { log } from '../utils/logger.js';

const RETRY_INTERVAL = 30000;
const MAX_RETRIES = 5;
const INIT_RETRY_INTERVAL = 2000;
const INIT_MAX_RETRIES = 5;

class DataStore {
  constructor(options = {}) {
    this.fileBackend = new FileBackend();
    this.supabaseBackend = null;
    this.storageMode = options.storageMode || 'local';
    this.syncDirection = options.syncDirection || 'cloud-wins';

    if (options.databaseUrl) {
      this.supabaseBackend = new SupabaseBackend(options.databaseUrl);
      if (this.storageMode === 'local') {
        this.supabaseBackend = null;
      }
    }

    this.cache = new Map();
    this._retryQueue = [];
    this._retryTimer = null;
    this._initialized = false;
    this._cloudLoaded = false;
  }

  get isCloudEnabled() {
    return this.supabaseBackend != null;
  }

  get isCloudLoaded() {
    return this._cloudLoaded;
  }

  async init() {
    if (this._initialized) return;

    const localData = await this.fileBackend.loadAll();
    for (const [k, v] of localData) this.cache.set(k, v);

    if (this.supabaseBackend) {
      let cloudData = null;
      let lastError = null;
      for (let attempt = 1; attempt <= INIT_MAX_RETRIES; attempt++) {
        try {
          cloudData = await this.supabaseBackend.loadAll();
          break;
        } catch (e) {
          lastError = e;
          if (attempt < INIT_MAX_RETRIES) {
            log.warn(`[DataStore] 云端加载失败，第 ${attempt}/${INIT_MAX_RETRIES} 次，${INIT_RETRY_INTERVAL}ms 后重试: ${e.message}`);
            await new Promise(resolve => setTimeout(resolve, INIT_RETRY_INTERVAL));
          }
        }
      }

      if (cloudData) {
        this._cloudLoaded = true;
        if (this.syncDirection === 'cloud-wins') {
          for (const [k, v] of cloudData) {
            this.cache.set(k, v);
            await this.fileBackend.set(k, v);
          }
        } else {
          for (const [k, v] of localData) {
            if (!cloudData.has(k)) {
              this._asyncCloudSet(k, v);
            }
          }
        }
        this._startRetryLoop();
        this._startCleanupTimer();
        log.info(`[DataStore] 云端存储已启用 (mode=${this.storageMode}, sync=${this.syncDirection})`);
      } else {
        log.warn(`[DataStore] 云端加载重试耗尽，仅使用本地数据: ${lastError?.message || 'unknown error'}`);
      }
    }

    this._initialized = true;
    log.info(`[DataStore] 初始化完成，缓存 ${this.cache.size} 个键`);
  }

  async get(key) {
    return this.cache.get(key);
  }

  async has(key) {
    return this.cache.has(key);
  }

  async keys(prefix = '') {
    if (!prefix) return Array.from(this.cache.keys());
    return Array.from(this.cache.keys()).filter(k => k.startsWith(prefix));
  }

  async set(key, value) {
    this.cache.set(key, value);
    await this.fileBackend.set(key, value);
    this._asyncCloudSet(key, value);
  }

  async setAndWait(key, value) {
    this.cache.set(key, value);
    await this.fileBackend.set(key, value);
    if (this.supabaseBackend) {
      await this.supabaseBackend.set(key, value);
    }
  }

  async delete(key) {
    this.cache.delete(key);
    await this.fileBackend.delete(key);
    this._asyncCloudDelete(key);
  }

  async reload() {
    this.cache.clear();
    this._initialized = false;
    this._cloudLoaded = false;
    await this.init();
  }

  async rawQuery(sql, params) {
    if (!this.supabaseBackend) {
      throw new Error('Cloud storage not enabled');
    }
    return this.supabaseBackend.query(sql, params);
  }

  _asyncCloudSet(key, value) {
    if (!this.supabaseBackend) return;
    this.supabaseBackend.set(key, value).catch(e => {
      log.warn(`[DataStore] 云端写入失败 ${key}: ${e.message}`);
      this._retryQueue.push({ op: 'set', key, value, retries: 0 });
    });
  }

  _asyncCloudDelete(key) {
    if (!this.supabaseBackend) return;
    this.supabaseBackend.delete(key).catch(e => {
      log.warn(`[DataStore] 云端删除失败 ${key}: ${e.message}`);
      this._retryQueue.push({ op: 'delete', key, retries: 0 });
    });
  }

  _startRetryLoop() {
    if (this._retryTimer) return;
    this._retryTimer = setInterval(() => this._processRetryQueue(), RETRY_INTERVAL);
    if (this._retryTimer.unref) this._retryTimer.unref();
  }

  async _processRetryQueue() {
    if (this._retryQueue.length === 0) return;

    const pending = [...this._retryQueue];
    this._retryQueue = [];

    for (const item of pending) {
      if (item.retries >= MAX_RETRIES) {
        log.warn(`[DataStore] 重试次数超限，丢弃 ${item.op} ${item.key}`);
        continue;
      }
      try {
        if (item.op === 'set') {
          await this.supabaseBackend.set(item.key, item.value);
        } else if (item.op === 'delete') {
          await this.supabaseBackend.delete(item.key);
        }
      } catch (e) {
        item.retries++;
        this._retryQueue.push(item);
      }
    }
  }

  _startCleanupTimer() {
    const timer = setInterval(() => {
      if (this.supabaseBackend) {
        this.supabaseBackend.cleanup().catch(() => {});
      }
    }, 60 * 60 * 1000);
    if (timer.unref) timer.unref();
  }

  async close() {
    if (this._retryTimer) {
      clearInterval(this._retryTimer);
      this._retryTimer = null;
    }
    if (this.supabaseBackend) {
      await this.supabaseBackend.close();
    }
  }
}

let _instance = null;

export function getStore() {
  if (!_instance) {
    _instance = new DataStore({
      databaseUrl: process.env.DATABASE_URL,
      storageMode: process.env.STORAGE_MODE || 'dual',
      syncDirection: process.env.SYNC_DIRECTION || 'cloud-wins',
    });
  }
  return _instance;
}

export function initStore() {
  const store = getStore();
  return store.init();
}

export default DataStore;
