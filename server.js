import express from 'express';
import cors from 'cors';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { z } from "zod";

dotenv.config();

const app = express();
const port = process.env.PORT || 10000;
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '50mb' }));

// ==========================================
// UI
// ==========================================
const UI_TEMPLATE = `<!DOCTYPE html>
<html lang="zh">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>🌙 朝灯的绝对领域</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <script src="https://unpkg.com/lucide@latest"></script>
    <style>
        body { background-color: #0b0c10; color: #c5c6c7; font-family: 'Inter', sans-serif; }
        .memory-card { break-inside: avoid; background: #15171e; border: 1px solid #23262d; transition: all 0.4s; }
        .memory-card:hover { border-color: #8e6aff; transform: translateY(-4px); box-shadow: 0 12px 24px rgba(142, 106, 255, 0.2); }
        .category-btn { transition: all 0.3s; border: 1px solid #2a2d35; }
        .category-btn.active { background-color: #8e6aff; color: white; border-color: #a68cff; }
        .waterfall { column-count: 1; column-gap: 1.5rem; }
        @media (min-width: 640px) { .waterfall { column-count: 2; } }
        @media (min-width: 1024px) { .waterfall { column-count: 3; } }
        .retention-bar { height: 2px; background: #333; width: 100%; margin-top: 12px; }
        .retention-fill { height: 100%; background: #8e6aff; }
        .fading { opacity: 0.75; filter: grayscale(30%); }
    </style>
</head>
<body class="p-4 md:p-8 min-h-screen">
    <div class="max-w-7xl mx-auto">
        <header class="flex flex-col md:flex-row md:items-center justify-between mb-8 gap-6">
            <h1 class="text-2xl md:text-3xl font-light text-white flex items-center gap-3 tracking-widest">
                <i data-lucide="brain-circuit" class="text-[#8e6aff]"></i> 朝灯的记忆宫殿
            </h1>
            <nav class="flex gap-2 text-xs overflow-x-auto pb-2" id="nav-filters">
                <button class="category-btn active px-4 py-2 rounded-full bg-[#1a1d23]" data-filter="all">✨ 全部</button>
                <button class="category-btn px-4 py-2 rounded-full bg-[#1a1d23]" data-filter="日记">📔 日记</button>
                <button class="category-btn px-4 py-2 rounded-full bg-[#1a1d23]" data-filter="相册">🖼️ 相册</button>
                <button class="category-btn px-4 py-2 rounded-full bg-[#1a1d23]" data-filter="脑海">🧠 脑海</button>
                <button class="category-btn px-4 py-2 rounded-full bg-[#1a1d23]" data-filter="约定">💍 约定</button>
                <button class="category-btn px-4 py-2 rounded-full bg-[#1a1d23]" data-filter="关键">🔑 关键</button>
                <button class="category-btn px-4 py-2 rounded-full bg-[#1a1d23]" data-filter="核心">💎 核心</button>
                <button class="category-btn px-4 py-2 rounded-full bg-[#1a1d23]" data-filter="剧情">📖 剧情</button>
            </nav>
        </header>
        <div class="flex gap-4 mb-10 items-center">
            <div class="relative flex-1">
                <i data-lucide="search" class="absolute left-4 top-3 text-gray-500 w-5 h-5"></i>
                <input type="text" id="searchInput" placeholder="检索往事..." class="w-full bg-[#1a1d23] border border-[#333] rounded-full py-3 pl-12 pr-4 text-sm text-gray-200 focus:outline-none focus:border-[#8e6aff]">
            </div>
            <button onclick="toggleModal(true)" class="bg-[#8e6aff] text-white p-3 rounded-full hover:scale-105 shadow-lg">
                <i data-lucide="plus" class="w-6 h-6"></i>
            </button>
        </div>
        <main class="waterfall" id="memory-flow"><div class="text-center text-gray-600 py-20">神经连结中...</div></main>
    </div>
    <div id="modal-overlay" class="fixed inset-0 bg-black/80 hidden z-50 flex items-center justify-center backdrop-blur-sm">
        <div class="bg-[#15171e] border border-[#333] rounded-2xl p-6 w-full max-w-lg mx-4" id="modal-content">
            <div class="flex justify-between items-center mb-6">
                <h2 class="text-lg font-light tracking-widest text-white">封存记忆</h2>
                <button onclick="toggleModal(false)" class="text-gray-500 hover:text-white"><i data-lucide="x"></i></button>
            </div>
            <div class="space-y-4">
                <select id="new-category" class="w-full bg-[#0d0e12] border border-[#333] rounded-lg p-3 text-sm text-white focus:border-[#8e6aff]">
                    <option value="日记">📔 心情日记</option>
                    <option value="脑海">🧠 琐碎脑海</option>
                    <option value="相册">🖼️ 珍贵相册</option>
                    <option value="约定">💍 纪念日/约定</option>
                    <option value="关键">🔑 关键节点</option>
                    <option value="核心">💎 核心法则</option>
                    <option value="剧情">📖 剧情发展</option>
                </select>
                <textarea id="new-content" rows="4" placeholder="留下此刻的痕迹..." class="w-full bg-[#0d0e12] border border-[#333] rounded-lg p-3 text-sm text-white resize-none"></textarea>
                <input type="file" id="file-upload" accept="image/*" class="hidden" onchange="handleImageUpload(event)">
                <button onclick="document.getElementById('file-upload').click()" class="w-full bg-[#0d0e12] border border-dashed border-[#333] rounded-lg p-3 text-xs text-gray-500 hover:text-[#8e6aff] hover:border-[#8e6aff] flex items-center justify-center gap-2">
                    <i data-lucide="image" class="w-4 h-4"></i> 上传图像
                </button>
                <div id="image-preview-container" class="hidden mt-3 relative">
                    <img id="image-preview" class="w-full rounded-lg max-h-40 object-cover border border-[#333]">
                    <button onclick="clearImage()" class="absolute top-2 right-2 bg-black/60 p-1 rounded text-white hover:text-red-500"><i data-lucide="x" class="w-4 h-4"></i></button>
                </div>
                <button onclick="submitMemory()" class="w-full bg-[#8e6aff] text-white text-sm py-3 rounded-lg hover:bg-[#9d7dff]">确认封存</button>
            </div>
        </div>
    </div>
    <script>
        lucide.createIcons();
        let allMemories = [], currentBase64 = null;
        const IMMORTAL = ['核心', '约定', '关键'];
        function calcRetention(d, c) { if(IMMORTAL.includes(c)) return 100; const days = (Date.now() - new Date(d)) / 864e5; return days < 1 ? 100 : Math.max(15, Math.round(100 * Math.pow(days, -0.15))); }
        function toggleModal(s) { const o = document.getElementById('modal-overlay'); s ? o.classList.remove('hidden') : o.classList.add('hidden'); }
        function handleImageUpload(e) { const f = e.target.files[0]; if(!f) return; const r = new FileReader(); r.onload = ev => { currentBase64 = ev.target.result; document.getElementById('image-preview').src = currentBase64; document.getElementById('image-preview-container').classList.remove('hidden'); }; r.readAsDataURL(f); }
        function clearImage() { currentBase64 = null; document.getElementById('file-upload').value = ''; document.getElementById('image-preview-container').classList.add('hidden'); }
        async function submitMemory() { const p = { content: document.getElementById('new-content').value, category: document.getElementById('new-category').value, importance: IMMORTAL.includes(document.getElementById('new-category').value) ? 10 : 5, image_url: currentBase64 }; if(!p.content && !p.image_url) return alert('内容不可为空'); await fetch('/api/memories', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(p) }); document.getElementById('new-content').value = ''; clearImage(); toggleModal(false); fetchMemories(); }
        async function fetchMemories() { try { allMemories = await (await fetch('/api/memories')).json(); render(document.querySelector('.category-btn.active').dataset.filter); } catch(e) { document.getElementById('memory-flow').innerHTML = '<div class="text-red-500 text-center">连接断开</div>'; } }
        function render(f) { let d = f === 'all' ? allMemories : allMemories.filter(m => m.category === f); if(f === '相册') d = allMemories.filter(m => m.image_url); const c = document.getElementById('memory-flow'); c.innerHTML = ''; if(!d.length) { c.innerHTML = '<div class="text-gray-600 py-20 text-center">此区域尚无痕迹</div>'; return; } d.forEach(m => { const ret = calcRetention(m.created_at, m.category), fade = ret < 40 ? 'fading' : ''; const card = document.createElement('div'); card.className = 'memory-card rounded-xl p-5 mb-6 ' + fade; card.innerHTML = (m.image_url ? '<img src="'+m.image_url+'" class="w-full rounded-md mb-4 object-cover">' : '') + '<div class="flex justify-between mb-3"><span class="text-[10px] text-[#8e6aff] font-mono">'+new Date(m.created_at).toLocaleString('zh-CN')+'</span><button onclick="del(\\''+m.id+'\\')"><i data-lucide="trash-2" class="w-3.5 h-3.5 text-gray-600 hover:text-red-500"></i></button></div><p class="text-gray-300 text-sm whitespace-pre-wrap">'+(m.content||'')+'</p><div class="mt-4 flex justify-between items-center"><span class="px-2 py-1 bg-[#0b0c10] rounded text-[10px] text-gray-500">'+(m.category||'')+'</span>'+(IMMORTAL.includes(m.category)?'<i data-lucide="lock" class="w-3 h-3 text-[#8e6aff]"></i>':'<span class="text-[10px] text-gray-600">'+ret+'%</span>')+'</div>'+(IMMORTAL.includes(m.category)?'':'<div class="retention-bar mt-3"><div class="retention-fill" style="width:'+ret+'%"></div></div>'); c.appendChild(card); }); lucide.createIcons(); }
        async function del(id) { if(!confirm('确认删除？')) return; await fetch('/api/memories/'+id, {method:'DELETE'}); fetchMemories(); }
        document.getElementById('nav-filters').onclick = e => { if(e.target.dataset.filter) { document.querySelectorAll('.category-btn').forEach(b => b.classList.remove('active')); e.target.classList.add('active'); render(e.target.dataset.filter); } };
        document.getElementById('searchInput').oninput = e => { const q = e.target.value.toLowerCase(); render(document.querySelector('.category-btn.active').dataset.filter); document.querySelectorAll('.memory-card').forEach(c => c.style.display = c.textContent.toLowerCase().includes(q) ? '' : 'none'); };
        fetchMemories();
    </script>
</body>
</html>`;

app.get(['/', '/view'], (req, res) => res.send(UI_TEMPLATE));

// ==========================================
// REST API
// ==========================================
app.get('/api/memories', async (req, res) => {
    const { data, error } = await supabase.from('memories').select('*').order('created_at', { ascending: false });
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
});

app.post('/api/memories', async (req, res) => {
    const { content, category, importance, image_url } = req.body;
    const { error } = await supabase.from('memories').insert([{ content, category, importance, image_url, created_at: new Date().toISOString() }]);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true });
});

app.delete('/api/memories/:id', async (req, res) => {
    const { error } = await supabase.from('memories').delete().eq('id', req.params.id);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true });
});

// ==========================================
// MCP Server - SSE 模式
// ==========================================
const sessions = new Map();

function createMcpServer() {
    const server = new McpServer({ name: "朝灯的绝对领域", version: "1.0.0" });

    server.tool("save_memory", "保存记忆到朝灯的记忆库", {
        content: z.string().describe("记忆内容"),
        category: z.string().default("剧情").describe("分类：日记/脑海/相册/约定/关键/核心/剧情"),
        importance: z.number().default(5).describe("重要度1-10")
    }, async ({ content, category, importance }) => {
        const { error } = await supabase.from('memories').insert([{ 
            content, category, importance, created_at: new Date().toISOString() 
        }]);
        return { content: [{ type: "text", text: error ? `封存失败: ${error.message}` : "已封存。" }] };
    });

    server.tool("query_memories", "查询朝灯的记忆", {
        category: z.string().optional().describe("按分类筛选"),
        keyword: z.string().optional().describe("按关键词搜索"),
        limit: z.number().default(20).describe("返回数量")
    }, async ({ category, keyword, limit }) => {
        let q = supabase.from('memories').select('*').order('created_at', { ascending: false }).limit(limit);
        if (category && category !== 'all') q = q.eq('category', category);
        if (keyword) q = q.ilike('content', `%${keyword}%`);
        const { data, error } = await q;
        if (error) return { content: [{ type: "text", text: `查询失败: ${error.message}` }] };
        if (!data?.length) return { content: [{ type: "text", text: "无相关记忆。" }] };
        return { content: [{ type: "text", text: data.map(m => `[${m.category}] ${m.created_at}\n${m.content}`).join('\n---\n') }] };
    });

    server.tool("delete_memory", "删除指定记忆", {
        id: z.string().describe("记忆的ID")
    }, async ({ id }) => {
        const { error } = await supabase.from('memories').delete().eq('id', id);
        return { content: [{ type: "text", text: error ? `删除失败: ${error.message}` : "已删除。" }] };
    });

    return server;
}

// SSE 连接端点 - GET /mcp
app.get("/mcp", async (req, res) => {
    console.log("🔗 SSE 连接...");
    
    const transport = new SSEServerTransport("/mcp", res);
    const server = createMcpServer();
    const sid = transport.sessionId;
    
    sessions.set(sid, { server, transport });
    
    await server.connect(transport);
    console.log(`✅ 会话: ${sid}`);
    
    req.on("close", () => {
        sessions.delete(sid);
        console.log(`❌ 断开: ${sid}`);
    });
});

// 消息处理端点 - POST /mcp
app.post("/mcp", async (req, res) => {
    const sid = req.query.sessionId;
    console.log(`📨 消息 sid=${sid}`);
    
    const session = sessions.get(sid);
    if (!session) {
        return res.status(404).json({ error: "Session not found" });
    }
    
    await session.transport.handlePostMessage(req, res);
});

app.get('/health', (req, res) => res.json({ status: 'ok', sessions: sessions.size }));

app.listen(port, () => console.log(`🌙 运行中 - 端口 ${port}`));
