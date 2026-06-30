# Module: backend/services/chatProxy.js

## Responsibility
Stream chat requests to any AI provider and return SSE chunks to the client. Handle all provider-specific API formats, token counting, error handling, and streaming protocols.

## Public API
- `streamChat(req, res, cfg): Promise<void>` — Full chat proxy: validates input, streams response, reports usage

## Supported Providers
- Anthropic (Messages API with thinking blocks)
- OpenAI / Groq / OpenRouter / DeepSeek / Custom (OpenAI-compatible chat completions)
- Gemini (Google Generative Language API with SSE)
- Ollama (local /api/chat)

## Invariants
- All provider calls have 120-second timeout
- Usage is reported at the end of every stream: `{type: 'usage', usage: {promptTokens, completionTokens, totalTokens, estimated}}`
- If provider doesn't report usage, estimate from text length / 4 and mark `estimated: true`
- System prompts are combined from explicit + message-level system messages, capped at 200K chars
- Gemini and OpenAI providers filter out system messages (provider-specific format)
- Reasoning/thinking content is streamed as `{reasoning: "..."}` chunks
- Unknown provider returns 400 error before any network call

## Dependencies
- `backend/utils` (readErrorMessage, explainProviderError, sanitizeMessages, joinUrl, getCustomProvider)
- `backend/config` (loadConfig)
