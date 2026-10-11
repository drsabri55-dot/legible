// Recognises the website builder a page was made with, from its own code, so
// the report can say where a fix is made. A string: see the note in agent/dom.ts.
export const BUILDER_PROBE = `(function () {
  var meta = document.querySelector('meta[name="generator" i]');
  var gen = meta ? meta.getAttribute('content') || '' : '';
  var urls = Array.prototype.map.call(document.querySelectorAll('script[src], link[href]'), function (e) { return e.getAttribute('src') || e.getAttribute('href') || ''; }).join(' ');
  if (/wordpress/i.test(gen) || /\\/wp-(content|includes)\\//.test(urls)) return 'WordPress';
  if (/shopify/i.test(gen) || /cdn\\.shopify\\.com/.test(urls) || window.Shopify) return 'Shopify';
  if (/wix\\.com/i.test(gen) || /static\\.wixstatic\\.com|static\\.parastorage\\.com/.test(urls)) return 'Wix';
  if (/squarespace/i.test(gen) || /squarespace(-cdn)?\\.com/.test(urls)) return 'Squarespace';
  if (/webflow/i.test(gen) || document.documentElement.hasAttribute('data-wf-site')) return 'Webflow';
  return null;
})()`;
