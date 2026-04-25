from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import or_, func
from pydantic import BaseModel
from datetime import datetime

from database import User, Bracket, CharacterStats, MatchResult, ProfileComment
from auth import get_db, get_current_user

router = APIRouter(tags=["users"])


class AvatarUpdate(BaseModel):
    avatar_url: str


class CommentCreate(BaseModel):
    content: str


class FeaturedBadgeUpdate(BaseModel):
    badge_id: str  # e.g. "char_Joker" or "" to clear


@router.get("/users/me")
def get_me(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    current_user.last_seen = datetime.utcnow()
    db.commit()
    return {"id": current_user.id, "username": current_user.username, "avatar_url": current_user.avatar_url,
            "featured_badge": current_user.featured_badge}


@router.put("/users/me/avatar")
def update_avatar(req: AvatarUpdate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    current_user.avatar_url = req.avatar_url or None
    db.commit()
    return {"ok": True}


@router.patch("/users/me/featured-badge")
def set_featured_badge(req: FeaturedBadgeUpdate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    current_user.featured_badge = req.badge_id.strip() or None
    db.commit()
    return {"ok": True}


@router.get("/users/all")
def all_users(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    users = db.query(User).order_by(User.username).all()
    return [{"id": u.id, "username": u.username, "avatar_url": u.avatar_url} for u in users]


@router.get("/users/badges/all")
def all_user_badges(db: Session = Depends(get_db), _cu: User = Depends(get_current_user)):
    """Batch: returns {username: display_badge} for every user. Respects featured_badge."""
    PRIORITY = [
        'tourney_king','flawless_run','demon_slayer','finisher','punching_bag',
        'executioner','clutch_factor','the_wall','unstoppable','serial_champ',
        'champion','bronze_bomber','silver_lining','top3','char_legend',
        'roster_master','old_reliable','jack_of_all','veteran','tax_collector',
        'consistent','allrounder','specialist','pacifist','sacrificer',
    ]

    all_users_list = db.query(User).all()
    username_to_uid = {u.username: u.id for u in all_users_list}

    # ── All CharacterStats (one query) ───────────────────────────────────────
    all_cs = db.query(CharacterStats).all()
    stats_by_user: dict = {}       # uid -> [stats with points > 0]
    all_stats_by_user: dict = {}   # uid -> [all stats]
    for s in all_cs:
        all_stats_by_user.setdefault(s.user_id, []).append(s)
        if s.points > 0:
            stats_by_user.setdefault(s.user_id, []).append(s)

    # Points leader per character → Roster Master
    char_pts_leader: dict = {}
    for s in all_cs:
        if s.points > 0:
            prev = char_pts_leader.get(s.character)
            if prev is None or s.points > prev[1]:
                char_pts_leader[s.character] = (s.user_id, s.points)
    roster_master_count: dict = {}
    for _, (uid, _) in char_pts_leader.items():
        roster_master_count[uid] = roster_master_count.get(uid, 0) + 1

    # ── Tournament wins ──────────────────────────────────────────────────────
    t_rows = (db.query(Bracket.winner, func.count(Bracket.id).label("cnt"))
              .filter(Bracket.winner.isnot(None), Bracket.winner != "")
              .group_by(Bracket.winner).all())
    tourney_wins = {r.winner: r.cnt for r in t_rows}
    top_tourney = max(tourney_wins, key=tourney_wins.get) if tourney_wins else None

    # ── Completed brackets → placement + flawless + executioner ─────────────
    completed_brackets = (db.query(Bracket)
                          .filter(Bracket.winner.isnot(None), Bracket.winner != "")
                          .order_by(Bracket.created_at).all())
    placement_counts: dict = {}  # username -> {"2nd": n, "3rd": n}
    for b in completed_brackets:
        for place in ("2nd", "3rd"):
            info = (b.placements or {}).get(place)
            items = info if isinstance(info, list) else ([info] if isinstance(info, dict) else [])
            for item in items:
                uname = (item or {}).get("player", "")
                if uname:
                    placement_counts.setdefault(uname, {"2nd": 0, "3rd": 0})[place] += 1

    # ── All MatchResults (one query) ─────────────────────────────────────────
    all_matches = db.query(MatchResult).all()
    match_counts: dict = {}
    tsg: dict = {}
    tsr: dict = {}
    loser_in_bracket: set = set()    # (bracket_id, loser_id)
    bracket_loser_to_winner: dict = {}  # (bracket_id, loser_id) -> winner_id
    brackets_with_matches: set = set()

    sorted_matches = sorted(all_matches, key=lambda m: m.created_at or datetime(2000, 1, 1))
    user_match_history: dict = {}   # uid -> [(is_win, match)]

    for m in sorted_matches:
        match_counts[m.winner_id] = match_counts.get(m.winner_id, 0) + 1
        match_counts[m.loser_id]  = match_counts.get(m.loser_id,  0) + 1
        if (m.winner_kills or 0) >= 3 and (m.loser_kills or 0) == 0:
            tsg[m.winner_id] = tsg.get(m.winner_id, 0) + 1
            tsr[m.loser_id]  = tsr.get(m.loser_id,  0) + 1
        if m.bracket_id:
            loser_in_bracket.add((m.bracket_id, m.loser_id))
            bracket_loser_to_winner[(m.bracket_id, m.loser_id)] = m.winner_id
            brackets_with_matches.add(m.bracket_id)
        user_match_history.setdefault(m.winner_id, []).append((True, m))
        user_match_history.setdefault(m.loser_id,  []).append((False, m))

    top_fin_id = max(tsg, key=tsg.get) if tsg else None
    top_pb_id  = max(tsr, key=tsr.get) if tsr else None

    # ── Derived badge sets ───────────────────────────────────────────────────
    top3_uids = {row[0] for row in
                 db.query(CharacterStats.user_id)
                 .filter(CharacterStats.elo > 1000)
                 .group_by(CharacterStats.user_id)
                 .order_by(func.max(CharacterStats.elo).desc())
                 .limit(1).all()}

    # Demon Slayer: beat current #1 elo player
    demon_slayer_uids: set = set()
    if top3_uids:
        top1_uid = next(iter(top3_uids))
        demon_slayer_uids = {m.winner_id for m in all_matches if m.loser_id == top1_uid and m.winner_id != top1_uid}

    # The Wall: ≥75% wins over last 20 matches
    the_wall_uids: set = set()
    for uid, history in user_match_history.items():
        last20 = history[-20:]
        if len(last20) >= 20 and sum(1 for (w, _) in last20 if w) >= 15:
            the_wall_uids.add(uid)

    # Clutch Factor: 5 consecutive last-stock wins (loser_kills == winner_kills − 1)
    clutch_uids: set = set()
    for uid, history in user_match_history.items():
        streak = 0
        for (is_win, m) in history:
            wk = m.winner_kills or 0
            lk = m.loser_kills or 0
            if is_win and wk > 0 and lk == wk - 1:
                streak += 1
                if streak >= 5:
                    clutch_uids.add(uid)
                    break
            else:
                streak = 0

    # Unstoppable Force: power-weighted elo ≥ 1100 (weighted avg across all played chars)
    unstoppable_uids: set = set()
    for uid, stats in all_stats_by_user.items():
        total_g = sum((s.wins or 0) + (s.losses or 0) for s in stats)
        if total_g >= 5:
            pw = sum(s.elo * ((s.wins or 0) + (s.losses or 0)) for s in stats) / total_g
            if pw >= 1100:
                unstoppable_uids.add(uid)

    # Char Legend: any character elo ≥ 1200
    char_legend_uids: set = {s.user_id for s in all_cs if (s.elo or 1000) >= 1200}

    # Old Reliable: 100+ matches with single most-played character
    old_reliable_uids: set = set()
    for uid, stats in all_stats_by_user.items():
        if stats:
            most = max(stats, key=lambda s: (s.wins or 0) + (s.losses or 0))
            if (most.wins or 0) + (most.losses or 0) >= 100:
                old_reliable_uids.add(uid)

    # Jack of All Trades: 5+ wins with 15 different characters
    jack_uids: set = {uid for uid, stats in all_stats_by_user.items()
                      if len([s for s in stats if (s.wins or 0) >= 5]) >= 15}

    # Tax Collector: 100+ total kills
    tax_uids: set = {uid for uid, stats in all_stats_by_user.items()
                     if sum(s.kills or 0 for s in stats) >= 100}

    # Pacifist: lowest kills-per-match with 5+ wins globally
    total_wins_uid = {uid: sum(s.wins or 0 for s in stats) for uid, stats in all_stats_by_user.items()}
    total_kills_uid = {uid: sum(s.kills or 0 for s in stats) for uid, stats in all_stats_by_user.items()}
    candidates = [(uid, total_kills_uid.get(uid, 0) / max(match_counts.get(uid, 1), 1))
                  for uid, wins in total_wins_uid.items() if wins >= 5]
    pacifist_uid = min(candidates, key=lambda x: x[1])[0] if candidates else None

    # Sacrificer: most total sacrifices (at least 1)
    total_sacs_uid = {uid: sum(s.sacrifices or 0 for s in stats) for uid, stats in all_stats_by_user.items()}
    sac_candidates = [(uid, cnt) for uid, cnt in total_sacs_uid.items() if cnt >= 1]
    sacrificer_uid = max(sac_candidates, key=lambda x: x[1])[0] if sac_candidates else None

    # Flawless Run: won a bracket without losing any recorded match in it
    flawless_uids: set = set()
    for b in completed_brackets:
        winner_uid = username_to_uid.get(b.winner)
        if winner_uid and b.id in brackets_with_matches and (b.id, winner_uid) not in loser_in_bracket:
            flawless_uids.add(winner_uid)

    # Executioner: directly eliminated the previous tournament's champion
    executioner_uids: set = set()
    for i in range(1, len(completed_brackets)):
        prev_uid = username_to_uid.get(completed_brackets[i - 1].winner)
        if prev_uid:
            killer = bracket_loser_to_winner.get((completed_brackets[i].id, prev_uid))
            if killer:
                executioner_uids.add(killer)

    # ── Build per-user result ────────────────────────────────────────────────
    result = {}
    for u in all_users_list:
        uid, uname = u.id, u.username
        stats   = stats_by_user.get(uid, [])
        t_wins  = tourney_wins.get(uname, 0)
        matches = match_counts.get(uid, 0)
        place   = placement_counts.get(uname, {})

        earned = []
        if stats:
            best = max(stats, key=lambda s: s.points)
            if best.points >= 10:
                earned.append({"id":"specialist","label":f"{best.character} Specialist","color":"#f5a623"})
            if len([s for s in stats if s.points > 0]) >= 5:
                earned.append({"id":"allrounder","label":"All-Rounder","color":"#27ae60"})
            if len([s for s in stats if s.points >= 10]) >= 3:
                earned.append({"id":"consistent","label":"Consistent","color":"#3498db"})
        if t_wins >= 1:
            earned.append({"id":"champion","label":"Bracket Champion","color":"#e74c3c"})
        if t_wins >= 3:
            earned.append({"id":"serial_champ","label":"Serial Champion","color":"#f5a623"})
        if top_tourney == uname and t_wins >= 1:
            earned.append({"id":"tourney_king","label":"Tournament King","color":"#ffe066"})
        if uid in top3_uids:
            earned.append({"id":"top3","label":"Top Performer","color":"#9b59b6"})
        if matches >= 20:
            earned.append({"id":"veteran","label":"Veteran","color":"#1abc9c"})
        if top_fin_id == uid and tsg.get(uid, 0) >= 3:
            earned.append({"id":"finisher","label":"The Finisher","color":"#00bcd4"})
        if top_pb_id == uid and tsr.get(uid, 0) >= 3:
            earned.append({"id":"punching_bag","label":"Punching Bag","color":"#e74c3c"})
        if uid in the_wall_uids:
            earned.append({"id":"the_wall","label":"The Wall","color":"#607d8b"})
        if uid in demon_slayer_uids:
            earned.append({"id":"demon_slayer","label":"Demon Slayer","color":"#ff5722"})
        if uid in clutch_uids:
            earned.append({"id":"clutch_factor","label":"Clutch Factor","color":"#ff9800"})
        if uid in unstoppable_uids:
            earned.append({"id":"unstoppable","label":"Unstoppable Force","color":"#e91e63"})
        if uid in char_legend_uids:
            earned.append({"id":"char_legend","label":"Character Legend","color":"#9c27b0"})
        if roster_master_count.get(uid, 0) >= 10:
            earned.append({"id":"roster_master","label":"Roster Master","color":"#2196f3"})
        if uid in old_reliable_uids:
            earned.append({"id":"old_reliable","label":"Old Reliable","color":"#795548"})
        if uid in jack_uids:
            earned.append({"id":"jack_of_all","label":"Jack of All Trades","color":"#009688"})
        if place.get("3rd", 0) >= 3:
            earned.append({"id":"bronze_bomber","label":"Bronze Bomber","color":"#cd7f32"})
        if place.get("2nd", 0) >= 3:
            earned.append({"id":"silver_lining","label":"Silver Lining","color":"#9e9e9e"})
        if uid in flawless_uids:
            earned.append({"id":"flawless_run","label":"Flawless Run","color":"#4caf50"})
        if uid in executioner_uids:
            earned.append({"id":"executioner","label":"Executioner","color":"#f44336"})
        if uid in tax_uids:
            earned.append({"id":"tax_collector","label":"Tax Collector","color":"#ff9800"})
        if pacifist_uid == uid:
            earned.append({"id":"pacifist","label":"Pacifist","color":"#8bc34a"})
        if sacrificer_uid == uid:
            earned.append({"id":"sacrificer","label":"Sacrificer","color":"#9c27b0"})

        if not earned:
            continue
        by_id = {b["id"]: b for b in earned}

        featured = u.featured_badge
        if featured and featured in by_id:
            result[uname] = by_id[featured]
            continue

        result[uname] = next((by_id[p] for p in PRIORITY if p in by_id), earned[0])

    return result


@router.get("/users/search")
def search_users(q: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    users = db.query(User).filter(User.username.ilike(f"%{q}%")).limit(10).all()
    return [{"id": u.id, "username": u.username} for u in users if u.id != current_user.id]


@router.get("/users/{username}/profile")
def get_user_profile(username: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    user = db.query(User).filter(User.username == username).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return {"id": user.id, "username": user.username, "avatar_url": user.avatar_url}


@router.get("/users/{username}/h2h/{other}")
def h2h(username: str, other: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    u1 = db.query(User).filter(User.username == username).first()
    u2 = db.query(User).filter(User.username == other).first()
    if not u1 or not u2:
        raise HTTPException(status_code=404, detail="User not found")

    wins_as_winner = db.query(MatchResult).filter(
        MatchResult.winner_id == u1.id, MatchResult.loser_id == u2.id
    ).all()
    wins_as_loser = db.query(MatchResult).filter(
        MatchResult.winner_id == u2.id, MatchResult.loser_id == u1.id
    ).all()

    chars = {}
    matchups = {}
    u1_total_kills = 0
    u2_total_kills = 0

    for r in wins_as_winner:
        c = r.winner_char
        wk = r.winner_kills or 0
        lk = r.loser_kills or 0
        chars.setdefault(c, {"wins": 0, "losses": 0, "kills": 0, "deaths": 0})
        chars[c]["wins"] += 1
        chars[c]["kills"] += wk
        chars[c]["deaths"] += lk
        u1_total_kills += wk
        u2_total_kills += lk
        key = f"{r.winner_char} vs {r.loser_char}"
        matchups.setdefault(key, {"user1_wins": 0, "user2_wins": 0, "user1_char": r.winner_char, "user2_char": r.loser_char, "user1_kills": 0, "user2_kills": 0})
        matchups[key]["user1_wins"] += 1
        matchups[key]["user1_kills"] += wk
        matchups[key]["user2_kills"] += lk

    for r in wins_as_loser:
        c = r.loser_char
        wk = r.winner_kills or 0
        lk = r.loser_kills or 0
        chars.setdefault(c, {"wins": 0, "losses": 0, "kills": 0, "deaths": 0})
        chars[c]["losses"] += 1
        chars[c]["kills"] += lk
        chars[c]["deaths"] += wk
        u1_total_kills += lk
        u2_total_kills += wk
        key = f"{r.loser_char} vs {r.winner_char}"
        matchups.setdefault(key, {"user1_wins": 0, "user2_wins": 0, "user1_char": r.loser_char, "user2_char": r.winner_char, "user1_kills": 0, "user2_kills": 0})
        matchups[key]["user2_wins"] += 1
        matchups[key]["user1_kills"] += lk
        matchups[key]["user2_kills"] += wk

    u1_wins = len(wins_as_winner)
    u2_wins = len(wins_as_loser)
    total   = u1_wins + u2_wins
    leader  = username if u1_wins > u2_wins else (other if u2_wins > u1_wins else None)
    return {
        "user1": username, "user1_wins": u1_wins, "user1_kills": u1_total_kills,
        "user2": other,    "user2_wins": u2_wins, "user2_kills": u2_total_kills,
        "total": total, "leader": leader,
        "chars": chars,
        "matchups": matchups,
    }


@router.get("/users/{username}/activity")
def activity(username: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    user = db.query(User).filter(User.username == username).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    results = db.query(MatchResult).filter(
        or_(MatchResult.winner_id == user.id, MatchResult.loser_id == user.id)
    ).order_by(MatchResult.created_at.desc()).limit(20).all()
    return [{
        "id": r.id,
        "winner": r.winner.username,
        "winner_char": r.winner_char,
        "loser": r.loser.username,
        "loser_char": r.loser_char,
        "elo_delta": r.elo_delta or 0,
        "created_at": r.created_at.isoformat(),
    } for r in results]


@router.get("/users/{username}/comments")
def get_comments(username: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    user = db.query(User).filter(User.username == username).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    comments = db.query(ProfileComment).filter(ProfileComment.target_id == user.id)\
        .order_by(ProfileComment.created_at.desc()).limit(50).all()
    return [{"id": c.id, "author": c.author.username, "author_avatar": c.author.avatar_url,
             "content": c.content, "created_at": c.created_at.isoformat()} for c in comments]


@router.post("/users/{username}/comments")
def post_comment(username: str, req: CommentCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    target = db.query(User).filter(User.username == username).first()
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    if not req.content.strip():
        raise HTTPException(status_code=400, detail="Comment cannot be empty")
    if len(req.content) > 200:
        raise HTTPException(status_code=400, detail="Max 200 characters")
    comment = ProfileComment(author_id=current_user.id, target_id=target.id, content=req.content.strip())
    db.add(comment)
    db.commit()
    db.refresh(comment)
    return {"id": comment.id, "author": current_user.username,
            "author_avatar": current_user.avatar_url,
            "content": comment.content, "created_at": comment.created_at.isoformat()}


@router.delete("/comments/{comment_id}")
def delete_comment(comment_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    comment = db.query(ProfileComment).filter(ProfileComment.id == comment_id).first()
    if not comment:
        raise HTTPException(status_code=404, detail="Not found")
    if comment.author_id != current_user.id and comment.target_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not allowed")
    db.delete(comment)
    db.commit()
    return {"ok": True}


@router.get("/users/{username}/stats")
def get_user_stats(username: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    user = db.query(User).filter(User.username == username).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    tournament_wins = db.query(Bracket).filter(Bracket.winner == username).count()
    three_stocks_given = db.query(MatchResult).filter(
        MatchResult.winner_id == user.id,
        MatchResult.winner_kills >= 3,
        MatchResult.loser_kills == 0,
    ).count()
    three_stocked_received = db.query(MatchResult).filter(
        MatchResult.loser_id == user.id,
        MatchResult.winner_kills >= 3,
        MatchResult.loser_kills == 0,
    ).count()
    return {
        "tournament_wins": tournament_wins,
        "three_stocks_given": three_stocks_given,
        "three_stocked_received": three_stocked_received,
    }


@router.get("/users/{username}/badges")
def get_badges(username: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    user = db.query(User).filter(User.username == username).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    badges = []

    # ── Character stats (all for this user) ──────────────────────────────────
    all_user_cs = db.query(CharacterStats).filter(CharacterStats.user_id == user.id).all()
    pts_stats = [s for s in all_user_cs if s.points > 0]
    if pts_stats:
        best = max(pts_stats, key=lambda s: s.points)
        if best.points >= 10:
            badges.append({"id": "specialist", "label": f"{best.character} Specialist",
                           "desc": f"{best.points} pts with {best.character}", "color": "#f5a623",
                           "character": best.character})
        if len(pts_stats) >= 5:
            badges.append({"id": "allrounder", "label": "All-Rounder",
                           "desc": f"Points with {len(pts_stats)} characters", "color": "#27ae60"})
        if len([s for s in pts_stats if s.points >= 10]) >= 3:
            badges.append({"id": "consistent", "label": "Consistent",
                           "desc": "3+ characters at 10+ pts each", "color": "#3498db"})

    # Char Legend: any character elo ≥ 1200
    legend_chars = [s for s in all_user_cs if (s.elo or 1000) >= 1200]
    if legend_chars:
        top_legend = max(legend_chars, key=lambda s: s.elo)
        badges.append({"id": "char_legend", "label": "Character Legend",
                       "desc": f"{top_legend.character} is at {top_legend.elo} Elo",
                       "color": "#9c27b0", "character": top_legend.character})

    # Unstoppable Force: power-weighted elo ≥ 1100
    total_g = sum((s.wins or 0) + (s.losses or 0) for s in all_user_cs)
    if total_g >= 5:
        pw_elo = sum(s.elo * ((s.wins or 0) + (s.losses or 0)) for s in all_user_cs) / total_g
        if pw_elo >= 1100:
            badges.append({"id": "unstoppable", "label": "Unstoppable Force",
                           "desc": f"Power-weighted Elo: {round(pw_elo)}", "color": "#e91e63"})

    # Old Reliable: 100+ matches with most-played character
    if all_user_cs:
        most = max(all_user_cs, key=lambda s: (s.wins or 0) + (s.losses or 0))
        most_games = (most.wins or 0) + (most.losses or 0)
        if most_games >= 100:
            badges.append({"id": "old_reliable", "label": "Old Reliable",
                           "desc": f"{most_games} games with {most.character}",
                           "color": "#795548", "character": most.character})

    # Jack of All Trades: 5+ wins with 15 different characters
    chars_with_5w = len([s for s in all_user_cs if (s.wins or 0) >= 5])
    if chars_with_5w >= 15:
        badges.append({"id": "jack_of_all", "label": "Jack of All Trades",
                       "desc": f"5+ wins with {chars_with_5w} different characters", "color": "#009688"})

    # Roster Master: points leader for 10+ characters globally
    all_cs_global = db.query(CharacterStats).filter(CharacterStats.points > 0).all()
    char_pts_leader: dict = {}
    for s in all_cs_global:
        prev = char_pts_leader.get(s.character)
        if prev is None or s.points > prev[1]:
            char_pts_leader[s.character] = (s.user_id, s.points)
    king_count = sum(1 for uid, _ in char_pts_leader.values() if uid == user.id)
    if king_count >= 10:
        badges.append({"id": "roster_master", "label": "Roster Master",
                       "desc": f"Points leader with {king_count} different characters",
                       "color": "#2196f3"})

    # Tax Collector: 100+ total kills
    total_kills = sum(s.kills or 0 for s in all_user_cs)
    if total_kills >= 100:
        badges.append({"id": "tax_collector", "label": "Tax Collector",
                       "desc": f"{total_kills} total kills", "color": "#ff9800"})

    # ── Tournament wins ───────────────────────────────────────────────────────
    tournament_wins = db.query(Bracket).filter(Bracket.winner == username).count()
    if tournament_wins >= 1:
        badges.append({"id": "champion", "label": "Bracket Champion",
                       "desc": f"Won {tournament_wins} tournament{'s' if tournament_wins != 1 else ''}",
                       "color": "#e74c3c"})
    if tournament_wins >= 3:
        badges.append({"id": "serial_champ", "label": "Serial Champion",
                       "desc": f"Won {tournament_wins} tournaments", "color": "#f5a623"})
    top_winner = (db.query(Bracket.winner, func.count(Bracket.id).label("cnt"))
                  .filter(Bracket.winner.isnot(None), Bracket.winner != "")
                  .group_by(Bracket.winner).order_by(func.count(Bracket.id).desc()).first())
    if top_winner and top_winner.winner == username and tournament_wins >= 1:
        badges.append({"id": "tourney_king", "label": "Tournament King",
                       "desc": f"Most tournament wins globally ({tournament_wins})", "color": "#ffe066"})

    # Placement badges (Bronze Bomber / Silver Lining)
    completed_brackets = (db.query(Bracket)
                          .filter(Bracket.winner.isnot(None), Bracket.winner != "")
                          .order_by(Bracket.created_at).all())
    second_count = third_count = 0
    for b in completed_brackets:
        p = b.placements or {}
        for place in ("2nd", "3rd"):
            info = p.get(place)
            items = info if isinstance(info, list) else ([info] if isinstance(info, dict) else [])
            for item in items:
                if (item or {}).get("player") == username:
                    if place == "2nd": second_count += 1
                    else: third_count += 1
    if third_count >= 3:
        badges.append({"id": "bronze_bomber", "label": "Bronze Bomber",
                       "desc": f"3rd place {third_count} times", "color": "#cd7f32"})
    if second_count >= 3:
        badges.append({"id": "silver_lining", "label": "Silver Lining",
                       "desc": f"Runner-up {second_count} times", "color": "#9e9e9e"})

    # Flawless Run: won a bracket without any recorded loss in it
    user_won_brackets = [b for b in completed_brackets if b.winner == username]
    for b in user_won_brackets:
        bracket_match_count = db.query(MatchResult).filter(MatchResult.bracket_id == b.id).count()
        loss_in_bracket = db.query(MatchResult).filter(
            MatchResult.bracket_id == b.id, MatchResult.loser_id == user.id
        ).count()
        if bracket_match_count > 0 and loss_in_bracket == 0:
            badges.append({"id": "flawless_run", "label": "Flawless Run",
                           "desc": "Won a tournament without losing a single match", "color": "#4caf50"})
            break

    # Executioner: directly eliminated the previous tournament's champion
    for i in range(1, len(completed_brackets)):
        prev_winner = completed_brackets[i - 1].winner
        if prev_winner == username:
            continue
        prev_user = db.query(User).filter(User.username == prev_winner).first()
        if prev_user:
            elim = db.query(MatchResult).filter(
                MatchResult.bracket_id == completed_brackets[i].id,
                MatchResult.winner_id == user.id,
                MatchResult.loser_id == prev_user.id,
            ).first()
            if elim:
                badges.append({"id": "executioner", "label": "Executioner",
                               "desc": f"Eliminated {prev_winner} (defending champion)",
                               "color": "#f44336"})
                break

    # ── Match-based badges ────────────────────────────────────────────────────
    top3_ids = {row[0] for row in
                db.query(CharacterStats.user_id).filter(CharacterStats.elo > 1000)
                .group_by(CharacterStats.user_id).order_by(func.max(CharacterStats.elo).desc()).limit(1).all()}
    if user.id in top3_ids:
        badges.append({"id": "top3", "label": "Top Performer",
                       "desc": "#1 on the character leaderboard", "color": "#9b59b6"})

    # Demon Slayer: beat current #1
    if top3_ids:
        top1_id = next(iter(top3_ids))
        if top1_id != user.id:
            slayed = db.query(MatchResult).filter(
                MatchResult.winner_id == user.id, MatchResult.loser_id == top1_id
            ).first()
            if slayed:
                badges.append({"id": "demon_slayer", "label": "Demon Slayer",
                               "desc": "Defeated the #1 ranked player", "color": "#ff5722"})

    user_matches = (db.query(MatchResult)
                    .filter(or_(MatchResult.winner_id == user.id, MatchResult.loser_id == user.id))
                    .order_by(MatchResult.created_at).all())
    match_count = len(user_matches)

    if match_count >= 20:
        badges.append({"id": "veteran", "label": "Veteran",
                       "desc": f"{match_count} matches played", "color": "#1abc9c"})

    # The Wall: ≥75% wins over last 20 matches
    if match_count >= 20:
        last20 = user_matches[-20:]
        wall_wins = sum(1 for m in last20 if m.winner_id == user.id)
        if wall_wins >= 15:
            badges.append({"id": "the_wall", "label": "The Wall",
                           "desc": f"{wall_wins}/20 wins in last 20 matches", "color": "#607d8b"})

    # Clutch Factor: 5 consecutive last-stock wins
    streak = 0
    for m in user_matches:
        is_win = m.winner_id == user.id
        wk = m.winner_kills or 0
        lk = m.loser_kills or 0
        if is_win and wk > 0 and lk == wk - 1:
            streak += 1
        else:
            streak = 0
        if streak >= 5:
            badges.append({"id": "clutch_factor", "label": "Clutch Factor",
                           "desc": "5 consecutive last-stock wins", "color": "#ff9800"})
            break

    # 3-Stock badges
    tsg = db.query(MatchResult).filter(
        MatchResult.winner_id == user.id, MatchResult.winner_kills >= 3, MatchResult.loser_kills == 0
    ).count()
    tsr = db.query(MatchResult).filter(
        MatchResult.loser_id == user.id, MatchResult.winner_kills >= 3, MatchResult.loser_kills == 0
    ).count()
    top_3stocker = (db.query(MatchResult.winner_id, func.count(MatchResult.id).label("cnt"))
                    .filter(MatchResult.winner_kills >= 3, MatchResult.loser_kills == 0)
                    .group_by(MatchResult.winner_id).order_by(func.count(MatchResult.id).desc()).first())
    if top_3stocker and top_3stocker.winner_id == user.id and tsg >= 3:
        badges.append({"id": "finisher", "label": "The Finisher",
                       "desc": f"Most 3-stocks given globally ({tsg})", "color": "#00bcd4"})
    top_stocked = (db.query(MatchResult.loser_id, func.count(MatchResult.id).label("cnt"))
                   .filter(MatchResult.winner_kills >= 3, MatchResult.loser_kills == 0)
                   .group_by(MatchResult.loser_id).order_by(func.count(MatchResult.id).desc()).first())
    if top_stocked and top_stocked.loser_id == user.id and tsr >= 3:
        badges.append({"id": "punching_bag", "label": "Punching Bag",
                       "desc": f"3-stocked the most globally ({tsr}x)", "color": "#e74c3c"})

    # Pacifist: lowest kills-per-match globally with 5+ wins
    total_user_wins = sum(s.wins or 0 for s in all_user_cs)
    if total_user_wins >= 5:
        user_avg = total_kills / max(match_count, 1)
        top_pacifist = (db.query(
                            CharacterStats.user_id,
                            func.sum(CharacterStats.kills).label("k"),
                            func.sum(CharacterStats.wins).label("w")
                        )
                        .group_by(CharacterStats.user_id)
                        .having(func.sum(CharacterStats.wins) >= 5)
                        .all())
        if top_pacifist:
            match_cnt_map = {row[0]: db.query(func.count(MatchResult.id)).filter(
                or_(MatchResult.winner_id == row[0], MatchResult.loser_id == row[0])
            ).scalar() or 1 for row in top_pacifist}
            global_min_avg = min((row[1] or 0) / match_cnt_map[row[0]] for row in top_pacifist)
            if abs(user_avg - global_min_avg) < 0.01:
                badges.append({"id": "pacifist", "label": "Pacifist",
                               "desc": f"Lowest avg kills ({user_avg:.1f}/match) with 5+ wins",
                               "color": "#8bc34a"})

    # Sacrificer: most total sacrifices globally (at least 1)
    total_user_sacs = sum(s.sacrifices or 0 for s in all_user_cs)
    if total_user_sacs >= 1:
        top_sac = (db.query(CharacterStats.user_id, func.sum(CharacterStats.sacrifices).label("s"))
                   .group_by(CharacterStats.user_id)
                   .having(func.sum(CharacterStats.sacrifices) >= 1)
                   .order_by(func.sum(CharacterStats.sacrifices).desc())
                   .first())
        if top_sac and top_sac.user_id == user.id:
            badges.append({"id": "sacrificer", "label": "Sacrificer",
                           "desc": f"Most sacrifices globally ({total_user_sacs}x)", "color": "#9c27b0"})

    return badges
