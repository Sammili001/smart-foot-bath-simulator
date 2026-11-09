    "use strict";

    // Digital state variables. Settings remain saved when outputs are paused/off.
    const model = {
      state: "OFF",          // OFF, RUNNING, PAUSED, SAFETY_SHUTDOWN
      targetTemp: 40,        // User setting, 30–45°C
      timerDuration: 30,     // User setting: total session length in minutes, 5–60
      remainingSeconds: 1800,// Live countdown, separate from the duration setting
      massageMode: "Gentle",// Selected roller intensity
      currentTemp: 35,       // Simulated temperature sensor, 20–50°C
      hasWater: true,        // Simulated water presence sensor
      heaterOn: false,       // Actual heater output
      faultReason: "",
      fastMode: false,
      testScenario: null     // Currently selected simulator-only test condition
    };

    const $ = id => document.getElementById(id);
    const logBox = $("eventLog");
    const ROOM_TEMP = 22; // Simulated ambient temperature in °C
    // Approximate 7 L / 500 W foot bath, with 80% of rated power warming water.
    // These are teaching-model assumptions, not measurements of the user's appliance.
    const WATER_MASS_KG = 7;
    const WATER_HEAT_CAPACITY_J_PER_KG_C = 4180;
    const EFFECTIVE_HEATER_WATTS = 500 * 0.8;
    const HEATING_C_PER_MIN = EFFECTIVE_HEATER_WATTS * 60 / (WATER_MASS_KG * WATER_HEAT_CAPACITY_J_PER_KG_C);
    const COOLING_FRACTION_PER_MIN = 0.006; // Passive cooling slows near room temperature.
    let countdownInterval = null;
    let thermalInterval = null;
    let thermalIntervalMs = null;

    const formatTemp = temp => `${Number(temp.toFixed(1))}°C`;

    function log(message, kind = "user") {
      const entry = document.createElement("div");
      entry.className = `log-entry ${kind}`;
      entry.textContent = `[${kind.toUpperCase()}] ${message}`;
      logBox.appendChild(entry);
      while (logBox.children.length > 80) logBox.firstChild.remove();
      logBox.scrollTop = logBox.scrollHeight;
    }

    function safetyReason() {
      if (!model.hasWater) return "No water detected";
      if (model.currentTemp > 48) return "Water temperature > 48°C";
      return null;
    }

    function enterSafety(reason) {
      if (model.state === "SAFETY_SHUTDOWN") return;
      model.state = "SAFETY_SHUTDOWN";
      model.heaterOn = false;
      model.faultReason = reason;
      log(`${reason} → SAFETY_SHUTDOWN; heater and rollers OFF`, "safety");
    }

    function updateHeater() {
      if (model.state !== "RUNNING") { model.heaterOn = false; return; }
      const wasOn = model.heaterOn;
      if (model.currentTemp >= model.targetTemp) model.heaterOn = false;
      else if (model.currentTemp < model.targetTemp - 2) model.heaterOn = true;
      // Inside the two-degree band, retain the previous heater setting.
      if (model.heaterOn !== wasOn) {
        log(`Heater → ${model.heaterOn ? "ON" : "OFF"} at ${formatTemp(model.currentTemp)} (target ${model.targetTemp}°C)`, "system");
      }
    }

    // The clock runs in both modes: one real second removes one second normally,
    // or one minute in Fast mode.
    function syncCountdown() {
      const shouldRun = model.state === "RUNNING";
      if (!shouldRun && countdownInterval) { clearInterval(countdownInterval); countdownInterval = null; }
      if (shouldRun && !countdownInterval) {
        countdownInterval = setInterval(() => dispatch({ type: "clockTick" }), 1000);
      }
    }

    function setTimerDuration(change) {
      const next = Math.max(5, Math.min(60, model.timerDuration + change));
      if (next === model.timerDuration) return;
      const elapsedSeconds = model.timerDuration * 60 - model.remainingSeconds;
      model.timerDuration = next;
      // Changing the total length during a session keeps elapsed time intact.
      model.remainingSeconds = model.state === "RUNNING" || model.state === "PAUSED"
        ? Math.max(0, next * 60 - elapsedSeconds)
        : next * 60;
    }

    // Both modes use the same per-minute heating and cooling rates. Fast mode
    // advances one simulated minute each second; normal mode advances real time.
    function advanceWaterTemperature(elapsedMinutes) {
      if (!model.hasWater) return;
      const heating = model.state === "RUNNING" && model.heaterOn;
      const coolingChange = (ROOM_TEMP - model.currentTemp) * COOLING_FRACTION_PER_MIN * elapsedMinutes;
      const heatingChange = heating ? HEATING_C_PER_MIN * elapsedMinutes : 0;
      const nextTemp = model.currentTemp + coolingChange + heatingChange;
      model.currentTemp = heating ? Math.min(model.targetTemp, nextTemp)
        : model.currentTemp > ROOM_TEMP ? Math.max(ROOM_TEMP, nextTemp)
        : Math.min(ROOM_TEMP, nextTemp);
    }

    // Fast RUNNING water changes on the countdown tick. In other states, this
    // separate interval keeps cooling in step with the selected simulation speed.
    function syncThermalSimulation() {
      const shouldRun = model.hasWater && !(model.state === "RUNNING" && model.fastMode)
        && (model.state === "RUNNING" || model.currentTemp !== ROOM_TEMP);
      const nextIntervalMs = model.fastMode ? 1000 : 3000;
      if (thermalInterval && (!shouldRun || thermalIntervalMs !== nextIntervalMs)) {
        clearInterval(thermalInterval);
        thermalInterval = null;
        thermalIntervalMs = null;
      }
      if (shouldRun && !thermalInterval) {
        thermalInterval = setInterval(() => dispatch({ type: "thermalStep" }), nextIntervalMs);
        thermalIntervalMs = nextIntervalMs;
      }
    }

    function dispatch(action) {
      // Sensor changes take effect before every other transition.
      if (action.type === "thermalStep" && !(model.state === "RUNNING" && model.fastMode)) {
        advanceWaterTemperature(model.fastMode ? 1 : 3 / 60);
      }
      if (action.type === "sensorPreset") {
        // Each test starts independently. Clear the prior fault and stop all outputs
        // before applying new sensor values; the physical Power button still governs startup.
        model.state = "OFF";
        model.heaterOn = false;
        model.faultReason = "";
        model.remainingSeconds = model.timerDuration * 60;
        model.testScenario = action.scenario;
        model.currentTemp = action.temp;
        model.hasWater = action.water;
      }
      if (action.type === "cancelTest" && model.testScenario) {
        // Cancel only the simulator test. Keep the user's target, timer duration,
        // and massage selection, but restore ordinary water conditions and stop outputs.
        model.state = "OFF";
        model.heaterOn = false;
        model.faultReason = "";
        model.remainingSeconds = model.timerDuration * 60;
        model.currentTemp = 35;
        model.hasWater = true;
        model.testScenario = null;
      }

      const active = model.state === "RUNNING" || model.state === "PAUSED";
      const starting = model.state === "OFF" && action.type === "power";
      const sensorChanged = action.type === "sensorPreset";
      const danger = safetyReason();
      if (danger && (active || starting || sensorChanged)) {
        enterSafety(danger);
        syncCountdown();
        syncThermalSimulation();
        render();
        return;
      }

      switch (action.type) {
        case "power":
          if (model.state === "SAFETY_SHUTDOWN") {
            model.state = "OFF";
            model.faultReason = "";
            model.remainingSeconds = model.timerDuration * 60;
            log("Power clicked → Fault reset to OFF; check sensors before restarting");
          } else if (model.state === "OFF") {
            model.remainingSeconds = model.timerDuration * 60;
            model.state = "RUNNING";
            log("Power clicked → State: RUNNING");
          } else {
            model.state = "OFF";
            log("Power clicked → State: OFF");
            if (model.heaterOn) log("Heater → OFF (power off)", "system");
            model.heaterOn = false;
            model.remainingSeconds = model.timerDuration * 60;
          }
          break;

        case "pause":
          if (model.state === "RUNNING") {
            model.state = "PAUSED";
            log("Pause clicked → State: PAUSED");
            if (model.heaterOn) log("Heater → OFF (paused)", "system");
            model.heaterOn = false;
          } else if (model.state === "PAUSED") {
            model.state = "RUNNING";
            log("Pause clicked → State: RUNNING");
          }
          break;

        case "tempUp":
        case "tempDown": {
          const change = action.type === "tempUp" ? 1 : -1;
          model.targetTemp = Math.max(30, Math.min(45, model.targetTemp + change));
          break;
        }

        case "timeUp":
          setTimerDuration(1);
          break;

        case "timeDown":
          setTimerDuration(-1);
          break;

        case "massage":
          if (model.massageMode !== action.mode) {
            model.massageMode = action.mode;
            log(`Massage mode → ${model.massageMode}`, "massage");
          }
          break;

        case "clockTick":
          if (model.state === "RUNNING") {
            model.remainingSeconds = Math.max(0, model.remainingSeconds - (model.fastMode ? 60 : 1));
            if (model.fastMode) advanceWaterTemperature(1);
          }
          break;

        case "fastMode":
          model.fastMode = action.enabled;
          break;
      }

      if (model.remainingSeconds === 0 && (model.state === "RUNNING" || model.state === "PAUSED")) {
        model.state = "OFF";
        model.heaterOn = false;
        log("Timer reached 0 → Automatic OFF; all outputs OFF", "timer");
      }

      updateHeater();
      syncCountdown();
      syncThermalSimulation();
      render();
    }

    function render() {
      const running = model.state === "RUNNING";
      const heating = running && model.heaterOn;
      const massage = running ? model.massageMode : "Off";

      $("targetValue").textContent = model.targetTemp;
      const minutes = Math.floor(model.remainingSeconds / 60);
      const seconds = model.remainingSeconds % 60;
      const clockText = `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
      const remainingText = model.fastMode ? `${Math.ceil(model.remainingSeconds / 60)} min` : clockText;
      $("timerValue").textContent = model.timerDuration;
      $("bezelTimer").textContent = remainingText;
      $("clockHint").textContent = model.fastMode ? "1 sec = 1 min · water temp speeds up" : "Normal: bath timer shows min:sec";
      $("liveTempValue").textContent = model.hasWater ? formatTemp(model.currentTemp) : "No water";
      const nearLimit = model.hasWater && model.currentTemp >= 46 && model.currentTemp <= 48 && model.state !== "SAFETY_SHUTDOWN";
      $("temperatureWarning").hidden = !nearLimit;
      $("temperatureWarning").textContent = nearLimit
        ? `⚠ Near safety limit · Water is ${formatTemp(model.currentTemp)}. Heating is off.`
        : "";
      $("waterStatus").textContent = model.hasWater ? "Detected" : "No water";
      $("heaterStatus").textContent = heating ? "ON" : "OFF";
      $("heaterStatus").classList.toggle("on", heating);
      $("massageStatus").textContent = massage.toUpperCase();
      $("stateValue").textContent = model.state;
      $("stateValue").className = `state-badge ${model.state === "SAFETY_SHUTDOWN" ? "fault" : model.state.toLowerCase()}`;
      $("inspectorTarget").textContent = `${model.targetTemp}°C`;
      $("inspectorTimer").textContent = remainingText;
      $("inspectorMode").textContent = model.massageMode;
      $("faultMessage").textContent = `⚠ ${model.faultReason || "Safety shutdown"} · Press Power to reset`;

      $("appliance").classList.toggle("fault", model.state === "SAFETY_SHUTDOWN");
      $("bath").classList.toggle("heating", heating);
      $("water").classList.toggle("dry", !model.hasWater);
      $("bath").classList.toggle("gentle", massage === "Gentle");
      $("bath").classList.toggle("strong", massage === "Strong");
      $("water").classList.toggle("gentle", massage === "Gentle");
      $("water").classList.toggle("strong", massage === "Strong");

      const power = $("powerButton");
      power.classList.toggle("is-on", running || model.state === "PAUSED");
      power.querySelector("span").textContent = model.state === "SAFETY_SHUTDOWN" ? "Reset" : model.state === "OFF" ? "Power on" : "Power off";
      const pause = $("pauseButton");
      pause.disabled = !running && model.state !== "PAUSED";
      pause.querySelector("span").textContent = model.state === "PAUSED" ? "Resume" : "Pause";

      $("tempDown").disabled = model.targetTemp <= 30;
      $("tempUp").disabled = model.targetTemp >= 45;
      $("timeDown").disabled = model.timerDuration <= 5;
      $("timeUp").disabled = model.timerDuration >= 60;
      $("fastMode").checked = model.fastMode;
      $("cancelTest").disabled = !model.testScenario;
      document.querySelectorAll("[data-sensor]").forEach(button => {
        button.setAttribute("aria-pressed", String(button.dataset.sensor === model.testScenario));
      });
      if (model.testScenario) {
        const labels = { boundary: "Boundary 48°C", overheat: "Overheat 49°C", dry: "Dry tub" };
        const label = labels[model.testScenario];
        $("testFeedback").textContent = model.state === "SAFETY_SHUTDOWN"
          ? `${label}: ${model.faultReason}. Heater and massage are off.`
          : model.state === "OFF"
            ? `${label} test loaded. State: OFF. Press Power to test startup.`
            : `${label} test active. State: ${model.state}. Follow the bath and inspector.`;
      } else {
        $("testFeedback").textContent = "No test active. Choose a scenario to test the appliance.";
      }
      document.querySelectorAll("[data-mode]").forEach(button => {
        button.setAttribute("aria-pressed", String(button.dataset.mode === model.massageMode));
      });
    }

    $("powerButton").addEventListener("click", () => dispatch({ type: "power" }));
    $("pauseButton").addEventListener("click", () => dispatch({ type: "pause" }));
    for (const type of ["tempUp", "tempDown", "timeUp", "timeDown"]) {
      $(type).addEventListener("click", () => dispatch({ type }));
    }
    document.querySelectorAll("[data-mode]").forEach(button => {
      button.addEventListener("click", () => dispatch({ type: "massage", mode: button.dataset.mode }));
    });
    document.querySelectorAll("[data-sensor]").forEach(button => {
      button.addEventListener("click", () => {
        const presets = {
          boundary: { temp: 48, water: true },
          overheat: { temp: 49, water: true },
          dry: { temp: 35, water: false }
        };
        const preset = presets[button.dataset.sensor];
        dispatch({ type: "sensorPreset", scenario: button.dataset.sensor, ...preset });
      });
    });
    $("cancelTest").addEventListener("click", () => dispatch({ type: "cancelTest" }));
    $("fastMode").addEventListener("change", event => dispatch({ type: "fastMode", enabled: event.target.checked }));
    $("clearLog").addEventListener("click", () => logBox.replaceChildren());
    $("copyLog").addEventListener("click", async () => {
      const transcript = [...logBox.children].map(entry => entry.textContent).join("\n");
      const button = $("copyLog");
      try {
        if (navigator.clipboard && window.isSecureContext) await navigator.clipboard.writeText(transcript);
        else {
          // Fallback for browsers that restrict Clipboard API on file:// pages.
          const area = document.createElement("textarea");
          area.value = transcript; area.style.position = "fixed"; area.style.opacity = "0";
          document.body.appendChild(area); area.select();
          if (!document.execCommand("copy")) throw new Error("Copy unavailable");
          area.remove();
        }
        button.textContent = "Copied!";
      } catch { button.textContent = "Copy failed"; }
      setTimeout(() => { button.textContent = "Copy transcript"; }, 1800);
    });

    render();
    syncThermalSimulation();
