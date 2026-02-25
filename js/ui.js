// js/ui.js — DOM rendering for table, modal, comparison, summary cards

import { state, isInField } from './filters.js';
import { renderPlayerLineChart, renderPlayerHistogram, renderComparisonChart } from './charts.js';

let allPlayersRef = [];
let eventOrderRef = [];

export function setRefs(players, eventOrder) {
  allPlayersRef = players;
  eventOrderRef = eventOrder;
}

// ---------- STATUS ----------

export function setStatus(status, text) {
  const dot = document.getElementById('status-dot');
  const label = document.getElementById('status-label');
  dot.className = 'w-2 h-2 rounded-full';
  if (status === 'live') {
    dot.classList.add('bg-green-400', 'animate-pulse');
    label.textContent = text || 'LIVE';
    label.className = 'text-xs font-semibold text-green-400';
  } else if (status === 'connecting') {
    dot.classList.add('bg-yellow-400', 'animate-pulse');
    label.textContent = text || 'CONNECTING';
    label.className = 'text-xs font-semibold text-yellow-400';
  } else {
    dot.classList.add('bg-red-400');
    label.textContent = text || 'ERROR';
    label.className = 'text-xs font-semibold text-red-400';
  }
}

export function setDatasetMeta(events, players) {
  document.getElementById('dataset-meta').textContent = `Dataset: ${events} events · ${players} players`;
}

// ---------- SUMMARY CARDS ----------

export function renderSummaryCards(players, eventOrder) {
  document.getElementById('card-players').textContent = players.length;
  document.getElementById('card-events').textContent = eventOrder.length;

  const topComposite = players.reduce((best, p) =>
    p.compositeScore > best.compositeScore ? p : best, players[0]);
  document.getElementById('card-top-composite-name').textContent = topComposite ? topComposite.name : '—';
  document.getElementById('card-top-composite-val').textContent = topComposite
    ? topComposite.compositeScore.toFixed(3) : '—';

  const mostConsistent = players
    .filter(p => isFinite(p.consistencyIndex) && p.events >= 3)
    .reduce((best, p) => p.consistencyIndex > best.consistencyIndex ? p : best,
      { consistencyIndex: -Infinity, name: '—' });
  document.getElementById('card-consistent-name').textContent = mostConsistent.name;
  document.getElementById('card-consistent-val').textContent = isFinite(mostConsistent.consistencyIndex)
    ? mostConsistent.consistencyIndex.toFixed(2) : '—';
}

// ---------- MAIN TABLE ----------

const SORT_COLUMNS = [
  { key: 'rank', label: '#', sortable: false },
  { key: 'name', label: 'Player' },
  { key: 'compositeScore', label: 'Composite' },
  { key: 'avgPvi', label: 'Avg PVI' },
  { key: 'medianPvi', label: 'Median' },
  { key: 'hitRate', label: 'Hit Rate' },
  { key: 'floorCeiling', label: 'Floor / Ceiling' },
  { key: 'volatility', label: 'Volatility' },
  { key: 'consistencyIndex', label: 'CI' },
  { key: 'trendMomentum', label: 'Momentum' },
  { key: 'events', label: 'Events' },
  { key: 'sparkline', label: 'Trend', sortable: false },
  { key: 'compare', label: '', sortable: false }
];

export function renderTableHeader(onSort) {
  const thead = document.getElementById('main-thead');
  thead.innerHTML = '';
  const tr = document.createElement('tr');

  for (const col of SORT_COLUMNS) {
    const th = document.createElement('th');
    th.className = 'px-3 py-3 text-left text-xs font-medium uppercase tracking-wider cursor-pointer select-none whitespace-nowrap';

    if (col.key === 'sparkline') th.classList.add('hidden', 'lg:table-cell');
    if (col.key === 'medianPvi') th.classList.add('hidden', 'md:table-cell');
    if (col.key === 'floorCeiling') th.classList.add('hidden', 'md:table-cell');

    if (col.key === 'compare') {
      th.className = 'px-2 py-3 w-8';
      th.innerHTML = '';
    } else {
      let arrow = '';
      if (col.sortable !== false && state.sortKey === col.key) {
        arrow = state.sortDir === 'asc' ? ' ▲' : ' ▼';
      }
      th.textContent = col.label + arrow;
      th.style.color = '#94a3b8';

      if (col.sortable !== false) {
        th.addEventListener('click', () => {
          if (state.sortKey === col.key) {
            state.sortDir = state.sortDir === 'asc' ? 'desc' : 'asc';
          } else {
            state.sortKey = col.key;
            state.sortDir = 'desc';
          }
          onSort();
        });
      }
    }
    tr.appendChild(th);
  }
  thead.appendChild(tr);
}

export function renderTableBody(filteredPlayers, onPlayerClick, onCompareToggle) {
  const tbody = document.getElementById('main-tbody');
  tbody.innerHTML = '';

  const scores = allPlayersRef.map(p => p.compositeScore).sort((a, b) => a - b);
  const p25 = scores[Math.floor(scores.length * 0.25)] || 0;
  const p75 = scores[Math.floor(scores.length * 0.75)] || 0;

  const fieldSet = new Set(state.fieldNames.map(n => n.toLowerCase()));

  filteredPlayers.forEach((player, idx) => {
    const tr = document.createElement('tr');
    const inField = fieldSet.has(player.name.toLowerCase());
    const isOdd = idx % 2 === 1;

    let rowBg = isOdd ? 'rgba(255,255,255,0.015)' : 'transparent';
    if (inField && !state.fieldMode) rowBg = 'rgba(245,158,11,0.08)';

    tr.style.backgroundColor = rowBg;
    tr.className = 'hover:bg-white/5 transition-colors cursor-pointer border-b border-white/5';

    tr.addEventListener('click', (e) => {
      if (e.target.closest('.compare-cb')) return;
      onPlayerClick(player);
    });

    // Rank
    const tdRank = td(`${idx + 1}`, 'text-secondary font-mono text-sm');
    tr.appendChild(tdRank);

    // Name
    const tdName = td(player.name, 'font-semibold text-white text-sm');
    tr.appendChild(tdName);

    // Composite Score badge
    const tdComp = document.createElement('td');
    tdComp.className = 'px-3 py-2.5';
    const badge = document.createElement('span');
    badge.className = 'inline-block px-2 py-0.5 rounded text-xs font-bold font-mono';
    if (player.compositeScore >= p75) {
      badge.style.cssText = 'background:rgba(57,255,136,0.15);color:#39FF88;';
    } else if (player.compositeScore >= p25) {
      badge.style.cssText = 'background:rgba(57,223,255,0.15);color:#39DFFF;';
    } else {
      badge.style.cssText = 'background:rgba(239,68,68,0.15);color:#ef4444;';
    }
    badge.textContent = player.compositeScore.toFixed(3);
    tdComp.appendChild(badge);
    tr.appendChild(tdComp);

    // Avg PVI
    const avgColor = player.avgPvi >= 1.0 ? '#39FF88' : '#94a3b8';
    const tdAvg = td(player.avgPvi.toFixed(2), 'font-mono text-sm');
    tdAvg.firstChild.style.color = avgColor;
    tr.appendChild(tdAvg);

    // Median
    const tdMed = td(player.medianPvi.toFixed(2), 'font-mono text-sm hidden md:table-cell');
    tr.appendChild(tdMed);

    // Hit Rate
    const tdHit = document.createElement('td');
    tdHit.className = 'px-3 py-2.5';
    tdHit.innerHTML = `
      <div class="font-mono text-sm text-white">${player.hitRate.toFixed(0)}%</div>
      <div class="w-full h-1 rounded-full mt-1" style="background:rgba(255,255,255,0.06)">
        <div class="h-full rounded-full" style="width:${Math.min(player.hitRate, 100)}%;background:#39FF88"></div>
      </div>`;
    tr.appendChild(tdHit);

    // Floor / Ceiling
    const tdFC = td(`${player.floor.toFixed(2)} → ${player.ceiling.toFixed(2)}`, 'font-mono text-sm text-secondary hidden md:table-cell');
    tr.appendChild(tdFC);

    // Volatility
    const tdVol = td(player.volatility.toFixed(2), 'font-mono text-sm text-secondary');
    tr.appendChild(tdVol);

    // CI
    const ciVal = isFinite(player.consistencyIndex) ? player.consistencyIndex.toFixed(2) : '∞';
    const ciColor = (isFinite(player.consistencyIndex) && player.consistencyIndex > 1.0) ? '#39DFFF' : '#94a3b8';
    const tdCI = td(ciVal, 'font-mono text-sm');
    tdCI.firstChild.style.color = ciColor;
    tr.appendChild(tdCI);

    // Momentum
    const momVal = player.trendMomentum;
    const momStr = (momVal >= 0 ? '+' : '') + momVal.toFixed(3);
    const momColor = momVal >= 0 ? '#39FF88' : '#ef4444';
    const tdMom = td(momStr, 'font-mono text-sm');
    tdMom.firstChild.style.color = momColor;
    tr.appendChild(tdMom);

    // Events
    const tdEv = td(player.events, 'font-mono text-sm text-secondary');
    tr.appendChild(tdEv);

    // Sparkline
    const tdSpark = document.createElement('td');
    tdSpark.className = 'px-3 py-2.5 hidden lg:table-cell';
    tdSpark.appendChild(createSparkline(player, eventOrderRef));
    tr.appendChild(tdSpark);

    // Compare checkbox
    const tdCmp = document.createElement('td');
    tdCmp.className = 'px-2 py-2.5 compare-cb';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = state.selectedPlayers.has(player.name);
    cb.className = 'w-4 h-4 rounded accent-green-400 cursor-pointer';
    cb.addEventListener('change', () => onCompareToggle(player, cb.checked));
    tdCmp.appendChild(cb);
    tr.appendChild(tdCmp);

    tbody.appendChild(tr);
  });
}

function td(content, classes) {
  const el = document.createElement('td');
  el.className = `px-3 py-2.5 ${classes || ''}`;
  const span = document.createElement('span');
  span.textContent = content;
  el.appendChild(span);
  return el;
}

function createSparkline(player, eventOrder) {
  const values = [];
  const labels = [];
  for (const d of player.eventsDetail) {
    values.push(d.pvi);
    labels.push(d.eventName);
  }

  if (values.length === 0) {
    const span = document.createElement('span');
    span.textContent = '—';
    return span;
  }

  const w = 80, h = 28;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;

  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('width', w);
  svg.setAttribute('height', h);
  svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
  svg.style.cursor = 'pointer';

  const points = values.map((v, i) => {
    const x = values.length === 1 ? w / 2 : (i / (values.length - 1)) * (w - 4) + 2;
    const y = h - 3 - ((v - min) / range) * (h - 6);
    return { x, y, v, label: labels[i] };
  });

  const polyline = document.createElementNS(ns, 'polyline');
  polyline.setAttribute('points', points.map(p => `${p.x},${p.y}`).join(' '));
  polyline.setAttribute('fill', 'none');
  polyline.setAttribute('stroke', '#39FF88');
  polyline.setAttribute('stroke-width', '1.5');
  polyline.setAttribute('stroke-linejoin', 'round');
  svg.appendChild(polyline);

  // Tooltip group
  const tooltip = document.createElement('div');
  tooltip.className = 'fixed z-50 pointer-events-none px-2 py-1 rounded text-xs font-mono hidden';
  tooltip.style.cssText = 'background:#0E0E12;color:#ffffff;border:1px solid rgba(255,255,255,0.1);';
  document.body.appendChild(tooltip);

  // Hover dots
  for (const pt of points) {
    const circle = document.createElementNS(ns, 'circle');
    circle.setAttribute('cx', pt.x);
    circle.setAttribute('cy', pt.y);
    circle.setAttribute('r', '3');
    circle.setAttribute('fill', 'transparent');
    circle.setAttribute('stroke', 'transparent');
    circle.style.cursor = 'pointer';

    circle.addEventListener('mouseenter', (e) => {
      circle.setAttribute('fill', pt.v >= 1.0 ? '#39FF88' : '#ef4444');
      circle.setAttribute('stroke', '#fff');
      circle.setAttribute('r', '4');
      tooltip.textContent = `${pt.label}: ${pt.v.toFixed(2)}`;
      tooltip.classList.remove('hidden');
      tooltip.style.left = e.clientX + 10 + 'px';
      tooltip.style.top = e.clientY - 30 + 'px';
    });

    circle.addEventListener('mouseleave', () => {
      circle.setAttribute('fill', 'transparent');
      circle.setAttribute('stroke', 'transparent');
      circle.setAttribute('r', '3');
      tooltip.classList.add('hidden');
    });

    circle.addEventListener('mousemove', (e) => {
      tooltip.style.left = e.clientX + 10 + 'px';
      tooltip.style.top = e.clientY - 30 + 'px';
    });

    svg.appendChild(circle);
  }

  const container = document.createElement('div');
  container.className = 'inline-block';
  container.appendChild(svg);
  return container;
}

// ---------- PLAYER MODAL ----------

export function openPlayerModal(player) {
  const modal = document.getElementById('player-modal');
  const overlay = document.getElementById('modal-overlay');

  // Header
  document.getElementById('modal-player-name').textContent = player.name;
  document.getElementById('modal-events-count').textContent = `${player.events} events`;
  const pctRank = Math.round(100 - player.percentileRank);
  document.getElementById('modal-percentile').textContent = `Top ${Math.max(1, pctRank)}%`;
  document.getElementById('modal-percentile').style.color = pctRank <= 25 ? '#39FF88' : '#39DFFF';

  // Stat cards
  document.getElementById('modal-avg').textContent = player.avgPvi.toFixed(2);
  document.getElementById('modal-median').textContent = player.medianPvi.toFixed(2);
  document.getElementById('modal-hitrate').textContent = player.hitRate.toFixed(0) + '%';
  document.getElementById('modal-ci').textContent = isFinite(player.consistencyIndex) ? player.consistencyIndex.toFixed(2) : '∞';
  document.getElementById('modal-momentum').textContent = (player.trendMomentum >= 0 ? '+' : '') + player.trendMomentum.toFixed(3);
  document.getElementById('modal-momentum').style.color = player.trendMomentum >= 0 ? '#39FF88' : '#ef4444';
  document.getElementById('modal-composite').textContent = player.compositeScore.toFixed(3);

  // Charts
  setTimeout(() => {
    renderPlayerLineChart('modal-line-chart', player, eventOrderRef);
    renderPlayerHistogram('modal-hist-chart', player);
  }, 50);

  // Event history table
  const etbody = document.getElementById('modal-events-tbody');
  etbody.innerHTML = '';
  for (const detail of player.eventsDetail) {
    const tr = document.createElement('tr');
    const pviColor = detail.pvi >= 1.0 ? 'rgba(57,255,136,0.06)' : detail.pvi < 0.5 ? 'rgba(239,68,68,0.06)' : 'transparent';
    tr.style.backgroundColor = pviColor;
    tr.className = 'border-b border-white/5';

    const tdName = document.createElement('td');
    tdName.className = 'px-3 py-2 text-sm text-white';
    tdName.textContent = detail.eventName;
    tr.appendChild(tdName);

    const tdPvi = document.createElement('td');
    tdPvi.className = 'px-3 py-2 text-sm font-mono';
    tdPvi.style.color = detail.pvi >= 1.0 ? '#39FF88' : detail.pvi < 0.5 ? '#ef4444' : '#94a3b8';
    tdPvi.textContent = detail.pvi.toFixed(2);
    tr.appendChild(tdPvi);

    const tdZ = document.createElement('td');
    tdZ.className = 'px-3 py-2';
    const zBadge = document.createElement('span');
    zBadge.className = 'text-xs px-2 py-0.5 rounded font-mono';
    if (detail.zScore >= 1.5) {
      zBadge.textContent = 'High Outlier';
      zBadge.style.cssText = 'background:rgba(57,255,136,0.15);color:#39FF88;';
    } else if (detail.zScore <= -1.5) {
      zBadge.textContent = 'Low Outlier';
      zBadge.style.cssText = 'background:rgba(239,68,68,0.15);color:#ef4444;';
    } else {
      zBadge.textContent = 'Normal';
      zBadge.style.cssText = 'background:rgba(255,255,255,0.06);color:#94a3b8;';
    }
    tdZ.appendChild(zBadge);
    tr.appendChild(tdZ);

    etbody.appendChild(tr);
  }

  // Show
  modal.classList.remove('translate-x-full');
  modal.classList.add('translate-x-0');
  overlay.classList.remove('hidden');
  overlay.classList.add('block');
}

export function closePlayerModal() {
  const modal = document.getElementById('player-modal');
  const overlay = document.getElementById('modal-overlay');
  modal.classList.remove('translate-x-0');
  modal.classList.add('translate-x-full');
  overlay.classList.remove('block');
  overlay.classList.add('hidden');
}

// ---------- COMPARISON PANEL ----------

export function renderComparisonPanel(players) {
  const panel = document.getElementById('comparison-panel');

  if (players.length < 2) {
    panel.classList.add('translate-y-full');
    return;
  }

  panel.classList.remove('translate-y-full');

  const headers = document.getElementById('comparison-headers');
  headers.innerHTML = '<th class="px-3 py-2 text-xs text-secondary">Stat</th>' +
    players.map(p => `<th class="px-3 py-2 text-sm text-white font-semibold">${p.name}</th>`).join('');

  const statDefs = [
    { label: 'Composite', fn: p => p.compositeScore.toFixed(3) },
    { label: 'Avg PVI', fn: p => p.avgPvi.toFixed(2) },
    { label: 'Median', fn: p => p.medianPvi.toFixed(2) },
    { label: 'Hit Rate', fn: p => p.hitRate.toFixed(0) + '%' },
    { label: 'Floor', fn: p => p.floor.toFixed(2) },
    { label: 'Ceiling', fn: p => p.ceiling.toFixed(2) },
    { label: 'Volatility', fn: p => p.volatility.toFixed(2) },
    { label: 'CI', fn: p => isFinite(p.consistencyIndex) ? p.consistencyIndex.toFixed(2) : '∞' },
    { label: 'Momentum', fn: p => (p.trendMomentum >= 0 ? '+' : '') + p.trendMomentum.toFixed(3) },
    { label: 'Events', fn: p => p.events }
  ];

  const tbody = document.getElementById('comparison-tbody');
  tbody.innerHTML = '';
  for (const sd of statDefs) {
    const tr = document.createElement('tr');
    tr.className = 'border-b border-white/5';
    tr.innerHTML = `<td class="px-3 py-1.5 text-xs text-secondary">${sd.label}</td>` +
      players.map(p => `<td class="px-3 py-1.5 text-sm font-mono text-white">${sd.fn(p)}</td>`).join('');
    tbody.appendChild(tr);
  }

  // Comparison chart
  setTimeout(() => {
    renderComparisonChart('comparison-chart', players, eventOrderRef);
  }, 50);
}

// ---------- SKELETON LOADER ----------

export function showSkeleton(show) {
  const el = document.getElementById('skeleton-loader');
  if (show) {
    el.classList.remove('hidden');
  } else {
    el.classList.add('hidden');
  }
}

export function setLoadingStatus(text) {
  const el = document.getElementById('loading-status');
  if (text) {
    el.textContent = text;
    el.classList.remove('hidden');
  } else {
    el.classList.add('hidden');
  }
}

// ---------- FIELD TOOLS ----------

export function renderFieldStats(fieldNames, allPlayers) {
  const statsEl = document.getElementById('field-stats');
  if (fieldNames.length === 0) {
    statsEl.innerHTML = '';
    return;
  }

  const playerNameSet = new Set(allPlayers.map(p => p.name.toLowerCase()));
  const matched = fieldNames.filter(n => playerNameSet.has(n.toLowerCase()));
  const missing = fieldNames.filter(n => !playerNameSet.has(n.toLowerCase()));

  let html = `<p class="text-sm text-secondary"><span class="text-white font-semibold">${matched.length}</span> of ${fieldNames.length} players have PVI data (${((matched.length / fieldNames.length) * 100).toFixed(0)}%)</p>`;

  if (missing.length > 0) {
    html += `<div class="mt-2"><p class="text-xs text-red-400 mb-1">Missing from dataset:</p><div class="flex flex-wrap gap-1">`;
    for (const m of missing) {
      html += `<span class="text-xs px-2 py-0.5 rounded" style="background:rgba(239,68,68,0.1);color:#ef4444;">${m}</span>`;
    }
    html += '</div></div>';
  }

  statsEl.innerHTML = html;
}
