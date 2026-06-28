# Module: chat_actions.js

## Responsibility
Message-level actions: edit, copy, regenerate, clear chat, export, insert suggestion. Pure actions, no streaming logic.

## Public API
- `editMsgAction(idx): void` — Load message into input for editing, truncate conversation to that point
- `copyMsgAction(idx, btn): Promise<void>` — Copy message content to clipboard, flash button
- `regenMsgAction(idx): void` — Regenerate assistant response at index, keeping prior context
- `copyCode(btn, e): Promise<void>` — Copy code block content to clipboard, flash button
- `clearCurrentChat(): void` — Clear messages from current conversation after confirm
- `exportCurrentChat(): void` — Download current conversation as markdown file
- `insertSuggestion(el): void` — Insert suggestion text into input and send

## Invariants
- Edit truncates conversation to before the edited message, user must re-send
- Regenerate removes the assistant message and all after it, then re-sends the last user message
- Clear chat requires confirmation if messages exist
- Export generates filename with timestamp and conversation title
- Code copy stops event propagation
- Suggestion insert triggers `sendMessage()` immediately

## Dependencies
- state.js (`conversations`, `currentConvId`, `streaming`)
- core.js (`flashCopied`, `copyTextToClipboard`)
- toast.js
- chat_send.js (`sendMessage`, `stopGenerating`)
- chat_render.js (`renderMessages`)
- conversations.js (`saveConversations`, `updateTokenCounterUI`)

## Used By
HTML onclick handlers (inline), app.js bootstrap (suggestion keyboard nav)
