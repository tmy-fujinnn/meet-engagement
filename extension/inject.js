// Runs in the page's own JS world so it can observe the student's OWN mic/camera
// streams. It only computes a loudness number and on/off flags; audio and video
// never leave the browser and are never recorded.
(() => {
  if (window.__engInjected) return;
  window.__engInjected = true;
  const md = navigator.mediaDevices;
  if (!md || !md.getUserMedia) return;

  const streams = new Set();
  const taps = [];
  let ac = null;
  const ctx = () => (ac ||= new (window.AudioContext || window.webkitAudioContext)());
  document.addEventListener('click', () => { try { ctx().resume(); } catch {} }, true);

  const orig = md.getUserMedia.bind(md);
  md.getUserMedia = async (...args) => {
    const stream = await orig(...args);
    try {
      streams.add(stream);
      if (stream.getAudioTracks().length) {
        const c = ctx(); c.resume && c.resume();
        const an = c.createAnalyser(); an.fftSize = 512;
        c.createMediaStreamSource(new MediaStream(stream.getAudioTracks())).connect(an);
        taps.push({ stream, an, buf: new Uint8Array(an.fftSize) });
      }
    } catch {}
    return stream;
  };

  const rms = ({ an, buf }) => {
    an.getByteTimeDomainData(buf);
    let s = 0;
    for (const v of buf) { const x = (v - 128) / 128; s += x * x; }
    return Math.sqrt(s / buf.length);
  };

  setInterval(() => {
    let cam = false, mic = false, level = 0;
    for (const s of [...streams]) {
      if (!s.active) { streams.delete(s); continue; }
      for (const t of s.getVideoTracks()) if (t.readyState === 'live' && t.enabled && !t.muted) cam = true;
      for (const t of s.getAudioTracks()) if (t.readyState === 'live' && t.enabled && !t.muted) mic = true;
    }
    for (let i = taps.length - 1; i >= 0; i--) {
      if (!taps[i].stream.active) { taps.splice(i, 1); continue; }
      level = Math.max(level, rms(taps[i]));
    }
    window.postMessage({ source: 'class-engagement', level, cam, mic }, '*');
  }, 1000);
})();
