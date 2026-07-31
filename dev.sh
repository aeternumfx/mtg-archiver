#!/usr/bin/env zsh
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PID_FILE="$SCRIPT_DIR/.dev.pids"

start() {
  echo "Starting mtg-archiver dev servers..."
  export NVM_DIR="$HOME/.nvm"
  [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
  nvm use 22 > /dev/null 2>&1

  npm run dev -w server > /tmp/mtg-server.log 2>&1 &
  echo $! > "$PID_FILE.server"

  npm run dev -w client > /tmp/mtg-client.log 2>&1 &
  echo $! > "$PID_FILE.client"

  echo "Servers starting..."
  echo "  Server log:  tail -f /tmp/mtg-server.log"
  echo "  Client log:  tail -f /tmp/mtg-client.log"
}

stop() {
  for role in server client; do
    if [ -f "$PID_FILE.$role" ]; then
      kill $(cat "$PID_FILE.$role") 2>/dev/null && echo "Stopped $role" || echo "$role was not running"
      rm "$PID_FILE.$role"
    fi
  done
}

status() {
  for role in server client; do
    if [ -f "$PID_FILE.$role" ] && kill -0 $(cat "$PID_FILE.$role") 2>/dev/null; then
      echo "$role is running (pid $(cat "$PID_FILE.$role"))"
    else
      echo "$role is stopped"
    fi
  done
}

case "${1:-start}" in
  start) start ;;
  stop) stop ;;
  restart) stop; sleep 1; start ;;
  status) status ;;
  *) echo "Usage: $0 {start|stop|restart|status}" ;;
esac
