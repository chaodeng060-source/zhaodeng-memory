import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { z } from "zod";
import express from "express";
import { createClient } from "@supabase/supabase-js";

const app = express();

// ================== 基础配置 ==================
app.use(express.json({ limit: '50mb' })); // 支持图片上传的大小
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
  core: '💎 核心法则',
  key_memory: '🔑 关键记忆',
  diary: '📔 心情日记',
  milestone: '🏆 重要里程碑',
  mood: '💭 瞬间情绪',
  rp_character: '👤 角色人设',
  rp_event: '📖 剧情发展',
  rp_relation: '💕 关系羁绊',
  rp_state: '🎭 情感状态'
};

// ================== 核心工具注册逻辑 ==================
// 这里的逻辑现在每次连接都会新跑一遍，确保不会冲突
function setupMcpServer() {
  const server = new McpServer({ name: "朝灯的记忆库", version: "5.5.0" });

  server.tool("memory_save", {
    content: z.string(),
    category: z.enum(CATEGORIES).default("diary"),
    tags: z.array(z.string()).default([]),
    importance: z.number().min(1).max(10).default(5),
  }, async (args) => {
    const { error } = await supabase.from("memories").insert({ ...args, created_at: new Date().toISOString() });
    return { content: [{ type: "text", text: error ? `失败: ${error.message}` : `已同步至记忆深处` }] };
  });

  server.tool("memory_read", { category: z.string().optional(), limit: z.number().default(10) }, async ({ category, limit }) => {
    let query = supabase.from("memories").select("*").order("created_at", { ascending: false }).limit(limit);
    if (category) query = query.eq("category", category);
    const { data } = await query;
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  });

  return server;
}

// ================== 网页端：写日记 & 传图片的 API ==================
app.post("/api/write", async (req, res) => {
  const { content, category, imageUrl } = req.body;
  let finalContent = content;
  if (imageUrl) {
    finalContent += `\n<br><img src="${imageUrl}" style="max-width: 100%; border-radius: 8px; margin-top: 10px;">`;
  }
  const { error } = await supabase.from("memories").insert({
    content: finalContent,
    category: category || "diary",
    importance: category === 'core' ? 10 : 5,
    created_at: new Date().toISOString()
  });
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

// ================== 网页端：可视化界面 ==================
app.get(["/", "/view"], async (req, res) => {
  const { data: memories } = await supabase.from("memories").select("*").order("created_at", { ascending: false }).limit(50);
  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>朝灯的记忆库</title>
  <style>
    :root { --bg: #0f1115; --card: #1a1d24; --accent: #7c4dff; --text: #e0e0e0; }
    body { font-family: -apple-system, sans-serif; background: var(--bg); color: var(--text); padding: 20px; }
    .container { max-width: 700px; margin: 0 auto; }
    h1 { text-align: center; color: #b39ddb; margin: 30px 0; font-weight: 300; letter-spacing: 3px; }
    .filter-bar { display: flex; flex-wrap: wrap; gap: 8px; justify-content: center; margin-bottom: 30px; }
    .btn { padding: 8px 16px; border-radius: 20px; border: 1px solid #333; background: #222; color: #888; cursor: pointer; font-size: 12px; }
    .btn.active { background: var(--accent); color: white; border-color: var(--accent); }
    .card { background: var(--card); border-radius: 12px; padding: 20px; margin-bottom: 16px; border-left: 4px solid #333; }
    .card.rp { border-left-color: #ff4081; }
    .card.core { border-left-color: #00e5ff; }
    .cat { font-size: 11px; color: var(--accent); margin-bottom: 8px; display: block; }
    .content { font-size: 14px; line-height: 1.6; white-space: pre-wrap; }
    .meta { font-size: 11px; color: #555; margin-top: 12px; }
    .fab { position: fixed; bottom: 30px; right: 30px; width: 56px; height: 56px; background: var(--accent); border-radius: 28px; border: none; color: white; font-size: 24px; cursor: pointer; box-shadow: 0 4px 12px rgba(0,0,0,0.4); }
    .modal { display:none; position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.8); align-items:center; justify-content:center; }
    .modal-box { background:var(--card); padding:25px; border-radius:15px; width:90%; max-width:400px; }
    textarea { width:100%; height:120px; background:#111; color:white; border:1px solid #333; padding:10px; margin:10px 0; border-radius:8px; }
    select { width:100%; background:#111; color:white; border:1px solid #333; padding:8px; border-radius:8px; }
  </style>
</head>
<body>
  <div class="container">
    <h1>🌙 朝灯的记忆库</h1>
    <div class="filter-bar">
      <button class="btn active" data-cat="all">全部</button>
      <button class="btn" data-cat="diary">📔 日记</button>
      <button class="btn" data-cat="core">💎 核心</button>
      <button class="btn" data-cat="rp">🎭 剧情</button>
    </div>
    <div id="list">
      ${(memories || []).map(m => `
        <div class="card ${m.category.startsWith('rp_') ? 'rp' : ''} ${m.category==='core'?'core':''}" data-cat="${m.category}">
          <span class="cat">${CATEGORY_NAMES[m.category] || m.category}</span>
          <div class="content">${m.content}</div>
          <div class="meta">${new Date(m.created_at).toLocaleString()}</div>
        </div>
      `).join('')}
    </div>
  </div>
  <button class="fab" onclick="document.getElementById('m').style.display='flex'">+</button>
  <div class="modal" id="m">
    <div class="modal-box">
      <h3>存入记忆</h3>
      <select id="c">
        <option value="diary">📔 心情日记</option>
        <option value="core">💎 核心法则</option>
        <option value="rp_event">📖 剧情发展</option>
      </select>
      <textarea id="t" placeholder="写点什么..."></textarea>
      <input type="file" id="i" accept="image/*" style="font-size:12px; color:#666;">
      <div style="margin-top:15px; text-align:right;">
        <button class="btn" onclick="document.getElementById('m').style.display='none'">取消</button>
        <button class="btn active" id="s">封存</button>
      </div>
    </div>
  </div>
  <script>
    // 筛选
    document.querySelectorAll('.btn[data-cat]').forEach(b => {
      b.onclick = () => {
        document.querySelectorAll('.btn').forEach(x => x.classList.remove('active'));
        b.classList.add('active');
        const c = b.dataset.cat;
        document.querySelectorAll('.card').forEach(card => {
          card.style.display = (c==='all' || (c==='rp' && card.dataset.cat.startsWith('rp_')) || card.dataset.cat===c) ? 'block' : 'none';
        });
      };
    });
    // 提交
    let base64 = null;
    document.getElementById('i').onchange = (e) => {
      const r = new FileReader();
      r.onload = () => base64 = r.result;
      r.readAsDataURL(e.target.files[0]);
    };
    document.getElementById('s').onclick = async () => {
      const content = document.getElementById('t').value;
      const category = document.getElementById('c').value;
      if(!content && !base64) return;
      await fetch('/api/write', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({content, category, imageUrl: base64})
      });
      location.reload();
    };
  </script>
</body>
</html>`;
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(html);
});

// ================== SSE 连接逻辑 (关键修复点) ==================
app.get("/mcp", async (req, res) => {
  // 核心修复：为每一次连接都创建一个全新的 Server 实例
  const mcpServer = setupMcpServer(); 
  const transport = new SSEServerTransport("/messages", res);
  
  const sid = transport.sessionId;
  transports.set(sid, transport);
  
  await mcpServer.connect(transport);
  
  req.on("close", () => {
    transports.delete(sid);
  });
});

app.post("/messages", express.json(), async (req, res) => {
  const sid = req.query.sessionId;
  const transport = transports.get(sid);
  if (transport) {
    await transport.handlePostMessage(req, res);
  } else {
    res.status(404).send("Session not found");
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`🚀 记忆库 v5.5 运行于端口 ${PORT}`));
