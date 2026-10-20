# Uninstall & Cleanup Guide

## Uninstallation

To completely remove the Vault Intelligence plugin from your vault:

1. **Open Settings**: Go to `Settings > Community Plugins`.
2. **Disable Plugin**: Toggle the switch off for "Vault Intelligence".
3. **Uninstall Plugin**: Click the "Uninstall" button (trash icon).

## Cleanup Data

Vault Intelligence keeps its data in two places, and neither contains your notes:

- **Local search indexes**: stored in your browser's IndexedDB and in the plugin folder (`data/`). Obsidian deletes the plugin folder automatically when you uninstall.
- **Synced graph state**: a slim MessagePack copy of vectors and graph edges in the hidden `.vault-intelligence/` folder at the root of your vault. It is **not** removed on uninstall (so your setup survives a reinstall) and it keeps itself out of Git via an automatic local `.gitignore`.

### Method 1: Purge all data (recommended, before uninstalling)

1. Go to `Settings > Vault Intelligence > Storage`.
2. Find the **Purge all data** setting and click **Purge and reset**.
3. Click the notice to confirm; the plugin removes all indexes, cached models, and stored states, then reloads itself.

You can now uninstall the plugin safely.

### Method 2: Manual deletion (after uninstalling)

1. Open your vault in your file explorer (Finder / Explorer).
2. Locate the `.vault-intelligence` folder in the root of your vault.
    - _Note: You may need to enable "Show hidden files" in your operating system settings._
3. Delete the entire `.vault-intelligence` folder.

### What stays behind

- Your notes: never touched — they live in the vault itself.
- API keys: stored in your operating system's keychain (or in the plugin's `data.json`, which Obsidian removes on uninstall). Clear keychain entries through your OS settings if you want them gone.

## Is my data safe?

Yes. Both locations store only **derived** data (search indexes and relationship graphs), never your notes or their original content. Deleting them simply resets the plugin's "brain" – it **will not** delete your notes.
