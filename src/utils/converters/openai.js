// OpenAI 格式转换工具
import config from '../../config/config.js';
import { extractSystemInstruction } from '../utils.js';
import { convertOpenAIToolsToAntigravity } from '../toolConverter.js';
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
  modelMapping,
  isEnableThinking,
  generateGenerationConfig,
  cleanPartFields
} from './common.js';

function extractOpenAIContentToParts(content, messageContext = {}) {
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
      } else if (item.type === 'image_url') {
        const imageUrl = item.image_url?.url || '';
        const match = imageUrl.match(/^data:image\/(\w+);base64,(.+)$/);
        if (match) {
          part = {
            inlineData: {
              mimeType: `image/${match[1]}`,
              data: match[2]
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

function handleAssistantMessage(message, antigravityMessages, enableThinking, actualModelName, hasTools) {
  const hasToolCalls = message.tool_calls && message.tool_calls.length > 0;
  const hasContent = message.content && message.content.trim() !== '';
  const { reasoningSignature, reasoningContent, toolSignature, toolContent } = getSignatureContext(actualModelName, hasTools);
  
  const toolCalls = hasToolCalls
    ? message.tool_calls.map(toolCall => {
      const safeName = processToolName(toolCall.function.name, actualModelName);
      const signature = toolCall.thoughtSignature || toolCall.thought_signature || toolSignature || message.thoughtSignature || message.thought_signature || reasoningSignature;
      const toolCallPart = createFunctionCallPart(toolCall.id, safeName, toolCall.function.arguments, signature);
      // Gemini gRPC 协议不支持 cache_control/promptCacheOptions，显式剔除防御
      cleanPartFields(toolCallPart);
      return toolCallPart;
    })
    : [];

  const parts = [];
  if (enableThinking) {
    // 优先使用消息自带的思考内容，否则使用缓存的内容（与签名绑定）
    let reasoningText = ' ';
    let signature = null;
    
    if (typeof message.reasoning_content === 'string' && message.reasoning_content.length > 0) {
      // 消息自带思考内容，使用消息自带的签名或缓存签名
      reasoningText = message.reasoning_content;
      signature = message.thoughtSignature || message.thought_signature || reasoningSignature || toolSignature;
    } else {
      // 没有思考内容，使用缓存的签名+内容（绑定关系）
      signature = message.thoughtSignature || message.thought_signature || reasoningSignature || toolSignature;
      if (signature === reasoningSignature) {
        reasoningText = reasoningContent || ' ';
      } else if (signature === toolSignature) {
        reasoningText = toolContent || ' ';
      }
    }
    
    // 只有在有签名时才添加 thought part，避免 API 报错
    if (signature) {
      parts.push(createThoughtPart(reasoningText, signature));
    }
  }
  if (hasContent) {
    parts.push({ text: message.content.trimEnd() });
  }
  if (!enableThinking && parts[0]) delete parts[0].thoughtSignature;

  // Gemini gRPC 协议不支持 cache_control/promptCacheOptions，显式剔除防御
  for (const p of parts) cleanPartFields(p);
  for (const tc of toolCalls) cleanPartFields(tc);

  pushModelMessage({ parts, toolCalls, hasContent }, antigravityMessages);
}

function handleToolCall(message, antigravityMessages) {
  const functionName = findFunctionNameById(message.tool_call_id, antigravityMessages);
  pushFunctionResponse(message.tool_call_id, functionName, message.content, antigravityMessages, message);
}

function openaiMessageToAntigravity(openaiMessages, enableThinking, actualModelName, hasTools) {
  const antigravityMessages = [];
  for (const message of openaiMessages) {
    if (message.role === 'user' || message.role === 'system') {
      const extracted = extractOpenAIContentToParts(message.content, message);
      pushUserMessage(extracted, antigravityMessages);
    } else if (message.role === 'assistant') {
      handleAssistantMessage(message, antigravityMessages, enableThinking, actualModelName, hasTools);
    } else if (message.role === 'tool') {
      handleToolCall(message, antigravityMessages);
    }
  }
  //console.log(JSON.stringify(antigravityMessages,null,2));
  return antigravityMessages;
}

export function generateRequestBody(openaiMessages, modelName, parameters, openaiTools, token) {
  const enableThinking = isEnableThinking(modelName);
  const actualModelName = modelMapping(modelName);
  const mergedSystemInstruction = extractSystemInstruction(openaiMessages);

  let filteredMessages = openaiMessages;
  let startIndex = 0;
  if (config.useContextSystemPrompt) {
    for (let i = 0; i < openaiMessages.length; i++) {
      if (openaiMessages[i].role === 'system') {
        startIndex = i + 1;
      } else {
        filteredMessages = openaiMessages.slice(startIndex);
        break;
      }
    }
  }

  const tools = convertOpenAIToolsToAntigravity(openaiTools, actualModelName);
  const hasTools = tools && tools.length > 0;
  //console.log(JSON.stringify(tools, null, 2))
  return buildRequestBody({
    contents: openaiMessageToAntigravity(filteredMessages, enableThinking, actualModelName, hasTools),
    tools: tools,
    generationConfig: generateGenerationConfig(parameters, enableThinking, actualModelName),
    systemInstruction: mergedSystemInstruction
  }, token, actualModelName);
}
