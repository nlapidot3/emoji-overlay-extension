chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'emoji') {
    const overlay = document.createElement('div');
    overlay.textContent = message.emoji;
    overlay.className = 'emoji-overlay';
    document.body.appendChild(overlay);
    setTimeout(() => overlay.remove(), 2000);
  }
});

