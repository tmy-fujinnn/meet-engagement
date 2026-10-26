// Relays snapshots from the Meet tab to the engagement server (avoids page CORS / mixed-content limits).
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type !== 'SNAPSHOT') return;
  (async () => {
    const { serverUrl, classCode } = await chrome.storage.local.get(['serverUrl', 'classCode']);
    try {
      const r = await fetch(`${(serverUrl || 'http://localhost:3000').replace(/\/$/, '')}/api/snapshot`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-class-code': classCode || '' },
        body: JSON.stringify(msg.payload),
      });
      sendResponse({ ok: r.ok });
    } catch { sendResponse({ ok: false }); }
  })();
  return true; // async response
});
