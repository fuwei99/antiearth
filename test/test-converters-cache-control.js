import { generateClaudeRequestBody } from '../src/utils/converters/claude.js';
import { generateRequestBody as generateOpenAIRequestBody } from '../src/utils/converters/openai.js';
import { generateGeminiRequestBody } from '../src/utils/converters/gemini.js';
import config from '../src/config/config.js';

// Setup basic dummy token
const dummyToken = {
  projectId: 'test-project-id'
};

// Ensure useContextSystemPrompt is true and mergeSystemPrompt is false for testing preservation
config.useContextSystemPrompt = true;
config.mergeSystemPrompt = false;

// ==========================================
// 1. Test Claude Format Converter
// ==========================================
function testClaudeCacheControl() {
  console.log('--- Testing Claude Format Cache Control ---');

  const systemPrompt = [
    {
      type: 'text',
      text: 'This is a system prompt.',
      cache_control: { type: 'ephemeral' }
    }
  ];

  const claudeMessages = [
    {
      role: 'user',
      content: [
        {
          type: 'text',
          text: 'Hello, here is some long background text.',
          cache_control: { type: 'ephemeral' }
        }
      ]
    },
    {
      role: 'assistant',
      content: [
        {
          type: 'text',
          text: 'I acknowledge the background.',
          promptCacheOptions: { type: 'CACHE_CONTROL_TYPE_EPHEMERAL' }
        }
      ]
    },
    {
      role: 'user',
      content: [
        {
          type: 'tool_result',
          tool_use_id: 'call_abc123',
          content: 'Tool result data.',
          cache_control: { type: 'ephemeral' }
        }
      ]
    }
  ];

  const requestBody = generateClaudeRequestBody(
    claudeMessages,
    'claude-sonnet-4-5',
    {},
    [],
    systemPrompt,
    dummyToken
  );

  console.log('Converted System Instruction:');
  console.log(JSON.stringify(requestBody.request.systemInstruction, null, 2));

  console.log('Converted Contents (User & Assistant Messages):');
  console.log(JSON.stringify(requestBody.request.contents, null, 2));

  // Assertions
  const systemParts = requestBody.request.systemInstruction.parts;
  const contents = requestBody.request.contents;

  if (systemParts[0]?.cache_control?.type === 'ephemeral') {
    console.log('✓ System Prompt cache_control successfully preserved!');
  } else {
    console.error('✗ System Prompt cache_control missing or incorrect!');
  }

  if (contents[0]?.parts[0]?.cache_control?.type === 'ephemeral') {
    console.log('✓ User message cache_control successfully preserved!');
  } else {
    console.error('✗ User message cache_control missing!');
  }

  if (contents[1]?.parts[0]?.promptCacheOptions?.type === 'CACHE_CONTROL_TYPE_EPHEMERAL') {
    console.log('✓ Assistant message promptCacheOptions successfully preserved!');
  } else {
    console.error('✗ Assistant message promptCacheOptions missing!');
  }

  if (contents[2]?.parts[0]?.cache_control?.type === 'ephemeral') {
    console.log('✓ Tool response cache_control successfully preserved!');
  } else {
    console.error('✗ Tool response cache_control missing!');
  }
}

// ==========================================
// 2. Test OpenAI Format Converter
// ==========================================
function testOpenAICacheControl() {
  console.log('\n--- Testing OpenAI Format Cache Control ---');

  const openaiMessages = [
    {
      role: 'system',
      content: 'This is an OpenAI system message.',
      cache_control: { type: 'ephemeral' }
    },
    {
      role: 'user',
      content: [
        {
          type: 'text',
          text: 'This is user content.',
          promptCacheOptions: { type: 'CACHE_CONTROL_TYPE_EPHEMERAL' }
        }
      ]
    },
    {
      role: 'assistant',
      content: 'Understood.',
      cache_control: { type: 'ephemeral' }
    },
    {
      role: 'tool',
      tool_call_id: 'call_xyz987',
      content: 'OpenAI tool result.',
      cache_control: { type: 'ephemeral' }
    }
  ];

  const requestBody = generateOpenAIRequestBody(
    openaiMessages,
    'gemini-2.5-flash',
    {},
    [],
    dummyToken
  );

  console.log('Converted System Instruction:');
  console.log(JSON.stringify(requestBody.request.systemInstruction, null, 2));

  console.log('Converted Contents:');
  console.log(JSON.stringify(requestBody.request.contents, null, 2));

  const systemParts = requestBody.request.systemInstruction?.parts;
  const contents = requestBody.request.contents;

  if (systemParts && systemParts[0]?.cache_control?.type === 'ephemeral') {
    console.log('✓ System Prompt cache_control successfully preserved!');
  } else {
    console.log('✗ System Prompt cache_control missing!');
  }

  if (contents[0]?.parts[0]?.promptCacheOptions?.type === 'CACHE_CONTROL_TYPE_EPHEMERAL') {
    console.log('✓ User message promptCacheOptions successfully preserved!');
  } else {
    console.error('✗ User message promptCacheOptions missing!');
  }

  if (contents[1]?.parts[0]?.cache_control?.type === 'ephemeral') {
    console.log('✓ Assistant message cache_control successfully preserved!');
  } else {
    console.error('✗ Assistant message cache_control missing!');
  }

  if (contents[2]?.parts[0]?.cache_control?.type === 'ephemeral') {
    console.log('✓ Tool response cache_control successfully preserved!');
  } else {
    console.error('✗ Tool response cache_control missing!');
  }
}

// Run tests
testClaudeCacheControl();
testOpenAICacheControl();
