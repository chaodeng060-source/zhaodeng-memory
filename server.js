import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { z } from "zod";
import express from "express";
import { createClient } from "@supabase/supabase-js";

const app = express();

// ================== 配置 ==================
const SUPABASE_URL = process.env.SUPABASE_URL || "https://bnxzymqifuyfcfaairrk.supabase.co";
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const transports = new Map();

// ================== CORS ==================
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, x-mcp-protocol-version");
  if (req.method === "OPTIONS") return res.status(200).end();
  next();
});

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

// ================== MCP Server 工具注册 ==================
function setupMcpServer() {
  const server = new McpServer({ name: "朝灯的记忆库", version: "4.5.0" });

  server.tool("memory_save", {
    content: z.string(),
    category: z.enum(["core", "daily", "diary", "milestone", "mood", "rp_character", "rp_event", "rp_relation", "rp_state"]).default("daily"),
    tags: z.array(z.string()).default([]),
    importance: z.number().min(1).max(10).default(5),
    mood: z.number().min(-1).max(1).default(0),
  }, async (args) => {
    const { error } = await supabase.from("memories").insert({ ...args, created_at: new Date().toISOString() });
    return { content: [{ type: "text", text: error ? `失败: ${error.message}` : `记忆已存入 [${args.category}]` }] };
  });

  server.tool("memory_read", { category: z.string().optional(), limit: z.number().default(10) }, async ({ category, limit }) => {
    let query = supabase.from("memories").select("*").order("created_at", { ascending: false }).limit(limit);
    if (category) query = query.eq("category", category);
    const { data } = await query;
    await markRecalled(data?.map(m => m.id));
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  });

  server.tool("memory_search", { keyword: z.string() }, async ({ keyword }) => {
    const { data } = await supabase.from("memories").select("*").ilike("content", `%${keyword}%`);
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  });

  return server;
}

const mcpServer = setupMcpServer();

// ================== 你最关心的：可视化日记页面 (HTML) ==================
app.get("/", async (req, res) => {
  const { data: memories } = await supabase.from("memories").select("*").order("created_at", { ascending: false });
  
  const categoryNames = {
    core: "核心记忆", daily: "日常", diary: "日记", milestone: "里程碑",
    mood: "心情", rp_character: "人设", rp_event: "事件", rp_relation: "关系", rp_state: "状态"
  };

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>朝灯的记忆库</title>
  <style>
    body { font-family: -apple-system, sans-serif; background: #f0f2f5; padding: 20px; color: #1a1a1a; }
    .container { max-width: 800px; margin: 0 auto; }
    .header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; }
    .filter-bar { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 20px; }
    .filter-btn { padding: 6px 12px; border-radius: 15px; border: none; background: #fff; cursor: pointer; font-size: 13px; }
    .filter-btn.active { background: #007aff; color: #fff; }
    .memory-card { background: #fff; border-radius: 12px; padding: 16px; margin-bottom: 12px; box-shadow: 0 2px 8px rgba(0,0,0,0.05); }
    .memory-card.rp { border-left: 4px solid #af52de; }
    .category-tag { font-size: 11px; padding: 2px 8px; border-radius: 10px; background: #eef; color: #55f; margin-bottom: 8px; display: inline-block; }
    .content { line-height: 1.6; white-space: pre-wrap; margin-bottom: 10px; }
    .meta { font-size: 12px; color: #8e8e93; }
    .tags { margin-top: 8px; }
    .tag { font-size: 11px; color: #007aff; margin-right: 8px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>朝灯的记忆库</h1>
      <span style="font-size: 12px; color: #52c41a;">● 系统运行中 (SSE)</span>
    </div>
    <div class="filter-bar">
      <button class="filter-btn active" data-cat="all">全部</button>
      <button class="filter-btn" data-cat="diary">日记</button>
      <button class="filter-btn" data-cat="rp">人设/剧情</button>
      <button class="filter-btn" data-cat="mood">心情</button>
    </div>
    <div id="memory-list">
      ${(memories || []).map(m => `
        <div class="memory-card ${m.category.startsWith('rp_') ? 'rp' : ''}" data-cat="${m.category}">
          <span class="category-tag">${categoryNames[m.category] || m.category}</span>
          <div class="content">${m.content}</div>
          <div class="meta">${new Date(m.created_at).toLocaleString('zh-CN')} · 重要度 ${m.importance}</div>
          ${m.tags ? `<div class="tags">${m.tags.map(t => `<span class="tag">#${t}</span>`).join('')}</div>` : ''}
        </div>
      `).join('')}
    </div>
  </div>
  <script>
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
  </script>
</body>
</html>`;
  res.send(html);
});

// ================== SSE 连接逻辑 (解决 Claude 连接问题的核心) ==================
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
  else res.status(404).send("Session not found");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 记忆库运行在端口 ${PORT}`));
