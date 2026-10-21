#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
扫描 music / lyrics 文件夹，生成 manifest.json。
生成的清单会让网页在「通过本地服务器打开」时自动加载音乐，无需手动选择文件夹。

用法：
    python tools/scan.py
"""

import json
import os
import re
import sys
from datetime import datetime

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MUSIC_DIR = os.path.join(ROOT, "music")
LYRICS_DIR = os.path.join(ROOT, "lyrics")
OUT_FILE = os.path.join(ROOT, "manifest.json")

AUDIO_EXT = {".mp3", ".flac", ".wav", ".ogg", ".oga", ".m4a", ".aac",
             ".opus", ".wma", ".aiff", ".aif", ".ape", ".mp4"}
LYRICS_EXT = {".lrc", ".txt"}


def natural_key(text):
    return [int(part) if part.isdigit() else part.lower()
            for part in re.split(r"(\d+)", text)]


def norm_key(text):
    text = text.lower()
    text = re.sub(r"\s+", "", text)
    return re.sub(r"[_\-–—·.,，、'\"“”()（）\[\]]", "", text)


def strip_track_no(text):
    return re.sub(r"^\s*\d{1,3}\s*[.\-_、)]?\s*", "", text).strip()


def guess_meta(base):
    """从文件名推断 (歌手, 歌名)"""
    s = strip_track_no(base)
    parts = re.split(r"\s+[-–—]\s+", s)
    if len(parts) >= 2:
        return parts[0].strip(), " - ".join(parts[1:]).strip()
    m = re.match(r"^(.+?)[《【](.+?)[》】]$", s)
    if m:
        return m.group(1).strip(), m.group(2).strip()
    return "", s or base


def walk_files(root, exts):
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = sorted([d for d in dirnames if not d.startswith(".")])
        for name in sorted(filenames, key=natural_key):
            if os.path.splitext(name)[1].lower() in exts:
                yield os.path.join(dirpath, name)


def rel(path):
    return os.path.relpath(path, ROOT).replace("\\", "/")


def main():
    if not os.path.isdir(MUSIC_DIR):
        print("[x] 找不到 music 文件夹：%s" % MUSIC_DIR)
        return 1

    # 建立歌词索引
    lyric_index = {}
    if os.path.isdir(LYRICS_DIR):
        for path in walk_files(LYRICS_DIR, LYRICS_EXT):
            base = os.path.splitext(os.path.basename(path))[0]
            lyric_index.setdefault(norm_key(base), path)
            lyric_index.setdefault(norm_key(strip_track_no(base)), path)

    tracks = []
    for path in walk_files(MUSIC_DIR, AUDIO_EXT):
        base = os.path.splitext(os.path.basename(path))[0]
        artist, title = guess_meta(base)
        item = {
            "key": rel(path),
            "file": rel(path),
            "title": title,
            "artist": artist,
            "size": os.path.getsize(path),
        }
        lyric = lyric_index.get(norm_key(base)) or lyric_index.get(norm_key(strip_track_no(base)))
        if lyric:
            item["lyrics"] = rel(lyric)
        tracks.append(item)

    tracks.sort(key=lambda t: natural_key(t["file"]))

    data = {
        "generated": datetime.now().isoformat(timespec="seconds"),
        "count": len(tracks),
        "tracks": tracks,
    }

    with open(OUT_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

    with_lyrics = sum(1 for t in tracks if t.get("lyrics"))
    print("[+] 已生成 manifest.json")
    print("    音频 %d 首，匹配到歌词 %d 首" % (len(tracks), with_lyrics))
    if tracks and with_lyrics == 0:
        print("    提示：歌词文件名需要和音频同名（扩展名不同），放在 lyrics 文件夹里")
    return 0


if __name__ == "__main__":
    sys.exit(main())
