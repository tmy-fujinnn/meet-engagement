const url = 'http://localhost:3000/api/snapshot';
const post = b => fetch(url, {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-class-code': 'demo-class' },
  body: JSON.stringify(b),
}).then(r => console.log('sent', r.status));

const roster = [
  { name: 'Alice Reyes', cam: true,  spk: true,  hand: false },
  { name: 'Bob Cruz',    cam: false, spk: false, hand: false },
];
let i = 0;
function tick() {
  post({ meetingCode: 'abc-defg-hij', reporter: 'Alice Reyes',
    self: { camOn: true, speakingSec: i % 2 ? 4 : 0, focused: true }, roster,
    chat: i % 3 === 0 ? [{ sender: 'Alice Reyes', time: '10:0' + (i % 10), hash: 'h' + i }] : [] });
  post({ meetingCode: 'abc-defg-hij', reporter: 'Bob Cruz',
    self: { camOn: false, speakingSec: 0, focused: false }, roster, chat: [] });
  i++;
}
tick();
setInterval(tick, 15000);