#!/usr/bin/env python3
"""
search_helper.py — локальный HTTP-сервер для обогащения данных товара.
Запуск: python3 search_helper.py
Порт:  11435
"""

from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.request import urlopen, Request
from urllib.parse import urlencode, quote_plus
from urllib.error import URLError
import json
import re
import sys

PORT = 11435

def search_product(title):
    """Ищет описание товара через DuckDuckGo HTML и возвращает текстовые сниппеты."""
    query = quote_plus(title + ' характеристики описание')
    url = f'https://html.duckduckgo.com/html/?q={query}&kl=ru-ru'
    req = Request(url, headers={
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Accept-Language': 'ru-RU,ru;q=0.9'
    })
    try:
        with urlopen(req, timeout=8) as resp:
            html = resp.read().decode('utf-8', errors='ignore')
    except URLError as e:
        print(f'[search] fetch error: {e}', file=sys.stderr)
        return ''

    # Извлечь сниппеты из результатов поиска
    snippets = re.findall(r'class="result__snippet"[^>]*>(.*?)</a>', html, re.DOTALL)
    clean = []
    for s in snippets[:5]:
        text = re.sub(r'<[^>]+>', '', s).strip()
        text = re.sub(r'\s+', ' ', text)
        if len(text) > 40:
            clean.append(text)

    result = ' '.join(clean[:3])
    return result[:800]


class Handler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        print(f'[search] {args[0]} {args[1]}', file=sys.stderr)

    def do_POST(self):
        length = int(self.headers.get('Content-Length', 0))
        body = self.rfile.read(length)
        try:
            data = json.loads(body)
            title = data.get('title', '')
        except Exception:
            title = ''

        text = search_product(title) if title else ''
        response = json.dumps({'text': text}, ensure_ascii=False).encode('utf-8')

        self.send_response(200)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Content-Length', len(response))
        self.end_headers()
        self.wfile.write(response)

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()


if __name__ == '__main__':
    server = HTTPServer(('localhost', PORT), Handler)
    print(f'[search] запущен на http://localhost:{PORT}', file=sys.stderr)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print('\n[search] остановлен', file=sys.stderr)
