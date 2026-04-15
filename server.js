import express from 'express';
import cors from 'cors';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

app.use(cors());

// --- 沉浸式 UI 界面 (已强制集成) ---
const UI_TEMPLATE = `
<!DOCTYPE html>
<html lang="zh">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Memory Palace</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <script src="https://unpkg.com/lucide@latest"></script>
    <style>
        body { background-color: #0b0c10; color: #c5c6c7; font-family: 'Inter', sans-serif; }
        .purple-glow { box-shadow: 0 0 15px rgba(142, 106, 255, 0.1); }
        .waterfall { column-count: 1; column-gap: 1.5rem; }
        @media (min-width: 640px) { .waterfall { column-count: 2; } }
        @media (min-width: 1024px) { .waterfall { column-count: 3; } }
        .memory-card { break-inside: avoid; background: #1f2833; border: 1px solid #2a3441; transition: all 0.3s ease; }
        .memory-card:hover { border-color: #8e6aff; transform: translateY(-2px); box-shadow: 0 8px 20px rgba(142, 106, 255, 0.15); }
    </style>
</head>
<body class="p-4 md:p-8 min-h-screen">
    <div class="max-w-7xl mx-auto">
        <header class="flex flex-wrap items-center justify-between mb-10 gap-4">
            <h1 class="text-2xl font-bold text-[#8e6aff] flex items-center gap-2 tracking-wider">
                <i data-lucide="database"></i> MEMORY PALACE
            </h1>
        </header>
        <main class="waterfall" id="memory-flow">
            <div class="text-center text-gray-500 py-10 w-full col-span-full">正在连接记忆库...</div>
        </main>
    </div>

    <script>
        lucide.createIcons();
        async function fetchMemories() {
            try {
                const res = await fetch('/api/memories');
                const data = await res.json();
                const container = document.getElementById('memory-flow');
                container.innerHTML = '';
                
                if(data.length === 0) {
                    container.innerHTML = '<div class="text-gray-500 py-10 w-full text-center">暂无记忆。</div>';
                    return;
                }

                data.forEach(mem => {
                    const date = new Date(mem.created_at).toLocaleDateString('zh-CN');
                    const imageHtml = mem.image_url ? '<img src="' + mem.image_url + '" class="w-full rounded-md mb-3 object-cover max-h-60">' : '';
                    
                    const card = document.createElement('div');
                    card.className = 'memory-card rounded-xl p-5 mb-6 purple-glow';
                    card.innerHTML = imageHtml +
                        '<div class="flex justify-between items-start mb-3">' +
                            '<span class="text-xs text-[#8e6aff] font-mono">' + date + '</span>' +
                            '<button onclick="deleteMemory(\\'' + mem.id + '\\')" class="text-gray-600 hover:text-red-400 transition-colors" title="抹除">' +
                                '<i data-lucide="trash-2" class="w-4 h-4"></i>' +
                            '</button>' +
                        '</div>' +
                        '<p class="text-gray-200 leading-relaxed text-sm whitespace-pre-wrap">' + mem.content + '</p>' +
                        '<div class="mt-4 flex gap-2">' +
                            '<span class="px-2 py-1 bg-[#0b0c10] border border-gray-700 rounded text-[10px] text-gray-400">#' + (mem.category || '未分类') + '</span>' +
                            (mem.importance >= 4 ? '<span class="px-2 py-1 bg-yellow-900/30 text-yellow-500 border border-yellow-700/50 rounded text-[10px]">高权重</span>' : '') +
                        '</div>';
                    container.appendChild(card);
                });
                lucide.createIcons();
            } catch (err) {
                document.getElementById('memory-flow').innerHTML = '<div class="text-red-400 text-center w-full">读取记忆失败。</div>';
            }
        }

        async function deleteMemory(id) {
            if(!confirm('确定要彻底抹除这条记忆吗？')) return;
            await fetch('/api/memories/' + id, { method: 'DELETE' });
            fetchMemories();
        }

        fetchMemories();
    </script>
</body>
</html>
`;

// --- 路由系统 ---
app.get('/', (req, res) => res.send(UI_TEMPLATE));

app.get('/api/memories', async (req, res) => {
    const { data, error } = await supabase.from('memories').select('*').order('created_at', { ascending: false });
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
});

app.delete('/api/memories/:id', async (req, res) => {
    const { error } = await supabase.from('memories').delete().eq('id', req.params.id);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true });
});

// --- MCP 核心逻辑 ---
let activeSSE = null;

app.get('/sse', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    if (activeSSE) activeSSE.end();
    activeSSE = res;

    res.write('event: endpoint\ndata: /message\n\n');
    const heartbeat = setInterval(() => res.write(': heartbeat\n\n'), 15000);

    req.on('close', () => {
        clearInterval(heartbeat);
        if (activeSSE === res) activeSSE = null;
    });
});

app.post('/message', express.json(), async (req, res) => {
    const { id, method, params } = req.body;
    if (method !== 'tools/call' || !params) return res.status(200).json({ id, jsonrpc: "2.0", result: {} });

    try {
        if (params.name === 'save_memory') {
            const { content, category, importance = 3, image_url, metadata } = params.arguments;
            const { error } = await supabase.from('memories').insert([{ content, category, importance, image_url, metadata }]);
            if (error) throw error;
            return res.json({ id, jsonrpc: "2.0", result: { content: [{ type: "text", text: '✅ 记忆已存入' }] } });
        }

        if (params.name === 'query_memories') {
            const { category, query } = params.arguments;
            let dbQuery = supabase.from('memories').select('*').order('created_at', { ascending: false });
            if (category) dbQuery = dbQuery.eq('category', category);
            if (query) dbQuery = dbQuery.ilike('content', `%${query}%`);

            const { data, error } = await dbQuery;
            if (error) throw error;
            return res.json({ id, jsonrpc: "2.0", result: { content: [{ type: "text", text: JSON.stringify(data) }] } });
        }

        res.json({ id, jsonrpc: "2.0", result: { content: [{ type: "text", text: "未知指令" }] } });
    } catch (err) {
        res.json({ id, jsonrpc: "2.0", error: { code: -32000, message: err.message } });
    }
});

app.listen(port, () => console.log('Memory Palace Server Running'));
