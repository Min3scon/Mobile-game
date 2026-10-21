'use strict';
/* Neon Swarm — menus and overlays (DOM over the canvas) */

const UI = (() => {
  const el = (id) => document.getElementById(id);
  const esc = escHtml;
  let api = null;
  let levelChoices = [];
  let toastTimer = 0, confirmReset = 0, confirmQuit = 0;
  const counters = [];
  let lbBoard = 'all', questTab = 'daily', hangarTab = 'pilots', acctTab = 'login', busy = false;
  let lastResult = null, raidCache = null, onlineCount = 0, joinedDuel = null, pendingJoin = null;
  let status = null, banLine = '', adminTab = 'find', adminQuery = '', adminSel = null, confirmWipe = 0;
  const GEM = '#ff7ae0';

  const isStandalone = () => window.navigator.standalone === true || (window.matchMedia && matchMedia('(display-mode: standalone)').matches);
  const inFrame = (() => { try { return window.self !== window.top; } catch (e) { return true; } })();
  const isIOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

  function current() {
    const s = document.querySelector('.screen:not([hidden])');
    return s ? s.id : null;
  }

  function show(id) {
    for (const s of document.querySelectorAll('.screen')) s.hidden = s.id !== id;
    const g = api.getGame();
    el('hud').hidden = !(g && ['scr-level', 'scr-chest', 'scr-pause', null].includes(id));
    el('btn-pause').hidden = !!(g && g.coop);
    updateHudButtons();
  }

  // ---------- shared bits ----------
  function shipSvg(color, locked) {
    const fill = locked ? '#2a2550' : color;
    return `<svg class="ship-svg" viewBox="-15 -15 30 30" aria-hidden="true" style="--c:${fill}"><g transform="rotate(-90)"><path d="M14 0L-9.5 9.5L-3.6 0L-9.5-9.5Z" fill="${locked ? '#16132e' : rgba(color, 0.22)}" stroke="${fill}" stroke-width="2" stroke-linejoin="round"/>${locked ? '' : '<path d="M6 0L-4 4L-1.6 0L-4-4Z" fill="#fff"/>'}</g></svg>`;
  }

  const PET_PATHS = {
    diamond: 'M10 0L0 7.2L-10 0L0-7.2Z',
    circle: 'M9 0A9 9 0 1 1-9 0A9 9 0 1 1 9 0Z',
    hex: 'M9 0L4.5 7.8L-4.5 7.8L-9 0L-4.5-7.8L4.5-7.8Z',
    square: 'M0-9L9 0L0 9L-9 0Z',
    tri: 'M0-9.5L8.2 4.8L-8.2 4.8Z',
    pent: 'M0-9.5L9 -2.9L5.6 7.7L-5.6 7.7L-9-2.9Z',
    arrow: 'M0-11L8.5 8L0 3.5L-8.5 8Z',
  };
  function petSvg(id, locked) {
    const d = PETS[id], c = locked ? '#3a3460' : d.color;
    return `<svg class="pet-svg" viewBox="-13 -13 26 26" aria-hidden="true" style="--c:${c}"><path d="${PET_PATHS[d.shape]}" fill="${locked ? '#16132e' : rgba(d.color, 0.25)}" stroke="${c}" stroke-width="1.8" stroke-linejoin="round"/>${locked ? '<text x="0" y="3.5" text-anchor="middle" font-size="9" fill="#5b5490" font-weight="700">?</text>' : '<circle r="2.2" fill="#fff"/>'}</svg>`;
  }

  function stars(n, max = PET_MAX_STARS) {
    let s = '';
    for (let i = 1; i <= max; i++) s += `<i class="${i <= n ? 'on' : ''}">★</i>`;
    return `<span class="stars">${s}</span>`;
  }

  function pips(level, max, color) {
    let s = '';
    for (let i = 1; i <= max; i++) s += `<i class="${i <= level ? 'on' : ''}"></i>`;
    return `<span class="pips ${max > 6 ? 'many' : ''}" style="--c:${color}">${s}</span>`;
  }

  function wallet() {
    return `<span class="wallet"><span class="pill gold">${icon('gold')}<span>${fmtInt(save.gold)}</span></span><span class="pill gems">${icon('gem')}<span>${fmtInt(save.gems)}</span></span></span>`;
  }

  function header(title, back = 'menu') {
    return `<header class="bar">
      <button class="icon-btn" data-act="go" data-to="${back}" aria-label="Back">${icon('back')}</button>
      <h2>${title}</h2>${wallet()}
    </header>`;
  }

  function tabs(list, cur, act) {
    return `<div class="tabs">${list.map(([k, l, n]) => `<button class="tab ${cur === k ? 'on' : ''}" data-act="${act}" data-tab="${k}">${l}${n ? ` <b class="dot">${n}</b>` : ''}</button>`).join('')}</div>`;
  }

  function needOnline(what) {
    if (!Online.available && Online.status === 'no-config') {
      return `<div class="empty">${icon('globe')}<b>Online features are not connected yet</b><p>${what} needs the game's online server. Whoever runs this game can connect it by following <code>supabase/SETUP.md</code> in the project.</p></div>`;
    }
    if (!Online.available) {
      return `<div class="empty">${icon('globe')}<b>Can't reach the online server</b><p>Check your internet connection, then try again. You can keep playing offline meanwhile.</p>
        <button class="btn primary" data-act="online-retry">Try again</button><small class="why">${esc(Online.status)}</small></div>`;
    }
    if (!Online.user) {
      return `<div class="empty">${icon('user')}<b>Log in to ${what.toLowerCase()}</b><p>Make a free account with your email. Your progress is saved to the cloud too.</p><button class="btn primary" data-act="go" data-to="account">Log in or sign up</button></div>`;
    }
    return '';
  }

  // ---------- home ----------
  function renderMenu() {
    const c = CHARS[save.selChar] || CHARS.volt;
    const run = save.run;
    const pets = equippedPets();
    const rc = rankClaimable(), qc = questsClaimable() + dailyClaimable() + rc;
    const sec = clamp(save.sector || 1, 1, save.sectorMax);
    const hint = isIOS && !isStandalone() && !inFrame
      ? `<p class="hint">${icon('up')} Tap <b>Share</b> then <b>Add to Home Screen</b> to play fullscreen.</p>` : '';
    el('scr-menu').innerHTML = `
      <div class="wrap menu">
        <header class="bar">
          <button class="rank-pill" data-act="go" data-to="rank" aria-label="Rank ${save.rank}">${icon('medal')}<b>${save.rank}</b>${rc ? '<i class="ping"></i>' : ''}</button>
          <span class="bar-right">${wallet()}<button class="icon-btn" data-act="go" data-to="settings" aria-label="Settings">${icon('gear')}</button></span>
        </header>
        ${status && status.ban ? `<p class="ban-note">${icon('ban')}<span>${esc(banLine)}. You can still play, but scores, raids and duels are off.</span></p>` : ''}
        <h1 class="logo" aria-label="Neon Swarm"><span class="l1">NEON</span><span class="l2">SWARM</span></h1>
        <button class="pilot-chip" data-act="go" data-to="pilots" style="--c:${c.color}">
          ${shipSvg(c.color)}
          <span class="pc-text"><b>${c.name}</b><small>${WEAPONS[c.weapon].name}</small></span>
          <span class="pc-pets">${pets.map((p) => petSvg(p.id)).join('')}</span>
        </button>
        ${run
          ? `<button class="btn primary big" data-act="continue">Continue <span class="btn-sub">${fmtTime(run.t)}</span></button>
             <button class="btn ghost" data-act="play">New run</button>`
          : `<button class="btn primary big" data-act="play">Play</button>`}
        ${save.sectorMax > 1 ? `<div class="sector-pick" style="--c:${SECTORS[sec].color}">
          <button class="icon-btn" data-act="sector" data-d="-1" aria-label="Easier sector" ${sec <= 1 ? 'disabled' : ''}>${icon('back')}</button>
          <b>${SECTORS[sec].name}</b>
          <button class="icon-btn flip" data-act="sector" data-d="1" aria-label="Harder sector" ${sec >= save.sectorMax ? 'disabled' : ''}>${icon('back')}</button>
        </div>` : ''}
        <nav class="home-nav">
          <button class="tile" data-act="go" data-to="hangar">${icon('ship')}<span>Hangar</span>${save.eggs.basic + save.eggs.royal ? `<b class="badge">${save.eggs.basic + save.eggs.royal}</b>` : ''}</button>
          <button class="tile" data-act="go" data-to="quests">${icon('trophy')}<span>Quests</span>${qc ? `<b class="badge">${qc}</b>` : ''}</button>
          <button class="tile" data-act="go" data-to="online">${icon('globe')}<span>Online</span></button>
          <button class="tile daily" data-act="daily-info">${icon('flame')}<span>Daily</span></button>
        </nav>
        ${hint}
      </div>`;
  }

  function showDailyInfo() {
    const mod = dailyMod(), streak = currentStreak(), played = playedDailyToday();
    const now = new Date(), next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
    const mins = Math.max(1, Math.round((next - now) / 60000)), left = mins >= 60 ? `${Math.floor(mins / 60)}h ${mins % 60}m` : `${mins}m`;
    const best = save.daily.best[utcDay()];
    modal(`<h2 class="title">Daily run</h2>
      <div class="daily-mod">${icon('flame')}<b>${esc(mod.name)}</b><p>${esc(mod.desc)}</p></div>
      <p class="sub">${streak ? `${streak}-day streak · ` : ''}+${50 + 10 * Math.min(5, Math.max(0, streak - (played ? 1 : 0)))}% gold</p>
      <p class="lead">One try per day. Everyone gets the same modifier and the same level-up offers, and it has its own leaderboard.</p>
      ${played
        ? `<p class="sub">Played today${best ? `: ${fmtInt(best)} points` : ''}. Next daily in ${left}.</p>
           <button class="btn" data-act="lb-daily">See today's leaderboard</button>`
        : `<button class="btn primary big" data-act="daily">Play daily run</button>`}
      <button class="btn ghost" data-act="modal-close">${played ? 'Close' : 'Not now'}</button>`);
  }

  // ---------- pilots ----------
  function pilotsBody() {
    const rows = Object.entries(CHARS).map(([id, c]) => {
      const owned = pilotUnlocked(id), sel = save.selChar === id, w = WEAPONS[c.weapon], u = c.unlock;
      let act;
      if (owned) act = sel ? `<span class="chip on">${icon('check')} Flying</span>` : `<button class="btn sm" data-act="pick-char" data-id="${id}">Select</button>`;
      else if (u.gold || u.gems) {
        const poor = u.gold ? save.gold < u.gold : save.gems < u.gems;
        act = `<button class="btn sm buy ${u.gems ? 'gem' : ''} ${poor ? 'poor' : ''}" data-act="buy-char" data-id="${id}">${icon(u.gems ? 'gem' : 'gold')} ${fmtInt(u.gold || u.gems)}</button>`;
      } else act = `<span class="chip">${icon('lock')} Locked</span>`;
      const m = masteryProgress(id);
      return `<div class="row pilot ${owned ? '' : 'locked'} ${sel ? 'sel' : ''}" style="--c:${c.color}">
        <div class="r-ic big">${shipSvg(c.color, !owned)}</div>
        <div class="r-main"><b>${c.name}${owned ? ` <em class="mast">Mastery ${m.lvl}</em>` : ''}</b>
          <span class="r-sub" style="color:${w.color}">${icon(w.icon)} ${w.name}${c.passive ? ` + ${PASSIVES[c.passive].name}` : ''}</span>
          <small>${owned ? c.perk : (u.rank || u.queen || u.sector ? unlockText(u) : c.perk)}</small>
          ${owned ? `<span class="prog thin"><i style="width:${m.frac * 100}%"></i></span>` : ''}</div>
        <div class="r-act">${act}</div>
      </div>`;
    }).join('');
    return `<p class="lead">Each pilot starts with a different weapon. Mastery grows as you fly them: +2% damage and +2 HP per level.</p><div class="list">${rows}</div>`;
  }

  // ---------- pets ----------
  function petsBody() {
    const slots = [0, 1].map((i) => {
      if (i >= petSlotsUnlocked()) return `<div class="slot locked">${icon('lock')}<small>Rank ${PET_SLOT2_RANK}</small></div>`;
      const id = save.petSlots[i];
      if (!id || !save.pets[id]) return `<div class="slot empty"><small>Empty slot</small></div>`;
      const d = PETS[id];
      return `<button class="slot" data-act="unequip" data-slot="${i}" style="--c:${d.color}">${petSvg(id)}<b>${d.name}</b>${stars(save.pets[id].stars)}<small>Tap to remove</small></button>`;
    }).join('');
    const eggs = Object.entries(EGGS).map(([id, e]) => {
      const n = save.eggs[id] || 0;
      return `<div class="egg" style="--c:${e.color}">
        <div class="egg-art">${icon('egg')}${n ? `<b class="badge">${n}</b>` : ''}</div>
        <b>${e.name}</b>
        <small>${e.odds.map((o, r) => (o ? `<span style="color:${RARITY[r].color}">${o}%</span>` : '')).filter(Boolean).join(' · ')}</small>
        <button class="btn sm ${n ? 'primary' : `buy gem ${save.gems < e.cost ? 'poor' : ''}`}" data-act="hatch" data-id="${id}">${n ? 'Hatch' : `${icon('gem')} ${e.cost}`}</button>
      </div>`;
    }).join('');
    const grid = Object.entries(PETS).sort((a, b) => a[1].rarity - b[1].rarity).map(([id, d]) => {
      const own = save.pets[id], eq = save.petSlots.slice(0, petSlotsUnlocked()).includes(id);
      const r = RARITY[d.rarity];
      if (!own) return `<div class="pet locked" style="--c:${r.color}">${petSvg(id, true)}<b>???</b><small style="color:${r.color}">${r.name}</small></div>`;
      const next = own.stars < PET_MAX_STARS ? `${own.dupes}/${PET_DUPES[own.stars]} to next star` : 'Max stars';
      return `<div class="pet" style="--c:${r.color}">
        ${petSvg(id)}<b>${d.name}</b>${stars(own.stars)}
        <small style="color:${r.color}">${r.name}</small>
        <small class="pet-desc">${d.desc(own.stars)}</small>
        <small class="pet-next">${next}</small>
        ${eq ? `<span class="chip on">${icon('check')} Equipped</span>` : `<button class="btn sm" data-act="equip" data-id="${id}">Equip</button>`}
      </div>`;
    }).join('');
    return `<p class="lead">Pets follow you into every run and fight on their own. Duplicates add stars.</p>
      <div class="slots">${slots}</div>
      <h3 class="sec">Eggs</h3><div class="eggs">${eggs}</div>
      <h3 class="sec">Collection <span>${Object.keys(save.pets).length} / ${Object.keys(PETS).length}</span></h3>
      <div class="pets">${grid}</div>`;
  }

  function showHatch(res) {
    const d = PETS[res.id], r = RARITY[d.rarity];
    const line = res.isNew ? `New pet!` : res.refund ? `Already maxed: +${res.refund} gems` : res.starUp ? `Star up! Now ${res.stars} stars` : `+1 copy (${save.pets[res.id].dupes}/${PET_DUPES[save.pets[res.id].stars]} to next star)`;
    modal(`<div class="hatch" style="--c:${r.color}">
      <div class="egg-crack">${icon('egg')}</div>
      <div class="hatch-reveal">
        ${petSvg(res.id)}
        <small style="color:${r.color}">${r.name}</small>
        <h2 class="title">${d.name}</h2>
        ${stars(save.pets[res.id].stars)}
        <p class="sub">${line}</p>
        <p class="lead">${d.desc(save.pets[res.id].stars)}</p>
      </div>
      <button class="btn primary" data-act="modal-close">Nice</button>
    </div>`, 1400);
    if (d.rarity >= 2 || res.isNew) Sound.play.evolve();
    else Sound.play.chest();
  }

  // ---------- shop ----------
  function shopBody() {
    const rows = SHOP.map((it) => {
      const r = shopRank(it.id), cap = shopUnlockedMax(it), maxed = r >= it.max, cost = shopCost(it, r);
      let act;
      if (maxed) act = `<span class="chip on">Max</span>`;
      else if (r >= cap) act = `<span class="chip">${icon('lock')} Rank ${it.need || SHOP_TIER2_RANK}</span>`;
      else act = `<button class="btn sm buy ${save.gold < cost ? 'poor' : ''}" data-act="buy" data-id="${it.id}">${icon('gold')} ${fmtInt(cost)}</button>`;
      return `<div class="row shop" style="--c:#39f3ff">
        <div class="r-ic">${icon(it.icon)}</div>
        <div class="r-main"><b>${it.name}</b><small>${it.desc}</small>${pips(r, it.max, '#39f3ff')}</div>
        <div class="r-act">${act}</div>
      </div>`;
    }).join('');
    return `<p class="lead">Permanent boosts for every run.${save.rank < SHOP_TIER2_RANK ? ` Ranks 6-10 open at account rank ${SHOP_TIER2_RANK}.` : ''}</p><div class="list">${rows}</div>`;
  }

  function renderHangar() {
    const eggs = save.eggs.basic + save.eggs.royal;
    const body = hangarTab === 'pets' ? petsBody() : hangarTab === 'shop' ? shopBody() : pilotsBody();
    el('scr-hangar').innerHTML = `<div class="wrap">${header('Hangar')}${tabs([['pilots', 'Pilots'], ['pets', 'Pets', eggs], ['shop', 'Upgrades']], hangarTab, 'htab')}${body}</div>`;
  }

  // ---------- quests ----------
  function renderQuests() {
    ensureDailyQuests();
    const tabBar = tabs([['daily', 'Daily', dailyClaimable()], ['rank', 'Rank', rankClaimable()], ['ach', 'Awards', questsClaimable()], ['evo', 'Evolve']], questTab, 'qtab');
    let body = '';
    if (questTab === 'rank') {
      body = rankBody();
    } else if (questTab === 'daily') {
      const rows = save.dq.list.map((q) => {
        const def = dailyDef(q.id), v = dailyProgress(q.id), done = v >= def.goal;
        const fmt = (n) => (def.time ? fmtTime(n) : fmtInt(n));
        const act = q.claimed ? `<span class="chip on">${icon('check')} Done</span>`
          : done ? `<button class="btn sm primary" data-act="claim-daily" data-id="${q.id}">Claim</button>`
          : `<span class="chip">${icon('gem')} ${DAILY_REWARD.gems}</span>`;
        return `<div class="row quest ${q.claimed ? 'claimed' : ''}"><div class="r-main"><b>${dailyText(def)}</b>
          <span class="prog"><i style="width:${(v / def.goal) * 100}%"></i></span><small class="prog-t">${fmt(v)} / ${fmt(def.goal)} · ${rewardText(DAILY_REWARD)}</small></div>
          <div class="r-act">${act}</div></div>`;
      }).join('');
      const all = save.dq.list.every((q) => q.claimed);
      const now = new Date(), mid = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
      const hrs = Math.ceil((mid - now) / 3600000);
      body = `<p class="lead">Three new quests every day. New quests in ${hrs}h.</p><div class="list">${rows}
        <div class="row quest bonus"><div class="r-main"><b>Finish all three</b><small>${rewardText(DAILY_BONUS)}</small></div>
        <div class="r-act">${save.dq.bonus ? `<span class="chip on">${icon('check')} Done</span>` : `<button class="btn sm ${all ? 'primary' : ''}" data-act="claim-bonus" ${all ? '' : 'disabled'}>Claim</button>`}</div></div></div>`;
    } else if (questTab === 'ach') {
      body = `<div class="list">${QUESTS.map((q) => {
        const v = Math.min(questValue(q), q.goal), done = v >= q.goal, claimed = !!save.claimed[q.id];
        const fmt = (n) => (q.time ? fmtTime(n) : fmtInt(n));
        const act = claimed ? `<span class="chip on">${icon('check')} Done</span>`
          : done ? `<button class="btn sm primary" data-act="claim" data-id="${q.id}">Claim</button>`
          : `<span class="chip">${q.reward.gems ? icon('gem') + ' ' + q.reward.gems : icon('gold') + ' ' + q.reward.gold}</span>`;
        return `<div class="row quest ${claimed ? 'claimed' : ''}"><div class="r-main"><b>${q.name}</b><small>${q.desc} · ${rewardText(q.reward)}</small>
          <span class="prog"><i style="width:${(v / q.goal) * 100}%"></i></span><small class="prog-t">${fmt(v)} / ${fmt(q.goal)}</small></div>
          <div class="r-act">${act}</div></div>`;
      }).join('')}</div>`;
    } else {
      const evos = Object.entries(WEAPONS).map(([id, w]) => {
        const found = !!save.codex[id], p = PASSIVES[w.evo.with];
        return `<div class="evo ${found ? 'found' : ''}" style="--c:${w.color}">
          <div class="r-ic">${icon(w.icon)}</div><b>${found ? w.evo.name : '???'}</b>
          <small>${found ? `${w.name} + ${p.name}` : `Max ${w.name} + ???`}</small></div>`;
      }).join('');
      body = `<p class="lead">Max out a weapon while holding its paired passive, then open a chest. ${Object.keys(save.codex).length} / ${Object.keys(WEAPONS).length} found.</p><div class="evos">${evos}</div>`;
    }
    el('scr-quests').innerHTML = `<div class="wrap">${header('Quests')}${tabBar}${body}</div>`;
  }

  // ---------- rank road ----------
  function rankBody() {
    const need = rankXpFor(save.rank), rc = rankClaimable();
    let rows = '';
    for (let r = 2; r <= RANK_CAP; r++) {
      const rw = rankReward(r), got = r <= save.rankClaimed, ready = !got && r <= save.rank;
      rows += `<div class="road ${got ? 'got' : ready ? 'ready' : ''} ${r === save.rank ? 'cur' : ''}" id="rank-${r}">
        <span class="road-n">${r}</span><span class="road-r">${rewardText(rw)}</span>
        <span class="road-s">${got ? icon('check') : ready ? icon('gift') : icon('lock')}</span></div>`;
    }
    return `<div class="rank-hero"><b>Rank ${save.rank}</b><span class="prog"><i style="width:${save.rank >= RANK_CAP ? 100 : (save.rankXp / need) * 100}%"></i></span>
      <small>${save.rank >= RANK_CAP ? 'Max rank' : `${fmtInt(save.rankXp)} / ${fmtInt(need)} XP to rank ${save.rank + 1}`}. Every run earns XP.</small></div>
      ${rc ? `<button class="btn primary" data-act="claim-rank">${icon('gift')} Claim ${rc} reward${rc > 1 ? 's' : ''}</button>` : ''}
      <div class="roadlist">${rows}</div>`;
  }

  // ---------- online hub ----------
  function renderOnline() {
    const u = Online.user, r = raidCache;
    const acct = !Online.available ? needOnline('Online play')
      : `<button class="acct-row" data-act="go" data-to="account">${icon('user')}<span><b>${u ? esc(u.username || 'Pick a name') : 'Log in or sign up'}</b><small>${u ? 'Cloud save on' : 'Save to the cloud and join the leaderboard'}</small></span>${icon('back', 'flip')}</button>`;
    const row = (to, ic, title, sub, extra = '') => `<button class="hub-row" data-act="go" data-to="${to}">${icon(ic)}<span><b>${title}</b><small>${sub}</small>${extra}</span></button>`;
    el('scr-online').innerHTML = `<div class="wrap">${header('Online')}
      ${acct}
      <div class="list">
        ${row('coop', 'users', 'Co-op', onlineCount > 1 ? `${onlineCount} pilots online · play with 2-4 friends` : 'Play with 2-4 friends in one arena')}
        ${row('duel', 'swords', 'Duels', 'Same seed as a friend. Higher score wins')}
        ${row('raid', 'boss', r ? esc(r.name) : 'Weekly raid', r ? (r.defeated ? 'Defeated! Claim your reward' : `${fmtInt(r.hp)} HP left`) : 'Everyone damages one giant boss', r && !r.defeated ? `<span class="bossbar"><i style="width:${(r.hp / r.maxHp) * 100}%"></i></span>` : '')}
        ${row('board', 'star', 'Leaderboard', 'All time, this week and today')}
        ${status && status.admin ? row('admin', 'shield', 'Admin', 'Players, bans and flagged scores') : ''}
      </div>
      ${status && status.ban ? `<p class="ban-note">${icon('ban')}<span>${esc(banLine)}</span></p>` : ''}</div>`;
  }

  // ---------- leaderboard ----------
  async function renderBoard() {
    const tabs = `<div class="tabs">${[['all', 'All time'], ['week', 'This week'], ['daily', "Today's daily"]].map(([k, l]) => `<button class="tab ${lbBoard === k ? 'on' : ''}" data-act="lbtab" data-tab="${k}">${l}</button>`).join('')}</div>`;
    const gate = Online.available ? '' : needOnline('The leaderboard');
    el('scr-board').innerHTML = `<div class="wrap">${header('Leaderboard', 'online')}${gate || tabs + '<div id="lb-body" class="list"><p class="lead">Loading…</p></div>'}</div>`;
    if (gate) return;
    const board = lbBoard;
    const [rows, mine] = await Promise.all([
      Online.leaderboard({ board, day: utcDay(), limit: 50 }),
      Online.user ? Online.myBest({ board, day: utcDay() }) : Promise.resolve(null),
    ]);
    if (current() !== 'scr-board' || board !== lbBoard) return;
    const body = el('lb-body');
    if (!rows || !rows.length) {
      body.innerHTML = `<p class="lead">No scores yet. ${Online.user ? 'Finish a run to post the first one.' : 'Log in and finish a run to post one.'}</p>`;
      return;
    }
    body.innerHTML = (mine && !rows.some((r) => r.me) ? `<p class="lead">Your best: #${mine.rank} with ${fmtInt(mine.score)}</p>` : '') +
      rows.map((r) => {
        const c = CHARS[r.pilot] || CHARS.volt;
        return `<div class="lb ${r.me ? 'me' : ''} ${r.rank <= 3 ? 'top' + r.rank : ''}">
          <span class="lb-rank">${r.rank}</span>${shipSvg(c.color)}
          <span class="lb-name"><b>${esc(r.username)}</b><small>${fmtTime(r.time)} · ${fmtInt(r.kills)} kills${r.sector > 1 ? ' · S' + r.sector : ''}${r.won ? ' · won' : ''}</small></span>
          <span class="lb-score">${fmtInt(r.score)}</span></div>`;
      }).join('') + (Online.user ? '' : `<p class="lead">Log in to put your name on the board.</p>`);
  }

  // ---------- account ----------
  function renderAccount() {
    let body;
    const u = Online.user;
    if (!Online.available) body = needOnline('Accounts');
    else if (u && !u.username) {
      body = `<div class="form"><p class="lead">Pick a name for the leaderboard (3-16 letters, numbers or _).</p>
        <input id="f-name" class="field" maxlength="16" autocomplete="nickname" placeholder="Pilot name" value="">
        <button class="btn primary" data-act="set-name">Save name</button>
        <button class="btn ghost" data-act="logout">Log out</button></div>`;
    } else if (u) {
      const synced = save.lastCloud ? `Saved to the cloud ${ago(save.lastCloud)}` : 'Not synced yet';
      body = `<div class="acct-card">${icon('user')}<b>${esc(u.username)}</b><small>${esc(u.email || '')}</small></div>
        <div class="list">
          <div class="row toggle"><div class="r-main"><b>Cloud save</b><small id="sync-state">${synced}</small></div><button class="btn sm" data-act="sync">Sync now</button></div>
        </div>
        <p class="lead">Your progress follows your account, so you can play on any device or in Safari and the Home Screen app. Your cloud save is encrypted with a key that belongs only to your account.</p>
        <button class="btn ghost" data-act="logout">Log out</button>
        <button class="btn danger" data-act="delete-account">Delete account</button>`;
    } else {
      const tabs = `<div class="tabs">${[['login', 'Log in'], ['signup', 'Sign up']].map(([k, l]) => `<button class="tab ${acctTab === k ? 'on' : ''}" data-act="atab" data-tab="${k}">${l}</button>`).join('')}</div>`;
      body = `${tabs}<form class="form" id="auth-form" novalidate>
        ${acctTab === 'signup' ? '<label class="flabel" for="f-name">Pilot name</label><input id="f-name" class="field" maxlength="16" autocomplete="nickname" placeholder="3-16 letters, numbers or _">' : ''}
        <label class="flabel" for="f-email">Email</label>
        <input id="f-email" class="field" type="email" autocomplete="email" inputmode="email" placeholder="you@example.com">
        <label class="flabel" for="f-pass">Password</label>
        <input id="f-pass" class="field" type="password" autocomplete="${acctTab === 'signup' ? 'new-password' : 'current-password'}" placeholder="At least 6 characters">
        <p class="form-msg" id="f-msg" role="alert"></p>
        <button class="btn primary" type="submit">${acctTab === 'signup' ? 'Create account' : 'Log in'}</button>
        ${acctTab === 'login' ? '<button class="btn ghost" type="button" data-act="forgot">Forgot password?</button>' : ''}
      </form>
      <p class="lead">Logging in saves your progress to the cloud and puts you on the leaderboard. You can keep playing without an account.</p>`;
    }
    el('scr-account').innerHTML = `<div class="wrap">${header('Account', 'online')}${body}</div>`;
    const form = el('auth-form');
    if (form) form.addEventListener('submit', (e) => { e.preventDefault(); submitAuth(); });
  }

  function ago(ts) {
    const s = Math.max(0, (Date.now() - ts) / 1000);
    if (s < 60) return 'just now';
    if (s < 3600) return Math.floor(s / 60) + ' min ago';
    if (s < 86400) return Math.floor(s / 3600) + ' h ago';
    return Math.floor(s / 86400) + ' days ago';
  }

  async function submitAuth() {
    if (busy) return;
    const msg = el('f-msg'), email = el('f-email').value.trim(), pass = el('f-pass').value;
    const name = el('f-name') ? el('f-name').value.trim() : '';
    busy = true;
    msg.textContent = acctTab === 'signup' ? 'Creating your account…' : 'Logging in…';
    const res = acctTab === 'signup' ? await Online.signUp(email, pass, name) : await Online.signIn(email, pass);
    busy = false;
    if (!res.ok) { msg.textContent = res.error || 'Something went wrong. Try again.'; Sound.play.deny(); return; }
    if (res.needsConfirm) { msg.textContent = 'Check your email to confirm your account, then log in here.'; acctTab = 'login'; return; }
    toast(acctTab === 'signup' ? 'Account created' : 'Logged in');
    Sound.play.buy();
  }

  // ---------- raid ----------
  async function renderRaid() {
    const gate = needOnline('The raid');
    el('scr-raid').innerHTML = `<div class="wrap">${header('Weekly raid', 'online')}${gate || '<p class="lead">Loading…</p>'}</div>`;
    if (gate) return;
    const r = await Online.raid();
    raidCache = r;
    if (current() !== 'scr-raid') return;
    if (!r) { el('scr-raid').querySelector('.lead').textContent = 'Could not reach the raid. Check your connection.'; return; }
    const pct = (r.hp / r.maxHp) * 100;
    el('scr-raid').innerHTML = `<div class="wrap">${header('Weekly raid', 'online')}
      <div class="raid-hero ${r.defeated ? 'dead' : ''}">
        <div class="raid-art">${icon('boss')}</div>
        <h2 class="title">${esc(r.name)}</h2>
        <span class="bossbar big"><i style="width:${pct}%"></i></span>
        <small>${r.defeated ? 'Defeated! Everyone who helped gets a reward.' : `${fmtInt(r.hp)} / ${fmtInt(r.maxHp)} HP · ${r.contributors} pilots`}</small>
      </div>
      <div class="list"><div class="row toggle"><div class="r-main"><b>Your damage</b><small>${fmtInt(r.myDamage)}</small></div>
        ${r.defeated && r.myDamage > 0 && !r.claimed ? `<button class="btn sm primary" data-act="raid-claim" data-id="${r.id}">Claim</button>` : r.claimed ? `<span class="chip on">${icon('check')} Claimed</span>` : ''}</div></div>
      <p class="lead">Every run you finish while logged in chips the raid boss: 60% of the damage you dealt counts. Defeat it together before the week ends to earn gems and a Swarm Egg. Top 3 get bonus gems.</p>
      <h3 class="sec">Top pilots</h3>
      <div class="list">${(r.top || []).map((t, i) => `<div class="lb"><span class="lb-rank">${i + 1}</span><span class="lb-name"><b>${esc(t.username)}</b></span><span class="lb-score">${fmtInt(t.damage)}</span></div>`).join('') || '<p class="lead">No damage yet this week. Be the first.</p>'}</div>
      <button class="btn primary big" data-act="play">Play a run</button></div>`;
  }

  // ---------- duels ----------
  async function renderDuel() {
    const gate = needOnline('Duels');
    el('scr-duel').innerHTML = `<div class="wrap">${header('Duels', 'online')}${gate || `
      <p class="lead">Play a run, then send your code to a friend. They get the same seed and the same level-up offers. Higher score wins.</p>
      <button class="btn primary big" data-act="duel-new">Start a duel</button>
      <h3 class="sec">Got a code?</h3>
      <div class="join-row"><input id="duel-code" class="field code-in" maxlength="6" autocomplete="off" autocapitalize="characters" placeholder="ABC123"><button class="btn sm primary" data-act="duel-join">Join</button></div>
      <p class="form-msg" id="duel-msg" role="alert"></p>
      <h3 class="sec">Your duels</h3><div class="list" id="duel-list"><p class="lead">Loading…</p></div>`}</div>`;
    if (gate) return;
    const list = await Online.myDuels();
    if (current() !== 'scr-duel') return;
    el('duel-list').innerHTML = list.length ? list.map((d) => {
      const mine = d.isCreator ? d.creatorScore : d.opponentScore, theirs = d.isCreator ? d.opponentScore : d.creatorScore;
      const who = d.isCreator ? d.opponentName : d.creatorName;
      const status = !d.done ? 'Waiting for opponent' : mine > theirs ? 'You won' : mine < theirs ? 'You lost' : 'Draw';
      return `<div class="row duel ${d.done ? (mine > theirs ? 'win' : 'lose') : ''}"><div class="r-main"><b>${esc(who || 'Open challenge')} <em class="code-tag">${d.code}</em></b>
        <small>${status} · you ${fmtInt(mine || 0)}${d.done ? ` vs ${fmtInt(theirs || 0)}` : ''}</small></div>
        <div class="r-act">${!d.done && d.isCreator ? `<button class="btn sm" data-act="copy" data-text="${d.code}">${icon('copy')} Code</button>` : ''}</div></div>`;
    }).join('') : '<p class="lead">No duels yet.</p>';
  }

  // ---------- admin ----------
  const BAN_PRESETS = [['1 hour', 60], ['1 day', 1440], ['3 days', 4320], ['1 week', 10080], ['30 days', 43200], ['Permanent', null]];
  const when = (ts) => new Date(ts).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
  const banChip = (b) => (b ? `<span class="chip bad">${icon('ban')} ${b.until ? 'until ' + when(b.until) : 'permanent'}</span>` : '');
  const banLength = (min) => (min == null ? 'permanently' : min % 10080 === 0 ? `for ${min / 10080} week${min > 10080 ? 's' : ''}`
    : min % 1440 === 0 ? `for ${min / 1440} day${min > 1440 ? 's' : ''}` : min % 60 === 0 ? `for ${min / 60} hour${min > 60 ? 's' : ''}` : `for ${min} minute${min > 1 ? 's' : ''}`);

  function playerRow(p) {
    return `<button class="row adm-p" data-act="adm-open" data-id="${esc(p.id)}"><div class="r-main"><b>${esc(p.username || 'No name')}${p.admin ? ' <em class="code-tag">ADMIN</em>' : ''}</b>
      <small>Best ${p.best ? fmtInt(p.best) : '-'} · ${fmtInt(p.runs)} runs${p.flagged ? ` · ${p.flagged} flagged` : ''}${p.tamper ? ` · ${p.tamper} tamper` : ''}</small></div>${banChip(p.ban)}</button>`;
  }

  async function renderAdmin() {
    const s = el('scr-admin');
    const gate = needOnline('Admin tools') || (status && status.admin ? '' : `<div class="empty">${icon('shield')}<b>Admins only</b></div>`);
    if (gate) { s.innerHTML = `<div class="wrap">${header('Admin', 'online')}${gate}</div>`; return; }
    if (adminSel) return renderAdminPlayer();
    const t = tabs([['find', 'Players'], ['flagged', 'Flagged'], ['suspects', 'Suspects']], adminTab, 'admtab');
    const search = adminTab === 'find' ? `<form class="join-row" id="adm-form"><input id="adm-q" class="field" maxlength="16" autocomplete="off" autocapitalize="off" placeholder="Search players" value="${esc(adminQuery)}"><button class="btn sm primary" type="submit">${icon('search')}</button></form>` : '';
    s.innerHTML = `<div class="wrap">${header('Admin', 'online')}${t}${search}<div class="list" id="adm-list"><p class="lead">Loading…</p></div></div>`;
    const form = el('adm-form');
    if (form) form.addEventListener('submit', (e) => { e.preventDefault(); adminQuery = el('adm-q').value.trim(); renderAdmin(); });
    const tab = adminTab;
    const res = tab === 'find' ? await Online.admin('find', { p_query: adminQuery }) : await Online.admin(tab, {});
    if (current() !== 'scr-admin' || adminSel || tab !== adminTab) return;
    const list = el('adm-list');
    if (!res.ok) { list.innerHTML = `<p class="lead">${esc(res.error)}</p>`; return; }
    const rows = res.data || [];
    if (tab === 'flagged') {
      list.innerHTML = rows.length ? `<p class="lead">These scores passed the hard checks but looked unusual, so they are hidden until you decide.</p>` + rows.map((f) => `<div class="row toggle"><div class="r-main">
        <b><button class="link" data-act="adm-open" data-id="${esc(f.user_id)}">${esc(f.username)}</button> · ${fmtInt(f.score)}</b>
        <small>${fmtTime(f.time_s)} · ${fmtInt(f.kills)} kills · LV ${f.level} · ${f.mode}${f.sector > 1 ? ' S' + f.sector : ''} · ${esc(f.flag_reason || '')}</small></div>
        <div class="r-act two-btn"><button class="btn sm" data-act="adm-review" data-id="${f.id}" data-ok="1">${icon('check')}</button><button class="btn sm danger" data-act="adm-review" data-id="${f.id}" data-ok="0">${icon('ban')}</button></div></div>`).join('')
        : '<p class="lead">Nothing to review.</p>';
    } else {
      list.innerHTML = rows.length ? rows.map(playerRow).join('') : `<p class="lead">${tab === 'suspects' ? 'No suspicious players.' : 'No players found.'}</p>`;
    }
  }

  async function renderAdminPlayer() {
    const s = el('scr-admin'), id = adminSel;
    s.innerHTML = `<div class="wrap">${header('Player', 'online')}<button class="link" data-act="adm-back">${icon('back')} All players</button><p class="lead">Loading…</p></div>`;
    const res = await Online.admin('player', { p_user: id });
    if (current() !== 'scr-admin' || adminSel !== id) return;
    if (!res.ok || !res.data || !res.data.player) { s.querySelector('.lead').textContent = (res && res.error) || 'Player not found'; return; }
    const { player: p, scores, bans } = res.data, tamper = res.data.tamper || [];
    s.innerHTML = `<div class="wrap">${header('Player', 'online')}<button class="link back-link" data-act="adm-back">${icon('back')} All players</button>
      <div class="acct-card">${icon('user')}<b>${esc(p.username || 'No name')}</b><small>Joined ${p.joined ? when(p.joined) : '?'} · ${fmtInt(p.runs)} runs · best ${p.best ? fmtInt(p.best) : '-'}</small>${banChip(p.ban)}</div>
      ${p.admin ? '<p class="lead">Admins cannot be banned.</p>' : `
      <h3 class="sec">Ban</h3>
      ${p.ban ? `<p class="ban-note">${icon('ban')}<span>Banned ${p.ban.until ? 'until ' + when(p.ban.until) : 'permanently'}${p.ban.reason ? ': ' + esc(p.ban.reason) : ''}</span></p><button class="btn primary" data-act="adm-unban">Unban now</button>` : ''}
      <input id="adm-reason" class="field" maxlength="200" placeholder="Reason (the player sees this)">
      <div class="ban-grid">${BAN_PRESETS.map(([l, m]) => `<button class="btn sm ${m == null ? 'danger' : ''}" data-act="adm-ban" data-min="${m == null ? '' : m}">${l}</button>`).join('')}</div>
      <div class="ban-custom"><input id="adm-len" class="field" type="number" inputmode="numeric" min="1" placeholder="Length">
        <select id="adm-unit" class="field"><option value="1">minutes</option><option value="60" selected>hours</option><option value="1440">days</option><option value="10080">weeks</option></select>
        <button class="btn sm danger" data-act="adm-ban-custom">Ban</button></div>`}
      <h3 class="sec">Scores <span>${scores.length}</span></h3>
      <div class="list">${scores.map((x) => `<div class="row toggle ${x.flagged ? 'flag' : ''}"><div class="r-main"><b>${fmtInt(x.score)}${x.flagged ? ' <em class="code-tag">FLAGGED</em>' : ''}</b>
        <small>${fmtTime(x.time_s)} · ${fmtInt(x.kills)} kills · LV ${x.level} · ${x.mode}${x.won ? ' · won' : ''}${x.flag_reason ? ' · ' + esc(x.flag_reason) : ''}</small></div></div>`).join('') || '<p class="lead">No scores.</p>'}</div>
      ${scores.length ? `<button class="btn danger" data-act="adm-wipe">Delete all their scores</button>` : ''}
      ${tamper.length ? `<h3 class="sec">Tamper reports <span>${tamper.length}</span></h3><div class="list">${tamper.map((x) => `<div class="row toggle"><div class="r-main"><b>${esc(x.tamper)}</b><small>${when(x.started_at)} · ${x.mode}</small></div></div>`).join('')}</div>` : ''}
      <h3 class="sec">Ban history <span>${bans.length}</span></h3>
      <div class="list">${bans.map((b) => `<div class="row toggle"><div class="r-main"><b>${b.until ? 'Until ' + when(b.until) : 'Permanent'}${b.lifted_at ? ' · lifted' : ''}</b>
        <small>${when(b.created_at)} by ${esc(b.by_name || 'admin')}${b.reason ? ' · ' + esc(b.reason) : ''}</small></div></div>`).join('') || '<p class="lead">Never banned.</p>'}</div>
    </div>`;
    s.dataset.name = p.username || 'this player';
  }

  function confirmBan(minutes) {
    const name = el('scr-admin').dataset.name, reason = (el('adm-reason') || {}).value || '';
    modal(`<h2 class="title">Ban ${esc(name)}?</h2><p class="sub">${esc(name)} will be banned ${banLength(minutes)}.${reason.trim() ? ` Reason: ${esc(reason.trim())}` : ''}</p>
      <button class="btn danger" data-act="adm-ban-go" data-min="${minutes == null ? '' : minutes}">Ban ${banLength(minutes)}</button>
      <button class="btn ghost" data-act="modal-close">Cancel</button>`);
    el('modal').dataset.reason = reason.trim();
  }

  // ---------- co-op lobby ----------
  function renderCoop() {
    const gate = needOnline('Co-op');
    const st = Coop.state;
    let body;
    if (!gate && pendingJoin && !st.code) {
      // Arrived from an invite link: join straight away.
      const code = pendingJoin;
      pendingJoin = null;
      Coop.join(code);
    }
    if (gate) body = (pendingJoin ? `<p class="sub">You were invited to room <b>${esc(pendingJoin)}</b>. Log in to join.</p>` : '') + gate;
    else if (!st.code) {
      body = `<p class="lead">Play together with 2-4 friends in the same arena. One phone hosts the game; keep the host on Wi-Fi if you can. Stand next to a downed teammate to revive them.</p>
        <button class="btn primary big" data-act="coop-create">Create room</button>
        <h3 class="sec">Got a code from a friend?</h3>
        <div class="join-row"><input id="coop-code" class="field code-in" maxlength="4" autocomplete="off" autocapitalize="characters" placeholder="CODE"><button class="btn sm primary" data-act="coop-join">Join</button></div>
        <p class="form-msg" id="coop-msg" role="alert">${esc(st.error || '')}</p>`;
    } else {
      const members = st.members.map((m) => {
        const c = CHARS[m.charId] || CHARS.volt;
        return `<div class="row member" style="--c:${c.color}"><div class="r-ic">${shipSvg(c.color)}</div><div class="r-main"><b>${esc(m.name)}${m.id === st.selfId ? ' (you)' : ''}</b><small>${c.name}</small></div><div class="r-act">${m.host ? '<span class="chip on">Host</span>' : ''}</div></div>`;
      }).join('');
      body = `<div class="room-code"><small>Room code</small><b>${st.code}</b><button class="btn sm" data-act="copy" data-text="${st.code}">${icon('copy')} Copy</button></div>
        ${st.isHost ? `<button class="btn primary" data-act="coop-invite">${icon('users')} Invite friends</button>
          <p class="lead">Send the code or the invite link. Friends open the link, or type the code in Online > Co-op.</p>` : ''}
        <div class="list">${members || '<p class="lead">Connecting…</p>'}</div>
        <p class="form-msg" role="alert">${esc(st.error || '')}</p>
        ${st.isHost ? `<button class="btn primary big" data-act="coop-start" ${st.members.length >= 2 ? '' : 'disabled'}>Start (${st.members.length}/4)</button>` : '<p class="lead">Waiting for the host to start…</p>'}
        <button class="btn ghost" data-act="coop-leave">Leave room</button>`;
    }
    el('scr-coop').innerHTML = `<div class="wrap">${header('Co-op', 'online')}${body}</div>`;
  }

  // ---------- settings ----------
  function renderSettings() {
    const t = (key, label, sub) => `<div class="row toggle"><div class="r-main"><b>${label}</b>${sub ? `<small>${sub}</small>` : ''}</div>
      <button class="switch" role="switch" aria-checked="${!!save.settings[key]}" aria-label="${label}" data-act="toggle" data-key="${key}"><i></i></button></div>`;
    el('scr-settings').innerHTML = `<div class="wrap">${header('Settings')}
      <div class="list">
        ${t('sfx', 'Sound effects', 'Follows your silent switch')}
        ${t('music', 'Music')}
        ${t('haptics', 'Haptics', 'Menu taps, on iPhones that support it')}
        ${t('shake', 'Screen shake')}
        ${t('dmgNums', 'Damage numbers')}
      </div>
      <h3 class="sec">Account</h3>
      <button class="btn" data-act="go" data-to="account">${Online.user ? 'Account and cloud save' : 'Log in to save to the cloud'}</button>
      <h3 class="sec">Save code</h3>
      <p class="lead">Without an account, Safari and the Home Screen app keep separate progress. Copy a code in one, paste it in the other.</p>
      <div class="list">
        <button class="btn" data-act="export">Copy my save code</button>
        <textarea id="save-code" class="code" rows="3" placeholder="Paste a save code here" spellcheck="false" autocomplete="off"></textarea>
        <button class="btn" data-act="import">Load pasted code</button>
      </div>
      <h3 class="sec">Install</h3>
      <p class="lead">${isStandalone() ? 'You are playing the installed app.' : 'In Safari, tap <b>Share</b> then <b>Add to Home Screen</b> for fullscreen play that works offline.'}</p>
      <button class="btn danger" data-act="reset">Reset all progress</button>
      <p class="ver">Neon Swarm v${VERSION}${storageOk ? '' : ' · progress cannot be saved in this browser mode'}</p>
    </div>`;
  }

  // ---------- in-run overlays ----------
  function choiceCard(c, g, i) {
    const sh = g.local;
    let color, ic, name, badge, desc, extra = '', cls = '';
    if (c.kind === 'weapon') {
      const w = WEAPONS[c.id], max = weaponMax(c.id);
      color = w.color; ic = w.icon; name = w.name;
      badge = c.level === 1 ? 'New' : 'Lv ' + c.level;
      desc = c.level === 1 ? w.desc : w.ups[c.level - 2][0];
      const has = sh.passives.some((p) => p.id === w.evo.with);
      extra = pips(c.level, max, color) + `<small class="evo-hint ${has ? 'ready' : ''}">Evolves with ${PASSIVES[w.evo.with].name}${has ? ' ✓' : ''}</small>`;
    } else if (c.kind === 'passive') {
      const p = PASSIVES[c.id];
      color = p.color; ic = p.icon; name = p.name;
      badge = c.level === 1 ? 'New' : 'Lv ' + c.level;
      desc = p.desc;
      const pairs = Object.entries(WEAPONS).find(([, w]) => w.evo.with === c.id);
      const owned = pairs && sh.weapons.some((w) => w.id === pairs[0]);
      extra = pips(c.level, p.max, color) + (pairs ? `<small class="evo-hint ${owned ? 'ready' : ''}">Evolves ${pairs[1].name}${owned ? ' ✓' : ''}</small>` : '');
    } else if (c.kind === 'evo') {
      const w = WEAPONS[c.id];
      color = '#ffd447'; ic = w.icon; name = w.evo.name; badge = 'Evolution'; desc = w.evo.desc; cls = 'gold';
    } else if (c.kind === 'heal') {
      color = '#6dff9a'; ic = 'plus'; name = 'Repair'; badge = ''; desc = 'Restore 30% of your health';
    } else {
      color = '#ffd447'; ic = 'gold'; name = 'Gold cache'; badge = ''; desc = '+25 gold';
    }
    return `<button class="card ${cls}" data-act="choose" data-i="${i}" style="--c:${color};--d:${i * 70}ms">
      <span class="c-ic">${icon(ic)}</span>
      <span class="c-main"><span class="c-top"><b>${name}</b>${badge ? `<em>${badge}</em>` : ''}</span><span class="c-desc">${desc}</span>${extra}</span>
    </button>`;
  }

  function lockFor(section, ms) {
    section.classList.add('locked');
    clearTimeout(section._lock);
    section._lock = setTimeout(() => section.classList.remove('locked'), ms);
  }

  function showLevelUp(g, choices) {
    levelChoices = choices;
    if (DEBUG.bot) {
      setTimeout(() => { g.choose(g.botChoose(g.local, choices)); show(null); }, 0);
      return;
    }
    const s = el('scr-level');
    s.innerHTML = `<div class="wrap level">
      <h2 class="title">Level up</h2>
      <p class="sub">Level ${g.level - g.pendingLevels + 1}${g.pendingLevels > 1 ? ` · ${g.pendingLevels - 1} more to pick` : ''}${g.coop ? ' · the team waits for everyone' : ''}</p>
      <div class="cards">${choices.map((c, i) => choiceCard(c, g, i)).join('')}</div>
      <button class="btn ghost" data-act="reroll" ${g.local.rerolls > 0 ? '' : 'disabled'}>${icon('reroll')} Reroll <span class="btn-sub">${g.local.rerolls} left</span></button>
    </div>`;
    show('scr-level');
    lockFor(s, 450);
  }

  function showWaiting() {
    el('scr-level').innerHTML = `<div class="wrap level"><h2 class="title">Picked</h2><p class="sub">Waiting for your teammates to choose…</p></div>`;
    show('scr-level');
  }

  function showChest(g, reward) {
    if (DEBUG.bot) {
      setTimeout(() => { g.closeChest(); show(null); }, 0);
      return;
    }
    let body;
    if (reward.evo) {
      const w = WEAPONS[reward.evo];
      body = `<div class="card gold static" style="--c:#ffd447"><span class="c-ic">${icon(w.icon)}</span>
        <span class="c-main"><span class="c-top"><b>${w.evo.name}</b><em>Evolution</em></span><span class="c-desc">${w.evo.desc}</span></span></div>`;
    } else if (reward.ups.length) {
      body = reward.ups.map((c, i) => choiceCard(c, g, i).replace('<button', '<div').replace('</button>', '</div>').replace('class="card', 'class="card static')).join('');
    } else {
      body = `<p class="sub">Your build is complete.</p>`;
    }
    const s = el('scr-chest');
    s.innerHTML = `<div class="wrap chest">
      <div class="chest-art">${icon('chest')}</div>
      <h2 class="title">${reward.evo ? 'Evolution!' : 'Chest'}</h2>
      <div class="cards reveal">${body}<p class="chest-gold">${icon('gold')} +${reward.gold} gold</p></div>
      <button class="btn primary" data-act="chest-ok">Continue</button>
    </div>`;
    show('scr-chest');
    lockFor(s, 1100);
    if (reward.evo || reward.ups.length) Haptics.tap();
  }

  function buildList(sh) {
    const items = sh.weapons.map((w) => {
      const d = WEAPONS[w.id];
      return `<div class="bi" style="--c:${w.evo ? '#ffd447' : d.color}"><span class="c-ic">${icon(d.icon)}</span><b>${w.evo ? d.evo.name : d.name}</b>${w.evo ? '<em>Evolved</em>' : pips(w.level, weaponMax(w.id), d.color)}</div>`;
    }).concat(sh.passives.map((p) => {
      const d = PASSIVES[p.id];
      return `<div class="bi" style="--c:${d.color}"><span class="c-ic">${icon(d.icon)}</span><b>${d.name}</b>${pips(p.level, d.max, d.color)}</div>`;
    }));
    return `<div class="build">${items.join('')}</div>`;
  }

  function showPause(g) {
    confirmQuit = 0;
    const t = (key, label) => `<button class="switch-pill" role="switch" aria-checked="${!!save.settings[key]}" data-act="toggle" data-key="${key}">${label}</button>`;
    el('scr-pause').innerHTML = `<div class="wrap pause">
      <h2 class="title">Paused</h2>
      <p class="sub">${icon('clock')} ${fmtTime(g.t)} &nbsp; ${icon('skull')} ${fmtInt(g.kills)} &nbsp; LV ${g.level}${g.daily ? ' · Daily: ' + g.mod.name : ''}${g.sector > 1 ? ' · ' + SECTORS[g.sector].name : ''}</p>
      ${buildList(g.local)}
      <button class="btn primary big" data-act="resume">Resume</button>
      <div class="pill-row">${t('sfx', 'Sound')}${t('music', 'Music')}${t('shake', 'Shake')}</div>
      <button class="btn ghost" data-act="quit">Quit run</button>
    </div>`;
    show('scr-pause');
  }

  // ---------- game over ----------
  function nextGoal() {
    const locked = Object.entries(CHARS).filter(([id, c]) => !save.chars[id] && (c.unlock.gold || c.unlock.gems));
    const goldChar = locked.filter(([, c]) => c.unlock.gold).sort((a, b) => a[1].unlock.gold - b[1].unlock.gold)[0];
    if (goldChar && goldChar[1].unlock.gold > save.gold) return `${goldChar[1].name} unlocks at ${fmtInt(goldChar[1].unlock.gold)} gold. You have ${fmtInt(save.gold)}.`;
    if (goldChar) return `You can afford ${goldChar[1].name}! Visit Pilots.`;
    const cheap = SHOP.filter((it) => shopRank(it.id) < shopUnlockedMax(it)).map((it) => [it, shopCost(it, shopRank(it.id))]).sort((a, b) => a[1] - b[1])[0];
    if (cheap) return cheap[1] <= save.gold ? `You can afford ${cheap[0].name} in Upgrades.` : `Next upgrade: ${cheap[0].name} for ${fmtInt(cheap[1])} gold.`;
    return '';
  }

  function showOver(r, sum) {
    lastResult = { r, sum };
    const title = r.won ? 'Victory' : r.quit ? 'Run ended' : 'Destroyed';
    const rows = [
      ['clock', 'Survived', r.time, 'time'],
      ['skull', 'Enemies destroyed', r.kills, 'int'],
      ['up', 'Level reached', r.level, 'int'],
      ['trophy', 'Score', r.score, 'int'],
    ];
    const need = rankXpFor(save.rank);
    const notes = [];
    if (sum.ranks.length) notes.push(`<p class="unlock">${icon('medal')} Rank ${save.rank}! <button class="link" data-act="go" data-to="rank">Claim rewards</button></p>`);
    if (sum.masteryUp) notes.push(`<p class="unlock">${icon('ship')} ${CHARS[r.charId].name} reached mastery ${sum.masteryUp}</p>`);
    for (const id of sum.newPilots) notes.push(`<p class="unlock">${shipSvg(CHARS[id].color)} New pilot unlocked: <b>${CHARS[id].name}</b></p>`);
    if (sum.sectorUnlocked) notes.push(`<p class="unlock" style="color:${SECTORS[sum.sectorUnlocked].color}">${icon('sector')} ${SECTORS[sum.sectorUnlocked].name} unlocked</p>`);
    const qc = questsClaimable() + dailyClaimable();
    el('scr-over').innerHTML = `<div class="wrap over ${r.won ? 'won' : ''}">
      <h2 class="title big">${title}</h2>
      ${sum.newBest ? '<p class="new-best">New best score</p>' : ''}
      <div class="stats">${rows.map(([ic, label, v, f], i) => `<div class="stat">${icon(ic)}<span>${label}</span><b data-count="${v}" data-fmt="${f}" data-delay="${i * 150}">0</b></div>`).join('')}</div>
      <div class="gold-earned">${icon('gold')}<b data-count="${sum.gold}" data-fmt="int" data-delay="650">0</b><span>gold${sum.dailyBonus ? ` (incl. ${sum.dailyBonus} daily bonus)` : ''}</span></div>
      <div class="rank-strip static"><b>Rank ${save.rank}</b><span class="prog"><i style="width:${save.rank >= RANK_CAP ? 100 : (save.rankXp / need) * 100}%"></i></span><small>+${fmtInt(sum.rankXp)} XP</small></div>
      ${notes.join('')}
      <div id="over-online" class="online-res"></div>
      ${buildList({ weapons: r.weapons, passives: r.passives })}
      ${qc ? `<p class="hint">${icon('trophy')} ${qc} quest reward${qc > 1 ? 's' : ''} ready to claim</p>` : ''}
      <p class="goal">${nextGoal()}</p>
      <button class="btn primary big" data-act="again">Play again</button>
      <div class="two"><button class="btn" data-act="go" data-to="shop">Upgrades</button><button class="btn" data-act="go" data-to="menu">Menu</button></div>
    </div>`;
    show('scr-over');
    lockFor(el('scr-over'), 700);
    counters.length = 0;
    const now = performance.now();
    for (const b of el('scr-over').querySelectorAll('[data-count]')) {
      counters.push({ el: b, to: +b.dataset.count, fmt: b.dataset.fmt, start: now + +b.dataset.delay, dur: 900 });
    }
  }

  // Filled in as online calls come back.
  function setOverOnline(html) {
    const box = el('over-online');
    if (box) box.innerHTML = html;
  }

  function tick() {
    if (!counters.length) return;
    const now = performance.now();
    for (let i = counters.length - 1; i >= 0; i--) {
      const c = counters[i], t = clamp((now - c.start) / c.dur, 0, 1), v = c.to * easeOutCubic(t);
      c.el.textContent = c.fmt === 'time' ? fmtTime(v) : fmtInt(v);
      if (t >= 1) counters.splice(i, 1);
    }
  }

  // ---------- modal + daily login ----------
  function modal(html, lockMs = 400) {
    const m = el('modal');
    m.innerHTML = `<div class="wrap modal-box">${html}</div>`;
    m.hidden = false;
    lockFor(m, lockMs);
  }

  function closeModal() {
    el('modal').hidden = true;
    el('modal').innerHTML = '';
  }

  function showLogin() {
    const step = save.login.step % LOGIN_REWARDS.length;
    const days = LOGIN_REWARDS.map((rw, i) => `<div class="day ${i < step ? 'got' : i === step ? 'today' : ''}">
      <small>Day ${i + 1}</small>${icon(rw.egg ? 'egg' : rw.gems ? 'gem' : 'gold')}<b>${rw.egg ? 'Egg' : fmtInt(rw.gems || rw.gold)}</b></div>`).join('');
    modal(`<h2 class="title">Daily reward</h2><p class="sub">Come back every day. Day 7 gives an egg.</p>
      <div class="calendar">${days}</div>
      <button class="btn primary big" data-act="claim-login">Claim ${rewardText(LOGIN_REWARDS[step])}</button>`, 600);
  }

  function maybeShowLogin() {
    if (loginReady() && !api.getGame() && current() === 'scr-menu' && el('modal').hidden) showLogin();
  }

  // ---------- misc ----------
  function toast(msg) {
    const t = el('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 2400);
  }

  function updateHudButtons() {
    const on = save.settings.sfx || save.settings.music;
    el('btn-mute').innerHTML = icon(on ? 'soundOn' : 'soundOff');
    el('btn-mute').setAttribute('aria-label', on ? 'Mute sound' : 'Turn sound on');
  }

  function applySettings() {
    Sound.setSfx(save.settings.sfx);
    Sound.setMusic(save.settings.music);
    Haptics.set(save.settings.haptics);
    if (save.settings.music && api.getGame()) Sound.startMusic();
    if (!save.settings.music) Sound.stopMusic();
    updateHudButtons();
  }

  const RENDER = {
    hangar: renderHangar, quests: renderQuests, online: renderOnline, board: renderBoard,
    account: renderAccount, raid: renderRaid, duel: renderDuel, coop: renderCoop, settings: renderSettings, admin: renderAdmin,
  };
  // Old destinations now live as tabs inside the hub screens.
  const ALIAS = { pilots: ['hangar', 'pilots'], pets: ['hangar', 'pets'], shop: ['hangar', 'shop'], rank: ['quests', 'rank'] };

  function go(to) {
    if (to === 'menu') { api.exitToMenu(); return; }
    if (api.getGame() && api.getGame().finished) api.exitToMenu(true);
    if (ALIAS[to]) {
      const [hub, tab] = ALIAS[to];
      if (hub === 'hangar') hangarTab = tab;
      else questTab = tab;
      to = hub;
    }
    show('scr-' + to);
    RENDER[to]();
    el('scr-' + to).scrollTop = 0;
    if (to === 'quests' && questTab === 'rank') {
      const cur = el('rank-' + Math.max(2, save.rank));
      if (cur) cur.scrollIntoView({ block: 'center' });
    }
  }

  function rerender() {
    const id = current();
    if (!id) return;
    if (id === 'scr-menu') { renderMenu(); return; }
    const key = id.slice(4);
    if (RENDER[key] && !['board', 'raid', 'duel', 'admin'].includes(key)) {
      const s = el(id), top = s.scrollTop;
      RENDER[key]();
      s.scrollTop = top;
    }
  }

  async function onAction(btn) {
    const act = btn.dataset.act, g = api.getGame();
    switch (act) {
      case 'go': go(btn.dataset.to); break;
      case 'play': api.startRun({ mode: 'normal', sector: save.sector }); break;
      case 'continue': api.startRun({ resume: save.run }); break;
      case 'daily': closeModal(); api.startRun({ mode: 'daily' }); break;
      case 'again':
        api.startRun({ mode: 'normal', sector: save.sector });
        break;
      case 'sector':
        save.sector = clamp((save.sector || 1) + +btn.dataset.d, 1, save.sectorMax);
        writeSave();
        renderMenu();
        break;
      case 'pick-char':
        save.selChar = btn.dataset.id;
        writeSave();
        rerender();
        break;
      case 'buy-char': {
        const c = CHARS[btn.dataset.id], u = c.unlock;
        if (!buyPilot(btn.dataset.id)) {
          Sound.play.deny();
          toast(u.gold ? `You need ${fmtInt(u.gold - save.gold)} more gold` : `You need ${fmtInt(u.gems - save.gems)} more gems`);
          return;
        }
        save.selChar = btn.dataset.id;
        writeSave();
        Sound.play.buy();
        Haptics.tap();
        toast(`${c.name} unlocked`);
        rerender();
        return;
      }
      case 'buy': {
        const it = SHOP.find((x) => x.id === btn.dataset.id), r = shopRank(it.id), cost = shopCost(it, r);
        if (r >= shopUnlockedMax(it)) return;
        if (save.gold < cost) { Sound.play.deny(); toast(`You need ${fmtInt(cost - save.gold)} more gold`); return; }
        save.gold -= cost;
        save.shop[it.id] = r + 1;
        save.stats.shopBuys++;
        writeSave();
        Sound.play.buy();
        Haptics.tap();
        rerender();
        return;
      }
      case 'hatch': {
        const res = hatchEgg(btn.dataset.id);
        if (!res) { Sound.play.deny(); toast(`You need ${EGGS[btn.dataset.id].cost - save.gems} more gems`); return; }
        Haptics.tap();
        showHatch(res);
        rerender();
        return;
      }
      case 'equip': {
        const free = save.petSlots.slice(0, petSlotsUnlocked()).indexOf(null);
        equipPet(btn.dataset.id, free >= 0 ? free : 0);
        rerender();
        break;
      }
      case 'unequip':
        unequipPet(+btn.dataset.slot);
        rerender();
        break;
      case 'claim': case 'claim-daily': case 'claim-bonus': case 'claim-rank': case 'claim-login': {
        if ((act === 'claim-login' || act === 'claim-daily' || act === 'claim-bonus') && !Clock.synced) {
          toast('Checking the time with the server… try again in a moment. (Daily rewards need the internet.)');
          Updater.check();
          return;
        }
        const got = act === 'claim' ? claimQuest(btn.dataset.id) : act === 'claim-daily' ? claimDaily(btn.dataset.id)
          : act === 'claim-bonus' ? claimDailyBonus() : act === 'claim-rank' ? claimRankRewards() : (claimLogin() || {}).got;
        if (!got) return;
        Sound.play.coin();
        Haptics.tap();
        toast('+' + got.join(', '));
        if (act === 'claim-login') { closeModal(); renderMenu(); }
        else rerender();
        return;
      }
      case 'qtab': questTab = btn.dataset.tab; renderQuests(); el('scr-quests').scrollTop = 0; break;
      case 'htab': hangarTab = btn.dataset.tab; renderHangar(); el('scr-hangar').scrollTop = 0; break;
      case 'daily-info': showDailyInfo(); break;
      case 'online-retry': {
        btn.disabled = true;
        btn.textContent = 'Connecting…';
        const ok = await api.connectOnline();
        toast(ok ? 'Connected' : "Still can't connect");
        rerender();
        break;
      }
      case 'lb-daily': closeModal(); lbBoard = 'daily'; go('board'); break;
      case 'set-pass': {
        const res = await Online.updatePassword(el('f-newpass').value);
        if (!res.ok) { el('f-msg2').textContent = res.error; return; }
        closeModal();
        toast('Password changed');
        break;
      }
      case 'lbtab': lbBoard = btn.dataset.tab; renderBoard(); break;
      case 'atab': acctTab = btn.dataset.tab; renderAccount(); break;
      case 'forgot': {
        const email = el('f-email').value.trim();
        if (!email) { el('f-msg').textContent = 'Type your email above first.'; return; }
        const res = await Online.resetPassword(email);
        el('f-msg').textContent = res.ok ? 'Check your email for a reset link.' : res.error;
        break;
      }
      case 'set-name': {
        const res = await Online.setUsername(el('f-name').value.trim());
        if (!res.ok) { toast(res.error); Sound.play.deny(); return; }
        toast('Name saved');
        renderAccount();
        break;
      }
      case 'delete-account':
        modal(`<h2 class="title">Delete account?</h2>
          <p class="sub">This permanently deletes your login, your cloud save, your leaderboard scores and your duels.</p>
          <p class="lead">Your cloud save's encryption key is destroyed first, so the save can never be read again, not even by the game's owner. Progress on this phone stays unless you also reset it in Settings.</p>
          <button class="btn danger" data-act="delete-confirm">Delete my account</button>
          <button class="btn ghost" data-act="modal-close">Keep my account</button>`);
        break;
      case 'delete-confirm': {
        btn.disabled = true;
        btn.textContent = 'Deleting…';
        const res = await Online.deleteAccount();
        closeModal();
        toast(res.ok ? 'Account deleted' : res.error);
        save.lastCloud = 0;
        writeSave(true);
        renderAccount();
        break;
      }
      case 'logout':
        await Online.signOut();
        toast('Logged out');
        renderAccount();
        break;
      case 'sync': {
        const ok = await api.cloudPush(true);
        toast(ok ? 'Saved to the cloud' : 'Could not reach the cloud. Try again later.');
        if (current() === 'scr-account') renderAccount();
        break;
      }
      case 'raid-claim': {
        const res = await Online.raidClaim(+btn.dataset.id);
        if (!res.ok) { toast(res.error); return; }
        grant(res.reward.eggs ? { gems: res.reward.gems, egg: 'basic' } : { gems: res.reward.gems });
        save.stats.raidsHelped++;
        writeSave();
        Sound.play.chest();
        toast(`+${res.reward.gems} gems${res.reward.eggs ? ' and a Swarm Egg' : ''}`);
        renderRaid();
        return;
      }
      case 'duel-new':
        api.startRun({ mode: 'duel', seed: (Math.random() * 4294967296) >>> 0, charId: save.selChar });
        break;
      case 'duel-join': {
        const code = el('duel-code').value.trim().toUpperCase();
        const msg = el('duel-msg');
        if (code.length !== 6) { msg.textContent = 'Codes are 6 characters.'; return; }
        msg.textContent = 'Looking up the duel…';
        const d = await Online.duelGet(code);
        if (!d) { msg.textContent = 'No duel with that code.'; return; }
        if (d.isCreator) { msg.textContent = 'That is your own duel. Send it to a friend.'; return; }
        if (d.done) { msg.textContent = 'That duel is already finished.'; return; }
        joinedDuel = d;
        const c = CHARS[d.pilot] || CHARS.volt;
        modal(`<h2 class="title">Duel</h2><p class="sub">${esc(d.creatorName)} scored <b>${fmtInt(d.creatorScore)}</b> as ${c.name} (${fmtTime(d.creatorTime)}, ${fmtInt(d.creatorKills)} kills).</p>
          <p class="lead">You fly ${c.name} on the same seed. Beat their score to win.</p>
          <button class="btn primary big" data-act="duel-accept">Accept</button><button class="btn ghost" data-act="modal-close">Not now</button>`);
        break;
      }
      case 'duel-accept':
        closeModal();
        if (joinedDuel) api.startRun({ mode: 'duel', seed: joinedDuel.seed, charId: joinedDuel.pilot, duelCode: joinedDuel.code });
        break;
      case 'duel-send': {
        const r = lastResult && lastResult.r;
        if (!r) return;
        btn.disabled = true;
        const res = await Online.duelCreate({ runId: r.runId, pilot: r.charId, score: r.score, time: r.time, kills: r.kills });
        if (!res.ok) { toast(res.error); btn.disabled = false; return; }
        setOverOnline(`<div class="room-code"><small>Send this code to a friend</small><b>${res.code}</b><button class="btn sm" data-act="copy" data-text="${res.code}">${icon('copy')} Copy</button></div>`);
        break;
      }
      case 'copy': {
        const text = btn.dataset.text;
        try { await navigator.clipboard.writeText(text); toast('Copied ' + text); } catch (e) { toast('Code: ' + text); }
        break;
      }
      case 'coop-create': Coop.create(); break;
      case 'coop-invite': {
        const code = Coop.state.code;
        if (!code) return;
        const url = location.origin + location.pathname + '?join=' + code;
        const text = `Join my Neon Swarm co-op! Room code: ${code}`;
        if (navigator.share) {
          try { await navigator.share({ title: 'Neon Swarm co-op', text, url }); } catch (e) { /* closed the share sheet */ }
        } else {
          try { await navigator.clipboard.writeText(`${text}\n${url}`); toast('Invite copied. Paste it to a friend.'); } catch (e) { toast(`Room code: ${code}`); }
        }
        break;
      }
      case 'coop-join': {
        const code = el('coop-code').value.trim().toUpperCase();
        if (code.length !== 4) { el('coop-msg').textContent = 'Room codes are 4 characters.'; return; }
        Coop.join(code);
        break;
      }
      case 'coop-start': Coop.start(); break;
      case 'coop-leave': Coop.leave(); renderCoop(); break;
      case 'toggle': {
        const k = btn.dataset.key;
        save.settings[k] = !save.settings[k];
        writeSave();
        btn.setAttribute('aria-checked', String(save.settings[k]));
        applySettings();
        break;
      }
      case 'mute': {
        const on = !(save.settings.sfx || save.settings.music);
        save.settings.sfx = on;
        save.settings.music = on;
        writeSave();
        applySettings();
        break;
      }
      case 'pause':
        if (g && g.pause()) showPause(g);
        break;
      case 'resume':
        if (g) g.resume();
        show(null);
        break;
      case 'quit':
        if (Date.now() - confirmQuit > 3000) {
          confirmQuit = Date.now();
          btn.textContent = 'Tap again to quit';
          return;
        }
        if (g) g.quit();
        break;
      case 'choose': {
        const c = levelChoices[+btn.dataset.i];
        if (!g || !c) return;
        Haptics.tap();
        if (g.role === 'client') { Coop.sendPick(c); showWaiting(); return; }
        g.choose(c);
        if (g.state === 'levelup' && !g.local.pick) showWaiting();
        else show(null);
        return;
      }
      case 'reroll': {
        if (g && g.role === 'client') { Coop.sendReroll(); return; }
        const next = g && g.reroll();
        if (next) showLevelUp(g, next);
        break;
      }
      case 'chest-ok':
        if (g) g.closeChest();
        show(null);
        break;
      case 'modal-close': closeModal(); break;
      case 'admtab': adminTab = btn.dataset.tab; renderAdmin(); break;
      case 'adm-open': adminSel = btn.dataset.id; confirmWipe = 0; renderAdmin(); el('scr-admin').scrollTop = 0; break;
      case 'adm-back': adminSel = null; renderAdmin(); break;
      case 'adm-ban': confirmBan(btn.dataset.min === '' ? null : +btn.dataset.min); break;
      case 'adm-ban-custom': {
        const n = Math.floor(+el('adm-len').value), unit = +el('adm-unit').value;
        if (!(n >= 1)) { toast('Enter how long the ban lasts'); return; }
        const minutes = n * unit;
        if (minutes > 5256000) { toast('Bans can be at most 10 years. Use Permanent instead.'); return; }
        confirmBan(minutes);
        break;
      }
      case 'adm-ban-go': {
        const minutes = btn.dataset.min === '' ? null : +btn.dataset.min, reason = el('modal').dataset.reason || '';
        btn.disabled = true;
        const res = await Online.admin('ban', { p_user: adminSel, p_minutes: minutes, p_reason: reason });
        closeModal();
        toast(res.ok ? 'Banned ' + banLength(minutes) : res.error);
        if (res.ok) renderAdmin();
        return;
      }
      case 'adm-unban': {
        const res = await Online.admin('unban', { p_user: adminSel });
        toast(res.ok ? 'Ban lifted' : res.error);
        if (res.ok) renderAdmin();
        return;
      }
      case 'adm-wipe': {
        if (Date.now() - confirmWipe > 3000) { confirmWipe = Date.now(); toast('Tap again to delete every score this player has'); return; }
        confirmWipe = 0;
        const res = await Online.admin('delete_scores', { p_user: adminSel });
        toast(res.ok ? `Deleted ${res.data} scores` : res.error);
        if (res.ok) renderAdmin();
        return;
      }
      case 'adm-review': {
        btn.disabled = true;
        const res = await Online.admin('review', { p_score: +btn.dataset.id, p_ok: btn.dataset.ok === '1' });
        toast(res.ok ? (btn.dataset.ok === '1' ? 'Approved: it is on the leaderboard now' : 'Score removed') : res.error);
        renderAdmin();
        return;
      }
      case 'cloud-use': case 'cloud-keep':
        closeModal();
        api.cloudChoice(act === 'cloud-use');
        break;
      case 'export': {
        const code = exportSaveCode();
        const ta = el('save-code');
        ta.value = code;
        const fallback = () => { ta.focus(); ta.select(); toast('Code selected. Copy it from the box.'); };
        try { navigator.clipboard.writeText(code).then(() => toast('Save code copied'), fallback); } catch (e) { fallback(); }
        break;
      }
      case 'import': {
        const ok = importSaveCode(el('save-code').value);
        toast(ok ? 'Progress loaded' : 'That code did not work. Check it was copied in full.');
        if (ok) { applySettings(); renderSettings(); }
        break;
      }
      case 'reset':
        if (Date.now() - confirmReset > 3000) {
          confirmReset = Date.now();
          btn.textContent = 'Tap again to erase everything';
          return;
        }
        replaceSave(defaultSave());
        writeSave();
        applySettings();
        toast('Progress reset');
        api.exitToMenu();
        return;
    }
    Sound.play.click();
  }

  function init(a) {
    api = a;
    document.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-act]');
      if (!btn || btn.disabled) return;
      if (btn.closest('.locked')) return;
      onAction(btn);
      if (!['choose', 'buy', 'buy-char', 'claim', 'chest-ok', 'hatch'].includes(btn.dataset.act)) Haptics.tap();
    });
    window.addEventListener('keydown', (e) => {
      const g = api.getGame();
      if ((e.code === 'Escape' || e.code === 'KeyP') && g && e.target.tagName !== 'INPUT') {
        if (g.state === 'play' && g.pause()) showPause(g);
        else if (g.state === 'paused') { g.resume(); show(null); }
      }
    });
  }

  return {
    init, show, toast, tick, showPause, showLevelUp, showWaiting, showChest, showOver, setOverOnline, applySettings, rerender, modal, closeModal,
    maybeShowLogin, current, renderCoop,
    showNewPassword() {
      modal(`<h2 class="title">New password</h2><p class="sub">Choose a new password for your account.</p>
        <input id="f-newpass" class="field" type="password" autocomplete="new-password" placeholder="At least 6 characters">
        <p class="form-msg" id="f-msg2" role="alert"></p>
        <button class="btn primary" data-act="set-pass">Save password</button>`);
    },
    showMenu() { renderMenu(); show('scr-menu'); el('scr-menu').scrollTop = 0; setTimeout(maybeShowLogin, 350); },
    enterGame() { closeModal(); show(null); },
    setRaid(r) { raidCache = r; if (current() === 'scr-online') renderOnline(); },
    setOnlineCount(n) { onlineCount = n; },
    setStatus(st, line) {
      const changed = JSON.stringify(st) !== JSON.stringify(status);
      status = st;
      banLine = line || '';
      if (changed && ['scr-menu', 'scr-online'].includes(current())) rerender();
    },
    openInvite(code) {
      pendingJoin = code;
      if (api.getGame()) return;
      go('coop');
    },
    retryInvite() { if (pendingJoin && current() === 'scr-coop') renderCoop(); },
  };
})();
