# GS Control Center - UI/UX Guide

## Visual Style Reference

### Color System

#### Primary Colors
```
Gold (Primary Accent)
  Color: #c89b3c
  Usage: Nav active, titles, primary buttons
  RGB: 200, 155, 60
  HSL: 39°, 54%, 51%

Cyan (Secondary Accent)
  Color: #00d4ff
  Usage: Secondary highlights, gradients
  RGB: 0, 212, 255
  HSL: 188°, 100%, 50%

Red (Alert/Action)
  Color: #ff4444
  Usage: Critical warnings, delete actions
  RGB: 255, 68, 68
  HSL: 0°, 100%, 63%
```

#### Status Colors
```
Good (Success)
  Color: #00ff88
  Usage: Healthy status, success states
  Usage: "Optimized" badges, good metrics

Warning (Alert)
  Color: #ffaa00
  Usage: Medium concern, caution states
  Usage: "Needs Optimization" badges, warning metrics

Critical (Error)
  Color: #ff4444
  Usage: High concern, error states
  Usage: Critical metrics, errors
```

#### Background Colors
```
Dark Base
  Color: #0a0e27
  Usage: Main application background
  Transparency: 100%

Dark Secondary
  Color: #050810
  Usage: Deepest dark layers
  Transparency: 100%

Card Background
  Color: rgba(15, 20, 45, 0.6)
  Usage: Card/panel backgrounds
  Transparency: 60%

Border Color
  Color: rgba(200, 155, 60, 0.2)
  Usage: Borders and dividers
  Transparency: 20%
```

### Typography

```
Font Family: Inter, Segoe UI, Tahoma, Geneva, Verdana, sans-serif

Sizes:
- Display: 28px (Header title)
- Heading 1: 24px (Section titles)
- Heading 2: 16px (Card titles)
- Body: 14px (General text)
- Small: 12px (Labels, descriptions)
- Tiny: 10px (Status badges)

Weights:
- Light: 300 (Descriptions)
- Regular: 400 (Body text)
- Medium: 500 (Interactive elements)
- Semi-bold: 600 (Card titles)
- Bold: 700 (Headings)
- Extra-bold: 900 (Main titles)

Letter Spacing:
- Tight: -0.5px (Body)
- Normal: 0px (General)
- Wide: 1px (Labels)
- Extra-wide: 2px (Logo, Status)
```

### Component Specifications

#### Sidebar
```
Width: 100px
Background: Linear gradient (vertical)
  From: rgba(5, 8, 16, 0.9)
  To: rgba(15, 20, 45, 0.7)
Border: 1px solid rgba(200, 155, 60, 0.1)

Logo Section:
  Size: 70x70px
  Icon: 32px
  Animation: Float (3s ease-in-out)
  
Navigation Items:
  Size: 60x60px
  Background: rgba(200, 155, 60, 0.05)
  Border: 1px solid rgba(200, 155, 60, 0.1)
  Border-radius: 10px
  Gap: 15px
  
  Hover State:
    Background: rgba(200, 155, 60, 0.1)
    Border Color: rgba(200, 155, 60, 0.3)
    Color: Primary
    Transform: translateY(-2px)
  
  Active State:
    Background: Linear gradient (135deg)
      From: rgba(200, 155, 60, 0.2)
      To: rgba(0, 212, 255, 0.1)
    Border Color: Primary
    Box-shadow: 0 0 20px rgba(200, 155, 60, 0.2)
    Color: Primary

Status Indicator:
  Dot Size: 8x8px
  Color (Active): #00ff88
  Glow: 0 0 10px rgba(0, 255, 136, 0.5)
  Animation: Pulse 2s ease-in-out infinite
```

#### Header
```
Height: 90px
Background: Linear gradient (horizontal)
  From: rgba(15, 20, 45, 0.8)
  To: rgba(20, 30, 60, 0.6)
Border: 1px solid rgba(200, 155, 60, 0.1)
Padding: 20px 30px

Title:
  Font: 28px, Extra-bold
  Gradient: Gold to Cyan (90deg)
  Letter-spacing: 1px
  
Subtitle:
  Font: 12px, Regular
  Color: Text-muted
  Letter-spacing: 1px

Buttons:
  Size: 40x40px
  Background: rgba(200, 155, 60, 0.05)
  Border: 1px solid rgba(200, 155, 60, 0.2)
  Border-radius: 8px
  Gap: 20px
  
  Notification Badge:
    Size: 20x20px
    Background: Alert Red
    Font: 10px, Bold
    Animation: Pulse 2s ease-in-out infinite
```

#### Stat Card
```
Background: Linear gradient (135deg)
  From: rgba(15, 20, 45, 0.7)
  To: rgba(20, 30, 60, 0.5)
Border: 1px solid rgba(200, 155, 60, 0.2)
Border-radius: 12px
Padding: 20px
Display: Flex, gap 20px

Icon Container:
  Size: 50x50px
  Background: rgba(200, 155, 60, 0.1)
  Border-radius: 10px
  Color: Primary

Content:
  Title: 12px, Uppercase, Text-muted, 1px spacing
  Value: 28px, Bold, Primary
  Unit: 14px, Text-muted
  
Progress Bar:
  Height: 6px
  Background: rgba(0, 0, 0, 0.3)
  Border-radius: 3px
  Fill Color: Gradient (90deg, Good, transparent)

Hover State:
  Border-color based on status:
    Good: rgba(0, 255, 136, 0.5)
    Warning: rgba(255, 170, 0, 0.5)
    Critical: rgba(255, 68, 68, 0.5)
  Box-shadow: 0 0 20px [status-color, 0.1]
  Transform: translateY(-5px)
```

#### Buttons

**Primary Button:**
```
Padding: 14px 28px
Background: Linear gradient (135deg)
  From: Primary
  To: rgba(200, 155, 60, 0.7)
Color: Background (dark)
Font: 14px, Semi-bold, Uppercase, 1px spacing
Border: 1px solid rgba(200, 155, 60, 0.5)
Border-radius: 10px
Box-shadow: 0 0 20px rgba(200, 155, 60, 0.3)

Hover:
  Box-shadow: 0 0 30px rgba(200, 155, 60, 0.5)
  Border-color: Primary
  
Pressed: Scale 0.95
```

**Secondary Button:**
```
Padding: 14px 28px
Background: Transparent
Color: Primary
Font: 14px, Semi-bold, Uppercase, 1px spacing
Border: 1px solid rgba(200, 155, 60, 0.3)
Border-radius: 10px

Hover:
  Background: rgba(200, 155, 60, 0.1)
  Border-color: Primary
  
Pressed: Scale 0.95
```

#### Cards/Panels
```
Background: Linear gradient (135deg)
  From: rgba(15, 20, 45, 0.7)
  To: rgba(20, 30, 60, 0.5)
Border: 1px solid rgba(200, 155, 60, 0.2)
Border-radius: 12px
Padding: 20px
Position: Relative

Top Border Accent:
  Height: 1px
  Gradient: 90deg transparent → Primary → transparent

Hover State (interactive):
  Border-color: rgba(200, 155, 60, 0.4)
  Box-shadow: 0 0 20px rgba(200, 155, 60, 0.1)
```

#### Toggle Switch
```
Width: 50px
Height: 28px
Background: rgba(200, 155, 60, 0.2)
Border: 1px solid rgba(200, 155, 60, 0.3)
Border-radius: 20px

Slider Ball:
  Size: 20x20px
  Background: White
  Border-radius: 50%
  Position: Left 4px

Checked State:
  Background: Linear gradient (135deg)
    From: Good
    To: rgba(0, 255, 136, 0.7)
  Border-color: Good
  Slider Ball Position: Left 26px
  Transition: 0.3s ease
```

### Animations

#### Page Transitions
```
Type: Fade + Slide
Duration: 0.5s
Easing: ease-in-out
Entry:
  Opacity: 0 → 1
  
Exit:
  Opacity: 1 → 0
```

#### Component Animations
```
Hover Effects:
  Type: Scale + Shadow
  Duration: 0.3s
  Y: 0 → -5px
  Scale: 1 → 1.05

Card Entrance:
  Type: Fade + Slide
  Duration: 0.3s
  Stagger: 0.1s per item
  Y: 20px → 0

Progress Bar:
  Type: Width animation
  Duration: 0.6s
  Easing: easeOut

Pulse (Status):
  Duration: 2s
  Opacity: 1 → 0.5 → 1
  Box-shadow: [pulse animation]

Float (Logo):
  Duration: 3s
  Y: 0 → -5px → 0
  Repeat: Infinite
```

### Layout Breakpoints

```
Desktop:
  Sidebar: 100px
  Main Content: Flex
  Cards Grid: auto-fit, minmax(300px, 1fr)
  
Tablet (1024px):
  Cards Grid: auto-fit, minmax(250px, 1fr)
  
Mobile (768px):
  Sidebar: Hidden/Drawer
  Cards Grid: 1 column
```

### Accessibility

```
Color Contrast Ratios:
- Primary + Background: 4.5:1 (AA)
- Status colors: All > 4.5:1
- Text + Background: 7:1 (AAA)

Focus States:
- All interactive elements have visible focus outline
- Keyboard navigation supported
- Tab order logical

Icons:
- All icons have aria-labels
- Icon buttons have titles
- Decorative icons have aria-hidden
```

### Responsive Typography

```
Desktop (1400+):
  Display: 28px
  H1: 24px
  H2: 16px
  Body: 14px

Tablet (1024):
  Display: 24px
  H1: 20px
  H2: 14px
  Body: 13px

Mobile (768):
  Display: 20px
  H1: 18px
  H2: 13px
  Body: 12px
```

---

This comprehensive guide ensures consistent UI/UX across the entire application while maintaining the LoL-inspired aesthetic.
