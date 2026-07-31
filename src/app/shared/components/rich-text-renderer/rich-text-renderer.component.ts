import { Component, Input, ViewEncapsulation, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import DOMPurify from 'dompurify';

@Component({
    selector: 'app-rich-text-renderer',
    standalone: true,
    imports: [CommonModule],
    template: `
    <div class="prose prose-sm dark:prose-invert max-w-none text-[var(--color-text)] leading-relaxed 
                prose-headings:text-[var(--color-text)] 
                prose-p:text-[var(--color-text-muted)] 
                prose-a:text-[var(--linke)] 
                prose-strong:text-[var(--color-text)]
                prose-code:text-[var(--primary-color)]
                prose-ul:text-[var(--color-text-muted)]
                prose-ol:text-[var(--color-text-muted)]
                rich-text-content"
         [innerHTML]="safeContent">
    </div>
  `,
    styles: [`
    /* Container Setup */
    :host {
        display: block;
        max-width: 100%;
    }

    .rich-text-content {
        max-width: 100%;
        overflow-x: hidden; /* Prevent horizontal scroll */
    }
    
    /* Standard text wrapping for readability */
    .rich-text-content p, 
    .rich-text-content li,
    .rich-text-content span,
    .rich-text-content div {
        overflow-wrap: break-word;
        word-wrap: break-word; /* Legacy support */
        word-break: normal;
        hyphens: auto; /* Optional: adds hyphens for cleaner breaks */
        max-width: 100%;
    }

    /* Überschriften nehmen zwingend immer die volle Breite ein und lösen Floats auf */
    .rich-text-content h1, 
    .rich-text-content h2, 
    .rich-text-content h3, 
    .rich-text-content h4, 
    .rich-text-content h5, 
    .rich-text-content h6 {
        display: block !important;
        width: 100% !important;
        max-width: 100% !important;
        clear: both !important;
        float: none !important;
        overflow-wrap: break-word;
        word-wrap: break-word;
        word-break: normal;
        hyphens: auto;
        flex-basis: 100%;
    }

    /* Exceptions for long technical strings */
    .rich-text-content a {
        word-break: break-all; /* Links should break if needed */
    }

    /* Images */
    .rich-text-content img {
        max-width: 100% !important;
        height: auto !important;
        border-radius: 0.5rem;
        margin: 1rem 0;
        display: block;
    }

    /* --- Advanced Markdown Styling --- */

    .rich-text-content blockquote {
        border-left: 3px solid var(--linke);
        padding-left: 1rem;
        margin: 1rem 0;
        color: var(--color-text-muted);
        background: var(--color-surface-hover);
        padding: 0.75rem 1rem;
        border-radius: 0 0.5rem 0.5rem 0;
    }

    .rich-text-content code {
        background: var(--color-surface-hover);
        padding: 0.15rem 0.4rem;
        border-radius: 0.25rem;
        font-family: 'Fira Code', 'Consolas', monospace;
        font-size: 0.85em;
        color: var(--primary-color);
        word-break: break-all; /* Code often has long strings */
    }

    .rich-text-content pre {
        background: var(--color-surface-ground);
        padding: 1rem;
        border-radius: 0.5rem;
        overflow-x: auto;
        margin: 1rem 0;
        border: 1px solid var(--color-border);
        white-space: pre-wrap; /* Wrap pre content too if needed */
        word-break: break-all;
    }

    .rich-text-content pre code {
        background: none;
        padding: 0;
        font-size: 0.875rem;
        color: inherit;
        white-space: pre-wrap;
    }

    .rich-text-content table {
        width: 100%;
        border-collapse: collapse;
        display: block; /* Allow scrolling if table too wide */
        overflow-x: auto;
        margin: 1rem 0;
    }

    .rich-text-content th,
    .rich-text-content td {
        border: 1px solid var(--color-border);
        padding: 0.5rem 0.75rem;
        text-align: left;
    }

    .rich-text-content th {
        background: var(--color-surface-hover);
        font-weight: 600;
    }

    .rich-text-content tr:nth-child(even) {
        background: var(--color-surface-ground);
    }

    .rich-text-content hr {
        border: none;
        border-top: 1px solid var(--color-border);
        margin: 1.5rem 0;
    }
  `],
    encapsulation: ViewEncapsulation.None
})
export class RichTextRendererComponent {
    private sanitizer = inject(DomSanitizer);
    safeContent: SafeHtml = '';

    @Input()
    set content(value: string) {
        // Replace &nbsp; with normal space to fix wrapping issues
        const cleanContent = (value || '').replace(/&nbsp;/g, ' ');
        // Use DOMPurify to sanitize HTML, preventing XSS but allowing safe Quill markup
        const purifiedContent = DOMPurify.sanitize(cleanContent);
        // We bypass Angular's sanitizer here ONLY because DOMPurify has already securely sanitized it.
        // Angular's built-in sanitizer strips style attributes used by Quill.
        this.safeContent = this.sanitizer.bypassSecurityTrustHtml(purifiedContent);
    }
}
