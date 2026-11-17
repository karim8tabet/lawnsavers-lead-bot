#!/usr/bin/env bash
# Sends the demo payloads to the n8n webhook (bash / WSL version of run-tests.ps1).
#
# Usage:
#   ./tests/run-tests.sh <webhook-url> <your-email> [case] [secret]
#   case: all | normal | complaint | injection | junk | duplicate   (default: all)
set -euo pipefail

URL="${1:?webhook url required}"
EMAIL="${2:?your email required}"
CASE="${3:-all}"
SECRET="${4:-}"
USER_PART="${EMAIL%@*}"
DOMAIN_PART="${EMAIL#*@}"
DIR="$(cd "$(dirname "$0")" && pwd)/payloads"

send_case() {
  local file="$1"
  echo "-> $(basename "$file")"
  local body
  body="$(sed -e "s/EMAIL_USER/${USER_PART}/g" -e "s/EMAIL_DOMAIN/${DOMAIN_PART}/g" "$file")"
  local auth=()
  [ -n "$SECRET" ] && auth=(-H "X-Webhook-Secret: $SECRET")
  curl -sS -X POST "$URL" -H 'Content-Type: application/json' "${auth[@]}" --data "$body" || echo "   FAILED"
  echo
}

for f in "$DIR"/*.json; do
  if [ "$CASE" != "all" ] && [[ "$f" != *"-$CASE.json" ]]; then continue; fi
  send_case "$f"
  if [[ "$f" == *"-duplicate.json" ]]; then
    sleep 5
    echo "   (sending the same email again)"
    send_case "$f"
  fi
  sleep 2
done

echo "Now check: n8n Executions, your inbox, HubSpot contacts, and the Google Sheet."
