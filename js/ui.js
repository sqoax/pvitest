// js/ui.js — DOM rendering for table, modal, comparison, summary cards, preview, heatmap, tags

import { state, isInField, getTag, setTag, loadTags, applyPreviewSort } from './filters.js';
import { renderPlayerLineChart, renderPlayerHistogram, renderComparisonChart, getTierColor } from './charts.js';

let allPlayersRef = [];
let eventOrderRef = [];
let tournamentStatsRef = [];

export function setRefs(players, eventOrder, tournamentStats) {
  allPlayersRef = players;
  eventOrderRef = eventOrder;
  tournamentStatsRef = tournamentStats || [];
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

// ---------- TAG HELPERS ----------

const TAG_COLORS = {
  follow: { dot: '#39FF88', label: 'Follow' },
  fade: { dot: '#ef4444', label: 'Fade' },
  watch: { dot: '#facc15', label: 'Watch' }
};

function createTagDot(tag) {
  if (!tag || !TAG_COLORS[tag]) return null;
  const dot = document.createElement('span');
  dot.className = 'inline-block w-2 h-2 rounded-full mr-1.5 flex-shrink-0';
  dot.style.backgroundColor = TAG_COLORS[tag].dot;
  dot.title = TAG_COLORS[tag].label;
  return dot;
}

function showTagMenu(x, y, playerName, onDone) {
  closeAllTagMenus();
  const menu = document.createElement('div');
  menu.className = 'tag-context-menu fixed z-[100] rounded-lg py-1 text-sm shadow-xl';
  menu.style.cssText = `left:${x}px;top:${y}px;background:#1a1a22;border:1px solid rgba(255,255,255,0.1);min-width:140px;`;

  const items = [
    { icon: '✅', label: 'Follow', value: 'follow' },
    { icon: '❌', label: 'Fade', value: 'fade' },
    { icon: '👀', label: 'Watch', value: 'watch' },
    { icon: '—', label: 'Clear Tag', value: null }
  ];

  for (const item of items) {
    const btn = document.createElement('button');
    btn.className = 'w-full text-left px-3 py-1.5 hover:bg-white/10 flex items-center gap-2 text-white/80 hover:text-white transition-colors';
    btn.innerHTML = `<span>${item.icon}</span><span>${item.label}</span>`;
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      setTag(playerName, item.value);
      closeAllTagMenus();
      if (onDone) onDone();
    });
    menu.appendChild(btn);
  }

  document.body.appendChild(menu);

  // Clamp to viewport
  requestAnimationFrame(() => {
    const rect = menu.getBoundingClientRect();
    if (rect.right > window.innerWidth) menu.style.left = (window.innerWidth - rect.width - 8) + 'px';
    if (rect.bottom > window.innerHeight) menu.style.top = (window.innerHeight - rect.height - 8) + 'px';
  });

  const closer = (e) => {
    if (!menu.contains(e.target)) { closeAllTagMenus(); document.removeEventListener('click', closer, true); }
  };
  setTimeout(() => document.addEventListener('click', closer, true), 0);
}

function closeAllTagMenus() {
  document.querySelectorAll('.tag-context-menu').forEach(el => el.remove());
}

// ---------- HEATMAP HELPERS ----------

function computePercentiles(filteredPlayers, key, invert) {
  const vals = filteredPlayers.map(p => {
    let v = p[key];
    if (!isFinite(v)) v = invert ? 999 : -999;
    return v;
  }).sort((a, b) => a - b);

  return (value) => {
    let v = isFinite(value) ? value : (invert ? 999 : -999);
    let rank = 0;
    for (let i = 0; i < vals.length; i++) {
      if (vals[i] <= v) rank = i;
    }
    return vals.length > 1 ? rank / (vals.length - 1) : 0.5;
  };
}

function heatmapBg(percentile, isGood) {
  // isGood: true = higher is better (green), false = lower is better (red for high)
  const opacity = 0.05 + percentile * 0.65; // 0.05 to 0.7
  if (isGood) {
    return `rgba(57,255,136,${opacity.toFixed(3)})`;
  } else {
    return `rgba(239,68,68,${opacity.toFixed(3)})`;
  }
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

export function renderTableBody(filteredPlayers, onPlayerClick, onCompareToggle, onTagChange) {
  const tbody = document.getElementById('main-tbody');
  tbody.innerHTML = '';

  const scores = allPlayersRef.map(p => p.compositeScore).sort((a, b) => a - b);
  const p25 = scores[Math.floor(scores.length * 0.25)] || 0;
  const p75 = scores[Math.floor(scores.length * 0.75)] || 0;

  const fieldSet = new Set(state.fieldNames.map(n => n.toLowerCase()));

  // Heatmap percentile functions
  let hm = null;
  if (state.heatmapOn && filteredPlayers.length > 1) {
    hm = {
      composite: computePercentiles(filteredPlayers, 'compositeScore'),
      avgPvi: computePercentiles(filteredPlayers, 'avgPvi'),
      medianPvi: computePercentiles(filteredPlayers, 'medianPvi'),
      hitRate: computePercentiles(filteredPlayers, 'hitRate'),
      volatility: computePercentiles(filteredPlayers, 'volatility'),
      ci: computePercentiles(filteredPlayers, 'consistencyIndex'),
      momentum: computePercentiles(filteredPlayers, 'trendMomentum'),
      floor: computePercentiles(filteredPlayers, 'floor'),
      ceiling: computePercentiles(filteredPlayers, 'ceiling')
    };
  }

  filteredPlayers.forEach((player, idx) => {
    const tr = document.createElement('tr');
    const inField = fieldSet.has(player.name.toLowerCase());
    const isOdd = idx % 2 === 1;

    let rowBg = isOdd ? 'rgba(255,255,255,0.015)' : 'transparent';
    if (inField && !state.fieldMode) rowBg = 'rgba(245,158,11,0.08)';

    tr.style.backgroundColor = rowBg;
    tr.className = 'hover:bg-white/5 transition-colors cursor-pointer border-b border-white/5 relative';

    tr.addEventListener('click', (e) => {
      if (e.target.closest('.compare-cb') || e.target.closest('.tag-menu-btn') || e.target.closest('.tag-context-menu')) return;
      onPlayerClick(player);
    });

    // Right-click for tag menu
    tr.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      showTagMenu(e.clientX, e.clientY, player.name, () => { if (onTagChange) onTagChange(); });
    });

    // Rank
    tr.appendChild(td(`${idx + 1}`, 'text-secondary font-mono text-sm'));

    // Name (with tag dot, regression icons, and menu button)
    const tdName = document.createElement('td');
    tdName.className = 'px-3 py-2.5 text-sm';
    const nameWrap = document.createElement('div');
    nameWrap.className = 'flex items-center gap-1';

    const tag = getTag(player.name);
    const tagDot = createTagDot(tag);
    if (tagDot) nameWrap.appendChild(tagDot);

    const nameSpan = document.createElement('span');
    nameSpan.className = 'font-semibold text-white';
    nameSpan.textContent = player.name;
    nameWrap.appendChild(nameSpan);

    if (player.regressionFlag) {
      const warn = document.createElement('span');
      warn.className = 'cursor-help ml-1';
      warn.textContent = '⚠️';
      warn.title = player.regressionDetail;
      warn.style.fontSize = '12px';
      nameWrap.appendChild(warn);
    }
    if (player.smallSampleFlag) {
      const ss = document.createElement('span');
      ss.className = 'cursor-help ml-0.5';
      ss.textContent = '🔬';
      ss.title = `Small sample — only ${player.events} events`;
      ss.style.fontSize = '12px';
      nameWrap.appendChild(ss);
    }

    // Tag menu button (visible on hover via CSS)
    const menuBtn = document.createElement('button');
    menuBtn.className = 'tag-menu-btn ml-auto text-secondary hover:text-white opacity-0 group-hover:opacity-100 transition-opacity text-xs px-1';
    menuBtn.textContent = '⋮';
    menuBtn.style.fontSize = '14px';
    menuBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const rect = menuBtn.getBoundingClientRect();
      showTagMenu(rect.left, rect.bottom + 4, player.name, () => { if (onTagChange) onTagChange(); });
    });
    nameWrap.appendChild(menuBtn);

    tdName.appendChild(nameWrap);
    tr.appendChild(tdName);
    tr.classList.add('group');

    // Composite Score badge
    const tdComp = document.createElement('td');
    tdComp.className = 'px-3 py-2.5';
    if (hm) tdComp.style.backgroundColor = heatmapBg(hm.composite(player.compositeScore), true);
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
    if (hm) tdAvg.style.backgroundColor = heatmapBg(hm.avgPvi(player.avgPvi), true);
    tr.appendChild(tdAvg);

    // Median
    const tdMed = td(player.medianPvi.toFixed(2), 'font-mono text-sm hidden md:table-cell');
    if (hm) tdMed.style.backgroundColor = heatmapBg(hm.medianPvi(player.medianPvi), true);
    tr.appendChild(tdMed);

    // Hit Rate
    const tdHit = document.createElement('td');
    tdHit.className = 'px-3 py-2.5';
    if (hm) tdHit.style.backgroundColor = heatmapBg(hm.hitRate(player.hitRate), true);
    tdHit.innerHTML = `
      <div class="font-mono text-sm text-white">${player.hitRate.toFixed(0)}%</div>
      <div class="w-full h-1 rounded-full mt-1" style="background:rgba(255,255,255,0.06)">
        <div class="h-full rounded-full" style="width:${Math.min(player.hitRate, 100)}%;background:#39FF88"></div>
      </div>`;
    tr.appendChild(tdHit);

    // Floor / Ceiling
    const tdFC = document.createElement('td');
    tdFC.className = 'px-3 py-2.5 font-mono text-sm hidden md:table-cell';
    if (hm) {
      // Split coloring: we'll color the whole cell by ceiling percentile (higher = better)
      tdFC.style.backgroundColor = heatmapBg(hm.ceiling(player.ceiling), true);
    }
    const floorSpan = document.createElement('span');
    floorSpan.textContent = player.floor.toFixed(2);
    floorSpan.style.color = '#94a3b8';
    const arrow = document.createElement('span');
    arrow.textContent = ' → ';
    arrow.style.color = '#94a3b8';
    const ceilSpan = document.createElement('span');
    ceilSpan.textContent = player.ceiling.toFixed(2);
    ceilSpan.style.color = '#94a3b8';
    tdFC.appendChild(floorSpan);
    tdFC.appendChild(arrow);
    tdFC.appendChild(ceilSpan);
    tr.appendChild(tdFC);

    // Volatility (lower = better, so invert the color)
    const tdVol = td(player.volatility.toFixed(2), 'font-mono text-sm text-secondary');
    if (hm) tdVol.style.backgroundColor = heatmapBg(hm.volatility(player.volatility), false);
    tr.appendChild(tdVol);

    // CI
    const ciVal = isFinite(player.consistencyIndex) ? player.consistencyIndex.toFixed(2) : '∞';
    const ciColor = (isFinite(player.consistencyIndex) && player.consistencyIndex > 1.0) ? '#39DFFF' : '#94a3b8';
    const tdCI = td(ciVal, 'font-mono text-sm');
    tdCI.firstChild.style.color = ciColor;
    if (hm) tdCI.style.backgroundColor = heatmapBg(hm.ci(player.consistencyIndex), true);
    tr.appendChild(tdCI);

    // Momentum
    const momVal = player.trendMomentum;
    const momStr = (momVal >= 0 ? '+' : '') + momVal.toFixed(3);
    const momColor = momVal >= 0 ? '#39FF88' : '#ef4444';
    const tdMom = td(momStr, 'font-mono text-sm');
    tdMom.firstChild.style.color = momColor;
    if (hm) tdMom.style.backgroundColor = heatmapBg(hm.momentum(player.trendMomentum), true);
    tr.appendChild(tdMom);

    // Events
    tr.appendChild(td(player.events, 'font-mono text-sm text-secondary'));

    // Sparkline
    const tdSpark = document.createElement('td');
    tdSpark.className = 'px-3 py-2.5 hidden lg:table-cell';
    tdSpark.appendChild(createSparkline(player));
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

  // Heatmap legend
  const legendEl = document.getElementById('heatmap-legend');
  if (legendEl) {
    legendEl.classList.toggle('hidden', !state.heatmapOn);
  }
}

function td(content, classes) {
  const el = document.createElement('td');
  el.className = `px-3 py-2.5 ${classes || ''}`;
  const span = document.createElement('span');
  span.textContent = content;
  el.appendChild(span);
  return el;
}

function createSparkline(player) {
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

  const tooltip = document.createElement('div');
  tooltip.className = 'fixed z-50 pointer-events-none px-2 py-1 rounded text-xs font-mono hidden';
  tooltip.style.cssText = 'background:#0E0E12;color:#ffffff;border:1px solid rgba(255,255,255,0.1);';
  document.body.appendChild(tooltip);

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

  // Tag badge in modal
  const modalTagArea = document.getElementById('modal-tag-area');
  modalTagArea.innerHTML = '';
  const currentTag = getTag(player.name);
  const tagSelect = document.createElement('select');
  tagSelect.className = 'text-xs rounded px-2 py-1 cursor-pointer';
  tagSelect.style.cssText = 'background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);color:#94a3b8;outline:none;';
  const tagOpts = [
    { value: '', label: 'No Tag' },
    { value: 'follow', label: '✅ Follow' },
    { value: 'fade', label: '❌ Fade' },
    { value: 'watch', label: '👀 Watch' }
  ];
  for (const opt of tagOpts) {
    const o = document.createElement('option');
    o.value = opt.value;
    o.textContent = opt.label;
    if ((currentTag || '') === opt.value) o.selected = true;
    tagSelect.appendChild(o);
  }
  tagSelect.addEventListener('change', () => {
    setTag(player.name, tagSelect.value || null);
  });
  modalTagArea.appendChild(tagSelect);

  // Regression warning banner
  const bannerEl = document.getElementById('modal-regression-banner');
  if (player.regressionFlag) {
    bannerEl.classList.remove('hidden');
    bannerEl.innerHTML = `⚠️ <strong>Outlier Alert:</strong> ${player.regressionDetail}. Average may be misleading — check median.`;
  } else {
    bannerEl.classList.add('hidden');
    bannerEl.innerHTML = '';
  }

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

  setTimeout(() => {
    renderComparisonChart('comparison-chart', players, eventOrderRef);
  }, 50);
}

// ---------- SKELETON LOADER ----------

export function showSkeleton(show) {
  const el = document.getElementById('skeleton-loader');
  if (show) el.classList.remove('hidden');
  else el.classList.add('hidden');
}

export function setLoadingStatus(text) {
  const el = document.getElementById('loading-status');
  if (text) { el.textContent = text; el.classList.remove('hidden'); }
  else el.classList.add('hidden');
}

// ---------- FIELD TOOLS ----------

export function renderFieldStats(fieldNames, allPlayers) {
  const statsEl = document.getElementById('field-stats');
  if (fieldNames.length === 0) { statsEl.innerHTML = ''; return; }

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

// ---------- PREVIEW TAB ----------

export function renderPreviewTable(fieldNames, allPlayers, onPlayerClick, onSortChange) {
  const outputEl = document.getElementById('preview-output');
  const summaryEl = document.getElementById('preview-summary');

  if (!fieldNames || fieldNames.length === 0) {
    outputEl.innerHTML = '<p class="text-secondary text-sm py-8 text-center">Paste a field list and click "Load Field" to see rankings.</p>';
    summaryEl.innerHTML = '';
    return;
  }

  const playerMap = new Map(allPlayers.map(p => [p.name.toLowerCase(), p]));
  const scores = allPlayers.map(p => p.compositeScore).sort((a, b) => a - b);
  const p25 = scores[Math.floor(scores.length * 0.25)] || 0;
  const p75 = scores[Math.floor(scores.length * 0.75)] || 0;

  // Build preview list
  let previewList = fieldNames.map(name => {
    const p = playerMap.get(name.toLowerCase());
    if (p) return { ...p, _hasData: true, _originalName: name };
    return {
      name, _hasData: false, _originalName: name,
      compositeScore: -1, avgPvi: 0, medianPvi: 0, hitRate: 0,
      consistencyIndex: 0, trendMomentum: 0, events: 0, volatility: 0,
      floor: 0, ceiling: 0, regressionFlag: false, smallSampleFlag: false
    };
  });

  previewList = applyPreviewSort(previewList);

  // Summary
  const withData = previewList.filter(p => p._hasData);
  const missing = previewList.filter(p => !p._hasData);
  const avgComp = withData.length > 0 ? (withData.reduce((s, p) => s + p.compositeScore, 0) / withData.length) : 0;
  const avgPvi = withData.length > 0 ? (withData.reduce((s, p) => s + p.avgPvi, 0) / withData.length) : 0;

  let sumHtml = `
    <div class="flex flex-wrap gap-4 mb-3">
      <div class="text-sm text-secondary"><span class="text-white font-semibold">${withData.length}</span> of ${fieldNames.length} players have PVI data (${((withData.length / fieldNames.length) * 100).toFixed(0)}%)</div>
      <div class="text-sm text-secondary">Field Avg Composite: <span class="text-white font-mono font-semibold">${avgComp.toFixed(3)}</span></div>
      <div class="text-sm text-secondary">Field Avg PVI: <span class="text-white font-mono font-semibold">${avgPvi.toFixed(2)}</span></div>
    </div>`;

  if (missing.length > 0) {
    sumHtml += `<details class="mb-2"><summary class="text-xs text-red-400 cursor-pointer hover:text-red-300">Missing from dataset (${missing.length})</summary><div class="flex flex-wrap gap-1 mt-1">`;
    for (const m of missing) {
      sumHtml += `<span class="text-xs px-2 py-0.5 rounded" style="background:rgba(239,68,68,0.1);color:#ef4444;">${m.name}</span>`;
    }
    sumHtml += '</div></details>';
  }
  summaryEl.innerHTML = sumHtml;

  // Preview table header
  const PREVIEW_COLS = [
    { key: 'rank', label: '#', sortable: false },
    { key: 'name', label: 'Player' },
    { key: 'compositeScore', label: 'Composite' },
    { key: 'avgPvi', label: 'Avg PVI' },
    { key: 'medianPvi', label: 'Median' },
    { key: 'hitRate', label: 'Hit Rate' },
    { key: 'consistencyIndex', label: 'CI' },
    { key: 'trendMomentum', label: 'Momentum' },
    { key: 'events', label: 'Events' },
    { key: 'flags', label: '', sortable: false },
    { key: 'tag', label: 'Tag', sortable: false }
  ];

  let tableHtml = '<table class="w-full text-left"><thead><tr>';
  for (const col of PREVIEW_COLS) {
    const isSorted = col.sortable !== false && state.previewSortKey === col.key;
    const arrow = isSorted ? (state.previewSortDir === 'asc' ? ' ▲' : ' ▼') : '';
    const cursor = col.sortable !== false ? 'cursor-pointer' : '';
    tableHtml += `<th class="px-3 py-2.5 text-xs font-medium uppercase tracking-wider select-none whitespace-nowrap ${cursor}" style="color:#94a3b8" data-sort-key="${col.key}" data-sortable="${col.sortable !== false}">${col.label}${arrow}</th>`;
  }
  tableHtml += '</tr></thead><tbody>';

  previewList.forEach((p, idx) => {
    const tag = getTag(p.name);
    const tagDotHtml = tag && TAG_COLORS[tag]
      ? `<span class="inline-block w-2 h-2 rounded-full mr-1" style="background:${TAG_COLORS[tag].dot}" title="${TAG_COLORS[tag].label}"></span>`
      : '';

    const rowClass = p._hasData ? 'cursor-pointer hover:bg-white/5' : 'opacity-60';
    const bgClass = idx % 2 === 1 ? 'background:rgba(255,255,255,0.015)' : '';

    tableHtml += `<tr class="${rowClass} border-b border-white/5 transition-colors" style="${bgClass}" data-player-name="${p.name}" data-has-data="${p._hasData}">`;

    // Rank
    tableHtml += `<td class="px-3 py-2.5 text-secondary font-mono text-sm">${idx + 1}</td>`;

    // Name
    const nameColor = p._hasData ? 'text-white' : 'text-secondary';
    const noBadge = !p._hasData ? ' <span class="text-xs px-1.5 py-0.5 rounded ml-1" style="background:rgba(255,255,255,0.06);color:#94a3b8;">No Data</span>' : '';
    tableHtml += `<td class="px-3 py-2.5 text-sm font-semibold ${nameColor}">${tagDotHtml}${escHtml(p.name)}${noBadge}</td>`;

    if (p._hasData) {
      // Composite badge
      let badgeStyle;
      if (p.compositeScore >= p75) badgeStyle = 'background:rgba(57,255,136,0.15);color:#39FF88;';
      else if (p.compositeScore >= p25) badgeStyle = 'background:rgba(57,223,255,0.15);color:#39DFFF;';
      else badgeStyle = 'background:rgba(239,68,68,0.15);color:#ef4444;';
      tableHtml += `<td class="px-3 py-2.5"><span class="inline-block px-2 py-0.5 rounded text-xs font-bold font-mono" style="${badgeStyle}">${p.compositeScore.toFixed(3)}</span></td>`;

      // Avg PVI
      const avgColor = p.avgPvi >= 1.0 ? '#39FF88' : '#94a3b8';
      tableHtml += `<td class="px-3 py-2.5 font-mono text-sm" style="color:${avgColor}">${p.avgPvi.toFixed(2)}</td>`;

      // Median
      tableHtml += `<td class="px-3 py-2.5 font-mono text-sm text-secondary">${p.medianPvi.toFixed(2)}</td>`;

      // Hit Rate
      tableHtml += `<td class="px-3 py-2.5 font-mono text-sm text-white">${p.hitRate.toFixed(0)}%</td>`;

      // CI
      const ciColor = (isFinite(p.consistencyIndex) && p.consistencyIndex > 1.0) ? '#39DFFF' : '#94a3b8';
      const ciVal = isFinite(p.consistencyIndex) ? p.consistencyIndex.toFixed(2) : '∞';
      tableHtml += `<td class="px-3 py-2.5 font-mono text-sm" style="color:${ciColor}">${ciVal}</td>`;

      // Momentum
      const momColor = p.trendMomentum >= 0 ? '#39FF88' : '#ef4444';
      const momStr = (p.trendMomentum >= 0 ? '+' : '') + p.trendMomentum.toFixed(3);
      tableHtml += `<td class="px-3 py-2.5 font-mono text-sm" style="color:${momColor}">${momStr}</td>`;

      // Events
      tableHtml += `<td class="px-3 py-2.5 font-mono text-sm text-secondary">${p.events}</td>`;

      // Flags
      let flags = '';
      if (p.regressionFlag) flags += `<span class="cursor-help" title="${escHtml(p.regressionDetail)}" style="font-size:12px">⚠️</span>`;
      if (p.smallSampleFlag) flags += `<span class="cursor-help" title="Small sample — only ${p.events} events" style="font-size:12px">🔬</span>`;
      tableHtml += `<td class="px-3 py-2.5 text-sm">${flags}</td>`;
    } else {
      tableHtml += '<td class="px-3 py-2.5"></td>'.repeat(8);
    }

    // Tag
    const tagLabel = tag && TAG_COLORS[tag] ? TAG_COLORS[tag].label : '';
    tableHtml += `<td class="px-3 py-2.5 text-xs text-secondary">${tagLabel}</td>`;

    tableHtml += '</tr>';
  });

  tableHtml += '</tbody></table>';
  outputEl.innerHTML = tableHtml;

  // Bind sort clicks on header
  outputEl.querySelectorAll('th[data-sortable="true"]').forEach(th => {
    th.addEventListener('click', () => {
      const key = th.dataset.sortKey;
      if (state.previewSortKey === key) {
        state.previewSortDir = state.previewSortDir === 'asc' ? 'desc' : 'asc';
      } else {
        state.previewSortKey = key;
        state.previewSortDir = 'desc';
      }
      if (onSortChange) onSortChange();
    });
  });

  // Bind row clicks to open modal
  outputEl.querySelectorAll('tr[data-has-data="true"]').forEach(tr => {
    tr.addEventListener('click', () => {
      const name = tr.dataset.playerName;
      const p = playerMap.get(name.toLowerCase());
      if (p && onPlayerClick) onPlayerClick(p);
    });
  });
}

function escHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ---------- TOURNAMENT INTELLIGENCE TABLE ----------

export function renderTournamentIntelTable(tournamentStats) {
  const tbody = document.getElementById('tourney-intel-tbody');
  if (!tbody) return;
  tbody.innerHTML = '';

  const sorted = [...tournamentStats].sort((a, b) => b.avgPvi - a.avgPvi);

  sorted.forEach((s, i) => {
    const tr = document.createElement('tr');
    tr.className = 'border-b border-white/5';
    const bgColor = i % 2 === 1 ? 'rgba(255,255,255,0.015)' : 'transparent';
    tr.style.backgroundColor = bgColor;

    let badge = '';
    if (i === 0) badge = ' <span class="text-xs ml-1">🏆 Toughest Field</span>';
    if (i === sorted.length - 1 && sorted.length > 1) badge = ' <span class="text-xs ml-1 text-secondary">Softest Field</span>';

    tr.innerHTML = `
      <td class="px-3 py-2 font-mono text-sm text-secondary">${s.rank}</td>
      <td class="px-3 py-2 text-sm text-white font-semibold">${escHtml(s.eventName)}${badge}</td>
      <td class="px-3 py-2 font-mono text-sm" style="color:#39FF88">${s.avgPvi.toFixed(3)}</td>
      <td class="px-3 py-2 font-mono text-sm text-secondary">${s.medianPvi.toFixed(3)}</td>
      <td class="px-3 py-2 font-mono text-sm text-secondary">${s.playerCount}</td>
      <td class="px-3 py-2 font-mono text-sm text-secondary">${s.stdDev.toFixed(3)}</td>
    `;
    tbody.appendChild(tr);
  });
}
