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
