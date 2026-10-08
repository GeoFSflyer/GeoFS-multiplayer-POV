// ==UserScript==
// @name         GeoFS Multiplayer Spectator POV
// @namespace    arena.geofs.multiplayer-spectator
// @version      1.0.0
// @description  Watch another GeoFS multiplayer aircraft from selectable observer views.
// @match        https://www.geo-fs.com/*
// @match        https://geo-fs.com/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(() => {
    "use strict";

    const VERSION = "1.0.0";
    const GLOBAL_KEY = "__geofsMultiplayerSpectatorPOV";
    const FRAME_CALLBACK_NAME = "geofs-multiplayer-spectator-pov";
    const EARTH_METERS_PER_DEGREE = 111319.49079327358;
    const DEG_TO_RAD = Math.PI / 180;
    const RAD_TO_DEG = 180 / Math.PI;

    if (window[GLOBAL_KEY]?.version === VERSION) return;

    const state = {
        version: VERSION,
        active: false,
        targetId: null,
        presetId: "rear",
        savedCamera: null,
        missingSince: 0,
        frameCallbackId: null,
        fallbackCamera: null,
        targets: new Map(),
        listElement: null,
        listObserver: null,
        bodyObserver: null,
        ui: null,
    };
    window[GLOBAL_KEY] = state;

    const PRESETS = {
        rear: { label: "Rear chase", back: 42, side: 0, up: 13 },
        front: { label: "Front view", back: -38, side: 0, up: 12 },
        left: { label: "Left side", back: 0, side: -16, up: 5 },
        right: { label: "Right side", back: 0, side: 16, up: 5 },
        overhead: { label: "Overhead", back: 0, side: 0, up: 65 },
        pilot: { label: "Pilot POV (approx.)", pilot: true },
    };

    function getGeoFS() {
        return window.geofs || null;
    }

    function getMultiplayer() {
        return window.multiplayer || null;
    }

    function isFiniteNumber(value) {
        return typeof value === "number" && Number.isFinite(value);
    }

    function validLLA(coords) {
        return Array.isArray(coords) &&
            coords.length >= 3 &&
            isFiniteNumber(Number(coords[0])) &&
            isFiniteNumber(Number(coords[1])) &&
            isFiniteNumber(Number(coords[2])) &&
            Math.abs(Number(coords[0])) <= 90 &&
            Math.abs(Number(coords[1])) <= 180;
    }

    function normalize360(angle) {
        return ((angle % 360) + 360) % 360;
    }

    function normalizeSigned(angle) {
        return ((angle + 180) % 360 + 360) % 360 - 180;
    }

    function makeUI() {
        if (state.ui || !document.body) return;

        const host = document.createElement("div");
        host.id = "geofs-mpsp-host";
        host.style.cssText = "position:fixed;top:112px;right:16px;z-index:2147483000;pointer-events:auto;";
        const shadow = host.attachShadow ? host.attachShadow({ mode: "open" }) : host;
        shadow.innerHTML = `
            <style>
                :host { all: initial; }
                * { box-sizing: border-box; }
                .card {
                    width: min(314px, calc(100vw - 24px));
                    color: #e8f2fb;
                    background: rgba(10, 20, 33, .96);
                    border: 1px solid rgba(129, 180, 220, .35);
                    border-radius: 13px;
                    box-shadow: 0 12px 34px rgba(0, 0, 0, .38);
                    font: 13px/1.4 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
                    overflow: hidden;
                    backdrop-filter: blur(10px);
                }
                .head {
                    display: flex; align-items: center; gap: 10px;
                    padding: 11px 12px; border-bottom: 1px solid rgba(143, 177, 205, .17);
                    background: linear-gradient(135deg, rgba(28, 57, 82, .96), rgba(15, 31, 49, .96));
                }
                .badge {
                    display: grid; place-items: center; flex: 0 0 30px; height: 30px;
                    border-radius: 9px; background: #54c8ff; color: #062038;
                    font-weight: 900; font-size: 10px; letter-spacing: .02em;
                }
                .title { min-width: 0; flex: 1; }
                .title strong { display: block; font-size: 12px; letter-spacing: .09em; }
                .title small { display: block; color: #9db6ca; font-size: 10px; }
                button, select { font: inherit; }
                button { cursor: pointer; }
                .collapse {
                    width: 28px; height: 28px; border-radius: 8px; border: 1px solid rgba(192, 217, 236, .2);
                    background: rgba(255, 255, 255, .06); color: #dceaf5; font-size: 18px; line-height: 1;
                }
                .body { padding: 12px; }
                label { display: block; margin: 0 0 5px; color: #a9c0d3; font-size: 10px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; }
                select {
                    width: 100%; min-height: 36px; margin: 0 0 11px; padding: 7px 9px;
                    border: 1px solid rgba(142, 181, 212, .3); border-radius: 8px;
                    background: #15283a; color: #edf6ff; outline: none;
                }
                select:focus { border-color: #58c9ff; box-shadow: 0 0 0 2px rgba(88, 201, 255, .16); }
                .actions { display: flex; gap: 8px; margin-top: 2px; }
                .action {
                    flex: 1; min-height: 35px; padding: 7px 10px; border-radius: 8px;
                    border: 1px solid rgba(155, 191, 218, .25); background: rgba(255,255,255,.07); color: #eaf5ff;
                    font-size: 11px; font-weight: 800; letter-spacing: .06em;
                }
                .action.primary { border-color: #54c8ff; background: #54c8ff; color: #062038; }
                .action:disabled { opacity: .4; cursor: not-allowed; }
                .status { min-height: 30px; margin-top: 10px; color: #b6c7d7; font-size: 11px; }
                .status[data-tone="ready"] { color: #95e0b8; }
                .status[data-tone="active"] { color: #76d4ff; }
                .status[data-tone="error"] { color: #ffb3aa; }
                .hint { display: block; margin-top: 5px; color: #8199ad; font-size: 10px; }
                .card.is-collapsed .body { display: none; }
                .card.is-collapsed .head { border-bottom: 0; }
                @media (max-width: 520px) {
                    :host { top: 64px !important; right: 8px !important; }
                }
            </style>
            <section class="card" aria-label="GeoFS multiplayer spectator">
                <header class="head">
                    <span class="badge">POV</span>
                    <div class="title"><strong>MULTIPLAYER SPECTATOR</strong><small>Watch — don't join or teleport</small></div>
                    <button class="collapse" type="button" aria-label="Collapse spectator panel" aria-expanded="true">−</button>
                </header>
                <div class="body">
                    <label for="mpsp-player">Other pilot</label>
                    <select id="mpsp-player" aria-label="Select a multiplayer pilot">
                        <option value="">Waiting for GeoFS multiplayer…</option>
                    </select>
                    <label for="mpsp-view">Camera view</label>
                    <select id="mpsp-view" aria-label="Select a camera view">
                        <option value="rear">Rear chase</option>
                        <option value="front">Front view</option>
                        <option value="left">Left side</option>
                        <option value="right">Right side</option>
                        <option value="overhead">Overhead</option>
                        <option value="pilot">Pilot POV (approx.)</option>
                    </select>
                    <div class="actions">
                        <button class="action primary" type="button" data-action="watch">WATCH PILOT</button>
                        <button class="action" type="button" data-action="stop" disabled>STOP</button>
                    </div>
                    <div class="status" role="status" aria-live="polite">Waiting for GeoFS to load…</div>
                    <small class="hint">Pilot POV is an estimate. GeoFS does not send another pilot’s live camera view.</small>
                </div>
            </section>
        `;
        document.body.appendChild(host);

        state.ui = {
            host,
            shadow,
            card: shadow.querySelector(".card"),
            player: shadow.querySelector("#mpsp-player"),
            view: shadow.querySelector("#mpsp-view"),
            watch: shadow.querySelector('[data-action="watch"]'),
            stop: shadow.querySelector('[data-action="stop"]'),
            status: shadow.querySelector(".status"),
            collapse: shadow.querySelector(".collapse"),
        };

        state.ui.view.value = state.presetId;
        state.ui.watch.addEventListener("click", () => {
            if (!state.ui.player.value) {
                setStatus("Select a pilot first, or use Watch beside a name in the multiplayer list.", "error");
                return;
            }
            startSpectating(state.ui.player.value, true);
        });
        state.ui.stop.addEventListener("click", () => stopSpectating("Spectating stopped. Your original camera is restored.", "ready"));
        state.ui.view.addEventListener("change", () => {
            state.presetId = PRESETS[state.ui.view.value] ? state.ui.view.value : "rear";
            if (state.active) {
                const pilot = getPilot(state.targetId);
                setStatus(`Watching ${displayName(pilot)} — ${PRESETS[state.presetId].label}.`, "active");
            }
        });
        state.ui.collapse.addEventListener("click", () => {
            const collapsed = state.ui.card.classList.toggle("is-collapsed");
            state.ui.collapse.textContent = collapsed ? "+" : "−";
            state.ui.collapse.setAttribute("aria-expanded", String(!collapsed));
            state.ui.collapse.setAttribute("aria-label", collapsed ? "Expand spectator panel" : "Collapse spectator panel");
        });
    }

    function setStatus(message, tone) {
        if (!state.ui) return;
        state.ui.status.textContent = message;
        state.ui.status.dataset.tone = tone || "";
        state.ui.stop.disabled = !state.active;
    }

    function displayName(pilot) {
        if (!pilot) return "pilot";
        const name = typeof pilot.callsign === "string" ? pilot.callsign.trim() : "";
        return name || `Pilot ${pilot.id || ""}`.trim();
    }

    function getPilot(id) {
        const mp = getMultiplayer();
        if (!mp || !mp.users || id == null) return null;
        return mp.users[String(id)] || Object.values(mp.users).find((pilot) => pilot && String(pilot.id) === String(id)) || null;
    }

    function collectPilots() {
        const mp = getMultiplayer();
        if (!mp || !mp.users) return [];
        const ownIds = new Set([String(mp.myId || ""), String(getGeoFS()?.userRecord?.id || "")]);
        return Object.values(mp.users)
            .filter((pilot) => {
                if (!pilot || pilot.isTraffic || pilot.lastUpdate?.ad) return false;
                const id = String(pilot.id == null ? "" : pilot.id);
                return id && !ownIds.has(id) && validLLA(pilot.lastUpdate?.co);
            })
            .map((pilot) => {
                const aircraftName = pilot.aircraftName || getGeoFS()?.aircraftList?.[pilot.aircraft]?.name || "Aircraft";
                return {
                    id: String(pilot.id),
                    pilot,
                    label: `${displayName(pilot)} — ${aircraftName}`,
                };
            })
            .sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: "base" }));
    }

    function refreshTargetOptions() {
        if (!state.ui) return [];
        const pilots = collectPilots();
        state.targets = new Map(pilots.map((entry) => [entry.id, entry.pilot]));
        const currentValue = state.ui.player.value;
        const keepId = state.active ? String(state.targetId) : currentValue;
        const nextSignature = pilots.map((entry) => `${entry.id}:${entry.label}`).join("\u001f");
        if (nextSignature !== state.targetSignature) {
            state.targetSignature = nextSignature;
            state.ui.player.replaceChildren();
            if (!pilots.length) {
                const option = document.createElement("option");
                option.value = "";
                option.textContent = "No other pilots reported yet";
                state.ui.player.appendChild(option);
            } else {
                const placeholder = document.createElement("option");
                placeholder.value = "";
                placeholder.textContent = "Choose a pilot…";
                state.ui.player.appendChild(placeholder);
                for (const entry of pilots) {
                    const option = document.createElement("option");
                    option.value = entry.id;
                    option.textContent = entry.label;
                    state.ui.player.appendChild(option);
                }
            }
        }
        if (keepId && pilots.some((entry) => entry.id === keepId)) state.ui.player.value = keepId;
        else if (!state.active) state.ui.player.value = "";
        return pilots;
    }

    function updateIdleStatus(pilots) {
        if (!state.ui || state.active) return;
        const geofs = getGeoFS();
        if (!geofs?.api?.setCameraPositionAndOrientation || !geofs?.camera?.cam) {
            setStatus("Waiting for the GeoFS camera to finish loading.", "");
        } else if (!getMultiplayer()?.users) {
            setStatus("Open GeoFS multiplayer to load other pilots.", "");
        } else if (pilots.length) {
            setStatus("Ready — choose a pilot, then press Watch.", "ready");
        } else {
            setStatus("No other player aircraft are currently reported.", "");
        }
    }

    function captureCamera() {
        const geofs = getGeoFS();
        const camera = geofs?.camera;
        const api = geofs?.api;
        if (!camera || !camera.cam || !api) return null;

        let lla = Array.isArray(camera.lla) ? camera.lla.slice(0, 3) : null;
        let hpr = Array.isArray(camera.htr) ? camera.htr.slice(0, 3) : [0, 0, 0];
        try {
            const actualLla = api.getCameraLla?.(camera.cam);
            if (validLLA(actualLla)) lla = actualLla.slice(0, 3);
        } catch (_) {}
        try {
            const cesiumCamera = camera.cam;
            if (isFiniteNumber(cesiumCamera.heading) && isFiniteNumber(cesiumCamera.pitch) && isFiniteNumber(cesiumCamera.roll)) {
                hpr = [cesiumCamera.heading * RAD_TO_DEG, cesiumCamera.pitch * RAD_TO_DEG, cesiumCamera.roll * RAD_TO_DEG];
            }
        } catch (_) {}
        if (!validLLA(lla)) return null;
        return { lla, hpr };
    }

    function startSpectating(id, expandPanel) {
        const geofs = getGeoFS();
        const api = geofs?.api;
        const pilot = getPilot(id);
        if (!pilot || !validLLA(pilot.lastUpdate?.co)) {
            setStatus("That pilot is no longer available. Refresh the multiplayer list and try again.", "error");
            return;
        }
        if (!geofs?.camera?.cam || typeof api?.setCameraPositionAndOrientation !== "function") {
            setStatus("GeoFS is still initializing its camera. Try again in a moment.", "error");
            return;
        }

        if (!state.active) {
            state.savedCamera = captureCamera();
            if (!state.savedCamera) {
                setStatus("Could not save the current camera, so spectating was not started.", "error");
                return;
            }
        }

        state.targetId = String(id);
        state.presetId = state.ui?.view?.value && PRESETS[state.ui.view.value] ? state.ui.view.value : state.presetId;
        state.active = true;
        state.missingSince = 0;
        if (state.ui) {
            state.ui.player.value = state.targetId;
            if (expandPanel) state.ui.card.classList.remove("is-collapsed");
            const preset = PRESETS[state.presetId] || PRESETS.rear;
            setStatus(`Watching ${displayName(pilot)} — ${preset.label}. Your aircraft is not moved.`, "active");
        }
    }

    function stopSpectating(message, tone) {
        if (!state.active && !state.savedCamera) return;
        state.active = false;
        state.targetId = null;
        state.missingSince = 0;

        const saved = state.savedCamera;
        state.savedCamera = null;
        const geofs = getGeoFS();
        const camera = geofs?.camera;
        const api = geofs?.api;
        if (saved && camera?.cam && typeof api?.setCameraPositionAndOrientation === "function") {
            try {
                api.setCameraPositionAndOrientation(camera.cam, saved.lla, saved.hpr);
                camera.lla = saved.lla.slice();
                camera.htr = saved.hpr.slice();
                camera.radianRoll = saved.hpr[2] * DEG_TO_RAD;
            } catch (error) {
                console.warn("[GeoFS Spectator] Could not restore the saved camera:", error);
            }
        }
        if (state.ui) setStatus(message || "Spectating stopped. Your original camera is restored.", tone || "ready");
    }

    function getRemoteCoordinates(pilot) {
        const update = pilot?.lastUpdate;
        if (!update || !validLLA(update.co)) return null;
        const base = update.co;
        const interpolated = Array.isArray(pilot.currentInterpolatedCoord) ? pilot.currentInterpolatedCoord : null;
        const result = new Array(6);
        for (let i = 0; i < 6; i++) {
            const candidate = interpolated && Number(interpolated[i]);
            result[i] = interpolated && Number.isFinite(candidate) ? candidate : Number(base[i]) || 0;
        }

        // The multiplayer packet includes velocity. Use a short, capped extrapolation
        // only when GeoFS has no per-frame interpolated position for this pilot.
        if (!interpolated && Array.isArray(update.ve) && Number.isFinite(Number(update.ti))) {
            const mp = getMultiplayer();
            const serverNow = typeof mp?.getServerTime === "function" ? mp.getServerTime() : Date.now();
            const ageMs = Math.max(0, Math.min(450, serverNow - Number(update.ti)));
            for (let i = 0; i < 6; i++) {
                const velocity = Number(update.ve[i]);
                if (Number.isFinite(velocity)) result[i] += velocity * ageMs;
            }
        }
        result[0] = Math.max(-90, Math.min(90, result[0]));
        result[1] = normalizeSigned(result[1]);
        result[3] = normalize360(result[3]);
        result[4] = normalizeSigned(result[4]);
        result[5] = normalizeSigned(result[5]);
        return result;
    }

    function offsetToLLA(origin, east, north, up) {
        const geofs = getGeoFS();
        const api = geofs?.api;
        if (typeof api?.xyz2lla === "function") {
            try {
                const delta = api.xyz2lla([east, north, up], origin);
                if (Array.isArray(delta) && delta.length >= 3 && delta.slice(0, 3).every((value) => Number.isFinite(Number(value)))) {
                    return [
                        Math.max(-90, Math.min(90, origin[0] + Number(delta[0]))),
                        normalizeSigned(origin[1] + Number(delta[1])),
                        origin[2] + Number(delta[2]),
                    ];
                }
            } catch (_) {}
        }

        // Approximate ENU fallback for runtimes that do not expose xyz2lla.
        const latitudeRad = origin[0] * DEG_TO_RAD;
        const northMetersPerDegree = EARTH_METERS_PER_DEGREE;
        const eastMetersPerDegree = Math.max(1, EARTH_METERS_PER_DEGREE * Math.cos(latitudeRad));
        return [
            Math.max(-90, Math.min(90, origin[0] + north / northMetersPerDegree)),
            normalizeSigned(origin[1] + east / eastMetersPerDegree),
            origin[2] + up,
        ];
    }

    function orientationLookingAt(target, cameraLla, overhead) {
        const geofs = getGeoFS();
        const lookAt = geofs?.utils?.lookAt;
        if (typeof lookAt === "function") {
            try {
                // This matches the direction conversion used by GeoFS's own follow camera.
                const result = lookAt(target, cameraLla, overhead ? [0, 1, 0] : [0, 0, 1]);
                if (Array.isArray(result) && result.length >= 2 && Number.isFinite(Number(result[0])) && Number.isFinite(Number(result[1]))) {
                    return [normalize360(Number(result[0])), normalize360(-Number(result[1])), 0];
                }
            } catch (_) {}
        }

        const dLat = (target[0] - cameraLla[0]) * DEG_TO_RAD;
        const dLon = (target[1] - cameraLla[1]) * DEG_TO_RAD;
        const midLat = ((target[0] + cameraLla[0]) / 2) * DEG_TO_RAD;
        const north = dLat * EARTH_METERS_PER_DEGREE;
        const east = dLon * EARTH_METERS_PER_DEGREE * Math.cos(midLat);
        const horizontal = Math.hypot(east, north);
        const heading = normalize360(Math.atan2(east, north) * RAD_TO_DEG);
        const pitch = Math.atan2(target[2] - cameraLla[2], Math.max(0.001, horizontal)) * RAD_TO_DEG;
        return [heading, pitch, 0];
    }

    function computeCameraView(coords, presetId) {
        const preset = PRESETS[presetId] || PRESETS.rear;
        const target = [coords[0], coords[1], coords[2]];
        const heading = Number.isFinite(coords[3]) ? coords[3] * DEG_TO_RAD : 0;
        const forwardEast = Math.sin(heading);
        const forwardNorth = Math.cos(heading);
        const rightEast = Math.cos(heading);
        const rightNorth = -Math.sin(heading);

        let cameraLla;
        let cameraHpr;
        if (preset.pilot) {
            // Approximate seat location and target attitude. The remote pilot's exact
            // cockpit camera and head look are not included in GeoFS multiplayer data.
            cameraLla = offsetToLLA(target, forwardEast * 2.2, forwardNorth * 2.2, 2.3);
            cameraHpr = [normalize360(coords[3]), Math.max(-85, Math.min(85, coords[4])), normalizeSigned(coords[5])];
        } else {
            const east = -forwardEast * preset.back + rightEast * preset.side;
            const north = -forwardNorth * preset.back + rightNorth * preset.side;
            cameraLla = offsetToLLA(target, east, north, preset.up);
            cameraHpr = orientationLookingAt(target, cameraLla, presetId === "overhead");
        }
        return { cameraLla, cameraHpr, target };
    }

    function updateSpectatorCamera() {
        if (!state.active) return;
        const geofs = getGeoFS();
        const camera = geofs?.camera;
        const api = geofs?.api;
        if (!camera?.cam || typeof api?.setCameraPositionAndOrientation !== "function") return;

        const pilot = getPilot(state.targetId);
        const coords = getRemoteCoordinates(pilot);
        if (!pilot || !coords) {
            if (!state.missingSince) state.missingSince = Date.now();
            if (Date.now() - state.missingSince > 2500) {
                stopSpectating("The selected pilot left or stopped sending position data. Camera restored.", "error");
            }
            return;
        }
        state.missingSince = 0;

        try {
            const view = computeCameraView(coords, state.presetId);
            api.setCameraPositionAndOrientation(camera.cam, view.cameraLla, view.cameraHpr);
            camera.lla = view.cameraLla.slice();
            camera.htr = view.cameraHpr.slice();
            camera.radianRoll = view.cameraHpr[2] * DEG_TO_RAD;
        } catch (error) {
            console.warn("[GeoFS Spectator] Camera update failed:", error);
            stopSpectating("Could not update the spectator camera. Your original camera was restored.", "error");
        }
    }

    function installCameraHook() {
        const geofs = getGeoFS();
        const api = geofs?.api;
        if (!api) return;

        // Run after GeoFS updates its own camera, so the simulator cannot overwrite
        // the spectator position later in the same frame.
        const camera = geofs.camera;
        if (camera && typeof camera.update === "function") {
            if (state.fallbackCamera?.camera === camera && camera.update === state.fallbackCamera.wrapped) return;
            const original = camera.update;
            const wrapped = function (...args) {
                const result = original.apply(this, args);
                updateSpectatorCamera();
                return result;
            };
            camera.update = wrapped;
            state.fallbackCamera = { camera, original, wrapped };
            if (state.frameCallbackId != null && typeof api.removeFrameCallback === "function") {
                try { api.removeFrameCallback(state.frameCallbackId, FRAME_CALLBACK_NAME); } catch (_) {}
                state.frameCallbackId = null;
            }
            return;
        }

        // Very early-load fallback: use GeoFS's public render callback until the
        // camera object exists. This path is replaced by the ordered camera hook above.
        if (state.frameCallbackId == null && typeof api.addFrameCallback === "function") {
            try {
                state.frameCallbackId = api.addFrameCallback(updateSpectatorCamera, FRAME_CALLBACK_NAME);
            } catch (_) {}
        }
    }

    function addRowButtonStyles() {
        if (document.querySelector("#geofs-mpsp-row-styles")) return;
        const style = document.createElement("style");
        style.id = "geofs-mpsp-row-styles";
        style.textContent = `
            .geofs-player-list .mpsp-row-watch {
                display:inline-block !important; float:right !important; margin:0 4px 0 8px !important;
                padding:2px 8px !important; border:1px solid rgba(73,191,250,.7) !important;
                border-radius:999px !important; background:#102b42 !important; color:#a9e4ff !important;
                font:700 10px/1.4 system-ui,sans-serif !important; letter-spacing:.03em !important;
                cursor:pointer !important; vertical-align:middle !important;
            }
            .geofs-player-list .mpsp-row-watch:hover { background:#17476a !important; color:#fff !important; }
        `;
        (document.head || document.documentElement).appendChild(style);
    }

    function scanPlayerList() {
        const list = document.querySelector(".geofs-player-list");
        if (!list) return;
        const mp = getMultiplayer();
        const myId = String(mp?.myId || getGeoFS()?.userRecord?.id || "");
        for (const row of list.querySelectorAll("li[data-player]")) {
            const id = String(row.getAttribute("data-player") || "");
            if (!id || id === myId || row.querySelector(":scope > .mpsp-row-watch")) continue;
            const button = document.createElement("button");
            button.type = "button";
            button.className = "mpsp-row-watch";
            button.textContent = "Watch";
            button.title = "Watch this pilot without joining or moving your aircraft";
            button.setAttribute("aria-label", `Watch ${row.textContent.trim()} from a spectator camera`);
            button.addEventListener("click", (event) => {
                event.preventDefault();
                event.stopPropagation();
                if (typeof event.stopImmediatePropagation === "function") event.stopImmediatePropagation();
                refreshTargetOptions();
                if (state.ui?.player) state.ui.player.value = id;
                startSpectating(id, true);
            });
            row.appendChild(button);
        }
    }

    function observePlayerList() {
        const list = document.querySelector(".geofs-player-list");
        if (!list || list === state.listElement) return;
        state.listObserver?.disconnect();
        state.listElement = list;
        state.listObserver = new MutationObserver(scanPlayerList);
        state.listObserver.observe(list, { childList: true, subtree: true });
        scanPlayerList();
    }

    function init() {
        makeUI();
        if (!state.ui) return;
        addRowButtonStyles();
        installCameraHook();
        observePlayerList();
        const pilots = refreshTargetOptions();
        updateIdleStatus(pilots);
    }

    init();
    state.bodyObserver = new MutationObserver(() => {
        if (!state.ui) makeUI();
        addRowButtonStyles();
        installCameraHook();
        observePlayerList();
    });
    if (document.documentElement) state.bodyObserver.observe(document.documentElement, { childList: true, subtree: true });
    window.setInterval(() => {
        init();
        const pilots = refreshTargetOptions();
        updateIdleStatus(pilots);
        scanPlayerList();
    }, 1000);

    // Small public controls are useful when debugging or binding a custom key.
    state.start = startSpectating;
    state.stop = () => stopSpectating("Spectating stopped. Your original camera is restored.", "ready");
})();
// ==UserScript==
// @name         GeoFS Multiplayer Spectator POV
// @namespace    arena.geofs.multiplayer-spectator
// @version      1.0.0
// @description  Watch another GeoFS multiplayer aircraft from selectable observer views.
// @match        https://www.geo-fs.com/*
// @match        https://geo-fs.com/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(() => {
    "use strict";

    const VERSION = "1.0.0";
    const GLOBAL_KEY = "__geofsMultiplayerSpectatorPOV";
    const FRAME_CALLBACK_NAME = "geofs-multiplayer-spectator-pov";
    const EARTH_METERS_PER_DEGREE = 111319.49079327358;
    const DEG_TO_RAD = Math.PI / 180;
    const RAD_TO_DEG = 180 / Math.PI;

    if (window[GLOBAL_KEY]?.version === VERSION) return;

    const state = {
        version: VERSION,
        active: false,
        targetId: null,
        presetId: "rear",
        savedCamera: null,
        missingSince: 0,
        frameCallbackId: null,
        fallbackCamera: null,
        targets: new Map(),
        listElement: null,
        listObserver: null,
        bodyObserver: null,
        ui: null,
    };
    window[GLOBAL_KEY] = state;

    const PRESETS = {
        rear: { label: "Rear chase", back: 42, side: 0, up: 13 },
        front: { label: "Front view", back: -38, side: 0, up: 12 },
        left: { label: "Left side", back: 0, side: -16, up: 5 },
        right: { label: "Right side", back: 0, side: 16, up: 5 },
        overhead: { label: "Overhead", back: 0, side: 0, up: 65 },
        pilot: { label: "Pilot POV (approx.)", pilot: true },
    };

    function getGeoFS() {
        return window.geofs || null;
    }

    function getMultiplayer() {
        return window.multiplayer || null;
    }

    function isFiniteNumber(value) {
        return typeof value === "number" && Number.isFinite(value);
    }

    function validLLA(coords) {
        return Array.isArray(coords) &&
            coords.length >= 3 &&
            isFiniteNumber(Number(coords[0])) &&
            isFiniteNumber(Number(coords[1])) &&
            isFiniteNumber(Number(coords[2])) &&
            Math.abs(Number(coords[0])) <= 90 &&
            Math.abs(Number(coords[1])) <= 180;
    }

    function normalize360(angle) {
        return ((angle % 360) + 360) % 360;
    }

    function normalizeSigned(angle) {
        return ((angle + 180) % 360 + 360) % 360 - 180;
    }

    function makeUI() {
        if (state.ui || !document.body) return;

        const host = document.createElement("div");
        host.id = "geofs-mpsp-host";
        host.style.cssText = "position:fixed;top:112px;right:16px;z-index:2147483000;pointer-events:auto;";
        const shadow = host.attachShadow ? host.attachShadow({ mode: "open" }) : host;
        shadow.innerHTML = `
            <style>
                :host { all: initial; }
                * { box-sizing: border-box; }
                .card {
                    width: min(314px, calc(100vw - 24px));
                    color: #e8f2fb;
                    background: rgba(10, 20, 33, .96);
                    border: 1px solid rgba(129, 180, 220, .35);
                    border-radius: 13px;
                    box-shadow: 0 12px 34px rgba(0, 0, 0, .38);
                    font: 13px/1.4 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
                    overflow: hidden;
                    backdrop-filter: blur(10px);
                }
                .head {
                    display: flex; align-items: center; gap: 10px;
                    padding: 11px 12px; border-bottom: 1px solid rgba(143, 177, 205, .17);
                    background: linear-gradient(135deg, rgba(28, 57, 82, .96), rgba(15, 31, 49, .96));
                }
                .badge {
                    display: grid; place-items: center; flex: 0 0 30px; height: 30px;
                    border-radius: 9px; background: #54c8ff; color: #062038;
                    font-weight: 900; font-size: 10px; letter-spacing: .02em;
                }
                .title { min-width: 0; flex: 1; }
                .title strong { display: block; font-size: 12px; letter-spacing: .09em; }
                .title small { display: block; color: #9db6ca; font-size: 10px; }
                button, select { font: inherit; }
                button { cursor: pointer; }
                .collapse {
                    width: 28px; height: 28px; border-radius: 8px; border: 1px solid rgba(192, 217, 236, .2);
                    background: rgba(255, 255, 255, .06); color: #dceaf5; font-size: 18px; line-height: 1;
                }
                .body { padding: 12px; }
                label { display: block; margin: 0 0 5px; color: #a9c0d3; font-size: 10px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; }
                select {
                    width: 100%; min-height: 36px; margin: 0 0 11px; padding: 7px 9px;
                    border: 1px solid rgba(142, 181, 212, .3); border-radius: 8px;
                    background: #15283a; color: #edf6ff; outline: none;
                }
                select:focus { border-color: #58c9ff; box-shadow: 0 0 0 2px rgba(88, 201, 255, .16); }
                .actions { display: flex; gap: 8px; margin-top: 2px; }
                .action {
                    flex: 1; min-height: 35px; padding: 7px 10px; border-radius: 8px;
                    border: 1px solid rgba(155, 191, 218, .25); background: rgba(255,255,255,.07); color: #eaf5ff;
                    font-size: 11px; font-weight: 800; letter-spacing: .06em;
                }
                .action.primary { border-color: #54c8ff; background: #54c8ff; color: #062038; }
                .action:disabled { opacity: .4; cursor: not-allowed; }
                .status { min-height: 30px; margin-top: 10px; color: #b6c7d7; font-size: 11px; }
                .status[data-tone="ready"] { color: #95e0b8; }
                .status[data-tone="active"] { color: #76d4ff; }
                .status[data-tone="error"] { color: #ffb3aa; }
                .hint { display: block; margin-top: 5px; color: #8199ad; font-size: 10px; }
                .card.is-collapsed .body { display: none; }
                .card.is-collapsed .head { border-bottom: 0; }
                @media (max-width: 520px) {
                    :host { top: 64px !important; right: 8px !important; }
                }
            </style>
            <section class="card" aria-label="GeoFS multiplayer spectator">
                <header class="head">
                    <span class="badge">POV</span>
                    <div class="title"><strong>MULTIPLAYER SPECTATOR</strong><small>Watch — don't join or teleport</small></div>
                    <button class="collapse" type="button" aria-label="Collapse spectator panel" aria-expanded="true">−</button>
                </header>
                <div class="body">
                    <label for="mpsp-player">Other pilot</label>
                    <select id="mpsp-player" aria-label="Select a multiplayer pilot">
                        <option value="">Waiting for GeoFS multiplayer…</option>
                    </select>
                    <label for="mpsp-view">Camera view</label>
                    <select id="mpsp-view" aria-label="Select a camera view">
                        <option value="rear">Rear chase</option>
                        <option value="front">Front view</option>
                        <option value="left">Left side</option>
                        <option value="right">Right side</option>
                        <option value="overhead">Overhead</option>
                        <option value="pilot">Pilot POV (approx.)</option>
                    </select>
                    <div class="actions">
                        <button class="action primary" type="button" data-action="watch">WATCH PILOT</button>
                        <button class="action" type="button" data-action="stop" disabled>STOP</button>
                    </div>
                    <div class="status" role="status" aria-live="polite">Waiting for GeoFS to load…</div>
                    <small class="hint">Pilot POV is an estimate. GeoFS does not send another pilot’s live camera view.</small>
                </div>
            </section>
        `;
        document.body.appendChild(host);

        state.ui = {
            host,
            shadow,
            card: shadow.querySelector(".card"),
            player: shadow.querySelector("#mpsp-player"),
            view: shadow.querySelector("#mpsp-view"),
            watch: shadow.querySelector('[data-action="watch"]'),
            stop: shadow.querySelector('[data-action="stop"]'),
            status: shadow.querySelector(".status"),
            collapse: shadow.querySelector(".collapse"),
        };

        state.ui.view.value = state.presetId;
        state.ui.watch.addEventListener("click", () => {
            if (!state.ui.player.value) {
                setStatus("Select a pilot first, or use Watch beside a name in the multiplayer list.", "error");
                return;
            }
            startSpectating(state.ui.player.value, true);
        });
        state.ui.stop.addEventListener("click", () => stopSpectating("Spectating stopped. Your original camera is restored.", "ready"));
        state.ui.view.addEventListener("change", () => {
            state.presetId = PRESETS[state.ui.view.value] ? state.ui.view.value : "rear";
            if (state.active) {
                const pilot = getPilot(state.targetId);
                setStatus(`Watching ${displayName(pilot)} — ${PRESETS[state.presetId].label}.`, "active");
            }
        });
        state.ui.collapse.addEventListener("click", () => {
            const collapsed = state.ui.card.classList.toggle("is-collapsed");
            state.ui.collapse.textContent = collapsed ? "+" : "−";
            state.ui.collapse.setAttribute("aria-expanded", String(!collapsed));
            state.ui.collapse.setAttribute("aria-label", collapsed ? "Expand spectator panel" : "Collapse spectator panel");
        });
    }

    function setStatus(message, tone) {
        if (!state.ui) return;
        state.ui.status.textContent = message;
        state.ui.status.dataset.tone = tone || "";
        state.ui.stop.disabled = !state.active;
    }

    function displayName(pilot) {
        if (!pilot) return "pilot";
        const name = typeof pilot.callsign === "string" ? pilot.callsign.trim() : "";
        return name || `Pilot ${pilot.id || ""}`.trim();
    }

    function getPilot(id) {
        const mp = getMultiplayer();
        if (!mp || !mp.users || id == null) return null;
        return mp.users[String(id)] || Object.values(mp.users).find((pilot) => pilot && String(pilot.id) === String(id)) || null;
    }

    function collectPilots() {
        const mp = getMultiplayer();
        if (!mp || !mp.users) return [];
        const ownIds = new Set([String(mp.myId || ""), String(getGeoFS()?.userRecord?.id || "")]);
        return Object.values(mp.users)
            .filter((pilot) => {
                if (!pilot || pilot.isTraffic || pilot.lastUpdate?.ad) return false;
                const id = String(pilot.id == null ? "" : pilot.id);
                return id && !ownIds.has(id) && validLLA(pilot.lastUpdate?.co);
            })
            .map((pilot) => {
                const aircraftName = pilot.aircraftName || getGeoFS()?.aircraftList?.[pilot.aircraft]?.name || "Aircraft";
                return {
                    id: String(pilot.id),
                    pilot,
                    label: `${displayName(pilot)} — ${aircraftName}`,
                };
            })
            .sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: "base" }));
    }

    function refreshTargetOptions() {
        if (!state.ui) return [];
        const pilots = collectPilots();
        state.targets = new Map(pilots.map((entry) => [entry.id, entry.pilot]));
        const currentValue = state.ui.player.value;
        const keepId = state.active ? String(state.targetId) : currentValue;
        const nextSignature = pilots.map((entry) => `${entry.id}:${entry.label}`).join("\u001f");
        if (nextSignature !== state.targetSignature) {
            state.targetSignature = nextSignature;
            state.ui.player.replaceChildren();
            if (!pilots.length) {
                const option = document.createElement("option");
                option.value = "";
                option.textContent = "No other pilots reported yet";
                state.ui.player.appendChild(option);
            } else {
                const placeholder = document.createElement("option");
                placeholder.value = "";
                placeholder.textContent = "Choose a pilot…";
                state.ui.player.appendChild(placeholder);
                for (const entry of pilots) {
                    const option = document.createElement("option");
                    option.value = entry.id;
                    option.textContent = entry.label;
                    state.ui.player.appendChild(option);
                }
            }
        }
        if (keepId && pilots.some((entry) => entry.id === keepId)) state.ui.player.value = keepId;
        else if (!state.active) state.ui.player.value = "";
        return pilots;
    }

    function updateIdleStatus(pilots) {
        if (!state.ui || state.active) return;
        const geofs = getGeoFS();
        if (!geofs?.api?.setCameraPositionAndOrientation || !geofs?.camera?.cam) {
            setStatus("Waiting for the GeoFS camera to finish loading.", "");
        } else if (!getMultiplayer()?.users) {
            setStatus("Open GeoFS multiplayer to load other pilots.", "");
        } else if (pilots.length) {
            setStatus("Ready — choose a pilot, then press Watch.", "ready");
        } else {
            setStatus("No other player aircraft are currently reported.", "");
        }
    }

    function captureCamera() {
        const geofs = getGeoFS();
        const camera = geofs?.camera;
        const api = geofs?.api;
        if (!camera || !camera.cam || !api) return null;

        let lla = Array.isArray(camera.lla) ? camera.lla.slice(0, 3) : null;
        let hpr = Array.isArray(camera.htr) ? camera.htr.slice(0, 3) : [0, 0, 0];
        try {
            const actualLla = api.getCameraLla?.(camera.cam);
            if (validLLA(actualLla)) lla = actualLla.slice(0, 3);
        } catch (_) {}
        try {
            const cesiumCamera = camera.cam;
            if (isFiniteNumber(cesiumCamera.heading) && isFiniteNumber(cesiumCamera.pitch) && isFiniteNumber(cesiumCamera.roll)) {
                hpr = [cesiumCamera.heading * RAD_TO_DEG, cesiumCamera.pitch * RAD_TO_DEG, cesiumCamera.roll * RAD_TO_DEG];
            }
        } catch (_) {}
        if (!validLLA(lla)) return null;
        return { lla, hpr };
    }

    function startSpectating(id, expandPanel) {
        const geofs = getGeoFS();
        const api = geofs?.api;
        const pilot = getPilot(id);
        if (!pilot || !validLLA(pilot.lastUpdate?.co)) {
            setStatus("That pilot is no longer available. Refresh the multiplayer list and try again.", "error");
            return;
        }
        if (!geofs?.camera?.cam || typeof api?.setCameraPositionAndOrientation !== "function") {
            setStatus("GeoFS is still initializing its camera. Try again in a moment.", "error");
            return;
        }

        if (!state.active) {
            state.savedCamera = captureCamera();
            if (!state.savedCamera) {
                setStatus("Could not save the current camera, so spectating was not started.", "error");
                return;
            }
        }

        state.targetId = String(id);
        state.presetId = state.ui?.view?.value && PRESETS[state.ui.view.value] ? state.ui.view.value : state.presetId;
        state.active = true;
        state.missingSince = 0;
        if (state.ui) {
            state.ui.player.value = state.targetId;
            if (expandPanel) state.ui.card.classList.remove("is-collapsed");
            const preset = PRESETS[state.presetId] || PRESETS.rear;
            setStatus(`Watching ${displayName(pilot)} — ${preset.label}. Your aircraft is not moved.`, "active");
        }
    }

    function stopSpectating(message, tone) {
        if (!state.active && !state.savedCamera) return;
        state.active = false;
        state.targetId = null;
        state.missingSince = 0;

        const saved = state.savedCamera;
        state.savedCamera = null;
        const geofs = getGeoFS();
        const camera = geofs?.camera;
        const api = geofs?.api;
        if (saved && camera?.cam && typeof api?.setCameraPositionAndOrientation === "function") {
            try {
                api.setCameraPositionAndOrientation(camera.cam, saved.lla, saved.hpr);
                camera.lla = saved.lla.slice();
                camera.htr = saved.hpr.slice();
                camera.radianRoll = saved.hpr[2] * DEG_TO_RAD;
            } catch (error) {
                console.warn("[GeoFS Spectator] Could not restore the saved camera:", error);
            }
        }
        if (state.ui) setStatus(message || "Spectating stopped. Your original camera is restored.", tone || "ready");
    }

    function getRemoteCoordinates(pilot) {
        const update = pilot?.lastUpdate;
        if (!update || !validLLA(update.co)) return null;
        const base = update.co;
        const interpolated = Array.isArray(pilot.currentInterpolatedCoord) ? pilot.currentInterpolatedCoord : null;
        const result = new Array(6);
        for (let i = 0; i < 6; i++) {
            const candidate = interpolated && Number(interpolated[i]);
            result[i] = interpolated && Number.isFinite(candidate) ? candidate : Number(base[i]) || 0;
        }

        // The multiplayer packet includes velocity. Use a short, capped extrapolation
        // only when GeoFS has no per-frame interpolated position for this pilot.
        if (!interpolated && Array.isArray(update.ve) && Number.isFinite(Number(update.ti))) {
            const mp = getMultiplayer();
            const serverNow = typeof mp?.getServerTime === "function" ? mp.getServerTime() : Date.now();
            const ageMs = Math.max(0, Math.min(450, serverNow - Number(update.ti)));
            for (let i = 0; i < 6; i++) {
                const velocity = Number(update.ve[i]);
                if (Number.isFinite(velocity)) result[i] += velocity * ageMs;
            }
        }
        result[0] = Math.max(-90, Math.min(90, result[0]));
        result[1] = normalizeSigned(result[1]);
        result[3] = normalize360(result[3]);
        result[4] = normalizeSigned(result[4]);
        result[5] = normalizeSigned(result[5]);
        return result;
    }

    function offsetToLLA(origin, east, north, up) {
        const geofs = getGeoFS();
        const api = geofs?.api;
        if (typeof api?.xyz2lla === "function") {
            try {
                const delta = api.xyz2lla([east, north, up], origin);
                if (Array.isArray(delta) && delta.length >= 3 && delta.slice(0, 3).every((value) => Number.isFinite(Number(value)))) {
                    return [
                        Math.max(-90, Math.min(90, origin[0] + Number(delta[0]))),
                        normalizeSigned(origin[1] + Number(delta[1])),
                        origin[2] + Number(delta[2]),
                    ];
                }
            } catch (_) {}
        }

        // Approximate ENU fallback for runtimes that do not expose xyz2lla.
        const latitudeRad = origin[0] * DEG_TO_RAD;
        const northMetersPerDegree = EARTH_METERS_PER_DEGREE;
        const eastMetersPerDegree = Math.max(1, EARTH_METERS_PER_DEGREE * Math.cos(latitudeRad));
        return [
            Math.max(-90, Math.min(90, origin[0] + north / northMetersPerDegree)),
            normalizeSigned(origin[1] + east / eastMetersPerDegree),
            origin[2] + up,
        ];
    }

    function orientationLookingAt(target, cameraLla, overhead) {
        const geofs = getGeoFS();
        const lookAt = geofs?.utils?.lookAt;
        if (typeof lookAt === "function") {
            try {
                // This matches the direction conversion used by GeoFS's own follow camera.
                const result = lookAt(target, cameraLla, overhead ? [0, 1, 0] : [0, 0, 1]);
                if (Array.isArray(result) && result.length >= 2 && Number.isFinite(Number(result[0])) && Number.isFinite(Number(result[1]))) {
                    return [normalize360(Number(result[0])), normalize360(-Number(result[1])), 0];
                }
            } catch (_) {}
        }

        const dLat = (target[0] - cameraLla[0]) * DEG_TO_RAD;
        const dLon = (target[1] - cameraLla[1]) * DEG_TO_RAD;
        const midLat = ((target[0] + cameraLla[0]) / 2) * DEG_TO_RAD;
        const north = dLat * EARTH_METERS_PER_DEGREE;
        const east = dLon * EARTH_METERS_PER_DEGREE * Math.cos(midLat);
        const horizontal = Math.hypot(east, north);
        const heading = normalize360(Math.atan2(east, north) * RAD_TO_DEG);
        const pitch = Math.atan2(target[2] - cameraLla[2], Math.max(0.001, horizontal)) * RAD_TO_DEG;
        return [heading, pitch, 0];
    }

    function computeCameraView(coords, presetId) {
        const preset = PRESETS[presetId] || PRESETS.rear;
        const target = [coords[0], coords[1], coords[2]];
        const heading = Number.isFinite(coords[3]) ? coords[3] * DEG_TO_RAD : 0;
        const forwardEast = Math.sin(heading);
        const forwardNorth = Math.cos(heading);
        const rightEast = Math.cos(heading);
        const rightNorth = -Math.sin(heading);

        let cameraLla;
        let cameraHpr;
        if (preset.pilot) {
            // Approximate seat location and target attitude. The remote pilot's exact
            // cockpit camera and head look are not included in GeoFS multiplayer data.
            cameraLla = offsetToLLA(target, forwardEast * 2.2, forwardNorth * 2.2, 2.3);
            cameraHpr = [normalize360(coords[3]), Math.max(-85, Math.min(85, coords[4])), normalizeSigned(coords[5])];
        } else {
            const east = -forwardEast * preset.back + rightEast * preset.side;
            const north = -forwardNorth * preset.back + rightNorth * preset.side;
            cameraLla = offsetToLLA(target, east, north, preset.up);
            cameraHpr = orientationLookingAt(target, cameraLla, presetId === "overhead");
        }
        return { cameraLla, cameraHpr, target };
    }

    function updateSpectatorCamera() {
        if (!state.active) return;
        const geofs = getGeoFS();
        const camera = geofs?.camera;
        const api = geofs?.api;
        if (!camera?.cam || typeof api?.setCameraPositionAndOrientation !== "function") return;

        const pilot = getPilot(state.targetId);
        const coords = getRemoteCoordinates(pilot);
        if (!pilot || !coords) {
            if (!state.missingSince) state.missingSince = Date.now();
            if (Date.now() - state.missingSince > 2500) {
                stopSpectating("The selected pilot left or stopped sending position data. Camera restored.", "error");
            }
            return;
        }
        state.missingSince = 0;

        try {
            const view = computeCameraView(coords, state.presetId);
            api.setCameraPositionAndOrientation(camera.cam, view.cameraLla, view.cameraHpr);
            camera.lla = view.cameraLla.slice();
            camera.htr = view.cameraHpr.slice();
            camera.radianRoll = view.cameraHpr[2] * DEG_TO_RAD;
        } catch (error) {
            console.warn("[GeoFS Spectator] Camera update failed:", error);
            stopSpectating("Could not update the spectator camera. Your original camera was restored.", "error");
        }
    }

    function installCameraHook() {
        const geofs = getGeoFS();
        const api = geofs?.api;
        if (!api) return;

        // Run after GeoFS updates its own camera, so the simulator cannot overwrite
        // the spectator position later in the same frame.
        const camera = geofs.camera;
        if (camera && typeof camera.update === "function") {
            if (state.fallbackCamera?.camera === camera && camera.update === state.fallbackCamera.wrapped) return;
            const original = camera.update;
            const wrapped = function (...args) {
                const result = original.apply(this, args);
                updateSpectatorCamera();
                return result;
            };
            camera.update = wrapped;
            state.fallbackCamera = { camera, original, wrapped };
            if (state.frameCallbackId != null && typeof api.removeFrameCallback === "function") {
                try { api.removeFrameCallback(state.frameCallbackId, FRAME_CALLBACK_NAME); } catch (_) {}
                state.frameCallbackId = null;
            }
            return;
        }

        // Very early-load fallback: use GeoFS's public render callback until the
        // camera object exists. This path is replaced by the ordered camera hook above.
        if (state.frameCallbackId == null && typeof api.addFrameCallback === "function") {
            try {
                state.frameCallbackId = api.addFrameCallback(updateSpectatorCamera, FRAME_CALLBACK_NAME);
            } catch (_) {}
        }
    }

    function addRowButtonStyles() {
        if (document.querySelector("#geofs-mpsp-row-styles")) return;
        const style = document.createElement("style");
        style.id = "geofs-mpsp-row-styles";
        style.textContent = `
            .geofs-player-list .mpsp-row-watch {
                display:inline-block !important; float:right !important; margin:0 4px 0 8px !important;
                padding:2px 8px !important; border:1px solid rgba(73,191,250,.7) !important;
                border-radius:999px !important; background:#102b42 !important; color:#a9e4ff !important;
                font:700 10px/1.4 system-ui,sans-serif !important; letter-spacing:.03em !important;
                cursor:pointer !important; vertical-align:middle !important;
            }
            .geofs-player-list .mpsp-row-watch:hover { background:#17476a !important; color:#fff !important; }
        `;
        (document.head || document.documentElement).appendChild(style);
    }

    function scanPlayerList() {
        const list = document.querySelector(".geofs-player-list");
        if (!list) return;
        const mp = getMultiplayer();
        const myId = String(mp?.myId || getGeoFS()?.userRecord?.id || "");
        for (const row of list.querySelectorAll("li[data-player]")) {
            const id = String(row.getAttribute("data-player") || "");
            if (!id || id === myId || row.querySelector(":scope > .mpsp-row-watch")) continue;
            const button = document.createElement("button");
            button.type = "button";
            button.className = "mpsp-row-watch";
            button.textContent = "Watch";
            button.title = "Watch this pilot without joining or moving your aircraft";
            button.setAttribute("aria-label", `Watch ${row.textContent.trim()} from a spectator camera`);
            button.addEventListener("click", (event) => {
                event.preventDefault();
                event.stopPropagation();
                if (typeof event.stopImmediatePropagation === "function") event.stopImmediatePropagation();
                refreshTargetOptions();
                if (state.ui?.player) state.ui.player.value = id;
                startSpectating(id, true);
            });
            row.appendChild(button);
        }
    }

    function observePlayerList() {
        const list = document.querySelector(".geofs-player-list");
        if (!list || list === state.listElement) return;
        state.listObserver?.disconnect();
        state.listElement = list;
        state.listObserver = new MutationObserver(scanPlayerList);
        state.listObserver.observe(list, { childList: true, subtree: true });
        scanPlayerList();
    }

    function init() {
        makeUI();
        if (!state.ui) return;
        addRowButtonStyles();
        installCameraHook();
        observePlayerList();
        const pilots = refreshTargetOptions();
        updateIdleStatus(pilots);
    }

    init();
    state.bodyObserver = new MutationObserver(() => {
        if (!state.ui) makeUI();
        addRowButtonStyles();
        installCameraHook();
        observePlayerList();
    });
    if (document.documentElement) state.bodyObserver.observe(document.documentElement, { childList: true, subtree: true });
    window.setInterval(() => {
        init();
        const pilots = refreshTargetOptions();
        updateIdleStatus(pilots);
        scanPlayerList();
    }, 1000);

    // Small public controls are useful when debugging or binding a custom key.
    state.start = startSpectating;
    state.stop = () => stopSpectating("Spectating stopped. Your original camera is restored.", "ready");
})();
