---
trigger: glob
globs: *.md
---

**Markdown formatting** rules:

- British English language with Oxford dictionary rules (language code `en-GB-oxendict`).
- GitHub Markdown format.
- Do not use emoji for decoration.
    - No emoji in headers, bullets, etc.
    - Use them only where they carry distinct meaning. For example, if you are making a table with ratings, it may be helpful to have `★★★☆☆` or similar for, in this example, a three-star rating. This is ok, because the stars carry meaning.
- Use bold text sparingly.
    - For example there is no need to bold definitions in lists.
    - Do not use bold (`**bold**`) in headings.
        - If you **must** emphasize something in a header, use italics (`_italics_`).
- Prefer sentence case in headings.
- Typography:
    - Em-dashes (`—` or, where supported, `---`) can be elegant in writing but they are often overused. Consider if a comma or a colon would be as clear or if the sentence would be clearer if rewritten. We are not against em-dashes, just conscious of their overuse. Generally, we should avoid them in code.
    - En-dashes (`–` or, where supported, `--`) can be elegant but be sure to use them right. Generally, we should avoid them in code.
- Use 'eg', 'ie' and 'etc' sparingly and when needed note that we have no periods in `ie' and 'eg' and no comma after them, "ie like this".
- Keep a blank line after block elements such as paragraphs, headers, lists, tables, etc. Examples:
    - Headers as in the blank line after `## Subsection` in the example here:

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
