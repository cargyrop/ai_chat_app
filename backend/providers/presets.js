const CUSTOM_PROVIDER_PRESETS = [
  { id: 'kimi', label: 'Kimi / Moonshot', icon: '◐', type: 'openai-compatible', baseUrl: 'https://api.moonshot.ai/v1', modelsPath: '/models', chatPath: '/chat/completions' },
  { id: 'qwen', label: 'Qwen / DashScope', icon: '◆', type: 'openai-compatible', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', modelsPath: '/models', chatPath: '/chat/completions' },
  { id: 'mistral', label: 'Mistral AI', icon: '◩', type: 'openai-compatible', baseUrl: 'https://api.mistral.ai/v1', modelsPath: '/models', chatPath: '/chat/completions' },
  { id: 'together', label: 'Together AI', icon: '◬', type: 'openai-compatible', baseUrl: 'https://api.together.xyz/v1', modelsPath: '/models', chatPath: '/chat/completions' },
  { id: 'fireworks', label: 'Fireworks AI', icon: '✦', type: 'openai-compatible', baseUrl: 'https://api.fireworks.ai/inference/v1', modelsPath: '/models', chatPath: '/chat/completions' },
  { id: 'xai', label: 'xAI / Grok', icon: '✕', type: 'openai-compatible', baseUrl: 'https://api.x.ai/v1', modelsPath: '/models', chatPath: '/chat/completions' },
  { id: 'lmstudio', label: 'LM Studio Local', icon: '◌', type: 'openai-compatible-local', baseUrl: 'http://localhost:1234/v1', modelsPath: '/models', chatPath: '/chat/completions' },
  { id: 'vllm', label: 'vLLM Local Server', icon: '◌', type: 'openai-compatible-local', baseUrl: 'http://localhost:8000/v1', modelsPath: '/models', chatPath: '/chat/completions' },
  { id: 'llamacpp', label: 'llama.cpp Server', icon: '◌', type: 'openai-compatible-local', baseUrl: 'http://localhost:8080/v1', modelsPath: '/models', chatPath: '/chat/completions' }
];

module.exports = { CUSTOM_PROVIDER_PRESETS };
