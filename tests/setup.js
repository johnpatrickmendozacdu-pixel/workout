// Simple in-memory IndexedDB mock for testing
const sharedData = new Map();

class MockObjectStore {
  constructor(data) {
    this.data = data;
  }

  get(key) {
    const req = {
      result: this.data.get(key),
      onsuccess: null,
      onerror: null,
    };
    // Trigger success callback asynchronously
    setTimeout(() => {
      if (req.onsuccess) req.onsuccess();
    }, 0);
    return req;
  }

  put(obj) {
    this.data.set(obj.key, obj);
    const req = {
      onsuccess: null,
      onerror: null,
    };
    setTimeout(() => {
      if (req.onsuccess) req.onsuccess();
    }, 0);
    return req;
  }

  delete(key) {
    this.data.delete(key);
    const req = {
      onsuccess: null,
      onerror: null,
    };
    setTimeout(() => {
      if (req.onsuccess) req.onsuccess();
    }, 0);
    return req;
  }
}

class MockTransaction {
  constructor(data) {
    this.store = new MockObjectStore(data);
    this.oncomplete = null;
    this.onerror = null;
    this.error = null;
  }

  objectStore() {
    return this.store;
  }
}

class MockDB {
  constructor(data) {
    this.data = data;
    this.objectStoreNames = { contains: () => true };
  }

  transaction(name, mode) {
    const tx = new MockTransaction(this.data);
    // Simulate async transaction completion
    setTimeout(() => {
      if (tx.oncomplete) tx.oncomplete();
    }, 0);
    return tx;
  }
}

class MockOpenRequest {
  constructor() {
    this.result = null;
    this.onsuccess = null;
    this.onupgradeneeded = null;
    this.onerror = null;
  }
}

// Polyfill IndexedDB for node environment
global.window = global.window || {};
const db = new MockDB(sharedData);
global.indexedDB = {
  open(dbName, version) {
    const req = new MockOpenRequest();
    req.result = db;
    setTimeout(() => {
      if (req.onupgradeneeded) req.onupgradeneeded();
      if (req.onsuccess) req.onsuccess();
    }, 0);
    return req;
  },
};
// Also set on window
global.window.indexedDB = global.indexedDB;
