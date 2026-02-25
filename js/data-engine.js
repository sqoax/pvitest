// js/data-engine.js — PVI data processing engine

export function processSheet(sheet) {
  const range = XLSX.utils.decode_range(sheet['!ref']);
  const totalCols = range.e.c + 1;
  const totalRows = range.e.r + 1;

  // Extract event names from row 0, every 3 columns
  const eventOrder = [];
  for (let c = 0; c <= range.e.c; c += 3) {
    const cell = sheet[XLSX.utils.encode_cell({ r: 0, c })];
    if (cell && cell.v != null && String(cell.v).trim()) {
      eventOrder.push(String(cell.v).trim());
    }
  }

  // Per-event raw values for z-score calculation
  const eventRawValues = eventOrder.map(() => []);

  // Build player map: name -> { series: [pvi|null per event], eventsDetail: [] }
  const playerMap = new Map();

  for (let ei = 0; ei < eventOrder.length; ei++) {
    const nameCol = ei * 3;
    const pviCol = nameCol + 1;

    for (let r = 1; r <= range.e.r; r++) {
      const nameCell = sheet[XLSX.utils.encode_cell({ r, c: nameCol })];
      const pviCell = sheet[XLSX.utils.encode_cell({ r, c: pviCol })];

      if (!nameCell || nameCell.v == null || String(nameCell.v).trim() === '') continue;
      const name = String(nameCell.v).trim();
      const pvi = pviCell && pviCell.v != null ? parseFloat(pviCell.v) : NaN;
      if (isNaN(pvi)) continue;

      if (!playerMap.has(name)) {
        playerMap.set(name, {
          series: new Array(eventOrder.length).fill(null),
          eventsDetail: []
        });
      }

      const p = playerMap.get(name);
      p.series[ei] = pvi;
      p.eventsDetail.push({ eventName: eventOrder[ei], pvi, eventIndex: ei, zScore: 0 });
      eventRawValues[ei].push(pvi);
    }
  }

  // Compute per-event mean & std for z-scores
  const eventStats = eventRawValues.map(vals => {
    if (vals.length === 0) return { mean: 0, std: 1 };
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
    const variance = vals.length > 1
      ? vals.reduce((s, v) => s + (v - mean) ** 2, 0) / (vals.length - 1)
      : 0;
    return { mean, std: Math.sqrt(variance) || 1 };
  });

  // Build full player objects
  const players = [];

  for (const [name, raw] of playerMap) {
    const pviValues = raw.series.filter(v => v !== null);
    const events = pviValues.length;
    if (events === 0) continue;

    const totalPvi = pviValues.reduce((a, b) => a + b, 0);
    const avgPvi = totalPvi / events;

    // Median
    const sorted = [...pviValues].sort((a, b) => a - b);
    const medianPvi = events % 2 === 1
      ? sorted[Math.floor(events / 2)]
      : (sorted[events / 2 - 1] + sorted[events / 2]) / 2;

    // Sample standard deviation
    const volatility = events > 1
      ? Math.sqrt(pviValues.reduce((s, v) => s + (v - avgPvi) ** 2, 0) / (events - 1))
      : 0;

    // Consistency Index
    let consistencyIndex;
    if (volatility === 0) {
      consistencyIndex = events > 1 ? Infinity : 0;
    } else {
      consistencyIndex = avgPvi / volatility;
    }

    // Trend Momentum — uses chronological event order
    const chronoValues = [];
    for (let i = 0; i < raw.series.length; i++) {
      if (raw.series[i] !== null) chronoValues.push(raw.series[i]);
    }
    let trendMomentum = 0;
    if (chronoValues.length >= 2) {
      const half = Math.min(3, Math.floor(chronoValues.length / 2));
      const recent = chronoValues.slice(-half);
      const previous = chronoValues.slice(-(half * 2), -half);
      const avgRecent = recent.reduce((a, b) => a + b, 0) / recent.length;
      const avgPrevious = previous.reduce((a, b) => a + b, 0) / previous.length;
      trendMomentum = avgRecent - avgPrevious;
    }

    // Hit Rate
    const countGte1 = pviValues.filter(v => v >= 1.0).length;
    const hitRate = (countGte1 / events) * 100;

    const floor = Math.min(...pviValues);
    const ceiling = Math.max(...pviValues);

    // Z-scores for event details
    for (const detail of raw.eventsDetail) {
      const es = eventStats[detail.eventIndex];
      detail.zScore = es.std > 0 ? (detail.pvi - es.mean) / es.std : 0;
      delete detail.eventIndex;
    }

    // Sort events by chronological order
    raw.eventsDetail.sort((a, b) => {
      return eventOrder.indexOf(a.eventName) - eventOrder.indexOf(b.eventName);
    });

    players.push({
      name,
      totalPvi,
      avgPvi,
      medianPvi,
      volatility,
      consistencyIndex,
      trendMomentum,
      hitRate,
      floor,
      ceiling,
      countGte1,
      events,
      series: raw.series,
      eventsDetail: raw.eventsDetail,
      compositeScore: 0,
      percentileRank: 0
    });
  }

  // Compute composite scores with normalization
  if (players.length > 0) {
    // Gather raw values for normalization
    const avgPvis = players.map(p => p.avgPvi);
    const cis = players.map(p => Math.min(isFinite(p.consistencyIndex) ? p.consistencyIndex : 5, 5));
    const momentums = players.map(p => p.trendMomentum);
    const hitRates = players.map(p => p.hitRate);

    const normalize = (val, arr) => {
      const min = Math.min(...arr);
      const max = Math.max(...arr);
      if (max === min) return 0.5;
      return (val - min) / (max - min);
    };

    for (const p of players) {
      const cappedCI = Math.min(isFinite(p.consistencyIndex) ? p.consistencyIndex : 5, 5);
      p.compositeScore =
        normalize(p.avgPvi, avgPvis) * 0.35 +
        normalize(cappedCI, cis) * 0.30 +
        normalize(p.trendMomentum, momentums) * 0.20 +
        (p.hitRate / 100) * 0.15;
    }

    // Percentile rank by composite score
    const sortedByComposite = [...players].sort((a, b) => a.compositeScore - b.compositeScore);
    for (let i = 0; i < sortedByComposite.length; i++) {
      sortedByComposite[i].percentileRank = (i / (players.length - 1)) * 100 || 0;
    }
  }

  return { players, eventOrder };
}
