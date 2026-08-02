// Bootstraps Mermaid on the CTF showcase page. Hooks into astro:page-load so
// diagrams re-render correctly across Astro view transitions. Reads CSS custom
// properties from the .ctf root so the diagrams respect the site theme.
import mermaid from "mermaid";

function boot(): void {
  const root = document.querySelector<HTMLElement>(".ctf");
  if (!root) return;

  const mermaidEls = root.querySelectorAll<HTMLPreElement>("pre.mermaid");
  if (mermaidEls.length === 0) return;

  const css = getComputedStyle(root);

  mermaid.initialize({
    startOnLoad: false,
    theme: "base",
    suppressErrorRendering: true,
    themeVariables: {
      primaryColor: css.getPropertyValue("--ctf-surface"),
      primaryTextColor: css.getPropertyValue("--ctf-ink"),
      primaryBorderColor: css.getPropertyValue("--ctf-grid"),
      lineColor: css.getPropertyValue("--ctf-ink2"),
      secondaryColor: css.getPropertyValue("--ctf-nodebg"),
      tertiaryColor: css.getPropertyValue("--ctf-page"),
      fontFamily: "inherit",
      fontSize: "13px",
    },
  });

  mermaid.run({ nodes: Array.from(mermaidEls) });
}

document.addEventListener("astro:page-load", boot);
