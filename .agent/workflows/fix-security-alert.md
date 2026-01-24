---
description: Fetches details of a GitHub Advanced Security alert and attempts to fix it.
---

1. Validate Input & Permissions
   > [!IMPORTANT]
   > Replace `<ALERT_NUMBER>` with the **numeric argument** provided by the user in the command (e.g., 2).
   > If the user did not provide a number (e.g., they just typed `/fix-security-alert`), **STOP** and ask them for the alert number.
   
   // turbo
   `if [ -z "<ALERT_NUMBER>" ] || [ "<ALERT_NUMBER>" = "user input" ]; then echo "❌ Error: Please provide an alert number (e.g. /fix-security-alert 2)."; exit 1; fi && gh auth refresh -s security_events`

2. Fetch Alert Details
   - Use the GitHub API to get the specific file and line number of the vulnerability.
   > [!NOTE]
   > We use the API because the web URL does not provide machine-readable details.

   // turbo
   `gh api /repos/cybaea/obsidian-vault-intelligence/code-scanning/alerts/<ALERT_NUMBER> > alert_details.json`

3. Analyze the Vulnerability
   - Read `alert_details.json`.
   - Identify the `rule.description`, `most_recent_instance.location.path`, and `start_line`.
   - Display these details to the user so they know what you are fixing.

4. Create Fix Branch
   // turbo
   `git checkout main && git pull && git checkout -b fix/security-alert-<ALERT_NUMBER>`

5. Apply Fix
   - Read the vulnerable file.
   - Use your coding skills to patch the vulnerability described in the JSON.
   - Run `npm test` to ensure no regressions.

6. Commit and Push
   // turbo
   `git add . && git commit -m "fix: resolve security alert #<ALERT_NUMBER>" && git push -u origin HEAD`

7. Create Pull Request
   > [!TIP]
   > We include the full URL in the body so reviewers can click to see the confidential alert details.
   
   // turbo
   `gh pr create --title "fix: resolve security alert #<ALERT_NUMBER>" --body "Resolves security vulnerability. See details: https://github.com/cybaea/obsidian-vault-intelligence/security/code-scanning/<ALERT_NUMBER>"`
