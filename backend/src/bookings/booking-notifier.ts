import { Inject, Injectable } from '@nestjs/common';

import type { Queryable } from '../common/db';
import { reiheMailsEin } from '../jobs/mail-outbox';
import { APP_CONFIG, type AppConfig } from '../config/configuration';

import { BookingAccessService } from './booking-access.service';
import { entscheidungMail, neueAnfrageMail, zeitraumText } from './booking-mails';

export interface BuchungFuerMail {
  title: string;
  start: Date;
  ende: Date;
  memberId: string | null;
}

/** Mails zu Anfragen und Entscheidungen über die Outbox, in der Transaktion der Änderung (E5, E24). */
@Injectable()
export class BookingNotifier {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly zugriff: BookingAccessService
  ) {}

  private async link(db: Queryable, orgId: string): Promise<string> {
    return `${this.config.appBaseUrl}/${await this.zugriff.orgSlug(db, orgId)}/dashboard/belegung`;
  }

  /** Neue Anfrage → Verwaltung und Leitung (ohne die anfragende Person selbst). */
  async neueAnfrage(db: Queryable, orgId: string, calId: string, planName: string, b: BuchungFuerMail): Promise<void> {
    const von = await this.zugriff.mitglied(db, orgId, b.memberId);
    const link = await this.link(db, orgId);
    const inhalt = neueAnfrageMail({ planName, titel: b.title, zeitraum: zeitraumText(b.start, b.ende), link, vonName: von?.name ?? 'Jemand' });
    const empfaenger = (await this.zugriff.verwaltung(db, orgId, calId)).filter((e) => e.id !== b.memberId);
    await reiheMailsEin(
      db,
      empfaenger.map((e) => ({ organizationId: orgId, kind: 'booking_request', recipient: e.email, subject: inhalt.subject, text: inhalt.text, html: inhalt.html, useOrgSmtp: false }))
    );
  }

  /** Entscheidung → anfragende Person (nicht, wenn sie selbst entschieden hat). */
  async entscheidung(
    db: Queryable,
    orgId: string,
    planName: string,
    b: BuchungFuerMail,
    art: 'angenommen' | 'abgelehnt' | 'automatisch_abgelehnt' | 'geloescht',
    grund: string | null,
    entscheiderId: string
  ): Promise<void> {
    if (!b.memberId || b.memberId === entscheiderId) return;
    const person = await this.zugriff.mitglied(db, orgId, b.memberId);
    if (!person) return;
    const inhalt = entscheidungMail({ planName, titel: b.title, zeitraum: zeitraumText(b.start, b.ende), link: await this.link(db, orgId), entscheidung: art, grund });
    await reiheMailsEin(db, [
      { organizationId: orgId, kind: 'booking_decision', recipient: person.email, subject: inhalt.subject, text: inhalt.text, html: inhalt.html, useOrgSmtp: false },
    ]);
  }
}
