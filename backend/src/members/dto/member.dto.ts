import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEmail,
  IsIn,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateNested,
  registerDecorator,
} from 'class-validator';

import { PERMISSION_KEYS } from '../../tenancy/permissions';

export const MITGLIED_STATI = ['Active', 'Inactive', 'Pending'] as const;
export const APP_ROLLEN = ['public', 'member', 'committee', 'admin'] as const;

const normalisiereEmail = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;

/** Kontaktkanäle: höchstens 10 Einträge, Schlüssel und Werte sind kurze Texte (z. B. Discord, WhatsApp). */
function IstKontaktkanaele() {
  return (objekt: object, eigenschaft: string): void => {
    registerDecorator({
      name: 'istKontaktkanaele',
      target: objekt.constructor,
      propertyName: eigenschaft,
      options: { message: `${eigenschaft} muss ein Objekt mit höchstens 10 Textwerten (je max. 200 Zeichen) sein` },
      validator: {
        validate: (wert: unknown) => {
          if (typeof wert !== 'object' || wert === null || Array.isArray(wert)) return false;
          const eintraege = Object.entries(wert);
          return (
            eintraege.length <= 10 &&
            eintraege.every(([k, v]) => k.length <= 50 && typeof v === 'string' && v.length <= 200)
          );
        },
      },
    });
  };
}

/** Felder eines Mitglieds, die ein Administrator pflegt. `user_id`, `organization_id` und Tokens nie. */
export class CreateMemberDto {
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(200) name!: string;
  @ApiProperty() @Transform(normalisiereEmail) @IsEmail() email!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) role?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) department?: string | null;
  @ApiPropertyOptional({ enum: MITGLIED_STATI }) @IsOptional() @IsIn(MITGLIED_STATI) status?: (typeof MITGLIED_STATI)[number];
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(40) join_date?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000) avatar_url?: string | null;
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID() role_id?: string;
  @ApiPropertyOptional({ enum: APP_ROLLEN }) @IsOptional() @IsIn(APP_ROLLEN) app_role?: (typeof APP_ROLLEN)[number];
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() @ArrayMaxSize(20) @IsIn(PERMISSION_KEYS, { each: true }) permissions?: string[];
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) street?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(20) zip_code?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) city?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(50) phone?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(40) birthday?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000) custom_info?: string | null;
  @ApiPropertyOptional({ type: 'object', additionalProperties: { type: 'string' } }) @IsOptional() @IsObject() @IstKontaktkanaele() contact_channels?: Record<string, string>;
}

export class UpdateMemberDto extends PartialType(CreateMemberDto) {}

/** Das eigene Profil: nur persönliche Angaben, keine Rollen oder Rechte. */
export class UpdateOwnProfileDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(50) phone?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) street?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(20) zip_code?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) city?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(40) birthday?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000) avatar_url?: string | null;
  @ApiPropertyOptional({ type: 'object', additionalProperties: { type: 'string' } }) @IsOptional() @IsObject() @IstKontaktkanaele() contact_channels?: Record<string, string>;
}

/** Import: nur Stammdaten; Rolle, Rechte und Konto-Verknüpfung nie über den Import. */
export class ImportMemberDto {
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(200) name!: string;
  @ApiProperty() @Transform(normalisiereEmail) @IsEmail() email!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) role?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) department?: string;
  @ApiPropertyOptional({ enum: MITGLIED_STATI }) @IsOptional() @IsIn(MITGLIED_STATI) status?: (typeof MITGLIED_STATI)[number];
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(40) join_date?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) street?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(20) zip_code?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) city?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(50) phone?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(40) birthday?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000) custom_info?: string;
}

export class ImportMembersDto {
  @ApiProperty({ type: [ImportMemberDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(1000)
  @ValidateNested({ each: true })
  @Type(() => ImportMemberDto)
  members!: ImportMemberDto[];
}

export class BulkDeleteDto {
  @ApiProperty({ type: [String] }) @IsArray() @ArrayMinSize(1) @ArrayMaxSize(200) @IsUUID('all', { each: true }) ids!: string[];
}

export class CreateRoleDto {
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(100) name!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) description?: string | null;
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() @ArrayMaxSize(20) @IsIn(PERMISSION_KEYS, { each: true }) permissions?: string[];
  @ApiPropertyOptional() @IsOptional() @IsBoolean() is_default?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() is_system_admin?: boolean;
}

export class UpdateRoleDto extends PartialType(CreateRoleDto) {}

export class InviteResultDto {
  @ApiProperty() message!: string;
  @ApiProperty({ enum: ['invited', 'reset'] }) type!: string;
  @ApiProperty() userId!: string;
}

export class ShareLinkResultDto {
  @ApiProperty() success!: boolean;
  @ApiProperty({ description: 'Zugangsdatum: nur anzeigen/kopieren, nie loggen.' }) link!: string;
  @ApiProperty() expiresIn!: string;
  @ApiProperty() message!: string;
}
