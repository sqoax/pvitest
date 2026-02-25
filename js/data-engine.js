// js/data-engine.js — PVI data processing engine

// Accept either a SheetJS sheet object or a plain 2D array (array of arrays) from PapaParse
export function processSheet(input) {
  let rows;

  if (Array.isArray(input)) {
    rows = input;
  } else {
    rows = XLSX.utils.sheet_to_json(input, { header: 1, defval: '' });
  }

  if (!rows || rows.length === 0) return { players: [], eventOrder: [], tournamentStats: [] };

  const headerRow = rows[0];
  const totalCols = headerRow.length;

  // Extract event names from row 0, every 3 columns
  const eventOrder = [];
  for (let c = 0; c < totalCols; c += 3) {
    const val = headerRow[c];
    if (val != null && String(val).trim()) {
      eventOrder.push(String(val).trim());
    }
  }

  // Per-event raw values for z-score and tournament strength calculation
  const eventRawValues = eventOrder.map(() => []);

  // Build player map
  const playerMap = new Map();

  for (let ei = 0; ei < eventOrder.length; ei++) {
    const nameCol = ei * 3;
    const pviCol = nameCol + 1;

    for (let r = 1; r < rows.length; r++) {
      const row = rows[r];
      const nameVal = row[nameCol];
      const pviVal = row[pviCol];

      if (nameVal == null || String(nameVal).trim() === '') continue;
      const name = String(nameVal).trim();
      const pvi = parseFloat(pviVal);
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

  // Per-event mean & std for z-scores
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

    const sorted = [...pviValues].sort((a, b) => a - b);
    const medianPvi = events % 2 === 1
      ? sorted[Math.floor(events / 2)]
      : (sorted[events / 2 - 1] + sorted[events / 2]) / 2;

    const volatility = events > 1
      ? Math.sqrt(pviValues.reduce((s, v) => s + (v - avgPvi) ** 2, 0) / (events - 1))
      : 0;

    let consistencyIndex;
    if (volatility === 0) {
      consistencyIndex = events > 1 ? Infinity : 0;
    } else {
      consistencyIndex = avgPvi / volatility;
    }

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

    const countGte1 = pviValues.filter(v => v >= 1.0).length;
    const hitRate = (countGte1 / events) * 100;

    const floor = Math.min(...pviValues);
    const ceiling = Math.max(...pviValues);

    for (const detail of raw.eventsDetail) {
      const es = eventStats[detail.eventIndex];
      detail.zScore = es.std > 0 ? (detail.pvi - es.mean) / es.std : 0;
      delete detail.eventIndex;
    }

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
      percentileRank: 0,
      regressionFlag: false,
      regressionDetail: '',
      smallSampleFlag: false
    });
  }

  // Compute composite scores with normalization
  if (players.length > 0) {
    const avgPvis = players.map(p => p.avgPvi);
    const cis = players.map(p => Math.min(isFinite(p.consistencyIndex) ? p.consistencyIndex : 5, 5));
    const momentums = players.map(p => p.trendMomentum);

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

    // --- Regression flags (calculated AFTER composite scores) ---
    const avgPviSorted = [...avgPvis].sort((a, b) => a - b);
    const avgPviP75 = avgPviSorted[Math.floor(avgPviSorted.length * 0.75)] || 0;

    for (const p of players) {
      const pviValues = p.eventsDetail.map(d => d.pvi);
      const maxPvi = Math.max(...pviValues);

      if (p.totalPvi > 0) {
        const maxPct = (maxPvi / p.totalPvi) * 100;
        if (maxPct >= 40 && p.events >= 3) {
          p.regressionFlag = true;
          p.regressionDetail = `1 event = ${maxPct.toFixed(0)}% of total PVI`;
        }
      }

      if (p.events <= 3 && p.avgPvi >= avgPviP75) {
        p.smallSampleFlag = true;
      }
    }
  }

  // --- Tournament Strength Ratings ---
  const tournamentStats = eventOrder.map((eventName, ei) => {
    const vals = eventRawValues[ei];
    if (vals.length === 0) {
      return { eventName, avgPvi: 0, medianPvi: 0, playerCount: 0, stdDev: 0, rank: 0 };
    }
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
    const sorted = [...vals].sort((a, b) => a - b);
    const median = vals.length % 2 === 1
      ? sorted[Math.floor(vals.length / 2)]
      : (sorted[vals.length / 2 - 1] + sorted[vals.length / 2]) / 2;
    const variance = vals.length > 1
      ? vals.reduce((s, v) => s + (v - mean) ** 2, 0) / (vals.length - 1)
      : 0;
    return {
      eventName,
      avgPvi: mean,
      medianPvi: median,
      playerCount: vals.length,
      stdDev: Math.sqrt(variance),
      rank: 0
    };
  });

  // Rank by avgPvi descending (rank 1 = strongest/highest)
  const rankedStats = [...tournamentStats].sort((a, b) => b.avgPvi - a.avgPvi);
  rankedStats.forEach((s, i) => { s.rank = i + 1; });

  return { players, eventOrder, tournamentStats };
}
