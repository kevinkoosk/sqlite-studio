const { invoke } = window.__TAURI__.core;
const { open, save } = window.__TAURI__.dialog;

// Add selector
const btnNewDb = document.getElementById("btn-new-db");

// Handle New Database Creation
btnNewDb.addEventListener("click", async () => {
  try {
    const selected = await save({
      title: "Create New SQLite Database",
      filters: [{ name: "SQLite Database", extensions: ["db", "sqlite", "sqlite3"] }],
      defaultPath: "database.db"
    });
    
    if (selected) {
      statusLeft.innerText = "Creating database...";
      // Opening a new path with rusqlite automatically initializes the file
      const tables = await invoke("open_database", { path: selected });
      activeDbPath.innerText = selected;
      populateTableDropdown(tables);
      clearGrid();
      enableTableOperations(false);
      btnCreateTable.disabled = false; // Enable creating the first table
      statusLeft.innerText = "Empty database created. Ready for new tables.";
    }
  } catch (err) {
    alert("Error creating database: " + err);
    statusLeft.innerText = "Error encountered.";
  }
});


const state = {
  currentTable: null,
  tableData: { columns: [], rows: [] },
  selectedRowIds: new Set(),
};

// DOM Selectors
const btnOpenDb = document.getElementById("btn-open-db");
const tableSelect = document.getElementById("table-select");
const activeDbPath = document.getElementById("active-db-path");
const dataTable = document.getElementById("data-table");
const tableHead = document.getElementById("table-head");
const tableBody = document.getElementById("table-body");
const emptyState = document.getElementById("empty-state");
const statusLeft = document.getElementById("status-left");
const rowCount = document.getElementById("row-count");
const selectionCount = document.getElementById("selection-count");

// Action Buttons
const btnCreateTable = document.getElementById("btn-create-table");
const btnCopyTable = document.getElementById("btn-copy-table");
const btnDropTable = document.getElementById("btn-drop-table");
const btnAddColumn = document.getElementById("btn-add-column");
const btnInsertRow = document.getElementById("btn-insert-row");
const btnDeleteRows = document.getElementById("btn-delete-rows");

// Modal Elements
const modalBackdrop = document.getElementById("modal-backdrop");
const modalTitle = document.getElementById("modal-title");
const modalBody = document.getElementById("modal-body");
const modalCancelBtn = document.getElementById("modal-cancel-btn");
const modalConfirmBtn = document.getElementById("modal-confirm-btn");
let onModalConfirm = null;

// Initialize Handlers
btnOpenDb.addEventListener("click", async () => {
  try {
    const selected = await open({
      multiple: false,
      filters: [{ name: "SQLite Database", extensions: ["db", "sqlite", "sqlite3"] }],
    });
    if (selected) {
      statusLeft.innerText = "Opening database...";
      const tables = await invoke("open_database", { path: selected });
      activeDbPath.innerText = selected;
      populateTableDropdown(tables);
      statusLeft.innerText = "Database opened.";
    }
  } catch (err) {
    alert("Error opening database: " + err);
    statusLeft.innerText = "Error encountered.";
  }
});

tableSelect.addEventListener("change", async (e) => {
  state.currentTable = e.target.value;
  if (state.currentTable) {
    await reloadCurrentTable();
    enableTableOperations(true);
  } else {
    clearGrid();
    enableTableOperations(false);
  }
});

function enableTableOperations(enabled) {
  [btnCopyTable, btnDropTable, btnAddColumn, btnInsertRow, btnDeleteRows].forEach(
    (b) => (b.disabled = !enabled)
  );
  btnCreateTable.disabled = false;
}

function populateTableDropdown(tables) {
  tableSelect.innerHTML = '<option value="">Select a table</option>';
  tables.forEach((tbl) => {
    const opt = document.createElement("option");
    opt.value = tbl;
    opt.innerText = tbl;
    tableSelect.appendChild(opt);
  });
  tableSelect.disabled = false;
  btnCreateTable.disabled = false;
}

async function reloadCurrentTable() {
  if (!state.currentTable) return;
  statusLeft.innerText = `Loading table: ${state.currentTable}...`;
  state.selectedRowIds.clear();
  updateSelectionDisplay();

  try {
    const data = await invoke("get_table_data", { tableName: state.currentTable });
    state.tableData = data;
    renderTable();
    statusLeft.innerText = `Loaded ${state.currentTable}`;
  } catch (err) {
    alert("Error fetching table: " + err);
    statusLeft.innerText = "Fetch failed.";
  }
}

function clearGrid() {
  dataTable.classList.add("hidden");
  emptyState.classList.remove("hidden");
  tableHead.innerHTML = "";
  tableBody.innerHTML = "";
  rowCount.innerText = "0 rows";
}

function renderTable() {
  const { columns, rows } = state.tableData;
  if (columns.length === 0) {
    clearGrid();
    return;
  }

  emptyState.classList.add("hidden");
  dataTable.classList.remove("hidden");

  // Build Head
  tableHead.innerHTML = `<tr>
    <th class="p-2 w-10 text-center"><input type="checkbox" id="select-all-rows" /></th>
    ${columns.map((c) => `<th class="p-2 border-r border-slate-700 last:border-0">${c}</th>`).join("")}
  </tr>`;

  document.getElementById("select-all-rows").addEventListener("change", (e) => {
    state.selectedRowIds.clear();
    if (e.target.checked) {
      rows.forEach((r) => state.selectedRowIds.add(r[0]));
    }
    renderRows();
    updateSelectionDisplay();
  });

  renderRows();
  rowCount.innerText = `${rows.length} rows`;
}

function renderRows() {
  const { columns, rows } = state.tableData;
  tableBody.innerHTML = "";

  rows.forEach((row) => {
    const rowId = row[0];
    const isSelected = state.selectedRowIds.has(rowId);
    const tr = document.createElement("tr");
    tr.className = `hover:bg-slate-800/60 cursor-pointer transition ${isSelected ? "selected" : ""}`;

    // Select Checkbox Cell
    const tdSelect = document.createElement("td");
    tdSelect.className = "p-2 text-center border-r border-slate-800";
    const chk = document.createElement("input");
    chk.type = "checkbox";
    chk.checked = isSelected;
    chk.addEventListener("click", (e) => {
      e.stopPropagation();
      if (chk.checked) state.selectedRowIds.add(rowId);
      else state.selectedRowIds.delete(rowId);
      tr.classList.toggle("selected", chk.checked);
      updateSelectionDisplay();
    });
    tdSelect.appendChild(chk);
    tr.appendChild(tdSelect);

    // Data Cells
    row.forEach((val, colIdx) => {
      const td = document.createElement("td");
      td.className = "p-2 border-r border-slate-800/80 truncate max-w-xs text-slate-300";
      td.innerText = val === null ? "NULL" : val;
      if (val === null) td.classList.add("text-slate-600", "italic");

      // Inline edit trigger on non-rowid columns
      if (colIdx > 0) {
        td.addEventListener("dblclick", () => showCellEditor(rowId, columns[colIdx], val));
      }
      tr.appendChild(td);
    });

    tableBody.appendChild(tr);
  });
}

function updateSelectionDisplay() {
  selectionCount.innerText = `${state.selectedRowIds.size} selected`;
}

// Modal Management
function openModal(title, contentBuilder, onConfirm) {
  modalTitle.innerText = title;
  modalBody.innerHTML = "";
  contentBuilder(modalBody);
  onModalConfirm = onConfirm;
  modalBackdrop.classList.remove("hidden");
}

function closeModal() {
  modalBackdrop.classList.add("hidden");
  onModalConfirm = null;
}

modalCancelBtn.addEventListener("click", closeModal);
modalConfirmBtn.addEventListener("click", async () => {
  if (onModalConfirm) await onModalConfirm();
});

// Inline Cell Edit
function showCellEditor(rowid, colName, currentValue) {
  openModal(
    `Edit ${colName} (rowid: ${rowid})`,
    (container) => {
      container.innerHTML = `
        <label class="block text-xs font-semibold text-slate-400 mb-1">${colName}</label>
        <input id="modal-input-val" type="text" class="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-sm text-slate-100" value="${currentValue ?? ""}" />
      `;
    },
    async () => {
      const val = document.getElementById("modal-input-val").value;
      try {
        await invoke("update_cell", {
          tableName: state.currentTable,
          rowid: Number(rowid),
          columnName: colName,
          newValue: val,
        });
        closeModal();
        await reloadCurrentTable();
      } catch (err) {
        alert("Update failed: " + err);
      }
    }
  );
}

// Create Table
btnCreateTable.addEventListener("click", () => {
  openModal(
    "Create New Table",
    (container) => {
      container.innerHTML = `
        <div>
          <label class="block text-xs text-slate-400 mb-1">Table Name</label>
          <input id="input-tbl-name" type="text" class="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs mb-3" placeholder="users" />
        </div>
        <div>
          <label class="block text-xs text-slate-400 mb-1">Columns Definition (SQL)</label>
          <textarea id="input-col-defs" rows="4" class="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs font-mono" placeholder="id INTEGER PRIMARY KEY, name TEXT, age INTEGER"></textarea>
        </div>
      `;
    },
    async () => {
      const tableName = document.getElementById("input-tbl-name").value.trim();
      const columnsDef = document.getElementById("input-col-defs").value.trim();
      if (!tableName || !columnsDef) return alert("All fields are required");

      try {
        await invoke("create_table", { tableName, columnsDef });
        closeModal();
        const tables = await invoke("get_tables");
        populateTableDropdown(tables);
        tableSelect.value = tableName;
        state.currentTable = tableName;
        await reloadCurrentTable();
      } catch (err) {
        alert("Error creating table: " + err);
      }
    }
  );
});

// Drop Table
btnDropTable.addEventListener("click", () => {
  if (!confirm(`Are you sure you want to drop '${state.currentTable}'?`)) return;
  invoke("drop_table", { tableName: state.currentTable })
    .then(async () => {
      const tables = await invoke("get_tables");
      populateTableDropdown(tables);
      state.currentTable = null;
      clearGrid();
      enableTableOperations(false);
    })
    .catch((e) => alert("Failed to drop table: " + e));
});

// Copy Table
btnCopyTable.addEventListener("click", () => {
  openModal(
    `Copy Table: ${state.currentTable}`,
    (container) => {
      container.innerHTML = `
        <label class="block text-xs text-slate-400 mb-1">New Table Name</label>
        <input id="input-copy-tbl-name" type="text" class="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs" />
      `;
    },
    async () => {
      const newTable = document.getElementById("input-copy-tbl-name").value.trim();
      if (!newTable) return;
      try {
        await invoke("copy_table", { sourceTable: state.currentTable, newTable });
        closeModal();
        const tables = await invoke("get_tables");
        populateTableDropdown(tables);
      } catch (err) {
        alert("Copy failed: " + err);
      }
    }
  );
});

// Add Column
btnAddColumn.addEventListener("click", () => {
  openModal(
    `Add Column to ${state.currentTable}`,
    (container) => {
      container.innerHTML = `
        <div class="mb-2">
          <label class="block text-xs text-slate-400 mb-1">Column Name</label>
          <input id="input-col-name" type="text" class="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs" />
        </div>
        <div>
          <label class="block text-xs text-slate-400 mb-1">Type & Constraints</label>
          <input id="input-col-type" type="text" class="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs font-mono" placeholder="TEXT DEFAULT 'N/A'" />
        </div>
      `;
    },
    async () => {
      const colName = document.getElementById("input-col-name").value.trim();
      const colType = document.getElementById("input-col-type").value.trim();
      if (!colName || !colType) return;
      try {
        await invoke("add_column", {
          tableName: state.currentTable,
          columnName: colName,
          columnType: colType,
        });
        closeModal();
        await reloadCurrentTable();
      } catch (err) {
        alert("Failed adding column: " + err);
      }
    }
  );
});

// Insert Row
btnInsertRow.addEventListener("click", () => {
  const insertableCols = state.tableData.columns.slice(1);
  openModal(
    `Insert Row into ${state.currentTable}`,
    (container) => {
      container.innerHTML = insertableCols
        .map(
          (col) => `
          <div class="mb-2">
            <label class="block text-[11px] text-slate-400 mb-0.5">${col}</label>
            <input data-col="${col}" class="insert-val-input w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs font-mono" />
          </div>
        `
        )
        .join("");
    },
    async () => {
      const inputs = document.querySelectorAll(".insert-val-input");
      const cols = [];
      const vals = [];
      inputs.forEach((inp) => {
        cols.push(inp.dataset.col);
        vals.push(inp.value);
      });
      try {
        await invoke("insert_row", {
          tableName: state.currentTable,
          columns: cols,
          values: vals,
        });
        closeModal();
        await reloadCurrentTable();
      } catch (err) {
        alert("Insert failed: " + err);
      }
    }
  );
});

// Delete Selected Rows
btnDeleteRows.addEventListener("click", async () => {
  const count = state.selectedRowIds.size;
  if (count === 0) return alert("Select rows to delete.");
  if (!confirm(`Permanently delete ${count} row(s)?`)) return;

  try {
    await invoke("delete_rows", {
      tableName: state.currentTable,
      rowids: Array.from(state.selectedRowIds),
    });
    await reloadCurrentTable();
  } catch (err) {
    alert("Delete failed: " + err);
  }
});
