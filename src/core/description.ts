/**
 * Cleans descriptions: keeps Markdown intact, converts legacy HTML or text if needed,
 * and handles truncation.
 */
export function formatDescription(
  rawDesc: string | undefined,
  version: number | undefined,
  maxLength = 20000,
): { description: string; description_truncated: boolean } {
  if (!rawDesc) {
    return { description: '', description_truncated: false };
  }

  let text = rawDesc;
  // If version is not set, it might be legacy HTML
  if (!version) {
    text = htmlToPlainText(text);
  }

  if (text.length > maxLength) {
    return {
      description: text.slice(0, maxLength) + '\n\n[Description truncated...]',
      description_truncated: true,
    };
  }

  return {
    description: text,
    description_truncated: false,
  };
}

function htmlToPlainText(html: string): string {
  let res = html.replace(/<br\s*[\/]?>/gi, '\n');
  res = res.replace(/<\/p>/gi, '\n\n');
  res = res.replace(/<\/li>/gi, '\n');
  res = res.replace(/<li[^>]*>/gi, '• ');
  res = res.replace(/<\/?[^>]+(>|$)/g, '');
  // Unescape standard entities
  res = res
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');
  return res.trim();
}
