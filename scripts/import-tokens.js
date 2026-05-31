import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Paths
const exportFilePath = path.join(__dirname, '..', 'tokens-export-2026-05-31.json');
const dataDir = path.join(__dirname, '..', 'data');
const accountsFilePath = path.join(dataDir, 'accounts.json');

async function importTokens() {
  try {
    console.log(`正在读取导出文件: ${exportFilePath}`);
    if (!fs.existsSync(exportFilePath)) {
      console.error(`错误：找不到导出文件 ${exportFilePath}`);
      return;
    }

    const exportData = JSON.parse(fs.readFileSync(exportFilePath, 'utf8'));
    const tokens = exportData.tokens || [];

    if (!Array.isArray(tokens) || tokens.length === 0) {
      console.error('错误：导出文件内未找到有效的 tokens 数组或为空。');
      return;
    }

    console.log(`成功读取到 ${tokens.length} 个 token。`);

    // Ensure data directory exists
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
      console.log('✓ 创建数据目录 data/');
    }

    // Load existing accounts.json if it exists to preserve salt (optional, but good practice)
    let salt = crypto.randomBytes(32).toString('hex');
    let existingTokens = [];

    if (fs.existsSync(accountsFilePath)) {
      try {
        const existingData = JSON.parse(fs.readFileSync(accountsFilePath, 'utf8'));
        if (existingData.salt) salt = existingData.salt;
        if (Array.isArray(existingData.tokens)) existingTokens = existingData.tokens;
        console.log(`检测到已存在的 accounts.json，包含 ${existingTokens.length} 个现有 token。将进行合并...`);
      } catch (e) {
        console.warn('读取现有 accounts.json 失败，将直接覆盖：', e.message);
      }
    }

    // Merge strategy: match by refresh_token, keeping existing fields if not present in import, or replacing/updating them.
    const tokenMap = new Map();
    // Add existing
    existingTokens.forEach(t => {
      if (t.refresh_token) tokenMap.set(t.refresh_token, t);
    });
    // Add / Update with imported tokens
    tokens.forEach(t => {
      if (t.refresh_token) {
        const existing = tokenMap.get(t.refresh_token) || {};
        tokenMap.set(t.refresh_token, { ...existing, ...t });
      }
    });

    const mergedTokens = Array.from(tokenMap.values());

    const fileData = {
      salt: salt,
      tokens: mergedTokens
    };

    fs.writeFileSync(accountsFilePath, JSON.stringify(fileData, null, 2), 'utf8');
    console.log(`\n✓ 成功导入并保存至: ${accountsFilePath}`);
    console.log(`✓ 账户数据总计: ${mergedTokens.length} 个 token。`);
  } catch (err) {
    console.error('导入失败，发生非预期错误：', err);
  }
}

importTokens();
