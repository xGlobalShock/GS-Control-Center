# 🧑‍💻 Copilot Instructions for GS Control Center

## Big Picture Architecture
- **Frontend:** React + TypeScript (src/) with modular components and pages.
- **Desktop Integration:** Electron (public/, build/) for Windows desktop features.
- **Backend Services:** Node.js child_process for system monitoring and tweaks (src/services/).
- **State Management:** Context API for notifications and global state (src/context/NotificationContext.tsx).
- **Styling:** Tailwind CSS + custom CSS (src/styles/), with animation via Framer Motion.
- **Data Persistence:** LocalStorage for settings/profiles; future: SQLite via Electron.

## Developer Workflows
- **Setup:** `npm install` (one time)
- **Development:** `npm run dev` (hot reload, Electron window)
- **Build:** `npm run build` (production React build)
- **Desktop Launch:** `npm run client` (recommended for desktop app)
- **Electron Packaging:** `npm run electron-build` (for Windows installer)
- **Troubleshooting:** If issues, run `npm install` or remove node_modules & package-lock.json, then reinstall.

## Project-Specific Conventions
- **Component Structure:** All UI components in src/components/, pages in src/pages/.
- **Service Layer:** System integration logic in src/services/systemMonitoring.ts; optimization and settings in src/utils/.
- **Notification Pattern:** Use NotificationContext and ToastContainer for all user messages (see src/context/NotificationContext.tsx).
- **Styling:** Prefer Tailwind classes; use component CSS for custom animations.
- **Data Flow:** Actions trigger context updates, which re-render containers (see ARCHITECTURE.md for diagrams).
- **File Organization:** Reference FILE_MAP.md and PROJECT_TREE.md for file purposes and relationships.

## Integration Points & Dependencies
- **External:** Electron, Framer Motion, Recharts, Lucide React, Tailwind CSS.
- **Windows API:** Accessed via Node.js child_process in services/systemMonitoring.ts.
- **LocalStorage:** Used for persistent settings and profiles.

## Key Files & Directories
- **src/App.tsx:** Main routing and state management.
- **src/components/:** Sidebar, Header, StatCard, ToastContainer, etc.
- **src/pages/:** Dashboard, Performance, Cleaner, Settings, GameOptimizer.
- **src/services/systemMonitoring.ts:** Windows system metrics.
- **src/utils/optimization.ts, settings.ts:** Core logic and persistence.
- **src/context/NotificationContext.tsx:** Notification system.
- **src/styles/:** Component and global CSS.
- **public/, build/:** Electron and static assets.

## How to Get Productive Fast
- Start with README.md and START_HERE.md for overview and quick start.
- Use ARCHITECTURE.md for system design and data flow.
- Reference DEVELOPMENT.md and NPM_COMMANDS.md for workflow and commands.
- Explore component and service files for implementation patterns.
- Use FILE_MAP.md and PROJECT_TREE.md for file navigation.

---
For unclear conventions or missing patterns, check the relevant documentation in Docs/ or ask for clarification.
