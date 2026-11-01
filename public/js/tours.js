'use strict';

/**
 * The route page's map. MapLibre + OpenStreetMap raster tiles load only when a route page is opened; without
 * JavaScript, the SVG map and every stop are already in the page. Nothing here fetches a user URL.
 */
(function () {
    function initMap() {
        var wrap = document.getElementById('tr-map');
        var mount = document.getElementById('tr-maplibre');
        if (!wrap || !mount || !window.maplibregl) return;
        var stops = [];
        try { stops = JSON.parse(wrap.getAttribute('data-stops') || '[]'); } catch (e) { stops = []; }
        if (!Array.isArray(stops) || stops.length < 2) return;
        var lats = stops.map(function (s) { return Number(s.lat); }).filter(Number.isFinite);
        var lons = stops.map(function (s) { return Number(s.lon); }).filter(Number.isFinite);
        if (!lats.length || !lons.length) return;
        var center = [(Math.min.apply(null, lons) + Math.max.apply(null, lons)) / 2, (Math.min.apply(null, lats) + Math.max.apply(null, lats)) / 2];
        mount.hidden = false;
        var map;
        try {
            map = new window.maplibregl.Map({
                container: mount,
                style: {
                    version: 8,
                    sources: { osm: { type: 'raster', tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'], tileSize: 256, maxzoom: 19, attribution: '© OpenStreetMap contributors' } },
                    layers: [{ id: 'osm', type: 'raster', source: 'osm' }],
                },
                center: center,
                zoom: 13,
                attributionControl: true,
            });
        } catch (e) { mount.hidden = true; return; }
        map.addControl(new window.maplibregl.NavigationControl({ showCompass: false }), 'top-right');
        var bounds = new window.maplibregl.LngLatBounds();
        stops.forEach(function (s) {
            var lat = Number(s.lat); var lon = Number(s.lon);
            if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
            var el = document.createElement('div');
            el.className = 'tr-map-pin';
            el.textContent = String(s.n || '');
            new window.maplibregl.Marker({ element: el }).setLngLat([lon, lat]).setPopup(new window.maplibregl.Popup({ offset: 18 }).setText(String(s.title || ''))).addTo(map);
            bounds.extend([lon, lat]);
        });
        try { map.fitBounds(bounds, { padding: 42, maxZoom: 15, duration: 0 }); } catch (e) { /* the centre is set */ }
        map.on('load', function () {
            // The walk itself: a dashed line through the stops in order, under the numbered pins (2026-11-01).
            var coords = stops.map(function (s) { return [Number(s.lon), Number(s.lat)]; }).filter(function (c) { return Number.isFinite(c[0]) && Number.isFinite(c[1]); });
            if (coords.length > 1) {
                try {
                    var accent = (getComputedStyle(document.documentElement).getPropertyValue('--room-accent') || '').trim() || '#F98942';
                    map.addSource('tr-walk', { type: 'geojson', data: { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: coords } } });
                    map.addLayer({ id: 'tr-walk', type: 'line', source: 'tr-walk', layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': accent, 'line-width': 4, 'line-opacity': 0.85, 'line-dasharray': [1.2, 1.6] } });
                } catch (e) { /* the pins alone still show the route */ }
            }
            var fallback = document.getElementById('tr-map-fallback');
            if (fallback) fallback.classList.add('tr-map-fallback-out');
        });
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initMap);
    else initMap();
}());
