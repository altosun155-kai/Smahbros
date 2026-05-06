---
paths:
  - "web/game.html"
  - "game_ws_manager.py"
---

# Game Rules (Phaser 3 + WebSocket)

- Server owns all physics — client is a pure renderer. Never move a player on the client.
- All player positions come from server `state` messages; apply them in `applyState()` only.
- WebSocket auth: send `{ token, username }` on `ws.onopen`, not later.
- Room capacity is exactly 2 players. The server rejects a third connection.
- `playerSlot` is 0-indexed from the server; show "Player 1" / "Player 2" in UI (+1).
- Visual layer order (Phaser depth): floor → walls → slashGfx → boomGfx → slimeGfx → HUD
- WebSocket closes silently on auth failure — always handle `ws.onclose` and show a message.
- Render cold-starts take ~30 s — show a "server waking up" status after 4 s delay.
