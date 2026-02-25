// js/main.js — App entry point, wiring events and data loading

import { processSheet } from './data-engine.js';
import {
  state, restoreFromURL, saveToURL, applyFilters, parseFieldList,
  exportCSV, exportComparisonCSV, exportPreviewCSV, applyPreviewSort
} from './filters.js';
import {
  setRefs, setStatus, setDatasetMeta, renderSummaryCards,
  renderTableHeader, renderTableBody, openPlayerModal, closePlayerModal,
  renderComparisonPanel, showSkeleton, setLoadingStatus, renderFieldStats,
  renderPreviewTable, renderTournamentIntelTable
} from './ui.js';
import { renderScatterPlot, renderTournamentStrengthChart, destroyAll } from './charts.js';

const CSV_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vQXW5b2lq7tQ-Lpz3ADhPE0VJhXmIfVj1P_TT7LzWYNhjHt6g2dr0F77RxO844fxc_ZT9DA8clFHnRE/pub?output=csv';

let allPlayers = [];
let eventOrder = [];
let tournamentStats = [];
let lastFetchTime = null;
let refreshCooldownUntil = 0;
let lastUpdatedInterval = null;

// --- Initialization ---
restoreFromURL();

document.addEventListener('DOMContentLoaded', () => {
  setStatus('connecting', 'CONNECTING');
  initUIBindings();
  restoreFilterInputs();
  restoreTab();
  restorePreviewField();
  fetchCSV();
});

function restoreFilterInputs() {
  document.getElementById('search-input').value = state.search;
  document.getElementById('min-events-input').value = state.minEvents || '';
}

// --- Tab Navigation ---
function restoreTab() {
  const hash = window.location.hash.replace('#', '') || 'analyzer';
  switchTab(hash, false);
}

function switchTab(tab, updateHash) {
  const analyzerTab = document.getElementById('tab-analyzer');
  const previewTab = document.getElementById('tab-preview');
  const analyzerView = document.getElementById('view-analyzer');
  const previewView = document.getElementById('view-preview');

  if (tab === 'preview') {
    analyzerTab.classList.remove('tab-active');
    previewTab.classList.add('tab-active');
    analyzerView.classList.add('hidden');
    previewView.classList.remove('hidden');
  } else {
    analyzerTab.classList.add('tab-active');
    previewTab.classList.remove('tab-active');
    analyzerView.classList.remove('hidden');
    previewView.classList.add('hidden');
  }

  if (updateHash !== false) {
    window.location.hash = tab;
  }
}

// --- Preview field persistence ---
function restorePreviewField() {
  const saved = localStorage.getItem('pvi_preview_field');
  if (saved) {
    const ta = document.getElementById('preview-field-textarea');
    if (ta) ta.value = saved;
  }
  const savedName = localStorage.getItem('pvi_preview_tourney_name');
  if (savedName) {
    const input = document.getElementById('preview-tourney-name');
    if (input) input.value = savedName;
  }
}

function runPreview() {
  const ta = document.getElementById('preview-field-textarea');
  const text = ta.value;
  localStorage.setItem('pvi_preview_field', text);
  const names = parseFieldList(text);
  renderPreviewTable(names, allPlayers, onPlayerClick, () => runPreview());

  const tourneyName = document.getElementById('preview-tourney-name').value;
  localStorage.setItem('pvi_preview_tourney_name', tourneyName);
  const headerEl = document.getElementById('preview-tourney-header');
  headerEl.textContent = tourneyName || 'Tournament Preview';
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
  tournamentStats = result.tournamentStats || [];

  setLoadingStatus(`Parsed ${eventOrder.length} events, ${allPlayers.length} players`);

  setRefs(allPlayers, eventOrder, tournamentStats);
  setStatus('live', 'LIVE');
  setDatasetMeta(eventOrder.length, allPlayers.length);
  renderSummaryCards(allPlayers, eventOrder);

  showSkeleton(false);
  setLoadingStatus(null);
  document.getElementById('drop-zone').classList.add('hidden');

  refresh();

  // Render tournament intelligence
  renderTournamentStrengthChart('tourney-strength-canvas', tournamentStats);
  renderTournamentIntelTable(tournamentStats);

  // Re-render preview if field is loaded
  const previewText = document.getElementById('preview-field-textarea');
  if (previewText && previewText.value.trim()) {
    runPreview();
  }
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
  renderTableBody(filtered, onPlayerClick, onCompareToggle, () => refresh());
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
  if (!lastFetchTime) { el.textContent = ''; return; }
  const diffSec = Math.floor((Date.now() - lastFetchTime) / 1000);
  if (diffSec < 10) el.textContent = 'Updated just now';
  else if (diffSec < 60) el.textContent = `Updated ${diffSec}s ago`;
  else el.textContent = `Updated ${Math.floor(diffSec / 60)}m ago`;
}

function startLastUpdatedTimer() {
  if (lastUpdatedInterval) clearInterval(lastUpdatedInterval);
  lastUpdatedInterval = setInterval(updateLastUpdatedDisplay, 10000);
}

// --- UI Bindings ---
function initUIBindings() {
  // Tab navigation
  document.getElementById('tab-analyzer').addEventListener('click', () => switchTab('analyzer'));
  document.getElementById('tab-preview').addEventListener('click', () => switchTab('preview'));

  // Search
  const searchInput = document.getElementById('search-input');
  searchInput.addEventListener('input', () => { state.search = searchInput.value; refresh(); });

  // Min events
  const minEvInput = document.getElementById('min-events-input');
  minEvInput.addEventListener('input', () => { state.minEvents = parseInt(minEvInput.value) || 0; refresh(); });

  // Only >= 1.0
  const gte1Toggle = document.getElementById('gte1-toggle');
  gte1Toggle.addEventListener('change', () => { state.onlyGte1 = gte1Toggle.checked; refresh(); });

  // Field mode toggle
  const fieldToggle = document.getElementById('field-toggle');
  fieldToggle.addEventListener('change', () => { state.fieldMode = fieldToggle.checked; refresh(); });

  // Sort dropdown
  const sortSelect = document.getElementById('sort-select');
  sortSelect.addEventListener('change', () => { state.sortKey = sortSelect.value; refresh(); });

  // Heatmap toggle
  const heatmapToggle = document.getElementById('heatmap-toggle');
  heatmapToggle.addEventListener('change', () => { state.heatmapOn = heatmapToggle.checked; refresh(); });

  // Tag filter
  const tagFilter = document.getElementById('tag-filter');
  tagFilter.addEventListener('change', () => { state.tagFilter = tagFilter.value; refresh(); });

  // Export CSV
  document.getElementById('export-csv-btn').addEventListener('click', () => {
    const filtered = applyFilters(allPlayers);
    exportCSV(filtered, eventOrder);
  });

  // Field tools panel toggle
  document.getElementById('field-tools-toggle').addEventListener('click', () => {
    document.getElementById('field-tools-panel').classList.toggle('hidden');
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
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closePlayerModal(); });

  // Comparison clear/export
  document.getElementById('comparison-clear-btn').addEventListener('click', () => { state.selectedPlayers.clear(); refresh(); });
  document.getElementById('comparison-export-btn').addEventListener('click', () => {
    const selected = allPlayers.filter(p => state.selectedPlayers.has(p.name));
    if (selected.length >= 2) exportComparisonCSV(selected);
  });

  // Dark mode toggle
  const darkToggle = document.getElementById('dark-toggle');
  darkToggle.addEventListener('click', () => {
    document.documentElement.classList.toggle('light-mode');
    darkToggle.textContent = document.documentElement.classList.contains('light-mode') ? '🌙' : '☀️';
  });

  // Refresh button with 30s cooldown
  document.getElementById('refresh-btn').addEventListener('click', () => {
    const now = Date.now();
    if (now < refreshCooldownUntil) {
      setLoadingStatus(`Cooldown: ${Math.ceil((refreshCooldownUntil - now) / 1000)}s remaining`);
      setTimeout(() => setLoadingStatus(null), 2000);
      return;
    }
    refreshCooldownUntil = now + 30000;
    fetchCSV();
  });

  // Drag & drop (xlsx fallback)
  const dropZone = document.getElementById('drop-zone');
  const fileInput = document.getElementById('file-input');
  dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('border-green-400'); });
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('border-green-400'));
  dropZone.addEventListener('drop', (e) => {
    e.preventDefault(); dropZone.classList.remove('border-green-400');
    if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]);
  });
  dropZone.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => { if (fileInput.files[0]) handleFile(fileInput.files[0]); });

  // --- Preview Tab ---
  document.getElementById('preview-load-btn').addEventListener('click', () => runPreview());

  document.getElementById('preview-export-btn').addEventListener('click', () => {
    const ta = document.getElementById('preview-field-textarea');
    const names = parseFieldList(ta.value);
    const playerMap = new Map(allPlayers.map(p => [p.name.toLowerCase(), p]));
    let list = names.map(name => {
      const p = playerMap.get(name.toLowerCase());
      if (p) return { ...p, _hasData: true };
      return { name, _hasData: false, compositeScore: -1, avgPvi: 0, medianPvi: 0, hitRate: 0, consistencyIndex: 0, trendMomentum: 0, events: 0 };
    });
    list = applyPreviewSort(list);
    exportPreviewCSV(list);
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
