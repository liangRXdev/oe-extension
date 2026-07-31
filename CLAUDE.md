# oe-extension — 專案規則

Chrome Manifest V3 擴充功能：選取臨床文字 → 送進 OpenEvidence。純 JS/CSS/HTML，**無框架、無 bundler**——這是刻意的，不要引入建置工具鏈。

---

## 這是 fork，不是自有專案

上游 `htlin222/oe-extension`，本 repo 是 `liangRXdev` 的個人 fork。

- `upstream` 的 push URL 已設為 `DISABLE`——**別想辦法繞過它**，那是防手滑推到別人 repo 的保險
- 本 fork 唯一的加法是 **Dotflows 整合**，其餘一律追隨上游
- 改動前先問：這是**上游該修的 bug**，還是**fork 專屬功能**？前者理想上回饋上游，後者才留在這裡

**盡量把 fork 的改動集中在 `src/dotflow-inject.js` 與 `src/dotflows.js` 這兩個新檔**。目前已有 13 個上游檔案被改動（`content.js` +165 行最重），每多改一個上游檔案，日後 rebase 就多一分痛。

看目前的分歧範圍：

```bash
git diff --stat upstream/main...HEAD
```

## Dotflow 注入：整個 fork 最脆弱的地方

`src/dotflow-inject.js` 是 `document_start` + **`world: "MAIN"`** 的 content script，會 patch 頁面的 `fetch` 與 `XMLHttpRequest`。

**它依賴 OpenEvidence 的私有 API 形狀**（`/api/dotflows/dot-flows`、`POST /api/article`），對方隨時可能改而不通知。

### 已確認的 schema

```js
{ article_type, inputs: { question, dotflow: { id } }, ... }
```

`dotflow` 掛在 `inputs` 底下，不是頂層。程式碼有 fallback：`inputs` 不存在時才寫頂層。

### 壞掉時的除錯路徑

在 `/ask` URL 後面加 `&oe_ext_debug=1`，會 log 每一個看到的 POST endpoint。**先確認端點還是不是 `/api/article`，再確認 body schema**——兩者都可能變。

### 三條不可退讓的設計

1. **一次性**（`done` 旗標）：命中後立刻還原 `window.fetch` / XHR 原函式。長期掛著 patch 會污染整個頁面的網路層
2. **只碰命中 `/api/article` 的 POST**，其他流量原樣放行
3. **JSON.parse 失敗就保留原 body**，不猜、不改。寧可 Dotflow 沒生效，也不要送出壞掉的請求

同時 patch `fetch` **和** `XMLHttpRequest` 是必要的——OE 兩種都可能用，只補一種會間歇性失效（最難查的那種 bug）。

## 測試

```bash
npm test          # = node scripts/run-tests.mjs
make build        # 跑測試後才建 dist/
```

自製 runner，逐檔 spawn node 執行 `tests/*.test.mjs`，無測試框架。新增測試檔放進 `tests/` 就會自動被撿到。

其餘測試沿用 house style（在測試檔內重寫邏輯），但 **`tests/dotflow-inject.test.mjs` 是例外**：它用 `node:vm` 載入**真正的 `src/dotflow-inject.js`**，在極簡假瀏覽器（stub `location` / `window` / `Request` / `XMLHttpRequest`）中執行。核心功能不能測副本——副本會與真檔漂移。

該測試釘住的行為即是 schema 紀錄：`dotflow` 掛 `inputs` 底下、頁面已設的 id 不覆蓋、一次性、無法 parse 的 body 原樣放行、fetch 與 XHR 共用 `done` 旗標。**改動 OpenEvidence schema 時先改測試，再改實作。**

自動化仍測不到的部分：實際端點是否還是 `/api/article`、OE 真實 body 形狀是否變了。那兩件事只能用 `&oe_ext_debug=1` 手動驗。

## Manifest 的 fork 改動

```jsonc
"background": { "type": "module" }        // fork 加的
{ "matches": ["https://www.openevidence.com/ask*"],
  "js": ["src/dotflow-inject.js"],
  "run_at": "document_start",
  "all_frames": true,
  "world": "MAIN" }                        // fork 加的
```

`world: "MAIN"` 是能 patch 頁面 `fetch` 的前提，`document_start` 是要趕在 OE 自己的 JS 之前。**兩者都不能改**，改了注入就失效。

## 發布

GitHub release 觸發 `release.yml`：跑測試 → 建 zip → 打包 crx → 上傳。

**stable extension ID 需要 repo secret `CRX_PRIVATE_KEY_BASE64`**。少了它 CI 仍會產 crx，但 Chrome 每次都可能配新的 extension ID，使用者等於要重裝。

## 使用者資料

查詢歷史存在 `chrome.storage.local`，含**原始選取的臨床文字**。Dotflow 清單快取 30 分鐘（key `oeDotflowsCache`）。

這些內容可能包含病人相關敘述——**debug log、issue、測試 fixture 一律不得貼上真實選取內容**。
