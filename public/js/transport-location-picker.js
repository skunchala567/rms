/* Google Places selection with Google Maps; pin selection remains available without a key. */
(() => {
  let googlePromise, leafletPromise;
  function googleMaps(key) {
    if (window.google?.maps?.importLibrary) return Promise.resolve();
    if (!googlePromise) googlePromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      const timer = setTimeout(() => reject(new Error('Google Maps did not load. Please refresh and try again.')), 15000);
      window.transportMapsReady = () => { clearTimeout(timer); resolve(); };
      window.gm_authFailure = () => { clearTimeout(timer); reject(new Error('Google Maps search is unavailable. Please contact the transport team.')); };
      script.onerror = () => { clearTimeout(timer); reject(new Error('Google Maps could not load. Check your connection.')); };
      script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&loading=async&callback=transportMapsReady&v=weekly`;
      document.head.append(script);
    });
    return googlePromise;
  }
  function leaflet() {
    if (window.L) return Promise.resolve();
    if (!leafletPromise) leafletPromise = new Promise((resolve, reject) => {
      const css = document.createElement('link'); css.rel = 'stylesheet'; css.href = '/vendor/leaflet/leaflet.css'; document.head.append(css);
      const script = document.createElement('script'); script.src = '/vendor/leaflet/leaflet.js'; script.onload = resolve;
      script.onerror = () => { leafletPromise = null; reject(new Error('Map could not load. Please refresh and try again.')); };
      document.head.append(script);
    });
    return leafletPromise;
  }
  async function mount(c, form) {
    const status = c.querySelector('#map-status');
    const help = c.querySelector('#location-search-help');
    const container = c.querySelector('#transport-map');
    const markers = {};
    const locationLookups = {};
    const accuracyAreas = {};
    let map, useGoogle = false;
    let activePoint = 'from';
    for (const point of ['from', 'to']) {
      const host = c.querySelector('#search-host-' + point);
      const activate = () => { activePoint = point; };
      host.addEventListener('focusin', activate);
      host.addEventListener('pointerdown', activate);
    }
    const label = point => point === 'from' ? 'Pickup' : 'Destination';
    const nameField = point => form.elements[point === 'from' ? 'origin_name' : 'destination_name'];
    // Listings show the name the requestor typed, so a map pick only fills a field the requestor
    // has not written in; the precise position stays reachable through the map link.
    const typed = { from: false, to: false };
    for (const point of ['from', 'to']) nameField(point).addEventListener('input', () => { typed[point] = true; });
    function save(point, lat, lng, name) {
      if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return;
      form.elements[point + '_lat'].value = lat.toFixed(7);
      form.elements[point + '_lng'].value = lng.toFixed(7);
      if (name && !typed[point]) nameField(point).value = name.slice(0, 200);
      const selected = c.querySelector('#selected-' + point);
      selected.replaceChildren();
      const link = document.createElement('a');
      link.href = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(lat + ',' + lng)}`;
      link.target = '_blank'; link.rel = 'noopener';
      link.textContent = `${label(point)} selected: ${nameField(point).value || 'Map pin'} ↗`;
      selected.append(link);
      status.textContent = `${label(point)} selected. You can drag the pin to adjust it.`;
    }
    function place(point, lat, lng, name, fromDevice = false) {
      if (!fromDevice) {
        locationLookups[point]?.();
        if (accuracyAreas[point]) {
          if (useGoogle) accuracyAreas[point].setMap(null); else accuracyAreas[point].remove();
          delete accuracyAreas[point];
        }
      }
      activePoint = point;
      if (useGoogle) {
        const position = { lat, lng };
        if (markers[point]) markers[point].position = position;
        else {
          const pin = new google.maps.marker.PinElement({ glyphText: point === 'from' ? 'A' : 'B', background: point === 'from' ? '#24583d' : '#215ab5', glyphColor: '#fff', borderColor: '#fff', scale: 1.3 });
          const marker = new google.maps.marker.AdvancedMarkerElement({ map, position, title: label(point), gmpDraggable: true, zIndex: 1000 });
          marker.append(pin); markers[point] = marker;
          marker.addListener('dragend', e => place(point, e.latLng.lat(), e.latLng.lng()));
        }
      } else {
        if (markers[point]) markers[point].setLatLng([lat, lng]);
        else {
          markers[point] = L.marker([lat, lng], { draggable: true, icon: L.divIcon({ className: 'transport-pin', html: point === 'from' ? 'A' : 'B', iconSize: [30, 30], iconAnchor: [15, 30] }) }).addTo(map);
          markers[point].on('dragend', () => { const p = markers[point].getLatLng().wrap(); place(point, p.lat, p.lng); });
        }
      }
      save(point, lat, lng, name);
    }
    const focus = (lat, lng) => useGoogle ? (map.setCenter({ lat, lng }), map.setZoom(16)) : map.setView([lat, lng], 16);
    c.querySelectorAll('[data-google-search]').forEach(button => {
      const point = button.dataset.googleSearch;
      const input = c.querySelector('#search-' + point);
      const search = () => {
        const query = input.value.trim();
        if (!query) { input.focus(); help.textContent = 'Enter a place, address or landmark to search.'; return; }
        window.open(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`, '_blank', 'noopener');
        help.textContent = 'After finding the place in Google Maps, select its position on the map below. Opening a search does not select a location.';
      };
      button.onclick = search;
      input.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); search(); } };
    });
    try {
      const config = await fetch('/api/maps-config', { cache: 'no-store' }).then(r => { if (!r.ok) throw new Error('Map configuration unavailable. Please refresh.'); return r.json(); });
      if (!container.isConnected) return;
      if (config.browserKey) {
        await googleMaps(config.browserKey);
        const [{ Map }, { PlaceAutocompleteElement }] = await Promise.all([google.maps.importLibrary('maps'), google.maps.importLibrary('places'), google.maps.importLibrary('marker')]);
        if (!container.isConnected) return;
        useGoogle = true;
        map = new Map(container, { center: { lat: 17.385, lng: 78.4867 }, zoom: 11, mapId: 'DEMO_MAP_ID', streetViewControl: false, mapTypeControl: false });
        map.addListener('click', e => { if (e.latLng) place(activePoint, e.latLng.lat(), e.latLng.lng()); });
        help.textContent = 'Choose a Google Maps suggestion to select the location automatically.';
        for (const point of ['from', 'to']) {
          const widget = new PlaceAutocompleteElement();
          widget.id = 'search-' + point; widget.setAttribute('aria-label', `Search ${label(point).toLowerCase()} in Google Maps`);
          widget.placeholder = 'Search a place, address or landmark';
          c.querySelector('#search-host-' + point).replaceChildren(widget);
          let selection = 0;
          widget.addEventListener('gmp-select', async ({ placePrediction }) => {
            const current = ++selection;
            try {
              const p = placePrediction.toPlace();
              await p.fetchFields({ fields: ['displayName', 'formattedAddress', 'location'] });
              if (current !== selection || !container.isConnected) return;
              if (!p.location) throw new Error('This place has no map location. Choose another result.');
              const lat = p.location.lat(), lng = p.location.lng();
              place(point, lat, lng, p.displayName || p.formattedAddress); focus(lat, lng);
            } catch (e) { status.textContent = 'Could not select this location. Please choose a search result again or place a pin on the map.'; }
          });
          widget.addEventListener('gmp-error', () => { help.textContent = 'Location search is unavailable. Select your points on the map.'; });
        }
      } else {
        help.textContent = 'Search opens Google Maps in a new tab. Select the matching pickup and destination on the map below.';
        await leaflet();
        if (!container.isConnected) return;
        map = L.map(container).setView([17.385, 78.4867], 11);
        L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' }).on('tileerror', () => { status.textContent = 'Map tiles could not load. Check your connection and refresh.'; }).addTo(map);
        map.on('click', e => place(activePoint, e.latlng.lat, e.latlng.wrap().lng));
      }
      c.querySelectorAll('[data-locate]').forEach(button => {
        button.disabled = false;
        button.onclick = () => {
          const point = button.dataset.locate;
          const selected = c.querySelector('#selected-' + point);
          const report = message => { selected.textContent = message; status.textContent = message; };
          activePoint = point;
          if (!window.isSecureContext) { report('Current location requires HTTPS. Please select a location using search or the map.'); return; }
          if (!navigator.geolocation) { report('Location is unavailable. Select a location using search or the map.'); return; }
          button.disabled = true; button.textContent = 'Locating…';
          report(`Finding your location for ${label(point).toLowerCase()}…`);
          const done = () => { button.disabled = false; button.textContent = 'Use my location'; };
          locationLookups[point]?.();
          let watchId, timer, finished = false, bestAccuracy = Infinity, received = false;
          const stop = () => {
            if (finished) return;
            finished = true;
            if (watchId !== undefined) navigator.geolocation.clearWatch(watchId);
            clearTimeout(timer); done();
            delete locationLookups[point];
          };
          locationLookups[point] = stop;
          const accuracyMessage = () => `${label(point)} uses your device's current location (accuracy approximately ${Math.round(bestAccuracy)} m). You can drag the pin to refine it.`;
          timer = setTimeout(() => {
            stop();
            if (!container.isConnected) return;
            if (received) status.textContent = accuracyMessage();
            else report('Your device has not returned a location. Check that device Location Services and browser location access are enabled, then try again.');
          }, 20000);
          watchId = navigator.geolocation.watchPosition(p => {
            if (finished) return;
            if (!container.isConnected) { stop(); return; }
            const { latitude, longitude, accuracy } = p.coords;
            if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || !Number.isFinite(accuracy)) return;
            if (accuracy >= bestAccuracy) return;
            bestAccuracy = accuracy;
            try {
              place(point, latitude, longitude, undefined, true);
              focus(latitude, longitude);
              const color = point === 'from' ? '#24583d' : '#215ab5';
              if (useGoogle) {
                markers[point].zIndex = Date.now();
                if (accuracyAreas[point]) accuracyAreas[point].setMap(null);
                accuracyAreas[point] = new google.maps.Circle({ map, center: { lat: latitude, lng: longitude }, radius: accuracy, fillColor: color, fillOpacity: 0.12, strokeColor: color, strokeOpacity: 0.4, strokeWeight: 1, clickable: false });
              } else {
                map.invalidateSize(); markers[point].setZIndexOffset(1000);
                accuracyAreas[point]?.remove();
                accuracyAreas[point] = L.circle([latitude, longitude], { radius: accuracy, color, fillOpacity: 0.12, weight: 1, interactive: false }).addTo(map);
              }
              if (!received) container.scrollIntoView({ behavior: 'smooth', block: 'center' });
              received = true;
              status.textContent = accuracyMessage() + (accuracy > 50 ? ' Improving accuracy…' : '');
              if (accuracy <= 50) stop();
            } catch (error) { stop(); report('Could not display your location pin. Please try again or select a place using search.'); }
          }, error => {
            if (finished) return;
            stop();
            if (!container.isConnected) return;
            if (received) { status.textContent = accuracyMessage(); return; }
            report(error.code === 1 ? 'Location permission denied. Enable Location Services on your device and allow location access for this site in your browser, then try again.' : error.code === 3 ? 'Finding your location timed out. Check device Location Services, then try again.' : 'Your device could not determine its location. Enable device Location Services and Wi-Fi or GPS, then try again.');
          }, { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 });
        };
      });
    } catch (e) { status.textContent = e.message; }
  }
  window.TransportLocationPicker = { mount };
})();
