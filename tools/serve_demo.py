"""Serve only standalone extension assets on loopback; no personal files."""
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlsplit
import argparse

ROOT = Path(__file__).resolve().parents[1]


class Handler(SimpleHTTPRequestHandler):
    def translate_path(self, path):
        parts = unquote(urlsplit(path).path).split('/')
        if len(parts) < 2 or parts[1] != 'extension' or any(p in {'.', '..'} or '\\' in p or ':' in p for p in parts):
            return str(ROOT / '__not_served__')
        target = ROOT.joinpath(*[p for p in parts if p]).resolve()
        return str(target) if target.is_relative_to(ROOT / 'extension') else str(ROOT / '__not_served__')

    def list_directory(self, path):
        self.send_error(403, 'Directory listing disabled')
        return None


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--port', type=int, default=8089)
    server = ThreadingHTTPServer(('127.0.0.1', parser.parse_args().port), Handler)
    print(f'Standalone preview: http://127.0.0.1:{server.server_port}/extension/jobs.html', flush=True)
    server.serve_forever()
