import type { App, Plugin } from "obsidian";

import { requireApiVersion } from "obsidian";

import type { SettingsTabContext } from "./SettingsTabContext";

interface InternalApp extends App {
    setting: {
        openTabById: (id: string) => void;
    };
}

/**
 * Refresh the settings UI, version-gated.
 *
 * On Obsidian v1.13.0+ (declarative), calls `tabInstance.update()` to
 * re-evaluate the setting definitions. On v1.12.x and earlier (imperative),
 * reopens the plugin's own settings tab via `openTabById` to trigger
 * `display()` again, which rebuilds the conditional fields.
 */
export function refreshSettings(context: SettingsTabContext): void {
    const { plugin, tabInstance } = context;

    if (requireApiVersion("1.13.0") && tabInstance) {
        tabInstance.update();
    } else {
        const app = plugin.app as unknown as InternalApp;
        const manifestId = (plugin as unknown as Plugin).manifest.id;
        app.setting.openTabById(manifestId);
    }
}

/**
 * Re-render a settings section, version-gated.
 *
 * On Obsidian v1.13.0+ (declarative), calls `tabInstance.update()` to
 * re-evaluate the setting definitions in place. On v1.12.x and earlier
 * (imperative), empties the section container and re-invokes the supplied
 * render function to rebuild the section DOM.
 */
export function reRenderSection(
    context: SettingsTabContext,
    renderFn: (context: SettingsTabContext) => void
): void {
    const { containerEl, tabInstance } = context;

    if (requireApiVersion("1.13.0") && tabInstance) {
        tabInstance.update();
    } else {
        containerEl.empty();
        renderFn(context);
    }
}

/**
 * Refresh settings UI visibility state, version-gated.
 *
 * On Obsidian v1.13.0+ (declarative), calls `tabInstance.refreshDomState()`
 * which cheaply re-evaluates `visible`/`disabled` predicates in place without
 * rebuilding the DOM. This is the correct call when only conditional
 * visibility changes (e.g., toggling a field that shows/hides a sub-field).
 *
 * On v1.12.x and earlier (imperative), falls back to `refreshSettings`
 * (reopening the tab) since there is no in-place visibility refresh.
 *
 * Use this instead of {@link refreshSettings} or {@link reRenderSection}
 * when only visibility predicates change. Reserve those utilities for
 * structural changes (added/removed DOM elements, slider value updates).
 */
export function refreshVisibility(context: SettingsTabContext): void {
    const { tabInstance } = context;

    if (requireApiVersion("1.13.0") && tabInstance) {
        tabInstance.refreshDomState();
    } else {
        refreshSettings(context);
    }
}