// js/main.js — App entry point, wiring events and data loading

import { processSheet } from './data-engine.js';
import { state, restoreFromURL, saveToURL, applyFilters, parseFieldList, exportCSV, exportComparisonCSV } from './filters.js';
import {
  setRefs, setStatus, setDatasetMeta, renderSummaryCards,
  renderTableHeader, renderTableBody, openPlayerModal, closePlayerModal,
  renderComparisonPanel, showSkeleton, setLoadingStatus, renderFieldStats
} from './ui.js';
import { renderScatterPlot, destroyAll } from './charts.js';

const CSV_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vQXW5b2lq7tQ-Lpz3ADhPE0VJhXmIfVj1P_TT7LzWYNhjHt6g2dr0F77RxO844fxc_ZT9DA8clFHnRE/pub?output=csv';

let allPlayers = [];
let eventOrder = [];
let lastFetchTime = null;
let refreshCooldownUntil = 0;
let lastUpdatedInterval = null;

// --- Initialization ---
restoreFromURL();

document.addEventListener('DOMContentLoaded', () => {
  setStatus('connecting', 'CONNECTING');
  initUIBindings();
  restoreFilterInputs();
  fetchCSV();
});

function restoreFilterInputs() {
  document.getElementById('search-input').value = state.search;
  document.getElementById('min-events-input').value = state.minEvents || '';
}

// --- Fetch live CSV from Google Sheets ---
async function fetchCSV() {
  try {
    setLoadingStatus('Fetching live data...');
    showSkeleton(true);
    setStatus('connecting', 'CONNECTING');
    setRefreshSpinning(true);

    const url = CSV_URL + '&t=' + Date.now();
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const text = await resp.text();

    setLoadingStatus('Parsing data...');

    const parsed = Papa.parse(text, { skipEmptyLines: false });
    const rows = parsed.data;

    loadFromRows(rows);

    lastFetchTime = Date.now();
    updateLastUpdatedDisplay();
    startLastUpdatedTimer();

  } catch (err) {
    console.warn('CSV fetch failed:', err.message);
    setStatus('error', 'FETCH ERROR');
    showSkeleton(false);
    setLoadingStatus(null);
    document.getElementById('drop-zone').classList.remove('hidden');
  } finally {
    setRefreshSpinning(false);
  }
}

// --- Load data from a 2D array (CSV or converted XLSX) ---
function loadFromRows(rows) {
  const result = processSheet(rows);
  allPlayers = result.players;
  eventOrder = result.eventOrder;

  setLoadingStatus(`Parsed ${eventOrder.length} events, ${allPlayers.length} players`);

  setRefs(allPlayers, eventOrder);
  setStatus('live', 'LIVE');
  setDatasetMeta(eventOrder.length, allPlayers.length);
  renderSummaryCards(allPlayers, eventOrder);

  showSkeleton(false);
  setLoadingStatus(null);
  document.getElementById('drop-zone').classList.add('hidden');

  refresh();
}

// --- Load workbook from ArrayBuffer (xlsx drag & drop fallback) ---
function loadWorkbook(buf) {
  setLoadingStatus('Parsing workbook...');
  const wb = XLSX.read(buf, { type: 'array' });
  const sheetName = wb.SheetNames.find(n => n.toLowerCase().includes('tourney')) || wb.SheetNames[0];
  const sheet = wb.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });

  loadFromRows(rows);

  lastFetchTime = Date.now();
  updateLastUpdatedDisplay();
  startLastUpdatedTimer();
}

// --- Refresh table + charts ---
function refresh() {
  const filtered = applyFilters(allPlayers);
  renderTableHeader(onSort);
  renderTableBody(filtered, onPlayerClick, onCompareToggle);
  renderScatterPlot(allPlayers, allPlayers, onPlayerClick, state.fieldMode, state.fieldNames);
  saveToURL();
  updateComparisonFromSelection();
}

function onSort() {
  refresh();
}

function onPlayerClick(player) {
  openPlayerModal(player);
}

function onCompareToggle(player, checked) {
  if (checked) {
    if (state.selectedPlayers.size >= 4) {
      state.selectedPlayers.delete([...state.selectedPlayers][0]);
    }
    state.selectedPlayers.add(player.name);
  } else {
    state.selectedPlayers.delete(player.name);
  }
  updateComparisonFromSelection();
}

function updateComparisonFromSelection() {
  const selected = allPlayers.filter(p => state.selectedPlayers.has(p.name));
  renderComparisonPanel(selected);
}

// --- Refresh button helpers ---
function setRefreshSpinning(spinning) {
  const icon = document.getElementById('refresh-icon');
  if (spinning) {
    icon.style.animation = 'spin 0.8s linear infinite';
  } else {
    icon.style.animation = '';
  }
}

function updateLastUpdatedDisplay() {
  const el = document.getElementById('last-updated');
  if (!lastFetchTime) {
    el.textContent = '';
    return;
  }
  const diffMs = Date.now() - lastFetchTime;
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 10) {
    el.textContent = 'Updated just now';
  } else if (diffSec < 60) {
    el.textContent = `Updated ${diffSec}s ago`;
  } else {
    const mins = Math.floor(diffSec / 60);
    el.textContent = `Updated ${mins}m ago`;
  }
}

function startLastUpdatedTimer() {
  if (lastUpdatedInterval) clearInterval(lastUpdatedInterval);
  lastUpdatedInterval = setInterval(updateLastUpdatedDisplay, 10000);
}

// --- UI Bindings ---
function initUIBindings() {
  // Search
  const searchInput = document.getElementById('search-input');
  searchInput.addEventListener('input', () => {
    state.search = searchInput.value;
    refresh();
  });

  // Min events
  const minEvInput = document.getElementById('min-events-input');
  minEvInput.addEventListener('input', () => {
    state.minEvents = parseInt(minEvInput.value) || 0;
    refresh();
  });

  // Only >= 1.0
  const gte1Toggle = document.getElementById('gte1-toggle');
  gte1Toggle.addEventListener('change', () => {
    state.onlyGte1 = gte1Toggle.checked;
    refresh();
  });

  // Field mode toggle
  const fieldToggle = document.getElementById('field-toggle');
  fieldToggle.addEventListener('change', () => {
    state.fieldMode = fieldToggle.checked;
    refresh();
  });

  // Sort dropdown
  const sortSelect = document.getElementById('sort-select');
  sortSelect.addEventListener('change', () => {
    state.sortKey = sortSelect.value;
    refresh();
  });

  // Export CSV
  document.getElementById('export-csv-btn').addEventListener('click', () => {
    const filtered = applyFilters(allPlayers);
    exportCSV(filtered, eventOrder);
  });

  // Field tools panel toggle
  document.getElementById('field-tools-toggle').addEventListener('click', () => {
    const panel = document.getElementById('field-tools-panel');
    panel.classList.toggle('hidden');
  });

  // Field apply button
  document.getElementById('field-apply-btn').addEventListener('click', () => {
    const text = document.getElementById('field-textarea').value;
    state.fieldNames = parseFieldList(text);
    renderFieldStats(state.fieldNames, allPlayers);
    refresh();
  });

  // Modal close
  document.getElementById('modal-close-btn').addEventListener('click', closePlayerModal);
  document.getElementById('modal-overlay').addEventListener('click', closePlayerModal);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closePlayerModal();
  });

  // Comparison clear
  document.getElementById('comparison-clear-btn').addEventListener('click', () => {
    state.selectedPlayers.clear();
    refresh();
  });

  // Comparison export
  document.getElementById('comparison-export-btn').addEventListener('click', () => {
    const selected = allPlayers.filter(p => state.selectedPlayers.has(p.name));
    if (selected.length >= 2) exportComparisonCSV(selected);
  });

  // Dark mode toggle
  const darkToggle = document.getElementById('dark-toggle');
  darkToggle.addEventListener('click', () => {
    document.documentElement.classList.toggle('light-mode');
    const isLight = document.documentElement.classList.contains('light-mode');
    darkToggle.textContent = isLight ? '🌙' : '☀️';
  });

  // Refresh button with 30s cooldown
  const refreshBtn = document.getElementById('refresh-btn');
  refreshBtn.addEventListener('click', () => {
    const now = Date.now();
    if (now < refreshCooldownUntil) {
      const remaining = Math.ceil((refreshCooldownUntil - now) / 1000);
      setLoadingStatus(`Cooldown: ${remaining}s remaining`);
      setTimeout(() => setLoadingStatus(null), 2000);
      return;
    }
    refreshCooldownUntil = now + 30000;
    fetchCSV();
  });

  // Drag & drop (xlsx fallback)
  const dropZone = document.getElementById('drop-zone');
  const fileInput = document.getElementById('file-input');

  dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('border-green-400');
  });

  dropZone.addEventListener('dragleave', () => {
    dropZone.classList.remove('border-green-400');
  });

  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('border-green-400');
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  });

  dropZone.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => {
    if (fileInput.files[0]) handleFile(fileInput.files[0]);
  });
}

function handleFile(file) {
  const reader = new FileReader();
  reader.onload = (e) => {
    showSkeleton(true);
    setStatus('connecting', 'LOADING');
    loadWorkbook(e.target.result);
  };
  reader.readAsArrayBuffer(file);
}
