/* Double de test de firebase-compat : Firestore en mémoire, avec écoute
   temps réel. Permet de vérifier la synchro d'équipe sans réseau, et surtout
   de simuler un COLLÈGUE qui écrit pendant que ce poste travaille.

   Injecté avant les scripts de l'app (page.addInitScript), il fournit le
   même sous-ensemble d'API que le SDK compat utilisé par CryoMap. */
(() => {
  const store = new Map();          // "cryomap/salle/reagents/x1" -> { d, by, at }
  const listeners = [];             // { path, cb, seen: Map }
  const stats = { writes: 0, deletes: 0, batches: 0, reads: 0 };
  const DELETE = { __delete: true };

  const parentOf = p => p.slice(0, p.lastIndexOf('/'));
  const childrenOf = colPath => {
    const out = [];
    for (const [p, v] of store) {
      if (p.startsWith(colPath + '/') && p.slice(colPath.length + 1).indexOf('/') === -1) out.push([p, v]);
    }
    return out.sort((a, b) => a[0] < b[0] ? -1 : 1);
  };
  const snapDoc = (path, data) => ({
    id: path.slice(path.lastIndexOf('/') + 1),
    exists: data != null,
    data: () => (data == null ? undefined : JSON.parse(JSON.stringify(data)))
  });
  const emit = colPath => {
    listeners.filter(l => l.path === colPath).forEach(l => {
      const now = new Map(childrenOf(colPath));
      const changes = [];
      for (const [p, v] of now) {
        const prev = l.seen.get(p);
        if (prev === undefined) changes.push({ type: 'added', doc: snapDoc(p, v) });
        else if (JSON.stringify(prev) !== JSON.stringify(v)) changes.push({ type: 'modified', doc: snapDoc(p, v) });
      }
      for (const [p, v] of l.seen) if (!now.has(p)) changes.push({ type: 'removed', doc: snapDoc(p, v) });
      l.seen = new Map([...now].map(([p, v]) => [p, JSON.parse(JSON.stringify(v))]));
      if (!changes.length) return;
      l.cb({
        docChanges: () => changes,
        forEach: fn => now.forEach((v, p) => fn(snapDoc(p, v))),
        size: now.size
      });
    });
  };
  const applyWrite = (path, data, merge) => {
    const cur = store.get(path);
    let next;
    if (merge && cur) {
      next = Object.assign({}, cur);
      for (const k in data) { if (data[k] === DELETE) delete next[k]; else next[k] = data[k]; }
    } else {
      next = {};
      for (const k in data) { if (data[k] !== DELETE) next[k] = data[k]; }
    }
    store.set(path, next);
    stats.writes++;
  };

  function docRef(path) {
    return {
      path,
      id: path.slice(path.lastIndexOf('/') + 1),
      collection: name => colRef(path + '/' + name),
      get: async () => { stats.reads++; return snapDoc(path, store.get(path)); },
      set: async (data, opts) => { applyWrite(path, data, !!(opts && opts.merge)); emit(parentOf(path)); },
      delete: async () => { store.delete(path); stats.deletes++; emit(parentOf(path)); }
    };
  }
  function colRef(path) {
    return {
      path,
      doc: id => docRef(path + '/' + id),
      get: async () => {
        stats.reads++;
        const kids = childrenOf(path);
        return { forEach: fn => kids.forEach(([p, v]) => fn(snapDoc(p, v))), size: kids.length,
                 docs: kids.map(([p, v]) => snapDoc(p, v)) };
      },
      onSnapshot: (cb, errCb) => {
        const l = { path, cb, seen: new Map() };
        listeners.push(l);
        setTimeout(() => {                       // premier événement, comme Firestore
          const now = new Map(childrenOf(path));
          l.seen = new Map([...now].map(([p, v]) => [p, JSON.parse(JSON.stringify(v))]));
          cb({ docChanges: () => [...now].map(([p, v]) => ({ type: 'added', doc: snapDoc(p, v) })),
               forEach: fn => now.forEach((v, p) => fn(snapDoc(p, v))), size: now.size });
        }, 0);
        return () => { const i = listeners.indexOf(l); if (i >= 0) listeners.splice(i, 1); };
      }
    };
  }

  const db = {
    collection: name => colRef(name),
    batch: () => {
      const ops = [];
      return {
        set: (ref, data, opts) => ops.push({ ref, data, opts }),
        delete: ref => ops.push({ ref, del: true }),
        commit: async () => {
          stats.batches++;
          if (ops.length > 500) throw new Error('batch trop gros: ' + ops.length);
          const touched = new Set();
          ops.forEach(o => {
            if (o.del) { store.delete(o.ref.path); stats.deletes++; }
            else applyWrite(o.ref.path, o.data, !!(o.opts && o.opts.merge));
            touched.add(parentOf(o.ref.path));
          });
          touched.forEach(emit);
        }
      };
    }
  };

  const firestore = () => db;
  firestore.FieldValue = { delete: () => DELETE, serverTimestamp: () => Date.now() };

  window.firebase = {
    apps: [],
    initializeApp(cfg) { this.apps.push({ cfg }); return { cfg }; },
    firestore,
    auth: () => ({
      onAuthStateChanged: cb => setTimeout(() => cb({ uid: 'test-uid' }), 0),
      signInAnonymously: async () => ({ user: { uid: 'test-uid' } })
    })
  };

  /* --- outils pour les tests --- */
  window.__fs = {
    stats,
    reset: () => { store.clear(); listeners.length = 0; stats.writes = stats.deletes = stats.batches = stats.reads = 0; },
    dump: () => [...store.entries()].map(([p, v]) => [p, v]),
    paths: () => [...store.keys()],
    count: prefix => [...store.keys()].filter(p => p.startsWith(prefix)).length,
    biggestDocBytes: () => Math.max(0, ...[...store.values()].map(v => new Blob([JSON.stringify(v)]).size),
    ),
    get: p => store.get(p),
    /* Un COLLÈGUE écrit : on pose le document et on notifie, comme le ferait
       Firestore quand un autre poste enregistre. */
    remoteSet: (p, data) => { applyWrite(p, data, false); emit(parentOf(p)); },
    remoteDelete: p => { store.delete(p); emit(parentOf(p)); },
    seedLegacy: (room, stateObj) => {
      store.set('cryomap/' + room, { state: JSON.stringify(stateObj), _rev: 1, _client: 'ancien' });
    }
  };
})();
