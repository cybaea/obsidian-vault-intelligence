---
trigger: always_on
---

**Markdown formatting** rules:

- British English language with Oxford dictionary rules (language code `en-GB-oxendict`).
- GitHub Markdown format.
- No emoji anywhere.
- Use bold text sparingly.
    - For example there is no need to bold definitions in lists.
- Do not use bold (`**bold**`) in headings.
    - If you **must** emphasize something in a header, use italics (`_italics_`).
- Prefer sentence case in headings.
- Keep a blank line after headers as in the blank line after `## Subsection` in the example here:
    ```markdown
    Some text from the previous section.

    ## Subsection

    This is the first line of this subsection.
    ```
- Keep a blank line before the first and after the last list item:
    ```markdown
    This is an important list:
    
    1.  Some item.
    2.  Another item.
        - Sub-item

    This is the first line after the last list item.
    
    -   Here is another list
    -   It is not very long.
    
    This is the first line after the last list item in the second list.
    ```


