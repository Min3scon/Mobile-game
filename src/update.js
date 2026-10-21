'use strict';
/* Neon Swarm — keeps every player on the newest version. The published build stamps its id into the
   page (window.NS_BUILD) and into version.json; when they differ, a new version is live. Menus reload
   straight away; a run in progress finishes first. The same request also tells us the server's time. */

const Updater = (() => {
  const EVERY = 120000;
  let busy = () => false, running = () => false, pending = null, timer = 0;
  const build = window.NS_BUILD || null;

  function reload(to) {
    try {
      // Reload once per new build, so a stale cache can never cause a reload loop.
      if (sessionStorage.getItem('ns.reloadedFor') === to) return false;
      sessionStorage.setItem('ns.reloadedFor', to);
    } catch (e) { /* private mode: reload anyway */ }
    const q = new URLSearchParams(location.search);
    q.set('v', to);
    location.replace(location.pathname + '?' + q.toString());
    return true;
  }

  async function check() {
    if (!build) return;
    let res;
    try {
      res = await fetch('version.json?t=' + Date.now(), { cache: 'no-store' });
    } catch (e) { return; } // offline
    const date = Date.parse(res.headers.get('date') || '');
    if (date) { Clock.skew = Math.abs(date - Date.now()) > 120000 ? date - Date.now() : 0; Clock.synced = true; }
    if (!res.ok) return;
    let v;
    try { v = await res.json(); } catch (e) { return; }
    if (!v || !v.build || v.build === build) return;
    pending = v.build;
    if (!busy()) reload(pending);
    else UI.toast('A new version is ready. It installs when this run ends.');
  }

  return {
    // busy: a run or its results are on screen (wait). running: a run is still being played.
    init(o) {
      busy = o.busy;
      running = o.running;
      if (!build) Clock.synced = true; // local development: no published build to compare with
      // Drop the cache-busting ?v= from the address bar once we are on the new build.
      try {
        const q = new URLSearchParams(location.search);
        if (q.has('v')) { q.delete('v'); history.replaceState(null, '', location.pathname + (q.toString() ? '?' + q : '')); }
      } catch (e) { /* ignore */ }
      check();
      clearInterval(timer);
      timer = setInterval(check, EVERY);
    },
    check,
    // The clock could be changed while the app is in the background, so re-learn it on return.
    hidden() { if (build) Clock.synced = false; },
    // Called when the player leaves a run or starts the next one. True if the page is reloading.
    idle() { return !!pending && !running() && reload(pending); },
  };
})();
