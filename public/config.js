/**
 * 旅團集會點名系統 — 前端共用配置
 * 
 * 架構：Vercel 前端 + 代理 API（共用，由系統管理員控制），
 *       每個旅團只部署自己的 GAS 後端。
 * 
 * 前端運作流程：
 * 1. 用戶從 Portal 帶著 ?u=82&role=leader 進入
 * 2. 前端所有 API 呼叫發送到 /api/proxy（Vercel 代理）
 * 3. Vercel 服務端從私密環境變數 GAS_MAP 找到 82 的 GAS URL
 * 4. 內部轉發到 82 的 GAS，用戶永遠看不到 GAS 地址
 * 
 * 旅團只須部署 GAS，無需部署 Vercel。
 * 系統管理員在 Vercel Dashboard 設定 GAS_MAP 環境變數。
 */

const CONFIG = {
  // 此處無需任何配置。所有 GAS URL 由 Vercel 代理在服務端管理。
};

// 注意：GAS URL 存在 Vercel 環境變數 GAS_MAP 中，不公開。
