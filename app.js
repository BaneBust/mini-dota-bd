// ─── SUPABASE ──────────────────────────────────────────────────────────────────
const _sbc = window.supabase.createClient(
  'https://egtlxndritlrinyicapf.supabase.co',
  'sb_publishable_HpgY5OAIqX5JSb5CQ_nGmw_czK8Xezj'
);

let heroes = [];
let items = [];
let builds = [];
let mercs = [];
let activeSlot = null;
let activePhase = null;
let pickerMode = 'item'; // 'item' or 'legendary'
let detailHeroId = null;

async function loadData() {
  [heroes, items, mercs] = await Promise.all([
    fetch('data/heroes.json').then(r => r.json()).then(d => d.heroes),
    fetch('data/items.json').then(r => r.json()).then(d => d.items),
    fetch('data/mercs.json').then(r => r.json()).then(d => d.mercs),
  ]);
  renderHeroes();
  renderItems();
  renderMercs();
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
  if (error) { console.error(error); showToast('Error loading builds'); return; }
  builds = data || [];
  renderBuilds();
}

// ─── NAV ───────────────────────────────────────────────────────────────────────
document.querySelectorAll('.nav-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
  });
});

// ─── HEROES ────────────────────────────────────────────────────────────────────
function renderHeroes(filter = '', statFilter = '') {
  const grid = document.getElementById('hero-list');
  const filtered = heroes.filter(h => {
    const matchName = h.name.toLowerCase().includes(filter.toLowerCase());
    const matchStat = !statFilter || h.primary_stat === statFilter;
    return matchName && matchStat;
  });

  grid.innerHTML = filtered.map(h => `
    <div class="card ${h.abilities.length === 0 ? 'card-incomplete' : ''}" onclick="showHeroDetail('${h.id}', this)">
      <div class="card-name">${h.name}</div>
      ${h.lore_name ? `<div class="card-sub">${h.lore_name}</div>` : ''}
      <span class="card-tag tag-${h.primary_stat || 'unknown'}">${h.primary_stat || '?'}</span>
    </div>
  `).join('');
}

function statDelta(curr, prev, key) {
  if (!prev || curr[key] == null || prev[key] == null) return '';
  const d = (parseFloat(curr[key]) - parseFloat(prev[key]));
  if (d === 0) return '';
  return `<span class="stat-delta">+${Number.isInteger(d) ? d : d.toFixed(1)}</span>`;
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
        <span class="level-stat-label">HP</span>
        <span class="level-stat-value">${s.hp ?? '?'} ${statDelta(s, prev, 'hp')}</span>
      </div>
      <div class="level-stat-item">
        <span class="level-stat-label">Mana</span>
        <span class="level-stat-value">${s.mana ?? '?'} ${statDelta(s, prev, 'mana')}</span>
      </div>
      <div class="level-stat-item">
        <span class="level-stat-label">DMG</span>
        <span class="level-stat-value">${s.damage_min ?? '?'}–${s.damage_max ?? '?'}</span>
      </div>
      <div class="level-stat-item">
        <span class="level-stat-label" style="color:var(--str)">STR</span>
        <span class="level-stat-value" style="color:var(--str)">${s.str != null ? parseFloat(s.str).toFixed(1) : '?'} ${statDelta(s, prev, 'str')}</span>
      </div>
      <div class="level-stat-item">
        <span class="level-stat-label" style="color:var(--agi)">AGI</span>
        <span class="level-stat-value" style="color:var(--agi)">${s.agi != null ? parseFloat(s.agi).toFixed(1) : '?'} ${statDelta(s, prev, 'agi')}</span>
      </div>
      <div class="level-stat-item">
        <span class="level-stat-label" style="color:var(--int)">INT</span>
        <span class="level-stat-value" style="color:var(--int)">${s.int != null ? parseFloat(s.int).toFixed(1) : '?'} ${statDelta(s, prev, 'int')}</span>
      </div>
      ${s.armor != null ? `<div class="level-stat-item"><span class="level-stat-label">Armor</span><span class="level-stat-value">${s.armor} ${statDelta(s, prev, 'armor')}</span></div>` : ''}
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

  const spritePositions = ['0%', '33.33%', '66.67%', '100%'];
  const abilitiesHtml = hero.abilities.length > 0 ? hero.abilities.map((ab, idx) => {
    const levelRows = ab.levels.map((lv, i) => {
      const keys = Object.keys(lv).filter(k => k !== 'rank');
      return `<tr><td>Rank ${lv.rank}</td>${keys.map(k => `<td>${lv[k] ?? '—'}</td>`).join('')}</tr>`;
    });
    const keys = ab.levels[0] ? Object.keys(ab.levels[0]).filter(k => k !== 'rank') : [];
    const iconHtml = hero.spell_icon_sprite && idx < 4
      ? `<div class="ability-icon" style="background-image:url('${hero.spell_icon_sprite}');background-position:${spritePositions[ab.sprite_index ?? idx]} 0%"></div>`
      : '';
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
        ${ab.area ? `<div class="ability-req">Area: ${ab.area}</div>` : ''}
        ${keys.length > 0 ? `
          <table class="levels-table">
            <thead><tr><th>Rank</th>${keys.map(k => `<th>${formatKey(k)}</th>`).join('')}</tr></thead>
            <tbody>${levelRows.join('')}</tbody>
          </table>
        ` : ''}
      </div>
    `;
  }).join('') : '<p style="color:var(--text-dim)">Abilities not yet documented.</p>';

  const heroHtml = `
    <div class="detail-header">
      <div>
        <div class="detail-title">${hero.name}</div>
        <div class="detail-subtitle">
          ${hero.lore_name ? hero.lore_name + ' · ' : ''}
          ${hero.race ? hero.race + ' · ' : ''}
          Primärattribut: <span style="color:var(--${hero.primary_stat?.toLowerCase() || 'text-dim'})">${hero.primary_stat || 'Unbekannt'}</span>
        </div>
      </div>
    </div>
    ${statsHtml}
    <div class="abilities-section">
      <h3>Fähigkeiten</h3>
      ${abilitiesHtml}
    </div>
    ${hero.notes ? `<div style="margin-top:12px; color:var(--text-dim); font-size:13px;">${hero.notes}</div>` : ''}
  `;
  showInlineDetail('hero-list', el, heroHtml);
  if (hero.stats_by_level.length > 0) renderHeroLevelStats(hero, 1);
}

document.getElementById('hero-search').addEventListener('input', e => {
  renderHeroes(e.target.value, document.getElementById('hero-filter-stat').value);
});
document.getElementById('hero-filter-stat').addEventListener('change', e => {
  renderHeroes(document.getElementById('hero-search').value, e.target.value);
});

// ─── ITEMS ─────────────────────────────────────────────────────────────────────
// Returns inline style string for a CSS sprite icon from item data.
// size = rendered px size.
function itemIconStyle(sheet, index, cols, rows, size) {
  const col = index % cols;
  const row = Math.floor(index / cols);
  const xPct = cols > 1 ? (col / (cols - 1)) * 100 : 0;
  const yPct = rows > 1 ? (row / (rows - 1)) * 100 : 0;
  return `style="width:${size}px;height:${size}px;background-image:url('${sheet}');background-size:${cols * 100}% ${rows * 100}%;background-position:${xPct.toFixed(2)}% ${yPct.toFixed(2)}%;background-repeat:no-repeat;"`;
}
function itemIcon(it, size) {
  if (it.icon == null || it.icon_index == null) return '';
  return itemIconStyle(it.icon, it.icon_index, it.icon_cols || 4, it.icon_rows || 3, size);
}

function renderItems(filter = '', catFilter = '') {
  const grid = document.getElementById('item-list');
  const filtered = items.filter(it => {
    const matchName = it.name.toLowerCase().includes(filter.toLowerCase());
    const matchCat = !catFilter || it.category === catFilter;
    return matchName && matchCat;
  });

  grid.innerHTML = filtered.map(it => `
    <div class="card" onclick="showItemTooltip('${it.id}', this)">
      <div class="card-top-row">
        ${itemIcon(it, 40) ? `<div class="item-card-icon" ${itemIcon(it, 40)}></div>` : ''}
        <div class="card-top-text">
          ${it.cost != null ? `<div class="card-cost">🪙 ${it.cost}${it.cost_lumber ? ` 🪵 ${it.cost_lumber}` : ''}</div>` : ''}
          <div class="card-name">${it.name}</div>
        </div>
      </div>
      <div class="card-sub" style="margin-bottom:8px;">${it.description.substring(0, 80)}${it.description.length > 80 ? '...' : ''}</div>
      <div class="card-tags-row">
        <span class="card-tag tag-${it.category.replace(/ /g, '-')}">${it.category}</span>
        ${it.unique ? '<span class="card-tag tag-unique">Unique</span>' : ''}
        ${it.upgrade_tiers ? `<span class="card-tag tag-stack">Stackable ×${it.upgrade_tiers}</span>` : ''}
      </div>
    </div>
  `).join('');
}

function showItemTooltip(id, el) {
  const item = items.find(it => it.id === id);

  const statLabels = {
    life_steal_pct: 'Lifesteal', bonus_dmg: 'Bonus Dmg', ranged: 'Ranged',
    armor_reduction: 'Armor Reduction', armor_reduction_duration: 'Armor Red. Duration',
    slow_pct: 'Slow', slow_duration: 'Slow Duration', splash_pct: 'Splash',
    splash_aoe: 'Splash AoE', heal_reduction_pct: 'Heal Reduction',
    heal_reduction_duration: 'Heal Red. Duration', move_speed: 'Move Speed',
    blink_range: 'Blink Range', active_cooldown: 'Cooldown',
    true_sight_aoe: 'True Sight AoE', dark_minion_duration: 'Minion Duration',
    summons: 'Summons', summon_unit: 'Unit', duration: 'Duration',
    aura: 'Aura', impact_dmg: 'Impact Dmg', stun_duration: 'Stun',
    immolation_dps: 'Immolation DPS', trigger: 'Trigger',
  };

  const statsHtml = item.stats && Object.keys(item.stats).length > 0
    ? `<div style="margin-bottom:16px;">
        <div style="color:var(--gold); font-size:12px; font-weight:600; margin-bottom:8px;">STATS</div>
        <div class="stats-grid" style="margin-bottom:0;">
          ${Object.entries(item.stats).map(([k, v]) => `
            <div class="stat-box">
              <div class="stat-label">${statLabels[k] || k.replace(/_/g, ' ')}</div>
              <div class="stat-value" style="color:var(--gold-light); font-size:14px;">${v === true ? '✓' : v}</div>
            </div>
          `).join('')}
        </div>
      </div>`
    : '';

  const numericStats = item.stats ? Object.entries(item.stats).filter(([, v]) => typeof v === 'number') : [];
  const stackHtml = item.upgrade_tiers && numericStats.length > 0
    ? `<div style="margin-bottom:16px;">
        <div style="color:var(--gold); font-size:12px; font-weight:600; margin-bottom:8px;">STACK PROGRESSION</div>
        <div class="stats-grid" style="margin-bottom:0;">
          ${Array.from({length: item.upgrade_tiers}, (_, i) => i + 1).map(n => `
            <div class="stat-box">
              <div class="stat-label" style="color:var(--gold)">×${n}</div>
              <div class="stat-value" style="color:var(--gold-light); font-size:13px; line-height:1.5;">
                ${numericStats.map(([k, v]) => `+${v * n} ${statLabels[k] || k.replace(/_/g, ' ')}`).join('<br>')}
              </div>
            </div>
          `).join('')}
        </div>
      </div>`
    : '';

  const itemHtml = `
    <div class="detail-header">
      ${itemIcon(item, 56) ? `<div class="item-detail-icon" ${itemIcon(item, 56)}></div>` : ''}
      <div style="flex:1;">
        <div class="detail-title">${item.name}</div>
        <div class="detail-subtitle" style="margin-top:6px;">
          <span class="card-tag tag-${item.category.replace(/ /g, '-')}">${item.category}</span>
          ${item.unique ? '<span class="card-tag tag-unique" style="margin-left:6px;">Unique</span>' : ''}
          ${item.legendary ? '<span class="card-tag" style="margin-left:6px; background:rgba(200,80,20,0.15); color:#e06030; border:1px solid #e06030;">Legendary</span>' : ''}
        </div>
      </div>
      <div style="text-align:right; white-space:nowrap;">
        ${item.cost != null ? `<div style="color:var(--gold); font-weight:700;">🪙 ${item.cost}${item.cost_lumber ? ` &nbsp;🪵 ${item.cost_lumber}` : ''}</div>` : ''}
        <div style="font-size:12px; color:var(--text-dim); margin-top:4px;">${item.effect_type || ''}</div>
      </div>
    </div>
    <p style="color:var(--text); line-height:1.6; margin-bottom:16px;">${item.description}</p>
    ${stackHtml}
    ${statsHtml}
    ${item.notes ? `<div style="color:var(--text-dim); font-size:13px; border-top:1px solid var(--border); padding-top:12px;">${item.notes}</div>` : ''}
  `;

  showInlineDetail('item-list', el, itemHtml);
}

document.getElementById('item-search').addEventListener('input', e => {
  renderItems(e.target.value, document.getElementById('item-filter-cat').value);
});
document.getElementById('item-filter-cat').addEventListener('change', e => {
  renderItems(document.getElementById('item-search').value, e.target.value);
});

// ─── BUILDS ────────────────────────────────────────────────────────────────────
function renderBuilds(filter = '') {
  const grid = document.getElementById('build-list');
  const filtered = builds.filter(b =>
    b.name.toLowerCase().includes(filter.toLowerCase()) ||
    (b.hero_id && b.hero_id.includes(filter.toLowerCase())) ||
    (b.tags && b.tags.some(t => t.toLowerCase().includes(filter.toLowerCase())))
  );

  grid.innerHTML = filtered.map(b => {
    const hero = heroes.find(h => h.id === b.hero_id);
    const totalItems = [...(b.first_buy || []), ...(b.midgame || []), ...(b.endgame || [])].filter(e => e && (typeof e === 'string' ? e : e.id)).length;
    const tagStr = b.tags?.length > 0 ? b.tags.map(t => `<span class="build-tag-pill">${t}</span>`).join('') : '<span style="color:var(--text-dim)">no tags</span>';

    return `
      <div class="card build-card" onclick="showBuildDetail('${b.id}', this)">
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
    { key: 'first_buy', label: 'First Buy', color: '#4caf50' },
    { key: 'midgame',   label: 'Midgame',   color: 'var(--gold)' },
    { key: 'endgame',   label: 'Endgame',   color: '#e06030' },
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

  const legendary = (b.legendary_replacements || []).filter(Boolean);
  if (legendary.length > 0) {
    const legNames = legendary.map(id => items.find(i => i.id === id)?.name || id);
    html += `
      <div class="build-phase-row">
        <div class="build-phase-label" style="color:#e06030">⚔ Legendary</div>
        <div class="build-phase-items">${legNames.map(n => `<span class="build-item-pill" style="border-color:#e06030;color:#e06030;">${n}</span>`).join('')}</div>
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

  grid.innerHTML = filtered.map(m => `
    <div class="card ${m.buffs.length === 0 ? 'card-incomplete' : ''}" onclick="showMercDetail('${m.id}', this)">
      <div class="card-top-row">
        ${m.icon != null ? `<div class="item-card-icon" ${itemIconStyle(m.icon, m.icon_index, m.icon_cols || 4, m.icon_rows || 3, 40)}></div>` : ''}
        <div class="card-top-text">
          ${m.cost != null ? `<div class="card-cost">🪙 ${m.cost}${m.cost_lumber ? ` 🪵 ${m.cost_lumber}` : ''}</div>` : ''}
          <div class="card-name">${m.name}</div>
        </div>
      </div>
      <div style="font-size:12px; color:var(--text-dim); margin-top:6px;">
        ${m.buffs.length > 0 ? m.buffs.map(b => `<span>${b}</span>`).join(' · ') : 'Noch nicht dokumentiert'}
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
    : '<p style="color:var(--text-dim)">Fähigkeiten noch nicht dokumentiert.</p>';

  const mercHtml = `
    <div class="detail-header">
      ${merc.icon != null ? `<div class="item-detail-icon" ${itemIconStyle(merc.icon, merc.icon_index, merc.icon_cols || 4, merc.icon_rows || 3, 56)}></div>` : ''}
      <div style="flex:1;">
        <div class="detail-title">${merc.name}</div>
        <div class="detail-subtitle">
          ${merc.building ? 'Building: ' + merc.building + ' · ' : ''}
          ${merc.cost != null ? '🪙 ' + merc.cost + (merc.cost_lumber ? ` 🪵 ${merc.cost_lumber}` : '') : ''}
        </div>
      </div>
    </div>
    ${merc.description ? `<p style="color:var(--text-dim); margin-bottom:16px;">${merc.description}</p>` : ''}
    ${merc.buffs.length > 0 ? `
      <div style="margin-bottom:16px;">
        <div style="color:var(--gold); font-size:12px; font-weight:600; margin-bottom:8px;">BUFFS</div>
        ${merc.buffs.map(b => `<span class="build-item-pill">${b}</span>`).join(' ')}
      </div>
    ` : ''}
    <div class="abilities-section">
      <h3>Fähigkeiten</h3>
      ${abilitiesHtml}
    </div>
    ${merc.notes ? `<div style="margin-top:12px; color:var(--text-dim); font-size:13px;">${merc.notes}</div>` : ''}
  `;
  showInlineDetail('merc-list', el, mercHtml);
}

document.getElementById('merc-search').addEventListener('input', e => {
  renderMercs(e.target.value);
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
  if (item.icon != null && item.icon_index != null) {
    const cols = item.icon_cols || 4, rows = item.icon_rows || 3;
    const col = item.icon_index % cols, row = Math.floor(item.icon_index / cols);
    const xPct = cols > 1 ? (col / (cols - 1)) * 100 : 0;
    const yPct = rows > 1 ? (row / (rows - 1)) * 100 : 0;
    slotEl.style.backgroundImage = `url('${item.icon}')`;
    slotEl.style.backgroundSize = `${cols * 100}% ${rows * 100}%`;
    slotEl.style.backgroundPosition = `${xPct.toFixed(2)}% ${yPct.toFixed(2)}%`;
    slotEl.style.backgroundRepeat = 'no-repeat';
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
const SKILL_LEVELS = 25;
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
  const KEY_LABELS = ['Q', 'W', 'E', 'R'];
  const rows = [
    ...abilities.map((ab, i) => ({ key: `a${i}`, label: ab.name, shortLabel: KEY_LABELS[i], maxRank: ab.levels?.length || 6 })),
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
    html += `<div class="so-label" title="${row.label}"><span class="so-key">${row.shortLabel}</span><span class="so-key-name">${row.label.substring(0,10)}${row.label.length>10?'…':''}</span></div>`;
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
    ? items.filter(it => it.category === 'Legendary')
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
      <div style="font-size:11px; text-transform:uppercase; letter-spacing:1px; color:#e06030; margin-bottom:4px;">⚔ Legendary Ersatz</div>
      <div class="preview-items">${legendaryReplacements.map((id, i) => id
        ? `<span class="preview-item" style="border-color:#e06030; color:#e06030;" title="Ersetzt Slot ${i+1}">${items.find(it => it.id === id)?.name || id}</span>`
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
    first_buy: selectedPhaseItems.firstbuy
      .map((id, i) => id ? { id, stacks: selectedPhaseStacks.firstbuy[i] } : null).filter(Boolean),
    midgame: selectedPhaseItems.midgame
      .map((id, i) => id ? { id, stacks: selectedPhaseStacks.midgame[i] } : null).filter(Boolean),
    endgame: selectedPhaseItems.endgame
      .map((id, i) => id ? { id, stacks: selectedPhaseStacks.endgame[i] } : null).filter(Boolean),
    legendary_replacements: legendaryReplacements.filter(Boolean),
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
  panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// ─── HELPERS ───────────────────────────────────────────────────────────────────
function formatKey(key) {
  return key.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
}

function showToast(msg) {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.classList.remove('hidden');
  setTimeout(() => toast.classList.add('hidden'), 2500);
}

// ─── INIT ──────────────────────────────────────────────────────────────────────
loadData();
