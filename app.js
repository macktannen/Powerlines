/**
 * Indiana Electric Transmission Grid Map
 * Map-to-Sidebar Sync, Spatial Hit-Test, Segment Reassignment & Vivid Pink Selection Highlights
 */

// Application Version & DevTools Information
window.APP_VERSION = '3.16.37';
window.APP_BUILD_TIME = '2026-08-10 12:05:00 EST';

console.log(
  '%c ⚡ Indiana Power Grid Viewer %c v3.16.37 ',
  'background: #0B0F19; color: #00E5FF; font-weight: bold; font-size: 13px; padding: 4px 8px; border-radius: 4px 0 0 4px; border: 1px solid #00E5FF;',
  'background: #00E5FF; color: #00E5FF; font-weight: bold; font-size: 13px; padding: 4px 8px; border-radius: 0 4px 4px 0;'
);
console.log('%c Build Info: %c' + window.APP_BUILD_TIME, 'color: #94A3B8; font-weight: bold;', 'color: #38BDF8;');

// Application State
const state = {
  map: null,
  geoJsonLayer: null,
  groupHighlightLayer: null,
  hoverHighlightLayer: null,
  rawData: null,
  allFeatures: [],
  circuitGroups: [],            // List of aggregated circuit objects & individual unknown segments
  filteredCircuits: [],         // Circuits matching current filters/search
  selectedGroup: new Set(),     // Set of selected circuit names (Multi-Select)
  activeVoltages: new Set(['765000', '345000', '138000', '69000', '34000', '34500', 'OTHER']),
  sortMode: 'voltage-asc-name-asc', // Default: Voltage (Low->High) then Circuit # (Low->High)
  searchQuery: '',
  basemaps: {},
  missionPackages: [],          // List of 37 KVPZ helicopter out-and-back mission packages
  activeMission: null,          // Currently selected mission package
  activeWeatherStation: 'ALL',  // Active weather station filter selection
  weatherCache: {}
};

// Voltage Configuration & Color Matrix
const VOLTAGE_CONFIG = {
  '765000': { label: '765 kV', color: '#D500F9', group: '765000' },
  '345000': { label: '345 kV', color: '#FF0055', group: '345000' },
  '138000': { label: '138 kV', color: '#FF9900', group: '138000' },
  '69000':  { label: '69 kV',  color: '#00E5FF', group: '69000' },
  '34000':  { label: '34 kV',  color: '#00E676', group: '34000' },
  '34500':  { label: '34.5 kV',color: '#00E676', group: '34000' },
  'OTHER':  { label: 'Other / Low', color: '#A855F7', group: 'OTHER' }
};

function getVoltageKey(voltageVal) {
  const vStr = String(voltageVal);
  if (vStr === '765000') return '765000';
  if (vStr === '345000') return '345000';
  if (vStr === '138000') return '138000';
  if (vStr === '69000')  return '69000';
  if (vStr === '34000' || vStr === '34500') return '34000';
  return 'OTHER';
}

function getVoltageColor(voltageVal) {
  const key = getVoltageKey(voltageVal);
  return VOLTAGE_CONFIG[key] ? VOLTAGE_CONFIG[key].color : '#A855F7';
}

function formatVoltageLabel(voltageVal) {
  if (!voltageVal) return 'Unknown Voltage';
  const kV = voltageVal / 1000;
  return `${kV} kV`;
}

// Convert Feet to Miles
function getLengthMiles(props) {
  if (props && props['SHAPE.ST_Length()']) {
    return props['SHAPE.ST_Length()'] / 5280.0;
  }
  return 0;
}

// Helper to check if circuit name is unknown/unassigned
function isUnknownSubnetwork(subName) {
  if (!subName) return true;
  const s = String(subName).trim().toLowerCase();
  return s === 'unknown' || s === 'unassigned' || s === 'none' || s === 'null' || s === '0' || s === '';
}

// Show Toast Notification Banner
function showToast(message) {
  const toast = document.getElementById('toast-notification');
  const msgSpan = document.getElementById('toast-message');
  if (!toast || !msgSpan) return;

  msgSpan.textContent = message;
  toast.classList.remove('hidden');

  setTimeout(() => {
    toast.classList.add('hidden');
  }, 3200);
}

// Initialize Leaflet Map with Bulletproof Basemaps & Hybrid Satellite
function initMap() {
  state.map = L.map('map', {
    center: [40.75, -86.20],
    zoom: 8,
    preferCanvas: true,
    zoomControl: false
  });

  L.control.zoom({ position: 'bottomright' }).addTo(state.map);

  state.basemaps = {
    'dark': L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap contributors &copy; CARTO'
    }),
    'hybrid-satellite': L.layerGroup([
      L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
        maxZoom: 19,
        attribution: '&copy; Esri, Maxar, Earthstar Geographics'
      }),
      L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager_only_labels/{z}/{x}/{y}{r}.png', {
        maxZoom: 19
      })
    ]),
    'osm-standard': L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    }),
    'satellite': L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
      maxZoom: 18,
      attribution: '&copy; Esri, Maxar'
    }),
    'light': L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap contributors &copy; CARTO'
    }),
    'voyager': L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap contributors &copy; CARTO'
    }),
    'esri-streets': L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}', {
      maxZoom: 18,
      attribution: '&copy; Esri'
    }),
    'esri-topo': L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}', {
      maxZoom: 18,
      attribution: '&copy; Esri'
    })
  };

  loadFiltersAndMapPreferences();

  // Apply restored active basemap if saved, otherwise default to dark
  const activeBaseKey = state.activeBasemap && state.basemaps[state.activeBasemap] ? state.activeBasemap : 'dark';
  state.basemaps[activeBaseKey].addTo(state.map);

  setupMapSpatialClickEngine();
}

const DATASET_CIPHER_KEY = 'IND_GRID_2026_SECURE';

function decryptDatasetPayload(payload) {
  if (!payload || !payload.encrypted || !payload.data) return payload;
  try {
    const key = DATASET_CIPHER_KEY;
    const rawStr = atob(payload.data);
    let output = '';
    for (let i = 0; i < rawStr.length; i++) {
      output += String.fromCharCode(rawStr.charCodeAt(i) ^ key.charCodeAt(i % key.length));
    }
    return JSON.parse(output);
  } catch (err) {
    console.error('Failed to decrypt dataset payload:', err);
    return payload;
  }
}

// Load Dataset
async function loadGridData() {
  const loadingOverlay = document.getElementById('loading-overlay');
  const loadingText = document.getElementById('loading-text');

  try {
    loadingText.textContent = 'Fetching transmission dataset...';
    const response = await fetch('osmtransmission.json');
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);

    const fetchedObj = await response.json();
    if (fetchedObj && fetchedObj.encrypted) {
      loadingText.textContent = 'Decrypting dataset payload in memory...';
      state.rawData = decryptDatasetPayload(fetchedObj);
    } else {
      state.rawData = fetchedObj;
    }
    state.allFeatures = state.rawData.features || [];

    loadingText.textContent = 'Grouping circuits & separating unknown segments...';
    aggregateCircuits();

    loadingText.textContent = 'Rendering grid map & controls...';
    processDatasetStats();
    buildVoltageFilterUI();
    populatePlannerCircuitDropdown();
    restoreFiltersAndMapUIState();

    filterAndSortCircuits();
    renderGridLines();
    await loadMissionPackages();

    loadingOverlay.style.opacity = '0';
    setTimeout(() => { loadingOverlay.style.display = 'none'; }, 400);

  } catch (err) {
    console.error('Failed to load dataset:', err);
    loadingText.innerHTML = `<span style="color: #FF0055;"><i class="fa-solid fa-triangle-exclamation"></i> Error: ${err.message}</span>`;
  }
}

// Storage helpers for Filters & Map Preferences (Persists in localStorage)
const FILTERS_MAP_PREFS_KEY = 'indiana_grid_filters_map_prefs';

function loadFiltersAndMapPreferences() {
  try {
    const stored = localStorage.getItem(FILTERS_MAP_PREFS_KEY);
    if (!stored) return;
    const prefs = JSON.parse(stored);

    if (prefs.activeBasemap && state.basemaps[prefs.activeBasemap]) {
      state.activeBasemap = prefs.activeBasemap;
    }

    if (Array.isArray(prefs.activeVoltages)) {
      state.activeVoltages = new Set(prefs.activeVoltages);
    }

    if (typeof prefs.showAirports === 'boolean') {
      state.flightPlanner.showAirports = prefs.showAirports;
    }

    if (typeof prefs.showAirportLabels === 'boolean') {
      state.flightPlanner.showAirportLabels = prefs.showAirportLabels;
    }

    if (typeof prefs.showFuelPrices === 'boolean') {
      state.flightPlanner.showFuelPrices = prefs.showFuelPrices;
    }
  } catch (err) {
    console.warn('Could not load Filters & Map preferences:', err);
  }
}

function saveFiltersAndMapPreferences() {
  try {
    const prefs = {
      activeBasemap: state.activeBasemap || 'dark',
      activeVoltages: Array.from(state.activeVoltages),
      showAirports: state.flightPlanner.showAirports !== false,
      showAirportLabels: state.flightPlanner.showAirportLabels !== false,
      showFuelPrices: state.flightPlanner.showFuelPrices !== false
    };
    localStorage.setItem(FILTERS_MAP_PREFS_KEY, JSON.stringify(prefs));
  } catch (err) {
    console.warn('Could not save Filters & Map preferences:', err);
  }
}

function restoreFiltersAndMapUIState() {
  // Sync Basemap Buttons
  if (state.activeBasemap) {
    const basemapBtns = document.querySelectorAll('.basemap-btn');
    basemapBtns.forEach(btn => {
      const type = btn.getAttribute('data-basemap');
      if (type === state.activeBasemap) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    });
  }

  // Sync Airports Toggles
  const toggleAirportsEl = document.getElementById('toggle-show-airports');
  if (toggleAirportsEl) {
    toggleAirportsEl.checked = state.flightPlanner.showAirports !== false;
  }

  const toggleLabelsEl = document.getElementById('toggle-airport-labels');
  if (toggleLabelsEl) {
    toggleLabelsEl.checked = state.flightPlanner.showAirportLabels !== false;
  }

  const togglePricesEl = document.getElementById('toggle-show-fuel-prices');
  if (togglePricesEl) {
    togglePricesEl.checked = state.flightPlanner.showFuelPrices !== false;
  }
}
state.customMissions = [];

function loadCustomMissionsFromStorage() {
  try {
    const stored = localStorage.getItem('indiana_grid_custom_missions');
    if (stored) {
      state.customMissions = JSON.parse(stored);
    }
  } catch (err) {
    console.warn('Could not read custom missions from localStorage:', err);
    state.customMissions = [];
  }
}

function saveCustomMissionsToStorage() {
  try {
    localStorage.setItem('indiana_grid_custom_missions', JSON.stringify(state.customMissions));
  } catch (err) {
    console.warn('Could not save custom missions to localStorage:', err);
  }
}

// Save Current Flight Plan as a Custom Mission Pack
function saveCurrentFlightPlanAsMissionPack() {
  const fp = state.flightPlanner;
  if (!fp.circuitLegs || fp.circuitLegs.length === 0) {
    alert('Cannot save an empty flight plan as a Mission Pack. Please add at least one circuit leg.');
    return;
  }

  const defaultName = `Custom Mission ${state.customMissions.length + 1}`;
  const customName = prompt('Enter a name for this custom Mission Pack:', defaultName);
  if (customName === null) return; // User cancelled

  const packTitle = customName.trim() || defaultName;

  // Compute flight statistics for custom mission object
  const startApt = INDIANA_AIRPORTS[fp.startAirport] || INDIANA_AIRPORTS['KVPZ'];
  const endApt = INDIANA_AIRPORTS[fp.endAirport] || INDIANA_AIRPORTS['KVPZ'];

  const circuits = fp.circuitLegs.map(name => state.circuitGroups.find(c => c.name === name)).filter(Boolean);
  const totalCircuitMiles = circuits.reduce((sum, c) => sum + c.totalMiles, 0);

  // Highest voltage label
  let highestVoltage = 0;
  circuits.forEach(c => {
    const v = typeof c.voltage === 'number' ? c.voltage : parseFloat(c.voltage);
    if (!isNaN(v) && v > highestVoltage) highestVoltage = v;
  });
  const kvLabel = highestVoltage > 0 ? formatVoltageLabel(highestVoltage) : 'Custom Tier';

  // Compute multi-leg distance & time
  let currentPos = { lat: startApt.lat, lng: startApt.lng };
  let totalTransitMi = 0;
  let totalMins = 0;
  const customParams = fp.legCustomParams || {};

  fp.circuitLegs.forEach((cName, idx) => {
    const cObj = state.circuitGroups.find(c => c.name === cName);
    if (!cObj) return;

    let entryPt = { lat: currentPos.lat, lng: currentPos.lng };
    let exitPt = { lat: currentPos.lat, lng: currentPos.lng };

    if (fp.manualEndpoints && fp.manualEndpoints[cName] && fp.manualEndpoints[cName].entryPt) {
      entryPt = fp.manualEndpoints[cName].entryPt;
      exitPt = fp.manualEndpoints[cName].exitPt || entryPt;
    } else {
      const endpoints = findCircuitEndpoints(cObj, currentPos);
      entryPt = endpoints.entryPt;
      exitPt = endpoints.exitPt;
    }

    // Transit Leg
    const transitKey = `transit_${idx}`;
    const legTransitParams = customParams[transitKey] || {};
    const trKts = legTransitParams.transitSpeedKts !== undefined ? legTransitParams.transitSpeedKts : 110;
    const trMph = trKts * 1.15078;
    const tDist = calcDistanceMiles(currentPos.lat, currentPos.lng, entryPt.lat, entryPt.lng);
    const tMins = trMph > 0 ? Math.round((tDist / trMph) * 60) : 0;

    totalTransitMi += tDist;
    totalMins += tMins;

    // Inspection Leg
    const inspKey = `insp_${cName}_${idx}`;
    const legInspParams = customParams[inspKey] || {};
    const vStr = String(cObj.voltage);
    const defaultInspKnots = (vStr === '34000' || vStr === '34500') ? 20 : 30;
    const inspKts = legInspParams.inspSpeedKts !== undefined ? legInspParams.inspSpeedKts : defaultInspKnots;
    const inspMph = inspKts * 1.15078;
    const iMins = inspMph > 0 ? Math.round((cObj.totalMiles / inspMph) * 60) : 0;

    totalMins += iMins;
    currentPos = { lat: exitPt.lat, lng: exitPt.lng };
  });

  // Final Transit to End Airport
  const finalDist = calcDistanceMiles(currentPos.lat, currentPos.lng, endApt.lat, endApt.lng);
  const finalMins = Math.round((finalDist / (110 * 1.15078)) * 60);
  totalTransitMi += finalDist;
  totalMins += finalMins;

  const totalFlightMi = totalTransitMi + totalCircuitMiles;
  const hours = Math.floor(totalMins / 60);
  const mins = totalMins % 60;
  const flightTimeStr = `${hours} hrs ${mins} mins`;

  const newCustomMission = {
    id: `custom_mission_${Date.now()}`,
    isCustom: true,
    title: packTitle,
    kv_label: kvLabel,
    circuit_miles: parseFloat(totalCircuitMiles.toFixed(1)),
    total_flight_miles: parseFloat(totalFlightMi.toFixed(1)),
    flight_time_str: flightTimeStr,
    startAirport: fp.startAirport,
    fuelAirport: fp.fuelAirport,
    endAirport: fp.endAirport,
    circuit_names: [...fp.circuitLegs],
    autoPlanBackground: fp.autoPlanBackground,
    autoOptimize: fp.autoOptimize,
    fuelStopIndex: fp.fuelStopIndex,
    manualEndpoints: JSON.parse(JSON.stringify(fp.manualEndpoints || {})),
    legCustomParams: JSON.parse(JSON.stringify(fp.legCustomParams || {})),
    savedAt: new Date().toLocaleDateString()
  };

  state.customMissions.push(newCustomMission);
  saveCustomMissionsToStorage();
  buildMissionDropdownOptions();
  renderCustomMissionCardsList();

  showToast(`💾 Mission Pack "${packTitle}" saved permanently!`);
}

function deleteCustomMissionPack(mId, e) {
  if (e) e.stopPropagation();
  const mission = state.customMissions.find(m => m.id === mId);
  if (!mission) return;

  if (confirm(`Are you sure you want to delete custom mission pack "${mission.title}"?`)) {
    state.customMissions = state.customMissions.filter(m => m.id !== mId);
    saveCustomMissionsToStorage();
    if (state.activeMission && state.activeMission.id === mId) {
      state.activeMission = null;
      document.getElementById('mission-detail-card').classList.add('hidden');
    }
    buildMissionDropdownOptions();
    renderCustomMissionCardsList();
    showToast(`🗑️ Deleted custom mission "${mission.title}"`);
  }
}

window.deleteCustomMissionPack = deleteCustomMissionPack;

function renderCustomMissionCardsList() {
  const container = document.getElementById('custom-mission-cards-list');
  const countBadge = document.getElementById('custom-mission-count');
  if (countBadge) countBadge.textContent = state.customMissions.length;
  if (!container) return;

  container.innerHTML = '';

  if (state.customMissions.length === 0) {
    container.innerHTML = `
      <div style="padding: 12px; text-align: center; color: var(--text-dim); font-size: 0.74rem; background: rgba(0,0,0,0.2); border-radius: 4px; border: 1px dashed var(--panel-border);">
        No custom saved missions yet.<br>Build a route in the <strong>Flight Planner</strong> and click <strong>Save Mission Pack</strong>!
      </div>
    `;
    return;
  }

  state.customMissions.forEach(m => {
    const item = document.createElement('div');
    item.className = `mission-card-item ${state.activeMission && state.activeMission.id === m.id ? 'active' : ''}`;
    item.style.cssText = 'border-left: 3px solid #10B981; position: relative;';

    item.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
        <span class="drawer-badge" style="background: rgba(16, 185, 129, 0.2); color: #10B981; font-size: 0.68rem;">⭐ ${m.kv_label}</span>
        <div style="display: flex; align-items: center; gap: 4px;">
          <span style="font-size: 0.76rem; font-weight: 700; color: #10B981;">${m.flight_time_str}</span>
          <button class="btn-xs btn-highlight" onclick="window.renameMissionPack('${m.id}', event)" style="padding: 1px 5px; font-size: 0.62rem;" title="Rename Mission Pack">
            <i class="fa-solid fa-pen"></i>
          </button>
          <button class="btn-xs btn-danger" onclick="deleteCustomMissionPack('${m.id}', event)" style="padding: 1px 5px; font-size: 0.62rem;" title="Delete Custom Mission">
            <i class="fa-solid fa-trash"></i>
          </button>
        </div>
      </div>
      <div style="font-weight: 700; font-size: 0.92rem; color: #FFF; margin-bottom: 4px;">${m.title}</div>
      <div style="font-size: 0.76rem; color: var(--text-muted); display: flex; gap: 10px;">
        <span><i class="fa-solid fa-bolt" style="color: #10B981;"></i> ${m.circuit_miles} mi lines</span>
        <span><i class="fa-solid fa-helicopter" style="color: var(--text-dim);"></i> ${m.total_flight_miles} mi flight</span>
        <span><i class="fa-solid fa-layer-group" style="color: var(--text-dim);"></i> ${m.circuit_names.length} legs</span>
      </div>
    `;

    item.addEventListener('click', () => {
      selectMissionPackageById(m.id);
      document.querySelectorAll('.mission-card-item').forEach(c => c.classList.remove('active'));
      item.classList.add('active');
    });

    container.appendChild(item);
  });
}

// Fetch and initialize mission packages UI
async function loadMissionPackages() {
  loadCustomMissionsFromStorage();

  try {
    const res = await fetch('mission_packages.json');
    if (res.ok) {
      state.missionPackages = await res.json();
      try {
        const renamedMap = JSON.parse(localStorage.getItem('indiana_grid_renamed_missions') || '{}');
        state.missionPackages.forEach(m => {
          if (renamedMap[m.id]) {
            m.title = renamedMap[m.id];
          }
        });
      } catch (e) {
        console.error('Failed to parse renamed mission packages map:', e);
      }
    }
  } catch (err) {
    console.warn('Could not load standard mission packages:', err);
    state.missionPackages = [];
  }

  const totalCount = (state.missionPackages || []).length + (state.customMissions || []).length;
  document.getElementById('tab-mission-count').textContent = totalCount;

  buildMissionDropdownOptions();
  renderCustomMissionCardsList();
  renderMissionCardsList();
}

function buildMissionDropdownOptions() {
  const select = document.getElementById('mission-packages-select');
  if (!select) return;
  select.innerHTML = '<option value="">-- Select a Mission (~100 mi) --</option>';

  // 1. Custom User Saved Missions Group (if any exist)
  if (state.customMissions && state.customMissions.length > 0) {
    const customGroupEl = document.createElement('optgroup');
    customGroupEl.label = `⭐ Custom Saved Missions (${state.customMissions.length})`;

    state.customMissions.forEach(m => {
      const opt = document.createElement('option');
      opt.value = m.id;
      opt.textContent = `⭐ ${m.title} — ${m.circuit_miles} mi lines | ${m.flight_time_str}`;
      customGroupEl.appendChild(opt);
    });
    select.appendChild(customGroupEl);
  }

  // 2. Standard Canned Mission Packages Groups
  const kvGroups = {};
  (state.missionPackages || []).forEach(m => {
    if (!kvGroups[m.kv_label]) kvGroups[m.kv_label] = [];
    kvGroups[m.kv_label].push(m);
  });

  const kvOrder = ['765 kV', '345 kV', '138 kV', '69 kV', '34 kV / 34.5 kV', 'Other / Low Voltage'];

  kvOrder.forEach(kvLabel => {
    if (kvGroups[kvLabel] && kvGroups[kvLabel].length > 0) {
      const groupEl = document.createElement('optgroup');
      groupEl.label = `⚡ ${kvLabel} Tier (${kvGroups[kvLabel].length} Missions)`;
      
      kvGroups[kvLabel].forEach(m => {
        const opt = document.createElement('option');
        opt.value = m.id;
        opt.textContent = `${m.title} — ${m.circuit_miles} mi lines | ${m.flight_time_str}`;
        groupEl.appendChild(opt);
      });
      select.appendChild(groupEl);
    }
  });
}

function selectMissionPackageById(mId) {
  let mission = (state.missionPackages || []).find(m => m.id === mId);
  if (!mission) {
    mission = (state.customMissions || []).find(m => m.id === mId);
  }

  if (!mission) {
    state.activeMission = null;
    document.getElementById('mission-detail-card').classList.add('hidden');
    return;
  }

  state.activeMission = mission;

  // Sync select dropdown
  const select = document.getElementById('mission-packages-select');
  if (select) select.value = mId;

  // Set airports if custom mission defines them
  if (mission.startAirport) state.flightPlanner.startAirport = mission.startAirport;
  if (mission.fuelAirport) state.flightPlanner.fuelAirport = mission.fuelAirport;
  if (mission.endAirport) state.flightPlanner.endAirport = mission.endAirport;

  // Restore optimization flags & fuel stop index
  let targetAutoPlan = false;
  if (mission.autoPlanBackground !== undefined) {
    targetAutoPlan = (mission.autoPlanBackground === true);
  } else {
    // Fallback for legacy saved missions: custom or manual endpoints default to Manual (false)
    targetAutoPlan = !(mission.isCustom || mission.manualEndpoints);
  }
  setAutoPlanMode(targetAutoPlan);
  
  if (mission.fuelStopIndex !== undefined) {
    state.flightPlanner.fuelStopIndex = mission.fuelStopIndex;
  } else {
    state.flightPlanner.fuelStopIndex = null;
  }

  // Restore custom endpoints and leg parameters if present
  if (mission.manualEndpoints) {
    state.flightPlanner.manualEndpoints = JSON.parse(JSON.stringify(mission.manualEndpoints));
  }
  if (mission.legCustomParams) {
    state.flightPlanner.legCustomParams = JSON.parse(JSON.stringify(mission.legCustomParams));
  }

  // Select all circuits in package
  state.selectedGroup.clear();
  mission.circuit_names.forEach(name => state.selectedGroup.add(name));

  // Explicitly set exact circuit leg sequence saved in mission pack
  state.flightPlanner.circuitLegs = [...mission.circuit_names];

  updateGroupHighlightMap();
  updateGroupSelectionToolbarUI();
  renderCircuitListUI();
  renderMissionDetailCard(mission);
  zoomToGroupBounds();
  
  if (typeof syncSelectedGroupToFlightPlan === 'function') {
    syncSelectedGroupToFlightPlan(true);
  } else {
    recalculateFlightPlan();
  }
}

function renderMissionDetailCard(mission) {
  const card = document.getElementById('mission-detail-card');
  if (!card) return;
  card.classList.remove('hidden');

  document.getElementById('mission-kv-badge').textContent = mission.kv_label;
  document.getElementById('mission-detail-title').textContent = mission.title;
  document.getElementById('mission-detail-time').textContent = mission.flight_time_str;
  document.getElementById('mission-stat-lines').textContent = `${mission.circuit_miles} mi`;
  document.getElementById('mission-stat-flight').textContent = `${mission.total_flight_miles} mi`;
  document.getElementById('mission-stat-count').textContent = mission.circuit_names.length;

  const trKnots = mission.transit_knots || 110;
  const inspKnots = mission.inspection_knots || 30;
  const trMph = trKnots * 1.15077945;
  const inspMph = inspKnots * 1.15077945;

  const tOutMins = mission.transit_out_mins || Math.round((mission.transit_out_miles / trMph) * 60);
  const tInspMins = mission.inspection_mins || Math.round((mission.circuit_miles / inspMph) * 60);
  const tRetMins = mission.transit_back_mins || Math.round((mission.transit_back_miles / trMph) * 60);

  const breakdownEl = document.getElementById('mission-flight-breakdown');
  breakdownEl.innerHTML = `
    <div class="m-breakdown-row">
      <span class="m-breakdown-tag"><i class="fa-solid fa-helicopter" style="color: var(--accent-cyan);"></i> Transit Outbound (${trKnots} kts):</span>
      <span class="m-breakdown-val">${mission.transit_out_miles} mi (~${tOutMins} mins)</span>
    </div>
    <div class="m-breakdown-row">
      <span class="m-breakdown-tag"><i class="fa-solid fa-helicopter" style="color: #FF0055;"></i> Line Inspection (${inspKnots} kts):</span>
      <span class="m-breakdown-val">${mission.circuit_miles} mi (~${tInspMins} mins)</span>
    </div>
    <div class="m-breakdown-row">
      <span class="m-breakdown-tag"><i class="fa-solid fa-helicopter" style="color: var(--accent-cyan);"></i> Transit Return (${trKnots} kts):</span>
      <span class="m-breakdown-val">${mission.transit_back_miles} mi (~${tRetMins} mins)</span>
    </div>
  `;
}

function renderMissionCardsList() {
  const container = document.getElementById('mission-cards-list');
  if (!container) return;
  container.innerHTML = '';

  state.missionPackages.forEach(m => {
    const item = document.createElement('div');
    item.className = `mission-card-item ${state.activeMission && state.activeMission.id === m.id ? 'active' : ''}`;
    
    item.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
        <span class="drawer-badge" style="background: rgba(255,255,255,0.08); font-size: 0.7rem;">${m.kv_label}</span>
        <div style="display: flex; align-items: center; gap: 6px;">
          <span style="font-size: 0.78rem; font-weight: 700; color: var(--accent-cyan); font-family: 'Outfit', sans-serif;">${m.flight_time_str}</span>
          <button class="btn-xs btn-highlight" onclick="window.renameMissionPack('${m.id}', event)" style="padding: 1px 5px; font-size: 0.62rem;" title="Rename Mission Pack">
            <i class="fa-solid fa-pen"></i>
          </button>
        </div>
      </div>
      <div style="font-weight: 700; font-size: 0.92rem; margin-bottom: 4px;">${m.title}</div>
      <div style="font-size: 0.78rem; color: var(--text-muted); display: flex; gap: 12px;">
        <span><i class="fa-solid fa-bolt" style="color: var(--accent-cyan);"></i> ${m.circuit_miles} mi lines</span>
        <span><i class="fa-solid fa-helicopter" style="color: var(--text-dim);"></i> ${m.total_flight_miles} mi flight</span>
        <span><i class="fa-solid fa-layer-group" style="color: var(--text-dim);"></i> ${m.circuit_names.length} circuits</span>
      </div>
    `;

    item.addEventListener('click', () => {
      selectMissionPackageById(m.id);
      document.querySelectorAll('.mission-card-item').forEach(c => c.classList.remove('active'));
      item.classList.add('active');
    });

    container.appendChild(item);
  });
}

// Group Line Segments into Circuits & Separate Unknown Segments Individually
function aggregateCircuits() {
  const mapKnownCircuits = new Map();
  const unknownCircuitsList = [];

  let unknownCounter = 1;

  state.allFeatures.forEach((feat, featIdx) => {
    const p = feat.properties || {};
    const subRaw = p.SUBNETWORKNAME;

    if (isUnknownSubnetwork(subRaw)) {
      // Individual entry for each unknown segment
      const gisId = p.GISID ? `GIS ${p.GISID}` : `Seg #${unknownCounter}`;
      const unassignedName = `Unassigned (${gisId})`;
      unknownCounter++;

      const feet = p['SHAPE.ST_Length()'] || 0;

      const featureColl = { type: 'FeatureCollection', features: [feat] };
      const tempLayer = L.geoJSON(featureColl);

      unknownCircuitsList.push({
        name: unassignedName,
        voltage: p.NOMINALVOLTAGE || 'OTHER',
        features: [feat],
        totalFeet: feet,
        totalMiles: feet / 5280.0,
        segmentCount: 1,
        operatingAreasList: [],
        gisIds: p.GISID ? [p.GISID] : [],
        isUnknownSegment: true,
        bounds: tempLayer.getBounds()
      });

    } else {
      // Group known circuits by SUBNETWORKNAME
      const subName = String(subRaw).trim();

      if (!mapKnownCircuits.has(subName)) {
        mapKnownCircuits.set(subName, {
          name: subName,
          voltage: p.NOMINALVOLTAGE,
          features: [],
          totalFeet: 0,
          totalMiles: 0,
          gisIds: [],
          isUnknownSegment: false
        });
      }

      const cGroup = mapKnownCircuits.get(subName);
      cGroup.features.push(feat);
      
      const ft = p['SHAPE.ST_Length()'] || 0;
      cGroup.totalFeet += ft;
      if (p.GISID) cGroup.gisIds.push(p.GISID);
    }
  });

  const knownList = Array.from(mapKnownCircuits.values()).map(c => {
    c.totalMiles = c.totalFeet / 5280.0;
    c.segmentCount = c.features.length;
    c.operatingAreasList = [];

    const featureColl = { type: 'FeatureCollection', features: c.features };
    const tempLayer = L.geoJSON(featureColl);
    c.bounds = tempLayer.getBounds();

    return c;
  });

  state.circuitGroups = [...knownList, ...unknownCircuitsList];
  updateCircuitOptionsDatalist();
}

// Populate circuit options datalist for reassign form
function updateCircuitOptionsDatalist() {
  const datalist = document.getElementById('circuit-options-list');
  if (!datalist) return;
  datalist.innerHTML = '';

  const knownNames = state.circuitGroups
    .filter(c => !c.isUnknownSegment)
    .map(c => c.name)
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

  knownNames.forEach(name => {
    const opt = document.createElement('option');
    opt.value = name;
    datalist.appendChild(opt);
  });
}

// Stats counter
function processDatasetStats() {
  let totalSegs = state.allFeatures.length;
  let totalFeet = 0;

  state.allFeatures.forEach(f => {
    totalFeet += (f.properties ? f.properties['SHAPE.ST_Length()'] || 0 : 0);
  });

  const totalMiles = (totalFeet / 5280.0).toLocaleString('en-US', { maximumFractionDigits: 1 });
  
  document.getElementById('stat-total-circuits').textContent = state.circuitGroups.length.toLocaleString();
  document.getElementById('stat-total-miles').textContent = `${totalMiles} mi`;
  document.getElementById('tab-circuit-count').textContent = state.circuitGroups.length;
}



// Voltage Checklist UI
function buildVoltageFilterUI() {
  const container = document.getElementById('voltage-filter-list');
  container.innerHTML = '';

  const voltageCounts = { '765000': 0, '345000': 0, '138000': 0, '69000': 0, '34000': 0, 'OTHER': 0 };

  state.allFeatures.forEach(f => {
    const v = f.properties ? f.properties.NOMINALVOLTAGE : null;
    const key = getVoltageKey(v);
    if (voltageCounts[key] !== undefined) voltageCounts[key]++;
    else voltageCounts['OTHER']++;
  });

  const filterGroups = [
    { key: '765000', label: '765 kV Extra High Voltage', color: VOLTAGE_CONFIG['765000'].color },
    { key: '345000', label: '345 kV Transmission', color: VOLTAGE_CONFIG['345000'].color },
    { key: '138000', label: '138 kV Transmission', color: VOLTAGE_CONFIG['138000'].color },
    { key: '69000',  label: '69 kV Sub-Transmission', color: VOLTAGE_CONFIG['69000'].color },
    { key: '34000',  label: '34 kV Distribution', color: VOLTAGE_CONFIG['34000'].color },
    { key: 'OTHER',  label: 'Other / Unassigned', color: VOLTAGE_CONFIG['OTHER'].color }
  ];

  filterGroups.forEach(group => {
    const item = document.createElement('div');
    item.className = 'voltage-item';

    const count = voltageCounts[group.key] || 0;
    const checked = state.activeVoltages.has(group.key);

    item.innerHTML = `
      <div class="voltage-checkbox-wrapper">
        <input type="checkbox" id="chk-v-${group.key}" value="${group.key}" ${checked ? 'checked' : ''}>
        <span class="voltage-color-tag" style="background: ${group.color}; color: ${group.color}"></span>
        <label for="chk-v-${group.key}">${group.label}</label>
      </div>
      <span class="voltage-count">${count.toLocaleString()} segs</span>
    `;

    const chk = item.querySelector('input');
    chk.addEventListener('change', (e) => {
      if (e.target.checked) state.activeVoltages.add(group.key);
      else state.activeVoltages.delete(group.key);

      filterAndSortCircuits();
      renderGridLines();
      saveFiltersAndMapPreferences();
    });

    container.appendChild(item);
  });
}

// Parse search input into clean tokens separated by commas or semicolons
function parseSearchTokens(queryStr) {
  if (!queryStr) return [];
  return queryStr.split(/[,;]+/).map(s => s.trim().toLowerCase()).filter(Boolean);
}

// Precise Circuit Token Matcher
function circuitMatchesToken(circuit, token) {
  const name = circuit.name.toLowerCase();

  // Match exact circuit name, or prefix match while typing, or "circuit X"
  if (name === token || name.startsWith(token) || name === 'circuit ' + token) return true;
  
  // Allow substring match only if token has 3 or more characters
  if (token.length >= 3 && name.includes(token)) return true;

  // Match GIS ID
  if (circuit.gisIds.some(id => String(id).toLowerCase() === token)) return true;

  return false;
}

// Filter and Sort Circuit List
function filterAndSortCircuits() {
  const tokens = parseSearchTokens(state.searchQuery);

  state.filteredCircuits = state.circuitGroups.filter(circuit => {
    const vKey = getVoltageKey(circuit.voltage);
    if (!state.activeVoltages.has(vKey)) return false;

    if (tokens.length > 0) {
      const match = tokens.some(t => circuitMatchesToken(circuit, t));
      if (!match) return false;
    }

    return true;
  });

  // When user types in search box: automatically check the checkboxes for matched circuits!
  if (tokens.length > 0) {
    state.filteredCircuits.forEach(c => state.selectedGroup.add(c.name));
    updateGroupHighlightMap();
  }

  // Sort Circuits by Voltage then Circuit # (Numeric Low to High)
  state.filteredCircuits.sort((a, b) => {
    // Unassigned segments ALWAYS go to the bottom of the list
    if (a.isUnknownSegment && !b.isUnknownSegment) return 1;
    if (!a.isUnknownSegment && b.isUnknownSegment) return -1;
    if (a.isUnknownSegment && b.isUnknownSegment) {
      return a.name.localeCompare(b.name, undefined, { numeric: true });
    }

    if (state.sortMode === 'voltage-asc-name-asc') {
      const vDiff = (a.voltage || 0) - (b.voltage || 0);
      if (vDiff !== 0) return vDiff;
      return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
    }
    if (state.sortMode === 'voltage-desc-name-asc') {
      const vDiff = (b.voltage || 0) - (a.voltage || 0);
      if (vDiff !== 0) return vDiff;
      return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
    }
    if (state.sortMode === 'miles-desc') return b.totalMiles - a.totalMiles;
    if (state.sortMode === 'segments-desc') return b.segmentCount - a.segmentCount;
    if (state.sortMode === 'name-asc') return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
    return 0;
  });

  updateGroupSelectionToolbarUI();
  renderCircuitListUI();
}

// Render Circuit Cards in Sidebar
function renderCircuitListUI() {
  const container = document.getElementById('circuit-cards-list');
  container.innerHTML = '';

  document.getElementById('tab-circuit-count').textContent = state.filteredCircuits.length;

  if (state.filteredCircuits.length === 0) {
    container.innerHTML = '<div style="padding: 20px; text-align: center; color: var(--text-dim);">No matching circuits found</div>';
    return;
  }

  state.filteredCircuits.forEach(circuit => {
    const card = document.createElement('div');
    card.className = 'circuit-card';
    if (circuit.isUnknownSegment) {
      card.classList.add('unknown-card');
    }
    card.setAttribute('data-circuit-name', circuit.name);

    const isSelected = state.selectedGroup.has(circuit.name);
    if (isSelected) {
      card.classList.add('selected');
    }

    const vColor = getVoltageColor(circuit.voltage);
    const vLabel = circuit.isUnknownSegment ? 'Unassigned' : formatVoltageLabel(circuit.voltage);
    const milesStr = circuit.totalMiles.toFixed(2);

    card.innerHTML = `
      <div class="circuit-card-header">
        <div class="circuit-card-header-left">
          <input type="checkbox" class="circuit-checkbox" ${isSelected ? 'checked' : ''} data-name="${circuit.name}">
          <span class="circuit-name">${circuit.isUnknownSegment ? circuit.name : 'Circuit ' + circuit.name}</span>
        </div>
        <span class="voltage-badge" style="background: ${vColor}25; color: ${vColor}; border: 1px solid ${vColor}60;">${vLabel}</span>
      </div>
      <div class="circuit-card-body">
        <div class="circuit-stat-item">
          <span class="val">${milesStr} mi</span>
          <span class="lbl">Total Length</span>
        </div>
        <div class="circuit-stat-item">
          <span class="val">${circuit.segmentCount}</span>
          <span class="lbl">Segments</span>
        </div>
      </div>
    `;

    // Checkbox toggle
    const chk = card.querySelector('.circuit-checkbox');
    chk.addEventListener('click', (e) => {
      e.stopPropagation();
    });
    chk.addEventListener('change', (e) => {
      if (e.target.checked) {
        state.selectedGroup.add(circuit.name);
      } else {
        state.selectedGroup.delete(circuit.name);
      }
      syncSelectedGroupToFlightPlan();
    });

    // Hover effect on Map
    card.addEventListener('mouseenter', () => highlightCircuitHover(circuit));
    card.addEventListener('mouseleave', () => clearCircuitHover());

    // Click card body to toggle selection
    card.addEventListener('click', () => {
      if (state.selectedGroup.has(circuit.name)) {
        state.selectedGroup.delete(circuit.name);
      } else {
        state.selectedGroup.add(circuit.name);
      }
      syncSelectedGroupToFlightPlan();
    });

    container.appendChild(card);
  });
}

// Scroll specific circuit card into view in the sidebar list
function scrollToCircuitCard(circuitName) {
  // Auto-switch disabled per user request
  // const tabBtn = document.querySelector('.sidebar-tabs .tab-btn[data-tab="tab-circuits"]');
  // if (tabBtn && !tabBtn.classList.contains('active')) {
  //   tabBtn.click();
  // }

  setTimeout(() => {
    const card = document.querySelector(`.circuit-card[data-circuit-name="${CSS.escape(circuitName)}"]`);
    if (card) {
      card.scrollIntoView({ behavior: 'smooth', block: 'center' });
      card.classList.add('pulse-highlight');
      setTimeout(() => card.classList.remove('pulse-highlight'), 1400);
    }
  }, 80);
}

// Update Group Selection Toolbar & Inspector
function updateGroupSelectionToolbarUI() {
  const badge = document.getElementById('group-count-badge');
  const milesLabel = document.getElementById('group-miles-label');

  const count = state.selectedGroup.size;
  badge.textContent = `${count} selected`;

  let totalMiles = 0;
  state.selectedGroup.forEach(cName => {
    const c = state.circuitGroups.find(item => item.name === cName);
    if (c) totalMiles += c.totalMiles;
  });

  milesLabel.textContent = `${totalMiles.toFixed(1)} mi total`;

  if (count > 0) {
    renderGroupInspectorDrawer(totalMiles);
  } else {
    document.getElementById('inspector-drawer').classList.add('hidden');
  }
}

// Render Inspector Drawer with Reassign Circuit Form (Shown ONLY when an UNKNOWN segment is selected)
function renderGroupInspectorDrawer(totalMiles) {
  const drawer = document.getElementById('inspector-drawer');
  const badge = document.getElementById('insp-voltage-badge');
  const title = document.getElementById('insp-title');
  const details = document.getElementById('drawer-details');
  const segList = document.getElementById('insp-segments-list');
  const listTitle = document.getElementById('insp-list-title');
  const reassignSec = document.getElementById('reassign-circuit-section');

  const count = state.selectedGroup.size;
  const selectedCircuitsList = [];

  state.selectedGroup.forEach(cName => {
    const c = state.circuitGroups.find(item => item.name === cName);
    if (c) selectedCircuitsList.push(c);
  });

  badge.textContent = count === 1 ? (selectedCircuitsList[0].isUnknownSegment ? 'Unassigned Segment' : 'Circuit') : `Group (${count} Selected)`;
  badge.style.background = `rgba(0, 229, 255, 0.2)`;
  badge.style.color = '#00E5FF';

  title.textContent = count === 1 ? selectedCircuitsList[0].name : `Multi-Circuit Group`;

  let totalSegments = 0;
  const voltagesSet = new Set();
  selectedCircuitsList.forEach(c => {
    totalSegments += c.segmentCount;
    if (c.voltage) voltagesSet.add(formatVoltageLabel(c.voltage));
  });

  const voltagesStr = Array.from(voltagesSet).join(', ') || 'Various';

  // Calculate Centroid & Flight Times for Selected Group from KVPZ Base
  const KVPZ_LAT = 41.4542;
  const KVPZ_LNG = -87.0071;

  let groupLats = [];
  let groupLngs = [];
  let allAre34kV = selectedCircuitsList.length > 0;

  selectedCircuitsList.forEach(c => {
    const vStr = String(c.voltage);
    if (vStr !== '34000' && vStr !== '34500') {
      allAre34kV = false;
    }
    if (c.bounds && c.bounds.isValid()) {
      const center = c.bounds.getCenter();
      groupLats.push(center.lat);
      groupLngs.push(center.lng);
    }
  });

  const avgLat = groupLats.length > 0 ? (groupLats.reduce((a, b) => a + b, 0) / groupLats.length) : KVPZ_LAT;
  const avgLng = groupLngs.length > 0 ? (groupLngs.reduce((a, b) => a + b, 0) / groupLngs.length) : KVPZ_LNG;

  function calcDist(lat1, lon1, lat2, lon2) {
    const R = 3958.8;
    const dlat = (lat2 - lat1) * Math.PI / 180;
    const dlon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dlat/2)**2 + Math.cos(lat1*Math.PI/180) * Math.cos(lat2*Math.PI/180) * Math.sin(dlon/2)**2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  }

  let totalTransitMi = calcDist(KVPZ_LAT, KVPZ_LNG, avgLat, avgLng) * 2;
  let trKnots = 110;
  let inspKnots = allAre34kV ? 20 : 30;

  let tTransitMins = Math.round((totalTransitMi / (trKnots * 1.15077945)) * 60);
  let tInspMins = Math.round((totalMiles / (inspKnots * 1.15077945)) * 60);
  let totalFlightMins = tTransitMins + tInspMins;

  function formatTime(totMins) {
    let h = Math.floor(totMins / 60);
    let m = Math.round(totMins % 60);
    return h === 0 ? `${m} mins` : `${h} hrs ${m} mins`;
  }

  let flightTimeStr = formatTime(totalFlightMins);
  let totFlightMiles = totalTransitMi + totalMiles;

  // OVERRIDE WITH ACTIVE FLIGHT PLAN DATA IF AVAILABLE
  if (state.flightPlanner && state.flightPlanner.circuitLegs.length > 0 && state.flightPlanner.lastTotals) {
    const totals = state.flightPlanner.lastTotals;
    let calcTransitMiles = totals.totalTransitMiles || 0;
    let calcInspMiles = totals.totalInspectionMiles || 0;
    let calcTotalMiles = totals.totalMiles || 0;
    let calcTotalMinutes = totals.totalFlightMinutes || 0;

    let calcTransitMins = 0;
    let calcInspMins = 0;

    if (totals.legsManifest) {
      totals.legsManifest.forEach(l => {
        if (l.type === 'TRANSIT' || l.type === 'FINAL_TRANSIT') {
          calcTransitMins += (l.timeMins || 0);
        } else if (l.type === 'INSPECTION') {
          calcInspMins += (l.timeMins || 0);
        }
      });
    }

    totalTransitMi = calcTransitMiles;
    tTransitMins = calcTransitMins;
    totalMiles = calcInspMiles;
    tInspMins = calcInspMins;
    totalFlightMins = calcTotalMinutes;
    flightTimeStr = totals.flightTimeStr || formatTime(calcTotalMinutes);
    totFlightMiles = calcTotalMiles;
  }

  details.innerHTML = `
    <div class="attr-row"><span class="attr-key">Circuits Selected</span><span class="attr-val">${count} items</span></div>
    <div class="attr-row"><span class="attr-key">Combined Distance</span><span class="attr-val">${totalMiles.toFixed(2)} miles</span></div>
    <div class="attr-row"><span class="attr-key">Total Line Segments</span><span class="attr-val">${totalSegments.toLocaleString()}</span></div>
    <div class="attr-row"><span class="attr-key">Voltage Ratings</span><span class="attr-val">${voltagesStr}</span></div>
    <div class="attr-row" style="margin-top: 6px; padding-top: 6px; border-top: 1px dashed var(--panel-border);">
      <span class="attr-key" style="color: var(--accent-cyan); font-weight: 600;"><i class="fa-solid fa-helicopter"></i> Enroute Transit</span>
      <span class="attr-val" style="color: var(--accent-cyan);">${totalTransitMi.toFixed(1)} mi (~${tTransitMins} mins)</span>
    </div>
    <div class="attr-row">
      <span class="attr-key" style="color: #FF0055; font-weight: 600;"><i class="fa-solid fa-helicopter"></i> Line Inspection</span>
      <span class="attr-val" style="color: #FF0055;">${totalMiles.toFixed(1)} mi (~${tInspMins} mins)</span>
    </div>
    <div class="attr-row" style="font-weight: 700;">
      <span class="attr-key" style="color: #FFF;"><i class="fa-solid fa-clock"></i> Total Mission Time</span>
      <span class="attr-val" style="color: var(--accent-cyan); font-size: 0.88rem;">${flightTimeStr} (${totFlightMiles.toFixed(1)} mi)</span>
    </div>
  `;

  // ONLY show reassign section if a single UNKNOWN segment is selected. Otherwise keep completely hidden.
  if (count === 1 && selectedCircuitsList[0].isUnknownSegment) {
    const targetGroupObj = selectedCircuitsList[0];
    reassignSec.classList.remove('hidden');
    const inputField = document.getElementById('reassign-circuit-input');
    const voltSelect = document.getElementById('reassign-voltage-select');

    inputField.value = '';
    if (targetGroupObj.voltage && targetGroupObj.voltage !== 'OTHER') {
      voltSelect.value = String(targetGroupObj.voltage);
    }
  } else {
    reassignSec.classList.add('hidden');
  }

  listTitle.innerHTML = `Circuits in Group (<span>${count}</span>)`;
  segList.innerHTML = '';

  selectedCircuitsList.forEach(c => {
    const item = document.createElement('div');
    item.className = 'segment-item-mini';
    const vColor = getVoltageColor(c.voltage);
    const vLabel = c.isUnknownSegment ? 'Unassigned' : formatVoltageLabel(c.voltage);

    item.innerHTML = `
      <div>
        <strong style="color:var(--text-main);">${c.name}</strong>
        <span style="font-size:0.72rem; color:${vColor}; margin-left:6px;">${vLabel}</span>
      </div>
      <div style="display:flex; align-items:center; gap:8px;">
        <span style="color: var(--text-muted);">${c.totalMiles.toFixed(1)} mi</span>
        <button class="btn-xs btn-danger" style="padding:2px 6px;" title="Remove from Group"><i class="fa-solid fa-xmark"></i></button>
      </div>
    `;

    const rmBtn = item.querySelector('button');
    rmBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      state.selectedGroup.delete(c.name);
      
      const fpIndex = state.flightPlanner.circuitLegs.indexOf(c.name);
      if (fpIndex !== -1) {
        removeCircuitFromFlightPlan(fpIndex);
      } else {
        updateGroupHighlightMap();
        updateGroupSelectionToolbarUI();
        renderCircuitListUI();
      }
    });

    item.addEventListener('click', () => {
      if (c.bounds && c.bounds.isValid()) {
        state.map.flyToBounds(c.bounds, { padding: [60, 60], maxZoom: 15 });
      }
    });

    segList.appendChild(item);
  });

  drawer.classList.remove('hidden');
}

// Reassign Selected Circuit / Segment & Persist Permanently to Database File on Disk
async function reassignSelectedSegmentCircuit() {
  if (state.selectedGroup.size !== 1) {
    alert('Please select a single unassigned segment to reassign.');
    return;
  }

  const selectedName = Array.from(state.selectedGroup)[0];
  const targetGroupObj = state.circuitGroups.find(c => c.name === selectedName);
  if (!targetGroupObj || !targetGroupObj.isUnknownSegment) return;

  const inputVal = document.getElementById('reassign-circuit-input').value.trim();
  const voltVal = document.getElementById('reassign-voltage-select').value;

  if (!inputVal) {
    alert('Please enter a target Circuit # or name.');
    return;
  }

  const numericVolt = (voltVal === 'OTHER') ? 0 : parseInt(voltVal, 10);

  // Update properties on underlying feature in this segment
  targetGroupObj.features.forEach(feat => {
    if (!feat.properties) feat.properties = {};
    feat.properties.SUBNETWORKNAME = inputVal;
    feat.properties.NOMINALVOLTAGE = numericVolt;
  });

  // Re-aggregate circuit groups
  aggregateCircuits();

  // Clear current selection and select newly assigned circuit
  state.selectedGroup.clear();
  state.selectedGroup.add(inputVal);

  filterAndSortCircuits();
  renderGridLines();
  updateGroupHighlightMap();
  updateGroupSelectionToolbarUI();
  scrollToCircuitCard(inputVal);

  // Permanently save changes to database / file on disk!
  await saveDatasetToDatabase();
}

// Save all features permanently to server API endpoint (writes to transmission_wgs84.json)
async function saveDatasetToDatabase() {
  try {
    const response = await fetch('/api/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ features: state.allFeatures })
    });

    if (response.ok) {
      const data = await response.json();
      console.log('Saved to database:', data.message);
      showToast('Changes saved permanently to database!');
    } else {
      console.error('Failed to save changes to database file.');
    }
  } catch (err) {
    console.error('Database save error:', err);
  }
}

// Group Highlight Map Layer - Vivid Neon Pink (#FF007F)
function updateGroupHighlightMap() {
  if (state.groupHighlightLayer) {
    state.map.removeLayer(state.groupHighlightLayer);
    state.groupHighlightLayer = null;
  }

  if (state.selectedGroup.size === 0) return;

  const groupFeatures = [];

  state.selectedGroup.forEach(cName => {
    const c = state.circuitGroups.find(item => item.name === cName);
    if (c) {
      groupFeatures.push(...c.features);
    }
  });

  if (groupFeatures.length === 0) return;

  const featureColl = { type: 'FeatureCollection', features: groupFeatures };
  state.groupHighlightLayer = L.geoJSON(featureColl, {
    style: {
      color: '#FF007F', // Vivid Neon Pink
      weight: 6,
      opacity: 0.95
    }
  }).addTo(state.map);
}

// Zoom to Group Bounds
function zoomToGroupBounds() {
  if (state.selectedGroup.size === 0) return;

  const boundsList = [];
  state.selectedGroup.forEach(cName => {
    const c = state.circuitGroups.find(item => item.name === cName);
    if (c && c.bounds && c.bounds.isValid()) {
      boundsList.push(c.bounds);
    }
  });

  if (boundsList.length === 0) return;

  let combinedBounds = boundsList[0];
  for (let i = 1; i < boundsList.length; i++) {
    combinedBounds.extend(boundsList[i]);
  }

  state.map.flyToBounds(combinedBounds, { padding: [60, 60] });
}

// Hover Highlight on Map
function highlightCircuitHover(circuit) {
  if (state.hoverHighlightLayer) {
    state.map.removeLayer(state.hoverHighlightLayer);
  }
  const featureColl = { type: 'FeatureCollection', features: circuit.features };
  state.hoverHighlightLayer = L.geoJSON(featureColl, {
    style: {
      color: '#00E5FF',
      weight: 6,
      opacity: 0.9
    }
  }).addTo(state.map);
}

function clearCircuitHover() {
  if (state.hoverHighlightLayer) {
    state.map.removeLayer(state.hoverHighlightLayer);
    state.hoverHighlightLayer = null;
  }
}

// Distance from point (px, py) to line segment (x1, y1) - (x2, y2) in pixels
function distToSegment(px, py, x1, y1, x2, y2) {
  const l2 = (x2 - x1) * (x2 - x1) + (y2 - y1) * (y2 - y1);
  if (l2 === 0) return Math.hypot(px - x1, py - y1);
  let t = ((px - x1) * (x2 - x1) + (py - y1) * (y2 - y1)) / l2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (x1 + t * (x2 - x1)), py - (y1 + t * (y2 - y1)));
}

// Map-Wide Spatial Click & Mousemove Detection Engine
function setupMapSpatialClickEngine() {
  const CLICK_THRESHOLD_PX = 20;

  function findNearestCircuit(latLng) {
    if (!state.map || state.filteredCircuits.length === 0) return null;

    const clickPt = state.map.latLngToContainerPoint(latLng);
    let minDistance = Infinity;
    let closestCircuitName = null;

    for (let cIdx = 0; cIdx < state.filteredCircuits.length; cIdx++) {
      const circuit = state.filteredCircuits[cIdx];
      
      for (let fIdx = 0; fIdx < circuit.features.length; fIdx++) {
        const feat = circuit.features[fIdx];
        const geom = feat.geometry || {};
        const coords = geom.coordinates || [];

        const lines = geom.type === 'LineString' ? [coords] : (geom.type === 'MultiLineString' ? coords : []);

        for (let lIdx = 0; lIdx < lines.length; lIdx++) {
          const line = lines[lIdx];
          for (let pIdx = 0; pIdx < line.length - 1; pIdx++) {
            const pt1 = state.map.latLngToContainerPoint([line[pIdx][1], line[pIdx][0]]);
            const pt2 = state.map.latLngToContainerPoint([line[pIdx + 1][1], line[pIdx + 1][0]]);

            const d = distToSegment(clickPt.x, clickPt.y, pt1.x, pt1.y, pt2.x, pt2.y);
            if (d < minDistance) {
              minDistance = d;
              closestCircuitName = circuit.name;
            }
          }
        }
      }
    }

    if (minDistance <= CLICK_THRESHOLD_PX) {
      return closestCircuitName;
    }
    return null;
  }

  state.map.on('click', (e) => {
    const clickedCircuitName = findNearestCircuit(e.latlng);
    if (clickedCircuitName) {
      if (state.flightPlanner && state.flightPlanner.isClickMode) {
        addCircuitToFlightPlan(clickedCircuitName);
        return;
      }

      if (state.selectedGroup.has(clickedCircuitName)) {
        state.selectedGroup.delete(clickedCircuitName);
      } else {
        state.selectedGroup.add(clickedCircuitName);
      }

      syncSelectedGroupToFlightPlan();
      scrollToCircuitCard(clickedCircuitName);
    }
  });

  let hoverTooltip = null;

  state.map.on('mousemove', (e) => {
    const hoveredCircuitName = findNearestCircuit(e.latlng);
    state.map.getContainer().style.cursor = hoveredCircuitName ? 'pointer' : '';

    if (hoveredCircuitName) {
      const content = `<div style="font-family: 'Outfit', sans-serif; font-size: 11px; padding: 4px 8px; font-weight: 700; color: #FFF; background: #0B0F19; border: 1.5px solid #00E5FF; border-radius: 6px; box-shadow: 0 4px 12px rgba(0,0,0,0.5);">⚡ Circuit ${hoveredCircuitName}</div>`;
      if (!hoverTooltip) {
        hoverTooltip = L.tooltip({
          permanent: false,
          direction: 'top',
          sticky: true,
          offset: [0, -10],
          className: 'custom-hover-tooltip'
        });
      }
      hoverTooltip.setContent(content);
      hoverTooltip.setLatLng(e.latlng);
      if (!state.map.hasLayer(hoverTooltip)) {
        hoverTooltip.addTo(state.map);
      }
    } else {
      if (hoverTooltip && state.map.hasLayer(hoverTooltip)) {
        state.map.removeLayer(hoverTooltip);
      }
    }
  });

  state.map.on('mouseout', () => {
    if (hoverTooltip && state.map.hasLayer(hoverTooltip)) {
      state.map.removeLayer(hoverTooltip);
    }
  });
}

// Render Grid Lines on Map
function renderGridLines() {
  if (state.geoJsonLayer) {
    state.map.removeLayer(state.geoJsonLayer);
  }

  const renderFeatures = [];
  state.filteredCircuits.forEach(c => {
    renderFeatures.push(...c.features);
  });

  const canvasRenderer = L.canvas({ padding: 0.5, tolerance: 20 });

  state.geoJsonLayer = L.geoJSON({ type: 'FeatureCollection', features: renderFeatures }, {
    renderer: canvasRenderer,
    style: (feature) => {
      const v = feature.properties ? feature.properties.NOMINALVOLTAGE : null;
      const color = getVoltageColor(v);
      const key = getVoltageKey(v);

      let weight = 3;
      if (key === '765000') weight = 6;
      else if (key === '345000') weight = 5;
      else if (key === '138000') weight = 4;

      return {
        color: color,
        weight: weight,
        opacity: 0.85,
        interactive: true
      };
    },
    onEachFeature: (feature, layer) => {
      const p = feature.properties || {};
      const circuitName = p.SUBNETWORKNAME || 'Unassigned Segment';
      const voltage = formatVoltageLabel(p.NOMINALVOLTAGE);

      layer.bindTooltip(`<b>Circuit ${circuitName}</b><br>${voltage}`, {
        sticky: true,
        direction: 'top'
      });
    }
  }).addTo(state.map);
}

function calcDistanceMiles(lat1, lon1, lat2, lon2) {
  const R = 3958.8;
  const dlat = (lat2 - lat1) * Math.PI / 180;
  const dlon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dlat/2)**2 + Math.cos(lat1*Math.PI/180) * Math.cos(lat2*Math.PI/180) * Math.sin(dlon/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

// Precision PDF Map Report Generator Engine — 5 Selectable Styles
function generatePdfReport() {
  let circuitsToReport = [];
  if (state.selectedGroup.size > 0) {
    state.selectedGroup.forEach(cName => {
      const c = state.circuitGroups.find(item => item.name === cName);
      if (c) circuitsToReport.push(c);
    });
  } else if (state.filteredCircuits.length > 0) {
    circuitsToReport = [...state.filteredCircuits];
  } else {
    alert('Please select or filter at least one circuit to generate a PDF report.');
    return;
  }

  // Determine selected style
  const drawerSelect = document.getElementById('report-style-select');
  const barSelect = document.getElementById('report-style-select-bar');
  let reportStyle = 'executive';
  if (barSelect && barSelect.value) {
    reportStyle = barSelect.value;
  }
  if (drawerSelect && drawerSelect.value && drawerSelect.offsetParent !== null) {
    reportStyle = drawerSelect.value;
  }

  const reportFeatures = circuitsToReport.flatMap(c => c.features);

  let totalMiles = 0;
  let totalSegments = 0;

  let groupLats = [];
  let groupLngs = [];
  let allAre34kV = circuitsToReport.length > 0;

  circuitsToReport.forEach(c => {
    totalMiles += c.totalMiles;
    totalSegments += c.segmentCount;

    const vStr = String(c.voltage);
    if (vStr !== '34000' && vStr !== '34500') {
      allAre34kV = false;
    }

    if (c.bounds && c.bounds.isValid()) {
      const center = c.bounds.getCenter();
      groupLats.push(center.lat);
      groupLngs.push(center.lng);
    }
  });

  const avgLat = groupLats.length > 0 ? (groupLats.reduce((a,b)=>a+b,0) / groupLats.length) : 41.467;
  const avgLng = groupLngs.length > 0 ? (groupLngs.reduce((a,b)=>a+b,0) / groupLngs.length) : -87.051;
  const kvpzLat = 41.4538;
  const kvpzLng = -87.0072;
  
  const transitOutMi = calcDistanceMiles(kvpzLat, kvpzLng, avgLat, avgLng);
  const totalTransitMi = transitOutMi * 2;
  const trKnots = 110;
  let inspKnots = 30;
  if (allAre34kV) inspKnots = 20;

  const tTransitMins = (totalTransitMi / (trKnots * 1.15078)) * 60;
  const tInspMins = (totalMiles / (inspKnots * 1.15078)) * 60;
  const totalMins = tTransitMins + tInspMins;
  
  const fHrs = Math.floor(totalMins / 60);
  const fMins = Math.round(totalMins % 60);
  const flightTimeStr = `${fHrs}h ${fMins}m`;
  const totFlightMiles = (totalTransitMi + totalMiles).toFixed(1);

  const isMission = !!(state.activeMission && state.activeMission.circuit_names && state.activeMission.circuit_names.every(n => state.selectedGroup.has(n)));
  const activeMissionObj = isMission ? state.activeMission : null;

  // Check co-located lines (geographic proximity within 2 miles)
  const overlappingPairs = [];
  for (let i = 0; i < circuitsToReport.length; i++) {
    for (let j = i + 1; j < circuitsToReport.length; j++) {
      const c1 = circuitsToReport[i];
      const c2 = circuitsToReport[j];
      if (c1.bounds && c2.bounds && c1.bounds.isValid() && c2.bounds.isValid()) {
        const center1 = c1.bounds.getCenter();
        const center2 = c2.bounds.getCenter();
        const dist = Math.hypot((center2.lat - center1.lat) * 69.0, (center2.lng - center1.lng) * 52.0);
        if (dist <= 2.0) {
          overlappingPairs.push(`${c1.name} & ${c2.name}`);
        }
      }
    }
  }

  // Calculate nearest airports with distance and fuel status for each circuit
  const circuitAirportsList = circuitsToReport.map(c => {
    let center = (c.bounds && c.bounds.isValid()) ? c.bounds.getCenter() : { lat: avgLat, lng: avgLng };
    let aptDistances = Object.values(INDIANA_AIRPORTS).map(apt => {
      let d = calcDistanceMiles(center.lat, center.lng, apt.lat, apt.lng);
      return { ...apt, dist: d };
    }).sort((a, b) => a.dist - b.dist);

    return {
      circuitName: c.name,
      nearestAirport: aptDistances[0], // Nearest Jet-A airport
      allNearbyAirports: aptDistances.slice(0, 3) // Top 3 nearest airports
    };
  });

  // Calculate overall nearest fuel stops for the report package
  const overallNearestAirports = Object.values(INDIANA_AIRPORTS).map(apt => {
    let d = calcDistanceMiles(avgLat, avgLng, apt.lat, apt.lng);
    return { ...apt, dist: d };
  }).sort((a, b) => a.dist - b.dist).slice(0, 3);

  const opAreas = Array.from(opAreasSet).sort().join(', ') || 'N/A';
  const nowStr = new Date().toLocaleString();

  // Create Data Object
  const data = {
    circuitsToReport, totalMiles, totalSegments, opAreas, transitOutMi, totalTransitMi, trKnots, inspKnots, tTransitMins, tInspMins, totalMins, flightTimeStr, totFlightMiles, isMission, activeMissionObj, overlappingPairs, nowStr, reportFeatures, groupLats, groupLngs, avgLat, avgLng, circuitAirportsList, overallNearestAirports
  };

  let reportHtml = '';
  switch(reportStyle) {
      case 'executive':
          reportHtml = generateExecutiveReport(data);
          break;
      case 'operational':
          reportHtml = generateOperationalReport(data);
          break;
      case 'asset':
          reportHtml = generateAssetReport(data);
          break;
      case 'comparison':
          reportHtml = generateComparisonReport(data);
          break;
      case 'field':
          reportHtml = generateFieldReport(data);
          break;
      default:
          reportHtml = generateExecutiveReport(data);
  }

  const reportWin = window.open('', '_blank');
  if (reportWin) {
    reportWin.document.open();
    reportWin.document.write(reportHtml);
    reportWin.document.close();
  } else {
    alert('Pop-up blocked! Please allow pop-ups for this page to generate the PDF report.');
  }
}

function generateCommonHead(title, extraCss = '') {
    return `
    <head>
      <meta charset="UTF-8">
      <title>${title}</title>
      <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" crossorigin=""/>
      <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;600;700&display=swap" rel="stylesheet">
      <style>
        @page { size: letter portrait; margin: 0.4in; }
        body { font-family: 'Outfit', sans-serif; margin: 0; padding: 0; background: #fff; color: #1e293b; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        .print-btn { position: absolute; top: 15px; right: 15px; background: #cbd5e1; color: #0f172a; border: none; padding: 6px 12px; border-radius: 4px; cursor: pointer; font-family: inherit; font-size: 0.8rem; font-weight: 600; z-index: 1000; }
        .print-btn:hover { background: #94a3b8; }
        @media print { .print-btn { display: none !important; } }
        .report-map { width: 100%; background: #e2e8f0; border-radius: 8px; overflow: hidden; margin-bottom: 15px; position: relative; z-index: 1; border: 1px solid #cbd5e1; }
        .footer { margin-top: 20px; font-size: 0.75rem; color: #64748b; text-align: center; border-top: 1px solid #e2e8f0; padding-top: 10px; }
        ${extraCss}
      </style>
    </head>
    `;
}

function getLeafletScript(featuresDataStr) {
    return `
    <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js" crossorigin=""></script>
    <script>
      const featuresData = ${featuresDataStr};
      const map = L.map('report-map', { zoomControl: false, attributionControl: false }).setView([41.5, -87.0], 8);
      L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', { maxZoom: 19 }).addTo(map);

      const colorMap = { '765000': '#D500F9', '345000': '#E11D48', '138000': '#D97706', '69000': '#0284C7', '34000': '#16A34A', '34500': '#16A34A' };

      const geoJsonLayer = L.geoJSON({ type: 'FeatureCollection', features: featuresData }, {
        style: (feat) => {
          const v = feat.properties ? String(feat.properties.NOMINALVOLTAGE) : '';
          const c = colorMap[v] || '#9333EA';
          return { color: c, weight: 4.5, opacity: 0.95 };
        }
      }).addTo(map);

      function fitReportMapBounds() {
        map.invalidateSize();
        if (geoJsonLayer.getBounds().isValid()) {
          map.fitBounds(geoJsonLayer.getBounds(), { padding: [35, 35], animate: false });
        }
      }

      window.addEventListener('load', function() { setTimeout(fitReportMapBounds, 150); });
    </script>
    `;
}

// Style 1: Executive Summary
function generateExecutiveReport(d) {
    const css = `
        .container { padding: 20px; }
        .header { background: #0F172A; color: white; padding: 20px; border-radius: 8px; margin-bottom: 20px; position: relative; }
        .header h1 { margin: 0 0 5px 0; font-size: 1.8rem; }
        .header p { margin: 0; color: #94A3B8; font-size: 0.9rem; }
        .kpi-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 15px; margin-bottom: 20px; }
        .kpi-card { background: #fff; border: 1px solid #e2e8f0; border-left: 4px solid #0284C7; padding: 15px; border-radius: 6px; box-shadow: 0 1px 3px rgba(0,0,0,0.05); }
        .kpi-val { font-size: 1.5rem; font-weight: 700; color: #0F172A; }
        .kpi-lbl { font-size: 0.75rem; color: #64748b; text-transform: uppercase; letter-spacing: 0.05em; margin-top: 5px; }
        .report-map { height: 400px; }
        .mission-banner { background: #E0F2FE; border: 1px solid #BAE6FD; color: #0369A1; padding: 10px 15px; border-radius: 6px; margin-bottom: 20px; font-weight: 600; font-size: 0.9rem; display: flex; align-items: center; justify-content: space-between; }
        table { width: 100%; border-collapse: collapse; margin-top: 20px; font-size: 0.85rem; }
        th, td { padding: 8px 12px; text-align: left; border-bottom: 1px solid #e2e8f0; }
        th { background: #f8fafc; color: #475569; font-weight: 600; }
        .alert { background: #FEF3C7; border-left: 4px solid #D97706; padding: 10px; font-size: 0.8rem; margin-top: -10px; margin-bottom: 15px; color: #92400E; }
    `;

    let missionHtml = '';
    if (d.isMission) {
        missionHtml = `<div class="mission-banner">
            <span>Mission Active: ${d.activeMissionObj.title}</span>
            <span>Target: ${d.activeMissionObj.circuit_miles} mi</span>
        </div>`;
    }

    let alertHtml = '';
    if (d.overlappingPairs.length > 0) {
        alertHtml = `<div class="alert"><b>Notice:</b> Found co-located lines in selection (${d.overlappingPairs.join(', ')})</div>`;
    }

    let tbody = '';
    d.circuitsToReport.forEach(c => {
        let vLbl = c.voltage === 34000 ? '34.5 kV' : (c.voltage / 1000) + ' kV';
        let aptInfo = d.circuitAirportsList.find(a => a.circuitName === c.name);
        let nearestAptStr = aptInfo ? `🚁 <strong>${aptInfo.nearestAirport.code}</strong> (${aptInfo.nearestAirport.dist.toFixed(1)} mi) - Jet-A` : 'KVPZ Base';

        tbody += `<tr>
            <td><strong>${c.name}</strong></td>
            <td><span style="display:inline-block; padding:2px 6px; background:#e2e8f0; border-radius:4px; font-size:0.75rem;">${vLbl}</span></td>
            <td>${c.totalMiles.toFixed(1)} mi</td>
            <td><span style="color:#0284C7;">${nearestAptStr}</span></td>
        </tr>`;
    });

    return `<!DOCTYPE html><html>
    ${generateCommonHead('Executive Summary - Inspection Report', css)}
    <body>
        <div class="container">
            <div class="header">
                <h1>Inspection Executive Summary</h1>
                <p>Generated on ${d.nowStr}</p>
                <button class="print-btn" onclick="window.print()">Print Report</button>
            </div>
            ${missionHtml}
            <div class="kpi-grid">
                <div class="kpi-card"><div class="kpi-val">${d.circuitsToReport.length}</div><div class="kpi-lbl">Total Circuits</div></div>
                <div class="kpi-card"><div class="kpi-val">${d.totalMiles.toFixed(1)} mi</div><div class="kpi-lbl">Inspection Miles</div></div>
                <div class="kpi-card"><div class="kpi-val">${d.flightTimeStr}</div><div class="kpi-lbl">Total Flight Time</div></div>
                <div class="kpi-card"><div class="kpi-val">${d.inspKnots} kts</div><div class="kpi-lbl">Avg Speed</div></div>
            </div>
            <div id="report-map" class="report-map"></div>
            ${alertHtml}
            <table>
                <thead><tr><th>Circuit Name</th><th>Voltage</th><th>Distance</th><th>Nearest Jet-A Airport</th></tr></thead>
                <tbody>${tbody}</tbody>
            </table>
            <div class="footer">Confidential & Proprietary &bull; ${d.nowStr}</div>
        </div>
        ${getLeafletScript(JSON.stringify(d.reportFeatures))}
    </body></html>`;
}

// Style 2: Operational Flight Brief
function generateOperationalReport(d) {
    const css = `
        .container { padding: 15px; }
        .header { background: #1e293b; color: white; padding: 15px; border-top: 6px solid #D97706; position: relative; }
        .header h1 { margin: 0; font-size: 1.6rem; letter-spacing: 0.05em; text-transform: uppercase; }
        .header p { margin: 5px 0 0 0; color: #cbd5e1; font-size: 0.8rem; }
        .flight-grid { display: grid; grid-template-columns: repeat(3, 1fr); border: 2px solid #1e293b; margin: 15px 0; background: #f8fafc; }
        .grid-cell { padding: 10px; border: 1px solid #cbd5e1; }
        .grid-label { font-size: 0.65rem; color: #475569; text-transform: uppercase; font-weight: 700; margin-bottom: 4px; }
        .grid-value { font-size: 1.1rem; font-weight: 700; color: #0f172a; }
        .report-map { height: 350px; border: 2px solid #1e293b; border-radius: 0; }
        .section-title { background: #e2e8f0; padding: 8px; font-weight: 700; font-size: 0.85rem; text-transform: uppercase; border-left: 4px solid #1e293b; margin: 15px 0 10px 0; }
        table { width: 100%; border-collapse: collapse; font-size: 0.8rem; }
        th, td { padding: 6px; text-align: left; border: 1px solid #cbd5e1; }
        th { background: #f1f5f9; }
        .fuel-box { border: 2px solid #D97706; padding: 10px; background: #FFFBEB; font-size: 0.85rem; margin-top: 15px; }
    `;

    let tbody = '';
    d.circuitsToReport.forEach(c => {
        let center = c.bounds && c.bounds.isValid() ? c.bounds.getCenter() : {lat: 0, lng: 0};
        let aptInfo = d.circuitAirportsList.find(a => a.circuitName === c.name);
        let nearestAptStr = aptInfo ? `🚁 ${aptInfo.nearestAirport.code} (${aptInfo.nearestAirport.dist.toFixed(1)} mi)` : 'KVPZ Base';

        tbody += `<tr>
            <td><strong>${c.name}</strong></td>
            <td>${(c.voltage/1000).toFixed(1)} kV</td>
            <td>${c.totalMiles.toFixed(1)} mi</td>
            <td style="font-family: monospace;">N${center.lat.toFixed(4)} W${Math.abs(center.lng).toFixed(4)}</td>
            <td style="color:#D97706; font-weight:600;">${nearestAptStr}</td>
        </tr>`;
    });

    const totalTimeHours = d.totalMins / 60; // using derived variable logic
    const tMins = d.tTransitMins + d.tInspMins;
    const estFuel = (tMins / 60) * 25;

    let nearestAirportsSummary = d.overallNearestAirports.map(a => `<li><strong>${a.code}</strong> (${a.name}) - <strong>${a.dist.toFixed(1)} mi</strong> away (Jet-A Fuel)</li>`).join('');

    return `<!DOCTYPE html><html>
    ${generateCommonHead('Operational Flight Brief', css)}
    <body>
        <div class="container">
            <div class="header">
                <h1>Operational Flight Brief</h1>
                <p>Date: ${d.nowStr} | Departure: KVPZ</p>
                <button class="print-btn" onclick="window.print()">Print Report</button>
            </div>
            
            <div class="section-title">Mission Profile</div>
            <div class="flight-grid">
                <div class="grid-cell"><div class="grid-label">Departure</div><div class="grid-value">KVPZ</div></div>
                <div class="grid-cell"><div class="grid-label">Transit Speed</div><div class="grid-value">${d.trKnots} kts</div></div>
                <div class="grid-cell"><div class="grid-label">Inspection Speed</div><div class="grid-value">${d.inspKnots} kts</div></div>
                
                <div class="grid-cell"><div class="grid-label">Outbound Dist</div><div class="grid-value">${(d.totalTransitMi/2).toFixed(1)} mi</div></div>
                <div class="grid-cell"><div class="grid-label">Return Dist</div><div class="grid-value">${(d.totalTransitMi/2).toFixed(1)} mi</div></div>
                <div class="grid-cell"><div class="grid-label">Inspection Dist</div><div class="grid-value">${d.totalMiles.toFixed(1)} mi</div></div>
                
                <div class="grid-cell"><div class="grid-label">Outbound Time</div><div class="grid-value">${Math.round(d.tTransitMins/2)} mins</div></div>
                <div class="grid-cell"><div class="grid-label">Return Time</div><div class="grid-value">${Math.round(d.tTransitMins/2)} mins</div></div>
                <div class="grid-cell"><div class="grid-label">Inspection Time</div><div class="grid-value">${Math.round(d.tInspMins)} mins</div></div>

                <div class="grid-cell" style="grid-column: span 3; background:#e2e8f0; text-align:center;"><div class="grid-label">Total Mission Time</div><div class="grid-value">${d.flightTimeStr}</div></div>
            </div>

            <div style="font-size: 0.8rem; color: #b91c1c; font-weight: 600; margin-bottom: 15px;">
                NOTE: Check current METAR/TAF for KVPZ before departure.
            </div>

            <div id="report-map" class="report-map" style="position: relative;">
                <div style="position: absolute; top: 10px; left: 10px; z-index: 400; background: rgba(255,255,255,0.8); padding: 5px; border: 1px solid #000; font-weight: bold;">North &uarr;</div>
            </div>

            <div class="section-title">Circuit Waypoints & Nearest Refueling Airports</div>
            <table>
                <thead><tr><th>Circuit</th><th>Voltage</th><th>Distance</th><th>Centroid Coordinates</th><th>Nearest Jet-A Airport</th></tr></thead>
                <tbody>${tbody}</tbody>
            </table>

            <div class="fuel-box">
                <strong>Fuel & Diversion Planning:</strong><br>
                Estimated fuel burn at 25 gal/hr is <strong>${estFuel.toFixed(1)} gallons</strong> (excluding 45-min VFR reserves).<br>
                <div style="margin-top: 6px;"><strong>Nearest Emergency / Refueling Diversion Airports:</strong></div>
                <ul style="margin: 4px 0 0 18px; padding: 0; font-size: 0.8rem;">
                    ${nearestAirportsSummary}
                </ul>
            </div>
            <div class="footer">Operational Use Only &bull; ${d.nowStr}</div>
        </div>
        ${getLeafletScript(JSON.stringify(d.reportFeatures))}
    </body></html>`;
}

// Style 3: Asset Inventory
function generateAssetReport(d) {
    const css = `
        .container { padding: 20px; background: #f8fafc; min-height: 100vh; }
        .header { margin-bottom: 20px; border-bottom: 2px solid #cbd5e1; padding-bottom: 10px; position: relative; }
        .header h1 { margin: 0 0 5px 0; font-size: 1.8rem; color: #0f172a; }
        .header p { margin: 0; color: #475569; font-size: 0.85rem; }
        .map-wrapper { height: 250px; margin-bottom: 20px; border: 1px solid #cbd5e1; background: #fff; padding: 4px; }
        .report-map { height: 100%; margin: 0; }
        .voltage-section { margin-bottom: 20px; background: #fff; padding: 15px; border-radius: 6px; border: 1px solid #e2e8f0; }
        .v-header { font-size: 1.1rem; font-weight: 700; margin-bottom: 10px; padding-bottom: 5px; border-bottom: 2px solid; }
        table { width: 100%; border-collapse: collapse; font-size: 0.8rem; }
        th, td { padding: 6px 10px; text-align: left; border-bottom: 1px solid #f1f5f9; }
        th { color: #64748b; font-weight: 600; text-transform: uppercase; font-size: 0.7rem; }
        .pie-chart-container { display: flex; align-items: center; gap: 20px; background: #fff; padding: 15px; border: 1px solid #e2e8f0; border-radius: 6px; margin-bottom: 20px; }
        .pie-chart { width: 100px; height: 100px; border-radius: 50%; }
        .pie-legend { display: flex; flex-direction: column; gap: 5px; font-size: 0.8rem; }
        .legend-item { display: flex; align-items: center; gap: 8px; }
        .legend-color { width: 12px; height: 12px; border-radius: 2px; }
        .stats-section { display: flex; gap: 15px; margin-bottom: 20px; }
        .stat-box { flex: 1; background: #fff; border: 1px solid #e2e8f0; padding: 10px; border-radius: 6px; font-size: 0.8rem; }
        .stat-box h4 { margin: 0 0 5px 0; color: #0f172a; font-size: 0.85rem; }
    `;

    const byVoltage = {};
    d.circuitsToReport.forEach(c => {
        if(!byVoltage[c.voltage]) byVoltage[c.voltage] = [];
        byVoltage[c.voltage].push(c);
    });

    const vColors = { '765000': '#D500F9', '345000': '#E11D48', '138000': '#D97706', '69000': '#0284C7', '34000': '#16A34A' };
    
    let conicParts = [];
    let cumulativePct = 0;
    let legendHtml = '';
    let sectionsHtml = '';

    const sortedVoltages = Object.keys(byVoltage).sort((a,b) => b - a);
    sortedVoltages.forEach(v => {
        const circuits = byVoltage[v];
        const vMiles = circuits.reduce((sum, c) => sum + c.totalMiles, 0);
        const vColor = vColors[v] || '#9333EA';
        const vPct = (vMiles / d.totalMiles) * 100;
        
        conicParts.push(`${vColor} ${cumulativePct}% ${cumulativePct + vPct}%`);
        cumulativePct += vPct;

        legendHtml += `<div class="legend-item"><div class="legend-color" style="background:${vColor}"></div><span>${v/1000} kV - ${circuits.length} circuits (${vMiles.toFixed(1)} mi)</span></div>`;

        let vTbody = '';
        circuits.forEach(c => {
            vTbody += `<tr>
                <td>${c.name}</td>
                <td>${v === '34000' ? '34.5 kV' : (v/1000)+' kV'}</td>
                <td>${c.totalMiles.toFixed(2)} mi</td>
                <td>${c.segmentCount}</td>
            </tr>`;
        });

        sectionsHtml += `
        <div class="voltage-section">
            <div class="v-header" style="border-bottom-color: ${vColor}; color: ${vColor}">${v/1000} kV Class Assets</div>
            <div style="font-size: 0.8rem; color: #475569; margin-bottom: 10px;">
                <strong>Count:</strong> ${circuits.length} | <strong>Total Miles:</strong> ${vMiles.toFixed(1)} | <strong>Avg Segment Length:</strong> ${(vMiles/circuits.reduce((sum,c)=>sum+c.segmentCount,0)).toFixed(2)} mi
            </div>
            <table>
                <thead><tr><th>Circuit Name</th><th>Voltage</th><th>Miles</th><th>Segments</th></tr></thead>
                <tbody>${vTbody}</tbody>
            </table>
        </div>`;
    });

    const pieGradient = `conic-gradient(${conicParts.join(', ')})`;

    // Calculate segment density
    let mostSegs = d.circuitsToReport.sort((a,b) => b.segmentCount - a.segmentCount)[0];
    let longest = d.circuitsToReport.sort((a,b) => b.totalMiles - a.totalMiles)[0];
    let shortest = d.circuitsToReport.sort((a,b) => a.totalMiles - b.totalMiles)[0];

    return `<!DOCTYPE html><html>
    ${generateCommonHead('Asset Inventory Report', css)}
    <body style="background: #f1f5f9;">
        <div class="container">
            <div class="header">
                <h1>Engineering Asset Inventory</h1>
                <p>Detailed Circuit Extents &bull; Generated ${d.nowStr}</p>
                <button class="print-btn" onclick="window.print()">Print Report</button>
            </div>

            <div class="pie-chart-container">
                <div class="pie-chart" style="background: ${pieGradient}"></div>
                <div class="pie-legend">${legendHtml}</div>
                <div style="margin-left: auto; text-align: right;">
                    <div style="font-size: 1.5rem; font-weight: 700;">${d.totalSegments}</div>
                    <div style="font-size: 0.75rem; color: #64748b; text-transform: uppercase;">Total Segments</div>
                </div>
            </div>

            <div class="stats-section">
                <div class="stat-box"><h4>Circuit with Most Segments</h4>${mostSegs ? `${mostSegs.name} (${mostSegs.segmentCount} segments)` : 'N/A'}</div>
                <div class="stat-box"><h4>Longest Circuit</h4>${longest ? `${longest.name} (${longest.totalMiles.toFixed(1)} mi)` : 'N/A'}</div>
                <div class="stat-box"><h4>Shortest Circuit</h4>${shortest ? `${shortest.name} (${shortest.totalMiles.toFixed(1)} mi)` : 'N/A'}</div>
            </div>

            <div class="map-wrapper">
                <div id="report-map" class="report-map"></div>
            </div>

            ${sectionsHtml}

            <div class="footer">Asset Management Records &bull; ${d.nowStr}</div>
        </div>
        ${getLeafletScript(JSON.stringify(d.reportFeatures))}
    </body></html>`;
}

// Style 4: Mission Comparison
function generateComparisonReport(d) {
    const css = `
        .container { padding: 20px; }
        .header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #e2e8f0; padding-bottom: 15px; margin-bottom: 20px; }
        .header-titles h1 { margin: 0 0 5px 0; font-size: 1.6rem; }
        .header-titles p { margin: 0; color: #64748b; font-size: 0.85rem; }
        .split-layout { display: flex; gap: 20px; margin-bottom: 20px; }
        .col { flex: 1; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 15px; }
        .col-title { font-size: 1rem; font-weight: 700; margin-bottom: 15px; padding-bottom: 8px; border-bottom: 1px solid #cbd5e1; }
        .metric-row { display: flex; justify-content: space-between; margin-bottom: 12px; font-size: 0.9rem; border-bottom: 1px dashed #e2e8f0; padding-bottom: 5px; }
        .metric-label { color: #475569; }
        .metric-val { font-weight: 600; }
        .status-good { color: #16A34A; }
        .status-warn { color: #D97706; }
        .report-map { height: 300px; margin-bottom: 20px; }
        .compact-list { column-count: 2; column-gap: 20px; font-size: 0.8rem; }
        .list-item { break-inside: avoid; border-bottom: 1px dashed #cbd5e1; padding: 4px 0; display: flex; justify-content: space-between; }
        .risk-section { background: #FEF2F2; border: 1px solid #FCA5A5; padding: 15px; border-radius: 6px; margin-bottom: 20px; }
        .risk-title { color: #991B1B; font-weight: 700; margin-bottom: 10px; font-size: 0.9rem; text-transform: uppercase; }
    `;

    let comparisonHtml = '';
    
    // Bounds width/height for geographic spread
    let minLat=90, maxLat=-90, minLng=180, maxLng=-180;
    d.circuitsToReport.forEach(c => {
        if(c.bounds && c.bounds.isValid()) {
            minLat = Math.min(minLat, c.bounds.getSouth());
            maxLat = Math.max(maxLat, c.bounds.getNorth());
            minLng = Math.min(minLng, c.bounds.getWest());
            maxLng = Math.max(maxLng, c.bounds.getEast());
        }
    });
    // Need calcDistanceMiles if it exists... wait, it's globally defined in app.js.
    // The report page runs in its own context, so it won't have calcDistanceMiles unless injected, but we do the math before generating!
    // BUT spreadMi is calculated HERE, in the parent context. So calcDistanceMiles IS available here!
    
    // Let's compute spreadMi here:
    let spreadMi = 0;
    if (minLat !== 90 && typeof calcDistanceMiles === 'function') {
        spreadMi = calcDistanceMiles(minLat, minLng, maxLat, maxLng);
    }

    let longestCirc = d.circuitsToReport.length > 0 ? d.circuitsToReport.reduce((max, c) => c.totalMiles > max.totalMiles ? c : max) : {name: 'N/A', totalMiles: 0};
    
    let farthest = {name: 'N/A', dist: 0};
    d.circuitsToReport.forEach(c => {
        if(c.bounds && c.bounds.isValid()) {
            let center = c.bounds.getCenter();
            if (typeof calcDistanceMiles === 'function') {
                let d2 = calcDistanceMiles(41.4538, -87.0072, center.lat, center.lng);
                if(d2 > farthest.dist) { farthest = {name: c.name, dist: d2}; }
            }
        }
    });

    if (d.isMission) {
        const m = d.activeMissionObj;
        const milesDiff = d.totalMiles - m.circuit_miles;
        const milesColor = milesDiff > 0 ? (milesDiff > 10 ? 'status-warn' : 'status-good') : 'status-warn';
        
        comparisonHtml = `
        <div class="split-layout">
            <div class="col">
                <div class="col-title">Mission Package Parameters</div>
                <div class="metric-row"><span class="metric-label">Target Distance</span><span class="metric-val">${m.circuit_miles} mi</span></div>
                <div class="metric-row"><span class="metric-label">Est. Flight Time</span><span class="metric-val">${m.flight_time_str}</span></div>
                <div class="metric-row"><span class="metric-label">Voltage Tier</span><span class="metric-val" style="font-size:0.8rem;">${m.kv_label}</span></div>
            </div>
            <div class="col">
                <div class="col-title">Actual Selected</div>
                <div class="metric-row"><span class="metric-label">Total Distance</span><span class="metric-val ${milesColor}">${d.totalMiles.toFixed(1)} mi (${milesDiff > 0 ? '+' : ''}${milesDiff.toFixed(1)})</span></div>
                <div class="metric-row"><span class="metric-label">Est Flight Time</span><span class="metric-val">${d.flightTimeStr}</span></div>
                <div class="metric-row"><span class="metric-label">Circuit Count</span><span class="metric-val">${d.circuitsToReport.length}</span></div>
                <div class="metric-row"><span class="metric-label">Transit Distance</span><span class="metric-val">${d.totalTransitMi.toFixed(1)} mi</span></div>
            </div>
        </div>`;
    } else {
        comparisonHtml = `
        <div class="split-layout">
            <div class="col">
                <div class="col-title">Selection Analysis</div>
                <div class="metric-row"><span class="metric-label">Circuit Count</span><span class="metric-val">${d.circuitsToReport.length}</span></div>
                <div class="metric-row"><span class="metric-label">Total Miles</span><span class="metric-val">${d.totalMiles.toFixed(1)} mi</span></div>
                <div class="metric-row"><span class="metric-label">Flight Time</span><span class="metric-val">${d.flightTimeStr}</span></div>
                <div class="metric-row"><span class="metric-label">Transit Distance</span><span class="metric-val">${d.totalTransitMi.toFixed(1)} mi</span></div>
            </div>
        </div>`;
    }

    let listHtml = '';
    d.circuitsToReport.forEach((c, idx) => {
        listHtml += `<div class="list-item"><span>${idx+1}. ${c.name}</span><span>${c.totalMiles.toFixed(1)} mi</span></div>`;
    });

    return `<!DOCTYPE html><html>
    ${generateCommonHead('Mission Comparison Report', css)}
    <body>
        <div class="container">
            <button class="print-btn" onclick="window.print()">Print Report</button>
            <div class="header">
                <div class="header-titles">
                    <h1>Mission Optimization Review</h1>
                    <p>Comparison generated on ${d.nowStr}</p>
                </div>
            </div>
            
            ${comparisonHtml}
            
            <div class="risk-section">
                <div class="risk-title">Risk & Efficiency Indicators</div>
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px; font-size: 0.85rem;">
                    <div><strong>Co-located Pairs:</strong> ${d.overlappingPairs.length > 0 ? d.overlappingPairs.length : 'None'}</div>
                    <div><strong>Geographic Spread (Max Span):</strong> ${spreadMi.toFixed(1)} mi</div>
                    <div><strong>Longest Single Circuit:</strong> ${longestCirc.name} (${longestCirc.totalMiles.toFixed(1)} mi)</div>
                    <div><strong>Farthest Circuit from KVPZ:</strong> ${farthest.name} (${farthest.dist.toFixed(1)} mi)</div>
                    <div><strong>Miles per circuit:</strong> ${(d.totalMiles / (d.circuitsToReport.length||1)).toFixed(1)} mi</div>
                    <div><strong>Minutes per mile:</strong> ${(d.totalMins / (d.totalMiles||1)).toFixed(1)} min/mi</div>
                </div>
            </div>

            <div id="report-map" class="report-map"></div>

            <h3 style="font-size:1rem; border-bottom:1px solid #cbd5e1; padding-bottom:5px; margin-bottom:10px;">Selected Circuits List</h3>
            <div class="compact-list">
                ${listHtml}
            </div>

            <div class="footer">Planning & Analysis &bull; ${d.nowStr}</div>
        </div>
        ${getLeafletScript(JSON.stringify(d.reportFeatures))}
    </body></html>`;
}

// Style 5: Field Reference Card
function generateFieldReport(d) {
    const css = `
        .container { padding: 10px; max-width: 100%; box-sizing: border-box; }
        .header { display: flex; justify-content: space-between; align-items: center; border-bottom: 3px solid #0284C7; padding-bottom: 8px; margin-bottom: 12px; }
        .title-block { font-family: monospace; font-size: 1.2rem; font-weight: 700; }
        .meta-tags { display: flex; gap: 8px; }
        .tag { background: #000; color: #fff; padding: 2px 6px; font-size: 0.7rem; font-family: monospace; border-radius: 2px; }
        .report-map { height: 50vh; border: 2px solid #000; border-radius: 0; margin-bottom: 12px; }
        .info-strip { display: flex; background: #f1f5f9; border: 1px solid #cbd5e1; font-family: monospace; font-size: 0.85rem; margin-bottom: 12px; }
        .strip-item { flex: 1; padding: 8px; border-right: 1px solid #cbd5e1; text-align: center; }
        .strip-item:last-child { border-right: none; }
        .strip-lbl { font-size: 0.65rem; color: #64748b; text-transform: uppercase; margin-bottom: 2px; }
        .strip-val { font-weight: 700; color: #000; }
        .card-content { display: flex; gap: 15px; }
        .circuit-col { flex: 2; column-count: 2; column-gap: 15px; font-size: 0.75rem; font-family: monospace; }
        .c-row { display: flex; justify-content: space-between; border-bottom: 1px dotted #94a3b8; padding: 3px 0; break-inside: avoid; }
        .note-col { flex: 1; border: 1px solid #000; padding: 8px; font-size: 0.7rem; font-family: monospace; background: #fff; }
        .qr-mock { margin-top: 10px; background: #000; color: #fff; padding: 10px; text-align: center; font-size: 0.8rem; font-weight: 700; letter-spacing: 2px; border-radius: 4px; }
    `;

    let cRows = '';
    d.circuitsToReport.forEach(c => {
        cRows += `<div class="c-row"><span>${c.name}</span><strong>${c.totalMiles.toFixed(1)}m</strong></div>`;
    });

    let mId = d.isMission ? `MSN-${d.activeMissionObj.id.toUpperCase()}` : 'ADHOC-FLIGHT';
    let overlapNote = d.overlappingPairs.length > 0 ? `<br><br><b style="color:#991B1B;">CO-LOCATED LINES:</b><br>${d.overlappingPairs.join('<br>')}` : '';
    
    // Condensed operating areas as tags
    let opAreaTags = d.opAreas.split(', ').map(a => `<span style="background:#e2e8f0; padding:1px 4px; border-radius:2px; margin-right:4px; display:inline-block; margin-bottom:4px;">${a}</span>`).join('');

    let nearestAptNote = d.overallNearestAirports.length > 0 ? `<br><br><b style="color:#0284C7;">NEAREST JET-A REFUEL:</b><br>${d.overallNearestAirports[0].code} (${d.overallNearestAirports[0].dist.toFixed(1)} mi)` : '';

    return `<!DOCTYPE html><html>
    ${generateCommonHead('Field Reference Card', css)}
    <body>
        <div class="container">
            <button class="print-btn" onclick="window.print()">Print Report</button>
            <div class="header">
                <div class="title-block">${mId}</div>
                <div class="meta-tags">
                    <div class="tag">TIER:${(d.circuitsToReport[0] && d.circuitsToReport[0].voltage ? d.circuitsToReport[0].voltage/1000 : 'MIX')}KV</div>
                    <div class="tag">DATE:${new Date().toISOString().split('T')[0]}</div>
                </div>
            </div>
            
            <div id="report-map" class="report-map"></div>

            <div class="info-strip">
                <div class="strip-item"><div class="strip-lbl">Mission ID</div><div class="strip-val">${mId}</div></div>
                <div class="strip-item"><div class="strip-lbl">Circuits</div><div class="strip-val">${d.circuitsToReport.length}</div></div>
                <div class="strip-item"><div class="strip-lbl">Miles</div><div class="strip-val">${d.totalMiles.toFixed(1)}</div></div>
                <div class="strip-item"><div class="strip-lbl">Flight Time</div><div class="strip-val">${d.flightTimeStr}</div></div>
            </div>

            <div class="card-content">
                <div class="circuit-col">
                    ${cRows}
                </div>
                <div class="note-col">
                    <div style="font-weight:700; margin-bottom:5px; font-size:0.8rem;">OPERATING AREAS</div>
                    ${opAreaTags}
                    ${nearestAptNote}
                    ${overlapNote}
                    <div class="qr-mock">${mId}<br><span style="font-size:0.6rem; font-weight:normal;">${d.nowStr}</span></div>
                </div>
            </div>
        </div>
        ${getLeafletScript(JSON.stringify(d.reportFeatures))}
    </body></html>`;
}


function initCollapsibleCards() {
  const collapsibleHeaders = document.querySelectorAll('.collapsible-header');
  collapsibleHeaders.forEach(header => {
    header.addEventListener('click', (e) => {
      // Ignore click if user clicked an interactive control inside header (e.g. Sync button, Briefing button)
      if (e.target.closest('button') || e.target.closest('select') || e.target.closest('input')) {
        return;
      }
      const card = header.closest('.collapsible-card');
      if (card) {
        card.classList.toggle('collapsed');
      }
    });
  });
}

// Event Listeners
function setupEventListeners() {
  initCollapsibleCards();

  const tabBtns = document.querySelectorAll('.sidebar-tabs .tab-btn');
  tabBtns.forEach(btn => {
    btn.addEventListener('click', (e) => {
      const targetTab = e.currentTarget.getAttribute('data-tab');
      tabBtns.forEach(b => b.classList.remove('active'));
      e.currentTarget.classList.add('active');

      // Scroll active tab into view if container overflows horizontally
      e.currentTarget.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });

      document.querySelectorAll('.tab-content').forEach(tc => tc.classList.remove('active'));
      document.getElementById(targetTab).classList.add('active');

      if (targetTab === 'tab-planner' && typeof syncSelectedGroupToFlightPlan === 'function') {
        syncSelectedGroupToFlightPlan(true);
      } else if (targetTab === 'tab-weather') {
        populateWeatherUI();
      }
    });
  });

  const weatherSelect = document.getElementById('weather-airport-select');
  if (weatherSelect) {
    weatherSelect.addEventListener('change', (e) => {
      state.activeWeatherStation = e.target.value;
      populateWeatherUI();
    });
  }

  const btnRefreshWeather = document.getElementById('btn-refresh-weather');
  if (btnRefreshWeather) {
    btnRefreshWeather.addEventListener('click', () => {
      populateWeatherUI(true);
    });
  }

  document.getElementById('circuit-sort-select').addEventListener('change', (e) => {
    state.sortMode = e.target.value;
    filterAndSortCircuits();
  });

  // Mission Packages Select Dropdown Listener
  document.getElementById('mission-packages-select').addEventListener('change', (e) => {
    const val = e.target.value;
    if (val) {
      selectMissionPackageById(val);
    } else {
      state.activeMission = null;
      document.getElementById('mission-detail-card').classList.add('hidden');
    }
  });

  document.getElementById('btn-select-mission-circuits').addEventListener('click', () => {
    if (state.activeMission) {
      state.selectedGroup.clear();
      state.activeMission.circuit_names.forEach(name => state.selectedGroup.add(name));
      updateGroupHighlightMap();
      updateGroupSelectionToolbarUI();
      renderCircuitListUI();
    }
  });

  document.getElementById('btn-zoom-mission').addEventListener('click', zoomToGroupBounds);

  document.getElementById('btn-clear-mission').addEventListener('click', () => {
    state.activeMission = null;
    document.getElementById('mission-detail-card').classList.add('hidden');
    const select = document.getElementById('mission-packages-select');
    if (select) select.value = '';
    state.selectedGroup.clear();
    updateGroupHighlightMap();
    updateGroupSelectionToolbarUI();
    renderCircuitListUI();
  });

  const searchInput = document.getElementById('circuit-search-input');
  const btnClearSearch = document.getElementById('btn-clear-search');

  searchInput.addEventListener('input', (e) => {
    state.searchQuery = e.target.value.trim();
    btnClearSearch.style.display = state.searchQuery ? 'block' : 'none';
    filterAndSortCircuits();
    renderGridLines();
  });

  btnClearSearch.addEventListener('click', () => {
    searchInput.value = '';
    state.searchQuery = '';
    btnClearSearch.style.display = 'none';
    filterAndSortCircuits();
    renderGridLines();
  });

  document.getElementById('btn-select-all-visible').addEventListener('click', () => {
    state.filteredCircuits.forEach(c => state.selectedGroup.add(c.name));
    syncSelectedGroupToFlightPlan();
  });

  document.getElementById('btn-clear-group').addEventListener('click', () => {
    state.selectedGroup.clear();
    syncSelectedGroupToFlightPlan();
  });

  document.getElementById('btn-zoom-group').addEventListener('click', zoomToGroupBounds);

  // PDF Report Generation Buttons
  document.getElementById('btn-export-pdf').addEventListener('click', generatePdfReport);
  document.getElementById('btn-export-pdf-bar').addEventListener('click', generatePdfReport);

  // Reassign Circuit Segment Save Button
  document.getElementById('btn-save-reassign').addEventListener('click', reassignSelectedSegmentCircuit);

  const sidebar = document.getElementById('sidebar');
  document.getElementById('btn-toggle-sidebar').addEventListener('click', () => {
    sidebar.classList.toggle('collapsed');
  });

  document.getElementById('btn-reset-view').addEventListener('click', () => {
    state.map.flyTo([40.75, -86.20], 8);
  });

  document.getElementById('btn-toggle-all-voltage').addEventListener('click', () => {
    const checkboxes = document.querySelectorAll('.voltage-filter-list input[type="checkbox"]');
    const allChecked = Array.from(checkboxes).every(c => c.checked);

    checkboxes.forEach(c => {
      c.checked = !allChecked;
      if (!allChecked) state.activeVoltages.add(c.value);
      else state.activeVoltages.delete(c.value);
    });

    filterAndSortCircuits();
    renderGridLines();
    saveFiltersAndMapPreferences();
  });

  const basemapBtns = document.querySelectorAll('.basemap-btn');
  basemapBtns.forEach(btn => {
    btn.addEventListener('click', (e) => {
      const type = e.currentTarget.getAttribute('data-basemap');
      basemapBtns.forEach(b => b.classList.remove('active'));
      e.currentTarget.classList.add('active');

      state.activeBasemap = type;
      Object.values(state.basemaps).forEach(layer => state.map.removeLayer(layer));
      if (state.basemaps[type]) state.basemaps[type].addTo(state.map);
      saveFiltersAndMapPreferences();
    });
  });

  // Toggle Map Airports (On/Off)
  const toggleAirportsEl = document.getElementById('toggle-show-airports');
  if (toggleAirportsEl) {
    toggleAirportsEl.addEventListener('change', (e) => {
      state.flightPlanner.showAirports = e.target.checked;
      renderIndianaAirportsLayer();
      recalculateFlightPlan();
      saveFiltersAndMapPreferences();
      showToast(e.target.checked ? '🚁 Map Airports Layer Enabled' : '🚁 Map Airports Layer Hidden');
    });
  }

  // Toggle Airport Labels (Full Badges vs Dot Markers)
  const toggleLabelsEl = document.getElementById('toggle-airport-labels');
  if (toggleLabelsEl) {
    toggleLabelsEl.addEventListener('change', (e) => {
      state.flightPlanner.showAirportLabels = e.target.checked;
      renderIndianaAirportsLayer();
      recalculateFlightPlan();
      saveFiltersAndMapPreferences();
    });
  }

  // Toggle Fuel Prices Display
  const togglePricesEl = document.getElementById('toggle-show-fuel-prices');
  if (togglePricesEl) {
    togglePricesEl.addEventListener('change', (e) => {
      state.flightPlanner.showFuelPrices = e.target.checked;
      renderIndianaAirportsLayer();
      recalculateFlightPlan();
      saveFiltersAndMapPreferences();
      showToast(e.target.checked ? '⛽ Jet-A Prices Shown on Airport Badges' : '⛽ Jet-A Prices Hidden');
    });
  }

  // Force fetch live fuel prices
  const fetchFuelBtn = document.getElementById('btn-force-fetch-fuel');
  if (fetchFuelBtn) {
    fetchFuelBtn.addEventListener('click', async () => {
      state.globalFuelPrices = null; // clear memory cache
      localStorage.removeItem('gh_fuel_prices_cache'); // clear local storage cache

      showToast('⚡ Running live AirNav scraper (22 airports)...');
      try {
        const res = await fetch('/api/fetch-fuel', { method: 'POST' });
        if (res.ok) {
          showToast('✅ Live Jet-A prices updated from AirNav!');
        } else {
          showToast('Updated local cache from fuel_prices.json');
        }
      } catch (err) {
        showToast('Updated local cache from fuel_prices.json');
      }
      await renderIndianaAirportsLayer();
    });
  }

  document.getElementById('btn-close-drawer').addEventListener('click', () => {
    document.getElementById('inspector-drawer').classList.add('hidden');
    state.selectedGroup.clear();
    updateGroupHighlightMap();
    renderCircuitListUI();
  });

  document.getElementById('btn-zoom-to-line').addEventListener('click', zoomToGroupBounds);
}

state.weatherCache = {};
state.fuelPriceCache = {};
state.activeWeatherStation = 'ALL';
state.weatherTimer = null;

// Verified Jet-A prices from AirNav reported FBO listings
const JET_A_BASELINES = {
  'KVPZ': 6.00, // Porter County Regional ($6.00 Full)
  'KGYY': 5.99, // Gary / B. Coleman ($5.99 Full - Cheapest FS FBO; Gary Jet Center is $6.06)
  'KSBN': 7.02, // South Bend / Signature ($7.02 Full)
  'KPPO': 5.75, // La Porte Municipal
  'KMGC': 5.64, // Michigan City Municipal ($5.64 Full)
  'KRZL': 4.99, // Jasper County / Rensselaer ($4.99 Full / $4.49 Self)
  'KMCX': 5.80, // White County / Monticello ($5.80 Self)
  'KOXI': 4.49, // Starke County / Knox ($4.49 Self)
  'KRWN': 5.25, // Arens Field / Winamac
  'KRCR': 5.50, // Fulton County / Rochester
  'KASW': 5.85, // Warsaw Municipal
  'KGSH': 5.95, // Goshen Municipal
  'KEKM': 6.05, // Elkhart Municipal
  'KANQ': 6.10, // Tri-State Steuben County
  'KGWB': 5.90, // DeKalb County / Auburn
  'KSMD': 6.25, // Smith Field / Fort Wayne
  'KFWA': 7.29, // Fort Wayne Aero Center ($7.29 Full)
  'KHHG': 5.65, // Huntington Municipal
  'KIWH': 5.50, // Wabash Municipal
  'KGGP': 5.45, // Logansport Cass County
  'KLAF': 6.85, // Purdue University / Lafayette ($6.85 Full)
  'KFKR': 5.55, // Frankfort Clinton County
  'C65': 5.25   // Plymouth Municipal Airport
};

// Fetch Jet-A fuel prices from automated GitHub Action JSON (1x per day / 24-hour localStorage cache)
async function fetchAirNavFuelPrice(stationCode) {
  if (!stationCode) return null;
  const icao = stationCode.toUpperCase();
  const cacheKey = `gh_fuel_prices_cache`;
  const ONE_DAY_MS = 86400000; // 24 Hours

  let allPrices = null;

  // Check state cache first
  if (state.globalFuelPrices && (Date.now() - state.globalFuelPrices.timestamp < ONE_DAY_MS)) {
    allPrices = state.globalFuelPrices;
  }

  // Check localStorage if not in memory
  if (!allPrices) {
    try {
      const stored = localStorage.getItem(cacheKey);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Date.now() - parsed.timestamp < ONE_DAY_MS) {
          allPrices = parsed;
          state.globalFuelPrices = parsed;
        }
      }
    } catch (e) {}
  }

  // Fetch from JSON if no valid cache
  if (!allPrices) {
    try {
      // Use cache bursting query param for the fetch to avoid browser cache
      const res = await fetch(`./fuel_prices.json?t=${Date.now()}`);
      if (res.ok) {
        const data = await res.json();
        // data format: { timestamp: 123456789, prices: { "KVPZ": 6.00, ... } }
        allPrices = { timestamp: Date.now(), prices: data.prices };
        state.globalFuelPrices = allPrices;
        try {
          localStorage.setItem(cacheKey, JSON.stringify(allPrices));
        } catch (e) {}
      }
    } catch (e) {
      console.warn('Failed to fetch fuel_prices.json:', e);
    }
  }

  let jetAPrice = null;
  let source = 'Baseline';

  if (allPrices && allPrices.prices && allPrices.prices[icao]) {
    jetAPrice = allPrices.prices[icao];
    source = 'AirNav Live (Automated Scraper)';
  } else {
    jetAPrice = JET_A_BASELINES[icao] || 5.95;
    source = 'Baseline';
  }

  const resultData = {
    icao,
    price: jetAPrice,
    priceFormatted: `$${jetAPrice.toFixed(2)}`,
    source,
    timestamp: Date.now()
  };
  
  return resultData;
}

async function fetchAviationWeather(stationCode) {
  if (!stationCode) return null;
  const icao = stationCode.toUpperCase().startsWith('K') ? stationCode.toUpperCase() : `K${stationCode.toUpperCase()}`;
  
  // Return cached data if younger than 10 minutes (600,000 ms)
  if (state.weatherCache[stationCode] && (Date.now() - state.weatherCache[stationCode].timestamp < 600000)) {
    return state.weatherCache[stationCode];
  }

  let metarData = null;
  let tafData = null;

  // 1. Try NOAA API via CORS proxy
  try {
    const metarUrl = encodeURIComponent(`https://aviationweather.gov/api/data/metar?ids=${icao}&format=json`);
    const metarRes = await fetch(`https://corsproxy.io/?url=${metarUrl}`);
    if (metarRes.status === 200) {
      const arr = await metarRes.json();
      if (Array.isArray(arr) && arr.length > 0) metarData = arr[0];
    }
  } catch (err) {
    console.warn(`NOAA METAR CORS proxy failed for ${icao}:`, err);
  }

  try {
    const tafUrl = encodeURIComponent(`https://aviationweather.gov/api/data/taf?ids=${icao}&format=json`);
    const tafRes = await fetch(`https://corsproxy.io/?url=${tafUrl}`);
    if (tafRes.status === 200) {
      const arr = await tafRes.json();
      if (Array.isArray(arr) && arr.length > 0) tafData = arr[0];
    }
  } catch (err) {
    console.warn(`NOAA TAF CORS proxy failed for ${icao}:`, err);
  }

  // 2. Fallback: Open-Meteo API (Fully CORS-enabled) if NOAA returns null
  if (!metarData) {
    const apt = INDIANA_AIRPORTS[stationCode] || Object.values(INDIANA_AIRPORTS).find(a => a.code === stationCode);
    if (apt) {
      try {
        const fallbackRes = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${apt.lat}&longitude=${apt.lng}&current=temperature_2m,relative_humidity_2m,surface_pressure,wind_speed_10m,wind_direction_10m,weather_code`);
        if (fallbackRes.ok) {
          const fData = await fallbackRes.json();
          if (fData && fData.current) {
            const cur = fData.current;
            const wSpeedKts = Math.round(cur.wind_speed_10m * 0.539957);
            const altimInHg = (cur.surface_pressure * 0.02953).toFixed(2);
            const tempC = Math.round(cur.temperature_2m);
            const dewC = Math.round(cur.temperature_2m - ((100 - cur.relative_humidity_2m) / 5));

            metarData = {
              icaoId: icao,
              temp: tempC,
              dewp: dewC,
              wspd: wSpeedKts,
              wdir: cur.wind_direction_10m,
              altim: parseFloat(altimInHg),
              visib: "10+",
              rawOb: `${icao} METAR SYNTHETIC: WIND ${cur.wind_direction_10m}° @ ${wSpeedKts}KT VIS 10SM TEMP ${tempC}°C / DEW ${dewC}°C ALTIMETER ${altimInHg} INHG`
            };
          }
        }
      } catch (err) {
        console.warn(`Open-Meteo fallback failed for ${icao}:`, err);
      }
    }
  }

  state.weatherCache[stationCode] = {
    metar: metarData,
    taf: tafData,
    timestamp: Date.now()
  };

  return state.weatherCache[stationCode];
}

function parseFlightRules(metar) {
  if (!metar) return { category: 'VFR', color: '#16A34A', bg: 'rgba(22,163,74,0.15)' };
  
  const vis = metar.visib !== undefined ? parseFloat(metar.visib) : 10;
  let ceiling = 10000;
  if (metar.clouds && Array.isArray(metar.clouds)) {
    metar.clouds.forEach(c => {
      if ((c.cover === 'BKN' || c.cover === 'OVC') && c.base !== undefined) {
        ceiling = Math.min(ceiling, c.base);
      }
    });
  }

  if (ceiling < 500 || vis < 1) {
    return { category: 'LIFR', color: '#EC4899', bg: 'rgba(236,72,153,0.15)' };
  } else if (ceiling < 1000 || vis < 3) {
    return { category: 'IFR', color: '#EF4444', bg: 'rgba(239,68,68,0.15)' };
  } else if (ceiling <= 3000 || vis <= 5) {
    return { category: 'MVFR', color: '#3B82F6', bg: 'rgba(59,130,246,0.15)' };
  }
  return { category: 'VFR', color: '#16A34A', bg: 'rgba(22,163,74,0.15)' };
}

function getFlightPlanRouteAirports() {
  const airportCodesSet = new Set();
  
  // Departure & Destination Airports
  if (state.flightPlanner) {
    if (state.flightPlanner.startAirport) airportCodesSet.add(state.flightPlanner.startAirport);
    if (state.flightPlanner.endAirport) airportCodesSet.add(state.flightPlanner.endAirport);
    if (state.flightPlanner.fuelAirport && state.flightPlanner.fuelAirport !== 'NONE') {
      airportCodesSet.add(state.flightPlanner.fuelAirport);
    }

    // Nearest airports for each circuit leg in flight plan
    if (state.flightPlanner.circuitLegs && state.flightPlanner.circuitLegs.length > 0) {
      state.flightPlanner.circuitLegs.forEach(cName => {
        const cObj = state.circuitGroups.find(item => item.name === cName);
        if (cObj && cObj.bounds && cObj.bounds.isValid()) {
          const center = cObj.bounds.getCenter();
          let nearestApt = Object.values(INDIANA_AIRPORTS).map(apt => {
            return { code: apt.code, dist: calcDistanceMiles(center.lat, center.lng, apt.lat, apt.lng) };
          }).sort((a, b) => a.dist - b.dist)[0];

          if (nearestApt) airportCodesSet.add(nearestApt.code);
        }
      });
    }
  }

  // Fallback to KVPZ if set is empty
  if (airportCodesSet.size === 0) {
    airportCodesSet.add('KVPZ');
  }

  return Array.from(airportCodesSet).map(code => INDIANA_AIRPORTS[code]).filter(Boolean);
}

function formatLocalTime(isoOrTimestamp) {
  if (!isoOrTimestamp) return '--:--';
  const d = new Date(isoOrTimestamp);
  if (isNaN(d.getTime())) return '--:--';
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true });
}

function formatLocalDateShort(isoOrTimestamp) {
  if (!isoOrTimestamp) return '';
  const d = new Date(isoOrTimestamp);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

// Parse METAR/TAF Weather Phenomena Codes (e.g. TSRA -> Thunderstorms Rain, +RA -> Heavy Rain, FG -> Fog)
function formatWeatherPhenomena(wxStr) {
  if (!wxStr) return '';
  const tokens = String(wxStr).trim().split(/\s+/);
  
  const dict = {
    'TS': 'Thunderstorms',
    'SH': 'Showers',
    'FZ': 'Freezing',
    'BL': 'Blowing',
    'DR': 'Low Drifting',
    'MI': 'Shallow',
    'BC': 'Patches of',
    'PR': 'Partial',
    'RA': 'Rain',
    'DZ': 'Drizzle',
    'SN': 'Snow',
    'SG': 'Snow Grains',
    'IC': 'Ice Crystals',
    'PL': 'Ice Pellets',
    'GR': 'Hail',
    'GS': 'Small Hail',
    'UP': 'Unknown Precip',
    'FG': 'Fog',
    'BR': 'Mist',
    'HZ': 'Haze',
    'FU': 'Smoke',
    'DU': 'Dust',
    'SA': 'Sand',
    'VA': 'Volcanic Ash',
    'SQ': 'Squalls',
    'FC': 'Funnel Cloud/Tornado',
    'SS': 'Sandstorm',
    'DS': 'Duststorm'
  };

  const parsed = tokens.map(token => {
    let prefix = '';
    let code = token;
    
    if (code.startsWith('+')) {
      prefix = 'Heavy ';
      code = code.substring(1);
    } else if (code.startsWith('-')) {
      prefix = 'Light ';
      code = code.substring(1);
    } else if (code.startsWith('VC')) {
      prefix = 'Vicinity ';
      code = code.substring(2);
    }

    let parts = [];
    for (let i = 0; i < code.length; i += 2) {
      const pair = code.substring(i, i + 2);
      if (dict[pair]) {
        parts.push(dict[pair]);
      } else {
        parts.push(pair);
      }
    }

    const desc = parts.join(' ');
    return desc ? `${prefix}${desc}` : token;
  });

  return parsed.join(', ');
}

function parseTafToPlainEnglish(rawTaf, tafObj) {
  if (!rawTaf && (!tafObj || !tafObj.fcst)) return '<div style="color:#94A3B8;">No TAF available.</div>';

  // Prefer structured fcst array if provided by NOAA JSON API
  const fcstList = (tafObj && Array.isArray(tafObj.fcst)) ? tafObj.fcst : null;

  if (fcstList && fcstList.length > 0) {
    let html = '<div style="margin-top:6px; display:flex; flex-direction:column; gap:6px;">';
    
    fcstList.forEach((period, idx) => {
      const type = period.fcstType || (idx === 0 ? 'BASE' : 'FM');
      const timeFrom = formatLocalTime(period.timeFrom * 1000 || period.timeFrom);
      const dateFrom = formatLocalDateShort(period.timeFrom * 1000 || period.timeFrom);
      const timeTo = period.timeTo ? formatLocalTime(period.timeTo * 1000 || period.timeTo) : '';
      const dateTo = period.timeTo ? formatLocalDateShort(period.timeTo * 1000 || period.timeTo) : '';
      
      const timeSpan = timeTo ? `${dateFrom} ${timeFrom} &rarr; ${dateTo} ${timeTo}` : `${dateFrom} ${timeFrom} Onward`;

      // Wind
      let windText = 'Light & Variable';
      if (period.wdir !== undefined && period.wspd !== undefined) {
        windText = `Wind ${period.wdir}° at ${period.wspd} kts`;
        if (period.wgst) windText += ` (gusts ${period.wgst} kts)`;
      }

      // Visibility
      const visText = period.visib !== undefined ? `${period.visib} SM` : '10+ SM';

      // Clouds / Ceiling
      let cloudsText = 'Sky Clear';
      if (period.clouds && Array.isArray(period.clouds) && period.clouds.length > 0) {
        cloudsText = period.clouds.map(c => `${c.cover} ${c.base || 0}ft`).join(', ');
      }

      // Weather / Precip / Phenomena
      let wxText = '';
      if (period.wxString) {
        const decodedWx = formatWeatherPhenomena(period.wxString);
        wxText = ` | <strong>Wx:</strong> <span style="color:#F59E0B; font-weight:700;">${decodedWx} (${period.wxString})</span>`;
      }

      // Type Badge styling
      let badgeBg = '#0284C7';
      let badgeLabel = type;
      if (type === 'TEMPO') { badgeBg = '#D97706'; badgeLabel = 'TEMPO'; }
      else if (type === 'PROB') { badgeBg = '#8B5CF6'; badgeLabel = `PROB${period.prob || 30}`; }
      else if (type === 'FM' || type === 'FROM') { badgeBg = '#059669'; badgeLabel = 'FROM'; }
      else if (type === 'BECMG') { badgeBg = '#2563EB'; badgeLabel = 'BECMG'; }
      else { badgeBg = '#334155'; badgeLabel = 'BASE'; }

      html += `
        <div style="background: rgba(15, 23, 42, 0.7); border: 1px solid #1E293B; border-left: 3px solid ${badgeBg}; padding: 6px 8px; border-radius: 4px; font-size: 0.7rem;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
            <span style="background: ${badgeBg}; color: #FFF; padding: 1px 5px; border-radius: 3px; font-weight: 800; font-size: 0.62rem;">${badgeLabel}</span>
            <span style="color: #38BDF8; font-weight: 600;">${timeSpan}</span>
          </div>
          <div style="color: #E2E8F0; line-height: 1.35;">
            <strong>Wind:</strong> ${windText} | <strong>Vis:</strong> ${visText}${wxText}
          </div>
          <div style="color: #94A3B8; margin-top: 2px;">
            <strong>Clouds:</strong> ${cloudsText}
          </div>
        </div>
      `;
    });

    html += '</div>';
    return html;
  }

  // Fallback: Line-by-line raw TAF string parser
  const lines = rawTaf.split(/(?=\b(?:FM\d{6}|TEMPO|BECMG|PROB\d{2})\b)/g).map(s => s.trim()).filter(Boolean);
  let html = '<div style="margin-top:6px; display:flex; flex-direction:column; gap:6px;">';

  lines.forEach((line, idx) => {
    let type = idx === 0 ? 'BASE' : 'FORECAST';
    let lineText = line;
    let badgeBg = '#334155';

    if (line.startsWith('TEMPO')) {
      type = 'TEMPO';
      badgeBg = '#D97706';
    } else if (line.startsWith('FM')) {
      type = 'FROM';
      badgeBg = '#059669';
    } else if (line.startsWith('BECMG')) {
      type = 'BECMG';
      badgeBg = '#2563EB';
    } else if (line.startsWith('PROB')) {
      type = 'PROB';
      badgeBg = '#8B5CF6';
    }

    // Parse FM date/time if present (e.g. FM301800 -> Day 30 at 18:00 UTC)
    let timeMatch = line.match(/\bFM(\d{2})(\d{2})(\d{2})\b/);
    let timeSpan = 'Period Observation';
    if (timeMatch) {
      const day = timeMatch[1];
      const hour = timeMatch[2];
      const min = timeMatch[3];
      // Construct UTC date for current month
      const now = new Date();
      const utcDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), parseInt(day, 10), parseInt(hour, 10), parseInt(min, 10)));
      timeSpan = `From ${formatLocalDateShort(utcDate)} ${formatLocalTime(utcDate)}`;
    } else {
      // Look for validity range like 3018/3118 (Day 30 18Z to Day 31 18Z)
      let rangeMatch = line.match(/\b(\d{2})(\d{2})\/(\d{2})(\d{2})\b/);
      if (rangeMatch) {
        const d1 = rangeMatch[1], h1 = rangeMatch[2], d2 = rangeMatch[3], h2 = rangeMatch[4];
        const now = new Date();
        const startDt = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), parseInt(d1, 10), parseInt(h1, 10)));
        const endDt = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), parseInt(d2, 10), parseInt(h2, 10)));
        timeSpan = `${formatLocalDateShort(startDt)} ${formatLocalTime(startDt)} &rarr; ${formatLocalDateShort(endDt)} ${formatLocalTime(endDt)}`;
      }
    }

    // Extract Wind
    let windMatch = line.match(/\b(\d{3}|VRB)(\d{2,3})(G\d{2,3})?KT\b/);
    let windText = 'Wind VRB/Light';
    if (windMatch) {
      const dir = windMatch[1];
      const spd = windMatch[2];
      const gst = windMatch[3] ? ` (gusts ${windMatch[3].replace('G','')} kts)` : '';
      windText = `Wind ${dir}° at ${spd} kts${gst}`;
    }

    // Extract Vis
    let visMatch = line.match(/\b(\d+|(?:P)?\d\/\d)SM\b/);
    let visText = visMatch ? `${visMatch[1].replace('P','')} SM` : '10+ SM';

    // Extract Clouds
    let cloudMatches = line.match(/\b(FEW|SCT|BKN|OVC|VV)(\d{3})\b/g);
    let cloudsText = cloudMatches ? cloudMatches.map(c => {
      const cov = c.substring(0, 3);
      const alt = parseInt(c.substring(3), 10) * 100;
      return `${cov} ${alt}ft`;
    }).join(', ') : 'Sky Clear / Unspecified';

    // Extract Weather Phenomena
    let wxMatch = line.match(/\b(\+|-|VC)?(MI|PR|BC|DR|BL|SH|TS|FZ)?(DZ|RA|SN|SG|IC|PL|GR|GS|UP|FG|BR|HZ|FU|DU|SA|VA|SQ|FC|SS|DS)+\b/g);
    let wxText = '';
    if (wxMatch) {
      const uniqueCodes = Array.from(new Set(wxMatch)).filter(c => !c.match(/^(FM|TEMPO|BECMG|PROB|AUTO|NSW)$/));
      if (uniqueCodes.length > 0) {
        const decodedList = uniqueCodes.map(c => {
          const dec = formatWeatherPhenomena(c);
          return dec ? `${dec} (${c})` : c;
        }).join(', ');
        wxText = ` | <strong>Wx:</strong> <span style="color:#F59E0B; font-weight:700;">${decodedList}</span>`;
      }
    }

    html += `
      <div style="background: rgba(15, 23, 42, 0.7); border: 1px solid #1E293B; border-left: 3px solid ${badgeBg}; padding: 6px 8px; border-radius: 4px; font-size: 0.7rem;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
          <span style="background: ${badgeBg}; color: #FFF; padding: 1px 5px; border-radius: 3px; font-weight: 800; font-size: 0.62rem;">${type}</span>
          <span style="color: #38BDF8; font-weight: 600;">${timeSpan}</span>
        </div>
        <div style="color: #E2E8F0; line-height: 1.35;">
          <strong>Wind:</strong> ${windText} | <strong>Vis:</strong> ${visText}${wxText}
        </div>
        <div style="color: #94A3B8; margin-top: 2px;">
          <strong>Clouds:</strong> ${cloudsText}
        </div>
      </div>
    `;
  });

  html += '</div>';
  return html;
}

function parseMetarToPlainEnglish(rawMetar, metarObj, rules) {
  if (!metarObj && !rawMetar) return '<div style="color:#94A3B8;">No METAR available.</div>';

  const obsTime = (metarObj && metarObj.reportTime) ? formatLocalTime(metarObj.reportTime) : formatLocalTime(Date.now());
  const obsDate = (metarObj && metarObj.reportTime) ? formatLocalDateShort(metarObj.reportTime) : formatLocalDateShort(Date.now());
  
  const tempC = metarObj && metarObj.temp !== undefined ? metarObj.temp : '--';
  const tempF = tempC !== '--' ? Math.round((tempC * 9/5) + 32) : '--';
  const dewC = metarObj && metarObj.dewp !== undefined ? metarObj.dewp : '--';
  const dewF = dewC !== '--' ? Math.round((dewC * 9/5) + 32) : '--';
  
  const windSpd = metarObj && metarObj.wspd !== undefined ? metarObj.wspd : 0;
  const windDir = metarObj && metarObj.wdir !== undefined ? metarObj.wdir : 'VRB';
  const gustStr = (metarObj && metarObj.wgst) ? ` (gusts ${metarObj.wgst} kts)` : '';
  const windText = (windDir === 'VRB' && windSpd === 0) ? 'Calm' : `Wind ${windDir}° at ${windSpd} kts${gustStr}`;

  const visText = metarObj && metarObj.visib !== undefined ? `${metarObj.visib} SM` : '10+ SM';
  const altimText = metarObj && metarObj.altim !== undefined ? `${parseFloat(metarObj.altim).toFixed(2)} inHg` : '--';

  let cloudsText = 'Sky Clear';
  let ceilingText = 'None / Unlimited';
  if (metarObj && metarObj.clouds && Array.isArray(metarObj.clouds) && metarObj.clouds.length > 0) {
    cloudsText = metarObj.clouds.map(c => `${c.cover} at ${c.base || 0}ft`).join(', ');
    const bknOvc = metarObj.clouds.find(c => (c.cover === 'BKN' || c.cover === 'OVC') && c.base !== undefined);
    if (bknOvc) {
      ceilingText = `${bknOvc.cover} at ${bknOvc.base}ft`;
    }
  }

  let wxText = '';
  if (metarObj && metarObj.wxString) {
    const decodedWx = formatWeatherPhenomena(metarObj.wxString);
    wxText = ` | <strong>Weather:</strong> <span style="color:#F59E0B; font-weight:700;">${decodedWx} (${metarObj.wxString})</span>`;
  } else if (rawMetar) {
    let wxMatch = rawMetar.match(/\b(\+|-|VC)?(MI|PR|BC|DR|BL|SH|TS|FZ)?(DZ|RA|SN|SG|IC|PL|GR|GS|UP|FG|BR|HZ|FU|DU|SA|VA|SQ|FC|SS|DS)+\b/g);
    if (wxMatch) {
      const uniqueCodes = Array.from(new Set(wxMatch)).filter(c => !c.match(/^(AUTO|RMK|SPECI|COR)$/));
      if (uniqueCodes.length > 0) {
        const decodedList = uniqueCodes.map(c => `${formatWeatherPhenomena(c)} (${c})`).join(', ');
        wxText = ` | <strong>Weather:</strong> <span style="color:#F59E0B; font-weight:700;">${decodedList}</span>`;
      }
    }
  }

  return `
    <div style="margin-top:4px; display:flex; flex-direction:column; gap:4px; font-size:0.72rem;">
      <div style="background: rgba(15, 23, 42, 0.7); border: 1px solid #1E293B; border-left: 3px solid ${rules.color}; padding: 6px 8px; border-radius: 4px;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
          <span style="background: ${rules.bg}; color: ${rules.color}; border: 1px solid ${rules.color}; padding: 1px 5px; border-radius: 3px; font-weight: 800; font-size: 0.62rem;">${rules.category}</span>
          <span style="color: #38BDF8; font-weight: 600;">Observed: ${obsDate} ${obsTime}</span>
        </div>
        <div style="color: #E2E8F0; line-height: 1.4; margin-bottom: 3px;">
          <strong>Wind:</strong> ${windText} | <strong>Vis:</strong> ${visText}${wxText}
        </div>
        <div style="color: #94A3B8; line-height: 1.35; margin-bottom: 3px;">
          <strong>Ceiling:</strong> <span style="color:#4ADE80; font-weight:600;">${ceilingText}</span> | <strong>Sky:</strong> ${cloudsText}
        </div>
        <div style="color: #E2E8F0; line-height: 1.4;">
          <strong>Temp / Dew:</strong> ${tempC}°C (${tempF}°F) / ${dewC}°C (${dewF}°F) | <strong>Altimeter:</strong> ${altimText}
        </div>
      </div>
    </div>
  `;
}

async function populateWeatherUI(forceRefresh = false) {
  const container = document.getElementById('weather-cards-list');
  const select = document.getElementById('weather-airport-select');
  if (!container) return;

  const kvpz = INDIANA_AIRPORTS['KVPZ'] || { lat: 41.4540, lng: -87.0071 };
  const airportsSortedByKVPZ = Object.values(INDIANA_AIRPORTS).slice().sort((a, b) => {
    const distA = calcDistanceMiles(kvpz.lat, kvpz.lng, a.lat, a.lng);
    const distB = calcDistanceMiles(kvpz.lat, kvpz.lng, b.lat, b.lng);
    return distA - distB;
  });

  if (select) {
    if (select.options.length <= 2) {
      airportsSortedByKVPZ.forEach(apt => {
        const opt = document.createElement('option');
        opt.value = apt.code;
        opt.textContent = `${apt.code} - ${apt.name}`;
        select.appendChild(opt);
      });
    }
    if (state.activeWeatherStation) {
      select.value = state.activeWeatherStation;
    }
  }

  if (forceRefresh) {
    state.weatherCache = {};
  }

  let airportsToFetch = [];
  let headerNotice = '';

  if (state.activeWeatherStation === 'PLAN_NEAREST') {
    airportsToFetch = getFlightPlanRouteAirports();
    headerNotice = `<div style="font-size: 0.72rem; color: var(--accent-cyan); font-weight: 600; margin-bottom: 10px; background: rgba(0,229,255,0.08); padding: 6px 10px; border-radius: 4px; border: 1px solid rgba(0,229,255,0.2);"><i class="fa-solid fa-bolt"></i> Auto-Filtered to ${airportsToFetch.length} Airports Relevant to Active Flight Plan Route</div>`;
  } else if (state.activeWeatherStation === 'ALL') {
    airportsToFetch = airportsSortedByKVPZ;
  } else {
    airportsToFetch = [INDIANA_AIRPORTS[state.activeWeatherStation]].filter(Boolean);
  }

  container.innerHTML = `
    <div style="padding: 20px; text-align: center; color: var(--text-muted); font-size: 0.8rem;">
      <i class="fa-solid fa-spinner fa-spin" style="font-size: 1.4rem; margin-bottom: 8px; color: var(--accent-cyan);"></i><br>
      Fetching live METAR/TAF weather observation feeds...
    </div>
  `;

  await Promise.all(airportsToFetch.map(apt => fetchAviationWeather(apt.code)));

  container.innerHTML = headerNotice;

  airportsToFetch.forEach(apt => {
    const wData = state.weatherCache[apt.code] || {};
    const metar = wData.metar;
    const taf = wData.taf;

    const rules = parseFlightRules(metar);

    const tempC = metar && metar.temp !== undefined ? metar.temp : '--';
    const tempF = tempC !== '--' ? Math.round((tempC * 9/5) + 32) : '--';
    const dewC = metar && metar.dewp !== undefined ? metar.dewp : '--';
    const dewF = dewC !== '--' ? Math.round((dewC * 9/5) + 32) : '--';
    const windSpd = metar && metar.wspd !== undefined ? metar.wspd : 0;
    const windDir = metar && metar.wdir !== undefined ? metar.wdir : 'VRB';
    const altim = metar && metar.altim !== undefined ? parseFloat(metar.altim).toFixed(2) : '--';
    const vis = metar && metar.visib !== undefined ? `${metar.visib} SM` : '10+ SM';
    const rawMetar = metar && metar.rawOb ? metar.rawOb : `${apt.code} AUTO OBS: Wind ${windDir}° @ ${windSpd}kts, Temp ${tempC}°C, Altimeter ${altim}`;
    const hasTaf = taf && (taf.rawTAF || taf.fcst);
    const rawTaf = hasTaf ? (taf.rawTAF || JSON.stringify(taf.fcst)) : '';

    const lastUpdatedMins = wData.timestamp ? Math.round((Date.now() - wData.timestamp) / 60000) : 0;

    // Build Detailed Plain English Translations
    const plainMetarText = parseMetarToPlainEnglish(rawMetar, metar, rules);

    let plainTafText = '';
    if (hasTaf) {
      plainTafText = parseTafToPlainEnglish(rawTaf, taf);
    }

    const card = document.createElement('div');
    card.className = 'panel-card collapsible-card';
    card.style.cssText = 'margin-bottom: 10px; border-left: 4px solid ' + rules.color + ';';

    const tafHtmlBlock = hasTaf ? `
        <div style="margin-top: 8px;">
          <div style="font-size: 0.68rem; color: var(--text-muted); font-weight: 600; text-transform: uppercase; margin-bottom: 4px;">TAF FORECAST:</div>
          <div id="plain-taf-${apt.code}" style="font-size: 0.72rem; background: #0F172A; padding: 6px 8px; border-radius: 4px; border: 1px solid #334155; color: #E2E8F0; line-height: 1.45;">
            <strong style="color: var(--accent-cyan);">Detailed TAF Breakdown (Local Time):</strong>
            ${plainTafText}
          </div>
        </div>
    ` : '';

    card.innerHTML = `
      <div class="card-header-flex collapsible-header">
        <div class="card-title" style="display: flex; align-items: center; gap: 6px;">
          <i class="fa-solid fa-caret-down collapse-triangle"></i>
          <span style="font-weight: 700; font-size: 0.95rem; color: #FFF;">${apt.code}</span>
          <span style="font-size: 0.72rem; color: var(--text-muted);">${apt.name}</span>
        </div>
        <div style="display: flex; align-items: center; gap: 6px;">
          <span style="font-size: 0.65rem; color: var(--text-dim);">${lastUpdatedMins}m ago</span>
          <span class="badge-sm" style="background: ${rules.bg}; color: ${rules.color}; font-weight: 700; border: 1px solid ${rules.color};">
            ${rules.category}
          </span>
        </div>
      </div>

      <div class="card-body" style="margin-top: 10px;">
        <div style="margin-bottom: 8px;">
          <div style="font-size: 0.68rem; color: var(--text-muted); font-weight: 600; text-transform: uppercase; margin-bottom: 4px;">METAR OBSERVATION:</div>
          <div id="plain-metar-${apt.code}" style="font-size: 0.72rem; background: #0F172A; padding: 6px 8px; border-radius: 4px; border: 1px solid #334155; color: #E2E8F0; line-height: 1.35;">
            ${plainMetarText}
          </div>
        </div>

        ${tafHtmlBlock}
      </div>
    `;

    container.appendChild(card);
  });

  initCollapsibleCards();

  // Sync updated weather conditions to map airport markers
  if (typeof renderIndianaAirportsLayer === 'function') {
    renderIndianaAirportsLayer();
  }

  // Set 10-minute auto refresh timer (600,000 ms)
  if (state.weatherTimer) clearInterval(state.weatherTimer);
  state.weatherTimer = setInterval(() => {
    console.log('⚡ Auto-refreshing weather data (10-min interval)...');
    populateWeatherUI(true);
  }, 600000);
}

function initCollapsibleCards() {
  const headers = document.querySelectorAll('.collapsible-header');
  headers.forEach(header => {
    if (header.dataset.hasCollapseListener) return;
    header.dataset.hasCollapseListener = 'true';

    header.addEventListener('click', (e) => {
      if (e.target.closest('button') || e.target.closest('select') || e.target.closest('input') || e.target.closest('a')) {
        return;
      }
      const card = header.closest('.collapsible-card');
      if (card) {
        card.classList.toggle('collapsed');
      }
    });
  });
}

// Entry Point
document.addEventListener('DOMContentLoaded', () => {
  initMap();
  setupEventListeners();
  loadGridData();
  initFlightPlanner();
  initCollapsibleCards();
  populateWeatherUI();
});

// ==========================================
// HELICOPTER INTERACTIVE FLIGHT PLANNER ENGINE (v3.0.0)
// ==========================================

const INDIANA_AIRPORTS = {
  'KVPZ': { name: 'Porter County Municipal (Valparaiso)', lat: 41.4540, lng: -87.0071, code: 'KVPZ' },
  'KGYY': { name: 'Gary/Chicago International (Gary)', lat: 41.6171, lng: -87.4132, code: 'KGYY' },
  'KSBN': { name: 'South Bend International (South Bend)', lat: 41.7083, lng: -86.3169, code: 'KSBN' },
  'KPPO': { name: 'La Porte Municipal Airport (La Porte)', lat: 41.5725, lng: -86.7345, code: 'KPPO' },
  'KMGC': { name: 'Michigan City Municipal (Michigan City)', lat: 41.7033, lng: -86.8212, code: 'KMGC' },
  'KRZL': { name: 'Jasper County Airport (Rensselaer)', lat: 40.9479, lng: -87.1826, code: 'KRZL' },
  'KMCX': { name: 'White County Airport (Monticello)', lat: 40.7088, lng: -86.7668, code: 'KMCX' },
  'KOXI': { name: 'Starke County Airport (Knox)', lat: 41.3301, lng: -86.6623, code: 'KOXI' },
  'KRWN': { name: 'Arens Field (Winamac)', lat: 41.0922, lng: -86.6134, code: 'KRWN' },
  'KRCR': { name: 'Fulton County Airport (Rochester)', lat: 41.0656, lng: -86.1817, code: 'KRCR' },
  'KASW': { name: 'Warsaw Municipal Airport (Warsaw)', lat: 41.2747, lng: -85.8401, code: 'KASW' },
  'KGSH': { name: 'Goshen Municipal Airport (Goshen)', lat: 41.5264, lng: -85.7929, code: 'KGSH' },
  'KEKM': { name: 'Elkhart Municipal Airport (Elkhart)', lat: 41.7194, lng: -86.0032, code: 'KEKM' },
  'KANQ': { name: 'Tri State Steuben County (Angola)', lat: 41.6397, lng: -85.0835, code: 'KANQ' },
  'KGWB': { name: 'De Kalb County Airport (Auburn)', lat: 41.3072, lng: -85.0644, code: 'KGWB' },
  'KSMD': { name: 'Smith Field (Fort Wayne)', lat: 41.1434, lng: -85.1528, code: 'KSMD' },
  'KFWA': { name: 'Fort Wayne International (Fort Wayne)', lat: 40.9789, lng: -85.1945, code: 'KFWA' },
  'KHHG': { name: 'Huntington Municipal (Huntington)', lat: 40.8529, lng: -85.4571, code: 'KHHG' },
  'KIWH': { name: 'Wabash Municipal Airport (Wabash)', lat: 40.7630, lng: -85.7997, code: 'KIWH' },
  'KGGP': { name: 'Logansport Cass County (Logansport)', lat: 40.7112, lng: -86.3749, code: 'KGGP' },
  'KLAF': { name: 'Purdue University Airport (West Lafayette)', lat: 40.4129, lng: -86.9394, code: 'KLAF' },
  'KFKR': { name: 'Frankfort Clinton County (Frankfort)', lat: 40.2734, lng: -86.5622, code: 'KFKR' },
  'C65': { name: 'Plymouth Municipal Airport (Plymouth)', lat: 41.3662, lng: -86.3001, code: 'C65' }
};

state.flightPlanner = {
  startAirport: 'KVPZ',
  fuelAirport: 'NONE',
  fuelTurnaroundMins: 30,
  endAirport: 'KVPZ',
  circuitLegs: [],
  autoOptimize: true,
  manualEndpoints: {},
  isClickMode: false,
  plannerLayerGroup: null,
  airportsLayerGroup: null,
  showAirports: true,
  showAirportLabels: true,
  showFuelPrices: true,
  legCustomParams: {}, // Stores custom parameters per leg key or index: { transitSpeedKts, inspSpeedKts, fuelBurnGph }
  defaultTransitSpeedKts: 110,
  defaultInspSpeedKts: 30,
  defaultFuelBurnGph: 69
};

function syncSelectedGroupToFlightPlan(forceToast = false) {
  if (state._isSyncing) return;
  state._isSyncing = true;
  state.flightPlanner.circuitLegs = Array.from(state.selectedGroup);

  state.flightPlanner.circuitLegs = Array.from(state.selectedGroup);

  if (forceToast) showToast(`Synced ${state.flightPlanner.circuitLegs.length} selected circuit(s) into Flight Plan!`);
  state._isSyncing = false;
  recalculateFlightPlan();
}

function processPlannerSearchInput() {
  const inputEl = document.getElementById('planner-circuit-search-input');
  if (!inputEl) return;

  const rawVal = inputEl.value.trim();
  if (!rawVal) return;

  const tokens = rawVal.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  let addedNames = [];

  tokens.forEach(tok => {
    const match = state.circuitGroups.find(c => c.name.toLowerCase() === tok || c.name.toLowerCase().includes(tok));
    if (match && !state.flightPlanner.circuitLegs.includes(match.name)) {
      state.flightPlanner.circuitLegs.push(match.name);
      addedNames.push(match.name);
    }
  });

  if (addedNames.length > 0) {
    showToast(`Added ${addedNames.length} circuit(s) to flight plan!`);
    inputEl.value = '';
    recalculateFlightPlan();
  } else {
    showToast(`No matching unadded circuits found for "${rawVal}"`);
  }
}

window.setDepartureAirport = function(aptCode) {
  if (state.flightPlanner.startAirport === aptCode) {
    // Toggle Off: Reset departure back to default KVPZ Base
    state.flightPlanner.startAirport = 'KVPZ';
    const sel = document.getElementById('planner-start-airport');
    if (sel) sel.value = 'KVPZ';
    showToast(`🚁 Removed Departure Airport -> Reset to KVPZ Base`);
  } else {
    state.flightPlanner.startAirport = aptCode;
    const sel = document.getElementById('planner-start-airport');
    if (sel) sel.value = aptCode;
    showToast(`🚁 Set Departure Airport -> ${aptCode}`);
  }
  state.map.closePopup();
  recalculateFlightPlan();
  renderIndianaAirportsLayer();
};

window.setFuelStopAirport = function(aptCode) {
  if (state.flightPlanner.fuelAirport === aptCode) {
    // Toggle Off: Remove fuel stop
    state.flightPlanner.fuelAirport = 'NONE';
    const sel = document.getElementById('planner-fuel-airport');
    if (sel) sel.value = 'NONE';
    showToast(`⛽ Removed Fuel Stop -> ${aptCode}`);
  } else {
    state.flightPlanner.fuelAirport = aptCode;
    const sel = document.getElementById('planner-fuel-airport');
    if (sel) sel.value = aptCode;
    showToast(`⛽ Set Fuel Stop Airport -> ${aptCode}`);
  }
  state.map.closePopup();
  recalculateFlightPlan();
  renderIndianaAirportsLayer();
};

window.setDestinationAirport = function(aptCode) {
  if (state.flightPlanner.endAirport === aptCode) {
    // Toggle Off: Reset destination back to default KVPZ Return to Base
    state.flightPlanner.endAirport = 'KVPZ';
    const sel = document.getElementById('planner-end-airport');
    if (sel) sel.value = 'KVPZ';
    showToast(`🚁 Removed Destination Airport -> Reset to KVPZ Return to Base`);
  } else {
    state.flightPlanner.endAirport = aptCode;
    const sel = document.getElementById('planner-end-airport');
    if (sel) sel.value = aptCode;
    showToast(`🚁 Set Destination Airport -> ${aptCode}`);
  }
  state.map.closePopup();
  recalculateFlightPlan();
  renderIndianaAirportsLayer();
};

window.updateFuelPrice = function(aptCode, newPriceStr) {
  const newPrice = parseFloat(newPriceStr.replace(/[^0-9.]/g, ''));
  if (isNaN(newPrice)) {
    showToast('❌ Invalid fuel price entered');
    return;
  }
  
  if (!state.globalFuelPrices) {
    state.globalFuelPrices = { timestamp: Date.now(), prices: {} };
  }
  if (!state.globalFuelPrices.prices) {
    state.globalFuelPrices.prices = {};
  }
  
  state.globalFuelPrices.prices[aptCode] = newPrice;
  localStorage.setItem('gh_fuel_prices_cache', JSON.stringify(state.globalFuelPrices));
  
  showToast(`⛽ Manually set fuel price for ${aptCode} to $${newPrice.toFixed(2)}`);
  recalculateFlightPlan();
};

function renderIndianaAirportsLayer() {
  if (!state.map) return;

  if (state.flightPlanner.airportsLayerGroup) {
    state.map.removeLayer(state.flightPlanner.airportsLayerGroup);
    state.flightPlanner.airportsLayerGroup = null;
  }

  if (!state.flightPlanner.showAirports) {
    return;
  }

  const layerGroup = L.layerGroup().addTo(state.map);
  state.flightPlanner.airportsLayerGroup = layerGroup;

  const fp = state.flightPlanner;

  Object.values(INDIANA_AIRPORTS).forEach(async (apt) => {
    const isStart = (fp.startAirport === apt.code);
    const isFuel = (fp.fuelAirport === apt.code);
    const isEnd = (fp.endAirport === apt.code);

    let badgeBg = 'rgba(15, 23, 42, 0.92)';
    let badgeBorder = 'rgba(56, 189, 248, 0.4)';
    let textColor = '#E2E8F0';
    let labelSuffix = '';

    if (isStart && isEnd && !isFuel) {
      badgeBg = 'linear-gradient(135deg, #0284C7, #16A34A)';
      badgeBorder = '#00E5FF';
      textColor = '#FFF';
      labelSuffix = ' (Base)';
    } else if (isStart) {
      badgeBg = '#0284C7';
      badgeBorder = '#38BDF8';
      textColor = '#FFF';
      labelSuffix = ' (Dep)';
    } else if (isFuel) {
      badgeBg = '#D97706';
      badgeBorder = '#F59E0B';
      textColor = '#FFF';
      labelSuffix = ' (Fuel)';
    } else if (isEnd) {
      badgeBg = '#16A34A';
      badgeBorder = '#4ADE80';
      textColor = '#FFF';
      labelSuffix = ' (Dest)';
    }

    // Weather condition evaluation
    const wData = state.weatherCache[apt.code] || {};
    const rules = parseFlightRules(wData.metar);
    const metar = wData.metar;
    const visStr = metar && metar.visib !== undefined ? `${metar.visib}SM` : '10+SM';
    const windStr = metar && metar.wspd !== undefined ? `${metar.wdir || 'VRB'}°@${metar.wspd}kt` : 'VRB@0kt';

    let ceilingStr = 'Sky Clear';
    if (metar && metar.clouds && Array.isArray(metar.clouds) && metar.clouds.length > 0) {
      const bknOvc = metar.clouds.find(c => (c.cover === 'BKN' || c.cover === 'OVC') && c.base !== undefined);
      if (bknOvc) {
        ceilingStr = `CIG ${bknOvc.base}ft`;
      } else {
        ceilingStr = `${metar.clouds[0].cover} ${metar.clouds[0].base || 0}ft`;
      }
    }

    // Fetch AirNav Jet-A Fuel Price
    const fuelData = await fetchAirNavFuelPrice(apt.code);
    const priceStr = fuelData ? fuelData.priceFormatted : '$5.85';
    const fuelSourceStr = fuelData ? fuelData.source : 'AirNav';

    let wxCircleHtml = `<span title="${rules.category}" style="display: inline-block; width: 10px; height: 10px; border-radius: 50%; background: ${rules.color}; border: 1.5px solid #FFF; box-shadow: 0 0 6px ${rules.color}; flex-shrink: 0;"></span>`;
    let wxBadgeHtml = `<span style="background: ${rules.bg}; color: ${rules.color}; border: 1px solid ${rules.color}; padding: 1px 4px; border-radius: 3px; font-size: 8.5px; font-weight: 800;">${rules.category}</span>`;
    
    const popupContent = `
      <div style="font-family: Inter, sans-serif; padding: 2px; width: 175px; color: #0F172A;">
        <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 3px;">
          <div style="font-weight: 800; font-size: 11.5px; color: #0F172A; line-height: 1.1;">
            🚁 ${apt.code}
          </div>
          ${wxBadgeHtml}
        </div>
        <div style="font-size: 9.5px; color: #64748B; margin-bottom: 4px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
          ${apt.name}
        </div>

        <div style="background: #0F172A; color: #FFF; padding: 5px 6px; border-radius: 4px; margin-bottom: 5px; font-size: 9.5px; line-height: 1.35; border: 1px solid #1E293B; box-shadow: inset 0 1px 2px rgba(0,0,0,0.4);">
          <div style="display: flex; justify-content: space-between; margin-bottom: 2px; background: rgba(16,185,129,0.15); padding: 2px 4px; border-radius: 3px; border: 1px solid rgba(16,185,129,0.3); align-items: center;">
            <span style="color: #6EE7B7; font-weight: 600;">⛽ Jet-A Fuel:</span>
            <div style="display: flex; align-items: center; gap: 2px;">
              <span style="color: #34D399; font-weight: 800;">$</span>
              <input type="text" value="${priceStr.replace('$', '')}" 
                     onchange="window.updateFuelPrice('${apt.code}', this.value)"
                     style="background: transparent; border: 1px solid rgba(52,211,153,0.3); color: #34D399; font-weight: 800; font-size: 9.5px; width: 35px; text-align: right; border-radius: 2px; padding: 1px 2px; outline: none; font-family: inherit;" />
              <span style="color: #34D399; font-weight: 800;">/gal</span>
            </div>
          </div>
          <div style="display: flex; justify-content: space-between; margin-bottom: 2px;">
            <span style="color: #94A3B8;">Wind:</span>
            <strong style="color: #00E5FF;">${windStr}</strong>
          </div>
          <div style="display: flex; justify-content: space-between; margin-bottom: 2px;">
            <span style="color: #94A3B8;">Visibility:</span>
            <strong style="color: #F59E0B;">${visStr}</strong>
          </div>
          <div style="display: flex; justify-content: space-between;">
            <span style="color: #94A3B8;">Ceiling:</span>
            <strong style="color: #4ADE80;">${ceilingStr}</strong>
          </div>
        </div>

        <div style="display: flex; gap: 3px;">
          <button title="${isStart ? 'Click to REMOVE Departure' : 'Set as Departure Airport'}" style="flex: 1; background: ${isStart ? '#38BDF8' : '#0284C7'}; color: #FFF; padding: 4px 2px; border-radius: 3px; font-weight: 700; font-size: 9.5px; border: ${isStart ? '1.5px solid #FFF' : 'none'}; cursor: pointer; text-align: center; box-shadow: ${isStart ? '0 0 6px rgba(56,189,248,0.8)' : 'none'};" onclick="window.setDepartureAirport('${apt.code}')">
            🚁 ${isStart ? '✓ Dep' : 'Departure'}
          </button>
          <button title="${isFuel ? 'Click to REMOVE Fuel Stop' : 'Set as Fuel Stop Airport'}" style="flex: 1; background: ${isFuel ? '#F59E0B' : '#D97706'}; color: #FFF; padding: 4px 2px; border-radius: 3px; font-weight: 700; font-size: 9.5px; border: ${isFuel ? '1.5px solid #FFF' : 'none'}; cursor: pointer; text-align: center; box-shadow: ${isFuel ? '0 0 6px rgba(245,158,11,0.8)' : 'none'};" onclick="window.setFuelStopAirport('${apt.code}')">
            ⛽ ${isFuel ? '✓ Fuel' : 'Fuel Stop'}
          </button>
          <button title="${isEnd ? 'Click to REMOVE Destination' : 'Set as Destination Airport'}" style="flex: 1; background: ${isEnd ? '#4ADE80' : '#16A34A'}; color: #FFF; padding: 4px 2px; border-radius: 3px; font-weight: 700; font-size: 9.5px; border: ${isEnd ? '1.5px solid #FFF' : 'none'}; cursor: pointer; text-align: center; box-shadow: ${isEnd ? '0 0 6px rgba(74,222,128,0.8)' : 'none'};" onclick="window.setDestinationAirport('${apt.code}')">
            🚁 ${isEnd ? '✓ Dest' : 'Destination'}
          </button>
        </div>
      </div>
    `;

    const setupAirportMarkerEvents = (marker) => {
      let isPinned = false;

      marker.on('click', function(e) {
        if (e.originalEvent) e.originalEvent.stopPropagation();
        isPinned = true;
        this.openPopup();
      });

      marker.on('mouseover', function() {
        this.openPopup();
      });

      marker.on('mouseout', function() {
        if (!isPinned) {
          this.closePopup();
        }
      });

      marker.on('popupclose', function() {
        isPinned = false;
      });
    };

    if (!fp.showAirportLabels) {
      // Render as a colored flight rule dot marker with tooltip on hover (No price text when full badges unchecked)
      const dotIcon = L.divIcon({
        className: 'indiana-airport-dot-marker',
        html: `<div title="${apt.code}${labelSuffix} (${rules.category}) - ${apt.name}" style="background: ${rules.color}; border: 1.5px solid #FFF; width: 10px; height: 10px; border-radius: 50%; box-shadow: 0 0 6px ${rules.color}; cursor: pointer;"></div>`,
        iconSize: [10, 10],
        iconAnchor: [5, 5]
      });
      const marker = L.marker([apt.lat, apt.lng], { icon: dotIcon }).addTo(layerGroup);
      marker.bindPopup(popupContent, { closeButton: false, offset: [0, -4] });
      setupAirportMarkerEvents(marker);
      return;
    }

    const priceLabelHtml = (fp.showFuelPrices !== false) ? `<span style="color: #34D399; font-weight: 800; border-left: 1px solid rgba(255,255,255,0.2); padding-left: 4px;">${priceStr}</span>` : '';

    const aptIcon = L.divIcon({
      className: 'indiana-airport-marker-wrapper',
      html: `
        <div class="indiana-apt-badge" style="background: ${badgeBg}; color: ${textColor}; border: 1.5px solid ${badgeBorder}; padding: 3px 8px; border-radius: 12px; font-weight: 700; font-size: 11px; white-space: nowrap; cursor: pointer; box-shadow: 0 4px 12px rgba(0,0,0,0.6); backdrop-filter: blur(4px); display: inline-flex; align-items: center; gap: 6px;">
          ${wxCircleHtml}
          <span>${apt.code}${labelSuffix}</span>
          ${priceLabelHtml}
        </div>
      `,
      iconSize: [140, 24],
      iconAnchor: [70, 12]
    });

    const marker = L.marker([apt.lat, apt.lng], { icon: aptIcon }).addTo(layerGroup);
    marker.bindPopup(popupContent, { closeButton: false, offset: [0, -10] });
    setupAirportMarkerEvents(marker);
  });
}

window.reverseFlightPlan = function() {
  if (!state.flightPlanner.circuitLegs || state.flightPlanner.circuitLegs.length <= 1) return;
  state.flightPlanner.isReversed = !state.flightPlanner.isReversed;
  
  // Always reverse the array so pre/post fuel groups swap
  state.flightPlanner.circuitLegs.reverse();
  
  if (state.flightPlanner.fuelStopIndex !== undefined) {
    state.flightPlanner.fuelStopIndex = state.flightPlanner.circuitLegs.length - state.flightPlanner.fuelStopIndex;
  }
  
  recalculateFlightPlan();
  showToast('🔄 Flight Plan reversed!');
};

function initFlightPlanner() {
  renderIndianaAirportsLayer();

  const startSel = document.getElementById('planner-start-airport');
  const fuelSel = document.getElementById('planner-fuel-airport');
  const endSel = document.getElementById('planner-end-airport');
  const addSel = document.getElementById('planner-add-circuit-select');
  const addBtn = document.getElementById('btn-planner-add-circuit');
  const searchInput = document.getElementById('planner-circuit-search-input');
  const addInputBtn = document.getElementById('btn-planner-add-input');
  const syncBtn = document.getElementById('btn-planner-sync-selected');
  const resetBtn = document.getElementById('btn-reset-planner');
  const clickToggleBtn = document.getElementById('btn-toggle-click-planner');
  const pdfBtn = document.getElementById('btn-planner-export-pdf');
  const autoOptBtn = document.getElementById('btn-toggle-auto-optimize');
  const reverseBtn = document.getElementById('btn-planner-reverse-route');

  if (reverseBtn) {
    reverseBtn.addEventListener('click', reverseFlightPlan);
  }

  if (startSel) {
    startSel.addEventListener('change', (e) => {
      state.flightPlanner.startAirport = e.target.value;
      recalculateFlightPlan();
      renderIndianaAirportsLayer();
    });
  }

  if (fuelSel) {
    fuelSel.addEventListener('change', (e) => {
      state.flightPlanner.fuelAirport = e.target.value;
      recalculateFlightPlan();
      renderIndianaAirportsLayer();
    });
  }

  const fuelDurationInput = document.getElementById('planner-fuel-duration');
  if (fuelDurationInput) {
    fuelDurationInput.addEventListener('input', (e) => {
      const val = parseInt(e.target.value, 10);
      state.flightPlanner.fuelTurnaroundMins = (!isNaN(val) && val >= 0) ? val : 30;
      recalculateFlightPlan();
    });
  }

  if (endSel) {
    endSel.addEventListener('change', (e) => {
      state.flightPlanner.endAirport = e.target.value;
      recalculateFlightPlan();
      renderIndianaAirportsLayer();
    });
  }

  const applyGlobalBtn = document.getElementById('btn-apply-global-planner-settings');
  if (applyGlobalBtn) {
    applyGlobalBtn.addEventListener('click', () => applyGlobalFlightPlannerSettings(true));
  }

  ['planner-global-transit-speed', 'planner-global-insp-speed', 'planner-global-fuel-burn'].forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener('change', () => applyGlobalFlightPlannerSettings(false));
    }
  });

  if (searchInput) {
    searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        processPlannerSearchInput();
      }
    });
  }

  if (addInputBtn) {
    addInputBtn.addEventListener('click', processPlannerSearchInput);
  }

  if (syncBtn) {
    syncBtn.addEventListener('click', () => {
      syncSelectedGroupToFlightPlan(true);
    });
  }

  if (addBtn && addSel) {
    addBtn.addEventListener('click', () => {
      const val = addSel.value;
      if (val) {
        addCircuitToFlightPlan(val);
        addSel.value = '';
      }
    });
  }

  const renameActiveBtn = document.getElementById('btn-rename-active-mission');
  if (renameActiveBtn) {
    renameActiveBtn.addEventListener('click', (e) => {
      if (state.activeMission) {
        renameMissionPack(state.activeMission.id, e);
      }
    });
  }

function setAutoPlanMode(enabled) {
  state.flightPlanner.autoPlanBackground = (enabled === true);
  state.flightPlanner.autoOptimize = (enabled === true);

  const autoplanBtn = document.getElementById('btn-autoplan-optimize');
  if (autoplanBtn) {
    if (enabled) {
      autoplanBtn.style.background = 'rgba(0,229,255,0.25)';
      autoplanBtn.style.color = '#00E5FF';
      autoplanBtn.style.borderColor = 'rgba(0,229,255,0.6)';
      autoplanBtn.innerHTML = '<i class="fa-solid fa-bolt"></i> Auto-Plan: ON';
    } else {
      autoplanBtn.style.background = 'rgba(217, 119, 6, 0.2)';
      autoplanBtn.style.color = '#F59E0B';
      autoplanBtn.style.borderColor = 'rgba(217, 119, 6, 0.5)';
      autoplanBtn.innerHTML = '<i class="fa-solid fa-hand-pointer"></i> Auto-Plan: OFF';
    }
  }

  const autoOptBtn = document.getElementById('btn-toggle-auto-optimize');
  if (autoOptBtn) {
    if (enabled) {
      autoOptBtn.style.background = 'linear-gradient(135deg, #0284C7, #00E5FF)';
      autoOptBtn.style.color = '#FFF';
      autoOptBtn.innerHTML = '<i class="fa-solid fa-bolt"></i> ⚡ Auto-Optimize: ON';
    } else {
      autoOptBtn.style.background = 'rgba(217, 119, 6, 0.3)';
      autoOptBtn.style.color = '#F59E0B';
      autoOptBtn.innerHTML = '<i class="fa-solid fa-hand-pointer"></i> 🖐️ Auto-Optimize: OFF (Custom)';
    }
  }
}

  window.setAutoPlanMode = setAutoPlanMode;

  const autoplanBtn = document.getElementById('btn-autoplan-optimize');
  if (autoplanBtn) {
    autoplanBtn.addEventListener('click', () => {
      const nextState = !(state.flightPlanner.autoPlanBackground !== false);
      setAutoPlanMode(nextState);
      if (nextState) {
        showToast('⚡ Auto-Plan ON: Flight sequence will automatically optimize to minimize transit time.');
      } else {
        showToast('🖐️ Auto-Plan OFF: Flight sequence order is locked to your custom leg arrangement.');
      }
      recalculateFlightPlan();
    });
  }

  if (autoOptBtn) {
    autoOptBtn.addEventListener('click', () => {
      const nextState = !(state.flightPlanner.autoPlanBackground !== false);
      setAutoPlanMode(nextState);
      if (nextState) {
        showToast('⚡ Auto-Optimize ON: Flight sequence automatically optimized.');
      } else {
        showToast('🖐️ Auto-Optimize OFF: Manual waypoint & leg ordering active.');
      }
      recalculateFlightPlan();
    });
  }

  if (resetBtn) {
    resetBtn.addEventListener('click', () => {
      state.flightPlanner.circuitLegs = [];
      state.flightPlanner.manualEndpoints = {};
      state.flightPlanner.legCustomParams = {};
      state.flightPlanner.isClickMode = false;
      if (clickToggleBtn) {
        clickToggleBtn.classList.remove('active-click-mode');
        clickToggleBtn.innerHTML = '<i class="fa-solid fa-crosshairs"></i> Click Map to Build';
      }
      recalculateFlightPlan();
      showToast('Flight Plan reset');
    });
  }

  if (clickToggleBtn) {
    clickToggleBtn.addEventListener('click', () => {
      state.flightPlanner.isClickMode = !state.flightPlanner.isClickMode;
      if (state.flightPlanner.isClickMode) {
        clickToggleBtn.classList.add('active-click-mode');
        clickToggleBtn.innerHTML = '<i class="fa-solid fa-circle-check"></i> Click Mode Active!';
        showToast('Click Mode ON: Click any circuit line on the map to add to flight plan!');
      } else {
        clickToggleBtn.classList.remove('active-click-mode');
        clickToggleBtn.innerHTML = '<i class="fa-solid fa-crosshairs"></i> Click Map to Build';
      }
    });
  }

  if (pdfBtn) {
    pdfBtn.addEventListener('click', generateFlightPlannerPdfReport);
  }

  const saveMissionBtn = document.getElementById('btn-save-as-mission-pack');
  if (saveMissionBtn) {
    saveMissionBtn.addEventListener('click', saveCurrentFlightPlanAsMissionPack);
  }
}

function populatePlannerCircuitDropdown() {
  const select = document.getElementById('planner-add-circuit-select');
  if (!select || !state.circuitGroups) return;
  select.innerHTML = '<option value="">-- Pick Circuit to Inspect --</option>';

  const sortedCircuits = [...state.circuitGroups].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  sortedCircuits.forEach(c => {
    const opt = document.createElement('option');
    opt.value = c.name;
    opt.textContent = `${c.name} (${c.totalMiles.toFixed(1)} mi - ${formatVoltageLabel(c.voltage)})`;
    select.appendChild(opt);
  });
}

function addCircuitToFlightPlan(circuitName) {
  const cObj = state.circuitGroups.find(item => item.name === circuitName);
  if (!cObj) return;

  state.flightPlanner.circuitLegs.push(circuitName);
  showToast(`Added Leg: Circuit ${circuitName} (${cObj.totalMiles.toFixed(1)} mi)`);
  recalculateFlightPlan();
}

function removeCircuitFromFlightPlan(index) {
  if (index >= 0 && index < state.flightPlanner.circuitLegs.length) {
    state.flightPlanner.circuitLegs.splice(index, 1);
    recalculateFlightPlan();
  }
}

function moveFlightPlanLeg(index, direction) {
  console.log(`[moveFlightPlanLeg] Initiated: index=${index}, direction=${direction}`);
  const legs = state.flightPlanner.circuitLegs;
  console.log(`[moveFlightPlanLeg] Before:`, JSON.stringify(legs));
  const targetIndex = index + direction;
  if (targetIndex >= 0 && targetIndex < legs.length) {
    const temp = legs[index];
    legs[index] = legs[targetIndex];
    legs[targetIndex] = temp;
    console.log(`[moveFlightPlanLeg] After swap:`, JSON.stringify(legs));

    // Disables auto-plan upon manual move
    setAutoPlanMode(false);
    recalculateFlightPlan();
  } else {
    console.warn(`[moveFlightPlanLeg] Cannot move leg: targetIndex ${targetIndex} is out of bounds.`);
  }
}

function moveFuelStopLeg(direction) {
  let currentIdx = state.flightPlanner.fuelStopIndex;
  if (currentIdx === undefined || currentIdx < 0) {
    currentIdx = state.flightPlanner.circuitLegs.length;
  }

  const maxIdx = state.flightPlanner.circuitLegs.length;
  const newIdx = Math.max(0, Math.min(maxIdx, currentIdx + direction));

  if (newIdx !== currentIdx) {
    state.flightPlanner.fuelStopIndex = newIdx;
    recalculateFlightPlan();
    showToast(`⛽ Moved Fuel Stop ${direction < 0 ? 'Up' : 'Down'} in Flight Sequence!`);
  }
}

window.moveFlightPlanLeg = moveFlightPlanLeg;
window.moveFuelStopLeg = moveFuelStopLeg;
window.removeCircuitFromFlightPlan = removeCircuitFromFlightPlan;

function findNearestPointOnCircuit(cObj, latLng) {
  let minD = Infinity;
  let nearestPt = { lat: latLng.lat, lng: latLng.lng };

  if (cObj && cObj.features) {
    cObj.features.forEach(feat => {
      const geom = feat.geometry || {};
      const coords = geom.coordinates || [];
      const lines = geom.type === 'LineString' ? [coords] : (geom.type === 'MultiLineString' ? coords : []);

      lines.forEach(line => {
        line.forEach(pt => {
          const d = calcDistanceMiles(latLng.lat, latLng.lng, pt[1], pt[0]);
          if (d < minD) {
            minD = d;
            nearestPt = { lat: pt[1], lng: pt[0] };
          }
        });
      });
    });
  }
  return nearestPt;
}

function findCircuitEndpoints(cObj, fromPt) {
  const fp = state.flightPlanner;

  // Check if manual custom endpoints were assigned to this circuit
  if (fp.manualEndpoints && fp.manualEndpoints[cObj.name]) {
    const custom = fp.manualEndpoints[cObj.name];
    if (custom.entryPt && custom.exitPt) {
      return { entryPt: custom.entryPt, exitPt: custom.exitPt };
    }
  }

  let allPts = [];
  if (cObj.features) {
    cObj.features.forEach(feat => {
      const geom = feat.geometry || {};
      const coords = geom.coordinates || [];
      const lines = geom.type === 'LineString' ? [coords] : (geom.type === 'MultiLineString' ? coords : []);
      lines.forEach(line => {
        line.forEach(pt => allPts.push({ lat: pt[1], lng: pt[0] }));
      });
    });
  }

  if (allPts.length === 0) {
    const center = (cObj.bounds && cObj.bounds.isValid()) ? cObj.bounds.getCenter() : { lat: fromPt.lat, lng: fromPt.lng };
    return { entryPt: center, exitPt: center };
  }

  let entryPt = allPts[0];
  if (fp.manualEndpoints && fp.manualEndpoints[cObj.name] && fp.manualEndpoints[cObj.name].entryPt) {
    entryPt = fp.manualEndpoints[cObj.name].entryPt;
  } else {
    let minEntryDist = Infinity;
    allPts.forEach(pt => {
      let d = calcDistanceMiles(fromPt.lat, fromPt.lng, pt.lat, pt.lng);
      if (d < minEntryDist) {
        minEntryDist = d;
        entryPt = pt;
      }
    });
  }

  let exitPt = allPts[0];
  if (fp.manualEndpoints && fp.manualEndpoints[cObj.name] && fp.manualEndpoints[cObj.name].exitPt) {
    exitPt = fp.manualEndpoints[cObj.name].exitPt;
  } else {
    let maxExitDist = -1;
    allPts.forEach(pt => {
      let d = calcDistanceMiles(entryPt.lat, entryPt.lng, pt.lat, pt.lng);
      if (d > maxExitDist) {
        maxExitDist = d;
        exitPt = pt;
      }
    });
  }

  return { entryPt, exitPt };
}

function optimizeCircuitSequence(circuitNamesList, startPos, endPos) {
  if (circuitNamesList.length <= 1) return [...circuitNamesList];

  let unvisited = [...circuitNamesList];
  let optimizedSequence = [];
  let currentPos = { lat: startPos.lat, lng: startPos.lng };

  while (unvisited.length > 0) {
    let bestIdx = -1;
    let minDist = Infinity;

    for (let i = 0; i < unvisited.length; i++) {
      const cName = unvisited[i];
      const cObj = state.circuitGroups.find(item => item.name === cName);
      if (!cObj) continue;

      const { entryPt } = findCircuitEndpoints(cObj, currentPos);
      const dist = calcDistanceMiles(currentPos.lat, currentPos.lng, entryPt.lat, entryPt.lng);

      if (dist < minDist) {
        minDist = dist;
        bestIdx = i;
      }
    }

    if (bestIdx !== -1) {
      const nextCircuitName = unvisited[bestIdx];
      optimizedSequence.push(nextCircuitName);
      unvisited.splice(bestIdx, 1);

      // Advance currentPos to exit point of this circuit for full circuit coverage before transition
      const cObj = state.circuitGroups.find(item => item.name === nextCircuitName);
      if (cObj) {
        const { exitPt } = findCircuitEndpoints(cObj, currentPos);
        currentPos = { lat: exitPt.lat, lng: exitPt.lng };
      }
    } else {
      optimizedSequence.push(...unvisited);
      break;
    }
  }

  return optimizedSequence;
}

function renameMissionPack(mId, event) {
  if (event) event.stopPropagation();

  let mission = (state.customMissions || []).find(m => m.id === mId);
  let isCustom = true;
  if (!mission) {
    mission = (state.missionPackages || []).find(m => m.id === mId);
    isCustom = false;
  }

  if (!mission) return;

  const currentTitle = mission.title || '';
  const newTitle = prompt('Enter new name for mission package:', currentTitle);

  if (newTitle === null) return; // User cancelled
  const trimmed = newTitle.trim();
  if (!trimmed) {
    showToast('⚠️ Mission name cannot be empty!');
    return;
  }

  mission.title = trimmed;

  if (isCustom) {
    saveCustomMissionsToStorage();
  } else {
    try {
      let renamedMap = JSON.parse(localStorage.getItem('indiana_grid_renamed_missions') || '{}');
      renamedMap[mId] = trimmed;
      localStorage.setItem('indiana_grid_renamed_missions', JSON.stringify(renamedMap));
    } catch (e) {
      console.error('Failed to save renamed mission titles:', e);
    }
  }

  buildMissionDropdownOptions();
  renderCustomMissionCardsList();
  renderMissionCardsList();

  if (state.activeMission && state.activeMission.id === mId) {
    state.activeMission.title = trimmed;
    renderMissionDetailCard(state.activeMission);
  }

  showToast(`✏️ Renamed mission pack to: "${trimmed}"`);
}
window.renameMissionPack = renameMissionPack;

function updateLegParam(legKey, paramName, value) {
  const parsed = parseFloat(value);
  if (isNaN(parsed) || parsed < 0) return;
  if (!state.flightPlanner.legCustomParams[legKey]) {
    state.flightPlanner.legCustomParams[legKey] = {};
  }
  state.flightPlanner.legCustomParams[legKey][paramName] = parsed;
  recalculateFlightPlan();
}

window.updateLegParam = updateLegParam;

function applyGlobalFlightPlannerSettings(showToastNotice = true) {
  const trInput = document.getElementById('planner-global-transit-speed');
  const inspInput = document.getElementById('planner-global-insp-speed');
  const fuelInput = document.getElementById('planner-global-fuel-burn');

  const trVal = trInput ? parseFloat(trInput.value) : 110;
  const inspVal = inspInput ? parseFloat(inspInput.value) : 30;
  const fuelVal = fuelInput ? parseFloat(fuelInput.value) : 69;

  if (!isNaN(trVal) && trVal > 0) state.flightPlanner.defaultTransitSpeedKts = trVal;
  if (!isNaN(inspVal) && inspVal > 0) state.flightPlanner.defaultInspSpeedKts = inspVal;
  if (!isNaN(fuelVal) && fuelVal > 0) state.flightPlanner.defaultFuelBurnGph = fuelVal;

  const customParams = state.flightPlanner.legCustomParams || {};
  Object.keys(customParams).forEach(legKey => {
    if (legKey.startsWith('transit_') || legKey === 'fuel_transit' || legKey === 'final_transit') {
      if (!isNaN(trVal) && trVal > 0) customParams[legKey].transitSpeedKts = trVal;
      if (!isNaN(fuelVal) && fuelVal > 0) customParams[legKey].fuelBurnGph = fuelVal;
    }
    if (legKey.startsWith('insp_')) {
      if (!isNaN(inspVal) && inspVal > 0) customParams[legKey].inspSpeedKts = inspVal;
      if (!isNaN(fuelVal) && fuelVal > 0) customParams[legKey].fuelBurnGph = fuelVal;
    }
    if (legKey === 'refuel_fuel_stop') {
      if (!isNaN(fuelVal) && fuelVal > 0) customParams[legKey].fuelBurnGph = fuelVal;
    }
  });

  recalculateFlightPlan();

  if (showToastNotice) {
    showToast(`⚡ Applied to all legs: ${trVal} kts Transit, ${inspVal} kts Insp, ${fuelVal} GPH Burn`);
  }
}
window.applyGlobalFlightPlannerSettings = applyGlobalFlightPlannerSettings;

function recalculateFlightPlan() {
  const startApt = INDIANA_AIRPORTS[state.flightPlanner.startAirport] || INDIANA_AIRPORTS['KVPZ'];
  const endApt = INDIANA_AIRPORTS[state.flightPlanner.endAirport] || INDIANA_AIRPORTS['KVPZ'];

  // Background Auto-Plan: Minimize enroute time by auto-sequencing circuits geographically
  if (state.flightPlanner.autoPlanBackground !== false && state.flightPlanner.circuitLegs.length > 1) {
    const fuelCode = state.flightPlanner.fuelAirport;
    const hasFuelStop = fuelCode && fuelCode !== 'NONE' && INDIANA_AIRPORTS[fuelCode];
    let fuelStopIdx = state.flightPlanner.fuelStopIndex;
    if (fuelStopIdx === undefined || fuelStopIdx < 0 || fuelStopIdx > state.flightPlanner.circuitLegs.length) {
      fuelStopIdx = state.flightPlanner.circuitLegs.length;
    }

    const optStart = state.flightPlanner.isReversed ? endApt : startApt;
    const optEnd = state.flightPlanner.isReversed ? startApt : endApt;

    if (hasFuelStop && fuelStopIdx > 0 && fuelStopIdx < state.flightPlanner.circuitLegs.length) {
      const fuelApt = INDIANA_AIRPORTS[fuelCode];
      const preFuel = state.flightPlanner.circuitLegs.slice(0, fuelStopIdx);
      const postFuel = state.flightPlanner.circuitLegs.slice(fuelStopIdx);

      const optPre = optimizeCircuitSequence(preFuel, optStart, fuelApt);
      const optPost = optimizeCircuitSequence(postFuel, fuelApt, optEnd);
      state.flightPlanner.circuitLegs = [...optPre, ...optPost];
    } else if (hasFuelStop && fuelStopIdx === state.flightPlanner.circuitLegs.length) {
      const fuelApt = INDIANA_AIRPORTS[fuelCode];
      state.flightPlanner.circuitLegs = optimizeCircuitSequence(state.flightPlanner.circuitLegs, optStart, fuelApt);
    } else if (hasFuelStop && fuelStopIdx === 0) {
      const fuelApt = INDIANA_AIRPORTS[fuelCode];
      state.flightPlanner.circuitLegs = optimizeCircuitSequence(state.flightPlanner.circuitLegs, fuelApt, optEnd);
    } else {
      state.flightPlanner.circuitLegs = optimizeCircuitSequence(state.flightPlanner.circuitLegs, optStart, optEnd);
    }

    if (state.flightPlanner.isReversed) {
      state.flightPlanner.circuitLegs.reverse();
    }
  }

  // 100% 2-Way Live Mirroring: Keep state.selectedGroup in exact sync with flightPlanner.circuitLegs
  if (!state._isSyncing) {
    state._isSyncing = true;
    state.selectedGroup = new Set(state.flightPlanner.circuitLegs);
    updateGroupHighlightMap();
    updateGroupSelectionToolbarUI();
    renderCircuitListUI();
    state._isSyncing = false;
  }

  let currentPos = { lat: startApt.lat, lng: startApt.lng };
  let legsManifest = [];
  
  let totalMiles = 0;
  let totalTransitMiles = 0;
  let totalInspectionMiles = 0;
  let totalFlightMinutes = 0;
  let totalGallonsBurned = 0;

  // Track fuel accumulated up to refueling stop
  let fuelBurnedPriorToRefuel = 0;
  let fuelBurnedAfterRefuel = 0;

  legsManifest.push({
    type: 'DEPARTURE',
    legKey: 'departure',
    title: `🚁 Departure: ${startApt.code}`,
    subtitle: startApt.name,
    distanceMi: 0,
    timeMins: 0,
    speedKts: 0
  });

  const customParams = state.flightPlanner.legCustomParams || {};
  const fuelAptCode = state.flightPlanner.fuelAirport;
  const hasFuelStop = (fuelAptCode && fuelAptCode !== 'NONE' && INDIANA_AIRPORTS[fuelAptCode]);

  const defaultTransitKts = state.flightPlanner.defaultTransitSpeedKts !== undefined ? state.flightPlanner.defaultTransitSpeedKts : 110;
  const defaultInspKts = state.flightPlanner.defaultInspSpeedKts !== undefined ? state.flightPlanner.defaultInspSpeedKts : 30;
  const defaultFuelGph = state.flightPlanner.defaultFuelBurnGph !== undefined ? state.flightPlanner.defaultFuelBurnGph : 69;

  // Determine where to insert fuel stop in the circuit legs sequence (default: at end before destination)
  let fuelStopIdx = state.flightPlanner.fuelStopIndex;
  if (fuelStopIdx === undefined || fuelStopIdx < 0 || fuelStopIdx > state.flightPlanner.circuitLegs.length) {
    fuelStopIdx = state.flightPlanner.circuitLegs.length;
    state.flightPlanner.fuelStopIndex = fuelStopIdx;
  }

  const processFuelStopLeg = () => {
    if (!hasFuelStop) return;
    const fuelApt = INDIANA_AIRPORTS[fuelAptCode];

    const fuelTransitKey = 'fuel_transit';
    const fuelLegParams = customParams[fuelTransitKey] || {};
    const fuelTransitSpeedKts = fuelLegParams.transitSpeedKts !== undefined ? fuelLegParams.transitSpeedKts : defaultTransitKts;
    const fuelTransitGph = fuelLegParams.fuelBurnGph !== undefined ? fuelLegParams.fuelBurnGph : defaultFuelGph;
    const fuelTransitMph = fuelTransitSpeedKts * 1.15078;

    const fuelTransitDist = calcDistanceMiles(currentPos.lat, currentPos.lng, fuelApt.lat, fuelApt.lng);
    const fuelTransitMins = fuelTransitMph > 0 ? Math.round((fuelTransitDist / fuelTransitMph) * 60) : 0;
    const fuelTransitGallons = Math.round((fuelTransitMins / 60) * fuelTransitGph);

    totalTransitMiles += fuelTransitDist;
    totalMiles += fuelTransitDist;
    totalFlightMinutes += fuelTransitMins;
    totalGallonsBurned += fuelTransitGallons;
    fuelBurnedPriorToRefuel += fuelTransitGallons;

    legsManifest.push({
      type: 'TRANSIT',
      legKey: fuelTransitKey,
      title: `🚀 Fuel Stop Transit Leg`,
      subtitle: `Enroute to ${fuelApt.code} (${fuelApt.name})`,
      fromPos: { ...currentPos },
      toPos: { lat: fuelApt.lat, lng: fuelApt.lng },
      distanceMi: fuelTransitDist,
      timeMins: fuelTransitMins,
      speedKts: fuelTransitSpeedKts,
      fuelGph: fuelTransitGph
    });

    // Refuel & Ground Turnaround params for Fuel Stop Airport
    const fuelStopCustom = customParams['refuel_fuel_stop'] || {};
    let turnAroundMins = 30;
    if (fuelStopCustom && fuelStopCustom.groundMins !== undefined) {
      turnAroundMins = Math.round(fuelStopCustom.groundMins);
    } else {
      const turnAroundInput = document.getElementById('planner-fuel-duration');
      if (turnAroundInput && turnAroundInput.value !== '') {
        const parsed = parseInt(turnAroundInput.value, 10);
        if (!isNaN(parsed) && parsed >= 0) turnAroundMins = parsed;
      } else if (state.flightPlanner.fuelTurnaroundMins !== undefined) {
        turnAroundMins = state.flightPlanner.fuelTurnaroundMins;
      }
    }

    const defaultRefuelGal = Math.round(fuelBurnedPriorToRefuel);
    const actualRefuelGal = (fuelStopCustom && fuelStopCustom.refuelGal !== undefined) ? Math.round(fuelStopCustom.refuelGal) : defaultRefuelGal;
    
    // Jet-A Price lookup for fuel stop airport
    const fuelAptPriceObj = state.fuelPriceCache[fuelApt.code] || { price: JET_A_BASELINES[fuelApt.code] || 5.85 };
    const fuelPricePerGal = fuelAptPriceObj.price || 5.85;
    const totalRefuelCost = actualRefuelGal * fuelPricePerGal;

    legsManifest.push({
      type: 'FUEL_STOP',
      legKey: 'refuel_fuel_stop',
      aptCode: fuelApt.code,
      aptName: fuelApt.name,
      title: `⛽ Fuel Stop: ${fuelApt.code}`,
      subtitle: `${fuelApt.name} (Jet-A Refueling)`,
      distanceMi: 0,
      timeMins: turnAroundMins,
      speedKts: 0,
      defaultRefuelGal,
      refuelGal: actualRefuelGal,
      pricePerGal: fuelPricePerGal,
      refuelCost: totalRefuelCost,
      fuelStopIndex: fuelStopIdx
    });

    totalFlightMinutes += turnAroundMins;
    currentPos = { lat: fuelApt.lat, lng: fuelApt.lng };
  };

  state.flightPlanner.circuitLegs.forEach((cName, idx) => {
    // Check if fuel stop is positioned before this circuit leg
    if (hasFuelStop && idx === fuelStopIdx) {
      processFuelStopLeg();
    }

    const cObj = state.circuitGroups.find(item => item.name === cName);
    if (!cObj) return;

    const { entryPt, exitPt } = findCircuitEndpoints(cObj, currentPos);

    // Transit Leg Key
    const transitKey = `transit_${idx}`;
    const legTransitParams = customParams[transitKey] || {};
    const transitSpeedKts = legTransitParams.transitSpeedKts !== undefined ? legTransitParams.transitSpeedKts : defaultTransitKts;
    const transitFuelGph = legTransitParams.fuelBurnGph !== undefined ? legTransitParams.fuelBurnGph : defaultFuelGph;
    const transitMph = transitSpeedKts * 1.15078;

    // Transit Leg to Circuit Entry
    const transitDist = calcDistanceMiles(currentPos.lat, currentPos.lng, entryPt.lat, entryPt.lng);
    const transitMins = transitMph > 0 ? Math.round((transitDist / transitMph) * 60) : 0;
    const transitGallons = Math.round((transitMins / 60) * transitFuelGph);

    totalTransitMiles += transitDist;
    totalMiles += transitDist;
    totalFlightMinutes += transitMins;
    totalGallonsBurned += transitGallons;

    if (hasFuelStop && idx >= fuelStopIdx) {
      fuelBurnedAfterRefuel += transitGallons;
    } else {
      fuelBurnedPriorToRefuel += transitGallons;
    }

    legsManifest.push({
      type: 'TRANSIT',
      legKey: transitKey,
      title: `🚀 Transit Leg #${idx + 1}`,
      subtitle: `Enroute to Circuit ${cName} Entry`,
      fromPos: { ...currentPos },
      toPos: { ...entryPt },
      distanceMi: transitDist,
      timeMins: transitMins,
      speedKts: transitSpeedKts,
      fuelGph: transitFuelGph
    });

    // Inspection Leg along Circuit
    const inspKey = `insp_${cName}_${idx}`;
    const legInspParams = customParams[inspKey] || {};

    const inspDist = cObj.totalMiles;
    const vStr = String(cObj.voltage);
    const is34 = (vStr === '34000' || vStr === '34500');
    const defaultInspKnots = is34 ? 20 : defaultInspKts;

    const inspSpeedKts = legInspParams.inspSpeedKts !== undefined ? legInspParams.inspSpeedKts : defaultInspKnots;
    const inspFuelGph = legInspParams.fuelBurnGph !== undefined ? legInspParams.fuelBurnGph : defaultFuelGph;

    const inspMph = inspSpeedKts * 1.15078;
    const inspMins = inspMph > 0 ? Math.round((inspDist / inspMph) * 60) : 0;
    const inspGallons = Math.round((inspMins / 60) * inspFuelGph);

    totalInspectionMiles += inspDist;
    totalMiles += inspDist;
    totalFlightMinutes += inspMins;
    totalGallonsBurned += inspGallons;

    if (hasFuelStop && idx >= fuelStopIdx) {
      fuelBurnedAfterRefuel += inspGallons;
    } else {
      fuelBurnedPriorToRefuel += inspGallons;
    }

    legsManifest.push({
      type: 'INSPECTION',
      legKey: inspKey,
      circuitName: cName,
      circuitObj: cObj,
      title: `⚡ Inspection Leg #${idx + 1}: Circuit ${cName}`,
      subtitle: `${formatVoltageLabel(cObj.voltage)} (${cObj.segmentCount} Segments)`,
      entryPt,
      exitPt,
      distanceMi: inspDist,
      timeMins: inspMins,
      speedKts: inspSpeedKts,
      fuelGph: inspFuelGph,
      index: idx
    });

    currentPos = { ...exitPt };
  });

  // If fuel stop is placed after all circuit legs
  if (hasFuelStop && fuelStopIdx >= state.flightPlanner.circuitLegs.length) {
    processFuelStopLeg();
  }

  // Final Transit Leg back to Destination Airport
  const finalTransitKey = 'final_transit';
  const finalLegParams = customParams[finalTransitKey] || {};
  const finalTransitSpeedKts = finalLegParams.transitSpeedKts !== undefined ? finalLegParams.transitSpeedKts : defaultTransitKts;
  const finalTransitGph = finalLegParams.fuelBurnGph !== undefined ? finalLegParams.fuelBurnGph : defaultFuelGph;
  const finalTransitMph = finalTransitSpeedKts * 1.15078;

  const finalTransitDist = calcDistanceMiles(currentPos.lat, currentPos.lng, endApt.lat, endApt.lng);
  const finalTransitMins = finalTransitMph > 0 ? Math.round((finalTransitDist / finalTransitMph) * 60) : 0;
  const finalTransitGallons = Math.round((finalTransitMins / 60) * finalTransitGph);

  totalTransitMiles += finalTransitDist;
  totalMiles += finalTransitDist;
  totalFlightMinutes += finalTransitMins;
  totalGallonsBurned += finalTransitGallons;

  if (hasFuelStop) {
    fuelBurnedAfterRefuel += finalTransitGallons;
  } else {
    fuelBurnedAfterRefuel += totalGallonsBurned;
  }

  legsManifest.push({
    type: 'FINAL_TRANSIT',
    legKey: finalTransitKey,
    title: `🚀 Destination Transit Leg`,
    subtitle: `Enroute to ${endApt.code}`,
    fromPos: { ...currentPos },
    toPos: { lat: endApt.lat, lng: endApt.lng },
    distanceMi: finalTransitDist,
    timeMins: finalTransitMins,
    speedKts: finalTransitSpeedKts,
    fuelGph: finalTransitGph
  });

  // Departure Airport Refuel Specs (Default: 0 gal)
  const depCustom = customParams['refuel_dep'];
  const depDefaultGal = 0;
  const depRefuelGal = (depCustom && depCustom.refuelGal !== undefined) ? Math.round(depCustom.refuelGal) : depDefaultGal;
  const depAptPriceObj = state.fuelPriceCache[startApt.code] || { price: JET_A_BASELINES[startApt.code] || 6.00 };
  const depPricePerGal = depAptPriceObj.price || 6.00;
  const depRefuelCost = depRefuelGal * depPricePerGal;

  // Attach Refuel Specs to DEPARTURE Leg in Manifest
  const depLegObj = legsManifest.find(l => l.type === 'DEPARTURE');
  if (depLegObj) {
    depLegObj.legKey = 'refuel_dep';
    depLegObj.aptCode = startApt.code;
    depLegObj.defaultRefuelGal = depDefaultGal;
    depLegObj.refuelGal = depRefuelGal;
    depLegObj.pricePerGal = depPricePerGal;
    depLegObj.refuelCost = depRefuelCost;
  }

  // Destination Airport Refuel Specs (Default: fuel burned since last refuel)
  const destCustom = customParams['refuel_dest'];
  const destDefaultGal = Math.round(fuelBurnedAfterRefuel);
  const destRefuelGal = (destCustom && destCustom.refuelGal !== undefined) ? Math.round(destCustom.refuelGal) : destDefaultGal;
  const destAptPriceObj = state.fuelPriceCache[endApt.code] || { price: JET_A_BASELINES[endApt.code] || 6.00 };
  const destPricePerGal = destAptPriceObj.price || 6.00;
  const destRefuelCost = destRefuelGal * destPricePerGal;

  legsManifest.push({
    type: 'ARRIVAL',
    legKey: 'refuel_dest',
    aptCode: endApt.code,
    title: `🚁 Arrival: ${endApt.code}`,
    subtitle: endApt.name,
    distanceMi: 0,
    timeMins: 0,
    speedKts: 0,
    defaultRefuelGal: destDefaultGal,
    refuelGal: destRefuelGal,
    pricePerGal: destPricePerGal,
    refuelCost: destRefuelCost
  });

  const hrs = Math.floor(totalFlightMinutes / 60);
  const mins = Math.round(totalFlightMinutes % 60);
  const flightTimeStr = `${hrs}h ${mins}m`;
  const estFuel = Math.round(totalGallonsBurned);

  const tTimeEl = document.getElementById('planner-total-time');
  const tMilesEl = document.getElementById('planner-total-miles');
  const trMilesEl = document.getElementById('planner-transit-miles');
  const estFuelEl = document.getElementById('planner-est-fuel');
  const legCountEl = document.getElementById('planner-leg-count');

  if (tTimeEl) tTimeEl.textContent = flightTimeStr;
  if (tMilesEl) tMilesEl.textContent = `${totalMiles.toFixed(1)} mi`;
  if (trMilesEl) trMilesEl.textContent = `${totalTransitMiles.toFixed(1)} mi`;
  if (estFuelEl) estFuelEl.textContent = `${estFuel} gal`;
  if (legCountEl) legCountEl.textContent = `${state.flightPlanner.circuitLegs.length} Circuits`;

  renderFlightPlanManifestList(legsManifest);
  renderFlightPlanMapLayers(legsManifest, startApt, endApt);

  state.flightPlanner.lastTotals = {
    totalTransitMiles,
    totalInspectionMiles,
    totalMiles,
    totalFlightMinutes,
    flightTimeStr,
    legsManifest: [...legsManifest]
  };

  updateGroupSelectionToolbarUI();
}

function renderFlightPlanManifestList(legsManifest) {
  const container = document.getElementById('planner-legs-list');
  if (!container) return;

  container.innerHTML = '';

  if (state.flightPlanner.circuitLegs.length === 0) {
    container.innerHTML = `
      <div style="padding: 20px; text-align: center; color: var(--text-dim); font-size: 0.78rem;">
        <i class="fa-solid fa-route" style="font-size: 1.4rem; margin-bottom: 8px; color: var(--accent-cyan);"></i><br>
        No circuit legs added yet.<br>Click <strong>Click Map to Build</strong> or pick a circuit above.
      </div>
    `;
    return;
  }

  legsManifest.forEach((leg, itemIdx) => {
    const item = document.createElement('div');
    item.className = 'manifest-leg-card';
    item.style.cssText = 'background: rgba(255,255,255,0.03); border: 1px solid var(--panel-border); border-radius: 6px; padding: 6px 8px; font-size: 0.75rem;';

    if (leg.type === 'DEPARTURE' || leg.type === 'ARRIVAL') {
      item.style.background = 'rgba(0, 229, 255, 0.08)';
      item.style.borderColor = 'rgba(0, 229, 255, 0.3)';
      item.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <div style="font-weight: 700; color: var(--accent-cyan);">${leg.title}</div>
          <div style="font-size: 0.68rem; color: #10B981; font-weight: 700;">$${leg.refuelCost.toFixed(2)}</div>
        </div>
        <div style="font-size: 0.68rem; color: var(--text-muted); margin-bottom: 4px;">${leg.subtitle}</div>
        <div style="display: flex; gap: 8px; background: rgba(0,0,0,0.3); padding: 4px; border-radius: 4px; font-size: 0.68rem; align-items: center;">
          <label style="display: flex; align-items: center; gap: 3px; flex: 1;">
            <span style="color: var(--text-muted);">Refuel:</span>
            <input type="number" value="${Math.round(leg.refuelGal)}" min="0" max="500" step="1" style="width: 50px; background: #0B0F19; border: 1px solid var(--panel-border); color: #10B981; border-radius: 3px; padding: 1px 3px; font-size: 0.68rem; text-align: center;" onchange="window.updateLegParam('${leg.legKey}', 'refuelGal', this.value)">
            <span style="color: var(--text-muted);">gal</span>
          </label>
          <span style="color: var(--text-muted); font-size: 0.65rem;">@ $${leg.pricePerGal.toFixed(2)}/gal</span>
        </div>
      `;
    } else if (leg.type === 'FUEL_STOP') {
      item.style.background = 'rgba(217, 119, 6, 0.12)';
      item.style.borderColor = 'rgba(217, 119, 6, 0.4)';
      item.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <strong style="color: #F59E0B;">${leg.title}</strong>
          <div style="display: flex; gap: 4px; align-items: center;">
            <button class="btn-xs btn-fs-up" title="Move Fuel Stop Up" style="padding: 2px 6px; background: rgba(217, 119, 6, 0.25); color: #F59E0B; border: 1px solid rgba(217, 119, 6, 0.5);"><i class="fa-solid fa-arrow-up" style="pointer-events: none;"></i></button>
            <button class="btn-xs btn-fs-down" title="Move Fuel Stop Down" style="padding: 2px 6px; background: rgba(217, 119, 6, 0.25); color: #F59E0B; border: 1px solid rgba(217, 119, 6, 0.5);"><i class="fa-solid fa-arrow-down" style="pointer-events: none;"></i></button>
            <span style="color: #10B981; font-size: 0.7rem; font-weight: 700; margin-left: 4px;">$${leg.refuelCost.toFixed(2)}</span>
          </div>
        </div>
        <div style="font-size: 0.68rem; color: var(--text-muted); margin-bottom: 4px;">${leg.subtitle} (+${leg.timeMins}m ground)</div>
        <div style="display: flex; gap: 6px; background: rgba(0,0,0,0.3); padding: 4px 6px; border-radius: 4px; font-size: 0.68rem; align-items: center;">
          <label style="display: flex; align-items: center; gap: 3px; flex-shrink: 0;" title="Adjust ground time for this fuel stop">
            <span style="color: var(--text-muted);">Ground:</span>
            <input type="number" value="${leg.timeMins}" min="0" max="240" step="5" style="width: 38px; background: #0B0F19; border: 1px solid var(--panel-border); color: #F59E0B; border-radius: 3px; padding: 1px 3px; font-size: 0.68rem; text-align: center;" onchange="window.updateLegParam('${leg.legKey}', 'groundMins', this.value)">
            <span style="color: var(--text-muted); margin-right: 2px;">m</span>
          </label>
          <label style="display: flex; align-items: center; gap: 3px; flex: 1; min-width: 0;" title="Adjust refuel amount">
            <span style="color: var(--text-muted);">Refuel:</span>
            <input type="number" value="${Math.round(leg.refuelGal)}" min="0" max="500" step="1" style="width: 45px; background: #0B0F19; border: 1px solid var(--panel-border); color: #10B981; border-radius: 3px; padding: 1px 3px; font-size: 0.68rem; text-align: center;" onchange="window.updateLegParam('${leg.legKey}', 'refuelGal', this.value)">
            <span style="color: var(--text-muted);">gal</span>
          </label>
          <span style="color: var(--text-muted); font-size: 0.65rem; flex-shrink: 0;">@ $${leg.pricePerGal.toFixed(2)}/gal (${leg.aptCode})</span>
        </div>
      `;
    } else if (leg.type === 'TRANSIT' || leg.type === 'FINAL_TRANSIT') {
      item.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <span style="font-weight: 600; color: #38BDF8;">${leg.title}</span>
          <span style="color: var(--text-muted); font-size: 0.7rem;">${leg.distanceMi.toFixed(1)} mi (~${leg.timeMins}m)</span>
        </div>
        <div style="font-size: 0.68rem; color: var(--text-muted); margin-bottom: 4px;">${leg.subtitle}</div>
        <div style="display: flex; gap: 8px; margin-top: 4px; background: rgba(0,0,0,0.25); padding: 4px; border-radius: 4px; font-size: 0.68rem;">
          <label style="display: flex; align-items: center; gap: 3px; flex: 1;">
            <span style="color: var(--text-muted);">Spd:</span>
            <input type="number" value="${leg.speedKts}" min="10" max="250" step="5" style="width: 45px; background: #0B0F19; border: 1px solid var(--panel-border); color: #00E5FF; border-radius: 3px; padding: 1px 3px; font-size: 0.68rem; text-align: center;" onchange="window.updateLegParam('${leg.legKey}', 'transitSpeedKts', this.value)">
            <span style="color: var(--text-muted);">kts</span>
          </label>
          <label style="display: flex; align-items: center; gap: 3px; flex: 1;">
            <span style="color: var(--text-muted);">Burn:</span>
            <input type="number" value="${leg.fuelGph}" min="1" max="150" step="1" style="width: 40px; background: #0B0F19; border: 1px solid var(--panel-border); color: #F59E0B; border-radius: 3px; padding: 1px 3px; font-size: 0.68rem; text-align: center;" onchange="window.updateLegParam('${leg.legKey}', 'fuelBurnGph', this.value)">
            <span style="color: var(--text-muted);">gph</span>
          </label>
        </div>
      `;
    } else if (leg.type === 'INSPECTION') {
      item.style.borderLeft = '3px solid #FF0055';
      item.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <strong style="color: #FFF;">${leg.title}</strong>
          <div style="display: flex; gap: 4px;">
            <button class="btn-xs btn-insp-up" data-index="${leg.index}" title="Move Leg Up" style="padding: 2px 5px;"><i class="fa-solid fa-arrow-up" style="pointer-events: none;"></i></button>
            <button class="btn-xs btn-insp-down" data-index="${leg.index}" title="Move Leg Down" style="padding: 2px 5px;"><i class="fa-solid fa-arrow-down" style="pointer-events: none;"></i></button>
            <button class="btn-xs btn-danger btn-insp-del" data-index="${leg.index}" title="Remove Leg" style="padding: 2px 5px;"><i class="fa-solid fa-trash" style="pointer-events: none;"></i></button>
          </div>
        </div>
        <div style="display: flex; justify-content: space-between; margin-top: 3px; font-size: 0.7rem; color: var(--text-muted);">
          <span>${leg.subtitle}</span>
          <span style="color: #FF0055; font-weight: 700;">${leg.distanceMi.toFixed(1)} mi (~${leg.timeMins}m)</span>
        </div>
        <div style="display: flex; gap: 8px; margin-top: 5px; background: rgba(0,0,0,0.25); padding: 4px; border-radius: 4px; font-size: 0.68rem;">
          <label style="display: flex; align-items: center; gap: 3px; flex: 1;">
            <span style="color: var(--text-muted);">Insp Spd:</span>
            <input type="number" value="${leg.speedKts}" min="5" max="150" step="5" style="width: 45px; background: #0B0F19; border: 1px solid var(--panel-border); color: #00E5FF; border-radius: 3px; padding: 1px 3px; font-size: 0.68rem; text-align: center;" onchange="window.updateLegParam('${leg.legKey}', 'inspSpeedKts', this.value)">
            <span style="color: var(--text-muted);">kts</span>
          </label>
          <label style="display: flex; align-items: center; gap: 3px; flex: 1;">
            <span style="color: var(--text-muted);">Burn:</span>
            <input type="number" value="${leg.fuelGph}" min="1" max="150" step="1" style="width: 40px; background: #0B0F19; border: 1px solid var(--panel-border); color: #F59E0B; border-radius: 3px; padding: 1px 3px; font-size: 0.68rem; text-align: center;" onchange="window.updateLegParam('${leg.legKey}', 'fuelBurnGph', this.value)">
            <span style="color: var(--text-muted);">gph</span>
          </label>
        </div>
      `;
    }

    container.appendChild(item);
  });
  
  if (!container.dataset.hasDelegation) {
    container.dataset.hasDelegation = 'true';
    container.addEventListener('click', (e) => {
      const target = e.target.closest('button');
      if (!target) return;
      
      if (target.classList.contains('btn-insp-up')) {
        moveFlightPlanLeg(parseInt(target.dataset.index, 10), -1);
      } else if (target.classList.contains('btn-insp-down')) {
        moveFlightPlanLeg(parseInt(target.dataset.index, 10), 1);
      } else if (target.classList.contains('btn-insp-del')) {
        removeCircuitFromFlightPlan(parseInt(target.dataset.index, 10));
      } else if (target.classList.contains('btn-fs-up')) {
        moveFuelStopLeg(-1);
      } else if (target.classList.contains('btn-fs-down')) {
        moveFuelStopLeg(1);
      }
    });

    // Initialize SortableJS for drag-and-drop circuit reordering
    if (typeof Sortable !== 'undefined') {
      new Sortable(container, {
        animation: 150,
        ghostClass: 'sortable-ghost',
        onEnd: function (evt) {
          if (evt.oldIndex === evt.newIndex) return;

          // Gather all items currently in the DOM container
          const items = Array.from(container.children);
          
          let newCircuitLegs = [];
          let newFuelStopIndex = state.flightPlanner.circuitLegs.length; // Default to end
          
          let currentCircuitIdx = 0;

          // Rebuild circuitLegs and fuelStopIndex from the new DOM order
          items.forEach(item => {
            // Find what type of leg this is from the UI elements
            const upBtn = item.querySelector('.btn-insp-up');
            const fsBtn = item.querySelector('.btn-fs-up');
            
            if (upBtn) {
              // This is a circuit/inspection leg
              const originalIndex = parseInt(upBtn.dataset.index, 10);
              newCircuitLegs.push(state.flightPlanner.circuitLegs[originalIndex]);
              currentCircuitIdx++;
            } else if (fsBtn) {
              // This is a fuel stop leg
              newFuelStopIndex = currentCircuitIdx;
            }
          });

          // Only apply if we actually found circuits (avoids edge cases)
          if (newCircuitLegs.length === state.flightPlanner.circuitLegs.length) {
            state.flightPlanner.circuitLegs = newCircuitLegs;
            state.flightPlanner.fuelStopIndex = newFuelStopIndex;
            setAutoPlanMode(false);
            recalculateFlightPlan();
          }
        }
      });
    }
  }
}

function renderFlightPlanMapLayers(legsManifest, startApt, endApt) {
  if (!state.map) return;

  if (state.flightPlanner.plannerLayerGroup) {
    state.map.removeLayer(state.flightPlanner.plannerLayerGroup);
  }

  const layerGroup = L.layerGroup().addTo(state.map);
  state.flightPlanner.plannerLayerGroup = layerGroup;

  const showApts = state.flightPlanner.showAirports !== false;
  const showLabels = state.flightPlanner.showAirportLabels !== false;

  if (showApts && showLabels) {
    // Add Start & End Airport Markers
    const startIcon = L.divIcon({
      className: 'airport-marker',
      html: `<div style="background: #0284C7; color: #FFF; border: 2px solid #FFF; padding: 4px 8px; border-radius: 12px; font-weight: 700; font-size: 11px; white-space: nowrap; box-shadow: 0 0 10px rgba(2,132,199,0.8);">🚁 ${startApt.code}</div>`,
      iconSize: [80, 24],
      iconAnchor: [40, 12]
    });
    L.marker([startApt.lat, startApt.lng], { icon: startIcon }).addTo(layerGroup);

    if (endApt.code !== startApt.code) {
      const endIcon = L.divIcon({
        className: 'airport-marker',
        html: `<div style="background: #16A34A; color: #FFF; border: 2px solid #FFF; padding: 4px 8px; border-radius: 12px; font-weight: 700; font-size: 11px; white-space: nowrap; box-shadow: 0 0 10px rgba(22,163,74,0.8);">🚁 ${endApt.code}</div>`,
        iconSize: [80, 24],
        iconAnchor: [40, 12]
      });
      L.marker([endApt.lat, endApt.lng], { icon: endIcon }).addTo(layerGroup);
    }

    const fuelCode = state.flightPlanner.fuelAirport;
    if (fuelCode && fuelCode !== 'NONE' && INDIANA_AIRPORTS[fuelCode]) {
      const fuelApt = INDIANA_AIRPORTS[fuelCode];
      const fuelIcon = L.divIcon({
        className: 'airport-marker-fuel',
        html: `<div style="background: #D97706; color: #FFF; border: 2px solid #FFF; padding: 4px 8px; border-radius: 12px; font-weight: 700; font-size: 11px; white-space: nowrap; box-shadow: 0 0 10px rgba(217,119,6,0.9);">⛽ ${fuelApt.code} (Fuel Stop)</div>`,
        iconSize: [120, 24],
        iconAnchor: [60, 12]
      });
      L.marker([fuelApt.lat, fuelApt.lng], { icon: fuelIcon }).addTo(layerGroup);
    }
  }

  let waypointCount = 1;

  legsManifest.forEach(leg => {
    if (leg.type === 'TRANSIT' || leg.type === 'FINAL_TRANSIT') {
      L.polyline([[leg.fromPos.lat, leg.fromPos.lng], [leg.toPos.lat, leg.toPos.lng]], {
        color: '#00E5FF',
        weight: 3.5,
        dashArray: '8, 8',
        opacity: 0.95
      }).addTo(layerGroup);

    } else if (leg.type === 'INSPECTION' && leg.circuitObj && leg.circuitObj.features) {
      const cObj = leg.circuitObj;
      
      const LEG_COLORS = [
        '#00E5FF', // Neon Cyan
        '#A855F7', // Bright Purple
        '#F97316', // Bright Orange
        '#EAB308', // Gold Yellow
        '#EC4899', // Pink
        '#14B8A6', // Teal
        '#6366F1', // Indigo
        '#22C55E'  // Green
      ];
      const legColor = LEG_COLORS[(waypointCount - 1) % LEG_COLORS.length];

      leg.circuitObj.features.forEach(feat => {
        const geom = feat.geometry || {};
        const coords = geom.coordinates || [];
        const lines = geom.type === 'LineString' ? [coords] : (geom.type === 'MultiLineString' ? coords : []);
        
        lines.forEach(lineCoords => {
          const latLngs = lineCoords.map(pt => [pt[1], pt[0]]);
          if (latLngs.length > 0) {
            const poly = L.polyline(latLngs, {
              color: legColor,
              weight: 6,
              opacity: 0.95
            }).addTo(layerGroup);

            // Allow clicking segment to set Entry / Exit point when Auto-Optimize is OFF or in Manual Mode
            poly.on('click', (e) => {
              if (e.originalEvent) e.originalEvent.stopPropagation();
              const clickedPt = findNearestPointOnCircuit(cObj, e.latlng);
              const fp = state.flightPlanner;

              fp.autoOptimize = false;
              if (!fp.manualEndpoints[cObj.name]) {
                fp.manualEndpoints[cObj.name] = { entryPt: clickedPt };
                showToast(`🟢 Set Entry Point for Circuit ${cObj.name}! Click again to set Exit Point.`);
              } else if (!fp.manualEndpoints[cObj.name].exitPt) {
                fp.manualEndpoints[cObj.name].exitPt = clickedPt;
                showToast(`🔴 Set Exit Point for Circuit ${cObj.name}! Manual endpoints committed.`);
              } else {
                fp.manualEndpoints[cObj.name] = { entryPt: clickedPt };
                showToast(`🟢 Updated Entry Point for Circuit ${cObj.name}!`);
              }

              const autoOptBtn = document.getElementById('btn-toggle-auto-optimize');
              if (autoOptBtn) {
                autoOptBtn.innerHTML = '<i class="fa-solid fa-hand-pointer"></i> 🖐️ Auto-Optimize: OFF (Custom)';
                autoOptBtn.style.background = 'rgba(217, 119, 6, 0.3)';
              }

              recalculateFlightPlan();
            });
          }
        });
      });

      const isCustom = state.flightPlanner.manualEndpoints && state.flightPlanner.manualEndpoints[cObj.name];
      const statusTag = isCustom ? 'Custom' : 'Auto';

      // Draggable Entry Point Marker (🟢 Entry)
      const entryIcon = L.divIcon({
        className: 'wp-marker-entry',
        html: `
          <div title="Drag to set custom Entry Point for Circuit ${cObj.name}" style="background: ${legColor}; color: #0B0F19; border: 2px solid #FFF; padding: 2px 7px; border-radius: 12px; font-weight: 700; font-size: 10px; white-space: nowrap; box-shadow: 0 0 10px ${legColor}; cursor: grab; display: inline-flex; align-items: center; gap: 3px;">
            <span>🟢 Entry #${waypointCount}</span>
            <span style="font-size: 8px; opacity: 0.8;">(${statusTag})</span>
          </div>
        `,
        iconSize: [110, 22],
        iconAnchor: [55, 26]
      });

      const entryMarker = L.marker([leg.entryPt.lat, leg.entryPt.lng], {
        icon: entryIcon,
        draggable: true
      }).addTo(layerGroup);

      entryMarker.on('dragend', (e) => {
        const newPos = e.target.getLatLng();
        const snappedPt = findNearestPointOnCircuit(cObj, newPos);

        const fp = state.flightPlanner;
        fp.autoOptimize = false;
        if (!fp.manualEndpoints[cObj.name]) {
          fp.manualEndpoints[cObj.name] = {};
        }
        fp.manualEndpoints[cObj.name].entryPt = snappedPt;

        const autoOptBtn = document.getElementById('btn-toggle-auto-optimize');
        if (autoOptBtn) {
          autoOptBtn.innerHTML = '<i class="fa-solid fa-hand-pointer"></i> 🖐️ Auto-Optimize: OFF (Custom)';
          autoOptBtn.style.background = 'rgba(217, 119, 6, 0.3)';
        }

        showToast(`📍 Committed custom Entry Point for Circuit ${cObj.name}! (Auto-Optimize OFF)`);
        recalculateFlightPlan();
      });

      // Draggable Exit Point Marker (🔴 Exit)
      const exitIcon = L.divIcon({
        className: 'wp-marker-exit',
        html: `
          <div title="Drag to set custom Exit Point for Circuit ${cObj.name}" style="background: ${legColor}; color: #0B0F19; border: 2px solid #FFF; padding: 2px 7px; border-radius: 12px; font-weight: 700; font-size: 10px; white-space: nowrap; box-shadow: 0 0 10px ${legColor}; cursor: grab; display: inline-flex; align-items: center; gap: 3px;">
            <span>🔴 Exit #${waypointCount}</span>
            <span style="font-size: 8px; opacity: 0.8;">(${statusTag})</span>
          </div>
        `,
        iconSize: [100, 22],
        iconAnchor: [50, -4]
      });

      const exitMarker = L.marker([leg.exitPt.lat, leg.exitPt.lng], {
        icon: exitIcon,
        draggable: true
      }).addTo(layerGroup);

      exitMarker.on('dragend', (e) => {
        const newPos = e.target.getLatLng();
        const snappedPt = findNearestPointOnCircuit(cObj, newPos);

        const fp = state.flightPlanner;
        fp.autoOptimize = false;
        if (!fp.manualEndpoints[cObj.name]) {
          fp.manualEndpoints[cObj.name] = {};
        }
        fp.manualEndpoints[cObj.name].exitPt = snappedPt;

        const autoOptBtn = document.getElementById('btn-toggle-auto-optimize');
        if (autoOptBtn) {
          autoOptBtn.innerHTML = '<i class="fa-solid fa-hand-pointer"></i> 🖐️ Auto-Optimize: OFF (Custom)';
          autoOptBtn.style.background = 'rgba(217, 119, 6, 0.3)';
        }

        showToast(`📍 Committed custom Exit Point for Circuit ${cObj.name}! (Auto-Optimize OFF)`);
        recalculateFlightPlan();
      });

      waypointCount++;
    }
  });
}

function generateFlightPlannerPdfReport() {
  const fp = state.flightPlanner;
  const startApt = INDIANA_AIRPORTS[fp.startAirport] || INDIANA_AIRPORTS['KVPZ'];
  const endApt = INDIANA_AIRPORTS[fp.endAirport] || INDIANA_AIRPORTS['KVPZ'];
  const fuelCode = fp.fuelAirport;
  const fuelApt = (fuelCode && fuelCode !== 'NONE' && INDIANA_AIRPORTS[fuelCode]) ? INDIANA_AIRPORTS[fuelCode] : null;

  let fuelStopIdx = fp.fuelStopIndex;
  if (fuelStopIdx === undefined || fuelStopIdx < 0 || fuelStopIdx > fp.circuitLegs.length) {
    fuelStopIdx = fp.circuitLegs.length;
  }

  if (fp.circuitLegs.length === 0) {
    alert('Please add at least one circuit leg to generate a flight briefing PDF.');
    return;
  }

  const legs = fp.circuitLegs.map(name => state.circuitGroups.find(c => c.name === name)).filter(Boolean);
  const features = legs.flatMap(c => c.features);

  // Compute exact multi-leg flight telemetry matching flight planner calculations
  let currentPos = { lat: startApt.lat, lng: startApt.lng };
  let totalInspectionMiles = 0;
  let totalTransitMiles = 0;
  let totalFlightMinutes = 0;
  let totalGroundMins = 0;
  let totalGallonsBurned = 0;
  let fuelBurnedPriorToRefuel = 0;
  let fuelBurnedAfterRefuel = 0;

  const defaultTransitKts = fp.defaultTransitSpeedKts || 110;
  const defaultInspKts = fp.defaultInspSpeedKts || 30;
  const defaultFuelGph = fp.defaultFuelBurnGph || 69;

  const customParams = fp.legCustomParams || {};
  const detailedLegs = [];
  const fullSequenceManifest = [];
  const transitPolylines = [];

  // Departure Leg Refueling
  const depCustom = customParams['refuel_dep'];
  const depDefaultGal = 0;
  const depRefuelGal = (depCustom && depCustom.refuelGal !== undefined) ? Math.round(depCustom.refuelGal) : depDefaultGal;
  const depAptPriceObj = state.fuelPriceCache[startApt.code] || { price: JET_A_BASELINES[startApt.code] || 6.00 };
  const depPricePerGal = depAptPriceObj.price || 6.00;
  const depRefuelCost = depRefuelGal * depPricePerGal;

  fullSequenceManifest.push({
    type: 'DEPARTURE',
    tag: 'DEP',
    name: `🚁 Departure: ${startApt.code}`,
    subtitle: `${startApt.name}${depRefuelGal > 0 ? ` &bull; Refuel: ${Math.round(depRefuelGal)} gal @ $${depPricePerGal.toFixed(2)}/gal ($${depRefuelCost.toFixed(2)})` : ''}`,
    voltage: 'Base',
    length: '-',
    transitInfo: '-',
    inspSpeed: '-',
    timeMins: 0,
    fuelGal: 0,
    refuelInfo: depRefuelGal > 0 ? `+${Math.round(depRefuelGal)} gal ($${depRefuelCost.toFixed(2)})` : '0 gal ($0.00)',
    waypoint: `N${startApt.lat.toFixed(3)}° W${Math.abs(startApt.lng).toFixed(3)}°`,
    nearestApt: `${startApt.code} (Base)`
  });

  let turnAroundMins = 0;
  let fuelStopRefuelGal = 0;
  let fuelStopPricePerGal = 0;
  let fuelStopRefuelCost = 0;

  const processPdfFuelStopLeg = () => {
    if (!fuelApt) return;
    const fuelStopCustom = customParams['refuel_fuel_stop'];
    if (fuelStopCustom && fuelStopCustom.groundMins !== undefined) {
      turnAroundMins = Math.round(fuelStopCustom.groundMins);
    } else {
      turnAroundMins = parseInt(document.getElementById('planner-fuel-duration')?.value) || 30;
    }

    const fuelTransitDist = calcDistanceMiles(currentPos.lat, currentPos.lng, fuelApt.lat, fuelApt.lng);
    const fuelTransitSpeedKts = customParams['fuel_transit'] && customParams['fuel_transit'].transitSpeedKts !== undefined ? customParams['fuel_transit'].transitSpeedKts : defaultTransitKts;
    const fuelTransitGph = customParams['fuel_transit'] && customParams['fuel_transit'].fuelBurnGph !== undefined ? customParams['fuel_transit'].fuelBurnGph : defaultFuelGph;
    const fuelTransitMins = Math.round((fuelTransitDist / (fuelTransitSpeedKts * 1.15078)) * 60);
    const fuelTransitGal = Math.round((fuelTransitMins / 60) * fuelTransitGph);

    transitPolylines.push({
      from: { ...currentPos },
      to: { lat: fuelApt.lat, lng: fuelApt.lng }
    });

    totalTransitMiles += fuelTransitDist;
    totalFlightMinutes += (fuelTransitMins + turnAroundMins);
    totalGroundMins += turnAroundMins;
    totalGallonsBurned += fuelTransitGal;
    fuelBurnedPriorToRefuel += fuelTransitGal;
    const defaultRefuelGal = Math.round(fuelBurnedPriorToRefuel);
    fuelStopRefuelGal = (fuelStopCustom && fuelStopCustom.refuelGal !== undefined) ? Math.round(fuelStopCustom.refuelGal) : defaultRefuelGal;
    const fuelAptPriceObj = state.fuelPriceCache[fuelApt.code] || { price: JET_A_BASELINES[fuelApt.code] || 5.85 };
    fuelStopPricePerGal = fuelAptPriceObj.price || 5.85;
    fuelStopRefuelCost = fuelStopRefuelGal * fuelStopPricePerGal;

    fullSequenceManifest.push({
      type: 'FUEL_STOP',
      tag: 'FUEL',
      name: `⛽ Fuel Stop: ${fuelApt.code}`,
      subtitle: `${fuelApt.name} (${turnAroundMins}m Turnaround) &bull; Replaced Enroute Fuel Burn`,
      voltage: 'Jet-A',
      length: `${fuelTransitDist.toFixed(1)} mi`,
      transitInfo: `${fuelTransitSpeedKts} kts`,
      inspSpeed: '-',
      timeMins: fuelTransitMins + turnAroundMins,
      fuelGal: fuelTransitGal,
      refuelInfo: `+${Math.round(fuelStopRefuelGal)} gal @ $${fuelStopPricePerGal.toFixed(2)}/gal ($${fuelStopRefuelCost.toFixed(2)})`,
      waypoint: `N${fuelApt.lat.toFixed(3)}° W${Math.abs(fuelApt.lng).toFixed(3)}°`,
      nearestApt: `${fuelApt.code} (Station)`
    });

    currentPos = { lat: fuelApt.lat, lng: fuelApt.lng };
  };

  fp.circuitLegs.forEach((cName, idx) => {
    if (fuelApt && idx === fuelStopIdx) {
      processPdfFuelStopLeg();
    }

    const cObj = state.circuitGroups.find(item => item.name === cName);
    if (!cObj) return;

    const { entryPt, exitPt } = findCircuitEndpoints(cObj, currentPos);

    // Transit Leg
    const transitKey = `transit_${idx}`;
    const legTransitParams = customParams[transitKey] || {};
    const transitSpeedKts = legTransitParams.transitSpeedKts !== undefined ? legTransitParams.transitSpeedKts : defaultTransitKts;
    const transitFuelGph = legTransitParams.fuelBurnGph !== undefined ? legTransitParams.fuelBurnGph : defaultFuelGph;
    const transitMph = transitSpeedKts * 1.15078;
    const transitDist = calcDistanceMiles(currentPos.lat, currentPos.lng, entryPt.lat, entryPt.lng);
    const transitMins = transitMph > 0 ? Math.round((transitDist / transitMph) * 60) : 0;
    const transitGal = Math.round((transitMins / 60) * transitFuelGph);

    transitPolylines.push({
      from: { ...currentPos },
      to: { ...entryPt }
    });

    totalTransitMiles += transitDist;
    totalFlightMinutes += transitMins;
    totalGallonsBurned += transitGal;
    if (fuelApt && idx >= fuelStopIdx) {
      fuelBurnedAfterRefuel += transitGal;
    } else {
      fuelBurnedPriorToRefuel += transitGal;
    }

    fullSequenceManifest.push({
      type: 'TRANSIT',
      tag: `TR #${idx + 1}`,
      name: `🚀 Enroute Transit to Circuit ${cName}`,
      subtitle: `Direct to Entry Waypoint`,
      voltage: 'Transit',
      length: `${transitDist.toFixed(1)} mi`,
      transitInfo: `${transitSpeedKts} kts`,
      inspSpeed: '-',
      timeMins: transitMins,
      fuelGal: transitGal,
      refuelInfo: '-',
      waypoint: `N${entryPt.lat.toFixed(3)}° W${Math.abs(entryPt.lng).toFixed(3)}°`,
      nearestApt: '-'
    });

    // Inspection Leg
    const inspKey = `insp_${cName}_${idx}`;
    const legInspParams = customParams[inspKey] || {};
    const inspDist = cObj.totalMiles;
    const vStr = String(cObj.voltage);
    const is34 = (vStr === '34000' || vStr === '34500');
    const defaultInspKnots = is34 ? (defaultInspKts ? Math.round(defaultInspKts * 0.66) : 20) : defaultInspKts;
    const inspSpeedKts = legInspParams.inspSpeedKts !== undefined ? legInspParams.inspSpeedKts : defaultInspKnots;
    const inspFuelGph = legInspParams.fuelBurnGph !== undefined ? legInspParams.fuelBurnGph : defaultFuelGph;
    const inspMph = inspSpeedKts * 1.15078;
    const inspMins = inspMph > 0 ? Math.round((inspDist / inspMph) * 60) : 0;
    const inspGal = Math.round((inspMins / 60) * inspFuelGph);

    totalInspectionMiles += inspDist;
    totalFlightMinutes += inspMins;
    totalGallonsBurned += inspGal;
    if (fuelApt && idx >= fuelStopIdx) {
      fuelBurnedAfterRefuel += inspGal;
    } else {
      fuelBurnedPriorToRefuel += inspGal;
    }

    // Determine nearest Jet-A emergency airport for this circuit
    let cCenter = (cObj.bounds && cObj.bounds.isValid()) ? cObj.bounds.getCenter() : entryPt;
    let nearestApt = Object.values(INDIANA_AIRPORTS).map(apt => ({
      ...apt,
      dist: calcDistanceMiles(cCenter.lat, cCenter.lng, apt.lat, apt.lng)
    })).sort((a, b) => a.dist - b.dist)[0];

    detailedLegs.push({
      index: idx + 1,
      circuitName: cName,
      voltage: formatVoltageLabel(cObj.voltage),
      miles: inspDist,
      segments: cObj.segmentCount,
      operatingAreas: cObj.operatingAreasList.join(', ') || 'N/A',
      transitDist,
      transitMins,
      transitSpeedKts,
      inspMins,
      inspSpeedKts,
      inspFuelGph,
      totalLegMins: transitMins + inspMins,
      totalLegGal: transitGal + inspGal,
      entryPt,
      exitPt,
      nearestApt
    });

    fullSequenceManifest.push({
      type: 'INSPECTION',
      tag: `LEG #${idx + 1}`,
      name: `⚡ Circuit ${cName}`,
      subtitle: cObj.operatingAreasList.join(', ') || 'Line Inspection',
      voltage: formatVoltageLabel(cObj.voltage),
      length: `${inspDist.toFixed(1)} mi`,
      transitInfo: '-',
      inspSpeed: `${inspSpeedKts} kts`,
      timeMins: inspMins,
      fuelGal: inspGal,
      refuelInfo: '-',
      waypoint: `N${entryPt.lat.toFixed(3)}° W${Math.abs(entryPt.lng).toFixed(3)}°`,
      nearestApt: `${nearestApt.code} (${nearestApt.dist.toFixed(1)} mi)`
    });

    currentPos = { lat: exitPt.lat, lng: exitPt.lng };
  });

  if (fuelApt && fuelStopIdx >= fp.circuitLegs.length) {
    processPdfFuelStopLeg();
  }

  // Final Transit back to Destination
  const finalTransitKey = 'final_transit';
  const finalLegParams = customParams[finalTransitKey] || {};
  const finalSpeedKts = finalLegParams.transitSpeedKts !== undefined ? finalLegParams.transitSpeedKts : defaultTransitKts;
  const finalGph = finalLegParams.fuelBurnGph !== undefined ? finalLegParams.fuelBurnGph : defaultFuelGph;
  const finalDist = calcDistanceMiles(currentPos.lat, currentPos.lng, endApt.lat, endApt.lng);
  const finalMins = Math.round((finalDist / (finalSpeedKts * 1.15078)) * 60);
  const finalGal = Math.round((finalMins / 60) * finalGph);

  transitPolylines.push({
    from: { ...currentPos },
    to: { lat: endApt.lat, lng: endApt.lng }
  });

  totalTransitMiles += finalDist;
  totalFlightMinutes += finalMins;
  totalGallonsBurned += finalGal;

  if (fuelApt) {
    fuelBurnedAfterRefuel += finalGal;
  } else {
    fuelBurnedAfterRefuel += totalGallonsBurned;
  }

  fullSequenceManifest.push({
    type: 'TRANSIT',
    tag: 'DEST TR',
    name: `🚀 Destination Transit Leg`,
    subtitle: `Enroute to ${endApt.code}`,
    voltage: 'Transit',
    length: `${finalDist.toFixed(1)} mi`,
    transitInfo: `${finalSpeedKts} kts`,
    inspSpeed: '-',
    timeMins: finalMins,
    fuelGal: finalGal,
    refuelInfo: '-',
    waypoint: `N${endApt.lat.toFixed(3)}° W${Math.abs(endApt.lng).toFixed(3)}°`,
    nearestApt: `${endApt.code}`
  });

  // Destination Refuel Specs
  const destCustom = customParams['refuel_dest'];
  const destDefaultGal = Math.round(fuelBurnedAfterRefuel);
  const destRefuelGal = (destCustom && destCustom.refuelGal !== undefined) ? Math.round(destCustom.refuelGal) : destDefaultGal;
  const destAptPriceObj = state.fuelPriceCache[endApt.code] || { price: JET_A_BASELINES[endApt.code] || 6.00 };
  const destPricePerGal = destAptPriceObj.price || 6.00;
  const destRefuelCost = destRefuelGal * destPricePerGal;

  fullSequenceManifest.push({
    type: 'ARRIVAL',
    tag: 'DEST',
    name: `🚁 Arrival: ${endApt.code}`,
    subtitle: `${endApt.name}${destRefuelGal > 0 ? ` &bull; Post-Flight Refuel: ${Math.round(destRefuelGal)} gal @ $${destPricePerGal.toFixed(2)}/gal ($${destRefuelCost.toFixed(2)})` : ''}`,
    voltage: 'Dest',
    length: '-',
    transitInfo: '-',
    inspSpeed: '-',
    timeMins: 0,
    fuelGal: 0,
    refuelInfo: destRefuelGal > 0 ? `+${Math.round(destRefuelGal)} gal ($${destRefuelCost.toFixed(2)})` : '0 gal ($0.00)',
    waypoint: `N${endApt.lat.toFixed(3)}° W${Math.abs(endApt.lng).toFixed(3)}°`,
    nearestApt: `${endApt.code}`
  });

  const totalRefuelGallonsSum = depRefuelGal + fuelStopRefuelGal + destRefuelGal;
  const totalRefuelCostSum = depRefuelCost + fuelStopRefuelCost + destRefuelCost;

  const totalFlightMiles = totalTransitMiles + totalInspectionMiles;
  const hrs = Math.floor(totalFlightMinutes / 60);
  const mins = Math.round(totalFlightMinutes % 60);
  const totalTimeStr = `${hrs}h ${mins}m`;

  const totalPureFlightMinutes = totalFlightMinutes - totalGroundMins;
  const pfHrs = Math.floor(totalPureFlightMinutes / 60);
  const pfMins = Math.round(totalPureFlightMinutes % 60);
  const pureFlightTimeStr = `${pfHrs}h ${pfMins}m`;

  // Airport Badges Array for Map
  const airportMapSet = new Map();
  airportMapSet.set(startApt.code, { ...startApt, role: 'DEP' });
  if (fuelApt) airportMapSet.set(fuelApt.code, { ...fuelApt, role: 'FUEL' });
  if (endApt.code !== startApt.code) airportMapSet.set(endApt.code, { ...endApt, role: 'DEST' });

  // Include nearest emergency airports on map if not already present
  detailedLegs.forEach(leg => {
    if (!airportMapSet.has(leg.nearestApt.code)) {
      airportMapSet.set(leg.nearestApt.code, { ...leg.nearestApt, role: 'ENROUTE' });
    }
  });
  const allAirportsToRender = Array.from(airportMapSet.values());

  // Get current weather status for departure airport
  const startWx = state.weatherCache[startApt.code]?.metar;
  const startWxRules = parseFlightRules(startWx);
  const wxVis = startWx?.visib !== undefined ? `${startWx.visib}SM` : '10+SM';
  const wxWind = startWx?.wspd !== undefined ? `${startWx.wdir || 'VRB'}°@${startWx.wspd}kt` : 'VRB@0kt';

  const reportWin = window.open('', '_blank');
  if (!reportWin) {
    alert('Pop-up blocked! Please allow pop-ups to view flight briefing.');
    return;
  }

  const html = `<!DOCTYPE html><html>
  <head>
    <meta charset="UTF-8">
    <title>FLIGHT BRIEFING MANIFEST — ${startApt.code} TO ${endApt.code}</title>
    <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" crossorigin=""/>
    <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;600;700;800&display=swap" rel="stylesheet">
    <style>
      @page { size: letter portrait; margin: 0.25in; }
      * { box-sizing: border-box; }
      body { font-family: 'Outfit', sans-serif; margin: 0; padding: 0; background: #fff; color: #0F172A; font-size: 10px; line-height: 1.25; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      
      .brief-container { padding: 8px; }
      .header-banner { background: #0F172A; color: #FFF; padding: 8px 12px; border-radius: 6px; display: flex; justify-content: space-between; align-items: center; border-left: 6px solid #0284C7; margin-bottom: 8px; }
      .header-title { font-size: 15px; font-weight: 800; letter-spacing: 0.05em; text-transform: uppercase; color: #38BDF8; }
      .header-subtitle { font-size: 9px; color: #94A3B8; margin-top: 2px; }
      .print-btn { background: #0284C7; color: #FFF; border: none; padding: 5px 12px; border-radius: 4px; font-weight: 700; font-size: 10px; cursor: pointer; }
      @media print { .print-btn { display: none !important; } }

      .grid-5 { display: grid; grid-template-columns: repeat(5, 1fr); gap: 6px; margin-bottom: 8px; }
      .metric-card { background: #F8FAFC; border: 1px solid #E2E8F0; padding: 6px 8px; border-radius: 5px; }
      .metric-lbl { font-size: 8px; color: #64748B; font-weight: 700; text-transform: uppercase; }
      .metric-val { font-size: 13px; font-weight: 800; color: #0284C7; margin-top: 1px; }

      .split-sec { display: grid; grid-template-columns: 1.1fr 0.9fr; gap: 8px; margin-bottom: 8px; }
      #briefing-map { height: 260px; width: 100%; border-radius: 5px; border: 1px solid #CBD5E1; }

      .box-panel { background: #F8FAFC; border: 1px solid #CBD5E1; border-radius: 5px; padding: 8px; }
      .panel-title { font-size: 9px; font-weight: 800; text-transform: uppercase; color: #0F172A; margin-bottom: 6px; border-bottom: 1.5px solid #0284C7; padding-bottom: 2px; display: flex; justify-content: space-between; }

      table.manifest-tbl { width: 100%; border-collapse: collapse; font-size: 8.5px; margin-bottom: 6px; }
      table.manifest-tbl th { background: #0F172A; color: #FFF; padding: 4px 5px; text-align: left; font-size: 7.5px; font-weight: 700; text-transform: uppercase; }
      table.manifest-tbl td { padding: 3.5px 5px; border-bottom: 1px solid #E2E8F0; font-size: 8px; }
      table.manifest-tbl tr.row-transit { background: #F0F9FF; }
      table.manifest-tbl tr.row-fuel { background: #FFFBEB; }
      table.manifest-tbl tr.row-dep { background: #E0F2FE; }

      .wx-badge { background: ${startWxRules.bg}; color: ${startWxRules.color}; border: 1px solid ${startWxRules.color}; padding: 1px 5px; border-radius: 3px; font-weight: 800; font-size: 8.5px; }
      .coord-txt { font-family: monospace; font-size: 7.5px; color: #475569; }
      .footer-bar { border-top: 1px solid #CBD5E1; padding-top: 4px; margin-top: 6px; display: flex; justify-content: space-between; font-size: 8px; color: #64748B; }
    </style>
  </head>
  <body>
    <div class="brief-container">
      <div class="header-banner">
        <div>
          <div class="header-title">🚁 HELICOPTER ELECTRIC PATROL BRIEFING</div>
          <div class="header-subtitle">Indiana Transmission Line Grid Inspection &bull; Generated: ${new Date().toLocaleString()}</div>
        </div>
        <button class="print-btn" onclick="window.print()">🖨️ Print 1-Page Briefing</button>
      </div>

      <div class="grid-5">
        <div class="metric-card">
          <div class="metric-lbl">Total Mission Time</div>
          <div class="metric-val" style="color: #0284C7;">${totalTimeStr}</div>
        </div>
        <div class="metric-card">
          <div class="metric-lbl">Total Flight Time</div>
          <div class="metric-val" style="color: #0284C7;">${pureFlightTimeStr}</div>
        </div>
        <div class="metric-card">
          <div class="metric-lbl">Total Distance</div>
          <div class="metric-val" style="color: #0F172A;">${totalFlightMiles.toFixed(1)} mi</div>
        </div>
        <div class="metric-card">
          <div class="metric-lbl">Line Inspection / Transit</div>
          <div class="metric-val" style="color: #16A34A; font-size: 11px;">${totalInspectionMiles.toFixed(1)} mi / ${totalTransitMiles.toFixed(1)} mi</div>
        </div>
        <div class="metric-card">
          <div class="metric-lbl">Est Fuel Cost (Retail)</div>
          <div class="metric-val" style="color: #10B981;">$${totalRefuelCostSum.toFixed(2)}</div>
        </div>
      </div>

      <div class="split-sec">
        <div id="briefing-map"></div>

        <div class="box-panel" style="display: flex; flex-direction: column; justify-content: space-between;">
          <div>
            <div class="panel-title">
              <span>🚁 Flight Profile & Route Endpoints</span>
              <span class="wx-badge">${startWxRules.category}</span>
            </div>
            <table style="width:100%; font-size: 8.5px; line-height: 1.4; border-collapse: collapse;">
              <tr><td style="color:#64748B; width:90px;">Departure Base:</td><td><strong>${startApt.code}</strong> - ${startApt.name} (Refuel: ${depRefuelGal.toFixed(1)} gal)</td></tr>
              ${fuelApt ? `<tr><td style="color:#D97706;">Refueling Stop:</td><td><strong>${fuelApt.code}</strong> (${turnAroundMins}m Turnaround &bull; ${fuelStopRefuelGal.toFixed(1)} gal @ $${fuelStopPricePerGal.toFixed(2)}/gal)</td></tr>` : ''}
              <tr><td style="color:#64748B;">Destination:</td><td><strong>${endApt.code}</strong> - ${endApt.name} (Refuel: ${destRefuelGal.toFixed(1)} gal @ $${destPricePerGal.toFixed(2)}/gal)</td></tr>
              <tr><td style="color:#64748B;">Dep Weather:</td><td>Wind ${wxWind} &bull; Vis ${wxVis} &bull; <strong style="color:${startWxRules.color}">${startWxRules.category}</strong></td></tr>
              <tr><td style="color:#64748B;">Auto-Sequence:</td><td><strong>${fp.autoPlanBackground !== false ? 'OPTIMIZED (Shortest Transit)' : 'MANUAL (Custom Sequence)'}</strong></td></tr>
            </table>
          </div>

          <div style="background: #ECFDF5; border: 1px solid #A7F3D0; padding: 6px; border-radius: 4px; margin-top: 6px;">
            <div style="font-weight: 800; color: #047857; font-size: 8.5px; text-transform: uppercase; margin-bottom: 2px;">⛽ Refueling & Fuel Burn Cost Summary</div>
            <div>Enroute Fuel Burned: <strong>${Math.round(totalGallonsBurned)} gal</strong> &bull; Total Refueled: <strong>${totalRefuelGallonsSum.toFixed(1)} gal</strong></div>
            <div>Estimated Retail Fuel Cost: <strong style="color: #059669; font-size: 9.5px;">$${totalRefuelCostSum.toFixed(2)}</strong></div>
          </div>
        </div>
      </div>

      <div class="panel-title" style="margin-bottom: 4px;">⚡ Complete Flight Plan (${fullSequenceManifest.length} Sequence Legs)</div>
      <table class="manifest-tbl">
        <thead>
          <tr>
            <th>Seq</th>
            <th>Segment / Leg Description</th>
            <th>Type</th>
            <th>Dist</th>
            <th>Transit Spd</th>
            <th>Insp Spd</th>
            <th>Est Time</th>
            <th>Fuel Burn</th>
            <th>Refueling Amount</th>
            <th>Target Waypoint</th>
            <th>Refueling / Diversion</th>
          </tr>
        </thead>
        <tbody>
          ${fullSequenceManifest.map(row => {
            let rowCls = '';
            if (row.type === 'TRANSIT') rowCls = 'row-transit';
            else if (row.type === 'FUEL_STOP') rowCls = 'row-fuel';
            else if (row.type === 'DEPARTURE' || row.type === 'ARRIVAL') rowCls = 'row-dep';

            return `
              <tr class="${rowCls}">
                <td><strong style="color:#0284C7;">${row.tag}</strong></td>
                <td><strong>${row.name}</strong> <span style="font-size:7.5px; color:#64748B;">(${row.subtitle})</span></td>
                <td>${row.voltage}</td>
                <td>${row.length}</td>
                <td>${row.transitInfo}</td>
                <td>${row.inspSpeed}</td>
                <td>${row.timeMins > 0 ? row.timeMins + ' mins' : '-'}</td>
                <td>${row.fuelGal > 0 ? row.fuelGal.toFixed(1) + ' gal' : '-'}</td>
                <td><strong style="color: #059669;">${row.refuelInfo || '-'}</strong></td>
                <td class="coord-txt">${row.waypoint}</td>
                <td><strong style="color:#0284C7;">${row.nearestApt}</strong></td>
              </tr>
            `;
          }).join('')}
        </tbody>
        <tfoot>
          <tr style="background: #E2E8F0; font-weight: 800; border-top: 2px solid #94A3B8;">
            <td colspan="3" style="color: #0F172A; text-align: right; padding-right: 12px; font-size: 8.5px;">FLIGHT PLAN TOTALS:</td>
            <td style="color: #0F172A;">${totalFlightMiles.toFixed(1)} mi</td>
            <td>-</td>
            <td>-</td>
            <td style="color: #0F172A;">${totalTimeStr}</td>
            <td style="color: #0F172A;">${totalGallonsBurned.toFixed(1)} gal</td>
            <td><strong style="color: #059669;">${totalRefuelGallonsSum.toFixed(1)} gal</strong></td>
            <td>-</td>
            <td>-</td>
          </tr>
        </tfoot>
      </table>

      <div class="footer-bar">
        <div>Indiana Power Transmission Grid System &bull; Autonomous Flight Ops</div>
        <div>OPERATIONAL FLIGHT BRIEFING &bull; PAGE 1 OF 1</div>
      </div>
    </div>

    <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js" crossorigin=""></script>
    <script>
      const featuresData = ${JSON.stringify(features)};
      const transitLinesData = ${JSON.stringify(transitPolylines)};
      const airportsData = ${JSON.stringify(allAirportsToRender)};

      const map = L.map('briefing-map', { zoomControl: false }).setView([${startApt.lat}, ${startApt.lng}], 8);
      L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png').addTo(map);
      
      // Ensure circuit lines render on top of airport labels so they are never obscured
      map.getPane('markerPane').style.zIndex = 390;

      // Render Circuit Line Features
      const circuitLayer = L.geoJSON({ type: 'FeatureCollection', features: featuresData }, {
        style: { color: '#00E5FF', weight: 4, opacity: 0.95 }
      }).addTo(map);

      // Render Dotted Transit Lines (To and From Circuits)
      transitLinesData.forEach(line => {
        L.polyline([[line.from.lat, line.from.lng], [line.to.lat, line.to.lng]], {
          color: '#0284C7',
          weight: 2.5,
          dashArray: '6, 6',
          opacity: 0.95
        }).addTo(map);
      });

      // Render Airport Labeled Badges
      const boundsGroup = L.featureGroup([circuitLayer]);

      airportsData.forEach(apt => {
        let badgeBg = '#0F172A';
        let badgeBorder = '#0284C7';
        let iconText = apt.code;

        if (apt.role === 'DEP') {
          badgeBg = '#0284C7';
          badgeBorder = '#38BDF8';
          iconText = '🚁 ' + apt.code + ' (Dep)';
        } else if (apt.role === 'FUEL') {
          badgeBg = '#D97706';
          badgeBorder = '#F59E0B';
          iconText = '⛽ ' + apt.code + ' (Fuel)';
        } else if (apt.role === 'DEST') {
          badgeBg = '#16A34A';
          badgeBorder = '#4ADE80';
          iconText = '🚁 ' + apt.code + ' (Dest)';
        }

        const aptHtml = '<div style="background:' + badgeBg + '; color:#FFF; border:1.5px solid ' + badgeBorder + '; padding:2px 6px; border-radius:10px; font-weight:800; font-size:9px; white-space:nowrap; box-shadow:0 2px 6px rgba(0,0,0,0.4); display:inline-block;">' + iconText + '</div>';

        const aptIcon = L.divIcon({
          className: 'brief-apt-marker',
          html: aptHtml,
          iconSize: [80, 20],
          iconAnchor: [40, 10]
        });

        const m = L.marker([apt.lat, apt.lng], { icon: aptIcon }).addTo(map);
        boundsGroup.addLayer(m);
      });

      if (boundsGroup.getBounds().isValid()) {
        map.fitBounds(boundsGroup.getBounds(), { padding: [20, 20] });
      }
    </script>
  </body>
  </html>`;

  reportWin.document.open();
  reportWin.document.write(html);
  reportWin.document.close();
}








