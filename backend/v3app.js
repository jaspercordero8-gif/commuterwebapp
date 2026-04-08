//handles map, routing, weather, and live transport data

class UrbanNavApp {
  constructor() {
    this.map = null;
    this.directionsService = null;
    this.directionsRenderer = null;
    this.destinationLatLng = null;
    this.currentRoute = null;
    this.selectedMode = null;

    this.waitForGoogleMaps();
  }

  //wait for Google Maps API to load
  waitForGoogleMaps() {
    if (typeof google !== 'undefined' && google.maps) {
      this.initMap();
      this.initEventListeners();
    } else {
      setTimeout(() => this.waitForGoogleMaps(), 100);
    }
  }

  //initialize the map
  initMap() {
    this.map = new google.maps.Map(document.getElementById('map'), {
      center: CONFIG.DEFAULT_CENTER,
      zoom: 12,
      styles: [
        {
          featureType: "poi",
          elementType: "labels",
          stylers: [{ visibility: "off" }]
        }
      ]
    });

    this.directionsService = new google.maps.DirectionsService();
    this.directionsRenderer = new google.maps.DirectionsRenderer({
      map: this.map,
      suppressMarkers: false
    });

    new google.maps.places.Autocomplete(document.getElementById('fromInput'));
    new google.maps.places.Autocomplete(document.getElementById('toInput'));
  }

  initEventListeners() {
    document.getElementById('findRouteBtn').addEventListener('click', () => this.findRoute());

    const toggleBtn = document.getElementById('toggleSidebar');
    if (toggleBtn) {
      toggleBtn.addEventListener('click', () => this.toggleSidebar());
    }

    const closeBtn = document.getElementById('closeSidebar');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => this.toggleSidebar());
    }

    ['fromInput', 'toInput'].forEach(id => {
      const el = document.getElementById(id);
      if (el) {
        el.addEventListener('keypress', (e) => {
          if (e.key === 'Enter') this.findRoute();
        });
      }
    });
  }

  toggleSidebar() {
    const sidebar = document.getElementById('sidebar');
    if (sidebar) {
      sidebar.classList.toggle('hidden-mobile');
    }
  }

  //find route
  async findRoute() {
    const from = document.getElementById('fromInput').value;
    const to = document.getElementById('toInput').value;

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

      document.getElementById('transportModes').classList.remove('hidden');
      document.getElementById('routeDetails').classList.remove('hidden');
      document.getElementById('alertsSection').classList.remove('hidden');
      document.getElementById('weatherSection').classList.remove('hidden');

      document.getElementById('routeInfo').innerHTML = `
        <div>
          <p>📍 Destination found!</p>
          <p>Select a transport mode to continue</p>
        </div>
      `;

      await this.loadWeather();

    } catch (error) {
      this.showError('routeInfo', error.message);
    }
  }

  // FIXED: event passed in
  async selectMode(mode, event) {
    this.selectedMode = mode;

    document.querySelectorAll('.mode-btn').forEach(btn => {
      btn.classList.remove('active');
    });

    if (event) event.target.classList.add('active');

    this.showLoading('routeInfo', 'Calculating route...');

    try {
      const from = document.getElementById('fromInput').value;
      const to = document.getElementById('toInput').value;

      const result = await this.calculateRoute(from, to, mode);
      this.currentRoute = result;

      this.directionsRenderer.setDirections(result);
      this.displayRouteDetails(result, mode);

      document.getElementById('environmentSection').classList.remove('hidden');
      this.displayEnvironmentalImpact(result, mode);

    } catch (error) {
      this.showError('routeInfo', error.message);
    }
  }

  // FIXED: missing function
  geocodeAddress(geocoder, address) {
    return new Promise((resolve, reject) => {
      geocoder.geocode({ address }, (results, status) => {
        if (status === 'OK') resolve(results[0]);
        else reject(new Error('Geocoding failed: ' + status));
      });
    });
  }

  // FIXED: missing helper functions
  showLoading(id, message) {
    document.getElementById(id).innerHTML = `<p>${message}</p>`;
  }

  showError(id, message) {
    document.getElementById(id).innerHTML = `<p style="color:red;">${message}</p>`;
  }

  // FIXED: missing toggleDetails
  toggleDetails(id) {
    const el = document.getElementById(id);
    if (el) el.classList.toggle('hidden');
  }
}

// FIXED: missing app instance
const app = new UrbanNavApp();
