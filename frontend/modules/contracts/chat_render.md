# Module: chat_render.js

## Responsibility
Render chat messages in the DOM. Handle assistant streaming, user messages, thinking blocks, typing indicators, scroll management, thinking toggle.

## Public API
- `renderMessages(msgs): void` — Clear and re-render all messages for current conversation
- `appendMessage(role, content, animate, model, msgIdx, thinking, thinkingTime): void` — Append a single message bubble to #messages
- `appendTypingBubble(): void` — Show typing indicator (animated dots)
- `scrollBottom(): void` — Scroll #messages to bottom smoothly
- `toggleThinking(el): void` — Toggle visibility of a thinking block

## DOM Targets
- `#messages` — Chat messages container
- `#empty-state` — Empty state shown when no messages
- `.msg` — Individual message divs (created dynamically)
- `.thinking-block` — Thinking/reasoning content blocks (created dynamically)
- `.typing` — Typing indicator (created dynamically)
- `.edit-msg`, `.copy-msg`, `.regen-msg` — Message action buttons (created dynamically)
- `.code-block` — Code blocks with copy button (from markdown.js)

## Invariants
- Empty state is shown when messages array is empty, hidden otherwise
- User messages are on the right, assistant on the left
- Each message has action buttons: edit, copy, regenerate (for assistant messages)
- Thinking blocks are collapsible, initially shown
- Code blocks have language label and COPY button
- Animation uses `animate` CSS class for new messages
- Scroll happens after a short delay to account for DOM reflow
- `msgIdx` is stored as data attribute for action handlers

## Dependencies
- state.js (`conversations`, `currentConvId`)
- core.js (`escHtml`)
- markdown.js (`formatMd`)

## Used By
chat_send.js, conversations.js, chat_actions.js, data.js
