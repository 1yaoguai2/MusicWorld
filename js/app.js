/* ============================================================
   MusicWorld · app.js
   播放控制 / 歌单 / 渲染 / 交互
   ============================================================ */
(function () {
  'use strict';

  const MW = window.MW;
  const $ = function (sel) { return document.querySelector(sel); };

  /* ============================================================
     DOM 引用
     ============================================================ */
  const el = {
    audio: $('#audio'),

    sidebar: $('#sidebar'),
    btnLoadFolderTop: $('#btnLoadFolderTop'),
    btnEmptyLoad: $('#btnEmptyLoad'),
    btnEmptyFiles: $('#btnEmptyFiles'),
    btnRestoreLib: $('#btnRestoreLib'),
    btnRescan: $('#btnRescan'),
    inputDir: $('#inputDir'),
    inputFiles: $('#inputFiles'),
    libStatus: $('#libStatus'),
    libStatusText: $('#libStatusText'),
    navBuiltin: $('#navBuiltin'),
    navPlaylists: $('#navPlaylists'),
    playlistEmpty: $('#playlistEmpty'),
    btnNewPlaylist: $('#btnNewPlaylist'),
    btnOpenSidebar: $('#btnOpenSidebar'),

    btnTheme: $('#btnTheme'),
    searchInput: $('#searchInput'),
    btnClearSearch: $('#btnClearSearch'),
    searchBox: $('.search-box'),

    emptyState: $('#emptyState'),
    autoHint: $('#autoHint'),
    listView: $('#listView'),
    listCover: $('#listCover'),
    listEyebrow: $('#listEyebrow'),
    listTitle: $('#listTitle'),
    listDesc: $('#listDesc'),
    btnPlayAll: $('#btnPlayAll'),
    btnShuffleAll: $('#btnShuffleAll'),
    btnRenamePlaylist: $('#btnRenamePlaylist'),
    btnDeletePlaylist: $('#btnDeletePlaylist'),
    trackList: $('#trackList'),
    listEmpty: $('#listEmpty'),

    nowPanel: $('#nowPanel'),
    btnCloseNow: $('#btnCloseNow'),
    nowCover: $('#nowCover'),
    nowCoverImg: $('#nowCoverImg'),
    nowTitle: $('#nowTitle'),
    nowArtist: $('#nowArtist'),
    lyrics: $('#lyrics'),
    lyricsInner: $('#lyricsInner'),
    btnNowAddToList: $('#btnNowAddToList'),
    btnNowFav: $('#btnNowFav'),
    btnOpenNow: $('#btnOpenNow'),

    pbInfo: $('#pbInfo'),
    miniCover: $('#miniCover'),
    miniCoverImg: $('#miniCoverImg'),
    miniTitle: $('#miniTitle'),
    miniArtist: $('#miniArtist'),
    btnFavMini: $('#btnFavMini'),

    btnMode: $('#btnMode'),
    btnPrev: $('#btnPrev'),
    btnPlay: $('#btnPlay'),
    btnNext: $('#btnNext'),
    btnQueue: $('#btnQueue'),
    btnMute: $('#btnMute'),

    curTime: $('#curTime'),
    durTime: $('#durTime'),
    progressBar: $('#progressBar'),
    progressFill: $('#progressFill'),
    progressThumb: $('#progressThumb'),
    volumeBar: $('#volumeBar'),
    volumeFill: $('#volumeFill'),
    volumeThumb: $('#volumeThumb'),

    overlay: $('#overlay'),
    addSheet: $('#addSheet'),
    addSheetBody: $('#addSheetBody'),
    btnSheetNewPlaylist: $('#btnSheetNewPlaylist'),
    promptSheet: $('#promptSheet'),
    promptTitle: $('#promptTitle'),
    promptInput: $('#promptInput'),
    promptError: $('#promptError'),
    promptCancel: $('#promptCancel'),
    promptOk: $('#promptOk'),
    queueDrawer: $('#queueDrawer'),
    queueBody: $('#queueBody'),
    queueCount: $('#queueCount'),
    btnCloseQueue: $('#btnCloseQueue'),
    toast: $('#toast'),
  };

  /* ============================================================
     状态
     ============================================================ */
  const stored = MW.store.read();

  const state = {
    tracks: [],
    trackMap: new Map(),
    playlists: stored.playlists,
    favorites: stored.favorites.slice(),
    currentPlaylist: stored.currentPlaylist || 'all',
    queue: [],
    index: -1,
    mode: stored.mode || 'list',
    theme: stored.theme || 'dark',
    volume: typeof stored.volume === 'number' ? stored.volume : 0.8,
    muted: !!stored.muted,
    currentTrack: null,
    currentObjectUrl: null,
    search: '',
    shufflePool: [],
    rootHandle: null,
    source: null,
    lyricLines: [],
    lyricIndex: -1,
    lyricPlain: false,
  };

  const MODE_ORDER = ['list', 'one', 'shuffle', 'order'];
  const MODE_LABEL = {
    list: '列表循环',
    one: '单曲循环',
    shuffle: '随机播放',
    order: '顺序播放（播完停止）',
  };

  const rowMap = new Map();
  let loadSeq = 0;
  let toastTimer = null;
  let addSheetTargetKey = null;
  let promptResolve = null;

  const supportsFSA = typeof window.showDirectoryPicker === 'function';

  /* ============================================================
     通用 UI
     ============================================================ */
  function toast(msg) {
    el.toast.textContent = msg;
    el.toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.toast.classList.remove('show'); }, 2200);
  }

  function saveState() {
    MW.store.write(state);
  }

  function applyTheme() {
    document.documentElement.dataset.theme = state.theme;
    el.btnTheme.title = state.theme === 'dark' ? '切换到白天主题' : '切换到夜间主题';
  }

  function toggleTheme() {
    state.theme = state.theme === 'dark' ? 'light' : 'dark';
    applyTheme();
    saveState();
  }

  /* ============================================================
     歌单数据
     ============================================================ */
  function getPlaylistKeys(id) {
    if (id === 'all') return state.tracks.map(function (t) { return t.key; });
    if (id === 'fav') return state.favorites.filter(function (k) { return state.trackMap.has(k); });
    const pl = state.playlists.find(function (p) { return p.id === id; });
    return pl ? pl.keys.filter(function (k) { return state.trackMap.has(k); }) : [];
  }

  function getPlaylistName(id) {
    if (id === 'all') return '全部音乐';
    if (id === 'fav') return '我喜欢';
    const pl = state.playlists.find(function (p) { return p.id === id; });
    return pl ? pl.name : '全部音乐';
  }

  function isFavorite(key) { return state.favorites.indexOf(key) >= 0; }

  function toggleFavorite(key) {
    const i = state.favorites.indexOf(key);
    if (i >= 0) {
      state.favorites.splice(i, 1);
      toast('已从「我喜欢」移除');
    } else {
      state.favorites.push(key);
      toast('已加入「我喜欢」');
    }
    saveState();
    renderSidebar();
    updateRowStates();
    updateFavButtons();
    if (state.currentPlaylist === 'fav') renderTrackList();
  }

  function createPlaylist(name) {
    const pl = { id: 'pl_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name: name, keys: [] };
    state.playlists.push(pl);
    saveState();
    renderSidebar();
    return pl;
  }

  function addKeyToPlaylist(plId, key) {
    if (plId === 'fav') {
      if (!isFavorite(key)) { state.favorites.push(key); }
      saveState();
      return true;
    }
    const pl = state.playlists.find(function (p) { return p.id === plId; });
    if (!pl) return false;
    if (pl.keys.indexOf(key) >= 0) return false;
    pl.keys.push(key);
    saveState();
    return true;
  }

  /* ============================================================
     视图数据
     ============================================================ */
  function getViewKeys() {
    let keys = getPlaylistKeys(state.currentPlaylist);
    const q = state.search.trim().toLowerCase();
    if (q) {
      keys = keys.filter(function (k) {
        const t = state.trackMap.get(k);
        if (!t) return false;
        return (t.title || '').toLowerCase().indexOf(q) >= 0
          || (t.artist || '').toLowerCase().indexOf(q) >= 0
          || (t.album || '').toLowerCase().indexOf(q) >= 0
          || (t.fileName || '').toLowerCase().indexOf(q) >= 0;
      });
    }
    return keys;
  }

  function getViewTracks() {
    const out = [];
    getViewKeys().forEach(function (k) {
      const t = state.trackMap.get(k);
      if (t) out.push(t);
    });
    return out;
  }

  /* ============================================================
     渲染 · 侧边栏
     ============================================================ */
  const ICON_DISC = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="2.6"/></svg>';
  const ICON_HEART = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8l8.9 8.9 8.9-8.9a5.5 5.5 0 0 0 0-7.8z"/></svg>';
  const ICON_LIST = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><path d="M4 6h11M4 12h11M4 18h7"/><path d="M18 9v8"/><circle cx="16.4" cy="18" r="1.9"/></svg>';

  function renderSidebar() {
    const total = state.tracks.length;
    const favCount = getPlaylistKeys('fav').length;

    el.navBuiltin.innerHTML =
      '<li class="nav-item' + (state.currentPlaylist === 'all' ? ' active' : '') + '" data-playlist="all">'
      + ICON_DISC + '<span class="nav-label">全部音乐</span><span class="nav-count">' + total + '</span></li>'
      + '<li class="nav-item' + (state.currentPlaylist === 'fav' ? ' active' : '') + '" data-playlist="fav">'
      + ICON_HEART + '<span class="nav-label">我喜欢</span><span class="nav-count">' + favCount + '</span></li>';

    if (!state.playlists.length) {
      el.navPlaylists.innerHTML = '';
      el.playlistEmpty.hidden = false;
    } else {
      el.playlistEmpty.hidden = true;
      el.navPlaylists.innerHTML = state.playlists.map(function (pl) {
        const count = pl.keys.filter(function (k) { return state.trackMap.has(k); }).length;
        return '<li class="nav-item' + (state.currentPlaylist === pl.id ? ' active' : '') + '" data-playlist="' + MW.escapeHtml(pl.id) + '">'
          + ICON_LIST + '<span class="nav-label">' + MW.escapeHtml(pl.name) + '</span>'
          + '<span class="nav-count">' + count + '</span></li>';
      }).join('');
    }

    if (state.tracks.length) {
      el.libStatus.classList.add('ready');
      el.libStatusText.textContent = state.source === 'manifest'
        ? '已加载 ' + total + ' 首（清单）'
        : state.source === 'server'
          ? '已从服务器读取 ' + total + ' 首'
          : state.source === 'files'
            ? '已导入 ' + total + ' 首（本地文件）'
            : '已加载 ' + total + ' 首歌曲';
    } else {
      el.libStatus.classList.remove('ready');
      el.libStatusText.textContent = '音乐库未加载';
    }
  }

  /* ============================================================
     渲染 · 歌单主视图
     ============================================================ */
  function renderPlaylistView() {
    if (!state.tracks.length) {
      el.emptyState.hidden = false;
      el.listView.hidden = true;
      return;
    }
    el.emptyState.hidden = true;
    el.listView.hidden = false;

    const id = state.currentPlaylist;
    const isCustom = id !== 'all' && id !== 'fav';
    const keys = getPlaylistKeys(id);

    el.listEyebrow.textContent = id === 'all' ? '音乐库' : id === 'fav' ? '收藏' : '歌单';
    el.listTitle.textContent = getPlaylistName(id);

    let desc = keys.length + ' 首歌曲';
    if (id === 'all') {
      desc += state.source === 'files' ? ' · 来自导入的文件'
        : state.source === 'server' ? ' · 来自服务器目录'
          : ' · 来自 music 文件夹';
    }
    if (id === 'fav') desc += ' · 收藏的歌曲';
    if (isCustom) desc += ' · 自建歌单';
    if (state.search.trim()) desc = '匹配到 ' + getViewKeys().length + ' 首（共 ' + keys.length + ' 首）';
    el.listDesc.textContent = desc;

    el.btnRenamePlaylist.hidden = !isCustom;
    el.btnDeletePlaylist.hidden = !isCustom;

    // 封面：取歌单内第一首有封面的歌，否则用渐变
    updateListCover();

    renderTrackList();
  }

  function updateListCover() {
    const id = state.currentPlaylist;
    const keys = getPlaylistKeys(id);
    const firstWithCover = keys.map(function (k) { return state.trackMap.get(k); })
      .find(function (t) { return t && t.coverUrl; });

    const old = el.listCover.querySelector('img');
    if (old) old.remove();

    if (firstWithCover) {
      const img = document.createElement('img');
      img.src = firstWithCover.coverUrl;
      el.listCover.appendChild(img);
      el.listCover.style.background = '';
    } else {
      el.listCover.style.background = id === 'fav'
        ? 'linear-gradient(150deg,#ff5c8a,#a855f7)'
        : id === 'all' ? '' : MW.gradientFor(id);
    }
  }

  /* ============================================================
     渲染 · 歌曲列表
     ============================================================ */
  function trackRowHTML(track, index) {
    const isCurrent = state.currentTrack && state.currentTrack.key === track.key;
    const isPlaying = isCurrent && state.playing;
    const fav = isFavorite(track.key);
    const dur = track.duration ? MW.formatTime(track.duration) : '--:--';
    const initial = (track.title || '?').trim().charAt(0).toUpperCase();
    const cover = track.coverUrl
      ? '<img src="' + MW.escapeHtml(track.coverUrl) + '" alt="">'
      : '';

    return '<div class="track-row' + (isCurrent ? ' active' : '') + (isPlaying ? ' playing' : '') + '"'
      + ' data-key="' + MW.escapeHtml(track.key) + '">'
      + '<div class="col-index">'
      + '<span class="idx-num">' + (index + 1) + '</span>'
      + '<span class="idx-play"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg></span>'
      + '<span class="eq"><i></i><i></i><i></i></span>'
      + '</div>'
      + '<div class="col-title">'
      + '<div class="row-thumb" style="background:' + MW.gradientFor(track.key) + '">'
      + '<span>' + MW.escapeHtml(initial) + '</span>' + cover
      + '</div>'
      + '<div class="row-text">'
      + '<div class="col-title-main">' + MW.escapeHtml(track.title || track.fileName) + '</div>'
      + '<div class="col-title-sub">' + MW.escapeHtml(track.artist || '未知艺术家') + (track.hasLyrics ? ' · 歌词' : '') + '</div>'
      + '</div></div>'
      + '<div class="col-album">' + MW.escapeHtml(track.album || '—') + '</div>'
      + '<div class="col-dur">' + dur + '</div>'
      + '<div class="col-ops">'
      + '<button class="op-btn' + (fav ? ' on' : '') + '" data-op="fav" title="收藏">'
      + '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8l8.9 8.9 8.9-8.9a5.5 5.5 0 0 0 0-7.8z"/></svg>'
      + '</button>'
      + '<button class="op-btn" data-op="add" title="加入歌单">'
      + '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>'
      + '</button>'
      + '</div></div>';
  }

  function renderTrackList() {
    const keys = getViewKeys();
    rowMap.clear();

    if (!keys.length) {
      el.trackList.innerHTML = '';
      el.listEmpty.hidden = false;
      if (state.search.trim()) {
        el.listEmpty.innerHTML = '<p>没有匹配的歌曲</p><span>换个关键词试试</span>';
      } else       if (state.currentPlaylist === 'all') {
        el.listEmpty.innerHTML = state.source === 'files'
          ? '<p>音乐文件夹里还没有歌曲</p><span>把音频文件放进 music 文件夹后点击「重新扫描」</span>'
          : '<p>还没有歌曲</p><span>把音频文件放进 music 文件夹后点击左下角「重新扫描」</span>';
      } else {
        el.listEmpty.innerHTML = '<p>这里还没有歌曲</p><span>在「全部音乐」里把歌曲加入这个歌单吧</span>';
      }
      return;
    }

    el.listEmpty.hidden = true;
    const html = [];
    keys.forEach(function (key, i) {
      const track = state.trackMap.get(key);
      if (track) html.push(trackRowHTML(track, i));
    });
    el.trackList.innerHTML = html.join('');

    Array.prototype.forEach.call(el.trackList.children, function (row) {
      if (row.dataset && row.dataset.key != null) rowMap.set(row.dataset.key, row);
    });
  }

  function updateRowStates() {
    rowMap.forEach(function (row, key) {
      const isCurrent = state.currentTrack && state.currentTrack.key === key;
      row.classList.toggle('active', !!isCurrent);
      row.classList.toggle('playing', !!isCurrent && state.playing);
    });
  }

  function updateTrackRow(track) {
    const row = rowMap.get(track.key);
    if (!row) return;
    const titleEl = row.querySelector('.col-title-main');
    const subEl = row.querySelector('.col-title-sub');
    const durEl = row.querySelector('.col-dur');
    const thumb = row.querySelector('.row-thumb');
    if (titleEl) titleEl.textContent = track.title || track.fileName;
    if (subEl) subEl.textContent = (track.artist || '未知艺术家') + (track.hasLyrics ? ' · 歌词' : '');
    if (durEl) durEl.textContent = track.duration ? MW.formatTime(track.duration) : '--:--';
    if (thumb && track.coverUrl && !thumb.querySelector('img')) {
      const img = document.createElement('img');
      img.src = track.coverUrl;
      thumb.appendChild(img);
    }
  }

  /* ============================================================
     渲染 · 正在播放
     ============================================================ */
  function renderNowMeta() {
    const t = state.currentTrack;
    const title = t ? (t.title || t.fileName) : '未在播放';
    const artist = t ? (t.artist || '未知艺术家') : '选择一首歌开始';
    el.nowTitle.textContent = title;
    el.nowArtist.textContent = artist;
    el.miniTitle.textContent = title;
    el.miniArtist.textContent = artist;
    document.title = t ? title + ' · MusicWorld' : 'MusicWorld · 本地音乐播放器';
    updateFavButtons();
  }

  function applyCover() {
    const t = state.currentTrack;
    const url = t && t.coverUrl ? t.coverUrl : null;

    if (url) {
      el.nowCoverImg.src = url;
      el.nowCoverImg.classList.add('show');
      el.nowCover.classList.add('has-img');
      el.miniCoverImg.src = url;
      el.miniCoverImg.classList.add('show');
      el.miniCover.classList.add('has-img');
    } else {
      el.nowCoverImg.classList.remove('show');
      el.nowCover.classList.remove('has-img');
      el.nowCoverImg.removeAttribute('src');
      el.miniCoverImg.classList.remove('show');
      el.miniCover.classList.remove('has-img');
      el.miniCoverImg.removeAttribute('src');
    }
  }

  function updateFavButtons() {
    const on = state.currentTrack ? isFavorite(state.currentTrack.key) : false;
    el.btnNowFav.classList.toggle('active', on);
    el.btnFavMini.classList.toggle('on', on);
  }

  /* ============================================================
     渲染 · 歌词
     ============================================================ */
  function renderLyrics(track) {
    state.lyricLines = [];
    state.lyricIndex = -1;
    state.lyricPlain = false;
    el.lyrics.classList.remove('plain-mode');
    el.lyricsInner.style.transform = 'translateY(0)';
    el.lyricsInner.innerHTML = '';

    if (!track) {
      el.lyricsInner.innerHTML = '<div class="lyrics-placeholder">暂无歌词</div>';
      return;
    }

    const data = track._lyrics;
    if (!data || !data.lines || !data.lines.length) {
      const msg = data === undefined
        ? '歌词加载中…'
        : (track.hasLyrics ? '歌词为空' : '暂无歌词<br>把同名 .lrc 文件放进 lyrics 文件夹');
      el.lyricsInner.innerHTML = '<div class="lyrics-placeholder">' + msg + '</div>';
      return;
    }

    state.lyricLines = data.lines;
    state.lyricPlain = !!data.plain;

    const parts = [];
    if (data.plain) {
      el.lyrics.classList.add('plain-mode');
      parts.push('<div class="lyrics-note">纯文本歌词 · 无时间轴</div>');
    }
    data.lines.forEach(function (line, i) {
      if (!line.text) {
        parts.push('<div class="lyric-line blank" data-i="' + i + '"></div>');
      } else {
        parts.push('<div class="lyric-line" data-i="' + i + '" data-t="' + line.time + '">'
          + MW.escapeHtml(line.text) + '</div>');
      }
    });
    el.lyricsInner.innerHTML = parts.join('');

    if (!data.plain) updateLyricLine(el.audio.currentTime || 0, true);
    else el.lyrics.scrollTop = 0;
  }

  function updateLyricLine(time, force) {
    const lines = state.lyricLines;
    if (!lines.length || state.lyricPlain) return;

    // 二分查找当前行
    let lo = 0, hi = lines.length - 1, idx = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (lines[mid].time <= time + 0.2) { idx = mid; lo = mid + 1; }
      else hi = mid - 1;
    }
    if (idx === state.lyricIndex && !force) return;
    state.lyricIndex = idx;

    const children = el.lyricsInner.children;
    for (let i = 0; i < children.length; i++) children[i].classList.remove('current');

    if (idx < 0 || !children[idx]) return;
    const lineEl = children[idx];
    lineEl.classList.add('current');

    const inner = el.lyricsInner;
    const offset = lineEl.offsetTop + lineEl.offsetHeight / 2 - el.lyrics.clientHeight / 2;
    inner.style.transform = 'translateY(' + (-offset) + 'px)';
  }

  el.lyricsInner.addEventListener('click', function (e) {
    if (state.lyricPlain) return;
    const line = e.target.closest('.lyric-line');
    if (!line) return;
    const t = parseFloat(line.dataset.t);
    if (isFinite(t) && t >= 0) {
      try { el.audio.currentTime = t; } catch (err) { /* ignore */ }
      if (el.audio.paused) el.audio.play().catch(function () {});
    }
  });

  /* ============================================================
     渲染 · 播放队列
     ============================================================ */
  function renderQueue() {
    el.queueCount.textContent = state.queue.length;
    if (!state.queue.length) {
      el.queueBody.innerHTML = '<div class="lyrics-placeholder">播放队列是空的</div>';
      return;
    }
    const parts = [];
    state.queue.forEach(function (key, i) {
      const t = state.trackMap.get(key);
      if (!t) return;
      parts.push('<div class="queue-item' + (i === state.index ? ' active' : '') + '" data-i="' + i + '">'
        + '<span class="qi-idx">' + (i + 1) + '</span>'
        + '<span class="qi-name">' + MW.escapeHtml(t.title || t.fileName) + '</span>'
        + '<span class="qi-dur">' + (t.duration ? MW.formatTime(t.duration) : '--:--') + '</span>'
        + '</div>');
    });
    el.queueBody.innerHTML = parts.join('');
  }

  el.queueBody.addEventListener('click', function (e) {
    const item = e.target.closest('.queue-item');
    if (!item) return;
    const i = parseInt(item.dataset.i, 10);
    if (isFinite(i)) playAt(i, true);
    closeQueue();
  });

  function openQueue() {
    renderQueue();
    el.queueDrawer.hidden = false;
    requestAnimationFrame(function () { el.queueDrawer.classList.add('show'); });
  }
  function closeQueue() {
    el.queueDrawer.classList.remove('show');
    setTimeout(function () { el.queueDrawer.hidden = true; }, 200);
  }

  /* ============================================================
     播放核心
     ============================================================ */
  function setQueue(keys, index) {
    state.queue = keys.slice();
    state.index = index;
    resetShufflePool();
    renderQueue();
  }

  function resetShufflePool() {
    const pool = [];
    for (let i = 0; i < state.queue.length; i++) {
      if (i !== state.index) pool.push(i);
    }
    // Fisher-Yates
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const tmp = pool[i]; pool[i] = pool[j]; pool[j] = tmp;
    }
    state.shufflePool = pool;
  }

  function pickShuffleIndex() {
    if (state.queue.length <= 1) return state.index;
    if (!state.shufflePool.length) resetShufflePool();
    return state.shufflePool.shift();
  }

  function playAt(index, autoplay) {
    if (index < 0 || index >= state.queue.length) return;
    state.index = index;
    const track = state.trackMap.get(state.queue[index]);
    if (!track) return;
    playTrack(track, autoplay !== false);
    renderQueue();
  }

  async function playTrack(track, autoplay) {
    const seq = ++loadSeq;

    if (state.currentObjectUrl) {
      try { URL.revokeObjectURL(state.currentObjectUrl); } catch (e) { /* ignore */ }
      state.currentObjectUrl = null;
    }

    state.currentTrack = track;
    renderNowMeta();
    updateRowStates();
    applyCover();
    renderLyrics(track);
    updateFavButtons();

    let url = track.url || null;
    try {
      if (!url && track.handle) {
        const file = await track.handle.getFile();
        if (seq !== loadSeq) return;
        url = URL.createObjectURL(file);
        state.currentObjectUrl = url;
      } else if (!url && track.file) {
        url = URL.createObjectURL(track.file);
        state.currentObjectUrl = url;
      }
      if (!url) throw new Error('no source');
      if (seq !== loadSeq) return;

      el.audio.src = url;
      el.audio.load();
      if (autoplay) {
        const p = el.audio.play();
        if (p && p.catch) p.catch(function () { /* 自动播放被拦截 */ });
      }
    } catch (err) {
      toast('无法播放：' + (track.title || track.fileName));
      return;
    }

    // 异步补齐标签与歌词
    ensureTags(track);
    loadLyricsFor(track);
  }

  async function ensureTags(track) {
    if (track._tagged) return;
    track._tagged = true;
    try {
      let buffer = null;
      if (track.handle) {
        const file = await track.handle.getFile();
        buffer = await MW.readHead(file, 1400000);
      } else if (track.file) {
        buffer = await MW.readHead(track.file, 1400000);
      } else if (track.url) {
        const res = await fetch(track.url, { headers: { Range: 'bytes=0-1399999' } });
        if (res.status === 206) {
          buffer = await res.arrayBuffer();
        } else {
          const len = Number(res.headers.get('content-length') || 0);
          if (len && len < 8000000) buffer = await res.arrayBuffer();
          else return;
        }
      }
      if (!buffer) return;

      let tags = null;
      if (MW.extOf(track.fileName || track.key) === 'mp3') {
        tags = MW.parseId3(buffer);
      }
      if (!tags) return;

      if (tags.title) track.title = tags.title;
      if (tags.artist) track.artist = tags.artist;
      if (tags.album) track.album = tags.album;
      if (tags.picture) track.coverUrl = URL.createObjectURL(tags.picture);

      updateTrackRow(track);
      if (state.currentTrack === track) {
        renderNowMeta();
        applyCover();
        updateListCover();
      }
    } catch (e) { /* 忽略标签解析失败 */ }
  }

  async function loadLyricsFor(track) {
    if (track._lyrics !== undefined) return;
    track._lyrics = null;

    let text = null;
    try {
      if (track.lyricHandle) {
        const file = await track.lyricHandle.getFile();
        text = await file.text();
      } else if (track.lyricFile) {
        text = await track.lyricFile.text();
      } else if (track.lyricsUrl) {
        const res = await fetch(track.lyricsUrl, { cache: 'no-store' });
        if (res.ok) text = await res.text();
      }
    } catch (e) { text = null; }

    track._lyrics = text ? MW.parseLrc(text) : { lines: [], meta: {} };
    if (state.currentTrack === track) renderLyrics(track);
  }

  /* ---------------- 上一首 / 下一首 ---------------- */
  function playNext(auto) {
    if (!state.queue.length) return;

    if (state.mode === 'one') {
      if (auto) { el.audio.currentTime = 0; el.audio.play().catch(function () {}); }
      else advance(1, false);
      return;
    }

    if (state.mode === 'shuffle') {
      const idx = pickShuffleIndex();
      if (idx != null && idx >= 0) playAt(idx, true);
      return;
    }

    const next = state.index + 1;
    if (next >= state.queue.length) {
      if (state.mode === 'order' && auto) {
        el.audio.pause();
        el.audio.currentTime = 0;
        state.index = -1;
        updateRowStates();
        renderQueue();
        return;
      }
      playAt(0, true);
      return;
    }
    playAt(next, true);
  }

  function advance(delta, auto) {
    const next = state.index + delta;
    if (next < 0) playAt(state.queue.length - 1, true);
    else if (next >= state.queue.length) playAt(0, true);
    else playAt(next, true);
  }

  function playPrev() {
    if (!state.queue.length) return;
    if (el.audio.currentTime > 3) {
      el.audio.currentTime = 0;
      return;
    }
    if (state.mode === 'shuffle') {
      const idx = pickShuffleIndex();
      if (idx != null && idx >= 0) playAt(idx, true);
      return;
    }
    advance(-1, false);
  }

  /* ---------------- 播放 / 暂停 ---------------- */
  function togglePlay() {
    if (!state.currentTrack) {
      const tracks = getViewTracks();
      if (!tracks.length) {
        toast(state.tracks.length ? '这个歌单还没有歌曲' : '请先导入音乐文件夹');
        return;
      }
      setQueue(getViewKeys(), 0);
      playAt(0, true);
      return;
    }
    if (el.audio.paused) el.audio.play().catch(function () {});
    else el.audio.pause();
  }

  /* ============================================================
     音频事件
     ============================================================ */
  el.audio.addEventListener('play', function () {
    state.playing = true;
    document.body.classList.add('is-playing');
    updateRowStates();
  });

  el.audio.addEventListener('pause', function () {
    state.playing = false;
    document.body.classList.remove('is-playing');
    updateRowStates();
  });

  el.audio.addEventListener('loadedmetadata', function () {
    const d = el.audio.duration;
    el.durTime.textContent = MW.formatTime(d);
    const t = state.currentTrack;
    if (t && isFinite(d) && d > 0) {
      t.duration = d;
      updateTrackRow(t);
      const item = el.queueBody.querySelector('.queue-item.active .qi-dur');
      if (item) item.textContent = MW.formatTime(d);
    }
  });

  el.audio.addEventListener('timeupdate', function () {
    const dur = el.audio.duration;
    const cur = el.audio.currentTime || 0;
    if (!progressSlider.isDragging()) {
      progressSlider.setVisual(isFinite(dur) && dur > 0 ? cur / dur : 0);
      el.curTime.textContent = MW.formatTime(cur);
    }
    updateLyricLine(cur);
  });

  el.audio.addEventListener('ended', function () { playNext(true); });

  el.audio.addEventListener('error', function () {
    if (!el.audio.src) return;
    toast('播放失败：格式不支持或文件已移动');
  });

  el.audio.addEventListener('volumechange', function () {
    state.volume = el.audio.volume;
    state.muted = el.audio.muted;
    updateVolumeUI();
  });

  /* ============================================================
     滑条
     ============================================================ */
  function createSlider(barEl, fillEl, thumbEl, opts) {
    let dragging = false;

    function setVisual(ratio) {
      const pct = (MW.clamp(ratio, 0, 1) * 100).toFixed(3) + '%';
      fillEl.style.width = pct;
      thumbEl.style.left = pct;
    }
    function ratioFrom(e) {
      const rect = barEl.getBoundingClientRect();
      if (!rect.width) return 0;
      return MW.clamp((e.clientX - rect.left) / rect.width, 0, 1);
    }

    barEl.addEventListener('pointerdown', function (e) {
      dragging = true;
      barEl.classList.add('dragging');
      try { barEl.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      const r = ratioFrom(e);
      setVisual(r);
      if (opts.onPreview) opts.onPreview(r);
    });

    barEl.addEventListener('pointermove', function (e) {
      if (!dragging) return;
      const r = ratioFrom(e);
      setVisual(r);
      if (opts.onPreview) opts.onPreview(r);
    });

    function finish(e) {
      if (!dragging) return;
      dragging = false;
      barEl.classList.remove('dragging');
      const r = ratioFrom(e);
      setVisual(r);
      if (opts.onCommit) opts.onCommit(r);
    }
    barEl.addEventListener('pointerup', finish);
    barEl.addEventListener('pointercancel', function () {
      dragging = false;
      barEl.classList.remove('dragging');
    });

    barEl.addEventListener('keydown', function (e) {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      e.preventDefault();
      const step = e.key === 'ArrowRight' ? 0.04 : -0.04;
      if (opts.onStep) opts.onStep(step);
    });

    return {
      setVisual: setVisual,
      isDragging: function () { return dragging; },
    };
  }

  const progressSlider = createSlider(el.progressBar, el.progressFill, el.progressThumb, {
    onPreview: function (r) {
      const dur = el.audio.duration;
      if (isFinite(dur) && dur > 0) el.curTime.textContent = MW.formatTime(dur * r);
    },
    onCommit: function (r) {
      const dur = el.audio.duration;
      if (isFinite(dur) && dur > 0) {
        el.audio.currentTime = dur * r;
        updateLyricLine(dur * r, true);
      }
    },
    onStep: function (step) {
      const dur = el.audio.duration;
      if (!isFinite(dur) || dur <= 0) return;
      const t = MW.clamp((el.audio.currentTime || 0) + dur * step, 0, dur);
      el.audio.currentTime = t;
      progressSlider.setVisual(t / dur);
    },
  });

  const volumeSlider = createSlider(el.volumeBar, el.volumeFill, el.volumeThumb, {
    onPreview: function (r) {
      el.audio.volume = r;
      if (r > 0 && el.audio.muted) el.audio.muted = false;
    },
    onCommit: function (r) {
      el.audio.volume = r;
      if (r > 0 && el.audio.muted) el.audio.muted = false;
      saveState();
    },
    onStep: function (step) {
      el.audio.volume = MW.clamp(el.audio.volume + step, 0, 1);
      if (el.audio.volume > 0) el.audio.muted = false;
      saveState();
    },
  });

  function updateVolumeUI() {
    const v = el.audio.muted ? 0 : el.audio.volume;
    volumeSlider.setVisual(v);
    el.btnMute.classList.toggle('muted', v === 0);
  }

  /* ============================================================
     播放模式
     ============================================================ */
  function applyMode() {
    el.btnMode.className = 'ctrl mode-' + state.mode;
    el.btnMode.title = '播放模式：' + MODE_LABEL[state.mode];
    el.audio.loop = state.mode === 'one';
    resetShufflePool();
  }

  function cycleMode() {
    const i = MODE_ORDER.indexOf(state.mode);
    state.mode = MODE_ORDER[(i + 1) % MODE_ORDER.length];
    applyMode();
    saveState();
    toast('播放模式：' + MODE_LABEL[state.mode]);
  }

  /* ============================================================
     音乐库加载
     ============================================================ */
  async function loadFromHandle(rootHandle, opts) {
    opts = opts || {};
    try {
      toast('正在扫描音乐文件夹…');
      const result = await MW.scanDirectory(rootHandle);
      state.rootHandle = rootHandle;
      state.source = 'fs';
      applyLibrary(result.tracks);

      MW.handleStore.save('library', rootHandle);
      toast('已加载 ' + result.tracks.length + ' 首歌曲'
        + (result.hasLyrics ? '' : '（未找到 lyrics 文件夹）'));
    } catch (err) {
      console.error(err);
      toast('扫描失败：' + (err && err.message ? err.message : '未知错误'));
    }
  }

  function applyLibrary(tracks) {
    state.tracks = tracks;
    state.trackMap = new Map();
    tracks.forEach(function (t) { state.trackMap.set(t.key, t); });

    // 过滤掉已失效的歌单条目（保留 url 来源时直接清理）
    state.playlists.forEach(function (pl) {
      pl.keys = pl.keys.filter(function (k) { return state.trackMap.has(k); });
    });

    if (state.currentPlaylist !== 'all' && state.currentPlaylist !== 'fav'
      && !state.playlists.some(function (p) { return p.id === state.currentPlaylist; })) {
      state.currentPlaylist = 'all';
    }

    el.btnRestoreLib.hidden = true;
    if (el.autoHint) el.autoHint.hidden = true;
    saveState();
    renderSidebar();
    renderPlaylistView();
  }

  async function pickFolder() {
    // 优先使用 File System Access API（Chrome / Edge）
    if (supportsFSA) {
      try {
        const handle = await window.showDirectoryPicker({ id: 'musicworld', mode: 'read' });
        await loadFromHandle(handle);
        closeSidebar();
        return;
      } catch (err) {
        if (err && err.name === 'AbortError') return; // 用户取消
        // 其他错误（权限被拒等）→ 降级为文件选择器
      }
    }
    // 降级：<input webkitdirectory>，几乎所有浏览器都支持
    if (el.inputDir) { el.inputDir.click(); return; }
    toast('当前浏览器不支持读取文件夹，请改用 Chrome / Edge，或运行 start.bat');
  }

  /* 从 <input type="file"> 的 FileList 建立音乐库 */
  function loadFromFileList(fileList) {
    const files = Array.prototype.slice.call(fileList || []);
    if (!files.length) return;

    const audio = [];
    const lyricMap = new Map();

    files.forEach(function (f) {
      const rel = f.webkitRelativePath || f.name;
      const ext = MW.extOf(f.name);
      if (MW.AUDIO_EXT.indexOf(ext) >= 0) {
        audio.push({ file: f, rel: rel });
      } else if (MW.LYRICS_EXT.indexOf(ext) >= 0) {
        const base = MW.baseName(f.name);
        const k1 = MW.normKey(base);
        const k2 = MW.normKey(MW.stripTrackNo(base));
        if (!lyricMap.has(k1)) lyricMap.set(k1, f);
        if (!lyricMap.has(k2)) lyricMap.set(k2, f);
      }
    });

    if (!audio.length) {
      toast('所选内容中没有音频文件（支持 mp3 / flac / wav / m4a 等）');
      return;
    }

    audio.sort(function (a, b) {
      return a.rel.localeCompare(b.rel, 'zh-CN', { numeric: true, sensitivity: 'base' });
    });

    const seen = new Set();
    const tracks = audio.map(function (item) {
      const base = MW.baseName(item.file.name);
      const meta = MW.guessMeta(base);
      const lyricFile = lyricMap.get(MW.normKey(base)) || lyricMap.get(MW.normKey(MW.stripTrackNo(base))) || null;

      let key = 'local:' + item.rel;
      if (seen.has(key)) key = key + '#' + Math.random().toString(36).slice(2, 6);
      seen.add(key);

      return {
        key: key,
        fileName: item.file.name,
        title: meta.title,
        artist: meta.artist,
        album: '',
        ext: MW.extOf(item.file.name),
        file: item.file,
        lyricFile: lyricFile,
        hasLyrics: !!lyricFile,
        duration: 0,
        coverUrl: null,
        _tagged: false,
      };
    });

    state.rootHandle = null;
    state.source = 'files';
    applyLibrary(tracks);
    toast('已导入 ' + tracks.length + ' 首歌曲'
      + (tracks.some(function (t) { return t.hasLyrics; }) ? '' : '（未找到匹配的歌词）'));
  }

  async function restoreLibrary() {
    const handle = await MW.handleStore.load('library');
    if (!handle) { toast('没有可恢复的音乐库'); el.btnRestoreLib.hidden = true; return; }
    try {
      let perm = 'prompt';
      if (handle.requestPermission) perm = await handle.requestPermission({ mode: 'read' });
      if (perm !== 'granted') { toast('未获得访问权限'); return; }
      await loadFromHandle(handle);
    } catch (err) {
      toast('恢复失败：' + (err && err.message ? err.message : '未知错误'));
    }
  }

  async function rescan() {
    if (state.rootHandle) { loadFromHandle(state.rootHandle); return; }
    if (state.source === 'manifest') { await tryManifest(true); return; }
    if (state.source === 'server') { await tryAutoScan(true); return; }
    toast('当前音乐库来自本地文件，请重新导入');
  }

  async function tryManifest(manual) {
    try {
      const result = await MW.loadManifest('manifest.json');
      if (!result.tracks.length) throw new Error('清单为空');
      state.source = 'manifest';
      applyLibrary(result.tracks);
      if (manual) toast('已重新载入清单，共 ' + result.tracks.length + ' 首');
      return true;
    } catch (err) {
      if (manual) toast('读取 manifest.json 失败：' + err.message);
      return false;
    }
  }

  /* ---------------- 自动扫描服务器上的 music / lyrics 目录 ---------------- */
  let autoScanError = null;

  async function tryAutoScan(manual) {
    const rootUrl = new URL('./', location.href).href;
    try {
      const result = await MW.scanServerLibrary(rootUrl);
      if (!result.tracks.length) {
        autoScanError = 'empty';
        throw new Error('目录里没有音频文件');
      }
      state.source = 'server';
      applyLibrary(result.tracks);
      autoScanError = null;
      toast('已从服务器扫描到 ' + result.tracks.length + ' 首歌曲'
        + (result.hasLyricsDir ? '' : '（未找到 lyrics 目录）'));
      return true;
    } catch (err) {
      autoScanError = autoScanError || (err && err.status ? String(err.status) : 'unknown');
      if (manual) toast('自动扫描失败：' + (err && err.message ? err.message : '未知错误'));
      return false;
    }
  }

  function showAutoHint() {
    if (!el.autoHint) return;
    const isServer = location.protocol !== 'file:';
    if (!isServer) { el.autoHint.hidden = true; return; }

    let reason = '未能自动读取服务器上的 <code>music</code> 文件夹。';
    if (autoScanError === '403') reason = '服务器拒绝列出 <code>music</code> 目录（HTTP 403）。';
    else if (autoScanError === '404') reason = '服务器上找不到 <code>music</code> 目录（HTTP 404）。';
    else if (autoScanError === 'empty') reason = '<code>music</code> 目录里还没有音频文件。';

    el.autoHint.innerHTML =
      '<div class="hint-title">' + reason + '</div>'
      + '<ol class="hint-list">'
      + '<li><b>启用目录浏览</b>：IIS 管理器中选中 <code>music</code> 与 <code>lyrics</code> 文件夹 → 打开「目录浏览」→ 右侧点「启用」；'
      + '然后刷新本页即可自动读取。</li>'
      + '<li><b>或者使用清单</b>：在服务器上运行 <code>python tools/scan.py</code> 生成 <code>manifest.json</code>，刷新后会自动加载，无需开启目录浏览。</li>'
      + '</ol>';
    el.autoHint.hidden = false;
  }

  /* ============================================================
     歌单交互
     ============================================================ */
  function selectPlaylist(id) {
    state.currentPlaylist = id;
    state.search = '';
    el.searchInput.value = '';
    el.searchBox.classList.remove('has-value');
    saveState();
    renderSidebar();
    renderPlaylistView();
    closeSidebar();
  }

  function openPrompt(options) {
    return new Promise(function (resolve) {
      promptResolve = resolve;
      el.promptTitle.textContent = options.title || '新建歌单';
      el.promptInput.value = options.value || '';
      el.promptInput.placeholder = options.placeholder || '歌单名称';
      el.promptError.textContent = '';
      showSheet(el.promptSheet);
      setTimeout(function () { el.promptInput.focus(); }, 120);
    });
  }

  function closePrompt(value) {
    hideSheet(el.promptSheet);
    if (promptResolve) {
      const r = promptResolve;
      promptResolve = null;
      r(value);
    }
  }

  function confirmPrompt() {
    const name = el.promptInput.value.trim();
    if (!name) { el.promptError.textContent = '请输入歌单名称'; return; }
    const dup = state.playlists.some(function (p) { return p.name === name; });
    if (dup) { el.promptError.textContent = '已存在同名歌单'; return; }
    closePrompt(name);
  }

  el.promptOk.addEventListener('click', confirmPrompt);
  el.promptCancel.addEventListener('click', function () { closePrompt(null); });
  el.promptInput.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { e.preventDefault(); confirmPrompt(); }
    if (e.key === 'Escape') closePrompt(null);
  });

  async function newPlaylist(andAddKey) {
    const name = await openPrompt({ title: '新建歌单', placeholder: '例如：深夜单曲' });
    if (!name) return;
    const pl = createPlaylist(name);
    if (andAddKey) {
      addKeyToPlaylist(pl.id, andAddKey);
      saveState();
      renderSidebar();
      renderAddSheetBody();
      toast('已新建歌单「' + name + '」并加入');
    } else {
      toast('已新建歌单「' + name + '」');
    }
  }

  /* ---------------- 加入歌单面板 ---------------- */
  function openAddSheet(key) {
    addSheetTargetKey = key;
    renderAddSheetBody();
    showSheet(el.addSheet);
  }

  function renderAddSheetBody() {
    const key = addSheetTargetKey;
    const items = [];

    items.push('<button class="sheet-item' + (isFavorite(key) ? ' in-list' : '') + '" data-pl="fav">'
      + '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8l8.9 8.9 8.9-8.9a5.5 5.5 0 0 0 0-7.8z"/></svg>'
      + '<span class="si-name">我喜欢</span>'
      + '<svg class="si-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>'
      + '</button>');

    if (!state.playlists.length) {
      items.push('<div class="lyrics-placeholder">还没有自建歌单</div>');
    } else {
      state.playlists.forEach(function (pl) {
        const inList = pl.keys.indexOf(key) >= 0;
        items.push('<button class="sheet-item' + (inList ? ' in-list' : '') + '" data-pl="' + MW.escapeHtml(pl.id) + '">'
          + '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 6h11M4 12h11M4 18h7"/><path d="M18 9v8"/><circle cx="16.4" cy="18" r="1.9"/></svg>'
          + '<span class="si-name">' + MW.escapeHtml(pl.name) + '</span>'
          + '<span class="si-count">' + pl.keys.length + '</span>'
          + '<svg class="si-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>'
          + '</button>');
      });
    }
    el.addSheetBody.innerHTML = items.join('');
  }

  el.addSheetBody.addEventListener('click', function (e) {
    const item = e.target.closest('.sheet-item');
    if (!item || !addSheetTargetKey) return;
    const plId = item.dataset.pl;
    const added = addKeyToPlaylist(plId, addSheetTargetKey);
    if (added) {
      toast(plId === 'fav' ? '已加入「我喜欢」' : '已加入歌单');
      renderAddSheetBody();
      renderSidebar();
      updateRowStates();
      updateFavButtons();
      if (state.currentPlaylist === plId) renderTrackList();
    } else {
      toast('这首歌已经在该歌单中了');
    }
  });

  el.btnSheetNewPlaylist.addEventListener('click', function () {
    newPlaylist(addSheetTargetKey);
  });

  /* ============================================================
     弹层通用
     ============================================================ */
  function showSheet(node) {
    syncOverlay();
    node.hidden = false;
    requestAnimationFrame(function () { node.classList.add('show'); });
  }

  function hideSheet(node) {
    node.classList.remove('show');
    setTimeout(function () { node.hidden = true; }, 200);
    syncOverlay();
  }

  function isSheetVisible(node) {
    return !node.hidden && node.classList.contains('show');
  }

  function anyPanelOpen() {
    return isSheetVisible(el.addSheet)
      || isSheetVisible(el.promptSheet)
      || el.sidebar.classList.contains('open')
      || el.nowPanel.classList.contains('open');
  }

  function syncOverlay() {
    if (anyPanelOpen()) {
      el.overlay.hidden = false;
      requestAnimationFrame(function () { el.overlay.classList.add('show'); });
    } else {
      el.overlay.classList.remove('show');
      setTimeout(function () {
        if (!anyPanelOpen()) el.overlay.hidden = true;
      }, 230);
    }
  }

  el.overlay.addEventListener('click', function () {
    if (!el.addSheet.hidden) hideSheet(el.addSheet);
    if (!el.promptSheet.hidden) closePrompt(null);
    if (el.queueDrawer.classList.contains('show')) closeQueue();
    closeSidebar();
    closeNowPanel();
  });

  document.querySelectorAll('[data-close-sheet]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      const sheet = btn.closest('.sheet');
      if (sheet === el.promptSheet) closePrompt(null);
      else if (sheet) hideSheet(sheet);
    });
  });

  /* ============================================================
     响应式面板
     ============================================================ */
  function openSidebar() {
    el.sidebar.classList.add('open');
    syncOverlay();
  }
  function closeSidebar() {
    if (!el.sidebar.classList.contains('open')) return;
    el.sidebar.classList.remove('open');
    syncOverlay();
  }
  function openNowPanel() {
    el.nowPanel.classList.add('open');
    syncOverlay();
  }
  function closeNowPanel() {
    if (!el.nowPanel.classList.contains('open')) return;
    el.nowPanel.classList.remove('open');
    syncOverlay();
  }

  /* ============================================================
     事件绑定
     ============================================================ */
  el.btnTheme.addEventListener('click', toggleTheme);
  el.btnLoadFolderTop.addEventListener('click', pickFolder);
  el.btnEmptyLoad.addEventListener('click', pickFolder);
  el.btnEmptyFiles.addEventListener('click', function () {
    if (el.inputFiles) { el.inputFiles.click(); return; }
    toast('当前浏览器不支持文件选择');
  });
  el.btnRestoreLib.addEventListener('click', restoreLibrary);
  el.btnRescan.addEventListener('click', rescan);
  el.btnOpenSidebar.addEventListener('click', openSidebar);
  el.btnCloseNow.addEventListener('click', closeNowPanel);
  el.btnOpenNow.addEventListener('click', openNowPanel);

  el.inputDir.addEventListener('change', function () {
    if (this.files && this.files.length) loadFromFileList(this.files);
    closeSidebar();
    this.value = '';
  });
  el.inputFiles.addEventListener('change', function () {
    if (this.files && this.files.length) loadFromFileList(this.files);
    closeSidebar();
    this.value = '';
  });

  el.navBuiltin.addEventListener('click', function (e) {
    const item = e.target.closest('[data-playlist]');
    if (item) selectPlaylist(item.dataset.playlist);
  });
  el.navPlaylists.addEventListener('click', function (e) {
    const item = e.target.closest('[data-playlist]');
    if (item) selectPlaylist(item.dataset.playlist);
  });

  el.btnNewPlaylist.addEventListener('click', function () { newPlaylist(null); });

  el.searchInput.addEventListener('input', function () {
    state.search = el.searchInput.value;
    el.searchBox.classList.toggle('has-value', !!state.search);
    renderPlaylistView();
  });
  el.searchInput.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      el.searchInput.value = '';
      state.search = '';
      el.searchBox.classList.remove('has-value');
      renderPlaylistView();
      el.searchInput.blur();
    }
  });
  el.btnClearSearch.addEventListener('click', function () {
    el.searchInput.value = '';
    state.search = '';
    el.searchBox.classList.remove('has-value');
    renderPlaylistView();
    el.searchInput.focus();
  });

  el.btnPlayAll.addEventListener('click', function () {
    const keys = getViewKeys();
    if (!keys.length) { toast('没有可播放的歌曲'); return; }
    setQueue(keys, 0);
    playAt(0, true);
  });

  el.btnShuffleAll.addEventListener('click', function () {
    const keys = getViewKeys();
    if (!keys.length) { toast('没有可播放的歌曲'); return; }
    state.mode = 'shuffle';
    applyMode();
    saveState();
    const start = Math.floor(Math.random() * keys.length);
    setQueue(keys, start);
    playAt(start, true);
    toast('随机播放已开启');
  });

  el.btnRenamePlaylist.addEventListener('click', async function () {
    const pl = state.playlists.find(function (p) { return p.id === state.currentPlaylist; });
    if (!pl) return;
    const name = await openPrompt({ title: '重命名歌单', value: pl.name });
    if (!name) return;
    pl.name = name;
    saveState();
    renderSidebar();
    renderPlaylistView();
    toast('已重命名');
  });

  el.btnDeletePlaylist.addEventListener('click', function () {
    const pl = state.playlists.find(function (p) { return p.id === state.currentPlaylist; });
    if (!pl) return;
    if (!window.confirm('确定删除歌单「' + pl.name + '」吗？歌曲文件不会被删除。')) return;
    state.playlists = state.playlists.filter(function (p) { return p.id !== pl.id; });
    state.currentPlaylist = 'all';
    saveState();
    renderSidebar();
    renderPlaylistView();
    toast('已删除歌单');
  });

  el.trackList.addEventListener('click', function (e) {
    const row = e.target.closest('.track-row');
    if (!row) return;
    const key = row.dataset.key;

    const opBtn = e.target.closest('[data-op]');
    if (opBtn) {
      e.stopPropagation();
      if (opBtn.dataset.op === 'fav') toggleFavorite(key);
      else if (opBtn.dataset.op === 'add') openAddSheet(key);
      return;
    }
    playFromView(key);
  });

  function playFromView(key) {
    const keys = getViewKeys();
    const idx = keys.indexOf(key);
    if (idx < 0) return;
    const same = state.queue.length === keys.length && state.queue.every(function (k, i) { return k === keys[i]; });
    if (!same) {
      setQueue(keys, idx);
    } else {
      state.index = idx;
    }
    playAt(idx, true);
  }

  el.btnPlay.addEventListener('click', togglePlay);
  el.btnNext.addEventListener('click', function () { playNext(false); });
  el.btnPrev.addEventListener('click', playPrev);
  el.btnMode.addEventListener('click', cycleMode);
  el.btnQueue.addEventListener('click', function () {
    if (el.queueDrawer.classList.contains('show')) closeQueue();
    else openQueue();
  });
  el.btnCloseQueue.addEventListener('click', closeQueue);

  el.btnMute.addEventListener('click', function () {
    el.audio.muted = !el.audio.muted;
    if (!el.audio.muted && el.audio.volume === 0) el.audio.volume = 0.5;
    saveState();
  });

  el.btnNowFav.addEventListener('click', function () {
    if (state.currentTrack) toggleFavorite(state.currentTrack.key);
    else toast('还没有播放歌曲');
  });
  el.btnFavMini.addEventListener('click', function () {
    if (state.currentTrack) toggleFavorite(state.currentTrack.key);
    else toast('还没有播放歌曲');
  });
  el.btnNowAddToList.addEventListener('click', function () {
    if (!state.currentTrack) { toast('还没有播放歌曲'); return; }
    openAddSheet(state.currentTrack.key);
  });

  el.miniCover.addEventListener('click', openNowPanel);
  el.pbInfo.addEventListener('dblclick', openNowPanel);

  /* ---------------- 键盘快捷键 ---------------- */
  document.addEventListener('keydown', function (e) {
    const tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || e.target.isContentEditable) return;
    if (e.ctrlKey || e.metaKey || e.altKey) {
      if (e.ctrlKey && e.key === 'ArrowRight') { e.preventDefault(); playNext(false); }
      if (e.ctrlKey && e.key === 'ArrowLeft') { e.preventDefault(); playPrev(); }
      return;
    }

    switch (e.key) {
      case ' ':
        e.preventDefault();
        togglePlay();
        break;
      case 'ArrowRight':
        e.preventDefault();
        seekRelative(5);
        break;
      case 'ArrowLeft':
        e.preventDefault();
        seekRelative(-5);
        break;
      case 'ArrowUp':
        e.preventDefault();
        el.audio.volume = MW.clamp(el.audio.volume + 0.05, 0, 1);
        if (el.audio.volume > 0) el.audio.muted = false;
        saveState();
        break;
      case 'ArrowDown':
        e.preventDefault();
        el.audio.volume = MW.clamp(el.audio.volume - 0.05, 0, 1);
        saveState();
        break;
      case 'm':
      case 'M':
        el.btnMute.click();
        break;
      default:
        break;
    }
  });

  function seekRelative(delta) {
    const d = el.audio.duration;
    if (!isFinite(d) || d <= 0) return;
    el.audio.currentTime = MW.clamp((el.audio.currentTime || 0) + delta, 0, d);
  }

  /* ============================================================
     初始化
     ============================================================ */
  async function init() {
    applyTheme();

    el.audio.volume = MW.clamp(state.volume, 0, 1);
    el.audio.muted = state.muted;
    updateVolumeUI();

    applyMode();
    renderSidebar();
    renderPlaylistView();
    renderNowMeta();
    renderQueue();

    if (!supportsFSA && el.btnLoadFolderTop) {
      el.btnLoadFolderTop.title = '将使用文件选择方式导入（当前浏览器不支持文件夹授权）';
    }

    // 1) 尝试恢复上次的音乐库
    if (supportsFSA) {
      const handle = await MW.handleStore.load('library');
      if (handle) {
        let perm = 'prompt';
        try { perm = await handle.queryPermission({ mode: 'read' }); } catch (e) { perm = 'prompt'; }
        if (perm === 'granted') {
          await loadFromHandle(handle);
          return;
        }
        el.btnRestoreLib.hidden = false;
      }
    }

    // 2) HTTP 环境：先读清单，再自动扫描服务器目录
    if (location.protocol !== 'file:') {
      if (await tryManifest(false)) return;
      if (await tryAutoScan(false)) return;
      showAutoHint();
    }
  }

  init();

})();
