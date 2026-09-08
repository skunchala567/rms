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
    let map, useGoogle = false;
    const label = point => point === 'from' ? 'Pickup' : 'Destination';
    const nameField = point => form.elements[point === 'from' ? 'origin_name' : 'destination_name'];
    function save(point, lat, lng, name) {
      if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return;
      form.elements[point + '_lat'].value = lat.toFixed(7);
      form.elements[point + '_lng'].value = lng.toFixed(7);
      if (name) nameField(point).value = name.slice(0, 200);
      const selected = c.querySelector('#selected-' + point);
      selected.replaceChildren();
      const link = document.createElement('a');
      link.href = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(lat + ',' + lng)}`;
      link.target = '_blank'; link.rel = 'noopener';
      link.textContent = `${label(point)} selected: ${nameField(point).value || 'Map pin'} ↗`;
      selected.append(link);
      status.textContent = `${label(point)} selected. You can drag the pin to adjust it.`;
    }
    function place(point, lat, lng, name) {
      save(point, lat, lng, name);
      if (useGoogle) {
        const position = { lat, lng };
        if (markers[point]) markers[point].position = position;
        else {
          const pin = new google.maps.marker.PinElement({ glyphText: point === 'from' ? 'A' : 'B' });
          const marker = new google.maps.marker.AdvancedMarkerElement({ map, position, title: label(point), gmpDraggable: true });
          marker.append(pin); markers[point] = marker;
          marker.addListener('dragend', e => save(point, e.latLng.lat(), e.latLng.lng()));
        }
      } else {
        if (markers[point]) markers[point].setLatLng([lat, lng]);
        else {
          markers[point] = L.marker([lat, lng], { draggable: true, icon: L.divIcon({ className: 'transport-pin', html: point === 'from' ? 'A' : 'B', iconSize: [30, 30], iconAnchor: [15, 30] }) }).addTo(map);
          markers[point].on('dragend', () => { const p = markers[point].getLatLng().wrap(); save(point, p.lat, p.lng); });
        }
      }
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
        map.addListener('click', e => { if (e.latLng) place(form.elements.map_point.value, e.latLng.lat(), e.latLng.lng()); });
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
              place(point, lat, lng, p.formattedAddress || p.displayName); focus(lat, lng);
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
        map.on('click', e => place(form.elements.map_point.value, e.latlng.lat, e.latlng.wrap().lng));
      }
      c.querySelector('#locate-me').onclick = () => {
        const point = form.elements.map_point.value;
        if (!navigator.geolocation) { status.textContent = 'Location is unavailable. Select your points on the map.'; return; }
        navigator.geolocation.getCurrentPosition(p => { if (!container.isConnected) return; place(point, p.coords.latitude, p.coords.longitude); focus(p.coords.latitude, p.coords.longitude); }, () => { status.textContent = 'Location unavailable or permission denied. Select your points on the map.'; }, { timeout: 10000 });
      };
    } catch (e) { status.textContent = e.message; }
  }
  window.TransportLocationPicker = { mount };
})();
