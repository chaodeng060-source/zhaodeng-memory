import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { z } from "zod";
import express from "express";
import { createClient } from "@supabase/supabase-js";

const app = express();

const SUPABASE_URL = process.env.SUPABASE_URL || "https://bnxzymqifuyfcfaairrk.supabase.co";
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const transports = new Map();

app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS, DELETE");
  res.setHeader("Access-Control-Allow-Headers", "*");
  res.setHeader("Access-Control-Expose-Headers", "*");
  res.setHeader("X-Accel-Buffering", "no"); 
  if (req.method === "OPTIONS") return res.status(200).end();
  next();
});

const CATEGORY_NAMES = {
  all: '✨ 全部内容', diary: '📔 心情日记', album: '🖼️ 珍贵相册',
  memory_bank: '🧠 记忆库', timeline: '⏳ 时间线', promise: '💍 纪念日',
  key_memory: '🔑 关键记忆', core: '💎 核心法则', rp_event: '📖 剧情发展'
};

function createMcpServer() {
  const server = new McpServer({ name: "朝灯的记忆宫殿", version: "9.3.0" });
  
  server.tool("save", {
    content: z.string(),
    category: z.enum(Object.keys(CATEGORY_NAMES)).default("memory_bank"),
    importance: z.number().default(5),
  }, async (args) => {
    const { error } = await supabase.from("memories").insert({ ...args, created_at: new Date().toISOString() });
    return { content: [{ type: "text", text: error ? "存入失败" : "已妥善保管" }] };
  });

  server.tool("search", { keyword: z.string().optional(), category: z.string().optional() }, async ({ keyword, category }) => {
    let query = supabase.from("memories").select("*").order("created_at", { ascending: false });
    if (category && category !== 'all') query = query.eq("category", category);
    if (keyword) query = query.ilike("content", `%${keyword}%`);
    const { data } = await query;
    return { content: [{ type: "text", text: JSON.stringify(data || [], null, 2) }] };
  });

  return server;
}

app.post("/api/write", express.json({ limit: '50mb' }), async (req, res) => {
  const { content, category, imageUrl } = req.body;
  let finalContent = content || "";
  if (imageUrl) finalContent += `\n<br><img src="${imageUrl}" class="memory-img">`;
  
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

app.get(["/", "/view"], async (req, res) => {
  const { data: memories } = await supabase.from("memories").select("*").order("created_at", { ascending: false });
  
  const html = `<!DOCTYPE html>
<html lang="zh">
<head>
  <meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>朝灯的记忆宫殿</title>
  <style>
    :root { --bg: #0b0c10; --card: #15171e; --accent: #8e6aff; --text: #d1d5db; --danger: #ff4d6d; }
    body { font-family: -apple-system, "PingFang SC", sans-serif; background: var(--bg); color: var(--text); padding: 0; margin: 0; overflow-x: hidden; }
    .container { max-width: 800px; margin: 0 auto; padding: 40px 20px; }
    h1 { text-align: center; color: #fff; font-weight: 200; letter-spacing: 4px; margin-bottom: 30px; }
    .nav { display: flex; flex-wrap: wrap; gap: 8px; justify-content: center; margin-bottom: 30px; position: sticky; top: 15px; z-index: 100; padding: 10px; border-radius: 30px; }
    .nav-btn { padding: 8px 15px; border-radius: 18px; border: 1px solid #2a2d35; background: #1a1d23; color: #888; cursor: pointer; font-size: 12px; transition: 0.3s; }
    .nav-btn.active { background: var(--accent); color: white; border-color: var(--accent); box-shadow: 0 0 10px rgba(142,106,255,0.4); }
    .search-box { width: 100%; max-width: 500px; margin: 0 auto 30px auto; display: block; background: #1a1d23; border: 1px solid #333; padding: 12px 20px; border-radius: 25px; color: white; outline: none; }
    .card { background: var(--card); border-radius: 16px; padding: 25px; border: 1px solid #23262d; margin-bottom: 20px; position: relative; }
    .cat-tag { font-size: 11px; color: var(--accent); font-weight: bold; margin-bottom: 12px; display: block; }
    .content { font-size: 14px; line-height: 1.8; white-space: pre-wrap; color: #e5e7eb; }
    .memory-img { max-width: 100%; border-radius: 12px; margin-top: 15px; border: 1px solid #333; display: block; }
    .footer { margin-top: 15px; display: flex; justify-content: space-between; align-items: center; font-size: 11px; color: #4b5563; }
    .del-btn { background: transparent; border: none; color: #4b5563; cursor: pointer; transition: 0.2s; }
    .del-btn:hover { color: var(--danger); }
    .fab { position: fixed; bottom: 30px; right: 30px; width: 60px; height: 60px; background: var(--accent); border-radius: 30px; border: none; color: white; font-size: 30px; cursor: pointer; box-shadow: 0 10px 20px rgba(0,0,0,0.5); z-index: 1000; }
    .modal { display:none; position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.9); align-items:center; justify-content:center; z-index: 2000; }
    .modal-box { background:#1c1f26; padding:30px; border-radius:20px; width:90%; max-width:400px; border: 1px solid #333; }
    textarea { width:100%; height:120px; background:#0d0e12; color:white; border:1px solid #333; padding:12px; margin:12px 0; border-radius:10px; box-sizing: border-box; }
    select { width:100%; background:#0d0e12; color:white; border:1px solid #333; padding:10px; border-radius:10px; }
    .submit-btn { width: 100%; padding: 12px; background: var(--accent); color: white; border: none; border-radius: 10px; cursor: pointer; font-weight: bold; margin-top: 10px; }
  </style>
</head>
<body>
  <div class="container">
    <h1>朝灯的记忆宫殿</h1>
    <input type="text" class="search-box" placeholder="检索往事..." id="search">
    <div class="nav">
      <button class="nav-btn active" data-filter="all">✨ 全部</button>
      <button class="nav-btn" data-filter="diary">📔 日记本</button>
      <button class="nav-btn" data-filter="album">🖼️ 相册</button>
      <button class="nav-btn" data-filter="memory_bank">🧠 记忆库</button>
      <button class="nav-btn" data-filter="timeline">⏳ 时间线</button>
      <button class="nav-btn" data-filter="promise">💍 纪念日</button>
      <button class="nav-btn" data-filter="key_memory">🔑 关键</button>
      <button class="nav-btn" data-filter="core">💎 核心</button>
      <button class="nav-btn" data-filter="rp_event">📖 剧情</button>
    </div>
    <div id="list">
      ${(memories || []).map(m => `
        <div class="card" data-cat="${m.category}" data-has-img="${(m.content || '').includes('<img')}" data-content="${(m.content || '').replace(/"/g, '&quot;')}">
          <span class="cat-tag">${CATEGORY_NAMES[m.category] || m.category}</span>
          <div class="content">${m.content || ''}</div>
          <div class="footer">
            <span>${new Date(m.created_at).toLocaleString('zh-CN')}</span>
            <button class="del-btn" onclick="deleteItem(${m.id})">遗忘</button>
          </div>
        </div>
      `).join('')}
    </div>
  </div>
  <button class="fab" onclick="document.getElementById('modal').style.display='flex'">+</button>
  <div class="modal" id="modal">
    <div class="modal-box">
      <h3 style="margin:0; color:#fff;">存入一段记忆</h3>
      <select id="cat">
        <option value="diary">📔 心情日记</option>
        <option value="key_memory">🔑 关键记忆</option>
        <option value="promise">💍 纪念日/约定</option>
        <option value="core">💎 核心法则</option>
        <option value="rp_event">📖 剧情发展</option>
        <option value="memory_bank">🧠 琐碎存入</option>
      </select>
      <textarea id="text" placeholder="文字或瞬间..."></textarea>
      <input type="file" id="file" accept="image/*" style="font-size:12px; color:#666; margin-bottom:15px;">
      <button class="submit-btn" id="save">封存记忆</button>
      <button onclick="document.getElementById('modal').style.display='none'" style="width:100%; background:transparent; border:none; color:#555; margin-top:10px; cursor:pointer;">取消</button>
    </div>
  </div>
  <script>
    const listItems = document.querySelectorAll('.card');
    const search = document.getElementById('search');
    function applyFilters() {
      const activeFilter = document.querySelector('.nav-btn.active').dataset.filter;
      const keyword = search.value.toLowerCase();
      listItems.forEach(card => {
        const cat = card.dataset.cat;
        const hasImg = card.dataset.hasImg === 'true';
        const content = card.dataset.content.toLowerCase();
        let matchFilter = (activeFilter === 'all' || activeFilter === 'timeline') || 
                          (activeFilter === 'album' && hasImg) || (cat === activeFilter);
        let matchKeyword = !keyword || content.includes(keyword);
        card.style.display = (matchFilter && matchKeyword) ? 'block' : 'none';
      });
    }
    document.querySelectorAll('.nav-btn').forEach(btn => {
      btn.onclick = () => {
        document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        applyFilters();
      };
    });
    search.oninput = applyFilters;
    async function deleteItem(id) {
      if (!confirm('彻底抹除这段记忆？')) return;
      await fetch('/api/delete/' + id, { method: 'DELETE' });
      location.reload();
    }
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
      btn.textContent = '存入中...'; btn.disabled = true;
      await fetch('/api/write', {
        method: 'POST', headers: {'Content-Type': 'application/json'},
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

app.get("/mcp", async (req, res) => {
  const mcpServer = createMcpServer();
  const transport = new SSEServerTransport("/messages", res);
  const sid = transport.sessionId;
  transports.set(sid, transport);

  console.log(`[Connect] Session Started: ${sid}`);
  
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
    res.status(404).send("Session Lost");
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 宫殿底座已在端口 ${PORT} 稳固`);
});
