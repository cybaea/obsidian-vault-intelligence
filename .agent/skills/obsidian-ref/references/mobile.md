<!--
Source: Based on Obsidian community best practices
Last synced: See sync-status.json for authoritative sync dates
Update frequency: Check Obsidian community discussions for updates
-->

# Mobile & Platform Compatibility

## Platform Detection Classes

Obsidian applies CSS classes to the body element based on the current platform. Use these for platform-specific styling:

### Device Type Classes
- `.is-mobile` - Applied on any mobile device (iOS or Android)
- `.is-tablet` - Applied on tablet-sized mobile devices
- `.is-phone` - Applied on phone-sized mobile devices
- `.is-ios` - Applied on iOS devices (use with `.is-mobile`)

**Note**: There is no `.is-desktop` class. To target desktop, use `:not(.is-mobile)`.

### Operating System Classes (Desktop Only)
- `.mod-windows` - Windows
- `.mod-macos` - macOS
- `.mod-linux` - Linux

**Note**: There are no `.mod-ios` or `.mod-android` CSS classes. For iOS, use `.is-ios`. For Android, use `.is-mobile:not(.is-ios)`.

### Example Usage
```css
/* Desktop-only styling (no .is-desktop class exists) */
body:not(.is-mobile) .my-sidebar {
  width: 300px;
}

/* Mobile adjustments */
.is-mobile .my-sidebar {
  width: 100%;
  position: fixed;
}

/* iOS-specific fixes */
.is-mobile.is-ios .my-element {
  -webkit-overflow-scrolling: touch;
}

/* Tablet vs phone */
.is-tablet .my-modal {
  width: 600px;
}
.is-phone .my-modal {
  width: 100%;
}

/* OS-specific (desktop only) */
.mod-macos .titlebar {
  padding-left: 80px; /* Space for traffic lights */
}
```

## Platform API (TypeScript)

For JavaScript/TypeScript, use the `Platform` object from the Obsidian API:

```typescript
import { Platform } from 'obsidian';

// Device type
Platform.isDesktop    // UI is in desktop mode
Platform.isMobile     // UI is in mobile mode
Platform.isPhone      // Mobile with limited screen space
Platform.isTablet     // Mobile with larger screen space

// App type
Platform.isDesktopApp // Electron desktop app
Platform.isMobileApp  // Capacitor mobile app
Platform.isIosApp     // iOS app
Platform.isAndroidApp // Android app

// Operating system
Platform.isMacOS      // macOS (or iOS/iPadOS)
Platform.isWin        // Windows
Platform.isLinux      // Linux
```

## Touch Considerations

- **Minimum touch targets**: Buttons and interactive elements should be at least 44x44px on mobile
- **Hover states**: Avoid relying solely on `:hover` - provide alternative visual feedback for touch
- **Spacing**: Increase padding between interactive elements to prevent mis-taps

## Testing Recommendations

- Test on both iOS and Android devices (behavior can differ)
- Test in both light and dark modes on mobile
- Verify landscape and portrait orientations
- Check that modals and popups are usable on smaller screens
- Test with on-screen keyboard visible (ensure inputs aren't obscured)


