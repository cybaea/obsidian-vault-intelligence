<!--
Source: Based on Obsidian Developer Policies and Guidelines
Last synced: See sync-status.json for authoritative sync dates
Update frequency: Check Obsidian Developer Policies for updates
-->

# Security, privacy, and compliance

Follow Obsidian's **Developer Policies** (<https://docs.obsidian.md/Developer+policies>) and **Theme Guidelines** (<https://docs.obsidian.md/Themes/Releasing/Theme+guidelines>). See [release-readiness.md](release-readiness.md) for a comprehensive release checklist.

## Developer Policies Requirements

### Prohibited Practices

- **Code obfuscation**: CSS must be readable and not minified/obfuscated
- **Dynamic ads**: No dynamic advertising
- **Client-side telemetry**: No hidden telemetry. If you collect optional analytics, require explicit opt-in and document clearly in `README.md`
- **Self-updating mechanisms**: No automatic code updates outside of normal releases. Never execute remote code, fetch and eval scripts, or auto-update code

### Mandatory Disclosures

If your theme requires any of the following, you **must** disclose it clearly in `README.md`:

- **Payments or subscriptions**: Clearly state if the theme requires payment
- **User accounts**: Disclose if user accounts are required
- **Network usage**: Disclose any API calls, external services, or network requests
- **Files outside vault**: Disclose if the theme accesses files outside the Obsidian vault (rare for themes, but applicable if using any external resources)

### Privacy and Security

- Default to local/offline operation. Only make network requests when essential to the feature.
- Minimize scope: read/write only what's necessary inside the vault. Do not access files outside the vault.
- Clearly disclose any external services used, data sent, and risks.
- Respect user privacy. Do not collect vault contents, filenames, or personal information unless absolutely necessary and explicitly consented.
- Avoid deceptive patterns, ads, or spammy notifications.

### Licensing

- Include a LICENSE file in your project root
- Respect licenses of any third-party code used
- Provide proper attribution for third-party code in `README.md`
- Ensure license compatibility between your theme's license and any third-party code licenses

## Theme Guidelines

- **CSS organization**: Organize CSS/SCSS into logical files/folders
- **CSS variables**: Use consistent naming conventions for CSS variables
- **Security**: Themes are CSS-only and have minimal security surface area

## Implementation

Themes are CSS-only and have minimal security surface area, but still follow privacy guidelines for any optional features.

## Related Documentation

- [release-readiness.md](release-readiness.md) - Comprehensive release checklist including policy adherence
- [manifest.md](manifest.md) - Manifest requirements (includes security-related fields)
- [Developer Policies](https://docs.obsidian.md/Developer+policies) - Official Obsidian Developer Policies
- [Theme Guidelines](https://docs.obsidian.md/Themes/Releasing/Theme+guidelines) - Official Theme Guidelines
