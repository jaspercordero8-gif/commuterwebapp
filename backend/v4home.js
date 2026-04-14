

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

    // Login button — go straight to app if already logged in
    document.getElementById('loginBtn').addEventListener('click', function() {
      var u = sessionStorage.getItem('urbannav_user');
      if (u) {
        window.location.href = 'index.html';
      } else {
        document.getElementById('authModal').style.display = 'flex';
        switchTab('login');
      }
    });

    function closeModal() {
      document.getElementById('authModal').style.display = 'none';
      document.getElementById('authError').textContent   = '';
    }

    function switchTab(tab) {
      document.getElementById('loginForm').style.display    = tab === 'login'    ? 'block' : 'none';
      document.getElementById('registerForm').style.display = tab === 'register' ? 'block' : 'none';
      document.getElementById('tabLogin').classList.toggle('auth-tab-active',    tab === 'login');
      document.getElementById('tabRegister').classList.toggle('auth-tab-active', tab === 'register');
      document.getElementById('authError').textContent = '';
    }

    async function submitLogin() {
      var email = document.getElementById('loginEmail').value.trim();
      var pass  = document.getElementById('loginPassword').value;
      var errEl = document.getElementById('authError');
      errEl.textContent = '';
      if (!email || !pass) { errEl.textContent = 'Please fill in all fields'; return; }
      try {
        var resp = await fetch('login.php', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: email, password: pass })
        });
        var raw = await resp.text();
        var data;
        try { data = JSON.parse(raw); }
        catch(e) { errEl.textContent = 'Server error — check MAMP is running'; return; }
        if (data.success) {
          sessionStorage.setItem('urbannav_user', JSON.stringify(data));
          closeModal();
          // Update nav to show name + logout button
          if (typeof homeUpdateAuthUI === 'function') homeUpdateAuthUI();
        } else {
          errEl.textContent = data.error || 'Login failed';
        }
      } catch(e) {
        errEl.textContent = 'Cannot reach server — are you on http://localhost:8888?';
      }
    }

    async function submitRegister() {
      var fn    = document.getElementById('regFirst').value.trim();
      var ln    = document.getElementById('regLast').value.trim();
      var em    = document.getElementById('regEmail').value.trim();
      var pw    = document.getElementById('regPassword').value;
      var errEl = document.getElementById('authError');
      errEl.textContent = '';
      if (!fn || !ln || !em || !pw) { errEl.textContent = 'Please fill in all fields'; return; }
      try {
        var resp = await fetch('register.php', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ first_name: fn, last_name: ln, email: em, password: pw })
        });
        var raw = await resp.text();
        var data;
        try { data = JSON.parse(raw); }
        catch(e) { errEl.textContent = 'Server error — check MAMP is running'; return; }
        if (data.success) {
          sessionStorage.setItem('urbannav_user', JSON.stringify(data));
          closeModal();
          // Update nav to show name + logout button
          if (typeof homeUpdateAuthUI === 'function') homeUpdateAuthUI();
        } else {
          errEl.textContent = data.error || 'Registration failed';
        }
      } catch(e) {
        errEl.textContent = 'Cannot reach server — are you on http://localhost:8888?';
      }
    }

    // Restore login state on page load
    window.addEventListener('DOMContentLoaded', function() {
      // homeUpdateAuthUI() handles this — defined in the inline script in home.html
      // This fallback covers the case where the inline script hasn't run yet
      var u = sessionStorage.getItem('urbannav_user');
      if (u && typeof homeUpdateAuthUI !== 'function') {
        document.getElementById('loginBtn').textContent = JSON.parse(u).first_name;
      }
    });
