import fs from 'fs';
import { getConfigPaths } from './paths.js';
import log from './logger.js';

let loadedModels = {};

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
}

// 首次加载
loadModelsConfig();

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
