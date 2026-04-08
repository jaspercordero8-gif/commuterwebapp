app.js


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

    // Initialize autocomplete
    new google.maps.places.Autocomplete(document.getElementById('fromInput'));
    new google.maps.places.Autocomplete(document.getElementById('toInput'));
  }

  initEventListeners() {
    document.getElementById('findRouteBtn').addEventListener('click', () => this.findRoute());
    document.getElementById('toggleSidebar').addEventListener('click', () => this.toggleSidebar());
    document.getElementById('closeSidebar').addEventListener('click', () => this.toggleSidebar());
    
    // allow pressing enter to search
    ['fromInput', 'toInput'].forEach(id => {
      document.getElementById(id).addEventListener('keypress', (e) => {
        if (e.key === 'Enter') this.findRoute();
      });
    });
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
      const result = await this.geocodeAddress(geocoder, to);
      
      this.destinationLatLng = result.geometry.location;
      this.map.setCenter(this.destinationLatLng);
      
      // Show transport modes
      document.getElementById('transportModes').classList.remove('hidden');
      document.getElementById('routeDetails').classList.remove('hidden');
      document.getElementById('alertsSection').classList.remove('hidden');
      document.getElementById('weatherSection').classList.remove('hidden');
      
      document.getElementById('routeInfo').innerHTML = `
        <div class="text-center text-gray-600 py-4">
          <p>📍 Destination found!</p>
          <p class="text-sm mt-2">Select a transport mode to see route details</p>
        </div>
      `;

      // Load weather
      await this.loadWeather();
      
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
      
      this.directionsRenderer.setDirections(result);
      this.displayRouteDetails(result, mode);
      
      // Show environmental impact
      document.getElementById('environmentSection').classList.remove('hidden');
      this.displayEnvironmentalImpact(result, mode);
      
    } catch (error) {
      this.showError('routeInfo', error.message);
    }
  }

  displayRouteDetails(result, mode) {
    const leg = result.routes[0].legs[0];
    const icons = {
      WALKING: '🚶',
      BICYCLING: '🚲',
      DRIVING: '🚗',
      TRANSIT: '🚇'
    };
    //generate step by step directions 
    let stepsHTML = leg.steps.map((step, i) => `
      <div class="border-l-2 border-gray-200 pl-3 pb-3 ml-2">
        <div class="flex items-start">
          <span class="bg-blue-100 text-blue-600 rounded-full w-6 h-6 flex items-center justify-center text-xs font-bold mr-2 flex-shrink-0">${i + 1}</span>
          <div class="text-sm text-gray-700">${step.instructions}</div>
        </div>
        <div class="text-xs text-gray-500 mt-1 ml-8">${step.distance.text} • ${step.duration.text}</div>
      </div>
    `).join('');

    //update route info section
    document.getElementById('routeInfo').innerHTML = `
      <div class="bg-gradient-to-r from-blue-50 to-blue-100 rounded-lg p-4 mb-3">
        <div class="flex items-center justify-between mb-2">
          <div class="text-2xl">${icons[mode]}</div>
          <div class="text-right">
            <div class="text-2xl font-bold text-blue-600">${leg.duration.text}</div>
            <div class="text-sm text-gray-600">${leg.distance.text}</div>
          </div>
        </div>
      </div>

      <div class="mb-3">
        <h3 class="font-semibold text-gray-700 mb-2 flex items-center">
          <span class="mr-2"></span> Step-by-step directions
        </h3>
        <div class="space-y-2">
          ${stepsHTML}
        </div>
      </div>
    `;
  }
  //calculate and show environmental impact
  displayEnvironmentalImpact(result, mode) {
    const distance = result.routes[0].legs[0].distance.value / 1000; // km
    const emissions = {
      DRIVING: 0.171,
      WALKING: 0,
      BICYCLING: 0,
      TRANSIT: 0.041
    };

    const co2 = (emissions[mode] || 0) * distance;
    const saved = emissions.DRIVING * distance - co2;
    const trees = (saved / 21).toFixed(1);

    let message = '';
    let bgColor = 'bg-green-50';
    
    if (mode === 'DRIVING') {
      message = `This journey will produce <strong>${co2.toFixed(2)} kg</strong> of CO₂`;
      bgColor = 'bg-red-50';
    } else if (saved > 0) {
      message = `You're saving <strong>${saved.toFixed(2)} kg</strong> of CO₂ compared to driving!<br>
                 <span class="text-sm">That's equivalent to ${trees} tree(s) for a day 🌳</span>`;
    } else {
      message = `Zero emissions! Great choice for the environment! 🌍`;
    }

    document.getElementById('environmentInfo').innerHTML = `
      <div class="${bgColor} border border-green-200 rounded-lg p-4">
        <div class="text-gray-700">${message}</div>
      </div>
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
        <div class="bg-gradient-to-r from-blue-50 to-cyan-50 rounded-lg p-4">
          <div class="flex items-center justify-between">
            <div>
              <div class="text-3xl font-bold text-blue-600">${Math.round(data.main.temp)}°C</div>
              <div class="text-sm text-gray-600 capitalize">${data.weather[0].description}</div>
            </div>
            <div class="text-5xl">
              ${this.getWeatherEmoji(data.weather[0].main)}
            </div>
          </div>
          <div class="grid grid-cols-2 gap-2 mt-3 text-sm">
            <div class="bg-white bg-opacity-50 rounded p-2">
              <div class="text-gray-600">Feels like</div>
              <div class="font-semibold">${Math.round(data.main.feels_like)}°C</div>
            </div>
            <div class="bg-white bg-opacity-50 rounded p-2">
              <div class="text-gray-600">Humidity</div>
              <div class="font-semibold">${data.main.humidity}%</div>
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

    this.showLoading('liveTransportInfo', 'Loading live transport data...');

    try {
      const lat = this.destinationLatLng.lat();
      const lon = this.destinationLatLng.lng();

      // Load both train and bus data
      const [trainData, busData] = await Promise.all([
        this.loadTrainDepartures(lat, lon),
        this.loadBusDepartures(lat, lon)
      ]);

      document.getElementById('liveTransportInfo').innerHTML = trainData + busData;
    } catch (error) {
      this.showError('liveTransportInfo', error.message);
    }
  }

  async loadTrainDepartures(lat, lon) {
  try {
    const stationsUrl = `https://transportapi.com/v3/uk/places.json?lat=${lat}&lon=${lon}&type=train_station&app_id=${CONFIG.TRANSPORT_APP_ID}&app_key=${CONFIG.TRANSPORT_APP_KEY}`;
    const stationsResp = await fetch(stationsUrl);
    const stationsData = await stationsResp.json();

    if (!stationsData.member || stationsData.member.length === 0) {
      return '<div class="text-sm text-gray-500 p-3 bg-gray-50 rounded-lg">No nearby train stations found</div>';
    }

    const station = stationsData.member[0];
    const liveUrl = `https://transportapi.com/v3/uk/train/station/${station.station_code}/live.json?app_id=${CONFIG.TRANSPORT_APP_ID}&app_key=${CONFIG.TRANSPORT_APP_KEY}`;
    const liveResp = await fetch(liveUrl);
    const liveData = await liveResp.json();

    let html = `
      <div class="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-3">
        <h3 class="font-semibold text-blue-900 mb-2">${station.name}</h3>
    `;

    if (liveData.departures?.all) {
      liveData.departures.all.slice(0, 5).forEach((dep, index) => {
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
        const statusColor = isDelayed ? 'text-red-600' : 'text-green-600';

        const uniqueId = `train-${station.station_code}-${index}`;

        html += `
          <div class="bg-white rounded-lg mb-2 border border-gray-200 cursor-pointer hover:shadow-md transition-shadow"
               onclick="app.toggleDetails('${uniqueId}')">
            <div class="p-3">
              <div class="flex justify-between items-start mb-1">
                <div>
                  <div class="font-semibold text-gray-800">${dep.destination_name}</div>
                  <div class="text-xs text-gray-500">${dep.operator_name}</div>
                </div>
                <div class="text-right">
                  <div class="text-lg font-bold text-gray-800">${expected}</div>
                  <div class="text-xs font-semibold ${statusColor}">
                    ${statusText}${isDelayed ? ` (${delayMinutes} min late)` : ''}
                  </div>
                </div>
              </div>
              <div class="text-xs text-gray-600 flex justify-between">
                <span>Platform ${dep.platform || 'TBA'}</span>
                <span class="text-blue-600">Tap for details</span>
              </div>
            </div>

            <div id="${uniqueId}" class="hidden border-t border-gray-200 bg-gray-50 p-3 text-xs">
              <div class="grid grid-cols-2 gap-2">
                <div>
                  <div class="text-gray-500">Scheduled</div>
                  <div class="font-semibold">${aimed}</div>
                </div>
                <div>
                  <div class="text-gray-500">Expected</div>
                  <div class="font-semibold">${expected}</div>
                </div>
                <div>
                  <div class="text-gray-500">Operator</div>
                  <div class="font-semibold">${dep.operator_name}</div>
                </div>
                <div>
                  <div class="text-gray-500">Platform</div>
                  <div class="font-semibold">${dep.platform || 'TBA'}</div>
                </div>
              </div>
            </div>
          </div>
        `;
      });
    } else {
      html += '<div class="text-sm text-gray-500">No departures available</div>';
    }

    html += '</div>';
    return html;
  } catch {
    return '<div class="text-sm text-red-500 p-3 bg-red-50 rounded-lg">Error loading train data</div>';
  }
}

 

  toggleDetails(elementId) {
    const element = document.getElementById(elementId);
    if (element) {
      element.classList.toggle('hidden');
    }
  }

  async loadBusDepartures(lat, lon) {
  try {
    const stopsUrl = `https://transportapi.com/v3/uk/places.json?lat=${lat}&lon=${lon}&type=bus_stop&app_id=${CONFIG.TRANSPORT_APP_ID}&app_key=${CONFIG.TRANSPORT_APP_KEY}`;
    const stopsResp = await fetch(stopsUrl);
    const stopsData = await stopsResp.json();

    if (!stopsData.member || stopsData.member.length === 0) {
      return '<div class="text-sm text-gray-500 p-3 bg-gray-50 rounded-lg">No nearby bus stops found</div>';
    }

    const stop = stopsData.member[0];
    const liveUrl = `https://transportapi.com/v3/uk/bus/stop/${stop.atcocode}/live.json?app_id=${CONFIG.TRANSPORT_APP_ID}&app_key=${CONFIG.TRANSPORT_APP_KEY}&group=route&limit=5`;
    const liveResp = await fetch(liveUrl);
    const liveData = await liveResp.json();

    let html = `
      <div class="bg-green-50 border border-green-200 rounded-lg p-3">
        <h3 class="font-semibold text-green-900 mb-2">${stop.name}</h3>
    `;

    if (liveData.departures) {
      let idx = 0;

      Object.values(liveData.departures).slice(0, 5).forEach(buses => {
        buses.slice(0, 1).forEach(bus => {
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
          const statusColor = isDelayed ? 'text-red-600' : 'text-green-600';
          const uniqueId = `bus-${stop.atcocode}-${idx++}`;

          html += `
            <div class="bg-white rounded-lg mb-2 border border-gray-200 cursor-pointer hover:shadow-md transition-shadow"
                 onclick="app.toggleDetails('${uniqueId}')">
              <div class="p-3">
                <div class="flex justify-between items-start mb-1">
                  <div>
                    <div class="font-semibold text-gray-800">${bus.line_name} → ${bus.direction}</div>
                    <div class="text-xs text-gray-500">${bus.operator_name || ''}</div>
                  </div>
                  <div class="text-right">
                    <div class="text-lg font-bold text-gray-800">${expected}</div>
                    <div class="text-xs font-semibold ${statusColor}">
                      ${statusText}${isDelayed ? ` (${delayMinutes} min late)` : ''}
                    </div>
                  </div>
                </div>
                <div class="text-xs text-gray-600 flex justify-between">
                  <span>${bus.source || 'Live data'}</span>
                  <span class="text-green-600">Tap for details</span>
                </div>
              </div>

              <div id="${uniqueId}" class="hidden border-t border-gray-200 bg-gray-50 p-3 text-xs">
                <div class="grid grid-cols-2 gap-2">
                  <div>
                    <div class="text-gray-500">Scheduled</div>
                    <div class="font-semibold">${aimed}</div>
                  </div>
                  <div>
                    <div class="text-gray-500">Expected</div>
                    <div class="font-semibold">${expected}</div>
                  </div>
                  <div>
                    <div class="text-gray-500">Operator</div>
                    <div class="font-semibold">${bus.operator_name || 'N/A'}</div>
                  </div>
                  <div>
                    <div class="text-gray-500">Tracking</div>
                    <div class="font-semibold">${bus.expected_departure_time ? 'Live' : 'Scheduled'}</div>
                  </div>
                </div>
              </div>
            </div>
          `;
        });
      });
    } else {
      html += '<div class="text-sm text-gray-500">No bus departures available</div>';
    }

    html += '</div>';
    return html;
  } catch {
    return '<div class="text-sm text-red-500 p-3 bg-red-50 rounded-lg">Error loading bus data</div>';
  }
}

 

  //calculate route using Google Directions API
  calculateRoute(origin, destination, travelMode) {
    return new Promise((resolve, reject) => {
      this.directionsService.route(
        { origin, destination, travelMode: google.maps.TravelMode[travelMode] },
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

  getWeatherEmoji(condition) {
    const emojis = {
      Clear: '☀️',
      Clouds: '☁️',
      Rain: '🌧️',
      Drizzle: '🌦️',
      Thunderstorm: '⛈️',
      Snow: '🌨️',
      Mist: '🌫️',
      Fog: '🌫️'
    };
    return emojis[condition] || '🌤️';
  }

  // show loading and error messages
  showLoading(elementId, message) { 
    document.getElementById(elementId).innerHTML = `
      <div class="flex items-center justify-center p-4">
        <div class="spinner mr-3"></div>
        <span class="text-gray-600">${message}</span>
      </div>
    `;
  }

  showError(elementId, message) {
    document.getElementById(elementId).innerHTML = `
      <div class="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700">
        <p class="font-semibold">⚠️ Error</p>
        <p class="text-sm mt-1">${message}</p>
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
