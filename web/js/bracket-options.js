// bracket-options.js — shared bracket configuration UI + slot-ordering logic.
// Included by bracket.html and tournament.html so both use identical settings.

/**
 * Inject bracket style / pool mode / seeding radio UI into a container element.
 * Uses standard radio names: bracketStyle, poolMode, seedMode.
 * @param {HTMLElement} container
 * @param {{ style?, poolMode?, seedMode? }} defaults
 */
function renderBracketOptions(container, defaults = {}) {
  const s  = defaults.style    || 'strongVsStrong';
  const pm = defaults.poolMode || 'slot';
  const sm = defaults.seedMode || 'elo';
  const ac = 'accent-color:var(--accent-blue)';

  container.innerHTML = `
    <div style="display:flex;gap:14px;flex-wrap:wrap;">
      <div style="flex:1;min-width:150px;">
        <div style="font-size:0.72rem;font-weight:700;letter-spacing:0.5px;text-transform:uppercase;color:var(--text-muted);margin-bottom:6px;">Bracket Style</div>
        <div style="display:flex;flex-direction:column;gap:5px;padding:10px;background:var(--card-bg2);border:1px solid var(--border);border-radius:8px;">
          <label style="display:flex;align-items:center;gap:7px;cursor:pointer;font-size:0.83rem;">
            <input type="radio" name="bracketStyle" value="strongVsStrong" ${s==='strongVsStrong'?'checked':''} style="${ac}" />
            <span><strong>Strong vs Strong</strong> — highest plays highest</span>
          </label>
          <label style="display:flex;align-items:center;gap:7px;cursor:pointer;font-size:0.83rem;">
            <input type="radio" name="bracketStyle" value="strongVsWeak" ${s==='strongVsWeak'?'checked':''} style="${ac}" />
            <span><strong>Strong vs Weak</strong> — highest plays lowest</span>
          </label>
          <label style="display:flex;align-items:center;gap:7px;cursor:pointer;font-size:0.83rem;">
            <input type="radio" name="bracketStyle" value="random" ${s==='random'?'checked':''} style="${ac}" />
            <span><strong>Random</strong> — fully shuffled</span>
          </label>
        </div>
      </div>
      <div style="flex:1;min-width:150px;">
        <div style="font-size:0.72rem;font-weight:700;letter-spacing:0.5px;text-transform:uppercase;color:var(--text-muted);margin-bottom:6px;">Character Pool</div>
        <div style="display:flex;flex-direction:column;gap:5px;padding:10px;background:var(--card-bg2);border:1px solid var(--border);border-radius:8px;">
          <label style="display:flex;align-items:center;gap:7px;cursor:pointer;font-size:0.83rem;">
            <input type="radio" name="poolMode" value="slot" ${pm==='slot'?'checked':''} style="${ac}" />
            <span><strong>Per Slot</strong> — each player's 1st char faces only other 1st chars, etc.</span>
          </label>
          <label style="display:flex;align-items:center;gap:7px;cursor:pointer;font-size:0.83rem;">
            <input type="radio" name="poolMode" value="freePool" ${pm==='freePool'?'checked':''} style="${ac}" />
            <span><strong>Free Pool</strong> — all characters ranked together globally</span>
          </label>
        </div>
      </div>
      <div style="flex:1;min-width:150px;">
        <div style="font-size:0.72rem;font-weight:700;letter-spacing:0.5px;text-transform:uppercase;color:var(--text-muted);margin-bottom:6px;">Seeding (Rank By)</div>
        <div style="display:flex;flex-direction:column;gap:5px;padding:10px;background:var(--card-bg2);border:1px solid var(--border);border-radius:8px;">
          <label style="display:flex;align-items:center;gap:7px;cursor:pointer;font-size:0.83rem;">
            <input type="radio" name="seedMode" value="elo" ${sm==='elo'?'checked':''} style="${ac}" />
            <span><strong>Elo</strong> — rank by Elo rating</span>
          </label>
          <label style="display:flex;align-items:center;gap:7px;cursor:pointer;font-size:0.83rem;">
            <input type="radio" name="seedMode" value="kills" ${sm==='kills'?'checked':''} style="${ac}" />
            <span><strong>Kills</strong> — rank by total stocks taken</span>
          </label>
          <label style="display:flex;align-items:center;gap:7px;cursor:pointer;font-size:0.83rem;">
            <input type="radio" name="seedMode" value="winpct" ${sm==='winpct'?'checked':''} style="${ac}" />
            <span><strong>Win %</strong> <span style="color:var(--text-muted);font-size:0.75rem;">(min 3 games)</span></span>
          </label>
        </div>
      </div>
    </div>
  `;
}

/**
 * Read current bracket option values from the DOM.
 * @returns {{ style: string, poolMode: string, seedMode: string }}
 */
function readBracketOptions() {
  return {
    style:    document.querySelector('input[name="bracketStyle"]:checked')?.value  || 'strongVsStrong',
    poolMode: document.querySelector('input[name="poolMode"]:checked')?.value      || 'slot',
    seedMode: document.querySelector('input[name="seedMode"]:checked')?.value      || 'elo',
  };
}

/**
 * Build a flat entries array from confirmed lineups.
 * Each player's characters are sorted by seedMode score so slot 0 = best char,
 * slot 1 = second best, etc. — this is what makes Per Slot work correctly.
 *
 * @param {Object} confirmedLineups  { username: [charName, ...] }
 * @param {Object} playerStats       { username: [{ character, elo, kills, wins, losses }] }
 * @param {string} seedMode          'elo' | 'kills' | 'winpct'
 * @returns {{ player: string, character: string }[]}
 */
function buildEntriesFromLineups(confirmedLineups, playerStats, seedMode = 'elo') {
  return Object.entries(confirmedLineups).flatMap(([player, chars]) => {
    if (!chars || chars.length === 0) return [];
    const stats = playerStats[player] || [];
    const score = c => {
      const s = stats.find(st => st.character === c) || {};
      if (seedMode === 'kills') return s.kills || 0;
      if (seedMode === 'winpct') {
        const total = (s.wins || 0) + (s.losses || 0);
        return total >= 3 ? (s.wins || 0) / total : 0;
      }
      return s.elo || 1000; // default: elo
    };
    return [...chars].sort((a, b) => score(b) - score(a)).map(c => ({ player, character: c }));
  });
}
