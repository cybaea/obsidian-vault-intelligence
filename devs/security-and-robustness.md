---
description: Detailed security and robustness standards for the Vault Intelligence plugin, covering SSRF protection, credential management, and "Red Team" engineering.
head:
  - - meta
    - property: og:image
      content: https://cybaea.github.io/obsidian-vault-intelligence/images/security-robustness-banner.png
---

# Security and Robustness in Obsidian AI Plugins: Lessons from Vault Intelligence

The integration of autonomous artificial intelligence into a personal knowledge management system like Obsidian introduces new threats. You are bridging an inherently unpredictable, prompt-injectable entity (the large language model) with a highly privileged local environment that has access to the user’s private files, local network, and operating system.

During the development of the **Vault Intelligence** plugin, we dedicated a massive proportion of our engineering effort to system security, isolation, and stability. We adopted a strict "Red Team" mindset, assuming that the LLM acts as a "Confused Deputy" that will inevitably be compromised by malicious input.

This document serves as a transparency report for our users, detailing how we protect your data. For our fellow developers, it serves as a reference architecture and an actionable checklist for building secure, enterprise-grade AI plugins in the Obsidian ecosystem.

---

## 1. Core Philosophy

Our security model is built upon three foundational principles:

1.  **Trust but Verify (Human-in-the-Loop):** Autonomous actions that mutate state or access sensitive external boundaries must always present a transparent verification step to the user.
2.  **Defence in Depth:** No single layer of security should be a single point of failure. We implement overlapping safeguards at the UI, network, and file-system levels.
3.  **Principle of Least Privilege:** Agents, background Web Workers, and child processes are granted only the minimum permissions and environment variables strictly necessary to perform their tasks.

```mermaid
C4Context
    title Trust Boundaries in Vault Intelligence

    System_Boundary(obsidian, "Obsidian Host Environment (Trusted)") {
        Person(user, "User")
        System(core, "Plugin Core (Main Thread)", "Orchestrates UI and APIs. Atomic filesystem access.")
        System(worker, "Web Worker Sandbox", "Orama Vector DB & Graphology. Isolated from Vault API.")
        System(storage, "Secure Storage", "OS-level Keychain (Encrypted)")
    }

    System_Boundary(untrusted, "External/Agentic Boundaries (Untrusted)") {
        System_Ext(llm, "LLM Provider", "Gemini / Ollama")
        System_Ext(mcp, "MCP Servers", "External Tools & Scripts")
        System_Ext(web, "The Web", "URLs & Search Results")
    }

    Rel(user, core, "Grants explicit permissions")
    Rel(core, storage, "Reads/Writes API keys via SecretStorage")
    Rel(core, worker, "Delegates heavy processing via Comlink", "PostMessage")
    
    Rel(core, llm, "Sends prompts (Risk: Prompt Injection)")
    Rel(llm, core, "Returns tool calls (Risk: Malicious execution)")
    Rel(core, mcp, "Executes tools (Risk: Command Injection / RCE)")
    Rel(core, web, "Fetches data (Risk: SSRF / DNS Rebinding)")

    UpdateLayoutConfig($c4ShapeInRow="2", $c4BoundaryInRow="2")
```

---

## 2. Network and API security

AI plugins naturally require network access, making them prime targets for credential theft and Server-Side Request Forgery (SSRF).

### 2.1. Credential management and sync isolation

A common anti-pattern in Obsidian plugins is storing API keys in plain text within the `data.json` settings file. Because users frequently sync their vaults via third-party services (eg GitHub, iCloud, Obsidian Sync), this exposes sensitive API keys to sync-related leaks.

**Our Approach:**

-   **Native OS Keychains:** We utilize Obsidian's native `SecretStorage` API (available in v1.11.4+), which encrypts and securely stores credentials in the operating system's native keychain.
-   **Graceful Degradation:** For minimal Linux distributions lacking a functional keychain, we provide a resilient fallback ensuring the plugin degrades to plaintext storage gracefully (with a stark warning) rather than entering a crash loop.
-   **In-Memory Resolution:** For Model Context Protocol (MCP) servers requiring headers (eg `Authorization: Bearer <token>`), we use a `vi-secret:<key>` pointer in the JSON configuration. The plugin resolves these pointers in memory at runtime, ensuring tokens never touch the disk in plaintext.

### 2.2. SSRF (Server-Side Request Forgery) prevention

If an AI agent is granted a tool to read URLs (eg to summarize web pages), an attacker via a hidden prompt injection in a downloaded note could instruct the agent to query `http://localhost:8080/api/admin` to exfiltrate local development secrets, or query `http://169.254.169.254` to steal AWS cloud metadata credentials.

**Our Approach: Strict URL Gatekeeping**

We engineered a rigorous `isExternalUrl` utility that acts as an internal firewall for all AI-initiated network requests.

-   **Default Deny:** We strictly block all local network IPs, private IPv4/IPv6 ranges (eg `10.x.x.x`, `192.168.x.x`), and loopback addresses (`127.0.0.1`, `[::1]`).
-   **DNS Rebinding Protection:** Attackers often bypass IP filters using DNS Rebinding (where a public domain temporarily resolves to `127.0.0.1` during the request). To defeat this, we **enforce HTTPS** for all external requests. By forcing Chromium's TLS/SNI (Server Name Indication) handshake, a DNS rebound to `localhost` will instantly fail the certificate check, neutralizing the attack at the network layer.
-   **Opt-In Local Access:** Power users may want the AI to query local services (like a local Ollama instance). This is guarded behind an explicit "Allow local network access" toggle. Even when enabled, cloud metadata IPs remain permanently hard-blocked.

```mermaid
flowchart TD
    A[Agent requests URL fetch] --> B{URL Parser & Sanitization}
    B --> C{Is protocol HTTP/HTTPS?}
    C -- No --> D[Block Request]
    C -- Yes --> E{Is Loopback, Private IP, or Cloud Metadata?}
    E -- Yes --> F{Is Local Access Opt-In Enabled?}
    F -- No --> G[Block Request]
    F -- Yes --> I{Is Cloud Metadata 169.254.x.x?}
    I -- Yes --> G
    I -- No --> H[Allow Request]
    E -- No --> J{Is HTTPS?}
    J -- No --> K[Block Request <br> DNS Rebinding Protection]
    J -- Yes --> H
```

---

## 3. Agentic Execution: MCP and Zero-Click RCE

The Model Context Protocol (MCP) allows agents to execute code, query databases, and spawn local binaries via `stdio`. This represents a massive attack surface for Remote Code Execution (RCE). Integrating MCP required us to build rigorous execution checks to handle LLM quirks safely.

### 3.1. Trust hashing

If a malicious actor alters your synced configuration files (eg changing a `python search.py` command to a malicious shell script), the plugin might silently execute it upon loading.

**Our Approach:** Every MCP server configuration generates a cryptographic SHA-256 fingerprint based on its command, arguments, and environment variables. If a synced `data.json` file is maliciously altered, the hash mismatches the locally approved fingerprint, and execution is instantly hard-blocked until the user manually reviews and approves the change.

### 3.2. Tool name hashing and schema sanitization

Different LLM providers enforce strict constraints on tool names and JSON schema formats. Prepending server IDs to tool names to prevent collisions often exceeds length limits for APIs like Gemini.

**Our Approach:**

-   **Tool Name Hashing:** If our composite namespace exceeds 64 characters, we digest the original tool name into an 8-character hex hash, providing a deterministic and safe short name to prevent API errors.
-   **Schema Sanitization:** We implemented a recursive schema function that strips unsupported keys, traverses complex objects, and provides explicit type fallbacks (eg `type: 'string'`) to guarantee that LLM APIs accept the tool definition without crashing.

### 3.3. Execution boundaries and transport strategies

A compromised or poorly written MCP server might never return from a tool call, or it might stream gigabytes of garbage data.

**Our Approach:** We wrap every tool execution in a strict `Promise.race` containing the execution promise, a timeout promise, and user-initiated abort promises. We also separate connection logic into `Stdio`, `Sse`, and `StreamableHttp` transport strategies. This ensures that process lifecycle and timeouts are handled correctly per transport layer, without leaking zombie Node.js processes.

### 3.4. Host environment scrubbing and command injection protection

By default, Node.js child processes inherit the parent’s `process.env`. Passing this to a third-party MCP server would leak all your local terminal secrets (eg `AWS_ACCESS_KEY_ID`).

**Our Approach:**

-   **Environment Scrubbing:** We aggressively scrub the environment, passing only a strict allowlist of necessary variables (`PATH`, `DISPLAY`, `HOME`).
-   **Command Injection Prevention:** We strictly utilize `child_process.spawn` with explicit argument arrays. We never use string-based shell execution (`exec`), mathematically eliminating command injection via shell metacharacters (eg `&& rm -rf /`).
-   **Process Teardown:** Process tree teardowns utilize explicit PID killing (`pkill -P` / `taskkill`) to prevent zombie processes.

---

## 4. Filesystem safety: the confused deputy

When granting an AI write access to the filesystem, you must assume it will eventually attempt to overwrite sensitive notes—either due to a hallucination or an injected prompt. 

### 4.1. The confused deputy CSS defence

Before any file modification occurs, we present a `ToolConfirmationModal`. Crucially, we display the proposed changes inside a raw `<pre><code>` block rather than using Obsidian's Markdown renderer. This prevents an attacker from utilizing injected CSS (eg `<div style="display: none">Malicious payload</div>`) to hide the true, destructive payload from the human reviewer.

### 4.2. Path traversal and metadata sanitization

-   **Path Traversal Guard:** All paths generated by the LLM are stripped of leading slashes, resolved via path normalization, and checked against user-defined excluded folders. The agent cannot use relative paths (`../`) to escape the vault boundaries.
-   **Frontmatter Stripping:** We aggressively strip all YAML frontmatter from LLM-generated note bodies. Metadata updates are handled strictly programmatically to prevent the AI from corrupting Obsidian's index.

### 4.3. Atomic vault operations

We abandoned the read-then-modify pattern, as it is highly vulnerable to race conditions if the Obsidian cache is stale. We exclusively use `app.vault.process()` and `app.fileManager.processFrontMatter()`. These provide atomic file locking and AST-based resolution, guaranteeing that concurrent AI writes and human edits do not obliterate one another.

---

## 5. Robustness: engineering for scale

Security is moot if the application crashes or corrupts data. Handling asynchronous file events and high-throughput vector math on a production vault requires strict architectural discipline.

### 5.1. Hybrid "slim-sync" storage (split-brain prevention)

Vector indexes (like Orama) are massive binary trees. Storing a large index in the plugins folder rapidly consumes users' Obsidian Sync quotas and causes severe file conflicts.

**Our Approach:** We implemented a Split-Brain storage architecture.

-   **Hot Store (IndexedDB):** The full vector index, including raw text, is stored locally in the browser's IndexedDB. It is exceptionally fast and never syncs to the cloud.
-   **Cold Store (MessagePack):** We create a "slim" copy of the index, stripping out all raw text (`content: ""`) and retaining only the mathematical vectors and graph edges. This is serialized using MessagePack and synced across devices. Upon loading on a new device, the plugin hydrates the text on-demand from the vault to perfectly reconstruct the Hot Store.
-   **Split-Brain Fix:** We strictly namespace our IDB keys (`orama_index_buffer_` for the main thread vs `orama_index_` for the worker) to prevent data collisions and corruption during concurrent background syncs.

### 5.2. Event debouncing and backpressure

Typing rapidly triggers hundreds of vault modify events. Our `EventDebouncer` buffers events and batches them into optimal chunks. During critical background worker restarts, it applies a pause/resume backpressure mechanism, holding all real-time events in memory to ensure zero data loss.

### 5.3. Progressive stability degradation (WASM circuit breaker)

Local WebAssembly (WASM) execution can be unstable across different hardware profiles. If the indexer worker crashes due to Out-Of-Memory (OOM) errors, the plugin catches the failure, cleans up the zombie worker, and restarts with progressively safer constraints:

1.  Multi-threaded with SIMD.
2.  Single-threaded with SIMD (Mitigates threading deadlocks).
3.  Safe Mode (No SIMD).
4.  Circuit Breaker (Halts execution to prevent battery-draining infinite crash loops).

### 5.4. Resilient stream parsing

LLMs do not respect JSON schemas reliably. NDJSON streaming endpoints can break, and streaming network requests can hang. Our extraction utilities use a custom character-walking state machine that seamlessly extracts valid JSON even when the LLM hallucinates nested markdown fences, unescaped quotes, or trailing garbage.

### 5.5. Self-healing indices (Rabin-Karp drift recovery)

Because our Cold Store strips raw text, the index only knows the byte offsets of chunks. If a user edits the top of a file, those offsets drift. When hydrating text snippets, we use a **Modulo-Polynomial Rabin-Karp rolling hash** window over the surrounding characters. This allows us to find the drifted text efficiently, perfectly self-healing the context payload before it reaches the LLM.

### 5.6. Asynchronous race conditions and memory leaks (RAM)

In an orchestration environment handling multiple asynchronous tasks, timeouts are essential. Improper use of `setTimeout` combined with `Promise.race` can lead to unmanaged timers holding memory references indefinitely, causing severe RAM leakage.

**Our Approach:** We remediated hidden memory leaks throughout our process managers (eg `ToolRegistry`, `LocalEmbeddingService`, and `McpClientManager`) by explicitly clearing timeouts using `clearTimeout` in a `finally` block or upon successful promise resolution, ensuring no orphaned handles are left on the event loop.

### 5.7. Dead code and hidden storage leaks (disk)

Hidden disk storage leaks can occur when obsolete data is not properly garbage-collected. During our audits, we discovered that an explicit `wipeState` method in our persistence manager—intended to clean up unused model vector indices—was actually dead code. Because the architecture theoretically relied on this uninvoked method, massive blob files were piling up undetected on users' disks whenever features were toggled off or changed.

**Our Approach:** We completely removed the dead `wipeState` method. Instead, we forced the architecture to rely on its centralized, standardized garbage collection and lifecycle events, ensuring obsolete storage shards are automatically pruned without relying on ad-hoc manual wiping.

### 5.8. Regular expression denial of service (ReDoS)

Extensive parsing of Markdown wikilinks, metadata fronts, and code blocks can run into ReDoS vulnerabilities if regular expressions are poorly structured. Backtracking on long, unclosed tags can hang the UI thread. We audited and refactored our regular expressions (eg those in `link-parsing.ts`) to eliminate deep nesting and unbounded repetition, mathematically preventing Catastrophic Backtracking entirely.

---

## 6. The Obsidian AI Plugin Developer Checklist

If you are developing an AI agent or RAG system for Obsidian, we highly recommend auditing your codebase against this checklist:

### Security checklist

-   [ ] **Secret Storage:** Are you utilizing `app.secretStorage` instead of saving API keys and MCP server tokens in `data.json`? Do you have a plaintext fallback _only_ if the OS keyring explicitly fails?
-   [ ] **SSRF Guards:** Are you validating all URLs fetched by the agent to prevent queries to `localhost`, `127.0.0.1`, private subnets, and `169.254.169.254`?
-   [ ] **DNS Rebinding:** Do you force `HTTPS` for external fetches to leverage Chromium's native TLS SNI checks against DNS rebinding?
-   [ ] **Path Traversal:** Are you sanitizing file paths returned by the LLM (`normalizePath`) and verifying they do not intersect with user-defined excluded folders?
-   [ ] **The Confused Deputy:** When showing AI-proposed changes to the user for confirmation, are you rendering them in raw `<pre><code>` blocks rather than evaluated Markdown to prevent malicious CSS obfuscation?
-   [ ] **Process Execution:** If you spawn child processes (eg via MCP), are you scrubbing sensitive inherited environment variables and utilizing `spawn` with argument arrays instead of `exec`?
-   [ ] **Zero-Click RCE:** Do you cryptographically hash configurations for external tools to prevent tampering via vault syncing?

### Robustness checklist

-   [ ] **Main Thread Integrity:** Are your heavy vector embedding generation, tokenization, and graph layouts offloaded to a Web Worker via Comlink?
-   [ ] **Atomic Writes:** Are you utilizing `app.vault.process()` and `app.fileManager.processFrontMatter` instead of `read()` and `modify()` to prevent frontmatter erasure during asynchronous updates?
-   [ ] **Storage Syncing:** Are you isolating massive binary/JSON index files from Obsidian Sync to prevent quota exhaustion and merge conflicts?
-   [ ] **Event Thrashing and Backpressure:** Do you debounce vault modify events and implement a backpressure queue for when your background worker is busy or restarting?
-   [ ] **Memory Leaks:** Do you pass an `AbortSignal` down to all network calls, and clear all your `setTimeout` IDs in `finally` blocks, especially when utilizing `Promise.race()` for timeouts?
-   [ ] **Schema Strictness:** Do you recursively sanitize tool schemas to provide explicit type fallbacks, ensuring LLM APIs do not reject them?
-   [ ] **ReDoS Checks:** Have you tested your Markdown parsing regexes (eg wikilink extraction) against maliciously crafted, deeply nested strings to avoid Catastrophic Backtracking?

By standardizing these practices, we can collectively ensure that the Obsidian ecosystem remains a secure, private, and robust environment for the next generation of AI tooling.

---

![Vault Intelligence Security and Robustness Hero Banner](https://cybaea.github.io/obsidian-vault-intelligence/images/security-robustness-banner.png)
