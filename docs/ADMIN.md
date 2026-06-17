# 集會點名系統 — 管理員部署指南

> 這份只給你（系統管理員）看。旅團的部署教學在前端 `/onboarding`。

---

## 你需要做什麼（只做一次）

### 1. 部署共用 Vercel 前端

1. 把這個倉庫 Import 到 [vercel.com](https://vercel.com)
2. Framework Preset: **Other**
3. Root Directory: `./`
4. Deploy → 取得網址：`https://troop-attendance.vercel.app`

### 2. 在 Vercel 設定環境變數

Dashboard → Settings → Environment Variables：

| 變數名 | 值 | 說明 |
|--------|-----|------|
| `GAS_MAP` | `{"82":"https://.../exec","83":"https://.../exec"}` | 所有已開通旅團的 GAS URL，JSON 格式 |
| `GAS_API_KEY` | `troop2026secret`（可選） | 雙重驗證密鑰，若設定 GAS 也必須配對 |

> 每當新旅團交來 GAS URL，更新 `GAS_MAP` → Vercel 會自動重新部署。

### 3. 在 troop-router 註冊插件

`registry.json` 的 `plugins` 加：

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

### 4. 開通旅團（每個旅團一次）

收到旅團交來的資料：

```
旅團號：82
GAS URL：https://script.google.com/macros/s/.../exec
（若有）API_KEY：troop2026secret
```

做兩件事：

**A. 更新 Vercel 環境變數 `GAS_MAP`**

```json
{"82":"https://script.google.com/macros/s/.../exec"}
```

**B. 在 `registry.json` 的 `units` 登記：**

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

> `endpoints` 只填共用前端 URL，絕對不要填 GAS URL！

**C. `npm run validate` → `git push`**

---

## 快速檢查清單

- [ ] Vercel 前端已部署，網址有效
- [ ] `GAS_MAP` 已設定且 JSON 格式正確
- [ ] troop-router `plugins` 已註冊 `troop_attendance`
- [ ] troop-router `units` 已登記旅團（只填前端 URL）
- [ ] 旅團已收到 `onboarding` 教學並完成部署
- [ ] 旅團已提交 GAS URL 給你
