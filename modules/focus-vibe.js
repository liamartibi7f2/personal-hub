/* ============================================================
   HUB.OS — Focus Vibe (Music & Ambient Sound Player)
   Persistent floating widget with YouTube IFrame API integration.
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
    currentVideoId: 'jfKfPfyJRdk',
    currentVibe: 'Lofi Beats',
    volume: 0.5,
    playerReady: false,
    youtubeLoaded: false,
    youtubeLoading: false,
    initCalled: false,
  };

  /* ----------------------------------------------------------
     PRESET VIBES
     Each has: id, display name, YouTube video ID, icon
     ---------------------------------------------------------- */
  const VIBES = [
    { id: 'lofi',      name: 'Lofi Beats',        videoId: 'jfKfPfyJRdk', icon: '🎹' },
    { id: 'cyberpunk', name: 'Cyberpunk Ambient', videoId: '4WTYEkeP4v0', icon: '🤖' },
    { id: 'rain',      name: 'Rain & Thunder',    videoId: 'mPZkdNFkNps', icon: '🌧️' },
  ];

  /* ----------------------------------------------------------
     YOUTUBE URL PARSER
     Accepts: watch URL, short URL, embed URL, or raw video ID
     ---------------------------------------------------------- */
  function extractVideoId(input) {
    const trimmed = (input || '').trim();
    if (!trimmed) return null;
    // Bare 11-char video ID
    if (/^[A-Za-z0-9_-]{11}$/.test(trimmed)) return trimmed;
    // Standard YouTube formats
    const m = trimmed.match(
      /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([A-Za-z0-9_-]{11})/
    );
    return m ? m[1] : null;
  }

  /* ----------------------------------------------------------
     YOUTUBE IFrame API LOADER
     Lazy-loads on first play interaction.
     ---------------------------------------------------------- */
  function loadYouTubeAPI() {
    if (S.youtubeLoaded || S.youtubeLoading) return;

    // Already loaded externally
    if (window.YT && typeof window.YT.Player === 'function') {
      S.youtubeLoaded = true;
      createPlayer();
      return;
    }

    S.youtubeLoading = true;

    // Set up the global callback BEFORE injecting the script
    window.onYouTubeIframeAPIReady = function () {
      S.youtubeLoaded = true;
      S.youtubeLoading = false;
      S.autoPlay = true; // mark to autoplay once player is ready
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

    // Guard: YT won't create a second player on the same DOM target
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
    // YouTube states: -1 unstarted, 0 ended, 1 playing, 2 paused, 3 buffering, 5 cued
    S.isPlaying = event.data === YT.PlayerState.PLAYING;
    updatePlayButton();
    updateWidgetPlayingState();

    // Auto-replay on end (useful for non-live videos)
    if (event.data === YT.PlayerState.ENDED) {
      S.player.seekTo(0);
      S.player.playVideo();
    }
  }

  function onPlayerError(event) {
    console.warn('[FocusVibe] YouTube error:', event.data);
    S.isPlaying = false;
    updatePlayButton();
    updateWidgetPlayingState();
    const label = document.getElementById('focus-vibe-label');
    if (label) label.textContent = '⚠️ Track unavailable';
  }

  /* ----------------------------------------------------------
     PLAYER CONTROLS
     ---------------------------------------------------------- */
  function togglePlay() {
    if (!S.playerReady || !S.player) {
      // First interaction — load YouTube API
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

    // Update floating widget label
    const label = document.getElementById('focus-vibe-label');
    if (label) label.textContent = S.currentVibe;

    // Highlight active vibe pill
    document.querySelectorAll('.vibe-pill').forEach(function (pill) {
      pill.classList.toggle('active', pill.dataset.videoId === videoId);
    });

    // Load into player
    if (S.playerReady && S.player) {
      S.player.loadVideoById(videoId);
      S.player.playVideo();
    } else {
      loadYouTubeAPI();
    }
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
     HANDLE CUSTOM URL
     ---------------------------------------------------------- */
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
     RENDER VIBE PILLS
     Idempotent — only renders if container is empty.
     ---------------------------------------------------------- */
  function renderVibePills() {
    var container = document.getElementById('focus-vibe-vibes');
    if (!container || container.children.length > 0) return;

    VIBES.forEach(function (v) {
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
     Called once after widget is in DOM.
     ---------------------------------------------------------- */
  function bindWidgetEvents() {
    var playBtn = document.getElementById('focus-vibe-play');
    if (playBtn) playBtn.addEventListener('click', togglePlay);

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

    // Sync volume slider from persisted state
    if (volSlider) volSlider.value = String(S.volume);
  }

  /* ----------------------------------------------------------
     MODULE PAGE (rendered into #main-content)
     Full-featured Focus Vibe Studio.
     ---------------------------------------------------------- */
  function renderStudioPage(container) {
    container.innerHTML =
      '<div class="tab-content focus-vibe-studio">' +
        '<h1 class="studio-title"><span class="text-gradient">🎧 Focus Vibe Studio</span></h1>' +
        '<p class="studio-subtitle">Ambient sounds &amp; music to power your focus sessions</p>' +

        '<div class="studio-section">' +
          '<h2 class="section-header">Preset Vibes</h2>' +
          '<div class="studio-vibe-grid" id="studio-vibe-grid">' +
            VIBES.map(function (v) {
              var activeClass = v.videoId === S.currentVideoId ? ' studio-vibe-active' : '';
              return '<div class="studio-vibe-card glass-card' + activeClass + '" data-video-id="' + v.videoId + '" data-vibe-name="' + v.name + '">' +
                '<div class="studio-vibe-card-icon">' + v.icon + '</div>' +
                '<div class="studio-vibe-card-name">' + v.name + '</div>' +
                '<div class="studio-vibe-card-status" data-status-for="' + v.videoId + '">' +
                  (v.videoId === S.currentVideoId ? (S.isPlaying ? '🔊 Playing' : '⏸ Paused') : '') +
                '</div>' +
              '</div>';
            }).join('') +
          '</div>' +
        '</div>' +

        '<div class="studio-section">' +
          '<h2 class="section-header">Custom Link</h2>' +
          '<div class="studio-custom-row">' +
            '<input type="text" id="studio-custom-url" class="focus-vibe-url-input studio-url-input" placeholder="https://youtube.com/watch?v=..." spellcheck="false">' +
            '<button id="studio-load-btn" class="btn btn-primary">Load &amp; Play</button>' +
          '</div>' +
        '</div>' +

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

  function bindStudioEvents(container) {
    // Vibe cards
    var cards = container.querySelectorAll('.studio-vibe-card');
    Array.prototype.forEach.call(cards, function (card) {
      card.addEventListener('click', function () {
        var videoId = this.dataset.videoId;
        var vibeName = this.dataset.vibeName;

        loadVideo(videoId, vibeName);

        // Update active state
        Array.prototype.forEach.call(cards, function (c) { c.classList.remove('studio-vibe-active'); });
        this.classList.add('studio-vibe-active');

        // Update status text on all cards
        Array.prototype.forEach.call(cards, function (c) {
          var statusEl = c.querySelector('.studio-vibe-card-status');
          if (statusEl) {
            statusEl.textContent = c.dataset.videoId === videoId ? '🔊 Playing' : '';
          }
        });

        // Update now-playing label
        var label = document.getElementById('studio-now-label');
        if (label) label.textContent = vibeName;
      });
    });

    // Play button
    var playBtn = container.querySelector('#studio-play-btn');
    if (playBtn) playBtn.addEventListener('click', togglePlay);

    // Volume
    var volSlider = container.querySelector('#studio-volume');
    if (volSlider) {
      volSlider.addEventListener('input', function () {
        setVolume(parseFloat(this.value));
        // Sync with floating widget
        var fwVol = document.getElementById('focus-vibe-volume');
        if (fwVol) fwVol.value = this.value;
      });
    }

    // Custom URL
    var loadBtn = container.querySelector('#studio-load-btn');
    var urlInput = container.querySelector('#studio-custom-url');
    if (loadBtn && urlInput) {
      loadBtn.addEventListener('click', function () { handleCustomUrl(urlInput.value); });
      urlInput.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') handleCustomUrl(urlInput.value);
      });
    }
  }

  /* ----------------------------------------------------------
     INITIALIZE FLOATING WIDGET
     Attaches to body; idempotent — only sets up once.
     ---------------------------------------------------------- */
  function initWidget() {
    if (S.initCalled) return;
    S.initCalled = true;

    // The widget HTML is already in index.html — just bind and render pills
    renderVibePills();
    bindWidgetEvents();
    updatePlayButton();
    updateWidgetPlayingState();

    // Sync volume slider from persisted state
    var volSlider = document.getElementById('focus-vibe-volume');
    if (volSlider) volSlider.value = String(S.volume);
  }

  /* ----------------------------------------------------------
     MODULE DEFINITION
     Registered with app.register() so it appears in sidebar.
     ---------------------------------------------------------- */
  var focusVibeModule = {
    id: 'focus-vibe',
    name: 'Focus Vibe',
    icon: '🎧',

    render: function (container) {
      // Initialize the persistent floating widget (once)
      initWidget();

      // Render the full studio page in the main content area
      renderStudioPage(container);
    },

    destroy: function () {
      // INTENTIONALLY DO NOT destroy the player or floating widget.
      // The player continues playing across SPA tab switches.
      // Only the studio page content in #main-content is cleared
      // by the parent app.js harness.
      //
      // If we need to clean up studio-specific listeners, do it here.
      // Currently, studio listeners are on elements that get removed
      // with innerHTML, so they die with the DOM.
    },
  };

  /* ----------------------------------------------------------
     REGISTER WITH THE APP
     ---------------------------------------------------------- */
  app.register(focusVibeModule);

  /* ----------------------------------------------------------
     AUTO-INIT on DOMContentLoaded
     The floating widget is in index.html and should be
     interactive immediately, not just when the module is visited.
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
    getState: function () { return { isPlaying: S.isPlaying, currentVibe: S.currentVibe }; },
  };

})();