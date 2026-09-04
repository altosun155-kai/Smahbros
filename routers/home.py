from datetime import datetime

from fastapi import APIRouter, Depends
from sqlalchemy import or_
from sqlalchemy.orm import Session

from database import User, Bracket, TournamentInvite, DraftRoom, DraftPick, MatchResult, CharacterStats
from auth import get_db, get_current_user
from routers.brackets import _compute_round_participants, _infer_winner
from routers.leaderboard import get_champion

router = APIRouter(tags=["home"])


def _live_brackets_for_user(db: Session, user: User) -> list[Bracket]:
    owned = db.query(Bracket).filter(Bracket.user_id == user.id, Bracket.is_live == True).all()
    invited_ids = (
        db.query(TournamentInvite.bracket_id)
        .filter(TournamentInvite.invitee_id == user.id, TournamentInvite.status == "accepted")
    )
    invited = db.query(Bracket).filter(Bracket.id.in_(invited_ids), Bracket.is_live == True).all()
    return owned + invited


def _ended_brackets_for_user(db: Session, user: User) -> list[Bracket]:
    owned = db.query(Bracket).filter(Bracket.user_id == user.id, Bracket.is_live == False).all()
    invited_ids = (
        db.query(TournamentInvite.bracket_id)
        .filter(TournamentInvite.invitee_id == user.id, TournamentInvite.status == "accepted")
    )
    invited = db.query(Bracket).filter(Bracket.id.in_(invited_ids), Bracket.is_live == False).all()
    return owned + invited


def _bracket_round_label(b: Bracket) -> str:
    """First round (1-indexed for display) that still has an unresolved match."""
    rounds = _compute_round_participants(b.bracket_data or [], b.round_winners or {})
    rw = b.round_winners or {}
    for ri in sorted(rounds.keys()):
        matches = rounds[ri]
        if not matches:
            continue
        if any(not rw.get(f"r{ri}_m{mi}") for mi in matches):
            return f"Round {ri + 1}"
    return "Final"


def _draft_progress_label(db: Session, room: DraftRoom) -> str:
    picks = db.query(DraftPick).filter(DraftPick.room_id == room.id).all()
    locked_by_player: dict = {}
    for p in picks:
        if p.locked_at:
            locked_by_player[p.player_id] = locked_by_player.get(p.player_id, 0) + 1
    fully_locked = sum(1 for pid in (room.players or []) if locked_by_player.get(pid, 0) >= room.chars_per_player)
    return f"{fully_locked}/{len(room.players or [])} locked"


def _in_progress(db: Session, user: User) -> dict | None:
    """Union of owned/invited live brackets + draft rooms the user is in, most
    recent wins. Draft rooms that already went 'live' (brackets created) are
    intentionally not re-surfaced here -- their brackets are picked up by the
    bracket check above for the host; a non-host draft participant's bracket
    is a known gap, not worth the extra complexity for this pass."""
    candidates = []

    for b in _live_brackets_for_user(db, user):
        candidates.append({
            "type": "bracket",
            "id": b.id,
            "name": b.name,
            "round_or_progress": _bracket_round_label(b),
            "leader": b.owner.username,
            "started_at": b.created_at.isoformat() if b.created_at else None,
            "_sort": b.created_at or datetime.min,
        })

    draft_rooms = db.query(DraftRoom).filter(DraftRoom.status.in_(["lobby", "picking", "revealed"])).all()
    for r in draft_rooms:
        if user.id not in (r.players or []):
            continue
        candidates.append({
            "type": "draft",
            "id": r.id,
            "name": f"Draft #{r.id}",
            "round_or_progress": _draft_progress_label(db, r),
            "leader": r.host.username,
            "started_at": r.created_at.isoformat() if r.created_at else None,
            "_sort": r.created_at or datetime.min,
        })

    if not candidates:
        return None
    candidates.sort(key=lambda c: c["_sort"], reverse=True)
    best = candidates[0]
    best.pop("_sort")
    return best


def _last_session(db: Session, user: User) -> dict | None:
    """Most recent ended bracket worth spotlighting -- excludes team-mode
    (deleted feature, stale rows may still exist) and anything without a
    recorded winner, so the home panel never shows a dead-feature ghost or
    an empty-ish 'no winner recorded' line. Returns None if nothing qualifies;
    the frontend falls back to its own "Get Started" copy in that case."""
    ended = _ended_brackets_for_user(db, user)
    qualifying = []
    for b in ended:
        if b.mode not in ("draft", "regular"):
            continue
        winner = _infer_winner(b)
        if winner is None:
            continue
        qualifying.append((b, winner))
    if not qualifying:
        return None
    latest, winner = max(qualifying, key=lambda pair: pair[0].created_at or datetime.min)
    return {
        "name": latest.name,
        "winner": winner,
        "ended_at": latest.created_at.isoformat() if latest.created_at else None,
    }


def _last_duel(db: Session, user: User) -> dict | None:
    m = (
        db.query(MatchResult)
        .filter(or_(MatchResult.winner_id == user.id, MatchResult.loser_id == user.id))
        .order_by(MatchResult.created_at.desc())
        .first()
    )
    if not m:
        return None
    opponent_id = m.loser_id if m.winner_id == user.id else m.winner_id
    opponent = db.query(User).filter(User.id == opponent_id).first()
    opponent_name = opponent.username if opponent else "Unknown"
    my_wins = db.query(MatchResult).filter(MatchResult.winner_id == user.id, MatchResult.loser_id == opponent_id).count()
    their_wins = db.query(MatchResult).filter(MatchResult.winner_id == opponent_id, MatchResult.loser_id == user.id).count()
    # Orient and label here, not in the frontend -- a bare "32-26" is one flip
    # away from crediting the wrong side, silently, with nobody noticing.
    if my_wins > their_wins:
        record = f"You lead {my_wins}-{their_wins}"
    elif their_wins > my_wins:
        record = f"{opponent_name} leads {their_wins}-{my_wins}"
    else:
        record = f"Tied {my_wins}-{their_wins}"
    return {
        "opponent": opponent_name,
        "result": "W" if m.winner_id == user.id else "L",
        "record": record,
        "played_at": m.created_at.isoformat() if m.created_at else None,
    }


def _my_brackets_summary(db: Session, user: User) -> dict:
    """Owned brackets only -- matches GET /brackets, the same set my-brackets.html lists."""
    owned = (
        db.query(Bracket)
        .filter(Bracket.user_id == user.id)
        .order_by(Bracket.created_at.desc())
        .all()
    )
    return {
        "count": len(owned),
        "most_recent": {"id": owned[0].id, "name": owned[0].name} if owned else None,
    }


def _mastery_played(db: Session, user: User) -> int:
    return (
        db.query(CharacterStats)
        .filter(CharacterStats.user_id == user.id, (CharacterStats.wins + CharacterStats.losses) > 0)
        .count()
    )


def _posters(db: Session) -> list[dict]:
    """Same filter as GET /matches/shame, called directly rather than as an
    internal HTTP request, limited to 3 for the home page's poster column."""
    rows = (
        db.query(MatchResult)
        .filter(MatchResult.winner_kills >= 3, MatchResult.loser_kills == 0)
        .order_by(MatchResult.created_at.desc())
        .limit(3)
        .all()
    )
    return [{
        "winner": r.winner.username,
        "winner_char": r.winner_char,
        "winner_avatar": r.winner.avatar_url,
        "loser": r.loser.username,
        "loser_char": r.loser_char,
        "loser_avatar": r.loser.avatar_url,
        "created_at": r.created_at.isoformat() if r.created_at else None,
    } for r in rows if not r.winner.is_test and not r.loser.is_test]


def _last_draft_champion_character(db: Session) -> str | None:
    """Character the most recent completed draft tournament was won with --
    the home background's default fallback (see home_summary). "Completed"
    means Bracket.winner is set, which only happens once the Grand Final's
    tournament_winner has actually been recorded (see isGrandFinal in
    web/app/tournament/page.tsx and web/app/bracket/page.tsx) -- so this
    returns nothing for any tournament that hit that bug, same as it would
    for a tournament that's simply still in progress. "Most recent" is by
    Bracket.created_at (when it started, not when it finished -- there's no
    separate completed-at column, same approximation used for placement-elo
    history in routers/matches.py).

    Draft brackets are mode == "draft" (see routers/draft.py's
    _build_free_pool_bracket). Bracket.winner only stores the winning
    player's username, not their character, so the character is read
    straight from the Grand Final's own round_winners label (same
    "player — character" format everything else here parses) rather than
    Bracket.placements, which needs the host to also click "End Tournament" --
    a separate, later step this shouldn't have to wait on.
    """
    b = (
        db.query(Bracket)
        .filter(Bracket.mode == "draft", Bracket.winner.isnot(None))
        .order_by(Bracket.created_at.desc())
        .first()
    )
    if not b or not b.bracket_data or not b.round_winners:
        return None

    # Grand Final round index: bracket_data is always padded to a power of 2,
    # so it's log2(len) halvings from round 1. Same bit-walk as
    # end_tournament and scripts/backfill_grand_final_placements.py.
    r1_count = len(b.bracket_data)
    gf_ri = 0
    n = r1_count
    while n > 1:
        n >>= 1
        gf_ri += 1

    gf_label = b.round_winners.get(f"r{gf_ri}_m0", "")
    if not gf_label or " — " not in gf_label:
        return None
    player, character = gf_label.split(" — ", 1)
    if player != b.winner:
        return None  # round_winners/winner disagree -- don't trust it
    return character


@router.get("/home/summary")
def home_summary(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    in_progress = _in_progress(db, current_user)
    last_session = _last_session(db, current_user) if in_progress is None else None
    champion = get_champion(db)
    # The home-page background fade: each player's own override (set via
    # PATCH /users/me/background-character) wins if they made one --
    # deliberately a separate field from `champion`, which still reports the
    # *actual* site champion for the leaderboard panel/Elo badge regardless
    # of this override. Absent that, it's the character that won the most
    # recent completed draft tournament (see _last_draft_champion_character)
    # rather than the champion's own main -- a tournament win is a specific,
    # recent moment; "champion" is just whoever currently has the highest
    # Elo, which can be true for months without them touching this
    # character recently. Falls back to the champion's character (the
    # previous default) only once no draft tournament has ever completed.
    background_character = (
        current_user.background_character
        or _last_draft_champion_character(db)
        or (champion["character"] if champion else None)
    )
    return {
        "in_progress": in_progress,
        "last_session": last_session,
        "last_duel": _last_duel(db, current_user),
        "my_brackets": _my_brackets_summary(db, current_user),
        "champion": champion,
        "background_character": background_character,
        "mastery_coverage": {"played": _mastery_played(db, current_user)},
        "posters": _posters(db),
    }
