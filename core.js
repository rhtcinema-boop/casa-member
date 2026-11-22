// 会員証の計算ルール。
// ブラウザの試し用（demo）と Apps Script（本番）で、このファイルをそのまま両方に入れて使う。

var CASA_RULES = {
  goal: 10, // スタンプ何個で1枚たまるか
  // 何個目で特典が出るか（名前は店で決めて書き換える）
  milestones: [
    { at: 5, title: '特典A（仮）' },
    { at: 10, title: '特典B（仮）' }
  ]
};

// req: {op, ...} / db: {load(), save(data), log(entry), history(no, n)} / ctx: {now, today, userId, name, isStaff}
function casaHandle(req, db, ctx) {
  var d = db.load(); // {members: [], rewards: []}

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
    return {
      no: Number(m.no), name: m.name, chips: Number(m.chips) || 0,
      stamps: Number(m.stamps) || 0, visits: Number(m.visits) || 0,
      stampedToday: String(m.lastStamp) === ctx.today,
      goal: CASA_RULES.goal, milestones: CASA_RULES.milestones, rewards: open
    };
  }
  function staffView(m) { var o = view(m); o.phone = String(m.phone || ''); o.history = db.history(m.no, 30); return o; }
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
        m = { userId: ctx.userId, no: max + 1, name: ctx.name || '', chips: 0, stamps: 0, visits: 0, lastStamp: '', createdAt: ctx.now, phone: phone };
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
  }
  throw new Error('不明な操作です');
}
