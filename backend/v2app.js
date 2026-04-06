class UrbanNavApp {
  constructor() {
    this.map = null;
    this.directionsService = null;
    this.directionsRenderer = null;

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
      zoom: 12
    });

    this.directionsService = new google.maps.DirectionsService();
    this.directionsRenderer = new google.maps.DirectionsRenderer({
      map: this.map
    });

    new google.maps.places.Autocomplete(document.getElementById('fromInput'));
    new google.maps.places.Autocomplete(document.getElementById('toInput'));
  }

  initEventListeners() {
    document.getElementById('findRouteBtn')
      .addEventListener('click', () => this.findRoute());
  }

  async findRoute() {
    const from = document.getElementById('fromInput').value;
    const to = document.getElementById('toInput').value;

    if (!from || !to) {
      alert("Enter both locations");
      return;
    }

    const request = {
      origin: from,
      destination: to,
      travelMode: 'DRIVING'
    };

    this.directionsService.route(request, (result, status) => {
      if (status === 'OK') {
        this.directionsRenderer.setDirections(result);
      }
    });
  }
}

// Trim input and validate properly
const from = document.getElementById('fromInput').value.trim();
const to = document.getElementById('toInput').value.trim();

if (!from || !to) {
  alert("Please enter both a start location and destination.");
  return;
}

transportButtons.forEach(button => {
  button.addEventListener("click", () => {

    transportButtons.forEach(btn => btn.classList.remove("active"));
    button.classList.add("active");

    selectedMode = button.dataset.mode;
  });
});

routeDetails.innerHTML = `
  <h2>Route Details</h2>
  <p><strong>From:</strong> ${from}</p>
  <p><strong>To:</strong> ${to}</p>
  <p><strong>Mode:</strong> ${selectedMode}</p>
`;

const app = new UrbanNavApp();
