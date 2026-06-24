# Troubleshooting

Common issues and fixes for Vault Intelligence.

## Performance

### Not using WebGPU for local Transformers.js embedding models

If

1.  you have installed Obsidian using flatpak (which usually means you are on Linux), and 
2.  you are using Transformers.js, and 
3.  you want to take full advantage of your GPU (via WebGPU), 

then you need to start Obsidian with the flags:

```bash
flatpak run md.obsidian.Obsidian --enable-unsafe-webgpu --enable-features=Vulkan
```

You can make this permanent by running this once:

```bash
# Ensure the configuration directory exists
mkdir -p ~/.var/app/md.obsidian.Obsidian/config/obsidian/

# Append your flags to the user-flags file
echo "--enable-unsafe-webgpu" >> ~/.var/app/md.obsidian.Obsidian/config/obsidian/user-flags.conf
echo "--enable-features=Vulkan" >> ~/.var/app/md.obsidian.Obsidian/config/obsidian/user-flags.conf
```

## API & connection issues

### "429 Too Many Requests"

This means you are hitting Google's rate limit (Tokens Per Minute or Requests Per Minute).

* **Cause:** Often happens during the initial vault index if you have many notes, or if your **Context Window Budget** is set very high (sending 1M tokens at once).
* **Fix 1:** Go to **Settings > Indexing & Search** and increase the **Indexing delay** to `1000ms` or higher.
* **Fix 2:** Lower your **Context window budget** to `100,000` tokens.

### "Model not found"

* **Cause:** You might be trying to use a newer model (like `gemini-3-flash-preview`) that hasn't rolled out to your API key's region yet, or you have a typo in the model name.
* **Fix:** Check the [Gemini Models list](https://ai.google.dev/models) and ensure the model name in **Settings** exactly matches a valid model ID.

---

## Search & quality issues

### "The agent says it can't find information, but I know I have a note on it."

* **Cause 1 (Search Strictness):** The **Minimum similarity score** might be too high.
  * **Fix:** Lower it to `0.4` or `0.35` in Settings.
* **Cause 2 (Indexing):** The note might not be indexed yet.
  * **Fix:** Toggle a small change in the note to force a re-index, or restart Obsidian to trigger a full vault scan.

### "The agent answers from general knowledge, not my notes."

* **Cause:** The agent might feel "confident" enough to answer without checking your vault.
* **Fix:** Be explicit. Ask _"Based on my notes..."_ or use the `@` mention feature to point it to specific folders.

---

## Debugging

If you are reporting a bug on GitHub, please provide logs:

1. Go to **Settings > Advanced**.
2. Set **Log level** to `Debug`.
3. Open the Developer Console (`Ctrl+Shift+I` on Windows/Linux, `Cmd+Opt+I` on Mac).
4. Perform the action that fails.
5. Copy the logs starting with `[VaultIntelligence]`.
