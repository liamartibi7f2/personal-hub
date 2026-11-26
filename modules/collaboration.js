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

    v5 — avatar: mỗi người chọn 1 trong các ảnh có sẵn (AVATARS) ở Cài đặt; lưu `avatar` (id) trong hồ sơ thành viên của từng phòng.

    v6 — Đề ngày (daily quest): mỗi ngày có một ĐỀ CHỤP ẢNH cho cả phòng khi check-in (VD "thứ màu đỏ gần bạn nhất").
      1) Người ra đề  chủ phòng chọn chế độ: 'random' (mỗi ngày bốc thăm một người, túi bốc thăm công bằng, ai cũng thấy lịch 7 ngày tới),
                      'owner' (chỉ chủ phòng ra đề) hoặc 'off'. Người ra đề đăng trước; quên đăng → dùng đề dự phòng (QUEST_POOL), không phạt tim.
      2) Check-in     ảnh mang `qid` + `qt` (bản chụp tiêu đề) và được đóng dấu đề; phòng bật đề thì Rules bắt buộc có `qid`.
      3) Duyệt chéo   thêm lá phiếu "Lạc đề" (= 'ok' + off:true): ảnh thật nhưng sai đề. Quá nửa người khác báo lạc đề → mất ✦ hôm đó,
                      check-in VẪN TÍNH (khác "Nghi ngờ" — chỉ nghi ngờ mới hủy check-in). Chuỗi "đúng đề" tính lại từ dữ liệu như streak.

   Quản lý phòng (chủ phòng): mã mời có hạn dùng · đổi mã · khoá/mở phòng · giới hạn số người ·
   đổi tên · mời thành viên ra · chuyển chủ phòng · xoá phòng. Thành viên: xem mã + danh sách, tự rời.
   ================================================================ */
const collaborationModule = (function () {
  'use strict';

  var LEGACY_DEMO_KEY = 'hub_collab_demo_v1';   // dữ liệu demo cũ trong localStorage: xoá một lần khi mở module
  var FORM_KEY = 'hub_collab_form';
  var WRECAP_KEY = 'hub_collab_wrecap_v1';
  var UNDO_MS = 5 * 60 * 1000;                    // hoàn tác check-in trong 5 phút
  var DEFAULT_CFG = { maxHearts: 5, regenDays: 7, cutoff: 4, challenge: true, quest: 'random' };   // cutoff = giờ chốt ngày (04:00 sáng)
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
  var VOTE_TEXT = { ok: 'Hợp lệ', sus: 'Nghi ngờ', off: 'Lạc đề' };
  /* ── Đề ngày (daily quest) ── */
  var QUEST_AHEAD = 7;                             // lịch ra đề công khai trước 7 ngày
  var QUEST_WINDOW = 35;                           // chỉ tải / tính đề trong 35 ngày gần nhất
  var QUEST_TITLE_MAX = 60, QUEST_HINT_MAX = 120;
  var QUEST_CANDS = 3;                             // chỉ 3 người đầu danh sách bốc thăm (chính + 2 dự bị) được đăng đề cho một ngày
  var QUEST_MODES = [['random', 'Ngẫu nhiên — mỗi ngày bốc thăm một người ra đề'], ['owner', 'Chỉ chủ phòng ra đề'], ['off', 'Tắt']];
  /* Kho đề dự phòng: dùng khi người được bốc thăm chưa đăng đề. Chỉ chụp đồ vật / khung cảnh, không bắt chụp người khác. */
  var QUEST_POOL = [
    { t: 'Thứ màu đỏ gần bạn nhất', h: 'Chụp một vật màu đỏ trong tầm tay, đừng đi tìm quá xa.' },
    { t: 'Góc bàn học / làm việc của bạn', h: 'Chụp nguyên trạng, không dọn trước.' },
    { t: 'Bữa ăn hoặc ly nước gần nhất', h: 'Một góc bữa ăn, hoặc ly nước bạn đang uống.' },
    { t: 'Cái bóng của bạn', h: 'Bóng của chính bạn (hoặc của một vật) trên tường hay sàn.' },
    { t: 'Bầu trời lúc này', h: 'Ngước lên mà chụp; ở trong nhà thì chụp qua cửa sổ.' },
    { t: 'Đôi giày / dép hôm nay', h: 'Chụp thứ đang ở dưới chân bạn.' },
    { t: 'Thứ nhỏ nhất bạn tìm được', h: 'Đặt cạnh bàn tay hoặc đồng xu để thấy được cỡ.' },
    { t: 'Một vật hình tròn', h: 'Đĩa, đồng hồ, nắp chai, bánh xe… miễn là tròn.' },
    { t: 'Ánh sáng đẹp nhất quanh bạn', h: 'Nắng qua rèm, đèn bàn hay màn hình đều được.' },
    { t: 'Cốc / ly bạn đang dùng', h: 'Chụp cận cảnh, thấy được hơi nước hoặc giọt nước nếu có.' },
    { t: 'Một thứ màu xanh lá', h: 'Cây, lá, vỏ hộp… miễn là xanh lá.' },
    { t: 'Bàn tay đang làm việc', h: 'Tay bạn đang cầm bút, chuột hoặc quyển sách.' },
    { t: 'Trang sách / tài liệu đang mở', h: 'Chụp trang bạn đang đọc, hoặc bìa quyển đang dùng.' },
    { t: 'Một thứ có chữ', h: 'Biển hiệu, bao bì, vở… chụp cho đọc rõ chữ.' },
    { t: 'Cảnh nhìn từ chỗ bạn ngồi', h: 'Chụp đúng hướng mắt bạn đang nhìn ra phía trước.' },
    { t: 'Món đồ cũ nhất trong tầm với', h: 'Đồ dùng lâu năm, kể cả sách vở cũ.' },
    { t: 'Một thứ màu vàng', h: 'Càng nhỏ càng tốt, miễn là màu vàng rõ.' },
    { t: 'Góc nhìn từ trên xuống', h: 'Chụp thẳng từ trên cao xuống bàn hoặc sàn.' },
    { t: 'Chụp xuyên qua một vật trong suốt', h: 'Qua cốc nước, tấm kính hoặc chai nhựa.' },
    { t: 'Một vật có tính đối xứng', h: 'Chụp sao cho thấy rõ hai bên giống nhau.' },
    { t: 'Dây điện, ổ cắm hoặc sạc của bạn', h: 'Chụp bộ dây quen thuộc nhất trên bàn.' },
    { t: 'Thứ bạn đang uống hoặc muốn uống', h: 'Nước, trà, cà phê… hoặc chai bạn hay mang theo.' },
    { t: 'Cửa sổ gần nhất', h: 'Chụp cả khung cửa và thứ nhìn thấy bên ngoài.' },
    { t: 'Một thứ có số', h: 'Đồng hồ, biển số, trang sách, hóa đơn… số phải rõ.' },
    { t: 'Chiếc túi / balo của bạn', h: 'Chụp ngoài hoặc mở ra một góc bên trong.' },
    { t: 'Một thứ bạn dùng mỗi ngày', h: 'Món đồ nhỏ mà thiếu nó là thấy bất tiện.' },
    { t: 'Thứ gì đang phát sáng', h: 'Đèn, màn hình, đèn báo… chụp thấy rõ ánh sáng.' },
    { t: 'Cây cối quanh bạn', h: 'Một cây, một chậu hoặc một chiếc lá cũng được.' },
    { t: 'Đồ vật sắp xếp thẳng hàng', h: 'Sách trên giá, bút trong hộp, đồ trong tủ…' },
    { t: 'Chụp sát một chất liệu', h: 'Gỗ, vải, kim loại, giấy… thấy rõ vân bề mặt.' },
    { t: 'Chiếc ghế bạn đang ngồi', h: 'Chụp ghế từ góc nào cũng được, miễn nhận ra là ghế.' },
    { t: 'Một thứ màu xanh dương', h: 'Vật dụng, bìa vở, quần áo… miễn là xanh dương.' },
    { t: 'Mặt đồng hồ hoặc giờ hiện trên máy', h: 'Chụp để thấy rõ giờ lúc này.' },
    { t: 'Thứ đang đặt gần màn hình nhất', h: 'Chụp cả màn hình lẫn món đồ bên cạnh.' },
    { t: 'Đường bạn đi hôm nay', h: 'Lối đi, cầu thang hoặc hành lang bạn vừa đi qua.' },
    { t: 'Bàn chân và nền nhà', h: 'Chụp xuống dưới chân, thấy được nền đang đứng.' },
    { t: 'Một thứ làm bạn tập trung', h: 'Tai nghe, ly cà phê, tờ giấy ghi chú… tuỳ bạn.' },
    { t: 'Món đồ trên cùng của chồng sách / giấy', h: 'Chụp thứ nằm trên cùng trong đống đồ gần bạn.' },
    { t: 'Một vật có hoa văn', h: 'Họa tiết trên áo, gối, tách, bìa vở…' },
    { t: 'Hai thứ cùng màu đặt cạnh nhau', h: 'Tự chọn màu, miễn là hai vật cùng màu rõ ràng.' },
    { t: 'Thứ cuối cùng bạn chạm vào', h: 'Chụp ngay món đồ đang ở trong tay hoặc trên tay bạn.' }
  ];
  var AVATAR_KEY = 'hub_collab_avatar';              // avatar đã chọn (nhớ trên máy này để phòng mới dùng luôn)
  /* Avatar có sẵn (ảnh 160×160 nhúng thẳng trong file). Firestore chỉ lưu `id` ('' = dùng chữ cái đầu tên). */
  var AVATARS = [
    { id: 'cuoi', label: 'Cười toe', src: 'data:image/png;base64,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' },
    { id: 'kinh', label: 'Đeo kính', src: 'data:image/png;base64,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' },
    { id: 'ghichep', label: 'Ghi chép', src: 'data:image/png;base64,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' },
    { id: 'buon', label: 'Hơi buồn', src: 'data:image/png;base64,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' },
    { id: 'soc', label: 'Mắt đỏ', src: 'data:image/png;base64,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' },
    { id: 'khoc', label: 'Gào khóc', src: 'data:image/png;base64,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' },
    { id: 'muuma', label: 'Mưu mô', src: 'data:image/png;base64,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' },
    { id: 'ngai', label: 'Má hồng', src: 'data:image/png;base64,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' },
    { id: 'chumoi', label: 'Chu môi', src: 'data:image/png;base64,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' },
    { id: 'leluoi', label: 'Lè lưỡi', src: 'data:image/png;base64,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' }
  ];

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
  /* ───────────── avatar ───────────── */
  function avatarById(id) { for (var i = 0; i < AVATARS.length; i++) if (AVATARS[i].id === id) return AVATARS[i]; return null; }
  function initialOf(name) { return (name || '?').charAt(0).toUpperCase(); }
  function loadAvatarPref() { try { var v = localStorage.getItem(AVATAR_KEY) || ''; return avatarById(v) ? v : ''; } catch (e) { return ''; } }
  function saveAvatarPref(id) { try { if (id) localStorage.setItem(AVATAR_KEY, id); else localStorage.removeItem(AVATAR_KEY); } catch (e) {} }
  /** Avatar của một thành viên: ảnh nếu đã chọn, không thì chữ cái đầu tên. `extra` = class thêm (vd 'is-sm'). */
  function avatarHtml(m, extra) {
    var ini = esc(initialOf(m && m.name)), av = avatarById(m && m.avatar);
    return '<div class="hub-collab-avatar' + (extra ? ' ' + extra : '') + (av ? ' has-img' : '') + '" aria-hidden="true" data-i="' + ini + '">' +
      (av ? '<img src="' + av.src + '" alt="" draggable="false">' : ini) + '</div>';
  }
  /** Bộ chọn avatar trong Cài đặt (bấm là lưu ngay). */
  function avatarPickerHtml(cur, name) {
    var ini = esc(initialOf(name)), curOpt = avatarById(cur), curLabel = curOpt ? curOpt.label : 'Chữ cái';
    var opts = [{ id: '', label: 'Chữ cái' }].concat(AVATARS);
    return '<section class="hub-collab-dcard">' +
      '<div class="hub-collab-dcard-head"><h4>Avatar của bạn</h4><span class="hub-collab-dcard-meta">Đang dùng: ' + esc(curLabel) + '</span></div>' +
      '<div class="hub-collab-avpick" role="group" aria-label="Chọn avatar">' + opts.map(function (o) {
        var on = o.id === cur;
        return '<button type="button" class="hub-collab-avopt' + (on ? ' is-on' : '') + '" aria-pressed="' + on + '" data-act="pick-avatar" data-av="' + o.id + '" title="' + esc(o.label) + '">' +
          '<span class="hub-collab-avopt-pic' + (o.id ? '' : ' is-letter') + '">' + (o.id ? '<img src="' + o.src + '" alt="" draggable="false">' : ini) + '</span>' +
          '<span class="hub-collab-avopt-name">' + esc(o.label) + '</span></button>';
      }).join('') + '</div>' +
      '<p class="hub-collab-dcard-hint">Hiển thị thay chữ cái đầu tên, áp dụng cho mọi phòng của bạn.</p>' +
      '</section>';
  }
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
    var others = members.filter(function (m) { return m.uid !== ck.uid; }), ids = {}, votes = {}, offs = {}, ok = 0, sus = 0, offN = 0, target = ck.uid + '_' + ck.date;
    others.forEach(function (m) { ids[m.uid] = true; });
    (reviews || []).forEach(function (r) { if (r.target === target && r.ref === ck.sec && ids[r.by] && (r.v === 'ok' || r.v === 'sus')) { votes[r.by] = r.v; if (r.v === 'ok' && r.off === true && ck.qid) offs[r.by] = true; } });
    Object.keys(votes).forEach(function (u) { if (votes[u] === 'ok') ok++; else sus++; });
    Object.keys(offs).forEach(function () { offN++; });
    return { n: others.length, ok: ok, sus: sus, off: offN, offVotes: offs, offTopic: !!ck.qid && others.length > 0 && offN * 2 > others.length, wait: others.length - ok - sus, votes: votes, voided: others.length > 0 && sus * 2 > others.length, need: Math.floor(others.length / 2) + 1, open: now < ck.at + REVIEW_MS };
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

  /* ───────────── Đề ngày (daily quest) — hàm thuần, kiểm thử được ─────────────
     Mỗi ngày một người được BỐC THĂM ra đề cho cả phòng; mọi máy tính ra cùng một kết quả (không lưu "ai ra đề").
     Túi bốc thăm: với n thành viên, chia ngày thành các khối n ngày; mỗi khối xáo thứ tự thành viên theo seed
     (roomId, khối, n) nên mỗi người ra đúng 1 lần trong n ngày. Chỉ QUEST_CANDS người đầu (chính + dự bị) được đăng đề cho ngày đó;
     người chính "nhường lượt" (doc pass) thì lượt chuyển cho người dự bị kế tiếp. Không ai đăng → dùng đề dự phòng (QUEST_POOL). */
  function qseed(s) { var h = 2166136261; s = String(s); for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
  function qrng(a) { return function () { a = (a + 0x6D2B79F5) | 0; var t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  function seededShuffle(list, seed) {
    var a = list.slice(), r = qrng(seed), i, j, t;
    for (i = a.length - 1; i > 0; i--) { j = Math.floor(r() * (i + 1)); t = a[i]; a[i] = a[j]; a[j] = t; }
    return a;
  }
  function dayIndex(s) { var p = String(s).split('-'); return Math.floor(Date.UTC(+p[0], +p[1] - 1, +p[2]) / 86400000); }
  /** Danh sách người được quyền đăng đề cho `date`, theo thứ tự ưu tiên (chính, dự bị 1, dự bị 2). */
  function questCands(room, date) {
    if (room.cfg && room.cfg.quest === 'owner') return room.ownerUid ? [room.ownerUid] : [];
    var uids = (room.members || []).map(function (m) { return m.uid; }).sort(), n = uids.length;
    if (!n) return [];
    var idx = dayIndex(date), block = Math.floor(idx / n), pos = idx % n, perm = seededShuffle(uids, qseed(room.id + '|' + block + '|' + n)), out = [];
    for (var i = 0; i < Math.min(QUEST_CANDS, n); i++) out.push(perm[(pos + i) % n]);
    return out;
  }
  /** Đề của một ngày: { date, mode, cands, passed, doc, pool, setter, qid, title, hint, open }; null nếu phòng tắt đề ngày.
      Đề đã đăng thì giữ khi phòng đổi thành viên (chỉ bỏ nếu người đăng rời phòng). Ngày đã qua: nhận đề của bất kỳ thành viên hiện tại, đăng sớm nhất thắng. */
  function questFor(room, date, today) {
    var mode = room.cfg && room.cfg.quest;
    if (mode !== 'random' && mode !== 'owner') return null;
    var cands = questCands(room, date), ids = {}, passed = {}, best = null, rank = 99, i;
    (room.members || []).forEach(function (m) { ids[m.uid] = true; });
    (room.quests || []).forEach(function (q) {
      if (q.date !== date || !ids[q.by]) return;
      if (q.pass) { passed[q.by] = true; return; }
      var r = cands.indexOf(q.by);
      if (r < 0) { if (date >= today) return; r = 50; }
      if (!best || r < rank || (r === rank && q.at < best.at)) { best = q; rank = r; }
    });
    var setter = '';
    for (i = 0; i < cands.length; i++) if (!passed[cands[i]]) { setter = cands[i]; break; }
    // Đã có người check-in trong ngày này → đề của ngày đã được dùng (check-in giữ bản chụp tiêu đề): khoá, không đăng / sửa / xoá nữa.
    var locked = Object.keys(room.checkins || {}).some(function (u) { return !!(room.checkins[u] && room.checkins[u][date]); });
    var o = { date: date, mode: mode, cands: cands, passed: passed, doc: best, pool: !best, locked: locked, open: date >= today && !locked };
    if (best) { o.setter = best.by; o.qid = date + '_' + best.by; o.title = best.title; o.hint = best.hint || ''; }
    else {
      var pi = qseed((room.id || '') + '|' + date) % QUEST_POOL.length;
      o.setter = setter; o.qid = 'pool' + pi; o.title = QUEST_POOL[pi].t; o.hint = QUEST_POOL[pi].h; o.poolIdx = pi;
    }
    return o;
  }
  /** Tổng hợp đề cho giao diện: đề hôm nay, lịch 7 ngày, số lần bỏ lượt (ước tính 35 ngày gần nhất), chuỗi ngày chụp đúng đề của từng người. */
  function questSummary(room, all, by, today, cfg) {
    if (cfg.quest !== 'random' && cfg.quest !== 'owner') return null;
    var out = { today: questFor(room, today, today), plan: [], skips: {}, streak: {} }, first = '', k, d;
    for (k = 1; k <= QUEST_AHEAD; k++) out.plan.push(questFor(room, addDays(today, k), today));
    (room.quests || []).forEach(function (q) { if (!first || q.date < first) first = q.date; });
    all.forEach(function (x) { if (x.qid && (!first || x.date < first)) first = x.date; });
    if (first) {
      var floor = addDays(today, -QUEST_WINDOW), from = first < floor ? floor : first;
      for (d = from; d < today; d = addDays(d, 1)) {
        if (!room.members.some(function (m) { return scheduled(m, d); })) continue;       // ngày không ai có lịch: không tính lượt
        var q = questFor(room, d, today);
        if (q && q.pool && q.setter) out.skips[q.setter] = (out.skips[q.setter] || 0) + 1;
      }
    }
    room.members.forEach(function (m) {
      var run = 0, best = 0, n = 0, s = startOf(m);
      if (!first) { out.streak[m.uid] = { cur: 0, best: 0, n: 0 }; return; }
      if (!s || s < first) s = first;
      for (d = s; d <= today; d = addDays(d, 1)) {
        if (!scheduled(m, d)) continue;
        var x = by[m.uid + '|' + d];
        if (x && !x.j.voided && x.qid && !x.j.offTopic) { run++; n++; if (run > best) best = run; }
        else if (d < today) run = 0;                                                         // hôm nay chưa chụp: chưa tính là đứt
      }
      out.streak[m.uid] = { cur: run, best: best, n: n };
    });
    return out;
  }
  /** Lá phiếu hiện tại của một người trên một check-in: 'ok' | 'off' (ảnh thật nhưng lạc đề) | 'sus' | ''. */
  function voteKey(j, uid) { var v = j.votes[uid]; return !v ? '' : v === 'sus' ? 'sus' : (j.offVotes && j.offVotes[uid] ? 'off' : 'ok'); }

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
        flat.push({ uid: uid, date: date, ci: ci, at: ci.at, sec: typeof ci.sec === 'number' && ci.sec > 0 ? ci.sec : Math.floor(ci.at / 1000), note: ci.note || '', photo: !!ci.hasPhoto, ch: ci.ch || '', ph: ci.ph || '', pm: ci.pm || '', mode: ci.mode || 'all', qid: ci.qid || '', qt: ci.qt || '' });
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
    res.quest = questSummary(room, all, by, today, cfg);
    res.weekly = weeklySummary(room, res, lastWeekStart(today));
    return res;
  }

  /* ───────────── CloudStore (Firebase Auth + Firestore) ─────────────
     rooms/{roomId}                       { name, code, ownerUid, maxHearts, regenDays, cutoff, challenge, createdAt,
                                            maxMembers, joinOpen, memberCount, deleting? }
     rooms/{roomId}/members/{uid}         { uid, name, commits[], joinedAt, code?, avatar? }   ← avatar = id trong AVATARS ('' / thiếu = chữ cái)
     rooms/{roomId}/checkins/{uid_date}   { uid, date, day, at(serverTimestamp), note, late, hasPhoto, ch, ph, pm }
     rooms/{roomId}/reviews/{uid_date_voter} { target, by, v:'ok'|'sus', ref(giây của checkin.at), at }
     rooms/{roomId}/photos/{uid_date}     { uid, date, img(JPEG dataURL ≤ ~220KB), at }   ← tách riêng để tải lịch sử check-in vẫn nhẹ
     rooms/{roomId}/nudges/{from_to_date} { from, to, date, at }
     rooms/{roomId}/quests/{date_uid}      { date, day, by, title, hint, pass, at }   ← Đề ngày: người được bốc thăm đăng; pass = nhường lượt
     (checkins còn có qid, qt khi phòng bật Đề ngày · reviews còn có off:true = "Lạc đề")
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
    function memberDoc(prof, today) {
      var d = { uid: me.uid, name: prof.name, commits: [{ from: today, title: prof.title, freq: prof.freq, target: prof.target || '' }], joinedAt: FV.serverTimestamp() };
      if (avatarById(prof.avatar)) d.avatar = prof.avatar;
      return d;
    }
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
        b.set(ref, { name: name, code: code, ownerUid: me.uid, maxHearts: DEFAULT_CFG.maxHearts, regenDays: DEFAULT_CFG.regenDays, cutoff: DEFAULT_CFG.cutoff, challenge: DEFAULT_CFG.challenge, quest: DEFAULT_CFG.quest,
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
        var st = { room: null, members: [], mLoaded: false, checkins: [], nudges: [], reviews: [], quests: [], invite: null, invCode: '', offInv: null, healed: -1 }, offs = [], today = dayKey(Date.now(), DEFAULT_CFG.cutoff);
        function emit() {
          if (!st.room) return;
          var r = st.room, co = {};
          if (r.deleting && r.ownerUid !== me.uid) { cb(null, { code: 'deleting' }); return; }       // chủ phòng đã bấm xoá
          if (st.mLoaded && r.ownerUid === me.uid && !r.deleting && r.memberCount !== st.members.length && st.healed !== st.members.length) {
            st.healed = st.members.length;                                                         // phòng cũ / lệch số đếm → chủ phòng tự chỉnh lại
            rRef(id).update({ memberCount: st.members.length }).catch(function () {});
          }
          st.checkins.forEach(function (c) { (co[c.uid] = co[c.uid] || {})[c.date] = { at: ms(c.at), sec: c.at && typeof c.at.seconds === 'number' ? c.at.seconds : 0, note: c.note || '', late: !!c.late, hasPhoto: !!c.hasPhoto, ch: c.ch || '', ph: c.ph || '', pm: c.pm || '', mode: c.photoMode || 'all', qid: c.qid || '', qt: c.qt || '' }; });
          cb({ id: id, name: r.name, code: r.code, ownerUid: r.ownerUid, deleting: !!r.deleting,
            joinOpen: r.joinOpen !== false, maxMembers: r.maxMembers || LEGACY_MAX_MEMBERS, invite: st.invite,
            cfg: { maxHearts: r.maxHearts || DEFAULT_CFG.maxHearts, regenDays: r.regenDays || DEFAULT_CFG.regenDays, cutoff: r.cutoff == null ? DEFAULT_CFG.cutoff : r.cutoff, challenge: r.challenge === true, quest: r.quest === 'random' || r.quest === 'owner' ? r.quest : 'off' },
            members: st.members, checkins: co, nudges: st.nudges, reviews: st.reviews, quests: st.quests });
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
          st.members = s.docs.map(function (d) { var x = d.data(); return { uid: x.uid || d.id, name: x.name || '?', avatar: avatarById(x.avatar) ? x.avatar : '', commits: x.commits || [], joinedAt: x.joinedAt && x.joinedAt.toMillis ? x.joinedAt.toMillis() : 0 }; });
          st.mLoaded = true; emit();
        }, fail));
        offs.push(rRef(id).collection('checkins').onSnapshot(function (s) { st.checkins = s.docs.map(function (d) { return d.data(); }); emit(); }, fail));
        offs.push(rRef(id).collection('nudges').where('date', '>=', addDays(today, -1)).onSnapshot(function (s) { st.nudges = s.docs.map(function (d) { return d.data(); }); emit(); }, fail));
        offs.push(rRef(id).collection('reviews').onSnapshot(function (s) { st.reviews = s.docs.map(function (d) { var x = d.data(); return { target: x.target, by: x.by, v: x.v, ref: x.ref, off: x.off === true }; }); emit(); }, fail));   // phải tải HẾT phiếu: phán quyết cũ không được đổi khi phiếu rơi khỏi truy vấn
        offs.push(rRef(id).collection('quests').where('date', '>=', addDays(today, -QUEST_WINDOW)).onSnapshot(function (s) {
          st.quests = s.docs.map(function (d) { var x = d.data(); return { date: x.date, by: x.by, title: x.title || '', hint: x.hint || '', pass: x.pass === true, at: ms(x.at) }; }); emit();
        }, function () { st.quests = []; emit(); }));                       // lỗi (vd Rules chưa cập nhật) chỉ làm mất đề, không đá người dùng khỏi phòng
        return function () { offs.forEach(function (f) { try { f(); } catch (e) {} }); if (st.offInv) { try { st.offInv(); } catch (e) {} } };
      },
      checkIn: function (id, date, note, late, photo, extra) {          // ảnh + check-in ghi cùng một lúc (batch) — thiếu ảnh thì Rules từ chối
        extra = extra || {};
        if (!photo) return Promise.reject(new Error('Cần chụp ảnh để check-in.'));
        var key = me.uid + '_' + date, b = db.batch();
        b.set(rRef(id).collection('photos').doc(key), { uid: me.uid, date: date, img: photo, at: FV.serverTimestamp() });
        var ck = { uid: me.uid, date: date, day: dayNum(date), at: FV.serverTimestamp(), note: note || '', late: !!late, hasPhoto: true, ch: extra.ch || '', ph: extra.ph || '', pm: extra.pm || '' };
        if (extra.qid) { ck.qid = extra.qid; ck.qt = String(extra.qt || '').slice(0, QUEST_TITLE_MAX); }        // chỉ gửi khi phòng có Đề ngày
        b.set(rRef(id).collection('checkins').doc(key), ck);
        return b.commit();
      },
      review: function (id, uid, date, v, ref, off) {           // một phiếu mỗi (ảnh, người duyệt); đổi ý = ghi đè (Rules chỉ cho đổi v / ref / at / off)
        var target = uid + '_' + date, d = { target: target, by: me.uid, v: v, ref: ref, at: FV.serverTimestamp() };
        if (off === true && v === 'ok') d.off = true;            // "Lạc đề" = hợp lệ nhưng sai đề (chỉ có nghĩa với check-in có qid)
        return rRef(id).collection('reviews').doc(target + '_' + me.uid).set(d);
      },
      getPhoto: async function (id, uid, date) { var s = await rRef(id).collection('photos').doc(uid + '_' + date).get(); return s.exists ? (s.data().img || '') : ''; },
      undo: function (id, date) {
        var key = me.uid + '_' + date, b = db.batch();
        b.delete(rRef(id).collection('checkins').doc(key));
        b.delete(rRef(id).collection('photos').doc(key));
        return b.commit();
      },
      setCommits: function (id, commits) { return rRef(id).collection('members').doc(me.uid).update({ commits: commits }); },
      setAvatar: async function (id, avatar) {                 // phòng đang mở: chờ kết quả; các phòng khác của mình: làm nền, lỗi thì bỏ qua
        var val = avatar || '';
        await rRef(id).collection('members').doc(me.uid).update({ avatar: val });
        profRef().get().then(function (s) {
          ((s.exists && s.data().ids) || []).filter(function (x) { return x !== id; }).forEach(function (x) {
            rRef(x).collection('members').doc(me.uid).update({ avatar: val }).catch(function () {});
          });
        }).catch(function () {});
      },
      nudge: function (id, to, date) { return rRef(id).collection('nudges').doc(me.uid + '_' + to + '_' + date).set({ from: me.uid, to: to, date: date, at: FV.serverTimestamp() }); },
      setCfg: function (id, cfg) {
        var u = { maxHearts: cfg.maxHearts, regenDays: cfg.regenDays, challenge: !!cfg.challenge };
        if (cfg.quest === 'random' || cfg.quest === 'owner' || cfg.quest === 'off') u.quest = cfg.quest;
        return rRef(id).update(u);
      },
      /* ---- Đề ngày: doc id = <date>_<uid người đăng>; sửa = update (title / hint / pass), nhường lượt = pass:true ---- */
      saveQuest: function (id, date, o) {
        var ref = rRef(id).collection('quests').doc(date + '_' + me.uid), pass = !!o.pass;
        var body = { title: pass ? '' : String(o.title || '').slice(0, QUEST_TITLE_MAX), hint: pass ? '' : String(o.hint || '').slice(0, QUEST_HINT_MAX), pass: pass };
        if (o.exists) return ref.update(body);
        return ref.set({ date: date, day: dayNum(date), by: me.uid, title: body.title, hint: body.hint, pass: pass, at: FV.serverTimestamp() });
      },
      delQuest: function (id, date) { return rRef(id).collection('quests').doc(date + '_' + me.uid).delete(); },

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
        try { (await r.collection('quests').get()).docs.forEach(function (d) { refs.push(d.ref); }); } catch (e) {}      // Rules cũ chưa có quests → bỏ qua
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
      tab: 'create', roomTab: 'today', arc: null, busy: false, voting: false, dlg: '', dlgTab: '', toastT: null, lastDay: '', cam: null, photos: {}, photoView: null, photoList: null,
      form: { room: '', code: '', name: f.name || '', title: f.title || '', freq: f.freq || 'daily', target: f.target || '' },
      dlgForm: null, mg: null, confirm: null, qForm: null, qBusy: false };
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
    if (it.qid && it.photo) {
      if (j.offTopic) h += '<span class="hub-collab-rv is-off" title="Quá nửa người khác báo lạc đề — check-in vẫn tính, chỉ mất ✦">↯ Lạc đề</span>';
      else if (j.off) h += '<span class="hub-collab-rv is-offn">↯ ' + j.off + ' báo lạc đề</span>';
      else if (!j.voided) h += '<span class="hub-collab-rv is-quest">✦ Đúng đề</span>';
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
      var v = voteKey(j, m.uid);
      return '<li class="' + (v ? 'is-' + v : 'is-wait') + '"><b>' + esc(m.name) + (m.uid === me ? ' (bạn)' : '') + '</b><span>' + (v === 'ok' ? '✓ Hợp lệ' : v === 'off' ? '↯ Lạc đề (ảnh thật)' : v === 'sus' ? '! Nghi ngờ' : '… Chưa duyệt') + '</span></li>';
    }).join('');
    var verdict = j.voided
      ? '<p class="hub-collab-verdict is-void">✕ Đã bị hủy: quá nửa thành viên khác nghi ngờ → tính như lỡ ngày.</p>'
      : '<p class="hub-collab-verdict">Hủy khi có từ ' + j.need + '/' + j.n + ' người nghi ngờ (hiện ' + j.sus + '). ' + (j.open ? 'Còn ' + leftText(it.at + REVIEW_MS - now) + ' để duyệt.' : 'Đã chốt — không đổi được nữa.') + '</p>';
    return '<ul class="hub-collab-tally">' + rows + '</ul>' + verdict + (it.qid && j.offTopic ? '<p class="hub-collab-verdict is-off">↯ Lạc đề: quá nửa người khác báo ảnh không đúng đề → mất ✦ hôm đó (check-in vẫn tính).</p>' : '');
  }
  function dupHtml(room, it, me) {
    var o = room.members.filter(function (m) { return m.uid === it.dup.uid; })[0];
    var who = !o ? 'một thành viên' : o.uid === me ? 'chính bạn' : o.uid === it.uid ? 'chính ' + o.name : o.name;
    return '<div class="hub-collab-dupbox"><p class="hub-collab-warn"><b>≈ Ảnh trùng.</b> Gần như cùng một ảnh với ảnh ngày ' + fmtDay(it.dup.date) + ' của ' + esc(who) + ' (lệch ' + it.dup.d + '/256 bit). Cả phòng đã được báo.</p>' +
      '<div class="hub-collab-compare"><figure><img alt="Ảnh này" data-ph="' + esc(it.uid) + '|' + esc(it.date) + '"><figcaption>Ảnh này · ' + fmtDay(it.date) + '</figcaption></figure>' +
      '<figure><img alt="Ảnh cũ hơn" data-ph="' + esc(it.dup.uid) + '|' + esc(it.dup.date) + '"><figcaption>Ảnh cũ · ' + fmtDay(it.dup.date) + '</figcaption></figure></div></div>';
  }

  /* ───────────── Đề ngày: thẻ đề hôm nay + lịch ra đề, hộp soạn đề ───────────── */
  function questChips(c, uid) {
    var qm = c.quest; if (!qm) return '';
    var qs = qm.streak[uid], sk = qm.skips[uid], h = '';
    if (qs && qs.cur) h += '<span class="hub-collab-qstreak" title="Số ngày liền chụp đúng đề">✦ <b>' + qs.cur + '</b> đúng đề</span>';
    if (sk) h += '<span class="hub-collab-qskip" title="Số ngày tới lượt ra đề mà chưa đăng (35 ngày gần nhất, ước tính)">bỏ lượt ra đề ×' + sk + '</span>';
    return h;
  }
  function questHtml(room, c, me) {
    var qm = c.quest; if (!qm || !qm.today) return '';
    var q = qm.today, who = memberByUid(q.setter), isMe = !!who && who.uid === me, ci = (room.checkins[me] || {})[c.today], done = !!ci && !!ci.qid;
    var whoTxt = q.doc
      ? 'Đề do <b>' + esc(who ? who.name : 'một thành viên') + (isMe ? ' (bạn)' : '') + '</b> ra'
      : (who ? '<b>' + esc(who.name) + (isMe ? ' (bạn)' : '') + '</b> chưa đăng đề nên hôm nay dùng <b>đề dự phòng</b>' : 'Hôm nay dùng <b>đề dự phòng</b>');
    var turn = [qm.today].concat(qm.plan).filter(function (p) { return p && !p.locked && p.setter === me && !p.doc && p.cands.indexOf(me) > -1; })[0];
    var banner = turn
      ? '<div class="hub-collab-qturn" role="status"><span>Đến lượt bạn ra đề cho ngày <b>' + fmtDay(turn.date) + '</b> (' + dayName(turn.date) + ').</span>' +
        '<button type="button" class="hub-collab-btn is-primary" data-act="quest-open" data-date="' + esc(turn.date) + '">Ra đề ngay</button></div>'
      : '';
    var rows = qm.plan.map(function (p) {
      if (!p) return '';
      var w = memberByUid(p.setter), mine = p.setter === me, mineDoc = (room.quests || []).filter(function (x) { return x.date === p.date && x.by === me; })[0];
      var canOpen = !p.locked && (mine || !!mineDoc || (p.date === c.today && p.cands.indexOf(me) > -1));
      var label = mineDoc ? (mineDoc.pass ? 'Đã nhường' : 'Sửa') : 'Ra đề';
      return '<li class="hub-collab-qrow' + (mine ? ' is-mine' : '') + (p.doc ? ' is-set' : '') + '">' +
        '<span class="hub-collab-qrow-d"><b>' + DOW_SHORT[parseYmd(p.date).getDay()] + '</b> ' + fmtDay(p.date) + '</span>' +
        '<span class="hub-collab-qrow-who">' + (w ? avatarHtml(w, 'is-sm') + '<i>' + esc(w.name) + (mine ? ' (bạn)' : '') + '</i>' : '<i>—</i>') + '</span>' +
        '<span class="hub-collab-qrow-t">' + (p.doc ? '✦ ' + esc(p.doc.title) : 'Chưa có đề — sẽ dùng đề dự phòng') + '</span>' +
        (canOpen ? '<button type="button" class="hub-collab-btn' + (mine && !p.doc ? ' is-primary' : '') + '" data-act="quest-open" data-date="' + esc(p.date) + '">' + label + '</button>' : '') + '</li>';
    }).join('');
    return '<section class="hub-collab-quest' + (done ? ' is-done' : '') + '" aria-labelledby="hc-q-title">' +
      '<div class="hub-collab-quest-head"><span class="hub-collab-kicker">Đề ngày · ' + dayName(c.today) + ', ' + fmtDay(c.today) + '</span>' +
        '<span class="hub-collab-qtag">' + (q.mode === 'owner' ? 'Chủ phòng ra đề' : 'Bốc thăm mỗi ngày') + '</span></div>' +
      '<div class="hub-collab-quest-main">' + (who && q.doc ? avatarHtml(who, '') : '<span class="hub-collab-quest-mark" aria-hidden="true">✦</span>') +
        '<div class="hub-collab-quest-body"><h3 class="hub-collab-quest-title" id="hc-q-title">' + esc(q.title) + '</h3>' +
          (q.hint ? '<p class="hub-collab-quest-hint">' + esc(q.hint) + '</p>' : '') +
          '<p class="hub-collab-muted">' + whoTxt + '</p></div>' +
        (done ? '<span class="hub-collab-status is-done">✓ Bạn đã chụp theo đề</span>' : '') + '</div>' +
      banner +
      '<h4 class="hub-collab-h4">Lịch ra đề ' + QUEST_AHEAD + ' ngày tới</h4><ul class="hub-collab-qplan">' + rows + '</ul>' +
      '<p class="hub-collab-muted">Ai tới lượt thì đăng đề trước ngày đó; không đăng thì phòng dùng đề dự phòng. Ảnh được đóng dấu đề, người duyệt có thể báo “Lạc đề”.</p></section>';
  }
  function questDlgHtml(room, c, me) {
    var f = S.qForm; if (!f) return '';
    var d = f.date, mine = (room.quests || []).filter(function (x) { return x.date === d && x.by === me; })[0], isPass = !!(mine && mine.pass), hasDoc = !!(mine && !mine.pass), lk = questFor(room, d, c.today), locked = !!(lk && lk.locked), busy = (S.qBusy || locked) ? ' disabled' : '';
    return '<div class="hub-collab-scrim" data-act="close"></div><div class="hub-collab-dialog hub-collab-dialog--quest" role="dialog" aria-modal="true" aria-labelledby="hc-dlg-title">' +
      '<div class="hub-collab-dialog-head"><h3 id="hc-dlg-title">Ra đề cho ' + dayName(d) + ', ' + fmtDay(d) + '</h3><button type="button" class="hub-collab-btn is-ghost" data-act="close" aria-label="Đóng">✕</button></div>' +
      '<div class="hub-collab-form">' +
      (locked ? '<p class="hub-collab-warn">Ngày này đã có người check-in nên đề đã chốt, không đăng / sửa / xoá được nữa.</p>' : '') +
      (isPass ? '<p class="hub-collab-muted">Bạn đã nhường lượt ngày này. Đổi ý thì cứ đăng đề — miễn là ngày đó chưa qua.</p>' : '') +
      field('Đề chụp (tối đa ' + QUEST_TITLE_MAX + ' ký tự)', '<input class="hub-collab-input" data-q="title" maxlength="' + QUEST_TITLE_MAX + '" placeholder="VD: Thứ màu đỏ gần bạn nhất" value="' + esc(f.title) + '">') +
      field('Gợi ý thêm (tuỳ chọn, tối đa ' + QUEST_HINT_MAX + ' ký tự)', '<input class="hub-collab-input" data-q="hint" maxlength="' + QUEST_HINT_MAX + '" value="' + esc(f.hint) + '">') +
      '<p class="hub-collab-muted">Cả phòng sẽ chụp theo đề này khi check-in ngày <b>' + fmtDay(d) + '</b>. Nếu bạn không đăng, phòng dùng đề dự phòng. Đăng rồi vẫn sửa / xoá được tới hết ngày đó.</p>' +
      '<div class="hub-collab-quest-acts">' +
        '<button type="button" class="hub-collab-btn is-ghost" data-act="quest-suggest"' + busy + '>↻ Gợi ý ngẫu nhiên</button>' +
        '<button type="button" class="hub-collab-btn is-primary" data-act="quest-save"' + busy + '>' + (S.qBusy ? 'Đang lưu…' : hasDoc ? 'Lưu đề' : 'Đăng đề') + '</button>' +
        (room.cfg.quest === 'random' && !isPass ? '<button type="button" class="hub-collab-btn" data-act="quest-pass"' + busy + '>Nhường lượt</button>' : '') +
        (hasDoc ? '<button type="button" class="hub-collab-btn is-danger" data-act="quest-del"' + busy + '>Xoá đề</button>' : '') +
      '</div></div></div>';
  }
  function arcQuestLine(room, c, d) {
    var t = '';
    Object.keys(room.checkins).forEach(function (u) { var ci = room.checkins[u][d]; if (!t && ci && ci.qt) t = ci.qt; });
    if (!t && d === c.today && c.quest && c.quest.today) t = c.quest.today.title;
    return t ? '<p class="hub-collab-arc-q">✦ Đề ngày: <b>' + esc(t) + '</b></p>' : '';
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
      : (pend.length ? reviewBanner(pend) : '') + groupHtml(g) + questHtml(room, c, me) + (c.weekly && c.weekly.hasData ? weeklyRecapHtml(room, c, { inArchive: false }) : '') + meHtml(mine, room, c, now) + alertsHtml(c, me) +
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
      (S.dlg === 'quest' ? questDlgHtml(room, c, me) : S.dlg === 'camera' ? cameraHtml(room) : S.dlg === 'photo' ? photoHtml(room, c, me) : S.dlg === 'manage' ? manageHtml(room, isOwner) : S.dlg === 'confirm' && S.confirm ? confirmHtml() : S.dlg ? dialogHtml(room, mine, isOwner, today) : '');
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
          '<span class="hub-collab-muted">' + (voided ? 'Quá nửa thành viên khác nghi ngờ ảnh — tính như lỡ ngày.' : dayName(c.today) + ', ngày ' + fmtDay(c.today) + (li && li.label && li.target ? ' · mục tiêu ' + esc(li.target) : '') + (ci.note ? ' · “' + esc(ci.note) + '”' : '')) + '</span>' + (ci.qt ? '<span class="hub-collab-qline">✦ ' + esc(ci.qt) + '</span>' : '') + reviewChips(it) + '</div>' +
        (canUndo ? '<button type="button" class="hub-collab-btn is-ghost" data-act="undo" data-until="' + (ci.at + UNDO_MS) + '">Hoàn tác</button>' : '') + '</div>';
    } else {
      body = '<div class="hub-collab-checkin"><p class="hub-collab-muted">Chụp ảnh ngay tại chỗ (đang làm / vừa làm xong cam kết) để được phép check-in.' + (c.quest && c.quest.today ? ' Hôm nay có <b>đề ngày</b>: “' + esc(c.quest.today.title) + '” — ảnh nên đúng đề.' : '') +
        (cfg.challenge ? ' Phòng đang bật <b>mã thử thách</b>: màn hình sẽ hiện một số — hãy viết lên giấy hoặc giơ đúng số ngón tay đó.' : '') + ' Các thành viên khác sẽ duyệt ảnh của bạn.</p>' +
        '<button type="button" class="hub-collab-checkbtn" data-act="cam"><span>Chụp ảnh &amp; check-in</span><small data-hc-clock>' + fmtTime(now) + '</small></button></div>' +
        '<p class="hub-collab-muted" data-hc-left data-end="' + dayEndMs(c.today, cfg.cutoff) + '">Còn ' + leftText(dayEndMs(c.today, cfg.cutoff) - now) + ' đến giờ chốt ngày (' + pad(cfg.cutoff) + ':00)</p>';
    }
    return '<section class="hub-collab-me' + (ci ? (voided ? ' is-void' : ' ' + lateCls(li)) : '') + '"><div class="hub-collab-me-top"><div><span class="hub-collab-kicker">Hôm nay · ' + dayName(c.today) + ', ' + fmtDay(c.today) + '</span>' +
        '<h3 class="hub-collab-commit">' + commitLine(cm) + '</h3></div>' +
        '<div class="hub-collab-vitals">' + heartsHtml(st.hearts, st.max) + '<span class="hub-collab-streak"><b>' + st.streak + '</b> ngày streak</span>' + questChips(c, mine.uid) + '</div></div>' + body + '</section>';
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
      var mv = voteKey(it.j, me);
      act = '<button type="button" class="hub-collab-btn' + (mv ? '' : ' is-primary') + '"' + photoBtnAttrs(it) + '>' + (mv ? 'Đã duyệt: ' + VOTE_TEXT[mv] : 'Duyệt ảnh') + '</button>';
    }
    return '<article class="hub-collab-member' + (isMe ? ' is-me' : '') + (ci ? (voided ? ' is-void' : ' ' + lateCls(li)) : '') + '">' +
      avatarHtml(m, '') +
      '<div class="hub-collab-member-main"><div class="hub-collab-member-top"><b>' + esc(m.name) + '</b>' + (isMe ? '<span class="hub-collab-me-tag">bạn</span>' : '') + chip + '</div>' +
        '<div class="hub-collab-muted">' + commitLine(cm) + '</div>' + reviewChips(it) +
        '<div class="hub-collab-vitals">' + heartsHtml(st.hearts, st.max) + '<span class="hub-collab-streak"><b>' + st.streak + '</b> streak · kỷ lục ' + st.best + (st.kos ? ' · ' + st.kos + ' lần KO' : '') + '</span>' + questChips(c, m.uid) + '</div>' +
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
        '<span class="hub-collab-feed-main"><b>' + esc(e.name) + '</b> ' + badge + (e.note ? ' — “' + esc(e.note) + '”' : '') + (e.qt ? ' <span class="hub-collab-qline">✦ ' + esc(e.qt) + '</span>' : '') + reviewChips(e) + '</span></li>';
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
    var cells = '', mDue = 0, mChecked = 0, mSync = 0, mSched = 0, cPerfect = 0, cWarn = 0, cBad = 0, cPart = 0;
    for (var b = 0; b < lead; b++) cells += '<span class="hub-collab-cal-pad" aria-hidden="true"></span>';
    days.forEach(function (d) {
      var num = +d.slice(8), future = d > c.today;
      if (future) {
        cells += '<button type="button" class="hub-collab-cal-day is-future" disabled><span class="hub-collab-cal-num"><b>' + num + '</b></span></button>';
        return;
      }
      var due = 0, checked = 0, lateN = 0, vlateN = 0, voidN = 0;
      var hasQuest = !!(d === c.today && c.quest && c.quest.today);
      if (!hasQuest) {
        Object.keys(room.checkins).forEach(function (u) {
          var ciq = room.checkins[u] && room.checkins[u][d];
          if (ciq && ciq.qt) hasQuest = true;
        });
      }
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
      if (due > 0) {
        mSched++;
        mDue += due;
        mChecked += checked;
        if (checked === due) mSync++;
      }
      var miss = due - checked;
      var stKind = !due ? 'rest' : (d === c.today && miss > 0 && !voidN) ? 'part' : (miss > 0 || vlateN > 0) ? 'bad' : lateN > 0 ? 'warn' : 'perfect';
      if (stKind === 'perfect') cPerfect++;
      else if (stKind === 'warn') cWarn++;
      else if (stKind === 'bad') cBad++;
      else if (stKind === 'part') cPart++;
      var cls = 'is-' + stKind;
      if (hasQuest) cls += ' has-quest';
      if (d === c.today) cls += ' is-today';
      if (d === arc.day && arc.mode === 'day') cls += ' is-sel';
      var tip = fmtDay(d) + (due ? ': ' + checked + '/' + due + ' đã check-in' + (lateN ? ', ' + lateN + ' muộn' : '') + (vlateN ? ', ' + vlateN + ' muộn >1H' : '') + (voidN ? ', ' + voidN + ' bị hủy' : '') : ': ngày nghỉ');
      var fillPct = due ? Math.round(checked / due * 100) : 0;
      cells += '<button type="button" class="hub-collab-cal-day ' + cls + '" data-st="' + stKind + '" data-act="arc-day" data-day="' + d + '" title="' + esc(tip) + '">' +
        '<span class="hub-collab-cal-num"><b>' + num + '</b>' + (hasQuest ? '<i class="hub-collab-cal-q" aria-hidden="true">✦</i>' : '') + '</span>' +
        (due
          ? '<small class="hub-collab-cal-ratio">' + checked + '/' + due + '</small><span class="hub-collab-cal-bar" aria-hidden="true"><i style="width:' + fillPct + '%"></i></span>'
          : '<small class="hub-collab-cal-ratio">—</small>') +
      '</button>';
    });
    var mRate = mDue ? Math.round(mChecked / mDue * 100) : 0;
    return '<div class="hub-collab-cal">' +
      '<div class="hub-collab-cal-head">' +
        '<div class="hub-collab-cal-title"><span class="hub-collab-cal-k">Lịch hoạt động</span><b>' + esc(fmtMonthLabel(arc.month)) + '</b></div>' +
        '<div class="hub-collab-cal-stats">' +
          '<span><b>' + mRate + '%</b> hoàn thành</span>' +
          '<span><b>' + mSync + '/' + mSched + '</b> đồng bộ</span>' +
          '<span><b>' + mChecked + '</b> lượt</span>' +
        '</div>' +
      '</div>' +
      '<div class="hub-collab-cal-dow">' + dows + '</div><div class="hub-collab-cal-grid">' + cells + '</div>' +
      '<div class="hub-collab-cal-leg">' +
        '<span><i class="is-perfect"></i>Đủ &amp; đúng giờ' + (cPerfect ? ' <em>· ' + cPerfect + '</em>' : '') + '</span>' +
        '<span><i class="is-warn"></i>Có check-in muộn' + (cWarn ? ' <em>· ' + cWarn + '</em>' : '') + '</span>' +
        '<span><i class="is-bad"></i>Có bỏ lỡ / muộn &gt;1H' + (cBad ? ' <em>· ' + cBad + '</em>' : '') + '</span>' +
        '<span><i class="is-part"></i>Hôm nay đang chờ' + (cPart ? ' <em>· ' + cPart + '</em>' : '') + '</span>' +
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
            var mv = voteKey(it.j, me);
            act = '<div class="hub-collab-arow-act"><button type="button" class="hub-collab-btn' + (mv ? '' : ' is-primary') + '"' + photoBtnAttrs(it) + '>' + (mv ? 'Đã duyệt: ' + VOTE_TEXT[mv] : 'Duyệt ảnh') + '</button></div>';
          }
          return '<div class="hub-collab-arow ' + (voided ? 'is-void' : lateCls(row.li)) + '">' +
            (row.ci.hasPhoto ? thumbHtml(row.m.uid, d, row.m.name, 'is-lg', 'day', it) : avatarHtml(row.m, '')) +
            '<div class="hub-collab-arow-main">' +
              '<div class="hub-collab-arow-top"><b>' + esc(row.m.name) + '</b>' + (isMe ? '<span class="hub-collab-me-tag">bạn</span>' : '') + badge + '</div>' +
              '<div class="hub-collab-muted">' + commitLine(row.cm) + '</div>' + reviewChips(it) +
              (row.ci.note ? '<p class="hub-collab-arow-note">“' + esc(row.ci.note) + '”</p>' : '') +
              (row.ci.qt ? '<p class="hub-collab-arow-q">✦ ' + esc(row.ci.qt) + '</p>' : '') +
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
            avatarHtml(it.m, '') +
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

    return head + arcQuestLine(room, c, d) + emptyMsg + checkedHtml + missHtml + restHtml;
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
        '<div class="hub-collab-gcard-frame">' +
          thumbHtml(it.uid, it.date, it.name, 'hub-collab-gcard-img', 'gallery', it.entry) +
          '<span class="hub-collab-gcard-stamp" aria-hidden="true">' + fmtDay(it.date) + ' · ' + fmtTime(it.at) + '</span>' +
        '</div>' +
        '<div class="hub-collab-gcard-meta">' +
          '<div class="hub-collab-gcard-top"><b>' + esc(it.name) + '</b>' +
            (voided ? '<span class="hub-collab-status hub-collab-status--xs is-void">Bị hủy</span>'
              : '<span class="hub-collab-status hub-collab-status--xs ' + lateCls(it.li) + '">' + lateIcon(it.li) + (it.li && it.li.label ? ' ' + esc(it.li.label) : ' Đúng giờ') + '</span>') + '</div>' +
          '<span class="hub-collab-muted hub-collab-gcard-sub">' + esc(it.cm && it.cm.title ? it.cm.title : fmtTime(it.at) + ' · ' + fmtDay(it.date)) + '</span>' +
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
      (sumAll ? '<div class="hub-collab-mbar-wrap">' +
        '<div class="hub-collab-mbar-head"><span>Phân bổ trạng thái tháng</span><span>Đúng giờ ' + ms.okN + ' · Muộn ' + (ms.lateN + ms.vlateN) + ' · Lỡ ' + ms.missN + '</span></div>' +
        '<div class="hub-collab-mbar" aria-label="Tỉ lệ trạng thái trong tháng">' +
          '<i class="is-ok" style="width:' + pct(ms.okN) + '%" title="Đúng giờ: ' + ms.okN + '"></i>' +
          '<i class="is-late" style="width:' + pct(ms.lateN) + '%" title="Muộn ≤1H: ' + ms.lateN + '"></i>' +
          '<i class="is-vlate" style="width:' + pct(ms.vlateN) + '%" title="Muộn >1H: ' + ms.vlateN + '"></i>' +
          '<i class="is-miss" style="width:' + pct(ms.missN) + '%" title="Bỏ lỡ: ' + ms.missN + '"></i>' +
        '</div></div>' : '') +
      '<div class="hub-collab-maudit">' + ms.rows.map(function (pm) {
        var r = pm.due ? Math.round(pm.done / pm.due * 100) : 0;
        return '<div class="hub-collab-maudit-row">' +
          '<div class="hub-collab-maudit-top"><div class="hub-collab-maudit-who">' + avatarHtml(pm.m, 'is-sm') +
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
            '<div class="hub-collab-maudit-top"><div class="hub-collab-maudit-who">' + avatarHtml(pm.m, 'is-sm') +
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
          '<div class="hub-collab-arc-step">' +
            '<button type="button" class="hub-collab-btn" data-act="arc-week" data-dir="-1" aria-label="Tuần trước"' + (!w.canPrev ? ' disabled' : '') + '>◀</button>' +
            '<b>Tuần ' + fmtDay(w.weekStart) + ' – ' + fmtDay(w.weekEnd) + '</b>' +
            '<button type="button" class="hub-collab-btn" data-act="arc-week" data-dir="1" aria-label="Tuần sau"' + (!w.canNext ? ' disabled' : '') + '>▶</button>' +
          '</div>' +
          '<div class="hub-collab-arc-acts">' +
            '<button type="button" class="hub-collab-btn" data-act="arc-week-latest">Tuần vừa qua</button>' +
            '<button type="button" class="hub-collab-btn" data-act="weekly-copy" data-wstart="' + esc(w.weekStart) + '" title="Chép tổng kết tuần">Copy tổng kết</button>' +
          '</div>' +
        '</div>'
      : '<div class="hub-collab-arc-mnav">' +
          '<div class="hub-collab-arc-step">' +
            '<button type="button" class="hub-collab-btn" data-act="arc-month" data-dir="-1" aria-label="Tháng trước">◀</button>' +
            '<b>' + esc(fmtMonthLabel(arc.month)) + '</b>' +
            '<button type="button" class="hub-collab-btn" data-act="arc-month" data-dir="1" aria-label="Tháng sau"' + (nextDis ? ' disabled' : '') + '>▶</button>' +
          '</div>' +
          '<div class="hub-collab-arc-acts">' +
            '<button type="button" class="hub-collab-btn" data-act="arc-today">Hôm nay</button>' +
            '<button type="button" class="hub-collab-btn" data-act="arc-copy" title="Chép báo cáo điểm danh">Copy báo cáo</button>' +
          '</div>' +
        '</div>';
    var bar = '<div class="hub-collab-arc-bar">' +
        '<div class="hub-collab-arc-modes" role="group" aria-label="Chế độ xem kho nhật ký">' +
          '<button type="button" class="hub-collab-btn" data-act="arc-mode" data-amode="day" aria-pressed="' + (arc.mode === 'day') + '"><i aria-hidden="true">◫</i><span>Theo ngày</span></button>' +
          '<button type="button" class="hub-collab-btn" data-act="arc-mode" data-amode="gallery" aria-pressed="' + (arc.mode === 'gallery') + '"><i aria-hidden="true">▦</i><span>Thư viện ảnh</span></button>' +
          '<button type="button" class="hub-collab-btn" data-act="arc-mode" data-amode="month" aria-pressed="' + (arc.mode === 'month') + '"><i aria-hidden="true">◔</i><span>Tổng quan tháng</span></button>' +
          '<button type="button" class="hub-collab-btn" data-act="arc-mode" data-amode="weekly" aria-pressed="' + wMode + '"><i aria-hidden="true">✦</i><span>Tổng kết tuần</span></button>' +
        '</div>' + rightNav + '</div>';

    var filters = wMode ? '' : arc.mode === 'month' ? '<div class="hub-collab-arc-filters">' +
        '<span class="hub-collab-arc-flbl">Bộ lọc</span>' +
        '<select class="hub-collab-input" data-arc="member" aria-label="Lọc theo thành viên"><option value="all">Tất cả thành viên</option>' +
          members.map(function (m) { return '<option value="' + esc(m.uid) + '"' + (arc.member === m.uid ? ' selected' : '') + '>' + esc(m.name) + '</option>'; }).join('') +
        '</select></div>'
      : '<div class="hub-collab-arc-filters">' +
        '<span class="hub-collab-arc-flbl">Bộ lọc</span>' +
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
    var f = S.dlgForm, cfg = room.cfg, tab = S.dlgTab === 'rules' ? 'rules' : 'personal';
    var nextDay = fmtDay(addDays(today, 1));
    var hist = (mine.commits || []).slice().reverse().map(function (c) { return '<li><time>từ ' + fmtDay(c.from) + '</time><span>' + commitLine(c) + '</span></li>'; }).join('');
    var personalBody = avatarPickerHtml(f.avatar || '', mine.name) +
      '<section class="hub-collab-dcard">' +
        '<div class="hub-collab-dcard-head"><h4>Cam kết của bạn</h4><span class="hub-collab-dcard-meta">Hiệu lực từ ' + esc(nextDay) + '</span></div>' +
        '<div class="hub-collab-form">' +
          field('Cam kết', '<input class="hub-collab-input" data-d="title" maxlength="80" value="' + esc(f.title) + '">') +
          '<div class="hub-collab-row2">' +
            field('Tần suất', '<select class="hub-collab-input" data-d="freq">' + Object.keys(FREQ).map(function (k) { return '<option value="' + k + '"' + (f.freq === k ? ' selected' : '') + '>' + FREQ[k] + '</option>'; }).join('') + '</select>') +
            field('Trước giờ', '<input type="time" class="hub-collab-input" data-d="target" value="' + esc(f.target) + '">') +
          '</div>' +
        '</div>' +
        '<div class="hub-collab-dcard-foot"><span class="hub-collab-dcard-hint">Những ngày đã qua giữ nguyên cam kết cũ.</span>' +
          '<button type="button" class="hub-collab-btn is-primary" data-act="save-commit">Lưu cam kết</button></div>' +
        (hist ? '<details class="hub-collab-fold"><summary>Lịch sử cam kết (' + (mine.commits || []).length + ')</summary><ul class="hub-collab-feed hub-collab-feed--hist">' + hist + '</ul></details>' : '') +
      '</section>' +
      (!isOwner
        ? '<section class="hub-collab-dcard is-danger-row">' +
            '<div><h4>Rời phòng</h4><p class="hub-collab-dcard-hint">Rời khỏi phòng này? Lịch sử check-in vẫn được giữ.</p></div>' +
            '<button type="button" class="hub-collab-btn is-danger" data-act="leave">Rời phòng</button>' +
          '</section>'
        : '');
    var rulesCfgCard = isOwner
      ? '<section class="hub-collab-dcard">' +
          '<div class="hub-collab-dcard-head"><h4>Luật của phòng</h4><span class="hub-collab-dcard-meta">Chủ phòng</span></div>' +
          '<div class="hub-collab-form">' +
            '<div class="hub-collab-row2">' +
              field('Số tim tối đa', '<select class="hub-collab-input" data-d="max">' + HEART_CHOICES.map(function (n) { return '<option value="' + n + '"' + (f.max === n ? ' selected' : '') + '>' + n + ' tim</option>'; }).join('') + '</select>') +
              field('Hồi 1 tim sau', '<select class="hub-collab-input" data-d="regen">' + REGEN_CHOICES.map(function (n) { return '<option value="' + n + '"' + (f.regen === n ? ' selected' : '') + '>' + n + ' ngày liền</option>'; }).join('') + '</select>') +
            '</div>' +
            field('Mã thử thách mỗi lần chụp', '<select class="hub-collab-input" data-d="chal"><option value="on"' + (f.chal === 'on' ? ' selected' : '') + '>Bật — số ngẫu nhiên được đóng dấu vào ảnh</option><option value="off"' + (f.chal === 'off' ? ' selected' : '') + '>Tắt</option></select>') +
            field('Đề ngày (daily quest)', '<select class="hub-collab-input" data-d="quest">' + QUEST_MODES.map(function (o) { return '<option value="' + o[0] + '"' + (f.quest === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select>') +
            '<p class="hub-collab-dcard-hint">Đề ngày: mỗi ngày một đề chụp ảnh khi check-in. Người ra đề đăng trước; quên đăng thì dùng đề dự phòng, không bị phạt. Phòng bật đề thì mọi check-in phải kèm đề.</p>' +
          '</div>' +
          '<div class="hub-collab-dcard-foot"><span class="hub-collab-dcard-hint">Đổi luật sẽ tính lại tim và streak theo toàn bộ lịch sử.</span>' +
            '<button type="button" class="hub-collab-btn is-primary" data-act="save-cfg">Lưu luật</button></div>' +
        '</section>'
      : '<section class="hub-collab-dcard">' +
          '<div class="hub-collab-dcard-head"><h4>Luật phòng hiện tại</h4><span class="hub-collab-dcard-meta">Áp dụng chung</span></div>' +
          '<div class="hub-collab-rule-grid">' +
            '<div class="hub-collab-rule-item"><b>' + cfg.maxHearts + ' tim tối đa</b><span>Mỗi ngày lỡ trừ 1 tim</span></div>' +
            '<div class="hub-collab-rule-item"><b>Hồi 1 tim / ' + cfg.regenDays + ' ngày</b><span>Check-in liên tiếp để hồi tim</span></div>' +
            '<div class="hub-collab-rule-item"><b>' + (cfg.challenge ? 'Mã thử thách: Bật' : 'Mã thử thách: Tắt') + '</b><span>Đóng dấu số ngẫu nhiên vào ảnh</span></div>' +
            '<div class="hub-collab-rule-item"><b>' + (cfg.quest === 'random' ? 'Đề ngày: bốc thăm' : cfg.quest === 'owner' ? 'Đề ngày: chủ phòng ra đề' : 'Đề ngày: Tắt') + '</b><span>Mỗi ngày một đề chụp ảnh khi check-in</span></div>' +
          '</div>' +
        '</section>';
    var reviewCard = '<section class="hub-collab-dcard">' +
      '<div class="hub-collab-dcard-head"><h4>Duyệt ảnh chéo</h4><span class="hub-collab-dcard-meta">Cơ chế xác thực</span></div>' +
      '<div class="hub-collab-rule-grid">' +
        '<div class="hub-collab-rule-item"><b>72 giờ</b><span>Thời hạn thành viên bấm Hợp lệ / Nghi ngờ</span></div>' +
        '<div class="hub-collab-rule-item"><b>&gt; 50% nghi ngờ</b><span>Check-in bị huỷ (phòng 2 người: người còn lại quyết)</span></div>' +
        '<div class="hub-collab-rule-item"><b>Chống trùng ảnh</b><span>Tự động cảnh báo cả phòng nếu ảnh giống ảnh cũ</span></div>' +
        (cfg.quest && cfg.quest !== 'off' ? '<div class="hub-collab-rule-item"><b>Lạc đề ≠ nghi ngờ</b><span>Ảnh thật nhưng sai đề: chỉ mất ✦, check-in vẫn tính</span></div>' : '') +
      '</div></section>';
    var ownerLink = isOwner
      ? '<section class="hub-collab-dcard is-link-row">' +
          '<span class="hub-collab-dcard-hint">Chủ phòng muốn đổi mã mời, chuyển quyền hoặc xoá phòng?</span>' +
          '<button type="button" class="hub-collab-btn" data-act="dlg" data-dlg="manage">Mở Quản lý phòng</button>' +
        '</section>'
      : '';
    return '<div class="hub-collab-scrim" data-act="close"></div><div class="hub-collab-dialog hub-collab-dialog--settings" role="dialog" aria-modal="true" aria-labelledby="hc-dlg-title">' +
      '<div class="hub-collab-dialog-head"><div class="hub-collab-dialog-title"><h3 id="hc-dlg-title">Cài đặt phòng</h3><span class="hub-collab-dialog-sub">' + esc(room.name) + '</span></div>' +
        '<button type="button" class="hub-collab-btn is-ghost" data-act="close" aria-label="Đóng">✕</button></div>' +
      '<div class="hub-collab-dtabs" role="tablist">' +
        '<button type="button" role="tab" aria-selected="' + (tab === 'personal') + '" data-act="dlg-tab" data-tab="personal">Cá nhân</button>' +
        '<button type="button" role="tab" aria-selected="' + (tab === 'rules') + '" data-act="dlg-tab" data-tab="rules">Luật &amp; Duyệt ảnh</button>' +
      '</div>' +
      '<div class="hub-collab-form hub-collab-dstack">' + (tab === 'personal' ? personalBody : rulesCfgCard + reviewCard + ownerLink) + '</div></div>';
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
    var iv = inviteState(room, now), cap = room.maxMembers, tab = isOwner && S.dlgTab === 'room' ? 'room' : 'members';
    var members = room.members.slice().sort(function (a, b) {
      return (a.uid === room.ownerUid ? -1 : b.uid === room.ownerUid ? 1 : 0) || ((a.joinedAt || 0) - (b.joinedAt || 0)) || (a.name < b.name ? -1 : 1);
    });
    var rows = members.map(function (m) {
      var owner = m.uid === room.ownerUid, isMe = m.uid === me;
      return '<li class="hub-collab-mrow">' + avatarHtml(m, 'is-sm') +
        '<div class="hub-collab-mrow-main"><b>' + esc(m.name) + '</b><span class="hub-collab-mrow-tags">' +
          (owner ? '<span class="hub-collab-role is-owner">Chủ phòng</span>' : '') + (isMe ? '<span class="hub-collab-me-tag">bạn</span>' : '') +
          (m.joinedAt ? '<span class="hub-collab-muted">vào ' + fmtDay(ymd(new Date(m.joinedAt))) + '</span>' : '') + '</span></div>' +
        (isOwner && !isMe ? '<div class="hub-collab-mrow-act"><button type="button" class="hub-collab-btn" data-act="ask-transfer" data-uid="' + esc(m.uid) + '" title="Chuyển quyền chủ phòng">Chuyển quyền</button>' +
          '<button type="button" class="hub-collab-btn is-danger" data-act="ask-kick" data-uid="' + esc(m.uid) + '">Mời ra</button></div>' : '') + '</li>';
    }).join('');
    var expSel = '<select class="hub-collab-input" data-m="expiry">' + EXPIRY.map(function (e) { return '<option value="' + e[0] + '"' + (f.expiry === e[0] ? ' selected' : '') + '>' + e[1] + '</option>'; }).join('') + '</select>';
    var ownerCtl = isOwner
      ? '<div class="hub-collab-row2 hub-collab-invctl">' + field('Hiệu lực của mã', expSel) +
          '<div class="hub-collab-invbtns"><button type="button" class="hub-collab-btn" data-act="inv-expiry">Áp dụng</button><button type="button" class="hub-collab-btn" data-act="inv-regen">Đổi mã mới</button></div></div>' +
        '<div class="hub-collab-switch"><div><b>' + (room.joinOpen ? 'Đang mở cho người mới' : 'Đang khoá') + '</b><span class="hub-collab-muted">' +
          (room.joinOpen ? 'Ai có mã còn hạn đều vào được, tối đa ' + cap + ' người.' : 'Không ai vào được bằng mã, kể cả mã còn hạn.') + '</span></div>' +
          '<button type="button" class="hub-collab-btn" data-act="inv-lock">' + (room.joinOpen ? 'Khoá phòng' : 'Mở lại') + '</button></div>'
      : '';
    var membersTab = '<section class="hub-collab-dcard">' +
        '<div class="hub-collab-dcard-head"><h4>Mã mời tham gia</h4><span class="hub-collab-status-dot is-' + iv.kind + '">' + (room.joinOpen ? 'Đang mở' : 'Đang khoá') + '</span></div>' +
        '<div class="hub-collab-invite"><div class="hub-collab-invite-code"><code>' + esc(room.code) + '</code>' +
          '<button type="button" class="hub-collab-btn" data-act="copy">Chép mã</button></div>' +
          '<p class="hub-collab-invstate is-' + iv.kind + '" data-icon="' + esc(iv.icon) + '">' + esc(iv.text) + '</p>' + ownerCtl + '</div>' +
      '</section>' +
      '<section class="hub-collab-dcard">' +
        '<div class="hub-collab-dcard-head"><h4>Thành viên</h4><span class="hub-collab-dcard-meta">' + n + ' / ' + cap + '</span></div>' +
        '<ul class="hub-collab-mlist">' + rows + '</ul>' +
      '</section>';
    var roomTab = isOwner
      ? '<section class="hub-collab-dcard">' +
          '<div class="hub-collab-dcard-head"><h4>Thông tin &amp; giới hạn</h4><span class="hub-collab-dcard-meta">' + n + '/' + cap + ' chỗ</span></div>' +
          '<div class="hub-collab-row2">' +
            field('Tên phòng', '<input class="hub-collab-input" data-m="name" maxlength="40" value="' + esc(f.name) + '">') +
            field('Số người tối đa', '<select class="hub-collab-input" data-m="max">' + MAX_CHOICES.filter(function (x) { return x >= n; }).map(function (x) { return '<option value="' + x + '"' + (f.max === x ? ' selected' : '') + '>' + x + ' người</option>'; }).join('') + '</select>') +
          '</div>' +
          '<div class="hub-collab-dcard-foot"><span class="hub-collab-dcard-hint">Giới hạn tối đa không thể nhỏ hơn số thành viên hiện tại.</span>' +
            '<button type="button" class="hub-collab-btn is-primary" data-act="save-info">Lưu thiết lập</button></div>' +
        '</section>' +
        '<section class="hub-collab-dcard is-danger">' +
          '<div class="hub-collab-dcard-head"><h4>Vùng nguy hiểm</h4><span class="hub-collab-dcard-meta">Không thể hoàn tác</span></div>' +
          '<div class="hub-collab-danger"><p class="hub-collab-muted">Chủ phòng không thể rời phòng: hãy chuyển quyền cho người khác ở tab Thành viên, hoặc xoá hẳn phòng (mọi check-in và ảnh sẽ mất).</p>' +
            '<button type="button" class="hub-collab-btn is-danger" data-act="ask-delete">Xoá phòng…</button></div>' +
        '</section>'
      : '';
    var tabs = isOwner
      ? '<div class="hub-collab-dtabs" role="tablist">' +
          '<button type="button" role="tab" aria-selected="' + (tab === 'members') + '" data-act="dlg-tab" data-tab="members">Mã mời &amp; Thành viên</button>' +
          '<button type="button" role="tab" aria-selected="' + (tab === 'room') + '" data-act="dlg-tab" data-tab="room">Thiết lập &amp; Nguy hiểm</button>' +
        '</div>'
      : '';
    return '<div class="hub-collab-scrim" data-act="close"></div><div class="hub-collab-dialog hub-collab-dialog--wide" role="dialog" aria-modal="true" aria-labelledby="hc-dlg-title" tabindex="-1">' +
      '<div class="hub-collab-dialog-head"><div class="hub-collab-dialog-title"><h3 id="hc-dlg-title">' + (isOwner ? 'Quản lý phòng' : 'Thành viên &amp; mã mời') + '</h3>' +
        '<span class="hub-collab-dialog-sub">' + esc(room.name) + ' · ' + n + '/' + cap + ' thành viên · ' + (room.joinOpen ? 'Đang mở' : 'Đang khoá') + '</span></div>' +
        '<button type="button" class="hub-collab-btn is-ghost" data-act="close" aria-label="Đóng">✕</button></div>' +
      tabs + '<div class="hub-collab-form hub-collab-dstack">' + (tab === 'room' ? roomTab : membersTab) + '</div></div>';
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
    var c = S.cam, body, acts, actsCls = '', chal = '', warn = '', info = c.ch ? chInfo(c.ch) : null, hud = '', q = c.q || null, qcam = '';
    if (q) qcam = '<div class="hub-collab-qcam" role="note"><span class="hub-collab-qcam-k">✦ Đề hôm nay</span><b class="hub-collab-qcam-t">' + esc(q.title) + '</b>' + (q.hint ? '<span class="hub-collab-muted">' + esc(q.hint) + '</span>' : '') + '</div>';
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
      if (q) hud += '<div class="hub-collab-camhud hub-collab-camhud--q" aria-hidden="true"><span>✦</span><b>' + esc(q.title.length > 34 ? q.title.slice(0, 33) + '…' : q.title) + '</b></div>';
      body = '<video id="hc-video" playsinline autoplay muted></video>' + hud + '<div class="hub-collab-cd" id="hc-cd" aria-live="assertive" hidden></div>';
      actsCls = ' is-live';
      acts = '<div class="hub-collab-camacts' + actsCls + '"><button type="button" class="hub-collab-btn" data-act="flip">Đổi camera</button>' +
        '<button type="button" class="hub-collab-btn hub-collab-timerbtn" data-act="timer3s" aria-pressed="' + (!!c.timer3s) + '" title="Hẹn giờ chụp 3 giây">⏱ 3s</button>' +
        '<button type="button" class="hub-collab-btn is-primary hub-collab-shoot" data-act="shoot">Chụp</button></div>';
    }
    return '<div class="hub-collab-scrim" data-act="close"></div><div class="hub-collab-dialog hub-collab-dialog--cam" role="dialog" aria-modal="true" aria-labelledby="hc-dlg-title">' +
      '<div class="hub-collab-dialog-head"><h3 id="hc-dlg-title">Ảnh check-in</h3><button type="button" class="hub-collab-btn is-ghost" data-act="close" aria-label="Đóng">✕</button></div>' +
      qcam + chal + '<div class="hub-collab-cam' + (c.shot ? ' is-photo' : (c.facing === 'user' ? ' is-mirror' : '')) + '">' + body + '</div>' + warn + acts +
      '<p class="hub-collab-muted">Ảnh giữ nguyên khung hình, đóng dấu giờ + tên' + (info ? ' + tem thử thách' : '') + (q ? ' + đề ngày' : '') + '. Chỉ chụp trực tiếp, thành viên khác sẽ duyệt trong 72 giờ.</p></div>';
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
      if (it.qid) {
        x += '<div class="hub-collab-qverify' + (j.offTopic ? ' is-off' : '') + '"><span class="hub-collab-qverify-mark" aria-hidden="true">✦</span>' +
          '<div class="hub-collab-qverify-txt"><b>Đề ngày: ' + esc(it.qt || '—') + '</b><span>' + (j.offTopic ? 'Quá nửa người khác báo ảnh lạc đề — check-in vẫn tính, chỉ mất ✦.' : 'Ảnh phải đúng đề này. Ảnh thật nhưng sai đề thì bấm “Lạc đề” — check-in vẫn tính, chỉ mất ✦.') + '</span></div></div>';
      }
      if (it.dup) x += dupHtml(room, it, me);
      x += tallyHtml(room, it, me, now);
      if (!own && j.open && j.n) {
        var mv = voteKey(j, me), nx = pendingReviews(c, me).filter(function (q) { return !(q.uid === v.uid && q.date === v.date); })[0];
        x += '<div class="hub-collab-vote" role="group" aria-label="Duyệt ảnh">' + (it.qid ? ['ok', 'off', 'sus'] : ['ok', 'sus']).map(function (k) {
          return '<button type="button" class="hub-collab-btn is-' + k + '" data-act="vote" data-v="' + k + '" aria-pressed="' + (mv === k) + '"' + (S.voting ? ' disabled' : '') + '>' + (k === 'ok' ? '✓ ' : k === 'off' ? '↯ ' : '! ') + VOTE_TEXT[k] + '</button>';
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
    ['data-act', 'data-av', 'data-v', 'data-uid', 'data-date', 'data-d', 'data-m', 'data-x', 'data-c', 'data-q', 'data-f', 'data-arc', 'data-tab', 'data-id'].forEach(function (n) { var x = el.getAttribute && el.getAttribute(n); if (x != null) sel += '[' + n + '="' + String(x).replace(/"/g, '\\"') + '"]'; });
    return sel;
  }
  function paint() {
    if (!S || !S.root) return;
    var v = S.root.querySelector('#hc-view'); if (!v) return;
    var ae = document.activeElement, keep = null, pos = null, fk = focusKey(ae);     // giữ con trỏ / nút đang focus khi dữ liệu realtime vẽ lại
    if (ae && ae.getAttribute && v.contains(ae)) ['data-f', 'data-d', 'data-m', 'data-x', 'data-c', 'data-q', 'data-arc'].forEach(function (a) { if (!keep && ae.getAttribute(a)) { keep = '[' + a + '="' + ae.getAttribute(a) + '"]'; pos = ae.selectionStart; } });
    v.innerHTML = S.view === 'room' ? (S.room ? viewRoom() : '<p class="hub-collab-muted hub-collab-loading">Đang mở phòng…</p>') : viewLobby();
    if (keep) { var k2 = v.querySelector(keep); if (k2) { k2.focus({ preventScroll: true }); try { if (pos != null) k2.setSelectionRange(pos, pos); } catch (e) {} } }
    else if (fk) { try { var back = v.querySelector(fk); if (back && back !== document.activeElement) back.focus({ preventScroll: true }); } catch (e) {} }
    if (S.dlg) {
      var dl = v.querySelector('.hub-collab-dialog');
      if (dl && !S._dlgFocused) {
        var tg = dl.querySelector(S.dlg === 'settings' ? '[data-d="title"]' : S.dlg === 'quest' ? '[data-q="title"]' : '[data-x="typed"]') || (S.dlg === 'manage' || S.dlg === 'confirm' ? dl : null);
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
    return { name: f.name.trim(), title: f.title.trim(), freq: f.freq === 'weekdays' ? 'weekdays' : 'daily', target: /^\d\d:\d\d$/.test(f.target) ? f.target : '', avatar: loadAvatarPref() };
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
  /** Chặn ra / sửa / xoá đề của ngày đã có check-in (kể cả khi hộp soạn đã mở từ trước khi có người check-in). */
  function questLockedNow(date) {
    var q = S.room && S.calc && questFor(S.room, date, S.calc.today);
    if (!q || !q.locked) return false;
    S.qForm = null; S.qBusy = false; S.dlg = ''; paint(); toast('Ngày ' + fmtDay(date) + ' đã có người check-in nên không đổi đề nữa.');
    return true;
  }
  function questNow() { var q = S.room && S.calc && questFor(S.room, S.calc.today, S.calc.today); return q ? { id: q.qid, title: q.title, hint: q.hint, by: q.setter } : null; }
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
    setShot(stampAndEncode(v, v.videoWidth, v.videoHeight, S.cam.ch, S.cam.q && S.cam.q.title)); stopCamera(); paint();
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
  function stampAndEncode(src, w, h, chId, qTitle) {
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
    if (qTitle) {                                                      // thanh đề ngày nằm ngay trên thanh giờ (đóng dấu vào ảnh → người duyệt thấy đề)
      var qtxt = '✦ ' + qTitle, qmax = cw - padX * 2 - padInX * 2, qcut = false;
      x.font = '700 ' + fs + 'px ui-monospace, Menlo, Consolas, monospace';
      while (qtxt.length > 4 && x.measureText(qtxt + (qcut ? '…' : '')).width > qmax) { qtxt = qtxt.slice(0, -1); qcut = true; }
      if (qcut) qtxt = qtxt.replace(/\s+$/, '') + '…';
      var qw = Math.min(maxBarW, Math.ceil(x.measureText(qtxt).width + padInX * 2)), qh = fs + padInY * 2, qy = by - 6 - qh;
      roundRectPath(x, bx, qy, qw, qh, Math.min(7, qh / 3));
      x.fillStyle = 'rgba(8, 12, 20, 0.80)'; x.fill();
      x.lineWidth = 1; x.strokeStyle = 'rgba(255, 216, 77, 0.72)'; x.stroke();
      x.fillStyle = '#ffd84d'; x.textBaseline = 'middle';
      x.fillText(qtxt, bx + padInX, qy + qh / 2);
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
    img.onload = function () { URL.revokeObjectURL(u); if (!S || !S.cam) return; setShot(stampAndEncode(img, img.naturalWidth, img.naturalHeight, S.cam.ch, S.cam.q && S.cam.q.title)); paint(); };
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
      S.cam = { facing: 'environment', shot: '', err: '', note: '', stream: null, sending: false, ch: on ? newChallenge() : '', chExp: on ? Date.now() + CHAL_MS : 0, timer3s: false, cd: 0, cdT: null, chT: null, ph: '', pm: '', dup: null, q: questNow() };
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
      S.store.checkIn(S.roomId, today, (c.note || '').trim().slice(0, 120), !!tm && Date.now() > tm, c.shot, { ch: c.ch, ph: c.ph, pm: c.pm, qid: c.q ? c.q.id : '', qt: c.q ? c.q.title : '' }).then(function () {
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
      var k = el.getAttribute('data-v'), pv = S.photoView, it = pv && S.calc && S.calc.by[pv.uid + '|' + pv.date];
      if (!it || S.voting || (k !== 'ok' && k !== 'sus' && !(k === 'off' && it.qid))) return;
      if (it.j && voteKey(it.j, S.store.uid) === k) return;
      var v = k === 'sus' ? 'sus' : 'ok';                      // "Lạc đề" = hợp lệ + off:true
      S.voting = true; paint();
      S.store.review(S.roomId, pv.uid, pv.date, v, it.sec, k === 'off').then(function () {
        if (!S) return; S.voting = false; paint(); toast(k === 'sus' ? 'Đã đánh dấu nghi ngờ.' : k === 'off' ? 'Đã báo lạc đề (check-in vẫn tính).' : 'Đã đánh dấu hợp lệ.');
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
      S.dlg = kind; S.dlgTab = ''; S._dlgFocused = false;
      S.dlgForm = { avatar: (m && m.avatar) || '', title: c.title, freq: c.freq, target: c.target || '', max: S.room.cfg.maxHearts, regen: S.room.cfg.regenDays, chal: S.room.cfg.challenge ? 'on' : 'off', quest: S.room.cfg.quest || 'off' };
      S.mg = { name: S.room.name, max: S.room.maxMembers, expiry: DEFAULT_EXPIRY };
      paint();
    },
    'dlg-tab': function (el) {
      S.dlgTab = (el && el.getAttribute('data-tab')) || '';
      paint();
    },
    close: function () {
      if (S.confirm) { if (S.confirm.busy) return; S.dlg = S.confirm.back || ''; S.confirm = null; S._dlgFocused = false; paint(); return; }   // huỷ xác nhận → về hộp thoại trước
      stopCamera(); S.cam = null; S.photoView = null; S.photoList = null; S.voting = false; S.qForm = null; S.qBusy = false; S.dlg = ''; S.dlgTab = ''; S._dlgFocused = false; paint();
    },
    'save-commit': function () {
      var f = S.dlgForm, m = mineNow(), today = S.calc.today, title = (f.title || '').trim();
      if (!title) { toast('Cam kết không được để trống.'); return; }
      var cur = curCommit(m, today), freq = f.freq === 'weekdays' ? 'weekdays' : 'daily', target = /^\d\d:\d\d$/.test(f.target) ? f.target : '';
      if (cur.title === title && cur.freq === freq && (cur.target || '') === target) { toast('Không có gì thay đổi.'); return; }
      var next = (m.commits || []).filter(function (c) { return c.from <= today; }).concat([{ from: addDays(today, 1), title: title, freq: freq, target: target }]);
      guard(S.store.setCommits(S.roomId, next)).then(function () { S.dlg = ''; paint(); toast('Cam kết mới có hiệu lực từ ngày mai.'); });
    },
    'pick-avatar': function (el) {
      var id = el.getAttribute('data-av') || '', cur = S.dlgForm.avatar || '', m = mineNow();
      if (id === cur || (id && !avatarById(id))) return;
      S.dlgForm.avatar = id; saveAvatarPref(id); if (m) m.avatar = id;          // hiện ngay, lưu nền; lỗi thì trả lại
      paint();
      S.store.setAvatar(S.roomId, id).then(function () { toast(id ? 'Đã đổi avatar.' : 'Đã chuyển về chữ cái đầu tên.'); }, function (e) {
        if (!S || !S.dlgForm) return;
        S.dlgForm.avatar = cur; saveAvatarPref(cur); if (m) m.avatar = cur; paint(); toast(errMsg(e));
      });
    },
    'save-cfg': function () { var f = S.dlgForm; guard(S.store.setCfg(S.roomId, { maxHearts: f.max, regenDays: f.regen, challenge: f.chal === 'on', quest: f.quest })).then(function () { toast('Đã cập nhật luật phòng.'); }); },
    'quest-open': function (el) {
      var date = el.getAttribute('data-date'), me = S.store.uid, q = S.calc && questFor(S.room, date, S.calc.today);
      if (!q || date < S.calc.today || q.cands.indexOf(me) < 0) { toast('Chưa tới lượt bạn ra đề cho ngày này.'); return; }
      if (q.locked) { toast('Ngày ' + fmtDay(date) + ' đã có người check-in nên không đổi đề nữa.'); return; }
      var mine = (S.room.quests || []).filter(function (x) { return x.date === date && x.by === me; })[0];
      S.qForm = { date: date, title: mine && !mine.pass ? mine.title : '', hint: mine && !mine.pass ? mine.hint : '' };
      S.qBusy = false; S.dlg = 'quest'; S._dlgFocused = false; paint();
    },
    'quest-suggest': function () {
      var f = S.qForm; if (!f) return;
      var i = rand(QUEST_POOL.length), p = QUEST_POOL[i];
      if (p.t === f.title) p = QUEST_POOL[(i + 1) % QUEST_POOL.length];
      f.title = p.t; f.hint = p.h; paint();
    },
    'quest-save': function () {
      var f = S.qForm, me = S.store.uid; if (!f || S.qBusy) return;
      var title = String(f.title || '').trim().slice(0, QUEST_TITLE_MAX), hint = String(f.hint || '').trim().slice(0, QUEST_HINT_MAX), date = f.date;
      if (questLockedNow(date)) return;
      if (!title) { toast('Hãy nhập đề chụp (tối đa ' + QUEST_TITLE_MAX + ' ký tự).'); return; }
      var mine = (S.room.quests || []).filter(function (x) { return x.date === date && x.by === me; })[0];
      S.qBusy = true; paint();
      S.store.saveQuest(S.roomId, date, { title: title, hint: hint, pass: false, exists: !!mine }).then(function () {
        if (!S) return; S.qBusy = false; S.qForm = null; S.dlg = ''; paint(); toast('Đã đăng đề cho ngày ' + fmtDay(date) + '.');
      }, function (e) { if (!S) return; S.qBusy = false; paint(); toast(errMsg(e)); });
    },
    'quest-pass': function () {
      var f = S.qForm, me = S.store.uid; if (!f || S.qBusy) return;
      var date = f.date, mine = (S.room.quests || []).filter(function (x) { return x.date === date && x.by === me; })[0];
      if (questLockedNow(date)) return;
      S.qBusy = true; paint();
      S.store.saveQuest(S.roomId, date, { pass: true, exists: !!mine }).then(function () {
        if (!S) return; S.qBusy = false; S.qForm = null; S.dlg = ''; paint(); toast('Đã nhường lượt ra đề ngày ' + fmtDay(date) + ' cho người kế tiếp.');
      }, function (e) { if (!S) return; S.qBusy = false; paint(); toast(errMsg(e)); });
    },
    'quest-del': function () {
      var f = S.qForm; if (!f || S.qBusy) return;
      if (!window.confirm('Xoá đề ngày ' + fmtDay(f.date) + '? Nếu không đăng lại, phòng sẽ dùng đề dự phòng.')) return;
      var date = f.date; if (questLockedNow(date)) return;
      S.qBusy = true; paint();
      S.store.delQuest(S.roomId, date).then(function () {
        if (!S) return; S.qBusy = false; S.qForm = null; S.dlg = ''; paint(); toast('Đã xoá đề ngày ' + fmtDay(date) + '.');
      }, function (e) { if (!S) return; S.qBusy = false; paint(); toast(errMsg(e)); });
    },
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
      else if ((k = t.getAttribute('data-q')) && S.qForm) S.qForm[k] = t.value;
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
    _internals: { replay: replay, groupStreak: groupStreak, computeRoom: computeRoom, weeklySummary: weeklySummary, mondayOf: mondayOf, lastWeekStart: lastWeekStart, isMonday: isMonday, isWeeklyOpen: isWeeklyOpen, setWRecapOpen: setWRecapOpen, judge: judge, findDups: findDups, dupAgainst: dupAgainst, hamming: hamming, informative: informative, hashPair: hashPair, hexWords: hexWords, popcount: popcount, chInfo: chInfo, newChallenge: newChallenge, questFor: questFor, questCands: questCands, questSummary: questSummary, voteKey: voteKey, QUEST_POOL: QUEST_POOL, REVIEW_MS: REVIEW_MS, DUP_MAX: DUP_MAX, dayKey: dayKey, scheduled: scheduled, targetMs: targetMs, addDays: addDays, inviteState: inviteState, expiryMs: expiryMs, spanText: spanText, lateInfo: lateInfo, lateBucketLabel: lateBucketLabel }   // chỉ để kiểm thử
  };
})();

// Auto-register
if (typeof app !== 'undefined' && app && typeof app.register === 'function') {
  app.register(collaborationModule);
}