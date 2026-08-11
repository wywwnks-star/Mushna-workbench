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

    // 刷新按钮
    const refreshBtn = el('button', { class: 'btn btn-ghost btn-sm', style: { marginBottom: '12px' }, onclick: loadTrends }, '🔄 刷新热点');
    root.appendChild(refreshBtn);

    const listContainer = el('div', { id: 'trends-list' });
    root.appendChild(listContainer);

    async function loadTrends() {
      listContainer.innerHTML = '<div class="skeleton" style="height:60px"></div><div class="skeleton" style="height:60px"></div><div class="skeleton" style="height:60px"></div>';
      try {
        const items = await API.fetchHotTopics(currentPlatform);
        listContainer.innerHTML = '';
        if (items.length === 0) {
          listContainer.appendChild(el('div', { class: 'empty-state' }, [
            el('div', { class: 'empty-state-icon' }, '🔍'),
            el('div', {}, '暂无热点数据'),
            el('div', { class: 'text-xs text-muted', style: { marginTop: '8px' } }, '部分平台可能因反爬限制无法获取'),
          ]));
          return;
        }
        items.forEach((item, i) => {
          const card = el('div', { class: 'trend-card' }, [
            el('div', { class: 'trend-title' }, [
              el('span', { style: { color: i < 3 ? '#ef4444' : 'var(--muted)', fontWeight: '700', marginRight: '8px' } }, String(i + 1).padStart(2, '0')),
              item.title,
            ]),
            el('div', { class: 'trend-meta' }, [
              item.hot_score ? el('span', { class: 'trend-score' }, '🔥 ' + formatNum(item.hot_score)) : null,
              el('span', { class: 'text-xs text-muted' }, platformName(currentPlatform)),
            ]),
            el('div', { class: 'trend-actions' }, [
              item.url ? el('a', { href: item.url, target: '_blank', class: 'btn btn-sm btn-ghost' }, '↗ 查看') : null,
              el('button', { class: 'btn btn-sm btn-primary', onclick: () => saveAsTopic(item, currentPlatform) }, '💡 存为选题'),
            ]),
          ]);
          listContainer.appendChild(card);
        });
      } catch (e) {
        listContainer.innerHTML = '';
        listContainer.appendChild(el('div', { class: 'empty-state' }, [
          el('div', { class: 'empty-state-icon' }, '⚠️'),
          el('div', {}, '获取热点失败'),
          el('div', { class: 'text-xs text-muted', style: { marginTop: '8px' } }, e.message),
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
