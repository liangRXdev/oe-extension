// Fork addition: the 院內 toolbar button. Loaded after content.js in the same
// content-script world, so it reuses that file's toolbar/panel helpers
// (makeToolbarButton, removeButton, ensureResultPanel, selectedText,
// getSelectionText, removeResultPanel). content.js only calls
// addFormularyButton(toolbar) — keep the rest of the feature here so upstream
// syncs stay cheap.
//
// Everything runs locally: the list lives in chrome.storage.local (imported on
// the options page) and the selection is never sent anywhere.

const FORMULARY_PILL_ICON =
  '<path d="m10.5 20.5 10-10a4.95 4.95 0 1 0-7-7l-10 10a4.95 4.95 0 1 0 7 7Z"/>' +
  '<path d="m8.5 8.5 7 7"/>';

let formularyIndex = null; // built lazily on first click, dropped on change

function loadFormularyIndex() {
  if (formularyIndex) {
    return Promise.resolve(formularyIndex);
  }

  return new Promise((resolve, reject) => {
    chrome.storage.local.get([OEFormulary.FORMULARY_ITEMS_STORAGE_KEY], (result) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      const items = result[OEFormulary.FORMULARY_ITEMS_STORAGE_KEY];
      formularyIndex = OEFormulary.createIndex(Array.isArray(items) ? items : []);
      resolve(formularyIndex);
    });
  });
}

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "local" && changes[OEFormulary.FORMULARY_ITEMS_STORAGE_KEY]) {
    formularyIndex = null;
  }
});

function addFormularyButton(toolbarElement) {
  const button = makeToolbarButton(
    "oe-selection-button oe-selection-button--formulary",
    "院內",
    "比對院內品項"
  );
  const icon = button.querySelector("svg");
  if (icon) {
    icon.innerHTML = FORMULARY_PILL_ICON;
  }

  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    showFormularyLookup(selectedText || getSelectionText());
  });

  toolbarElement.appendChild(button);
}

async function showFormularyLookup(query) {
  removeButton();
  if (!query) {
    return;
  }

  const panel = ensureResultPanel();
  if (!panel) {
    return;
  }
  panel.classList.add("oe-formulary-panel");

  let index;
  try {
    index = await loadFormularyIndex();
  } catch (error) {
    renderFormularyMessage(panel, query, `讀取院內藥檔失敗：${error.message}`);
    return;
  }

  // The panel may have been closed (Esc) or replaced while storage was read.
  if (resultPanel !== panel) {
    return;
  }

  if (index.items.length === 0) {
    renderFormularyMessage(
      panel,
      query,
      "尚未匯入院內藥檔。請到擴充功能選項的「院內品項」分頁匯入 .xlsx 或 .csv。"
    );
    return;
  }

  renderFormularyResult(panel, OEFormulary.lookup(index, query));
}

function formularyElement(tag, className, text) {
  const element = document.createElement(tag);
  if (className) {
    element.className = className;
  }
  if (text !== undefined) {
    element.textContent = text;
  }
  return element;
}

function formularyHeader(panel, query) {
  panel.replaceChildren();
  const header = formularyElement("div", "oe-formulary__header");
  header.append(
    formularyElement("strong", "oe-formulary__title", "院內品項"),
    formularyElement("span", "oe-formulary__query", query.length > 60 ? `${query.slice(0, 60)}…` : query)
  );

  const close = formularyElement("button", "oe-formulary__close", "✕");
  close.type = "button";
  close.title = "關閉";
  close.setAttribute("aria-label", "關閉院內品項");
  close.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    removeResultPanel();
  });
  header.appendChild(close);
  panel.appendChild(header);
}

function renderFormularyMessage(panel, query, message) {
  formularyHeader(panel, query);
  panel.appendChild(formularyElement("p", "oe-formulary__empty", message));
}

function copyFormularyCode(button, code) {
  const done = (label) => {
    button.textContent = label;
    window.setTimeout(() => {
      button.textContent = code;
    }, 1200);
  };
  if (!navigator.clipboard) {
    done("無法複製");
    return;
  }
  navigator.clipboard.writeText(code).then(
    () => done("已複製"),
    () => done("無法複製")
  );
}

function formularyRow(item) {
  const row = formularyElement("li", "oe-formulary__item");

  const main = formularyElement("div", "oe-formulary__main");
  main.appendChild(formularyElement("span", "oe-formulary__name", item.name));
  if (item.enName) {
    main.appendChild(formularyElement("span", "oe-formulary__sub", item.enName));
  }
  if (item.ingredient) {
    main.appendChild(formularyElement("span", "oe-formulary__sub", item.ingredient));
  }
  row.appendChild(main);

  const meta = formularyElement("div", "oe-formulary__meta");
  if (item.code) {
    const code = formularyElement("button", "oe-formulary__code", item.code);
    code.type = "button";
    code.title = "複製院內代碼";
    code.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      copyFormularyCode(code, item.code);
    });
    meta.appendChild(code);
  }
  if (item.atc) {
    meta.appendChild(formularyElement("span", "oe-formulary__atc", item.atc));
  }
  row.appendChild(meta);
  return row;
}

function formularySection(panel, title, items, note) {
  if (!items.length) {
    return;
  }
  const section = formularyElement("section", "oe-formulary__section");
  const heading = formularyElement("h3", "oe-formulary__heading", `${title}（${items.length}）`);
  section.appendChild(heading);
  if (note) {
    section.appendChild(formularyElement("p", "oe-formulary__note", note));
  }
  const list = formularyElement("ul", "oe-formulary__list");
  items.forEach((item) => list.appendChild(formularyRow(item)));
  section.appendChild(list);
  panel.appendChild(section);
}

function renderFormularyResult(panel, result) {
  formularyHeader(panel, result.query);

  if (result.direct.length === 0) {
    panel.appendChild(formularyElement("p", "oe-formulary__empty", "院內清單中沒有符合的品項。"));
    return;
  }

  const body = formularyElement("div", "oe-formulary__body");
  panel.appendChild(body);
  formularySection(body, "符合品項", result.direct);
  formularySection(body, "同成分（ATC 7 碼相同）", result.sameIngredient);
  result.classes.forEach((group) => {
    formularySection(
      body,
      `同 ATC 分類 ${group.atcClass}`,
      group.items,
      "依 ATC 第 4 層分類列出，不代表治療等效或可互相替代。"
    );
  });
}
