.DEFAULT_GOAL := help

# Port is assigned in scripts/repo-tools.sh (get_port).
PORT = 8807

# ── Help ──────────────────────────────────────────────────────────────────────
.PHONY: help
help:
	@echo ""
	@echo "  make serve    Start dev server → http://localhost:$(PORT)"
	@echo "  make dev      Same, with caching off (use this while editing)"
	@echo "  make kill     Kill this project's HTTP server"
	@echo ""

# ── Dev server ────────────────────────────────────────────────────────────────
.PHONY: serve
serve:
	@echo "Serving → http://localhost:$(PORT)"
	@python3 -m http.server $(PORT)

# ── Dev server (no caching) ───────────────────────────────────────────────────
# `make serve` is fine for looking at the site. Use this one while editing:
# python's http.server sends Last-Modified only, so a browser will happily hold
# an ES module for the rest of the session and you end up debugging a file you
# already fixed.
.PHONY: dev
dev:
	@echo "Serving (no-cache) → http://localhost:$(PORT)"
	@python3 -c "import http.server; \
	H = type('H', (http.server.SimpleHTTPRequestHandler,), \
	  {'end_headers': lambda s: (s.send_header('Cache-Control','no-store, max-age=0'), http.server.SimpleHTTPRequestHandler.end_headers(s))}); \
	http.server.ThreadingHTTPServer(('', $(PORT)), H).serve_forever()"

# ── Kill ──────────────────────────────────────────────────────────────────────
.PHONY: kill
kill:
	@lsof -ti :$(PORT) | xargs kill 2>/dev/null && echo "Stopped server on port $(PORT)" || echo "No server running on port $(PORT)"
