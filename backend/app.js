

//handles map, routing, weather, and live transport data

class UrbanNavApp {
  constructor() {
    this.map = null;
    this.directionsService = null;
    this.directionsRenderer = null;
    this.altRenderers = [];
    this.destinationLatLng = null;
    this._originLatLng = null;
    this.currentRoute = null;
    this.selectedMode = null;
    this.preferEasyRoute = false;
    this.waitForGoogleMaps();
  }

  waitForGoogleMaps() {
    if (typeof google !== 'undefined' && google.maps) {
      this.initMap();
      this.initEventListeners();
    } else {
      setTimeout(() => this.waitForGoogleMaps(), 100);
    }
  }

  initMap() {
    this.map = new google.maps.Map(document.getElementById('map'), {
      center: CONFIG.DEFAULT_CENTER,
      zoom: 12,
      styles: [{ featureType: "poi", elementType: "labels", stylers: [{ visibility: "off" }] }]
    });
    this.directionsService = new google.maps.DirectionsService();
    this.directionsRenderer = new google.maps.DirectionsRenderer({
      map: this.map,
      suppressMarkers: false
    });
    this.trafficLayer = new google.maps.TrafficLayer();
    new google.maps.places.Autocomplete(document.getElementById('fromInput'));
    new google.maps.places.Autocomplete(document.getElementById('toInput'));
  }

  initEventListeners() {
    document.getElementById('findRouteBtn').addEventListener('click', () => this.findRoute());

    ['fromInput', 'toInput'].forEach(id => {
      document.getElementById(id).addEventListener('keypress', (e) => {
        if (e.key === 'Enter') this.findRoute();
      });
    });

    const timeInput    = document.getElementById('departureTime');
    const clearTimeBtn = document.getElementById('clearTimeBtn');
    if (timeInput && clearTimeBtn) {
      timeInput.addEventListener('change', () => {
        clearTimeBtn.style.display = timeInput.value ? 'inline-flex' : 'none';
        this._onDepartureTimeChange();
      });
      clearTimeBtn.addEventListener('click', () => {
        timeInput.value = '';
        clearTimeBtn.style.display = 'none';
        this._onDepartureTimeChange();
      });
    }

    this.initFavouritesOnLoad();
  }

  toggleSidebar() {
    document.getElementById('sidebar').classList.toggle('hidden-mobile');
  }

  // ─── FIND ROUTE ──────────────────────────────────────────────
  async findRoute() {
    const from = document.getElementById('fromInput').value;
    const to   = document.getElementById('toInput').value;
    if (!from || !to) {
      this.showError('routeInfo', 'Please enter both start and destination');
      return;
    }

    this.showLoading('routeInfo', 'Finding your destination...');

    try {
      const geocoder = new google.maps.Geocoder();
      const [fromResult, toResult] = await Promise.all([
        this.geocodeAddress(geocoder, from),
        this.geocodeAddress(geocoder, to)
      ]);

      this.destinationLatLng = toResult.geometry.location;
      this._originLatLng     = fromResult.geometry.location;

      const bounds = new google.maps.LatLngBounds();
      bounds.extend(fromResult.geometry.location);
      bounds.extend(toResult.geometry.location);
      this.map.fitBounds(bounds, { top: 60, right: 40, bottom: 40, left: 40 });

      document.getElementById('transportModes').style.display = 'block';
      document.getElementById('routeDetails').style.display   = 'block';
      document.getElementById('alertsSection').style.display  = 'block';

      document.getElementById('routeInfo').innerHTML = `
        <div class="dest-found">
          <p>Destination found!</p>
          <p class="sub">Select a transport mode to see route details</p>
        </div>`;

      await this.loadWeather();
      if (window._onWeatherReady) window._onWeatherReady();

      this.preferEasyRoute = (window._userEnergyLevel === 'low') ||
                             (localStorage.getItem('urbannav_stressfree') === 'true');

      await this.selectBestMode(document.getElementById('bestModeBtn'));

    } catch (error) {
      this.showError('routeInfo', error.message);
    }
  }

  // ─── SELECT MODE (Walk / Bike / Drive / Transit) ─────────────
  async selectMode(mode) {
    this.selectedMode = mode;

    document.querySelectorAll('.mode-btn').forEach(btn => btn.classList.remove('active'));
    const modeButtonMap = {
      WALKING:   '[onclick*="WALKING"]',
      BICYCLING: '[onclick*="BICYCLING"]',
      DRIVING:   '[onclick*="DRIVING"]',
      TRANSIT:   '[onclick*="TRANSIT"]'
    };
    const activeBtn = document.querySelector(modeButtonMap[mode]);
    if (activeBtn) activeBtn.classList.add('active');
    else if (typeof event !== 'undefined' && event && event.target) {
      event.target.classList.add('active');
    }

    this.showLoading('routeInfo', 'Calculating route...');

    try {
      const from    = document.getElementById('fromInput').value;
      const to      = document.getElementById('toInput').value;
      const depDate = this._getDepartureDate();
      const result  = await this.calculateRoute(from, to, mode, depDate);
      this.currentRoute = result;
      this.allRoutes    = result.routes;

      const routeIdx = this.preferEasyRoute
        ? this._getStressFreeRouteIndex(result.routes)
        : 0;

      this._showAllRoutes(result, routeIdx);

      const routeBounds = result.routes[routeIdx].bounds || result.routes[0].bounds;
      if (routeBounds) this.map.fitBounds(routeBounds, { top: 60, right: 40, bottom: 40, left: 40 });

      if (this.trafficLayer) {
        this.trafficLayer.setMap(mode === 'DRIVING' ? this.map : null);
      }

      this.displayRouteDetails(result, mode, routeIdx);
      this.displayEnvironmentalImpact(result, mode);
      if (window._onEcoReady) window._onEcoReady();

      const alertsSection = document.getElementById('alertsSection');
      if (mode === 'WALKING' || mode === 'BICYCLING' || mode === 'DRIVING') {
        alertsSection.style.display = 'none';
      } else {
        alertsSection.style.display = 'block';
        await this.loadLiveTransport();
        this.checkForDelays();
      }

    } catch (error) {
      this.showError('routeInfo', error.message);
    }
  }

  // ─── DISPLAY ROUTE DETAILS (Walk / Bike / Drive / Transit) ───
  displayRouteDetails(result, mode, routeIndex = 0) {
    const leg = result.routes[routeIndex].legs[0];
    const icons = {
      WALKING:   document.getElementById('icon-walking').outerHTML,
      BICYCLING: document.getElementById('icon-cycling').outerHTML,
      DRIVING:   document.getElementById('icon-driving').outerHTML,
      TRANSIT:   document.getElementById('icon-transit').outerHTML
    };

    // Route badges (Fastest / Least Disrupted) — hidden when stress-free is ON
    // because stress-free picks a different route intentionally, so those
    // labels would be misleading.
    const badges = this.preferEasyRoute
      ? ''
      : this._getRouteBadges(result.routes, routeIndex);

    const relScore    = this._calcReliabilityScore(leg, mode, result);
    const relHTML     = this._buildReliabilityHTML(relScore, mode, leg);
    const fatigueHTML = this._buildFatigueWarningHTML(leg, mode);

    // Stress-Free Mode banner — single clean message, no duplicates
    const stressFreeHTML = this.preferEasyRoute
      ? `<div class="stress-free-banner">Commuter Stress-Free Mode ON — easier route selected</div>`
      : '';

    const stepsHTML = leg.steps.map((step, i) => `
      <div class="step-item">
        <div class="step-number">${i + 1}</div>
        <div class="step-body">
          <div class="step-text">${step.instructions}</div>
          <div class="step-meta">${step.distance.text} · ${step.duration.text}</div>
        </div>
      </div>`).join('');

    this._recordWellnessJourney(leg, mode, relScore);

    document.getElementById('routeInfo').innerHTML = `
      <div class="route-summary-card">
        <div class="route-mode-icon">${icons[mode]}</div>
        <div>
          <div class="route-time">${leg.duration.text}</div>
          <div class="route-distance">${leg.distance.text}</div>
        </div>
      </div>
      ${badges ? `<div class="route-badges-row">${badges}</div>` : ''}
      ${stressFreeHTML}
      ${relHTML}
      ${fatigueHTML}

      <!-- Journey Summary toggle -->
      <div class="ai-btn-row">
        <button class="ai-btn" id="aiSummaryBtn" onclick="app.toggleAiBox('aiSummaryBox', 'aiSummaryBtn', 'Journey Summary', this)">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" width="14" height="14">
            <path d="M12 2a10 10 0 1 0 10 10"/><path d="M12 8v4l3 3"/><circle cx="19" cy="5" r="3" fill="currentColor" stroke="none"/>
          </svg>
          <span>Journey Summary</span>
        </button>
      </div>
      <div id="aiSummaryBox" class="ai-box-hidden"></div>

      <div>
        <p class="steps-heading">Step-by-step directions</p>
        <div class="steps-list">${stepsHTML}</div>
      </div>`;
  }

  // ─── ECO IMPACT ──────────────────────────────────────────────
  displayEnvironmentalImpact(result, mode) {
    const leg          = result.routes[0].legs[0];
    const distance     = leg.distance.value / 1000;
    const durationMins = leg.duration.value / 60;

    const emissions = { DRIVING: 0.171, WALKING: 0, BICYCLING: 0, TRANSIT: 0.041 };
    const co2   = (emissions[mode] || 0) * distance;
    const saved = emissions.DRIVING * distance - co2;
    const trees = (saved / 21).toFixed(1);

    let message = '';
    if (mode === 'DRIVING') {
      message = `This journey will produce <strong>${co2.toFixed(2)} kg</strong> of CO₂`;
    } else if (saved > 0) {
      message = `You're saving <strong>${saved.toFixed(2)} kg</strong> of CO₂ compared to driving!<br>
                 <span class="text-sm">That's equivalent to ${trees} tree(s) absorbing CO₂ for a day</span>`;
    } else {
      message = `Zero emissions! Great choice for the environment!`;
    }

    let calorieHTML = '';
    if (mode === 'WALKING' || mode === 'BICYCLING') {
      const MET      = mode === 'WALKING' ? 3.5 : 6.8;
      const hours    = durationMins / 60;
      const calories = Math.round(MET * 70 * hours);
      const label    = mode === 'WALKING' ? 'walking' : 'cycling';
      const pace     = `${(distance / hours).toFixed(1)} km/h average ${mode === 'WALKING' ? 'pace' : 'speed'}`;

      calorieHTML = `
        <div class="calorie-card">
          <div class="calorie-header">Estimated Calories Burned</div>
          <div class="calorie-value">${calories} <span class="calorie-unit">kcal</span></div>
          <div class="calorie-meta">Based on ${Math.round(durationMins)} min of ${label} &middot; ${pace}</div>
          <div class="calorie-note">Estimate uses a 70 kg reference weight (MET ${MET}). Your actual burn will vary.</div>
        </div>`;
    }

    document.getElementById('environmentInfo').innerHTML = `
      <div class="${mode === 'DRIVING' ? 'env-card-red' : 'env-card-green'}">
        <div>${message}</div>
      </div>
      ${calorieHTML}`;
  }

  // ─── WEATHER ─────────────────────────────────────────────────
  async loadWeather() {
    if (!this.destinationLatLng) return;
    this.showLoading('weatherInfo', 'Loading weather...');
    try {
      const lat  = this.destinationLatLng.lat();
      const lon  = this.destinationLatLng.lng();
      const url  = `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&units=metric&appid=${CONFIG.WEATHER_KEY}`;
      const data = await (await fetch(url)).json();

      // Store weather data on instance so AI advisor can access it
      this._lastWeatherData = {
        temp:        Math.round(data.main.temp),
        feelsLike:   Math.round(data.main.feels_like),
        humidity:    data.main.humidity,
        description: data.weather[0].description,
        main:        data.weather[0].main,
        windSpeed:   data.wind ? Math.round(data.wind.speed * 3.6) : null, // m/s → km/h
        rain:        data.rain ? data.rain['1h'] || data.rain['3h'] || 0 : 0
      };

      document.getElementById('weatherInfo').innerHTML = `
        <div class="weather-card">
          <div class="weather-main">
            <div>
              <div class="weather-temp">${Math.round(data.main.temp)}°C</div>
              <div class="weather-desc">${data.weather[0].description}</div>
            </div>
            <div class="weather-emoji">${this.getWeatherEmoji(data.weather[0].main, data.weather[0].icon)}</div>
          </div>
          <div class="weather-grid">
            <div class="weather-stat">
              <div class="weather-stat-label">Feels like</div>
              <div class="weather-stat-value">${Math.round(data.main.feels_like)}°C</div>
            </div>
            <div class="weather-stat">
              <div class="weather-stat-label">Humidity</div>
              <div class="weather-stat-value">${data.main.humidity}%</div>
            </div>
          </div>
        </div>
        <div class="ai-btn-row" style="margin-top:10px">
          <button class="ai-btn ai-btn-weather" id="aiWeatherBtn" onclick="app.toggleAiBox('aiWeatherBox', 'aiWeatherBtn', 'Weather Advice', this)">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" width="14" height="14">
              <path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9z"/>
            </svg>
            <span>Weather Advice</span>
          </button>
        </div>
        <div id="aiWeatherBox" class="ai-box-hidden"></div>`;
    } catch (error) {
      this.showError('weatherInfo', 'Could not load weather data');
    }
  }

  // ─── TRANSPORT DEPARTURES ────────────────────────────────────
  async loadLiveTransport() {
    if (!this.destinationLatLng) {
      this.showError('liveTransportInfo', 'Please select a destination first');
      return;
    }
    this.showLoading('liveTransportInfo', 'Loading transport data...');

    try {
      // Use origin for departure board (where user is leaving from)
      const src = this._originLatLng || this.destinationLatLng;
      const lat  = src.lat();
      const lon  = src.lng();

      // Use departure time from input; fall back to first transit step time
      let chosenTime = this._getDepartureTimeString();
      if (!chosenTime && this.currentRoute?.routes?.[0]) {
        const firstTransit = this.currentRoute.routes[0].legs[0].steps
          ?.find(s => s.travel_mode === 'TRANSIT' && s.transit?.departure_time);
        if (firstTransit) {
          chosenTime = this._parseDisplayTimeTo24h(firstTransit.transit.departure_time.text);
        }
      }

      const [trainData, busData] = await Promise.all([
        this.loadTrainDepartures(lat, lon, chosenTime),
        this.loadBusDepartures(lat, lon, chosenTime)
      ]);

      document.getElementById('liveTransportInfo').innerHTML = trainData + busData;
    } catch (error) {
      this.showError('liveTransportInfo', error.message);
    }
  }

  // Converts "1:21 pm" or "13:21" to "HH:MM" 24h format
  _parseDisplayTimeTo24h(timeStr) {
    if (!timeStr) return '';
    timeStr = timeStr.trim().toLowerCase();
    if (/^\d{1,2}:\d{2}$/.test(timeStr)) {
      const [h, m] = timeStr.split(':').map(Number);
      return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
    }
    const match = timeStr.match(/^(\d{1,2}):(\d{2})\s*(am|pm)$/i);
    if (match) {
      let h = parseInt(match[1], 10);
      const min = match[2];
      const period = match[3].toLowerCase();
      if (period === 'pm' && h !== 12) h += 12;
      if (period === 'am' && h === 12) h = 0;
      return `${String(h).padStart(2,'0')}:${min}`;
    }
    return timeStr;
  }

  async loadTrainDepartures(lat, lon, chosenTime = '') {
    try {
      const stationsUrl = `https://transportapi.com/v3/uk/places.json?lat=${lat}&lon=${lon}&type=train_station&app_id=${CONFIG.TRANSPORT_APP_ID}&app_key=${CONFIG.TRANSPORT_APP_KEY}`;
      const stationsData = await (await fetch(stationsUrl)).json();

      if (!stationsData.member || stationsData.member.length === 0) {
        return '<div class="transport-no-data">No nearby train stations found</div>';
      }

      const station   = stationsData.member[0];
      const queryDate = this._resolveQueryDate(chosenTime);
      const liveUrl   = queryDate.isFuture
        ? `https://transportapi.com/v3/uk/train/station/${station.station_code}/${queryDate.date}/${queryDate.time}/timetable.json?app_id=${CONFIG.TRANSPORT_APP_ID}&app_key=${CONFIG.TRANSPORT_APP_KEY}&train_status=passenger`
        : `https://transportapi.com/v3/uk/train/station/${station.station_code}/live.json?app_id=${CONFIG.TRANSPORT_APP_ID}&app_key=${CONFIG.TRANSPORT_APP_KEY}`;

      const liveData = await (await fetch(liveUrl)).json();

      // Cache departures for platform lookup AND delay reason checking
      if (!this.trainPlatformCache) this.trainPlatformCache = {};
      const deps = liveData.departures?.all || [];
      const normStation = station.name.toLowerCase().replace(/\s+/g, ' ').trim();
      this.trainPlatformCache[normStation] = deps.map(d => ({
        destination:       (d.destination_name || '').toLowerCase(),
        aimed:             d.aimed_departure_time || '',
        expected:          d.expected_departure_time || d.aimed_departure_time || '',
        platform:          d.platform || null,
        cancelled:         d.status === 'CANCELLED' || d.cancelled || false,
        running_late_reason: d.running_late_reason || d.delay_reason || ''
      }));

      const timeLabel = queryDate.isFuture
        ? `<span class="transport-time-badge"><img src="bustrain.png" width="13" height="13" style="object-fit:contain;vertical-align:middle;margin-right:4px">Departures from ${queryDate.time}</span>`
        : `<span class="transport-time-badge live"><img src="bustrain.png" width="13" height="13" style="object-fit:contain;vertical-align:middle;margin-right:4px">Live now</span>`;

      let html = `<div class="transport-stop-card train"><h3 class="transport-stop-title">${station.name} ${timeLabel}</h3>`;

      if (deps.length > 0) {
        deps.slice(0, 5).forEach((dep, index) => {
          const aimed      = dep.aimed_departure_time;
          const expected   = dep.expected_departure_time || aimed;
          const isCancelled = dep.status === 'CANCELLED' || dep.cancelled || false;
          const lateReason  = dep.running_late_reason || dep.delay_reason || '';
          const delayMins   = aimed && expected && !isCancelled
            ? Math.round((new Date(`1970-01-01T${expected}`) - new Date(`1970-01-01T${aimed}`)) / 60000)
            : 0;
          const isDelayed   = delayMins > 0;

          let statusClass, statusText;
          if (isCancelled) {
            statusClass = 'cancelled';
            statusText  = 'Cancelled';
          } else if (isDelayed) {
            statusClass = 'delayed';
            statusText  = `Delayed — ${delayMins} min late`;
          } else {
            statusClass = 'on-time';
            statusText  = 'On time';
          }

          const uniqueId = `train-${station.station_code}-${index}`;

          html += `
            <div class="departure-row${isCancelled ? ' departure-cancelled' : ''}" onclick="app.toggleDetails('${uniqueId}')">
              <div class="departure-main">
                <div class="departure-header">
                  <div>
                    <div class="departure-destination">${dep.destination_name}${isCancelled ? ' <span class="cancelled-tag">Cancelled</span>' : ''}</div>
                    <div class="departure-operator">${dep.operator_name}</div>
                  </div>
                  <div>
                    <div class="departure-time${isCancelled ? ' departure-time-cancelled' : ''}">${isCancelled ? aimed : expected}</div>
                    <div class="departure-status ${statusClass}">${statusText}</div>
                  </div>
                </div>
                ${lateReason ? `<div class="departure-reason"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" width="11" height="11"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>${lateReason}</div>` : ''}
                <div class="departure-footer">
                  <span>Platform ${dep.platform || 'TBA'}</span>
                  <span class="departure-tap">Tap for details</span>
                </div>
              </div>
              <div id="${uniqueId}" class="departure-details" style="display:none">
                <div class="departure-details-grid">
                  <div><div class="detail-label">Scheduled</div><div class="detail-value">${aimed}</div></div>
                  <div><div class="detail-label">Expected</div><div class="detail-value">${isCancelled ? '<span style="color:#dc2626;font-weight:600">Cancelled</span>' : expected}</div></div>
                  <div><div class="detail-label">Operator</div><div class="detail-value">${dep.operator_name}</div></div>
                  <div><div class="detail-label">Platform</div><div class="detail-value">${dep.platform || 'TBA'}</div></div>
                  ${lateReason ? `<div style="grid-column:1/-1"><div class="detail-label">Reason</div><div class="detail-value" style="color:#b45309">${lateReason}</div></div>` : ''}
                </div>
              </div>
            </div>`;
        });
      } else {
        html += `<div class="transport-no-data">No departures found for ${queryDate.isFuture ? queryDate.time : 'this time'}</div>`;
      }

      html += '</div>';
      return html;
    } catch {
      return '<div class="transport-error">Error loading train data</div>';
    }
  }

  async loadBusDepartures(lat, lon, chosenTime = '') {
    try {
      const stopsUrl  = `https://transportapi.com/v3/uk/places.json?lat=${lat}&lon=${lon}&type=bus_stop&app_id=${CONFIG.TRANSPORT_APP_ID}&app_key=${CONFIG.TRANSPORT_APP_KEY}`;
      const stopsData = await (await fetch(stopsUrl)).json();

      if (!stopsData.member || stopsData.member.length === 0) {
        return '<div class="transport-no-data">No nearby bus stops found</div>';
      }

      const stop         = stopsData.member[0];
      const busQueryDate = this._resolveQueryDate(chosenTime);
      const liveUrl      = busQueryDate.isFuture
        ? `https://transportapi.com/v3/uk/bus/stop/${stop.atcocode}/timetable.json?app_id=${CONFIG.TRANSPORT_APP_ID}&app_key=${CONFIG.TRANSPORT_APP_KEY}&group=route&limit=8&nextbuses=no&date=${busQueryDate.date}&time=${busQueryDate.time}`
        : `https://transportapi.com/v3/uk/bus/stop/${stop.atcocode}/live.json?app_id=${CONFIG.TRANSPORT_APP_ID}&app_key=${CONFIG.TRANSPORT_APP_KEY}&group=route&limit=5`;

      const liveData = await (await fetch(liveUrl)).json();

      const busTimeLabel = busQueryDate.isFuture
        ? `<span class="transport-time-badge"><img src="bustrain.png" width="13" height="13" style="object-fit:contain;vertical-align:middle;margin-right:4px">Departures from ${busQueryDate.time}</span>`
        : `<span class="transport-time-badge live"><img src="bustrain.png" width="13" height="13" style="object-fit:contain;vertical-align:middle;margin-right:4px">Live now</span>`;

      let html = `<div class="transport-stop-card bus"><h3 class="transport-stop-title">${stop.name} ${busTimeLabel}</h3>`;

      const busDeps = liveData.departures || {};
      if (Object.keys(busDeps).length > 0) {
        let idx = 0;
        Object.values(busDeps).slice(0, 5).forEach(buses => {
          const busArr = Array.isArray(buses) ? buses : [buses];
          busArr.slice(0, 1).forEach(bus => {
            const aimed    = bus.aimed_departure_time;
            const expected = bus.expected_departure_time || aimed;
            const delayMins = aimed && expected
              ? Math.round((new Date(`1970-01-01T${expected}`) - new Date(`1970-01-01T${aimed}`)) / 60000)
              : 0;
            const isDelayed   = delayMins > 0;
            const statusClass = isDelayed ? 'delayed' : 'on-time';
            const statusText  = isDelayed ? `Delayed (${delayMins} min late)` : 'On time';
            const uniqueId    = `bus-${stop.atcocode}-${idx++}`;

            html += `
              <div class="departure-row" onclick="app.toggleDetails('${uniqueId}')">
                <div class="departure-main">
                  <div class="departure-header">
                    <div>
                      <div class="departure-destination">${bus.line_name} → ${bus.direction}</div>
                      <div class="departure-operator">${bus.operator_name || ''}</div>
                    </div>
                    <div>
                      <div class="departure-time">${expected}</div>
                      <div class="departure-status ${statusClass}">${statusText}</div>
                    </div>
                  </div>
                  <div class="departure-footer">
                    <span>${bus.source || 'Live data'}</span>
                    <span class="departure-tap">Tap for details</span>
                  </div>
                </div>
                <div id="${uniqueId}" class="departure-details" style="display:none">
                  <div class="departure-details-grid">
                    <div><div class="detail-label">Scheduled</div><div class="detail-value">${aimed}</div></div>
                    <div><div class="detail-label">Expected</div><div class="detail-value">${expected}</div></div>
                    <div><div class="detail-label">Operator</div><div class="detail-value">${bus.operator_name || 'N/A'}</div></div>
                    <div><div class="detail-label">Tracking</div><div class="detail-value">${bus.expected_departure_time ? 'Live' : 'Scheduled'}</div></div>
                  </div>
                </div>
              </div>`;
          });
        });
      } else {
        html += '<div class="transport-no-data">No bus departures available</div>';
      }

      html += '</div>';
      return html;
    } catch {
      return '<div class="transport-error">Error loading bus data</div>';
    }
  }

  // ─── AUTH ────────────────────────────────────────────────────
  getUser() {
    const raw = sessionStorage.getItem('urbannav_user');
    return raw ? JSON.parse(raw) : null;
  }

  setUser(user) {
    sessionStorage.setItem('urbannav_user', JSON.stringify(user));
    this.updateAuthUI();
    this.loadFavouritesFromDB();
    this.renderWellnessCard();
  }

  clearUser() {
    sessionStorage.removeItem('urbannav_user');
    this.updateAuthUI();
    this.renderFavList([]);
    this.updateFavBadge(0);
    this.closeWellnessSheet();
    this.closeUserMenu();
  }

  updateAuthUI() {
    const user         = this.getUser();
    const loginBtn     = document.getElementById('authLoginBtn');
    const userLabel    = document.getElementById('authUserLabel');
    const userMenuWrap = document.getElementById('userMenuWrap');
    if (!loginBtn) return;
    if (user) {
      loginBtn.style.display     = 'none';
      userMenuWrap.style.display = 'inline-flex';
      if (userLabel) userLabel.textContent = user.first_name;
    } else {
      loginBtn.style.display     = 'inline-flex';
      userMenuWrap.style.display = 'none';
    }
  }

  toggleUserMenu() {
    const dropdown = document.getElementById('userMenuDropdown');
    const btn      = document.getElementById('userMenuBtn');
    if (!dropdown) return;
    const isOpen = dropdown.style.display !== 'none';
    if (isOpen) {
      this.closeUserMenu();
    } else {
      dropdown.style.display = 'block';
      btn.setAttribute('aria-expanded', 'true');
      setTimeout(() => {
        document.addEventListener('click', this._userMenuOutsideClick, { once: true });
      }, 0);
    }
  }

  closeUserMenu() {
    const dropdown = document.getElementById('userMenuDropdown');
    const btn      = document.getElementById('userMenuBtn');
    if (dropdown) dropdown.style.display = 'none';
    if (btn)      btn.setAttribute('aria-expanded', 'false');
  }

  _userMenuOutsideClick = (e) => {
    const wrap = document.getElementById('userMenuWrap');
    if (wrap && !wrap.contains(e.target)) this.closeUserMenu();
  };

  // ─── SAVE ROUTE ──────────────────────────────────────────────
  async saveRoute() {
    if (!this.currentRoute || !this.selectedMode) return;
    const user = this.getUser();
    if (!user) { this.openAuthModal('login'); return; }

    const from = document.getElementById('fromInput').value;
    const to   = document.getElementById('toInput').value;

    try {
      const rawText = await (await fetch('save_favourite.php', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ user_id: user.user_id, start_location: from, destination: to, departure_time: null })
      })).text();

      let data;
      try { data = JSON.parse(rawText); } catch {
        this.showToast('PHP error: ' + rawText.replace(/<[^>]+>/g, '').trim().slice(0, 150), true);
        return;
      }

      if (data.success) {
        const btn = document.getElementById('saveRouteBtn');
        if (btn) btn.classList.add('saved');
        await this.loadFavouritesFromDB();
        document.getElementById('favPanel').style.display = 'block';
        this.showToast('Route saved to favourites!');
      } else {
        this.showToast(data.error || 'Could not save route', true);
      }
    } catch (e) {
      this.showToast('Could not reach server. Check: are you on http://localhost:8888 ?', true);
    }
  }

  showToast(message, isError = false) {
    const existing = document.getElementById('urbanToast');
    if (existing) existing.remove();
    const toast = document.createElement('div');
    toast.id = 'urbanToast';
    toast.textContent = message;
    toast.style.cssText = `
      position:fixed;bottom:24px;left:50%;transform:translateX(-50%);
      background:${isError ? '#DC2626' : '#1E40AF'};color:white;
      padding:10px 22px;border-radius:20px;font-size:13px;font-weight:600;
      z-index:9999;box-shadow:0 4px 16px rgba(0,0,0,0.25);
      white-space:nowrap;pointer-events:none;`;
    document.body.appendChild(toast);
    setTimeout(() => { if (toast.parentNode) toast.remove(); }, 3000);
  }

  async loadFavouritesFromDB() {
    const user = this.getUser();
    if (!user) return;
    try {
      const rawText = await (await fetch(`get_favourites.php?user_id=${user.user_id}`)).text();
      let data;
      try { data = JSON.parse(rawText); } catch { return; }
      if (data.success) {
        this.updateFavBadge(data.favourites.length);
        this.renderFavList(data.favourites);
      }
    } catch (e) { console.warn('Could not load favourites:', e); }
  }

  async deleteFav(favourite_id) {
    const user = this.getUser();
    if (!user) return;
    try {
      const data = await (await fetch('delete_favourite.php', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ user_id: user.user_id, favourite_id })
      })).json();
      if (data.success) { this.showToast('Route removed'); this.loadFavouritesFromDB(); }
      else               { this.showToast(data.error || 'Could not remove', true); }
    } catch { this.showToast('Server error', true); }
  }

  updateFavBadge(count) {
    const badge = document.getElementById('favCount');
    if (!badge) return;
    badge.style.display = count > 0 ? 'flex' : 'none';
    badge.textContent   = count;
  }

  renderFavList(favs) {
    const list = document.getElementById('favList');
    if (!list) return;
    const user = this.getUser();
    if (!user) {
      list.innerHTML = `<p class="fav-empty"><a href="#" onclick="app.openAuthModal('login')" style="color:var(--brand);font-weight:600;">Log in</a> to see your saved routes.</p>`;
      return;
    }
    if (!favs || favs.length === 0) {
      list.innerHTML = '<p class="fav-empty">No saved routes yet.<br>Complete a route and save it to see it here.</p>';
      return;
    }
    list.innerHTML = favs.map(f => `
      <div class="fav-item">
        <div class="fav-item-main"
             data-from="${this.escAttr(f.start_location)}"
             data-to="${this.escAttr(f.destination)}"
             onclick="app.loadFav(this.dataset.from, this.dataset.to)">
          <div class="fav-item-route">${this.escHtml(f.start_location)} to ${this.escHtml(f.destination)}</div>
          <div class="fav-item-meta">Saved ${new Date(f.saved_at).toLocaleDateString('en-GB')}</div>
        </div>
        <button class="fav-delete-btn" onclick="app.deleteFav(${f.favourite_id})" title="Remove">✕</button>
      </div>`).join('');
  }

  escAttr(str) { return String(str).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }
  escHtml(str) { return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

  loadFav(from, to) {
    document.getElementById('fromInput').value = from;
    document.getElementById('toInput').value   = to;
    document.getElementById('favPanel').style.display = 'none';
    this.findRoute();
  }

  // ─── AUTH MODAL ──────────────────────────────────────────────
  openAuthModal(tab = 'login') {
    document.getElementById('authModal').style.display = 'flex';
    this.switchAuthTab(tab);
  }

  closeAuthModal() {
    document.getElementById('authModal').style.display = 'none';
    document.getElementById('authError').textContent   = '';
  }

  switchAuthTab(tab) {
    document.getElementById('authLoginForm').style.display    = tab === 'login'    ? 'block' : 'none';
    document.getElementById('authRegisterForm').style.display = tab === 'register' ? 'block' : 'none';
    document.getElementById('tabLogin').classList.toggle('auth-tab-active',    tab === 'login');
    document.getElementById('tabRegister').classList.toggle('auth-tab-active', tab === 'register');
    document.getElementById('authError').textContent = '';
  }

  async submitLogin() {
    const email    = document.getElementById('loginEmail').value.trim();
    const password = document.getElementById('loginPassword').value;
    const errEl    = document.getElementById('authError');
    errEl.textContent = '';
    if (!email || !password) { errEl.textContent = 'Please fill in all fields'; return; }

    try {
      const rawText = await (await fetch('login.php', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      })).text();
      let data;
      try { data = JSON.parse(rawText); } catch {
        errEl.textContent = 'Server error — check browser console';
        return;
      }
      if (data.success) { this.setUser(data); this.closeAuthModal(); }
      else               { errEl.textContent = data.error || 'Login failed'; }
    } catch { errEl.textContent = 'Cannot reach server — are you on http://localhost:8888 ?'; }
  }

  async submitRegister() {
    const first_name = document.getElementById('regFirstName').value.trim();
    const last_name  = document.getElementById('regLastName').value.trim();
    const email      = document.getElementById('regEmail').value.trim();
    const password   = document.getElementById('regPassword').value;
    const errEl      = document.getElementById('authError');
    errEl.textContent = '';
    if (!first_name || !last_name || !email || !password) { errEl.textContent = 'Please fill in all fields'; return; }

    try {
      const rawText = await (await fetch('register.php', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ first_name, last_name, email, password })
      })).text();
      let data;
      try { data = JSON.parse(rawText); } catch {
        errEl.textContent = 'Server error — check browser console';
        return;
      }
      if (data.success) { this.setUser(data); this.closeAuthModal(); }
      else               { errEl.textContent = data.error || 'Registration failed'; }
    } catch { errEl.textContent = 'Cannot reach server — are you on http://localhost:8888 ?'; }
  }

  // ─── DEPARTURE TIME HELPERS ──────────────────────────────────
  _getDepartureDate() {
    const timeInput = document.getElementById('departureTime');
    const val = timeInput ? timeInput.value.trim() : '';
    if (!val) return null;
    const parts = val.split(':');
    const h = parseInt(parts[0], 10);
    const m = parseInt(parts[1], 10);
    if (isNaN(h) || isNaN(m)) return null;
    const now = new Date();
    const d   = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m, 0, 0);
    if (d <= now) d.setDate(d.getDate() + 1);
    return d;
  }

  _getDepartureTimeString() {
    const timeInput = document.getElementById('departureTime');
    return timeInput ? timeInput.value.trim() : '';
  }

  _resolveQueryDate(chosenTime) {
    chosenTime = chosenTime || '';
    const now   = new Date();
    const yyyy  = now.getFullYear();
    const mm    = String(now.getMonth() + 1).padStart(2, '0');
    const dd    = String(now.getDate()).padStart(2, '0');
    const today = `${yyyy}-${mm}-${dd}`;

    if (!chosenTime) {
      return { date: today, time: `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`, isFuture: false };
    }

    const [h, m] = chosenTime.split(':').map(Number);
    const chosen = new Date(now);
    chosen.setHours(h, m, 0, 0);

    if (chosen <= now) {
      const tomorrow = new Date(now);
      tomorrow.setDate(tomorrow.getDate() + 1);
      return {
        date: `${tomorrow.getFullYear()}-${String(tomorrow.getMonth()+1).padStart(2,'0')}-${String(tomorrow.getDate()).padStart(2,'0')}`,
        time: chosenTime, isFuture: true
      };
    }
    return { date: today, time: chosenTime, isFuture: true };
  }

  toggleDetails(elementId) {
    const element = document.getElementById(elementId);
    if (!element) return;
    element.style.display = (element.style.display === 'none' || !element.style.display) ? 'block' : 'none';
  }

  // ─── INIT FAVOURITES ─────────────────────────────────────────
  initFavouritesOnLoad() {
    this.updateAuthUI();
    this.loadFavouritesFromDB();
    this.renderWellnessCard();
  }

  // ─── AUTO-REFRESH ON TIME CHANGE ─────────────────────────────
  _onDepartureTimeChange() {
    const from = document.getElementById('fromInput').value.trim();
    const to   = document.getElementById('toInput').value.trim();
    if (!from || !to || !this.currentRoute) return;
    clearTimeout(this._timeChangeDebounce);
    this._timeChangeDebounce = setTimeout(() => {
      this._clearAltRenderers();
      if (this.selectedMode && this.selectedMode !== 'TRANSIT') {
        this.selectMode(this.selectedMode);
      } else {
        this.selectBestMode(document.getElementById('bestModeBtn'));
      }
    }, 400);
  }

  // ─── ROUTE CALCULATION ───────────────────────────────────────
  _getFastestRouteIndex(routes) {
    let bestIdx = 0, bestSecs = Infinity;
    routes.forEach((route, i) => {
      const secs = route.legs.reduce((sum, leg) => sum + leg.duration.value, 0);
      if (secs < bestSecs) { bestSecs = secs; bestIdx = i; }
    });
    return bestIdx;
  }

  _getLeastDisruptedRouteIndex(routes) {
    const kw = /clos|delay|divert|suspend|replac|alert|incident|congesti/i;
    const scores = routes.map(route => {
      let score = 0;
      route.legs.forEach(leg => {
        score += leg.steps.length;
        leg.steps.forEach(step => {
          if (step.travel_mode === 'TRANSIT') score += 2;
          if (step.instructions && kw.test(step.instructions)) score += 5;
          if (step.steps) step.steps.forEach(sub => { if (sub.instructions && kw.test(sub.instructions)) score += 5; });
        });
      });
      return score;
    });
    return scores.indexOf(Math.min(...scores));
  }

  // Route badges — only shown when stress-free is OFF.
  // When stress-free is ON the selected route is intentionally different
  // from the "fastest", so those labels would be incorrect.
  _getRouteBadges(routes, selectedIndex) {
    if (this.preferEasyRoute) return '';
    const fastestIdx   = this._getFastestRouteIndex(routes);
    const leastDisrIdx = this._getLeastDisruptedRouteIndex(routes);
    let badges = '';
    if (selectedIndex === fastestIdx)   badges += `<span class="route-badge badge-fastest">Fastest Route</span>`;
    if (selectedIndex === leastDisrIdx) badges += `<span class="route-badge badge-least-disrupted">Least Disrupted</span>`;
    return badges;
  }

  calculateRoute(origin, destination, travelMode, departureTime = null) {
    return new Promise((resolve, reject) => {
      const request = {
        origin,
        destination,
        travelMode: google.maps.TravelMode[travelMode],
        provideRouteAlternatives: true
      };
      if (travelMode === 'TRANSIT') {
        request.transitOptions = { departureTime: (departureTime instanceof Date) ? departureTime : new Date() };
      }
      if (travelMode === 'DRIVING') {
        request.drivingOptions = {
          departureTime: (departureTime instanceof Date) ? departureTime : new Date(),
          trafficModel:  'bestguess'
        };
      }
      this.directionsService.route(request, (result, status) => {
        if (status === 'OK') resolve(result);
        else reject(new Error(`Route calculation failed: ${status}`));
      });
    });
  }

  geocodeAddress(geocoder, address) {
    return new Promise((resolve, reject) => {
      geocoder.geocode({ address }, (results, status) => {
        if (status === 'OK') resolve(results[0]);
        else reject(new Error(`Location not found: ${status}`));
      });
    });
  }

  getWeatherEmoji(condition, iconCode) {
    return `<img src="https://openweathermap.org/img/wn/${iconCode}@2x.png" width="64" height="64" alt="${condition}">`;
  }

  // ─── BEST (MULTIMODAL) MODE ──────────────────────────────────
  async selectBestMode(btnEl) {
    this.selectedMode = 'TRANSIT';
    document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
    if (btnEl) btnEl.classList.add('active');

    this.showLoading('routeInfo', 'Finding best multimodal journey...');

    try {
      const from    = document.getElementById('fromInput').value;
      const to      = document.getElementById('toInput').value;
      const depDate = this._getDepartureDate();
      const result  = await this.calculateRoute(from, to, 'TRANSIT', depDate);
      this.currentRoute = result;
      this.allRoutes    = result.routes;

      const preferredIdx = this.preferEasyRoute
        ? this._getStressFreeRouteIndex(result.routes)
        : 0;

      this._showAllRoutes(result, preferredIdx);

      const routeBounds = result.routes[preferredIdx].bounds || result.routes[0].bounds;
      if (routeBounds) this.map.fitBounds(routeBounds, { top: 60, right: 40, bottom: 40, left: 40 });

      // Prime platform cache using departure time from the actual route
      const firstTransit = result.routes[0]?.legs[0]?.steps
        ?.find(s => s.travel_mode === 'TRANSIT' && s.transit?.departure_time);
      const cacheTime = firstTransit
        ? firstTransit.transit.departure_time.text
        : this._getDepartureTimeString();
      await this._primeTrainPlatformCache(cacheTime);

      this.displayBestRoute(result);
      this.displayEnvironmentalImpact(result, 'TRANSIT');
      if (window._onEcoReady) window._onEcoReady();
      document.getElementById('alertsSection').style.display = 'block';
      await this.loadLiveTransport();
      this.checkForDelays();

    } catch (error) {
      this.showError('routeInfo', 'Could not find a transit route. Try entering locations near public transport.');
    }
  }

  // ─── DISPLAY BEST ROUTE ──────────────────────────────────────
  displayBestRoute(result) {
    const routes    = result.routes;
    const totalDur  = routes[0].legs.reduce((s, l) => s + l.duration.value, 0);
    const totalDist = routes[0].legs.reduce((s, l) => s + l.distance.value, 0);

    const optionCards = routes.slice(0, 3).map((route, idx) => {
      const leg     = route.legs[0];
      const dur     = route.legs.reduce((s, l) => s + l.duration.value, 0);
      const durText = dur < 3600
        ? `${Math.round(dur / 60)} min`
        : `${Math.floor(dur / 3600)}h ${Math.round((dur % 3600) / 60)}m`;

      const chips    = this._buildLegChips(leg.steps);
      const dep      = leg.departure_time ? leg.departure_time.text : '';
      const arr      = leg.arrival_time   ? leg.arrival_time.text   : '';
      const timeRange = dep && arr ? `${dep} – ${arr}` : durText;

      // Stress-Free: mark the stress-free pick; hide Fastest/Least Disrupted labels
      const stressFreeIdx  = this.preferEasyRoute ? this._getStressFreeRouteIndex(routes) : -1;
      const isLowStress    = (idx === stressFreeIdx);
      const lowStressLabel = isLowStress
        ? `<div class="low-stress-badge" style="margin-top:4px">Low Stress Route</div>`
        : '';

      // Show Fastest/Least Disrupted chips on option cards only when stress-free is OFF
      let optionBadges = '';
      if (!this.preferEasyRoute) {
        if (idx === this._getFastestRouteIndex(routes))        optionBadges += `<span class="route-badge badge-fastest" style="font-size:0.65rem">Fastest</span>`;
        if (idx === this._getLeastDisruptedRouteIndex(routes)) optionBadges += `<span class="route-badge badge-least-disrupted" style="font-size:0.65rem">Least Disrupted</span>`;
      }

      const relScore = this._calcReliabilityScore(leg, 'TRANSIT', null);
      const relCls   = this._reliabilityClass(relScore);
      const relLabel = this._reliabilityLabel(relScore);
      const relChip  = `<div class="mm-reliability-chip ${relCls}">⬤ ${relScore}% — ${relLabel}</div>`;
      const fatChip  = this._buildFatigueChipHTML(leg, 'TRANSIT');
      const isFirst  = idx === 0;
      const optLabel = isFirst ? '<span class="mm-option-label">Best</span>' : '';

      return `
        <div class="mm-option-card${isFirst ? ' mm-selected' : ''}${isLowStress ? ' low-stress-selected' : ''}" id="mmOption${idx}"
             onclick="app.selectMmOption(${idx}, event)">
          ${optLabel}
          ${lowStressLabel}
          ${optionBadges ? `<div style="margin-bottom:4px">${optionBadges}</div>` : ''}
          <div class="mm-option-top">
            <span class="mm-option-time-range">${timeRange}</span>
            <span class="mm-option-duration">${durText}</span>
          </div>
          <div class="mm-option-legs">${chips}</div>
          ${relChip}
          ${fatChip}
          <button class="mm-details-toggle" id="mmToggle${idx}" onclick="app.toggleMmDetails(${idx}, event)">
            <span>Details</span>
            <span class="mm-toggle-arrow">&#9660;</span>
          </button>
          <div class="mm-journey-details" id="mmDetails${idx}">
            ${this._buildJourneyTimeline(route.legs[0])}
          </div>
        </div>`;
    }).join('');

    const distKm   = (totalDist / 1000).toFixed(1);
    const durMins  = Math.round(totalDur / 60);
    const bestLeg  = routes[0].legs[0];
    const relScore = this._calcReliabilityScore(bestLeg, 'TRANSIT', null);
    const relHTML  = this._buildReliabilityHTML(relScore, 'TRANSIT', bestLeg);
    const fatHTML  = this._buildFatigueWarningHTML(bestLeg, 'TRANSIT');

    // Stress-free banner only — no duplicate badges
    const stressFreeHTML = this.preferEasyRoute
      ? `<div class="stress-free-banner">Commuter Stress-Free Mode ON — ranked by fewest transfers, least walking, then time</div>`
      : '';
    const energyHTML = (window._userEnergyLevel === 'low')
      ? `<div class="energy-info-banner">Low energy mode — routes with fewer transfers &amp; less walking shown first</div>`
      : '';

    this._recordWellnessJourney(bestLeg, 'TRANSIT', relScore);

    document.getElementById('routeInfo').innerHTML = `
      <div class="mm-summary-strip">
        <div>
          <div class="mm-summary-total">${durMins} min</div>
          <div class="mm-summary-sub">Best multimodal journey</div>
        </div>
        <div class="mm-summary-dist">${distKm} km</div>
      </div>
      ${energyHTML}${stressFreeHTML}
      ${relHTML}
      ${fatHTML}

      <!-- Smart Insights toggle buttons -->
      <div class="ai-btn-row">
        <button class="ai-btn" id="aiSummaryBtn" onclick="app.toggleAiBox('aiSummaryBox', 'aiSummaryBtn', 'Journey Summary', this)">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" width="14" height="14">
            <path d="M12 2a10 10 0 1 0 10 10"/><path d="M12 8v4l3 3"/><circle cx="19" cy="5" r="3" fill="currentColor" stroke="none"/>
          </svg>
          <span>Journey Summary</span>
        </button>
        <button class="ai-btn ai-btn-compare" id="aiCompareBtn" onclick="app.toggleAiBox('aiSummaryBox', 'aiCompareBtn', 'Compare Routes', this)">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" width="14" height="14">
            <line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/>
          </svg>
          <span>Compare Routes</span>
        </button>
      </div>
      <div id="aiSummaryBox" class="ai-box-hidden"></div>

      <div class="mm-options-row">${optionCards}</div>`;

    const firstDetails = document.getElementById('mmDetails0');
    const firstToggle  = document.getElementById('mmToggle0');
    if (firstDetails) firstDetails.classList.add('open');
    if (firstToggle)  firstToggle.classList.add('open');
  }

  selectMmOption(idx, e) {
    if (e.target.closest('.mm-details-toggle')) return;
    document.querySelectorAll('.mm-option-card').forEach((c, i) => {
      c.classList.toggle('mm-selected', i === idx);
    });
    if (this.currentRoute) {
      this._showAllRoutes(this.currentRoute, idx);
      const bounds = this.currentRoute.routes[idx].bounds;
      if (bounds) this.map.fitBounds(bounds, { top:60, right:40, bottom:40, left:40 });
    }
  }

  toggleMmDetails(idx, e) {
    e.stopPropagation();
    const details = document.getElementById(`mmDetails${idx}`);
    const toggle  = document.getElementById(`mmToggle${idx}`);
    if (!details) return;
    const isOpen = details.classList.toggle('open');
    toggle.classList.toggle('open', isOpen);
  }

  _buildLegChips(steps) {
    const parts = [];
    let lastMode = null;
    steps.forEach(step => {
      if (step.travel_mode === 'WALKING') {
        if (lastMode !== 'WALKING') {
          parts.push({ type: 'walk', imgSrc: 'walking-icon-0.png', imgAlt: 'Walk', label: step.duration.text });
          lastMode = 'WALKING';
        }
      } else if (step.travel_mode === 'TRANSIT') {
        const td = step.transit;
        const vt = td ? td.line.vehicle.type : '';
        const ln = td ? (td.line.short_name || td.line.name || '') : '';
        let cls = 'train', imgSrc = 'bustrain.png', imgAlt = 'Train';
        if (vt === 'BUS' || vt === 'TROLLEYBUS')       { cls = 'bus';    imgAlt = 'Bus'; }
        else if (vt === 'TRAM' || vt === 'LIGHT_RAIL') { cls = 'tram';   imgAlt = 'Tram'; }
        else if (vt === 'SUBWAY' || vt === 'METRO_RAIL') { cls = 'subway'; imgAlt = 'Subway'; }
        parts.push({ type: cls, imgSrc, imgAlt, label: ln });
        lastMode = 'TRANSIT';
      }
    });
    return parts.map((p, i) => {
      const arrow = i < parts.length - 1 ? '<span class="mm-leg-arrow">›</span>' : '';
      return `<span class="mm-leg-chip ${p.type}"><img src="${p.imgSrc}" alt="${p.imgAlt}" width="13" height="13" style="object-fit:contain;vertical-align:middle;margin-right:3px">${p.label}</span>${arrow}`;
    }).join('');
  }

  // ─── PLATFORM CACHE ──────────────────────────────────────────
  async _primeTrainPlatformCache(chosenTime = '') {
    try {
      let lat, lon;
      if (this._originLatLng) {
        lat = this._originLatLng.lat();
        lon = this._originLatLng.lng();
      } else {
        const from = document.getElementById('fromInput').value;
        if (!from) return;
        const geocoder     = new google.maps.Geocoder();
        const originResult = await this.geocodeAddress(geocoder, from);
        lat = originResult.geometry.location.lat();
        lon = originResult.geometry.location.lng();
      }
      await this.loadTrainDepartures(lat, lon, chosenTime);
    } catch (e) { console.warn('Could not prime platform cache:', e); }
  }

  

  _lookupPlatform(stopName, depTimeText) {
    if (!this.trainPlatformCache) return null;
    const normStop = stopName.toLowerCase().replace(/\s+/g, ' ').trim();
    const cacheKey = Object.keys(this.trainPlatformCache).find(k =>
      normStop.includes(k) || k.includes(normStop)
    );
    if (!cacheKey) return null;
    const entries = this.trainPlatformCache[cacheKey];
    if (!entries?.length) return null;
    const toMins = t => { if (!t) return -1; const [h,m] = t.split(':'); return parseInt(h)*60+parseInt(m); };
    const target = toMins(depTimeText);
    let best = null, bestDiff = Infinity;
    entries.forEach(e => {
      const diff = Math.abs(toMins(e.aimed) - target);
      if (diff <= 2 && diff < bestDiff && e.platform) { bestDiff = diff; best = e.platform; }
    });
    return best;
  }

  // ─── JOURNEY TIMELINE ────────────────────────────────────────
  _buildJourneyTimeline(leg) {
    const depTime = leg.departure_time ? leg.departure_time.text : '';
    const arrTime = leg.arrival_time   ? leg.arrival_time.text   : '';
    let html = '<div class="mm-timeline">';

    leg.steps.forEach((step, i) => {
      const isFirst = i === 0;
      const isLast  = i === leg.steps.length - 1;

      if (step.travel_mode === 'WALKING') {
        const dist = step.distance.text;
        const dur  = step.duration.text;
        if (isFirst) {
          html += `
            <div class="mm-tl-segment seg-walk">
              <div class="mm-tl-dot dot-start"></div>
              <div class="mm-tl-stop">
                <span class="mm-tl-stop-time">${depTime}</span>
                <div>
                  <div class="mm-tl-stop-name">${leg.start_address ? leg.start_address.split(',')[0] : 'Start'}</div>
                  <div class="mm-tl-stop-sub">Starting point</div>
                </div>
              </div>
              <div class="mm-tl-leg-body leg-walk">
                <div class="mm-tl-leg-header">
                  <span class="mm-tl-leg-icon"><img src="walking-icon-0.png" alt="Walk" width="16" height="16" style="object-fit:contain;vertical-align:middle"></span>
                  <span class="mm-tl-leg-name">Walk</span>
                </div>
                <div class="mm-tl-leg-meta">${dist} · ${dur}</div>
              </div>
            </div>`;
        } else {
          html += `
            <div class="mm-tl-segment seg-walk">
              <div class="mm-tl-dot dot-walk"></div>
              <div class="mm-tl-stop">
                <span class="mm-tl-stop-time"></span>
                <div><div class="mm-tl-stop-name">${isLast ? 'Walk to destination' : 'Walk'}</div></div>
              </div>
              <div class="mm-tl-leg-body leg-walk">
                <div class="mm-tl-leg-header">
                  <span class="mm-tl-leg-icon"><img src="walking-icon-0.png" alt="Walk" width="16" height="16" style="object-fit:contain;vertical-align:middle"></span>
                  <span class="mm-tl-leg-name">Walk</span>
                </div>
                <div class="mm-tl-leg-meta">${dist} · ${dur}</div>
              </div>
            </div>`;
        }

      } else if (step.travel_mode === 'TRANSIT') {
        const td = step.transit;
        const depStop   = td.departure_stop.name;
        const arrStop   = td.arrival_stop.name;
        const depT      = td.departure_time.text;
        const arrT      = td.arrival_time.text;
        const lineName  = td.line.short_name || td.line.name || '';
        const lineFullName = td.line.name || lineName;
        const operator  = td.line.agencies ? td.line.agencies[0].name : '';
        const vt        = td.line.vehicle.type;
        const platform  = this._lookupPlatform(depStop, depT);

        let legClass = 'leg-train', imgSrc = 'bustrain.png', imgAlt = 'Train', badgeClass = 'badge-train';
        if (vt === 'BUS' || vt === 'TROLLEYBUS')       { legClass = 'leg-bus';    imgAlt = 'Bus';    badgeClass = 'badge-bus'; }
        else if (vt === 'TRAM' || vt === 'LIGHT_RAIL') { legClass = 'leg-tram';   imgAlt = 'Tram'; }
        else if (vt === 'SUBWAY')                       { legClass = 'leg-subway'; imgAlt = 'Subway'; }

        const stopPlural   = td.num_stops === 1 ? '1 stop' : `${td.num_stops} stops`;
        const platformHTML = platform ? `<span class="mm-tl-platform-badge">Platform ${platform}</span>` : '';

        html += `
          <div class="mm-tl-segment seg-transit">
            <div class="mm-tl-dot dot-transit"></div>
            <div class="mm-tl-stop">
              <span class="mm-tl-stop-time">${depT}</span>
              <div>
                <div class="mm-tl-stop-name">${depStop}</div>
                <div class="mm-tl-stop-sub">Board here ${platformHTML}</div>
              </div>
            </div>
            <div class="mm-tl-leg-body ${legClass}">
              <div class="mm-tl-leg-header">
                <span class="mm-tl-leg-icon"><img src="${imgSrc}" alt="${imgAlt}" width="16" height="16" style="object-fit:contain;vertical-align:middle"></span>
                <span class="mm-tl-leg-name">${lineFullName}</span>
                <span class="mm-tl-leg-badge ${badgeClass}">${lineName}</span>
                <span class="mm-on-time">On time</span>
              </div>
              <div class="mm-tl-leg-meta">Towards ${td.headsign || arrStop} · ${stopPlural} · ${step.duration.text}</div>
              ${operator ? `<div class="mm-tl-leg-detail">Operated by <strong>${operator}</strong></div>` : ''}
            </div>
          </div>
          <div class="mm-tl-segment seg-transit">
            <div class="mm-tl-dot dot-transit"></div>
            <div class="mm-tl-stop">
              <span class="mm-tl-stop-time">${arrT}</span>
              <div>
                <div class="mm-tl-stop-name">${arrStop}</div>
                <div class="mm-tl-stop-sub">Alight here</div>
              </div>
            </div>
          </div>`;
      }
    });

    html += `
      <div class="mm-tl-segment">
        <div class="mm-tl-dot dot-end"></div>
        <div class="mm-tl-stop">
          <span class="mm-tl-stop-time">${arrTime}</span>
          <div>
            <div class="mm-tl-stop-name">${leg.end_address ? leg.end_address.split(',')[0] : 'Destination'}</div>
            <div class="mm-tl-stop-sub">You have arrived</div>
          </div>
        </div>
      </div>
    </div>`;
    return html;
  }

  // ─── STRESS-FREE MODE ────────────────────────────────────────
  toggleStressFreeMode() {
    const isOn = localStorage.getItem('urbannav_stressfree') === 'true';
    const next = !isOn;
    localStorage.setItem('urbannav_stressfree', next ? 'true' : 'false');
    this.preferEasyRoute = next;
    this._applyStressFreeUI(next);

    const from = document.getElementById('fromInput').value;
    const to   = document.getElementById('toInput').value;
    if (from && to) {
      this._clearAltRenderers();
      if (this.selectedMode && this.selectedMode !== 'TRANSIT') {
        this.selectMode(this.selectedMode);
      } else {
        this.selectBestMode(document.getElementById('bestModeBtn'));
      }
    }
  }

  _applyStressFreeUI(isOn) {
    const btn  = document.getElementById('stressFreeBtn');
    const hint = document.getElementById('stressFreeHint');
    if (!btn) return;
    btn.setAttribute('aria-pressed', isOn ? 'true' : 'false');
    if (hint) hint.style.display = isOn ? 'block' : 'none';
  }

  _getStressFreeRouteIndex(routes) {
    const scored = routes.map((route, idx) => {
      let transfers = 0, walkingMins = 0, stepCount = 0;
      route.legs.forEach(leg => {
        stepCount += leg.steps.length;
        leg.steps.forEach(step => {
          if (step.travel_mode === 'TRANSIT') transfers++;
          if (step.travel_mode === 'WALKING') walkingMins += (step.duration?.value || 0) / 60;
        });
      });
      const totalSecs  = route.legs.reduce((s, l) => s + l.duration.value, 0);
      const stressScore = (transfers * 1000) + (walkingMins * 10) + (stepCount * 1) + (totalSecs / 10000);
      return { idx, stressScore };
    });
    scored.sort((a, b) => a.stressScore - b.stressScore);
    return scored[0].idx;
  }

  // ─── RELIABILITY SCORE ───────────────────────────────────────
  _calcReliabilityScore(leg, mode, result) {
    let score = 100;

    if (mode === 'WALKING') {
      score -= Math.min(50, Math.floor(((leg.duration?.value || 0) / 60) / 2));

    } else if (mode === 'BICYCLING') {
      score -= Math.min(30, Math.floor(((leg.duration?.value || 0) / 60) / 4));

    } else if (mode === 'DRIVING') {
      if (leg.duration_in_traffic && leg.duration?.value > 0) {
        const ratio = leg.duration_in_traffic.value / leg.duration.value;
        if      (ratio <= 1.10) score = Math.round(90 + (1.10 - ratio) / 0.10 * 10);
        else if (ratio <= 1.25) score = Math.round(70 + (1.25 - ratio) / 0.15 * 19);
        else if (ratio <= 1.50) score = Math.round(45 + (1.50 - ratio) / 0.25 * 24);
        else if (ratio <= 1.80) score = Math.round(20 + (1.80 - ratio) / 0.30 * 24);
        else                    score = Math.max(0, Math.round(20 - (ratio - 1.80) * 30));
        leg._trafficDelayRatio = ratio;
      } else {
        score = Math.max(60, 100 - (leg.steps?.length || 0) * 2);
        leg._trafficDelayRatio = null;
      }

    } else {
      let transitCount = 0, walkingMins = 0;
      leg.steps?.forEach(step => {
        if (step.travel_mode === 'TRANSIT') {
          transitCount++;
          if (step.transit) {
            const depStop = step.transit.departure_stop?.name || '';
            const depTime = step.transit.departure_time?.text || '';
            if (this._checkCachedDelay(depStop, depTime) === 'delayed') { score -= 20; }
          }
        }
        if (step.travel_mode === 'WALKING') walkingMins += (step.duration?.value || 0) / 60;
      });
      score -= transitCount * 15;
      score -= Math.floor(walkingMins / 5) * 5;
    }

    return Math.max(0, Math.min(100, Math.round(score)));
  }

  _checkCachedDelay(stopName, depTimeText) {
    if (!this.trainPlatformCache) return 'unknown';
    const normStop = stopName.toLowerCase().replace(/\s+/g, ' ').trim();
    const cacheKey = Object.keys(this.trainPlatformCache).find(k =>
      normStop.includes(k) || k.includes(normStop)
    );
    if (!cacheKey) return 'unknown';
    const entries = this.trainPlatformCache[cacheKey];
    if (!entries?.length) return 'unknown';
    const toMins = t => { if (!t) return -1; const [h,m] = t.split(':'); return parseInt(h)*60+parseInt(m); };
    const target = toMins(depTimeText);
    let status = 'unknown';
    entries.forEach(e => {
      if (Math.abs(toMins(e.aimed) - target) <= 3) {
        status = toMins(e.expected) > toMins(e.aimed) + 1 ? 'delayed' : 'ontime';
      }
    });
    return status;
  }

  _reliabilityClass(score) {
    if (score >= 70) return 'score-high';
    if (score >= 40) return 'score-medium';
    return 'score-low';
  }

  _reliabilityLabel(score) {
    if (score >= 70) return '✓ Reliable';
    if (score >= 40) return '~ Moderate';
    return '⚠ Low';
  }

  _reliabilitySubtitle(mode, leg) {
    if (mode === 'DRIVING') {
      const ratio = leg?._trafficDelayRatio;
      if (ratio === null || ratio === undefined) return 'Based on route complexity (live traffic data unavailable)';
      const delayMins = leg.duration_in_traffic && leg.duration
        ? Math.round((leg.duration_in_traffic.value - leg.duration.value) / 60) : 0;
      const delayText = delayMins > 0 ? ` (+${delayMins} min delay)` : '';
      if (ratio <= 1.10) return `Live traffic: No significant delays${delayText}`;
      if (ratio <= 1.25) return `Live traffic: Light traffic${delayText}`;
      if (ratio <= 1.50) return `Live traffic: Moderate congestion${delayText}`;
      if (ratio <= 1.80) return `Live traffic: Heavy traffic${delayText}`;
      return `Live traffic: Severe congestion${delayText}`;
    }
    const subtitles = {
      WALKING:   'Based on walking duration',
      BICYCLING: 'Based on journey duration',
      TRANSIT:   'Based on transfers, walking &amp; live service status'
    };
    return subtitles[mode] || 'Based on route complexity';
  }

  _buildReliabilityHTML(score, mode, leg) {
    const cls      = this._reliabilityClass(score);
    const label    = this._reliabilityLabel(score);
    const subtitle = this._reliabilitySubtitle(mode, leg);
    return `
      <div class="reliability-score-wrap">
        <div class="reliability-score-header">
          <span class="reliability-score-title">Journey Reliability</span>
          <span class="reliability-score-value ${cls}">${score}% — ${label}</span>
        </div>
        <div class="reliability-bar-bg">
          <div class="reliability-bar-fill ${cls}" style="width:${score}%"></div>
        </div>
        <div class="reliability-score-sub">${subtitle}</div>
      </div>`;
  }

  // ─── FATIGUE WARNING ─────────────────────────────────────────
  _getFatigueReasons(leg, mode) {
    const reasons = [];
    if (mode === 'WALKING') {
      const mins = (leg.duration?.value || 0) / 60;
      if (mins >= 20) reasons.push(`${Math.round(mins)} min walk`);
    } else if (mode === 'BICYCLING') {
      const mins = (leg.duration?.value || 0) / 60;
      if (mins >= 25) reasons.push(`${Math.round(mins)} min cycle`);
    } else if (mode === 'DRIVING') {
      const normalMins = (leg.duration?.value || 0) / 60;
      if (leg.duration_in_traffic) {
        const trafficMins = leg.duration_in_traffic.value / 60;
        const delayMins   = trafficMins - normalMins;
        if (trafficMins >= 45)  reasons.push(`${Math.round(trafficMins)} min drive in traffic`);
        else if (delayMins >= 15) reasons.push(`${Math.round(delayMins)} min traffic delay`);
      } else if (normalMins >= 60) {
        reasons.push(`${Math.round(normalMins)} min drive`);
      }
    } else {
      let transitCount = 0, walkingMins = 0;
      leg.steps?.forEach(step => {
        if (step.travel_mode === 'TRANSIT') transitCount++;
        if (step.travel_mode === 'WALKING') walkingMins += (step.duration?.value || 0) / 60;
      });
      if (walkingMins >= 15) reasons.push(`${Math.round(walkingMins)} min of walking`);
      if (transitCount >= 2) reasons.push(`${transitCount} transfers`);
    }
    return reasons;
  }

  _buildFatigueWarningHTML(leg, mode) {
    const reasons = this._getFatigueReasons(leg, mode);
    if (!reasons.length) return '';
    return `
      <div class="fatigue-warning">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" width="16" height="16">
          <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
          <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
        </svg>
        <span><strong>This route may be tiring</strong> — ${reasons.join(' and ')}.</span>
      </div>`;
  }

  _buildFatigueChipHTML(leg, mode) {
    const reasons = this._getFatigueReasons(leg, mode);
    if (!reasons.length) return '';
    return `
      <div class="fatigue-warning" style="margin:5px 0 2px;padding:6px 10px;font-size:0.74rem;">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" width="13" height="13">
          <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
          <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
        </svg>
        <span><strong>May be tiring</strong> — ${reasons.join(', ')}</span>
      </div>`;
  }

  // ─── WELLNESS SCORE ──────────────────────────────────────────
  _getWeekKey() {
    const now    = new Date();
    const jan4   = new Date(now.getFullYear(), 0, 4);
    const dayNum = Math.floor((now - jan4) / 86400000) + jan4.getDay() + 1;
    return `${now.getFullYear()}-W${String(Math.ceil(dayNum / 7)).padStart(2, '00')}`;
  }

  _getWeekLabel() {
    const now = new Date();
    const day = now.getDay() || 7;
    const mon = new Date(now); mon.setDate(now.getDate() - day + 1);
    const sun = new Date(mon); sun.setDate(mon.getDate() + 6);
    const fmt = d => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
    return `${fmt(mon)} – ${fmt(sun)}`;
  }

  _loadWellnessData() {
    const user = this.getUser();
    if (!user) return null;
    const key = `urbannav_wellness_${user.user_id}_${this._getWeekKey()}`;
    const raw = localStorage.getItem(key);
    if (raw) { try { return JSON.parse(raw); } catch {} }
    return { journeys: 0, walkingMins: 0, calories: 0, co2Saved: 0, reliabilitySum: 0, stressFreeCount: 0 };
  }

  _saveWellnessData(data) {
    const user = this.getUser();
    if (!user) return;
    localStorage.setItem(`urbannav_wellness_${user.user_id}_${this._getWeekKey()}`, JSON.stringify(data));
  }

  _recordWellnessJourney(leg, mode, reliabilityScore) {
    const user = this.getUser();
    if (!user) return;
    const data = this._loadWellnessData();
    data.journeys++;

    if (mode === 'WALKING') {
      data.walkingMins += Math.round((leg.duration?.value || 0) / 60);
    } else {
      leg.steps?.forEach(step => {
        if (step.travel_mode === 'WALKING') data.walkingMins += Math.round((step.duration?.value || 0) / 60);
      });
    }

    const durationHours = (leg.duration?.value || 0) / 3600;
    const distanceKm    = (leg.distance?.value || 0) / 1000;
    if (mode === 'WALKING')   data.calories += Math.round(3.5 * 70 * durationHours);
    if (mode === 'BICYCLING') data.calories += Math.round(6.8 * 70 * durationHours);

    const emissions = { DRIVING: 0.171, WALKING: 0, BICYCLING: 0, TRANSIT: 0.041 };
    const saved = 0.171 * distanceKm - (emissions[mode] || 0) * distanceKm;
    if (saved > 0) data.co2Saved += saved;

    if (reliabilityScore > 0) data.reliabilitySum += reliabilityScore;
    if (this.preferEasyRoute) data.stressFreeCount++;

    this._saveWellnessData(data);
    this.renderWellnessCard();
  }

  openWellnessSheet() {
    const sheet    = document.getElementById('wellnessSheet');
    const backdrop = document.getElementById('wellnessBackdrop');
    if (!sheet) return;
    this.renderWellnessCard();
    sheet.classList.add('open');
    backdrop.classList.add('open');
    document.body.style.overflow = 'hidden';
  }

  closeWellnessSheet() {
    const sheet    = document.getElementById('wellnessSheet');
    const backdrop = document.getElementById('wellnessBackdrop');
    if (!sheet) return;
    sheet.classList.remove('open');
    backdrop.classList.remove('open');
    document.body.style.overflow = '';
  }

  renderWellnessCard() {
    const user      = this.getUser();
    const sheetWeek = document.getElementById('wellnessSheetWeek');
    if (sheetWeek) sheetWeek.textContent = `Week of ${this._getWeekLabel()}`;
    const grid = document.getElementById('wellnessGrid');
    if (!grid || !user) return;

    const data           = this._loadWellnessData();
    const avgReliability = data.journeys > 0 ? Math.round(data.reliabilitySum / data.journeys) : 0;
    const co2Text        = data.co2Saved >= 1 ? `${data.co2Saved.toFixed(1)} kg` : `${Math.round(data.co2Saved * 1000)} g`;
    const walkHours      = Math.floor(data.walkingMins / 60);
    const walkText       = walkHours > 0 ? `${walkHours}h ${data.walkingMins % 60}m` : `${data.walkingMins} min`;

    grid.innerHTML = `
      <div class="wellness-tile wt-journeys">
        <div class="wellness-tile-icon"><img src="favroute.png" width="18" height="18" style="object-fit:contain"></div>
        <div class="wellness-tile-value">${data.journeys}</div>
        <div class="wellness-tile-label">Journeys this week</div>
      </div>
      <div class="wellness-tile wt-walking">
        <div class="wellness-tile-icon"><img src="walking-icon-0.png" width="18" height="18" style="object-fit:contain"></div>
        <div class="wellness-tile-value">${data.walkingMins > 0 ? walkText : '—'}</div>
        <div class="wellness-tile-label">Total walking time</div>
      </div>
      <div class="wellness-tile wt-calories">
        <div class="wellness-tile-icon"><img src="bike.png" width="18" height="18" style="object-fit:contain"></div>
        <div class="wellness-tile-value">${data.calories > 0 ? data.calories : '—'}</div>
        <div class="wellness-tile-label">Calories burned (kcal)</div>
      </div>
      <div class="wellness-tile wt-co2">
        <div class="wellness-tile-icon"><img src="eco.jpg" width="18" height="18" style="object-fit:contain"></div>
        <div class="wellness-tile-value">${data.journeys > 0 ? co2Text : '—'}</div>
        <div class="wellness-tile-label">CO&#x2082; saved vs driving</div>
      </div>
      <div class="wellness-tile wt-reliability">
        <div class="wellness-tile-icon"><img src="bustrain.png" width="18" height="18" style="object-fit:contain"></div>
        <div class="wellness-tile-value">${avgReliability > 0 ? avgReliability + '%' : '—'}</div>
        <div class="wellness-tile-label">Avg journey reliability</div>
      </div>
      <div class="wellness-tile wt-stress">
        <div class="wellness-tile-icon"><img src="walking-icon-0.png" width="18" height="18" style="object-fit:contain"></div>
        <div class="wellness-tile-value">${data.stressFreeCount}</div>
        <div class="wellness-tile-label">Stress-Free journeys</div>
      </div>`;
  }

  resetWellness() {
    const user = this.getUser();
    if (!user) return;
    localStorage.removeItem(`urbannav_wellness_${user.user_id}_${this._getWeekKey()}`);
    this.renderWellnessCard();
  }

  // ─── MULTI-ROUTE MAP DISPLAY ─────────────────────────────────
  _showAllRoutes(result, selectedIdx) {
    this._clearAltRenderers();
    const routes = result.routes;

    if (this.preferEasyRoute || routes.length <= 1) {
      this.directionsRenderer.setOptions({
        polylineOptions: { strokeColor: '#1A73E8', strokeWeight: 6, strokeOpacity: 1.0 },
        suppressInfoWindows: true
      });
      this.directionsRenderer.setDirections(result);
      this.directionsRenderer.setRouteIndex(selectedIdx);
      return;
    }

    this.directionsRenderer.setOptions({
      polylineOptions: { strokeColor: '#1A73E8', strokeWeight: 6, strokeOpacity: 1.0, zIndex: 10 },
      suppressInfoWindows: true
    });
    this.directionsRenderer.setDirections(result);
    this.directionsRenderer.setRouteIndex(selectedIdx);
    this._addDurationMarker(result, selectedIdx, true, null);

    routes.forEach((route, idx) => {
      if (idx === selectedIdx) return;
      const altRenderer = new google.maps.DirectionsRenderer({
        map: this.map,
        suppressMarkers: true, suppressInfoWindows: true,
        polylineOptions: { strokeColor: '#8AB4F8', strokeWeight: 4, strokeOpacity: 0.8, zIndex: 1 }
      });
      altRenderer.setDirections(result);
      altRenderer.setRouteIndex(idx);
      this.altRenderers.push(altRenderer);
      this._addDurationMarker(result, idx, false, selectedIdx);
    });
  }

  _addDurationMarker(result, routeIdx, isSelected, currentSelectedIdx) {
    const route    = result.routes[routeIdx];
    const leg      = route.legs[0];
    const mode     = this.selectedMode || 'TRANSIT';
    const durSecs  = leg.duration_in_traffic ? leg.duration_in_traffic.value : leg.duration.value;
    const durText  = durSecs < 3600
      ? `${Math.round(durSecs / 60)} min`
      : `${Math.floor(durSecs / 3600)}h ${Math.round((durSecs % 3600) / 60)}m`;
    const distText = leg.distance.text;

    const path      = route.overview_path;
    const fractions = [0.40, 0.62, 0.75, 0.30];
    const fraction  = fractions[routeIdx] ?? 0.50;
    const anchorPt  = path[Math.min(Math.floor(path.length * fraction), path.length - 1)];
    const yOffsets  = [0, -42, -84, 42];
    const yOffset   = yOffsets[routeIdx] ?? 0;

    let iconHTML = '';
    if (mode === 'TRANSIT') {
      const transitSteps = leg.steps?.filter(s => s.travel_mode === 'TRANSIT') || [];
      if (transitSteps.length > 0) {
        const icons = transitSteps.slice(0, 3).map(step => {
          const vt = step.transit?.line?.vehicle?.type || 'BUS';
          const bg = ['HEAVY_RAIL','RAIL','COMMUTER_TRAIN','HIGH_SPEED_TRAIN'].includes(vt) ? '#c0392b' : '#2980b9';
          return `<span style="display:inline-flex;align-items:center;background:${bg};border-radius:3px;padding:2px 4px;margin:0 1px"><img src="bustrain.png" width="10" height="10" style="object-fit:contain;filter:brightness(10)"></span>`;
        });
        iconHTML = `<div style="display:flex;align-items:center;gap:2px;margin-bottom:3px;justify-content:center">
          ${icons.join('<span style="color:#999;font-size:9px;margin:0 1px">&#x276F;</span>')}
        </div>`;
      }
    }

    const div = document.createElement('div');
    div.style.cssText = `
      position:absolute;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
      background:${isSelected ? 'white' : 'rgba(255,255,255,0.93)'};
      border:${isSelected ? '2px solid #1A73E8' : '1.5px solid #ccc'};
      border-radius:8px;padding:${mode === 'TRANSIT' ? '6px 11px' : '5px 10px'};
      box-shadow:0 2px 10px rgba(0,0,0,${isSelected ? '0.28' : '0.14'});
      white-space:nowrap;cursor:${isSelected ? 'default' : 'pointer'};
      transform:translate(-50%,-50%);line-height:1.3;text-align:center;
      pointer-events:all;z-index:${isSelected ? 20 : 10};
      min-width:${mode === 'TRANSIT' ? '90px' : '80px'};`;
    div.innerHTML = `
      ${iconHTML}
      <div style="font-size:${isSelected ? '14px' : '12px'};font-weight:${isSelected ? '800' : '600'};color:${isSelected ? '#1A73E8' : '#333'}">${durText}</div>
      <div style="font-size:10px;font-weight:400;color:#888;margin-top:1px">${distText}</div>`;

    const overlay = new google.maps.OverlayView();
    overlay.onAdd    = function() { this.getPanes().floatPane.appendChild(div); };
    overlay.draw     = function() {
      const proj = this.getProjection();
      if (!proj) return;
      const pos = proj.fromLatLngToDivPixel(anchorPt);
      if (!pos) return;
      div.style.left = pos.x + 'px';
      div.style.top  = (pos.y + yOffset) + 'px';
    };
    overlay.onRemove = function() { if (div.parentNode) div.parentNode.removeChild(div); };
    overlay.setMap(this.map);

    if (!isSelected) {
      div.addEventListener('click', (e) => { e.stopPropagation(); this._selectRouteByIndex(result, routeIdx); });
    }
    this.altRenderers.push({ setMap: (m) => { overlay.setMap(m); } });
  }

  _selectRouteByIndex(result, idx) {
    document.querySelectorAll('.mm-option-card').forEach((c, i) => c.classList.toggle('mm-selected', i === idx));
    this._showAllRoutes(result, idx);
    const bounds = result.routes[idx].bounds;
    if (bounds) this.map.fitBounds(bounds, { top:60, right:40, bottom:40, left:40 });
  }

  _clearAltRenderers() {
    this.altRenderers.forEach(r => { if (r?.setMap) r.setMap(null); });
    this.altRenderers = [];
    this.directionsRenderer.setOptions({
      polylineOptions: { strokeColor: '#1A73E8', strokeWeight: 6, strokeOpacity: 1.0 }
    });
  }

  // ─── AI FEATURES ─────────────────────────────────────────────

  // Builds a plain-text summary of the current route for use as AI context
  _buildRouteContext() {
    if (!this.currentRoute || !this.selectedMode) return null;
    const route = this.currentRoute.routes[0];
    const leg   = route.legs[0];
    const mode  = this.selectedMode;
    const from  = document.getElementById('fromInput').value;
    const to    = document.getElementById('toInput').value;

    const durMins  = Math.round((leg.duration?.value || 0) / 60);
    const distKm   = ((leg.distance?.value || 0) / 1000).toFixed(1);
    const relScore = this._calcReliabilityScore(leg, mode, null);

    const emissions = { DRIVING: 0.171, WALKING: 0, BICYCLING: 0, TRANSIT: 0.041 };
    const co2Saved  = ((emissions.DRIVING - (emissions[mode] || 0)) * distKm / 1000).toFixed(2);

    let transitDetails = '';
    if (mode === 'TRANSIT') {
      const dep = leg.departure_time ? leg.departure_time.text : '';
      const arr = leg.arrival_time   ? leg.arrival_time.text   : '';
      let transfers = 0, walkMins = 0, operators = [];
      leg.steps?.forEach(s => {
        if (s.travel_mode === 'TRANSIT') {
          transfers++;
          if (s.transit?.line?.agencies?.[0]?.name) operators.push(s.transit.line.agencies[0].name);
        }
        if (s.travel_mode === 'WALKING') walkMins += Math.round((s.duration?.value || 0) / 60);
      });
      transitDetails = `Departure: ${dep || 'now'}. Arrival: ${arr || 'n/a'}. Transfers: ${transfers}. Walking: ${walkMins} min. Operators: ${[...new Set(operators)].join(', ') || 'n/a'}.`;
    }

    const fatigueReasons = this._getFatigueReasons(leg, mode);

    return {
      from, to, mode, durMins, distKm, relScore, co2Saved,
      transitDetails, fatigueReasons, leg,
      stressFreeOn: this.preferEasyRoute
    };
  }

  // ── Toggle handler — show/hide insight box ───────────────────
  toggleAiBox(boxId, btnId, label, btnEl) {
    const box = document.getElementById(boxId);
    if (!box) return;
    const isOpen = !box.classList.contains('ai-box-hidden');

    if (isOpen) {
      box.classList.add('ai-box-hidden');
      box.innerHTML = '';
      btnEl.classList.remove('ai-btn-active');
      const span = btnEl.querySelector('span');
      if (span) span.textContent = label;
    } else {
      ['aiSummaryBtn','aiCompareBtn','aiWeatherBtn'].forEach(id => {
        if (id === btnId) return;
        const other = document.getElementById(id);
        if (!other) return;
        const otherBoxId = id === 'aiWeatherBtn' ? 'aiWeatherBox' : 'aiSummaryBox';
        const otherBox   = document.getElementById(otherBoxId);
        if (otherBox && !otherBox.classList.contains('ai-box-hidden')) {
          otherBox.classList.add('ai-box-hidden');
          otherBox.innerHTML = '';
          other.classList.remove('ai-btn-active');
          const s = other.querySelector('span');
          if (s && other.dataset.label) s.textContent = other.dataset.label;
        }
      });
      if (boxId === 'aiSummaryBox') box.innerHTML = '';
      box.classList.remove('ai-box-hidden');
      btnEl.classList.add('ai-btn-active');
      btnEl.dataset.label = label;
      const span = btnEl.querySelector('span');
      if (span) span.textContent = 'Hide';
      if (btnId === 'aiSummaryBtn') this.aiSummariseRoute(box);
      if (btnId === 'aiCompareBtn') this.aiCompareRoutes(box);
      if (btnId === 'aiWeatherBtn') this.aiWeatherAdvisor(box);
    }
  }

  // ── Feature 1: Journey Summariser ────────────────────────────
  aiSummariseRoute(box) {
    box = box || document.getElementById('aiSummaryBox');
    if (!box) return;
    const ctx = this._buildRouteContext();
    if (!ctx) { box.innerHTML = `<div class="ai-response-box"><p class="ai-error">Please calculate a route first.</p></div>`; return; }
    const text = this._generateJourneySummary(ctx);
    box.innerHTML = `
      <div class="ai-response-box">
        <div class="ai-response-header">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" width="14" height="14">
            <path d="M12 2a10 10 0 1 0 10 10"/><path d="M12 8v4l3 3"/><circle cx="19" cy="5" r="3" fill="currentColor" stroke="none"/>
          </svg>
          Journey Summary
        </div>
        <p class="ai-response-text">${text}</p>
      </div>`;
  }

  // ── Feature 2: Route Comparison ──────────────────────────────
  aiCompareRoutes(box) {
    box = box || document.getElementById('aiSummaryBox');
    if (!box) return;
    const routes = this.currentRoute?.routes;
    if (!routes?.length) { box.innerHTML = `<div class="ai-response-box"><p class="ai-error">Please calculate a route first.</p></div>`; return; }
    const text = this._generateRouteComparison(routes);
    box.innerHTML = `
      <div class="ai-response-box">
        <div class="ai-response-header">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" width="14" height="14">
            <line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/>
          </svg>
          Route Comparison
        </div>
        <p class="ai-response-text">${text}</p>
      </div>`;
  }

  _generateJourneySummary(ctx) {
    const from = ctx.from.split(',')[0];
    const to   = ctx.to.split(',')[0];
    const modeLabels = { WALKING: 'on foot', BICYCLING: 'by bike', DRIVING: 'by car', TRANSIT: 'by public transport' };
    const modeLabel  = modeLabels[ctx.mode] || 'via your chosen mode';
    const durText    = ctx.durMins < 60
      ? `${ctx.durMins} minutes`
      : `${Math.floor(ctx.durMins/60)} hour${Math.floor(ctx.durMins/60)>1?'s':''}${ctx.durMins%60>0?` ${ctx.durMins%60} minutes`:''}`;

    let summary = `Your journey from ${from} to ${to} ${modeLabel} will take approximately ${durText} covering ${ctx.distKm} km.`;

    if (ctx.mode === 'TRANSIT' && ctx.leg) {
      const leg = ctx.leg;
      const dep = leg.departure_time ? leg.departure_time.text : '';
      const arr = leg.arrival_time   ? leg.arrival_time.text   : '';
      let transfers = 0, operators = [], walkMins = 0;
      leg.steps?.forEach(s => {
        if (s.travel_mode === 'TRANSIT') { transfers++; const op = s.transit?.line?.agencies?.[0]?.name; if (op) operators.push(op); }
        if (s.travel_mode === 'WALKING') walkMins += Math.round((s.duration?.value||0)/60);
      });
      const opStr    = [...new Set(operators)].slice(0,2).join(' and ');
      const depStr   = dep ? ` departing at ${dep}${arr ? ` and arriving at ${arr}`:''}`:'';
      const transStr = transfers <= 1 ? 'a direct service' : `${transfers} connections`;
      const walkStr  = walkMins > 0 ? ` with about ${walkMins} minutes of walking` : '';
      if (opStr) summary += ` This is ${transStr} operated by ${opStr}${depStr}${walkStr}.`;
      else       summary += ` This route involves ${transStr}${depStr}${walkStr}.`;
    }

    if (ctx.relScore >= 70)      summary += ` With a reliability score of ${ctx.relScore}%, this is a dependable choice for your commute.`;
    else if (ctx.relScore >= 40) summary += ` The reliability score of ${ctx.relScore}% suggests moderate disruption risk — allow a little extra time.`;
    else                         summary += ` The reliability score of ${ctx.relScore}% indicates elevated disruption risk on this route today.`;

    const co2kg = parseFloat(ctx.co2Saved);
    if (ctx.mode !== 'DRIVING' && co2kg > 0) summary += ` Choosing this over driving saves approximately ${co2kg.toFixed(2)} kg of CO2.`;
    if (ctx.stressFreeOn) summary += ` Commuter Stress-Free Mode is active - this route was selected for minimum transfers and walking.`;
    if (ctx.fatigueReasons.length > 0) summary += ` Note: ${ctx.fatigueReasons.join(' and ')} - plan accordingly.`;
    return summary;
  }

  _generateRouteComparison(routes) {
    if (routes.length === 1) {
      const leg     = routes[0].legs[0];
      const durMins = Math.round(routes[0].legs.reduce((s,l)=>s+l.duration.value,0)/60);
      const rel     = this._calcReliabilityScore(leg,'TRANSIT',null);
      return 'Only one route option is available for this journey, taking ' + durMins + ' minutes with a reliability score of ' + rel + '%. ' + (rel>=70?'This is a solid choice.':'Allow extra time in case of delays.');
    }
    const stats = routes.slice(0,3).map((route,idx) => {
      const leg     = route.legs[0];
      const durMins = Math.round(route.legs.reduce((s,l)=>s+l.duration.value,0)/60);
      const rel     = this._calcReliabilityScore(leg,'TRANSIT',null);
      const dep     = (leg.departure_time && leg.departure_time.text) || '';
      const arr     = (leg.arrival_time   && leg.arrival_time.text)   || '';
      let transfers=0,walkMins=0,operators=[];
      (leg.steps||[]).forEach(s=>{
        if(s.travel_mode==='TRANSIT'){transfers++;const op=s.transit&&s.transit.line&&s.transit.line.agencies&&s.transit.line.agencies[0]?s.transit.line.agencies[0].name:null;if(op)operators.push(op);}
        if(s.travel_mode==='WALKING')walkMins+=Math.round(((s.duration&&s.duration.value)||0)/60);
      });
      return {idx,durMins,rel,dep,arr,transfers,walkMins,operators:[...new Set(operators)]};
    });
    const fastest   = stats.reduce((a,b)=>a.durMins<=b.durMins?a:b);
    const mostRel   = stats.reduce((a,b)=>a.rel>=b.rel?a:b);
    const leastWalk = stats.reduce((a,b)=>a.walkMins<=b.walkMins?a:b);
    const names     = ['Option 1','Option 2','Option 3'];
    let text = '';
    stats.forEach(s=>{
      const timeRange = s.dep&&s.arr?' ('+s.dep+'-'+s.arr+')':'';
      const opStr = s.operators.slice(0,2).join('/')||'public transport';
      text += names[s.idx]+' takes '+s.durMins+' minutes'+timeRange+' via '+opStr+', with '+s.transfers+' transfer'+(s.transfers!==1?'s':'')+' and '+s.walkMins+' min walking - reliability '+s.rel+'%. ';
    });
    const best = fastest.rel>=60?fastest:mostRel;
    text += 'For most commuters, '+names[best.idx]+' is the best choice';
    if(fastest.idx===mostRel.idx)      text+=' - it is both the fastest and most reliable option.';
    else if(best.idx===fastest.idx)    text+=', being the fastest at '+best.durMins+' minutes.';
    else text+=', offering the highest reliability ('+best.rel+'%) even if it takes '+(best.durMins-fastest.durMins)+' minutes longer.';
    if(leastWalk.walkMins<stats[0].walkMins&&leastWalk.idx!==best.idx)
      text+=' If you prefer minimal walking, '+names[leastWalk.idx]+' keeps it to just '+leastWalk.walkMins+' minutes on foot.';
    return text;
  }

  // ── Feature 3: Weather-Journey Advisor ───────────────────────
  aiWeatherAdvisor(box) {
    box = box || document.getElementById('aiWeatherBox');
    if (!box) return;
    const weather = this._lastWeatherData;
    if (!weather) { box.innerHTML = `<div class="ai-response-box"><p class="ai-error">Weather data not loaded yet. Open the Weather section first.</p></div>`; return; }
    const text = this._generateWeatherAdvice(weather);
    box.innerHTML = `
      <div class="ai-response-box">
        <div class="ai-response-header">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" width="14" height="14">
            <path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9z"/>
          </svg>
          Weather Travel Advice
        </div>
        <p class="ai-response-text">${text}</p>
      </div>`;
  }

  _generateWeatherAdvice(w) {
    const ctx     = this._buildRouteContext();
    const mode    = ctx?.mode || this.selectedMode || 'TRANSIT';
    const durMins = ctx?.durMins || 0;
    const to      = (document.getElementById('toInput').value || '').split(',')[0];

    const isRaining  = w.rain > 0 || /rain|drizzle|shower/i.test(w.description);
    const isWindy    = w.windSpeed !== null && w.windSpeed > 30;
    const isHot      = w.temp > 27;
    const isCold     = w.temp < 4;
    const isMild     = w.temp >= 10 && w.temp <= 22 && !isRaining && !isWindy;
    const isFreezing = w.temp <= 0;

    let advice = `Current conditions near ${to || 'your destination'}: ${w.temp}°C, ${w.description}${w.windSpeed ? `, ${w.windSpeed} km/h winds` : ''}.`;

    if (mode === 'BICYCLING') {
      if (isFreezing) advice += ` Cycling is not recommended — icy roads make it hazardous. Consider public transport or driving instead.`;
      else if (isRaining && isWindy) advice += ` Cycling in rain and ${w.windSpeed} km/h winds for ${durMins} minutes will be tough going. Transit would be more comfortable today.`;
      else if (isRaining) advice += ` It's wet out — take a waterproof if you're cycling. An alternative is public transport to stay dry.`;
      else if (isWindy)  advice += ` Winds of ${w.windSpeed} km/h may slow your ${durMins}-minute ride. Factor in extra time and watch for gusts on exposed routes.`;
      else if (isMild)   advice += ` These are great cycling conditions — mild and dry. Enjoy the ride!`;
      else if (isHot)    advice += ` At ${w.temp}°C, carry plenty of water for your ${durMins}-minute ride and consider cycling early to avoid the heat.`;
    } else if (mode === 'WALKING') {
      if (isFreezing) advice += ` Walking in sub-zero temperatures — wrap up warm and watch for ice underfoot, especially in shaded areas.`;
      else if (isRaining && durMins > 15) advice += ` A ${durMins}-minute walk in the rain — take an umbrella or a waterproof jacket. Transit might be a more comfortable option.`;
      else if (isRaining) advice += ` Light rain expected — a quick walk of ${durMins} minutes should be fine with an umbrella.`;
      else if (isWindy)  advice += ` Gusts of ${w.windSpeed} km/h — secure loose items and expect the wind to slow you slightly.`;
      else if (isMild)   advice += ` Perfect walking weather. The ${durMins}-minute walk should be pleasant.`;
      else if (isHot)    advice += ` At ${w.temp}°C, stay hydrated and wear sun protection for your ${durMins}-minute walk.`;
    } else if (mode === 'DRIVING') {
      if (isFreezing) advice += ` Freezing temperatures — allow extra time to defrost the car and drive cautiously on potentially icy roads.`;
      else if (isRaining && isWindy) advice += ` Rain and strong winds — reduce speed on exposed roads and increase following distance.`;
      else if (isRaining) advice += ` Wet roads — maintain extra following distance and watch for spray from other vehicles.`;
      else if (isWindy)  advice += ` High winds of ${w.windSpeed} km/h — take care on motorways and bridges where gusts can affect steering.`;
      else               advice += ` Driving conditions look reasonable. Standard caution applies.`;
    } else {
      // TRANSIT / Best
      if (isFreezing) advice += ` Sub-zero temperatures may cause brief walking sections to be slippery — wear sturdy footwear and give yourself extra time at stations.`;
      else if (isRaining && durMins > 0) advice += ` Some walking is involved — take an umbrella for transfers between stops. Public transport keeps you sheltered for most of the journey.`;
      else if (isWindy)  advice += ` Strong winds of ${w.windSpeed} km/h — outdoor waiting areas may be exposed. Check for service disruptions that sometimes accompany severe weather.`;
      else if (isMild)   advice += ` Good travel conditions. Your public transport journey should run smoothly.`;
      else if (isHot)    advice += ` At ${w.temp}°C, stations and trains may be warm. Carry water for your journey.`;
      else if (isCold)   advice += ` Cold weather today — dress warmly for the walking sections of your journey.`;
      else               advice += ` Conditions look fine for your journey. No weather-related concerns.`;
    }

    return advice;
  }

  // ─── FR13: LIVE DELAY NOTIFICATIONS ─────────────────────────
  // Checks TransportAPI departure data for delays and shows a
  // notification bell in the nav bar when delays are detected.
  // Called after loadLiveTransport() runs.

  checkForDelays() {
    if (!this.trainPlatformCache) return;

    const delays = [];
    const toMins = t => { const [h,m] = t.split(':'); return parseInt(h)*60+parseInt(m); };

    Object.entries(this.trainPlatformCache).forEach(([station, deps]) => {
      deps.forEach(dep => {
        const isCancelled = dep.cancelled || false;
        const hasDelay    = dep.aimed && dep.expected &&
                            toMins(dep.expected) - toMins(dep.aimed) >= 3;

        if (!isCancelled && !hasDelay) return;

        const delayMins = hasDelay
          ? toMins(dep.expected) - toMins(dep.aimed)
          : 0;

        delays.push({
          station:     station.replace(/\b\w/g, c => c.toUpperCase()),
          destination: dep.destination ? dep.destination.replace(/\b\w/g, c => c.toUpperCase()) : 'Unknown',
          aimed:       dep.aimed,
          expected:    dep.expected,
          delayMins,
          platform:    dep.platform,
          cancelled:   isCancelled,
          reason:      dep.running_late_reason || ''
        });
      });
    });

    if (this._lastBusDelays) delays.push(...this._lastBusDelays);

    const bellWrap = document.getElementById('delayBellWrap');
    const badge    = document.getElementById('delayBellBadge');
    const content  = document.getElementById('delayPanelContent');
    if (!bellWrap) return;

    if (delays.length === 0) {
      bellWrap.style.display = 'none';
      if (content) content.innerHTML = '<p class="delay-panel-empty">No delays or cancellations detected on your route.</p>';
      return;
    }

    bellWrap.style.display = 'inline-flex';
    if (badge) { badge.style.display = 'flex'; badge.textContent = delays.length; }

    const btn = document.getElementById('delayBellBtn');
    if (btn) {
      btn.classList.add('delay-bell-pulse');
      setTimeout(() => btn.classList.remove('delay-bell-pulse'), 3000);
    }

    if (content) {
      content.innerHTML = delays.map(d => {
        // Status pill — red for cancelled, amber for delayed
        const pillStyle  = d.cancelled
          ? 'background:#dc2626'
          : 'background:#d97706';
        const pillText   = d.cancelled ? 'Cancelled' : `${d.delayMins} min late`;

        // Reason row — shown when TransportAPI provides a reason
        const reasonHTML = d.reason
          ? `<div class="delay-item-reason">
               <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" width="11" height="11">
                 <circle cx="12" cy="12" r="10"/>
                 <line x1="12" y1="8" x2="12" y2="12"/>
                 <line x1="12" y1="16" x2="12.01" y2="16"/>
               </svg>
               ${d.reason}
             </div>`
          : '';

        const timingHTML = d.cancelled
          ? `Scheduled <strong>${d.aimed}</strong> — service will not run`
          : `Scheduled <strong>${d.aimed}</strong>, now expected <strong>${d.expected}</strong>`;

        return `
          <div class="delay-item${d.cancelled ? ' delay-item-cancelled' : ''}">
            <div class="delay-item-header">
              <svg viewBox="0 0 24 24" fill="none" stroke="${d.cancelled ? '#dc2626' : '#d97706'}" stroke-width="2" stroke-linecap="round" width="13" height="13">
                <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
              </svg>
              <span class="delay-item-station">${d.station}</span>
              <span class="delay-badge-pill" style="${pillStyle};color:white;font-size:10px;font-weight:700;padding:2px 7px;border-radius:10px;white-space:nowrap">${pillText}</span>
            </div>
            <div class="delay-item-body">
              Service to <strong>${d.destination}</strong>
              ${d.platform ? `· Platform <strong>${d.platform}</strong>` : ''}
              <br>${timingHTML}
            </div>
            ${reasonHTML}
            <div class="delay-item-tip">${d.cancelled ? 'Check for alternative services.' : 'Allow extra time for your connection.'}</div>
          </div>`;
      }).join('');
    }

    this._showDelayPopup(delays[0]);
  }

  // Shows a small toast-style popup for the most critical delay
  _showDelayPopup(delay) {
    const existing = document.getElementById('delayPopup');
    if (existing) existing.remove();

    const isCancelled = delay.cancelled;
    const titleText   = isCancelled ? 'Service Cancelled' : 'Service Delay Detected';
    const bodyText    = isCancelled
      ? `${delay.station} → ${delay.destination}: Cancelled (sched. ${delay.aimed})`
      : `${delay.station} → ${delay.destination}: ${delay.delayMins} min late (exp. ${delay.expected})`;
    const accentColor = isCancelled ? '#dc2626' : '#d97706';

    const popup = document.createElement('div');
    popup.id = 'delayPopup';
    popup.className = 'delay-popup';
    popup.innerHTML = `
      <div class="delay-popup-inner" style="border-left-color:${accentColor}">
        <div class="delay-popup-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="${accentColor === '#dc2626' ? '#fca5a5' : '#fde68a'}" stroke-width="2.5" stroke-linecap="round" width="16" height="16">
            <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
            <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
          </svg>
        </div>
        <div class="delay-popup-text">
          <div class="delay-popup-title" style="color:${isCancelled ? '#fca5a5' : '#fde68a'}">${titleText}</div>
          <div class="delay-popup-body">${bodyText}</div>
          ${delay.reason ? `<div class="delay-popup-reason">${delay.reason}</div>` : ''}
        </div>
        <button class="delay-popup-close" onclick="this.parentElement.parentElement.remove()">&#x2715;</button>
      </div>`;

    document.body.appendChild(popup);
    setTimeout(() => { if (popup.parentNode) popup.remove(); }, 8000);
  }

  toggleDelayPanel() {
    const panel    = document.getElementById('delayPanel');
    const backdrop = document.getElementById('delayPanelBackdrop');
    if (!panel) return;
    const isOpen = panel.style.display !== 'none';
    panel.style.display    = isOpen ? 'none' : 'block';
    backdrop.style.display = isOpen ? 'none' : 'block';

    // Clear the badge when panel is opened
    if (!isOpen) {
      const badge = document.getElementById('delayBellBadge');
      if (badge) badge.style.display = 'none';
    }
  }

  // ─── UI HELPERS ──────────────────────────────────────────────
  showLoading(elementId, message) {
    document.getElementById(elementId).innerHTML = `
      <div class="loading-row">
        <div class="spinner"></div>
        <span class="loading-text">${message}</span>
      </div>`;
  }

  showError(elementId, message) {
    document.getElementById(elementId).innerHTML = `
      <div class="alert-error">
        <p class="title">Error</p>
        <p class="body">${message}</p>
      </div>`;
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => { window.app = new UrbanNavApp(); });
} else {
  window.app = new UrbanNavApp();
}