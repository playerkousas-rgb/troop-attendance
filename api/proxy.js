/**
 * Vercel 私密代理 API
 * 
 * 作用：前端不直接連 GAS，而是經過這個代理。
 * 代理在 Vercel 服務端讀取私密環境變數 GAS_MAP，
 * 內部轉發到對應旅團的 GAS URL，用戶永遠看不到 GAS 地址。
 * 
 * 環境變數（在 Vercel Dashboard 設定）：
 *   GAS_MAP = {"82":"https://script.google.com/...","83":"https://..."}
 *   GAS_API_KEY = xxxxxxxx（可選，若設定則 GAS 也會驗證）
 */

export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const u = req.query.u;
  if (!u) return res.status(400).json({ ok: false, error: 'Missing u parameter' });

  // 從環境變數讀取 GAS URL 映射（私密，用戶不可見）
  let gasMap = {};
  try {
    gasMap = JSON.parse(process.env.GAS_MAP || '{}');
  } catch (e) {
    return res.status(500).json({ ok: false, error: 'Invalid GAS_MAP configuration' });
  }

  const gasUrl = gasMap[u];
  if (!gasUrl) {
    return res.status(404).json({ ok: false, error: 'Unit not registered: ' + u });
  }

  // 構造目標 URL（複製所有 query 參數）
  const url = new URL(gasUrl);
  Object.keys(req.query).forEach(key => {
    url.searchParams.set(key, req.query[key]);
  });

  // ★ 第3級安全機制：**強制**附加 API_KEY
  //   即使有人猜到或知道 GAS URL，沒有正確 api_key 也完全無法讀取任何資料。
  //   這是 tier 3 的核心防護（u 只防跨單位，API_KEY 防直接 URL 存取）。
  if (!process.env.GAS_API_KEY) {
    return res.status(500).json({ ok: false, error: 'System misconfigured: GAS_API_KEY must be set in Vercel for tier 3 security' });
  }
  url.searchParams.set('api_key', process.env.GAS_API_KEY);

  try {
    const response = await fetch(url.toString(), {
      method: req.method,
      headers: { 'Content-Type': 'application/json' },
      body: req.method === 'POST' ? JSON.stringify(req.body) : undefined
    });

    const text = await response.text();
    res.status(response.status).setHeader('Content-Type', 'application/json').send(text);
  } catch (err) {
    res.status(500).json({ ok: false, error: 'Proxy error: ' + err.message });
  }
}
