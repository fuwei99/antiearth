import { randomUUID, createHash, randomBytes } from 'crypto';

function generateRequestId() {
  const timestamp = Date.now();
  const uuid = randomUUID();
  //const number = Math.floor(Math.random() * 10);
  return `agent/${timestamp}/${uuid}/4`;
}

function generateCheckpointId() {
  const uuid = randomUUID();
  return `checkpoint/${uuid}`;
}

function generateSessionId() {
  return String(-Math.floor(Math.random() * 9e18));
}

/**
 * 基于对话内容生成稳定的 Session ID（照抄 CPA 的 generateStableSessionID）
 * 
 * 遍历 contents 数组，找第一个 role=user 的消息，取 parts[0].text，
 * 同时拼接 systemInstruction 的文本内容，一起做 SHA256 哈希。
 * 
 * 这样即使同一用户消息，不同系统提示词也会产生不同 sessionId，
 * 避免不同对话误共享缓存。
 * 
 * @param {Array} contents - Gemini 格式的 contents 数组 [{role, parts}]
 * @param {Object|string} [systemInstruction] - 系统提示词
 * @returns {string} 稳定的 sessionId（负数字符串格式）
 */
function generateStableSessionId(contents, systemInstruction) {
  let hashInput = '';

  // 拼接系统提示词文本
  if (systemInstruction) {
    if (typeof systemInstruction === 'string' && systemInstruction.trim()) {
      hashInput += systemInstruction.trim();
    } else if (systemInstruction.parts && Array.isArray(systemInstruction.parts)) {
      for (const part of systemInstruction.parts) {
        if (part.text && typeof part.text === 'string' && part.text.trim()) {
          hashInput += part.text.trim();
        }
      }
    }
  }

  // 拼接第一个用户消息文本
  if (Array.isArray(contents)) {
    for (const content of contents) {
      if (content.role === 'user' && Array.isArray(content.parts)) {
        for (const part of content.parts) {
          if (part.text && typeof part.text === 'string' && part.text.trim()) {
            hashInput += part.text.trim();
            break;
          }
        }
        if (hashInput.length > 0) break;
      }
    }
  }

  if (hashInput.length > 0) {
    const hash = createHash('sha256').update(hashInput).digest();
    const high = hash.readUInt32BE(0);
    const low = hash.readUInt32BE(4);
    const value = (BigInt(high) << 32n) | BigInt(low);
    return '-' + (value & 0x7FFFFFFFFFFFFFFFn).toString();
  }

  return generateSessionId();
}

function generateProjectId() {
  const adjectives = ['useful', 'bright', 'swift', 'calm', 'bold'];
  const nouns = ['fuze', 'wave', 'spark', 'flow', 'core'];
  const randomAdj = adjectives[Math.floor(Math.random() * adjectives.length)];
  const randomNoun = nouns[Math.floor(Math.random() * nouns.length)];
  const randomNum = Math.random().toString(36).substring(2, 7);
  return `${randomAdj}-${randomNoun}-${randomNum}`;
}

function generateToolCallId() {
  return `call_${randomUUID().replace(/-/g, '')}`;
}

function generateInstanceId() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  const lowerChars = 'abcdefghijklmnopqrstuvwxyz';
  const randomStr = Array.from({ length: 8 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  const username = Array.from({ length: 4 }, () => lowerChars[Math.floor(Math.random() * lowerChars.length)]).join('');
  return `LAPTOP-${randomStr}\\${username}-LAPTOP-${randomStr}`;
}

/**
 * 生成随机盐值
 * @returns {string} 32字节的十六进制盐值
 */
function generateSalt() {
  return randomBytes(32).toString('hex');
}

/**
 * 根据 refresh_token 和盐值生成安全的 token ID
 * 使用 SHA256 哈希，取前16位作为标识符
 * @param {string} refreshToken - 原始 refresh_token
 * @param {string} salt - 盐值
 * @returns {string} 安全的 token ID
 */
function generateTokenId(refreshToken, salt) {
  if (!refreshToken || !salt) return null;
  return createHash('sha256').update(refreshToken + salt).digest('hex').substring(0, 16);
}

export {
    generateProjectId,
    generateSessionId,
    generateStableSessionId,
    generateRequestId,
    generateToolCallId,
    generateInstanceId,
    generateTokenId,
    generateSalt,
    generateCheckpointId
}