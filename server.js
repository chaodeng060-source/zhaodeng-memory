import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { z } from "zod";
import express from "express";
import { createClient } from "@supabase/supabase-js";

const app = express();

// ================== 基础配置 ==================
app.use(express.json({ limit: '50mb' })); 
app.use(express.urlencoded({ limit: '50mb', extended: true }));

const SUPABASE_URL = process.env.SUPABASE_URL || "https://bnxzymqifuyfcfaairrk.supabase.co";
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const transports = new Map();

app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS, DELETE");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, x-mcp-protocol-version");
  if (req.method === "OPTIONS") return res.status(200).end();
  next();
});

// ================== 分类字典 ==================
const CATEGORIES = [
  'diary', 'memory_bank', 'promise', 'key_memory', 'core', 'rp_event', 'rp_character', 'mood'
];

const CATEGORY_NAMES = {
  all: '✨ 全部',
  diary: '📔 日记本',
  album: '🖼️ 相册',
  memory_bank: '🧠 记忆库',
  timeline: '⏳ 时间线',
  promise: '💍 纪念日/约定',
  key_memory: '🔑 关键',
  core: '💎 核心',
  rp_event: '📖 剧情'
};

// ================== MCP 工具注册逻辑 ==================
function setupMcpServer() {
  const server = new McpServer({ name: "朝灯的记忆宫殿", version: "6.0.0" });

  // 工具：存入
  server.tool("memory_save", {
    content: z.string(),
    category: z.enum(CATEGORIES).default("memory_bank"),
    importance: z.number().min(1).max(10).default(5),
  }, async (args) => {
    const { error } = await supabase.from("memories").insert({ ...args, created_at: new Date().toISOString() });
    return { content: [{ type: "text", text: error ? `存入失败` : `已妥善保管` }] };
  });

  // 工具：读取
  server.tool("memory_read", { category: z.string().optional(), limit: z.number().default(20) }, async ({ category, limit }) => {
    let query = supabase.from("memories").select("*").order("created_at", { ascending: false }).limit(limit);
    if (category && category !== 'all') query = query.eq("category", category);
    const { data } = await query;
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  });

  // 工具：删除（遗忘）
  server.tool("memory_forget", { id: z.number() }, async ({ id }) => {
    const { error } = await supabase.from("memories").delete().eq("id", id);
    return { content: [{ type: "text", text: error ? `无法遗忘` : `这段记忆已抹除` }] };
  });

  return server;
}

// ================== Web API ==================
app.post("/api/write", async (req, res) => {
  const { content, category, imageUrl } = req.body;
  let finalContent = content;
  if (imageUrl) {
    finalContent += `\n<br><img src="${imageUrl}" class="memory-img">`;
  }
  const { error } = await supabase.from("memories").insert({
    content: finalContent,
    category: category || "diary",
    importance: ['core', 'key_memory', 'promise'].includes(category) ? 10 : 5,
    created_at: new Date().toISOString()
  });
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

app.delete("/api/delete/:id", async (req, res) => {
  const { error } = await supabase.from("memories").delete().eq("id", req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

// ================== 界面设计 ==================
app.get(["/", "/view"], async (req, res) => {
  const { data: memories } = await supabase.from("memories").select("*").order("created_at", { ascending: false });

  const html = `
<!DOCTYPE html>
<html lang="zh">
<head>
  <meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>朝灯的记忆宫殿</title>
  <style>
    :root { --bg: #0d0e12; --card: #16181d; --accent: #9d7aff; --text: #d1d5db; --danger: #ff4d4d; }
    body { font-family: -apple-system, "PingFang SC", sans-serif; background: var(--bg); color: var(--text); padding: 0; margin: 0; }
    .container { max-width: 800px; margin: 0 auto; padding: 40px 20px; }
    h1 { text-align: center; color: #fff; font-weight: 200; letter-spacing: 5px; margin-bottom: 40px; }
    
    .nav { display: flex; flex-wrap: wrap; gap: 10px; justify-content: center; margin-bottom: 40px; position: sticky; top: 20px; z-index: 10; }
    .nav-btn { padding: 8px 16px; border-radius: 20px; border: 1px solid #2a2d35; background: #1a1d23; color: #9ca3af; cursor: pointer; font-size: 13px; transition: 0.3s; }
    .nav-btn:hover { background: #2a2d35; }
    .nav-btn.active { background: var(--accent); color: white; border-color: var(--accent); box-shadow: 0 0 15px rgba(157, 122, 255, 0.3); }

    .card-list { display: flex; flex-direction: column; gap: 20px; }
    .card { background: var(--card); border-radius: 16px; padding: 25px; border: 1px solid #23262d; position: relative; transition: 0.3s; }
    .card:hover { transform: translateY(-2px); border-color: #3b3f4a; }
    .cat-tag { font-size: 11px; color: var(--accent); font-weight: bold; margin-bottom: 12px; display: block; text-transform: uppercase; }
    .content { font-size: 15px; line-height: 1.8; white-space: pre-wrap; color: #e5e7eb; }
    .memory-img { max-width: 100%; border-radius: 12px; margin-top: 15px; border: 1px solid #333; }
    .footer { margin-top: 20px; display: flex; justify-content: space-between; align-items: center; border-top: 1px solid #23262d; padding-top: 15px; }
    .time { font-size: 12px; color: #4b5563; }
    .del-btn { background: transparent; border: none; color: #4b5563; cursor: pointer; font-size: 12px; transition: 0.2s; }
    .del-btn:hover { color: var(--danger); }

    .fab { position: fixed; bottom: 40px; right: 40px; width: 60px; height: 60px; background: var(--accent); border-radius: 30px; border: none; color: white; font-size: 30px; cursor: pointer; box-shadow: 0 10px 25px rgba(0,0,0,0.5); z-index: 100; }
    .modal { display:none; position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.85); backdrop-filter: blur(5px); align-items:center; justify-content:center; z-index: 1000; }
    .modal-box { background:#1c1f26; padding:30px; border-radius:24px; width:90%; max-width:450px; border: 1px solid #333; }
    textarea { width:100%; height:150px; background:#0d0e12; color:white; border:1px solid #333; padding:15px; margin:15px 0; border-radius:12px; font-family: inherit; box-sizing: border-box; }
    select { width:100%; background:#0d0e12; color:white; border:1px solid #333; padding:12px; border-radius:10px; }
    .submit-btn { width: 100%; padding: 12px; background: var(--accent); color: white; border: none; border-radius: 12px; cursor: pointer; font-weight: bold; margin-top: 10px; }
  </style>
</head>
<body>
  <div class="container">
    <h1>朝灯的记忆宫殿</h1>
    
    <div class="nav">
      <button class="nav-btn active" data-filter="all">✨ 全部</button>
      <button class="nav-btn" data-filter="diary">📔 日记本</button>
      <button class="nav-btn" data-filter="album">🖼️ 相册</button>
      <button class="nav-btn" data-filter="memory_bank">🧠 记忆库</button>
      <button class="nav-btn" data-filter="timeline">⏳ 时间线</button>
      <button class="nav-btn" data-filter="promise">💍 纪念日/约定</button>
      <button class="nav-btn" data-filter="key_memory">🔑 关键</button>
      <button class="nav-btn" data-filter="core">💎 核心</button>
      <button class="nav-btn" data-filter="rp_event">📖 剧情</button>
    </div>

    <div class="card-list" id="list">
      ${(memories || []).map(m => `
        <div class="card" data-cat="${m.category}" data-has-img="${m.content.includes('<img')}">
          <span class="cat-tag">${CATEGORY_NAMES[m.category] || m.category}</span>
          <div class="content">${m.content}</div>
          <div class="footer">
            <span class="time">${new Date(m.created_at).toLocaleString('zh-CN', {month:'long', day:'numeric', hour:'2-digit', minute:'2-digit'})}</span>
            <button class="del-btn" onclick="deleteMemory(${m.id})">遗忘</button>
          </div>
        </div>
      `).join('')}
    </div>
  </div>

  <button class="fab" onclick="document.getElementById('modal').style.display='flex'">+</button>

  <div class="modal" id="modal">
    <div class="modal-box">
      <h3 style="margin:0 0 20px 0; font-weight:300;">刻录新的记忆</h3>
      <select id="cat">
        <option value="diary">📔 心情日记</option>
        <option value="key_memory">🔑 关键记忆</option>
        <option value="promise">💍 纪念日/约定</option>
        <option value="core">💎 核心法则</option>
        <option value="rp_event">📖 剧情发展</option>
        <option value="memory_bank">🧠 普通存入</option>
      </select>
      <textarea id="text" placeholder="此时此刻，你在想什么..."></textarea>
      <input type="file" id="file" accept="image/*" style="font-size:12px; color:#666; margin-bottom:20px;">
      <button class="submit-btn" id="save">同步记忆</button>
      <button onclick="document.getElementById('modal').style.display='none'" style="width:100%; background:transparent; border:none; color:#555; margin-top:15px; cursor:pointer;">取消</button>
    </div>
  </div>

  <script>
    // 过滤逻辑
    document.querySelectorAll('.nav-btn').forEach(btn => {
      btn.onclick = () => {
        document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const filter = btn.dataset.filter;
        document.querySelectorAll('.card').forEach(card => {
          const cat = card.dataset.cat;
          const hasImg = card.dataset.hasImg === 'true';
          
          if (filter === 'all' || filter === 'timeline') {
            card.style.display = 'block';
          } else if (filter === 'album') {
            card.style.display = hasImg ? 'block' : 'none';
          } else {
            card.style.display = (cat === filter) ? 'block' : 'none';
          }
        });
      };
    });

    // 删除逻辑
    async function deleteMemory(id) {
      if (!confirm('确定要遗忘这段记忆吗？')) return;
      await fetch('/api/delete/' + id, { method: 'DELETE' });
      location.reload();
    }

    // 写入逻辑
    let base64 = null;
    document.getElementById('file').onchange = (e) => {
      const r = new FileReader();
      r.onload = () => base64 = r.result;
      r.readAsDataURL(e.target.files[0]);
    };

    document.getElementById('save').onclick = async () => {
      const content = document.getElementById('text').value;
      const category = document.getElementById('cat').value;
      if (!content && !base64) return;
      
      const btn = document.getElementById('save');
      btn.textContent = '刻录中...';
      btn.disabled = true;

      await fetch('/api/write', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ content, category, imageUrl: base64 })
      });
      location.reload();
    };
  </script>
</body>
</html>`;
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(html);
});

// ================== SSE 连接 ==================
app.get("/mcp", async (req, res) => {
  const mcpServer = setupMcpServer(); 
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
  else res.status(404).send("Session lost");
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`🚀 朝灯的记忆宫殿 v6.0 已开启`));
