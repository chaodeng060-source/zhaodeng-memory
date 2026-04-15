import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { z } from "zod";
import express from "express";
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "crypto";

const app = express();

// ================== Supabase 配置 ==================
const SUPABASE_URL = process.env.SUPABASE_URL || "https://bnxzymqifuyfcfaairrk.supabase.co";
const SUPABASE_KEY = process.env.SUPABASE_KEY; 
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ================== CORS 深度重构（绝对放行） ==================
app.use((req, res, next) => {
  const origin = req.headers.origin || '*';
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, PATCH, DELETE');
  res.setHeader('Access-Control-Allow-Headers', req.headers['access-control-request-headers'] || '*');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  next();
});

app.use(express.json());

// ================== 遗忘曲线计算 ==================
function calculateScore(memory) {
  const now = new Date();
  const created = new Date(memory.created_at);
  const daysPassed = (now - created) / (1000 * 60 * 60 * 24);
  
  let decayRate = 0;
  if (memory.category === 'daily') decayRate = 0.05;
  if (memory.category === 'mood') decayRate = 0.03;
  if (memory.category === 'rp_state') decayRate = 0.02;

  return (memory.importance / 10) * Math.exp(-decayRate * daysPassed);
}

// ================== 更新回忆记录 ==================
async function markRecalled(ids) {
  if (!ids || ids.length === 0) return;
  for (const id of ids) {
    await supabase.from('memories').update({ last_recalled: new Date().toISOString() }).eq('id', id);
  }
}

// ================== 创建 MCP Server 工厂函数 ==================
function createMcpServer() {
  const server = new McpServer({ name: "朝灯的记忆库", version: "3.4.0" });

  server.tool("memory_save", {
    content: z.string().describe("记忆内容"),
    category: z.enum(['core', 'daily', 'diary', 'milestone', 'mood', 'rp_character', 'rp_event', 'rp_relation', 'rp_state']).default('daily'),
    tags: z.array(z.string()).default([]),
    importance: z.number().min(1).max(10).default(5),
    mood: z.number().min(-1).max(1).default(0)
  }, async ({ content, category, tags, importance, mood }) => {
    const { error } = await supabase.from('memories').insert({
      content, category, tags, importance, mood,
      created_at: new Date().toISOString(),
      last_recalled: new Date().toISOString(),
      recall_count: 0
    });
    if (error) return { content: [{ type: "text", text: `保存失败：${error.message}` }] };
    return { content: [{ type: "text", text: `记忆已保存，分类：${category}` }] };
  });

  server.tool("memory_read", {
    category: z.enum(['core', 'daily', 'diary', 'milestone', 'mood', 'rp_character', 'rp_event', 'rp_relation', 'rp_state']).optional(),
    limit: z.number().min(1).max(50).default(10)
  }, async ({ category, limit }) => {
    let query = supabase.from('memories').select('*').order('created_at', { ascending: false }).limit(limit);
    if (category) query = query.eq('category', category);
    const { data, error } = await query;
    if (error) return { content: [{ type: "text", text: `读取失败：${error.message}` }] };
    await markRecalled(data.map(m => m.id));
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  });

  server.tool("memory_search", {
    keyword: z.string(),
    limit: z.number().min(1).max(50).default(10)
  }, async ({ keyword, limit }) => {
    const { data, error } = await supabase.from('memories').select('*').ilike('content', `%${keyword}%`).limit(limit);
    if (error) return { content: [{ type: "text", text: `搜索失败：${error.message}` }] };
    await markRecalled(data.map(m => m.id));
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  });

  server.tool("memory_surface", {
    limit: z.number().min(1).max(20).default(5)
  }, async ({ limit }) => {
    const { data, error } = await supabase.from('memories').select('*');
    if (error) return { content: [{ type: "text", text: `浮现失败：${error.message}` }] };
    const sorted = data.sort((a, b) => calculateScore(b) - calculateScore(a)).slice(0, limit);
    await markRecalled(sorted.map(m => m.id));
    return { content: [{ type: "text", text: "以下是根据遗忘曲线为您提取的当前最高权重记忆：\n" + JSON.stringify(sorted, null, 2) }] };
  });

  server.tool("memory_diary", {
    title: z.string(),
    content: z.string(),
    mood: z.number().min(-1).max(1).default(0),
    tags: z.array(z.string()).default([])
  }, async ({ title, content, mood, tags }) => {
    const { error } = await supabase.from('memories').insert({
      content: `【${title}】\n${content}`,
      category: 'diary', tags, importance: 8, mood,
      created_at: new Date().toISOString(),
      last_recalled: new Date().toISOString(),
      recall_count: 0
    });
    if (error) return { content: [{ type: "text", text: `日记保存失败：${error.message}` }] };
    return { content: [{ type: "text", text: `日记《${title}》已永久保存。` }] };
  });

  server.tool("memory_stats", {}, async () => {
    const { data, error } = await supabase.from('memories').select('category');
    if (error) return { content: [{ type: "text", text: `统计失败：${error.message}` }] };
    const stats = {
      total: data.length,
      core: data.filter(m => m.category === 'core').length,
      daily: data.filter(m => m.category === 'daily').length,
      diary: data.filter(m => m.category === 'diary').length,
      milestone: data.filter(m => m.category === 'milestone').length,
      mood: data.filter(m => m.category === 'mood').length,
      rp_character: data.filter(m => m.category === 'rp_character').length,
      rp_event: data.filter(m => m.category === 'rp_event').length,
      rp_relation: data.filter(m => m.category === 'rp_relation').length,
      rp_state: data.filter(m => m.category === 'rp_state').length,
    };
    return { content: [{ type: "text", text: `记忆库统计：\n总记录数：${stats.total}\n━━━ 日常记忆 ━━━\n核心：${stats.core} | 日常：${stats.daily} | 日记：${stats.diary} | 里程碑：${stats.milestone} | 情绪：${stats.mood}\n━━━ 角色扮演 ━━━\n人物设定：${stats.rp_character} | 剧情事件：${stats.rp_event} | 关系变化：${stats.rp_relation} | 情感状态：${stats.rp_state}` }] };
  });

  server.tool("rp_save", {
    type: z.enum(['character', 'event', 'relation', 'state']),
    character_name: z.string(),
    content: z.string(),
    importance: z.number().min(1).max(10).default(7),
    tags: z.array(z.string()).default([])
  }, async ({ type, character_name, content, importance, tags }) => {
    const { error } = await supabase.from('memories').insert({
      content: `[${character_name}] ${content}`,
      category: `rp_${type}`,
      tags: [character_name, ...tags],
      importance, mood: 0,
      created_at: new Date().toISOString(),
      last_recalled: new Date().toISOString(),
      recall_count: 0
    });
    if (error) return { content: [{ type: "text", text: `保存失败：${error.message}` }] };
    return { content: [{ type: "text", text: `角色扮演记忆已保存 [${character_name}] - ${type}` }] };
  });

  server.tool("rp_read", {
    character_name: z.string().optional(),
    type: z.enum(['character', 'event', 'relation', 'state', 'all']).default('all'),
    limit: z.number().min(1).max(50).default(20)
  }, async ({ character_name, type, limit }) => {
    let query = supabase.from('memories').select('*').order('created_at', { ascending: false }).limit(limit);
    if (type !== 'all') query = query.eq('category', `rp_${type}`);
    else query = query.in('category', ['rp_character', 'rp_event', 'rp_relation', 'rp_state']);
    if (character_name) query = query.contains('tags', [character_name]);
    const { data, error } = await query;
    if (error) return { content: [{ type: "text", text: `读取失败：${error.message}` }] };
    await markRecalled(data.map(m => m.id));
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  });

  return server;
}

// ================== 网页查看界面 ==================
app.get("/view", async (req, res) => {
  const { data } = await supabase.from('memories').select('*').order('created_at', { ascending: false }).limit(100);
  const categoryNames = {
    core: '💎 核心', daily: '📅 日常', diary: '📔 日记', milestone: '🏆 里程碑', mood: '💭 情绪',
    rp_character: '👤 人物设定', rp_event: '📖 剧情事件', rp_relation: '💕 关系变化', rp_state: '🎭 情感状态'
  };
  const html = `<!DOCTYPE html><html lang="zh"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>朝灯的记忆库</title><style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:linear-gradient(135deg,#1a1a2e 0%,#16213e 100%);min-height:100vh;color:#eee;padding:20px}h1{text-align:center;margin-bottom:30px;color:#a78bfa}.filter-bar{display:flex;flex-wrap:wrap;gap:8px;justify-content:center;margin-bottom:20px}.filter-btn{padding:8px 16px;border:none;border-radius:20px;cursor:pointer;background:#374151;color:#eee;transition:all .2s}.filter-btn:hover,.filter-btn.active{background:#8b5cf6}.memory-card{background:rgba(255,255,255,.05);border-radius:12px;padding:16px;margin-bottom:16px;border-left:4px solid #8b5cf6}.memory-card.rp{border-left-color:#f472b6}.category-tag{display:inline-block;padding:4px 10px;border-radius:12px;font-size:12px;background:#8b5cf6;margin-bottom:8px}.memory-card.rp .category-tag{background:#ec4899}.content{white-space:pre-wrap;line-height:1.6;margin:10px 0}.meta{font-size:12px;color:#9ca3af}.tags{margin-top:8px}.tag{display:inline-block;padding:2px 8px;border-radius:8px;font-size:11px;background:rgba(139,92,246,.3);margin-right:6px}</style></head><body><h1>🌙 朝灯的记忆库</h1><div class="filter-bar"><button class="filter-btn active" data-cat="all">全部</button><button class="filter-btn" data-cat="diary">📔 日记</button><button class="filter-btn" data-cat="milestone">🏆 里程碑</button><button class="filter-btn" data-cat="core">💎 核心</button><button class="filter-btn" data-cat="rp">🎭 角色扮演</button></div><div id="memories">${(data||[]).map(m=>`<div class="memory-card ${m.category.startsWith('rp_')?'rp':''}" data-cat="${m.category}"><span class="category-tag">${categoryNames[m.category]||m.category}</span><div class="content">${m.content.replace(/</g,'&lt;').replace(/>/g,'&gt;')}</div><div class="meta">${new Date(m.created_at).toLocaleString('zh-CN')} · 重要度 ${m.importance}/10${m.mood!==0?` · 情绪 ${m.mood>0?'😊':'😢'} ${m.mood}`:''}</div>${m.tags&&m.tags.length?`<div class="tags">${m.tags.map(t=>`<span class="tag">#${t}</span>`).join('')}</div>`:''}</div>`).join('')}</div><script>document.querySelectorAll('.filter-btn').forEach(btn=>{btn.addEventListener('click',()=>{document.querySelectorAll('.filter-btn').forEach(b=>b.classList.remove('active'));btn.classList.add('active');const cat=btn.dataset.cat;document.querySelectorAll('.memory-card').forEach(card=>{if(cat==='all')card.style.display='block';else if(cat==='rp')card.style.display=card.dataset.cat.startsWith('rp_')?'block':'none';else card.style.display=card.dataset.cat===cat?'block':'none'})})});</script></body></html>`;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(html);
});

// ================== MCP SSE 通信端点 ==================
const sessions = new Map();

// 1. 建立 SSE 连接通道
app.get("/mcp", async (req, res) => {
  const sessionId = randomUUID();
  
  // 强制解算绝对路径，抹杀 Claude 客户端的所有解析歧义
  const protocol = req.headers['x-forwarded-proto'] || 'https';
  const host = req.headers.host;
  const absoluteEndpoint = `${protocol}://${host}/mcp/messages?sessionId=${sessionId}`;
  
  const transport = new SSEServerTransport(absoluteEndpoint, res);
  const server = createMcpServer();
  
  await server.connect(transport);
  sessions.set(sessionId, transport);
  
  console.log(`[MCP] 通道已建立: ${sessionId} -> 绝对路径: ${absoluteEndpoint}`);
  
  req.on('close', () => {
    sessions.delete(sessionId);
    console.log(`[MCP] 通道已断开: ${sessionId}`);
  });
});

// 2. 接收工具调用指令
app.post("/mcp/messages", async (req, res) => {
  const sessionId = req.query.sessionId;
  const transport = sessions.get(sessionId);
  
  if (!transport) {
    return res.status(404).json({ error: "会话已过期或不存在" });
  }
  
  try {
    await transport.handlePostMessage(req, res);
  } catch (error) {
    console.error(`[MCP] 指令执行异常: ${error.message}`);
  }
});

// 健康检查
app.get("/", (req, res) => {
  res.json({ status: "running", owner: "朝灯", version: "3.4.0 (SSE Transport Absolute)" });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`记忆库 3.4.0 (SSE) 端口 ${PORT}`));
