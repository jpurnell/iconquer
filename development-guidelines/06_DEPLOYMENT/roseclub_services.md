# roseclub.org Service Deployment Guide

## Server Details

- **Host:** roseclub.org (192.168.1.120 LAN)
- **OS:** macOS 14.8.3 (Sonoma)
- **Swift:** 6.0.3
- **User:** jpurnell

## Active Services

### iconquer-server (Multiplayer Game Server)

- **Port:** 8084 (TCP, WebSocket)
- **Binary:** `~/iconquer/IconquerServer/.build/release/iconquer-server`
- **Plist:** `~/Library/LaunchAgents/com.roseclub.iconquer-server.plist`
- **Log:** `/tmp/iconquer-server.log`
- **Behavior:** RunAtLoad + KeepAlive (restarts on crash, starts on boot)
- **Dev tokens:** dev-token-1 (P1), dev-token-2 (P2)

### iconquer-tournament (Tournament Runner)

- **Schedule:** Every 6 hours (00:00, 06:00, 12:00, 18:00)
- **Binary:** `~/iconquer/IconquerTournament/.build/release/iconquer-tournament`
- **Plist:** `~/Library/LaunchAgents/com.roseclub.iconquer-tournament.plist`
- **Log:** `/tmp/iconquer-tournament.log`
- **Data:** `~/iconquer/tournament-data/`
- **Agents:** random, greedy, strategic
- **Config:** 20 rounds per pairing on duel map

## Management Commands

### iconquer-server

```bash
# Stop
launchctl unload ~/Library/LaunchAgents/com.roseclub.iconquer-server.plist

# Start
launchctl load ~/Library/LaunchAgents/com.roseclub.iconquer-server.plist

# View logs
tail -f /tmp/iconquer-server.log

# Rebuild after code changes
cd ~/iconquer/IconquerServer && swift build -c release --product iconquer-server
# Then unload + load to restart with new binary
```

### iconquer-tournament

```bash
# Disable scheduled runs
launchctl unload ~/Library/LaunchAgents/com.roseclub.iconquer-tournament.plist

# Enable scheduled runs
launchctl load ~/Library/LaunchAgents/com.roseclub.iconquer-tournament.plist

# Run manually
cd ~/iconquer/IconquerTournament && .build/release/iconquer-tournament run \
  --agents random,greedy,strategic --rounds 20 --maps duel \
  --storage ~/iconquer/tournament-data

# Check standings
.build/release/iconquer-tournament status --storage ~/iconquer/tournament-data

# Regenerate strategy guide
.build/release/iconquer-tournament generate-doc \
  --storage ~/iconquer/tournament-data \
  --output ~/iconquer/tournament-data/STRATEGY_GUIDE

# View logs
tail -f /tmp/iconquer-tournament.log
```

## Deployment Workflow

To deploy updated code:

```bash
# 1. Build and test locally
cd ~/Development/Swift/IconquerServer && swift test
cd ~/Development/Swift/IconquerTournament && swift test

# 2. Sync to server
rsync -avz --exclude '.build' --exclude '.git' --exclude 'Package.resolved' \
  ~/Development/Swift/IconquerServer/ jpurnell@roseclub.org:~/iconquer/IconquerServer/
rsync -avz --exclude '.build' --exclude '.git' --exclude 'Package.resolved' \
  ~/Development/Swift/IconquerTournament/ jpurnell@roseclub.org:~/iconquer/IconquerTournament/

# 3. Sync dependencies if Package.swift changed
for pkg in IconquerCore IconquerMatch IconquerAI; do
  scp ~/Development/Swift/$pkg/Package.swift jpurnell@roseclub.org:~/iconquer/$pkg/Package.swift
done

# 4. Build on server
ssh jpurnell@roseclub.org "cd ~/iconquer/IconquerServer && swift build -c release --product iconquer-server"
ssh jpurnell@roseclub.org "cd ~/iconquer/IconquerTournament && swift build -c release --product iconquer-tournament"

# 5. Restart services
ssh jpurnell@roseclub.org "launchctl unload ~/Library/LaunchAgents/com.roseclub.iconquer-server.plist && launchctl load ~/Library/LaunchAgents/com.roseclub.iconquer-server.plist"
```

## Port Forwarding

Router must forward these ports to 192.168.1.120:

- **8084/TCP** -- iconquer-server (WebSocket)

## Troubleshooting

- **Server won't start:** Check `/tmp/iconquer-server.log`. Common: port already in use.
- **Tournament fails:** Check `/tmp/iconquer-tournament.log`. Common: storage directory permissions.
- **Can't connect externally:** Verify port forwarding in router admin.
- **Swift version mismatch:** All packages use swift-tools-version: 6.0. Verify with `swift --version`.
