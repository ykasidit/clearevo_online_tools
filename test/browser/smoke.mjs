// Load every tool page from the hashed dist build; fail on console errors,
// page exceptions, or any failed/4xx+ network request.
const PORT = 8077, CDP = 9333;
const BASE = process.env.BASE || `http://127.0.0.1:${PORT}`;
const TOOLS = ['doctor', 'calc', 'isearch', 'hex', 'geo', 'qr', 'audio', 'dicom'];
const targets = await (await fetch(`http://127.0.0.1:${CDP}/json/list`)).json();
const page = targets.find((t) => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0; const pending = new Map(); const events = [];
ws.onmessage = (m) => {
  const d = JSON.parse(m.data);
  if (d.id && pending.has(d.id)) { const { ok, err } = pending.get(d.id); pending.delete(d.id); d.error ? err(new Error(JSON.stringify(d.error))) : ok(d.result); }
  else if (d.method) events.push(d);
};
const send = (method, params = {}) => new Promise((ok, err) => { const i = ++id; pending.set(i, { ok, err }); ws.send(JSON.stringify({ id: i, method, params })); });
await new Promise((ok) => { ws.onopen = ok; });
await send('Runtime.enable'); await send('Page.enable'); await send('Network.enable'); await send('Log.enable');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let fails = 0;
for (const tool of TOOLS) {
  events.length = 0;
  await send('Page.navigate', { url: `${BASE}/${tool}/` });
  await sleep(3000);
  const bad = [];
  for (const e of events) {
    if (e.method === 'Runtime.exceptionThrown') bad.push(`exception: ${JSON.stringify(e.params.exceptionDetails.exception?.description || e.params.exceptionDetails.text).slice(0, 160)}`);
    if (e.method === 'Network.loadingFailed' && !e.params.canceled) bad.push(`loadFailed: ${e.params.errorText}`);
    if (e.method === 'Network.responseReceived' && e.params.response.status >= 400) bad.push(`${e.params.response.status}: ${e.params.response.url}`);
    if (e.method === 'Log.entryAdded' && e.params.entry.level === 'error') bad.push(`console: ${e.params.entry.text.slice(0, 160)}`);
  }
  console.log(`${bad.length ? 'FAIL' : 'PASS'}  /${tool}/ ${bad.length ? '\n    ' + bad.join('\n    ') : ''}`);
  if (bad.length) fails++;
}
ws.close(); process.exit(fails ? 1 : 0);
