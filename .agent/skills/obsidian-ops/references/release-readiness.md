<!--
Source: Based on Obsidian Developer Policies, Theme Guidelines, and official release checklist
Last synced: See sync-status.json for authoritative sync dates
Update frequency: Check Obsidian Developer Policies and Theme Guidelines for updates
-->

# Release Readiness Checklist

This document provides a comprehensive checklist to verify your theme is ready for release to the Obsidian community. Use this when preparing a release or when asked "is my theme ready for release?"

**For AI Agents**: When a user asks about release readiness, run through this checklist systematically. Perform automated checks where possible, and ask the user interactively for items that require their input.

## Quick Reference

- **Developer Policies**: [Developer Policies](https://docs.obsidian.md/Developer+policies)
- **Theme Guidelines**: [Theme Guidelines](https://docs.obsidian.md/Themes/Releasing/Theme+guidelines)
- **Release Process**: See [versioning-releases.md](versioning-releases.md)

## Automated Checks (AI Can Verify)

These checks can be performed automatically by reading files and scanning code:

### File Requirements

- [ ] **`theme.css`** exists in project root (or compiled from SCSS/Sass)
  - For themes with build tools: Check that `theme.css` is generated correctly
  - For simple themes: Check that `theme.css` exists and is valid CSS
- [ ] **`manifest.json`** exists in project root with valid JSON structure
- [ ] **`LICENSE`** file exists in project root
- [ ] **`README.md`** exists in project root

### Manifest Validation

- [ ] **Required fields present**: `name`, `version`, `minAppVersion`, `description`, `author`
- [ ] **`name` format**: Should match the theme's display name
- [ ] **`version` format**: Semantic Versioning (x.y.z, e.g., `"1.0.0"`)
- [ ] **`minAppVersion`**: Set appropriately for CSS features used
- [ ] **Optional fields** (if applicable): `authorUrl`, `fundingUrl`
- [ ] **JSON syntax**: Valid JSON (proper quotes, commas, brackets)

### Version Consistency

- [ ] **GitHub release tag**: Matches `manifest.json` version exactly (no "v" prefix)
  - If checking before release: Verify version format is ready
  - If checking after release: Verify tag matches manifest version

### CSS Quality Checks

- [ ] **Valid CSS syntax**: No syntax errors in `theme.css`
- [ ] **No tracking or analytics**: No external tracking scripts, analytics, or telemetry in CSS
- [ ] **No remote resources**: No `@import` statements loading external stylesheets (unless explicitly disclosed)
- [ ] **Browser compatibility**: CSS features used are compatible with Obsidian's browser targets (Chrome and iOS Safari)
- [ ] **No obfuscated code**: CSS is readable and not minified/obfuscated (unless using build tools that minify for production)

### README.md Content

- [ ] **File exists**: `README.md` present in root
- [ ] **Describes purpose**: Clear description of what the theme does and its design philosophy
- [ ] **Usage instructions**: How to install and use the theme
- [ ] **Screenshots**: Visual examples of the theme (recommended)
- [ ] **Attribution**: If using third-party code or design elements, proper attribution included

### LICENSE File

- [ ] **File exists**: `LICENSE` file present in root
- [ ] **License specified**: Clear license type (MIT, GPL, etc.)
- [ ] **Third-party compliance**: If using code or design elements from other themes, verify license compatibility and attribution

## Interactive Checks (AI Asks User)

These checks require user input or confirmation:

### Platform Testing

- [ ] **Windows**: Theme tested and working on Windows
- [ ] **macOS**: Theme tested and working on macOS
- [ ] **Linux**: Theme tested and working on Linux
- [ ] **Android**: Theme tested and working on Android (if applicable)
- [ ] **iOS**: Theme tested and working on iOS (if applicable)

**Note**: If user doesn't have access to all platforms, they should test on available platforms and note limitations.

### Theme-Specific Testing

- [ ] **Dark mode**: Theme includes dark mode styles and they work correctly
- [ ] **Light mode**: Theme includes light mode styles and they work correctly (or theme is dark-only and this is documented)
- [ ] **Mode switching**: Theme correctly switches between dark and light modes
- [ ] **All Obsidian views**: Theme tested in:
  - [ ] Editor (Live Preview, Source Mode, Reading Mode)
  - [ ] File explorer
  - [ ] Settings pages
  - [ ] Command palette
  - [ ] Graph view
  - [ ] Canvas view (if applicable)
  - [ ] Other views used by the theme

### GitHub Release

- [ ] **Release created**: GitHub release exists for the version
- [ ] **Required files attached**: `theme.css` and `manifest.json` attached as **individual binary assets** (not just in source.zip)
- [ ] **Release name matches version**: Release name/tag exactly matches `manifest.json` version (no "v" prefix)

### Community Theme Registration

- [ ] **`manifest.json` name matches `community-css-themes.json`**: The `name` in your `manifest.json` matches the `name` in the `community-css-themes.json` file (for themes already in the community catalog)

### Documentation Quality

- [ ] **README.md describes purpose**: Clear explanation of what the theme does and its design philosophy
- [ ] **README.md provides usage instructions**: Step-by-step guide on how to install and use the theme
- [ ] **Screenshots included**: Visual examples showing the theme in use (highly recommended)

### Developer Policies Adherence

- [ ] **Read Developer Policies**: User confirms they have read [Developer Policies](https://docs.obsidian.md/Developer+policies)
- [ ] **No prohibited features**:
  - [ ] No tracking or analytics
  - [ ] No remote code execution
  - [ ] No self-updating mechanisms
- [ ] **Mandatory disclosures** (if applicable):
  - [ ] Remote resources: Disclosed in README if using `@import` for external stylesheets
  - [ ] Network usage: Disclosed in README and settings (if any)
- [ ] **Licensing**: LICENSE file present and compliant with any third-party code/licenses

### Theme Guidelines Adherence

- [ ] **Read Theme Guidelines**: User confirms they have read [Theme Guidelines](https://docs.obsidian.md/Themes/Releasing/Theme+guidelines)
- [ ] **CSS organization**: CSS is well-organized (logical structure, comments where helpful)
- [ ] **Browser compatibility**: CSS features are compatible with Obsidian's browser targets
- [ ] **Performance**: Theme doesn't cause significant performance issues
- [ ] **Accessibility**: Theme maintains reasonable contrast ratios and readability

### Third-Party Code

- [ ] **License compliance**: All third-party code/licenses are compatible with your theme's license
- [ ] **Attribution**: Proper attribution given in README.md for any code or design elements from other themes/projects
- [ ] **License compatibility**: Your theme's license is compatible with any third-party code used

## Developer Policies Summary

For reference, key points from [Developer Policies](https://docs.obsidian.md/Developer+policies):

### Prohibited

- **Tracking or analytics**: No tracking scripts, analytics, or telemetry
- **Remote code execution**: No fetching and executing remote scripts
- **Self-updating**: No automatic code updates outside normal releases

### Mandatory Disclosures

If your theme requires any of the following, you **must** disclose it clearly:
- Remote resources (external stylesheets via `@import`)
- Network usage (if any)

### Licensing

- Include a LICENSE file
- Respect licenses of any third-party code or design elements used
- Provide proper attribution for third-party code or design elements

## Theme Guidelines Summary

For reference, key points from [Theme Guidelines](https://docs.obsidian.md/Themes/Releasing/Theme+guidelines):

- **CSS organization**: Organize CSS into logical sections
- **Browser compatibility**: Ensure CSS features work in Obsidian's browser targets (Chrome and iOS Safari)
- **Performance**: Avoid CSS that causes performance issues
- **Testing**: Test on all applicable platforms and in all Obsidian views
- **Documentation**: Include clear README with screenshots

## AI Agent Workflow

When user asks "is my theme ready for release?" or similar:

1. **Run automated checks**:
   - Check file existence (`theme.css`, `manifest.json`, `LICENSE`, `README.md`)
   - Validate `manifest.json` structure and required fields
   - Check version format and consistency
   - Scan CSS for prohibited patterns (tracking, remote imports, etc.)
   - Verify README.md has basic content

2. **Present interactive checklist**:
   - Ask about platform testing (Windows, macOS, Linux, Android, iOS)
   - Ask about theme-specific testing (dark/light mode, all Obsidian views)
   - Ask about GitHub release status and file attachments
   - Ask about community-css-themes.json name matching (if applicable)
   - Ask about README.md quality (purpose, usage instructions, screenshots)
   - Ask about Developer Policies adherence
   - Ask about Theme Guidelines adherence
   - Ask about third-party code license compliance and attribution

3. **Report results**:
   - Show pass/fail/warning status for each item
   - Provide actionable guidance for any failures
   - Summarize overall readiness status

4. **Provide next steps**:
   - If ready: Guide user through release process (see [versioning-releases.md](versioning-releases.md))
   - If not ready: List specific items to address before release

## Related Documentation

- [versioning-releases.md](versioning-releases.md) - Release process and versioning
- [security-privacy.md](security-privacy.md) - Security and privacy guidelines
- [manifest.md](manifest.md) - Manifest requirements and validation
- [testing.md](testing.md) - Testing procedures and platform testing
- [ux-copy.md](ux-copy.md) - UI text conventions (for theme names and descriptions)
- [build-workflow.md](build-workflow.md) - Build commands (if using build tools)
- [performance.md](performance.md) - Performance optimization best practices

