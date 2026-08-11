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
