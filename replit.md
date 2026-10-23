# Workspace

## Overview

pnpm workspace monorepo using TypeScript. Each package manages its own dependencies.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)

## Key Commands

- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- `pnpm --filter @workspace/api-server run dev` — run API server locally

See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details.

## ParkEase India

A JustPark-style parking space booking platform for Indian cities.

### Features
- Browse and search parking spots by city, vehicle type, price
- Book spots by the hour or day (INR pricing)
- Booking management with status tracking (cancel, confirm, complete)
- Spot detail page with reviews and booking form
- Owner dashboard to list and manage parking spots
- Admin/owner dashboard with stats, city breakdown chart, top spots
- User profiles for drivers and parking space owners

### Pages
- `/` — Home/Landing: search parking by city, featured spots
- `/spots` — Browse spots with filters (city, vehicle type, availability, price)
- `/spots/:id` — Spot detail, reviews, and quick booking
- `/bookings` — My Bookings list
- `/bookings/:id` — Booking detail with cancel functionality
- `/dashboard` — Owner/admin dashboard with stats and Recharts chart
- `/profile` — User profile and settings
- `/list-spot` — List your parking spot form

### DB Schema
- `users` — name, email, phone, role (driver/owner/admin)
- `spots` — parking spot details, location, pricing, availability
- `bookings` — booking records with vehicle, time, payment status
- `reviews` — star ratings and comments per spot

### Seed Data
- 5 Indian users (2 owners, 2 drivers, 1 admin)
- 8 parking spots across Mumbai, Delhi, Bengaluru, Hyderabad, Pune, Chennai, Gurugram
- 6 sample bookings (mix of completed and upcoming)
- 6 reviews linked to spots
