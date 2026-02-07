# Uninstall & Cleanup Guide
    
## Uninstallation
    
To completely remove the Vault Intelligence plugin from your vault:
    
1.  **Open Settings**: Go to `Settings > Community Plugins`.
2.  **Disable Plugin**: Toggle the switch off for "Vault Intelligence".
3.  **Uninstall Plugin**: Click the "Uninstall" button (trash icon).
    
## Cleanup Data
    
Vault Intelligence stores its search index and graph data in a hidden folder to keep your vault clean. This folder is **NOT** automatically removed when you uninstall the plugin (to preserve data if you reinstall).
    
To ensure a completely clean removal, you must delete this data.
    
### Method 1: Purge & Reset (Recommended)
    
_Before_ uninstalling the plugin:
    
1.  Go to `Settings > Vault Intelligence`.
2.  Navigate to the **Advanced** tab.
3.  Scroll down to the **Danger Zone**.
4.  Click **Purge & Reset**.
    
This will automatically delete the hidden data folder and reset the plugin's state. You can then uninstall the plugin safely.
    
### Method 2: Manual Deletion
    
If you have already uninstalled the plugin, you can manually delete the data folder:
    
1.  Open your vault in your file explorer (Finder / Explorer).
2.  Locate the `.vault-intelligence` folder in the root of your vault.
    -   _Note: You may need to enable "Show hidden files" in your operating system settings._
3.  Delete the entire `.vault-intelligence` folder.
    
## Is my data safe?
    
Yes. The plugin only stores **derived** data (search indexes and relationship graphs) in this folder. It does not store your actual notes or any original content. Deleting this folder simply resets the plugin's "brain" – it **will not** delete your notes.
