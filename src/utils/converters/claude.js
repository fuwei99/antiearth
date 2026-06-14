// Claude 格式转换工具
import config from '../../config/config.js';
import { convertClaudeToolsToAntigravity } from '../toolConverter.js';
import {
  getSignatureContext,
  pushUserMessage,
  findFunctionNameById,
  pushFunctionResponse,
  createThoughtPart,
  createFunctionCallPart,
  processToolName,
  pushModelMessage,
  buildRequestBody,
  mergeSystemInstruction,
  modelMapping,
  isEnableThinking,
  generateGenerationConfig,
  cleanPartFields
} from './common.js';

function extractClaudeContentToParts(content, messageContext = {}) {
  const parts = [];

  if (typeof content === 'string') {
    parts.push({ text: content || ' ' });
    return parts;
  }

  if (Array.isArray(content)) {
    for (const item of content) {
      let part = null;
      if (item.type === 'text') {
        part = { text: item.text || ' ' };
      } else if (item.type === 'image') {
        const source = item.source;
        if (source && source.type === 'base64' && source.data) {
          part = {
            inlineData: {
              mimeType: source.media_type || 'image/png',
              data: source.data
            }
          };
        }
      }
      
      if (part) {
        // Gemini gRPC 协议不支持 cache_control/promptCacheOptions，隐式缓存由后端自动处理
        // 显式剔除防御：确保即使上游传入这些字段也不会透传到下游
        cleanPartFields(part);
        parts.push(part);
      }
    }
  }

  if (parts.length === 0) {
    parts.push({ text: ' ' });
  }
  return parts;
}

function handleClaudeAssistantMessage(message, antigravityMessages, enableThinking, actualModelName, sessionId, hasTools) {
  const content = message.content;
  const { reasoningSignature, reasoningContent, toolSignature, toolContent } = getSignatureContext(sessionId, actualModelName, hasTools);

  let textContent = '';
  let thinkingContent = '';
  const toolCalls = [];
  let messageSignature = null;

  if (typeof content === 'string') {
    textContent = content;
  } else if (Array.isArray(content)) {
    for (const item of content) {
      if (item.type === 'text') {
        textContent += item.text || '';
      } else if (item.type === 'thinking') {
        // Claude thinking block: collect thinking content and signature
        if (item.thinking) thinkingContent += item.thinking;
        if (!messageSignature) messageSignature = item.signature || item.thought_signature || item.thoughtSignature;
      } else if (item.type === 'tool_use') {
        const safeName = processToolName(item.name, sessionId, actualModelName);
        const signature = item.signature || item.thought_signature || item.thoughtSignature || toolSignature || reasoningSignature;
        const toolCallPart = createFunctionCallPart(item.id, safeName, JSON.stringify(item.input || {}), signature);
        // Gemini gRPC 协议不支持 cache_control/promptCacheOptions，显式剔除防御
        cleanPartFields(toolCallPart);
        toolCalls.push(toolCallPart);
      }
    }
  }

  const hasContent = textContent && textContent.trim() !== '';
  const parts = [];
  
  if (enableThinking) {
    const signature = messageSignature || message.thoughtSignature || message.thought_signature || reasoningSignature || toolSignature;
    // 只有在有签名时才添加 thought part，避免 API 报错
    if (signature) {
      // 优先使用消息自带的思考内容，否则使用缓存的内容（与签名绑定）
      let reasoningText = ' ';
      if (thinkingContent.length > 0) {
        reasoningText = thinkingContent;
      } else if (signature === reasoningSignature) {
        reasoningText = reasoningContent || ' ';
      } else if (signature === toolSignature) {
        reasoningText = toolContent || ' ';
      }
      parts.push(createThoughtPart(reasoningText, signature));
    }
  }
  if (hasContent) {
    parts.push({ text: textContent.trimEnd() });
  }
  if (!enableThinking && parts[0]) delete parts[0].thoughtSignature;

  // Gemini gRPC 协议不支持 cache_control/promptCacheOptions，显式剔除防御
  for (const p of parts) cleanPartFields(p);
  for (const tc of toolCalls) cleanPartFields(tc);

  pushModelMessage({ parts, toolCalls, hasContent }, antigravityMessages);
}

function handleClaudeToolResult(message, antigravityMessages) {
  const content = message.content;
  if (!Array.isArray(content)) return;

  for (const item of content) {
    if (item.type !== 'tool_result') continue;

    const toolUseId = item.tool_use_id;
    const functionName = findFunctionNameById(toolUseId, antigravityMessages);

    let resultContent = '';
    if (typeof item.content === 'string') {
      resultContent = item.content;
    } else if (Array.isArray(item.content)) {
      resultContent = item.content.filter(c => c.type === 'text').map(c => c.text).join('');
    }

    pushFunctionResponse(toolUseId, functionName, resultContent, antigravityMessages, item);
  }
}

function claudeMessageToAntigravity(claudeMessages, enableThinking, actualModelName, sessionId, hasTools) {
  const antigravityMessages = [];
  for (const message of claudeMessages) {
    if (message.role === 'user') {
      const content = message.content;
      if (Array.isArray(content) && content.some(item => item.type === 'tool_result')) {
        handleClaudeToolResult(message, antigravityMessages);
      } else {
        const extracted = extractClaudeContentToParts(content, message);
        pushUserMessage(extracted, antigravityMessages);
      }
    } else if (message.role === 'assistant') {
      handleClaudeAssistantMessage(message, antigravityMessages, enableThinking, actualModelName, sessionId, hasTools);
    }
  }
  return antigravityMessages;
}

export function generateClaudeRequestBody(claudeMessages, modelName, parameters, claudeTools, systemPrompt, token) {
  const enableThinking = isEnableThinking(modelName);
  const actualModelName = modelMapping(modelName);
  // 直接传递用户的系统提示词，让 buildSystemInstruction 处理所有合并逻辑
  // 包括反重力官方提示词、萌萌提示词和用户提示词的位置配置

  const tools = convertClaudeToolsToAntigravity(claudeTools, token.sessionId, actualModelName);
  const hasTools = tools && tools.length > 0;
  return buildRequestBody({
    contents: claudeMessageToAntigravity(claudeMessages, enableThinking, actualModelName, token.sessionId, hasTools),
    tools: tools,
    generationConfig: generateGenerationConfig(parameters, enableThinking, actualModelName),
    // sessionId 由 buildRequestBody 基于 contents 内容自动生成稳定值（提升 Gemini 隐式缓存命中率）
    systemInstruction: systemPrompt
  }, token, actualModelName);
}
