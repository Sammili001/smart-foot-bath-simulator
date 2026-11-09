# Smart Foot Bath Simulator

An interactive, browser-based state machine model of a smart foot bath. The app has four lifecycle states: `OFF`, `RUNNING`, `PAUSED`, and `SAFETY_SHUTDOWN`. The heater uses a 2°C hysteresis band; the massage rollers, timer, and safety sensors operate alongside it.

**Live simulator:** https://sammili001.github.io/smart-foot-bath-simulator/

## Open the simulator

Open `index.html` in a browser. No installation or external assets are required.

## Controls

- Set a target temperature from 30–45°C and a session length from 5–60 minutes.
- Choose Gentle, Strong, or Off for the massage rollers.
- Use Fast mode to map one real second to one simulated minute.
- Try the 48°C boundary, 49°C overheat, and dry-tub scenarios. Cancel test restores 35°C water and an off state while keeping your settings.
- The event console records key state changes and can copy its transcript.

The water-temperature model is an educational approximation, not a measurement of a particular product. It assumes 7 L of water, an effective heater output of 400 W, and passive cooling toward 22°C. The safety threshold and controls are part of this software model.
