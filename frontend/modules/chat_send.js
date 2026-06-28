/* BLACKLINE AI — chat_send module (Phase 2) */

async function sendMessage(overrideText) {
  if (streaming) return;
  const input = document.getElementById('msg-input');
  const text = (overrideText !== undefined ? overrideText : (input ? input.value.trim() : '')).trim();
  if (!text) return;
  if (!currentModel) { toast('Please select a model first', 'err'); return; }
  if (!currentConvId) newConversation(true);

  if (input && overrideText === undefined) { input.value = ''; autoResize(input); }

  const conv = conversations.find(c => c.id === currentConvId);
  if (!conv) return;

  conv.messages.push({ role: 'user', content: text });
  saveConversations();
  updateConvTitle(currentConvId, text);
  appendMessage('user', text, true, null, conv.messages.length - 1);

  appendTypingBubble();
  const actionTickerText = document.getElementById('action-ticker-text');
  const thinkingContainer = document.getElementById('live-thinking-container');
  const thinkingTimerEl = document.getElementById('thinking-timer');
  const thinkingContentText = document.getElementById('thinking-content-text');
  const thinkingScrollBox = document.getElementById('thinking-scroll-box');
  const answerBubble = document.getElementById('live-answer-bubble');

  const sendBtn = document.getElementById('send-btn');
  const stopBtn = document.getElementById('stop-btn');
  if (sendBtn) sendBtn.style.display = 'none';
  if (stopBtn) stopBtn.style.display = 'flex';
  streaming = true;
  activeAbortController = new AbortController();

  let totalRawContent = '';
  let dedicatedReasoning = '';
  let thinkingStartTime = null;
  let thinkingTimerInterval = null;
  let hasCollapsedThinking = false;
  let streamError = '';

  thinkingTimerInterval = setInterval(() => {
    if (thinkingStartTime && thinkingTimerEl) {
      thinkingTimerEl.textContent = ((Date.now() - thinkingStartTime) / 1000).toFixed(1) + 's';
    }
  }, 100);

  const dynamicSystemPrompt = systemPrompt;

  try {
    const r = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        provider: currentModel.provider,
        model: currentModel.id,
        messages: conv.messages,
        systemPrompt: dynamicSystemPrompt,
        enableThinking: false
      }),
      signal: activeAbortController.signal
    });
    if (!r.ok) throw new Error(await apiErrorMessage(r, 'Chat request failed'));
    if (!r.body) throw new Error('Chat response did not include a stream');

    const reader = r.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        try {
          const d = JSON.parse(line.slice(6));
          if (d.error) {
            streamError = d.error;
            if (actionTickerText) actionTickerText.textContent = 'Error';
            if (answerBubble) {
              answerBubble.style.display = 'block';
              answerBubble.innerHTML = `<span style="color:var(--red)">Error: ${escHtml(d.error)}</span>`;
            }
            scrollBottom();
            break;
          }
          if (d.type === 'usage' && d.usage) {
            if (!conv.tokenUsage) conv.tokenUsage = { prompt: 0, completion: 0, total: 0, estimated: false };
            conv.tokenUsage.prompt += (d.usage.promptTokens || 0);
            conv.tokenUsage.completion += (d.usage.completionTokens || 0);
            conv.tokenUsage.total += (d.usage.totalTokens || 0);
            // Estimated flag is sticky: once any provider returns a heuristic
            // count, we label the whole conversation estimate for that turn.
            if (d.usage.estimated) conv.tokenUsage.estimated = true;
            saveConversations();
            updateTokenCounterUI();
          }
          if (d.reasoning) {
            dedicatedReasoning += d.reasoning;
            if (!thinkingStartTime) thinkingStartTime = Date.now();
          }
          if (d.text) totalRawContent += d.text;

          const { clean, think, currentlyInThink } = extractThinkAndClean(totalRawContent);
          const liveThink = (dedicatedReasoning + (think ? '\n' + think : '')).trim();
          const liveClean = clean.trim();

          if (liveThink || currentlyInThink) {
            if (!thinkingStartTime) thinkingStartTime = Date.now();
            if (thinkingContainer) thinkingContainer.style.display = 'block';
            if (thinkingContentText) thinkingContentText.textContent = liveThink;
            if (thinkingScrollBox) thinkingScrollBox.scrollTop = thinkingScrollBox.scrollHeight;
            if (actionTickerText) actionTickerText.textContent = 'Thinking…';
          }
          if (liveClean || (!currentlyInThink && liveClean.length > 0)) {
            if (answerBubble) {
              answerBubble.style.display = 'block';
              answerBubble.innerHTML = formatMd(liveClean);
            }
            if (actionTickerText) actionTickerText.textContent = 'Writing…';
            scrollBottom();
            if (thinkingContainer && !currentlyInThink && liveThink && !hasCollapsedThinking && liveClean.length > 40) {
              thinkingContainer.classList.add('collapsed');
              hasCollapsedThinking = true;
            }
          }
        } catch {}
      }
      if (streamError) break;
    }
  } catch(e) {
    if (e.name === 'AbortError') {
      streamError = 'Stopped by user';
    } else {
      if (actionTickerText) actionTickerText.textContent = 'Network error';
      if (answerBubble) {
        answerBubble.style.display = 'block';
        answerBubble.innerHTML = `<span style="color:var(--red)">Network error: ${escHtml(e.message)}</span>`;
      }
      streamError = e.message;
    }
  }

  if (thinkingTimerInterval) { clearInterval(thinkingTimerInterval); thinkingTimerInterval = null; }
  const thinkingFinalDuration = thinkingStartTime ? ((Date.now() - thinkingStartTime) / 1000).toFixed(1) : 0;
  if (actionTickerText) actionTickerText.textContent = 'Done';
  setTimeout(() => { document.getElementById('live-action-ticker')?.remove(); }, 900);

  const { clean: finalCleanParsed, think: finalThinkParsed } = extractThinkAndClean(totalRawContent);
  const finalLiveThink = (dedicatedReasoning + (finalThinkParsed ? '\n' + finalThinkParsed : '')).trim();
  let finalLiveClean = finalCleanParsed.trim();

  if (streamError === 'Stopped by user') {
    finalLiveClean += '\n\n*[Stopped by user]*';
  } else if (streamError && !finalLiveClean) {
    finalLiveClean = '[Error: ' + streamError + ']';
  } else if (!finalLiveClean && finalLiveThink) {
    finalLiveClean = '*[No final answer provided]*';
  }

  const modelInfo = { ...currentModel };
  const modelObj = models.find(m => m.id === currentModel.id && m.provider === currentModel.provider);
  if (modelObj) { modelInfo.icon = modelObj.icon || ''; modelInfo.name = modelObj.name || modelObj.id; }

  const finalMsgObj = {
    role: 'assistant',
    content: finalLiveClean,
    thinking: finalLiveThink,
    thinkingTime: thinkingFinalDuration,
    model: modelInfo
  };

  conv.messages.push(finalMsgObj);
  saveConversations();

  const newBubble = appendMessage('assistant', finalMsgObj.content, false, modelInfo, conv.messages.length - 1, finalMsgObj.thinking, finalMsgObj.thinkingTime);
  document.getElementById('active-assistant-message')?.replaceWith(newBubble);

  setStreamingUI(false);
  activeAbortController = null;
}

function stopGenerating() {
  if (activeAbortController) {
    activeAbortController.abort();
    activeAbortController = null;
  }
  setStreamingUI(false);
}

function setStreamingUI(isStreaming) {
  streaming = isStreaming;
  const sendBtn = document.getElementById('send-btn');
  const stopBtn = document.getElementById('stop-btn');
  if (sendBtn) sendBtn.style.display = isStreaming ? 'none' : 'flex';
  if (stopBtn) stopBtn.style.display = isStreaming ? 'flex' : 'none';
  if (sendBtn) sendBtn.disabled = false;
}

function extractThinkAndClean(raw) {
  let clean = '';
  let think = '';
  let currentlyInThink = false;
  let pos = 0;
  while (pos < raw.length) {
    if (!currentlyInThink) {
      const startIdx = raw.indexOf('<think>', pos);
      if (startIdx === -1) { clean += raw.slice(pos); break; }
      else { clean += raw.slice(pos, startIdx); pos = startIdx + 7; currentlyInThink = true; }
    } else {
      const endIdx = raw.indexOf('</think>', pos);
      if (endIdx === -1) { think += raw.slice(pos); break; }
      else { think += raw.slice(pos, endIdx); pos = endIdx + 8; currentlyInThink = false; }
    }
  }
  return { clean, think, currentlyInThink };
}

function onInputKey(e) {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
}
