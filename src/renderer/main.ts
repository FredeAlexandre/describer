type LibraryView = {
  readonly path: string;
  readonly projects: readonly unknown[];
};

declare global {
  interface Window {
    describer: {
      open: () => Promise<{ library: LibraryView }>;
    };
  }
}

function renderLibrary(library: LibraryView): void {
  const root = document.getElementById("app");
  if (root === null) {
    return;
  }

  const heading = document.createElement("h1");
  heading.textContent = "Library";

  const empty = document.createElement("p");
  empty.className = "empty";
  empty.textContent = "No Projects yet.";

  root.replaceChildren(heading);
  if (library.projects.length === 0) {
    root.append(empty);
  }
}

const describer = await window.describer.open();
renderLibrary(describer.library);

export {};
