// ─── SUPABASE ──────────────────────────────────────────────────────────────────
const _sbc = window.supabase.createClient(
  'https://egtlxndritlrinyicapf.supabase.co',
  'sb_publishable_HpgY5OAIqX5JSb5CQ_nGmw_czK8Xezj'
);

let heroes = [];
let items = [];
let builds = [];
// Whether the last builds fetch failed, so the empty screen can tell "could not
// load" apart from "nobody has saved one yet".
let buildsError = false;
let mercs = [];
let structures = [];
// The Rebirth campaign's items -- base-game data, not the map's, so they are
// their own list rather than more entries in `items` (nothing in a build can
// point at them).
let campaignItems = [];
let activeSlot = null;
let activePhase = null;
let pickerMode = 'item'; // 'item' or 'legendary'
let detailHeroId = null;

// The data files carry no version in their URL the way app.js does, so a
// browser was free to keep serving the copy it downloaded yesterday -- edits to
// items.json only showed up once the cache expired on its own. `no-cache` still
// caches, it just asks the server first, so an unchanged file costs a 304.
const loadJson = (file, key) =>
  fetch(`data/${file}.json`, { cache: 'no-cache' }).then(r => r.json()).then(d => d[key]);

async function loadData() {
  [heroes, items, mercs, structures, campaignItems] = await Promise.all([
    loadJson('heroes', 'heroes'),
    loadJson('items', 'items'),
    loadJson('mercs', 'mercs'),
    loadJson('structures', 'structures'),
    loadJson('campaign_items', 'items'),
  ]);
  fillRoleFilter();
  renderHeroes();
  renderItems();
  renderMercs();
  renderStructures();
  renderCampaignItems();
  populateBuildCreator();
  await loadBuildsFromSupabase();
}

async function loadBuildsFromSupabase() {
  const grid = document.getElementById('build-list');
  grid.innerHTML = '<p style="color:var(--text-dim); padding:16px;">Loading builds…</p>';
  const { data, error } = await _sbc
    .from('community_builds')
    .select('*')
    .order('created_at', { ascending: false });
  // a failed fetch just means no builds to show; the console keeps the detail.
  // The flag is what lets the empty screen say "could not load" rather than
  // "none saved yet" -- from a blank grid the two are indistinguishable.
  if (error) console.error(error);
  buildsError = !!error;
  builds = error ? [] : (data || []);
  renderBuilds();
}

// Every card opens a panel on click, which made the whole database unreachable
// without a mouse: a div has no keyboard behaviour of its own, so tabbing
// through the page skipped 24 heroes and 98 items entirely. The cards now carry
// role="button" and a tab stop, and this supplies the half a real button would
// have given for free -- Enter and Space activate, and Space does not also
// scroll the page while the card has focus.
document.addEventListener('keydown', e => {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  const card = e.target.closest?.('.card[role="button"]');
  if (!card) return;
  e.preventDefault();
  card.click();
});

// ─── EMPTY STATES ──────────────────────────────────────────────────────────────
// A filter that matches nothing used to leave the grid blank -- no message, no
// hint that the search was the reason, just a page that looked broken. What
// goes here says which list came back empty and what to do about it, and never
// apologises: the reader typed something, and the answer is that this map has
// no such thing in it.
function emptyState(title, hint) {
  return `<div class="empty-state">
      <div class="empty-title">${title}</div>
      <div class="empty-hint">${hint}</div>
    </div>`;
}

function noMatches(what, query) {
  return emptyState(
    query ? `No ${what} match “${query}”.` : `No ${what} to show.`,
    'Try fewer letters, or clear the filters above.');
}

// ─── NAV ───────────────────────────────────────────────────────────────────────
// Which tab is open lives in the URL. Reloading while reading the item list
// used to drop you back on Heroes; now the address bar remembers, and a link
// someone pastes opens on the tab they were looking at.
const TAB_NAMES = [...document.querySelectorAll('.nav-btn')].map(b => b.dataset.tab);

function showTab(tab) {
  if (!TAB_NAMES.includes(tab)) tab = TAB_NAMES[0];
  document.querySelectorAll('.nav-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.tab === tab));
  document.querySelectorAll('.tab').forEach(t =>
    t.classList.toggle('active', t.id === 'tab-' + tab));
}

document.querySelectorAll('.nav-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    location.hash = btn.dataset.tab;
    showTab(btn.dataset.tab);
  });
});

// Back and forward buttons, and a hand-edited address bar, land here too.
window.addEventListener('hashchange', () => showTab(location.hash.slice(1)));
showTab(location.hash.slice(1));

// ─── HEROES ────────────────────────────────────────────────────────────────────
function renderHeroes(filter = '', statFilter = '', roleFilter = '') {
  const grid = document.getElementById('hero-list');
  const filtered = heroes.filter(h => {
    const matchName = h.name.toLowerCase().includes(filter.toLowerCase());
    const matchStat = !statFilter || h.primary_stat === statFilter;
    const matchRole = !roleFilter || (h.roles || []).includes(roleFilter);
    return matchName && matchStat && matchRole;
  });

  if (filtered.length === 0) {
    grid.innerHTML = noMatches('heroes', filter);
    return;
  }
  grid.innerHTML = filtered.map(h => `
    <div class="card hero-card attr-${h.primary_stat || 'unknown'} ${h.abilities.length === 0 ? 'card-incomplete' : ''}" role="button" tabindex="0" onclick="showHeroDetail('${h.id}', this)">
      ${h.icon != null ? `<div class="hero-portrait" style="background-image:url('${h.icon}')"></div>` : ''}
      <div class="hero-card-body">
        <div class="card-name">${h.name}</div>
        <div class="hero-meta">
          <span class="hero-attr">${ATTR_NAMES[h.primary_stat] || 'Unknown'}</span>
          ${difficultyBar(h)}
        </div>
      </div>
    </div>
  `).join('');
}

// The filter above the grid has always said "Strength"; the card said "STR".
// One name for the thing, and it is the one the game uses in the hero's own
// stat block.
const ATTR_NAMES = { STR: 'Strength', AGI: 'Agility', INT: 'Intelligence' };

// The roles are the pick screen's own categories, read out of the hero selector
// in war3map.j -- the same eight buttons you filter by when choosing a hero in
// game, in the order the selector declares them. They all share one chip
// colour: the attribute beside them is already colour-coded, and eight more
// hues would have turned the header into a paint chart.
// The map states difficulty in the hero's own tooltip as a row of bullets:
// filled ones in a colour that climbs green -> yellow -> orange -> red, the
// remainder in grey. It is drawn, not named -- the tooltip never says "Hard" --
// so this draws it too rather than inventing a vocabulary for it.
//
// The scale is four bullets for twenty-three heroes and five for Blood Mage,
// who gets a longer bar in a purple the others never use. That is the map's
// own doing, so the total is read from difficulty_max instead of assumed.
function difficultyBar(hero) {
  if (hero.difficulty == null) return '';
  const max = hero.difficulty_max || 4;
  // Drawn as shapes rather than as the bullet character the tooltip uses: a •
  // is a punctuation mark sized to sit inside a line of text, and at the size
  // this needs it came out thin and grey-looking whatever colour it was given.
  const pips = Array.from({ length: max }, (_, i) =>
    `<span class="diff-pip${i < hero.difficulty ? ' filled' : ''}"></span>`).join('');
  return `<span class="hero-difficulty diff-${hero.difficulty}"
    title="Difficulty ${hero.difficulty} of ${max}"
    aria-label="Difficulty ${hero.difficulty} of ${max}">${pips}</span>`;
}

function roleTags(hero) {
  if (!hero.roles || hero.roles.length === 0) return '';
  return `<div class="card-tags-row role-row">${hero.roles
    .map(r => `<span class="card-tag tag-role">${r}</span>`).join('')}</div>`;
}

function statDelta(curr, prev, key) {
  if (!prev || curr[key] == null || prev[key] == null) return '';
  const d = (parseFloat(curr[key]) - parseFloat(prev[key]));
  if (d === 0) return '';
  // Two decimals, because that is the precision the growth is written with:
  // Blademaster gains 1.75 agility a level, and at one decimal the step read
  // +1.8 on one row and +1.7 on the next. Hit points and mana step by whole
  // numbers and keep the short form.
  return `<span class="stat-delta">+${Number.isInteger(d) ? d : d.toFixed(2)}</span>`;
}

// The four numbers a hero carries at every level. They sit in the same row as
// the ones the slider moves, the way a spell's constants sit in its table --
// what a reader wants is all of a hero's figures in one place, not a second
// strip above them. Collision size is the one that is not obviously a stat:
// it is how wide the unit is for pathing, and this map narrows most heroes to
// 30 while four of them keep the base-game 32.
function heroConstants(hero) {
  const boxes = [
    ['Movement Speed', hero.move_speed],
    ['Collision Size', hero.collision_size],
    ['Cast Point', hero.cast_point],
    ['Base Attack Timer', hero.attack_speed],
  ];
  return boxes.filter(([, v]) => v != null).map(([label, v]) => `
      <div class="level-stat-item">
        <span class="level-stat-label">${label}</span>
        <span class="level-stat-value">${v}</span>
      </div>`).join('');
}

function renderHeroLevelStats(hero, level) {
  const data = hero.stats_by_level;
  if (!data || data.length === 0) return;
  const s = data.find(d => d.level === level) || data[data.length - 1];
  const prev = data.find(d => d.level === level - 1);
  document.getElementById('hero-level-display').textContent = s.level;
  document.getElementById('hero-level-stats').innerHTML = `
    <div class="level-stats-row">
      <div class="level-stat-item">
        <span class="level-stat-label">Hit Points</span>
        <span class="level-stat-value">${s.hp ?? '?'} ${statDelta(s, prev, 'hp')}</span>
      </div>
      <div class="level-stat-item">
        <span class="level-stat-label">Mana</span>
        <span class="level-stat-value">${s.mana ?? '?'} ${statDelta(s, prev, 'mana')}</span>
      </div>
      <div class="level-stat-item">
        <span class="level-stat-label">Damage</span>
        <span class="level-stat-value">${s.damage_min ?? '?'}–${s.damage_max ?? '?'}</span>
      </div>
      <div class="level-stat-item">
        <span class="level-stat-label" style="color:var(--str)">Strength</span>
        <span class="level-stat-value" style="color:var(--str)">${s.str != null ? parseFloat(s.str).toFixed(2) : '?'} ${statDelta(s, prev, 'str')}</span>
      </div>
      <div class="level-stat-item">
        <span class="level-stat-label" style="color:var(--agi)">Agility</span>
        <span class="level-stat-value" style="color:var(--agi)">${s.agi != null ? parseFloat(s.agi).toFixed(2) : '?'} ${statDelta(s, prev, 'agi')}</span>
      </div>
      <div class="level-stat-item">
        <span class="level-stat-label" style="color:var(--int)">Intelligence</span>
        <span class="level-stat-value" style="color:var(--int)">${s.int != null ? parseFloat(s.int).toFixed(2) : '?'} ${statDelta(s, prev, 'int')}</span>
      </div>
      ${s.armor != null ? `<div class="level-stat-item"><span class="level-stat-label">Armor</span><span class="level-stat-value">${s.armor} ${statDelta(s, prev, 'armor')}</span></div>` : ''}
      ${heroConstants(hero)}
    </div>
  `;
}

function updateHeroLevelSlider(level) {
  const hero = heroes.find(h => h.id === detailHeroId);
  if (hero) renderHeroLevelStats(hero, parseInt(level));
}

function showHeroDetail(id, el) {
  detailHeroId = id;
  const hero = heroes.find(h => h.id === id);

  const levels = hero.stats_by_level;
  const maxLevel = levels.length > 0 ? levels[levels.length - 1].level : 1;
  const statsHtml = levels.length > 0 ? `
    <div class="stats-slider-section">
      <div class="slider-row">
        <span class="slider-label">Level <strong id="hero-level-display">1</strong></span>
        <input type="range" class="level-slider" min="1" max="${maxLevel}" value="1"
          oninput="updateHeroLevelSlider(this.value)">
        <span class="slider-max">Max: ${maxLevel}</span>
      </div>
      <div id="hero-level-stats" class="level-stats-display"></div>
    </div>
  ` : '<p style="color:var(--text-dim); margin-bottom:16px;">Level stats not yet documented.</p>';

  const abilitiesHtml = hero.abilities.length > 0 ? hero.abilities.map((ab, idx) => {
    // Columns come from every level, not from level 1: the map often leaves
    // level 1 on the base game's value, so a spell whose cooldown only appears
    // from level 2 up used to lose the whole column. A level that has nothing
    // to say in a column shows a dash.
    const keys = [...new Set(ab.levels.flatMap(lv => Object.keys(lv)))]
      .filter(k => k !== 'rank');
    // A summon's damage is one stat the game stores as two fields. Two columns
    // headed "Damage Min" and "Damage Max" make the reader join them back up on
    // every row, and an averaged column instead throws away the spread the game
    // actually rolls -- so the pair prints as the range it is, "20–28", under
    // the single heading the `_min` field already carries.
    const rangeMax = {};
    for (const k of keys) {
      if (k.endsWith('_min') && keys.includes(k.slice(0, -4) + '_max')) {
        rangeMax[k] = k.slice(0, -4) + '_max';
      }
    }
    const paired = new Set(Object.values(rangeMax));
    const colKeys = keys.filter(k => !paired.has(k));
    // The heading belongs to the stat, not to the field: `dmg_min` is the
    // Damage column, and its `_min` only says which half of the pair it stores.
    const columnLabel = k => statLabel(k in rangeMax ? k.slice(0, -4) : k);
    // A number written once on the spell is the value every rank pays: Impale
    // costs 90 mana at rank 1 the same as at rank 6, and the data only bothers
    // to repeat it on the ranks where the map does. So a blank cell falls back
    // to the spell's own figure.
    //
    // But only where that figure is provably the constant -- every rank that
    // names the field has to agree with it. Some spells carry a stale scalar
    // from the base game that the ladder then contradicts: Blizzard says
    // cooldown 5 while its ranks count 6.5/7/7.5/8/8.5, and filling rank 1
    // with 5 would publish a number the map never had. Where the spell and its
    // ranks disagree, the blank stays a dash -- an admitted gap beats a
    // confident invention.
    const spellDefault = k => k in ab &&
      ab.levels.every(lv => !(k in lv) || lv[k] === ab[k]);
    // Everything the spell says about itself outside the ladder -- cooldown,
    // range, mana. These hold for every rank, so they join the ladder as
    // columns of their own and repeat down it rather than sitting in a
    // separate strip above the table: a reader looking up what rank 3 costs
    // finds it on the rank 3 row, not in two places at once. Printing 800 six
    // times is the price. The list is what is left after the fields that have
    // their own place in the card, and it keeps the order the data file
    // writes, which is the order the map's own tooltip uses.
    //
    // An explicit null is not the same as an absent key. Absent means the stat
    // does not apply -- an aura has no cooldown, and a Cooldown column of
    // dashes on Devotion Aura is a lie dressed as diligence. Null means the
    // stat is real but nobody has the number yet: the map stores only the
    // fields it overrides, so a dozen spells leave their cooldown to base-game
    // files the .w3x does not carry. Those keep their column and show dashes,
    // because a card that simply omits Chain Lightning's cooldown reads as "it
    // has none" when the truth is "this is a gap".
    const metaKeys = Object.keys(ab).filter(k =>
      !ABILITY_STRUCTURAL.has(k) && !keys.includes(k));
    // What a column actually holds at a given rank, once the fall-back to the
    // spell's own figure has been applied. Everything below reads the ladder
    // through this so the bars and the printed numbers can never disagree.
    const cellValue = (k, lv) => k in lv ? lv[k]
      : spellDefault(k) ? ab[k] : undefined;
    // A bar is drawn wherever the column moves, and nowhere else: a key missing
    // from `bars` says the same thing on every rank -- Stampede's cooldown of
    // 180, a summon's duration of 70 -- and a row of six identical full-width
    // rules would be the loudest thing in the table while saying nothing.
    //
    // Each bar is scaled against zero, so its length is the value and two bars
    // in a column can be compared by eye.
    //
    // These used to be measured from the column's own minimum instead, to stop
    // a near-flat ladder like 75/75/80/80/85/85 drawing six rules of nearly the
    // same length. It did that, but it cost the bars their meaning: the shortest
    // rank always drew a 12% stub and the longest always filled the cell, no
    // matter what separated them. Avatar has two ranks, 400 and 800 bonus hit
    // points, and drew them at 12% and 100% -- a doubling shown as eight times
    // the length. A reader cannot tell that from a column that really does climb
    // eightfold, which makes the bar worse than no bar.
    //
    // A flat ladder now draws six nearly-equal bars, and that is the honest
    // picture of a stat that barely moves. The shape is still visible; it is
    // just no longer exaggerated into something the numbers do not say.
    //
    // A column that dips below zero has no zero to stand on, so it keeps the
    // old range-relative treatment rather than drawing a negative width.
    const bars = {};
    for (const k of colKeys) {
      const nums = ab.levels.map(lv => cellValue(k, lv))
        .filter(v => typeof v === 'number');
      if (nums.length < 2) continue;
      const max = Math.max(...nums), min = Math.min(...nums);
      if (max <= min) continue;
      bars[k] = min >= 0 ? { base: 0, top: max } : { base: min, top: max };
    }
    // Health and mana carry the game's own colours; every other ladder is gold.
    // A heal is health -- Tranquility's and Holy Light's ladders were drawing in
    // gold next to Hit Points columns drawing in green, which is the same
    // quantity in two colours. `reduction` and `falloff` are excluded: those
    // ladders are about suppressing a heal, not delivering one.
    const HEALTH = /(^|_)hp($|_)|hit_points|(^|_)heal(_|$)|(^|_)life_regen($|_)/;
    // A damage ladder takes the map's own magic-damage colour when the spell
    // says that is what it deals. The spell's prose is the only place the type
    // is recorded -- there is no damage-type field -- and it is the same
    // sentence the reader has just read, so the two cannot disagree. Physical
    // and universal damage stay gold: only magic gets a colour of its own.
    const magic = /\bmagic\b[^.]*\bdamage\b/i.test(ab.description || '');
    const isDamage = k => /(^|_)(damage|dmg)($|_)/.test(k);
    const barClass = k => /(^|_)mana($|_)/.test(k) ? ' lv-mana'
      : HEALTH.test(k) && !/reduction|falloff/.test(k) ? ' lv-hp'
      : /(^|_)bounty($|_)/.test(k) ? ' lv-gold'
      : magic && isDamage(k) ? ' lv-magic' : '';
    const cell = (k, lv) => {
      const v = cellValue(k, lv);
      // The top of a range is only ever printed beside its bottom, so a rank
      // that has one and not the other falls back to the single figure.
      const hi = k in rangeMax ? cellValue(rangeMax[k], lv) : undefined;
      const text = v === undefined ? '—'
        : hi === undefined ? statValue(k, v)
        : `${statValue(k, v)}–${statValue(rangeMax[k], hi)}`;
      if (!(k in bars) || typeof v !== 'number') return `<td>${text}</td>`;
      // A stub floor, so a genuine zero still reads as a filled-in cell rather
      // than as one nobody got to.
      const { base, top } = bars[k];
      const fill = Math.max(0.06, (v - base) / (top - base));
      return `<td class="lv-cell${barClass(k)}" style="--fill:${
        fill.toFixed(3)}">${text}</td>`;
    };
    const levelRows = ab.levels.map(lv =>
      `<tr><td>Level ${lv.rank}</td>${
        colKeys.map(k => cell(k, lv)).join('')}${
        metaKeys.map(k => `<td>${ab[k] === null ? '—' : statValue(k, ab[k])}</td>`).join('')}</tr>`);
    // One PNG per spell now, pulled from the game's own icons by
    // tools/icons.py --abilities. A spell whose art could not be resolved
    // keeps "icon": null and draws as a black tile: an obvious gap beats
    // quietly borrowing the neighbouring spell's picture.
    const iconHtml = `<div class="ability-icon"${
      ab.icon ? ` style="background-image:url('${ab.icon}')"` : ''}></div>`;
    // A second axis the rank ladder cannot hold: Robo-Goblin's bonus depends on
    // the spell's rank *and* on how far Engineering Upgrade has been taken, so
    // the numbers form a grid rather than a column. Reading it off prose --
    // "1 strength and 1 armor (2/3/4/5/6/7)" is how the map writes it -- means
    // counting brackets to find what a level 2 Robo-Goblin gives at upgrade 4.
    const sc = ab.scaling;
    const scalingHtml = !sc ? '' : `
      <div class="scaling-box">
        <div class="scaling-caption">${ab.name} — ${sc.caption}</div>
        <table class="scaling-table">
          <thead>
            <tr><th class="sc-corner"></th>
                <th class="sc-group" colspan="${sc.steps.length}">${sc.title}</th></tr>
            <tr><th class="sc-corner">${ab.name}</th>${sc.steps.map(s =>
              `<th class="sc-step">${sc.step_label} ${s}</th>`).join('')}</tr>
          </thead>
          <tbody>${sc.rows.map((r, i) =>
            `<tr class="sc-rank-${i + 1}">
               <td class="sc-rowlabel"><span class="sc-chip">Level ${r.rank}</span></td>${
              r.values.map(v => `<td><span class="sc-chip">${v}</span></td>`).join('')}
             </tr>`).join('')}</tbody>
        </table>
      </div>`;
    return `
      <div class="ability-card">
        <div class="ability-header">
          ${iconHtml}
          <span class="ability-name">${ab.name}</span>
          <span class="ability-type">${ab.type}</span>
          ${ab.hotkey ? `<span class="ability-type">Hotkey: ${ab.hotkey}</span>` : ''}
        </div>
        <div class="ability-desc">${ab.description}</div>
        ${ab.required_level ? `<div class="ability-req">Requires Ability Level ${ab.required_level}${ab.hero_level_required ? ` / Hero Level ${ab.hero_level_required}` : ''}</div>` : ''}
        ${colKeys.length + metaKeys.length > 0 ? `
          <div class="levels-table-wrap">
          <table class="levels-table">
            <thead><tr><th>Level</th>${[...colKeys, ...metaKeys].map(k =>
              `<th>${columnLabel(k)}</th>`).join('')}</tr></thead>
            <tbody>${levelRows.join('')}</tbody>
          </table>
          </div>
        ` : ''}
        ${scalingHtml}
      </div>
    `;
  }).join('') : '<p style="color:var(--text-dim)">Abilities not yet documented.</p>';

  const heroHtml = `
    <div class="detail-header">
      ${hero.icon != null ? `<div class="item-detail-icon" ${itemIconStyle(hero.icon, hero.icon_index, hero.icon_cols || 4, hero.icon_rows || 3, 64)}></div>` : ''}
      <div>
        <div class="detail-title">${hero.name}</div>
        <div class="detail-subtitle">
          ${hero.lore_name ? hero.lore_name + ' · ' : ''}
          ${hero.race ? hero.race + ' · ' : ''}
          Primary Attribute: <span style="color:var(--${hero.primary_stat?.toLowerCase() || 'text-dim'})">${ATTR_NAMES[hero.primary_stat] || 'Unknown'}</span>
        </div>
        ${hero.difficulty != null
          ? `<div class="detail-difficulty">Difficulty ${difficultyBar(hero)}</div>` : ''}
        ${roleTags(hero)}
      </div>
    </div>
    ${statsHtml}
    <div class="abilities-section">
      <h3>Abilities</h3>
      ${abilitiesHtml}
    </div>
    ${hero.notes ? `<div style="margin-top:12px; color:var(--text-dim); font-size:13px;">${hero.notes}</div>` : ''}
  `;
  showInlineDetail('hero-list', el, heroHtml);
  if (hero.stats_by_level.length > 0) renderHeroLevelStats(hero, 1);
}

// Three controls now feed one render, so each reads the other two rather than
// each knowing its own argument position.
function rerenderHeroes() {
  renderHeroes(document.getElementById('hero-search').value,
               document.getElementById('hero-filter-stat').value,
               document.getElementById('hero-filter-role').value);
}
document.getElementById('hero-search').addEventListener('input', rerenderHeroes);
document.getElementById('hero-filter-stat').addEventListener('change', rerenderHeroes);
document.getElementById('hero-filter-role').addEventListener('change', rerenderHeroes);

// The order the pick screen lays its eight filter buttons out in, which is the
// order of the bitmask they are declared with in war3map.j (Carry 1, Tank 2,
// Support 4 ... Mage 128). Collecting the roles in the order the heroes happen
// to be listed would have put Support first, because Paladin is.
const ROLE_ORDER = ['Carry', 'Tank', 'Support', 'Stun',
                    'Jungler', 'Summoner', 'Pusher', 'Mage'];

// The options come from the data rather than from the markup, so a role the map
// adds later reaches the filter without anyone editing index.html. One the
// order above has never heard of still shows up -- at the end, rather than
// silently not at all.
function fillRoleFilter() {
  const present = [...new Set(heroes.flatMap(h => h.roles || []))];
  present.sort((a, b) => {
    const ia = ROLE_ORDER.indexOf(a), ib = ROLE_ORDER.indexOf(b);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b);
  });
  document.getElementById('hero-filter-role').insertAdjacentHTML('beforeend',
    present.map(r => `<option value="${r}">${r}</option>`).join(''));
}

// ─── ITEMS ─────────────────────────────────────────────────────────────────────
// Returns inline style string for a CSS sprite icon from item data.
// size = rendered px size.
function itemIconStyle(sheet, index, cols, rows, size) {
  // index === null means the file is a standalone icon, not a spritesheet
  if (index == null) {
    return `style="width:${size}px;height:${size}px;background-image:url('${sheet}');background-size:contain;background-position:center;background-repeat:no-repeat;"`;
  }
  const col = index % cols;
  const row = Math.floor(index / cols);
  const xPct = cols > 1 ? (col / (cols - 1)) * 100 : 0;
  const yPct = rows > 1 ? (row / (rows - 1)) * 100 : 0;
  return `style="width:${size}px;height:${size}px;background-image:url('${sheet}');background-size:${cols * 100}% ${rows * 100}%;background-position:${xPct.toFixed(2)}% ${yPct.toFixed(2)}%;background-repeat:no-repeat;"`;
}
function itemIcon(it, size) {
  if (it.icon == null) return '';
  return itemIconStyle(it.icon, it.icon_index, it.icon_cols || 4, it.icon_rows || 3, size);
}

// The category doubles as the shop an item is sold at; a few read better as the
// building's own name in a heading.
const SHOP_TITLES = {
  Consumable: 'Consumables',
  Orb: 'Orbs',
  Summon: 'Summons',
};

// Which shop an item is grouped and filtered under. Upgradable is two separate
// shops in game, so the data keeps them apart to hold their order -- but the
// number is bookkeeping and never reaches the page.
const shopLabel = cat => cat.replace(/^Upgradable \d+$/, 'Upgradable');

// What the tag on an item says. Usually the shop, except where the shop is the
// building and the tag wants the kind of item: the Black Market sells
// legendaries, and that is what a reader is looking for on the card.
const TAG_LABELS = { 'Black Market': 'Legendary', 'Orb': 'Orb Effect' };
const tagLabel = cat => TAG_LABELS[cat] || shopLabel(cat);

// "Unique" on this site only ever meant "carries an orb effect, and orb effects
// do not stack" -- the Orb stock and the tag said the same thing in two words,
// so they are one tag now. The claws, gauntlets and legendary blades are sold
// elsewhere and still need it; an orb has it from its shop tag already.
function orbEffectTag(it, style = '') {
  if (!it.unique || tagLabel(it.category) === 'Orb Effect') return '';
  return `<span class="card-tag tag-Orb"${style ? ` style="${style}"` : ''}>Orb Effect</span>`;
}

// The two lines a card can spare for what the item does. A description now
// opens with its label on its own line -- "Active Illusion", "Non-Combat
// Consumable" -- and the card is already showing that label as a tag, so
// spending the preview on it says the same word twice and pushes the actual
// effect out of view. The label is dropped and the effect gets both lines.
// Where the clamp falls is CSS's business: chopping the string at a fixed
// character count used to cut words in half.
// `note` is the second line a card may carry beside the sentence above: the
// preview keeps only the first line of a description by design, and on an item
// whose later line is the part you keep -- Health Stone spends its one charge on
// the heal and leaves the regeneration behind -- that rule hid the half that
// outlives the item and showed the half that does not. Written in the data as
// `preview_note` and only where a card actually needs it, so the default stays
// one sentence per tile.
function cardBlurb(desc, note = '') {
  if (!desc && !note) return '';
  const lines = desc.split('\n');
  // A label names the effect ("Active Illusion", "Frost Attack"). A line that
  // opens with a sign is a bonus, not a name -- "+5 Agility" over "+5 Strength"
  // used to lose the Agility to the label rule and the tile showed half the
  // item.
  const isLabel = lines.length > 1 && lines[0].length < 40
    && !lines[0].endsWith('.') && !/^\+/.test(lines[0]);
  const body = (isLabel ? lines.slice(1) : lines).map(l => l.trim()).filter(Boolean);
  // Only the first line of the body. A description's later lines are the
  // secondary facts -- what an upgrade changes, what else the item carries --
  // and on a tile clamped to two lines they crowded out the one sentence that
  // says what the item does. They are all still there when the item is opened.
  // A list of flat bonuses is the exception: every line of "+12 Damage" /
  // "+12% Attack Speed" is the item, so the list is kept whole.
  const bonusList = body.length > 1 && body.every(l => /^\+/.test(l));
  const text = (bonusList ? body.join('\n') : body[0] || '')
    // Some labels the map writes inline instead of on their own line -- Health
    // Stone opens "Consume: Instantly restores 500 health." The colon form is
    // the same word the tag beside it already carries, so it goes too.
    .replace(/^[A-Z][A-Za-z -]{0,24}:\s*/, '');
  const full = [text, note].filter(Boolean).join('\n');
  return full ? `<div class="card-sub">${full}</div>` : '';
}

function renderItems(filter = '', catFilter = '') {
  const grid = document.getElementById('item-list');
  const filtered = items.filter(it => {
    const matchName = it.name.toLowerCase().includes(filter.toLowerCase());
    const matchCat = !catFilter || shopLabel(it.category) === catFilter;
    return matchName && matchCat;
  });

  const card = it => `
    <div class="card" role="button" tabindex="0" onclick="showItemTooltip('${it.id}', this)">
      <div class="card-top-row">
        ${itemIcon(it, 56) ? `<div class="item-card-icon" ${itemIcon(it, 56)}></div>` : ''}
        <div class="card-top-text">
          ${priceHtml(it) ? `<div class="card-cost">${priceHtml(it)}</div>` : ''}
          <div class="card-name">${it.name}</div>
        </div>
      </div>
      <div class="card-tags-row" style="margin-bottom:8px;">
        ${shopTag(it)}
        ${extraTags(it)}
        ${hasAura(it) ? '<span class="card-tag tag-Aura">Aura</span>' : ''}
        ${orbEffectTag(it)}
      </div>
      ${cardBlurb(it.description, it.preview_note)}
    </div>`;

  // one block per shop, in the order a player walks past them; data/items.json
  // already holds each shop's items in its own grid order. Summons are the
  // exception: they are read last, so the section sinks to the bottom however
  // the data lists it.
  if (filtered.length === 0) {
    grid.innerHTML = noMatches('items', filter);
    return;
  }
  const shops = [...new Set(filtered.map(it => shopLabel(it.category)))]
    .sort((a, b) => (a === 'Summon') - (b === 'Summon'));
  grid.innerHTML = shops.map(shop => {
    const inShop = filtered.filter(it => shopLabel(it.category) === shop);
    return `
      <div class="merc-group">
        <h3 class="merc-group-title">${SHOP_TITLES[shop] || shop}<span class="merc-group-count">${inShop.length}</span></h3>
        <div class="card-grid">${inShop.map(card).join('')}</div>
      </div>`;
  }).join('');
}

function showItemTooltip(id, el) {
  const item = items.find(it => it.id === id);

  // Aura numbers get their own block. Left in STATS every one of them had to
  // repeat the word "Aura" in its label to stay unambiguous; under a heading
  // that says it once, each box can just name the stat.
  const allStats = Object.entries(item.stats || {});
  const isAura = k => k === 'aura' || k.startsWith('aura_');
  const isActive = k => k.startsWith('active_');
  const auraStats = allStats.filter(([k]) => isAura(k));
  const active = allStats.filter(([k]) => isActive(k));
  // What is left splits again: the flat bonuses a hero carries around, and the
  // effect the item fires on hit. Mixing them meant an orb listed its slow
  // percentages next to its armor as though they were the same kind of thing.
  // `duration` sits in FLAT_STATS because on the eight items that carry it, six
  // are summons and the number is how long the summoned thing lives -- a fact
  // about the summon, next to what it summons. The other two are Poisoned Blade
  // and Scroll of Speed, where the number times an effect rather than a unit:
  // the blade's 8 seconds is how long the poison ticks and the slow holds, so
  // under STATS it sat apart from the three numbers it governs and read as if
  // only the slow were timed. What tells the two apart is whether the item
  // summons at all.
  // (Rod of Necromancy used to be a ninth, carrying `duration: "permanent"`.
  // That was the description's heading copied into the stats: "Permanent" says
  // the item is not spent when used, the way Ancestral Staff -- same heading,
  // no duration -- is not spent. It says nothing about how long the skeletons
  // stand, so the stat is gone and the heading keeps the fact.)
  const summonsSomething = allStats.some(([k]) => k === 'summons' || k === 'summon_unit');
  const isFlat = k => FLAT_STATS.has(k) && !(k === 'duration' && !summonsSomething);
  const flat = allStats.filter(([k]) =>
    !isAura(k) && !isActive(k) && isFlat(k));
  const effect = allStats.filter(([k]) =>
    !isAura(k) && !isActive(k) && !isFlat(k));
  // A heading over a single box costs more than it explains -- Killmaim's one
  // lifesteal number reads fine sitting with its damage, and the Staff of
  // Silence has three numbers in total, which is a list, not three lists. A
  // group only breaks out once it and what it leaves behind both hold up.
  const splitEffect = effect.length > 1 && flat.length > 1;
  // When the two do not split, the boxes keep the order the item is written in
  // rather than flat-bonuses-then-effect: the data lists a shield's armor
  // first because that is what the item is bought for, and pulling the flat
  // stats out first moved it into the middle.
  const head = splitEffect ? flat
    : allStats.filter(([k]) => !isAura(k) && !isActive(k));
  const splitActive = active.length > 1 && head.length > 1;

  const plainStats = splitActive ? head : head.concat(active);
  const effectStats = splitEffect ? effect : [];
  const activeStats = splitActive ? active : [];

  // Boxes run in the order the item lists them -- the data is written the way
  // the item reads in game, so an armor bonus stated first stays first. Two
  // kinds of stat are exempt, and both for the same reason: they are not
  // bonuses the item advertises, so letting the data file decide where they
  // land meant they landed somewhere different on every item. TAIL_STATS
  // (Attacks Air) is a property this site derives and the map never states;
  // CHARGE_STATS is the footnote about how many times you get to use what the
  // item does. Both sink to the end, charges behind the rest, and the sort is
  // stable so everything else keeps the order it was written in.
  const tailRank = k => CHARGE_STATS.has(k) ? 2 : TAIL_STATS.has(k) ? 1 : 0;
  const tailLast = entries => [...entries].sort(
    ([ka], [kb]) => tailRank(ka) - tailRank(kb));

  const statBlock = (title, entries, label) => entries.length === 0 ? '' : `
    <div style="margin-bottom:16px;">
      <div style="color:var(--gold); font-size:12px; font-weight:600; margin-bottom:8px;">${title}</div>
      <div class="stats-grid" style="margin-bottom:0;">
        ${tailLast(entries).map(([k, v]) => `
          <div class="stat-box">
            <div class="stat-label">${label(k)}</div>
            <div class="stat-value">${statValue(k, v)}</div>
          </div>
        `).join('')}
      </div>
    </div>`;

  // On a weapon that procs, the effect is the item: nobody buys the Corrupted
  // Blade for its 50 damage, they buy it to strip 16 armor, and the damage is
  // the footnote. Items whose flat bonuses are the point -- Deathguard's
  // evasion, Inferno Stone's summon -- keep those first.
  const effectFirst = item.effect_type === 'on_attack';
  const statsHtml = (effectFirst
                      ? statBlock('EFFECT', effectStats, statLabel)
                        + statBlock('STATS', plainStats, statLabel)
                      : statBlock('STATS', plainStats, statLabel)
                        + statBlock('EFFECT', effectStats, statLabel))
                  + statBlock('ACTIVE', activeStats, activeLabel)
                  + statBlock('AURA', auraStats, auraLabel);

  // An upgrade raises the stat the item is named for, and nothing else. Areas,
  // intervals, durations, ranges and cooldowns hold still along a ladder -- the
  // Cloak of Flames burns for 10/20/30/40 damage but always in an area of 260 --
  // so multiplying them by the tier invented numbers like "Interval 2".
  // Some ladders are not a multiple of tier 1 at all -- the Amulet of Spell
  // Shield counts *down* 45/35/25/15 -- so the data can spell a rung out in
  // stack_values, and that always wins over the multiplication.
  const stackValues = item.stack_values || {};
  // A rung spelled out as the same number four times is not a progression --
  // the Rusty Mining Pick's bash always hits for 25 however many you hold, and
  // printing "25 Bash Bonus Damage" on every tier just crowds out the two stats
  // that do move. Constants belong in STATS, which lists them once.
  const stacks = k => k in stackValues && new Set(stackValues[k]).size > 1;
  const numericStats = item.stats
    ? Object.entries(item.stats).filter(([k, v]) => stacks(k) ||
        (!(k in stackValues) &&
          typeof v === 'number' && !/_(aoe|interval|duration|range|cooldown)$/.test(k)))
    : [];
  const tierCell = ([k, v], n) => k in stackValues
    ? `${statValue(k, stackValues[k][n - 1])} ${stackLabel(k)}`
    : `+${statValue(k, v * n)} ${stackLabel(k)}`;

  // A rung spelled out in stack_values prints as a bare figure, because it is
  // not a bonus that adds up -- the Thunderlizard Diamond's cooldown counts
  // *down* 19/18/17/16. Left in data order it landed between "+100 Damage" and
  // "+40 Mana" and broke the run of plus signs in half, so the box read as
  // three unrelated lines. The plain figures sort below the bonuses instead:
  // inside each group the data order still decides, so this only moves a line
  // that was never part of the run.
  const bonusFirst = ([k]) => (k in stackValues ? 1 : 0);
  const tierStats = [...numericStats].sort((a, b) => bonusFirst(a) - bonusFirst(b));

  const stackHtml = item.upgrade_tiers && numericStats.length > 0
    ? `<div style="margin-bottom:16px;">
        <div style="color:var(--gold); font-size:12px; font-weight:600; margin-bottom:8px;">STACK PROGRESSION</div>
        <div class="stats-grid stack-grid" style="margin-bottom:0;">
          ${Array.from({length: item.upgrade_tiers}, (_, i) => i + 1).map(n => `
            <div class="stat-box${numericStats.length > 1 ? ' stack-box' : ''}">
              <div class="stat-label" style="color:var(--gold)">×${n}</div>
              <div class="stat-value">
                ${tierStats.map(e => tierCell(e, n)).join('<br>')}
              </div>
            </div>
          `).join('')}
        </div>
      </div>`
    : '';

  // The Black Market's shop tag already reads "Legendary", in the same orange
  // chip -- side by side with a badge saying it again, the header said the word
  // twice. The badge is for a legendary that is sold somewhere else, or whose
  // shop tag is hidden.
  const legendaryBadge = item.legendary &&
    !(!item.hide_shop_tag && tagLabel(item.category) === 'Legendary');

  // The price used to sit in its own column, pinned to the right edge of a
  // panel as wide as the page -- on the Potion of Invisibility it ended up an
  // inch of empty space away from anything it described, and the eye never got
  // there. It reads with the name instead, and the effect type stops being a
  // grey whisper in the corner and joins the tags, which is what it is.
  const itemHtml = `
    <div class="detail-header">
      ${itemIcon(item, 64) ? `<div class="item-detail-icon" ${itemIcon(item, 64)}></div>` : ''}
      <div style="flex:1;">
        <div class="detail-title">
          ${item.name}
          ${priceHtml(item) ? `<span class="detail-price">${priceHtml(item, '&nbsp; ')}</span>` : ''}
        </div>
        <div class="detail-subtitle card-tags-row" style="margin-top:6px;">
          ${shopTag(item)}
          ${extraTags(item)}
          ${hasAura(item) ? '<span class="card-tag tag-Aura">Aura</span>' : ''}
          ${orbEffectTag(item)}
          ${legendaryBadge ? '<span class="card-tag" style="background:rgba(200,80,20,0.15); color:var(--endgame); border:1px solid var(--endgame);">Legendary</span>' : ''}
          ${effectTypeTags(item)}
        </div>
      </div>
    </div>
    ${item.description ? `<p style="color:var(--text); line-height:1.6; margin-bottom:16px; white-space:pre-line;">${item.description}</p>` : ''}
    ${statsHtml}
    ${stackHtml}
    ${item.notes ? `<div>
        <div style="color:var(--gold); font-size:12px; font-weight:600; margin-bottom:2px;">NOTES</div>
        <div style="color:var(--text-dim); font-size:13px; line-height:1.5;">${item.notes}</div>
      </div>` : ''}
  `;

  showInlineDetail('item-list', el, itemHtml);
}

document.getElementById('item-search').addEventListener('input', e => {
  renderItems(e.target.value, document.getElementById('item-filter-cat').value);
});
document.getElementById('item-filter-cat').addEventListener('change', e => {
  renderItems(document.getElementById('item-search').value, e.target.value);
});

// ─── CAMPAIGN ITEMS ────────────────────────────────────────────────────────────
// Same card and panel as the shop items, fed from data/campaign_items.json.
// The category is the equipment slot the campaign sorts an item under, and the
// sections run in the order a character sheet reads: weapons, then armour top
// to bottom, then the jewellery, then the things that are not equipment.
const CAMPAIGN_CATEGORY_ORDER = [
  'Primary Weapon', 'Secondary Weapon', 'Helm', 'Armor', 'Gloves', 'Boots',
  'Accessory', 'Trinket', 'Consumable', 'Quest Item', 'Miscellaneous',
];
const CAMPAIGN_TITLES = {
  'Primary Weapon': 'Primary Weapons', 'Secondary Weapon': 'Secondary Weapons',
  Helm: 'Helms', Accessory: 'Accessories', Trinket: 'Trinkets',
  Consumable: 'Consumables', 'Quest Item': 'Quest Items',
};

// The slot chip, then the rarity chip; the rarity carries the game's own colour
// so a card reads at a glance the way the item does in the campaign inventory.
function campaignTags(it, withSource = true) {
  const chips = [`<span class="card-tag tag-${it.category.replace(/ /g, '-')}">${it.category}</span>`];
  if (it.rarity) chips.push(`<span class="card-tag tag-${it.rarity}">${it.rarity}</span>`);
  if (withSource && it.source && it.source !== 'Droppable') {
    chips.push(`<span class="card-tag tag-source">${it.source}</span>`);
  }
  return chips.join('');
}

// The game paints its tooltips with |cAARRGGBB ... |r runs, and the campaign
// data keeps them so the page can show an item the colour the game does. The
// alpha byte is dropped: the game ignores it too. A |c inside an open run
// starts a new colour where the game would, and an unclosed run ends with the
// text. Text between the codes is escaped, since it goes into innerHTML.
function wc3Colored(text) {
  if (!text) return '';
  const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  let out = '', open = false;
  const re = /\|c[0-9a-fA-F]{2}([0-9a-fA-F]{6})|\|r/g;
  let last = 0, m;
  while ((m = re.exec(text)) !== null) {
    out += esc(text.slice(last, m.index));
    if (open) { out += '</span>'; open = false; }
    if (m[1]) { out += `<span style="color:#${m[1]}">`; open = true; }
    last = re.lastIndex;
  }
  out += esc(text.slice(last));
  return open ? out + '</span>' : out;
}

// The card's two lines, from the coloured text. Same rule as cardBlurb -- the
// label line is the tag beside it and goes; a list of bonuses stays whole,
// anything else keeps its first line -- decided on the plain text, so the
// colour codes cannot tip the length checks.
function campaignBlurb(it) {
  const plainLines = (it.description || '').split('\n');
  const colLines = (it.description_colored || it.description || '').split('\n');
  if (plainLines.length !== colLines.length) return cardBlurb(it.description);
  const isLabel = plainLines.length > 1 && plainLines[0].length < 40
    && !plainLines[0].endsWith('.') && !/^\+/.test(plainLines[0]);
  const start = isLabel ? 1 : 0;
  const body = plainLines.slice(start);
  const bonusList = body.length > 1 && body.every(l => /^\+/.test(l));
  const keep = bonusList ? colLines.slice(start) : colLines.slice(start, start + 1);
  const text = keep.map(wc3Colored).join('\n');
  return text ? `<div class="card-sub">${text}</div>` : '';
}

function renderCampaignItems(filter = '', catFilter = '', rarityFilter = '') {
  const grid = document.getElementById('citem-list');
  const q = filter.toLowerCase();
  const filtered = campaignItems.filter(it =>
    it.name.toLowerCase().includes(q)
    && (!catFilter || it.category === catFilter)
    && (!rarityFilter || it.rarity === rarityFilter));

  if (filtered.length === 0) {
    grid.innerHTML = noMatches('campaign items', filter);
    return;
  }

  const card = it => `
    <div class="card" role="button" tabindex="0" onclick="showCampaignItemDetail('${it.id}', this)">
      <div class="card-top-row">
        ${itemIcon(it, 56) ? `<div class="item-card-icon" ${itemIcon(it, 56)}></div>` : ''}
        <div class="card-top-text">
          ${priceHtml(it) ? `<div class="card-cost">${priceHtml(it)}</div>` : ''}
          <div class="card-name">${it.name}</div>
        </div>
      </div>
      <div class="card-tags-row" style="margin-bottom:8px;">
        ${campaignTags(it, false)}
      </div>
      ${campaignBlurb(it)}
    </div>`;

  const cats = CAMPAIGN_CATEGORY_ORDER.filter(c => filtered.some(it => it.category === c));
  grid.innerHTML = cats.map(cat => {
    const inCat = filtered.filter(it => it.category === cat);
    return `
      <div class="merc-group">
        <h3 class="merc-group-title">${CAMPAIGN_TITLES[cat] || cat}<span class="merc-group-count campaign-group-count">${inCat.length}</span></h3>
        <div class="card-grid">${inCat.map(card).join('')}</div>
      </div>`;
  }).join('');
}

function showCampaignItemDetail(id, el) {
  const item = campaignItems.find(it => it.id === id);
  const stats = Object.entries(item.stats || {});
  const statsHtml = stats.length === 0 ? '' : `
    <div style="margin-bottom:16px;">
      <div style="color:var(--gold); font-size:12px; font-weight:600; margin-bottom:8px;">STATS</div>
      <div class="stats-grid" style="margin-bottom:0;">
        ${stats.map(([k, v]) => `
          <div class="stat-box">
            <div class="stat-label">${statLabel(k)}</div>
            <div class="stat-value">${statValue(k, v)}</div>
          </div>`).join('')}
      </div>
    </div>`;

  // The item level is the campaign's own gauge of how far in an item turns up;
  // the shop tab has no such number, so it sits with the price rather than as
  // a stat box pretending to be a bonus.
  const level = item.level ? `<span class="detail-price" style="color:var(--text-dim);">Level ${item.level}</span>` : '';

  const itemHtml = `
    <div class="detail-header">
      ${itemIcon(item, 64) ? `<div class="item-detail-icon" ${itemIcon(item, 64)}></div>` : ''}
      <div style="flex:1;">
        <div class="detail-title">
          ${item.name}
          ${priceHtml(item) ? `<span class="detail-price">${priceHtml(item, '&nbsp; ')}</span>` : ''}
          ${level}
        </div>
        <div class="detail-subtitle card-tags-row" style="margin-top:6px;">
          ${campaignTags(item)}
          ${effectTypeTags(item)}
        </div>
      </div>
    </div>
    ${item.description ? `<p style="color:var(--text); line-height:1.6; margin-bottom:16px; white-space:pre-line;">${wc3Colored(item.description_colored || item.description)}</p>` : ''}
    ${statsHtml}
    ${item.notes ? `<div>
        <div style="color:var(--gold); font-size:12px; font-weight:600; margin-bottom:2px;">NOTES</div>
        <div style="color:var(--text-dim); font-size:13px; line-height:1.5; font-style:italic;">${wc3Colored(item.notes_colored || item.notes)}</div>
      </div>` : ''}
  `;

  showInlineDetail('citem-list', el, itemHtml);
}

function rerenderCampaignItems() {
  renderCampaignItems(
    document.getElementById('citem-search').value,
    document.getElementById('citem-filter-cat').value,
    document.getElementById('citem-filter-rarity').value);
}
document.getElementById('citem-search').addEventListener('input', rerenderCampaignItems);
document.getElementById('citem-filter-cat').addEventListener('change', rerenderCampaignItems);
document.getElementById('citem-filter-rarity').addEventListener('change', rerenderCampaignItems);

// ─── BUILDS ────────────────────────────────────────────────────────────────────
function renderBuilds(filter = '') {
  const grid = document.getElementById('build-list');
  const filtered = builds.filter(b =>
    b.name.toLowerCase().includes(filter.toLowerCase()) ||
    (b.hero_id && b.hero_id.includes(filter.toLowerCase())) ||
    (b.tags && b.tags.some(t => t.toLowerCase().includes(filter.toLowerCase())))
  );

  // Three different empty screens, and they mean three different things: the
  // server did not answer, nobody has saved a build yet, or the search is too
  // narrow. Showing the same blank grid for all three left the reader unable to
  // tell a broken page from an empty one.
  if (filtered.length === 0) {
    grid.innerHTML = buildsError
      ? emptyState('Builds could not be loaded.',
          'They are stored on a server this page could not reach. Check the connection and reload.')
      : builds.length === 0
        ? emptyState('No builds saved yet.', 'Create Build makes the first one.')
        : noMatches('builds', filter);
    return;
  }

  grid.innerHTML = filtered.map(b => {
    const hero = heroes.find(h => h.id === b.hero_id);
    const totalItems = [...(b.items_firstbuy || []), ...(b.items_midgame || []), ...(b.items_endgame || [])].filter(e => e && (typeof e === 'string' ? e : e.id)).length;
    const tagStr = b.tags?.length > 0 ? b.tags.map(t => `<span class="build-tag-pill">${t}</span>`).join('') : '<span style="color:var(--text-dim)">no tags</span>';

    return `
      <div class="card build-card" role="button" tabindex="0" onclick="showBuildDetail('${b.id}', this)">
        <div class="build-card-header">
          <div class="build-card-info">
            <div class="card-name">${b.name}</div>
            <div class="card-sub">${hero ? hero.name : b.hero_id} · <span style="color:var(--text-dim)">${b.author || 'Anonymous'}</span></div>
            <div class="build-card-meta">${totalItems} Items · <span class="build-tag-row">${tagStr}</span></div>
          </div>
          <div class="build-expand-icon">▼</div>
        </div>
      </div>
    `;
  }).join('');
}

function showBuildDetail(id, el) {
  const b = builds.find(b => b.id === id);
  if (!b) return;
  const soHero = heroes.find(h => h.id === b.hero_id);

  const phases = [
    { key: 'items_firstbuy', label: 'First Buy', color: 'var(--positive)' },
    { key: 'items_midgame',  label: 'Midgame',   color: 'var(--gold)' },
    { key: 'items_endgame',  label: 'Endgame',   color: 'var(--endgame)' },
  ];

  let html = `<div class="build-detail-expanded" style="margin-top:0; padding-top:0; border-top:none;">`;

  phases.forEach(({ key, label, color }) => {
    const phaseItems = (b[key] || []).map(entry => {
      const id = typeof entry === 'string' ? entry : entry.id;
      const stacks = typeof entry === 'object' && entry.stacks > 1 ? ` ×${entry.stacks}` : '';
      return { name: items.find(i => i.id === id)?.name || id, stacks };
    });
    if (phaseItems.length === 0) return;
    html += `
      <div class="build-phase-row">
        <div class="build-phase-label" style="color:${color}">${label}</div>
        <div class="build-phase-items">${phaseItems.map(({ name, stacks }) =>
          `<span class="build-item-pill">${name}${stacks ? `<span style="color:var(--gold);font-weight:700;">${stacks}</span>` : ''}</span>`
        ).join('')}</div>
      </div>`;
  });

  const legendary = (b.items_legendary || []).filter(Boolean);
  if (legendary.length > 0) {
    const legNames = legendary.map(id => items.find(i => i.id === id)?.name || id);
    html += `
      <div class="build-phase-row">
        <div class="build-phase-label" style="color:var(--endgame)">⚔ Legendary</div>
        <div class="build-phase-items">${legNames.map(n => `<span class="build-item-pill" style="border-color:var(--endgame);color:var(--endgame);">${n}</span>`).join('')}</div>
      </div>`;
  }

  if (b.skill_order && b.skill_order.some(Boolean)) {
    const KEY_LABELS = { a0: 'Q', a1: 'W', a2: 'E', a3: 'R', stats: 'S' };
    const soCells = b.skill_order.map((k) => {
      if (!k) return '';
      const label = KEY_LABELS[k] || k.toUpperCase();
      if (k === 'stats') return `<span class="so-pill so-pill-stats" title="Stats">S</span>`;
      const ab = soHero?.abilities?.[parseInt(k[1])];
      const tooltip = ab ? ab.name : label;
      return `<span class="so-pill so-pill-ability" title="${tooltip}">${label}</span>`;
    }).join('');
    html += `
      <div class="build-phase-row">
        <div class="build-phase-label">Skill Order</div>
        <div class="build-phase-items build-so-row">${soCells}</div>
      </div>`;
  }

  if (b.notes) {
    html += `<div class="build-notes">${b.notes}</div>`;
  }

  html += `<div class="build-detail-meta" style="color:var(--text-dim);font-size:11px;margin-top:10px;">
    by ${b.author || 'Anonymous'} · ${new Date(b.created_at).toLocaleDateString('en-US', { year:'numeric', month:'short', day:'numeric' })}
  </div></div>`;

  showInlineDetail('build-list', el, html);
}

document.getElementById('build-search').addEventListener('input', e => {
  renderBuilds(e.target.value);
});


// ─── MERCS ─────────────────────────────────────────────────────────────────────
function renderMercs(filter = '') {
  const grid = document.getElementById('merc-list');
  const filtered = mercs.filter(m => m.name.toLowerCase().includes(filter.toLowerCase()));

  const card = m => `
    <div class="card ${m.abilities.length === 0 ? 'card-incomplete' : ''}" role="button" tabindex="0" onclick="showMercDetail('${m.id}', this)">
      <div class="card-top-row">
        ${m.icon != null ? `<div class="item-card-icon" ${itemIconStyle(m.icon, m.icon_index, m.icon_cols || 4, m.icon_rows || 3, 56)}></div>` : ''}
        <div class="card-top-text">
          ${priceHtml(m) ? `<div class="card-cost">${priceHtml(m)}</div>` : ''}
          <div class="card-name">${m.name}</div>
        </div>
      </div>
      <div style="font-size:12px; color:var(--text-dim); margin-top:6px;">
        ${m.abilities.length > 0 ? m.abilities.map(a => `<span>${a.name}</span>`).join(' · ') : 'Not documented yet'}
      </div>
    </div>`;

  if (filtered.length === 0) {
    grid.innerHTML = noMatches('mercenaries', filter);
    return;
  }
  // mercenaries are sold by two different buildings; keep them visibly apart
  const buildings = [...new Set(filtered.map(m => m.building || 'Unknown'))].sort();
  grid.innerHTML = buildings.map(b => `
    <div class="merc-group">
      <h3 class="merc-group-title">${b}<span class="merc-group-count">${filtered.filter(m => (m.building || 'Unknown') === b).length}</span></h3>
      <div class="card-grid">
        ${filtered.filter(m => (m.building || 'Unknown') === b).map(card).join('')}
      </div>
    </div>
  `).join('');
}

function showMercDetail(id, el) {
  const merc = mercs.find(m => m.id === id);

  const abilitiesHtml = merc.abilities.length > 0
    ? merc.abilities.map(ab => `
        <div class="ability-card">
          <div class="ability-header">
            <span class="ability-name">${ab.name}</span>
            <span class="ability-type">${ab.type}</span>
          </div>
          <div class="ability-desc">${ab.description}</div>
        </div>
      `).join('')
    : '<p style="color:var(--text-dim)">Abilities not documented yet.</p>';

  const mercHtml = `
    <div class="detail-header">
      ${merc.icon != null ? `<div class="item-detail-icon" ${itemIconStyle(merc.icon, merc.icon_index, merc.icon_cols || 4, merc.icon_rows || 3, 64)}></div>` : ''}
      <div style="flex:1;">
        <div class="detail-title">${merc.name}</div>
        <div class="detail-subtitle">
          ${merc.building ? 'Building: ' + merc.building + ' · ' : ''}
          ${priceHtml(merc)}
        </div>
      </div>
    </div>
    ${merc.description ? `<p style="color:var(--text-soft); line-height:1.6; margin-bottom:16px;">${merc.description}</p>` : ''}
    ${merc.buffs.length > 0 ? `
      <div style="margin-bottom:16px;">
        <div style="color:var(--gold); font-size:12px; font-weight:600; margin-bottom:8px;">BUFFS</div>
        ${merc.buffs.map(b => `<span class="build-item-pill">${b}</span>`).join(' ')}
      </div>
    ` : ''}
    <div class="abilities-section">
      <h3>Abilities</h3>
      ${abilitiesHtml}
    </div>
    ${merc.notes ? `<div style="margin-top:12px; color:var(--text-dim); font-size:13px;">${merc.notes}</div>` : ''}
  `;
  showInlineDetail('merc-list', el, mercHtml);
}

document.getElementById('merc-search').addEventListener('input', e => {
  renderMercs(e.target.value);
});

// ─── TOWERS & BASES ────────────────────────────────────────────────────────────
// The two teams mirror each other tower for tower, so they are shown side by
// side rather than in one alphabetical list: the question a reader brings here
// is almost always "what am I walking into", and that is answered by the lane
// position, not by the unit's name.
function structureStats(s) {
  const stats = [
    ['Hit Points', s.health],
    ['HP Regeneration', s.health_regen],
    ['Armor', s.armor],
    ['Armor Type', s.armor_type],
    ['Damage', s.damage],
    ['Attack Type', s.attack_type],
    ['Attack Cooldown', s.attack_cooldown],
    // Only worth a row when the swing is not one second: since 1.3.9 every
    // tower and both bases sit at 1.00, so the figure would just repeat the
    // damage above it. Kept for the day a patch splits the cooldowns again.
    ['Damage per Second', s.damage != null && s.attack_cooldown
      && s.attack_cooldown !== 1
      ? +(s.damage / s.attack_cooldown).toFixed(1) : undefined],
    ['Attack Range', s.attack_range],
  ];
  return `<div class="level-stats-row structure-stats">${stats
    .filter(([, v]) => v !== undefined)
    .map(([label, v]) => `
      <div class="level-stat-item">
        <span class="level-stat-label">${label}</span>
        <span class="level-stat-value">${v === null ? '—' : v}</span>
      </div>`).join('')}</div>`;
}

function renderStructures(filter = '', team = '') {
  const grid = document.getElementById('structure-list');
  const filtered = structures.filter(s =>
    s.name.toLowerCase().includes(filter.toLowerCase()) &&
    (!team || s.team === team));

  const card = s => `
    <div class="card" role="button" tabindex="0" onclick="showStructureDetail('${s.id}', this)">
      <div class="card-top-row">
        <div class="item-card-icon" ${itemIconStyle(s.icon, null, 1, 1, 56)}></div>
        <div class="card-top-text">
          <div class="card-cost">${s.tier}${s.count > 1 ? ` · ${s.count} per team` : ''}</div>
          <div class="card-name">${s.name}</div>
        </div>
      </div>
      <div style="font-size:12px; color:var(--text-dim); margin-top:6px;">
        ${[
          s.health != null ? `${s.health} health` : null,
          s.damage != null ? `${s.damage} damage` : null,
          s.armor != null ? `${s.armor} armor` : null,
        ].filter(Boolean).join(' · ')}
      </div>
    </div>`;

  if (filtered.length === 0) {
    grid.innerHTML = noMatches('towers', filter);
    return;
  }
  const teams = [...new Set(filtered.map(s => s.team))];
  grid.innerHTML = teams.map(t => `
    <div class="merc-group">
      <h3 class="merc-group-title">${t}<span class="merc-group-count structure-group-count">${
        filtered.filter(s => s.team === t).length}</span></h3>
      <div class="card-grid">
        ${filtered.filter(s => s.team === t).map(card).join('')}
      </div>
    </div>
  `).join('');
}

function showStructureDetail(id, el) {
  const s = structures.find(x => x.id === id);

  const abilitiesHtml = s.abilities.length > 0
    ? s.abilities.map(ab => `
        <div class="ability-card">
          <div class="ability-header">
            <span class="ability-name">${ab.name}</span>
            <span class="ability-type">${ab.type}</span>
          </div>
          <div class="ability-desc">${ab.description}</div>
        </div>
      `).join('')
    : '<p style="color:var(--text-dim)">No abilities.</p>';

  const bounty = [];
  if (s.bounty) bounty.push(`🪙 ${s.bounty}`);
  if (s.bounty_lumber) bounty.push(`🪵 ${s.bounty_lumber}`);

  const html = `
    <div class="detail-header">
      <div class="item-detail-icon" ${itemIconStyle(s.icon, null, 1, 1, 64)}></div>
      <div style="flex:1;">
        <div class="detail-title">${s.name}</div>
        <div class="detail-subtitle">
          ${s.team} · ${s.kind} · ${s.count} per team
        </div>
      </div>
    </div>
    <p style="color:var(--text-soft); line-height:1.6; margin-bottom:16px;">${s.description}</p>
    <div class="stats-slider-section level-stats-display">${structureStats(s)}</div>
    ${bounty.length > 0 ? `
      <div style="margin-bottom:16px;">
        <div style="color:var(--gold); font-size:12px; font-weight:600; margin-bottom:8px;">BOUNTY</div>
        <span class="build-item-pill">${bounty.join(' ')}</span>
      </div>
    ` : ''}
    <div class="abilities-section">
      <h3>Abilities</h3>
      ${abilitiesHtml}
    </div>
    ${s.notes ? `<div style="margin-top:12px; color:var(--text-dim); font-size:13px;">${s.notes}</div>` : ''}
  `;
  showInlineDetail('structure-list', el, html);
}

document.getElementById('structure-search').addEventListener('input', e => {
  renderStructures(e.target.value, document.getElementById('structure-filter-team').value);
});
document.getElementById('structure-filter-team').addEventListener('change', e => {
  renderStructures(document.getElementById('structure-search').value, e.target.value);
});

// ─── BUILD CREATOR ─────────────────────────────────────────────────────────────
const PREDEFINED_TAGS = [
  'Carry', 'Semi-Carry', 'Support', 'Ganker', 'Pusher', 'Nuker', 'Tank',
  'Orb-Heavy', 'Crit', 'Lifesteal', 'AoE', 'Beginner', 'Advanced', 'Early-Game', 'Late-Game'
];
const selectedTags = new Set();

const selectedPhaseItems = {
  firstbuy:  new Array(6).fill(null),
  midgame:   new Array(6).fill(null),
  endgame:   new Array(6).fill(null),
};
const selectedPhaseStacks = {
  firstbuy:  new Array(6).fill(1),
  midgame:   new Array(6).fill(1),
  endgame:   new Array(6).fill(1),
};
const legendaryReplacements = new Array(6).fill(null);

function fillSlot(slotEl, item, phase, slotIdx, stacks) {
  slotEl.classList.remove('empty');
  slotEl.classList.add('filled');
  slotEl.title = item.name;
  if (item.icon != null) {
    slotEl.style.backgroundImage = `url('${item.icon}')`;
    slotEl.style.backgroundRepeat = 'no-repeat';
    if (item.icon_index == null) {          // standalone icon, not a sheet
      slotEl.style.backgroundSize = 'contain';
      slotEl.style.backgroundPosition = 'center';
    } else {
      const cols = item.icon_cols || 4, rows = item.icon_rows || 3;
      const col = item.icon_index % cols, row = Math.floor(item.icon_index / cols);
      const xPct = cols > 1 ? (col / (cols - 1)) * 100 : 0;
      const yPct = rows > 1 ? (row / (rows - 1)) * 100 : 0;
      slotEl.style.backgroundSize = `${cols * 100}% ${rows * 100}%`;
      slotEl.style.backgroundPosition = `${xPct.toFixed(2)}% ${yPct.toFixed(2)}%`;
    }
    slotEl.classList.add('has-icon');
  }
  const stackBadge = item.upgrade_tiers
    ? `<div class="slot-stack-badge" onclick="cycleStack(event,'${phase}',${slotIdx})">×${stacks}</div>`
    : '';
  slotEl.innerHTML = `${stackBadge}<div class="remove-item">×</div>`;
}

function clearSlot(slotEl, isLegendary) {
  slotEl.classList.remove('filled', 'has-icon');
  slotEl.classList.add('empty');
  slotEl.title = '';
  slotEl.style.backgroundImage = '';
  slotEl.style.backgroundSize = '';
  slotEl.style.backgroundPosition = '';
  slotEl.style.backgroundRepeat = '';
  slotEl.innerHTML = isLegendary ? '—' : '+';
}

function cycleStack(event, phase, slotIdx) {
  event.stopPropagation();
  const id = selectedPhaseItems[phase][slotIdx];
  const item = items.find(i => i.id === id);
  if (!item || !item.upgrade_tiers) return;
  selectedPhaseStacks[phase][slotIdx] = (selectedPhaseStacks[phase][slotIdx] % item.upgrade_tiers) + 1;
  const slot = document.querySelector(`#bc-slots-${phase} .item-slot[data-slot="${slotIdx}"]`);
  const badge = slot.querySelector('.slot-stack-badge');
  if (badge) badge.textContent = `×${selectedPhaseStacks[phase][slotIdx]}`;
  updateCreatorPreview();
}

function populateBuildCreator() {
  const sel = document.getElementById('bc-hero');
  heroes.forEach(h => {
    const opt = document.createElement('option');
    opt.value = h.id;
    opt.textContent = h.name;
    sel.appendChild(opt);
  });

  // Render predefined tag buttons
  const container = document.getElementById('bc-tags-container');
  container.innerHTML = PREDEFINED_TAGS.map(t =>
    `<button type="button" class="tag-btn" data-tag="${t}">${t}</button>`
  ).join('');
  container.addEventListener('click', e => {
    const btn = e.target.closest('.tag-btn');
    if (!btn) return;
    const tag = btn.dataset.tag;
    if (selectedTags.has(tag)) {
      selectedTags.delete(tag);
      btn.classList.remove('active');
    } else {
      selectedTags.add(tag);
      btn.classList.add('active');
    }
  });
}

// ─── SKILL ORDER ───────────────────────────────────────────────────────────────
// Twenty, because that is where MaxHeroLevel in the map's war3mapMisc.txt
// stops since 1.3.9 -- the grid used to offer five levels the game never
// hands out. Builds saved with the old 25-cell array still render: the
// saved-build view maps over whatever length it was given.
const SKILL_LEVELS = 20;
const skillOrder = new Array(SKILL_LEVELS).fill(null); // null | 'a0'|'a1'|'a2'|'a3'|'stats'

function renderSkillOrderGrid(hero) {
  const section = document.getElementById('bc-skillorder-section');
  const grid = document.getElementById('bc-skillorder-grid');
  if (!hero || !hero.abilities || hero.abilities.length === 0) {
    section.classList.add('hidden');
    return;
  }
  section.classList.remove('hidden');

  const abilities = hero.abilities.slice(0, 4);
  // The key the game actually binds, not the slot. Mini-Dota leaves hero
  // spells on their base-game hotkeys -- Blizzard is B, Hex is X -- so a QWER
  // strip here was telling the reader to press the wrong letter. A passive has
  // no key to press and gets none.
  const rows = [
    ...abilities.map((ab, i) => ({ key: `a${i}`, label: ab.name, shortLabel: ab.hotkey || '', maxRank: ab.levels?.length || 6 })),
    { key: 'stats', label: 'Stats', shortLabel: 'S', maxRank: 6 }
  ];

  // Count current ranks per skill
  const ranks = { a0:0, a1:0, a2:0, a3:0, stats:0 };
  skillOrder.forEach(k => { if (k) ranks[k]++; });

  let html = `<div class="so-grid">`;
  // Header row: levels
  html += `<div class="so-row so-header"><div class="so-label"></div>`;
  for (let l = 1; l <= SKILL_LEVELS; l++) html += `<div class="so-cell so-head">${l}</div>`;
  html += `</div>`;

  // One row per ability + stats
  rows.forEach(row => {
    const rankNow = ranks[row.key];
    html += `<div class="so-row" data-skill="${row.key}">`;
    // The full name, cut by CSS if the column really runs out. Chopping the
    // string at ten characters in JavaScript turned Summon Bear, Summon
    // Quilbeast and Summon Hawk into "Summon Bea…", "Summon Qui…" and "Summon
    // Haw…" -- three rows you had to hover to tell apart, in the one place on
    // the site where you are choosing between them.
    html += `<div class="so-label" title="${row.label}"><span class="so-key">${row.shortLabel}</span><span class="so-key-name">${row.label}</span></div>`;
    for (let l = 0; l < SKILL_LEVELS; l++) {
      const selected = skillOrder[l] === row.key;
      const rankAtThisLevel = selected ? countRankUpTo(row.key, l) : '';
      const display = selected
        ? (row.key === 'stats' ? `+${rankAtThisLevel}` : rankAtThisLevel)
        : '';
      html += `<div class="so-cell${selected ? ' so-selected' : ''}" data-level="${l}" data-skill="${row.key}" onclick="toggleSkillPoint(${l},'${row.key}')">${display}</div>`;
    }
    html += `</div>`;
  });
  html += `</div>`;
  grid.innerHTML = html;
}

function countRankUpTo(skillKey, upToLevel) {
  let rank = 0;
  for (let i = 0; i <= upToLevel; i++) {
    if (skillOrder[i] === skillKey) rank++;
  }
  return rank;
}

function toggleSkillPoint(level, skillKey) {
  const heroId = document.getElementById('bc-hero').value;
  const hero = heroes.find(h => h.id === heroId);
  if (!hero) return;

  if (skillOrder[level] === skillKey) {
    skillOrder[level] = null;
  } else {
    const maxRank = skillKey === 'stats' ? 6 : (hero.abilities[parseInt(skillKey[1])]?.levels?.length || 6);
    const currentRank = skillOrder.filter(k => k === skillKey).length;
    if (currentRank >= maxRank) { showToast(`Max. ${maxRank} ranks for this skill`); return; }
    skillOrder[level] = skillKey;
  }
  renderSkillOrderGrid(hero);
  updateCreatorPreview();
}

document.getElementById('bc-hero').addEventListener('change', e => {
  const hero = heroes.find(h => h.id === e.target.value);
  skillOrder.fill(null);
  renderSkillOrderGrid(hero);
  updateCreatorPreview();
});

function openPicker(phase, slotIdx, mode) {
  activePhase = phase;
  activeSlot = slotIdx;
  pickerMode = mode;
  const picker = document.getElementById('bc-item-picker');
  picker.classList.remove('hidden');
  document.getElementById('bc-item-search').value = '';
  renderPickerItems('');
  document.getElementById('bc-item-search').focus();
}

['firstbuy', 'midgame', 'endgame'].forEach(phase => {
  document.getElementById(`bc-slots-${phase}`).addEventListener('click', e => {
    const slot = e.target.closest('.item-slot');
    if (!slot) return;
    const idx = parseInt(slot.dataset.slot);
    if (slot.classList.contains('filled')) {
      if (e.target.closest('.remove-item')) {
        selectedPhaseItems[phase][idx] = null;
        selectedPhaseStacks[phase][idx] = 1;
        clearSlot(slot, false);
        updateCreatorPreview();
      }
      return;
    }
    openPicker(phase, idx, 'item');
  });
});

document.getElementById('bc-slots-legendary').addEventListener('click', e => {
  const slot = e.target.closest('.item-slot');
  if (!slot) return;
  const idx = parseInt(slot.dataset.slot);
  if (slot.classList.contains('filled')) {
    if (e.target.closest('.remove-item')) {
      legendaryReplacements[idx] = null;
      clearSlot(slot, true);
      updateCreatorPreview();
    }
    return;
  }
  openPicker('legendary', idx, 'legendary');
});

document.getElementById('bc-item-search').addEventListener('input', e => {
  renderPickerItems(e.target.value);
});

function renderPickerItems(filter) {
  const list = document.getElementById('bc-item-picker-list');
  const pool = pickerMode === 'legendary'
    ? items.filter(it => it.category === 'Black Market')
    : items;
  const filtered = pool.filter(it => it.name.toLowerCase().includes(filter.toLowerCase()));
  list.innerHTML = filtered.map(it => `
    <div class="picker-item" onclick="selectItem('${it.id}')">
      <span class="picker-item-name">${it.name}</span>
      <span class="picker-item-cat tag-${it.category.replace(/ /g, '-')}" style="padding:2px 6px; border-radius:4px;">${it.category}</span>
    </div>
  `).join('');
}

function selectItem(id) {
  if (activeSlot === null) return;
  const item = items.find(i => i.id === id);

  if (pickerMode === 'legendary') {
    legendaryReplacements[activeSlot] = id;
    const slot = document.querySelector(`#bc-slots-legendary .item-slot[data-slot="${activeSlot}"]`);
    slot.classList.remove('empty');
    slot.classList.add('filled');
    slot.innerHTML = `${item.name}<div class="remove-item">×</div>`;
  } else {
    const phase = activePhase, slotIdx = activeSlot;
    selectedPhaseItems[phase][slotIdx] = id;
    selectedPhaseStacks[phase][slotIdx] = 1;
    const slot = document.querySelector(`#bc-slots-${phase} .item-slot[data-slot="${slotIdx}"]`);
    fillSlot(slot, item, phase, slotIdx, 1);
  }

  document.getElementById('bc-item-picker').classList.add('hidden');
  activeSlot = null;
  activePhase = null;
  updateCreatorPreview();
}

function phasePreviewHTML(phase, label) {
  const entries = selectedPhaseItems[phase]
    .map((id, i) => id ? { name: items.find(it => it.id === id)?.name || id, stacks: selectedPhaseStacks[phase][i] } : null)
    .filter(Boolean);
  if (entries.length === 0) return '';
  return `
    <div style="margin-bottom:10px;">
      <div style="font-size:11px; text-transform:uppercase; letter-spacing:1px; color:var(--text-dim); margin-bottom:4px;">${label}</div>
      <div class="preview-items">${entries.map(({ name, stacks }) =>
        `<span class="preview-item">${name}${stacks > 1 ? ` <span style="color:var(--gold)">×${stacks}</span>` : ''}</span>`
      ).join('')}</div>
    </div>`;
}

function updateCreatorPreview() {
  const heroId = document.getElementById('bc-hero').value;
  const name = document.getElementById('bc-name').value;
  const preview = document.getElementById('bc-preview');
  const content = document.getElementById('bc-preview-content');

  const anyItem = Object.values(selectedPhaseItems).some(arr => arr.some(Boolean));
  if (!heroId && !anyItem) { preview.classList.add('hidden'); return; }

  preview.classList.remove('hidden');
  const hero = heroes.find(h => h.id === heroId);

  const legendaryFilled = legendaryReplacements.filter(Boolean);
  const legendaryHTML = legendaryFilled.length > 0 ? `
    <div style="margin-bottom:10px;">
      <div style="font-size:11px; text-transform:uppercase; letter-spacing:1px; color:var(--endgame); margin-bottom:4px;">⚔ Legendary Ersatz</div>
      <div class="preview-items">${legendaryReplacements.map((id, i) => id
        ? `<span class="preview-item" style="border-color:var(--endgame); color:var(--endgame);" title="Ersetzt Slot ${i+1}">${items.find(it => it.id === id)?.name || id}</span>`
        : '').join('')}</div>
    </div>` : '';

  content.innerHTML = `
    <div style="color:var(--gold-light); margin-bottom:12px; font-size:15px;">${name || '(No Name)'} — ${hero ? hero.name : '?'}</div>
    ${phasePreviewHTML('firstbuy', 'First Buy')}
    ${phasePreviewHTML('midgame', 'Midgame')}
    ${phasePreviewHTML('endgame', 'Endgame')}
    ${legendaryHTML}
  `;
}

document.getElementById('bc-name').addEventListener('input', updateCreatorPreview);

document.getElementById('bc-save').addEventListener('click', async () => {
  const name = document.getElementById('bc-name').value.trim();
  const heroId = document.getElementById('bc-hero').value;
  const author = document.getElementById('bc-author').value.trim() || 'Anonymous';
  const notes = document.getElementById('bc-notes').value.trim();
  const tags = [...selectedTags];

  if (!name) { showToast('Please enter a build name'); return; }
  if (!heroId) { showToast('Please select a hero'); return; }

  const btn = document.getElementById('bc-save');
  btn.disabled = true;
  btn.textContent = 'Saving…';

  const build = {
    name,
    hero_id: heroId,
    author,
    items_firstbuy: selectedPhaseItems.firstbuy
      .map((id, i) => id ? { id, stacks: selectedPhaseStacks.firstbuy[i] } : null).filter(Boolean),
    items_midgame: selectedPhaseItems.midgame
      .map((id, i) => id ? { id, stacks: selectedPhaseStacks.midgame[i] } : null).filter(Boolean),
    items_endgame: selectedPhaseItems.endgame
      .map((id, i) => id ? { id, stacks: selectedPhaseStacks.endgame[i] } : null).filter(Boolean),
    items_legendary: legendaryReplacements.filter(Boolean),
    skill_order: [...skillOrder],
    notes,
    tags,
  };

  const { error } = await _sbc.from('community_builds').insert([build]);
  btn.disabled = false;
  btn.textContent = 'Save Build';

  if (error) { console.error(error); showToast('Error saving build!'); return; }

  await loadBuildsFromSupabase();

  // Reset form
  document.getElementById('bc-name').value = '';
  document.getElementById('bc-hero').value = '';
  document.getElementById('bc-notes').value = '';
  selectedTags.clear();
  document.querySelectorAll('#bc-tags-container .tag-btn').forEach(b => b.classList.remove('active'));
  Object.keys(selectedPhaseItems).forEach(p => selectedPhaseItems[p].fill(null));
  Object.keys(selectedPhaseStacks).forEach(p => selectedPhaseStacks[p].fill(1));
  legendaryReplacements.fill(null);
  skillOrder.fill(null);
  document.getElementById('bc-skillorder-section').classList.add('hidden');
  document.querySelectorAll('#tab-build-creator .item-slot').forEach(s => {
    clearSlot(s, s.classList.contains('legendary-slot'));
  });
  document.getElementById('bc-preview').classList.add('hidden');
  document.getElementById('bc-item-picker').classList.add('hidden');

  showToast('Build saved!');
  document.querySelector('.nav-btn[data-tab="builds"]').click();
});


// ─── INLINE DETAIL PANEL ───────────────────────────────────────────────────────
function showInlineDetail(gridId, cardEl, htmlContent) {
  const grid = document.getElementById(gridId);
  const existing = grid.querySelector('.inline-detail');
  const alreadySelected = cardEl.classList.contains('selected');

  if (existing) existing.remove();
  grid.querySelectorAll('.card').forEach(c => c.classList.remove('selected'));

  if (alreadySelected) return;

  cardEl.classList.add('selected');

  // Find the last card in the same visual row
  const cardTop = cardEl.getBoundingClientRect().top;
  const allCards = [...grid.querySelectorAll('.card')];
  let lastInRow = cardEl;
  allCards.forEach(c => {
    if (Math.abs(c.getBoundingClientRect().top - cardTop) < 5) {
      if (allCards.indexOf(c) > allCards.indexOf(lastInRow)) lastInRow = c;
    }
  });

  const panel = document.createElement('div');
  panel.className = 'detail-panel inline-detail';
  panel.innerHTML = htmlContent;
  lastInRow.after(panel);
  // Scroll to the card, not to the panel. A hero's panel is several screens
  // tall, so asking to bring *it* into view put its top edge against the header
  // and shoved the grid off the top -- you landed on the hero you picked with
  // no way back to the others but scrolling up. Aiming at the card parks the
  // row you clicked from just under the header with the panel opening directly
  // beneath it, so the next hero is one click away instead of one scroll.
  // html{scroll-padding-top} is what keeps the row clear of the sticky header.
  cardEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ─── HELPERS ───────────────────────────────────────────────────────────────────

// Stat keys are stored the way the map names them (agi, bonus_dmg, aura_dmg_pct).
// Nothing reaches the page abbreviated: every short form is spelled out, and a
// trailing _pct leaves the label entirely -- the percent sign rides on the
// number instead, so a stat reads "+20% Attack Speed".
// The fields of an ability that are the card itself -- its name, its picture,
// its ladder -- rather than a number the card has to state. Everything else on
// a spell is a stat, and gets printed whether or not anyone remembered to add
// a line for it here.
const ABILITY_STRUCTURAL = new Set([
  'name', 'type', 'description', 'hotkey', 'icon', 'levels',
  'required_level', 'hero_level_required',
  // its own table under the ladder, not a column in it
  'scaling',
  // where the art sits in its sheet, and where the entry came from: bookkeeping
  // for the importer, not something a player reads off the spell
  'sprite_index', 'from_base_game',
]);

const STAT_WORDS = {
  str: 'Strength', agi: 'Agility', int: 'Intelligence',
  dmg: 'Damage', dot: 'DoT', aoe: 'Area of Effect',
  // The one abbreviation the site keeps. "Immolation Damage 10" reads as a
  // per-hit number; the value is damage *per second*, and DPS is what the
  // player already calls it -- spelling it out would only make the box wrap.
  dps: 'DPS',
  hp: 'Hit Points', xp: 'XP', pct: '%', mult: 'Multiplier',
  regen: 'Regeneration', invis: 'Invisibility', sec: 'Second',
  move: 'Movement', crit: 'Critical',
  // the map says "attack rate", the site says attack speed -- one name for it
  rate: 'Speed',
};

// Only for names the word-by-word rule cannot reach: "life_steal" is one word in
// English, and these two read better trimmed than spelled out in full.
const STAT_LABELS = {
  life_steal_pct: 'Lifesteal',
  lifesteal_pct: 'Lifesteal',
  // An item has one range, one area and one cooldown, and they belong to the
  // active -- saying "Active" in front of them adds a word and no meaning.
  // "Active Damage" keeps its prefix: the item also carries damage of its own.
  active_cooldown: 'Cooldown',
  active_range: 'Range',
  // Duration belongs with them for the same reason, and had been missing: on
  // Voodoo Doll, whose stats are all its active and so never split into their
  // own block, the label came through the word-by-word rule as "Active
  // Duration" -- while Unholy Shield, which does split, showed the same stat as
  // "Duration". One entry settles both.
  active_duration: 'Duration',
  active_aoe: 'Area of Effect',
  // Mana is the one that does not follow them. Range, area and cooldown belong
  // to the active and to nothing else, so under its heading they need no
  // qualifier -- but mana is also a flat bonus several items grant, and Unholy
  // Shield grants both: 300 to the pool under STATS, 50 charged per cast under
  // ACTIVE. Two boxes reading "Mana" said the item gives mana twice. The cost
  // keeps the word that tells them apart wherever it appears.
  active_mana: 'Mana Cost',
  summon_unit: 'Unit',
  // The table is inside Force of Nature's own block and every other column in it
  // is the treant's -- repeating the word in the header only made the column
  // wider than the numbers under it.
  treant_hp: 'Hit Points',
  aura_move_pct: 'Aura Movement Speed',
  // Under the AURA heading the sibling item's aura_dmg_pct is simply "Damage",
  // because Command Aura buffs everyone and there is nobody to name. Trueshot
  // Aura buffs only ranged units, so the label has to say whose damage this is
  // -- and the word-by-word rule was rendering it "Damage Ranged", which is not
  // English. "Ranged Unit Damage" is the unambiguous version, naming the unit
  // the way "Damage to Summons" above names who the damage lands on, but at
  // eighteen characters it wrapped the box onto a second line and a stat box
  // has no room for one. Two words is what fits, so the label leans on the
  // context the box already sits in: the heading over it says AURA and the
  // description a few lines up says "increases attack damage of ranged units",
  // which is what stops "Ranged Damage" being read as a damage type.
  aura_dmg_ranged_pct: 'Ranged Damage',
  // the box above already says what is being restored, so the one below it
  // only has to say how long that takes
  hp_restore_duration: 'Duration',
  mana_restore_duration: 'Duration',
  reveal_duration: 'Duration',
  dark_minion_duration: 'Summon Duration',
  bonus_dmg: 'Damage',
  bonus_damage: 'Damage',
  // The flat pool spells "Hit Points" out; the regeneration line is long
  // enough already, so it keeps the short form.
  hp_regen: 'HP Regeneration',
  // "Damage Summoned" reads like a stat about summoning something; what these
  // actually say is who the damage lands on.
  active_dmg_summoned: 'Damage to Summons',
  dmg_summoned: 'Damage to Summons',
  bonus_dmg_summoned: 'Damage to Summons',
  // What the map calls a spell damage reduction, players call resistance.
  spell_dmg_reduction_pct: 'Spell Resistance',
  // The description already says the attack becomes ranged; the stat box only
  // has to surface the consequence a reader would otherwise miss.
  ranged: 'Attacks Air',
  armor_reduction_duration: 'Effect Duration',
  heal_reduction_duration: 'Effect Duration',
  // The effect is named on the line above ("+10% Cleave", "10 Immolation
  // DPS", "30% Splash Damage"), so repeating it in front of the area only makes
  // the line wrap -- which is exactly what "Splash Area of Effect" did on Orb
  // of Fire and Firehand Gauntlets.
  immolation_aoe: 'Area of Effect',
  cleave_aoe: 'Area of Effect',
  splash_aoe: 'Area of Effect',
  // The map's own tooltip heads this effect "Splash Damage", and the bare
  // "Splash" left the number saying 30% of nothing in particular. It is also
  // what makes the box below it work: "Area of Effect" only reads as the splash
  // radius because the box before it has named the splash.
  splash_pct: 'Splash Damage',
  cyclone_duration: 'Duration',
  illusion_duration: 'Duration',
  // Everything in this block is the illusion, so the label does not have to say
  // so again -- and the spelled-out version wrapped onto a second line, which is
  // the one thing a stat box has no room for.
  illusion_dmg_taken_pct: 'Damage Taken',
  invis_duration: 'Duration',
  // A trailing "units" or "heroes" on a spell says who the number lands on,
  // not what is being counted -- "Duration Units" reads like a count of units.
  // The lightning and slow orbs roll three separate chances -- the World
  // Editor calls them "Chance To Hit Heroes / Summons / Units" -- and only the
  // hero one reaches the prose, so each box has to name who it is against.
  chance_heroes_pct: 'Chance vs Heroes',
  chance_units_pct: 'Chance vs Units',
  chance_summons_pct: 'Chance vs Summons',
  duration_units: 'Duration vs Units',
  duration_heroes: 'Duration vs Heroes',
  stun_units: 'Stun Duration vs Units',
  stun_heroes: 'Stun Duration vs Heroes',
  // "Gold Bounty" is what the World Editor calls the field, and this map pays in
  // lumber too -- the currency belongs in the name.
  bounty: 'Gold Bounty',
  // "X Damage" in this game names a damage type -- Chaos Damage, Magic Damage --
  // so "Units Damage" reads like a kind of damage and "Building Damage" like
  // damage a building deals. "Damage to X" can only mean who is on the receiving
  // end, and it takes the plural in both. Only spells that really split the two
  // carry these; where one number covers everything the key is plain `damage`.
  dmg_units: 'Damage to Units',
  // Blizzard's building number is stored in the map as a factor of the unit
  // damage. A factor is not a number a reader can use -- "0.45" says nothing
  // until you multiply it by the column beside it -- so the data carries the
  // product instead.
  dmg_buildings: 'Damage to Buildings',
  magic_dmg_amp_pct: 'Magic Damage Amplification',
  // A falloff means nothing without saying what it falls off per, and the
  // conditional bonus means nothing without naming the condition.
  damage_falloff_pct: 'Jump Reduction',
  heal_falloff_pct: 'Healing Falloff per Bounce',
};

function statLabel(key) {
  if (STAT_LABELS[key]) return STAT_LABELS[key];
  return key.replace(/_pct$/, '').split('_')
    // `in`, not `||`: a word mapped to '' is one the label drops on purpose,
    // and falling back would spell it out again as "Dps".
    .map(w => w in STAT_WORDS ? STAT_WORDS[w] : w.charAt(0).toUpperCase() + w.slice(1))
    .filter(Boolean)
    .join(' ');
}

// A price shows only the currencies it is actually paid in. Gold Coins cost a
// lumber and no gold, and "0 gold" is noise the same way "0 lumber" would be.
// Each currency glyph gets its own element. It carries no styling of its own
// here, but it is the only handle a stylesheet has on the icon: a price is one
// text node, so without it a theme can reach the first glyph with
// ::first-letter and the second one not at all -- which is how the lumber icon
// ended up sitting a pixel and a half below the coin on Searing Blade.
function priceHtml(it, sep = ' ') {
  const parts = [];
  if (it.cost) parts.push(`<span class="price-icon">🪙</span> ${it.cost}`);
  if (it.cost_lumber) parts.push(`<span class="price-icon">🪵</span> ${it.cost_lumber}`);
  return parts.join(sep);
}

// The shop tag, unless the item says its own tags describe it better -- the
// boots are all in the Special stock, but what a reader wants off the card is
// that they give movement speed. The section heading still shows the shop.
function shopTag(it) {
  if (it.hide_shop_tag) return '';
  return `<span class="card-tag tag-${it.category.replace(/ /g, '-')}">${tagLabel(it.category)}</span>`;
}

// How the item works -- active, passive, on attack -- said as a tag rather than
// as the raw effect_type string. A part the header already shows is dropped:
// the Staff of Silence lists "Active" in its own tags, and an item with aura
// stats has the Aura tag from its numbers.
const TYPE_LABELS = {
  active: 'Active', passive: 'Passive', on_attack: 'On Attack',
  aura: 'Aura', unit: 'Unit',
};
function effectTypeTags(it) {
  const shown = new Set([...(it.tags || []), ...(hasAura(it) ? ['Aura'] : [])]);
  return (it.effect_type || '').split('+')
    .map(part => TYPE_LABELS[part.trim()])
    .filter(label => label && !shown.has(label))
    .map(label => `<span class="card-tag tag-${label.replace(/ /g, '-')}">${label}</span>`)
    .join('');
}

// An item sold in one shop can still behave like another kind: the Scepter of
// Avarice sits with the Special stock but is consumed on use. `tags` in the
// data adds those extra labels next to the shop tag.
function extraTags(it, style = '') {
  return (it.tags || [])
    .map(t => `<span class="card-tag tag-${t.replace(/ /g, '-')}"${style ? ` style="${style}"` : ''}>${t}</span>`)
    .join('');
}

// Read off the stats rather than a hand-set flag: an item carries an aura
// exactly when it has an aura_* stat, so the tag cannot drift from the numbers.
function hasAura(it) {
  return Object.keys(it.stats || {})
    .some(k => k === 'aura' || k.startsWith('aura_'));
}

// The flat bonuses a hero simply carries. Everything else a stat can describe
// -- a slow, a splash, a proc chance -- is the item doing something, and lands
// in its own block instead.
const FLAT_STATS = new Set([
  'str', 'agi', 'int', 'armor', 'hp', 'mana', 'hp_regen', 'mana_regen_pct',
  // bonus_dmg_summoned is deliberately absent: it only lands on the item's
  // proc, so it belongs with the effect rather than with the flat bonuses.
  'bonus_dmg', 'attack_speed_pct', 'move_speed',
  'evasion_pct', 'spell_dmg_reduction_pct', 'ranged', 'charges', 'uses',
  'inventory_slots', 'flying', 'divine_shield', 'gold_gain', 'lumber_gain',
  'xp_gain', 'level_gain', 'aoe', 'duration', 'summons', 'summon_unit',
]);

// How many times the item can be used is not a bonus it grants; it is the
// footnote under whatever it grants. These sort behind every other stat
// instead of taking a place in the reading order below.
const CHARGE_STATS = new Set(['charges', 'uses']);

// "Attacks Air" is not a line the map's tooltip carries -- the site reads it off
// the `ranged` flag and surfaces it because a melee hero picking up an orb would
// otherwise not learn that the orb is what lets him hit air. Being an addition
// rather than one of the item's stated bonuses, it has no natural place among
// them, and the data file duly put it first on eight items, second on one and
// third on three. It goes last on all of them instead, so the bonuses the map
// does state stay in an unbroken run and read in the order the map states them.
const TAIL_STATS = new Set(['ranged']);

// There is no reading order table any more: the order an item lists its stats
// in *is* the reading order, so changing what a box sits next to is an edit to
// data/items.json, not to this file.

// Same idea as the aura block: the heading says "active", the label need not.
// The stripped key is the fallback, not the first move: a couple of stats mean
// something different under ACTIVE than the same word means as a flat bonus --
// `mana` is the pool the item adds, `active_mana` is what casting it costs --
// so an entry written against the full key wins, exactly as in auraLabel.
function activeLabel(key) {
  return STAT_LABELS[key] || statLabel(key.replace(/^active_/, ''));
}

// A stack tier is a one-line phrase in a box barely wider than it, so it takes
// the shortest label that is still unambiguous -- and only here. STATS has room
// and keeps the full wording; these overrides do not leak into it.
const STACK_LABELS = {
  // Nothing else in the database is a reduction, so the qualifier only costs
  // width. Under STATS it stays "Spell Resistance".
  spell_dmg_reduction_pct: 'Reduction',
};

function stackLabel(key) {
  // "+125 Active Damage" reads as a kind of damage rather than as the damage an
  // active does. Same trim the ACTIVE block already makes.
  return STACK_LABELS[key] || activeLabel(key);
}

// Inside the AURA block the heading already says "aura", so the label drops it.
function auraLabel(key) {
  if (key === 'aura') return 'Effect';
  const explicit = STAT_LABELS[key];
  return explicit ? explicit.replace(/^Aura /, '')
                  : statLabel(key.replace(/^aura_/, ''));
}

function statValue(key, v) {
  if (v === true) return '✓';
  if (v == null) return '—';
  // Values are stored the way the data files write them ("magic", "on_corpse");
  // what the page shows is prose, so it reads as words and starts in caps.
  if (typeof v === 'string') {
    return v.replace(/_/g, ' ').replace(/\b[a-z]/g, c => c.toUpperCase());
  }
  return key.endsWith('_pct') ? `${v}%` : v;
}

function showToast(msg) {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.classList.remove('hidden');
  setTimeout(() => toast.classList.add('hidden'), 2500);
}

// ─── INIT ──────────────────────────────────────────────────────────────────────
loadData();
