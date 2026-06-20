# 📝 旅團集會點名系統（troop-attendance）

> **第3級元件（變體）** — Vercel 前端 + 代理 API 共用，每旅團只部署 GAS 後端。
>
> **核心安全設計：GAS URL 不暴露給任何用戶。** 由 Vercel 私密代理在服務端管理，旅團之間互相看不到彼此的後端。
>
> ⚠️ **點名系統與旅團主系統完全分離。** 點名紀錄存放在獨立的 Google Sheet 中，
> 可以安全地分享給領袖使用，不會暴露主系統的財務/密碼等敏感資料。

## 功能簡介

- 按 **支部**（幼童軍、童軍、深資童軍、樂行）分頁點名
- 橫向矩陣式集會紀錄（A=YMIS號，B=姓名，C=支部，D=小隊，E=角色，F 起為日期欄位）
- **自動同步**：每次載入時自動從旅團主系統讀取最新成員名單
- **離隊處理**：已離隊成員自動標記 `left`，不顯示但保留歷史紀錄
- **領袖點名**：P(出席)/A(缺席)/L(遲到)/E(請假)/S(病假) 一鍵標記，即時儲存回 Google Sheet
- **找回修改**：選擇過去日期，可修改已儲存的點名紀錄
- **成員查紀錄**：用 YMIS/Email 登入，查看個人歷史出席
- **小隊隊長視圖**：登入後可查看自己小隊所有隊員的出席矩陣
- **領袖查詢個別成員**：輸入姓名或 YMIS，查看任何成員的完整出席紀錄與統計
- **匯出**：Word (.docx) / CSV / 瀏覽器直接列印

## 系統架構（共用前端 + 私密代理 + 各自後端）

```
┌─────────────────────────────────────────────────────────────┐
│  troop-router（公開 Registry）                              │
│  ├── plugins: troop_attendance（tier 3, url 留空）            │
│  └── units: 82                                              │
│       └── endpoints.troop_attendance = Vercel 前端 URL        │
│  （❌ 這裡沒有 gas 字段，GAS URL 不公開）                    │
└─────────────────────────────────────────────────────────────┘
                              │
                              │ 用戶點開卡片
                              ▼
┌─────────────────────────────────────────────────────────────┐
│  共用 Vercel 前端（1份，系統管理員控制）                     │
│  https://troop-attendance.vercel.app/?u=82&role=leader     │
│                                                             │
│  前端 JS 看不到 GAS URL，所有 API 請求發到：                 │
│  /api/proxy?u=82&action=getConfig                           │
│                                                             │
│  用戶抓包也只能看到 Vercel URL，看不到 GAS 地址              │
└─────────────────────────────────────────────────────────────┘
                              │
                              │ Vercel 服務端內部處理
                              ▼
┌─────────────────────────────────────────────────────────────┐
│  Vercel 代理 API（私密環境變數）                             │
│  GAS_MAP = {"82":"https://...exec_A","83":"https://...exec_B"}│
│  GAS_API_KEY = "troop2026secret"                             │
│  （❌ 用戶永遠看不到這些值）                                 │
│                                                             │
│  代理根據 u=82 找到 exec_A，附加 api_key，內部轉發            │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼ 用戶完全看不到
┌─────────────────────────────────────────────────────────────┐
│  82旅 自己的 GAS（部署在自己的 Google Sheet）                │
│                                                             │
│  驗證：u=82 必須匹配 Config.TROOP_CODE                      │
│  驗證：api_key 必須匹配 Config.API_KEY（若設了）            │
│                                                             │
│  讀取：旅團主系統 Members/Branches/Patrols（只讀）            │
│  寫入：自己的 AttendanceRecords（橫向矩陣）                   │
└─────────────────────────────────────────────────────────────┘
```

## 誰需要部署什麼？

| 角色 | 需要做什麼 | 次數 |
|------|-----------|------|
| **系統管理員（作者）** | 部署 1 份共用 Vercel；設定 Vercel 環境變數 `GAS_MAP` + `GAS_API_KEY`；維護 Registry；**每旅團收到 GAS URL + API_KEY 後更新 `GAS_MAP`** | Vercel 1次 + 每旅團更新變數 |
| **旅團技術人員** | 新建 1 張 Google Sheet → 在 Config 工作表設定 `TROOP_CODE` + **`API_KEY`**（必須與管理員的 `GAS_API_KEY` 相同） → 貼 GAS → 部署為 Web App → 把 **GAS URL + API_KEY** 交給管理員 | 每旅團1次 |
| **旅團領袖/成員** | 什麼都不用做，直接使用 | — |

## 快速接入（給系統管理員）

### 1. 部署共用 Vercel 前端 + 代理（只做一次）

1. Fork 本倉庫到 GitHub
2. 部署到 Vercel（Framework: **Other**，Root: `./`）
3. 取得網址：`https://troop-attendance.vercel.app`

### 2. 在 troop-router 註冊插件（只做一次）

在 `registry.json` 的 `plugins` 中加入：

```json
{
  "id": "troop_attendance",
  "title": "集會點名系統",
  "icon": "📝",
  "url": "",
  "tier": 3,
  "needsUnitBackend": true,
  "embed": false,
  "type": "jump",
  "status": "active",
  "roles": ["leader", "member", "admin"],
  "scopes": ["troop"]
}
```

### 3. 在 Vercel 設定環境變數（每旅團開通時）

在 Vercel Dashboard → 專案設定 → Environment Variables：

```
GAS_MAP = {"82":"https://script.google.com/...","83":"https://script.google.com/..."}
GAS_API_KEY = troop2026secret（**強制**，第3級安全機制核心，與各旅團 Config.API_KEY 必須相同）
```

### 4. 開通旅團（每旅團一次）

**收到旅團交來的 GAS URL + API_KEY 兩樣**後：

- 更新 Vercel `GAS_MAP` 環境變數（加入該旅團的 GAS URL）
- 在 `registry.json` 的 `units` 中加上：

```json
{
  "id": "82",
  "name": "第82旅",
  "installs": ["troop_lib", "troop_attendance"],
  "endpoints": {
    "troop_attendance": "https://troop-attendance.vercel.app"
  }
}
```

> ⚠️ **注意**：`units` 中**不需要** `gas` 字段！GAS URL 只存在 Vercel 的私密環境變數中。

詳細旅團部署教學見 `docs/DEPLOY.md`。

## 元件合約

- 接收 `?u=旅團碼`（純數字）識別旅團
- 接收 `?role=leader|member|admin` 決定權限
  - `leader/admin`：點名/修改歷史/查看矩陣/匯出/查詢任何成員
  - `member/parent`：只能查看自己的出席紀錄
- 接收 `?embed=1` 時收斂 UI（無頂部導航）
- `needsUnitBackend: true`（第3級），但後端是 GAS 而非完整 Vercel

## 成員同步策略（以 YMIS 為主鍵）

每次「載入點名」時自動執行：

- 主系統有、點名表無 → **新增**（狀態=active）
- 主系統無、點名表有 → **標記為 left**（保留歷史，不顯示）
- 兩邊都有 → **更新** 姓名/支部/小隊/角色（出席紀錄不動）
- 主系統修改 YMIS → 視為新成員（舊紀錄保留在舊 YMIS 下）

## 目錄結構

```
troop-attendance/
  api/
    proxy.js             # Vercel 私密代理（共用，服務端運行）
  public/
    ├── index.html         # 前端主程式（單頁應用，共用）
    └── config.js          # 配置（無需修改）
  gas/
    └── Code.gs            # GAS 後端（每個旅團複製部署）
  docs/
    ├── DEPLOY.md          # 完整部署教學（含管理員 + 旅團部分）
    └── WORD_TEMPLATE.md   # Mail Merge / 列印指南
  vercel.json              # Vercel 配置
  package.json
  README.md                # 本檔
  troop-router-snippet.json # 註冊片段範例（不含 gas 字段）
```

## 安全設計

| 層 | 措施 | 效果 |
|----|------|------|
| **Registry 公開** | 只存 Vercel 前端 URL | GAS URL 不暴露 |
| **Vercel 代理** | 環境變數 `GAS_MAP` 存 GAS URL（私密） | 用戶抓包也看不到 GAS 地址 |
| **GAS u 驗證** | `u` 參數必須匹配 `TROOP_CODE` | 防止跨旅團資料混亂（前端可見性是允許的） |
| **GAS API_KEY** | `api_key` 必須匹配 `Config.API_KEY`（**強制**） | 防止「知道 URL 就能直接從後端存取資料」<br>（API 鎖要來擋AI / 直接打 URL） |
| **雙 Sheet 分離** | 點名 Sheet 獨立於主系統 | 領袖接觸不到敏感資料 |
| **操作審計** | `save`/`sync`/`init` 記錄在 `AuditLog` | 可追溯操作 |

## 作者與授權

由 ScoutSystem 旅團轉駁中心維護。旅團只需複製 `gas/Code.gs` 到自己的 Sheet 並部署即可。
