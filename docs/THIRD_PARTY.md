# Third party assets

All assets are static files served from `assets/third_party/`. Each pack includes its source license and a manifest with file hashes.

| Pack id | Name | Author | License | Source | Use |
|---|---|---|---|---|---|
| `kenney-fantasy-town-kit` | Fantasy Town Kit | Kenney | [CC0-1.0](https://creativecommons.org/publicdomain/zero/1.0/) | [kenney.nl](https://kenney.nl/assets/fantasy-town-kit) | Medieval theme buildings |
| `kenney-castle-kit` | Castle Kit | Kenney | [CC0-1.0](https://creativecommons.org/publicdomain/zero/1.0/) | [kenney.nl](https://kenney.nl/assets/castle-kit) | Medieval theme buildings |
| `kenney-modular-space-kit` | Modular Space Kit | Kenney | [CC0-1.0](https://creativecommons.org/publicdomain/zero/1.0/) | [kenney.nl](https://kenney.nl/assets/modular-space-kit) | Sci-fi buildings |
| `kenney-space-kit` | Space Kit | Kenney | [CC0-1.0](https://creativecommons.org/publicdomain/zero/1.0/) | [kenney.nl](https://kenney.nl/assets/space-kit) | Sci-fi buildings |
| `kenney-city-kit-suburban` | City Kit Suburban | Kenney | [CC0-1.0](https://creativecommons.org/publicdomain/zero/1.0/) | [kenney.nl](https://kenney.nl/assets/city-kit-suburban) | Modern buildings |
| `kenney-city-kit-commercial` | City Kit Commercial | Kenney | [CC0-1.0](https://creativecommons.org/publicdomain/zero/1.0/) | [kenney.nl](https://kenney.nl/assets/city-kit-commercial) | Modern buildings |
| `kenney-city-kit-roads` | City Kit Roads | Kenney | [CC0-1.0](https://creativecommons.org/publicdomain/zero/1.0/) | [kenney.nl](https://kenney.nl/assets/city-kit-roads) | Modern streets |
| `kenney-pirate-kit` | Pirate Kit | Kenney | [CC0-1.0](https://creativecommons.org/publicdomain/zero/1.0/) | [kenney.nl](https://kenney.nl/assets/pirate-kit) | Props and western fallback |
| `kenney-survival-kit` | Survival Kit | Kenney | [CC0-1.0](https://creativecommons.org/publicdomain/zero/1.0/) | [kenney.nl](https://kenney.nl/assets/survival-kit) | Props and western fallback |
| `kenney-nature-kit` | Nature Kit | Kenney | [CC0-1.0](https://creativecommons.org/publicdomain/zero/1.0/) | [kenney.nl](https://kenney.nl/assets/nature-kit) | Props and western fallback |
| `kaykit-medieval-hexagon` | Medieval Hexagon Pack | KayKit | [CC0-1.0](https://creativecommons.org/publicdomain/zero/1.0/) | [GitHub](https://github.com/KayKit-Game-Assets/KayKit-Medieval-Hexagon-Pack-1.0) | Medieval theme buildings |
| `kaykit-city-builder-bits` | City Builder Bits | KayKit | [CC0-1.0](https://creativecommons.org/publicdomain/zero/1.0/) | [GitHub](https://github.com/KayKit-Game-Assets/KayKit-City-Builder-Bits-1.0) | Modern buildings and props |
| `kaykit-space-base-bits` | Space Base Bits | KayKit | [CC0-1.0](https://creativecommons.org/publicdomain/zero/1.0/) | [GitHub](https://github.com/KayKit-Game-Assets/KayKit-Space-Base-Bits-1.0) | Sci-fi buildings |
| `kaykit-restaurant-bits` | Restaurant Bits | KayKit | [CC0-1.0](https://creativecommons.org/publicdomain/zero/1.0/) | [GitHub](https://github.com/KayKit-Game-Assets/KayKit-Restaurant-Bits-1.0) | Interiors and props |
| `kaykit-furniture-bits` | Furniture Bits | KayKit | [CC0-1.0](https://creativecommons.org/publicdomain/zero/1.0/) | [GitHub](https://github.com/KayKit-Game-Assets/KayKit-Furniture-Bits-1.0) | Interiors and props |
| `kaykit-adventurers` | KayKit Adventurers | Kay Lousberg | [CC0-1.0](https://creativecommons.org/publicdomain/zero/1.0/) | [itch.io](https://kaylousberg.itch.io/kaykit-adventurers) | Player and NPC characters |
| `quaternius-animated-humans` | Quaternius Animated Characters (18 rigged people: Casual, Worker, Business Man, Farmer, Hoodie, Beach, Punk, Adventurer, Adventuress, Hooded, Formal Woman, Astronaut, SWAT, Woman Jacket, Woman Tank, Woman Casual, Man, Man in Suit) | Quaternius | [CC0-1.0](https://creativecommons.org/publicdomain/zero/1.0/) (Public Domain (CC0) on each Poly Pizza page, see the pack's LICENSE.txt) | [poly.pizza/u/Quaternius](https://poly.pizza/u/Quaternius) | Human folk in every theme (`scripts/fetch-humans.mjs`) |

## How to refresh

Run `npm run assets:fetch` to download the source archives and refresh pack manifests, then `npm run assets:optimize` to optimize GLB files for delivery. `.cache/assets-raw/` is the gitignored download cache; delete a cached zip there when you need to fetch that archive again.
