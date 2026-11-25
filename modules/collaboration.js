/* ================================================================
   Hub.OS — Collab Hub v3 · "Streak rooms"
   Mỗi người một cam kết riêng · mỗi ngày một lần check-in (chỉ ghi giờ + ngày)
   Lỡ một ngày = mất 1 tim · hết tim = mất streak (tim hồi đầy) · liên tục N ngày = +1 tim

   Public contract: { id, name, icon, render(container), destroy() }
   Registered through app.register(collaborationModule).

   v4 — ảnh đáng tin hơn:
     1) Duyệt chéo   thành viên khác bấm "Hợp lệ" / "Nghi ngờ" trên ảnh (trong 72 giờ). Quá nửa người KHÁC nghi ngờ
                     → check-in bị hủy, tính như lỡ ngày. Phòng 2 người: người còn lại quyết.
     2) Mã thử thách khi chụp, màn hình hiện một số ngẫu nhiên (viết lên giấy / giơ đúng số ngón tay) và được đóng
                     dấu vào ảnh. Chủ phòng bật / tắt.
     3) Ảnh trùng    mỗi ảnh có dấu vân tay hình ảnh (dHash 256 bit, cả bản lật ngang); hai ngày gần như cùng một
                     ảnh → cảnh báo hiện cho cả phòng (không tự phạt, chỉ báo).
   Quyết định "bị hủy" cũng được TÍNH LẠI từ danh sách phiếu duyệt (không lưu cờ), nên ai cũng thấy cùng một kết quả.

   Bản LIVE: chỉ còn một kho dữ liệu —
     CloudStore — Firebase Auth + Firestore (phòng thật, cập nhật trực tiếp). Phải đăng nhập Google mới dùng được.
   Streak / tim KHÔNG được lưu: luôn tính lại từ danh sách check-in (replay),
   nên không ai sửa tay con số được.

   Quản lý phòng (chủ phòng): mã mời có hạn dùng · đổi mã · khoá/mở phòng · giới hạn số người ·
   đổi tên · mời thành viên ra · chuyển chủ phòng · xoá phòng. Thành viên: xem mã + danh sách, tự rời.
   ================================================================ */
const collaborationModule = (function () {
  'use strict';

  var LEGACY_DEMO_KEY = 'hub_collab_demo_v1';   // dữ liệu demo cũ trong localStorage: xoá một lần khi mở module
  var FORM_KEY = 'hub_collab_form';
  var WRECAP_KEY = 'hub_collab_wrecap_v1';
  var UNDO_MS = 5 * 60 * 1000;                    // hoàn tác check-in trong 5 phút
  var DEFAULT_CFG = { maxHearts: 5, regenDays: 7, cutoff: 4, challenge: true };   // cutoff = giờ chốt ngày (04:00 sáng)
  var HEART_CHOICES = [3, 5, 7, 10];
  var REGEN_CHOICES = [3, 5, 7, 14];
  var FREQ = { daily: 'Mỗi ngày', weekdays: 'Thứ 2 – Thứ 6' };
  var DOW = ['Chủ nhật', 'Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7'];
  var DOW_SHORT = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
  var DEFAULT_MAX_MEMBERS = 10, LEGACY_MAX_MEMBERS = 20;       // phòng mới tối đa 10 người; phòng cũ (chưa có trường này) giữ mức 20
  var MAX_CHOICES = [2, 3, 4, 5, 6, 8, 10, 15, 20];
  var EXPIRY = [['1d', '1 ngày', 1], ['7d', '7 ngày', 7], ['30d', '30 ngày', 30], ['never', 'Không hết hạn', 0]];
  var DEFAULT_EXPIRY = '7d';
  var REVIEW_MS = 72 * 3600 * 1000;               // cả phòng được duyệt ảnh trong 72 giờ sau check-in; hết hạn thì chốt, không đổi được nữa
  var DUP_MAX = 40;                                // ≤ 40/256 bit khác nhau = "gần như cùng một ảnh"
  var CHAL_MS = 120 * 1000;                        // mỗi mã thử thách có hiệu lực 2 phút trước khi tự xoay mã mới
  var VOTE_TEXT = { ok: 'Hợp lệ', sus: 'Nghi ngờ' };

  /* ───────────── ngày giờ ───────────── */
  function pad(n) { return n < 10 ? '0' + n : '' + n; }
  function ymd(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function parseYmd(s) { var p = String(s).split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); }
  function addDays(s, n) { var d = parseYmd(s); d.setDate(d.getDate() + n); return ymd(d); }
  function mondayOf(s) { var w = parseYmd(s).getDay(); return addDays(s, -((w + 6) % 7)); }
  function lastWeekStart(today) { return addDays(mondayOf(today), -7); }
  function isMonday(s) { return parseYmd(s).getDay() === 1; }
  function dayKey(ms, cutoff) { return ymd(new Date(ms - cutoff * 3600000)); }      // "ngày" bắt đầu lúc cutoff, không phải 00:00
  function fmtTime(ms) { var d = new Date(ms); return pad(d.getHours()) + ':' + pad(d.getMinutes()); }
  function fmtDay(s) { var d = parseYmd(s); return pad(d.getDate()) + '/' + pad(d.getMonth() + 1); }
  function dayName(s) { return DOW[parseYmd(s).getDay()]; }
  function dayNum(s) { return parseInt(String(s).replace(/-/g, ''), 10); }
  function dayEndMs(today, cutoff) { return parseYmd(addDays(today, 1)).getTime() + cutoff * 3600000; }
  function targetMs(today, target, cutoff) {       // giờ mục tiêu trước giờ chốt ngày thì thuộc sáng hôm sau
    if (!/^\d\d:\d\d$/.test(target || '')) return 0;
    var h = +target.slice(0, 2), m = +target.slice(3), base = parseYmd(today);
    if (h < cutoff) base.setDate(base.getDate() + 1);
    base.setHours(h, m, 0, 0);
    return base.getTime();
  }
  function lateBucketLabel(mins, tier) {
    if (tier === 'ok') return '';
    if (mins <= 0) return 'muộn';
    if (mins <= 30) return 'muộn <30p';
    if (mins <= 60) return 'muộn <1H';
    var h = Math.floor(mins / 60);
    return 'muộn >' + (h < 1 ? 1 : h) + 'H';
  }
  function lateInfo(ci, commit, date, cutoff) {
    if (!ci) return null;
    var tm = commit && commit.target ? targetMs(date, commit.target, cutoff) : 0;
    if (tm && ci.at > tm) {
      var diff = ci.at - tm;
      var mins = Math.max(1, Math.ceil(diff / 60000));
      var tier = diff > 3600000 ? 'vlate' : 'late';
      return { tier: tier, mins: mins, label: lateBucketLabel(mins, tier), target: commit.target };
    }
    if (!tm && ci.late) return { tier: 'late', mins: 0, label: 'muộn', target: '' };
    return { tier: 'ok', mins: 0, label: '', target: (commit && commit.target) || '' };
  }
  function lateCls(info) { return !info || info.tier === 'ok' ? 'is-done' : info.tier === 'vlate' ? 'is-vlate' : 'is-late'; }
  function lateIcon(info) { return !info || info.tier === 'ok' ? '✓' : info.tier === 'vlate' ? '‼' : '▲'; }
  function monthKey(s) { return String(s || '').slice(0, 7); }
  function shiftMonthKey(ym, delta) {
    var d = new Date(+ym.slice(0, 4), +ym.slice(5) - 1 + delta, 1);
    return d.getFullYear() + '-' + pad(d.getMonth() + 1);
  }
  function daysInMonth(ym) {
    var y = +ym.slice(0, 4), m = +ym.slice(5), n = new Date(y, m, 0).getDate(), out = [];
    for (var i = 1; i <= n; i++) out.push(ym + '-' + pad(i));
    return out;
  }
  function fmtMonthLabel(ym) { return 'Tháng ' + (+ym.slice(5)) + ' / ' + ym.slice(0, 4); }
  function leftText(ms) {
    var m = Math.max(0, Math.floor(ms / 60000));
    return Math.floor(m / 60) + 'g ' + pad(m % 60) + 'p';
  }
  function fmtClockSec(ms) {
    var s = Math.max(0, Math.ceil(ms / 1000));
    return pad(Math.floor(s / 60)) + ':' + pad(s % 60);
  }
  function fmtStamp(ms) { return fmtTime(ms) + ' · ' + fmtDay(ymd(new Date(ms))); }
  /** Khoá hạn → mốc thời gian (ms) hoặc null = không hết hạn. */
  function expiryMs(key) {
    var e = EXPIRY.filter(function (x) { return x[0] === key; })[0];
    return !e || !e[2] ? null : Date.now() + e[2] * 86400000;
  }
  function spanText(ms) {
    var m = Math.floor(ms / 60000);
    if (m >= 1440) return Math.floor(m / 1440) + ' ngày';
    if (m >= 60) return Math.floor(m / 60) + ' giờ';
    return Math.max(1, m) + ' phút';
  }
  /** Tình trạng mã mời của phòng: { kind: ok | locked | expired | gone | unknown, icon, text } */
  function inviteState(room, now) {
    var iv = room.invite;
    if (!iv) return { kind: 'unknown', icon: '…', text: 'Đang tải hiệu lực của mã…' };
    if (iv.exists === false) return { kind: 'gone', icon: '!', text: 'Mã này không còn trong hệ thống — hãy đổi mã mới.' };
    if (iv.expiresAt != null && iv.expiresAt <= now) return { kind: 'expired', icon: '!', text: 'Đã hết hạn lúc ' + fmtStamp(iv.expiresAt) + ' — hãy đổi mã mới.' };
    var base = iv.expiresAt == null ? 'Không hết hạn' : 'Còn hiệu lực đến ' + fmtStamp(iv.expiresAt) + ' (còn ' + spanText(iv.expiresAt - now) + ')';
    if (room.joinOpen === false) return { kind: 'locked', icon: 'II', text: 'Đang khoá: chưa ai vào được. ' + base + '.' };
    return { kind: 'ok', icon: '✓', text: base + '.' };
  }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function hash(str) { var h = 5381; for (var i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0; return Math.abs(h); }
  function genCode() {
    var chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789', out = '', buf = new Uint32Array(8);
    (window.crypto || window.msCrypto).getRandomValues(buf);
    for (var i = 0; i < 8; i++) out += chars.charAt(buf[i] % chars.length);
    return 'HUB-' + out.slice(0, 4) + '-' + out.slice(4);
  }

  /* ───────────── luật chơi (hàm thuần, kiểm thử được) ───────────── */
  // member.commits = [{ from:'YYYY-MM-DD', title, freq, target }] — cam kết có hiệu lực từ ngày `from`, lịch sử được giữ lại
  function commitAt(member, day) {
    var c = null, list = member.commits || [];
    for (var i = 0; i < list.length; i++) if (list[i].from <= day && (!c || list[i].from >= c.from)) c = list[i];
    return c;
  }
  function scheduled(member, day) {
    var c = commitAt(member, day);
    if (!c) return false;
    if (c.freq === 'weekdays') { var w = parseYmd(day).getDay(); return w >= 1 && w <= 5; }
    return true;
  }
  function startOf(member) {
    var s = '';
    (member.commits || []).forEach(function (c) { if (!s || c.from < s) s = c.from; });
    return s;
  }
  /** Phát lại toàn bộ lịch sử → tim, streak, kỷ lục, số lần KO, và dải ngày (ok / late / vlate / miss / ko / rest / today). */
  function replay(member, done, today, cfg) {
    var max = cfg.maxHearts, hearts = max, streak = 0, best = 0, run = 0, kos = 0, log = [], d = startOf(member);
    function hit() { streak++; if (streak > best) best = streak; run++; if (run % cfg.regenDays === 0 && hearts < max) hearts++; }
    function doneCode(day) {
      var ci = done[day] && typeof done[day] === 'object' ? done[day] : null;
      var li = ci ? lateInfo(ci, commitAt(member, day), day, cfg.cutoff) : null;
      return [day, li ? li.tier : 'ok', ci];
    }
    while (d && d < today) {
      if (!scheduled(member, d)) log.push([d, 'rest']);
      else if (done[d]) { hit(); log.push(doneCode(d)); }
      else {
        hearts--; run = 0;
        if (hearts <= 0) { streak = 0; hearts = max; kos++; log.push([d, 'ko']); } else log.push([d, 'miss']);
      }
      d = addDays(d, 1);
    }
    var on = !!d && scheduled(member, today), doneToday = !!done[today];
    if (on && doneToday) hit();
    log.push(!on ? [today, 'rest'] : doneToday ? doneCode(today) : [today, 'today']);
    return { hearts: hearts, max: max, streak: streak, best: best, kos: kos, log: log, todayOn: on, todayDone: doneToday, run: run };
  }
  /** Chuỗi chung: một ngày "đạt" khi MỌI người có lịch hôm đó đều check-in; ngày không ai có lịch thì bỏ qua. */
  function groupStreak(members, doneBy, today) {
    var cur = 0, best = 0, start = '';
    members.forEach(function (m) { var s = startOf(m); if (s && (!start || s < start)) start = s; });
    var d = start;
    while (d && d < today) {
      var due = members.filter(function (m) { return scheduled(m, d); });
      if (due.length) {
        if (due.every(function (m) { return doneBy[m.uid] && doneBy[m.uid][d]; })) { cur++; if (cur > best) best = cur; } else cur = 0;
      }
      d = addDays(d, 1);
    }
    var dueT = members.filter(function (m) { return scheduled(m, today); });
    var n = dueT.filter(function (m) { return doneBy[m.uid] && doneBy[m.uid][today]; }).length;
    var all = dueT.length > 0 && n === dueT.length;
    if (all) { cur++; if (cur > best) best = cur; }
    return { cur: cur, best: best, n: n, total: dueT.length, all: all };
  }
  /* ───────────── duyệt chéo · ảnh trùng · mã thử thách (hàm thuần, kiểm thử được) ───────────── */
  function popcount(x) { x = x - ((x >>> 1) & 0x55555555); x = (x & 0x33333333) + ((x >>> 2) & 0x33333333); return Math.imul((x + (x >>> 4)) & 0x0F0F0F0F, 0x01010101) >>> 24; }
  function hexWords(h) {                                           // 64 ký tự hex (256 bit) → 8 từ 32 bit; sai định dạng → null
    h = String(h || ''); if (!/^[0-9a-f]{64}$/.test(h)) return null;
    var w = []; for (var i = 0; i < 64; i += 8) w.push(parseInt(h.substr(i, 8), 16)); return w;
  }
  function hamming(a, b) { var d = 0; for (var i = 0; i < 8; i++) d += popcount((a[i] ^ b[i]) >>> 0); return d; }
  /** Ảnh gần như trơn (tường trắng, màn hình tối) cho dấu vân tay gần như toàn 0 hoặc toàn 1 → hai ảnh khác hẳn nhau vẫn "giống": bỏ qua, không so. */
  function informative(w) { var n = 0; for (var i = 0; i < 8; i++) n += popcount(w[i] >>> 0); return n >= 40 && n <= 216; }
  /** Mỗi ảnh → ảnh CŨ hơn giống nó nhất (nếu có): { 'uid|date': { uid, date, d } }. So cả bản lật ngang (pm) để không lách được bằng cách lật ảnh. */
  function findDups(list) {
    var arr = list.map(function (x) { var a = hexWords(x.ph); return a && informative(a) ? { x: x, a: a, b: hexWords(x.pm) || a } : null; }).filter(Boolean)
      .sort(function (p, q) { return p.x.at - q.x.at; }), out = {};
    for (var i = 1; i < arr.length; i++) {
      var best = null;
      for (var j = 0; j < i; j++) {
        if (arr[j].x.uid === arr[i].x.uid && arr[j].x.date === arr[i].x.date) continue;
        var d = Math.min(hamming(arr[i].a, arr[j].a), hamming(arr[i].b, arr[j].a));
        if (d <= DUP_MAX && (!best || d < best.d)) best = { uid: arr[j].x.uid, date: arr[j].x.date, d: d };
      }
      if (best) out[arr[i].x.uid + '|' + arr[i].x.date] = best;
    }
    return out;
  }
  /** Ảnh vừa chụp (chưa gửi) có trùng ảnh nào đã có trong phòng không? */
  function dupAgainst(room, ph, pm) {
    var a = hexWords(ph), b = hexWords(pm) || a, best = null;
    if (!a || !informative(a)) return null;
    Object.keys(room.checkins).forEach(function (uid) {
      Object.keys(room.checkins[uid]).forEach(function (date) {
        var w = hexWords(room.checkins[uid][date].ph); if (!w || !informative(w)) return;
        var d = Math.min(hamming(a, w), hamming(b, w));
        if (d <= DUP_MAX && (!best || d < best.d)) best = { uid: uid, date: date, d: d };
      });
    });
    return best;
  }
  /** Phán quyết cho một check-in. Chỉ tính phiếu của người KHÁC còn trong phòng, và phiếu phải khớp đúng lần check-in này (ref = giây của `at`).
      voided = quá nửa người khác nghi ngờ (phòng 2 người: người còn lại quyết; ở một mình thì không ai duyệt → không bao giờ bị hủy). */
  function judge(ck, members, reviews, now) {
    var others = members.filter(function (m) { return m.uid !== ck.uid; }), ids = {}, votes = {}, ok = 0, sus = 0, target = ck.uid + '_' + ck.date;
    others.forEach(function (m) { ids[m.uid] = true; });
    (reviews || []).forEach(function (r) { if (r.target === target && r.ref === ck.sec && ids[r.by] && (r.v === 'ok' || r.v === 'sus')) votes[r.by] = r.v; });
    Object.keys(votes).forEach(function (u) { if (votes[u] === 'ok') ok++; else sus++; });
    return { n: others.length, ok: ok, sus: sus, wait: others.length - ok - sus, votes: votes, voided: others.length > 0 && sus * 2 > others.length, need: Math.floor(others.length / 2) + 1, open: now < ck.at + REVIEW_MS };
  }
  /** Mã thử thách: 'P482' = viết số 482 lên giấy; 'F7' = giơ đúng 7 ngón tay. */
  function chInfo(id) {
    var m = /^([PF])(\d{1,3})$/.exec(id || ''); if (!m) return null;
    return m[1] === 'P'
      ? { kind: 'paper', num: m[2], stamp: 'MÃ ' + m[2], badge: m[2], icon: '✍', short: 'Viết lên giấy', hud: 'Viết số ' + m[2], how: 'Viết số ' + m[2] + ' lên giấy rồi cầm vào khung hình.', check: 'phải thấy số này viết trên giấy trong ảnh' }
      : { kind: 'fingers', num: m[2], stamp: 'MÃ ' + m[2] + ' NGÓN', badge: m[2] + ' NGÓN', icon: '✋', short: 'Giơ ngón tay', hud: 'Giơ ' + m[2] + ' ngón', how: 'Giơ đúng ' + m[2] + ' ngón tay trước ống kính (dùng cả hai tay cũng được).', check: 'phải thấy đúng ' + m[2] + ' ngón tay trong ảnh' };
  }
  function rand(n) { var b = new Uint32Array(1); (window.crypto || window.msCrypto).getRandomValues(b); return b[0] % n; }
  function newChallenge(kind) {
    var k = kind === 'paper' ? 1 : kind === 'fingers' ? 0 : rand(2);
    return k ? 'P' + (100 + rand(900)) : 'F' + (1 + rand(10));
  }

  /** Tổng kết 1 tuần (Thứ 2 → Chủ nhật): đúng giờ nhất, người kéo streak, ngày hay lỡ nhất, tỉ lệ hoàn thành và 7 ô ngày. */
  function weeklySummary(room, c, weekStart, skipPrev) {
    var members = room.members || [], checkins = room.checkins || {}, today = c.today;
    var latest = lastWeekStart(today), ws = mondayOf(weekStart || latest), we = addDays(ws, 6);
    var minStart = '';
    members.forEach(function (m) { var s = startOf(m); if (s && (!minStart || s < minStart)) minStart = s; });
    var minWeekStart = minStart ? mondayOf(minStart) : ws;
    var days = [];
    for (var i = 0; i < 7; i++) days.push(addDays(ws, i));

    var totDue = 0, totDone = 0, okN = 0, lateN = 0, vlateN = 0, missN = 0, syncDays = 0, schedDays = 0;
    var perM = {}, dayStats = [];
    members.forEach(function (m) {
      perM[m.uid] = { m: m, due: 0, done: 0, ok: 0, late: 0, vlate: 0, miss: 0, voided: 0, deltaSum: 0, deltaCnt: 0, streakEnd: 0, bestBefore: 0, bestInWeek: 0, newBest: false, log: [] };
    });

    days.forEach(function (d) {
      var dDue = 0, dDone = 0, dOk = 0, dLate = 0, dVlate = 0, dMiss = 0, dVoid = 0;
      members.forEach(function (m) {
        var pm = perM[m.uid], cm = commitAt(m, d), due = !!cm && scheduled(m, d);
        var ci = (checkins[m.uid] || {})[d], it = c.by && c.by[m.uid + '|' + d], voided = !!(it && it.j && it.j.voided);
        var valid = !!ci && !voided;
        if (!due) {
          pm.log.push([d, valid ? 'ok' : (d > today ? 'none' : 'rest'), valid ? ci : null]);
          return;
        }
        dDue++; totDue++; pm.due++;
        if (valid) {
          dDone++; totDone++; pm.done++;
          var li = lateInfo(ci, cm, d, room.cfg.cutoff);
          if (li.tier === 'vlate') { dVlate++; vlateN++; pm.vlate++; pm.log.push([d, 'vlate', ci]); }
          else if (li.tier === 'late') { dLate++; lateN++; pm.late++; pm.log.push([d, 'late', ci]); }
          else { dOk++; okN++; pm.ok++; pm.log.push([d, 'ok', ci]); }
          if (cm && cm.target) {
            var tm = targetMs(d, cm.target, room.cfg.cutoff);
            if (tm) { pm.deltaSum += (ci.at - tm) / 60000; pm.deltaCnt++; }
          }
        } else {
          if (voided) { dVoid++; pm.voided++; }
          if (d < today) { dMiss++; missN++; pm.miss++; }
          var stLog = c.states && c.states[m.uid] && c.states[m.uid].log || [];
          var lc = d === today ? 'today' : d > today ? 'none' : 'miss';
          for (var li2 = 0; li2 < stLog.length; li2++) if (stLog[li2][0] === d) { lc = stLog[li2][1]; break; }
          pm.log.push([d, lc, null]);
        }
      });
      if (dDue > 0 && d < today) { schedDays++; if (dDone === dDue) syncDays++; }
      var w = parseYmd(d).getDay();
      var st = !dDue ? 'rest' : (d > today ? 'future' : (dMiss > 0 || dVlate > 0) ? 'bad' : dLate > 0 ? 'warn' : 'perfect');
      dayStats.push({ date: d, dow: DOW_SHORT[w], dayName: DOW[w], due: dDue, done: dDone, ok: dOk, late: dLate, vlate: dVlate, miss: dMiss, voided: dVoid, status: st });
    });

    var rows = members.map(function (m) {
      var pm = perM[m.uid], runS = 0, bBefore = 0, bWeek = 0, sEnd = 0;
      var log = (c.states && c.states[m.uid] && c.states[m.uid].log) || [];
      for (var j = 0; j < log.length; j++) {
        var ed = log[j][0], ek = log[j][1];
        if (ed > we) break;
        if (ek === 'ok' || ek === 'late' || ek === 'vlate') {
          runS++;
          if (ed < ws) { if (runS > bBefore) bBefore = runS; }
          else { if (runS > bWeek) bWeek = runS; }
        } else if (ek === 'ko') {
          runS = 0;
        }
        sEnd = runS;
      }
      pm.streakEnd = sEnd; pm.bestBefore = bBefore; pm.bestInWeek = bWeek;
      pm.newBest = bBefore > 0 && bWeek > bBefore;
      return pm;
    });

    function cmpPunctual(a, b) {
      var ra = a.ok / a.due, rb = b.ok / b.due;
      if (Math.abs(rb - ra) > 1e-9) return rb - ra;
      if (b.ok !== a.ok) return b.ok - a.ok;
      var ha = a.deltaCnt > 0 ? 1 : 0, hb = b.deltaCnt > 0 ? 1 : 0;
      if (hb !== ha) return hb - ha;
      if (ha && hb) {
        var da = Math.round(a.deltaSum / a.deltaCnt), db = Math.round(b.deltaSum / b.deltaCnt);
        if (da !== db) return da - db;
      }
      return 0;
    }
    var pCands = rows.filter(function (pm) { return pm.due > 0 && pm.ok > 0; }).sort(cmpPunctual);
    var mostPunctual = null;
    if (pCands.length) {
      var pTop = pCands[0], pWin = pCands.filter(function (pm) { return cmpPunctual(pm, pTop) === 0; });
      var earlyMins = pTop.deltaCnt > 0 ? Math.max(0, Math.round(-pTop.deltaSum / pTop.deltaCnt)) : 0;
      mostPunctual = {
        winners: pWin.map(function (pm) { return { uid: pm.m.uid, name: pm.m.name }; }),
        names: pWin.map(function (pm) { return pm.m.name; }).join(' & '),
        ratePct: Math.round(pTop.ok / pTop.due * 100),
        ok: pTop.ok, due: pTop.due, earlyMins: earlyMins
      };
    }

    function cmpStreakHero(a, b) {
      var pa = (a.miss === 0 && a.due > 0) ? 1 : 0, pb = (b.miss === 0 && b.due > 0) ? 1 : 0;
      if (pb !== pa) return pb - pa;
      if (b.done !== a.done) return b.done - a.done;
      if (b.streakEnd !== a.streakEnd) return b.streakEnd - a.streakEnd;
      return 0;
    }
    var sCands = rows.filter(function (pm) { return pm.done > 0; }).sort(cmpStreakHero);
    var streakHero = null;
    if (sCands.length) {
      var sTop = sCands[0], sWin = sCands.filter(function (pm) { return cmpStreakHero(pm, sTop) === 0; });
      streakHero = {
        winners: sWin.map(function (pm) { return { uid: pm.m.uid, name: pm.m.name }; }),
        names: sWin.map(function (pm) { return pm.m.name; }).join(' & '),
        gain: sTop.done, due: sTop.due, streak: sTop.streakEnd,
        perfect: sTop.miss === 0 && sTop.due > 0,
        newBest: sWin.some(function (pm) { return pm.newBest; })
      };
    }

    var weakestDay = null;
    if (totDue > 0) {
      var mDays = dayStats.filter(function (ds) { return ds.due > 0 && ds.miss > 0; }).sort(function (a, b) {
        if (b.miss !== a.miss) return b.miss - a.miss;
        var ra = a.miss / a.due, rb = b.miss / b.due;
        if (Math.abs(rb - ra) > 1e-9) return rb - ra;
        return (b.vlate * 2 + b.late) - (a.vlate * 2 + a.late);
      });
      if (mDays.length) {
        var wTop = mDays[0];
        weakestDay = {
          perfect: false, date: wTop.date, dow: wTop.dow, dayName: wTop.dayName,
          miss: wTop.miss, due: wTop.due, done: wTop.done, missPct: Math.round(wTop.miss / wTop.due * 100)
        };
      } else {
        var lDays = dayStats.filter(function (ds) { return ds.due > 0 && (ds.late + ds.vlate) > 0; }).sort(function (a, b) {
          return (b.vlate * 2 + b.late) - (a.vlate * 2 + a.late);
        });
        weakestDay = {
          perfect: true,
          lateDay: lDays.length ? { date: lDays[0].date, dow: lDays[0].dow, dayName: lDays[0].dayName, late: lDays[0].late + lDays[0].vlate } : null
        };
      }
    }

    var hasData = totDue > 0;
    var rate = hasData ? Math.round(totDone / totDue * 100) : 0;
    var prevRate = null, deltaPct = null;
    if (!skipPrev && hasData && ws > minWeekStart) {
      var prev = weeklySummary(room, c, addDays(ws, -7), true);
      if (prev.hasData) { prevRate = prev.rate; deltaPct = rate - prev.rate; }
    }
    return {
      weekStart: ws, weekEnd: we, hasData: hasData, canPrev: ws > minWeekStart, canNext: ws < latest,
      totDue: totDue, totDone: totDone, okN: okN, lateN: lateN, vlateN: vlateN, missN: missN,
      syncDays: syncDays, schedDays: schedDays, rate: rate, prevRate: prevRate, deltaPct: deltaPct,
      mostPunctual: mostPunctual, streakHero: streakHero, weakestDay: weakestDay, days: dayStats, rows: rows
    };
  }

  function computeRoom(room, nowMs) {
    var cfg = room.cfg, today = dayKey(nowMs, cfg.cutoff), doneBy = {}, states = {}, flat = [], byUid = {}, reviews = room.reviews || [];
    room.members.forEach(function (m) { doneBy[m.uid] = {}; byUid[m.uid] = m; });
    Object.keys(room.checkins).forEach(function (uid) {
      Object.keys(room.checkins[uid]).forEach(function (date) {
        var ci = room.checkins[uid][date];
        flat.push({ uid: uid, date: date, ci: ci, at: ci.at, sec: typeof ci.sec === 'number' && ci.sec > 0 ? ci.sec : Math.floor(ci.at / 1000), note: ci.note || '', photo: !!ci.hasPhoto, ch: ci.ch || '', ph: ci.ph || '', pm: ci.pm || '', mode: ci.mode || 'all' });
      });
    });
    var dups = findDups(flat), all = [], by = {};
    flat.forEach(function (x) {
      var m = byUid[x.uid]; if (!m) return;                                          // người đã rời phòng: không còn tính
      x.name = m.name;
      x.late = lateInfo(x.ci, commitAt(m, x.date), x.date, cfg.cutoff);
      x.j = judge(x, room.members, reviews, nowMs);
      x.dup = dups[x.uid + '|' + x.date] || null;
      if (!x.j.voided) doneBy[x.uid][x.date] = x.ci;                                 // giữ ci object để replay() tính đúng 3 mức muộn; bị hủy → coi như lỡ ngày
      all.push(x); by[x.uid + '|' + x.date] = x;
    });
    room.members.forEach(function (m) { states[m.uid] = replay(m, doneBy[m.uid], today, cfg); });
    all.sort(function (a, b) { return b.at - a.at; });
    var from = addDays(today, -7);
    var alerts = all.filter(function (x) { return x.date >= from && (x.j.voided || x.dup || (x.j.sus && x.j.open)); }).slice(0, 6);
    var res = { today: today, states: states, group: groupStreak(room.members, doneBy, today), feed: all.slice(0, 8), all: all, allFeed: all, by: by, alerts: alerts };
    res.weekly = weeklySummary(room, res, lastWeekStart(today));
    return res;
  }

  /* ───────────── CloudStore (Firebase Auth + Firestore) ─────────────
     rooms/{roomId}                       { name, code, ownerUid, maxHearts, regenDays, cutoff, challenge, createdAt,
                                            maxMembers, joinOpen, memberCount, deleting? }
     rooms/{roomId}/members/{uid}         { uid, name, commits[], joinedAt, code? }
     rooms/{roomId}/checkins/{uid_date}   { uid, date, day, at(serverTimestamp), note, late, hasPhoto, ch, ph, pm }
     rooms/{roomId}/reviews/{uid_date_voter} { target, by, v:'ok'|'sus', ref(giây của checkin.at), at }
     rooms/{roomId}/photos/{uid_date}     { uid, date, img(JPEG dataURL ≤ ~220KB), at }   ← tách riêng để tải lịch sử check-in vẫn nhẹ
     rooms/{roomId}/nudges/{from_to_date} { from, to, date, at }
     invites/{code}                       { roomId, createdBy, createdAt, expiresAt|null }   ← hạn dùng nằm ở đây, Rules kiểm tra khi vào phòng
     users/{uid}/collab/rooms             { ids: [roomId…] }
     Xoá phòng 2 bước: (1) rooms/{id}.deleting = true  (2) chủ phòng xoá dữ liệu con rồi xoá phòng — Rules chỉ cho xoá khi deleting = true. */
  function CloudStore() {
    var me = firebase.auth().currentUser, db = firebase.firestore(), FV = firebase.firestore.FieldValue, TS = firebase.firestore.Timestamp;
    function ms(ts) { return ts && ts.toMillis ? ts.toMillis() : Date.now(); }           // chờ serverTimestamp → dùng giờ máy tạm thời
    function msOrNull(ts) { return ts && ts.toMillis ? ts.toMillis() : null; }
    function tsOrNull(v) { return v == null ? null : TS.fromMillis(v); }
    function profRef() { return db.collection('users').doc(me.uid).collection('collab').doc('rooms'); }
    function rRef(id) { return db.collection('rooms').doc(id); }
    function iRef(code) { return db.collection('invites').doc(code); }
    function memberDoc(prof, today) { return { uid: me.uid, name: prof.name, commits: [{ from: today, title: prof.title, freq: prof.freq, target: prof.target || '' }], joinedAt: FV.serverTimestamp() }; }
    function isGone(e) { return !!e && (e.code === 'permission-denied' || e.code === 'not-found'); }
    return {
      mode: 'cloud', uid: me.uid, name: me.displayName || '',
      listRooms: async function () {
        var s = await profRef().get(), ids = (s.exists && s.data().ids) || [], res = [], stale = [];
        await Promise.all(ids.map(async function (id) {
          try {
            var r = await rRef(id).get(), d = r.exists ? r.data() : null;
            if (!d || (d.deleting && d.ownerUid !== me.uid)) { stale.push(id); return; }     // phòng đã xoá
            var m = await rRef(id).collection('members').get();
            res.push({ id: id, name: d.name, code: d.code, owner: d.ownerUid === me.uid, members: m.docs.map(function (x) { return x.data().name; }) });
          } catch (e) { if (isGone(e)) stale.push(id); }                                       // bị mời ra khỏi phòng → không đọc được nữa
        }));
        if (stale.length) { try { await profRef().set({ ids: FV.arrayRemove.apply(FV, stale) }, { merge: true }); } catch (e) {} }   // tự dọn danh sách phòng của mình
        return res;
      },
      createRoom: async function (name, prof, today) {
        var ref = db.collection('rooms').doc(), code = genCode(), b = db.batch();
        b.set(ref, { name: name, code: code, ownerUid: me.uid, maxHearts: DEFAULT_CFG.maxHearts, regenDays: DEFAULT_CFG.regenDays, cutoff: DEFAULT_CFG.cutoff, challenge: DEFAULT_CFG.challenge,
          maxMembers: DEFAULT_MAX_MEMBERS, joinOpen: true, memberCount: 1, createdAt: FV.serverTimestamp() });
        b.set(ref.collection('members').doc(me.uid), memberDoc(prof, today));
        b.set(iRef(code), { roomId: ref.id, createdBy: me.uid, createdAt: FV.serverTimestamp(), expiresAt: tsOrNull(Date.now() + 7 * 86400000) });
        b.set(profRef(), { ids: FV.arrayUnion(ref.id) }, { merge: true });
        await b.commit();
        return ref.id;
      },
      joinRoom: async function (code, prof, today) {
        var inv = await iRef(code).get();
        if (!inv.exists) throw new Error('Mã mời không đúng (hoặc chủ phòng đã đổi mã).');
        var iv = inv.data(), exp = msOrNull(iv.expiresAt);
        if (exp != null && exp <= Date.now()) throw new Error('Mã mời đã hết hạn — nhờ chủ phòng đổi mã mới.');
        var roomId = iv.roomId, mine = await profRef().get();
        if (mine.exists && (mine.data().ids || []).indexOf(roomId) > -1) return roomId;      // đã ở trong phòng → không ghi đè cam kết
        var b = db.batch(), md = memberDoc(prof, today); md.code = code;
        b.set(rRef(roomId).collection('members').doc(me.uid), md);
        b.update(rRef(roomId), { memberCount: FV.increment(1) });                            // Rules kiểm tra còn chỗ + phòng đang mở dựa trên con số này
        b.set(profRef(), { ids: FV.arrayUnion(roomId) }, { merge: true });
        try { await b.commit(); } catch (e) {
          if (e && e.code === 'permission-denied') throw new Error('Không vào được phòng: mã đã hết hạn, phòng đang khoá hoặc đã đủ người.');
          throw e;
        }
        return roomId;
      },
      watch: function (id, cb) {
        var st = { room: null, members: [], mLoaded: false, checkins: [], nudges: [], reviews: [], invite: null, invCode: '', offInv: null, healed: -1 }, offs = [], today = dayKey(Date.now(), DEFAULT_CFG.cutoff);
        function emit() {
          if (!st.room) return;
          var r = st.room, co = {};
          if (r.deleting && r.ownerUid !== me.uid) { cb(null, { code: 'deleting' }); return; }       // chủ phòng đã bấm xoá
          if (st.mLoaded && r.ownerUid === me.uid && !r.deleting && r.memberCount !== st.members.length && st.healed !== st.members.length) {
            st.healed = st.members.length;                                                         // phòng cũ / lệch số đếm → chủ phòng tự chỉnh lại
            rRef(id).update({ memberCount: st.members.length }).catch(function () {});
          }
          st.checkins.forEach(function (c) { (co[c.uid] = co[c.uid] || {})[c.date] = { at: ms(c.at), sec: c.at && typeof c.at.seconds === 'number' ? c.at.seconds : 0, note: c.note || '', late: !!c.late, hasPhoto: !!c.hasPhoto, ch: c.ch || '', ph: c.ph || '', pm: c.pm || '', mode: c.photoMode || 'all' }; });
          cb({ id: id, name: r.name, code: r.code, ownerUid: r.ownerUid, deleting: !!r.deleting,
            joinOpen: r.joinOpen !== false, maxMembers: r.maxMembers || LEGACY_MAX_MEMBERS, invite: st.invite,
            cfg: { maxHearts: r.maxHearts || DEFAULT_CFG.maxHearts, regenDays: r.regenDays || DEFAULT_CFG.regenDays, cutoff: r.cutoff == null ? DEFAULT_CFG.cutoff : r.cutoff, challenge: r.challenge === true },
            members: st.members, checkins: co, nudges: st.nudges, reviews: st.reviews });
        }
        function fail(e) { cb(null, e); }
        function syncInvite(code) {                                                                // theo dõi hạn dùng của mã hiện tại (đổi mã → theo mã mới)
          if (!code || code === st.invCode) return;
          st.invCode = code; st.invite = null;
          if (st.offInv) { try { st.offInv(); } catch (e) {} }
          st.offInv = iRef(code).onSnapshot(function (s) {
            st.invite = { exists: s.exists, expiresAt: s.exists ? msOrNull(s.data().expiresAt) : null }; emit();
          }, function () { st.invite = null; emit(); });
        }
        offs.push(rRef(id).onSnapshot(function (s) {
          st.room = s.exists ? s.data() : null;
          if (!s.exists) cb(null, { code: 'not-found' }); else { syncInvite(st.room.code); emit(); }
        }, fail));
        offs.push(rRef(id).collection('members').onSnapshot(function (s) {
          st.members = s.docs.map(function (d) { var x = d.data(); return { uid: x.uid || d.id, name: x.name || '?', commits: x.commits || [], joinedAt: x.joinedAt && x.joinedAt.toMillis ? x.joinedAt.toMillis() : 0 }; });
          st.mLoaded = true; emit();
        }, fail));
        offs.push(rRef(id).collection('checkins').onSnapshot(function (s) { st.checkins = s.docs.map(function (d) { return d.data(); }); emit(); }, fail));
        offs.push(rRef(id).collection('nudges').where('date', '>=', addDays(today, -1)).onSnapshot(function (s) { st.nudges = s.docs.map(function (d) { return d.data(); }); emit(); }, fail));
        offs.push(rRef(id).collection('reviews').onSnapshot(function (s) { st.reviews = s.docs.map(function (d) { var x = d.data(); return { target: x.target, by: x.by, v: x.v, ref: x.ref }; }); emit(); }, fail));   // phải tải HẾT phiếu: phán quyết cũ không được đổi khi phiếu rơi khỏi truy vấn
        return function () { offs.forEach(function (f) { try { f(); } catch (e) {} }); if (st.offInv) { try { st.offInv(); } catch (e) {} } };
      },
      checkIn: function (id, date, note, late, photo, extra) {          // ảnh + check-in ghi cùng một lúc (batch) — thiếu ảnh thì Rules từ chối
        extra = extra || {};
        if (!photo) return Promise.reject(new Error('Cần chụp ảnh để check-in.'));
        var key = me.uid + '_' + date, b = db.batch();
        b.set(rRef(id).collection('photos').doc(key), { uid: me.uid, date: date, img: photo, at: FV.serverTimestamp() });
        b.set(rRef(id).collection('checkins').doc(key), { uid: me.uid, date: date, day: dayNum(date), at: FV.serverTimestamp(), note: note || '', late: !!late, hasPhoto: true, ch: extra.ch || '', ph: extra.ph || '', pm: extra.pm || '' });
        return b.commit();
      },
      review: function (id, uid, date, v, ref) {                // một phiếu mỗi (ảnh, người duyệt); đổi ý = ghi đè (Rules chỉ cho đổi v / ref / at)
        var target = uid + '_' + date;
        return rRef(id).collection('reviews').doc(target + '_' + me.uid).set({ target: target, by: me.uid, v: v, ref: ref, at: FV.serverTimestamp() });
      },
      getPhoto: async function (id, uid, date) { var s = await rRef(id).collection('photos').doc(uid + '_' + date).get(); return s.exists ? (s.data().img || '') : ''; },
      undo: function (id, date) {
        var key = me.uid + '_' + date, b = db.batch();
        b.delete(rRef(id).collection('checkins').doc(key));
        b.delete(rRef(id).collection('photos').doc(key));
        return b.commit();
      },
      setCommits: function (id, commits) { return rRef(id).collection('members').doc(me.uid).update({ commits: commits }); },
      nudge: function (id, to, date) { return rRef(id).collection('nudges').doc(me.uid + '_' + to + '_' + date).set({ from: me.uid, to: to, date: date, at: FV.serverTimestamp() }); },
      setCfg: function (id, cfg) { return rRef(id).update({ maxHearts: cfg.maxHearts, regenDays: cfg.regenDays, challenge: !!cfg.challenge }); },

      /* ---- quản lý phòng (chỉ chủ phòng; Rules kiểm tra lại từng thao tác) ---- */
      setInfo: function (id, info) { return rRef(id).update({ name: info.name, maxMembers: info.maxMembers }); },
      setJoinOpen: function (id, open) { return rRef(id).update({ joinOpen: !!open }); },
      setInviteExpiry: function (id, code, expMs) { return iRef(code).update({ expiresAt: tsOrNull(expMs) }); },
      regenCode: async function (id, oldCode, expMs) {                // mã mới + thu hồi mã cũ, cùng một batch
        var code = genCode(), b = db.batch();
        b.set(iRef(code), { roomId: id, createdBy: me.uid, createdAt: FV.serverTimestamp(), expiresAt: tsOrNull(expMs) });
        b.update(rRef(id), { code: code });
        if (oldCode) b.delete(iRef(oldCode));
        await b.commit();
        return code;
      },
      kick: async function (id, uid, o) {                             // xoá hồ sơ thành viên (lịch sử check-in giữ lại nhưng không còn tính); tuỳ chọn đổi mã luôn
        var b = db.batch(), upd = { memberCount: FV.increment(-1) }, code = '';
        b.delete(rRef(id).collection('members').doc(uid));
        if (o && o.regen) {
          code = genCode();
          b.set(iRef(code), { roomId: id, createdBy: me.uid, createdAt: FV.serverTimestamp(), expiresAt: tsOrNull(o.expiryMs) });
          upd.code = code;
          if (o.oldCode) b.delete(iRef(o.oldCode));
        }
        b.update(rRef(id), upd);
        await b.commit();
        return code;
      },
      transferOwner: function (id, uid) { return rRef(id).update({ ownerUid: uid }); },
      deleteRoom: async function (id, onProgress) {
        var r = rRef(id), snap = await r.get(), code = snap.exists ? snap.data().code : '';
        await r.update({ deleting: true });                           // bước 1: các thành viên khác thấy "phòng đã bị xoá"
        var refs = [];
        (await r.collection('checkins').get()).docs.forEach(function (d) { refs.push(d.ref); refs.push(r.collection('photos').doc(d.id)); });   // ảnh cùng id với check-in → không cần tải ảnh về
        (await r.collection('reviews').get()).docs.forEach(function (d) { refs.push(d.ref); });
        (await r.collection('nudges').get()).docs.forEach(function (d) { refs.push(d.ref); });
        (await r.collection('members').get()).docs.forEach(function (d) { if (d.id !== me.uid) refs.push(d.ref); });
        for (var i = 0; i < refs.length; i += 200) {
          var b = db.batch(); refs.slice(i, i + 200).forEach(function (ref) { b.delete(ref); });
          await b.commit();
          if (onProgress) onProgress(Math.min(i + 200, refs.length), refs.length);
        }
        var f = db.batch();                                           // bước 2: mã mời, hồ sơ của chính mình, phòng, và phòng khỏi danh sách của mình
        if (code) f.delete(iRef(code));
        f.delete(r.collection('members').doc(me.uid));
        f.delete(r);
        f.set(profRef(), { ids: FV.arrayRemove(id) }, { merge: true });
        await f.commit();
      },
      forget: function (id) { return profRef().set({ ids: FV.arrayRemove(id) }, { merge: true }).catch(function () {}); },
      leave: async function (id) {
        var b = db.batch();
        b.delete(rRef(id).collection('members').doc(me.uid));
        b.update(rRef(id), { memberCount: FV.increment(-1) });
        b.set(profRef(), { ids: FV.arrayRemove(id) }, { merge: true });
        await b.commit();
      }
    };
  }

  /* ───────────── trạng thái giao diện ───────────── */
  var S = null;
  function freshState() {
    var f = {}; try { f = JSON.parse(localStorage.getItem(FORM_KEY)) || {}; } catch (e) {}
    return { root: null, store: null, view: 'lobby', roomId: '', rooms: null, room: null, calc: null, unwatch: null, timer: null, authUnsub: null, authReady: false,
      tab: 'create', roomTab: 'today', arc: null, busy: false, voting: false, dlg: '', toastT: null, lastDay: '', cam: null, photos: {}, photoView: null, photoList: null,
      form: { room: '', code: '', name: f.name || '', title: f.title || '', freq: f.freq || 'daily', target: f.target || '' },
      dlgForm: null, mg: null, confirm: null };
  }
  function arcState(today) {
    if (!S.arc) S.arc = { month: monthKey(today), day: today, week: lastWeekStart(today), mode: 'day', member: 'all', status: 'all', q: '' };
    return S.arc;
  }
  function wRecapMap() { try { return JSON.parse(localStorage.getItem(WRECAP_KEY)) || {}; } catch (e) { return {}; } }
  function setWRecapOpen(roomId, weekStart, open) {
    try {
      var m = wRecapMap();
      m[roomId] = { week: weekStart, open: !!open };
      localStorage.setItem(WRECAP_KEY, JSON.stringify(m));
    } catch (e) {}
  }
  function isWeeklyOpen(roomId, w, today) {
    if (!w || !w.hasData) return false;
    var rec = wRecapMap()[roomId];
    if (rec && rec.week === w.weekStart) return !!rec.open;
    return isMonday(today);
  }
  function heartsHtml(h, max) {
    var out = '<span class="hub-collab-hearts" role="img" aria-label="' + h + ' trên ' + max + ' tim">';
    for (var i = 0; i < max; i++) out += '<i class="hub-collab-heart ' + (i < h ? 'is-full' : 'is-empty') + '"></i>';
    return out + '</span>';
  }
  function curCommit(m, today) { return commitAt(m, today) || (m.commits || [])[0] || { title: '—', freq: 'daily', target: '' }; }
  function commitLine(c) { return esc(c.title) + ' · ' + FREQ[c.freq] + (c.target ? ' · trước ' + esc(c.target) : ''); }
  function toast(msg) {
    var t = S && S.root && S.root.querySelector('#hc-toast'); if (!t) return;
    t.textContent = msg; t.classList.add('is-on');
    clearTimeout(S.toastT); S.toastT = setTimeout(function () { t.classList.remove('is-on'); }, 3800);
  }
  function errMsg(e) {
    if (e && (e.code === 'permission-denied' || /permission/i.test(e.message || ''))) return 'Firestore Rules chưa cho phép thao tác này — hãy dán bản firestore.rules mới vào Firebase Console › Firestore › Rules rồi Publish.';
    return (e && e.message) || 'Có lỗi xảy ra, thử lại nhé.';
  }

  /* ───────────── cổng đăng nhập (bản Live: không còn chế độ demo) ───────────── */
  function hasFirebase() {
    try { return typeof firebase !== 'undefined' && !!firebase.apps && firebase.apps.length > 0; } catch (e) { return false; }
  }
  function viewGate() {
    var inner;
    if (!hasFirebase()) inner = '<p class="hub-collab-muted">Chưa kết nối được Firebase nên Collab Hub chưa dùng được. Hãy kiểm tra cấu hình Firebase của trang rồi tải lại.</p>';
    else if (!S.authReady) inner = '<p class="hub-collab-muted">Đang kiểm tra đăng nhập…</p>';
    else inner = '<h3 class="hub-collab-h3">Đăng nhập để bắt đầu</h3>' +
      '<p class="hub-collab-muted">Phòng giữ streak chạy trực tiếp trên cloud: bạn bè vào cùng phòng bằng mã mời, check-in và duyệt ảnh của nhau theo thời gian thực.</p>' +
      '<button type="button" class="hub-collab-btn is-primary" data-act="signin"' + (S.busy ? ' disabled' : '') + '>Đăng nhập bằng Google</button>';
    return '<header class="hub-collab-header"><div><h2 class="hub-collab-title">Collab Hub</h2>' +
        '<p class="hub-collab-subtitle">Giữ streak cùng nhau — mỗi người một cam kết, mỗi ngày một lần check-in.</p></div></header>' +
      '<div class="hub-collab-lobby"><section class="hub-collab-panel hub-collab-gate">' + inner + '</section></div>';
  }

  /* ───────────── sảnh: phòng của bạn + tạo / vào phòng ───────────── */
  function viewLobby() {
    if (!S.store) return viewGate();
    var st = S.store, f = S.form, rooms = S.rooms;
    var list = rooms === null ? '<p class="hub-collab-muted">Đang tải…</p>'
      : !rooms.length ? '<p class="hub-collab-muted hub-collab-empty">Chưa có phòng nào. Tạo một phòng hoặc nhập mã mời của bạn bè.</p>'
      : '<ul class="hub-collab-roomlist">' + rooms.map(function (r) {
          return '<li><button type="button" class="hub-collab-room" data-act="open" data-id="' + esc(r.id) + '"><span class="hub-collab-room-name">' + esc(r.name) + (r.owner ? '<span class="hub-collab-role is-owner">Chủ phòng</span>' : '') + '</span>' +
            '<span class="hub-collab-room-meta">' + esc(r.members.join(' · ')) + '</span></button></li>';
        }).join('') + '</ul>';
    var create = S.tab === 'create';
    return '<header class="hub-collab-header"><div><h2 class="hub-collab-title">Collab Hub</h2>' +
        '<p class="hub-collab-subtitle">Giữ streak cùng nhau — mỗi người một cam kết, mỗi ngày một lần check-in.</p></div>' +
        '<span class="hub-collab-mode is-cloud is-live">Live · ' + esc(st.name || 'đã đăng nhập') + '</span></header>' +
      '<div class="hub-collab-lobby">' +
        '<section class="hub-collab-panel"><h3 class="hub-collab-h3">Phòng của bạn</h3>' + list + '</section>' +
        '<section class="hub-collab-panel"><div class="hub-collab-tabs" role="tablist">' +
          '<button type="button" role="tab" aria-selected="' + create + '" data-act="tab" data-tab="create">Tạo phòng</button>' +
          '<button type="button" role="tab" aria-selected="' + !create + '" data-act="tab" data-tab="join">Vào bằng mã</button></div>' +
          '<div class="hub-collab-form">' +
            (create ? field('Tên phòng', '<input class="hub-collab-input" data-f="room" maxlength="40" placeholder="VD: Nhóm học khuya" value="' + esc(f.room) + '">')
                    : field('Mã mời', '<input class="hub-collab-input hub-collab-code" data-f="code" maxlength="13" placeholder="HUB-XXXX-XXXX" autocapitalize="characters" value="' + esc(f.code) + '">')) +
            field('Tên hiển thị', '<input class="hub-collab-input" data-f="name" maxlength="24" value="' + esc(f.name) + '">') +
            field('Cam kết của bạn', '<input class="hub-collab-input" data-f="title" maxlength="80" placeholder="VD: Học 2 giờ mỗi ngày" value="' + esc(f.title) + '">') +
            '<div class="hub-collab-row2">' +
              field('Tần suất', '<select class="hub-collab-input" data-f="freq">' + Object.keys(FREQ).map(function (k) { return '<option value="' + k + '"' + (f.freq === k ? ' selected' : '') + '>' + FREQ[k] + '</option>'; }).join('') + '</select>') +
              field('Trước giờ (tuỳ chọn)', '<input type="time" class="hub-collab-input" data-f="target" value="' + esc(f.target) + '">') + '</div>' +
            '<button type="button" class="hub-collab-btn is-primary" data-act="' + (create ? 'create' : 'join') + '"' + (S.busy ? ' disabled' : '') + '>' + (create ? 'Tạo phòng' : 'Vào phòng') + '</button>' +
          '</div></section>' +
      '</div>';
  }
  function field(label, control) { return '<label class="hub-collab-field"><span>' + label + '</span>' + control + '</label>'; }

  /* ───────────── duyệt chéo: chip trạng thái, banner chờ duyệt, bảng cảnh báo ───────────── */
  function badgeOf(it) {                                                   // dấu nhỏ ở góc ảnh (luôn có ký hiệu, không chỉ màu)
    if (!it || !it.photo) return null;
    if (it.j.voided) return { k: 'void', g: '✕', t: 'đã bị hủy' };
    if (it.dup) return { k: 'dup', g: '≈', t: 'giống ảnh cũ' };
    if (it.j.sus) return { k: 'sus', g: '!', t: it.j.sus + ' người nghi ngờ' };
    if (it.j.ok) return { k: 'ok', g: '✓', t: it.j.ok + ' người xác nhận hợp lệ' };
    return null;
  }
  function reviewChips(it) {
    if (!it || (!it.photo && !it.j.voided)) return '';                      // ảnh đã gỡ / hết hạn: chỉ còn hiện nếu check-in đã bị hủy
    var j = it.j, h = '';
    if (j.voided) h += '<span class="hub-collab-rv is-void">✕ Đã bị hủy — tính như lỡ ngày</span>';
    else {
      if (j.ok) h += '<span class="hub-collab-rv is-ok">✓ ' + j.ok + ' hợp lệ</span>';
      if (j.sus) h += '<span class="hub-collab-rv is-sus">! ' + j.sus + ' nghi ngờ</span>';
      if (!j.ok && !j.sus && j.n) h += '<span class="hub-collab-rv is-wait">' + (j.open ? '… Chờ duyệt' : 'Không ai duyệt') + '</span>';
      if (!j.open && j.n && (j.ok || j.sus)) h += '<span class="hub-collab-rv is-final">Đã chốt</span>';
    }
    if (it.dup) h += '<span class="hub-collab-rv is-dup">≈ giống ảnh ngày ' + fmtDay(it.dup.date) + '</span>';
    if (it.mode && it.mode !== 'all' && it.photo) h += '<span class="hub-collab-rv is-private" title="Chủ ảnh chỉ cho một số người xem nên không phải ai cũng duyệt được">◐ Ảnh riêng tư</span>';
    return h ? '<span class="hub-collab-rvs">' + h + '</span>' : '';
  }
  function pendingReviews(c, me) {                                         // ảnh của người khác còn hạn duyệt mà tôi chưa bấm; cái sắp hết hạn nhất lên đầu
    return c.all.filter(function (x) {
      if (x.uid === me || !x.photo || !x.j.open || x.j.voided || x.j.votes[me] || x.mode === 'me') return false;
      return x.mode !== 'some' || !!S.photos[x.uid + '|' + x.date];          // chế độ "một số người": chỉ mời duyệt khi ảnh đã mở được với tôi
    }).reverse();
  }
  function photoBtnAttrs(x) { return ' data-act="photo" data-uid="' + esc(x.uid) + '" data-date="' + esc(x.date) + '" data-name="' + esc(x.name) + '"'; }
  function reviewBanner(pend) {
    return '<div class="hub-collab-banner is-review" role="status"><span>Có <b>' + pend.length + '</b> ảnh đang chờ bạn duyệt — bấm “Hợp lệ” hoặc “Nghi ngờ”.</span>' +
      '<button type="button" class="hub-collab-btn"' + photoBtnAttrs(pend[0]) + '>Duyệt ngay</button></div>';
  }
  function alertsHtml(c, me) {
    if (!c.alerts.length) return '';
    return '<h3 class="hub-collab-h3 hub-collab-h3--gap">Cần chú ý</h3><ul class="hub-collab-alerts">' + c.alerts.map(function (x) {
      var k = x.j.voided ? 'void' : x.dup ? 'dup' : 'sus', g = { void: '✕', dup: '≈', sus: '!' }[k];
      var t = k === 'void' ? 'check-in ngày ' + fmtDay(x.date) + ' bị hủy — tính như lỡ ngày'
        : k === 'dup' ? 'ảnh ngày ' + fmtDay(x.date) + ' gần như trùng ảnh ngày ' + fmtDay(x.dup.date)
        : 'ảnh ngày ' + fmtDay(x.date) + ' có ' + x.j.sus + ' người nghi ngờ';
      return '<li class="is-' + k + '"><span class="hub-collab-alert-g" aria-hidden="true">' + g + '</span><span><b>' + esc(x.name) + (x.uid === me ? ' (bạn)' : '') + '</b> — ' + t + '</span>' +
        '<button type="button" class="hub-collab-btn"' + photoBtnAttrs(x) + '>Xem</button></li>';
    }).join('') + '</ul>';
  }
  function tallyHtml(room, it, me, now) {
    var j = it.j;
    if (!j.n) return '<p class="hub-collab-muted">Chưa có ai khác trong phòng để duyệt ảnh này.</p>';
    var rows = room.members.filter(function (m) { return m.uid !== it.uid; }).map(function (m) {
      var v = j.votes[m.uid];
      return '<li class="' + (v ? 'is-' + v : 'is-wait') + '"><b>' + esc(m.name) + (m.uid === me ? ' (bạn)' : '') + '</b><span>' + (v === 'ok' ? '✓ Hợp lệ' : v === 'sus' ? '! Nghi ngờ' : '… Chưa duyệt') + '</span></li>';
    }).join('');
    var verdict = j.voided
      ? '<p class="hub-collab-verdict is-void">✕ Đã bị hủy: quá nửa thành viên khác nghi ngờ → tính như lỡ ngày.</p>'
      : '<p class="hub-collab-verdict">Hủy khi có từ ' + j.need + '/' + j.n + ' người nghi ngờ (hiện ' + j.sus + '). ' + (j.open ? 'Còn ' + leftText(it.at + REVIEW_MS - now) + ' để duyệt.' : 'Đã chốt — không đổi được nữa.') + '</p>';
    return '<ul class="hub-collab-tally">' + rows + '</ul>' + verdict;
  }
  function dupHtml(room, it, me) {
    var o = room.members.filter(function (m) { return m.uid === it.dup.uid; })[0];
    var who = !o ? 'một thành viên' : o.uid === me ? 'chính bạn' : o.uid === it.uid ? 'chính ' + o.name : o.name;
    return '<div class="hub-collab-dupbox"><p class="hub-collab-warn"><b>≈ Ảnh trùng.</b> Gần như cùng một ảnh với ảnh ngày ' + fmtDay(it.dup.date) + ' của ' + esc(who) + ' (lệch ' + it.dup.d + '/256 bit). Cả phòng đã được báo.</p>' +
      '<div class="hub-collab-compare"><figure><img alt="Ảnh này" data-ph="' + esc(it.uid) + '|' + esc(it.date) + '"><figcaption>Ảnh này · ' + fmtDay(it.date) + '</figcaption></figure>' +
      '<figure><img alt="Ảnh cũ hơn" data-ph="' + esc(it.dup.uid) + '|' + esc(it.dup.date) + '"><figcaption>Ảnh cũ · ' + fmtDay(it.dup.date) + '</figcaption></figure></div></div>';
  }

  /* ───────────── phòng: hôm nay & kho nhật ký ───────────── */
  function viewRoom() {
    var room = S.room, c = S.calc, cfg = room.cfg, me = S.store.uid, now = Date.now(), today = c.today;
    var mine = room.members.filter(function (m) { return m.uid === me; })[0];
    if (!mine) return '<div class="hub-collab-panel"><p class="hub-collab-muted">Bạn không còn trong phòng này.</p><button type="button" class="hub-collab-btn" data-act="back">Về sảnh</button></div>';
    var isOwner = room.ownerUid === me, g = c.group, inArc = S.roomTab === 'archive';
    var members = room.members.slice().sort(function (a, b) { return (a.uid === me ? -1 : b.uid === me ? 1 : 0) || (c.states[b.uid].streak - c.states[a.uid].streak) || (a.name < b.name ? -1 : 1); });
    var nudgedMe = room.nudges.filter(function (n) { return n.to === me && n.date === today; }).map(function (n) { var m = room.members.filter(function (x) { return x.uid === n.from; })[0]; return m ? m.name : ''; }).filter(Boolean);
    var nudgedBy = {}; room.nudges.forEach(function (n) { if (n.from === me && n.date === today) nudgedBy[n.to] = true; });
    var pend = pendingReviews(c, me);

    var roomNav = '<div class="hub-collab-roomnav" role="tablist" aria-label="Chế độ xem phòng">' +
      '<button type="button" class="hub-collab-rtab" role="tab" aria-selected="' + (!inArc) + '" data-act="room-tab" data-rtab="today">Hôm nay</button>' +
      '<button type="button" class="hub-collab-rtab" role="tab" aria-selected="' + inArc + '" data-act="room-tab" data-rtab="archive">Kho nhật ký <span class="hub-collab-rtab-n">' + c.allFeed.length + '</span></button></div>';

    var content = inArc
      ? viewArchive(room, c, members, me, nudgedBy)
      : (pend.length ? reviewBanner(pend) : '') + groupHtml(g) + (c.weekly && c.weekly.hasData ? weeklyRecapHtml(room, c, { inArchive: false }) : '') + meHtml(mine, room, c, now) + alertsHtml(c, me) +
        '<h3 class="hub-collab-h3 hub-collab-h3--gap">Cả phòng hôm nay</h3><div class="hub-collab-members">' +
          members.map(function (m) { return memberHtml(m, room, c, me, nudgedBy); }).join('') + '</div>' +
        '<div class="hub-collab-h3-row"><h3 class="hub-collab-h3 hub-collab-h3--gap">Nhật ký check-in</h3>' +
          '<button type="button" class="hub-collab-btn is-ghost hub-collab-arc-jump" data-act="room-tab" data-rtab="archive">Mở kho nhật ký →</button></div>' +
        feedHtml(c);

    return '<header class="hub-collab-header hub-collab-header--room">' +
        '<button type="button" class="hub-collab-btn is-ghost" data-act="back" aria-label="Về sảnh">‹ Sảnh</button>' +
        '<div class="hub-collab-roomhead"><h2 class="hub-collab-title">' + esc(room.name) + '</h2>' +
          '<p class="hub-collab-subtitle">' + room.members.length + ' thành viên · lỡ 1 ngày: −1 tim · hết tim: mất streak · ' + cfg.regenDays + ' ngày check-in liền: +1 tim</p></div>' +
        '<div class="hub-collab-headacts"><button type="button" class="hub-collab-chipbtn" data-act="copy" title="Chép mã mời">' + esc(room.code) + '</button>' +
          '<button type="button" class="hub-collab-btn" data-act="dlg" data-dlg="manage">' + (isOwner ? 'Quản lý' : 'Thành viên') + '</button>' +
          '<button type="button" class="hub-collab-btn" data-act="dlg" data-dlg="settings">Cài đặt</button></div></header>' +
      roomBanners(room, isOwner) +
      (nudgedMe.length && !c.states[me].todayDone && c.states[me].todayOn ? '<div class="hub-collab-banner is-nudge" role="status">' + esc(nudgedMe.join(', ')) + ' vừa nhắc bạn check-in hôm nay.</div>' : '') +
      roomNav + content +
      (S.dlg === 'camera' ? cameraHtml(room) : S.dlg === 'photo' ? photoHtml(room, c, me) : S.dlg === 'manage' ? manageHtml(room, isOwner) : S.dlg === 'confirm' && S.confirm ? confirmHtml() : S.dlg ? dialogHtml(room, mine, isOwner, today) : '');
  }
  function groupHtml(g) {
    var pct = g.total ? Math.round(g.n / g.total * 100) : 0;
    return '<section class="hub-collab-group' + (g.all ? ' is-all' : '') + '"><div class="hub-collab-group-main">' +
        '<span class="hub-collab-kicker">Chuỗi chung</span><b class="hub-collab-bignum">' + g.cur + '</b><span class="hub-collab-unit">ngày</span>' +
        '<span class="hub-collab-muted">Kỷ lục ' + g.best + '</span></div>' +
      '<div class="hub-collab-group-today"><span>' + (g.total ? (g.all ? 'Cả phòng đã check-in hôm nay' : g.n + '/' + g.total + ' người đã check-in hôm nay') : 'Hôm nay không ai có lịch') + '</span>' +
        '<span class="hub-collab-meter" aria-hidden="true"><i style="width:' + pct + '%"></i></span></div></section>';
  }
  function weeklyCardText(room, w) {
    var lines = ['[' + room.name + '] Tổng kết tuần ' + fmtDay(w.weekStart) + ' – ' + fmtDay(w.weekEnd) + '/' + w.weekEnd.slice(0, 4)];
    var sumLine = 'Hoàn thành: ' + w.rate + '% (' + w.totDone + '/' + w.totDue + ' lượt) · Đồng bộ cả phòng: ' + w.syncDays + '/' + w.schedDays + ' ngày';
    if (w.deltaPct !== null) sumLine += ' (' + (w.deltaPct > 0 ? '+' + w.deltaPct + '%' : w.deltaPct + '%') + ' so với tuần trước)';
    lines.push(sumLine);
    if (w.mostPunctual) lines.push('- Đúng giờ nhất: ' + w.mostPunctual.names + ' (' + w.mostPunctual.ok + '/' + w.mostPunctual.due + ' · ' + w.mostPunctual.ratePct + '%)');
    if (w.streakHero) lines.push('- Kéo streak: ' + w.streakHero.names + ' (+' + w.streakHero.gain + ' ngày · chuỗi ' + w.streakHero.streak + (w.streakHero.perfect ? ', không lỡ ngày nào' : '') + ')');
    if (w.weakestDay) {
      lines.push(w.weakestDay.perfect
        ? '- Nhịp cả phòng: Tuần hoàn hảo (0 ngày lỡ)'
        : '- Ngày hay lỡ nhất: ' + w.weakestDay.dayName + ' ' + fmtDay(w.weakestDay.date) + ' (' + w.weakestDay.miss + '/' + w.weakestDay.due + ' người lỡ)');
    }
    return lines.join('\n');
  }
  function weeklyRecapHtml(room, c, opts) {
    var inArc = !!(opts && opts.inArchive);
    var w = (opts && opts.week) || (opts && opts.weekStart ? weeklySummary(room, c, opts.weekStart) : c.weekly);
    if (!w || !w.hasData) return '';
    var dCls = w.deltaPct == null ? '' : w.deltaPct > 0 ? 'is-up' : w.deltaPct < 0 ? 'is-down' : 'is-flat';
    var expanded = inArc || isWeeklyOpen(room.id, w, c.today);
    if (!expanded) {
      var tea = [];
      if (w.mostPunctual) tea.push('Đúng giờ: ' + esc(w.mostPunctual.names) + ' (' + w.mostPunctual.ratePct + '%)');
      if (w.streakHero) tea.push('Kéo streak: ' + esc(w.streakHero.names) + ' (+' + w.streakHero.gain + ')');
      if (w.weakestDay) tea.push(w.weakestDay.perfect ? 'Tuần hoàn hảo' : 'Lỡ nhiều: ' + w.weakestDay.dayName + ' (' + w.weakestDay.miss + ')');
      return '<div class="hub-collab-wbar" role="region" aria-label="Tổng kết tuần vừa qua">' +
        '<span class="hub-collab-wbar-ico" aria-hidden="true">✦</span>' +
        '<div class="hub-collab-wbar-main">' +
          '<span class="hub-collab-wbar-k">Tổng kết tuần <time>' + fmtDay(w.weekStart) + ' – ' + fmtDay(w.weekEnd) + '</time></span>' +
          '<span class="hub-collab-wbadge">' + w.rate + '%</span>' +
          (w.deltaPct !== null ? '<span class="hub-collab-wdelta ' + dCls + '">' + (w.deltaPct > 0 ? '+' + w.deltaPct + '%' : w.deltaPct + '%') + '</span>' : '') +
          '<span class="hub-collab-wbar-tea">' + tea.join(' · ') + '</span>' +
        '</div>' +
        '<button type="button" class="hub-collab-btn" data-act="weekly-toggle" data-wstart="' + esc(w.weekStart) + '">Mở xem</button>' +
      '</div>';
    }
    var deltaHtml = w.deltaPct === null ? ''
      : '<span class="hub-collab-wdelta ' + dCls + '">' + (w.deltaPct > 0 ? '▲ +' + w.deltaPct + '% vs tuần trước' : w.deltaPct < 0 ? '▼ ' + w.deltaPct + '% vs tuần trước' : '● Bằng tuần trước') + '</span>';
    var pVal = w.mostPunctual ? esc(w.mostPunctual.names) : 'Chưa có';
    var pSub = w.mostPunctual
      ? w.mostPunctual.ok + '/' + w.mostPunctual.due + ' ngày đúng giờ (' + w.mostPunctual.ratePct + '%)' + (w.mostPunctual.earlyMins >= 1 ? ' · sớm ~' + w.mostPunctual.earlyMins + 'p' : '')
      : 'Chưa có lượt check-in đúng giờ';
    var sVal = w.streakHero ? esc(w.streakHero.names) : 'Chưa có';
    var sSub = w.streakHero
      ? '+' + w.streakHero.gain + ' ngày hợp lệ · chuỗi ' + w.streakHero.streak + (w.streakHero.perfect ? ' · đủ 100%' : '') + (w.streakHero.newBest ? ' · ★ kỷ lục mới' : '')
      : 'Chưa có lượt hoàn thành';
    var weakCard = w.weakestDay && !w.weakestDay.perfect
      ? '<button type="button" class="hub-collab-wcard is-weak" data-act="arc-day" data-day="' + esc(w.weakestDay.date) + '" title="Mở kho nhật ký ngày này">' +
          '<span class="hub-collab-wcard-k">📉 Ngày hay lỡ nhất</span>' +
          '<b class="hub-collab-wcard-v">' + esc(w.weakestDay.dayName) + ' · ' + fmtDay(w.weakestDay.date) + '</b>' +
          '<span class="hub-collab-wcard-s">' + w.weakestDay.miss + '/' + w.weakestDay.due + ' người lỡ (' + w.weakestDay.missPct + '%) · Xem nhật ký ›</span></button>'
      : '<div class="hub-collab-wcard is-perfect">' +
          '<span class="hub-collab-wcard-k">✨ Nhịp cả phòng</span>' +
          '<b class="hub-collab-wcard-v">Tuần hoàn hảo</b>' +
          '<span class="hub-collab-wcard-s">' + (w.weakestDay && w.weakestDay.lateDay ? '0 ngày lỡ · ' + esc(w.weakestDay.lateDay.dayName) + ' có ' + w.weakestDay.lateDay.late + ' lượt muộn' : '0 ngày lỡ · giữ trọn 100% cam kết') + '</span></div>';
    var daysHtml = '<div class="hub-collab-wdays" role="group" aria-label="Chi tiết 7 ngày trong tuần">' + w.days.map(function (ds) {
      var isWeak = w.weakestDay && !w.weakestDay.perfect && ds.date === w.weakestDay.date;
      var future = ds.date > c.today;
      var tip = ds.dayName + ' ' + fmtDay(ds.date) + ': ' + (ds.due ? ds.done + '/' + ds.due + ' hoàn thành' + (ds.ok ? ', ' + ds.ok + ' đúng giờ' : '') + (ds.late + ds.vlate ? ', ' + (ds.late + ds.vlate) + ' muộn' : '') + (ds.miss ? ', ' + ds.miss + ' lỡ' : '') : 'không có lịch');
      return '<button type="button" class="hub-collab-wday is-' + ds.status + (isWeak ? ' is-weakest' : '') + '" data-act="arc-day" data-day="' + esc(ds.date) + '"' + (future ? ' disabled' : '') + ' title="' + esc(tip) + '">' +
        '<span>' + ds.dow + '</span><b>' + fmtDay(ds.date) + '</b><small>' + (ds.due ? ds.done + '/' + ds.due : '—') + '</small><i></i></button>';
    }).join('') + '</div>';
    var acts = '<button type="button" class="hub-collab-btn is-ghost" data-act="weekly-copy" data-wstart="' + esc(w.weekStart) + '" title="Chép tổng kết tuần">Copy</button>' +
      (inArc ? '' : '<button type="button" class="hub-collab-btn is-ghost" data-act="weekly-arc" data-wstart="' + esc(w.weekStart) + '">Lịch sử</button><button type="button" class="hub-collab-btn" data-act="weekly-toggle" data-wstart="' + esc(w.weekStart) + '">Thu gọn</button>');
    return '<section class="hub-collab-weekly" aria-label="Tổng kết tuần">' +
      '<div class="hub-collab-weekly-head">' +
        '<div class="hub-collab-weekly-title">' +
          '<div class="hub-collab-weekly-krow"><span class="hub-collab-kicker">Tổng kết tuần · ' + fmtDay(w.weekStart) + ' – ' + fmtDay(w.weekEnd) + '/' + w.weekEnd.slice(0, 4) + '</span>' +
            (!inArc && isMonday(c.today) ? '<span class="hub-collab-wnew">Mới · Thứ 2</span>' : '') + '</div>' +
          '<div class="hub-collab-wkpis"><span class="hub-collab-wbadge">' + w.rate + '% <em>(' + w.totDone + '/' + w.totDue + ' lượt)</em></span>' + deltaHtml +
            '<span class="hub-collab-wpill">' + w.syncDays + '/' + w.schedDays + ' ngày đồng bộ</span></div>' +
        '</div>' +
        '<div class="hub-collab-weekly-acts">' + acts + '</div>' +
      '</div>' +
      '<div class="hub-collab-wgrid">' +
        '<div class="hub-collab-wcard is-punctual"><span class="hub-collab-wcard-k">⏱ Đúng giờ nhất</span><b class="hub-collab-wcard-v">' + pVal + '</b><span class="hub-collab-wcard-s">' + pSub + '</span></div>' +
        '<div class="hub-collab-wcard is-streak"><span class="hub-collab-wcard-k">🔥 Kéo streak</span><b class="hub-collab-wcard-v">' + sVal + '</b><span class="hub-collab-wcard-s">' + sSub + '</span></div>' +
        weakCard +
      '</div>' +
      daysHtml +
    '</section>';
  }
  function meHtml(mine, room, c, now) {
    var st = c.states[mine.uid], cm = curCommit(mine, c.today), cfg = room.cfg, ci = (room.checkins[mine.uid] || {})[c.today], it = c.by[mine.uid + '|' + c.today], body;
    var li = ci ? lateInfo(ci, cm, c.today, cfg.cutoff) : null, voided = !!(it && it.j.voided);
    if (!st.todayOn) body = '<p class="hub-collab-rest">Hôm nay không có lịch cho cam kết này — nghỉ ngơi nhé.</p>';
    else if (ci) {
      var canUndo = now - ci.at < UNDO_MS && !(it && (it.j.sus || it.j.voided));            // đã bị nghi ngờ thì không được xoá để chụp lại
      body = '<div class="hub-collab-done' + (voided ? ' is-void' : '') + '">' + (ci.hasPhoto ? thumbHtml(mine.uid, c.today, mine.name, 'is-lg', 'today', it) : '<span class="hub-collab-tick ' + (voided ? 'is-vlate' : lateCls(li)) + '" aria-hidden="true"></span>') +
        '<div><div class="hub-collab-done-top"><b>' + (voided ? 'Check-in hôm nay đã bị hủy' : 'Đã check-in lúc ' + fmtTime(ci.at)) + '</b>' +
          (voided
            ? '<span class="hub-collab-status is-void">Tính như lỡ ngày</span>'
            : '<span class="hub-collab-status ' + lateCls(li) + '">' + lateIcon(li) + ' ' + (li && li.label ? esc(li.label) : 'Đúng giờ') + '</span>') + '</div>' +
          '<span class="hub-collab-muted">' + (voided ? 'Quá nửa thành viên khác nghi ngờ ảnh — tính như lỡ ngày.' : dayName(c.today) + ', ngày ' + fmtDay(c.today) + (li && li.label && li.target ? ' · mục tiêu ' + esc(li.target) : '') + (ci.note ? ' · “' + esc(ci.note) + '”' : '')) + '</span>' + reviewChips(it) + '</div>' +
        (canUndo ? '<button type="button" class="hub-collab-btn is-ghost" data-act="undo" data-until="' + (ci.at + UNDO_MS) + '">Hoàn tác</button>' : '') + '</div>';
    } else {
      body = '<div class="hub-collab-checkin"><p class="hub-collab-muted">Chụp ảnh ngay tại chỗ (đang làm / vừa làm xong cam kết) để được phép check-in.' +
        (cfg.challenge ? ' Phòng đang bật <b>mã thử thách</b>: màn hình sẽ hiện một số — hãy viết lên giấy hoặc giơ đúng số ngón tay đó.' : '') + ' Các thành viên khác sẽ duyệt ảnh của bạn.</p>' +
        '<button type="button" class="hub-collab-checkbtn" data-act="cam"><span>Chụp ảnh &amp; check-in</span><small data-hc-clock>' + fmtTime(now) + '</small></button></div>' +
        '<p class="hub-collab-muted" data-hc-left data-end="' + dayEndMs(c.today, cfg.cutoff) + '">Còn ' + leftText(dayEndMs(c.today, cfg.cutoff) - now) + ' đến giờ chốt ngày (' + pad(cfg.cutoff) + ':00)</p>';
    }
    return '<section class="hub-collab-me' + (ci ? (voided ? ' is-void' : ' ' + lateCls(li)) : '') + '"><div class="hub-collab-me-top"><div><span class="hub-collab-kicker">Hôm nay · ' + dayName(c.today) + ', ' + fmtDay(c.today) + '</span>' +
        '<h3 class="hub-collab-commit">' + commitLine(cm) + '</h3></div>' +
        '<div class="hub-collab-vitals">' + heartsHtml(st.hearts, st.max) + '<span class="hub-collab-streak"><b>' + st.streak + '</b> ngày streak</span></div></div>' + body + '</section>';
  }
  function stripHtml(log, opts) {
    var padTo = opts && opts.padTo !== undefined ? opts.padTo : 28;
    var click = !!(opts && opts.click);
    var cells = padTo ? log.slice(-padTo) : log.slice();
    var pre = padTo ? Math.max(0, padTo - cells.length) : 0, h = '';
    for (var i = 0; i < pre; i++) h += '<i class="is-none"></i>';
    cells.forEach(function (e) {
      var kind = e[1];
      var lbl = kind === 'ok' ? 'đúng giờ' : kind === 'late' ? 'muộn ≤1H' : kind === 'vlate' ? 'muộn >1H'
        : ({ miss: 'lỡ (−1 tim)', ko: 'lỡ — hết tim, mất streak', rest: 'nghỉ', today: 'hôm nay chưa check-in' }[kind] || '');
      var timeS = (kind === 'ok' || kind === 'late' || kind === 'vlate') && e[2] && e[2].at ? ' · ' + fmtTime(e[2].at) : '';
      var tip = fmtDay(e[0]) + timeS + (lbl ? ' · ' + lbl : '');
      h += '<i class="is-' + kind + (click ? ' is-click" data-act="arc-day" data-day="' + esc(e[0]) + '" role="button" tabindex="0' : '') + '" title="' + esc(tip) + '"></i>';
    });
    return '<span class="hub-collab-strip"' + (click ? '' : ' aria-hidden="true"') + '>' + h + '</span>';
  }
  function memberHtml(m, room, c, me, nudgedBy) {
    var st = c.states[m.uid], cm = curCommit(m, c.today), ci = (room.checkins[m.uid] || {})[c.today], it = c.by[m.uid + '|' + c.today], isMe = m.uid === me, voided = !!(it && it.j.voided), chip;
    var li = ci ? lateInfo(ci, cm, c.today, room.cfg.cutoff) : null;
    if (!st.todayOn) chip = '<span class="hub-collab-status is-rest">Hôm nay nghỉ</span>';
    else if (ci && voided) chip = '<span class="hub-collab-status is-void">Check-in bị hủy</span>';
    else if (ci) chip = '<span class="hub-collab-status ' + lateCls(li) + '">' + lateIcon(li) + ' Đã check-in ' + fmtTime(ci.at) + (li && li.label ? ' · ' + esc(li.label) : '') + '</span>';
    else chip = '<span class="hub-collab-status is-wait">Chưa check-in</span>';
    var act = '';
    if (!isMe && st.todayOn && !ci) act = nudgedBy[m.uid] ? '<button type="button" class="hub-collab-btn" disabled>Đã nhắc</button>' : '<button type="button" class="hub-collab-btn" data-act="nudge" data-uid="' + esc(m.uid) + '">Nhắc nhẹ</button>';
    else if (!isMe && ci && ci.hasPhoto && it && it.j.open && it.j.n) {
      var mv = it.j.votes[me];
      act = '<button type="button" class="hub-collab-btn' + (mv ? '' : ' is-primary') + '"' + photoBtnAttrs(it) + '>' + (mv ? 'Đã duyệt: ' + VOTE_TEXT[mv] : 'Duyệt ảnh') + '</button>';
    }
    return '<article class="hub-collab-member' + (isMe ? ' is-me' : '') + (ci ? (voided ? ' is-void' : ' ' + lateCls(li)) : '') + '">' +
      '<div class="hub-collab-avatar" aria-hidden="true" data-i="' + esc((m.name || '?').charAt(0).toUpperCase()) + '">' + esc((m.name || '?').charAt(0).toUpperCase()) + '</div>' +
      '<div class="hub-collab-member-main"><div class="hub-collab-member-top"><b>' + esc(m.name) + '</b>' + (isMe ? '<span class="hub-collab-me-tag">bạn</span>' : '') + chip + '</div>' +
        '<div class="hub-collab-muted">' + commitLine(cm) + '</div>' + reviewChips(it) +
        '<div class="hub-collab-vitals">' + heartsHtml(st.hearts, st.max) + '<span class="hub-collab-streak"><b>' + st.streak + '</b> streak · kỷ lục ' + st.best + (st.kos ? ' · ' + st.kos + ' lần KO' : '') + '</span></div>' +
        stripHtml(st.log) + '</div><div class="hub-collab-member-act">' + (ci && ci.hasPhoto ? thumbHtml(m.uid, c.today, m.name, '', 'today', it) : '') + act + '</div></article>';
  }
  function feedHtml(c) {
    if (!c.feed.length) return '<p class="hub-collab-muted hub-collab-feed-empty">Chưa có ai check-in. Người đầu tiên là bạn?</p>';
    return '<ul class="hub-collab-feed">' + c.feed.map(function (e) {
      var voided = !!(e.j && e.j.voided);
      var badge = voided
        ? '<span class="hub-collab-status hub-collab-status--xs is-void">Bị hủy</span>'
        : '<span class="hub-collab-status hub-collab-status--xs ' + lateCls(e.late) + '">' + lateIcon(e.late) + (e.late && e.late.label ? ' ' + esc(e.late.label) : ' Đúng giờ') + '</span>';
      return '<li><time>' + fmtTime(e.at) + ' · ' + fmtDay(e.date) + '</time>' + (e.photo ? thumbHtml(e.uid, e.date, e.name, 'is-sm', 'feed', e) : '') +
        '<span class="hub-collab-feed-main"><b>' + esc(e.name) + '</b> ' + badge + (e.note ? ' — “' + esc(e.note) + '”' : '') + reviewChips(e) + '</span></li>';
    }).join('') + '</ul>';
  }

  /* ───────────── kho nhật ký check-in (Archive & Audit) ───────────── */
  function memberLogMap(st) {
    var map = {};
    (st && st.log || []).forEach(function (e) { map[e[0]] = e[1]; });
    return map;
  }
  function arcMatchEntry(arc, m, cm, ci, li, due, it) {
    if (arc.member !== 'all' && m.uid !== arc.member) return false;
    var s = arc.status, voided = !!(it && it.j.voided);
    if (s === 'ok' && (!ci || voided || !li || li.tier !== 'ok')) return false;
    if (s === 'late' && (!ci || voided || !li || li.tier !== 'late')) return false;
    if (s === 'vlate' && (!ci || voided || !li || li.tier !== 'vlate')) return false;
    if (s === 'miss' && (!due || (ci && !voided))) return false;
    if (s === 'photo' && (!ci || !ci.hasPhoto)) return false;
    var q = (arc.q || '').trim().toLowerCase();
    if (q) {
      var hay = ((m.name || '') + ' ' + (cm && cm.title ? cm.title : '') + ' ' + (ci && ci.note ? ci.note : '')).toLowerCase();
      if (hay.indexOf(q) === -1) return false;
    }
    return true;
  }
  function arcCalendarHtml(room, c, arc) {
    var days = daysInMonth(arc.month), firstW = parseYmd(days[0]).getDay(), lead = (firstW + 6) % 7;
    var dows = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'].map(function (w) { return '<span>' + w + '</span>'; }).join('');
    var cells = '';
    for (var b = 0; b < lead; b++) cells += '<span class="hub-collab-cal-pad" aria-hidden="true"></span>';
    days.forEach(function (d) {
      var num = +d.slice(8), future = d > c.today;
      if (future) {
        cells += '<button type="button" class="hub-collab-cal-day is-future" disabled><b>' + num + '</b></button>';
        return;
      }
      var due = 0, checked = 0, lateN = 0, vlateN = 0, voidN = 0;
      room.members.forEach(function (m) {
        if (arc.member !== 'all' && m.uid !== arc.member) return;
        if (!scheduled(m, d)) return;
        due++;
        var ci = (room.checkins[m.uid] || {})[d], it = c.by[m.uid + '|' + d], voided = !!(it && it.j.voided);
        if (ci && !voided) {
          checked++;
          var li = lateInfo(ci, commitAt(m, d), d, room.cfg.cutoff);
          if (li.tier === 'vlate') vlateN++;
          else if (li.tier === 'late') lateN++;
        } else if (ci && voided) {
          voidN++;
        }
      });
      var miss = due - checked;
      var cls = !due ? 'is-rest' : (d === c.today && miss > 0 && !voidN) ? 'is-part' : (miss > 0 || vlateN > 0) ? 'is-bad' : lateN > 0 ? 'is-warn' : 'is-perfect';
      if (d === c.today) cls += ' is-today';
      if (d === arc.day && arc.mode === 'day') cls += ' is-sel';
      var tip = fmtDay(d) + (due ? ': ' + checked + '/' + due + ' đã check-in' + (lateN ? ', ' + lateN + ' muộn' : '') + (vlateN ? ', ' + vlateN + ' muộn >1H' : '') + (voidN ? ', ' + voidN + ' bị hủy' : '') : ': ngày nghỉ');
      cells += '<button type="button" class="hub-collab-cal-day ' + cls + '" data-act="arc-day" data-day="' + d + '" title="' + esc(tip) + '">' +
        '<b>' + num + '</b>' +
        (due ? '<small class="hub-collab-cal-ratio">' + checked + '/' + due + '</small><i class="hub-collab-cal-dot" aria-hidden="true"></i>' : '<small class="hub-collab-cal-ratio">—</small>') +
      '</button>';
    });
    return '<div class="hub-collab-cal"><div class="hub-collab-cal-dow">' + dows + '</div><div class="hub-collab-cal-grid">' + cells + '</div>' +
      '<div class="hub-collab-cal-leg">' +
        '<span><i class="is-perfect"></i>Đủ &amp; đúng giờ</span>' +
        '<span><i class="is-warn"></i>Có check-in muộn</span>' +
        '<span><i class="is-bad"></i>Có bỏ lỡ / muộn &gt;1H</span>' +
        '<span><i class="is-part"></i>Hôm nay đang chờ</span>' +
      '</div></div>';
  }
  function arcDayHtml(room, c, members, arc, me, nudgedBy) {
    var d = arc.day > c.today ? c.today : arc.day, nextDisabled = d >= c.today;
    var okList = [], missList = [], restList = [];
    var totDue = 0, totChecked = 0, okN = 0, lateN = 0, vlateN = 0, voidN = 0;

    members.forEach(function (m) {
      var cm = commitAt(m, d), due = !!cm && scheduled(m, d), ci = (room.checkins[m.uid] || {})[d], it = c.by[m.uid + '|' + d], voided = !!(it && it.j.voided);
      var li = ci ? lateInfo(ci, cm || curCommit(m, d), d, room.cfg.cutoff) : null;
      if (due) {
        totDue++;
        if (ci && !voided) { totChecked++; if (li.tier === 'vlate') vlateN++; else if (li.tier === 'late') lateN++; else okN++; }
        else if (ci && voided) voidN++;
      }
      if (!due && !ci) {
        if (arc.status === 'all' && (arc.member === 'all' || arc.member === m.uid) && !(arc.q || '').trim()) restList.push(m);
        return;
      }
      if (!arcMatchEntry(arc, m, cm, ci, li, due, it)) return;
      if (ci) okList.push({ m: m, cm: cm || curCommit(m, d), ci: ci, li: li, it: it });
      else missList.push({ m: m, cm: cm || curCommit(m, d), logCode: memberLogMap(c.states[m.uid])[d] || 'miss' });
    });

    var head = '<div class="hub-collab-arc-dayhead">' +
      '<div class="hub-collab-arc-dnav">' +
        '<button type="button" class="hub-collab-btn" data-act="arc-day-shift" data-dir="-1" aria-label="Ngày trước">‹</button>' +
        '<b>' + dayName(d) + ', ' + fmtDay(d) + '/' + d.slice(0, 4) + (d === c.today ? ' · Hôm nay' : '') + '</b>' +
        '<button type="button" class="hub-collab-btn" data-act="arc-day-shift" data-dir="1" aria-label="Ngày sau"' + (nextDisabled ? ' disabled' : '') + '>›</button>' +
      '</div>' +
      '<div class="hub-collab-arc-pills">' +
        '<span class="hub-collab-apill">' + totChecked + '/' + totDue + ' hoàn thành</span>' +
        (okN ? '<span class="hub-collab-apill is-done">✓ ' + okN + ' đúng giờ</span>' : '') +
        (lateN ? '<span class="hub-collab-apill is-late">▲ ' + lateN + ' muộn</span>' : '') +
        (vlateN ? '<span class="hub-collab-apill is-vlate">‼ ' + vlateN + ' &gt;1H</span>' : '') +
        (voidN ? '<span class="hub-collab-apill is-miss">✕ ' + voidN + ' bị hủy</span>' : '') +
        (totDue - totChecked - voidN > 0 ? '<span class="hub-collab-apill is-miss">✕ ' + (totDue - totChecked - voidN) + ' chưa/lỡ</span>' : '') +
      '</div></div>';

    var checkedHtml = okList.length
      ? '<h4 class="hub-collab-h4">Đã check-in (' + okList.length + ')</h4><div class="hub-collab-alist">' + okList.map(function (row) {
          var isMe = row.m.uid === me, it = row.it, voided = !!(it && it.j.voided);
          var badge = voided
            ? '<span class="hub-collab-status is-void">Bị hủy — tính như lỡ ngày</span>'
            : '<span class="hub-collab-status ' + lateCls(row.li) + '">' + lateIcon(row.li) + ' ' + fmtTime(row.ci.at) + (row.li && row.li.label ? ' · ' + esc(row.li.label) : ' · Đúng giờ') + '</span>';
          var act = '';
          if (!isMe && row.ci.hasPhoto && it && it.j.open && it.j.n) {
            var mv = it.j.votes[me];
            act = '<div class="hub-collab-arow-act"><button type="button" class="hub-collab-btn' + (mv ? '' : ' is-primary') + '"' + photoBtnAttrs(it) + '>' + (mv ? 'Đã duyệt: ' + VOTE_TEXT[mv] : 'Duyệt ảnh') + '</button></div>';
          }
          return '<div class="hub-collab-arow ' + (voided ? 'is-void' : lateCls(row.li)) + '">' +
            (row.ci.hasPhoto ? thumbHtml(row.m.uid, d, row.m.name, 'is-lg', 'day', it) : '<div class="hub-collab-avatar" aria-hidden="true" data-i="' + esc((row.m.name || '?').charAt(0).toUpperCase()) + '">' + esc((row.m.name || '?').charAt(0).toUpperCase()) + '</div>') +
            '<div class="hub-collab-arow-main">' +
              '<div class="hub-collab-arow-top"><b>' + esc(row.m.name) + '</b>' + (isMe ? '<span class="hub-collab-me-tag">bạn</span>' : '') + badge + '</div>' +
              '<div class="hub-collab-muted">' + commitLine(row.cm) + '</div>' + reviewChips(it) +
              (row.ci.note ? '<p class="hub-collab-arow-note">“' + esc(row.ci.note) + '”</p>' : '') +
            '</div>' + act + '</div>';
        }).join('') + '</div>'
      : '';

    var missHtml = missList.length
      ? '<h4 class="hub-collab-h4">' + (d === c.today ? 'Chưa check-in hôm nay' : 'Chưa check-in / Bỏ lỡ') + ' (' + missList.length + ')</h4><div class="hub-collab-alist">' + missList.map(function (it) {
          var isMe = it.m.uid === me;
          var tag = d === c.today
            ? '<span class="hub-collab-status is-wait">Chưa check-in</span>'
            : it.logCode === 'ko'
              ? '<span class="hub-collab-status is-vlate">✕ KO · mất streak</span>'
              : '<span class="hub-collab-status is-vlate">✕ Bỏ lỡ (−1 tim)</span>';
          var act = '';
          if (d === c.today && !isMe) {
            act = nudgedBy[it.m.uid]
              ? '<button type="button" class="hub-collab-btn" disabled>Đã nhắc</button>'
              : '<button type="button" class="hub-collab-btn" data-act="nudge" data-uid="' + esc(it.m.uid) + '">Nhắc nhẹ</button>';
          }
          return '<div class="hub-collab-arow is-miss">' +
            '<div class="hub-collab-avatar" aria-hidden="true" data-i="' + esc((it.m.name || '?').charAt(0).toUpperCase()) + '">' + esc((it.m.name || '?').charAt(0).toUpperCase()) + '</div>' +
            '<div class="hub-collab-arow-main">' +
              '<div class="hub-collab-arow-top"><b>' + esc(it.m.name) + '</b>' + (isMe ? '<span class="hub-collab-me-tag">bạn</span>' : '') + tag + '</div>' +
              '<div class="hub-collab-muted">' + commitLine(it.cm) + '</div>' +
            '</div>' + (act ? '<div class="hub-collab-arow-act">' + act + '</div>' : '') + '</div>';
        }).join('') + '</div>'
      : '';

    var restHtml = restList.length
      ? '<p class="hub-collab-muted hub-collab-arc-rest">Nghỉ theo lịch (' + restList.length + '): ' + esc(restList.map(function (m) { return m.name; }).join(', ')) + '.</p>'
      : '';

    var emptyMsg = (!okList.length && !missList.length)
      ? '<p class="hub-collab-muted hub-collab-feed-empty">' + (restList.length ? 'Không ai có lịch trong ngày này.' : 'Không có bản ghi nào khớp bộ lọc.') + '</p>'
      : '';

    return head + emptyMsg + checkedHtml + missHtml + restHtml;
  }
  function arcGalleryItems(room, c, members, arc) {
    var items = [];
    Object.keys(room.checkins).forEach(function (uid) {
      var m = members.filter(function (x) { return x.uid === uid; })[0];
      if (!m) return;
      Object.keys(room.checkins[uid]).forEach(function (date) {
        if (monthKey(date) !== arc.month) return;
        var ci = room.checkins[uid][date], entry = c && c.by[uid + '|' + date];
        if (!ci || !ci.hasPhoto) return;
        var cm = commitAt(m, date) || curCommit(m, date);
        var li = lateInfo(ci, cm, date, room.cfg.cutoff);
        if (!arcMatchEntry(arc, m, cm, ci, li, true, entry)) return;
        items.push({ uid: uid, name: m.name, date: date, at: ci.at, note: ci.note || '', li: li, cm: cm, entry: entry });
      });
    });
    items.sort(function (a, b) { return b.at - a.at; });
    return items;
  }
  function arcGalleryHtml(room, c, members, arc) {
    var items = arcGalleryItems(room, c, members, arc);
    if (!items.length) return '<p class="hub-collab-muted hub-collab-feed-empty">Chưa có ảnh check-in nào trong ' + esc(fmtMonthLabel(arc.month)) + ' khớp bộ lọc.</p>';
    return '<div class="hub-collab-gallery">' + items.map(function (it) {
      var voided = !!(it.entry && it.entry.j.voided);
      return '<article class="hub-collab-gcard ' + (voided ? 'is-void' : lateCls(it.li)) + '">' +
        thumbHtml(it.uid, it.date, it.name, 'hub-collab-gcard-img', 'gallery', it.entry) +
        '<div class="hub-collab-gcard-meta">' +
          '<div class="hub-collab-gcard-top"><b>' + esc(it.name) + '</b>' +
            (voided ? '<span class="hub-collab-status hub-collab-status--xs is-void">Bị hủy</span>'
              : '<span class="hub-collab-status hub-collab-status--xs ' + lateCls(it.li) + '">' + lateIcon(it.li) + (it.li && it.li.label ? ' ' + esc(it.li.label) : ' Đúng giờ') + '</span>') + '</div>' +
          '<span class="hub-collab-muted">' + fmtTime(it.at) + ' · ' + fmtDay(it.date) + '</span>' +
          reviewChips(it.entry) +
          (it.note ? '<p class="hub-collab-gcard-note">“' + esc(it.note) + '”</p>' : '') +
        '</div></article>';
    }).join('') + '</div>';
  }
  function arcMonthStats(room, c, members, arc) {
    var days = daysInMonth(arc.month).filter(function (d) { return d <= c.today; });
    var totDue = 0, totDone = 0, okN = 0, lateN = 0, vlateN = 0, missN = 0, syncDays = 0, schedDays = 0;
    var perM = {};
    members.forEach(function (m) {
      if (arc.member !== 'all' && m.uid !== arc.member) return;
      perM[m.uid] = { m: m, due: 0, done: 0, ok: 0, late: 0, vlate: 0, miss: 0, minsSum: 0, minsCnt: 0, log: [] };
    });
    days.forEach(function (d) {
      var dDue = 0, dDone = 0;
      members.forEach(function (m) {
        if (!perM[m.uid]) return;
        var pm = perM[m.uid], cm = commitAt(m, d), due = !!cm && scheduled(m, d), ci = (room.checkins[m.uid] || {})[d];
        var it = c.by[m.uid + '|' + d], valid = !!ci && !(it && it.j.voided);
        if (!due) { pm.log.push([d, valid ? 'ok' : 'rest', valid ? ci : null]); return; }
        dDue++; totDue++; pm.due++;
        if (valid) {
          dDone++; totDone++; pm.done++;
          var li = lateInfo(ci, cm, d, room.cfg.cutoff);
          if (li.tier === 'vlate') { vlateN++; pm.vlate++; pm.log.push([d, 'vlate', ci]); }
          else if (li.tier === 'late') { lateN++; pm.late++; pm.log.push([d, 'late', ci]); }
          else { okN++; pm.ok++; pm.log.push([d, 'ok', ci]); }
          var relM = Math.round((ci.at - parseYmd(d).getTime()) / 60000);
          if (relM < 0 || relM > 1700) { var dt = new Date(ci.at); relM = dt.getHours() * 60 + dt.getMinutes(); }
          pm.minsSum += relM; pm.minsCnt++;
        } else {
          if (d < c.today) { missN++; pm.miss++; }
          var lcode = memberLogMap(c.states[m.uid])[d] || (d === c.today ? 'today' : 'miss');
          pm.log.push([d, lcode, null]);
        }
      });
      if (dDue > 0) { schedDays++; if (dDone === dDue) syncDays++; }
    });
    return { totDue: totDue, totDone: totDone, okN: okN, lateN: lateN, vlateN: vlateN, missN: missN, syncDays: syncDays, schedDays: schedDays, rows: Object.keys(perM).map(function (u) { return perM[u]; }) };
  }
  function arcMonthHtml(room, c, members, arc) {
    var ms = arcMonthStats(room, c, members, arc);
    var rate = ms.totDue ? Math.round(ms.totDone / ms.totDue * 100) : 0;
    var onTimeRate = ms.totDone ? Math.round(ms.okN / ms.totDone * 100) : 0;
    var sumAll = ms.okN + ms.lateN + ms.vlateN + ms.missN;
    function pct(n) { return sumAll ? (n / sumAll * 100).toFixed(1) : '0'; }
    function avgClock(pm) {
      if (!pm.minsCnt) return '—';
      var m = ((Math.round(pm.minsSum / pm.minsCnt) % 1440) + 1440) % 1440;
      return pad(Math.floor(m / 60)) + ':' + pad(m % 60);
    }
    return '<div class="hub-collab-mkpis">' +
        '<div class="hub-collab-mkpi"><span class="hub-collab-kicker">Hoàn thành</span><b>' + rate + '%</b><small>' + ms.totDone + '/' + ms.totDue + ' lượt</small></div>' +
        '<div class="hub-collab-mkpi"><span class="hub-collab-kicker">Đồng bộ cả phòng</span><b>' + ms.syncDays + '/' + ms.schedDays + '</b><small>ngày đủ 100%</small></div>' +
        '<div class="hub-collab-mkpi is-ok"><span class="hub-collab-kicker">Đúng giờ</span><b>' + onTimeRate + '%</b><small>' + ms.okN + ' lượt</small></div>' +
        '<div class="hub-collab-mkpi is-warn"><span class="hub-collab-kicker">Muộn / Lỡ</span><b>' + (ms.lateN + ms.vlateN) + ' / ' + ms.missN + '</b><small>' + ms.lateN + ' ≤1H · ' + ms.vlateN + ' &gt;1H</small></div>' +
      '</div>' +
      (sumAll ? '<div class="hub-collab-mbar" aria-label="Tỉ lệ trạng thái trong tháng">' +
        '<i class="is-ok" style="width:' + pct(ms.okN) + '%" title="Đúng giờ: ' + ms.okN + '"></i>' +
        '<i class="is-late" style="width:' + pct(ms.lateN) + '%" title="Muộn ≤1H: ' + ms.lateN + '"></i>' +
        '<i class="is-vlate" style="width:' + pct(ms.vlateN) + '%" title="Muộn >1H: ' + ms.vlateN + '"></i>' +
        '<i class="is-miss" style="width:' + pct(ms.missN) + '%" title="Bỏ lỡ: ' + ms.missN + '"></i></div>' : '') +
      '<div class="hub-collab-maudit">' + ms.rows.map(function (pm) {
        var r = pm.due ? Math.round(pm.done / pm.due * 100) : 0;
        return '<div class="hub-collab-maudit-row">' +
          '<div class="hub-collab-maudit-top"><div class="hub-collab-maudit-who"><div class="hub-collab-avatar is-sm" aria-hidden="true" data-i="' + esc((pm.m.name || '?').charAt(0).toUpperCase()) + '">' + esc((pm.m.name || '?').charAt(0).toUpperCase()) + '</div>' +
            '<div><b>' + esc(pm.m.name) + '</b><span class="hub-collab-muted">TB ' + avgClock(pm) + ' · ' + pm.done + '/' + pm.due + ' ngày (' + r + '%)</span></div></div>' +
            '<div class="hub-collab-arc-pills">' +
              '<span class="hub-collab-apill is-done">✓ ' + pm.ok + '</span>' +
              '<span class="hub-collab-apill is-late">▲ ' + pm.late + '</span>' +
              '<span class="hub-collab-apill is-vlate">‼ ' + pm.vlate + '</span>' +
              '<span class="hub-collab-apill is-miss">✕ ' + pm.miss + '</span>' +
            '</div></div>' +
          stripHtml(pm.log, { padTo: 0, click: true }) +
        '</div>';
      }).join('') + '</div>';
  }
  function arcWeeklyHtml(room, c, w) {
    if (!w.hasData) return '<p class="hub-collab-muted hub-collab-feed-empty">Chưa có dữ liệu check-in nào trong tuần ' + fmtDay(w.weekStart) + ' – ' + fmtDay(w.weekEnd) + '.</p>';
    var rows = w.rows.filter(function (pm) { return pm.due > 0 || pm.done > 0; });
    var list = rows.length
      ? '<h4 class="hub-collab-h4">Chi tiết thành viên trong tuần</h4><div class="hub-collab-maudit">' + rows.map(function (pm) {
          var r = pm.due ? Math.round(pm.done / pm.due * 100) : 0;
          return '<div class="hub-collab-maudit-row">' +
            '<div class="hub-collab-maudit-top"><div class="hub-collab-maudit-who"><div class="hub-collab-avatar is-sm" aria-hidden="true" data-i="' + esc((pm.m.name || '?').charAt(0).toUpperCase()) + '">' + esc((pm.m.name || '?').charAt(0).toUpperCase()) + '</div>' +
              '<div><b>' + esc(pm.m.name) + '</b><span class="hub-collab-muted">chuỗi ' + pm.streakEnd + ' · ' + pm.done + '/' + pm.due + ' ngày (' + r + '%)</span></div></div>' +
              '<div class="hub-collab-arc-pills">' +
                '<span class="hub-collab-apill is-done">✓ ' + pm.ok + '</span>' +
                '<span class="hub-collab-apill is-late">▲ ' + pm.late + '</span>' +
                '<span class="hub-collab-apill is-vlate">‼ ' + pm.vlate + '</span>' +
                '<span class="hub-collab-apill is-miss">✕ ' + pm.miss + '</span>' +
              '</div></div>' +
            stripHtml(pm.log, { padTo: 0, click: true }) +
          '</div>';
        }).join('') + '</div>'
      : '';
    return weeklyRecapHtml(room, c, { inArchive: true, week: w }) + list;
  }
  function viewArchive(room, c, members, me, nudgedBy) {
    var arc = arcState(c.today), curM = monthKey(c.today), nextDis = arc.month >= curM, wMode = arc.mode === 'weekly';
    var hasFilter = arc.member !== 'all' || arc.status !== 'all' || !!(arc.q || '').trim();
    var w = wMode ? weeklySummary(room, c, arc.week) : null;
    if (w && arc.week !== w.weekStart) arc.week = w.weekStart;
    var rightNav = wMode
      ? '<div class="hub-collab-arc-mnav">' +
          '<button type="button" class="hub-collab-btn" data-act="arc-week" data-dir="-1" aria-label="Tuần trước"' + (!w.canPrev ? ' disabled' : '') + '>◀</button>' +
          '<b>Tuần ' + fmtDay(w.weekStart) + ' – ' + fmtDay(w.weekEnd) + '</b>' +
          '<button type="button" class="hub-collab-btn" data-act="arc-week" data-dir="1" aria-label="Tuần sau"' + (!w.canNext ? ' disabled' : '') + '>▶</button>' +
          '<button type="button" class="hub-collab-btn" data-act="arc-week-latest">Tuần vừa qua</button>' +
          '<button type="button" class="hub-collab-btn" data-act="weekly-copy" data-wstart="' + esc(w.weekStart) + '" title="Chép tổng kết tuần">Copy tổng kết</button>' +
        '</div>'
      : '<div class="hub-collab-arc-mnav">' +
          '<button type="button" class="hub-collab-btn" data-act="arc-month" data-dir="-1" aria-label="Tháng trước">◀</button>' +
          '<b>' + esc(fmtMonthLabel(arc.month)) + '</b>' +
          '<button type="button" class="hub-collab-btn" data-act="arc-month" data-dir="1" aria-label="Tháng sau"' + (nextDis ? ' disabled' : '') + '>▶</button>' +
          '<button type="button" class="hub-collab-btn" data-act="arc-today">Hôm nay</button>' +
          '<button type="button" class="hub-collab-btn" data-act="arc-copy" title="Chép báo cáo điểm danh">Copy báo cáo</button>' +
        '</div>';
    var bar = '<div class="hub-collab-arc-bar">' +
        '<div class="hub-collab-arc-modes" role="group" aria-label="Chế độ xem kho nhật ký">' +
          '<button type="button" class="hub-collab-btn" data-act="arc-mode" data-amode="day" aria-pressed="' + (arc.mode === 'day') + '">Theo ngày</button>' +
          '<button type="button" class="hub-collab-btn" data-act="arc-mode" data-amode="gallery" aria-pressed="' + (arc.mode === 'gallery') + '">Thư viện ảnh</button>' +
          '<button type="button" class="hub-collab-btn" data-act="arc-mode" data-amode="month" aria-pressed="' + (arc.mode === 'month') + '">Tổng quan tháng</button>' +
          '<button type="button" class="hub-collab-btn" data-act="arc-mode" data-amode="weekly" aria-pressed="' + wMode + '">Tổng kết tuần</button>' +
        '</div>' + rightNav + '</div>';

    var filters = wMode ? '' : arc.mode === 'month' ? '<div class="hub-collab-arc-filters">' +
        '<select class="hub-collab-input" data-arc="member" aria-label="Lọc theo thành viên"><option value="all">Tất cả thành viên</option>' +
          members.map(function (m) { return '<option value="' + esc(m.uid) + '"' + (arc.member === m.uid ? ' selected' : '') + '>' + esc(m.name) + '</option>'; }).join('') +
        '</select></div>'
      : '<div class="hub-collab-arc-filters">' +
        '<select class="hub-collab-input" data-arc="member" aria-label="Lọc theo thành viên"><option value="all">Tất cả thành viên</option>' +
          members.map(function (m) { return '<option value="' + esc(m.uid) + '"' + (arc.member === m.uid ? ' selected' : '') + '>' + esc(m.name) + '</option>'; }).join('') +
        '</select>' +
        '<select class="hub-collab-input" data-arc="status" aria-label="Lọc theo trạng thái">' +
          '<option value="all"' + (arc.status === 'all' ? ' selected' : '') + '>Mọi trạng thái</option>' +
          '<option value="ok"' + (arc.status === 'ok' ? ' selected' : '') + '>✓ Đúng giờ</option>' +
          '<option value="late"' + (arc.status === 'late' ? ' selected' : '') + '>▲ Muộn ≤1H</option>' +
          '<option value="vlate"' + (arc.status === 'vlate' ? ' selected' : '') + '>‼ Muộn &gt;1H</option>' +
          (arc.mode === 'day' ? '<option value="miss"' + (arc.status === 'miss' ? ' selected' : '') + '>✕ Chưa check-in / Lỡ</option>' : '') +
          '<option value="photo"' + (arc.status === 'photo' ? ' selected' : '') + '>Có ảnh</option>' +
        '</select>' +
        '<input type="search" class="hub-collab-input" data-arc="q" placeholder="Tìm tên hoặc ghi chú…" aria-label="Tìm trong nhật ký" value="' + esc(arc.q) + '">' +
        (hasFilter ? '<button type="button" class="hub-collab-btn is-ghost" data-act="arc-reset">Xoá lọc</button>' : '') +
      '</div>';

    var body = wMode
      ? arcWeeklyHtml(room, c, w)
      : arc.mode === 'gallery'
        ? arcGalleryHtml(room, c, members, arc)
        : arc.mode === 'month'
          ? arcMonthHtml(room, c, members, arc)
          : arcDayHtml(room, c, members, arc, me, nudgedBy);

    return '<section class="hub-collab-arc">' + bar + (!wMode && arc.mode !== 'month' ? arcCalendarHtml(room, c, arc) : '') + filters + body + '</section>';
  }
  function dialogHtml(room, mine, isOwner, today) {
    var f = S.dlgForm, cfg = room.cfg;
    var hist = (mine.commits || []).slice().reverse().map(function (c) { return '<li><time>từ ' + fmtDay(c.from) + '</time><span>' + commitLine(c) + '</span></li>'; }).join('');
    return '<div class="hub-collab-scrim" data-act="close"></div><div class="hub-collab-dialog" role="dialog" aria-modal="true" aria-labelledby="hc-dlg-title"><div class="hub-collab-dialog-head"><h3 id="hc-dlg-title">Cài đặt phòng</h3>' +
      '<button type="button" class="hub-collab-btn is-ghost" data-act="close" aria-label="Đóng">✕</button></div><div class="hub-collab-form">' +
      '<h4 class="hub-collab-h4">Cam kết của bạn</h4>' +
      field('Cam kết', '<input class="hub-collab-input" data-d="title" maxlength="80" value="' + esc(f.title) + '">') +
      '<div class="hub-collab-row2">' + field('Tần suất', '<select class="hub-collab-input" data-d="freq">' + Object.keys(FREQ).map(function (k) { return '<option value="' + k + '"' + (f.freq === k ? ' selected' : '') + '>' + FREQ[k] + '</option>'; }).join('') + '</select>') +
        field('Trước giờ', '<input type="time" class="hub-collab-input" data-d="target" value="' + esc(f.target) + '">') + '</div>' +
      '<p class="hub-collab-muted">Thay đổi có hiệu lực từ <b>ngày mai</b> (' + fmtDay(addDays(today, 1)) + '); những ngày đã qua giữ nguyên cam kết cũ.</p>' +
      '<button type="button" class="hub-collab-btn is-primary" data-act="save-commit">Lưu cam kết</button>' +
      (hist ? '<ul class="hub-collab-feed hub-collab-feed--hist">' + hist + '</ul>' : '') +
      (isOwner ? '<h4 class="hub-collab-h4">Luật của phòng</h4><div class="hub-collab-row2">' +
        field('Số tim tối đa', '<select class="hub-collab-input" data-d="max">' + HEART_CHOICES.map(function (n) { return '<option value="' + n + '"' + (f.max === n ? ' selected' : '') + '>' + n + ' tim</option>'; }).join('') + '</select>') +
        field('Hồi 1 tim sau', '<select class="hub-collab-input" data-d="regen">' + REGEN_CHOICES.map(function (n) { return '<option value="' + n + '"' + (f.regen === n ? ' selected' : '') + '>' + n + ' ngày liền</option>'; }).join('') + '</select>') + '</div>' +
        field('Mã thử thách mỗi lần chụp', '<select class="hub-collab-input" data-d="chal"><option value="on"' + (f.chal === 'on' ? ' selected' : '') + '>Bật — số ngẫu nhiên được đóng dấu vào ảnh</option><option value="off"' + (f.chal === 'off' ? ' selected' : '') + '>Tắt</option></select>') +
        '<p class="hub-collab-muted">Đổi luật sẽ tính lại tim và streak của cả phòng theo toàn bộ lịch sử.</p><button type="button" class="hub-collab-btn" data-act="save-cfg">Lưu luật</button>' : '') +
      '<h4 class="hub-collab-h4">Duyệt ảnh chéo</h4><p class="hub-collab-muted">Thành viên khác bấm “Hợp lệ” hoặc “Nghi ngờ” trên ảnh check-in trong vòng 72 giờ. Quá nửa người khác nghi ngờ thì check-in bị hủy và tính như lỡ ngày; phòng 2 người thì người còn lại quyết. Ảnh gần như trùng một ảnh cũ sẽ được báo cho cả phòng.</p>' +
      (isOwner
        ? '<h4 class="hub-collab-h4">Rời phòng</h4><p class="hub-collab-muted">Chủ phòng không thể rời phòng. Hãy chuyển quyền cho người khác hoặc xoá phòng trong mục <b>Quản lý</b>.</p>' +
          '<button type="button" class="hub-collab-btn" data-act="dlg" data-dlg="manage">Mở Quản lý phòng</button>'
        : '<h4 class="hub-collab-h4">Rời phòng</h4><button type="button" class="hub-collab-btn is-danger" data-act="leave">Rời phòng này</button>') +
      '</div></div>';
  }

  /* ───────────── quản lý phòng: mã mời, thành viên, thiết lập, xoá ───────────── */
  function roomBanners(room, isOwner) {
    if (!isOwner) return '';
    if (room.deleting) return '<div class="hub-collab-banner is-warn" role="alert">Phòng đang ở trạng thái xoá dở (lần xoá trước bị gián đoạn). <button type="button" class="hub-collab-btn" data-act="resume-delete">Tiếp tục xoá</button></div>';
    var iv = inviteState(room, Date.now());
    if (iv.kind === 'expired' || iv.kind === 'gone') return '<div class="hub-collab-banner is-warn" role="status">Mã mời ' + (iv.kind === 'expired' ? 'đã hết hạn' : 'không còn hiệu lực') + ', chưa ai vào thêm được. <button type="button" class="hub-collab-btn" data-act="dlg" data-dlg="manage">Đổi mã mới</button></div>';
    return '';
  }
  function manageHtml(room, isOwner) {
    var me = S.store.uid, now = Date.now(), f = S.mg || { name: room.name, max: room.maxMembers, expiry: DEFAULT_EXPIRY }, n = room.members.length;
    var iv = inviteState(room, now), cap = room.maxMembers;
    var members = room.members.slice().sort(function (a, b) {
      return (a.uid === room.ownerUid ? -1 : b.uid === room.ownerUid ? 1 : 0) || ((a.joinedAt || 0) - (b.joinedAt || 0)) || (a.name < b.name ? -1 : 1);
    });
    var rows = members.map(function (m) {
      var owner = m.uid === room.ownerUid, isMe = m.uid === me, ini = esc((m.name || '?').charAt(0).toUpperCase());
      return '<li class="hub-collab-mrow"><div class="hub-collab-avatar is-sm" aria-hidden="true" data-i="' + ini + '">' + ini + '</div>' +
        '<div class="hub-collab-mrow-main"><b>' + esc(m.name) + '</b><span class="hub-collab-mrow-tags">' +
          (owner ? '<span class="hub-collab-role is-owner">Chủ phòng</span>' : '') + (isMe ? '<span class="hub-collab-me-tag">bạn</span>' : '') +
          (m.joinedAt ? '<span class="hub-collab-muted">vào ' + fmtDay(ymd(new Date(m.joinedAt))) + '</span>' : '') + '</span></div>' +
        (isOwner && !isMe ? '<div class="hub-collab-mrow-act"><button type="button" class="hub-collab-btn" data-act="ask-transfer" data-uid="' + esc(m.uid) + '">Chuyển chủ phòng</button>' +
          '<button type="button" class="hub-collab-btn is-danger" data-act="ask-kick" data-uid="' + esc(m.uid) + '">Mời ra</button></div>' : '') + '</li>';
    }).join('');
    var expSel = '<select class="hub-collab-input" data-m="expiry">' + EXPIRY.map(function (e) { return '<option value="' + e[0] + '"' + (f.expiry === e[0] ? ' selected' : '') + '>' + e[1] + '</option>'; }).join('') + '</select>';
    var ownerCtl = isOwner
      ? '<div class="hub-collab-row2 hub-collab-invctl">' + field('Hiệu lực của mã', expSel) +
          '<div class="hub-collab-invbtns"><button type="button" class="hub-collab-btn" data-act="inv-expiry">Áp dụng cho mã này</button><button type="button" class="hub-collab-btn" data-act="inv-regen">Đổi mã mới</button></div></div>' +
        '<div class="hub-collab-switch"><div><b>' + (room.joinOpen ? 'Đang mở cho người mới' : 'Đang khoá') + '</b><span class="hub-collab-muted">' +
          (room.joinOpen ? 'Ai có mã còn hạn đều vào được, tối đa ' + cap + ' người.' : 'Không ai vào được bằng mã, kể cả mã còn hạn.') + '</span></div>' +
          '<button type="button" class="hub-collab-btn" data-act="inv-lock">' + (room.joinOpen ? 'Khoá phòng' : 'Mở lại') + '</button></div>'
      : '';
    var info = isOwner
      ? '<h4 class="hub-collab-h4">Thiết lập phòng</h4><div class="hub-collab-row2">' +
          field('Tên phòng', '<input class="hub-collab-input" data-m="name" maxlength="40" value="' + esc(f.name) + '">') +
          field('Số người tối đa', '<select class="hub-collab-input" data-m="max">' + MAX_CHOICES.filter(function (x) { return x >= n; }).map(function (x) { return '<option value="' + x + '"' + (f.max === x ? ' selected' : '') + '>' + x + ' người</option>'; }).join('') + '</select>') + '</div>' +
          '<button type="button" class="hub-collab-btn" data-act="save-info">Lưu thiết lập</button>'
      : '';
    var danger = isOwner
      ? '<h4 class="hub-collab-h4">Vùng nguy hiểm</h4><div class="hub-collab-danger"><p class="hub-collab-muted">Chủ phòng không thể rời phòng: hãy chuyển quyền cho người khác, hoặc xoá hẳn phòng (mọi check-in và ảnh sẽ mất).</p>' +
        '<button type="button" class="hub-collab-btn is-danger" data-act="ask-delete">Xoá phòng…</button></div>'
      : '';
    return '<div class="hub-collab-scrim" data-act="close"></div><div class="hub-collab-dialog hub-collab-dialog--wide" role="dialog" aria-modal="true" aria-labelledby="hc-dlg-title" tabindex="-1">' +
      '<div class="hub-collab-dialog-head"><h3 id="hc-dlg-title">' + (isOwner ? 'Quản lý phòng' : 'Thành viên &amp; mã mời') + '</h3>' +
        '<button type="button" class="hub-collab-btn is-ghost" data-act="close" aria-label="Đóng">✕</button></div><div class="hub-collab-form">' +
      '<h4 class="hub-collab-h4">Mã mời</h4><div class="hub-collab-invite"><div class="hub-collab-invite-code"><code>' + esc(room.code) + '</code>' +
        '<button type="button" class="hub-collab-btn" data-act="copy">Chép mã</button></div>' +
        '<p class="hub-collab-invstate is-' + iv.kind + '" data-icon="' + esc(iv.icon) + '">' + esc(iv.text) + '</p>' + ownerCtl + '</div>' +
      '<h4 class="hub-collab-h4">Thành viên · ' + n + ' / ' + cap + '</h4><ul class="hub-collab-mlist">' + rows + '</ul>' +
      info + danger + '</div></div>';
  }
  function confirmReady() { var c = S.confirm; return !!c && (!c.need || String(c.typed || '').trim().toLowerCase() === String(c.need).trim().toLowerCase()); }
  function confirmHtml() {
    var c = S.confirm;
    return '<div class="hub-collab-scrim" data-act="close"></div><div class="hub-collab-dialog hub-collab-dialog--confirm" role="alertdialog" aria-modal="true" aria-labelledby="hc-dlg-title" aria-describedby="hc-dlg-body" tabindex="-1">' +
      '<div class="hub-collab-dialog-head"><h3 id="hc-dlg-title">' + esc(c.title) + '</h3></div><div class="hub-collab-form">' +
      '<p class="hub-collab-confirm-body" id="hc-dlg-body">' + c.body + '</p>' +
      (c.need ? field('Gõ “' + esc(c.need) + '” để xác nhận', '<input class="hub-collab-input" data-x="typed" autocomplete="off" value="' + esc(c.typed || '') + '">') : '') +
      (c.opt ? '<label class="hub-collab-opt"><input type="checkbox" data-x="opt"' + (c.opt.checked ? ' checked' : '') + '><span>' + esc(c.opt.label) + '</span></label>' : '') +
      '<div class="hub-collab-camacts"><button type="button" class="hub-collab-btn" data-act="close"' + (c.busy ? ' disabled' : '') + '>Huỷ</button>' +
        '<button type="button" class="hub-collab-btn ' + (c.danger ? 'is-danger' : 'is-primary') + '" data-act="confirm-ok"' + (c.busy || !confirmReady() ? ' disabled' : '') + '>' +
          esc(c.busy ? (c.progress ? 'Đang xoá… ' + c.progress : 'Đang xử lý…') : c.ok) + '</button></div></div></div>';
  }

  /* ───────────── ảnh check-in ───────────── */
  function thumbHtml(uid, date, name, cls, plist, it) {
    var b = badgeOf(it);
    return '<button type="button" class="hub-collab-thumb ' + cls + (b ? ' has-' + b.k : '') + '" data-act="photo"' + (plist ? ' data-plist="' + esc(plist) + '"' : '') + ' data-uid="' + esc(uid) + '" data-date="' + esc(date) + '" data-name="' + esc(name) + '" aria-label="Xem ảnh check-in của ' + esc(name) + (b ? ' — ' + b.t : '') + '">' +
      '<img alt="" data-ph="' + esc(uid) + '|' + esc(date) + '">' + (b ? '<i class="hub-collab-thumb-badge is-' + b.k + '" aria-hidden="true">' + b.g + '</i>' : '') + '</button>';
  }
  function cameraHtml(room) {
    var c = S.cam, body, acts, actsCls = '', chal = '', warn = '', info = c.ch ? chInfo(c.ch) : null, hud = '';
    if (info && !c.shot) {
      var rem = c.chExp ? Math.max(0, c.chExp - Date.now()) : CHAL_MS;
      var pct = Math.max(0, Math.min(100, Math.round(rem / CHAL_MS * 100)));
      var swLbl = info.kind === 'paper' ? '↻ Đổi sang giơ ngón tay' : '↻ Đổi sang viết giấy';
      chal = '<div class="hub-collab-chal" role="note">' +
        '<div class="hub-collab-chal-top">' +
          '<b class="hub-collab-chal-num" aria-label="Mã thử thách ' + esc(info.num) + '">' + esc(info.num) + '<small>' + esc(info.short) + '</small></b>' +
          '<div class="hub-collab-chal-body">' +
            '<div class="hub-collab-chal-head"><span class="hub-collab-chal-k">' + esc(info.icon) + ' Mã thử thách</span>' +
              '<span class="hub-collab-chal-timer' + (rem <= 20000 ? ' is-low' : '') + '" data-hc-chleft>' + fmtClockSec(rem) + '</span>' +
              '<button type="button" class="hub-collab-btn is-ghost hub-collab-chal-sw" data-act="ch-switch">' + swLbl + '</button></div>' +
            '<p class="hub-collab-muted">' + esc(info.how) + ' Tem gọn được đóng ở góc trên trái ảnh.</p>' +
          '</div>' +
        '</div>' +
        '<span class="hub-collab-chal-track" aria-hidden="true"><i data-hc-chbar style="width:' + pct + '%"></i></span></div>';
    }
    if (c.shot) {
      if (c.dup) {
        var o = room.members.filter(function (m) { return m.uid === c.dup.uid; })[0];
        warn = '<p class="hub-collab-warn"><b>≈ Ảnh này gần như trùng</b> ảnh ngày ' + fmtDay(c.dup.date) + ' ' + (c.dup.uid === S.store.uid ? 'của bạn' : 'của ' + esc(o ? o.name : 'một thành viên')) + '. Nếu gửi, cả phòng sẽ thấy cảnh báo ảnh trùng — nên chụp ảnh mới.</p>';
      }
      body = '<img class="hub-collab-shot" alt="Ảnh vừa chụp" src="' + c.shot + '">';
      acts = '<input class="hub-collab-input" data-c="note" maxlength="120" placeholder="Ghi chú nhanh (tuỳ chọn)…" aria-label="Ghi chú" value="' + esc(c.note) + '">' +
        '<div class="hub-collab-camacts"><button type="button" class="hub-collab-btn" data-act="retake"' + (c.sending ? ' disabled' : '') + '>Chụp lại</button>' +
        '<button type="button" class="hub-collab-btn is-primary" data-act="sendshot"' + (c.sending ? ' disabled' : '') + '>' + (c.sending ? 'Đang gửi…' : 'Gửi &amp; check-in') + '</button></div>';
    } else if (c.err) {
      body = '<p class="hub-collab-cam-err">' + esc(c.err) + '</p>';
      acts = '<div class="hub-collab-camacts"><label class="hub-collab-btn is-primary">Mở camera của máy<input type="file" accept="image/*" capture="environment" id="hc-file" hidden></label>' +
        '<button type="button" class="hub-collab-btn" data-act="flip">Thử lại</button></div>';
    } else {
      if (info) hud = '<div class="hub-collab-camhud" aria-hidden="true"><span>' + esc(info.icon) + '</span><b>' + esc(info.hud) + '</b></div>';
      body = '<video id="hc-video" playsinline autoplay muted></video>' + hud + '<div class="hub-collab-cd" id="hc-cd" aria-live="assertive" hidden></div>';
      actsCls = ' is-live';
      acts = '<div class="hub-collab-camacts' + actsCls + '"><button type="button" class="hub-collab-btn" data-act="flip">Đổi camera</button>' +
        '<button type="button" class="hub-collab-btn hub-collab-timerbtn" data-act="timer3s" aria-pressed="' + (!!c.timer3s) + '" title="Hẹn giờ chụp 3 giây">⏱ 3s</button>' +
        '<button type="button" class="hub-collab-btn is-primary hub-collab-shoot" data-act="shoot">Chụp</button></div>';
    }
    return '<div class="hub-collab-scrim" data-act="close"></div><div class="hub-collab-dialog hub-collab-dialog--cam" role="dialog" aria-modal="true" aria-labelledby="hc-dlg-title">' +
      '<div class="hub-collab-dialog-head"><h3 id="hc-dlg-title">Ảnh check-in</h3><button type="button" class="hub-collab-btn is-ghost" data-act="close" aria-label="Đóng">✕</button></div>' +
      chal + '<div class="hub-collab-cam' + (c.shot ? ' is-photo' : (c.facing === 'user' ? ' is-mirror' : '')) + '">' + body + '</div>' + warn + acts +
      '<p class="hub-collab-muted">Ảnh giữ nguyên khung hình, đóng dấu giờ + tên' + (info ? ' + tem thử thách' : '') + '. Chỉ chụp trực tiếp, thành viên khác sẽ duyệt trong 72 giờ.</p></div>';
  }
  function photoHtml(room, c, me) {
    var v = S.photoView, it = v && c.by[v.uid + '|' + v.date], ci = v && room.checkins[v.uid] && room.checkins[v.uid][v.date], own = !!v && v.uid === me, now = Date.now(), x = '';
    var m = v && memberByUid(v.uid), cm = v && m ? (commitAt(m, v.date) || curCommit(m, v.date)) : null;
    var li = ci ? lateInfo(ci, cm, v.date, room.cfg.cutoff) : null, voided = !!(it && it.j.voided);
    var list = S.photoList || [], idx = -1;
    if (v && list.length > 1) {
      for (var i = 0; i < list.length; i++) if (list[i].uid === v.uid && list[i].date === v.date) { idx = i; break; }
    }
    var navHtml = idx > -1
      ? '<div class="hub-collab-photo-nav">' +
          '<button type="button" class="hub-collab-btn" data-act="photo-nav" data-dir="-1" aria-label="Ảnh trước">‹ Trước</button>' +
          '<span class="hub-collab-muted">' + (idx + 1) + ' / ' + list.length + '</span>' +
          '<button type="button" class="hub-collab-btn" data-act="photo-nav" data-dir="1" aria-label="Ảnh sau">Sau ›</button>' +
        '</div>'
      : '';
    var metaHtml = '<div class="hub-collab-photo-meta">' +
      (voided ? '<span class="hub-collab-status is-void">Bị hủy — tính như lỡ ngày</span>'
        : (li ? '<span class="hub-collab-status ' + lateCls(li) + '">' + lateIcon(li) + ' ' + (li.label ? esc(li.label) : 'Đúng giờ') + '</span>' : '')) +
      (cm && cm.target ? '<span class="hub-collab-muted">mục tiêu ' + esc(cm.target) + '</span>' : '') +
      '<button type="button" class="hub-collab-btn" data-act="photo-dl">Tải ảnh</button>' +
    '</div>';
    if (it) {
      var j = it.j, info = chInfo(it.ch);
      if (info) {
        x += '<div class="hub-collab-chverify">' +
          '<span class="hub-collab-chverify-code"><i aria-hidden="true">' + esc(info.icon) + '</i><b>' + esc(info.badge) + '</b><small>' + esc(info.short) + '</small></span>' +
          '<div class="hub-collab-chverify-txt"><b>Đối chiếu mã thử thách</b><span>' + esc(info.check.charAt(0).toUpperCase() + info.check.slice(1)) + ' — khớp với tem góc trên trái ảnh.</span></div></div>';
      } else if (room.cfg.challenge && j.open) {
        x += '<div class="hub-collab-chverify is-missing" role="note">' +
          '<span class="hub-collab-chverify-code"><b>!</b><small>thiếu mã</small></span>' +
          '<div class="hub-collab-chverify-txt"><b>Không kèm mã thử thách</b><span>Phòng đang bật thử thách nhưng ảnh này không có mã đối chiếu.</span></div></div>';
      }
      if (it.dup) x += dupHtml(room, it, me);
      x += tallyHtml(room, it, me, now);
      if (!own && j.open && j.n) {
        var mv = j.votes[me], nx = pendingReviews(c, me).filter(function (q) { return !(q.uid === v.uid && q.date === v.date); })[0];
        x += '<div class="hub-collab-vote" role="group" aria-label="Duyệt ảnh">' + ['ok', 'sus'].map(function (k) {
          return '<button type="button" class="hub-collab-btn is-' + k + '" data-act="vote" data-v="' + k + '" aria-pressed="' + (mv === k) + '"' + (S.voting ? ' disabled' : '') + '>' + (k === 'ok' ? '✓ ' : '! ') + VOTE_TEXT[k] + '</button>';
        }).join('') + '</div>' + (nx ? '<button type="button" class="hub-collab-btn is-ghost hub-collab-next"' + photoBtnAttrs(nx) + '>Ảnh tiếp theo ›</button>' : '');
      } else if (own) x += '<p class="hub-collab-muted">Đây là ảnh của bạn — các thành viên khác sẽ duyệt.</p>';
    }
    return '<div class="hub-collab-scrim" data-act="close"></div><div class="hub-collab-dialog hub-collab-dialog--photo" role="dialog" aria-modal="true" aria-labelledby="hc-dlg-title">' +
      '<div class="hub-collab-dialog-head"><h3 id="hc-dlg-title">' + esc(v ? v.name : '') + (ci ? ' · ' + fmtTime(ci.at) + ' · ' + fmtDay(v.date) : '') + '</h3><button type="button" class="hub-collab-btn is-ghost" data-act="close" aria-label="Đóng">✕</button></div>' +
      metaHtml +
      '<div class="hub-collab-cam is-photo"><img class="hub-collab-shot' + (voided ? ' is-void' : '') + '" alt="Ảnh check-in" data-ph="' + esc(v ? v.uid : '') + '|' + esc(v ? v.date : '') + '"></div>' +
      (ci && ci.note ? '<p class="hub-collab-muted">“' + esc(ci.note) + '”</p>' : '') +
      x + navHtml + '</div>';
  }

  /* ───────────── điều khiển ───────────── */
  function pickStore() {
    try { if (hasFirebase() && firebase.auth().currentUser) return CloudStore(); } catch (e) {}
    return null;                                   // chưa đăng nhập → hiện cổng đăng nhập
  }
  function nowDay() { return dayKey(Date.now(), DEFAULT_CFG.cutoff); }
  function focusKey(el) {                                              // nhận diện phần tử đang focus để trả focus lại sau khi vẽ lại (bấm Hợp lệ → giao diện render lại)
    if (!el || !S || !S.root || el === S.root || !S.root.contains(el)) return '';
    if (el.id) return '#' + el.id;
    var sel = '';
    ['data-act', 'data-v', 'data-uid', 'data-date', 'data-d', 'data-m', 'data-x', 'data-c', 'data-f', 'data-arc', 'data-id'].forEach(function (n) { var x = el.getAttribute && el.getAttribute(n); if (x != null) sel += '[' + n + '="' + String(x).replace(/"/g, '\\"') + '"]'; });
    return sel;
  }
  function paint() {
    if (!S || !S.root) return;
    var v = S.root.querySelector('#hc-view'); if (!v) return;
    var ae = document.activeElement, keep = null, pos = null, fk = focusKey(ae);     // giữ con trỏ / nút đang focus khi dữ liệu realtime vẽ lại
    if (ae && ae.getAttribute && v.contains(ae)) ['data-f', 'data-d', 'data-m', 'data-x', 'data-c', 'data-arc'].forEach(function (a) { if (!keep && ae.getAttribute(a)) { keep = '[' + a + '="' + ae.getAttribute(a) + '"]'; pos = ae.selectionStart; } });
    v.innerHTML = S.view === 'room' ? (S.room ? viewRoom() : '<p class="hub-collab-muted hub-collab-loading">Đang mở phòng…</p>') : viewLobby();
    if (keep) { var k2 = v.querySelector(keep); if (k2) { k2.focus({ preventScroll: true }); try { if (pos != null) k2.setSelectionRange(pos, pos); } catch (e) {} } }
    else if (fk) { try { var back = v.querySelector(fk); if (back && back !== document.activeElement) back.focus({ preventScroll: true }); } catch (e) {} }
    if (S.dlg) {
      var dl = v.querySelector('.hub-collab-dialog');
      if (dl && !S._dlgFocused) {
        var tg = dl.querySelector(S.dlg === 'settings' ? '[data-d="title"]' : '[data-x="typed"]') || (S.dlg === 'manage' || S.dlg === 'confirm' ? dl : null);
        if (tg && tg.focus) { tg.focus({ preventScroll: true }); S._dlgFocused = true; }
      }
      if (dl && !dl.contains(document.activeElement)) { dl.setAttribute('tabindex', '-1'); dl.focus({ preventScroll: true }); }   // để Esc luôn đóng được hộp thoại
    }
    hydratePhotos();
    if (S.dlg === 'camera') { attachCamera(); if (S.cam && S.cam.ch && !S.cam.shot && !S.cam.chT) startChalTimer(); }
    emitStatus();
  }
  /** Báo trạng thái phòng cho thanh trên cùng của trang (streak rail trong index.html). Không có người nghe thì vô hại. */
  function emitStatus(clear) {
    try {
      var d = null;
      if (!clear && S && S.store) {
        d = { mode: S.store.mode, view: S.view };
        if (S.view === 'room' && S.room && S.calc) {
          var st = S.calc.states[S.store.uid], g = S.calc.group;
          d.room = S.room.name; d.group = g.cur; d.n = g.n; d.total = g.total; d.all = g.all;
          if (st) { d.hearts = st.hearts; d.max = st.max; d.streak = st.streak; d.todayOn = st.todayOn; d.todayDone = st.todayDone; }
        }
      }
      document.dispatchEvent(new CustomEvent('collab:status', { detail: d }));
    } catch (e) {}
  }
  function loadRooms() {
    S.rooms = null; paint();
    S.store.listRooms().then(function (r) { S.rooms = r; paint(); }).catch(function (e) { S.rooms = []; paint(); toast(errMsg(e)); });
  }
  function recompute() { S.calc = S.room ? computeRoom(S.room, Date.now()) : null; if (S.calc) S.lastDay = S.calc.today; }
  function watchRoom() {
    if (S.unwatch) { S.unwatch(); S.unwatch = null; }
    S.unwatch = S.store.watch(S.roomId, function (room, err) {
      if (err) {
        if (err.code === 'not-found' || err.code === 'deleting' || err.code === 'permission-denied') {      // phòng đã xoá, hoặc mình đã bị mời ra
          if (S.store.forget) S.store.forget(S.roomId);
          toast(err.code === 'deleting' ? 'Chủ phòng đã xoá phòng này.' : err.code === 'not-found' ? 'Phòng không còn tồn tại.' : 'Bạn không còn trong phòng này (đã bị mời ra, hoặc phòng đã bị xoá).');
        } else toast(errMsg(err));
        closeRoom(); return;
      }
      S.room = room; recompute(); paint();
    });
  }
  function openRoom(id) { S.view = 'room'; S.roomId = id; S.room = null; S.calc = null; S.voting = false; S.roomTab = 'today'; S.arc = null; S.photoList = null; S.dlg = ''; S._dlgFocused = false; paint(); watchRoom(); }
  function closeRoom() {
    if (S.unwatch) { S.unwatch(); S.unwatch = null; }
    S.view = 'lobby'; S.room = null; S.calc = null; S.voting = false; S.dlg = ''; S._dlgFocused = false; loadRooms();
  }
  function init() {
    if (S.unwatch) { S.unwatch(); S.unwatch = null; }
    stopCamera(); S.cam = null;
    S.store = pickStore(); S.view = 'lobby'; S.room = null; S.calc = null; S.dlg = ''; S.rooms = null;
    if (!S.store) { S.rooms = []; paint(); return; }
    loadRooms();
  }
  function tick() {
    if (!S || !S.root) return;
    if (S.store && S.store.poke) S.store.poke();
    if (S.view !== 'room' || !S.room) return;
    var d = dayKey(Date.now(), S.room.cfg.cutoff);
    if (d !== S.lastDay) { recompute(); watchRoom(); paint(); return; }              // qua giờ chốt ngày
    var now = Date.now(), n;
    if ((n = S.root.querySelector('[data-hc-clock]'))) n.textContent = fmtTime(now);
    if ((n = S.root.querySelector('[data-hc-left]'))) n.textContent = 'Còn ' + leftText(+n.getAttribute('data-end') - now) + ' đến giờ chốt ngày (' + pad(S.room.cfg.cutoff) + ':00)';
    if ((n = S.root.querySelector('[data-act="undo"]')) && now > +n.getAttribute('data-until')) n.remove();
  }
  function profFromForm() {
    var f = S.form;
    return { name: f.name.trim(), title: f.title.trim(), freq: f.freq === 'weekdays' ? 'weekdays' : 'daily', target: /^\d\d:\d\d$/.test(f.target) ? f.target : '' };
  }
  function saveForm() { try { localStorage.setItem(FORM_KEY, JSON.stringify({ name: S.form.name, title: S.form.title, freq: S.form.freq, target: S.form.target })); } catch (e) {} }
  function guard(p) { return p.catch(function (e) { toast(errMsg(e)); }); }
  /** Chạy một thao tác quản lý: báo lỗi nếu thất bại, báo thành công CHỈ khi thật sự thành công. */
  function doAct(p, okMsg) { return p.then(function (v) { if (okMsg) toast(okMsg); return v; }, function (e) { toast(errMsg(e)); }); }
  function askConfirm(o) {
    S.confirm = { title: o.title, body: o.body, ok: o.ok, danger: !!o.danger, need: o.need || '', typed: '', opt: o.opt || null, run: o.run, back: o.back == null ? 'manage' : o.back, busy: false, progress: '' };
    S.dlg = 'confirm'; S._dlgFocused = false; paint();
  }
  function memberByUid(uid) { return S.room && S.room.members.filter(function (m) { return m.uid === uid; })[0]; }
  function deleteRun() {
    return S.store.deleteRoom(S.roomId, function (n, t) {
      if (!S || !S.confirm) return;
      S.confirm.progress = n + '/' + t;
      var b = S.root && S.root.querySelector('[data-act="confirm-ok"]'); if (b) b.textContent = 'Đang xoá… ' + S.confirm.progress;
    }).then(function () { return { msg: 'Đã xoá phòng.', leave: true }; });
  }
  function mineNow() { return S.room && S.room.members.filter(function (m) { return m.uid === S.store.uid; })[0]; }

  /* ───────────── camera + ảnh ───────────── */
  function stopCamTimers() {
    if (!S || !S.cam) return;
    if (S.cam.cdT) { clearInterval(S.cam.cdT); S.cam.cdT = null; }
    if (S.cam.chT) { clearInterval(S.cam.chT); S.cam.chT = null; }
    S.cam.cd = 0;
  }
  function stopCamera() { stopCamTimers(); if (S && S.cam && S.cam.stream) { S.cam.stream.getTracks().forEach(function (t) { t.stop(); }); S.cam.stream = null; } }
  function startChalTimer() {
    if (!S || !S.cam || !S.cam.ch || S.cam.shot) return;
    if (S.cam.chT) { clearInterval(S.cam.chT); S.cam.chT = null; }
    S.cam.chT = setInterval(function () {
      if (!S || !S.cam || S.cam.shot || S.dlg !== 'camera') { if (S && S.cam && S.cam.chT) { clearInterval(S.cam.chT); S.cam.chT = null; } return; }
      var rem = Math.max(0, (S.cam.chExp || 0) - Date.now());
      var tEl = S.root && S.root.querySelector('[data-hc-chleft]');
      var bEl = S.root && S.root.querySelector('[data-hc-chbar]');
      if (tEl) { tEl.textContent = fmtClockSec(rem); tEl.classList.toggle('is-low', rem <= 20000); }
      if (bEl) bEl.style.width = (rem / CHAL_MS * 100).toFixed(1) + '%';
      if (rem <= 0 && !S.cam.cd) {
        S.cam.ch = newChallenge(); S.cam.chExp = Date.now() + CHAL_MS;
        paint(); toast('Mã thử thách đã làm mới.');
      }
    }, 500);
  }
  function captureNow() {
    var v = S && S.root && S.root.querySelector('#hc-video');
    if (!v || !v.videoWidth) { toast('Camera chưa sẵn sàng, đợi một chút nhé.'); return false; }
    setShot(stampAndEncode(v, v.videoWidth, v.videoHeight, S.cam.ch)); stopCamera(); paint();
    return true;
  }
  function startCamera() {
    var c = S.cam; if (!c) return;
    stopCamera(); c.err = '';
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      c.err = 'Thiết bị/trình duyệt này không mở được camera trực tiếp (cần https). Dùng nút bên dưới để mở camera của máy.'; paint(); return;
    }
    navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: c.facing }, width: { ideal: 1280 }, height: { ideal: 960 } }, audio: false }).then(function (stream) {
      if (!S || !S.cam) { stream.getTracks().forEach(function (t) { t.stop(); }); return; }
      S.cam.stream = stream; attachCamera();
    }, function (e) {
      if (!S || !S.cam) return;
      S.cam.err = e && e.name === 'NotAllowedError' ? 'Bạn chưa cấp quyền camera cho trang này (bấm biểu tượng ổ khoá trên thanh địa chỉ để cấp).' : 'Không mở được camera trên thiết bị này.';
      paint();
    });
  }
  function attachCamera() {
    var v = S && S.root && S.root.querySelector('#hc-video');
    if (v && S.cam && S.cam.stream && v.srcObject !== S.cam.stream) { v.srcObject = S.cam.stream; var p = v.play(); if (p && p.catch) p.catch(function () {}); }
  }
  /** Dấu vân tay hình ảnh: dHash 16×16 (256 bit) của khung hình và của bản LẬT NGANG → so được ảnh trùng kể cả khi bị lật.
      Lỗi (hiếm) → rỗng: chỉ mất tính năng báo trùng cho ảnh đó. */
  function hashPair(cv) {
    try {
      var W = 17, H = 16, t = document.createElement('canvas'); t.width = 34; t.height = 32;
      var tx = t.getContext('2d'); tx.imageSmoothingQuality = 'high'; tx.drawImage(cv, 0, 0, 34, 32);
      var s2 = document.createElement('canvas'); s2.width = W; s2.height = H;
      var sx = s2.getContext('2d', { willReadFrequently: true }); sx.imageSmoothingQuality = 'high'; sx.drawImage(t, 0, 0, W, H);
      var px = sx.getImageData(0, 0, W, H).data, g = [], r, c;
      for (r = 0; r < H; r++) { g[r] = []; for (c = 0; c < W; c++) { var i = (r * W + c) * 4; g[r][c] = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2]; } }
      var bits = function (flip) {
        var out = '', n = 0, v = 0;
        for (r = 0; r < H; r++) for (c = 0; c < 16; c++) { v = (v << 1) | ((flip ? g[r][16 - c] > g[r][15 - c] : g[r][c] > g[r][c + 1]) ? 1 : 0); if (++n === 4) { out += v.toString(16); n = 0; v = 0; } }
        return out;
      };
      return { ph: bits(false), pm: bits(true) };
    } catch (e) { return { ph: '', pm: '' }; }
  }
  function roundRectPath(ctx, rx, ry, rw, rh, rad) {
    var r = Math.min(rad, rw / 2, rh / 2);
    ctx.beginPath();
    ctx.moveTo(rx + r, ry);
    ctx.lineTo(rx + rw - r, ry);
    ctx.quadraticCurveTo(rx + rw, ry, rx + rw, ry + r);
    ctx.lineTo(rx + rw, ry + rh - r);
    ctx.quadraticCurveTo(rx + rw, ry + rh, rx + rw - r, ry + rh);
    ctx.lineTo(rx + r, ry + rh);
    ctx.quadraticCurveTo(rx, ry + rh, rx, ry + rh - r);
    ctx.lineTo(rx, ry + r);
    ctx.quadraticCurveTo(rx, ry, rx + r, ry);
    ctx.closePath();
  }
  /** Vẽ khung hình lên canvas ≤720px, băm vân tay, đóng dấu giờ + ngày + tên (+ tem thử thách gọn chuẩn safe-area), nén JPEG cho vừa Firestore (≲ 220KB). */
  function stampAndEncode(src, w, h, chId) {
    var k = Math.min(1, 720 / Math.max(w, h)), cw = Math.round(w * k), ch = Math.round(h * k);
    var cv = document.createElement('canvas'); cv.width = cw; cv.height = ch;
    var x = cv.getContext('2d'); x.drawImage(src, 0, 0, cw, ch);
    var hp = hashPair(cv);                                              // băm TRƯỚC khi đóng dấu → dấu giờ / mã không làm lệch vân tay
    var base = Math.min(cw, ch), padX = Math.max(10, Math.round(cw * 0.032)), padY = Math.max(10, Math.round(ch * 0.032));
    var m = mineNow(), d = new Date(), nowMs = d.getTime(), fs = Math.max(10, Math.min(15, Math.round(base * 0.034)));
    var cm = m && S.room && S.calc ? curCommit(m, S.calc.today) : null;
    var li = cm && S.room ? lateInfo({ at: nowMs, late: false }, cm, S.calc.today, S.room.cfg.cutoff) : null;
    var tag = cm && cm.target && li
      ? (li.tier === 'vlate' ? '‼ ' + li.label.toUpperCase() : li.tier === 'late' ? '▲ ' + li.label.toUpperCase() : '✓ ĐÚNG GIỜ')
      : '';
    var label = pad(d.getHours()) + ':' + pad(d.getMinutes()) + ' · ' + pad(d.getDate()) + '/' + pad(d.getMonth() + 1) + '/' + d.getFullYear() + ' · ' + (m ? m.name : '');
    var padInX = Math.max(8, Math.round(fs * 0.72)), padInY = Math.max(5, Math.round(fs * 0.42)), maxBarW = cw - padX * 2;
    x.font = '600 ' + fs + 'px ui-monospace, Menlo, Consolas, monospace';
    var tw = x.measureText(label).width, tagW = tag ? x.measureText('  ' + tag).width : 0;
    if (tw + tagW + padInX * 2 > maxBarW) {
      fs = Math.max(9, Math.floor(fs * (maxBarW - padInX * 2) / Math.max(1, tw + tagW)));
      padInX = Math.max(7, Math.round(fs * 0.72)); padInY = Math.max(4, Math.round(fs * 0.42));
      x.font = '600 ' + fs + 'px ui-monospace, Menlo, Consolas, monospace';
      tw = x.measureText(label).width; tagW = tag ? x.measureText('  ' + tag).width : 0;
    }
    var barW = Math.min(maxBarW, Math.ceil(tw + tagW + padInX * 2)), barH = fs + padInY * 2;
    var bx = padX, by = ch - padY - barH;
    roundRectPath(x, bx, by, barW, barH, Math.min(7, barH / 3));
    x.fillStyle = 'rgba(8, 12, 20, 0.74)'; x.fill();
    x.lineWidth = 1; x.strokeStyle = 'rgba(255, 255, 255, 0.16)'; x.stroke();
    x.fillStyle = '#fff'; x.textBaseline = 'middle';
    x.fillText(label, bx + padInX, by + barH / 2);
    if (tag) {
      x.fillStyle = li.tier === 'vlate' ? '#ff4d6d' : li.tier === 'late' ? '#ffb347' : '#2ee59d';
      x.fillText('  ' + tag, bx + padInX + tw, by + barH / 2);
    }
    var info = chInfo(chId);
    if (info) {                                                        // tem thử thách gọn sắc nét ở góc trên trái (luôn nằm trọn trong safe-area)
      var fsSub = Math.max(8, Math.min(10, Math.round(base * 0.022))), fsMain = Math.max(15, Math.min(22, Math.round(base * 0.048)));
      var accW = 4, bPadX = Math.max(9, Math.round(fsMain * 0.52)), bPadY = Math.max(6, Math.round(fsMain * 0.34)), lineGap = Math.max(2, Math.round(fsMain * 0.14));
      x.font = '700 ' + fsSub + 'px ui-monospace, Menlo, Consolas, monospace';
      var subW = x.measureText('THỬ THÁCH').width;
      x.font = '800 ' + fsMain + 'px ui-monospace, Menlo, Consolas, monospace';
      var mainW = x.measureText(info.badge).width;
      var innerW = accW + bPadX * 2 + Math.max(subW, mainW);
      if (innerW > maxBarW) {
        var sc = (maxBarW - accW - bPadX * 2) / Math.max(1, Math.max(subW, mainW));
        fsMain = Math.max(12, Math.floor(fsMain * sc)); fsSub = Math.max(7, Math.floor(fsSub * sc));
        x.font = '700 ' + fsSub + 'px ui-monospace, Menlo, Consolas, monospace'; subW = x.measureText('THỬ THÁCH').width;
        x.font = '800 ' + fsMain + 'px ui-monospace, Menlo, Consolas, monospace'; mainW = x.measureText(info.badge).width;
        innerW = Math.min(maxBarW, accW + bPadX * 2 + Math.ceil(Math.max(subW, mainW)));
      }
      var boxW = Math.ceil(innerW), boxH = bPadY * 2 + fsSub + lineGap + fsMain;
      roundRectPath(x, padX, padY, boxW, boxH, 7);
      x.fillStyle = 'rgba(8, 12, 20, 0.80)'; x.fill();
      x.lineWidth = 1.2; x.strokeStyle = 'rgba(255, 216, 77, 0.72)'; x.stroke();
      x.save();
      roundRectPath(x, padX, padY, boxW, boxH, 7);
      x.clip();
      x.fillStyle = '#ffd84d'; x.fillRect(padX, padY, accW, boxH);
      x.restore();
      x.textBaseline = 'top';
      x.font = '700 ' + fsSub + 'px ui-monospace, Menlo, Consolas, monospace';
      x.fillStyle = 'rgba(255, 216, 77, 0.85)'; x.fillText('THỬ THÁCH', padX + accW + bPadX * 0.8, padY + bPadY);
      x.font = '800 ' + fsMain + 'px ui-monospace, Menlo, Consolas, monospace';
      x.fillStyle = '#ffd84d'; x.fillText(info.badge, padX + accW + bPadX * 0.8, padY + bPadY + fsSub + lineGap);
      x.textBaseline = 'middle';
    }
    var q = 0.72, url = cv.toDataURL('image/jpeg', q);
    while (url.length > 300000 && q > 0.45) { q -= 0.07; url = cv.toDataURL('image/jpeg', q); }
    if (url.length > 300000) {                                         // hiếm: ảnh quá nhiều chi tiết → thu nhỏ thêm
      var c2 = document.createElement('canvas'); c2.width = Math.round(cw * 0.75); c2.height = Math.round(ch * 0.75);
      c2.getContext('2d').drawImage(cv, 0, 0, c2.width, c2.height); url = c2.toDataURL('image/jpeg', 0.6);
    }
    return { url: url, ph: hp.ph, pm: hp.pm };
  }
  function setShot(r) {                                                // ảnh vừa chụp → dừng đồng hồ + kiểm tra trùng NGAY, trước khi gửi
    stopCamTimers();
    S.cam.shot = r.url; S.cam.ph = r.ph; S.cam.pm = r.pm; S.cam.err = '';
    S.cam.dup = S.room ? dupAgainst(S.room, r.ph, r.pm) : null;
  }
  function useFile(file) {                                              // dự phòng khi không mở được camera trực tiếp (nút "Mở camera của máy")
    if (S.room && S.room.cfg.challenge && file.lastModified && Date.now() - file.lastModified > 10 * 60 * 1000) {      // ảnh cũ trong thư viện thì không được dùng
      toast('Phòng đang bật mã thử thách: không dùng ảnh có sẵn trên máy — hãy chụp ảnh mới.'); return;
    }
    var img = new Image(), u = URL.createObjectURL(file);
    img.onload = function () { URL.revokeObjectURL(u); if (!S || !S.cam) return; setShot(stampAndEncode(img, img.naturalWidth, img.naturalHeight, S.cam.ch)); paint(); };
    img.onerror = function () { URL.revokeObjectURL(u); toast('Không đọc được ảnh này.'); };
    img.src = u;
  }
  function hydratePhotos() {                                            // ảnh nằm ở collection riêng → chỉ tải khi cần hiển thị
    if (!S || !S.root) return;
    S.root.querySelectorAll('img[data-ph]').forEach(function (img) {
      var key = img.getAttribute('data-ph'), p = key.split('|');
      if (img.getAttribute('src')) return;
      if (key in S.photos) {
        var v = S.photos[key];
        if (v) { img.src = v; img.parentNode.classList.remove('is-empty'); } else if (v === '') img.parentNode.classList.add('is-empty');   // null = đang tải
        return;
      }
      S.photos[key] = null;
      S.store.getPhoto(S.roomId, p[0], p[1]).then(function (src) { if (!S) return; S.photos[key] = src || ''; hydratePhotos(); }, function () { if (S) S.photos[key] = ''; });
    });
  }

  var ACTIONS = {
    signin: function () {
      if (!hasFirebase()) { toast('Chưa kết nối được Firebase.'); return; }
      S.busy = true; paint();
      var done = function (e) {
        if (!S) return; S.busy = false; paint();
        if (e && e.code !== 'auth/popup-closed-by-user' && e.code !== 'auth/cancelled-popup-request') toast((e && e.message) || 'Không đăng nhập được, thử lại nhé.');
      };
      try { firebase.auth().signInWithPopup(new firebase.auth.GoogleAuthProvider()).then(function () { done(); }, done); } catch (e) { done(e); }
    },
    tab: function (el) { S.tab = el.getAttribute('data-tab') === 'join' ? 'join' : 'create'; paint(); },
    open: function (el) { openRoom(el.getAttribute('data-id')); },
    back: function () { closeRoom(); },
    create: function () {
      var p = profFromForm(), room = S.form.room.trim();
      if (!room || !p.name || !p.title) { toast('Điền tên phòng, tên của bạn và cam kết nhé.'); return; }
      S.busy = true; paint(); saveForm();
      S.store.createRoom(room, p, nowDay()).then(function (id) { S.busy = false; S.form.room = ''; openRoom(id); }, function (e) { S.busy = false; paint(); toast(errMsg(e)); });
    },
    join: function () {
      var p = profFromForm(), code = S.form.code.trim().toUpperCase();
      if (!/^HUB-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(code)) { toast('Mã mời có dạng HUB-XXXX-XXXX.'); return; }
      if (!p.name || !p.title) { toast('Điền tên của bạn và cam kết nhé.'); return; }
      S.busy = true; paint(); saveForm();
      S.store.joinRoom(code, p, nowDay()).then(function (id) { S.busy = false; S.form.code = ''; openRoom(id); }, function (e) { S.busy = false; paint(); toast(errMsg(e)); });
    },
    copy: function () {
      var code = S.room && S.room.code; if (!code) return;
      var done = function () { toast('Đã chép mã mời ' + code); };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(code).then(done, function () { window.prompt('Chép mã mời:', code); });
      else window.prompt('Chép mã mời:', code);
    },
    cam: function () {
      var on = !!S.room.cfg.challenge;
      S.cam = { facing: 'environment', shot: '', err: '', note: '', stream: null, sending: false, ch: on ? newChallenge() : '', chExp: on ? Date.now() + CHAL_MS : 0, timer3s: false, cd: 0, cdT: null, chT: null, ph: '', pm: '', dup: null };
      S.dlg = 'camera'; paint(); startCamera();
    },
    flip: function () { var c = S.cam; if (!c) return; stopCamTimers(); if (!c.err) c.facing = c.facing === 'user' ? 'environment' : 'user'; c.shot = ''; c.err = ''; paint(); startCamera(); },
    timer3s: function (el) {
      if (!S.cam || S.cam.cd) return;
      S.cam.timer3s = !S.cam.timer3s;
      el.setAttribute('aria-pressed', String(S.cam.timer3s));
      toast(S.cam.timer3s ? 'Đã bật hẹn giờ chụp 3 giây.' : 'Đã tắt hẹn giờ chụp 3 giây.');
    },
    'ch-switch': function () {
      var c = S.cam; if (!c || c.shot || !c.ch || c.cd) return;
      var cur = chInfo(c.ch);
      c.ch = newChallenge(cur && cur.kind === 'paper' ? 'fingers' : 'paper');
      c.chExp = Date.now() + CHAL_MS;
      paint();
    },
    shoot: function (el) {
      var c = S.cam; if (!c) return;
      if (c.cd > 0) {
        if (c.cdT) { clearInterval(c.cdT); c.cdT = null; }
        c.cd = 0;
        var ov0 = S.root && S.root.querySelector('#hc-cd'); if (ov0) { ov0.hidden = true; ov0.textContent = ''; }
        if (el) el.textContent = 'Chụp';
        return;
      }
      if (!c.timer3s) { captureNow(); return; }
      var v = S.root && S.root.querySelector('#hc-video');
      if (!v || !v.videoWidth) { toast('Camera chưa sẵn sàng, đợi một chút nhé.'); return; }
      c.cd = 3;
      var ov = S.root && S.root.querySelector('#hc-cd');
      if (ov) { ov.textContent = '3'; ov.hidden = false; }
      if (el) el.textContent = 'Huỷ (3)';
      c.cdT = setInterval(function () {
        if (!S || !S.cam || S.dlg !== 'camera' || S.cam.shot) { stopCamTimers(); return; }
        S.cam.cd--;
        if (S.cam.cd <= 0) {
          clearInterval(S.cam.cdT); S.cam.cdT = null; S.cam.cd = 0;
          captureNow(); return;
        }
        var ov2 = S.root && S.root.querySelector('#hc-cd'), sb = S.root && S.root.querySelector('[data-act="shoot"]');
        if (ov2) ov2.textContent = String(S.cam.cd);
        if (sb) sb.textContent = 'Huỷ (' + S.cam.cd + ')';
      }, 1000);
    },
    retake: function () { stopCamTimers(); S.cam.shot = ''; S.cam.dup = null; if (S.room.cfg.challenge) { S.cam.ch = newChallenge(); S.cam.chExp = Date.now() + CHAL_MS; } paint(); startCamera(); },       // chụp lại = mã mới + đồng hồ mới
    sendshot: function () {
      var c = S.cam, m = mineNow(); if (!c || !c.shot || !m || c.sending) return;
      var today = S.calc.today, cm = curCommit(m, today), tm = targetMs(today, cm.target, S.room.cfg.cutoff), key = m.uid + '|' + today;
      c.sending = true; paint();
      S.store.checkIn(S.roomId, today, (c.note || '').trim().slice(0, 120), !!tm && Date.now() > tm, c.shot, { ch: c.ch, ph: c.ph, pm: c.pm }).then(function () {
        S.photos[key] = c.shot; stopCamera(); S.cam = null; S.dlg = ''; paint(); toast('Đã check-in lúc ' + fmtTime(Date.now()) + ' kèm ảnh.');
      }, function (e) { if (S.cam) { S.cam.sending = false; paint(); } toast(errMsg(e)); });
    },
    photo: function (el) {
      var uid = el.getAttribute('data-uid'), date = el.getAttribute('data-date'), name = el.getAttribute('data-name');
      var plist = el.getAttribute('data-plist'), list = [];
      if (S.room && S.calc) {
        var arc = arcState(S.calc.today), members = S.room.members;
        if (plist === 'gallery') {
          list = arcGalleryItems(S.room, S.calc, members, arc).map(function (it) { return { uid: it.uid, date: it.date, name: it.name }; });
        } else if (plist === 'day') {
          members.forEach(function (m) {
            var ci = (S.room.checkins[m.uid] || {})[arc.day], cm = commitAt(m, arc.day);
            if (!ci || !ci.hasPhoto) return;
            var li = lateInfo(ci, cm || curCommit(m, arc.day), arc.day, S.room.cfg.cutoff);
            if (arcMatchEntry(arc, m, cm, ci, li, !!cm && scheduled(m, arc.day), S.calc.by[m.uid + '|' + arc.day])) list.push({ uid: m.uid, date: arc.day, name: m.name });
          });
        } else if (plist === 'feed') {
          S.calc.feed.forEach(function (f) { if (f.photo) list.push({ uid: f.uid, date: f.date, name: f.name }); });
        } else if (plist === 'today') {
          members.forEach(function (m) {
            var ci = (S.room.checkins[m.uid] || {})[S.calc.today];
            if (ci && ci.hasPhoto) list.push({ uid: m.uid, date: S.calc.today, name: m.name });
          });
        }
      }
      S.photoList = list.length > 1 ? list : null;
      S.photoView = { uid: uid, date: date, name: name }; S.dlg = 'photo'; paint();
    },
    vote: function (el) {
      var v = el.getAttribute('data-v'), pv = S.photoView, it = pv && S.calc && S.calc.by[pv.uid + '|' + pv.date];
      if (!it || S.voting || (v !== 'ok' && v !== 'sus')) return;
      if (it.j && it.j.votes && it.j.votes[S.store.uid] === v) return;
      S.voting = true; paint();
      S.store.review(S.roomId, pv.uid, pv.date, v, it.sec).then(function () {
        if (!S) return; S.voting = false; paint(); toast(v === 'sus' ? 'Đã đánh dấu nghi ngờ.' : 'Đã đánh dấu hợp lệ.');
      }, function (e) {
        if (!S) return; S.voting = false; paint(); toast(errMsg(e));
      });
    },
    'photo-nav': function (el) {
      var list = S.photoList, v = S.photoView; if (!list || !list.length || !v) return;
      var idx = 0, dir = +el.getAttribute('data-dir') || 1;
      for (var i = 0; i < list.length; i++) if (list[i].uid === v.uid && list[i].date === v.date) { idx = i; break; }
      var next = list[(idx + dir + list.length) % list.length];
      S.photoView = { uid: next.uid, date: next.date, name: next.name }; paint();
    },
    'photo-dl': function () {
      var v = S.photoView, src = v && S.photos[v.uid + '|' + v.date];
      if (!src) { toast('Ảnh đang tải, đợi một chút nhé.'); return; }
      var a = document.createElement('a');
      a.href = src;
      a.download = 'collab-' + (v.date || 'photo') + '-' + (v.name || 'member').replace(/[^\w\u00C0-\u024F-]+/g, '_') + '.jpg';
      document.body.appendChild(a); a.click(); a.remove();
    },
    undo: function () { var m = mineNow(); guard(S.store.undo(S.roomId, S.calc.today)).then(function () { if (m) delete S.photos[m.uid + '|' + S.calc.today]; toast('Đã hoàn tác check-in hôm nay.'); }); },
    nudge: function (el) { guard(S.store.nudge(S.roomId, el.getAttribute('data-uid'), S.calc.today)).then(function () { toast('Đã nhắc bạn ấy.'); }); },
    dlg: function (el) {
      var m = mineNow(), c = curCommit(m, S.calc.today), kind = el && el.getAttribute('data-dlg') === 'manage' ? 'manage' : 'settings';
      S.dlg = kind; S._dlgFocused = false;
      S.dlgForm = { title: c.title, freq: c.freq, target: c.target || '', max: S.room.cfg.maxHearts, regen: S.room.cfg.regenDays, chal: S.room.cfg.challenge ? 'on' : 'off' };
      S.mg = { name: S.room.name, max: S.room.maxMembers, expiry: DEFAULT_EXPIRY };
      paint();
    },
    close: function () {
      if (S.confirm) { if (S.confirm.busy) return; S.dlg = S.confirm.back || ''; S.confirm = null; S._dlgFocused = false; paint(); return; }   // huỷ xác nhận → về hộp thoại trước
      stopCamera(); S.cam = null; S.photoView = null; S.photoList = null; S.voting = false; S.dlg = ''; S._dlgFocused = false; paint();
    },
    'save-commit': function () {
      var f = S.dlgForm, m = mineNow(), today = S.calc.today, title = (f.title || '').trim();
      if (!title) { toast('Cam kết không được để trống.'); return; }
      var cur = curCommit(m, today), freq = f.freq === 'weekdays' ? 'weekdays' : 'daily', target = /^\d\d:\d\d$/.test(f.target) ? f.target : '';
      if (cur.title === title && cur.freq === freq && (cur.target || '') === target) { toast('Không có gì thay đổi.'); return; }
      var next = (m.commits || []).filter(function (c) { return c.from <= today; }).concat([{ from: addDays(today, 1), title: title, freq: freq, target: target }]);
      guard(S.store.setCommits(S.roomId, next)).then(function () { S.dlg = ''; paint(); toast('Cam kết mới có hiệu lực từ ngày mai.'); });
    },
    'save-cfg': function () { var f = S.dlgForm; guard(S.store.setCfg(S.roomId, { maxHearts: f.max, regenDays: f.regen, challenge: f.chal === 'on' })).then(function () { toast('Đã cập nhật luật phòng.'); }); },
    leave: function () {
      if (S.room && S.room.ownerUid === S.store.uid) { toast('Chủ phòng cần chuyển quyền hoặc xoá phòng trước khi rời.'); return; }
      if (!window.confirm('Rời phòng này? Lịch sử check-in của bạn vẫn còn trong phòng nhưng bạn sẽ không còn thấy phòng nữa.')) return;
      guard(S.store.leave(S.roomId)).then(function () { closeRoom(); toast('Đã rời phòng.'); });
    }
  };

  /* ───────────── thao tác quản lý phòng ───────────── */
  ACTIONS['inv-expiry'] = function () {
    var ms = expiryMs(S.mg.expiry);
    doAct(S.store.setInviteExpiry(S.roomId, S.room.code, ms), ms == null ? 'Mã mời không còn hết hạn.' : 'Mã mời sẽ hết hạn lúc ' + fmtStamp(ms) + '.');
  };
  ACTIONS['inv-lock'] = function () {
    var open = !S.room.joinOpen;
    doAct(S.store.setJoinOpen(S.roomId, open), open ? 'Đã mở lại cho người mới.' : 'Đã khoá: không ai vào được bằng mã.');
  };
  ACTIONS['inv-regen'] = function () {
    var ms = expiryMs(S.mg.expiry), old = S.room.code;
    askConfirm({ title: 'Đổi mã mời mới?', body: 'Mã <b>' + esc(old) + '</b> sẽ không dùng được nữa. Người đã ở trong phòng không bị ảnh hưởng.', ok: 'Đổi mã',
      run: function () { return S.store.regenCode(S.roomId, old, ms).then(function (code) { return { msg: 'Mã mới: ' + code }; }); } });
  };
  ACTIONS['save-info'] = function () {
    var f = S.mg, name = (f.name || '').trim(), n = S.room.members.length;
    if (!name) { toast('Tên phòng không được để trống.'); return; }
    if (f.max < n) { toast('Số người tối đa không được nhỏ hơn số người đang có (' + n + ').'); return; }
    if (name === S.room.name && f.max === S.room.maxMembers) { toast('Không có gì thay đổi.'); return; }
    doAct(S.store.setInfo(S.roomId, { name: name, maxMembers: f.max }), 'Đã lưu thiết lập phòng.');
  };
  ACTIONS['ask-kick'] = function (el) {
    var uid = el.getAttribute('data-uid'), m = memberByUid(uid); if (!m) return;
    var ms = expiryMs(S.mg.expiry);
    askConfirm({ title: 'Mời ' + m.name + ' ra khỏi phòng?',
      body: '<b>' + esc(m.name) + '</b> sẽ không còn thấy phòng này. Lịch sử check-in của họ vẫn nằm trong phòng nhưng không còn tính vào streak chung.',
      ok: 'Mời ra', danger: true, opt: { label: 'Đổi mã mời mới luôn (chặn họ vào lại bằng mã cũ)', checked: true },
      run: function (regen) {
        return S.store.kick(S.roomId, uid, { regen: regen, oldCode: S.room.code, expiryMs: ms }).then(function (code) {
          return { msg: 'Đã mời ' + m.name + ' ra khỏi phòng' + (code ? ' · mã mới: ' + code : '') + '.' };
        });
      } });
  };
  ACTIONS['ask-transfer'] = function (el) {
    var uid = el.getAttribute('data-uid'), m = memberByUid(uid); if (!m) return;
    askConfirm({ title: 'Chuyển chủ phòng cho ' + m.name + '?',
      body: '<b>' + esc(m.name) + '</b> sẽ có toàn quyền quản lý: đổi luật, đổi mã, mời người ra, xoá phòng. Bạn vẫn ở lại phòng như một thành viên và <b>không tự lấy lại được quyền</b>.',
      ok: 'Chuyển quyền', danger: true,
      run: function () { return S.store.transferOwner(S.roomId, uid).then(function () { return { msg: m.name + ' là chủ phòng mới.' }; }); } });
  };
  ACTIONS['ask-delete'] = function () {
    askConfirm({ title: 'Xoá phòng “' + S.room.name + '”?',
      body: 'Mọi thành viên sẽ mất phòng này cùng toàn bộ check-in và ảnh. <b>Không thể khôi phục.</b>',
      ok: 'Xoá vĩnh viễn', danger: true, need: S.room.name, run: deleteRun });
  };
  ACTIONS['resume-delete'] = function () {
    askConfirm({ title: 'Tiếp tục xoá phòng?', body: 'Lần xoá trước chưa xong. Bấm tiếp tục để dọn nốt phần còn lại.', ok: 'Xoá nốt', danger: true, back: '', run: deleteRun });
  };
  ACTIONS['confirm-ok'] = function () {
    var c = S.confirm; if (!c || c.busy || !confirmReady()) return;
    c.busy = true; paint();
    Promise.resolve().then(function () { return c.run(c.opt ? !!c.opt.checked : false); }).then(function (res) {
      if (!S) return;
      S.confirm = null;
      if (res && res.leave) closeRoom(); else { S.dlg = c.back || ''; S._dlgFocused = false; paint(); }
      if (res && res.msg) toast(res.msg);
    }, function (e) { if (S && S.confirm) { S.confirm.busy = false; paint(); } toast(errMsg(e)); });
  };

  /* ───────────── thao tác kho nhật ký check-in ───────────── */
  ACTIONS['room-tab'] = function (el) {
    S.roomTab = el.getAttribute('data-rtab') === 'archive' ? 'archive' : 'today';
    if (S.roomTab === 'archive' && S.calc) arcState(S.calc.today);
    paint();
  };
  ACTIONS['arc-mode'] = function (el) {
    if (!S.calc) return;
    var m = el.getAttribute('data-amode'), arc = arcState(S.calc.today);
    arc.mode = (m === 'gallery' || m === 'month' || m === 'weekly') ? m : 'day';
    if (arc.mode === 'weekly' && !arc.week) arc.week = lastWeekStart(S.calc.today);
    paint();
  };
  ACTIONS['arc-month'] = function (el) {
    if (!S.calc) return;
    var dir = +el.getAttribute('data-dir') || 0, arc = arcState(S.calc.today), curM = monthKey(S.calc.today);
    var nextM = shiftMonthKey(arc.month, dir);
    if (nextM > curM) nextM = curM;
    arc.month = nextM;
    var days = daysInMonth(nextM);
    arc.day = nextM === curM ? S.calc.today : days[days.length - 1];
    paint();
  };
  ACTIONS['arc-today'] = function () {
    if (!S.calc) return;
    var arc = arcState(S.calc.today);
    arc.month = monthKey(S.calc.today); arc.day = S.calc.today;
    paint();
  };
  ACTIONS['arc-day'] = function (el) {
    if (!S.calc) return;
    var d = el.getAttribute('data-day');
    if (!d || d > S.calc.today) return;
    var arc = arcState(S.calc.today);
    S.roomTab = 'archive'; arc.day = d; arc.month = monthKey(d); arc.mode = 'day';
    paint();
  };
  ACTIONS['weekly-toggle'] = function (el) {
    if (!S.room || !S.calc || !S.calc.weekly) return;
    var ws = el.getAttribute('data-wstart') || S.calc.weekly.weekStart;
    setWRecapOpen(S.room.id, ws, !isWeeklyOpen(S.room.id, S.calc.weekly, S.calc.today));
    paint();
  };
  ACTIONS['weekly-arc'] = function (el) {
    if (!S.calc) return;
    var arc = arcState(S.calc.today);
    arc.week = el.getAttribute('data-wstart') || lastWeekStart(S.calc.today);
    arc.mode = 'weekly'; S.roomTab = 'archive';
    paint();
  };
  ACTIONS['arc-week'] = function (el) {
    if (!S.room || !S.calc) return;
    var dir = +el.getAttribute('data-dir') || 0, arc = arcState(S.calc.today), cur = weeklySummary(S.room, S.calc, arc.week);
    if (dir < 0 && !cur.canPrev) return;
    if (dir > 0 && !cur.canNext) return;
    arc.week = addDays(cur.weekStart, dir * 7);
    paint();
  };
  ACTIONS['arc-week-latest'] = function () {
    if (!S.calc) return;
    arcState(S.calc.today).week = lastWeekStart(S.calc.today);
    paint();
  };
  ACTIONS['weekly-copy'] = function (el) {
    if (!S.room || !S.calc) return;
    var ws = el.getAttribute('data-wstart') || (S.calc.weekly && S.calc.weekly.weekStart) || lastWeekStart(S.calc.today);
    var w = (S.calc.weekly && S.calc.weekly.weekStart === ws) ? S.calc.weekly : weeklySummary(S.room, S.calc, ws);
    if (!w || !w.hasData) return;
    var txt = weeklyCardText(S.room, w);
    var done = function () { toast('Đã chép tổng kết tuần vào clipboard.'); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(txt).then(done, function () { window.prompt('Chép tổng kết tuần:', txt); });
    else window.prompt('Chép tổng kết tuần:', txt);
  };
  ACTIONS['arc-day-shift'] = function (el) {
    if (!S.calc) return;
    var dir = +el.getAttribute('data-dir') || 0, arc = arcState(S.calc.today);
    var nd = addDays(arc.day > S.calc.today ? S.calc.today : arc.day, dir);
    if (nd > S.calc.today) return;
    arc.day = nd; arc.month = monthKey(nd);
    paint();
  };
  ACTIONS['arc-reset'] = function () {
    if (!S.calc) return;
    var arc = arcState(S.calc.today);
    arc.member = 'all'; arc.status = 'all'; arc.q = '';
    paint();
  };
  ACTIONS['arc-copy'] = function () {
    if (!S.room || !S.calc) return;
    var room = S.room, c = S.calc, arc = arcState(c.today), lines = [];
    if (arc.mode === 'month') {
      var ms = arcMonthStats(room, c, room.members, arc);
      lines.push('[' + room.name + '] Báo cáo ' + fmtMonthLabel(arc.month));
      lines.push('Hoàn thành: ' + ms.totDone + '/' + ms.totDue + ' (' + (ms.totDue ? Math.round(ms.totDone / ms.totDue * 100) : 0) + '%) · Đồng bộ cả phòng: ' + ms.syncDays + '/' + ms.schedDays + ' ngày');
      ms.rows.forEach(function (pm) {
        lines.push('- ' + pm.m.name + ': ' + pm.done + '/' + pm.due + ' (✓ ' + pm.ok + ', ▲ ' + pm.late + ', ‼ ' + pm.vlate + ', ✕ ' + pm.miss + ')');
      });
    } else {
      var d = arc.day > c.today ? c.today : arc.day;
      lines.push('[' + room.name + '] Điểm danh ' + dayName(d) + ' ' + fmtDay(d) + '/' + d.slice(0, 4));
      room.members.forEach(function (m) {
        var cm = commitAt(m, d), due = !!cm && scheduled(m, d), ci = (room.checkins[m.uid] || {})[d];
        if (!due && !ci) return;
        if (ci) {
          var it = c.by[m.uid + '|' + d], li = lateInfo(ci, cm || curCommit(m, d), d, room.cfg.cutoff);
          if (it && it.j.voided) lines.push('✕ ' + m.name + ': ' + fmtTime(ci.at) + ' (bị hủy — tính như lỡ ngày)');
          else lines.push('✓ ' + m.name + ': ' + fmtTime(ci.at) + (li && li.label ? ' (' + li.label + ')' : ' (đúng giờ)') + (ci.note ? ' — ' + ci.note : ''));
        } else {
          lines.push('✕ ' + m.name + ': ' + (d === c.today ? 'chưa check-in' : 'bỏ lỡ'));
        }
      });
    }
    var txt = lines.join('\n');
    var done = function () { toast('Đã chép báo cáo vào clipboard.'); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(txt).then(done, function () { window.prompt('Chép báo cáo:', txt); });
    else window.prompt('Chép báo cáo:', txt);
  };

  function bind(root) {
    root.addEventListener('click', function (e) {
      var el = e.target.closest('[data-act]'); if (!el || el.disabled) return;
      var fn = ACTIONS[el.getAttribute('data-act')]; if (fn) fn(el);
    });
    root.addEventListener('input', function (e) {
      var t = e.target, k;
      if ((k = t.getAttribute('data-f'))) { S.form[k] = t.value; if (k === 'code') S.form.code = t.value.toUpperCase(); }
      else if ((k = t.getAttribute('data-d'))) S.dlgForm[k] = (k === 'max' || k === 'regen') ? +t.value : t.value;
      else if ((k = t.getAttribute('data-c')) && S.cam) S.cam[k] = t.value;
      else if ((k = t.getAttribute('data-m')) && S.mg) S.mg[k] = k === 'max' ? +t.value : t.value;
      else if ((k = t.getAttribute('data-arc')) === 'q' && S.calc) { arcState(S.calc.today).q = t.value; paint(); }
      else if ((k = t.getAttribute('data-x')) && S.confirm) {
        if (k === 'opt' && S.confirm.opt) S.confirm.opt.checked = t.checked; else if (k === 'typed') S.confirm.typed = t.value;
        var okb = root.querySelector('[data-act="confirm-ok"]'); if (okb && !S.confirm.busy) okb.disabled = !confirmReady();
      }
    });
    root.addEventListener('change', function (e) {
      var t = e.target, k;
      if (t.id === 'hc-file' && t.files && t.files[0]) useFile(t.files[0]);
      else if (((k = t.getAttribute('data-arc')) === 'member' || k === 'status') && S.calc) { arcState(S.calc.today)[k] = t.value; paint(); }
    });
    root.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && S.dlg) { e.stopPropagation(); ACTIONS.close(); return; }
      if (S.dlg === 'photo' && S.photoList && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
        e.preventDefault();
        ACTIONS['photo-nav']({ getAttribute: function () { return e.key === 'ArrowLeft' ? '-1' : '1'; } });
        return;
      }
      if (e.key === 'Enter' && e.target.getAttribute && e.target.getAttribute('data-act') === 'arc-day') {
        e.preventDefault(); ACTIONS['arc-day'](e.target); return;
      }
      if (e.key === 'Enter' && e.target.matches && e.target.matches('.hub-collab-lobby .hub-collab-input')) ACTIONS[S.tab]();
    });
  }

  var ICON = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></svg>';

  function render(container) {
    if (!container) return;
    destroy();
    S = freshState(); S.root = container;
    container.innerHTML = '<section class="hub-collab-app" id="hub-collab-app"><div id="hc-view"></div><div class="hub-collab-toast" id="hc-toast" role="status" aria-live="polite"></div></section>';
    bind(container);
    try { localStorage.removeItem(LEGACY_DEMO_KEY); } catch (e) {}      // dọn dữ liệu demo cũ
    try {
      if (hasFirebase()) {
        S.authUnsub = firebase.auth().onAuthStateChanged(function (u) {
          if (!S) return;
          var first = !S.authReady; S.authReady = true;
          var cur = S.store ? S.store.uid : '', want = u ? u.uid : '';
          if (!first && cur === want) return;
          init();
        });
      } else S.authReady = true;
    } catch (e) { S.authReady = true; }
    if (S.authReady) init(); else paint();                 // có Firebase: chờ lần báo đăng nhập đầu tiên; không có: hiện thẳng cổng
    S.timer = setInterval(tick, 15000);
  }
  function destroy() {
    if (!S) return;
    stopCamera();
    if (S.unwatch) S.unwatch();
    if (S.timer) clearInterval(S.timer);
    if (S.authUnsub) { try { S.authUnsub(); } catch (e) {} }
    clearTimeout(S.toastT);
    emitStatus(true);
    if (S.root) S.root.innerHTML = '';
    S = null;
  }

  return {
    id: 'collab-hub', name: 'Cộng tác', icon: ICON, render: render, destroy: destroy,
    _internals: { replay: replay, groupStreak: groupStreak, computeRoom: computeRoom, weeklySummary: weeklySummary, mondayOf: mondayOf, lastWeekStart: lastWeekStart, isMonday: isMonday, isWeeklyOpen: isWeeklyOpen, setWRecapOpen: setWRecapOpen, judge: judge, findDups: findDups, dupAgainst: dupAgainst, hamming: hamming, informative: informative, hashPair: hashPair, hexWords: hexWords, popcount: popcount, chInfo: chInfo, newChallenge: newChallenge, REVIEW_MS: REVIEW_MS, DUP_MAX: DUP_MAX, dayKey: dayKey, scheduled: scheduled, targetMs: targetMs, addDays: addDays, inviteState: inviteState, expiryMs: expiryMs, spanText: spanText, lateInfo: lateInfo, lateBucketLabel: lateBucketLabel }   // chỉ để kiểm thử
  };
})();

// Auto-register
if (typeof app !== 'undefined' && app && typeof app.register === 'function') {
  app.register(collaborationModule);
}