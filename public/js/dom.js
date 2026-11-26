// Tiny DOM helper. It only ever uses textContent, never innerHTML, so
// text from any source cannot become markup.

/**
 * @param {string} tag
 * @param {Record<string,string>} [attrs] attribute map; `class` and `text` are special
 * @param {Array<Node|string>} [children]
 */
export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key === 'text') node.textContent = value;
    else if (key === 'class') node.className = value;
    else node.setAttribute(key, value);
  }
  for (const child of children) node.append(child);
  return node;
}

export function clear(node) {
  node.replaceChildren();
}
