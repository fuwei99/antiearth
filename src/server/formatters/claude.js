/**
 * Claude/Anthropic 响应格式化工具
 */

/**
 * 创建 Claude 非流式响应
 * @param {string} id
 * @param {string} model
 * @param {string|null} content
 * @param {string|null} reasoning
 * @param {string|null} reasoningSignature
 * @param {Array|null} toolCalls
 * @param {string} stopReason
 * @param {Object|null} usage
 * @param {{passSignatureToClient?: boolean}} options
 * @returns {Object}
 */
export const createClaudeResponse = (
  id,
  model,
  content,
  reasoning,
  reasoningSignature,
  toolCalls,
  stopReason,
  usage,
  options = {}
) => {
  const passSignatureToClient = options.passSignatureToClient === true;

  const contentBlocks = [];

  if (reasoning) {
    const thinkingBlock = {
      type: 'thinking',
      thinking: reasoning
    };
    if (reasoningSignature && passSignatureToClient) {
      thinkingBlock.signature = reasoningSignature;
    }
    contentBlocks.push(thinkingBlock);
  }

  if (content) {
    contentBlocks.push({
      type: 'text',
      text: content
    });
  }

  if (toolCalls && toolCalls.length > 0) {
    for (const tc of toolCalls) {
      try {
        const inputObj = JSON.parse(tc.function.arguments);
        const toolBlock = {
          type: 'tool_use',
          id: tc.id,
          name: tc.function.name,
          input: inputObj
        };
        if (tc.thoughtSignature && passSignatureToClient) {
          toolBlock.signature = tc.thoughtSignature;
        }
        contentBlocks.push(toolBlock);
      } catch {
        contentBlocks.push({
          type: 'tool_use',
          id: tc.id,
          name: tc.function.name,
          input: {}
        });
      }
    }
  }

  return {
    id,
    type: 'message',
    role: 'assistant',
    content: contentBlocks,
    model,
    stop_reason: stopReason,
    stop_sequence: null,
    usage: usage
      ? {
          input_tokens: usage.prompt_tokens || 0,
          output_tokens: usage.completion_tokens || 0,
          cache_read_input_tokens: usage.cached_content_tokens || 0
        }
      : { input_tokens: 0, output_tokens: 0 }
  };
};
