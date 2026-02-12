import { Notice, Setting, setIcon } from "obsidian";

import { logger } from "../../utils/logger";
import { SettingsTabContext } from "../SettingsTabContext";

export async function renderStorageSettings(context: SettingsTabContext): Promise<void> {
    const { containerEl, plugin } = context;

    containerEl.createDiv({ cls: 'vault-intelligence-settings-subheading' }, (div) => {
        div.setText('Manage local vector databases and sharded storage.');
    });

    // --- 1. Database Index ---
    new Setting(containerEl)
        .setName('Active database shards')
        .setHeading();

    containerEl.createDiv({ cls: 'setting-item-description' }, (div) => {
        div.setText('The plugin stores separate indexes for different embedding models to prevent data corruption. Below are the shards currently stored in your vault.');
    });

    const listContainer = containerEl.createDiv("vi-storage-list");
    await refreshStorageList(context, listContainer);

    // --- 2. Maintenance ---
    new Setting(containerEl)
        .setName('Maintenance')
        .setHeading();

    new Setting(containerEl)
        .setName('Purge all data')
        .setDesc('Completely removes all local indexes, cached models, and stored states. Use this if you encounter persistent errors or wish to clean up all plugin data.')
        .addButton(btn => btn
            .setButtonText('Purge and reset')
            .setWarning()
            .onClick(() => {
                // We'll use a simple Notice or custom modal here to avoid 'confirm' lint
                const notice = new Notice("Purging all data... Click here to confirm or wait to cancel.", 10000);
                (notice as { messageEl: HTMLElement }).messageEl.onclick = async () => {
                    try {
                        await plugin.persistenceManager.purgeAllData();
                        new Notice("All data purged. Reloading plugin...");
                        // Reload via internal API if possible, or just notice
                        const pluginId = plugin.manifest.id;
                        const app = plugin.app as { plugins?: { disablePlugin: (id: string) => Promise<void>; enablePlugin: (id: string) => Promise<void> } };
                        if (app.plugins) {
                            await app.plugins.disablePlugin(pluginId);
                            await app.plugins.enablePlugin(pluginId);
                        }
                    } catch (e) {
                        logger.error("Purge failed", e);
                        new Notice("Purge failed. Check console for details.");
                    }
                };
            }));
}

async function refreshStorageList(context: SettingsTabContext, container: HTMLElement): Promise<void> {
    const { plugin } = context;
    container.empty();

    try {
        const states = await plugin.persistenceManager.listAvailableStates();
        const activeSanitizedId = plugin.persistenceManager.getSanitizedModelId(
            plugin.settings.embeddingModel,
            plugin.settings.embeddingDimension
        );

        if (states.length === 0) {
            container.createDiv({ cls: "vi-storage-empty", text: "No database shards found." });
            return;
        }

        states.forEach((stateFile: string) => {
            const isMatch = stateFile.includes(activeSanitizedId);

            const item = container.createDiv("vi-storage-item");
            const info = item.createDiv("vi-storage-info");

            // Extract a readable name from the filename: graph-state-<id>.msgpack
            const modelPart = stateFile.replace('graph-state-', '').replace('.msgpack', '');

            info.createDiv({ cls: "vi-storage-filename", text: modelPart });
            if (isMatch) {
                const badge = info.createSpan({ cls: "vi-storage-badge-active", text: " Active " });
                setIcon(badge.createSpan(), "lucide-check");
            }

            const actions = item.createDiv("vi-storage-actions");
            const delBtn = actions.createEl("button", { attr: { "aria-label": "Delete shard" }, cls: "clickable-icon vi-storage-delete" });
            setIcon(delBtn, "lucide-trash-2");

            if (isMatch) {
                delBtn.disabled = true;
                delBtn.addClass("is-disabled");
                delBtn.setAttr("title", "Cannot delete the active shard.");
            } else {
                delBtn.onclick = () => {
                    new Notice(`Deleting shard: ${stateFile}... Click again to confirm.`, 5000);
                    delBtn.onclick = async () => {
                        await plugin.persistenceManager.deleteState(stateFile);
                        new Notice(`Deleted ${stateFile}`);
                        await refreshStorageList(context, container);
                    };
                };
            }
        });
    } catch (e) {
        logger.error("Failed to list storage states", e);
        container.createDiv({ cls: "vi-storage-error", text: "Error loading storage list." });
    }
}
