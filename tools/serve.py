"""Local preview server for the site.

Plain `python -m http.server` lets the browser cache app.js and data/*.json,
which during editing means a refresh keeps showing the previous version --
Opera GX in particular holds on to them. This sends no-store on everything, so
a reload is always the file on disk.

    python tools/serve.py           # http://127.0.0.1:8765
    python tools/serve.py 9000
"""
import functools
import http.server
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, must-revalidate')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
    handler = functools.partial(NoCacheHandler, directory=ROOT)
    with http.server.ThreadingHTTPServer(('127.0.0.1', port), handler) as srv:
        print('http://127.0.0.1:%d/index.html  (Ctrl+C konczy)' % port)
        srv.serve_forever()


if __name__ == '__main__':
    main()
