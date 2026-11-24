// 本番につなぐときに2つ入れる。空のままだと、この端末の中だけで動く試し用になる。
var CFG = {
  LIFF_ID: '2012748533-NJVEG2R0',  // LINE の LIFF ID
  GAS_URL: 'https://script.google.com/macros/s/AKfycbwpBCUXheL0Q91E5E7uUIoMcHcUjY6UxyoaQrtWhQ1p8G6Cj8pghaRjDJj8JsTCam0brg/exec'   // Apps Script のウェブアプリURL
};

// 店ごとの切り替え。札幌は sapporo/ のページが CASA_STORE='sapporo' を先に置く。データは同じスプレッドシートの別タブ（members_sapporo など）。
var CASA_STORE_ID = (typeof CASA_STORE === 'string') ? CASA_STORE : '';
// スタンプと特典は使わない（札幌・渋谷とも。2026-11-24 オーナー指定）。style.css の .no-stamp が欄を隠す。
document.documentElement.classList.add('no-stamp');
// 渋谷は札幌より明るい青（2026-11-24 オーナー指定）。style.css の .shop-shibuya。
if (!CASA_STORE_ID) document.documentElement.classList.add('shop-shibuya');
if (CASA_STORE_ID === 'sapporo') CFG.LIFF_ID = '2012748533-jNeqsZC5'; // 札幌用 LIFF（casa札幌 会員証）

// 会員証QRの中身。渋谷は casa:1001（前からの形のまま）、札幌は casa-sapporo:1001。店をまたいで読んだら止める。
var QR_PREFIX = CASA_STORE_ID ? 'casa-' + CASA_STORE_ID + ':' : 'casa:';
function readMemberQr(text) {
  var m = /^casa(?:-([a-z]+))?:(\d+)$/.exec(String(text || ''));
  if (!m) return null;
  if ((m[1] || '') !== CASA_STORE_ID) return { other: true };
  return { no: m[2] };
}

// 画面の出し分け。?view=rank はランキングだけ。札幌はメニューが2つ（会員証／ランキング）なので、会員証の側ではランキングを出さない。
// LINE の中では最初 ?liff.state=%3Fview%3Drank の形で来るので、そちらも見る。
var CASA_VIEW = (function () {
  var q = new URLSearchParams(location.search);
  var st = q.get('liff.state') || '';
  if (q.get('view') === 'rank' || st.indexOf('view=rank') >= 0) return 'rank';
  return 'card'; // 両店とも、メニューは「会員証」と「ランキング」の2つ
})();
if (CASA_VIEW) document.documentElement.classList.add('v-' + CASA_VIEW);
if (CASA_VIEW === 'rank') document.title = 'ランキング';

// 手元で試すとき用: URL の末尾に ?demo=1 を付けると、この端末の中だけで動く。
if (location.search.indexOf('demo=1') >= 0) { CFG.LIFF_ID = ''; CFG.GAS_URL = ''; }

// 画面から呼ぶ窓口。本番は Apps Script、試し用は端末内の保存領域を使う。
async function casaApi(req) {
  req.store = CASA_STORE_ID;
  if (CFG.GAS_URL) {
    var res = await fetch(CFG.GAS_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify(req) });
    var j = await res.json();
    if (!j.ok) throw new Error(j.error || '通信に失敗しました');
    return j.data;
  }
  var KEY = 'casaMemberDemo' + CASA_STORE_ID;
  var db = {
    load: function () { try { return JSON.parse(localStorage.getItem(KEY)) || { members: [], rewards: [] }; } catch (e) { return { members: [], rewards: [] }; } },
    save: function (d) { localStorage.setItem(KEY, JSON.stringify(d)); },
    log: function (x) { var l = db.all(); l.push(x); localStorage.setItem(KEY + 'Log', JSON.stringify(l)); },
    all: function () { try { return JSON.parse(localStorage.getItem(KEY + 'Log')) || []; } catch (e) { return []; } },
    history: function (no, n) { return db.all().filter(function (x) { return Number(x.no) === Number(no); }).reverse().slice(0, n); }
  };
  if (!localStorage.getItem(KEY)) { // 試し用の見本データ（名前は作り物）
    var names = ['ゲスト', 'たなか', 'SATO', 'みやび', 'K.Yamada', 'りく', 'NOBU', 'あおい'], bs = [7, 12, 9, 7, 5, 3, 2, 1];
    db.save({ rewards: [], members: names.map(function (n, i) {
      return { userId: i ? 'demo-' + i : 'demo-user', no: 1001 + i, name: n, chips: i ? 0 : 48000, stamps: i ? 0 : 2, visits: i ? 0 : 2, lastStamp: '', createdAt: '', phone: '0900000000' + i, bounty: bs[i] };
    }) });
    [[6, 30000, '預かり', 30000], [4, -12000, '払い出し', 18000], [2, 45000, '預かり', 63000], [1, -15000, '払い出し', 48000]].forEach(function (x) {
      db.log({ at: new Date(Date.now() - x[0] * 864e5).toISOString(), staff: '見本', no: 1001, type: x[2], amount: x[1], note: '残り ' + x[3] });
    });
  }
  var now = new Date();
  var today = now.getFullYear() + '-' + ('0' + (now.getMonth() + 1)).slice(-2) + '-' + ('0' + now.getDate()).slice(-2);
  return casaHandle(req, db, {
    now: now.toISOString(), today: req.demoToday || today,
    userId: 'demo-user', name: 'ゲスト', isStaff: req.pass === '0000'
  });
}

function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
function num(n) { return Number(n || 0).toLocaleString('ja-JP'); }
