# Module: conversations.js

## Responsibility
Conversation CRUD, sidebar rendering, search filter, inline rename, token counter.

## Public API
- `newConversation(switchTo): void` — Create new conversation, save, render sidebar, optionally load it
- `loadConversation(id): void` — Set current conversation, render messages, update token counter
- `deleteConversation(id, e): void` — Delete conversation after confirm, save, render sidebar, load another if needed
- `saveConversations(): void` — Save conversations to localStorage, enforce MAX_CONVERSATIONS (50), warn if >4MB
- `getFilteredConversations(): Array` — Return conversations filtered by `convSearchFilter`
- `renderConvList(): void` — Render sidebar conversation list with rename/delete buttons
- `filterConversations(q): void` — Set filter and re-render list
- `clearConvSearch(): void` — Clear search input and filter
- `startRenameConversation(id, e): void` — Show inline rename input for a conversation
- `cancelRenameConversation(): void` — Cancel inline rename, restore original title
- `updateConvTitle(id, firstMsg): void` — Update conversation title from first user message (if still "New chat")
- `updateTokenCounterUI(): void` — Update token counter badge from current conversation messages

## DOM Targets
- `#conv-list` — Conversation list container
- `#conv-search` — Search filter input
- `#new-chat-btn` — New chat button
- `#token-count-text` — Token counter badge text
- `.conv-item` — Conversation items (created dynamically)
- `.conv-rename-input` — Inline rename input (created dynamically)

## Invariants
- Maximum 50 conversations. Oldest removed when exceeding.
- Conversation size warning at 4MB (localStorage limit)
- New conversations are prepended (unshift) to the list
- Active conversation has `.active` class
- Inline rename input replaces the title span, Escape cancels, Enter saves, blur saves
- Token counter sums all message content lengths / 4 (approximate)
- Deleting active conversation loads the next available one

## Dependencies
- state.js (`conversations`, `currentConvId`, `convSearchFilter`, `renamingConvId`, `MAX_CONVERSATIONS`)
- core.js (`escHtml`, `autoResize`)
- chat_render.js (`renderMessages`)
- toast.js

## Used By
app.js bootstrap, chat_send.js, chat_actions.js, data.js
