#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
本地静态服务器（支持 Range 请求，音频可拖动进度条）。

用法：
    python tools/server.py [端口]
然后在浏览器打开 http://127.0.0.1:8000
"""

import io
import os
import re
import sys
import threading
import webbrowser
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT_PORT = 8000


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store, must-revalidate")
        super().end_headers()

    # ---- 让音频支持 Range，进度条才能随意拖动 ----
    def send_head(self):
        range_header = self.headers.get("Range")
        if not range_header:
            return super().send_head()

        path = self.translate_path(self.path)
        if os.path.isdir(path) or not os.path.isfile(path):
            return super().send_head()

        match = re.match(r"bytes=(\d*)-(\d*)$", range_header.strip())
        if not match:
            return super().send_head()

        size = os.path.getsize(path)
        start_s, end_s = match.group(1), match.group(2)

        if start_s == "":
            suffix = int(end_s or 0)
            if suffix <= 0:
                return super().send_head()
            start = max(0, size - suffix)
            end = size - 1
        else:
            start = int(start_s)
            end = int(end_s) if end_s else size - 1

        if start >= size or start > end:
            self.send_response(416)
            self.send_header("Content-Range", "bytes */%d" % size)
            self.end_headers()
            return None

        end = min(end, size - 1)
        length = end - start + 1

        with open(path, "rb") as f:
            f.seek(start)
            data = f.read(length)

        self.send_response(206)
        self.send_header("Content-Type", self.guess_type(path))
        self.send_header("Content-Range", "bytes %d-%d/%d" % (start, end, size))
        self.send_header("Content-Length", str(length))
        self.send_header("Accept-Ranges", "bytes")
        self.end_headers()
        return io.BytesIO(data)

    def log_message(self, fmt, *args):
        pass


def main():
    port = DEFAULT_PORT
    if len(sys.argv) > 1:
        try:
            port = int(sys.argv[1])
        except ValueError:
            pass

    class QuietServer(ThreadingHTTPServer):
        def handle_error(self, request, client_address):
            # 浏览器中途断开（切歌 / 拖动进度）属正常现象，不打印堆栈
            if isinstance(sys.exc_info()[1], ConnectionResetError):
                return
            super().handle_error(request, client_address)

    server = None
    for candidate in range(port, port + 20):
        try:
            server = QuietServer(("127.0.0.1", candidate), Handler)
            port = candidate
            break
        except OSError:
            continue

    if server is None:
        print("[x] 找不到可用端口，请手动指定：python tools/server.py 8123")
        return 1

    url = "http://127.0.0.1:%d/" % port
    print("MusicWorld 已启动： %s" % url)
    print("按 Ctrl+C 停止服务")

    threading.Timer(0.8, lambda: webbrowser.open(url)).start()

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n已停止")
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
