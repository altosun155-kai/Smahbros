import streamlit as st
import random
from dataclasses import dataclass
from typing import List, Optional, Dict
import pandas as pd
import math
import os
import requests

st.set_page_config(page_title="Smash Bracket", page_icon="🎮", layout="wide")
st.markdown("""
<style>
.match-box { border: 1px solid #ddd; border-radius: 10px; padding: 6px 8px; margin: 6px 0;
  font-size: 14px; line-height: 1.25; background: #fff; }
.round-title { font-weight: 700; margin-bottom: 8px; }
.name-line { display: flex; align-items: center; gap: 6px; }
.name-line img { vertical-align: middle; }
.tbd { opacity: 0.6; font-style: italic; }
.legend-badge { display: inline-block; width: 10px; height: 10px; border-radius: 2px; margin-right: 6px; vertical-align: middle; }
.small { font-size: 13px; }
.leaderboard-container { padding: 10px; border-radius: 10px; background-color: #f0f2f6; margin-top: 20px; }
/* Tier list styles */
.tier-row { display: flex; align-items: center; gap: 6px; flex-wrap: wrap;
  border-radius: 8px; padding: 6px 10px; margin-bottom: 6px; background: #1e1e2e; }
.tier-label { font-weight: 900; font-size: 20px; width: 32px; text-align: center; flex-shrink: 0; }
.tier-char { background: #2a2a3e; color: #e0e0f0; border-radius: 6px;
  padding: 3px 8px; font-size: 13px; cursor: pointer; white-space: nowrap; }
.invite-badge { background: #ff4b4b; color: white; border-radius: 12px;
  padding: 2px 8px; font-size: 12px; font-weight: 700; }
</style>
""", unsafe_allow_html=True)

# ── Backend URL ───────────────────────────────────────────────────────────────
BACKEND_URL = os.environ.get("BACKEND_URL", "http://localhost:8000")

# ── All 89 Smash Ultimate fighters (official roster order) ───────────────────
SMASH_ULTIMATE_ROSTER = [
    "Mario","Donkey Kong","Link","Samus","Dark Samus","Yoshi","Kirby","Fox","Pikachu",
    "Luigi","Ness","Captain Falcon","Jigglypuff","Peach","Daisy","Bowser","Ice Climbers",
    "Sheik","Zelda","Dr. Mario","Pichu","Falco","Marth","Lucina","Young Link","Ganondorf",
    "Mewtwo","Roy","Chrom","Mr. Game & Watch","Meta Knight","Pit","Dark Pit","Zero Suit Samus",
    "Wario","Snake","Ike","Pokémon Trainer","Diddy Kong","Lucas","Sonic","King Dedede",
    "Olimar","Lucario","R.O.B.","Toon Link","Wolf","Villager","Mega Man","Wii Fit Trainer",
    "Rosalina & Luma","Little Mac","Greninja","Mii Brawler","Mii Swordfighter","Mii Gunner",
    "Palutena","Pac-Man","Robin","Shulk","Bowser Jr.","Duck Hunt","Ryu","Ken","Cloud",
    "Corrin","Bayonetta","Inkling","Ridley","Simon","Richter","King K. Rool","Isabelle",
    "Incineroar","Piranha Plant","Joker","Hero","Banjo & Kazooie","Terry","Byleth",
    "Min Min","Steve","Sephiroth","Pyra/Mythra","Kazuya","Sora",
]

TIER_COLORS = {
    "S": "#ff7f7f",
    "A": "#ffbf7f",
    "B": "#ffff7f",
    "C": "#7fff7f",
    "D": "#7fbfff",
    "F": "#bf7fff",
}
TIERS = ["S", "A", "B", "C", "D", "F"]

# ── API helpers ───────────────────────────────────────────────────────────────
def api_headers() -> dict:
    token = st.session_state.get("auth_token")
    return {"Authorization": f"Bearer {token}"} if token else {}

def api_post(path: str, json: dict, auth: bool = True) -> Optional[dict]:
    try:
        headers = api_headers() if auth else {}
        r = requests.post(f"{BACKEND_URL}{path}", json=json, headers=headers, timeout=10)
        if r.ok:
            return r.json()
        st.error(f"API error {r.status_code}: {r.json().get('detail', r.text)}")
    except Exception as e:
        st.error(f"Could not reach backend: {e}")
    return None

def api_post_form(path: str, data: dict) -> Optional[dict]:
    try:
        r = requests.post(f"{BACKEND_URL}{path}", data=data, timeout=10)
        if r.ok:
            return r.json()
        st.error(f"Login error: {r.json().get('detail', r.text)}")
    except Exception as e:
        st.error(f"Could not reach backend: {e}")
    return None

def api_get(path: str) -> Optional[dict | list]:
    try:
        r = requests.get(f"{BACKEND_URL}{path}", headers=api_headers(), timeout=10)
        if r.ok:
            return r.json()
        st.error(f"API error {r.status_code}: {r.json().get('detail', r.text)}")
    except Exception as e:
        st.error(f"Could not reach backend: {e}")
    return None

def api_put(path: str, json: dict) -> Optional[dict]:
    try:
        r = requests.put(f"{BACKEND_URL}{path}", json=json, headers=api_headers(), timeout=10)
        if r.ok:
            return r.json()
        st.error(f"API error {r.status_code}: {r.json().get('detail', r.text)}")
    except Exception as e:
        st.error(f"Could not reach backend: {e}")
    return None

def api_patch(path: str, json: dict) -> Optional[dict]:
    try:
        r = requests.patch(f"{BACKEND_URL}{path}", json=json, headers=api_headers(), timeout=10)
        if r.ok:
            return r.json()
        st.error(f"API error {r.status_code}: {r.json().get('detail', r.text)}")
    except Exception as e:
        st.error(f"Could not reach backend: {e}")
    return None

def api_delete(path: str) -> bool:
    try:
        r = requests.delete(f"{BACKEND_URL}{path}", headers=api_headers(), timeout=10)
        return r.ok
    except Exception as e:
        st.error(f"Could not reach backend: {e}")
    return False

def search_users(q: str) -> list:
    try:
        r = requests.get(f"{BACKEND_URL}/users/search", params={"q": q}, headers=api_headers(), timeout=5)
        if r.ok:
            return [u["username"] for u in r.json()]
    except Exception:
        pass
    return []

# ── Global session state ──────────────────────────────────────────────────────
for key, default in [
    ("page", "Bracket Generator"),
    ("player_colors", {}),
    ("rr_results", {}),
    ("rr_records", {}),
    ("players_multiline", "You\nFriend1\nFriend2"),
    ("player_order_drawn", []),
    ("player_order_final", []),
    ("auth_token", None),
    ("username", None),
    # tier list local state
    ("tier_ranking", None),    # dict: tier -> list of char names
    ("tier_dirty", False),     # unsaved changes flag
]:
    if key not in st.session_state:
        st.session_state[key] = default

# ── Data types ────────────────────────────────────────────────────────────────
@dataclass(frozen=True)
class Entry:
    player: str
    character: str

# ── Power-of-two helpers ──────────────────────────────────────────────────────
def next_power_of_two(n):
    if n <= 1: return 1
    return 1 << (n - 1).bit_length()

def byes_needed(n):
    return max(0, next_power_of_two(n) - n)

# ── Icons & colors ─────────────────────────────────────────────────────────────
ICON_DIR = os.path.join(os.path.dirname(__file__), "images")

def get_character_icon_url(char_name: str) -> Optional[str]:
    if not char_name:
        return None
    fname = f"{char_name.title().replace(' ', '_')}.png"
    path = os.path.join(ICON_DIR, fname)
    if os.path.exists(path):
        return f"./app/static/images/{fname}"
    return None

TEAM_COLOR_FALLBACKS = ["#E91E63","#3F51B5","#009688","#FF9800","#9C27B0","#4CAF50","#2196F3","#FF5722","#795548","#607D8B"]
PLAYER_FALLBACKS     = ["#FF6F61","#6B5B95","#88B04B","#F7CAC9","#92A8D1","#955251","#B565A7","#009B77","#DD4124","#45B8AC"]

def render_name_html(player, team_of, team_colors):
    t = team_of.get(player, "")
    color = team_colors.get(t) if t and team_colors.get(t) else \
        st.session_state.player_colors.setdefault(
            player, PLAYER_FALLBACKS[len(st.session_state.player_colors) % len(PLAYER_FALLBACKS)]
        )
    safe = player.replace("<","&lt;").replace(">","&gt;")
    return f"<span style='color:{color};font-weight:600'>{safe}</span>"

def render_entry_line(e, team_of, team_colors):
    if e is None: return "<div class='name-line tbd'>TBD</div>"
    if e.character.upper() == "BYE": return "<div class='name-line tbd'>BYE</div>"
    icon = get_character_icon_url(e.character)
    name_html = render_name_html(e.player, team_of, team_colors)
    char_safe = e.character.replace("<","&lt;").replace(">","&gt;")
    if icon:
        return f"<div class='name-line'><img src='{icon}' width='24'/> <b>{char_safe}</b> ({name_html})</div>"
    return f"<div class='name-line'><b>{char_safe}</b> ({name_html})</div>"

def entry_to_label(e):
    return f"{e.player} — {e.character}" if e else ""

# ── All bracket/game logic (unchanged from original) ─────────────────────────
def split_half(seq):
    mid = (len(seq) + 1) // 2
    return seq[:mid], seq[mid:]

def build_player_character_map(entries, df):
    order_map = {}
    if df is not None and "Player" in df.columns and "Character" in df.columns:
        for _, row in df.iterrows():
            p = str(row.get("Player","")).strip()
            c = str(row.get("Character","")).strip()
            if p and c:
                order_map.setdefault(p,[]).append(c)
    else:
        for e in entries:
            order_map.setdefault(e.player,[]).append(e.character)
    for p, chars in order_map.items():
        seen, deduped = set(), []
        for c in chars:
            if c not in seen:
                seen.add(c); deduped.append(c)
        order_map[p] = deduped
    return order_map

def categorize_entries_ABC(entries, player_order_final, df_table):
    player_chars = build_player_character_map(entries, df_table)
    present_players = [p for p in player_order_final if p in player_chars] or sorted(player_chars)
    top_players, bottom_players = split_half(present_players)
    top_set, bottom_set = set(top_players), set(bottom_players)
    cat = {}
    for e in entries:
        chars = player_chars.get(e.player, [])
        top_chars, _ = split_half(chars)
        if e.player in top_set:
            cat[e] = "A" if e.character in top_chars else "B"
        elif e.player in bottom_set:
            cat[e] = "B" if e.character in top_chars else "C"
        else:
            cat[e] = "B" if e.character in top_chars else "C"
    return cat

def generate_bracket_hierarchical_weighted(entries, *, team_mode=False, team_of=None, df_table=None, player_order_final=None, max_attempts=200):
    team_of = team_of or {}
    base = [e for e in entries if e.player != "SYSTEM" and e.character.strip()]
    if len(base) < 2: return []
    bye_entry = Entry("SYSTEM","BYE")
    byes_budget = byes_needed(len(base))
    target = next_power_of_two(len(base))
    target_pairs = target // 2
    final_order = player_order_final or sorted({e.player for e in base})
    cat_map = categorize_entries_ABC(base, final_order, df_table if df_table is not None else pd.DataFrame())

    def allowed(a, b):
        if a.player == b.player: return False
        if team_mode:
            ta, tb = team_of.get(a.player,""), team_of.get(b.player,"")
            if ta and tb and ta == tb: return False
        return True

    def weighted_second_pick(first, candidates):
        if not candidates: return None
        first_cat = cat_map.get(first,"B")
        weights = [0.4 if cat_map.get(c,"B") == first_cat else 0.2 for c in candidates]
        return random.choices(candidates, weights=weights, k=1)[0]

    best, best_score = [], (-1, -10**9)
    for _ in range(max_attempts):
        remaining = base.copy(); random.shuffle(remaining)
        pairs = []; byes_left = byes_budget
        while byes_left > 0 and remaining:
            pairs.append((remaining.pop(), bye_entry)); byes_left -= 1
        stuck = 0
        while len(remaining) >= 2 and len(pairs) < target_pairs:
            stuck += 1
            if stuck > 5000: break
            first = random.choice(remaining); remaining.remove(first)
            candidates = [x for x in remaining if allowed(first, x)]
            if not candidates: remaining.append(first); random.shuffle(remaining); continue
            second = weighted_second_pick(first, candidates)
            if second is None: remaining.append(first); random.shuffle(remaining); continue
            remaining.remove(second); pairs.append((first, second))
        non_bye = sum(1 for a,b in pairs if a.character.upper()!="BYE" and b.character.upper()!="BYE")
        score = (non_bye, -len(remaining))
        if score > best_score: best_score = score; best = pairs
        if len(best) == target_pairs and not remaining: return best
    return best

def generate_bracket_regular(entries, df_table, player_order_final):
    return generate_bracket_hierarchical_weighted(entries, team_mode=False, df_table=df_table, player_order_final=player_order_final)

def generate_bracket_teams(entries, team_of, df_table, player_order_final):
    return generate_bracket_hierarchical_weighted(entries, team_mode=True, team_of=team_of, df_table=df_table, player_order_final=player_order_final)

# ── Round Robin page ──────────────────────────────────────────────────────────
def show_round_robin_page(players):
    if not players:
        st.warning("Add players in the sidebar first.")
        return

    if "rr_schedule" not in st.session_state:
        st.session_state["rr_schedule"] = None

    filtered = [p for p in players if p.strip().upper() != "BYE"]
    if len(filtered) < 2:
        st.warning("Need at least 2 players (excluding BYE).")
        return

    if st.button("🗓️ Generate Round Robin Schedule", type="primary"):
        schedule = [(filtered[i], filtered[j]) for i in range(len(filtered)) for j in range(i+1, len(filtered))]
        random.shuffle(schedule)
        st.session_state["rr_schedule"] = schedule
        st.session_state["rr_results"] = {}
        st.session_state["rr_records"] = {p: {"Wins":0,"Losses":0} for p in filtered}

    schedule = st.session_state.get("rr_schedule")
    if not schedule:
        st.info("Click the button above to generate a schedule.")
        return

    records = {p: {"Wins":0,"Losses":0} for p in filtered}
    for i, (p1, p2) in enumerate(schedule, start=1):
        mid = f"{i}_{p1}_vs_{p2}"
        winner = st.session_state.rr_results.get(mid,"")
        if winner == p1: records[p1]["Wins"] += 1; records[p2]["Losses"] += 1
        elif winner == p2: records[p2]["Wins"] += 1; records[p1]["Losses"] += 1
    st.session_state.rr_records = records

    st.subheader("📋 Matches")
    cols = st.columns(2)
    for i, (p1, p2) in enumerate(schedule, start=1):
        mid = f"{i}_{p1}_vs_{p2}"
        options = [p1, p2, "(undecided)"]
        prev = st.session_state.rr_results.get(mid,"")
        try: idx = options.index(prev)
        except ValueError: idx = 2
        with cols[(i-1) % 2]:
            st.markdown(f"**Match {i}:** **{p1}** vs **{p2}**")
            winner = st.radio(f"Winner (Match {i})", options=options, index=idx, key=f"rr_winner_{mid}", horizontal=True, label_visibility="collapsed")
            st.session_state.rr_results[mid] = winner

    st.markdown("---")
    st.subheader("🏆 Leaderboard")
    records_df = pd.DataFrame.from_dict(st.session_state.rr_records, orient="index")
    if not records_df.empty:
        records_df.reset_index(names=["Player"], inplace=True)
        records_df["Win Rate"] = records_df.apply(lambda r: r["Wins"]/(r["Wins"]+r["Losses"]) if (r["Wins"]+r["Losses"])>0 else 0, axis=1)
        records_df.sort_values(by=["Wins","Losses","Player"], ascending=[False,True,True], inplace=True)
        records_df.index = range(1, len(records_df)+1)
        st.dataframe(records_df, use_container_width=True, column_config={
            "Win Rate": st.column_config.ProgressColumn("Win Rate", format="%.0%", min_value=0, max_value=1)
        })

    if st.session_state.get("auth_token"):
        st.markdown("---")
        with st.expander("💾 Save this session to your account"):
            rr_name = st.text_input("Session name", placeholder="Friday Night RR #3", key="rr_save_name")
            if st.button("Save Round Robin Session"):
                if not rr_name.strip():
                    st.warning("Enter a name first.")
                else:
                    result = api_post("/roundrobin", {
                        "name": rr_name,
                        "players": filtered,
                        "results": st.session_state.rr_results,
                        "records": st.session_state.rr_records,
                    })
                    if result:
                        st.success(f"Saved as '{rr_name}'!")

    st.markdown("---")
    if st.button("🔄 Reset Round Robin"):
        st.session_state["rr_results"] = {}
        st.session_state["rr_records"] = {p: {"Wins":0,"Losses":0} for p in filtered}
        st.session_state.pop("rr_schedule", None)
        st.rerun()


# ── Tier List page ────────────────────────────────────────────────────────────
def _init_tier_ranking(saved: Optional[dict] = None) -> dict:
    """Build a fresh tier ranking dict, optionally from a saved one."""
    if saved:
        # Make sure all roster chars are present (handles new DLC added later)
        all_placed = {c for tier_chars in saved.values() for c in tier_chars}
        missing = [c for c in SMASH_ULTIMATE_ROSTER if c not in all_placed]
        result = {t: list(saved.get(t, [])) for t in TIERS}
        result["unranked"] = list(saved.get("unranked", [])) + missing
        return result
    return {t: [] for t in TIERS} | {"unranked": list(SMASH_ULTIMATE_ROSTER)}

def show_tier_list_page():
    st.title("🎖️ My Smash Ultimate Tier List")
    st.caption("Rank all 89 fighters. Changes are saved to your account.")

    # Load saved ranking from backend on first visit
    if st.session_state.tier_ranking is None:
        data = api_get("/characters/ranking")
        if data and data.get("ranking"):
            st.session_state.tier_ranking = _init_tier_ranking(data["ranking"])
            if data.get("updated_at"):
                st.caption(f"Last saved: {data['updated_at'][:16].replace('T',' ')} UTC")
        else:
            st.session_state.tier_ranking = _init_tier_ranking()

    ranking = st.session_state.tier_ranking

    # ── Controls row ─────────────────────────────────────────────────────────
    col_save, col_reset, col_search = st.columns([1, 1, 2])
    with col_save:
        if st.button("💾 Save Tier List", type="primary", use_container_width=True):
            result = api_put("/characters/ranking", {"ranking": ranking})
            if result:
                st.success("Saved!")
                st.session_state.tier_dirty = False
    with col_reset:
        if st.button("🗑️ Reset All", use_container_width=True):
            st.session_state.tier_ranking = _init_tier_ranking()
            st.session_state.tier_dirty = True
            st.rerun()
    with col_search:
        search_q = st.text_input("🔍 Filter characters", placeholder="Type a name…", key="tier_search", label_visibility="collapsed")

    if st.session_state.tier_dirty:
        st.info("⚠️ You have unsaved changes.")

    st.markdown("---")

    # ── Tier rows ─────────────────────────────────────────────────────────────
    # Each tier: show a colored header + multiselect to add chars,
    # and a way to move chars back to unranked.
    for tier in TIERS:
        color   = TIER_COLORS[tier]
        chars   = ranking[tier]
        if search_q:
            chars = [c for c in chars if search_q.lower() in c.lower()]

        with st.container():
            hcol, ccol = st.columns([1, 11])
            with hcol:
                st.markdown(
                    f"<div style='background:{color};color:#111;font-weight:900;"
                    f"font-size:22px;text-align:center;border-radius:8px;padding:8px 0;"
                    f"min-height:44px;line-height:44px'>{tier}</div>",
                    unsafe_allow_html=True
                )
            with ccol:
                if chars:
                    badges = " ".join(
                        f"<span class='tier-char' style='border-left:3px solid {color}'>{c}</span>"
                        for c in chars
                    )
                    st.markdown(f"<div style='display:flex;flex-wrap:wrap;gap:4px;padding:4px 0'>{badges}</div>",
                                unsafe_allow_html=True)
                else:
                    st.caption("— empty —")

        # Move chars out of this tier → unranked
        if ranking[tier]:
            remove_from = st.multiselect(
                f"Remove from {tier}",
                options=ranking[tier],
                key=f"remove_{tier}",
                label_visibility="collapsed",
                placeholder=f"Select to remove from {tier}…"
            )
            if remove_from:
                for c in remove_from:
                    ranking[tier].remove(c)
                    ranking["unranked"].append(c)
                st.session_state.tier_dirty = True
                st.rerun()

    # ── Unranked pool ─────────────────────────────────────────────────────────
    st.markdown("---")
    st.subheader(f"📦 Unranked ({len(ranking['unranked'])} fighters)")

    unranked_display = ranking["unranked"]
    if search_q:
        unranked_display = [c for c in unranked_display if search_q.lower() in c.lower()]

    if unranked_display:
        # Show in a compact grid and allow assigning to a tier
        assign_col, tier_col, btn_col = st.columns([3, 1, 1])
        with assign_col:
            to_assign = st.multiselect(
                "Select fighters to rank",
                options=unranked_display,
                key="assign_chars",
                label_visibility="collapsed",
                placeholder="Pick fighters to place in a tier…"
            )
        with tier_col:
            dest_tier = st.selectbox("Tier", TIERS, key="assign_dest_tier", label_visibility="collapsed")
        with btn_col:
            if st.button("➕ Add to tier", use_container_width=True):
                if to_assign:
                    for c in to_assign:
                        if c in ranking["unranked"]:
                            ranking["unranked"].remove(c)
                            ranking[dest_tier].append(c)
                    st.session_state.tier_dirty = True
                    st.rerun()

        # Compact badge display of all unranked
        st.markdown(
            "<div style='display:flex;flex-wrap:wrap;gap:4px;margin-top:6px'>"
            + "".join(f"<span class='tier-char'>{c}</span>" for c in unranked_display)
            + "</div>",
            unsafe_allow_html=True
        )
    else:
        st.success("🎉 All fighters ranked!")

    # ── View another user's tier list ─────────────────────────────────────────
    st.markdown("---")
    st.subheader("👀 View someone else's tier list")
    vcol1, vcol2 = st.columns([3, 1])
    with vcol1:
        view_user = st.text_input("Username", key="view_tier_user", label_visibility="collapsed", placeholder="Enter a username…")
    with vcol2:
        if st.button("View", use_container_width=True) and view_user.strip():
            data = api_get(f"/characters/ranking/{view_user.strip()}")
            if data:
                st.session_state["viewed_tier"] = data

    if st.session_state.get("viewed_tier"):
        vd = st.session_state["viewed_tier"]
        st.markdown(f"### {vd['username']}'s tier list")
        for tier in TIERS:
            chars = vd["ranking"].get(tier, [])
            if not chars:
                continue
            color = TIER_COLORS[tier]
            badges = " ".join(f"<span class='tier-char' style='border-left:3px solid {color}'>{c}</span>" for c in chars)
            st.markdown(
                f"<div style='display:flex;align-items:center;gap:8px;margin-bottom:4px'>"
                f"<span style='background:{color};color:#111;font-weight:900;font-size:18px;"
                f"border-radius:6px;padding:4px 10px'>{tier}</span>"
                f"<div style='display:flex;flex-wrap:wrap;gap:4px'>{badges}</div></div>",
                unsafe_allow_html=True
            )


# ── Tournament Invites page ───────────────────────────────────────────────────
def show_invites_page():
    st.title("📬 Tournament Invites")

    tab_recv, tab_sent, tab_manage = st.tabs(["📥 Received", "📤 Sent", "➕ Send New Invite"])

    # ── Received invites ──────────────────────────────────────────────────────
    with tab_recv:
        st.subheader("Invites sent to you")
        data = api_get("/invites/received")
        if not data:
            st.info("No invites yet.")
        else:
            pending = [i for i in data if i["status"] == "pending"]
            other   = [i for i in data if i["status"] != "pending"]

            if pending:
                st.markdown("**Pending**")
                for inv in pending:
                    c1, c2, c3 = st.columns([4, 1, 1])
                    with c1:
                        st.markdown(
                            f"**{inv['bracket_name']}** · from **{inv['inviter']}** "
                            f"· {inv['created_at'][:10]}"
                        )
                    with c2:
                        if st.button("✅ Accept", key=f"acc_{inv['id']}"):
                            if api_patch(f"/invites/{inv['id']}", {"status": "accepted"}):
                                st.rerun()
                    with c3:
                        if st.button("❌ Decline", key=f"dec_{inv['id']}"):
                            if api_patch(f"/invites/{inv['id']}", {"status": "declined"}):
                                st.rerun()

            if other:
                st.markdown("**Past invites**")
                for inv in other:
                    status_icon = "✅" if inv["status"] == "accepted" else "❌"
                    st.markdown(
                        f"{status_icon} **{inv['bracket_name']}** · from **{inv['inviter']}** "
                        f"· {inv['status']} · {inv['created_at'][:10]}"
                    )

    # ── Sent invites ──────────────────────────────────────────────────────────
    with tab_sent:
        st.subheader("Invites you've sent")
        data = api_get("/invites/sent")
        if not data:
            st.info("You haven't sent any invites yet.")
        else:
            for inv in data:
                status_icon = {"pending": "⏳", "accepted": "✅", "declined": "❌"}.get(inv["status"], "?")
                c1, c2 = st.columns([5, 1])
                with c1:
                    st.markdown(
                        f"{status_icon} **{inv['bracket_name']}** → **{inv['invitee']}** "
                        f"· {inv['status']} · {inv['created_at'][:10]}"
                    )
                with c2:
                    if inv["status"] == "pending":
                        if st.button("Cancel", key=f"cancel_inv_{inv['id']}"):
                            if api_delete(f"/invites/{inv['id']}"):
                                st.rerun()

    # ── Send new invite ───────────────────────────────────────────────────────
    with tab_manage:
        st.subheader("Invite someone to one of your brackets")

        brackets = api_get("/brackets")
        if not brackets:
            st.info("Save a bracket first, then you can invite people to it.")
        else:
            bracket_options = {f"{b['name']} (#{b['id']})": b["id"] for b in brackets}
            selected_bracket_label = st.selectbox("Choose a bracket", list(bracket_options.keys()))
            selected_bracket_id    = bracket_options[selected_bracket_label]

            st.markdown("**Search for a user to invite:**")
            inv_search = st.text_input("Username search", key="inv_search", placeholder="Start typing a username…", label_visibility="collapsed")

            matches = []
            if inv_search.strip():
                matches = search_users(inv_search.strip())

            if matches:
                chosen = st.selectbox("Select user", matches, key="inv_chosen")
                if st.button(f"📨 Invite {chosen}", type="primary"):
                    result = api_post("/invites", {
                        "bracket_id": selected_bracket_id,
                        "invitee_username": chosen,
                    })
                    if result:
                        st.success(f"Invite sent to **{chosen}** for **{selected_bracket_label}**!")
            elif inv_search.strip():
                st.caption("No users found with that name.")

            # Show existing invites for the selected bracket
            st.markdown("---")
            st.markdown(f"**Existing invites for this bracket:**")
            inv_data = api_get(f"/invites/bracket/{selected_bracket_id}")
            if inv_data:
                for inv in inv_data:
                    status_icon = {"pending": "⏳", "accepted": "✅", "declined": "❌"}.get(inv["status"], "?")
                    st.markdown(f"{status_icon} **{inv['invitee']}** · {inv['status']} · {inv['created_at'][:10]}")
            else:
                st.caption("No invites sent for this bracket yet.")


# ── Pending invite badge count ────────────────────────────────────────────────
def get_pending_invite_count() -> int:
    if not st.session_state.get("auth_token"):
        return 0
    data = api_get("/invites/received")
    if not data:
        return 0
    return sum(1 for i in data if i["status"] == "pending")


# ── Sidebar ───────────────────────────────────────────────────────────────────
with st.sidebar:
    st.header("👤 Account")

    if st.session_state.auth_token:
        st.success(f"Logged in as **{st.session_state.username}**")
        if st.button("Log out"):
            st.session_state.auth_token = None
            st.session_state.username = None
            st.session_state.tier_ranking = None
            st.rerun()
    else:
        auth_tab = st.radio("", ["Log in", "Sign up"], horizontal=True, label_visibility="collapsed")
        uname = st.text_input("Username", key="auth_uname")
        pwd   = st.text_input("Password", type="password", key="auth_pwd")

        if auth_tab == "Log in":
            if st.button("Log in", use_container_width=True):
                resp = api_post_form("/auth/login", {"username": uname, "password": pwd})
                if resp:
                    st.session_state.auth_token = resp["access_token"]
                    st.session_state.username = uname
                    st.session_state.tier_ranking = None  # will reload
                    st.rerun()
        else:
            if st.button("Create account", use_container_width=True):
                resp = api_post("/auth/register", {"username": uname, "password": pwd}, auth=False)
                if resp:
                    st.success("Account created! Log in above.")

    st.divider()

    # ── Navigation ─────────────────────────────────────────────────────────────
    st.header("Navigation")
    nav_options = ["Bracket Generator", "Round Robin"]
    if st.session_state.auth_token:
        # Show pending invite count in the label
        pending_count = get_pending_invite_count()
        invite_label  = f"📬 Invites ({pending_count} pending)" if pending_count else "📬 Invites"
        nav_options += [
            "My Brackets",
            "My RR Sessions",
            "🎖️ My Tier List",
            invite_label,
            "🌍 Global Leaderboard",
        ]

    # Normalize the page key to handle the dynamic invite label
    current_page = st.session_state.page
    if current_page.startswith("📬 Invites"):
        current_page = next((o for o in nav_options if o.startswith("📬 Invites")), nav_options[0])

    selected_page = st.radio(
        "Switch View",
        options=nav_options,
        index=nav_options.index(current_page) if current_page in nav_options else 0,
        key="page_radio"
    )
    st.session_state.page = selected_page
    st.divider()

    # ── Game-mode settings ─────────────────────────────────────────────────────
    default_players = st.session_state.players_multiline

    if st.session_state.page == "Bracket Generator":
        st.header("Rule Set")
        rule = st.selectbox("Choose mode", ["regular","teams"], key="rule_select")
        st.divider()
        st.header("Players")
        players_input = st.text_area("One name per line", value=default_players, height=130, key="players_multiline")
        players = [p.strip() for p in players_input.splitlines() if p.strip()]

        st.divider()
        st.header("Phase 1: Player Order")
        if set(st.session_state.player_order_drawn) != set(players):
            st.session_state.player_order_drawn = []
            st.session_state.player_order_final = []

        c1, c2 = st.columns(2)
        with c1:
            if st.button("🎲 Random Draw", use_container_width=True):
                o = players.copy(); random.shuffle(o)
                st.session_state.player_order_drawn = o
                st.session_state.player_order_final = o.copy()
        with c2:
            if st.button("↩️ Use Drawn", use_container_width=True):
                if st.session_state.player_order_drawn:
                    st.session_state.player_order_final = st.session_state.player_order_drawn.copy()

        drawn = st.session_state.player_order_drawn or players
        final_default = st.session_state.player_order_final or drawn
        st.caption("Manual Override (Rank 1 = strongest):")
        new_final = []
        for i in range(len(players)):
            options = [p for p in players if p not in new_final]
            default_choice = final_default[i] if i < len(final_default) else (options[0] if options else "")
            if default_choice not in options and options: default_choice = options[0]
            pick = st.selectbox(f"Rank {i+1}", options=options or [default_choice],
                index=options.index(default_choice) if default_choice in options else 0, key=f"rank_pick_{i}")
            new_final.append(pick)
        st.session_state.player_order_final = new_final

        team_of, team_colors = {}, {}
        if rule == "teams":
            st.divider(); st.header("Teams & Colors")
            team_names_input = st.text_input("Team labels (comma separated)", value="Red, Blue", key="team_names_input")
            team_labels = [t.strip() for t in team_names_input.split(",") if t.strip()] or ["Team A","Team B"]
            for i, t in enumerate(team_labels):
                team_colors[t] = st.color_picker(f"{t} color", value=TEAM_COLOR_FALLBACKS[i % len(TEAM_COLOR_FALLBACKS)], key=f"tc_{t}")
            for p in players:
                team_of[p] = st.selectbox(f"{p}", options=["(none)"]+team_labels, key=f"team_{p}")
            team_of = {p:(t if t!="(none)" else "") for p,t in team_of.items()}
            st.divider()

        st.header("Characters per player")
        chars_per_person = st.number_input("How many per player?", min_value=1, max_value=50, value=2, step=1, key="chars_pp")
        st.divider()
        st.subheader("Build / Fill")
        build_clicked = st.button("⚙️ Auto-Create/Reset Entries", use_container_width=True)
        shuffle_within_player = st.checkbox("Shuffle names when auto-filling", value=True)
        auto_fill_clicked = st.button("🎲 Auto-fill Characters", use_container_width=True)
        st.divider()
        st.header("General")
        clean_rows = st.checkbox("Remove empty rows", value=True)

    elif st.session_state.page == "Round Robin":
        st.header("Players")
        players_input = st.text_area("One name per line", value=default_players, height=130, key="players_multiline")
        players = [p.strip() for p in players_input.splitlines() if p.strip()]
        rule, team_of, team_colors, chars_per_person = "regular", {}, {}, 1
        build_clicked = shuffle_within_player = auto_fill_clicked = clean_rows = False

    else:
        players = []
        rule, team_of, team_colors, chars_per_person = "regular", {}, {}, 1
        build_clicked = shuffle_within_player = auto_fill_clicked = clean_rows = False

    st.session_state.players_list = players

# ── Main content ──────────────────────────────────────────────────────────────
players = st.session_state.players_list
page    = st.session_state.page

if page == "Bracket Generator":
    st.title("🎮 Smash Bracket — Regular & Teams")

    def build_entries_df(players, k):
        return pd.DataFrame([{"Player": p, "Character": ""} for _ in range(k) for p in players])

    def auto_fill_characters(df, players, k, shuffle_each):
        out = df.copy()
        for p in players:
            idxs = list(out.index[out["Player"] == p])
            labels = [f"Character {i+1}" for i in range(len(idxs))]
            if shuffle_each: random.shuffle(labels)
            for ri, label in zip(idxs, labels):
                out.at[ri, "Character"] = label
        return out

    def df_to_entries(df, clean_rows_flag):
        out = []
        for _, row in df.iterrows():
            pl = str(row.get("Player","")).strip()
            ch = str(row.get("Character","")).strip()
            if clean_rows_flag and (not pl or not ch): continue
            if pl and ch: out.append(Entry(player=pl, character=ch))
        return out

    if "table_df" not in st.session_state:
        st.session_state.table_df = pd.DataFrame([
            {"Player":"You","Character":"Mario"},{"Player":"You","Character":"Link"},
            {"Player":"Friend1","Character":"Kirby"},{"Player":"Friend1","Character":"Fox"},
            {"Player":"Friend2","Character":"Samus"},
        ])

    if build_clicked:
        if not players: st.warning("Add players first.")
        else: st.session_state.table_df = build_entries_df(players, int(chars_per_person))
    if auto_fill_clicked:
        if not players: st.warning("Add players first.")
        else: st.session_state.table_df = auto_fill_characters(st.session_state.table_df, players, int(chars_per_person), shuffle_within_player)
    if players:
        st.session_state.table_df["Player"] = st.session_state.table_df["Player"].apply(
            lambda p: p if p in players else (players[0] if p=="" else p))

    st.subheader("Entries")
    table_df = st.data_editor(st.session_state.table_df, num_rows="dynamic", use_container_width=True,
        column_config={
            "Player": st.column_config.SelectboxColumn("Player", options=players or [], required=True),
            "Character": st.column_config.TextColumn(required=True),
        }, key="table_editor")
    entries = df_to_entries(table_df, clean_rows_flag=clean_rows)

    def compute_rounds_pairs(r1_pairs, winners_map):
        rounds = [list(r1_pairs)]
        total_real = sum(1 for a,b in r1_pairs for e in (a,b) if e and e.player!="SYSTEM")
        target = next_power_of_two(total_real)
        num_rounds = int(math.log2(target)) if target >= 2 else 1
        prev = rounds[0]

        def winner_of(idx, pairs_list):
            if idx >= len(pairs_list): return None
            a, b = pairs_list[idx]
            if a is None and b is None: return None
            if a is None: return b if (b and b.character.upper()!="BYE") else None
            if b is None: return a if (a and a.character.upper()!="BYE") else None
            if a.character.upper()=="BYE" and b.character.upper()!="BYE": return b
            if b.character.upper()=="BYE" and a.character.upper()!="BYE": return a
            la, lb = entry_to_label(a), entry_to_label(b)
            sel = winners_map.get(idx+1,"")
            return a if sel==la else (b if sel==lb else None)

        for _ in range(1, num_rounds):
            nxt = [(winner_of(i,prev), winner_of(i+1,prev)) for i in range(0,len(prev),2)]
            rounds.append(nxt); prev = nxt
        return rounds

    def render_bracket_grid(all_rounds, team_of, team_colors):
        cols = st.columns(len(all_rounds))
        for ri, round_pairs in enumerate(all_rounds):
            with cols[ri]:
                st.markdown(f"<div class='round-title'>Round {ri+1}</div>", unsafe_allow_html=True)
                for a,b in round_pairs:
                    st.markdown("<div class='match-box'>" + render_entry_line(a,team_of,team_colors) + render_entry_line(b,team_of,team_colors) + "</div>", unsafe_allow_html=True)

    def r1_winner_controls(r1_pairs):
        if "r1_winners" not in st.session_state: st.session_state.r1_winners = {}
        st.write("### Pick Round 1 Winners")
        for i,(a,b) in enumerate(r1_pairs, start=1):
            la, lb = entry_to_label(a), entry_to_label(b)
            prev = st.session_state.r1_winners.get(i,"")
            idx = 0 if prev==la else (1 if prev==lb else 2)
            choice = st.radio(f"Match {i}", [la,lb,"(undecided)"], index=idx, key=f"winner_{i}", horizontal=True)
            st.session_state.r1_winners[i] = choice if choice!="(undecided)" else ""

    st.divider()
    col_gen, col_clear = st.columns([2,1])
    with col_gen:
        if st.button("🎲 Generate Bracket", type="primary"):
            if len(entries) < 2:
                st.error("Add at least 2 entries.")
            else:
                final_order = st.session_state.player_order_final or players
                bracket = generate_bracket_regular(entries, table_df, final_order) if rule=="regular" \
                    else generate_bracket_teams(entries, team_of, table_df, final_order)
                if not bracket:
                    st.error("Couldn't build a valid bracket with those constraints.")
                else:
                    total_real = len([e for e in entries if e.player!="SYSTEM"])
                    target = next_power_of_two(total_real)
                    st.success(f"Entries: {total_real} → Target: {target} (BYEs: {target-total_real}) — Mode: {rule}")
                    st.session_state["last_bracket"]     = [(a,b) for (a,b) in bracket]
                    st.session_state["last_rule"]        = rule
                    st.session_state["last_team_of"]     = team_of if rule=="teams" else {}
                    st.session_state["last_team_colors"] = team_colors if rule=="teams" else {}

    if st.session_state.get("last_bracket"):
        r1_pairs = st.session_state["last_bracket"]
        r1_winner_controls(r1_pairs)
        rounds = compute_rounds_pairs(r1_pairs, st.session_state.get("r1_winners",{}))
        render_bracket_grid(rounds, st.session_state.get("last_team_of",{}), st.session_state.get("last_team_colors",{}))

        if st.session_state.get("auth_token"):
            st.markdown("---")
            with st.expander("💾 Save this bracket to your account"):
                bname = st.text_input("Bracket name", placeholder="Friday Night S3", key="bracket_save_name")
                if st.button("Save Bracket"):
                    if not bname.strip():
                        st.warning("Enter a name first.")
                    else:
                        result = api_post("/brackets", {
                            "name": bname,
                            "mode": st.session_state["last_rule"],
                            "players": players,
                            "entries": [{"player":e.player,"character":e.character} for e in entries],
                            "bracket_data": [{"a": entry_to_label(a), "b": entry_to_label(b)} for a,b in r1_pairs],
                        })
                        if result:
                            st.success(f"Saved as '{bname}'!")

    with col_clear:
        if st.button("🧹 Clear Table"):
            st.session_state.table_df = pd.DataFrame(columns=["Player","Character"])
            st.session_state.pop("last_bracket", None)
            st.session_state.pop("r1_winners", None)
            st.rerun()

elif page == "Round Robin":
    st.title("🗂️ Round Robin Scheduler & Leaderboard")
    show_round_robin_page(players)

elif page == "My Brackets":
    st.title("📁 My Saved Brackets")
    data = api_get("/brackets")
    if data:
        for b in data:
            col1, col2 = st.columns([4,1])
            with col1:
                st.markdown(f"**{b['name']}** — mode: `{b['mode']}` | winner: {b.get('winner') or '—'} | {b['created_at'][:10]}")
            with col2:
                if st.button("🗑️ Delete", key=f"del_b_{b['id']}"):
                    if api_delete(f"/brackets/{b['id']}"):
                        st.rerun()
    elif data == []:
        st.info("No saved brackets yet. Generate and save one in the Bracket Generator.")

elif page == "My RR Sessions":
    st.title("📁 My Round Robin Sessions")
    data = api_get("/roundrobin")
    if data:
        for r in data:
            st.markdown(f"**{r['name']}** — {r['created_at'][:10]}")
            if st.button("View", key=f"view_rr_{r['id']}"):
                detail = api_get(f"/roundrobin/{r['id']}")
                if detail:
                    df = pd.DataFrame.from_dict(detail["records"], orient="index")
                    df.reset_index(names=["Player"], inplace=True)
                    st.dataframe(df, use_container_width=True)
    elif data == []:
        st.info("No saved RR sessions yet.")

elif page.startswith("📬 Invites"):
    show_invites_page()

elif page == "🎖️ My Tier List":
    show_tier_list_page()

elif page == "🌍 Global Leaderboard":
    st.title("🌍 Global Leaderboard")
    data = api_get("/leaderboard")
    if data:
        df = pd.DataFrame(data)
        df.index = range(1, len(df)+1)
        st.dataframe(df, use_container_width=True, column_config={
            "wins":    st.column_config.NumberColumn("Wins"),
            "losses":  st.column_config.NumberColumn("Losses"),
            "sessions": st.column_config.NumberColumn("Sessions Played"),
        })
    else:
        st.info("No leaderboard data yet.")
