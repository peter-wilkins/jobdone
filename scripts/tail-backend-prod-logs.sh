#!/usr/bin/env bash
set -euo pipefail

export VERCEL_TELEMETRY_DISABLED="${VERCEL_TELEMETRY_DISABLED:-1}"

target="${VERCEL_BACKEND_LOG_TARGET:-https://jobdone-gamma.vercel.app}"
since="30m"
limit="100"
follow="1"
expand="1"
json="0"
grep_pattern=""
level=""
status_code=""
query=""

usage() {
  cat <<'EOF'
Tail JobDone production backend logs from Vercel.

Usage:
  npm run logs:backend
  npm run logs:backend -- --grep "Transcription endpoint error"
  npm run logs:backend -- --level error --since 2h
  npm run logs:backend -- --status-code 500 --no-follow

Options:
  --grep, -g <pattern>       Filter output locally with grep.
  --since <time>             Start time, e.g. 30m, 2h, 2026-05-18T12:00:00Z.
  --limit <n>                Number of historical log lines before follow.
  --level <level>            Vercel log level: error, warning, info, fatal.
  --status-code <code>       HTTP status code filter, e.g. 500, 4xx.
  --query <query>            Vercel advanced query, e.g. "status:500 error".
  --json                     Output JSON Lines.
  --no-follow                Do not stream live logs.
  --no-expand                Do not show expanded log details.
  --target <url|id>          Deployment URL/ID. Defaults to production alias.
  --help, -h                 Show this help.

Environment:
  VERCEL_BACKEND_LOG_TARGET  Override default target URL/deployment ID.

Notes:
  Keep grep patterns narrow when asking an AI to inspect output. Raw live logs
  can be noisy and expensive to paste into a conversation.
  If the Vercel CLI fails with a sentry.io DNS error, retry from a normal
  network shell; that is Vercel CLI telemetry/error reporting, not backend logs.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --grep|-g)
      grep_pattern="${2:-}"
      shift 2
      ;;
    --since)
      since="${2:-}"
      shift 2
      ;;
    --limit)
      limit="${2:-}"
      shift 2
      ;;
    --level)
      level="${2:-}"
      shift 2
      ;;
    --status-code)
      status_code="${2:-}"
      shift 2
      ;;
    --query)
      query="${2:-}"
      shift 2
      ;;
    --json)
      json="1"
      shift
      ;;
    --no-follow)
      follow="0"
      shift
      ;;
    --no-expand)
      expand="0"
      shift
      ;;
    --target)
      target="${2:-}"
      shift 2
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

cmd=(vercel --cwd backend logs "$target" --environment production --since "$since" --limit "$limit")

if [[ "$follow" == "1" ]]; then
  cmd+=(--follow)
fi

if [[ "$expand" == "1" && "$json" != "1" ]]; then
  cmd+=(--expand)
fi

if [[ "$json" == "1" ]]; then
  cmd+=(--json)
fi

if [[ -n "$level" ]]; then
  cmd+=(--level "$level")
fi

if [[ -n "$status_code" ]]; then
  cmd+=(--status-code "$status_code")
fi

if [[ -n "$query" ]]; then
  cmd+=(--query "$query")
fi

if [[ -n "$grep_pattern" ]]; then
  "${cmd[@]}" | grep --line-buffered -i -- "$grep_pattern"
else
  "${cmd[@]}"
fi
