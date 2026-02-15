Vault Intelligence 7.0 is now live.

This update isn't about new toys. It's about maturity.

We realized that to truly bring agentic AI to your personal knowledge base, we needed a foundation that was more than just "functional"—it needed to be industrial.

So we rebuilt it.

https://github.com/cybaea/obsidian-vault-intelligence @obsidian@mas.to #Obsidian #PKM

---

1/ The core of 7.0 is **Security**.

We've introduced a strict "Opt-In" model for network access. The agent is now firewalled from your local network by default.

If you want it to talk to your local Ollama instance, you now explicitly grant that permission. You are in control.

---

2/ The second pillar is **Resilience**.

In distributed systems, "drift" is the enemy. We've implemented atomic file operations and isolated storage layers to ensure that what the agent "thinks" is in your vault is *exactly* what is on your disk.

No more hallucinations. No more drift.

---

3/ Finally, **Architecture**.

We've moved to a Service-Oriented Architecture (SOA). By decoupling our graph engine from the UI, we've ensured that heavy lifting never freezes your interface.

It means the plugin scales effortless to 10k, 20k, or 50k notes.

---

This release also brings a host of polish items:
*   Fixed "Similar Notes" race conditions
*   Hardened prompt injection defenses
*   Smarter timeout management for large models

It's the most stable version of Vault Intelligence ever.

---

A huge thank you to our Red Team testers for pushing this architecture to its limits. Breaking things in testing means they don't break in production.

Available now via BRAT.

[https://github.com/cybaea/obsidian-vault-intelligence](https://github.com/cybaea/obsidian-vault-intelligence)
