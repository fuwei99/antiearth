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
 * 对其做 SHA256 哈希，将前 8 字节转为 int64 作为 sessionId。
 * 
 * 这样同一对话的延续请求会产生相同的 sessionId，提升 Gemini 隐式缓存命中率。
 * 找不到用户文本时回退到随机 sessionId。
 * 
 * @param {Array} contents - Gemini 格式的 contents 数组 [{role, parts}]
 * @returns {string} 稳定的 sessionId（负数字符串格式）
 */
function generateStableSessionId(contents) {
  if (Array.isArray(contents)) {
    for (const content of contents) {
      if (content.role === 'user' && Array.isArray(content.parts)) {
        for (const part of content.parts) {
          if (part.text && typeof part.text === 'string' && part.text.trim()) {
            const hash = createHash('sha256').update(part.text).digest();
            // 取前 8 字节，转成 BigInt，确保为正数（清最高符号位）
            const high = hash.readUInt32BE(0);
            const low = hash.readUInt32BE(4);
            const value = (BigInt(high) << 32n) | BigInt(low);
            // Gemini sessionId 格式是负数，CPA 用 "-" + strconv.FormatInt(n, 10)
            // 这里直接用 "-" + 正整数字符串
            return '-' + (value & 0x7FFFFFFFFFFFFFFFn).toString();
          }
        }
      }
    }
  }
  // 回退：找不到用户文本，用随机 sessionId
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