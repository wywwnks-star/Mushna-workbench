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

    // 注册Service Worker（适配子路径部署）
    if ('serviceWorker' in navigator) {
      const swUrl = (window.BASE_PATH || '/') + 'sw.js';
      navigator.serviceWorker.register(swUrl, { scope: window.BASE_PATH || '/' }).catch(() => {});
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
