//handles map, routing, weather, and live transport data

class UrbanNavApp {
  constructor() {
    this.map = null;
    this.directionsService = null;
    this.directionsRenderer = null;
    this.destinationLatLng = null;
    this.currentRoute = null;
    this.selectedMode = null;
    
    // Wait for Google Maps to load before initializing
    this.waitForGoogleMaps();
  }
//wait for Google Maps API to load
  waitForGoogleMaps() {
    if (typeof google !== 'undefined' && google.maps) {
      this.initMap();
      this.initEventListeners();
    } else {
      //retry after google maps becomes available
      setTimeout(() => this.waitForGoogleMaps(), 100);
    }
  }
  //initialize the map
  initMap() {
    this.map = new google.maps.Map(document.getElementById('map'), {
      center: CONFIG.DEFAULT_CENTER,
      zoom: 12,
      //hide points of interest for cleaner look
      styles: [
        {
          featureType: "poi",
          elementType: "labels",
          stylers: [{ visibility: "off" }]
        }
      ]
    });
    //google directions API service and renderer
    this.directionsService = new google.maps.DirectionsService();
    this.directionsRenderer = new google.maps.DirectionsRenderer({
      map: this.map,
      suppressMarkers: false
    });

    // Traffic layer — shown only when DRIVING mode is selected
    this.trafficLayer = new google.maps.TrafficLayer();

    // Initialize autocomplete
    new google.maps.places.Autocomplete(document.getElementById('fromInput'));
    new google.maps.places.Autocomplete(document.getElementById('toInput'));
  }

  initEventListeners() {
    document.getElementById('findRouteBtn').addEventListener('click', () => this.findRoute());
    
    // allow pressing enter to search
    ['fromInput', 'toInput'].forEach(id => {
      document.getElementById(id).addEventListener('keypress', (e) => {
        if (e.key === 'Enter') this.findRoute();
      });
    });

    // Show/hide "Now" clear button when time is changed
    const timeInput   = document.getElementById('departureTime');
    const clearTimeBtn = document.getElementById('clearTimeBtn');
    if (timeInput && clearTimeBtn) {
      timeInput.addEventListener('change', () => {
        clearTimeBtn.style.display = timeInput.value ? 'inline-flex' : 'none';
      });
      clearTimeBtn.addEventListener('click', () => {
        timeInput.value = '';
        clearTimeBtn.style.display = 'none';
      });
    }

    // Load saved favourites on init
    this.initFavouritesOnLoad();
  }

  toggleSidebar() { //sidebar toggle for mobile
    document.getElementById('sidebar').classList.toggle('hidden-mobile');
  }

    //find route based on user input
  async findRoute() { 
    const from = document.getElementById('fromInput').value;
    const to = document.getElementById('toInput').value;
    //input validation
    if (!from || !to) {
      this.showError('routeInfo', 'Please enter both start and destination');
      return;
    }

    this.showLoading('routeInfo', 'Finding your destination...');

    try {
      const geocoder = new google.maps.Geocoder();

      // Geocode both start and destination simultaneously
      const [fromResult, toResult] = await Promise.all([
        this.geocodeAddress(geocoder, from),
        this.geocodeAddress(geocoder, to)
      ]);

      this.destinationLatLng = toResult.geometry.location;

      // Fit map to show both start and end markers
      const bounds = new google.maps.LatLngBounds();
      bounds.extend(fromResult.geometry.location);
      bounds.extend(toResult.geometry.location);
      this.map.fitBounds(bounds, { top: 60, right: 40, bottom: 40, left: 40 });
      
      // Show transport modes
      document.getElementById('transportModes').style.display = 'block';
      document.getElementById('routeDetails').style.display = 'block';
      document.getElementById('alertsSection').style.display = 'block';

      document.getElementById('routeInfo').innerHTML = `
        <div class="dest-found">
          <p>Destination found!</p>
          <p class="sub">Select a transport mode to see route details</p>
        </div>
      `;

      // Load weather FIRST, then notify — so data is ready when section appears
      await this.loadWeather();
      if (window._onWeatherReady) window._onWeatherReady();

      // Auto-select the Best (multimodal) option immediately
      const bestBtn = document.getElementById('bestModeBtn');
      await this.selectBestMode(bestBtn);
      
    } catch (error) {
      this.showError('routeInfo', error.message);
    }
  }

  async selectMode(mode) {
    this.selectedMode = mode;
    
  
    document.querySelectorAll('.mode-btn').forEach(btn => {
      btn.classList.remove('active');
    });
    event.target.classList.add('active');

    this.showLoading('routeInfo', 'Calculating route...');

    try {
      const from = document.getElementById('fromInput').value;
      const to = document.getElementById('toInput').value;

      const result = await this.calculateRoute(from, to, mode);
      this.currentRoute = result;

      // Store all alternatives for FR10/FR11 badge analysis
      this.allRoutes = result.routes;
      
      this.directionsRenderer.setDirections(result);

      // Fit map tightly to the full route polyline
      const routeBounds = result.routes[0].bounds;
      if (routeBounds) {
        this.map.fitBounds(routeBounds, { top: 60, right: 40, bottom: 40, left: 40 });
      }

      // Show traffic layer for driving, hide for all other modes
      if (this.trafficLayer) {
        this.trafficLayer.setMap(mode === 'DRIVING' ? this.map : null);
      }

      // Pass index 0 — Google's primary recommended route
      this.displayRouteDetails(result, mode, 0);

      // Display eco data, THEN notify so button/section appears with data ready
      this.displayEnvironmentalImpact(result, mode);
      if (window._onEcoReady) window._onEcoReady();

      // Load transport departures using the chosen departure time
      document.getElementById('alertsSection').style.display = 'block';
      await this.loadLiveTransport();
      
    } catch (error) {
      this.showError('routeInfo', error.message);
    }
  }

  displayRouteDetails(result, mode, routeIndex = 0) {
    const leg = result.routes[routeIndex].legs[0];
    const icons = {
      WALKING:   document.getElementById('icon-walking').outerHTML,
      BICYCLING: document.getElementById('icon-cycling').outerHTML,
      DRIVING:   document.getElementById('icon-driving').outerHTML,
      TRANSIT:   document.getElementById('icon-transit').outerHTML
    };

    // FR10 & FR11 — analyse all alternatives and badge this route if recommended
    const badges = this._getRouteBadges(result.routes, routeIndex);

    //generate step by step directions 
    let stepsHTML = leg.steps.map((step, i) => `
      <div class="step-item">
        <div class="step-number">${i + 1}</div>
        <div class="step-body">
          <div class="step-text">${step.instructions}</div>
          <div class="step-meta">${step.distance.text} · ${step.duration.text}</div>
        </div>
      </div>
    `).join('');

    //update route info section
    document.getElementById('routeInfo').innerHTML = `
      <div class="route-summary-card">
        <div class="route-mode-icon">${icons[mode]}</div>
        <div>
          <div class="route-time">${leg.duration.text}</div>
          <div class="route-distance">${leg.distance.text}</div>
        </div>
      </div>
      ${badges ? `<div class="route-badges-row">${badges}</div>` : ''}

      <div>
        <p class="steps-heading">Step-by-step directions</p>
        <div class="steps-list">
          ${stepsHTML}
        </div>
      </div>
    `;
  }
  //calculate and show environmental impact
  displayEnvironmentalImpact(result, mode) {
    const leg      = result.routes[0].legs[0];
    const distance = leg.distance.value / 1000; // km
    const durationMins = leg.duration.value / 60; // minutes

    const emissions = {
      DRIVING:   0.171,
      WALKING:   0,
      BICYCLING: 0,
      TRANSIT:   0.041
    };

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

    // ── FR14: Calories burned for walking ──────────────────────
    // MET (Metabolic Equivalent of Task) for brisk walking = 3.5
    // Formula: Calories = MET x weight(kg) x duration(hours)
    // Using 70 kg as a standard reference weight (NHS average adult)
    // ── FR15: Calories burned for cycling ──────────────────────
    // MET for moderate cycling = 6.8
    let calorieHTML = '';
    if (mode === 'WALKING' || mode === 'BICYCLING') {
      const MET        = mode === 'WALKING' ? 3.5 : 6.8;
      const weightKg   = 70; // standard reference adult weight
      const hours      = durationMins / 60;
      const calories   = Math.round(MET * weightKg * hours);

      const activityLabel = mode === 'WALKING' ? 'walking' : 'cycling';
      const pace          = mode === 'WALKING'
        ? `${(distance / hours).toFixed(1)} km/h average pace`
        : `${(distance / hours).toFixed(1)} km/h average speed`;

      calorieHTML = `
        <div class="calorie-card">
          <div class="calorie-header">Estimated Calories Burned</div>
          <div class="calorie-value">${calories} <span class="calorie-unit">kcal</span></div>
          <div class="calorie-meta">
            Based on ${durationMins.toFixed(0)} min of ${activityLabel}
            &nbsp;&middot;&nbsp; ${pace}
          </div>
          <div class="calorie-note">
            Estimate uses a 70 kg reference weight (MET ${MET}).
            Your actual burn will vary with body weight and effort.
          </div>
        </div>`;
    }

    document.getElementById('environmentInfo').innerHTML = `
      <div class="${mode === 'DRIVING' ? 'env-card-red' : 'env-card-green'}">
        <div>${message}</div>
      </div>
      ${calorieHTML}
    `;
  }
//openweathermap API to load weather data
  async loadWeather() {
    if (!this.destinationLatLng) return;

    this.showLoading('weatherInfo', 'Loading weather...');

    try {
      const lat = this.destinationLatLng.lat();
      const lon = this.destinationLatLng.lng();
      const url = `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&units=metric&appid=${CONFIG.WEATHER_KEY}`;
      
      const response = await fetch(url);
      const data = await response.json();

      document.getElementById('weatherInfo').innerHTML = `
        <div class="weather-card">
          <div class="weather-main">
            <div>
              <div class="weather-temp">${Math.round(data.main.temp)}°C</div>
              <div class="weather-desc">${data.weather[0].description}</div>
            </div>
            <div class="weather-emoji">
              ${this.getWeatherEmoji(data.weather[0].main, data.weather[0].icon)}
            </div>
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
      `;
    } catch (error) {
      this.showError('weatherInfo', 'Could not load weather data');
    }
  }

  async loadLiveTransport() {
    if (!this.destinationLatLng) {
      this.showError('liveTransportInfo', 'Please select a destination first');
      return;
    }

    this.showLoading('liveTransportInfo', 'Loading transport data...');

    try {
      const lat = this.destinationLatLng.lat();
      const lon = this.destinationLatLng.lng();

      // Get chosen departure time from the input
      const timeInput  = document.getElementById('departureTime');
      const chosenTime = timeInput ? timeInput.value : '';   // e.g. "14:30" or ""

      const [trainData, busData] = await Promise.all([
        this.loadTrainDepartures(lat, lon, chosenTime),
        this.loadBusDepartures(lat, lon, chosenTime)
      ]);

      document.getElementById('liveTransportInfo').innerHTML = trainData + busData;
    } catch (error) {
      this.showError('liveTransportInfo', error.message);
    }
  }

  async loadTrainDepartures(lat, lon, chosenTime = '') {
  try {
    const stationsUrl = `https://transportapi.com/v3/uk/places.json?lat=${lat}&lon=${lon}&type=train_station&app_id=${CONFIG.TRANSPORT_APP_ID}&app_key=${CONFIG.TRANSPORT_APP_KEY}`;
    const stationsResp = await fetch(stationsUrl);
    const stationsData = await stationsResp.json();

    if (!stationsData.member || stationsData.member.length === 0) {
      return '<div class="transport-no-data" style="padding:12px;background:#f9fafb;border-radius:8px;">No nearby train stations found</div>';
    }

    const station = stationsData.member[0];
    // Use timetable endpoint for future times, live for current time
    const queryDate = this._resolveQueryDate(chosenTime);
    let liveUrl;
    if (queryDate.isFuture) {
      liveUrl = `https://transportapi.com/v3/uk/train/station/${station.station_code}/${queryDate.date}/${queryDate.time}/timetable.json?app_id=${CONFIG.TRANSPORT_APP_ID}&app_key=${CONFIG.TRANSPORT_APP_KEY}&train_status=passenger`;
    } else {
      liveUrl = `https://transportapi.com/v3/uk/train/station/${station.station_code}/live.json?app_id=${CONFIG.TRANSPORT_APP_ID}&app_key=${CONFIG.TRANSPORT_APP_KEY}`;
    }
    const liveResp = await fetch(liveUrl);
    const liveData = await liveResp.json();

    // ── Cache raw departures so the journey timeline can look up platforms ──
    // Key: normalised station name  →  array of { destination, time, platform }
    if (!this.trainPlatformCache) this.trainPlatformCache = {};
    const deps = liveData.departures?.all || [];
    const normStation = station.name.toLowerCase().replace(/\s+/g, ' ').trim();
    this.trainPlatformCache[normStation] = deps.map(d => ({
      destination: (d.destination_name || '').toLowerCase(),
      aimed:       d.aimed_departure_time || '',
      expected:    d.expected_departure_time || d.aimed_departure_time || '',
      platform:    d.platform || null
    }));

    const trainTimeLabel = queryDate.isFuture
      ? `<span class="transport-time-badge">&#x1F550; Departures from ${queryDate.time}</span>`
      : `<span class="transport-time-badge live">&#x1F534; Live now</span>`;
    let html = `
      <div class="transport-stop-card train">
        <h3 class="transport-stop-title">${station.name} ${trainTimeLabel}</h3>
    `;

    const trainDeps = liveData.departures?.all || [];
    if (trainDeps.length > 0) {
      trainDeps.slice(0, 5).forEach((dep, index) => {
        const aimed = dep.aimed_departure_time;
        const expected = dep.expected_departure_time || aimed;

        let isDelayed = false;
        let delayMinutes = 0;

        if (aimed && expected) {
          const aimedTime = new Date(`1970-01-01T${aimed}`);
          const expectedTime = new Date(`1970-01-01T${expected}`);
          delayMinutes = Math.round((expectedTime - aimedTime) / 60000);
          isDelayed = delayMinutes > 0;
        }

        const statusText = isDelayed ? 'Delayed' : 'On time';
        const statusClass = isDelayed ? 'delayed' : 'on-time';

        const uniqueId = `train-${station.station_code}-${index}`;

        html += `
          <div class="departure-row" onclick="app.toggleDetails('${uniqueId}')">
            <div class="departure-main">
              <div class="departure-header">
                <div>
                  <div class="departure-destination">${dep.destination_name}</div>
                  <div class="departure-operator">${dep.operator_name}</div>
                </div>
                <div>
                  <div class="departure-time">${expected}</div>
                  <div class="departure-status ${statusClass}">
                    ${statusText}${isDelayed ? ` (${delayMinutes} min late)` : ''}
                  </div>
                </div>
              </div>
              <div class="departure-footer">
                <span>Platform ${dep.platform || 'TBA'}</span>
                <span class="departure-tap">Tap for details</span>
              </div>
            </div>

            <div id="${uniqueId}" class="departure-details" style="display:none">
              <div class="departure-details-grid">
                <div>
                  <div class="detail-label">Scheduled</div>
                  <div class="detail-value">${aimed}</div>
                </div>
                <div>
                  <div class="detail-label">Expected</div>
                  <div class="detail-value">${expected}</div>
                </div>
                <div>
                  <div class="detail-label">Operator</div>
                  <div class="detail-value">${dep.operator_name}</div>
                </div>
                <div>
                  <div class="detail-label">Platform</div>
                  <div class="detail-value">${dep.platform || 'TBA'}</div>
                </div>
              </div>
            </div>
          </div>
        `;
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

 

  // ─── AUTH HELPERS ───────────────────────────────────────────
  // Store logged-in user in sessionStorage so it survives page refresh
  // but clears when the browser tab is closed.

  getUser() {
    const raw = sessionStorage.getItem('urbannav_user');
    return raw ? JSON.parse(raw) : null;
  }

  setUser(user) {
    sessionStorage.setItem('urbannav_user', JSON.stringify(user));
    this.updateAuthUI();
    this.loadFavouritesFromDB();
  }

  clearUser() {
    sessionStorage.removeItem('urbannav_user');
    this.updateAuthUI();
    this.renderFavList([]);
    this.updateFavBadge(0);
  }

  updateAuthUI() {
    const user = this.getUser();
    const loginBtn  = document.getElementById('authLoginBtn');
    const userLabel = document.getElementById('authUserLabel');
    const logoutBtn = document.getElementById('authLogoutBtn');
    if (!loginBtn) return;
    if (user) {
      loginBtn.style.display  = 'none';
      userLabel.style.display = 'inline-flex';
      logoutBtn.style.display = 'inline-flex';
      userLabel.textContent   = user.first_name;
    } else {
      loginBtn.style.display  = 'inline-flex';
      userLabel.style.display = 'none';
      logoutBtn.style.display = 'none';
    }
  }

  // ─── SAVE ROUTE ─────────────────────────────────────────────
  async saveRoute() {
    if (!this.currentRoute || !this.selectedMode) return;

    const user = this.getUser();
    if (!user) {
      // Not logged in — open auth modal
      this.openAuthModal('login');
      return;
    }

    const from = document.getElementById('fromInput').value;
    const to   = document.getElementById('toInput').value;

    try {
      const resp = await fetch('save_favourite.php', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id:        user.user_id,
          start_location: from,
          destination:    to,
          departure_time: null
        })
      });

      // Get raw text first so we can debug if PHP returns HTML error page
      const rawText = await resp.text();
      console.log('save_favourite response:', rawText);

      let data;
      try {
        data = JSON.parse(rawText);
      } catch (parseErr) {
        // PHP returned an error page instead of JSON — show first 150 chars
        this.showToast(' PHP error: ' + rawText.replace(/<[^>]+>/g, '').trim().slice(0, 150), true);
        return;
      }

      if (data.success) {
        const btn = document.getElementById('saveRouteBtn');
        if (btn) btn.classList.add('saved');
        await this.loadFavouritesFromDB();
        document.getElementById('favPanel').style.display = 'block';
        this.showToast('Route saved to favourites!');
      } else {
        this.showToast(' ' + (data.error || 'Could not save route'), true);
      }
    } catch (e) {
      console.error('saveRoute fetch error:', e);
      this.showToast(' Could not reach server. Check: are you on http://localhost:8888 ?', true);
    }
  }

  // ─── TOAST NOTIFICATION ─────────────────────────────────────
  showToast(message, isError = false) {
    const existing = document.getElementById('urbanToast');
    if (existing) existing.remove();
    const toast = document.createElement('div');
    toast.id = 'urbanToast';
    toast.textContent = message;
    toast.style.cssText = `
      position:fixed; bottom:24px; left:50%; transform:translateX(-50%);
      background:${isError ? '#DC2626' : '#1E40AF'}; color:white;
      padding:10px 22px; border-radius:20px; font-size:13px; font-weight:600;
      z-index:9999; box-shadow:0 4px 16px rgba(0,0,0,0.25);
      white-space:nowrap; pointer-events:none;
    `;
    document.body.appendChild(toast);
    setTimeout(() => { if (toast.parentNode) toast.remove(); }, 3000);
  }

  async loadFavouritesFromDB() {
    const user = this.getUser();
    if (!user) return;

    try {
      const resp = await fetch(`get_favourites.php?user_id=${user.user_id}`);
      const rawText = await resp.text();
      console.log('get_favourites response:', rawText);
      let data;
      try { data = JSON.parse(rawText); } catch { return; }
      if (data.success) {
        this.updateFavBadge(data.favourites.length);
        this.renderFavList(data.favourites);
      }
    } catch (e) {
      console.warn('Could not load favourites:', e);
    }
  }

  // ─── DELETE FAVOURITE ───────────────────────────────────────
  async deleteFav(favourite_id) {
    const user = this.getUser();
    if (!user) return;

    try {
      const resp = await fetch('delete_favourite.php', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: user.user_id, favourite_id })
      });
      const data = await resp.json();
      if (data.success) {
        this.showToast('Route removed');
        this.loadFavouritesFromDB();
      } else {
        this.showToast((data.error || 'Could not remove'), true);
      }
    } catch (e) {
      this.showToast('Server error', true);
    }
  }

  // ─── RENDER FAV LIST ────────────────────────────────────────
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
      list.innerHTML = `
        <p class="fav-empty">
          <a href="#" onclick="app.openAuthModal('login')" style="color:var(--brand);font-weight:600;">Log in</a>
          to see your saved routes.
        </p>`;
      return;
    }

    if (!favs || favs.length === 0) {
      list.innerHTML = '<p class="fav-empty">No saved routes yet.<br>Complete a route and save it to see it here.</p>';
      return;
    }

    // Use data-attributes to avoid apostrophe/quote injection in onclick
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
      </div>
    `).join('');
  }

  // Escape for HTML attribute values (prevents quote-breaking)
  escAttr(str) {
    return String(str).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  }
  // Escape for HTML content
  escHtml(str) {
    return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  loadFav(from, to) {
    document.getElementById('fromInput').value = from;
    document.getElementById('toInput').value   = to;
    document.getElementById('favPanel').style.display = 'none';
    this.findRoute();
  }

  // ─── AUTH MODAL ─────────────────────────────────────────────
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
      const resp = await fetch('login.php', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });
      const rawText = await resp.text();
      console.log('login response:', rawText);
      let data;
      try {
        data = JSON.parse(rawText);
      } catch {
        errEl.textContent = 'Server error — check browser console for details';
        console.error('Login PHP returned non-JSON:', rawText);
        return;
      }
      if (data.success) {
        this.setUser(data);
        this.closeAuthModal();
      } else {
        errEl.textContent = data.error || 'Login failed';
      }
    } catch (e) {
      errEl.textContent = 'Cannot reach server — are you on http://localhost:8888 ?';
      console.error('Login fetch error:', e);
    }
  }

  async submitRegister() {
    const first_name = document.getElementById('regFirstName').value.trim();
    const last_name  = document.getElementById('regLastName').value.trim();
    const email      = document.getElementById('regEmail').value.trim();
    const password   = document.getElementById('regPassword').value;
    const errEl      = document.getElementById('authError');
    errEl.textContent = '';

    if (!first_name || !last_name || !email || !password) {
      errEl.textContent = 'Please fill in all fields'; return;
    }

    try {
      const resp = await fetch('register.php', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ first_name, last_name, email, password })
      });
      const rawText = await resp.text();
      console.log('register response:', rawText);
      let data;
      try {
        data = JSON.parse(rawText);
      } catch {
        errEl.textContent = 'Server error — check browser console for details';
        console.error('Register PHP returned non-JSON:', rawText);
        return;
      }
      if (data.success) {
        this.setUser(data);
        this.closeAuthModal();
      } else {
        errEl.textContent = data.error || 'Registration failed';
      }
    } catch (e) {
      errEl.textContent = 'Cannot reach server — are you on http://localhost:8888 ?';
      console.error('Register fetch error:', e);
    }
  }

  // ─── TOGGLE DEPARTURE DETAILS ───────────────────────────────

  // Resolve query date/time for TransportAPI calls
  _resolveQueryDate(chosenTime) {
    chosenTime = chosenTime || "";
    var now  = new Date();
    var yyyy = now.getFullYear();
    var mm   = String(now.getMonth() + 1).padStart(2, "0");
    var dd   = String(now.getDate()).padStart(2, "0");
    var today = yyyy + "-" + mm + "-" + dd;
    if (!chosenTime) {
      var hh  = String(now.getHours()).padStart(2, "0");
      var min = String(now.getMinutes()).padStart(2, "0");
      return { date: today, time: hh + ":" + min, isFuture: false };
    }
    var parts = chosenTime.split(":");
    var h = parseInt(parts[0]); var m = parseInt(parts[1]);
    var chosen = new Date(now);
    chosen.setHours(h, m, 0, 0);
    var diffMins = (chosen - now) / 60000;
    return { date: today, time: chosenTime, isFuture: diffMins > 10 };
  }

  toggleDetails(elementId) {
    const element = document.getElementById(elementId);
    if (!element) return;
    const isHidden = element.style.display === 'none' || !element.style.display;
    element.style.display = isHidden ? 'block' : 'none';
  }

  // ─── INIT ───────────────────────────────────────────────────
  initFavouritesOnLoad() {
    this.updateAuthUI();
    this.loadFavouritesFromDB();
  }

  async loadBusDepartures(lat, lon, chosenTime = '') {
  try {
    const stopsUrl = `https://transportapi.com/v3/uk/places.json?lat=${lat}&lon=${lon}&type=bus_stop&app_id=${CONFIG.TRANSPORT_APP_ID}&app_key=${CONFIG.TRANSPORT_APP_KEY}`;
    const stopsResp = await fetch(stopsUrl);
    const stopsData = await stopsResp.json();

    if (!stopsData.member || stopsData.member.length === 0) {
      return '<div class="transport-no-data" style="padding:12px;background:#f9fafb;border-radius:8px;">No nearby bus stops found</div>';
    }

    const stop = stopsData.member[0];
    // Use timetable endpoint for future times, live for current time
    const busQueryDate = this._resolveQueryDate(chosenTime);
    let liveUrl;
    if (busQueryDate.isFuture) {
      liveUrl = `https://transportapi.com/v3/uk/bus/stop/${stop.atcocode}/timetable.json?app_id=${CONFIG.TRANSPORT_APP_ID}&app_key=${CONFIG.TRANSPORT_APP_KEY}&group=route&limit=8&nextbuses=no&date=${busQueryDate.date}&time=${busQueryDate.time}`;
    } else {
      liveUrl = `https://transportapi.com/v3/uk/bus/stop/${stop.atcocode}/live.json?app_id=${CONFIG.TRANSPORT_APP_ID}&app_key=${CONFIG.TRANSPORT_APP_KEY}&group=route&limit=5`;
    }
    const liveResp = await fetch(liveUrl);
    const liveData = await liveResp.json();

    const busTimeLabel = busQueryDate.isFuture
      ? `<span class="transport-time-badge">&#x1F550; Departures from ${busQueryDate.time}</span>`
      : `<span class="transport-time-badge live">&#x1F534; Live now</span>`;
    let html = `
      <div class="transport-stop-card bus">
        <h3 class="transport-stop-title">${stop.name} ${busTimeLabel}</h3>
    `;

    // Timetable returns departures differently — normalise to same shape
    const busDeps = liveData.departures || {};
    if (Object.keys(busDeps).length > 0) {
      let idx = 0;
      Object.values(busDeps).slice(0, 5).forEach(buses => {
        const busArr = Array.isArray(buses) ? buses : [buses];
        busArr.slice(0, 1).forEach(bus => {
          const aimed = bus.aimed_departure_time;
          const expected = bus.expected_departure_time || aimed;

          let isDelayed = false;
          let delayMinutes = 0;

          if (aimed && expected) {
            const aimedTime = new Date(`1970-01-01T${aimed}`);
            const expectedTime = new Date(`1970-01-01T${expected}`);
            delayMinutes = Math.round((expectedTime - aimedTime) / 60000);
            isDelayed = delayMinutes > 0;
          }

          const statusText = isDelayed ? 'Delayed' : 'On time';
          const statusClass = isDelayed ? 'delayed' : 'on-time';
          const uniqueId = `bus-${stop.atcocode}-${idx++}`;

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
                    <div class="departure-status ${statusClass}">
                      ${statusText}${isDelayed ? ` (${delayMinutes} min late)` : ''}
                    </div>
                  </div>
                </div>
                <div class="departure-footer">
                  <span>${bus.source || 'Live data'}</span>
                  <span class="departure-tap bus-tap">Tap for details</span>
                </div>
              </div>

              <div id="${uniqueId}" class="departure-details" style="display:none">
                <div class="departure-details-grid">
                  <div>
                    <div class="detail-label">Scheduled</div>
                    <div class="detail-value">${aimed}</div>
                  </div>
                  <div>
                    <div class="detail-label">Expected</div>
                    <div class="detail-value">${expected}</div>
                  </div>
                  <div>
                    <div class="detail-label">Operator</div>
                    <div class="detail-value">${bus.operator_name || 'N/A'}</div>
                  </div>
                  <div>
                    <div class="detail-label">Tracking</div>
                    <div class="detail-value">${bus.expected_departure_time ? 'Live' : 'Scheduled'}</div>
                  </div>
                </div>
              </div>
            </div>
          `;
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

 

  // ─── FR10: FASTEST ROUTE ────────────────────────────────────
  // Compares all returned route alternatives by total duration in seconds.
  // Returns the index of the shortest-duration route.
  _getFastestRouteIndex(routes) {
    let bestIdx = 0;
    let bestSecs = Infinity;
    routes.forEach((route, i) => {
      const secs = route.legs.reduce((sum, leg) => sum + leg.duration.value, 0);
      if (secs < bestSecs) { bestSecs = secs; bestIdx = i; }
    });
    return bestIdx;
  }

  // ─── FR11: LEAST DISRUPTED ROUTE ────────────────────────────
  // Scores each route by counting disruption signals:
  //   - Number of steps/transfers (more connections = more disruption risk)
  //   - Transit-specific: each boarding step adds extra risk
  //   - Warning keywords found in step instructions
  // Lower score = less disrupted. Returns index of least-disrupted route.
  _getLeastDisruptedRouteIndex(routes) {
    const disruptionKeywords = /clos|delay|divert|suspend|replac|alert|incident|congesti/i;
    const scores = routes.map((route) => {
      let score = 0;
      route.legs.forEach(leg => {
        score += leg.steps.length;
        leg.steps.forEach(step => {
          if (step.travel_mode === 'TRANSIT') score += 2;
          if (step.instructions && disruptionKeywords.test(step.instructions)) score += 5;
          if (step.steps) {
            step.steps.forEach(sub => {
              if (sub.instructions && disruptionKeywords.test(sub.instructions)) score += 5;
            });
          }
        });
      });
      return score;
    });
    return scores.indexOf(Math.min(...scores));
  }

  // ─── Build route badge HTML ──────────────────────────────────
  _getRouteBadges(routes, selectedIndex) {
    const fastestIdx   = this._getFastestRouteIndex(routes);
    const leastDisrIdx = this._getLeastDisruptedRouteIndex(routes);
    let badges = '';
    if (selectedIndex === fastestIdx) {
      badges += `<span class="route-badge badge-fastest">Fastest Route</span>`;
    }
    if (selectedIndex === leastDisrIdx) {
      badges += `<span class="route-badge badge-least-disrupted">Least Disrupted</span>`;
    }
    return badges;
  }

  //calculate route using Google Directions API — requests alternatives for FR10/FR11
  calculateRoute(origin, destination, travelMode) {
    return new Promise((resolve, reject) => {
      this.directionsService.route(
        {
          origin,
          destination,
          travelMode: google.maps.TravelMode[travelMode],
          provideRouteAlternatives: true
        },
        (result, status) => {
          if (status === 'OK') resolve(result);
          else reject(new Error(`Route calculation failed: ${status}`));
        }
      );
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

  // ─── BEST (MULTIMODAL) MODE ─────────────────────────────────
  async selectBestMode(btnEl) {
    this.selectedMode = 'TRANSIT';

    // Highlight the Best button
    document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
    if (btnEl) btnEl.classList.add('active');

    this.showLoading('routeInfo', 'Finding best multimodal journey...');

    try {
      const from = document.getElementById('fromInput').value;
      const to   = document.getElementById('toInput').value;

      // Request TRANSIT directions — Google returns multimodal legs (walk+bus+train etc.)
      const result = await this.calculateRoute(from, to, 'TRANSIT');
      this.currentRoute = result;
      this.allRoutes    = result.routes;

      this.directionsRenderer.setDirections(result);

      const routeBounds = result.routes[0].bounds;
      if (routeBounds) {
        this.map.fitBounds(routeBounds, { top: 60, right: 40, bottom: 40, left: 40 });
      }

      // Pre-fetch TransportAPI train data FIRST so the platform cache is ready
      // before displayBestRoute renders the journey timeline
      const timeInput  = document.getElementById('departureTime');
      const chosenTime = timeInput ? timeInput.value : '';
      await this._primeTrainPlatformCache(chosenTime);

      this.displayBestRoute(result);

      // eco + live transport
      this.displayEnvironmentalImpact(result, 'TRANSIT');
      if (window._onEcoReady) window._onEcoReady();
      document.getElementById('alertsSection').style.display = 'block';
      await this.loadLiveTransport();

    } catch (error) {
      this.showError('routeInfo', 'Could not find a transit route. Try entering locations near public transport.');
    }
  }

  displayBestRoute(result) {
    const routes  = result.routes;
    const totalDur = routes[0].legs.reduce((s, l) => s + l.duration.value, 0);
    const totalDist = routes[0].legs.reduce((s, l) => s + l.distance.value, 0);

    // Build option cards (up to 3 alternatives)
    const optionCards = routes.slice(0, 3).map((route, idx) => {
      const leg       = route.legs[0];
      const dur       = route.legs.reduce((s, l) => s + l.duration.value, 0);
      const durText   = dur < 3600 ? `${Math.round(dur/60)} min` : `${Math.floor(dur/3600)}h ${Math.round((dur%3600)/60)}m`;

      // Collect transit steps to build leg chips
      const chips = this._buildLegChips(leg.steps);

      // Departure / arrival time
      const dep = leg.departure_time ? leg.departure_time.text : '';
      const arr = leg.arrival_time   ? leg.arrival_time.text   : '';
      const timeRange = dep && arr ? `${dep} – ${arr}` : durText;

      const isFirst = idx === 0;
      const optLabel = isFirst ? '<span class="mm-option-label">Best</span>' : '';

      return `
        <div class="mm-option-card${isFirst ? ' mm-selected' : ''}" id="mmOption${idx}" 
             onclick="app.selectMmOption(${idx}, event)">
          ${optLabel}
          <div class="mm-option-top">
            <span class="mm-option-time-range">${timeRange}</span>
            <span class="mm-option-duration">${durText}</span>
          </div>
          <div class="mm-option-legs">${chips}</div>
          <button class="mm-details-toggle" id="mmToggle${idx}" 
                  onclick="app.toggleMmDetails(${idx}, event)">
            <span>Details</span>
            <span class="mm-toggle-arrow">&#9660;</span>
          </button>
          <div class="mm-journey-details" id="mmDetails${idx}">
            ${this._buildJourneyTimeline(route.legs[0])}
          </div>
        </div>
      `;
    }).join('');

    const distKm = (totalDist / 1000).toFixed(1);
    const durMins = Math.round(totalDur / 60);

    document.getElementById('routeInfo').innerHTML = `
      <div class="mm-summary-strip">
        <div>
          <div class="mm-summary-total">${durMins} min</div>
          <div class="mm-summary-sub">Best multimodal journey</div>
        </div>
        <div class="mm-summary-dist">${distKm} km</div>
      </div>
      <div class="mm-options-row">
        ${optionCards}
      </div>
    `;

    // Auto-open the first (Best) option's details immediately
    const firstDetails = document.getElementById('mmDetails0');
    const firstToggle  = document.getElementById('mmToggle0');
    if (firstDetails) firstDetails.classList.add('open');
    if (firstToggle)  firstToggle.classList.add('open');
  }

  selectMmOption(idx, e) {
    // Don't fire when clicking Details button
    if (e.target.closest('.mm-details-toggle')) return;
    document.querySelectorAll('.mm-option-card').forEach((c, i) => {
      c.classList.toggle('mm-selected', i === idx);
    });
    // Show the selected route on map
    if (this.currentRoute && this.currentRoute.routes[idx]) {
      this.directionsRenderer.setRouteIndex(idx);
      const bounds = this.currentRoute.routes[idx].bounds;
      if (bounds) this.map.fitBounds(bounds, {top:60,right:40,bottom:40,left:40});
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
        if (vt === 'BUS' || vt === 'TROLLEYBUS') { cls = 'bus'; imgSrc = 'bustrain.png'; imgAlt = 'Bus'; }
        else if (vt === 'TRAM' || vt === 'LIGHT_RAIL') { cls = 'tram'; imgSrc = 'bustrain.png'; imgAlt = 'Tram'; }
        else if (vt === 'SUBWAY' || vt === 'METRO_RAIL') { cls = 'subway'; imgSrc = 'bustrain.png'; imgAlt = 'Subway'; }
        parts.push({ type: cls, imgSrc, imgAlt, label: ln });
        lastMode = 'TRANSIT';
      }
    });
    // interleave arrows
    return parts.map((p, i) => {
      const arrow = i < parts.length - 1 ? '<span class="mm-leg-arrow">›</span>' : '';
      return `<span class="mm-leg-chip ${p.type}"><img src="${p.imgSrc}" alt="${p.imgAlt}" width="13" height="13" style="object-fit:contain;vertical-align:middle;margin-right:3px">${p.label}</span>${arrow}`;
    }).join('');
  }

  // ─── PRIME PLATFORM CACHE ───────────────────────────────────
  // Called before rendering the journey timeline so TransportAPI platform
  // data is ready. Fetches from the origin location (start of journey).
  async _primeTrainPlatformCache(chosenTime = '') {
    try {
      const from = document.getElementById('fromInput').value;
      if (!from) return;

      // Geocode the origin to get lat/lon for the TransportAPI lookup
      const geocoder = new google.maps.Geocoder();
      const originResult = await this.geocodeAddress(geocoder, from);
      const lat = originResult.geometry.location.lat();
      const lon = originResult.geometry.location.lng();

      // Reuse loadTrainDepartures — it populates this.trainPlatformCache as a side-effect
      await this.loadTrainDepartures(lat, lon, chosenTime);
    } catch (e) {
      // Non-fatal — platform info just won't show if this fails
      console.warn('Could not prime platform cache:', e);
    }
  }

  // ─── PLATFORM LOOKUP ────────────────────────────────────────
  // Cross-references TransportAPI cache to find the platform for a given
  // transit step. Matches on station name + departure time (±2 min tolerance).
  _lookupPlatform(stopName, depTimeText) {
    if (!this.trainPlatformCache) return null;
    const normStop = stopName.toLowerCase().replace(/\s+/g, ' ').trim();

    // Try to find a cache entry whose key is contained in the stop name or vice versa
    const cacheKey = Object.keys(this.trainPlatformCache).find(k =>
      normStop.includes(k) || k.includes(normStop)
    );
    if (!cacheKey) return null;

    const entries = this.trainPlatformCache[cacheKey];
    if (!entries || entries.length === 0) return null;

    // Convert "HH:MM" text to minutes-since-midnight for fuzzy matching
    const toMins = t => {
      if (!t) return -1;
      const parts = t.split(':');
      return parseInt(parts[0]) * 60 + parseInt(parts[1]);
    };
    const targetMins = toMins(depTimeText);

    // Find the closest departure within 2 minutes that has a platform
    let best = null, bestDiff = Infinity;
    entries.forEach(e => {
      const diff = Math.abs(toMins(e.aimed) - targetMins);
      if (diff <= 2 && diff < bestDiff && e.platform) {
        bestDiff = diff;
        best = e.platform;
      }
    });
    return best;
  }

  _buildJourneyTimeline(leg) {
    const steps  = leg.steps;
    const depTime = leg.departure_time ? leg.departure_time.text : '';
    const arrTime = leg.arrival_time   ? leg.arrival_time.text   : '';

    let html = '<div class="mm-timeline">';

    steps.forEach((step, i) => {
      const isFirst = i === 0;
      const isLast  = i === steps.length - 1;

      if (step.travel_mode === 'WALKING') {
        // Walk segment
        const dist = step.distance.text;
        const dur  = step.duration.text;

        if (isFirst) {
          // Origin stop
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
        } else if (isLast) {
          // Final walk to destination — just show meta, destination handled below
          html += `
            <div class="mm-tl-segment seg-walk">
              <div class="mm-tl-dot dot-walk"></div>
              <div class="mm-tl-stop">
                <span class="mm-tl-stop-time"></span>
                <div>
                  <div class="mm-tl-stop-name">Walk to destination</div>
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
                <div><div class="mm-tl-stop-name">Walk</div></div>
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
        const td      = step.transit;
        const depStop = td.departure_stop.name;
        const arrStop = td.arrival_stop.name;
        const depT    = td.departure_time.text;
        const arrT    = td.arrival_time.text;
        const numStops = td.num_stops;
        const lineName = td.line.short_name || td.line.name || '';
        const lineFullName = td.line.name || lineName;
        const operator = td.line.agencies ? td.line.agencies[0].name : '';
        const vt       = td.line.vehicle.type;
        // Look up platform from TransportAPI cache (more reliable than Google Maps data)
        const platform = this._lookupPlatform(depStop, depT);

        let legClass = 'leg-train', imgSrc = 'bustrain.png', imgAlt = 'Train', badgeClass = 'badge-train';
        if (vt === 'BUS' || vt === 'TROLLEYBUS') { legClass = 'leg-bus'; imgSrc = 'bustrain.png'; imgAlt = 'Bus'; badgeClass = 'badge-bus'; }
        else if (vt === 'TRAM' || vt === 'LIGHT_RAIL') { legClass = 'leg-tram'; imgSrc = 'bustrain.png'; imgAlt = 'Tram'; badgeClass = 'badge-train'; }
        else if (vt === 'SUBWAY') { legClass = 'leg-subway'; imgSrc = 'bustrain.png'; imgAlt = 'Subway'; badgeClass = 'badge-train'; }

        const stopPlural = numStops === 1 ? '1 stop' : `${numStops} stops`;
        const platformHTML = platform
          ? `<span class="mm-tl-platform-badge">Platform ${platform}</span>`
          : '';

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

    // Final destination
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
    `;

    html += '</div>'; // close mm-timeline
    return html;
  }

  // show loading and error messages
  showLoading(elementId, message) { 
    document.getElementById(elementId).innerHTML = `
      <div class="loading-row">
        <div class="spinner"></div>
        <span class="loading-text">${message}</span>
      </div>
    `;
  }

  showError(elementId, message) {
    document.getElementById(elementId).innerHTML = `
      <div class="alert-error">
        <p class="title">Error</p>
        <p class="body">${message}</p>
      </div>
    `;
  }
}

// Initialize the app once the DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    window.app = new UrbanNavApp();
  });
} else {
  window.app = new UrbanNavApp();
}
