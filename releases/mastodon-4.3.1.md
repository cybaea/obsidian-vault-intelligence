I got tired of manually copying text from the chat window into my notes. It breaks flow.

So for v4.3.1, I added file system capabilities to the researcher. It can now create notes, update trackers, or refactor content directly from the chat.

https://github.com/cybaea/obsidian-vault-intelligence

`@obsidian@mas.to`
\#Obsidian \#PKM

---

Allowing an LLM to write to your file system is obviously risky.

We implemented a strict "Human-in-the-loop" protocol. The agent calculates the changes and presents a diff. Nothing is written to `app.vault` until you explicitly click "Approve". 🛡️

---

We also patched the system prompt generation to respect BCP 47 language codes properly.

If you set your language to French or Japanese, the agent actually thinks in that language now, rather than just translating the final output. It feels much more native.

---

The update is ensuring the agent only reads your active tab, not background ones.

Available now via BRAT. If you find it useful, a star on GitHub is always appreciated.

Thanks to the sponsors for keeping the lights on.

\#ObsidianMD #OpenSource
