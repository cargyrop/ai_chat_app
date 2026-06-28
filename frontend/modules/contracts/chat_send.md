# Module: chat_send.js

## Responsibility
Send user messages, stream AI responses via SSE, manage streaming state, stop generation, handle keyboard input.

## Public API
- `sendMessage(overrideText): Promise<void>` — Send a message. If streaming, returns immediately. Validates input, appends user message, starts SSE stream.
- `stopGenerating(): void` — Abort current fetch, reset streaming state
- `setStreamingUI(isStreaming): void` — Toggle send/stop buttons, input disabled state
- `extractThinkAndClean(raw): {text, thinking}` — Extract thinking content from raw response (Claude <thinking> tags, reasoning text)
- `onInputKey(e): void` — Keydown handler: Enter sends, Shift+Enter newline, Escape stops

## DOM Targets
- `#msg-input` — Message textarea
- `#send-btn` — Send button
- `#stop-btn` — Stop button (shown during streaming)

## Invariants
- `sendMessage` must not be callable while `streaming === true`
- `stopGenerating` must abort `activeAbortController`, set `streaming = false`, update UI
- After sending, input is cleared and auto-resized
- Token counter is updated after each message append
- If no conversation exists, `newConversation(true)` is called
- System prompt is included in the request if set
- `enableThinking` is set for capable models
- On stream error, error message is appended as assistant message
- Usage is reported and appended at end of stream

## Dependencies
- state.js (`streaming`, `activeAbortController`, `currentModel`, `currentConvId`, `conversations`, `systemPrompt`, `appManifest`)
- core.js (`autoResize`)
- toast.js
- conversations.js (`newConversation`, `loadConversation`, `saveConversations`, `updateConvTitle`, `updateTokenCounterUI`)
- chat_render.js (`appendMessage`, `appendTypingBubble`, `scrollBottom`)
- models.js (`modelKey`)
- data.js (`renderManifestAsPrompt`)

## Used By
app.js bootstrap (event listener), chat_actions.js (regenerate)
