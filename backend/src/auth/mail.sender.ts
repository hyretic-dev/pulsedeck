/** Mailversand des Auth-Moduls (Implementierung: SMTP/Resend, siehe Entscheidung O4). */
export interface MailSender {
  sendVerificationEmail(to: string, verificationLink: string): Promise<void>;
  sendMagicLinkEmail(to: string, loginLink: string): Promise<void>;
  sendPasswordResetEmail(to: string, resetLink: string): Promise<void>;
  /** Einladung durch einen Administrator; der Link meldet passwortlos an. */
  sendInvitationEmail(to: string, loginLink: string, organizationName: string): Promise<void>;
}
