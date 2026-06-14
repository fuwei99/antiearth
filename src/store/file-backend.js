import fs from 'fs';
import path from 'path';
import { getDataDir, getConfigPaths } from '../utils/paths.js';
import { log } from '../utils/logger.js';

const KEY_TO_FILE = {
  config: () => getConfigPaths().configJsonPath,
  accounts: () => path.join(getDataDir(), 'accounts.json'),
  geminicli_accounts: () => path.join(getDataDir(), 'geminicli_accounts.json'),
  usage: () => path.join(getDataDir(), 'usage.json'),
  quotas: () => path.join(getDataDir(), 'quotas.json'),
  cooldowns: () => path.join(getDataDir(), 'token_cooldowns.json'),
  ip_blocklist: () => path.join(getDataDir(), 'ip-blocklist.json'),
  security: () => {
    const root = getDataDir().replace(/[\\/]data$/, '');
    return path.join(root, 'security.json');
  },
};

function getFilePath(key) {
  if (key.startsWith('signature_cache:')) {
    const model = key.slice('signature_cache:'.length);
    return path.join(getDataDir(), 'signature-cache', `${model}.json`);
  }
  const resolver = KEY_TO_FILE[key];
  if (resolver) return resolver();
  return null;
}

function parseFileContent(key, raw) {
  if (!raw) return undefined;
  const data = JSON.parse(raw);
  if (key === 'config') return data;
  if (key === 'accounts' || key === 'geminicli_accounts') {
    return Array.isArray(data) ? data : (data.tokens || []);
  }
  if (key === 'usage') return data;
  if (key === 'quotas') return data.quotas || data;
  if (key === 'cooldowns') return data.cooldowns || data;
  if (key === 'signature_cache' || key.startsWith('signature_cache:')) {
    return data.signatures || data;
  }
  return data;
}

class FileBackend {
  constructor() {
    this._writeQueue = Promise.resolve();
  }

  async loadAll() {
    const result = new Map();
    const allKeys = Object.keys(KEY_TO_FILE);

    for (const key of allKeys) {
      try {
        const filePath = getFilePath(key);
        if (filePath && fs.existsSync(filePath)) {
          const raw = fs.readFileSync(filePath, 'utf8');
          const parsed = parseFileContent(key, raw);
          if (parsed !== undefined) {
            result.set(key, parsed);
          }
        }
      } catch (e) {
        log.warn(`[FileBackend] loadAll ${key} failed: ${e.message}`);
      }
    }

    try {
      const cacheDir = path.join(getDataDir(), 'signature-cache');
      if (fs.existsSync(cacheDir)) {
        for (const file of fs.readdirSync(cacheDir)) {
          if (!file.endsWith('.json')) continue;
          const model = file.replace('.json', '');
          const key = `signature_cache:${model}`;
          try {
            const raw = fs.readFileSync(path.join(cacheDir, file), 'utf8');
            const parsed = parseFileContent(key, raw);
            if (parsed !== undefined) result.set(key, parsed);
          } catch (e) {
            log.warn(`[FileBackend] loadAll ${key} failed: ${e.message}`);
          }
        }
      }
    } catch (e) {
      log.warn(`[FileBackend] loadAll signature-cache dir failed: ${e.message}`);
    }

    return result;
  }

  async get(key) {
    const filePath = getFilePath(key);
    if (!filePath || !fs.existsSync(filePath)) return undefined;
    try {
      const raw = fs.readFileSync(filePath, 'utf8');
      return parseFileContent(key, raw);
    } catch (e) {
      log.warn(`[FileBackend] get ${key} failed: ${e.message}`);
      return undefined;
    }
  }

  async set(key, value) {
    this._writeQueue = this._writeQueue.then(() => this._doSet(key, value)).catch(e => {
      log.warn(`[FileBackend] set ${key} failed: ${e.message}`);
    });
    return this._writeQueue;
  }

  async _doSet(key, value) {
    const filePath = getFilePath(key);
    if (!filePath) {
      log.warn(`[FileBackend] set: unknown key ${key}`);
      return;
    }

    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    let content;
    if (key === 'config') {
      content = JSON.stringify(value, null, 2);
    } else if (key === 'accounts' || key === 'geminicli_accounts') {
      content = JSON.stringify({ salt: value._salt || '', tokens: Array.isArray(value) ? value : (value.tokens || []) }, null, 2);
    } else if (key === 'quotas') {
      content = JSON.stringify({ meta: { lastCleanup: Date.now() }, quotas: value }, null, 2);
    } else if (key === 'cooldowns') {
      content = JSON.stringify({ meta: { version: 1 }, cooldowns: value }, null, 2);
    } else if (key.startsWith('signature_cache:')) {
      const model = key.slice('signature_cache:'.length);
      content = JSON.stringify({ model, signatures: value, lastModified: Date.now() }, null, 2);
    } else {
      content = JSON.stringify(value, null, 2);
    }

    const tmpPath = filePath + '.tmp.' + process.pid + '.' + Date.now();
    fs.writeFileSync(tmpPath, content, 'utf8');
    try {
      fs.renameSync(tmpPath, filePath);
    } catch (e) {
      try { fs.unlinkSync(filePath); } catch {}
      try { fs.renameSync(tmpPath, filePath); } catch (e2) {
        try { fs.unlinkSync(tmpPath); } catch {}
        throw e2;
      }
    }
  }

  async delete(key) {
    const filePath = getFilePath(key);
    if (!filePath || !fs.existsSync(filePath)) return;
    try {
      fs.unlinkSync(filePath);
    } catch (e) {
      log.warn(`[FileBackend] delete ${key} failed: ${e.message}`);
    }
  }

  async list(prefix) {
    const result = [];
    const allKeys = Object.keys(KEY_TO_FILE);
    for (const key of allKeys) {
      if (key.startsWith(prefix)) {
        const filePath = getFilePath(key);
        if (filePath && fs.existsSync(filePath)) result.push(key);
      }
    }

    if (prefix === 'signature_cache' || prefix.startsWith('signature_cache')) {
      try {
        const cacheDir = path.join(getDataDir(), 'signature-cache');
        if (fs.existsSync(cacheDir)) {
          for (const file of fs.readdirSync(cacheDir)) {
            if (!file.endsWith('.json')) continue;
            result.push(`signature_cache:${file.replace('.json', '')}`);
          }
        }
      } catch {}
    }

    return result;
  }
}

export default FileBackend;
