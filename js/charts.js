// js/charts.js — Chart.js chart creation and management

const chartInstances = new Map();

function destroyChart(id) {
  if (chartInstances.has(id)) {
    chartInstances.get(id).destroy();
    chartInstances.delete(id);
  }
}

function getTierColor(compositeScore, allPlayers) {
  const scores = allPlayers.map(p => p.compositeScore).sort((a, b) => a - b);
  const p25 = scores[Math.floor(scores.length * 0.25)];
  const p75 = scores[Math.floor(scores.length * 0.75)];
  if (compositeScore >= p75) return '#39FF88';
  if (compositeScore >= p25) return '#39DFFF';
  return '#ef4444';
}

export function renderScatterPlot(players, allPlayers, onClickPlayer, fieldMode, fieldNames) {
  destroyChart('scatter-main');
  const canvas = document.getElementById('scatter-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');

  const fieldSet = new Set((fieldNames || []).map(n => n.toLowerCase()));

  const data = players.map(p => {
    const ci = isFinite(p.consistencyIndex) ? Math.min(p.consistencyIndex, 6) : 6;
    const inField = fieldSet.has(p.name.toLowerCase());
    const color = getTierColor(p.compositeScore, allPlayers);
    const alpha = (fieldMode && !inField) ? 0.2 : 0.85;
    return {
      x: p.avgPvi,
      y: ci,
      r: Math.max(4, Math.min(14, p.events * 1.5)),
      player: p,
      backgroundColor: color.replace(')', `, ${alpha})`).replace('rgb', 'rgba').replace('#', ''),
      borderColor: color
    };
  });

  // Convert hex to rgba helper
  const hexToRgba = (hex, a) => {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r},${g},${b},${a})`;
  };

  const chart = new Chart(ctx, {
    type: 'bubble',
    data: {
      datasets: [{
        data: data.map(d => ({ x: d.x, y: d.y, r: d.r, player: d.player })),
        backgroundColor: data.map(d => {
          const color = getTierColor(d.player.compositeScore, allPlayers);
          const inField = fieldSet.has(d.player.name.toLowerCase());
          const alpha = (fieldMode && !inField) ? 0.2 : 0.85;
          return hexToRgba(color, alpha);
        }),
        borderColor: data.map(d => getTierColor(d.player.compositeScore, allPlayers)),
        borderWidth: 1
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label(ctx) {
              const p = ctx.raw.player;
              return [
                p.name,
                `Avg PVI: ${p.avgPvi.toFixed(2)}`,
                `CI: ${isFinite(p.consistencyIndex) ? p.consistencyIndex.toFixed(2) : '∞'}`,
                `Composite: ${p.compositeScore.toFixed(3)}`
              ];
            }
          },
          backgroundColor: '#0E0E12',
          titleColor: '#ffffff',
          bodyColor: '#94a3b8',
          borderColor: 'rgba(255,255,255,0.08)',
          borderWidth: 1,
          titleFont: { family: 'Inter' },
          bodyFont: { family: 'JetBrains Mono', size: 11 }
        },
        annotation: {
          annotations: {
            xLine: {
              type: 'line',
              xMin: 1.0, xMax: 1.0,
              borderColor: 'rgba(255,255,255,0.15)',
              borderDash: [6, 4],
              borderWidth: 1
            },
            yLine: {
              type: 'line',
              yMin: 1.0, yMax: 1.0,
              borderColor: 'rgba(255,255,255,0.15)',
              borderDash: [6, 4],
              borderWidth: 1
            },
            eliteLabel: {
              type: 'label',
              xValue: 'max', yValue: 'max',
              content: 'Elite',
              color: 'rgba(57,255,136,0.4)',
              font: { size: 13, family: 'Inter', weight: '600' },
              position: { x: 'end', y: 'start' },
              xAdjust: -30, yAdjust: 20
            },
            boomLabel: {
              type: 'label',
              xValue: 'min', yValue: 'max',
              content: 'Boom/Bust',
              color: 'rgba(159,57,255,0.4)',
              font: { size: 13, family: 'Inter', weight: '600' },
              position: { x: 'start', y: 'start' },
              xAdjust: 30, yAdjust: 20
            },
            floorLabel: {
              type: 'label',
              xValue: 'max', yValue: 'min',
              content: 'Reliable Floor',
              color: 'rgba(57,223,255,0.4)',
              font: { size: 13, family: 'Inter', weight: '600' },
              position: { x: 'end', y: 'end' },
              xAdjust: -30, yAdjust: -20
            },
            avoidLabel: {
              type: 'label',
              xValue: 'min', yValue: 'min',
              content: 'Avoid',
              color: 'rgba(239,68,68,0.4)',
              font: { size: 13, family: 'Inter', weight: '600' },
              position: { x: 'start', y: 'end' },
              xAdjust: 30, yAdjust: -20
            }
          }
        }
      },
      scales: {
        x: {
          title: { display: true, text: 'Avg PVI', color: '#94a3b8', font: { family: 'Inter' } },
          grid: { color: 'rgba(255,255,255,0.04)' },
          ticks: { color: '#94a3b8', font: { family: 'JetBrains Mono', size: 10 } }
        },
        y: {
          title: { display: true, text: 'Consistency Index', color: '#94a3b8', font: { family: 'Inter' } },
          grid: { color: 'rgba(255,255,255,0.04)' },
          ticks: { color: '#94a3b8', font: { family: 'JetBrains Mono', size: 10 } },
          max: 6.5
        }
      },
      onClick(e, elements) {
        if (elements.length > 0) {
          const idx = elements[0].index;
          const player = chart.data.datasets[0].data[idx].player;
          if (onClickPlayer) onClickPlayer(player);
        }
      }
    }
  });

  chartInstances.set('scatter-main', chart);
}

export function renderPlayerLineChart(canvasId, player, eventOrder) {
  destroyChart(canvasId);
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  const ctx = canvas.getContext('2d');

  const labels = [];
  const values = [];
  for (const detail of player.eventsDetail) {
    labels.push(detail.eventName);
    values.push(detail.pvi);
  }

  const chart = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: 'PVI',
        data: values,
        borderColor: '#39FF88',
        backgroundColor: 'rgba(57,255,136,0.1)',
        borderWidth: 2,
        pointBackgroundColor: values.map(v => v >= 1.0 ? '#39FF88' : '#ef4444'),
        pointBorderColor: values.map(v => v >= 1.0 ? '#39FF88' : '#ef4444'),
        pointRadius: 5,
        pointHoverRadius: 7,
        fill: true,
        tension: 0.3
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        annotation: {
          annotations: {
            refLine: {
              type: 'line',
              yMin: 1.0, yMax: 1.0,
              borderColor: 'rgba(255,255,255,0.3)',
              borderDash: [6, 4],
              borderWidth: 1,
              label: {
                display: true,
                content: '1.0',
                position: 'end',
                color: '#94a3b8',
                backgroundColor: 'transparent',
                font: { size: 10, family: 'JetBrains Mono' }
              }
            }
          }
        },
        tooltip: {
          backgroundColor: '#0E0E12',
          titleColor: '#ffffff',
          bodyColor: '#94a3b8',
          borderColor: 'rgba(255,255,255,0.08)',
          borderWidth: 1,
          bodyFont: { family: 'JetBrains Mono', size: 11 }
        }
      },
      scales: {
        x: {
          grid: { color: 'rgba(255,255,255,0.04)' },
          ticks: { color: '#94a3b8', font: { family: 'Inter', size: 9 }, maxRotation: 45 }
        },
        y: {
          grid: { color: 'rgba(255,255,255,0.04)' },
          ticks: { color: '#94a3b8', font: { family: 'JetBrains Mono', size: 10 } }
        }
      }
    }
  });

  chartInstances.set(canvasId, chart);
}

export function renderPlayerHistogram(canvasId, player) {
  destroyChart(canvasId);
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  const ctx = canvas.getContext('2d');

  const pvis = player.eventsDetail.map(d => d.pvi);
  const buckets = [
    { label: '0-0.5', min: 0, max: 0.5, count: 0 },
    { label: '0.5-1.0', min: 0.5, max: 1.0, count: 0 },
    { label: '1.0-1.5', min: 1.0, max: 1.5, count: 0 },
    { label: '1.5-2.0', min: 1.5, max: 2.0, count: 0 },
    { label: '2.0-2.5', min: 2.0, max: 2.5, count: 0 },
    { label: '2.5-3.0', min: 2.5, max: 3.0, count: 0 },
    { label: '3.0+', min: 3.0, max: Infinity, count: 0 }
  ];

  for (const pvi of pvis) {
    for (const b of buckets) {
      if (pvi >= b.min && (pvi < b.max || b.max === Infinity)) {
        b.count++;
        break;
      }
    }
  }

  const chart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: buckets.map(b => b.label),
      datasets: [{
        label: 'Frequency',
        data: buckets.map(b => b.count),
        backgroundColor: buckets.map(b =>
          b.min >= 1.0 ? 'rgba(57,255,136,0.6)' : 'rgba(148,163,184,0.4)'
        ),
        borderColor: buckets.map(b =>
          b.min >= 1.0 ? '#39FF88' : '#94a3b8'
        ),
        borderWidth: 1,
        borderRadius: 3
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#0E0E12',
          titleColor: '#ffffff',
          bodyColor: '#94a3b8',
          borderColor: 'rgba(255,255,255,0.08)',
          borderWidth: 1,
          bodyFont: { family: 'JetBrains Mono', size: 11 }
        }
      },
      scales: {
        x: {
          grid: { color: 'rgba(255,255,255,0.04)' },
          ticks: { color: '#94a3b8', font: { family: 'JetBrains Mono', size: 10 } }
        },
        y: {
          grid: { color: 'rgba(255,255,255,0.04)' },
          ticks: { color: '#94a3b8', font: { family: 'JetBrains Mono', size: 10 }, stepSize: 1 }
        }
      }
    }
  });

  chartInstances.set(canvasId, chart);
}

export function renderComparisonChart(canvasId, players, eventOrder) {
  destroyChart(canvasId);
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  const ctx = canvas.getContext('2d');

  const colors = ['#39FF88', '#39DFFF', '#9F39FF', '#FFB839'];

  const datasets = players.map((p, i) => {
    const labels = [];
    const values = [];
    for (const detail of p.eventsDetail) {
      labels.push(detail.eventName);
      values.push(detail.pvi);
    }
    return {
      label: p.name,
      data: values,
      borderColor: colors[i % colors.length],
      backgroundColor: 'transparent',
      borderWidth: 2,
      pointRadius: 3,
      pointBackgroundColor: colors[i % colors.length],
      tension: 0.3
    };
  });

  // Use the longest player's event list for labels
  let longestLabels = [];
  for (const p of players) {
    const labels = p.eventsDetail.map(d => d.eventName);
    if (labels.length > longestLabels.length) longestLabels = labels;
  }

  const chart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: longestLabels,
      datasets
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          display: true,
          labels: { color: '#ffffff', font: { family: 'Inter', size: 11 } }
        },
        tooltip: {
          backgroundColor: '#0E0E12',
          titleColor: '#ffffff',
          bodyColor: '#94a3b8',
          borderColor: 'rgba(255,255,255,0.08)',
          borderWidth: 1,
          bodyFont: { family: 'JetBrains Mono', size: 11 }
        }
      },
      scales: {
        x: {
          grid: { color: 'rgba(255,255,255,0.04)' },
          ticks: { color: '#94a3b8', font: { family: 'Inter', size: 9 }, maxRotation: 45 }
        },
        y: {
          grid: { color: 'rgba(255,255,255,0.04)' },
          ticks: { color: '#94a3b8', font: { family: 'JetBrains Mono', size: 10 } }
        }
      }
    }
  });

  chartInstances.set(canvasId, chart);
}

export function destroyAll() {
  for (const [id, chart] of chartInstances) {
    chart.destroy();
  }
  chartInstances.clear();
}
