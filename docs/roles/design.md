# Design and Layout

Geistr should have a clean, modern desktop design.

The UI should feel like a focused AI workspace, not a cluttered developer tool.

## Core Layout

Geistr uses a persistent left sidebar for primary navigation.

The sidebar contains:

- main navigation buttons
- app/page navigation
- app-specific secondary actions when needed
- chat/session shortcuts when useful
- settings at the bottom

The sidebar should be collapsible.

## Default Chat Layout

When no preview/artifact is open, the main content area should be used by the chat/session view.

Default layout:

```txt
+------------+--------------------------------+
| Sidebar    | Chat                           |
|            |                                |
| Settings   |                                |
+------------+--------------------------------+
```

## Preview Layout

When a preview/artifact is open, the layout changes:

```txt
+------------+--------------------+----------+
| Sidebar    | Preview / Artifact | Chat     |
|            |                    |          |
| Settings   |                    |          |
+------------+--------------------+----------+
```

The preview should sit in the middle, and chat should move to the right.

This makes it easy to review artifacts and talk to the agent at the same time.

## Full Preview Mode

The preview should have a button to open it in full view.

In full preview mode, the preview takes the full usable space of the app window.

The user should be able to exit full preview mode and return to the normal split layout.

## Sidebar Behavior

The left sidebar must be collapsible.

Collapsed sidebar should preserve access to important navigation through icons or compact controls.

Settings should remain accessible from the bottom area or equivalent compact control.

## Top Window Area

Geistr is a desktop app, so the top area must account for native window controls.

On macOS:

- close/minimize/fullscreen controls are on the left
- the top bar/layout must leave space for those controls

On Windows:

- minimize/maximize/close controls are on the right
- the top bar/layout must leave space for those controls

Do not design a top bar that conflicts with native window controls.

The app should handle platform differences intentionally.

## Screenshots and References

Mohammed will provide screenshots for the desired design direction.

Reference screenshots should guide visual style and interaction, but Geistr should keep its own architecture.

## Design System

Geistr should use one coherent design system.

Do not hardcode random colors, spacing, radii, or typography values across components.

Shared visual values should come from global design tokens whenever possible.

## Design Tokens

Geistr should define global tokens for important visual decisions, including:

- colors
- background layers
- foreground/text colors
- muted text
- borders
- primary/accent colors
- danger/warning/success colors
- spacing scale
- border radii
- shadows/elevation
- typography sizes
- font weights
- animation durations/easing

Components should consume these tokens through CSS variables or an equivalent centralized theme layer.

## Theme Support

Geistr must support light and dark themes.

Dark theme can be the first polished theme, but the architecture should not assume dark-only UI.

Future themes should be possible by changing tokens, not rewriting every component.

Examples of future themes:

- dark with blue primary
- dark with red primary
- light neutral
- high contrast
- user/agent-customized color themes

## User/Agent Editable Theme Config

Theme tokens should eventually be saved in an app config file or local settings store.

The agent should be able to inspect where theme settings live, explain them to the user, and update them when allowed.

Do not create a special tool just for theme updates unless there is a real app-level need. Prefer clear config files or settings storage that existing read/write/bash capabilities can inspect and update.

## Component Styling Rule

Components should use semantic tokens, not raw color meanings.

Good:

```css
background: var(--surface-panel);
color: var(--text-primary);
border-color: var(--border-muted);
```

Bad:

```css
background: #171717;
color: #f4f4f4;
border-color: #333;
```

Raw values may exist in the token definition file, but should not be scattered through components.

## Design Review Rule

Before the first major commit and before large UI milestones, review the UI code for:

- duplicated colors
- duplicated spacing patterns
- hardcoded theme values outside token definitions
- components that should share primitives
- dark-only assumptions that block light theme later

## Design Principles

- clean
- modern
- calm
- readable
- fast to navigate
- artifact-friendly
- agent-native
- not overloaded with panels
- token-based
- themeable

## Constraint

Do not duplicate layout systems per app.

The main shell/sidebar/preview/chat layout should be a reusable Geistr core UI pattern. Apps can customize content inside the shell, but should not each reinvent the desktop frame.
