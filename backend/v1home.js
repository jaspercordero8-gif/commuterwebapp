// Google Maps Places autocomplete
    var _s = document.createElement('script');
    _s.src = 'https://maps.googleapis.com/maps/api/js?key=' + CONFIG.GOOGLE_MAPS_KEY + '&libraries=places&callback=initAC';
    _s.async = true; _s.defer = true;
    document.head.appendChild(_s);
    function initAC() {
      new google.maps.places.Autocomplete(document.getElementById('homeFrom'));
      new google.maps.places.Autocomplete(document.getElementById('homeTo'));
    }

    // Dark mode — saved to localStorage so it carries over to index.html
    var html  = document.documentElement;
    var saved = localStorage.getItem('urbannav_theme');
    if (saved) html.setAttribute('data-theme', saved);

    document.getElementById('nightBtn').addEventListener('click', function() {
      var next = html.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
      html.setAttribute('data-theme', next);
      localStorage.setItem('urbannav_theme', next);
    });

    // GO button — sends from/to/time as URL params to index.html
    document.getElementById('goBtn').addEventListener('click', goToApp);
    document.addEventListener('keydown', function(e) {
      if (e.key === 'Enter') goToApp();
    });

    function goToApp() {
      var from  = document.getElementById('homeFrom').value.trim();
      var to    = document.getElementById('homeTo').value.trim();
      var time  = document.getElementById('homeTime').value;
      var errEl = document.getElementById('homeError');
      if (!from) { errEl.textContent = 'Please enter a start location'; return; }
      if (!to)   { errEl.textContent = 'Please enter a destination';    return; }
      errEl.textContent = '';
      var p = new URLSearchParams({ from: from, to: to });
      if (time) p.set('time', time);
      window.location.href = 'index.html?' + p.toString();
    }
    