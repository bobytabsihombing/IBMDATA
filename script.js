/**
 * Sales Dashboard 2019–2020
 * ─────────────────────────
 * Pure Vanilla JavaScript + Chart.js
 * All data comes from sales_data.json — no hardcoded dummies.
 *
 * Architecture:
 *   1. Load JSON → store in `rawData`
 *   2. Populate filter dropdowns from unique values
 *   3. `applyFilters()` → derives `filteredData`
 *   4. `renderAll()` → updates KPIs + all 10 charts
 *   5. Each chart function destroys its old instance and rebuilds.
 */

// ─── Global state ────────────────────────────────────────────────────────────
let rawData = [];        // original 1 000 records
let filteredData = [];   // current view after filters
const chartInstances = {}; // keyed by canvas id → Chart instance

// Colour palette (consistent across all charts)
const PALETTE = [
  '#3b82d4','#7c5cd8','#10b981','#f59e0b','#ef4444',
  '#06b6d4','#ec4899','#84cc16','#f97316','#6366f1',
  '#14b8a6','#a855f7','#eab308','#64748b','#0ea5e9'
];

// ─── 1. Bootstrap ─────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('last-updated').textContent =
    'Last updated: ' + new Date().toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });

  fetch('sales_data.json')
    .then(r => r.json())
    .then(data => {
      rawData = enrichData(data);
      populateFilters();
      applyFilters();          // sets filteredData + renders everything
      attachFilterListeners();
    })
    .catch(err => {
      document.querySelector('main').innerHTML =
        `<div class="text-red-600 p-8 text-center font-semibold">
          ⚠️ Could not load sales_data.json.<br>
          <span class="text-slate-500 text-sm font-normal">Make sure the file is served alongside index.html.</span>
        </div>`;
      console.error(err);
    });
});

// ─── 2. Enrich raw records ────────────────────────────────────────────────────
/**
 * Adds derived fields to every record:
 *   - `year`         (number)
 *   - `month`        (number, 1-based)
 *   - `yearMonth`    (string "YYYY-MM" for grouping)
 *   - `margin`       (order_value - cost)
 *   - `marginPct`    (margin / order_value * 100)
 *   - `customerType` ("B2B" if customer name has Inc/LLC/Group/Sons/and etc., else "B2C")
 */
function enrichData(data) {
  return data.map(d => {
    // Parse date
    const parts = d.date.split('/');
    const month = parseInt(parts[0], 10);
    const year  = parseInt(parts[2], 10);
    const ym    = `${year}-${String(month).padStart(2,'0')}`;

    // Derive customer type
    const b2bKeywords = /\b(Inc|LLC|Group|Sons|and|&|Ltd|Corp|Co\.|Partners|Associates)\b/i;
    const customerType = b2bKeywords.test(d.customer_name) ? 'B2B' : 'B2C';

    // Margin
    const margin    = d.order_value - d.cost;
    const marginPct = d.order_value > 0 ? (margin / d.order_value) * 100 : 0;

    return { ...d, year, month, yearMonth: ym, customerType, margin, marginPct };
  });
}

// ─── 3. Populate filter dropdowns ────────────────────────────────────────────
function populateFilters() {
  const regions   = [...new Set(rawData.map(d => d.country))].sort();
  const categories = [...new Set(rawData.map(d => d.category))].sort();
  const channels  = [...new Set(rawData.map(d => d.device_type))].sort();

  fillSelect('filter-region',   regions);
  fillSelect('filter-category', categories);
  fillSelect('filter-channel',  channels);
}

function fillSelect(id, values) {
  const sel = document.getElementById(id);
  values.forEach(v => {
    const opt = document.createElement('option');
    opt.value = v;
    opt.textContent = v;
    sel.appendChild(opt);
  });
}

// ─── 4. Filter logic ──────────────────────────────────────────────────────────
function applyFilters() {
  const region   = document.getElementById('filter-region').value;
  const category = document.getElementById('filter-category').value;
  const custType = document.getElementById('filter-customer-type').value;
  const channel  = document.getElementById('filter-channel').value;

  filteredData = rawData.filter(d => {
    if (region   !== 'all' && d.country      !== region)       return false;
    if (category !== 'all' && d.category     !== category)     return false;
    if (custType !== 'all' && d.customerType !== custType)     return false;
    if (channel  !== 'all' && d.device_type  !== channel)      return false;
    return true;
  });

  renderAll();
}

// ─── 5. Attach events ─────────────────────────────────────────────────────────
function attachFilterListeners() {
  ['filter-region','filter-category','filter-customer-type','filter-channel']
    .forEach(id => document.getElementById(id).addEventListener('change', applyFilters));

  document.getElementById('btn-reset').addEventListener('click', () => {
    ['filter-region','filter-category','filter-customer-type','filter-channel']
      .forEach(id => { document.getElementById(id).value = 'all'; });
    applyFilters();
  });
}

// ─── 6. Render all ────────────────────────────────────────────────────────────
function renderAll() {
  updateKPIs();
  renderSalesTrend();
  renderRevenueByRegion();
  renderRevenueByCategory();
  renderSalesPerRep();
  renderCustomerType();
  renderSalesChannel();
  renderSalesManager();
  renderScatter();
  renderTop10();
  renderQtyByCategory();
}

// ─── Utility helpers ──────────────────────────────────────────────────────────
/** Sum an array of numbers */
const sum = arr => arr.reduce((a, b) => a + b, 0);

/** Group records by a key, returning { key: [records] } */
function groupBy(arr, keyFn) {
  return arr.reduce((acc, item) => {
    const k = keyFn(item);
    if (!acc[k]) acc[k] = [];
    acc[k].push(item);
    return acc;
  }, {});
}

/** Format number as €X,XXX */
function fmtEUR(n) {
  if (n >= 1_000_000) return '€' + (n / 1_000_000).toFixed(2) + 'M';
  if (n >= 1_000)     return '€' + (n / 1_000).toFixed(1) + 'K';
  return '€' + n.toFixed(0);
}

/** Destroy previous chart if it exists and create a new one */
function makeChart(id, config) {
  if (chartInstances[id]) {
    chartInstances[id].destroy();
  }
  const ctx = document.getElementById(id).getContext('2d');
  chartInstances[id] = new Chart(ctx, config);
  return chartInstances[id];
}

/** Common Chart.js defaults */
const BASE_FONT = { family: "-apple-system, 'Segoe UI', system-ui, sans-serif", size: 12 };

// ─── 7. KPI Cards ─────────────────────────────────────────────────────────────
function updateKPIs() {
  const totalRevenue = sum(filteredData.map(d => d.order_value));
  const transactions = filteredData.length;
  const avgOrder     = transactions > 0 ? totalRevenue / transactions : 0;
  const avgMarginPct = transactions > 0
    ? sum(filteredData.map(d => d.marginPct)) / transactions
    : 0;

  document.getElementById('kpi-revenue').textContent      = fmtEUR(totalRevenue);
  document.getElementById('kpi-transactions').textContent  = transactions.toLocaleString('en');
  document.getElementById('kpi-avg-order').textContent    = fmtEUR(avgOrder);
  document.getElementById('kpi-avg-margin').textContent   = avgMarginPct.toFixed(1) + '%';
}

// ─── 8. Sales Trend (Monthly) ─────────────────────────────────────────────────
function renderSalesTrend() {
  // Group by yearMonth, sort chronologically
  const grouped = groupBy(filteredData, d => d.yearMonth);
  const labels  = Object.keys(grouped).sort();
  const revenue = labels.map(ym => sum(grouped[ym].map(d => d.order_value)));
  const cost    = labels.map(ym => sum(grouped[ym].map(d => d.cost)));
  const margin  = labels.map(ym => sum(grouped[ym].map(d => d.margin)));

  // Pretty label: "Jan 2019"
  const prettyLabels = labels.map(ym => {
    const [y, m] = ym.split('-');
    return new Date(+y, +m - 1).toLocaleString('en', { month: 'short', year: '2-digit' });
  });

  makeChart('chart-trend', {
    type: 'line',
    data: {
      labels: prettyLabels,
      datasets: [
        {
          label: 'Revenue (€)',
          data: revenue,
          borderColor: '#3b82d4',
          backgroundColor: 'rgba(59,130,212,0.08)',
          borderWidth: 2,
          pointRadius: 2,
          fill: true,
          tension: 0.3
        },
        {
          label: 'Cost (€)',
          data: cost,
          borderColor: '#ef4444',
          backgroundColor: 'transparent',
          borderWidth: 1.5,
          borderDash: [4,3],
          pointRadius: 1,
          tension: 0.3
        },
        {
          label: 'Margin (€)',
          data: margin,
          borderColor: '#10b981',
          backgroundColor: 'rgba(16,185,129,0.06)',
          borderWidth: 2,
          pointRadius: 2,
          fill: true,
          tension: 0.3
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { labels: { font: BASE_FONT, boxWidth: 12 } },
        tooltip: {
          callbacks: {
            label: ctx => ` ${ctx.dataset.label}: ${fmtEUR(ctx.parsed.y)}`
          }
        }
      },
      scales: {
        x: { ticks: { font: BASE_FONT, maxRotation: 45 }, grid: { display: false } },
        y: { ticks: { font: BASE_FONT, callback: v => fmtEUR(v) }, grid: { color: '#f1f5f9' } }
      }
    }
  });
}

// ─── 9. Revenue by Region ─────────────────────────────────────────────────────
function renderRevenueByRegion() {
  const grouped = groupBy(filteredData, d => d.country);
  const sorted  = Object.entries(grouped)
    .map(([k, v]) => ({ label: k, value: sum(v.map(d => d.order_value)) }))
    .sort((a, b) => b.value - a.value);

  // Semi-transparent fills derived from the shared PALETTE so colours
  // stay consistent with every other chart in the dashboard.
  const bgColors  = sorted.map((_, i) => PALETTE[i % PALETTE.length] + 'cc'); // 80% opacity
  const brdColors = sorted.map((_, i) => PALETTE[i % PALETTE.length]);

  makeChart('chart-region', {
    type: 'polarArea',
    data: {
      labels: sorted.map(x => x.label),
      datasets: [{
        data: sorted.map(x => x.value),
        backgroundColor: bgColors,
        borderColor: brdColors,
        borderWidth: 1.5
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'right',
          labels: { font: BASE_FONT, boxWidth: 12, padding: 8 }
        },
        tooltip: {
          callbacks: {
            label: ctx => ` ${ctx.label}: ${fmtEUR(ctx.parsed.r)}`
          }
        }
      },
      scales: {
        r: {
          ticks: {
            font: BASE_FONT,
            backdropColor: 'transparent',
            callback: v => fmtEUR(v)
          },
          grid: { color: '#e2e8f0' }
        }
      }
    }
  });
}

// ─── 10. Revenue by Category ──────────────────────────────────────────────────
function renderRevenueByCategory() {
  const grouped = groupBy(filteredData, d => d.category);
  const sorted  = Object.entries(grouped)
    .map(([k, v]) => ({ label: k, value: sum(v.map(d => d.order_value)) }))
    .sort((a, b) => b.value - a.value);

  makeChart('chart-category', {
    type: 'bar',
    data: {
      labels: sorted.map(x => x.label),
      datasets: [{
        label: 'Revenue (€)',
        data: sorted.map(x => x.value),
        backgroundColor: sorted.map((_, i) => PALETTE[i % PALETTE.length]),
        borderRadius: 6,
        borderSkipped: false
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: ctx => ` Revenue: ${fmtEUR(ctx.parsed.y)}` } }
      },
      scales: {
        x: { ticks: { font: BASE_FONT }, grid: { display: false } },
        y: { ticks: { font: BASE_FONT, callback: v => fmtEUR(v) }, grid: { color: '#f1f5f9' } }
      }
    }
  });
}

// ─── 11. Sales per Representative (Top 15) ────────────────────────────────────
function renderSalesPerRep() {
  const grouped = groupBy(filteredData, d => d.sales_rep);
  const sorted  = Object.entries(grouped)
    .map(([k, v]) => ({ label: k, value: sum(v.map(d => d.order_value)) }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 15);

  makeChart('chart-sales-rep', {
    type: 'bar',
    data: {
      labels: sorted.map(x => x.label),
      datasets: [{
        label: 'Revenue (€)',
        data: sorted.map(x => x.value),
        backgroundColor: '#3b82d4',
        borderRadius: 6,
        borderSkipped: false
      }]
    },
    options: {
      indexAxis: 'y',          // horizontal bar
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: ctx => ` Revenue: ${fmtEUR(ctx.parsed.x)}` } }
      },
      scales: {
        x: { ticks: { font: BASE_FONT, callback: v => fmtEUR(v) }, grid: { color: '#f1f5f9' } },
        y: { ticks: { font: { ...BASE_FONT, size: 11 } }, grid: { display: false } }
      }
    }
  });
}

// ─── 12. Customer Type Distribution ──────────────────────────────────────────
function renderCustomerType() {
  const grouped = groupBy(filteredData, d => d.customerType);
  const labels  = Object.keys(grouped);
  const values  = labels.map(k => sum(grouped[k].map(d => d.order_value)));

  makeChart('chart-customer-type', {
    type: 'pie',
    data: {
      labels,
      datasets: [{
        data: values,
        backgroundColor: ['#3b82d4', '#10b981'],
        borderWidth: 2,
        borderColor: '#fff'
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: 'bottom', labels: { font: BASE_FONT, boxWidth: 12 } },
        tooltip: { callbacks: { label: ctx => ` ${ctx.label}: ${fmtEUR(ctx.parsed)}` } }
      }
    }
  });
}

// ─── 13. Sales Channel Distribution (device_type) ────────────────────────────
function renderSalesChannel() {
  const grouped = groupBy(filteredData, d => d.device_type);
  const sorted  = Object.entries(grouped)
    .map(([k, v]) => ({ label: k, value: v.length }))
    .sort((a, b) => b.value - a.value);

  makeChart('chart-channel', {
    type: 'doughnut',
    data: {
      labels: sorted.map(x => x.label),
      datasets: [{
        data: sorted.map(x => x.value),
        backgroundColor: ['#3b82d4','#7c5cd8','#f59e0b'],
        borderWidth: 2,
        borderColor: '#fff'
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: 'bottom', labels: { font: BASE_FONT, boxWidth: 12 } },
        tooltip: { callbacks: { label: ctx => ` ${ctx.label}: ${ctx.parsed} orders` } }
      },
      cutout: '50%'
    }
  });
}

// ─── 14. Revenue by Sales Manager ────────────────────────────────────────────
function renderSalesManager() {
  const grouped = groupBy(filteredData, d => d.sales_manager);
  const sorted  = Object.entries(grouped)
    .map(([k, v]) => ({ label: k, value: sum(v.map(d => d.order_value)) }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 10);

  makeChart('chart-manager', {
    type: 'pie',
    data: {
      labels: sorted.map(x => x.label),
      datasets: [{
        data: sorted.map(x => x.value),
        backgroundColor: PALETTE,
        borderWidth: 2,
        borderColor: '#fff'
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: 'bottom', labels: { font: BASE_FONT, boxWidth: 12, padding: 6 } },
        tooltip: { callbacks: { label: ctx => ` ${ctx.label}: ${fmtEUR(ctx.parsed)}` } }
      }
    }
  });
}

// ─── 15. Scatter: Order Value vs Margin % ────────────────────────────────────
function renderScatter() {
  // Sample up to 400 points for performance
  const sample = filteredData.length > 400
    ? filteredData.filter((_, i) => i % Math.ceil(filteredData.length / 400) === 0)
    : filteredData;

  // Colour by device_type
  const deviceColors = { PC: '#3b82d4', Mobile: '#10b981', Tablet: '#f59e0b' };

  const datasets = ['PC', 'Mobile', 'Tablet'].map(device => ({
    label: device,
    data: sample
      .filter(d => d.device_type === device)
      .map(d => ({ x: d.order_value, y: parseFloat(d.marginPct.toFixed(2)) })),
    backgroundColor: (deviceColors[device] || '#64748b') + 'aa',
    pointRadius: 4
  }));

  makeChart('chart-scatter', {
    type: 'scatter',
    data: { datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { labels: { font: BASE_FONT, boxWidth: 12 } },
        tooltip: {
          callbacks: {
            label: ctx =>
              ` ${ctx.dataset.label}: €${(ctx.parsed.x/1000).toFixed(1)}K, Margin ${ctx.parsed.y}%`
          }
        }
      },
      scales: {
        x: {
          title: { display: true, text: 'Order Value (€)', font: BASE_FONT },
          ticks: { font: BASE_FONT, callback: v => fmtEUR(v) },
          grid: { color: '#f1f5f9' }
        },
        y: {
          title: { display: true, text: 'Margin %', font: BASE_FONT },
          ticks: { font: BASE_FONT, callback: v => v + '%' },
          grid: { color: '#f1f5f9' }
        }
      }
    }
  });
}

// ─── 16. Top 10 Highest Orders ────────────────────────────────────────────────
function renderTop10() {
  const top10 = [...filteredData]
    .sort((a, b) => b.order_value - a.order_value)
    .slice(0, 10);

  const labels = top10.map(d => d.order_id);
  const revenue = top10.map(d => d.order_value);
  const cost    = top10.map(d => d.cost);

  makeChart('chart-top10', {
    type: 'bar',
    data: {
      labels,
      datasets: [
        {
          label: 'Revenue (€)',
          data: revenue,
          backgroundColor: '#3b82d4',
          borderRadius: 6,
          borderSkipped: false
        },
        {
          label: 'Cost (€)',
          data: cost,
          backgroundColor: '#ef4444aa',
          borderRadius: 6,
          borderSkipped: false
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { labels: { font: BASE_FONT, boxWidth: 12 } },
        tooltip: {
          callbacks: {
            afterLabel: ctx => {
              const d = top10[ctx.dataIndex];
              return [`Customer: ${d.customer_name}`, `Category: ${d.category}`, `Country: ${d.country}`];
            }
          }
        }
      },
      scales: {
        x: { ticks: { font: BASE_FONT, maxRotation: 30 }, grid: { display: false } },
        y: { ticks: { font: BASE_FONT, callback: v => fmtEUR(v) }, grid: { color: '#f1f5f9' } }
      }
    }
  });
}

// ─── 17. Order Count per Category ─────────────────────────────────────────────
function renderQtyByCategory() {
  const grouped = groupBy(filteredData, d => d.category);
  const sorted  = Object.entries(grouped)
    .map(([k, v]) => ({ label: k, count: v.length, revenue: sum(v.map(d => d.order_value)) }))
    .sort((a, b) => b.count - a.count);

  makeChart('chart-qty-category', {
    type: 'bar',
    data: {
      labels: sorted.map(x => x.label),
      datasets: [
        {
          label: 'Order Count',
          data: sorted.map(x => x.count),
          backgroundColor: sorted.map((_, i) => PALETTE[i % PALETTE.length] + 'dd'),
          borderRadius: 6,
          borderSkipped: false,
          yAxisID: 'yCount'
        },
        {
          label: 'Revenue (€)',
          data: sorted.map(x => x.revenue),
          type: 'line',
          borderColor: '#7c5cd8',
          backgroundColor: 'transparent',
          borderWidth: 2,
          pointRadius: 4,
          tension: 0.3,
          yAxisID: 'yRev'
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { labels: { font: BASE_FONT, boxWidth: 12 } },
        tooltip: {
          callbacks: {
            label: ctx => ctx.dataset.label === 'Order Count'
              ? ` Orders: ${ctx.parsed.y}`
              : ` Revenue: ${fmtEUR(ctx.parsed.y)}`
          }
        }
      },
      scales: {
        x:      { ticks: { font: BASE_FONT }, grid: { display: false } },
        yCount: { position: 'left',  ticks: { font: BASE_FONT }, grid: { color: '#f1f5f9' }, title: { display: true, text: 'Orders', font: BASE_FONT } },
        yRev:   { position: 'right', ticks: { font: BASE_FONT, callback: v => fmtEUR(v) }, grid: { drawOnChartArea: false }, title: { display: true, text: 'Revenue (€)', font: BASE_FONT } }
      }
    }
  });
}
