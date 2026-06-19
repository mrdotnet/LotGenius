"""The served chat page — a single self-contained HTML string (vanilla JS).

No build step, no external assets, no framework. Lightly branded for the Lot
Genius appraiser demo and clearly tagged as a local Teams stand-in.
"""

from __future__ import annotations

INDEX_HTML = r"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Lot Genius — Appraiser Assistant</title>
<style>
  :root{
    --bg:#0f1419; --panel:#161d26; --panel-2:#1d2733; --line:#2a3744;
    --ink:#e8eef4; --muted:#8da2b5; --accent:#3a8f5f; --accent-ink:#d9f3e3;
    --chip:#1f3a2c; --chip-ink:#7fd4a3; --amber:#3a2f12; --amber-ink:#f0c469;
    --amber-line:#6b531c;
  }
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--ink);
    font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
  header{padding:18px 22px;border-bottom:1px solid var(--line);
    display:flex;align-items:baseline;gap:12px;background:var(--panel)}
  header .mark{font-weight:700;font-size:18px;letter-spacing:.2px}
  header .mark .lg{color:var(--accent)}
  header .tag{font-size:11px;color:var(--muted);border:1px solid var(--line);
    border-radius:999px;padding:2px 9px;text-transform:uppercase;letter-spacing:.6px}
  header .who{margin-left:auto;display:flex;align-items:center;gap:8px;font-size:12px;color:var(--muted)}
  header .who label{text-transform:uppercase;letter-spacing:.6px;font-size:11px}
  #role{background:var(--panel-2);color:var(--ink);border:1px solid var(--line);
    border-radius:8px;padding:6px 9px;font-size:13px;outline:none;cursor:pointer}
  #role:focus{border-color:var(--accent)}
  .pii{font-size:11px;border-radius:999px;padding:2px 9px;border:1px solid var(--line);
    text-transform:uppercase;letter-spacing:.5px}
  .pii.on{background:var(--chip);color:var(--chip-ink);border-color:#295c40}
  .pii.off{background:var(--amber);color:var(--amber-ink);border-color:var(--amber-line)}
  .consignor{margin-top:10px;padding:10px 12px;border-radius:10px;background:var(--panel-2);
    border:1px solid var(--line);font-size:13px}
  .consignor .ctitle{font-size:11px;text-transform:uppercase;letter-spacing:.6px;color:var(--muted);
    margin-bottom:6px}
  .consignor .row{display:flex;gap:8px}
  .consignor .k{color:var(--muted);min-width:64px}
  .consignor .v{font-variant-numeric:tabular-nums}
  .consignor .v.redacted{color:var(--amber-ink);font-style:italic}
  main{max-width:820px;margin:0 auto;padding:22px 18px 140px}
  .examples{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:18px}
  .examples button{background:var(--panel-2);color:var(--muted);border:1px solid var(--line);
    border-radius:8px;padding:7px 11px;font-size:12.5px;cursor:pointer;transition:.12s}
  .examples button:hover{color:var(--ink);border-color:var(--accent)}
  #transcript{display:flex;flex-direction:column;gap:14px}
  .turn{display:flex;flex-direction:column;gap:8px}
  .bubble{padding:12px 15px;border-radius:12px;max-width:90%;white-space:pre-wrap;
    word-wrap:break-word}
  .q{align-self:flex-end;background:var(--accent);color:#fff;border-bottom-right-radius:3px}
  .a{align-self:flex-start;background:var(--panel);border:1px solid var(--line);
    border-bottom-left-radius:3px}
  .a.escalated{background:var(--amber);border-color:var(--amber-line)}
  .a .label{font-size:11px;text-transform:uppercase;letter-spacing:.6px;color:var(--muted);
    margin-bottom:6px;display:flex;gap:8px;align-items:center}
  .a.escalated .label{color:var(--amber-ink)}
  .escbadge{background:var(--amber-line);color:#fff;border-radius:4px;padding:1px 6px;
    font-weight:600}
  .chips{display:flex;flex-wrap:wrap;gap:6px;margin-top:10px}
  .chip{background:var(--chip);color:var(--chip-ink);border:1px solid #295c40;
    border-radius:999px;padding:3px 10px;font-size:12px;font-variant-numeric:tabular-nums}
  .meta{font-size:11px;color:var(--muted);margin-top:8px;display:flex;gap:12px}
  .meta .intent{text-transform:uppercase;letter-spacing:.5px}
  .composer{position:fixed;bottom:0;left:0;right:0;background:var(--panel);
    border-top:1px solid var(--line);padding:14px 18px}
  .composer .row{max-width:820px;margin:0 auto;display:flex;gap:10px}
  #q{flex:1;background:var(--panel-2);border:1px solid var(--line);color:var(--ink);
    border-radius:10px;padding:12px 14px;font-size:15px;outline:none}
  #q:focus{border-color:var(--accent)}
  #send{background:var(--accent);color:#fff;border:0;border-radius:10px;padding:0 20px;
    font-weight:600;cursor:pointer}
  #send:disabled{opacity:.5;cursor:default}
  .thinking{color:var(--muted);font-style:italic}
  .err{color:#f0a0a0}
</style>
</head>
<body>
<header>
  <span class="mark"><span class="lg">Lot</span> Genius</span>
  <span class="tag">local demo · Teams stand-in</span>
  <span class="who">
    <label for="role">Signed in as</label>
    <select id="role" title="Switch the demo caller to see the consignor-PII differential"></select>
    <span id="pii" class="pii off">PII hidden</span>
  </span>
</header>
<main>
  <div class="examples">
    <button data-q="show me 5 comps for a 2023 John Deere X9 1100">Comps: 2023 John Deere X9 1100</button>
    <button data-q="how much is a unicorn worth">Refusal: unicorn value</button>
    <button data-q="year over year hammer price trend for combines">Trend: combines YoY</button>
  </div>
  <div id="transcript"></div>
</main>
<div class="composer">
  <div class="row">
    <input id="q" type="text" autocomplete="off"
      placeholder="Ask about comparable lots, a price trend, or what something sold for…" />
    <button id="send">Send</button>
  </div>
</div>
<script>
(function(){
  var input = document.getElementById('q');
  var sendBtn = document.getElementById('send');
  var transcript = document.getElementById('transcript');
  var roleSel = document.getElementById('role');
  var piiBadge = document.getElementById('pii');

  // Map of role -> can_see_pii, populated from /roles so the selector mirrors
  // the seeded ABAC groups (basic/appraiser/admin) rather than a hardcoded list.
  var roleCanSeePii = {};

  function el(tag, cls, text){
    var e = document.createElement(tag);
    if(cls) e.className = cls;
    if(text != null) e.textContent = text;
    return e;
  }

  function updatePiiBadge(){
    var canSee = !!roleCanSeePii[roleSel.value];
    piiBadge.textContent = canSee ? 'PII visible' : 'PII hidden';
    piiBadge.className = 'pii ' + (canSee ? 'on' : 'off');
  }

  async function loadRoles(){
    try{
      var res = await fetch('/roles');
      var data = await res.json();
      (data.roles || []).forEach(function(r){
        roleCanSeePii[r.role] = r.can_see_pii;
        var opt = el('option', null, r.label);
        opt.value = r.role;
        roleSel.appendChild(opt);
      });
      if(data.default) roleSel.value = data.default;
    }catch(e){ /* selector stays empty; /ask still defaults to basic */ }
    updatePiiBadge();
  }
  roleSel.addEventListener('change', updatePiiBadge);

  function renderConsignor(node, consignor){
    if(!consignor) return;
    var box = el('div','consignor');
    box.appendChild(el('div','ctitle','Consignor (restricted)'));
    var FIELDS = [
      ['consignor_name','Name'],
      ['consignor_phone','Phone'],
      ['consignor_email','Email']
    ];
    FIELDS.forEach(function(f){
      var val = consignor[f[0]];
      if(val == null) return;
      var row = el('div','row');
      row.appendChild(el('span','k', f[1]));
      var redacted = (val === '[REDACTED]');
      row.appendChild(el('span','v' + (redacted ? ' redacted' : ''), val));
      box.appendChild(row);
    });
    node.appendChild(box);
  }

  function addQuestion(text){
    var turn = el('div','turn');
    turn.appendChild(el('div','bubble q', text));
    transcript.appendChild(turn);
    window.scrollTo(0, document.body.scrollHeight);
    return turn;
  }

  function addThinking(turn){
    var a = el('div','bubble a thinking','Thinking…');
    turn.appendChild(a);
    window.scrollTo(0, document.body.scrollHeight);
    return a;
  }

  function renderAnswer(node, data){
    node.className = 'bubble a' + (data.escalated ? ' escalated' : '');
    node.textContent = '';
    var label = el('div','label');
    label.appendChild(el('span', null, data.escalated ? 'Assistant' : 'Assistant'));
    if(data.escalated){
      label.appendChild(el('span','escbadge','escalated to a human'));
    }
    node.appendChild(label);

    node.appendChild(el('div', null, data.answer));

    if(!data.escalated && data.citations && data.citations.length){
      var chips = el('div','chips');
      data.citations.forEach(function(id){
        chips.appendChild(el('span','chip','Lot ' + id));
      });
      node.appendChild(chips);
    }

    if(!data.escalated) renderConsignor(node, data.consignor);

    var meta = el('div','meta');
    meta.appendChild(el('span','intent', 'route: ' + (data.intent||'—')));
    if(data.caller_label){
      meta.appendChild(el('span', null, 'as: ' + data.caller_label));
    }
    meta.appendChild(el('span', null, (data.latency_ms != null ? data.latency_ms + ' ms' : '')));
    node.appendChild(meta);
    window.scrollTo(0, document.body.scrollHeight);
  }

  function renderError(node, msg){
    node.className = 'bubble a';
    node.textContent = '';
    node.appendChild(el('div','err', msg));
  }

  async function ask(text){
    if(!text || !text.trim()) return;
    input.value = '';
    sendBtn.disabled = true;
    var turn = addQuestion(text.trim());
    var answerNode = addThinking(turn);
    try{
      var res = await fetch('/ask', {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify({query: text.trim(), role: roleSel.value || null})
      });
      var data = await res.json();
      if(!res.ok){ renderError(answerNode, data.error || ('HTTP ' + res.status)); }
      else { renderAnswer(answerNode, data); }
    }catch(e){
      renderError(answerNode, 'Request failed: ' + e);
    }finally{
      sendBtn.disabled = false;
      input.focus();
    }
  }

  sendBtn.addEventListener('click', function(){ ask(input.value); });
  input.addEventListener('keydown', function(e){ if(e.key === 'Enter') ask(input.value); });
  Array.prototype.forEach.call(document.querySelectorAll('.examples button'), function(b){
    b.addEventListener('click', function(){ ask(b.getAttribute('data-q')); });
  });
  loadRoles();
  input.focus();
})();
</script>
</body>
</html>
"""
