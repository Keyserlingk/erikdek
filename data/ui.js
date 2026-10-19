// Small DOM helpers shared by the Train and Tests screens.

export const $ = (id) => document.getElementById(id);

export function create(tag, props = {}, children = []) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
}

export function button(className, text, onClick) {
  const b = create("button", { type: "button", className, textContent: text });
  b.addEventListener("click", onClick);
  return b;
}
