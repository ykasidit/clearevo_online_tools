#!/usr/bin/env python3
"""Static server for the browser tests with the headers the live site sends (deploy.sh _headers):
the BatRay page is cross-origin isolated (COOP + COEP) and every BatRay script carries COEP, because
Chrome refuses a dedicated worker whose script lacks the page's embedder policy - the SQLite worker
failed on every phone from 0.9.40 to 0.9.49 while the tests, served without headers, passed.
Usage: serve.py PORT DIRECTORY"""
import http.server, os, sys

class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        p = self.path.split('?')[0]
        if p.startswith('/batray/'):
            if p == '/batray/' or p.endswith('/index.html'):
                self.send_header('Cross-Origin-Opener-Policy', 'same-origin')
                self.send_header('Permissions-Policy', 'geolocation=()')
            if p == '/batray/' or p.endswith('/index.html') or p.endswith('.js'):
                self.send_header('Cross-Origin-Embedder-Policy', 'credentialless')
        super().end_headers()
    def log_message(self, *a): pass

os.chdir(sys.argv[2])
http.server.ThreadingHTTPServer(('127.0.0.1', int(sys.argv[1])), Handler).serve_forever()
