import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MinLength,
} from 'class-validator';

import { MaxBytes } from './max-bytes';

/**
 * E-Mail-Adressen werden vor Validierung, Rate-Limit-Schlüssel und Verarbeitung normalisiert
 * (Leerraum entfernen, Kleinschreibung). Die Datenbank ist case-insensitiv (citext); ohne
 * Normalisierung ließe sich das Rate-Limit durch wechselnde Schreibweise umgehen.
 */
const normalisiereEmail = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;

/** Passwörter für neue/bestehende Konten: Bestand hatte keine Mindestlänge im Frontend (E12: 8). */
export class LoginDto {
  @ApiProperty({ example: 'vorstand@example.org' })
  @Transform(normalisiereEmail)
  @IsEmail()
  email!: string;

  @ApiProperty({ example: 'sicher123' })
  @IsString()
  @IsNotEmpty()
  password!: string;
}

export class RefreshDto {
  @ApiProperty({ example: 'a3F…' })
  @IsString()
  @IsNotEmpty()
  refreshToken!: string;
}

export class LogoutDto {
  @ApiProperty({ example: 'a3F…' })
  @IsString()
  @IsNotEmpty()
  refreshToken!: string;
}

export class SignupDto {
  @ApiProperty({ example: 'vorstand@example.org' })
  @Transform(normalisiereEmail)
  @IsEmail()
  email!: string;

  /** Optional: ohne Passwort meldet sich das Konto per Magic Link an und kann später im Profil eines setzen. */
  @ApiPropertyOptional({ example: 'sicher123', minLength: 8 })
  @IsOptional()
  @IsString()
  @MinLength(8)
  @MaxBytes(72)
  password?: string;
}

export class TokenDto {
  @ApiProperty({ example: 'a3F…' })
  @IsString()
  @IsNotEmpty()
  token!: string;
}

export class MagicLinkConsumeDto extends TokenDto {}

export class VerifyEmailDto extends TokenDto {}

export class EmailRequestDto {
  @ApiProperty({ example: 'vorstand@example.org' })
  @Transform(normalisiereEmail)
  @IsEmail()
  email!: string;
}

export class PasswordResetConsumeDto extends TokenDto {
  @ApiProperty({ example: 'sicher123', minLength: 8 })
  @IsString()
  @MinLength(8)
  @MaxBytes(72)
  newPassword!: string;
}

export class ChangePasswordDto {
  @ApiProperty({ example: 'altes-passwort' })
  @IsString()
  @IsNotEmpty()
  oldPassword!: string;

  @ApiProperty({ example: 'sicher123', minLength: 8 })
  @IsString()
  @MinLength(8)
  @MaxBytes(72)
  newPassword!: string;
}

/** E-Mail-Prüfung der Login-Seite; optional auf eine Organisation eingegrenzt. */
export class CheckEmailDto {
  @ApiProperty({ example: 'vorstand@example.org' })
  @Transform(normalisiereEmail)
  @IsEmail()
  email!: string;

  @ApiProperty({ required: false, format: 'uuid' })
  @IsOptional()
  @IsUUID()
  organization_id?: string;
}

export class CheckEmailResponseDto {
  @ApiProperty({ enum: ['connected', 'invitation_sent', 'not_found'] })
  status!: 'connected' | 'invitation_sent' | 'not_found';
}

/** Erstes Passwort für ein Konto ohne Passwort (z. B. nach Einladung). */
export class SetPasswordDto {
  @ApiProperty({ example: 'sicher123', minLength: 8 })
  @IsString()
  @MinLength(8)
  @MaxBytes(72)
  newPassword!: string;
}

export class AccountDto {
  @ApiProperty() userId!: string;
  @ApiProperty() email!: string;
  @ApiProperty() emailVerified!: boolean;
  @ApiProperty({ description: 'false bei eingeladenen Konten, die noch kein eigenes Passwort gesetzt haben.' })
  hasPassword!: boolean;

  @ApiProperty({ description: 'Plattformadministrator (sieht plattformweite Auswertungen).' })
  isPlatformAdmin!: boolean;
}
