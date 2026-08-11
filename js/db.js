/**
 * IndexedDB 数据层 - 替代SQLite，数据永久保存在浏览器本地
 */
const DB = (() => {
  const DB_NAME = 'CreatorWorkbench';
  const DB_VERSION = 1;
  let db = null;

  function open() {
    return new Promise((resolve, reject) => {
      if (db) return resolve(db);
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (e) => {
        const d = e.target.result;
        // 数据看板
        if (!d.objectStoreNames.contains('metrics')) {
          const s = d.createObjectStore('metrics', { keyPath: 'id', autoIncrement: true });
          s.createIndex('platform_date', ['platform', 'date'], { unique: true });
          s.createIndex('date', 'date');
        }
        // 热点趋势
        if (!d.objectStoreNames.contains('trends')) {
          const s = d.createObjectStore('trends', { keyPath: 'id', autoIncrement: true });
          s.createIndex('platform_type', ['platform', 'type']);
          s.createIndex('crawled_at', 'crawled_at');
        }
        // 选题
        if (!d.objectStoreNames.contains('topics')) {
          d.createObjectStore('topics', { keyPath: 'id', autoIncrement: true });
        }
        // 日记
        if (!d.objectStoreNames.contains('diary')) {
          const s = d.createObjectStore('diary', { keyPath: 'id', autoIncrement: true });
          s.createIndex('date', 'date', { unique: true });
        }
        // 分类
        if (!d.objectStoreNames.contains('categories')) {
          d.createObjectStore('categories', { keyPath: 'id', autoIncrement: true });
        }
        // 灵感库
        if (!d.objectStoreNames.contains('inspirations')) {
          const s = d.createObjectStore('inspirations', { keyPath: 'id', autoIncrement: true });
          s.createIndex('cat1_id', 'cat1_id');
          s.createIndex('content_type', 'content_type');
          s.createIndex('is_favorite', 'is_favorite');
          s.createIndex('created_at', 'created_at');
        }
        // 设置
        if (!d.objectStoreNames.contains('settings')) {
          d.createObjectStore('settings', { keyPath: 'key' });
        }
        // 语音日志
        if (!d.objectStoreNames.contains('voice_log')) {
          d.createObjectStore('voice_log', { keyPath: 'id', autoIncrement: true });
        }
      };
      req.onsuccess = () => { db = req.result; resolve(db); };
      req.onerror = () => reject(req.error);
    });
  }

  function tx(storeName, mode = 'readonly') {
    return db.transaction(storeName, mode).objectStore(storeName);
  }

  function reqToPromise(req) {
    return new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function add(store, data) {
    await open();
    return reqToPromise(tx(store, 'readwrite').add({ ...data, created_at: new Date().toISOString() }));
  }

  async function put(store, data) {
    await open();
    return reqToPromise(tx(store, 'readwrite').put({ ...data, updated_at: new Date().toISOString() }));
  }

  async function get(store, key) {
    await open();
    return reqToPromise(tx(store).get(key));
  }

  async function del(store, key) {
    await open();
    return reqToPromise(tx(store, 'readwrite').delete(key));
  }

  async function getAll(store, indexName = null, range = null) {
    await open();
    return new Promise((resolve, reject) => {
      const store_tx = tx(store);
      const source = indexName ? store_tx.index(indexName) : store_tx;
      const req = source.getAll(range);
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }

  async function getByIndex(store, indexName, key) {
    await open();
    return new Promise((resolve, reject) => {
      const req = tx(store).index(indexName).getAll(key);
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }

  async function clear(store) {
    await open();
    return reqToPromise(tx(store, 'readwrite').clear());
  }

  // 设置相关
  async function getSetting(key, defaultValue = null) {
    const r = await get('settings', key);
    return r ? r.value : defaultValue;
  }

  async function setSetting(key, value) {
    await put('settings', { key, value });
  }

  async function getAllSettings() {
    const all = await getAll('settings');
    const obj = {};
    all.forEach(s => { obj[s.key] = s.value; });
    return obj;
  }

  // 导出全部数据
  async function exportAll() {
    await open();
    const stores = ['metrics', 'trends', 'topics', 'diary', 'categories', 'inspirations', 'settings', 'voice_log'];
    const data = { _exported_at: new Date().toISOString(), _version: DB_VERSION };
    for (const store of stores) {
      data[store] = await getAll(store);
    }
    return data;
  }

  // 导入数据
  async function importAll(data) {
    await open();
    const stores = ['metrics', 'trends', 'topics', 'diary', 'categories', 'inspirations', 'settings', 'voice_log'];
    // 先清空
    for (const store of stores) {
      await clear(store);
    }
    // 再导入
    const transaction = db.transaction(stores, 'readwrite');
    for (const store of stores) {
      const s = transaction.objectStore(store);
      (data[store] || []).forEach(item => { s.put(item); });
    }
    return new Promise((resolve, reject) => {
      transaction.oncomplete = () => resolve(true);
      transaction.onerror = () => reject(transaction.error);
    });
  }

  // 初始化默认数据
  async function initDefaults() {
    await open();
    const cats = await getAll('categories');
    if (cats.length === 0) {
      // 默认分类
      const defaults = [
        { name: '视频类', parent_id: 0, sort_order: 0 },
        { name: '图文类', parent_id: 0, sort_order: 1 },
        { name: '成长感悟', parent_id: 0, sort_order: 2 },
      ];
      const ids = [];
      for (const cat of defaults) {
        const id = await add('categories', cat);
        ids.push({ id, name: cat.name });
      }
      // 二级分类
      const subDefaults = [
        { name: '口播', parent_id: ids[0].id, sort_order: 0 },
        { name: '攻略教程', parent_id: ids[0].id, sort_order: 1 },
        { name: 'Vlog', parent_id: ids[0].id, sort_order: 2 },
        { name: '评测', parent_id: ids[0].id, sort_order: 3 },
        { name: '风景', parent_id: ids[0].id, sort_order: 4 },
        { name: '干货笔记', parent_id: ids[1].id, sort_order: 0 },
        { name: 'AI工具', parent_id: ids[1].id, sort_order: 1 },
      ];
      for (const cat of subDefaults) {
        await add('categories', cat);
      }
    }
  }

  return { open, add, put, get, del, getAll, getByIndex, clear, getSetting, setSetting, getAllSettings, exportAll, importAll, initDefaults };
})();
