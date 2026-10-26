// Content script for meet.google.com. Only active after the student has opted in.
// Reports every 15s: own camera/mic activity/tab focus, who is in the call (name,
// camera on, speaking, hand raised), and chat METADATA (sender, time, hash). Never message text.
(() => {
  const REPORT_MS = 15000;
  const SPEAK_LEVEL = 0.02;

  // Google Meet's markup changes often. Keep every selector here so fixes are one-line edits.
  const SEL = {
    tile: '[data-participant-id]',
    tileName: '[data-self-name], span.notranslate, .zWGUib',
    hand: '[aria-label*="raised" i], [data-hand-raised="true"]',
    speaking: '[class*="speaking" i], [data-is-speaking="true"]',
    chatMsg: '[data-message-id]',
  };

  const code = (location.pathname.match(/^\/([a-z]{3}-[a-z]{4}-[a-z]{3})/) || [])[1];
  if (!code) return;

  let cfg = { consent: false, paused: false, name: '', classCode: '' };
  const load = () => chrome.storage.local.get(['consent', 'paused', 'name', 'classCode'], v => { cfg = { ...cfg, ...v }; render(); });
  load();
  chrome.storage.onChanged.addListener(load);
  const active = () => cfg.consent && !cfg.paused && cfg.name && cfg.classCode;

  // ----- own mic/camera from inject.js -----
  let media = { level: 0, cam: false, mic: false };
  let speakingSec = 0;
  window.addEventListener('message', e => {
    if (e.source !== window || !e.data || e.data.source !== 'class-engagement') return;
    media = e.data;
    if (media.mic && media.level > SPEAK_LEVEL) speakingSec++;
  });

  // ----- DOM scraping -----
  const djb2 = s => { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return (h >>> 0).toString(36); };
  const cleanName = n => (n || '').replace(/\s*\(presentation\)/i, '').replace(/\s+/g, ' ').trim();

  function scrapeRoster() {
    const seen = new Map();
    document.querySelectorAll(SEL.tile).forEach(tile => {
      const nameEl = tile.matches('[data-self-name]') ? tile : tile.querySelector(SEL.tileName);
      let name = cleanName(tile.getAttribute('data-self-name') || nameEl?.textContent);
      if (!name) return;
      if (/^you$/i.test(name)) name = cfg.name;
      const v = tile.querySelector('video');
      const e = seen.get(name) || { name, cam: false, spk: false, hand: false };
      e.cam ||= !!v && v.videoWidth > 0 && !v.paused;
      e.spk ||= !!tile.querySelector(SEL.speaking);
      e.hand ||= !!tile.querySelector(SEL.hand);
      seen.set(name, e);
    });
    return [...seen.values()];
  }

  // Chat panel must be open for messages to exist in the DOM. Messages are de-duplicated
  // on the server, so it is enough if anyone running the extension has chat open.
  const seenMsgs = new Set();
  function senderOf(el) {
    let n = el;
    for (let i = 0; i < 4 && n.parentElement; i++) {
      n = n.parentElement;
      const lines = (n.innerText || '').split('\n').map(s => s.trim()).filter(Boolean);
      if (lines.length >= 3 && /\d{1,2}[:.]\d{2}/.test(lines[1])) return { sender: lines[0], time: lines[1] };
    }
    return null;
  }
  function scrapeChat() {
    const out = [];
    document.querySelectorAll(SEL.chatMsg).forEach(el => {
      const id = el.getAttribute('data-message-id');
      if (!id || seenMsgs.has(id)) return;
      const who = senderOf(el);
      if (!who) return; // try again on the next pass
      seenMsgs.add(id);
      out.push({ sender: /^you$/i.test(who.sender) ? cfg.name : cleanName(who.sender), time: who.time, hash: djb2(el.innerText || id) });
    });
    return out;
  }

  // ----- report loop -----
  let pendingChat = [];
  setInterval(() => { if (active()) pendingChat.push(...scrapeChat()); }, 3000);

  setInterval(() => {
    if (!active()) { speakingSec = 0; return; }
    const roster = scrapeRoster();
    if (!roster.length) return; // not in a call yet (lobby / ended)
    const payload = {
      meetingCode: code,
      reporter: cfg.name,
      self: {
        camOn: !!media.cam,
        speakingSec,
        focused: document.visibilityState === 'visible' && document.hasFocus(),
      },
      roster,
      chat: pendingChat.splice(0),
    };
    speakingSec = 0;
    try {
      chrome.runtime.sendMessage({ type: 'SNAPSHOT', payload }, r => { badgeOk = !!(r && r.ok); render(); });
    } catch { /* extension reloaded; page refresh fixes it */ }
  }, REPORT_MS);

  // ----- always-visible transparency badge -----
  let badgeOk = true;
  const badge = document.createElement('button');
  Object.assign(badge.style, {
    position: 'fixed', left: '12px', bottom: '88px', zIndex: 2147483647, font: '500 12px system-ui,sans-serif',
    padding: '6px 10px', borderRadius: '999px', border: '1px solid rgba(0,0,0,.2)', cursor: 'pointer',
    boxShadow: '0 1px 4px rgba(0,0,0,.25)',
  });
  badge.addEventListener('click', () => chrome.storage.local.set({ paused: !cfg.paused }));
  document.documentElement.appendChild(badge);
  function render() {
    if (!cfg.consent) { badge.style.display = 'none'; return; }
    badge.style.display = '';
    if (cfg.paused) { badge.textContent = '⏸ Engagement sharing paused. Click to resume'; badge.style.background = '#eee'; badge.style.color = '#333'; }
    else if (!badgeOk) { badge.textContent = '⚠ Engagement server unreachable'; badge.style.background = '#fde7e4'; badge.style.color = '#8a1f14'; }
    else { badge.textContent = `● Sharing engagement as ${cfg.name || '…'}. Click to pause`; badge.style.background = '#e3f3ee'; badge.style.color = '#0b4f3f'; }
  }
  render();
})();
