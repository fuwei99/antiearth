/**
 * Token 解析工具类
 * 负责解析从环境变量、导出文件或手动输入中获取的原始 Token 数据
 */

/**
 * 智能查找字段值（不分大小写，包含匹配）
 * @param {Object} obj - 原始对象
 * @param {string} keyword - 关键字
 * @returns {*} 找到的值或 undefined
 */
export function findFieldByKeyword(obj, keyword) {
  if (!obj || typeof obj !== 'object') return undefined;
  const lowerKeyword = keyword.toLowerCase();
  for (const key of Object.keys(obj)) {
    if (key.toLowerCase().includes(lowerKeyword)) {
      return obj[key];
    }
  }
  return undefined;
}

export function normalizeImportedTextValue(value) {
  if (value === null || value === undefined) return undefined;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed || undefined;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  return undefined;
}

export function normalizeImportedProjectId(value) {
  if (value === null || value === undefined) return undefined;
  if (typeof value === 'object') {
    return normalizeImportedProjectId(value.id ?? value.projectId ?? value.name);
  }
  return normalizeImportedTextValue(value);
}

export function normalizeImportedBoolean(value) {
  return value === true || value === 'true' || value === 1 || value === '1';
}

export function parseImportedEnable(rawToken) {
  let enable = findFieldByKeyword(rawToken, 'enable');
  if (enable === undefined) enable = findFieldByKeyword(rawToken, 'enabled');

  let disabled = findFieldByKeyword(rawToken, 'disable');
  if (disabled === undefined) disabled = findFieldByKeyword(rawToken, 'disabled');

  if (enable === undefined && disabled !== undefined) {
    return !normalizeImportedBoolean(disabled);
  }

  if (enable === undefined) return true;
  return normalizeImportedBoolean(enable);
}

export function deriveImportedExpiresInAndTimestamp({ expires_in, expiry, timestamp }) {
  const nowMs = Date.now();

  let finalExpiresIn = null;
  if (expires_in !== undefined && expires_in !== null && String(expires_in).trim() !== '') {
    const parsed = parseInt(expires_in, 10);
    if (Number.isFinite(parsed) && parsed > 0) {
      finalExpiresIn = parsed;
    }
  }

  let finalTimestamp;
  if (finalExpiresIn === null && typeof expiry === 'string' && expiry.trim()) {
    const expiryMs = Date.parse(expiry);
    if (Number.isFinite(expiryMs)) {
      finalExpiresIn = Math.max(1, Math.floor((expiryMs - nowMs) / 1000));
      finalTimestamp = nowMs;
    }
  }

  if (finalTimestamp === undefined) {
    if (timestamp !== undefined && timestamp !== null && String(timestamp).trim() !== '') {
      if (typeof timestamp === 'number') {
        finalTimestamp = timestamp;
      } else {
        const parsedTimestamp = Date.parse(timestamp);
        finalTimestamp = Number.isFinite(parsedTimestamp) ? parsedTimestamp : nowMs;
      }
    } else {
      finalTimestamp = nowMs;
    }
  }

  return {
    expires_in: finalExpiresIn ?? 3599,
    timestamp: finalTimestamp
  };
}

/**
 * 智能解析单个 Token 对象 (Antigravity 格式)
 * @param {Object} rawToken - 原始 Token 对象
 * @returns {Object|null} 解析后的规范化 Token 对象或 null
 */
export function smartParseToken(rawToken) {
  if (!rawToken || typeof rawToken !== 'object') return null;

  const refresh_token = normalizeImportedTextValue(findFieldByKeyword(rawToken, 'refresh'));

  if (!refresh_token) return null;

  const token = { refresh_token };

  const projectId = normalizeImportedProjectId(findFieldByKeyword(rawToken, 'project'));
  const access_token = normalizeImportedTextValue(findFieldByKeyword(rawToken, 'access') || rawToken.token);
  const email = normalizeImportedTextValue(findFieldByKeyword(rawToken, 'email') || findFieldByKeyword(rawToken, 'mail'));
  const expires_in = findFieldByKeyword(rawToken, 'expires') || findFieldByKeyword(rawToken, 'expire');
  const timestamp = findFieldByKeyword(rawToken, 'time') || findFieldByKeyword(rawToken, 'stamp') || findFieldByKeyword(rawToken, 'created');
  const expiry = findFieldByKeyword(rawToken, 'expiry') || findFieldByKeyword(rawToken, 'expiresat');
  const hasQuota = findFieldByKeyword(rawToken, 'quota');
  const sub = normalizeImportedTextValue(findFieldByKeyword(rawToken, 'subscription') || findFieldByKeyword(rawToken, 'tier') || rawToken.sub);
  const credits = findFieldByKeyword(rawToken, 'credit');

  if (projectId) token.projectId = projectId;
  if (access_token) token.access_token = access_token;
  if (email) token.email = email;

  const derived = deriveImportedExpiresInAndTimestamp({ expires_in, expiry, timestamp });
  token.expires_in = derived.expires_in;
  token.timestamp = derived.timestamp;
  token.enable = parseImportedEnable(rawToken);

  if (hasQuota !== undefined) token.hasQuota = normalizeImportedBoolean(hasQuota);
  if (sub) token.sub = sub;
  if (credits !== undefined && credits !== null && String(credits).trim() !== '') {
    const parsedCredits = Number(credits);
    if (Number.isFinite(parsedCredits)) {
      token.credits = parsedCredits;
    }
  }

  return token;
}

// ==================== Gemini CLI 相关解析函数 ====================

export function extractGeminiCliImportList(data) {
  if (Array.isArray(data)) return data;
  if (!data || typeof data !== 'object') return null;

  const list = data.tokens || data.accounts || data.data?.tokens || data.data?.accounts;
  if (Array.isArray(list)) return list;

  const hasRefresh = !!(data.refresh_token || data.refreshToken);
  const hasAccess = !!(data.access_token || data.accessToken || data.token);
  if (hasRefresh || hasAccess) return [data];
  return null;
}

export function normalizeTruthyBoolean(value) {
  return value === true || value === 'true' || value === 1;
}

export function parseGeminiCliEnable(rawToken) {
  let enable = findFieldByKeyword(rawToken, 'enable');
  if (enable === undefined) enable = findFieldByKeyword(rawToken, 'enabled');
  let disabled = findFieldByKeyword(rawToken, 'disable');
  if (disabled === undefined) disabled = findFieldByKeyword(rawToken, 'disabled');
  if (enable === undefined && disabled !== undefined) {
    enable = !normalizeTruthyBoolean(disabled);
  }
  if (enable === undefined) enable = true;
  return normalizeTruthyBoolean(enable);
}

export function deriveExpiresInAndTimestamp({ expires_in, expiry, timestamp }) {
  const nowMs = Date.now();

  let finalExpiresIn = null;
  if (expires_in !== undefined && expires_in !== null && String(expires_in).trim() !== '') {
    const n = parseInt(expires_in, 10);
    if (Number.isFinite(n) && n > 0) finalExpiresIn = n;
  }

  let finalTimestamp = undefined;
  if (finalExpiresIn === null && typeof expiry === 'string' && expiry.trim()) {
    const expiryMs = Date.parse(expiry);
    if (Number.isFinite(expiryMs)) {
      finalExpiresIn = Math.max(1, Math.floor((expiryMs - nowMs) / 1000));
      finalTimestamp = nowMs;
    }
  }

  if (finalTimestamp === undefined) {
    if (timestamp) {
      finalTimestamp = typeof timestamp === 'number' ? timestamp : new Date(timestamp).getTime();
    } else {
      finalTimestamp = nowMs;
    }
  }

  return {
    expires_in: finalExpiresIn ?? 3599,
    timestamp: finalTimestamp
  };
}

/**
 * 智能解析单个 Token 对象 (Gemini CLI 格式)
 * @param {Object} rawToken - 原始 Token 对象
 * @returns {Object|null} 解析后的规范化 Token 对象或 null
 */
export function smartParseGeminiCliToken(rawToken) {
  if (!rawToken || typeof rawToken !== 'object') return null;

  const refresh_token = findFieldByKeyword(rawToken, 'refresh');
  if (!refresh_token) return null;

  const token = { refresh_token };

  const access_token = findFieldByKeyword(rawToken, 'access') || rawToken.token;
  const email = findFieldByKeyword(rawToken, 'email') || findFieldByKeyword(rawToken, 'mail');
  const expires_in = findFieldByKeyword(rawToken, 'expires') || findFieldByKeyword(rawToken, 'expire');
  const timestamp = findFieldByKeyword(rawToken, 'time') || findFieldByKeyword(rawToken, 'stamp') || findFieldByKeyword(rawToken, 'created');
  const expiry = findFieldByKeyword(rawToken, 'expiry') || findFieldByKeyword(rawToken, 'expiresat');
  const projectId = findFieldByKeyword(rawToken, 'project');

  if (access_token) token.access_token = access_token;
  if (email) token.email = email;
  if (projectId) token.projectId = projectId;

  const derived = deriveExpiresInAndTimestamp({ expires_in, expiry, timestamp });
  token.expires_in = derived.expires_in;
  token.timestamp = derived.timestamp;
  token.enable = parseGeminiCliEnable(rawToken);

  return token;
}
