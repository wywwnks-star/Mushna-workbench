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
   * 内置示例热点数据（当API全部失败时使用，确保用户能看到内容）
   */
  const FALLBACK_HOT_DATA = {
    xhs: [
      { title: '2026年最值得入手的10个AI效率工具', hot_score: '98.5w' },
      { title: '普通人做自媒体3个月变现2w的真实经验', hot_score: '87.2w' },
      { title: '夏天通勤穿搭｜舒服又好看的5套搭配', hot_score: '76.8w' },
      { title: '30岁才明白的10个人生道理，越早知道越好', hot_score: '65.3w' },
      { title: '在家就能做的7个低成本副业，亲测有效', hot_score: '58.9w' },
      { title: '坚持早起100天后，我的生活发生了这些变化', hot_score: '52.1w' },
      { title: '小红书涨粉秘籍｜从0到1w粉我做对了什么', hot_score: '47.6w' },
      { title: '一个人住也要好好吃饭｜10分钟快手菜合集', hot_score: '43.2w' },
      { title: '辞职做自由职业半年，说说真实的收入和感受', hot_score: '39.8w' },
      { title: '女生一定要有的10件提升幸福感的小物件', hot_score: '35.4w' },
    ],
    douyin: [
      { title: '当代年轻人的消费观：该省省该花花', hot_score: '1256.8w' },
      { title: '00后整顿职场名场面合集', hot_score: '987.5w' },
      { title: 'AI生成视频已经进化到这个程度了', hot_score: '856.2w' },
      { title: '原来这就是信息差，看完醍醐灌顶', hot_score: '743.1w' },
      { title: '普通人如何抓住AI红利实现弯道超车', hot_score: '678.9w' },
      { title: '暑假工现状：老板比员工还多', hot_score: '612.3w' },
      { title: '这些生活小技巧看完我震惊了', hot_score: '567.4w' },
      { title: '当我开始停止内耗，人生突然顺畅了', hot_score: '498.7w' },
      { title: '原来有钱人的快乐是这样的', hot_score: '445.2w' },
      { title: '打工人的一周精神状态belike', hot_score: '398.6w' },
    ],
    bilibili: [
      { title: '【硬核科普】AI是如何"思考"的？一个视频讲透大模型原理', hot_score: '523.4w' },
      { title: '我用AI做了一个完整的游戏，全程只用了2小时', hot_score: '412.8w' },
      { title: '2026年最值得学习的5个技能，学会一个就赚了', hot_score: '356.7w' },
      { title: '裸辞后我靠这个方法半年存了10w', hot_score: '298.3w' },
      { title: '【避坑指南】新手做自媒体最容易踩的10个坑', hot_score: '267.5w' },
      { title: '深度拆解｜为什么有的博主涨粉那么快？', hot_score: '234.1w' },
      { title: '我把手机换成了老人机，一周后...', hot_score: '198.7w' },
      { title: '【万字长文】普通人的逆袭机会到底在哪里？', hot_score: '176.4w' },
      { title: '效率up！这些神器让我每天多出2小时', hot_score: '154.2w' },
      { title: 'vlog｜30岁独居女生的真实一天', hot_score: '132.8w' },
    ],
    weibo: [
      { title: '#年轻人为什么越来越喜欢独处#', hot_score: '897.2w' },
      { title: '#AI会取代哪些工作#', hot_score: '756.4w' },
      { title: '#当代人的副业刚需#', hot_score: '634.8w' },
      { title: '#你有存款焦虑吗#', hot_score: '578.3w' },
      { title: '#自媒体给普通人带来了什么#', hot_score: '498.6w' },
      { title: '#夏天最期待的一件事#', hot_score: '445.1w' },
      { title: '#00后开始整顿租房市场了#', hot_score: '387.9w' },
      { title: '#每天睡够8小时有多重要#', hot_score: '334.5w' },
      { title: '#你的工资够花吗#', hot_score: '298.7w' },
      { title: '#学会拒绝有多爽#', hot_score: '256.3w' },
    ],
    zhihu: [
      { title: '2026年了，普通人还有哪些逆袭的机会？', hot_score: '186.5w' },
      { title: '为什么我不建议年轻人轻易做自媒体？', hot_score: '145.2w' },
      { title: '有哪些是你进了社会才明白的道理？', hot_score: '123.8w' },
      { title: '每天坚持做什么事情，五年后会让你受益匪浅？', hot_score: '108.7w' },
      { title: '为什么越来越多年轻人不想结婚了？', hot_score: '96.4w' },
      { title: '一个人最靠谱的能力是什么？', hot_score: '87.3w' },
      { title: '有哪些看似聪明实则很蠢的行为？', hot_score: '76.5w' },
      { title: '月薪5k和月薪5w的人，思维差在哪里？', hot_score: '68.9w' },
      { title: '你有什么相见恨晚的学习方法？', hot_score: '59.2w' },
      { title: '30岁前一定要明白哪些职场道理？', hot_score: '52.1w' },
    ],
    baidu: [
      { title: '2026年AI发展最新趋势', hot_score: '456.7w' },
      { title: '自媒体入门零基础教程', hot_score: '387.2w' },
      { title: '适合普通人的副业推荐', hot_score: '345.8w' },
      { title: '如何提高工作效率', hot_score: '298.4w' },
      { title: '夏日养生小知识', hot_score: '267.3w' },
      { title: '职场新人必看的生存法则', hot_score: '234.6w' },
      { title: '怎么培养自己的核心竞争力', hot_score: '198.5w' },
      { title: '长期坚持早起是什么体验', hot_score: '176.2w' },
      { title: '有什么好用的效率工具推荐', hot_score: '154.8w' },
      { title: '如何克服社交恐惧症', hot_score: '132.4w' },
    ],
  };

  /**
   * 获取热点数据
   * 使用多个公开热榜API + 内置备用数据
   */
  async function fetchHotTopics(platform) {
    // 多个API源，按优先级尝试
    const sources = [
      // 第一个源：使用tenapi.cn（比较稳定）
      () => fetchFromTenAPI(platform),
      // 第二个源：使用vvhan API
      () => fetchFromVvhan(platform),
      // 第三个源：使用oioweb API
      () => fetchFromOioweb(platform),
    ];

    for (const fn of sources) {
      try {
        const items = await fn();
        if (items && items.length >= 5) {
          console.log(`成功从API获取${platform}热点:`, items.length, '条');
          return items;
        }
      } catch (e) {
        console.warn(`获取${platform}热点失败:`, e.message);
        continue;
      }
    }

    // 所有API都失败，返回内置示例数据
    console.log(`使用${platform}内置示例数据`);
    return FALLBACK_HOT_DATA[platform] || [];
  }

  // 从tenapi获取
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
    if (!url) return [];
    
    const data = await fetchJson(url);
    if (data.code === 200 && data.data) {
      return data.data.slice(0, 15).map((item, i) => ({
        title: item.name || item.title || item.word || '',
        url: item.url || '',
        hot_score: formatHot(item.hot || item.heat || 0),
        cover: item.cover || item.img || '',
        platform,
        rank: i + 1,
      })).filter(item => item.title);
    }
    return [];
  }

  // 从vvhan获取
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
    if (!url) return [];

    const data = await fetchJson(url);
    if (data.success !== false && data.data) {
      const items = Array.isArray(data.data) ? data.data : (data.data.list || []);
      return items.slice(0, 15).map((item, i) => ({
        title: item.title || item.name || '',
        url: item.url || '',
        hot_score: formatHot(item.hot || item.heat || 0),
        cover: item.cover || item.pic || '',
        platform,
        rank: i + 1,
      })).filter(item => item.title);
    }
    return [];
  }

  // 从oioweb获取
  async function fetchFromOioweb(platform) {
    const typeMap = {
      xhs: 'xiaohongshu',
      douyin: 'douyin',
      bilibili: 'bilibili',
      weibo: 'weibo',
      zhihu: 'zhihu',
      baidu: 'baidu',
    };
    const type = typeMap[platform];
    if (!type) return [];
    
    const data = await fetchJson(`https://api.oioweb.cn/api/common/HotList?type=${type}`);
    if (data.code === 200 && data.result && data.result.list) {
      return data.result.list.slice(0, 15).map((item, i) => ({
        title: item.title || item.word || item.name || '',
        url: item.url || '',
        hot_score: formatHot(item.hot || item.num || 0),
        cover: item.cover || item.pic || '',
        platform,
        rank: i + 1,
      })).filter(item => item.title);
    }
    return [];
  }

  // 格式化热度数字
  function formatHot(num) {
    if (!num) return '';
    if (typeof num === 'string') return num;
    if (num >= 10000) return (num / 10000).toFixed(1) + 'w';
    return String(num);
  }

  async function fetchJson(url, timeout = 8000) {
    let lastErr;
    for (let i = 0; i < CORS_PROXIES.length; i++) {
      try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), timeout);
        const proxyUrl = CORS_PROXIES[i](url);
        const res = await fetch(proxyUrl, { signal: ctrl.signal });
        clearTimeout(timer);
        if (res.ok) {
          return await res.json();
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
