const $ = id => document.getElementById(id);
chrome.storage.local.get(['name', 'classCode', 'serverUrl', 'consent'], v => {
  $('name').value = v.name || '';
  $('code').value = v.classCode || '';
  $('server').value = v.serverUrl || 'http://localhost:3000';
  $('consent').checked = !!v.consent;
});
$('save').onclick = () => {
  const name = $('name').value.trim(), classCode = $('code').value.trim();
  if (!name || !classCode) { $('msg').style.color = '#b03a2e'; $('msg').textContent = 'Enter your name and the class code.'; return; }
  chrome.storage.local.set({
    name, classCode, serverUrl: $('server').value.trim() || 'http://localhost:3000',
    consent: $('consent').checked, paused: false,
  }, () => {
    $('msg').style.color = '#0f6b55';
    $('msg').textContent = $('consent').checked ? 'Saved. Sharing starts when you join a Meet call.' : 'Saved. Sharing is OFF until you agree above.';
  });
};
