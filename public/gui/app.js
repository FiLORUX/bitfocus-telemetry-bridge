/**
 * Telemetry Bridge GUI Application
 * Vanilla JS - no frameworks, no bullshit
 */

// -----------------------------------------------------------------------------
// State
// -----------------------------------------------------------------------------

const state = {
  ws: null,
  connected: false,
  sequence: 0,
  namespace: null,
  stateEntries: new Map(),
  eventLog: [],
  config: null,
  health: null,
  info: null,
  startTime: null,
};

// -----------------------------------------------------------------------------
// Configuration
// -----------------------------------------------------------------------------

const API_BASE = '';
const WS_PORT = 9000;

// -----------------------------------------------------------------------------
// DOM Elements
// -----------------------------------------------------------------------------

const elements = {
  connectionStatus: document.getElementById('connection-status'),
  tabs: document.querySelectorAll('.tab'),
  tabContents: document.querySelectorAll('.tab-content'),

  // Status
  healthGrid: document.getElementById('health-grid'),
  infoName: document.getElementById('info-name'),
  infoEnvironment: document.getElementById('info-environment'),
  infoWsPort: document.getElementById('info-ws-port'),
  infoStateEntries: document.getElementById('info-state-entries'),
  infoUptime: document.getElementById('info-uptime'),

  // State
  stateFilter: document.getElementById('state-filter'),
  stateRefresh: document.getElementById('state-refresh'),
  stateCount: document.getElementById('state-count'),
  stateTbody: document.getElementById('state-tbody'),

  // Config
  configJson: document.getElementById('config-json'),

  // Log
  logClear: document.getElementById('log-clear'),
  logAutoscroll: document.getElementById('log-autoscroll'),
  logCount: document.getElementById('log-count'),
  logContainer: document.getElementById('log-container'),

  // Export
  exportSnapshot: document.getElementById('export-snapshot'),
  exportConfig: document.getElementById('export-config'),
};

// -----------------------------------------------------------------------------
// WebSocket Connection
// -----------------------------------------------------------------------------

function connectWebSocket() {
  const wsUrl = `ws://${window.location.hostname}:${WS_PORT}`;
  updateConnectionStatus('connecting');

  state.ws = new WebSocket(wsUrl);

  state.ws.onopen = () => {
    console.log('WebSocket connected');
    sendHandshake();
  };

  state.ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      handleMessage(msg);
    } catch (err) {
      console.error('Failed to parse message:', err);
    }
  };

  state.ws.onclose = () => {
    console.log('WebSocket disconnected');
    state.connected = false;
    state.namespace = null;
    updateConnectionStatus('disconnected');

    // Reconnect after delay
    setTimeout(connectWebSocket, 3000);
  };

  state.ws.onerror = (err) => {
    console.error('WebSocket error:', err);
  };
}

function sendHandshake() {
  send({
    type: 'handshake',
    name: 'browser-gui',
    version: '0.1.0',
    metadata: {
      userAgent: navigator.userAgent,
    },
  });
}

function send(msg) {
  if (!state.ws || state.ws.readyState !== WebSocket.OPEN) {
    return;
  }
  state.ws.send(JSON.stringify(msg));
}

function sendMessage(type, path, payload, target) {
  state.sequence++;
  const msg = {
    id: crypto.randomUUID(),
    type,
    source: state.namespace || 'app.browser_gui',
    path,
    payload,
    timestamp: Date.now(),
    sequence: state.sequence,
  };
  if (target) {
    msg.target = target;
  }
  send(msg);
  return msg.id;
}

// -----------------------------------------------------------------------------
// Message Handling
// -----------------------------------------------------------------------------

function handleMessage(msg) {
  // Handle handshake response
  if (msg.type === 'handshake_response') {
    if (msg.success) {
      state.connected = true;
      state.namespace = msg.namespace;
      updateConnectionStatus('connected');

      // Subscribe to all state
      subscribeToState();

      addLogEntry('info', 'Connected to bridge', { namespace: msg.namespace });
    } else {
      addLogEntry('error', 'Handshake failed', { error: msg.error });
    }
    return;
  }

  // Handle state messages
  if (msg.type === 'state') {
    handleStateUpdate(msg);
    return;
  }

  // Handle events
  if (msg.type === 'event') {
    handleEvent(msg);
    return;
  }

  // Handle ack
  if (msg.type === 'ack') {
    handleAck(msg);
    return;
  }

  // Handle errors
  if (msg.type === 'error') {
    addLogEntry('error', msg.payload?.message || 'Unknown error', msg.payload);
    return;
  }

  // Handle ping/pong
  if (msg.type === 'ping') {
    send({ type: 'pong' });
    return;
  }
}

function subscribeToState() {
  sendMessage('subscribe', 'hub.subscriptions', {
    patterns: ['**'],
    snapshot: true,
  });
}

function handleStateUpdate(msg) {
  const path = msg.path;
  const payload = msg.payload || {};

  if (payload.value === null) {
    // Deleted
    state.stateEntries.delete(path);
  } else {
    state.stateEntries.set(path, {
      path,
      value: payload.value,
      owner: payload.owner || msg.source,
      version: payload.version || 0,
      stale: payload.stale || false,
      updatedAt: msg.timestamp || Date.now(),
    });
  }

  updateStateTable();
  updateStateCount();

  // Add to log (throttled)
  if (state.eventLog.length < 500) {
    addLogEntry('state', path, { value: payload.value });
  }
}

function handleEvent(msg) {
  const eventName = msg.payload?.event || 'unknown';
  addLogEntry('event', `${msg.path}: ${eventName}`, msg.payload?.data);

  if (eventName === 'snapshot_complete') {
    addLogEntry('info', 'State snapshot complete', {
      entries: state.stateEntries.size,
    });
  }
}

function handleAck(msg) {
  addLogEntry('info', `ACK: ${msg.payload?.status}`, {
    commandId: msg.payload?.commandId,
  });
}

// -----------------------------------------------------------------------------
// UI Updates
// -----------------------------------------------------------------------------

function updateConnectionStatus(status) {
  const el = elements.connectionStatus;
  el.className = `status ${status}`;
  el.querySelector('.text').textContent =
    status === 'connected' ? 'Connected' :
    status === 'connecting' ? 'Connecting...' :
    'Disconnected';
}

function updateStateTable() {
  const filter = elements.stateFilter.value.toLowerCase();
  const tbody = elements.stateTbody;

  // Get filtered entries
  const entries = Array.from(state.stateEntries.values())
    .filter(e => !filter || e.path.toLowerCase().includes(filter))
    .sort((a, b) => a.path.localeCompare(b.path));

  if (entries.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" class="empty">No state entries</td></tr>';
    return;
  }

  // Build HTML
  tbody.innerHTML = entries.map(entry => {
    const valueStr = formatValue(entry.value);
    const timeStr = formatTime(entry.updatedAt);
    const staleClass = entry.stale ? 'stale' : '';

    return `
      <tr class="${staleClass}" data-path="${escapeHtml(entry.path)}">
        <td>${escapeHtml(entry.path)}</td>
        <td title="${escapeHtml(valueStr)}">${truncate(valueStr, 50)}</td>
        <td>${escapeHtml(entry.owner)}</td>
        <td>${entry.version}</td>
        <td>${timeStr}</td>
      </tr>
    `;
  }).join('');
}

function updateStateCount() {
  const filter = elements.stateFilter.value.toLowerCase();
  const total = state.stateEntries.size;
  const filtered = filter
    ? Array.from(state.stateEntries.values()).filter(e =>
        e.path.toLowerCase().includes(filter)
      ).length
    : total;

  elements.stateCount.textContent = filter
    ? `${filtered} / ${total} entries`
    : `${total} entries`;
}

function updateHealthDisplay() {
  if (!state.health) return;

  const deps = state.health.dependencies || [];
  const cards = elements.healthGrid.querySelectorAll('.health-card');

  cards.forEach(card => {
    const component = card.dataset.component;
    const dep = deps.find(d => d.name === component);

    const statusEl = card.querySelector('.health-status');
    const textEl = statusEl.querySelector('.text');
    const detailsEl = card.querySelector('.health-details');

    if (dep) {
      statusEl.className = `health-status ${dep.status}`;
      textEl.textContent = dep.status.charAt(0).toUpperCase() + dep.status.slice(1);

      if (dep.error) {
        detailsEl.textContent = dep.error;
      } else if (dep.metadata) {
        detailsEl.textContent = Object.entries(dep.metadata)
          .map(([k, v]) => `${k}: ${v}`)
          .join(', ');
      } else {
        detailsEl.textContent = '';
      }
    } else {
      statusEl.className = 'health-status unknown';
      textEl.textContent = 'Not found';
      detailsEl.textContent = '';
    }
  });
}

function updateInfoDisplay() {
  if (!state.info) return;

  elements.infoName.textContent = state.info.name || '-';
  elements.infoEnvironment.textContent = state.info.environment || '-';
  elements.infoWsPort.textContent = state.info.websocketPort || '-';
  elements.infoStateEntries.textContent = state.stateEntries.size;
}

function updateUptime() {
  if (!state.health?.uptime) {
    elements.infoUptime.textContent = '-';
    return;
  }

  const ms = state.health.uptime;
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) {
    elements.infoUptime.textContent = `${days}d ${hours % 24}h ${minutes % 60}m`;
  } else if (hours > 0) {
    elements.infoUptime.textContent = `${hours}h ${minutes % 60}m ${seconds % 60}s`;
  } else if (minutes > 0) {
    elements.infoUptime.textContent = `${minutes}m ${seconds % 60}s`;
  } else {
    elements.infoUptime.textContent = `${seconds}s`;
  }
}

// -----------------------------------------------------------------------------
// Event Log
// -----------------------------------------------------------------------------

function addLogEntry(type, message, data) {
  const entry = {
    type,
    message,
    data,
    timestamp: Date.now(),
  };

  state.eventLog.push(entry);

  // Limit log size
  if (state.eventLog.length > 500) {
    state.eventLog.shift();
  }

  // Update UI
  const el = document.createElement('div');
  el.className = `log-entry ${type}`;

  const timeStr = new Date(entry.timestamp).toLocaleTimeString();
  const dataStr = data ? ` ${JSON.stringify(data)}` : '';

  el.innerHTML = `<span class="timestamp">${timeStr}</span>${escapeHtml(message)}${escapeHtml(truncate(dataStr, 100))}`;

  elements.logContainer.appendChild(el);

  // Auto-scroll
  if (elements.logAutoscroll.checked) {
    elements.logContainer.scrollTop = elements.logContainer.scrollHeight;
  }

  // Update count
  elements.logCount.textContent = `${state.eventLog.length} events`;
}

function clearLog() {
  state.eventLog = [];
  elements.logContainer.innerHTML = '<div class="log-entry info">Log cleared</div>';
  elements.logCount.textContent = '0 events';
}

// -----------------------------------------------------------------------------
// API Calls
// -----------------------------------------------------------------------------

async function fetchHealth() {
  try {
    const res = await fetch(`${API_BASE}/api/health`);
    state.health = await res.json();
    updateHealthDisplay();
    updateUptime();
  } catch (err) {
    console.error('Failed to fetch health:', err);
  }
}

async function fetchInfo() {
  try {
    const res = await fetch(`${API_BASE}/api/info`);
    state.info = await res.json();
    updateInfoDisplay();
  } catch (err) {
    console.error('Failed to fetch info:', err);
  }
}

async function fetchConfig() {
  try {
    const res = await fetch(`${API_BASE}/api/config`);
    state.config = await res.json();
    elements.configJson.textContent = JSON.stringify(state.config, null, 2);
  } catch (err) {
    console.error('Failed to fetch config:', err);
    elements.configJson.textContent = 'Failed to load configuration';
  }
}

async function downloadSnapshot() {
  try {
    const res = await fetch(`${API_BASE}/api/snapshot`);
    const data = await res.json();
    downloadJson(data, `snapshot-${Date.now()}.json`);
    addLogEntry('info', 'Snapshot downloaded', { entries: data.entryCount });
  } catch (err) {
    console.error('Failed to download snapshot:', err);
    addLogEntry('error', 'Failed to download snapshot', { error: err.message });
  }
}

async function downloadConfig() {
  if (!state.config) {
    await fetchConfig();
  }
  if (state.config) {
    downloadJson(state.config, `config-${Date.now()}.json`);
    addLogEntry('info', 'Config downloaded');
  }
}

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

function formatValue(value) {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function formatTime(timestamp) {
  if (!timestamp) return '-';
  return new Date(timestamp).toLocaleTimeString();
}

function truncate(str, max) {
  if (str.length <= max) return str;
  return str.slice(0, max - 3) + '...';
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function downloadJson(data, filename) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// -----------------------------------------------------------------------------
// Tab Navigation
// -----------------------------------------------------------------------------

function switchTab(tabId) {
  // Update tab buttons
  elements.tabs.forEach(tab => {
    tab.classList.toggle('active', tab.dataset.tab === tabId);
  });

  // Update tab content
  elements.tabContents.forEach(content => {
    content.classList.toggle('active', content.id === `tab-${tabId}`);
  });

  // Load data for specific tabs
  if (tabId === 'config' && !state.config) {
    fetchConfig();
  }
}

// -----------------------------------------------------------------------------
// Event Listeners
// -----------------------------------------------------------------------------

function setupEventListeners() {
  // Tab navigation
  elements.tabs.forEach(tab => {
    tab.addEventListener('click', () => switchTab(tab.dataset.tab));
  });

  // State filter
  elements.stateFilter.addEventListener('input', () => {
    updateStateTable();
    updateStateCount();
  });

  elements.stateRefresh.addEventListener('click', () => {
    if (state.connected) {
      subscribeToState();
    }
  });

  // Log controls
  elements.logClear.addEventListener('click', clearLog);

  // Export buttons
  elements.exportSnapshot.addEventListener('click', downloadSnapshot);
  elements.exportConfig.addEventListener('click', downloadConfig);
}

// -----------------------------------------------------------------------------
// Initialisation
// -----------------------------------------------------------------------------

function init() {
  setupEventListeners();

  // Fetch initial data
  fetchHealth();
  fetchInfo();

  // Connect WebSocket
  connectWebSocket();

  // Periodic updates
  setInterval(fetchHealth, 10000);
  setInterval(() => {
    updateUptime();
    elements.infoStateEntries.textContent = state.stateEntries.size;
  }, 1000);
}

// Start
init();
