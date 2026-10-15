import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsEmail, IsIn, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';

export const NEWSLETTER_HAEUFIGKEITEN = ['weekly', 'monthly', 'manual'] as const;

export class UpdateNewsletterConfigDto {
  @ApiPropertyOptional({ enum: NEWSLETTER_HAEUFIGKEITEN }) @IsOptional() @IsIn(NEWSLETTER_HAEUFIGKEITEN) frequency?: string;
  @ApiPropertyOptional({ description: '0 = Sonntag … 6 = Samstag' }) @IsOptional() @IsInt() @Min(0) @Max(6) day_of_week?: number;
  @ApiPropertyOptional({ example: '12:00' }) @IsOptional() @Matches(/^\d{2}:\d{2}(:\d{2})?$/) time_of_day?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() active?: boolean;
  @ApiPropertyOptional() @IsOptional() @Matches(/^(https?:\/\/\S+)?$/) @MaxLength(2000) logo_url?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) footer_text?: string;
  @ApiPropertyOptional({ example: '#DE0000' }) @IsOptional() @Matches(/^#[0-9a-fA-F]{6}$/) primary_color?: string;
  @ApiPropertyOptional({ description: 'Leer/null = Plattform-Versand' }) @IsOptional() @IsString() @MaxLength(253) smtp_host?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) @Max(65535) smtp_port?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(254) smtp_user?: string | null;
  @ApiPropertyOptional({ description: 'Nur schreibbar, wird nie ausgeliefert. null/leer löscht das Passwort.' }) @IsOptional() @IsString() @MaxLength(500) smtp_pass?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(320) smtp_from?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() smtp_secure?: boolean;
}

export class TestMailDto {
  @ApiProperty() @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value)) @IsEmail() @MaxLength(254) email!: string;
}
