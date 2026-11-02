# Privacy notice

The public privacy notice is the `/privacy` page, in French and English: `apps/web/src/legal/privacy.tsx`. The legal notice and the terms sit next to it (`legal-notice.tsx`, `terms.tsx`), with the frame and links in the `legal` i18n namespace. The French version prevails.

Those files are the only copy of the public text, so a change to them is a change to the notice: update the date at the top of the document in the same pull request, and keep it in line with the [data map](data-map.md), the [retention schedule](retention-schedule.md) and the [sub-processors](sub-processors.md). The analysis behind the AI and Wikidata sections is in [ai.md](ai.md) and [wikidata.md](wikidata.md). Values that expire (Data Privacy Framework status, D1 Time Travel) are read from `packages/core/src/compliance-facts.ts`.
