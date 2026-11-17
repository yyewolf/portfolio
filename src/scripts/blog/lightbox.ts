// Click-to-zoom lightbox for images inside blog articles. Booted on
// astro:page-load so it re-attaches across view transitions: every image in
// the article gets a zoom cursor, and clicking one opens a fullscreen overlay
// closed by clicking anywhere or pressing Escape.
function createOverlay(): HTMLElement {
  const overlay = document.createElement("div");
  overlay.id = "lightbox";
  const img = document.createElement("img");
  img.alt = "";
  overlay.appendChild(img);
  overlay.addEventListener("click", () => overlay.classList.remove("open"));
  document.body.appendChild(overlay);
  return overlay;
}

function closeOverlay(): void {
  document.getElementById("lightbox")?.classList.remove("open");
}

function boot(): void {
  const overlay = document.getElementById("lightbox") ?? createOverlay();
  const target = overlay.querySelector("img") as HTMLImageElement;

  for (const img of document.querySelectorAll<HTMLImageElement>("article img")) {
    if (img.closest("a")) continue;
    img.classList.add("zoomable");
    img.addEventListener("click", () => {
      target.src = img.currentSrc || img.src;
      target.alt = img.alt;
      overlay.classList.add("open");
    });
  }
}

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeOverlay();
});

document.addEventListener("astro:page-load", boot);
