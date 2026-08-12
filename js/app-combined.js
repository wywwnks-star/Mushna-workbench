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
/**
 * 工具函数库
 */
const Utils = (() => {
  function $(sel, root = document) { return root.querySelector(sel); }
  function $$(sel, root = document) { return Array.from(root.querySelectorAll(sel)); }

  // DOM元素创建
  function el(tag, props = {}, children = null) {
    const node = document.createElement(tag);
    for (const k in props) {
      if (k === 'class') node.className = props[k];
      else if (k === 'html') node.innerHTML = props[k];
      else if (k === 'text') node.textContent = props[k];
      else if (k === 'style' && typeof props[k] === 'object') Object.assign(node.style, props[k]);
      else if (k.startsWith('on') && typeof props[k] === 'function') node.addEventListener(k.slice(2).toLowerCase(), props[k]);
      else if (k === 'checked' || k === 'disabled' || k === 'selected') { if (props[k]) node.setAttribute(k, ''); }
      else node.setAttribute(k, props[k]);
    }
    if (children != null) {
      (Array.isArray(children) ? children : [children]).forEach(c => {
        if (c == null) return;
        if (typeof c === 'string' || typeof c === 'number') node.appendChild(document.createTextNode(c));
        else node.appendChild(c);
      });
    }
    return node;
  }

  function today() { return new Date().toISOString().slice(0, 10); }
  function formatDate(d) {
    if (!d) return '';
    const date = new Date(d);
    const now = new Date();
    const diff = (now - date) / 1000;
    if (diff < 60) return '刚刚';
    if (diff < 3600) return Math.floor(diff / 60) + '分钟前';
    if (diff < 86400) return Math.floor(diff / 3600) + '小时前';
    if (diff < 604800) return Math.floor(diff / 86400) + '天前';
    return date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
  }

  function formatNum(n) {
    if (n == null) return '0';
    n = Number(n) || 0;
    if (n >= 100000000) return (n / 100000000).toFixed(1).replace(/\.0$/, '') + '亿';
    if (n >= 10000) return (n / 10000).toFixed(1).replace(/\.0$/, '') + 'w';
    if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
    return n.toString();
  }

  // 热点平台优先级：小红书 > 抖音 > B站 > 微博 > 知乎 > 百度
  const PLATFORMS = [
    { id: 'xhs', name: '小红书', color: '#ff2442' },
    { id: 'douyin', name: '抖音', color: '#000000' },
    { id: 'bilibili', name: 'B站', color: '#00a1d6' },
    { id: 'weibo', name: '微博', color: '#e6162d' },
    { id: 'zhihu', name: '知乎', color: '#0066ff' },
    { id: 'baidu', name: '百度', color: '#2932e1' },
  ];

  // 热点平台Tab顺序（同上优先级）
  const HOT_TABS = ['xhs', 'douyin', 'bilibili', 'weibo', 'zhihu', 'baidu'];

  function platformName(p) { const pl = PLATFORMS.find(x => x.id === p); return pl ? pl.name : p; }
  function platformColor(p) { const pl = PLATFORMS.find(x => x.id === p); return pl ? pl.color : '#6b7280'; }

  function moodEmoji(m) { return ['😢', '😕', '😐', '🙂', '😄'][Math.min(Math.max(m - 1, 0), 4)] || '😐'; }

  // Toast提示
  let toastTimer;
  function toast(msg, duration = 2500) {
    let t = document.querySelector('.toast');
    if (!t) {
      t = el('div', { class: 'toast' });
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), duration);
  }

  // 模态框
  function openModal(content) {
    let modal = document.querySelector('.modal');
    if (!modal) {
      modal = el('div', { class: 'modal', onclick: (e) => { if (e.target === modal) closeModal(); } });
      document.body.appendChild(modal);
    }
    const card = el('div', { class: 'modal-card' });
    if (typeof content === 'string') card.innerHTML = content;
    else card.appendChild(content);
    modal.innerHTML = '';
    modal.appendChild(card);
    modal.classList.add('show');
    return modal;
  }

  function closeModal() {
    const modal = document.querySelector('.modal');
    if (modal) modal.classList.remove('show');
  }

  // 下载文件
  function downloadFile(filename, content, type = 'text/plain') {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 100);
  }

  // 防抖
  function debounce(fn, ms = 300) {
    let t;
    return function (...args) {
      clearTimeout(t);
      t = setTimeout(() => fn.apply(this, args), ms);
    };
  }

  // 简易HTML转文本
  function htmlToText(html) {
    const tmp = document.createElement('div');
    tmp.innerHTML = html;
    return tmp.textContent || tmp.innerText || '';
  }

  // 提取文本摘要
  function summarize(text, maxLen = 200) {
    if (!text) return '';
    const clean = text.replace(/\s+/g, ' ').trim();
    return clean.length > maxLen ? clean.slice(0, maxLen) + '...' : clean;
  }

  // 解析URL的域名
  function getDomain(url) {
    try { return new URL(url).hostname; } catch { return ''; }
  }

  return { $, $$, el, today, formatDate, formatNum, PLATFORMS, HOT_TABS, platformName, platformColor, moodEmoji, toast, openModal, closeModal, downloadFile, debounce, htmlToText, summarize, getDomain };
})();
/**
 * 外部API服务 - URL抓取、AI调用、热点获取
 * 全部通过浏览器直接调用，无需后端
 */
const API = (() => {
  const { el, toast, htmlToText, summarize } = Utils;

  // CORS代理列表（按优先级尝试）
  const CORS_PROXIES = [
    (url) => `https://corsproxy.io/?${encodeURIComponent(url)}`,
    (url) => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
    (url) => `https://cors.eu.org/${url}`,
    (url) => url, // 直连最后尝试
  ];

  // 平台搜索链接（按热度排序查看相关内容）
  function getSearchUrl(platform, title) {
    const q = encodeURIComponent(title.replace(/[#【】]/g, '').trim());
    const urls = {
      xhs: `https://www.xiaohongshu.com/search_result?keyword=${q}&source=web_search_result_notes`,
      douyin: `https://www.douyin.com/search/${q}?type=video`,
      bilibili: `https://search.bilibili.com/all?keyword=${q}&order=click`,
      weibo: `https://s.weibo.com/weibo?q=${q}&xsort=hot`,
      zhihu: `https://www.zhihu.com/search?type=content&q=${q}`,
      baidu: `https://www.baidu.com/s?wd=${q}`,
    };
    return urls[platform] || '';
  }

  /**
   * 通过CORS代理获取URL内容
   */
  async function fetchUrl(url, timeout = 10000) {
    let lastErr;
    for (const proxyFn of CORS_PROXIES) {
      try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), timeout);
        const res = await fetch(proxyFn(url), { signal: ctrl.signal, headers: { 'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' } });
        clearTimeout(timer);
        if (res.ok) {
          const text = await res.text();
          if (text && text.length > 100) return text;
        }
      } catch (e) {
        lastErr = e;
        continue;
      }
    }
    throw new Error('无法获取页面内容（平台反爬限制），请使用手动粘贴模式');
  }

  /**
   * 解析URL，提取标题、作者、正文
   */
  async function parseUrl(url) {
    const html = await fetchUrl(url);
    const doc = new DOMParser().parseFromString(html, 'text/html');

    let title = '';
    const ogTitle = doc.querySelector('meta[property="og:title"]');
    if (ogTitle) title = ogTitle.getAttribute('content');
    if (!title) {
      const titleEl = doc.querySelector('title');
      if (titleEl) title = titleEl.textContent.trim();
    }
    title = (title || '').replace(/\s*[-–|_]\s*[^-–|_]*$/, '').trim();

    let author = '';
    const metaAuthor = doc.querySelector('meta[name="author"], meta[property="article:author"]');
    if (metaAuthor) author = metaAuthor.getAttribute('content') || '';

    let content = '';
    const article = doc.querySelector('article, .article-content, .post-content, .content, #content, .entry-content, .post-body');
    if (article) {
      content = article.innerText || article.textContent;
    } else {
      const paras = doc.querySelectorAll('p');
      content = Array.from(paras).map(p => p.textContent.trim()).filter(t => t.length > 20).join('\n\n');
    }
    content = content.trim().slice(0, 5000);

    let description = '';
    const ogDesc = doc.querySelector('meta[property="og:description"], meta[name="description"]');
    if (ogDesc) description = ogDesc.getAttribute('content') || '';

    return { title, author, content, description, url };
  }

  /**
   * 调用AI进行内容归纳
   */
  async function aiSummarize(text, title = '', apiKey) {
    if (!apiKey) {
      return {
        summary: summarize(text, 300),
        tags: extractTags(text, title),
        content_type: guessContentType(title, text),
        transcript: isTalkingVideo(text) ? text.slice(0, 2000) : '',
        structured_content: isTutorial(text) ? extractStructure(text) : '',
      };
    }

    const prompt = `你是一个自媒体内容助手。请分析以下${title ? '《' + title + '》' : ''}内容，返回JSON格式（不要使用markdown代码块）：
{
  "summary": "100字以内的精炼摘要",
  "tags": ["3-5个关键词标签"],
  "content_type": "口播视频/攻略教程/图文文章/Vlog/评测"中最匹配的一个,
  "transcript": "如果是口播类内容，整理成通顺的逐字稿；否则留空字符串",
  "structured_content": "如果是攻略/教程类，提取要点，用'- '列表格式结构化罗列；否则留空字符串"
}

内容：
${text.slice(0, 3000)}`;

    try {
      const res = await fetch('https://api.deepseek.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: 'deepseek-chat',
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.3,
          max_tokens: 1000,
        }),
      });
      const data = await res.json();
      if (data.choices && data.choices[0]) {
        let content = data.choices[0].message.content.trim();
        content = content.replace(/^```json\s*/, '').replace(/^```\s*/, '').replace(/```$/, '');
        try {
          return JSON.parse(content);
        } catch {
          return { summary: content.slice(0, 300), tags: extractTags(text, title), content_type: guessContentType(title, text), transcript: '', structured_content: '' };
        }
      }
      throw new Error('AI返回格式异常');
    } catch (e) {
      console.warn('AI调用失败，使用本地摘要:', e);
      return {
        summary: summarize(text, 300),
        tags: extractTags(text, title),
        content_type: guessContentType(title, text),
        transcript: '',
        structured_content: '',
      };
    }
  }

  function extractTags(text, title) {
    const combined = (title + ' ' + text).toLowerCase();
    const keywords = ['旅行', '攻略', '美食', '摄影', 'vlog', '干货', '教程', '分享', '经验', '避坑', '推荐', 'ai', '成长', '副业', '自媒体', '效率', '工具', '感悟', '人生', '职场'];
    const found = keywords.filter(k => combined.includes(k.toLowerCase()));
    return found.length > 0 ? found.slice(0, 5) : ['灵感'];
  }

  function guessContentType(title, text) {
    const combined = (title + ' ' + text).toLowerCase();
    if (/攻略|教程|步骤|方法|怎么|如何|技巧/.test(combined)) return '攻略教程';
    if (/口播|说|讲|聊|谈|观点/.test(combined) && text.length < 2000) return '口播视频';
    if (/评测|测评|开箱|体验/.test(combined)) return '评测';
    if (/vlog|日常|记录|旅行|一天/.test(combined)) return 'Vlog';
    return '图文文章';
  }

  function isTalkingVideo(text) {
    return /大家好|我是|今天|跟大家|分享|说一下|讲讲/.test(text.slice(0, 200));
  }

  function isTutorial(text) {
    return /攻略|教程|步骤|方法|技巧|怎么|如何|第[一二三四五六七八九十]|^\d+[\.\、]/.test(text);
  }

  function extractStructure(text) {
    const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 5);
    const points = lines.filter(l => /^\d+[\.\、]|^[-•]|第[一二三四五六七八九十]/.test(l)).slice(0, 10);
    if (points.length >= 3) return points.map(p => '- ' + p.replace(/^\d+[\.\、]\s*/, '').replace(/^[-•]\s*/, '')).join('\n');
    return lines.slice(0, 8).map(l => '- ' + l.slice(0, 50)).join('\n');
  }

  /**
   * 内置示例热点数据
   */
  const FALLBACK_HOT_DATA = {
    xhs: [
      { title: '2026年最值得入手的10个AI效率工具', hot_score: '98.5w', desc: '盘点今年爆火的AI工具，从写作、设计到编程全覆盖，打工人必备神器，效率直接翻倍，建议收藏！' },
      { title: '普通人做自媒体3个月变现2w的真实经验', hot_score: '87.2w', desc: '从零开始做自媒体，不画饼不鸡汤，分享3个月从0到变现2w的真实路径，包括选赛道、内容方向、变现方式全拆解。' },
      { title: '夏天通勤穿搭｜舒服又好看的5套搭配', hot_score: '76.8w', desc: '打工人夏日通勤穿搭灵感，兼顾舒适与好看，从T恤衬衫到连衣裙，每套都不踩雷，照着穿就对了。' },
      { title: '30岁才明白的10个人生道理，越早知道越好', hot_score: '65.3w', desc: '走过弯路才总结出的人生感悟，关于工作、感情、金钱、人际关系，每一条都很扎心但真实，希望能帮到你。' },
      { title: '在家就能做的7个低成本副业，亲测有效', hot_score: '58.9w', desc: '不需要本金不需要人脉，利用下班后的时间就能做的副业，从几十到几千都有，选一个适合自己的开始吧。' },
      { title: '坚持早起100天后，我的生活发生了这些变化', hot_score: '52.1w', desc: '从熬夜冠军到早起达人，100天早起带来的改变不只是精神变好，还有效率提升、心态转变、生活掌控感。' },
      { title: '小红书涨粉秘籍｜从0到1w粉我做对了什么', hot_score: '47.6w', desc: '纯干货分享！从0开始做小红书，3个月涨粉1w的实操方法，包括选题技巧、封面标题、发布时间、避坑指南。' },
      { title: '一个人住也要好好吃饭｜10分钟快手菜合集', hot_score: '43.2w', desc: '独居快手菜食谱，食材简单步骤少，10分钟搞定一顿饭，好吃不贵还健康，再也不用天天吃外卖了。' },
      { title: '辞职做自由职业半年，说说真实的收入和感受', hot_score: '39.8w', desc: '裸辞做自由职业半年，收入比上班高但也踩了很多坑，分享真实的收入情况、工作状态、给想辞职的人的建议。' },
      { title: '女生一定要有的10件提升幸福感的小物件', hot_score: '35.4w', desc: '不贵但能大大提升生活幸福感的好物推荐，从家居到美妆到数码，每一件都是亲测好用，性价比超高。' },
    ],
    douyin: [
      { title: '当代年轻人的消费观：该省省该花花', hot_score: '1256.8w', desc: '笑死！当代年轻人的消费观有多双标：几百块的衣服说买就买，几块钱的运费嫌贵；上千的演唱会说冲就冲，会员到处借。' },
      { title: '00后整顿职场名场面合集', hot_score: '987.5w', desc: '00后真的来整顿职场了！到点下班拒绝加班、怒怼PUA老板、劳动仲裁绝不惯着，看完直呼太爽了！' },
      { title: 'AI生成视频已经进化到这个程度了', hot_score: '856.2w', desc: '最新AI视频生成工具效果炸裂，输入文字就能生成电影级视频，演员场景动作全AI生成，普通人也能做导演了。' },
      { title: '原来这就是信息差，看完醍醐灌顶', hot_score: '743.1w', desc: '那些学校不教但很重要的信息差，知道和不知道人生完全不同，包括赚钱、认知、社交、成长等各个方面。' },
      { title: '普通人如何抓住AI红利实现弯道超车', hot_score: '678.9w', desc: 'AI时代普通人的机会在哪里？不是让你去学编程，而是学会用AI提升自己的效率和竞争力，这几个方向现在入局还不晚。' },
      { title: '暑假工现状：老板比员工还多', hot_score: '612.3w', desc: '今年暑假工有多难找？老板比应聘者还多，工资低到离谱还一堆要求，大学生找暑假工现状实录，太真实了。' },
      { title: '这些生活小技巧看完我震惊了', hot_score: '567.4w', desc: '惊掉下巴的生活小技巧，每一个都超级实用，学会了能省不少钱和时间，最后一个绝了，看完赶紧试试！' },
      { title: '当我开始停止内耗，人生突然顺畅了', hot_score: '498.7w', desc: '停止精神内耗后整个人都轻松了，分享走出内耗的几个有效方法，亲测有用，别再自己跟自己较劲了。' },
      { title: '原来有钱人的快乐是这样的', hot_score: '445.2w', desc: '有钱人的快乐你想象不到！那些昂贵但真的好用的东西，用过一次就回不去了，虽然贵但真的值，努力赚钱吧！' },
      { title: '打工人的一周精神状态belike', hot_score: '398.6w', desc: '周一不想上班，周二想辞职，周三盼周五，周四摸鱼，周五狂喜，周末快乐似神仙，周一继续循环，是谁我不说。' },
    ],
    bilibili: [
      { title: '【硬核科普】AI是如何"思考"的？一个视频讲透大模型原理', hot_score: '523.4w', desc: '用最通俗的语言讲清楚大模型工作原理，从Transformer到GPT到现在的多模态AI，小白也能看懂，看完对AI的理解直接上一个层次。' },
      { title: '我用AI做了一个完整的游戏，全程只用了2小时', hot_score: '412.8w', desc: '不用写代码不用会美术，用AI工具从零开始做一款游戏，从策划到美术到编程到测试，全程实录，结果超出预期！' },
      { title: '2026年最值得学习的5个技能，学会一个就赚了', hot_score: '356.7w', desc: '未来5年最有前景的技能方向，不是让你去学编程，而是这些门槛不高但需求很大的技能，学会了不管上班还是副业都吃香。' },
      { title: '裸辞后我靠这个方法半年存了10w', hot_score: '298.3w', desc: '裸辞不上班，半年存了10万块，我是怎么做到的？分享我的赚钱思路、理财方法、消费观，普通人也能复制。' },
      { title: '【避坑指南】新手做自媒体最容易踩的10个坑', hot_score: '267.5w', desc: '做自媒体一年踩过的坑全在这了，从账号定位到内容创作到变现，这些坑踩一个都可能让你放弃，新手必看少走半年弯路。' },
      { title: '深度拆解｜为什么有的博主涨粉那么快？', hot_score: '234.1w', desc: '分析了100个快速涨粉的博主，发现他们都做对了这几件事，不是靠运气而是有方法，看完你也能复制他们的成功。' },
      { title: '我把手机换成了老人机，一周后...', hot_score: '198.7w', desc: '为了戒手机我把智能手机换成了老人机，坚持一周后发生了意想不到的变化，专注力提升了、焦虑减少了、时间变多了。' },
      { title: '【万字长文】普通人的逆袭机会到底在哪里？', hot_score: '176.4w', desc: '阶层真的固化了吗？普通人还有逆袭的机会吗？深度分析当前社会的上升通道，不是鸡汤是真话，看完至少帮你省5年弯路。' },
      { title: '效率up！这些神器让我每天多出2小时', hot_score: '154.2w', desc: '私藏效率工具大公开，从时间管理到笔记待办到文件管理，每一个都是精挑细选，用了之后效率提升肉眼可见。' },
      { title: 'vlog｜30岁独居女生的真实一天', hot_score: '132.8w', desc: '30岁不结婚不生娃，一个人住一个人生活，记录普通但充实的一天，没有精致摆拍只有真实日常，一个人也可以过得很好。' },
    ],
    weibo: [
      { title: '#年轻人为什么越来越喜欢独处#', hot_score: '897.2w', desc: '越来越多年轻人开始享受独处，一个人吃饭一个人看电影一个人旅行，不是孤僻而是觉得舒服，低质量的社交不如高质量的独处。' },
      { title: '#AI会取代哪些工作#', hot_score: '756.4w', desc: 'AI发展越来越快，哪些工作最容易被取代？哪些工作反而更吃香？专家分析未来10年就业趋势，打工人必看，提前做好准备。' },
      { title: '#当代人的副业刚需#', hot_score: '634.8w', desc: '现在的年轻人为什么都在搞副业？工资不够花、没有安全感、想多一份收入，你的副业是什么？来评论区分享一下搞钱经验。' },
      { title: '#你有存款焦虑吗#', hot_score: '578.3w', desc: '当代年轻人存款焦虑现状：存少了没安全感，存多了又觉得花了可惜，看到别人存钱自己也焦虑，你现在有多少存款？会焦虑吗？' },
      { title: '#自媒体给普通人带来了什么#', hot_score: '498.6w', desc: '自媒体时代普通人获得了前所未有的机会，有人靠它改变了命运，有人只是记录生活，说说自媒体给你带来了什么改变？' },
      { title: '#夏天最期待的一件事#', hot_score: '445.1w', desc: '夏天最期待的事是什么？吹空调吃西瓜、海边度假、傍晚散步、冰啤酒配小龙虾、穿好看的小裙子...你的夏天必做清单是什么？' },
      { title: '#00后开始整顿租房市场了#', hot_score: '387.9w', desc: '00后租房有多刚？不退押金直接起诉、要求房东修东西硬刚、签合同逐条审核，再也不惯着黑中介和无良房东了，太解气了！' },
      { title: '#每天睡够8小时有多重要#', hot_score: '334.5w', desc: '长期睡眠不足的危害有多大？不仅是没精神那么简单，还会影响记忆力、免疫力、情绪、皮肤，甚至增加患病风险，今天开始早点睡吧。' },
      { title: '#你的工资够花吗#', hot_score: '298.7w', desc: '现在的工资够你花吗？每月房租/房贷、吃饭、交通、社交...算下来根本存不下钱，你的工资水平在哪个城市够花吗？评论区聊聊。' },
      { title: '#学会拒绝有多爽#', hot_score: '256.3w', desc: '学会拒绝之后整个人都轻松了！不想帮的忙直接说不，不想去的聚会直接推，不用勉强自己讨好别人，这种感觉真的太爽了。' },
    ],
    zhihu: [
      { title: '2026年了，普通人还有哪些逆袭的机会？', hot_score: '186.5w', desc: '在这个看似阶层固化的时代，普通人真的还有逆袭的机会吗？高赞回答从行业趋势、个人成长、副业方向等多个角度给出了深度分析。' },
      { title: '为什么我不建议年轻人轻易做自媒体？', hot_score: '145.2w', desc: '人人都想做自媒体赚钱，但真相是90%的人都赚不到钱，甚至赚不到钱还浪费了时间，这篇文章泼点冷水，告诉你自媒体的真实情况。' },
      { title: '有哪些是你进了社会才明白的道理？', hot_score: '123.8w', desc: '学校不会教你的社会潜规则，句句扎心但真实，关于人际关系、职场生存、金钱观念、人性真相，早点明白少走很多弯路。' },
      { title: '每天坚持做什么事情，五年后会让你受益匪浅？', hot_score: '108.7w', desc: '那些坚持五年以上的好习惯，真的会改变一个人，高赞回答分享了几十个值得坚持的小习惯，从今天开始选几个做起来，时间会给你答案。' },
      { title: '为什么越来越多年轻人不想结婚了？', hot_score: '96.4w', desc: '现在年轻人结婚意愿越来越低，是不想结还是结不起？高赞回答从经济压力、观念变化、婚姻成本、个人追求等多个角度分析，很现实很透彻。' },
      { title: '一个人最靠谱的能力是什么？', hot_score: '87.3w', desc: '比情商智商更重要的是这个能力，拥有它的人不管做什么都不会太差，看看你有没有？这篇回答看完会改变你对能力的认知。' },
      { title: '有哪些看似聪明实则很蠢的行为？', hot_score: '76.5w', desc: '生活中那些自以为聪明其实很蠢的行为，你中了几个？贪小便宜吃大亏、耍小聪明、透支身体换钱...看完你会恍然大悟。' },
      { title: '月薪5k和月薪5w的人，思维差在哪里？', hot_score: '68.9w', desc: '月薪5k和月薪5w的人最大的差距不是努力程度，而是思维方式，这几个思维差异决定了你的收入上限，看完颠覆认知。' },
      { title: '你有什么相见恨晚的学习方法？', hot_score: '59.2w', desc: '学霸私藏的高效学习方法，费曼学习法、思维导图、间隔重复、刻意练习...每一个都经过验证，掌握了学习效率提升好几倍。' },
      { title: '30岁前一定要明白哪些职场道理？', hot_score: '52.1w', desc: '职场不是学校，没人有义务教你，这些道理早点明白少吃亏，高赞回答总结了几十条职场生存法则，应届生和职场新人必看。' },
    ],
    baidu: [
      { title: '2026年AI发展最新趋势', hot_score: '456.7w', desc: '2026年AI行业最新发展趋势盘点，从大模型到多模态到AI应用，哪些方向值得关注？普通人如何抓住AI机遇？一文看懂。' },
      { title: '自媒体入门零基础教程', hot_score: '387.2w', desc: '2026最新自媒体入门教程，从零开始教你做账号，包括平台选择、定位、内容创作、涨粉、变现全流程，新手小白也能看懂。' },
      { title: '适合普通人的副业推荐', hot_score: '345.8w', desc: '2026年适合普通人做的副业大盘点，低门槛易上手，利用下班时间就能做，从几十到几千不等，总有一个适合你。' },
      { title: '如何提高工作效率', hot_score: '298.4w', desc: '工作效率低总是加班？这几个方法帮你提升效率，从时间管理到任务规划到工具使用，学会了每天准时下班不是梦。' },
      { title: '夏日养生小知识', hot_score: '267.3w', desc: '夏天养生注意事项大全，饮食、作息、运动、防暑全攻略，这些夏季养生常识你一定要知道，健康度过整个夏天。' },
      { title: '职场新人必看的生存法则', hot_score: '234.6w', desc: '刚入职场的小白必看，这些生存法则没人会主动告诉你，但每一条都很重要，帮你快速适应职场少踩坑，建议收藏。' },
      { title: '怎么培养自己的核心竞争力', hot_score: '198.5w', desc: '不管上班还是创业，核心竞争力才是你最大的底气，如何找到并培养自己的核心竞争力？这几个方法亲测有效。' },
      { title: '长期坚持早起是什么体验', hot_score: '176.2w', desc: '坚持早起一年以上是种什么体验？身体、精神、生活、工作都发生了哪些变化？早起党们分享真实感受，看完你也想试试。' },
      { title: '有什么好用的效率工具推荐', hot_score: '154.8w', desc: '全网好评的效率工具合集，覆盖笔记、待办、时间管理、文件管理、截图录屏等各种场景，每一个都是精品，建议收藏。' },
      { title: '如何克服社交恐惧症', hot_score: '132.4w', desc: '社交恐惧怎么办？不敢说话、害怕人多场合、和人交流紧张？这几个实用方法帮你慢慢克服社交恐惧，建立自信心。' },
    ],
  };

  /**
   * 多个热点API源（按优先级尝试）
   */
  const HOT_API_SOURCES = [
    { name: 'tenapi', fn: fetchFromTenAPI },
    { name: 'vvhan', fn: fetchFromVvhan },
    { name: 'oioweb', fn: fetchFromOioweb },
    { name: 'imsyy', fn: fetchFromImsyy },
    { name: 'hot', fn: fetchFromHotApi },
  ];

  /**
   * 获取热点数据
   * 返回：{ source, items, isReal, fetchTime, error }
   */
  async function fetchHotTopics(platform) {
    const fetchTime = new Date().toLocaleString('zh-CN', { hour12: false });
    
    for (const source of HOT_API_SOURCES) {
      try {
        const items = await source.fn(platform);
        if (items && items.length >= 5) {
          console.log(`✅ [${source.name}] 成功获取${platform}热点:`, items.length, '条');
          return {
            source: source.name,
            items: items,
            isReal: true,
            fetchTime: fetchTime,
            error: null
          };
        }
      } catch (e) {
        console.warn(`❌ [${source.name}] 失败:`, e.message);
        continue;
      }
    }

    console.log('⚠️ 所有API都失败，使用示例数据');
    const fallbackItems = (FALLBACK_HOT_DATA[platform] || []).map((item, i) => normalizeItem(item, i, platform));
    return {
      source: '示例数据',
      items: fallbackItems,
      isReal: false,
      fetchTime: fetchTime,
      error: '所有实时API都不可用（可能因网络环境限制），当前显示的是示例数据。'
    };
  }

  // 统一处理item，提取字段并生成搜索链接
  function normalizeItem(item, i, platform) {
    const title = item.title || item.name || item.word || item.query || '';
    const desc = item.desc || item.description || item.excerpt || item.content || '';
    return {
      title: title,
      url: item.url || item.link || item.share_url || getSearchUrl(platform, title),
      hot_score: formatHot(item.hot || item.heat || item.score || item.hotValue || 0),
      cover: item.cover || item.pic || item.img || item.image || '',
      desc: desc ? String(desc).slice(0, 100) : '',
      search_url: getSearchUrl(platform, title),
      platform,
      rank: i + 1,
    };
  }

  // 源1: tenapi
  async function fetchFromTenAPI(platform) {
    const apiMap = {
      xhs: 'https://tenapi.cn/v2/xiaohongshu',
      douyin: 'https://tenapi.cn/v2/douyinhot',
      bilibili: 'https://tenapi.cn/v2/bilihot',
      weibo: 'https://tenapi.cn/v2/weibohot',
      zhihu: 'https://tenapi.cn/v2/zhihuhot',
      baidu: 'https://tenapi.cn/v2/baiduhot',
    };
    const url = apiMap[platform];
    if (!url) throw new Error('不支持的平台');
    
    const data = await fetchJson(url, 5000);
    if (data && data.code === 200 && data.data) {
      return data.data.slice(0, 15).map((item, i) => normalizeItem(item, i, platform)).filter(item => item.title);
    }
    throw new Error('数据格式错误');
  }

  // 源2: vvhan
  async function fetchFromVvhan(platform) {
    const apiMap = {
      xhs: 'https://api.vvhan.com/api/hotlist/xiaohongshu',
      douyin: 'https://api.vvhan.com/api/hotlist/douyinHot',
      bilibili: 'https://api.vvhan.com/api/hotlist/bili',
      weibo: 'https://api.vvhan.com/api/hotlist/wbHot',
      zhihu: 'https://api.vvhan.com/api/hotlist/zhihuHot',
      baidu: 'https://api.vvhan.com/api/hotlist/baiduRD',
    };
    const url = apiMap[platform];
    if (!url) throw new Error('不支持的平台');

    const data = await fetchJson(url, 5000);
    if (data && data.success !== false && data.data) {
      const items = Array.isArray(data.data) ? data.data : (data.data.list || []);
      return items.slice(0, 15).map((item, i) => normalizeItem(item, i, platform)).filter(item => item.title);
    }
    throw new Error('数据格式错误');
  }

  // 源3: oioweb
  async function fetchFromOioweb(platform) {
    const typeMap = {
      xhs: 'xiaohongshu', douyin: 'douyin', bilibili: 'bilibili',
      weibo: 'weibo', zhihu: 'zhihu', baidu: 'baidu',
    };
    const type = typeMap[platform];
    if (!type) throw new Error('不支持的平台');
    
    const data = await fetchJson(`https://api.oioweb.cn/api/common/HotList?type=${type}`, 5000);
    if (data && data.code === 200 && data.result && data.result.list) {
      return data.result.list.slice(0, 15).map((item, i) => normalizeItem(item, i, platform)).filter(item => item.title);
    }
    throw new Error('数据格式错误');
  }

  // 源4: imsyy (DailyHotApi)
  async function fetchFromImsyy(platform) {
    const apiMap = {
      xhs: 'https://api-hot.imsyy.top/xiaohongshu',
      douyin: 'https://api-hot.imsyy.top/douyin',
      bilibili: 'https://api-hot.imsyy.top/bilibili',
      weibo: 'https://api-hot.imsyy.top/weibo',
      zhihu: 'https://api-hot.imsyy.top/zhihu',
      baidu: 'https://api-hot.imsyy.top/baidu',
    };
    const url = apiMap[platform];
    if (!url) throw new Error('不支持的平台');

    const data = await fetchJson(url, 5000);
    if (data && Array.isArray(data.data)) {
      return data.data.slice(0, 15).map((item, i) => normalizeItem(item, i, platform)).filter(item => item.title);
    }
    throw new Error('数据格式错误');
  }

  // 源5: zhheo hot-api
  async function fetchFromHotApi(platform) {
    const apiMap = {
      xhs: 'https://hot-api.zhheo.com/xiaohongshu',
      douyin: 'https://hot-api.zhheo.com/douyin',
      bilibili: 'https://hot-api.zhheo.com/bilibili',
      weibo: 'https://hot-api.zhheo.com/weibo',
      zhihu: 'https://hot-api.zhheo.com/zhihu',
      baidu: 'https://hot-api.zhheo.com/baidu',
    };
    const url = apiMap[platform];
    if (!url) throw new Error('不支持的平台');

    const data = await fetchJson(url, 5000);
    if (data && Array.isArray(data.data)) {
      return data.data.slice(0, 15).map((item, i) => normalizeItem(item, i, platform)).filter(item => item.title);
    }
    throw new Error('数据格式错误');
  }

  function formatHot(num) {
    if (!num) return '0';
    if (typeof num === 'string') return num;
    if (num >= 10000) return (num / 10000).toFixed(1) + 'w';
    return String(num);
  }

  async function fetchJson(url, timeout = 5000) {
    let lastErr;
    for (let i = 0; i < CORS_PROXIES.length; i++) {
      try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), timeout);
        const proxyUrl = CORS_PROXIES[i](url);
        const res = await fetch(proxyUrl, { signal: ctrl.signal });
        clearTimeout(timer);
        if (res.ok) {
          const text = await res.text();
          try {
            return JSON.parse(text);
          } catch (e) {
            throw new Error('返回非JSON格式');
          }
        }
      } catch (e) {
        lastErr = e;
        continue;
      }
    }
    throw lastErr || new Error('所有代理都失败了');
  }

  /**
   * 飞书文档导出
   */
  async function exportToFeishu(content, title, appId, appSecret, folderToken) {
    if (!appId || !appSecret) {
      throw new Error('请先在设置中配置飞书应用凭证');
    }
    try {
      const tokenRes = await fetch('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
      });
      const tokenData = await tokenRes.json();
      if (tokenData.code !== 0) throw new Error('飞书认证失败: ' + tokenData.msg);
      const token = tokenData.tenant_access_token;

      const docRes = await fetch('https://open.feishu.cn/open-apis/docx/v1/documents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ title, folder_token: folderToken || undefined }),
      });
      const docData = await docRes.json();
      if (docData.code !== 0) throw new Error('创建文档失败: ' + docData.msg);

      return { ok: true, document_id: docData.data.document.document_id, url: `https://feishu.cn/docx/${docData.data.document.document_id}` };
    } catch (e) {
      if (e.message.includes('fetch')) throw new Error('飞书API调用失败，请检查网络和凭证');
      throw e;
    }
  }

  return { fetchUrl, parseUrl, aiSummarize, fetchHotTopics, exportToFeishu };
})();
/**
 * WebDAV同步模块 - 支持坚果云
 * 
 * 【坚果云WebDAV正确配置说明】
 * 1. 登录坚果云网页版 -> 右上角账户名 -> 账户信息 -> 安全选项
 * 2. 拉到页面最下方「第三方应用管理」-> 添加应用
 * 3. 应用名称填「创作者工作台」（任意名称都行），点击「生成密码」
 * 4. 复制生成的密码（不是你的登录密码！）
 * 
 * 【服务器地址说明】
 * 坚果云WebDAV根地址是: https://dav.jianguoyun.com/dav/
 * 我们的备份会存在: https://dav.jianguoyun.com/dav/你的邮箱/creator-workbench/
 * 程序会自动补全路径，你只需要填写根地址或者保持默认即可
 */
const WebDAV = (() => {
  const { el, toast } = Utils;

  // CORS代理列表（按优先级尝试）
  // 因为浏览器直接请求坚果云会有跨域限制，需要通过代理转发
  const CORS_PROXIES = [
    // 公共CORS代理（免费，可能不稳定）
    (url) => 'https://corsproxy.io/?' + encodeURIComponent(url),
    (url) => 'https://api.allorigins.win/raw?url=' + encodeURIComponent(url),
    (url) => 'https://cors.eu.org/' + url,
    // 直连（如果部署在支持的环境或者用户关闭了CORS检查）
    (url) => url,
  ];

  // 默认坚果云配置
  const DEFAULT_CONFIG = {
    serverUrl: 'https://dav.jianguoyun.com/dav/',
    username: '',
    password: '',
    autoSync: false,
    lastSync: null,
    useProxy: true
  };

  // 获取配置
  async function getConfig() {
    const saved = await DB.getSetting('webdav_config', null);
    return saved ? { ...DEFAULT_CONFIG, ...JSON.parse(saved) } : DEFAULT_CONFIG;
  }

  // 保存配置
  async function saveConfig(config) {
    await DB.setSetting('webdav_config', JSON.stringify(config));
  }

  // 获取坚果云实际的工作目录URL
  function getWorkDirUrl(config) {
    let base = config.serverUrl.trim();
    if (!base.endsWith('/')) base += '/';
    
    // 坚果云的WebDAV路径格式: https://dav.jianguoyun.com/dav/邮箱/
    // 如果用户填的是根地址，自动加上邮箱和creator-workbench子目录
    if (base.endsWith('/dav/') || base.endsWith('/dav')) {
      // 用户填了根地址，自动补全邮箱路径
      const email = config.username.trim();
      if (!email) return base + 'creator-workbench/';
      return base + encodeURIComponent(email) + '/creator-workbench/';
    }
    
    // 如果用户已经填了完整路径，直接用
    return base;
  }

  // 生成Basic Auth头
  function getAuthHeader(username, password) {
    // 处理中文邮箱的编码问题
    const credentials = unescape(encodeURIComponent(username + ':' + password));
    return 'Basic ' + btoa(credentials);
  }

  // 通过CORS代理执行WebDAV请求
  async function webdavFetch(url, options = {}, config) {
    const proxies = config.useProxy ? CORS_PROXIES : [CORS_PROXIES[CORS_PROXIES.length - 1]];
    
    let lastError = null;
    
    for (const proxyFn of proxies) {
      try {
        const proxyUrl = proxyFn(url);
        const headers = {
          'Authorization': getAuthHeader(config.username, config.password),
          ...options.headers
        };

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 15000);
        
        const response = await fetch(proxyUrl, {
          ...options,
          headers,
          signal: controller.signal,
          mode: 'cors'
        });
        
        clearTimeout(timeoutId);
        
        // 代理可能会包装错误状态
        if (response.status === 401) {
          throw new Error('认证失败：请检查邮箱和应用密码是否正确（注意是应用密码，不是登录密码！）');
        }
        
        if (response.status === 404 && options.method !== 'PROPFIND') {
          return null;
        }
        
        if (!response.ok && response.status !== 207) {
          // 有些代理在认证失败时返回其他状态码
          if (response.status === 0 || response.type === 'opaque') {
            throw new Error('网络请求失败，请检查网络连接');
          }
          // 继续尝试下一个代理
          lastError = new Error('服务器返回状态码: ' + response.status);
          continue;
        }
        
        return response;
      } catch (e) {
        lastError = e;
        // 如果是认证失败，直接抛出，不尝试其他代理
        if (e.message && e.message.includes('认证失败')) {
          throw e;
        }
        // 超时错误，继续尝试下一个代理
        if (e.name === 'AbortError') {
          lastError = new Error('连接超时，正在尝试其他通道...');
          continue;
        }
        continue;
      }
    }
    
    throw lastError || new Error('所有连接通道都失败了，请检查网络或稍后重试');
  }

  // 确保工作目录存在
  async function ensureWorkDir(config) {
    const workDir = getWorkDirUrl(config);
    
    // 先尝试PROPFIND检查目录是否存在
    try {
      await webdavFetch(workDir, {
        method: 'PROPFIND',
        headers: { 'Depth': '0' }
      }, config);
      return true;
    } catch (e) {
      // 目录不存在，尝试创建
      // 需要先确保父目录存在
      const email = config.username.trim();
      if (email) {
        // 先尝试创建邮箱目录
        const emailDir = config.serverUrl.trim().replace(/\/$/, '') + '/' + encodeURIComponent(email) + '/';
        try {
          await webdavFetch(emailDir, { method: 'MKCOL' }, config);
        } catch {}
      }
      
      // 再创建工作目录
      try {
        await webdavFetch(workDir, { method: 'MKCOL' }, config);
        return true;
      } catch (e2) {
        // 如果创建失败但目录可能已经存在（并发创建），忽略错误
        console.warn('创建目录失败:', e2);
        return true;
      }
    }
  }

  // 测试连接
  async function testConnection() {
    const config = await getConfig();
    if (!config.username || !config.password) {
      throw new Error('请先填写账号邮箱和应用密码');
    }

    try {
      await ensureWorkDir(config);
      return true;
    } catch (e) {
      console.error('WebDAV连接测试失败:', e);
      
      // 提供更友好的错误信息
      let errorMsg = e.message || '未知错误';
      
      if (errorMsg.includes('Failed to fetch') || errorMsg.includes('NetworkError')) {
        errorMsg = '网络连接失败，可能是CORS跨域限制。请确保已开启"使用CORS代理"选项。';
      } else if (errorMsg.includes('认证失败')) {
        errorMsg = '认证失败！请检查：\n1. 邮箱是否正确\n2. 密码是否是「第三方应用密码」（不是登录密码！）\n3. 应用密码是否完整复制，没有多余空格';
      } else if (errorMsg.includes('超时')) {
        errorMsg = '连接超时，请检查网络后重试';
      }
      
      throw new Error(errorMsg);
    }
  }

  // 上传备份文件
  async function uploadBackup(data) {
    const config = await getConfig();
    await ensureWorkDir(config);
    
    const workDir = getWorkDirUrl(config);
    const filename = 'backup-' + new Date().toISOString().replace(/[:.]/g, '-') + '.json';
    const url = workDir + filename;
    
    const content = JSON.stringify(data, null, 2);
    
    await webdavFetch(url, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: content
    }, config);

    // 更新最新备份指针
    await webdavFetch(workDir + 'latest.json', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename, timestamp: Date.now() })
    }, config);

    // 更新最后同步时间
    config.lastSync = new Date().toISOString();
    await saveConfig(config);

    return filename;
  }

  // 下载最新备份
  async function downloadLatest() {
    const config = await getConfig();
    const workDir = getWorkDirUrl(config);
    
    // 先获取latest指针
    try {
      const latestResp = await webdavFetch(workDir + 'latest.json', {}, config);
      if (latestResp) {
        const latest = await latestResp.json();
        if (latest.filename) {
          const dataResp = await webdavFetch(workDir + latest.filename, {}, config);
          if (dataResp) {
            return await dataResp.json();
          }
        }
      }
    } catch (e) {
      console.warn('获取latest指针失败，尝试列出文件:', e);
    }

    // 如果latest指针失败，列出所有备份文件找最新的
    try {
      const listResp = await webdavFetch(workDir, {
        method: 'PROPFIND',
        headers: { 'Depth': '1' }
      }, config);

      if (!listResp) return null;
      
      const text = await listResp.text();
      const parser = new DOMParser();
      const doc = parser.parseFromString(text, 'text/xml');
      const responses = doc.querySelectorAll('response');
      
      const backups = [];
      responses.forEach(r => {
        const href = r.querySelector('href')?.textContent;
        const lastmod = r.querySelector('getlastmodified')?.textContent;
        if (href && href.includes('backup-') && href.endsWith('.json')) {
          backups.push({ href, lastmod: lastmod ? new Date(lastmod) : new Date(0) });
        }
      });

      if (backups.length === 0) {
        return null;
      }

      backups.sort((a, b) => b.lastmod - a.lastmod);
      const latestHref = backups[0].href;
      
      // 处理href，可能是相对路径或绝对路径
      let fileUrl;
      if (latestHref.startsWith('http')) {
        fileUrl = latestHref;
      } else {
        // 从href中提取文件名
        const filename = latestHref.split('/').pop();
        fileUrl = workDir + filename;
      }
      
      const dataResp = await webdavFetch(fileUrl, {}, config);
      if (dataResp) {
        return await dataResp.json();
      }
    } catch (e) {
      console.error('列出文件失败:', e);
    }
    
    return null;
  }

  // 完整同步：上传当前数据
  async function syncUp() {
    const data = await DB.exportAll();
    const filename = await uploadBackup(data);
    await DB.setSetting('last_modified', Date.now().toString());
    return { filename, count: Object.values(data).reduce((s, arr) => s + (Array.isArray(arr) ? arr.length : 0), 0) };
  }

  // 完整同步：下载最新数据并导入
  async function syncDown() {
    const data = await downloadLatest();
    if (!data) {
      throw new Error('云端没有找到备份文件，请先上传数据');
    }
    await DB.importAll(data);
    const config = await getConfig();
    config.lastSync = new Date().toISOString();
    await saveConfig(config);
    await DB.setSetting('last_modified', Date.now().toString());
    return { count: Object.values(data).reduce((s, arr) => s + (Array.isArray(arr) ? arr.length : 0), 0) };
  }

  // 双向同步
  async function sync() {
    const config = await getConfig();
    const localLast = parseInt(await DB.getSetting('last_modified', '0')) || 0;
    let cloudLast = 0;

    try {
      const workDir = getWorkDirUrl(config);
      const latestResp = await webdavFetch(workDir + 'latest.json', {}, config);
      if (latestResp) {
        const latest = await latestResp.json();
        cloudLast = latest.timestamp || 0;
      }
    } catch (e) {
      // 云端没有文件，直接上传
    }

    if (cloudLast > localLast) {
      return { action: 'down', ...await syncDown() };
    } else {
      return { action: 'up', ...await syncUp() };
    }
  }

  // 渲染设置面板
  function renderSettings() {
    const container = el('div', { class: 'settings-section' });
    
    container.appendChild(el('h3', {}, '☁️ WebDAV 云同步（坚果云）'));
    
    const statusDiv = el('div', { class: 'webdav-status', id: 'webdav-status' }, '未配置');
    
    const form = el('div', { class: 'form-group' });
    
    // 服务器地址
    form.appendChild(el('label', {}, '服务器地址'));
    const serverInput = el('input', { 
      type: 'text', 
      id: 'webdav-server',
      placeholder: 'https://dav.jianguoyun.com/dav/',
      class: 'input',
      value: DEFAULT_CONFIG.serverUrl
    });
    form.appendChild(serverInput);
    
    // 用户名
    form.appendChild(el('label', {}, '账号邮箱（用户名）'));
    const userInput = el('input', { 
      type: 'email', 
      id: 'webdav-user',
      placeholder: '你的坚果云注册邮箱',
      class: 'input'
    });
    form.appendChild(userInput);
    
    // 密码
    form.appendChild(el('label', {}, '应用专用密码'));
    const passInput = el('input', { 
      type: 'password', 
      id: 'webdav-pass',
      placeholder: '坚果云生成的第三方应用密码（不是登录密码！）',
      class: 'input'
    });
    form.appendChild(passInput);

    // 使用CORS代理选项
    const proxyWrap = el('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', marginTop: '8px', fontSize: '12px', color: 'var(--muted)' } });
    const proxyCheck = el('input', { 
      type: 'checkbox', 
      id: 'webdav-proxy',
      checked: true,
      style: 'width: auto; margin: 0;'
    });
    proxyWrap.appendChild(proxyCheck);
    proxyWrap.appendChild(el('label', { for: 'webdav-proxy', style: 'margin: 0; cursor: pointer;' }, '使用CORS代理（推荐，解决浏览器跨域限制）'));
    form.appendChild(proxyWrap);
    
    // 帮助说明
    const help = el('div', { class: 'webdav-help', html: `
      <p><strong>坚果云配置步骤（重要！）：</strong></p>
      <ol>
        <li>登录 <a href="https://www.jianguoyun.com" target="_blank">坚果云官网</a>（网页版）</li>
        <li>点击右上角你的账户名 → <strong>账户信息</strong></li>
        <li>点击左侧「安全选项」，拉到页面<strong>最底部</strong></li>
        <li>找到「第三方应用管理」→ 点击「添加应用」</li>
        <li>应用名称填「<strong>创作者工作台</strong>」，点击「生成密码」</li>
        <li>把生成的密码<strong>完整复制</strong>到上面「应用专用密码」栏</li>
      </ol>
      <p style="color: #ef4444; margin-top: 8px;"><strong>⚠️ 注意：</strong>这里填的是「应用专用密码」，<strong>不是</strong>你的坚果云登录密码！</p>
    ` });
    form.appendChild(help);
    
    container.appendChild(form);
    container.appendChild(statusDiv);
    
    // 按钮组
    const btnGroup = el('div', { class: 'btn-group', style: { display: 'flex', gap: '8px', marginTop: '12px', flexWrap: 'wrap' } });
    
    const testBtn = el('button', { class: 'btn btn-secondary', onclick: async () => {
      testBtn.disabled = true;
      testBtn.textContent = '测试中...';
      try {
        await saveConfigFromInputs();
        const ok = await testConnection();
        if (ok) {
          toast('✅ 连接成功！');
          statusDiv.textContent = '✅ 已连接' + ' - 上次同步: ' + ((await getConfig()).lastSync ? new Date((await getConfig()).lastSync).toLocaleString('zh-CN') : '从未');
          statusDiv.className = 'webdav-status success';
        }
      } catch (e) {
        toast('❌ ' + e.message);
        statusDiv.textContent = '❌ ' + e.message.replace(/\n/g, ' ');
        statusDiv.className = 'webdav-status error';
      } finally {
        testBtn.disabled = false;
        testBtn.textContent = '🔌 测试连接';
      }
    } }, '🔌 测试连接');
    
    const saveBtn = el('button', { class: 'btn btn-primary', onclick: async () => {
      try {
        await saveConfigFromInputs();
        toast('✅ 配置已保存');
        await updateStatusDisplay();
      } catch (e) {
        toast('❌ 保存失败: ' + e.message);
      }
    } }, '💾 保存配置');
    
    btnGroup.appendChild(testBtn);
    btnGroup.appendChild(saveBtn);
    container.appendChild(btnGroup);
    
    // 同步按钮组
    const syncGroup = el('div', { class: 'btn-group', style: { display: 'flex', gap: '8px', marginTop: '12px', flexWrap: 'wrap' } });
    
    const upBtn = el('button', { class: 'btn btn-primary', onclick: async () => {
      upBtn.disabled = true;
      upBtn.textContent = '上传中...';
      try {
        const result = await syncUp();
        toast('✅ 上传成功: ' + result.count + '条记录');
        await updateStatusDisplay();
      } catch (e) {
        toast('❌ 上传失败: ' + e.message);
      } finally {
        upBtn.disabled = false;
        upBtn.textContent = '⬆️ 上传到云端';
      }
    } }, '⬆️ 上传到云端');
    
    const downBtn = el('button', { class: 'btn btn-secondary', onclick: async () => {
      if (!confirm('从云端恢复将覆盖本地所有数据，确定继续？')) return;
      downBtn.disabled = true;
      downBtn.textContent = '下载中...';
      try {
        const result = await syncDown();
        toast('✅ 恢复成功: ' + result.count + '条记录');
        await updateStatusDisplay();
        setTimeout(() => location.reload(), 1000);
      } catch (e) {
        toast('❌ 下载失败: ' + e.message);
      } finally {
        downBtn.disabled = false;
        downBtn.textContent = '⬇️ 从云端恢复';
      }
    } }, '⬇️ 从云端恢复');
    
    const syncBtn = el('button', { class: 'btn btn-primary', style: { background: '#8b5cf6' }, onclick: async () => {
      syncBtn.disabled = true;
      syncBtn.textContent = '同步中...';
      try {
        const result = await sync();
        const actionText = result.action === 'up' ? '上传' : '下载';
        toast('✅ 同步完成(' + actionText + '): ' + result.count + '条记录');
        await updateStatusDisplay();
        if (result.action === 'down') setTimeout(() => location.reload(), 1000);
      } catch (e) {
        toast('❌ 同步失败: ' + e.message);
      } finally {
        syncBtn.disabled = false;
        syncBtn.textContent = '🔄 一键同步';
      }
    } }, '🔄 一键同步');
    
    syncGroup.appendChild(syncBtn);
    syncGroup.appendChild(upBtn);
    syncGroup.appendChild(downBtn);
    container.appendChild(syncGroup);
    
    // 从输入框保存配置
    async function saveConfigFromInputs() {
      const config = {
        serverUrl: serverInput.value.trim() || DEFAULT_CONFIG.serverUrl,
        username: userInput.value.trim(),
        password: passInput.value.trim(),
        useProxy: proxyCheck.checked,
        autoSync: false
      };
      const old = await getConfig();
      await saveConfig({ ...old, ...config, lastSync: old.lastSync });
    }
    
    // 更新状态显示
    async function updateStatusDisplay() {
      const config = await getConfig();
      if (config.username && config.password) {
        try {
          await testConnection();
          const lastSyncStr = config.lastSync ? new Date(config.lastSync).toLocaleString('zh-CN') : '从未';
          statusDiv.textContent = '✅ 已连接 - 上次同步: ' + lastSyncStr;
          statusDiv.className = 'webdav-status success';
        } catch (e) {
          statusDiv.textContent = '⚠️ ' + e.message.replace(/\n/g, ' ');
          statusDiv.className = 'webdav-status warning';
        }
      } else {
        statusDiv.textContent = '未配置，请填写坚果云账号信息';
        statusDiv.className = 'webdav-status';
      }
    }
    
    // 加载现有配置
    (async () => {
      const config = await getConfig();
      serverInput.value = config.serverUrl;
      userInput.value = config.username;
      passInput.value = config.password;
      proxyCheck.checked = config.useProxy !== false;
      await updateStatusDisplay();
    })();
    
    return container;
  }

  return { getConfig, saveConfig, testConnection, syncUp, syncDown, sync, renderSettings };
})();
/**
 * 思维导图树状知识图谱模块
 */
const MindMap = (() => {
  const { el, toast, openModal, closeModal } = Utils;

  // 默认知识树结构
  const DEFAULT_TREE = {
    id: 'root',
    text: '我的知识库',
    children: [
      {
        id: 'cat-growth',
        text: '个人成长',
        children: [
          { id: 'g-1', text: '认知升级', children: [] },
          { id: 'g-2', text: '时间管理', children: [] },
          { id: 'g-3', text: '学习方法', children: [] },
        ]
      },
      {
        id: 'cat-content',
        text: '内容创作',
        children: [
          { id: 'c-1', text: '选题策划', children: [] },
          { id: 'c-2', text: '脚本写作', children: [] },
          { id: 'c-3', text: '拍摄剪辑', children: [] },
          { id: 'c-4', text: '运营涨粉', children: [] },
        ]
      },
      {
        id: 'cat-ai',
        text: 'AI转型',
        children: [
          { id: 'a-1', text: 'AI工具', children: [] },
          { id: 'a-2', text: 'AI变现', children: [] },
          { id: 'a-3', text: '行业动态', children: [] },
        ]
      },
      {
        id: 'cat-life',
        text: '生活记录',
        children: [
          { id: 'l-1', text: '旅行见闻', children: [] },
          { id: 'l-2', text: '美食探店', children: [] },
          { id: 'l-3', text: '日常感悟', children: [] },
        ]
      }
    ]
  };

  let treeData = null;
  let expandedNodes = new Set(['root', 'cat-growth', 'cat-content', 'cat-ai', 'cat-life']);
  let selectedNode = null;
  let onUpdateCallback = null;

  // 生成唯一ID
  function genId() {
    return 'node-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7);
  }

  // 加载树数据
  async function load() {
    const saved = await DB.getSetting('mindmap_tree', null);
    if (saved) {
      try {
        treeData = JSON.parse(saved);
      } catch {
        treeData = JSON.parse(JSON.stringify(DEFAULT_TREE));
      }
    } else {
      treeData = JSON.parse(JSON.stringify(DEFAULT_TREE));
    }
    
    // 加载展开状态
    const expanded = await DB.getSetting('mindmap_expanded', null);
    if (expanded) {
      try {
        expandedNodes = new Set(JSON.parse(expanded));
      } catch {}
    }
  }

  // 保存树数据
  async function save() {
    await DB.setSetting('mindmap_tree', JSON.stringify(treeData));
    await DB.setSetting('mindmap_expanded', JSON.stringify([...expandedNodes]));
    await DB.setSetting('last_modified', Date.now().toString());
  }

  // 查找节点
  function findNode(id, node = treeData) {
    if (node.id === id) return node;
    for (const child of node.children || []) {
      const found = findNode(id, child);
      if (found) return found;
    }
    return null;
  }

  // 查找父节点
  function findParent(id, node = treeData, parent = null) {
    if (node.id === id) return parent;
    for (const child of node.children || []) {
      const found = findParent(id, child, node);
      if (found) return found;
    }
    return null;
  }

  // 添加子节点
  async function addChild(parentId, text = '新节点') {
    const parent = findNode(parentId);
    if (!parent) return;
    if (!parent.children) parent.children = [];
    const newNode = { id: genId(), text, children: [], createdAt: Date.now() };
    parent.children.push(newNode);
    expandedNodes.add(parentId);
    await save();
    return newNode;
  }

  // 删除节点
  async function deleteNode(nodeId) {
    if (nodeId === 'root') {
      toast('根节点不能删除');
      return false;
    }
    const parent = findParent(nodeId);
    if (!parent) return false;
    parent.children = parent.children.filter(c => c.id !== nodeId);
    await save();
    return true;
  }

  // 更新节点文本
  async function updateNode(nodeId, text) {
    const node = findNode(nodeId);
    if (!node) return false;
    node.text = text;
    await save();
    return true;
  }

  // 移动节点（拖拽排序）
  async function moveNode(nodeId, targetParentId, index) {
    const parent = findParent(nodeId);
    const targetParent = findNode(targetParentId);
    if (!parent || !targetParent) return false;
    
    // 从原位置移除
    const nodeIndex = parent.children.findIndex(c => c.id === nodeId);
    if (nodeIndex === -1) return false;
    const [node] = parent.children.splice(nodeIndex, 1);
    
    // 插入到新位置
    if (!targetParent.children) targetParent.children = [];
    targetParent.children.splice(index, 0, node);
    
    expandedNodes.add(targetParentId);
    await save();
    return true;
  }

  // 从灵感库导入到节点
  async function importInspirationsToNode(nodeId) {
    const inspirations = await DB.getAll('inspirations');
    const node = findNode(nodeId);
    if (!node) return;
    
    // 按分类分组
    const groups = {};
    inspirations.forEach(ins => {
      const cat = ins.category1 || '未分类';
      if (!groups[cat]) groups[cat] = [];
      groups[cat].push(ins);
    });
    
    let count = 0;
    for (const [cat, items] of Object.entries(groups)) {
      // 查找或创建分类子节点
      let catNode = node.children?.find(c => c.text === cat);
      if (!catNode) {
        catNode = { id: genId(), text: cat, children: [] };
        if (!node.children) node.children = [];
        node.children.push(catNode);
      }
      
      items.forEach(ins => {
        if (!catNode.children.find(c => c.text === ins.content.slice(0, 50))) {
          catNode.children.push({
            id: genId(),
            text: ins.content.slice(0, 60),
            children: [],
            url: ins.url,
            note: ins.note,
            source: 'inspiration',
            createdAt: ins.created_at
          });
          count++;
        }
      });
    }
    
    expandedNodes.add(nodeId);
    await save();
    return count;
  }

  // 导出为Markdown（适配Obsidian）
  function exportMarkdown() {
    function nodeToMd(node, level = 0) {
      const prefix = '#'.repeat(level + 1);
      let md = `${prefix} ${node.text}\n\n`;
      if (node.url) md += `链接: ${node.url}\n\n`;
      if (node.note) md += `${node.note}\n\n`;
      if (node.children) {
        for (const child of node.children) {
          md += nodeToMd(child, level + 1);
        }
      }
      return md;
    }
    return nodeToMd(treeData);
  }

  // 渲染思维导图节点
  function renderNode(node, depth = 0) {
    const isExpanded = expandedNodes.has(node.id);
    const hasChildren = node.children && node.children.length > 0;
    const isSelected = selectedNode === node.id;
    const isRoot = depth === 0;
    
    const nodeEl = el('div', { 
      class: 'mindmap-node' + (isSelected ? ' selected' : '') + (isRoot ? ' root' : ''),
      'data-id': node.id,
      style: { marginLeft: (depth * 20) + 'px' }
    });
    
    // 节点头部
    const header = el('div', { class: 'mindmap-node-header' });
    
    // 展开/折叠按钮
    const toggleBtn = el('span', { 
      class: 'mindmap-toggle' + (hasChildren ? '' : ' leaf'),
      onclick: (e) => {
        e.stopPropagation();
        if (hasChildren) {
          if (isExpanded) expandedNodes.delete(node.id);
          else expandedNodes.add(node.id);
          save();
          render();
        }
      }
    }, hasChildren ? (isExpanded ? '▼' : '▶') : '•');
    header.appendChild(toggleBtn);
    
    // 节点文本
    const textEl = el('span', { 
      class: 'mindmap-text',
      onclick: () => {
        selectedNode = node.id;
        render();
        updateToolbar();
      },
      ondblclick: () => {
        editNode(node);
      }
    }, node.text);
    header.appendChild(textEl);
    
    // 节点计数
    if (hasChildren) {
      header.appendChild(el('span', { class: 'mindmap-count' }, node.children.length));
    }
    
    // 操作按钮（hover时显示）
    const actions = el('div', { class: 'mindmap-actions' });
    
    const addBtn = el('button', { 
      class: 'mindmap-btn',
      title: '添加子节点',
      onclick: (e) => {
        e.stopPropagation();
        addNodePrompt(node.id);
      }
    }, '+');
    actions.appendChild(addBtn);
    
    if (!isRoot) {
      const delBtn = el('button', { 
        class: 'mindmap-btn delete',
        title: '删除节点',
        onclick: (e) => {
          e.stopPropagation();
          if (confirm('确定删除节点「' + node.text + '」及其所有子节点？')) {
            deleteNode(node.id);
            if (selectedNode === node.id) selectedNode = null;
            render();
            updateToolbar();
          }
        }
      }, '×');
      actions.appendChild(delBtn);
    }
    
    header.appendChild(actions);
    nodeEl.appendChild(header);
    
    // 子节点
    if (hasChildren && isExpanded) {
      const childrenEl = el('div', { class: 'mindmap-children' });
      node.children.forEach(child => {
        childrenEl.appendChild(renderNode(child, depth + 1));
      });
      nodeEl.appendChild(childrenEl);
    }
    
    return nodeEl;
  }

  // 编辑节点
  function editNode(node) {
    const input = el('input', { 
      type: 'text', 
      value: node.text,
      class: 'mindmap-edit-input'
    });
    
    const wrap = el('div', { class: 'mindmap-edit-wrap' }, [
      input,
      el('div', { style: { display: 'flex', gap: '8px', marginTop: '8px' } }, [
        el('button', { 
          class: 'btn btn-primary', 
          style: { padding: '4px 12px', fontSize: '13px' },
          onclick: async () => {
            const text = input.value.trim();
            if (text) {
              await updateNode(node.id, text);
              closeModal();
              render();
              toast('已更新');
            }
          }
        }, '保存'),
        el('button', { 
          class: 'btn btn-secondary',
          style: { padding: '4px 12px', fontSize: '13px' },
          onclick: () => closeModal()
        }, '取消')
      ])
    ]);
    
    openModal(wrap);
    setTimeout(() => input.focus(), 100);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') input.nextSibling.firstChild.click();
      if (e.key === 'Escape') closeModal();
    });
  }

  // 添加节点对话框
  function addNodePrompt(parentId) {
    const input = el('input', { 
      type: 'text', 
      placeholder: '输入节点内容...',
      class: 'mindmap-edit-input'
    });
    
    const wrap = el('div', { class: 'mindmap-edit-wrap' }, [
      el('h3', { style: { margin: '0 0 12px 0' } }, '添加子节点'),
      input,
      el('div', { style: { display: 'flex', gap: '8px', marginTop: '12px', flexWrap: 'wrap' } }, [
        el('button', { 
          class: 'btn btn-primary', 
          onclick: async () => {
            const text = input.value.trim();
            if (text) {
              await addChild(parentId, text);
              closeModal();
              render();
              toast('已添加');
            }
          }
        }, '添加'),
        el('button', { 
          class: 'btn btn-secondary',
          onclick: () => closeModal()
        }, '取消')
      ])
    ]);
    
    openModal(wrap);
    setTimeout(() => input.focus(), 100);
  }

  // 工具栏
  function renderToolbar() {
    const toolbar = el('div', { class: 'mindmap-toolbar' });
    
    // 展开/折叠全部
    toolbar.appendChild(el('button', { 
      class: 'btn btn-secondary',
      style: { padding: '6px 12px', fontSize: '13px' },
      onclick: () => {
        function collectIds(node) {
          expandedNodes.add(node.id);
          (node.children || []).forEach(collectIds);
        }
        collectIds(treeData);
        save();
        render();
      }
    }, '展开全部'));
    
    toolbar.appendChild(el('button', { 
      class: 'btn btn-secondary',
      style: { padding: '6px 12px', fontSize: '13px' },
      onclick: () => {
        expandedNodes.clear();
        expandedNodes.add('root');
        save();
        render();
      }
    }, '折叠全部'));
    
    toolbar.appendChild(el('span', { style: { width: '1px', height: '20px', background: '#e5e7eb', margin: '0 4px' } }));
    
    // 添加根节点分支
    toolbar.appendChild(el('button', { 
      class: 'btn btn-primary',
      style: { padding: '6px 12px', fontSize: '13px' },
      onclick: () => addNodePrompt('root')
    }, '+ 添加分支'));
    
    // 导入灵感库
    toolbar.appendChild(el('button', { 
      class: 'btn btn-secondary',
      style: { padding: '6px 12px', fontSize: '13px' },
      onclick: async () => {
        const targetId = selectedNode || 'root';
        if (confirm('将灵感库内容导入到选中节点？')) {
          const count = await importInspirationsToNode(targetId);
          expandedNodes.add(targetId);
          render();
          toast('导入了 ' + count + ' 条灵感');
        }
      }
    }, '📥 导入灵感库'));
    
    // 导出Obsidian
    toolbar.appendChild(el('button', { 
      class: 'btn btn-secondary',
      style: { padding: '6px 12px', fontSize: '13px' },
      onclick: () => {
        const md = exportMarkdown();
        const blob = new Blob([md], { type: 'text/markdown' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = '知识库-' + new Date().toISOString().slice(0, 10) + '.md';
        a.click();
        URL.revokeObjectURL(url);
        toast('已导出为Markdown（可直接导入Obsidian）');
      }
    }, '📤 导出Obsidian'));
    
    // 重置
    toolbar.appendChild(el('button', { 
      class: 'btn btn-secondary',
      style: { padding: '6px 12px', fontSize: '13px', color: '#ef4444' },
      onclick: async () => {
        if (confirm('确定重置为默认知识库结构？当前内容将丢失！')) {
          treeData = JSON.parse(JSON.stringify(DEFAULT_TREE));
          expandedNodes = new Set(['root', 'cat-growth', 'cat-content', 'cat-ai', 'cat-life']);
          await save();
          render();
          toast('已重置');
        }
      }
    }, '🔄 重置'));
    
    return toolbar;
  }

  function updateToolbar() {
    // 可以在这里更新选中节点的工具栏状态
  }

  let containerEl = null;

  function render() {
    if (!containerEl) return;
    containerEl.innerHTML = '';
    containerEl.appendChild(renderToolbar());
    
    const treeContainer = el('div', { class: 'mindmap-container', id: 'mindmap-tree' });
    treeContainer.appendChild(renderNode(treeData, 0));
    containerEl.appendChild(treeContainer);
    
    // 提示
    containerEl.appendChild(el('div', { 
      class: 'mindmap-tip',
      html: '💡 点击节点选中，双击编辑，点+添加子节点，点×删除。<br>导出的Markdown文件可直接放入Obsidian库文件夹使用。'
    }));
  }

  // 渲染主页面
  async function renderPage(root) {
    await load();
    containerEl = el('div', { class: 'mindmap-page' });
    
    root.innerHTML = '';
    root.appendChild(el('div', { class: 'page-title' }, '🧠 知识图谱'));
    root.appendChild(el('div', { class: 'page-sub' }, '树状思维导图 · 支持导出Obsidian'));
    root.appendChild(containerEl);
    
    render();
  }

  return { renderPage, load, save, addChild, deleteNode, updateNode, exportMarkdown };
})();
/**
 * 页面渲染 - 所有页面纯前端实现
 */
const Pages = (() => {
  const { $, $$, el, today, formatDate, formatNum, PLATFORMS, HOT_TABS, platformName, platformColor, moodEmoji, toast, openModal, closeModal, downloadFile, debounce } = Utils;

  // ========== 数据看板 ==========
  async function dashboard(root) {
    root.innerHTML = '';
    root.appendChild(el('div', { class: 'page-title' }, '数据看板'));
    root.appendChild(el('div', { class: 'page-sub' }, '追踪各平台数据表现'));

    // 平台卡片
    const grid = el('div', { class: 'platform-grid' });
    const today_str = today();

    // 获取今日数据
    const allMetrics = await DB.getAll('metrics');
    const todayMetrics = {};
    allMetrics.forEach(m => {
      if (m.date === today_str) todayMetrics[m.platform] = m;
    });

    PLATFORMS.forEach(p => {
      const d = todayMetrics[p.id] || { followers: 0, followers_delta: 0, views: 0, likes: 0, favorites: 0, comments: 0 };
      const card = el('div', { class: 'platform-card', onclick: () => openMetricEditor(p.id, d) }, [
        el('div', { class: 'pname' }, [
          el('span', { class: 'dot', style: { background: p.color } }),
          p.name,
        ]),
        el('div', { class: 'metrics-row' }, [
          el('div', { class: 'metric-item' }, [
            el('div', { class: 'pmetric' }, formatNum(d.views || 0)),
            el('div', { class: 'plabel' }, '播放'),
          ]),
          el('div', { class: 'metric-item' }, [
            el('div', { class: 'pmetric' }, formatNum(d.likes || 0)),
            el('div', { class: 'plabel' }, '点赞'),
          ]),
          el('div', { class: 'metric-item' }, [
            el('div', { class: 'pmetric' }, formatNum(d.favorites || 0)),
            el('div', { class: 'plabel' }, '收藏'),
          ]),
        ]),
        el('div', { class: 'followers-row' }, [
          el('span', { class: 'followers-delta ' + ((d.followers_delta || 0) >= 0 ? 'positive' : 'negative') },
            ((d.followers_delta || 0) >= 0 ? '+' : '') + (d.followers_delta || 0) + ' 粉 · 总' + formatNum(d.followers || 0)),
        ]),
      ]);
      grid.appendChild(card);
    });
    root.appendChild(grid);

    // 同步按钮
    const syncArea = el('div', { class: 'sync-area' });
    const syncBtn = el('button', { class: 'btn btn-primary', style: { flex: '1' }, onclick: async () => {
      syncBtn.disabled = true;
      syncBtn.textContent = '同步中…';
      try {
        const sessdata = await DB.getSetting('bilibili_sessdata', '');
        if (!sessdata) {
          toast('请先在设置中配置B站SESSDATA');
          setTimeout(() => window.__navigate('settings'), 1500);
          return;
        }
        toast('B站自动同步开发中，请先手动录入数据');
        // TODO: B站自动同步
      } catch (e) {
        toast('同步失败: ' + e.message);
      } finally {
        syncBtn.disabled = false;
        syncBtn.textContent = '📺 同步B站数据';
      }
    } }, '📺 同步B站数据');
    syncArea.appendChild(syncBtn);
    const syncTip = el('span', { class: 'sync-tip', onclick: () => window.__navigate('settings') }, '⚙️ 配置');
    syncArea.appendChild(syncTip);
    root.appendChild(syncArea);

    // 周汇总
    const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
    const weekMetrics = allMetrics.filter(m => m.date >= weekAgo);
    const summary = weekMetrics.reduce((acc, m) => ({
      followers_delta: (acc.followers_delta || 0) + (m.followers_delta || 0),
      views: (acc.views || 0) + (m.views || 0),
      likes: (acc.likes || 0) + (m.likes || 0),
      favorites: (acc.favorites || 0) + (m.favorites || 0),
    }), { followers_delta: 0, views: 0, likes: 0, favorites: 0 });

    const summaryCard = el('div', { class: 'card' });
    summaryCard.appendChild(el('div', { class: 'card-title' }, '近7日汇总'));
    const sGrid = el('div', { class: 'summary-grid' });
    [
      { label: '粉丝净增', val: (summary.followers_delta >= 0 ? '+' : '') + summary.followers_delta, cls: summary.followers_delta >= 0 ? 'positive' : '' },
      { label: '总播放', val: formatNum(summary.views), cls: '' },
      { label: '总点赞', val: formatNum(summary.likes), cls: '' },
      { label: '总收藏', val: formatNum(summary.favorites), cls: '' },
    ].forEach(s => {
      sGrid.appendChild(el('div', {}, [
        el('div', { class: 'text-xs text-muted' }, s.label),
        el('div', { class: 'summary-num ' + s.cls }, s.val),
      ]));
    });
    summaryCard.appendChild(sGrid);
    root.appendChild(summaryCard);

    // 历史记录
    const histCard = el('div', { class: 'card' });
    histCard.appendChild(el('div', { class: 'card-title' }, '历史记录'));
    const sorted = [...allMetrics].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 20);
    if (sorted.length === 0) {
      histCard.appendChild(el('div', { class: 'empty-state' }, [
        el('div', { class: 'empty-state-icon' }, '📊'),
        el('div', {}, '暂无数据，点击上方卡片录入'),
      ]));
    } else {
      const list = el('div', {});
      // 按日期分组
      const byDate = {};
      sorted.forEach(m => {
        if (!byDate[m.date]) byDate[m.date] = [];
        byDate[m.date].push(m);
      });
      Object.keys(byDate).sort((a, b) => b.localeCompare(a)).forEach(date => {
        const dateItems = byDate[date];
        const dateHeader = el('div', { style: { fontSize: '12px', color: 'var(--muted)', fontWeight: '600', padding: '8px 0 4px' } }, date);
        list.appendChild(dateHeader);
        dateItems.forEach(m => {
          list.appendChild(el('div', { class: 'list-item' }, [
            el('span', { class: 'dot', style: { width: '8px', height: '8px', borderRadius: '50%', background: platformColor(m.platform), marginTop: '5px', flexShrink: '0' } }),
            el('div', { class: 'li-main' }, [
              el('div', { class: 'li-title' }, platformName(m.platform)),
              el('div', { class: 'li-sub' }, `播放 ${formatNum(m.views || 0)} · 点赞 ${formatNum(m.likes || 0)} · 收藏 ${formatNum(m.favorites || 0)} · ${(m.followers_delta || 0) >= 0 ? '+' : ''}${m.followers_delta || 0} 粉`),
            ]),
          ]));
        });
      });
      histCard.appendChild(list);
    }
    root.appendChild(histCard);
  }

  function openMetricEditor(platform, data) {
    const content = el('div', {});
    content.appendChild(el('div', { class: 'page-title', style: { fontSize: '18px', marginBottom: '16px' } }, `📊 录入${platformName(platform)}数据`));

    const fields = [
      { key: 'followers', label: '总粉丝数', type: 'number', placeholder: '0' },
      { key: 'followers_delta', label: '今日新增粉丝', type: 'number', placeholder: '0' },
      { key: 'views', label: '今日播放量', type: 'number', placeholder: '0' },
      { key: 'likes', label: '今日点赞数', type: 'number', placeholder: '0' },
      { key: 'favorites', label: '今日收藏数', type: 'number', placeholder: '0' },
      { key: 'comments', label: '今日评论数', type: 'number', placeholder: '0' },
      { key: 'hit_title', label: '爆款标题(可选)', type: 'text', placeholder: '今日爆款视频标题' },
    ];

    const inputs = {};
    fields.forEach(f => {
      const wrap = el('div', { class: 'field' });
      wrap.appendChild(el('label', {}, f.label));
      const input = el('input', { type: f.type, placeholder: f.placeholder, value: data[f.key] || '' });
      inputs[f.key] = input;
      wrap.appendChild(input);
      content.appendChild(wrap);
    });

    const dateWrap = el('div', { class: 'field' });
    dateWrap.appendChild(el('label', {}, '日期'));
    const dateInput = el('input', { type: 'date', value: today() });
    inputs.date = dateInput;
    dateWrap.appendChild(dateInput);
    content.appendChild(dateWrap);

    const btns = el('div', { class: 'flex', style: { gap: '8px', marginTop: '16px' } });
    btns.appendChild(el('button', { class: 'btn btn-ghost', style: { flex: '1' }, onclick: closeModal }, '取消'));
    btns.appendChild(el('button', { class: 'btn btn-primary', style: { flex: '2' }, onclick: async () => {
      const body = { platform, date: inputs.date.value };
      fields.forEach(f => {
        const v = inputs[f.key].value;
        body[f.key] = f.type === 'number' ? Number(v) || 0 : v.trim();
      });
      // upsert
      const existing = (await DB.getAll('metrics')).find(m => m.platform === platform && m.date === body.date);
      if (existing) {
        await DB.put('metrics', { ...existing, ...body });
      } else {
        await DB.add('metrics', body);
      }
      toast('数据已保存');
      closeModal();
      dashboard(document.querySelector('.page.active') || document.getElementById('page-dashboard'));
    } }, '保存'));
    content.appendChild(btns);

    openModal(content);
  }

  // ========== 热点/选题 ==========
  async function trends(root) {
    root.innerHTML = '';
    root.appendChild(el('div', { class: 'page-title' }, '热点选题'));
    root.appendChild(el('div', { class: 'page-sub' }, '各平台热门话题，抓住流量风口'));

    // 热点平台优先级：小红书 > 抖音 > B站 > 微博 > 知乎 > 百度
    const platforms = HOT_TABS.map(id => {
      const p = PLATFORMS.find(x => x.id === id);
      return p ? { id: p.id, name: p.name } : { id, name: id };
    });
    let currentPlatform = 'xhs';

    // Tabs
    const tabs = el('div', { class: 'tabs' });
    platforms.forEach(p => {
      const tabEl = el('div', {
        class: 'tab' + (p.id === currentPlatform ? ' active' : ''),
        onclick: (e) => {
          currentPlatform = p.id;
          $$('.tab', tabs).forEach(t => t.classList.remove('active'));
          e.currentTarget.classList.add('active');
          loadTrends();
        }
      }, p.name);
      tabs.appendChild(tabEl);
    });
    root.appendChild(tabs);

    // 刷新按钮 + 数据状态
    const headerArea = el('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px', flexWrap: 'wrap', gap: '8px' } });
    const refreshBtn = el('button', { class: 'btn btn-ghost btn-sm', onclick: loadTrends }, '🔄 刷新热点');
    headerArea.appendChild(refreshBtn);
    const statusArea = el('div', { id: 'trends-status', class: 'text-xs text-muted' });
    headerArea.appendChild(statusArea);
    root.appendChild(headerArea);

    const listContainer = el('div', { id: 'trends-list' });
    root.appendChild(listContainer);

    async function loadTrends() {
      listContainer.innerHTML = '<div class="skeleton" style="height:60px"></div><div class="skeleton" style="height:60px"></div><div class="skeleton" style="height:60px"></div>';
      statusArea.innerHTML = '⏳ 正在拉取最新热点...';
      try {
        const result = await API.fetchHotTopics(currentPlatform);
        listContainer.innerHTML = '';
        
        // 显示数据来源和时间
        if (result.isReal) {
          statusArea.innerHTML = `✅ 实时数据 · 来源: ${result.source} · ${result.fetchTime}`;
          statusArea.style.color = '#10b981';
        } else {
          statusArea.innerHTML = `⚠️ <span style="color:#f59e0b">示例数据</span> · ${result.fetchTime} <a onclick="alert('${result.error}')" style="color:#3b82f6;cursor:pointer;margin-left:4px;">[原因]</a>`;
          statusArea.style.color = '#f59e0b';
        }
        
        if (result.items.length === 0) {
          listContainer.appendChild(el('div', { class: 'empty-state' }, [
            el('div', { class: 'empty-state-icon' }, '🔍'),
            el('div', {}, '暂无热点数据'),
          ]));
          return;
        }
        result.items.forEach((item, i) => {
          const card = el('div', { class: 'trend-card' }, [
            el('div', { class: 'trend-title' }, [
              el('span', { style: { color: i < 3 ? '#ef4444' : 'var(--muted)', fontWeight: '700', marginRight: '8px' } }, String(i + 1).padStart(2, '0')),
              item.title,
            ]),
            el('div', { class: 'trend-meta' }, [
              item.hot_score ? el('span', { class: 'trend-score' }, '🔥 ' + formatNum(item.hot_score)) : null,
              el('span', { class: 'text-xs text-muted' }, platformName(currentPlatform)),
            ]),
            item.desc ? el('div', { class: 'trend-desc', style: { fontSize: '13px', color: 'var(--muted)', lineHeight: '1.6', margin: '8px 0', padding: '8px 12px', background: 'var(--bg-soft)', borderRadius: '8px', borderLeft: '3px solid var(--primary)' } }, item.desc) : null,
            el('div', { class: 'trend-actions' }, [
              item.search_url ? el('a', { href: item.search_url, target: '_blank', class: 'btn btn-sm btn-ghost', style: { color: 'var(--primary)' } }, '🔍 看热门视频') : null,
              item.url && item.url !== item.search_url ? el('a', { href: item.url, target: '_blank', class: 'btn btn-sm btn-ghost' }, '↗ 原文') : null,
              el('button', { class: 'btn btn-sm btn-primary', onclick: () => saveAsTopic(item, currentPlatform) }, '💡 存为选题'),
            ]),
          ]);
          listContainer.appendChild(card);
        });
      } catch (e) {
        listContainer.innerHTML = '';
        statusArea.innerHTML = `❌ <span style="color:#ef4444">${e.message}</span>`;
        statusArea.style.color = '#ef4444';
        listContainer.appendChild(el('div', { class: 'empty-state' }, [
          el('div', { class: 'empty-state-icon' }, '⚠️'),
          el('div', {}, '获取热点失败'),
        ]));
      }
    }

    async function saveAsTopic(item, platform) {
      await DB.add('topics', {
        title: item.title,
        platform,
        source: 'hot',
        status: 'idea',
        rationale: `来自${platformName(platform)}热点榜第${item.rank}位`,
      });
      toast('已保存到选题库');
    }

    // 加载本地选题
    const topicCard = el('div', { class: 'card', style: { marginTop: '16px' } });
    topicCard.appendChild(el('div', { class: 'card-title' }, '我的选题'));
    const topicList = el('div', {});
    topicCard.appendChild(topicList);

    // 添加选题按钮
    const addTopicBtn = el('button', { class: 'btn btn-primary btn-sm', style: { marginTop: '8px' }, onclick: () => showAddTopic() }, '+ 新增选题');
    topicCard.appendChild(addTopicBtn);
    root.appendChild(topicCard);

    async function loadTopics() {
      const topics = await DB.getAll('topics');
      topicList.innerHTML = '';
      if (topics.length === 0) {
        topicList.appendChild(el('div', { class: 'text-xs text-muted', style: { padding: '12px 0' } }, '还没有选题，从热点中保存或手动添加'));
        return;
      }
      [...topics].reverse().slice(0, 10).forEach(t => {
        const statusMap = { idea: '💡 想法', planning: '📝 策划', producing: '🎬 制作', done: '✅ 已发' };
        topicList.appendChild(el('div', { class: 'list-item' }, [
          el('div', { class: 'li-main' }, [
            el('div', { class: 'li-title' }, t.title),
            el('div', { class: 'li-sub' }, (statusMap[t.status] || t.status) + (t.platform ? ' · ' + platformName(t.platform) : '')),
          ]),
          el('button', { class: 'btn btn-sm btn-ghost', onclick: () => deleteTopic(t.id) }, '🗑'),
        ]));
      });
    }

    function showAddTopic() {
      const content = el('div', {});
      content.appendChild(el('div', { class: 'page-title', style: { fontSize: '18px', marginBottom: '12px' } }, '新增选题'));
      const titleInput = el('input', { placeholder: '选题标题', style: { width: '100%', padding: '10px', border: '1px solid var(--rule)', borderRadius: '8px', marginBottom: '10px' } });
      content.appendChild(titleInput);
      const angleInput = el('textarea', { placeholder: '切入角度/思路(可选)', style: { width: '100%', minHeight: '80px', padding: '10px', border: '1px solid var(--rule)', borderRadius: '8px', resize: 'vertical' } });
      content.appendChild(angleInput);
      const btns = el('div', { class: 'flex', style: { gap: '8px', marginTop: '12px' } });
      btns.appendChild(el('button', { class: 'btn btn-ghost', style: { flex: '1' }, onclick: closeModal }, '取消'));
      btns.appendChild(el('button', { class: 'btn btn-primary', style: { flex: '2' }, onclick: async () => {
        const title = titleInput.value.trim();
        if (!title) return toast('请输入选题标题');
        await DB.add('topics', { title, angle: angleInput.value.trim(), status: 'idea', source: 'manual' });
        toast('选题已添加');
        closeModal();
        loadTopics();
      } }, '保存'));
      content.appendChild(btns);
      openModal(content);
    }

    async function deleteTopic(id) {
      if (!confirm('确定删除这个选题？')) return;
      await DB.del('topics', id);
      loadTopics();
    }

    loadTrends();
    loadTopics();
  }

  // ========== 灵感库 ==========
  async function inspirations(root) {
    root.innerHTML = '';
    root.appendChild(el('div', { class: 'page-title' }, '灵感库'));
    root.appendChild(el('div', { class: 'page-sub' }, '收藏视频/文章，AI自动归纳，随时激发创作灵感'));

    let categories = { tree: [], flat: [] };
    let currentMode = 'url';
    let currentCat1 = 0;
    let parsedData = null;
    let parseTags = [];
    const apiKey = await DB.getSetting('llm_api_key', '');

    async function loadCategories() {
      const all = await DB.getAll('categories');
      const tree = all.filter(c => c.parent_id === 0).map(c => ({
        ...c,
        children: all.filter(ch => ch.parent_id === c.id),
      }));
      categories = { tree, flat: all };
    }

    function renderInputArea() {
      const old = container.querySelector('.inspire-input-area');
      if (old) old.remove();

      const area = el('div', { class: 'inspire-input-area' });

      // Tabs
      const tabs = el('div', { class: 'inspire-tabs' });
      const urlTab = el('div', { class: 'inspire-tab' + (currentMode === 'url' ? ' active' : ''), onclick: () => { currentMode = 'url'; renderInputArea(); } }, '🔗 粘贴链接');
      const pasteTab = el('div', { class: 'inspire-tab' + (currentMode === 'paste' ? ' active' : ''), onclick: () => { currentMode = 'paste'; renderInputArea(); } }, '📝 手动粘贴');
      tabs.appendChild(urlTab);
      tabs.appendChild(pasteTab);
      area.appendChild(tabs);

      if (currentMode === 'url') {
        const row = el('div', { class: 'inspire-input-row' });
        const urlInput = el('input', { type: 'url', placeholder: '粘贴视频/文章链接，AI自动归纳', id: 'inspire-url' });
        const parseBtn = el('button', { class: 'btn btn-primary', onclick: async () => {
          const url = urlInput.value.trim();
          if (!url) return toast('请输入链接');
          parseBtn.disabled = true;
          parseBtn.textContent = '解析中…';
          try {
            const parsed = await API.parseUrl(url);
            parsedData = parsed;
            const ai = await API.aiSummarize(parsed.content, parsed.title, apiKey);
            parseTags = [...(ai.tags || [])];
            renderParseResult(parsed, ai);
          } catch (e) {
            toast(e.message);
            currentMode = 'paste';
            renderInputArea();
            const ta = document.getElementById('inspire-paste-text');
            if (ta) ta.placeholder = '平台有反爬限制，请在这里粘贴文案/逐字稿';
          } finally {
            parseBtn.disabled = false;
            parseBtn.textContent = '解析';
          }
        } }, '解析');
        row.appendChild(urlInput);
        row.appendChild(parseBtn);
        area.appendChild(row);
        area.appendChild(el('div', { class: 'text-xs text-muted', style: { marginTop: '8px' } }, '💡 抖音/小红书等平台可能因反爬无法自动抓取，会自动切换到手动粘贴'));
      } else {
        const paste = el('div', { class: 'inspire-paste' });
        paste.appendChild(el('textarea', { id: 'inspire-paste-text', placeholder: '在这里粘贴视频逐字稿、文章内容、文案等，AI会自动归纳' }));
        const meta = el('div', { class: 'inspire-paste-meta' });
        meta.appendChild(el('input', { id: 'inspire-manual-title', type: 'text', placeholder: '标题(选填)' }));
        meta.appendChild(el('input', { id: 'inspire-manual-author', type: 'text', placeholder: '作者(选填)' }));
        paste.appendChild(meta);
        const parseBtn = el('button', { class: 'btn btn-primary btn-block', style: { marginTop: '10px' }, onclick: async () => {
          const text = document.getElementById('inspire-paste-text').value.trim();
          if (!text) return toast('请粘贴内容');
          parseBtn.disabled = true;
          parseBtn.textContent = 'AI归纳中…';
          try {
            const title = document.getElementById('inspire-manual-title').value.trim();
            const author = document.getElementById('inspire-manual-author').value.trim();
            const parsed = { title, author, content: text, description: '', url: '' };
            parsedData = parsed;
            const ai = await API.aiSummarize(text, title, apiKey);
            parseTags = [...(ai.tags || [])];
            renderParseResult(parsed, ai);
          } catch (e) {
            toast('解析失败: ' + e.message);
          } finally {
            parseBtn.disabled = false;
            parseBtn.textContent = '🤖 AI归纳';
          }
        } }, '🤖 AI归纳');
        paste.appendChild(parseBtn);
        area.appendChild(paste);
      }

      const firstChild = container.firstChild;
      if (firstChild) container.insertBefore(area, firstChild);
      else container.appendChild(area);
    }

    function renderParseResult(parsed, ai) {
      const old = container.querySelector('.parse-result');
      if (old) old.remove();

      const result = el('div', { class: 'parse-result' });
      result.appendChild(el('div', { class: 'parse-result-title' }, '✨ AI归纳完成，确认后保存'));

      result.appendChild(el('label', {}, '标题'));
      result.appendChild(el('input', { id: 'pr-title', value: parsed.title || (ai.summary ? ai.summary.slice(0, 50) : '未命名') }));

      const metaRow = el('div', { class: 'field-row' });
      const authorWrap = el('div', {});
      authorWrap.appendChild(el('label', {}, '作者'));
      authorWrap.appendChild(el('input', { id: 'pr-author', value: parsed.author || '' }));
      metaRow.appendChild(authorWrap);
      const urlWrap = el('div', {});
      urlWrap.appendChild(el('label', {}, '原始链接'));
      urlWrap.appendChild(el('input', { id: 'pr-url', value: parsed.url || '' }));
      metaRow.appendChild(urlWrap);
      result.appendChild(metaRow);

      // 视频分类一/二
      const catRow = el('div', { class: 'field-row' });

      function buildCatSelector(labelText, isCat1, suggestedId) {
        const wrap = el('div', { class: 'cat-selector-wrap' });
        wrap.appendChild(el('label', {}, labelText));
        const inputRow = el('div', { class: 'cat-input-row' });
        const sel = el('select', { class: 'cat-select', id: isCat1 ? 'pr-cat1' : 'pr-cat2' });

        function refreshOptions() {
          sel.innerHTML = '';
          sel.appendChild(el('option', { value: '0' }, '未分类'));
          if (isCat1) {
            categories.tree.forEach(c => {
              const opt = el('option', { value: String(c.id) }, c.name);
              if (suggestedId === c.id) opt.selected = true;
              sel.appendChild(opt);
            });
          } else {
            const c1id = Number(document.getElementById('pr-cat1')?.value || 0);
            const parent = categories.tree.find(c => c.id === c1id);
            if (parent?.children) {
              parent.children.forEach(c => {
                const opt = el('option', { value: String(c.id) }, c.name);
                if (suggestedId === c.id) opt.selected = true;
                sel.appendChild(opt);
              });
            }
          }
        }

        const addBtn = el('button', { type: 'button', class: 'cat-add-btn', title: '添加新分类' }, '＋');
        addBtn.addEventListener('click', async () => {
          const name = prompt(isCat1 ? '输入新的视频分类一名称:' : '输入新的视频分类二名称:');
          if (!name || !name.trim()) return;
          try {
            const parentId = isCat1 ? 0 : Number(document.getElementById('pr-cat1')?.value || 0);
            if (!isCat1 && parentId === 0) { toast('请先选择视频分类一'); return; }
            const id = await DB.add('categories', { name: name.trim(), parent_id: parentId, sort_order: 0 });
            await loadCategories();
            refreshOptions();
            sel.value = String(id);
            renderCatBar();
            toast('已添加: ' + name.trim());
          } catch (e) { toast('添加失败: ' + e.message); }
        });

        inputRow.appendChild(sel);
        inputRow.appendChild(addBtn);
        wrap.appendChild(inputRow);
        wrap._refresh = refreshOptions;
        refreshOptions();
        return wrap;
      }

      const cat1Wrap = buildCatSelector('视频分类一', true, 0);
      const cat2Wrap = buildCatSelector('视频分类二', false, 0);
      catRow.appendChild(cat1Wrap);
      catRow.appendChild(cat2Wrap);
      result.appendChild(catRow);

      // 联动二级分类
      setTimeout(() => {
        const c1 = document.getElementById('pr-cat1');
        if (c1) c1.addEventListener('change', () => cat2Wrap._refresh());
      }, 0);

      // 内容类型
      const typeMap = { '口播视频': '🎤', '攻略教程': '📋', '图文文章': '📄', 'Vlog': '🎬', '评测': '🔍' };
      result.appendChild(el('label', {}, '内容类型'));
      const typeSel = el('select', { id: 'pr-type' });
      Object.entries(typeMap).forEach(([t, icon]) => {
        const opt = el('option', { value: t }, icon + ' ' + t);
        if (ai.content_type === t) opt.selected = true;
        typeSel.appendChild(opt);
      });
      result.appendChild(typeSel);

      result.appendChild(el('label', {}, 'AI摘要'));
      result.appendChild(el('textarea', { id: 'pr-summary' }, ai.summary || ''));

      if (ai.transcript) {
        result.appendChild(el('label', {}, '🎤 逐字稿整理'));
        result.appendChild(el('textarea', { id: 'pr-transcript', style: { minHeight: '80px' } }, ai.transcript));
      }
      if (ai.structured_content) {
        result.appendChild(el('label', {}, '📋 结构化内容'));
        result.appendChild(el('textarea', { id: 'pr-structured', style: { minHeight: '80px' } }, ai.structured_content));
      }

      if (parsed.content && parsed.content.length > 50) {
        const details = el('details', { style: { marginTop: '8px' } });
        details.appendChild(el('summary', { style: { fontSize: '12px', color: 'var(--muted)', cursor: 'pointer' } }, '查看原文/粘贴内容'));
        details.appendChild(el('div', { style: { marginTop: '6px', fontSize: '12px', color: 'var(--muted)', maxHeight: '120px', overflowY: 'auto', whiteSpace: 'pre-wrap', padding: '8px', background: '#fff', borderRadius: '6px' } }, parsed.content.slice(0, 2000)));
        result.appendChild(details);
      }

      // 标签
      result.appendChild(el('label', {}, '标签'));
      const tagWrap = el('div', { class: 'tag-input-wrap', id: 'pr-tags' });
      function renderTags() {
        tagWrap.innerHTML = '';
        parseTags.forEach((t, i) => {
          tagWrap.appendChild(el('span', { class: 'tag-chip' }, [
            t,
            el('span', { class: 'remove', onclick: () => { parseTags.splice(i, 1); renderTags(); } }, '×'),
          ]));
        });
        tagWrap.appendChild(el('input', { placeholder: parseTags.length ? '' : '输入标签后回车', onkeydown: (e) => {
          if (e.key === 'Enter' && e.target.value.trim()) {
            e.preventDefault();
            parseTags.push(e.target.value.trim());
            e.target.value = '';
            renderTags();
          }
        } }));
      }
      renderTags();
      result.appendChild(tagWrap);

      // 按钮
      const actions = el('div', { class: 'parse-result-actions' });
      actions.appendChild(el('button', { class: 'btn btn-ghost', style: { flex: '1' }, onclick: () => {
        parsedData = null; parseTags = []; result.remove();
      } }, '取消'));
      actions.appendChild(el('button', { class: 'btn btn-primary', style: { flex: '2' }, onclick: async () => {
        const title = document.getElementById('pr-title').value.trim() || '未命名';
        const cat1Id = Number(document.getElementById('pr-cat1').value) || 0;
        const cat2Id = Number(document.getElementById('pr-cat2').value) || 0;
        const body = {
          title,
          author: document.getElementById('pr-author').value.trim(),
          url: document.getElementById('pr-url').value.trim(),
          cat1_id: cat1Id,
          cat2_id: cat2Id,
          content_type: document.getElementById('pr-type').value,
          summary: document.getElementById('pr-summary').value.trim(),
          transcript: document.getElementById('pr-transcript') ? document.getElementById('pr-transcript').value.trim() : '',
          structured_content: document.getElementById('pr-structured') ? document.getElementById('pr-structured').value.trim() : '',
          tags: JSON.stringify(parseTags),
          is_favorite: 0,
        };
        await DB.add('inspirations', body);
        toast('已保存到灵感库');
        parsedData = null; parseTags = []; result.remove();
        const urlInp = document.getElementById('inspire-url');
        if (urlInp) urlInp.value = '';
        const pasteInp = document.getElementById('inspire-paste-text');
        if (pasteInp) pasteInp.value = '';
        renderCatBar();
        renderList();
      } }, '💾 保存到灵感库'));
      result.appendChild(actions);

      const inputArea = container.querySelector('.inspire-input-area');
      if (inputArea) inputArea.after(result);
      else container.appendChild(result);
      result.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    function renderCatBar() {
      const old = container.querySelector('.inspire-cat-bar');
      if (old) old.remove();
      const bar = el('div', { class: 'inspire-cat-bar' });

      bar.appendChild(el('span', { class: 'cat-chip' + (currentCat1 === 0 ? ' active' : ''), onclick: () => { currentCat1 = 0; renderCatBar(); renderList(); } }, '全部'));
      categories.tree.forEach(c => {
        bar.appendChild(el('span', { class: 'cat-chip' + (currentCat1 === c.id ? ' active' : ''), onclick: () => { currentCat1 = c.id; renderCatBar(); renderList(); } }, c.name));
      });
      bar.appendChild(el('span', { class: 'cat-chip add', onclick: showAddCategory }, '+ 管理分类'));

      const listArea = container.querySelector('.inspire-list');
      if (listArea) listArea.before(bar);
      else container.appendChild(bar);
    }

    function showAddCategory() {
      const content = el('div', {});
      content.appendChild(el('div', { class: 'page-title', style: { fontSize: '17px', marginBottom: '12px' } }, '管理分类'));

      content.appendChild(el('div', { style: { fontSize: '13px', fontWeight: '600', marginBottom: '8px' } }, '添加视频分类一'));
      const addCat1 = el('div', { class: 'cat-manage-row' });
      const cat1Input = el('input', { placeholder: '分类名称(如:旅行类)' });
      addCat1.appendChild(cat1Input);
      addCat1.appendChild(el('button', { class: 'btn btn-primary btn-sm', onclick: async () => {
        const name = cat1Input.value.trim();
        if (!name) return toast('请输入名称');
        await DB.add('categories', { name, parent_id: 0, sort_order: 0 });
        toast('已添加');
        await loadCategories();
        closeModal();
        showAddCategory();
        renderCatBar();
      } }, '添加'));
      content.appendChild(addCat1);

      content.appendChild(el('div', { style: { fontSize: '13px', fontWeight: '600', margin: '12px 0 8px' } }, '添加视频分类二'));
      const addCat2 = el('div', { class: 'cat-manage-row' });
      const parentSel = el('select', {});
      categories.tree.forEach(c => parentSel.appendChild(el('option', { value: String(c.id) }, c.name)));
      addCat2.appendChild(parentSel);
      const cat2Input = el('input', { placeholder: '子分类名称(如:口播)' });
      addCat2.appendChild(cat2Input);
      addCat2.appendChild(el('button', { class: 'btn btn-primary btn-sm', onclick: async () => {
        const name = cat2Input.value.trim();
        if (!name) return toast('请输入名称');
        await DB.add('categories', { name, parent_id: Number(parentSel.value), sort_order: 0 });
        toast('已添加');
        await loadCategories();
        closeModal();
        showAddCategory();
        renderCatBar();
      } }, '添加'));
      content.appendChild(addCat2);

      content.appendChild(el('div', { style: { fontSize: '13px', fontWeight: '600', margin: '16px 0 8px' } }, '现有分类'));
      categories.tree.forEach(c => {
        const row = el('div', { class: 'cat-manage-row' });
        row.appendChild(el('span', { style: { flex: '1', fontWeight: '600' } }, '📁 ' + c.name));
        row.appendChild(el('button', { class: 'btn btn-sm btn-ghost', onclick: async () => {
          if (confirm(`删除分类"${c.name}"？该分类下的卡片将变为未分类`)) {
            // 删除子分类
            const children = categories.flat.filter(ch => ch.parent_id === c.id);
            for (const ch of children) { await DB.del('categories', ch.id); }
            await DB.del('categories', c.id);
            await loadCategories(); closeModal(); showAddCategory(); renderCatBar();
          }
        } }, '🗑'));
        content.appendChild(row);
        (c.children || []).forEach(child => {
          const crow = el('div', { class: 'cat-manage-row', style: { paddingLeft: '16px' } });
          crow.appendChild(el('span', { style: { flex: '1', color: 'var(--muted)' } }, '└ ' + child.name));
          crow.appendChild(el('button', { class: 'btn btn-sm btn-ghost', onclick: async () => {
            if (confirm(`删除分类"${child.name}"？`)) {
              await DB.del('categories', child.id);
              await loadCategories(); closeModal(); showAddCategory(); renderCatBar();
            }
          } }, '🗑'));
          content.appendChild(crow);
        });
      });

      content.appendChild(el('button', { class: 'btn btn-ghost btn-block', style: { marginTop: '12px' }, onclick: closeModal }, '完成'));
      openModal(content);
    }

    async function renderList() {
      let listArea = container.querySelector('.inspire-list');
      if (!listArea) {
        listArea = el('div', { class: 'inspire-list' });
        container.appendChild(listArea);
      }
      listArea.innerHTML = '<div class="skeleton" style="height:80px"></div>';

      let items = await DB.getAll('inspirations');
      items.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
      if (currentCat1) items = items.filter(i => i.cat1_id === currentCat1);

      listArea.innerHTML = '';
      if (items.length === 0) {
        listArea.appendChild(el('div', { class: 'empty-state' }, [
          el('div', { class: 'empty-state-icon' }, '💡'),
          el('div', {}, currentCat1 ? '该分类下还没有灵感' : '还没有收藏任何内容'),
          el('div', { class: 'text-xs text-muted', style: { marginTop: '8px' } }, '粘贴链接或手动粘贴内容，AI会自动归纳成卡片'),
        ]));
        return;
      }

      const typeLabels = { '口播视频': ['🎤 口播', 'video'], '攻略教程': ['📋 教程', 'tutorial'], '图文文章': ['📄 文章', 'article'], 'Vlog': ['🎬 Vlog', 'video'], '评测': ['🔍 评测', 'article'] };

      // 构建分类名映射
      const catMap = {};
      categories.flat.forEach(c => { catMap[c.id] = c.name; });

      items.forEach(item => {
        const [typeText, typeClass] = typeLabels[item.content_type] || ['📄 文章', 'article'];
        const tags = item.tags ? (typeof item.tags === 'string' ? JSON.parse(item.tags) : item.tags) : [];

        const card = el('div', { class: 'inspire-card' });
        const header = el('div', { class: 'inspire-card-header' });
        header.appendChild(el('div', { class: 'inspire-card-title' }, item.title));
        const fav = el('span', { class: 'inspire-card-fav' + (item.is_favorite ? ' active' : ''), onclick: async (e) => {
          e.stopPropagation();
          await DB.put('inspirations', { ...item, is_favorite: item.is_favorite ? 0 : 1 });
          renderList();
        } }, item.is_favorite ? '★' : '☆');
        header.appendChild(fav);
        card.appendChild(header);

        const meta = el('div', { class: 'inspire-card-meta' });
        meta.appendChild(el('span', { class: 'content-type-badge ' + typeClass }, typeText));
        const catParts = [];
        if (item.cat1_id && catMap[item.cat1_id]) catParts.push(catMap[item.cat1_id]);
        if (item.cat2_id && catMap[item.cat2_id]) catParts.push(catMap[item.cat2_id]);
        if (catParts.length) meta.appendChild(el('span', { class: 'tag' }, catParts.join(' / ')));
        if (item.author) meta.appendChild(el('span', { class: 'text-xs text-muted' }, '👤 ' + item.author));
        meta.appendChild(el('span', { class: 'text-xs text-muted' }, formatDate(item.created_at)));
        card.appendChild(meta);

        if (item.summary) card.appendChild(el('div', { class: 'inspire-card-summary' }, item.summary));

        if (tags.length) {
          const tagsWrap = el('div', { class: 'inspire-card-tags' });
          tags.forEach(t => tagsWrap.appendChild(el('span', { class: 'tag gray' }, '#' + t)));
          card.appendChild(tagsWrap);
        }

        let expanded = false;
        const expandBtn = el('button', { class: 'btn btn-sm btn-ghost', style: { fontSize: '12px', padding: '4px 8px' }, onclick: (e) => {
          e.stopPropagation();
          expanded = !expanded;
          detailArea.style.display = expanded ? 'block' : 'none';
          expandBtn.textContent = expanded ? '收起 ▲' : '查看详情 ▼';
        } }, '查看详情 ▼');
        card.appendChild(expandBtn);

        const detailArea = el('div', { style: { display: 'none' } });
        if (item.transcript) {
          const sec = el('div', { class: 'inspire-card-section' });
          sec.appendChild(el('div', { class: 'inspire-card-section-title' }, '🎤 逐字稿'));
          sec.appendChild(el('div', { class: 'inspire-card-content' }, item.transcript));
          detailArea.appendChild(sec);
        }
        if (item.structured_content) {
          const sec = el('div', { class: 'inspire-card-section' });
          sec.appendChild(el('div', { class: 'inspire-card-section-title' }, '📋 结构化内容'));
          sec.appendChild(el('div', { class: 'inspire-card-content' }, item.structured_content));
          detailArea.appendChild(sec);
        }
        card.appendChild(detailArea);

        const actions = el('div', { class: 'inspire-card-actions' });
        if (item.url) actions.appendChild(el('a', { href: item.url, target: '_blank', rel: 'noopener', class: 'btn btn-sm btn-ghost' }, '↗ 原文'));
        actions.appendChild(el('button', { class: 'btn btn-sm btn-ghost', onclick: async (e) => {
          e.stopPropagation();
          // 转为选题
          await DB.add('topics', { title: item.title, angle: item.summary, source: 'inspiration', status: 'idea', platform: '' });
          toast('已转为选题');
        } }, '💡 转选题'));
        actions.appendChild(el('button', { class: 'btn btn-sm btn-ghost', onclick: async (e) => {
          e.stopPropagation();
          if (confirm('确定删除这张灵感卡片？')) {
            await DB.del('inspirations', item.id);
            toast('已删除');
            renderList();
          }
        } }, '🗑 删除'));
        card.appendChild(actions);

        listArea.appendChild(card);
      });
    }

    const container = el('div', {});
    root.appendChild(container);

    await loadCategories();
    renderInputArea();
    renderCatBar();
    renderList();
  }

  // ========== 日记 ==========
  async function diary(root) {
    root.innerHTML = '';
    root.appendChild(el('div', { class: 'page-title' }, '创作日记'));
    root.appendChild(el('div', { class: 'page-sub' }, '记录每天的创作心得与感悟'));

    const todayStr = today();
    let entries = await DB.getAll('diary');
    let currentEntry = entries.find(e => e.date === todayStr) || { date: todayStr, mood: 3, content: '', tags: '', weather: '' };

    // 心情选择
    const moodRow = el('div', { style: { display: 'flex', gap: '8px', marginBottom: '12px', justifyContent: 'center' } });
    [1, 2, 3, 4, 5].forEach(m => {
      const btn = el('button', {
        class: 'mood-btn' + (currentEntry.mood === m ? ' active' : ''),
        style: { fontSize: '28px', padding: '8px', borderRadius: '12px', border: currentEntry.mood === m ? '2px solid var(--primary)' : '2px solid transparent', background: currentEntry.mood === m ? 'var(--primary-light)' : 'transparent', cursor: 'pointer' },
        onclick: () => {
          currentEntry.mood = m;
          $$('.mood-btn', moodRow).forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          btn.style.border = '2px solid var(--primary)';
          btn.style.background = 'var(--primary-light)';
          $$('.mood-btn', moodRow).forEach(b => { if (b !== btn) { b.style.border = '2px solid transparent'; b.style.background = 'transparent'; } });
        }
      }, moodEmoji(m));
      moodRow.appendChild(btn);
    });
    root.appendChild(moodRow);

    // 天气输入
    const weatherWrap = el('div', { class: 'field' });
    weatherWrap.appendChild(el('label', {}, '天气/心情关键词'));
    const weatherInput = el('input', { id: 'diary-weather', placeholder: '如: ☀️ 晴朗 心情好', value: currentEntry.weather || '' });
    weatherWrap.appendChild(weatherInput);
    root.appendChild(weatherWrap);

    // 日记内容
    const contentWrap = el('div', { class: 'field' });
    contentWrap.appendChild(el('label', {}, '今日记录'));
    const contentArea = el('textarea', { id: 'diary-content', placeholder: '今天做了什么？有什么创作灵感？遇到了什么问题？...', style: { minHeight: '150px' } });
    contentArea.value = currentEntry.content || '';
    contentWrap.appendChild(contentArea);
    root.appendChild(contentWrap);

    // 标签
    const tagWrap = el('div', { class: 'field' });
    tagWrap.appendChild(el('label', {}, '标签(逗号分隔)'));
    const tagInput = el('input', { id: 'diary-tags', placeholder: '如: 拍摄,剪辑,灵感', value: currentEntry.tags || '' });
    tagWrap.appendChild(tagInput);
    root.appendChild(tagWrap);

    // 保存按钮
    root.appendChild(el('button', { class: 'btn btn-primary btn-block', onclick: async () => {
      const body = {
        date: todayStr,
        mood: currentEntry.mood,
        weather: weatherInput.value.trim(),
        content: contentArea.value.trim(),
        tags: tagInput.value.trim(),
      };
      if (currentEntry.id) {
        await DB.put('diary', { ...currentEntry, ...body, updated_at: new Date().toISOString() });
      } else {
        await DB.add('diary', body);
      }
      toast('日记已保存');
      loadHistory();
    } }, '💾 保存日记'));

    // 历史记录
    const histCard = el('div', { class: 'card', style: { marginTop: '16px' } });
    histCard.appendChild(el('div', { class: 'card-title' }, '历史日记'));
    const histList = el('div', { id: 'diary-history' });
    histCard.appendChild(histList);
    root.appendChild(histCard);

    async function loadHistory() {
      entries = await DB.getAll('diary');
      entries.sort((a, b) => b.date.localeCompare(a.date));
      histList.innerHTML = '';
      if (entries.length === 0) {
        histList.appendChild(el('div', { class: 'text-xs text-muted', style: { padding: '12px 0' } }, '还没有日记记录'));
        return;
      }
      entries.filter(e => e.date !== todayStr).forEach(e => {
        histList.appendChild(el('div', { class: 'list-item', onclick: () => showDiaryDetail(e) }, [
          el('span', { style: { fontSize: '20px' } }, moodEmoji(e.mood)),
          el('div', { class: 'li-main' }, [
            el('div', { class: 'li-title' }, e.date + (e.weather ? ' · ' + e.weather : '')),
            el('div', { class: 'li-sub' }, (e.content || '').slice(0, 50) + ((e.content || '').length > 50 ? '...' : '')),
          ]),
        ]));
      });
    }

    function showDiaryDetail(entry) {
      const content = el('div', {});
      content.appendChild(el('div', { style: { fontSize: '24px', textAlign: 'center', marginBottom: '8px' } }, moodEmoji(entry.mood)));
      content.appendChild(el('div', { class: 'page-title', style: { fontSize: '16px', textAlign: 'center' } }, entry.date + (entry.weather ? ' · ' + entry.weather : '')));
      if (entry.tags) {
        const tagsDiv = el('div', { style: { margin: '8px 0' } });
        entry.tags.split(/[,，]/).filter(Boolean).forEach(t => {
          tagsDiv.appendChild(el('span', { class: 'tag gray', style: { marginRight: '4px' } }, '#' + t.trim()));
        });
        content.appendChild(tagsDiv);
      }
      content.appendChild(el('div', { style: { whiteSpace: 'pre-wrap', lineHeight: '1.8', fontSize: '14px', color: 'var(--ink-2)' } }, entry.content || '(无内容)'));
      const btns = el('div', { class: 'flex', style: { gap: '8px', marginTop: '16px' } });
      btns.appendChild(el('button', { class: 'btn btn-ghost', style: { flex: '1' }, onclick: closeModal }, '关闭'));
      btns.appendChild(el('button', { class: 'btn btn-ghost', style: { color: 'var(--danger)' }, onclick: async () => {
        if (confirm('确定删除这篇日记？')) { await DB.del('diary', entry.id); closeModal(); loadHistory(); toast('已删除'); }
      } }, '🗑 删除'));
      content.appendChild(btns);
      openModal(content);
    }

    loadHistory();
  }

  // ========== 设置/导出 ==========
  async function settings(root) {
    root.innerHTML = '';
    // 返回按钮
    const backBar = el('div', { style: { display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '12px' } }, [
      el('button', { class: 'btn btn-ghost btn-sm', onclick: () => window.__navigate('dashboard') }, '← 返回'),
    ]);
    root.appendChild(backBar);
    root.appendChild(el('div', { class: 'page-title' }, '设置'));
    root.appendChild(el('div', { class: 'page-sub' }, '配置你的创作工作台'));

    const s = await DB.getAllSettings();

    // AI配置
    const aiCard = el('div', { class: 'card' });
    aiCard.appendChild(el('div', { class: 'card-title' }, '🤖 AI归纳 (DeepSeek)'));
    aiCard.appendChild(el('div', { class: 'text-xs text-muted', style: { marginBottom: '8px' } }, '配置后可使用AI自动归纳内容、提取摘要、整理逐字稿。DeepSeek注册即送免费额度。'));
    const aiKeyInput = el('input', { type: 'password', id: 'set-llm', value: s.llm_api_key || '', placeholder: 'sk-xxxxxxxxxxxxxxxx' });
    aiCard.appendChild(aiKeyInput);
    aiCard.appendChild(el('a', { href: 'https://platform.deepseek.com/', target: '_blank', class: 'text-xs', style: { color: 'var(--primary)', display: 'block', marginTop: '4px' } }, '👉 获取API Key (platform.deepseek.com)'));
    root.appendChild(aiCard);

    // B站配置
    const biliCard = el('div', { class: 'card' });
    biliCard.appendChild(el('div', { class: 'card-title' }, '📺 B站数据同步'));
    biliCard.appendChild(el('div', { class: 'text-xs text-muted', style: { marginBottom: '8px' } }, '配置SESSDATA后可一键同步B站创作数据'));
    const biliInput = el('input', { type: 'password', id: 'set-bili', value: s.bilibili_sessdata || '', placeholder: '粘贴SESSDATA值' });
    biliCard.appendChild(biliInput);
    const helpBox = el('details', { style: { marginTop: '8px' } });
    helpBox.appendChild(el('summary', { style: { fontSize: '12px', color: 'var(--muted)', cursor: 'pointer' } }, '❓ 如何获取SESSDATA？'));
    const helpSteps = el('div', { style: { marginTop: '6px', fontSize: '12px', color: 'var(--muted)', lineHeight: '1.8', padding: '10px', background: 'var(--bg)', borderRadius: '8px' } });
    helpSteps.innerHTML = `
      <div><b>步骤1:</b> 在电脑浏览器打开 <a href="https://www.bilibili.com" target="_blank" style="color:var(--primary)">bilibili.com</a> 并登录</div>
      <div><b>步骤2:</b> 按 F12 打开开发者工具 → 切换到 "Application"(应用) 标签</div>
      <div><b>步骤3:</b> 左侧找到 "Cookies" → 点击 "https://www.bilibili.com"</div>
      <div><b>步骤4:</b> 在列表中找到 <b>SESSDATA</b>，复制它的Value值</div>
      <div style="color:#ef4444;margin-top:4px"><b>⚠️</b> SESSDATA相当于登录凭证，请勿分享给他人</div>
    `;
    helpBox.appendChild(helpSteps);
    biliCard.appendChild(helpBox);
    root.appendChild(biliCard);

    // 飞书配置
    const fsCard = el('div', { class: 'card' });
    fsCard.appendChild(el('div', { class: 'card-title' }, '📄 飞书文档导出'));
    fsCard.appendChild(el('div', { class: 'text-xs text-muted', style: { marginBottom: '8px' } }, '配置后可将数据一键导出为飞书文档'));
    const fsIdInput = el('input', { id: 'set-fs-id', value: s.feishu_app_id || '', placeholder: 'App ID (cli_xxxxxxxx)' });
    fsCard.appendChild(fsIdInput);
    const fsSecretInput = el('input', { type: 'password', id: 'set-fs-secret', value: s.feishu_app_secret || '', placeholder: 'App Secret', style: { marginTop: '8px' } });
    fsCard.appendChild(fsSecretInput);
    const fsFolderInput = el('input', { id: 'set-fs-folder', value: s.feishu_folder_token || '', placeholder: '文件夹Token(可选)', style: { marginTop: '8px' } });
    fsCard.appendChild(fsFolderInput);
    root.appendChild(fsCard);

    // WebDAV云同步配置（坚果云）
    root.appendChild(WebDAV.renderSettings());

    // 账号定位
    const profileCard = el('div', { class: 'card' });
    profileCard.appendChild(el('div', { class: 'card-title' }, '🎯 账号定位'));
    profileCard.appendChild(el('div', { class: 'text-xs text-muted', style: { marginBottom: '8px' } }, '帮助AI更好地推荐选题方向'));
    const bioArea = el('textarea', { id: 'set-bio', placeholder: '简单介绍你的账号，如:旅行博主，专注小众目的地攻略，正在转型AI+成长方向', style: { minHeight: '60px' } });
    try { const archive = s.archive ? JSON.parse(s.archive) : {}; bioArea.value = archive.bio || ''; } catch {}
    profileCard.appendChild(bioArea);
    root.appendChild(profileCard);

    // 数据管理
    const dataCard = el('div', { class: 'card' });
    dataCard.appendChild(el('div', { class: 'card-title' }, '💾 数据管理'));
    const btnRow1 = el('div', { class: 'flex', style: { gap: '8px', flexWrap: 'wrap' } });
    btnRow1.appendChild(el('button', { class: 'btn btn-primary', style: { flex: '1' }, onclick: async () => {
      const data = await DB.exportAll();
      const date = new Date().toISOString().slice(0, 10);
      downloadFile(`创作工作台备份_${date}.json`, JSON.stringify(data, null, 2), 'application/json');
      toast('数据已导出');
    } }, '📤 导出备份'));
    btnRow1.appendChild(el('button', { class: 'btn btn-ghost', style: { flex: '1' }, onclick: () => {
      const input = el('input', { type: 'file', accept: '.json' });
      input.onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        try {
          const text = await file.text();
          const data = JSON.parse(text);
          if (confirm('导入将覆盖现有数据，确定继续？')) {
            await DB.importAll(data);
            toast('数据已导入，刷新页面生效');
            setTimeout(() => location.reload(), 1000);
          }
        } catch (err) {
          toast('导入失败: ' + err.message);
        }
      };
      input.click();
    } }, '📥 导入备份'));
    dataCard.appendChild(btnRow1);

    const btnRow2 = el('div', { class: 'flex', style: { gap: '8px', marginTop: '8px' } });
    btnRow2.appendChild(el('button', { class: 'btn btn-ghost', style: { flex: '1' }, onclick: () => exportMarkdown() }, '📝 导出Markdown'));
    btnRow2.appendChild(el('button', { class: 'btn btn-ghost', style: { flex: '1', color: 'var(--danger)' }, onclick: async () => {
      if (confirm('确定清空所有数据？此操作不可恢复！建议先导出备份。')) {
        const stores = ['metrics', 'trends', 'topics', 'diary', 'inspirations', 'voice_log'];
        for (const s of stores) await DB.clear(s);
        toast('数据已清空');
        location.reload();
      }
    } }, '🗑 清空数据'));
    dataCard.appendChild(btnRow2);
    root.appendChild(dataCard);

    // 保存按钮
    root.appendChild(el('button', { class: 'btn btn-primary btn-block', style: { marginTop: '16px' }, onclick: async () => {
      try { const archive = JSON.parse(s.archive || '{}'); archive.bio = bioArea.value; await DB.setSetting('archive', JSON.stringify(archive)); } catch { await DB.setSetting('archive', JSON.stringify({ bio: bioArea.value })); }
      await DB.setSetting('llm_api_key', aiKeyInput.value.trim());
      await DB.setSetting('bilibili_sessdata', biliInput.value.trim());
      await DB.setSetting('feishu_app_id', fsIdInput.value.trim());
      await DB.setSetting('feishu_app_secret', fsSecretInput.value.trim());
      await DB.setSetting('feishu_folder_token', fsFolderInput.value.trim());
      toast('设置已保存');
    } }, '💾 保存所有设置'));

    // 关于
    const aboutCard = el('div', { class: 'card' });
    aboutCard.appendChild(el('div', { class: 'card-title' }, 'ℹ️ 关于'));
    aboutCard.appendChild(el('div', { class: 'text-xs text-muted', style: { lineHeight: '1.8' } }, [
      '创作工作台 PWA v1.0',
      el('br'),
      '数据全部存储在你的浏览器本地，不会上传到任何服务器。',
      el('br'),
      '添加到主屏幕后可像App一样离线使用。',
    ]));
    root.appendChild(aboutCard);
  }

  async function exportMarkdown() {
    const inspirations = await DB.getAll('inspirations');
    const topics = await DB.getAll('topics');
    const diaries = await DB.getAll('diary');
    const metrics = await DB.getAll('metrics');

    let md = `# 创作工作台导出\n\n导出时间: ${new Date().toLocaleString('zh-CN')}\n\n`;

    if (inspirations.length) {
      md += `## 💡 灵感库 (${inspirations.length}条)\n\n`;
      const cats = await DB.getAll('categories');
      const catMap = {};
      cats.forEach(c => { catMap[c.id] = c.name; });
      inspirations.forEach(i => {
        const cat1 = i.cat1_id ? catMap[i.cat1_id] : '';
        const cat2 = i.cat2_id ? '/' + catMap[i.cat2_id] : '';
        md += `### ${i.title}\n\n`;
        md += `- 类型: ${i.content_type || '未分类'}\n`;
        if (cat1) md += `- 分类: ${cat1}${cat2}\n`;
        if (i.author) md += `- 作者: ${i.author}\n`;
        if (i.url) md += `- 链接: ${i.url}\n`;
        if (i.summary) md += `\n${i.summary}\n`;
        if (i.transcript) md += `\n**逐字稿:**\n\n${i.transcript}\n`;
        if (i.structured_content) md += `\n**结构化内容:**\n\n${i.structured_content}\n`;
        md += '\n---\n\n';
      });
    }

    if (topics.length) {
      md += `## 🎯 选题库 (${topics.length}条)\n\n`;
      topics.forEach(t => {
        md += `- [${t.status || 'idea'}] **${t.title}**`;
        if (t.angle) md += ` - ${t.angle}`;
        md += '\n';
      });
      md += '\n';
    }

    if (diaries.length) {
      md += `## 📔 日记 (${diaries.length}篇)\n\n`;
      diaries.sort((a, b) => b.date.localeCompare(a.date)).forEach(d => {
        md += `### ${d.date} ${moodEmoji(d.mood)}\n\n`;
        if (d.weather) md += `天气/心情: ${d.weather}\n\n`;
        if (d.content) md += `${d.content}\n\n`;
        if (d.tags) md += `标签: ${d.tags}\n\n`;
      });
    }

    downloadFile(`创作工作台_${today()}.md`, md, 'text/markdown');
    toast('Markdown已导出，可直接导入Obsidian');
  }

  return { dashboard, trends, inspirations, diary, settings };
})();
/**
 * 创作工作台 PWA - 主应用
 */
(function() {
  const { $, $$, el, toast, openModal, closeModal } = Utils;

  const pages = [
    { id: 'dashboard', name: '数据', icon: '📊' },
    { id: 'trends', name: '热点', icon: '🔥' },
    { id: 'inspirations', name: '灵感', icon: '💡' },
    { id: 'mindmap', name: '知识', icon: '🧠' },
    { id: 'diary', name: '日记', icon: '📔' },
  ];

  let currentPage = 'dashboard';

  async function init() {
    // 初始化数据库
    await DB.open();
    await DB.initDefaults();

    // 构建UI
    buildTopBar();
    buildPages();
    buildBottomNav();
    buildVoiceFab();

    // 导航到默认页
    navigate('dashboard');

    // 注册Service Worker（v10安全版：绝对不自动刷新）
    if ('serviceWorker' in navigator) {
      const swUrl = (window.BASE_PATH || '/') + 'sw.js?v=10';
      
      navigator.serviceWorker.register(swUrl, { scope: window.BASE_PATH || '/' })
        .then(reg => {
          console.log('SW注册成功，scope:', reg.scope);
          
          // 检测到新版本正在安装
          reg.addEventListener('updatefound', () => {
            const newWorker = reg.installing;
            newWorker.addEventListener('statechange', () => {
              if (newWorker.state === 'installed') {
                if (navigator.serviceWorker.controller) {
                  // 有新版本等待激活 - 只提示，不自动刷新
                  Utils.toast('✨ 发现新版本，关闭所有标签页后重新打开即可更新');
                  console.log('SW新版本已安装，等待下次打开时激活');
                } else {
                  // 首次安装SW，离线缓存已就绪
                  console.log('SW首次安装完成，支持离线使用');
                }
              }
            });
          });
          
          // 注意：移除了controllerchange自动刷新逻辑，彻底杜绝无限刷新
          // 新版本不会自动激活（sw.js中没有skipWaiting），需要用户手动刷新后才会生效
        })
        .catch((e) => { console.warn('SW注册失败(不影响使用):', e); });
    }

    // PWA安装提示
    let deferredPrompt;
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      deferredPrompt = e;
      // 显示安装提示
      setTimeout(() => showInstallBanner(deferredPrompt), 3000);
    });
  }

  function buildTopBar() {
    const topBar = el('div', { class: 'top-bar' });
    const inner = el('div', { class: 'top-bar-inner' });
    inner.appendChild(el('div', { class: 'logo' }, [
      el('div', { class: 'logo-mark' }),
      el('span', { class: 'logo-text' }, '创作工作台'),
    ]));
    inner.appendChild(el('button', { class: 'icon-btn', title: '设置', onclick: () => navigate('settings') }, '⚙️'));
    topBar.appendChild(inner);
    document.body.appendChild(topBar);
  }

  function buildPages() {
    const container = el('div', { class: 'pages', id: 'pages-container' });
    // 为所有页面（包括底部导航和设置页）创建容器
    const allPages = [...pages, { id: 'settings' }];
    allPages.forEach(p => {
      const page = el('div', { class: 'page', id: 'page-' + p.id });
      container.appendChild(page);
    });
    document.body.appendChild(container);
  }

  function buildBottomNav() {
    const nav = el('div', { class: 'bottom-nav' });
    pages.forEach(p => {
      const item = el('div', {
        class: 'nav-item' + (p.id === currentPage ? ' active' : ''),
        'data-page': p.id,
        onclick: () => navigate(p.id),
      }, [
        el('span', { style: { fontSize: '22px' } }, p.icon),
        el('span', {}, p.name),
      ]);
      nav.appendChild(item);
    });
    document.body.appendChild(nav);
  }

  function buildVoiceFab() {
    const fab = el('button', { class: 'fab-voice', title: '语音助手', onclick: openVoiceHelper }, '🎙️');
    document.body.appendChild(fab);
  }

  async function navigate(pageId) {
    currentPage = pageId;

    // 更新导航状态
    $$('.nav-item').forEach(item => {
      item.classList.toggle('active', item.dataset.page === pageId);
    });

    // 获取或创建页面容器
    let container = document.getElementById('page-' + pageId);
    if (!container) {
      const pagesContainer = document.getElementById('pages-container');
      container = el('div', { class: 'page', id: 'page-' + pageId });
      pagesContainer.appendChild(container);
    }
    container.innerHTML = '<div class="skeleton" style="height:60px"></div><div class="skeleton" style="height:60px"></div>';
    container.classList.add('active');

    // 隐藏其他页面（包括settings）
    const allPageIds = [...pages.map(p => p.id), 'settings'];
    allPageIds.forEach(pid => {
      if (pid !== pageId) {
        const pageEl = document.getElementById('page-' + pid);
        if (pageEl) pageEl.classList.remove('active');
      }
    });

    // 渲染对应页面
    if (pageId === 'mindmap') {
      try {
        await MindMap.renderPage(container);
      } catch (e) {
        console.error('页面渲染错误:', e);
        container.innerHTML = `<div class="empty-state"><div class="empty-state-icon">⚠️</div><div>页面加载失败</div><div class="text-xs text-muted" style="margin-top:8px">${e.message}</div></div>`;
      }
    } else if (pageId === 'settings') {
      try {
        await Pages.settings(container);
      } catch (e) {
        console.error('页面渲染错误:', e);
        container.innerHTML = `<div class="empty-state"><div class="empty-state-icon">⚠️</div><div>页面加载失败</div><div class="text-xs text-muted" style="margin-top:8px">${e.message}</div></div>`;
      }
    } else {
      const pageFn = Pages[pageId];
      if (pageFn) {
        try {
          await pageFn(container);
        } catch (e) {
          console.error('页面渲染错误:', e);
          container.innerHTML = `<div class="empty-state"><div class="empty-state-icon">⚠️</div><div>页面加载失败</div><div class="text-xs text-muted" style="margin-top:8px">${e.message}</div></div>`;
        }
      }
    }

    // 滚动到顶部
    window.scrollTo(0, 0);
  }

  // 语音助手
  function openVoiceHelper() {
    const content = el('div', {});
    content.appendChild(el('div', { class: 'page-title', style: { fontSize: '18px', marginBottom: '12px' } }, '🎙️ 语音助手'));

    const status = el('div', { id: 'voice-status', style: { textAlign: 'center', padding: '20px', fontSize: '14px', color: 'var(--muted)' } }, '点击下方按钮开始说话');
    content.appendChild(status);

    const textArea = el('textarea', { id: 'voice-text', placeholder: '语音识别结果会显示在这里，也可以直接输入文字', style: { width: '100%', minHeight: '100px', padding: '12px', border: '1px solid var(--rule)', borderRadius: 'var(--radius-sm)', fontSize: '14px', resize: 'vertical', marginBottom: '12px' } });
    content.appendChild(textArea);

    let recognition = null;
    let isListening = false;

    const micBtn = el('button', {
      class: 'btn btn-primary btn-block',
      style: { marginBottom: '8px', padding: '14px', fontSize: '16px' },
      onclick: () => {
        if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
          toast('你的浏览器不支持语音识别，请直接输入文字');
          return;
        }
        if (isListening) {
          recognition.stop();
          return;
        }
        const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
        recognition = new SR();
        recognition.lang = 'zh-CN';
        recognition.continuous = true;
        recognition.interimResults = true;

        recognition.onstart = () => {
          isListening = true;
          micBtn.textContent = '🛑 停止录音';
          status.textContent = '正在聆听...';
          status.style.color = 'var(--primary)';
        };

        recognition.onresult = (e) => {
          let finalText = '';
          let interimText = '';
          for (let i = e.resultIndex; i < e.results.length; i++) {
            if (e.results[i].isFinal) {
              finalText += e.results[i][0].transcript;
            } else {
              interimText += e.results[i][0].transcript;
            }
          }
          textArea.value = (textArea.value + finalText).trim();
          if (interimText) status.textContent = '正在识别: ' + interimText;
        };

        recognition.onerror = (e) => {
          status.textContent = '识别出错: ' + e.error;
          status.style.color = 'var(--danger)';
          isListening = false;
          micBtn.textContent = '🎙️ 开始说话';
        };

        recognition.onend = () => {
          isListening = false;
          micBtn.textContent = '🎙️ 开始说话';
          status.textContent = '识别完成，可以继续说话或执行操作';
          status.style.color = 'var(--muted)';
        };

        recognition.start();
      }
    }, '🎙️ 开始说话');
    content.appendChild(micBtn);

    // 快捷操作
    const quickActions = el('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginTop: '12px' } });
    const actions = [
      { label: '📊 看数据', page: 'dashboard' },
      { label: '🔥 看热点', page: 'trends' },
      { label: '💡 加灵感', page: 'inspirations' },
      { label: '📔 写日记', page: 'diary' },
    ];
    actions.forEach(a => {
      quickActions.appendChild(el('button', {
        class: 'btn btn-ghost btn-sm',
        onclick: () => { closeModal(); navigate(a.page); }
      }, a.label));
    });
    content.appendChild(quickActions);

    // 执行操作
    const actionBtn = el('button', {
      class: 'btn btn-primary btn-block',
      style: { marginTop: '12px' },
      onclick: () => {
        const text = textArea.value.trim();
        if (!text) return toast('请先说话或输入文字');
        // 简单的语音指令解析
        if (/数据|粉丝|播放|点赞/.test(text)) { closeModal(); navigate('dashboard'); }
        else if (/热点|选题|趋势|话题/.test(text)) { closeModal(); navigate('trends'); }
        else if (/灵感|收藏|素材|参考/.test(text)) { closeModal(); navigate('inspirations'); }
        else if (/日记|记录|心情|今天/.test(text)) { closeModal(); navigate('diary'); }
        else {
          // 记录到语音日志
          DB.add('voice_log', { raw_text: text, intent: 'unknown', action: '', payload: '' });
          toast('已记录，你可以在日记中查看');
          closeModal();
        }
      }
    }, '🚀 执行');
    content.appendChild(actionBtn);

    content.appendChild(el('button', { class: 'btn btn-ghost btn-block', style: { marginTop: '8px' }, onclick: closeModal }, '关闭'));

    openModal(content);
  }

  // PWA安装提示
  function showInstallBanner(deferredPrompt) {
    const banner = el('div', {
      style: 'position:fixed;bottom:80px;left:16px;right:16px;background:var(--bg-card);border:1px solid var(--rule);border-radius:12px;padding:12px;box-shadow:0 8px 24px rgba(0,0,0,0.15);z-index:60;display:flex;align-items:center;gap:10px;'
    }, [
      el('span', { style: 'font-size:24px' }, '📱'),
      el('div', { style: 'flex:1;font-size:13px' }, '添加到主屏幕，像App一样使用'),
      el('button', {
        class: 'btn btn-primary btn-sm',
        onclick: async () => {
          banner.remove();
          deferredPrompt.prompt();
          await deferredPrompt.userChoice;
        }
      }, '安装'),
      el('button', {
        class: 'btn-icon',
        style: 'font-size:18px',
        onclick: () => banner.remove()
      }, '×'),
    ]);
    document.body.appendChild(banner);
  }

  // 全局导航方法
  window.__navigate = navigate;

  // 启动
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
