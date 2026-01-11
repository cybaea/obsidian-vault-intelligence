import { defineConfig } from 'vitepress'

// https://vitepress.dev/reference/site-config
export default defineConfig({
    title: "Vault Intelligence",
    description: "AI research assistant for your Obsidian vault",
    base: '/obsidian-vault-intelligence/',
    head: [
        ['meta', { property: 'og:type', content: 'website' }],
        ['meta', { property: 'og:title', content: 'Vault Intelligence' }],
        ['meta', { property: 'og:description', content: 'AI research assistant for your Obsidian vault' }],
        ['meta', { property: 'og:image', content: '/obsidian-vault-intelligence/images/vault-intelligence-social-1280.png' }],
        ['meta', { name: 'twitter:card', content: 'summary_large_image' }],
        ['meta', { name: 'twitter:title', content: 'Vault Intelligence' }],
        ['meta', { name: 'twitter:description', content: 'AI research assistant for your Obsidian vault' }],
        ['meta', { name: 'twitter:image', content: '/obsidian-vault-intelligence/images/vault-intelligence-social-1280.png' }],
    ],
    themeConfig: {
        // https://vitepress.dev/reference/default-theme-config
        nav: [
            { text: 'Home', link: '/' },
            { text: 'Guide', link: '/docs/configuration' },
            { text: 'Changelog', link: '/CHANGELOG' }
        ],

        sidebar: [
            {
                text: 'Introduction',
                items: [
                    { text: 'Getting Started', link: '/README_DOC' },
                    { text: 'Roadmap', link: '/ROADMAP' },
                ]
            },
            {
                text: 'User Guides',
                items: [
                    { text: 'Configuration', link: '/docs/configuration' },
                    { text: 'Examples', link: '/docs/examples' },
                    { text: 'Troubleshooting', link: '/docs/troubleshooting' },
                    { text: 'Web Worker Embedding', link: '/docs/web-worker-embedding' },
                ]
            },
            {
                text: 'Development',
                items: [
                    { text: 'Contributing', link: '/CONTRIBUTING' },
                    { text: 'Agent Support 2026', link: '/docs/2026-agent-support' },
                    { text: 'Maintainability', link: '/docs/maintainability' },
                    { text: 'Internal Agents Guide', link: '/AGENTS' },
                    { text: 'Obsidian API Thematic', link: '/devs/obsidian-api-thematic' },
                ]
            }
        ],

        socialLinks: [
            { icon: 'github', link: 'https://github.com/cybaea/obsidian-vault-intelligence' }
        ]
    },
    // Map .md files from root and subdirs
    rewrites: {
        'README.md': 'README_DOC.md'
    }
})
