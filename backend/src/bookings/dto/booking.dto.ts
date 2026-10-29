import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsISO8601,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export const PLAN_ARTEN = ['place', 'item'] as const;
export const PLAN_ROLLEN = ['lead', 'manager', 'requester'] as const;
export const OEFFENTLICHE_ANZEIGEN = ['none', 'week', 'month', 'year'] as const;
export const BUNDESLAENDER = ['BW', 'BY', 'BE', 'BB', 'HB', 'HH', 'HE', 'MV', 'NI', 'NW', 'RP', 'SL', 'SN', 'ST', 'SH', 'TH'] as const;
const DATUM = /^\d{4}-\d{2}-\d{2}$/;

export class CreateCalendarDto {
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(80) name!: string;
  @ApiProperty({ enum: PLAN_ARTEN }) @IsIn(PLAN_ARTEN) kind!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) address?: string | null;
  @ApiPropertyOptional({ enum: BUNDESLAENDER, nullable: true }) @IsOptional() @IsIn(BUNDESLAENDER) state?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(23) window_start?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) @Max(24) window_end?: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() all_members_can_request?: boolean;
  @ApiPropertyOptional({ enum: OEFFENTLICHE_ANZEIGEN }) @IsOptional() @IsIn(OEFFENTLICHE_ANZEIGEN) public_view?: string;
}

export class UpdateCalendarDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @IsNotEmpty() @MaxLength(80) name?: string;
  @ApiPropertyOptional({ enum: PLAN_ARTEN }) @IsOptional() @IsIn(PLAN_ARTEN) kind?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) address?: string | null;
  @ApiPropertyOptional({ enum: BUNDESLAENDER, nullable: true }) @IsOptional() @IsIn(BUNDESLAENDER) state?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(23) window_start?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) @Max(24) window_end?: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() all_members_can_request?: boolean;
  @ApiPropertyOptional({ enum: OEFFENTLICHE_ANZEIGEN }) @IsOptional() @IsIn(OEFFENTLICHE_ANZEIGEN) public_view?: string;
}

export class SetCalendarMemberDto {
  @ApiProperty({ enum: PLAN_ROLLEN }) @IsIn(PLAN_ROLLEN) role!: string;
}

export class RangeQueryDto {
  @ApiProperty({ example: '2026-01-01' }) @Matches(DATUM) from!: string;
  @ApiProperty({ example: '2027-01-31' }) @Matches(DATUM) to!: string;
}

export class AvailabilityQueryDto {
  @ApiProperty() @IsISO8601({ strict: true }) start_at!: string;
  @ApiProperty() @IsISO8601({ strict: true }) end_at!: string;
}

export class CreateBookingDto {
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(120) title!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(1000) note?: string | null;
  @ApiProperty() @IsISO8601({ strict: true }) start_at!: string;
  @ApiProperty() @IsISO8601({ strict: true }) end_at!: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() is_public?: boolean;
}

export class UpdateBookingDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @IsNotEmpty() @MaxLength(120) title?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(1000) note?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsISO8601({ strict: true }) start_at?: string;
  @ApiPropertyOptional() @IsOptional() @IsISO8601({ strict: true }) end_at?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() is_public?: boolean;
}

export class DeclineBookingDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) reason?: string | null;
}

export class SeriesDto {
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(120) title!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(1000) note?: string | null;
  @ApiProperty() @IsBoolean() is_public!: boolean;
  @ApiProperty({ type: [Number], description: '0 = Montag … 6 = Sonntag' })
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(7) @IsInt({ each: true }) @Min(0, { each: true }) @Max(6, { each: true }) weekdays!: number[];
  @ApiProperty({ enum: [1, 2, 3, 4] }) @IsIn([1, 2, 3, 4]) every_n_weeks!: number;
  @ApiProperty() @IsInt() @Min(0) @Max(23) hour_from!: number;
  @ApiProperty() @IsInt() @Min(1) @Max(24) hour_to!: number;
  @ApiProperty({ example: '2026-11-01' }) @Matches(DATUM) valid_from!: string;
  @ApiProperty({ example: '2027-01-31' }) @Matches(DATUM) valid_to!: string;
  @ApiProperty() @IsBoolean() skip_holidays!: boolean;
}

export class RenameSeriesDto {
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(120) title!: string;
}

export class EndSeriesDto {
  @ApiProperty({ example: '2027-01-01', description: 'Ab diesem Datum (einschließlich) entfallen die Termine' }) @Matches(DATUM) from!: string;
}

export class CalendarParamIds {
  @IsUUID() calId!: string;
}
