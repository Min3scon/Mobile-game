'use strict';
/* Neon Swarm — menus and overlays (DOM over the canvas) */

const UI = (() => {
  const el = (id) => document.getElementById(id);
  let api = null;
  let levelChoices = [];
  let toastTimer = 0;
  let confirmReset = 0, confirmQuit = 0;
  const counters = [];

  const isStandalone = () => window.navigator.standalone === true || (window.matchMedia && matchMedia('(display-mode: standalone)').matches);
  const inFrame = (() => { try { return window.self !== window.top; } catch (e) { return true; } })();
  const isIOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

  function show(id) {
    for (const s of document.querySelectorAll('.screen')) s.hidden = s.id !== id;
    el('hud').hidden = !(api.getGame() && ['scr-level', 'scr-chest', 'scr-pause', null].includes(id));
    updateHudButtons();
  }

  function shipSvg(color, locked) {
    const fill = locked ? '#2a2550' : color;
    return `<svg class="ship-svg" viewBox="-15 -15 30 30" aria-hidden="true" style="--c:${fill}"><g transform="rotate(-90)"><path d="M14 0L-9.5 9.5L-3.6 0L-9.5-9.5Z" fill="${locked ? '#16132e' : rgba(color, 0.22)}" stroke="${fill}" stroke-width="2" stroke-linejoin="round"/>${locked ? '' : '<path d="M6 0L-4 4L-1.6 0L-4-4Z" fill="#fff"/>'}</g></svg>`;
  }

  function pips(level, max, color) {
    let s = '';
    for (let i = 1; i <= max; i++) s += `<i class="${i <= level ? 'on' : ''}"></i>`;
    return `<span class="pips" style="--c:${color}">${s}</span>`;
  }

  function header(title) {
    return `<header class="bar">
      <button class="icon-btn" data-act="go" data-to="menu" aria-label="Back">${icon('back')}</button>
      <h2>${title}</h2>
      <div class="pill gold">${icon('gold')}<span>${fmtInt(save.gold)}</span></div>
    </header>`;
  }

  // ---------- menu ----------
  function renderMenu() {
    const c = CHARS[save.selChar];
    const mod = dailyMod();
    const streak = currentStreak();
    const claim = questsClaimable();
    const run = save.run;
    const playedToday = save.daily.last === todayKey();
    const S = save.stats;
    const hint = isIOS && !isStandalone() && !inFrame
      ? `<p class="hint">${icon('up')} Play fullscreen: tap <b>Share</b>, then <b>Add to Home Screen</b>.</p>` : '';
    el('scr-menu').innerHTML = `
      <div class="wrap menu">
        <header class="bar">
          <div class="pill gold">${icon('gold')}<span>${fmtInt(save.gold)}</span></div>
          <button class="icon-btn" data-act="go" data-to="settings" aria-label="Settings">${icon('gear')}</button>
        </header>
        <h1 class="logo" aria-label="Neon Swarm"><span class="l1">NEON</span><span class="l2">SWARM</span></h1>
        <p class="tag">Survive 8 minutes. Destroy the Hive Queen.</p>
        <button class="pilot-chip" data-act="go" data-to="pilots" style="--c:${c.color}">
          ${shipSvg(c.color)}
          <span class="pc-text"><b>${c.name}</b><small>${WEAPONS[c.weapon].name}</small></span>
          <span class="pc-change">Change</span>
        </button>
        ${run
          ? `<button class="btn primary big" data-act="continue">Continue <span class="btn-sub">${fmtTime(run.t)} · LV ${run.level}</span></button>
             <button class="btn" data-act="play">New run</button>`
          : `<button class="btn primary big" data-act="play">Play</button>`}
        <button class="daily" data-act="daily">
          <span class="d-ic">${icon('flame')}</span>
          <span class="d-text"><b>Daily run · ${mod.name}</b><small>${mod.desc}</small></span>
          <span class="d-meta">${streak ? `<b>${streak}</b> day${streak > 1 ? 's' : ''}` : 'New'}<small>${playedToday ? 'played' : '+50% gold'}</small></span>
        </button>
        <div class="tiles">
          <button class="tile" data-act="go" data-to="pilots">${icon('ship')}<span>Pilots</span></button>
          <button class="tile" data-act="go" data-to="shop">${icon('up')}<span>Upgrades</span></button>
          <button class="tile" data-act="go" data-to="quests">${icon('trophy')}<span>Quests</span>${claim ? `<b class="badge">${claim}</b>` : ''}</button>
        </div>
        ${S.runs ? `<p class="best">${icon('clock')} Best ${fmtTime(S.bestTime)} &nbsp;·&nbsp; ${icon('skull')} ${fmtInt(S.bestKills)} kills &nbsp;·&nbsp; ${fmtInt(S.runs)} runs</p>` : ''}
        ${hint}
      </div>`;
  }

  // ---------- pilots ----------
  function renderPilots() {
    const rows = Object.entries(CHARS).map(([id, c]) => {
      const owned = !!save.chars[id], sel = save.selChar === id, w = WEAPONS[c.weapon];
      let act;
      if (owned) act = sel ? `<span class="chip on">${icon('check')} Flying</span>` : `<button class="btn sm" data-act="pick-char" data-id="${id}">Select</button>`;
      else if (c.cost != null) act = `<button class="btn sm buy ${save.gold < c.cost ? 'poor' : ''}" data-act="buy-char" data-id="${id}">${icon('gold')} ${fmtInt(c.cost)}</button>`;
      else act = `<span class="chip">${icon('lock')} Locked</span>`;
      const name = owned || c.cost != null ? c.name : '???';
      return `<div class="row pilot ${owned ? '' : 'locked'} ${sel ? 'sel' : ''}" style="--c:${c.color}">
        <div class="r-ic big">${shipSvg(c.color, !owned)}</div>
        <div class="r-main"><b>${name}</b>
          <span class="r-sub" style="color:${w.color}">${icon(w.icon)} ${w.name}</span>
          <small>${!owned && c.unlock ? c.unlock : c.perk}</small></div>
        <div class="r-act">${act}</div>
      </div>`;
    }).join('');
    el('scr-pilots').innerHTML = `<div class="wrap">${header('Pilots')}<p class="lead">Each pilot starts with a different weapon.</p><div class="list">${rows}</div></div>`;
  }

  // ---------- shop ----------
  function renderShop() {
    const rows = SHOP.map((it) => {
      const r = shopRank(it.id), maxed = r >= it.max, cost = shopCost(it, r);
      const act = maxed ? `<span class="chip on">Max</span>`
        : `<button class="btn sm buy ${save.gold < cost ? 'poor' : ''}" data-act="buy" data-id="${it.id}">${icon('gold')} ${fmtInt(cost)}</button>`;
      return `<div class="row shop" style="--c:#39f3ff">
        <div class="r-ic">${icon(it.icon)}</div>
        <div class="r-main"><b>${it.name}</b><small>${it.desc}</small>${pips(r, it.max, '#39f3ff')}</div>
        <div class="r-act">${act}</div>
      </div>`;
    }).join('');
    el('scr-shop').innerHTML = `<div class="wrap">${header('Upgrades')}<p class="lead">Permanent boosts for every run.</p><div class="list">${rows}</div></div>`;
  }

  // ---------- quests + codex ----------
  function renderQuests() {
    const rows = QUESTS.map((q) => {
      const v = Math.min(questValue(q), q.goal), done = v >= q.goal, claimed = !!save.claimed[q.id];
      const fmt = (n) => (q.time ? fmtTime(n) : fmtInt(n));
      const act = claimed ? `<span class="chip on">${icon('check')} Done</span>`
        : done ? `<button class="btn sm primary" data-act="claim" data-id="${q.id}">Claim ${q.reward}</button>`
        : `<span class="chip">${icon('gold')} ${q.reward}</span>`;
      return `<div class="row quest ${claimed ? 'claimed' : ''}">
        <div class="r-main"><b>${q.name}</b><small>${q.desc}</small>
          <span class="prog"><i style="width:${(v / q.goal) * 100}%"></i></span><small class="prog-t">${fmt(v)} / ${fmt(q.goal)}</small></div>
        <div class="r-act">${act}</div>
      </div>`;
    }).join('');
    const evos = Object.entries(WEAPONS).map(([id, w]) => {
      const found = !!save.codex[id], p = PASSIVES[w.evo.with];
      return `<div class="evo ${found ? 'found' : ''}" style="--c:${w.color}">
        <div class="r-ic">${icon(w.icon)}</div>
        <b>${found ? w.evo.name : '???'}</b>
        <small>${found ? `${w.name} + ${p.name}` : `Max ${w.name} + ???`}</small>
      </div>`;
    }).join('');
    const found = Object.keys(save.codex).length;
    el('scr-quests').innerHTML = `<div class="wrap">${header('Quests')}
      <div class="list">${rows}</div>
      <h3 class="sec">Evolutions <span>${found} / 6 found</span></h3>
      <p class="lead">Max out a weapon while holding its paired passive, then open a chest.</p>
      <div class="evos">${evos}</div></div>`;
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
      <h3 class="sec">Save code</h3>
      <p class="lead">Safari and the Home Screen app keep separate progress. Copy a code in one, paste it in the other.</p>
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
    let color, ic, name, badge, desc, extra = '', cls = '';
    if (c.kind === 'weapon') {
      const w = WEAPONS[c.id], max = weaponMax(c.id);
      color = w.color; ic = w.icon; name = w.name;
      badge = c.level === 1 ? 'New' : 'Lv ' + c.level;
      desc = c.level === 1 ? w.desc : w.ups[c.level - 2][0];
      const has = g.passives.some((p) => p.id === w.evo.with);
      extra = pips(c.level, max, color) + `<small class="evo-hint ${has ? 'ready' : ''}">Evolves with ${PASSIVES[w.evo.with].name}${has ? ' ✓' : ''}</small>`;
    } else if (c.kind === 'passive') {
      const p = PASSIVES[c.id];
      color = p.color; ic = p.icon; name = p.name;
      badge = c.level === 1 ? 'New' : 'Lv ' + c.level;
      desc = p.desc;
      const pairs = Object.entries(WEAPONS).find(([, w]) => w.evo.with === c.id);
      const owned = pairs && g.weapons.some((w) => w.id === pairs[0]);
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
      setTimeout(() => { g.choose(g.botChoose(choices)); show(null); }, 0);
      return;
    }
    const s = el('scr-level');
    s.innerHTML = `<div class="wrap level">
      <h2 class="title">Level up</h2>
      <p class="sub">Level ${g.level - g.pendingLevels + 1}${g.pendingLevels > 1 ? ` · ${g.pendingLevels - 1} more to pick` : ''}</p>
      <div class="cards">${choices.map((c, i) => choiceCard(c, g, i)).join('')}</div>
      <button class="btn ghost" data-act="reroll" ${g.rerolls > 0 ? '' : 'disabled'}>${icon('reroll')} Reroll <span class="btn-sub">${g.rerolls} left</span></button>
    </div>`;
    show('scr-level');
    lockFor(s, 450);
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

  function buildList(g) {
    const items = g.weapons.map((w) => {
      const d = WEAPONS[w.id];
      return `<div class="bi" style="--c:${w.evo ? '#ffd447' : d.color}"><span class="c-ic">${icon(d.icon)}</span><b>${w.evo ? d.evo.name : d.name}</b>${w.evo ? '<em>Evolved</em>' : pips(w.level, weaponMax(w.id), d.color)}</div>`;
    }).concat(g.passives.map((p) => {
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
      <p class="sub">${icon('clock')} ${fmtTime(g.t)} &nbsp; ${icon('skull')} ${fmtInt(g.kills)} &nbsp; LV ${g.level}${g.daily ? ' · Daily: ' + g.mod.name : ''}</p>
      ${buildList(g)}
      <button class="btn primary big" data-act="resume">Resume</button>
      <div class="pill-row">${t('sfx', 'Sound')}${t('music', 'Music')}${t('shake', 'Shake')}</div>
      <button class="btn ghost" data-act="quit">Quit run</button>
    </div>`;
    show('scr-pause');
  }

  // ---------- game over ----------
  function nextGoal() {
    const lockedChar = Object.entries(CHARS).filter(([id, c]) => !save.chars[id] && c.cost != null).sort((a, b) => a[1].cost - b[1].cost)[0];
    if (lockedChar && lockedChar[1].cost > save.gold) return `${lockedChar[1].name} unlocks at ${fmtInt(lockedChar[1].cost)} gold. You have ${fmtInt(save.gold)}.`;
    if (lockedChar) return `You can afford ${lockedChar[1].name}! Visit Pilots.`;
    const cheap = SHOP.filter((it) => shopRank(it.id) < it.max).map((it) => [it, shopCost(it, shopRank(it.id))]).sort((a, b) => a[1] - b[1])[0];
    if (cheap) return cheap[1] <= save.gold ? `You can afford ${cheap[0].name} in Upgrades.` : `Next upgrade: ${cheap[0].name} for ${fmtInt(cheap[1])} gold.`;
    return '';
  }

  function showOver(r) {
    const title = r.won ? 'Victory' : r.quit ? 'Run ended' : 'Destroyed';
    const claim = questsClaimable();
    const rows = [
      ['clock', 'Survived', r.time, 'time'],
      ['skull', 'Enemies destroyed', r.kills, 'int'],
      ['up', 'Level reached', r.level, 'int'],
      ['trophy', 'Score', r.score, 'int'],
    ];
    el('scr-over').innerHTML = `<div class="wrap over ${r.won ? 'won' : ''}">
      <h2 class="title big">${title}</h2>
      ${r.newBest ? '<p class="new-best">New best score</p>' : ''}
      ${r.unlockedPrism ? `<p class="unlock">${shipSvg(CHARS.prism.color)} New pilot unlocked: <b>Prism</b></p>` : ''}
      <div class="stats">${rows.map(([ic, label, v, f], i) => `<div class="stat">${icon(ic)}<span>${label}</span><b data-count="${v}" data-fmt="${f}" data-delay="${i * 150}">0</b></div>`).join('')}</div>
      <div class="gold-earned">${icon('gold')}<b data-count="${r.gold}" data-fmt="int" data-delay="650">0</b><span>gold earned${r.dailyBonus ? ` (incl. ${r.dailyBonus} daily bonus)` : ''}</span></div>
      ${buildList({ weapons: r.weapons, passives: r.passives })}
      ${claim ? `<p class="hint">${icon('trophy')} ${claim} quest${claim > 1 ? 's' : ''} ready to claim</p>` : ''}
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

  function tick() {
    if (!counters.length) return;
    const now = performance.now();
    for (let i = counters.length - 1; i >= 0; i--) {
      const c = counters[i], t = clamp((now - c.start) / c.dur, 0, 1), v = c.to * easeOutCubic(t);
      c.el.textContent = c.fmt === 'time' ? fmtTime(v) : fmtInt(v);
      if (t >= 1) counters.splice(i, 1);
    }
  }

  // ---------- misc ----------
  function toast(msg) {
    const t = el('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
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

  function go(to) {
    if (to === 'menu') { api.exitToMenu(); return; }
    ({ pilots: renderPilots, shop: renderShop, quests: renderQuests, settings: renderSettings })[to]();
    if (api.getGame() && api.getGame().finished) api.exitToMenu(true);
    show('scr-' + to);
    el('scr-' + to).scrollTop = 0;
  }

  function rerender() {
    const id = document.querySelector('.screen:not([hidden])');
    if (!id) return;
    const map = { 'scr-menu': renderMenu, 'scr-pilots': renderPilots, 'scr-shop': renderShop, 'scr-quests': renderQuests };
    if (map[id.id]) {
      const top = id.scrollTop;
      map[id.id]();
      id.scrollTop = top;
    }
  }

  function onAction(btn) {
    const act = btn.dataset.act, g = api.getGame();
    switch (act) {
      case 'go': go(btn.dataset.to); break;
      case 'play': api.startRun({ daily: false }); break;
      case 'continue': api.startRun({ resume: save.run, daily: save.run.daily }); break;
      case 'daily': api.startRun({ daily: true }); break;
      case 'again': api.startRun({ daily: false }); break;
      case 'pick-char':
        save.selChar = btn.dataset.id;
        writeSave();
        rerender();
        break;
      case 'buy-char': {
        const c = CHARS[btn.dataset.id];
        if (save.gold < c.cost) { Sound.play.deny(); toast(`You need ${fmtInt(c.cost - save.gold)} more gold`); return; }
        save.gold -= c.cost;
        save.chars[btn.dataset.id] = true;
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
        if (r >= it.max) return;
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
      case 'claim': {
        const q = QUESTS.find((x) => x.id === btn.dataset.id);
        if (save.claimed[q.id] || questValue(q) < q.goal) return;
        save.claimed[q.id] = true;
        save.gold += q.reward;
        writeSave();
        Sound.play.coin();
        Haptics.tap();
        toast(`+${q.reward} gold`);
        rerender();
        return;
      }
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
        g.choose(c);
        Haptics.tap();
        show(null);
        return;
      }
      case 'reroll': {
        const next = g && g.reroll();
        if (next) showLevelUp(g, next);
        break;
      }
      case 'chest-ok':
        if (g) g.closeChest();
        show(null);
        break;
      case 'export': {
        const code = exportSaveCode();
        const ta = el('save-code');
        ta.value = code;
        const fallback = () => { ta.focus(); ta.select(); toast('Code selected. Copy it from the box.'); };
        try {
          navigator.clipboard.writeText(code).then(() => toast('Save code copied'), fallback);
        } catch (e) { fallback(); }
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
        save = defaultSave();
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
      if (['choose', 'buy', 'buy-char', 'claim', 'chest-ok'].indexOf(btn.dataset.act) < 0) Haptics.tap();
    });
    window.addEventListener('keydown', (e) => {
      const g = api.getGame();
      if ((e.code === 'Escape' || e.code === 'KeyP') && g) {
        if (g.state === 'play' && g.pause()) showPause(g);
        else if (g.state === 'paused') { g.resume(); show(null); }
      }
    });
  }

  return {
    init, show, toast, tick, showPause, showLevelUp, showChest, showOver, applySettings,
    showMenu() { renderMenu(); show('scr-menu'); el('scr-menu').scrollTop = 0; },
    enterGame() { show(null); },
  };
})();
