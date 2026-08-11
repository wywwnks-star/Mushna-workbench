/**
 * 外部API服务 - URL抓取、AI调用、热点获取
 * 全部通过浏览器直接调用，无需后端
 */
const API = (() => {
  const { el, toast, htmlToText, summarize } = Utils;

  // CORS代理列表（按优先级尝试）
  const CORS_PROXIES = [
    (url) => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
    (url) => `https://corsproxy.io/?${encodeURIComponent(url)}`,
    (url) => `https://cors.eu.org/${url}`,
  ];

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

    // 提取标题
    let title = '';
    const ogTitle = doc.querySelector('meta[property="og:title"]');
    if (ogTitle) title = ogTitle.getAttribute('content');
    if (!title) {
      const titleEl = doc.querySelector('title');
      if (titleEl) title = titleEl.textContent.trim();
    }
    title = (title || '').replace(/\s*[-–|_]\s*[^-–|_]*$/, '').trim();

    // 提取作者
    let author = '';
    const metaAuthor = doc.querySelector('meta[name="author"], meta[property="article:author"]');
    if (metaAuthor) author = metaAuthor.getAttribute('content') || '';

    // 提取正文
    let content = '';
    // 尝试article标签
    const article = doc.querySelector('article, .article-content, .post-content, .content, #content, .entry-content, .post-body');
    if (article) {
      content = article.innerText || article.textContent;
    } else {
      // 尝试提取所有p标签
      const paras = doc.querySelectorAll('p');
      content = Array.from(paras).map(p => p.textContent.trim()).filter(t => t.length > 20).join('\n\n');
    }
    content = content.trim().slice(0, 5000); // 限制长度

    // 提取描述
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
      // 无API Key时，返回简单摘要
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
        // 清理可能的markdown代码块
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

  // 简单关键词提取
  function extractTags(text, title) {
    const combined = (title + ' ' + text).toLowerCase();
    const keywords = ['旅行', '攻略', '美食', '摄影', 'vlog', '干货', '教程', '分享', '经验', '避坑', '推荐', 'ai', '成长', '副业', '自媒体', '效率', '工具', '感悟', '人生', '职场'];
    const found = keywords.filter(k => combined.includes(k.toLowerCase()));
    return found.length > 0 ? found.slice(0, 5) : ['灵感'];
  }

  // 猜测内容类型
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
   * 获取热点数据
   * 使用公开热榜API
   */
  async function fetchHotTopics(platform) {
    const sources = {
      xhs: [
        () => fetchJson('https://api.vvhan.com/api/hotlist/xiaohongshu'),
        () => fetchJson('https://api.oioweb.cn/api/common/HotList?type=xiaohongshu'),
      ],
      douyin: [
        () => fetchJson('https://api.vvhan.com/api/hotlist/douyinHot'),
        () => fetchJson('https://api.oioweb.cn/api/common/HotList?type=douyin'),
      ],
      bilibili: [
        () => fetchJson('https://api.vvhan.com/api/hotlist/bili'),
        () => fetchJson('https://api.bilibili.com/x/web-interface/popular?ps=20&pn=1'),
      ],
      weibo: [
        () => fetchJson('https://api.vvhan.com/api/hotlist/wbHot'),
        () => fetchJson('https://api.oioweb.cn/api/common/HotList?type=weibo'),
      ],
      zhihu: [
        () => fetchJson('https://api.vvhan.com/api/hotlist/zhihuHot'),
      ],
      baidu: [
        () => fetchJson('https://api.vvhan.com/api/hotlist/baiduRD'),
      ],
    };

    const fetchers = sources[platform] || [];
    for (const fn of fetchers) {
      try {
        const data = await fn();
        if (data && data.success !== false && (data.data || data.list || data.data?.list)) {
          return normalizeHotData(platform, data);
        }
      } catch (e) {
        console.warn(`获取${platform}热点失败:`, e.message);
        continue;
      }
    }
    // 返回空数组（不阻塞UI）
    return [];
  }

  async function fetchJson(url, timeout = 8000) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeout);
    try {
      // 对非B站API使用CORS代理
      const isBili = url.includes('bilibili.com');
      const targetUrl = isBili ? url : CORS_PROXIES[0](url);
      const res = await fetch(targetUrl, { signal: ctrl.signal });
      clearTimeout(timer);
      return res.json();
    } catch (e) {
      clearTimeout(timer);
      // 尝试第二个代理
      if (!url.includes('bilibili.com')) {
        try {
          const res2 = await fetch(CORS_PROXIES[1](url), { signal: AbortSignal.timeout(timeout) });
          return res2.json();
        } catch {}
      }
      throw e;
    }
  }

  function normalizeHotData(platform, data) {
    let items = [];
    if (data.data && Array.isArray(data.data)) items = data.data;
    else if (data.list && Array.isArray(data.list)) items = data.list;
    else if (data.data?.list && Array.isArray(data.data.list)) items = data.data.list;
    else if (data.data?.items) items = data.data.items;

    return items.slice(0, 15).map((item, i) => ({
      title: item.title || item.name || item.word || item.keyword || '',
      url: item.url || item.link || item.share_url || item.jump_url || '',
      hot_score: item.hot || item.score || item.heat || item.view || item.play || 0,
      cover: item.cover || item.pic || item.image || item.img || '',
      platform,
      rank: i + 1,
    })).filter(item => item.title);
  }

  /**
   * 飞书文档导出
   */
  async function exportToFeishu(content, title, appId, appSecret, folderToken) {
    if (!appId || !appSecret) {
      throw new Error('请先在设置中配置飞书应用凭证');
    }
    try {
      // 获取tenant_access_token
      const tokenRes = await fetch('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
      });
      const tokenData = await tokenRes.json();
      if (tokenData.code !== 0) throw new Error('飞书认证失败: ' + tokenData.msg);
      const token = tokenData.tenant_access_token;

      // 创建文档
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
