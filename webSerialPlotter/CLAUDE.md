# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

- `npm run dev` - Start development server (localhost:5173)
- `npm run build` - Type-check and build for production
- `npm run typecheck` - Run TypeScript checking without build
- `npm run lint` - Run ESLint code quality checks
- `npm test` - Run Vitest test suite
- `npm run preview` - Preview production build locally

## Core Architecture

### High-Level Design Pattern
This is a real-time serial data plotting application built on a **ring buffer + windowing architecture** for high-performance data visualization. The core pattern separates data ingestion, storage, windowing, and rendering into distinct layers.

### Data Flow Architecture
1. **Serial Input** (`useSerial`) → Line parsing → **RingStore.append()**
2. **RingStore** maintains fixed-capacity ring buffers per data series
3. **Windowing System** provides efficient data slices via `getWindow({ startFromNewest, length })`
4. **Canvas Renderer** draws from windowed snapshots with 60 FPS performance

### Key Architectural Components

#### Ring Buffer Store (`src/store/RingStore.ts`)
- **Core Concept**: Fixed-memory ring buffer that never grows, preventing memory bloat during long data sessions
- **Windowing**: `getWindow()` returns contiguous views without copying data - critical for performance
- **Freeze Behavior**: Uses `total` counter to anchor frozen views while live data continues appending
- **Anchors**: Precomputed time indices for efficient X-axis labeling

#### Canvas Rendering (`src/components/PlotCanvas.tsx`)
- **Performance**: Device pixel ratio aware, ResizeObserver-based sizing, requestAnimationFrame drawing
- **Interaction Model**: Sophisticated pointer/touch handling with momentum scrolling and pinch zoom
- **Theme Integration**: Redraws on CSS class changes for seamless dark/light mode

#### Coordinate Systems
The app manages multiple coordinate spaces that can be confusing:
- **UI Coordinates**: User scroll/window inputs (scrollOffsetInput, windowSizeInput)  
- **Data Coordinates**: Ring buffer indices (`startFromNewest` in getWindow calls)
- **Freeze Coordinates**: Delta calculation between current total and freeze base
- **Canvas Coordinates**: Pixel positions for rendering

Use utilities in `src/utils/coordinates.ts` for transformations between these spaces.

### State Management Architecture
- **External Store Pattern**: Uses `useSyncExternalStore` with RingStore for efficient React integration
- **No Redux/Zustand**: Simple context provider with ref-based singleton store
- **Performance**: Store updates trigger minimal re-renders via precise subscriptions

### Interaction Architecture  
- **Momentum Scrolling**: Physics-based deceleration after pan gestures (`useMomentumScrolling`)
- **Zoom Controls**: Center-point preserving zoom with coordinate transformation (`useZoomControls`)
- **Freeze System**: Allows historical data exploration while live data continues

## Web Serial Integration

The app uses the **Web Serial API** for direct browser-to-device communication:
- **Parser**: Newline-delimited text with CSV/space/tab separation
- **Headers**: Lines starting with `#` define series names
- **Error Handling**: Graceful degradation for unsupported browsers
- **Stream Management**: Proper TextDecoderStream usage with cleanup

## Performance Considerations

### Memory Management
- Ring buffers prevent unbounded growth during long sessions
- TypedArrays (Float32Array/Float64Array) for numerical data storage
- Windowing system avoids copying large datasets

### Rendering Performance  
- Canvas rendering with proper DPR scaling
- Clipped drawing to prevent overdraw artifacts
- Theme-aware redraw triggers via MutationObserver

### Data Ingestion
- O(1) append operations regardless of buffer size
- Non-blocking data parsing with proper error handling
- Configurable history capacity (default 12K samples)

## Component Patterns

### Custom Hooks Philosophy
Recent refactoring extracted complex logic into focused hooks:
- `useZoomControls` - All zoom math with center-point preservation  
- `useMomentumScrolling` - Physics simulation for smooth pan interactions
- `useSerial` - Web Serial API lifecycle management

### UI Component Architecture
- **Compound Components**: StatsPanel with individual exportable cards
- **Overlay System**: Legend and tools as absolute positioned overlays
- **Theme Integration**: CSS custom properties with Tailwind dark: variants

### Canvas Component Pattern
PlotCanvas uses forwardRef with imperative handle for PNG export functionality. The component separates concerns:
- **Drawing Logic**: Pure functions in `src/utils/plotRendering.ts`
- **Interaction Logic**: Event handling utilities in `src/utils/canvasInteractions.ts`  
- **Coordinate Math**: Transformation utilities in `src/utils/coordinates.ts`

## Testing Strategy

- **Unit Tests**: Focus on core data structures (RingStore) using Vitest
- **No E2E**: Serial API requires hardware; use built-in signal generator for testing UI
- **Test Location**: `src/store/__tests__/` follows co-location pattern

## Special Considerations

### Browser Compatibility
- **Web Serial API**: Chrome/Edge only (89+), no Firefox/Safari support
- **Graceful Degradation**: Clear messaging for unsupported browsers
- **Built-in Testing**: Signal generator provides hardware-free development

### Performance Targets
- **60 FPS**: Smooth rendering during high-frequency data streams
- **Memory Bound**: Fixed memory usage regardless of session length  
- **Responsive**: Sub-100ms interaction response times

### Dark Mode Implementation
Uses manual Tailwind dark mode with custom variant:
- Toggle via `dark` class on `document.documentElement`
- Canvas redraws automatically on theme changes
- CSS custom properties for plot-specific colors (`--plot-bg`, `--plot-grid`)