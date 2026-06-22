/* ============================================================
   HUB.OS — Focus Vibe (Music & Ambient Sound Player)
   Persistent floating widget with YouTube IFrame API integration.
   Smart Dynamic Playlist with Hashtag Filters via localStorage.
   Survives SPA tab switches via global state + body-attached DOM.
   ============================================================ */

(function () {
  'use strict';

  /* ----------------------------------------------------------
     GLOBAL STATE (survives SPA tab switches)
     ---------------------------------------------------------- */
  const S = window.__focusVibeState = window.__focusVibeState || {
    player: null,
    isPlaying: false,
    currentVideoId: 'X4VbdwhkE10',
    currentVibe: 'Lofi Beats',
    volume: 0.5,
    playerReady: false,
    youtubeLoaded: false,
    youtubeLoading: false,
    initCalled: false,
    _activeTag: null,
    _visualizer: { bars: null, rafId: null, running: false, targets: [], lastUpdate: 0 },
    _drag: { active: false, startX: 0, startY: 0, startLeft: 0, startTop: 0, moved: false, _justDragged: false },
  };

  /* ----------------------------------------------------------
     DRAG-TO-POSITION PERSISTENCE
     ---------------------------------------------------------- */
  const POSITION_KEY = 'hub_vibe_position';

  /* ----------------------------------------------------------
     DYNAMIC PLAYLIST (localStorage-backed)
     ---------------------------------------------------------- */
  const PLAYLIST_KEY = 'hub_focus_playlist';

  const DEFAULT_PLAYLIST = [
    { id: 'lofi',      name: 'Lofi Beats',        videoId: 'X4VbdwhkE10', icon: '🎹', tags: ['lofi', 'focus', 'chill'], _default: true },
    { id: 'cyberpunk', name: 'Cyberpunk Ambient', videoId: 'gIWsboTllGA', icon: '🤖', tags: ['cyberpunk', 'focus', 'dark'], _default: true },
    { id: 'rain',      name: 'Rain & Thunder',    videoId: 'mPZkdNFkNps', icon: '🌧️', tags: ['rain', 'nature', 'relax'], _default: true },
  ];

  function getPlaylist() {
    try {
      var raw = localStorage.getItem(PLAYLIST_KEY);
      if (raw) {
        var parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch (_) {}
    savePlaylist(DEFAULT_PLAYLIST);
    return DEFAULT_PLAYLIST.slice();
  }

  function savePlaylist(playlist) {
    try {
      localStorage.setItem(PLAYLIST_KEY, JSON.stringify(playlist));
    } catch (_) {}
  }

  function getAllTags() {
    var playlist = getPlaylist();
    var tags = [];
    var seen = {};
    playlist.forEach(function (item) {
      (item.tags || []).forEach(function (tag) {
        var lower = tag.toLowerCase().trim();
        if (lower && !seen[lower]) {
          seen[lower] = true;
          tags.push(lower);
        }
      });
    });
    return tags;
  }

  function getSystemTags() {
    var tags = [];
    var seen = {};
    DEFAULT_PLAYLIST.forEach(function (item) {
      (item.tags || []).forEach(function (tag) {
        var lower = tag.toLowerCase().trim();
        if (lower && !seen[lower]) {
          seen[lower] = true;
          tags.push(lower);
        }
      });
    });
    return tags;
  }

  /* ----------------------------------------------------------
     YOUTUBE URL PARSER
     Accepts: watch URL, short URL, shorts URL, embed URL, or raw video ID
     ---------------------------------------------------------- */
  function extractVideoId(input) {
    const trimmed = (input || '').trim();
    if (!trimmed) return null;
    if (/^[A-Za-z0-9_-]{11}$/.test(trimmed)) return trimmed;
    const m = trimmed.match(
      /(?:youtube\.com\/(?:watch\?v=|shorts\/|embed\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/
    );
    return m ? m[1] : null;
  }

  /* ----------------------------------------------------------
     YOUTUBE IFrame API LOADER
     Lazy-loads on first play interaction.
     ---------------------------------------------------------- */
  function loadYouTubeAPI() {
    if (S.youtubeLoaded || S.youtubeLoading) return;

    if (window.YT && typeof window.YT.Player === 'function') {
      S.youtubeLoaded = true;
      createPlayer();
      return;
    }

    S.youtubeLoading = true;

    window.onYouTubeIframeAPIReady = function () {
      S.youtubeLoaded = true;
      S.youtubeLoading = false;
      S.autoPlay = true;
      createPlayer();
    };

    const tag = document.createElement('script');
    tag.src = 'https://www.youtube.com/iframe_api';
    tag.onerror = function () {
      S.youtubeLoading = false;
      console.warn('[FocusVibe] Failed to load YouTube API');
      const label = document.getElementById('focus-vibe-label');
      if (label) label.textContent = '⚠️ Failed to load player';
    };
    document.head.appendChild(tag);
  }

  /* ----------------------------------------------------------
     CREATE YOUTUBE PLAYER (hidden, no UI)
     ---------------------------------------------------------- */
  function createPlayer() {
    const target = document.getElementById('focus-vibe-player');
    if (!target) return;

    if (S.player && typeof S.player.destroy === 'function') {
      try { S.player.destroy(); } catch (_) {}
    }

    S.player = new YT.Player('focus-vibe-player', {
      height: '0',
      width: '0',
      videoId: S.currentVideoId,
      playerVars: {
        autoplay: 1,
        controls: 0,
        disablekb: 1,
        enablejsapi: 1,
        fs: 0,
        modestbranding: 1,
        playsinline: 1,
        rel: 0,
        iv_load_policy: 3,
      },
      events: {
        onReady: onPlayerReady,
        onStateChange: onPlayerStateChange,
        onError: onPlayerError,
      },
    });
  }

  function onPlayerReady() {
    S.playerReady = true;
    S.player.setVolume(Math.round(S.volume * 100));
    updatePlayButton();
    updateWidgetPlayingState();
  }

  function onPlayerStateChange(event) {
    S.isPlaying = event.data === YT.PlayerState.PLAYING;
    updatePlayButton();
    updateWidgetPlayingState();

    if (event.data === YT.PlayerState.PLAYING) {
      startVisualizer();
    } else if (event.data === YT.PlayerState.PAUSED) {
      stopVisualizer();
    }

    if (event.data === YT.PlayerState.ENDED) {
      playNextTrack();
    }
  }

  function onPlayerError(event) {
    console.warn('[FocusVibe] YouTube error:', event.data);
    S.isPlaying = false;
    updatePlayButton();
    updateWidgetPlayingState();
    stopVisualizer();
    const label = document.getElementById('focus-vibe-label');
    if (label) label.textContent = '⚠️ Track unavailable';
  }

  /* ----------------------------------------------------------
     PLAYER CONTROLS
     ---------------------------------------------------------- */
  function togglePlay() {
    if (!S.playerReady || !S.player) {
      loadYouTubeAPI();
      return;
    }

    if (S.isPlaying) {
      S.player.pauseVideo();
    } else {
      S.player.playVideo();
    }
  }

  function setVolume(val) {
    S.volume = Math.max(0, Math.min(1, val));
    if (S.playerReady && S.player) {
      S.player.setVolume(Math.round(S.volume * 100));
    }
  }

  function loadVideo(videoId, vibeName) {
    S.currentVideoId = videoId;
    S.currentVibe = vibeName || 'Custom';

    const label = document.getElementById('focus-vibe-label');
    if (label) label.textContent = S.currentVibe;

    // Highlight active pill in floating widget
    document.querySelectorAll('.vibe-pill').forEach(function (pill) {
      pill.classList.toggle('active', pill.dataset.videoId === videoId);
    });

    // Refresh studio grid & now-playing if visible
    refreshVibeGrid();
    const studioLabel = document.getElementById('studio-now-label');
    if (studioLabel) studioLabel.textContent = S.currentVibe;

    if (S.playerReady && S.player) {
      S.player.loadVideoById(videoId);
      S.player.playVideo();
    } else {
      loadYouTubeAPI();
    }
  }

  /* ----------------------------------------------------------
     NEXT TRACK (sequential playback with loop)
     ---------------------------------------------------------- */
  function playNextTrack() {
    var playlist = getPlaylist();
    var activeTag = S._activeTag || null;

    // Use filtered list if a tag is active
    var activeList = activeTag
      ? playlist.filter(function (item) { return (item.tags || []).indexOf(activeTag) !== -1; })
      : playlist;

    if (activeList.length === 0) {
      // Fallback to full playlist if filter yields nothing
      activeList = playlist;
    }
    if (activeList.length === 0) return;

    var currentIdx = -1;
    for (var i = 0; i < activeList.length; i++) {
      if (activeList[i].videoId === S.currentVideoId) {
        currentIdx = i;
        break;
      }
    }

    // If current track not in active list, start from first
    var nextIdx = currentIdx >= 0 ? (currentIdx + 1) % activeList.length : 0;
    var next = activeList[nextIdx];

    loadVideo(next.videoId, next.name);
  }

  /* ----------------------------------------------------------
     UI UPDATES
     ---------------------------------------------------------- */
  function updatePlayButton() {
    var btn = document.getElementById('focus-vibe-play');
    if (btn) {
      btn.textContent = S.isPlaying ? '⏸' : '▶';
      btn.classList.toggle('playing', S.isPlaying);
    }
    var studioBtn = document.getElementById('studio-play-btn');
    if (studioBtn) {
      studioBtn.textContent = S.isPlaying ? '⏸' : '▶';
    }
  }

  function updateWidgetPlayingState() {
    var widget = document.getElementById('focus-vibe-widget');
    if (widget) {
      widget.classList.toggle('playing', S.isPlaying);
    }
  }

  /* ----------------------------------------------------------
     NEON AUDIO VISUALIZER (simulated — no Web Audio API)
     Smooth random pulse synced to YouTube player state.
     ---------------------------------------------------------- */
  function initVisualizer() {
    var container = document.getElementById('focus-vibe-visualizer');
    if (!container) return;
    S._visualizer.bars = [].slice.call(container.querySelectorAll('.vibe-bar'));
    S._visualizer.targets = S._visualizer.bars.map(function () { return 10; });
    // Set initial idle state
    S._visualizer.bars.forEach(function (bar) { bar.style.height = '10%'; });
  }

  function startVisualizer() {
    var V = S._visualizer;
    if (V.running) return;
    if (!V.bars || V.bars.length === 0) initVisualizer();
    if (!V.bars || V.bars.length === 0) return;

    V.running = true;
    V.lastUpdate = 0;
    V.targets = V.bars.map(function () { return 10; });
    loopVisualizer();
  }

  function stopVisualizer() {
    var V = S._visualizer;
    V.running = false;
    if (V.rafId) {
      cancelAnimationFrame(V.rafId);
      V.rafId = null;
    }
    // Smoothly settle all bars to idle
    if (V.bars) {
      V.bars.forEach(function (bar) { bar.style.height = '10%'; });
    }
  }

  function loopVisualizer(timestamp) {
    var V = S._visualizer;
    if (!V.running) return;

    if (!timestamp) timestamp = 0;
    if (!V.lastUpdate) V.lastUpdate = timestamp;

    // Every ~180ms, pick 2-3 random bars and assign new random heights
    if (timestamp - V.lastUpdate >= 180) {
      V.lastUpdate = timestamp;
      var count = 2 + Math.floor(Math.random() * 2); // 2 or 3 bars
      var indices = [];
      while (indices.length < count) {
        var idx = Math.floor(Math.random() * V.bars.length);
        if (indices.indexOf(idx) === -1) indices.push(idx);
      }
      indices.forEach(function (i) {
        V.targets[i] = 20 + Math.floor(Math.random() * 80); // 20%–100%
      });
    }

    // Lerp each bar toward its target
    V.bars.forEach(function (bar, i) {
      var current = parseFloat(bar.style.height) || 10;
      var next = current + (V.targets[i] - current) * 0.35;
      bar.style.height = next + '%';
    });

    V.rafId = requestAnimationFrame(loopVisualizer);
  }
  function handleCustomUrl(url) {
    var videoId = extractVideoId(url);
    var input = document.getElementById('focus-vibe-url');
    if (!videoId) {
      if (input) {
        input.classList.add('error');
        input.placeholder = '❌ Invalid YouTube link';
        setTimeout(function () {
          input.classList.remove('error');
          input.placeholder = 'Paste YouTube link...';
        }, 2000);
      }
      return;
    }
    loadVideo(videoId, '🎵 Custom');
    if (input) input.value = '';
  }

  /* ----------------------------------------------------------
     MINIMIZE / EXPAND
     ---------------------------------------------------------- */
  function minimize() {
    var widget = document.getElementById('focus-vibe-widget');
    if (widget) widget.classList.add('minimized');
  }

  function expand() {
    var widget = document.getElementById('focus-vibe-widget');
    if (widget) widget.classList.remove('minimized');
  }

  /* ----------------------------------------------------------
     DRAG SYSTEM (smooth drag-and-drop with click/drag diff)
     Initiated by grabbing .focus-vibe-trigger (minimized) or
     .focus-vibe-header (expanded). Position saved to localStorage.
     ---------------------------------------------------------- */

  function isDragHandle(target) {
    var trigger = document.getElementById('focus-vibe-trigger');
    if (trigger && trigger.contains(target)) return true;

    var header = document.querySelector('.focus-vibe-header');
    if (header && header.contains(target)) {
      if (target.closest('button')) return false;
      return true;
    }
    return false;
  }

  function getEventPoint(e) {
    if (e.touches && e.touches.length > 0) {
      return { x: e.touches[0].clientX, y: e.touches[0].clientY };
    }
    if (e.changedTouches && e.changedTouches.length > 0) {
      return { x: e.changedTouches[0].clientX, y: e.changedTouches[0].clientY };
    }
    return { x: e.clientX, y: e.clientY };
  }

  function clampToViewport(left, top, widget) {
    var rect = widget.getBoundingClientRect();
    var maxX = window.innerWidth - rect.width;
    var maxY = window.innerHeight - rect.height;
    return {
      left: Math.max(0, Math.min(left, maxX)),
      top: Math.max(0, Math.min(top, maxY))
    };
  }

  function saveDragPosition(left, top) {
    try {
      localStorage.setItem(POSITION_KEY, JSON.stringify({ left: left, top: top }));
    } catch (_) {}
  }

  function restoreDragPosition(widget) {
    try {
      var raw = localStorage.getItem(POSITION_KEY);
      if (raw) {
        var pos = JSON.parse(raw);
        if (typeof pos.left === 'number' && typeof pos.top === 'number') {
          var clamped = clampToViewport(pos.left, pos.top, widget);
          widget.style.left = clamped.left + 'px';
          widget.style.top = clamped.top + 'px';
          widget.style.right = 'auto';
          widget.style.bottom = 'auto';
        }
      }
    } catch (_) {}
  }

  function onDragStart(e, widget) {
    if (!isDragHandle(e.target)) return;

    var point = getEventPoint(e);
    var rect = widget.getBoundingClientRect();

    S._drag.active = true;
    S._drag.moved = false;
    S._drag.startX = point.x;
    S._drag.startY = point.y;

    // Convert right/bottom positioning to left/top on first drag
    if (!widget.style.left || widget.style.left === 'auto' || widget.style.left === '') {
      widget.style.left = rect.left + 'px';
      widget.style.top = rect.top + 'px';
      widget.style.right = 'auto';
      widget.style.bottom = 'auto';
    }

    S._drag.startLeft = parseFloat(widget.style.left) || rect.left;
    S._drag.startTop = parseFloat(widget.style.top) || rect.top;

    widget.classList.add('dragging');

    if (e.type === 'touchstart') {
      e.preventDefault();
    }
  }

  function onDragMove(e, widget) {
    if (!S._drag.active) return;

    var point = getEventPoint(e);
    var dx = point.x - S._drag.startX;
    var dy = point.y - S._drag.startY;

    if (!S._drag.moved && (Math.abs(dx) > 5 || Math.abs(dy) > 5)) {
      S._drag.moved = true;
    }

    if (S._drag.moved) {
      var newLeft = S._drag.startLeft + dx;
      var newTop = S._drag.startTop + dy;
      var clamped = clampToViewport(newLeft, newTop, widget);
      widget.style.left = clamped.left + 'px';
      widget.style.top = clamped.top + 'px';
    }

    if (e.type === 'touchmove') {
      e.preventDefault();
    }
  }

  function onDragEnd(e, widget) {
    if (!S._drag.active) return;

    widget.classList.remove('dragging');

    if (S._drag.moved) {
      saveDragPosition(parseFloat(widget.style.left), parseFloat(widget.style.top));
      S._drag._justDragged = true;
      setTimeout(function () { S._drag._justDragged = false; }, 0);
    }

    S._drag.active = false;
    S._drag.moved = false;
  }

  function installDragHandlers(widget) {
    restoreDragPosition(widget);

    widget.addEventListener('mousedown', function (e) { onDragStart(e, widget); });
    document.addEventListener('mousemove', function (e) { onDragMove(e, widget); });
    document.addEventListener('mouseup', function (e) { onDragEnd(e, widget); });

    widget.addEventListener('touchstart', function (e) { onDragStart(e, widget); }, { passive: false });
    document.addEventListener('touchmove', function (e) { onDragMove(e, widget); }, { passive: false });
    document.addEventListener('touchend', function (e) { onDragEnd(e, widget); });

    // Capture-phase click: suppress button clicks after a drag
    widget.addEventListener('click', function (e) {
      if (S._drag._justDragged) {
        e.stopPropagation();
        e.preventDefault();
        S._drag._justDragged = false;
      }
    }, true);
  }

  /* ----------------------------------------------------------
     RENDER FLOATING WIDGET PILLS (from playlist)
     ---------------------------------------------------------- */
  function renderVibePills() {
    var container = document.getElementById('focus-vibe-vibes');
    if (!container || container.children.length > 0) return;

    var playlist = getPlaylist();
    playlist.forEach(function (v) {
      var pill = document.createElement('button');
      pill.className = 'vibe-pill';
      if (v.videoId === S.currentVideoId) pill.classList.add('active');
      pill.dataset.videoId = v.videoId;
      pill.dataset.vibeName = v.name;
      pill.textContent = v.name;
      pill.addEventListener('click', function () {
        loadVideo(this.dataset.videoId, this.dataset.vibeName);
      });
      container.appendChild(pill);
    });
  }

  /* ----------------------------------------------------------
     BIND FLOATING WIDGET EVENTS
     ---------------------------------------------------------- */
  function bindWidgetEvents() {
    var widget = document.getElementById('focus-vibe-widget');
    if (widget) installDragHandlers(widget);

    var playBtn = document.getElementById('focus-vibe-play');
    if (playBtn) playBtn.addEventListener('click', togglePlay);

    var nextBtn = document.getElementById('focus-vibe-next');
    if (nextBtn) nextBtn.addEventListener('click', playNextTrack);

    var volSlider = document.getElementById('focus-vibe-volume');
    if (volSlider) {
      volSlider.addEventListener('input', function () {
        setVolume(parseFloat(this.value));
      });
    }

    var loadBtn = document.getElementById('focus-vibe-load');
    if (loadBtn) {
      loadBtn.addEventListener('click', function () {
        var input = document.getElementById('focus-vibe-url');
        if (input) handleCustomUrl(input.value);
      });
    }

    var urlInput = document.getElementById('focus-vibe-url');
    if (urlInput) {
      urlInput.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') handleCustomUrl(this.value);
      });
    }

    var minBtn = document.getElementById('focus-vibe-minimize');
    if (minBtn) minBtn.addEventListener('click', minimize);

    var triggerBtn = document.getElementById('focus-vibe-trigger');
    if (triggerBtn) triggerBtn.addEventListener('click', expand);

    if (volSlider) volSlider.value = String(S.volume);
  }

  /* ----------------------------------------------------------
     STUDIO PAGE — RENDER HELPERS
     Pure functions returning HTML strings.
     ---------------------------------------------------------- */
  function renderTagFilterHTML(allTags, activeTag) {
    var systemTags = getSystemTags();
    var html = '<button class="studio-tag-pill' + (activeTag === null ? ' active' : '') + '" data-tag="">All Vibes</button>';
    allTags.forEach(function (tag) {
      var isSystem = systemTags.indexOf(tag) !== -1;
      var deleteHtml = isSystem
        ? ''
        : '<span class="studio-tag-pill-delete" data-delete-tag="' + tag + '" title="Remove this tag from all videos">&times;</span>';
      html += '<button class="studio-tag-pill' + (activeTag === tag ? ' active' : '') + '" data-tag="' + tag + '">#' + tag + deleteHtml + '</button>';
    });
    return html;
  }

  function renderVibeGridHTML(playlist, filterTag) {
    var filtered = filterTag
      ? playlist.filter(function (item) { return (item.tags || []).indexOf(filterTag) !== -1; })
      : playlist;

    if (filtered.length === 0) {
      return '<div class="studio-vibe-empty glass-card">No vibes match this tag.<br>Try another filter or add a new vibe below.</div>';
    }

    return filtered.map(function (v) {
      var activeClass = v.videoId === S.currentVideoId ? ' studio-vibe-active' : '';
      var statusText = v.videoId === S.currentVideoId ? (S.isPlaying ? '🔊 Playing' : '⏸ Paused') : '';
      var deleteBtn = v._default
        ? ''
        : '<button class="studio-vibe-card-delete" data-delete-id="' + v.id + '" title="Remove from library" aria-label="Remove from library">🗑</button>';

      return '<div class="studio-vibe-card glass-card' + activeClass + '" data-video-id="' + v.videoId + '" data-vibe-name="' + v.name + '" data-id="' + v.id + '">' +
        deleteBtn +
        '<div class="studio-vibe-card-icon">' + v.icon + '</div>' +
        '<div class="studio-vibe-card-name">' + v.name + '</div>' +
        '<div class="studio-vibe-card-tags">' + (v.tags || []).map(function (t) { return '#' + t; }).join(' ') + '</div>' +
        '<div class="studio-vibe-card-status" data-status-for="' + v.videoId + '">' + statusText + '</div>' +
      '</div>';
    }).join('');
  }

  /* ----------------------------------------------------------
     STUDIO PAGE — DOM REFRESHERS
     Update parts of the page without a full re-render.
     ---------------------------------------------------------- */
  function refreshTagFilters() {
    var container = document.getElementById('studio-tag-filter');
    if (!container) return;
    var allTags = getAllTags();
    var activeTag = S._activeTag || null;
    container.innerHTML = renderTagFilterHTML(allTags, activeTag);
  }

  function refreshVibeGrid() {
    var container = document.getElementById('studio-vibe-grid');
    if (!container) return;
    var playlist = getPlaylist();
    var activeTag = S._activeTag || null;
    container.innerHTML = renderVibeGridHTML(playlist, activeTag);
  }

  /* ----------------------------------------------------------
     STUDIO PAGE — DELETE & SAVE LOGIC
     ---------------------------------------------------------- */
  function deleteVibeFromLibrary(id) {
    var playlist = getPlaylist();
    var idx = -1;
    for (var i = 0; i < playlist.length; i++) {
      if (playlist[i].id === id) { idx = i; break; }
    }
    if (idx === -1) return;
    if (playlist[idx]._default) return;
    playlist.splice(idx, 1);
    savePlaylist(playlist);
    refreshTagFilters();
    refreshVibeGrid();
  }

  function deleteTagGlobally(tag) {
    if (!window.confirm('Remove the tag "#' + tag + '" from all videos in your library?')) return;

    var playlist = getPlaylist();
    playlist.forEach(function (item) {
      if (item.tags) {
        item.tags = item.tags.filter(function (t) { return t.toLowerCase().trim() !== tag; });
      }
    });
    savePlaylist(playlist);

    if (S._activeTag === tag) S._activeTag = null;

    refreshTagFilters();
    refreshVibeGrid();
  }

  function saveNewVibe(urlInput, title, tagsStr) {
    var videoId = extractVideoId(urlInput);
    var urlField = document.getElementById('studio-add-url');

    if (!videoId) {
      if (urlField) {
        urlField.classList.add('error');
        urlField.placeholder = '❌ Invalid YouTube link or ID';
        setTimeout(function () {
          urlField.classList.remove('error');
          urlField.placeholder = 'YouTube URL or Video ID';
        }, 2000);
      }
      return;
    }

    var name = (title || '').trim();
    if (!name) {
      var titleField = document.getElementById('studio-add-title');
      if (titleField) {
        titleField.classList.add('error');
        titleField.placeholder = '❌ Please enter a title';
        setTimeout(function () {
          titleField.classList.remove('error');
          titleField.placeholder = 'Title for this vibe';
        }, 2000);
      }
      return;
    }

    var tags = (tagsStr || '').split(',').map(function (t) { return t.trim().toLowerCase(); }).filter(Boolean);
    if (tags.length === 0) tags = ['uncategorized'];

    var newVibe = {
      id: 'custom_' + Date.now().toString(36),
      name: name,
      videoId: videoId,
      icon: '🎵',
      tags: tags,
    };

    var playlist = getPlaylist();
    playlist.push(newVibe);
    savePlaylist(playlist);

    // Clear form
    var uf = document.getElementById('studio-add-url');
    var tf = document.getElementById('studio-add-title');
    var gf = document.getElementById('studio-add-tags');
    if (uf) uf.value = '';
    if (tf) tf.value = '';
    if (gf) gf.value = '';

    // Reset filter to show all
    S._activeTag = null;
    refreshTagFilters();
    refreshVibeGrid();

    // Play it
    loadVideo(videoId, name);
    var label = document.getElementById('studio-now-label');
    if (label) label.textContent = name;
  }

  /* ----------------------------------------------------------
     MODULE PAGE (rendered into #main-content)
     Full-featured Focus Vibe Studio with dynamic playlist.
     ---------------------------------------------------------- */
  function renderStudioPage(container) {
    var playlist = getPlaylist();
    var allTags = getAllTags();
    var activeTag = S._activeTag || null;

    container.innerHTML =
      '<div class="tab-content focus-vibe-studio">' +
        '<h1 class="studio-title"><span class="text-gradient">🎧 Focus Vibe Studio</span></h1>' +
        '<p class="studio-subtitle">Smart dynamic playlist — save your favorite focus sounds</p>' +

        // Tag Filter Bar
        '<div class="studio-section">' +
          '<div class="studio-tag-filter" id="studio-tag-filter">' +
            renderTagFilterHTML(allTags, activeTag) +
          '</div>' +
        '</div>' +

        // Dynamic Vibe Grid
        '<div class="studio-section">' +
          '<h2 class="section-header">Your Library</h2>' +
          '<div class="studio-vibe-grid" id="studio-vibe-grid">' +
            renderVibeGridHTML(playlist, activeTag) +
          '</div>' +
        '</div>' +

        // Add to Library Form
        '<div class="studio-section">' +
          '<h2 class="section-header">Add to Library</h2>' +
          '<div class="studio-add-card glass-card">' +
            '<div class="studio-add-form">' +
              '<input type="text" id="studio-add-url" class="focus-vibe-url-input" placeholder="YouTube URL or Video ID" spellcheck="false">' +
              '<input type="text" id="studio-add-title" class="focus-vibe-url-input" placeholder="Title for this vibe" spellcheck="false">' +
              '<input type="text" id="studio-add-tags" class="focus-vibe-url-input" placeholder="Tags: lofi, focus, chill" spellcheck="false">' +
              '<button id="studio-add-save" class="btn btn-primary studio-save-btn">💾 Save to Library &amp; Play</button>' +
            '</div>' +
          '</div>' +
        '</div>' +

        // Current Session
        '<div class="studio-section">' +
          '<h2 class="section-header">Current Session</h2>' +
          '<div class="studio-session-card glass-card">' +
            '<div class="studio-session-info">' +
              '<span class="studio-session-label">Now Playing</span>' +
              '<span class="studio-session-value" id="studio-now-label">' + S.currentVibe + '</span>' +
            '</div>' +
            '<div class="studio-session-controls">' +
              '<button id="studio-play-btn" class="studio-main-btn">' + (S.isPlaying ? '⏸' : '▶') + '</button>' +
              '<div class="studio-volume-wrap">' +
                '<span>🔊</span>' +
                '<input type="range" id="studio-volume" class="focus-vibe-volume" min="0" max="1" step="0.01" value="' + S.volume + '">' +
              '</div>' +
            '</div>' +
          '</div>' +
        '</div>' +
      '</div>';

    bindStudioEvents(container);
  }

  /* ----------------------------------------------------------
     STUDIO PAGE — EVENT BINDING (uses delegation)
     ---------------------------------------------------------- */
  function bindStudioEvents(container) {
    // Tag filter clicks — delegation
    var tagFilter = container.querySelector('#studio-tag-filter');
    if (tagFilter) {
      tagFilter.addEventListener('click', function (e) {
        // Delete-tag icon click → remove tag from all videos
        var deleteIcon = e.target.closest('.studio-tag-pill-delete');
        if (deleteIcon) {
          e.stopPropagation();
          deleteTagGlobally(deleteIcon.dataset.deleteTag);
          return;
        }

        // Filter click
        var pill = e.target.closest('.studio-tag-pill');
        if (!pill) return;
        var tag = pill.dataset.tag || null;
        S._activeTag = tag || null;
        refreshTagFilters();
        refreshVibeGrid();
      });
    }

    // Vibe grid clicks — delegation for play + delete
    var vibeGrid = container.querySelector('#studio-vibe-grid');
    if (vibeGrid) {
      vibeGrid.addEventListener('click', function (e) {
        // Delete button
        var deleteBtn = e.target.closest('.studio-vibe-card-delete');
        if (deleteBtn) {
          e.stopPropagation();
          deleteVibeFromLibrary(deleteBtn.dataset.deleteId);
          return;
        }

        // Card click → play
        var card = e.target.closest('.studio-vibe-card');
        if (!card) return;
        var videoId = card.dataset.videoId;
        var vibeName = card.dataset.vibeName;
        loadVideo(videoId, vibeName);
      });
    }

    // Play button
    var playBtn = container.querySelector('#studio-play-btn');
    if (playBtn) playBtn.addEventListener('click', togglePlay);

    // Volume slider
    var volSlider = container.querySelector('#studio-volume');
    if (volSlider) {
      volSlider.addEventListener('input', function () {
        setVolume(parseFloat(this.value));
        var fwVol = document.getElementById('focus-vibe-volume');
        if (fwVol) fwVol.value = this.value;
      });
    }

    // Save to library
    var saveBtn = container.querySelector('#studio-add-save');
    var urlInput = container.querySelector('#studio-add-url');
    var titleInput = container.querySelector('#studio-add-title');
    var tagsInput = container.querySelector('#studio-add-tags');

    if (saveBtn && urlInput && titleInput) {
      var doSave = function () {
        saveNewVibe(urlInput.value, titleInput.value, tagsInput ? tagsInput.value : '');
      };
      saveBtn.addEventListener('click', doSave);
      [urlInput, titleInput, tagsInput].forEach(function (input) {
        if (input) {
          input.addEventListener('keydown', function (e) {
            if (e.key === 'Enter') doSave();
          });
        }
      });
    }
  }

  /* ----------------------------------------------------------
     INITIALIZE FLOATING WIDGET
     ---------------------------------------------------------- */
  function initWidget() {
    if (S.initCalled) return;
    S.initCalled = true;

    initVisualizer();
    renderVibePills();
    bindWidgetEvents();
    updatePlayButton();
    updateWidgetPlayingState();

    var volSlider = document.getElementById('focus-vibe-volume');
    if (volSlider) volSlider.value = String(S.volume);
  }

  /* ----------------------------------------------------------
     MODULE DEFINITION
     ---------------------------------------------------------- */
  var focusVibeModule = {
    id: 'focus-vibe',
    name: 'Focus Vibe',
    icon: '🎧',

    render: function (container) {
      initWidget();
      renderStudioPage(container);
    },

    destroy: function () {
      // Player & floating widget persist across SPA tab switches.
      // Studio DOM listeners die with innerHTML teardown.
    },
  };

  /* ----------------------------------------------------------
     REGISTER WITH THE APP
     ---------------------------------------------------------- */
  app.register(focusVibeModule);

  /* ----------------------------------------------------------
     AUTO-INIT on DOMContentLoaded
     ---------------------------------------------------------- */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initWidget);
  } else {
    initWidget();
  }

  /* ----------------------------------------------------------
     EXPOSE FOR CROSS-MODULE ACCESS
     ---------------------------------------------------------- */
  window.__focusVibe = {
    togglePlay: togglePlay,
    setVolume: setVolume,
    loadVideo: loadVideo,
    playNextTrack: playNextTrack,
    getState: function () { return { isPlaying: S.isPlaying, currentVibe: S.currentVibe }; },
  };

})();