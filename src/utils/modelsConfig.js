import fs from 'fs';
import { getConfigPaths } from './paths.js';
import log from './logger.js';

let loadedModels = {};
let loadedRouters = { gemini_router_rule: {}, openAI_router_rule: {} };

export function loadModelsConfig() {
  try {
    const paths = getConfigPaths();
    if (fs.existsSync(paths.modelsJsonPath)) {
      loadedModels = JSON.parse(fs.readFileSync(paths.modelsJsonPath, 'utf8'));
    } else if (fs.existsSync(paths.modelsJsonExamplePath)) {
      loadedModels = JSON.parse(fs.readFileSync(paths.modelsJsonExamplePath, 'utf8'));
    }
  } catch (err) {
    log.error('加载 models.json 失败:', err.message);
  }

  try {
    const paths = getConfigPaths();
    if (paths.routerJsonPath && fs.existsSync(paths.routerJsonPath)) {
      loadedRouters = JSON.parse(fs.readFileSync(paths.routerJsonPath, 'utf8'));
    } else if (paths.routerJsonExamplePath && fs.existsSync(paths.routerJsonExamplePath)) {
      loadedRouters = JSON.parse(fs.readFileSync(paths.routerJsonExamplePath, 'utf8'));
    }
  } catch (err) {
    log.error('加载 router.json 失败:', err.message);
  }
}

// 首次加载
loadModelsConfig();

/**
 * 智能解析 thinking_level/thinkingLevel 并返回正确的路由 modelID
 * 支持根据路由入口类型（OpenAI / Gemini / Claude）选用不同路由表和降级矩阵
 * @param {string} modelName - 原始模型名
 * @param {Object} reqBody - 请求体
 * @param {'openai'|'gemini'|'claude'} [format] - 路由类型，默认为自动推断
 * @returns {string} 路由后的模型名
 */
export function resolveModelWithThinkingLevel(modelName, reqBody = {}, format = 'gemini') {
  if (!modelName) return modelName;

  // 1. 尝试提取 thinking_level 字符
  let thinkingLevel = 
    reqBody.generationConfig?.thinkingLevel ??
    reqBody.generationConfig?.thinking_level ??
    reqBody.generation_config?.thinkingLevel ??
    reqBody.generation_config?.thinking_level ??
    reqBody.thinkingLevel ??
    reqBody.thinking_level ??
    reqBody.reasoning_effort ??
    reqBody.reasoning?.effort ??
    reqBody.thinking?.level;

  if (typeof thinkingLevel === 'string') {
    thinkingLevel = thinkingLevel.toLowerCase().trim();
  } else {
    thinkingLevel = null;
  }

  // 2. 根据 format 选择路由规则集
  // 如果是 openai 路由或者传入的格式是 openai/claude 并且含有 reasoning_effort、reasoning.effort 或 thinking.level 等参数，走 openAI_router_rule 规则
  const isOpenAIRoute = format === 'openai' || format === 'claude' || 
    reqBody.reasoning_effort !== undefined || 
    reqBody.reasoning?.effort !== undefined ||
    reqBody.thinking?.level !== undefined;
  const ruleSet = isOpenAIRoute ? loadedRouters.openAI_router_rule : loadedRouters.gemini_router_rule;

  // 3. 提取基础模型名（剥离衍生模型的后缀，用于模糊匹配规则）
  let baseModelName = modelName;
  if (modelName.startsWith('gemini-3.6-flash-')) {
    baseModelName = 'gemini-3.6-flash';
  } else if (modelName.startsWith('gemini-3.5-flash-') || modelName === 'gemini-3-flash-agent') {
    baseModelName = 'gemini-3.5-flash';
  }

  // 4. 优先寻找完整匹配的 router 配置，其次寻找 baseModelName 的匹配
  const router = ruleSet?.[modelName] || ruleSet?.[baseModelName];

  if (router) {
    if (thinkingLevel) {
      if (router[thinkingLevel]) {
        return router[thinkingLevel];
      }
    } else {
      // 未指定 thinking_level 时，如果请求的是基础名（如 gemini-3.6-flash），路由到默认模型
      if (modelName === baseModelName && router.default) {
        return router.default;
      }
      if (modelName === baseModelName && router.none) {
        return router.none;
      }
    }
  }

  return modelName;
}

/**
 * 获取指定模型的配置
 * @param {string} modelId 
 * @returns {Object|null}
 */
export function getModelConfig(modelId) {
  if (!modelId) return null;
  const model = modelId.toLowerCase();
  
  if (loadedModels[modelId]) {
    return loadedModels[modelId];
  }
  
  for (const key of Object.keys(loadedModels)) {
    if (key.toLowerCase() === model) {
      return loadedModels[key];
    }
  }
  
  return null;
}

export function getAllModelsConfig() {
  return loadedModels;
}
