import fs from 'fs/promises';
import path from 'path';
import { randomUUID } from 'crypto';
import { getDataDir } from '../utils/paths.js';
import { FILE_CACHE_TTL } from '../constants/index.js';
import { log } from '../utils/logger.js';
import { generateSalt } from '../utils/idGenerator.js';
import { getStore } from '../store/index.js';

/**
 * 账号数据文件结构：
 * {
 *   "salt": "随机盐值，用于生成安全的tokenId",
 *   "tokens": [...]
 * }
 */

/**
 * 负责 token 文件的读写与简单缓存
 * 不关心业务字段，只处理 JSON 数组的加载和保存
 */
class TokenStore {
  constructor(filePath = path.join(getDataDir(), 'accounts.json')) {
    this.filePath = filePath;
    this._storeKey = filePath.includes('geminicli') ? 'geminicli_accounts' : 'accounts';
    this._cache = null;
    this._cacheTime = 0;
    this._cacheTTL = FILE_CACHE_TTL;
    this._salt = null;
    this._lastReadOk = true;
    this._writeQueue = Promise.resolve();
    this._pendingWrite = null;
    this._storeSynced = false;
  }

  async _ensureFileExists() {
    const dir = path.dirname(this.filePath);
    try {
      await fs.mkdir(dir, { recursive: true });
    } catch (e) {
    }

    try {
      await fs.access(this.filePath);
    } catch (e) {
      const initialData = {
        salt: generateSalt(),
        tokens: []
      };
      await fs.writeFile(this.filePath, JSON.stringify(initialData, null, 2), 'utf8');
      log.info('✓ 已创建账号配置文件（含安全盐值）');
    }
  }

  async initFromStore() {
    try {
      const store = getStore();
      const storeData = await store.get(this._storeKey);
      if (storeData) {
        const tokens = Array.isArray(storeData) ? storeData : (storeData.tokens || []);
        this._cache = this._filterValidTokens(tokens);
        this._cacheTime = Date.now();
        if (storeData._salt) this._salt = storeData._salt;
        this._storeSynced = true;
        log.info(`[TokenStore] 从 store 加载了 ${this._cache.length} 个 token (${this._storeKey})`);
      }
    } catch (e) {
      log.warn(`[TokenStore] initFromStore failed: ${e.message}`);
    }
  }

  async _atomicWrite(content) {
    const dir = path.dirname(this.filePath);
    const base = path.basename(this.filePath);
    const tempPath = path.join(dir, `.${base}.${process.pid}.${Date.now()}.${randomUUID()}.tmp`);
    let handle;

    try {
      handle = await fs.open(tempPath, 'w');
      await handle.writeFile(content, 'utf8');
      await handle.sync();
      await handle.close();
      try {
        await fs.rename(tempPath, this.filePath);
      } catch (renameError) {
        if (renameError.code === 'EEXIST' || renameError.code === 'EPERM') {
          try {
            await fs.unlink(this.filePath);
          } catch (unlinkError) {
            if (unlinkError.code !== 'ENOENT') {
              throw unlinkError;
            }
          }
          await fs.rename(tempPath, this.filePath);
        } else {
          throw renameError;
        }
      }
    } catch (error) {
      if (handle) {
        try {
          await handle.close();
        } catch (closeError) {
          // Ignore close errors after write failures.
        }
      }
      try {
        await fs.unlink(tempPath);
      } catch (cleanupError) {
        // Ignore cleanup errors for temp files.
      }
      throw error;
    }
  }

  /**
   * 获取盐值（用于生成安全的 tokenId）
   * @returns {Promise<string>} 盐值
   */
  async getSalt() {
    if (this._salt) return this._salt;
    
    await this._ensureFileExists();
    try {
      const data = await fs.readFile(this.filePath, 'utf8');
      const parsed = JSON.parse(data || '{}');
      
      // 兼容旧格式：如果是数组，迁移到新格式
      if (Array.isArray(parsed)) {
        const newData = {
          salt: generateSalt(),
          tokens: parsed
        };
        await fs.writeFile(this.filePath, JSON.stringify(newData, null, 2), 'utf8');
        log.info('✓ 已迁移账号配置文件到新格式（添加安全盐值）');
        this._salt = newData.salt;
        return this._salt;
      }
      
      // 如果没有盐值，生成一个
      if (!parsed.salt) {
        parsed.salt = generateSalt();
        parsed.tokens = parsed.tokens || [];
        await fs.writeFile(this.filePath, JSON.stringify(parsed, null, 2), 'utf8');
        log.info('✓ 已为账号配置文件添加安全盐值');
      }
      
      this._salt = parsed.salt;
      return this._salt;
    } catch (error) {
      log.error('读取盐值失败:', error.message);
      // 生成临时盐值
      this._salt = generateSalt();
      return this._salt;
    }
  }

  _isCacheValid() {
    if (!this._cache) return false;
    const now = Date.now();
    return (now - this._cacheTime) < this._cacheTTL;
  }

  /**
   * 过滤无效 token 条目
   * @param {Array} tokens - 原始 token 数组
   * @returns {Array} 过滤后的有效 token 数组
   * @private
   */
  _filterValidTokens(tokens) {
    return tokens.filter(t => {
      if (!t || typeof t !== 'object') return false;
      if (!t.refresh_token && !t.access_token) {
        log.warn('跳过无效 token 条目（缺少 refresh_token 和 access_token）');
        return false;
      }
      return true;
    });
  }

  /**
   * 读取全部 token（包含禁用的），带简单内存缓存
   * @returns {Promise<Array<object>>}
   */
  async readAll() {
    if (this._isCacheValid()) {
      return this._cache;
    }

    await this._ensureFileExists();
    try {
      const data = await fs.readFile(this.filePath, 'utf8');
      const parsed = JSON.parse(data || '{}');
      
      // 兼容旧格式：如果是数组，直接使用
      if (Array.isArray(parsed)) {
        this._cache = this._filterValidTokens(parsed);
        this._lastReadOk = true;
      } else if (parsed.tokens && Array.isArray(parsed.tokens)) {
        this._cache = this._filterValidTokens(parsed.tokens);
        this._lastReadOk = true;
      } else {
        log.warn('账号配置文件格式异常，保留缓存并跳过本次读取');
        this._lastReadOk = false;
        if (this._cache) {
          this._cacheTime = Date.now();
          return this._cache;
        }
        return [];
      }
    } catch (error) {
      log.error('读取账号配置文件失败:', error.message);
      this._lastReadOk = false;
      if (this._cache) {
        this._cacheTime = Date.now();
        return this._cache;
      }
      return [];
    }
    this._cacheTime = Date.now();
    return this._cache;
  }

  /**
   * 覆盖写入全部 token，更新缓存
   * 使用写入队列确保并发安全
   * @param {Array<object>} tokens
   */
  async writeAll(tokens) {
    const normalized = Array.isArray(tokens) ? tokens : [];
    
    const writeOperation = async () => {
      await this._ensureFileExists();
      
      const salt = await this.getSalt();
      
      try {
        const fileData = {
          salt: salt,
          tokens: normalized
        };
        await this._atomicWrite(JSON.stringify(fileData, null, 2));
        this._cache = normalized;
        this._cacheTime = Date.now();
        this._lastReadOk = true;

        const store = getStore();
        if (store.isCloudEnabled) {
          store.set(this._storeKey, { tokens: normalized, _salt: salt }).catch(e => {
            log.warn(`[TokenStore] cloud write failed: ${e.message}`);
          });
        }
      } catch (error) {
        log.error('保存账号配置文件失败:', error.message);
        throw error;
      }
    };
    
    this._writeQueue = this._writeQueue
      .then(writeOperation)
      .catch(error => {
        log.error('写入队列操作失败:', error.message);
      });
    
    return this._writeQueue;
  }

  /**
   * 根据内存中的启用 token 列表，将对应记录合并回文件
   * - 仅按 refresh_token 匹配并更新已有记录
   * - 未出现在 activeTokens 中的记录（例如已禁用账号）保持不变
   * 使用防抖机制合并频繁的写入请求
   * @param {Array<object>} activeTokens - 内存中的启用 token 列表
   * @param {object|null} tokenToUpdate - 如果只需要单个更新，可传入该 token 以减少遍历
   */
  async mergeActiveTokens(activeTokens, tokenToUpdate = null) {
    // 使用写入队列来确保并发安全
    const mergeOperation = async () => {
      const allTokens = [...await this.readAll()];
      const hasActiveTokens = Array.isArray(activeTokens) && activeTokens.length > 0;

      const applyUpdate = (targetToken) => {
        if (!targetToken) return;
        const index = allTokens.findIndex(t => t.refresh_token === targetToken.refresh_token);
        if (index !== -1) {
          allTokens[index] = { ...allTokens[index], ...targetToken };
        }
      };

      if (!this._lastReadOk && allTokens.length === 0) {
        log.warn('账号配置文件读取失败，跳过写入以避免覆盖');
        return null;
      }

      if (allTokens.length === 0 && hasActiveTokens) {
        return activeTokens.map(t => ({ ...t }));
      }

      if (tokenToUpdate) {
        applyUpdate(tokenToUpdate);
      } else if (Array.isArray(activeTokens) && activeTokens.length > 0) {
        for (const memToken of activeTokens) {
          applyUpdate(memToken);
        }
      }

      return allTokens;
    };

    this._writeQueue = this._writeQueue
      .then(async () => {
        const mergedTokens = await mergeOperation();
        if (!mergedTokens) return;
        await this._ensureFileExists();
        const salt = await this.getSalt();
        
        try {
          const fileData = {
            salt: salt,
            tokens: mergedTokens
          };
          await this._atomicWrite(JSON.stringify(fileData, null, 2));
          this._cache = mergedTokens;
          this._cacheTime = Date.now();
          this._lastReadOk = true;

          const store = getStore();
          if (store.isCloudEnabled) {
            store.set(this._storeKey, { tokens: mergedTokens, _salt: salt }).catch(e => {
              log.warn(`[TokenStore] cloud write failed: ${e.message}`);
            });
          }
        } catch (error) {
          log.error('保存账号配置文件失败:', error.message);
        }
      })
      .catch(error => {
        log.error('合并写入队列操作失败:', error.message);
      });

    return this._writeQueue;
  }
}

export default TokenStore;
