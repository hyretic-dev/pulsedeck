/**
 * Rehype-Plugins für Handbuch und Blog. Ohne Abhängigkeiten: der HAST-Baum wird direkt durchlaufen.
 */

const el = (tagName, properties, children = []) => ({ type: 'element', tagName, properties, children });
const text = (value) => ({ type: 'text', value });
const textVon = (knoten) => (knoten.type === 'text' ? knoten.value : (knoten.children ?? []).map(textVon).join(''));

function durchlaufe(knoten, besuch) {
  for (const kind of knoten.children ?? []) {
    besuch(kind, knoten);
    durchlaufe(kind, besuch);
  }
}

/**
 * Checklisten (GFM „- [ ]“) ohne Formularelement: remark-gfm erzeugt deaktivierte <input type="checkbox">, die Screenreader als
 * nicht bedienbare Formularfelder ansagen und Lighthouse als Formularfeld ohne Label wertet. Statt dessen ein dekoratives Kästchen;
 * die Liste bleibt eine normale Liste, abgehakte Punkte bekommen einen Hinweis für Screenreader.
 */
export function rehypeCheckliste() {
  return (baum) => {
    durchlaufe(baum, (knoten, eltern) => {
      if (knoten.type !== 'element' || knoten.tagName !== 'input' || knoten.properties?.type !== 'checkbox') return;
      const erledigt = Boolean(knoten.properties.checked);
      const ersatz = el('span', { className: ['checkliste-kasten', ...(erledigt ? ['checkliste-erledigt'] : [])], ariaHidden: 'true' });
      const neu = erledigt ? [ersatz, el('span', { className: ['sr-only'] }, [text('Erledigt: ')])] : [ersatz];
      eltern.children.splice(eltern.children.indexOf(knoten), 1, ...neu);
    });
  };
}

/**
 * Kontextueller Aufruf im Blog: Frontmatter `cta` ({ titel, text, link, linkText, vor? }) wird als Kasten vor der Überschrift
 * `vor` eingefügt (Textanfang der H2, Standard „Quellen“), also direkt nach dem Abschnitt, in dem PulseDeck vorkommt.
 */
export function rehypeKontextCta({ appUrl }) {
  return (baum, datei) => {
    const cta = datei.data?.astro?.frontmatter?.cta;
    if (!cta) return;
    const vor = cta.vor ?? 'Quellen';
    const index = baum.children.findIndex((k) => k.type === 'element' && k.tagName === 'h2' && textVon(k).trim().startsWith(vor));
    const kasten = el('aside', { className: ['kontext-cta'], ariaLabel: 'PulseDeck ausprobieren' }, [
      el('p', { className: ['kontext-cta-titel'] }, [text(cta.titel)]),
      el('p', {}, [text(cta.text)]),
      el('p', { className: ['kontext-cta-aktionen'] }, [
        el('a', { href: `${appUrl}/registrieren`, className: ['btn-primaer'] }, [text('Kostenlos starten')]),
        el('a', { href: cta.link, className: ['kontext-cta-link'] }, [text(cta.linkText)]),
      ]),
    ]);
    if (index === -1) baum.children.push(kasten);
    else baum.children.splice(index, 0, kasten);
  };
}
