// Sincronização entre aparelhos.
// Cada medição carrega `updated` (ISO). Exclusões viram marcas {id, updated, deleted: true}.
// Na fusão, vence a versão mais recente de cada id; empate favorece a exclusão.
// Provedores: GitHub Gist (token pessoal) e Firebase (login Google, se firebase-config.js estiver preenchido).
(function (root) {
  'use strict';
  const FILE = 'mapeador-dados.json';
  const FB_BASE = 'https://www.gstatic.com/firebasejs/10.14.1/';
  const TOMBSTONE_DAYS = 180;

  // ---------- Fusão ----------
  function merge(local, remote) {
    const recs = new Map();
    const put = (r, src) => {
      const cur = recs.get(r.id);
      const ru = r.updated || '', cu = cur ? (cur.rec.updated || '') : null;
      if (!cur || ru > cu || (ru === cu && r.deleted && !cur.rec.deleted)) recs.set(r.id, { rec: r, src });
    };
    local.items.forEach(r => put(r, 'l'));
    local.deleted.forEach(r => put(Object.assign({ deleted: true }, r), 'l'));
    const remoteById = new Map();
    remote.forEach(r => { remoteById.set(r.id, r); put(r, 'r'); });

    const cutoff = new Date(Date.now() - TOMBSTONE_DAYS * 864e5).toISOString();
    const items = [], deleted = [], toRemote = [];
    let localChanged = false;
    const localById = new Map(local.items.map(r => [r.id, r]));
    const localDel = new Map(local.deleted.map(r => [r.id, r]));
    recs.forEach(({ rec }) => {
      if (rec.deleted) {
        if (rec.updated < cutoff) return;
        deleted.push({ id: rec.id, updated: rec.updated });
        if (localById.has(rec.id) || !localDel.has(rec.id)) localChanged = true;
      } else {
        items.push(rec);
        const l = localById.get(rec.id);
        if (!l || (l.updated || '') !== (rec.updated || '')) localChanged = true;
      }
      const r = remoteById.get(rec.id);
      if (!r || (r.updated || '') !== (rec.updated || '') || !!r.deleted !== !!rec.deleted) {
        toRemote.push(rec.deleted ? { id: rec.id, updated: rec.updated, deleted: true } : rec);
      }
    });
    const all = items.concat(deleted.map(d => Object.assign({ deleted: true }, d)));
    return { items, deleted, all, toRemote, localChanged };
  }

  // ---------- Provedor: GitHub Gist ----------
  function gistProvider(cfg) {
    async function api(path, opts = {}) {
      const r = await fetch('https://api.github.com' + path, Object.assign({}, opts, {
        cache: 'no-store',
        headers: Object.assign({ Authorization: 'Bearer ' + cfg.token, Accept: 'application/vnd.github+json' },
          opts.body ? { 'Content-Type': 'application/json' } : {})
      }));
      if (r.status === 401) throw new Error('Token do GitHub inválido ou expirado');
      if (r.status === 404) throw new Error('Gist não encontrado (o token precisa da permissão "gist")');
      if (!r.ok) throw new Error('GitHub respondeu ' + r.status);
      return r;
    }
    const content = all => JSON.stringify({ app: 'mapeador', version: 1, records: all });
    return {
      kind: 'gist',
      async connect() {
        const u = await api('/user');
        const scopes = u.headers.get('x-oauth-scopes');
        if (scopes !== null && !/\bgist\b/.test(scopes)) throw new Error('O token não tem a permissão "gist"');
        const user = await u.json();
        if (!cfg.gistId) {
          const list = await (await api('/gists?per_page=100')).json();
          const found = list.find(g => g.files && g.files[FILE]);
          if (found) cfg.gistId = found.id;
          else {
            const g = await (await api('/gists', { method: 'POST', body: JSON.stringify({
              description: 'Mapeador de Áreas — dados sincronizados (não apagar)', public: false,
              files: { [FILE]: { content: content([]) } }
            }) })).json();
            cfg.gistId = g.id;
          }
        }
        cfg.account = user.login;
        return cfg;
      },
      async load() {
        const g = await (await api('/gists/' + cfg.gistId)).json();
        const f = g.files[FILE];
        if (!f) return [];
        const text = f.truncated ? await (await fetch(f.raw_url, { cache: 'no-store' })).text() : f.content;
        const data = JSON.parse(text || '{}');
        return Array.isArray(data.records) ? data.records : [];
      },
      async save(all) {
        await api('/gists/' + cfg.gistId, { method: 'PATCH', body: JSON.stringify({ files: { [FILE]: { content: content(all) } } }) });
      },
      async disconnect() {}
    };
  }

  // ---------- Provedor: Firebase (login Google) ----------
  let fb = null; // módulos carregados
  async function loadFirebase() {
    if (fb) return fb;
    const [appM, authM, fsM] = await Promise.all([
      import(FB_BASE + 'firebase-app.js'), import(FB_BASE + 'firebase-auth.js'), import(FB_BASE + 'firebase-firestore.js')]);
    const app = appM.initializeApp(root.FIREBASE_CONFIG);
    const auth = authM.getAuth(app);
    let db;
    try { db = fsM.initializeFirestore(app, { localCache: fsM.memoryLocalCache() }); }
    catch (e) { db = fsM.getFirestore(app); }
    fb = { authM, fsM, auth, db };
    try { await authM.getRedirectResult(auth); } catch (e) { /* sem redirecionamento pendente */ }
    await new Promise(res => { const off = authM.onAuthStateChanged(auth, () => { off(); res(); }); });
    return fb;
  }
  function firebaseProvider(cfg) {
    const col = () => fb.fsM.collection(fb.db, 'users', fb.auth.currentUser.uid, 'items');
    return {
      kind: 'firebase',
      async connect(interactive) {
        await loadFirebase();
        if (!fb.auth.currentUser) {
          if (!interactive) throw new Error('Sessão Google encerrada. Entre novamente.');
          const prov = new fb.authM.GoogleAuthProvider();
          try { await fb.authM.signInWithPopup(fb.auth, prov); }
          catch (e) {
            if (/popup-blocked|operation-not-supported|popup-closed-by-browser/.test(e.code || '')) {
              await fb.authM.signInWithRedirect(fb.auth, prov);
              return new Promise(() => {}); // a página será recarregada
            }
            throw e;
          }
        }
        cfg.account = fb.auth.currentUser.email || fb.auth.currentUser.displayName || 'Google';
        return cfg;
      },
      async load() {
        const snap = await fb.fsM.getDocs(col());
        const out = [];
        snap.forEach(d => { try { out.push(JSON.parse(d.data().json)); } catch (e) { /* ignora doc inválido */ } });
        return out;
      },
      async save(all, changed) {
        for (let i = 0; i < changed.length; i += 400) {
          const b = fb.fsM.writeBatch(fb.db);
          changed.slice(i, i + 400).forEach(r =>
            b.set(fb.fsM.doc(col(), r.id), { json: JSON.stringify(r), updated: r.updated || '' }));
          await b.commit();
        }
      },
      async disconnect() { if (fb) await fb.authM.signOut(fb.auth); }
    };
  }

  // ---------- Motor ----------
  let opts, provider = null, busy = false, again = false, timer = null;
  const status = { connected: false, kind: null, account: null, last: null, error: null, busy: false };
  const emit = () => opts.onStatus(Object.assign({}, status));

  function makeProvider(cfg) {
    return cfg.provider === 'gist' ? gistProvider(cfg) : cfg.provider === 'firebase' ? firebaseProvider(cfg) : null;
  }

  async function run() {
    if (!provider) return;
    if (busy) { again = true; return; }
    if (!navigator.onLine) { status.error = 'Sem internet — sincroniza quando voltar'; emit(); return; }
    busy = status.busy = true; emit();
    try {
      const remote = await provider.load();
      const m = merge(opts.getLocal(), remote);
      if (m.localChanged) opts.applyLocal(m.items, m.deleted);
      if (m.toRemote.length) await provider.save(m.all, m.toRemote);
      status.last = new Date().toISOString();
      status.error = null;
      const cfg = opts.getCfg(); cfg.last = status.last; opts.setCfg(cfg);
    } catch (e) {
      status.error = e.message || String(e);
    } finally {
      busy = status.busy = false; emit();
      if (again) { again = false; run(); }
    }
  }

  const Sync = {
    firebaseAvailable: () => !!root.FIREBASE_CONFIG,
    status: () => Object.assign({}, status),
    init(o) {
      opts = o;
      const cfg = opts.getCfg();
      if (cfg && cfg.provider) {
        provider = makeProvider(cfg);
        Object.assign(status, { connected: true, kind: cfg.provider, account: cfg.account || null, last: cfg.last || null });
        emit();
        provider.connect(false).then(c => { opts.setCfg(c); status.account = c.account; run(); })
          .catch(e => { status.error = e.message; emit(); });
      }
      window.addEventListener('online', () => Sync.schedule(500));
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') Sync.schedule(500); });
      setInterval(() => { if (document.visibilityState === 'visible') run(); }, 5 * 60 * 1000);
    },
    async connect(kind, token) {
      const cfg = { provider: kind, token: token || undefined };
      const p = makeProvider(cfg);
      const c = await p.connect(true);
      provider = p;
      opts.setCfg(c);
      Object.assign(status, { connected: true, kind, account: c.account, error: null });
      await run();
      return status;
    },
    async disconnect() {
      if (provider) await provider.disconnect().catch(() => {});
      provider = null;
      opts.setCfg({});
      Object.assign(status, { connected: false, kind: null, account: null, last: null, error: null });
      emit();
    },
    now: run,
    schedule(ms = 1500) { if (!provider) return; clearTimeout(timer); timer = setTimeout(run, ms); },
    _merge: merge
  };
  root.Sync = Sync;
  if (typeof module !== 'undefined' && module.exports) module.exports = { merge };
})(typeof window !== 'undefined' ? window : globalThis);
