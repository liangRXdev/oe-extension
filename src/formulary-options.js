// Fork addition: 院內品項 tab on the options page. Kept out of options.js so
// upstream syncs stay cheap; it piggybacks on options.js's tab buttons (that
// file's activateTab hides every known panel, this one handles its own).

(() => {
	const F = globalThis.OEFormulary;
	const panel = document.querySelector("#tab-formulary");
	const form = document.querySelector("#options-form");
	const fileInput = document.querySelector("#formulary-file");
	const summary = document.querySelector("#formulary-summary");
	const status = document.querySelector("#formulary-status");
	const clearButton = document.querySelector("#formulary-clear");

	if (!F || !panel) {
		return;
	}

	// Runs after options.js's own click handler (registered first).
	document.querySelectorAll(".tab-button").forEach((button) => {
		button.addEventListener("click", () => {
			const active = button.dataset.tab === "formulary";
			panel.hidden = !active;
			if (active && form) {
				form.hidden = true;
			}
		});
	});

	function setStatus(message) {
		status.textContent = message;
	}

	function renderSummary(meta) {
		if (!meta || !meta.count) {
			summary.textContent = "尚未匯入院內藥檔。";
			clearButton.disabled = true;
			return;
		}
		const when = new Date(meta.importedAt).toLocaleString("zh-TW");
		summary.textContent =
			`目前清單：${meta.fileName}，${meta.count} 筆（含 ATC ${meta.withAtc} 筆），匯入於 ${when}。`;
		clearButton.disabled = false;
	}

	function storageSet(values) {
		return new Promise((resolve, reject) => {
			chrome.storage.local.set(values, () => {
				if (chrome.runtime.lastError) {
					reject(new Error(chrome.runtime.lastError.message));
				} else {
					resolve();
				}
			});
		});
	}

	chrome.storage.local.get([F.FORMULARY_META_STORAGE_KEY], (result) => {
		renderSummary(result[F.FORMULARY_META_STORAGE_KEY]);
	});

	fileInput.addEventListener("change", async () => {
		const file = fileInput.files?.[0];
		if (!file) {
			return;
		}
		setStatus(`讀取 ${file.name}…`);
		try {
			const parsed = await F.parseFormularyFile(file.name, await file.arrayBuffer());
			if (parsed.items.length === 0) {
				throw new Error("檔案裡沒有任何有藥名的資料列");
			}
			const meta = {
				fileName: file.name,
				importedAt: Date.now(),
				count: parsed.items.length,
				withAtc: parsed.withAtc,
			};
			await storageSet({
				[F.FORMULARY_ITEMS_STORAGE_KEY]: parsed.items,
				[F.FORMULARY_META_STORAGE_KEY]: meta,
			});
			renderSummary(meta);
			setStatus(
				parsed.withAtc === 0
					? "已匯入，但沒有 ATC 欄：只能比對名稱，無法列出同成分／同分類品項。"
					: "已匯入。",
			);
		} catch (error) {
			// Keep the previous list: nothing was written.
			setStatus(`匯入失敗：${error.message}`);
		} finally {
			fileInput.value = "";
		}
	});

	clearButton.addEventListener("click", () => {
		chrome.storage.local.remove(
			[F.FORMULARY_ITEMS_STORAGE_KEY, F.FORMULARY_META_STORAGE_KEY],
			() => {
				if (chrome.runtime.lastError) {
					setStatus(`清除失敗：${chrome.runtime.lastError.message}`);
					return;
				}
				renderSummary(null);
				setStatus("已清除院內藥檔。");
			},
		);
	});
})();
