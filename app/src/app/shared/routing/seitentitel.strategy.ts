import { Injectable, inject } from '@angular/core';
import { Title } from '@angular/platform-browser';
import { RouterStateSnapshot, TitleStrategy } from '@angular/router';

/**
 * Seitentitel aus `title` der Route, ergänzt um den Produktnamen („Termine - PulseDeck“). Routen ohne Titel zeigen „PulseDeck“;
 * Seiten mit eigenem Inhaltstitel (z. B. öffentliche Termine) setzen ihn danach selbst.
 */
@Injectable({ providedIn: 'root' })
export class SeitentitelStrategie extends TitleStrategy {
  private readonly title = inject(Title);

  override updateTitle(snapshot: RouterStateSnapshot): void {
    const titel = this.buildTitle(snapshot);
    this.title.setTitle(titel ? `${titel} - PulseDeck` : 'PulseDeck');
  }
}
