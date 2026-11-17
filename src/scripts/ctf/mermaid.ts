// Bootstraps Mermaid on any page that ships a pre.mermaid diagram. Hooks into
// astro:page-load so diagrams re-render correctly across Astro view
// transitions. On CTF pages the theme comes from the .ctf CSS custom
// properties; anywhere else it falls back to a fixed palette that follows the
// site's html.dark class.
import mermaid from "mermaid";

// Mermaid measures node labels with the configured font, then renders them
// inside a fixed-size foreignObject that clips overflow. "inherit" measures
// with the wrong font, so the stack is spelled out to match what the page
// really renders, and boot waits for webfonts to be ready first.
const FONT_STACK = "Inter, ui-sans-serif, system-ui, sans-serif";

function boot(): void {
  const mermaidEls = document.querySelectorAll<HTMLPreElement>("pre.mermaid");
  if (mermaidEls.length === 0) return;

  const ctfRoot = document.querySelector<HTMLElement>(".ctf");
  const css = getComputedStyle(ctfRoot ?? document.documentElement);
  const dark = document.documentElement.classList.contains("dark");
  const pick = (name: string, fallback: string): string =>
    css.getPropertyValue(name).trim() || fallback;
  const onCtfPage = ctfRoot !== null;

  mermaid.initialize({
    startOnLoad: false,
    theme: "base",
    suppressErrorRendering: true,
    themeVariables: {
      primaryColor: pick("--ctf-surface", dark ? "#111827" : "#ffffff"),
      primaryTextColor: pick("--ctf-ink", dark ? "#e5e7eb" : "#1f2937"),
      primaryBorderColor: pick("--ctf-grid", dark ? "#374151" : "#d1d5db"),
      lineColor: pick("--ctf-ink2", dark ? "#9ca3af" : "#4b5563"),
      secondaryColor: pick("--ctf-nodebg", dark ? "#1f2937" : "#f9fafb"),
      tertiaryColor: pick("--ctf-page", dark ? "#030712" : "#ffffff"),
      fontFamily: FONT_STACK,
      fontSize: onCtfPage ? "13px" : "16px",
    },
    // CTF diagrams scale down to fit their column. Blog article columns are
    // narrow and the diagrams run wide, so there they render at natural size
    // and the wrap scrolls sideways instead of shrinking into unreadability.
    flowchart: { useMaxWidth: onCtfPage },
  });

  mermaid.run({ nodes: Array.from(mermaidEls) });
}

document.addEventListener("astro:page-load", () => {
  document.fonts.ready.then(boot);
});
