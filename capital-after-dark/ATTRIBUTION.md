# Attribution and licensing

## Original work

All game code, the story, every character, the two fictional crews (The Marlowe Firm, The Kestrels), the
fictional businesses (Night Owl Cars, Halcyon Wharf, Kestrel Couriers, The Gilded Stag, Brewer Street
Motors, Wardour Food & Wine and every shop name on a fascia) and all dialogue were written for this project.

**No third-party art, model, texture, font, sound or music files are shipped.**

- Every texture (brick and stone facades, shopfronts, street nameplates, neon, billboards, asphalt, paving)
  is drawn at start-up on a `<canvas>` by `src/render/textures.ts`.
- Every 3D model (people, vehicles, buildings, street furniture, landmarks) is built from primitives in code.
- Every sound (engine, rain, city rumble, two-tone siren, gunshots, impacts, UI) is synthesised with the
  Web Audio API by `src/core/Audio.ts`. There is no recorded audio and no music.
- UI text uses system fonts only.

This is an original game in the open-world crime genre. It contains no code, assets, characters, music,
names or branding from Grand Theft Auto or any other commercial game.

## Map reference: OpenStreetMap

The playable district is a **hand-authored, stylised** approximation of Soho / Piccadilly Circus / Chinatown /
Leicester Square. Real street names and their rough relationships to one another were checked against
OpenStreetMap while designing `src/world/layout.ts`:

> Map data © OpenStreetMap contributors, available under the Open Database License (ODbL) 1.0.
> https://www.openstreetmap.org/copyright

No OpenStreetMap geometry, tiles or extracts are bundled in this repository - the layout is a regular
5 × 5 street grid drawn by hand, so the real streets' shapes, lengths and junctions are **not** reproduced.
If a future version imports real OSM data (see the roadmap), that derived database must be offered under
the ODbL and the attribution above must be shown in the game's menu.

## Real places and things

- Street names (Wardour Street, Shaftesbury Avenue, Old Compton Street, …) and place names (Piccadilly Circus,
  Leicester Square, Chinatown) are geographic facts.
- Landmarks are original, generic stand-ins: a memorial fountain with steps, an illuminated corner of
  advertising screens showing fictional adverts, a paifang-style gate, a garden square with a statue.
- Station entrances are plain "STATION" totems. No transport-operator logo or roundel is reproduced.
- Vehicles are generic shapes with invented model names (Calder Saloon, Vesper GT). The taxi and bus are
  generic "black cab" and "red double-decker" forms without manufacturer or operator branding.
- The police are a fictional force with generic high-visibility livery; "PC Bell" and the station are invented.

## Open-source dependencies

| Package | Use | Licence |
| --- | --- | --- |
| [three](https://github.com/mrdoob/three.js) | 3D rendering, post-processing | MIT |
| [@dimforge/rapier3d-compat](https://github.com/dimforge/rapier.js) | Physics, character controller, ray casts | Apache-2.0 |
| [vite](https://github.com/vitejs/vite) (dev) | Build tooling and dev server | MIT |
| [typescript](https://github.com/microsoft/TypeScript) (dev) | Language | Apache-2.0 |
| [vitest](https://github.com/vitest-dev/vitest) (dev) | Unit tests | MIT |
| [playwright](https://github.com/microsoft/playwright) (dev, not a declared dependency) | Browser gameplay checks | Apache-2.0 |

No paid services, cloud APIs, analytics or network calls are used at run time. Saves stay in the browser's
`localStorage`.
