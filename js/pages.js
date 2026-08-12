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
