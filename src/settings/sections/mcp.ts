import { SettingGroup, ButtonComponent, ToggleComponent } from "obsidian";

import { renderKeyValueEditor } from "../components";
import { SettingsTabContext } from "../SettingsTabContext";
import { MCPServerConfig } from "../types";

export function renderMcpSettings({ containerEl, plugin }: SettingsTabContext): void {
    containerEl.empty();
    
    const mcpHeading = activeDocument.createDocumentFragment();
    mcpHeading.appendText('External ' + 'MCP' + ' servers');
    mcpHeading.createDiv({ cls: 'setting-item-description' }, (div: HTMLDivElement) => {
        div.createSpan({ text: "Connect external model context protocol (" + "MCP" + ") servers to allow AI models to perform external actions, such as fetching weather, reading databases, or integrating with other tools." });
    });
    new SettingGroup(containerEl).setHeading(mcpHeading);

    const listContainer = containerEl.createDiv("mcp-server-list");
    listContainer.setCssProps({ "margin-bottom": "2em" });
    
    const renderList = () => {
        listContainer.empty();
        const servers = plugin.settings.mcpServers || [];
        
        if (servers.length === 0) {
            listContainer.createEl("em", { text: 'No ' + 'MCP' + ' servers configured.' });
        } else {
            servers.forEach((server, index) => {
                const serverDiv = listContainer.createDiv("mcp-server-item");
                serverDiv.setCssProps({ "border": "1px solid var(--background-modifier-border)", "border-radius": "8px", "margin-bottom": "1em", "padding": "1em" });
                
                const headerRow = serverDiv.createDiv("mcp-server-header");
                headerRow.setCssProps({ "align-items": "center", "display": "flex", "justify-content": "space-between", "margin-bottom": "0.5em" });
                
                const title = headerRow.createEl("h4", { text: server.name || "Unnamed Server" });
                title.setCssProps({ "margin": "0" });
                
                // Status indicator
                const mcpManager = plugin.mcpClientManager as { connections?: Map<string, { status: string }> };
                const connection = mcpManager.connections ? mcpManager.connections.get(server.id) : undefined;
                let status = 'disabled';
                if (connection) status = connection.status;
                else if (server.enabled) status = 'disconnected';
                
                const statusBadge = headerRow.createSpan("mcp-status");
                statusBadge.textContent = status.toUpperCase();
                statusBadge.setCssProps({ "border-radius": "4px", "font-size": "0.8em", "margin-left": "10px", "padding": "2px 6px" });
                if (status === 'connected') statusBadge.setCssProps({ "background-color": "var(--interactive-success)" });
                else if (status === 'error' || status === 'untrusted') statusBadge.setCssProps({ "background-color": "var(--interactive-error)" });
                else statusBadge.setCssProps({ "background-color": "var(--background-modifier-border)" });
                
                new ToggleComponent(headerRow)
                    .setValue(server.enabled)
                    .onChange(async (v) => {
                        if (plugin.settings.mcpServers && plugin.settings.mcpServers[index]) plugin.settings.mcpServers[index].enabled = v;
                        await plugin.saveSettings(false);
                        // Re-initialize connections dynamically
                        const manager = plugin.mcpClientManager as { terminate(): Promise<void>; initialize(): Promise<void> };
                        await manager.terminate();
                        await manager.initialize();
                        renderList(); // re-render to reflect disabled state logic if needed
                    });
                
                const detailsRow = serverDiv.createDiv("mcp-server-details");
                detailsRow.createEl("p", { cls: "setting-item-description", text: `Type: ${server.type === 'stdio' ? 'Stdio (Local Process)' : server.type === 'streamable_http' ? 'Streamable HTTP (Remote)' : 'SSE (Remote)'}` });
                
                const errMessage = (connection as { errorMessage?: string })?.errorMessage;
                if (status === 'error' && errMessage) {
                    const err = detailsRow.createEl("p", { cls: "setting-item-description", text: `Error: ${errMessage}` });
                    err.setCssProps({ "color": "var(--text-error)" });
                }
                
                const btnRow = serverDiv.createDiv("mcp-server-actions");
                btnRow.setCssProps({ "display": "flex", "gap": "0.5em", "margin-top": "1em" });
                
                if (status === 'untrusted') {
                    new ButtonComponent(btnRow)
                        .setButtonText("Review & trust")
                        .setCta()
                        .onClick(async () => {
                            const manager = plugin.mcpClientManager as { 
                                generateTrustHash(c: unknown): Promise<string>;
                                terminate(): Promise<void>; 
                                initialize(): Promise<void> 
                            };
                            const hash = await manager.generateTrustHash(server);
                            window.localStorage.setItem(`vi-mcp-trust-${server.id}`, hash);
                            
                            await manager.terminate();
                            await manager.initialize();
                            renderList();
                        });
                }

                new ButtonComponent(btnRow)
                    .setButtonText("Edit")
                    .onClick(() => {
                        renderEditor(server, index);
                    });
                    
                new ButtonComponent(btnRow)
                    .setButtonText("Remove")
                    .setWarning()
                    .onClick(async () => {
                        plugin.settings.mcpServers.splice(index, 1);
                        await plugin.saveSettings(false);
                        renderList();
                    });
            });
        }
    };

    const renderEditor = (server: MCPServerConfig | null, index: number = -1) => {
        containerEl.empty();
        
        const editorHeading = activeDocument.createDocumentFragment();
        editorHeading.appendText(server ? 'Edit ' + 'MCP' + ' server' : 'Add ' + 'MCP' + ' server');
        const editorGroup = new SettingGroup(containerEl).setHeading(editorHeading);
        
        let currentConfig: MCPServerConfig = server ? JSON.parse(JSON.stringify(server)) as MCPServerConfig : {
            enabled: true,
            id: crypto.randomUUID(),
            name: "",
            requireExplicitConfirmation: true,
            type: "stdio",
        };

        editorGroup.addSetting(setting => {
            setting.setName("Server name")
            .setDesc('A friendly name for this server (e.g., ' + '"GitHub" + " info)")')
            .addText(text => text
                .setValue(currentConfig.name)
                .onChange(v => currentConfig.name = v)
            );
        });

        editorGroup.addSetting(setting => {
            setting.setName("Connection type")
            .setDesc("Stdio runs a local binary. Remote options connect to a " + "URL" + ".")
            .addDropdown(drop => drop
                .addOptions({ "sse": "SSE (remote)", "stdio": "Stdio (desktop only)", "streamable_http": "Streamable HTTP (remote)" })
                .setValue(currentConfig.type)
                .onChange(v => {
                    currentConfig.type = v as "stdio" | "sse" | "streamable_http";
                    renderEditor(currentConfig, index); // re-render fields
                })
            );
        });

        if (currentConfig.type === "stdio") {
            const cmdDesc = activeDocument.createDocumentFragment();
            cmdDesc.appendText("Absolute path to the executable (e.g. /usr/local/bin/python or /opt/homebrew/bin/node). Avoid wrappers like 'npx' or relative paths.");
            
            editorGroup.addSetting(setting => {
                setting.setName("Command")
                .setDesc(cmdDesc)
                .addText(text => text
                    .setValue(currentConfig.command || "")
                    .onChange(v => currentConfig.command = v)
                );
                // Highlight warning
                setting.descEl.setCssProps({ "color": "var(--text-warning)" });
            });

            editorGroup.addSetting(setting => {
                setting.setName("Arguments")
                .setDesc("Enter arguments line by line (one argument per line). Avoids command-line string escaping issues.")
                .addTextArea(text => {
                    text.setValue((currentConfig.args || []).join('\n'));
                    text.onChange(v => {
                        currentConfig.args = v.split('\n').map(s => s.trim()).filter(s => s.length > 0);
                    });
                    text.inputEl.rows = 3;
                    return text;
                });
            });

            renderKeyValueEditor({
                container: containerEl,
                currentJson: currentConfig.env,
                description: "Define environment variables. Use 'Secret' to securely store API keys in the device keychain.",
                onChange: (v) => currentConfig.env = v,
                onSaveSecret: (key, value) => {
                    const storage = plugin.app.secretStorage as unknown as { setSecret?: (k:string, v:string)=>void };
                    if (storage && storage.setSecret) {
                        storage.setSecret(key, value);
                    }
                },
                secretKeyPrefix: `mcp-${currentConfig.id}-env-`,
                title: "Environment variables"
            });
        } else {
            editorGroup.addSetting(setting => {
                setting.setName("Server " + "URL")
                .setDesc("The full HTTP(S) " + "URL" + ` of the ${currentConfig.type === 'streamable_http' ? 'streamable HTTP' : 'SSE'} endpoint.`)
                .addText(text => text
                    .setValue(currentConfig.url || "")
                    .onChange(v => currentConfig.url = v)
                );
            });

            renderKeyValueEditor({
                container: containerEl,
                currentJson: currentConfig.remoteHeaders,
                description: "Optional HTTP headers for authentication. Use 'Secret' to securely store tokens in the device keychain.",
                onChange: (v) => currentConfig.remoteHeaders = v,
                onSaveSecret: (key, value) => {
                    const storage = plugin.app.secretStorage as unknown as { setSecret?: (k:string, v:string)=>void };
                    if (storage && storage.setSecret) {
                        storage.setSecret(key, value);
                    }
                },
                secretKeyPrefix: `mcp-${currentConfig.id}-headers-`,
                title: "HTTP headers"
            });
        }

        editorGroup.addSetting(setting => {
            setting.setName("Require explicit confirmation")
            .setDesc("If on, you will be prompted to confirm every execution of this server's tools. Turn off only for explicitly safe, read-only tools.")
            .addToggle(toggle => toggle
                .setValue(currentConfig.requireExplicitConfirmation)
                .onChange(v => currentConfig.requireExplicitConfirmation = v)
            );
        });

        const btnRow = containerEl.createDiv();
        btnRow.setCssProps({ "display": "flex", "gap": "1em", "margin-top": "2em" });

        new ButtonComponent(btnRow)
            .setButtonText("Cancel")
            .onClick(() => {
                renderMcpSettings({ app: plugin.app, containerEl, plugin }); // Go back
            });

        new ButtonComponent(btnRow)
            .setButtonText("Save")
            .setCta()
            .onClick(async () => {
                if (!plugin.settings.mcpServers) plugin.settings.mcpServers = [];
                
                if (index >= 0) {
                    plugin.settings.mcpServers[index] = currentConfig;
                } else {
                    plugin.settings.mcpServers.push(currentConfig);
                }
                await plugin.saveSettings(false);
                
                // Re-initialize connections to reflect updated config without reloading plugin
                const manager = plugin.mcpClientManager as { 
                    generateTrustHash(c: unknown): Promise<string>;
                    terminate(): Promise<void>; 
                    initialize(): Promise<void> 
                };
                const hash = await manager.generateTrustHash(currentConfig);
                window.localStorage.setItem(`vi-mcp-trust-${currentConfig.id}`, hash);
                
                await manager.terminate();
                await manager.initialize();
                renderMcpSettings({ app: plugin.app, containerEl, plugin }); // Go back
            });
    };

    renderList();

    if ((plugin.settings.mcpServers || []).length > 0) {
        containerEl.createEl("br");
    }

    new ButtonComponent(containerEl)
        .setButtonText('Add ' + 'MCP' + ' server')
        .setCta()
        .onClick(() => {
            renderEditor(null);
        });
}
