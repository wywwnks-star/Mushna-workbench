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
