import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { Transform } from 'class-transformer';

export const SICHTBARKEITEN = ['public', 'member', 'committee', 'admin'] as const;
export const ORTS_ARTEN = ['discord', 'zoom', 'onsite', 'other'] as const;
export const WIEDERHOLUNGEN = ['biweekly', 'monthly', 'quarterly'] as const;
export const ANMELDE_STATI = ['confirmed', 'maybe', 'cancelled'] as const;

const DATUM = /^\d{4}-\d{2}-\d{2}$/;
const UHRZEIT = /^\d{2}:\d{2}(:\d{2})?$/;

export class CreateEventDto {
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(200) title!: string;
  @ApiProperty({ example: '2026-11-01' }) @Matches(DATUM) date!: string;
  @ApiProperty({ example: '19:00' }) @Matches(UHRZEIT) start_time!: string;
  @ApiPropertyOptional() @IsOptional() @Matches(UHRZEIT) end_time?: string | null;
  @ApiProperty() @IsString() @MaxLength(300) location!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(10000) description?: string | null;
  /** Wird serverseitig aus der Arbeitsgruppe abgeleitet; ein mitgesendeter Wert wird ignoriert. */
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) ag_name?: string | null;
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID() working_group_id?: string | null;
  @ApiPropertyOptional({ enum: SICHTBARKEITEN, isArray: true, description: 'Leer + Arbeitsgruppe = nur AG-Mitglieder' })
  @IsOptional() @IsArray() @ArrayMaxSize(4) @IsIn(SICHTBARKEITEN, { each: true }) allowed_roles?: string[];
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) @Max(100000) max_participants?: number | null;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() registration_required?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) meeting_reason?: string | null;
  @ApiPropertyOptional({ enum: ORTS_ARTEN }) @IsOptional() @IsIn(ORTS_ARTEN) location_type?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() is_recurring?: boolean;
  @ApiPropertyOptional({ enum: WIEDERHOLUNGEN }) @IsOptional() @IsIn(WIEDERHOLUNGEN) recurrence_interval?: string | null;
  @ApiPropertyOptional({ format: 'uuid', nullable: true, description: 'Belegungsplan (Art Ort), der für den Termin reserviert wird; nur bei „Vor Ort“ und mit Endzeit' })
  @IsOptional() @IsUUID() booking_calendar_id?: string | null;
}

export class UpdateEventDto extends PartialType(CreateEventDto) {}

export class RegisterDto {
  @ApiPropertyOptional({ enum: ANMELDE_STATI }) @IsOptional() @IsIn(ANMELDE_STATI) status?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(1000) note?: string | null;
}

export class RegistrationSummaryDto {
  @ApiProperty({ type: [String] }) @IsArray() @ArrayMinSize(1) @ArrayMaxSize(500) @IsUUID('all', { each: true }) event_ids!: string[];
}

export class CreateSlotDto {
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(200) title!: string;
  @ApiPropertyOptional({ example: '10:00' }) @IsOptional() @Matches(UHRZEIT) start_time?: string | null;
  @ApiPropertyOptional({ example: '12:00' }) @IsOptional() @Matches(UHRZEIT) end_time?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) @Max(1000) max_helpers?: number;
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() @ArrayMaxSize(50) @IsUUID('all', { each: true }) required_skills?: string[];
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(100000) sort_order?: number;
}

export class UpdateSlotDto extends PartialType(CreateSlotDto) {}

export class SlotSignupDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(1000) note?: string | null;
}

export class InviteGuestDto {
  @ApiPropertyOptional({ format: 'uuid', description: 'Bestehende Organisation; sonst Name und E-Mail der Gäste angeben.' })
  @IsOptional() @IsUUID() guest_organization_id?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @IsNotEmpty() @MaxLength(200) guest_org_name?: string;
  @ApiPropertyOptional()
  @IsOptional() @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value)) @IsEmail() guest_org_email?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) guest_org_contact_name?: string;
}

export class RespondGuestDto {
  @ApiProperty({ enum: ['accepted', 'declined'] }) @IsIn(['accepted', 'declined']) status!: 'accepted' | 'declined';
}
