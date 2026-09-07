# Oily — Frontend Tech Stack

Snapshot of the frontend as it stands today (post: 11 new pages added, Incidents/What-If/Analytics tabs removed, Digital Twin rebuilt with a 3D simulation).

> **Working copy note:** the live/buildable copy of this project is `C:\Users\lavis\Desktop\sih-26` (apostrophe-free). This `sih'26` folder cannot be built by TanStack Start's code-splitter because of the apostrophe in the path — see the description below for the stack itself, but run/build from `sih-26`.

---

## Core framework
| Piece | Choice |
|---|---|
| Meta-framework | **TanStack Start** (`@tanstack/react-start`) — full-stack React, SSR + server functions |
| Routing | **TanStack Router** (`@tanstack/react-router`), file-based routes in `src/routes/`, auto-generated `routeTree.gen.ts` |
| UI library | **React 19** |
| Language | **TypeScript** (strict) |
| Data fetching / cache | **TanStack Query** (`@tanstack/react-query`) |
| Build tool | **Vite 8** (rolldown-powered) + `@tanstack/router-plugin` + **Nitro** (server build target) |
| Package manager | **Bun** (`bun.lock`, `bunfig.toml`) |
| Dev tooling | ESLint 9 + `typescript-eslint`, Prettier, `@lovable.dev/vite-tanstack-config` (wraps Vite config; project originated in **Lovable**) |

## Styling & design system
| Piece | Choice |
|---|---|
| CSS framework | **Tailwind CSS v4** (CSS-first `@theme inline`, no `tailwind.config.js`) |
| Extra utilities | `tw-animate-css`, `tailwind-merge`, `clsx`, `class-variance-authority` |
| Color system | **oklch** color tokens (`src/styles.css`) — light neutral surfaces, dark navy sidebar, cyan/blue accents, red/orange/amber/green risk semantics |
| Fonts | IBM Plex Sans (UI), IBM Plex Mono (numeric `.num` readouts) |
| Component primitives | **shadcn/ui** pattern on top of **Radix UI** — ~30 `@radix-ui/react-*` packages in `src/components/ui/` (dialog, dropdown, select, tabs, sheet, sidebar, popover, tooltip, accordion, etc.) |
| Icons | `lucide-react` |
| Toasts | `sonner` |

## Domain / visualization libraries
| Piece | Used for |
|---|---|
| **Leaflet** (`leaflet`) | 2D incident maps — markers, drift trajectory, uncertainty rings, sensitive-zone overlays (`LeafletMap.tsx`, lazy-loaded, client-only via `ClientOnly` + `Suspense`) |
| **Three.js** (`three`, `three/examples/jsm/controls/OrbitControls`) | **3D digital-twin simulation** — animated water surface (sum-of-sines wave field), an oil slick disc that grows/drifts across the forecast timeline, orbit + zoom camera controls (`OilSpill3D.tsx`, lazy-loaded, client-only) |
| **Recharts** | Charts across Impact, Drift and Reports pages (bar/area charts for score composition, displacement/uncertainty) |
| `react-hook-form` + `zod` + `@hookform/resolvers` | Form state/validation scaffolding (via shadcn `form.tsx`) |
| `date-fns` | Date formatting |
| `embla-carousel-react`, `react-resizable-panels`, `react-day-picker`, `input-otp`, `cmdk`, `vaul` | Supporting shadcn/ui components (carousel, resizable panels, calendar, OTP input, command palette, drawer) | three.js : 'exact digital twin visualisation' |

## Application-layer architecture
```
UI route/component
   → services/oilyApi.ts       (frontend service layer — single repoint point)
   → lib/oily/api.functions.ts (TanStack Start server functions, mock "/api/*" endpoints)
   → lib/oily/engine.ts        (pure calculation engine — drift, impact, response, similarity, chatbot)
```
- **State management:** custom store in `lib/oily/store.ts` using React's `useSyncExternalStore`, persisted to **localStorage** (`oily.state.v1`), SSR-safe server snapshot.
- **No real backend/auth yet** — ML classification, drift, impact and response generation are all deterministic mock logic behind server functions, designed to be swapped for real services without touching UI.

## Current page set (routes)
`/`, `/login`, `/register`, `/onboarding/role`, `/dashboard`, `/detect`, `/incidents`, `/incidents/$id`, `/incidents/$id/command`, `/impact`, `/drift`, `/history`, `/history/$id`, `/response`, `/digital-twin` (3D), `/reports`, `/settings`

Removed from navigation: **Incidents** tab (pages still exist, just unlisted), **What-If / Simulator**, **Analytics** (both pages deleted).

## Scripts
```sh
bun install
bun run dev       # vite dev server
bun run build     # production build
bun run preview   # preview production build
bun run lint
bun run format
```
