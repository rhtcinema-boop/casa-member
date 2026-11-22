// 本番につなぐときに2つ入れる。空のままだと、この端末の中だけで動く試し用になる。
var CFG = {
  LIFF_ID: '2012748533-NJVEG2R0',  // LINE の LIFF ID
  GAS_URL: 'https://script.google.com/macros/s/AKfycbwpBCUXheL0Q91E5E7uUIoMcHcUjY6UxyoaQrtWhQ1p8G6Cj8pghaRjDJj8JsTCam0brg/exec'   // Apps Script のウェブアプリURL
};

// 画面から呼ぶ窓口。本番は Apps Script、試し用は端末内の保存領域を使う。
async function casaApi(req) {
  if (CFG.GAS_URL) {
    var res = await fetch(CFG.GAS_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify(req) });
    var j = await res.json();
    if (!j.ok) throw new Error(j.error || '通信に失敗しました');
    return j.data;
  }
  var KEY = 'casaMemberDemo';
  var db = {
    load: function () { try { return JSON.parse(localStorage.getItem(KEY)) || { members: [], rewards: [] }; } catch (e) { return { members: [], rewards: [] }; } },
    save: function (d) { localStorage.setItem(KEY, JSON.stringify(d)); },
    log: function (x) { var l = db.all(); l.push(x); localStorage.setItem(KEY + 'Log', JSON.stringify(l)); },
    all: function () { try { return JSON.parse(localStorage.getItem(KEY + 'Log')) || []; } catch (e) { return []; } },
    history: function (no, n) { return db.all().filter(function (x) { return Number(x.no) === Number(no); }).reverse().slice(0, n); }
  };
  var now = new Date();
  var today = now.getFullYear() + '-' + ('0' + (now.getMonth() + 1)).slice(-2) + '-' + ('0' + now.getDate()).slice(-2);
  return casaHandle(req, db, {
    now: now.toISOString(), today: req.demoToday || today,
    userId: 'demo-user', name: 'ゲスト', isStaff: req.pass === '0000'
  });
}

function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
function num(n) { return Number(n || 0).toLocaleString('ja-JP'); }
