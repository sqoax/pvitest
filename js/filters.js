// js/filters.js — Filtering, sorting, and URL state management

export const state = {
  search: '',
  minEvents: 0,
  onlyGte1: false,
  fieldMode: false,
  fieldNames: [],
  sortKey: 'compositeScore',
  sortDir: 'desc',
  selectedPlayers: new Set()
};

// Restore state from URL params
export function restoreFromURL() {
  const params = new URLSearchParams(window.location.search);
  if (params.has('sort')) state.sortKey = params.get('sort');
  if (params.has('dir')) state.sortDir = params.get('dir');
  if (params.has('q')) state.search = params.get('q');
  if (params.has('minEv')) state.minEvents = parseInt(params.get('minEv')) || 0;
  if (params.has('field')) state.fieldMode = params.get('field') === '1';
}

// Save state to URL params
export function saveToURL() {
  const params = new URLSearchParams();
  if (state.sortKey !== 'compositeScore') params.set('sort', state.sortKey);
  if (state.sortDir !== 'desc') params.set('dir', state.sortDir);
  if (state.search) params.set('q', state.search);
  if (state.minEvents > 0) params.set('minEv', state.minEvents);
  if (state.fieldMode) params.set('field', '1');
  const qs = params.toString();
  const url = window.location.pathname + (qs ? '?' + qs : '');
  window.history.replaceState(null, '', url);
}

// Apply filters and sorting to a player list
export function applyFilters(players) {
  let result = [...players];

  // Search filter
  if (state.search) {
    const q = state.search.toLowerCase();
    result = result.filter(p => p.name.toLowerCase().includes(q));
  }

  // Min events filter
  if (state.minEvents > 0) {
    result = result.filter(p => p.events >= state.minEvents);
  }

  // Only >= 1.0 avg filter
  if (state.onlyGte1) {
    result = result.filter(p => p.avgPvi >= 1.0);
  }

  // Field mode filter
  if (state.fieldMode && state.fieldNames.length > 0) {
    const fieldSet = new Set(state.fieldNames.map(n => n.toLowerCase()));
    result = result.filter(p => fieldSet.has(p.name.toLowerCase()));
  }

  // Sort
  result.sort((a, b) => {
    let va = a[state.sortKey];
    let vb = b[state.sortKey];
    if (state.sortKey === 'name') {
      va = va.toLowerCase();
      vb = vb.toLowerCase();
      return state.sortDir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va);
    }
    if (state.sortKey === 'floorCeiling') {
      va = a.ceiling - a.floor;
      vb = b.ceiling - b.floor;
    }
    if (!isFinite(va)) va = state.sortDir === 'asc' ? Infinity : -Infinity;
    if (!isFinite(vb)) vb = state.sortDir === 'asc' ? Infinity : -Infinity;
    return state.sortDir === 'asc' ? va - vb : vb - va;
  });

  return result;
}

// Parse field list textarea
export function parseFieldList(text) {
  return text.split('\n')
    .map(l => l.trim())
    .filter(l => l.length > 0);
}

// Find matched and missing players from field list
export function matchFieldList(fieldNames, allPlayers) {
  const playerNameSet = new Set(allPlayers.map(p => p.name.toLowerCase()));
  const matched = [];
  const missing = [];

  for (const name of fieldNames) {
    if (playerNameSet.has(name.toLowerCase())) {
      matched.push(name);
    } else {
      missing.push(name);
    }
  }

  return { matched, missing };
}

// Check if a player is in the field list
export function isInField(playerName) {
  if (state.fieldNames.length === 0) return false;
  const fieldSet = new Set(state.fieldNames.map(n => n.toLowerCase()));
  return fieldSet.has(playerName.toLowerCase());
}

// Export filtered data as CSV
export function exportCSV(players, eventOrder) {
  const headers = ['Rank', 'Player', 'Composite', 'Avg PVI', 'Median', 'Hit Rate %',
    'Floor', 'Ceiling', 'Volatility', 'CI', 'Momentum', 'Events'];
  const rows = players.map((p, i) => [
    i + 1,
    p.name,
    p.compositeScore.toFixed(3),
    p.avgPvi.toFixed(2),
    p.medianPvi.toFixed(2),
    p.hitRate.toFixed(1),
    p.floor.toFixed(2),
    p.ceiling.toFixed(2),
    p.volatility.toFixed(2),
    isFinite(p.consistencyIndex) ? p.consistencyIndex.toFixed(2) : 'Inf',
    p.trendMomentum.toFixed(3),
    p.events
  ]);

  const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
  downloadCSV(csv, 'pvi_export.csv');
}

// Export comparison data as CSV
export function exportComparisonCSV(players) {
  const headers = ['Stat', ...players.map(p => p.name)];
  const statRows = [
    ['Composite', ...players.map(p => p.compositeScore.toFixed(3))],
    ['Avg PVI', ...players.map(p => p.avgPvi.toFixed(2))],
    ['Median PVI', ...players.map(p => p.medianPvi.toFixed(2))],
    ['Hit Rate %', ...players.map(p => p.hitRate.toFixed(1))],
    ['Floor', ...players.map(p => p.floor.toFixed(2))],
    ['Ceiling', ...players.map(p => p.ceiling.toFixed(2))],
    ['Volatility', ...players.map(p => p.volatility.toFixed(2))],
    ['CI', ...players.map(p => isFinite(p.consistencyIndex) ? p.consistencyIndex.toFixed(2) : 'Inf')],
    ['Momentum', ...players.map(p => p.trendMomentum.toFixed(3))],
    ['Events', ...players.map(p => p.events)]
  ];

  const csv = [headers.join(','), ...statRows.map(r => r.join(','))].join('\n');
  downloadCSV(csv, 'pvi_comparison.csv');
}

function downloadCSV(csv, filename) {
  const blob = new Blob([csv], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}
