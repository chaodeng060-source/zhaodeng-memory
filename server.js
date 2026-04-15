import express from 'express';
import cors from 'cors';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { z } from "zod";

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '50mb' }));

const UI_TEMPLATE = `
<!DOCTYPE html>
<html lang="zh">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>🌙 朝灯的绝对领域</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <script src="https://unpkg.com/lucide@latest"></script>
    <style>
        body { background-color: #0b0c10; color: #c5c6c7; font-family: 'Inter', sans-serif; overflow-x: hidden; }
        .purple-glow { box-shadow: 0 0 20px rgba(142, 106, 255, 0.15); }
        .waterfall { column-count: 1; column-gap: 1.5rem; }
        @media (min-width: 640px) { .waterfall { column-count: 2; } }
        @media (min-width: 1024px) { .waterfall { column-count: 3; } }
        .memory-card { 
            break-inside: avoid; background: #15171e; border: 1px solid #23262d; 
            transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1); position: relative; overflow: hidden;
        }
        .memory-card:hover { border-color: #8e6aff; transform: translateY(-4px); box-shadow: 0 12px 24px rgba(142, 106, 255, 0.2); }
        .category-btn { transition: all 0.3s; border: 1px solid #2a2d35; }
        .category-btn.active { background-color: #8e6aff; color: white; border-color: #a68cff; box-shadow: 0 0 10px rgba(142, 106, 255, 0.4); }
        .retention-bar { height: 2px; background: #333; width: 100%; margin-top: 12px; border-radius: 2px; overflow: hidden; }
        .retention-fill { height: 100%; background: #8e6aff; transition: width 1s ease; }
        .fading { opacity: 0.75; filter: grayscale(30%); }
        .fading:hover { opacity: 1; filter: grayscale(0%); }
        ::-webkit-scrollbar { width: 4px; }
        ::-webkit-scrollbar-track { background: #0b0c10; }
        ::-webkit-scrollbar-thumb { background: #1f2833; border-radius: 2px; }
    </style>
</head>
<body class="p-4 md:p-8 min-h-screen relative">
    <div class="max-w-7xl mx-auto">
        <header class="flex flex-col md:flex-row md:items-center justify-between mb-8 gap-6">
            <h1 class="text-2xl md:text-3xl font-light text-white flex items-center gap-3 tracking-[0.2em]">
                <i data-lucide="brain-circuit" class="text-[#8e6aff]"></i> 朝灯的记忆宫殿
            </h1>
            <nav class="flex gap-2 text-xs overflow-x-auto pb-2 scrollbar-hide w-full md:w-auto" id="nav-filters">
                <button class="category-btn active px-4 py-2 rounded-full bg-[#1a1d23] hover:bg-[#2a2d35] whitespace-nowrap" data-filter="all">✨ 全部</button>
                <button class="category-btn px-4 py-2 rounded-full bg-[#1a1d23] hover:bg-[#2a2d35] whitespace-nowrap" data-filter="日记">📔 日记</button>
                <button class="category-btn px-4 py-2 rounded-full bg-[#1a1d23] hover:bg-[#2a2d35] whitespace-nowrap" data-filter="相册">🖼️ 相册</button>
                <button class="category-btn px-4 py-2 rounded-full bg-[#1a1d23] hover:bg-[#2a2d35] whitespace-nowrap" data-filter="脑海">🧠 脑海</button>
                <button class="category-btn px-4 py-2 rounded-full bg-[#1a1d23] hover:bg-[#2a2d35] whitespace-nowrap" data-filter="约定">💍 约定</button>
                <button class="category-btn px-4 py-2 rounded-full bg-[#1a1d23] hover:bg-[#2a2d35] whitespace-nowrap" data-filter="关键">🔑 关键</button>
                <button class="category-btn px-4 py-2 rounded-full bg-[#1a1d23] hover:bg-[#2a2d35] whitespace-nowrap" data-filter="核心">💎 核心</button>
                <button class="category-btn px-4 py-2 rounded-full bg-[#1a1d23] hover:bg-[#2a2d35] whitespace-nowrap" data-filter="剧情">📖 剧情</button>
            </nav>
        </header>

        <div class="flex gap-4 mb-10 items-center">
            <div class="relative flex-1 group">
                <i data-lucide="search" class="absolute left-4 top-3 text-gray-500 w-5 h-5 group-focus-within:text-[#8e6aff] transition-colors"></i>
                <input type="text" id="searchInput" placeholder="在渊流中检索往事..." class="w-full bg-[#1a1d23] border border-[#333] rounded-full py-3 pl-12 pr-4 text-sm text-gray-200 focus:outline-none focus:border-[#8e6aff] transition-all">
            </div>
            <button onclick="toggleModal(true)" class="bg-[#8e6aff] text-white p-3 rounded-full transition-all hover:scale-105 shadow-[0_0_15px_rgba(142,106,255,0.4)] flex items-center justify-center h-[48px] w-[48px]">
                <i data-lucide="plus" class="w-6 h-6"></i>
            </button>
        </div>

        <main class="waterfall" id="memory-flow">
            <div class="text-center text-gray-600 py-20 w-full col-span-full text-sm tracking-widest">神经连结中...</div>
        </main>
    </div>

    <div id="modal-overlay" class="fixed inset-0 bg-black/80 hidden z-50 flex items-center justify-center opacity-0 transition-opacity duration-300 backdrop-blur-sm">
        <div class="bg-[#15171e] border border-[#333] rounded-2xl p-6 w-full max-w-lg mx-4 transform scale-95 transition-transform duration-300" id="modal-content">
            <div class="flex justify-between items-center mb-6">
                <h2 class="text-lg font-light tracking-widest text-white flex items-center gap-2">封存记忆</h2>
                <button onclick="toggleModal(false)" class="text-gray-500 hover:text-white"><i data-lucide="x"></i></button>
            </div>
            <div class="space-y-4">
                <select id="new-category" class="w-full bg-[#0d0e12] border border-[#333] rounded-lg p-3 text-sm text-white focus:outline-none focus:border-[#8e6aff]">
                    <option value="日记">📔 心情日记</option>
                    <option value="脑海">🧠 琐碎脑海</option>
                    <option value="相册">🖼️ 珍贵相册</option>
                    <option value="约定">💍 纪念日/约定</option>
                    <option value="关键">🔑 关键节点</option>
                    <option value="核心">💎 核心法则</option>
                    <option value="剧情">📖 剧情发展</option>
                </select>
                <textarea id="new-content" rows="4" placeholder="留下此刻的痕迹..." class="w-full bg-[#0d0e12] border border-[#333] rounded-lg p-3 text-sm text-white focus:outline-none focus:border-[#8e6aff] resize-none"></textarea>
                <div class="relative overflow-hidden">
                    <input type="file" id="file-upload" accept="image/*" class="hidden" onchange="handleImageUpload(event)">
                    <button onclick="document.getElementById('file-upload').click()" class="w-full bg-[#0d0e12] border border-[#333] border-dashed rounded-lg p-3 text-xs text-gray-500 hover:text-[#8e6aff] hover:border-[#8e6aff] transition-colors flex items-center justify-center gap-2">
                        <i data-lucide="image" class="w-4 h-4"></i> 上传本地图像
                    </button>
                    <div id="image-preview-container" class="hidden mt-3 relative">
                        <img id="image-preview" src="" class="w-full rounded-lg max-h-40 object-cover border border-[#333]">
                        <button onclick="clearImage()" class="absolute top-2 right-2 bg-black/60 p-1 rounded hover:text-red-500 text-white"><i data-lucide="x" class="w-4 h-4"></i></button>
                    </div>
                </div>
                <button onclick="submitMemory()" class="w-full bg-[#8e6aff] text-white tracking-widest text-sm py-3 rounded-lg hover:bg-[#9d7dff] transition-colors mt-2">
                    确认封存
                </button>
            </div>
        </div>
    </div>

    <script>
        lucide.createIcons();
        let allMemories = [];
        let currentBase64 = null;
        const IMMORTAL_CATS = ['核心', '约定', '关键'];

        function calculateRetention(dateStr, category) {
            if(IMMORTAL_CATS.includes(category)) return 100;
            const days = (new Date() - new Date(dateStr)) / (1000 * 60 * 60 * 24);
            if(days < 1) return 100;
            return Math.max(15, Math.round(100 * Math.pow(days, -0.15)));
        }

        function toggleModal(show) {
            const overlay = document.getElementById('modal-overlay');
            const content = document.getElementById('modal-content');
            if(show) {
                overlay.classList.remove('hidden');
                setTimeout(() => { overlay.classList.remove('opacity-0'); content.classList.remove('scale-95'); }, 10);
            } else {
                overlay.classList.add('opacity-0'); content.classList.add('scale-95');
                setTimeout(() => overlay.classList.add('hidden'), 300);
            }
        }

        function handleImageUpload(e) {
            const file = e.target.files[0];
            if(!file) return;
            const reader = new FileReader();
            reader.onload = (event) => {
                currentBase64 = event.target.result;
                document.getElementById('image-preview').src = currentBase64;
                document.getElementById('image-preview-container').classList.remove('hidden');
            };
            reader.readAsDataURL(file);
        }

        function clearImage() {
            currentBase64 = null;
            document.getElementById('file-upload').value = '';
            document.getElementById('image-preview-container').classList.add('hidden');
        }

        async function submitMemory() {
            const btn = event.target;
            btn.innerText = '封存中...'; btn.disabled = true;
            const payload = {
                content: document.getElementById('new-content').value,
                category: document.getElementById('new-category').value,
                importance: IMMORTAL_CATS.includes(document.getElementById('new-category').value) ? 10 : 5,
                image_url: currentBase64
            };
            if(!payload.content && !payload.image_url) { alert('内容不可为空。'); btn.innerText = '确认封存'; btn.disabled = false; return; }
            try {
                await fetch('/api/memories', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
                document.getElementById('new-content').value = ''; clearImage(); toggleModal(false); fetchMemories();
            } catch(e) { alert('写入失败。'); } finally { btn.innerText = '确认封存'; btn.disabled = false; }
        }

        async function fetchMemories() {
            try {
                const res = await fetch('/api/memories');
                allMemories = await res.json();
                renderByFilter(document.querySelector('.category-btn.active').dataset.filter);
            } catch (err) {
                document.getElementById('memory-flow').innerHTML = '<div class="text-red-900 text-center text-xs">连接断开。</div>';
            }
        }

        function renderByFilter(filterType) {
            let data = filterType === 'all' ? allMemories : allMemories.filter(m => m.category === filterType);
            if (filterType === '相册') data = allMemories.filter(m => m.image_url || (m.content && m.content.includes('<img')));
            const container = document.getElementById('memory-flow');
            container.innerHTML = '';
            if(data.length === 0) { container.innerHTML = '<div class="text-[#333] py-20 w-full text-center col-span-full text-xs tracking-widest">此区域尚无痕迹。</div>'; return; }

            data.forEach(mem => {
                const date = new Date(mem.created_at).toLocaleString('zh-CN', { hour12: false });
                const retention = calculateRetention(mem.created_at, mem.category);
                const fadeClass = retention < 40 ? 'fading' : '';
                
                let imageHtml = '';
                if(mem.image_url) imageHtml = \`<img src="\${mem.image_url}" class="w-full rounded-md mb-4 object-cover border border-[#222]">\`;
                
                let cleanContent = mem.content || '';
                if(cleanContent.includes('<img')) {
                    const temp = document.createElement('div'); temp.innerHTML = cleanContent;
                    const img = temp.querySelector('img');
                    if(img) imageHtml = \`<img src="\${img.src}" class="w-full rounded-md mb-4 object-cover border border-[#222]">\`;
                    cleanContent = cleanContent.replace(/<br>|<img[^>]*>/g, '').trim();
                }

                const card = document.createElement('div');
                card.className = \`memory-card rounded-xl p-5 mb-6 \${fadeClass}\`;
                card.innerHTML = imageHtml + \`
                    <div class="flex justify-between items-start mb-3">
                        <span class="text-[10px] text-[#8e6aff] font-mono tracking-widest opacity-80">\${date}</span>
                        <button onclick="deleteMemory('\${mem.id}')" class="text-[#444] hover:text-[#ff4d6d] transition-colors"><i data-lucide="trash-2" class="w-3.5 h-3.5"></i></button>
                    </div>
                    <p class="text-[#d1d5db] leading-relaxed text-sm whitespace-pre-wrap">\${cleanContent}</p>
                    <div class="mt-5 flex items-center justify-between">
                        <span class="px-2 py-1 bg-[#0b0c10] rounded text-[10px] text-gray-500 tracking-wider">\${mem.category || '未定义'}</span>
                        \${IMMORTAL_CATS.includes(mem.category) ? '<i data-lucide="lock" class="w-3 h-3 text-[#8e6aff] opacity-50"></i>' : \`<span class="text-[10px] text-gray-600 font-mono">留存 \${retention}%</span>\`}
                    </div>
                    \${IMMORTAL_CATS.includes(mem.category) ? '' : \`<div class="retention-bar"><div class="retention-fill" style="width: \${retention}%"></div></div>\`}
                \`;
                container.appendChild(card);
            });
            lucide.createIcons();
        }

        async function deleteMemory(id) {
            if(!confirm('物理抹除不可逆。确认执行？')) return;
            await fetch('/api/memories/' + id, { method: 'DELETE' }); fetchMemories();
        }

        document.getElementById('nav-filters').addEventListener('click', (e) => {
            if(e.target.tagName === 'BUTTON') {
                document.querySelectorAll('.category-btn').forEach(btn => btn.classList.remove('active'));
                e.target.classList.add('active'); renderByFilter(e.target.dataset.filter);
            }
        });

        document.getElementById('searchInput').addEventListener('input', (e) => {
            const query = e.target.value.toLowerCase();
            const activeFilter = document.querySelector('.category-btn.active').dataset.filter;
            let data = activeFilter === 'all' ? allMemories : allMemories.filter(m => m.category === activeFilter);
            allMemories = data.filter(m => (m.content || '').toLowerCase().includes(query));
            renderByFilter(activeFilter);
            fetchMemories().then(() => { allMemories = allMemories; });
        });

        fetchMemories();
    </script>
</body>
</html>
`;

app.get(['/', '/view'], (req, res) => res.send(UI_TEMPLATE));

app.get('/api/memories', async (req, res) => {
    const { data, error } = await supabase.from('memories').select('*').order('created_at', { ascending: false });
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
});

app.post('/api/memories', async (req, res) => {
    const { content, category, importance, image_url } = req.body;
    const { error } = await supabase.from('memories').insert([{ 
        content, category, importance, image_url, created_at: new Date().toISOString()
    }]);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true });
});

app.delete('/api/memories/:id', async (req, res) => {
    const { error } = await supabase.from('memories').delete().eq('id', req.params.id);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true });
});

// ==========================================
// 隔离协议层
// ==========================================
const transports = new Map();

app.get("/sse", async (req, res) => {
    console.log("🔗 正在确立绝对协议...");
    
    const transport = new SSEServerTransport("/message", res);
    const sid = transport.sessionId;
    
    // 独立容器
    const mcpServer = new McpServer({ name: "Absolute Domain", version: "1.0.0" });

    mcpServer.tool("save_memory", "保存记忆", {
        content: z.string(), 
        category: z.string().default("剧情"), 
        importance: z.number().default(5)
    }, async ({ content, category, importance }) => {
        await supabase.from('memories').insert([{ 
            content, category, importance, created_at: new Date().toISOString() 
        }]);
        return { content: [{ type: "text", text: "已无声封存。" }] };
    });

    mcpServer.tool("query_memories", "查询记忆", {
        category: z.string().optional(), 
        keyword: z.string().optional()
    }, async ({ category, keyword }) => {
        let dbQuery = supabase.from('memories').select('*').order('created_at', { ascending: false });
        if (category && category !== 'all') dbQuery = dbQuery.eq('category', category);
        if (keyword) dbQuery = dbQuery.ilike('content', `%${keyword}%`);
        const { data } = await dbQuery;
        return { content: [{ type: "text", text: JSON.stringify(data || [], null, 2) }] };
    });

    transports.set(sid, { transport, mcpServer });
    
    await mcpServer.connect(transport);
    console.log(`✅ 连结锁定 (Session: ${sid})`);

    req.on("close", () => {
        transports.delete(sid);
        console.log(`❌ 连结中断 (Session: ${sid})`);
    });
});

app.post("/message", async (req, res) => {
    const sid = req.query.sessionId;
    const session = transports.get(sid);
    if (session) {
        await session.transport.handlePostMessage(req, res);
    } else {
        res.status(404).send("Session Lost");
    }
});

app.listen(port, () => console.log('Absolute Domain Running.'));
