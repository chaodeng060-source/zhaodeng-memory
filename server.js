import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { z } from "zod";
import express from "express";
import { createClient } from "@supabase/supabase-js";

const app = express();

// ================== 基础配置 ==================
// 扩容以支持 Base64 图片上传
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

const SUPABASE_URL = process.env.SUPABASE_URL || "https://bnxzymqifuyfcfaairrk.supabase.co";
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const transports = new Map();

app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, x-mcp-protocol-version");
  if (req.method === "OPTIONS") return res.status(200).end();
  next();
});

// ================== 分类字典 ==================
const CATEGORIES = [
  'core', 'key_memory', 'diary', 'milestone', 'mood',
  'rp_character', 'rp_event', 'rp_relation', 'rp_state'
];

const CATEGORY_NAMES = {
  all: '全部',
  core: '💎 核心',
  key_memory: '🔑 关键记忆',
  diary: '📔 日记',
  milestone: '🏆 里程碑',
  mood: '💭 情绪',
  rp_character: '👤 角色设定',
  rp_event: '📖 剧情发展',
  rp_relation: '💕 关系羁绊',
  rp_state: '🎭 情感状态'
};

// ================== 核心逻辑 ==================
function calculateScore(memory) {
  const now = new Date();
  const created = new Date(memory.created_at);
  const daysPassed = (now - created) / (1000 * 60 * 60 * 24);
  let decayRate = 0.05;
  if (memory.category === "mood") decayRate = 0.03;
  if (memory.category?.startsWith("rp_")) decayRate = 0.02;
  return (memory.importance / 10) * Math.exp(-decayRate * daysPassed);
}

async function markRecalled(ids) {
  if (!ids?.length) return;
  await supabase.from("memories").update({ last_recalled: new Date().toISOString() }).in("id", ids);
}

// ================== MCP Server 设置 ==================
function setupMcpServer() {
  const server = new McpServer({ name: "朝灯的记忆库", version: "5.0.0" });

  server.tool("memory_save", {
    content: z.string(),
    category: z.enum(CATEGORIES).default("diary"),
    tags: z.array(z.string()).default([]),
    importance: z.number().min(1).max(10).default(5),
    mood: z.number().min(-1).max(1).default(0),
  }, async (args) => {
    const { error } = await supabase.from("memories").insert({ ...args, created_at: new Date().toISOString(), last_recalled: new Date().toISOString(), recall_count: 0 });
    return { content: [{ type: "text", text: error ? `保存失败：${error.message}` : `已封存至 [${CATEGORY_NAMES[args.category]}]` }] };
  });

  server.tool("memory_read", { category: z.string().optional(), limit: z.number().default(15) }, async ({ category, limit }) => {
    let query = supabase.from("memories").select("*").order("created_at", { ascending: false }).limit(limit);
    if (category) query = query.eq("category", category);
    const { data } = await query;
    await markRecalled(data?.map(m => m.id));
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  });

  return server;
}

const mcpServer = setupMcpServer();

// ================== 专属 Web 接口 (处理直接写入) ==================
app.post("/api/write", async (req, res) => {
  const { content, category, imageUrl } = req.body;
  
  let finalContent = content;
  // 如果有图片，将其作为 HTML 标签嵌入内容中
  if (imageUrl) {
    finalContent += `\n<br><img src="${imageUrl}" style="max-width: 100%; border-radius: 8px; margin-top: 10px;">`;
  }

  const { error } = await supabase.from("memories").insert({
    content: finalContent,
    category: category || "diary",
    tags: [],
    importance: category === 'core' ? 10 : (category === 'key_memory' ? 8 : 5),
    mood: 0,
    created_at: new Date().toISOString(),
    last_recalled: new Date().toISOString(),
    recall_count: 0
  });

  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

// ================== 全新沉浸式 UI 界面 ==================
app.get(["/", "/view"], async (req, res) => {
  const { data: memories } = await supabase.from("memories").select("*").order("created_at", { ascending: false }).limit(100);

  const html = `
<!DOCTYPE html>
<html lang="zh">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>朝灯的记忆库</title>
  <style>
    :root {
      --bg: #13151a; --card-bg: #1e212b; --accent: #8b5cf6; 
      --text: #e2e8f0; --text-muted: #94a3b8;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, sans-serif; background: var(--bg); color: var(--text); padding: 20px 20px 80px 20px; line-height: 1.6; }
    .container { max-width: 800px; margin: 0 auto; }
    
    /* 标题与分类栏 */
    h1 { text-align: center; margin: 40px 0; color: #a8b1ff; font-weight: 500; font-size: 24px; letter-spacing: 2px; }
    .filter-bar { display: flex; flex-wrap: wrap; gap: 10px; justify-content: center; margin-bottom: 40px; }
    .filter-btn { padding: 8px 18px; border: 1px solid rgba(255,255,255,0.1); border-radius: 20px; cursor: pointer; background: rgba(255,255,255,0.03); color: var(--text-muted); font-size: 13px; transition: all 0.3s ease; }
    .filter-btn:hover { background: rgba(255,255,255,0.08); }
    .filter-btn.active { background: var(--accent); color: #fff; border-color: var(--accent); }
    
    /* 记忆卡片 */
    .memory-card { background: var(--card-bg); border-radius: 16px; padding: 24px; margin-bottom: 20px; box-shadow: 0 4px 20px rgba(0,0,0,0.2); border: 1px solid rgba(255,255,255,0.05); transition: transform 0.2s; }
    .memory-card.rp { border-left: 3px solid #ec4899; }
    .memory-card.core { border-left: 3px solid #3b82f6; }
    .category-tag { font-size: 12px; color: var(--accent); margin-bottom: 12px; display: block; opacity: 0.8; }
    .content { font-size: 15px; white-space: pre-wrap; margin-bottom: 16px; color: #cbd5e1; }
    .meta { font-size: 12px; color: var(--text-muted); display: flex; justify-content: space-between; border-top: 1px solid rgba(255,255,255,0.05); padding-top: 12px; }
    
    /* 悬浮写入按钮 & 模态框 */
    .fab { position: fixed; bottom: 40px; right: 40px; width: 60px; height: 60px; border-radius: 30px; background: var(--accent); color: white; font-size: 24px; border: none; cursor: pointer; box-shadow: 0 8px 24px rgba(139, 92, 246, 0.4); transition: transform 0.2s; z-index: 100; }
    .fab:hover { transform: scale(1.05); }
    
    .modal-overlay { display: none; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.7); backdrop-filter: blur(5px); z-index: 1000; align-items: center; justify-content: center; }
    .modal { background: var(--card-bg); width: 90%; max-width: 600px; border-radius: 20px; padding: 30px; border: 1px solid rgba(255,255,255,0.1); }
    .modal h2 { margin-bottom: 20px; font-size: 18px; color: #fff; }
    .form-group { margin-bottom: 20px; }
    select, textarea { width: 100%; background: rgba(0,0,0,0.2); border: 1px solid rgba(255,255,255,0.1); color: white; padding: 12px; border-radius: 10px; font-family: inherit; }
    textarea { height: 150px; resize: vertical; }
    select:focus, textarea:focus { outline: none; border-color: var(--accent); }
    
    .file-upload { display: block; margin-top: 10px; font-size: 13px; color: var(--text-muted); }
    .file-upload input { margin-top: 5px; }
    #image-preview { max-width: 100px; border-radius: 8px; margin-top: 10px; display: none; }
    
    .btn-group { display: flex; justify-content: flex-end; gap: 12px; }
    .btn { padding: 10px 24px; border-radius: 20px; border: none; cursor: pointer; font-size: 14px; transition: 0.2s; }
    .btn-cancel { background: transparent; color: var(--text-muted); }
    .btn-cancel:hover { color: #fff; }
    .btn-submit { background: var(--accent); color: white; }
    .btn-submit:hover { background: #7c3aed; }
  </style>
</head>
<body>
  <div class="container">
    <h1>🌙 朝灯的记忆库</h1>
    
    <div class="filter-bar">
      <button class="filter-btn active" data-cat="all">全部</button>
      <button class="filter-btn" data-cat="diary">📔 日记</button>
      <button class="filter-btn" data-cat="key_memory">🔑 关键</button>
      <button class="filter-btn" data-cat="core">💎 核心</button>
      <button class="filter-btn" data-cat="rp">🎭 角色扮演</button>
    </div>

    <div id="memories">
      ${(memories || []).map(m => `
        <div class="memory-card ${m.category.startsWith('rp_') ? 'rp' : ''} ${m.category === 'core' ? 'core' : ''}" data-cat="${m.category}">
          <span class="category-tag">${CATEGORY_NAMES[m.category] || m.category}</span>
          <div class="content">${m.content}</div>
          <div class="meta">
            <span>${new Date(m.created_at).toLocaleString('zh-CN')}</span>
          </div>
        </div>
      `).join('')}
    </div>
  </div>

  <button class="fab" id="fab-btn">+</button>
  
  <div class="modal-overlay" id="write-modal">
    <div class="modal">
      <h2>记录当下</h2>
      <div class="form-group">
        <select id="entry-category">
          <option value="diary">📔 日记</option>
          <option value="key_memory">🔑 关键记忆</option>
          <option value="core">💎 核心法则</option>
          <option value="rp_event">📖 剧情发展 (RP)</option>
          <option value="rp_character">👤 角色设定 (RP)</option>
          <option value="rp_relation">💕 关系羁绊 (RP)</option>
        </select>
      </div>
      <div class="form-group">
        <textarea id="entry-content" placeholder="写下你想留存的文字..."></textarea>
      </div>
      <div class="form-group">
        <label class="file-upload">
          附加影像 (可选)
          <input type="file" id="entry-image" accept="image/*">
        </label>
        <img id="image-preview" src="">
      </div>
      <div class="btn-group">
        <button class="btn btn-cancel" id="btn-cancel">取消</button>
        <button class="btn btn-submit" id="btn-submit">封存</button>
      </div>
    </div>
  </div>

  <script>
    // 筛选逻辑
    document.querySelectorAll('.filter-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const cat = btn.dataset.cat;
        document.querySelectorAll('.memory-card').forEach(card => {
          if (cat === 'all') card.style.display = 'block';
          else if (cat === 'rp') card.style.display = card.dataset.cat.startsWith('rp_') ? 'block' : 'none';
          else card.style.display = card.dataset.cat === cat ? 'block' : 'none';
        });
      });
    });

    // 弹窗逻辑
    const modal = document.getElementById('write-modal');
    const imgInput = document.getElementById('entry-image');
    const preview = document.getElementById('image-preview');
    let currentImageBase64 = null;

    document.getElementById('fab-btn').addEventListener('click', () => modal.style.display = 'flex');
    document.getElementById('btn-cancel').addEventListener('click', () => {
      modal.style.display = 'none';
      imgInput.value = ''; preview.style.display = 'none'; currentImageBase64 = null;
    });

    // 图片转 Base64
    imgInput.addEventListener('change', function() {
      const file = this.files[0];
      if (file) {
        const reader = new FileReader();
        reader.onload = function(e) {
          currentImageBase64 = e.target.result;
          preview.src = currentImageBase64;
          preview.style.display = 'block';
        }
        reader.readAsDataURL(file);
      }
    });

    // 提交数据
    document.getElementById('btn-submit').addEventListener('click', async () => {
      const content = document.getElementById('entry-content').value.trim();
      const category = document.getElementById('entry-category').value;
      if (!content && !currentImageBase64) return;

      const btn = document.getElementById('btn-submit');
      btn.textContent = '写入中...';
      btn.disabled = true;

      try {
        const response = await fetch('/api/write', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content, category, imageUrl: currentImageBase64 })
        });
        if (response.ok) window.location.reload();
      } catch (error) {
        console.error("保存失败:", error);
        btn.textContent = '失败，重试';
        btn.disabled = false;
      }
    });
  </script>
</body>
</html>`;
  
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(html);
});

// ================== SSE 核心连接通道 ==================
app.get("/mcp", async (req, res) => {
  const transport = new SSEServerTransport("/messages", res);
  const sid = transport.sessionId;
  transports.set(sid, transport);
  await mcpServer.connect(transport);
  req.on("close", () => transports.delete(sid));
});

app.post("/messages", express.json(), async (req, res) => {
  const sid = req.query.sessionId;
  const transport = transports.get(sid);
  if (transport) await transport.handlePostMessage(req, res);
  else res.status(404).send("连接不存在");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 记忆库 v5.0 运行于端口 ${PORT}`));
