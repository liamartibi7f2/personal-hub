/* ================================================================
   Hub.OS — Collab Hub v3 · "Streak rooms"
   Mỗi người một cam kết riêng · mỗi ngày một lần check-in (chỉ ghi giờ + ngày)
   Lỡ một ngày = mất 1 tim · hết tim = mất streak (tim hồi đầy) · liên tục N ngày = +1 tim

   Public contract: { id, name, icon, render(container), destroy() }
   Registered through app.register(collaborationModule).

   Hai kho dữ liệu cùng một giao diện:
     CloudStore — Firebase Auth + Firestore (phòng thật, cập nhật trực tiếp)
     DemoStore  — localStorage, 2 bạn ảo tự check-in (dùng khi chưa đăng nhập)
   Streak / tim KHÔNG được lưu: luôn tính lại từ danh sách check-in (replay),
   nên không ai sửa tay con số được.

   Quản lý phòng (chủ phòng): mã mời có hạn dùng · đổi mã · khoá/mở phòng · giới hạn số người ·
   đổi tên · mời thành viên ra · chuyển chủ phòng · xoá phòng. Thành viên: xem mã + danh sách, tự rời.
   ================================================================ */
const collaborationModule = (function () {
  'use strict';

  var DEMO_KEY = 'hub_collab_demo_v1';
  var FORM_KEY = 'hub_collab_form';
  var UNDO_MS = 5 * 60 * 1000;                    // hoàn tác check-in trong 5 phút
  var DEFAULT_CFG = { maxHearts: 5, regenDays: 7, cutoff: 4 };   // cutoff = giờ chốt ngày (04:00 sáng)
  var HEART_CHOICES = [3, 5, 7, 10];
  var REGEN_CHOICES = [3, 5, 7, 14];
  var FREQ = { daily: 'Mỗi ngày', weekdays: 'Thứ 2 – Thứ 6' };
  var DOW = ['Chủ nhật', 'Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7'];
  var DEFAULT_MAX_MEMBERS = 10, LEGACY_MAX_MEMBERS = 20;       // phòng mới tối đa 10 người; phòng cũ (chưa có trường này) giữ mức 20
  var MAX_CHOICES = [2, 3, 4, 5, 6, 8, 10, 15, 20];
  var EXPIRY = [['1d', '1 ngày', 1], ['7d', '7 ngày', 7], ['30d', '30 ngày', 30], ['never', 'Không hết hạn', 0]];
  var DEFAULT_EXPIRY = '7d';

  /* ───────────── ngày giờ ───────────── */
  function pad(n) { return n < 10 ? '0' + n : '' + n; }
  function ymd(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function parseYmd(s) { var p = String(s).split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); }
  function addDays(s, n) { var d = parseYmd(s); d.setDate(d.getDate() + n); return ymd(d); }
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
  function leftText(ms) {
    var m = Math.max(0, Math.floor(ms / 60000));
    return Math.floor(m / 60) + 'g ' + pad(m % 60) + 'p';
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
  /** Phát lại toàn bộ lịch sử → tim, streak, kỷ lục, số lần KO, và dải ngày (ok / miss / ko / rest / today). */
  function replay(member, done, today, cfg) {
    var max = cfg.maxHearts, hearts = max, streak = 0, best = 0, run = 0, kos = 0, log = [], d = startOf(member);
    function hit() { streak++; if (streak > best) best = streak; run++; if (run % cfg.regenDays === 0 && hearts < max) hearts++; }
    while (d && d < today) {
      if (!scheduled(member, d)) log.push([d, 'rest']);
      else if (done[d]) { hit(); log.push([d, 'ok']); }
      else {
        hearts--; run = 0;
        if (hearts <= 0) { streak = 0; hearts = max; kos++; log.push([d, 'ko']); } else log.push([d, 'miss']);
      }
      d = addDays(d, 1);
    }
    var on = !!d && scheduled(member, today), doneToday = !!done[today];
    if (on && doneToday) hit();
    log.push([today, !on ? 'rest' : doneToday ? 'ok' : 'today']);
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
  function computeRoom(room, nowMs) {
    var cfg = room.cfg, today = dayKey(nowMs, cfg.cutoff), doneBy = {}, states = {}, feed = [];
    room.members.forEach(function (m) { doneBy[m.uid] = {}; });
    Object.keys(room.checkins).forEach(function (uid) {
      Object.keys(room.checkins[uid]).forEach(function (date) {
        if (doneBy[uid]) doneBy[uid][date] = true;
        var m = room.members.filter(function (x) { return x.uid === uid; })[0];
        if (m) feed.push({ uid: uid, name: m.name, date: date, at: room.checkins[uid][date].at, note: room.checkins[uid][date].note || '', photo: !!room.checkins[uid][date].hasPhoto });
      });
    });
    room.members.forEach(function (m) { states[m.uid] = replay(m, doneBy[m.uid], today, cfg); });
    feed.sort(function (a, b) { return b.at - a.at; });
    return { today: today, states: states, group: groupStreak(room.members, doneBy, today), feed: feed.slice(0, 8) };
  }

  /* ───────────── DemoStore (localStorage + 2 bạn ảo) ───────────── */
  function DemoStore() {
    var ME = 'me', db = load(), watching = null;
    function load() { try { var r = JSON.parse(localStorage.getItem(DEMO_KEY)); if (r && r.rooms) return r; } catch (e) {} return { rooms: {} }; }
    function save() { try { localStorage.setItem(DEMO_KEY, JSON.stringify(db)); } catch (e) {} }
    function botMs(uid, date) { return parseYmd(date).getTime() + (7 * 60 + hash(uid + date) % (15 * 60)) * 60000; }   // 07:00 – 22:00
    function out(r) {
      return { id: r.id, name: r.name, code: r.code, ownerUid: r.ownerUid, cfg: r.cfg,
        joinOpen: r.joinOpen !== false, maxMembers: r.maxMembers || LEGACY_MAX_MEMBERS, deleting: false,
        invite: { exists: true, expiresAt: r.inviteExp == null ? null : r.inviteExp },
        members: Object.keys(r.members).map(function (k) { return r.members[k]; }),
        checkins: r.checkins, nudges: Object.keys(r.nudges).map(function (k) { return r.nudges[k]; }) };
    }
    function simulate(r) {                     // bạn ảo tự check-in khi tới giờ của họ
      var now = Date.now(), today = dayKey(now, r.cfg.cutoff), changed = false;
      Object.keys(r.members).forEach(function (uid) {
        var m = r.members[uid];
        if (!m.bot || !scheduled(m, today)) return;
        r.checkins[uid] = r.checkins[uid] || {};
        if (!r.checkins[uid][today] && now >= botMs(uid, today)) { r.checkins[uid][today] = { at: botMs(uid, today), note: '', hasPhoto: true }; changed = true; }
      });
      return changed;
    }
    function emit() { if (watching && db.rooms[watching.id]) watching.cb(out(db.rooms[watching.id])); }
    function room(id) { var r = db.rooms[id]; if (!r) throw new Error('Phòng không còn tồn tại.'); return r; }
    function member(prof, today) { return { uid: ME, name: prof.name, joinedAt: Date.now(), commits: [{ from: today, title: prof.title, freq: prof.freq, target: prof.target || '' }] }; }
    function ok(v) { return Promise.resolve(v); }
    function botPhoto(uid, name, date, at) {            // ảnh minh hoạ cho bạn ảo, sinh ra tại chỗ
      var h = hash(uid + date) % 360, svg = "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 240 180'><defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'><stop offset='0' stop-color='hsl(" + h + ",55%,38%)'/><stop offset='1' stop-color='hsl(" + ((h + 60) % 360) + ",60%,22%)'/></linearGradient></defs><rect width='240' height='180' fill='url(#g)'/><text x='120' y='104' font-family='sans-serif' font-size='72' font-weight='700' fill='white' fill-opacity='.85' text-anchor='middle'>" + name.charAt(0).toUpperCase() + "</text><rect x='8' y='148' width='132' height='24' rx='5' fill='black' fill-opacity='.55'/><text x='16' y='165' font-family='monospace' font-size='13' fill='white'>" + fmtTime(at) + " · " + fmtDay(date) + " · " + name + "</text></svg>";
      return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
    }
    return {
      mode: 'demo', uid: ME, name: '',
      listRooms: function () {
        return ok(Object.keys(db.rooms).filter(function (k) { return db.rooms[k].members[ME]; }).map(function (k) {
          var r = db.rooms[k]; return { id: r.id, name: r.name, code: r.code, owner: r.ownerUid === ME, members: Object.keys(r.members).map(function (u) { return r.members[u].name; }) };
        }));
      },
      createRoom: function (name, prof, today) {
        var id = 'demo-' + genCode().slice(4).replace('-', ''), r = { id: id, name: name, code: genCode(), ownerUid: ME, cfg: JSON.parse(JSON.stringify(DEFAULT_CFG)), members: {}, checkins: {}, nudges: {},
          maxMembers: DEFAULT_MAX_MEMBERS, joinOpen: true, inviteExp: Date.now() + 7 * 86400000 };
        r.members[ME] = member(prof, today);
        var from = addDays(today, -10);
        [['bot-budy', 'Budy', 'Học 2 giờ', 'daily', 7], ['bot-mia', 'Mia', 'Đọc sách 30 phút', 'weekdays', 5]].forEach(function (b) {
          var m = { uid: b[0], name: b[1], bot: true, commits: [{ from: from, title: b[2], freq: b[3], target: '' }] };
          r.members[b[0]] = m; r.checkins[b[0]] = {};
          for (var d = from; d < today; d = addDays(d, 1)) if (scheduled(m, d) && hash(b[0] + d) % b[4] !== 0) r.checkins[b[0]][d] = { at: botMs(b[0], d), note: '', hasPhoto: true };
        });
        db.rooms[id] = r; simulate(r); save(); return ok(id);
      },
      joinRoom: function (code, prof, today) {
        var id = Object.keys(db.rooms).filter(function (k) { return db.rooms[k].code === code; })[0];
        if (!id) return Promise.reject(new Error('Không tìm thấy mã này. (Chế độ demo chỉ có phòng do bạn tạo trên máy này.)'));
        var jr = db.rooms[id];
        if (!jr.members[ME]) {
          if (jr.inviteExp != null && jr.inviteExp <= Date.now()) return Promise.reject(new Error('Mã mời đã hết hạn — nhờ chủ phòng đổi mã mới.'));
          if (jr.joinOpen === false) return Promise.reject(new Error('Phòng đang khoá, chưa nhận thêm người.'));
          if (Object.keys(jr.members).length >= (jr.maxMembers || LEGACY_MAX_MEMBERS)) return Promise.reject(new Error('Phòng đã đủ người.'));
          jr.members[ME] = member(prof, today); save();
        }
        return ok(id);
      },
      watch: function (id, cb) { watching = { id: id, cb: cb }; if (simulate(room(id))) save(); emit(); return function () { watching = null; }; },
      poke: function () { if (watching && db.rooms[watching.id] && simulate(db.rooms[watching.id])) { save(); emit(); } },
      checkIn: function (id, date, note, late, photo) {
        if (!photo) return Promise.reject(new Error('Cần chụp ảnh để check-in.'));
        var r = room(id); r.checkins[ME] = r.checkins[ME] || {};
        r.checkins[ME][date] = { at: Date.now(), note: note || '', late: !!late, hasPhoto: true, photo: photo };
        save(); emit(); return ok();
      },
      getPhoto: function (id, uid, date) {
        var r = room(id), c = (r.checkins[uid] || {})[date];
        if (!c || !c.hasPhoto) return ok('');
        return ok(c.photo || botPhoto(uid, r.members[uid] ? r.members[uid].name : '?', date, c.at));
      },
      undo: function (id, date) { var r = room(id); if (r.checkins[ME]) delete r.checkins[ME][date]; save(); emit(); return ok(); },
      setCommits: function (id, commits) { room(id).members[ME].commits = commits; save(); emit(); return ok(); },
      nudge: function (id, to, date) {
        var r = room(id); r.nudges[ME + '_' + to + '_' + date] = { from: ME, to: to, date: date };
        var m = r.members[to];
        if (m && m.bot && scheduled(m, date)) { r.checkins[to] = r.checkins[to] || {}; if (!r.checkins[to][date]) r.checkins[to][date] = { at: Date.now(), note: 'vừa được nhắc 😅', hasPhoto: true }; }   // bạn ảo phản ứng ngay
        save(); emit(); return ok();
      },
      setCfg: function (id, cfg) { var r = room(id); r.cfg.maxHearts = cfg.maxHearts; r.cfg.regenDays = cfg.regenDays; save(); emit(); return ok(); },
      /* ---- quản lý phòng (demo: chạy trên localStorage, bạn ảo cũng kick / nhận chủ phòng được để thử giao diện) ---- */
      setInfo: function (id, info) { var r = room(id); r.name = info.name; r.maxMembers = info.maxMembers; save(); emit(); return ok(); },
      setJoinOpen: function (id, open) { room(id).joinOpen = !!open; save(); emit(); return ok(); },
      setInviteExpiry: function (id, code, ms) { room(id).inviteExp = ms; save(); emit(); return ok(); },
      regenCode: function (id, oldCode, ms) { var r = room(id); r.code = genCode(); r.inviteExp = ms; save(); emit(); return ok(r.code); },
      kick: function (id, uid, o) {
        var r = room(id); if (uid === ME) return Promise.reject(new Error('Không thể tự mời mình ra.'));
        delete r.members[uid]; delete r.checkins[uid];
        Object.keys(r.nudges).forEach(function (k) { if (r.nudges[k].from === uid || r.nudges[k].to === uid) delete r.nudges[k]; });
        var code = ''; if (o && o.regen) { code = genCode(); r.code = code; r.inviteExp = o.expiryMs; }
        save(); emit(); return ok(code);
      },
      transferOwner: function (id, uid) { var r = room(id); if (!r.members[uid]) return Promise.reject(new Error('Người này không còn trong phòng.')); r.ownerUid = uid; save(); emit(); return ok(); },
      deleteRoom: function (id, onProgress) { room(id); if (onProgress) onProgress(1, 1); delete db.rooms[id]; save(); return ok(); },
      forget: function () { return ok(); },
      leave: function (id) { var r = room(id); delete r.members[ME]; delete db.rooms[id]; save(); return ok(); }
    };
  }

  /* ───────────── CloudStore (Firebase Auth + Firestore) ─────────────
     rooms/{roomId}                       { name, code, ownerUid, maxHearts, regenDays, cutoff, createdAt,
                                            maxMembers, joinOpen, memberCount, deleting? }
     rooms/{roomId}/members/{uid}         { uid, name, commits[], joinedAt, code? }
     rooms/{roomId}/checkins/{uid_date}   { uid, date, day, at(serverTimestamp), note, late, hasPhoto }
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
        b.set(ref, { name: name, code: code, ownerUid: me.uid, maxHearts: DEFAULT_CFG.maxHearts, regenDays: DEFAULT_CFG.regenDays, cutoff: DEFAULT_CFG.cutoff,
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
        var st = { room: null, members: [], mLoaded: false, checkins: [], nudges: [], invite: null, invCode: '', offInv: null, healed: -1 }, offs = [], today = dayKey(Date.now(), DEFAULT_CFG.cutoff);
        function emit() {
          if (!st.room) return;
          var r = st.room, co = {};
          if (r.deleting && r.ownerUid !== me.uid) { cb(null, { code: 'deleting' }); return; }       // chủ phòng đã bấm xoá
          if (st.mLoaded && r.ownerUid === me.uid && !r.deleting && r.memberCount !== st.members.length && st.healed !== st.members.length) {
            st.healed = st.members.length;                                                         // phòng cũ / lệch số đếm → chủ phòng tự chỉnh lại
            rRef(id).update({ memberCount: st.members.length }).catch(function () {});
          }
          st.checkins.forEach(function (c) { (co[c.uid] = co[c.uid] || {})[c.date] = { at: ms(c.at), note: c.note || '', late: !!c.late, hasPhoto: !!c.hasPhoto }; });
          cb({ id: id, name: r.name, code: r.code, ownerUid: r.ownerUid, deleting: !!r.deleting,
            joinOpen: r.joinOpen !== false, maxMembers: r.maxMembers || LEGACY_MAX_MEMBERS, invite: st.invite,
            cfg: { maxHearts: r.maxHearts || DEFAULT_CFG.maxHearts, regenDays: r.regenDays || DEFAULT_CFG.regenDays, cutoff: r.cutoff == null ? DEFAULT_CFG.cutoff : r.cutoff },
            members: st.members, checkins: co, nudges: st.nudges });
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
        return function () { offs.forEach(function (f) { try { f(); } catch (e) {} }); if (st.offInv) { try { st.offInv(); } catch (e) {} } };
      },
      checkIn: function (id, date, note, late, photo) {          // ảnh + check-in ghi cùng một lúc (batch) — thiếu ảnh thì Rules từ chối
        if (!photo) return Promise.reject(new Error('Cần chụp ảnh để check-in.'));
        var key = me.uid + '_' + date, b = db.batch();
        b.set(rRef(id).collection('photos').doc(key), { uid: me.uid, date: date, img: photo, at: FV.serverTimestamp() });
        b.set(rRef(id).collection('checkins').doc(key), { uid: me.uid, date: date, day: dayNum(date), at: FV.serverTimestamp(), note: note || '', late: !!late, hasPhoto: true });
        return b.commit();
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
      setCfg: function (id, cfg) { return rRef(id).update({ maxHearts: cfg.maxHearts, regenDays: cfg.regenDays }); },

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
    return { root: null, store: null, view: 'lobby', roomId: '', rooms: null, room: null, calc: null, unwatch: null, timer: null, authUnsub: null,
      tab: 'create', busy: false, dlg: '', toastT: null, lastDay: '', cam: null, photos: {}, photoView: null,
      form: { room: '', code: '', name: f.name || '', title: f.title || '', freq: f.freq || 'daily', target: f.target || '' },
      dlgForm: null, mg: null, confirm: null };
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

  /* ───────────── sảnh: phòng của bạn + tạo / vào phòng ───────────── */
  function viewLobby() {
    var st = S.store, f = S.form, demo = st.mode === 'demo', rooms = S.rooms;
    var list = rooms === null ? '<p class="hub-collab-muted">Đang tải…</p>'
      : !rooms.length ? '<p class="hub-collab-muted hub-collab-empty">Chưa có phòng nào. Tạo một phòng hoặc nhập mã mời của bạn bè.</p>'
      : '<ul class="hub-collab-roomlist">' + rooms.map(function (r) {
          return '<li><button type="button" class="hub-collab-room" data-act="open" data-id="' + esc(r.id) + '"><span class="hub-collab-room-name">' + esc(r.name) + (r.owner ? '<span class="hub-collab-role is-owner">Chủ phòng</span>' : '') + '</span>' +
            '<span class="hub-collab-room-meta">' + esc(r.members.join(' · ')) + '</span></button></li>';
        }).join('') + '</ul>';
    var create = S.tab === 'create';
    return '<header class="hub-collab-header"><div><h2 class="hub-collab-title">Collab Hub</h2>' +
        '<p class="hub-collab-subtitle">Giữ streak cùng nhau — mỗi người một cam kết, mỗi ngày một lần check-in.</p></div>' +
        '<span class="hub-collab-mode ' + (demo ? 'is-demo' : 'is-cloud') + '">' + (demo ? 'Chế độ demo' : 'Cloud · ' + esc(st.name || 'đã đăng nhập')) + '</span></header>' +
      (demo ? '<div class="hub-collab-banner" role="note">Bạn chưa đăng nhập nên đang ở <b>chế độ demo</b>: dữ liệu chỉ nằm trên máy này và có 2 bạn ảo tự check-in. Đăng nhập Google để tạo phòng thật cùng bạn bè.</div>' : '') +
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

  /* ───────────── phòng: hôm nay ───────────── */
  function viewRoom() {
    var room = S.room, c = S.calc, cfg = room.cfg, me = S.store.uid, now = Date.now(), today = c.today;
    var mine = room.members.filter(function (m) { return m.uid === me; })[0];
    if (!mine) return '<div class="hub-collab-panel"><p class="hub-collab-muted">Bạn không còn trong phòng này.</p><button type="button" class="hub-collab-btn" data-act="back">Về sảnh</button></div>';
    var isOwner = room.ownerUid === me, g = c.group;
    var members = room.members.slice().sort(function (a, b) { return (a.uid === me ? -1 : b.uid === me ? 1 : 0) || (c.states[b.uid].streak - c.states[a.uid].streak) || (a.name < b.name ? -1 : 1); });
    var nudgedMe = room.nudges.filter(function (n) { return n.to === me && n.date === today; }).map(function (n) { var m = room.members.filter(function (x) { return x.uid === n.from; })[0]; return m ? m.name : ''; }).filter(Boolean);
    var nudgedBy = {}; room.nudges.forEach(function (n) { if (n.from === me && n.date === today) nudgedBy[n.to] = true; });

    return '<header class="hub-collab-header hub-collab-header--room">' +
        '<button type="button" class="hub-collab-btn is-ghost" data-act="back" aria-label="Về sảnh">‹ Sảnh</button>' +
        '<div class="hub-collab-roomhead"><h2 class="hub-collab-title">' + esc(room.name) + '</h2>' +
          '<p class="hub-collab-subtitle">' + room.members.length + ' thành viên · lỡ 1 ngày: −1 tim · hết tim: mất streak · ' + cfg.regenDays + ' ngày check-in liền: +1 tim</p></div>' +
        '<div class="hub-collab-headacts"><button type="button" class="hub-collab-chipbtn" data-act="copy" title="Chép mã mời">' + esc(room.code) + '</button>' +
          '<button type="button" class="hub-collab-btn" data-act="dlg" data-dlg="manage">' + (isOwner ? 'Quản lý' : 'Thành viên') + '</button>' +
          '<button type="button" class="hub-collab-btn" data-act="dlg" data-dlg="settings">Cài đặt</button></div></header>' +
      roomBanners(room, isOwner) +
      (nudgedMe.length && !c.states[me].todayDone && c.states[me].todayOn ? '<div class="hub-collab-banner is-nudge" role="status">' + esc(nudgedMe.join(', ')) + ' vừa nhắc bạn check-in hôm nay.</div>' : '') +
      groupHtml(g) + meHtml(mine, room, c, now) +
      '<h3 class="hub-collab-h3 hub-collab-h3--gap">Cả phòng hôm nay</h3><div class="hub-collab-members">' +
        members.map(function (m) { return memberHtml(m, room, c, me, nudgedBy); }).join('') + '</div>' +
      '<h3 class="hub-collab-h3 hub-collab-h3--gap">Nhật ký check-in</h3>' + feedHtml(c) +
      (S.dlg === 'camera' ? cameraHtml() : S.dlg === 'photo' ? photoHtml(room) : S.dlg === 'manage' ? manageHtml(room, isOwner) : S.dlg === 'confirm' && S.confirm ? confirmHtml() : S.dlg ? dialogHtml(room, mine, isOwner, today) : '');
  }
  function groupHtml(g) {
    var pct = g.total ? Math.round(g.n / g.total * 100) : 0;
    return '<section class="hub-collab-group' + (g.all ? ' is-all' : '') + '"><div class="hub-collab-group-main">' +
        '<span class="hub-collab-kicker">Chuỗi chung</span><b class="hub-collab-bignum">' + g.cur + '</b><span class="hub-collab-unit">ngày</span>' +
        '<span class="hub-collab-muted">Kỷ lục ' + g.best + '</span></div>' +
      '<div class="hub-collab-group-today"><span>' + (g.total ? (g.all ? 'Cả phòng đã check-in hôm nay' : g.n + '/' + g.total + ' người đã check-in hôm nay') : 'Hôm nay không ai có lịch') + '</span>' +
        '<span class="hub-collab-meter" aria-hidden="true"><i style="width:' + pct + '%"></i></span></div></section>';
  }
  function meHtml(mine, room, c, now) {
    var st = c.states[mine.uid], cm = curCommit(mine, c.today), cfg = room.cfg, ci = (room.checkins[mine.uid] || {})[c.today], body;
    if (!st.todayOn) body = '<p class="hub-collab-rest">Hôm nay không có lịch cho cam kết này — nghỉ ngơi nhé.</p>';
    else if (ci) {
      var canUndo = now - ci.at < UNDO_MS;
      body = '<div class="hub-collab-done">' + (ci.hasPhoto ? thumbHtml(mine.uid, c.today, mine.name, 'is-lg') : '<span class="hub-collab-tick" aria-hidden="true"></span>') + '<div><b>Đã check-in lúc ' + fmtTime(ci.at) + '</b>' +
        '<span class="hub-collab-muted">' + dayName(c.today) + ', ngày ' + fmtDay(c.today) + (ci.late ? ' · muộn so với giờ mục tiêu' : '') + (ci.note ? ' · “' + esc(ci.note) + '”' : '') + '</span></div>' +
        (canUndo ? '<button type="button" class="hub-collab-btn is-ghost" data-act="undo" data-until="' + (ci.at + UNDO_MS) + '">Hoàn tác</button>' : '') + '</div>';
    } else {
      body = '<div class="hub-collab-checkin"><p class="hub-collab-muted">Chụp ảnh ngay tại chỗ (đang làm / vừa làm xong cam kết) để được phép check-in.</p>' +
        '<button type="button" class="hub-collab-checkbtn" data-act="cam"><span>Chụp ảnh &amp; check-in</span><small data-hc-clock>' + fmtTime(now) + '</small></button></div>' +
        '<p class="hub-collab-muted" data-hc-left data-end="' + dayEndMs(c.today, cfg.cutoff) + '">Còn ' + leftText(dayEndMs(c.today, cfg.cutoff) - now) + ' đến giờ chốt ngày (' + pad(cfg.cutoff) + ':00)</p>';
    }
    return '<section class="hub-collab-me' + (ci ? ' is-done' : '') + '"><div class="hub-collab-me-top"><div><span class="hub-collab-kicker">Hôm nay · ' + dayName(c.today) + ', ' + fmtDay(c.today) + '</span>' +
        '<h3 class="hub-collab-commit">' + commitLine(cm) + '</h3></div>' +
        '<div class="hub-collab-vitals">' + heartsHtml(st.hearts, st.max) + '<span class="hub-collab-streak"><b>' + st.streak + '</b> ngày streak</span></div></div>' + body + '</section>';
  }
  function stripHtml(log) {
    var cells = log.slice(-28), pre = 28 - cells.length, h = '';
    for (var i = 0; i < pre; i++) h += '<i class="is-none"></i>';
    cells.forEach(function (e) { h += '<i class="is-' + e[1] + '" title="' + fmtDay(e[0]) + ' · ' + ({ ok: 'đã check-in', miss: 'lỡ (−1 tim)', ko: 'lỡ — hết tim, mất streak', rest: 'nghỉ', today: 'hôm nay chưa check-in' }[e[1]]) + '"></i>'; });
    return '<span class="hub-collab-strip" aria-hidden="true">' + h + '</span>';
  }
  function memberHtml(m, room, c, me, nudgedBy) {
    var st = c.states[m.uid], cm = curCommit(m, c.today), ci = (room.checkins[m.uid] || {})[c.today], isMe = m.uid === me, chip;
    if (!st.todayOn) chip = '<span class="hub-collab-status is-rest">Hôm nay nghỉ</span>';
    else if (ci) chip = '<span class="hub-collab-status is-done">Đã check-in ' + fmtTime(ci.at) + (ci.late ? ' · muộn' : '') + '</span>';
    else chip = '<span class="hub-collab-status is-wait">Chưa check-in</span>';
    var act = '';
    if (!isMe && st.todayOn && !ci) act = nudgedBy[m.uid] ? '<button type="button" class="hub-collab-btn" disabled>Đã nhắc</button>' : '<button type="button" class="hub-collab-btn" data-act="nudge" data-uid="' + esc(m.uid) + '">Nhắc nhẹ</button>';
    return '<article class="hub-collab-member' + (isMe ? ' is-me' : '') + (ci ? ' is-done' : '') + '">' +
      '<div class="hub-collab-avatar" aria-hidden="true" data-i="' + esc((m.name || '?').charAt(0).toUpperCase()) + '">' + esc((m.name || '?').charAt(0).toUpperCase()) + '</div>' +
      '<div class="hub-collab-member-main"><div class="hub-collab-member-top"><b>' + esc(m.name) + '</b>' + (isMe ? '<span class="hub-collab-me-tag">bạn</span>' : '') + chip + '</div>' +
        '<div class="hub-collab-muted">' + commitLine(cm) + '</div>' +
        '<div class="hub-collab-vitals">' + heartsHtml(st.hearts, st.max) + '<span class="hub-collab-streak"><b>' + st.streak + '</b> streak · kỷ lục ' + st.best + (st.kos ? ' · ' + st.kos + ' lần KO' : '') + '</span></div>' +
        stripHtml(st.log) + '</div><div class="hub-collab-member-act">' + (ci && ci.hasPhoto ? thumbHtml(m.uid, c.today, m.name, '') : '') + act + '</div></article>';
  }
  function feedHtml(c) {
    if (!c.feed.length) return '<p class="hub-collab-muted hub-collab-feed-empty">Chưa có ai check-in. Người đầu tiên là bạn?</p>';
    return '<ul class="hub-collab-feed">' + c.feed.map(function (e) {
      return '<li><time>' + fmtTime(e.at) + ' · ' + fmtDay(e.date) + '</time>' + (e.photo ? thumbHtml(e.uid, e.date, e.name, 'is-sm') : '') + '<span><b>' + esc(e.name) + '</b> đã check-in' + (e.note ? ' — “' + esc(e.note) + '”' : '') + '</span></li>';
    }).join('') + '</ul>';
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
        '<p class="hub-collab-muted">Đổi luật sẽ tính lại tim và streak của cả phòng theo toàn bộ lịch sử.</p><button type="button" class="hub-collab-btn" data-act="save-cfg">Lưu luật</button>' : '') +
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
  function thumbHtml(uid, date, name, cls) {
    return '<button type="button" class="hub-collab-thumb ' + cls + '" data-act="photo" data-uid="' + esc(uid) + '" data-date="' + esc(date) + '" data-name="' + esc(name) + '" aria-label="Xem ảnh check-in của ' + esc(name) + '"><img alt="" data-ph="' + esc(uid) + '|' + esc(date) + '"></button>';
  }
  function cameraHtml() {
    var c = S.cam, body, acts;
    if (c.shot) {
      body = '<img class="hub-collab-shot" alt="Ảnh vừa chụp" src="' + c.shot + '">';
      acts = '<input class="hub-collab-input" data-c="note" maxlength="120" placeholder="Ghi chú nhanh (tuỳ chọn)…" aria-label="Ghi chú" value="' + esc(c.note) + '">' +
        '<div class="hub-collab-camacts"><button type="button" class="hub-collab-btn" data-act="retake"' + (c.sending ? ' disabled' : '') + '>Chụp lại</button>' +
        '<button type="button" class="hub-collab-btn is-primary" data-act="sendshot"' + (c.sending ? ' disabled' : '') + '>' + (c.sending ? 'Đang gửi…' : 'Gửi &amp; check-in') + '</button></div>';
    } else if (c.err) {
      body = '<p class="hub-collab-cam-err">' + esc(c.err) + '</p>';
      acts = '<div class="hub-collab-camacts"><label class="hub-collab-btn is-primary">Mở camera của máy<input type="file" accept="image/*" capture="environment" id="hc-file" hidden></label>' +
        '<button type="button" class="hub-collab-btn" data-act="flip">Thử lại</button></div>';
    } else {
      body = '<video id="hc-video" playsinline autoplay muted></video>';
      acts = '<div class="hub-collab-camacts"><button type="button" class="hub-collab-btn" data-act="flip">Đổi camera</button>' +
        '<button type="button" class="hub-collab-btn is-primary hub-collab-shoot" data-act="shoot">Chụp</button></div>';
    }
    return '<div class="hub-collab-scrim" data-act="close"></div><div class="hub-collab-dialog hub-collab-dialog--cam" role="dialog" aria-modal="true" aria-labelledby="hc-dlg-title">' +
      '<div class="hub-collab-dialog-head"><h3 id="hc-dlg-title">Ảnh check-in</h3><button type="button" class="hub-collab-btn is-ghost" data-act="close" aria-label="Đóng">✕</button></div>' +
      '<div class="hub-collab-cam' + (c.facing === 'user' && !c.shot ? ' is-mirror' : '') + '">' + body + '</div>' + acts +
      '<p class="hub-collab-muted">Ảnh được đóng dấu giờ + tên, nén nhỏ, và cả phòng xem được. Chỉ chụp trực tiếp, không chọn ảnh có sẵn.</p></div>';
  }
  function photoHtml(room) {
    var v = S.photoView, ci = v && room.checkins[v.uid] && room.checkins[v.uid][v.date];
    return '<div class="hub-collab-scrim" data-act="close"></div><div class="hub-collab-dialog hub-collab-dialog--photo" role="dialog" aria-modal="true" aria-labelledby="hc-dlg-title">' +
      '<div class="hub-collab-dialog-head"><h3 id="hc-dlg-title">' + esc(v ? v.name : '') + (ci ? ' · ' + fmtTime(ci.at) + ' · ' + fmtDay(v.date) : '') + '</h3><button type="button" class="hub-collab-btn is-ghost" data-act="close" aria-label="Đóng">✕</button></div>' +
      '<div class="hub-collab-cam"><img class="hub-collab-shot" alt="Ảnh check-in" data-ph="' + esc(v ? v.uid : '') + '|' + esc(v ? v.date : '') + '"></div>' +
      (ci && ci.note ? '<p class="hub-collab-muted">“' + esc(ci.note) + '”</p>' : '') + '</div>';
  }

  /* ───────────── điều khiển ───────────── */
  function pickStore() {
    try { if (typeof firebase !== 'undefined' && firebase.apps && firebase.apps.length && firebase.auth().currentUser) return CloudStore(); } catch (e) {}
    return DemoStore();
  }
  function nowDay() { return dayKey(Date.now(), DEFAULT_CFG.cutoff); }
  function paint() {
    if (!S || !S.root) return;
    var v = S.root.querySelector('#hc-view'); if (!v) return;
    var ae = document.activeElement, keep = null, pos = null;                       // giữ con trỏ khi dữ liệu realtime vẽ lại giao diện
    if (ae && ae.getAttribute && v.contains(ae)) ['data-f', 'data-d', 'data-m', 'data-x', 'data-c'].forEach(function (a) { if (!keep && ae.getAttribute(a)) { keep = '[' + a + '="' + ae.getAttribute(a) + '"]'; pos = ae.selectionStart; } });
    v.innerHTML = S.view === 'room' ? (S.room ? viewRoom() : '<p class="hub-collab-muted hub-collab-loading">Đang mở phòng…</p>') : viewLobby();
    if (keep) { var k2 = v.querySelector(keep); if (k2) { k2.focus(); try { if (pos != null) k2.setSelectionRange(pos, pos); } catch (e) {} } }
    else if (S.dlg && !S._dlgFocused) {
      var dl = v.querySelector('.hub-collab-dialog'), tg = dl && (dl.querySelector(S.dlg === 'settings' ? '[data-d="title"]' : '[data-x="typed"]') || (S.dlg === 'manage' || S.dlg === 'confirm' ? dl : null));
      if (tg && tg.focus) { tg.focus(); S._dlgFocused = true; }
    }
    hydratePhotos();
    if (S.dlg === 'camera') attachCamera();
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
  function openRoom(id) { S.view = 'room'; S.roomId = id; S.room = null; S.calc = null; S.dlg = ''; S._dlgFocused = false; paint(); watchRoom(); }
  function closeRoom() {
    if (S.unwatch) { S.unwatch(); S.unwatch = null; }
    S.view = 'lobby'; S.room = null; S.calc = null; S.dlg = ''; S._dlgFocused = false; loadRooms();
  }
  function init() {
    if (S.unwatch) { S.unwatch(); S.unwatch = null; }
    S.store = pickStore(); S.view = 'lobby'; S.room = null; S.dlg = ''; loadRooms();
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
  function stopCamera() { if (S && S.cam && S.cam.stream) { S.cam.stream.getTracks().forEach(function (t) { t.stop(); }); S.cam.stream = null; } }
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
  /** Vẽ khung hình lên canvas ≤720px, đóng dấu giờ + ngày + tên, nén JPEG cho vừa một tài liệu Firestore (≲ 220KB). */
  function stampAndEncode(src, w, h) {
    var k = Math.min(1, 720 / Math.max(w, h)), cw = Math.round(w * k), ch = Math.round(h * k);
    var cv = document.createElement('canvas'); cv.width = cw; cv.height = ch;
    var x = cv.getContext('2d'); x.drawImage(src, 0, 0, cw, ch);
    var m = mineNow(), d = new Date(), fs = Math.max(12, Math.round(cw / 34));
    var label = pad(d.getHours()) + ':' + pad(d.getMinutes()) + ' · ' + pad(d.getDate()) + '/' + pad(d.getMonth() + 1) + '/' + d.getFullYear() + ' · ' + (m ? m.name : '');
    x.font = '600 ' + fs + 'px ui-monospace, Menlo, Consolas, monospace';
    var tw = x.measureText(label).width, bx = Math.round(fs * 0.6), by = ch - Math.round(fs * 2.1);
    x.fillStyle = 'rgba(0,0,0,0.58)'; x.fillRect(bx, by, tw + fs, Math.round(fs * 1.6));
    x.fillStyle = '#fff'; x.textBaseline = 'middle'; x.fillText(label, bx + fs / 2, by + Math.round(fs * 0.8));
    var q = 0.72, url = cv.toDataURL('image/jpeg', q);
    while (url.length > 300000 && q > 0.45) { q -= 0.07; url = cv.toDataURL('image/jpeg', q); }
    if (url.length > 300000) {                                         // hiếm: ảnh quá nhiều chi tiết → thu nhỏ thêm
      var c2 = document.createElement('canvas'); c2.width = Math.round(cw * 0.75); c2.height = Math.round(ch * 0.75);
      c2.getContext('2d').drawImage(cv, 0, 0, c2.width, c2.height); url = c2.toDataURL('image/jpeg', 0.6);
    }
    return url;
  }
  function useFile(file) {                                              // dự phòng khi không mở được camera trực tiếp (nút "Mở camera của máy")
    var img = new Image(), u = URL.createObjectURL(file);
    img.onload = function () { URL.revokeObjectURL(u); if (!S || !S.cam) return; S.cam.shot = stampAndEncode(img, img.naturalWidth, img.naturalHeight); S.cam.err = ''; paint(); };
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
    cam: function () { S.cam = { facing: 'environment', shot: '', err: '', note: '', stream: null, sending: false }; S.dlg = 'camera'; paint(); startCamera(); },
    flip: function () { var c = S.cam; if (!c) return; if (!c.err) c.facing = c.facing === 'user' ? 'environment' : 'user'; c.shot = ''; c.err = ''; paint(); startCamera(); },
    shoot: function () {
      var v = S.root.querySelector('#hc-video');
      if (!v || !v.videoWidth) { toast('Camera chưa sẵn sàng, đợi một chút nhé.'); return; }
      S.cam.shot = stampAndEncode(v, v.videoWidth, v.videoHeight); stopCamera(); paint();
    },
    retake: function () { S.cam.shot = ''; paint(); startCamera(); },
    sendshot: function () {
      var c = S.cam, m = mineNow(); if (!c || !c.shot || !m || c.sending) return;
      var today = S.calc.today, cm = curCommit(m, today), tm = targetMs(today, cm.target, S.room.cfg.cutoff), key = m.uid + '|' + today;
      c.sending = true; paint();
      S.store.checkIn(S.roomId, today, (c.note || '').trim().slice(0, 120), !!tm && Date.now() > tm, c.shot).then(function () {
        S.photos[key] = c.shot; stopCamera(); S.cam = null; S.dlg = ''; paint(); toast('Đã check-in lúc ' + fmtTime(Date.now()) + ' kèm ảnh.');
      }, function (e) { if (S.cam) { S.cam.sending = false; paint(); } toast(errMsg(e)); });
    },
    photo: function (el) { S.photoView = { uid: el.getAttribute('data-uid'), date: el.getAttribute('data-date'), name: el.getAttribute('data-name') }; S.dlg = 'photo'; paint(); },
    undo: function () { var m = mineNow(); guard(S.store.undo(S.roomId, S.calc.today)).then(function () { if (m) delete S.photos[m.uid + '|' + S.calc.today]; toast('Đã hoàn tác check-in hôm nay.'); }); },
    nudge: function (el) { guard(S.store.nudge(S.roomId, el.getAttribute('data-uid'), S.calc.today)).then(function () { toast('Đã nhắc bạn ấy.'); }); },
    dlg: function (el) {
      var m = mineNow(), c = curCommit(m, S.calc.today), kind = el && el.getAttribute('data-dlg') === 'manage' ? 'manage' : 'settings';
      S.dlg = kind; S._dlgFocused = false;
      S.dlgForm = { title: c.title, freq: c.freq, target: c.target || '', max: S.room.cfg.maxHearts, regen: S.room.cfg.regenDays };
      S.mg = { name: S.room.name, max: S.room.maxMembers, expiry: DEFAULT_EXPIRY };
      paint();
    },
    close: function () {
      if (S.confirm) { if (S.confirm.busy) return; S.dlg = S.confirm.back || ''; S.confirm = null; S._dlgFocused = false; paint(); return; }   // huỷ xác nhận → về hộp thoại trước
      stopCamera(); S.cam = null; S.photoView = null; S.dlg = ''; S._dlgFocused = false; paint();
    },
    'save-commit': function () {
      var f = S.dlgForm, m = mineNow(), today = S.calc.today, title = (f.title || '').trim();
      if (!title) { toast('Cam kết không được để trống.'); return; }
      var cur = curCommit(m, today), freq = f.freq === 'weekdays' ? 'weekdays' : 'daily', target = /^\d\d:\d\d$/.test(f.target) ? f.target : '';
      if (cur.title === title && cur.freq === freq && (cur.target || '') === target) { toast('Không có gì thay đổi.'); return; }
      var next = (m.commits || []).filter(function (c) { return c.from <= today; }).concat([{ from: addDays(today, 1), title: title, freq: freq, target: target }]);
      guard(S.store.setCommits(S.roomId, next)).then(function () { S.dlg = ''; paint(); toast('Cam kết mới có hiệu lực từ ngày mai.'); });
    },
    'save-cfg': function () { var f = S.dlgForm; guard(S.store.setCfg(S.roomId, { maxHearts: f.max, regenDays: f.regen })).then(function () { toast('Đã cập nhật luật phòng.'); }); },
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
      else if ((k = t.getAttribute('data-x')) && S.confirm) {
        if (k === 'opt' && S.confirm.opt) S.confirm.opt.checked = t.checked; else if (k === 'typed') S.confirm.typed = t.value;
        var okb = root.querySelector('[data-act="confirm-ok"]'); if (okb && !S.confirm.busy) okb.disabled = !confirmReady();
      }
    });
    root.addEventListener('change', function (e) { if (e.target.id === 'hc-file' && e.target.files && e.target.files[0]) useFile(e.target.files[0]); });
    root.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && S.dlg) { e.stopPropagation(); ACTIONS.close(); return; }
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
    try {
      if (typeof firebase !== 'undefined' && firebase.apps && firebase.apps.length) {
        S.authUnsub = firebase.auth().onAuthStateChanged(function (u) {
          var want = u ? 'cloud' : 'demo';
          if (S && S.store && S.store.mode === want && (want === 'demo' || S.store.uid === u.uid)) return;
          if (S) init();
        });
      }
    } catch (e) {}
    if (!S.store) init();
    S.timer = setInterval(tick, 15000);
  }
  function destroy() {
    if (!S) return;
    stopCamera();
    if (S.unwatch) S.unwatch();
    if (S.timer) clearInterval(S.timer);
    if (S.authUnsub) { try { S.authUnsub(); } catch (e) {} }
    clearTimeout(S.toastT);
    if (S.root) S.root.innerHTML = '';
    S = null;
  }

  return {
    id: 'collab-hub', name: 'Cộng tác', icon: ICON, render: render, destroy: destroy,
    _internals: { replay: replay, groupStreak: groupStreak, computeRoom: computeRoom, dayKey: dayKey, scheduled: scheduled, targetMs: targetMs, addDays: addDays, DemoStore: DemoStore, inviteState: inviteState, expiryMs: expiryMs, spanText: spanText }   // chỉ để kiểm thử
  };
})();

// Auto-register
if (typeof app !== 'undefined' && app && typeof app.register === 'function') {
  app.register(collaborationModule);
}