---
name: Sport Navi Assistant
colors:
  surface: '#f8f9fa'
  surface-dim: '#d9dadb'
  surface-bright: '#f8f9fa'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f3f4f5'
  surface-container: '#edeeef'
  surface-container-high: '#e7e8e9'
  surface-container-highest: '#e1e3e4'
  on-surface: '#191c1d'
  on-surface-variant: '#414754'
  inverse-surface: '#2e3132'
  inverse-on-surface: '#f0f1f2'
  outline: '#727785'
  outline-variant: '#c1c6d6'
  surface-tint: '#005bc0'
  primary: '#005bbf'
  on-primary: '#ffffff'
  primary-container: '#1a73e8'
  on-primary-container: '#ffffff'
  inverse-primary: '#adc7ff'
  secondary: '#5c5f60'
  on-secondary: '#ffffff'
  secondary-container: '#dee0e1'
  on-secondary-container: '#606364'
  tertiary: '#9e4300'
  on-tertiary: '#ffffff'
  tertiary-container: '#c55500'
  on-tertiary-container: '#0e0200'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#d8e2ff'
  primary-fixed-dim: '#adc7ff'
  on-primary-fixed: '#001a41'
  on-primary-fixed-variant: '#004493'
  secondary-fixed: '#e1e3e4'
  secondary-fixed-dim: '#c4c7c8'
  on-secondary-fixed: '#191c1d'
  on-secondary-fixed-variant: '#444748'
  tertiary-fixed: '#ffdbcb'
  tertiary-fixed-dim: '#ffb691'
  on-tertiary-fixed: '#341100'
  on-tertiary-fixed-variant: '#783100'
  background: '#f8f9fa'
  on-background: '#191c1d'
  surface-variant: '#e1e3e4'
typography:
  headline-lg:
    fontFamily: Inter
    fontSize: 24px
    fontWeight: '600'
    lineHeight: 32px
  headline-md:
    fontFamily: Inter
    fontSize: 20px
    fontWeight: '600'
    lineHeight: 28px
  body-md:
    fontFamily: Inter
    fontSize: 15px
    fontWeight: '400'
    lineHeight: 22px
  body-sm:
    fontFamily: Inter
    fontSize: 13px
    fontWeight: '400'
    lineHeight: 18px
  label-md:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '500'
    lineHeight: 20px
    letterSpacing: 0.1px
  label-sm:
    fontFamily: Inter
    fontSize: 11px
    fontWeight: '500'
    lineHeight: 16px
    letterSpacing: 0.5px
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  xs: 4px
  sm: 8px
  md: 16px
  lg: 24px
  xl: 32px
  bubble-padding-x: 16px
  bubble-padding-y: 10px
  container-max-width: 800px
---

## Brand & Style
This design system is built for an efficient, approachable, and highly legible German sports-tech interface. The brand personality is **Professional, Active, and Trustworthy**, reflecting the reliability needed for matchmaking in fitness and sport.

The design style is **Corporate / Modern Minimalism**. It prioritizes clarity and speed of interaction. We use generous whitespace and a restricted color palette to keep the focus on the conversation. The interface should feel "light" and energetic, avoiding heavy shadows or decorative elements that could distract from the primary goal: finding the right sport partner.

## Colors
The color strategy uses a "Functional Blue" approach. The **Sport Navi Blue** serves as the primary action color and the identifier for user-generated content. 

- **Primary:** Used for user message bubbles, primary action buttons, and active states.
- **Surface/Background:** The main application canvas is a very light gray (#f8f9fa) to reduce screen glare, while the active chat container is pure white to create a clear "stage" for the interaction.
- **Assistant Surface:** A muted light gray (#f1f3f4) distinguishes the AI's responses from the user's, ensuring a clear visual dialogue flow without high-contrast fatigue.

## Typography
We utilize **Inter** across all levels for its exceptional legibility and neutral, modern character. 

The core body text is set to **15px** to balance density with readability, specifically optimized for long-form chat interactions. Headlines use a medium-bold weight (600) to provide clear hierarchy without feeling overly aggressive. Letter spacing is kept tight for body copy but slightly increased for labels and small metadata to ensure clarity on mobile devices.

## Layout & Spacing
The layout follows a **Fixed-Width Chat Container** model for desktop, centered on the screen, which transitions to a **Fluid Grid** on mobile. 

- **Grid:** A standard 8px spacing system ensures rhythm. 
- **Margins:** 16px horizontal margins on mobile, increasing to 24px on tablet.
- **Chat Flow:** Messages are vertically stacked with 8px spacing between messages from the same sender, and 16px spacing when the sender changes. This grouping helps users scan the conversation history quickly.

## Elevation & Depth
This system uses **Tonal Layering** rather than heavy shadows to indicate depth. 

- **Level 0 (Background):** The #f8f9fa application background.
- **Level 1 (Canvas):** The white (#ffffff) chat area.
- **Level 2 (Interaction):** Message bubbles and inputs. These do not use shadows; instead, they rely on color contrast and subtle 1px borders (#e0e0e0) only where necessary for boundary definition.
- **Overlays:** Modals or partner profile cards use a very soft, highly diffused ambient shadow (12% opacity, 16px blur) to appear "lifted" above the conversation.

## Shapes
The shape language is friendly and ergonomic. We use two distinct radii to create a visual distinction between "Content" and "Interface."

- **Message Bubbles:** Use an **18px** radius. This high degree of rounding creates a "capsule" feel that is synonymous with modern messaging apps, making the chat feel more human and less like a data form.
- **Input Fields & UI Controls:** Use a **12px** radius. This slightly sharper (but still soft) radius signals functional, interactive elements.
- **Buttons:** Match the input radius (12px) for consistency in the action area.

## Components

### Message Bubbles
- **User:** Primary Blue (#1a73e8) background with White text. Aligned to the right. 18px corner radius, with the bottom-right corner slightly sharpened (4px) to indicate direction.
- **Assistant:** Light Gray (#f1f3f4) background with Dark Gray (#202124) text. Aligned to the left. 18px corner radius, with the bottom-left corner slightly sharpened (4px).

### Input Field
- **Text Input:** White background with a 1px border (#dadce0). 12px border radius. Placeholder text in #70757a. On focus, the border thickens to 2px and changes to Sport Navi Blue.
- **Send Button:** Icon-only or text-link, utilizing the Primary Blue.

### Chips (Quick Replies)
- Use for suggested sport types or times.
- Transparent background with a 1px border (#dadce0). 
- Text in Primary Blue. 
- Fully pill-shaped (24px+ radius).

### Cards (Partner Matches)
- White background with a 1px #e0e0e0 border. 
- Contains a profile photo (rounded-full), name (Headline-MD), and sport interests (Chips).
- 16px internal padding.

### Checkboxes & Radios
- Utilize the Primary Blue for checked states. 
- Large hit targets (min 44x44px) for mobile accessibility when filtering sport partners.