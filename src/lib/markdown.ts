import { marked, type MarkedToken } from 'marked';

/** GitHub-flavoured Markdown as tokens; `markdown.svelte` draws them without ever building HTML. */
export const parseMarkdown = (source: string) => marked.lexer(source) as MarkedToken[];

/** The link's address when it is safe to open from the panel (http or https), else null. */
export const safeHref = (href: string) => (/^https?:\/\//i.test(href.trim()) ? href.trim() : null);

/** GitHub hides HTML comments, such as the note its release generator leaves at the top. */
export const isHtmlComment = (html: string) => html.trimStart().startsWith('<!--');
