# AGENTS.md

Working notes for agents on this repo. The **Status board** at the bottom is the
part you are expected to edit — read it first, update it last.

## Project

Personal portfolio at <https://yewolf.fr>. Astro 5 (static output), Tailwind,
TypeScript, no UI framework. Built into `dist/` and served by nginx from a
Docker image. Content lives in Astro content collections under `src/content/`.

```bash
pnpm dev        # dev server — the user usually has this running already, don't start it unprompted
pnpm build      # astro check && astro build && pagefind --site dist
pnpm lint       # eslint
```

Path aliases: `@*` maps to `./src/*` (`@lib/...`, `@components/...`,
`@layouts/...`, `@scripts/...`, `@consts`). Defined in `tsconfig.json`.

**Lint baseline: 79 pre-existing errors** in `Header.astro`,
`certifications/index.astro`, `index.astro`, `talks/*`, `scripts/ctf/animations.ts`
— almost all single-quote violations. `pnpm lint` exits non-zero on a clean tree.
Do not "fix" these as a side quest; just confirm your change adds none:

```bash
pnpm exec eslint . -f json -o /tmp/lint.json; python3 -c "
import json; d=json.load(open('/tmp/lint.json'))
print(sum(f['errorCount'] for f in d))"   # expect 79
```

---

# The Courses subsystem

A course is a **track** (e.g. Kubernetes) made of ordered **lessons** of about
ten minutes each, with a **glossary** that only ever shows terms the reader has
already met.

Lessons are grouped into **phases**, and phases into three **depth tiers** (core,
practical, deep). A lesson declares its `phase` in frontmatter; the depth is a
property of the phase, held in `phases.json`, and is derived rather than stored on
the lesson so the two cannot disagree. `outline()` builds the nested shape the
track page renders and drops phases that have no published lessons, so a phase
can be declared long before it is written. That is what makes it safe to publish
a track in batches.

## File map

| Path | What it is |
|---|---|
| `src/content/courses/<track>.md` | Track metadata + intro prose. Filename is the track slug. |
| `src/content/lessons/<track>/<slug>/index.mdx` | One lesson. Folder allows colocated images. |
| `src/data/courses/<track>/glossary.json` | Every term for the track. |
| `src/data/courses/<track>/phases.json` | Phase titles, depth tier, accent colour, optional summary. |
| `docs/kubernetes-track-roadmap.md` | The 51-lesson plan for the Kubernetes track, and the game designs. |
| `src/lib/courses.ts` | All queries, gating, and the `<Term>` validator. |
| `src/layouts/CourseLayout.astro` | Two-column shell: content + sticky sidebar. |
| `src/components/courses/Term.astro` | Inline term with hover/focus tooltip. |
| `src/components/courses/GlossaryPanel.astro` | Gated sidebar glossary. |
| `src/components/courses/LessonList.astro` | Lesson list with progress ticks. |
| `src/components/courses/PhaseOutline.astro` | Track page outline: depth tiers, then phases, then lessons. |
| `src/components/courses/CourseSearch.astro` | Pagefind-backed search box. |
| `src/scripts/courses/progress.ts` | localStorage progress. |
| `src/scripts/courses/operator/` | The lesson 1 game: `engine.ts` (world model), `scenarios.ts` (levels), `game.ts` (runner and view). |
| `src/components/courses/OperatorGame.astro` | Mounts the game, holds the lesson's closing prose in its slot. |
| `src/styles/operator.css` | Game styles, all under `.op`. |
| `src/pages/courses/` | The four routes. |

Routes: `/courses`, `/courses/<track>`, `/courses/<track>/glossary`,
`/courses/<track>/<lesson>`.

## Adding a lesson

1. Create `src/content/lessons/<track>/<NN>-<slug>/index.mdx`. The `NN-` prefix
   is for humans sorting the directory; **`order` in frontmatter is what the code
   reads**.

   ```yaml
   ---
   track: kubernetes      # must equal the track slug exactly
   order: 7               # unique within the track; drives nav, "7 / 8", gating
   phase: 2               # must exist in the track's phases.json
   title: Probes and health
   description: One sentence, shown on cards and in search results.
   minutes: 10            # explicit; reading time is NOT computed for lessons
   tags: [workloads]
   modes: [operate]       # planned interactives: visualize | operate | inspect
   holdGlossary: false    # hide the sidebar glossary until the lesson is completed
   draft: false
   ---
   ```

2. Write the body. Wrap glossary terms as `<Term>Pod</Term>`. No import needed —
   the lesson page injects it via `<Content components={{ Term }} />`.
   Use `<Term term="Pod">pods</Term>` when the prose wording differs from the
   canonical term name.
3. Add any new terms to the glossary (below) with `introducedIn` set to this
   lesson's `order`.
4. `pnpm build` and read the `[courses]` warnings.

Renumbering lessons means updating every `introducedIn` that points at them.
There is no migration helper; grep the glossary.

## Adding a track

1. `src/content/courses/<slug>.md`:

   ```yaml
   ---
   title: Kubernetes, one idea at a time
   description: Shown on the /courses card.
   level: beginner        # beginner | intermediate | advanced
   order: 1               # position on /courses
   logo: /logos/kubernetes.svg
   logoAlt: Kubernetes logo
   draft: false
   ---
   ```

2. Create `src/data/courses/<slug>/glossary.json` and
   `src/data/courses/<slug>/phases.json`, at minimum `[]` each. The globs in
   `courses.ts` only match those exact path shapes. Every phase needs a `depth`
   of `core`, `practical` or `deep`, and an `accent` that `PhaseOutline.astro`
   has a class string for; unknown accents fall back to slate.

   `summary` is optional, and most phases are better without one. It renders
   directly above the phase's lesson list, so a summary that describes the
   phase's contents just repeats the lesson titles sitting under it. Write one
   only to make a claim the reader cannot get from those titles: phase 7 says
   Kubernetes will not make an application highly available, phase 4 says a
   pod's IP address will not last. Of the thirteen Kubernetes phases, five have
   one.
3. Create `src/content/lessons/<slug>/` and add lessons.
4. Logos are real project marks, not emoji. Fetch the official SVG (for CNCF
   projects, `github.com/cncf/artwork`) into `public/logos/`.

The track slug must match in three places: the `.md` filename, the lessons
directory name, and every lesson's `track:` field. Nothing validates this — a
mismatch silently yields a track with zero lessons.

## Glossary

One JSON array per track, sorted alphabetically at read time.

```json
{
  "term": "Pod",
  "introducedIn": 2,
  "short": "One line. Shown in the sidebar and the tooltip.",
  "long": "Optional. Glossary page only.",
  "related": ["Node", "Container"]
}
```

- `introducedIn` is a lesson **`order`**, not a slug.
- `related` entries must match another term's `term` exactly (compared
  case-insensitively). Unmatched or still-locked names are silently dropped from
  the rendering, so a typo just quietly disappears.

### Two gating modes, on purpose

**Lesson sidebar — build time.** `unlockedTerms(track, order)` filters to
`introducedIn <= order` while rendering. A lesson page never ships the text of a
term it has not introduced. Verify it stayed true:

```bash
grep -c 'StatefulSet' dist/courses/kubernetes/02-pods-and-nodes/index.html   # expect 0
```

**Glossary page — client side.** `/courses/<track>/glossary` ships *every*
definition and hides the locked ones with JS driven by `furthest` from
localStorage, plus a "show all" toggle. It has to widen as the reader progresses
without a rebuild, so the locked text is in the HTML and in the search index.
This is a deliberate trade, not an oversight. If it ever needs to be strict, the
page has to be generated per-progress-level or fetch definitions on demand.

## `<Term>` and its validator

MDX gives a component no page context, so `Term.astro` resolves a name against
**every** track's glossary (`findTermAnywhere`). It cannot know which lesson it
is sitting in.

The check that matters therefore runs separately: `validateTermRefs()` in
`courses.ts` regex-scans raw MDX source (`lesson.body`) and warns when a `<Term>`
names something absent from the glossary, or introduced in a *later* lesson than
the one using it. It is called from `src/pages/courses/[track]/index.astro`.

**It warns, it never fails the build.** That is intentional so drafting is not
blocked. Nobody sees the warning unless they read build output — check it:

```bash
pnpm build 2>&1 | grep '\[courses\]'    # expect no output
```

`validateStructure()` runs from the same page under the same warn-only contract,
and catches what stops being obvious once a track has dozens of lessons: a
duplicated or skipped `order`, a `phase` missing from `phases.json`, or phases
that interleave instead of running in contiguous blocks. It only sees published
lessons, so drafts neither trigger it nor create false order gaps.

If a second track ever defines a term the first one also defines, `<Term>`
resolves to whichever glob order returns first. Not yet a problem with one track.

# Interactive lessons

Lesson 1 is a game rather than an article. Its `index.mdx` is frontmatter, one
import and one component: there is no prose around the game, because anything
written there would say what the game already says on its intro and closing
screens. If you find yourself adding a paragraph to that file, check it is not
already on a screen.

The split inside the game is worth copying.

`engine.ts` is the world: a specification, machines, servers, and the rules for
the five moves. It has no DOM and no Kubernetes in it. `scenarios.ts` is the six
levels as data, with a function only where a level has to be unfair on a timer
(a machine dying, a server recovering at the worst moment). `game.ts` mounts a
level, plays its timed beats, turns a click into a move, and paints the result.
Adding a level means adding an entry to `scenarios.ts`.

**The player never sees the world.** They see a `Reading`, which is a copy of it
taken the last time they asked. Events arrive on their own and say that something
happened; they never refresh the panel. Only the Read action does, and a level
can only be solved by a read that comes back matching the specification. This
looks like a stale-UI bug and is the entire point: it is what makes "an event is
not an instruction" and "look again after you act" mechanics rather than
paragraphs. Staleness is counted as feed entries arriving after the reading, so
every world change has to emit an event or the panel will lie without saying so.

**Numbers come out of the model, never out of intent.** The tally reads the
reading, the finale reads the world, and neither reads what a move was supposed
to do. That is what makes a wrong action show its real consequence instead of a
canned "wrong".

**A level must never praise play it did not check.** Levels three and four are
cleared by leaving the system alone, but a needless restart settles straight back
to `running`, so the count matches and the level clears anyway. Both carry a
`debriefActed`, and `renderDebrief` picks it when the player changed something
their own last reading had not asked them to. Any later level whose answer is
"do nothing" needs one as well, or it will congratulate a player for restraint
they never showed.

**Mistakes are counted where they are made, not where they surface.** `move()`
reads the player's gap and their unread-event count *before* calling `apply`,
because a move pushes entries onto the feed itself. A change taken on a matching
reading with nothing new since is `needless`; a change taken with events still
unread is `blind`. Measuring consequences at read time instead, which is what the
first version did, missed the restart case completely and billed the player for
failures the script had caused.

**A level's twist fires on what the player did, not on a server count.** Level
five's `onSettle` waits for the player's replacement to bring the count back up,
then brings `server-03` back, re-adding it if they deleted the record first.
Keying that off `servers.length` let a player delete the dead server before
replacing it and skip the race entirely, while the debrief and the question went
on describing it. `par` on each scenario is the fewest state-changing actions it
can be cleared in, summed for the closing scorecard, and it is a floor rather
than a target: level four can hand out a reading that honestly asks to be acted
on.

**The frame is built once.** `mountShell()` puts up the shell, the progress rail
and the headline, and after that only `[data-op-body]` is ever replaced. Levels,
debriefs and the closing screens all swap that one element, which is what stops
nine screens from feeling like nine screens. The debrief is appended to the board
the player just solved rather than replacing it.

**Every level must stay recoverable.** Levels expose only the actions they need,
so a player who over-creates in level 1 has no Delete button to undo it. The
board therefore always carries a "Start this level over" link. Check it still
exists before trimming an action list.

## Holding content back

Lesson 1 makes the reader work out reconciliation, so naming it early ruins it.
Anything withheld sits in a `[data-hold]` wrapper until the game reaches its
completion screen:

- The sidebar glossary, gated by `holdGlossary: true` in frontmatter. This is
  the only thing lesson 1 holds today.
- Anything passed as children to `<OperatorGame>`, which lands in a `[data-hold]`
  wrapper of its own. Lesson 1 passes nothing, but the slot is kept because a
  later lesson wanting held prose should not have to rebuild the mechanism.

`game.ts` unhides every `[data-hold]` on the page and fires an `operator:done`
event. The lesson page listens, marks the lesson complete, and reveals again on
later visits from localStorage, so finishing once is enough.

This hides, it does not gate. The held text is in the HTML and in the search
index, same trade as the glossary page. If it ever has to be strict, the prose
has to move out of the page and be fetched on completion.

## Search

Pagefind indexes the **built HTML** post-build (`pagefind --site dist` is in the
`build` script, so the Dockerfile's `pnpm build` picks it up for free).

- Indexed surfaces are marked `data-pagefind-body` — the lesson `<article>`, and
  the term-list wrapper on the glossary page — with `data-pagefind-filter="track:<slug>"` and
  `data-pagefind-meta="title:..., kind:lesson|glossary"`.
- **Because any `data-pagefind-body` exists, Pagefind indexes only tagged pages.**
  The blog and projects are currently *not* searchable. Adding site-wide search
  means tagging those pages too, not changing config.
- `astro dev` has no index — `/pagefind/` only exists in `dist`. The search box
  catches the failed import and explains itself. Test search against
  `pnpm build && pnpm preview`, never `pnpm dev`.
- The import path is held in a variable to stop Vite resolving a file that does
  not exist at build time. Do not inline it back into the `import()`.

## Progress

`src/scripts/courses/progress.ts`, key `courses:progress:v1`, shape
`{ [track]: { furthest, completed[] } }`. Every access is try/caught — private
windows and blocked site data throw rather than returning empty. `furthest` only
ever grows, so revisiting lesson 2 never re-locks the glossary.

Inline `<script>` tags cannot use `define:vars` and imports together, so pages
pass data through `data-` attributes on a wrapper element and read it back.

## Layout gotchas

- **Sticky sidebar.** `lg:sticky lg:top-24` lives on the `<aside>` in
  `CourseLayout.astro`, *not* on anything inside it. The grid uses
  `lg:items-start`, which makes the aside content-height; a sticky *child* of a
  content-height parent has zero travel and silently does nothing. Keep the
  sticky on the grid item.
- **Panel height.** The glossary term list caps at `lg:max-h-[60vh]` with its own
  scroll. Without it, a long glossary outgrows the viewport and the bottom
  becomes unreachable while stuck.
- **One DOM, two layouts.** `GlossaryPanel` is a `<details>` forced open above
  1024px by a `matchMedia` listener. Rendering separate mobile and desktop
  markup would double the glossary in the search index.
- `Container.astro` is `max-w-screen-md` and too narrow for the two-column
  layout; `CourseLayout` uses its own `max-w-6xl`.

## Verification checklist

```bash
pnpm build                                   # 0 errors; note the pagefind page count
pnpm build 2>&1 | grep '\[courses\]'         # no term warnings
# gating holds — sidebar term counts must rise with lesson order
for f in dist/courses/kubernetes/*/index.html; do
  case "$f" in *glossary*) continue ;; esac    # glossary page has no sidebar panel
  echo "$(basename $(dirname $f)) $(grep -o 'data-term="' $f | wc -l)"
done
# expected today: 5 8 11 15 across the four published lessons
```

---

# Status board

> **Agents: maintain this section.** Read it before starting. Update it in the
> same change that alters behaviour — a stale board is worse than none.
>
> - Move items between Done / In progress / Not built as reality changes.
> - When you hit a non-obvious failure, add it to **Gotchas learned** with the
>   *why*, not just the fix. That section is the point of this file.
> - Add a dated line to the Log for anything that changes the subsystem's shape.
> - Delete entries that stopped being true. Do not accumulate history here;
>   that is what git is for.
> - Keep claims verifiable. If you did not run it, do not assert it passes.

**Last verified:** 2026-09-06 — `pnpm build` clean, 5 pages indexed (4 published
lessons plus the glossary; five more lessons are `draft: true`), no `[courses]`
warnings, lint at baseline 79. Every level verified solvable by replaying the
engine outside the browser.

### Done

- Collections `courses` + `lessons`, schemas in `src/content/config.ts`.
- All four routes building.
- Glossary gating, build-time on lessons, client-side on the glossary page.
  Verified: sidebar term counts 4 / 9 / 14 / 19 / 22 / 26 across lessons 1-6, and
  no term appears in HTML before the lesson that introduces it.
- `<Term>` tooltip + `validateTermRefs` forward-reference warnings.
- Pagefind wired into `build`, scoped by `track` filter, dev fallback message.
- localStorage progress: resume button, completion ticks, reset.
- Kubernetes track: 34 glossary terms, official CNCF logo.
- Lesson 1 built as a game: six levels, the reconciliation reveal, the
  terminology mapping, a controller that repairs the system on its own, and a
  closing screen on eventual consistency.
- `holdGlossary` frontmatter flag plus the `[data-hold]` reveal mechanism.

### In progress

- **Lesson prose is placeholder, lesson 1 excepted.** Lesson 1 is finished.
  The other published lessons are stubs carrying correct frontmatter and
  `<Term>` wiring. The user is writing the real curriculum. Do not treat those
  bodies as reference material, and do not expand them unasked.

### Not built

- Only one track exists; the multi-track paths (`findTermAnywhere` collisions,
  `/courses` with several cards) are untested against real data.
- No site-wide search — Pagefind covers courses only, see above.
- No RSS or sitemap-specific handling for courses beyond Astro's defaults.
- No quizzes, exercises, or code playgrounds outside lesson 1's game.
- The game is not covered by tests. Levels were checked by bundling
  `engine.ts` + `scenarios.ts` with esbuild and replaying moves in node. That
  harness covers the engine, not the reading/staleness layer in `game.ts`.
- Lesson 7 of the roadmap's level design (dependencies, ordering) is not built.
  Six levels plus the automatic finale ship.
- No per-lesson "last updated" date; the schema has no date field at all.

### Gotchas learned

Each of these cost a real debugging cycle. Full explanations are inline above.

1. Astro content collections **ignore `_`-prefixed files**, which is why track
   metadata is `courses/<slug>.md` and not `_track.md`.
2. A sticky child inside an `items-start` grid item cannot move. Sticky belongs
   on the grid item.
3. `astro check` rejects `hidden` on SVG elements (`SVGAttributes` has no such
   prop). Use a `hidden` Tailwind class and toggle `classList`.
4. TS narrowing does not reach **hoisted `function` declarations**; a
   `const x = document.querySelector(...)` narrowed by an `if` is still
   `possibly null` inside one. Use arrow-function consts in inline scripts.
5. Astro's `<Content components={{ Term }} />` injection reaches MDX passed as
   a component's children, so the held prose inside `<OperatorGame>` still gets
   working `<Term>` tooltips without importing anything.
6. `.op` markup is built at runtime, so Astro scoped styles cannot reach it.
   `operator.css` is global and namespaced by hand instead.
7. `global.css` styles the bare `header`, `footer`, `main` and `article`
   element selectors for the site chrome, and `header` there is
   `position: fixed; top: 0`. A `<header>` rendered inside the game gets pulled
   out of the shell and pinned behind the site nav, so the game's rail and
   title simply vanish. The game builds its own chrome out of divs. Nothing in
   `astro check`, lint or the build catches this, because the markup is a
   runtime string; `operator.css` carries a defensive reset for it. The same
   fixed header is why `frameIntoView()` measures its height and subtracts it
   before scrolling a new level into view: aligning the shell to the top of the
   viewport would park the rail behind it.
8. Statically importing `/pagefind/pagefind.js` fails `astro check` — the file
   only exists after a build. Keep the path in a variable.

### Log

- **2026-09-06** — Lesson 1 game, second pass. Level five's recovery now fires on
  the player's replacement rather than on a server count, so deleting the failed
  server first no longer skips the race the debrief describes. Levels three and
  four gained a second debrief for players who acted anyway. The closing
  scorecard counts needless and unread-event changes at the moment they are
  taken, replacing a tally that missed restarts and blamed the player for
  scripted failures. Level six gained a question. Lesson renamed to
  `01-you-are-the-devops` so the URL matches its title, with a 301 in
  `nginx/nginx.conf` for the published link.
- **2026-09-06** — Fixed the game's shell head being hoisted to the top of the
  viewport: it was a `<header>`, which `global.css` styles as the fixed site
  chrome. Now a div, with a reset in `operator.css` to stop it recurring.
- **2026-09-05** — Lesson 1 prose removed entirely; the file is now just the
  game component, since every paragraph in it repeated a screen. Added an
  eventual-consistency screen between the automatic finale and the completion
  screen, plus the matching glossary term.
- **2026-09-05** — Lesson 1 reworked: the state panel became a reading the
  player has to refresh, events stopped updating it, and reading became the move
  that ends a level. Frame rebuilt as a persistent shell with a progress rail so
  levels and explanations swap inside it.
- **2026-09-05** — Lesson 1 built as an interactive game (engine, scenarios,
  runner, styles) replacing its placeholder body. Added `holdGlossary` to the
  lesson schema and the `[data-hold]` / `operator:done` reveal so the closing
  prose and the sidebar glossary stay shut until the reader finishes.
- **2026-09-05** — Courses subsystem scaffolded: collections, routes, glossary
  gating, `<Term>` + validator, Pagefind, localStorage progress. Six placeholder
  Kubernetes lessons. Emoji track icon replaced with the official CNCF logo.
  Sticky sidebar fixed (was overlapping the "Full glossary" link).
