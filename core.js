// 会員証の計算ルール。
// ブラウザの試し用（demo）と Apps Script（本番）で、このファイルをそのまま両方に入れて使う。

var CASA_RULES = {
  // 退店の時に、預入チップを「アウト − 総イン」だけ増減させる（2026-11-24 オーナー指定）
  chipOnLeave: true,
  goal: 10, // スタンプ何個で1枚たまるか
  // 何個目で特典が出るか（2026-11-22 オーナー指定）
  milestones: [
    { at: 3, title: 'アミュリン100BB 無料プレゼント' },
    { at: 5, title: 'アルコール飲み放題 無料' },
    { at: 10, title: '5,000 casa pt プレゼント' }
  ]
};

// req: {op, ...} / db: {load(), save(data), log(entry), history(no, n)} / ctx: {now, today, userId, name, isStaff}
function casaHandle(req, db, ctx) {
  var d = db.load(); // {members: [], rewards: [], visits: []}
  d.visits = d.visits || [];

  function byUser(id) {
    for (var i = 0; i < d.members.length; i++) if (String(d.members[i].userId) === String(id)) return d.members[i];
    return null;
  }
  function byNo(no) {
    var n = Number(String(no).replace(/[^0-9]/g, ''));
    for (var i = 0; i < d.members.length; i++) if (Number(d.members[i].no) === n) return d.members[i];
    return null;
  }
  function view(m) {
    var open = [];
    for (var i = 0; i < d.rewards.length; i++) {
      var r = d.rewards[i];
      if (String(r.userId) === String(m.userId) && !r.usedAt) open.push({ id: String(r.id), title: r.title, issuedAt: r.issuedAt });
    }
    // ランキング（Ring Bounty の多い順。同じ数は同じ順位）
    var list = d.members.filter(function (x) { return Number(x.bounty) > 0; })
      .sort(function (a, b) { return Number(b.bounty) - Number(a.bounty) || Number(a.no) - Number(b.no); });
    var rank = [], myRank = 0;
    for (var q = 0; q < list.length; q++) {
      var pos = q > 0 && Number(list[q].bounty) === Number(list[q - 1].bounty) ? rank[q - 1].rank : q + 1;
      var mine = String(list[q].userId) === String(m.userId);
      if (mine) myRank = pos;
      rank.push({ rank: pos, name: list[q].name || 'ゲスト', bounty: Number(list[q].bounty), me: mine });
    }
    var top = rank.filter(function (x, idx) { return idx < 10 || x.me; });
    // チップの増減（自分の預かり・払い出しだけ）
    var moves = db.history(m.no, 60).filter(function (x) { return x.type === '預かり' || x.type === '払い出し' || (x.type === '退店' && CASA_RULES.chipOnLeave); }).slice(0, 20)
      .map(function (x) { return { at: x.at, type: x.type, amount: Number(x.amount), note: x.note }; });
    return {
      no: Number(m.no), name: m.name, chips: Number(m.chips) || 0,
      bounty: Number(m.bounty) || 0, myRank: myRank, ranking: top, moves: moves,
      stamps: Number(m.stamps) || 0, visits: Number(m.visits) || 0,
      stampedToday: String(m.lastStamp) === ctx.today,
      goal: CASA_RULES.goal, milestones: CASA_RULES.milestones, rewards: open
    };
  }
  function staffView(m) { var o = view(m); o.phone = String(m.phone || ''); o.history = db.history(m.no, 30); return o; }
  function presentList() { // 在店中の人（来店の古い順）
    var out = [];
    for (var i = 0; i < d.visits.length; i++) {
      var v = d.visits[i]; if (v.outAt) continue;
      var mm = byNo(v.no);
      out.push({ id: String(v.id), no: Number(v.no), name: mm ? (mm.name || 'ゲスト') : '?', kind: v.kind, inAt: v.inAt, chips: mm ? Number(mm.chips) || 0 : 0 });
    }
    return out.sort(function (a, b) { return String(a.inAt) < String(b.inAt) ? -1 : 1; });
  }
  function needStaff() { if (!ctx.isStaff) throw new Error('スタッフ用の合言葉が違います'); }
  function needMember(m) { if (!m) throw new Error('会員が見つかりません'); return m; }

  var m, out;
  switch (req.op) {
    case 'me': // お客さん：自分の会員証（初回は登録）
      if (!ctx.userId) throw new Error('LINEの確認ができませんでした');
      m = byUser(ctx.userId);
      var phone = String(req.phone || '').replace(/[^0-9]/g, '');
      if (!m || !m.phone) { // 初回は電話番号だけ登録してもらう
        if (!phone) return { needPhone: true };
        if (!/^0[0-9]{9,10}$/.test(phone)) throw new Error('電話番号を確かめてください');
      }
      if (m && !m.phone) { m.phone = phone; db.save(d); }
      if (!m) {
        var max = 1000;
        for (var i = 0; i < d.members.length; i++) max = Math.max(max, Number(d.members[i].no) || 0);
        m = { userId: ctx.userId, no: max + 1, name: ctx.name || '', chips: 0, stamps: 0, visits: 0, lastStamp: '', createdAt: ctx.now, phone: phone, bounty: 0 };
        d.members.push(m);
        db.save(d);
        db.log({ at: ctx.now, staff: '', no: m.no, type: '登録', amount: '', note: '' });
      }
      return view(m);

    case 'redeem': // お客さん：特典を使う
      m = needMember(byUser(ctx.userId));
      for (var j = 0; j < d.rewards.length; j++) {
        var r = d.rewards[j];
        if (String(r.id) === String(req.rewardId) && String(r.userId) === String(m.userId)) {
          if (r.usedAt) throw new Error('この特典は使用済みです');
          r.usedAt = ctx.now;
          db.save(d);
          db.log({ at: ctx.now, staff: '', no: m.no, type: '特典を使用', amount: '', note: r.title });
          out = view(m); out.used = { title: r.title, at: ctx.now };
          return out;
        }
      }
      throw new Error('特典が見つかりません');

    case 'staffGet': // スタッフ：会員を開く
      needStaff();
      return staffView(needMember(byNo(req.no)));

    case 'stamp': // スタッフ：来店スタンプ（1日1個）
      needStaff();
      m = needMember(byNo(req.no));
      if (String(m.lastStamp) === ctx.today) throw new Error('今日はもう押してあります');
      var s = Number(m.stamps) || 0;
      if (s >= CASA_RULES.goal) s = 0; // いっぱいなら新しい台紙へ
      s += 1;
      m.stamps = s; m.visits = (Number(m.visits) || 0) + 1; m.lastStamp = ctx.today;
      var got = [];
      for (var k = 0; k < CASA_RULES.milestones.length; k++) {
        var ms = CASA_RULES.milestones[k];
        if (ms.at === s) {
          d.rewards.push({ id: 'r' + Date.now() + '_' + k, userId: m.userId, title: ms.title, issuedAt: ctx.now, usedAt: '' });
          got.push(ms.title);
        }
      }
      db.save(d);
      db.log({ at: ctx.now, staff: req.staff || '', no: m.no, type: 'スタンプ', amount: 1, note: got.join('、') });
      out = staffView(m); out.got = got;
      return out;

    case 'present': // スタッフ：いま在店中の人
      needStaff();
      return { present: presentList() };

    case 'arrive': // スタッフ：来店（リング／トナメ）
      needStaff();
      m = needMember(byNo(req.no));
      for (var p = 0; p < d.visits.length; p++) if (Number(d.visits[p].no) === Number(m.no) && !d.visits[p].outAt) throw new Error('この方はもう在店中です');
      d.visits.push({ id: 'v' + Date.now(), no: m.no, kind: 'アミューズリング', // この LINE はアミューズリング専用。ゲームの選択はない（2026-11-24 オーナー）
        inAt: ctx.now, outAt: '', buyin: '', out: '', bounty: '', staff: req.staff || '' });
      m.visits = (Number(m.visits) || 0) + 1;
      db.save(d);
      db.log({ at: ctx.now, staff: req.staff || '', no: m.no, type: '来店', amount: '', note: '' });
      return { present: presentList(), name: m.name, no: Number(m.no) };

    case 'leave': // スタッフ：退店（総イン・アウト・バウンティ）
      needStaff();
      var vt = null;
      for (var q2 = 0; q2 < d.visits.length; q2++) if (String(d.visits[q2].id) === String(req.visitId)) vt = d.visits[q2];
      if (!vt || vt.outAt) throw new Error('在店中の記録が見つかりません');
      m = needMember(byNo(vt.no));
      var bi = Math.round(Number(req.buyin) || 0), ou = Math.round(Number(req.out) || 0), bo = Math.round(Number(req.bounty) || 0);
      if (bi < 0 || ou < 0 || bo < 0) throw new Error('数を確かめてください');
      vt.outAt = ctx.now; vt.buyin = bi; vt.out = ou; vt.bounty = bo; vt.staff = req.staff || vt.staff;
      if (bo) m.bounty = (Number(m.bounty) || 0) + bo;
      if (CASA_RULES.chipOnLeave) {
        var nc = (Number(m.chips) || 0) + ou - bi;
        if (nc < 0) throw new Error('預入チップが足りません（残り ' + (Number(m.chips) || 0) + '）');
        m.chips = nc;
      }
      db.save(d);
      db.log({ at: ctx.now, staff: req.staff || '', no: m.no, type: '退店', amount: ou - bi, note: 'IN ' + bi + ' / OUT ' + ou + ' / Bounty ' + bo + (CASA_RULES.chipOnLeave ? ' / 残り ' + m.chips : '') });
      return { present: presentList(), name: m.name, no: Number(m.no), bounty: Number(m.bounty) || 0, chips: Number(m.chips) || 0 };

    case 'chip': // スタッフ：チップを預かる（＋）／払い出す（−）
      needStaff();
      m = needMember(byNo(req.no));
      var a = Math.round(Number(req.amount));
      if (!a || !isFinite(a)) throw new Error('数を入れてください');
      var next = (Number(m.chips) || 0) + a;
      if (next < 0) throw new Error('残りが足りません（残り ' + (Number(m.chips) || 0) + '）');
      m.chips = next;
      db.save(d);
      db.log({ at: ctx.now, staff: req.staff || '', no: m.no, type: a > 0 ? '預かり' : '払い出し', amount: a, note: '残り ' + next });
      return staffView(m);

    case 'bounty': // スタッフ：Ring Bounty を足す（＋）／引く（−）
      needStaff();
      m = needMember(byNo(req.no));
      var b = Math.round(Number(req.amount));
      if (!b || !isFinite(b)) throw new Error('数を入れてください');
      var nb = (Number(m.bounty) || 0) + b;
      if (nb < 0) throw new Error('Bounty が足りません（今 ' + (Number(m.bounty) || 0) + '）');
      m.bounty = nb;
      db.save(d);
      db.log({ at: ctx.now, staff: req.staff || '', no: m.no, type: 'Bounty', amount: b, note: '合計 ' + nb });
      return staffView(m);
  }
  throw new Error('不明な操作です');
}
