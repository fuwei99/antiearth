import pg from 'pg';
import { log } from '../utils/logger.js';

const { Pool } = pg;

const TABLE_MAP = {
  config: 'configs',
  accounts: 'accounts',
  geminicli_accounts: 'accounts',
  usage: 'usage',
  quotas: 'quotas',
  cooldowns: 'token_cooldowns',
  signature_cache: 'signature_cache',
  security: 'configs',
  ip_blocklist: 'configs',
};

function getTableInfo(key) {
  if (key.startsWith('signature_cache:')) {
    return { table: 'signature_cache', subKey: key.slice('signature_cache:'.length) };
  }
  const table = TABLE_MAP[key];
  if (!table) return null;
  return { table, subKey: null };
}

const CREATE_TABLES_SQL = `
CREATE TABLE IF NOT EXISTS configs (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,
  type TEXT DEFAULT 'antigravity',
  data JSONB NOT NULL,
  salt TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS usage (
  id BIGSERIAL PRIMARY KEY,
  account_id TEXT NOT NULL,
  model_id TEXT NOT NULL,
  data JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS quotas (
  account_id TEXT PRIMARY KEY,
  data JSONB NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS token_cooldowns (
  account_id TEXT,
  model_id TEXT,
  data JSONB,
  cooldown_until TIMESTAMPTZ,
  PRIMARY KEY (account_id, model_id)
);

CREATE TABLE IF NOT EXISTS signature_cache (
  model_key TEXT NOT NULL,
  signature TEXT NOT NULL,
  content TEXT DEFAULT ' ',
  timestamp TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (model_key, signature)
);
`;

class SupabaseBackend {
  constructor(databaseUrl) {
    this.pool = new Pool({
      connectionString: databaseUrl,
      ssl: { rejectUnauthorized: false },
      max: 5,
      idleTimeoutMillis: 30000,
    });

    this._initialized = false;
    this._initPromise = null;
  }

  async _ensureTables() {
    if (this._initialized) return;
    if (this._initPromise) return this._initPromise;

    this._initPromise = this._doEnsureTables();
    return this._initPromise;
  }

  async _doEnsureTables() {
    try {
      const client = await this.pool.connect();
      try {
        await client.query(CREATE_TABLES_SQL);
        this._initialized = true;
        log.info('[SupabaseBackend] 数据库表已就绪');
      } finally {
        client.release();
      }
    } catch (e) {
      log.error(`[SupabaseBackend] 建表失败: ${e.message}`);
      this._initPromise = null;
      throw e;
    }
  }

  async loadAll() {
    await this._ensureTables();
    const result = new Map();

    try {
      const configs = await this.pool.query('SELECT key, value FROM configs');
      if (configs.rows.length > 0) {
        const configObj = {};
        for (const row of configs.rows) {
          configObj[row.key] = row.value;
        }
        result.set('config', configObj);
      }
    } catch (e) {
      log.warn(`[SupabaseBackend] loadAll configs failed: ${e.message}`);
    }

    try {
      const accs = await this.pool.query("SELECT data, salt FROM accounts WHERE type = 'antigravity'");
      if (accs.rows.length > 0) {
        const tokens = accs.rows.map(r => r.data);
        const salt = accs.rows[0]?.salt || '';
        result.set('accounts', { tokens, _salt: salt });
      }
    } catch (e) {
      log.warn(`[SupabaseBackend] loadAll accounts failed: ${e.message}`);
    }

    try {
      const accs = await this.pool.query("SELECT data, salt FROM accounts WHERE type = 'geminicli'");
      if (accs.rows.length > 0) {
        const tokens = accs.rows.map(r => r.data);
        const salt = accs.rows[0]?.salt || '';
        result.set('geminicli_accounts', { tokens, _salt: salt });
      }
    } catch (e) {
      log.warn(`[SupabaseBackend] loadAll geminicli_accounts failed: ${e.message}`);
    }

    try {
      const usages = await this.pool.query('SELECT account_id, data FROM usage');
      if (usages.rows.length > 0) {
        const usageObj = {};
        for (const row of usages.rows) {
          usageObj[row.account_id] = row.data;
        }
        result.set('usage', usageObj);
      }
    } catch (e) {
      log.warn(`[SupabaseBackend] loadAll usage failed: ${e.message}`);
    }

    try {
      const quotas = await this.pool.query('SELECT account_id, data FROM quotas');
      if (quotas.rows.length > 0) {
        const quotaObj = {};
        for (const row of quotas.rows) {
          quotaObj[row.account_id] = row.data;
        }
        result.set('quotas', quotaObj);
      }
    } catch (e) {
      log.warn(`[SupabaseBackend] loadAll quotas failed: ${e.message}`);
    }

    try {
      const cooldowns = await this.pool.query('SELECT account_id, model_id, data, cooldown_until FROM token_cooldowns WHERE cooldown_until > NOW()');
      if (cooldowns.rows.length > 0) {
        const cooldownObj = {};
        for (const row of cooldowns.rows) {
          if (!cooldownObj[row.account_id]) cooldownObj[row.account_id] = {};
          const groupKey = row.model_id;
          cooldownObj[row.account_id][groupKey] = row.data || { until: new Date(row.cooldown_until).getTime() };
        }
        result.set('cooldowns', cooldownObj);
      }
    } catch (e) {
      log.warn(`[SupabaseBackend] loadAll cooldowns failed: ${e.message}`);
    }

    try {
      const sigs = await this.pool.query('SELECT model_key, signature, content, timestamp FROM signature_cache WHERE timestamp > NOW() - INTERVAL \'3 hours\'');
      if (sigs.rows.length > 0) {
        const byModel = {};
        for (const row of sigs.rows) {
          if (!byModel[row.model_key]) byModel[row.model_key] = [];
          byModel[row.model_key].push({
            signature: row.signature,
            content: row.content || ' ',
            timestamp: new Date(row.timestamp).getTime(),
          });
        }
        for (const [modelKey, signatures] of Object.entries(byModel)) {
          result.set(`signature_cache:${modelKey}`, signatures);
        }
      }
    } catch (e) {
      log.warn(`[SupabaseBackend] loadAll signature_cache failed: ${e.message}`);
    }

    return result;
  }

  async set(key, value) {
    await this._ensureTables();
    const info = getTableInfo(key);
    if (!info) {
      log.warn(`[SupabaseBackend] set: unknown key ${key}`);
      return;
    }

    try {
      if (info.table === 'configs') {
        for (const [k, v] of Object.entries(value || {})) {
          await this.pool.query(
            `INSERT INTO configs (key, value, updated_at) VALUES ($1, $2, NOW()) ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()`,
            [k, JSON.stringify(v)]
          );
        }
      } else if (info.table === 'accounts') {
        const type = key === 'geminicli_accounts' ? 'geminicli' : 'antigravity';
        const tokens = Array.isArray(value) ? value : (value.tokens || []);
        const salt = value._salt || '';
        for (const token of tokens) {
          const id = token.tokenId || token.refresh_token || Math.random().toString(36);
          await this.pool.query(
            `INSERT INTO accounts (id, type, data, salt, updated_at) VALUES ($1, $2, $3, $4, NOW()) ON CONFLICT (id) DO UPDATE SET data = $3, salt = $4, type = $2, updated_at = NOW()`,
            [id, type, JSON.stringify(token), salt]
          );
        }
      } else if (info.table === 'usage') {
        await this.pool.query('DELETE FROM usage');
        for (const [accountId, data] of Object.entries(value || {})) {
          const summary = data.summary || {};
          for (const [modelId, modelData] of Object.entries(summary)) {
            await this.pool.query(
              `INSERT INTO usage (account_id, model_id, data, created_at) VALUES ($1, $2, $3, NOW())`,
              [accountId, modelId, JSON.stringify(modelData)]
            );
          }
        }
      } else if (info.table === 'quotas') {
        for (const [accountId, data] of Object.entries(value || {})) {
          await this.pool.query(
            `INSERT INTO quotas (account_id, data, updated_at) VALUES ($1, $2, NOW()) ON CONFLICT (account_id) DO UPDATE SET data = $2, updated_at = NOW()`,
            [accountId, JSON.stringify(data)]
          );
        }
        const allIds = Object.keys(value || {});
        if (allIds.length > 0) {
          await this.pool.query(`DELETE FROM quotas WHERE account_id NOT IN (${allIds.map((_, i) => `$${i + 1}`).join(',')})`, allIds);
        }
      } else if (info.table === 'token_cooldowns') {
        for (const [accountId, groups] of Object.entries(value || {})) {
          for (const [groupKey, data] of Object.entries(groups || {})) {
            if (!data || !data.until) continue;
            const untilDate = new Date(data.until);
            await this.pool.query(
              `INSERT INTO token_cooldowns (account_id, model_id, data, cooldown_until) VALUES ($1, $2, $3, $4) ON CONFLICT (account_id, model_id) DO UPDATE SET data = $3, cooldown_until = $4`,
              [accountId, groupKey, JSON.stringify(data), untilDate.toISOString()]
            );
          }
        }
      } else if (info.table === 'signature_cache') {
        const modelKey = info.subKey;
        if (!modelKey) return;
        await this.pool.query('DELETE FROM signature_cache WHERE model_key = $1', [modelKey]);
        for (const entry of (value || [])) {
          await this.pool.query(
            `INSERT INTO signature_cache (model_key, signature, content, timestamp) VALUES ($1, $2, $3, $4) ON CONFLICT (model_key, signature) DO UPDATE SET content = $3, timestamp = $4`,
            [modelKey, entry.signature, entry.content || ' ', entry.timestamp ? new Date(entry.timestamp).toISOString() : new Date().toISOString()]
          );
        }
      }
    } catch (e) {
      log.warn(`[SupabaseBackend] set ${key} failed: ${e.message}`);
      throw e;
    }
  }

  async delete(key) {
    await this._ensureTables();
    const info = getTableInfo(key);
    if (!info) return;

    try {
      if (info.table === 'signature_cache' && info.subKey) {
        await this.pool.query('DELETE FROM signature_cache WHERE model_key = $1', [info.subKey]);
      }
    } catch (e) {
      log.warn(`[SupabaseBackend] delete ${key} failed: ${e.message}`);
    }
  }

  async query(sql, params = []) {
    await this._ensureTables();
    try {
      const result = await this.pool.query(sql, params);
      return result.rows;
    } catch (e) {
      log.warn(`[SupabaseBackend] query failed: ${e.message}`);
      throw e;
    }
  }

  async cleanup() {
    try {
      await this.pool.query("DELETE FROM token_cooldowns WHERE cooldown_until < NOW()");
      await this.pool.query("DELETE FROM signature_cache WHERE timestamp < NOW() - INTERVAL '3 hours'");
      log.info('[SupabaseBackend] 已清理过期记录');
    } catch (e) {
      log.warn(`[SupabaseBackend] cleanup failed: ${e.message}`);
    }
  }

  async close() {
    try {
      await this.pool.end();
    } catch {}
  }
}

export default SupabaseBackend;
