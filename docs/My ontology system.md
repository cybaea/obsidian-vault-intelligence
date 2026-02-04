---
tags:
  - type/make/project
  - status/3-mature
  - workflow/4-shipped
Type: Make/Project
topics:
  - "[Ontology](/Work/Ontology/Concepts/Ontology.md)"
  - "[Knowledge Management](/Work/Ontology/Concepts/Knowledge%20Management.md)"
  - "[Personal Knowledge Management](/Work/Ontology/Concepts/Personal%20Knowledge%20Management.md)"
  - "[Information Architecture](/Work/Ontology/Concepts/Information%20Architecture.md)"
  - "[Obsidian](/Work/Ontology/Entities/Obsidian.md)"
title: My ontology system
Status: 3-Mature
Workflow: 4-Shipped
ulid: 01KG57D3PQ613NXHQEM0T2A5BK
---
# My system

- I use Obsidian’s standard `tags` header for my _structured_ taxonomy. They are about the _type_, _status_, and _workflow state_ of note.
    - The QuickAdd command `Update Type` (from [updateType.js](/Work/_SCRIPTS/updateType.js)) helps maintain

- I use `topics` for my more fluid “folksonomy”, implemented as links to [Ontology/](/Work/Ontology/) folders.
    - The primary categories in here are: [[../Ontology/Concepts/Concepts|Concepts]], [[../Ontology/Entities/Entities|Entities]], and [[../Ontology/MOCs/MOCs|MOCs]].
    - The [Gardener](https://cybaea.github.io/obsidian-vault-intelligence/docs/how-to/maintain-vault.html) helps me maintain the entries in the categories.

## Tags

### Lifecycle

- `status/0-superseded` for **notes** that have been superseded
    - Consider `dcterms:isReplacedBy` header to link to the new one
    - Optionally `dcterms:replaces` header in the new to link to the old
- `status/1-germinal` (The seed/fleeting note)
- `status/2-developing` (Work in progress but useful)
- `status/3-mature` (Reliable reference)
- `status/4-evergreen` (Core principles)

### Workflow

- `workflow/0-triage` - Action: Needs to be filed, tagged, or deleted.
- `workflow/1-backlog` - Action: Someday. Review monthly.
- `workflow/2-active` - Action: Finish or reschedule
- `workflow/3-review` - Action: A queue for when you have low energy but high attention to detail.
- `workflow/4-shipped` - The _action_ is complete.

### Types

#### 1. `#type/source` (The Library)

- Purpose: The external things you have collected.
- Sub-tags:
    - `type/source/book`
    - `Type/source/article` (includes blogs, papers)
    - `type/source/media` (Videos, Podcasts)
    - `type/source/course`
    - `type/source/incoming` - in particular company announcements

#### 2. `#type/item` (The World)

- Purpose: The concrete entities you track (your Ontology Nodes).
- Sub-tags:
    - `#type/item/person`
    - `#type/item/org` (Companies)
    - `#type/item/tool` (Software, Hardware)

#### 3. `#type/idea` (The Brain)

- Purpose: Your actual thinking. This is where your Zettelkasten/Atomic notes live.
- Sub-tags:
    - `#type/idea/concept` (Timeless principles)
    - `#type/idea/scratch` (Quick thoughts/fleeting)

#### 4. `#type/make` (The Factory)

- Purpose: The things you are creating (Outputs).
- Sub-tags:
    - `#type/make/project` (The container)
    - `#type/make/content` (The deliverables: Posts, Code)

### Domain Tags (Broad Context)

Use these sparingly to partition your vault if you need to switch "modes" (e.g., "I am coding now" vs "I am writing strategy").

- `domain/tech` (Coding, VSC, Python)
- `domain/strategy` (Consulting, Management)
- `domain/personal` (Ambitions, Journals)

## Other keys

### Core properties

- `name` – The canonical label. [schema.org: Property](https://schema.org/Property)
- `description` – A short human-readable description (one or two sentences). [schema.org: Description](https://schema.org/description), [schema.org: Property](https://schema.org/Property)
- `alternateName` – Aliases, abbreviations, former names. [schema.org: Alternate Name](https://schema.org/alternateName), [schema.org: Property](https://schema.org/Property)
- `identifier` – A _stable identifier_ for the entity (Wikidata QID URL, Companies House number, ISNI, etc.).
        - Schema.org explicitly positions `identifier` as a general-purpose identifier field. [schema.org: Identifier](https://schema.org/identifier), [schema.org: Property](https://schema.org/Property)
- `url` – The entity’s **official/canonical** URL (homepage or primary page). [schema.org: Url](https://schema.org/url)
- `sameAs` – External URLs that **unambiguously indicate identity** (Wikidata, Wikipedia, official LinkedIn profile, etc.). [iptc.org: foaf](https://iptc.org/thirdparty/foaf/), [support.sc…emaapp.com](https://support.schemaapp.com/support/solutions/articles/33000278032-common-schema-org-properties-for-connecting-and-disambiguating-data-items)
- `seeAlso` – Use for “further information that might be relevant”, without claiming identity equivalence. This matches the intended semantics of `rdfs:seeAlso`. [w3.org: Using seeAlso](https://www.w3.org/wiki/UsingSeeAlso), [deepwiki.com: Properties and frontmatter](https://deepwiki.com/kepano/obsidian-skills/2.6-properties-and-frontmatter)

**Why this set works:** it cleanly separates identity (`identifier`, `sameAs`) from authoritative home (`url`) and general references (`seeAlso`) without exploding your schema.

### Additional properties

These are useful _if cheap to maintain_.

- `image` – for people, products, tools; “representative image”. Schema.org: “An image of the item”. [schema.org: Image](https://schema.org/image)
- `logo` – for organisations/brands. Schema.org: “An associated logo”. [schema.org: Logo](https://schema.org/logo)
- `keywords` (optional) – If you want a lightweight topical index. Schema.org defines it as “keywords or tags used to describe some item”. [schema.org: Keywords](https://schema.org/keywords)
