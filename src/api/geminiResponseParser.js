export function parseGeminiCandidateParts({
  parts,
  model,
  convertToToolCall,
  saveBase64Image
} = {}) {
  if (!Array.isArray(parts)) {
    return {
      content: '',
      reasoningContent: null,
      reasoningSignature: null,
      toolCalls: [],
      imageUrls: []
    };
  }

  let content = '';
  let reasoningContent = '';
  let reasoningSignature = null;
  let lastSeenSignature = null;
  const toolCalls = [];
  const imageUrls = [];

  for (const part of parts) {
    if (part?.thoughtSignature) {
      lastSeenSignature = part.thoughtSignature;
    }

    if (part?.thought === true) {
      reasoningContent += part.text || '';
      if (part.thoughtSignature) {
        reasoningSignature = part.thoughtSignature;
      }
      continue;
    }

    if (part?.text !== undefined) {
      content += part.text;
      continue;
    }

    if (part?.functionCall) {
      const toolCall = convertToToolCall(part.functionCall, model);
      const sig = part.thoughtSignature || lastSeenSignature || null;
      if (sig) toolCall.thoughtSignature = sig;
      toolCalls.push(toolCall);
      continue;
    }

    if (part?.inlineData) {
      const imageUrl = saveBase64Image(part.inlineData.data, part.inlineData.mimeType);
      imageUrls.push(imageUrl);
      continue;
    }
  }

  if (!reasoningSignature && lastSeenSignature) {
    reasoningSignature = lastSeenSignature;
  }

  return {
    content,
    reasoningContent: reasoningContent || null,
    reasoningSignature,
    toolCalls,
    imageUrls
  };
}

export function toOpenAIUsage(usageMetadata) {
  if (!usageMetadata) return null;
  const thoughtsTokens = usageMetadata.thoughtsTokenCount || 0;
  return {
    prompt_tokens: usageMetadata.promptTokenCount || 0,
    completion_tokens: (usageMetadata.candidatesTokenCount || 0) + thoughtsTokens,
    total_tokens: usageMetadata.totalTokenCount || 0,
    cached_content_tokens: usageMetadata.cachedContentTokenCount || 0
  };
}
