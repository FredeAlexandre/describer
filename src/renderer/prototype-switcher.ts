export type PrototypeVariant = {
  readonly key: string;
  readonly name: string;
};

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    target.isContentEditable
  );
}

export function attachPrototypeSwitcher(options: {
  readonly variants: readonly PrototypeVariant[];
  currentKey: string;
  readonly onChange: (key: string) => void;
}): { setCurrent: (key: string) => void } {
  const bar = document.createElement("div");
  bar.className = "proto-switcher";
  bar.setAttribute("role", "navigation");
  bar.setAttribute("aria-label", "Prototype variants");

  const prev = document.createElement("button");
  prev.type = "button";
  prev.className = "proto-switcher-arrow";
  prev.setAttribute("aria-label", "Previous variant");
  prev.textContent = "←";

  const label = document.createElement("span");
  label.className = "proto-switcher-label";

  const next = document.createElement("button");
  next.type = "button";
  next.className = "proto-switcher-arrow";
  next.setAttribute("aria-label", "Next variant");
  next.textContent = "→";

  const paint = (key: string): void => {
    options.currentKey = key;
    const variant =
      options.variants.find((entry) => entry.key === key) ?? options.variants[0];
    if (variant === undefined) {
      return;
    }
    label.textContent = `${variant.key} (${variant.name})`;
  };

  const cycle = (delta: number): void => {
    const index = options.variants.findIndex(
      (entry) => entry.key === options.currentKey,
    );
    const count = options.variants.length;
    if (count === 0) {
      return;
    }
    const nextIndex = (index + delta + count) % count;
    const variant = options.variants[nextIndex];
    if (variant === undefined) {
      return;
    }
    options.onChange(variant.key);
  };

  prev.addEventListener("click", () => {
    cycle(-1);
  });
  next.addEventListener("click", () => {
    cycle(1);
  });

  window.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") {
      return;
    }
    if (isTypingTarget(event.target)) {
      return;
    }
    event.preventDefault();
    cycle(event.key === "ArrowRight" ? 1 : -1);
  });

  paint(options.currentKey);
  bar.append(prev, label, next);
  document.body.append(bar);

  return {
    setCurrent: paint,
  };
}
