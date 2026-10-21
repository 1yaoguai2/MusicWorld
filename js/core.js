/* ============================================================
   MusicWorld · core.js
   基础工具 / 存储 / LRC 解析 / ID3 解析 / 文件扫描
   ============================================================ */
(function (global) {
  'use strict';

  const MW = global.MW = global.MW || {};

  /* ---------------- 常量 ---------------- */

  MW.AUDIO_EXT = ['mp3', 'flac', 'wav', 'ogg', 'oga', 'm4a', 'aac', 'opus', 'wma', 'aiff', 'aif', 'ape', 'mp4'];
  MW.LYRICS_EXT = ['lrc', 'txt'];

  const MUSIC_DIR_NAMES = ['music', 'musics', 'audio', 'songs', '音乐', '歌曲'];
  const LYRICS_DIR_NAMES = ['lyrics', 'lyric', 'lrc', '歌词'];

  /* ---------------- 工具函数 ---------------- */

  MW.extOf = function (name) {
    const i = name.lastIndexOf('.');
    return i < 0 ? '' : name.slice(i + 1).toLowerCase();
  };

  MW.baseName = function (name) {
    const i = name.lastIndexOf('.');
    return i < 0 ? name : name.slice(0, i);
  };

  MW.formatTime = function (sec) {
    if (!isFinite(sec) || sec < 0) sec = 0;
    const total = Math.floor(sec);
    const m = Math.floor(total / 60);
    const s = total % 60;
    return m + ':' + String(s).padStart(2, '0');
  };

  MW.escapeHtml = function (s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  };

  MW.clamp = function (v, min, max) { return v < min ? min : v > max ? max : v; };

  /* 归一化用于匹配的字符串：小写、去空格与常见分隔符 */
  MW.normKey = function (s) {
    return String(s || '')
      .toLowerCase()
      .replace(/\s+/g, '')
      .replace(/[_\-–—·.,，、'"“”()（）\[\]]/g, '');
  };

  /* 去掉开头的音轨序号，如 "01 - xxx" / "01.xxx" / "01 xxx" */
  MW.stripTrackNo = function (s) {
    return String(s || '').replace(/^\s*\d{1,3}\s*[.\-_、)]?\s*/, '').trim();
  };

  /* 从文件名推断 歌名 / 歌手 */
  MW.guessMeta = function (base) {
    let s = MW.stripTrackNo(base);
    const parts = s.split(/\s+[-–—]\s+/);
    if (parts.length >= 2) {
      return { artist: parts[0].trim(), title: parts.slice(1).join(' - ').trim() };
    }
    // 兼容 "歌手《歌名》" 这类
    const m = s.match(/^(.+?)[《【](.+?)[》】]$/);
    if (m) return { artist: m[1].trim(), title: m[2].trim() };
    return { artist: '', title: s || base };
  };

  /* 依据字符串生成稳定的色相，用于无封面时的渐变底色 */
  MW.hashHue = function (str) {
    let h = 0;
    for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) % 360;
    return h;
  };

  MW.gradientFor = function (str) {
    const h = MW.hashHue(str);
    return 'linear-gradient(140deg, hsl(' + h + ' 68% 58%), hsl(' + ((h + 48) % 360) + ' 72% 46%))';
  };

  /* ---------------- 本地存储 ---------------- */

  const STORE_KEY = 'musicworld.state.v1';
  const DEFAULTS = {
    theme: 'dark',
    volume: 0.8,
    muted: false,
    mode: 'list',
    playlists: [],       // [{ id, name, keys: [] }]
    favorites: [],       // [key]
    currentPlaylist: 'all',
    lastKey: null,
  };

  MW.store = {
    read: function () {
      try {
        const raw = localStorage.getItem(STORE_KEY);
        if (!raw) return Object.assign({}, DEFAULTS);
        const data = JSON.parse(raw);
        return Object.assign({}, DEFAULTS, data, {
          playlists: Array.isArray(data.playlists) ? data.playlists : [],
          favorites: Array.isArray(data.favorites) ? data.favorites : [],
        });
      } catch (e) {
        return Object.assign({}, DEFAULTS);
      }
    },
    write: function (data) {
      try {
        const slim = {
          theme: data.theme,
          volume: data.volume,
          muted: data.muted,
          mode: data.mode,
          playlists: data.playlists,
          favorites: data.favorites,
          currentPlaylist: data.currentPlaylist,
          lastKey: data.lastKey,
        };
        localStorage.setItem(STORE_KEY, JSON.stringify(slim));
      } catch (e) { /* 忽略配额错误 */ }
    },
  };

  /* ---------------- 目录句柄持久化（IndexedDB） ---------------- */

  const DB_NAME = 'musicworld.db';
  const DB_STORE = 'handles';

  function openDB() {
    return new Promise(function (resolve, reject) {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = function () {
        if (!req.result.objectStoreNames.contains(DB_STORE)) {
          req.result.createObjectStore(DB_STORE);
        }
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
  }

  MW.handleStore = {
    save: async function (key, handle) {
      try {
        const db = await openDB();
        await new Promise(function (resolve, reject) {
          const tx = db.transaction(DB_STORE, 'readwrite');
          tx.objectStore(DB_STORE).put(handle, key);
          tx.oncomplete = resolve;
          tx.onerror = function () { reject(tx.error); };
        });
        db.close();
      } catch (e) { /* 静默失败 */ }
    },
    load: async function (key) {
      try {
        const db = await openDB();
        const value = await new Promise(function (resolve, reject) {
          const tx = db.transaction(DB_STORE, 'readonly');
          const req = tx.objectStore(DB_STORE).get(key);
          req.onsuccess = function () { resolve(req.result || null); };
          req.onerror = function () { reject(req.error); };
        });
        db.close();
        return value;
      } catch (e) { return null; }
    },
    clear: async function (key) {
      try {
        const db = await openDB();
        await new Promise(function (resolve) {
          const tx = db.transaction(DB_STORE, 'readwrite');
          tx.objectStore(DB_STORE).delete(key);
          tx.oncomplete = resolve;
          tx.onerror = resolve;
        });
        db.close();
      } catch (e) { /* ignore */ }
    },
  };

  /* ---------------- 歌词解析 ---------------- */

  /**
   * 解析 LRC 文本
   * 支持：[mm:ss.xx] [mm:ss:xx] 一行多标签、[ti:]/[ar:] 元信息、
   *       增强格式 <mm:ss.xx> 会被忽略
   * @returns {{ lines: {time:number,text:string}[], meta: object }}
   */
  MW.parseLrc = function (text) {
    const meta = {};
    const lines = [];
    if (!text) return { lines: lines, meta: meta };

    // 去掉 BOM
    const src = String(text).replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
    const timeTag = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;
    const metaTag = /^\[(ti|ar|al|by|offset):(.*)\]$/i;

    src.split('\n').forEach(function (raw) {
      const line = raw.trim();
      if (!line) return;

      const m = line.match(metaTag);
      if (m) { meta[m[1].toLowerCase()] = m[2].trim(); return; }

      const stamps = [];
      let match;
      timeTag.lastIndex = 0;
      while ((match = timeTag.exec(line)) !== null) {
        const min = parseInt(match[1], 10);
        const sec = parseInt(match[2], 10);
        let frac = 0;
        if (match[3] != null) {
          frac = match[3].length === 1 ? parseInt(match[3], 10) / 10
            : match[3].length === 2 ? parseInt(match[3], 10) / 100
              : parseInt(match[3], 10) / 1000;
        }
        stamps.push(min * 60 + sec + frac);
      }
      if (!stamps.length) return;

      // 去掉时间标签与增强标签，得到正文
      let content = line.replace(timeTag, '').replace(/<\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?>/g, '').trim();
      content = content.replace(/&nbsp;/g, ' ');

      stamps.forEach(function (t) {
        lines.push({ time: t, text: content });
      });
    });

    lines.sort(function (a, b) { return a.time - b.time; });

    // 去掉连续重复的同一时间点
    const dedup = [];
    for (let i = 0; i < lines.length; i++) {
      const prev = dedup[dedup.length - 1];
      if (prev && Math.abs(prev.time - lines[i].time) < 0.02 && prev.text === lines[i].text) continue;
      dedup.push(lines[i]);
    }

    if (dedup.length) return { lines: dedup, meta: meta, plain: false };

    // 没有时间标签 → 当作纯文本歌词
    const plainLines = [];
    src.split('\n').forEach(function (raw) {
      const t = raw.trim();
      if (t) plainLines.push({ time: -1, text: t });
    });
    return { lines: plainLines, meta: meta, plain: plainLines.length > 0 };
  };

  /* ---------------- ID3 解析（封面 + 标题 + 歌手） ---------------- */

  function syncSafe(view, o) {
    return ((view.getUint8(o) & 0x7f) * 0x200000)
      + ((view.getUint8(o + 1) & 0x7f) << 14)
      + ((view.getUint8(o + 2) & 0x7f) << 7)
      + (view.getUint8(o + 3) & 0x7f);
  }

  function u32(view, o) {
    return ((view.getUint8(o) << 24) >>> 0)
      + (view.getUint8(o + 1) << 16)
      + (view.getUint8(o + 2) << 8)
      + view.getUint8(o + 3);
  }

  function u24(view, o) {
    return (view.getUint8(o) << 16) + (view.getUint8(o + 1) << 8) + view.getUint8(o + 2);
  }

  function decodeText(bytes, start, end, enc) {
    if (end <= start) return '';
    const slice = bytes.subarray(start, end);
    let out = '';
    try {
      if (enc === 0) {
        out = new TextDecoder('iso-8859-1').decode(slice);
      } else if (enc === 1) {
        if (slice[0] === 0xff && slice[1] === 0xfe) out = new TextDecoder('utf-16le').decode(slice.subarray(2));
        else if (slice[0] === 0xfe && slice[1] === 0xff) out = new TextDecoder('utf-16be').decode(slice.subarray(2));
        else out = new TextDecoder('utf-16le').decode(slice);
      } else if (enc === 2) {
        out = new TextDecoder('utf-16be').decode(slice);
      } else {
        out = new TextDecoder('utf-8').decode(slice);
      }
    } catch (e) {
      try { out = new TextDecoder('utf-8').decode(slice); } catch (e2) { out = ''; }
    }
    return out.replace(/\u0000+$/g, '').trim();
  }

  /**
   * 从音频文件头部 Buffer 中解析 ID3v2 标签
   * @param {ArrayBuffer} buffer
   * @returns {{title:string, artist:string, album:string, picture:Blob|null}|null}
   */
  MW.parseId3 = function (buffer) {
    try {
      if (!buffer || buffer.byteLength < 12) return null;
      const bytes = new Uint8Array(buffer);
      if (!(bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33)) return null; // "ID3"

      const view = new DataView(buffer);
      const ver = bytes[3];
      if (ver < 3 || ver > 4) return null;

      const flags = bytes[5];
      let size = syncSafe(view, 6);
      let offset = 10;
      if (flags & 0x40) { // 扩展头
        const extSize = ver === 4 ? syncSafe(view, 10) : u32(view, 10);
        offset += extSize + (ver === 4 ? 0 : 4);
      }
      const end = Math.min(offset + size, bytes.length);

      const result = { title: '', artist: '', album: '', picture: null };

      while (offset + 10 <= end) {
        const id = String.fromCharCode(bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3]);
        if (!/^[A-Z0-9]{4}$/.test(id)) break;

        const frameSize = ver === 4 ? syncSafe(view, offset + 4) : u32(view, offset + 4);
        const fFlags = (bytes[offset + 8] << 8) | bytes[offset + 9];
        const dataStart = offset + 10;
        const dataEnd = Math.min(dataStart + frameSize, bytes.length);

        if (frameSize <= 0 || dataEnd <= dataStart) break;

        // v2.3 的压缩(0x0080)/加密(0x0040)、v2.4 的压缩(0x0008)/加密(0x0004) 直接跳过
        const compressed = ver === 3 ? (fFlags & 0x0080) !== 0 : (fFlags & 0x0008) !== 0;
        const encrypted = ver === 3 ? (fFlags & 0x0040) !== 0 : (fFlags & 0x0004) !== 0;

        if (!compressed && !encrypted) {
          if (id === 'TIT2') result.title = decodeText(bytes, dataStart + 1, dataEnd, bytes[dataStart]);
          else if (id === 'TPE1') result.artist = decodeText(bytes, dataStart + 1, dataEnd, bytes[dataStart]);
          else if (id === 'TALB') result.album = decodeText(bytes, dataStart + 1, dataEnd, bytes[dataStart]);
          else if (id === 'APIC' && !result.picture) {
            const enc = bytes[dataStart];
            let p = dataStart + 1;
            // MIME 类型（latin1，以 \0 结束）
            const mimeStart = p;
            while (p < dataEnd && bytes[p] !== 0) p++;
            const mime = decodeText(bytes, mimeStart, p, 0) || 'image/jpeg';
            p++; // 跳过 \0
            p++; // 图片类型
            // 描述（按编码判断结束位置）
            if (enc === 1 || enc === 2) {
              while (p + 1 < dataEnd && !(bytes[p] === 0 && bytes[p + 1] === 0)) p += 2;
              p += 2;
            } else {
              while (p < dataEnd && bytes[p] !== 0) p++;
              p += 1;
            }
            if (p < dataEnd) {
              const blob = new Blob([bytes.subarray(p, dataEnd)], { type: mime });
              if (blob.size > 64) result.picture = blob;
            }
          }
        }

        offset = dataStart + frameSize;
      }

      if (!result.title && !result.artist && !result.picture) return null;
      return result;
    } catch (e) {
      return null;
    }
  };

  /* 读取音频文件头部若干字节用于解析标签 */
  MW.readHead = async function (file, bytes) {
    const slice = file.slice(0, Math.min(file.size || bytes, bytes));
    if (slice.arrayBuffer) return slice.arrayBuffer();
    return new Promise(function (resolve, reject) {
      const reader = new FileReader();
      reader.onload = function () { resolve(reader.result); };
      reader.onerror = function () { reject(reader.error); };
      reader.readAsArrayBuffer(slice);
    });
  };

  /* ---------------- 目录扫描 ---------------- */

  function isAudio(name) { return MW.AUDIO_EXT.indexOf(MW.extOf(name)) >= 0; }
  function isLyrics(name) { return MW.LYRICS_EXT.indexOf(MW.extOf(name)) >= 0; }

  async function walkFiles(dirHandle, options, sink, prefix, depth) {
    if (depth > options.maxDepth) return;
    const entries = [];
    for await (const entry of dirHandle.values()) entries.push(entry);

    // 先文件后目录，并按名称自然排序
    entries.sort(function (a, b) {
      if (a.kind !== b.kind) return a.kind === 'file' ? -1 : 1;
      return a.name.localeCompare(b.name, 'zh-CN', { numeric: true, sensitivity: 'base' });
    });

    for (const entry of entries) {
      if (entry.kind === 'file') {
        if (options.accept(entry.name)) sink({ handle: entry, rel: prefix + entry.name });
      } else if (entry.kind === 'directory') {
        if (entry.name.startsWith('.')) continue;
        await walkFiles(entry, options, sink, prefix + entry.name + '/', depth + 1);
      }
    }
  }

  /**
   * 扫描音乐库根目录
   * 结构约定：<root>/music/*.mp3, <root>/lyrics/*.lrc
   * 若根目录下没有 music 子目录，则把根目录本身当作音乐目录，
   * 并在根目录（或同级 lyrics）中寻找歌词。
   */
  MW.scanDirectory = async function (rootHandle) {
    const dirs = [];
    for await (const entry of rootHandle.values()) {
      if (entry.kind === 'directory') dirs.push(entry);
    }
    function findDir(names) {
      for (const d of dirs) {
        if (names.indexOf(d.name.toLowerCase()) >= 0) return d;
      }
      return null;
    }

    const musicRoot = findDir(MUSIC_DIR_NAMES) || rootHandle;
    const lyricsRoot = findDir(LYRICS_DIR_NAMES) || (musicRoot === rootHandle ? rootHandle : null);

    // 收集音频
    const audioItems = [];
    await walkFiles(musicRoot, {
      maxDepth: 6,
      accept: isAudio,
    }, function (item) { audioItems.push(item); }, '', 0);

    // 收集歌词，建立索引
    const lyricIndex = new Map();
    if (lyricsRoot) {
      await walkFiles(lyricsRoot, {
        maxDepth: 6,
        accept: isLyrics,
      }, function (item) {
        const base = MW.baseName(item.handle.name);
        const full = MW.normKey(base);
        const loose = MW.normKey(MW.stripTrackNo(base));
        if (!lyricIndex.has(full)) lyricIndex.set(full, item.handle);
        if (loose !== full && !lyricIndex.has(loose)) lyricIndex.set(loose, item.handle);
      }, '', 0);
    }

    // 组装 tracks
    const tracks = [];
    const seen = new Set();
    for (const item of audioItems) {
      const fileName = item.handle.name;
      const base = MW.baseName(fileName);
      const full = MW.normKey(base);
      const loose = MW.normKey(MW.stripTrackNo(base));
      const lyric = lyricIndex.get(full) || lyricIndex.get(loose) || null;
      const meta = MW.guessMeta(base);

      let key = item.rel;
      if (seen.has(key)) key = key + '#' + tracks.length;
      seen.add(key);

      tracks.push({
        key: key,
        fileName: fileName,
        title: meta.title,
        artist: meta.artist,
        album: '',
        ext: MW.extOf(fileName),
        handle: item.handle,
        lyricHandle: lyric,
        hasLyrics: !!lyric,
        duration: 0,
        coverUrl: null,
        _tagged: false,
      });
    }

    tracks.sort(function (a, b) {
      return a.key.localeCompare(b.key, 'zh-CN', { numeric: true, sensitivity: 'base' });
    });

    return {
      tracks: tracks,
      musicDirName: musicRoot.name,
      lyricsDirName: lyricsRoot ? lyricsRoot.name : null,
      hasLyrics: !!lyricsRoot,
    };
  };

  /* ---------------- manifest.json 加载（HTTP 环境） ---------------- */

  MW.loadManifest = async function (url) {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    const list = Array.isArray(data) ? data : (data.tracks || []);
    const tracks = list.map(function (item, i) {
      if (typeof item === 'string') {
        const base = MW.baseName(item.split('/').pop());
        const meta = MW.guessMeta(base);
        return {
          key: item, fileName: item.split('/').pop(), title: meta.title, artist: meta.artist,
          album: '', ext: MW.extOf(item), url: item, lyricsUrl: null,
          hasLyrics: false, duration: 0, coverUrl: null, _tagged: false,
        };
      }
      const title = item.title || MW.guessMeta(MW.baseName(item.file || '')).title;
      return {
        key: item.key || item.file || String(i),
        fileName: (item.file || '').split('/').pop(),
        title: title,
        artist: item.artist || '',
        album: item.album || '',
        ext: MW.extOf(item.file || ''),
        url: item.file,
        lyricsUrl: item.lyrics || null,
        hasLyrics: !!item.lyrics,
        duration: item.duration || 0,
        size: item.size || 0,
        coverUrl: null,
        _tagged: false,
      };
    });
    return { tracks: tracks, generated: data.generated || null };
  };

  /* ---------------- 服务器目录自动扫描（IIS / nginx / Apache 通用） ---------------- */

  /**
   * 读取一个可浏览目录的 HTML 列表，解析出文件与子目录
   * 支持 IIS 目录浏览、nginx autoindex、Apache FancyIndex、Python http.server 等
   */
  MW.listWebDirectory = async function (dirUrl) {
    const res = await fetch(dirUrl, { cache: 'no-store' });
    if (!res.ok) {
      const err = new Error('HTTP ' + res.status);
      err.status = res.status;
      throw err;
    }
    const text = await res.text();
    const doc = new DOMParser().parseFromString(text, 'text/html');
    const base = res.url || dirUrl;

    const files = [];
    const dirs = [];
    let isListing = false;
    const pageTitle = (doc.title || '').toLowerCase();
    if (/index of|directory listing|目录列表|目录浏览/.test(pageTitle)) isListing = true;

    doc.querySelectorAll('a[href]').forEach(function (a) {
      const raw = (a.getAttribute('href') || '').trim();
      if (!raw) return;
      if (raw === '../' || raw === '..') { isListing = true; return; }
      if (raw.startsWith('?') || raw.startsWith('#')) return;

      let abs;
      try {
        abs = new URL(raw, base.endsWith('/') ? base : base + '/').href;
      } catch (e) { return; }
      if (abs === base || abs.indexOf(base) !== 0) return; // 站外 / 父级链接忽略

      const rel = abs.slice(base.length);
      if (rel === '') return;

      if (raw.endsWith('/') || rel.endsWith('/')) {
        dirs.push(abs);
      } else {
        let name = rel.split('/').pop();
        try { name = decodeURIComponent(name); } catch (e) { /* 保留原样 */ }
        if (name) files.push({ url: abs, name: name });
      }
    });

    // 只要能解析出条目就认为可读；空目录再靠 ../ 或页面标题判断
    if (!isListing && !files.length && !dirs.length) {
      const err = new Error('该地址不是目录列表');
      err.notListing = true;
      throw err;
    }
    return { files: files, dirs: dirs, url: base };
  };

  /**
   * 扫描部署在 Web 服务器上的 music / lyrics 目录
   * @param {string} rootUrl 站点（播放器所在）根地址
   */
  MW.scanServerLibrary = async function (rootUrl) {
    const root = rootUrl || (location.origin + '/');
    const musicUrl = new URL('music/', root).href;
    const lyricsUrl = new URL('lyrics/', root).href;

    let musicEntry = null;
    let lyricsEntry = null;

    try {
      musicEntry = await MW.listWebDirectory(musicUrl);
    } catch (e) {
      musicEntry = null;
    }

    if (musicEntry) {
      try { lyricsEntry = await MW.listWebDirectory(lyricsUrl); } catch (e) { lyricsEntry = null; }
    } else {
      // 回退：把站点根目录当作音乐目录
      musicEntry = await MW.listWebDirectory(root);
    }

    const audio = [];
    const lyrics = [];

    async function crawl(entry, depth, sink) {
      if (!entry) return;
      entry.files.forEach(sink);
      if (depth >= 4) return;
      for (const dirUrl of entry.dirs) {
        try {
          const sub = await MW.listWebDirectory(dirUrl);
          await crawl(sub, depth + 1, sink);
        } catch (e) { /* 跳过无法读取的子目录 */ }
      }
    }

    await crawl(musicEntry, 0, function (f) {
      const ext = MW.extOf(f.name);
      if (MW.AUDIO_EXT.indexOf(ext) >= 0) audio.push(f);
      else if (MW.LYRICS_EXT.indexOf(ext) >= 0) lyrics.push(f);
    });

    if (lyricsEntry) {
      await crawl(lyricsEntry, 0, function (f) {
        if (MW.LYRICS_EXT.indexOf(MW.extOf(f.name)) >= 0) lyrics.push(f);
      });
    }

    // 歌词索引
    const lyricIndex = new Map();
    lyrics.forEach(function (f) {
      const base = MW.baseName(f.name);
      const k1 = MW.normKey(base);
      const k2 = MW.normKey(MW.stripTrackNo(base));
      if (!lyricIndex.has(k1)) lyricIndex.set(k1, f.url);
      if (!lyricIndex.has(k2)) lyricIndex.set(k2, f.url);
    });

    audio.sort(function (a, b) {
      return a.name.localeCompare(b.name, 'zh-CN', { numeric: true, sensitivity: 'base' });
    });

    const tracks = audio.map(function (f) {
      const base = MW.baseName(f.name);
      const meta = MW.guessMeta(base);
      const lyricUrl = lyricIndex.get(MW.normKey(base))
        || lyricIndex.get(MW.normKey(MW.stripTrackNo(base))) || null;

      let key = f.url;
      try {
        key = decodeURIComponent(new URL(f.url).pathname).replace(/^\/+/, '') || f.url;
      } catch (e) { /* 保留 url */ }

      return {
        key: key,
        fileName: f.name,
        title: meta.title,
        artist: meta.artist,
        album: '',
        ext: MW.extOf(f.name),
        url: f.url,
        lyricsUrl: lyricUrl,
        hasLyrics: !!lyricUrl,
        duration: 0,
        coverUrl: null,
        _tagged: false,
      };
    });

    return {
      tracks: tracks,
      musicDir: musicEntry.url,
      hasLyricsDir: !!lyricsEntry,
    };
  };

})(window);
