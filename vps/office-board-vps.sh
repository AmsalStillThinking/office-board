#!/usr/bin/env bash
# Office Board on a Linux VPS, behind a cloudflared tunnel that already runs there. As root, in an ssh -t session:
#   bash office-board-vps.sh check                read-only report; changes nothing
#   bash office-board-vps.sh install <hostname>   first install: user, database, service (asks for the first director)
#   bash office-board-vps.sh tunnel <hostname>    send <hostname> to the board (asks before restarting cloudflared)
#   bash office-board-vps.sh update               newest master, restart; goes back if the new version does not answer
# Needs Node 24, PostgreSQL on 127.0.0.1:5432, git, curl, openssl. Never upgrades or restarts anything else unasked.
set -euo pipefail

REPO_URL=https://github.com/AmsalStillThinking/office-board.git
APP_USER=officeboard
HOME_DIR=/home/$APP_USER
CODE=$HOME_DIR/office-board
DATA=$HOME_DIR/data
SEED=$HOME_DIR/seed
PORT=3006
UNIT=/etc/systemd/system/office-board.service

say() { printf '%s\n' "$*"; }
die() { printf 'STOPPED: %s\n' "$*" >&2; exit 1; }
need_root() { [ "$(id -u)" = 0 ] || die "run as root"; }
g() { sudo -u "$APP_USER" git -C "$CODE" --no-pager "$@"; }
pgsql() { (cd /tmp && sudo -u postgres psql -X -q -v ON_ERROR_STOP=1 "$@"); }
answers() { curl -s -o /dev/null -w '%{http_code}' --max-time 5 "http://127.0.0.1:$PORT/api/session" 2>/dev/null || true; }
wait_answer() { local i; for i in $(seq 1 40); do [ "$(answers)" = 200 ] && return 0; sleep 2; done; return 1; }
node_major() { node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0; }
port_owner() { ss -ltnpH "sport = :$PORT" 2>/dev/null || true; }
cf_config() { # the config file the running cloudflared service reads
  local exec re='--config[= ]+([^ ]+)'
  exec=$(systemctl cat cloudflared 2>/dev/null | grep -m1 '^ExecStart=' || true)
  if [[ $exec =~ $re ]]; then echo "${BASH_REMATCH[1]}"; elif [ -f /etc/cloudflared/config.yml ]; then echo /etc/cloudflared/config.yml; fi
}

cmd_check() {
  set +e
  say "== system"
  . /etc/os-release; say "OS: $PRETTY_NAME"
  say "timezone: $(timedatectl show -p Timezone --value 2>/dev/null)"
  free -m | awk 'NR==2 {print "RAM MB: total " $2 ", available " $7}'
  df -h / | awk 'NR==2 {print "disk /: size " $2 ", free " $4}'
  say "== tools"
  if command -v node >/dev/null; then say "node $(node -v) at $(command -v node)"; else say "node: NOT INSTALLED"; fi
  for c in git curl openssl psql cloudflared; do command -v "$c" >/dev/null && say "$c: ok" || say "$c: MISSING"; done
  say "== postgresql"
  psql --version 2>/dev/null
  say "service postgresql: $(systemctl is-active postgresql 2>/dev/null)"
  ss -ltnH 'sport = :5432' | awk '{print "listening on 5432: " $4}'
  docker ps --format '{{.Names}} {{.Image}}' 2>/dev/null | grep -i postgres | sed 's/^/docker container: /'
  pgsql -At -c "SELECT 'role office_board: ' || count(*) FROM pg_roles WHERE rolname = 'office_board'
                UNION ALL SELECT 'database office_board: ' || count(*) FROM pg_database WHERE datname = 'office_board'" \
    || say "(could not ask PostgreSQL as the user postgres)"
  say "== port $PORT"
  local o; o=$(port_owner); say "${o:-free}"
  say "== office board"
  id "$APP_USER" &>/dev/null && say "user $APP_USER: exists" || say "user $APP_USER: not yet"
  for d in "$CODE" "$DATA" "$SEED"; do [ -e "$d" ] && say "$d: exists" || say "$d: not yet"; done
  [ -f "$UNIT" ] && say "service office-board: $(systemctl is-active office-board 2>/dev/null)" || say "service office-board: not installed"
  [ -d "$CODE/.git" ] && say "code: $(g log -1 --format='%h %s')"
  say "== cloudflared"
  cloudflared --version 2>/dev/null | head -1
  say "service cloudflared: $(systemctl is-active cloudflared 2>/dev/null)"
  systemctl cat cloudflared 2>/dev/null | grep '^ExecStart=' | sed -E 's/(--token[= ]+)[^ ]+/\1***/'
  local c; c=$(cf_config)
  if [ -n "$c" ] && [ -f "$c" ]; then
    say "config: $c"
    grep -E '^[[:space:]]*(tunnel:|-?[[:space:]]*hostname:|-?[[:space:]]*service:)' "$c" | sed 's/^/  /'
  else
    say "config file: none (a tunnel run with --token keeps its routes in the Cloudflare dashboard)"
  fi
  say "== done; nothing was changed"
}

cmd_install() {
  local host=${1:-}; [ -n "$host" ] || die "usage: install <hostname>"
  need_root
  [ "$(node_major)" -ge 24 ] || die "Node 24 or newer is needed, found $(node -v 2>/dev/null || echo none). Not upgrading it here: other programs on this server use the same Node."
  local c; for c in git curl openssl psql; do command -v "$c" >/dev/null || die "$c is not installed"; done
  systemctl is-active --quiet postgresql || die "the postgresql service is not running"
  [ -z "$(port_owner)" ] || die "port $PORT is in use: $(port_owner)"
  [ ! -e "$DATA/database.url" ] || die "$DATA/database.url exists: the board is installed already (use update)"
  pgsql -At -c 'SELECT 1' >/dev/null || die "cannot reach PostgreSQL as the user postgres"
  [ "$(pgsql -At -c "SELECT count(*) FROM pg_roles WHERE rolname = 'office_board'")" = 0 ] || die "PostgreSQL already has a role office_board; not touching it"
  [ "$(pgsql -At -c "SELECT count(*) FROM pg_database WHERE datname = 'office_board'")" = 0 ] || die "PostgreSQL already has a database office_board; not touching it"

  # The first director. Everyone else is added in the board itself (Lainnya -> Orang & Pengaturan).
  local name user
  read -rp "First director's full name: " name
  name=$(printf '%s' "$name" | sed -E 's/^[[:space:]]+|[[:space:]]+$//g')
  [ -n "$name" ] || die "a name is needed"
  read -rp "Their username (1-40 of a-z 0-9 . _ -): " user
  user=$(printf '%s' "$user" | tr '[:upper:]' '[:lower:]' | sed -E 's/^[[:space:]]+|[[:space:]]+$//g')
  [[ $user =~ ^[a-z0-9._-]{1,40}$ ]] || die "the username must be 1-40 of a-z 0-9 . _ -"

  id "$APP_USER" &>/dev/null || useradd --system --create-home --home-dir "$HOME_DIR" --shell /usr/sbin/nologin "$APP_USER"
  chmod 750 "$HOME_DIR"
  [ -d "$CODE/.git" ] || sudo -u "$APP_USER" git clone --quiet --branch master "$REPO_URL" "$CODE"
  install -d -m 700 -o "$APP_USER" -g "$APP_USER" "$DATA" "$SEED"
  sudo -u "$APP_USER" node -e 'require("fs").writeFileSync(process.argv[1], JSON.stringify({ people: [{ id: "D01", name: process.argv[2], nick: "", role: "direktur", keeper: 0, username: process.argv[3] }] }, null, 1) + "\n")' \
    "$SEED/people.json" "$name" "$user"

  # Database with a random password that is never printed or put on a command line.
  local pw; pw=$(openssl rand -hex 24)
  pgsql <<SQL
CREATE ROLE office_board LOGIN PASSWORD '$pw';
CREATE DATABASE office_board OWNER office_board TEMPLATE template0 ENCODING 'UTF8' LOCALE_PROVIDER libc LC_COLLATE 'C' LC_CTYPE 'C';
SQL
  (umask 077; printf 'postgresql://office_board:%s@127.0.0.1:5432/office_board\n' "$pw" > "$DATA/database.url")
  chown "$APP_USER:$APP_USER" "$DATA/database.url"

  cat > "$UNIT" <<UNIT
[Unit]
Description=Office Board
After=network-online.target postgresql.service
Wants=network-online.target

[Service]
User=$APP_USER
WorkingDirectory=$CODE/app
ExecStart=$(command -v node) server.mjs --port $PORT --host 127.0.0.1 --data $DATA --seed $SEED --https
Restart=on-failure
RestartSec=5
NoNewPrivileges=true

[Install]
WantedBy=multi-user.target
UNIT
  systemctl daemon-reload
  systemctl enable --now --quiet office-board
  wait_answer || die "the board does not answer on 127.0.0.1:$PORT: journalctl -u office-board -n 50, and $DATA/server.log"
  say "The board answers on 127.0.0.1:$PORT ($(g log -1 --format='%h %s'))."
  if [ -f "$DATA/first-pins.txt" ]; then
    say "== Sign in with this once; the board then asks for a new password. Shown only now (the file is deleted):"
    tr -d '\r' < "$DATA/first-pins.txt" | awk -F'\t' '!/^#/ && NF >= 4 {print "   username: " $3 "    temporary password: " $4}'
    rm -f "$DATA/first-pins.txt"
  fi
  say "Next: bash $0 tunnel $host"
}

cmd_tunnel() {
  local host=${1:-}; [ -n "$host" ] || die "usage: tunnel <hostname>"
  [[ $host =~ ^[a-z0-9.-]+$ ]] || die "not a hostname: $host"
  need_root
  [ "$(answers)" = 200 ] || die "the board does not answer on 127.0.0.1:$PORT: run install first"
  local cfg; cfg=$(cf_config)
  [ -n "$cfg" ] && [ -f "$cfg" ] || die "no cloudflared config file (a tunnel run with --token is routed in the Cloudflare dashboard: add $host -> http://127.0.0.1:$PORT there)"
  local hre=${host//./\\.}
  if grep -Eq "^[[:space:]]*-[[:space:]]*hostname:[[:space:]]*$hre[[:space:]]*$" "$cfg"; then
    say "$cfg has a rule for $host already"
  else
    local n; n=$(grep -cE '^[[:space:]]*-[[:space:]]*service:[[:space:]]*http_status:404[[:space:]]*$' "$cfg" || true)
    [ "$n" = 1 ] || die "expected one catch-all line '- service: http_status:404' in $cfg, found $n: add the rule by hand"
    local bak; bak="$cfg.bak-$(date +%Y%m%d-%H%M%S)"
    cp -p "$cfg" "$bak"
    awk -v host="$host" -v svc="http://127.0.0.1:$PORT" '
      /^[[:space:]]*-[[:space:]]*service:[[:space:]]*http_status:404[[:space:]]*$/ {
        ind = $0; sub(/-.*/, "", ind); print ind "- hostname: " host; print ind "  service: " svc }
      { print }' "$bak" > "$cfg"
    if ! cloudflared --config "$cfg" tunnel ingress validate >/dev/null 2>&1; then
      cp -p "$bak" "$cfg"; die "cloudflared refused the new file; the old one is back in place"
    fi
    say "Rule added to $cfg (the old file: $bak)"
  fi
  local rule; rule=$(cloudflared --config "$cfg" tunnel ingress rule "https://$host" 2>&1 || true)
  printf '%s\n' "$rule" | grep -q "127.0.0.1:$PORT" || die "cloudflared would not send https://$host to the board: $rule"
  local yes
  read -rp "Restart cloudflared now? Every site on this tunnel (the shop too) is unreachable for a few seconds. [y/N] " yes
  [[ $yes =~ ^[yY] ]] || { say "Not restarted. When it suits: systemctl restart cloudflared"; return 0; }
  systemctl restart cloudflared
  sleep 3
  systemctl is-active --quiet cloudflared || die "cloudflared is not running after the restart: journalctl -u cloudflared -n 50"
  say "cloudflared restarted. Open https://$host on a phone."
}

cmd_update() {
  need_root
  [ -d "$CODE/.git" ] || die "the board is not installed"
  local old new
  old=$(g rev-parse HEAD)
  g fetch --quiet origin master
  new=$(g rev-parse FETCH_HEAD)
  if [ "$old" = "$new" ]; then say "Nothing new: $(g log -1 --format='%h %s')"; return 0; fi
  g merge --ff-only --quiet FETCH_HEAD || die "the code folder has changes of its own; nothing was changed"
  say "Landing:"; g log --oneline "$old..$new"
  systemctl restart office-board
  if wait_answer; then say "Done: $(g log -1 --format='%h %s') is live"; return 0; fi
  say "The new version does not answer; going back to ${old:0:7}"
  g reset --hard --quiet "$old"
  systemctl restart office-board
  if wait_answer; then die "back on ${old:0:7}, which answers; see journalctl -u office-board -n 50"; fi
  die "the old version does not answer either: journalctl -u office-board -n 50"
}

case "${1:-}" in
  check) cmd_check ;;
  install) shift; cmd_install "$@" ;;
  tunnel) shift; cmd_tunnel "$@" ;;
  update) cmd_update ;;
  *) sed -n '2,7p' "$0"; exit 2 ;;
esac
