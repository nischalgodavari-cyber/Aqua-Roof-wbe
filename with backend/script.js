/********************************************************************
 * 1. GLOBAL STATE & MONTHLY RAINFALL WEIGHTS
 ********************************************************************/
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHLY_WEIGHTS = [0.01, 0.01, 0.02, 0.03, 0.06, 0.14, 0.20, 0.19, 0.15, 0.11, 0.06, 0.02];

let map = null;
let roofPoints = [];
let roofMarkers = [];
let roofPolygon = null;
let gpsMarker = null;
let currentRainyDays = 48;
let usePythonBackend = false;

// Map Layers
let esriHybridGroup = null;
let googleHybridLayer = null;
let streetLayerGroup = null;

/********************************************************************
 * 2. CHECK IF PYTHON FLASK BACKEND (/api/health) IS RUNNING
 ********************************************************************/
async function checkBackendConnection() {
  const badge = document.getElementById('backendStatusBadge');
  try {
    const res = await fetch('/api/health', { method: 'GET' });
    if (res.ok) {
      usePythonBackend = true;
      badge.textContent = '🐍 Python Flask API Active';
    } else {
      usePythonBackend = false;
      badge.textContent = '⚡ Browser Engine Active';
    }
  } catch (e) {
    usePythonBackend = false;
    badge.textContent = '⚡ Client Engine Active';
  }
}

/********************************************************************
 * 3. INITIALIZE SATELLITE & STREET MAP
 ********************************************************************/
function initMap() {
  const mapContainer = document.getElementById('roofMap');

  if (typeof window.L === 'undefined') {
    mapContainer.innerHTML = '<div style="padding:2rem;color:#fff;text-align:center;">Offline Mode: Use Roof Area input below.</div>';
    return;
  }

  map = L.map('roofMap', {
    center: [13.6288, 79.4192],
    zoom: 18,
    maxZoom: 21
  });

  // Layer 1: Esri World Imagery HD + Hybrid Place Labels
  const esriSat = L.tileLayer(
    'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    { maxNativeZoom: 19, maxZoom: 21, attribution: 'Tiles &copy; Esri World Imagery' }
  );

  const esriLabels = L.tileLayer(
    'https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
    { maxNativeZoom: 19, maxZoom: 21 }
  );

  esriHybridGroup = L.layerGroup([esriSat, esriLabels]);

  // Layer 2: Google Satellite Hybrid
  googleHybridLayer = L.tileLayer(
    'https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}',
    { maxNativeZoom: 20, maxZoom: 21, attribution: 'Map data &copy; Google Satellite' }
  );

  // Layer 3: Fixed Street Map (Esri Street + OpenStreetMap Fallback)
  const esriStreet = L.tileLayer(
    'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}',
    { maxNativeZoom: 19, maxZoom: 21, attribution: 'Tiles &copy; Esri Street Map' }
  );

  const osmStreet = L.tileLayer(
    'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    { maxNativeZoom: 19, maxZoom: 21, attribution: '&copy; OpenStreetMap contributors' }
  );

  esriStreet.on('tileerror', function () {
    if (map && !map.hasLayer(osmStreet)) {
      osmStreet.addTo(map);
    }
  });

  streetLayerGroup = L.layerGroup([esriStreet]);
  esriHybridGroup.addTo(map);

  setTimeout(() => {
    map.invalidateSize();
    drawSampleRoofOnMap(true);
  }, 250);

  window.addEventListener('resize', () => {
    if (map) map.invalidateSize();
  });

  map.on('click', function (e) {
    updateCoordinateInputs(e.latlng.lat, e.latlng.lng);
    addRoofCorner(e.latlng);
  });

  map.on('moveend', function () {
    const center = map.getCenter();
    updateCoordinateInputs(center.lat, center.lng);
  });
}

function switchMapLayer(mode) {
  if (!map) return;
  map.removeLayer(esriHybridGroup);
  map.removeLayer(googleHybridLayer);
  map.removeLayer(streetLayerGroup);

  document.getElementById('btnLayerEsri').classList.remove('active');
  document.getElementById('btnLayerGoogle').classList.remove('active');
  document.getElementById('btnLayerStreet').classList.remove('active');

  if (mode === 'google') {
    googleHybridLayer.addTo(map);
    document.getElementById('btnLayerGoogle').classList.add('active');
  } else if (mode === 'street') {
    streetLayerGroup.addTo(map);
    document.getElementById('btnLayerStreet').classList.add('active');
  } else {
    esriHybridGroup.addTo(map);
    document.getElementById('btnLayerEsri').classList.add('active');
  }
  map.invalidateSize();
}

function updateCoordinateInputs(lat, lng) {
  document.getElementById('latInput').value = Number(lat).toFixed(5);
  document.getElementById('lngInput').value = Number(lng).toFixed(5);
}

/********************************************************************
 * 4. COORDINATES & 3-STAGE GPS LOCATOR
 ********************************************************************/
function goToEnteredCoordinates() {
  if (!map) return;
  let latRaw = document.getElementById('latInput').value.trim();
  let lngRaw = document.getElementById('lngInput').value.trim();

  if (latRaw.includes(',')) {
    const parts = latRaw.split(',');
    latRaw = parts[0].trim();
    lngRaw = (parts[1] || '').trim();
    document.getElementById('latInput').value = latRaw;
    document.getElementById('lngInput').value = lngRaw;
  }

  const lat = parseFloat(latRaw);
  const lng = parseFloat(lngRaw);

  if (isNaN(lat) || isNaN(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    showStatus('Please enter valid coordinates: Latitude (-90 to 90), Longitude (-180 to 180).', 'error');
    return;
  }

  map.invalidateSize();
  map.setView([lat, lng], 19);
  placeLocationPin(lat, lng, `Selected Coordinates (${lat.toFixed(4)}, ${lng.toFixed(4)})`);
  showStatus(`Moved map to coordinates: ${lat.toFixed(5)}, ${lng.toFixed(5)}. Click or drag roof corners!`, 'info');
}

function placeLocationPin(lat, lng, labelText) {
  if (!map) return;
  if (gpsMarker) map.removeLayer(gpsMarker);
  gpsMarker = L.marker([lat, lng])
    .addTo(map)
    .bindPopup(`<strong>${labelText}</strong><br/>Click or drag numbered corners to measure roof area.`)
    .openPopup();
}

async function locateUserWithFallback() {
  const gpsBtn = document.getElementById('gpsLocateBtn');
  const originalText = gpsBtn.textContent;
  gpsBtn.textContent = '⏳ Locating...';
  gpsBtn.disabled = true;

  const onLocationSuccess = (lat, lng, sourceLabel) => {
    updateCoordinateInputs(lat, lng);
    if (map) {
      map.invalidateSize();
      map.setView([lat, lng], 19);
      placeLocationPin(lat, lng, sourceLabel);
    }
    gpsBtn.textContent = originalText;
    gpsBtn.disabled = false;
    showStatus(`${sourceLabel}: (${lat.toFixed(5)}, ${lng.toFixed(5)}). Zoom onto your roof and click or drag its corners!`, 'info');
  };

  const fallbackToIpLocation = async () => {
    try {
      const res = await fetch('https://get.geojs.io/v1/ip/geo.json');
      const data = await res.json();
      if (data && data.latitude && data.longitude) {
        onLocationSuccess(parseFloat(data.latitude), parseFloat(data.longitude), `Network Location (${data.city || 'Detected'})`);
        return;
      }
    } catch (e) {}

    try {
      const res2 = await fetch('https://ipapi.co/json/');
      const data2 = await res2.json();
      if (data2 && data2.latitude && data2.longitude) {
        onLocationSuccess(parseFloat(data2.latitude), parseFloat(data2.longitude), `Network Location (${data2.city || 'Detected'})`);
        return;
      }
    } catch (e2) {}

    gpsBtn.textContent = originalText;
    gpsBtn.disabled = false;
    showStatus('Could not auto-detect GPS. Enter your Latitude & Longitude in the LAT / LNG boxes below.', 'error');
  };

  if (!navigator.geolocation) {
    await fallbackToIpLocation();
    return;
  }

  navigator.geolocation.getCurrentPosition(
    pos => onLocationSuccess(pos.coords.latitude, pos.coords.longitude, 'Exact Device GPS Location'),
    () => {
      navigator.geolocation.getCurrentPosition(
        posLow => onLocationSuccess(posLow.coords.latitude, posLow.coords.longitude, 'Device Wi-Fi Location'),
        () => fallbackToIpLocation(),
        { enableHighAccuracy: false, timeout: 3500, maximumAge: 60000 }
      );
    },
    { enableHighAccuracy: true, timeout: 4500, maximumAge: 0 }
  );
}

/********************************************************************
 * 5. DRAGGABLE NUMBERED ROOF CORNERS & AREA CALCULATION
 ********************************************************************/
function createCornerNumberIcon(number) {
  return L.divIcon({
    className: 'roof-corner-icon',
    html: `<div class="roof-corner-badge" title="Drag Corner #${number} to resize roof">${number}</div>`,
    iconSize: [24, 24],
    iconAnchor: [12, 12]
  });
}

function addRoofCorner(latlng) {
  if (!map) return;
  const pointIndex = roofPoints.length;
  roofPoints.push(latlng);

  const marker = L.marker(latlng, {
    draggable: true,
    icon: createCornerNumberIcon(pointIndex + 1)
  }).addTo(map);

  marker.on('drag', function (event) {
    const currentIdx = roofMarkers.indexOf(marker);
    if (currentIdx !== -1) {
      const newPos = event.target.getLatLng();
      roofPoints[currentIdx] = newPos;
      updateCoordinateInputs(newPos.lat, newPos.lng);
      redrawRoofPolygon();
    }
  });

  roofMarkers.push(marker);
  redrawRoofPolygon();
}

function refreshMarkerNumbers() {
  roofMarkers.forEach((m, idx) => {
    m.setIcon(createCornerNumberIcon(idx + 1));
  });
}

function drawSampleRoofOnMap(silent = false) {
  if (!map) return;
  clearRoofTrace();
  const center = map.getCenter();
  const dLat = 0.000052;
  const dLng = 0.000058;
  const sampleCorners = [
    L.latLng(center.lat + dLat, center.lng - dLng),
    L.latLng(center.lat + dLat, center.lng + dLng),
    L.latLng(center.lat - dLat, center.lng + dLng),
    L.latLng(center.lat - dLat, center.lng - dLng)
  ];
  sampleCorners.forEach(pt => addRoofCorner(pt));
  if (!silent) {
    showStatus('Sample roof drawn! Drag any numbered corner (1, 2, 3, 4) to change the roof area live.', 'info');
  }
}

function clearRoofTrace() {
  if (!map) return;
  roofPoints = [];
  roofMarkers.forEach(m => map.removeLayer(m));
  roofMarkers = [];
  if (roofPolygon) map.removeLayer(roofPolygon);
  roofPolygon = null;
  document.getElementById('mapPolygonStatus').textContent = 'Roof trace cleared. Click 3 or more corners on the map to trace a roof.';
}

function redrawRoofPolygon() {
  if (!map) return;
  if (roofPolygon) map.removeLayer(roofPolygon);

  const statusEl = document.getElementById('mapPolygonStatus');

  if (roofPoints.length === 0) {
    statusEl.textContent = 'Click corners on the map to trace a roof.';
    return;
  }

  if (roofPoints.length < 3) {
    roofPolygon = L.polyline(roofPoints, { color: '#38bdf8', weight: 3, dashArray: '5, 5' }).addTo(map);
    statusEl.textContent = `${roofPoints.length} corner(s) placed. Click ${3 - roofPoints.length} more corner(s) to close roof shape.`;
    return;
  }

  roofPolygon = L.polygon(roofPoints, {
    color: '#0284c7',
    fillColor: '#38bdf8',
    fillOpacity: 0.38,
    weight: 3
  }).addTo(map);

  const areaSqMeters = Math.round(calculateGeodesicArea(roofPoints));
  if (areaSqMeters > 0) {
    statusEl.textContent = `Traced Roof Area: ${areaSqMeters.toLocaleString('en-IN')} m² (${Math.round(areaSqMeters * 10.7639).toLocaleString('en-IN')} sq. ft.) — Drag points 1-${roofPoints.length} to resize!`;
    const unitSelect = document.getElementById('areaUnitSelect');
    const areaInput = document.getElementById('roofAreaInput');
    areaInput.value = unitSelect.value === 'sqft' ? Math.round(areaSqMeters * 10.7639) : areaSqMeters;
    calculateHarvest();
  }
}

function calculateGeodesicArea(latLngs) {
  const R = 6378137;
  let area = 0;
  const len = latLngs.length;
  if (len < 3) return 0;

  for (let i = 0; i < len; i++) {
    const p1 = latLngs[i];
    const p2 = latLngs[(i + 1) % len];
    const x1 = (p1.lng * Math.PI) / 180;
    const y1 = (p1.lat * Math.PI) / 180;
    const x2 = (p2.lng * Math.PI) / 180;
    const y2 = (p2.lat * Math.PI) / 180;
    area += (x2 - x1) * (2 + Math.sin(y1) + Math.sin(y2));
  }
  return (Math.abs(area) * R * R) / 2.0;
}

/********************************************************************
 * 6. LOCATION SEARCH & OPEN-METEO WEATHER API
 ********************************************************************/
async function searchLocationOnMap() {
  const query = document.getElementById('locationSearchInput').value.trim();
  if (!query) {
    showStatus('Please enter a city, locality, or "Lat, Lng" coordinates to search.', 'error');
    return;
  }

  const coordMatch = query.match(/^(-?\d+(\.\d+)?)\s*,\s*(-?\d+(\.\d+)?)$/);
  if (coordMatch) {
    document.getElementById('latInput').value = coordMatch[1];
    document.getElementById('lngInput').value = coordMatch[3];
    goToEnteredCoordinates();
    return;
  }

  const searchBtn = document.getElementById('searchMapBtn');
  searchBtn.textContent = 'Searching...';
  searchBtn.disabled = true;

  try {
    const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=1`;
    const response = await fetch(url, { headers: { 'Accept-Language': 'en' } });
    const data = await response.json();

    if (!data || data.length === 0) {
      showStatus(`No map location found for "${query}". Try entering Latitude & Longitude coordinates below.`, 'error');
    } else {
      const lat = parseFloat(data[0].lat);
      const lon = parseFloat(data[0].lon);
      updateCoordinateInputs(lat, lon);
      if (map) {
        map.invalidateSize();
        map.setView([lat, lon], 19);
        placeLocationPin(lat, lon, data[0].display_name.split(',')[0]);
      }
      showStatus(`Moved to: ${data[0].display_name}. Click or drag corners on your roof!`, 'info');
    }
  } catch (err) {
    showStatus('Search service busy. Enter Latitude & Longitude directly in the LAT / LNG boxes.', 'error');
  } finally {
    searchBtn.textContent = '🔍 Search';
    searchBtn.disabled = false;
  }
}

async function fetchLiveRainfallForMapCenter() {
  const lat = parseFloat(document.getElementById('latInput').value) || 13.6288;
  const lng = parseFloat(document.getElementById('lngInput').value) || 79.4192;
  const btn = document.getElementById('fetchLiveRainBtn');
  const originalText = btn.textContent;
  btn.textContent = 'Fetching climate data...';

  try {
    const apiUrl = `https://archive-api.open-meteo.com/v1/archive?latitude=${lat.toFixed(4)}&longitude=${lng.toFixed(4)}&start_date=2025-01-01&end_date=2025-12-31&daily=precipitation_sum&timezone=auto`;
    const res = await fetch(apiUrl);
    const data = await res.json();

    if (data && data.daily && data.daily.precipitation_sum) {
      let totalMm = 0;
      let rainyDays = 0;
      data.daily.precipitation_sum.forEach(val => {
        if (val !== null && val > 0) {
          totalMm += val;
          if (val >= 2.5) rainyDays++;
        }
      });

      totalMm = Math.round(totalMm);
      currentRainyDays = Math.max(15, rainyDays);

      document.getElementById('citySelect').value = 'custom';
      document.getElementById('rainfallInput').value = totalMm;
      document.getElementById('rainyDaysHint').textContent = `~${currentRainyDays} rainy days/yr (Live GPS)`;

      calculateHarvest();
      showStatus(`Updated rainfall to ${totalMm} mm/yr (${currentRainyDays} rainy days) for coordinates (${lat.toFixed(4)}, ${lng.toFixed(4)}).`, 'info');
    }
  } catch (error) {
    showStatus('Could not fetch live Open-Meteo rainfall. Using selected city preset instead.', 'error');
  } finally {
    btn.textContent = originalText;
  }
}

/********************************************************************
 * 7. HYBRID PYTHON BACKEND API + CLIENT FALLBACK CALCULATOR
 ********************************************************************/
async function calculateHarvest() {
  const payload = {
    rawArea: parseFloat(document.getElementById('roofAreaInput').value) || 0,
    unit: document.getElementById('areaUnitSelect').value,
    runoffCoeff: parseFloat(document.getElementById('roofTypeSelect').value) || 0.70,
    annualRainfallMm: parseFloat(document.getElementById('rainfallInput').value) || 0,
    filterEffPercent: parseFloat(document.getElementById('filterEfficiencyInput').value) || 90,
    occupants: parseInt(document.getElementById('occupantsInput').value, 10) || 1,
    tankerPrice: parseFloat(document.getElementById('tankerCostInput').value) || 900,
    soilType: document.getElementById('soilTypeSelect').value,
    rainyDays: currentRainyDays
  };

  if (payload.rawArea <= 0 || payload.annualRainfallMm <= 0) return;

  // Try Python Flask Backend (/api/calculate) first if active
  if (usePythonBackend) {
    try {
      const response = await fetch('/api/calculate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (response.ok) {
        const result = await response.json();
        renderCalculationResults(result, payload);
        return;
      }
    } catch (e) {
      // Fallback to local JS calculation if server stopped
    }
  }

  // Fallback calculation in JS (so GitHub Pages live link works 100%)
  const localResult = runLocalCalculation(payload);
  renderCalculationResults(localResult, payload);
}

function runLocalCalculation(p) {
  const areaSqM = p.unit === 'sqft' ? p.rawArea / 10.7639 : p.rawArea;
  const areaSqFt = p.unit === 'sqft' ? p.rawArea : p.rawArea * 10.7639;
  const grossLitres = areaSqM * p.annualRainfallMm;
  const runoffAfterSurface = grossLitres * p.runoffCoeff;
  const surfaceLoss = grossLitres - runoffAfterSurface;

  const firstFlushDepthMm = Math.min(p.annualRainfallMm * 0.08, p.rainyDays * 1.5);
  const firstFlushLoss = areaSqM * firstFlushDepthMm * p.runoffCoeff;

  const waterEnteringFilter = Math.max(0, runoffAfterSurface - firstFlushLoss);
  const netCollectableLitres = waterEnteringFilter * (p.filterEffPercent / 100);
  const filterLoss = waterEnteringFilter - netCollectableLitres;

  const tankersSaved = netCollectableLitres / 5000;
  const annualRupeesSaved = Math.round(tankersSaved * p.tankerPrice);
  const dailyNonPotableDemand = p.occupants * 80;
  const daysSupported = Math.round(netCollectableLitres / dailyNonPotableDemand);
  const peakStormLitres = areaSqM * 50 * p.runoffCoeff * (p.filterEffPercent / 100);

  const soilFactor = p.soilType === 'sandy' ? 0.85 : p.soilType === 'loamy' ? 1.0 : 1.25;
  const requiredPitVolumeM3 = Math.max(2.5, (peakStormLitres / 1000) * 0.55 * soilFactor);

  let categoryBadge, structureTitle, dimensionsText, capacityBadge, pipeSpecs, minCost, maxCost;

  if (areaSqM <= 120) {
    categoryBadge = 'Small Home Recharge Pit';
    structureTitle = '1. Pit Size to Dig (Small Home Pit)';
    const depthM = Math.min(2.4, Math.max(1.8, (requiredPitVolumeM3 / (1.2 * 1.2)).toFixed(1)));
    const depthFt = (depthM * 3.28084).toFixed(1);
    const volLitres = Math.round(1.2 * 1.2 * depthM * 1000);
    dimensionsText = `Dig a pit 1.2 m Long × 1.2 m Wide × ${depthM} m Deep (approx. 4 ft × 4 ft × ${depthFt} ft).`;
    capacityBadge = `Pit Volume: ~${volLitres.toLocaleString('en-IN')} Liters`;
    pipeSpecs = 'Connect your roof drainpipe (3-inch or 4-inch PVC) through a simple leaf-mesh strainer into the pit. Optional: Keep a 1,500 L drum for garden water.';
    minCost = 14000;
    maxCost = 19000;
  } else if (areaSqM <= 300) {
    categoryBadge = 'Medium Home Recharge Pit';
    structureTitle = '1. Pit Size to Dig (Standard Home Pit)';
    const depthM = Math.min(3.0, Math.max(2.0, (requiredPitVolumeM3 / (1.5 * 1.5)).toFixed(1)));
    const depthFt = (depthM * 3.28084).toFixed(1);
    const volLitres = Math.round(1.5 * 1.5 * depthM * 1000);
    dimensionsText = `Dig a pit 1.5 m Long × 1.5 m Wide × ${depthM} m Deep (approx. 5 ft × 5 ft × ${depthFt} ft).`;
    capacityBadge = `Pit Volume: ~${volLitres.toLocaleString('en-IN')} Liters`;
    pipeSpecs = 'Connect your roof drainpipe (4-inch PVC) through a leaf-mesh filter straight into the top of the pit. Optional: Add a 3,000 L tank for cleaning/flushing.';
    minCost = 18000;
    maxCost = 26000;
  } else {
    categoryBadge = 'Large Building / Campus Trench';
    structureTitle = '1. Trench Size to Dig (Apartment / Campus)';
    const lengthM = Math.min(10.0, Math.max(3.5, (requiredPitVolumeM3 / (1.5 * 2.0)).toFixed(1)));
    const lengthFt = (lengthM * 3.28084).toFixed(0);
    const volLitres = Math.round(lengthM * 1.5 * 2.0 * 1000);
    dimensionsText = `Dig a rectangular trench ${lengthM} m Long × 1.5 m Wide × 2.0 m Deep (approx. ${lengthFt} ft × 5 ft × 6.5 ft).`;
    capacityBadge = `Trench Volume: ~${volLitres.toLocaleString('en-IN')} Liters`;
    pipeSpecs = 'Connect building roof pipes (6-inch PVC) through a settling chamber into the recharge trench. Recommended: 10,000 L storage sump.';
    minCost = 42000;
    maxCost = 65000;
  }

  const avgCost = (minCost + maxCost) / 2;
  const paybackYears = annualRupeesSaved > 0 ? (avgCost / annualRupeesSaved).toFixed(1) : 0;

  return {
    areaSqM: Math.round(areaSqM),
    areaSqFt: Math.round(areaSqFt),
    grossLitres: Math.round(grossLitres),
    surfaceLoss: Math.round(surfaceLoss),
    firstFlushLoss: Math.round(firstFlushLoss),
    filterLoss: Math.round(filterLoss),
    netCollectableLitres: Math.round(netCollectableLitres),
    netCubicMeters: (netCollectableLitres / 1000).toFixed(1),
    tankersSaved: tankersSaved.toFixed(1),
    annualRupeesSaved,
    dailyNonPotableDemand,
    daysSupported,
    peakStormLitres: Math.round(peakStormLitres),
    monthlyValues: MONTHLY_WEIGHTS.map(w => Math.round(netCollectableLitres * w)),
    recharge: {
      categoryBadge,
      structureTitle,
      dimensionsText,
      capacityBadge,
      pipeSpecs,
      minCost,
      maxCost,
      paybackYears
    }
  };
}

function renderCalculationResults(r, payload) {
  document.getElementById('convertedAreaHint').textContent =
    payload.unit === 'sqm'
      ? `≈ ${r.areaSqFt.toLocaleString('en-IN')} sq. ft.`
      : `≈ ${r.areaSqM.toLocaleString('en-IN')} m²`;

  document.getElementById('activeRoofBadge').textContent = `${r.areaSqM.toLocaleString('en-IN')} m² Roof`;
  document.getElementById('netWaterOutput').textContent = `${r.netCollectableLitres.toLocaleString('en-IN')} L`;
  document.getElementById('netCubicMeters').textContent = `${r.netCubicMeters} Cubic Meters (m³) / Year`;
  document.getElementById('tankersSavedOutput').textContent = `${r.tankersSaved} Tankers`;
  document.getElementById('annualMoneySavedOutput').textContent = `Est. Savings: ₹${r.annualRupeesSaved.toLocaleString('en-IN')} / yr`;
  document.getElementById('daysSupportedOutput').textContent = `${r.daysSupported.toLocaleString('en-IN')} Days`;

  if (r.daysSupported > 365) {
    const yearsSupported = (r.daysSupported / 365).toFixed(1);
    document.getElementById('dailyDemandSub').textContent = `At ${r.dailyNonPotableDemand.toLocaleString('en-IN')} L/day (~${yearsSupported} Years supply + groundwater surplus)`;
  } else {
    document.getElementById('dailyDemandSub').textContent = `At ${r.dailyNonPotableDemand.toLocaleString('en-IN')} L/day daily non-drinking use`;
  }

  document.getElementById('peakStormOutput').textContent = `${r.peakStormLitres.toLocaleString('en-IN')} L`;

  document.getElementById('grossRainVal').textContent = `${r.grossLitres.toLocaleString('en-IN')} L`;
  document.getElementById('runoffLossLabel').textContent = `2. Roof Absorption & Evaporation Loss (C = ${payload.runoffCoeff.toFixed(2)})`;
  document.getElementById('runoffLossVal').textContent = `− ${r.surfaceLoss.toLocaleString('en-IN')} L`;
  document.getElementById('firstFlushLossVal').textContent = `− ${r.firstFlushLoss.toLocaleString('en-IN')} L`;
  document.getElementById('filterLossLabel').textContent = `4. Filter Loss (${100 - payload.filterEffPercent}%)`;
  document.getElementById('filterLossVal').textContent = `− ${r.filterLoss.toLocaleString('en-IN')} L`;
  document.getElementById('finalNetVal').textContent = `${r.netCollectableLitres.toLocaleString('en-IN')} L / year`;

  // Update Recharge Setup
  document.getElementById('setupCategoryBadge').textContent = r.recharge.categoryBadge;
  document.getElementById('structureTitle').textContent = r.recharge.structureTitle;
  document.getElementById('structureDimensions').textContent = r.recharge.dimensionsText;
  document.getElementById('pitCapacityBadge').textContent = r.recharge.capacityBadge;
  document.getElementById('pipeFilterSpecs').textContent = r.recharge.pipeSpecs;
  document.getElementById('costRangeOutput').textContent = `3. Estimated Setup Cost: ₹${r.recharge.minCost.toLocaleString('en-IN')} – ₹${r.recharge.maxCost.toLocaleString('en-IN')}`;
  document.getElementById('paybackOutput').textContent = `Recovers its cost in ~${r.recharge.paybackYears} Years of water tanker savings and keeps your borewell recharged in summer.`;

  // Render Monthly Chart
  const chartEl = document.getElementById('monthlyChart');
  chartEl.innerHTML = '';
  const maxVal = Math.max(...r.monthlyValues, 1);

  r.monthlyValues.forEach((val, idx) => {
    const heightPct = Math.max(4, Math.round((val / maxVal) * 100));
    const col = document.createElement('div');
    col.className = 'bar-col';
    const shortVal = val >= 1000 ? `${(val / 1000).toFixed(1)}k` : val;

    col.innerHTML = `
      <div class="bar-val">${shortVal}</div>
      <div class="bar-fill" style="height: ${heightPct}%;" title="${MONTH_NAMES[idx]}: ${val.toLocaleString('en-IN')} Liters"></div>
      <div class="bar-label">${MONTH_NAMES[idx]}</div>
    `;
    chartEl.appendChild(col);
  });
}

/********************************************************************
 * 8. UI HELPERS & EVENT LISTENERS
 ********************************************************************/
function showStatus(msg, type) {
  const el = document.getElementById('statusMessage');
  el.textContent = msg;
  el.className = type === 'error' ? 'status-error' : 'status-info';
  el.style.display = 'block';
  setTimeout(() => {
    el.style.display = 'none';
  }, 7000);
}

document.addEventListener('DOMContentLoaded', async () => {
  await checkBackendConnection();
  initMap();
  calculateHarvest();

  document.getElementById('btnLayerEsri').addEventListener('click', () => switchMapLayer('esri'));
  document.getElementById('btnLayerGoogle').addEventListener('click', () => switchMapLayer('google'));
  document.getElementById('btnLayerStreet').addEventListener('click', () => switchMapLayer('street'));

  const formInputs = ['roofAreaInput', 'areaUnitSelect', 'roofTypeSelect', 'rainfallInput', 'soilTypeSelect', 'filterEfficiencyInput', 'occupantsInput', 'tankerCostInput'];
  formInputs.forEach(id => {
    document.getElementById(id).addEventListener('input', calculateHarvest);
    document.getElementById(id).addEventListener('change', calculateHarvest);
  });

  document.getElementById('citySelect').addEventListener('change', function () {
    const selectedOption = this.options[this.selectedIndex];
    if (this.value !== 'custom') {
      document.getElementById('rainfallInput').value = this.value;
      currentRainyDays = parseInt(selectedOption.getAttribute('data-days'), 10) || 48;
      document.getElementById('rainyDaysHint').textContent = `~${currentRainyDays} rainy days/yr`;

      const lat = parseFloat(selectedOption.getAttribute('data-lat'));
      const lng = parseFloat(selectedOption.getAttribute('data-lng'));
      if (!isNaN(lat) && !isNaN(lng)) {
        updateCoordinateInputs(lat, lng);
        if (map) {
          map.invalidateSize();
          map.setView([lat, lng], 18);
        }
      }
      calculateHarvest();
    }
  });

  document.querySelectorAll('.pill-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const sqm = parseFloat(btn.getAttribute('data-sqm'));
      document.getElementById('areaUnitSelect').value = 'sqm';
      document.getElementById('roofAreaInput').value = sqm;
      calculateHarvest();
    });
  });

  document.getElementById('drawSampleRoofBtn').addEventListener('click', () => drawSampleRoofOnMap(false));

  document.getElementById('undoPointBtn').addEventListener('click', () => {
    if (roofPoints.length > 0) {
      roofPoints.pop();
      const lastMarker = roofMarkers.pop();
      if (lastMarker && map) map.removeLayer(lastMarker);
      refreshMarkerNumbers();
      redrawRoofPolygon();
    }
  });

  document.getElementById('clearPolygonBtn').addEventListener('click', clearRoofTrace);

  document.getElementById('searchMapBtn').addEventListener('click', searchLocationOnMap);
  document.getElementById('locationSearchInput').addEventListener('keypress', e => {
    if (e.key === 'Enter') {
      e.preventDefault();
      searchLocationOnMap();
    }
  });

  document.getElementById('goToCoordBtn').addEventListener('click', goToEnteredCoordinates);
  ['latInput', 'lngInput'].forEach(id => {
    document.getElementById(id).addEventListener('keypress', e => {
      if (e.key === 'Enter') {
        e.preventDefault();
        goToEnteredCoordinates();
      }
    });
  });

  document.getElementById('gpsLocateBtn').addEventListener('click', locateUserWithFallback);
  document.getElementById('fetchLiveRainBtn').addEventListener('click', fetchLiveRainfallForMapCenter);

  document.getElementById('demoHouseBtn').addEventListener('click', () => {
    document.getElementById('areaUnitSelect').value = 'sqm';
    document.getElementById('roofAreaInput').value = 140;
    document.getElementById('roofTypeSelect').value = '0.70';
    document.getElementById('citySelect').value = '934';
    document.getElementById('rainfallInput').value = 934;
    document.getElementById('soilTypeSelect').value = 'loamy';
    document.getElementById('occupantsInput').value = 5;
    updateCoordinateInputs(13.6288, 79.4192);
    if (map) {
      map.invalidateSize();
      map.setView([13.6288, 79.4192], 18);
      drawSampleRoofOnMap(true);
    }
    calculateHarvest();
    showStatus('Loaded Sample 1: Family Home (140 m² Roof in Tirupati) with draggable roof corners.', 'info');
  });

  document.getElementById('demoCampusBtn').addEventListener('click', () => {
    document.getElementById('areaUnitSelect').value = 'sqm';
    document.getElementById('roofAreaInput').value = 850;
    document.getElementById('roofTypeSelect').value = '0.70';
    document.getElementById('citySelect').value = '1400';
    document.getElementById('rainfallInput').value = 1400;
    document.getElementById('soilTypeSelect').value = 'sandy';
    document.getElementById('occupantsInput').value = 15;
    updateCoordinateInputs(13.0827, 80.2707);
    if (map) {
      map.invalidateSize();
      map.setView([13.0827, 80.2707], 18);
    }
    calculateHarvest();
    showStatus('Loaded Sample 2: Large Campus Block (850 m² Roof in Chennai) — Days Met goes past 365 days!', 'info');
  });
});