A game created by my 8-year-old, with assistance from Google Antigravity and Claude.

# Disaster Village

A kid-friendly 3D structural engineering game. Build toy-block villages on a floating island,
brace them with diagonal struts, unlock tech gear like shield projectors and lasers, then test your
builds against earthquakes, hurricanes, floods, hail, fire tornadoes, snow storms, raids, and meteors.
If your building survives 8 seconds, you win. If not, rewind and see exactly which piece broke first.

Stack: Vite, React, TypeScript, Tailwind CSS, three.js, Rapier (`@dimforge/rapier3d-compat`).
Runs fully locally with no external assets (procedural textures, synthesized audio).

```bash
npm install
npm run dev      # start the game
npm run build    # typecheck + production build
npm test         # headless unit/physics tests
npm run lint     # oxlint
npm run format   # oxfmt (CI runs `npm run format:check`)
```

## Play on a phone

`npm run dev` listens on your local network. Open the **Network** URL it prints (for example
`http://192.168.1.20:5173`) in your phone's browser while it is on the same Wi-Fi. If it does not load,
allow Node through the computer's firewall for private networks.

The game adapts to phones and tablets in portrait and landscape: a joystick and Jump / Build / Break
(Fire during a disaster) buttons, drag the view to look, a **Tools** drawer for blocks and a disaster
drawer for the picker. The page never scrolls or zooms, the HUD keeps clear of notches, and first-run
graphics default to Medium on touch devices (change it in Settings).

See [docs/PLAN.md](docs/PLAN.md) for the architecture, module contracts and work packages.
