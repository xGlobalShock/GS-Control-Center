# GS Control Center - Architecture Overview

## System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    Electron Main Process                         │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │ electron.js                                                 ││
│  │ - App lifecycle management                                  ││
│  │ - BrowserWindow creation                                    ││
│  │ - IPC channel setup                                         ││
│  │ - System monitoring hooks                                   ││
│  └─────────────────────────────────────────────────────────────┘│
└────────────────────────┬──────────────────────────────────────────┘
                         │ IPC Bridge
┌────────────────────────▼──────────────────────────────────────────┐
│         Preload Script (Security Sandbox)                         │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │ preload.js                                                   │ │
│  │ - Context isolation                                          │ │
│  │ - Safe IPC exposure                                          │ │
│  │ - Window.electron API                                        │ │
│  └─────────────────────────────────────────────────────────────┘ │
└────────────────────────┬──────────────────────────────────────────┘
                         │
┌────────────────────────▼──────────────────────────────────────────┐
│            React Application (Renderer Process)                    │
│                                                                     │
│  ┌──────────────────────────────────────────────────────────────┐ │
│  │                     App.tsx                                  │ │
│  │  ┌─────────────────────────────────────────────────────────┐ │ │
│  │  │ Sidebar                │ Header                         │ │ │
│  │  │ - Navigation           │ - Title                        │ │ │
│  │  │ - Active State         │ - Notifications                │ │ │
│  │  │ - Status Indicator     │ - Profile Menu                 │ │ │
│  │  └─────────────────────────────────────────────────────────┘ │ │
│  │  ┌─────────────────────────────────────────────────────────┐ │ │
│  │  │             Page Content (Dynamic)                      │ │ │
│  │  │                                                         │ │ │
│  │  │  Dashboard  │  Performance  │  Cleaner  │  Games  │Settings │
│  │  │  [Stats]    │   [Charts]    │  [List]   │ [Cards] │[Toggles]│
│  │  │  [Buttons]  │  [Analytics]  │ [Progress]│[Tips]   │[Theme]  │
│  │  └─────────────────────────────────────────────────────────┘ │ │
│  └──────────────────────────────────────────────────────────────┘ │
│                                                                     │
│  ┌──────────────────────────────────────────────────────────────┐ │
│  │ NotificationContext                                          │ │
│  │ - Global notification state                                  │ │
│  │ - Add/Remove notifications                                   │ │
│  │ - Animated notification container                            │ │
│  └──────────────────────────────────────────────────────────────┘ │
└────────────────────────┬──────────────────────────────────────────┘
                         │
        ┌────────────────┼────────────────┐
        │                │                │
    ┌───▼───────┐   ┌───▼──────┐   ┌───▼──────┐
    │ localStorage│   │ Services  │   │  Utils   │
    │ - Settings   │   │ - Monitor │   │- Optimize│
    │ - Profiles   │   │ - System  │   │- Settings│
    └─────────────┘   └───────────┘   └──────────┘
```

## Component Hierarchy

```
App
├── Sidebar
│   ├── Logo
│   ├── Navigation Items
│   │   ├── Home (Dashboard)
│   │   ├── Performance Monitor
│   │   ├── Cleaner
│   │   ├── Game Optimizer
│   │   └── Settings
│   └── Status Indicator
├── Main Content
│   ├── Header
│   │   ├── Title & Subtitle
│   │   ├── Notification Button
│   │   └── Profile Button
│   └── Page Container
│       ├── Dashboard Page
│       │   ├── StatCard x4
│       │   ├── Action Buttons
│       │   └── Info Panel
│       ├── Performance Page
│       │   ├── Chart Container
│       │   └── Stats Grid
│       ├── Cleaner Page
│       │   ├── Summary Card
│       │   ├── Cleaner Items
│       │   └── Clean Button
│       ├── GameOptimizer Page
│       │   ├── Game Cards x4
│       │   └── Tips Panel
│       └── Settings Page
│           ├── General Section
│           ├── Appearance Section
│           └── About Section
└── NotificationContainer
    └── Notification x N
```

## Data Flow Diagrams

### System Monitoring Flow
```
User opens Dashboard
    ↓
App mounts, calls effect
    ↓
setInterval updates systemStats state
    ↓
IPC invoke 'get-system-stats' (In real implementation)
    ↓
Electron process calls WMI commands
    ↓
Returns {cpu, ram, disk, temp}
    ↓
React state updates
    ↓
StatCards re-render with new values
    ↓
Progress bars animate
```

### Navigation Flow
```
User clicks nav item
    ↓
setCurrentPage(pageId)
    ↓
currentPage state updates
    ↓
renderPage() switch statement
    ↓
Returns appropriate page component
    ↓
Page mounts with useEffect
    ↓
Page renders with data/animations
```

### Notification Flow
```
User action triggers event
    ↓
Component calls addNotification()
    ↓
NotificationContext adds notification
    ↓
NotificationContainer re-renders
    ↓
New notification animates in
    ↓
Auto-timeout or manual dismiss
    ↓
removeNotification()
    ↓
NotificationContainer updates
    ↓
Notification animates out
```

## State Management

```
Global State:
├── currentPage (App.tsx)
│   └── Updated by Sidebar clicks
│
├── systemStats (App.tsx)
│   ├── cpu: number
│   ├── ram: number
│   ├── disk: number
│   └── temperature: number
│
└── NotificationContext
    ├── notifications: Notification[]
    ├── addNotification: Function
    └── removeNotification: Function

Component State:
├── Dashboard
│   └── systemStats (from props)
│
├── Settings
│   └── settings: AppSettings
│       ├── autoClean
│       ├── notifications
│       ├── autoOptimize
│       ├── theme
│       └── startupLaunch
│
├── Cleaner
│   ├── items: CleanerItem[]
│   └── isCleaning: boolean
│
└── GameOptimizer
    └── games: GameCard[]
```

## Styling Architecture

```
Global Styles (index.css)
├── CSS Variables
│   ├── --color-primary: #c89b3c
│   ├── --color-secondary: #00d4ff
│   ├── --color-accent: #ff4444
│   ├── --bg-dark: #0a0e27
│   ├── --bg-card: rgba(15, 20, 45, 0.6)
│   └── --border-color: rgba(200, 155, 60, 0.2)
├── Base Styles
│   ├── Box sizing reset
│   ├── Font configuration
│   └── Scrollbar styling
└── Layout Container
    ├── .app-container (flex)
    └── .main-content (flex column)

Component Styles:
├── Sidebar.css - Navigation styling
├── Header.css - Top bar styling
├── StatCard.css - Reusable card styles
├── Dashboard.css - Dashboard layout
├── Performance.css - Charts and stats
├── Cleaner.css - File list styles
├── GameOptimizer.css - Game cards
├── Settings.css - Form elements
└── Notifications.css - Toast notifications

Tailwind Integration:
└── tailwind.config.js
    └── Custom color extensions
```

## Service Architecture

```
Services
├── systemMonitoring.ts
│   ├── getCPUUsage() → Promise<number>
│   ├── getRAMUsage() → Promise<number>
│   ├── getDiskUsage() → Promise<number>
│   ├── getSystemTemperature() → Promise<number>
│   ├── getRunningProcesses() → Promise<Process[]>
│   └── setupSystemMonitoring() → void (IPC setup)
│
└── Utils
    ├── optimization.ts
    │   ├── gameProfiles: Record<string, Profile>
    │   ├── applyGenericOptimization() → Settings
    │   ├── calculateCleanupSize() → number
    │   └── formatBytes() → string
    │
    ├── settings.ts
    │   ├── loadSettings() → AppSettings
    │   ├── saveSettings() → void
    │   ├── loadProfiles() → Profile[]
    │   ├── saveProfile() → void
    │   └── shouldRunCleanup() → boolean
    │
    └── NotificationContext.tsx
        ├── addNotification() → void
        ├── removeNotification() → void
        └── NotificationProvider component
```

## File I/O & Storage Strategy

```
LocalStorage
├── pc-controlcenter-settings
│   └── {settings JSON}
│
└── pc-controlcenter-profiles
    └── [{profile1}, {profile2}, ...]

Electron Storage (Future)
├── app-data/
│   ├── stats.db (SQLite)
│   ├── logs/
│   └── cache/
```

## Build & Packaging

```
Development:
src/ (TypeScript)
  ↓
react-scripts dev (Hot reload)
  ↓
src/ (JSX compiled)
  ↓
http://localhost:3000

Production:
src/ (TypeScript)
  ↓
react-scripts build
  ↓
build/ (Optimized React app)
  ↓
electron-builder
  ↓
dist/ (Electron app)
  ↓
Release/ (Windows .exe, .msi)
```

## Performance Considerations

### Optimizations Implemented
- ✅ Memoized components (React.memo potential)
- ✅ CSS custom properties for theming
- ✅ Lazy loading pages via routing
- ✅ Efficient state management
- ✅ Hardware-accelerated animations (transform, opacity)
- ✅ Virtualized lists (future enhancement)

### CSS Performance
- ✅ Minimal repaints via transform animations
- ✅ GPU acceleration with will-change (sparingly)
- ✅ Efficient selectors
- ✅ Grouped media queries

## Security Considerations

```
Electron Security:
├── Context Isolation: Enabled
├── Preload Script: Sandboxed
├── IPC: White-listed channels
├── Node Integration: Disabled
├── Remote Module: Disabled
└── Sandbox: Enabled

Data Security:
├── LocalStorage: Client-side only
├── No sensitive data in localStorage
├── Settings encrypted in future
└── Profile data validated
```

## Scalability Plan

```
Current Architecture → Future Enhancements
│
├── Component Extraction
│   └── Split StatCard into smaller components
│
├── State Management
│   └── Redux/Zustand for complex state
│
├── Data Persistence
│   └── SQLite for historical data
│
├── Backend Integration
│   └── Node.js server for cloud sync
│
├── Module Splitting
│   └── Separate optimization modules
│
└── Plugin System
    └── Allow third-party extensions
```

---

This architecture provides a scalable, maintainable foundation for the PC Optimizer Elite application with clear separation of concerns and modern React patterns.
