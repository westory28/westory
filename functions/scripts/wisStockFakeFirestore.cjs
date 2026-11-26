'use strict';

// Minimal in-memory Firestore for pure server tests: documents, transactional
// reads-before-writes, merge/update/create semantics and the query shapes the
// stock services use. It is not an emulator and performs no network access.
const isTimestamp = value => value && typeof value === 'object' && typeof value.toMillis === 'function';
const clone = value => {
  if (value === null || typeof value !== 'object' || isTimestamp(value)) return value;
  if (Array.isArray(value)) return value.map(clone);
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clone(item)]));
};
const field = (data, path) => path === '__name__' ? undefined : path.split('.').reduce((value, key) => value?.[key], data);
const setField = (data, path, value) => {
  const keys = path.split('.'), last = keys.pop();
  let target = data;
  for (const key of keys) target = target[key] && typeof target[key] === 'object' ? target[key] : (target[key] = {});
  target[last] = clone(value);
};
const merge = (target, source) => {
  for (const [key, value] of Object.entries(source)) {
    if (value && typeof value === 'object' && !Array.isArray(value) && !isTimestamp(value)
      && target[key] && typeof target[key] === 'object' && !Array.isArray(target[key])) merge(target[key], value);
    else target[key] = clone(value);
  }
  return target;
};

function createFakeFirestore(initial = {}) {
  const documents = new Map(Object.entries(initial).map(([path, value]) => [path, clone(value)]));
  const stats = { reads: 0, writes: 0, transactions: 0 };
  const snapshot = (path, value) => ({ id: path.split('/').at(-1), ref: docRef(path), exists: value !== undefined,
    data: () => clone(value), get: name => clone(field(value, name)) });
  const read = path => { stats.reads++; return snapshot(path, documents.get(path)); };
  function docRef(path) {
    return { path, id: path.split('/').at(-1),
      get: async () => read(path),
      set: async (data, options) => applyWrite({ type: 'set', path, data, options }),
      update: async data => applyWrite({ type: 'update', path, data }) };
  }
  function applyWrite(write) {
    stats.writes++;
    const current = documents.get(write.path);
    if (write.type === 'create') {
      if (current !== undefined) { const error = new Error(`already exists: ${write.path}`); error.code = 6; throw error; }
      documents.set(write.path, clone(write.data));
    } else if (write.type === 'set') {
      documents.set(write.path, write.options?.merge && current ? merge(clone(current), write.data) : clone(write.data));
    } else if (write.type === 'update') {
      if (current === undefined) { const error = new Error(`not found: ${write.path}`); error.code = 5; throw error; }
      const next = clone(current);
      for (const [key, value] of Object.entries(write.data)) setField(next, key, value);
      documents.set(write.path, next);
    } else if (write.type === 'delete') documents.delete(write.path);
  }
  function query(base, group = false) {
    const state = { filters: [], orders: [], limit: Infinity, after: null, fields: null };
    const api = {
      where(name, op, value) { state.filters.push([name, op, value]); return api; },
      orderBy(name, direction = 'asc') { state.orders.push([name, direction]); return api; },
      limit(value) { state.limit = value; return api; },
      select(...fields) { state.fields = fields; return api; },
      startAfter(...values) { state.after = values; return api; },
      get: async () => run(),
      __run: () => run(),
    };
    const matches = (path, data) => {
      const parts = path.split('/');
      if (group ? parts.at(-2) !== base : parts.slice(0, -1).join('/') !== base) return false;
      return state.filters.every(([name, op, value]) => {
        const actual = name === '__name__' ? parts.at(-1) : field(data, name);
        if (op === '==') return actual === value;
        if (op === '>') return actual !== undefined && actual > value;
        if (op === '>=') return actual !== undefined && actual >= value;
        if (op === '<') return actual !== undefined && actual < value;
        if (op === '<=') return actual !== undefined && actual <= value;
        if (op === 'in') return value.includes(actual);
        throw new Error(`unsupported operator ${op}`);
      });
    };
    function run() {
      let rows = [...documents.entries()].filter(([path, data]) => matches(path, data));
      const key = ([path, data], name) => name === '__name__' ? path.split('/').at(-1) : field(data, name);
      rows.sort((a, b) => {
        for (const [name, direction] of [...state.orders, ...(state.orders.some(([name]) => name === '__name__') ? [] : [['__name__', 'asc']])]) {
          const left = key(a, name), right = key(b, name);
          if (left === right) continue;
          return (left < right ? -1 : 1) * (direction === 'desc' ? -1 : 1);
        }
        return 0;
      });
      if (state.after) {
        const names = state.orders.map(([name]) => name);
        rows = rows.filter(row => {
          for (let index = 0; index < state.after.length; index++) {
            const direction = state.orders[index]?.[1] || 'asc', value = key(row, names[index] || '__name__');
            if (value === state.after[index]) continue;
            return direction === 'desc' ? value < state.after[index] : value > state.after[index];
          }
          return false;
        });
      }
      rows = rows.slice(0, state.limit);
      stats.reads += Math.max(1, rows.length);
      const docs = rows.map(([path, data]) => snapshot(path, state.fields
        ? Object.fromEntries(state.fields.map(name => [name, field(data, name)]).filter(([, value]) => value !== undefined)) : data));
      return { docs, size: docs.length, empty: !docs.length };
    }
    return api;
  }
  const db = {
    documents, stats,
    doc: path => docRef(path),
    collection: path => query(path),
    collectionGroup: name => query(name, true),
    runTransaction: async (callback, options = {}) => {
      stats.transactions++;
      const writes = [];
      const guard = () => { if (writes.length) throw new Error('Firestore transactions require all reads to be executed before all writes.'); };
      const tx = {
        get: async target => { guard(); return typeof target.__run === 'function' ? target.__run() : read(target.path); },
        getAll: async (...refs) => { guard(); return refs.map(ref => read(ref.path)); },
        set: (ref, data, opts) => { if (options.readOnly) throw new Error('read-only transaction'); writes.push({ type: 'set', path: ref.path, data: clone(data), options: opts }); return tx; },
        create: (ref, data) => { if (options.readOnly) throw new Error('read-only transaction'); writes.push({ type: 'create', path: ref.path, data: clone(data) }); return tx; },
        update: (ref, data) => { if (options.readOnly) throw new Error('read-only transaction'); writes.push({ type: 'update', path: ref.path, data: clone(data) }); return tx; },
        delete: ref => { writes.push({ type: 'delete', path: ref.path }); return tx; },
      };
      const result = await callback(tx);
      for (const write of writes) if (write.type === 'create' && documents.has(write.path)) {
        const error = new Error(`already exists: ${write.path}`); error.code = 6; throw error;
      }
      for (const write of writes) applyWrite(write);
      return result;
    },
  };
  return db;
}

module.exports = { createFakeFirestore };
